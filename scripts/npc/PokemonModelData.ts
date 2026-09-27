/**
 * NPC com modelo de Pokémon (#53, §8): regras puras (sem API do Minecraft), usadas pelo NPCEntity e pelo
 * PokemonModel.ts.
 *
 * Java: o NPCRenderer desenha o poser/textura/camadas do VaryingModelRepository pelo `resourceIdentifier` do NPC
 * (client/render/npc/NPCRenderer.kt). Com um id de espécie ("cobblemon:mudkip", o exemplo do próprio
 * `cobblemon.entity.variable.resource_identifier.desc`) o NPC é desenhado como o Pokémon, com escala
 * renderScale × modelScale (sem o baseScale da espécie, que só o PokemonRenderer aplica). O id vem da classe
 * (`resourceIdentifier`) ou é forçado pelo behaviour `cobblemon:npc/resource_identifier` / MoLang
 * `q.entity.set_resource_identifier(...)`.
 */
import { getEntityInfo } from "../entity/EntityData";

/** Propriedade client_sync do NPC que esconde o modelo dele (part_visibility do render controller). */
export const NPC_HIDDEN_PROPERTY = "cobblemon:npc_hidden";
/** NPCClass.modelScale (0.9375 no 1.8.2; nenhuma classe/preset muda e o NPCClassAdapter não lê o campo). */
export const NPC_MODEL_SCALE = 0.9375;
/** Faixa de `cobblemon:scale_modifier` nas entidades de Pokémon (tools/importer/entities.ts). */
export const POKEMON_SCALE_MODIFIER_RANGE: readonly [number, number] = [0.05, 3.5];

/** "cobblemon:pikachu" | "pikachu" → "pikachu" se for uma espécie com entidade; senão undefined (skin de NPC). */
export function pokemonModelSpecies(resourceIdentifier: string | undefined): string | undefined {
  if (!resourceIdentifier) return undefined;
  const raw = resourceIdentifier.trim().toLowerCase();
  const colon = raw.indexOf(":");
  const namespace = colon >= 0 ? raw.slice(0, colon) : "cobblemon";
  const path = colon >= 0 ? raw.slice(colon + 1) : raw;
  if (namespace !== "cobblemon" || !path) return undefined;
  return getEntityInfo(path) ? path : undefined;
}

/**
 * `cobblemon:scale_modifier` da exibição: o NPC desenha o modelo com renderScale × modelScale (× hitboxScale, a
 * escala da entidade), enquanto a entidade da espécie já tem `minecraft:scale` = baseScale. Por isso divide.
 */
export function pokemonModelScaleModifier(species: string, renderScale: number, hitboxScale = 1): number {
  const base = getEntityInfo(species)?.sizes[0]?.scale || 1;
  const value = (renderScale * hitboxScale * NPC_MODEL_SCALE) / base;
  const [min, max] = POKEMON_SCALE_MODIFIER_RANGE;
  return Math.round(Math.max(min, Math.min(max, Number.isFinite(value) ? value : 1)) * 1000) / 1000;
}

/**
 * Caixa de colisão do NPC com modelo de Pokémon (sem hitboxScale, que o NPC aplica depois): a hitbox da espécie no
 * tamanho em que o modelo é desenhado (hitbox × modelScale × renderScale), para o clique acertar o Pokémon visível.
 * Um `set_hitbox`/editor do NPC continua tendo prioridade.
 */
export function pokemonModelHitbox(species: string, renderScale = 1): { width: number; height: number } | undefined {
  const size = getEntityInfo(species)?.sizes[0];
  if (!size) return undefined;
  const k = NPC_MODEL_SCALE * (Number.isFinite(renderScale) && renderScale > 0 ? renderScale : 1);
  return { width: Math.round(size.width * k * 100) / 100, height: Math.round(size.height * k * 100) / 100 };
}

/** Rotação (pitch x, yaw y, graus) a partir da direção do olhar. */
export function rotationFromView(view: { x: number; y: number; z: number }): { x: number; y: number } {
  const horizontal = Math.hypot(view.x, view.z);
  const yaw = (Math.atan2(-view.x, view.z) * 180) / Math.PI;
  const pitch = (-Math.atan2(view.y, horizontal) * 180) / Math.PI;
  // `+ 0` tira o -0 (atan2 de -0).
  return { x: Math.round(pitch * 10) / 10 + 0, y: Math.round(yaw * 10) / 10 + 0 };
}

/** Diferença angular mínima (graus). */
export function angleDelta(a: number, b: number): number {
  return Math.abs(((b - a + 540) % 360) - 180);
}
