/**
 * Sequência de evolução (Cobblemon 1.8.2: Evolution.forceEvolve + `bedrock/generic/animations/evolution.animation.json`).
 *
 * No Cobblemon, com o Pokémon fora da bola: ele para (EVOLUTION_STARTED), em 1 s começa a animação
 * `evolution` (partículas `cobblemon:evo_*` e o som `evolution.full`), em 11,2 s a espécie muda
 * (evolutionMethod), em 12 s ele dá o grito e o dono recebe `cobblemon.ui.evolve.into`. Sem entidade (na bola,
 * ou no ombro, que é recolhido antes): som `evolution.ui` e a mensagem na hora.
 *
 * No port os dados mudam na hora (quem chama forceEvolve usa o resultado: troca, doces, pedras); só o modelo
 * espera: a entidade guarda os dados novos e é trocada no fim da sequência. As partículas são as `evo_*` do
 * Cobblemon (o emissor `cobblemon:evo_particles` em 1 s faz a linha do tempo inteira).
 */
import { Entity, MolangVariableMap, Player, RawMessage, system } from "@minecraft/server";
import type { PokemonData } from "../Pokemon";
import { message } from "../language";

/** Linha do tempo em segundos (Evolution.forceEvolve). */
export const EVOLUTION_TIMELINE = { start: 1, evolve: 11.2, cry: 12 } as const;

export const EVOLUTION_SOUNDS = {
  /** Toca com a animação (sound_effects de evolution.animation.json). */
  full: "cobblemon.evolution.full",
  /** Evolução sem entidade em campo. */
  ui: "cobblemon.evolution.ui",
  /** Evolução pronta (aviso ao dono). */
  notification: "cobblemon.evolution.notification",
} as const;

/**
 * Partícula da animação `evolution` do Cobblemon (`generic/animations/evolution.animation.json`, locator `middle` no
 * tempo 0): o emissor `cobblemon:evo_particles` dispara sozinho a linha do tempo inteira (sparkle, buildup em 2 s,
 * obscuring/godrays em 5 s, flying/big sparkle, implode em 9,58 s e as rajadas em 10 s). Copiado para o RP pelo
 * importador (`evo_*`).
 */
export const EVOLUTION_PARTICLE = "cobblemon:evo_particles";

/** Tamanho do Pokémon para as expressões `v.entity_size`/`v.entity_radius`/`v.entity_scale` das partículas. */
function evolutionMolang(height: number): MolangVariableMap | undefined {
  try {
    const vars = new MolangVariableMap();
    vars.setFloat("variable.entity_size", Math.max(0.1, height));
    vars.setFloat("variable.entity_radius", Math.max(0.1, height / 2));
    vars.setFloat("variable.entity_scale", 1);
    return vars;
  }
  catch { return undefined; }
}

/** Fase da sequência num dado tick (para testes e para o laço de partículas). */
export type EvolutionPhase = "wait" | "buildup" | "glow" | "swap" | "cry" | "done";

export function evolutionPhaseAt(tick: number): EvolutionPhase {
  const seconds = tick / 20;
  if (seconds < EVOLUTION_TIMELINE.start) return "wait";
  // `q.evo_glow_time` começa em 5,25 s (timeline da animação): brilho até a troca.
  if (seconds < EVOLUTION_TIMELINE.start + 5.25) return "buildup";
  if (seconds < EVOLUTION_TIMELINE.evolve) return "glow";
  if (seconds < EVOLUTION_TIMELINE.cry) return "swap";
  if (seconds < EVOLUTION_TIMELINE.cry + 0.05) return "cry";
  return "done";
}

/** Duração total em ticks. */
export const EVOLUTION_TOTAL_TICKS = Math.ceil(EVOLUTION_TIMELINE.cry * 20) + 1;

interface RunningSequence {
  runId: number;
  entityId: string;
}

const running = new Map<string, RunningSequence>();

/** A sequência deste Pokémon (uuid) está em andamento. */
export function isEvolving(uuid: string): boolean {
  return running.has(uuid);
}

/** Mensagem `ui.evolve.into` ao dono (fim da sequência ou evolução sem entidade). */
function evolvedMessage(preEvoName: RawMessage, pokemon: PokemonData): RawMessage {
  return message.With("cobblemon.ui.evolve.into", [preEvoName, { translate: `cobblemon.species.${pokemon.species}.name` }]);
}

/** Evolução sem entidade em campo: som de interface e a mensagem na hora. */
export function announceEvolution(owner: Player | undefined, preEvoName: RawMessage, pokemon: PokemonData) {
  if (!owner?.isValid) return;
  try { owner.playSound(EVOLUTION_SOUNDS.ui); } catch { }
  owner.sendMessage(evolvedMessage(preEvoName, pokemon));
}

/** Centro do Pokémon ("middle" do Cobblemon): metade da altura (hitbox × escala base). */
function center(entity: Entity, height: number) {
  const { x, y, z } = entity.location;
  return { x, y: y + Math.max(0.4, height * 0.5), z };
}

/** Solta o emissor da evolução no centro do Pokémon (uma vez; ele cuida dos 12 s de efeitos). */
function spawnEvolutionParticle(entity: Entity, height: number) {
  const c = center(entity, height);
  // O emissor tem offset [0, 1, 0]: desconta para ficar no centro.
  try { entity.dimension.spawnParticle(EVOLUTION_PARTICLE, { x: c.x, y: c.y - 1, z: c.z }, evolutionMolang(height)); }
  catch { /* partícula ausente no RP */ }
}

/** Acha a entidade atual do Pokémon (pode ter sido trocada/recolhida no meio da sequência). */
function findEntity(uuid: string, lookup: (uuid: string) => Entity | undefined): Entity | undefined {
  try {
    const entity = lookup(uuid);
    return entity?.isValid ? entity : undefined;
  }
  catch {
    return undefined;
  }
}

export interface EvolutionSequenceHooks {
  /** Acha a entidade pelo uuid (PokemonData.tryGetPokemonOut). */
  lookup: (uuid: string) => Entity | undefined;
  /** Troca o modelo no fim: relê os dados da entidade e aplica (PokemonData.applyToCobblemon). */
  swap: (entity: Entity) => Entity | undefined;
  /** Grito da espécie nova (battle/Animations.playCry). */
  cry: (entity: Entity) => void;
}

/**
 * Começa a sequência numa entidade (os dados novos já estão nela). Um Pokémon que evolui de novo no meio
 * (evolução em cadeia) reinicia a sequência. Roda por system.runInterval (um passo leve por tick).
 */
export function startEvolutionSequence(entity: Entity, pokemon: PokemonData, preEvoName: RawMessage, owner: Player | undefined, hooks: EvolutionSequenceHooks) {
  const uuid = pokemon.uuid;
  const previous = running.get(uuid);
  if (previous) system.clearRun(previous.runId);
  const species = pokemon.species;
  let height = 1;
  try { height = pokemon.getHitbox().height * pokemon.getBaseScale(); } catch { }
  try { entity.setProperty("cobblemon:busy", true); } catch { }
  try { entity.addEffect("slowness", EVOLUTION_TOTAL_TICKS, { amplifier: 255, showParticles: false }); } catch { }
  let tick = 0;
  let swapped = false;
  let ref: Entity | undefined = entity;
  const finish = (current: Entity | undefined) => {
    const state = running.get(uuid);
    if (state) system.clearRun(state.runId);
    running.delete(uuid);
    try { current?.setProperty("cobblemon:busy", false); } catch { }
    if (owner?.isValid) {
      const text = evolvedMessage(preEvoName, pokemon);
      owner.sendMessage(text);
      try { owner.onScreenDisplay.setTitle({ translate: `cobblemon.species.${species}.name` }, { subtitle: text, fadeInDuration: 5, stayDuration: 50, fadeOutDuration: 10 }); } catch { }
    }
  };
  const runId = system.runInterval(() => {
    tick++;
    // A referência vale enquanto a entidade existir; se sumiu (troca por outro código), procura pelo uuid.
    let current = ref?.isValid ? ref : findEntity(uuid, hooks.lookup);
    ref = current;
    if (!current) {
      // Recolhido ou descarregado: a evolução (dados) já aconteceu; só avisa.
      finish(undefined);
      return;
    }
    const phase = evolutionPhaseAt(tick);
    if (tick === Math.round(EVOLUTION_TIMELINE.start * 20)) {
      try { current.dimension.playSound(EVOLUTION_SOUNDS.full, current.location); } catch { }
      spawnEvolutionParticle(current, height);
      if (owner?.isValid) {
        try { owner.onScreenDisplay.setActionBar(message.With("cobblemon.port.evolution.evolving", [preEvoName])); } catch { }
      }
    }
    if (phase === "swap" && !swapped) {
      swapped = true;
      const next = hooks.swap(current);
      if (next?.isValid) {
        current = next;
        ref = next;
        try { next.setProperty("cobblemon:busy", true); } catch { }
      }
    }
    if (phase === "cry" || phase === "done") {
      try { hooks.cry(current); } catch { }
      finish(current);
    }
  }, 1);
  running.set(uuid, { runId, entityId: entity.id });
}
