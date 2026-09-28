# Frente "zfight2": texturas piscando nos Pokémon que sobraram depois da beta 5 (v1.0.5)

Relato: no cliente real (Windows), com a v1.0.5, ainda piscam (z-fighting, alternando por quadro) Eternatus, Chandelure,
Mamoswine, Arbok e outros. Prints 14–19 e prints5 (31 = Arbok normal, roxo; 32 = Arbok shiny, amarelo, voando no
selftest: "Entidades: 80/2747" — o selftest cria TODAS as variantes, inclusive alfa e padrões).
BDS próprio `zf2` (porta 19184, `dist-zf2`, RakNet), removido no fim. `cobblemon-bds` não foi tocado. Sem commit.

## Detector (novo)

`tools/importer/zfightEntities.ts` (`entityZFightRisks`) roda sobre TODAS as client entities que desenham geometria de
Pokémon (1.088: 894 base + 194 MSD; só elas usam as 1.433 geometrias de `models/entity/pokemon`), com a pilha de
render controllers (base + camadas) e os materiais resolvidos pela herança (vanilla + `materials/*.material` do RP).
Riscos, na pose de repouso (pivôs e rotações de osso e de cubo aplicados):

| Risco | O que é |
|---|---|
| `camada` | render controller depois do 1º desenhando a MESMA geometria com material de `depthFunc` `Less` (não passa no empate com a base) |
| `camada-dois-lados` | camada sem descarte de face de trás sobre base de um lado, em geometria com plano/cubo invertido |
| `plano-dois-lados` / `cubo-invertido` | plano sem espessura, plano com inflate negativo ou cubo virado do avesso desenhado com material de dois lados |
| `coplanar-mesmo-osso` / `coplanar-entre-ossos` | faces visíveis do mesmo lado sobrepostas no mesmo plano (< 0,001 px) |
| `quase-coplanar` | faces visíveis do mesmo lado a menos de 0,01 px (o passo do próprio Java) |
| `geometrias-sobrepostas` | duas geometrias diferentes desenhadas juntas na mesma variante (render controllers da mesma variante) |
| `material-desconhecido` | material sem como saber culling/profundidade |

"Visível": o par cuja região sobreposta fica inteira DENTRO do volume de outros cubos não aparece (as pálpebras e bocas
de expressão do Cobblemon ficam guardadas dentro da cabeça; a animação traz a ativa 0,1 px para fora).

Relatório: `node --experimental-strip-types --no-warnings tools/importer/zfightReport.ts [--all] [espécie…]` (base e
base + MSD). Regra no `npm run validate`: `tools/importer/validateZFight.ts` (erro por entidade com risco; exceções
justificadas em `ZFIGHT_EXCEPTIONS` — vazia).

**Antes** (detector final sobre o build da beta 5, `dist-b5`): **891** client entities com risco — `camada` 879,
`coplanar-entre-ossos` 592, `quase-coplanar` 341, `coplanar-mesmo-osso` 221, `cubo-invertido` 14. As citadas aparecem
todas (tabela abaixo). **Depois**: **0** no base e **0** no base + MSD.

## Causas encontradas (não tratadas antes) e correção

### 1. Camadas do render controller sobre a mesma geometria — causa principal (879 entidades)

**Causa.** Toda client entity de Pokémon desenha a base e depois cada camada (emissiva, translúcida, `alpha`, padrões
do Arbok, shiny emissivo…) com a MESMA geometria (`Array.geo[variante]` igual em todos os controllers), com
`entity_alphatest`/`entity_alphablend`. O teste de profundidade padrão dos materiais de entidade do Bedrock é `Less`:
a camada empata com a base e cada pixel decide por arredondamento → pisca. Prova no material vanilla
(`materials/entity.material` do jogo, versão com copper golem/nautilus): toda passada extra sobre a mesma geometria
muda o teste — `iron_golem:entity_alphatest { depthFunc: LessEqual }` (rachaduras), `villager_v2` e
`villager_v2_masked` (`LessEqual`), `entity_emissive_layer_alpha_test/_blend` (`Equal`: warden, breeze, creaking,
copper golem), `entity_dissolve_layer1` (`Equal`). No Java (`PosableModel.render`) as camadas usam o mesmo
`rootPart.render` com o LEQUAL do OpenGL. A frente fix3 tinha conferido só que as camadas não eram opacas.

**Correção.** `materials/entity.material` gerado pelo import (`zfightEntities.entityMaterialFile`, gravado no
`index.ts`): `cobblemon_layer:entity_alphatest_one_sided` e `cobblemon_layer_translucent:entity_alphablend`, os dois
só com `depthFunc: LessEqual` (nenhum define nem shader novo; o mesmo formato do `iron_golem` vanilla). As client
entities de Pokémon (`entities.ts`, `POKEMON_MATERIALS`) usam `layer: cobblemon_layer`,
`layer_translucent: cobblemon_layer_translucent`. Vale para o MSD (o filho do MSD usa o mesmo `emitClientEntity`).

### 2. Base de dois lados, diferente do Java (planos com inflate negativo, cubos invertidos)

**Causa.** O Java desenha a base com `RenderType.entityCutout` (descarta a face de trás). Aqui a base era
`entity_alphatest` (herda `entity_nocull`: sem descarte). Com isso:
- os 239 planos com **inflate negativo** do upstream (174 base + 65 MSD, 60 geometrias; ex. costelas, capacete e
  orelhas do Eternatus) ficam com as faces trocadas de lado; e o passe de espessura da beta 5
  (`thickenFlatEntityCubes`) transformava inflate negativo em +0,025 — igual ao plano vizinho (inflate 0 → +0,025): os
  dois planos ficavam no MESMO plano (Eternatus: `ribcage_left2#0/#1` 610 px², `helmet_connector#0/#1` 45,7 px²,
  51 pares no mesmo osso);
- 48 cubos com inflate negativo maior que meio tamanho (virados do avesso: faces internas à mostra; Eternatus 196
  faces de `segment*`).

**Correção.**
- Base `entity_alphatest_one_sided` — material vanilla (ALPHA_TEST sobre `entity`, com descarte), o equivalente exato
  do `entityCutout`; o axolotl vanilla atual o usa (`axolotl_limbs`) justamente nos membros e guelras, que são planos.
  Com ele o plano de fundo do Java (inflate negativo) e o cubo invertido aparecem como no Java.
- `zfight.ts/thickenFlatEntityCubes`: todos os planos com inflate ≥ 0 da geometria sobem o MESMO 0,025 (antes só os
  finos subiam: um de 0 e um de 0,025 empatavam); com material de um lado (`oneSided`, geometrias de Pokémon) o plano
  negativo fica como no Java; sem ele (nenhuma geometria hoje) tudo sobe o mesmo tanto.
- Regra §3 do validate (`validateVariables.ts`): o plano com inflate negativo só é aceito em geometria desenhada apenas
  com material de um lado (`oneSidedGeometries`).

### 3. Faces coplanares entre OSSOS DIFERENTES e as que a espessura criou

**Causa.** `separateCoplanarCubes` (fix3) só olhava o mesmo osso. Entre ossos, na pose de repouso: Chandelure (velas e
chamas da frente/de trás no mesmo lugar, `flame_front_right#0~flame_back_right#0` 8 px²), Pikachu (184), Venusaur
(246), Decidueye (236), Hatterene (247)… E o detector antigo (`coplanarConflicts`) arredondava a distância do plano em
baldes de 0,01 px: faces a 0,01 px às vezes caíam no mesmo balde (falso empate) e faces a 0,001 px às vezes em baldes
vizinhos (par perdido).

**Correção.**
- `coplanarConflicts`: agrupa por normal (resolução fixa 0,001) e compara por janela deslizante na distância (`eps`,
  padrão 0,001 px); base 2D ortonormal (área em px² de verdade); `skipHidden` descarta o par guardado dentro de outros
  cubos; devolve o vão (`gap`).
- `zfight.ts/shiftCoplanarCubes` (pós-passe `fixEntityFlatPlanes`, depois da espessura, só `models/entity/pokemon`):
  para cada par visível do mesmo lado a menos de `MIN_ENTITY_FACE_GAP` = 0,01 px, fica por cima quem já estava na
  frente; no mesmo plano, o cubo que o Java desenha depois (`boneDrawOrder`: osso, filhos, na ordem do JSON). **Só a
  face em conflito anda para fora**, no espaço do cubo (`size` do eixo cresce, a origem recua quando é a face do lado
  mínimo). Tentativas descartadas, medidas nas 1.439 geometrias (base + MSD):
  - `inflate` +0,01 entre ossos (como o fix3): pilhas de expressões chegavam a +0,3 px no tamanho (410 geometrias com
    mais de 0,05 px);
  - transladar o cubo: a face oposta entrava e empatava do outro lado (a `pattern` do Bulbasaur e as membranas das asas
    do Charizard iam e voltavam; 671 geometrias sem convergir);
  - separar também as pilhas escondidas: as pálpebras de expressão do Zebstrika andavam até 0,19 px para fora (furariam
    a cabeça) — daí o `skipHidden`.
  Resultado: 0 geometrias com par restante; maior deslocamento de face 0,11 px (1/9 de texel; Uxie/Mesprit/Azelf,
  elos de cauda que se sobrepõem em repouso), 48 cubos acima de 0,06 px. `uv`, `pivot`, `rotation` e `mirror` não
  mudam; na UV de caixa a faixa cresce o mesmo tanto em texels.
- O separador do mesmo osso no `models.ts` (fix3, inflate) continua igual; o dos blocos também (só mesmo osso).

### 4. Geometrias diferentes desenhadas juntas

Conferido pelo detector (`geometrias-sobrepostas`): cada render controller de Pokémon escolhe UMA geometria pela
variante e as camadas usam o mesmo array da base — 0 casos (base e MSD). Não há g0..gN desenhadas juntas.

## Por espécie (detector; antes = `dist-b5`, a beta 5 que foi para o cliente)

| Espécie | Beta 5 (dist-b5) | Depois |
|---|---|---|
| eternatus | camada 3, cubo-invertido 196, coplanar-mesmo-osso 51, coplanar-entre-ossos 16 | — |
| chandelure | camada 3, coplanar-mesmo-osso 24, coplanar-entre-ossos 20, quase-coplanar 16 | — |
| mamoswine | camada 1 | — |
| arbok | camada 2 | — |
| ekans | camada 1, quase-coplanar 4 | — |
| pikachu | camada 4, coplanar-entre-ossos 184, coplanar-mesmo-osso 16 | — |
| bulbasaur | camada 1, coplanar-entre-ossos 60 | — |
| venusaur | camada 1, coplanar-mesmo-osso 20, coplanar-entre-ossos 246, quase-coplanar 4 | — |
| charizard | camada 2, quase-coplanar 7 | — |
| pidgey | camada 1, coplanar-mesmo-osso 4, coplanar-entre-ossos 5, quase-coplanar 2 | — |
| gyarados | camada 2, coplanar-entre-ossos 64 | — |
| dragonite | camada 2, coplanar-entre-ossos 8 | — |
| mewtwo | camada 1 | — |
| lucario | camada 1, quase-coplanar 8 | — |
| garchomp | camada 1, coplanar-mesmo-osso 4, quase-coplanar 18 | — |
| eevee | camada 1, coplanar-entre-ossos 14, quase-coplanar 8 | — |
| umbreon | camada 2, coplanar-entre-ossos 4 | — |
| gengar | camada 3, coplanar-entre-ossos 20 | — |
| snorlax | camada 1 | — |
| lapras | camada 1, coplanar-entre-ossos 4 | — |
| ninetales | camada 1, coplanar-entre-ossos 20 | — |
| arcanine | camada 1, coplanar-entre-ossos 7 | — |
| decidueye | camada 1, coplanar-mesmo-osso 68, coplanar-entre-ossos 236, quase-coplanar 44 | — |
| corviknight | camada 1, coplanar-mesmo-osso 2, coplanar-entre-ossos 14, quase-coplanar 2 | — |
| slowking | camada 1, quase-coplanar 6, coplanar-entre-ossos 2 | — |
| rayquaza | camada 1, coplanar-entre-ossos 6 | — |
| hatterene | camada 1, coplanar-mesmo-osso 138, coplanar-entre-ossos 247, quase-coplanar 9 | — |
| tyranitar | camada 1, coplanar-mesmo-osso 8 | — |
| blaziken | camada 1, coplanar-mesmo-osso 20, coplanar-entre-ossos 78, quase-coplanar 12 | — |
| gardevoir | camada 1, coplanar-entre-ossos 4 | — |
| metagross | camada 1 | — |
| volcarona | camada 1, coplanar-entre-ossos 4, quase-coplanar 2 | — |
| scizor | camada 1, coplanar-mesmo-osso 4, quase-coplanar 16 | — |
| litwick | camada 2, quase-coplanar 2 | — |
| piloswine | camada 1 | — |

Leitura das citadas:
- **Eternatus** (prints 14–17): camadas `emissive` + `transparency` translúcidas em todas as variantes (e `alpha`),
  planos de fundo do Java igualados pela espessura (costelas/capacete/orelhas), 196 faces de cubos virados do avesso
  com material de dois lados, e 16 pares entre ossos (`segment*`/`tail`).
- **Chandelure**: camadas `emissive`/`transparency` (as chamas) + velas/chamas da frente e de trás coplanares entre
  ossos + faces da cabeça (`head#1..#6`) no mesmo osso.
- **Arbok/Ekans** (prints 31–32): a camada do padrão do capuz (`arbok_pattern_*`, 22 padrões × normal/shiny) e a
  `alpha` sobre a base — o selftest cria todas as variantes, daí o capuz piscando em todos.
- **Mamoswine** (print 18): a camada `alpha` (variantes 2/3/6/7, que o selftest cria). As seis pálpebras de expressão
  (`eyelid_unamused/angry/sad/happy/recoil`) são coplanares entre si, mas ficam guardadas 0,07 px atrás dos óculos em
  repouso (invisíveis) — não entram, e não são mexidas.

## Prova

- `npm run import`: OK (base + MSD). Contadores novos/mudados no `import-report.json`: "z-fighting: cubos separados
  depois da espessura (Pokémon, entre ossos)" 7.110 (inclui pares do mesmo osso que a espessura criou), "cubos com
  inflate para separar faces coplanares (z-fighting)" 1.530 (era 1.960: os falsos empates dos baldes de 0,01 saíram;
  1.537 numa contagem independente sobre o upstream cru), blocos 1.530 (era 1.533; 1.668 cubos de bloco com inflate
  contra 1.672 na beta 5 — os blocos praticamente não mudam).
- Detector (`zfightReport.ts`): base 0, base + MSD 0 (antes 891 na beta 5).
- `npm run validate`: `Z-fighting (Pokémon, zfight2): 0 client entities com risco` no base e na árvore base + MSD
  (`validateMsd.ts`). Único erro nos dois: `resource_packs/CobblemonBedrock/models/entity/studio/studio_platform.geo.json`
  (plano de espessura zero, regra §3 que já existia) — arquivo NOVO e não rastreado da frente **ui-polish** (criado às
  06:40 durante esta frente); não é desta frente e não foi editado (ver "Pedidos").
- `npx tsc -p tsconfig.json`: 0 erros.
- `npm test`: todos passam, incluindo `tests/zfight2.test.ts` (13 testes: ordem de desenho, par entre ossos só com a
  face de cima andando, pilha escondida intacta, rotação/pivô, plano de fundo do Eternatus com e sem material de um
  lado, espessura idempotente, tabela de materiais, detector antes/depois, geometrias sobrepostas; e no gerado: as 5
  citadas + 30 com os materiais novos e sem risco, e paridade com o upstream — `uv/pivot/rotation/mirror` idênticos,
  `origin/size` ≤ 0,15 px, inflate só sobe ≤ 0,1, plano de fundo negativo igual ao Java) e `cliente-teste3-log` (11).
- BDS `cobblemon-bds-zf2` (porta 19184, `dist-zf2`, RakNet, online-mode=false): deploy com MSD sobe; cenário
  `tests/e2e/experimental/zfight2.e2e.mjs` (bot): Eternatus, Chandelure, Mamoswine, Arbok, Ekans, Charizard, Venusaur,
  Hatterene, Litwick e Piloswine, normal e shiny (20/20), 0 ERROR/WARN durante o cenário — 1/1. No log, fora do cenário,
  só: o aviso de transporte (RakNet), o `cobblemon:studio_platform` da ui-polish (`platform_scale` default não é float)
  e comandos meus de console sem jogador (`Unable to summon object`/`No targets matched selector`). O BDS não carrega o
  resource pack: a prova do visual é o detector. Container removido (`docker rm -f cobblemon-bds-zf2`).

## Não dá para conferir sem o cliente / riscos

- **Material próprio no RenderDragon.** `cobblemon_layer*` herda um material vanilla e muda só `depthFunc` (o mesmo
  formato do `iron_golem`/`villager_v2` vanilla). Se o cliente ignorar o arquivo do add-on, a camada volta a `Less`
  (igual à beta 5); se não achar o material, a camada não é desenhada (sem piscar). A base usa só material vanilla.
- **Hipótese não provada: vão de 0,01 px do Java.** Faces a 0,01 px (olhos 0,01 à frente dos óculos do Mamoswine,
  pupilas 0,01 à frente dos olhos) podem ainda brigar de longe, dependendo da precisão de profundidade do cliente.
  Exigir mais vão (0,02/0,03/0,05) move faces até 0,22/0,37/0,70 px em 947/3.793/20.501 cubos (cascatas em cadeias de
  caudas, coroas e expressões): muda a forma dos modelos. Se ainda piscar no próximo teste, olhar primeiro esses pares
  (`zfightReport.ts` com `MIN_ENTITY_FACE_GAP` maior só no detector mostra onde).
- A pose de repouso é a referência: peças que só se encostam no meio de uma animação não entram (piscariam por
  instantes).

## Pedidos a outras frentes

- **ui-polish**: `resource_packs/CobblemonBedrock/models/entity/studio/studio_platform.geo.json` tem um plano de
  espessura zero (`platform#0`) com material de dois lados (erro §3 do validate, z-fighting); e o BP
  `cobblemon:studio_platform` tem `cobblemon:platform_scale` com `default` que não é float (ERROR no BDS). Sugestão:
  `inflate: 0.025` no plano (ou material `entity_alphatest_one_sided`) e `default` numérico.

## Arquivos

- Novos: `tools/importer/zfightEntities.ts` (materiais + detector), `tools/importer/zfightReport.ts` (relatório),
  `tools/importer/validateZFight.ts` (regra do validate), `tests/zfight2.test.ts`,
  `tests/e2e/experimental/zfight2.e2e.mjs`.
- Importador: `zfight.ts` (`coplanarConflicts` sem baldes + `skipHidden` + vão; `boneDrawOrder`; `shiftCoplanarCubes`;
  `thickenFlatEntityCubes`/`isFlatEntityCube`/`flatEntityCubes` com `oneSided`; `fixEntityFlatPlanes` com o
  pós-passe), `entities.ts` (materiais), `index.ts` (grava `materials/entity.material`), `validate.ts` (chama a
  regra), `validateVariables.ts` (§3 com `oneSidedGeometries`).
- Gerado: `resource_packs/CobblemonBedrock/materials/entity.material`.
