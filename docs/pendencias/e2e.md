# Pendências da frente "e2e" (suíte end-to-end com bots de protocolo)

Arquivos da frente:
- `tests/e2e/**`: `lib/{bot,server,flows}.mjs` e `scenarios/*.e2e.mjs`;
- `tools/e2e/**`: `run.mjs`, `package.json`, `.npmrc` e `node_modules` próprio;
- `docs/E2E.md`.

Edições aditivas em arquivos compartilhados:
- `package.json`: o script `test:e2e`, que fixa `COBBLEMON_BDS=e2e`, `COBBLEMON_BDS_PORT=19148`, `COBBLEMON_DIST=dist-e2e`,
  `COBBLEMON_BDS_TRANSPORT=raknet` e `COBBLEMON_BDS_ONLINE_MODE=false`.
- `tools/server.mjs`: a variável `COBBLEMON_BDS_ONLINE_MODE`. Sem ela, nada muda. Com ela, o valor vai para `-e ONLINE_MODE=` no
  `docker run` e para `online-mode=` no `server.properties` durante o deploy. O `COBBLEMON_BDS_TRANSPORT` é do
  orquestrador.

Servidor próprio: `cobblemon-bds-e2e`, UDP 19148, `dist-e2e`, RakNet, offline. O runner para o container no fim
(`docker stop`); `--rm` apaga o container.

Como rodar: `npm run test:e2e` (veja `docs/E2E.md`).

## Status dos itens pedidos

| Item | Status | Prova |
|---|---|---|
| Harness: sobe/deploya o BDS, conecta o bot e espera o spawn | FEITO | `tools/e2e/run.mjs`, `Bot.connect` |
| runCommand (como jogador e pelo console) | FEITO | `bot.command`/`commandOk`, `t.console` |
| Esperar texto, título e actionbar | FEITO | `waitForText`, `waitForTitle` |
| `modal_form_request`: responder ActionForm (índice/texto), MessageForm (0/1) e ModalForm (valores), e fechar | FEITO | `answerForm`/`closeForm`. ModalForm com slider no cenário PC; MessageForm no starter e na troca |
| Interagir com entidade (item_use_on_entity pelo runtime id) | FEITO | batalha, NPC |
| Usar item (click_air, com mira) | FEITO | captura, Pokédex |
| Mover/teleportar | FEITO | `teleport`, `queryPosition`, `player_auth_input` com `moveVector` |
| Ler inventário | FEITO | `inventoryItems`, `findSlot`, `itemNetworkId` |
| Cenário: inicial no 1º login → time com 1 | FEITO | `01-starter`. Funciona com o layout antigo (3 forms) e com a tela única nova |
| Cenário: givepokemon + party, mandar para fora e recolher | FEITO | `02-party` (E2E-2 corrigido: sem o aviso ⚠) |
| Cenário: selvagem → interagir → forms de batalha → Lutar → golpes até acabar | FEITO | `03-battle` |
| Cenário: Poké Ball num selvagem → capturado → time atualizado | FEITO; E2E-3 **CORRIGIDO** (4/4 com `E2E_KNOWN_BUGS=1`, 3 sessões) | `04-capture`. `E2E_WORKAROUNDS=1` não é mais necessário |
| Cenário: navegação no PC | FEITO | `05-pc`: << >>, "ir para caixa" (slider), guardar pelo time, retirar |
| Cenário: diálogo de NPC (`npcspawn` + interagir) | FEITO | `06-npc`, mais `/cobblemon:opendialogue` |
| Cenário: troca entre 2 bots | FEITO | `07-trade` |
| Cenário: o form da Pokédex abre | FEITO | `08-pokedex` |
| Falhas acionáveis: fim do log do servidor e últimos forms | FEITO | dump por cenário: passos, forms (achatados), eventos do bot, ERROR/WARN e fim do log |
| DDUI (`CustomForm`/`Observable` do Summary) | NÃO POSSÍVEL por enquanto | a semântica das data stores não está documentada (pesquisa 6, §5.1) |

Última execução: veja "Resultado da verificação", abaixo.

## Bugs reais encontrados no add-on (com repro)

Status das correções (rodada "e2e-fixes", 2026-09-26, com todas as frentes encerradas):

| Bug | Status | Onde | Prova |
|---|---|---|---|
| E2E-3 | **CORRIGIDO** | entidades das bolas, `scripts/main.ts`, `scripts/catching/CaptureSequence.ts` | `E2E_KNOWN_BUGS=1 npm run test:e2e -- --deploy --only capture`: 4/4 capturas de Master Ball com sucesso, 0 `hurt_animation` na bola, em 3 sessões (12/12 arremessos); nenhum "Captura abortada" no log |
| E2E-1 | já estava corrigido (ver abaixo) | — | nenhum "Unhandled promise rejection" nas suítes |
| E2E-2 | **CORRIGIDO** | `scripts/Pokemon.ts` (`PokemonData.return`) | `02-party` sem o aviso ⚠ nas duas suítes completas |
| E2E-4 | **CORRIGIDO** | `scripts/machines/pasture.ts` (`onPasturedEntityLoaded`) e `scripts/main.ts` (`entityLoad`) | guarda `isValid`; o aviso não apareceu nas suítes (não é determinístico, depende de chunks carregando no `kill @e`) |
| E2E-5 | **CORRIGIDO** | `scripts/commands.ts` (`spawnpokemon`/`pokespawn`), `texts/*.lang` seção `## e2e-fixes` | cenário avulso (`--scenario`, `spawnpokemon ... 20000 100 20000`): chat `§c{cobblemon.port.command.spawnpokemon.unloaded_chunk}` |
| E2E-6 | **CORRIGIDO** | `scripts/ui/studio/Studio.ts` (`dropFromStudioFloor`, chamado no `playerSpawn`) | `09-multi` passa (antes falhava 2/2); suíte completa 9/9 |

O que mudou em cada um:

- **E2E-3:**
  - As 98 entidades de `behavior_packs/CobblemonBedrock/entities/pokeballs/` (49 bolas, inclusive as ancient, e
    49 `*_dummy`) têm `minecraft:damage_sensor` com `cause: all` → `deals_damage: false`. As exceções são
    `self_destruct` (o `/kill` continua funcionando) e `void`. O acerto continua igual (o `projectileHitEntity`
    não depende de dano). Conferido no console: `damage` no dummy → "Could not apply damage"; `/kill` → "Killed".
  - `main.ts`, `entityLoad`: só mata bolas velhas. Uma bola registrada em memória como captura em andamento
    (`isCaptureInProgress`, do `CaptureSequence.ts`) é poupada. A entidade inválida no tick do load é ignorada.
  - `CaptureSequence.ts`:
    - registra o id da bola num `Set` em memória durante a sequência;
    - loga `console.warn("Captura abortada (<etapa>): entidade inválida: bola|alvo|lançador")` quando a sequência
      para;
    - se só a bola sumiu, termina sem ela: antes do cálculo devolve a bola ao inventário (fora do criativo); depois
      do cálculo aplica o resultado (captura ou "escapou");
    - o `finally` sempre devolve visibilidade, movimento e `cobblemon:busy` ao Pokémon.
  - A assinatura 2 ("some depois da 2ª sacudida sem dano") não voltou a aparecer. A causa suspeita (o
    `entityLoad`) foi fechada, mas a causa exata não foi confirmada por log.
- **E2E-2:** `PokemonData.return` tira a tag do UUID antes do `instant_kill`. Assim o `tryGetPokemonOut()` do mesmo
  tick não acha mais a entidade que está sumindo. Todos os recolhimentos (menu do time, batalha, troca, pasto,
  máquina de cura, evolução) passam por esse método.
- **E2E-4:** `if (!entity.isValid) return;` no começo do `onPasturedEntityLoaded`.
- **E2E-5:** o `spawnEntity` do `spawnpokemon` captura `LocationInUnloadedChunkError` (pelo nome, porque o mock dos
  testes não exporta a classe) e responde com a chave nova `cobblemon.port.command.spawnpokemon.unloaded_chunk`
  (en_US e pt_BR).

O texto abaixo é o relato original, mantido para referência.

### E2E-3 (alta, CORRIGIDO): captura fora de batalha às vezes aborta no meio; a bola some sem mensagem

- **Frente:** captura. Arquivos: `scripts/catching/CaptureSequence.ts`, `scripts/main.ts:189-203` e a entidade da
  bola em `generated/behavior_packs/.../entities/pokeballs/*.json`.
- **Repro:** `npm run test:e2e -- --only captura` (plataforma de vidro, Master Ball, Snorlax nível 5 parado a 3
  blocos). Com `E2E_KNOWN_BUGS=1`, a captura se repete 4 vezes.
- **Frequência:** intermitente, mas **por sessão**: quando acontece, costuma acontecer em todos os arremessos daquele
  bot.
  - Nas execuções desta sessão: falhou 4/4 arremessos em 5 execuções e passou em 7.
  - Na última suíte completa (mundo novo, build atual, 08:00 UTC) falhou 4/4.
- **Esperado:** "§a... capturado" (`cobblemon.capture.succeeded`), e o Snorlax no time. A Master Ball tem sucesso
  garantido.
- **Obtido:**
  - A sequência começa normalmente. Os sons chegam ao jogador: `hit` 0,5 s, `open` 0,6 s, `recall` 1,2 s, `shut`
    2,4 s, `shake` 5,2 s, `shake` 6,4 s.
  - Aí a entidade da bola é removida (`remove_entity` ~6,3 s depois do arremesso). Não sai `capture_succeeded` nem
    mensagem.
  - O Snorlax volta ao normal (`breakFree` do `finally`), e a bola foi gasta.
  - Nada no log: `runCaptureSequence` só retorna quando `stillValid()` fica falso; ele não loga.
- **Duas assinaturas observadas:**
  1. **Dano.** A bola recebe `hurt_animation` a cada ~0,5 s depois de pousar e morre após a 1ª sacudida. Ela tem
     `minecraft:health` 1, e o `damage_sensor` só cancela `fall`. Com
     `effect @e[type=cobblemon:master_ball] resistance 30 255` logo depois do acerto, essa sessão completou a
     captura. Por isso existe `E2E_WORKAROUNDS=1`.
  2. **Sem nenhum dano** (execução final): a bola some depois da 2ª sacudida. Suspeita: o `world.afterEvents.
     entityLoad` do `main.ts:201` dispara `cobblemon:instant_kill` em **qualquer** entidade da família `pokeball`
     ("Prevents old pokeballs from being loaded in"). A sequência teleporta a bola todo tick (`faceTarget`). Se um
     teleporte ou recarga de chunk gerar `entityLoad`, a bola em captura morre.
- **Correção sugerida:**
  - (a) Na entidade da bola, `minecraft:damage_sensor` com `{"cause": "all", "deals_damage": false}`.
  - (b) No `entityLoad` do `main.ts`, não matar bolas com `getDynamicProperty("activated")` (captura em andamento),
    ou só matar as que vieram do disco (por exemplo, marcar o tick de spawn e ignorar as recentes).
  - (c) Logar (`console.warn`) quando `runCaptureSequence` abortar porque bola, alvo ou lançador ficou inválido.
    Hoje isso é silencioso.

  A captura em batalha usa a mesma sequência e deve ter o mesmo problema. Não testei isso isoladamente.

### E2E-1 (média → parece corrigido no build de 08:00 UTC): "Unhandled promise rejection: FormRejectError" quando o jogador sai com um form aberto

> Na última suíte (build atual, mundo novo) não houve nenhum "Unhandled promise rejection". O FormRejectError
> agora aparece tratado:
> - `[cobblemon] {"rawtext":[... "FormRejectError: Player quit before responding."]}`: é a `reply` do `later()` do
>   `commands.ts` indo para o console, porque o jogador já saiu;
> - `Diálogo: FormRejectError …` e `Troca: FormRejectError …` como WARN.
>
> Resta só ruído no log. Fica registrado caso volte.

- **Frente:** interface/telas. Arquivos: `scripts/starter.ts` (`promptStarterOnJoin` → `offerStarter` →
  `showStarterGUI`) e `scripts/main.ts:54` (`void promptStarterOnJoin(player)`).
- **Repro:** entrar com um jogador novo (a tela de iniciais abre 100 ticks depois) e sair antes de responder.
- **Log:** `[Scripting] [Cobblemon Bedrock Behavior Pack] Unhandled promise rejection: FormRejectError: Player quit
  before responding. at showStarterGUI (main.js:...)`.
  - Com o layout novo, o log diz `at show (main.js:161983)`.
  - Acontece em toda execução da suíte em que um bot sai com a tela aberta.
- **Correção:** `.catch(() => {})` na promise do `promptStarterOnJoin`/`offerStarter`, ou um try/catch em volta do
  `form.show` no `showStarterGUI`/`CellForm.show`. Vale para qualquer `form.show` disparado sem jogador esperando.

### E2E-2 (baixa, CORRIGIDO): menu do time reaberto logo após "Recolher" ainda mostra o Pokémon como fora (●)

- **Frente:** interface. Arquivo: `scripts/GUI/Party.ts`, em `showPartyPokemonMenu`: o caso `toggle` faz
  `pokemon.return(player)` e `return`, e o `openPartyMenu` redesenha na hora.
- **Repro:** `/cobblemon:party` → Pokémon → Mandar para fora → (o menu volta) → Pokémon → Recolher. O menu do time
  que volta ainda mostra " §b●" no botão.
  - Reabrir o menu 1 s depois mostra certo.
  - Causa: `return()` só dispara `cobblemon:instant_kill`, a entidade some no tick seguinte, e o
    `tryGetPokemonOut()` ainda a encontra.
- **Correção:** marcar o recolhimento no `PokemonData` (limpar o vínculo com a entidade) antes de redesenhar, ou
  reabrir o menu com `system.run`.
- **Na suíte:** `02-party` registra isso como ⚠ aviso, não como falha.

### E2E-4 (baixa, CORRIGIDO): aviso "[máquinas] pasto: InvalidEntityError" quando uma entidade some no tick em que carrega

- **Frente:** máquinas. Arquivo: `scripts/machines/index.ts:91`:
  `world.afterEvents.entityLoad → onPasturedEntityLoaded(entity)`.
- **Repro:** com chunks carregando, rodar `kill @e[type=!player]`. O runner E2E faz isso no início.
- **Log:** `[Scripting] [máquinas] pasto: InvalidEntityError: Failed to call function 'getDynamicProperty' due to
  Entity being invalid`.
- **Correção:** `if (!entity.isValid) return;` no começo do `onPasturedEntityLoaded`.

### E2E-5 (baixa, CORRIGIDO): `/cobblemon:spawnpokemon` numa posição de chunk descarregado mostra a exceção crua

- **Frente:** interface (commands). Arquivo: `scripts/commands.ts`, em `spawnpokemon`.
- **Repro:** `/cobblemon:spawnpokemon snorlax 5 false ~ ~ ~3` com o jogador num chunk que não está carregado e
  ticando (por exemplo, logo depois de um `/tp` para longe).
- **Obtido:** chat `§cLocationInUnloadedChunkError: Trying to access location (98.0, 170.0, 80.0) which is not in a
  chunk currently loaded and ticking.`
- **Esperado:** uma mensagem traduzida, como a do Cobblemon (`cobblemon.command.spawnpokemon.invalid_position`), ou
  esperar o chunk carregar.

### E2E-6 (alta, CORRIGIDO): jogador que entra com a tela de iniciais de outro aberta nasce no chão do estúdio e morre de queda

- **Frente:** telas (estúdio 3D da tela de iniciais/resumo). Arquivo: `scripts/ui/studio/Studio.ts`.
- **Sintoma no E2E:** `09-multi` falhava 2/2 no build atual. A+B formavam a equipe; C→D dava "o menu de interação não
  abriu" ×2 e `MultiC: timeout (8000 ms) esperando form`. Log do servidor sem ERROR/WARN.
- **Causa raiz (add-on, não o cenário):**
  - o estúdio põe a espécie 48 blocos acima do jogador, em cima de uma barreira temporária
    (`openStudio` → `floor`); A e B abriram a tela de iniciais no spawn (chão em y=67, grama), então a barreira ficou
    em 29,115,14;
  - o spawn do mundo coloca o jogador no bloco mais alto da coluna; C e D entraram enquanto a tela de A/B estava
    aberta e nasceram **em cima da barreira** (`/tp @s ~ ~ ~` de entrada: `29.50, 116.00, 14.50`);
  - quando o `setupWithPokemon` de A fechou a tela, `restoreFloor` trocou a barreira por ar e C e D caíram 48 blocos:
    `{death.fell.accident.generic}(MultiC)` e `(MultiD)` no chat, 2 s depois;
  - os bots não mandam `respawn`, então C e D ficaram mortos: o teleporte para a arena funciona, mas um jogador morto
    não interage (C → D nunca abre o menu). A e B não morreram porque entraram antes de haver barreira.
  - Não tem relação com `showFormSafely`, `leads`, IA de espécie nem tint. Num servidor real acontece igual: vários
    jogadores novos entram no spawn, cada um com a tela de iniciais aberta.
- **Prova (log de depuração temporário no `playerSpawn`, já removido):** `spawn MultiC 29.5 116 14.5
  floors=[{"x":29,"y":115,"z":14}] under=minecraft:barrier`; no chão, `testforblock` deu Grass Block em 29,67,14 e ar
  de 68 a 116.
- **Correção:** no `playerSpawn`, além do `closeStudio`, `dropFromStudioFloor(player)`: se o bloco sob os pés é uma
  barreira anotada em `cobblemon:studio_floors`, o jogador é teleportado para cima do primeiro bloco sólido (ou
  líquido) abaixo dela (`Dimension.getBlockBelow`, API estável; a busca inclui o bloco de partida, por isso começa em
  `y - 1` da barreira). Não mexe no cenário nem no bot. Depois da correção: `spawn MultiC 29.5 116` →
  `ground minecraft:grass_block {y:67}` → `after MultiC {y:68}`; sem mortes.
- **Fica em aberto (não corrigido, fora do escopo):** dois jogadores na mesma coluna usam o **mesmo** palco
  (A e B: os dois bulbasaur em 29.5,116,14.5). Só o primeiro anota a barreira; quando ele fecha a tela, a barreira
  sai de baixo da entidade de exibição do outro, que ainda está aberto (o modelo cai e o vigia fecha o estúdio do
  segundo, que volta para o retrato 2D). Frente telas: dar um palco por sessão ou só tirar a barreira quando nenhuma
  sessão usar aquele palco.

### Observação: troca, a atualização fecha a tela de escolha do outro jogador

- **Frente:** social. Arquivo: `scripts/trade/TradeUI.ts`, em `onTradeUpdated`.
- Cada atualização (oferta ou aceite) chama `closeFor` e reabre o menu **dos dois**. Se B está na tela "Escolher
  Pokémon" quando A oferece, a tela de B fecha e a escolha em andamento se perde. O bot precisou esperar a oferta
  de A antes de B escolher.
- Com jogadores reais, isso aparece como "a tela fechou sozinha".
- Não é regressão da paridade (o Cobblemon Java tem uma tela única); fica como sugestão de UX: não fechar o
  submenu de escolha do outro jogador.

## Achados de infraestrutura (não são bugs do add-on)

1. **Memória do Docker: bloqueio externo recorrente.**
   - A VM do Docker Desktop tem 7,6 GiB, e cada BDS com o add-on usa ~2 GiB.
   - Com 4 ou mais BDS de pé (frentes paralelas), o kernel mata um por OOM. O `cobblemon-bds-e2e` foi morto
     várias vezes, e outros também (`ui-base`, `ia-npc`, `cobblemon-bds`).
   - O runner espera memória livre (`MemAvailable` ≥ 2,2 GiB, até 10 min), religa e repete o cenário se o servidor
     morrer, e para o container no fim.
   - **Só o usuário pode aumentar a memória do Docker Desktop** (Settings → Resources); 12 GiB ou mais seria
     confortável.
2. **Com a máquina carregada** (outros BDS a 170–700% de CPU), às vezes o bot não recebe o `player_spawn` em
   120 s, ou o servidor ignora os primeiros comandos.
   - O runner tenta entrar 2 vezes por cenário.
   - Com a máquina calma, 6 de 6 entradas seguidas funcionaram.
   - O BDS roda emulado (imagem arm64/box64), por isso o spawn leva ~45 s sem a ticking area e ~5–20 s com ela.
3. **Protocolo.** O `bedrock-protocol` 3.60 com `jsp-raknet` 2.2 precisou de 5 correções no bot:
   - RakNet protocolo 11;
   - fim da tela de carregamento;
   - `extra` do item vazio;
   - janelas de recepção do RakNet;
   - fila de recepção.

   A mais importante é a das janelas. Com as originais, a conexão parava segundos depois do spawn: o bot parava de
   receber pacotes, e o servidor continuava achando que estava tudo certo. Isso explicava quase todas as entradas
   "travadas" e os comandos "ignorados".

   Os detalhes estão em `docs/E2E.md`, seção "Detalhes do protocolo". Vale abrir issue upstream no PrismarineJS
   (jsp-raknet: protocolo 11 e janelas; bedrock-protocol: ItemV4 vazio).

4. **Mundo novo com o build atual** (pedido do orquestrador, a partir do relato da frente "telas": "o bot não
   termina de entrar num mundo novo").
   - **Não reproduzi com o build atual.** Apaguei `.bds-e2e/worlds` e fiz deploy do build atual (07:04 UTC).
   - O mundo foi criado do zero ("CREATING VANILLA WORLD"). O bot entrou em **51,7 s** (spawn em 49 s pelo log do
     servidor) e respondeu ao `/tp` em 0,3 s. Não houve WARN, "passe lento", watchdog nem atividade de estrutura.
   - Seis entradas seguidas no mesmo mundo novo: 38–50 s cada, todas OK.
   - Uma suíte inteira rodou nesse mundo (resultado abaixo).
   - A causa mais provável do travamento relatado é o problema do jsp-raknet do item 3, não o build: uma entrada
     trava para sempre quando um datagrama se perde no meio do fluxo de chunks, com o servidor já dizendo
     "Player Spawned".
   - Se "telas" usa outro bot, vale aplicar as mesmas correções. Se usa o cliente oficial, é outro problema.
   - Sem o travamento, não houve o que bisseccionar com `village_pokecenters off` ou o spawn desligado.
   - A suíte desliga o spawn natural no mundo E2E (`cobblemonconfig set enableSpawning false` e
     `gamerule domobspawning false`) só para aliviar o servidor.

## Resultado da verificação (2026-09-26, BDS 1.26.52.3, protocolo 2193)

Mundo novo (`.bds-e2e/worlds` apagado), com o build atual da árvore via `npm run test:e2e -- --deploy`, às
08:00 UTC. Depois, uma 2ª execução no mesmo mundo.

| Cenário | Execução 1 (deploy) | Execução 2 |
|---|---|---|
| 01 starter | ✓ 52,6 s | ✓ 47,3 s |
| 02 party | ✓ 9,3 s (⚠ E2E-2) | ✓ 9,2 s (⚠ E2E-2) |
| 03 batalha selvagem | ✓ 29,5 s | ✓ 32,3 s |
| 04 captura | ✗ E2E-3 (4/4 arremessos abortam depois da 2ª sacudida, sem dano na bola) | ✗ E2E-3 (idem) |
| 05 PC | ✓ 8,5 s | ✓ 8,5 s |
| 06 NPC | ✓ 10,5 s | ✓ 10,4 s |
| 07 troca | ✓ 19,1 s | ✓ 18,8 s |
| 08 Pokédex | ✓ 5,8 s | ✓ 5,8 s |

- **Resultado: 7/8 nas duas execuções.** A única falha é o bug real E2E-3 do add-on.
- Numa execução anterior (07:33 UTC, outro mundo novo), 8/8 passaram, inclusive a captura. O E2E-3 é intermitente
  por mundo/sessão.
- A suíte completa leva cerca de 3–4 min com o servidor já de pé (a 1ª entrada leva ~45 s; as outras, 4–20 s).
- `npm test` não é afetado: os arquivos da frente ficam em `tests/e2e/`, fora do padrão `tests/*.test.ts`.
- `tsc` também não: os arquivos são `.mjs`, fora do `include` do tsconfig.
- Logs do servidor durante a suíte (build atual):
  - nenhum "Unhandled promise rejection";
  - `WARN DEBUG-NPC-DIE cause=selfDestruct` (log de depuração da frente social, quando o NPC é removido com `kill`);
  - `No targets matched selector` (é o `kill` de limpeza da própria suíte).

## Resultado da verificação depois das correções (2026-09-26, 08:14–08:25 UTC)

Build atual via `--deploy`, no mesmo mundo E2E. Só `cobblemon-bds-e2e` ficou de pé durante os testes; o
`cobblemon-bds` foi parado antes e religado no fim.

| Cenário | `npm run test:e2e -- --deploy` | `E2E_KNOWN_BUGS=1 npm run test:e2e -- --deploy` |
|---|---|---|
| 01 starter | ✓ 46,0 s | ✓ 45,5 s |
| 02 party | ✓ 9,2 s (sem ⚠ E2E-2) | ✓ 9,2 s (sem ⚠) |
| 03 batalha selvagem | ✓ 31,5 s | ✓ 31,6 s |
| 04 captura | ✓ 18,8 s | ✓ 51,9 s (4/4 capturas) |
| 05 PC | ✓ 8,6 s | ✓ 8,7 s |
| 06 NPC | ✓ 10,4 s | ✓ 10,5 s |
| 07 troca | ✓ 18,8 s | ✓ 18,6 s |
| 08 Pokédex | ✓ 6,0 s | ✓ 5,8 s |

- **8/8 nas duas execuções.**
- Captura isolada (`E2E_KNOWN_BUGS=1 ... --deploy --only capture`, mais uma execução sem `--deploy`): 4/4 cada.
  Todas terminaram com a sequência completa de sons até `capture_succeeded`, com 0 `hurt_animation` na bola.
- Log do servidor: nenhum "Captura abortada", "pasto: InvalidEntityError" ou "Unhandled promise rejection". Resta
  o ruído conhecido do FormRejectError tratado (E2E-1).
- `npx tsc -p tsconfig.json`: 0 erros. `npm test`: tudo ok.

## Rodada "multi-fix" (2026-09-26, 12:50–13:12 UTC): E2E-6

- Reprodução no build atual: `npm run test:e2e -- --only multi --verbose` → ✗ (`MultiC0gf3: timeout (8000 ms) esperando
  form`, ⚠ "o menu de interação não abriu" ×2; C e D com `{death.fell.accident.generic}` logo depois de entrar).
- Depois da correção em `scripts/ui/studio/Studio.ts`:
  - `npm run test:e2e -- --deploy --only multi` → ✓ (95,5 s, 1/1);
  - `npm run test:e2e -- --deploy` → **9/9** (starter 49,3 s; party 10,3; batalha 32,2; captura 18,7; PC 8,6; NPC 10,5;
    troca 18,5; Pokédex 5,8; multi 56,6). Único ⚠: `No targets matched selector` no starter (o `kill` de limpeza da
    suíte num mundo vazio);
  - `npx tsc -p tsconfig.json`: 0 erros; `npm test`: tudo ok.
- `cobblemon-bds` não foi tocado; `cobblemon-bds-e2e` parado no fim.

## Rodada "minimizável intermitente" (2026-09-26, 21:18–23:40 UTC): `10-batalha-minimizavel`

Sintoma: 1 falha em 3–4 execuções, na fase `classic` ou no início da `hud`. Depois da batalha anterior, `spawnWild`
cria o Rattata e o bot interage (`interact → cobblemon:rattata rid=N`), mas nenhuma tela chega (`timeout (30000 ms)
esperando form`). O log do servidor não mostra ERROR/WARN.

**Causa raiz: bug do bot (`tests/e2e/lib/bot.mjs`), não do add-on.**

- O Rattata derrotado às vezes solta carne podre, e o bot pega o item. Nas duas falhas relatadas (`e2e7.log` e
  `e2e-min-1.log`) e na reproduzida, houve `add_item_entity minecraft:rotten_flesh` + `take_item_entity` logo antes
  da interação que falhou.
- Ao pegar o item, o BDS avisa o cliente com um `inventory_transaction` do tipo `normal` (ação `container`, janela 0,
  espaço 0 → `new_item`), e não com `inventory_slot`. O bot só tratava `inventory_content` e `inventory_slot`, então
  o seu modelo ficava com o espaço 0 vazio.
- Na interação seguinte, o bot mandava `held_item` vazio no `item_use_on_entity`, enquanto a mão real tinha o item.
  O BDS descarta a transação em silêncio e só depois reenvia o `inventory_content`.
- Prova com log temporário no `beforeEvents.playerInteractWithEntity` (já removido):
  - nas interações boas: `before` → `handle` (wild=true, in_battle vazio no jogador e no Pokémon) → `start`;
  - na falha: **nenhuma** linha, ou seja, o evento nem chegou ao script. Isso descarta estado não limpo no add-on
    (hipótese a) e batalha presa (hipótese b; as batalhas anteriores terminaram com `ended (win)` e o fim foi
    conferido).
- Repro determinístico (cenário avulso via `--scenario`): `loot spawn ~ ~ ~ loot "entities/cow"` sobre o bot →
  pega a carne → `spawnWild` + `interact`:
  - antes da correção: modelo `inv0` vazio, sem form, sem evento no script;
  - depois: `inv0` = carne (network_id 384) e a tela de batalha abre.
  - Um item dado por `/give` não reproduzia, porque ele chega por `inventory_slot`.

**Correções:**
- `tests/e2e/lib/bot.mjs`: handler de `inventory_transaction` (tipo `normal`). As ações `container` da janela do
  inventário atualizam `this.inventory[slot] = new_item`, como o cliente oficial faz.
- `tests/e2e/scenarios/10-batalha-minimizavel.e2e.mjs`: o Rattata das fases padrão e hud passou do Lv20 para o Lv10.
  - Motivo: com a correção acima, apareceu uma 2ª falha, legítima: `asserção falhou: venceu escolhendo só pelo HUD`,
    com `{cobblemon.battle.win}({cobblemon.species.rattata.name})`.
  - Sequência: o Rattata Lv20 tem Hyper Fang e a habilidade Guts. Hyper Fang crítico (68 → 28), depois o Static do
    Pikachu paralisa o Rattata (Guts ×1,5), e o 2º Hyper Fang derruba o Pikachu Lv30 enquanto o cenário ainda gasta
    os 2 turnos de golpe de status.
  - É mecânica correta, não bug. No Lv10 o Rattata só tem Bite/Quick Attack/Focus Energy, e nem 3 golpes críticos
    com Guts chegam aos 68 PV.
  - A fase hud continua com 3–4 turnos, então `turns >= 3` segue exercitado. A checagem de vencedor do orquestrador
    foi mantida.
- Nada mudou no add-on: `scripts/main.ts` e `scripts/events/ScriptEvents.ts` estão idênticos ao estado anterior aos
  logs temporários.

**Resultados:**
- Antes da correção: `--only minimiz` em loop → falha na 2ª execução, com pickup antes da interação.
- Com as correções finais:
  - `npm run test:e2e -- --only minimiz --keep` (1ª com `--deploy`): **5/5 seguidas** (96,7–105,7 s). Houve
    pickup de item numa delas, e a interação seguinte abriu a batalha;
  - `npm run test:e2e -- --deploy --rm` ×10: **10/10 em todas as 10 suítes**. A minimizável levou 59–76 s, e não
    houve nenhum ⚠ ERROR/WARN do servidor;
  - `npx tsc -p tsconfig.json`: 0 erros. `npm test`: ok.
- Uma rodada intermediária (só com a correção do bot, ainda com o Lv20) fez 10/10, 10/10 e 9/10. A falha foi a
  derrota legítima descrita acima.
- `cobblemon-bds` não foi tocado; `cobblemon-bds-e2e` foi removido pelo `--rm` no fim.
