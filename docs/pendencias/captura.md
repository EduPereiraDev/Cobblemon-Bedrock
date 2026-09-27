# Pendências da frente "captura" (captura, Poké Bolas e Pokédex)

Arquivos da frente: `scripts/catching/**`, `scripts/pokedex/**`, `behavior_packs/CobblemonBedrock/entities/pokeballs/**`,
`tests/captura.test.ts`. Tudo segue o Cobblemon 1.8.2 (fontes citadas no topo de cada arquivo).

## API para as outras frentes

### Pokédex (`scripts/pokedex`)

```ts
import { markSeen, markCaught, hasCaught, hasSeen, getSpeciesKnowledge, getCaughtCount, getDexCounts, openPokedex, DexProgress } from "../pokedex";

markSeen(player, pokemonData);                  // PokedexManager.encounter (também aceita "pikachu", ["alolan"])
markCaught(player, pokemonData);                // PokedexManager.obtain
markSeen(player, "raichu", ["alolan"]);         // espécie + aspectos → forma resolvida pelos aspectos
hasCaught(player, "raichu");                    // alguma forma OWNED; hasCaught(player, "raichu", "Alola") por forma
getSpeciesKnowledge(player, "pikachu");         // DexProgress.UNREGISTERED | SEEN | OWNED
getDexCounts(player);                           // { seen, caught, total } global (por espécie)
getDexCounts(player, "kanto");                  // por Pokédex (por entrada, como o PokedexValueCalculator)
openPokedex(player, "pikachu");                 // abre a entrada; sem espécie abre a lista de Pokédex
```

- `markSeen`/`markCaught` retornam `true` se algo mudou; só gravam quando muda (gênero/shiny/aspecto/nível novo ou
  conhecimento maior), como `FormDexRecord.wouldBeDifferent`.
- Armazenamento: dynamic properties do jogador `cobblemon:pokedex:<n>` (pedaços ≤ 30 KB) + `cobblemon:pokedex:count`.
  Formato compacto de uma linha por espécie (ver `PokedexRecords.ts`). Cache em memória por jogador.
- No login (`playerSpawn` inicial) todos os Pokémon do time e do PC são registrados como obtidos
  (`scheduleFullSyncFromStores`, 50 por tick via `system.runJob`).
- `setDexData(dexes, entries)` troca as Pokédex derivadas pelos JSON exatos do Cobblemon (pedido 2).

### Captura (`scripts/catching`)

- `bindCatchEvents()` (já chamado no `main.ts`) liga arremesso/captura **e** a Pokédex (`bindPokedex()`: item, comando
  `/cobblemon:pokedex`, sincronização no login). Não é preciso mudar o `main.ts`.
- `processCapture(thrower, ballEntity | PokeBall, targetEntity)`, `calculateCapture(...)` (pura), `getPokeBall(id)`,
  `getAllPokeBalls()`, `pokeBallName(id)`, `getPokeballEntityName(pokeball)`.
- Pokémon capturado: `pokeball = "cobblemon:<bola>"` (id do item, com namespace), `ogTrainer` (se vazio), `trainer`,
  efeitos da bola (Heal Ball cura, Friend Ball `setFriendship(150)`, Luxury Ball via `addFriendship`), remove os
  aspectos `honey_drenched`/`poke_snack_crumbed` (callback `pokemon_captured/remove_aspects`) e `markCaught`.

## Pedidos

### 1. Frente de batalhas (`scripts/battle/**`)

1. **Pokédex "visto"** (gatilhos do Cobblemon, `POKEMON_SEEN`): para cada jogador da batalha, chamar
   `markSeen(player, pokemon)` ao iniciar batalha selvagem (o selvagem), no início de PvP/desafio (os leads) e a cada
   Pokémon que entra em campo (`SwitchInstruction.broadcastSwitch`: o Pokémon público, i.e. a Ilusão se houver).
2. **Ações de captura** (`BattleCaptureAction.kt`): em `PokemonBattle`,
   - `captureActions: BattleCaptureAction[]` (tipo em `scripts/catching/CaptureSequence.ts`); `checkForInputDispatch`
     só envia as escolhas ao Showdown quando `captureActions.length === 0` (hoje a vez é consumida por
     `forceChoose(new ForcePassActionResponse())` mas o turno pode seguir enquanto a bola sacode);
   - `finishCaptureAction(action)`: remove a ação e reavalia o despacho;
   - `captureSucceeded(action)`: equivalente ao `>capture p2a` do Showdown do Cobblemon — marca o Pokémon como fora
     (`gone`), encerra a batalha como vitória do lado de quem capturou com `BATTLE_VICTORY(..., wasCaught = true)` e limpa
     as propriedades de batalha. Sem esse gancho a captura chama `battle.stop()` (empate forçado).
   A captura já usa `getActorFromID`, `isForPokemon`, `canFitForcedAction`, `forceChoose`, `broadcastChatMessage` e
   anuncia `cobblemon.capture.attempted_capture`/`succeeded`/`broke_free` como o Cobblemon.

### 2. Importador (`tools/importer/**`)

1. Gerar `generated/scripts/dex.ts` com
   `export const DEXES: CobblemonDexJson[]` (de `data/cobblemon/dexes/*.json`) e
   `export const DEX_ENTRIES: CobblemonDexEntryJson[]` (de `data/cobblemon/dex_entries/**` já com
   `dex_entry_additions` aplicadas; tipos em `scripts/pokedex/DexData.ts`). Depois a frente de interface liga no
   `main.ts`: `setDexData(DEXES, DEX_ENTRIES)` (import de `./pokedex`). Até lá as Pokédex são derivadas das espécies
   (faixas de número nacional + formas regionais), com as mesmas contagens do 1.8.2.
2. Manter o campo `pokedex` (chaves de descrição) de espécies e formas em `species.ts`. Sem ele a entrada usa
   `cobblemon.species.<espécie>[-<forma sem símbolos>].desc`, que cobre os casos do Cobblemon (ex.: `pikachu-alolabias`).

### 3. Conteúdo / resource pack

1. Itens das 16 bolas ancient (`cobblemon:ancient_{poke,citrine,verdant,azure,roseate,slate,ivory,great,ultra,heavy,leaden,gigaton,feather,wing,jet,origin}_ball`):
   `minecraft:projectile.projectile_entity` **igual ao id do item** (as entidades já existem em
   `behavior_packs/.../entities/pokeballs/ancient_*_ball.json`, com `power` = throwPower × 1,2: 1,5 / pesadas 0,9 /
   aladas 3,0), `minecraft:throwable` como a `poke_ball`, tag `cobblemon:poke_balls`.
2. Itens `cobblemon:pokedex_{red,yellow,green,blue,pink,black,white}` com `max_stack_size: 1`. O comportamento é por
   `world.afterEvents.itemUse` (não precisa de custom component).
3. RP: client entities `cobblemon:ancient_*_ball` (e `_dummy`) com `models/ancient_poke_ball.geo.json`,
   `animations/ancient_poke_ball.animation.json` (ids `animation.ancient_poke_ball.*`: open, open_idle, shut, bounce,
   bob1..6, critical, throw, break, capture, smallhop1/2, midhop1/2, bighop, weirdhop) e as texturas
   `textures/poke_balls/ancient_*.png` do Cobblemon. Sem isso a bola ancient funciona mas fica invisível.
4. Sons do Cobblemon que faltam no RP: `poke_ball.shut`, `poke_ball.bounce`, `poke_ball.break`,
   `poke_ball.shake.critical` e as variantes `.ancient` (`open`, `shut`, `bounce`, `break`, `capture_succeeded`,
   `shake`, `land`). Quando existirem, trocar os fallbacks em `CAPTURE_SOUNDS` (`scripts/catching/CaptureSequence.ts`).

### 4. Textos do port (dono de `resource_packs/CobblemonBedrock/texts/*.lang`)

```
## en_US.lang
cobblemon.port.pokedex.counts=Seen: %1$s · Owned: %2$s
cobblemon.port.pokedex.progress=%1$s/%2$s owned
cobblemon.port.pokedex.page=Page %1$s/%2$s
cobblemon.port.pokedex.next=Next page »
cobblemon.port.pokedex.previous=« Previous page
cobblemon.port.pokedex.back=« Back
cobblemon.port.pokedex.search_hint=Name or Pokédex number
cobblemon.port.pokedex.no_results=No Pokémon found.
cobblemon.port.pokedex.spawns=Where to find
cobblemon.port.pokedex.no_spawns=Not found in the wild.
cobblemon.port.pokedex.catch_to_learn=Catch it to learn more.
cobblemon.port.pokedex.scanning=Scanning...
cobblemon.port.pokedex.forms=Forms
cobblemon.port.pokedex.filter=Filter: %1$s

## pt_BR.lang
cobblemon.port.pokedex.counts=Vistos: %1$s · Capturados: %2$s
cobblemon.port.pokedex.progress=%1$s/%2$s capturados
cobblemon.port.pokedex.page=Página %1$s/%2$s
cobblemon.port.pokedex.next=Próxima página »
cobblemon.port.pokedex.previous=« Página anterior
cobblemon.port.pokedex.back=« Voltar
cobblemon.port.pokedex.search_hint=Nome ou número da Pokédex
cobblemon.port.pokedex.no_results=Nenhum Pokémon encontrado.
cobblemon.port.pokedex.spawns=Onde encontrar
cobblemon.port.pokedex.no_spawns=Não aparece na natureza.
cobblemon.port.pokedex.catch_to_learn=Capture para saber mais.
cobblemon.port.pokedex.scanning=Escaneando...
cobblemon.port.pokedex.forms=Formas
cobblemon.port.pokedex.filter=Filtro: %1$s
```

### 5. "Obtido" nas outras frentes (`POKEMON_GAINED`, `LEVEL_UP_EVENT`, `POKEMON_ASPECTS_CHANGED`)

Chamar `markCaught(owner, pokemon)` quando: um Pokémon entra no time/PC fora da captura (inicial, `/givepokemon`,
troca, fóssil, ovo — `pokemonStorage.storePokemonInFirstSpace` é o lugar natural), evolui (`Evolution.forceEvolve`,
com o Pokémon evoluído), sobe de nível com dono (`gainExp`) ou muda de aspecto/forma com dono. O login já sincroniza
tudo, então isto só adianta o registro.

### 6. Outros

0. `scripts/main.ts` (`playerInteractWithEntity`): usar a Pokédex clicando num Pokémon perto cai na interação com a
   entidade (o evento é cancelado e `itemUse` não dispara). Se `isPokedexItem(event.itemStack?.typeId)`, chamar
   `system.run(() => usePokedex(player))` (`import { isPokedexItem, usePokedex } from "./pokedex"`) em vez de
   `handlePokemonInteract`. De longe (fora do alcance de interação) já funciona pelo `itemUse`.

1. `scripts/custom_components/HealingMachineComponent.ts:87`: `pokeball` agora é o id do item com namespace
   (`cobblemon:poke_ball`, pedido da frente de dados). Trocar `cobblemon:${pokemon.pokeball || "poke_ball"}_dummy` por
   `cobblemon:${getPokeballEntityName(pokemon.pokeball)}_dummy` (`import { getPokeballEntityName } from "../catching"`),
   que aceita os dois formatos (saves antigos guardam `poke_ball`). Existem dummies das 16 ancient.
2. `scripts/events/ScriptEvents.ts` (`cobblemon:pokeball_thrown`): o handler sobrescreve `player_id` com o jogador mais
   próximo; `bindCatchEvents` já grava o dono real do projétil no `entitySpawn`. Só gravar se ainda não houver
   (`if (!event.sourceEntity.getDynamicProperty("player_id"))`), senão em multiplayer a bola pode ir para outro jogador.
3. Pesca: ao gerar um Pokémon pela vara, pôr o aspecto `"fished"` (`FishingSpawnCause.FISHED_ASPECT`) nos aspectos do
   Pokémon (ou a tag `fished` na entidade) para a Lure Ball dar 4×.
4. Marcas (frente de dados): expor `applyPotentialMarks(pokemon)` para o callback `pokemon_captured/apply_marks`; a
   captura chama quando existir.

## Notas de paridade (Cobblemon 1.8.2)

- **Fórmula** idêntica ao `CobblemonCaptureCalculator` (Float 32 bits, `Math.fround`): catch rate da forma, 1× em
  batalha/0,5× fora, status 2,5/1,5, bônus de nível baixo `max((36 - 2·nível) / 10, 1)` com **divisão inteira**
  (o port antigo usava `36 - 2·nível`, até 34×), limiar `round(65536 / (255/taxa)^0,1875)` com `nextInt(65537)`,
  captura crítica pelo CaughtCount (0/0,5/1/1,5/2/2,5 × taxa / 6, `nextInt(256)`) e o `PokedexStatusCaptureInfluencer`
  (forma já capturada → sucesso vira crítica de 1 sacudida). A penalidade por nível (`findHighestThrowerLevel`) foi
  portada igual, inclusive o fato de nunca valer para selvagens no 1.8.2.
- **Bolas** (49: 32 do Cobblemon + 16 ancient + `strange_ball` do port como bola comum). Corrigidas: Timer
  (`1 + turno·1229/4096`, máx. 4), Beast (0,1× fora de UB), Lure (4× em pescados, não mais boost de Água), Safari
  (1,5× **fora** de batalha), Moon (noite = `tempo % 24000 ≥ 12000`; o port antigo invertia), Dusk (luz real:
  0 → 3,5×, 1–7 → 3×), Park (bioma `#cobblemon:is_temperate`), Level (limiar ×2 corrigido), Love (2,5× para gênero oposto de
  outra espécie), Heavy (peso da forma, faixas fechadas), Dive (olhos na água), Repeat (Pokédex), Fast (atributo da
  forma). Ancient: great/wing 1,5×, ultra/jet/gigaton 2×, leaden 1,5×, origin garantida; throwPower no `power` do
  projétil; 1 pulo e 1,8 s até capturar. Água: `liquid_inertia` 0,8 (Dive 0,99) = `waterDragValue`.
- **Sequência**: tempos do `EmptyPokeBallEntity` (quique 0,7 s, abre 0,2 s, fecha 1,95 s, some e cai em 2,2 s, pouso
  ≤ 1,5 s, 1 s até a 1ª sacudida, 1,25 s entre elas, 4 sacudidas animam 3, crítica anima "critical" e pula a primeira
  iteração, captura 1 s depois do resultado). Animações do client entity tocadas por id completo
  (`animation.poke_ball.bobN`, `critical`, `capture`, `break`...). Diferenças: sem o shader de "raio" (partículas
  `endrod` + invisibilidade), o Pokémon não encolhe, e a bola é movida por teleporte. Ao escapar o Pokémon reaparece
  na bola e, fora de batalha, acorda (como no Cobblemon); a fuga do capturador (`PokemonBrain.onCaptureFailed`) não
  foi portada.
- **Mensagens**: em batalha iguais ao `BattleCaptureAction` (tentativa em amarelo; sucesso/fuga 2 s depois). Fora de
  batalha o Cobblemon não manda mensagem; o port mantém "Gotcha!"/"escapou" para o arremessador.
- **Captura em batalha**: só singles e com o selvagem sem reserva (`not_single`), `not_your_turn` se não couber ação
  forçada; consome a vez. Isto é o comportamento do 1.8.2 (o doc de paridade anterior dizia que doubles eram permitidas).
- **Pokédex**: modelo `SpeciesDexRecord`/`FormDexRecord` (gêneros, shiny, maior nível, aspectos, conhecimento por
  forma), CaughtCount/SeenCount, entradas com `unlockForms`, nacional aglutinada por espécie. Tela: nome/tipos com a
  espécie vista; descrição, altura/peso, habilidades e atributos com a forma capturada; drops e resumo de spawn com a
  forma vista (o resumo de spawn é extra do port). Scanner sem zoom/overlay: mira + 15 ticks segurando a Pokédex.
  `hideUnimplementedPokemonInThePokedex` respeitado. Variações (`variations`/`displayAspects`) ainda não aparecem.
- **Comando** `/cobblemon:pokedex <grant|revoke|printcalculations> <jogadores> [all|only] [pokédex|espécie] [forma]`.

## Status da integração

- 1.1 `markSeen` em batalha (cada Pokémon que entra em campo, inclusive os leads): ✅ feito (integração).
- 1.2 Ações de captura (`captureActions`, `finishCaptureAction`, `captureSucceeded`): ✅ feito (integração).
- 2.1 `generated/scripts/dex.ts`: ✅ feito (integração) — e ligado no `main.ts` (`setDexData(DEXES, DEX_ENTRIES)`).
- 2.2 Campo `pokedex` em `species.ts`: ✅ feito (integração).
- 3.1 Itens ancient com o projétil próprio: ✅ feito (integração). 3.2 Pokédex com pilha 1: ✅ feito (integração). 3.3 Client entities/animações/texturas ancient: ✅ feito (integração).
- 3.4 Sons `poke_ball.shut/bounce/break/shake.critical` e `.ancient`: ✅ feito (integração) — `CAPTURE_SOUNDS` usa os sons do Cobblemon; `captureSound` escolhe a variante `.ancient`; som de fechar e de quique no chão acrescentados.
- 4. Textos `cobblemon.port.pokedex.*`: ✅ feito (integração).
- 5. `markCaught` fora da captura: ✅ feito (integração) — `storePokemonInFirstSpace` (inicial, `/givepokemon`, troca, fóssil), `Evolution.forceEvolve` e `gainExp` com dono. Mudança de aspecto/forma com dono: ⏭️ não feito: não há um ponto central de troca de aspecto (o login já sincroniza).
- 6.0 Pokédex ao clicar num Pokémon: ✅ feito (integração). 6.1 Healing Machine com `getPokeballEntityName`: ✅ feito (integração). 6.2 `player_id` do `pokeball_thrown`: ✅ feito (integração). 6.3 Aspect/tag `fished` na pesca (Lure Ball 4×): ✅ feito (integração) — pesca e Lure Ball usam o mesmo `"fished"` (aspect + tag).
- 6.4 `applyPotentialMarks`: ✅ feito (integração) — `scripts/pokemon/Marks.ts` (algoritmo do `Pokemon.applyPotentialMarks`, marcas do `apply_potential_marks.molang` no spawn, `mark_fishing` na pesca, Alfa → `mark_jumbo`), chamado em `completeCapture`.
