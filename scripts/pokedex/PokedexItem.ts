/**
 * Item Pokédex (7 cores) e "scanner", aproximação de `item/PokedexItem.kt` + `pokedex/scanner/*`.
 *
 * No Cobblemon: toque curto abre a Pokédex; segurar abre o scanner com zoom, e mirar num Pokémon por
 * SUCCESS_SCAN_SERVER_TICKS (15) o registra (visto, ou obtido se for do próprio jogador).
 * No Bedrock (sem overlay de cliente): usar o item mirando um Pokémon no alcance
 * (`maxPokedexScanningDetectionRange`, 10 blocos) escaneia por 15 ticks com progresso na actionbar e depois
 * abre a entrada; sem Pokémon na mira, abre a Pokédex. Agachado mirando um Pokémon seu, não faz nada
 * (o Cobblemon deixa passar a interação).
 *
 * Retorno (frente extras-final, PokedexUsageContext): sons do scanner do Cobblemon (scan_open, scan_loop,
 * scan_register_pokemon/aspect, scan_detail, scan_close) e, na actionbar, o nome, o que há de novo
 * (getNewInformation: espécie, forma ou variação), a barra e a porcentagem. Sem nada novo, não há espera:
 * toca scan_detail, diz se já está registrado/capturado e abre a entrada.
 *
 * Frente telas (PokedexScannerRenderer): durante o escaneamento a câmera dá zoom (`camera.setFov`) e o overlay do
 * scanner (bordas, scanlines, anéis e moldura de informação, `ui/cobblemon_scanner.json`) substitui o texto da
 * actionbar. Agachar + usar liga/desliga o MODO SCANNER (como segurar o botão no Cobblemon): zoom pela roda/hotbar,
 * e mirar num Pokémon por 15 ticks o registra sem abrir a Pokédex; usar sem agachar (ou trocar de item) sai.
 */
import { Entity, EntityComponentTypes, Player, RawMessage, system, world } from "@minecraft/server";
import { PokemonData } from "../Pokemon";
import { getConfig } from "../Config";
import { getPokedex, markCaught, markSeen } from "./PokedexStorage";
import { DexProgress } from "./PokedexRecords";
import { DEX_KEYS, DEX_SOUNDS, openPokedex, playDexSound, speciesName } from "./PokedexUI";
import { dexInfoFromPokemon } from "./PokedexStorage";
import { LearnedInformation, getNewInformation } from "./PokedexVariations";
import { recordFlag } from "./Progress";
import { setDexColor } from "./PokedexUI";
import { isPersistentScanner, isScannerOn, setScannerInfo, startScanner, startScannerZoom, stopScanner } from "../ui/studio/ScannerZoom";

export const POKEDEX_COLORS = ["red", "yellow", "green", "blue", "pink", "black", "white"] as const;
export const POKEDEX_ITEM_IDS = POKEDEX_COLORS.map(color => `cobblemon:pokedex_${color}`);

/** PokedexUsageContext.SUCCESS_SCAN_SERVER_TICKS. */
export const SUCCESS_SCAN_TICKS = 15;

export function isPokedexItem(typeId: string | undefined): boolean {
  return !!typeId && POKEDEX_ITEM_IDS.includes(typeId);
}

const scanning = new Set<string>();

function heldItemId(player: Player): string | undefined {
  try {
    const container = player.getComponent(EntityComponentTypes.Inventory)?.container;
    return container?.getItem(player.selectedSlotIndex)?.typeId;
  }
  catch {
    return undefined;
  }
}

/** Primeiro Pokémon na mira dentro do alcance (blocos sólidos bloqueiam). */
export function findScanTarget(player: Player): Entity | undefined {
  const range = Math.max(1, getConfig().maxPokedexScanningDetectionRange ?? 10);
  try {
    const hits = player.getEntitiesFromViewDirection({ maxDistance: range });
    for (const hit of hits) {
      const entity = hit.entity;
      if (entity.isValid && entity.getComponent(EntityComponentTypes.TypeFamily)?.hasTypeFamily("pokemon")) return entity;
    }
  }
  catch { }
  return undefined;
}

/** Dono do Pokémon (id do jogador) ou undefined se for selvagem. */
function ownerOf(entity: Entity, data: PokemonData | undefined): string | undefined {
  if (data?.trainer) return data.trainer;
  const ownerName = entity.getDynamicProperty("owner_name");
  if (typeof ownerName === "string") return world.getPlayers({ name: ownerName })[0]?.id ?? ownerName;
  return undefined;
}

/** Texto do scanner: na moldura do overlay quando o scanner está ligado, senão na actionbar. */
function actionbar(player: Player, message: RawMessage | string) {
  if (isScannerOn(player)) { setScannerInfo(player, message); return; }
  try { player.onScreenDisplay.setActionBar(message); } catch { }
}

/** Registra o Pokémon escaneado (FinishScanningHandler) e diz se havia informação nova. */
export function registerScan(player: Player, entity: Entity): { data: PokemonData; newInformation: boolean; ownedByOther: boolean } | undefined {
  const data = PokemonData.tryGetFromEntity(entity);
  if (!data) return undefined;
  const owner = ownerOf(entity, data);
  const before = getPokedex(player).getKnowledgeForSpecies(dexInfoFromPokemon(data).species);
  const changed = owner === player.id ? markCaught(player, data) : markSeen(player, data);
  return { data, newInformation: changed || before === DexProgress.UNREGISTERED, ownedByOther: owner !== undefined && owner !== player.id };
}

/** Texto da actionbar durante o escaneamento: nome, novidade, barra de 10 traços e porcentagem. */
export function scanProgressMessage(name: RawMessage, learned: LearnedInformation, tick: number): RawMessage {
  const filled = Math.round((tick / SUCCESS_SCAN_TICKS) * 10);
  const percent = Math.round((tick / SUCCESS_SCAN_TICKS) * 100);
  const label = learned === LearnedInformation.SPECIES ? DEX_KEYS.scanNewSpecies
    : learned === LearnedInformation.FORM ? DEX_KEYS.scanNewForm : DEX_KEYS.scanNewVariation;
  return {
    rawtext: [
      { translate: DEX_KEYS.scanning }, { text: " " }, name, { text: " §e" }, { translate: label },
      { text: ` §a${"|".repeat(filled)}§8${"|".repeat(10 - filled)} §f${percent}%` },
    ],
  };
}

/** Último alvo registrado no modo scanner (não repete o mesmo Pokémon em seguida). */
const lastScanned = new Map<string, string>();

/**
 * Escaneia por 15 ticks mirando o mesmo Pokémon com a Pokédex na mão. `stay`: modo scanner (não abre a entrada no
 * fim e mantém o zoom).
 */
async function scan(player: Player, target: Entity, stay = false): Promise<void> {
  if (scanning.has(player.id)) return;
  const data = PokemonData.tryGetFromEntity(target);
  if (!data) {
    if (!stay) void openPokedex(player);
    return;
  }
  const info = dexInfoFromPokemon(data);
  const name = speciesName(info.species);
  scanning.add(player.id);
  lastScanned.set(player.id, target.id);
  startScanner(player, stay);
  const open = (delay: number) => {
    if (stay) return;
    system.runTimeout(() => {
      if (!player.isValid) return;
      if (!isPersistentScanner(player)) stopScanner(player);
      void openPokedex(player, info.species);
    }, delay);
  };
  try {
    playDexSound(player, DEX_SOUNDS.scanOpen, 0.6);
    const learned = getNewInformation(getPokedex(player), info);
    if (learned === LearnedInformation.NONE) {
      // Nada novo (POKEDEX_SCAN_DETAIL): mostra o que a Pokédex já sabe e abre a entrada sem esperar.
      const owned = getPokedex(player).getKnowledgeForSpecies(info.species) === DexProgress.OWNED;
      playDexSound(player, DEX_SOUNDS.scanDetail, 0.6);
      registerScan(player, target);
      actionbar(player, { rawtext: [name, { text: " §8- " }, { translate: owned ? DEX_KEYS.scanOwned : DEX_KEYS.scanKnown }] });
      open(10);
      return;
    }
    for (let tick = 1; tick <= SUCCESS_SCAN_TICKS; tick++) {
      await new Promise<void>(resolve => system.runTimeout(() => resolve(), 1));
      if (!player.isValid || !target.isValid) return;
      if (!isPokedexItem(heldItemId(player)) || findScanTarget(player)?.id !== target.id) {
        actionbar(player, { translate: DEX_KEYS.scanCancelled });
        playDexSound(player, DEX_SOUNDS.scanClose, 0.6);
        lastScanned.delete(player.id);
        if (!isPersistentScanner(player)) system.runTimeout(() => { if (player.isValid && !isPersistentScanner(player)) stopScanner(player); }, 10);
        return;
      }
      // POKEDEX_SCAN_LOOP toca durante o escaneamento (a cada 3 ticks para não embolar).
      if (tick % 3 === 1) playDexSound(player, DEX_SOUNDS.scanLoop, 0.4);
      actionbar(player, scanProgressMessage(name, learned, tick));
    }
    const result = registerScan(player, target);
    if (!result) return;
    if (result.ownedByOther) actionbar(player, { translate: "cobblemon.ui.pokedex.scan.trainer_owned" });
    else actionbar(player, { translate: "cobblemon.ui.pokedex.scan.registered_suffix", with: { rawtext: [name] } });
    // onServerConfirmedRegister: espécie nova → scan_register_pokemon; forma/variação → scan_register_aspect.
    playDexSound(player, learned === LearnedInformation.SPECIES ? DEX_SOUNDS.scanRegisterPokemon : DEX_SOUNDS.scanRegisterAspect);
    // VIEW_INFO_BUFFER_TICKS: fecha o scanner e abre a entrada logo depois (no modo scanner, continua mirando).
    if (!stay) playDexSound(player, DEX_SOUNDS.scanClose, 0.6);
    open(10);
  }
  finally {
    scanning.delete(player.id);
    // Escaneamento avulso interrompido (alvo sumiu): desliga o zoom se ninguém mais o fez.
    if (!stay) system.runTimeout(() => { if (player.isValid && !isPersistentScanner(player) && !scanning.has(player.id)) stopScanner(player); }, 20);
  }
}

/** Uso do item Pokédex. */
export function usePokedex(player: Player, itemId?: string) {
  // craft_pokedex (conquista "Researcher Recruit"): ter a Pokédex; usá-la basta.
  recordFlag(player, "pokedex");
  if (itemId) setDexColor(player, itemId.replace("cobblemon:pokedex_", ""));
  const target = findScanTarget(player);
  if (target && player.isSneaking) {
    const data = PokemonData.tryGetFromEntity(target);
    if (ownerOf(target, data) === player.id) return;
  }
  // Modo scanner: agachar + usar liga; usar de novo (agachado ou não) desliga.
  if (isPersistentScanner(player)) {
    playDexSound(player, DEX_SOUNDS.scanClose, 0.6);
    stopScanner(player);
    return;
  }
  if (player.isSneaking) {
    playDexSound(player, DEX_SOUNDS.scanOpen, 0.6);
    lastScanned.delete(player.id);
    startScanner(player, true);
    actionbar(player, { translate: DEX_KEYS.scanAim });
    return;
  }
  if (target) void scan(player, target);
  else {
    playDexSound(player, DEX_SOUNDS.open, 0.6);
    void openPokedex(player);
  }
}

let bound = false;

/** Escuta o uso dos itens `cobblemon:pokedex_*`. */
export function bindPokedexItem() {
  if (bound) return;
  bound = true;
  world.afterEvents.itemUse.subscribe(({ source, itemStack }) => {
    if (!isPokedexItem(itemStack?.typeId)) return;
    usePokedex(source, itemStack?.typeId);
  });
  // Zoom pela hotbar/roda e saída automática (outro item na mão).
  startScannerZoom(player => isPokedexItem(heldItemId(player)));
  // Modo scanner: mirar num Pokémon (outro que o último) começa o escaneamento sozinho.
  system.runInterval(() => {
    for (const player of world.getPlayers()) {
      if (!isPersistentScanner(player) || scanning.has(player.id)) continue;
      const target = findScanTarget(player);
      if (!target) { if (lastScanned.has(player.id)) lastScanned.delete(player.id); continue; }
      if (lastScanned.get(player.id) === target.id) continue;
      void scan(player, target, true);
    }
  }, 4);
}
