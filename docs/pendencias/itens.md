# Pendências da frente "itens" (uso de itens fora de batalha)

Arquivos da frente: `scripts/items/**` (`components.ts`, `effects.ts`, `usage.ts`, `tm.ts`, `food.ts`, `heldItems.ts`),
`scripts/events/ScriptEvents.ts` (`useItemOnPokemon` → `useItemOnPokemonEntity`), `scripts/events/{RareCandy,
InteractEvolution,ExchangeHeldItem}.ts`, `tests/itens.test.ts`.

## O que já funciona

- `cobblemon:use_on_pokemon` (162 itens): usar no ar abre a seleção do time (HP/status; quem não pode receber o
  item aparece com ✗); usar apontando para o próprio Pokémon aplica direto. Ethers, PP Up/Max e Leppa/Hopo pedem
  o golpe. Consome só se teve efeito e nunca no criativo; devolve garrafa/tigela como o Cobblemon.
  Poções, remédios, Energy Root, Berry Juice, berries de cura/status/PP/EV, curas de status, Heal Powder, Revive,
  Max Revive, Revival Herb, Ether/Elixir, PP Up/Max, vitaminas (+10), penas (+1), mochis (+4, `MochiItem.kt`),
  Fresh Start Mochi, doces de EXP/Rare Candy (com pergunta de golpe novo via `promptMoveReplacement`), doces de
  Hyper Training, Mints, Ability Capsule/Patch, pedras e itens de evolução (só gasta se a evolução começa),
  Link Cable (evolução por troca sem parceiro).
- `cobblemon:technical_machine`: golpe gravado na **lore** do item (ver "Convenção do TM"); só golpes da lista de TMs
  da forma; já conhecido não gasta; moveset cheio → guardado + pergunta de troca; `infiniteTmUses` respeitado.
- `cobblemon:food_effect`: Vivichoke Dip (limpa efeitos + Absorção I 45 s), Sinister Tea (efeitos dos temperos),
  Ponigiri (fome extra dos temperos), Aprijuice (bebida). Enquanto o JSON não tiver `minecraft:food`, `onUse` come
  na hora (fome/saturação base do Cobblemon).
- API para outras frentes: `getItemBehaviour(typeId)`, `useItemOn(pokemon, typeId, ctx)` (lógica pura),
  `createTechnicalMachine(move)`, `getTMMove(stack)`, `setTMMove(stack, move)`, `toShowdownItemId(minecraftItem)`,
  `showdownItemOf(pokemon)`, `FOOD_DATA_PROPERTY` / `FoodData`.

## Pedidos

### 1. Dados (`scripts/Pokemon.ts`): item segurado → id do Showdown

`toShowdownSet()` manda `item` como `toID(typeId sem namespace)`: `cobblemon:charcoal_stick` vira `charcoalstick`
(o Showdown não conhece; o Charcoal não funciona), idem `medicinal_leek` (Showdown: `leek`), e os remapeamentos
vanilla do Cobblemon (`minecraft:bone` → `thickclub`, `snowball`, `gold_block` → `bignugget`) não existem.
Trocar em `toShowdownSet()`:

```ts
import { showdownItemOf } from "./items/heldItems";
// ...
return { ...this, species: ..., item: showdownItemOf(this), gender: ..., nature: ..., ivs: ..., happiness: ... } as PokemonSet;
```

`showdownItemOf({ item, minecraftItem })` usa `minecraftItem` quando existir (regra do `CobblemonHeldItemManager`:
caminho sem "_" se o Showdown conhece; remapeamentos explícitos; item desconhecido → `""`) e, sem ele, o `item` já
em formato Showdown (sets de NPC). Não muda `PokemonData.item` (Rewards/Exp. Share continuam iguais).

Opcional (paridade fina): `feedPokemon(n)` / `isFull()` (saciedade do Cobblemon: berries, mochis e Berry Juice
contam como alimentação e itens da tag `cobblemon:poke_food` não podem ser dados com o Pokémon cheio). Hoje é
ignorado; se existir, a frente itens passa a chamar.

### 2. Importador (`tools/importer/items.ts`)

1. `minecraft:food` + `minecraft:use_animation` + `minecraft:use_modifiers` para:
   - `ponigiri`: `nutrition 2`, `saturation_modifier 0.55`, `eat`, 1,6 s (PonigiriItem.kt);
   - `sinister_tea`: `nutrition 0`, `saturation_modifier 0`, `can_always_eat`, `using_converts_to minecraft:bowl`,
     `drink`, `max_stack_size 16` (SinisterTeaItem.kt);
   - `aprijuice_*`: `nutrition 4`, `saturation_modifier 1.2`, `drink`, 1,6 s (32 ticks), `max_stack_size 16`
     (AprijuiceItem.finishUsingItem: `foodData.eat(4, 1.2f)`).
   Com isso o `onConsume` do `cobblemon:food_effect` passa a valer (hoje o `onUse` come na hora, sem animação).
2. `cobblemon:food_effect` também em `vivichoke_dip` (hoje ele tem `minecraft:food`, mas não o componente, e o
   efeito — limpar efeitos + Absorção — não é aplicado).
3. `moomoo_milk` não deveria ter `cobblemon:use_on_pokemon` (é só item de mochila em batalha, `SimpleBagItemLike`).
   Inofensivo: sem comportamento fora de batalha, o clique não faz nada.
4. Correções em `generated/scripts/items.ts` (os scripts já usam os valores certos do Kotlin):
   `*_mochi.ev` = 4 (não 10, `MochiItem.evIncreaseAmount`); `revival_herb.hpRatio` = 0.25 (`RevivalHerbItem`:
   `ceil(maxHealth / 4)`); `medicinal_leek.heldItem` = `"leek"` (3º argumento de `heldItem(...)` em CobblemonItems.kt).
5. Ícone do TM por tipo do golpe (`textures/item/tms/<tipo>_tm.png`) não é possível por pilha no Bedrock; o ícone
   genérico fica. (Sem pedido de mudança; só registro.)

### 3. Textos do port (dono de `resource_packs/CobblemonBedrock/texts/*.lang`)

```
## en_US.lang
cobblemon.port.item.choose_pokemon=Use %1$s on which Pokémon?
cobblemon.port.item.choose_move=Use %1$s on which of %2$s's moves?
cobblemon.port.item.teach_tm=Teach %1$s to which Pokémon?
cobblemon.port.item.no_effect=It won't have any effect on %1$s.
cobblemon.port.item.no_party=You don't have any Pokémon.

## pt_BR.lang
cobblemon.port.item.choose_pokemon=Usar %1$s em qual Pokémon?
cobblemon.port.item.choose_move=Usar %1$s em qual golpe de %2$s?
cobblemon.port.item.teach_tm=Ensinar %1$s a qual Pokémon?
cobblemon.port.item.no_effect=Não terá efeito em %1$s.
cobblemon.port.item.no_party=Você não tem nenhum Pokémon.
```

Chaves do Cobblemon usadas (já geradas): `cobblemon.mint.interact`, `cobblemon.mint.same_nature`,
`cobblemon.ability_changer.changed`, `cobblemon.tms.{teach_move,already_known,cannot_learn,unknown_move}`,
`cobblemon.battle.bagitem.use` (confirmação "X usou Y em Z"), `cobblemon.held_item.*`, `cobblemon.experience.*`.

### 4. Sons (RP / importador de sons)

Faltam no RP os sons do Cobblemon `medicine_candy.use` (doces), `medicine_feather.use` (penas), `mochi.use`,
`tm.use` e `move.learn`. Hoje esses itens tocam `item.use`; quando existirem, trocar em `ITEM_SOUNDS`
(`scripts/items/effects.ts`).

### 5. Batalhas (`scripts/battle/BagItems.ts`)

`X_ITEMS` usa ids que não existem: `x_defense`, `x_sp_atk`, `x_sp_def`. Os itens do Cobblemon são
`cobblemon:x_defence`, `cobblemon:x_special_attack` e `cobblemon:x_special_defence` (ver `ITEMS`), então esses três
nunca aparecem na mochila. Trocar as chaves (os stats do Showdown `def`/`spa`/`spd` continuam).

Usar um item de `use_on_pokemon` no ar durante uma batalha hoje só mostra `cobblemon.port.in_battle` (o uso em
batalha é pelo menu da mochila). Se a frente quiser abrir o menu da mochila direto com o item da mão (como o
`PokemonSelectingItem.interactGeneralBattle`), exporte uma função `openBagItemFromHand(player, typeId)` e a frente
itens chama no `onUseItem`.

### 6. Convenção do TM (máquina de TM, loot, comandos)

O golpe fica na lore do `cobblemon:technical_machine` (dynamic property em ItemStack só funciona com pilha de 1), no
formato já usado pela Máquina de TM (`scripts/machines/tm.ts`):
`{ translate: "cobblemon.port.tm.move", with: { rawtext: [{ translate: "cobblemon.move.<id>" }, { text: "<id>" }] } }`.
`scripts/items/tm.ts` escreve esse formato (`createTechnicalMachine(move, amount?)`, `setTMMove`) e lê tanto ele
quanto qualquer lore com `cobblemon.move.<id>` (`getTMMove`). A chave `cobblemon.port.tm.move` (`%1$s`) é pedida
pela frente de máquinas; se ela mudar o formato, avise aqui.

Comandos (`scripts/commands.ts`): `/give` não grava lore; pedido de `/cobblemon:givetm <golpe> [quantidade]` →
`ItemUtils.givePlayerItem(player, createTechnicalMachine(move, amount))`.

### 7. Campfire Pot / temperos (frente de culinária)

Temperos que o Cobblemon grava como componentes (`FOOD`, `MOB_EFFECTS`, `RIDE_BOOST`) são lidos da dynamic property
`cobblemon:food_data` (`FOOD_DATA_PROPERTY`, JSON `FoodData` em `scripts/items/food.ts`):
`{ hunger?, saturation?, mobEffects?: [{ effect, duration (ticks), amplifier? }], rideBoosts? }`.
Só funciona em pilha de 1 (limitação do Bedrock); com pilha maior o item vale "sem temperos".

## Observações

- `onUse` de itens com `minecraft:block_placer` (poções, berries): se o Bedrock disparar `onUse` também ao colocar o
  bloco, a seleção do time abriria junto. Conferir no BDS (`npm run server`) na integração.
- O clique no Pokémon pode disparar a interação com a entidade e o `onUse`; o `onUse` espera 2 ticks e desiste se a
  entidade já tratou o item.
- Divergências de UX intencionais: pedras de evolução/TMs/Ability Capsule também funcionam pela seleção do time
  (no Cobblemon só apontando para o Pokémon), já que o Bedrock não tem a roda de interação; o doce de EXP não abre
  para Pokémon no nível máximo.

## Status da integração

- 1. `toShowdownSet()` com `showdownItemOf`: ✅ feito (integração). `feedPokemon`/`isFull` (saciedade): ⏭️ não feito: opcional; exigiria o relógio de fome do Pokémon (PokemonFeeding) que o port não tem.
- 2.1 `minecraft:food` em ponigiri/sinister_tea/aprijuice: ✅ feito (integração). 2.2 `cobblemon:food_effect` no vivichoke_dip: ✅ feito (integração). 2.3 moomoo_milk sem `use_on_pokemon` (`bagOnly`): ✅ feito (integração). 2.4 mochi `ev` 4, revival_herb `hpRatio` 0,25, medicinal_leek `heldItem` leek: ✅ feito (integração) (o parser do Kotlin agora lê o 3º argumento de `heldItem(...)`). 2.5 Ícone do TM por tipo: ⏭️ não feito: NÃO POSSÍVEL no Bedrock (ícone por pilha).
- 3. Textos `cobblemon.port.item.*` e `cobblemon.port.tm.move`: ✅ feito (integração).
- 4. Sons: ✅ feito (integração) — `ITEM_SOUNDS` usa `cobblemon.item.medicine.*`, `candy.use` (doces), `feather.use` (penas e mochis: no 1.8.2 `MOCHI_USE` = `item.medicine.feather.use`), `tm.use`/`gui.move_learn` (TM).
- 5. `X_ITEMS` com `x_defence`/`x_special_attack`/`x_special_defence`: ✅ feito (integração). `openBagItemFromHand`: ⏭️ não feito: opcional; o uso em batalha continua pelo menu da mochila.
- 6. `/cobblemon:givetm <golpe> [jogador] [quantidade]`: ✅ feito (integração).
- 7. Temperos (`cobblemon:food_data`): ✅ feito (integração) — a frente máquinas grava os temperos na lore do prato e aplica ao comer.
