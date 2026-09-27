// Frente "retratos": tabela gerada (generated/scripts/portraits.ts), arquivos PNG gerados e a escolha do ícone
// nas telas (getPokemonSpriteTexture/getPokemonProfileTexture com PokemonData.variant).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { VARIANTS, resolveVariant } from "../generated/scripts/variants";
import { hasPortrait, portraitIconTexture, portraitTexture, profileTexture } from "../generated/scripts/portraits";
import { getPokemonProfileTexture, getPokemonSpriteTexture } from "../scripts/GUI/common";
import { PokemonData } from "../scripts/Pokemon";

const RP = join(process.cwd(), "generated", "resource_packs", "CobblemonBedrock");

/** Largura, altura e fração de pixels com alfa > 0 (PNG RGBA 8 bits sem entrelaçamento, como o importador grava). */
function pngCoverage(file: string): { w: number; h: number; coverage: number } {
  const buf = readFileSync(file);
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  assert.equal(buf[25], 6, `${file}: esperava RGBA`);
  const idat: Buffer[] = [];
  for (let pos = 8; pos + 8 <= buf.length;) {
    const len = buf.readUInt32BE(pos);
    if (buf.toString("latin1", pos + 4, pos + 8) === "IDAT") idat.push(buf.subarray(pos + 8, pos + 8 + len));
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  let covered = 0;
  // O encoder do importador usa filtro 0 em todas as linhas: o alfa é o byte cru.
  for (let y = 0; y < h; y++) {
    assert.equal(raw[y * (stride + 1)], 0, `${file}: filtro inesperado`);
    for (let x = 0; x < w; x++) if (raw[y * (stride + 1) + 1 + x * 4 + 3] > 0) covered++;
  }
  return { w, h, coverage: covered / (w * h) };
}

// ---------------------------------------------------------------------------------------------
// 1. Todo variant de toda espécie resolve para PNGs existentes (retrato 64, ícone 32, perfil 128).

{
  let variants = 0;
  for (const [sp, entry] of Object.entries(VARIANTS)) {
    assert.ok(hasPortrait(sp), `sem retrato: ${sp}`);
    entry.combos.forEach((_, v) => {
      variants++;
      for (const tex of [portraitTexture(sp, v), portraitIconTexture(sp, v), profileTexture(sp, v)])
        assert.ok(existsSync(join(RP, `${tex}.png`)), `${sp}#${v}: falta ${tex}.png`);
    });
  }
  assert.ok(variants > 7000, `esperava ~7.800 variants, veio ${variants}`);
  // Variant fora da faixa (ou negativo) cai na imagem 0, nunca num arquivo inexistente.
  assert.equal(portraitTexture("gyarados", 9999), portraitTexture("gyarados", 0));
  assert.equal(portraitTexture("gyarados", -1), portraitTexture("gyarados", 0));
  assert.equal(portraitTexture("naoexiste", 3), "textures/cobblemon/portraits/naoexiste_0");
  assert.equal(hasPortrait("naoexiste"), false);
}

// ---------------------------------------------------------------------------------------------
// 2. Tamanhos e cobertura: nenhum retrato vazio ou fora do quadro.

{
  const check = (dir: string, size: number, minCoverage: number) => {
    const files = readdirSync(join(RP, dir)).filter((f) => f.endsWith(".png"));
    assert.ok(files.length > 800, `${dir}: poucos arquivos (${files.length})`);
    let low = 0;
    for (const f of files) {
      const { w, h, coverage } = pngCoverage(join(RP, dir, f));
      assert.equal(w, size, `${dir}/${f}: largura`);
      assert.equal(h, size, `${dir}/${f}: altura`);
      if (coverage < minCoverage) low++;
    }
    assert.equal(low, 0, `${dir}: ${low} imagens com cobertura < ${minCoverage * 100}%`);
    return files.length;
  };
  check("textures/cobblemon/portraits", 64, 0.15);
  check("textures/cobblemon/portrait_icons", 32, 0.15);
  check("textures/cobblemon/profiles", 128, 0.02);
}

// ---------------------------------------------------------------------------------------------
// 3. Variante visual: shiny, forma regional e gênero escolhem imagens diferentes da base.

{
  const base = resolveVariant("gyarados", []);
  const shiny = resolveVariant("gyarados", ["shiny"]);
  assert.notEqual(portraitTexture("gyarados", shiny), portraitTexture("gyarados", base), "Gyarados shiny tem retrato próprio");
  assert.notEqual(profileTexture("gyarados", shiny), profileTexture("gyarados", base), "Gyarados shiny tem perfil próprio");
  // O olho de Alfa não entra no retrato: mesma imagem do combo sem ele.
  assert.equal(portraitTexture("gyarados", resolveVariant("gyarados", ["shiny", "alpha_eyes"])), portraitTexture("gyarados", shiny));
  assert.notEqual(portraitTexture("vulpix", resolveVariant("vulpix", ["alolan"])), portraitTexture("vulpix", 0), "Vulpix de Alola");
  assert.notEqual(portraitTexture("eevee", resolveVariant("eevee", ["female"])), portraitTexture("eevee", 0), "Eevee fêmea (modelo próprio)");
  // A cauda da Pikachu fêmea não aparece no rosto: mesma imagem (dedupe por conteúdo).
  assert.equal(portraitTexture("pikachu", resolveVariant("pikachu", ["female"])), portraitTexture("pikachu", 0));
  // Perfil só tem o recorte base + shiny + formas: a fêmea usa o perfil do macho equivalente.
  assert.equal(profileTexture("pikachu", resolveVariant("pikachu", ["female", "shiny"])), profileTexture("pikachu", resolveVariant("pikachu", ["shiny"])));
  // Todo par shiny × normal com textura diferente tem retrato OU perfil diferente, salvo texturas que só
  // mudam em partes cobertas por camadas/escondidas no enquadramento (lista fechada, conferida na folha).
  const hiddenDiff = new Set(["komala", "tinkatuff", "gimmighoul", "electrode"]);
  let pairs = 0;
  for (const [sp, entry] of Object.entries(VARIANTS)) {
    entry.combos.forEach((c, i) => {
      if (!c.texture.includes("shiny") || hiddenDiff.has(sp)) return;
      const strip = (s: string) => s.replace(/_shiny/g, "");
      const j = entry.combos.findIndex((o) => !o.texture.includes("shiny") && o.model === c.model && o.poser === c.poser && strip(o.texture) === strip(c.texture) && strip(o.layers.join()) === strip(c.layers.join()));
      if (j < 0) return;
      pairs++;
      const same = portraitTexture(sp, i) === portraitTexture(sp, j) && profileTexture(sp, i) === profileTexture(sp, j);
      assert.ok(!same, `${sp}#${i}: shiny com a mesma imagem do normal #${j}`);
    });
  }
  assert.ok(pairs > 3000, `pares shiny verificados: ${pairs}`);
}

// ---------------------------------------------------------------------------------------------
// 4. Telas: getPokemonSpriteTexture aceita espécie (variant 0 ou explícito) ou o PokemonData (usa o variant dele).

{
  assert.equal(getPokemonSpriteTexture("gyarados"), portraitTexture("gyarados", 0));
  assert.equal(getPokemonSpriteTexture("Mr. Mime"), portraitTexture("mrmime", 0), "nome de exibição vira id");
  const shinyIndex = resolveVariant("gyarados", ["shiny"]);
  assert.equal(getPokemonSpriteTexture("gyarados", shinyIndex), portraitTexture("gyarados", shinyIndex));
  const mon = PokemonData.generateNewWildPokemon("gyarados", { level: 20, shiny: true });
  // O gênero é sorteado: o variant pode ser o shiny macho ou fêmea, mas a textura é sempre a shiny.
  assert.ok(VARIANTS.gyarados.combos[mon.variant].texture.includes("shiny"), "o PokemonData shiny guarda um variant shiny");
  assert.equal(getPokemonSpriteTexture(mon), portraitTexture("gyarados", mon.variant));
  assert.notEqual(getPokemonSpriteTexture(mon), portraitTexture("gyarados", 0));
  assert.equal(getPokemonProfileTexture(mon), profileTexture("gyarados", mon.variant));
  // Espécie sem retrato: sprite antigo.
  assert.equal(getPokemonSpriteTexture("Missingno"), "textures/sprites/missingno");
}

console.log("retratos: ok");
