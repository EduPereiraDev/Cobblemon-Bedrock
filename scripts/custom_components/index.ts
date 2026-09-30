//https://learn.microsoft.com/en-us/minecraft/creator/documents/customcomponents?view=minecraft-bedrock-stable
import { BlockCustomComponent, ItemCustomComponent, StartupEvent } from "@minecraft/server";
import { PCBottomComponent, PCTopComponent } from "./PCComponents";
import { EnforceTopHalfComponent, EnforceBottomHalfComponent } from "./DoubleBlockComponents";
import DoorComponent from "./DoorComponent"
import HealingMachineComponent from "./HealingMachineComponent";
import GiveLeftoversComponent from "./GiveLeftoversComponent";
import StripLogComponent from "./StripLogComponent";
import DropExpRewardComponent from "./DropExpRewardComponent";
import PlantComponent from "./PlantComponent";
import ApricornGeneratedComponent from "./ApricornGeneratedComponent";
import SaplingComponent, { perBedrockRandomTick } from "./SaplingComponent";

/** ApricornBlock.randomTick: `nextInt(5) == 0` por tick aleatório do Java (idade 0..3). */
const APRICORN_GROW_CHANCE = perBedrockRandomTick(1 / 5);
import LeavesDecayComponent from "./LeavesDecayComponent";
import SlabComponent from "./SlabComponent";
import PressurePlateComponent from "./PressurePlateComponent";
import ButtonComponent from "./ButtonComponent";
import CannotFloatComponent from "./CannotFloatComponent";
import DripstoneGrowthComponent from "./DripstoneGrowthComponent"; // frente mundo-detalhes
// Redstone por projétil (Ring Target, flechas nos botões de madeira): assina o evento de mundo ao carregar.
import "./RedstoneEvents";
import { PLANT_BLOCK_COMPONENTS, PLANT_ITEM_COMPONENTS } from "./plants";
import { MACHINE_BLOCK_COMPONENTS } from "./machines";
import { ITEM_CUSTOM_COMPONENTS } from "../items/components";
import { FISHING_ITEM_COMPONENTS } from "../fishing/components";

const blockComponents: Record<string, BlockCustomComponent> = {
  "cobblemon:pc_bottom_component": new PCBottomComponent(),
  "cobblemon:pc_top_component": new PCTopComponent(),
  "cobblemon:healing_machine_component": new HealingMachineComponent(),
  "cobblemon:give_xp_reward_component": new DropExpRewardComponent(),
  "cobblemon:strip_apricorn_log": new StripLogComponent("cobblemon:stripped_apricorn_log"),
  "cobblemon:strip_apricorn_wood": new StripLogComponent("cobblemon:stripped_apricorn_wood"),
  "cobblemon:enforce_pc_top_half_component": new EnforceTopHalfComponent("cobblemon:pc_top", "minecraft:cardinal_direction"),
  "cobblemon:enforce_pc_bottom_half_component": new EnforceBottomHalfComponent("cobblemon:pc", "minecraft:cardinal_direction"),
  "cobblemon:black_apricorn_growth_component": new PlantComponent("blocks/apricorns/black_apricorn", APRICORN_GROW_CHANCE),
  "cobblemon:blue_apricorn_growth_component": new PlantComponent("blocks/apricorns/blue_apricorn", APRICORN_GROW_CHANCE),
  "cobblemon:green_apricorn_growth_component": new PlantComponent("blocks/apricorns/green_apricorn", APRICORN_GROW_CHANCE),
  "cobblemon:pink_apricorn_growth_component": new PlantComponent("blocks/apricorns/pink_apricorn", APRICORN_GROW_CHANCE),
  "cobblemon:red_apricorn_growth_component": new PlantComponent("blocks/apricorns/red_apricorn", APRICORN_GROW_CHANCE),
  "cobblemon:white_apricorn_growth_component": new PlantComponent("blocks/apricorns/white_apricorn", APRICORN_GROW_CHANCE),
  "cobblemon:yellow_apricorn_growth_component": new PlantComponent("blocks/apricorns/yellow_apricorn", APRICORN_GROW_CHANCE),
  "cobblemon:apricorn_generated_component": new ApricornGeneratedComponent(),
  "cobblemon:black_apricorn_seed_component": new SaplingComponent("cobblemon:black_apricorn_tree"),
  "cobblemon:blue_apricorn_seed_component": new SaplingComponent("cobblemon:blue_apricorn_tree"),
  "cobblemon:green_apricorn_seed_component": new SaplingComponent("cobblemon:green_apricorn_tree"),
  "cobblemon:pink_apricorn_seed_component": new SaplingComponent("cobblemon:pink_apricorn_tree"),
  "cobblemon:red_apricorn_seed_component": new SaplingComponent("cobblemon:red_apricorn_tree"),
  "cobblemon:white_apricorn_seed_component": new SaplingComponent("cobblemon:white_apricorn_tree"),
  "cobblemon:yellow_apricorn_seed_component": new SaplingComponent("cobblemon:yellow_apricorn_tree"),
  "cobblemon:apricorn_leaves_component": new LeavesDecayComponent("cobblemon:apricorn_leaves", "empty"),
  "cobblemon:apricorn_slab_component": new SlabComponent("cobblemon:apricorn_slab", "dig.wood"),
  "cobblemon:pressure_plate_component": new PressurePlateComponent(),
  "cobblemon:button_component": new ButtonComponent(),
  "cobblemon:cannot_float_component": new CannotFloatComponent(),
  "cobblemon:dripstone_growable": new DripstoneGrowthComponent(),
  "cobblemon:door_component": new DoorComponent(),
  "cobblemon:apricorn_door_enforce_top_component": new EnforceTopHalfComponent("cobblemon:apricorn_door_top_left", "minecraft:cardinal_direction", "cobblemon:opened"),
  "cobblemon:apricorn_door_enforce_bottom_component": new EnforceBottomHalfComponent("cobblemon:apricorn_door_bottom_left", "minecraft:cardinal_direction", "cobblemon:opened")
}

const itemComponents: Record<string, ItemCustomComponent> = {
  "cobblemon:give_leftovers_component": new GiveLeftoversComponent()
}

// Cada frente registra os próprios componentes no seu arquivo; aqui só juntamos.
Object.assign(blockComponents, PLANT_BLOCK_COMPONENTS, MACHINE_BLOCK_COMPONENTS);
Object.assign(itemComponents, ITEM_CUSTOM_COMPONENTS, FISHING_ITEM_COMPONENTS, PLANT_ITEM_COMPONENTS);

export function registerCustomComponents(event: StartupEvent) {
  Object.keys(blockComponents).forEach(key => {
    event.blockComponentRegistry.registerCustomComponent(key, workAroundBlockWrapper(key));
  })
  Object.entries(itemComponents).forEach(([key, value]) => {
    event.itemComponentRegistry.registerCustomComponent(key, value);
  })
}

const blockCallbacks = ["beforeOnPlayerPlace", "onBreak", "onEntityFallOn", "onPlace", "onPlayerBreak", "onPlayerInteract", "onRandomTick", "onRedstoneUpdate", "onStepOff", "onStepOn", "onTick"] as const;

/** Attempts to work around wierd bug where Component cannot make refrences to itself */
function workAroundBlockWrapper(key: string): BlockCustomComponent {
  const component = blockComponents[key] as Record<string, unknown>;
  const returnObj: Record<string, unknown> = {};
  for (const callback of blockCallbacks) {
    if (typeof component[callback] === "function")
      returnObj[callback] = (arg: unknown, params: unknown) => (component[callback] as Function).call(component, arg, params);
  }
  return returnObj as BlockCustomComponent;
}
