/**
 * Lógica pura da pesca do Cobblemon 1.8.2 (entity/fishing/PokeRodFishingBobberEntity.kt): fórmulas de espera,
 * fisgada e janela de reação, sorteio Pokémon × item, tabela de loot da Poké Rod, física da boia e dano da vara.
 * Sem acesso ao mundo: FishingController.ts liga isto às entidades.
 */
import { alterBiteTime, BaitEffect, pokemonSpawnChance } from "./BaitEffects";

/** Mth.nextInt(random, min, max): inteiro em [min, max] (inclusivo). */
export function nextInt(min: number, max: number, random: () => number = Math.random): number {
  if (min >= max) return min;
  return min + Math.floor(random() * (max - min + 1));
}

/** Mth.nextFloat(random, min, max). */
export function nextFloat(min: number, max: number, random: () => number = Math.random): number {
  return min + random() * (max - min);
}

/** RandomSource.triangle(mode, deviation). */
export function triangle(mode: number, deviation: number, random: () => number = Math.random): number {
  return mode + deviation * (random() - random());
}

/**
 * calculateMinMaxCountdown: janela (ticks) para puxar depois da fisgada, pelo peso do bucket sorteado
 * (fishingBuckets). Buckets raros dão janelas menores (15–20), comuns maiores (até 20–40).
 */
export function calculateMinMaxCountdown(weight: number): [number, number] {
  const minAtMaxWeight = 20, maxAtMaxWeight = 40, minAtMinWeight = 15, maxAtMinWeight = 20;
  const minFactor = ((minAtMaxWeight - minAtMinWeight) / 100) * weight + minAtMinWeight;
  const maxFactor = ((maxAtMaxWeight - maxAtMinWeight) / 100) * weight + maxAtMinWeight;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return [clamp(Math.trunc(minFactor), minAtMinWeight, minAtMaxWeight), clamp(Math.trunc(maxFactor), maxAtMinWeight, maxAtMaxWeight)];
}

/** Espera inicial (ticks) até o peixe aparecer: nextInt(100, 600), reduzida por isca bite_time. */
export function rollWaitCountdown(effects: readonly BaitEffect[], random: () => number = Math.random): number {
  const wait = nextInt(100, 600, random);
  if (wait <= 0) return 1;
  return alterBiteTime(wait, effects, random);
}

/** Mth.nextInt(0, 100) < chance: Pokémon (true) ou item (false). Com 85 → 85/101 ≈ 84,2%. */
export function rollPokemonCatch(effects: readonly BaitEffect[], random: () => number = Math.random): boolean {
  const chance = pokemonSpawnChance(effects, random);
  return nextInt(0, 100, random) < chance;
}

/** Probabilidade exata de rollPokemonCatch para uma chance (em 100). */
export function pokemonCatchProbability(chance: number): number {
  return Math.min(101, Math.max(0, chance)) / 101;
}

// ---------------------------------------------------------------------------------------------
// Laço da boia na água (tickFishingLogic)

export type CatchType = "pokemon" | "item";

export interface FishingState {
  hookCountdown: number;
  waitCountdown: number;
  fishTravelCountdown: number;
  fishAngle: number;
  /** A boia já pousou na água neste arremesso (som de pouso tocado). */
  isCast: boolean;
  /** entityData CAUGHT_FISH: há algo fisgado agora. */
  caughtFish: boolean;
  typeCaught: CatchType;
}

export function newFishingState(): FishingState {
  return { hookCountdown: 0, waitCountdown: 0, fishTravelCountdown: 0, fishAngle: 0, isCast: false, caughtFish: false, typeCaught: "item" };
}

export interface FishingTickEnv {
  /** Chove no bloco acima da boia. */
  raining: boolean;
  /** Céu visível do bloco acima da boia. */
  canSeeSky: boolean;
  /** Nível do encantamento Lure da vara. */
  lureLevel: number;
  /** Efeitos da isca presa na vara. */
  effects: readonly BaitEffect[];
  random: () => number;
  /**
   * Na fisgada de Pokémon: planeja o spawn e devolve o peso do bucket sorteado (fishingBuckets), ou
   * undefined se nada puder sair (usa 50, como o Cobblemon).
   */
  planSpawn(): number | undefined;
}

export type FishingEvent =
  | { type: "land" }
  | { type: "ripple"; strong: boolean }
  | { type: "trail"; offsetX: number; offsetZ: number }
  | { type: "bite"; catchType: CatchType }
  | { type: "escape" };

/**
 * Um tick da lógica de pesca com a boia na água. Muta `state` e devolve os efeitos a mostrar.
 * Ordem igual ao Cobblemon: janela de fisgada → peixe nadando até a boia → espera → pouso.
 */
export function tickFishing(state: FishingState, env: FishingTickEnv): FishingEvent[] {
  const events: FishingEvent[] = [];
  const random = env.random;
  let i = 1;
  if (random() < 0.25 && env.raining) ++i;
  if (random() < 0.5 && !env.canSeeSky) --i;

  if (state.hookCountdown > 0) {
    --state.hookCountdown;
    if (state.hookCountdown <= 0) {
      state.waitCountdown = 0;
      state.fishTravelCountdown = 0;
      state.caughtFish = false;
      events.push({ type: "escape" });
    }
  }
  else if (state.fishTravelCountdown > 0) {
    state.fishTravelCountdown -= i;
    if (state.fishTravelCountdown > 0) {
      state.fishAngle += triangle(0, 9.188, random);
      const f = state.fishAngle * (Math.PI / 180);
      events.push({ type: "trail", offsetX: Math.sin(f) * state.fishTravelCountdown * 0.1, offsetZ: Math.cos(f) * state.fishTravelCountdown * 0.1 });
    }
    else {
      // Fisgou: Pokémon ou item.
      if (rollPokemonCatch(env.effects, random)) {
        state.typeCaught = "pokemon";
        const weight = env.planSpawn() ?? 50;
        const [min, max] = calculateMinMaxCountdown(weight);
        state.hookCountdown = nextInt(min, max, random);
      }
      else {
        state.typeCaught = "item";
        state.hookCountdown = nextInt(20, 40, random);
      }
      state.caughtFish = true;
      events.push({ type: "bite", catchType: state.typeCaught });
    }
  }
  else if (state.waitCountdown > 0) {
    state.waitCountdown -= i + env.lureLevel;
    let f = 0.15;
    if (state.waitCountdown < 20) f += (20 - state.waitCountdown) * 0.05;
    else if (state.waitCountdown < 40) f += (40 - state.waitCountdown) * 0.02;
    else if (state.waitCountdown < 60) f += (60 - state.waitCountdown) * 0.01;
    if (random() < f) events.push({ type: "ripple", strong: state.waitCountdown < 40 });
    if (state.waitCountdown <= 0) {
      state.fishAngle = nextFloat(0, 360, random);
      state.fishTravelCountdown = nextInt(20, 80, random);
    }
  }
  else {
    if (!state.isCast) {
      events.push({ type: "land" });
      state.isCast = true;
    }
    state.waitCountdown = rollWaitCountdown(env.effects, random);
  }
  return events;
}

// ---------------------------------------------------------------------------------------------
// Loot (data/cobblemon/loot_table/fishing/pokerod.json)

export type LootCategory = "junk" | "cobblemon_treasure" | "treasure";

/**
 * Pool da Poké Rod: lixo 66, tesouro do Cobblemon 17 e tesouro vanilla 17 (os dois tesouros só em águas
 * abertas). Sem peixes. O Cobblemon não passa `luck` ao LootParams, então `quality` não pesa.
 */
export const POKEROD_LOOT: { category: LootCategory; weight: number; openWaterOnly: boolean }[] = [
  { category: "junk", weight: 66, openWaterOnly: false },
  { category: "cobblemon_treasure", weight: 17, openWaterOnly: true },
  { category: "treasure", weight: 17, openWaterOnly: true },
];

/** fishing/pokerod_treasure.json: um dos cinco, peso igual. */
export const COBBLEMON_TREASURE = [
  "cobblemon:deep_sea_scale", "cobblemon:deep_sea_tooth", "cobblemon:dragon_scale", "cobblemon:kings_rock", "cobblemon:prism_scale",
];

export function rollLootCategory(inOpenWater: boolean, random: () => number = Math.random): LootCategory {
  const pool = POKEROD_LOOT.filter(e => inOpenWater || !e.openWaterOnly);
  const total = pool.reduce((a, e) => a + e.weight, 0);
  let roll = random() * total;
  for (const e of pool) {
    roll -= e.weight;
    if (roll < 0) return e.category;
  }
  return pool[pool.length - 1].category;
}

// ---------------------------------------------------------------------------------------------
// Águas abertas (isOpenOrWaterAround)

export type PositionKind = "above_water" | "inside_water" | "invalid";

/**
 * isOpenOrWaterAround: camadas y = −1..2 de 5×5 em volta da boia; cada camada tem de ser toda de um tipo
 * (água-fonte sem colisão, ou ar/nenúfar). De baixo para cima: água… e depois só ar.
 * `layerKind(dy)` devolve o tipo uniforme da camada (ou "invalid" se misturada).
 */
export function isOpenOrWaterAround(layerKind: (dy: number) => PositionKind): boolean {
  let previous: PositionKind = "invalid";
  for (let dy = -1; dy <= 2; dy++) {
    const kind = layerKind(dy);
    if (kind === "invalid") return false;
    if (kind === "above_water" && previous === "invalid") return false;
    if (kind === "inside_water" && previous === "above_water") return false;
    previous = kind;
  }
  return true;
}

/** Tipo uniforme de uma lista de posições (getPositionType(start, end)). */
export function uniformKind(kinds: readonly PositionKind[]): PositionKind {
  if (kinds.length === 0) return "invalid";
  return kinds.every(k => k === kinds[0]) ? kinds[0] : "invalid";
}

// ---------------------------------------------------------------------------------------------
// Física (ticks do Minecraft)

export interface Vec3 { x: number; y: number; z: number }

/** Velocidade inicial do arremesso (construtor do bobber): 0,6 bloco/tick na direção do olhar com ruído. */
export function castVelocity(pitchDeg: number, yawDeg: number, random: () => number = Math.random): Vec3 {
  const rad = Math.PI / 180;
  const cosYaw = Math.cos(-yawDeg * rad - Math.PI);
  const sinYaw = Math.sin(-yawDeg * rad - Math.PI);
  const cosPitch = -Math.cos(-pitchDeg * rad);
  const sinPitch = Math.sin(-pitchDeg * rad);
  const v = { x: -sinYaw, y: Math.min(5, Math.max(-5, -(sinPitch / cosPitch))), z: -cosYaw };
  const m = Math.hypot(v.x, v.y, v.z);
  const k = () => 0.6 / m + triangle(0.5, 0.0103365, random);
  return { x: v.x * k(), y: v.y * k(), z: v.z * k() };
}

/** Ponto de saída da boia: olhos do jogador, 0,3 bloco para o lado da vara. */
export function castOrigin(eye: Vec3, yawDeg: number): Vec3 {
  const rad = Math.PI / 180;
  const cosYaw = Math.cos(-yawDeg * rad - Math.PI);
  const sinYaw = Math.sin(-yawDeg * rad - Math.PI);
  return { x: eye.x - sinYaw * 0.3, y: eye.y, z: eye.z - cosYaw * 0.3 };
}

/** Altura da água-fonte num bloco (FluidState.getHeight: 8/9). */
export const WATER_SURFACE = 8 / 9;

/**
 * Velocidade da boia boiando (estado BOBBING): puxa para a superfície com ruído e amortece; com algo
 * fisgado, afunda um pouco a cada tick.
 */
export function bobbingVelocity(pos: Vec3, vel: Vec3, blockY: number, fluidHeight: number, caughtFish: boolean, random: () => number = Math.random): Vec3 {
  let d = pos.y + vel.y - blockY - fluidHeight;
  if (Math.abs(d) < 0.01) d += Math.sign(d) * 0.1;
  const out = { x: vel.x * 0.9, y: vel.y - d * random() * 0.2, z: vel.z * 0.9 };
  if (caughtFish) out.y += -0.1 * random() * random();
  return out;
}

/** Mergulho da boia no momento da fisgada (onSyncedDataUpdated CAUGHT_FISH). */
export function biteDipVelocity(vel: Vec3, random: () => number = Math.random): Vec3 {
  return { x: vel.x, y: -0.4 * nextFloat(0.3, 0.5, random), z: vel.z };
}

/**
 * lobPokemonTowardsTarget: arco suave até 5 blocos à frente do jogador, amortecido pela distância.
 * `yawDeg` = rotação Y do jogador (graus, convenção do Minecraft).
 */
export function lobVelocity(player: Vec3, yawDeg: number, entity: Vec3): Vec3 {
  const rad = yawDeg * Math.PI / 180;
  const target = { x: player.x - Math.sin(rad) * 5, y: player.y, z: player.z + Math.cos(rad) * 5 };
  const dx = target.x - entity.x, dz = target.z - entity.z;
  const horizontal = Math.sqrt(dx * dx + dz * dz);
  const damping = 1 - Math.min(0.8, Math.max(0, horizontal / 80));
  const h = horizontal * 0.13 * damping;
  const vy = (0.30 + horizontal * 0.05) * damping;
  if (horizontal < 1e-6) return { x: 0, y: vy, z: 0 };
  return { x: dx / horizontal * h, y: vy, z: dz / horizontal * h };
}

/** Velocidade do item pescado até o jogador (retrieve). */
export function itemPullVelocity(player: Vec3, from: Vec3): Vec3 {
  const d = player.x - from.x, e = player.y - from.y, f = player.z - from.z;
  return { x: d * 0.1, y: e * 0.1 + Math.sqrt(Math.sqrt(d * d + e * e + f * f)) * 0.08, z: f * 0.1 };
}

/** Peso (hectogramas) a partir do qual o Pokémon é grande demais para ser puxado (900 = 90 kg). */
export const REEL_IN_MAX_WEIGHT = 900;

/**
 * Dano na vara ao recolher (retrieve + hurtAndBreak): entidade fisgada 5 (item 3), item/Pokémon pescado 1,
 * boia no chão 2 (substitui), nada 0.
 */
export function retrieveDamage(result: { hookedEntity?: "item" | "entity"; caught?: boolean; onGround?: boolean }): number {
  let i = 0;
  if (result.hookedEntity) i = result.hookedEntity === "item" ? 3 : 5;
  else if (result.caught) i = 1;
  if (result.onGround) i = 2;
  return i;
}

/** Unbreaking: cada ponto de dano só é aplicado com chance 1/(nível+1). */
export function durabilityLoss(amount: number, unbreakingLevel: number, random: () => number = Math.random): number {
  let loss = 0;
  for (let n = 0; n < amount; n++) if (random() < 1 / (unbreakingLevel + 1)) loss++;
  return loss;
}
