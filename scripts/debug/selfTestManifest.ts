/**
 * Manifesto do /cobblemon:selftest: o que existe nos packs (entidades que não são Pokémon, blocos e estados, partículas,
 * sons). No build, `tools/selftest/manifest.mjs` troca este arquivo pelos dados lidos dos packs mesclados em dist/.
 * Este stub (vazio) é o que o tsc e os testes enxergam.
 */

/** Entidade que não é Pokémon: propriedades inteiras (valor máximo, de 0 até ele) e animações `animation.*`. */
export interface SelfTestEntityInfo {
  id: string;
  /** Pasta no pack (npc, pokeballs, boats, display...). */
  group: string;
  ints: Record<string, number>;
  animations: string[];
}

/** Bloco e os valores dos estados próprios (o primeiro valor é o padrão). */
export interface SelfTestBlockInfo {
  id: string;
  states: Record<string, (string | number | boolean)[]>;
}

export const SELFTEST_MANIFEST_BUILT: boolean = false;
export const SELFTEST_ENTITIES: SelfTestEntityInfo[] = [];
export const SELFTEST_BLOCKS: SelfTestBlockInfo[] = [];
export const SELFTEST_PARTICLES: string[] = [];
export const SELFTEST_SOUNDS: string[] = [];
/** Espécie → capacidades de locomoção lidas do JSON da entidade: `w` anda, `s` nada, `f` voa. */
export const SELFTEST_LOCOMOTION: Record<string, string> = {};
/** Identificadores dos itens do BP (o esbuild descarta o export quando ninguém o usa). */
export const SELFTEST_ITEMS: string[] = [];
