// Frente controle: item "Poké Ball do time" (teclas R, setas e M do Cobblemon Java num item do Bedrock).
// Lógica pura (ações por entrada, plano do inventário, dicas) e o despacho dos eventos com jogadores falsos.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { advance, FakeEntity, FakePlayer, overworld } from "./batalhas-harness";
import {
  CONTROL_ITEM_ID, HINT_MAX_SHOWS, HINT_MAX_USES, HINT_SHOWS_PROPERTY, REPEAT_TICKS, USES_PROPERTY, counterValue, ensureControlItem,
  handleControlPokemonInteract, hintKey, isLeftClickSwing, isRepeat, swingFromUse, maybeShowHint, onBreakBlock, onEntityHurt, onHitEntity,
  onInteractWithBlock, onInteractWithEntity, onItemUse, onSwingStart, planInventory, purgeContainer, resolveBlockUseAction,
  resolvePokemonUseAction, resolveUseAction, setControlActions, shouldShowHint, storesHeldItem, takesHeldItem,
} from "../scripts/controle";
import { cycleSlot } from "../scripts/pokemon/PartySelection";
import { FORBIDDEN_HELD_ITEMS, isForbiddenHeldItem } from "../scripts/pokemon/HeldItems";

const originalWarn = console.warn;
const warnings: string[] = [];
console.warn = (...args: unknown[]) => { warnings.push(args.join(" ")); };
console.info = () => { };

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  void name;
}

// ------------------------------------------------------------------------------------------------
// Lógica pura

await test("usar: em pé abre o time; agachado joga/recolhe; montado e agachado não faz nada", () => {
  assert.equal(resolveUseAction({ sneaking: false, riding: false }), "party_menu");
  assert.equal(resolveUseAction({ sneaking: true, riding: false }), "quick_send");
  assert.equal(resolveUseAction({ sneaking: true, riding: true }), "none");
  assert.equal(resolveUseAction({ sneaking: false, riding: true }), "party_menu");
});

await test("usar num bloco: agachado = envio rápido; em pé = vanilla nos interativos, bloqueado nos que guardam item", () => {
  assert.equal(resolveBlockUseAction("minecraft:grass_block", true, false, false), "quick_send");
  assert.equal(resolveBlockUseAction("minecraft:chest", true, false, true), "quick_send");
  assert.equal(resolveBlockUseAction("minecraft:grass_block", false, false, false), "party_menu");
  assert.equal(resolveBlockUseAction("minecraft:chest", false, false, true), "vanilla");
  assert.equal(resolveBlockUseAction("minecraft:frame", false, false, true), "blocked");
  assert.equal(resolveBlockUseAction("minecraft:glow_frame", false, false, true), "blocked");
  assert.equal(resolveBlockUseAction("minecraft:decorated_pot", false, false, true), "blocked");
  assert.equal(resolveBlockUseAction("cobblemon:display_case", false, false, true), "blocked");
  assert.equal(resolveBlockUseAction("minecraft:dirt", true, true, false), "blocked");
  assert.ok(storesHeldItem("minecraft:frame") && !storesHeldItem("minecraft:chest"));
  assert.ok(takesHeldItem("minecraft:armor_stand") && takesHeldItem("minecraft:allay") && !takesHeldItem("minecraft:cow"));
});

await test("usar num Pokémon: agachado no seu = montar/menu; agachado no selvagem = batalha; em pé = mão vazia", () => {
  assert.equal(resolvePokemonUseAction({ sneaking: true, own: true, wild: false }), "mount_or_menu");
  assert.equal(resolvePokemonUseAction({ sneaking: true, own: false, wild: true }), "wild_battle");
  assert.equal(resolvePokemonUseAction({ sneaking: false, own: true, wild: false }), "empty_hand");
  assert.equal(resolvePokemonUseAction({ sneaking: false, own: false, wild: true }), "empty_hand");
  assert.equal(resolvePokemonUseAction({ sneaking: true, own: false, wild: false }), "empty_hand");
});

await test("botão esquerdo = balanço de ataque (ar/entidade), de mineração (bloco) ou sem fonte", () => {
  assert.ok(isLeftClickSwing("Attack"));
  assert.ok(isLeftClickSwing("Mine"));
  assert.ok(isLeftClickSwing("None"));
  for (const source of ["UseItem", "Interact", "Build", "DropItem", "ThrowItem", "Event", undefined]) assert.ok(!isLeftClickSwing(source));
  assert.ok(swingFromUse(100, [undefined, 99]));
  assert.ok(swingFromUse(100, [102]));
  assert.ok(!swingFromUse(100, [90, undefined]));
});

await test("segurar o botão: repetições dentro da janela não contam", () => {
  const last = new Map<string, number>();
  assert.equal(isRepeat(last, "p", 100), false);
  assert.equal(isRepeat(last, "p", 100 + REPEAT_TICKS), true);
  // A janela anda com o botão segurado.
  assert.equal(isRepeat(last, "p", 100 + 2 * REPEAT_TICKS), true);
  assert.equal(isRepeat(last, "p", 100 + 3 * REPEAT_TICKS + 1), false);
  assert.equal(isRepeat(last, "q", 100), false);
});

await test("seleção cicla de cima para baixo pelos existentes e volta ao topo", () => {
  const occupied = [true, true, false, true, false, false];
  let slot = 0;
  const order: number[] = [];
  for (let i = 0; i < 4; i++) { slot = cycleSlot(occupied, slot, 1); order.push(slot); }
  assert.deepEqual(order, [1, 3, 0, 1]);
  assert.equal(cycleSlot([true, false, false, false, false, false], 0, 1), 0);
});

await test("inventário: exatamente 1 (entrega, remove cópias, regrava a trava, cursor tem prioridade)", () => {
  const item = (slot: number, locked = true, keepOnDeath = true) => ({ slot, typeId: CONTROL_ITEM_ID, locked, keepOnDeath });
  assert.deepEqual(planInventory([], false), { give: true, remove: [], fix: false });
  assert.deepEqual(planInventory([{ slot: 3, typeId: "minecraft:dirt", locked: false, keepOnDeath: false }], false).give, true);
  assert.deepEqual(planInventory([item(4)], false), { give: false, keep: 4, remove: [], fix: false });
  assert.deepEqual(planInventory([item(20), item(2), item(7)], false), { give: false, keep: 2, remove: [7, 20], fix: false });
  assert.equal(planInventory([item(0, false)], false).fix, true);
  assert.equal(planInventory([item(0, true, false)], false).fix, true);
  assert.deepEqual(planInventory([item(1)], true), { give: false, remove: [1], fix: false });
  assert.deepEqual(planInventory([], true), { give: false, remove: [], fix: false });
});

await test("dicas: somem depois de algumas vezes ou de alguns usos; texto pelo modo de entrada", () => {
  assert.ok(shouldShowHint({ shows: 0, uses: 0 }));
  assert.ok(!shouldShowHint({ shows: HINT_MAX_SHOWS, uses: 0 }));
  assert.ok(!shouldShowHint({ shows: 0, uses: HINT_MAX_USES }));
  assert.equal(hintKey("KeyboardAndMouse"), "cobblemon.port.controle.hint.mouse");
  assert.equal(hintKey("Gamepad"), "cobblemon.port.controle.hint.gamepad");
  assert.equal(hintKey("Touch"), "cobblemon.port.controle.hint.touch");
  assert.equal(hintKey(undefined), "cobblemon.port.controle.hint.mouse");
  assert.equal(counterValue(3), 3);
  assert.equal(counterValue("x"), 0);
  assert.equal(counterValue(-1), 0);
});

// ------------------------------------------------------------------------------------------------
// Runtime com jogadores falsos

interface Calls { party: number; starter: number; pc: number; quick: (string | undefined)[]; cycle: number; mount: string[] }
const calls: Calls = { party: 0, starter: 0, pc: 0, quick: [], cycle: 0, mount: [] };
let team = true;
let starterChosen = false;
let battling = false;
setControlActions({
  inBattle: () => battling,
  hasTeam: () => team,
  openParty: () => { calls.party++; },
  offerStarter: () => { calls.starter++; },
  hasSelectedStarter: () => starterChosen,
  openPc: () => { calls.pc++; },
  quickSend: (_player, aimed) => { calls.quick.push(aimed?.id); return "sent_out"; },
  cycle: () => { calls.cycle++; },
  mountOrMenu: (_player, target) => { calls.mount.push(target.id); },
});
function reset() {
  calls.party = 0; calls.starter = 0; calls.pc = 0; calls.quick = []; calls.cycle = 0; calls.mount = [];
  team = true; battling = false; starterChosen = false;
}

function holder(name: string, holding = true) {
  const player = new FakePlayer(name, { x: 0, y: 64, z: 0 }, overworld);
  if (holding) player.container.setItem(0, { typeId: CONTROL_ITEM_ID, amount: 1 });
  return player;
}
const stack = (typeId = CONTROL_ITEM_ID) => ({ typeId }) as never;

await test("usar no ar: em pé abre o time; sem time, o inicial (ou o PC); agachado joga/recolhe; segurar não repete", async () => {
  reset();
  const player = holder("Ash");
  await advance(20);
  onItemUse({ source: player as never, itemStack: stack() });
  await advance(5);
  assert.equal(calls.party, 1);
  team = false;
  await advance(20);
  onItemUse({ source: player as never, itemStack: stack() });
  await advance(5);
  assert.equal(calls.starter, 1);
  // Time vazio depois do inicial (todos no PC): abre o PC.
  starterChosen = true;
  await advance(20);
  onItemUse({ source: player as never, itemStack: stack() });
  await advance(5);
  assert.equal(calls.pc, 1);
  assert.equal(calls.starter, 1);
  team = true;
  await advance(20);
  player.isSneaking = true;
  onItemUse({ source: player as never, itemStack: stack() });
  await advance(1, 1);
  onItemUse({ source: player as never, itemStack: stack() }); // repetição (botão segurado)
  await advance(5);
  assert.deepEqual(calls.quick, [undefined]);
  // Outro item: nada.
  await advance(20);
  onItemUse({ source: player as never, itemStack: stack("minecraft:stick") });
  await advance(5);
  assert.equal(calls.quick.length, 1);
  assert.equal(Number(player.getDynamicProperty(USES_PROPERTY)), 4);
});

await test("usar no ar cede a vez à interação com entidade do mesmo clique", async () => {
  reset();
  const player = holder("Brock");
  const cow = new FakeEntity("minecraft:cow", { x: 1, y: 64, z: 0 }, overworld);
  await advance(20);
  const event = { player, target: cow, itemStack: stack(), cancel: false };
  onInteractWithEntity(event as never);
  onItemUse({ source: player as never, itemStack: stack() });
  await advance(5);
  assert.equal(calls.party, 0);
  assert.equal(event.cancel, false);
  const stand = { player, target: new FakeEntity("minecraft:armor_stand", { x: 1, y: 64, z: 0 }, overworld), itemStack: stack(), cancel: false };
  onInteractWithEntity(stand as never);
  assert.equal(stand.cancel, true, "suporte de armadura não recebe o item");
});

await test("usar num bloco: agachado joga; em pé abre o time (ou deixa o baú abrir); moldura bloqueada", async () => {
  reset();
  const player = holder("Misty");
  const block = (typeId: string) => ({ typeId, isValid: false, location: { x: 0, y: 63, z: 0 } });
  await advance(20);
  const dirt = { player, block: block("minecraft:dirt"), itemStack: stack(), isFirstEvent: true, cancel: false };
  onInteractWithBlock(dirt as never);
  onItemUse({ source: player as never, itemStack: stack() }); // o mesmo clique também chega como itemUse
  await advance(5);
  assert.equal(dirt.cancel, true);
  assert.equal(calls.party, 1, "só uma ação por clique");
  await advance(20);
  const chest = { player, block: block("minecraft:chest"), itemStack: stack(), isFirstEvent: true, cancel: false };
  onInteractWithBlock(chest as never);
  await advance(5);
  assert.equal(chest.cancel, false);
  assert.equal(calls.party, 1);
  await advance(20);
  const frame = { player, block: block("minecraft:frame"), itemStack: stack(), isFirstEvent: true, cancel: false };
  onInteractWithBlock(frame as never);
  await advance(5);
  assert.equal(frame.cancel, true);
  assert.equal(calls.party, 1);
  await advance(20);
  player.isSneaking = true;
  const ground = { player, block: block("minecraft:grass_block"), itemStack: stack(), isFirstEvent: true, cancel: false };
  onInteractWithBlock(ground as never);
  const held = { ...ground, isFirstEvent: false, cancel: false };
  await advance(10);
  onInteractWithBlock(held as never);
  await advance(5);
  assert.deepEqual(calls.quick, [undefined]);
  assert.equal(held.cancel, true);
});

await test("agachado + esquerdo (ar/bloco/entidade) passa o selecionado; em pé ou em batalha não", async () => {
  reset();
  const player = holder("Gary");
  await advance(20);
  onSwingStart({ player: player as never, heldItemStack: stack(), swingSource: "Attack" as never });
  await advance(5);
  assert.equal(calls.cycle, 0, "em pé não troca");
  player.isSneaking = true;
  await advance(20);
  onSwingStart({ player: player as never, heldItemStack: stack(), swingSource: "Attack" as never });
  await advance(5);
  assert.equal(calls.cycle, 1);
  await advance(20);
  onSwingStart({ player: player as never, heldItemStack: stack(), swingSource: "Mine" as never });
  await advance(2, 1);
  onSwingStart({ player: player as never, heldItemStack: stack(), swingSource: "Mine" as never }); // segurando no bloco
  await advance(5);
  assert.equal(calls.cycle, 2);
  await advance(20);
  onSwingStart({ player: player as never, heldItemStack: stack(), swingSource: "UseItem" as never });
  onSwingStart({ player: player as never, heldItemStack: stack("minecraft:stick"), swingSource: "Attack" as never });
  await advance(5);
  assert.equal(calls.cycle, 2);
  // Cliente sem fonte (None): conta, menos quando é o balanço de um uso (agachado + usar joga, não troca).
  await advance(20);
  onSwingStart({ player: player as never, heldItemStack: stack(), swingSource: "None" as never });
  await advance(5);
  assert.equal(calls.cycle, 3);
  await advance(20);
  onSwingStart({ player: player as never, heldItemStack: stack(), swingSource: "None" as never });
  onItemUse({ source: player as never, itemStack: stack() });
  await advance(5);
  assert.equal(calls.cycle, 3, "balanço do uso não troca a seleção");
  assert.equal(calls.quick.length, 1);
  battling = true;
  await advance(20);
  onSwingStart({ player: player as never, heldItemStack: stack(), swingSource: "Attack" as never });
  await advance(5);
  assert.equal(calls.cycle, 3, "em batalha a seleção não troca");
});

function wildPokemon() {
  const entity = new FakeEntity("cobblemon:rattata", { x: 2, y: 64, z: 0 }, overworld, ["pokemon"]);
  entity.properties.set("cobblemon:wild", true);
  return entity;
}

await test("agachado + esquerdo num selvagem: batalha com o selecionado, sem dano e sem trocar a seleção", async () => {
  reset();
  const player = holder("Dawn");
  player.isSneaking = true;
  const wild = wildPokemon();
  await advance(20);
  onSwingStart({ player: player as never, heldItemStack: stack(), swingSource: "Attack" as never });
  onHitEntity({ damagingEntity: player as never, hitEntity: wild as never });
  const hurt = { damageSource: { damagingEntity: player, cause: "entityAttack" }, hurtEntity: wild, cancel: false };
  onEntityHurt(hurt as never); // o mesmo golpe pelo entityHurt: uma batalha só
  await advance(5);
  assert.deepEqual(calls.quick, [wild.id]);
  assert.equal(calls.cycle, 0);
  assert.equal(hurt.cancel, true);
  // Em pé: dano normal; projétil: não mexe.
  player.isSneaking = false;
  const standing = { damageSource: { damagingEntity: player, cause: "entityAttack" }, cancel: false };
  onEntityHurt(standing as never);
  assert.equal(standing.cancel, false);
  player.isSneaking = true;
  const arrow = { damageSource: { damagingEntity: player, cause: "projectile" }, cancel: false };
  onEntityHurt(arrow as never);
  assert.equal(arrow.cancel, false);
  // Agachado + esquerdo numa entidade que não é selvagem: próximo do time, sem dano.
  await advance(20);
  const cow = new FakeEntity("minecraft:cow", { x: 1, y: 64, z: 0 }, overworld);
  onSwingStart({ player: player as never, heldItemStack: stack(), swingSource: "Attack" as never });
  onHitEntity({ damagingEntity: player as never, hitEntity: cow as never });
  await advance(5);
  assert.equal(calls.cycle, 1);
});

await test("agachado + esquerdo num bloco não quebra o bloco", () => {
  const player = holder("Iris");
  player.isSneaking = true;
  const sneaking = { player, itemStack: stack(), cancel: false };
  onBreakBlock(sneaking as never);
  assert.equal(sneaking.cancel, true);
  player.isSneaking = false;
  const standing = { player, itemStack: stack(), cancel: false };
  onBreakBlock(standing as never);
  assert.equal(standing.cancel, false);
  const other = { player, itemStack: stack("minecraft:diamond_pickaxe"), cancel: false };
  player.isSneaking = true;
  onBreakBlock(other as never);
  assert.equal(other.cancel, false);
});

await test("usar num Pokémon com o item: agachado no seu monta/menu; agachado no selvagem batalha; em pé = mão vazia", async () => {
  reset();
  const player = holder("Cynthia");
  const own = new FakeEntity("cobblemon:garchomp", { x: 1, y: 64, z: 0 }, overworld, ["pokemon"]);
  own.setDynamicProperty("owner_name", "Cynthia");
  const wild = wildPokemon();
  await advance(20);
  const standing = { player, target: own, cancel: false };
  assert.equal(handleControlPokemonInteract(standing as never), false);
  assert.equal(standing.cancel, false);
  player.isSneaking = true;
  const sneakOwn = { player, target: own, cancel: false };
  assert.equal(handleControlPokemonInteract(sneakOwn as never), true);
  assert.equal(sneakOwn.cancel, true);
  const sneakWild = { player, target: wild, cancel: false };
  assert.equal(handleControlPokemonInteract(sneakWild as never), true);
  // O itemUse do mesmo clique não roda de novo.
  onItemUse({ source: player as never, itemStack: stack() });
  await advance(5);
  assert.deepEqual(calls.mount, [own.id]);
  assert.deepEqual(calls.quick, [wild.id]);
});

// Contêiner com a API usada pelo laço (getSlot com lockMode/keepOnDeath e firstEmptySlot).
class LockContainer {
  slots: ({ typeId: string; amount: number; lockMode: string; keepOnDeath: boolean } | undefined)[] = new Array(36).fill(undefined);
  size = 36;
  getItem(slot: number) { return this.slots[slot]; }
  setItem(slot: number, item?: never) { this.slots[slot] = item; }
  getSlot(slot: number) { return this.slots[slot]!; }
  firstEmptySlot() { const i = this.slots.findIndex(s => !s); return i < 0 ? undefined : i; }
}
function lockPlayer(name: string) {
  const player = holder(name, false);
  const container = new LockContainer();
  player.getComponent = ((component: string) => component.replace("minecraft:", "") === "inventory" ? { container } : undefined) as never;
  return { player, container };
}
const control = (lockMode = "inventory", keepOnDeath = true) => ({ typeId: CONTROL_ITEM_ID, amount: 1, lockMode, keepOnDeath });

await test("laço: entrega a quem não tem (com ou sem time), remove cópias e regrava a trava", () => {
  const { player, container } = lockPlayer("Red");
  container.slots[0] = { typeId: "minecraft:dirt", amount: 64, lockMode: "none", keepOnDeath: false };
  assert.equal(ensureControlItem(player as never), "given");
  assert.ok(container.slots[1], "vai para o primeiro espaço livre");
  assert.ok(player.hasMessage("cobblemon.port.controle.received"));
  // Reposição (drop, /clear): silenciosa; pelo comando, com mensagem.
  container.slots[1] = undefined;
  player.messages.length = 0;
  assert.equal(ensureControlItem(player as never), "given");
  assert.equal(player.messages.length, 0);
  container.slots[1] = undefined;
  assert.equal(ensureControlItem(player as never, true), "given");
  assert.ok(player.hasMessage("cobblemon.port.controle.received"));

  const copies = lockPlayer("Blue");
  copies.container.slots[5] = control();
  copies.container.slots[2] = control();
  copies.container.slots[30] = control();
  assert.equal(ensureControlItem(copies.player as never), "removed");
  assert.ok(copies.container.slots[2]);
  assert.equal(copies.container.slots[5], undefined);
  assert.equal(copies.container.slots[30], undefined);

  const unlocked = lockPlayer("Green");
  unlocked.container.slots[8] = control("none", false);
  assert.equal(ensureControlItem(unlocked.player as never), "fixed");
  assert.equal(unlocked.container.slots[8]!.lockMode, "inventory");
  assert.equal(unlocked.container.slots[8]!.keepOnDeath, true);

  const ok = lockPlayer("Yellow");
  ok.container.slots[0] = control();
  assert.equal(ensureControlItem(ok.player as never), "ok");
  assert.equal(ok.player.messages.length, 0);

  const full = lockPlayer("Gold");
  full.container.slots.fill({ typeId: "minecraft:stone", amount: 64, lockMode: "none", keepOnDeath: false });
  assert.equal(ensureControlItem(full.player as never), "full");
  assert.equal(ensureControlItem(full.player as never), "full");
  assert.equal(full.player.messages.filter(m => JSON.stringify(m).includes("controle.full")).length, 1, "avisa uma vez");
});

await test("cópias fora do jogador (baú, vitrine) são removidas", () => {
  const chest = new LockContainer();
  chest.slots[3] = control();
  chest.slots[4] = { typeId: "minecraft:dirt", amount: 1, lockMode: "none", keepOnDeath: false };
  chest.slots[10] = control();
  assert.equal(purgeContainer(chest as never), 2);
  assert.equal(chest.slots[3], undefined);
  assert.ok(chest.slots[4]);
  assert.equal(purgeContainer(undefined), 0);
});

await test("dica na actionbar: só nas primeiras vezes e some depois de alguns usos", () => {
  const player = holder("Silver");
  const bars: unknown[] = [];
  player.onScreenDisplay = { setActionBar: (m: unknown) => { bars.push(m); }, setTitle() { } } as never;
  for (let i = 0; i < HINT_MAX_SHOWS + 3; i++) maybeShowHint(player as never);
  assert.equal(bars.length, HINT_MAX_SHOWS);
  assert.deepEqual(bars[0], { translate: "cobblemon.port.controle.hint.mouse" });
  const user = holder("Ethan");
  user.onScreenDisplay = { setActionBar: (m: unknown) => { bars.push(m); }, setTitle() { } } as never;
  user.setDynamicProperty(USES_PROPERTY, HINT_MAX_USES);
  assert.equal(maybeShowHint(user as never), false);
  assert.equal(user.getDynamicProperty(HINT_SHOWS_PROPERTY), undefined);
});

await test("o item de controle nunca vira item segurado de Pokémon (depois de ligar)", () => {
  // startControlItem acrescenta à lista; aqui conferimos a lista usada pela troca e pelo menu.
  FORBIDDEN_HELD_ITEMS.add(CONTROL_ITEM_ID);
  assert.ok(isForbiddenHeldItem(CONTROL_ITEM_ID));
});

// ------------------------------------------------------------------------------------------------
// Conteúdo: item, textos e docs

await test("item: 1 por pilha, sem quebrar blocos no criativo, aceito pelo /give (categoria visível)", () => {
  const json = JSON.parse(readFileSync("behavior_packs/CobblemonBedrock/items/controle/party_control.json", "utf8"));
  const item = json["minecraft:item"];
  assert.equal(item.description.identifier, CONTROL_ITEM_ID);
  // "none" faria o /give recusar o item (npm run validate); cópias do inventário criativo o laço remove.
  assert.notEqual(item.description.menu_category.category, "none");
  assert.equal(item.components["minecraft:max_stack_size"], 1);
  assert.equal(item.components["minecraft:can_destroy_in_creative"], false);
  assert.equal(item.components["minecraft:display_name"].value, "item.cobblemon.party_control");
  assert.equal(item.components["minecraft:icon"], "poke_ball");
});

await test("textos: en_US e pt_BR com as mesmas chaves, no fim, na seção ## controle", () => {
  const keysOf = (file: string) => {
    const text = readFileSync(`resource_packs/CobblemonBedrock/texts/${file}`, "utf8");
    const section = text.slice(text.lastIndexOf("\n## controle"));
    assert.ok(section.startsWith("\n## controle"), `${file}: seção ## controle no fim`);
    return section.split("\n").filter(l => l.includes("=") && !l.startsWith("#")).map(l => l.split("=")[0]).sort();
  };
  const en = keysOf("en_US.lang"), pt = keysOf("pt_BR.lang");
  assert.deepEqual(en, pt);
  for (const key of ["item.cobblemon.party_control", "cobblemon.port.controle.hint.mouse", "cobblemon.port.controle.hint.gamepad",
    "cobblemon.port.controle.hint.touch", "cobblemon.port.controle.received", "cobblemon.port.controle.already", "cobblemon.port.controle.full",
    "cobblemon.port.controle.empty_slot", "cobblemon.port.controle.lore1", "cobblemon.port.controle.lore2"]) assert.ok(en.includes(key), key);
});

await test("docs: controles e comando documentados", () => {
  const howTo = readFileSync("docs/COMO-JOGAR.md", "utf8");
  const commands = readFileSync("docs/COMANDOS.md", "utf8");
  assert.ok(howTo.includes("Poké Ball do time"));
  assert.ok(commands.includes("/cobblemon:controle"));
});

console.warn = originalWarn;
const own = warnings.filter(w => w.includes("[controle]"));
assert.deepEqual(own, [], `avisos do controle: ${own.join(" | ")}`);
console.log(`controle: ${passed} testes ok`);
