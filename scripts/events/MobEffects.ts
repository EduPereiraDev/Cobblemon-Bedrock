/**
 * Efeitos de status do Cobblemon 1.8.2 (`CobblemonMobEffects.kt`, `api/cooking/effects/*`) usados pelos temperos
 * (`data/cobblemon/seasonings`): White Herb → `cobblemon:cleanse_negative`, leite/Moomoo Milk → `cobblemon:cleanse_all`,
 * Mental Herb → `cobblemon:mental_restoration`.
 *
 * O Bedrock não aceita efeito de status de add-on (sem ícone, sem registro), então os três viram ação por script:
 * - cleanse_negative: remove os efeitos da categoria HARMFUL a cada tick da duração (é "instantâneo" com duração 1);
 * - cleanse_all: remove todos os efeitos (removeAllEffects) pela duração;
 * - mental_restoration: no Java baixa o TIME_SINCE_REST (insônia dos phantoms) em 31 × (nível + 1) por tick. O
 *   Bedrock não expõe esse contador a scripts: NÃO POSSÍVEL NO BEDROCK (o efeito é aceito e não faz nada).
 */
import { Entity, system } from "@minecraft/server";

/** MobEffectCategory.HARMFUL do vanilla, com os ids do Bedrock (fatal_poison só existe no Bedrock). */
export const HARMFUL_EFFECTS: ReadonlySet<string> = new Set([
  "slowness", "mining_fatigue", "instant_damage", "nausea", "blindness", "hunger", "weakness", "poison", "fatal_poison",
  "wither", "levitation", "darkness", "wind_charged", "weaving", "oozing", "infested",
]);

export interface CobblemonEffectInstance {
  /** "cobblemon:cleanse_negative" etc. (ou qualquer outro id, que não é tratado aqui). */
  effect: string;
  /** Duração em ticks. */
  duration?: number;
  amplifier?: number;
}

const COBBLEMON_EFFECTS = new Set(["cleanse_negative", "cleanse_all", "mental_restoration"]);

/** Id sem namespace. */
function bare(id: string): string {
  return id.replace(/^[a-z0-9_.-]+:/, "");
}

/** É um dos três efeitos do Cobblemon? */
export function isCobblemonMobEffect(id: string): boolean {
  return id.startsWith("cobblemon:") && COBBLEMON_EFFECTS.has(bare(id));
}

/** Efeitos a remover de uma lista de ids ativos (função pura, testada). */
export function effectsToCleanse(kind: "cleanse_negative" | "cleanse_all", active: readonly string[]): string[] {
  return kind === "cleanse_all" ? [...active] : active.filter(id => HARMFUL_EFFECTS.has(bare(id)));
}

function cleanseOnce(entity: Entity, kind: "cleanse_negative" | "cleanse_all") {
  if (!entity.isValid) return;
  let active: string[] = [];
  try { active = entity.getEffects().map(effect => effect.typeId); } catch { return; }
  for (const id of effectsToCleanse(kind, active)) {
    try { entity.removeEffect(id); } catch { }
  }
}

/**
 * Aplica um efeito do Cobblemon. Devolve true se o id era de um deles (tratado aqui, mesmo sem efeito no Bedrock);
 * false para os demais, que quem chama aplica com `addEffect`.
 */
export function applyCobblemonMobEffect(entity: Entity, instance: CobblemonEffectInstance): boolean {
  if (!isCobblemonMobEffect(instance.effect)) return false;
  const kind = bare(instance.effect);
  if (kind === "mental_restoration") return true;
  const cleanse = kind as "cleanse_negative" | "cleanse_all";
  // applyInstantenousEffect/applyEffectTick: uma vez agora e em cada tick que sobrar da duração.
  cleanseOnce(entity, cleanse);
  const ticks = Math.max(1, Math.trunc(instance.duration ?? 1));
  if (ticks > 1) {
    let left = ticks - 1;
    const id = system.runInterval(() => {
      cleanseOnce(entity, cleanse);
      if (--left <= 0 || !entity.isValid) system.clearRun(id);
    }, 1);
  }
  return true;
}
