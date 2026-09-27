import { Block, BlockComponentPlayerInteractEvent, BlockCustomComponent, system } from "@minecraft/server";
import { BlockUtils } from "../utils";

/**
 * Botões do Cobblemon (ButtonBlock / EjectButtonBlock). O sinal de redstone vem do JSON do bloco: a permutação
 * `cobblemon:pressed` = true tem `minecraft:redstone_producer` (behavior_packs/.../blocks/cobblemon/*_button.json,
 * mesclado por cima do bloco gerado). Aqui só se controla o estado, o tempo e o som.
 */
export interface ButtonSpec {
  /** Ticks pressionado (BlockSetType: madeira 30, Eject Button 40). */
  ticks: number;
  /** Flechas também apertam (só botões de madeira, como no Java). */
  arrows: boolean;
  soundOn: string;
  soundOff: string;
}

const WOODEN: ButtonSpec = { ticks: 30, arrows: true, soundOn: "click_on.cherry_wood_button", soundOff: "click_off.cherry_wood_button" };
/** EjectButtonBlock: ButtonBlock(BlockSetType.IRON, 40). */
const EJECT: ButtonSpec = { ticks: 40, arrows: false, soundOn: "random.click", soundOff: "random.click" };

export const BUTTON_SPECS: Record<string, ButtonSpec> = {
  "cobblemon:apricorn_button": WOODEN,
  "cobblemon:saccharine_button": WOODEN,
  "cobblemon:eject_button": EJECT,
};

export function buttonSpec(typeId: string): ButtonSpec {
  return BUTTON_SPECS[typeId] ?? WOODEN;
}

/** Aperta o botão (se solto) e agenda a volta; devolve false se já estava apertado. */
export function pressButton(block: Block, pressedState = "cobblemon:pressed"): boolean {
  if (block.permutation.getState(pressedState as never) === true) return false;
  const spec = buttonSpec(block.typeId);
  const typeId = block.typeId;
  BlockUtils.changeBlockState(block, pressedState, true);
  block.dimension.playSound(spec.soundOn, block.location, { pitch: 0.6 });
  system.runTimeout(() => {
    if (block.isValid && block.typeId === typeId) {
      BlockUtils.changeBlockState(block, pressedState, false);
      block.dimension.playSound(spec.soundOff, block.location, { pitch: 0.5 });
    }
  }, spec.ticks);
  return true;
}

export default class ButtonCompnent implements BlockCustomComponent {
  constructor(
    public pressedState = "cobblemon:pressed"
  ) { }
  onPlayerInteract(arg: BlockComponentPlayerInteractEvent) {
    pressButton(arg.block, this.pressedState);
  }
}
