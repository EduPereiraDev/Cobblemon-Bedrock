# Frente "spawn-multi": taxa de spawn por jogador com N jogadores e raridade igual ao Java

Arquivos da frente: `scripts/spawning/Spawner.ts`, `scripts/spawning/SpawnSelector.ts`, `scripts/spawning/SpawnConditions.ts`
(`BlockVolume` por posição e maior consulta por fatia), `tests/spawn-multi.test.ts`,
`tests/e2e/experimental/spawn-multi.e2e.mjs`, `docs/pendencias/spawn.md` (linha do agendador). Nada de `Habitats.ts`/`machines/habitat.ts`
(frente habitat-mimic) nem `scripts/catching` (ball-hit).

Requisito: com mais de 2 jogadores no mundo o spawn por jogador não pode cair (no CobbleDrock caía muito). A taxa por
jogador tem de ser a do Cobblemon Java com qualquer N, com custo por tick aceitável; e a raridade (buckets, pesos,
multiplicadores, herds/Alfa, nível, shiny, gênero, `maximumSpawnsPerPass`) tem de seguir as porcentagens do Java.

## 1. Como o Cobblemon 1.8.2 (Java) escala com N jogadores

Lido em `upstream/cobblemon` (`ServerPlayerMixin`, `PlayerSpawner`, `PlayerSpawnerFactory`, `Spawner`,
`BestSpawner`, `CobblemonConfig`, `PokemonEntity.checkDespawn`):

- **Um spawner por jogador.** `ServerPlayerMixin` guarda um `PlayerSpawner` em cada `ServerPlayer`
  (`PlayerSpawnerFactory.create`) e chama `getPlayerSpawner().tick()` no fim do `tick()` DO JOGADOR, quando
  `canSpawn()` (config `enableSpawning`, gamerule `doPokemonSpawning`, dimensão fora de `worldSpawningBlocklist`).
  Não existe `SpawnerManager` global nem fila: N jogadores = N spawners independentes.
- **Timer próprio.** `PlayerSpawner.tick`: `ticksUntilNextSpawn` começa em 100 e cai 1 por tick; ao chegar a 0 roda
  UM passe (`runForArea`) e volta a `ticksBetweenSpawnAttempts` (padrão 20). Taxa por jogador: 1 passe por segundo
  a 20 TPS, qualquer que seja N. O passe roda inteiro, síncrono, no tick do jogador (o custo por tick cresce
  linearmente com N; nenhum jogador espera outro).
- **Zona por jogador.** `getZoneInput`: zona `spawningZoneDiameter` (8) × `spawningZoneHeight` (16) a
  `minimum..maximumSpawningZoneDistanceFromPlayer` (16–64) blocos, puxada para a direção do movimento;
  `constrainArea` corrige o Y em até `maxVerticalCorrectionBlocks` (64). (`worldSliceDiameter`/`worldSliceHeight`
  são os nomes antigos dessas chaves; `exportSpawnConfig` só exporta o JSON.)
- **Limites locais, nunca globais.** `calculateSpawnActionsForArea`: conta os `PokemonEntity` que
  `countsTowardsSpawnCap` numa caixa de 48 × 1000 × 48 (`ENTITY_LIMIT_CHUNK_RANGE` = 3 chunks) centrada na zona; se
  `contagem / 9 ≥ max(pokemonPerChunk, spawner.maxPokemonPerChunk)` (1.0) o passe não faz nada. Depois, até
  `maximumSpawnsPerPass` (8) ações com `minimumDistanceBetweenEntities` (8) entre elas. Não há contagem por mundo,
  por dimensão ou por jogador.
- **Jogadores juntos compartilham a área.** Como o cap é da caixa em volta da zona, jogadores próximos enxergam os
  mesmos Pokémon: a densidade local satura no mesmo cap com 1 ou 6 jogadores (mais jogadores só chegam ao cap
  antes). Jogadores longe (> ~130 blocos) têm caixas disjuntas: taxa e densidade de cada um iguais às de 1 jogador.
- **Despawn por entidade.** `PokemonEntity.checkDespawn` roda para cada entidade a cada tick
  (`CobblemonAgingDespawner`: perto < 32 fica; > 96 ou idade > 3600 some; entre os dois, pela idade); também não
  depende de N.

## 2. O que o port fazia (antes desta frente)

`scripts/spawning/Spawner.ts`, `spawnTick` + `SPAWN_TUNING`:

1. **Rodízio global que dividia a frequência por N.** O laço rodava a cada 2 ticks (`runIntervalTicks: 2`) e
   começava no máximo UM passe por execução para o mundo inteiro (`maxPassesPerRun: 1`, `due[(rotation++) %
   due.length]`): teto de 10 passes/s somados. Com N jogadores, cada um tinha no máximo 10/N passes por segundo
   (N > 10 → abaixo de 1/s), e um jogador sorteado com passe ainda em andamento gastava a vez de todo mundo.
2. **Um `system.runJob` por passe.** Os passes de todos os jogadores disputavam o orçamento de jobs do motor (um só
   para o pack; medido: o spawner parava em ~12–14 ms por tick com 2 a 6 jogadores): com mais passes simultâneos, cada
   um levava mais ticks (até 239); passe além de `ticksBetweenSpawnAttempts` atrasava o próximo passe daquele jogador.
   Esse é o efeito do CobbleDrock: medido 56 → 50,5 → 21,6 → 17,4 passes por jogador a cada 1200 ticks com 1, 2, 4 e 6
   jogadores longe uns dos outros.
3. **Despawn com lote global.** 32 entidades por segundo POR DIMENSÃO (`despawnBatch`): com mais jogadores (e mais
   selvagens) cada entidade esperava mais para ser avaliada e segurava o cap local mais tempo.
4. Limites de área já eram locais: cap de 3×3 chunks em volta da zona (igual ao Java) e a salvaguarda do port
   `maxWildPerPlayer` (64 selvagens num raio de 80 blocos do jogador; não existe no Java — ver medição).
5. `worldQueryStats` (diagnóstico) era um só e zerado por passe: com passes intercalados, a sonda misturava os números.

Na seleção (`SpawnSelector.ts`), dois desvios de raridade do Java:

6. **Remoções valiam para buckets ainda não montados.** Depois de um spawn, as posições a menos de 8 blocos saíam de
   TODOS os buckets do passe (`removedPositions` global). No Java (`SeparatedSelectionData.removeSpawnablePositions`)
   só saem dos buckets já montados; um bucket sorteado pela 1ª vez depois (em geral incomum/raro) vê a zona inteira.
   Efeito medido (tabela "passes de 8 ações", seletor antigo): na floresta à noite 0,094 incomuns por passe contra
   0,165 do Java (−43%), 2,40 ações por passe contra 2,60, e mais passes de 1 ação.
7. **Ordem peso × influências × multiplicadores.** O port aplicava os `weightMultipliers` antes das influências;
   o Java (`SpawnablePosition.getWeight` → `applyInfluences(extraInfluences = weightMultipliers)`) aplica as
   influências da posição/spawner/causa antes. Igual para influências multiplicativas (as de hoje), diferente para uma
   regra de spawn aditiva (`"weight": "v.weight + 5"` numa spawn rule).

## 3. Correção

- **`PlayerSpawnScheduler` (Spawner.ts)**, porta do `ServerPlayerMixin`/`PlayerSpawner.tick`:
  - laço a cada tick (`system.runInterval(spawnTick, 1)`), timer por jogador (100 no 1º passe, depois
    `ticksBetweenSpawnAttempts`), congelado quando `canSpawn` é falso (config, gamerule, blocklist da dimensão DO
    JOGADOR);
  - cada jogador tem o seu passe fatiado; a cada tick TODOS os passes em andamento andam, cada um com o SEU orçamento
    (fatias do passe dele em sequência até gastar o orçamento). Sem fila, sem rodízio, sem `system.runJob`
    compartilhado: a frequência por jogador não depende de N;
  - orçamento por jogador adaptado ao custo medido dos passes DELE (média móvel): custo / 12 ticks (60% do intervalo),
    entre 2 e 15 ms por tick (`SPAWN_TUNING.playerTickBudgetMs`, `passTargetFraction`); passe que passa do prazo anda com
    o máximo. Em hardware nativo um passe custa poucos ms e o orçamento fica no mínimo; no BDS emulado (box64) um passe
    custa ~200–250 ms (300–600 leituras de bloco e até ~900 consultas `containsBlock`) e o orçamento vai a 15 ms;
  - jogadores que entram no MESMO tick começam com fases diferentes (+7 ticks cada, mod 20) para espalhar o custo;
    quem entra sozinho tem o 1º passe em 100 ticks, como no Java;
  - salvaguarda do watchdog (`tickCeilingMs` = 40 ms, abaixo do pico de 100 ms): passado disso num tick, os passes
    restantes andam no tick seguinte (primeiro que os outros). Só entra quando a máquina não dá conta de todos os
    passes (no BDS emulado, com 4+ jogadores longe em terreno novo); aí a perda é igual para todos;
  - `worldQueryStats` salvo/restaurado por passe (`trackedPass`); nota no aviso de passe lento quando a fatia é UMA
    consulta ao mundo (`singleQueryNote`, como a `singleReadNote` das leituras de bloco).
- **Despawn por jogador**: lote = `despawnBatch` × jogadores na dimensão (Java confere cada entidade a cada tick).
- **Teto do port por jogador** (`maxWildPerPlayer`, não existe no Java): 64 → 160 selvagens num raio de 80. Com 64 ele
  cortava antes do cap do Java (medido no legado: 28–44% dos passes com jogadores juntos pararam nele e a densidade
  ficou em 44–64). Pelo cap do Java, cada caixa de 48×48 em volta de uma zona passa de no máximo 16; o disco de raio
  80 cobre ~8,7 caixas. Medido com 160: 0 passes barrados com 1–4 jogadores juntos e 6 de 1075 com 6.
- **Consultas de blocos por perto** (`SpawnConditions.ts`): um `BlockVolume` por posição, reaproveitado por todas as
  listas (antes um objeto nativo por consulta, até ~900 por passe).
- **Seleção**: remoções só nos buckets já montados; `weightAt` = peso → influências → `weightMultipliers`.
- **Sonda multi** (`scriptevent cobblemon:debug_probes on`): a cada 1200 ticks, `[spawn] multi: ticks …, spawner/tick
  média … p99 … máx …, tick médio … | <jogador>: passes N (ok, zona, cap, teto), spawns, duração máx, atrasados,
  selvagens perto`. Desligada, não monta a linha.

## 4. Medição

### 4.1 E2E: taxa por jogador, longe uns dos outros (cenário `tests/e2e/experimental/spawn-multi.e2e.mjs`)

BDS `cobblemon-bds-smulti` (porta 19190, `dist-smulti`, raknet, offline, box64 emulado), bots a 400 blocos uns dos
outros em terreno novo a cada configuração, selvagens removidos a cada 15 s (taxa sem o cap no caminho), 3 min por
configuração, sonda multi ligada. "antes" = agendador legado (rodízio + `runJob`) com a mesma sonda; "depois" = build
final. Esperado pelo Java: 60 passes por jogador a cada 1200 ticks (1 a cada `ticksBetweenSpawnAttempts` = 20).

| N | passes/1200 ticks antes | depois | pior jogador (passes/min de relógio) antes | depois | passes atrasados (> 20 ticks) antes | depois | duração máx (ticks) antes | depois | spawner ms/tick média/p99/máx antes | depois | TPS antes | depois |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 56 | **59** | 55.7 | 57.9 | 40 | 8 | 40 | 31 | 9.18/21/39 | 9.11/17/91 | 19.9 | 19.7 |
| 2 | 50.5 | **55.5** | 47.6 | 52.4 | 83 | 81 | 145 | 42 | 12.03/21/37 | 17.68/33/43 | 19.7 | 19.7 |
| 4 | 21.6 | **54.6** | 12.3 | 37.6 | 177 | 101 | 239 | 41 | 12.37/22/69 | 23.14/53/56 | 18.6 | 15.3 |
| 6 | 17.4 | **46.3** | 10.6 | 23.2 | 118 | 100 | 202 | 66 | 12.77/23/39 | 30.81/54/56 | 15.8 | 11.6 |

- Antes: a taxa por jogador cai com N (56 → 17,4, −69%; o pior jogador com 6 bots teve 10,6 passes/min) e os passes
  chegam a 239 ticks: o orçamento de jobs do motor (~12–14 ms/tick) é dividido entre os jogadores.
- Depois: 59 → 55,5 → 54,6 → 46,3. Com 1, 2 e 4 jogadores a taxa por jogador fica igual (±7%). Com 6 jogadores em
  terreno novo o BDS emulado chega ao limite da máquina (6 passes de ~250 ms de CPU por segundo não cabem em 1 s): a
  salvaguarda de 40 ms/tick segura o custo e todos perdem por igual (−22%, contra −69% antes). O TPS cai como no Java
  (lá o passe é síncrono e o servidor inteiro desacelera): 11,6 contra 15,8 antes (antes o spawner ficava parado em
  ~13 ms/tick, às custas dos spawns). Em hardware nativo (servidor x86 ou mundo hospedado no cliente) um passe custa
  10–20× menos e não há limitação.
- "spawns/min" depende do terreno de cada configuração (bioma, água, herds) e da sonda cortar o 1º minuto; a medida
  controlada é a de passes. Os "zona" altos com 4–6 bots são zonas em chunks ainda não carregados (terreno novo no
  BDS emulado; o Java também desiste: `areEntitiesLoaded`).

Rodadas intermediárias (mesmo cenário): orçamento fixo de 4 ms/tick por jogador → 27,7 passes com 1 jogador (passes
de ~200 ms não cabiam em 20 ticks; por isso o orçamento adaptativo); adaptativo sem o `BlockVolume` reaproveitado →
55,0 / 58,2 / 58,1 / 50,5.

### 4.2 E2E: jogadores juntos (densidade local)

"depois": todos os N no MESMO ponto (bots a ≤ 4 blocos), selvagens removidos no começo de cada N e NÃO removidos
durante os 3 min. "antes": cada N num ponto diferente (a rodada foi antes de fixar o ponto; a densidade depende do
terreno), mesmo protocolo.

| N | antes: selvagens perto (64 blocos) no fim | antes: passes parados no cap do Java / no teto do port | depois: selvagens perto no fim | depois: cap do Java / teto do port | passes/1200 ticks antes | depois |
|---|---|---|---|---|---|---|
| 1 | 44 | 93 / 79 (de 180) | 74 | 156 / 0 (de 175) | 60 | 58.3 |
| 2 | 48, 51 | 196 / 117 (de 352) | 94, 94 | 321 / 0 (de 354) | 58.7 | 59 |
| 4 | 64, 64, 64, 64 | 485 / 205 (de 720) | 102, 101, 97, 104 | 671 / 0 (de 716) | 60 | 59.7 |
| 6 | 46, 44, 44, 46, 45, 44 | 614 / 409 (de 1080) | 98, 101, 96, 96, 97, 98 | 993 / 6 (de 1075) | 60 | 59.7 |

- Antes: a salvaguarda do port (64 num raio de 80) cortava antes do cap do Java (28–44% dos passes com 1–6 jogadores)
  e a densidade parava em 44–64.
- Depois: os passes param no cap por chunk do Java (92% com 6 jogadores) e quase nunca no teto do port; a densidade em
  volta do grupo é a mesma com 2, 4 e 6 jogadores (94; 97–104; 96–101 no raio de 64). Com 1 jogador ainda estava
  enchendo aos 3 min (74): o cap é o mesmo, mais jogadores só chegam a ele mais rápido, como no Java.
- A frequência de passes por jogador fica em ~59/1200 ticks com qualquer N (passes curtos: a zona já está no cap).

### 4.3 Avisos no log (rodadas acima)

- `[spawn] passe lento` (fatia > 20 ms): antes 14 numa rodada, depois 8 (rodada final) e 1 na rodada só "juntos". As
  fatias do spawner têm orçamento de 3–4 ms; os avisos que restam são paradas do runtime emulado dentro de UMA chamada
  nativa (leitura de bloco de 83 ms, `containsBlock` de 54–146 ms, criação de entidade de 156 ms) ou sem uma chamada
  dominante (21–42 ms e um de 190 ms em "posições", com a maior leitura de 1 ms: coletor de lixo/JIT do box64). O
  aviso agora diz quando foi numa única consulta ao mundo. Dividir uma chamada nativa: NÃO POSSÍVEL (mesma conclusão de
  `docs/pendencias/cliente-teste4.md`).
- `[Watchdog] High memory usage detected` e `… MB of dynamic properties were saved during the last minute`: aparecem
  com ~100 Pokémon carregados em volta dos bots depois de ~30 min de spawns em muitos lugares (também no legado: rodada
  "antes2", 13:35). Vêm do volume de dados por entidade (JSON do Pokémon em dynamic property, cache em
  `scripts/entity`), não do agendador; ver Pendências. O de dynamic properties (> 10 MB/min) só apareceu com os
  selvagens removidos a cada 15 s (até 180 spawns/min por jogador, bem acima do jogo normal, em que o cap segura).
- Nenhum hang/spike de watchdog de script do spawner. Três boots do BDS caíram por hang de 10–17 s ANTES de qualquer
  jogador, com o host a load average 100–155 (outros BDS de pé); as frentes `hab` e `ball` tiveram o mesmo no mesmo
  período (`docs/pendencias/estabilidade.md`: sobrecarga do host).

### 4.4 Agenda simulada (`tests/spawn-multi.test.ts`, relógio falso)

Opções do spawner (orçamento por jogador 2–15 ms, passe em 60% do intervalo, salvaguarda 40 ms).

| Passe (fatias × custo) | Jogadores | Passes por jogador | Duração máx (ticks) | Maior custo num tick (ms) |
|---|---|---|---|---|
| 40 × 0.5 ms | 1 | 101–101 | 9 | 3.5 |
| 40 × 0.5 ms | 2 | 100–101 | 9 | 4.0 |
| 40 × 0.5 ms | 4 | 100–101 | 9 | 7.0 |
| 40 × 0.5 ms | 6 | 100–101 | 9 | 8.0 |
| 40 × 0.5 ms | 12 | 100–101 | 9 | 16.0 |
| 40 × 0.5 ms | 24 | 100–101 | 9 | 26.0 |
| 10 × 3 ms | 1 | 101–101 | 9 | 6.0 |
| 10 × 3 ms | 2 | 100–101 | 9 | 6.0 |
| 10 × 3 ms | 4 | 100–101 | 9 | 12.0 |
| 10 × 3 ms | 6 | 100–101 | 9 | 12.0 |
| 10 × 3 ms | 12 | 100–101 | 9 | 24.0 |
| 10 × 3 ms | 16 | 100–101 | 9 | 30.0 |
| 50 × 4 ms | 1 | 100–100 | 12 | 16.0 |
| 50 × 4 ms | 2 | 100–100 | 12 | 32.0 |
| 10 × 3 ms (acima da capacidade) | 100 | 30–32 | — | 48.0 |
| 50 × 4 ms (acima da capacidade) | 6 | 77–78 | — | 52.0 |

Também testado: 1º passe em 100 ticks (entrada isolada) e fases +7 para quem entra no mesmo tick; jogador que sai tem o
passe cancelado; `canSpawn` falso congela o timer; orçamento de 2 ms para passes baratos e 15 ms para passes de 200 ms.

### 4.5 Raridade: Java × port (`tests/spawn-multi.test.ts`, semente fixa)

Contextos: planície de dia (grama, luz 15), floresta à noite (tempo 18000, luz 4), oceano (6 posições submersas, 3 de
superfície, 3 de fundo), caverna (pedra, y 20, sem céu, luz 0), deserto com chuva (areia). 12 posições numa zona 8×8,
como o spawner. Esperado = fórmulas do Java escritas no teste (independentes do `Selection`): P(bucket) = peso / soma
dos buckets do pool (94/5/0,5/0,2/0,3); P(tipo) ∝ peso do tipo × nº de entradas; P(entrada) ∝ maior peso dela nas
posições (peso × `weightMultipliers`); herds: nível uniforme, membro pelo peso entre os do papel (líder primeiro), Alfa
= membro `alpha=true`. Tolerância: |z| ≤ 4,5 (contagem esperada ≥ 10) ou cauda de Poisson ≥ 1e-6 (abaixo), e χ² de
todas as entradas.

**Uma ação por seleção (5000 seleções por contexto):**

| Contexto | Categoria | Esperado (Java) | Observado (port) | z |
|---|---|---|---|---|
| planície de dia | bucket common | 94.00% | 93.36% | -1.91 |
| planície de dia | bucket uncommon | 5.00% | 5.44% | 1.43 |
| planície de dia | bucket rare | 0.500% | 0.580% | 0.80 |
| planície de dia | bucket ultra-rare | 0.200% | 0.320% | 1.90 |
| planície de dia | bucket boss | 0.300% | 0.300% | 0.00 |
| planície de dia | sem spawn | 0.000% | 0.000% | -0.00 |
| planície de dia | Alfa | 0.300% | 0.300% | 0.00 |
| planície de dia | combee-1 | 5.50% | 4.82% | -2.10 |
| planície de dia | rattata-1 | 4.52% | 4.00% | -1.78 |
| planície de dia | caterpie-1 | 4.40% | 4.48% | 0.28 |
| planície de dia | scatterbug-1 | 4.40% | 4.86% | 1.59 |
| planície de dia | pidgey-herd-1 | 3.77% | 4.04% | 1.00 |
| planície de dia | χ² de todas as 141 entradas | 55 g.l. | 55.2 | 0.02 |
| floresta à noite | bucket common | 94.00% | 94.14% | 0.42 |
| floresta à noite | bucket uncommon | 5.00% | 4.72% | -0.91 |
| floresta à noite | bucket rare | 0.500% | 0.620% | 1.20 |
| floresta à noite | bucket ultra-rare | 0.200% | 0.180% | -0.32 |
| floresta à noite | bucket boss | 0.300% | 0.340% | 0.52 |
| floresta à noite | sem spawn | 0.000% | 0.000% | 0.00 |
| floresta à noite | Alfa | 0.300% | 0.340% | 0.52 |
| floresta à noite | skwovet-1 | 6.23% | 6.12% | -0.31 |
| floresta à noite | stunky-1 | 4.98% | 5.14% | 0.52 |
| floresta à noite | caterpie-1 | 4.84% | 5.06% | 0.72 |
| floresta à noite | weedle-1 | 4.84% | 4.36% | -1.59 |
| floresta à noite | wurmple-1 | 4.84% | 4.96% | 0.39 |
| floresta à noite | χ² de todas as 194 entradas | 81 g.l. | 78.3 | -0.21 |
| oceano | bucket common | 94.00% | 93.68% | -0.95 |
| oceano | bucket uncommon | 5.00% | 5.12% | 0.39 |
| oceano | bucket rare | 0.000% | 0.000% | 0.00 |
| oceano | bucket ultra-rare | 0.200% | 0.320% | 1.90 |
| oceano | bucket boss | 0.300% | 0.400% | 1.29 |
| oceano | sem spawn | 0.500% | 0.480% | -0.20 |
| oceano | Alfa | 0.300% | 0.400% | 1.29 |
| oceano | wishiwashi-herd-2 | 25.80% | 26.16% | 0.58 |
| oceano | magikarp-herd-2 | 15.33% | 15.40% | 0.14 |
| oceano | remoraid-herd-2 | 13.93% | 13.96% | 0.05 |
| oceano | tentacool-herd-1 | 8.81% | 8.80% | -0.03 |
| oceano | tentacool-1 | 7.93% | 7.86% | -0.19 |
| oceano | χ² de todas as 46 entradas | 27 g.l. | 28.2 | 0.16 |
| caverna | bucket common | 94.00% | 93.60% | -1.19 |
| caverna | bucket uncommon | 5.00% | 5.40% | 1.30 |
| caverna | bucket rare | 0.500% | 0.600% | 1.00 |
| caverna | bucket ultra-rare | 0.200% | 0.180% | -0.32 |
| caverna | bucket boss | 0.300% | 0.220% | -1.03 |
| caverna | sem spawn | 0.000% | 0.000% | 0.00 |
| caverna | Alfa | 0.300% | 0.220% | -1.03 |
| caverna | geodude-2 | 13.43% | 13.12% | -0.64 |
| caverna | drilbur-1 | 13.43% | 13.30% | -0.27 |
| caverna | rattata-2 | 10.74% | 10.78% | 0.08 |
| caverna | gastly-1 | 10.74% | 11.18% | 1.00 |
| caverna | joltik-2 | 8.06% | 8.00% | -0.15 |
| caverna | χ² de todas as 60 entradas | 32 g.l. | 27.6 | -0.55 |
| deserto com chuva | bucket common | 94.00% | 94.12% | 0.36 |
| deserto com chuva | bucket uncommon | 5.00% | 4.82% | -0.58 |
| deserto com chuva | bucket rare | 0.500% | 0.700% | 2.01 |
| deserto com chuva | bucket ultra-rare | 0.200% | 0.160% | -0.63 |
| deserto com chuva | bucket boss | 0.300% | 0.200% | -1.29 |
| deserto com chuva | sem spawn | 0.000% | 0.000% | 0.00 |
| deserto com chuva | Alfa | 0.300% | 0.200% | -1.29 |
| deserto com chuva | maractus-1 | 12.37% | 12.32% | -0.10 |
| deserto com chuva | hippopotas-herd-1 | 12.37% | 12.48% | 0.24 |
| deserto com chuva | sandshrew-1 | 11.13% | 11.46% | 0.74 |
| deserto com chuva | cacnea-1 | 11.13% | 11.78% | 1.46 |
| deserto com chuva | silicobra-1 | 11.13% | 11.52% | 0.87 |
| deserto com chuva | χ² de todas as 78 entradas | 35 g.l. | 46.1 | 1.33 |

**Passes de 8 ações (`maximumSpawnsPerPass`), 2000 passes por lado, port × simulador de referência transcrito do Kotlin**
(`SpawningSelector.select` + `FlatSpawnablePositionWeightedSelector` + `onSelection` de `PokemonSpawnDetail`/
`PokemonHerdSpawnDetail`, remoções só nos buckets montados, contagem do herd sem a ação atual). Médias por passe (as
ações de um herd saem juntas; z de Welch). Histograma de ações por passe e as 4 espécies mais comuns de cada contexto
também conferidos (|z| máx. 2.72).

| Contexto | Métrica | Java (referência) | Port | z |
|---|---|---|---|---|
| planície de dia | ações por passe | 4.1695 | 4.2175 | 0.63 |
| planície de dia | ações common por passe | 3.9515 | 3.9460 | -0.07 |
| planície de dia | ações uncommon por passe | 0.1725 | 0.2315 | 1.92 |
| planície de dia | ações rare por passe | 0.0100 | 0.0060 | -1.30 |
| planície de dia | ações ultra-rare por passe | 0.0075 | 0.0010 | -1.69 |
| planície de dia | ações boss por passe | 0.0280 | 0.0330 | 0.35 |
| planície de dia | ações Alfa por passe | 0.0040 | 0.0055 | 0.69 |
| planície de dia | ações de herd por passe | 3.6510 | 3.6960 | 0.49 |
| planície de dia | nível médio (meio da faixa) | 21.90 | 22.53 | — |
| floresta à noite | ações por passe | 2.5970 | 2.6130 | 0.31 |
| floresta à noite | ações common por passe | 2.3765 | 2.3945 | 0.36 |
| floresta à noite | ações uncommon por passe | 0.1650 | 0.1565 | -0.39 |
| floresta à noite | ações rare por passe | 0.0120 | 0.0085 | -0.97 |
| floresta à noite | ações ultra-rare por passe | 0.0150 | 0.0080 | -1.13 |
| floresta à noite | ações boss por passe | 0.0285 | 0.0455 | 1.11 |
| floresta à noite | ações Alfa por passe | 0.0045 | 0.0075 | 1.23 |
| floresta à noite | ações de herd por passe | 1.7745 | 1.7845 | 0.15 |
| floresta à noite | nível médio (meio da faixa) | 19.81 | 19.90 | — |
| oceano | ações por passe | 4.9615 | 4.8615 | -1.69 |
| oceano | ações common por passe | 4.7595 | 4.6125 | -2.22 |
| oceano | ações uncommon por passe | 0.1780 | 0.2245 | 1.53 |
| oceano | ações rare por passe | 0.0000 | 0.0000 | 0.00 |
| oceano | ações ultra-rare por passe | 0.0060 | 0.0105 | 0.91 |
| oceano | ações boss por passe | 0.0180 | 0.0140 | -0.43 |
| oceano | ações Alfa por passe | 0.0035 | 0.0030 | -0.28 |
| oceano | ações de herd por passe | 4.8045 | 4.6875 | -1.70 |
| oceano | nível médio (meio da faixa) | 16.10 | 16.24 | — |
| caverna | ações por passe | 1.9290 | 1.9730 | 0.76 |
| caverna | ações common por passe | 1.7705 | 1.8115 | 0.73 |
| caverna | ações uncommon por passe | 0.0980 | 0.1120 | 1.19 |
| caverna | ações rare por passe | 0.0140 | 0.0060 | -2.23 |
| caverna | ações ultra-rare por passe | 0.0055 | 0.0060 | 0.13 |
| caverna | ações boss por passe | 0.0410 | 0.0375 | -0.24 |
| caverna | ações Alfa por passe | 0.0075 | 0.0070 | -0.19 |
| caverna | ações de herd por passe | 1.0175 | 1.0665 | 0.71 |
| caverna | nível médio (meio da faixa) | 21.37 | 20.65 | — |
| deserto com chuva | ações por passe | 2.5440 | 2.6490 | 1.58 |
| deserto com chuva | ações common por passe | 2.2385 | 2.2350 | -0.06 |
| deserto com chuva | ações uncommon por passe | 0.2650 | 0.3430 | 2.21 |
| deserto com chuva | ações rare por passe | 0.0095 | 0.0220 | 1.51 |
| deserto com chuva | ações ultra-rare por passe | 0.0055 | 0.0085 | 0.72 |
| deserto com chuva | ações boss por passe | 0.0255 | 0.0405 | 1.03 |
| deserto com chuva | ações Alfa por passe | 0.0045 | 0.0065 | 0.86 |
| deserto com chuva | ações de herd por passe | 1.4415 | 1.5570 | 1.42 |
| deserto com chuva | nível médio (meio da faixa) | 24.84 | 24.71 | — |

Com o seletor ANTIGO (remoções em todos os buckets), o mesmo teste falha; floresta à noite:

| Contexto | Métrica | Java (referência) | Port antigo | z |
|---|---|---|---|---|
| floresta à noite | ações por passe | 2.5970 | 2.3950 | -4.03 |
| floresta à noite | ações common por passe | 2.3765 | 2.2785 | -1.95 |
| floresta à noite | ações uncommon por passe | 0.1650 | 0.0935 | -3.82 |
| floresta à noite | ações rare por passe | 0.0120 | 0.0070 | -1.48 |
| floresta à noite | ações ultra-rare por passe | 0.0150 | 0.0055 | -1.63 |
| floresta à noite | ações boss por passe | 0.0285 | 0.0105 | -1.66 |
| floresta à noite | ações Alfa por passe | 0.0045 | 0.0025 | -1.07 |
| floresta à noite | ações de herd por passe | 1.7745 | 1.5885 | -2.81 |
| floresta à noite | nível médio (meio da faixa) | 19.81 | 19.39 | — |

(Uma diferença de z = 3,4 nos incomuns da planície numa rodada de 12 000 passes foi conferida com 3 sementes novas de
20 000 passes: z = 0,57, −0,74, −0,83 — flutuação, não desvio.)

**Criação do Pokémon e dados:**

- Nível: 16000 sorteios em 5–12, cada nível 12.52%/12.42%/12.20%/12.97%/13.04%/12.28%/12.32%/12.25% (esperado 12.50%).
- Shiny (shinyRate 40 no teste; padrão do Java e do port: 8192): esperado 2.50%, observado 1.83% (z -2.09).
- Gênero (Bulbasaur, maleRatio 0.875): esperado 87.50% machos, observado 86.33% (z -1.73).
- Dados: 4313/4892 spawns do Cobblemon conferidos campo a campo (bucket, peso, tipo de posição, nível, multiplicadores, herd); 579 não importados (espécie/bioma/bloco sem equivalente); 12 multiplicadores com condição impossível no Bedrock descartados; 0 diferenças.
- `percentage` de spawn detail (seleção por porcentagem do Java): nenhum spawn do Cobblemon 1.8.2 usa (só itens/drops
  têm `percentage`); o port não implementa a pré-seleção por porcentagem. Presets: nenhum sobrescreve `bucket`,
  `weight` ou `spawnablePositionType`, e nenhum par de presets conflita num campo único (conferido nos JSON).
- Shiny Charm/`ShinyChanceCalculationEvent`: sem modificador no 1.8.2 (só o evento); isca/mel têm os próprios.

## 5. Status

| Item | Status | Prova |
|---|---|---|
| Taxa de passes por jogador independente de N (spawner por jogador, sem rodízio/fila/`runJob` compartilhado) | FEITO | 4.1 (1–4 jogadores ±7%; 6 no limite da máquina emulada: −22% contra −69%) e 4.4 (1–24 jogadores: 100–101 passes em 2100 ticks) |
| Limites locais como no Java (cap 3×3 chunks; nada global) | FEITO | 4.2: passes param no cap do Java; teto do port 64 → 160 (0–0,6% dos passes) |
| Custo por tick por jogador, fatias intercaladas | FEITO | orçamento por jogador 2–15 ms adaptado ao custo; salvaguarda 40 ms; 4.1 (p99 do spawner 17–54 ms no BDS emulado) |
| Despawn sem lote global | FEITO | lote × jogadores da dimensão |
| Raridade: buckets, pesos, multiplicadores, herds/Alfa, `maximumSpawnsPerPass` | FEITO | 4.5 (5 contextos, 1 ação e passes de 8); 2 desvios corrigidos (remoções por bucket, ordem das influências) |
| Nível, shiny (`shinyRate`), gênero (`maleRatio`) | FEITO | 4.5 |
| Dados importados × JSON do Cobblemon | FEITO | 4313/4892 conferidos campo a campo, 0 diferenças |
| Sem aviso de "passe lento" no BDS emulado | NÃO POSSÍVEL (parcial) | 4.3: restam paradas dentro de uma chamada nativa ou do runtime emulado (8 contra 14 antes); as fatias do spawner cabem no orçamento |
| Sem aviso de memória com a densidade do Java | PENDENTE (outra frente) | 4.3 e Pendências |
| Verificação | FEITO | `npx tsc -p tsconfig.json` 0 erros; `npm test` todos ok; `npm run validate` OK; E2E base 10/10 no `cobblemon-bds-smulti` com o build final (sem ERROR/WARN do spawner); container removido |

## 6. Pendências (outras frentes / orquestrador)

1. **Memória por Pokémon selvagem** (frente de entidades / `scripts/Pokemon.ts`): com a densidade do Java (~100
   Pokémon em volta de um grupo) e muitos spawns, o BDS avisa `[Watchdog] High memory usage detected` (limite de aviso de
   100 MB de script) e `MB of dynamic properties were saved` (> 10 MB/min). O JSON do `PokemonData` gravado em
   dynamic property em cada selvagem e o `dataCache` de `scripts/entity/index.ts` crescem com o nº de entidades.
   Sugestões: gravar nos selvagens só o necessário (espécie, nível, aspects, IVs/natureza) e gerar o resto sob demanda;
   limitar o `dataCache` (LRU). Sem isso, a alternativa é baixar `SPAWN_TUNING.maxWildPerPlayer` (menos densidade que o
   Java).
2. **Custo do passe no BDS emulado** (~200–250 ms): até ~900 `containsBlock` de `neededNearbyBlocks` por passe (uma por
   lista por posição). Reduzir exigiria calcular o conjunto de blocos por perto de cada posição de uma vez (como o
   `nearbyBlocks` do Java), o que na Script API estável custa mais leituras; fica como possível otimização.

## 7. Como verificar

```sh
npx tsc -p tsconfig.json
npm test                                  # tests/spawn-multi.test.ts (SPAWN_MULTI_TABLE=1 imprime as tabelas)
npm run validate
COBBLEMON_DIST=dist-smulti npm run build
COBBLEMON_BDS=smulti COBBLEMON_BDS_PORT=19190 COBBLEMON_DIST=dist-smulti COBBLEMON_BDS_TRANSPORT=raknet \
  COBBLEMON_BDS_ONLINE_MODE=false node tools/e2e/run.mjs --deploy --scenario tests/e2e/experimental/spawn-multi.e2e.mjs
# SM_BASE=<n> muda a faixa de terreno (use outra a cada rodada no mesmo mundo); SM_MINUTES, SM_COUNTS, SM_MODES.
docker rm -f cobblemon-bds-smulti
```
