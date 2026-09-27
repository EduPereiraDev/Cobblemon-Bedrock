/**
 * Entidade de NPC (`cobblemon:npc`, entity/npc/NPCEntity.kt): configuração persistida em dynamic properties,
 * struct MoLang `q.npc` (NPCServerDelegate + NPCMoLangFunctions, subconjunto usado pelos dados do 1.8.2),
 * interação (diálogo / script / custom_script), batalha de treinador (StrongBattleAI via battle API) e o
 * estado por jogador (cooldown, derrotado) nos dados MoLang do jogador (`get_npc_data`).
 *
 * Dynamic properties do NPC:
 *   npc:class (id da classe), npc:uuid, npc:level, npc:aspects (JSON), npc:config (JSON: variável → valor),
 *   npc:party (JSON: PokemonData[] do time estático), npc:name_key, npc:interaction (JSON, opcional),
 *   npc:hurt_by (id do último que bateu). Sobreposições do NPC à classe (editor/behaviours): npc:skill,
 *   npc:behaviours (JSON: lista editada), npc:hitbox (JSON), npc:hitbox_scale, npc:render_scale,
 *   npc:resource_identifier, npc:player_texture, npc:hide_name_tag, npc:invulnerable, npc:applied_aspects,
 *   npc:data (q.entity.data); npc:behaviour_groups guarda os grupos de componentes ligados.
 */
import { Dimension, Entity, Player, RawMessage, Vector3, system, world } from "@minecraft/server";
import {
  MOLANG_CALLBACKS, MOLANG_SCRIPTS, NPC_ANIMATIONS, NPC_BEHAVIOUR_GROUP_NAMES, NPC_HITBOX_HEIGHTS, NPC_HITBOX_WIDTHS, NPC_LANG,
  NPC_RESOLVERS, NPC_SKINS,
} from "../../generated/scripts/npcs";
import { MoArray, MoEnvironment, MoStruct, MoValue, asNumber, asString, isTruthy } from "./molang/MoLang";
import {
  MoLangConfigVariable, NPCClass, NPCInteraction, coerceConfig, defaultConfig, getNPCClass, getNPCClassIds, getNPCPresetIds,
  provideVariationAspects, withNamespace,
} from "./NPCClass";
import { createPartyStruct, hashString, partyOfStruct, provideParty } from "./Party";
import { BehaviourDefinition, BehaviourTask, behaviourEffects, behaviourVariables, resolveBehaviours } from "./Behaviours";
import { createPlayerStruct, getNpcData, saveMoLangData, worldTime } from "./PlayerStruct";
import { getDialogue } from "./dialogue/Dialogue";
import { startDialogue } from "./dialogue/DialogueManager";
import { PokemonData } from "../Pokemon";
import { healPokemon } from "../pokemonStorage";
import { BattleFormat, BattleTeamOptions, battleMap, startNPCBattle, tryGetBattleFromEntity } from "../battle";
import { message } from "../language";
import { UUID } from "../utils";
import { applyNpcFlags, effectiveNpcFlags, setNpcFlag } from "./NpcFlags"; // frente dados-ia
import { pokemonModelHitbox, pokemonModelSpecies } from "./PokemonModelData"; // frente limites-a

export const NPC_ENTITY_ID = "cobblemon:npc";
export const NPC_SKIN_PROPERTY = "cobblemon:npc_skin";
export const NPC_RENDER_SCALE_PROPERTY = "cobblemon:npc_render_scale";

const PROP = {
  class: "npc:class",
  uuid: "npc:uuid",
  level: "npc:level",
  aspects: "npc:aspects",
  config: "npc:config",
  party: "npc:party",
  nameKey: "npc:name_key",
  interaction: "npc:interaction",
  hurtBy: "npc:hurt_by",
  skill: "npc:skill",
  behaviours: "npc:behaviours",
  behaviourGroups: "npc:behaviour_groups",
  goingToHealer: "npc:going_to_healer",
  hitbox: "npc:hitbox",
  hitboxScale: "npc:hitbox_scale",
  renderScale: "npc:render_scale",
  resourceIdentifier: "npc:resource_identifier",
  playerTexture: "npc:player_texture",
  hideNameTag: "npc:hide_name_tag",
  invulnerable: "npc:invulnerable",
  appliedAspects: "npc:applied_aspects",
  data: "npc:data",
} as const;

/**
 * Frente limites-a: chamados quando a aparência ou o tamanho do NPC muda (skin/resourceIdentifier, escala, hitbox,
 * carregamento). O modelo de Pokémon (scripts/npc/PokemonModel.ts) se registra aqui, sem import circular.
 */
export const npcAppearanceHooks: Array<(npc: NPC) => void> = [];

/** Chamados depois de cada refreshNameTag (NpcHide.ts reaplica o nome escondido por jogador no mesmo tick). */
export const npcNameTagHooks: Array<(npc: NPC) => void> = [];

function notifyAppearance(npc: NPC) {
  for (const hook of npcAppearanceHooks) {
    try { hook(npc); }
    catch (e) { console.warn(`NPC: aparência de ${npc.entity.id}: ${e}`); }
  }
}

export function isNPCEntity(entity: Entity | undefined): boolean {
  try { return !!entity && entity.isValid && entity.typeId === NPC_ENTITY_ID; }
  catch { return false; }
}

// ---------------------------------------------------------------------------------------------
// Nome e skin

/** Texto de um nome de NPC (chave "npc.*" do Cobblemon ou literal). nameTag não traduz: usa o idioma pedido. */
export function resolveNPCName(key: string, language = "en_US"): string {
  const entry = NPC_LANG[key];
  return entry?.[language] ?? entry?.en_US ?? key;
}

/** Skin (índice de cobblemon:npc_skin) para o resourceIdentifier + aspects, como os resolvers de variação. */
export function resolveSkin(resourceIdentifier: string, aspects: readonly string[]): number {
  const resolvers = NPC_RESOLVERS[withNamespace(resourceIdentifier)] ?? NPC_RESOLVERS["cobblemon:npc"] ?? [];
  let model: string | undefined;
  let texture: string | undefined;
  for (const resolver of resolvers) {
    for (const variation of resolver.variations) {
      if (!variation.aspects.every(a => aspects.includes(a))) continue;
      // Só aceita a troca se o par resultante existir (steve/alex dependem da skin do jogador).
      const nextModel = variation.model ?? model;
      const nextTexture = variation.texture ?? texture;
      if (nextModel && nextTexture && NPC_SKINS.some(s => s.model === nextModel && s.texture === nextTexture)) {
        model = nextModel;
        texture = nextTexture;
      }
    }
  }
  const index = NPC_SKINS.findIndex(s => s.model === model && s.texture === texture);
  return index >= 0 ? index : 0;
}

// ---------------------------------------------------------------------------------------------
// Estado transitório (atividade do cérebro do NPC e batalhas em andamento)

type Activity = "minecraft:idle" | "cobblemon:npc_chatting" | "cobblemon:action_effect";
const activities = new Map<string, Activity>();
/** NPC → jogador com quem conversa (look_at_speaker). */
const speakers = new Map<string, string>();

interface NPCBattleRecord {
  npcId: string;
  playerId: string;
  team: PokemonData[];
  staticParty: boolean;
}
const battles = new Map<string, NPCBattleRecord>();

function readJson<T>(entity: Entity, key: string, fallback: T): T {
  try {
    const raw = entity.getDynamicProperty(key);
    return typeof raw === "string" ? (JSON.parse(raw) as T) : fallback;
  }
  catch { return fallback; }
}

// ---------------------------------------------------------------------------------------------
// NPC

export class NPC {
  private cachedClass?: NPCClass;
  private cachedStruct?: MoStruct;

  constructor(public readonly entity: Entity) { }

  static from(entity: Entity | undefined): NPC | undefined {
    return entity && isNPCEntity(entity) ? new NPC(entity) : undefined;
  }

  get classId(): string {
    const id = this.entity.getDynamicProperty(PROP.class);
    return typeof id === "string" ? id : "cobblemon:standard";
  }

  get npcClass(): NPCClass {
    this.cachedClass ??= getNPCClass(this.classId) ?? getNPCClass("cobblemon:standard")!;
    return this.cachedClass;
  }

  get uuid(): string {
    let id = this.entity.getDynamicProperty(PROP.uuid);
    if (typeof id !== "string") {
      id = UUID.generate();
      this.entity.setDynamicProperty(PROP.uuid, id);
    }
    return id;
  }

  get level(): number {
    const level = this.entity.getDynamicProperty(PROP.level);
    return typeof level === "number" ? level : 1;
  }

  /** Aspects: da classe + variação sorteada + aplicados (appliedAspects: add_aspect, model-default/slim). */
  get aspects(): string[] {
    return [...new Set([...this.npcClass.aspects, ...readJson<string[]>(this.entity, PROP.aspects, []), ...this.appliedAspects])];
  }

  get appliedAspects(): string[] {
    return readJson<string[]>(this.entity, PROP.appliedAspects, []);
  }

  setAppliedAspects(aspects: readonly string[]) {
    this.entity.setDynamicProperty(PROP.appliedAspects, aspects.length ? JSON.stringify([...new Set(aspects)]) : undefined);
  }

  /** Chave de nome (texto "npc.*" do Cobblemon ou literal digitado no editor). */
  get nameKey(): string | undefined {
    const key = this.entity.getDynamicProperty(PROP.nameKey);
    return typeof key === "string" ? key : undefined;
  }

  setNameKey(key: string) {
    this.entity.setDynamicProperty(PROP.nameKey, key);
    this.refreshNameTag();
  }

  /** Nome no idioma dos nameTags (opção do mundo; ver setNPCNameLanguage). */
  get name(): string {
    try {
      const key = this.nameKey;
      return key !== undefined ? resolveNPCName(key, getNPCNameLanguage()) : this.entity.nameTag || "NPC";
    }
    catch { return "NPC"; }
  }

  /** Nome em texto traduzível: cada jogador vê no próprio idioma (chat, batalha, diálogo). */
  get displayName(): RawMessage {
    const key = this.nameKey;
    return key !== undefined && NPC_LANG[key] ? { translate: key } : { text: this.name };
  }

  /** NPCEntity.hideNameTag (o NPC sobrepõe a classe). */
  get hideNameTag(): boolean {
    const own = this.entity.getDynamicProperty(PROP.hideNameTag);
    return typeof own === "boolean" ? own : this.npcClass.hideNameTag;
  }

  /** q.entity.set_name_tag_visible. O Bedrock não esconde o nameTag de entidade: fica vazio. */
  setNameTagVisible(visible: boolean) {
    this.entity.setDynamicProperty(PROP.hideNameTag, !visible);
    this.refreshNameTag();
  }

  refreshNameTag() {
    try { this.entity.nameTag = this.hideNameTag ? "" : this.name; } catch { }
    for (const hook of npcNameTagHooks) {
      try { hook(this); }
      catch (e) { console.warn(`NPC: nome de ${this.entity.id}: ${e}`); }
    }
  }

  /** Habilidade da IA de batalha (0–5): a do NPC (editor) ou a da classe. */
  get skill(): number {
    const own = this.entity.getDynamicProperty(PROP.skill);
    return Math.max(0, Math.min(5, Math.trunc(typeof own === "number" ? own : this.npcClass.skill)));
  }

  setSkill(skill: number | undefined) {
    this.entity.setDynamicProperty(PROP.skill, skill === undefined ? undefined : Math.max(0, Math.min(5, Math.trunc(skill))));
  }

  get interaction(): NPCInteraction | undefined {
    return readJson<NPCInteraction | undefined>(this.entity, PROP.interaction, undefined) ?? this.npcClass.interaction;
  }

  setInteraction(interaction: NPCInteraction | undefined) {
    this.entity.setDynamicProperty(PROP.interaction, interaction ? JSON.stringify(interaction) : undefined);
  }

  // -------------------------------------------------------------------------------------------
  // Behaviours

  /** Lista editada (behavioursAreCustom) ou undefined (usa a da classe). */
  get customBehaviours(): string[] | undefined {
    return readJson<string[] | undefined>(this.entity, PROP.behaviours, undefined);
  }

  /** Behaviours de primeiro nível do NPC (sem os automáticos). */
  get behaviourIds(): string[] {
    return this.customBehaviours ?? this.npcClass.behaviours;
  }

  get behaviourDefinitions(): BehaviourDefinition[] {
    return resolveBehaviours(this.behaviourIds);
  }

  /**
   * Troca a lista de behaviours (editor de behaviours): roda `onRemove`/`undo` dos que saem e `onAdd` dos que
   * entram, e reaplica. `undefined` volta para os da classe.
   */
  setBehaviours(ids: string[] | undefined) {
    const before = new Set(this.behaviourDefinitions.map(x => x.id));
    this.entity.setDynamicProperty(PROP.behaviours, ids ? JSON.stringify(ids.map(x => withNamespace(x))) : undefined);
    this.cachedStruct = undefined;
    const after = this.behaviourDefinitions;
    const afterIds = new Set(after.map(x => x.id));
    for (const id of before) {
      if (afterIds.has(id)) continue;
      const definition = resolveBehaviours([id], false)[0];
      if (definition) this.runBehaviourScripts([...definition.onRemove, ...definition.undo], `onRemove ${id}`);
    }
    this.applyBehaviours();
    for (const definition of after) if (!before.has(definition.id)) this.runBehaviourScripts(definition.onAdd, `onAdd ${definition.id}`);
  }

  /**
   * NPCBrain.configure: liga/desliga os grupos de componentes dos behaviours, registra as tarefas do script e roda
   * as configurações `script`. Chamado ao criar, ao carregar e ao editar o NPC.
   */
  /** Depois de uma batalha (o evento cobblemon:battle_start tirou os grupos): religa os behaviours do zero. */
  restoreAfterBattle() {
    this.entity.setDynamicProperty(PROP.behaviourGroups, undefined);
    this.applyBehaviours(false);
  }

  applyBehaviours(runScripts = true) {
    const definitions = this.behaviourDefinitions;
    const { groups, tasks } = behaviourEffects(definitions);
    const previous = new Set(readJson<string[]>(this.entity, PROP.behaviourGroups, []));
    for (const group of NPC_BEHAVIOUR_GROUP_NAMES) {
      if (group === "goes_to_healer") continue;
      const wanted = groups.has(group);
      if (wanted === previous.has(group)) continue;
      try { this.entity.triggerEvent(`cobblemon:npc_b_${group}_${wanted ? "on" : "off"}`); } catch { }
    }
    this.entity.setDynamicProperty(PROP.behaviourGroups, groups.size ? JSON.stringify([...groups].filter(x => x !== "goes_to_healer")) : undefined);
    if (tasks.size) taskNPCs.set(this.entity.id, tasks);
    else taskNPCs.delete(this.entity.id);
    if (runScripts) for (const definition of definitions) this.runBehaviourScripts(definition.scripts, `script ${definition.id}`);
  }

  /** Scripts de behaviour (ExpressionLike: id de script "ns:caminho" ou MoLang) com q.entity = o NPC. */
  runBehaviourScripts(scripts: readonly string[], where: string) {
    if (!scripts.length) return;
    const env = new MoEnvironment();
    env.withQuery("entity", this.struct).withQuery("npc", this.struct);
    addServerQueries(env, this.entity.dimension);
    const reference = scripts.length === 1 && /^[a-z0-9_.\-]+:[a-z0-9_.\-/]+$/.test(scripts[0]) ? MOLANG_SCRIPTS[scripts[0]] : undefined;
    try { env.eval(reference ?? scripts.slice()); }
    catch (e) { console.warn(`NPC: behaviour (${where}) falhou: ${e}`); }
  }

  /** Tarefas de script ativas (home, heal, look_at_speaker, look_at_battling). */
  get behaviourTasks(): ReadonlySet<BehaviourTask> {
    return taskNPCs.get(this.entity.id) ?? behaviourEffects(this.behaviourDefinitions).tasks;
  }

  /** Grupo de ir até a máquina de cura (ligado pelo script enquanto o time precisa de cura). */
  setGoingToHealer(active: boolean) {
    const key = PROP.goingToHealer;
    if ((this.entity.getDynamicProperty(key) === true) === active) return;
    this.entity.setDynamicProperty(key, active ? true : undefined);
    try { this.entity.triggerEvent(`cobblemon:npc_b_goes_to_healer_${active ? "on" : "off"}`); } catch { }
  }

  // -------------------------------------------------------------------------------------------
  // Configuração

  /** Variáveis de configuração: padrões da classe e dos behaviours + valores salvos. */
  getConfig(): Record<string, string | number> {
    const defaults = defaultConfig(this.npcClass);
    for (const variable of behaviourVariables(this.behaviourDefinitions))
      if (!(variable.variableName in defaults)) defaults[variable.variableName] = coerceConfig(variable.type, variable.defaultValue);
    return { ...defaults, ...readJson<Record<string, string | number>>(this.entity, PROP.config, {}) };
  }

  /** Variáveis declaradas (classe + behaviours), para o editor. */
  get configVariables(): MoLangConfigVariable[] {
    const byName = new Map(this.npcClass.config.map(v => [v.variableName, v]));
    for (const variable of behaviourVariables(this.behaviourDefinitions)) if (!byName.has(variable.variableName)) byName.set(variable.variableName, variable);
    return [...byName.values()];
  }

  setConfigValue(name: string, value: string | number | boolean) {
    const saved = readJson<Record<string, string | number>>(this.entity, PROP.config, {});
    const declared = this.configVariables.find(v => v.variableName === name);
    saved[name] = declared ? coerceConfig(declared.type, value) : typeof value === "boolean" ? (value ? 1 : 0) : value;
    this.entity.setDynamicProperty(PROP.config, JSON.stringify(saved));
    this.cachedStruct = undefined;
  }

  deleteConfigValue(name: string) {
    const saved = readJson<Record<string, string | number>>(this.entity, PROP.config, {});
    delete saved[name];
    this.entity.setDynamicProperty(PROP.config, JSON.stringify(saved));
    this.cachedStruct = undefined;
  }

  /** q.entity.data: dados livres do NPC (persistidos). */
  get data(): MoStruct {
    return MoStruct.fromJSON(readJson<unknown>(this.entity, PROP.data, {}));
  }

  saveData(data: MoStruct) {
    this.entity.setDynamicProperty(PROP.data, JSON.stringify(data.toJSON()));
  }

  // -------------------------------------------------------------------------------------------
  // Time

  /** Time estático salvo (NPCPartyStore), ou undefined. */
  getParty(): PokemonData[] | undefined {
    const raw = readJson<unknown[] | undefined>(this.entity, PROP.party, undefined);
    if (!Array.isArray(raw)) return undefined;
    return raw.filter(x => x && typeof x === "object").map(x => PokemonData.getFromJson(x as object));
  }

  setParty(party: PokemonData[] | undefined) {
    this.entity.setDynamicProperty(PROP.party, party ? JSON.stringify(party) : undefined);
  }

  /** Contexto dos provedores de time (script e pool composta usam q.npc, q.players e os aspects). */
  partyContext(players: Player[] = []) {
    return { level: this.level, npcUuid: this.uuid, npcStruct: this.struct, players: players.map(createPlayerStruct), aspects: this.aspects };
  }

  /** NPCEntity.getPartyForChallenge: time salvo, ou gerado agora se o provedor não for estático. */
  getPartyForChallenge(players: Player[]): PokemonData[] | undefined {
    const saved = this.getParty();
    if (saved) return saved;
    const provider = this.npcClass.party;
    if (provider && !provider.isStatic) return provideParty(provider, this.partyContext(players));
    return undefined;
  }

  /** `can_battle`: time com alguém de pé, ou provedor dinâmico. */
  canBattle(): boolean {
    const party = this.getParty();
    if (party?.some(p => p.currentHealth > 0)) return true;
    return this.npcClass.party?.isStatic === false;
  }

  /** NPCEntity.initialize(level): aspects de variação, skin, nome, behaviours, tamanho e time estático. */
  initialize(level: number, options: { name?: string; skin?: number; random?: () => number } = {}) {
    const npcClass = this.npcClass;
    this.entity.setDynamicProperty(PROP.level, Math.max(1, Math.floor(level)));
    const variation = provideVariationAspects(npcClass, options.random);
    this.entity.setDynamicProperty(PROP.aspects, JSON.stringify(variation));
    this.entity.setDynamicProperty(PROP.hideNameTag, undefined);
    this.applyInvulnerability();
    const names = npcClass.names;
    const nameKey = options.name ?? (names.length ? names[Math.floor((options.random ?? Math.random)() * names.length)] : "NPC");
    this.entity.setDynamicProperty(PROP.nameKey, nameKey);
    void this.uuid;
    this.applyBehaviours();
    if (options.skin !== undefined) this.setSkin(options.skin);
    else this.refreshSkin();
    this.refreshNameTag();
    this.applyDimensions();
    const provider = npcClass.party;
    this.setParty(provider?.isStatic ? provideParty(provider, this.partyContext()) : undefined);
  }

  /** Ao carregar a entidade: reaplica behaviours (sem rodar scripts de novo), tamanho e nameTag. */
  onLoad() {
    this.applyBehaviours(false);
    this.applyDimensions();
    this.refreshNameTag();
    // Frente dados-ia: NPCs salvos antes dos grupos de isMovable/isLeashable recebem o estado da classe.
    applyNpcFlags(this.entity, effectiveNpcFlags(this.entity, this.npcClass));
  }

  /** NPCEntity.isInvulnerableTo: `isInvulnerable` da classe (padrão false: o NPC leva dano, como no Cobblemon). */
  applyInvulnerability() {
    const own = this.entity.getDynamicProperty(PROP.invulnerable);
    try { this.entity.setProperty("cobblemon:invulnerable", typeof own === "boolean" ? own : this.npcClass.isInvulnerable === true); } catch { }
    // Frente dados-ia: isMovable/isLeashable/allowProjectileHits (valor do NPC ou da classe) na entidade.
    applyNpcFlags(this.entity, effectiveNpcFlags(this.entity, this.npcClass));
  }

  setInvulnerable(value: boolean | undefined) {
    this.entity.setDynamicProperty(PROP.invulnerable, value);
    this.applyInvulnerability();
  }

  // -------------------------------------------------------------------------------------------
  // Aparência e tamanho

  setSkin(skin: number) {
    const max = Math.max(0, NPC_SKINS.length - 1);
    try { this.entity.setProperty(NPC_SKIN_PROPERTY, Math.max(0, Math.min(max, Math.floor(skin)))); } catch { }
  }

  /** forcedResourceIdentifier (behaviour resource_identifier / player_textured). */
  get forcedResourceIdentifier(): string | undefined {
    const id = this.entity.getDynamicProperty(PROP.resourceIdentifier);
    return typeof id === "string" ? id : undefined;
  }

  setResourceIdentifier(id: string | undefined) {
    this.entity.setDynamicProperty(PROP.resourceIdentifier, id ? withNamespace(id) : undefined);
    this.refreshSkin();
  }

  get playerTexture(): string | undefined {
    const name = this.entity.getDynamicProperty(PROP.playerTexture);
    return typeof name === "string" && name ? name : undefined;
  }

  /**
   * q.entity.set_player_texture(nome): no Java baixa a skin da conta. No Bedrock a skin é do cliente, então o NPC
   * recebe uma skin do conjunto (Steve, Alex e as de treinador) escolhida pelo nome — sempre a mesma para o mesmo
   * nome — e o aspect model-default/model-slim, como no Cobblemon.
   */
  setPlayerTexture(username: string | undefined) {
    this.entity.setDynamicProperty(PROP.playerTexture, username || undefined);
    const applied = this.appliedAspects.filter(x => x !== "model-default" && x !== "model-slim");
    if (username) applied.push(NPC_SKINS[playerSkinIndex(username)]?.model === "cobblemon:alex.geo" ? "model-slim" : "model-default");
    this.setAppliedAspects(applied);
    this.refreshSkin();
  }

  /** Skin pelo resourceIdentifier (forçado ou da classe) e aspects, ou a escolhida pelo nome do jogador. */
  refreshSkin() {
    const username = this.playerTexture;
    this.setSkin(username ? playerSkinIndex(username) : resolveSkin(this.forcedResourceIdentifier ?? this.npcClass.resourceIdentifier, this.aspects));
    // Frente limites-a: resourceIdentifier de espécie troca o modelo pelo do Pokémon (e a hitbox padrão com ele).
    this.applyDimensions();
  }

  /** resourceIdentifier efetivo (NPCEntity.resourceIdentifier): o forçado ou o da classe. */
  get resourceIdentifier(): string {
    return this.forcedResourceIdentifier ?? this.npcClass.resourceIdentifier;
  }

  /** Frente limites-a (#53): espécie desenhada no lugar do NPC (resourceIdentifier de Pokémon), sem skin de jogador. */
  get pokemonModelSpecies(): string | undefined {
    return this.playerTexture ? undefined : pokemonModelSpecies(this.resourceIdentifier);
  }

  /** Caixa de colisão sem escala: a do NPC (set_hitbox) ou a padrão (da espécie do modelo, ou da classe). */
  get hitbox(): { width: number; height: number } {
    return readJson<{ width: number; height: number } | undefined>(this.entity, PROP.hitbox, undefined) ?? this.defaultHitbox;
  }

  /** Hitbox sem o set_hitbox do NPC: a da espécie quando o NPC tem modelo de Pokémon (frente limites-a), senão a da classe. */
  get defaultHitbox(): { width: number; height: number } {
    const species = this.pokemonModelSpecies;
    return (species ? pokemonModelHitbox(species, this.renderScale) : undefined) ?? this.npcClass.hitbox;
  }

  setHitbox(hitbox: { width: number; height: number } | undefined) {
    this.entity.setDynamicProperty(PROP.hitbox, hitbox ? JSON.stringify({ width: hitbox.width, height: hitbox.height }) : undefined);
    this.applyDimensions();
  }

  get hitboxScale(): number {
    const value = this.entity.getDynamicProperty(PROP.hitboxScale);
    return typeof value === "number" && value > 0 ? value : 1;
  }

  setHitboxScale(scale: number) {
    this.entity.setDynamicProperty(PROP.hitboxScale, Number.isFinite(scale) && scale > 0 && scale !== 1 ? scale : undefined);
    this.applyDimensions();
  }

  get renderScale(): number {
    const value = this.entity.getDynamicProperty(PROP.renderScale);
    return typeof value === "number" && value > 0 ? value : 1;
  }

  setRenderScale(scale: number) {
    this.entity.setDynamicProperty(PROP.renderScale, Number.isFinite(scale) && scale > 0 && scale !== 1 ? scale : undefined);
    this.applyDimensions();
  }

  /**
   * getDimensions = hitbox × hitboxScale → grupo de colisão mais próximo (passo de 0,2); o modelo é desenhado com
   * renderScale × hitboxScale (getScale do Minecraft escala o render junto).
   */
  applyDimensions() {
    const { width, height } = scaledHitbox(this.hitbox, this.hitboxScale);
    try {
      this.entity.triggerEvent("cobblemon:npc_hitbox_reset");
      this.entity.triggerEvent(`cobblemon:npc_hitbox_${hitboxKey(width, height)}`);
    }
    catch { }
    try { this.entity.setProperty(NPC_RENDER_SCALE_PROPERTY, Math.max(0.05, Math.min(16, this.renderScale * this.hitboxScale))); } catch { }
    notifyAppearance(this);
  }

  playAnimation(name: string) {
    const id = NPC_ANIMATIONS[name] ?? (name.startsWith("animation.") ? name : undefined);
    if (!id) return;
    try { this.entity.playAnimation(id); } catch { }
  }

  get activity(): Activity | "cobblemon:battling" {
    if (tryGetBattleFromEntity(this.entity)) return "cobblemon:battling";
    return activities.get(this.entity.id) ?? "minecraft:idle";
  }

  setActivity(activity: Activity) {
    if (activity === "minecraft:idle") activities.delete(this.entity.id);
    else activities.set(this.entity.id, activity);
    if (activity !== "cobblemon:npc_chatting") speakers.delete(this.entity.id);
  }

  /** Jogador com quem o NPC conversa (look_at_speaker). */
  get speaker(): string | undefined {
    return speakers.get(this.entity.id);
  }

  isInBattleWith(player: Player): boolean {
    const battle = tryGetBattleFromEntity(this.entity);
    return !!battle && !!battle.getActorFromID(player.id);
  }

  /** Struct `q.npc`. */
  get struct(): MoStruct {
    this.cachedStruct ??= createNPCStruct(this);
    return this.cachedStruct;
  }
}

// ---------------------------------------------------------------------------------------------
// Tamanho, skin de jogador e idioma dos nomes

/** NPCs com tarefas de script (id da entidade → tarefas). */
const taskNPCs = new Map<string, Set<BehaviourTask>>();

/** Ids das entidades de NPC com tarefas de script (para o tick de NPCTasks). */
export function npcsWithTasks(): string[] {
  return [...taskNPCs.keys()];
}

export function forgetNPCTasks(entityId: string) {
  taskNPCs.delete(entityId);
}

/** hitbox × escala, limitada ao que tem grupo de colisão. */
export function scaledHitbox(hitbox: { width: number; height: number }, scale = 1): { width: number; height: number } {
  const clamp = (value: number, list: number[]) => {
    let best = list[0];
    for (const option of list) if (Math.abs(option - value) < Math.abs(best - value)) best = option;
    return best;
  };
  return { width: clamp(hitbox.width * scale, NPC_HITBOX_WIDTHS), height: clamp(hitbox.height * scale, NPC_HITBOX_HEIGHTS) };
}

export function hitboxKey(width: number, height: number) {
  return `w${Math.round(width * 10)}_h${Math.round(height * 10)}`;
}

/** Skins com o formato de jogador (Steve/Alex e as de treinador 64×64). */
export function playerSkinIndices(): number[] {
  const models = new Set(["cobblemon:steve.geo", "cobblemon:alex.geo", "cobblemon:trainer.geo"]);
  return NPC_SKINS.map((skin, index) => models.has(skin.model) ? index : -1).filter(x => x >= 0);
}

/** Skin do conjunto para um nome de jogador (hash estável). */
export function playerSkinIndex(username: string): number {
  const options = playerSkinIndices();
  if (!options.length) return 0;
  return options[Math.abs(hashString(username.toLowerCase())) % options.length];
}

const NAME_LANGUAGE_PROPERTY = "cobblemon:npc_name_language";
export const NPC_NAME_LANGUAGES = ["en_US", "pt_BR"];

/** Idioma dos nameTags de NPC (o nameTag não traduz por jogador). Padrão: en_US. */
export function getNPCNameLanguage(): string {
  try {
    const value = world.getDynamicProperty(NAME_LANGUAGE_PROPERTY);
    return typeof value === "string" && NPC_NAME_LANGUAGES.includes(value) ? value : "en_US";
  }
  catch { return "en_US"; }
}

/** Troca o idioma dos nameTags e atualiza os NPCs carregados. @returns false se o idioma não existe. */
export function setNPCNameLanguage(language: string): boolean {
  const match = NPC_NAME_LANGUAGES.find(x => x.toLowerCase() === language.toLowerCase().replace("-", "_"));
  if (!match) return false;
  world.setDynamicProperty(NAME_LANGUAGE_PROPERTY, match);
  for (const id of ["overworld", "nether", "the_end"]) {
    try { world.getDimension(id).getEntities({ type: NPC_ENTITY_ID }).forEach(entity => new NPC(entity).refreshNameTag()); } catch { }
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Struct MoLang

function playerOf(value: MoValue | undefined): Player | undefined {
  if (value instanceof MoStruct && value.host) return value.host as Player;
  const text = asString(value);
  try {
    return world.getAllPlayers().find(p => p.id === text || p.name === text);
  }
  catch { return undefined; }
}

function configStruct(npc: NPC): MoStruct {
  const struct = new MoStruct();
  for (const [k, v] of Object.entries(npc.getConfig())) struct.set(k, v);
  return struct;
}

/** Procura um bloco perto do NPC (find_nearby_block): cubo de lado `range` (padrão 10). */
export function findNearbyBlock(dimension: Dimension, center: Vector3, blockId: string, range = 10): Vector3 | undefined {
  const id = withNamespace(blockId.replace("#", ""), "minecraft");
  const half = Math.max(1, Math.floor(range / 2));
  const base = { x: Math.floor(center.x), y: Math.floor(center.y), z: Math.floor(center.z) };
  let best: Vector3 | undefined;
  let bestDist = Infinity;
  for (let dx = -half; dx <= half; dx++) {
    for (let dy = -half; dy <= half; dy++) {
      for (let dz = -half; dz <= half; dz++) {
        const pos = { x: base.x + dx, y: base.y + dy, z: base.z + dz };
        let typeId: string | undefined;
        try { typeId = dimension.getBlock(pos)?.typeId; } catch { continue; }
        if (typeId !== id) continue;
        const dist = dx * dx + dy * dy + dz * dz;
        if (dist < bestDist) {
          bestDist = dist;
          best = pos;
        }
      }
    }
  }
  return best;
}

export function createNPCStruct(npc: NPC): MoStruct {
  const entity = npc.entity;
  const struct = new MoStruct({}, {}, entity);
  struct
    .set("is_npc", 1).set("is_player", 0).set("is_pokemon", 0)
    .fn("name", () => npc.name)
    .fn("uuid", () => npc.uuid)
    .fn("level", () => npc.level)
    .fn("config", () => configStruct(npc))
    .fn("class", () => npc.classId)
    .fn("aspects", () => new MoArray(npc.aspects))
    .fn("face", () => 1)
    .fn("data", () => npcData(npc))
    .fn("save_data", () => { npc.saveData(npcData(npc)); return 1; })
    .fn("is_in_dialogue", () => (activities.get(entity.id) === "cobblemon:npc_chatting" ? 1 : 0))
    .fn("is_in_battle", () => (tryGetBattleFromEntity(entity) ? 1 : 0))
    .fn("is_in_battle_with", args => {
      const player = playerOf(args[0]);
      return player && npc.isInBattleWith(player) ? 1 : 0;
    })
    .fn("is_doing_activity", args => (args.some(a => withNamespace(asString(a), "minecraft") === npc.activity) ? 1 : 0))
    .fn("was_hurt_by", args => {
      const other = args[0] instanceof MoStruct ? (args[0].host as Entity | undefined) : undefined;
      return other && entity.getDynamicProperty(PROP.hurtBy) === other.id ? 1 : 0;
    })
    .fn("set_chatting", () => { npc.setActivity("cobblemon:npc_chatting"); return 1; })
    .fn("set_idling", () => { npc.setActivity("minecraft:idle"); return 1; })
    .fn("can_battle", () => (npc.canBattle() ? 1 : 0))
    .fn("has_party", () => (npc.getParty() ? 1 : 0))
    .fn("is_npc", () => 1)
    .fn("start_battle", args => {
      const player = playerOf(args[0]);
      if (!player) return 0;
      // q.npc.start_battle(player, format, setLevel, cloneParties, healFirst, rules) (NPCServerDelegate).
      return startTrainerBattle(npc, player, args[1] !== undefined ? asString(args[1]) : undefined, {
        setLevel: args[2] !== undefined ? asNumber(args[2]) : undefined,
        cloneParties: args[3] !== undefined ? isTruthy(args[3]) : undefined,
        healFirst: args[4] !== undefined ? isTruthy(args[4]) : undefined,
        rules: args[5] !== undefined ? asString(args[5]).split(",").map(x => x.trim()).filter(Boolean) : undefined,
      }) ? 1 : 0;
    })
    .fn("run_dialogue", args => {
      const player = playerOf(args[0]);
      if (!player) return 0;
      return openNPCDialogue(npc, player, asString(args[1])) ? 1 : 0;
    })
    .fn("find_nearby_block", args => {
      const pos = findNearbyBlock(entity.dimension, entity.location, asString(args[0]), args[1] !== undefined ? asNumber(args[1]) : 10);
      return pos ? new MoArray([pos.x, pos.y, pos.z]) : 0;
    })
    .fn("look_at_position", args => {
      try { entity.lookAt({ x: asNumber(args[0]), y: asNumber(args[1]), z: asNumber(args[2]) }); } catch { }
      return 1;
    })
    .fn("play_animation", args => { npc.playAnimation(asString(args[0])); return 1; })
    .fn("damage", args => {
      try { entity.applyDamage(asNumber(args[0])); } catch { }
      return 1;
    })
    .fn("run_action_effect", (args, env) => (runActionEffect(npc, asString(args[0]), env) ? 1 : 0))
    .fn("world", () => new MoStruct({ game_time: worldTime() }))
    .fn("position", () => new MoArray([entity.location.x, entity.location.y, entity.location.z]))
    // NPCMoLangFunctions (q.entity nos behaviours e scripts).
    .fn("has_aspect", args => (npc.aspects.includes(asString(args[0])) ? 1 : 0))
    .fn("add_aspect", args => { npc.setAppliedAspects([...npc.appliedAspects, ...args.map(asString)]); npc.refreshSkin(); return 1; })
    .fn("remove_aspect", args => {
      const remove = new Set(args.map(asString));
      npc.setAppliedAspects(npc.appliedAspects.filter(x => !remove.has(x)));
      npc.refreshSkin();
      return 1;
    })
    .fn("in_battle", () => (tryGetBattleFromEntity(entity) ? 1 : 0))
    .fn("stop_battles", () => { tryGetBattleFromEntity(entity)?.stop?.(); return 1; })
    .fn("set_invulnerable", args => { npc.setInvulnerable(args[0] === undefined || isTruthy(args[0])); return 1; })
    // Frente dados-ia: NPCMoLangFunctions set_movable/set_leashable/set_allow_projectile_hits (sem argumento = true).
    .fn("set_movable", args => { setNpcFlag(entity, "movable", args[0] === undefined || isTruthy(args[0]), npc.npcClass); return 1; })
    .fn("set_leashable", args => { setNpcFlag(entity, "leashable", args[0] === undefined || isTruthy(args[0]), npc.npcClass); return 1; })
    .fn("set_allow_projectile_hits", args => { setNpcFlag(entity, "projectileHits", args[0] === undefined || isTruthy(args[0]), npc.npcClass); return 1; })
    .fn("set_name_tag_visible", args => { npc.setNameTagVisible(args[0] === undefined || isTruthy(args[0])); return 1; })
    .fn("unset_interaction", () => { npc.setInteraction(undefined); return 1; })
    .fn("set_dialogue_interaction", args => { npc.setInteraction({ type: "dialogue", dialogue: withNamespace(asString(args[0])) }); return 1; })
    .fn("set_script_interaction", args => { npc.setInteraction({ type: "script", script: withNamespace(asString(args[0])) }); return 1; })
    .fn("set_player_texture", args => {
      const name = asString(args[0]);
      if (name === npc.playerTexture) return 0;
      npc.setPlayerTexture(name);
      return 1;
    })
    .fn("unset_player_texture", () => { npc.setPlayerTexture(undefined); return 1; })
    .fn("set_resource_identifier", args => { npc.setResourceIdentifier(args[0] !== undefined ? asString(args[0]) : undefined); return 1; })
    .fn("unset_resource_identifier", () => { npc.setResourceIdentifier(undefined); return 1; })
    .fn("set_class", args => {
      const id = withNamespace(asString(args[0]));
      if (!getNPCClassIds().includes(id) && !getNPCPresetIds().includes(id)) return 0;
      entity.setDynamicProperty(PROP.class, id);
      return 1;
    })
    .fn("set_render_scale", args => { npc.setRenderScale(asNumber(args[0])); return 1; })
    .fn("render_scale", () => npc.renderScale)
    .fn("set_hitbox_scale", args => { npc.setHitboxScale(asNumber(args[0])); return 1; })
    .fn("hitbox_scale", () => npc.hitboxScale)
    .fn("set_hitbox", args => {
      npc.setHitbox(args.length === 0 ? undefined : { width: asNumber(args[0]), height: asNumber(args[1]) });
      return 1;
    })
    .fn("unset_hitbox", () => { npc.setHitbox(undefined); return 1; })
    .fn("party", () => {
      const party = npc.getParty();
      return party ? createPartyStruct(party) : 0;
    })
    .fn("create_npc_party", () => createPartyStruct([]))
    .fn("set_npc_party", args => { npc.setParty(partyOfStruct(args[0])); return 1; })
    .fn("delete_variable", args => { npc.deleteConfigValue(asString(args[0])); return 1; })
    .fn("distance_to_pos", args => {
      const dx = entity.location.x - asNumber(args[0]), dy = entity.location.y - asNumber(args[1]), dz = entity.location.z - asNumber(args[2]);
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    })
    // walk_to: sem pathfinding por script no Bedrock estável → teleporta para o destino.
    .fn("walk_to", args => {
      try { entity.teleport({ x: asNumber(args[0]) + 0.5, y: asNumber(args[1]), z: asNumber(args[2]) + 0.5 }); } catch { }
      return 1;
    })
    .fn("has_walk_target", () => 0)
    .fn("is_npc", () => 1);
  return struct;
}

/** q.entity.data de cada NPC (carregado uma vez; save_data grava). */
const dataStructs = new Map<string, MoStruct>();
function npcData(npc: NPC): MoStruct {
  let data = dataStructs.get(npc.entity.id);
  if (!data) dataStructs.set(npc.entity.id, data = npc.data);
  return data;
}

/**
 * Action effects de NPC. Só `npc_heal_player_pokemon` existe no 1.8.2: olha para a máquina, anima,
 * põe o time na máquina (`put_pokemon_in_healer`) e, 2,5 s depois, roda `run_callback_dialogue`.
 */
function runActionEffect(npc: NPC, id: string, env: MoEnvironment): boolean {
  const key = withNamespace(id);
  if (key !== "cobblemon:npc_heal_player_pokemon") {
    console.warn(`NPC: action effect ${key} não suportado`);
    return false;
  }
  const player = env.query.get("player");
  const context = new MoStruct({ npc: npc.struct, player: player ?? 0 });
  npc.setActivity("cobblemon:action_effect");
  env.eval([
    "c.npc.look_at_position(v.healer[0] + 0.5, v.healer[1] + 0.8, v.healer[2] + 0.5);",
    "c.player.put_pokemon_in_healer(v.healer);",
  ], context);
  npc.playAnimation("command");
  system.runTimeout(() => {
    npc.setActivity("minecraft:idle");
    const script = MOLANG_SCRIPTS["cobblemon:run_callback_dialogue"];
    if (!script || !npc.entity.isValid) return;
    try { env.eval(script, context); }
    catch (e) { console.warn(`NPC: run_callback_dialogue falhou: ${e}`); }
  }, 50);
  return true;
}

// ---------------------------------------------------------------------------------------------
// Interação e diálogo

/** Ambiente MoLang de interação (ScriptNPCInteractionConfiguration): q.npc, q.player e contexto. */
function interactionEnv(npc: NPC, player: Player): { env: MoEnvironment; context: MoStruct } {
  const playerStruct = createPlayerStruct(player);
  const env = new MoEnvironment();
  env.withQuery("npc", npc.struct).withQuery("player", playerStruct).withQuery("entity", npc.struct);
  addServerQueries(env, npc.entity.dimension);
  return { env, context: new MoStruct({ npc: npc.struct, player: playerStruct }) };
}

/** q.run_command / q.run_script (funções de servidor usadas pelos callbacks). */
export function addServerQueries(env: MoEnvironment, dimension: Dimension | undefined) {
  env.query.fn("run_command", args => {
    const command = asString(args[0]).replace(/^\//, "");
    try { (dimension ?? world.getDimension("overworld")).runCommand(command); return 1; }
    catch (e) { console.warn(`MoLang run_command falhou (${command}): ${e}`); return 0; }
  });
  env.query.fn("run_script", (args, e) => {
    const script = MOLANG_SCRIPTS[withNamespace(asString(args[0]))];
    return script ? e.eval(script) : 0;
  });
}

/** Abre um diálogo com o NPC como `q.npc` (q.npc.run_dialogue / interação de diálogo). */
export function openNPCDialogue(npc: NPC, player: Player, dialogueId: string): boolean {
  const dialogue = getDialogue(dialogueId);
  if (!dialogue) {
    console.warn(`NPC: diálogo ${dialogueId} não existe`);
    return false;
  }
  speakers.set(npc.entity.id, player.id);
  startDialogue(player, dialogue, {
    npc: npc.struct,
    // ExitSpeakersActivityTask: sem ninguém conversando, volta a ficar parado.
    onClosed: () => { if (activities.get(npc.entity.id) === "cobblemon:npc_chatting") npc.setActivity("minecraft:idle"); },
  });
  return true;
}

/**
 * Jogador interagiu com o NPC (NPCEntity.mobInteract → interaction.interact). Sem interação configurada,
 * um NPC com `battleConfiguration.canChallenge` e time vai direto para a batalha (atalho do port).
 */
export function interactWithNPC(player: Player, entity: Entity): boolean {
  const npc = NPC.from(entity);
  if (!npc) return false;
  const interaction = npc.interaction;
  if (!interaction || interaction.type === "none") {
    if (npc.npcClass.battleConfiguration.canChallenge && npc.canBattle()) return startTrainerBattle(npc, player);
    return false;
  }
  if (interaction.type === "dialogue") return openNPCDialogue(npc, player, interaction.dialogue);
  const { env, context } = interactionEnv(npc, player);
  const script = interaction.type === "script" ? MOLANG_SCRIPTS[withNamespace(interaction.script)] : interaction.script;
  if (script === undefined) {
    console.warn(`NPC: script ${interaction.type === "script" ? interaction.script : "?"} não existe`);
    return false;
  }
  try { env.eval(script, context); }
  catch (e) { console.warn(`NPC: script de interação falhou: ${e}`); }
  return true;
}

/** Jogador interagiu com um NPC com quem já está batalhando: reabre o menu da batalha. */
export function tryPromptNPCBattle(player: Player, entity: Entity): boolean {
  const battle = tryGetBattleFromEntity(entity);
  const actor = battle?.getActorFromID(player.id);
  if (!actor) return false;
  actor.promptPlayerForRequest();
  return true;
}

/** Guarda quem bateu no NPC (q.npc.was_hurt_by). Ligar em world.afterEvents.entityHitEntity. */
export function recordNPCHurt(target: Entity, attacker: Entity | undefined) {
  if (!attacker || !isNPCEntity(target)) return;
  try { target.setDynamicProperty(PROP.hurtBy, attacker.id); } catch { }
}

// ---------------------------------------------------------------------------------------------
// Batalha de treinador

/** "double"/"doubles"/"cobblemon:double" → formato da battle API. */
export function battleFormatFromId(id: string | undefined): BattleFormat {
  const clean = (id ?? "singles").toLowerCase().replace(/^cobblemon:/, "").replace(/^gen_?9_?/, "");
  if (clean.startsWith("double")) return BattleFormat.GEN_9_DOUBLES;
  if (clean.startsWith("triple")) return BattleFormat.GEN_9_TRIPLES;
  if (clean.startsWith("multi")) return BattleFormat.GEN_9_MULTI;
  return BattleFormat.GEN_9_SINGLES;
}

export type ChallengeRefusal = "cooldown" | "defeated" | "no_party" | undefined;

/**
 * Pode desafiar? Usa as variáveis de configuração do Cobblemon (`challenge_cooldown` em ticks e
 * `can_rechallenge`) com os dados do jogador sobre o NPC (`last_challenged_time`, gravado pelo callback
 * npc_battle_end_scripts; `defeated`, gravado pelo port quando o jogador vence).
 */
export function checkChallenge(npc: NPC, player: Player, now = worldTime()): ChallengeRefusal {
  const config = npc.getConfig();
  const data = getNpcData(player, npc.uuid);
  const canRechallenge = config.can_rechallenge === undefined ? true : isTruthy(config.can_rechallenge);
  if (!canRechallenge && isTruthy(data.get("defeated"))) return "defeated";
  const cooldown = asNumber(config.challenge_cooldown ?? 0);
  const last = data.get("last_challenged_time");
  if (cooldown > 0 && last !== undefined && now - asNumber(last) < cooldown) return "cooldown";
  if (!npc.canBattle()) return "no_party";
  return undefined;
}

function refusalMessage(npc: NPC, refusal: Exclude<ChallengeRefusal, undefined>): RawMessage {
  const config = npc.getConfig();
  if (refusal === "cooldown" && typeof config.challenge_cooldown_text === "string" && config.challenge_cooldown_text)
    return { rawtext: [{ text: `${npc.name}: ` }, { translate: config.challenge_cooldown_text }] };
  if (refusal === "defeated") return message.With("cobblemon.port.npc.already_defeated", [npc.name]);
  if (refusal === "cooldown") return message.With("cobblemon.port.npc.cooldown", [npc.name]);
  return { translate: "cobblemon.battle.error.no_pokemon_opponent" };
}

/** Parâmetros 3–6 de q.npc.start_battle (BattleBuilder.pvn). */
export interface TrainerBattleExtras {
  /** Nível fixo (BattleFormat.adjustLevel); implica cloneParties. */
  setLevel?: number;
  cloneParties?: boolean;
  healFirst?: boolean;
  /** Regras extras do Showdown (BattleFormat.setBattleRules). */
  rules?: string[];
}

/**
 * q.npc.start_battle(player, format, ...): time do NPC contra o time do jogador, IA forte com a skill do NPC.
 * `rules` entram no formato. `cloneParties` (ou `setLevel` ≠ −1, que o implica) faz a batalha com cópias do time do
 * jogador (BattlePokemon.safeCopyOf): nada volta para o time real. `setLevel` > 0 põe as cópias e o time do NPC no
 * nível, curados (BattleFormat.adjustLevel); o time salvo do NPC não muda. `healFirst` cura antes (a cópia, ou o time
 * real sem clone, como `toBattleTeam(healPokemon = true)`).
 */
export function startTrainerBattle(npc: NPC, player: Player, format?: string, extras: TrainerBattleExtras = {}): boolean {
  const refusal = checkChallenge(npc, player);
  if (refusal) {
    player.sendMessage(message.error(refusalMessage(npc, refusal)));
    return false;
  }
  const saved = npc.getParty();
  let team = npc.getPartyForChallenge([player]);
  if (!team?.length) {
    player.sendMessage(message.error({ translate: "cobblemon.battle.error.no_pokemon_opponent" }));
    return false;
  }
  const npcClass = npc.npcClass;
  // NPCBattleActor: toBattleTeam(healPokemon = autoHealParty); randomizePartyOrder embaralha.
  if (npcClass.autoHealParty) team.forEach(healPokemon);
  if (npcClass.randomizePartyOrder) team = shuffle(team);
  const teamOptions = trainerTeamOptions(extras);
  // Nível ajustado: o NPC luta com cópias (o time salvo dele continua no nível original).
  const battleTeam = teamOptions.setLevel !== undefined && teamOptions.setLevel > 0
    ? team.map(pokemon => PokemonData.getFromJson(JSON.stringify(pokemon)))
    : team;
  let battleFormat = battleFormatFromId(format);
  for (const rule of extras.rules ?? []) battleFormat = battleFormat.withRule(rule);
  const battle = startNPCBattle(player, npc.entity, battleTeam, {
    format: battleFormat,
    skill: npc.skill,
    name: npc.displayName,
    team: teamOptions,
  });
  if (!battle) return false;
  // Registros de batalhas que acabaram sem vitória (fuga/stop) são descartados aqui.
  for (const id of [...battles.keys()]) if (!battleMap.has(id)) battles.delete(id);
  battles.set(battle.battleId, { npcId: npc.entity.id, playerId: player.id, team, staticParty: !!saved });
  npc.setActivity("minecraft:idle");
  if (npcClass.autoHealParty && saved) npc.setParty(team);
  return true;
}

/**
 * Parâmetros 3–5 do start_battle → opções do time (NPCServerDelegate): `cloneParties = setLevel != -1 || arg3`;
 * `setLevel` só vale acima de 0 (adjustLevel).
 */
export function trainerTeamOptions(extras: TrainerBattleExtras): BattleTeamOptions {
  const setLevel = extras.setLevel !== undefined && Number.isFinite(extras.setLevel) ? Math.trunc(extras.setLevel) : -1;
  return {
    clone: setLevel !== -1 || extras.cloneParties === true,
    setLevel: setLevel > 0 ? setLevel : undefined,
    heal: extras.healFirst === true,
  };
}

function shuffle<T>(list: T[]): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Ator da batalha visto pelo callback (EntityBackedBattleActor / PlayerBattleActor). */
export interface VictoryActor {
  npc?: NPC;
  player?: Player;
  /** Entidade de Pokémon selvagem. */
  entity?: Entity;
}

/**
 * Fim de batalha (BATTLE_VICTORY): roda o callback `battle_victory/npc_battle_end_scripts` do Cobblemon
 * (on_defeat, on_victory, on_player_wins, on_player_loses, player_win_command, player_lose_command e
 * last_challenged_time), marca o NPC como derrotado pelo jogador, toca win/lose e salva o time estático.
 */
export function handleNPCBattleVictory(winners: VictoryActor[], losers: VictoryActor[], battleId?: string, dimension?: Dimension) {
  const npcsInBattle = [...winners, ...losers].filter(a => a.npc);
  if (!npcsInBattle.length) return;
  const playerStructs = new Map<string, MoStruct>();
  const playerStruct = (p: Player) => {
    let s = playerStructs.get(p.id);
    if (!s) playerStructs.set(p.id, s = createPlayerStruct(p));
    return s;
  };
  const scriptable = (list: VictoryActor[]) => new MoArray(list.filter(a => a.npc || a.entity).map(a => a.npc ? a.npc.struct
    : new MoStruct({ is_pokemon: 1, is_npc: 0, is_player: 0, uuid: a.entity!.id, config: new MoStruct() }, {}, a.entity)));
  const players = (list: VictoryActor[]) => new MoArray(list.filter(a => a.player).map(a => new MoStruct({ player: playerStruct(a.player!) })));
  const context = new MoStruct({
    scriptable_winners: scriptable(winners),
    scriptable_losers: scriptable(losers),
    player_winners: players(winners),
    player_losers: players(losers),
    npcs: new MoArray(npcsInBattle.map(a => new MoStruct({ npc: a.npc!.struct }))),
    players: players([...winners, ...losers]),
  });
  const env = new MoEnvironment();
  addServerQueries(env, dimension ?? npcsInBattle[0].npc!.entity.dimension);
  const script = MOLANG_CALLBACKS["cobblemon:battle_victory/npc_battle_end_scripts"];
  if (script) {
    try { env.eval(script, context); }
    catch (e) { console.warn(`NPC: callback de fim de batalha falhou: ${e}`); }
  }
  // Port: estado "derrotado" por jogador (can_rechallenge = false bloqueia novo desafio).
  for (const loser of losers) {
    if (!loser.npc) continue;
    for (const winner of winners) {
      if (!winner.player) continue;
      const data = getNpcData(winner.player, loser.npc.uuid);
      data.set("defeated", 1);
      if (data.get("last_challenged_time") === undefined) data.set("last_challenged_time", worldTime());
      saveMoLangData(winner.player);
    }
    loser.npc.playAnimation("lose");
  }
  for (const winner of winners) if (winner.npc) winner.npc.playAnimation("win");
  // Time estático guarda o HP do fim da batalha (NPCPartyStore persistente).
  const record = battleId ? battles.get(battleId) : undefined;
  if (record) {
    battles.delete(battleId!);
    const npc = npcsInBattle.find(a => a.npc!.entity.id === record.npcId)?.npc;
    if (npc && record.staticParty) npc.setParty(record.team);
  }
}

/** Batalha terminou sem vitória (fuga/stop): esquece o registro. */
export function forgetNPCBattle(battleId: string) {
  battles.delete(battleId);
}

// ---------------------------------------------------------------------------------------------
// Criação

export interface SpawnNPCOptions {
  level?: number;
  /** Chave de nome ou texto; padrão: sorteado da classe. */
  name?: string;
  /** Índice de skin (cobblemon:npc_skin); padrão: pelo resourceIdentifier/aspects. */
  skin?: number;
}

/** /spawnnpc <classe|preset> [nível]: cria e inicializa o NPC. @returns undefined se a classe não existe. */
export function spawnNPC(dimension: Dimension, location: Vector3, classId: string, options: SpawnNPCOptions = {}): NPC | undefined {
  const npcClass = getNPCClass(classId);
  if (!npcClass) return undefined;
  const entity = dimension.spawnEntity(NPC_ENTITY_ID, location);
  entity.setDynamicProperty(PROP.class, npcClass.id);
  const npc = new NPC(entity);
  npc.initialize(options.level ?? 1, { name: options.name, skin: options.skin });
  return npc;
}
