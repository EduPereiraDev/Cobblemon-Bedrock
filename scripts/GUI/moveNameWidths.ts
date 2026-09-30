/**
 * Frente msd-beta: largura (px na escala 1, a maior entre as línguas dos packs) do nome de cada golpe mais largo que
 * uma linha do tile (scripts/GUI/layoutSpec.ts, MOVE_NAME). O script não sabe o texto traduzido (o cliente traduz a
 * chave `cobblemon.move.<id>`), então o build mede os .lang dos resource packs em dist/ (tools/ui/moveNameWidths.mjs)
 * e troca este stub pelos dados reais; o tsc e os testes usam o stub (nenhum nome longo).
 */
export const MOVE_NAME_WIDTHS: Readonly<Record<string, number>> = {};
export const MOVE_NAME_WIDTHS_BUILT: boolean = false;
