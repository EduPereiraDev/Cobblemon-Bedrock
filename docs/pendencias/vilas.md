# Frente vilas

Peças que o Cobblemon 1.8.2 injeta nas vilas vanilla (Pokécenter, mini-habitats e fazendas de berries) no Bedrock, e as
portas do Cobblemon nas estruturas (rodada vilas2 no fim do arquivo).

## Status

| Item | Status | Nota |
|---|---|---|
| Injeção nos pools da vila vanilla | NÃO POSSÍVEL NO BEDROCK | Vilas são jigsaw legado (pesquisa 8 §12: "cannot be modified via JSON"). |
| Pokécenter por bioma (5) | FEITO (adaptação) | Estrutura jigsaw própria `cobblemon:village_pokecenters_<bioma>`, mesma densidade das vilas do bioma. |
| Mini-habitats por bioma (5 × 6 moldes) | FEITO (adaptação) | Estrutura jigsaw própria `cobblemon:village_habitats_<bioma>` (pool com os 6 moldes, peso 1 cada), densidade = vilas × mini-habitats por vila. |
| Registro no StructureRegistry | FEITO | Marcador em cada peça (pipeline jigsaw); os 20 ids estão em `STRUCTURE_IDS` (fim da tabela: índices antigos preservados; as 10 fazendas depois das 10 primeiras). |
| Evitar sobrepor vilas vanilla | NÃO POSSÍVEL NO BEDROCK | O `minecraft:structure_set` do BDS 1.26.52 só lê `salt`/`separation`/`spacing`/`spread_type`: o binário não tem as chaves `exclusion_zone`/`other_set`/`chunk_count` (strings do schema `JigsawStructureSet` v1_21_20); o importador já descartava a exclusion zone de `ruins/avoid_villages`. Probabilidade de cair em vila é baixa (1 das 10 visitadas). |
| Pokécenter por script junto de vila nova | DESLIGADO por padrão | `scripts/world/Villages.ts`: `pokecentersEnabled()` só com `cobblemon:village_pokecenters = true` (`/scriptevent cobblemon:village_pokecenters on`). O detector `#minecraft:village` continua ativo. |
| Fazendas de berries (`addBerryFarms` do Kotlin) | FEITO (adaptação) | Rodada vilas2: estrutura jigsaw própria `cobblemon:village_berry_farms_<bioma>_<small\|large>` (10), densidade = vilas × E[fazendas por vila] / 2; `crop_to_berry` em 15 variantes (uma por par). |
| Portas do Cobblemon nas estruturas | FEITO | Rodada vilas2: `bedrockStateFor` usa a metade de cima (`half=upper`) e a direção/abertura do molde; os Pokécenters saem com 100 % dos blocos. Porta de dobradiça direita sai como a esquerda (única no Bedrock do mod). |

## Conta de frequência

### Java

- Vilas: structure_set `minecraft:villages`, `random_spread` linear, spacing 34, separation 8. Uma tentativa por região
  de 34 × 34 chunks, no ponto sorteado; a vila do tipo T nasce se o bioma do ponto é de T (fração f_T do mundo).
  Densidade das vilas do tipo T = f_T / 34² por chunk.
- Pool `village/<bioma>/houses` (JSON do Cobblemon, que sobrescreve o vanilla) + `CobblemonStructures.registerJigsaws`:

| Bioma | Casas vanilla | Vazio | Pokécenter | Fazendas de berries | Mini-habitats |
|---|---|---|---|---|---|
| desert | 201 | 5 | 2 × 150 + 36 = 336 | 2 × 2 = 4 | 6 × 1 |
| plains | 304 | 10 | 336 | 4 | 6 |
| savanna | 304 | 5 | 336 | 4 | 6 |
| snowy | 186 | 6 | 336 | 4 | 6 |
| taiga | 210 | 6 | 336 | 4 | 6 |

  `addBuildingToPool` repete a peça `weight` vezes e ainda faz um `pool.elements.add(piece)` a mais, então o Pokécenter
  do Kotlin (peso 35) vira 36 entradas na lista sorteada e cada fazenda (peso 1) vira 2.
- `StructurePoolGeneratorMixin`: grupo "pokecenter" no máximo 1 por vila, "berry_farm" no máximo 2 (quando o limite
  chega, as entradas saem da lista). Mini-habitats não têm limite.
- Cada conector de casa sorteia da lista embaralhada (cada elemento repetido pelo peso); o vazio encerra o conector sem
  peça. Contando só as peças que nascem, cada peça é um elemento não vazio com probabilidade peso / soma.

### N (peças de casa por vila)

Uma vila vanilla (jigsaw size 6, `max_distance_from_center` 80) tem tipicamente de 6 a 14 peças do pool de casas
(casas, oficinas, fazendas, currais, pontos de encontro). Adotado **N = 10** (meio da faixa); `HOUSE_PIECES_PER_VILLAGE`
em `tools/importer/villages.ts`. O viés de encaixe (peças grandes falham mais que os mini-habitats de 7×7) foi ignorado.

### Resultado (`villagePieceOdds`, programação dinâmica exata; conferida por um DP independente em Python)

Chance de um sorteio ser mini-habitat: 6/547 (desert), 6/650 (plains, savanna), 6/532 (snowy), 6/556 (taiga) enquanto o
Pokécenter está na lista, e 6/211, 6/314, 6/314, 6/196, 6/220 depois que ele sai.

| Bioma | N | P(0) | P(1) | P(2+) | E[mini-habitats/vila] | P(Pokécenter) |
|---|---|---|---|---|---|---|
| desert | 6 / **10** / 14 | 86,6 / **77,1** / 68,7 % | 12,7 / **20,3** / 26,2 % | 0,8 / **2,5** / 5,1 % | 0,142 / **0,256** / 0,370 | 0,997 / **0,9999** / 1,000 |
| plains | 6 / **10** / 14 | 90,8 / **84,1** / 77,8 % | 8,9 / **14,7** / 19,7 % | 0,4 / **1,2** / 2,5 % | 0,096 / **0,172** / 0,248 | 0,987 / **0,9993** / 1,000 |
| savanna | 6 / **10** / 14 | 90,8 / **84,1** / 77,8 % | 8,9 / **14,7** / 19,7 % | 0,4 / **1,2** / 2,5 % | 0,096 / **0,172** / 0,248 | 0,987 / **0,9993** / 1,000 |
| snowy | 6 / **10** / 14 | 85,6 / **75,6** / 66,7 % | 13,5 / **21,5** / 27,4 % | 0,9 / **2,9** / 5,8 % | 0,153 / **0,276** / 0,398 | 0,998 / **1,000** / 1,000 |
| taiga | 6 / **10** / 14 | 87,1 / **78,0** / 69,8 % | 12,2 / **19,7** / 25,4 % | 0,7 / **2,4** / 4,8 % | 0,137 / **0,246** / 0,355 | 0,996 / **0,9999** / 1,000 |

### Tradução para o structure_set do Bedrock

Cada peça vira uma estrutura com structure_set próprio (`random_spread` linear, sal estável por id) e o filtro de bioma
da variante de vila (`#minecraft:has_structure/village_<bioma>`: plains+meadow, desert, savanna, snowy_plains, taiga,
nos ids do Bedrock). O filtro de bioma faz o papel do f_T, então basta igualar as densidades por região:
`f_T / S² = f_T × q / 34²` → **S = 34 / √q**, com q = peças por vila (P(Pokécenter) ou E[mini-habitats]). A separação
mantém a proporção 8/34 do Java e respeita a regra do Bedrock (`separation < spacing / 2`).

| Estrutura | q (N = 10) | spacing | separation | Densidade relativa às vilas do bioma |
|---|---|---|---|---|
| `village_pokecenters_<bioma>` (5) | 0,999–1,000 | 34 | 8 | 1,000 |
| `village_habitats_desert` | 0,256 | 67 | 16 | 0,258 |
| `village_habitats_plains` / `_savanna` | 0,172 | 82 | 19 | 0,172 |
| `village_habitats_snowy` | 0,276 | 65 | 15 | 0,274 |
| `village_habitats_taiga` | 0,246 | 69 | 16 | 0,243 |

Aproximações: (1) no Java 2+ mini-habitats podem sair na mesma vila; aqui a densidade total é igual, mas cada um é
isolado; (2) o Bedrock não tem exclusion zone, então os pontos são independentes das vilas; (3) com N = 6 ou 14 os
espaçamentos dos mini-habitats seriam 87–110 ou 54–68 (a tabela acima mostra a sensibilidade); (4) no Java a peça fica
dentro da vila, ligada à rua; aqui fica sozinha no terreno.

## Mudança

- `tools/importer/villages.ts` (novo): pesos do pool de casas (JSON + constantes de `CobblemonStructures.kt`), DP das
  peças por vila, espaçamento equivalente e as 10 definições sintéticas (estrutura Java-like + pool + structure_set).
  Estrutura: `size` 1, `step` surface_structures, `start_height` −1 com `WORLD_SURFACE_WG` (camada 0 do molde, a
  fundação/caminho, no nível do chão, como a rua da vila), `terrain_adaptation` `beard_thin` (o das vilas), peças
  `single_pool_element` rígidas com os processadores do JSON (`pokecenter_mossy` em plains/taiga,
  `habitats/abandoned_village_<bioma>` nos mini-habitats: 10 % musgo, ouro → ar, 9 dos 10 blocos de habitat viram grama).
- `tools/importer/jigsaw.ts`: `JigsawSource.addPool` (pool sintético), as definições entram em `defs` antes da coleta e
  os structure_sets saem no passo 4. Tudo o mais (peças, marcadores, `STRUCTURE_IDS`, `HABITAT_ANCHOR_RANGES`) é o
  pipeline existente. Import: 75 estruturas jigsaw (+10), 1.214 peças, 224 pools, 19 structure sets (+10).
- `tools/importer/worldgen.ts`: tags vanilla `has_structure/village_<bioma>` na tabela de tags de bioma.
- `scripts/world/Villages.ts`: Pokécenter por script desligado por padrão (chave `cobblemon:village_pokecenters`);
  liga a sonda.
- `scripts/world/villagesProbe.ts` (novo): `/scriptevent cobblemon:vilas_probe <x> <z> [raio]` despeja no log os blocos
  não naturais, a altura do chão e as estruturas registradas (só com o scriptevent; `system.runJob`).
- `tests/vilas.test.ts` (novo, 6 testes).

## Evidência no BDS (`cobblemon-bds-vila`, 1.26.52.3, mundo novo, bot E2E conectado)

`/locate structure` (do spawn) acha as 10:

| Estrutura | Local | Distância |
|---|---|---|
| `cobblemon:village_pokecenters_plains` | 647, −708 | 959 |
| `cobblemon:village_pokecenters_desert` | 204, 1210 | 1227 |
| `cobblemon:village_pokecenters_savanna` | 666, 218 | 700 |
| `cobblemon:village_pokecenters_snowy` | −2491, 3638 | 4409 |
| `cobblemon:village_pokecenters_taiga` | 87, −1477 | 1479 |
| `cobblemon:village_habitats_plains` | 1837, 3325 | 3798 |
| `cobblemon:village_habitats_desert` | 8781, −5037 | 10123 |
| `cobblemon:village_habitats_savanna` | 3603, −2301 | 4275 |
| `cobblemon:village_habitats_snowy` | −3380, 4180 | 5375 |
| `cobblemon:village_habitats_taiga` | 3789, 1235 | 3985 |

Visitas (bot teleportado + ticking area; sonda despeja os blocos; casamento offline com o molde nas 4 rotações):

| Estrutura | Molde casado | Blocos do molde | Rotação | Camada 0 × chão em volta (mín/mediana/máx) | Registro |
|---|---|---|---|---|---|
| pokécenter savanna | `village_savanna_pokecenter` | 485/489 (99,2 %) | 180° | 77 × 72/77/80 | `cobblemon:village_pokecenters/savanna` (+ `minecraft:village`) |
| pokécenter plains | `village_plains_pokecenter` (mossy) | 551/555 (99,3 %) | 270° | 126 × 106/126/128 | `cobblemon:village_pokecenters/plains` |
| pokécenter desert | `village_desert_pokecenter` | 531/541 (98,2 %) | 180° | 61 × 47/61/68 | `cobblemon:village_pokecenters/desert` |
| pokécenter taiga | `village_taiga_pokecenter` (mossy) | 784/788 (99,5 %) | 270° | 100 × 100/100/110 | `cobblemon:village_pokecenters/taiga` |
| pokécenter snowy | `village_snowy_pokecenter` | 520/522 (99,6 %) | 0° | 61 × 62/62/62 (camada de neve) | `cobblemon:village_pokecenters/snowy` |
| mini-habitat plains | `village_plains2` | 153/153 (100 %) | 180° | 61 × 35/60/70 | `cobblemon:village_habitats/plains` |
| mini-habitat savanna | `village_savanna6` | 96/96 (100 %) | 0° | 68 × 68/68/69 | `cobblemon:village_habitats/savanna` |
| mini-habitat taiga | `village_taiga3` | 85/85 (100 %) | 90° | 65 × 65/65/71 | `cobblemon:village_habitats/taiga` |
| mini-habitat snowy | `village_snowy5` | 63/74 (85,1 %) | 90° | 61 × 62/62/62 | `cobblemon:village_habitats/snowy` |
| mini-habitat desert | `village_desert1` | 99/99 (100 %) | 90° | 80 × 79/80/85 | `cobblemon:village_habitats/desert` |

- Os blocos que faltam nos Pokécenters são só `cobblemon:apricorn_door_bottom_left` (ver pedido abaixo). No
  mini-habitat de neve faltam 11 `coarse_dirt` da camada do chão, que viraram areia do terreno local
  (`testforblock -3380 62 4178` → "Sand"); os 63 blocos construídos batem.
- Sobreposição: 9 das 10 sem nenhum bloco de vila vanilla na caixa ±2; o Pokécenter de savana (666, 218) caiu dentro de
  uma vila (a 33 blocos do centro dela, farmland na caixa). É a limitação da falta de exclusion zone.
- Pokécenter por script: nenhum Pokécenter extra junto da vila de savana (a chave está desligada).
- Log: nenhum ERROR/WARN de conteúdo, worldgen ou script da frente. Só o aviso de transporte do raknet, os
  `testforblock` que eu mandei pelo console (saem como ERROR quando o bloco não bate) e `[spawn] passe lento` (frente
  spawn, com o bot em área nova). Container removido (`docker rm -f cobblemon-bds-vila`).

## Pedido para outra frente (importador de blocos, `tools/importer/blocks.ts`): RESOLVIDO na rodada vilas2 (abaixo)

As portas do Cobblemon nos moldes somem: `BlockBuilder.bedrockStateFor` usa sempre `out.placeBlock` (a metade de
baixo, `cobblemon:<madeira>_door_bottom_left`) e ignora `half=upper`, então o `.mcstructure` fica com duas metades de
baixo empilhadas e o componente que exige a metade de cima remove a porta. Afeta os Pokécenters (antes e agora) e
qualquer molde com portas do Cobblemon. Correção sugerida, no início de `bedrockStateFor`, depois de `const name =
out.placeBlock`:

```ts
// Porta: a metade de cima (half=upper) é outro bloco no Bedrock.
const name = props.half === "upper" && out.bedrockIds[1]?.endsWith("_door_top_left") ? out.bedrockIds[1] : out.placeBlock;
```

## Verificação

`npm run import` ok (10 peças de vila como estruturas próprias), `npm run validate` "OK: nenhum erro",
`npx tsc -p tsconfig.json` 0 erros, `npm test` com `tests/vilas.test.ts` (6 testes).

## Rodada vilas2: portas e fazendas de berries

### Gap e hipótese

- Portas: `bedrockStateFor("cobblemon:apricorn_door", {half: "upper", facing: "west"})` devolvia
  `apricorn_door_bottom_left` com `cardinal_direction: "south"`: metade de cima como a de baixo **e** `facing`/`open`
  ignorados (o `stateDefs` das portas era vazio). Nos moldes, a única peça de duas metades do Cobblemon é
  `apricorn_door` (72 blocos em 16 moldes; só os 5 Pokécenters de vila são usados: os 11 `villages/*/pokecenter` não
  são referenciados por nenhum pool, estrutura ou feature do 1.8.2). Alçapões já saíam certos (`facing`/`half`/`open`).
  O mesmo defeito de direção estava na `healing_machine` (em todo Pokécenter: sempre "south" e carga 0), no PC
  (`part=top` virava o bloco de baixo) e na apricorn (`facing`/`age`), estes dois fora dos moldes.
- Hipótese: um campo `upper` no `BlockOut` (bloco da metade de cima por estado Java) e `stateDefs` de `facing`/`open`
  (com conversão de valor opcional) resolvem tudo em `bedrockStateFor`, sem mexer no conversor de moldes.
- Fazendas: o `crop_to_berry` (`cobblemon:random_pooled_states`) não tem conversor, mas equivale a regras
  `random_block_match` encadeadas (que o conversor já aplica), uma lista por par.

### Mudança

- `tools/importer/blocks.ts`: `BlockOut.upper` (porta: `half=upper` → `<madeira>_door_top_left`; PC: `part=top` →
  `pc_top`); `StateDef.toBedrock` (valor Java → Bedrock quando a escala muda); `FACING_DEF`; `stateDefs` de
  `facing`/`open` nas portas, `facing` no PC, `facing`/`charge` na máquina de cura (carga Java 0..5 → 0..15, `charge=5`
  → 15) e `facing`/`age` na apricorn. `hinge` não existe no Bedrock (só `_left`): a porta de dobradiça direita sai
  como a esquerda (fechada ocupa o mesmo lugar; muda o lado da maçaneta).
- `tools/importer/villages.ts`: `berryFarmLocations` (moldes de `CobblemonStructureIDs.kt` citados em
  `CobblemonStructures.kt`), `cropToBerryVariants` (15 pares → 15 listas `rule`: cada cultivo de `#minecraft:crops`
  vira uma das 2 berries com idade 1..3, 1/6 cada, `generated=false`), `entranceStartHeight` (start_height = −y do
  jigsaw `building_entrance`: 0 na fazenda grande de neve, −1 nas outras), `villagePieceOdds` com
  `berryFarms`/`expectedBerryFarms`, e 10 estruturas `cobblemon:village_berry_farms/<bioma>_<small|large>` (`late`).
- `tools/importer/jigsaw.ts`: `JigsawSource.addProcessorList` (listas sintéticas `cobblemon:crop_to_berry_pair<n>`),
  estruturas `late` no fim de `STRUCTURE_IDS`.
- `tests/vilas.test.ts`: 9 testes (novos: fazendas por vila, `crop_to_berry` com a conversão real do molde, peças das
  fazendas geradas sem trigo e com marcador, portas e máquina de cura dos Pokécenters casando posição/metade/direção
  com o molde nas 10 cópias).
- `docs/PARIDADE-MECANICAS.md`: "Estado final" reescrito com a contagem real e a linha "Vilas do Cobblemon" atualizada
  (pedido explícito desta rodada).

### Conta das fazendas (N = 10; DP exato, conferido por DP com frações e Monte Carlo em Python)

O pool tem 4 entradas de fazenda (2 moldes × (1 + 1)), grupo `berry_farm` limitado a 2 por vila. Depois que o
Pokécenter (336 de ~650) sai da lista, cada sorteio tem ≈ 4/314 de ser fazenda.

| Bioma | P(0/1/2) | E[fazendas/vila] | E por molde | spacing | separation | N = 6 / 14 (spacing) |
|---|---|---|---|---|---|---|
| desert | 84,2 / 14,6 / 1,2 % | 0,1701 | 0,0850 | 117 | 28 | 156 / 97 |
| plains | 89,1 / 10,4 / 0,6 % | 0,1145 | 0,0572 | 142 | 33 | 190 / 118 |
| savanna | 89,1 / 10,4 / 0,6 % | 0,1145 | 0,0572 | 142 | 33 | 190 / 118 |
| snowy | 83,1 / 15,6 / 1,4 % | 0,1830 | 0,0915 | 112 | 26 | 151 / 94 |
| taiga | 84,8 / 14,1 / 1,1 % | 0,1632 | 0,0816 | 119 | 28 | 159 / 99 |

Uma estrutura por molde (pequena e grande têm o mesmo peso, então cada uma tem metade de E) porque as alturas de entrada
diferem (fazenda grande de neve: jigsaw em y = 0, fica 1 bloco acima do chão, como na rua do Java).

### Evidência

- Import: 85 estruturas jigsaw (+10), 1.364 peças (+150 = 10 moldes × 15 pares), 234 pools, 29 structure sets (+10);
  nenhum processador novo "sem equivalente".
- Todos os `.mcstructure` gerados (jigsaw, features, Pokécenters por script): 24 metades de baixo e 24 de cima de porta
  do Cobblemon, **0 pares quebrados**; os 5 Pokécenters (peça jigsaw e cópia por script) casam posição, metade e
  direção das portas e da máquina de cura com o molde Java (antes: 48 metades de baixo, todas "south").
- BDS `cobblemon-bds-vila2` (1.26.52.3, mundo novo, bot E2E): `/locate` acha as 10 fazendas:

| Estrutura | Local (locate) | Molde casado | Rotação | Camada 0 × chão em volta (mín/mediana/máx) | Berries | Registro |
|---|---|---|---|---|---|---|
| `berry_farms_plains_small` | 2, 3794 | 23/23 (100 %) | 0° | 69 × 69/69/69 | oran, cheri, pinap (*) | vazio no ponto central da sonda (as outras 9 registradas) |
| `berry_farms_plains_large` | 1490, 8499 | 23/23 (100 %) | 0° | 71 × 71/71/71 | pinap, oran | `village_berry_farms/plains_large` |
| `berry_farms_desert_small` | 4814, 4722 | 24/24 (100 %) | 0° | 71 × 71/71/73 | bluk, oran | `village_berry_farms/desert_small` |
| `berry_farms_desert_large` | 8658, −674 | 30/30 (100 %) | 270° | 66 × 66/66/66 | pinap, oran | `village_berry_farms/desert_large` |
| `berry_farms_savanna_small` | 6818, 11682 | 13/13 (100 %) | 0° | 62 × 62/64/68 | oran | `village_berry_farms/savanna_small` (+ `habitats/sandpit_clearing`) |
| `berry_farms_savanna_large` | 8029, −4542 | 27/27 (100 %) | 90° | 64 × 64/64/71 | persim, rawst | `village_berry_farms/savanna_large` |
| `berry_farms_snowy_small` | −1, 2669 | 25/25 (100 %) | 180° | 61 × 61/62/62 (camada de neve) | oran, cheri | `village_berry_farms/snowy_small` |
| `berry_farms_snowy_large` | −3570, −2254 | 25/25 (100 %) | 90° | 70 × 69/70/70 (1 acima do chão, como no Java) | oran, pinap | `village_berry_farms/snowy_large` |
| `berry_farms_taiga_small` | 2414, 4574 | 31/31 (100 %) | 180° | 78 × 77/78/88 | nanab, oran | `village_berry_farms/taiga_small` |
| `berry_farms_taiga_large` | 690, 627 | 34/34 (100 %) | 0° | 64 × 64/64/72 | persim, chesto | `village_berry_farms/taiga_large` |

  (*) A caixa de 25 × 25 da sonda pegou 15 berries de 3 tipos: a fazenda (5 cultivos, par oran/cheri) e berries de
  outra origem em volta. Casamento: blocos não naturais despejados pela sonda × o `.mcstructure` da peça, nas 4 rotações
  (berries comparadas como "berry"); nenhum trigo nas fazendas.
- Pokécenters (portas): `pokecenters/taiga` 788/788, `pokecenters/snowy` 522/522 e `pokecenters/desert` 541/541 blocos
  do molde (antes 99,5 %, 99,6 % e 98,2 %: os que faltavam eram as portas). `testforblock` pelo bot, depois de minutos
  com o chunk carregado (o componente que exige a outra metade teria removido a porta): taiga (rotação 270°) portas
  `south` e `west` nas duas metades e máquina de cura `north`; neve (90°) porta `north` nas duas metades e máquina
  `south`: exatamente a direção do molde girada pela rotação da peça (o Bedrock gira o `cardinal_direction` custom).
- Log: nenhum ERROR/WARN de conteúdo, worldgen ou script da frente. Só o aviso de transporte do raknet, 32
  "Cannot test for block outside of the world" (os meus `testforblock` pelo console, sem jogador perto) e
  `[spawn] passe lento` (frente spawn). **Uma queda** do BDS (23:40:50, "Crash", sem dump, content log vazio) na 1ª
  entrada do bot no mundo novo, antes do "Player Spawned"; não se repetiu em 4 entradas seguintes, inclusive com a
  mesma sequência de comandos e o mesmo destino, e os chunks do spawn foram regerados (mesma semente) sem queda, então
  não é determinística do worldgen. Fica anotada.
- Container removido (`docker rm -f cobblemon-bds-vila2`).

### Verificação

`npm run import` ok, `npm run validate` "OK: nenhum erro", `npx tsc -p tsconfig.json` 0 erros (e `tsc --strict` só em
`blocks.ts`/`villages.ts`/`jigsaw.ts`, 0 erros), `npm test` verde (`vilas: 9 testes ok`).
