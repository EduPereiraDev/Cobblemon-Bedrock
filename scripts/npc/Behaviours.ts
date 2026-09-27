/**
 * Behaviours de NPC (api/ai/config/**, data/cobblemon/behaviours, NPCBrain.configure) no Bedrock.
 *
 * O Cobblemon monta o "cérebro" do NPC com os behaviours automáticos (npc/auto) + os da classe (`ai`/`behaviours`
 * com `apply_behaviours`) — ou, se editados, a lista do próprio NPC. Cada behaviour traz tarefas por atividade,
 * variáveis de configuração e scripts. No port:
 *  - tarefas com objetivo vanilla equivalente viram grupos de componentes da entidade (eventos
 *    `cobblemon:npc_b_<grupo>_on/_off`, gerados por tools/importer/npcs.ts): passear, olhar jogadores/em volta,
 *    pânico, briga corpo a corpo, revidar, atacar hostis, boiar;
 *  - tarefas sem equivalente vanilla rodam no script a cada segundo (`BEHAVIOUR_TASKS`): voltar para casa
 *    (home_walk_task), usar a máquina de cura, olhar quem conversa e olhar os Pokémon da batalha;
 *  - variáveis (add_variables, variáveis das tarefas e dos scripts) entram na configuração do NPC;
 *  - configurações `script` rodam ao aplicar (q.entity = NPC), e `onAdd`/`onRemove`/`undo` na edição.
 */
import { NPC_BEHAVIOURS, NPC_BEHAVIOUR_GROUP_NAMES } from "../../generated/scripts/npcs";
import type { MoLangConfigVariable, MoLangVariableType } from "./NPCClass";
import { withNamespace } from "./NPCClass";

/** Tarefas feitas pelo script (não há objetivo vanilla). */
export type BehaviourTask = "home" | "heal" | "look_at_speaker" | "look_at_battling" | "exit_battle_when_hurt";

/** Variáveis que a tarefa exit_battle_when_hurt registra (ExitBattleWhenHurtTaskConfig). */
const EXIT_BATTLE_VARIABLES: MoLangConfigVariable[] = [
  { variableName: "exit_battle_when_hurt", displayName: "cobblemon.entity.variable.exit_battle_when_hurt.name", description: "cobblemon.entity.variable.exit_battle_when_hurt.desc", category: "cobblemon.entity.variable.category.battling", type: "BOOLEAN", defaultValue: "true" },
  { variableName: "exit_battle_from_passive_damage", displayName: "cobblemon.entity.variable.exit_battle_from_passive_damage.name", description: "cobblemon.entity.variable.exit_battle_from_passive_damage.desc", category: "cobblemon.entity.variable.category.battling", type: "BOOLEAN", defaultValue: "true" },
];

export interface BehaviourDefinition {
  id: string;
  name: string;
  description: string;
  /** Aparece no editor (os automáticos e `visible: false` não aparecem). */
  visible: boolean;
  auto: boolean;
  variables: MoLangConfigVariable[];
  /** Scripts de configuração (`type: script`): rodam sempre que o behaviour é aplicado. */
  scripts: string[];
  onAdd: string[];
  onRemove: string[];
  undo: string[];
  /** Grupos de componentes (sem o prefixo cobblemon:npc_b_). */
  groups: string[];
  tasks: BehaviourTask[];
  /** Behaviours aplicados por este (apply_behaviours aninhado). */
  nested: string[];
}

const cache = new Map<string, BehaviourDefinition | null>();

export function getBehaviourIds(): string[] {
  return Object.keys(NPC_BEHAVIOURS).sort();
}

/** Behaviours que o editor oferece (sem os automáticos e os invisíveis). */
export function getEditableBehaviours(): BehaviourDefinition[] {
  return getBehaviourIds().map(getBehaviour).filter((x): x is BehaviourDefinition => !!x && x.visible && !x.auto);
}

export function getAutoBehaviours(): string[] {
  return getBehaviourIds().filter(id => getBehaviour(id)?.auto);
}

export function getBehaviour(id: string): BehaviourDefinition | undefined {
  const key = withNamespace(id);
  if (cache.has(key)) return cache.get(key) ?? undefined;
  const raw = NPC_BEHAVIOURS[key];
  let definition: BehaviourDefinition | undefined;
  if (raw !== undefined) {
    try { definition = parseBehaviour(key, JSON.parse(raw)); }
    catch (e) { console.warn(`NPC: behaviour ${key} inválido: ${e}`); }
  }
  cache.set(key, definition ?? null);
  return definition;
}

/** Registra um behaviour (datapack/testes). */
export function registerBehaviour(id: string, json: Record<string, unknown>) {
  cache.set(withNamespace(id), parseBehaviour(withNamespace(id), json));
}

const lines = (value: unknown): string[] => Array.isArray(value) ? value.map(String) : typeof value === "string" ? [value] : [];

function parseVariable(raw: any): MoLangConfigVariable | undefined {
  if (!raw || typeof raw !== "object" || typeof raw.variableName !== "string") return undefined;
  const type = String(raw.type ?? "NUMBER").toUpperCase() as MoLangVariableType;
  return {
    variableName: raw.variableName,
    displayName: String(raw.displayName ?? raw.variableName),
    description: String(raw.description ?? ""),
    category: String(raw.category ?? "cobblemon.entity.variable.category.misc"),
    type: type === "TEXT" || type === "BOOLEAN" ? type : "NUMBER",
    defaultValue: String(raw.defaultValue ?? (type === "TEXT" ? "" : "0")),
  };
}

/** Nome da tarefa sem namespace ("cobblemon:wander" → "wander"). */
function taskName(task: unknown): string {
  const type = typeof task === "string" ? task : typeof (task as any)?.type === "string" ? (task as any).type : "";
  return type.replace(/^[a-z_]+:/, "");
}

/** Variáveis que aparecem dentro de tarefas (ex.: speedMultiplier como variável de entidade). */
function collectTaskVariables(task: unknown, out: MoLangConfigVariable[]) {
  if (!task || typeof task !== "object") return;
  for (const value of Object.values(task as Record<string, unknown>)) {
    if (Array.isArray(value)) value.forEach(x => { const v = parseVariable(x); if (v) out.push(v); else collectTaskVariables(x, out); });
    else if (value && typeof value === "object") {
      const variable = parseVariable(value);
      if (variable) out.push(variable);
      else collectTaskVariables(value, out);
    }
  }
}

export function parseBehaviour(id: string, json: any): BehaviourDefinition {
  const definition: BehaviourDefinition = {
    id,
    name: String(json?.name ?? id),
    description: String(json?.description ?? ""),
    visible: json?.visible !== false,
    auto: json?.auto === true,
    variables: [],
    scripts: [],
    onAdd: lines(json?.onAdd),
    onRemove: lines(json?.onRemove),
    undo: lines(json?.undo),
    groups: [],
    tasks: [],
    nested: [],
  };
  const groups = new Set<string>();
  const tasks = new Set<BehaviourTask>();
  let looksAtPlayers = false;
  const configurations: any[] = Array.isArray(json?.configurations) ? json.configurations : [];
  for (const config of configurations) {
    const type = String(config?.type ?? "").replace(/^[a-z_]+:/, "");
    if (type === "add_variables" || type === "script") {
      for (const raw of Array.isArray(config.variables) ? config.variables : []) {
        const variable = parseVariable(raw);
        if (variable) definition.variables.push(variable);
      }
    }
    if (type === "script") definition.scripts.push(...lines(config.script));
    if (type === "set_variables" && typeof config.variableValues?.look_at_entity_types === "string")
      looksAtPlayers = config.variableValues.look_at_entity_types.includes("minecraft:player");
    if (type === "apply_behaviours") definition.nested.push(...lines(config.behaviours ?? config.behaviors).map(x => withNamespace(x)));
    if (type !== "add_tasks_to_activity") continue;
    // Tarefas de atividades temporárias (pânico, luta...) só valem dentro delas: o passeio do pânico não é "wanders".
    const activity = String(config.activity ?? "").replace(/^[a-z_]+:/, "");
    const everyday = activity === "idle" || activity === "core";
    for (const list of Object.values(config.tasksByPriority ?? {}) as unknown[][]) {
      for (const task of Array.isArray(list) ? list : []) {
        collectTaskVariables(task, definition.variables);
        const name = taskName(task);
        switch (name) {
          case "wander": if (everyday) groups.add("wanders"); break;
          case "look_at_entities": if (everyday) groups.add("look_at_entities"); break;
          case "flee_attacker": case "switch_to_panic_when_hurt": case "flee_nearest_hostile": case "switch_to_panic_when_hostiles_nearby": groups.add("panics"); break;
          case "melee_attack": case "move_to_attack_target": groups.add("fights_melee"); break;
          case "get_angry_at_attacker": case "attack_angry_at": groups.add("retaliates"); break;
          case "attack_hostile_mobs": groups.add("attack_hostile_mobs"); break;
          case "stay_afloat": groups.add("floats"); break;
          case "go_to_healing_machine": case "heal_using_healing_machine": tasks.add("heal"); break;
          case "look_at_speaker": tasks.add("look_at_speaker"); break;
          case "look_at_battling_pokemon": tasks.add("look_at_battling"); break;
          case "exit_battle_when_hurt": tasks.add("exit_battle_when_hurt"); definition.variables.push(...EXIT_BATTLE_VARIABLES); break;
          case "run_script":
            if (withNamespace(String((task as any)?.script ?? "")) === "cobblemon:home_walk_task") tasks.add("home");
            break;
        }
      }
    }
  }
  // look_at_entities: só jogadores (looks_at_players) ou qualquer entidade (looks_around).
  if (groups.delete("look_at_entities")) groups.add(looksAtPlayers ? "looks_at_players" : "looks_around");
  definition.groups = [...groups].filter(x => NPC_BEHAVIOUR_GROUP_NAMES.includes(x));
  definition.tasks = [...tasks];
  // Variáveis repetidas: vale a última (MoLangConfigVariable por nome).
  const byName = new Map(definition.variables.map(v => [v.variableName, v]));
  definition.variables = [...byName.values()];
  return definition;
}

const missingWarned = new Set<string>();

/** Behaviours efetivos: automáticos + os pedidos, com os aninhados expandidos (sem repetir, sem ciclo). */
export function resolveBehaviours(ids: readonly string[], includeAuto = true): BehaviourDefinition[] {
  const out: BehaviourDefinition[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    const key = withNamespace(id);
    if (seen.has(key)) return;
    seen.add(key);
    const definition = getBehaviour(key);
    if (!definition) {
      // Avisa uma vez por id (a lista é resolvida a cada tarefa).
      if (!missingWarned.has(key)) console.warn(`NPC: behaviour ${key} não encontrado`);
      missingWarned.add(key);
      return;
    }
    out.push(definition);
    definition.nested.forEach(visit);
  };
  if (includeAuto) getAutoBehaviours().forEach(visit);
  ids.forEach(visit);
  return out;
}

/** Grupos de componentes e tarefas de script de uma lista de behaviours. */
export function behaviourEffects(definitions: readonly BehaviourDefinition[]): { groups: Set<string>; tasks: Set<BehaviourTask> } {
  const groups = new Set<string>();
  const tasks = new Set<BehaviourTask>();
  for (const definition of definitions) {
    definition.groups.forEach(x => groups.add(x));
    definition.tasks.forEach(x => tasks.add(x));
  }
  return { groups, tasks };
}

/** Variáveis declaradas pelos behaviours (AddVariablesConfig), sem repetir nome. */
export function behaviourVariables(definitions: readonly BehaviourDefinition[]): MoLangConfigVariable[] {
  const byName = new Map<string, MoLangConfigVariable>();
  for (const definition of definitions) for (const variable of definition.variables) byName.set(variable.variableName, variable);
  return [...byName.values()];
}
