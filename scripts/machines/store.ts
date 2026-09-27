/**
 * Armazenamento dos "block entities" da frente mundo-máquinas.
 *
 * O Bedrock não tem block entity com dados próprios, então cada máquina guarda um registro JSON numa
 * dynamic property do mundo com chave pela posição do bloco: `cobblemon:mach:<tipo>:<dimensão>|x|y|z`.
 * Um índice em memória (montado de `world.getDynamicPropertyIds()` na primeira leitura) permite que os
 * laços de tick percorram só as máquinas de um tipo. O backend é trocável para os testes.
 */
import { Vector3, world } from "@minecraft/server";

export interface StorageBackend {
  get(id: string): string | undefined;
  set(id: string, value: string | undefined): void;
  ids(): string[];
}

const worldBackend: StorageBackend = {
  get: id => {
    const v = world.getDynamicProperty(id);
    return typeof v === "string" ? v : undefined;
  },
  set: (id, value) => world.setDynamicProperty(id, value),
  ids: () => world.getDynamicPropertyIds(),
};

let backend: StorageBackend = worldBackend;
/** Índice por tipo: chave de posição → presente. Montado sob demanda. */
let index: Map<string, Set<string>> | undefined;

/** Troca o backend (testes). Zera o índice. */
export function setStorageBackend(b: StorageBackend | undefined) {
  backend = b ?? worldBackend;
  index = undefined;
}

const PREFIX = "cobblemon:mach:";
/** Limite de uma dynamic property de texto no Bedrock. */
export const MAX_PROPERTY_LENGTH = 32767;

/** Chave de posição (inteira) de um bloco: `dimensão|x|y|z`. */
export function blockKey(dimension: string, loc: Vector3): string {
  return `${dimension}|${Math.floor(loc.x)}|${Math.floor(loc.y)}|${Math.floor(loc.z)}`;
}

export function parseBlockKey(key: string): { dimension: string; location: Vector3 } {
  const [dimension, x, y, z] = key.split("|");
  return { dimension, location: { x: Number(x), y: Number(y), z: Number(z) } };
}

function propertyId(kind: string, key: string) {
  return `${PREFIX}${kind}:${key}`;
}

function getIndex(): Map<string, Set<string>> {
  if (index) return index;
  index = new Map();
  for (const id of backend.ids()) {
    if (!id.startsWith(PREFIX)) continue;
    const rest = id.slice(PREFIX.length);
    const sep = rest.indexOf(":");
    if (sep < 0) continue;
    const kind = rest.slice(0, sep);
    let set = index.get(kind);
    if (!set) index.set(kind, set = new Set());
    set.add(rest.slice(sep + 1));
  }
  return index;
}

/** Registros de um tipo de máquina (fossil, pasture, cooking, ...). */
export class MachineStore<T> {
  constructor(readonly kind: string) { }

  get(key: string): T | undefined {
    const raw = backend.get(propertyId(this.kind, key));
    if (raw === undefined) return undefined;
    try { return JSON.parse(raw) as T; }
    catch { return undefined; }
  }

  /** Grava (ou apaga com `undefined`). Lança se o JSON passar do limite de uma dynamic property. */
  set(key: string, value: T | undefined) {
    const id = propertyId(this.kind, key);
    const idx = getIndex();
    let set = idx.get(this.kind);
    if (!set) idx.set(this.kind, set = new Set());
    if (value === undefined) {
      backend.set(id, undefined);
      set.delete(key);
      return;
    }
    const json = JSON.stringify(value);
    if (json.length > MAX_PROPERTY_LENGTH) throw new Error(`Registro ${id} grande demais (${json.length})`);
    backend.set(id, json);
    set.add(key);
  }

  has(key: string): boolean {
    return getIndex().get(this.kind)?.has(key) ?? false;
  }

  delete(key: string) {
    this.set(key, undefined);
  }

  keys(): string[] {
    return [...(getIndex().get(this.kind) ?? [])];
  }
}
