# Frente "cliente-teste3-log": content log do 3º teste em cliente real (Windows, pack v1.0.4)

Log: `ContentLog2026-09-27_23-45-49_1.txt` (217 mil linhas; selftest quick + full completos, sem crash).
BDS próprio `log3` (porta 19180, `dist-log3`, RakNet, online-mode=false), removido no fim. Sem commit.

Tabela nova em `tools/client-log-summary.mjs` ("Frente cliente-teste3-log"). No log do 3º teste ela dá:

| Categoria | Linhas no 3º teste | Regra no `npm run validate` / correção | Esperado no próximo teste |
|---|---:|---|---:|
| partícula: variável lida sem definição | 61.969 (492 assuntos) | `validateVariables.ts` §1 (`particleVariableProblems`) | 0 |
| partícula: struct em variável (`variable.color.r`) | 36 | `validateVariables.ts` §1 | 0 |
| render controller: variável sem inicializar | 31.200 (56 assuntos, 8 entidades) | `validateVariables.ts` §2 (`entityUndefinedVars`) | 0 |
| animação: variável sem inicializar | 512 (2) | `validateVariables.ts` §2 | 0 |
| animation controller: variável sem inicializar | 4 (4) | `validateVariables.ts` §2 | 0 |
| item data-driven sem ícone | 1.651 (1) | `validateContent.ts` (todo item `cobblemon:` com `minecraft:icon`) | 0 |
| script: LocationInUnloadedChunkError | 54 (2) | correção no script (ver 7) | 0 |
| spawner: fatia lenta no tick | 1 | orçamento das consultas de estrutura (ver 8) | 0 |
| selftest: o motor tirou o jogador da montaria | 1 (garchomp, drampa) | `behavior.float` fora da base das montáveis + `buoyant` no LIQUID (ver 9) | 0 |

Z-fighting dos planos (item 10) não aparece no content log; a regra é a §3 de `validateVariables.ts`.

## 1. Partículas: Molang com variáveis desconhecidas — FEITO

**Causa.** No Java o `ParticleStorm` define `v.entity_width/height/size/radius/scale` (entidade) e
`v.target_deltax/y/z` / `v.target_distance` (alvo do golpe), e o `MoLangRuntime` devolve 0 para qualquer variável
desconhecida. No Bedrock a variável não definida vale 0 também, mas o cliente acusa "unknown variable" a cada
avaliação. Quem dispara sem as variáveis: o `selftest` (todas as ~1.010 partículas por `player.spawnParticle` sem
`MolangVariableMap`), as partículas-filhas (evento `particle_effect`: no Java a filha recebe a mesma entidade e o
mesmo alvo; no Bedrock ela não herda nada do pai) e as disparadas por animação. O script de golpe
(`ActionEffects.particleVariables`) já passava os valores reais que o Java passa (`ParticleStorm.spawn` /
`addAttackingFunctions`: tamanho da caixa, alvo com Y invertido). Um caso a mais: curva (`curves`) lida na forma do
emissor antes da 1ª avaliação (fireblast: `v.burstarc` na `direction` do `emitter_shape_point`, 1º quadro).

**Correção (importador).** `tools/importer/molangVars.ts` (`guardParticleVariables`), chamado em
`particles.ts/clientSafeParticle` para TODA partícula gerada (antes só filhas e só `v.entity_*`): cada variável lida
sem guarda (`??`) e não escrita no `creation_expression` antes da leitura ganha `v.x = v.x ?? padrão;` no começo do
`creation_expression`. Padrões: `v.entity_*` os mesmos do script sem tamanho (1/1/1/0,5/1); curva lida cedo = valor
do começo da curva; o resto 0 (o valor do Java). O `??` mantém o que o script passar. Curva lida só na
aparência/movimento da partícula não precisa (existe quando é lida; nenhum erro dessas no log). Variáveis do motor
(`v.emitter_*`, `v.particle_*`) ficam de fora. Também na partícula própria do Dynamax do MSD (`msdDynamax.ts`).
No import: 325 partículas do base com guarda.

**Prova.** `npm run validate` (base e base + MSD): 0 erros; antes 494 partículas acusadas. Exemplos gerados:
`stringshot_targetwrap` `v.entity_width = v.entity_width ?? 1`, `megadrain_actor` `v.target_deltax/y/z ?? 0`,
`explosion_actorfire` (`v.entity_* ??` antes do `v.clampradius = …` original). Os guardas `??` já existentes nas
filhas (frente cliente-log) não aparecem no log do 3º teste: o `??` não acusa. Teste
`tests/cliente-teste3-log.test.ts`.

**Limite (NÃO POSSÍVEL no Bedrock).** A filha recebe o padrão (0/1), não o alvo/tamanho real do pai: o Bedrock não
passa variáveis do emissor pai para a filha (o `pre_effect_expression` do evento não é usado no vanilla e não dá para
confirmar sem cliente). Sem erro no log; o visual da filha que dependa do alvo fica na origem.

## 2. Render controllers — FEITO

**Causa.** `v.cobblemon_gimmick_a/r/g/b` (tinta do gimmick, msd-fase1) só eram gravados no `on_entry` do
`controller.animation.cobblemon.gimmick_tint`; o `overlay_color` dos render controllers foi avaliado antes dele em
spinda, tentacool, tentacruel, bunnelby, drilbur, rattata, raticate e joltik (todas as entidades estavam expostas:
o validate acusava as 894).

**Correção.** `entities.ts/gimmickPreAnimation`: `v.cobblemon_gimmick_* = v.cobblemon_gimmick_* ?? 0;` no
`pre_animation` de toda client entity de Pokémon. Pós-passe genérico `ensureEntityVariables` (`molangVars.ts`,
chamado no fim do `index.ts`): qualquer variável lida por render controller, animação, animation controller ou
`scripts.animate/scale` e não escrita no `initialize`/`pre_animation` ganha `v.x = v.x ?? 0;` no começo do
`pre_animation`. No import de agora ele só precisou de 1 (poliwhirl `v.foot`, que o Java também lê sem definir = 0).

**Prova.** Regra §2 do validate (todas as client entities, geradas e à mão): 0 erros; antes 894 entidades. Teste
com spinda/joltik/tentacool/bunnelby gerados.

## 3. `cobblemon:pokemon_model` sem ícone — FEITO

**Causa.** O modelo Java do item é `builtin/entity` (o `PokemonItemRenderer` desenha o Pokémon) sem `layer0`.
**Correção.** `javaModels.itemIconTexture`: item `builtin/entity` sem camada usa a textura `particle` do próprio
modelo (pokemon_model → Cherish Ball, `textures/item/poke_balls/cherish_ball`).
**Regra.** `validateContent.ts`: todo item `cobblemon:` sem `minecraft:icon` é erro (o de ícone fora do
`item_texture` já existia). **Prova.** Validate 0 erros; teste confere ícone + entrada no `item_texture.json`.

## 4. Animações: `v.cr_o_pitch_change30`, `v.cr_o_yaw_change_24` — FEITO

**Causa.** Erro de digitação no Java: `…*q.r.pitch_change(0)30*(…)` (charizard `ride_air_fly`) e
`q.r.yaw_change(2)4+…` (flygon). O parser do Java (bedrockk) para no número colado e ignora o resto (o conserto
`molangSyntax.javaMolangToBedrock` já sabe disso), mas a troca `q.r.X(N)` → `v.cr_o_X_N` (`molang.ts/scanMolang`)
colava o nome no número e virava uma variável que ninguém define.
**Correção.** `scanMolang`: quando o texto trocado termina em letra/dígito e o próximo caractere também, entra um
espaço; o conserto com a semântica do Java descarta o resto como o Cobblemon: `30 - (12.5 * v.cr_o_pitch_change)` e
`v.cr_o_yaw_change_2` (variáveis de montaria que o `pre_animation` já calcula).
**Regra.** A §2 do validate cobre animações (toda `v.*` lida em animação da entidade precisa ser escrita no
`initialize`/`pre_animation`). **Prova.** Validate 0; teste do `rewriteMolang` + `fixBoneMolang`.

## 5. Controllers: joltik `v.cobblemon_quirk_loops_joltik_2/3` — FEITO

**Causa.** O gerador de quirks (`posers.ts`) gravava `pick`/`loops` só no `on_entry` do estado `play`; a transição e
as condições foram avaliadas antes. **Correção.** `initialize` ganha `pick = 0; loops = 1;` (o mínimo que o
`on_entry` sorteia) para cada quirk. **Prova.** Regra §2 (antes 1.269 variáveis `quirk_loops` + 52 `quirk_pick` em
todo o conteúdo), validate 0.

## 6. Partícula `fishing_line` — FEITO

`variable.color.r/g/b` (struct de `setColorRGB`) → `v.color_r/g/b` escalares com padrão (0,157 = `#282828`, a cor
padrão do script) no `creation_expression`; `FishingController.drawLine` passa `setFloat("variable.color_r"…)`.
Regra: struct em partícula é erro (§1). Prova: validate 0; teste.

## 7. `LocationInUnloadedChunkError … (-472, 70|71, 991) at main.js:597` — FEITO (causa por inferência)

**Como foi achado.** Build equivalente com sourcemap: `git archive HEAD` numa pasta temporária, `tools/build.mjs
--release` com `sourcemap: "external"` → `main.js` idêntico byte a byte ao do `CobblemonBedrock_BP.mcpack` de
`dist/` (1.0.4). A linha 597 (445 mil colunas) junta 57 módulos. O cliente só guarda o 1º quadro da pilha
("at <anonymous>"): o erro sai direto de uma função anônima sem `try`. Cruzando os membros que lançam
`LocationInUnloadedChunkError` (typings 2.10: `Block.*`, `Dimension.getBlock/getBiome/getLightLevel/spawnParticle/
setBlock*`, `Player.spawnParticle`) com as funções anônimas da linha, o único caso que roda sem jogador por perto e
repetido é o callback de `world.afterEvents.projectileHitBlock` do vaso decorado (`adaptacoes/decoratedPot.ts`):
`block?.typeId` fora do `try`. Encaixa nos dados: z = 991 é a última linha do chunk 61 (o projétil no chunk vizinho
que tica bate num bloco de um chunk carregado que não tica — borda da distância de simulação, com o jogador voando
longe no fim do selftest), alterna y 70/71 e se repete ~8×/s por 3,5 s. Os outros callbacks de
`projectileHitBlock` (`RedstoneEvents.ts`) conferem `block.isValid` antes e saem; o de captura não lê o bloco.
(`Dimension.getBlock` em chunk descarregado devolve `undefined` no BDS — medido — e só lança com o chunk carregado
sem ticar.)

**Correção.** `potHitByProjectile` (exportada, pura): lê bloco, `isValid`, `typeId` e o projétil dentro de `try`; sem
vaso válido não faz nada (não há o que adiar: o vaso só racha no acerto). `RedstoneEvents.ts`: `typeId` também em
`try`. **Prova.** Teste com um bloco cujo `typeId` lança; BDS: 6 teleportes de 700–2.000 blocos com o bot (spawner e
scripts por jogador rodando na chegada) + selftest `movement` e `quick`: nenhum `LocationInUnloadedChunkError` no
log (cenários abaixo).

## 8. Spawner: fatia de 57 ms ("espaço") — FEITO (mitigação)

**Causa provável.** No `addPositionDataJob` a fatia rotulada "espaço" inclui os filtros antes do espaço
(`passesBeforeSpace` → condições). A condição `structures` chama `isInStructure` → consultas preguiçosas: vila =
`containsBlock` + `getBlocks` num volume de 97×65×97 por chunk novo; estruturas vanilla (limites-b) = 1–3
`containsBlock` por chunk. Várias no mesmo tick (chunk novo, 1ª vez) somam dezenas de ms. Só 1 ocorrência em ~50 min.
**Correção.** `StructureRegistry.getStructuresAt`: orçamento de 4 ms de consultas preguiçosas por tick
(`LAZY_CHECK_BUDGET_MS`); passado, as restantes ficam para um tick seguinte (nada vira negativo em cache, a consulta
só não rodou) e vale o registro. **Prova.** Teste (duas consultas lentas no mesmo tick → só a 1ª roda; no tick
seguinte, a 2ª). BDS: nenhum `[spawn] passe lento` nas rodadas abaixo.

## 9. Montaria aquática de Garchomp e Drampa — FEITO

**Java.** `liquid/boat` (`BoatBehaviour`): enquanto há água em `eyeY + surfaceLevelOffset` (-1,7 no Garchomp) a
montaria sobe 0,5/tick — boia na superfície; e `PokemonEntity.dismountsUnderwater() = false` (nenhum Pokémon derruba o
passageiro na água).

**Reprodução no BDS.** `selftest movement` (todas as 108 montarias) com o build antes da correção:
"o motor tirou o jogador da montaria: garchomp LIQUID (-), drampa LIQUID (-)" — o `(-)` quer dizer derrubado já no
1º tick depois do `addRider` (a montaria nasce no fundo da piscina). Três hipóteses medidas, uma por rodada:
1. `minecraft:buoyant` no grupo `ride_liquid`: continua derrubando (o grupo só entra depois do on_mount);
2. `breathes_water: true` (drampa na base; garchomp num grupo do on_mount): continua derrubando — o fôlego não é a
   causa (o "achado antigo" da `breathes_water` era só correlação);
3. a causa: `minecraft:behavior.float` na base de quem não respira na água (`entities.ts`, "pokemon_no_underwater").
   A documentação do componente: "Passengers will be kicked out the moment the mob's head goes underwater". As
   três montarias derrubáveis (garchomp, drampa, tauros Paldea-Aqua) são exatamente as montáveis com LIQUID que têm
   o `behavior.float` na base.

**Correção (`entities.ts`).** Em espécie montável, o `behavior.float` sai da base e vai para o grupo
`cobblemon:move_ai` — o grupo de IA de movimento que a entidade ganha ao nascer, perde no `on_mount` e recupera no
`on_dismount`; os grupos de montaria copiam `aiMove`, não o `move_ai`, então não levam o `behavior.float`. Solto, o
Pokémon boia como antes; montado, o motor não derruba mais o jogador. No estilo LIQUID de superfície
(`boat`/`burst`, sem respirar na água) o grupo `ride_liquid` ganha `minecraft:buoyant` (o do barco), que faz a
montaria boiar como o `BoatBehaviour`; a base não tem o componente, então tirar o grupo ao desmontar não muda nada.
Espécies não montáveis continuam com o `behavior.float` na base. Quem respira na água (lapras etc.) não muda.

**Prova.** Teste do JSON gerado (garchomp/drampa: sem `behavior.float` na base nem nos grupos de montaria, com ele
no `move_ai`, `on_mount` tira o `move_ai`, `ride_liquid` com `buoyant`; pidgey, que não é montável, com o
`behavior.float` na base). BDS: ver "Rodadas no BDS".

## 10. Z-fighting nos Pokémon (cachecol do Slowking de Galar, asas, folhas, penas) — FEITO

**Causa.** Cubos de espessura zero (planos) nas geometrias: 32.741 cubos em 1.218 geometrias de entidade. No Java
o `RenderType.entityCutout/entityTranslucent` descarta a face de trás: cada lado mostra só a sua face. Os
materiais de entidade usados aqui (`entity_alphatest`, `entity_alphablend`, `entity_emissive_alpha`) desenham as
duas faces no MESMO plano, com texturas diferentes (outra região da textura) → piscam.
**Por que não o material de um lado.** A lista de materiais vanilla (bedrock.dev) não tem material de entidade com
recorte + descarte de face de trás (`entity_emissive_alpha_one_sided` usa o alfa como brilho, não como recorte) e
material próprio (`materials/*.material` no RP) não é confiável com o RenderDragon — sem cliente para medir, o risco
seria a entidade sumir. Colapsar num plano de uma face mudaria o lado de trás (a face da frente espelhada).
**Correção.** `zfight.ts/thickenFlatEntityCubes`, pós-passe `fixEntityFlatPlanes` no fim do import (todas as
geometrias em `models/entity`: Pokémon, NPC, bolas, exibições, vestíveis): o plano ganha `inflate` +0,025 px
(espessura 0,05 px). As duas faces se separam; de cada lado a face daquele lado fica na frente e a outra atrás,
escondida pela profundidade — como o Java. A UV não muda (inflate não mexe na UV); o plano cresce 0,025 px de cada lado
(1/40 de texel) e as bordas viram faixas de 0,05 px. Todos os planos sobem o mesmo tanto, então a ordem dos planos
empilhados (os 0,01 do `separateCoplanarCubes`) continua. Nenhum osso novo nem mudança de material/animação.
**Regra.** `validateVariables.ts` §3: nenhum cubo com uma dimensão 0 e espessura (2 × inflate) abaixo de 0,05 px em
geometria de entidade (gerada ou à mão).
**Prova.** Validate 0 (antes 1.206 geometrias acusadas). Conferência de 31 espécies contra o upstream (origin, size,
uv, pivot, rotation e mirror idênticos; só o inflate muda, exatamente +0,025 nos planos; faces opostas do mesmo cubo
no mesmo plano → 0): slowpoke/slowbro/slowking de Galar (7→0, 23→0, 30→0), slowking, pidgey, pidgeotto, pidgeot,
spearow, fearow, hoothoot, noctowl, rowlet, dartrix, decidueye, talonflame, corviknight, oddish, vileplume,
bellossom, bulbasaur, ivysaur, venusaur, chikorita, meganium, sunflora, leafeon, skiploom, jumpluff, tropius,
charizard, pikachu (cap): 31/31 ok.
**Efeito colateral medido.** O resumo informativo do validate "Pokémon: N par(es) no mesmo osso" sobe de ~330 para
5.193: são faixas onde planos encostados passam a se sobrepor pelos 0,025 px do inflate (3.870 com um lado ≤ 0,1 px;
o resto também de 0,05 px de largura, ex. pidgey `chest_tuff` #0/#3, área 0,25 px² = 5 px × 0,05 px). Invisível na
prática (1/20 de texel); não é regra de erro.

## Verificação

- `npm run import`: OK (base + MSD). Contadores novos no `import-report.json`: "z-fighting: cubos planos de entidade
  com espessura (inflate)" 32.741, "client entities com variáveis inicializadas no pre_animation" 1,
  "partículas: variáveis lidas sem definição com padrão no creation_expression" 325.
- `npm run validate`: `OK: nenhum erro` no base e no base + MSD, com as regras novas (1.040/1.364 partículas,
  1.008/1.084 client entities, 1.257/1.511 geometrias de entidade conferidas). Antes das correções: 2.596 erros.
  `COBBLEMON_VALIDATE_ALL=1` lista todos; o validate agora usa `process.exitCode` (com `process.exit` a lista
  longa era cortada no pipe).
- `npx tsc -p tsconfig.json`: 0 erros.
- `npm test`: todos passam, incluindo `tests/cliente-teste3-log.test.ts` (11 testes).
- BDS `cobblemon-bds-log3` (porta 19180, `dist-log3`, RakNet, online-mode=false): ver "Rodadas no BDS" abaixo.
- `cobblemon-bds` (orquestrador) não foi tocado. Nenhum commit.

## Rodadas no BDS

Build final (`dist-log3`, import com todas as correções), `cobblemon-bds-log3`:

- `tests/e2e/experimental/cliente-teste3-log-selftest.e2e.mjs` (bot): **selftest `movement`** (todas as montarias):
  `montarias 108/108, 0 derrubada(s) pelo motor`, 0 falhas, área limpa (antes da correção, no mesmo servidor:
  `106/108, 2 derrubada(s): garchomp LIQUID (-), drampa LIQUID (-)` — igual ao cliente; e ainda 2 derrubadas com só o
  `buoyant` e com `breathes_water: true`). **Selftest `quick`**: terminou em 3 min 51 s, 0 falhas,
  `verificação: área 0 bloco(s) não-ar, 0 entidade(s)`, montarias 3/3. Nenhuma linha de `LocationInUnloadedChunkError`,
  `[spawn] passe lento` ou "unknown variable" no log. 1/1.
- `tests/e2e/experimental/cliente-teste3-log.e2e.mjs` (bot): 6 teleportes de 700–2.000 blocos (chegada em chunk sem
  carregar, spawner e scripts por jogador rodando) → 0 `LocationInUnloadedChunkError`; Garchomp afundado na piscina
  (`tp` para o fundo) + montar pelo menu → montado os 15 s, estilo LIQUID. 1/1 (a única linha WARN/ERROR é o
  `No targets matched selector` do preparo do harness).
- **E2E base** (`COBBLEMON_MSD=0 node tools/e2e/run.mjs`): **10/10**.
- Content log do servidor com o build final (`tools/client-log-summary.mjs`): só 5 `[Scripting][warning]`
  `FormRejectError: Player quit before responding` de bots saindo com troca/diálogo aberto (ruído conhecido do
  harness); tabela desta frente toda em 0. O BDS não carrega o RP: as linhas de Molang/ícone da tabela só zeram no
  cliente; aqui a prova delas é o `npm run validate`.
- Container removido (`docker rm -f cobblemon-bds-log3`).

## Arquivos

- Novos: `tools/importer/molangVars.ts`, `tools/importer/validateVariables.ts`, `tests/cliente-teste3-log.test.ts`,
  `tests/e2e/experimental/cliente-teste3-log.e2e.mjs`, `tests/e2e/experimental/cliente-teste3-log-selftest.e2e.mjs`.
- Importador: `particles.ts`, `entities.ts` (gimmick no pre_animation; `behavior.float` no `move_ai`; buoyant), `posers.ts` (quirks), `molang.ts`
  (colagem), `javaModels.ts` (ícone), `zfight.ts` (planos), `index.ts` (pós-passes), `validate.ts`,
  `validateContent.ts`, `msdDynamax.ts` (privado).
- Scripts: `adaptacoes/decoratedPot.ts`, `custom_components/RedstoneEvents.ts`, `world/StructureRegistry.ts`,
  `fishing/FishingController.ts`, `fishing/PokeRods.ts` (comentário).
- RP à mão: `particles/fishing/fishing_line.particle.json`.
- Ferramenta: `tools/client-log-summary.mjs` (tabela da frente).

## Observação

Um `node tools/e2e/run.mjs --help` sem as variáveis desta frente começou o build padrão do E2E em `dist-e2e` (o
runner não tem `--help`); foi interrompido antes de subir container (`cobblemon-bds-e2e` não existe). `dist-e2e` ficou
com um build completo da árvore atual — o mesmo que um `npm run test:e2e -- --deploy` faria.
