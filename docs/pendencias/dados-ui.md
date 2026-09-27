# Pendências da frente "dados-ui" (dados do Pokémon, Pokédex, telas, comandos, spawn, montaria)

Arquivos da frente: `scripts/Pokemon.ts`, `scripts/pokemon/**`, `scripts/PokemonProperties.ts`, `scripts/pokedex/**`,
`scripts/GUI/**` (menos `Battle.ts`), `scripts/ui/**`, `scripts/commands.ts`, `scripts/Config.ts`, `scripts/main.ts`,
`scripts/pokemonStorage.ts`, `scripts/spawning/**`, `scripts/evolution/**`, `scripts/events/**`,
`scripts/entity/Riding.ts` (só atributos de montaria), `tests/dados-ui.test.ts`, seção `## dados-ui` dos `.lang`.
Novo módulo do importador: `tools/importer/embeddedPacks.ts`.

BDS próprio: `COBBLEMON_BDS=dados-ui COBBLEMON_BDS_PORT=19153 COBBLEMON_DIST=dist-dados-ui COBBLEMON_BDS_UDP_RANGE=19290-19299`.

## Edições pequenas em arquivos de outras frentes (coordenação)

Todas aditivas, com comentário "frente dados-ui" no ponto da mudança. Se a dona do arquivo preferir outro formato,
basta manter a mesma chamada.

| Arquivo (dona) | O quê | Por quê |
|---|---|---|
| `tools/importer/entities.ts` (mundo-detalhes) | `RideStyleInfo.max` (fim de cada faixa `stats`), `RideStyleInfo.sounds` (`rideSounds`: som, passageiros/outros, expressões de volume/tom) e `InteractionOut.chance` (requisito `chance`) | Ride boosts precisam do fim da faixa (`RidingBehaviourSettings.calculate`); sons de montaria; requisito `chance` das interações |
| `tools/importer/util.ts` (mundo-detalhes) | `UPSTREAM` aceita `COBBLEMON_UPSTREAM`; `walk` segue pastas por link simbólico | Import com os resource packs embutidos (`embeddedPacks.ts` monta uma cópia esparsa com links) |
| `package.json` | `npm run import` passa por `tools/importer/embeddedPacks.ts` (que chama o `index.ts`) | Packs `gyaradosjump` e `regionbiasforms` ligados por padrão, como no Cobblemon |
| `scripts/entity/Interactions.ts` (mundo-detalhes) | `findInteraction` sorteia o `chance` (`evaluateChance`) | ChanceRequirement |
| `scripts/items/food.ts` e `scripts/machines/cooking.ts` (mundo-detalhes) | `applyCobblemonMobEffect` antes do `addEffect` | Temperos `cobblemon:cleanse_negative`, `cleanse_all`, `mental_restoration` |
| `scripts/items/components.ts` (mundo-detalhes) | `cobblemon:food_effect.onUse`: Aprijuice com ride boosts abre a escolha do time (`openAprijuiceSelection`) em vez de beber | `AprijuiceItem.use` (PokemonSelectingItem) |
| `scripts/machines/tm.ts` (mundo-detalhes) | `unlearnTMs` exportado; `availableTMs` inclui os não aprendidos com `unlockAllMoveDexMovesByDefault` | `/technicalmachine lock` e `TMMachineScreen.includeUnlearned` |
| `scripts/battle/index.ts`, `scripts/battle/PokemonBattle.ts` (visual-batalha) | `CobblemonEvents.emit("BATTLE_STARTED")` em `startBattle` e `emit("BATTLE_FLED")` em `flee()` | Estatísticas `battles_total` e `battles_fled` |
| `scripts/fishing/FishingController.ts` (sem dona nesta onda) | `awardStat(player, "rod_casts")` no arremesso e `"reel_ins"` ao recolher | Estatísticas da Poké Rod |
| `scripts/ui/studio/*` | `studioEntityOf(player)` | Grito ao tocar no modelo 3D do resumo |
| `tools/ui/gen-telas.ts`, `tools/ui/gen-hud.ts` | Células novas (markings, grito no retrato, Move Dex, escurecer no filtro do PC) e campos `xp`/`lu` do HUD | Telas do resumo/Pokédex/PC e o overlay de EXP |

## Pedidos da visual-batalha atendidos (docs/pendencias/visual-batalha.md)

| Pedido | Feito em |
|---|---|
| 1. Bola que acerta a entidade de exibição (Illusion/Transform) mira o Pokémon real | `scripts/catching/index.ts` (`handleBallHit` → `resolveMockTarget`) |
| 2. Envio/recolha fora de batalha com a bola e o feixe | `scripts/pokemon/SendOutAnimation.ts` (`sendOutAnimated`/`recallAnimated`, modo "casual", sobre `scripts/battle/SendOut.ts`), usado no menu do time, no menu rápido e no envio rápido (R). A tela do time reabre só depois de o Pokémon aparecer/sumir: some também o aviso "menu reaberto ainda mostra ●" do E2E. A correção E2E-2 (tag do UUID sai antes do `instant_kill`) continua no `return()`. `Pokemon.sendOut/return` com `cobblemon.poke_ball.send_out/recall` |
| 3. HUD de batalha mostra o disfarce ao oponente | `scripts/ui/BattleHud.ts` (`tileView(..., isAlly)`: `displayData` do Illusion para quem não é aliado; espécie/variant do Transform para todos; nível/HP do real) |
| 4. Tag `cobblemon_ui_display` compartilhada com a batalha | `scripts/ui/studio/Studio.ts` (`isOrphanStudioEntity`): entidade com `cobblemon_battle_mock` só é removida no `entityLoad` se o Pokémon real (`cobblemon:mock_of`) não estiver mais em batalha; a limpeza do `worldLoad` continua removendo tudo |
| Sons de level-up duplicados | `gainExp`/`Rewards.ts`: com o overlay visível os sons vêm do overlay (`notifyExpGained`); sem ele, `playExpGainedSounds` + chat. `tests/batalhas.test.ts` aceita a mensagem no chat ou no overlay |

## Pedidos para outras frentes

### visual-batalha

1. `scripts/battle/Rewards.ts` (`awardExperience`): no 1.8.2 a EXP de batalha não vai para o chat
   (`addExperienceWithPlayer` só manda `ExpGainedDataPacket`). Trocar as três `sendMessage` por:
   ```ts
   import { notifyExpGained } from "../GUI/PartyHud";
   // notifyExpGained(player, uuid, oldLevel | undefined, expGained, movesLearned): boolean — false = sem overlay (manda o chat antigo)
   if (!notifyExpGained(player, pokemon.uuid, result.newLevel > result.oldLevel ? result.oldLevel : undefined, result.experienceAdded, result.newMoves.length)) { /* chat atual */ }
   ```
   O overlay mostra "+N EXP", o rolo de level-up no retrato, toca `gui.levelup_start` → `gui.levelup` (ou
   `evolution.notification`) e os pop-ups de golpe/evolução.
2. Se preferirem outro ponto para `BATTLE_STARTED`/`BATTLE_FLED` (hoje em `startBattle`/`flee`), manter os dois emits.

### mundo-detalhes

1. `scripts/items/food.ts`, caso `aprijuice` de `applyFoodEffect`: o comentário "montaria ainda não existe" ficou
   velho; a Aprijuice com bônus é tratada em `scripts/pokemon/Aprijuice.ts` (clique no Pokémon ou escolha do time).
   Com `minecraft:food` no JSON, segurar o botão ainda bebe uma Aprijuice temperada (o Bedrock não cancela o uso de
   comida pelo componente); se quiserem, tirar `minecraft:food` e usar só o `onUse` para as temperadas.
2. Importador: manter `max`/`sounds` no `RideStyleInfo` e `chance` nas interações ao mexer em `entities.ts`.

## Status por item (PARIDADE-MECANICAS)

| Linha | Status | Como / onde |
|---|---|---|
| §1 Spawn rules (`D/spawn_rules`), §10 #12 | FEITO | `scripts/spawning/SpawnRules.ts`: motor completo do `CobblemonSpawnRules` (componentes `weight`, `filter`, `location`; seletores expressão/`conditional`; MoLang `v.spawn_detail`, `v.spawnable_position`, `v.world.is_of`), ligado ao spawner do jogador (`playerInfluences`). O exemplo do 1.8.2 vem embutido e desligado. Sem datapack no Bedrock: `/cobblemon:spawnrule list/enable/disable/add/remove` (regras no mundo) |
| §2 Move Dex, §10 #77 | FEITO | `scripts/pokedex/MoveDex.ts` + botão "Golpes" na entrada (`POKEDEX_ENTRY.MOVES`): regras do `MovesLearnsetWidget` (nível por `highestLevel` da forma e das evoluções, TM travado sem aprender/passivo, ovo sempre), filtros Todos/Nível/TM/Ovo, ordens nível/nome/tipo/descoberto, troca de forma, painel do golpe (PP, categoria, poder, precisão, efeito, descrição). `unlockAllMoveDexMovesByDefault` agora editável e também libera os TMs na máquina |
| §2 Filtros extras da Pokédex, §10 #142 | FEITO | `PokedexCategoryFilter` completo (Visto = visto ou capturado, como no Java; Montáveis; TM não descoberto) e `SearchFilter` por espécie/habilidade/golpe/drop (`scripts/pokedex/PokedexUI.ts`). Nomes traduzidos não existem no servidor: busca pelo nome do Cobblemon/Showdown |
| §2 Som `scan_zoom_increment`, §10 #100 | FEITO | `scripts/ui/studio/ScannerZoom.ts` a cada passo de zoom |
| §5 Estúdio de câmera na evolução | N/A NO COBBLEMON | A evolução do Cobblemon não tem câmera própria |
| §6 Montaria: ride boosts, sons, overlay | FEITO | `scripts/pokemon/RideStats.ts` (faixas, bônus, `getRideStat`, conversão para os componentes), `scripts/entity/Riding.ts` aplica velocidade/fôlego com bônus ao montar e a cada estilo; `scripts/pokemon/RideSounds.ts` (loops `ride.loop.*` com volume/tom por `q.ride_velocity()`; stereo para quem monta, mono posicional para quem está perto; reinicia por faixa de volume — no Bedrock o volume de um som tocando não muda); `scripts/ui/RideControls.ts` (overlay de controles na actionbar por `displayControlSeconds`, padrão 0 como no 1.8.2). Pulo com bônus: NÃO POSSÍVEL NO BEDROCK (`horse.jump_strength` não é exposto a scripts). Sprint e roll de câmera continuam NÃO POSSÍVEL |
| §7 Estatísticas de jogador (`CobblemonStats`), §10 #106 | FEITO (adaptação) | `scripts/events/PlayerStats.ts` + `StatHandler.ts`: os 21 registros; 19 sobem como no `StatHandler`/mixin (captura, shiny, soltar, evoluir, nível, batalhas vencidas/fugidas/total, entradas, troca, fóssil, montar, Poké Rod, distância montado em cm por estilo); `battles_lost`, `pokemon_interacted_with` e ovos ficam 0 como no 1.8.2. Tela: `/cobblemon:stats [jogador]` (a tela de Estatísticas vanilla não aceita add-on: NÃO POSSÍVEL NO BEDROCK). `dex_entries`: +1 ao entrar no time/PC/evoluir/receber em troca (o Java também soma a cada mudança de lugar no armazenamento — não replicado) |
| §7 Advancements: árvore por aba | FEITO (adaptação) | Lista recuada pela profundidade (`treeDepth`); `max_ride_stats` avança (RidingStatBoostCriterion ao montar) |
| §9 Resumo: markings, grito, montaria; §10 #61, #81, #141 | FEITO | `scripts/GUI/Summary.ts`: 6 markings editáveis (3 estados, texturas `icon_marking_*`, gravadas ao sair/trocar), grito ao tocar no retrato/modelo 3D (som + animação `cry`), página de montaria na aba Atributos (tocar de novo na aba: por estilo, valor/máx e % de bônus) |
| §9 PC: ordenar, filtro parcial, última caixa; §10 #62, #63 | FEITO | `scripts/GUI/PC.ts` + `scripts/pokemon/SortMode.ts`: `PokemonSortMode` (nome, nível, tipo, nº, gênero; crescente/decrescente), filtro `Search.of` (nome parcial, `!`, holding/fainted/legendary/mythical/ultrabeast, propriedades) que escurece quem não passa, reabre na última caixa vista; prévia com markings, natureza, habilidade, IVs e EVs (#140) |
| §9 Sons `pc.grab/drop/release`, `gui.click`; §10 #97 | FEITO | PC (pegar/soltar/retirar/soltar Pokémon, setas `pc.click`), resumo (abas/markings), iniciais (categoria) |
| §9 Comandos: `technicalmachine`; §10 #130 | FEITO | `/cobblemon:technicalmachine unlock|lock <jogador> only <TM>|all` e `check <jogador>` (TmCommand.kt) |
| §9 Comandos: `abandonmultiteam` | NÃO FEITO | Depende das equipes de batalha multi (TeamManager), que o port não tem (frente de batalha) |
| §10 #8 Resource packs embutidos | FEITO | `tools/importer/embeddedPacks.ts`: `gyaradosjump` e `regionbiasforms` (DEFAULT_ENABLED) entram no import; `uniqueshinyforms` (NORMAL) com `COBBLEMON_PACKS=...`; `adorncompatibility` exige o mod. `sounds.json` mesclado por evento. Resultado: 89 arquivos novos (modelos/resolvers "hisui bias", Pikachu/Pichu de Alola, texturas Gyarados Jump) |
| §10 #14, #23, #48 PokemonProperties | FEITO | `scripts/PokemonProperties.ts` com todas as chaves do `PokemonProperties.kt` 1.8.2 e as custom properties registradas (`originaltrainer/ot`, `originaltrainertype/ottype`, `aspect`, `unaspect`, `type/elemental_type`, `no_ai`, `freeze_frame`, `scale_modifier`, `tag/label`, `alpha`, `form`, `fullness`, `status`, `tera_type`, `dmax_level`, `gmax_factor`, `moveset_builders`, `min_perfect_ivs`, `uncatchable`, `battleClone`, `held_item_visible`, `helditem`), valores entre aspas, `asString`, nível exato no `match`. `no_ai` na entidade: movimento 0 + tag (o Bedrock não desliga a IA por script); `freeze_frame`: guardado e comparado, sem efeito visual (NÃO POSSÍVEL NO BEDROCK: animação do cliente) |
| §10 #32 Aprijuice dá ride boosts | FEITO | `scripts/pokemon/Aprijuice.ts` (clique no Pokémon ou escolha do time; alimenta 1; `addRideBoosts`) |
| §10 #35, #36, #39 | FEITO | Ver §6 e §9 acima; estilo/atributos também na entrada da Pokédex (`rideLines`: estilos, assentos e faixas) |
| §10 #43 Temperos | FEITO / NÃO POSSÍVEL | `scripts/events/MobEffects.ts`: `cleanse_negative` (remove os HARMFUL a cada tick da duração) e `cleanse_all`; `mental_restoration` mexe no TIME_SINCE_REST dos phantoms, que o Bedrock não expõe: NÃO POSSÍVEL NO BEDROCK |
| §10 #60, #93 Level-up no overlay, `gui.levelup` | FEITO (fora de batalha) / pedido | Campo `xp`/`lu` no HUD da party ("+N EXP", rolo de level-up) e os sons; EXP de itens/comandos já vai para o overlay; a de batalha depende do pedido 1 da visual-batalha |
| §10 #71 Requisito `chance` | FEITO | `evaluateChance` nas interações e requisito `chance` para evoluções |
| §10 #84 Só datapack | PARCIAL | `negate`, `area`, `owner_held_item`, `chance` feitos (`scripts/evolution/requirements/GenericRequirements.ts`); `party_pools` já estava; MoLang novos, `scrolling` e assentos condicionais são de outras frentes |
| §10 #101 Chaves de som sem prefixo | PARCIAL | `Pokemon.sendOut/return` usam `cobblemon.poke_ball.*`; `scripts/catching/CaptureSequence.ts` (outra frente) ainda usa ids sem prefixo |

## E2E

- `tests/e2e/scenarios/05-pc.e2e.mjs`: o PC reabre na última caixa vista (lastPcBoxViewed, como no Cobblemon); o
  cenário agora espera a caixa 3 ao reabrir e volta para a 1 com `<<`.
- O mundo do E2E (`.bds-e2e/worlds/cobblemon`) ficou com o spawn quebrado depois de uma rodada (bots paravam em
  y=32769 sem `player_spawn`, inclusive com o build que tinha passado 8/8 minutos antes). Movido (não apagado) para
  o scratchpad desta sessão; o `--deploy` recriou o mundo e os packs. Rodada final: **8/8**.

## Verificação

- `npx tsc -p tsconfig.json`: 0 erros.
- `npm test`: todos os arquivos passam (inclui `tests/dados-ui.test.ts`).
- `npm run import` (com os packs): 31 s; `generated/` com `max`/`sounds` na montaria, variantes `region-bias-*` e `magikarp-jump-*` do Gyarados.
- BDS `dados-ui` (porta 19153): log e ContentLog sem nenhum ERROR/WARN; `/cobblemon:spawnrule`, `/cobblemon:spawnpokemon "aerodactyl ... no_ai freeze_frame=1 aspect=festive originaltrainer=Misty ottype=npc"` (tag `cobblemon_no_ai` na entidade) conferidos pelo console. Container removido.
- `npm run test:e2e -- --deploy`: 8/8.
