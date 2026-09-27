/**
 * Utilitário comum das saídas de comparador por `minecraft:redstone_producer` em permutações (Healing Machine,
 * Metronome, panela na fogueira e vaso decorado).
 *
 * Limitação do Bedrock medida no BDS 1.26.52.3 (docs/pendencias/comparadores.md): o circuito só refaz as ligações do
 * produtor quando o bloco é posto (ou o chunk carrega). Trocar `connected_faces` por permutação não liga a face nova
 * nem solta a velha (mudar só a força propaga), e recolocar o comparador também não liga; recolocar o bloco liga e
 * solta. Por isso, quando as faces mudam, o bloco é recolocado no mesmo tick.
 *
 * Recolocar dispara o `onBreak` do componente do bloco (medido na fogueira: chega alguns ticks depois, com o bloco já
 * de volta). Quem tem lógica de quebra consulta `replacedInPlace` para não soltar o conteúdo nem apagar o registro.
 */
import { Block, BlockPermutation, system, Vector3 } from "@minecraft/server";

/** Por quantos ticks uma recolocação vale para `replacedInPlace` (o onBreak chegou em menos de 10). */
export const REPLACE_WINDOW = 40;

/** Posição → tick da última recolocação. */
const replaced = new Map<string, number>();

function posKey(dimensionId: string, l: Vector3): string {
  return `${dimensionId}|${Math.floor(l.x)},${Math.floor(l.y)},${Math.floor(l.z)}`;
}

function forgetOld(now: number) {
  for (const [key, tick] of replaced) if (now - tick > REPLACE_WINDOW || tick > now) replaced.delete(key);
}

/**
 * Recoloca o bloco no mesmo tick com a permutação `perm` (`setType(air)` + `setPermutation`), mantendo a água.
 * Sem loot e sem evento de jogador; o `onBreak`/`onPlace` do componente ainda chegam (ver `replacedInPlace`).
 */
export function replaceBlock(block: Block, perm: BlockPermutation) {
  let wet = false;
  try { wet = block.isWaterlogged; }
  catch { wet = false; }
  const now = Number(system.currentTick);
  forgetOld(now);
  try { replaced.set(posKey(block.dimension.id, block.location), now); }
  catch { /* sem dimensão (bloco inválido) */ }
  block.setType("minecraft:air");
  block.setPermutation(perm);
  if (wet) {
    try { block.setWaterlogged(true); }
    catch { /* bloco sem água possível */ }
  }
}

/**
 * A "quebra" em `location` foi uma recolocação de `replaceBlock` (há até REPLACE_WINDOW ticks) e o bloco continua lá
 * (`currentType` é um de `types`)? Então o conteúdo e o registro ficam.
 */
export function replacedInPlace(dimensionId: string, location: Vector3, currentType: string | undefined, types: readonly string[]): boolean {
  const key = posKey(dimensionId, location);
  const tick = replaced.get(key);
  if (tick === undefined) return false;
  const now = Number(system.currentTick);
  if (now - tick > REPLACE_WINDOW || tick > now) { replaced.delete(key); return false; }
  return currentType !== undefined && types.includes(currentType);
}
