# Pendências da frente "pesca"

Arquivos da frente: `scripts/fishing/**`, `behavior_packs/CobblemonBedrock/entities/fishing/poke_bobber.json`,
`resource_packs/CobblemonBedrock/{entity,render_controllers,animations,particles}/fishing/**`, `tests/pesca.test.ts`.

> `particles/fishing/fishing_line.particle.json` (partícula da linha, `cobblemon:fishing_line`) fica fora da lista
> original de pastas da frente, mas numa subpasta `fishing/` própria: não colide com ninguém.

## O que existe (paridade Cobblemon 1.8.2)

| Módulo | Porta de | Conteúdo |
|---|---|---|
| `FishingController.ts` | `PokerodItem.use`, `PokeRodFishingBobberEntity` | arremesso/recolhimento, física da boia (integrada por script: gravidade 0,03, arrasto 0,92, boiar em 8/9 do bloco), fisgar entidades, laço da água, loot, spawn do Pokémon, puxar até o jogador, batalha 1 s depois, dano na vara, linha por partículas, limpeza de boias órfãs |
| `FishingLogic.ts` (puro) | idem | `tickFishing` (espera `nextInt(100,600)` − (1 + Lure)/tick, chuva +1 a 25%, sem céu −1 a 50%; peixe nadando `nextInt(20,80)`; janela `calculateMinMaxCountdown(peso do bucket)` para Pokémon, `20–40` para item), `rollPokemonCatch` (`nextInt(0,100) < 85` → 84,2%), loot 66/17/17, `isOpenOrWaterAround`, velocidades (arremesso, boiar, mergulho, lob, item), dano (1 pesca, 3/5 entidade, 2 no chão) e Unbreaking |
| `BaitEffects.ts` (puro) | `SpawnBaitEffects`, `SpawnBait`, `SpawnBaitUtils`, `SpawnBaitInfluence`, `FishingSpawnCause` | registro das 79 iscas (`baitData.ts`), `mergeEffects`, bite_time, pokemon_chance, rarity_bucket, efeitos no Pokémon (natureza, IV, shiny reroll, gênero, nível, HA, Alfa, amizade, drops_reroll) e no peso (EV zera quem não rende, tipo ×value, grupo de ovo ×value; herds não) |
| `RodItem.ts` | `RodBaitComponent`, `PokerodItem.setBait/consumeBait` | isca na dynamic property `cobblemon:rod_bait` da vara + lore "Bait: X ×N"; encantamentos (Lure, Luck of the Sea, Unbreaking) e durabilidade |
| `BaitMenu.ts` | `overrideOtherStackedOnMe` (clique no inventário) | agachar + usar a vara: lista as iscas do inventário / tirar a isca |
| `PokeRods.ts` (puro) | `PokeRods`, `pokerods/*.json` | 48 varas → bola da boia (propriedade `cobblemon:ball` 0..47) e cor da linha |
| `PokeSnack.ts` | `PokeSnackBlock`, `PokeSnackBlockEntity`, `PokeSnackSpawnerFactory` | componente de bloco `cobblemon:poke_snack`: Poké Snack (isca de área: a cada 2 ticks aleatórios do Java × bite_time tenta 1 spawn com `trySpawnFromBait`, só não-herds, aspect `poke_snack_crumbed`, 1 mordida por spawn, some depois de 8) e Poké Cake (fatias comestíveis: 2 de fome, 0,4 de saturação) |

Fluxo de uso:
- **Usar** a vara: arremessa (com a isca da mão secundária, se houver, presa antes, como no Cobblemon). Usar de novo
  recolhe. Trocar de slot, mudar a isca, morrer, trocar de dimensão ou passar de 32 blocos some com a boia.
- **Agachar + usar** (sem boia): menu de isca (prender a pilha inteira, completar a mesma isca, trocar — a antiga
  volta ao inventário — ou tirar).
- Fisgada: som `cobblemon.fishing.notification`, respingo e a boia afunda. Recolher na janela: Pokémon (85/101) ou
  item. O Pokémon nasce na boia com aspect **e** tag `fished` (Lure Ball: `StandardModifiers.FISHED_ASPECT`), é
  lançado até 5 blocos à frente do jogador se pesar < 90 kg e a batalha começa 1 s depois (`startWildBattle`,
  silenciosa se falhar). A isca é consumida só quando o Pokémon sai. EXP 1–6 por pesca.

API para outras frentes:

```ts
import { registerSpawnBait, baitInfluence, effectsForItem, isFishingBait } from "../fishing/BaitEffects";
registerSpawnBait("seasonings:oran_berry", effects /* BaitEffect[] */, item?)  // temperos (culinária)
baitInfluence(effects, { fished?, aspect? })  // SpawnInfluence: peso + efeitos no Pokémon (incenso/mel podem reusar)
import { setPokeSnackBaits } from "../fishing/PokeSnack";
setPokeSnackBaits(dimension, blockLocation, ["seasonings:oran_berry", ...])  // ao colocar um Poké Snack temperado
import { isFishing, useRod } from "../fishing/FishingController";
```

Uma Poké Bait temperada pode carregar os ids de isca na dynamic property `cobblemon:bait_effects` (JSON `string[]`) se
o item for não empilhável; ao prender na vara esses ids vão junto (`RodBait.components`).

## Pedidos

### 1. Importador de conteúdo (`tools/importer/items.ts`, `blocks.ts`) — itens e blocos

1. **Poké Rods (48 itens)**: nada novo para disparar a lógica — o componente `cobblemon:poke_rod` agora está declarado
   em `scripts/fishing/components.ts`, então basta **rodar `npm run import` de novo** para ele entrar nos JSONs
   (`"cobblemon:poke_rod": {}`). Manter `max_stack_size: 1` (a isca fica em dynamic property do item, que só existe em
   itens não empilháveis) e `minecraft:durability` 256.
2. **Poké Rods: encantáveis** (Lure, Luck of the Sea, Unbreaking, Mending; `getEnchantmentValue() = 1`):
   ```json
   "minecraft:enchantable": { "slot": "fishing_rod", "value": 1 }
   ```
   Sem isso o Lure (condições `minLureLevel` de mais de 100 entradas e a espera menor) e o Luck of the Sea nunca valem.
3. **Poké Snack / Poké Cake**: o componente de bloco `cobblemon:poke_snack` também está declarado em
   `scripts/fishing/components.ts` (e é registrado por ele mesmo no `startup`, sem mexer em
   `scripts/custom_components/index.ts`). Rodar o import de novo para ele entrar em `poke_snack.json`/`poke_cake.json`
   (o `blockBehaviours.ts` já mapeia os dois blocos). Os blocos precisam do estado `cobblemon:bites` 0..8 (já têm).
4. (Opcional) Iscas do Cobblemon com `"minecraft:allow_off_hand": true` (berries, `sweet_heart`, `poke_bait`) para
   poder segurar a isca na mão secundária como no Java. Itens vanilla (maçã dourada etc.) só entram pelo menu.

### 2. Importador (sons)

Importar os eventos `fishing.*` do `assets/cobblemon/sounds.json` como `cobblemon.fishing.*` (mesma regra dos sons
`pokemon.*` → `cobblemon.pokemon.*`), com os `.ogg` de `sounds/fishing/`:
`cobblemon.fishing.notification`, `.splash_small`, `.splash_big`, `.rod_cast`, `.rod_reel_in`, `.bobber_land`,
`.bait_attach`, `.bait_detach`. Sem isso a pesca funciona, só sem som (ids em `FISHING_SOUNDS`).

### 3. Importador (partículas)

Copiar `assets/cobblemon/bedrock/particles/fishing/*.particle.json` (já no formato Bedrock) para o RP
`particles/fishing/` e as texturas que elas usam (`textures/particles/generic/water/fishsplash.png`,
`water_ripple.png`, `rainsplash.png`, `textures/particles/generic/white.png`). Ids usados: `cobblemon:bob_splash`,
`cobblemon:fishing_bobber_ripple`, `cobblemon:fishing_bobber_big_ripple`, `cobblemon:fishing_surface_ripple`,
`cobblemon:fishing_wake`, `cobblemon:accessory_fish_splash`, `cobblemon:small_fish_splash`, `cobblemon:big_fish_splash`.
Enquanto não existirem, só aparecem as partículas vanilla (bolhas, rastro, respingo).

### 4. Spawn (`scripts/spawning/SpawnConditions.ts`/`Spawner.ts`)

`chooseFishingSpawn` normaliza os buckets com `lureLevel + luckOfTheSeaLevel`, mas no Cobblemon
(`PokeRodFishingBobberEntity.planSpawn` → `FishingSpawnerFactory`) o tier é **rarity_bucket da isca + Luck of the Sea**,
e o Lure do encantamento só vale em `minLureLevel`. Hoje a pesca contorna passando `luckOfTheSeaLevel: -lure` (tier 0)
e a própria `bucketNormalizingInfluence(tier)`. Pedido: campo opcional em `FishingInfo`

```ts
/** Tier da normalização de buckets; se presente, substitui lureLevel + luckOfTheSeaLevel. */
bucketTier?: number;
```

Depois disso troco o contorno por `{ rodType, bait, lureLevel, bucketTier: rarityTier + luckOfTheSea }`.
(Opcional) `trySpawnFromBait(..., { radius })`: o Poké Snack do Cobblemon usa uma zona fixa de raio 8 (17×17×17); hoje
usa `spawningZoneDiameter`.

### 5. `main.ts`

Nada obrigatório: a frente é carregada por `scripts/custom_components/index.ts` → `scripts/fishing/components.ts`, que
registra o componente de item, o de bloco (no `startup`) e a limpeza das boias (no `worldLoad`). Se preferirem deixar
explícito, uma linha basta:

```ts
import "./fishing/components";
```

### 6. Textos (base_translations / lang)

Já existem no lang gerado: `cobblemon.pokerod.bait`, `cobblemon.fishing.no_bite`, `entity.cobblemon.poke_bobber`.
Novos (prontos para colar):

`en_US.lang`
```
cobblemon.fishing.bait_menu.title=Poké Rod Bait
cobblemon.fishing.bait_menu.body=Choose a bait to attach to the rod. (Sneak and use the rod to open this menu.)
cobblemon.fishing.bait_menu.none=You have no bait in your inventory.
cobblemon.fishing.bait_menu.remove=Remove bait
entity.cobblemon:poke_bobber.name=Poké Bobber
```

`pt_BR.lang`
```
cobblemon.fishing.bait_menu.title=Isca da Poké Rod
cobblemon.fishing.bait_menu.body=Escolha uma isca para prender na vara. (Agache e use a vara para abrir este menu.)
cobblemon.fishing.bait_menu.none=Você não tem iscas no inventário.
cobblemon.fishing.bait_menu.remove=Remover a isca
entity.cobblemon:poke_bobber.name=Pokéboia
```

`base_translations/en_US.json` (mesmas chaves):
```json
"cobblemon.fishing.bait_menu.title": "Poké Rod Bait",
"cobblemon.fishing.bait_menu.body": "Choose a bait to attach to the rod. (Sneak and use the rod to open this menu.)",
"cobblemon.fishing.bait_menu.none": "You have no bait in your inventory.",
"cobblemon.fishing.bait_menu.remove": "Remove bait",
"entity.cobblemon:poke_bobber.name": "Poké Bobber"
```

## Desvios e limitações conhecidas

- **Física da boia por script** (teleporte por tick, colisão por raio contra blocos sólidos); o cliente interpola.
  Na água, a boia é desenhada 0,12 bloco abaixo para a bola não parecer pousada.
- **Isca**: no Java, a isca da mão secundária só troca uma isca diferente já presa (a vazia não recebe — bug do 1.8.2);
  aqui prende em qualquer caso. Menu no lugar do clique no inventário.
- **Águas abertas** (tesouros) recalculadas a cada 5 ticks na janela da fisgada e no recolhimento (Java: todo tick).
- **Loot**: lixo e tesouro vanilla vêm das tabelas `gameplay/fishing/junk`/`treasure` do Bedrock
  (`LootTableManager`); o tesouro do Cobblemon é sorteado no script. Luck of the Sea não mexe no loot (o Cobblemon não
  passa `luck` ao LootParams). EXP via `addExperience` (1–6) em vez de orbe.
- **Linha**: partículas (`cobblemon:fishing_line`, cor da vara) a cada 2 ticks, até 24 pontos; o gancho
  (`pokerod_hook.geo.json`) e a isca pendurada não são desenhados. A textura "cast" da vara não troca (o Bedrock não
  troca ícone de item em tempo de execução).
- **Efeitos sem equivalente**: `mark_chance` (marcas só na captura, como o próprio Cobblemon comenta) e `size`
  (o port não tem `scaleModifier`) não fazem nada.
- **Poké Snack**: o tick aleatório do Bedrock (randomTickSpeed 1) conta como 3 do Java; velas, tinta por tempero,
  partículas de migalha e a regra "Poké Snack ignora spawn rules" não foram portadas. Estado por bloco em dynamic
  property do mundo (`cobblemon:snack:<dim>:<x>,<y>,<z>`), limpo no `onBreak`.
- `love_sweet` não é isca de pesca no 1.8.2 (só tempero), então as 3 entradas com `bait: love_sweet` só saem se a
  culinária registrar uma isca com esse item.
- Batalha automática usa `battleWildMaxDistance` (12): Pokémon grandes que ficam na boia longe do jogador não iniciam
  batalha (fica selvagem ali).

## Status da integração

- 1.1 `cobblemon:poke_rod` nos JSONs: ✅ feito (integração). 1.2 Varas encantáveis: ✅ feito (integração). 1.3 `cobblemon:poke_snack` nos blocos: ✅ feito (integração). 1.4 Iscas com `allow_off_hand`: ✅ feito (integração).
- 2. Sons `cobblemon.fishing.*`: ✅ feito (integração). 3. Partículas de pesca + texturas: ✅ feito (integração).
- 4. `FishingInfo.bucketTier`: ✅ feito (integração) — a pesca passa `bucketTier: rarity_bucket + Luck of the Sea` (sem o contorno `luckOfTheSeaLevel: -lure`); `trySpawnFromBait(..., { radius })` e o Poké Snack usa raio 8 (`POKE_SNACK_SPAWN_RADIUS`).
- 5. `main.ts`: ✅ feito (integração) (nada obrigatório; carregada por `custom_components`).
- 6. Textos do menu de isca e `entity.cobblemon:poke_bobber.name` (lang + `base_translations/en_US.json`): ✅ feito (integração).
- Extra: marca `mark_fishing` em potencial nos Pokémon pescados.
