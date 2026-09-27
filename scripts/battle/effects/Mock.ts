import { Dimension, Entity, system, world } from "@minecraft/server";
import { resolveVariant } from "../../../generated/scripts/variants";
import { toSpeciesId } from "../../speciesData";
import { applyScaleProperty } from "../../pokemon/Scale";
import { applyEntitySize } from "../../entity/Size";
import { playShinyRing } from "../../Pokemon";
import type { PokemonData } from "../../Pokemon";
import type { ActivePokemon } from "../ActivePokemon";
import { playCry } from "../Animations";

/**
 * Visual de Illusion / Transform / Imposter (IllusionEffect.kt, TransformEffect.kt, EffectTracker.mockEffect).
 *
 * No Cobblemon o cliente desenha outra espécie no lugar da entidade ("mock"). No Bedrock cada espécie é uma
 * entidade própria, então o disfarce é uma entidade de exibição da espécie copiada, parada no lugar do Pokémon
 * real, que fica invisível (efeito sem partículas) e sem rótulo enquanto durar o efeito:
 *  - a entidade de exibição leva a tag do estúdio (`cobblemon_ui_display`): o `entitySpawn` do main.ts não cria
 *    dados de selvagem para ela e o `entityLoad` a remove se o chunk recarregar (não sobrevive a uma queda);
 *  - `cobblemon:mock_of` = id da entidade real (para quem precisar achar o Pokémon de verdade, ex. a Poké Bola);
 *  - efeitos de golpe, grito e desmaio tocam na entidade que aparece (`ActivePokemon.visual`).
 *
 * Tempos do Cobblemon: Transform toca o grito 1 s depois de aplicar (se `doCry`); o fim de Illusion/Transform
 * mostra o Pokémon real e toca o grito 1 s depois (Illusion também o anel de shiny e revela na Pokédex).
 */

export const MOCK_TAG = "cobblemon_battle_mock";
/** Tag do estúdio de câmera (scripts/ui/studio/Studio.ts: STUDIO_TAG); repetida aqui para não puxar o estúdio. */
const DISPLAY_TAG = "cobblemon_ui_display";
export const MOCK_OF_PROPERTY = "cobblemon:mock_of";
/** Duração do efeito de invisibilidade do Pokémon real (renovado se a batalha for longa). */
const HIDE_TICKS = 20 * 60 * 30;
/** Segundos até o grito depois de aplicar/tirar o efeito (afterOnServer(seconds = 1.0F)). */
export const MOCK_CRY_DELAY = 1;

function valid(entity: Entity | undefined): entity is Entity {
  try { return !!entity?.isValid; } catch { return false; }
}

/** Aspects do visual copiado: Transform mantém o shiny de quem se transforma (SHINY_ASPECT.provide). */
export function mockAspects(kind: "illusion" | "transform", disguise: PokemonData, self: PokemonData): string[] {
  if (kind === "illusion") return [...disguise.aspects];
  const aspects = disguise.aspects.filter(a => a !== "shiny");
  if (self.shiny) aspects.push("shiny");
  return aspects;
}

function hideReal(entity: Entity) {
  try { entity.addEffect("invisibility", HIDE_TICKS, { showParticles: false, amplifier: 0 }); } catch { }
  try { entity.nameTag = ""; } catch { }
}

function showReal(active: ActivePokemon) {
  const entity = active.entity;
  if (!valid(entity)) return;
  try { entity.removeEffect("invisibility"); } catch { }
  // O rótulo volta pelo applyToCobblemon (tryUpdatePokemonOut).
  try { active.data.tryUpdatePokemonOut(); } catch { }
}

/** Entidade de exibição da espécie de `disguise` no lugar da entidade real. */
function spawnMockEntity(active: ActivePokemon, kind: "illusion" | "transform", disguise: PokemonData): Entity | undefined {
  const real = active.entity;
  if (!valid(real)) return undefined;
  const species = toSpeciesId(disguise.species);
  let mock: Entity;
  try {
    mock = real.dimension.spawnEntity(`cobblemon:${species}`, real.location, {
      // Evento vazio no lugar do minecraft:entity_spawned (sem IA de selvagem), como o estúdio.
      spawnEvent: "cobblemon:interacted",
      initialPersistence: false,
      initialRotation: real.getRotation().y,
    });
  }
  catch (e) {
    console.warn(`Mock de ${kind}: não foi possível exibir ${species}: ${e}`);
    return undefined;
  }
  // As tags entram antes do afterEvents.entitySpawn (fim do tick): o main.ts não cria dados para ela.
  mock.addTag(DISPLAY_TAG);
  mock.addTag(MOCK_TAG);
  try { mock.setDynamicProperty(MOCK_OF_PROPERTY, real.id); } catch { }
  try { mock.setProperty("cobblemon:variant", resolveVariant(species, mockAspects(kind, disguise, active.data))); } catch { }
  try { mock.setProperty("cobblemon:wild", real.getProperty("cobblemon:wild") === true); } catch { }
  try { mock.setProperty("cobblemon:initialized", true); } catch { }
  try { applyEntitySize(mock, disguise); } catch { }
  // Escala do copiado (mimic.form.baseScale * mimic.effectiveScale; a forma base já vem do grupo de tamanho).
  try { applyScaleProperty(mock, disguise.getEffectiveScale()); } catch { }
  try { if (disguise.aspects.includes("alpha")) mock.triggerEvent("cobblemon:set_alpha"); } catch { }
  try { mock.nameTag = kind === "illusion" ? disguise.getEntityLabel() : active.data.getEntityLabel(); } catch { }
  // Marcas de batalha (congela a IA; clique de espectador cai na batalha).
  try {
    const battleId = real.getDynamicProperty("in_battle");
    if (typeof battleId === "string") mock.setDynamicProperty("in_battle", battleId);
    mock.setProperty("cobblemon:in_battle", true);
    mock.triggerEvent("cobblemon:battle_start");
  }
  catch { }
  return mock;
}

/**
 * Liga o visual de Illusion/Transform (BattleEffect.start). Substitui um efeito anterior do mesmo Pokémon.
 * @returns segundos que a fila da batalha deve esperar (1 s para o grito do Transform; 0 para Illusion).
 */
export function startMock(active: ActivePokemon, kind: "illusion" | "transform", disguise: PokemonData, doCry = true): number {
  removeMockEntity(active);
  const mock = spawnMockEntity(active, kind, disguise);
  if (!mock) return 0;
  hideReal(active.entity);
  active.mock = { kind, entity: mock, species: toSpeciesId(disguise.species), data: disguise };
  if (kind === "transform") {
    if (doCry)
      system.runTimeout(() => { if (active.mock?.entity === mock && valid(mock)) playCry(mock, disguise); }, MOCK_CRY_DELAY * 20);
    return MOCK_CRY_DELAY;
  }
  return 0;
}

function removeMockEntity(active: ActivePokemon) {
  const mock = active.mock?.entity;
  active.mock = undefined;
  if (!valid(mock)) return;
  try { mock.remove(); } catch { try { mock.triggerEvent("cobblemon:instant_kill"); } catch { } }
}

/**
 * Desliga o visual (BattleEffect.end / revert): some a entidade de exibição e o Pokémon real reaparece.
 * `graceful` toca o grito 1 s depois (e, para Illusion, o anel de shiny e a revelação na Pokédex).
 * @returns segundos que a fila deve esperar (Cobblemon: UntilDispatch no futuro do revert = 1 s), 0 se não havia.
 */
export function endMock(active: ActivePokemon, graceful = true, onReveal?: (active: ActivePokemon) => void): number {
  const state = active.mock;
  if (!state) return 0;
  removeMockEntity(active);
  showReal(active);
  if (!graceful) return 0;
  system.runTimeout(() => {
    const entity = active.entity;
    if (!valid(entity)) return;
    playCry(entity, active.data);
    if (state.kind === "illusion") {
      if (active.data.shiny) playShinyRing(entity);
      try { onReveal?.(active); } catch { }
    }
  }, MOCK_CRY_DELAY * 20);
  return MOCK_CRY_DELAY;
}

/** Mantém a entidade de exibição no lugar do Pokémon real (empurrões, correção de posição do servidor). */
export function followMock(active: ActivePokemon) {
  const state = active.mock;
  if (!state) return;
  const real = active.entity;
  if (!valid(real)) {
    removeMockEntity(active);
    return;
  }
  if (!valid(state.entity)) {
    active.mock = undefined;
    showReal(active);
    return;
  }
  try {
    const a = real.location;
    const b = state.entity.location;
    if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z) > 0.2)
      state.entity.teleport(a, { rotation: real.getRotation() });
  }
  catch { }
}

const ALL_DIMENSIONS = ["overworld", "nether", "the_end"];

function mocksIn(dimensions: readonly Dimension[]): Entity[] {
  const found: Entity[] = [];
  for (const dimension of dimensions) {
    try { found.push(...dimension.getEntities({ tags: [MOCK_TAG] })); } catch { }
  }
  return found;
}

function allDimensions(): Dimension[] {
  const out: Dimension[] = [];
  for (const id of ALL_DIMENSIONS) {
    try { out.push(world.getDimension(id)); } catch { }
  }
  return out;
}

/**
 * Entidade de exibição (Illusion/Transform) do Pokémon real `realId`, se existir e estiver válida. Procura na
 * dimensão do Pokémon real (ou em todas, se ele não for achado).
 */
export function findMockOf(realId: string): Entity | undefined {
  let dimensions: Dimension[];
  try {
    const real = world.getEntity(realId);
    dimensions = real?.isValid ? [real.dimension] : allDimensions();
  }
  catch { dimensions = allDimensions(); }
  for (const mock of mocksIn(dimensions)) {
    try { if (valid(mock) && mock.getDynamicProperty(MOCK_OF_PROPERTY) === realId) return mock; } catch { }
  }
  return undefined;
}

/**
 * Remove as entidades de exibição que sobraram da batalha `battleId` (in_battle = battleId) mesmo sem ActivePokemon
 * que as aponte (ex.: slot anulado pela captura) e mostra de novo o Pokémon real delas. Devolve quantas removeu.
 */
export function removeBattleMocks(battleId: string): number {
  let removed = 0;
  for (const mock of mocksIn(allDimensions())) {
    try {
      if (mock.getDynamicProperty("in_battle") !== battleId) continue;
      const realId = mock.getDynamicProperty(MOCK_OF_PROPERTY);
      try { mock.remove(); } catch { mock.triggerEvent("cobblemon:instant_kill"); }
      removed++;
      if (typeof realId === "string") {
        const real = world.getEntity(realId);
        if (valid(real)) try { real.removeEffect("invisibility"); } catch { }
      }
    }
    catch { }
  }
  return removed;
}

/** A entidade é uma entidade de exibição de Illusion/Transform (não é um Pokémon de verdade). */
export function isBattleMock(entity: Entity): boolean {
  try { return entity.hasTag(MOCK_TAG); } catch { return false; }
}

/**
 * Pokémon real por trás de uma entidade de exibição (ou a própria entidade). Para quem recebe um acerto na
 * entidade de exibição (ex.: a Poké Bola em batalha contra um Ditto transformado).
 */
export function resolveMockTarget(entity: Entity): Entity {
  if (!isBattleMock(entity)) return entity;
  try {
    const id = entity.getDynamicProperty(MOCK_OF_PROPERTY);
    if (typeof id === "string") {
      const real = world.getEntity(id);
      if (real?.isValid) return real;
    }
  }
  catch { }
  return entity;
}
