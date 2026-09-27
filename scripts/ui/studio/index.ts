/**
 * Frente "telas": câmera nas telas — estúdio 3D (modelo ao vivo atrás do form) e zoom/overlay do scanner da Pokédex.
 */
export {
  FRAMING, STUDIO_FOV, STUDIO_TAG, cameraFor, closeStudio, findStage, hasStudio, isOrphanStudioEntity, openStudio,
  setStudioSubject, startStudio, studioAvailable, studioEntityOf, sweepStudioLeftovers,
} from "./Studio";
export type { StudioFraming, StudioSubject } from "./Studio";
export {
  SCAN_OVERLAY_PREFIX, ZOOM_FOVS, isPersistentScanner, isScannerOn, scanOverlayMessage, setScannerInfo, startScanner,
  startScannerZoom, stopScanner, zoomStepAfterSlotChange,
} from "./ScannerZoom";

const STUDIO_PREF = "cobblemon:studio_view";

/**
 * Preferência do jogador pela vista 3D (botão "3D/2D" das telas). Sem escolha, vale o padrão da tela: o inicial abre em
 * 3D (tela única e o carrossel é o ponto dela); o resumo abre em 2D (abre toda hora; o 3D fica a um toque).
 */
export function prefersStudio(player: { getDynamicProperty(id: string): unknown }, fallback: boolean): boolean {
  const value = player.getDynamicProperty(STUDIO_PREF);
  return value === "on" ? true : value === "off" ? false : fallback;
}

export function setPrefersStudio(player: { setDynamicProperty(id: string, value?: string): void }, on: boolean) {
  player.setDynamicProperty(STUDIO_PREF, on ? "on" : "off");
}
