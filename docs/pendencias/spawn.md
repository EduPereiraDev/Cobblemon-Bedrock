# Pendências da frente "spawn"

Arquivos da frente: `scripts/spawning/**` (`Spawner.ts`, `SpawnSelector.ts`, `SpawnConditions.ts`, `Despawner.ts`,
`TimeRange.ts`), `tools/importer/spawns.ts` (agora também gera `generated/scripts/spawns.ts`; `scriptsOut.ts` só
reexporta `emitSpawnsModule`), `tests/spawn.test.ts`.

## O que existe (paridade Cobblemon 1.8.2)

- **Importador**: `pokemon` e `pokemon-herd` (1700 herds, 935 com Alfa). Membros de herd com `levelRange` (clamp),
  `levelRangeOffset`, `herdLevelRange`, `maxTimes`, `isLeader`/`isFollower`, `alpha=true`, `held_item=`. Presets:
  condição mesclada, **anticondição do preset separada** (antes eram fundidas com E lógico — errado). Novos campos de
  condição: `fluid` (presets water/lava), `minZ/maxZ`, `min/maxHeight`, `min/maxDepth`. Anticondições/multiplicadores
  com `structures` são descartados (nunca valem no Bedrock). `drops` e `heldItems` da entrada são exportados.
  `BEST_SPAWNER_CONFIG` vem de `data/cobblemon/spawning/best-spawner-config.json` (buckets 94/5/0.5/0.2/**boss 0.3**,
  pesca 83.25/11.25/4.125/1.375).
- **Seleção** (`SpawnSelector.ts`): FlatSpawnablePositionWeightedSelector + Spawner.chooseBucket. Bucket sorteado entre
  os do pool **sem re-sortear** se não houver candidato (como o Cobblemon); tipo de posição com peso × nº de entradas;
  entrada pelo maior peso; posição pelo peso. Herd: nível do grupo sorteado uma vez, líder primeiro, bucket fixado,
  demais entradas removidas, `minDistanceBetweenSpawns`, até `maxHerdSize`/`maxTimes`. Checagem de altura pelo hitbox.
- **Alfa**: aspects `alpha` + `alpha_eyes` (da marca `mark_alpha`), `marks`/`activeMark = cobblemon:mark_alpha`,
  moveset builder `"alpha"`, item (gema), tag de entidade `cobblemon_alpha`, e **AlphaLevelMatchingSensor**
  (Alfa selvagem a ≤ 32 blocos acompanha o maior nível do time do jogador mais perto: +4/+8/+12/+16/+20, nunca abaixo do
  nível de evolução).
- **Nível pelo time** (`PlayerLevelRangeInfluence`): implementado, mas **desligado** (`SPAWN_TUNING.playerLevelScaling`):
  no 1.8.2 a influência grava `props.level` e `PokemonSpawnAction.createEntity` sobrescreve com `levelRange.random()`,
  então não tem efeito nos spawns naturais.
- **Zona/caps** (config via `getConfig()` a cada passe): zona `spawningZoneDiameter`×`spawningZoneHeight` a 16–64 blocos,
  puxada para a direção do movimento, correção vertical `maxVerticalCorrectionBlocks`, cap de 3×3 chunks
  (`pokemonPerChunk`), `maximumSpawnsPerPass`, `minimumDistanceBetweenEntities`, `ticksBetweenSpawnAttempts` (1º passe
  após 100 ticks), `enableSpawning`, `worldSpawningBlocklist`, `shinyRate`, `maxNearbyBlocks*Range`. Um timer e um passe
  fatiado por jogador, todos andando a cada tick com orçamento por jogador (`PlayerSpawnScheduler`, frente spawn-multi:
  a taxa por jogador não cai com N; ver `docs/pendencias/spawn-multi.md`); aviso `[spawn] passe lento` no log acima de
  20 ms numa fatia (no máx. 1 a cada 10 s).
- **Despawn** (`Despawner.ts`): CobblemonAgingDespawner exato (`despawnerNear/FarDistance`, `Min/MaxAgeTicks`), 32
  entidades por segundo por dimensão; ignora em batalha, `cobblemon:busy`, montado, segurando item (no Cobblemon isso
  torna a entidade persistente — inclusive Alfas com gema) e `cobblemon:persistent`. Idade = `world.getAbsoluteTime()`
  − dynamic property `cobblemon:spawn_time`.
- **Outros**: `timeRange` com todas as faixas do 1.8.2 (morning/evening/predawn novas, inclusivas), `moonPhase` com
  faixas/nomes ("5-7", "full"...), slime chunk (algoritmo do Bedrock), `isPokeSnack` só vale em spawns de Poké Snack.

## API para outras frentes (`scripts/spawning/Spawner.ts`)

```ts
// Contexto de uma posição (location = onde a entidade aparece; o bloco da posição é o de baixo)
buildSpawnContext(dimension, location, positionType: "grounded"|"surface"|"submerged"|"seafloor"|"fishing", extra?): SpawnContext
positionsAround(dimension, center, diameter?, height?): SpawnContext[]           // mesma varredura do spawner natural

// Pool genérico
selectFromPool({ positions, buckets?, maxSpawns?, filter?, influences?, player? }): SpawnAction[]  // só escolhe
spawnFromPool({ ... }): Entity[]                                                  // escolhe e cria
spawnActionEntity(action, influences?): Entity | undefined                        // cria uma ação escolhida
createPokemonForAction(action, influences?): PokemonData                          // só os dados (sem entidade)

// Pesca (FishingSpawnerFactory): fishingBuckets, BucketNormalizing(Lure + Luck of the Sea), rodType/bait/minLureLevel
chooseFishingSpawn(ctx, { rodType?: "cobblemon:poke_rod", bait?: "cobblemon:love_sweet", lureLevel?, luckOfTheSeaLevel? },
                   { player?, influences? }): SpawnAction | undefined
// Poké Snack / isca de área: zona em volta, isPokeSnack = true, pokeSnackBuckets, cap pokeSnackPokemonPerChunk
trySpawnFromBait(dimension, center, { influences?, player?, maxSpawns? }): Entity[]

// Comandos (checkspawn / spawnpokemonfrompool)
getSpawnProbabilities(ctx, buckets?): { entry, bucket, percent }[]
chooseSpawn(ctx): SpawnEntry | undefined                                          // compat: 1 entrada num ponto
trySpawnNear(player): SpawnAction[]                                               // força um passe natural
setNaturalSpawning(enabled)

// Influências (SpawningInfluence.kt) — iscas, incenso, mel etc.
interface SpawnInfluence {
  affectBucketWeights?(weights), affectSpawnable?(entry, ctx), affectWeight?(entry, ctx, weight),
  affectAction?(action), affectPokemon?(action, pokemonData), affectEntity?(action, entity)
}
bucketNormalizingInfluence(tier)                                                  // export de SpawnSelector
```

Exemplo (pesca, frente WS7): `const ctx = buildSpawnContext(dim, bobberLoc, "fishing", { canSeeSky })`;
`const action = chooseFishingSpawn(ctx, { rodType, bait, lureLevel })`; ajustar `action.ctx.location` para a margem;
`spawnActionEntity(action, [baitInfluence])`. Aspect `fished` (FishingSpawnCause) fica a cargo da pesca via
`affectPokemon`.

Dynamic properties gravadas nas entidades: `cobblemon:spawn_time` (tick absoluto), `cobblemon:spawn_bucket`,
`cobblemon:herd_group` (mesmo valor no grupo), `cobblemon:herd_leader` (true no líder), `cobblemon:spawn_drops`
(JSON `SpawnDrops` quando a entrada tem `drops`). Tag `cobblemon_alpha` nos Alfas.
Ligue `cobblemon:persistent = true` para impedir o despawn (pasto, ombro, NPC).

## Pedidos

### 1. Entidades (`tools/importer/entities.ts`, frente de entidades/importador)

1. **Tirar `minecraft:despawn` do grupo `cobblemon:wild`** (hoje `despawn_from_distance` 48–128): o despawn agora é o do
   Cobblemon por script (`Despawner.ts`); o vanilla some com Pokémon de herd/Alfa e em batalha de forma aleatória.
2. **Escala de Alfa**: propriedade `cobblemon:alpha` (bool, `client_sync: true`), grupo `cobblemon:alpha` com
   `minecraft:scale` = `baseScale × (1.1 + 0.8 × 0.5^clamp(max(hitbox.width, hitbox.height) × baseScale, 0.25, 5))`
   (Pokemon.getAlphaScaleMultiplier; fórmula exportada em `alphaScaleMultiplier()` de `SpawnSelector.ts`) e a
   `minecraft:collision_box` na mesma proporção, e eventos `cobblemon:set_alpha` (adiciona o grupo, liga a propriedade)
   e `cobblemon:unset_alpha`. O spawner já chama `triggerEvent("cobblemon:set_alpha")` quando
   `getProperty("cobblemon:alpha") !== undefined`.
3. **Seguir o líder do herd** (FollowHerdLeaderTask): membros com o mesmo `cobblemon:herd_group` seguem o que tem
   `cobblemon:herd_leader = true` (ex.: `minecraft:behavior.follow_mob`/script). Opcional.

### 2. Dados (`scripts/Pokemon.ts`)

1. `applyToCobblemon`: se `aspects` contém `"alpha"`, disparar `cobblemon:set_alpha` (quando a propriedade existir) e
   `addTag("cobblemon_alpha")` — assim o Alfa capturado continua grande ao sair da bola. `validSaveEntityProperties`
   pode incluir `cobblemon:alpha`.
2. `SHINY_RATE` → `getConfig().shinyRate` (o spawner já passa `shiny` calculado pela config; `setupCobblemon`/ovos não).

### 3. Batalha (`scripts/battle/**`)

- Drops de spawn: ao derrotar um selvagem, se houver `cobblemon:spawn_drops` (JSON `{ amount, entries: [{ item,
  percentage?, quantityRange? }] }`), usar essa tabela no lugar de `species.drops` (PokemonEntity.drops).
- Alfa: `BattleRules.WILD_ALPHA` (BattleBuilder.kt:285) quando o selvagem tem aspect `alpha`.

### 4. Interface / comandos (`scripts/commands.ts`)

- `checkspawn`: `getSpawnProbabilities(buildSpawnContext(dim, player.location, "grounded"))`.
- `spawnpokemonfrompool`: `spawnFromPool({ positions: positionsAround(dim, player.location), maxSpawns: n })`.

### 5. Validação (`tools/importer/validate.ts`, dono do importador de conteúdo)

`npm run validate` falha hoje só por itens/geometrias duplicados entre `generated/` e os packs escritos à mão (frente de
conteúdo); nada de spawns. Se quiserem, validar que toda espécie de `SPAWNS[*].species` e de `herd.members[*].species`
existe em `generated/scripts/species.ts` (o teste `tests/spawn.test.ts` já confere).

## Limitações conhecidas

- Estruturas (`structures`) continuam impossíveis na Script API estável: entradas que exigem estrutura não spawnam.
- `hasSpace` só na vertical (espaço livre medido na coluna); largura do hitbox não é checada.
- 34 propriedades de spawn sem feature conhecida (`maushold_family=`, `landsnake_form=`) seguem ignoradas.
- Posições são amostradas (12 colunas de 64 por zona, 1 posição submersa por coluna) para caber no orçamento de tick.
- Remoções de posição/entrada valem para todos os buckets do passe (no Cobblemon um bucket calculado depois ainda vê
  posições ocupadas).

## Status da integração

- 1.1–1.3 (sem `minecraft:despawn`, escala de Alfa, seguir líder de herd): ✅ feito (integração) — frente entidades.
- 2.1 Alfa reaplicado em `applyToCobblemon`: ✅ feito (integração). 2.2 `shinyRate`: ✅ feito (integração).
- 3. Drops de spawn (`cobblemon:spawn_drops`) e `WILD_ALPHA`: ✅ feito (integração) — `battle/Rewards.ts`, `battle/index.ts`.
- 4. `checkspawn` e `spawnpokemonfrompool` (+ `forcespawn`): ✅ feito (integração) — `scripts/commands.ts`.
- 5. `npm run validate` confere as espécies de `SPAWNS` e dos membros de herd: ✅ feito (integração).
- Extra: tag `cobblemon_herd_leader` posta na criação do herd (`Spawner.ts`); marcas em potencial do spawn (`pokemon/Marks.ts`); `FishingInfo.bucketTier`; `trySpawnFromBait(..., { radius })`.
