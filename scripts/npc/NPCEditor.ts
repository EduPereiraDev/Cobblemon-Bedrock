/**
 * Editor de NPC (NPCEditCommand / tela de edição do Cobblemon, simplificada em ModalFormData): nome, nível,
 * skin, classe, diálogo de interação, habilidade da IA, nameTag visível, skin de jogador (por nome), escalas e
 * caixa de colisão, idioma dos nomes (opção do mundo), behaviours (Behaviour Editor), variáveis de configuração
 * (classe + behaviours) e "gerar o time de novo".
 */
import { Player } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { NPC_SKINS } from "../../generated/scripts/npcs";
import { NPC, NPC_NAME_LANGUAGES, NPC_SKIN_PROPERTY, getNPCNameLanguage, setNPCNameLanguage } from "./NPCEntity";
import { getEditableBehaviours } from "./Behaviours";
import { getNPCClassIds, getNPCPresetIds } from "./NPCClass";
import { getDialogueIds } from "./dialogue/Dialogue";
import { provideParty } from "./Party";

const K = {
  title: "cobblemon.port.npc.editor.title",
  name: "cobblemon.port.npc.editor.name",
  level: "cobblemon.port.npc.editor.level",
  skin: "cobblemon.port.npc.editor.skin",
  npcClass: "cobblemon.port.npc.editor.class",
  dialogue: "cobblemon.port.npc.editor.dialogue",
  classDefault: "cobblemon.port.npc.editor.class_default",
  none: "cobblemon.port.npc.editor.none",
  regenerate: "cobblemon.port.npc.editor.regenerate_party",
  saved: "cobblemon.port.npc.editor.saved",
  skill: "cobblemon.port.npc.editor.skill",
  nameTag: "cobblemon.port.npc.editor.name_tag_visible",
  playerSkin: "cobblemon.port.npc.editor.player_skin",
  renderScale: "cobblemon.port.npc.editor.render_scale",
  hitboxScale: "cobblemon.port.npc.editor.hitbox_scale",
  hitboxWidth: "cobblemon.port.npc.editor.hitbox_width",
  hitboxHeight: "cobblemon.port.npc.editor.hitbox_height",
  nameLanguage: "cobblemon.port.npc.editor.name_language",
  behaviours: "cobblemon.port.npc.editor.behaviours",
} as const;

function skinLabel(index: number): string {
  const skin = NPC_SKINS[index];
  return skin ? `${index}: ${skin.texture.replace(/^cobblemon:textures\/npcs\//, "").replace(/\.png$/, "")}` : String(index);
}

export async function openNPCEditor(player: Player, npc: NPC): Promise<void> {
  const classes = [...new Set([...getNPCClassIds(), ...getNPCPresetIds()])];
  const dialogues = getDialogueIds();
  const current = npc.interaction;
  const override = npc.entity.getDynamicProperty("npc:interaction") !== undefined;
  const dialogueIndex = !override ? 0 : current?.type === "dialogue" ? Math.max(0, dialogues.indexOf(current.dialogue)) + 2 : 1;
  let skin = 0;
  try { skin = Number(npc.entity.getProperty(NPC_SKIN_PROPERTY) ?? 0); } catch { }

  const behaviours = getEditableBehaviours();
  const activeBehaviours = new Set(npc.behaviourIds);
  const hitbox = npc.hitbox;
  const languages = NPC_NAME_LANGUAGES;

  const form = new ModalFormData()
    .title({ translate: K.title })
    .textField({ translate: K.name }, "NPC", { defaultValue: npc.name })
    .slider({ translate: K.level }, 1, 100, { valueStep: 1, defaultValue: Math.min(100, npc.level) })
    .dropdown({ translate: K.skin }, NPC_SKINS.map((_, i) => skinLabel(i)), { defaultValueIndex: Math.min(skin, Math.max(0, NPC_SKINS.length - 1)) })
    .dropdown({ translate: K.npcClass }, classes, { defaultValueIndex: Math.max(0, classes.indexOf(npc.classId)) })
    .dropdown({ translate: K.dialogue }, [{ translate: K.classDefault }, { translate: K.none }, ...dialogues], { defaultValueIndex: dialogueIndex })
    .slider({ translate: K.skill }, 0, 5, { valueStep: 1, defaultValue: npc.skill })
    .toggle({ translate: K.nameTag }, { defaultValue: !npc.hideNameTag })
    .textField({ translate: K.playerSkin }, "Steve", { defaultValue: npc.playerTexture ?? "" })
    .textField({ translate: K.renderScale }, "1", { defaultValue: String(npc.renderScale) })
    .textField({ translate: K.hitboxScale }, "1", { defaultValue: String(npc.hitboxScale) })
    .textField({ translate: K.hitboxWidth }, "0.6", { defaultValue: String(hitbox.width) })
    .textField({ translate: K.hitboxHeight }, "1.8", { defaultValue: String(hitbox.height) })
    .dropdown({ translate: K.nameLanguage }, languages, { defaultValueIndex: Math.max(0, languages.indexOf(getNPCNameLanguage())) });
  for (const behaviour of behaviours)
    form.toggle({ rawtext: [{ translate: K.behaviours }, { text: ": " }, { translate: behaviour.name }] }, { defaultValue: activeBehaviours.has(behaviour.id) });
  const config = npc.getConfig();
  const variables = npc.configVariables;
  for (const variable of variables) {
    const value = config[variable.variableName];
    if (variable.type === "BOOLEAN") form.toggle({ translate: variable.displayName }, { defaultValue: value === 1 });
    else form.textField({ translate: variable.displayName }, variable.defaultValue, { defaultValue: String(value ?? "") });
  }
  form.toggle({ translate: K.regenerate }, { defaultValue: false });

  const response = await form.show(player);
  if (response.canceled || !response.formValues || !npc.entity.isValid) return;
  const values = response.formValues;
  let i = 0;
  const name = String(values[i++] ?? "").trim();
  const level = Math.max(1, Math.floor(Number(values[i++] ?? npc.level)));
  const skinIndex = Number(values[i++] ?? skin);
  const classId = classes[Number(values[i++] ?? 0)] ?? npc.classId;
  const dialogueChoice = Number(values[i++] ?? 0);
  const skillValue = Number(values[i++] ?? npc.skill);
  const nameTagVisible = values[i++] !== false;
  const playerSkin = String(values[i++] ?? "").trim();
  const renderScale = Number(values[i++] ?? 1);
  const hitboxScale = Number(values[i++] ?? 1);
  const hitboxWidth = Number(values[i++] ?? hitbox.width);
  const hitboxHeight = Number(values[i++] ?? hitbox.height);
  const language = languages[Number(values[i++] ?? 0)] ?? getNPCNameLanguage();
  const behaviourValues = behaviours.map(() => values[i++] === true);
  const configValues = variables.map(() => values[i++]);
  const regenerate = values[i++] === true;

  const oldLevel = npc.level;
  const classChanged = classId !== npc.classId;
  if (classChanged) {
    npc.entity.setDynamicProperty("npc:class", classId);
    npc.entity.setDynamicProperty("npc:config", undefined);
    npc.entity.setDynamicProperty("npc:behaviours", undefined);
  }
  const fresh = new NPC(npc.entity);
  if (classChanged) fresh.initialize(level);
  else npc.entity.setDynamicProperty("npc:level", level);
  if (name && name !== fresh.name) fresh.setNameKey(name);
  fresh.setSkill(Number.isFinite(skillValue) && skillValue !== fresh.npcClass.skill ? skillValue : undefined);
  fresh.setNameTagVisible(nameTagVisible);
  if (language !== getNPCNameLanguage()) setNPCNameLanguage(language);
  if (dialogueChoice === 0) fresh.setInteraction(undefined);
  else if (dialogueChoice === 1) fresh.setInteraction({ type: "none" });
  else fresh.setInteraction({ type: "dialogue", dialogue: dialogues[dialogueChoice - 2] });
  if (!classChanged) {
    // Behaviours editados: a lista passa a ser do NPC (behavioursAreCustom).
    const chosen = behaviours.filter((_, index) => behaviourValues[index]).map(x => x.id);
    const keep = fresh.behaviourIds.filter(id => !behaviours.some(x => x.id === id));
    const next = [...keep, ...chosen];
    const current = fresh.behaviourIds;
    if (next.length !== current.length || next.some(x => !current.includes(x))) fresh.setBehaviours(next);
    variables.forEach((variable, index) => {
      const value = configValues[index];
      if (value !== undefined) fresh.setConfigValue(variable.variableName, value as string | number | boolean);
    });
    fresh.applyBehaviours();
  }
  if (playerSkin !== (fresh.playerTexture ?? "")) fresh.setPlayerTexture(playerSkin || undefined);
  else if (!playerSkin) fresh.setSkin(skinIndex);
  if (Number.isFinite(renderScale) && renderScale > 0) fresh.setRenderScale(renderScale);
  if (Number.isFinite(hitboxScale) && hitboxScale > 0) fresh.setHitboxScale(hitboxScale);
  if (Number.isFinite(hitboxWidth) && Number.isFinite(hitboxHeight) && hitboxWidth > 0 && hitboxHeight > 0
    // Frente limites-a: só grava se o jogador mudou o que o editor mostrou (a hitbox padrão pode virar a da espécie
    // quando o behaviour resource_identifier entra nesta mesma edição).
    && (hitboxWidth !== hitbox.width || hitboxHeight !== hitbox.height)
    && (hitboxWidth !== fresh.defaultHitbox.width || hitboxHeight !== fresh.defaultHitbox.height))
    fresh.setHitbox({ width: hitboxWidth, height: hitboxHeight });
  if (regenerate || (!classChanged && level !== oldLevel)) {
    const provider = fresh.npcClass.party;
    fresh.setParty(provider?.isStatic ? provideParty(provider, fresh.partyContext()) : undefined);
  }
  player.sendMessage({ translate: K.saved, with: [fresh.name] });
}
