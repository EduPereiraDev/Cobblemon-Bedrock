/**
 * Ações dos comandos da frente social (o registro fica em scripts/commands.ts, feito pelo orquestrador; ver
 * docs/pendencias/social.md). Todas rodam fora do contexto restrito (chamar dentro de system.run).
 *
 *   /cobblemon:spawnnpc <classe|preset> [nível] [skin]      (alias /cobblemon:npcspawn)   — SpawnNPCCommand
 *   /cobblemon:spawnnpcat <posição> <classe|preset> [nível]  (alias /cobblemon:npcspawnat)
 *   /cobblemon:npcdelete                                      — NPC que o jogador está olhando
 *   /cobblemon:npcedit                                        — editor do NPC que o jogador está olhando
 *   /cobblemon:opendialogue <diálogo> <jogador>               — OpenDialogueCommand
 *   /cobblemon:trade <jogador>                                — pedido/aceite de troca (sem roda de interação)
 */
import { Dimension, Entity, Player, RawMessage, Vector3 } from "@minecraft/server";
import { NPC, isNPCEntity, spawnNPC } from "./NPCEntity";
import { getNPCClass, getNPCClassIds, getNPCPresetIds } from "./NPCClass";
import { getDialogue, getDialogueIds } from "./dialogue/Dialogue";
import { startDialogue } from "./dialogue/DialogueManager";
import { openNPCEditor } from "./NPCEditor";
import { requestTradeWith } from "../trade/TradeUI";

export interface CommandOutcome {
  ok: boolean;
  message: RawMessage;
}

const fail = (message: RawMessage): CommandOutcome => ({ ok: false, message });

/** Ids aceitos por /spawnnpc (classes e presets). */
export function npcSpawnables(): string[] {
  return [...new Set([...getNPCClassIds(), ...getNPCPresetIds()])];
}

export function spawnNPCCommand(dimension: Dimension, location: Vector3, classId: string, level = 1, skin?: number): CommandOutcome {
  if (!getNPCClass(classId))
    return fail({ rawtext: [{ translate: "cobblemon.command.error.nonpc" }, { text: ` (${npcSpawnables().join(", ")})` }] });
  if (!Number.isFinite(level) || level < 1) return fail({ text: "Invalid level / Nível inválido" });
  try {
    const npc = spawnNPC(dimension, location, classId, { level: Math.floor(level), skin });
    if (!npc) return fail({ translate: "cobblemon.command.error.nonpc" });
    return { ok: true, message: { translate: "cobblemon.port.npc.spawned", with: [npc.name, npc.classId] } };
  }
  catch (e) {
    return fail({ text: `Unable to spawn at the given position: ${e}` });
  }
}

/** traceFirstEntityCollision: primeiro NPC na direção do olhar (até 16 blocos). */
export function lookedAtNPC(player: Player): NPC | undefined {
  try {
    const hits = player.getEntitiesFromViewDirection({ maxDistance: 16 });
    const hit = hits.find(h => isNPCEntity(h.entity));
    return hit ? NPC.from(hit.entity) : undefined;
  }
  catch { return undefined; }
}

export function npcDeleteCommand(player: Player, target?: Entity): CommandOutcome {
  const npc = target ? NPC.from(target) : lookedAtNPC(player);
  if (!npc) return fail({ translate: "cobblemon.command.npcedit.non_npc" });
  const name = npc.name;
  try { npc.entity.remove(); }
  catch { npc.entity.triggerEvent("cobblemon:instant_kill"); }
  return { ok: true, message: { translate: "cobblemon.command.npcdelete.deleted", with: [name] } };
}

/**
 * /npcdelete <alvo> (NPCDeleteCommand com EntityArgument): funciona pelo console. Apaga os NPCs do seletor e
 * responde com o nome do último; alvo que não é NPC → `npcedit.non_npc`.
 */
export function npcDeleteEntitiesCommand(targets: readonly Entity[]): CommandOutcome {
  const npcs = targets.map(x => NPC.from(x)).filter((x): x is NPC => !!x);
  if (!npcs.length) return fail({ translate: "cobblemon.command.npcedit.non_npc" });
  let name = "";
  for (const npc of npcs) {
    name = npc.name;
    try { npc.entity.remove(); }
    catch { npc.entity.triggerEvent("cobblemon:instant_kill"); }
  }
  return { ok: true, message: { translate: "cobblemon.command.npcdelete.deleted", with: [name] } };
}

export function npcEditCommand(player: Player): CommandOutcome {
  const npc = lookedAtNPC(player);
  if (!npc) return fail({ translate: "cobblemon.command.npcedit.non_npc" });
  void openNPCEditor(player, npc);
  return { ok: true, message: { text: "" } };
}

export function openDialogueCommand(dialogueId: string, player: Player): CommandOutcome {
  const dialogue = getDialogue(dialogueId);
  if (!dialogue) return fail({ text: `Invalid dialogue: ${dialogueId} (${getDialogueIds().join(", ")})` });
  startDialogue(player, dialogue);
  return { ok: true, message: { text: "" } };
}

export function tradeCommand(player: Player, target: Player | undefined): CommandOutcome {
  if (!target || target.id === player.id) return fail({ translate: "cobblemon.ui.interact.unavailable" });
  requestTradeWith(player, target);
  return { ok: true, message: { text: "" } };
}
