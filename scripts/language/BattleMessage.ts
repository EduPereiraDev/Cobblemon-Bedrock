import { RawMessage } from "@minecraft/server";
import { getMoveTranslation } from ".";


/** Used for translation key */
const statusNames: { [key: string]: string } = {
  brn: "burn",
  fnt: "faint",
  frz: "frozen",
  par: "paralysis",
  slp: "sleep",
  tox: "poisonbadly",
  psn: "poison"
}

/** Used for translation key */
export const statNames: { [key: string]: string } = {
  spe: "speed",
  hp: "hp",
  atk: "attack",
  def: "defence",
  spa: "special_attack",
  spd: "special_defence",
  accuracy: "accuracy", //Hope these are right
  evasion: "evasion"
}
