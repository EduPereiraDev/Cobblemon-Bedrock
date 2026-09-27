# Frente "jogabilidade-final"

Arquivos da frente: `scripts/Pokemon.ts`, `scripts/pokemon/**`, `scripts/battle/**`, `scripts/GUI/**` (menos `GUI/PC.ts`),
`scripts/main.ts`, `scripts/commands.ts`, `scripts/Config.ts`, `scripts/evolution/**`, `scripts/entity/Interactions.ts`,
`scripts/npc/**`, `tests/jogabilidade.test.ts`, seção `## jogabilidade-final` de `resource_packs/CobblemonBedrock/texts/{en_US,pt_BR}.lang`
e `behavior_packs/CobblemonBedrock/entities/vanilla_overrides/` (pedido explícito da tarefa). A pedido do coordenador,
também um gancho em `scripts/trade/TradeManager.ts` (sem dono): `recordTrade` no fim da troca.

Verificação: `npx tsc -p tsconfig.json` sem erros; `npm test` passa (inclui `tests/jogabilidade.test.ts`).
Sem build, import nem BDS (regras da onda).

## Situação por item

| # | Item | Situação | Notas |
|---|---|---|---|
| 1 | Cura passiva, timer de desmaio, `passiveStatuses` | FEITO | `scripts/pokemon/PassiveHealing.ts` (port de `PlayerPartyStore.onSecondPassed`): 1 passe/s por jogador (`system.runJob`, um jogador por tick), só fora de batalha. Desmaio: `faintedTimer` = `defaultFaintTimer`, desce 1/s, em −1 volta com `ceil(máx × faintAwakenHealthPercent)` + `cobblemon.party.faintRecover` (0 desliga). Cura: `healTimer` reinicia em toda mudança de HP (o setter do Kotlin; aqui detectada pelo HP do segundo anterior) e cura `round(max(1, máx × healPercent))` em −1 (0 desliga). Status: duração sorteada em `passiveStatuses[cobblemon:<status>]`, não conta com o jogador dormindo (`player.isSleeping`), some com `cobblemon.status.<x>.cure`; veneno 1/15 por segundo (5 %, grave 10 %, mínimo 1), Poison Heal cura e limpa o status com HP cheio, desmaiar pelo veneno tira 1 de amizade e recolhe o Pokémon em campo. Campos novos no `PokemonData`: `faintedTimer`, `healTimer`, `statusTimer {status, secondsLeft}`. Timers que só mudam de contagem ficam em memória e são gravados a cada `pokemonSaveIntervalSeconds` (30 s); mudança de HP/status grava na hora (time + entidade em campo). |
| 2 | Animação/sequência de evolução | FEITO | `scripts/evolution/EvolutionEffect.ts` + `Evolution.forceEvolve`. Com o Pokémon em campo (não em batalha): fica parado (`slowness` 255 + `cobblemon:busy`), em 1 s toca `cobblemon.evolution.full` e a actionbar "X está evoluindo!", partículas vanilla no ritmo da animação (`enchanting_table_particle` até 6,25 s, brilho `endrod` até 11,2 s, rajada `totem_particle` na troca), troca de modelo em 11,2 s (relê os dados da entidade e `applyToCobblemon`), grito da nova espécie em 12 s, `cobblemon.ui.evolve.into` no chat + título. Sem entidade (na bola) ou no ombro (recolhido antes, como `tryRecallWithAnimation`): `cobblemon.evolution.ui` + mensagem na hora. Os dados mudam na hora (troca, doces, pedras, menu e level-up usam o retorno de `forceEvolve`); só o modelo espera. Os ids de som do pack são `cobblemon.evolution.*` (não `cobblemon.pokemon.evolution.*`; corrigido o aviso de evolução pronta). As partículas `cobblemon:evo_*` do Cobblemon não estão no RP (pedido opcional abaixo). |
| 3 | Espectador de batalha | FEITO | `scripts/battle/Spectate.ts`. Interagir com um **jogador** em batalha (sem estar em batalha, `allowSpectating`) abre "Assistir / Trocar" (a roda do `RequestInteractionsHandler`); interagir com um **Pokémon** em batalha assiste direto. Regras do `SpectateBattleHandler`: config, a si mesmo, alvo sem batalha, espectador em batalha, `battleSpectateMaxDistance`. `/cobblemon:spectatebattle <jogador>` (admin, como `SPECTATE_BATTLE` = nível 4) ignora config e distância, como o comando do Cobblemon. O espectador recebe as últimas 12 mensagens (`BattleMessagePacket(chatLog)`), todas as seguintes (`broadcastChatMessage` já incluía `spectators`), uma actionbar por segundo com os Pokémon em campo (HP em %) e uma tela só de leitura (turno, atores, Pokémon em campo com nível/HP/status, últimas mensagens; Atualizar / Parar de assistir). Sai ao parar, sair do jogo, entrar numa batalha ou no fim da batalha. |
| 4 | Selvagem em duplas automático | N/A NO COBBLEMON 1.8.2 | Evidência: `ChallengeHandler.handle` e `PokemonEntity.forceBattle` chamam `BattleBuilder.pve(player, entity, lead)` com o formato padrão `BattleFormat.GEN_9_SINGLES` e um único `PokemonBattleActor`; `MultiPokemonBattleActor` só aparece num trecho comentado de `command/TestCommand.kt`. Não há regra de "outro selvagem por perto". O port mantém `startWildBattle(player, [a, b])` só como API. |
| 5 | NPC `start_battle` com `cloneParties`/`setLevel` | FEITO | `scripts/battle/index.ts` (`BattleTeamOptions`, `buildBattleTeam`, `cloneForBattle`) + `scripts/npc/NPCEntity.ts` (`trainerTeamOptions`). Como `NPCServerDelegate`/`BattleBuilder.pvn`: `cloneParties = setLevel != −1 \|\| arg3`; cópias com UUID novo e `battleClone` (BattlePokemon.safeCopyOf), o líder mapeado para a cópia; `setLevel > 0` põe cópias e time do NPC no nível, curados, e recolhe os Pokémon reais em campo antes; `healFirst` cura a cópia (ou o time real sem clone). Nada volta ao time real: `ActivePokemon.syncWithOut` não grava clones, `tryUpdatePokemonInTeam` não acha o UUID, `Rewards` não dá EXP a clone (`PlayerBattleActor.awardExperience` só dá ao original), as entidades dos clones somem no fim (`cleanUpEntities`) e não aceitam interação (tag `cobblemon_battle_clone`, checada no `main.ts`). Desvio: o time **salvo** do NPC não recebe o nível ajustado (o Kotlin altera o `npcParty` em memória; aqui o NPC luta com cópias). |
| 6 | Marcas | FEITO | `scripts/pokemon/Marks.ts`: `ALL_MARKS` (as 168 de `data/cobblemon/marks`, conferidas no teste), `MARK_REPLACES` (fitas de ouro substituem as comuns, `exchangeMark`), `giveAllMarks` + `/cobblemon:giveallmarks <espaço> [jogador]`, validação de id em `givemark`/`takemark` (MarkArgumentType). Marca de parceiro (`player_tick_pre/partner_mark.molang`): distância percorrida medida a cada segundo (qualquer deslocamento, sem teleportes >100 blocos/s nem troca de dimensão; o Bedrock não tem as estatísticas `*_one_cm`), checagem a cada 10 s, a cada 10 000 blocos cada Pokémon do time com amizade ≥ 200 tenta a marca (1 %); total e última checagem em dynamic properties do jogador. Mini/Jumbo por categoria de tamanho (`spawnGivenMarks(alpha, sizeCategory)`) e marcas do fóssil (`applyFossilMarks`) prontos, mas **dependem das frentes de spawn e máquinas** (pedidos abaixo). |
| 7 | Cosméticos e tamanho intrínseco/bebê | FEITO (dados, menu, visual por variação); escala visual PARCIAL | `scripts/pokemon/CosmeticItems.ts`: os 29 `cosmetic_items` (conferidos contra o upstream no teste), tags de tronco → ids Bedrock, `hisuian=false`/`roaming=false`. Menu do Pokémon → "Mudar item cosmético": dar o item da mão (se a espécie aceitar; consome 1 fora do criativo), trocar (devolve o anterior) ou tirar, com as mensagens `cobblemon.cosmetic_item.*`. Os aspects do item (COSMETIC_SLOT_ASPECT) trocam o `cobblemon:variant` (as combinações já estão em `generated/scripts/variants.ts`). Resumo mostra o cosmético e a categoria de tamanho. Tamanho: `scripts/pokemon/Scale.ts` (`scaleModifier` sorteado em 0,95–1,05 ao criar, arredondado a 0,1 %; Alfa = 1; `effectiveScale` de filhote até `babyPokemonLevelDuration`; categoria XS–XL). O visual da escala por Pokémon depende do importador (pedido abaixo): os grupos `cobblemon:size_<n>` são por forma/Alfa e `minecraft:scale` não é gravável por script; `applyToCobblemon` já grava `cobblemon:scale_modifier` se a entidade declarar. Tera/Dynamax continuam fora. |
| 8 | Script de interação do Furfrou | FEITO | `scripts/entity/Interactions.ts`: efeito `script` com `run_action_effect('cobblemon:furfrou_trim')` → o corante vestido como cosmético escolhe o corte (`poodle_trim=<corte>`, aspect `<corte>-trim`, 16 cortes, todos com visual no resolver) e o cosmético é consumido (`remove_cosmetic_item`, mesmo sem corante), com a tesoura perdendo 8 de durabilidade (efeito `shrink_item` dos dados). Partículas `poodle_hair_*` não estão no RP: três rajadas `villager_happy` no ritmo da timeline (0 / 0,2 / 0,7 s). |
| 9 | Mobs fugindo de Pokémon (ombro) | FEITO | O Cobblemon faz isso (`EntityCreeperMixin`, `EntitySkeletonMixin` — AbstractSkeleton —, `EntityFoxMixin`, `PhantomSweepAttackGoalMixin`, `behaviour.entityInteract.avoidedByX`, `EntityBehaviour.has*FearedShoulderMount`). Overrides em `behavior_packs/CobblemonBedrock/entities/vanilla_overrides/` copiados **literalmente** de `Mojang/bedrock-samples` tag `v1.26.50.4` (`behavior_pack/entities/*.json`, comentários mantidos) com uma entrada a mais em `minecraft:behavior.avoid_mob_type`: família `pokemon` ou `pokemon_shoulder` com a tag `cobblemon_avoided_by_<mob>` (creeper 6 blocos/1,0/1,2; skeleton, stray, bogged e wither_skeleton 6/1,0/1,2 — o wither skeleton não tinha o componente e ganhou um com prioridade 3; fox 8/1,6/1,4; phantom usa o 16 do componente, aproximação do "desistir do ataque" do Java). `applyToCobblemon` põe/tira as tags pela `entityInteract` da forma ativa (o bloco da forma substitui o da espécie, como `FormPokemonBehaviour`). O Pokémon no ombro monta no jogador, então fugir dele é fugir do jogador. `parched` não entra (não existe no MC 1.21.1 do Cobblemon 1.8.2). **Precisa de conferência no jogo** (overrides de entidades vanilla). |
| extra | `block_click` (pedido do coordenador) | FEITO | `scripts/evolution/variants/BlockClickEvolution.ts` (variante registrada) + `scripts/evolution/BlockClick.ts` (gatilho `playerInteractWithBlock` no `main.ts`, como `PlatformEvents.RIGHT_CLICK_BLOCK` → evoluções do time). Só ids de bloco exatos (tags de bloco do Java não existem). Nenhuma espécie do 1.8.2 usa: o gatilho confere uma vez nos dados e não custa nada. |
| extra | Progresso Cobblemon (pedido de extras-final) | FEITO | `recordEvolution` em `Evolution.forceEvolve` (dono, espécie anterior → nova) e `recordTrade` em `TradeManager` (cada jogador, Pokémon recebido). Shedinja (`shedder`) não existe no port: sem `recordEvolution` dele. |

## Pedidos para outras frentes

### Spawn (`scripts/spawning/Spawner.ts`)

Marcas Mini/Jumbo pela categoria de tamanho (`pokemon_entity_spawn/apply_marks.molang`). Em `applySpawnMarks`:
```ts
for (const mark of spawnGivenMarks(!!action.alpha, data.getSizeCategory())) giveMark(data, mark);
```
(`generateNewWildPokemon` já sorteia `scaleModifier`; sem o segundo argumento só o Alfa ganha Jumbo, como hoje.)

### Máquinas / fósseis (`scripts/machines/**`)

Callback `fossil_revived/apply_marks.molang` ao reviver (jogador presente = sorteia na hora):
```ts
import { applyFossilMarks } from "../pokemon/Marks";
applyFossilMarks(pokemon, /* hasPlayer */ true);
```

### Importador (`tools/importer`)

1. **Escala intrínseca/bebê visível (opcional, item 7).** Em cada entidade de Pokémon gerada:
   - BP: `"cobblemon:scale_modifier": { "type": "float", "range": [0.05, 3.0], "default": 1.0, "client_sync": true }` em
     `description.properties`;
   - RP (client entity): `"scripts": { "scale": "<escala atual> * q.property('cobblemon:scale_modifier')" }` — onde
     `<escala atual>` é o que o client entity já usa (ou `1.0`). Só visual; a hitbox continua no grupo `cobblemon:size_<n>`.
   `PokemonData.applyToCobblemon` já grava a propriedade (filhote × escala intrínseca; Alfa = 1) quando ela existir.
2. **Partículas de evolução/corte (opcional).** Copiar `assets/cobblemon/bedrock/particles/evo_*.particle.json` e
   `poodle_hair_*.particle.json` (+ texturas `textures/particle/**` usadas) para `generated/resource_packs/.../particles`.
   Hoje as sequências usam partículas vanilla (`EVOLUTION_PARTICLES` em `scripts/evolution/EvolutionEffect.ts`,
   `trimParticles` em `scripts/entity/Interactions.ts`); trocar os ids lá quando existirem.

### Documentação (quem integra)

- `docs/COMANDOS.md`: `/cobblemon:giveallmarks <espaço> [jogador]` (admin, cheats) e `/cobblemon:spectatebattle <jogador>` (admin).
- `docs/PARIDADE-MECANICAS.md`:
  - "Treinadores NPC": tirar "`cloneParties`/`setLevel` FALTA"; nota "clones de batalha; o time salvo do NPC não recebe o nível".
  - "Espectador": FALTA → FEITO (tela só de leitura + chat + actionbar; `/spectatebattle`).
  - "Selvagem em duplas automático": FALTA → N/A no Cobblemon 1.8.2 (pve é sempre singles).
  - "Marcas": PARCIAL → FEITO (`giveallmarks`, `mark_partner` por distância medida, replace); nota: Mini/Jumbo e fóssil dependem dos ganchos de spawn/máquinas.
  - "Cosméticos, tamanho intrínseco/bebê, Tera/Dynamax": dividir em "Cosméticos" FEITO, "Tamanho intrínseco/bebê" PARCIAL (dados, categoria e resumo; visual depende do importador) e "Tera/Dynamax" FALTA.
  - "Cura passiva fora de batalha, timer de desmaio, `passiveStatuses`": FALTA → FEITO.
  - "block_click": FALTA → FEITO (nenhuma espécie do 1.8.2 usa; só ids exatos).
  - "Animação de evolução": FALTA → FEITO (partículas vanilla até o importador copiar as `evo_*`).
  - "Interações": tirar "`script` de interação (Furfrou) FALTA".
  - "Mobs vanilla fugindo de Pokémon no ombro": FALTA → FEITO (overrides de creeper/esqueletos/raposa/phantom; conferir no jogo).

## Riscos / conferência no jogo

- Overrides vanilla: se uma versão nova do jogo mudar esses JSON, os overrides congelam o comportamento da 1.26.50;
  refazer a cópia a partir do `bedrock-samples` da versão nova e reaplicar a entrada `cobblemon_avoided_by_*`.
- Cancelar `playerInteractWithEntity` num jogador em batalha evita o `minecraft:interact` do `player.json` (desafio);
  conferir que o formulário "Assistir / Trocar" aparece sozinho.
- A sequência de evolução troca o modelo por `applyToCobblemon` (instant_kill + sendOut): conferir o salto visual e o
  `cobblemon:busy` voltando a falso na entidade nova.
