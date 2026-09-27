// Tipos de ambiente do runtime de scripts do Bedrock (QuickJS).
import "@minecraft/server";

declare global {
	// console existe no runtime do Bedrock, mas não no lib ES2022.
	var console: {
		log(...data: unknown[]): void;
		info(...data: unknown[]): void;
		warn(...data: unknown[]): void;
		error(...data: unknown[]): void;
	};
}

// Estados de bloco customizados (cobblemon:*) não estão no BlockStateSuperset tipado do vanilla.
declare module "@minecraft/server" {
	interface BlockPermutation {
		getState(stateName: string): string | number | boolean | undefined;
		withState(name: string, value: string | number | boolean): BlockPermutation;
	}
}
