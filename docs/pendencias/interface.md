# Pendências da frente "interface" (UI, HUD, comandos, config)

Arquivos da frente: `scripts/GUI/{index,StarterGUI,OKDialogBox,common,Party,PC,Summary,Moves,PokemonEdit,PartyHud,ConfigEditor}.ts`,
`scripts/commands.ts`, `scripts/Config.ts`, `scripts/starter.ts`, `scripts/main.ts`, `scripts/pokemonStorage.ts`,
`tests/interface.test.ts`, `resource_packs/CobblemonBedrock/ui/**`.

## API nova para as outras frentes

- `getConfig()` (`scripts/Config.ts`): ~95 campos do `CobblemonConfig.kt` 1.8.2 com os nomes do Cobblemon
  (`shinyRate`, `enableSpawning`, `pokemonPerChunk`, `ticksBetweenSpawnAttempts`, `minimum/maximumSpawningZoneDistanceFromPlayer`,
  `maximumSpawnsPerPass`, `minimumDistanceBetweenEntities`, `despawner*`, `defaultFleeDistance`, `battleWildMaxDistance`,
  `battlePvPMaxDistance`, `battleSpectateMaxDistance`, `allowSpectating`, `awardExperienceToFaintedPokemon`,
  `awardExperienceOnBattleLoss`, `healPercent`, `healTimer`, `defaultFaintTimer`, `faintAwakenHealthPercent`,
  `infiniteHealerCharge`, `maxHealerCharge`, `secondsToChargeHealingMachine`, `tradeMaxDistance`, `passiveStatuses`...).
  Antes do `worldLoad` devolve os padrões (não lança mais). Nomes antigos (`maxPokemonFriendShip`,
  `allowExperienceFromPVP`, `maxNearbyBlocksVerticleRange`) continuam como getters. `updataConfig` continua (alias de `updateConfig`).
- `pokemonStorage.ts`: `getBoxCount(player)` (substitui a constante `totalBoxes`, que saiu), `movePokemon`, `depositToPC`,
  `withdrawFromPC`, `releasePokemon`, `clearParty`, `clearPC`, `renameBox`, `getBoxName`, `findFirstEmptyBoxSlot`,
  `findPokemonLocation`, `countParty`, `healPokemon`. Formato `pc:<caixa>:<espaço>` mantido.
- `GUI/PokemonEdit.ts`: `createPokemonFromProperties("pikachu level=10 shiny")` (usa `PokemonProperties` + `generateNewWildPokemon`).
- `starter.ts`: `hasSelectedStarter`, `resetStarter`, `giveStarter`, `promptStarterOnJoin`.

## Pedidos

### 1. Textos do port (dono de `resource_packs/CobblemonBedrock/texts/*.lang` / importador)

As telas usam estas chaves (as demais reaproveitam `cobblemon.*` do Cobblemon). Acrescentar em
`resource_packs/CobblemonBedrock/texts/en_US.lang` e `pt_BR.lang` (ou no `EXTRA` de `tools/importer/lang.ts`):

```
## en_US.lang
cobblemon.port.party.send_out=Send out
cobblemon.port.party.recall=Recall
cobblemon.port.party.nickname=Nickname
cobblemon.port.party.nickname_hint=Empty = species name
cobblemon.port.party.to_pc=Send to PC
cobblemon.port.release.confirm=Release %1$s? This cannot be undone.
cobblemon.port.release.done=Goodbye, %1$s!
cobblemon.port.storage.last_party=You can't leave your party empty.
cobblemon.port.storage.full=Your PC is full!
cobblemon.port.storage.party_full=Your party is full!
cobblemon.port.in_battle=You can't do that during a battle!
cobblemon.port.held.take=Take held item
cobblemon.port.held.give=Give item in hand
cobblemon.port.held.none=Nothing
cobblemon.port.held.taken=You took %1$s's held item.
cobblemon.port.held.empty_hand=Hold the item you want to give in your hand.
cobblemon.port.moves.swap=Change position
cobblemon.port.moves.swap_with=Swap with which move?
cobblemon.port.moves.none_to_learn=There are no moves to relearn.
cobblemon.port.moves.last_move=A Pokémon must know at least one move.
cobblemon.port.moves.empty_slot=— Learn a move —
cobblemon.port.summary.held_item=Held item
cobblemon.port.summary.ball=Ball
cobblemon.port.summary.marks=Marks
cobblemon.port.summary.no_marks=No marks yet.
cobblemon.port.summary.minted=Mint: %1$s
cobblemon.port.pc.move=Move / swap
cobblemon.port.pc.move_to=Move to where?
cobblemon.port.pc.withdraw=Move to party
cobblemon.port.pc.rename=Rename box
cobblemon.port.pc.rename_hint=Up to %1$s characters (empty = default)
cobblemon.port.pc.goto=Go to box
cobblemon.port.pc.box_count=Boxes: %1$s
cobblemon.port.hud.on=Party HUD on.
cobblemon.port.hud.off=Party HUD off.
cobblemon.port.hud.disabled=The party HUD is disabled on this server.
cobblemon.port.starter.confirm=Choose %1$s as your partner?
cobblemon.port.config.title=Cobblemon Config
cobblemon.port.config.saved=Saved %1$s setting(s).
cobblemon.port.config.reset_done=Config reset to Cobblemon defaults.
cobblemon.port.config.invalid=Invalid value for %1$s.
cobblemon.port.config.json_only=Starters and passive statuses are edited with /cobblemon:cobblemonconfig set or in the world JSON.
cobblemon.port.edit.iv=%1$s IV
cobblemon.port.edit.ev=%1$s EV
cobblemon.port.command.cant_learn=%1$s can't learn %2$s.
cobblemon.port.command.can_learn=%1$s can learn %2$s.
cobblemon.port.command.giveall=Added %1$s Pokémon to the PC.
cobblemon.port.command.spawnall=Spawned %1$s Pokémon.
cobblemon.port.command.starterkit=Gave the starter kit to %1$s.
cobblemon.port.command.no_battle=%1$s is not in a battle.
cobblemon.port.command.battle_stopped=Stopped %1$s's battle.
cobblemon.port.command.boxcount_not_empty=Can't remove boxes that still have Pokémon (%1$s).
cobblemon.config.ui.party_hud_enabled=Party HUD (action bar)
cobblemon.config.ui.party_hud_enabled.tooltip=Allows players to show their party on the action bar with /cobblemon:partyhud.
cobblemon.config.ui.party_hud_default_on=Party HUD on by default
cobblemon.config.ui.party_hud_default_on.tooltip=Players who never used /cobblemon:partyhud see the HUD.

## pt_BR.lang
cobblemon.port.party.send_out=Mandar para fora
cobblemon.port.party.recall=Recolher
cobblemon.port.party.nickname=Apelido
cobblemon.port.party.nickname_hint=Vazio = nome da espécie
cobblemon.port.party.to_pc=Mandar para o PC
cobblemon.port.release.confirm=Soltar %1$s? Não dá para desfazer.
cobblemon.port.release.done=Tchau, %1$s!
cobblemon.port.storage.last_party=Você não pode deixar o time vazio.
cobblemon.port.storage.full=Seu PC está cheio!
cobblemon.port.storage.party_full=Seu time está cheio!
cobblemon.port.in_battle=Você não pode fazer isso durante uma batalha!
cobblemon.port.held.take=Tirar item segurado
cobblemon.port.held.give=Dar o item da mão
cobblemon.port.held.none=Nada
cobblemon.port.held.taken=Você pegou o item de %1$s.
cobblemon.port.held.empty_hand=Segure na mão o item que quer dar.
cobblemon.port.moves.swap=Mudar de posição
cobblemon.port.moves.swap_with=Trocar com qual golpe?
cobblemon.port.moves.none_to_learn=Não há golpes para reaprender.
cobblemon.port.moves.last_move=Um Pokémon precisa saber pelo menos um golpe.
cobblemon.port.moves.empty_slot=— Aprender golpe —
cobblemon.port.summary.held_item=Item segurado
cobblemon.port.summary.ball=Bola
cobblemon.port.summary.marks=Marcas
cobblemon.port.summary.no_marks=Nenhuma marca ainda.
cobblemon.port.summary.minted=Mint: %1$s
cobblemon.port.pc.move=Mover / trocar
cobblemon.port.pc.move_to=Mover para onde?
cobblemon.port.pc.withdraw=Levar para o time
cobblemon.port.pc.rename=Renomear caixa
cobblemon.port.pc.rename_hint=Até %1$s caracteres (vazio = padrão)
cobblemon.port.pc.goto=Ir para a caixa
cobblemon.port.pc.box_count=Caixas: %1$s
cobblemon.port.hud.on=HUD do time ligado.
cobblemon.port.hud.off=HUD do time desligado.
cobblemon.port.hud.disabled=O HUD do time está desligado neste servidor.
cobblemon.port.starter.confirm=Escolher %1$s como parceiro?
cobblemon.port.config.title=Config do Cobblemon
cobblemon.port.config.saved=%1$s opção(ões) salva(s).
cobblemon.port.config.reset_done=Config voltou ao padrão do Cobblemon.
cobblemon.port.config.invalid=Valor inválido para %1$s.
cobblemon.port.config.json_only=Iniciais e status passivos se editam com /cobblemon:cobblemonconfig set ou no JSON do mundo.
cobblemon.port.edit.iv=IV de %1$s
cobblemon.port.edit.ev=EV de %1$s
cobblemon.port.command.cant_learn=%1$s não pode aprender %2$s.
cobblemon.port.command.can_learn=%1$s pode aprender %2$s.
cobblemon.port.command.giveall=%1$s Pokémon adicionados ao PC.
cobblemon.port.command.spawnall=%1$s Pokémon criados.
cobblemon.port.command.starterkit=Kit inicial entregue a %1$s.
cobblemon.port.command.no_battle=%1$s não está em batalha.
cobblemon.port.command.battle_stopped=Batalha de %1$s encerrada.
cobblemon.port.command.boxcount_not_empty=Não dá para remover caixas que ainda têm Pokémon (%1$s).
cobblemon.config.ui.party_hud_enabled=HUD do time (actionbar)
cobblemon.config.ui.party_hud_enabled.tooltip=Permite que os jogadores mostrem o time na actionbar com /cobblemon:partyhud.
cobblemon.config.ui.party_hud_default_on=HUD do time ligado por padrão
cobblemon.config.ui.party_hud_default_on.tooltip=Quem nunca usou /cobblemon:partyhud vê o HUD.
```

### 2. Dados (`scripts/Pokemon.ts`)

- `generateNewWildPokemon`: trocar a constante `SHINY_RATE` por `getConfig().shinyRate`
  (`shinyRate <= 0` = nunca shiny; chance = `Math.random() * shinyRate < 1`). O Config.ts já expõe o campo.

### 3. Spawning (`scripts/spawning/**`)

Ler da config em vez das constantes do `Spawner.ts`: `enableSpawning` (pular o passe inteiro), `ticksBetweenSpawnAttempts`,
`minimumSpawningZoneDistanceFromPlayer`/`maximumSpawningZoneDistanceFromPlayer`, `maximumSpawnsPerPass`,
`minimumDistanceBetweenEntities`, `pokemonPerChunk`, `worldSpawningBlocklist` (ids de dimensão), `minimumLevelRangeMax`,
`despawnerNearDistance`/`FarDistance`/`MinAgeTicks`/`MaxAgeTicks`. Ler `getConfig()` a cada passe (o admin pode mudar em jogo).

### 4. Batalha (`scripts/battle/**`)

- `PokemonBattle.ts:17` `fleeDistance = 30` → `getConfig().defaultFleeDistance` (32).
- Validar distância ao iniciar: `battleWildMaxDistance` (12) em `startWildBattle`, `battlePvPMaxDistance` (32) em
  `startBattleBetween2Players`; espectador: `battleSpectateMaxDistance` + `allowSpectating`.
- `awardExperienceToFaintedPokemon`, `awardExperienceOnBattleLoss`, `allowExperienceFromPvP`, `experienceShareMultiplier`,
  `luckyEggMultiplier` já estão na config.
- `/cobblemon:stopbattle` usa `tryGetBattleFromEntity(player)?.stop()`; se houver um jeito melhor de encerrar
  (sem `>forcetie`), exportar `stopBattle(player: Player): boolean` em `battle/index.ts` que eu troco.

### 5. Cura (`custom_components/HealingMachineComponent.ts`)

- Usar `getConfig().maxHealerCharge`, `secondsToChargeHealingMachine`, `infiniteHealerCharge`.
- Depois de `healPlayerTeam(player)`, chamar `pokemon.tryUpdatePokemonOut()` para os Pokémon fora da bola
  (a entidade tem uma cópia dos dados; o comando `healpokemon` já faz isso).

### 6. Captura (`scripts/catching/**`)

- Ao guardar o Pokémon capturado, definir `ogTrainer = player.name` se vazio (o resumo mostra o TO).

## Pedidos recebidos e atendidos

- `docs/pendencias/dados.md` → GUI: botão Evoluir some com Everstone (`isEvolutionBlocked()`); troca de golpe via
  `teachMove(move, slot)`; resumo mostra IVs efetivos (Hyper Training com `*`), natureza + Mint, habilidade oculta `(H)`,
  marcas (marca ativa com ★), tipos da forma. main.ts: amizade passiva (+1 a cada 120 s, fora da bola, < 160).
  Comandos: `/teach` com `canLearnMove` + `teachMove`; `/levelup` com `gainExp(getExperienceToNextLevel())`.

## Status da integração

- 1. Textos do port (`cobblemon.port.*` de interface e config): ✅ feito (integração).
- 2. `shinyRate` da config: ✅ feito (integração) — `rollShiny` em `Pokemon.ts` (`shinyRate <= 0` = nunca shiny).
- 3. Spawning lendo a config a cada passe: ✅ feito (integração) — feito pela frente spawn.
- 4. Batalha: `defaultFleeDistance`, `battleWildMaxDistance`, `battlePvPMaxDistance` e `stopBattle`: ✅ feito (integração). Espectador (`battleSpectateMaxDistance`/`allowSpectating`): ⏭️ não feito: espectador de batalha não existe no port.
- 5. Healing Machine com `maxHealerCharge`/`secondsToChargeHealingMachine`/`infiniteHealerCharge` e `tryUpdatePokemonOut` depois de curar: ✅ feito (integração) — carga float por tempo (registro por posição), custo = HP que falta (`getHealingRemainderPercent`), colocada no criativo = infinita.
- 6. `ogTrainer` na captura: ✅ feito (integração).
