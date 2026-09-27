/** Componentes de bloco da frente "mundo-plantas" (berries, cultivos, saccharine, tumblestone, construção). */
import { BlockCustomComponent, system, world } from "@minecraft/server";
import { EnforceBottomHalfComponent, EnforceTopHalfComponent } from "../DoubleBlockComponents";
import { BerryBushComponent } from "./berry";
import {
	ActivatableDecorationComponent, FenceGateInWallComponent, GenericSlabComponent, refreshNeighbours, StackableItemBlockComponent, StairsShapeComponent,
} from "./building";
import { CROP_RULES, CropComponent, GalaricaNutBushComponent, HeartyGrainsComponent, RevivalHerbComponent } from "./crops";
import { TumblestoneComponent, TypeGemClusterComponent, TypeGemCoreComponent } from "./gems";
import { RootComponent } from "./roots";
import { LeavesDecayComponent, SaccharineLeavesComponent, SaccharineLogSlatheredComponent, SaccharineSaplingComponent, SaccharineStripComponent } from "./saccharine";

export { PLANT_ITEM_COMPONENTS } from "./mulch";

export const PLANT_BLOCK_COMPONENTS: Record<string, BlockCustomComponent> = {
	// Berries e cultivos
	"cobblemon:berry_bush": new BerryBushComponent(),
	"cobblemon:mint_crop": new CropComponent(CROP_RULES.mint),
	"cobblemon:vivichoke_crop": new CropComponent(CROP_RULES.vivichoke),
	"cobblemon:revival_herb": new RevivalHerbComponent(),
	"cobblemon:medicinal_leek": new CropComponent(CROP_RULES.medicinal_leek),
	"cobblemon:galarica_nut_bush": new GalaricaNutBushComponent(),
	"cobblemon:hearty_grains": new HeartyGrainsComponent(),
	"cobblemon:big_root": new RootComponent(),
	"cobblemon:energy_root": new RootComponent(),
	// Minerais que crescem
	"cobblemon:tumblestone": new TumblestoneComponent(),
	"cobblemon:type_gem_cluster": new TypeGemClusterComponent(),
	"cobblemon:type_gem_core": new TypeGemCoreComponent(),
	// Saccharine
	"cobblemon:leaves_decay": new LeavesDecayComponent(),
	"cobblemon:saccharine_leaves": new SaccharineLeavesComponent(),
	"cobblemon:saccharine_sapling": new SaccharineSaplingComponent(),
	"cobblemon:saccharine_log_slathered": new SaccharineLogSlatheredComponent(),
	"cobblemon:strip_saccharine_log": new SaccharineStripComponent("cobblemon:stripped_saccharine_log"),
	"cobblemon:strip_saccharine_wood": new SaccharineStripComponent("cobblemon:stripped_saccharine_wood"),
	"cobblemon:saccharine_door_enforce_top_component": new EnforceTopHalfComponent("cobblemon:saccharine_door_top_left", "minecraft:cardinal_direction", "cobblemon:opened"),
	"cobblemon:saccharine_door_enforce_bottom_component": new EnforceBottomHalfComponent("cobblemon:saccharine_door_bottom_left", "minecraft:cardinal_direction", "cobblemon:opened"),
	// Construção e decoração
	"cobblemon:slab_component": new GenericSlabComponent(),
	"cobblemon:stairs_shape": new StairsShapeComponent(),
	"cobblemon:fence_gate_in_wall": new FenceGateInWallComponent(),
	"cobblemon:stackable_item_block": new StackableItemBlockComponent(),
	"cobblemon:activatable_decoration": new ActivatableDecorationComponent(),
};

/**
 * O Bedrock não avisa blocos vizinhos: quando o jogador coloca/quebra qualquer bloco (ex.: escada
 * vanilla ao lado de uma nossa, muro ao lado de um portão), recalculamos escadas e portões em volta.
 * Assinado fora do early execution.
 */
system.run(() => {
	try {
		world.afterEvents.playerPlaceBlock.subscribe((event) => refreshNeighbours(event.block));
		world.afterEvents.playerBreakBlock.subscribe((event) => refreshNeighbours(event.block));
	} catch { /* ambiente sem mundo (testes) */ }
});
