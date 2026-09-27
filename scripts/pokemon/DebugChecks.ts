/**
 * Conferência no servidor da frente "jogabilidade" (sem jogador): `scriptevent cobblemon:debug_jogabilidade [teste]`.
 * Roda no spawn do mundo e escreve o resultado no console (`[jogabilidade] ...`). Testes: `all` (padrão), `alpha`,
 * `honey`, `shiny`, `evolution`, `fullness`, `gamerules`, `features`.
 */
import { BlockPermutation, Dimension, Entity, Vector3, system, world } from "@minecraft/server";
import { PokemonData } from "../Pokemon";
import { getGameRules } from "../Config";
import { dropAlphaRewards } from "./AlphaRewards";
import { getMaxFullness, getMetabolismRate, feedPokemon } from "./Fullness";
import { handleStashItem, getIntFeature, shearTail, tailRegrowthSeconds } from "./SpeciesFeatures";
import { SLATHERED_LOG, attachHoneyInfluences, registerSlatheredLog } from "../spawning/HoneyLog";
import { initializeEvolutions } from "../evolution";
import { SHINY_TAG } from "../Pokemon";

const log = (text: string) => console.info(`[jogabilidade] ${text}`);

function spawnPoint(dimension: Dimension): Vector3 | undefined {
  const spawn = world.getDefaultSpawnLocation();
  const probe = { x: spawn.x, y: 64, z: spawn.z };
  if (!dimension.isChunkLoaded(probe)) return undefined;
  const top = dimension.getTopmostBlock({ x: spawn.x, z: spawn.z });
  return { x: spawn.x + 0.5, y: (top?.y ?? 64) + 1, z: spawn.z + 0.5 };
}

function spawnPokemon(dimension: Dimension, at: Vector3, data: PokemonData): Entity {
  const entity = dimension.spawnEntity(data.getEntityId(), at);
  data.applyToCobblemon(entity);
  entity.setProperty("cobblemon:wild", true);
  return entity;
}

function itemsNear(dimension: Dimension, at: Vector3): string[] {
  return dimension.getEntities({ type: "minecraft:item", location: at, maxDistance: 4 })
    .map(e => { const s = e.getComponent("minecraft:item")?.itemStack; return s ? `${s.typeId}×${s.amount}` : "?"; });
}

const checks: Record<string, (dimension: Dimension, at: Vector3) => void> = {
  gamerules() {
    log(`gamerules ${JSON.stringify(getGameRules())}`);
  },
  fullness() {
    const bulbasaur = PokemonData.generateNewWildPokemon("bulbasaur", { level: 10 });
    const max = getMaxFullness(bulbasaur);
    for (let i = 0; i < max + 1; i++) feedPokemon(bulbasaur, 1);
    log(`fome bulbasaur máx=${max} barriga=${bulbasaur.fullness} metabolismo=${getMetabolismRate(bulbasaur)} ticks`);
  },
  features() {
    const gimmighoul = PokemonData.generateNewWildPokemon("gimmighoul", { level: 20 });
    for (let i = 0; i < 13; i++) handleStashItem(gimmighoul, "cobblemon:relic_coin_sack");
    const ready = initializeEvolutions(gimmighoul.getEvolutionEntries()).filter(e => e.test(gimmighoul)).map(e => e.id);
    log(`stash gimmighoul moedas=${getIntFeature(gimmighoul, "gimmighoul_coins")} evoluções prontas=${ready.join(",")}`);
    const slowpoke = PokemonData.generateNewWildPokemon("slowpoke", { level: 20 });
    shearTail(slowpoke);
    log(`cauda slowpoke=${tailRegrowthSeconds(slowpoke)}s aspects=${slowpoke.aspects.join(",")}`);
  },
  evolution() {
    const nincada = PokemonData.generateNewWildPokemon("nincada", { level: 20 });
    const evolution = initializeEvolutions(nincada.getEvolutionEntries())[0];
    log(`nincada shedder=${evolution.shedder?.species} drops=${evolution.drops?.entries?.map(e => e.item).join(",")}`);
  },
  alpha(dimension, at) {
    const data = PokemonData.generateNewWildPokemon("machop", { level: 55, aspects: ["alpha"] });
    const entity = spawnPokemon(dimension, at, data);
    const dropped = dropAlphaRewards({ aspects: data.aspects, level: data.level, types: data.getTypes() }, dimension, entity.location);
    log(`alpha machop L55 soltou ${dropped.map(([i, n]) => `${i}×${n}`).join(", ")}`);
    system.runTimeout(() => {
      log(`alpha: itens no chão ${itemsNear(dimension, at).join(", ")}`);
      if (entity.isValid) entity.remove();
    }, 5);
  },
  shiny(dimension, at) {
    const data = PokemonData.generateNewWildPokemon("pikachu", { level: 10, shiny: true });
    const entity = spawnPokemon(dimension, { ...at, x: at.x + 3 }, data);
    log(`shiny: tag=${entity.hasTag(SHINY_TAG)} rótulo="${entity.nameTag}"`);
    system.runTimeout(() => { if (entity.isValid) entity.remove(); }, 40);
  },
  honey(dimension, at) {
    const pos = { x: Math.floor(at.x) + 2, y: Math.floor(at.y), z: Math.floor(at.z) + 2 };
    dimension.getBlock(pos)?.setPermutation(BlockPermutation.resolve(SLATHERED_LOG));
    registerSlatheredLog(dimension.id, pos);
    const positions = [{ dimension, location: { x: pos.x + 4.5, y: pos.y, z: pos.z + 0.5 }, influences: [] as never[] }] as never[];
    let alpha = 0;
    attachHoneyInfluences(dimension, positions, pos, 8, 8, {
      hasHiddenAbility: () => false, giveHiddenAbility: () => { }, makeAlpha: () => { alpha++; },
    });
    const influences = (positions[0] as { influences?: unknown[] }).influences ?? [];
    log(`tora com mel: ${dimension.getBlock(pos)?.typeId} influências na posição=${influences.length}`);
    dimension.getBlock(pos)?.setType("minecraft:air");
    void alpha;
  },
};

/** Handler do scriptevent. */
export function runJogabilidadeChecks(message: string, attempt = 0) {
  const dimension = world.getDimension("overworld");
  const at = spawnPoint(dimension);
  if (!at) {
    if (attempt === 0) {
      const spawn = world.getDefaultSpawnLocation();
      try { dimension.runCommand(`tickingarea add circle ${spawn.x} 64 ${spawn.z} 2 jogabilidade_check`); } catch { }
    }
    if (attempt < 30) system.runTimeout(() => runJogabilidadeChecks(message, attempt + 1), 20);
    else log("chunk do spawn não carregou");
    return;
  }
  const wanted = (message.trim() || "all").split(/\s+/);
  for (const [name, check] of Object.entries(checks)) {
    if (!wanted.includes("all") && !wanted.includes(name)) continue;
    try { check(dimension, at); }
    catch (e) { console.warn(`[jogabilidade] ${name} falhou: ${e}`); }
  }
}
