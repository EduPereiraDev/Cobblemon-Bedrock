/**
 * Estruturas vanilla como condição de spawn/evolução (pesquisa 8, §11): consultas preguiçosas no registro de
 * estruturas (scripts/world/StructureRegistry.ts, `setLazyStructureCheck`), uma por id.
 *
 * Custo: nada roda por tick. Na primeira consulta de um chunk (condição `structures` do spawn ou requisito
 * `structure` da evolução), a assinatura só é testada na dimensão e no bioma da estrutura; aí são 1–3
 * `containsBlock` num volume de ~16×40×16 blocos. Positivo vai para o registro (persistente, como o das vilas);
 * negativo fica num cache em memória por 10 min (chunk × estrutura).
 */
import { BlockTypes, BlockVolume, Dimension, system, Vector3 } from "@minecraft/server";
import { chunkOf, registerStructureTag, setLazyStructureCheck, structureRegistry } from "../world/StructureRegistry";
import { biomeAllows, signatureMatches, signatureVolume, StructureSignature, STRUCTURE_SIGNATURES, VANILLA_STRUCTURE_TAGS } from "./structureSignatures";

const NEGATIVE_TTL = 12000;
const CACHE_LIMIT = 8192;
const negativeUntil = new Map<string, number>();

/** Contadores para a sonda (consultas, testes de bloco, positivos). */
export const structureStats = { queries: 0, scans: 0, hits: 0, skippedBiome: 0 };

/** Assinaturas com os ids de bloco que existem nesta versão (id inexistente faria o containsBlock falhar). */
let resolved: StructureSignature[] = [];
export const missingBlockIds: string[] = [];

function resolveSignatures(): StructureSignature[] {
  const exists = (id: string) => {
    try { return BlockTypes.get(id) !== undefined; }
    catch { return false; }
  };
  return STRUCTURE_SIGNATURES.map(sig => ({
    ...sig,
    all: sig.all.map(list => list.filter(id => {
      const ok = exists(id);
      if (!ok && !missingBlockIds.includes(id)) missingBlockIds.push(id);
      return ok;
    })),
  }));
}

function biomeOf(dimension: Dimension, location: Vector3, surface = false): string | undefined {
  try {
    if (surface) {
      const top = dimension.getTopmostBlock({ x: location.x, z: location.z });
      if (top) return dimension.getBiome({ x: location.x, y: top.location.y + 1, z: location.z }).id;
    }
    return dimension.getBiome(location).id;
  }
  catch { return undefined; }
}

/** Testa a assinatura no chunk do ponto; registra os ids se bater. @returns true se registrou. */
export function scanSignature(sig: StructureSignature, dimension: Dimension, location: Vector3): boolean {
  const cx = chunkOf(location.x), cz = chunkOf(location.z);
  const box = signatureVolume(sig, cx, cz, location.y, dimension.heightRange.min, dimension.heightRange.max - 1);
  const volume = new BlockVolume(box.min, box.max);
  structureStats.scans++;
  const ok = signatureMatches(sig, blocks => dimension.containsBlock(volume, { includeTypes: blocks }, true));
  if (!ok) return false;
  for (const id of [sig.id, ...(sig.aliases ?? [])]) structureRegistry.register(dimension.id, [[cx, cz]], id);
  structureStats.hits++;
  return true;
}

/**
 * Guarda um negativo até `now + NEGATIVE_TTL`. Passando de CACHE_LIMIT: tira os vencidos e, se ainda passar, os mais
 * antigos (ordem de inserção do Map; a chave regravada vai para o fim).
 */
export function rememberNegative(key: string, now: number, limit = CACHE_LIMIT) {
  negativeUntil.delete(key);
  negativeUntil.set(key, now + NEGATIVE_TTL);
  if (negativeUntil.size <= limit) return;
  for (const [k, t] of negativeUntil) if (t <= now) negativeUntil.delete(k);
  for (const k of negativeUntil.keys()) {
    if (negativeUntil.size <= limit) break;
    negativeUntil.delete(k);
  }
}

/** Chaves do cache negativo, da mais antiga para a mais nova (sonda/testes). */
export function negativeCacheKeys(): string[] {
  return [...negativeUntil.keys()];
}

function lazyCheck(sig: StructureSignature) {
  return (dimension: Dimension, location: Vector3) => {
    structureStats.queries++;
    if (dimension.id !== sig.dimension) return;
    const cx = chunkOf(location.x), cz = chunkOf(location.z);
    if (structureRegistry.structuresInChunk(dimension.id, cx, cz).includes(sig.id)) return;
    const key = `${sig.id}|${dimension.id}|${cx}|${cz}`;
    const now = system.currentTick;
    const until = negativeUntil.get(key);
    if (until !== undefined && until > now) return;
    if (!dimension.isChunkLoaded(location)) return;
    rememberNegative(key, now);
    if (!biomeAllows(sig, biomeOf(dimension, location, sig.surfaceBiome))) { structureStats.skippedBiome++; return; }
    scanSignature(sig, dimension, location);
  };
}

/** Esquece os negativos (sonda). */
export function clearStructureCache() {
  negativeUntil.clear();
}

export function resolvedSignatures(): readonly StructureSignature[] {
  return resolved;
}

let started = false;

export function startVanillaStructures() {
  if (started) return;
  started = true;
  resolved = resolveSignatures();
  for (const sig of resolved) {
    if (sig.all.some(list => !list.length)) continue;
    const check = lazyCheck(sig);
    for (const id of [sig.id, ...(sig.aliases ?? [])]) setLazyStructureCheck(id, check);
  }
  for (const [tag, ids] of Object.entries(VANILLA_STRUCTURE_TAGS)) registerStructureTag(tag, ids);
}
