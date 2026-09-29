/**
 * Pokémon selecionado do time e envio rápido (Cobblemon 1.8.2: tecla R `PartySendBinding` + `SendOutPokemonHandler`,
 * setas `PARTY_OVERLAY_UP/DOWN` do overlay do time).
 *
 * O Bedrock não deixa add-ons criarem teclas; as entradas estáveis são pular/agachar (`playerButtonInput`) e comandos:
 * - **agachado + pular** = tecla R: com o Pokémon selecionado, mira (até `battleSpectateMaxDistance`):
 *   nada ou o próprio Pokémon → solta o selecionado onde se olha (ou recolhe, se já estiver fora);
 *   Pokémon selvagem que pode lutar (até `battleWildMaxDistance`) → batalha com o selecionado na frente;
 *   outro jogador → menu de interação (batalha/troca); em batalha → reabre a escolha da batalha;
 * - **agachar duas vezes rápido** = próximo Pokémon do time (seta para baixo); a seleção aparece na actionbar (fora de
 *   batalha: em batalha o overlay do time some, como no Java);
 * - `/cobblemon:selectslot <1-6>` e `/cobblemon:sendout [1-6]` fazem o mesmo por comando.
 *
 * A seleção fica na dynamic property `cobblemon:selected_slot` (índice 0..5) e pode ser lida pela HUD do time
 * (`getSelectedSlot`, pedido da frente ui-base).
 */
import { isSendOutAnimating, recallAnimated, sendOutAnimated } from "./SendOutAnimation";
import { Entity, InputButton, ButtonState, Player, RawMessage, system, world } from "@minecraft/server";
import { getConfig } from "../Config";
import { PokemonData } from "../Pokemon";
import { PARTY_SIZE, getSafeTeam } from "../pokemonStorage";

export const SELECTED_SLOT_PROPERTY = "cobblemon:selected_slot";
/** Janela para o duplo toque de agachar (ticks). */
export const DOUBLE_SNEAK_TICKS = 8;

type SlotHolder = Pick<Player, "getDynamicProperty" | "setDynamicProperty">;

/** Espaço selecionado (0..5). Padrão 0. */
export function getSelectedSlot(player: SlotHolder): number {
  const value = player.getDynamicProperty(SELECTED_SLOT_PROPERTY);
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < PARTY_SIZE ? value : 0;
}

export function setSelectedSlot(player: SlotHolder, slot: number) {
  const bounded = Math.max(0, Math.min(PARTY_SIZE - 1, Math.floor(slot)));
  player.setDynamicProperty(SELECTED_SLOT_PROPERTY, bounded);
  for (const listener of selectionListeners) {
    try { listener(player as Player, bounded); } catch { }
  }
}

/** Próximo espaço ocupado a partir de `current` na direção `step` (+1/−1), dando a volta. Sem nenhum ocupado: current. */
export function cycleSlot(occupied: readonly boolean[], current: number, step: 1 | -1): number {
  for (let i = 1; i <= PARTY_SIZE; i++) {
    const slot = ((current + step * i) % PARTY_SIZE + PARTY_SIZE) % PARTY_SIZE;
    if (occupied[slot]) return slot;
  }
  return current;
}

const selectionListeners = new Set<(player: Player, slot: number) => void>();
/** Avisa quando a seleção muda (HUD do time). */
export function onSelectedSlotChanged(listener: (player: Player, slot: number) => void) {
  selectionListeners.add(listener);
}

function slotLine(pokemon: PokemonData | null, slot: number): RawMessage {
  if (!pokemon) return { text: `§7[${slot + 1}] —` };
  const hp = pokemon.currentHealth <= 0 ? "§c" : "§a";
  return { rawtext: [{ text: `§e▶ [${slot + 1}] §f` }, pokemon.getTranslatedName(), { text: ` §7Lv. ${pokemon.level} ${hp}${pokemon.currentHealth}/${pokemon.maxHealth}` }] };
}

/** Mostra a seleção na actionbar. */
export function showSelection(player: Player) {
  const team = getSafeTeam(player);
  const slot = getSelectedSlot(player);
  try { player.onScreenDisplay.setActionBar(slotLine(team[slot], slot)); } catch { }
}

/** Seleciona o próximo/anterior Pokémon do time. */
export function cycleSelection(player: Player, step: 1 | -1 = 1) {
  const team = getSafeTeam(player);
  setSelectedSlot(player, cycleSlot(team.map(p => !!p), getSelectedSlot(player), step));
  showSelection(player);
}

// ---------------------------------------------------------------------------------------------
// Envio rápido

/** Ações externas (injeção para não criar import circular com battle/trade). */
export interface QuickSendActions {
  inBattle(player: Player): boolean;
  /** Reabre a escolha da batalha em andamento (toggleBattleScreen). */
  reopenBattle(player: Player): void;
  startWildBattle(player: Player, wild: Entity): void;
  openPlayerMenu(player: Player, target: Player): void;
}

let actions: QuickSendActions | undefined;

export type QuickSendResult = "battle_menu" | "sent_out" | "recalled" | "wild_battle" | "player_menu" | "fainted" | "empty" | "none";

function isOwnPokemon(player: Player, entity: Entity): boolean {
  return entity.getDynamicProperty("owner_name") === player.name;
}

function canBattle(entity: Entity): boolean {
  try {
    return entity.getProperty("cobblemon:wild") === true && entity.getProperty("cobblemon:in_battle") !== true
      && entity.getDynamicProperty("in_battle") === undefined;
  }
  catch { return false; }
}

/**
 * PartySendBinding.onRelease + SendOutPokemonHandler.handle para o espaço `slot` (padrão: o selecionado).
 * `aimed` (frente controle): entidade já conhecida (o clique do item de controle nela), no lugar do raio da mira.
 */
export function quickSend(player: Player, slot = getSelectedSlot(player), aimed?: Entity): QuickSendResult {
  if (!actions) return "none";
  if (actions.inBattle(player)) {
    actions.reopenBattle(player);
    return "battle_menu";
  }
  const pokemon = getSafeTeam(player)[slot];
  if (!pokemon) return "empty";
  const config = getConfig();
  let target: Entity | undefined = aimed?.isValid ? aimed : undefined;
  if (!target) {
    try {
      target = player.getEntitiesFromViewDirection({ maxDistance: config.battleSpectateMaxDistance })
        .map(hit => hit.entity).find(entity => entity.isValid && entity.id !== player.id);
    }
    catch { target = undefined; }
  }

  const isPokemon = !!target?.getComponent("minecraft:type_family")?.hasTypeFamily("pokemon");
  // canSendOutPokemon: nada na mira ou o próprio Pokémon.
  if (!target || (isPokemon && isOwnPokemon(player, target))) {
    if (pokemon.currentHealth <= 0) return "fainted";
    const out = pokemon.tryGetPokemonOut();
    // Frente dados-ui: envio/recolha com a bola e o feixe (sendOutWithAnimation/recallWithAnimation).
    if (out) {
      void recallAnimated(player, pokemon);
      return "recalled";
    }
    void sendOutAnimated(player, pokemon);
    return "sent_out";
  }
  if (target instanceof Player) {
    actions.openPlayerMenu(player, target);
    return "player_menu";
  }
  if (isPokemon && canBattle(target)) {
    // Envio/recolha animada em andamento: a entidade ainda vai aparecer ou sumir; não começa batalha agora.
    if (isSendOutAnimating(pokemon.uuid)) return "none";
    const dx = target.location.x - player.location.x, dy = target.location.y - player.location.y, dz = target.location.z - player.location.z;
    if (dx * dx + dy * dy + dz * dz > config.battleWildMaxDistance ** 2) return "none";
    // BattleChallengePacket com o selecionado: o port põe na frente quem está em campo, então solta o selecionado antes.
    if (pokemon.currentHealth > 0 && !pokemon.tryGetPokemonOut()) pokemon.sendOut(player);
    const wild = target;
    system.runTimeout(() => { if (player.isValid && wild.isValid) actions?.startWildBattle(player, wild); }, 2);
    return "wild_battle";
  }
  return "none";
}

// ---------------------------------------------------------------------------------------------
// Entradas

const lastSneakPress = new Map<string, number>();

/** Liga as entradas (worldLoad). */
export function startPartySelection(quickSendActions: QuickSendActions) {
  if (actions) return;
  actions = quickSendActions;
  world.afterEvents.playerLeave.subscribe(({ playerId }) => lastSneakPress.delete(playerId));
  world.afterEvents.playerButtonInput.subscribe(({ player, button, newButtonState }) => {
    if (newButtonState !== ButtonState.Pressed) return;
    try {
      // Montado (a montaria usa agachar/pular) ou com um formulário aberto: nada.
      if (player.getComponent("minecraft:riding")?.entityRidingOn) return;
      if (button === InputButton.Jump && player.isSneaking) {
        const result = quickSend(player);
        if (result === "fainted") player.onScreenDisplay.setActionBar({ translate: "cobblemon.port.party.selected_fainted" });
        return;
      }
      if (button === InputButton.Sneak) {
        // Frente batalha-minimizavel: em batalha o overlay do time some (como no Java) e o duplo agachar não troca a
        // seleção (o Pokémon que entra é escolhido na tela da batalha).
        if (actions?.inBattle(player)) return;
        const now = system.currentTick;
        const last = lastSneakPress.get(player.id);
        if (last !== undefined && now - last <= DOUBLE_SNEAK_TICKS) {
          lastSneakPress.delete(player.id);
          cycleSelection(player, 1);
        }
        else lastSneakPress.set(player.id, now);
      }
    }
    catch (e) { console.warn(`Envio rápido: ${e}`); }
  });
}
