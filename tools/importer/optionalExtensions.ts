// Ganchos do importador para a extensão privada Mega Showdown (licença v2.1: uso privado, proibido publicar derivados).
// Os módulos do MSD (megaShowdown.ts, msd*.ts, validateMsd.ts) ficam fora do repositório público (.gitignore). Com eles,
// este arquivo só os reexporta; num clone sem eles, cada gancho vira no-op e o import gera só o base (igual ao
// COBBLEMON_MSD=0). Os caminhos dos módulos privados não mudam: as frentes do MSD continuam editando os mesmos arquivos.
import { existsSync } from "node:fs";
import type { Combo } from "./variants.ts";

/** Módulo irmão, se existir (import dinâmico: um arquivo ausente não quebra o import do base). */
async function optional(file: string): Promise<Record<string, any> | undefined> {
	const url = new URL(file, import.meta.url);
	return existsSync(url) ? await import(url.href) : undefined;
}

const infra = await optional("./megaShowdown.ts");
const scripts = await optional("./msdScripts.ts");
const effects = await optional("./msdEffects.ts");
const alphaEyes = await optional("./msdAlphaEyes.ts");

/** Os módulos privados do MSD estão nesta árvore? (falso no repositório público) */
export const msdModulesPresent: boolean = infra !== undefined;

export const isMsdChild: () => boolean = infra?.isMsdChild ?? (() => false);
export const msdOrderCombos: (species: string, combos: Combo[], supplement?: () => Combo[]) => Combo[] = infra?.msdOrderCombos ?? ((_s, combos) => combos);
export const msdOrderAspectBits: (species: string, bits: string[]) => string[] = infra?.msdOrderAspectBits ?? ((_s, bits) => bits);
export const msdRecordSpecies: (species: string, combos: Combo[], aspectBits: string[]) => void = infra?.msdRecordSpecies ?? (() => {});
export const msdWriteChildResult: (out: string, variants: Map<string, unknown>) => void = infra?.msdWriteChildResult ?? (() => {});
export const removeMsdOutput: (baseOut: string) => void = infra?.removeMsdOutput ?? (() => {});
export const runMegaShowdownImport: (baseOut: string, argv: string[]) => { ok: boolean; message: string } =
	infra?.runMegaShowdownImport ?? (() => ({ ok: true, message: "MSD: fora do import (módulos privados ausentes)" }));
export const emitMsdScriptsModule: (out: string, ok: boolean) => Promise<{ file: string; species: number }> =
	scripts?.emitMsdScriptsModule ?? (async () => ({ file: "", species: 0 }));
export const requestMsdEffectParticles: () => unknown = effects?.requestMsdEffectParticles ?? (() => []);
export const preserveBaseAlphaEyes: () => unknown = alphaEyes?.preserveBaseAlphaEyes ?? (() => []);
