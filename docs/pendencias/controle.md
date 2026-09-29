# Frente controle

Item de controle **Poké Ball do time** (`cobblemon:party_control`): as teclas do Cobblemon Java (**R** =
`PartySendBinding`, **setas** do overlay do time, **M** = menu do time) num item do Bedrock, que não deixa add-on criar
teclas. Só APIs estáveis de `@minecraft/server` 2.10.0 (cada uma conferida em `node_modules/@minecraft/server/index.d.ts`).

## Status

| Item | Status | Prova |
|---|---|---|
| Item que nunca sai do inventário: sem drop, contêiner, receita (`ItemStack.lockMode = ItemLockMode.inventory`), mantido na morte (`keepOnDeath = true`) | **FEITO** | `scripts/controle/index.ts` `createControlStack`; E2E "Q: o item não saiu do inventário" |
| Rede de segurança: exatamente 1 por jogador (repõe, remove cópias, regrava a trava) a cada 20 ticks; item no chão com o tipo some e é devolvido na hora; contêiner aberto (baú, barril, vitrine, estante de discos, baú dourado, carrinho) perde as cópias | **FEITO** | `tests/controle.test.ts` ("laço", "cópias fora do jogador"); E2E "/clear: o item voltou", "/give de outra cópia: a extra foi removida", Q (entidade de item criada e removida no mesmo lote, 1 ms) |
| Moldura, vaso decorado, estante entalhada, atril, jukebox, vaso de flor, composteira, vitrine do Cobblemon, suporte de armadura e allay não recebem o item | **FEITO** (clique cancelado com o item na mão) | teste ("usar num bloco", "usar no ar cede a vez...": suporte de armadura) |
| Item nunca vira item segurado de Pokémon (agachar + usar, menu "Item segurado") | **FEITO** (`FORBIDDEN_HELD_ITEMS`) | teste "nunca vira item segurado" |
| Entregue a **todo jogador ao entrar** (1º login e qualquer login sem o item), com ou sem time (ajuste do usuário); "recebeu" só na 1ª entrega, reposições silenciosas | **FEITO** | E2E "item de controle ao entrar (sem time)", "com o inicial: exatamente 1" |
| `/cobblemon:controle` (sem cheats) devolve o item e mostra a dica de novo | **FEITO** | `registerControlCommand`; docs/COMANDOS.md |
| Usar, em pé → menu do time (`openPartyMenu`, o de `/cobblemon:party`); sem time → escolha do inicial; time vazio depois do inicial → PC | **FEITO** | teste "usar no ar"; E2E "usar sem time abriu a escolha do inicial", "usar → menu do time" |
| Agachado + usar → envio rápido (`quickSend`, a mesma rotina de agachado + pular): solta/recolhe onde olha; selvagem → batalha com o selecionado; jogador → menu batalha/troca; em batalha → minimiza/reabre | **FEITO** | teste; E2E "agachado + usar → charmander fora / recolhido" |
| Agachado + esquerdo → próximo do time (do 1º ao último existente e volta ao topo; HUD e actionbar atualizam), no ar, em bloco (sem quebrar) e em entidade (sem dano) | **FEITO** | teste "agachado + esquerdo", "não quebra o bloco", "sem dano"; E2E "[2] → [3] → [1]", "a vaca não levou dano" |
| Esquerdo **no ar** detectável de forma estável | **FEITO** (`world.afterEvents.playerSwingStart`, estável na 2.10.0) | sonda no BDS 1.26.52: `animate` com fonte `attack` → `swingSource=Attack`; sem fonte → `None`; a flag `missed_swing` do `player_auth_input` sozinha não gera evento. Aceitos `Attack`, `Mine` e `None` (este só se não coincide com um uso: é o balanço do botão direito) |
| Mirar o próprio Pokémon tem prioridade: em pé = menu do Pokémon; agachado = montar/ombro (sem montaria possível: menu do Pokémon, nunca a troca de item) | **FEITO** | teste "usar num Pokémon com o item" |
| Agachado + usar mirando selvagem → batalha com o selecionado na frente | **FEITO** | E2E "agachado + usar no selvagem → batalha" (o charmander selecionado entra em campo) |
| Agachado + esquerdo num selvagem → batalha também, sem dano, sem trocar a seleção | **FEITO** | teste; E2E "agachado + atacar o selvagem → batalha" |
| Gestos antigos continuam (agachado + pular, agachar 2×, emote, comandos) | **FEITO** (nada mudou neles) | E2E base 10/10 |
| Dica na actionbar nas primeiras vezes que segura o item (por modo de entrada: mouse, controle, toque), some após 5 vezes ou 5 usos | **FEITO** | teste "dica na actionbar"; E2E "dica dos controles na actionbar" |
| Bloqueio de drop pelo **servidor** | **NÃO POSSÍVEL** com APIs estáveis: não há before-event de drop de item. A trava (`lockMode`) é aplicada pelo cliente oficial; o bot de protocolo, que ignora a trava, consegue dropar e a rede de segurança remove a entidade e devolve o item no mesmo tick | E2E Q: "entidade de item criada pelo BDS: 1, removidas: 1" |
| "Esquerdo" no celular com controles **clássicos** de toque no ar | **NÃO POSSÍVEL** de forma confiável: tocar no ar não é ataque nesse esquema. Alternativas documentadas: agachar + atacar uma entidade, agachar + segurar num bloco (balanço `Mine`) ou agachar 2× | docs/COMO-JOGAR.md |

## Arquivos

- Novos: `scripts/controle/logic.ts` (pura), `scripts/controle/index.ts` (runtime),
  `behavior_packs/CobblemonBedrock/items/controle/party_control.json`, `tests/controle.test.ts`,
  `tests/e2e/experimental/controle.e2e.mjs`.
- Ganchos mínimos em arquivos de outras frentes (sem outra frente editando no momento; conferido no `git status`):
  - `scripts/main.ts`: com o item na mão, `handleControlPokemonInteract` (agachado no selvagem/no próprio Pokémon) e
    o resto como mão vazia; `startControlItem(...)` no `worldLoad`.
  - `scripts/commands.ts`: `registerControlCommand(event)`.
  - `scripts/pokemon/PartySelection.ts`: `quickSend(player, slot, aimed?)` (entidade já clicada no lugar do raio).
  - `tests/mocks/minecraft-server.ts`: só exports novos (`ItemLockMode`, `HeldItemOption`, `EntitySwingSource`,
    `EntityDamageCause.entityAttack/projectile`).
- Textos: fim dos `.lang` (en_US e pt_BR), seção `## controle`.

## Pedidos para outras frentes

- Nenhum obrigatório. Sugestão para o orquestrador: validar num cliente real (PC, console e celular) se o cliente
  respeita o `lockMode` na UI (arrastar para baú/moldura) e se o `animate` do clique esquerdo no ar chega com a fonte
  `attack` em todas as plataformas (o bot prova o caminho do servidor, não o cliente).

## Verificação

- `npx tsc -p tsconfig.json`: 0 erros.
- `npm test`: `controle: 22 testes ok`. Na primeira rodada, a suíte inteira passou (exit 0). Na última, só
  `tests/cliente-teste4.test.ts` falhou (`fatia 'espaço' ... maior fatia 12-22 ms`, limite 7 ms). Esse teste mede
  tempo de `makeHasSpaceJob` em `scripts/spawning/Spawner.ts`, que outra frente editou às 09:05 (e
  `SpawnSelector.ts` às 09:07), depois da rodada verde. Esta frente não toca `scripts/spawning/`.
- `npm run validate`: OK. Ele pegou o `menu_category: "none"`, que faria o `/give` recusar o item; foi trocado para
  `equipment`/`utility_item`, e o laço remove as cópias do inventário criativo.
- `npm run import`: rodado uma vez. O build quebrou porque `scripts/spawning/Habitats.ts`, de outra frente, esperava
  `HABITAT_ANCHOR_MIMICS` num `generated/` antigo (REGRAS.md, item 3).
- E2E no BDS `ctl` (porta 19186, RakNet, offline, `COBBLEMON_MSD=0`):
  - base: 10/10 (`node tools/e2e/run.mjs --deploy --rm`);
  - `tests/e2e/experimental/controle.e2e.mjs`: 1/1, 19 passos, `--deploy --rm`.
  - Container removido no fim. `cobblemon-bds` não foi tocado.
- Falhas de infraestrutura vistas, sem relação com o conteúdo:
  - uma rodada da base deu 9/10 porque o `01-starter` levou 75 s para o spawn, com `npm test` e `validate` rodando
    em paralelo; sem carga, passou;
  - um deploy estourou o tempo de start com outras 4 BDS de pé;
  - o runner religou o BDS uma vez no cenário do controle.
