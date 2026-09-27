# Frente batalha-minimizavel

Pesquisa e recomendação: `docs/pesquisa/7-batalha-minimizavel.md`. **Implementado** (aprovado pelo usuário): o modo
`java` é o padrão, com HUD integrado; `hud` e `classic` são preferências por jogador (`/cobblemon:battleui`).

## Status

| Item | Status | Prova |
|---|---|---|
| Batalha minimizável como no Java (`PartySendBinding`/`ClientBattle.minimised`, antes "NÃO POSSÍVEL igual" em `5-auditoria.md:371`) | **FEITO** (padrão, sem scriptevent) | `tests/batalha-minimizavel.test.ts` §3–§6; E2E `10-batalha-minimizavel` ("padrão: a tela abre sozinha", "minimizado no HUD", "agachar + pular reabriu a tela") |
| Tela só abre sozinha no início e enquanto a batalha estiver aberta; sem timer | **FEITO** | teste §3 ("minimizado: a tela não reabre sozinha", 200 ticks) |
| Troca obrigatória depois de desmaio: minimizada não abre, aberta abre (Java: `BattleMakeChoiceHandler` só liga `mustChoose`; quem monta a troca é a GUI aberta, `BattleGUI.kt:106-117`) | **FEITO** | teste §4a e §4b |
| NPC / selvagem / PvP / Multi | **FEITO**. O mesmo `BattleActor` vale para todos. Em PvP, a tecla R esperando o oponente alterna (`toggleMinimised`) | teste §5 (PvP); E2E 03, 06 e 09 continuam verdes |
| Fim de batalha e saída do jogador limpam o estado | **FEITO** | teste §3 ("estado limpo no fim"); `playerLeave` → `forget` |
| Aviso "Você precisa escolher uma ação. Pressione %1$s." pulsando **no HUD** (`BattleOverlay.kt:143-153`) | **FEITO** (JSON UI, animação alpha 1↔0 de 4 s) | teste §2 (JSON gerado); E2E: título `cbHB` com `min=1 pr=1` e cauda `{cobblemon.battle.ui.actions_label}({…key.keyboard})` |
| Caixas dos ativos esmaecidas (0,5) com a batalha minimizada | **FEITO** (sem o fade de ~5 ticks: troca direta) | teste §2 (`dim.alpha = 0.5`, `propagate_alpha`); E2E `min=1` |
| `hide_label` com a batalha aberta esperando (`BattleGUI.kt:123-132`, opacidade 0,75) | **FEITO** | teste §3 e §5 |
| Overlay do time escondido em batalha (`CobblemonClient.kt:423-432`) | **FEITO** | teste §9; E2E ("overlay do time escondido", "overlay do time de volta") |
| Duplo agachar não troca o selecionado em batalha | **FEITO** | `scripts/pokemon/PartySelection.ts` |
| Preferência por jogador (`java`/`hud`/`classic`) + comando e menu | **FEITO** | teste §1, §7, §8; E2E (`/cobblemon:battleui hud`, `classic`, `default`) |
| Celular: duplo toque em Pular reabre (só no toque, com ação pendente e batalha minimizada) | **FEITO** | teste §6; E2E com `input_mode: "touch"` ("toque: duplo toque em Pular reabriu a tela") |
| Escolher golpe andando (hotbar como cursor + agachar/pular) | **FEITO** (preferência `hud`; menu desenhado no HUD) | teste §8; E2E (3 turnos só pelo HUD, uma única tela) |
| Tela que não bloqueia o movimento | **NÃO POSSÍVEL** com APIs estáveis: forms e DDUI são modais, e o HUD JSON UI não devolve dados. Hipótese `absorbs_input` só em cliente | pesquisa §3, §7 item 5 |

## Implementação

### O que mudou

- **Padrão `java`** (`scripts/battle/BattleUiMode.ts`, antes `experimental/`):
  - `getBattleUiMode` devolve `java` sem preferência. A preferência do jogador (`cobblemon:battle_ui_mode`) vence o
    padrão do mundo, que é definido pelo console.
  - A origem do pedido da tela agora é explícita: `PromptSource = "turn" | "reopen" | "toggle"`
    (`scripts/battle/BattlePromptHooks.ts`).
    - `turn`: chegou o request. Abre só com a batalha aberta.
    - `reopen`: interagir com o oponente/NPC ou nova tentativa. Sempre abre.
    - `toggle`: a tecla R do port, que alterna.
  - Isso corrige um defeito do protótipo: interagir com o oponente durante as animações caía em "minimizar".
- **HUD integrado** (canal `B`):
  - `hudProtocol.ts`: cabeçalho com `min`, `pr` e `cur`, mais 4 registros de golpe. `BATTLE_TAIL_OFFSET` marca onde
    começa a cauda.
  - O texto do aviso vai como **cauda rawtext** do título (`HudBus.setHudChannel(..., tail)`). O cliente traduz, com a
    tecla no `%1$s`, e o JSON UI lê a partir do offset fixo.
  - `gen-hud.ts`:
    - caixas em duas cópias, opaca e esmaecida (`alpha 0.5` + `propagate_alpha`);
    - `prompt_actions` com `@cobblemon_hud.prompt_fade_out` ↔ `prompt_fade_in` (2 s + 2 s, `in_out_sine`), no
      alto da tela (y = 20 %, como `guiScaledHeight / 5`);
    - `prompt_hide` com alpha 0,75;
    - menu 2×2 do modo `hud` (fundo `pokedex/platform_base_<tipo>`, nome localizado, PP, seta no cursor, `[5-9] Menu
      completo`).
  - `BattleHud.ts` pergunta a visão por `ui/BattleUiView.ts`, uma ponte sem imports de batalha. O actionbar não é mais
    usado.
- **Overlay do time**: `GUI/PartyHud.ts` esconde o canal `P` enquanto o jogador participa de uma batalha em andamento.
  Ele volta sozinho no fim.
- **Gestos**:
  - agachado + pular → `promptPlayerForRequest("toggle")` (`main.ts`). Sem escolha pendente, cai no
    `toggleMinimised`.
  - Celular: `handleJumpTap` aceita duplo toque em Pular (≤ 10 ticks) só com `lastInputModeUsed === Touch`, ação
    pendente e batalha minimizada. No `classic`, basta a ação pendente com a tela fechada.
  - O texto do gesto no aviso muda para "Toque duas vezes em Pular" no toque.
- **Comando** `/cobblemon:battleui [java|hud|classic|default|status]`:
  - sem argumento, abre um menu com os três modos (o atual marcado);
  - do console, muda o padrão do mundo;
  - o `scriptevent cobblemon:battle_ui_mode` continua como alias.
- **`classic`**: o comportamento antigo (a tela reabre a cada turno). A dica do chat agora cita a tecla
  (`cobblemon.port.battle_ui.reopen_hint`).

### Arquivos de outras frentes tocados (mudança mínima)

- `scripts/battle/BattleActor.ts` (batalhas):
  - `promptPlayerForRequest(source: PromptSource = "reopen")`;
  - `receiveRequest` passa `"turn"`;
  - o re-prompt de "chegou outro request com a tela aberta" passa `"turn"`;
  - import de `./BattlePromptHooks`.
- `scripts/battle/index.ts`: import de `./BattleUiMode`.
- `scripts/main.ts` (jogabilidade): `reopenBattle` → `promptPlayerForRequest("toggle")`.
- `scripts/commands.ts`: `registerBattleUiCommand(event)`.
- `scripts/pokemon/PartySelection.ts` (jogabilidade): duplo agachar não troca a seleção em batalha. Era o pedido §2.
- ui-base (pedido §1 e §2):
  - `scripts/ui/hudProtocol.ts`: campos novos;
  - `scripts/ui/HudBus.ts`: cauda rawtext opcional; sem cauda o título continua string;
  - `scripts/ui/BattleHud.ts`: lê a visão;
  - `tools/ui/gen-hud.ts` e `ui/cobblemon_hud.json` regenerado;
  - `scripts/GUI/PartyHud.ts`: esconde o overlay em batalha;
  - `tools/check-ui-baseline.mjs`: família `platform_base_<tipo>`;
  - `tests/ui-base.test.ts`: tamanho do corpo + golpes.
- `tests/e2e/lib/bot.mjs` (e2e): `input_mode: this.inputMode ?? "mouse"`, para testar o toque.
- `tests/mocks/minecraft-server.ts`: só o export `CustomCommandSource`.
- `texts/en_US.lang` e `pt_BR.lang`: só a seção `## batalha-minimizavel`.
- Docs: `docs/COMANDOS.md`, `docs/COMO-JOGAR.md`.

### Fidelidade

Hoje: **8,5/10**, a meta. O que falta para 10 é impossível no Bedrock ou fica fora do escopo:

- a tela é um form modal, não uma GUI com mouse livre;
- a tecla R é um gesto de 2 botões (1 toque duplo no celular);
- não há message pane dentro da GUI;
- não há fade de 0,25 s nas caixas;
- o pulso não reinicia a cada request (o Java zera `passedSeconds`).

### Verificação (2026-09-26)

- `npx tsc -p tsconfig.json`: 0 erros.
- `npm test`: `batalha-minimizavel: ok`, `ui-base.test.ts: ok`, `batalhas`, `battle-leave`, `multi`, `jogabilidade*`:
  ok. Falharam só `adaptacoes` e `mundo-sons`, com `campfire.json` ausente ou alterado por outra frente no meio da
  rodada (sem relação com esta frente).
- `npm run validate`: OK, nenhum erro.
- `node tools/check-ui-baseline.mjs`: ok, 0 aviso. `gen-hud.ts --check`: em dia. `gen-telas.ts --check`: em dia.
- E2E completo no BDS próprio (`COBBLEMON_BDS=bmin`, porta 19151, `dist-bmin`, RakNet, `run.mjs --deploy`):
  **10/10 passaram**. O 03 (selvagem), o 06 (NPC) e o 09 (Multi) não precisaram de ajuste: o bot responde a tela a
  cada turno, então a batalha segue "aberta".
- Saída do cenário 10:

  ```
  · /cobblemon:battleui default
  · padrão: a tela abre sozinha no começo (sem scriptevent)
  · minimizado no HUD: min=1 pr=1 aviso={cobblemon.battle.ui.actions_label}({cobblemon.port.battle_ui.key.keyboard})
  · agachar + pular reabriu a tela
  · batalha aberta: o turno seguinte abriu sozinho
  · toque: duplo toque em Pular reabriu a tela
  · padrão: vitória; overlay do time de volta
  · menu no HUD: golpes=[irontail, agility, spark, feint] cursor=0 título={cobblemon.port.battle_ui.hud_title}(…)
  · cursor no espaço 2
  · classic: fechar → dica no chat: §7{cobblemon.port.battle_ui.reopen_hint}({cobblemon.port.battle_ui.key.keyboard})
  ✓ ok batalha minimizável: padrão java (HUD integrado, tecla R, toque) + preferências hud e classic (59.5 s)
  ```

- Log do BDS: nenhum ERROR/WARN desta frente. Os que aparecem:
  - `FormRejectError: Player quit before responding`: telas de party, PC e troca quando os bots saem nos cenários
    02, 04, 05 e 07;
  - `No targets matched selector`: preparação do runner;
  - aviso de transporte RakNet.
- Container removido (`docker rm -f cobblemon-bds-bmin`).
- Depois do E2E, só mudou o tamanho dos labels do aviso no `cobblemon_hud.json` (resource pack; o servidor não carrega
  UI). Os testes unitários e o check-ui-baseline foram rodados de novo: ok.

### Precisa de cliente (o E2E não desenha)

1. O `#hud_title_text_string` recebe a cauda rawtext **já traduzida**?
   - É a hipótese de que dependem o aviso com a tecla e o título do menu `hud`.
   - Se aparecer JSON cru ou a chave, o plano B é passar o texto por chaves por gesto na seção da frente.
2. O pulso do aviso (`prompt_fade_out` ↔ `prompt_fade_in`, `in_out_sine`, 2 s + 2 s) roda em laço?
3. As caixas ficam a 50 % (`alpha` + `propagate_alpha` num painel)?
4. O aviso cabe e fica legível em 16:9, no celular e em GUI scale padrão? A posição é y = 20 %.
5. Toque: o duplo toque em Pular reabre sem pular duas vezes "de verdade" atrapalhando?
6. Controle: segurar B e apertar A funciona como tecla R?
7. O menu `hud` 2×2 acima da hotbar não cobre corações nem fome?

## Pedidos pendentes

### 4. e2e: documentação do cenário

Acrescentar em `docs/E2E.md`, na tabela "O que cada cenário cobre":

> `10-batalha-minimizavel` | padrão `java` sem comando: a tela abre no começo, fechar minimiza (HUD `cbHB` com `min=1`,
> `pr=1` e o aviso do Cobblemon na cauda), não reabre sozinha, agachar + pular reabre, batalha aberta abre o turno
> seguinte, duplo toque em Pular (`input_mode` touch) reabre, o overlay do time some e volta; `/cobblemon:battleui hud`:
> menu de golpes no HUD, cursor segue a hotbar, vitória com uma única tela; `classic`: dica no chat

### 6. (opcional) message pane minimizado

Últimas 3 linhas do log com alpha 0,3 no canto inferior direito, pelo mesmo canal (`BattleOverlay.kt:155-162`). Não
foi feito: precisa de um campo de texto variável a mais na cauda, e o port já manda o log no chat.
