# Pendências da frente "dados" (modelo do Pokémon)

API nova em `scripts/Pokemon.ts` (`PokemonData`), `scripts/pokemon/{Stats,Learnset,Abilities,Friendship}.ts`,
`scripts/Experience.ts`, `scripts/speciesData.ts`, `scripts/PokemonProperties.ts`. Tudo com semântica do
Cobblemon 1.8.2 e testado em `tests/dados.test.ts`. Pedidos abaixo são para arquivos de outras frentes.

## Batalha (`scripts/battle/**`)

1. **EVs ao derrotar** (PokemonBattle.kt:295, `Generation8EvCalculator`): para cada Pokémon do jogador que
   enfrentou o desmaiado,
   `winner.addEvs(calculateEvYield(fainted.getEvYield(), winner.item))`
   (`calculateEvYield` em `scripts/pokemon/Stats.ts`; `getEvYield()` já é da forma ativa; Power items somam +8).
2. `gainExp(exp, player)` agora **retorna** `AddExperienceResult`
   `{ oldLevel, newLevel, experienceAdded, newMoves, addedMoves, friendshipGained, evolutions }` e já
   põe golpes novos no moveset se houver espaço, dá amizade por nível (dono definido) e testa evoluções.
   Não é preciso fazer nada disso no intérprete.
3. `calculateExpGain(pokemon, fainted, multiplier, ownerName?)`: o 4º parâmetro (nome do dono atual) ativa
   o bônus de Pokémon trocado (×1.5, OT ≠ dono). Sem ele, lê `tryGetOwner()?.name`.
4. Amizade em batalha: X items / Dire Hit / Guard Spec dão `pokemon.addFriendship(1)` (XStatItem.kt).
   Remédios (Energy Root, Heal Powder, Revival Herb) tiram amizade: `addFriendship(-n)`.
5. `toShowdownSet()` já manda natureza efetiva (Mint), IVs efetivos (Hyper Training) e `happiness`.

## Captura (`scripts/catching/**`)

1. `catching/index.ts:76`: usar `target.getCatchRate()` (forma ativa) em vez de `speciesData.catchRate`.
   `StandardModifiers.ts:83` (Heavy Ball): o peso também pode vir da forma (`getFormData()?.weight ?? species.weight`).
2. Guardar `pokemonData.pokeball` como id do item (`"cobblemon:luxury_ball"`); `addFriendship` já aplica
   Luxury Ball ×2 e Soothe Bell +50%. Friend Ball: `setFriendship(150)`; Heal Ball: curar.

## Itens / eventos (`scripts/events/**`, futuro `scripts/items/**`)

Métodos prontos em `PokemonData` (todos retornam `boolean` = consumir o item?):

| Item | Chamada |
|---|---|
| Vitaminas (+10), Asas (+1), Mochi (+4) | `canAddEv(stat)` + `addEvs({ [stat]: n }) > 0` |
| Fresh Start Mochi | `resetEvs()` |
| Mints | `canApplyMint(nature)` / `applyMint("cobblemon:adamant")` (aceita `adamant_mint`) |
| Doces de Hyper Training (±1) | `adjustHyperTrainedIv(stat, ±1)`; Bottle Cap: `hyperTrain(stat)` |
| Ability Capsule / Patch | `canUseAbilityCapsule()`/`useAbilityCapsule()`, `canUseAbilityPatch()`/`useAbilityPatch()` |
| PP Up / PP Max | `ppUp(slot)` / `ppMax(slot)` |
| TM / tutor | `canLearnMove(move)` + `teachMove(move, slot?)` |
| Berries de amizade | `addFriendship(n)` |

- `events/RareCandy.ts:9` e `events/ScriptEvents.ts:130`: usar `pokemon.getExperienceToNextLevel()` /
  `getExperienceGroup(pokemon.getExperienceGroup())` (forma ativa) em vez de
  `ExperienceGroups[getSpeciesData().experienceGroup]`.
- `events/InteractEvolution.ts:13` e `events/ScriptEvents.ts:135`: usar `pokemonData.getEvolutions()`
  (evoluções da forma ativa; ex.: Pikachu "Alola-Bias" tem evoluções próprias) em vez de
  `initializeEvolutions(getSpeciesData().evolutions)`.
- `Evolution.forceEvolve(pokemon)` agora **retorna** o `PokemonData` evoluído.

## GUI (`scripts/GUI/**`)

1. Esconder o toggle "Evolve" quando `pokemonData.isEvolutionBlocked()` (Everstone; Summary.kt:175).
2. Lista de golpes: `getKnownMoves()` continua existindo (= `getAccessibleMoves()`: por nível até o atual +
   guardados + atuais). Para trocar golpe use `teachMove(move, slot)` (o antigo vai para os guardados e a
   proporção de PP é mantida, como `exchangeMove`) em vez de editar `moves`/`movesInfo` direto.
3. Summary pode mostrar: `friendship`, `evs`, `getEffectiveIvs()`/`isHyperTrained(stat)`, `nature` e
   `getEffectiveNature()` (mint), `hasHiddenAbility()`, `marks`/`activeMark`, `getTypes()` da forma.

## Spawning (`scripts/spawning/**`)

`PokemonData.generateNewWildPokemon(species, options)` aceita agora:
`hiddenAbilityChance` (0–1; padrão 0 = Cobblemon 1.8.2, que nunca sorteia HA), `hiddenAbility: true`,
`minPerfectIvs`, `movesetBuilder: "alpha"` (moveset de Alfa). Hitbox/escala da forma: `getHitbox()`, `getBaseScale()`.

## main.ts / Config.ts

1. Amizade passiva (PlayerPartyStore.kt:171): a cada 120 s, para cada Pokémon do time **fora da bola**
   com `friendship < 160`: `pokemon.addFriendship(1)` e salvar o time.
2. `getConfig().maxPokemonFriendship` é lido por `PokemonData.getMaxFriendship()`.

## Comandos / starter

- `PokemonProperties.apply` agora aceita `friendship=`, `ha`/`hiddenability`, `hp_iv=`, `attack_ev=` etc.
  e mantém o slot da habilidade ao trocar de espécie. Ao criar um Pokémon a partir de propriedades com
  `level=` diferente do nível gerado, chame `pokemon.initializeMoveset()` depois do `apply` para o moveset
  corresponder ao nível final (como `PokemonProperties.create` do Cobblemon).
- `/teach`: `canLearnMove(move)` (LearnsetQuery.ANY) + `teachMove(move)`; `/levelup`: `gainExp(getExperienceToNextLevel())`.

## Status da integração

- Batalha 1 (EVs ao derrotar), 2 (`gainExp` retorna o resultado), 3 (bônus de trocado), 4 (amizade de X items/remédios), 5 (`toShowdownSet`): ✅ feito (integração) — já estavam no código da frente batalhas (`Rewards.ts`, `BagItems.ts`); `toShowdownSet` agora também manda o item pelo `showdownItemOf` (pedido da frente itens).
- Captura 1 (`getCatchRate()` da forma, peso da forma na Heavy Ball) e 2 (`pokeball` com namespace, Luxury/Friend/Heal): ✅ feito (integração) — conferido em `scripts/catching/index.ts`, `StandardModifiers.ts`, `CaptureSequence.ts`.
- Itens/eventos (`getExperienceToNextLevel`, `getEvolutions()`, `forceEvolve` retorna o evoluído): ✅ feito (integração) — conferido em `events/RareCandy.ts`, `events/InteractEvolution.ts`, `events/ScriptEvents.ts`.
- GUI 1–3: ✅ feito (integração) — atendidos pela frente interface.
- Spawning (`generateNewWildPokemon` com HA/IVs/moveset Alfa): ✅ feito (integração) — usado pelo spawner e pelas iscas.
- main.ts/Config (amizade passiva, `maxPokemonFriendship`): ✅ feito (integração).
- Comandos/starter (`PokemonProperties.apply`, `initializeMoveset`, `/teach`, `/levelup`): ✅ feito (integração).
