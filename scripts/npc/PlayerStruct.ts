/**
 * `q.player` para o MoLang do servidor (PlayerMoLangFunctions do Cobblemon, só o subconjunto usado pelos
 * diálogos/scripts/callbacks do 1.8.2) e os dados MoLang persistentes do jogador (`q.player.data()`,
 * Cobblemon.molangData), salvos na dynamic property `cobblemon_molang_data` do jogador.
 */
import { EntityEquippableComponent, EquipmentSlot, Player, world } from "@minecraft/server";
import { MoArray, MoStruct, MoValue, asNumber, asString } from "./molang/MoLang";
import { getConfig } from "../Config";
import { getSafeTeam, healPlayerTeam } from "../pokemonStorage";
import type { PokemonData } from "../Pokemon";
import { tryGetBattleFromEntity } from "../battle";
import { registerPlayerFunctions } from "../molang/PlayerFunctions"; // frente dados-ia

export const MOLANG_DATA_PROPERTY = "cobblemon_molang_data";

const dataCache = new Map<string, MoStruct>();

/** Dados MoLang do jogador (VariableStruct salvo). O mesmo objeto é devolvido até `saveMoLangData`. */
export function getMoLangData(player: Player): MoStruct {
  let data = dataCache.get(player.id);
  if (!data) {
    let raw: unknown;
    try {
      const json = player.getDynamicProperty(MOLANG_DATA_PROPERTY);
      raw = typeof json === "string" ? JSON.parse(json) : undefined;
    }
    catch { raw = undefined; }
    data = MoStruct.fromJSON(raw);
    dataCache.set(player.id, data);
  }
  return data;
}

export function saveMoLangData(player: Player): void {
  const data = getMoLangData(player);
  try { player.setDynamicProperty(MOLANG_DATA_PROPERTY, JSON.stringify(data.toJSON())); }
  catch (e) { console.warn(`Não foi possível salvar os dados MoLang de ${player.name}: ${e}`); }
}

/** Esquece o cache (jogador saiu). */
export function forgetMoLangData(playerId: string): void {
  dataCache.delete(playerId);
}

/** Dados do jogador sobre um NPC (get_npc_data): struct criado sob demanda. */
export function getNpcData(player: Player, npcUuid: string): MoStruct {
  const data = getMoLangData(player);
  const existing = data.get(npcUuid);
  if (existing instanceof MoStruct) return existing;
  const created = new MoStruct();
  data.set(npcUuid, created);
  return created;
}

/** Tempo absoluto do mundo (world.game_time do Cobblemon). */
export function worldTime(): number {
  try {
    const t = world.getAbsoluteTime();
    return typeof t === "number" ? t : 0;
  }
  catch { return 0; }
}

/** Precisa de cura (Pokemon.canBeHealed): HP, status ou PP. */
export function canBeHealed(pokemon: PokemonData): boolean {
  return pokemon.currentHealth < pokemon.maxHealth || pokemon.status !== undefined || pokemon.movesInfo.some(m => m.pp < m.maxPp);
}

function heldItemStruct(player: Player): MoStruct {
  let id = "minecraft:air";
  try {
    const equippable = player.getComponent("minecraft:equippable") as EntityEquippableComponent | undefined;
    const item = equippable?.getEquipment(EquipmentSlot.Mainhand);
    if (item && typeof item.typeId === "string") id = item.typeId;
  }
  catch { }
  return new MoStruct({ id }, {
    is_of: args => (normalizeId(asString(args[0])) === normalizeId(id) ? 1 : 0),
    is_empty: () => (id === "minecraft:air" ? 1 : 0),
  });
}

function normalizeId(id: string): string {
  const clean = id.trim().toLowerCase();
  return clean.includes(":") ? clean : `minecraft:${clean}`;
}

/** Posição de bloco a partir de `[x, y, z]` (ArrayStruct.asBlockPos). */
export function asBlockPos(value: MoValue | undefined): { x: number; y: number; z: number } | undefined {
  if (value instanceof MoArray && value.items.length >= 3) return { x: Math.floor(asNumber(value.items[0])), y: Math.floor(asNumber(value.items[1])), z: Math.floor(asNumber(value.items[2])) };
  if (value instanceof MoStruct) return { x: Math.floor(asNumber(value.get("x"))), y: Math.floor(asNumber(value.get("y"))), z: Math.floor(asNumber(value.get("z"))) };
  return undefined;
}

/** Quantos "pontos" de carga a máquina precisa para curar o time (HealingMachineComponent: 2 Pokémon por ponto). */
function neededCharge(player: Player): number {
  const team = getSafeTeam(player).filter((x): x is PokemonData => x != null);
  return Math.floor(team.filter(canBeHealed).length / 2);
}

/** Máquina de cura no local pode curar o time do jogador (HealingMachineBlockEntity.canHeal). */
export function canHealAtHealer(player: Player, pos: { x: number; y: number; z: number }): boolean {
  try {
    const block = player.dimension.getBlock(pos);
    if (!block || block.typeId !== "cobblemon:healing_machine") return false;
    if (block.permutation.getState("cobblemon:busy" as any)) return false;
    if (getConfig().infiniteHealerCharge) return true;
    const charge = Number(block.permutation.getState("cobblemon:charge" as any) ?? 0);
    return charge >= neededCharge(player);
  }
  catch { return false; }
}

/** put_pokemon_in_healer: gasta a carga e cura o time (sem a animação das bolas na máquina). */
export function putPokemonInHealer(player: Player, pos: { x: number; y: number; z: number }): boolean {
  if (!canHealAtHealer(player, pos)) return false;
  try {
    const block = player.dimension.getBlock(pos);
    if (block && !getConfig().infiniteHealerCharge) {
      const charge = Number(block.permutation.getState("cobblemon:charge" as any) ?? 0);
      block.setPermutation(block.permutation.withState("cobblemon:charge" as any, Math.max(0, charge - neededCharge(player)) as any));
    }
  }
  catch { }
  for (const pokemon of getSafeTeam(player)) pokemon?.return(player);
  healPlayerTeam(player);
  try { player.playSound("cobblemon.block.healing_machine.active"); } catch { }
  return true;
}

/** Struct `q.player` (asMoLangValue de ServerPlayer). */
export function createPlayerStruct(player: Player): MoStruct {
  const struct = new MoStruct({}, {}, player);
  struct
    .set("is_player", 1).set("is_npc", 0).set("is_pokemon", 0)
    .fn("username", () => player.name)
    .fn("name", () => player.name)
    .fn("uuid", () => player.id)
    .fn("main_held_item", () => heldItemStruct(player))
    // Retrato do jogador no diálogo: sem equivalente (forms não desenham modelos).
    .fn("face", () => 1)
    .fn("data", () => getMoLangData(player))
    .fn("save_data", () => { saveMoLangData(player); return 1; })
    .fn("get_npc_data", args => getNpcData(player, npcIdOf(args[0])))
    .fn("get_npc_variable", args => getNpcData(player, npcIdOf(args[0])).get(asString(args[1])) ?? 0)
    .fn("set_npc_variable", args => {
      getNpcData(player, npcIdOf(args[0])).set(asString(args[1]), args[2] ?? 0);
      if (args[3] === undefined || asNumber(args[3]) !== 0) saveMoLangData(player);
      return 1;
    })
    .fn("tell", args => { player.sendMessage(asString(args[0])); return 1; })
    .fn("damage", args => {
      try { player.applyDamage(asNumber(args[0])); } catch { }
      return 1;
    })
    .fn("in_battle", () => (tryGetBattleFromEntity(player) ? 1 : 0))
    .fn("is_party_at_full_health", () => (getSafeTeam(player).some(x => x != null && canBeHealed(x)) ? 0 : 1))
    .fn("can_heal_at_healer", args => {
      const pos = asBlockPos(args[0]);
      return pos && canHealAtHealer(player, pos) ? 1 : 0;
    })
    .fn("put_pokemon_in_healer", args => {
      const pos = asBlockPos(args[0]);
      return pos && putPokemonInHealer(player, pos) ? 1 : 0;
    })
    .fn("party_count", () => getSafeTeam(player).filter(x => x != null).length)
    .fn("world", () => new MoStruct({ game_time: worldTime() }))
    .fn("position", () => new MoArray([player.location.x, player.location.y, player.location.z]))
    .fn("x", () => player.location.x)
    .fn("y", () => player.location.y)
    .fn("z", () => player.location.z);
  registerPlayerFunctions(struct, player); // frente dados-ia: PlayerMoLangFunctions.kt que faltavam
  return struct;
}

/** Id do NPC a partir de um struct `q.npc` ou string (get_npc_data aceita os dois). */
function npcIdOf(value: MoValue | undefined): string {
  if (value instanceof MoStruct) return asString(value.get("uuid") ?? (value.functions.get("uuid")?.([], undefined as any) as MoValue | undefined));
  return asString(value);
}
