# Pendências da frente "entidades" (IA, sono, montaria, ombro, interações, tamanho)

Arquivos da frente: `tools/importer/entities.ts` (entidade BP de cada espécie + `generated/scripts/entityData.ts`),
`scripts/entity/**` (`index.ts`, `EntityData.ts`, `Sleep.ts`, `Riding.ts`, `Shoulder.ts`, `Interactions.ts`, `Size.ts`),
`behavior_packs/CobblemonBedrock/entities/player.json` (família `pokemon_shoulder` nos assentos dos ombros),
`tests/entidades.test.ts`. Edições mínimas fora: `tools/importer/index.ts` (passa `data`/`modelFile` e chama
`emitEntityDataModule()`), `scripts/events/ScriptEvents.ts` (1 linha no começo de `handlePokemonInteract` + import),
`tests/mocks/minecraft-server.ts` (exports `InputButton`, `ButtonState`).

Todos os componentes gerados foram checados contra o schema estável `server/entity/1.26.50` do
Mojang/bedrock-samples e as chaves usadas no BP vanilla 26.50 (886 entidades, 0 erros). `npm run import`,
`npm run validate`, `npx tsc -p tsconfig.json` e `npm test` passam.

## Contrato da entidade (para `docs/ARQUITETURA.md`, seção "Entidades de Pokémon")

- Propriedades: as de antes + `cobblemon:alpha` (bool, client_sync).
- Família: `pokemon`, `mob`, `cobblemon_<speciesId>` (usada pelo follow de herd); `pokemon_shoulder` só no ombro.
- Eventos: `cobblemon:set_wild`, `cobblemon:set_owned`, `cobblemon:instant_kill`, `cobblemon:interacted` (iguais);
  novos: `cobblemon:sleep` / `cobblemon:wake` (liga/desliga `cobblemon:sleeping` e tira/devolve a IA),
  `cobblemon:set_alpha` / `cobblemon:unset_alpha`, `cobblemon:size_<n>` (tamanho por forma/Alfa),
  `cobblemon:shoulder_on` / `cobblemon:shoulder_off`, `cobblemon:ride_land|air|liquid`, `cobblemon:ride_air_tired`,
  `cobblemon:on_mount` / `cobblemon:on_dismount` (do `minecraft:rideable`), `cobblemon:ate_grass` (eat_block).
- Grupos: `cobblemon:wild_ai`, `cobblemon:owned`, `cobblemon:owned_ai`, `cobblemon:idle_look`, `cobblemon:asleep`,
  `cobblemon:size_<n>`, `cobblemon:family_default|family_shoulder`, `cobblemon:rideable`, `cobblemon:move_ai`,
  `cobblemon:ride_*`, `cobblemon:gravity`, `cobblemon:instant_kill`. **Não há mais `cobblemon:wild` nem
  `minecraft:despawn`** (despawn é do `scripts/spawning/Despawner.ts`, pedido da frente spawn).
- `minecraft:tameable` e `minecraft:inventory` (1 slot = item segurado) ficam na base. O inventário tinha sumido do
  JSON gerado, o que fazia `PokemonData.loadFromCobblemon` (lê `inventory!.container!`) falhar em toda entidade.
- Regra do JSON: componente que muda por estado fica na base e em grupos sempre *trocados* no mesmo evento
  (o vanilla faz assim; remover um grupo que sobrescreve a base sem pôr outro deixa a entidade sem o componente).
  O teste `assertSwapInvariant` confere isso em todas as espécies testadas.

## O que foi feito (paridade Cobblemon 1.8.2)

| Sistema | Status | Como |
|---|---|---|
| Movimento por `behaviour` | FEITO | andar (`navigation.walk`, `random_stroll` com `wanderChance`/`wanderSpeed`), voar (`navigation.fly`, `movement.fly`, `random_fly`, sem dano de queda), nadar (`navigation.generic`, `underwater_movement`, `random_swim`), anfíbio (`movement.amphibious`), lava (`lava_movement` + `can_walk_in_lava` para imunes a fogo), `moves_to_water` (avoidsLand), `floats` (não respira na água), `looks_around` (canLook) |
| Selvagem x com dono | FEITO | `wild_ai` (wander, pânico/retaliação, herd) x `owned_ai` (segue a >5 blocos, teleporta a >32 como o MoveToOwnerTask; `owner_hurt_by_target` se willDefendOwner; `pet_sleep_with_owner` se willSleepOnBed) |
| Pânico / retaliação / luta | FEITO | `panics` = willFlee && !willDefendSelf → `behavior.panic`; `retaliates` = willDefendSelf → `hurt_by_target` + `melee_box_attack` (fightsMelee) |
| Seguir líder de herd | FEITO (aprox.) | `follow_mob` com filtro `has_tag cobblemon_herd_leader` + família de espécie tolerada (`toleratedLeaders`); o script põe a tag nos líderes (`cobblemon:herd_leader` do Spawner) |
| Alfa | FEITO | propriedade + `set_alpha`/`unset_alpha` com a escala de `getAlphaScaleMultiplier` (grupos de tamanho) |
| Tamanho por forma | FEITO | um grupo `cobblemon:size_<n>` por (hitbox, baseScale) distinto das formas e do Alfa; `scripts/entity/Size.ts` aplica pela forma ativa (loop de 1 s) |
| Sono | FEITO | `Sleep.ts`: DrowsySensor (drowsyChance/rouseChance por segundo, `times`, não sonolento se apanhou), `canSleepAt` (luz emitida pelo bloco de baixo, fluido, céu, no chão), selvagem dorme com status Sono e acorda sem; com dono só com status Sono ou na cama do dono dormindo (willSleepOnBed); acorda ao apanhar e em batalha sem status Sono |
| Som ambiente | FEITO | `cobblemon.pokemon.<id>.ambient` a cada `ambientPokemonCryTicks` (config) |
| Interações (`pokemon_interactions`, 167) | FEITO | tabela gerada; dono, sem agachar, item na mão; efeitos shrink (durabilidade da escova), drop, give, som; cooldown por grouping salvo no JSON do Pokémon (`interactionCooldowns`); requisitos de conjunto e de interação (gender, form) |
| Tosquia / lã | FEITO | tesoura em Wooloo/Dubwool/Mareep (dono ou selvagem): aspect `sheared`, 2–4 lãs da cor `color-*`; volta comendo grama (`eat_block` → `cobblemon:ate_grass`) |
| Tigela em Miltank mooshtank | FEITO (parcial) | ensopado de cogumelo; o suspeito (flor dada antes) não |
| Ombro | FEITO | agachar + usar com a mão vazia num Pokémon próprio sem item (formas shoulderMountable, não Alfa): monta no assento de ombro do `player.json`; não cai sozinho (volta ao ombro se o motor derrubar); sai com o mesmo gesto, agachando 2× rápido ou recolhendo |
| Montaria | FEITO (terra/ar/água, aprox.) | ver abaixo |

### Montaria

- Espécies/formas com `riding.seats` e `riding.behaviours` (o campo legado `behaviour`, usado por 28 espécies como
  Beedrill, é ignorado pelo 1.8.2 e aqui também). Assentos pelas posições dos locators `seat_N` da geometria padrão.
- Montar: agachar + usar com a mão vazia (se não puder ir ao ombro). Outro jogador entra como passageiro num
  Pokémon já montado (como o Cobblemon). Descer: agachar (vanilla).
- **LAND** (horse/vehicle/minekart): `input_ground_controlled` + `can_power_jump`/`horse.jump_strength` (canJump).
  Funciona como cavalo.
- **AIR** (bird/jet/hover/rocket/glider/helicopter): `free_camera_controlled` + `vertical_movement_action` e sem
  gravidade (como o ghast feliz vanilla). Decola com pulo duplo; pousa ao tocar o chão (RidingController).
  Fôlego (`STAMINA`) em segundos na actionbar; acabando, vira planeio com gravidade. `infiniteRideStamina` respeitado.
- **LIQUID** (dolphin/submarine/boat): `free_camera_controlled` + `underwater_movement` (+ `underwater_mount_breathing`
  para dolphin/submarine, como o nautilus). Entra na água → LIQUID.
- Velocidades convertidas dos `ride_settings` (`get_ride_stats` com o início de cada faixa de stat), calibradas pelo
  cavalo/ghast feliz/nautilus vanilla — **aproximação, precisa de ajuste no BDS**.
- Não portado: sprint e aceleração do cavalo, roll/pitch do pássaro, ride boosts, sons de vento, poses do jogador
  por assento, câmera do Cobblemon, `composite` (2 espécies).

## Aproximações e impossibilidades

- Dano corpo a corpo: o `minecraft:attack` é fixo por espécie (curva `attackToDamageCurve` com o Ataque de um
  Pokémon nível 25); o Bedrock estável não deixa o script mudar o dano por Pokémon.
- IA por forma: o JSON é por espécie, então `behaviour.moving/combat` de formas (120 formas) usam o da espécie;
  sono e tamanho usam a forma ativa (script).
- Tamanho de bebê (`babyPokemonSizeMultiplier`, ≤ 10% abaixo do nível 9): não feito (exigiria um grupo por nível).
- Altura dos olhos (`standing/swimming/flyingEyeHeight`): NOT_POSSIBLE — não há componente de altura dos olhos.
- `entityInteract` (creeper/esqueleto/phantom/raposa fogem de certos Pokémon no ombro): não feito — exigiria
  sobrescrever as entidades vanilla (creeper.json etc.), invasivo e frágil entre versões.
- Sono `depth` (normal/comatose): definido no 1.8.2 mas nunca usado pelo mod; idem aqui. A luz de `canSleepAt` é a
  luz **emitida** pelo bloco de baixo (comportamento real do 1.8.2), por tabela (o Bedrock não expõe emissão).
- Cooldown de interação corre pelo tempo absoluto do mundo (no Cobblemon só desconta com o dono online/no pasto).
- `script` de interação (corte do Furfrou) e action effects: não existem no port.
- Ombro: o motor do Bedrock pode derrubar entidades montadas no jogador (pulo/dano); o script recoloca no chão.
- Tudo acima precisa de verificação no BDS (não rodei o servidor, conforme as regras).

## Pedidos

### 1. `scripts/main.ts` (frente interface / orquestrador)

```ts
import { startEntityBehaviours } from "./entity";
// dentro de world.afterEvents.worldLoad.subscribe(...), depois de startSpawner():
startEntityBehaviours();
```

Liga: passada de 1 s nos Pokémon (sono, tamanho por forma/Alfa, som ambiente, tag de líder de herd), montaria
(2 ticks, só montados), ombro (10 ticks), `entityHurt`, `dataDrivenEntityTrigger` (`cobblemon:ate_grass`),
`playerButtonInput` (pulo duplo / agachar 2×), `entityRemove`.

### 2. Menu do Pokémon fora da bola (`scripts/GUI/Party.ts`, frente interface)

Equivalente à roda de interação do Cobblemon. No menu aberto por `showPokemonGUI` (Pokémon fora da bola):

```ts
import { canRidePokemon, startRiding, canShoulderMount, toggleShoulder, isOnShoulder } from "../entity";
// botão "cobblemon.ui.interact.ride" (lang do Cobblemon: "Ride") se canRidePokemon(player, entity)  → startRiding(player, entity)
// botão "cobblemon.ui.interact.mount.shoulder" ("Shoulder") se canShoulderMount(player, entity) || isOnShoulder(entity)
//   → toggleShoulder(player, entity)
```

### 3. `scripts/Pokemon.ts` (frente dados) — opcionais

1. Campo tipado `interactionCooldowns?: Record<string, number>` em `PokemonData` (grouping → tick absoluto do fim).
   Hoje é um campo extra do JSON, preservado por `getFromJson`/`JSON.stringify` (sem mudança obrigatória).
2. No fim de `applyToCobblemon`: `applyEntitySize(entity, this)` (`import { applyEntitySize } from "./entity/Size"`,
   sem ciclo de import) para a forma ativa valer no mesmo tick; hoje o loop de 1 s aplica.
3. `sendOut` → `tame()` antes de `cobblemon:set_owned`: agora funciona, porque `minecraft:tameable` está na base.

### 4. Spawn (`scripts/spawning/**`) — opcional

Adicionar a tag `cobblemon_herd_leader` no líder ao criar o herd (hoje o loop de entidades põe a tag em ≤ 1 s a
partir da dynamic property `cobblemon:herd_leader`). Pedidos da frente spawn atendidos: sem `minecraft:despawn`,
`cobblemon:alpha` + `set_alpha`/`unset_alpha` com a escala de Alfa, seguir o líder do herd. Pokémon no ombro
recebem `cobblemon:persistent = true`.

## Pedidos recebidos e atendidos

- `docs/pendencias/spawn.md` §1: despawn vanilla removido; Alfa (propriedade, grupos de tamanho, eventos); herd.

## Status da integração

- 1. `startEntityBehaviours()` no `main.ts`: ✅ feito (integração).
- 2. Botões Montar/Ombro no menu do Pokémon: ✅ feito (integração).
- 3.1 `interactionCooldowns` tipado em `PokemonData`: ✅ feito (integração). 3.2 `applyEntitySize` no fim de `applyToCobblemon`: ✅ feito (integração). 3.3 `tame()` antes de `set_owned`: ✅ feito (integração) (nada a mudar).
- 4. Tag `cobblemon_herd_leader` na criação do herd: ✅ feito (integração) — `Spawner.spawnActionEntity`.
- Contrato da entidade em `docs/ARQUITETURA.md`: ✅ feito (integração).
