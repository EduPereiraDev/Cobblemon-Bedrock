# Frente "jogabilidade" (onda 2)

Arquivos da frente: `scripts/Pokemon.ts`, `scripts/pokemon/**`, `scripts/evolution/**`, `scripts/events/**`,
`scripts/Config.ts`, `scripts/commands.ts`, `scripts/main.ts`, `scripts/pokemonStorage.ts`, `scripts/spawning/**`,
`scripts/starter.ts`, `scripts/catching/**`, `scripts/pokedex/**`, `tests/jogabilidade2.test.ts`, `docs/COMO-JOGAR.md` e a
seção `## jogabilidade` dos `.lang`.

Base: backlog de `docs/pesquisa/5-auditoria.md` (§4.1, §4.2, §4.3, §4.6, §5, §7) e as linhas FEITO da §7.4 que o código
não sustentava.

## Verificação

- `npx tsc -p tsconfig.json`: 0 erros nos arquivos da frente. Na última rodada, os erros restantes eram de outras
  frentes e estavam mudando durante o trabalho: `scripts/battle/ai/*` (ia-npc), `scripts/npc/Party.ts` (ia-npc) e
  `scripts/machines/pasture.ts` (mundo-sons).
- `npm test`: todos os arquivos passam, inclusive `tests/jogabilidade2.test.ts`. Ele confere os dados contra o
  upstream: gamerules, tag `poke_food`, `species_features`, `mechanics/slowpoke_tails.json`, tag
  `held/container_held_items`, `species_feature_assignments/color.json` e as 40 tabelas `loot_table/alpha`.
- BDS próprio (`cobblemon-bds-jogabilidade`, porta 19145, `dist-jogabilidade`): os scripts carregam sem ERROR/WARN da
  frente. O primeiro deploy mostrou `WARN Custom Command alias [gamerule] already in use`; o comando foi renomeado para
  `/cobblemon:cobblemongamerule`. Sobram erros de outras frentes: `cobblemon:npc` com `npc_render_scale`
  (ia-npc/motor) e o aviso de transporte NetherNet do próprio BDS.
- Conferência no servidor, sem jogador: `scriptevent cobblemon:debug_jogabilidade all`
  (`scripts/pokemon/DebugChecks.ts`). Resultado da última rodada:
  - gamerules com os padrões;
  - Bulbasaur: barriga máxima 4, metabolismo 10400 ticks;
  - Gimmighoul: 999 moedas depois de 13 sacos → `gimmighoul_gholdengo` pronta;
  - cauda do Slowpoke: 1200 s depois de tosada;
  - Nincada: `shedder=shedinja`, drop `shed_shell`;
  - Machop Alfa nível 55: soltou `exp_candy_l`, `tough_candy` e `fighting_gem×3`, e os itens aparecem no chão;
  - Pikachu shiny: tem a tag `cobblemon_shiny` e o rótulo "Pikachu Lv. 10";
  - tora com mel colocada e influência ligada à posição.

  `/cobblemon:cobblemongamerule doPokemonLoot false|true` pelo console responde e grava.
- O container caiu algumas vezes sem log (`exitCode -1`). `docker inspect` mostrou `OOMKilled=true`: havia vários BDS
  de ~2 GB numa VM Docker de 7,6 GB, e os servidores de animacao e e2e caíram do mesmo jeito. Não é erro de conteúdo.
  O container foi removido no fim (`docker rm -f cobblemon-bds-jogabilidade`).
- Última rodada: `npx tsc -p tsconfig.json` com 0 erros no projeto inteiro e `npm test` todo ok.

## Situação por item

| # | Item (auditoria) | Situação | Notas |
|---|---|---|---|
| 1 | 6 gamerules do Cobblemon (§4.3) | FEITO | O Bedrock não registra gamerule de add-on. Elas ficam na dynamic property de mundo `cobblemon_gamerules`, com os padrões do `CobblemonGameRules.kt`. `/cobblemon:cobblemongamerule <regra> [true/false]` funciona como `/gamerule`, para admin com cheats; o nome curto `gamerule` é do vanilla. Uso de cada uma: `doPokemonSpawning` no `Spawner.ts`, somada a `enableSpawning`; `doPokemonLoot` nos drops de evolução, e nos drops de selvagem via pedido A; `battleInvulnerability` e `mobTargetInBattle` em `pokemon/GameplayHooks.ts` via `beforeEvents.entityHurt`; `doShinyStarters` em `starter.ts`; `healersHealPC` via pedido B. |
| 1a | `mobTargetInBattle` | PARCIAL | O Cobblemon impede o mob de mirar o jogador (TargetingConditionsMixin). O script não consegue tirar o alvo de um mob vanilla sem sobrescrever todas as entidades. Com a regra desligada, o port cancela o dano de mob no jogador em batalha, que é o efeito prático. |
| 2 | Fome/saciedade (§4.6) | FEITO | `pokemon/Fullness.ts`. Barriga máxima pelo peso, com a potência do Grass Knot aplicada ao número do JSON, como o Kotlin. `feedPokemon`: som `berry.eat` com tom ou `berry.eat.full`; 1 por item (5 nas berries de cura por porção, 4 no Poké Puff). Metabolismo: velocidade/BST, 20 ticks por segundo, com barriga > 0, na rotina do time (`PassiveHealing.ts`). A tag `poke_food` foi conferida contra o upstream: berries filling, mochis, aprijuices e Poké Snack. Sem espaço na barriga, esses itens não podem ser usados: acabou o EV/amizade infinito por spam de berries. Para ligar isso sem editar `scripts/items/**`, `installFullnessHooks` embrulha os comportamentos cacheados de `getItemBehaviour` no carregamento. Campos novos no `PokemonData`: `fullness` e `metabolismCycle`. |
| 2a | Comer a berry segurada (EatHeldItemTask) | N/A | No Cobblemon 1.8.2 só vale para Pokémon fora de time com o behaviour `pick_up_items`/`pokemon_non_party`. O port não tem esses behaviours (§4.6 da auditoria). |
| 3 | Cura do time ao dormir (§5) | FEITO | `pokemon/SleepHeal.ts`: a mesma conta de `Pokemon.didSleep` (+metade do HP, até desmaiados; status, timers e metade do PP). O Bedrock não tem evento de acordar. A cada 10 ticks o port anota quem dorme e detecta o pulo da noite: a hora vai da noite para a manhã com salto do tempo absoluto. Só fora de batalha. |
| 4 | Brilho/som de shiny selvagem (§4.1, §3.3) | FEITO (script) / PARCIAL (visual) | `pokemon/ProximityEffects.ts`, cópia de `playWildShinySounds`. Shiny selvagem a até `shinyNoticeParticlesDistance` recebe anel e `wild_shiny_chime` uma vez por aproximação, por jogador, com `player.spawnParticle`/`playSound`. O brilho ambiente sai a cada 3,5 s, fora de batalha. Olhar um shiny solta `ambient_shiny_sparkle` + chime. Soltar um shiny toca `poke_ball.shiny_send_out` e `shiny_ring` + `shiny_chime` (`Pokemon.sendOut`). Os sons já existem. As partículas `cobblemon:*shiny*` ainda não estão no RP (pedido C). |
| 5 | Requisitos de evolução reais (§2.1, §2.3) | FEITO | `evolution/requirements/ExtraRequirements.ts`. `blocks_traveled` lê o contador. `advancement` consulta o dono pelo "Progresso Cobblemon" (`isProgressGoalDone`); a consulta pode ser trocada com `setAdvancementLookup` quando a ui-base tiver a API de conquistas. `property_range` lê a feature inteira (faixa "a-b"). `structure` passou a ter condição e anticondição separadas e aceita consulta de estrutura (`setEvolutionStructureLookup`, pedido D). Continua `UntrackedRequirement` só para variantes desconhecidas de datapack. |
| 5a | Passos (`blocks_traveled`) | FEITO | `pokemon/BlocksTraveled.ts`: só Pokémon com o requisito (hoje Rellor e Bramblin; Pawmo não está implementado no upstream). Soma `distSqr` por tick entre posições de bloco. Montado, caindo ou teleporte > 8 blocos não contam. Grava a cada segundo na entidade e no time (máx. 1000). |
| 5b | Stash do Gimmighoul → Gholdengo | FEITO | `pokemon/SpeciesFeatures.ts` + `pokemon/FeatureInteractions.ts` (StashHandler). O dono, sem agachar, usa Relic Coin/Pouch/Sack ou sucata/lingote/bloco de netherite no Gimmighoul. O item é gasto e toca `pokemon.gimmighoul.give_item`; a actionbar mostra o stash. `PokemonProperties` entende `gimmighoul_coins=999` e aplica `netherite_coating=stageN`, que vira o aspect `netherite-coating-*` do Gholdengo. |
| 5c | Evoluções passivas a cada segundo | FEITO | `PlayerPartyStore.onSecondPassed` testa as `PassiveEvolution` todo segundo. Antes o port só testava ao subir de nível: Eevee de dia, Pawmot e Gholdengo não saíam fora do level-up. `attemptPassiveEvolutions` em `PassiveHealing.ts`, com cache por espécie+forma. |
| 6 | Shedinja por "shedder" (§2.2) | FEITO | `evolution/EvolutionDrops.ts`, cópia de `Evolution.shed`. Precisa de espaço no time e de uma Poké Ball no inventário (usa a última achada; no criativo, Poké Ball). Gera cópia do Ninjask com UUID novo, sem item, com o `shedder` aplicado e a bola usada. A bola é gasta e o Progresso ganha `evolve_shedinja`. |
| 7 | Drops de evolução (§2.2) | FEITO | `Evolution.drops`, a partir de `generated/scripts/species.ts`. Sorteio `DropTable.getDrops`; entradas com `requirements` (EvolutionItemDropEntry) só valem se o evoluído passar. Exemplo: Shell Helmet do Shelmet só com Karrablast no time. Entrega com `defaultDropItemMethod`/`announceDropItems` (`pokemon/Drops.ts`), com a gamerule `doPokemonLoot`. |
| 8 | Escavalier/Accelgor | FEITO | Troca com `requiredContext` (já existia no `TradeManager`). Em single-player: Link Cable no Shelmet com Karrablast no time dá Accelgor e o drop Shell Helmet; Shell Helmet no Karrablast dá Escavalier. Testado. |
| 9 | Recompensas do Alfa (§2.4) | FEITO | `pokemon/AlphaRewards.ts` + `pokemon/alphaLoot.ts` (as 40 tabelas `loot_table/alpha/**` convertidas). No `BATTLE_FAINTED` de selvagem Alfa: tabela geral pelo nível (tier1 < 31, tier2 ≥ 31, tier3 ≥ 51, tier4 ≥ 66) e duas chances de 50 % por tipo (tier 2 a partir do 51), itens no chão, como `spawn_loot_table_items`. O MoLang do upstream usa o tipo primário nas duas chances (`q.length(t.types)` é avaliado com um elemento só). O port reproduz isso. |
| 10 | 21 campos de config sem efeito (§4.1) | FEITO / PARCIAL | Tabela abaixo. |
| 11 | `defaultBoxCount` 30 → 40 (§2.3, §7.4) | FEITO | Padrão 40 e `@LastChangedVersion` do Cobblemon: a config salva guarda `lastSavedVersion`. Configs salvas antes, inclusive as antigas do port sem o campo, voltam ao padrão novo em `defaultBoxCount` (1.7.0), `ambientPokemonCryTicks` (1.4.0), `maxRootsInArea` e `bigRootPropagationChance` (1.7.0). Jogadores sem `boxcount` próprio ganham as 10 caixas novas e nada se perde. Quem tem `pc_box_count` fica com o seu, como o `lockedSize` do PCStore. |
| 12 | Envio rápido + Pokémon selecionado (§4.2) | FEITO (entrada adaptada) | `pokemon/PartySelection.ts`. **Agachado + pular** faz o papel da tecla R (PartySendBinding + SendOutPokemonHandler): mirando nada ou o próprio Pokémon, solta ou recolhe o selecionado; mirando selvagem ao alcance, batalha com o selecionado na frente; mirando jogador, abre o menu de batalha/troca; em batalha, reabre a escolha. **Agachar duas vezes** passa para o próximo do time (setas do overlay) e mostra na actionbar. Comandos `/cobblemon:sendout [1-6]` e `/cobblemon:selectslot <1-6>`. A seleção fica em `cobblemon:selected_slot`; a HUD lê com `getSelectedSlot`/`onSelectedSlotChanged` (pedido E). Montado não reage, porque a montaria usa agachar e pular. |
| 13 | Tasty Tail (§3.6) | FEITO | Tesoura no Slowpoke, dono ou selvagem. Dropa `tasty_tail`, a cauda cresce em 1200 s com os aspects `regrown-tail-*` do `slowpoke_tails.json` e a tesoura perde durabilidade. A contagem roda na rotina do time. |
| 14 | Tora de saccharine com mel (§4.1, §2.3) | FEITO | `spawning/HoneyLog.ts`. O Bedrock não tem POI, então o port registra a tora com mel ao passar mel ou colocar o bloco. O detector usa 32 + diagonal da zona; influência a 32 blocos. Efeitos: 5 % de HA, 1/`honeySlatherShinyChance` de shiny e 1/`honeySlatherAlphaChance` de Alfa (moveset de Alfa). Na primeira ativação: `honey_drenched`, o Pokémon vai para a frente da face com mel, arroto, a tora volta a ser comum e sai do registro. Ligado nos spawns natural e de Poké Snack. |
| 15 | Itens segurados que perdem conteúdo (§2.3) | FEITO (troca pelo Pokémon) / pedido (menu) | `pokemon/HeldItems.ts`: tag `held/container_held_items` (caixas de shulker) mais bolsas do Bedrock. O port guarda o item segurado só pelo id, então bolsa também perderia o conteúdo. Agachar + usar recusa com `cobblemon.held_item.forbidden`. O menu "Item segurado" do time (`GUI/Party.ts`) precisa da mesma checagem (pedido E). Encantamentos, nome e durabilidade de itens segurados continuam se perdendo (limite do armazenamento por id; registrado). |
| 16 | Condições de estrutura (spawn e evolução) | PRONTO PARA LIGAR | `setSpawnStructureLookup` (`spawning/SpawnConditions.ts`) e `setEvolutionStructureLookup`. Sem consulta registrada, o comportamento é o de antes: condição nunca cumprida, anticondição sempre cumprida. O `isInStructure` da frente motor ainda não apareceu (pedido D). |
| 17 | `docs/COMO-JOGAR.md` desatualizado (§6 #22) | FEITO | Cavernas, isca, pesca e Poké Snack já fazem spawn; o limite real são as estruturas. Entraram: PC de 40 caixas, envio rápido e seleção, fome, cama, stash, Tasty Tail, Shedinja, brilho de shiny, Alfa, tora com mel, gamerules, rótulos por jogador mais perto, itens proibidos e 894/131 espécies. |
| 18 | Partículas de evolução com ids vanilla (§3.3, §7.4) | FEITO | `evolution/EvolutionEffect.ts` solta o emissor `cobblemon:evo_particles` (já no RP) no início da animação. Ele faz sozinho os 12 s de efeitos (`v.entity_size` pelo tamanho). |
| 19 | Tera Type (`teraTypeRate`) | FEITO | `rollTeraType`: 1/`teraTypeRate` para um tipo que o Pokémon não tem; senão, um dos dele. É só dado, porque o Cobblemon 1.8.2 não terastaliza. |
| 20 | Escolhas ponderadas (§2.4 `weighted_choice`) | FEITO | Dunsparce/Dudunsparce de 2 ou 3 segmentos (99:1) e Tandemaus/Maushold com família de 3 ou 4 (1:99), sorteados ao criar. O aspect passa na evolução dentro da linha (`PokemonProperties.apply`). |
| 21 | Cauda do Smeargle (§2.3) | FEITO | `pokemon/Characteristic.ts`: Characteristic com `UUID.hashCode` do Java e o maior IV a partir do índice rotacionado. A cor sai da tabela do Kotlin pela natureza original. Vale só com `behaviour.characteristicRainbow` e é recalculada no `applyToCobblemon`. Como no Cobblemon, "rainbow-light-blue" não casa com o resolver ("rainbow-light_blue"). |
| 22 | Tingir Wooloo/Dubwool/Conkeldurr (§2.1) | FEITO | Corante `*_dye` de outra cor põe o aspect `color-<cor>` e gasta 1; balde de água tira a cor e vira balde vazio. Vale para dono ou selvagem, como `PokemonEntity.mobInteract`. |
| 23 | `/pctake` e `/npcdelete` (§2.3) | FEITO | `/pctake` pelo console, ou com o próprio dono como alvo, apaga o Pokémon (`pctake.removed`) e recusa alvo em batalha (`pc.inbattle`). `/npcdelete [alvo]` aceita seletor de entidade e funciona pelo console. |
| 24 | `/pokedex printcalculations` (§2.3) | FEITO | Sem Pokédex usa a Nacional; `all` mostra todas. |
| 25 | `order` das categorias de iniciais (§2.4) | FEITO (dados) / pedido (tela) | `StarterCategory.order` com os padrões −110…−100 e `sortStarterCategories` estável. Falta a tela ordenar (pedido E). |
| 26 | Itens-chave (`defaultKeyItems`) | FEITO (dado) | `pokemon/KeyItems.ts`: dados em todo login (GeneralPlayerData.initialize), com `hasKeyItem`. No Cobblemon eles liberam gimmicks de batalha (Mega/Z/Dynamax/Tera), que o port não tem. |
| 27 | `healPlayerPC` | FEITO (função) / pedido | `pokemonStorage.healPlayerPC` e `canBeHealed` para a Healing Machine com `healersHealPC` (pedido B). |

### Os 21 campos de config "mortos" (§4.1)

| Campo | Situação | Onde |
|---|---|---|
| `announceDropItems` | FEITO nos drops de evolução / pedido A (selvagem) | `pokemon/Drops.ts` (`deliverItem`, `to_inventory`) |
| `appleLeftoversChance` | Pedido F | `custom_components/GiveLeftoversComponent.ts` (mundo-sons) |
| `baseApricornTreeGenerationChance` | Só informativo (fora do editor) | Worldgen fixado no importador |
| `defaultKeyItems` | FEITO (dado) | `pokemon/KeyItems.ts` |
| `displayEntityLabelsWhenCrouchingOnly` | FEITO (aproximação) | `ProximityEffects.ts`: o `nameTag` é global; vale o jogador mais perto |
| `displayEntityLevelLabel` / `displayEntityNameLabel` | FEITO | `PokemonData.getEntityLabel` (nome da espécie traduzido pelo JSON, "Lv. N") |
| `displayNameForUnknownPokemon` | FEITO (aproximação) | "???" para espécie não vista pelo jogador mais perto |
| `dropAfterDeathAnimation` | Pedido A | `battle/Rewards.ts` (sem dono) |
| `enableDebugKeys` | Só informativo (fora do editor) | Teclas do cliente Java |
| `honeySlatherAlphaChance` / `honeySlatherShinyChance` | FEITO | `spawning/HoneyLog.ts` |
| `maxDynamaxLevel` | Só informativo (fora do editor) | Sem Dynamax |
| `maxVerticalSpace` | FEITO | `Spawner.resolvePositions`: altura das posições limitada, como `getHeight(..., maxVerticalSpace)`; a caixa do hitbox segue usando a coluna livre |
| `minimumRidingScale` | Pedido G | `entity/Riding.ts` (motor) |
| `playerDamagePokemon` | FEITO (frente motor) | `scripts/world/PokemonDamage.ts` |
| `savePokemonToWorld` | FEITO | `GameplayHooks.ts`: com a config desligada, selvagem sem dono, fora de batalha e de pasto, sai ao recarregar do disco (`entityLoad`) |
| `shinyNoticeParticlesDistance` | FEITO | `ProximityEffects.ts` |
| `teraTypeRate` | FEITO | `rollTeraType` |
| `unlockAllMoveDexMovesByDefault` | Só informativo (fora do editor) | O Move Dex não existe no port |
| `walkingInBattleAnimations` | Só informativo (fora do editor) | MoLang de animação do cliente Java |

`INFO_ONLY_FIELDS` (`Config.ts`) lista os 5 campos que saíram do editor. Eles continuam no JSON.

## Arquivos fora da lista da frente que precisei tocar (conferir na integração)

- `scripts/PokemonProperties.ts` (sem dono declarado): features inteiras (`gimmighoul_coins=999`) no `match`, features
  de escolha com aspect (`netherite_coating=stageN`) no `apply` e aspects ponderados mantidos na troca de espécie.
- `scripts/speciesData.ts` (sem dono): só o tipo `EvolutionEntry` ganhou `shedder` e `drops`.
- `tests/interface.test.ts`: as asserções usavam o padrão errado de 30 caixas e exigiam ≥ 90 campos no editor.
  Passaram para 40 caixas (índices 30/31 → 40/41) e ≥ 85 campos, por causa dos 5 informativos que saíram.

## Pedidos para outras frentes

### A. `scripts/battle/Rewards.ts` (sem dono; orquestrador ou ia-npc): drops do selvagem

Em `dropWildLoot(active)`:

```ts
import { getGameRule, getConfig } from "../Config";
import { deliverItem } from "../pokemon/Drops";
// no começo:
if (!getGameRule("doPokemonLoot")) return;            // PokemonServerDelegate: drops só com a gamerule
// ao entregar cada item (no lugar de entity.dimension.spawnItem):
deliverItem(item, { dimension: entity.dimension, location: entity.location, entity, player: /* quem derrotou */ });
```

`dropAfterDeathAnimation = true` atrasa os drops para depois da animação de desmaio: rodar o bloco acima dentro de
`system.runTimeout(..., 30)`, antes do `kill`.

### B. mundo-sons (`scripts/custom_components/HealingMachineComponent.ts`): gamerule `healersHealPC`

Depois de `healPlayerTeam(player)`:

```ts
import { getGameRule } from "../Config";
import { healPlayerPC } from "../pokemonStorage";
if (getGameRule("healersHealPC")) healPlayerPC(player);
```

Para a mensagem "já curado"/"sem Pokémon" considerar o PC, use `canBeHealed(pokemon)`, exportada do mesmo arquivo.

### C. animacao (importador de partículas): brilho de shiny

Copiar para o RP `assets/cobblemon/bedrock/particles/generic/{wild_shiny_ring,shiny_sparkle_ambient_wild,ambient_shiny_sparkle,shiny_ring*}.particle.json`
e as texturas. **Tirar os eventos `sound_effect` delas**, porque o script já toca `particle.*shiny*chime`. Se preferir
manter os eventos, avise para eu parar de tocar os sons em `pokemon/ProximityEffects.ts` (`SHINY_SOUNDS`) e em
`Pokemon.playShinyRing`.

### D. motor: consulta de estrutura

Quando o `isInStructure` existir, registrar no carregamento:

```ts
import { setSpawnStructureLookup } from "./spawning/SpawnConditions";
import { setEvolutionStructureLookup } from "./evolution/requirements/ExtraRequirements";
setSpawnStructureLookup((dimension, location, structures) => structures.some(s => isInStructure(dimension, location, s)));
setEvolutionStructureLookup((pokemon, structure) => {
  const where = pokemon.tryGetPokemonOut() ?? pokemon.tryGetOwner();
  return where ? isInStructure(where.dimension, where.location, structure) : undefined;
});
```

Ids e tags usados pelos dados: `#minecraft:village`, `#cobblemon:ruin`, `minecraft:monument`, `minecraft:igloo`,
`minecraft:swamp_hut` e `minecraft:end_city`. O `main.ts` é desta frente: se preferirem, mandem a função e eu ligo.

### E. ui-base

1. HUD do time: marcar o selecionado com `getSelectedSlot(player)`, e atualizar com
   `onSelectedSlotChanged((player, slot) => ...)`. Os dois vêm de `scripts/pokemon/PartySelection.ts`.
2. `GUI/Party.ts` (menu "Item segurado"): antes de dar o item da mão, recusar com
   `isForbiddenHeldItem(stack.typeId)` e a mensagem `FORBIDDEN_HELD_ITEM_LANG` (`scripts/pokemon/HeldItems.ts`).
3. Resumo (`cobblemon.ui.stats.fullness`, `cobblemon.ui.stats.blocks_traveled`, `cobblemon.ui.stash.*`): mostrar
   - `getFullness(p)/getMaxFullness(p)` (`pokemon/Fullness.ts`);
   - `getBlocksTraveled(p)`, só se `hasBlocksTraveledRequirement(p)`;
   - `getIntFeature(p, "gimmighoul_coins" | "gimmighoul_netherite")`, só no Gimmighoul (`pokemon/SpeciesFeatures.ts`).
4. `GUI/StarterGUI.ts` `getStarterCategories()`: envolver em `sortStarterCategories(...)` (`Config.ts`), para usar
   `StarterCategory.order`.
5. Conquistas: se a API nova tiver advancements de verdade, `setAdvancementLookup((owner, id) => ...)` troca o
   `isProgressGoalDone` usado pelo requisito `advancement`.

### F. mundo-sons (`custom_components/GiveLeftoversComponent.ts`): `appleLeftoversChance`

Trocar a chance fixa 1/16 por `Math.random() < getConfig().appleLeftoversChance` e aplicar às 4 maçãs do Cobblemon,
tag `held/leaves_leftovers` (auditoria §2.1).

### G. motor (`scripts/entity/Riding.ts`): `minimumRidingScale`

Antes de montar: `if (pokemon.getEffectiveScale() < getConfig().minimumRidingScale) return;`
(`PokemonEntity.tryRidingPokemon`).

## Riscos e o que conferir no jogo

- Envio rápido: agachado + pular também é "descer" no voo do criativo. Quem voa agachado e pula solta o Pokémon.
- Agachar duas vezes (8 ticks) troca a seleção. É inofensivo, mas aparece na actionbar.
- Rótulo "???": com o padrão `displayNameForUnknownPokemon = false`, todo selvagem de espécie nunca vista aparece como
  "??? Lv. N", como no Cobblemon. Em multiplayer vale o jogador mais perto.
- Cura ao dormir: depende do pulo da noite. Se o servidor pular a noite por outro meio com alguém deitado, também cura.
- `savePokemonToWorld = false` apaga selvagens salvos ao recarregar chunks, como no Cobblemon. O padrão é true.
- Fome: o embrulho dos comportamentos de item depende de `getItemBehaviour` devolver sempre o mesmo objeto (cache). Se
  a frente de itens trocar isso, `installFullnessHooks` precisa virar chamada direta em `items/usage.ts`.
