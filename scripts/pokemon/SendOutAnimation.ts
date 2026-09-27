/**
 * Envio e recolha fora de batalha com a animação do Cobblemon 1.8.2 (Pokemon.sendOutWithAnimation /
 * recallWithAnimation, modo "casual"): bola arremessada em arco, estouro com as partículas da bola e o Pokémon
 * crescendo; recolha com o feixe vermelho até a mão. A animação é a da frente visual-batalha
 * (`scripts/battle/SendOut.ts`); aqui ficam só os pontos de uso do jogador (menu do time, envio rápido).
 */
import { DimensionLocation, Player, system } from "@minecraft/server";
import type { PokemonData } from "../Pokemon";
import { animatedRecall, animatedSendOut } from "../battle/SendOut";
import { SCALE_PROPERTY } from "./Scale";
import { setBeamTint } from "./BeamTint";

/** Pokémon com envio/recolha animada em andamento (um clique duplo não repete). */
const sending = new Set<string>();
const recalling = new Set<string>();
/** Trava liberada no máximo em 3 s (segurança se o onDone não vier). */
function lock(set: Set<string>, uuid: string) {
  set.add(uuid);
  system.runTimeout(() => set.delete(uuid), 60);
}

export function isSendOutAnimating(uuid: string): boolean {
  return sending.has(uuid) || recalling.has(uuid);
}

/** Onde o Pokémon aparece (mesma regra de PokemonData.sendOut sem local: bloco olhado até 10 com 2 de ar, senão o jogador). */
export function sendOutLocation(player: Player): DimensionLocation {
  try {
    const block = player.getBlockFromViewDirection({ maxDistance: 10 })?.block;
    if (block && block.above(1)?.isAir && block.above(2)?.isAir)
      return { x: block.x + 0.5, y: block.y + 1, z: block.z + 0.5, dimension: player.dimension };
  }
  catch { }
  return { ...player.location, dimension: player.dimension };
}

/** Resolve quando `ready()` fica verdadeiro (ou em `maxTicks`). */
function waitFor(ready: () => boolean, maxTicks = 40): Promise<void> {
  return new Promise(resolve => {
    if (ready()) { resolve(); return; }
    let ticks = 0;
    const id = system.runInterval(() => {
      if (ready() || ++ticks >= maxTicks) { system.clearRun(id); resolve(); }
    }, 1);
  });
}

/**
 * Manda para fora com a bola (casual). A promessa resolve quando o Pokémon aparece (a tela do time reabre já com o
 * marcador de "fora").
 */
export function sendOutAnimated(player: Player, pokemon: PokemonData): Promise<void> {
  if (sending.has(pokemon.uuid) || recalling.has(pokemon.uuid)) return Promise.resolve();
  if (pokemon.tryGetPokemonOut()) return Promise.resolve();
  lock(sending, pokemon.uuid);
  try {
    const job = animatedSendOut({
      thrower: player, owner: player, pokemon, location: sendOutLocation(player), mode: "casual",
      stillValid: () => player.isValid && !pokemon.tryGetPokemonOut(),
      onDone: () => sending.delete(pokemon.uuid),
    });
    return waitFor(() => !!job.entity || !!job.cancelled || job.done);
  }
  catch (e) {
    sending.delete(pokemon.uuid);
    console.warn(`Envio animado falhou: ${e}`);
    pokemon.sendOut(player);
    return Promise.resolve();
  }
}

/** Recolhe com o feixe; no fim do encolhimento o `return()` tira a entidade (a tag do UUID sai antes do instant_kill). */
export function recallAnimated(player: Player, pokemon: PokemonData): Promise<void> {
  const entity = pokemon.tryGetPokemonOut();
  if (!entity) return Promise.resolve();
  // Recolher logo depois de mandar (o envio ainda "termina" por 1 s) é permitido; só não repete a recolha.
  if (recalling.has(pokemon.uuid)) return Promise.resolve();
  lock(recalling, pokemon.uuid);
  sending.delete(pokemon.uuid);
  try {
    let removed = false;
    // beamMode 3: tinta vermelha no cliente enquanto encolhe (o feixe e o encolhimento vêm do animatedRecall).
    setBeamTint(entity, true);
    const job = animatedRecall(entity, undefined, player, () => {
      try {
        // Entrou em batalha durante a recolha: não tira de campo (sumiria no meio da luta); só desfaz o encolhimento.
        if (entity.isValid && entity.getDynamicProperty("in_battle") !== undefined) {
          try { entity.setProperty(SCALE_PROPERTY, pokemon.getEffectiveScale()); } catch { }
          setBeamTint(entity, false);
        }
        else pokemon.return(player);
      }
      finally { removed = true; recalling.delete(pokemon.uuid); }
    });
    // A entidade some no tick seguinte ao instant_kill: espera mais um tick para a tela do time reabrir sem o "●".
    return waitFor(() => removed || job.removed).then(() => waitFor(() => false, 1));
  }
  catch (e) {
    recalling.delete(pokemon.uuid);
    setBeamTint(entity, false);
    console.warn(`Recolha animada falhou: ${e}`);
    pokemon.return(player);
    return Promise.resolve();
  }
}
