// Frente ui-cliente: correções do 1º teste em cliente real (Windows, Bedrock 26.x).
//  1. Regras do carregador de JSON UI do cliente (tools/ui/uiRules.mjs) sobre TODOS os ui/*.json: item de controls
//     sem nome, controle sem tipo, collection_name fora de coleção, collection_index sem pai de coleção. O content log
//     do cliente mostrou ~11.700 "Type not specified" e ~7.500 "Unknown property" nas telas roteadas.
//  2. Layouts: células dentro de collection_panel, com rótulo #form_button_text e ícone #form_button_texture nomeados.
//  3. HUD: nenhum campo chega ao JSON UI só com dígitos (o cliente vira número e o texto/caminho some).
//  4. Poké Ball: usar mirando um Pokémon arremessa (playerInteractWithEntity → throwPokeBall).
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
// @ts-ignore módulo .mjs sem tipos (compartilhado com tools/check-ui-baseline.mjs)
import { COLLECTION_TYPES, checkUiRules } from "../tools/ui/uiRules.mjs";
import { generate } from "../tools/ui/gen-telas";
import {
  BATTLE_HEAD_FIELDS, BATTLE_MOVE_FIELDS, BATTLE_TILE_FIELDS, CHANNEL, NUM_LEAD, PARTY_FIELDS, TOAST_FIELDS, battleHpText, encodeBattleBody,
  encodePartyBody, encodeToastBody, fieldOffsets, header, HEADER_BYTES,
} from "../scripts/ui/hudProtocol";
import { pokeBallFromItem, shouldThrowOnEntityInteract, throwOrigin, throwPokeBall, throwVelocity } from "../scripts/catching/ThrowBall";

const ROOT = process.cwd();
const UI = join(ROOT, "resource_packs", "CobblemonBedrock", "ui");
type Json = Record<string, any>;

/** JSON com comentários // e /* *\/ fora de strings (como o Bedrock aceita). */
function parseJsonc(text: string): Json {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === "\\") { out += text[++i] ?? ""; continue; }
      if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") { inString = true; out += ch; continue; }
    if (ch === "/" && text[i + 1] === "/") { while (i < text.length && text[i] !== "\n") i++; out += "\n"; continue; }
    if (ch === "/" && text[i + 1] === "*") { i += 2; while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++; i++; continue; }
    out += ch;
  }
  return JSON.parse(out.replace(/^﻿/, "").replace(/,(\s*[}\]])/g, "$1"));
}

const files = new Map<string, Json>(
  readdirSync(UI).filter(f => f.endsWith(".json") && f !== "_ui_defs.json").map(f => [f, parseJsonc(readFileSync(join(UI, f), "utf8"))]),
);

// ---------------------------------------------------------------------------------------------
// 1. Regras do cliente

{
  const errors: string[] = checkUiRules(files);
  assert.deepEqual(errors, [], `regras do cliente:\n${errors.slice(0, 20).join("\n")}`);
  // O verificador pega exatamente os erros do content log (versão antiga dos layouts).
  const broken = new Map<string, Json>([["broken.json", {
    namespace: "broken",
    screen: {
      type: "panel",
      collection_name: "form_buttons",
      controls: [
        { cell_0: { type: "panel", collection_index: 0, controls: [{ type: "label", text: "#form_button_text" }] } },
        { "hit@broken.missing": {} },
      ],
    },
  }]]);
  const found: string[] = checkUiRules(broken);
  assert.ok(found.some(e => e.includes("Unknown property [collection_name]")), "collection_name em panel");
  assert.ok(found.some(e => e.includes("Unknown property [collection_index]")), "collection_index sob panel");
  assert.ok(found.some(e => e.includes("item de controls sem nome")), "controle sem nome");
  assert.ok(found.some(e => e.includes("Type not specified")), "@base inexistente");
  const fixed: string[] = checkUiRules(new Map([["ok.json", {
    namespace: "ok",
    screen: {
      type: "collection_panel",
      collection_name: "form_buttons",
      controls: [{ cell_0: { type: "panel", collection_index: 0, controls: [{ label_0: { type: "label", text: "#form_button_text" } }] } }],
    },
  }]]));
  assert.deepEqual(fixed, []);
  assert.ok(COLLECTION_TYPES.includes("collection_panel") && !COLLECTION_TYPES.includes("panel"));
}

// ---------------------------------------------------------------------------------------------
// 2. Layouts gerados: células em collection_panel, filhos nomeados que leem o botão

/** Todas as células (controles com collection_index) com o tipo do pai. */
function cells(node: unknown, out: { key: string; value: Json; parentType: string }[] = []): typeof out {
  if (Array.isArray(node)) { node.forEach(n => cells(n, out)); return out; }
  if (!node || typeof node !== "object") return out;
  const obj = node as Json;
  for (const el of Array.isArray(obj.controls) ? obj.controls : []) {
    for (const [key, value] of Object.entries(el as Json)) if (value && typeof value === "object" && "collection_index" in value) out.push({ key, value, parentType: obj.type });
  }
  for (const [key, value] of Object.entries(obj)) if (key !== "bindings") cells(value, out);
  return out;
}

{
  const generated = generate();
  for (const [name, content] of Object.entries(generated)) assert.equal(readFileSync(join(UI, name), "utf8"), content, `${name} em dia`);
  let total = 0;
  for (const name of ["battle.json", "summary.json", "starter.json", "pokedex.json", "pc.json"]) {
    const found = cells(files.get(name));
    assert.ok(found.length > 5, `${name}: células`);
    for (const c of found) assert.equal(c.parentType, "collection_panel", `${name}/${c.key}: pai collection_panel`);
    total += found.length;
  }
  assert.ok(total > 250, `células no total: ${total}`);
  // Tile de ação da batalha: fundo = ícone do botão (quadro de cima), rótulo = texto do botão, clique com índice.
  const battle = files.get("battle.json")!;
  const tile = battle.action_layout.controls[0].tiles.controls.find((c: Json) => c.cell_0).cell_0;
  const children = tile.controls.map((c: Json) => Object.entries(c)[0]) as [string, Json][];
  const label = children.find(([, v]) => v.type === "label");
  const image = children.find(([, v]) => v.type === "image");
  assert.ok(label && label[1].text === "#form_button_text" && JSON.stringify(label[1].bindings).includes("\"binding_type\":\"collection\""), "rótulo do botão");
  assert.ok(image && JSON.stringify(image[1].bindings).includes("#form_button_texture"), "ícone do botão");
  assert.ok(children.some(([k]) => k === "hit@common.button"), "clique");
}

// ---------------------------------------------------------------------------------------------
// 3. HUD: nada só com dígitos

{
  const digitsOnly = (s: string) => /^\d+$/.test(s);
  const decode = (text: string, fields: typeof PARTY_FIELDS, base: number) => {
    const bytes = Buffer.from(text, "utf8");
    const offsets = fieldOffsets(fields, base);
    return Object.fromEntries(fields.map(f => [f.name, bytes.subarray(offsets[f.name], offsets[f.name] + f.bytes).toString("utf8").replace(/\t/g, "")]));
  };
  const party = header(CHANNEL.PARTY, 0) + encodePartyBody([
    { kind: "a", texture: "textures/cobblemon/portraits/bulbasaur_0", name: "Bulbasaur", level: 31, hpRatio: 1, expRatio: 0.5, gender: "m", ball: "poke_ball", expGained: 120, levelUp: true },
  ]);
  const slot = decode(party, PARTY_FIELDS, HEADER_BYTES);
  assert.equal(slot.lvl, "§r31", "nível com §r (texto, não número)");
  assert.equal(slot.hp, `${NUM_LEAD}18`);
  assert.equal(slot.lu, `${NUM_LEAD}1`);
  for (const [name, value] of Object.entries(slot)) assert.ok(!digitsOnly(value), `party.${name} = ${value}`);
  const battle = header(CHANNEL.BATTLE, 0) + encodeBattleBody({
    slotsPerActor: 1, left: [{ name: "Pikachu", level: 5, hpRatio: 0.5, hpText: battleHpText(10, 20, true), owned: true }], right: [],
    ui: { minimised: true, prompt: 3, cursor: 2, moves: [{ id: "thunderbolt", type: "electric", pp: "15/24", usable: true }] },
  });
  for (const [name, value] of Object.entries(decode(battle, BATTLE_HEAD_FIELDS, HEADER_BYTES))) assert.ok(!digitsOnly(value), `head.${name} = ${value}`);
  const headBytes = BATTLE_HEAD_FIELDS.reduce((a, f) => a + f.bytes, 0);
  for (const [name, value] of Object.entries(decode(battle, BATTLE_TILE_FIELDS, HEADER_BYTES + headBytes))) assert.ok(!digitsOnly(value), `tile.${name} = ${value}`);
  const tileBytes = BATTLE_TILE_FIELDS.reduce((a, f) => a + f.bytes, 0);
  for (const [name, value] of Object.entries(decode(battle, BATTLE_MOVE_FIELDS, HEADER_BYTES + headBytes + 6 * tileBytes))) assert.ok(!digitsOnly(value), `move.${name} = ${value}`);
  const toast = header(CHANNEL.TOAST, 0) + encodeToastBody({ frame: "t", color: "y", line1: "a", line2: "b" });
  for (const [name, value] of Object.entries(decode(toast, TOAST_FIELDS, HEADER_BYTES))) assert.ok(!digitsOnly(value), `toast.${name} = ${value}`);
  // O JSON UI nunca compara com um literal só de dígitos, e os caminhos das barras juntam `hp_v` + `_NN`.
  const hud = readFileSync(join(UI, "cobblemon_hud.json"), "utf8");
  assert.ok(!/= '\d+'\)/.test(hud), "comparação com literal numérico no HUD");
  assert.ok(hud.includes("hud/hp_v' + #hp") && hud.includes("hud/exp_v' + #exp") && hud.includes("hud/hp_h' + #hpw"), "caminhos das barras com o prefixo no valor");
}

// ---------------------------------------------------------------------------------------------
// 4. Poké Ball arremessa ao usar mirando um Pokémon

{
  assert.equal(pokeBallFromItem("cobblemon:great_ball")?.name, "great_ball");
  assert.equal(pokeBallFromItem("cobblemon:ancient_jet_ball")?.name, "ancient_jet_ball");
  assert.equal(pokeBallFromItem("cobblemon:pokedex_red"), undefined);
  assert.equal(pokeBallFromItem("minecraft:snowball"), undefined);
  assert.equal(pokeBallFromItem(undefined), undefined);

  const pokemon = { sneaking: false, isPokemon: true };
  assert.equal(shouldThrowOnEntityInteract("cobblemon:poke_ball", pokemon), true, "selvagem/qualquer Pokémon: arremessa");
  assert.equal(shouldThrowOnEntityInteract("cobblemon:poke_ball", { ...pokemon, sneaking: true }), false, "agachado: roda de interação/dar item");
  assert.equal(shouldThrowOnEntityInteract("cobblemon:poke_ball", { ...pokemon, isBattleClone: true }), false, "clone de batalha");
  assert.equal(shouldThrowOnEntityInteract("cobblemon:poke_ball", { ...pokemon, isNpcModel: true }), false, "exibição de NPC");
  assert.equal(shouldThrowOnEntityInteract("cobblemon:poke_ball", { ...pokemon, isPokemon: false }), false, "não é Pokémon");
  assert.equal(shouldThrowOnEntityInteract("cobblemon:oran_berry", pokemon), false, "outro item: interação normal");
  assert.equal(shouldThrowOnEntityInteract(undefined, pokemon), false, "mão vazia");

  const v = throwVelocity({ x: 0, y: 0, z: 2 }, 1.5);
  assert.deepEqual(v, { x: 0, y: 0, z: 1.5 }, "direção normalizada × potência");
  const o = throwOrigin({ x: 0, y: 1.6, z: 0 }, { x: 1, y: 0, z: 0 });
  assert.ok(Math.abs(o.x - 0.6) < 1e-9 && Math.abs(o.y - 1.5) < 1e-9, "sai à frente dos olhos");

  // Jogador falso: slot selecionado com 3 bolas.
  const makePlayer = (mode: string, typeId = "cobblemon:ultra_ball") => {
    const stack = { typeId, amount: 3 };
    const slot = {
      item: stack as { typeId: string; amount: number } | undefined,
      getItem() { return this.item; },
      set amount(n: number) { if (this.item) this.item.amount = n; },
      setItem(i: undefined) { this.item = i; },
    };
    const spawned: { id: string; location: unknown; owner?: unknown; velocity?: unknown; props: Record<string, unknown> }[] = [];
    const player: any = {
      id: "p1",
      selectedSlotIndex: 0,
      getComponent: (id: string) => id === "minecraft:inventory" ? { container: { getSlot: () => slot } } : undefined,
      getViewDirection: () => ({ x: 0, y: 0, z: 1 }),
      getHeadLocation: () => ({ x: 10, y: 65.6, z: 10 }),
      getGameMode: () => mode,
      dimension: {
        spawnEntity(id: string, location: unknown) {
          const record: (typeof spawned)[number] = { id, location, props: {} };
          spawned.push(record);
          return {
            setDynamicProperty: (k: string, val: unknown) => { record.props[k] = val; },
            getComponent: (c: string) => c === "minecraft:projectile" ? {
              set owner(p: unknown) { record.owner = p; },
              shoot: (vel: unknown) => { record.velocity = vel; },
            } : undefined,
          };
        },
      },
    };
    return { player, slot, spawned };
  };
  const survival = makePlayer("Survival");
  assert.equal(throwPokeBall(survival.player, "cobblemon:ultra_ball"), true);
  assert.equal(survival.spawned.length, 1);
  assert.equal(survival.spawned[0].id, "cobblemon:ultra_ball", "o mesmo projétil do throwable nativo");
  assert.equal(survival.spawned[0].owner, survival.player, "dono = quem arremessou");
  assert.equal(survival.spawned[0].props.player_id, "p1");
  assert.deepEqual(survival.spawned[0].velocity, { x: 0, y: 0, z: 1.5 }, "potência do minecraft:projectile (1,25 × 1,2)");
  assert.equal(survival.slot.item?.amount, 2, "consome 1 no sobrevivência");
  const creative = makePlayer("Creative");
  assert.equal(throwPokeBall(creative.player, "cobblemon:ultra_ball"), true);
  assert.equal(creative.slot.item?.amount, 3, "criativo não consome");
  const swapped = makePlayer("Survival", "cobblemon:poke_ball");
  assert.equal(throwPokeBall(swapped.player, "cobblemon:ultra_ball"), false, "trocou de item antes do tick: não arremessa");
  assert.equal(swapped.spawned.length, 0);
  const last = makePlayer("Survival");
  last.slot.item!.amount = 1;
  assert.equal(throwPokeBall(last.player, "cobblemon:ultra_ball"), true);
  assert.equal(last.slot.item, undefined, "última bola sai do slot");
}

console.log("ui-cliente: ok");
