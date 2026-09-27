/**
 * Adaptador do motor de batalha. O port original usava o fork do Showdown do Cobblemon,
 * que aceita formato customizado, HP/status/PP persistentes e usa o UUID do Pokémon como
 * identificador no protocolo. Aqui reproduzimos isso sobre o @pkmn/sim (Showdown oficial).
 *
 * Também reproduz a escolha `useitem` do fork (itens da mochila em batalha): o @pkmn/sim não a
 * conhece, então a escolha vira uma ação própria na fila do turno e o efeito dos scripts
 * `data/cobblemon/bag_items/*.js` do Cobblemon é aplicado aqui em TypeScript.
 */
import { Battle, BattleStreams, Dex, RandomPlayerAI, Streams, Teams, toID } from "@pkmn/sim";
import type { Format, MoveTarget, Pokemon, PokemonSet, Side, StatsTable } from "@pkmn/sim";

export { Dex, RandomPlayerAI, Teams, toID };
export type { MoveTarget, Pokemon, PokemonSet, StatsTable };
export type SimBattle = Battle;
export type SimPokemon = Pokemon;
export type SimSide = Side;
export const ObjectReadWriteStream = Streams.ObjectReadWriteStream;
export type ObjectReadWriteStream<T> = Streams.ObjectReadWriteStream<T>;
export const BattlePlayer = BattleStreams.BattlePlayer;
export type BattlePlayer = BattleStreams.BattlePlayer;
export const getPlayerStreams = BattleStreams.getPlayerStreams;

/** Campos extras que o PokemonData manda junto do set (formato do fork do Cobblemon). */
interface CobblemonSetExtras {
	uuid?: string;
	currentHealth?: number;
	status?: string;
	statusDuration?: number;
	movesInfo?: { pp: number; maxPp: number }[];
}

/** Formato recebido em `>start {"format": {...}}`, gerado por BattleFormat.toFormatJSON(). */
interface CobblemonFormatOptions {
	gameType?: "singles" | "doubles" | "triples" | "multi";
	gen?: number | string;
}

const BASE_FORMATS: Record<string, string> = {
	singles: "gen9customgame",
	doubles: "gen9doublescustomgame",
	triples: "gen9customgame",
	multi: "gen9customgame",
};

/**
 * Itens segurados do Cobblemon que o Showdown oficial não tem (`data/cobblemon/held_items/*.js` do 1.8.2): hoje só a
 * Eggant Berry (come a berry e cura a paixão de Attract). Registrados no dex antes de qualquer consulta, então
 * `Dex.items.get("eggantberry").exists` e o item vai para o set (items/heldItems.ts).
 */
const COBBLEMON_HELD_ITEMS: Record<string, object> = {
	eggantberry: {
		name: "Eggant Berry",
		spritenum: 0,
		isBerry: true,
		naturalGift: { basePower: 80, type: "Normal" },
		onUpdate(this: Battle, pokemon: Pokemon) {
			if (pokemon.volatiles["attract"]) pokemon.eatItem();
		},
		onEat(this: Battle, pokemon: Pokemon) {
			pokemon.removeVolatile("attract");
			this.add("-end", pokemon, "move: Attract", "[from] item: Eggant Berry");
		},
		num: -101,
		gen: 3,
		isNonstandard: "Past",
	},
};
{
	const items = (Dex.data as unknown as { Items: Record<string, object> }).Items;
	for (const [id, data] of Object.entries(COBBLEMON_HELD_ITEMS)) if (!items[id]) items[id] = data;
}

/**
 * Frente msd-fase3: ganchos chamados no início de cada batalha (onBegin do formato: estado persistente já aplicado e
 * nenhum request enviado). Vazio no base; a extensão Mega Showdown põe aqui o Dynamax em gen9 (SD/side.js do MSD).
 */
export const battleBeginHooks: ((battle: Battle) => void)[] = [];

/** Ordem da ação de item na fila do turno: logo antes das trocas (103), como no jogo. */
export const BAG_ITEM_ACTION_ORDER = 102;

/**
 * BattleStream que aceita `>start {"format": <objeto>}` e aplica o estado persistente
 * (HP, status, PP e UUID como nome) aos Pokémon antes do primeiro switch-in.
 */
export class BattleStream extends BattleStreams.BattleStream {
	override _writeLine(type: string, message: string) {
		if (type !== "start") return super._writeLine(type, message);
		const options = JSON.parse(message);
		const requested: CobblemonFormatOptions = typeof options.format === "object" && options.format ? options.format : {};
		const gameType = requested.gameType ?? "singles";
		delete options.format;
		options.formatid = BASE_FORMATS[gameType] ?? BASE_FORMATS.singles;
		options.format = createFormat(options.formatid, gameType);
		// Mesmo que o BattleStream.start original, mas passando o formato já montado.
		options.send = (t: string, data: string | string[]) => {
			this.pushMessage(t, Array.isArray(data) ? data.join("\n") : data);
			if (t === "end" && !this.keepAlive) this.pushEnd();
		};
		if (this.debug) options.debug = true;
		this.battle = new Battle(options, this.dex);
		installBagItemSupport(this.battle);
		installIllusionIdentity(this.battle);
	}
}

/**
 * Cópia do formato base (via protótipo, sem mexer no cache do Dex) com o gameType pedido e um
 * onBegin que aplica o estado persistente dos Pokémon.
 */
function createFormat(formatId: string, gameType: string): Format {
	const base = Dex.formats.get(formatId, true);
	const format = Object.create(base) as Writable<Format>;
	format.gameType = gameType as Format["gameType"];
	// Multi: quatro jogadores (p1+p3 contra p2+p4), um Pokémon ativo cada.
	format.playerCount = gameType === "multi" ? 4 : 2;
	// O Cobblemon não tem Team Preview: a batalha começa direto com o primeiro Pokémon do time.
	// O ruleTable é zerado para ser recalculado com o ruleset novo (senão herda o do formato base).
	format.ruleset = base.ruleset.filter(rule => rule !== "Team Preview");
	(format as { ruleTable: unknown }).ruleTable = null;
	format.onBegin = function (this: Battle) {
		base.onBegin?.call(this);
		for (const side of this.sides) {
			for (const pokemon of side.pokemon) applyPersistentState(pokemon);
		}
		// Frente msd-fase3: regras de extensões (Dynamax em gen9 do Mega Showdown), antes do primeiro request.
		for (const hook of battleBeginHooks) {
			try { hook(this); }
			catch (e) { console.warn(`Regra de batalha de extensão: ${e}`); }
		}
	};
	// A ação "start" do Showdown recalcula pokemonLeft e manda o primeiro do time a campo sem olhar
	// o HP. Aqui (depois disso e antes dos switch-ins) os desmaiados vão para o fim e deixam de contar.
	format.onBattleStart = function (this: Battle) {
		base.onBattleStart?.call(this);
		for (const side of this.sides) {
			side.pokemon.sort((a, b) => Number(a.fainted) - Number(b.fainted));
			side.pokemon.forEach((pokemon, i) => { (pokemon as Writable<Pokemon>).position = i; });
			side.pokemonLeft = side.pokemon.filter(pokemon => !pokemon.fainted).length;
		}
	};
	return format;
}

/**
 * Illusion (fork do Cobblemon): o protocolo sempre identifica o Pokémon real ("p1a: <uuid real>"); o disfarce vai
 * no `switch`/`drag` como `[is] p1: <uuid do disfarce>` (SwitchInstruction lê `battlePokemonFromOptional("is")`).
 * No Showdown oficial `Pokemon.toString()` devolve o nome do disfarce, e o port tiraria o Pokémon errado de campo.
 */
function installIllusionIdentity(battle: Battle) {
	const originalAdd = battle.add.bind(battle);
	battle.add = (...parts: unknown[]) => {
		const who = parts[1] as Pokemon | undefined;
		// add() com partes em função chama addSplit → add() de novo com as mesmas partes: só um `[is]`.
		if ((parts[0] === "switch" || parts[0] === "drag") && who && typeof who === "object" && who.illusion
			&& !parts.some(part => typeof part === "string" && part.startsWith("[is] ")))
			parts.push(`[is] ${who.illusion.side.id}: ${simPokemonUUID(who.illusion)}`);
		return (originalAdd as (...args: unknown[]) => void)(...parts);
	};
}

/** Identidade real no protocolo (Pokemon.toString do Showdown sem o desvio para `illusion.fullname`). */
function realIdentity(this: Pokemon): string {
	return this.isActive ? this.getSlot() + this.fullname.slice(2) : this.fullname;
}

/** O Showdown marca vários campos como readonly; aqui precisamos ajustá-los antes do início. */
type Writable<T> = { -readonly [K in keyof T]: T[K] };

function applyPersistentState(readonlyPokemon: Pokemon) {
	const pokemon = readonlyPokemon as Writable<Pokemon>;
	const set = pokemon.set as PokemonSet & CobblemonSetExtras;
	if (set.uuid) {
		// O intérprete identifica Pokémon por "p1a: <uuid>"; o Showdown corta nomes em 20 caracteres.
		pokemon.name = set.uuid;
		pokemon.fullname = `${pokemon.side.id}: ${set.uuid}`;
	}
	// Illusion: a identidade no protocolo é sempre a real (o disfarce vai em `[is]`, installIllusionIdentity).
	Object.defineProperty(pokemon, "toString", { value: realIdentity, configurable: true, writable: true });
	// Frente msd-fase1: Terastal liberado no motor como no Cobblemon 1.8.2; quem bloqueia é o sanitize do request
	// (item-chave `cobblemon:tera_orb`, battle/Gimmicks.ts). O tipo Tera do PokemonData pode vir em minúsculas
	// (`tera_type=fire`): o Showdown compara tipos pelo nome ("Fire"), então é normalizado aqui.
	normalizeTeraType(pokemon);
	if (typeof set.currentHealth === "number") {
		pokemon.hp = Math.max(0, Math.min(pokemon.maxhp, Math.round(set.currentHealth)));
		if (pokemon.hp === 0) pokemon.fainted = true;
	}
	if (set.status && set.status !== "fnt") {
		const status = pokemon.battle.dex.conditions.get(set.status);
		pokemon.status = status.id;
		pokemon.statusState = { id: status.id, target: pokemon, effectOrder: 0 } as Pokemon["statusState"];
		if (status.id === "slp") pokemon.statusState.time = set.statusDuration ?? pokemon.battle.random(1, 4);
		if (status.id === "tox") pokemon.statusState.stage = 0;
	}
	set.movesInfo?.forEach((info, i) => {
		for (const slots of [pokemon.moveSlots, pokemon.baseMoveSlots]) {
			const slot = slots[i];
			if (!slot) continue;
			slot.maxpp = info.maxPp;
			slot.pp = Math.max(0, Math.min(info.maxPp, info.pp));
		}
	});
}

/** Tipo Tera pelo nome do Showdown ("fire" → "Fire"); tipo desconhecido volta ao primeiro tipo do Pokémon. */
function normalizeTeraType(pokemon: Writable<Pokemon>) {
	const raw = (pokemon.set as PokemonSet & { teraType?: string }).teraType;
	if (!raw) return;
	const type = pokemon.battle.dex.types.get(raw);
	const name = type.exists ? type.name : pokemon.types[0];
	pokemon.teraType = name;
	if (typeof pokemon.canTerastallize === "string") pokemon.canTerastallize = name;
}

/** UUID do Pokémon no Showdown (o adaptador usa o UUID do PokemonData como nome). */
export function simPokemonUUID(pokemon: Pokemon): string {
	return (pokemon.set as PokemonSet & CobblemonSetExtras).uuid ?? pokemon.name;
}

/** Procura um Pokémon (ativo ou no banco) pelo UUID em qualquer lado da batalha. */
export function findSimPokemon(battle: Battle | null | undefined, uuid: string): Pokemon | undefined {
	if (!battle) return undefined;
	for (const side of battle.sides) {
		const found = side?.pokemon.find(pokemon => simPokemonUUID(pokemon) === uuid);
		if (found) return found;
	}
	return undefined;
}

// ---------------------------------------------------------------------------------------------
// Itens da mochila (`useitem`)
// ---------------------------------------------------------------------------------------------

/** Uso de item pedido numa escolha: `useitem <uuid-alvo> <nome do item> <script> [dados...]`. */
export interface BagItemChoice {
	targetUuid: string;
	/** Chave de tradução do item (ex.: item.cobblemon.potion), usada na linha `|bagitem|`. */
	itemName: string;
	/** Um dos scripts de `BAG_ITEM_SCRIPTS` (potion, revive, x_stat...). */
	script: string;
	data: string[];
}

/** Monta a parte da escolha (formato do fork do Cobblemon). */
export function bagItemChoiceString(choice: BagItemChoice): string {
	return ["useitem", choice.targetUuid, choice.itemName, choice.script, ...choice.data].join(" ");
}

export function parseBagItemChoice(text: string): BagItemChoice | undefined {
	const [kind, targetUuid, itemName, script, ...data] = text.trim().split(/\s+/);
	if (kind !== "useitem" || !targetUuid || !itemName || !script) return undefined;
	return { targetUuid, itemName, script, data };
}

type BagItemScript = (battle: Battle, pokemon: Pokemon, itemName: string, data: string[]) => void;

/** Efeito que aparece no `[from]` das mensagens, como o fork faz com `bagitem: <item>`. */
function bagItemEffect(battle: Battle, itemName: string) {
	const base = battle.dex.conditions.get("bagitem");
	return Object.assign(Object.create(base), { effectType: "BagItem", name: itemName, id: toID(itemName), fullname: `bagitem: ${itemName}` });
}

/** Porte dos 11 scripts de `data/cobblemon/bag_items/*.js` do Cobblemon 1.8.2. */
export const BAG_ITEM_SCRIPTS: Record<string, BagItemScript> = {
	potion(battle, pokemon, itemName, data) {
		const amount = pokemon.heal(parseInt(data[0]));
		if (amount) battle.add("-heal", pokemon, pokemon.getHealth, "[from] bagitempotion");
	},
	potion_by_portion(battle, pokemon, itemName, data) {
		const ratio = parseFloat(data[0]);
		const amount = pokemon.heal(Math.floor(pokemon.maxhp * ratio));
		if (amount) {
			battle.add("-heal", pokemon, pokemon.getHealth, "[from] bagitempotion");
			if (data[1] && data[1] !== "false") pokemon.addVolatile("confusion");
		}
	},
	full_restore(battle, pokemon) {
		const amount = pokemon.heal(pokemon.maxhp - pokemon.hp);
		if (amount) battle.add("-heal", pokemon, pokemon.getHealth, "[from] bagitemfullrestore");
		pokemon.cureStatus();
		pokemon.removeVolatile("confusion");
	},
	revive(battle, pokemon, itemName, data) {
		const writable = pokemon as Writable<Pokemon>;
		const healthRatio = parseFloat(data[0]);
		if (!pokemon.fainted) return;
		// Desmaiado ainda ocupando uma posição ativa (duplas sem reserva): volta ao campo na hora.
		if (pokemon.position < pokemon.side.active.length) {
			battle.queue.addChoice({ choice: "instaswitch", pokemon, target: pokemon } as never);
		}
		writable.fainted = false;
		writable.faintQueued = false;
		writable.subFainted = false;
		pokemon.side.pokemonLeft++;
		writable.hp = 1;
		writable.status = "";
		pokemon.sethp(Math.max(1, Math.floor(healthRatio * pokemon.maxhp)));
		battle.add("-heal", pokemon, pokemon.getHealth, "[from] bagitemrevive");
	},
	cure_status(battle, pokemon, itemName, data) {
		// Sem lista (Heal Powder): cura qualquer status persistente.
		const statuses = data.length ? data : ["brn", "frz", "par", "psn", "tox", "slp"];
		if (pokemon.status && statuses.includes(pokemon.status)) pokemon.cureStatus();
		for (const status of statuses) {
			if (status !== pokemon.status && pokemon.volatiles[status]) pokemon.removeVolatile(status);
		}
	},
	x_stat(battle, pokemon, itemName, data) {
		battle.boost({ [data[0]]: parseInt(data[1]) }, pokemon, null, bagItemEffect(battle, itemName));
	},
	dire_hit(battle, pokemon) {
		pokemon.addVolatile("focusenergy");
	},
	guard_spec(battle, pokemon) {
		pokemon.addVolatile("mist");
	},
	ether(battle, pokemon, itemName, data) {
		const amount = data.length > 1 ? parseInt(data[1]) : 999;
		restorePP(pokemon, amount, toID(data[0]));
	},
	elixir(battle, pokemon, itemName, data) {
		const amount = data.length > 0 ? parseInt(data[0]) : 999;
		restorePP(pokemon, amount);
	},
	clear_boost(battle, pokemon, itemName) {
		const boosts: Record<string, number> = {};
		for (const boost in pokemon.boosts) boosts[boost] = 0;
		pokemon.setBoost(boosts);
		battle.add("-clearboost", pokemon, `[from] bagitem: ${itemName}`);
	},
};

function restorePP(pokemon: Pokemon, amount: number, moveId?: string) {
	// moveSlots normalmente compartilha os objetos de baseMoveSlots; atualizamos os dois por segurança.
	for (const slots of [pokemon.baseMoveSlots, pokemon.moveSlots]) {
		for (const slot of slots) {
			if (moveId && slot.id !== moveId) continue;
			slot.pp = Math.min(slot.maxpp, slot.pp + amount);
		}
	}
}

/** Ação `useitem` na fila do turno. */
interface BagItemAction {
	choice: "useitem";
	order: number;
	priority: number;
	pokemon: Pokemon;
	side: Side;
	bagItem: BagItemChoice;
}

/**
 * Ensina a batalha a aceitar `useitem` e `skip` numa escolha (ex.: `useitem <uuid> item.cobblemon.potion potion 20, move 1`).
 * Cada parte `useitem`/`skip` ocupa a vez de um Pokémon ativo, como o `forceChoose` do Cobblemon.
 */
function installBagItemSupport(battle: Battle) {
	const originalChoose = battle.choose.bind(battle);
	battle.choose = (sideid, input) => {
		if (!/(^|,)\s*(useitem\s|skip\s*($|,))/.test(input)) return originalChoose(sideid, input);
		const side = battle.getSide(sideid);
		if (!side.requestState) return side.emitChoiceError(`Can't do anything: It's not your turn`);
		if (side.requestState !== "move") return side.emitChoiceError(`Can't use an item: items can only replace a move`);
		const parts = input.split(",");
		if (parts.length > side.active.length)
			return side.emitChoiceError(`Can't make choices: You sent choices for ${parts.length} Pokémon, but this is a ${battle.gameType} game!`);
		side.clearChoice();
		// Side.choose() limpa a escolha a cada chamada; aqui cada parte é processada separadamente.
		const writableSide = side as unknown as { clearChoice: () => void };
		writableSide.clearChoice = () => { };
		try {
			for (const part of parts) {
				const text = part.trim();
				const ok = text.startsWith("useitem ") ? chooseBagItem(battle, side, text)
					: text === "skip" ? chooseSkip(side)
						: side.choose(text);
				if (!ok || side.choice.error) return false;
			}
		}
		finally {
			delete (writableSide as { clearChoice?: unknown }).clearChoice;
		}
		if (!side.isChoiceDone()) return side.emitChoiceError(`Incomplete choice: ${input} - missing other pokemon`);
		if (battle.allChoicesDone()) battle.commitChoices();
		return true;
	};

	const originalRunAction = battle.runAction.bind(battle);
	battle.runAction = (action) => {
		if ((action as unknown as BagItemAction).choice === "useitem") runBagItem(battle, action as unknown as BagItemAction);
		return originalRunAction(action);
	};
}

/**
 * `skip`: o Pokémon perde a vez (o `pass` do fork, usado quando o jogador arremessa uma Poké Bola
 * durante a batalha). O `pass` do @pkmn/sim só é aceito para Pokémon desmaiados.
 */
function chooseSkip(side: Side): boolean {
	const index = side.getChoiceIndex();
	if (index >= side.active.length) return side.emitChoiceError(`Can't skip: You sent more choices than unfainted Pokémon`);
	side.choice.actions.push({ choice: "pass" } as never);
	return true;
}

function chooseBagItem(battle: Battle, side: Side, text: string): boolean {
	const choice = parseBagItemChoice(text);
	if (!choice) return side.emitChoiceError(`Invalid item choice: ${text}`);
	const index = side.getChoiceIndex();
	if (index >= side.active.length) return side.emitChoiceError(`Can't use an item: You sent more choices than unfainted Pokémon`);
	const user = side.active[index];
	const allies = [side, side.allySide].filter((it): it is Side => !!it);
	const target = allies.flatMap(it => it.pokemon).find(pokemon => simPokemonUUID(pokemon) === choice.targetUuid);
	if (!target) return side.emitChoiceError(`Can't use an item: ${choice.targetUuid} is not in your party`);
	if (!BAG_ITEM_SCRIPTS[choice.script]) return side.emitChoiceError(`Can't use an item: unknown item script ${choice.script}`);
	const action: BagItemAction = { choice: "useitem", order: BAG_ITEM_ACTION_ORDER, priority: 0, pokemon: user, side, bagItem: choice };
	side.choice.actions.push(action as never);
	return true;
}

function runBagItem(battle: Battle, action: BagItemAction) {
	const { bagItem } = action;
	const allies = [action.side, action.side.allySide].filter((it): it is Side => !!it);
	const target = allies.flatMap(it => it.pokemon).find(pokemon => simPokemonUUID(pokemon) === bagItem.targetUuid);
	if (!target) return;
	battle.add("bagitem", bagItem.targetUuid, bagItem.itemName);
	BAG_ITEM_SCRIPTS[bagItem.script]?.(battle, target, bagItem.itemName, bagItem.data);
}
