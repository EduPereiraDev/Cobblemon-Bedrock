# Frente "habitat-mimic"

Bug de imersão (cliente real, beta 6): nas estruturas de habitat (ex.: torre de "Afloramento Rochoso"), o bloco de
habitat aparecia com a textura técnica no meio da construção e qualquer jogador que clicava abria o "Editor de Habitat".

Arquivos da frente: `scripts/machines/habitat.ts`, `scripts/spawning/Habitats.ts`, `scripts/machines/index.ts` (1 linha:
`startHabitats` dentro de `startMachines`), `tools/importer/structures.ts`, `tools/importer/blocks.ts`,
`tools/importer/habitats.ts`, `tools/importer/index.ts` (2 linhas), `tests/habitat-mimic.test.ts`,
`tests/e2e/experimental/habitat-mimic.e2e.mjs` e 1 asserção de `tests/mundo-final.test.ts` (abaixo).
Sem mudança em `scripts/main.ts`, `scripts/commands.ts` nem nos `.lang` (sem textos novos).

## Regra do Java (Cobblemon 1.8.2)

- `HabitatBlock.getRenderShape = INVISIBLE`; `HabitatBlockRenderer` desenha o **bloco imitado** (`mimickedState`,
  "Mimic Block ID" do block entity). Só quem segura o item de habitat (mão principal, senão a secundária) vê o próprio
  bloco de habitat e a "gaiola" com o Pokémon e as partículas de fumaça/chama.
- Imitado padrão do `HabitatBlockEntity`: `minecraft:stone` (`mimicId = BLOCK.getKey(Blocks.STONE)`, e é o fallback
  se o id salvo não existir).
- `useWithoutItem` só chama `onUse` se `player.canUseGameMasterBlocks()` (= criativo **e** nível de permissão ≥ 2,
  operador); `onUse` ainda exige `isCreative`. Resto: `PASS` (interação normal).
- `getDrops`: criativo não solta nada; senão solta `ItemStack(bloco imitado)` (o item do bloco, não o drop vanilla dele).
- Colisão/seleção/visual: cubo cheio; força 1,5 e resistência a explosão de obsidiana; `PushReaction.BLOCK`.

## Abordagem (opção a — o próprio bloco imitado no mundo + registro por posição)

- **Importador**: a âncora de cada molde/peça (o único bloco de habitat que continua técnico; os outros já viravam o
  imitado) ganha o estado `cobblemon:habitat_mimic` (0–3) = índice do seu bloco imitado em
  `HABITAT_ANCHOR_MIMICS[pool]` (novo em `generated/scripts/habitats.ts`; 51 pools, no máximo 3 imitados distintos por
  pool, mapeados Java → Bedrock pelo mesmo `BlockMapper` dos outros blocos: `snow_block` → `minecraft:snow`, folhas com
  `persistent_bit`, toras com eixo y). A escolha da âncora evita imitado com gravidade (areia/cascalho) sem apoio, porque
  a âncora vira esse bloco no mundo e cairia.
- **Conversão** (`convertHabitatBlock`): no 1º tick (tick agendado no molde; `onRandomTick` como reserva), na colocação
  pelo item e em blocos antigos de mundos existentes (o `minecraft:tick` em loop continua neles), o bloco técnico vira o
  **próprio bloco imitado** e o habitat vai para o registro por posição (`MachineStore("habitat")`, dynamic property do
  mundo). Âncora de estrutura grava compacto (`{preset:"structure", poolId, mimicId[, mimicStates]}`); o resto da
  configuração vem de `structureSettings`. Item do op sem configuração = padrão do Java (ativado, pool vazio, pedra).
  Âncoras antigas sem o estado novo usam o 1º imitado do pool. Id de imitado inválido → pedra.
- **Vida do habitat**: vale enquanto a posição tiver o imitado, o técnico ainda não convertido ou a forma em que o imitado
  vira sozinho no Bedrock (grama/micélio/podzol → terra, terra → grama/micélio, nylium → netherrack, lama → argila).
  Bloco trocado (explosão, pistão, `/setblock`) sai do registro e do registro salvo na próxima conferência do detector.
- **Ativados** (op): o laço global renova a cada 10 ticks os ativados de chunk carregado (gatilho TICK, limpeza dos ids).
- **Quem segura o item de habitat**: contorno de partículas (`basic_flame_particle` nos 8 cantos + 12 arestas, fumaça no
  topo) a cada 10 ticks, só para esse jogador (`player.spawnParticle`), até 24 habitats a 48 blocos.
- **Editor**: `beforeEvents.playerInteractWithBlock` num habitat imitado abre o editor só com criativo + operador
  (permissão de jogador Operator ou nível de comando ≥ GameDirectors), com qualquer item ou mão vazia, como no Java;
  agachado com item segue a interação normal. Não-op/sobrevivência: interação vanilla normal. O editor passou a trocar o
  bloco no mundo quando o "Mimic Block ID" muda (id inexistente no Bedrock é recusado com aviso).
- **Quebra**: criativo → quebra vanilla (sem drop) e o registro some; fora do criativo → a quebra vanilla é cancelada
  (o drop vanilla não é o do Java: pedra → pedregulho, minério → minério bruto) e o script tira o bloco, solta o item do
  bloco imitado (`permutation.getItemStack`), toca o som de quebra do material e apaga o registro.
- Sonda de console (config `enableDebugProbes`): `scriptevent cobblemon:hab_list|hab_scan|hab_spawn`.

## Situação por item

| Item | Situação | Evidência |
|---|---|---|
| Visual idêntico ao imitado para jogadores normais | FEITO | É o bloco vanilla de verdade. BDS: estrutura `habitats_rocky_outcrop1` carregada → `técnicos=0 habitats=1 28 85 15=minecraft:dripstone_block`; habitat jigsaw gerado pelo worldgen (`locate` berry_patch, 555 67 1133) → `bloco=minecraft:oak_leaves`, `técnicos=0` num raio de 24. |
| Habitat continua fazendo spawn | FEITO | BDS `hab_spawn` junto da âncora convertida: `sob habitat=1 escolhidas=1 do habitat=1: bagon` (+ `criados=1`); unit: detector com o imitado no mundo. |
| Migração de mundos existentes | FEITO | BDS: `setblock` do bloco técnico antigo (pool rocky_outcrop, sem `habitat_mimic`) → `técnicos=0 habitats=1 … =minecraft:dripstone_block`. |
| Quem segura o item vê onde estão | FEITO (contorno de partículas) | BDS: mão vazia 0 partículas, segurando o item 360 em 3 s (pacotes `spawn_particle_effect` só para o bot). |
| Editor só para op em criativo | FEITO | BDS: op em criativo clicando no dripstone → form `{cobblemon.ui.edit.habitat}`; após `deop` → 0 editores. Unit: não-op criativo, op sobrevivência, agachado com item. |
| Quebra: sobrevivência solta o imitado, criativo não, registro removido | FEITO (unit) | `tests/habitat-mimic.test.ts` §5 (cancelamento do vanilla, 1 drop, som, registro e salvo removidos). Não exercitado no BDS (o bot não tem quebra de bloco). |
| Mostrar o Pokémon girando dentro da "gaiola" para quem segura o item | NÃO POSSÍVEL como no Java | Não há render por jogador de bloco/entidade no Bedrock sem APIs beta; ficou o contorno de partículas. |
| Resistência a explosão de obsidiana / imóvel por pistão | NÃO POSSÍVEL | O bloco no mundo é o vanilla imitado; explosão/pistão tiram o habitat (sai do registro na conferência seguinte). |
| Partículas de quebra na quebra em sobrevivência | N/A (desvio pequeno) | A quebra vanilla é cancelada para trocar o drop; fica o som do material, sem as partículas de bloco. |

Desvios/limites restantes:
- O bloco técnico só converte num chunk que recebe ticks (distância de simulação). Uma estrutura recém-gerada vista de
  longe (dentro da distância de renderização, fora da de simulação) ainda mostra a âncora técnica até o jogador chegar
  perto; depois disso ela nunca volta.
- O imitado se comporta como o bloco vanilla (areia cai sem apoio, grama vira terra); o registro acompanha as formas
  derivadas acima.
- Folhas/toras/etc. imitadas usam a permutação padrão do `BlockMapper` (no Java é `defaultBlockState()`).

## Mudança em teste de outra frente

`tests/mundo-final.test.ts` §4 ("Bloco que sumiu do mundo sai do registro"): o lookup simulado passou de
`"minecraft:stone"` para `"minecraft:air"`. Motivo: agora o habitat É o bloco imitado (pedra por padrão), então pedra no
lugar significa habitat vivo; a intenção do teste (bloco sumiu → sai do registro) está preservada, e
`tests/habitat-mimic.test.ts` §4 cobre imitado/derivado/trocado/chunk descarregado.

## Verificação (2026-09-28)

- `npm run import` OK (tabela `HABITAT_ANCHOR_MIMICS` e estado `cobblemon:habitat_mimic` [0..3] gerados);
  `npm run validate` **OK, nenhum erro**; `npx tsc -p tsconfig.json` **0 erros**; `npm test`: 1ª rodada exit 0; na 2ª
  (depois do último ajuste) `tests/habitat-mimic.test.ts` e `tests/mundo-final.test.ts` passam e só falha
  `tests/spawn-multi.test.ts` ("conferidas 4313/4892"), teste novo e não rastreado da frente paralela spawn-multi, sem
  relação com habitats (compara os dados de spawn importados).
- BDS próprio (`COBBLEMON_BDS=hab`, porta 19188, `dist-hab`, raknet, online-mode=false), cenário
  `tests/e2e/experimental/habitat-mimic.e2e.mjs` (`node tools/e2e/run.mjs --scenario …`): **1/1 passa**; único
  ERROR/WARN do log no cenário = as linhas da própria sonda (`console.warn`). O 1º boot do container caiu por watchdog
  (13 s) durante a criação do mundo com carga do host ~120 (vários BDS emulados); os boots seguintes subiram limpos
  (scripts em 0,5–1,1 s, sem erro de definição de bloco).
- E2E base (`COBBLEMON_MSD=0 node tools/e2e/run.mjs --deploy --rm`, mesmas variáveis do servidor `hab`): **10/10
  passam**, sem ERROR/WARN do add-on; container `cobblemon-bds-hab` removido pelo `--rm`. A 1ª tentativa não chegou
  a rodar cenário: o BDS emulado caiu no boot com `corrupted size vs. prev_size` (queda nativa do box64 descrita em
  estabilidade.md); a 2ª subiu limpa.
