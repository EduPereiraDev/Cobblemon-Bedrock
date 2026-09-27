/**
 * Frente dados-ia: assentos condicionais de montaria (Cobblemon 1.8.0, `riding.seats[i].condition`, só datapack:
 * nenhuma espécie do 1.8.2 usa). No Kotlin, `PokemonEntity.seats` filtra os assentos cuja condição MoLang vale no
 * runtime da entidade (`q.entity` = a entidade, mais `q.passenger_count`), e só os que sobram aceitam passageiros.
 *
 * No Bedrock o `minecraft:rideable` tem assentos fixos: aqui a condição limita QUANTOS passageiros sobem (o número de
 * assentos que passam). A posição do assento continua a do índice no JSON (o Bedrock não troca a posição por script).
 */
import { SEAT_CONDITIONS } from "../../generated/scripts/dadosIa";
import { MoEnvironment, MoStruct } from "../npc/molang/MoLang";

/** Estado mínimo do Pokémon montado lido pelas condições. */
export interface SeatSubject {
  species: string;
  formName: string;
  aspects: readonly string[];
  level: number;
  shiny: boolean;
  wild: boolean;
  passengers: number;
  /** Struct completo do Pokémon (q.entity.pokemon), se disponível. */
  pokemon?: MoStruct;
  /** q.entity completo (PokemonEntity), criado só se houver condição; sem ele vale seatEntityStruct. */
  entityStruct?: () => MoStruct;
}

/** Condições por assento da forma (forma sem lista própria herda a da espécie), ou undefined. */
export function seatConditionsOf(species: string, formName = ""): Array<string | null> | undefined {
  const bySpecies = SEAT_CONDITIONS[species.replace(/^cobblemon:/, "").toLowerCase()];
  if (!bySpecies) return undefined;
  return bySpecies[formName] ?? bySpecies[""];
}

/** q.entity do PokemonEntity com o que as condições de assento costumam ler (is_alpha, aspects, nível...). */
export function seatEntityStruct(subject: SeatSubject): MoStruct {
  const struct = new MoStruct({
    level: subject.level,
    is_alpha: subject.aspects.includes("alpha") ? 1 : 0,
    is_shiny: subject.shiny ? 1 : 0,
    is_wild: subject.wild ? 1 : 0,
    species: subject.species.replace(/^cobblemon:/, ""),
    form: subject.formName,
  }, {
    has_aspect: args => (subject.aspects.includes(String(args[0] ?? "")) ? 1 : 0),
  });
  if (subject.pokemon) struct.set("pokemon", subject.pokemon);
  return struct;
}

/**
 * Quantos assentos valem agora (PokemonEntity.seats.size). Sem condições: `total`. Condição inválida vale false
 * (resolveBoolean de expressão quebrada dá 0 no Mocha).
 */
export function availableSeatCount(subject: SeatSubject, total: number, conditions = seatConditionsOf(subject.species, subject.formName)): number {
  if (!conditions) return total;
  const env = new MoEnvironment();
  env.withQuery("entity", subject.entityStruct?.() ?? seatEntityStruct(subject));
  env.query.fn("passenger_count", () => subject.passengers);
  let count = 0;
  for (let i = 0; i < total; i++) {
    const condition = conditions[i] ?? null;
    if (condition === null) { count++; continue; }
    try { if (env.evalBoolean(condition)) count++; }
    catch { /* condição inválida: assento indisponível */ }
  }
  return count;
}
