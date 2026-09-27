# Frente "multi" (equipes Multi e PvP de nível fixo)

Arquivos novos da frente: `scripts/battle/TeamManager.ts` (lógica pura), `scripts/battle/Teams.ts` (instância do
jogo + `playerLeave`), `tests/multi.test.ts`, `tests/e2e/scenarios/09-multi.e2e.mjs`.

Edições pontuais em arquivos de outras frentes (pedidas pelo orquestrador nesta tarefa):
- `scripts/battle/index.ts` (batalhas): `PvPBattleOptions { team?: BattleTeamOptions }` em `startPvPBattle` e
  `startMultiBattle` (adjustLevel via `createPlayerActor(..., teamOptions)`; com `setLevel` > 0 os Pokémon reais em
  campo são recolhidos antes do envio das cópias, como no `startNPCBattle`). Assinaturas antigas continuam valendo.
- `scripts/ChallengePlayer.ts` (batalhas): `level` no desafio pendente; `challengePlayer(a, b, formato, nível = 0)`
  e `handleChallenge(a, b, formato, nível = 0)`; ao aceitar, `startPvPBattle(..., { team: { setLevel } })`.
- `scripts/trade/PlayerInteraction.ts` (social): botões de equipe e tela da regra de nível (ver abaixo).
- `scripts/commands.ts`: `/pokebattle` ganhou `[nível]` e o formato `multi`; `registerMultiCommands`
  (`abandonmultiteam` + alias `abandonmultibattleteam`).
- `.lang` (en_US/pt_BR): seção `## multi` com `cobblemon.port.multi.not_in_team` e `cobblemon.port.multi.team_duplicate`.
  O resto usa as chaves do Cobblemon (`cobblemon.team.*`, `cobblemon.challenge.multi.*`, `cobblemon.challenge.rule.*`,
  `cobblemon.ui.interact.team_request/team_leave`, `cobblemon.battle.types.multi`).
- `docs/COMANDOS.md`: `abandonmultiteam`, `technicalmachine` (já existia; saiu de "Ainda não portados"), `/pokebattle
  [formato] [nível]` e a seção "Equipes e Batalha Multi".

## Status (para o orquestrador consolidar em `docs/PARIDADE-MECANICAS.md`)

| Item | Status | Prova |
|---|---|---|
| Equipes Multi (`TeamManager`: pedido de equipe pela roda de interação, `abandonmultiteam`) | FEITO | `TeamManager.ts` porta `TeamManager.kt` + `RequestManager.kt` + a parte multi do `ChallengeManager.kt`: convite jogador→jogador (60 s, cancela convites concorrentes, erros `existing_team`/`max_team_size`/sem Pokémon/longe/ocupado), equipe de 2, `join.other`, `left.self/other`, `disband` (cai convite e desafios da equipe), saída do servidor; desafio equipe→equipe (20 s, avisa os 4, qualquer membro aceita, valida tamanho, Pokémon, dimensão, raio 15 do centro) e batalha 2×2 (`startMultiBattle`, equipe desafiada = lado 1, como o `pvp2v2`). Menu de interação: os dois sem equipe → "Formar grupo" (+ "Recusar (Formar grupo)" com convite pendente); equipes diferentes → "Batalha Multi"; mesma equipe → "Abandonar grupo" (como `RequestInteractionsHandler`). `/cobblemon:abandonmultiteam` e alias. `tests/multi.test.ts` e E2E `09-multi` (4 bots, abaixo) |
| PvP de nível fixo (5/50/100) | FEITO | Tela da regra depois do formato no menu de interação (Luta Livre / Nível 50 / 100 / 5 para todos, ordem do `BattleConfigureGUI`) para simples/dupla/tripla/Multi; `/cobblemon:pokebattle <jogador> [formato] [nível]`. Cópias no nível e curadas (`BattleBuilder.pvp1v1/pvp2v2` com `adjustLevel`); o time real não muda. Quem é desafiado vê a regra no chat (`cobblemon.challenge.rule.level`). Testado em Node (1×1 nível 5, Multi nível 50, livre = time real) e no E2E (Multi nível 50, `/pokebattle` nível 100) |
| Linha "Singles / Doubles / Triples / Multi" (Multi só pela API) | FEITO | Multi agora sai do jogo pelo menu e por `/pokebattle ... multi` |
| Comando `abandonmultiteam` (§7) | FEITO | Registrado como custom command (`registerMultiCommands`); no BDS: `cobblemon:abandonmultiteam` pelo console responde "Only players..." (registrado); no E2E responde `team.left.self`/`team.disband` e, sem equipe, `port.multi.not_in_team` |

Diferenças conscientes:
- A "roda" vira o `ActionFormData` de interação; o "aceitar" é o mesmo botão (Formar grupo / Batalha Multi) ou
  `/pokebattle`, como o port já fazia para desafios 1×1 e trocas. Não há a tela de pedido pendente do Java.
- Sem os ícones de membros da equipe no HUD (`ClientPlayerTeamData`/`ClientPlayerIcon`, cliente Java).
- A troca de posição dos atores pela geometria do grupo (`BattleBuilder.pvp2v2`, só visual) não foi portada.
- Convite duplicado: o Java usa `team.error.duplicate` (sem texto no lang); aqui `cobblemon.port.multi.team_duplicate`.
  Convite com remetente sem Pokémon: o Java usa `team.error.no_pokemon` (sem texto no lang); aqui as chaves
  `challenge.error.insufficient_pokemon.self/other`.

## Como foi testado

- `npx tsc -p tsconfig.json`: 0 erros.
- `npm test`: todos passam (`multi: ok`). O `tests/multi.test.ts` cobre: regras de nível e `parseChallengeFormat`;
  convite (envio, duplicado, aceite, convites concorrentes cancelados, expiração em 60 s, pedido cruzado, recusa,
  longe/ocupado/sem Pokémon); saída/dissolução (com desafio pendente cancelado) e `onPlayerLeave`; desafio Multi
  (avisos aos 4, duplicado, aceite por membro que não era o alvo, aceite "desafiando de volta", proximidade,
  dimensão, Pokémon, ocupado, expiração em 20 s); e, com o harness de batalha (`tests/batalhas-harness.ts`), o fluxo
  real pelo menu: 4 jogadores formam 2 equipes, Multi nível 50 até o fim (todos os Pokémon na batalha no 50,
  clones; níveis reais iguais depois), abandonar pelo menu e pelo comando, 1×1 nível 5 pelo menu e 1×1 livre com
  o time real.
- `npm run validate`: OK.
- BDS próprio (`dist-multi`, `cobblemon-bds-multi`, porta 19141, raknet/offline): scripts carregados sem ERROR/WARN
  (só o aviso conhecido `TRANSPORT TYPE ERROR` do raknet). Pelo console: `cobblemon:abandonmultiteam` e
  `cobblemon:abandonmultibattleteam` → "Only players can use this command" (registrados);
  `cobblemon:pokebattle @a multi 42` → "Invalid level: 42 (5, 50, 100; 0 = any)".
- E2E com bots (`COBBLEMON_BDS=multi COBBLEMON_BDS_PORT=19141 COBBLEMON_DIST=dist-multi ... node tools/e2e/run.mjs
  --only multi`): `✓ ok equipes Multi: formar grupo pelo menu, desafio 2×2 nível 50, batalha até o fim, abandonar,
  /pokebattle nível 100 (89.1 s)`, sem ERROR/WARN no log. Passos vistos: menus com `team_request` →
  `decline (team_request)` no convidado; regras `[anything_goes | level(50) | level(100) | level(5)]`; forms de
  batalha nos 4 bots com `Lv.50` (reais 70 e 10); `{cobblemon.battle.win}(MultiB…MultiA…)`; `team.left.self`,
  `team.disband`, `port.multi.not_in_team`; `/pokebattle` 1×1 com `Lv.100`.
- Container removido no fim (`docker rm -f cobblemon-bds-multi`).

## Observado (outras frentes)

- Numa execução E2E que falhou por um regex meu, os bots saíram no meio de uma batalha 1×1 e o log teve
  `[Scripting] Battle menu error: InvalidEntityError ... sendMessage` (`scripts/battle/BattleActor.ts:428`) e
  `[Scripting] HUD de batalha: Error: Failed to get property 'name'` (`scripts/ui/BattleHud.ts:118`). Jogador que sai
  no meio de uma batalha PvP ainda gera ERROR/WARN (frentes batalhas/ui-base). Não é do código de equipes.
- Durante a sessão, `animacao.test.ts` falhou uma vez com "dubwool desatualizado: rode npm run import:kotlin-posers"
  (`tools/importer/data/kotlin-posers/dubwool.json` alterado às 08:23 por outra frente); na rodada final passou.
