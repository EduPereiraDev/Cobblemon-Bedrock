/**
 * Fases extras do `/cobblemon:selftest` registradas por extensões opcionais (pacotes que ficam acima do base no mundo).
 *
 * Uma extensão registra, no carregamento do script (antes do `startup`, para o modo entrar no enum do comando), um modo
 * próprio (`/cobblemon:selftest <modo>`), se ele entra no `full`, se está ligada neste mundo e o que a fase faz. A
 * fase recebe um `SelfTestContext`: a área, o journal, a limpeza e a restauração continuam sendo do autoteste; a
 * extensão só usa os ajudantes (Pokémon de exibição, blocos anotados, partículas, sons, telas, log). Paradas extras do
 * roteiro `telas` entram depois das do base.
 *
 * Sem nenhuma extensão registrada (build público), nada muda.
 */
import type { BlockPermutation, Dimension, Entity, Player, RawMessage, Vector3 } from "@minecraft/server";
import type { SelfTestBlockInfo } from "./selfTestManifest";
import { SELFTEST_MODES, SELFTEST_MODE_ALIASES } from "./selfTestPlan";
import type { BlockPos, Coverage, PokemonTarget } from "./selfTestPlan";

/** O que o autoteste oferece a uma fase de extensão. */
export interface SelfTestContext {
  readonly player: Player;
  readonly dimension: Dimension;
  /** Origem da área (canto do bloco sob o jogador, na altura escolhida; área = SELFTEST_AREA em volta dela). */
  readonly origin: BlockPos;
  readonly coverage: Coverage;
  /** Fases do plano desta sessão (ex.: com "entities" no plano, a extensão pode pular o que ele já cobre). */
  readonly plan: readonly string[];
  /** O teste foi interrompido (stop, jogador saiu). Conferir entre um passo e outro. */
  stopped(): boolean;
  waitTicks(ticks: number): Promise<void>;
  /** Roda um gerador com `system.runJob` (um passo por `yield`, watchdog). */
  job(generator: Generator<void, void, void>): Promise<void>;
  /** Falha: linha `[selftest] <o quê>: <erro>` no log e contagem no fim. */
  fail(what: string, e?: unknown): void;
  /** Linha `[selftest] <texto>` no log (console.info: o ContentLog do cliente com "Inform." mostra). */
  log(line: string): void;
  /** Progresso na actionbar (feitos/total da etapa atual). */
  progress(done: number, total: number): void;
  /** Contador que entra no relatório da fase. */
  count(key: string, n?: number): void;
  /** Linha extra no resumo mandado ao jogador no fim. */
  summary(line: RawMessage): void;
  /** Pokémon de exibição (sem IA nem dados), marcado para a limpeza. `undefined` = falhou (já registrado). */
  spawnPokemon(species: string, variant: number, location: Vector3): Entity | undefined;
  /** Remove uma entidade criada pela fase (e a tira da lista da limpeza). */
  despawn(entity: Entity): void;
  /** Entidade criada pela fase por outro caminho (ex.: item solto): marcada e removida na limpeza se sobrar. */
  track(entity: Entity): void;
  /** Troca um bloco da área anotando o original (volta ao que era no fim). */
  setBlock(pos: BlockPos, permutation: BlockPermutation | string): boolean;
  /** Itens e XP soltos na área somem. */
  sweepLoose(): void;
  /**
   * Os Pokémon em lotes (grade 4×4, poses parado/batalha/dormindo), como a fase `entities`. Devolve quantas falhas
   * foram registradas no caminho (entidade não criada, variante recusada), para a extensão contar na etapa dela.
   */
  showPokemon(targets: readonly PokemonTarget[]): Promise<number>;
  /** Blocos por página (grade 8×8), como a fase `blocks`, a partir de `origin`. Devolve quantos foram colocados. */
  showBlocks(blocks: readonly SelfTestBlockInfo[]): Promise<number>;
  /** Partículas só para o jogador, como a fase `particles`. */
  showParticles(ids: readonly string[]): Promise<void>;
  /** Sons só para o jogador (volume baixo), como a fase `sounds`. */
  playSounds(ids: readonly string[]): Promise<void>;
  /** Abre uma tela por `ticks` (padrão 50) e fecha; erro da tela vira falha `ui <label>`. */
  showScreen(label: string, open: () => unknown, onClose?: () => void, ticks?: number): Promise<void>;
  /** Câmera de volta à vista padrão da área (depois de mexer nela). */
  resetCamera(): void;
}

/** Uma parada extra do roteiro `telas`. */
export interface SelfTestScreen {
  key: string;
  /** `form`: fechar avança; `hud`: só HUD/actionbar (avança pelo tempo). */
  kind: "form" | "hud";
  /** Nome mostrado no aviso "Tela N/total". */
  name: RawMessage;
  /** A própria tela usa a actionbar (sem contagem regressiva por cima). */
  actionbar?: boolean;
  /** Abre; uma promessa termina quando o jogador fecha. */
  open: () => unknown;
  /** A cada segundo com a tela aberta. */
  refresh?: () => void;
  /** Ao sair da tela. */
  close?: () => void;
}

export interface SelfTestExtension {
  /** Modo do comando, minúsculo e sem espaço; não pode ser um modo do autoteste. */
  mode: string;
  /** Nome da fase (progresso, status). */
  name: RawMessage;
  /** Entra no `full`. */
  inFull: boolean;
  /** A extensão está ligada neste mundo? (sem ela, o modo avisa e o `full` a pula) */
  available(): boolean;
  /** Aviso quando o modo é pedido e a extensão não está ligada. */
  unavailable?: RawMessage;
  run(ctx: SelfTestContext): Promise<void>;
  /** Paradas extras do roteiro `telas` (com dados de exemplo; nada é gravado no jogador). */
  screens?(player: Player): SelfTestScreen[];
  /** Blocos da extensão que podem sobrar na área (limpeza de um teste interrompido). */
  leftoverBlock?(typeId: string): boolean;
}

const registry: SelfTestExtension[] = [];

const RESERVED = new Set<string>([...SELFTEST_MODES, ...Object.keys(SELFTEST_MODE_ALIASES)]);

/** Registra uma extensão (idempotente pelo modo). Modo inválido ou reservado: erro. */
export function registerSelfTestExtension(extension: SelfTestExtension): void {
  const mode = extension.mode.trim().toLowerCase();
  if (!/^[a-z0-9_]+$/.test(mode) || RESERVED.has(mode)) throw new Error(`selftest: modo de extensão inválido: ${extension.mode}`);
  const at = registry.findIndex(e => e.mode === mode);
  const entry = { ...extension, mode };
  if (at >= 0) registry[at] = entry;
  else registry.push(entry);
}

/** Extensões registradas, na ordem de registro. */
export function selfTestExtensions(): readonly SelfTestExtension[] {
  return registry;
}

export function findSelfTestExtension(mode: string | undefined): SelfTestExtension | undefined {
  return mode ? registry.find(e => e.mode === mode) : undefined;
}

/** Algum bloco de extensão que sobrou na área? */
export function isExtensionLeftoverBlock(typeId: string): boolean {
  return registry.some(e => { try { return e.leftoverBlock?.(typeId) === true; } catch { return false; } });
}

/** Só para os testes. */
export function clearSelfTestExtensionsForTests(): void {
  registry.length = 0;
}
