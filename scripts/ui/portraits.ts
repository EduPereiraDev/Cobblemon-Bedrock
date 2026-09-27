/**
 * Caminho do retrato de um Pokémon para o HUD e as telas.
 *
 * A frente "retratos" gera `generated/scripts/portraits.ts` com `portraitTexture(species, variant)` (rosto 64 px em
 * `textures/cobblemon/portraits/...`, por variante). Espécie sem retrato gerado cai no sprite 2D antigo
 * (`textures/sprites/<espécie>`). `setPortraitResolver` troca a fonte (ex.: ícones de 32 px ou testes).
 */
import { hasPortrait, portraitTexture } from "../../generated/scripts/portraits";

export type PortraitResolver = (species: string, variant: number) => string | undefined;

/** Padrão: retrato gerado quando existir. */
const generatedPortrait: PortraitResolver = (species, variant) => (hasPortrait(species) ? portraitTexture(species, variant) : undefined);

let resolver: PortraitResolver | undefined = generatedPortrait;

/** Liga o resolvedor de retratos (normalmente `portraitTexture` do módulo gerado). */
export function setPortraitResolver(fn: PortraitResolver | undefined) {
  resolver = fn;
}

/** Id da espécie sem namespace e só com [a-z0-9-] (mesma regra do sprite). */
function spriteId(species: string): string {
  const id = species.includes(":") ? species.slice(species.indexOf(":") + 1) : species;
  return id.toLowerCase().replace(" ", "-").replace(/[^a-z0-9\-]+/g, "");
}

/** Textura do retrato (com "textures/"), com recurso ao sprite quando não houver retrato. */
export function portraitPath(species: string, variant = 0): string {
  const id = spriteId(species);
  if (resolver) {
    try {
      // Id do Cobblemon (toSpeciesId): "Mr. Mime" → "mrmime".
      const speciesId = (species.includes(":") ? species.slice(species.indexOf(":") + 1) : species).toLowerCase().replace(/[^a-z0-9]+/g, "");
      const found = resolver(speciesId, variant);
      const path = found && (found.startsWith("textures/") ? found : `textures/${found}`);
      // O campo do HUD tem 40 bytes depois de "textures/" (hudProtocol.PARTY_FIELDS.tex).
      if (path && path.length - "textures/".length <= 40) return path;
    }
    catch { /* módulo gerado sem a espécie: cai no sprite */ }
  }
  return `textures/sprites/${id}`;
}
