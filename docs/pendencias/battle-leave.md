# Frente "battle-leave" (jogador sai do servidor no meio de uma batalha PvP)

Bug de origem: `docs/pendencias/multi.md` → "Observado (outras frentes)": ao sair no meio de uma batalha PvP, o log tinha
`[Scripting] Battle menu error: InvalidEntityError ... sendMessage` (`scripts/battle/BattleActor.ts`) e
`[Scripting] HUD de batalha: Error: Failed to get property 'name'` (`scripts/ui/BattleHud.ts`).

## Causa raiz

A saída do jogador só era percebida pela checagem periódica `PokemonBattle.checkParticipants` (a cada 10 ticks), que
chama `stop()`. Não havia assinatura de `playerLeave` nas batalhas. Nessa janela (até cerca de 0,5 s):
- a tela de escolha aberta de quem saiu fecha sozinha (sem resposta) → `promptPlayerForRequest` cai em
  `sendReopenHint` → `Player.sendMessage` numa entidade inválida → `Battle menu error: InvalidEntityError`;
- o HUD (a cada 2 ticks) monta a visão dos outros jogadores e lê `actor.actor.name` do jogador que saiu →
  `Failed to get property 'name'` (repetido a cada atualização até a batalha acabar).

## Correção (menor mudança segura)

- `scripts/battle/index.ts`: `stopBattlesOfLeavingPlayer(playerId)` + `world.afterEvents.playerLeave` (API estável).
  Encerra na hora a batalha de que o jogador participa com `stop()`, como o Cobblemon faz no logout
  (`SERVER_PLAYER_LOGOUT` → `getBattleByParticipatingPlayer(player)?.stop()`: fim sem vencedor, `>forcetie`, sem
  recompensa e sem mensagem própria de desconexão, que não existe no lang do Cobblemon). Quem ficou passa pelo
  `end()` normal: sincroniza o time, tira `in_battle`, fecha telas, recolhe clones, limpa plataformas/efeitos
  (`cleanupBattleVisuals`), libera espectadores. A checagem periódica continua como rede de segurança.
- `scripts/battle/BattleActor.ts`: `entityId` e `playerName` guardados no construtor; `getName()` usa o nome guardado
  se a entidade estiver inválida; `promptPlayerForRequest` não abre tela para jogador inválido, ignora a resposta de
  tela de quem saiu e não registra como erro a falha de tela de um jogador que saiu; `sendReopenHint` só manda para
  jogador válido.
- `scripts/ui/BattleHud.ts`: `actorName` usa `BattleActor.playerName` quando o jogador está inválido.
- Multi 2×2: a batalha para os 3 que ficaram pelo mesmo caminho; a equipe é tratada pelo `playerLeave` que já existia
  em `scripts/battle/Teams.ts` (`teamManager.onPlayerLeave`: `team.left.other` e, com 1 membro, `team.disband`).

## Status

| Item | Status | Prova |
|---|---|---|
| Sair no meio de PvP 1×1 encerra a batalha sem erros | FEITO | Node (`tests/battle-leave.test.ts`) e BDS (abaixo) |
| Sair no meio de Multi 2×2 encerra a batalha para os outros 3 e desfaz a equipe | FEITO | Node e BDS (abaixo) |
| Menu da batalha (`Battle menu error`) sem tocar a entidade inválida | FEITO | idem |
| HUD de batalha (`Failed to get property 'name'`) sem tocar a entidade inválida | FEITO | idem |

## Como foi testado

- `npx tsc -p tsconfig.json`: 0 erros.
- `npm test`: todos passam; `ok: battle-leave (...)`. O `tests/battle-leave.test.ts` (sem mudar os mocks: o teste faz o
  `FakePlayer` lançar em `name`/`sendMessage` depois de inválido, como o Bedrock) cobre: 1×1 com o menu fechando antes
  do evento de saída (ordem do log do bug) e depois dele; nome capturado no HUD (`battleView`) e em `getName`;
  limpeza (`ended`, `endReason = "stopped"`, fora do `battleMap`, `in_battle` limpo, time intacto); jogador de fora
  saindo não encerra nada; checagem periódica ainda encerra sem o evento; Multi 2×2 com equipe desfeita.
  Sem os guards do menu, o teste falha com `Battle menu error: Error: InvalidEntityError: sendMessage`; sem o do
  HUD, com `Failed to get property 'name'`.
- BDS próprio (`dist-leave`, `cobblemon-bds-leave`, porta 19144, raknet/offline) com um cenário E2E avulso (bots de
  protocolo, fora de `tests/e2e/`): 1×1 por `/pokebattle`, os dois com o menu de batalha aberto, A desconecta;
  depois Multi 2×2 pelo menu de interação, D desconecta.
  - Com a correção: `✓ ok` — 1×1: `Battle ... ended (stopped)` e 0 ERROR/WARN; B `cobblemon.port.command.no_battle`.
    Multi: `Battle ... ended (stopped)`, 0 ERROR/WARN; E recebe `team.left.other` + `team.disband`; B, C e E sem batalha.
  - Mesmo cenário num build sem a correção (reprodução): `✗` com `ERROR [Scripting] Battle menu error:
    InvalidEntityError: Failed to call function 'sendMessage' due to Entity being invalid` e 4×
    `WARN [Scripting] HUD de batalha: Error: Failed to get property 'name'.` nos ~350 ms antes do `ended (stopped)`.
  - Outras linhas ERROR no log do container, de outras frentes/infra: `[Json] cobblemon:npc ... minecraft:leashable |
    hard_distance | child 'hard_distance' not valid here` (entidade NPC), o banner `TRANSPORT TYPE ERROR` do raknet e
    `No targets matched selector` do `kill @e` do runner.
- Container removido no fim (`docker rm -f cobblemon-bds-leave`).

## Observado (outras frentes)

- Durante a sessão, com a frente dados-ia editando `scripts/molang/*` e `scripts/evolution/requirements/*` (08:47–08:54),
  o `npm test` falhou de forma transitória: primeiro quase todos os arquivos com `Class extends value undefined`
  (`TradeEvolution extends ContextEvolution`), depois só `entidades.test.ts` com
  `ChanceRequirement.getFromSerialized` em `undefined` (ordem de import). A mesma falha acontece compilando o teste com
  os 3 arquivos desta frente na versão pré-correção (troca por plugin do esbuild), então não vem desta correção. A
  rodada completa anterior, já com a correção, passou 31/31.

## Diferenças conscientes

- Nenhuma mensagem de chat nova para quem ficou (o Cobblemon também não tem): a batalha fecha como num `stop()`.
