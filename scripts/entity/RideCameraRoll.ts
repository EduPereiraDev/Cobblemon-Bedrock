/**
 * Roll da câmera na montaria voadora (#38) — APROXIMAÇÃO, DESLIGADA por padrão (só no modo de câmera "roll",
 * `/scriptevent cobblemon:ride_camera roll`).
 *
 * Java: o OrientationController da montaria (quaternion) gira a câmera com o roll do voo (CameraMixin /
 * RidingCameraInterface). No Bedrock estável os presets e o `setCamera` só têm yaw/pitch; o único Vector3 de rotação
 * é o `RotationKeyFrame` das animações por spline (`Camera.playAnimation`, estável desde a 2.6.0). Então a câmera
 * vira "perseguidora": a cada 3 ticks uma spline curta atrás da montaria, com o z = `cobblemon:roll` do modelo.
 * Limites (pesquisa 8 §5): o servidor aceita a spline com z, mas se o cliente rola a tela não dá para confirmar sem
 * cliente; e a câmera fica presa à spline (atraso de rede entre o mouse e a imagem). Por isso fica desligada.
 */
import { EasingType, Entity, LinearSpline, Player, Vector3, system } from "@minecraft/server";

function add(a: Vector3, b: Vector3, k = 1): Vector3 { return { x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k }; }

/** Distância atrás da montaria e altura da câmera perseguidora. */
const CHASE_BACK = 6;
const CHASE_UP = 2;
const CHASE_SECONDS = 0.2;

/** Spline curta atrás da montaria com o roll do modelo (`first`: entra no preset minecraft:free). */
export function chaseRollCamera(player: Player, mount: Entity, first: boolean) {
  if (first) {
    try { player.camera.setCamera("minecraft:free", { location: player.getHeadLocation(), rotation: player.getRotation() }); } catch { }
  }
  const rot = player.getRotation();
  const view = player.getViewDirection();
  const v = mount.getVelocity();
  let roll = 0;
  try { const r = mount.getProperty("cobblemon:roll"); if (typeof r === "number") roll = r; } catch { }
  const base = add(add(mount.location, { x: 0, y: CHASE_UP, z: 0 }), view, -CHASE_BACK);
  const next = add(base, v, CHASE_SECONDS * 20);
  const spline = new LinearSpline();
  spline.controlPoints = [base, next];
  try {
    player.camera.playAnimation(spline, {
      totalTimeSeconds: CHASE_SECONDS,
      animation: {
        progressKeyFrames: [{ alpha: 0, timeSeconds: 0 }, { alpha: 1, timeSeconds: CHASE_SECONDS }],
        rotationKeyFrames: [
          { timeSeconds: 0, rotation: { x: rot.x, y: rot.y, z: roll } },
          { timeSeconds: CHASE_SECONDS, rotation: { x: rot.x, y: rot.y, z: roll } },
        ],
      },
    });
  }
  catch { }
}

/** Keyframes do teste de roll: câmera parada, roll 0 → +g → −g → 0 em 4 s. */
export function rollTestKeyframes(pitch: number, yaw: number, degrees: number) {
  return [
    { timeSeconds: 0, rotation: { x: pitch, y: yaw, z: 0 }, easingFunc: EasingType.Linear },
    { timeSeconds: 1, rotation: { x: pitch, y: yaw, z: degrees }, easingFunc: EasingType.InOutSine },
    { timeSeconds: 2.5, rotation: { x: pitch, y: yaw, z: -degrees }, easingFunc: EasingType.InOutSine },
    { timeSeconds: 4, rotation: { x: pitch, y: yaw, z: 0 }, easingFunc: EasingType.InOutSine },
  ];
}

/** Sonda para conferir no cliente se o z da spline rola a tela (só com as sondas de depuração ligadas). */
export function cameraRollTest(player: Player, degrees = 30) {
  const eye = player.getHeadLocation();
  const rot = player.getRotation();
  const spline = new LinearSpline();
  spline.controlPoints = [eye, add(eye, { x: 0, y: 0.01, z: 0 })];
  try {
    player.camera.setCamera("minecraft:free", { location: eye, rotation: { x: rot.x, y: rot.y } });
    player.camera.playAnimation(spline, {
      totalTimeSeconds: 4,
      animation: {
        progressKeyFrames: [{ alpha: 0, timeSeconds: 0 }, { alpha: 1, timeSeconds: 4 }],
        rotationKeyFrames: rollTestKeyframes(rot.x, rot.y, degrees),
      },
    });
  }
  catch (e) {
    console.warn(`[montaria] camera_roll_test: ${e}`);
  }
  system.runTimeout(() => { if (player.isValid) try { player.camera.clear(); } catch { } }, 4 * 20 + 4);
}
