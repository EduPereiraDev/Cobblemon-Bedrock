/**
 * Editor da config para operadores (equivalente à tela de config do Cobblemon, que no Java é do
 * cliente): escolhe a categoria e edita os campos num ModalFormData. Rótulos e dicas vêm das
 * chaves `cobblemon.config.ui.*` do próprio Cobblemon.
 */
import { Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import {
  CONFIG_CATEGORIES, CONFIG_FIELDS, ConfigCategory, ConfigFieldSpec, DEFAULT_CONFIG, coerceConfigValue, getConfig,
  resetConfig, setConfigValue,
} from "../Config";
import { message } from "../language";
import { K, join, showYesOrNoDialog, tr } from "./common";

function fieldLabel(field: ConfigFieldSpec) {
  return { translate: `cobblemon.config.ui.${field.lang}` };
}

function categoryLabel(category: ConfigCategory) {
  return { translate: `cobblemon.config.ui.category.${category}` };
}

/** Menu de categorias. */
export async function showConfigEditor(player: Player): Promise<void> {
  const categories = CONFIG_CATEGORIES.filter(category => CONFIG_FIELDS.some(field => field.category === category));
  while (true) {
    const form = new ActionFormData().title(tr(K.configTitle)).body(tr(K.configJsonOnly));
    categories.forEach(category => form.button(categoryLabel(category)));
    form.button({ translate: "cobblemon.config.ui.reset" });
    const response = await form.show(player);
    if (response.selection === undefined) return;
    if (response.selection === categories.length) {
      if (await showYesOrNoDialog(player, { translate: "cobblemon.config.ui.reset" }, tr(K.configTitle))) {
        resetConfig();
        player.sendMessage(message.color("Green", tr(K.configReset)));
      }
      continue;
    }
    await showCategoryForm(player, categories[response.selection]);
  }
}

/** Formulário de uma categoria: toggle (booleano), dropdown (opções), texto (número/lista/texto). */
export async function showCategoryForm(player: Player, category: ConfigCategory): Promise<void> {
  const fields = CONFIG_FIELDS.filter(field => field.category === category);
  const config = getConfig() as unknown as Record<string, unknown>;
  const form = new ModalFormData().title(join(tr(K.configTitle), " - ", categoryLabel(category)));
  for (const field of fields) {
    const value = config[field.key];
    const tooltip = { translate: `cobblemon.config.ui.${field.lang}.tooltip` };
    if (typeof value === "boolean") form.toggle(fieldLabel(field), { defaultValue: value, tooltip });
    else if (field.options) {
      form.dropdown(fieldLabel(field), field.options.map(option => ({ translate: `cobblemon.config.ui.${field.lang}.${option}` })),
        { defaultValueIndex: Math.max(0, field.options.indexOf(String(value))), tooltip });
    }
    else {
      const text = Array.isArray(value) ? value.join(", ") : String(value);
      const hint = join(`${String(Array.isArray(DEFAULT_CONFIG[field.key]) ? "a, b" : DEFAULT_CONFIG[field.key])}`,
        field.min !== undefined || field.max !== undefined ? ` [${field.min ?? "-∞"}..${field.max ?? "∞"}]` : "");
      form.textField(fieldLabel(field), hint, { defaultValue: text, tooltip });
    }
  }
  form.submitButton({ translate: "cobblemon.ui.generic.save" });
  const response = await form.show(player);
  if (!response.formValues) return;
  const invalid: ConfigFieldSpec[] = [];
  let changed = 0;
  fields.forEach((field, i) => {
    let raw = response.formValues![i];
    if (field.options && typeof raw === "number") raw = field.options[raw];
    const current = config[field.key];
    const coerced = coerceConfigValue(field.key, raw);
    if (coerced === undefined) { invalid.push(field); return; }
    if (JSON.stringify(coerced) === JSON.stringify(current)) return;
    if (setConfigValue(field.key, coerced)) changed++;
  });
  for (const field of invalid) player.sendMessage(message.error(tr(K.configInvalid, fieldLabel(field))));
  if (changed > 0) player.sendMessage(message.color("Green", tr(K.configSaved, changed)));
}
