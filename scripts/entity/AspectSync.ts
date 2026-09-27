/**
 * Frente dados-ia: aspects do Pokémon no cliente para `q.has_aspect` dos posers (Cobblemon: o cliente recebe os
 * aspects por pacote e o poser consulta `state.currentAspects`).
 *
 * No Bedrock o cliente só vê propriedades de entidade sincronizadas. O importador junta, por espécie, os aspects que
 * os posers leem (ex.: `sheared` do Mareep/Wooloo/Dubwool, `regrown-tail-1..3` do Slowpoke) numa propriedade int
 * `cobblemon:aspects` (um bit por aspect, na ordem de `ASPECT_BITS[espécie]`), e a client entity calcula
 * `v.cobblemon_aspect_<nome>` a partir dela. Espécies sem aspects de poser não têm a propriedade (limite de 32
 * propriedades por entidade preservado).
 */
import { ASPECT_BITS, ASPECTS_PROPERTY } from "../../generated/scripts/dadosIa";

/** Entidade mínima (Entity do Minecraft). */
interface PropertyEntity {
  typeId: string;
  getProperty(id: string): boolean | number | string | undefined;
  setProperty(id: string, value: boolean | number | string): void;
}

/** Aspects da espécie sincronizados ao cliente (vazio = sem propriedade). */
export function aspectBitsOf(speciesId: string): readonly string[] {
  return ASPECT_BITS[speciesId.replace(/^cobblemon:/, "").toLowerCase()] ?? [];
}

/** Bitmask dos aspects presentes (bit i = aspectBitsOf(espécie)[i]). */
export function aspectMask(speciesId: string, aspects: readonly string[]): number {
  const bits = aspectBitsOf(speciesId);
  let mask = 0;
  bits.forEach((aspect, i) => {
    if (aspects.includes(aspect)) mask += 2 ** i;
  });
  return mask;
}

/**
 * Grava `cobblemon:aspects` na entidade se a espécie tiver aspects de poser e o valor mudou.
 * @returns true se escreveu.
 */
export function syncAspectBits(entity: PropertyEntity, aspects: readonly string[]): boolean {
  const species = entity.typeId;
  if (!aspectBitsOf(species).length) return false;
  const mask = aspectMask(species, aspects);
  try {
    const current = entity.getProperty(ASPECTS_PROPERTY);
    if (current === undefined || current === mask) return false;
    entity.setProperty(ASPECTS_PROPERTY, mask);
    return true;
  }
  catch {
    return false;
  }
}
