/**
 * Custom components de bloco da frente "adaptacoes" (registrados por scripts/adaptacoes/index.ts no startup; ficam
 * aqui para o validador do importador enxergar a chave).
 */
import { BlockCustomComponent } from "@minecraft/server";
import { decoratedPotComponent } from "../adaptacoes/decoratedPot";

export const ADAPTACOES_BLOCK_COMPONENTS: Record<string, BlockCustomComponent> = {
  "cobblemon:decorated_pot": decoratedPotComponent,
};
