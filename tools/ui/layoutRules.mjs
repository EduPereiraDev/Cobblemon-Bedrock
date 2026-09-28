// Frente ui-layout: regras de layout por tela (tests/ui-layout.test.ts e tools/ui/preview.mjs).
//  - `allow`: pares de trechos de caminho que PODEM se sobrepor de propósito.
export const SCREEN_RULES = {
	// O modelo/perfil fica em pé sobre a plataforma do tipo (StarterSelectionScreen/PokemonInfoWidget).
	starter: { allow: [["cells/cell_12/", "cells/cell_13/"]] },
	"pokedex-entry-caught": { allow: [["entry/cell_0/", "entry/cell_1/"]] },
	"pokedex-entry-seen": { allow: [["entry/cell_0/", "entry/cell_1/"]] },
	// O "?" (platform_unknown) fica em cima da plataforma sem tipo.
	"pokedex-entry-unknown": { allow: [["entry/cell_1/", "entry/cell_8/"]] },
	// O brilho do papel de parede (StorageWidget: 208×189, 17 px além da tela) passa por baixo dos painéis vizinhos.
	pc: { allow: [["box/wallpaper", "/cell_"]] },
};
