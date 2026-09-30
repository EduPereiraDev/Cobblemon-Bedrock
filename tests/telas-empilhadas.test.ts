// Telas empilhadas (docs/pendencias/telas-empilhadas.md): o menu do Infernape aparecia com todos os layouts do
// roteador do JSON UI ao mesmo tempo. Causa: o título "Infernape" começa com "Inf", que o JSON UI lê como número
// (infinito); o `-`/`=` de string do roteador deixa de valer. A guarda põe "§r" na frente dos títulos sem marcador.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RawMessage } from "@minecraft/server";
import { TITLE_GUARD, guardFormTitle, installFormTitleGuard } from "../scripts/ui/formTitleGuard";
import { SCREEN, withScreen } from "../scripts/ui/screens";
import { SUB, layoutTitle } from "../scripts/GUI/layout";
import { formHooks } from "@minecraft/server-ui";
import { createPlayer, flush } from "./batalhas-harness";
import { PokemonData } from "../scripts/Pokemon";
import { showPokemonMenuFromEntity } from "../scripts/GUI/Party";

const ROOT = process.cwd();
const TEXTS = join(ROOT, "generated", "resource_packs", "CobblemonBedrock", "texts");

/** Regra do parser numérico do JSON UI (tipo strtod: espaço, sinal, dígito, ".5", "inf", "nan"). */
const numericPrefix = (s: string) => /^\s*[+-]?(inf|nan|\d|\.\d)/i.test(s);

function loadLang(file: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!existsSync(file)) return map;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0 && !line.startsWith("#")) map.set(line.slice(0, i), line.slice(i + 1).replace(/\t#.*$/, ""));
  }
  return map;
}

/** Texto que o cliente põe em #title_text (translate resolvido; códigos § continuam na string). */
function resolve(value: string | RawMessage, lang: Map<string, string>): string {
  if (typeof value === "string") return value;
  let out = value.text ?? "";
  if (value.translate !== undefined) out += lang.get(value.translate) ?? value.translate;
  if (value.rawtext) out += value.rawtext.map(part => resolve(part, lang)).join("");
  return out;
}

// ---------------------------------------------------------------------------------------------
// 1. Reprodução: o título do menu do Pokémon (Party.ts: pokemon.getTranslatedName()) para o Infernape

const langs = ["en_US.lang", "pt_BR.lang"].map(f => loadLang(join(TEXTS, f))).filter(m => m.size > 0);
{
  const infernape: RawMessage = { translate: "cobblemon.species.infernape.name" };
  for (const lang of langs) {
    assert.equal(lang.get("cobblemon.species.infernape.name"), "Infernape");
    assert.ok(numericPrefix(resolve(infernape, lang)), "sem a guarda, o título do Infernape é lido como número (bug do cliente)");
    const guarded = resolve(guardFormTitle(infernape), lang);
    assert.equal(guarded, `${TITLE_GUARD}Infernape`);
    assert.ok(!numericPrefix(guarded), "com a guarda, o título é texto");
  }
}

// ---------------------------------------------------------------------------------------------
// 2. Nenhum nome de espécie nem de golpe (títulos de menus e da tela de golpe) vira número com a guarda

{
  let numeric = 0;
  for (const lang of langs) {
    for (const [key, value] of lang) {
      if (!/^cobblemon\.(species\.[a-z0-9_]+\.name|move\.[a-z0-9_]+)$/.test(key)) continue;
      if (numericPrefix(value)) numeric++;
      assert.ok(!numericPrefix(resolve(guardFormTitle({ translate: key }), lang)), `${key}=${value}`);
    }
  }
  // Infernape (2 línguas) e "10,000,000 Volt Thunderbolt" pelo menos: o teste precisa enxergar casos reais.
  if (langs.length) assert.ok(numeric >= 2, `casos numéricos reais encontrados: ${numeric}`);
}

// ---------------------------------------------------------------------------------------------
// 3. Formas de título: texto e RawMessage; marcados e já coloridos ficam iguais

{
  assert.equal(guardFormTitle("Infernape"), "§rInfernape");
  assert.equal(guardFormTitle("007"), "§r007");
  assert.equal(guardFormTitle("  nan"), "§r  nan");
  assert.equal(guardFormTitle("§aVerde"), "§aVerde", "já começa com §");
  assert.deepEqual(guardFormTitle({ text: "Nancy" }), { rawtext: [{ text: "§r" }, { text: "Nancy" }] });
  assert.deepEqual(guardFormTitle({ rawtext: [{ translate: "cobblemon.ui.moves" }, { text: " - " }] }),
    { rawtext: [{ text: "§r" }, { rawtext: [{ translate: "cobblemon.ui.moves" }, { text: " - " }] }] });
  // Títulos roteados (withScreen/layoutTitle) começam pelo marcador: nada muda (o roteador continua achando o layout).
  for (const marker of Object.values(SCREEN)) {
    const marked = withScreen(marker, "Infernape");
    assert.equal(guardFormTitle(marked), marked, `marcador ${JSON.stringify(marker)} intacto`);
  }
  const summary = layoutTitle(SCREEN.SUMMARY, SUB.SUMMARY_INFO, { translate: "cobblemon.species.infernape.name" });
  assert.equal(guardFormTitle(summary), summary);
  // Idempotente.
  const once = guardFormTitle({ translate: "cobblemon.species.infernape.name" });
  assert.equal(guardFormTitle(once), once);
}

// ---------------------------------------------------------------------------------------------
// 4. Instalação: envolve title() uma vez por classe e passa o título protegido

{
  const seen: unknown[] = [];
  class FakeForm {
    title(title: string | RawMessage) { seen.push(title); return this; }
  }
  class Broken { }
  assert.equal(installFormTitleGuard({ FakeForm }), true);
  assert.equal(installFormTitleGuard({ FakeForm }), true, "segunda instalação não envolve de novo");
  const form = new FakeForm();
  assert.equal(form.title({ translate: "cobblemon.species.infernape.name" }), form, "encadeável como antes");
  assert.deepEqual(seen, [{ rawtext: [{ text: "§r" }, { translate: "cobblemon.species.infernape.name" }] }], "uma chamada só (sem dupla guarda)");
  assert.equal(installFormTitleGuard({ Broken }), false, "classe sem title(): avisa e segue");
}

// ---------------------------------------------------------------------------------------------
// 5. O main instala a guarda no carregamento, antes de qualquer tela

{
  const main = readFileSync(join(ROOT, "scripts", "main.ts"), "utf8");
  const call = main.search(/^installFormTitleGuard\(\);/m);
  assert.ok(call > 0, "main.ts chama installFormTitleGuard() no topo do módulo");
  assert.ok(call < main.search(/^world\.|^system\./m), "antes de assinar eventos");
}

// ---------------------------------------------------------------------------------------------
// 6. Um menu do Pokémon por vez: cliques repetidos no Pokémon (antes de a tela aparecer) não empilham menus

{
  const infernape = PokemonData.generateNewWildPokemon("infernape", { level: 38, shiny: false });
  const player = createPlayer("Stack", [infernape]);
  const pending: ((value: unknown) => void)[] = [];
  let shows = 0;
  formHooks.show = () => { shows++; return new Promise(resolve => pending.push(resolve)); };
  const first = showPokemonMenuFromEntity(player as never, infernape.uuid);
  for (let i = 0; i < 4; i++) void showPokemonMenuFromEntity(player as never, infernape.uuid);
  await flush();
  assert.equal(shows, 1, `5 cliques com o menu aberto: ${shows} menus (esperado 1)`);
  // Fechar (X) libera: o próximo clique abre de novo.
  pending.shift()!({ canceled: true, selection: undefined });
  await first;
  const again = showPokemonMenuFromEntity(player as never, infernape.uuid);
  await flush();
  assert.equal(shows, 2, "depois de fechar, um clique abre o menu de novo");
  pending.shift()!({ canceled: true, selection: undefined });
  await again;
  // Erro na tela (jogador saiu: FormRejectError) também libera.
  formHooks.show = () => { shows++; return Promise.reject(new Error("FormRejectError")); };
  await showPokemonMenuFromEntity(player as never, infernape.uuid).catch(() => { });
  formHooks.show = () => { shows++; return { canceled: true, selection: undefined }; };
  await showPokemonMenuFromEntity(player as never, infernape.uuid);
  assert.equal(shows, 4, "depois de um erro, o menu volta a abrir");
  formHooks.show = undefined;
}

console.log("telas-empilhadas: ok");
