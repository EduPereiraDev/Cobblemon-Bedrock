/**
 * Componentes da frente "pesca". `FISHING_ITEM_COMPONENTS` é juntado aos componentes de item em
 * scripts/custom_components/index.ts; o componente de bloco do Poké Snack se registra aqui mesmo no startup
 * (o index só junta componentes de item desta frente). O importador (tools/importer/blocks.ts) lê as chaves
 * `"cobblemon:..."` deste arquivo para saber quais componentes pôr nos JSONs de item/bloco.
 */
import { ItemCustomComponent, Player, system, world } from "@minecraft/server";
import { bindFishingCleanup, useRod } from "./FishingController";
import { PokeSnackComponent } from "./PokeSnack";

/** Último tick em que cada jogador usou a vara (onUse e onUseOn podem vir juntos no mesmo clique). */
const lastUse = new Map<string, number>();
const USE_DEBOUNCE_TICKS = 4;

function handleUse(player: Player | undefined) {
  if (!player) return;
  const now = system.currentTick;
  const last = lastUse.get(player.id);
  if (last !== undefined && now - last < USE_DEBOUNCE_TICKS) return;
  lastUse.set(player.id, now);
  // Fora do callback do componente (modo restrito em algumas versões).
  system.run(() => {
    try { useRod(player); }
    catch (e) { console.warn(`[pesca] erro ao usar a Poké Rod: ${e}`); }
  });
}

/** Poké Rod: arremessar/recolher, isca (agachar + usar abre o menu). */
const PokeRodComponent: ItemCustomComponent = {
  onUse: ({ source }) => handleUse(source),
  onUseOn: ({ source }) => { if (source?.typeId === "minecraft:player") handleUse(source as Player); },
};

export const FISHING_ITEM_COMPONENTS: Record<string, ItemCustomComponent> = {
  "cobblemon:poke_rod": PokeRodComponent,
};

/** Componentes de bloco desta frente (registrados abaixo). */
const FISHING_BLOCK_COMPONENTS = {
  "cobblemon:poke_snack": PokeSnackComponent,
};

system.beforeEvents.startup.subscribe(event => {
  for (const [id, component] of Object.entries(FISHING_BLOCK_COMPONENTS)) {
    try { event.blockComponentRegistry.registerCustomComponent(id, component); }
    catch (e) { console.warn(`[pesca] componente ${id} já registrado: ${e}`); }
  }
});

world.afterEvents.worldLoad.subscribe(() => bindFishingCleanup());
