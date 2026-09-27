/**
 * Stub das extensões privadas (fora do repositório público; ver .gitignore e o build público em tools/build.mjs).
 *
 * `scripts/main.ts` importa `@private/mega-showdown` e `@private/mega-showdown/content`. O `paths` do tsconfig.json
 * (que o esbuild também lê) resolve para a extensão em scripts/extensions/megaShowdown/ quando ela existe e para este
 * arquivo quando não existe. O build público (`npm run build:release` e `npm run build:public`) usa este arquivo sempre.
 * Sem a extensão, o base se comporta como o Cobblemon sem o Mega Showdown.
 */

/** Sem a extensão: nunca liga. */
export function startMegaShowdown(): boolean {
	return false;
}

/** Sem a extensão: sempre desligada. */
export function isMegaShowdownActive(): boolean {
	return false;
}

/** Sem a extensão: nada a instalar. */
export function startMegaShowdownContent(): undefined {
	return undefined;
}
