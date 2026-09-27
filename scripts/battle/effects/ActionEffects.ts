import { Entity, MolangVariableMap, system, Vector3 } from "@minecraft/server";
import { ACTION_EFFECTS, ActionKeyframe, EFFECT_PARTICLES, EntityCond, GENERIC_ANIMATIONS, LOCATORS, StrExpr } from "../../../generated/scripts/actionEffects";
import { ENTITY_INFO } from "../../../generated/scripts/entityData";
import { POSER_ANIMATIONS, VARIANTS } from "../../../generated/scripts/variants";

/**
 * Intérprete das timelines de `data/cobblemon/action_effects` (efeitos de golpe/status em batalha).
 *
 * O importador (tools/importer/actionEffects.ts) já traduziu o Molang das timelines para dados estruturados; aqui
 * só se agenda cada passo com `system.runTimeout` no tempo certo: animação do poser (primeira que a espécie tem,
 * na ordem da lista), partícula num locator do modelo (com as variáveis v.entity_* e v.target_* do ParticleStorm),
 * som e animações genéricas de golpe (osso root_part). As "holds" do Cobblemon (a fila de mensagens espera o
 * efeito acertar) viram o tempo devolvido por `runActionEffect`, que o chamador usa como espera do dispatcher.
 *
 * Limites conhecidos: a partícula nasce no ponto do locator calculado pela pose de repouso (não segue o osso
 * animado) e em espaço do mundo (sem a rotação do emissor); `cobblemon:emitter_space` (escala pelo tamanho) não
 * existe no Bedrock; `move_to_target`/`do_effect_walks` (caminhar até o alvo) não é portado.
 */

export interface EffectMove {
  /** Id do Showdown (ex.: "thunderbolt"). */
  name: string;
  /** Tipo em minúsculas (ex.: "electric"). */
  type: string;
  /** "physical" | "special" | "status". */
  category: string;
}

export interface EffectActor {
  entity: Entity | undefined;
  /** Id da espécie (sem namespace). */
  species: string;
  isUser: boolean;
  missed?: boolean;
  hurt?: boolean;
  failed?: boolean;
}

export interface EffectContext {
  move?: EffectMove;
  actors: EffectActor[];
}

/** Tempo máximo que uma timeline pode segurar a fila da batalha (segundos). */
export const MAX_HOLD_SECONDS = 4;

const particleSet = new Set(EFFECT_PARTICLES);

/** Timeline para um id, com a variação por espécie do Cobblemon (`<id>_<espécie>`) na frente. */
export function findTimeline(id: string, species?: string): ActionKeyframe[] | undefined {
  return (species ? ACTION_EFFECTS[`${id}_${species}`] : undefined) ?? ACTION_EFFECTS[id];
}

function resolveStr(parts: StrExpr, move: EffectMove | undefined): string | undefined {
  let out = "";
  for (const p of parts) {
    if (p === "$move.name") out += move?.name ?? "";
    else if (p === "$move.type") out += move?.type ?? "";
    else if (p === "$move.category") out += move?.category ?? "";
    else out += p;
  }
  return out || undefined;
}

function matches(who: EntityCond, actor: EffectActor): boolean {
  if (who.user !== undefined && who.user !== actor.isUser) return false;
  if (who.missed !== undefined && who.missed !== !!actor.missed) return false;
  if (who.hurt !== undefined && who.hurt !== !!actor.hurt) return false;
  if (who.failed !== undefined && who.failed !== !!actor.failed) return false;
  if (who.onGround !== undefined) {
    let onGround = true;
    try { onGround = !!actor.entity?.isOnGround; } catch { }
    if (who.onGround !== onGround) return false;
  }
  return true;
}

function valid(e: Entity | undefined): e is Entity {
  try { return !!e?.isValid; } catch { return false; }
}

// ------------------------------------------------------------------ animações do poser

function variantOf(entity: Entity): number {
  try {
    const v = entity.getProperty("cobblemon:variant");
    return typeof v === "number" ? v : 0;
  } catch {
    return 0;
  }
}

/** Animações nomeadas do poser da combinação atual da entidade (cai na espécie). */
export function namedAnimationsOf(entity: Entity | undefined, species: string): Record<string, string> | undefined {
  const combos = VARIANTS[species]?.combos;
  const poser = combos?.[entity && valid(entity) ? variantOf(entity) : 0]?.poser ?? combos?.[0]?.poser;
  const key = poser ? poser.replace(/^[a-z0-9_]+:/, "") : species;
  return POSER_ANIMATIONS[key] ?? POSER_ANIMATIONS[species];
}

/** Primeira animação existente da lista (a versão battle_<nome> vence em batalha, como as poses isBattle). */
export function pickAnimation(named: Record<string, string> | undefined, names: string[], inBattle = true): string | undefined {
  if (!named) return undefined;
  for (const n of names) {
    const id = (inBattle ? named[`battle_${n}`] : undefined) ?? named[n];
    if (id) return id;
  }
  return undefined;
}

function playAnimation(entity: Entity, id: string, controller?: string) {
  try {
    entity.playAnimation(id, controller ? { controller } : undefined);
  } catch { }
}

// ------------------------------------------------------------------ locators e partículas

function scaleOf(entity: Entity, species: string): number {
  let mod = 1;
  try {
    const v = entity.getProperty("cobblemon:scale_modifier");
    if (typeof v === "number" && v > 0) mod = v;
  } catch { }
  return (ENTITY_INFO[species]?.sizes?.[0]?.scale ?? 1) * mod;
}

/**
 * Posição no mundo do primeiro locator existente da lista ("root" = pés da entidade). O offset do .geo está em
 * pixels no espaço do modelo (frente = −z); gira pelo yaw do corpo e escala pelo tamanho da entidade.
 */
export function locatorPosition(entity: Entity, species: string, names: string[]): Vector3 {
  const base = entity.location;
  const locs = LOCATORS[species] ?? {};
  const name = names.find((n) => n === "root" || locs[n]);
  const scale = scaleOf(entity, species);
  if (!name) {
    // Modelo sem nenhum dos locators: meio da caixa de colisão.
    const h = (ENTITY_INFO[species]?.sizes?.[0]?.height ?? 1) * scale;
    return { x: base.x, y: base.y + h / 2, z: base.z };
  }
  if (name === "root") return base;
  const p = locs[name];
  const lx = (-p[0] / 16) * scale;
  const ly = (p[1] / 16) * scale;
  const lz = (-p[2] / 16) * scale;
  let yaw = 0;
  try { yaw = (entity.getRotation().y * Math.PI) / 180; } catch { }
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return { x: base.x + lx * cos - lz * sin, y: base.y + ly, z: base.z + lx * sin + lz * cos };
}

/** Variáveis que o ParticleStorm do Cobblemon define (v.entity_*; v.target_* quando há alvo). */
export function particleVariables(entity: Entity, species: string, from?: Vector3, to?: Vector3): MolangVariableMap {
  const vars = new MolangVariableMap();
  const size = ENTITY_INFO[species]?.sizes?.[0];
  const scale = scaleOf(entity, species);
  const w = (size?.width ?? 1) * scale;
  const h = (size?.height ?? 1) * scale;
  const big = Math.max(w, h);
  vars.setFloat("variable.entity_width", w);
  vars.setFloat("variable.entity_height", h);
  vars.setFloat("variable.entity_size", big);
  vars.setFloat("variable.entity_radius", big / 2);
  vars.setFloat("variable.entity_scale", scale);
  if (from && to) {
    // ParticleStorm: fonte − destino no espaço da partícula, com Y invertido.
    vars.setFloat("variable.target_deltax", from.x - to.x);
    vars.setFloat("variable.target_deltay", to.y - from.y);
    vars.setFloat("variable.target_deltaz", from.z - to.z);
    vars.setFloat("variable.target_distance", Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z));
  }
  return vars;
}

function spawnParticle(effect: string, actor: EffectActor, loc: string[], target?: EffectActor, targetLoc?: string[]) {
  if (!particleSet.has(effect) || !valid(actor.entity)) return;
  try {
    const from = locatorPosition(actor.entity, actor.species, loc);
    const to = target && valid(target.entity) ? locatorPosition(target.entity, target.species, targetLoc ?? ["target"]) : undefined;
    actor.entity.dimension.spawnParticle(effect, from, particleVariables(actor.entity, actor.species, from, to));
  } catch { }
}

function playSound(sound: string, actor: EffectActor) {
  if (!valid(actor.entity)) return;
  try { actor.entity.dimension.playSound(sound, actor.entity.location); } catch { }
}

// ------------------------------------------------------------------ agendamento

interface Plan {
  /** Passos com o instante (segundos desde o início). */
  steps: Array<{ at: number; run: () => void }>;
  /** Instante em que as holds esvaziaram (undefined = nenhuma hold). */
  release?: number;
  end: number;
}

function plan(kfs: ActionKeyframe[], ctx: EffectContext, out: Plan, holds: Set<string>, start: number): number {
  let t = start;
  const at = (fn: () => void) => out.steps.push({ at: t, run: fn });
  for (const k of kfs) {
    switch (k.t) {
      case "pause":
        t += k.s;
        break;
      case "holds":
        for (const h of k.add ?? []) holds.add(h);
        for (const h of k.remove ?? []) holds.delete(h);
        if (k.remove?.length && holds.size === 0 && out.release === undefined) out.release = t;
        break;
      case "anim": {
        const names = k.names.map((n) => resolveStr(n, ctx.move)).filter((n): n is string => !!n);
        for (const a of ctx.actors.filter((x) => matches(k.who, x))) {
          const id = pickAnimation(namedAnimationsOf(a.entity, a.species), names);
          if (id && a.entity) at(() => valid(a.entity) && playAnimation(a.entity, id));
        }
        t += k.delay;
        break;
      }
      case "particles": {
        const effect = resolveStr(k.effect, ctx.move);
        const target = ctx.actors.find((x) => !x.isUser);
        if (effect) for (const a of ctx.actors.filter((x) => matches(k.who, x))) {
          at(() => spawnParticle(effect, a, k.loc, k.target ? target : undefined, k.target));
        }
        t += k.delay;
        break;
      }
      case "sound": {
        const sound = resolveStr(k.sound, ctx.move);
        // "cobblemon:impact.<tipo>" chega como "cobblemon.impact.<tipo>" (o importador troca o namespace).
        const id = sound?.replace(/^cobblemon:/, "cobblemon.");
        if (id) for (const a of ctx.actors.filter((x) => matches(k.who, x))) at(() => playSound(id, a));
        t += k.delay;
        break;
      }
      case "entity": {
        for (const a of ctx.actors.filter((x) => matches(k.who, x))) {
          for (const s of k.sounds) {
            const id = resolveStr(s, ctx.move);
            if (id) at(() => playSound(id, a));
          }
          for (const g of k.play) {
            const id = GENERIC_ANIMATIONS[g];
            if (id && a.entity) at(() => valid(a.entity) && playAnimation(a.entity, id, "cobblemon.action_effect"));
          }
          for (const p of k.particles) at(() => spawnParticle(p.effect, a, [p.loc]));
        }
        t += k.delay;
        break;
      }
      case "seq":
        if (k.cond === "not_status" && ctx.move?.category === "status") break;
        t = plan(k.kfs, ctx, out, holds, t);
        break;
    }
  }
  return t;
}

/**
 * Toca a timeline `id` e devolve os segundos até as holds do Cobblemon serem liberadas (o tempo que a fila de
 * mensagens da batalha deve esperar). 0 = timeline inexistente ou sem hold.
 */
export function runActionEffect(id: string, ctx: EffectContext, species?: string): number {
  const timeline = findTimeline(id, species);
  if (!timeline) return 0;
  const p: Plan = { steps: [], end: 0 };
  p.end = plan(timeline, ctx, p, new Set(), 0);
  for (const step of p.steps) {
    const ticks = Math.round(step.at * 20);
    const run = () => {
      try { step.run(); } catch { }
    };
    if (ticks <= 0) run();
    else system.runTimeout(run, ticks);
  }
  return Math.min(MAX_HOLD_SECONDS, p.release ?? 0);
}

/** Resumo do que uma timeline faria (para testes e depuração), sem tocar nada. */
export function planActionEffect(id: string, ctx: EffectContext, species?: string): { steps: number[]; release?: number; end: number } | undefined {
  const timeline = findTimeline(id, species);
  if (!timeline) return undefined;
  const p: Plan = { steps: [], end: 0 };
  p.end = plan(timeline, ctx, p, new Set(), 0);
  return { steps: p.steps.map((s) => s.at), release: p.release, end: p.end };
}
