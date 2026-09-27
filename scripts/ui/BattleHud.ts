/**
 * HUD de batalha do Cobblemon (`BattleOverlay.kt`): caixas de info dos Pokémon em campo — lado do jogador à esquerda,
 * oponentes à direita — com retrato, nome, gênero, nível, barra e texto de HP, status e o indicador de "capturado".
 * O desenho está em `ui/cobblemon_hud.json`; aqui só lemos o estado das batalhas (somente leitura em
 * `scripts/battle`) e mandamos o canal `B` do HudBus para cada participante e espectador.
 *
 * Diferenças conhecidas: sem animação de entrada/saída das caixas, sem a faixa colorida do ator ("role") e sem o
 * retrato 3D (imagem 2D).
 *
 * Frente batalha-minimizavel: com a batalha minimizada as caixas ficam com opacidade 0,5 (BattleOverlay.MIN_OPACITY)
 * e o aviso "Você precisa escolher uma ação. Pressione %1$s." pulsa no HUD (BattleOverlay.kt:143-153). O estado vem de
 * `BattleUiView.ts`; o texto do aviso vai como cauda rawtext do título (traduzido no cliente).
 */
import type { PokemonData } from "../Pokemon";
import { Player, system, world } from "@minecraft/server";
import type { PokemonBattle } from "../battle/PokemonBattle";
import type { ActivePokemon } from "../battle/ActivePokemon";
import type { BattleSide } from "../battle/BattleSide";
import { battleMap } from "../battle/PokemonBattle";
import { ActorType } from "../battle/BattleActor";
import { hasCaught } from "../pokedex/PokedexStorage";
import { BattleHudView, BattleTileView, CHANNEL, battleHpText, encodeBattleBody } from "./hudProtocol";
import { setHudChannel } from "./HudBus";
import { portraitPath } from "./portraits";
import { displayName } from "./PartyOverlay";
import { battleUiViewOf } from "./BattleUiView";

/** Intervalo de atualização (ticks): as barras acompanham o dano quase em tempo real. */
export const BATTLE_HUD_TICKS = 2;

const EMPTY = encodeBattleBody(undefined);
const PERSISTENT = new Set(["brn", "frz", "par", "psn", "slp", "tox", "fnt"]);

/** Jogadores com HUD de batalha na tela. */
const showing = new Set<string>();
/** Cache de "capturado" por jogador → UUID do Pokémon (evita ler a Pokédex a cada atualização). */
const ownedCache = new Map<string, Map<string, boolean>>();

function genderOf(gender: string | undefined): "m" | "f" | "n" {
  const g = (gender ?? "").toUpperCase();
  return g === "M" || g === "MALE" ? "m" : g === "F" || g === "FEMALE" ? "f" : "n";
}

function actorName(side: BattleSide): string | undefined {
  const actor = side.actors[0];
  if (!actor) return undefined;
  if (actor.customName && "text" in actor.customName && typeof actor.customName.text === "string") return actor.customName.text;
  // Jogador que saiu do servidor: a entidade fica inválida até a batalha ser encerrada; usa o nome capturado.
  if (actor.actor instanceof Player) return actor.actor.isValid ? actor.actor.name : actor.playerName;
  try { return actor.actor.nameTag || undefined; } catch { return undefined; }
}

function isOwned(viewer: Player, active: ActivePokemon): boolean {
  let cache = ownedCache.get(viewer.id);
  if (!cache) ownedCache.set(viewer.id, cache = new Map());
  const known = cache.get(active.data.uuid);
  if (known !== undefined) return known;
  let owned = false;
  try { owned = hasCaught(viewer, active.data.species); } catch { }
  cache.set(active.data.uuid, owned);
  return owned;
}

/** Caixa de um Pokémon em campo vista por `viewer`. */
export function tileView(active: ActivePokemon, flatHealth: boolean, owned: boolean, isAlly = true): BattleTileView {
  const data = active.data;
  // ActiveBattlePokemonDTO (frente visual-batalha): quem não é aliado vê o disfarce do Illusion (espécie, nome,
  // gênero, retrato); com Transform todos veem a espécie/variant copiada. Nível e HP são sempre os do real.
  let shown: PokemonData = data;
  try { shown = active.displayData(isAlly); } catch { }
  const mock = (active as { mock?: { kind: string; data: PokemonData } }).mock;
  const look = mock?.kind === "transform" ? mock.data : shown;
  const max = Math.max(1, data.maxHealth);
  const status = data.currentHealth <= 0 ? "fnt" : data.status && PERSISTENT.has(data.status) ? data.status : "";
  return {
    texture: portraitPath(look.species, look.variant ?? 0),
    name: displayName(shown),
    level: data.level,
    hpRatio: data.currentHealth / max,
    hpText: battleHpText(data.currentHealth, max, flatHealth),
    status,
    gender: genderOf(shown.gender),
    owned,
  };
}

/** Lado do jogador (participante) ou o lado 1 para espectadores. */
function viewerSide(battle: PokemonBattle, viewer: Player): BattleSide {
  return battle.sides.find(side => side.actors.some(actor => actor.actor instanceof Player && actor.actor.id === viewer.id)) ?? battle.side1;
}

/** Monta a visão do HUD de batalha para um jogador. */
export function battleView(battle: PokemonBattle, viewer: Player): BattleHudView {
  const own = viewerSide(battle, viewer);
  const other = own.getOppositeSide();
  const tiles = (side: BattleSide) => side.getActivePokemon().slice(0, 3).map(active => {
    if (!active) return undefined;
    const flat = active.actor.actor instanceof Player && active.actor.actor.id === viewer.id;
    return tileView(active, flat, isOwned(viewer, active), side === own);
  });
  const showNames = !battle.isPvW;
  return {
    slotsPerActor: battle.format.battleType.slotsPerActor,
    leftActor: showNames ? actorName(own) : undefined,
    rightActor: showNames && other.actors[0]?.type !== ActorType.WILD ? actorName(other) : undefined,
    left: tiles(own),
    right: tiles(other),
  };
}

function update() {
  const seen = new Set<string>();
  for (const battle of battleMap.values()) {
    if (battle.ended) continue;
    const viewers = [...battle.players, ...battle.spectators];
    for (const viewer of viewers) {
      if (!viewer.isValid || seen.has(viewer.id)) continue;
      seen.add(viewer.id);
      try {
        const view = battleView(battle, viewer);
        const ui = battleUiViewOf(viewer);
        if (ui) view.ui = { minimised: ui.minimised, prompt: ui.prompt, cursor: ui.cursor, moves: ui.moves };
        const body = encodeBattleBody(view);
        // O HudBus compara corpo + cauda: só reenvia quando algo mudou.
        setHudChannel(viewer, CHANNEL.BATTLE, body, ui?.prompt ? ui.text : undefined);
        showing.add(viewer.id);
      }
      catch (e) { console.warn(`HUD de batalha: ${e}`); }
    }
  }
  // Quem saiu da batalha: esconde as caixas.
  for (const id of [...showing]) {
    if (seen.has(id)) continue;
    showing.delete(id);
    ownedCache.delete(id);
    const player = world.getEntity(id);
    if (player instanceof Player && player.isValid) setHudChannel(player, CHANNEL.BATTLE, EMPTY);
  }
}

let runId: number | undefined;

export function startBattleHud() {
  if (runId !== undefined) return;
  runId = system.runInterval(update, BATTLE_HUD_TICKS);
  world.afterEvents.playerLeave.subscribe(({ playerId }) => { showing.delete(playerId); ownedCache.delete(playerId); });
}
