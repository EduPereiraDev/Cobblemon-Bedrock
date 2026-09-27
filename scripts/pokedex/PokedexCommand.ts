/**
 * `/cobblemon:pokedex`, port de `command/PokedexCommand.kt`:
 *   grant|revoke <jogadores> all [pokédex]          (padrão: national)
 *   grant|revoke <jogadores> only <espécie> [forma] (padrão: Normal)
 *   printcalculations <jogadores> [pokédex]
 * As respostas são em inglês literal, como no Cobblemon.
 */
import {
  CommandPermissionLevel, CustomCommandOrigin, CustomCommandParamType, CustomCommandResult, CustomCommandStatus, Player,
  StartupEvent, system,
} from "@minecraft/server";
import { getSpeciesData, toSpeciesId } from "../speciesData";
import { getConfig } from "../Config";
import { batchPokedex, getPokedex } from "./PokedexStorage";
import { DexProgress, GENDER_BITS, PokedexRecords } from "./PokedexRecords";
import { DexEntry, computeDexCounts, getDex, getDexes, getNationalEntry } from "./DexData";

export const ENUM_POKEDEX_ACTION = "cobblemon:pokedexaction";
export const ENUM_POKEDEX_SCOPE = "cobblemon:pokedexscope";

/** Gêneros possíveis da forma (FormData.possibleGenders) em bits. */
function possibleGenderBits(species: string, form: string): number {
  const data = getSpeciesData(species);
  const formData = data?.forms?.find(x => x.name.toLowerCase() === form.toLowerCase());
  const ratio = formData?.maleRatio ?? data?.maleRatio ?? 0.5;
  if (!(ratio >= 0 && ratio <= 1)) return GENDER_BITS.n;
  if (ratio === 0) return GENDER_BITS.f;
  if (ratio === 1) return GENDER_BITS.m;
  return GENDER_BITS.m | GENDER_BITS.f;
}

/** grant all: todas as formas de desbloqueio das entradas como OWNED, com shiny/gêneros. */
export function grantEntries(records: PokedexRecords, entries: DexEntry[], maxLevel: number) {
  for (const entry of entries)
    for (const form of entry.getForms())
      for (const unlock of form.unlockForms)
        records.grantForm(entry.speciesId, unlock, DexProgress.OWNED, possibleGenderBits(entry.speciesId, unlock), maxLevel);
}

/** grant only: as formas de desbloqueio da forma exibida `formName` na entrada nacional. */
export function grantSpeciesForm(records: PokedexRecords, species: string, formName: string, maxLevel: number): boolean {
  const entry = getNationalEntry(species);
  if (!entry) return false;
  const forms = entry.getForms().filter(form => form.displayForm.toLowerCase() === formName.toLowerCase());
  if (forms.length === 0) return false;
  for (const form of forms)
    for (const unlock of form.unlockForms)
      records.grantForm(entry.speciesId, unlock, DexProgress.OWNED, possibleGenderBits(entry.speciesId, unlock), maxLevel);
  return true;
}

function selectorText(players: Player[]): string {
  return players.length === 1 ? players[0].name : `${players.length} players`;
}

function run(origin: CustomCommandOrigin, action: string, players: Player[] | undefined, scope?: string, value?: string, form?: string): CustomCommandResult {
  const targets = (players ?? []).filter(p => p.isValid);
  if (targets.length === 0) return { status: CustomCommandStatus.Failure, message: "No players found" };
  const reply = (text: string) => {
    const source = origin.sourceEntity;
    if (source instanceof Player) source.sendMessage(text);
    else console.info(text);
  };
  const maxLevel = getConfig().maxPokemonLevel ?? 100;

  if (action === "printcalculations") {
    // PokedexCommand.kt: sem Pokédex = Nacional (printNationalDexValues); "all" = todas (printValuesGlobal).
    const dexId = scope === "all" ? undefined : (scope && scope !== "only" ? scope : value) ?? "national";
    system.run(() => {
      for (const player of targets) {
        const records = getPokedex(player);
        const global = computeDexCounts(records);
        reply(`${player.name}: SeenCount ${global.seen}, CaughtCount ${global.caught}`);
        for (const dex of dexId ? [getDex(dexId)].filter(x => !!x) : getDexes()) {
          const counts = computeDexCounts(records, dex!.id);
          const pct = (n: number) => counts.total ? `${(n / counts.total * 100).toFixed(1)}%` : "0%";
          reply(`  ${dex!.id}: seen ${counts.seen}/${counts.total} (${pct(counts.seen)}), caught ${counts.caught}/${counts.total} (${pct(counts.caught)})`);
        }
      }
    });
    return { status: CustomCommandStatus.Success };
  }

  if (action !== "grant" && action !== "revoke") return { status: CustomCommandStatus.Failure, message: `Unknown action ${action}` };
  if (scope === "only") {
    if (!value) return { status: CustomCommandStatus.Failure, message: "Missing species" };
    const species = toSpeciesId(value);
    if (!getSpeciesData(species)) return { status: CustomCommandStatus.Failure, message: `Unknown species ${value}` };
    const formName = form ?? "Normal";
    system.run(() => {
      for (const player of targets) {
        batchPokedex(player, records => {
          if (action === "grant") grantSpeciesForm(records, species, formName, maxLevel);
          else records.deleteForm(species, formName);
        });
      }
      reply(action === "grant" ? `Granted ${species}-${formName} to ${selectorText(targets)}` : `Removed ${species}-${formName} from ${selectorText(targets)}`);
    });
    return { status: CustomCommandStatus.Success };
  }

  const dex = getDex(value ?? "national");
  if (!dex) return { status: CustomCommandStatus.Failure, message: `Unknown Pokédex ${value}` };
  system.run(() => {
    for (const player of targets) {
      batchPokedex(player, records => {
        if (action === "grant") grantEntries(records, dex.getEntries(), maxLevel);
        else for (const entry of dex.getEntries()) records.deleteSpecies(entry.speciesId);
      });
    }
    reply(action === "grant" ? `Filled dex of ${selectorText(targets)}` : `Cleared dex of ${selectorText(targets)}`);
  });
  return { status: CustomCommandStatus.Success };
}

/** Registra o comando (chamado no system.beforeEvents.startup). */
export function registerPokedexCommand(event: StartupEvent) {
  try {
    event.customCommandRegistry.registerEnum(ENUM_POKEDEX_ACTION, ["grant", "revoke", "printcalculations"]);
    event.customCommandRegistry.registerEnum(ENUM_POKEDEX_SCOPE, ["all", "only"]);
    event.customCommandRegistry.registerCommand({
      name: "cobblemon:pokedex",
      description: "Grants/revokes Pokédex entries / Concede ou remove registros da Pokédex.",
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: false,
      mandatoryParameters: [
        { name: ENUM_POKEDEX_ACTION, type: CustomCommandParamType.Enum },
        { name: "player", type: CustomCommandParamType.PlayerSelector },
      ],
      optionalParameters: [
        { name: ENUM_POKEDEX_SCOPE, type: CustomCommandParamType.Enum },
        { name: "dexOrSpecies", type: CustomCommandParamType.String },
        { name: "form", type: CustomCommandParamType.String },
      ],
    }, (origin, action: string, players: Player[], scope?: string, value?: string, form?: string) =>
      run(origin, action, players, scope, value, form));
  }
  catch (e) {
    console.warn(`Não foi possível registrar /cobblemon:pokedex: ${e}`);
  }
}
