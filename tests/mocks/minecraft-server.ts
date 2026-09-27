// Mock mínimo de @minecraft/server para rodar a lógica dos scripts no Node.
// Qualquer acesso não previsto devolve um "coringa" que aceita chamada, construção e leitura.
const handler: ProxyHandler<any> = {
	get: (target, prop) => (prop in target ? target[prop] : (prop === Symbol.toPrimitive ? () => 0 : prop === "then" ? undefined : wildcard())),
	apply: () => wildcard(),
	construct: () => wildcard(),
};
export function wildcard(extra: Record<PropertyKey, unknown> = {}): any {
	return new Proxy(Object.assign(function () { }, extra), handler);
}

export const state = { timeOfDay: 6000, moonPhase: 0 };

export const world = wildcard({
	getTimeOfDay: () => state.timeOfDay,
	getMoonPhase: () => state.moonPhase,
});
export const system = wildcard();

const classMock = () => wildcard({ prototype: {} });
export const Block = classMock(), BlockPermutation = classMock(), BlockVolume = classMock(), Dimension = classMock(),
	Entity = classMock(), EntityInventoryComponent = classMock(), ItemStack = classMock(), Player = classMock(),
	StructureManager = classMock(), EnchantmentType = classMock(), EnchantmentTypes = classMock();

export const WeatherType = { Clear: "Clear", Rain: "Rain", Thunder: "Thunder" };
export const GameMode = { Adventure: "Adventure", Creative: "Creative", Spectator: "Spectator", Survival: "Survival" };
export const MoonPhase = { FullMoon: 0, WaningGibbous: 1, FirstQuarter: 2, WaningCrescent: 3, NewMoon: 4, WaxingCrescent: 5, LastQuarter: 6, WaxingGibbous: 7 };
export const CommandPermissionLevel = { Any: 0, GameDirectors: 1, Admin: 2, Host: 3, Owner: 4 };
export const CustomCommandParamType = { Boolean: 0, Integer: 1, Float: 2, String: 3 };
export const CustomCommandStatus = { Success: 0, Failure: 1 };
// Frente "entidades" (scripts/entity): entrada de botões do jogador.
export const InputButton = { Jump: "Jump", Sneak: "Sneak" };
export const ButtonState = { Pressed: "Pressed", Released: "Released" };
// Frente "batalha-minimizavel": último tipo de entrada do jogador (player.inputInfo.lastInputModeUsed).
export const InputMode = { Gamepad: "Gamepad", KeyboardAndMouse: "KeyboardAndMouse", MotionController: "MotionController", Touch: "Touch" };
// Frente "batalha-minimizavel": origem do /cobblemon:battleui.
export const CustomCommandSource = { Block: "Block", Entity: "Entity", NPCDialogue: "NPCDialogue", Server: "Server" };
// Frente "social" (scripts/npc, scripts/trade): item na mão do jogador (q.player.main_held_item).
export const EquipmentSlot = { Chest: "Chest", Feet: "Feet", Head: "Head", Legs: "Legs", Mainhand: "Mainhand", Offhand: "Offhand" };
// Frente "mundo-máquinas" (importa a Pokédex e a batalha).
export const EntityComponentTypes = wildcard();
// Frente "motor" (scripts/world, montaria): permissões de entrada e rotação de estrutura.
export const InputPermissionCategory = { Camera: 1, Movement: 2, LateralMovement: 4, Sneak: 5, Jump: 6, Mount: 7, Dismount: 8, MoveForward: 9, MoveBackward: 10, MoveLeft: 11, MoveRight: 12 };
export const StructureRotation = { None: "None", Rotate90: "Rotate90", Rotate180: "Rotate180", Rotate270: "Rotate270" };
// Frente "animacao" (scripts/battle/effects): variáveis Molang das partículas.
export const MolangVariableMap = classMock();
// Frente telas (estúdio de câmera e scanner).
export const HudElement = { PaperDoll: 0, Armor: 1, ToolTips: 2, TouchControls: 3, Crosshair: 4, Hotbar: 5, Health: 6, ProgressBar: 7, Hunger: 8, AirBubbles: 9, HorseHealth: 10, StatusEffects: 11, ItemText: 12 };
export const HudVisibility = { Hide: 0, Reset: 1 };
export const EasingType = { Linear: "Linear", InOutSine: "InOutSine", OutQuad: "OutQuad", InQuad: "InQuad" };
// Frente "visual-batalha" (scripts/battle/DebugVisual.ts): origem do scriptevent.
export const ScriptEventSource = { Block: "Block", Entity: "Entity", NPCDialogue: "NPCDialogue", Server: "Server" };
// Frente "mundo-detalhes" (vasos/apricorn/raio): faces de bloco e causas de dano.
export const Direction = { Down: "Down", East: "East", North: "North", South: "South", Up: "Up", West: "West" };
export const EntityDamageCause = { fireTick: "fireTick", freezing: "freezing", lightning: "lightning", contact: "contact" };
// Pesquisa 8 (scripts/experimental/limits): esquema de controle, splines de câmera e texto por jogador.
export const ControlScheme = { CameraRelative: "CameraRelative", CameraRelativeStrafe: "CameraRelativeStrafe", LockedPlayerRelativeStrafe: "LockedPlayerRelativeStrafe", PlayerRelative: "PlayerRelative", PlayerRelativeStrafe: "PlayerRelativeStrafe" };
export class LinearSpline { controlPoints: unknown[] = []; }
export class TextPrimitive { visibleTo: unknown[] = []; attachedTo?: unknown; depthTest = false; constructor(public location: unknown, public text: unknown) { } remove() { } }
// Frente "limites-b" (scripts/limitesB/vanillaStructures.ts): registro de tipos de bloco (todo id existe no mock).
export const BlockTypes = { get: (id: string) => ({ id }), getAll: () => [] };
// Frente msd-infra: detecção do pack Mega Showdown (ItemTypes.get do item marcador); sem o pack, undefined.
export const ItemTypes = { get: (_id: string): unknown => undefined, getAll: (): unknown[] => [] };
// Frente "review-fixes-3" (enfermeira: zumbificação/cura; mental_restoration: causa do spawn).
export const EntityInitializationCause = { Born: "Born", Event: "Event", Loaded: "Loaded", Spawned: "Spawned", Transformed: "Transformed" };
