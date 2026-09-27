# Pesquisa 5 — Auditoria de paridade (o que o Cobblemon 1.8.2 tem e as tabelas não citam ou marcam errado)

> Data: 2026-09-26. Read-only (nenhum código do projeto alterado). Alvo: Cobblemon 1.8.2 (Java, MC 1.21.1)
> em `upstream/cobblemon` → port Bedrock (`scripts/`, `tools/importer/`, `generated/`).
> Tabelas auditadas: `docs/PARIDADE-MECANICAS.md`, `docs/PARIDADE-ITENS-BLOCOS.md`, `docs/COMANDOS.md`.
> Relatório escrito de forma incremental.

Convenções:
- `K/` = `upstream/cobblemon/common/src/main/kotlin/com/cobblemon/mod/common/`
- `D/` = `upstream/cobblemon/common/src/main/resources/data/cobblemon/`
- `A/` = `upstream/cobblemon/common/src/main/resources/assets/cobblemon/`
- Status do port: **AUSENTE** (não há nada) · **PARCIAL** · **FEITO (não listado)** (existe no código mas a tabela
  não cita) · **ERRADO NA TABELA** (a tabela diz FEITO e o código não faz) · **NÃO POSSÍVEL**.
- Tamanho: S (≤1 dia) / M (2–5 dias) / L (>1 semana).

**Status: concluído.** Resumo: ~130 lacunas/divergências; 10 de impacto Alto (a maioria S/M), 34 de impacto
Médio; 14 linhas FEITO das tabelas deveriam ser PARCIAL/AUSENTE (§7.4). Backlog consolidado em §7.

## 1. Método e fontes varridas

1. **Changelogs** `upstream/cobblemon/changelogs/CHANGELOG-1.5.0.md` … `CHANGELOG-1.8.1.md` e `CHANGELOG.md`
   (1.8.2): cada bullet de Additions/Changes com efeito para jogador ou datapack foi conferido por `grep` em
   `scripts/`, `tools/importer/` e `generated/` (§2).
2. **Código Kotlin/Java**: registries (`CobblemonItems/Blocks/Entities/Sounds/…`), `CobblemonConfig.kt`,
   `CobblemonKeyBinds.kt`, `CobblemonGameRules.kt`, `CobblemonCommands.kt`, `api/molang/function/*`,
   `mixin/**` (integrações com o vanilla), `api/spawning/influence/*`, `Pokemon.kt` (fome) e todas as pastas de
   `D/` (§3, §4).
3. **Assets**: `A/sounds.json` × `sound_definitions.json` e referências dos scripts; `A/bedrock/particles/**`
   (~1.100 partículas Snowstorm) × `generated/resource_packs/.../particles` (57).
4. **Relatórios do importador**: `generated/import-report.json` e `generated/content-report.json`.
5. **Web**: wiki.cobblemon.com, cobblemon.com, GitLab, Modrinth/CurseForge, Reddit/YouTube (§5).
6. **Conferência de 22 linhas FEITO** contra o código (§6).

Limites: nada foi testado no jogo/BDS; "ausente" significa que o `grep` não achou implementação.

## 2. Changelogs 1.5.0 → 1.8.2 (item a item)

Só lacunas e divergências. Itens claramente portados e cobertos pelas tabelas foram omitidos.

> **Aviso de versão (web, §5):** em 2026-09-26 a última versão publicada (Modrinth e tags do GitLab) é a
> **1.8.1**. A seção "1.8.2" do `CHANGELOG.md` no `main` ainda tem data "MONTH xth, 2026". Os itens de 1.8.2
> abaixo podem mudar até o lançamento.

### 2.1 1.5.0 / 1.5.1 / 1.5.2

| Versão | Feature | Fonte Cobblemon | Status no port + evidência | Ideia Bedrock | Tam | Impacto |
|---|---|---|---|---|---|---|
| 1.5.0 (+1.5.1) | Stash de moedas do Gimmighoul → evolução em **Gholdengo** (`gimmighoul_coins=999`) | `K/pokemon/feature/StashHandler.kt`, `D/species_features/gimmighoul_coins.json` (`itemPoints`), `species/.../gimmighoul.json` (`property_range`) | **AUSENTE, e a tabela está errada**: grep `stash`/`itemPoints`/`gimmighoul_coins` em `scripts/` = 0; `property_range` é `UntrackedRequirement` (sempre verdadeiro), e `PokemonProperties.ts` só entende a feature `cocoon_species`, então **Gholdengo nunca sai**; as Relic Coins ficam sem uso | feature inteira no `PokemonData`; dar moeda/netherite ao Gimmighoul (item segurado/interação); importar `species_features` inteiras | M | **Alto** |
| 1.5.0 | Vivillon Poké Ball exige o advancement `collect_all_vivillon` | `spewpa.json` (`variant: advancement`) | **PARCIAL**: `evolution/requirements/index.ts:47` trata advancement como sempre cumprido; `Progress.ts` já calcula `collect_all_vivillon` | `AdvancementRequirement` consultando `Progress.ts` | S | Médio |
| 1.5.0 | Colher apricorn **com soco** (sem quebrar a árvore) | `K/block/ApricornBlock.kt` (`attack` → `harvest`) | **AUSENTE, tabela otimista** ("Apricorns FEITO"): só a interação colhe; quebrar o apricorn maduro usa loot vazio → **não dá nada** | `beforeEvents.playerBreakBlock` no apricorn maduro: cancela, dropa, volta à idade 0 | S | Médio |
| 1.5.0 | Semente de apricorn plantada na lateral das folhas | `K/item/ApricornSeedItem.kt` | AUSENTE: `block_placer` só aceita terra | `onUseOn` na folha → coloca o apricorn idade 0 | S | Médio |
| 1.5.0 | Illusion/Imposter/Transform mudam o visual (e a Pokédex não revela o disfarce) | `K/battles/interpreter/instructions/*` | AUSENTE: `handleTransformInstruction` só manda mensagem | trocar `cobblemon:variant`/espécie da entidade durante o efeito | M | Médio |
| 1.5.0 / 1.5.1 | Animação de arremesso ao enviar + VFX por bola | `A/bedrock/particles/balls/**` (346) | AUSENTE: `Pokemon.sendOut` cria a entidade e toca som | projétil até o ponto + partículas (formato Snowstorm nativo) | M | Médio |
| 1.5.0–1.6.0 | Animações de golpe, partículas de status e de stat up/down | `D/action_effects`, `A/bedrock/particles/{moves,generic}` | AUSENTE (ver §3) | ver §3 | L | Alto |
| 1.5.0 | Luz dinâmica de Pokémon (`lightingData`, 88 espécies: Charmander, Chinchou…) | `species/*.json` `lightingData` | **AUSENTE e não listado** (grep 0) | bloco `minecraft:light_block` seguindo a entidade por script (reposicionar a cada N ticks) | M | Médio |
| 1.5.0 (+1.6.0) | Resource packs embutidos: **viés regional** (iniciais Hisui do menu, Cubone/Exeggcute Alola…), **Gyarados Jump**, **shiny únicos** | `resources/resourcepacks/{regionbiasforms,gyaradosjump,uniqueshinyforms}` | **AUSENTE e não listado**: o importador não lê `resourcepacks/`; os iniciais "Hisui Bias" do `StarterConfig` aparecem com o visual normal | importar como variações extras (ligadas por padrão como no Fabric) | M | Médio |
| 1.5.1 (+1.6.1) | Tingir Wooloo/Dubwool com corante (balde limpa) | `PokemonEntity.kt:1242` | AUSENTE: nada define `color-*`; só é lido na tosquia | interação corante → aspect `color-x` | S | Médio |
| 1.5.0 | Sherds em vaso decorado | tag `decorated_pot_sherds` | **Tabela otimista** ("sherds… FEITO"): só item | NÃO POSSÍVEL (vaso vanilla) → corrigir a tabela | – | Baixo |
| 1.5.0 | Leftovers ao comer maçã (`appleLeftoversChance`, tag `held/leaves_leftovers`) | `mixin/PlayerMixin.java:211` | PARCIAL: só no override de `minecraft:apple`, chance fixa 1/16, ignora maçãs do Cobblemon | ler a config; aplicar às 4 maçãs do Cobblemon | S | Baixo |
| 1.5.0 | Spawn rules (datapack) | `D/spawn_rules`, `K/api/spawning/rules` | AUSENTE (o 1.8.2 só traz 1 exemplo desativado) | só para datapacks | M | Baixo |
| 1.5.0 | Feto no tanque de restauração | `A/bedrock/fossils` | AUSENTE | entidade auxiliar com a geo | M | Baixo |
| 1.5.0 | Propriedades `originaltrainer=`/`originaltrainertype=` | `PokemonProperties.kt` | PARCIAL: caem em `extra` e quebram o `match` | casos no parse/apply | S | Baixo |

### 2.2 1.6.0 / 1.6.1

| Versão | Feature | Fonte Cobblemon | Status no port + evidência | Ideia Bedrock | Tam | Impacto |
|---|---|---|---|---|---|---|
| 1.6.0 | **"Shedders"**: Nincada → Ninjask + Shedinja (com espaço no time e Poké Ball no inventário) | `nincada.json` (`"shedder"`) | **AUSENTE, tabela errada** ("Evolução FEITO"): grep `shedder` = 0; Shedinja só por comando | no fim da evolução: se tem espaço e bola, consome a bola e cria Shedinja | S | Médio |
| 1.6.1 / 1.8.0 | **Drops de evolução** (`drops` tipo `evolution` em 67 espécies: Shed Shell, Turtle Scute, **Shell Helmet** do Karrablast) | `api/pokemon/evolution/Evolution.kt:86,234` | **AUSENTE**: dados chegam em `generated/scripts/species.ts`, `scripts/evolution/**` não usa → Karrablast→Escavalier em single-player fica impossível | sortear e entregar no fim de `Evolution.ts` | S | Médio |
| 1.6.0 | PvP de nível fixo (5/50/100) | `BattleConfigureGUI.kt` (`adjustLevel`) | AUSENTE para jogadores (`cloneForBattle({setLevel})` só em NPC) | opção no formulário e em `/pokebattle` | S | Médio |
| 1.6.0 | Balsa/plataforma para Pokémon que não nada nem voa em batalha na água | `K/entity/PlatformType.kt` | **AUSENTE e não listado** | entidade plataforma sob o Pokémon | M | Médio |
| 1.6.0 | Posições de envio inteligentes (virado para o oponente) | `BattleSide` | PARCIAL: `sendOut` sempre `facingLocation: owner` | rotação para o oponente, posição por slot | S | Baixo |
| 1.6.0 | Brilho/som de shiny selvagem | `particles/generic/*shiny*` | AUSENTE (ver §4.1) | — | S | Alto |
| 1.6.0 / 1.6.1 | Rótulos de entidade configuráveis e "???" | `CobblemonConfig.kt:208-217` | AUSENTE (ver §4.1) | — | S | Baixo |
| 1.6.0 | Gamerules `battleInvulnerability`, `mobTargetInBattle` | `CobblemonGameRules` | AUSENTE (ver §4.3) | — | S/M | Médio |
| 1.6.0 | Propriedades `aspect`/`unaspect`, `type`/`elemental_type`, `no_ai`, `freeze_frame` | `PokemonProperties.kt` | AUSENTE (caem em `extra`); `COMANDOS.md` não cita | casos no parse/apply/match | S | Baixo |
| 1.6.0 | Golpe copiado por **Sketch** fica depois da batalha | `ActivateInstruction.kt:93` | AUSENTE (grep `sketch` = 0) → Smeargle inútil | no `-activate … Sketch`, trocar o golpe no `PokemonData` | S | Médio |
| 1.6.0 | Hidden Power / -ate / Normalize mostram o tipo efetivo | UI de batalha | AUSENTE: `GUI/Battle.ts:211` usa o tipo base (dica de efetividade erra) | usar o tipo do request do sim | S | Baixo |
| 1.6.0 | Mensagem de troca no log (`cobblemon.battle.switch.*`) | lang | AUSENTE | broadcast em `handleSwitchInstruction` | S | Baixo |
| 1.6.0 | Animação/som da troca entre jogadores | GUI de trade | PARCIAL: `TradeUI.ts:135` toca `random.levelup` em vez de `cobblemon.gui.trade` | trocar o id | S | Baixo |
| 1.6.0 / 1.6.1 | Callbacks MoLang genéricos (`D/callbacks`), `q.has_aspect` em posers | `D/callbacks`, `api/molang` | PARCIAL: callbacks do jogo base portados à mão; `tools/importer/posers.ts:229` converte `has_aspect` em `"0.0"` | executor genérico nos ganchos de evento | L | Baixo |
| 1.6.1 | Fortuna em sementes de mint e minérios | `loot_table/blocks/*` (`apply_bonus`) | AUSENTE: `tools/importer/loot.ts:142` descarta `apply_bonus` | `onPlayerBreak` lendo o encantamento | S | Baixo |
| 1.6.1 | Pinturas crossover (4) | `D/painting_variant` | AUSENTE | NÃO POSSÍVEL como pintura | – | Baixo |
| 1.6.1 | Pokédex na estante entalhada; dispenser tosquia berry/apricorn | tags / `attemptShear` | AUSENTE | NÃO POSSÍVEL (motor fixo) → registrar | – | Baixo |

### 2.3 1.7.0 → 1.7.3

| Versão | Feature | Fonte Cobblemon | Status no port + evidência | Ideia Bedrock | Tam | Impacto |
|---|---|---|---|---|---|---|
| 1.7.0 | **Aprijuice dá ride boosts** (por sabor/natureza) | `K/item/food/AprijuiceItem.kt`, `D/mechanics/aprijuices.json` | **PARCIAL, tabela otimista**: a panela grava `rideBoosts` (`cookingLogic.ts:215`), mas `scripts/items/food.ts:5-6` diz "montaria ainda não existe no port" (comentário velho: `Riding.ts` existe) → só bebida | boosts no `PokemonData`, aplicados em `Riding.ts` | M | **Alto** (montaria é a feature-vitrine do 1.7) |
| 1.7.0/1.7.1 | Sprint na montaria terrestre (duplo toque, FOV) | `api/riding/behaviour/types/land/*` | AUSENTE (`Riding.ts:11`) | `isSprinting`/`inputInfo` → component group de velocidade | M | Médio |
| 1.7.2 | `enableInFlightDismounting` (padrão: **não** desmonta em voo) | `CobblemonConfig.kt:369` | **DIVERGE**: agachar sempre desmonta (equivale à config ligada) → queda mortal fácil | remontar por script se estilo AIR e config desligada | S | Médio |
| 1.7.0/1.7.2 | Sons de montaria; overlay de controles; câmera lembrada/roll/freelook | `rideSounds`, `RideControlsOverlay.kt` | AUSENTE / NÃO POSSÍVEL (câmera) | sons em loop; controles na actionbar ao montar | S | Baixo |
| 1.7.2 | Estilo e atributos de montaria na Pokédex e no resumo | `client/gui/pokedex/*`, `summary/*` | AUSENTE | linha "Montaria: Terra/Ar/Água + stats" de `ENTITY_INFO.ride` | S | Médio |
| 1.7.0 | Panela na fogueira: redstone abre/fecha tampa, funil (topo temperos/lados grade/base extrai), observador, comparador | `K/block/campfirepot/*` | **AUSENTE, tabela otimista** ("Panela FEITO") | redstone por `onTick`; funil em bloco custom sem container = NÃO POSSÍVEL | M | Médio |
| 1.7.0 | Tasty Tail (tesoura no Slowpoke, regrowth) | `SlowpokeTailRegrowthSpeciesFeature.kt` | AUSENTE (ver §3.6) | — | S | Médio |
| 1.7.0 | **Tora de saccharine com mel** atrai spawn (HA 5%, shiny/alfa, `honey_drenched`) | `SaccharineLogSlatheredInfluence.kt` | **AUSENTE, tabela otimista** (ver §4.1) | influência no `Spawner.ts` | M | Alto |
| 1.7.2 | Temperos White Herb/Mental Herb/leite (efeitos `cleanse_*`, `mental_restoration`) | `CobblemonMobEffects.kt` | PARCIAL (ver §3.4) | — | S | Baixo |
| 1.7.0 | Mudas de apricorn/saccharine/Pep-Up em vaso | blocos `potted_*` | PARCIAL: blocos gerados, mas sem como plantar no vaso (0 hits `flower_pot`) | script no vaso vanilla (`playerInteractWithBlock`) troca pelo `potted_*` | S | Baixo |
| 1.7.0 | Compostagem (41 itens) | `CobblemonItems.kt` (`compostableItem`) | AUSENTE (0 `minecraft:compostable`) | importador emite o componente | S | Baixo |
| 1.7.0 | Braised Vivichoke removido | changelog | **Resto do CobbleBuild**: `behavior_packs/.../items/generic/braised_vivichoke.json` + 3 receitas | apagar | S | Baixo |
| 1.7.0 | Tags `held/blacklisted_items_to_hold`/`whitelisted_items_to_hold` | `D/tags/item/held/*` | **AUSENTE com risco de perda**: `Party.ts:showHeldItemMenu` guarda só `typeId` → shulker/bundle com conteúdo perde os itens | checar a tag e bloquear containers | S | Médio |
| 1.7.0/1.7.2 | PokemonProperties `scale_modifier`, `tag`/`label` | `PokemonProperties.kt` | PARCIAL: caem em `extra` | ler no create/apply | S | Baixo |
| 1.7.0 | Raio: Lightning Rod atrai, Motor Drive, Volt Absorb, Terra imune; Mooshtank troca de cor | `PokemonEntity.kt` (thunderHit), `miltank.json` (`lightningHit`) | AUSENTE | `entityHurt` com causa `lightning` | M | Baixo |
| 1.7.0 | Combee poliniza | `behaviours/pokemon/pokemon_bee.json` | AUSENTE (ver §4.6) | — | M | Baixo |
| 1.7.0 | Pasto: dormir, vir ao jogador, **"atacar hostis"** | `behaviours/attack_hostile_mobs.json`, `molang/home_walk_task.molang` | PARCIAL, tabela otimista ("Pasto FEITO") | toggle + `nearest_attackable_target` | M | Médio |
| 1.7.0 | **Behaviours de NPC** (anda, conversa, luta, usa healer…) + Behaviour Editor | `D/behaviours/**` | **AUSENTE, tabela otimista** ("NPCs FEITO"): NPC estacionário (`tools/importer/npcs.ts:254`) | component groups vanilla por behaviour | L | Médio |
| 1.7.0 | NPC com modelo de Pokémon e vice-versa | `NPCEntity.resourceIdentifier` | AUSENTE | — | M | Baixo |
| 1.7.0 | Cor da cauda do Smeargle pela Characteristic | `PokemonAspects.kt:154` | AUSENTE: variações `rainbow-*` geradas, aspect nunca aplicado | calcular por maior IV ao criar | S | Baixo |
| 1.7.0 | Luz por estado: pasto ligado (13), monitor ligado (13), atril com Pokédex | `CobblemonBlocks.kt:775,817` | AUSENTE (sem `light_emission` nas permutações) | permutações com `minecraft:light_emission` | S | Baixo |
| 1.7.0 | Item segurado visível | — | AUSENTE (ver §2.4) | — | L | Médio |
| 1.7.0 | Partículas de ~100 golpes (`action_effects`) | — | AUSENTE (ver §3.0/§3.3) | — | L | Alto |
| 1.7.0 | **Texturas animadas** de Pokémon (`fps`: chamas de Charmander/Ponyta/Magcargo, Toxel…) | resolvers (17 com `fps`) | PARCIAL: `tools/importer/variants.ts:58-60` fica no 1º quadro (40 texturas) | `uv_anim`/flipbook no render controller | M | Médio |
| 1.7.0 | **Evolução por passos** (`blocks_traveled`: Pawmo, Rellor, Bramblin) + contador | `BlocksTraveledRequirement` | **DIVERGE, tabela errada**: `UntrackedRequirement` sempre true → evolui sem andar | reusar o medidor do `mark_partner` por Pokémon | S | Médio |
| 1.7.0 | Level-up no overlay (sem chat) | `PartyOverlay` | DIVERGE: `Rewards.ts:99` manda no chat | actionbar/título | S | Baixo |
| 1.7.0 | Markings; ordenar PC; filtro por nome parcial; reabrir última caixa | `client/gui/pc/*`, summary | AUSENTE/PARCIAL (ver §5); `"cha"` vira aspect e não casa; `openPCGui` abre na caixa 0 | — | S | Médio |
| 1.7.0 | **`defaultBoxCount` passou de 30 para 40** | `CobblemonConfig.kt:67` | **ERRADO**: `scripts/Config.ts:83` = 30 (e a tabela diz "PC (30 espaços")) | trocar o padrão para 40 (mundos existentes mantêm) | S | Médio |
| 1.7.0 | Advancements novos (We Need To Cook, Pokémon Jockey!, That's Bait…) | `D/advancement/**` | PARCIAL (ver §3.5) | — | M | Baixo |
| 1.7.2 | **IA de batalha**: troca mais esperta, golpe mais forte com HP baixo, Trick Room, status, anti-boost | `K/battles/ai/StrongBattleAI.kt` (986 linhas) | **PARCIAL, tabela otimista**: `scripts/battle/ai/StrongBattleAI.ts` tem 168 linhas ("versão enxuta") | portar `shouldSwitchOut`, `findAndUseMostDamagingMove`, `considerInflictingStatus` | M | Médio |
| 1.7.0 | `/pokedex printcalculations` sem dex = Nacional | `PokedexCommand.kt` | DIVERGE (`PokedexCommand.ts:72` lista todas) | padrão `national` | S | Baixo |
| 1.7.0 | `/npcdelete <uuid>` pelo console; `/pctake` apaga se alvo = executor/console | `NPCDeleteCommand.kt`, `PcTakeCommand.kt` | PARCIAL/DIVERGE (`commands.ts:211-217`, `:808+`) | parâmetro de entidade; ramo de exclusão | S | Baixo |
| 1.7.0 | `/changejointscale`, `/calculateseatpositions` | `command/*` | NÃO POSSÍVEL, mas **faltam em "Ainda não portados"** do `COMANDOS.md` | documentar | S | Baixo |
| 1.7.0/1.7.2 | MoLang de datapack (`q.file.*`, strings, `delete_variable`, `give_item`, `get_move_from_id`, args de `run_script`) e callbacks genéricos (~45 eventos) | `api/molang/*`, `D/callbacks/**` | PARCIAL (ver §4.4) | — | M | Baixo |
| 1.7.3 | Requisito `chance` em interações | `api/interaction/requirements` | AUSENTE (nenhum dado base usa) | case em `Interactions.ts` | S | Baixo |

### 2.4 1.8.0 / 1.8.1 / 1.8.2

1.8.1 só tem correções; as das bolas (Beast, Moon, Love, Timer, Luxury) já estão em `scripts/catching/StandardModifiers.ts`.

| Versão | Feature | Fonte Cobblemon | Status no port + evidência | Ideia Bedrock | Tam | Impacto |
|---|---|---|---|---|---|---|
| 1.8.0 | **Recompensas ao derrotar Alfa** (loot por nível/tipo, 40 tabelas) | `D/callbacks/battle_fainted/pokemon_alpha_drops.molang`, `D/loot_table/alpha/**` | **AUSENTE, tabela errada** (Alfa "FEITO"): o callback só existe como texto em `generated/scripts/npcs.ts`; `generated/.../loot_tables/cobblemon/` só tem `fossils/injection/ruins/shipwreck_coves` | importar `loot_table/alpha`; no desmaio do Alfa selvagem, `dimension.runCommand("loot spawn … loot cobblemon/alpha/…")` | S | **Alto** |
| 1.8.2 | **Vestíveis** no jogador (19 itens: clique direito equipa na cabeça) e no Pokémon | `K/item/WearableItem.kt`, `WearableHatItem.kt`, `CobblemonItems.kt:916-934`, `A/models/item/wearable/*` | **AUSENTE, tabela errada**: 0 itens com `minecraft:wearable`, 0 attachables; "Cosméticos/wearables (chapéus) FEITO" confunde com `cosmetic_items` | `minecraft:wearable` (`slot.armor.head`) + attachable com a geo de `item/wearable` | M | Médio |
| 1.7.0 / 1.8.0 | **Item segurado visível** no modelo (locators `item_hat`/`item_face`, ~750 modelos; tags `held/visibility/*`; `held_item_visible`) | `K/client/render/item/HeldItemRenderer.kt:69-110` | **AUSENTE e não listado** | osso de item na geo (a partir dos locators) + equipamento da entidade/attachable | L | Médio |
| 1.8.2 | Ring Target / Metronome / Eject Button com **redstone** | `K/block/RingTargetBlock.kt`, `ActivatableDecorationBlock.kt:123-135`, `EjectButtonBlock.kt` | **PARCIAL**: blocos existem; `ButtonComponent.ts` só alterna `cobblemon:pressed` ("not like these blocks are functional anyways"); 0 `redstone_producer` em `generated/`. **Botões e placas de pressão de apricorn/saccharine também não emitem redstone** | `minecraft:redstone_producer` por permutação; `projectileHitBlock` no Ring Target | M | Médio |
| 1.8.2 | 10 espécies novas (Snover, Abomasnow, Tympole…, Grubbin…, Greavard, Houndstone) | `species/**` sem `implemented: true` e sem spawns | AUSENTE, **bloqueado no upstream** (o importador pula `implemented != true`) | reimportar quando o upstream liberar | S | Médio |
| 1.8.2 | Itens colocáveis como bloco (34 + orbes/ímã/coroa) | `CobblemonBlocks.kt:616-758` | **FEITO, não listado** (Never-Melt Ice sem atrito 0,989) | adicionar linha na tabela | S | Baixo |
| 1.8.0 | **Move Dex** na Pokédex (+ config `unlockAllMoveDexMovesByDefault`) | `K/client/gui/pokedex/widgets/MovesLearnsetWidget.kt` | AUSENTE: `PokedexUI.ts` não mostra golpes; config não lida | seção "Golpes" no formulário | M | Médio |
| 1.8.0 | Estante de discos: **sequenciador de note block** e discos visíveis | `DiscShelfBlockEntity.kt:137` | PARCIAL: guarda 14 espaços; sem visual e sem sequenciador | polling de note blocks vizinhos; permutações | M | Baixo |
| 1.8.0 | Sons de montaria (`rideSounds`, 148 espécies) | `species.riding.rideSounds`, `sounds/ride/*` | AUSENTE: `entity/Riding.ts` não toca os 14 `cobblemon.ride.*` | loop de `player.playSound` | S | Baixo |
| 1.8.0 | Tipo Gelo imune a congelamento; aranhas imunes a teia | `PokemonEntity.kt:804`, `:632` | AUSENTE (sem `damage_sensor`) | `damage_sensor` `freezing` no importador; teia NÃO POSSÍVEL (só aproximação) | S | Baixo |
| 1.8.0 | Feature `weighted_choice` (Dudunsparce 3 segmentos, Maushold família de 3) | `D/species_features/{landsnake_form,maushold_family}.json` | AUSENTE: `PokemonProperties.ts:204` só `cocoon_species` | sortear por peso ao criar/evoluir | S | Baixo |
| 1.8.0 | Grito ao clicar no Pokémon no resumo | `ModelWidget` | AUSENTE | botão "Ouvir grito" em `Summary.ts` | S | Baixo |
| 1.8.0 | Campo `order` das categorias de iniciais | `StarterCategory.kt:17` | AUSENTE | ordenar em `StarterGUI.ts` | S | Baixo |
| 1.8.0 | Behaviour "chatter" de NPC | `D/behaviours/npc/chatter_npc.json` | AUSENTE | opção no `NPCEditor.ts` | S | Baixo |
| 1.8.0/1.8.2 | Só datapack: requisito `negate` (e `chance`, `area`, `owner_holds_item`), MoLang novos (`has_chosen_starter`, TM lock/unlock, marks, enchant), `party_pools`/`composed_pool`, camada `scrolling`, assentos condicionais | vários | AUSENTE (os dados base não usam) | só se aceitar datapacks de terceiros | M | Baixo |

Também fora dos changelogs: os requisitos `blocks_traveled`, `advancement` e `property_range` são
`UntrackedRequirement` (sempre passam) em `scripts/evolution/requirements/ExtraRequirements.ts` — isso libera
evoluções cedo demais (Gimmighoul já coberto; `blocks_traveled` afeta Pawmo/Bramblin/Rellor).

## 3. Varredura de registries e dados do código Kotlin

### 3.0 Achados diretos desta sessão (antes da varredura completa)

| O que falta | Fonte Cobblemon | Status no port + evidência | Ideia Bedrock | Tam | Impacto |
|---|---|---|---|---|---|
| **8 espécies implementadas no 1.8.2 fora do port**: tangela, pupitar, lillipup, herdier, jellicent, durant, bounsweet, pyukumuku | posers Kotlin (`K/client/render/models/blockbench/pokemon/gen1/TangelaModel.kt` etc.), modelos em `A/bedrock/pokemon/models/` | AUSENTE: `generated/import-report.json` → `skippedSpecies` "sem animação idle (poser sem JSON e sem convenção)"; nenhuma tabela cita (só o `COMO-JOGAR.md` diz "139 não entram (131 não implementadas)") | fallback no `tools/importer/posers.ts`: usar a 1ª animação `*idle*`/`ground_idle` do `.animation.json` da espécie, ou uma pose parada | S | **Médio/Alto** (espécies capturáveis e spawns delas somem) |
| **Efeitos de golpe/status/impacto em batalha** (`D/action_effects`, 154 timelines) | `D/action_effects/{moves,statuses,damages,activates,starts,misc}`, `A/bedrock/particles/moves/**` (~500 partículas Snowstorm), sons `move.*`/`impact.*`/`status.*` (~200) | AUSENTE: `scripts/battle/Animations.ts:8-11` só toca pose do poser + grito; nenhuma partícula/som de golpe | as partículas **já são formato Bedrock (Snowstorm)**: copiar para o RP no importador e executar a timeline (`playAnimation` + `dimension.spawnParticle` + `playSound` com `system.runTimeout`) | L | **Alto** (batalha é o núcleo; hoje é "muda") |
| **Brilho de shiny** (partículas `wild_shiny_ring`, `shiny_sparkle_ambient_wild`, `ambient_shiny_sparkle`, `shiny_ring1-8` + chimes `particle.*shiny_chime`) e `poke_ball.shiny_send_out` | `K/client/entity/PokemonClientDelegate.kt:412-435`, `A/bedrock/particles/generic/*shiny*` | AUSENTE (grep `shiny` em partículas/sons do port = 0) | ver §4.1 (`shinyNoticeParticlesDistance`) | S | **Alto** |
| **Partículas de bola** (envio/recolha por bola, `casual`/`battle`, captura, `balls/capture/hisui`) | `A/bedrock/particles/balls/**` (~150) | AUSENTE: o port usa partículas vanilla/nenhuma no envio e na captura (tabela de captura diz "Sem o shader de raio (partículas)") | copiar e disparar em `Pokemon.sendOut`/`recall` e na `CaptureSequence` | M | Médio |
| **Partículas de aspect** (`AspectParticleMap`: `honey_drenched` → mel pingando, `poke_snack_crumbed` → migalhas, `has_nectar` → néctar, `alpha_eyes` → brilho nos olhos do Alfa) | `K/api/pokemon/aspect/AspectParticleMap.kt` | AUSENTE (os aspects existem no port, as partículas não) | loop leve por entidade com aspect → `spawnParticle` | S | Baixo/Médio (olhos do Alfa são sinal de perigo) |
| Partículas presas a animações de espécie (Blastoise jato, Krabby bolhas, Ho-Oh cauda, Torkoal fumaça, Lucario aura, Magnezone desmaio, Gastly gás…) | `A/bedrock/particles/pokemon/**` | PARCIAL: `import-report.json` → "partícula sem equivalente no RP (removida)" ×35 | copiar as Snowstorm para o RP; a referência nas animações já existe | S | Baixo |
| Sons customizados de blocos (quebrar/colocar/pisar) | `A/sounds.json` `block.*` | AUSENTE: `blocks.json` só `"sound":"stone"` etc. | `block_sounds` no `sounds.json` do RP (sets custom apontando para `sound_definitions`) + `"sound": "<set>"` | S | Baixo |

### 3.1 Entidades (`K/CobblemonEntities.kt`, 7 tipos)

| Tipo | O que falta | Status no port + evidência | Ideia Bedrock | Tam | Impacto |
|---|---|---|---|---|---|
| `pokemon` | 8 espécies implementadas sem entidade | ver §3.0 | — | S | Médio/Alto |
| `boat` / `chest_boat` | **Barcos de apricorn/saccharine (4 itens) não fazem nada** | **ERRADO NA TABELA** ("Madeira … barcos FEITO"): `generated/.../items/cobblemon/apricorn_boat.json` só tem nome/ícone/tag; nenhuma entidade nem script | entidade com `runtime_identifier: "minecraft:boat"` (e `chest_boat`) + textura; item com `minecraft:entity_placer` | M | Médio |
| `generic_bedrock` | só renderer/teste | N/A | — | – | – |
| `empty_pokeball`, `poke_bobber`, `npc` | — | OK (49 bolas, bobber, npc) | — | – | – |

### 3.2 Sons (`A/sounds.json` 2.503 eventos; `K/CobblemonSounds.kt` 189)

Definições: 2.471/2.503 no RP (faltam 32 `pokemon.*` de formas não importadas). **Uso**: dos 189 ids do Kotlin
só ~62 são tocados; dos ~394 eventos não-espécie, ~311 nunca são referenciados (move 167, block 81, impact 18,
ride 14, status 7, entity 5, gui 4, particle 4, pc 3, poke_ball 3). Detalhe dos mais relevantes:

| Grupo | Onde deveria tocar | Status | Ideia | Tam | Impacto |
|---|---|---|---|---|---|
| `block.*` (81): tumblestone, gems, tatami, gilded_chest open/close, campfire_pot, display_case, tm_machine, monitor, relic coins, cultivos | quebrar/colocar/pisar/abrir | AUSENTE: `blocks.json` só usa sets vanilla; `resource_packs/.../sounds.json` = `{}` | `block_sounds` custom no `sounds.json` do RP + eventos de máquina por script | S–M | Médio |
| `gui.levelup`, `gui.levelup_start` | subir de nível | AUSENTE (`Experience.ts` sem som) | `player.playSound` no level-up | S | Médio |
| `poke_ball.throw`, `poke_ball.trail`, `poke_ball.shiny_send_out` | arremesso; soltar shiny | AUSENTE (`CaptureSequence.ts:32`, `Pokemon.ts:1392`) | tocar no `itemUse` e no `sendOut` de shiny | S | Médio |
| `particle.*shiny_chime` (4) | shiny selvagem por perto / soltar shiny | AUSENTE | ver §4.1 | S | Alto |
| `move.*`/`impact.*`/`status.*` (192) | efeitos de golpe | AUSENTE | ver §3.0 (`action_effects`) | M–L | Alto |
| `ride.loop.*` (14) | montaria | AUSENTE | loop por estilo | S | Baixo |
| `pc.grab/drop/release`, `gui.click`, `gui.trade` | PC, UI, troca | AUSENTE/trocado por vanilla | tocar nas ações dos formulários | S | Baixo |
| `entity.npc.gibber.*`, `entity.villager.work_nurse`, `pokemon.gimmighoul.give_item`, `item.berry.eat.full`, `item.pokedex.scan_zoom_increment` | falas de NPC, extras | AUSENTE | gibber por linha de diálogo | S | Baixo |
| Dívida: 283 chaves sem prefixo no `resource_packs/.../sound_definitions.json` manual (CobbleBuild) duplicam `cobblemon.*`; scripts misturam (`"pc.on"`, `"poke_ball.send_out"`) | — | funciona hoje (as duas existem) | migrar scripts para `cobblemon.*` e aposentar o arquivo manual | S | Baixo |

### 3.3 Partículas (`A/bedrock/particles`: 1.104 Snowstorm; port: 57)

Divisão upstream: moves 610, balls 346, generic 69 (21 ailments), pokemon 33, fishing 9, misc 3, cooking 2,
activates 2. O importador só copia `^(evo_|poodle_hair_)` (`tools/importer/particles.ts`) + as de pesca.

| Grupo | Status | Ideia | Tam | Impacto |
|---|---|---|---|---|
| Shiny (`shiny_ring*`, `wild_shiny_ring`, `ambient_shiny_sparkle`, `shine_sparkle*`) — usado em `EmptyPokeBallEntity:411`, `Pokemon.kt:915`, `BattleSide.kt:44` | AUSENTE | copiar + `spawnParticle` no spawn/sendOut de shiny | S | **Alto** |
| Bolas (`balls/**` 346: feixe, estrelas, `capturesparks`, send-out/recall por bola) | AUSENTE: `CaptureSequence.ts` usa `minecraft:endrod`/`villager_happy`/`critical_hit_emitter` | importar `capture/*` e `<bola>/casual` | M | Médio |
| Status/boosts em batalha (`generic/ailments` 21, `statup/statdown_*`) | AUSENTE | `spawnParticle` em `-status`/`-boost` | S–M | Médio |
| Golpes (`moves/**` 610, `impact_*` 18) | AUSENTE | começar por `impact_<tipo>` genérico; depois timelines | L | Alto |
| `evo_*` (13) e `poodle_hair_*` (16) | **copiadas mas não usadas** (`EvolutionEffect.ts:30` usa vanilla; `Interactions.ts:217` tem comentário desatualizado) | trocar os ids | S | Baixo |
| `cooking/broth_*`, `alpha_eyes*`, `alphaboost_*`, `heal_circles`, `heal_sparkles` | AUSENTE | panela, Alfa e Healing Machine por script | S | Baixo |

### 3.4 Efeitos de status (`K/CobblemonMobEffects.kt`: 3)

| Efeito | Status | Ideia | Tam | Impacto |
|---|---|---|---|---|
| `cleanse_negative`, `cleanse_all`, `mental_restoration` (temperos White Herb, leite, Moomoo Milk, Mental Herb) | **AUSENTE, descartado em silêncio**: `scripts/items/food.ts:89` faz `addEffect` em try/catch e ignora ids `cobblemon:*` | tratar os 3 no script (remover efeitos negativos/todos por N ticks); sem ícone (Bedrock não tem efeito custom) | S | Médio |

### 3.5 Advancements e critérios

804 JSON em `D/advancement`: 743 são desbloqueio de receita (o port já usa `unlock` em 915 receitas) e **61 são
conquistas** (5 raízes → 56 objetivos). O "Progresso Cobblemon" (`scripts/pokedex/Progress.ts:62-75`) cobre **13**.
Faltam 43: catching (14: `craft_basic/apricorn/ancient/all_balls`, `craft_rod`, `craft_master_rod`,
`interact_with_pokemon`, `max_level_baby`, `ride_pokemon`, `max_ride_stats`, `slather_saccharine`,
`trade_shelmet_karrablast`, `use_pasture`, `use_poke_bait`), **agriculture inteira** (19: `brew_*`, `cook_*`,
`harvest_apricorn`, `obtain_*berry*`, `obtain_revival_herb`, `place_campfire_pot`, `plant_all_apricorn_sprouts`,
`use_exp_candy/iv_candy/mint/revive/healing_machine`) e geological (10: `obtain_fossil`, `obtain_tm`,
`obtain_ancient_tm`, `register_all_tms`, `obtain/plant_tumblestone`, `plant_type_gem`, `resurrect_galar_fossil`,
`download_porygon`, `construct_note_block_sequencer`). ~13 de 24 critérios (`K/advancement/criterion`) não são
rastreados. Ideia: abas novas no Progresso com contadores por evento — M, impacto Baixo (conquistas nativas: NÃO
POSSÍVEL). **Estatísticas** (`K/api/stats/CobblemonStats.kt`, 19: shinies capturados, batalhas vencidas,
lançamentos de vara, distância montado…) — AUSENTE; dynamic properties + tela na Pokédex, S, Baixo.

### 3.6 Outros registros e mecânicas de dados

| Registro | O que falta | Status + evidência | Ideia | Tam | Impacto |
|---|---|---|---|---|---|
| **Slowpoke Tail** (`D/mechanics/slowpoke_tails.json`, `K/pokemon/feature/SlowpokeTailRegrowthSpeciesFeature.kt`) | tosar Slowpoke dá `tasty_tail`, cauda regenera em 1.200 s | **AUSENTE** (grep `slowpoke`/`tasty_tail` em `scripts/` = 0) → `tasty_tail` e o curry de cauda **inobtíveis** no survival | ramo em `tryShear` (`scripts/entity/Interactions.ts:283`) + timer no `PokemonData` | S | Médio |
| Aprijuice → ride boosts (`D/mechanics/aprijuices.json`) | dar Aprijuice ao Pokémon aumenta stats de montaria | PARCIAL: dados importados; `scripts/items/food.ts:124` "é só bebida" | aplicar `statEffects` no uso sobre o Pokémon | S | Baixo |
| Compostáveis (15) / inflamáveis (8 blocos de madeira/folha sem `minecraft:flammable`) | composteira; fogo | AUSENTE / PARCIAL (`tools/importer/blocks.ts:433` filtra por classe) | `minecraft:compostable`; ampliar o filtro | S | Baixo |
| Tags de comida vanilla (fox/horse/chicken/parrot/piglin_loved/bee_growables) | berries para raposa, maçãs para cavalo, relic coins para piglin | AUSENTE | overrides de entidade | M | Baixo |
| `species_feature_assignments` (87) | feature padrão fora do spawn (comando/inicial): Basculin, Alcremie, Burmy… | não consumida | importar | S | Baixo |
| `global_species_features` (`blocks_traveled`) | contador visível e requisito | PARCIAL (requisito é `Untracked`) | contador por Pokémon no time | S | Médio |
| `held_items/eggantberry.js` | efeito da Eggant Berry segurada em batalha | só como item de mochila (`BagItems.ts:107`) | registrar no dex do `@pkmn/sim` | S | Baixo |
| `behaviours` (49) | presets de IA por espécie/NPC | não consumida (IA fixa nos componentes); ver §4.6 | mapear presets → component groups | L | Médio |
| Creative tabs (7 + 8 injeções) | grupos no inventário criativo | AUSENTE (só `category`) | `crafting_items_catalog.json` com grupos | M | Baixo |
| Dispenser (mel/água em saccharine), pinturas (4), trim `automaton`, padrões de vaso, Enfermeira, injeção em vilas | — | — | NÃO POSSÍVEL (registrar nas tabelas) | – | Baixo |
| Sem lacuna | enchantments, banners, discos, caldeirão (nada registrado no 1.8.2); descascar tronco; brewing; worldgen | OK | — | – | – |

## 4. Config, keybinds, gamerules, MoLang e comandos

### 4.1 Config (`K/config/CobblemonConfig.kt`, 111 campos `var`) × `scripts/Config.ts`

Método: para cada campo do Kotlin, `grep -w` em `scripts/Config.ts` (declarado?) e em todo `scripts/` +
`generated/scripts/` fora de `Config.ts`/`ConfigEditor.ts` (alguém lê?). Resultado: **88 declarados, 67 lidos**.
A linha "Config do Cobblemon (~95 campos, editor, comando) — FEITO" da tabela de mecânicas está
**otimista**: 21 campos existem no editor mas **nenhum código os lê** (mudar no editor não faz nada) e 20 nem
existem (23; a maioria é de cliente/câmera Java, sem sentido no Bedrock).

**Declarados mas nunca lidos (config "morta")** — os que têm efeito de jogo no 1.8.2:

| Campo | O que faz no Cobblemon (uso real) | Status no port | Ideia Bedrock | Tam | Impacto |
|---|---|---|---|---|---|
| `playerDamagePokemon` | `PokemonEntity.kt:842` — se `false`, jogador não fere Pokémon | AUSENTE (sempre fere) | `world.beforeEvents.entityHurt` não existe estável; usar `minecraft:damage_sensor` com filtro `is_family player` num component group ligado por propriedade de mundo → setProperty em cada Pokémon ao carregar | S | Médio |
| `shinyNoticeParticlesDistance` | `PokemonClientDelegate.playWildShinySounds()` — shiny selvagem solta `wild_shiny_ring` + `shiny_sparkle_ambient_wild` e o chime `particle.wild_shiny_chime` quando o jogador chega a ≤ 24 blocos | **AUSENTE** (nenhuma partícula/som de brilho; ver §3) | loop de script: shiny selvagem a ≤ N blocos de um jogador → `dimension.spawnParticle` + `player.playSound("cobblemon.particle.wild_shiny_chime")` com cooldown; ou partícula no animation controller do client entity por `q.property('cobblemon:shiny')` | S | **Alto** (achar shiny é central) |
| `honeySlatherAlphaChance` / `honeySlatherShinyChance` | `SaccharineLogSlatheredInfluence` — tora de saccharine com mel atrai spawn próximo, 5% HA, 1/4000 shiny, 1/100 alfa, aspect `honey_drenched`, a tora volta a normal, som de arroto e partículas | **AUSENTE** no spawner (`grep -i slather scripts/spawning` = 0). O port só faz o bloco/mel (`scripts/custom_components/plants/saccharine.ts`) e remove o aspect na captura | influência no `SpawnSelector`: se há `saccharine_log_slathered` no raio (detector do `api/spawning/prospecting/SaccharineLogSlatheredDetector.kt`), aplica os rolls e troca o bloco | M | Médio |
| `teraTypeRate` | `PokemonProperties.kt:660` — chance de o Tera Type ser aleatório | AUSENTE (dado sem uso em batalha no 1.8.2) | só dado; sortear no `createPokemonData` | S | Baixo |
| `displayEntityLevelLabel` / `displayEntityNameLabel` / `displayEntityLabelsWhenCrouchingOnly` / `displayNameForUnknownPokemon` | rótulos acima do Pokémon (nome, nível, só agachado, "???" para não visto na Pokédex) | PARCIAL: `Pokemon.ts:1077` sempre põe `nameTag = "<nome> Lv. N"`, ignorando as 4 opções e a Pokédex | montar o `nameTag` a partir da config; "???" quando o jogador não viu (nameTag é global, então usar a regra do host) | S | Baixo |
| `announceDropItems` / `dropAfterDeathAnimation` | mensagem "X deixou cair Y" e momento do drop | AUSENTE | mensagem ao `spawnItem` dos drops | S | Baixo |
| `maxVerticalSpace` | limite de altura livre na busca de posições (`Floored/SubmergedSpawnablePositionCalculators`) | AUSENTE (o port mede `height` até o topo da zona) | aplicar teto no cálculo de `height` do `Spawner.ts` | S | Baixo |
| `minimumRidingScale` | Pokémon menores que 0,75 de escala não podem ser montados (`PokemonEntity.kt:1302/1596`) | AUSENTE | checar escala antes de montar em `scripts/entity/Riding.ts` | S | Baixo |
| `savePokemonToWorld` | selvagens persistem ao descarregar o chunk | AUSENTE (Bedrock salva por padrão; o despawner decide) | ler no `Despawner.ts` | S | Baixo |
| `defaultKeyItems` | itens-chave dados a todo jogador novo (`GeneralPlayerData.kt:42`) | AUSENTE | lista no primeiro login | S | Baixo |
| `walkingInBattleAnimations` | MoLang `do_effect_walks` | AUSENTE | — | S | Baixo |
| `unlockAllMoveDexMovesByDefault`, `maxDynamaxLevel`, `enableDebugKeys`, `appleLeftoversChance` (nem o 1.8.2 lê), `baseApricornTreeGenerationChance` (fixado no import de worldgen) | dados/cliente | sem efeito (aceitável) | documentar como "só informativo" | – | – |

**Não declarados** (23): `enableInFlightDismounting` (desmontar em voo; **jogo**, tabela de montaria não cita),
`displayControlSeconds` (overlay de controles de montaria), `disableRoll`, `rememberRidingCamera`, `invertPitch`,
`invertYaw`, `swapXAndYAxes`, `xAxisSensitivity`, `yAxisSensitivity`, `thirdPersonViewBobbing`,
`animateBattleTiles`, `partyPortraitAnimations`, `pcProfileAnimations`, `summaryProfileAnimations`,
`summaryPokemonFollowCursor` (cliente Java — NÃO POSSÍVEL/irrelevante), `autoUpdateShowdown`, `captureCalculator`,
`exportSpawnConfig`, `exportStarterConfig`, `storageFormat`/`mongoDB*`/`lastSavedVersion` (infra Java — N/A).

### 4.2 Keybinds (`K/client/keybind/CobblemonKeyBinds.kt`)

| Keybind Cobblemon | Faz | Port | Ideia Bedrock | Tam | Impacto |
|---|---|---|---|---|---|
| `SEND_OUT_POKEMON` (R) — `PartySendBinding.kt` | Arremessa a bola do Pokémon **selecionado** onde se mira; mirando selvagem inicia batalha, mirando jogador desafia, mirando o próprio recolhe; segurar = montar/desmontar (1.7+, com `enableInFlightDismounting`) | PARCIAL: só pelo `/cobblemon:party`/emote (formulário) ou interagindo com o selvagem; **não há "Pokémon selecionado" nem arremesso para um ponto** | item de hotbar (ex. o próprio Poké Ball do Pokémon ou um "Party Ball") — `itemUse` → manda o selecionado para `getBlockFromViewDirection`/`getEntitiesFromViewDirection`; agachar+usar troca a seleção; `playerButtonInput` (estável) para atalho | M | **Alto** |
| `PARTY_OVERLAY_UP/DOWN` (setas) | trocar o Pokémon selecionado no overlay | AUSENTE (HUD por actionbar não tem seleção) | seleção guardada por jogador + marcador no HUD; ciclar pelo item acima ou por agachar+pular | S | Alto (depende do anterior) |
| `SUMMARY` (M) | abre o resumo | FEITO (comando/menu) | — | – | – |
| `HIDE_PARTY` (P) | esconde overlay | FEITO (`/cobblemon:partyhud`) | — | – | – |
| `RIDING_FREELOOK` | câmera livre na montaria | NÃO POSSÍVEL (câmera do cliente) | — | – | Baixo |
| `PokeNavigatorBinding` | comentado no 1.8.2 | N/A | — | – | – |

### 4.3 Gamerules (`K/world/gamerules/CobblemonGameRules.kt`)

O port **não tem nenhuma** (grep `gamerule|doPokemon|healersHealPC` em `scripts/` = 0) e a tabela não cita.
O Bedrock não registra gamerules de add-on; o equivalente é um campo de config/propriedade de mundo.

| Gamerule | Padrão | Faz | Ideia Bedrock | Tam | Impacto |
|---|---|---|---|---|---|
| `doPokemonSpawning` | true | liga/desliga spawn natural (lido em `ServerPlayerMixin`) | já existe `enableSpawning` na config → documentar como equivalente | S | Médio |
| `doPokemonLoot` | true | drops de Pokémon selvagem (`PokemonServerDelegate.kt:413`, `PokemonEntity.kt:1829`) | campo novo na config lido em `battle/Rewards.ts` | S | Baixo |
| `battleInvulnerability` | false | jogador em batalha não leva dano (`PlayerMixin`) | `minecraft:damage_sensor` no `player.json` por propriedade `cobblemon:in_battle` | S | Médio |
| `mobTargetInBattle` | true | se false, mobs não miram jogador em batalha (`TargetingConditionsMixin`) | difícil sem mexer em todos os mobs; aproximar com `damage_sensor` + propriedade | M | Baixo |
| `doShinyStarters` | false | iniciais shiny (`CobbledStarterHandler.kt:76`) | 1 linha em `scripts/starter.ts` + campo de config | S | Baixo |
| `healersHealPC` | false | Healing Machine cura também o PC (`HealingMachineBlock.kt:161`) | campo de config lido no componente da Healing Machine | S | Baixo |

### 4.4 MoLang exposto a datapacks (`K/api/molang/function/*.kt`, 26 arquivos)

~416 nomes de função/consulta no Cobblemon; o mini-interpretador do port (`scripts/npc/molang/MoLang.ts`, 663
linhas) implementa ~71 deles (o subconjunto que os dados do 1.8.2 usam em diálogos/NPC/callbacks). Não afeta o
jogador no conteúdo base, mas **datapacks de terceiros** (diálogos, NPCs, callbacks, comportamentos) quebram em
funções não cobertas. A tabela não cita essa cobertura. Tamanho L para cobrir tudo; recomendável só uma tabela
"suportado/não suportado" em `docs/`.

### 4.5 Comandos

Conferido `K/CobblemonCommands.kt` (59 comandos) × `scripts/commands.ts` + `scripts/pokedex/PokedexCommand.ts` +
`scripts/GUI/PCWallpapers.ts`: o `docs/COMANDOS.md` está correto e completo (os ausentes já estão na seção
"Ainda não portados": `technicalmachine`, `abandonmultiteam`, `applyplayertexture` e os de depuração). Única
observação: `technicalmachine` (`TmCommand.kt`) é S — consultar/listar TMs aprendidos do jogador não depende de
nada impossível.

### 4.6 Comportamentos de IA (`D/behaviours/**`, 49 JSON) e fome

| Comportamento | Espécies | Faz | Port | Ideia Bedrock | Tam | Impacto |
|---|---|---|---|---|---|---|
| `pokemon_bee` (+ `BeeEntityMixin`, `BeehiveBlockEntityMixin`) | Combee (e família por herança) | poliniza flores e deposita mel em colmeias e folhas de saccharine; abelhas vanilla também enchem folhas de saccharine | **AUSENTE** (grep `pollinat|nectar` = 0) | script de IA leve: selvagem vai a flor → aspect `has_nectar` (partícula `falling_nectar`) → folha de saccharine/colmeia ganha `honey_level` | M | Médio |
| `pokemon_fox` | Vulpix (forma normal) | colhe sweet berry bush e pega itens/comida do chão (come e cura) | **AUSENTE** | `behavior.pickup_items` + `behavior.move_to_block` (sweet_berry_bush) no JSON gerado; script para "comer" | S | Baixo |
| `pokemon_picks_up_items` / `item_interact.pickup_items` | configurável | pega itens de que "gosta" | AUSENTE | `minecraft:behavior.pickup_items` com filtro | S | Baixo |
| `pokemon_gets_mad_at_thrower` | configurável | fica bravo com quem jogou a bola (ataca ou foge) | AUSENTE | `hurt_by_target` já existe; disparar evento ao falhar captura | S | Baixo |
| **Fome/`fullness`** (`Pokemon.kt:407–1100`, `EatHeldItemTask`) | todos | berries, Aprijuice, mochis, Berry Juice enchem a "barriga" (máx. pela massa); cheio = não aceita comida (`PokemonAndMoveSelectingItem.canUseOnPokemon`); metabolismo esvazia com o tempo; fora da bola o Pokémon come a berry segurada | **AUSENTE** (grep `fullness` = 0): berries podem ser usadas sem limite (EV/amizade infinitos por spam) | campo `fullness` no `PokemonData` + tick de metabolismo no `PassiveHealing.ts`; checar em `cobblemon:use_on_pokemon`; som `item.berry.eat.full` | S | **Médio/Alto** (balanceamento de EV/amizade) |
| Imunidades (`LightningBoltMixin`, `PowderSnowBlockMixin`, `SweetBerryBushBlockMixin`) | por tipo/espécie | raio não põe fogo perto de Pokémon imune; andar sobre neve fofa; imune ao arbusto de sweet berry | AUSENTE | `damage_sensor` por causa (`lightning`, `sweet_berry_bush`) no JSON gerado | S | Baixo |

### 4.7 Integrações vanilla por mixin (não aparecem em nenhuma tabela)

| Mixin | Faz | Port | Ideia | Tam | Impacto |
|---|---|---|---|---|---|
| `PiglinBarterMixin` | Relic Coin Pouch é moeda de escambo dos piglins | AUSENTE | override do `piglin.json` (`minecraft:barter` aceita item customizado) + loot table | S | Baixo |
| `DecoratedPotPatternsMixin` | sherds do Cobblemon (`CobblemonSherds`) viram padrões do vaso decorado | NÃO POSSÍVEL (vaso vanilla do Bedrock não aceita padrão custom) | — | – | Baixo |
| `PointedDripstoneBlockMixin` + tag `dripstone_growable` | espeleotema cresce sob `dripstone_moon_stone_ore` | AUSENTE | random tick do bloco de minério cria `pointed_dripstone` | S | Baixo |
| `EntityVillagerMixin` (`VillagerGatherableItems`) | fazendeiro recolhe sementes/cultivos do Cobblemon | NÃO POSSÍVEL (IA de aldeão fixa) | — | – | Baixo |
| `EnderPearlItemMixin` | agachar mirando o próprio Pokémon não joga a pérola (para dá-la como item) | AUSENTE | `itemUse` cancelável em `beforeEvents.itemUse` | S | Baixo |
| `NoteBlockMixin` | note block sobre a estante de discos (`DiscShelfBlockEntity`) toca o disco | AUSENTE | script no `playerInteractWithBlock`/redstone | S | Baixo |
| `brewing/*Mixin` + `D/recipe/brewing_stand` (27) | poções/vitaminas/Ability Capsule no suporte de poções | FEITO (não listado): `scripts/machines/cooking.ts` abre tela própria ao usar ingrediente do Cobblemon no suporte vanilla (`docs/pendencias/mundo-maquinas.md`) | — | – | – |

## 5. Fontes web (wiki, site, comunidade)

Varridos ~260 itens documentados (wiki.cobblemon.com: Commands, Config, PC, Pokédex, Riding, Pasture, Habitat,
Alpha, Cosmetics, Behaviour, Marks, TM Machine, Advancements, Disc Shelf, Data Monitor, Campfire Pot, Poké Rod,
Poké Snack, Trading, Dialogues, Molang, Spawn Rules, Wallpapers, Villager, Healing Machine, Display Case, Gilded
Chest, Resurrection Machine; changelogs de cada tag no GitLab; `en_us.json`; Modrinth/CurseForge; artigos
cobbledex.info e cobblewiki.com). cobblemon.com não renderiza sem JS; Reddit/YouTube não trouxeram nada útil.

Fatos de escopo:
- **1.8.2 não foi lançada** (última: 1.8.1, 2026-09-12/13); o port mira o `main` em desenvolvimento.
- Não existem no mod (não perseguir): trainer card, team preview, batalha montado, favoritos no PC, música de
  batalha própria, tecla de escanear.

Itens da web que **nenhuma seção anterior cobria** e que conferi no código do port:

| Feature (versão) | Fonte | Status no port + evidência | Ideia Bedrock | Tam | Impacto |
|---|---|---|---|---|---|
| **Cura do time ao dormir na cama** (1.3.0): +50% HP, sem status, PP parcial, ao passar a noite | `K/util/PlayerExtensions.kt:95` (`didSleep`), `Pokemon.kt:1006` | **AUSENTE e não listado** (o port só pausa status com `player.isSleeping`, `PassiveHealing.ts:266`) | detectar a virada da noite com o jogador dormindo (`isSleeping` + `world.getTimeOfDay()` ao amanhecer) e curar | S | **Alto** (cura básica do survival) |
| **Ordenar caixa do PC** por nome, nível, tipo, nº da Pokédex, gênero (Shift inverte) (1.7.0) | `K/api/pokemon/PokemonSortMode.kt`, `SortPCBoxPacket` | **AUSENTE** (`scripts/GUI/PC.ts` só busca/move/renomeia) | botão "Ordenar" no menu da caixa | S | Médio |
| Painel de IVs/EVs no PC, navegação por scroll, reabrir na última caixa (1.7.0) | `K/client/gui/pc/*` | PARCIAL (conferir "última caixa"; IVs só no resumo) | lembrar a última caixa por jogador | S | Baixo |
| **Markings** ●▲■♥★◆ no resumo (1.7.0) | `K/client/gui/summary/*` | **AUSENTE** (grep `marking` = 0) | toggles no `Summary.ts`, salvos no `PokemonData`; filtro no `pcsearch` | S | Baixo |
| Resumo: contador de passos, saciedade (fome), estilos de montaria; grito ao clicar (1.7/1.8) | lang `cobblemon.ui.stats.*` | AUSENTE (depende de `blocks_traveled` e fome, §4.6) | linhas extras no `Summary.ts` | S | Baixo |
| Animação de level-up + EXP ganho no overlay do time (1.7/1.8) | `PartyOverlay` | AUSENTE (só mensagem) | actionbar/título + som `gui.levelup` | S | Baixo |
| Nome "???" de selvagem não visto até a batalha (1.6.1) | config `displayNameForUnknownPokemon` | AUSENTE (ver §4.1) | — | S | Baixo |
| Pokédex: filtros "montáveis" e "TM não descoberto"; busca por habilidade/golpe/drops (1.6–1.8) | `K/client/gui/pokedex/*` | PARCIAL: `scripts/pokedex/PokedexUI.ts:75` tem só todos/obtidos/vistos/não registrados e busca por nome | filtros e campos extras | S | Baixo |
| Pasto: botão "atacar mobs hostis" (conflito) e dono em itálico nos espaços de outros (1.7/1.8) | `SetPastureConflictPacket.kt`, `behaviours/pokemon/auto/pokemon_owned.json` | **AUSENTE** (grep `conflict`/`hostile` = 0) | toggle no formulário do pasto → `nearest_attackable_target` (monster) por component group | S | Médio |
| Healing Machine: comparador (1 ponto por 10% de carga), luz quando cheia, variante "natural" | wiki Healing Machine | AUSENTE (0 `redstone_producer`) | permutações com `minecraft:redstone_producer` | S | Baixo |
| Raios: Lightning Rod atrai para Pokémon; Motor Drive/Volt Absorb/tipo Terra imunes; Mooshtank troca de cor (1.7.0) | `mixin/LightningBoltMixin.java` | AUSENTE (grep `lightning` = 0) | `damage_sensor` `lightning` por tipo/habilidade no JSON gerado | S | Baixo |
| Quirks especiais: Nosepass aponta para o spawn, bolhas do Krabby ao pôr do sol, cauda do Smeargle | changelogs 1.4–1.7 | PARCIAL (partículas removidas, §3.3) | — | S | Baixo |
| Batalha "minimizável" para andar (tecla R) | `PartySendBinding` | NÃO POSSÍVEL igual (formulário é modal); o port já fecha/reabre o formulário | — | – | – |
| Estatísticas de jogador (1.7.0/1.7.2) | `CobblemonStats.kt` | AUSENTE (ver §3.5) | — | S | Baixo |
| Recipe book agrupado, busca "poke" = "poké" | — | NÃO POSSÍVEL (livro de receitas do Bedrock fixo) | — | – | – |
| Compatibilidade com mods Java (Farmer's Delight, Create…) e `moonlight`/`hourglass_dusts`/`arts_and_crafts` | `D/recipe/mod_compatibility` | N/A | — | – | – |

## 6. Conferência de linhas FEITO contra o código (amostra de 22)

Amostra escolhida para cobrir todas as seções das duas tabelas, com peso nas linhas de "tudo pronto". Evidência
colhida nesta sessão com `grep`/`ls` (sem rodar o jogo).

| # | Linha da tabela (status atual) | Evidência no código | Veredito |
|---|---|---|---|
| 1 | Mec. §1 Herds — FEITO | `scripts/spawning/Spawner.ts:80-81` (`cobblemon:herd_group`/`herd_leader`), `SpawnSelector.ts` | OK |
| 2 | Mec. §1 Despawn (AgingDespawner) — FEITO | `scripts/spawning/Despawner.ts:6-19` (near/far/min/max age) | OK |
| 3 | Mec. §1 Slime chunk — FEITO | `SpawnConditions.ts`/`Spawner.ts` (algoritmo) | OK |
| 4 | Mec. §2 Fórmula com captura crítica, Repeat Ball — FEITO | `scripts/catching/CaptureCalculator.ts:3-19`, `StandardModifiers.ts:97` | OK |
| 5 | Mec. §2 Heal/Friend/Luxury — FEITO | `scripts/catching/CaptureEffects.ts` (FULL_RESTORE, friendshipSetter, Luxury por multiplicador) | OK |
| 6 | Mec. §3 Captura em batalha só singles — FEITO | igual ao 1.8.2 (`EmptyPokeBallEntity.kt:231`) | OK |
| 7 | Mec. §3 Espectador (12 mensagens) — FEITO | `scripts/battle/Spectate.ts:23` | OK |
| 8 | Mec. §3 Música de batalha — **NÃO POSSÍVEL NO BEDROCK** | `BattleActor.ts:380` já chama `playMusic`; o 1.8.2 tem `BattleMusicController` e as chaves `battle.pvw/pvp/pvn.default` vazias | **Rótulo errado**: é "N/A NO COBBLEMON 1.8.2" (sem faixas), não impossibilidade do Bedrock; um resource pack de terceiros com faixas já funcionaria |
| 9 | Mec. §4 Tamanho intrínseco — FEITO | client entity `generated/.../entity/pokemon/pikachu.entity.json` usa `q.property('cobblemon:scale_modifier')` | OK |
| 10 | Mec. §4 Cura passiva/desmaio — FEITO | `scripts/pokemon/PassiveHealing.ts:3-8` | OK |
| 11 | Mec. §5 Everstone — FEITO | `scripts/Pokemon.ts:1051-1053`, `TradeManager.ts:480` | OK |
| 12 | Mec. §5 block_click — FEITO | `scripts/evolution/variants/BlockClickEvolution.ts` | OK |
| 13 | Mec. §6 Sono / cama do dono — FEITO | `scripts/entity/Sleep.ts:2-86` | OK |
| 14 | Mec. §6 Mobs fogem de Pokémon no ombro — FEITO | `behavior_packs/.../entities/vanilla_overrides/` tem creeper, skeleton, stray, bogged, wither_skeleton, fox, phantom | OK |
| 15 | Mec. §8 Trocas com aldeões — FEITO | `behavior_packs/.../trading/economy_trades/{fisherman,wandering_trader}_trades.json` | OK |
| 16 | Mec. §9 **Config (~95 campos) — FEITO** | 111 campos no Kotlin; 88 declarados; **21 declarados e nunca lidos** (`playerDamagePokemon`, `shinyNoticeParticlesDistance`, `honeySlather*`, `displayEntity*Label`, `teraTypeRate`...) | **ERRADO NA TABELA → PARCIAL** (ver §4.1) |
| 17 | Itens — Poké Rods encantáveis — FEITO | `generated/.../items/cobblemon/luxury_rod.json`: `"minecraft:enchantable":{"slot":"fishing_rod"}` | OK |
| 18 | Itens — Cosméticos (29) — FEITO | `scripts/pokemon/CosmeticItems.ts` | OK |
| 19 | Itens — Poções no suporte (não listado) | `scripts/machines/cooking.ts` + `docs/pendencias/mundo-maquinas.md:24` | FEITO, mas **falta na tabela** |
| 20 | Itens — **Sons do Cobblemon — FEITO** | de 391 eventos de som não-espécie com arquivo, **315 nunca são referenciados** por `scripts/`/animações: ~200 `move.*`/`impact.*`/`status.*` (efeitos de golpe), `particle.*shiny_chime` (4), `ride.loop.*` (14), `pc.grab/pc.drop`, `gui.levelup(_start)`, `gui.trade`, `item.berry.eat.full`, `poke_ball.shiny_send_out`, `poke_ball.trail`, `block.tm_machine.open/close/start/burn_loop`, `block.gilded_chest.open/close`, `block.campfire_pot.ambient/active`, sons de quebrar/colocar/pisar de ~25 blocos. `generated/.../blocks.json` só usa tipos de som vanilla (`"sound": "stone"`) e `sounds.json` do RP não tem `block_sounds` | **ERRADO NA TABELA → PARCIAL**. Bônus: `scripts/machines/tm.ts:198` toca o som da **panela** (`potOpen/potClose`) ao abrir a Máquina de TMs em vez de `block.tm_machine.open/close` |
| 21 | Itens — **Partículas de evolução — FEITO** | a própria nota diz "os scripts ainda usam partículas vanilla"; `scripts/evolution/EvolutionEffect.ts:29-32` usa `minecraft:endrod` etc. | **ERRADO NA TABELA → PARCIAL** (troca de ids é S) |
| 22 | `docs/COMO-JOGAR.md` "Limitações conhecidas" | diz que não há spawn em cavernas nem por isca/pesca/Poké Snack; o `Spawner.ts:366-420` varre a coluna da zona em volta do jogador (cavernas incluídas) e pesca/Poké Snack estão FEITO | **Documento desatualizado** (contradiz as tabelas) |

Resumo: 16 de 22 conferem; **3 FEITO deveriam ser PARCIAL** (config, sons, partículas de evolução), 1 rótulo
trocado (música), 1 sistema feito sem linha na tabela (poções no suporte) e 1 documento de jogador desatualizado.

## 7. Backlog consolidado (ordenado por impacto no jogador)

Ordem: impacto (Alto → Médio → Baixo) e, dentro de cada faixa, tamanho (S primeiro = melhor custo/benefício).

### 7.1 Impacto Alto

| # | Item | Seção | Tam |
|---|---|---|---|
| 1 | Brilho + chime de shiny selvagem (e `shiny_send_out`, partículas `shiny_ring*`) lendo `shinyNoticeParticlesDistance` | §4.1, §3.3 | S |
| 2 | Recompensas ao derrotar Alfa (`loot_table/alpha`, callback `pokemon_alpha_drops`) | §2.4 | S |
| 3 | Cura do time ao dormir na cama (`didSleep`) | §5 | S |
| 4 | Fome/`fullness` (limite de berries/Aprijuice/mochi, metabolismo, comer berry segurada) | §4.6 | S |
| 5 | 8 espécies implementadas fora do port (fallback de idle no importador) | §3.0 | S |
| 6 | Stash do Gimmighoul → Gholdengo (hoje impossível) | §2.1 | M |
| 7 | Tora de saccharine com mel como influência de spawn (HA/shiny/alfa, `honey_drenched`) | §4.1, §2.3 | M |
| 8 | Envio rápido estilo tecla R + Pokémon selecionado (item de hotbar/`playerButtonInput`) | §4.2 | M |
| 9 | Aprijuice aplicando ride boosts na montaria | §2.3 | M |
| 10 | Efeitos de golpe/status/impacto em batalha (`action_effects`, ~600 partículas Snowstorm, ~190 sons) | §3.0, §3.3 | L |

### 7.2 Impacto Médio

| # | Item | Seção | Tam |
|---|---|---|---|
| 11 | Drops de evolução (Shell Helmet → Karrablast/Escavalier possível; Shed Shell, Scute) | §2.2 | S |
| 12 | Shedinja por "shedder" (Nincada) | §2.2 | S |
| 13 | Evolução por passos real (`blocks_traveled`) + contador no resumo | §2.3 | S |
| 14 | Requisito `advancement` real (Vivillon Poké Ball) | §2.1 | S |
| 15 | `defaultBoxCount` 30 → 40 | §2.3 | S |
| 16 | Tasty Tail (tesoura no Slowpoke + regrowth) | §3.6 | S |
| 17 | Apricorn: colher com soco; semente nas folhas | §2.1 | S |
| 18 | Sketch permanente | §2.2 | S |
| 19 | Bloquear held items proibidos (shulker/bundle perdem conteúdo) | §2.3 | S |
| 20 | `enableInFlightDismounting` (não cair do voo por agachar) | §2.3 | S |
| 21 | Ordenar caixa do PC (+ última caixa, filtro por nome parcial) | §5, §2.3 | S |
| 22 | PvP de nível fixo 5/50/100 | §2.2 | S |
| 23 | Tingir Wooloo/Dubwool | §2.1 | S |
| 24 | Efeitos `cleanse_*`/`mental_restoration` dos temperos | §3.4 | S |
| 25 | `playerDamagePokemon` + gamerules como campos de config (`battleInvulnerability`, `doPokemonLoot`, `doShinyStarters`, `healersHealPC`, `mobTargetInBattle`) | §4.1, §4.3 | S |
| 26 | Estilo/atributos de montaria na Pokédex e no resumo | §2.3 | S |
| 27 | Sons: level-up, arremesso, PC, troca; `block_sounds` custom para ~25 blocos; TM Machine com o som certo | §3.2, §6 | S–M |
| 28 | Pasto: toggle "atacar hostis" | §5, §2.3 | M |
| 29 | Barcos de apricorn/saccharine funcionais | §3.1 | M |
| 30 | Vestíveis (jogador e Pokémon) do 1.8.2 | §2.4 | M |
| 31 | Redstone em Ring Target/Eject Button/Metronome e nos botões/placas de pressão de madeira | §2.4 | M |
| 32 | Partículas de bola (envio, recolha, feixe/estrelas de captura) | §3.3, §2.1 | M |
| 33 | Visual de Illusion/Transform/Imposter | §2.1 | M |
| 34 | Luz dinâmica de Pokémon (`lightingData`, 88 espécies) | §2.1 | M |
| 35 | Resource packs embutidos (viés regional, Gyarados Jump, shiny únicos) | §2.1 | M |
| 36 | Balsa para Pokémon em batalha na água | §2.2 | M |
| 37 | Move Dex na Pokédex | §2.4 | M |
| 38 | Texturas animadas de Pokémon (40) | §2.3 | M |
| 39 | Sprint na montaria terrestre | §2.3 | M |
| 40 | StrongBattleAI completa (hoje 168 de 986 linhas) | §2.3 | M |
| 41 | Panela: redstone/comparador (funil NÃO POSSÍVEL) | §2.3 | M |
| 42 | Combee poliniza (mel em folhas/colmeias) | §4.6 | M |
| 43 | Item segurado visível no modelo | §2.4 | L |
| 44 | Behaviours de NPC (andar, conversar, lutar, usar healer) | §2.3 | L |

### 7.3 Impacto Baixo (agrupado)

- **S**: rótulos de entidade configuráveis/"???"; `announceDropItems`; `maxVerticalSpace`; `minimumRidingScale`;
  `defaultKeyItems`; `teraTypeRate`; partículas de aspect (olhos do Alfa, mel, migalhas); partículas de espécie
  removidas (35); usar `evo_*`/`poodle_hair_*` já empacotadas; sons de montaria; markings; level-up no overlay;
  grito no resumo; `order` dos iniciais; chatter de NPC; `weighted_choice` (Dudunsparce/Maushold); Smeargle
  rainbow; luz por estado (pasto/monitor/atril); vasos com mudas; compostáveis/inflamáveis; Fortuna em
  minérios/mints; Relic Coin Pouch para piglin; espeleotema no minério de lua; pérola do ender no próprio
  Pokémon; imunidades (raio, gelo, sweet berry); propriedades `aspect/unaspect/type/no_ai/freeze_frame/
  originaltrainer/scale_modifier/tag`; tipo efetivo de Hidden Power; log de troca; som de troca; Healing
  Machine com comparador; `/technicalmachine`; `/pokedex printcalculations` padrão; `/npcdelete <uuid>`;
  `/pctake` pelo console; Never-Melt Ice com atrito; apagar restos do Braised Vivichoke; Leftovers de maçã pela
  config; estatísticas de jogador; filtros da Pokédex.
- **M**: 43 conquistas no "Progresso Cobblemon" (agriculture/geological/catching); sequenciador de note block
  e discos visíveis na estante; feto no tanque; tags de comida vanilla; creative tabs; spawn rules; NPC com
  modelo de Pokémon; raio com Lightning Rod/Motor Drive/Volt Absorb.
- **L / só datapack**: cobertura MoLang (~71 de ~416 funções), callbacks genéricos, requisitos `negate`/
  `chance`/`area`/`owner_holds_item`, `party_pools`.
- **NÃO POSSÍVEL (só registrar nas tabelas)**: padrões de vaso dos sherds, pinturas, trim, dispenser custom,
  fazendeiro recolhendo sementes, profissão Enfermeira, injeção em vilas, câmera/freelook/roll da montaria,
  funil na panela, conquistas nativas, recipe book agrupado.

### 7.4 Correções diretas nas tabelas (sem código)

| Documento / linha | Hoje | Deveria |
|---|---|---|
| `PARIDADE-MECANICAS.md` §9 Config (~95 campos) | FEITO | PARCIAL (21 campos mortos, §4.1) |
| `PARIDADE-MECANICAS.md` §9 PC "30 espaços" | — | padrão do 1.8.2 é 40 caixas |
| `PARIDADE-MECANICAS.md` §5 Evolução | FEITO | PARCIAL (shedder, drops, `blocks_traveled`/`advancement`/`property_range` sempre verdadeiros) |
| `PARIDADE-MECANICAS.md` §1 Alfa | FEITO | PARCIAL (sem recompensas) |
| `PARIDADE-MECANICAS.md` §3 Treinadores NPC (StrongBattleAI) | FEITO | PARCIAL (IA enxuta) |
| `PARIDADE-MECANICAS.md` §3 Música de batalha | NÃO POSSÍVEL | N/A NO COBBLEMON 1.8.2 |
| `PARIDADE-MECANICAS.md` §7 Pasto, Panela, NPCs | FEITO | PARCIAL (sem atacar hostis; sem redstone; sem behaviours) |
| `PARIDADE-MECANICAS.md` — linhas novas | — | gamerules, keybinds/envio rápido, fome, cura na cama, brilho de shiny, tora com mel |
| `PARIDADE-ITENS-BLOCOS.md` Sons | FEITO | PARCIAL (§3.2) |
| `PARIDADE-ITENS-BLOCOS.md` Partículas de evolução | FEITO | PARCIAL (ids vanilla) |
| `PARIDADE-ITENS-BLOCOS.md` Madeira … barcos | FEITO | barcos AUSENTES |
| `PARIDADE-ITENS-BLOCOS.md` Cosméticos/wearables | FEITO | `cosmetic_items` FEITO; **vestíveis do 1.8.2 AUSENTES** |
| `PARIDADE-ITENS-BLOCOS.md` Apricorns; Relic coins/sherds | FEITO | PARCIAL (sem soco/semente na folha; moedas sem stash; sherds NÃO POSSÍVEL no vaso) |
| `PARIDADE-ITENS-BLOCOS.md` — linhas novas | — | itens colocáveis do 1.8.2 (FEITO); poções no suporte (FEITO); redstone dos blocos decorativos (AUSENTE); partículas (57/1.104) |
| `COMANDOS.md` "Ainda não portados" | — | acrescentar `changejointscale`, `calculateseatpositions`; propriedades não suportadas |
| `COMO-JOGAR.md` "Limitações conhecidas" | cavernas/isca/pesca/Poké Snack sem spawn | desatualizado (§6 #22) |
| Comentários de código velhos | `scripts/items/food.ts:5-6`, `scripts/entity/Interactions.ts:217` | montaria e `poodle_hair_*` já existem |
