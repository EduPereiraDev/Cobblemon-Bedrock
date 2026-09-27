# Pendências da frente "batalhas"

Arquivos da frente: `scripts/battle/**` (inclui `ai/`, `BagItems.ts`, `Rewards.ts`, `Animations.ts`, `SimQueries.ts`,
`PokemonCompat.ts`), `scripts/GUI/Battle.ts`, `scripts/showdown.ts`, `scripts/ChallengePlayer.ts`,
`tests/batalhas.test.ts`, `tests/batalhas-harness.ts` (mundo falso para batalhas completas no Node).

## API para as outras frentes (`scripts/battle/index.ts`)

```ts
startWildBattle(player, wild: Entity | Entity[], { format?, fleeDistance?, notify? })   // 2 selvagens → duplas
startPvPBattle(p1, p2, format?)   startDoubleBattle(p1, p2)   startTripleBattle(p1, p2)
startMultiBattle([p1, p3], [p2, p4])
startNPCBattle(player, npcEntity, team: PokemonData[], { format?, skill?: 0..5, ai?, name? })  // StrongBattleAI
startBattle(format, side1: BattleActor[], side2: BattleActor[], options)  // genérico; devolve PokemonBattle | BattleStartError
stopBattle(entity): boolean        // para o comando stopbattle
tryGetBattleFromEntity(entity)     cleanUpStaleBattleData(entity)
new BattleActor(entity, pokemon, { type?: ActorType, ai?: BattleAI, name? })
RandomBattleAI, StrongBattleAI(skill)   BattleFormat.GEN_9_{SINGLES,DOUBLES,TRIPLES,MULTI}, BattleFormat.fromName("doubles")
```

- `ChallengePlayer.ts`: `handleChallenge(challenger, challengee, format = "singles")` e `challengePlayer(a, b, "doubles")`
  (valida `battlePvPMaxDistance`, expira em 60 s com as mensagens `cobblemon.challenge.*`).
- Captura em batalha: `battle.captureActions` (array), `battle.finishCaptureAction(action)`,
  `battle.captureSucceeded(action)` (vitória de quem capturou, `BATTLE_VICTORY(..., wasCaught = true)`), e
  `actor.forceChoose(new ForcePassActionResponse())` — a vez vira `skip` no adaptador e as escolhas ficam retidas até a
  bola parar (checkForInputDispatch do Cobblemon). Pokédex: `markSeen` a cada Pokémon que entra em campo; `markCaught`
  quando um Pokémon evolui na hora ao ganhar EXP.
- Recompensas (`Rewards.ts`): `setMoveLearningPrompt(fn)` troca a pergunta de golpe novo (padrão: form de `GUI/Battle.ts`).

## Pedidos

### 1. Textos do port (dono de `resource_packs/CobblemonBedrock/texts/*.lang` / importador)

As telas e mensagens de batalha usam estas chaves novas (as demais são do Cobblemon ou do vanilla, como `gui.back`):

```
## en_US.lang
cobblemon.port.battle.ui.bag=Bag
cobblemon.port.battle.ui.forced_switch=Choose a Pokémon to send out
cobblemon.port.battle.ui.no_items=You have no items that can be used in battle.
cobblemon.port.battle.ui.use_on=Use %1$s on which Pokémon?
cobblemon.port.battle.ui.restore_pp=Restore the PP of which move?
cobblemon.port.battle.ui.throw_ball=Poké Balls (throw one at the Pokémon)
cobblemon.port.battle.ui.effect.super=Super effective
cobblemon.port.battle.ui.effect.weak=Not very effective
cobblemon.port.battle.ui.effect.none=No effect
cobblemon.port.battle.ui.ally=Ally
cobblemon.port.battle.ui.foe=Foe
cobblemon.port.battle.ui.trapped=%1$s can't be switched out!
cobblemon.port.battle.ui.trapped_generic=Your Pokémon is trapped and can't be switched out!
cobblemon.port.battle.ui.unavailable=That choice isn't available right now.
cobblemon.port.battle.reopen_hint=Interact with your opponent to reopen the battle menu.
cobblemon.port.battle.blacked_out=%1$s has no more Pokémon that can fight!
cobblemon.port.battle.ohko=It's a one-hit KO!
cobblemon.port.battle.move_learn.body=%1$s wants to learn %2$s, but it already knows four moves. Which move should be forgotten?
cobblemon.port.battle.move_learn.skip=Don't learn %1$s
cobblemon.port.battle.move_learn.replaced=%1$s forgot %2$s and learned %3$s!
cobblemon.port.battle.move_learn.stored=%1$s did not learn %2$s. It can still be swapped in from the moves screen.

## pt_BR.lang
cobblemon.port.battle.ui.bag=Mochila
cobblemon.port.battle.ui.forced_switch=Escolha o Pokémon que vai entrar
cobblemon.port.battle.ui.no_items=Você não tem itens que possam ser usados em batalha.
cobblemon.port.battle.ui.use_on=Usar %1$s em qual Pokémon?
cobblemon.port.battle.ui.restore_pp=Recuperar o PP de qual golpe?
cobblemon.port.battle.ui.throw_ball=Poké Bolas (arremesse uma no Pokémon)
cobblemon.port.battle.ui.effect.super=Supereficaz
cobblemon.port.battle.ui.effect.weak=Pouco eficaz
cobblemon.port.battle.ui.effect.none=Sem efeito
cobblemon.port.battle.ui.ally=Aliado
cobblemon.port.battle.ui.foe=Oponente
cobblemon.port.battle.ui.trapped=%1$s não pode ser trocado!
cobblemon.port.battle.ui.trapped_generic=Seu Pokémon está preso e não pode ser trocado!
cobblemon.port.battle.ui.unavailable=Essa escolha não está disponível agora.
cobblemon.port.battle.reopen_hint=Interaja com o oponente para reabrir o menu da batalha.
cobblemon.port.battle.blacked_out=%1$s não tem mais Pokémon em condições de lutar!
cobblemon.port.battle.ohko=Nocaute em um golpe!
cobblemon.port.battle.move_learn.body=%1$s quer aprender %2$s, mas já sabe quatro golpes. Qual golpe esquecer?
cobblemon.port.battle.move_learn.skip=Não aprender %1$s
cobblemon.port.battle.move_learn.replaced=%1$s esqueceu %2$s e aprendeu %3$s!
cobblemon.port.battle.move_learn.stored=%1$s não aprendeu %2$s. Dá para trocar depois na tela de golpes.
```

### 2. Interface / comandos (`scripts/commands.ts`, menu de interação)

1. `cobblemon:stopbattle` pode usar `stopBattle(target)` (hoje chama `battle.stop()`, que continua valendo).
2. Desafio com formato: no menu de interação jogador→jogador, oferecer Singles/Doubles/Triples e chamar
   `challengePlayer(challenger, target, "doubles")` (default de `handleChallenge` segue singles). Multi:
   `startMultiBattle([a, b], [c, d])` quando houver UI de equipe.
3. `ScriptEvents.ts` (`handlePokemonInteract`) já reabre o menu com `actor.promptPlayerForRequest()`; nada a mudar.
   Opcional: selvagem em duplas quando houver dois selvagens a até 12 blocos → `startWildBattle(player, [a, b])`.

### 3. Conteúdo / resource pack

1. Música de batalha: `battle.pvw.default`/`pvp`/`pvn` estão com `sounds: []` no `sound_definitions.json`; por isso a
   batalha não liga música (`BattleActor.battleTheme` fica sem uso). Quando houver faixas, a frente liga.
2. `ui/battle.json` (menu principal com título `Battle:`) tem altura fixa de 150 px: em triplas o corpo com 6 Pokémon
   pode passar do painel. Os submenus (golpes, alvos, troca, mochila) usam o form padrão, com rolagem.

### 4. Importador (`tools/importer/**`)

1. `POSER_ANIMATIONS` cobre `cry/faint/recoil/sleep` para muitas espécies, mas poucas têm `physical/special/status`;
   a animação de golpe cai no `cry` quando falta. Exportar também as poses de ataque do poser (quando existirem) melhora
   as animações sem mudar código.

## Status da integração

- 1. Textos `cobblemon.port.battle.*` (en_US/pt_BR): ✅ feito (integração).
- 2.1 `stopbattle` com `stopBattle(target)`: ✅ feito (integração) — `scripts/commands.ts`.
- 2.2 Desafio com formato: ✅ feito (integração) — interação jogador→jogador abre o menu Singles/Doubles/Triples + Troca (`scripts/trade/PlayerInteraction.ts`, ligado em `ScriptEvents.ts`; batalha em andamento ou desafio pendente resolvem direto) e `/cobblemon:pokebattle <jogador> [formato]`. Multi (`startMultiBattle`): ⏭️ não feito: não há UI de equipe (nem `abandonmultiteam`).
- 2.3 Reabrir menu: ✅ feito (integração) (nada a mudar). Opcional selvagem em duplas com dois selvagens a 12 blocos: ⏭️ não feito: no Cobblemon 1.8.2 o selvagem em duplas só sai por comando/API; mantido singles.
- 3.1 Música de batalha: ⏭️ não feito: o `sounds.json` do Cobblemon 1.8.2 tem `battle.pvw/pvp/pvn.default` com `sounds: []` (não há faixas para importar).
- 3.2 Altura fixa de `ui/battle.json` em triplas: ⏭️ não feito: layout JSON UI precisa de teste no jogo (BDS/cliente), fora do escopo desta integração sem build.
- 4.1 Poses de ataque do poser: ✅ feito (integração) — o importador já exporta `physical/special/status` quando o poser tem (107 espécies com `physical`, de 114 posers do Cobblemon que as citam; o resto não existe no upstream).
