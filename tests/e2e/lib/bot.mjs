// Bot de protocolo (bedrock-protocol) que entra no BDS de teste como um jogador de verdade.
// Tudo o que o add-on faz chega pela rede: forms (modal_form_request), chat (text), títulos
// (set_title), entidades (add_entity/remove_entity), inventário (inventory_content/slot).
//
// Requisitos do servidor: online-mode=false e transport=raknet (veja docs/E2E.md).
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
// As dependências ficam isoladas em tools/e2e (Node ≥ 24), fora do package.json da raiz.
const require = createRequire(join(root, "tools", "e2e", "package.json"));

// O BDS 1.26.5x só aceita RakNet protocolo 11; o jsp-raknet 2.2 manda 10 fixo (responde
// IncompatibleProtocolVersion). Troca só o byte de protocolo do OpenConnectionRequest1.
const { Client: RakClient } = require("jsp-raknet");
const OpenConnectionRequest1 = require("jsp-raknet/js/protocol/OpenConnectionRequest1").default;
const RAKNET_PROTOCOL = 11;
RakClient.prototype.sendConnectionRequest = function () {
	const packet = new OpenConnectionRequest1();
	packet.mtuSize = this.mtuSize;
	packet.protocol = RAKNET_PROTOCOL;
	packet.encode();
	this.sendBuffer(packet.buffer);
};
// O jsp-raknet processa no máximo 4 datagramas por tick (100/s) e manda os ACKs só depois. Com o fluxo
// do BDS (chunks + centenas de entidades do add-on) a fila cresce, os ACKs atrasam, o servidor reenvia e a
// conexão "para" por dezenas de segundos. Esvazia a fila inteira a cada tick.
const { Connection: RakConnection } = require("jsp-raknet/js/Connection");
const rakUpdate = RakConnection.prototype.update;
RakConnection.prototype.update = function (timestamp) {
	while (this.recvQueue.length > 4) this.receiveOnline(this.recvQueue.shift());
	return rakUpdate.call(this, timestamp);
};
// As janelas de recepção do jsp-raknet têm tamanho fixo (256). Um datagrama perdido segura o início da
// janela para sempre (o reenvio chega com outro número de sequência); depois de 256 datagramas os novos são
// descartados — mas já foram confirmados com ACK, então o servidor não reenvia — e a conexão para de vez
// (o bot "some" logo depois do spawn, com o servidor achando que está tudo bem). Troca pelas versões abaixo:
// sem limite superior e sem esperar por números de datagrama que nunca vão chegar.
const { SlidingReceiveWindow, SlidingOrderedWindow } = require("jsp-raknet/js/SlidingWindow");
const DATAGRAM_GAP = 512;
SlidingReceiveWindow.prototype.set = function (index, data) {
	this.seen ??= new Map();
	if (index < this.windowStart || this.seen.has(index)) return;
	this.seen.set(index, data);
	this.newest = Math.max(this.newest, index);
};
SlidingReceiveWindow.prototype.read = function () {
	this.seen ??= new Map();
	const missing = [];
	const have = [];
	for (let i = this.windowStart; i <= this.newest; i++) {
		const value = this.seen.get(i);
		if (value === undefined) missing.push(i);
		else if (value !== true) { have.push(value); this.seen.set(i, true); }
	}
	while (this.seen.get(this.windowStart) === true) this.seen.delete(this.windowStart++);
	// Buracos antigos não voltam com o mesmo número: esquece o que ficou mais de DATAGRAM_GAP para trás.
	if (this.newest - this.windowStart > DATAGRAM_GAP) {
		for (let i = this.windowStart; i < this.newest - DATAGRAM_GAP; i++) this.seen.delete(i);
		this.windowStart = this.newest - DATAGRAM_GAP;
	}
	return [missing, have];
};
SlidingOrderedWindow.prototype.set = function (index, data) {
	this.pending ??= new Map();
	if (index < this.windowStart) return;
	this.pending.set(index, data);
	this.newest = Math.max(this.newest, index);
};
SlidingOrderedWindow.prototype.read = function (onLost) {
	this.pending ??= new Map();
	const out = [];
	while (this.pending.has(this.windowStart)) {
		out.push(this.pending.get(this.windowStart));
		this.pending.delete(this.windowStart++);
	}
	if (this.newest >= this.windowStart && this.pending.size) onLost?.(this.windowStart);
	return out;
};
const bedrock = require("bedrock-protocol");

export const DEFAULTS = {
	host: process.env.E2E_HOST ?? "127.0.0.1",
	port: Number(process.env.COBBLEMON_BDS_PORT ?? 19148),
	version: process.env.E2E_VERSION ?? "1.26.51",
};

/** Erro de asserção/timeout do E2E (o runner mostra a mensagem e o contexto). */
export class E2EError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (id) => String(id);

/** Texto "plano" de um rawtext/texto do Bedrock: `translate` vira `{chave}` para asserts sem idioma. */
export function flatText(value) {
	if (value == null) return "";
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed.startsWith("{")) {
			try { return flatText(JSON.parse(trimmed)); } catch { /* texto comum */ }
		}
		return value;
	}
	if (Array.isArray(value)) return value.map(flatText).join("");
	if (typeof value === "object") {
		if (value.rawtext) return flatText(value.rawtext);
		let out = "";
		if (value.text !== undefined) out += value.text;
		if (value.translate !== undefined) {
			out += `{${value.translate}}`;
			const args = value.with?.rawtext ?? value.with;
			if (args && (Array.isArray(args) ? args.length : true)) out += `(${flatText(args)})`;
		}
		if (value.score) out += `{score}`;
		if (value.selector) out += `{${value.selector}}`;
		return out;
	}
	return String(value);
}

/** Normaliza o JSON de um form em { id, kind, title, body, buttons[], elements[], raw }. */
function parseForm(packet) {
	let data;
	try { data = JSON.parse(packet.data); } catch { data = { type: "invalid", raw: packet.data }; }
	const kind = data.type === "form" ? "action" : data.type === "modal" ? "message" : data.type === "custom_form" ? "modal" : data.type;
	// ActionForm do 2.x manda os botões dentro de "elements" (junto com header/label/divider).
	const buttonsSrc = data.buttons ?? (data.elements ?? []).filter((e) => e.type === "button" || e.type === undefined && kind === "action");
	const buttons = kind === "message"
		? [flatText(data.button1), flatText(data.button2)]
		: kind === "action" ? buttonsSrc.map((b) => flatText(b.text)) : [];
	const images = kind === "action" ? buttonsSrc.map((b) => b.image?.data ?? "") : [];
	const elements = kind === "modal" ? (data.content ?? []).map((e) => ({ type: e.type, text: flatText(e.text), options: (e.options ?? e.steps ?? []).map(flatText), default: e.default })) : [];
	return {
		id: packet.form_id,
		kind,
		title: flatText(data.title),
		body: flatText(data.content && kind !== "modal" ? data.content : data.body ?? ""),
		buttons,
		images,
		elements,
		raw: data,
		at: Date.now(),
		answered: false,
	};
}

/** Texto de um pacote `text` (json → rawtext achatado; translation → {chave}(params)). */
function textOf(p) {
	if (p.type === "translation" || p.type === "popup" || p.type === "jukebox_popup") {
		return `{${p.message.replace(/^%/, "")}}(${(p.parameters ?? []).join(",")})`;
	}
	return flatText(p.message ?? "");
}

export class Bot {
	/**
	 * Conecta e espera o spawn.
	 * @param {string} name nome do jogador (≤ 15 caracteres; a identidade offline é derivada do nome)
	 */
	static async connect(name, options = {}) {
		const bot = new Bot(name, options);
		try {
			await bot._connect(options.spawnTimeout ?? 150_000);
		} catch (e) {
			// Anexa o bot ao erro para o runner mostrar o que chegou antes da falha.
			e.bot = bot;
			await bot.close();
			throw e;
		}
		return bot;
	}

	constructor(name, options) {
		this.name = name;
		this.options = { ...DEFAULTS, ...options };
		/** runtime_id → { runtimeId, uniqueId, type, position, metadata, properties } */
		this.entities = new Map();
		this.forms = [];          // todos os forms recebidos (histórico para diagnóstico)
		this.texts = [];          // { at, type, text, raw }
		this.titles = [];         // { at, type, text }
		this.commandOutputs = []; // saídas de comando
		this.inventory = [];      // janela 0 (inventário do jogador): slot → item
		this.selectedSlot = 0;
		this.position = { x: 0, y: 0, z: 0 };
		this.rotation = { pitch: 0, yaw: 0 };
		this.runtimeId = undefined;
		this.closed = false;
		this.disconnectReason = undefined;
		this.log = [];            // últimas linhas de eventos (para o dump de falha)
		this._waiters = new Set();
		this._tick = 0n;
	}

	_note(line) {
		this.log.push(`${new Date().toISOString().slice(11, 23)} ${line}`);
		if (this.log.length > 300) this.log.splice(0, this.log.length - 300);
	}

	_connect(timeout) {
		const client = bedrock.createClient({
			host: this.options.host,
			port: this.options.port,
			username: this.name,
			offline: true,
			version: this.options.version,
			transport: "raknet",
			raknetBackend: "jsp-raknet",
			// Sem workers: o patch do protocolo RakNet acima só vale na thread principal.
			useRaknetWorkers: false,
			skipPing: true,
			viewDistance: 4,
			connectTimeout: 30_000,
			conLog: null,
		});
		this.client = client;
		client.on("error", (e) => this._note(`error ${e?.message ?? e}`));
		// Linha do tempo do login (1ª vez de cada pacote) para diagnosticar entradas que não terminam.
		const firstSeen = new Set();
		client.on("packet", (d) => {
			this.lastPacketAt = Date.now();
			this.packetCount = (this.packetCount ?? 0) + 1;
			const n = d.data?.name;
			if (!this.runtimeId || !firstSeen.has(n)) {
				if (firstSeen.has(n)) return;
				firstSeen.add(n);
				this._note(`1º ${n}${n === "play_status" ? ` ${d.data.params.status}` : ""}`);
			}
		});
		client.on("play_status", (p) => this._note(`play_status ${p.status}`));

		this.itemStates = [];
		client.on("item_registry", (p) => { this.itemStates = p.itemstates ?? []; });
		client.on("start_game", (p) => {
			this.runtimeId = p.runtime_entity_id;
			this.uniqueId = p.entity_id; // set_entity_link usa o unique id
			this.position = { ...p.player_position };
			this._tick = BigInt(p.current_tick ?? 0);
		});
		client.on("move_player", (p) => {
			if (this.runtimeId !== undefined && BigInt(p.runtime_id) === BigInt(this.runtimeId)) {
				this.position = { ...p.position };
				this._teleports = (this._teleports ?? 0) + 1;
				this._notify();
			}
		});
		// Movimento com autoridade do servidor: ele corrige a posição que o bot manda.
		client.on("correct_player_move_prediction", (p) => {
			if (p.prediction_type === "player" || p.prediction_type === 0) this.position = { ...p.position };
		});
		client.on("respawn", (p) => {
			if (p.runtime_entity_id === undefined || BigInt(p.runtime_entity_id) === BigInt(this.runtimeId ?? -1)) this.position = { ...p.position };
		});
		// O mundo usa pedido de sub-chunks: sem pedir, o cliente real não recebe os blocos (e o
		// servidor demora mais para considerar o jogador pronto).
		client.on("level_chunk", (p) => {
			const top = p.highest_subchunk_count ?? 24;
			const requests = [];
			for (let y = -4; y <= top - 4; y++) requests.push({ x: 0, y, z: 0 });
			client.queue("subchunk_request", { dimension: p.dimension, origin: { x: p.x, y: 0, z: p.z }, requests });
		});

		client.on("add_entity", (p) => {
			const e = { runtimeId: p.runtime_id, uniqueId: p.unique_id, type: p.entity_type, position: { ...p.position }, metadata: p.metadata, properties: p.properties, at: Date.now() };
			this.entities.set(key(p.runtime_id), e);
			this._note(`add_entity ${p.entity_type} rid=${p.runtime_id} @${fmtPos(p.position)}`);
			this._notify();
		});
		client.on("add_item_entity", (p) => {
			const e = { runtimeId: p.runtime_entity_id, uniqueId: p.entity_id_self, type: "minecraft:item", item: p.item, position: { ...p.position }, at: Date.now() };
			this.entities.set(key(p.runtime_entity_id), e);
			this._note(`add_item_entity ${this.itemName(p.item?.network_id) ?? p.item?.network_id} @${fmtPos(p.position)}`);
			this._notify();
		});
		client.on("add_player", (p) => {
			const e = { runtimeId: p.runtime_id, uniqueId: p.unique_id ?? p.unique_entity_id, type: "minecraft:player", name: p.username, position: { ...p.position }, at: Date.now() };
			this.entities.set(key(p.runtime_id), e);
			this._notify();
		});
		client.on("remove_entity", (p) => {
			for (const [k, e] of this.entities) if (BigInt(e.uniqueId) === BigInt(p.entity_id_self)) {
				this.entities.delete(k);
				this._note(`remove_entity ${e.type} rid=${k}`);
			}
			this._notify();
		});
		client.on("move_entity", (p) => {
			const e = this.entities.get(key(p.runtime_entity_id));
			if (e) e.position = { ...p.position };
		});
		client.on("move_entity_delta", (p) => {
			const e = this.entities.get(key(p.runtime_entity_id));
			if (!e) return;
			if (p.x !== undefined) e.position.x = p.x;
			if (p.y !== undefined) e.position.y = p.y;
			if (p.z !== undefined) e.position.z = p.z;
		});
		// O "tick" do player_auth_input acompanha o tick do servidor (vem nos pacotes de entidade).
		client.on("set_entity_data", (p) => { if (p.tick && BigInt(p.tick) > this._tick) this._tick = BigInt(p.tick); });
		client.on("set_entity_data", (p) => {
			const e = this.entities.get(key(p.runtime_entity_id));
			if (e) { e.metadata = p.metadata; e.properties = p.properties; }
		});

		client.on("modal_form_request", (p) => {
			const form = parseForm(p);
			this.forms.push(form);
			this._note(`form#${form.id} ${form.kind} "${form.title}" [${form.buttons.join(" | ")}]${form.elements.length ? ` elements=${JSON.stringify(form.elements.map((e) => e.type + ":" + e.text))}` : ""}`);
			this._notify();
		});
		// O servidor fechou os forms abertos (uiManager.closeAllForms): eles não aceitam mais resposta.
		client.on("clientbound_close_form", () => {
			for (const f of this.forms) if (!f.answered) { f.answered = true; f.closedByServer = true; }
			this._note("servidor fechou os forms abertos");
			this._notify();
		});
		client.on("text", (p) => {
			const t = { at: Date.now(), type: p.type, text: textOf(p), raw: p.message };
			this.texts.push(t);
			this._note(`text(${p.type}) ${t.text.slice(0, 300)}`);
			this._notify();
		});
		client.on("set_title", (p) => {
			const t = { at: Date.now(), type: p.type, text: flatText(p.text) };
			this.titles.push(t);
			if (this.titles.length > 500) this.titles.splice(0, 100);
			if (p.type !== "action_bar_message" && p.type !== "action_bar_message_json") this._note(`title(${p.type}) ${t.text.slice(0, 200)}`);
			this._notify();
		});
		client.on("command_output", (p) => {
			this.commandOutputs.push({ at: Date.now(), uuid: p.origin?.uuid, success: p.success_count > 0, output: p.output });
			this._notify();
		});
		client.on("inventory_content", (p) => {
			if (p.window_id === "inventory" || p.window_id === 0) {
				this.inventory = p.input.slice();
				this._notify();
			}
		});
		client.on("inventory_slot", (p) => {
			if (p.window_id === "inventory" || p.window_id === 0) {
				this.inventory[p.slot] = p.item;
				this._notify();
			}
		});
		// Pegar item do chão: o BDS avisa com um inventory_transaction "normal" (ação container/janela 0 → new_item),
		// não com inventory_slot. Sem isto o bot manda held_item vazio no próximo item_use_on_entity, o BDS vê a
		// divergência com a mão real e descarta a interação em silêncio (só reenvia o inventory_content depois).
		client.on("inventory_transaction", (p) => {
			const tx = p.transaction;
			if (tx?.transaction_type !== "normal") return;
			let changed = false;
			for (const a of tx.actions ?? []) {
				if (a.source_type === "container" && (a.window_id === "inventory" || a.window_id === 0) && a.new_item) {
					this.inventory[a.slot] = a.new_item;
					changed = true;
				}
			}
			if (changed) this._notify();
		});
		client.on("player_hotbar", (p) => { if (p.select_slot) this.selectedSlot = p.selected_slot; });

		client.on("disconnect", (p) => {
			this.disconnectReason = p.message ?? p.reason ?? JSON.stringify(p);
			this._note(`disconnect ${this.disconnectReason}`);
		});
		client.on("close", () => { this.closed = true; this._notify(); });

		return new Promise((resolveSpawn, rejectSpawn) => {
			const timer = setTimeout(() => rejectSpawn(new E2EError(`${this.name}: sem spawn em ${timeout} ms`)), timeout);
			client.once("spawn", () => {
				clearTimeout(timer);
				this._note("spawn");
				// O cliente oficial avisa o fim da tela de carregamento; sem isso o BDS 1.26 ignora o
				// player_auth_input e as interações (o jogador fica "carregando": não anda, não interage).
				client.queue("serverbound_loading_screen", { type: 1 });
				client.queue("serverbound_loading_screen", { type: 2 });
				if (this.options.input !== false) this._startInputLoop();
				resolveSpawn();
			});
			client.once("close", () => { clearTimeout(timer); rejectSpawn(new E2EError(`${this.name}: conexão fechada antes do spawn (${this.disconnectReason ?? "sem motivo"})`)); });
		});
	}

	/**
	 * Movimento com autoridade do servidor: o cliente manda player_auth_input todo tick. O bot fica
	 * parado na posição que o servidor informou (tp/move_player) e envia a rotação atual (mira).
	 */
	_startInputLoop() {
		this._inputTimer = setInterval(() => {
			if (this.closed) return;
			this._tick++;
			try {
				this.client.write("player_auth_input", {
					pitch: this.rotation.pitch, yaw: this.rotation.yaw, position: this.position,
					move_vector: this.moveVector ?? { x: 0, z: 0 }, head_yaw: this.rotation.yaw, input_data: this.inputData ?? [], input_mode: this.inputMode ?? "mouse", /* batalha-minimizavel: "touch" testa o duplo toque */
					play_mode: "normal", interaction_model: "crosshair", interact_rotation: { x: this.rotation.pitch, z: this.rotation.yaw },
					tick: this._tick, delta: { x: 0, y: 0, z: 0 }, analogue_move_vector: this.moveVector ?? { x: 0, z: 0 },
					camera_orientation: viewVector(this.rotation), raw_move_vector: this.moveVector ?? { x: 0, z: 0 },
				});
			} catch (e) { this._note(`player_auth_input falhou: ${e.message}`); }
		}, 50);
	}

	_notify() { for (const w of this._waiters) w(); }

	/** Espera `check()` devolver algo "truthy" (reavaliado a cada evento e a cada 250 ms). */
	waitUntil(check, timeout, what) {
		return new Promise((resolveWait, rejectWait) => {
			let timer, poll;
			const done = (fn, v) => { clearTimeout(timer); clearInterval(poll); this._waiters.delete(tryIt); fn(v); };
			const tryIt = () => {
				let v;
				try { v = check(); } catch (e) { return done(rejectWait, e); }
				if (v) done(resolveWait, v);
				else if (this.closed) done(rejectWait, new E2EError(`${this.name}: desconectado esperando ${what} (${this.disconnectReason ?? "?"})`));
			};
			timer = setTimeout(() => {
				// Sem pacote nenhum há muito tempo = conexão parada (servidor travado ou RakNet), não o add-on.
				const idle = this.lastPacketAt ? Date.now() - this.lastPacketAt : 0;
				const stalled = idle > Math.min(10_000, timeout * 0.8) ? ` [conexão parada: nenhum pacote há ${(idle / 1000).toFixed(0)} s]` : "";
				done(rejectWait, new E2EError(`${this.name}: timeout (${timeout} ms) esperando ${what}${stalled}`));
			}, timeout);
			poll = setInterval(tryIt, 250);
			this._waiters.add(tryIt);
			tryIt();
		});
	}

	// ------------------------------------------------------------------------------------------
	// Comandos

	/**
	 * Roda um comando como o jogador (o container dá operador a todos). Resolve com a saída do
	 * comando (ou null se o servidor não respondeu a tempo: comandos de script respondem depois).
	 */
	async command(cmd, { timeout } = {}) {
		// Comandos customizados (com namespace, ex.: cobblemon:party) não mandam command_output quando dão
		// certo: a resposta vem por chat/forms. Só esperamos um pouco por um possível erro.
		timeout ??= /^\/?[a-z0-9_]+:/i.test(cmd) ? 1000 : 15_000;
		const uuid = randomUUID();
		const line = cmd.startsWith("/") ? cmd : `/${cmd}`;
		this._note(`> ${line}`);
		this.client.queue("command_request", {
			command: line,
			origin: { type: "player", uuid, request_id: "", player_entity_id: 0n },
			internal: false,
			version: "latest",
		});
		try {
			const out = await this.waitUntil(() => this.commandOutputs.find((o) => o.uuid === uuid), timeout, `saída de ${line}`);
			const msgs = out.output.map((o) => `${o.message_id}(${o.parameters.join(",")})`).join("; ");
			this._note(`< ${out.success ? "ok" : "FALHOU"} ${msgs}`);
			return out;
		} catch { return null; }
	}

	/** Como command, mas falha se o comando voltar com erro. */
	async commandOk(cmd, opts) {
		const out = await this.command(cmd, opts);
		if (out && !out.success) throw new E2EError(`comando falhou: ${cmd} → ${out.output.map((o) => `${o.message_id}(${o.parameters.join(",")})`).join("; ")}`);
		return out;
	}

	/**
	 * Posição real do jogador no servidor: `/tp @s ~ ~ ~` faz o servidor mandar move_player com a
	 * posição (dos olhos). O querytarget exige permissão acima de operador.
	 */
	async queryPosition({ timeout = 60_000 } = {}) {
		const end = Date.now() + timeout;
		// Logo após o spawn o servidor às vezes ignora o comando: repete até a posição chegar.
		while (Date.now() < end) {
			const before = this._teleports ?? 0;
			this.command("tp @s ~ ~ ~", { timeout: 1 }).catch(() => {});
			try {
				await this.waitUntil(() => (this._teleports ?? 0) > before, 5000, "posição (move_player) após tp");
				return { ...this.position };
			} catch (e) {
				if (this.closed) throw e;
			}
		}
		throw new E2EError(`${this.name}: o servidor não respondeu ao /tp @s ~ ~ ~ em ${timeout} ms`);
	}

	/** Teleporta o bot (pelo próprio comando /tp) e espera a posição chegar. */
	async teleport(x, y, z) {
		await this.command(`tp @s ${x} ${y} ${z}`);
		await this.waitUntil(() => Math.abs(this.position.x - x) < 1.5 && Math.abs(this.position.z - z) < 1.5, 10_000, `teleporte para ${x} ${y} ${z}`);
		// dá tempo dos chunks chegarem
		await sleep(500);
	}

	// ------------------------------------------------------------------------------------------
	// Chat / títulos

	/** Marca o ponto atual dos logs (para esperar só o que chegar depois). */
	mark() { return { text: this.texts.length, title: this.titles.length, form: this.forms.length }; }

	/**
	 * Espera uma mensagem de chat que case com `match` (string contida, RegExp ou função).
	 * Chaves de tradução aparecem como `{chave}`.
	 */
	waitForText(match, { timeout = 10_000, since = 0 } = {}) {
		const test = matcher(match);
		return this.waitUntil(() => this.texts.slice(since).find((t) => test(t.text)), timeout, `texto ${describe(match)}`);
	}

	/** Espera título/subtítulo/actionbar. */
	waitForTitle(match, { timeout = 10_000, since = 0, actionbar } = {}) {
		const test = matcher(match);
		return this.waitUntil(() => this.titles.slice(since).find((t) => (actionbar === undefined || actionbar === t.type.startsWith("action_bar")) && test(t.text)), timeout, `título ${describe(match)}`);
	}

	// ------------------------------------------------------------------------------------------
	// Forms

	/**
	 * Espera o próximo form ainda não respondido que case com `match` (título contém / RegExp / função).
	 * Forms que chegaram antes da chamada também contam (evita corrida).
	 */
	waitForForm(match = () => true, { timeout = 15_000 } = {}) {
		const test = typeof match === "function" ? match : (f) => matcher(match)(f.title);
		return this.waitUntil(() => this.forms.find((f) => !f.answered && test(f)), timeout, `form ${describe(match)}`);
	}

	/** Índice do botão cujo texto (ou imagem) casa com `match`; erro se não houver. */
	buttonIndex(form, match) {
		const test = matcher(match);
		const i = form.buttons.findIndex((b, idx) => test(b) || test(form.images[idx] ?? ""));
		if (i < 0) throw new E2EError(`botão ${describe(match)} não existe no form "${form.title}": [${form.buttons.join(" | ")}]`);
		return i;
	}

	/**
	 * Responde um form: ActionForm → índice do botão (ou matcher do texto); MessageForm → 0/1
	 * (0 = button1, 1 = button2); ModalForm → array de valores.
	 */
	answerForm(form, value) {
		let payload = value;
		if (form.kind === "action" && typeof value !== "number") payload = this.buttonIndex(form, value);
		// MessageFormData: button1 = true, button2 = false no protocolo.
		if (form.kind === "message" && typeof value === "number") payload = value === 0;
		form.answered = true;
		this._note(`responde form#${form.id} "${form.title}" com ${JSON.stringify(payload)}${form.kind === "action" ? ` (${form.buttons[payload]})` : ""}`);
		this.client.queue("modal_form_response", { form_id: form.id, has_response_data: true, data: JSON.stringify(payload), has_cancel_reason: false });
		return payload;
	}

	/** Fecha o form (como apertar X/Esc). */
	closeForm(form, reason = "closed") {
		form.answered = true;
		this._note(`fecha form#${form.id} "${form.title}"`);
		this.client.queue("modal_form_response", { form_id: form.id, has_response_data: false, has_cancel_reason: true, cancel_reason: reason });
	}

	/** Espera um form e clica num botão; devolve o form. */
	async clickForm(formMatch, button, opts) {
		const form = await this.waitForForm(formMatch, opts);
		this.answerForm(form, button);
		return form;
	}

	// ------------------------------------------------------------------------------------------
	// Entidades

	/** Entidades conhecidas que casam com o filtro. */
	findEntities(filter = () => true) {
		return [...this.entities.values()].filter(filter);
	}

	/** Espera uma entidade que case (tipo exato ou função). */
	waitForEntity(filter, { timeout = 15_000 } = {}) {
		const test = typeof filter === "function" ? filter : (e) => e.type === filter;
		return this.waitUntil(() => this.findEntities(test).sort((a, b) => dist(a.position, this.position) - dist(b.position, this.position))[0], timeout, `entidade ${describe(filter)}`);
	}

	/** Espera a entidade sumir (remove_entity). */
	waitForEntityGone(entity, { timeout = 15_000 } = {}) {
		return this.waitUntil(() => !this.entities.has(key(entity.runtimeId)), timeout, `entidade ${entity.type} sumir`);
	}

	/** Item na mão (formato ItemV4 do inventário), ou item vazio. */
	heldItem(slot = this.selectedSlot) {
		return this.inventory[slot] ?? { network_id: 0, count: 0, metadata: 0, has_stack_id: false, block_runtime_id: 0, extra: { has_nbt: "false", can_place_on: [], can_destroy: [] } };
	}

	/** Olha para uma posição (atualiza a rotação mandada no player_auth_input). */
	lookAt(target) {
		const eye = { x: this.position.x, y: this.position.y, z: this.position.z };
		const dx = target.x - eye.x, dy = target.y - eye.y, dz = target.z - eye.z;
		const yaw = -Math.atan2(dx, dz) * 180 / Math.PI;
		const pitch = -Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI;
		this.rotation = { pitch, yaw };
	}

	/** Interage (botão direito) com uma entidade: dispara playerInteractWithEntity nos scripts. */
	interact(entity, action = "interact") {
		this.lookAt(entity.position);
		this._note(`${action} → ${entity.type} rid=${entity.runtimeId}`);
		this._sendTransaction({
			transaction: {
				legacy: { legacy_request_id: 0 },
				transaction_type: "item_use_on_entity",
				actions: [],
				transaction_data: {
					entity_runtime_id: entity.runtimeId,
					action_type: action,
					hotbar_slot: this.selectedSlot,
					held_item: this.heldItem(),
					player_pos: this.position,
					click_pos: { x: 0, y: 0, z: 0 },
				},
			},
		});
	}

	/** Bate na entidade (ataque corpo a corpo). */
	attack(entity) {
		this.client.queue("animate", { action_id: "swing_arm", runtime_entity_id: this.runtimeId, data: 0, has_swing_source: false });
		this.interact(entity, "attack");
	}

	/**
	 * Manda inventory_transaction. Item vazio (network_id 0): o bedrock-protocol 3.60 lê o "extra" de
	 * tamanho 0 como undefined e, ao serializar undefined, não escreve nem o varint do tamanho; o BDS
	 * então lê a posição do jogador fora de lugar e descarta o pacote (interagir/usar item não chegava
	 * aos scripts). Por isso o item vazio sempre leva um "extra" explícito.
	 */
	_sendTransaction(params) {
		const data = params.transaction.transaction_data;
		const empty = !data?.held_item?.network_id;
		if (data?.held_item) data.held_item = withExtra(data.held_item);
		let buf = this.client.serializer.createPacketBuffer({ name: "inventory_transaction", params });
		// Item vazio: o cliente oficial manda o "extra" com tamanho 0 (um byte 0x00), não 10 bytes zerados.
		if (empty) buf = replaceOnce(buf, EMPTY_EXTRA_BYTES, Buffer.from([0]));
		this.client.sendBuffer(buf);
	}

	/** Seleciona um espaço da hotbar (0–8). */
	async selectSlot(slot) {
		this.selectedSlot = slot;
		this.client.queue("mob_equipment", { runtime_entity_id: this.runtimeId, item: withExtra(this.heldItem(slot)), slot, selected_slot: slot, window_id: "inventory" });
		await sleep(250);
	}

	/** Espaço do inventário com um item cujo network_id é `networkId`. */
	findSlot(networkId) {
		return this.inventory.findIndex((it) => it && it.network_id === networkId);
	}

	/** network_id de um item pelo identificador (tabela item_registry do start_game). */
	itemNetworkId(identifier) {
		return this.itemStates.find((s) => s.name === identifier)?.runtime_id;
	}

	/** Nome do item de um network_id. */
	itemName(networkId) {
		return this.itemStates.find((s) => s.runtime_id === networkId)?.name;
	}

	/** Itens do inventário como [{ slot, name, count }]. */
	inventoryItems() {
		return this.inventory.map((it, slot) => ({ slot, name: it?.network_id ? this.itemName(it.network_id) : undefined, count: it?.count ?? 0 })).filter((x) => x.name);
	}

	/** Usa o item da mão no ar (clique direito sem bloco): dispara itemUse nos scripts. */
	useItem() {
		this._note(`usa item do espaço ${this.selectedSlot} (network_id=${this.heldItem().network_id}) pitch=${this.rotation.pitch.toFixed(1)} yaw=${this.rotation.yaw.toFixed(1)}`);
		this._sendTransaction({
			transaction: {
				legacy: { legacy_request_id: 0 },
				transaction_type: "item_use",
				actions: [],
				transaction_data: {
					action_type: "click_air",
					trigger_type: "player_input",
					block_position: { x: 0, y: 0, z: 0 },
					face: 255,
					hotbar_slot: this.selectedSlot,
					hand: "main_hand",
					held_item: this.heldItem(),
					player_pos: { x: this.position.x, y: this.position.y, z: this.position.z },
					click_pos: { x: 0, y: 0, z: 0 },
					block_runtime_id: 0,
					client_prediction: "success",
					client_cooldown_state: "off",
				},
			},
		});
	}

	/** Resumo do estado para o dump de falha. */
	dump({ forms = 5, lines = 60 } = {}) {
		const idle = this.lastPacketAt ? ((Date.now() - this.lastPacketAt) / 1000).toFixed(1) : "?";
		// Muitos segundos sem pacote com a conexão aberta = servidor travado ou canal RakNet parado.
		const out = [`--- bot ${this.name} (rid=${this.runtimeId}) pos=${fmtPos(this.position)} pacotes=${this.packetCount ?? 0} último há ${idle} s${this.disconnectReason ? ` desconectado: ${this.disconnectReason}` : ""}`];
		const last = this.forms.slice(-forms);
		if (last.length) {
			out.push(`últimos ${last.length} forms:`);
			for (const f of last) out.push(`  #${f.id} ${f.kind} title="${f.title}" body="${f.body.slice(0, 200)}" buttons=${JSON.stringify(f.buttons)}${f.elements.length ? ` elements=${JSON.stringify(f.elements)}` : ""}${f.answered ? " (respondido)" : ""}`);
		}
		out.push(`últimos eventos:`);
		for (const l of this.log.slice(-lines)) out.push(`  ${l}`);
		return out.join("\n");
	}

	async close() {
		if (this.closed) return;
		clearInterval(this._inputTimer);
		try { this.client.disconnect("e2e fim"); } catch { /* já fechado */ }
		this.closed = true;
		await sleep(200);
	}
}

// ---------------------------------------------------------------------------------------------
// utilidades

const EMPTY_EXTRA = { has_nbt: "false", can_place_on: [], can_destroy: [] };
// EMPTY_EXTRA serializado: varint 10 + has_nbt (u16) + 2 listas vazias (li32 cada).
const EMPTY_EXTRA_BYTES = Buffer.from([10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

function replaceOnce(buf, find, replacement) {
	const i = buf.indexOf(find);
	if (i < 0) throw new E2EError("serialização inesperada do item vazio");
	return Buffer.concat([buf.subarray(0, i), replacement, buf.subarray(i + find.length)]);
}

/** Garante o campo "extra" do ItemV4 (veja Bot._sendTransaction). */
function withExtra(item) {
	return item.extra === undefined ? { ...item, extra: EMPTY_EXTRA } : item;
}

function matcher(match) {
	if (typeof match === "function") return match;
	if (match instanceof RegExp) return (s) => match.test(s);
	return (s) => String(s).includes(match);
}

function describe(match) {
	if (typeof match === "function") return match.label ?? "(função)";
	return String(match);
}

export function dist(a, b) {
	return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function fmtPos(p) {
	return p ? `${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}` : "?";
}

function viewVector({ pitch, yaw }) {
	const p = pitch * Math.PI / 180, y = yaw * Math.PI / 180;
	return { x: -Math.sin(y) * Math.cos(p), y: -Math.sin(p), z: Math.cos(y) * Math.cos(p) };
}

export { sleep };
