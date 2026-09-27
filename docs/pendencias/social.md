# Pendências da frente "social" (NPCs, diálogos, treinadores, troca)

Arquivos da frente: `scripts/npc/**` (`molang/MoLang.ts`, `dialogue/{Dialogue,ActiveDialogue,DialogueManager}.ts`,
`NPCClass.ts`, `Party.ts`, `NPCEntity.ts`, `PlayerStruct.ts`, `NPCEditor.ts`, `commands.ts`, `index.ts`),
`scripts/trade/**` (`TradeManager.ts`, `TradeUI.ts`, `PlayerInteraction.ts`), `tools/importer/npcs.ts`,
`tests/social.test.ts`. Gerados: `generated/{behavior_packs/.../entities/npc,resource_packs/.../{entity,models/entity,animations,animation_controllers,render_controllers}/npc,resource_packs/.../textures/npcs}`
e `generated/scripts/npcs.ts`.

Edições mínimas em arquivos compartilhados (já feitas, avisar a frente "conteúdo"):
- `tools/importer/index.ts`: `import { emitNpcs } from "./npcs.ts";` e `emitNpcs();` logo depois de `emitBiomeTagsModule(...)`.
- `tools/importer/validate.ts`: a client entity em `entity/npc/` não exige espécie em `variants.ts`, e a entidade BP em
  `entities/npc/` só precisa ter client entity (faixa de `cobblemon:variant` e eventos são de Pokémon).
- `tests/mocks/minecraft-server.ts`: export `EquipmentSlot` acrescentado no fim.

## API para as outras frentes

```ts
// scripts/npc (index.ts reexporta)
registerSocialEvents()                        // liga interação com NPC, hits, saída de jogador, BATTLE_VICTORY, /summon
spawnNPC(dimension, location, "standard" | "battler_test", { level?, name?, skin? }): NPC | undefined
interactWithNPC(player, entity)  startTrainerBattle(npc, player, "double"?)  openNPCDialogue(npc, player, "npc-example")
getDialogue(id) / registerDialogue(dialogue) / startDialogue(player, dialogue, { npc?, onClosed? }) / stopDialogue(player)
getNPCClass(id)  getNPCClassIds()  getNPCPresetIds()
spawnNPCCommand / npcDeleteCommand / npcEditCommand / openDialogueCommand / tradeCommand / npcSpawnables()
openPlayerInteractionMenu(player, target)     // Batalha simples/dupla/tripla (ChallengePlayer) + Troca
// scripts/trade
tradeManager (TradeManager), requestTradeWith(sender, target), onTradePlayerLeave(playerId)
attemptTradeEvolution(pokemon, otherPokemon), transferOwnership(pokemon, from, to)
```

## Pedidos

### 1. `scripts/main.ts` (orquestrador)

```ts
import { registerSocialEvents } from "./npc";
// no nível do módulo (junto dos outros subscribe):
registerSocialEvents();
```

`registerSocialEvents` assina: `world.beforeEvents.playerInteractWithEntity` só para `cobblemon:npc` (não conflita com o
handler de Pokémon), `world.afterEvents.entitySpawn` (NPC criado por `/summon` vira "standard" nível 1),
`world.afterEvents.entityHitEntity`, `world.afterEvents.playerLeave` e `CobblemonEvents.on("BATTLE_VICTORY")`.

### 2. Interação jogador → jogador (dono de `scripts/events/ScriptEvents.ts`)

Em `"cobblemon:recieve_challenge"` (disparado pelo `player.json` ao interagir com outro jogador), trocar
`handleChallenge(challenger, player)` por:

```ts
import { openPlayerInteractionMenu } from "../npc";
void openPlayerInteractionMenu(challenger, player);   // Batalha simples/dupla/tripla + Troca
```

### 3. Comandos (`scripts/commands.ts`)

Todos em `later(...)` (fora do contexto restrito). Opcional: `event.customCommandRegistry.registerEnum("cobblemon:npcclass", npcSpawnables())`
e usar `P.Enum` com `enumName: "cobblemon:npcclass"` no parâmetro `class`.

```ts
import { npcDeleteCommand, npcEditCommand, openDialogueCommand, spawnNPCCommand, tradeCommand } from "./npc";

function registerSocialCommands(event: StartupEvent) {
  const spawnAt = (origin: CustomCommandOrigin, cls: string, level?: number, skin?: number, position?: Vector3) =>
    later(origin, (executor, reply) => {
      const source = executor ?? origin.sourceEntity;
      const where = position ?? source?.location;
      if (!source || !where) { reply(message.error({ text: ONLY_PLAYERS })); return; }
      const out = spawnNPCCommand(source.dimension, where, cls, level ?? 1, skin);
      reply(out.ok ? out.message : message.error(out.message));
    });
  for (const name of ["cobblemon:spawnnpc", "cobblemon:npcspawn"]) register(event, {
    name, description: "Spawns an NPC (class or preset) / Cria um NPC (classe ou preset).",
    permissionLevel: ADMIN, cheatsRequired: true,
    mandatoryParameters: [{ name: "class", type: P.String }],
    optionalParameters: [{ name: "level", type: P.Integer }, { name: "skin", type: P.Integer }],
  }, (origin, cls: string, level?: number, skin?: number) => spawnAt(origin, cls, level, skin));
  for (const name of ["cobblemon:spawnnpcat", "cobblemon:npcspawnat"]) register(event, {
    name, description: "Spawns an NPC at a position / Cria um NPC numa posição.",
    permissionLevel: ADMIN, cheatsRequired: true,
    mandatoryParameters: [{ name: "position", type: P.Location }, { name: "class", type: P.String }],
    optionalParameters: [{ name: "level", type: P.Integer }],
  }, (origin, position: Vector3, cls: string, level?: number) => spawnAt(origin, cls, level, undefined, position));
  register(event, {
    name: "cobblemon:npcdelete", description: "Deletes the NPC you are looking at / Apaga o NPC para onde você olha.",
    permissionLevel: ADMIN, cheatsRequired: true,
  }, origin => laterAsPlayer(origin, (player, reply) => {
    const out = npcDeleteCommand(player);
    reply(out.ok ? out.message : message.error(out.message));
  }));
  register(event, {
    name: "cobblemon:npcedit", description: "Edits the NPC you are looking at / Edita o NPC para onde você olha.",
    permissionLevel: ADMIN, cheatsRequired: true,
  }, origin => laterAsPlayer(origin, (player, reply) => {
    const out = npcEditCommand(player);
    if (!out.ok) reply(message.error(out.message));
  }));
  register(event, {
    name: "cobblemon:opendialogue", description: "Opens a dialogue for a player / Abre um diálogo para um jogador.",
    permissionLevel: ADMIN, cheatsRequired: true,
    mandatoryParameters: [{ name: "dialogue", type: P.String }, { name: "player", type: P.PlayerSelector }],
  }, (origin, dialogue: string, players: Player[]) => later(origin, (_, reply) => {
    for (const player of players ?? []) {
      const out = openDialogueCommand(dialogue, player);
      if (!out.ok) reply(message.error(out.message));
    }
  }));
  register(event, {
    name: "cobblemon:trade", description: "Requests (or accepts) a trade with a player / Pede (ou aceita) troca com um jogador.",
    permissionLevel: ANY, cheatsRequired: false,
    mandatoryParameters: [{ name: "player", type: P.PlayerSelector }],
  }, (origin, players: Player[]) => laterAsPlayer(origin, (player, reply) => {
    const out = tradeCommand(player, players?.find(p => p.isValid && p.id !== player.id));
    if (!out.ok) reply(message.error(out.message));
  }));
}
```

Documentar em `docs/COMANDOS.md`: `spawnnpc|npcspawn <classe|preset> [nível] [skin]`, `spawnnpcat|npcspawnat <pos> <classe|preset> [nível]`,
`npcdelete`, `npcedit`, `opendialogue <diálogo> <jogador>`, `trade <jogador>`. Classes: `standard`, `sacchi`, `ai_test`,
`kitchen_sink`; preset: `battler_test`. Diálogos: `example`, `npc-example`, `sacchi_interaction`, `sacchi_healed`.

### 4. Textos (dono de `resource_packs/CobblemonBedrock/texts/*.lang` / `tools/importer/lang.ts` EXTRA)

As demais chaves usadas já existem no Cobblemon (`cobblemon.trade.*`, `cobblemon.ui.interact.*`, `cobblemon.ui.trade`,
`cobblemon.battle.types.*`, `cobblemon.command.npcdelete.*`, `cobblemon.command.npcedit.non_npc`, `cobblemon.command.error.nonpc`,
`npc.sacchi.name`) ou no vanilla (`gui.back`).

```
## en_US.lang
entity.cobblemon:npc.name=NPC
cobblemon.port.dialogue.continue=Continue
cobblemon.port.npc.already_defeated=You have already defeated %1$s.
cobblemon.port.npc.cooldown=%1$s isn't ready for another battle yet. Please come back later.
cobblemon.port.npc.spawned=Spawned %1$s (%2$s).
cobblemon.port.npc.editor.title=Edit NPC
cobblemon.port.npc.editor.name=Name
cobblemon.port.npc.editor.level=Level
cobblemon.port.npc.editor.skin=Skin
cobblemon.port.npc.editor.class=Class / preset (resets the NPC)
cobblemon.port.npc.editor.dialogue=Interaction
cobblemon.port.npc.editor.class_default=Class default
cobblemon.port.npc.editor.none=None
cobblemon.port.npc.editor.regenerate_party=Generate a new party
cobblemon.port.npc.editor.saved=%1$s was updated.
cobblemon.port.trade.your_offer=Your offer:
cobblemon.port.trade.their_offer=%1$s's offer:
cobblemon.port.trade.nothing_offered=§7(no Pokémon chosen yet)
cobblemon.port.trade.choose=Choose a Pokémon to offer
cobblemon.port.trade.withdraw_offer=Withdraw my offer
cobblemon.port.trade.accept=Accept trade
cobblemon.port.trade.unaccept=Withdraw acceptance
cobblemon.port.trade.cancel=Cancel trade
cobblemon.port.trade.accepted=§aYou accepted. Waiting for the other trainer...
cobblemon.port.trade.waiting=Both trainers must accept to trade.
cobblemon.port.trade.cancelled=The trade was cancelled by %1$s.
cobblemon.port.trade.completed=Trade complete! You sent %1$s and received %2$s.
cobblemon.port.trade.invalid=The trade was cancelled: an offered Pokémon is no longer in the party.

## pt_BR.lang
entity.cobblemon:npc.name=NPC
cobblemon.port.dialogue.continue=Continuar
cobblemon.port.npc.already_defeated=Você já derrotou %1$s.
cobblemon.port.npc.cooldown=%1$s ainda não está pronto para outra batalha. Volte mais tarde.
cobblemon.port.npc.spawned=%1$s criado (%2$s).
cobblemon.port.npc.editor.title=Editar NPC
cobblemon.port.npc.editor.name=Nome
cobblemon.port.npc.editor.level=Nível
cobblemon.port.npc.editor.skin=Aparência
cobblemon.port.npc.editor.class=Classe / preset (reinicia o NPC)
cobblemon.port.npc.editor.dialogue=Interação
cobblemon.port.npc.editor.class_default=Padrão da classe
cobblemon.port.npc.editor.none=Nenhuma
cobblemon.port.npc.editor.regenerate_party=Gerar um time novo
cobblemon.port.npc.editor.saved=%1$s foi atualizado.
cobblemon.port.trade.your_offer=Sua oferta:
cobblemon.port.trade.their_offer=Oferta de %1$s:
cobblemon.port.trade.nothing_offered=§7(nenhum Pokémon escolhido ainda)
cobblemon.port.trade.choose=Escolher um Pokémon para oferecer
cobblemon.port.trade.withdraw_offer=Retirar minha oferta
cobblemon.port.trade.accept=Aceitar troca
cobblemon.port.trade.unaccept=Retirar aceite
cobblemon.port.trade.cancel=Cancelar troca
cobblemon.port.trade.accepted=§aVocê aceitou. Esperando o outro treinador...
cobblemon.port.trade.waiting=Os dois treinadores precisam aceitar para trocar.
cobblemon.port.trade.cancelled=A troca foi cancelada por %1$s.
cobblemon.port.trade.completed=Troca concluída! Você enviou %1$s e recebeu %2$s.
cobblemon.port.trade.invalid=A troca foi cancelada: um Pokémon oferecido não está mais no time.
```

### 5. Batalhas (`scripts/battle/**`)

1. `startNPCBattle(..., { healFirst?, cloneParties?, adjustLevel? })`: parâmetros 3–5 de `q.npc.start_battle` (nível
   ajustado/clone/cura do time do jogador). Hoje são ignorados (a battle API usa o time real).
2. Gancho de ator NPC: `onUseMove` → `entity.playAnimation("animation.cobblemon_npc.command")`, envio/recolhimento →
   `send_out`/`recall` (ids em `NPC_ANIMATIONS` de `generated/scripts/npcs.ts`). Vitória/derrota já são tocadas pela frente social.
3. `battleTheme` do NPC (`npcClass.battleTheme`, padrão `pvn`): `BattleActor` só toca música para jogador; nada a fazer até haver faixas.

### 6. Dados do Pokémon (`scripts/Pokemon.ts`, `PokemonProperties.ts`)

1. `PokemonProperties`: tratar `moves=a,b,c,d` (hoje vai para `extra`; `scripts/npc/Party.ts` aplica à parte).
2. Campo `tradeable?: boolean` em `PokemonData` (Pokemon.tradeable; a troca já respeita `tradeable === false`).
3. `tradeFriendship?: Record<playerId, number>` é gravado pela troca (cacheFriendship/restoreFriendship); se quiserem, declarar no tipo.

## Status da integração

- 1. `registerSocialEvents()` no `main.ts`: ✅ feito (integração).
- 2. Interação jogador→jogador abre `openPlayerInteractionMenu` (batalha em andamento/desafio pendente resolvem direto): ✅ feito (integração).
- 3. Comandos `spawnnpc|npcspawn`, `spawnnpcat|npcspawnat`, `npcdelete`, `npcedit`, `opendialogue`, `trade` + `docs/COMANDOS.md`: ✅ feito (integração). Enum `cobblemon:npcclass`: ⏭️ não feito: opcional (a classe continua texto livre, com a lista no erro).
- 4. Textos (`entity.cobblemon:npc.name` + `cobblemon.port.{dialogue,npc,trade}.*`): ✅ feito (integração).
- 5.1 `start_battle` com parâmetros extras: ✅ feito (integração) em parte — `healFirst` (sem clone) e `rules` (6º parâmetro); `cloneParties`/`setLevel`: ⏭️ não feito: a battle API grava no time real do jogador (sem batalha com cópia).
- 5.2 Animações do NPC em batalha (`command` ao usar golpe, `send_out` ao mandar Pokémon): ✅ feito (integração).
- 5.3 Música do NPC: ⏭️ não feito: não há faixas de batalha no Cobblemon 1.8.2.
- 6.1 `moves=` no `PokemonProperties` (espaços sorteados, como o Cobblemon; `tradeable=` também): ✅ feito (integração). 6.2 `tradeable` em `PokemonData` (respeitado na troca): ✅ feito (integração). 6.3 `tradeFriendship` declarado: ✅ feito (integração).
- Paridade: NPC leva dano por padrão (NPCClass.isInvulnerable = false), com a propriedade `cobblemon:invulnerable` ligada pela classe: ✅ feito (integração).
