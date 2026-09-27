# Pendências da frente "cliente-modelos"

Origem: primeiro teste em cliente real (Windows, Bedrock 26.x), content log
`ContentLog2026-09-27_05-17-38_1.txt` (151 mil linhas; pack montado de `dist/` de 26/09 21:29). O BDS não carrega o RP,
então nada disso aparecia no servidor. BDS próprio: `COBBLEMON_DIST=dist-cmod COBBLEMON_BDS=cmod COBBLEMON_BDS_PORT=19174
COBBLEMON_BDS_TRANSPORT=raknet` (container removido ao fim).

Resumo do log por categoria: `node tools/client-log-summary.mjs <ContentLog.txt>`. A seção "Frente cliente-modelos"
no fim da saída conta as categorias abaixo.

## Como foi medido o comportamento do Java

O Cobblemon lê Molang com o jar `upstream/cobblemon/deps/local/com/bedrockk/molang/1.1.20`. Rodei esse jar
(Docker `eclipse-temurin:21-jdk`) sobre as expressões do log:

- ele lê **uma** expressão por instrução e para no primeiro token que não continua a expressão. O resto é ignorado:
  `a)+b` vale `a`, `0.532.5-x` vale `0.532` e `cond: 1.0 ? 0.0` vale `cond`;
- um nome sem struct conhecido vale 0 (`NaN`, `sf`, `speed`, `walk`, `o`, `ath.sin(...)`, `s.sound(...)`);
- existe `+` unário, e `--x` vale `-(-x)`;
- a precedência é própria: `||` liga mais forte que `&&` (`1 && 0 || 1` = 1) e as comparações ficam num nível só.

Conferência: 216 expressões distintas mudam na conversão. Avaliei no jar a original e a corrigida em 5 valores de
`q.anim_time`: 215 deram iguais. A única diferente usa `math.random` (valor aleatório nos dois lados).

## Categorias

| # | Categoria (log) | Contagem no log | Causa | Correção | Prova |
|---|---|---|---|---|---|
| 1 | `[Animation][error] Precomputed cubic interpolation requires keyframes have constant data` | 18.060 linhas; 362 animações em 139 arquivos | Keyframes `lerp_mode: "catmullrom"` com Molang. O Bedrock recusa a animação inteira e ela não toca. O Java avalia o Molang dos 4 keyframes vizinhos a cada quadro e interpola a spline | `animationBake.ts` (chamado em `animations.ts` e em `actionEffects.ts` para as genéricas). Quando o canal só depende de `q.anim_time` (2.481 canais), a curva é amostrada com a mesma fórmula do Java (porte de `BedrockKeyFrameBoneValue.resolve`/`catmullromLerp`/`getPointOnSpline`). Viram keyframes numéricos lineares, com subdivisão adaptativa: tolerância de 0,1° / 0,01 px / 0,001; passo entre 1/480 s e 1/8 s; sondas em frações irregulares para não perder oscilações. Canal que depende de `v.*` ou `math.random` (12 canais: altaria, corviknight) vira linear e mantém o Molang. Com um keyframe só, o `lerp_mode` sai | Regra 1 no validate. Contra o `dist/` do teste: 2.498 canais em 197 arquivos. Cobre as 362 animações do log; as outras 157 são animações que não tocaram na sessão (faint, cry, special). Depois: 0. Curva gerada × curva do Java em 2.564 canais (750 mil pontos a cada 0,01 s): erro máximo de 1,26° e 0,92 px, só em oscilações acima de 20 Hz (porygon-z, weezing), limitado pelo passo mínimo. O teste do goldeen `ground_walk` fica abaixo de 0,15°. Tamanho: animations/pokemon passou de 39 MB para 47 MB (sem compressão) |
| 2 | `[Molang][error]` em animações: `nan-…`, `unrecognized token: speed*N…`/`sf…`/`walk`/`o`, `binary Add '+' operator at end`, `found multiple operations…`, `Unable to find matching closing section`, `Unexpected Comma`, `stack depth` | 1.712 linhas; 462 expressões em 74 arquivos (+2 no `pre_animation` do metagross) | Quase tudo vem do Cobblemon: expressões quebradas que o parser do Java tolera. Não é NaN do conversor: a fonte tem literalmente `NaN-…`. Outras causas: condição de pose `…: 1.0 ? 0.0` (metagross) e `…'` (orthworm); cadeia de 263 ternários na âncora do item do raichu | `molangSyntax.ts`: parser estrito do Bedrock (`checkBedrockMolang`) e parser tolerante do Java (`javaMolangToBedrock`). Se o Bedrock já lê a expressão igual ao Java, o texto fica. Senão, a árvore do Java é reimpressa com parênteses explícitos: nome desconhecido vira 0, o lixo final sai, `+` unário sai e a precedência do Java fica garantida. Aplicado aos ossos e à timeline (`animations.ts`), às condições de pose (`posers.ts`, que antes trocava a condição malformada por `0.0`) e às genéricas. `mundoDetalhes.perVariant` passou a fazer busca binária em `v.cobblemon_variant` (profundidade log2 n) | Regra 2 no validate: todo Molang de animações, controllers, render controllers e client entities (183 mil expressões na base, 227 mil com o MSD). Aninhamento limitado a 224 (unown aceito = 222 nesta contagem; raichu recusado = 526). Contra o `dist/`: 358 expressões recusadas em 74 arquivos de animação, **exatamente os 74 do log** (nenhum a mais, nenhum a menos). Depois: 0 |
| 3 | `[Geometry][error] … Locator: Error: model already has a locator X that doesn't exactly match…` | 1.502 linhas (751 distintas) em 79 entidades | O cliente junta os locators de todas as geometrias da client entity (g0, g1...) por nome e descarta o repetido diferente. Resultado: a forma regional usava a posição da forma base. Também há repetição dentro da mesma geometria (ho_oh `tail_feathers`, magnezone `seat_1`) | `locators.ts`. Na ordem g0, g1..., o locator repetido e diferente ganha o nome `<nome>_<geometria>` (734 renomeados). `index.ts` grava as geometrias depois de conhecer todas as da espécie; `npcs.ts` faz o mesmo nas skins. Os olhos do Alfa (`visualFinal`) já leem os nomes novos: zorua g1 usa `eye1_zorua_hisuian`. O item segurado não muda, porque as âncoras são ossos criados antes da troca. Nenhuma `particle_effects` de animação usa um locator renomeado (conferido). `armor_offset.default_neck` (36 linhas) não está nos .geo: o cliente cria sozinho para modelos com osso `head`. Ele agora é declarado igual (`root_part`, origem) em todas as geometrias com `head` das entidades com mais de uma forma (369 geometrias) | Regra 3 no validate, entre geometrias e dentro de uma geometria. Contra o `dist/`: 734 violações em 79 entidades, **as mesmas 79 do log**. Depois: 0. O `armor_offset.default_neck` não dá para conferir sem o cliente: **confirmar no próximo content log** |
| 4 | `[Geometry][error] cobblemon:flabebe \| geometry not found?`, `flabebe.geo.json … Required child identifier not found`, `[Molang][error] friendly name 'geometry.g0' not found…` | 14 linhas de geometria (6 do flabebe, 8 dos barcos) e 48 do `geometry.g0` | O identificador `geometry.flabébé` (com acento) reprova o arquivo. A client entity fica sem geometria e o render controller cita `geometry.g0`, que não existe mais na lista (as texturas t0..t8 da lista são as do flabebe) | `models.ts`: identificador fora de `[A-Za-z0-9_.-]` vira `geometry.<arquivo sem acento>` (`geometry.flabebe`). A regra `GEOMETRY_ID` está em `locators.ts` | Regra 4 no validate: identificador válido e render controller que cita `geometry.X` não declarada na client entity. Contra o `dist/`: 1 (flabebe). Depois: 0 |
| 4b | `friendly name 'geometry.default' not found (geometry.:texture.default:material.default)` e `geometry not found?` dos barcos | 8 + 8 linhas | Entidades de barco (`resource_packs/.../entity/boats`) | **Escopo da frente cliente-log** (barcos). A regra 4 do validate também acusa esse caso; hoje dá 0 | — |
| 5a | `[Animation][error] … states \| X \| animations \| Required child  not found` (+ `[inform] valid options`) | 44 linhas: 22 estados em 19 arquivos (weezing `battle_sleep`, weezing_galar `sleeping`, tauros `sleep`...) | Estado de pose sem animação gerava `"animations": []`, e o cliente exige ao menos um filho | `posers.ts` (estados de pose) e `npcs.ts` (piscar) omitem a chave quando a lista está vazia | Regra 5 no validate. Contra o `dist/`: 22. Depois: 0 |
| 5b | `bones \| sound_effects \| 0.0 \| child '0.0' not valid here`, `bones \| _&/3%6-7A \| child … not valid here` | 4 linhas (gumshoos `cry`, hoppip `unamused`) | Erro da fonte: `sound_effects` escrito dentro de `bones` e osso com nome de lixo. O Java lê os dois como ossos inexistentes e não faz nada (o grito do gumshoos também não toca no Java) | `animationBake.fixBones` remove ossos com nome fora de `[A-Za-z0-9_.-]` e chaves de osso que não são position/rotation/scale/relative_to | Regra 5 no validate. Contra o `dist/`: 2. Depois: 0 |

## Validação (`npm run validate`)

`tools/importer/validateClientModels.ts` entra no `validate.ts` com uma linha. Ele roda na árvore base e também na
árvore efetiva com o MSD (`validateMsd.ts`), e imprime `Cliente (modelos): molang …, animations …`.

- Base: `molang 183556, animations 12958, controllers 2290, renderControllers 2007, entities 931, geometries 2133`, com
  0 violações.
- Base + MSD: `molang 226974, animations 15105, …`, com 0 violações.
- Os pacotes montados (`dist-cmod/resource_packs/CobblemonBedrock` e `CobblemonMegaShowdown`) também dão 0 nas 7 regras.

## Verificação final

- `npm run import`: OK.
- `npm run validate`: `OK: nenhum erro` (base e MSD).
- `npx tsc -p tsconfig.json`: 0 erros. Os módulos novos do importador também passam no tsc `--strict`.
- `npm test`: todos passam, incluindo `tests/cliente-modelos.test.ts`. Esse teste cobre:
  - o parser estrito sobre as 15 formas do log;
  - Java→Bedrock com o valor conferido;
  - o pré-cálculo da curva contra a fórmula do Java (sintético e goldeen real);
  - locators e âncora com busca binária;
  - o validador acusando cada regra;
  - `generated/` corrigido.
- BDS `cmod` (raknet, com o pack MSD): subiu com content log no console e sem nenhum ERROR/WARN de conteúdo ou
  script. O único ERROR é o aviso de transporte `TRANSPORT TYPE ERROR`, esperado com `COBBLEMON_BDS_TRANSPORT=raknet`.
  Container removido.

## Arquivos

- Novos: `tools/importer/molangSyntax.ts`, `animationBake.ts`, `locators.ts`, `validateClientModels.ts` e
  `tests/cliente-modelos.test.ts`.
- Alterados: `animations.ts`, `posers.ts`, `models.ts`, `npcs.ts` e `index.ts` (as geometrias da espécie agora são
  gravadas juntas, depois dos combos).
- Fora da lista original da frente, com uma linha comentada em cada um:
  - `mundoDetalhes.ts`: `perVariant` com busca binária;
  - `actionEffects.ts`: `fixBones` nas animações genéricas;
  - `validate.ts`: gancho do validador.
- `tools/client-log-summary.mjs` (da frente cliente-log): só uma seção acrescentada no fim.

## Pedidos a outras frentes / observações

- **cliente-log (partículas):** o log tem erros de Molang em partículas do Cobblemon. Exemplos: `-(v.entity_radius*0.7))`,
  `math.clamp(…,0.55,1.05)-(…),0.75,1.35)` e `math.max(1.65,…))`. São os mesmos padrões da fonte e o Java também os lê
  truncando. `javaMolangToBedrock(expr, false)` (em `molangSyntax.ts`) dá o valor do Java em sintaxe do Bedrock, e
  `checkBedrockMolang(expr)` serve para o validate das partículas. Não mexi em `particles.ts`.
- A precedência do Java (`||` acima de `&&`) agora vale para todo Molang de animação e de condição de pose convertido.
  Só 3 condições de pose mudaram de fato (metagross e orthworm, pelo lixo no fim).
- Pendente de confirmar no próximo teste em cliente: o `armor_offset.default_neck` fixo (categoria 3). Se o cliente
  ainda acusar, a saída é tirar o `pinArmorNeckLocator` (em `models.ts`).
