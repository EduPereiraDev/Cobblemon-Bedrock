import { Block, BlockComponentStepOffEvent, BlockComponentStepOnEvent, BlockCustomComponent, system } from "@minecraft/server";
import { changeBlockState } from "../utils/BlockUtils";

/**
 * Placas de pressão de madeira (apricorn/saccharine). O sinal (15) vem do JSON: permutação `cobblemon:pressed` = true
 * com `minecraft:redstone_producer`. Como a placa de madeira do Java, qualquer entidade aperta e ela só solta
 * 20 ticks depois de não haver mais ninguém em cima.
 */
const RELEASE_DELAY = 20;

/** Há alguma entidade sobre a placa? */
export function hasEntityOnPlate(block: Block): boolean {
  try {
    const { x, y, z } = block.location;
    return block.dimension.getEntities({ location: { x, y, z }, volume: { x: 1, y: 0.5, z: 1 } }).some(e => e.isValid);
  }
  catch { return false; }
}

export default class PressurePlateComponent implements BlockCustomComponent {
  constructor(
    public pressedState = "cobblemon:pressed"
  ) { }
  onStepOn(arg: BlockComponentStepOnEvent) {
    if (arg.block.permutation.getState(this.pressedState as never) === true) return;
    changeBlockState(arg.block, this.pressedState, true);
    arg.dimension.playSound("random.click", arg.block.location, { pitch: 0.8, volume: 0.3 });
  }
  onStepOff(arg: BlockComponentStepOffEvent) {
    this.scheduleRelease(arg.block);
  }
  private scheduleRelease(block: Block) {
    const typeId = block.typeId;
    system.runTimeout(() => {
      if (!block.isValid || block.typeId !== typeId || block.permutation.getState(this.pressedState as never) !== true) return;
      if (hasEntityOnPlate(block)) { this.scheduleRelease(block); return; }
      changeBlockState(block, this.pressedState, false);
      block.dimension.playSound("random.click", block.location, { pitch: 0.7, volume: 0.3 });
    }, RELEASE_DELAY);
  }
}
