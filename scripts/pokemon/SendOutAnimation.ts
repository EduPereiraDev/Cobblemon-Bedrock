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
import { groundInFront, safeSendOutPosition, worldFor } from "./SendOutTarget";

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

/** Roda `fn` quando o envio/recolha animada do Pokémon termina (no máximo 3 s: a trava de `lock`). */
export function whenSendOutDone(uuid: string, fn: () => void) {
  if (!isSendOutAnimating(uuid)) { system.run(fn); return; }
  let ticks = 0;
  const id = system.runInterval(() => {
    if (!isSendOutAnimating(uuid) || ++ticks >= 60) { system.clearRun(id); fn(); }
  }, 1);
}

/**
 * Onde o Pokémon aparece: raycastSafeSendout do Java (scripts/pokemon/SendOutTarget.ts). Sem lugar seguro na mira,
 * undefined (o Java não manda; nunca no pé do jogador).
 */
export function sendOutLocation(player: Player, pokemon: PokemonData, nearPlayer = false): DimensionLocation | undefined {
  try {
    const form = pokemon.getFormData();
    const species = pokemon.getSpeciesData();
    const hitbox = form?.hitbox ?? species.hitbox;
    const scale = form?.baseScale ?? species.baseScale ?? 1;
    const world = worldFor(player);
    const eye = player.getHeadLocation(), dir = player.getViewDirection();
    let at = safeSendOutPosition(world, eye, dir, { width: hitbox?.width ?? 1, height: hitbox?.height ?? 1, scale });
    // Menu do time (sem mira): o chão à frente; sem chão nenhum, junto ao jogador.
    if (!at && nearPlayer) at = groundInFront(world, eye, dir) ?? { ...player.location };
    return at ? { ...at, dimension: player.dimension } : undefined;
  }
  catch { return undefined; }
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
/**
 * `fromMenu`: envio pelo menu do time (adaptação do port; o Java só manda pela mira). Sem lugar seguro na mira, vai
 * para o chão à frente em vez de não sair. O envio rápido (tecla R / Poké Ball do time) segue a regra estrita.
 */
export function sendOutAnimated(player: Player, pokemon: PokemonData, fromMenu = false): Promise<void> {
  if (sending.has(pokemon.uuid) || recalling.has(pokemon.uuid)) return Promise.resolve();
  if (pokemon.tryGetPokemonOut()) return Promise.resolve();
  const location = sendOutLocation(player, pokemon, fromMenu);
  if (!location) {
    // SendOutPokemonHandler: sem posição segura na mira, nada acontece. Aqui avisa (o menu não mostra a mira).
    try { player.onScreenDisplay.setActionBar({ translate: "cobblemon.port.sendout.no_space" }); } catch { }
    return Promise.resolve();
  }
  lock(sending, pokemon.uuid);
  try {
    const job = animatedSendOut({
      thrower: player, owner: player, pokemon, location, mode: "casual",
      stillValid: () => player.isValid && !pokemon.tryGetPokemonOut(),
      onDone: () => sending.delete(pokemon.uuid),
    });
    return waitFor(() => !!job.entity || !!job.cancelled || job.done);
  }
  catch (e) {
    sending.delete(pokemon.uuid);
    console.warn(`Envio animado falhou: ${e}`);
    pokemon.sendOut(player, location);
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
