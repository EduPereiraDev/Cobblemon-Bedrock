# Pendências da frente "dados-ia" (aspects no cliente, species features, IA por behaviours, NPC, pasto, MoLang)

Arquivos da frente (novos): `tools/importer/pokemonBehaviours.ts`, `tools/importer/dadosIa.ts` (→ `generated/scripts/dadosIa.ts`),
`scripts/entity/{AspectSync,SpeciesAi,SeatConditions}.ts`, `scripts/pokemon/FeatureAssignments.ts`,
`scripts/machines/pastureConflict.ts`, `scripts/npc/NpcFlags.ts`, `scripts/debug/DadosIaProbe.ts`,
`scripts/molang/{GeneralFunctions,PokemonStruct,ItemStackStruct,EntityStruct,WorldStruct,PlayerFunctions,StructHooks}.ts`,
`tests/dados-ia.test.ts`, `tests/dados-ia-molang.ts` (chamado pelo primeiro).

Dona nesta onda: `tools/importer/entities.ts` (IA/eventos/propriedades do BP; os blocos de outras frentes, como o
`alpha_eyes` da visual-final e o `name?` de `ComboOut.layers`, foram mantidos), `tools/importer/posers.ts`,
`tools/importer/kotlinPosers.ts` e os 3 JSON congelados que mudaram (`data/kotlin-posers/{mareep,wooloo,dubwool}.json`).

Edições mínimas em arquivos de outras frentes (todas marcadas `// frente dados-ia`):
- `tools/importer/index.ts`: bits de aspect por espécie, `emitDadosIaModule`, `scrolling` nas camadas.
- `tools/importer/variants.ts`: lê `layers[].scrolling` (e entra na chave da camada só quando existe).
- `tools/importer/npcs.ts`: grupos `cobblemon:npc_pushable|npc_not_pushable|npc_leashable`, eventos e `cobblemon:projectile_hits`.
- `scripts/Pokemon.ts` (1 linha: `syncAspectBits` em `applyToCobblemon`), `scripts/PokemonProperties.ts` (fallback genérico
  de `chave=valor` de feature), `scripts/pokemon/SpeciesFeatures.ts` (padrões e herança genéricos),
  `scripts/entity/index.ts` (passe de 1 s: aspects/IA de espécie; registro da sonda), `scripts/entity/Riding.ts`
  (assentos condicionais), `scripts/machines/pasture.ts` (IA de ataque no lugar do impulso), `scripts/npc/NPCEntity.ts`
  (flags do NPC), `scripts/npc/molang/MoLang.ts` e `scripts/npc/PlayerStruct.ts` (1 linha cada: registro das funções),
  `scripts/evolution/requirements/GenericRequirements.ts` (`q.pokemon` completo), `scripts/starter.ts` (grava o UUID do inicial).

## Status por item

| # | Item | Status | Notas / prova |
|---|---|---|---|
| 28 | `q.has_aspect` nos posers JSON | FEITO | O importador junta, por espécie, os aspects citados por `q.has_aspect` nos posers (JSON e Kotlin) e cria a propriedade int sincronizada `cobblemon:aspects` (1 bit por aspect; só nas espécies que precisam: Mareep, Wooloo, Dubwool = `sheared`; Slowpoke = `regrown-tail-1..3`), limite de 32 propriedades preservado. A client entity calcula `v.cobblemon_aspect_<nome>` no `pre_animation`; `q.has_aspect('x')` vira essa variável em condições de pose, de animação e de visibilidade (`isVisible`). O script grava o bitmask em `applyToCobblemon` e no passe de 1 s (`AspectSync.ts`). Literais `true`/`false` soltos viram `1.0`/`0.0`. **Bug corrigido de brinde:** o conversor Kotlin perdia `withCondition(...)` e `withVisibility(visibility = expr)`: Mareep/Wooloo/Dubwool ficavam sempre sem lã e o Mareep tocava as duas caminhadas juntas. |
| 109 | `species_feature_assignments` (87) | FEITO | `generated/scripts/dadosIa.ts` traz as 95 definições de `species_features` (+ `sheared` e a cauda do Slowpoke, registradas em código, e a global `blocks_traveled`) e as features de 268 espécies (`species.features` que existem + as 87 atribuições). `FeatureAssignments.ts` faz o que o setter de espécie do Cobblemon faz: valor existente fica, senão padrão (`default` que é escolha, sorteio em `random`, pesos em `weighted_choice`, `true/false/random` em flag) → aspect (`aspectFormat` / 1ª chave da flag). Vale na criação (`generateNewWildPokemon`) e na troca de espécie (evolução leva a feature se a espécie nova também a tem: cor do Wooloo→Dubwool, `alolan`). `chave=valor` de qualquer feature de aspect funciona em propriedades e `matches` (ex.: `alcremie cream=mint`). Conferido: 3576 Pokémon gerados (4 por espécie) com nome Showdown válido. |
| 111 | Presets de IA de espécie (`behaviours`, 49) | FEITO (aproximação por componentes) | `pokemonBehaviours.ts` avalia os behaviours automáticos (`pokemon/auto/*`) + a lista `ai` da espécie com as condições MoLang (`q.entity.behaviour.*`, `is_in_party`, `is_wild`, `is_alpha`, `is_pastured`, `pasture_conflict_enabled`), recursivo em `apply_behaviours`, em 5 contextos (selvagem, selvagem Alfa, no time, pasto, pasto com conflito), e converte as TAREFAS em componentes vanilla (tabela no topo do arquivo). Grupos: `cobblemon:wild_ai`, `cobblemon:owned_ai` (gerados), `cobblemon:alpha_ai` (retaliates do Alfa), `cobblemon:pasture_conflict`. `in_battle` continua sem componentes da base; `battle_start` tira todos os grupos de IA, `battle_end`/`wake`/`shoulder_off`/`on_dismount` devolvem (Alfa por filtro). Novos por dado real: Alfa revida (qualquer espécie), Pidgeotto no time caça Magikarp na superfície (`target_entity`), Ninjask/Combee voam na faixa de altura do `set_variables`, `avoids_water` → `move_to_land`, Nosepass aponta para o spawn (`point_to_spawn`, script `SpeciesAi.ts`). Tarefas sem componente vanilla: sono (já por script), `fly_in_circles`, `flee_nearest_hostile`, `walk_away_from_avoid_target` (ignoradas). `hate_entity` (Seviper/Zangoose): N/A NO COBBLEMON — `HateEntityTaskConfig.kt` avalia a condição na própria entidade (`withQueryValue("entity", entity...)`), então nunca dispara no 1.8.2. |
| — | `isMovable`/`isLeashable`/`allowProjectileHits` | FEITO / NÃO POSSÍVEL (parte) | Valor do NPC (MoLang `set_movable`/`set_leashable`/`set_allow_projectile_hits`, dynamic property) ou da classe/preset, padrão true: empurrável troca grupo `npc_pushable`/`npc_not_pushable`; guia = grupo com `minecraft:leashable`; projéteis não ferem com `cobblemon:projectile_hits=false`. NÃO POSSÍVEL: o projétil **atravessar** o NPC (no Bedrock o projétil para na entidade; não há filtro de colisão por entidade). NPCs salvos antes recebem o estado no `onLoad`. |
| 51 | Pasto: atacar hostis | FEITO (IA) | Grupo `cobblemon:pasture_conflict` (`nearest_attackable_target` contra `monster` sem creeper/slime/magma cube/piglin, como o `AttackHostileMobsTask`, + `melee_box_attack` com o `minecraft:attack` da espécie). `tickPastureConflicts` liga o grupo só enquanto há um monstro válido **dentro da área** do pasto e desliga quando não há (a IA do Bedrock não conhece a área); desligar no menu tira na hora. O impulso+dano por script ficou só como reserva para entidades sem o grupo. |
| 70 | MoLang de datapack | FEITO (o que o Bedrock permite) | Gerais (~30 novas: variáveis, strings, números, listas, `run_command`, `run_script`, datas, `file` em dynamic properties...), `q.item` (`is_enchanted`, `has_enchantment`...), `q.pokemon` completo (`PokemonMoLangFunctions.kt` inteiro + espécie + `q.pokemon.entity`; marcas `marks/has_mark/remove_marks/add_marks...`), `q.player` (1.8: `has_chosen_starter`, `get_starter_uuid`, `has_tm_move_unlocked`/`unlock_tm_move`/`lock_tm_move`; Pokédex com id de dex opcional em `dex_caught_count`/`dex_seen_count`; inventário, time, PC...), `q.world` (inclui `spawn_loot_table_items` pelo LootTableManager estável). NÃO POSSÍVEL (retornam 0): `swing_hand`, `seen_credits`, structs de batalha/servidor, memórias/pathfinding de Brain, estados de montaria por script, `curve` (cliente Java); chuva/neve por posição aproximadas (clima por evento + tags de bioma). |
| 84 | Só datapack: MoLang novos, `scrolling`, assentos condicionais | FEITO | MoLang novos: ver #70. `scrolling` (camada com `{speedU, speedV}`): `uv_anim` no render controller da camada, velocidade por variante (`math.mod(q.life_time * v, 1)`, como `getScrollingLayer`). Assentos condicionais: `SEAT_CONDITIONS` (espécie/forma → condição por assento) e `canRidePokemon` só deixa subir até o número de assentos cuja condição vale, com `q.entity` do PokemonEntity e `q.passenger_count`. NÃO POSSÍVEL: mudar a POSIÇÃO do assento quando um anterior é filtrado (o `minecraft:rideable` tem assentos fixos). Nenhum dado do 1.8.2 usa `scrolling` nem `condition` em assentos. |

## Verificação (2026-09-26)

- `npx tsc -p tsconfig.json`: 0 erros (projeto inteiro).
- `npm test`: todas as suítes passam; `tests/dados-ia.test.ts` → `ok: dados-ia (q.has_aspect, species features, IA por
  behaviours, NPC, pasto, scrolling, assentos condicionais, MoLang)`; as suítes de outras frentes (entidades,
  mundo-detalhes, gameplay, jogabilidade...) continuam passando com a IA gerada.
- `npm run validate`: `OK: nenhum erro` (902 entidades BP, 897 client entities, 2006 render controllers).
- `node tools/check-ui-baseline.mjs`: ok, 0 avisos.
- BDS `cobblemon-bds-dadosia` (porta 19143, raknet, `dist-dadosia`; `setworldspawn 0 100 0` + `tickingarea add circle 0 64 0 4`):
  log da sessão final **sem nenhum ERROR/WARN** fora o aviso de transporte do próprio BDS (a 1ª subida acusou
  `minecraft:leashable` com `soft/hard/max_distance` inválidos no formato 1.21.90 — corrigido para `{}`).
  - `debug_battle pikachu eevee 20`, `mareep wooloo 30`, `pidgeotto nosepass 25`, `slowpoke combee 22`,
    `vivillon alcremie 40` → todas `ended (win)`.
  - `dadosia_spawn mareep sheared alpha` → `aspects=[male,sheared,alpha] cobblemon:aspects=1 alpha=true`;
    `slowpoke regrown-tail-1,regrown-tail-3` → `cobblemon:aspects=5`; Spinda com as 5 features de manchas; Vivillon
    `vivillon-wings-meadow`; Wooloo com `color-none`; Alcremie com creme e decoração sorteados (variante 128).
  - `dadosia_events`: Alfa → pasto liga → batalha começa (`pasture_conflict=false in_battle=true`) → termina → pasto
    desliga → tira Alfa, todos os eventos aceitos.
  - `dadosia_npc`: `nasce leashable=true projectile_hits=true; desligado leashable=false projectile_hits=false; religado ...=true`.
  - `dadosia_attack machop off` (controle) → husk fica com 16 de vida em 10 s; `dadosia_attack machop on` → husk 16 → 7 → 1 →
    morto em 4–6 s (a IA do grupo `pasture_conflict` ataca de fato).
  - Container removido no fim (`docker rm -f cobblemon-bds-dadosia`).
- O BDS não carrega o RP: `q.has_aspect` no cliente (lã/cauda) e `uv_anim` foram conferidos pelo JSON gerado, pelo
  `validate` e pelo teste, não num cliente.

## Sonda de console

`scriptevent cobblemon:debug_probes on` e depois (só pelo console, `tickingarea` antes se não houver jogador):
`scriptevent cobblemon:dadosia_spawn <espécie> [aspect,aspect] [alpha]`, `cobblemon:dadosia_events`,
`cobblemon:dadosia_npc`, `cobblemon:dadosia_attack [espécie] [on|off]`.

## Pedidos

Nenhum pendente. Observação para a frente dona de `scripts/entity/Sleep.ts`: o sono não tira `cobblemon:alpha_ai` nem
`cobblemon:pasture_conflict` (fica como as tarefas de "core" do Cobblemon); ao ser ferido o Pokémon acorda pelo
`onPokemonHurt` e revida.
