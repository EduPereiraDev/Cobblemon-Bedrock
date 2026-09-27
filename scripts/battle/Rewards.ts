import { Entity, Player, ItemStack, system } from "@minecraft/server";
import { playExpGainedSounds } from "./LevelUpSounds";
import { notifyExpGained } from "../GUI/PartyHud";
import { getConfig, getGameRule } from "../Config";
import { deliverItem } from "../pokemon/Drops";
import { calculateExpGain } from "../Experience";
import { PokemonData } from "../Pokemon";
import { getMoveTranslation, message } from "../language";
import { getEvolutionProgress, setEvolutionProgress } from "../evolution";
import DefeatRequirement from "../evolution/requirements/DefeatRequirement";
import { ActorType, BattleActor } from "./BattleActor";
import type { ActivePokemon } from "./ActivePokemon";
import type { PokemonBattle } from "./PokemonBattle";
import { addEvs, evYieldFor, gainExperience } from "./PokemonCompat";
import { promptMoveReplacement } from "../GUI/Battle";
import { markCaught } from "../pokedex/PokedexStorage";

/**
 * Recompensas de fim de batalha, como `PokemonBattle.end()` do Cobblemon 1.8.2:
 * - EXP para quem enfrentou o Pokémon desmaiado (facedOpponents), ou 0.5× (config) com Exp. Share;
 *   só se o time inimigo foi todo derrotado (ou awardExperienceOnBattleLoss);
 * - EVs do evYield do derrotado (+8 de item "power") para os mesmos Pokémon;
 * - progresso de evolução "defeat";
 * - amizade por nível e golpes novos vêm de PokemonData.gainExp; golpes que não cabem no moveset
 *   geram uma pergunta (no Cobblemon eles ficam guardados e são trocados pelo resumo).
 */
export function awardBattleRewards(battle: PokemonBattle) {
  const config = getConfig() as unknown as Record<string, unknown>;
  const awardToFainted = config.awardExperienceToFaintedPokemon === true;
  const awardOnLoss = config.awardExperienceOnBattleLoss === true;
  const shareMultiplier = typeof config.experienceShareMultiplier === "number" ? config.experienceShareMultiplier : 0.5;
  const pendingMoves: { player: Player; pokemon: PokemonData; move: string }[] = [];
  const touched = new Set<PokemonData>();

  for (const actor of battle.actors) {
    const faintedPokemons = actor.pokemon.filter(x => x.currentHealth <= 0);
    for (const opponent of actor.getSide().getOppositeSide().actors) {
      const opponentPokemons = awardToFainted ? opponent.pokemon : opponent.pokemon.filter(x => x.currentHealth > 0);
      for (const fainted of faintedPokemons) {
        for (const winner of opponentPokemons) {
          // Clone de batalha (cloneParties/setLevel): PlayerBattleActor.awardExperience só dá EXP ao original.
          if (winner.battleClone) continue;
          if (awardToFainted) {
            // Só ganha por inimigos que desmaiaram antes dele.
            const enemyFaintedAt = battle.faintedAt.get(fainted.uuid);
            if (enemyFaintedAt === undefined) continue;
            const winnerFaintedAt = battle.faintedAt.get(winner.uuid);
            if (winnerFaintedAt !== undefined && winnerFaintedAt <= enemyFaintedAt) continue;
          }
          const faced = battle.hasFaced(winner.uuid, fainted.uuid);
          if (faced) addDefeatProgress(winner, fainted);
          let multiplier: number;
          if (!faced && isExpShare(winner)) multiplier = shareMultiplier;
          else if (faced) multiplier = 1;
          else continue;

          if (opponent.type !== ActorType.PLAYER) continue;
          const player = opponent.Player;
          const experience = calculateExpGain(winner, fainted, multiplier, player?.name);
          const enemyTeamWiped = actor.pokemon.every(x => x.currentHealth <= 0);
          if (experience > 0 && (enemyTeamWiped || awardOnLoss))
            awardExperience(battle, opponent, winner, experience, pendingMoves);
          addEvs(winner, evYieldFor(winner, fainted));
          touched.add(winner);
        }
      }
    }
  }

  // Salva no time e atualiza o nome/nível da entidade em campo.
  for (const actor of battle.actors) {
    if (actor.type !== ActorType.PLAYER || !actor.Player) continue;
    for (const pokemon of actor.pokemon) {
      if (!touched.has(pokemon)) continue;
      pokemon.tryUpdatePokemonInTeam(actor.Player);
      if (pokemon.currentHealth > 0) pokemon.tryUpdatePokemonOut();
    }
  }

  runMovePrompts(pendingMoves);
}

function isExpShare(pokemon: PokemonData) {
  return (pokemon.item || "").replace(/[^a-z0-9]/g, "") === "expshare";
}

/** PlayerBattleActor.awardExperience + addExperienceWithPlayer: mensagens, golpes novos e evoluções. */
function awardExperience(battle: PokemonBattle, actor: BattleActor, pokemon: PokemonData, experience: number, pendingMoves: { player: Player; pokemon: PokemonData; move: string }[]) {
  const config = getConfig() as unknown as Record<string, unknown>;
  const allowPvP = (config.allowExperienceFromPvP ?? config.allowExperienceFromPVP) !== false;
  if (battle.isPVP && !allowPvP) return;
  const player = actor.Player;
  const speciesBefore = pokemon.species;
  const result = gainExperience(pokemon, experience);
  // Evoluiu na hora (evolução não opcional): a Pokédex registra a nova espécie.
  if (player && pokemon.species !== speciesBefore) {
    try { markCaught(player, pokemon); } catch { }
  }
  if (result.experienceAdded <= 0 || !player) return;
  // addExperienceWithPlayer (1.8.2): só o ExpGainedDataPacket → overlay do time ("+N EXP", rolo de level-up, sons,
  // pop-ups; frente dados-ui). Sem overlay visível: os sons (frente visual-batalha) e as mensagens no chat.
  let shown = false;
  try {
    shown = notifyExpGained(player, pokemon.uuid, result.newLevel > result.oldLevel ? result.oldLevel : undefined,
      result.experienceAdded, result.newMoves.length);
  }
  catch { shown = false; }
  if (!shown) {
    playExpGainedSounds(player, result);
    player.sendMessage(message.With("cobblemon.experience.gained", [pokemon, result.experienceAdded.toString()]));
    if (result.newLevel > result.oldLevel)
      player.sendMessage(message.With("cobblemon.experience.level_up", [pokemon, result.newLevel.toString()]));
    for (const move of result.addedMoves)
      player.sendMessage(message.With("cobblemon.experience.learned_move", [pokemon, getMoveTranslation(move)]));
  }
  for (const move of result.newMoves.filter(x => !result.addedMoves.includes(x)))
    if (!pokemon.moves.includes(move)) pendingMoves.push({ player, pokemon, move });
}

/** Progresso "defeat" das evoluções (ex.: Bisharp → Kingambit). */
function addDefeatProgress(winner: PokemonData, defeated: PokemonData) {
  try {
    winner.getEvolutions().forEach(evolution => {
      evolution.requirements.forEach(requirement => {
        if (!(requirement instanceof DefeatRequirement) || !requirement.target.match(defeated)) return;
        const progress = getEvolutionProgress<number>(winner, evolution.id, "defeat") || 0;
        setEvolutionProgress(winner, evolution.id, "defeat", progress + 1);
      });
    });
  }
  catch (e) {
    console.warn(`Could not update defeat progress: ${e}`);
  }
}

type MoveLearningPrompt = (player: Player, pokemon: PokemonData, move: string) => Promise<boolean>;
let moveLearningPrompt: MoveLearningPrompt = promptMoveReplacement;

/** Troca a pergunta de golpe novo (testes / outras telas). */
export function setMoveLearningPrompt(prompt: MoveLearningPrompt) {
  moveLearningPrompt = prompt;
}

/** Pergunta, um por vez, qual golpe esquecer para aprender cada golpe novo. */
async function runMovePrompts(pending: { player: Player; pokemon: PokemonData; move: string }[]) {
  for (const { player, pokemon, move } of pending) {
    try {
      if (!player.isValid) continue;
      await moveLearningPrompt(player, pokemon, move);
    }
    catch (e) {
      console.warn(`Move learning prompt failed: ${e}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Drops de Pokémon selvagem derrotado (DropTable.getDrops + PokemonServerDelegate.doDeathDrops)
// ---------------------------------------------------------------------------------------------

interface DropEntryData {
  item: string;
  percentage?: number;
  quantity?: number;
  quantityRange?: string;
  maxSelectableTimes?: number;
}

interface DropTableData {
  amount?: number | string;
  entries?: DropEntryData[];
}

/** IntRangeAdapter: "3" → 3..3, "1-2" → 1..2. */
function parseRange(value: number | string | undefined, fallback: [number, number]): [number, number] {
  if (value === undefined) return fallback;
  if (typeof value === "number") return [value, value];
  const match = /(-?\d+)-?(-?\d+)?/.exec(value);
  if (!match) return fallback;
  const start = parseInt(match[1]);
  return [start, match[2] ? parseInt(match[2]) : start];
}

function randomInRange([min, max]: [number, number]) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Sorteia as entradas da tabela (mesmo algoritmo do DropTable.getDrops). */
export function rollDrops(table: DropTableData | undefined, random = Math.random): DropEntryData[] {
  const entries = table?.entries ?? [];
  if (entries.length === 0) return [];
  const chosenAmount = randomInRange(parseRange(table?.amount, [1, 1]));
  const quantity = (entry: DropEntryData) => entry.quantity ?? 1;
  const possible = entries.filter(entry => quantity(entry) <= chosenAmount);
  const drops: DropEntryData[] = [];
  let dropCount = 0;
  while (dropCount < chosenAmount && possible.length > 0) {
    const drop = possible.find(entry => random() * 100 < (entry.percentage ?? 100));
    if (!drop) {
      // Conta como um drop, senão as porcentagens não significariam nada (comentário do Cobblemon).
      dropCount++;
      continue;
    }
    drops.push(drop);
    dropCount += quantity(drop);
    const remaining = chosenAmount - dropCount;
    const times = drops.filter(x => x === drop).length;
    for (let i = possible.length - 1; i >= 0; i--) {
      const entry = possible[i];
      if ((entry === drop && (entry.maxSelectableTimes ?? 1) <= times) || quantity(entry) > remaining) possible.splice(i, 1);
    }
  }
  return drops;
}

function spawnDrops(entity: Entity): DropTableData | undefined {
  try {
    const json = entity.getDynamicProperty("cobblemon:spawn_drops");
    if (typeof json !== "string") return undefined;
    const table = JSON.parse(json) as DropTableData;
    return Array.isArray(table?.entries) ? table : undefined;
  }
  catch {
    return undefined;
  }
}

/** Frente msd-fase3: itens extras no drop do selvagem derrotado (vazio no base). */
export type WildDropProvider = (active: ActivePokemon) => ItemStack[];
const wildDropProviders: WildDropProvider[] = [];
export function addWildDropProvider(provider: WildDropProvider): void {
  if (!wildDropProviders.includes(provider)) wildDropProviders.push(provider);
}

/**
 * Drops do Pokémon selvagem que desmaiou (PokemonServerDelegate.doDeathDrops): só com a gamerule `doPokemonLoot`;
 * item segurado + tabela `drops` do spawn/forma/espécie (sorteada duas vezes com o aspect `drops_reroll` da isca),
 * entregues pelo `defaultDropItemMethod` (pokemon/Drops.deliverItem; quem derrotou é o jogador do outro lado) e,
 * com `dropAfterDeathAnimation`, depois da animação de desmaio (30 ticks), no lugar onde a entidade estava.
 */
export function dropWildLoot(active: ActivePokemon) {
  if (active.actor.type !== ActorType.WILD) return;
  const entity = active.entity;
  if (!entity?.isValid) return;
  if (!getGameRule("doPokemonLoot")) return;
  const data = active.data;
  const items: ItemStack[] = [];
  const held = data.minecraftItem;
  if (held) {
    try { items.push(new ItemStack(held, 1)); } catch { }
  }
  const formDrops = (data as unknown as { getFormData?: () => { drops?: DropTableData } | undefined }).getFormData?.()?.drops;
  // Drops definidos pelo spawn (PokemonEntity.drops) vencem os da espécie.
  const table = spawnDrops(entity) ?? formDrops ?? (data.getSpeciesData().drops as DropTableData | undefined);
  const rolls = [...rollDrops(table), ...(data.aspects.includes("drops_reroll") ? rollDrops(table) : [])];
  for (const drop of rolls) {
    const amount = drop.quantityRange ? randomInRange(parseRange(drop.quantityRange, [1, 1])) : (drop.quantity ?? 1);
    if (amount <= 0) continue;
    try {
      items.push(new ItemStack(drop.item, amount));
    }
    catch {
      // Item do Cobblemon que ainda não existe no Bedrock.
    }
  }
  // Frente msd-fase3: drops de extensões (Tera Shards do Mega Showdown: CobbleEvents.dropShardPokemon, LOOT_DROPPED).
  for (const provider of wildDropProviders) {
    try { items.push(...provider(active)); } catch (e) { console.warn(`Drop de extensão: ${e}`); }
  }
  if (!items.length) return;
  const dimension = entity.dimension;
  const location = { x: entity.location.x, y: entity.location.y, z: entity.location.z };
  let player: Player | undefined;
  try { player = active.actor.getSide().getOppositeSide().actors.find(x => x.type === ActorType.PLAYER)?.actor as Player | undefined; } catch { }
  const deliver = () => {
    for (const item of items) {
      try { deliverItem(item, { dimension, location, entity: entity.isValid ? entity : undefined, player }); }
      catch (e) { console.warn(`Could not drop ${item.typeId}: ${e}`); }
    }
  };
  if (getConfig().dropAfterDeathAnimation) system.runTimeout(deliver, 30);
  else deliver();
}
