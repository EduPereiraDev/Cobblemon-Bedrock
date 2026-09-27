# Pendências da frente "ia-npc" (StrongBattleAI e completude de NPCs)

Arquivos da frente: `scripts/battle/ai/**`, `scripts/npc/**`, `scripts/trade/**`, `tools/importer/npcs.ts`,
`tests/ia-npc.test.ts`. Edição mínima em arquivo compartilhado: `scripts/battle/Rewards.ts` (pedido A da frente
jogabilidade, autorizado pelo orquestrador). Textos novos em `## ia-npc` no fim de `en_US.lang`/`pt_BR.lang`.

Verificação (2026-09-26):
- `npx tsc -p tsconfig.json`: 0 erros no projeto inteiro.
- `npm test`: todos passam; `tests/ia-npc.test.ts` = 20 cenários de IA + 11 de NPC (inclui 100 batalhas IA × IA
  inteiras no simulador, em simples/duplas/triplas, sem nenhuma escolha inválida).
- BDS `cobblemon-bds-ia-npc` (porta 19147, `dist-ia-npc`): última sessão com **zero ERROR/WARN** (fora o aviso de
  transporte do próprio BDS). Batalhas NPC × selvagem pelo console, sem jogador:
  `scriptevent cobblemon:ianpc_battle standard rattata 20` → `ended (win)`;
  `scriptevent cobblemon:ianpc_battle battler_test pidgey 12` → `ended (win)`, 3 turnos;
  `scriptevent cobblemon:ianpc_battle standard pikachu 50` → `ended (win)`.
  `scriptevent cobblemon:ianpc_behaviours wanders looks_at_players stationary uses_healing_machine chats battler panics`
  → grupos `wanders, looks_at_players, panics` ligados e tarefas `home, heal, look_at_speaker, look_at_battling`.
  Container removido no fim (`docker rm -f cobblemon-bds-ia-npc`).
- Duas subidas do BDS tiveram "Watchdog hang" de ~10 s **na carga** (com outros 2 BDS disputando CPU/memória da VM);
  as subidas seguintes carregaram em 370–650 ms. Não reproduz com a VM livre.

## Status por item

| # | Item | Status | Notas / prova |
|---|---|---|---|
| 1 | StrongBattleAI completa (986 linhas) | FEITO | `scripts/battle/ai/StrongBattleAI.ts` (+ `ActiveTracker.ts`, `AIUtility.ts`, `SimTargets.ts`). Porta inteira: `choose` na ordem do Kotlin (golpe obrigatório, recarga de Protect, teste de skill, troca, HP < 30 %, Sleep Talk, Fake Out, Explosion, recuperação, Tailwind/Trick Room/telas, perigos, anti-boost, Court Change, Strength Sap, Belly Drum, clima, "setup", status, Protect, golpe mais forte, Healing Wish, troca), `estimateMatchup`, `shouldSwitchOut` (Truant/Slow Start, golpes presos, boosts), `calculateDamage` (fórmula com nível inteiro, STAB/Adaptability, -ate/Normalize/Hidden Power, habilidades que anulam tipo, queimadura, acertos esperados), `considerSwitching` (pivôs, Chilly Reception), `considerAntiBoost`, `considerInflictingStatus` (imunidades por tipo/habilidade, Comatose/Purifying Salt), `findAndUseMostDamagingMove` (Fake Out, Synchronoise, Soak, pivô). Rastreador fiel (aliado sabe tudo; oponente só o visto, 1ª habilidade da forma, HP 0 % se nunca visto; banco guarda HP/boosts velhos; `firstTurn`). Alvos em duplas/triplas pelo `targetList`/`getMultiTargetList` do Cobblemon, validados no simulador. |
| 1a | Esquisitices mantidas (paridade de decisão) | FEITO (documentado) | Troca voluntária quase nunca (só depois de Fake Out ou do golpe aleatório final zerarem `firstTurn`); clima compara com "sunny"/"raining" (nunca bate: sem efeito); a queimadura que reduz é a do *alvo*; Whirlwind vale 0; golpe de status "vale" 2 de dano, então `considerInflictingStatus` quase só passa com ×0,25 (ex.: Toxic em Pedra/Terra); `slearsmog`/`sleeppoweder`/`lightingrod`/`posion` como no original; +1 de boost = ×2; 2–5 acertos = 2. Itens: só Sitrus Berry (Belly Drum); terreno é rastreado mas o Cobblemon não usa. Única diferença proposital: boosts/status/perigos lidos exatos do simulador em vez da contagem de mensagens do protocolo. |
| 1b | Skill 0–5 | FEITO | `checkSkillLevel` (`nextInt(100) < skill×20`, 5 sem sortear) e `checkSwitchOutSkill` (0/0/0/20/60/100 %), na mesma ordem de sorteios; RNG injetável para teste. |
| 1c | RandomBattleAI (selvagens) | FEITO | `canBeUsed`/`mustBeUsed` do `InBattleMove`, Struggle quando nada serve, alvo aleatório preferindo inimigos, troca aleatória, posição válida garantida em duplas/triplas. |
| 1d | Testes de decisão | FEITO | `tests/ia-npc.test.ts`: dano com números do original, Volt Absorb, Pixilate, Adaptability, queimadura do alvo, super efetivo, status ignorado, Toxic ×0,25, recuperação, Sleep Talk, Fake Out só no 1º turno, Protect a cada 3, Rain Dance, perigos (oponentes não vistos contam 0), Rapid Spin, Tailwind, Trick Room, Reflect, Belly Drum, U-turn perdendo valor, Soak = 200, troca obrigatória pelo melhor confronto, troca voluntária/preso, skill 0/3/5, duplas (alvo de maior dano, Earthquake × Rock Slide), RandomBattleAI, 100 batalhas inteiras. |
| 2 | Behaviours de NPC (andar, olhar, lutar, curar...) | FEITO (aproximação) | `scripts/npc/Behaviours.ts` lê `data/cobblemon/behaviours` (sem os de Pokémon; `npc/auto` automáticos), `apply_behaviours` da classe/preset (`ai`/`behaviours`/`behaviors`) ou a lista editada do NPC. Tarefas com objetivo vanilla viram grupos de componentes (`cobblemon:npc_b_<g>_on/_off`): wanders, looks_at_players, looks_around, panics, fights_melee (dano 5), retaliates, attack_hostile_mobs, floats. Tarefas de script (`NPCTasks.ts`, 1×/s): stationary/home_walk_task (volta para casa **teleportando**: sem "andar até" no script estável), uses_healing_machine (liga `move_to_block` até a máquina e usa a máquina livre a ≤ 3×2 blocos; cura o time estático em 37 ticks), chats/look_at_speaker, battler/look_at_battling_pokemon e exit_battle_when_hurt. Variáveis dos behaviours entram na config; configurações `script`, `onAdd`, `onRemove` e `undo` rodam (name_tag_display, dialogue_selection, chatter_npc, party_configuration, npc_scale_configuration, player_textured, resource_identifier). Editor: um toggle por behaviour visível. **Mudança visível:** o NPC `standard` fica parado e sem olhar para ninguém, como no 1.8.2 (antes o port sempre olhava para jogadores). |
| 2a | Máquina de cura pelo NPC | PARCIAL | Usa a máquina, mas **sem gastar carga**: a carga do bloco é interna de `custom_components/HealingMachineComponent.ts` (pedido 2). |
| 2b | avoids_water | PARCIAL | A navegação do NPC já evita água ao andar; sem tarefa própria de "sair da água". |
| 3 | Caixa de colisão configurável | FEITO (quantizada) | `NPCClass.hitbox` e `set_hitbox`/`set_hitbox_scale` → grupo `cobblemon:npc_hitbox_w<W>_h<H>` (0,2–3,0 × 0,2–4,0 em passos de 0,2; 300 grupos gerados); escala do modelo = `renderScale × hitboxScale` pela propriedade `cobblemon:npc_render_scale` (`scripts.scale` da client entity). Altura dos olhos não existe no Bedrock. |
| 4 | Time "script" | FEITO | `ScriptPartyProvider`: script MoLang com `q.npc`, `q.level`, `q.players`, `q.player`, `q.party` (`add_by_properties`, `count`, `average_level`, `highest_level`, `lowest_level`); estático por padrão; script inexistente → Magikarp. |
| 5 | Time "composed_pool" | FEITO | `ComposedPoolPartyProvider` + `PartyPool.tryChoosingEntry` + `PartyComposition.compose`: rótulos por posição, `any`, `required`/`excluded`, `maxSelectableTimes`, `npcAspects`, `npcLevels`/`levelVariation` (faixas ou `{min,max}` MoLang), pesos MoLang, `scrambleOrder`, `useFixedRandom`. O 1.8.2 não traz pools/composições (importador lê `party_pools`/`party_compositions` se existirem; `registerPartyPool`/`registerPartyComposition` para datapacks). `movesetBuilders` das entradas: não aplicados (golpes pelo nível). |
| 6 | `start_battle` (nível, clone, cura, regras) | FEITO (verificado) | `trainerTeamOptions`: `cloneParties = setLevel ≠ −1 ‖ arg3`, `setLevel > 0` ajusta nível e cura, `healFirst`, regras. Skill agora é a do NPC (editor) ou da classe. Desvio: retorna 1/0, não o struct da batalha. |
| 7 | Nome do NPC localizado | FEITO | Chat/batalha/diálogo usam `{translate: "npc.*"}` (cada jogador vê no próprio idioma); o nameTag (texto fixo no Bedrock) usa o idioma do mundo: `scriptevent cobblemon:npc_name_language pt_BR` ou o editor. Nome digitado no editor vira literal. |
| 7a | Retrato do NPC no diálogo | NÃO FEITO | Forms não desenham modelos; o caminho é o spike P3-3 (`/dialogue` vanilla com `minecraft:npc`) da frente de telas. Nome do falante já é traduzível. |
| 8 | NPC com skin de jogador | FEITO (aproximação) | `set_player_texture`/behaviour `player_textured`/editor: skin escolhida do conjunto (Steve, Alex — texturas vanilla, modelos `steve.geo`/`alex.geo` do Cobblemon — e as de treinador) por hash do nome (mesmo nome, mesma skin), com `model-default`/`model-slim`. Os índices antigos de `cobblemon:npc_skin` não mudaram (Steve/Alex entram no fim). |
| 9 | Chatter de NPC (1.8.0) | FEITO | Behaviour `npc/chatter_npc` → interação `chatter-npc-interaction` (mensagem + animação opcional). |
| 10 | Gibber (sons de fala nos diálogos) | FEITO | `DialogueGibber` por página/falante (Sacchi): um som a cada `step` caracteres, a cada `interval` s, tom/volume aleatórios (`cobblemon.entity.npc.gibber.*`). O texto do form aparece inteiro de uma vez. |
| 11 | `/npcdelete <alvo>` pelo console | PARCIAL | `npcDeleteEntitiesCommand(targets)` pronto em `scripts/npc/commands.ts`; falta o parâmetro no registro (pedido 1). |
| 12 | Som da troca | FEITO | `TradeUI` toca `cobblemon.gui.trade` (TradeGUI) em vez de `random.levelup`. |
| 13 | Pedido A da jogabilidade (drops do selvagem) | FEITO | `Rewards.dropWildLoot`: só com a gamerule `doPokemonLoot`; entrega por `pokemon/Drops.deliverItem` (`defaultDropItemMethod`; quem derrotou = jogador do outro lado); `dropAfterDeathAnimation` → 30 ticks depois, no local onde a entidade estava; aspect `drops_reroll` (isca) sorteia a tabela duas vezes, como `doDeathDrops`. Teste em `ia-npc.test.ts`. |
| 14 | NPC com modelo de Pokémon (`resourceIdentifier` = espécie) | NÃO FEITO | Exigiria listar todas as geometrias/texturas de Pokémon na client entity do NPC e as animações não se aplicariam. Impacto Baixo (audit §7.3). |
| 15 | NPC escondido por jogador (`shouldHideFrom`, dado `hide`) | NÃO POSSÍVEL | O Bedrock não esconde uma entidade só para um jogador. |
| 16 | `isMovable`/`isLeashable`/`allowProjectileHits` | PARCIAL | Lidos da classe; a entidade continua não empurrável, sem guia e atingível por projéteis (sem grupo por flag). `set_movable`/`set_leashable`/`set_allow_projectile_hits` aceitos sem efeito. |
| 17 | Debug no servidor | FEITO | `scriptevent cobblemon:ianpc_battle <classe> <espécie> [nível] [x y z]` e `scriptevent cobblemon:ianpc_behaviours <ids...>`. |

## Pedidos para outras frentes

### 1. `scripts/commands.ts` (orquestrador): `/npcdelete <alvo>` pelo console

No registro de `cobblemon:npcdelete`, aceitar um seletor opcional (NPCDeleteCommand com `EntityArgument`):

```ts
import { npcDeleteEntitiesCommand } from "./npc/commands";
register(event, {
  name: "cobblemon:npcdelete", description: "...",
  permissionLevel: ADMIN, cheatsRequired: true,
  optionalParameters: [{ name: "target", type: P.EntitySelector }],
}, (origin, targets?: Entity[]) => targets?.length
  ? later(origin, (_, reply) => { const out = npcDeleteEntitiesCommand(targets); reply(out.ok ? out.message : message.error(out.message)); })
  : laterAsPlayer(origin, (player, reply) => { const out = npcDeleteCommand(player); reply(out.ok ? out.message : message.error(out.message)); }));
```

### 2. Dono de `scripts/custom_components/HealingMachineComponent.ts`: carga para NPC

Exportar `tryConsumeHealerCharge(block: Block, team: PokemonData[]): boolean` (mesma regra do `onPlayerInteract`:
`healingRemainderPercent(team)`, `infiniteHealerCharge`, `writeCharge`). Com isso `scripts/npc/NPCTasks.ts` (`useHealer`)
passa a gastar carga como `healer.canHeal(party)`/`activate` do Cobblemon.

### 3. Observado (batalhas/animação): selvagem desmaiado some antes do `|win|`

No meu BDS (build de 05:38 UTC), NPC × selvagem com vários turnos terminou `stopped` embora o simulador tenha mandado
`|win|`: o `BattleInterpreter` mata a entidade selvagem no desmaio e o `checkParticipants` encerra a batalha antes do
dispatch da vitória (log: `NPC ok, selvagem sumiu com 0 HP; |faint|p2a ... |win|...`). O mesmo sintoma derrubou
`tests/batalhas.test.ts` por um tempo ("stopped" !== "win"); na última rodada o `npm test` passou.
