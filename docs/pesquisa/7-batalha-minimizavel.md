# Pesquisa 7 — Batalha "minimizável" (andar enquanto a batalha acontece)

> Data: 2026-09-26. Alvo: Bedrock 26.x, só `@minecraft/server` 2.10.0 e `@minecraft/server-ui` 2.2.0 **estáveis** e JSON UI,
> sem toggles experimentais (Realms e consoles).
> Prefixos: `C/` = `upstream/cobblemon/common/src/main/kotlin/com/cobblemon/mod/common/`,
> `L` = `upstream/cobblemon/common/src/main/resources/assets/cobblemon/lang/en_us.json`.
> Protótipos: `scripts/battle/experimental/` (desligados por padrão). Testes: `tests/batalha-minimizavel.test.ts`,
> `tests/e2e/scenarios/10-batalha-minimizavel.e2e.mjs`.
>
> **Atualização (implementação aprovada):** o modo `java` virou o padrão, com HUD integrado. O código saiu de
> `experimental/` para `scripts/battle/BattleUiMode.ts` e `scripts/battle/BattlePromptHooks.ts`. O `hud` e o `classic`
> viraram preferências por jogador (`/cobblemon:battleui`). O que mudou e a evidência estão na seção "Implementação" de
> `docs/pendencias/batalha-minimizavel.md`. As §§5–6 abaixo descrevem o estado do protótipo.

## 0. Resumo

- **No Java, "minimizar" não é escolher golpes andando.** A `BattleGUI` é uma tela comum (sem mouse-look, sem andar).
  Minimizar (ESC ou R) fecha a tela, e o jogador anda livre com o HUD de batalha esmaecido e um prompt pulsante
  "Você precisa escolher uma ação. Pressione R.". A GUI **só abre sozinha no início da batalha**. Depois disso, só a
  tecla R reabre. Não existe timer de turno.
- **No Bedrock também não existe UI interativa que não bloqueie o movimento.** Forms (`ActionFormData`/`ModalFormData`/
  `MessageFormData`) e o DDUI (`CustomForm`/`MessageBox`, estável desde server-ui 2.1.0) são modais. O HUD em JSON UI
  só exibe: não tem botão que devolva dados ao script. O que o script consegue ler sem tela são as entradas estáveis
  `playerButtonInput` (Pular/Agachar), `playerHotbarSelectedSlotChange`, `inputInfo` e `itemUse`.
- **Dá para chegar muito perto do Java.** O estado `minimised` é todo do lado do servidor. A tela abre sozinha só
  enquanto a batalha está "aberta". ESC minimiza e o HUD mostra o prompt do Cobblemon. A "tecla R" do port (agachado +
  pular, que já existe) alterna. Isso virou o protótipo **`java`**, testado com bots.
- **Extra opcional, além do Java:** o protótipo **`hud`** faz a escolha do golpe sem abrir tela. Os 4 golpes aparecem
  acima da hotbar, o espaço selecionado da hotbar é o cursor (1–4, roda, LB/RB, toque) e agachado + pular confirma.
  Os bots venceram uma batalha só com hotbar + agachar/pular.
- **Recomendação:** adotar o modo `java` como padrão, com o prompt e o esmaecimento desenhados no HUD do port
  (`cobblemon_hud.json`). O `hud` fica como preferência opcional por jogador. Detalhes na §6.
- **Fidelidade estimada:** hoje (`classic`) 5/10 → `java` com actionbar 7/10 → `java` com HUD integrado 8,5/10.
  O que falta para 10 é impossível no Bedrock ou fora do escopo: tela com mouse livre no lugar do form, tecla R
  dedicada e message pane dentro da GUI.

---

## 1. Como é no Java (Cobblemon 1.8.2)

### 1.1 Estado e fluxo

| Fato | Referência |
|---|---|
| `ClientBattle.minimised = true` por padrão; também `pendingActionRequests`, `mustChoose` | `C/client/battle/ClientBattle.kt:28,52-54` |
| A GUI abre sozinha **só no início da batalha**: `minimised = false` + `setScreen(BattleGUI())` | `C/client/net/battle/BattleInitializeHandler.kt:48,52` |
| Request novo (turno) **não** abre a GUI: só zera o pulso do prompt e põe `mustChoose = true` | `C/client/net/battle/BattleMakeChoiceHandler.kt:19-20`, `BattleQueueRequestHandler.kt:21` |
| Com a GUI aberta, cada request monta a subtela raiz (ações, troca forçada ou pass automático) | `C/client/gui/battle/BattleGUI.kt:106-117,153-169` |
| Escolha inválida: `mustChoose = true`; se a GUI estiver aberta, volta à raiz | `C/client/net/battle/BattleMadeInvalidChoiceHandler.kt:21-24` |
| Sem timer de turno: o servidor espera todos responderem | `C/api/battles/model/PokemonBattle.kt:514-522` |

### 1.2 Minimizar e reabrir

| Fato | Referência |
|---|---|
| Tecla: `PartySendBinding` ("Throw Selected Pokémon", **R**). Não existe tecla própria da batalha | `C/client/keybind/keybinds/PartySendBinding.kt:36-41`, `L:1990` |
| Em batalha, R não envia Pokémon: chama `toggleBattleScreen`, que inverte `minimised` e abre a GUI se ficar aberta | `PartySendBinding.kt:65-79,96-101` |
| Com a GUI aberta, R (via `charTyped`/`mouseClicked`) minimiza | `BattleGUI.kt:183-193,203-208` |
| ESC: `onClose()` põe `minimised = true` | `BattleGUI.kt:173-176` |
| "Catch" e "Run" minimizam | `C/client/gui/battle/subscreen/BattleGeneralActionSelection.kt:62,68` |
| `isPauseScreen() = false` e fundo sem escurecer | `BattleGUI.kt:149-151,171` |
| Fade-out de ~0,25 s e depois a tela fecha | `BattleGUI.kt:97-104`, `C/client/gui/battle/BattleOverlay.kt:63-65,124-128` |

### 1.3 O que aparece e o que se pode fazer minimizado

- **HUD:** o `BattleOverlay` substitui o `PartyOverlay` durante a batalha inteira (`C/client/CobblemonClient.kt:423-432`).
  - Tiles de todos os Pokémon ativos com opacidade **0,5** (`BattleOverlay.kt:64,124-128`).
  - Oponente com HP em **%**; próprio lado com HP absoluto (`BattleInitializeHandler.kt:63`).
- **Prompt:** `cobblemon.battle.ui.actions_label` = "You need to choose an action. Press %1$s." (`L:2072`).
  - Pulsa com seno de período 4 s (`BattleOverlay.kt:93,143-153`).
  - `%1$s` é o nome da tecla R.
- **Com a GUI aberta** esperando: `cobblemon.battle.ui.hide_label` = "Press %1$s to move around." (`L:2071`,
  `BattleGUI.kt:123-132`).
- **Message pane:** fica visível com opacidade 0,3, no canto inferior direito, e não é interativo
  (`C/client/gui/battle/widgets/BattleMessagePane.kt:40-43`, `BattleOverlay.kt:155-162`).
- **Movimento/câmera:** não há câmera de batalha nem trava de movimento. Minimizado, o jogador anda, olha, pula e ataca.
- **Bloqueios no servidor** enquanto está em batalha:
  - PC (`C/block/PCBlock.kt:280-283`) e cura (`HealingMachineBlock.kt:155-158`);
  - pasto, aceitar evolução e montar;
  - bolas em outro alvo (`EmptyPokeBallEntity.kt:257-259`);
  - itens de bag só quando `canFitForcedAction()` (`C/api/item/PokemonSelectingItem.kt:48-60`).
- **Fugir** = afastar-se ≥ 32 blocos do selvagem (`PokemonBattle.kt:471-507`).

### 1.4 Layout da GUI (referência para o menu)

- A GUI é **só mouse**: nenhuma subtela implementa `keyPressed`.
- Ações em grade 2×2 no canto inferior esquerdo (`BattleGeneralActionSelection.kt:81-95`).
- Golpes em grade 2×2 com cor do tipo, ícones de tipo e categoria, PP e alpha 0,5 quando desabilitado. Não há indicador de
  efetividade (`BattleMoveSelection.kt:41-176`).
- Gimmicks, shift (triplas), alvo, troca 2×3 e confirmação de desistência estão em `subscreen/*`.

---

## 2. O que o port faz hoje (`classic`)

| Comportamento | Onde | Diferença para o Java |
|---|---|---|
| Todo request de jogador abre o form depois das animações (`doWhenClear`) | `scripts/battle/BattleActor.ts:253` (`receiveRequest`), `promptPlayerForRequest` | **Java só abre no início.** Aqui o form interrompe o jogador a cada turno |
| Menu em `ActionFormData` com layout do Cobblemon (`ui/battle.json`) e mundo visível atrás (`force_render_below`) | `scripts/GUI/Battle.ts:63` (`handleMoveRequest`), `resource_packs/.../ui/server_form.json:7-8` | Equivalente à GUI aberta |
| Fechar o form: dica no chat "Interaja com o oponente para reabrir o menu da batalha." | `BattleActor.sendReopenHint`, `texts/*.lang:100` | Java mostra o prompt pulsante no HUD. A dica também está desatualizada: não cita agachar + pular |
| "Tecla R" = agachado + pular; em batalha chama `reopenBattle` → `promptPlayerForRequest` | `scripts/pokemon/PartySelection.ts:109,168` | Equivale ao R, mas só abre; não minimiza |
| Duplo agachar = próximo Pokémon do time (também em batalha) | `PartySelection.ts:176-178` | No Java o overlay do time some em batalha |
| HUD de batalha (`cbHB`) com opacidade sempre cheia | `scripts/ui/BattleHud.ts:8` | Java esmaece para 0,5 minimizado |

Achado de temporização (importante para qualquer solução):
- O Showdown responde na hora. Assim que a escolha é enviada, **o request do turno seguinte já chegou**
  (`mustChoose = true`), e só o form espera as animações (`Dispatcher.doWhenClear`).
- Por isso, a "espera com a GUI aberta" do Java corresponde, no port, a "request pendente e form ainda não mostrado".
- No PvP existe também a espera real pelo oponente (`mustChoose = false`).

---

## 3. Restrições do Bedrock (com fontes)

| Recurso | Situação (estável?) | Serve para | Fonte |
|---|---|---|---|
| `world.afterEvents.playerButtonInput` (`InputButton.Jump/Sneak`, `ButtonState`, filtro `InputEventOptions`) | Estável desde 1.18.0 (MC 1.21.70), em toda a linha 2.x | Gestos (R, confirmar) | https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/worldafterevents · https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/inputbutton |
| Sneak no **toque**: pressionado por ≤ 1 tick e solto na hora, mesmo segurando | Documentado | Não use "segurar agachar" no toque | InputButton (idem) |
| `player.inputInfo` (`lastInputModeUsed`, `getButtonState`, `getMovementVector`, `touchOnlyAffectsHotbar`) | Estável | Texto do gesto por plataforma | https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/inputinfo |
| `world.afterEvents.playerHotbarSelectedSlotChange` | Estável desde 2.1.0 (MC 1.21.100) | Cursor pela hotbar (1–9, roda, LB/RB, toque no espaço) | https://learn.microsoft.com/en-us/minecraft/creator/documents/update1.21.100 |
| `player.selectedSlotIndex` (leitura e escrita) | Estável | Ler o cursor | https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/player |
| `player.inputPermissions` (Movement, Camera, Jump, Sneak…) | Estável | Travar input (o Java não trava) | https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/inputpermissioncategory |
| `entityStartSneaking`/`entityStopSneaking` | Estável desde 2.10.0 | Alternativa ao `isSneaking` | https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/changelog |
| `onScreenDisplay.setTitle`/`setActionBar`/`setHudVisibility`/`hideAllExcept` | Estável | Desenhar no HUD (canal de título do port, actionbar) | https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/screendisplay |
| `player.camera` (`setCamera`, `fade`, `setFov`…) | Estável | O Java não mexe na câmera: desnecessário | https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/camera |
| Forms `ActionFormData`/`ModalFormData`/`MessageFormData` | Estáveis, **modais**: bloqueiam o movimento; `UserBusy` se outra tela estiver aberta | Menu completo | https://wiki.bedrock.dev/scripting/server-forms · https://github.com/Cookiesmuch/MinUI |
| DDUI `CustomForm`/`MessageBox` + Observables | **Estável desde server-ui 2.1.0 (MC 26.30)**. Atualiza ao vivo sem fechar, mas é **modal** ("New modal forms") e em Ore UI (sem reskin por RP) | Tela persistente de batalha, sem o visual Cobblemon | https://learn.microsoft.com/en-us/minecraft/creator/documents/scripting/intro-to-ddui?view=minecraft-bedrock-stable · https://learn.microsoft.com/en-us/minecraft/creator/documents/update1.26.30?view=minecraft-bedrock-stable |
| `uiManager.closeAllForms(player)` | Estável | Fechar a tela pelo servidor | `node_modules/@minecraft/server-ui/index.d.ts:1533` |
| HUD JSON UI com botões que devolvem dados ao script | **Não existe** (botões JSON UI só navegam entre telas) | — | https://wiki.bedrock.dev/json-ui/buttons-and-toggles |
| HUD JSON UI por título (`#hud_title_text_string`, "preserve title") | Funciona (já usado pelo port) | Prompt, tiles esmaecidos, menu do HUD | https://wiki.bedrock.dev/json-ui/preserve-title-texts · `docs/pesquisa/1-interface.md` §1 |
| Futuro do JSON UI | "Será substituído por Ore UI". O HUD **não** está na lista migrada até 26.60-preview | Risco de médio prazo | https://wiki.bedrock.dev/json-ui/json-ui-intro · https://minecraft.wiki/w/Ore_UI |
| Propriedades de tela (`absorbs_input`, `should_steal_mouse`, `is_modal`, `render_game_behind`) | Existem (o `hud_screen` usa `absorbs_input: false`). **Sem evidência** de que um form com elas deixe andar | Hipótese para testar no cliente (§7) | https://wiki.bedrock.dev/json-ui/json-ui-documentation · `bedrock-samples` v1.26.50.4 `ui/hud_screen.json:3574-3578`, `ui/hud_crosshair_overlay.json:10-19` |

Mapeamento de controles (Learn + minecraft.net):
- **Pular:** Espaço / A / botão de pular no toque.
- **Agachar:** Shift / **B no Xbox** (documentado) / botão de agachar no toque (evento de 1 tick).
- **Hotbar:** 1–9 e roda do mouse / LB e RB / tocar no espaço.
- Fonte: https://www.minecraft.net/en-us/article/minecraft-controls

Referências de add-ons:
- **PokéBedrock** exige *todos* os toggles experimentais (https://pokebedrock.com/addon), então não serve de modelo.
- **OriginsPE** abre sua roda por duplo toque de Agachar, ou de Pular no toque (porque o Agachar no toque dura 1 tick).
  Desenha pelo título e seleciona por diálogo de NPC, que também é modal
  (https://github.com/r4isen1920/OriginsPE/blob/main/packs/data/gametests/src/ui/screens/AbilityWheelScreen.ts).
- Não achamos nenhum menu de batalha publicado com "hotbar como cursor".

---

## 4. Opções avaliadas

Fidelidade = quão perto do comportamento **e** da sensação do Java (0–10).

| # | Opção | Prós | Contras | Teclado / Controle / Toque | Fidelidade | Risco |
|---|---|---|---|---|---|---|
| A | **`classic` (hoje)**: form a cada turno; fechar → dica no chat | Simples, testado | Interrompe a cada turno; não dá para ficar minimizado; dica fora do HUD e desatualizada | ✔ / ✔ / ✔ | 5 | — |
| B | **`java` (protótipo)**: estado `minimised` no servidor; ESC e "Fugir" minimizam; prompt do Cobblemon no HUD; tecla R (agachado + pular) alterna | Comportamento do Java; usa os textos do próprio Cobblemon; zero asset novo; funciona em Realms e console | A tela continua sendo form (modal, cursor); R vira gesto de 2 botões; prompt no actionbar até integrar o HUD | ✔ / ✔ (segurar B + A: **precisa de cliente**) / ⚠ agachar é 1 tick no toque; com agachar em modo alternar funciona, senão precisa de outro gesto | 7 (actionbar) → **8,5** (HUD integrado) | Baixo |
| C | **`hud` (protótipo)**: B + menu de golpes no HUD com a hotbar como cursor e R para confirmar; espaços 5–9 abrem o menu completo | Escolher golpe **andando**, igual em todas as plataformas; nenhum item novo, a hotbar do jogador fica intacta | Não existe no Java; mudar de espaço troca o item na mão; só singles; pode confundir quem usa a hotbar | ✔ (1–4 + Shift/Espaço) / ✔ (LB/RB + gesto) / ✔ (tocar no espaço + gesto) | 6 (é um extra) | Médio (ergonomia só em cliente) |
| D | Golpes viram **itens na hotbar** | Um toque escolhe | **Rejeitado pelo usuário.** Troca o inventário, arrisca perder itens e não parece o Cobblemon | ✔/✔/✔ | 2 | Alto |
| E | **DDUI `CustomForm` persistente** (tela que fica aberta e atualiza HP e log ao vivo) | Estável; imita a GUI aberta entre turnos, com log dentro da tela | Modal; visual Ore UI **sem reskin** (perde o layout Cobblemon do `battle.json`); sem glifos; bots E2E não falam DDUI | ✔/✔/✔ | 5 | Médio |
| F | **Form "passthrough"**: `absorbs_input: false` na `third_party_server_screen` | Se funcionasse, seria menu + andar ao mesmo tempo | Sem evidência; vale para **todos** os forms (propriedade de tela, não dá para ligar por form); cursor e mouse-look em conflito; pode quebrar em console | ? | ? | Alto (**só cliente responde**, §7) |
| G | Diálogo de NPC (`/dialogue open`, estilo OriginsPE) | Botões chamam script; tela separada do `server_form` | Modal; precisa de entidade NPC; nada a ganhar sobre o form | ✔/✔/✔ | 4 | Médio |
| H | Câmera de batalha / `inputPermissions` | Estável | O Java não mexe em câmera nem movimento: **reduz** a fidelidade | — | — | — |

---

## 5. Protótipos feitos e evidência

### 5.1 Código (desligado por padrão)

- `scripts/battle/experimental/hooks.ts`: três ganchos opcionais no `BattleActor`.
  - `beforePrompt`: `automatic` = turno novo; senão = pedido do jogador.
  - `onMenuClosed`: ESC ou "Fugir".
  - `onChoiceSent`.
  - Sem modo ligado, os ganchos devolvem "não tratei" e o fluxo é idêntico ao anterior.
- `scripts/battle/experimental/BattleUiMode.ts`: modos `classic` (padrão), `java` e `hud`.
  - Liga com `scriptevent cobblemon:battle_ui_mode <modo>`: por jogador se vier do chat, global se vier do console.
    `status` mostra o modo atual.
  - A decisão é a função pura `decidePrompt`:

    | Situação | Resultado |
    |---|---|
    | Automático, aberto | `open` |
    | Automático, minimizado | `prompt` ou `hud` |
    | R, minimizado | `open` |
    | R, aberto e form do request ainda não mostrado | `minimise` |
    | R no HUD | `confirm` |

  - Desenho pelo **actionbar vanilla**: prompt pulsante `cobblemon.battle.ui.actions_label`, `hide_label` durante a
    espera e o menu de 3 linhas do modo HUD. Não precisa de mudança no resource pack.
  - O texto do gesto muda conforme `inputInfo.lastInputModeUsed`.
- Mudanças mínimas fora da pasta:
  - `BattleActor.ts`: import; `promptPlayerForRequest(automatic = false)`; 5 chamadas de gancho.
  - `battle/index.ts`: `registerBattleUiModes()`.
  - `events/ScriptEvents.ts`: chave no-op para não avisar "inválido".
  - `tests/mocks/minecraft-server.ts`: export `InputMode`.
  - `.lang`: seção `## batalha-minimizavel`.

### 5.2 Testes unitários (`tests/batalha-minimizavel.test.ts`, batalhas completas no harness)

1. Tabela de decisão, elegibilidade do HUD (duplas e troca obrigatória caem fora), menu (cursor destacado, sem PP em
   cinza) e comando.
2. **Padrão desligado:** a tela abre a cada turno, a dica vai para o chat, nada aparece no actionbar e não há estado.
   A batalha termina em vitória.
3. **`java`:**
   - a tela abre no começo;
   - ESC minimiza, sem dica no chat e com o prompt no actionbar;
   - 200 ticks depois a tela ainda não reabriu;
   - R reabre;
   - com a batalha aberta, o turno seguinte abre sozinho;
   - R durante as animações minimiza, e o turno seguinte não abre.
4. **`hud`:** fecha a 1ª tela e vence só com "espaço da hotbar + R"; uma única tela na batalha inteira; estado limpo no
   fim.
5. **`hud`:** espaço 7 + R abre o menu completo.

Resultado: `batalha-minimizavel: ok`. `npm test`: todos passando. `npx tsc -p tsconfig.json`: 0 erros.

### 5.3 E2E com bots no BDS próprio (`bmin`, porta 19151, RakNet)

`tests/e2e/scenarios/10-batalha-minimizavel.e2e.mjs`:
- entradas reais do protocolo: `player_auth_input` com `sneak_*`/`jump_*` (incluindo os estados `*_raw`) →
  `playerButtonInput` + `isSneaking`;
- `mob_equipment` → `playerHotbarSelectedSlotChange`.

Saída (BDS 1.26.52):

```
· modo hud
· 1º turno: a tela abre sozinha (como no Java)
· menu no HUD: {cobblemon.port.battle_ui.hud_title}({...key.keyboard}) | §e▶§e§l[1] {cobblemon.move.irontail}§r §715/15    §f[2] {cobblemon.move.agility}...
· cursor no espaço 2: ... §f[1] {cobblemon.move.irontail}§r §715/15   §e▶§e§l[2] {cobblemon.move.agility}§r §730/30 | ...
· turno 1: espaço 2 + agachar/pular → próximo menu no HUD
· turno 2: espaço 2 + agachar/pular → próximo menu no HUD
· modo java
· minimizado: §f{cobblemon.battle.ui.actions_label}({cobblemon.port.battle_ui.key.keyboard})
· agachar + pular reabriu a tela
· java: vitória
✓ ok batalha minimizável: modos java e hud (hotbar + agachar/pular) (71.7 s)
```

O que isso prova:
- os gestos chegam aos scripts pelo protocolo;
- a hotbar move o cursor e o menu redesenha na hora;
- a batalha inteira é vencida sem nenhuma tela além da primeira (modo hud);
- minimizado, a tela não reabre sozinha e o gesto a reabre (modo java).

Log do servidor sem ERROR/WARN de script desta frente. Os que aparecem são de outras origens:
- `No targets matched selector`: preparação do runner;
- `limits_web_probe`: conteúdo da frente limites;
- aviso de transporte do RakNet.

---

## 6. Recomendação: modo `java` como padrão, desenhado no HUD do port

Uma recomendação só: **substituir o `classic` pelo comportamento `java`** e levar o desenho do actionbar para o HUD do
port. O `hud` (escolha pela hotbar) fica como preferência opcional por jogador, desligada por padrão, por não existir
no Java.

### Plano

| Fase | O quê | Arquivos (frente dona) | Critério |
|---|---|---|---|
| 1 | Promover `java` a padrão: `getBattleUiMode` → `java`; preferência por jogador no editor de config (`classic`/`java`/`hud`) no lugar do `scriptevent` | `scripts/battle/experimental/*` → `scripts/battle/BattleUi.ts` (batalha-minimizavel), `scripts/GUI/ConfigEditor.ts` (telas) | Testes 2–5 continuam passando com o padrão trocado; E2E `03-battle` continua verde (a 1ª tela abre sozinha) |
| 2 | Atualizar `cobblemon.port.battle.reopen_hint` para citar agachar + pular (modo `classic`) | `texts/*.lang` | — |
| 3 | HUD: campo "minimizado" → tiles com alpha 0,5 e fade de ~0,25 s; prompt `actions_label` pulsando (animação de alpha em JSON UI) acima da hotbar; `hide_label` durante a espera; canal próprio no título, sem conflito com o actionbar do envio rápido | `scripts/ui/hudProtocol.ts`, `scripts/ui/BattleHud.ts`, `tools/ui/gen-hud.ts`, `ui/cobblemon_hud.json` (ui-base) | Pedido em `docs/pendencias/batalha-minimizavel.md` §1 |
| 4 | Esconder o overlay do time durante a batalha (`CobblemonClient.kt:423-432`) e não trocar a seleção com duplo agachar em batalha | `scripts/ui/PartyOverlay.ts`/`GUI/PartyHud.ts` (ui-base), `scripts/pokemon/PartySelection.ts` (jogabilidade) | Pedido §2 |
| 5 | Gesto alternativo de R para toque (duplo toque em Pular com `lastInputModeUsed === Touch`, como no OriginsPE) e confirmação no controle | `scripts/pokemon/PartySelection.ts` (jogabilidade) | Teste em cliente (§7) |
| 6 | Menu do modo `hud` desenhado no HUD (4 tiles com cor do tipo e PP, como `BattleMoveSelection`) em vez do actionbar; atalhos 1–4 também dentro do form (`button_mappings` `button.slot1..4` no layout de golpes) | `ui/cobblemon_hud.json`, `ui/battle.json`, `GUI/layoutSpec.ts` (ui-base/telas) | Pedido §1 |
| 7 | (Opcional) Message pane minimizado: últimas 3 linhas do log com alpha 0,3 no canto inferior direito, pelo mesmo canal | ui-base + `scripts/battle/BattleMessage.ts` | — |

Riscos:
- migração do HUD para Ore UI: mitigada pelo check de baseline já existente (`tools/check-ui-baseline.mjs`) e pelo
  fallback em actionbar, que é o próprio protótipo;
- ergonomia do gesto no controle e no toque (§7).

---

## 7. Precisa de cliente (o que observar)

1. **Toque (celular):**
   - agachar em modo "alternar": tocar Agachar, tocar Pular e tocar Agachar dispara a tecla R?
   - com agachar comum (1 tick), `isSneaking` fica verdadeiro quando o Pular chega?
   - tocar no espaço da hotbar move o cursor do `hud` sem abrir o inventário?
2. **Controle (Xbox/PS/Switch):**
   - segurar B (agachar) e apertar A dispara o gesto?
   - LB/RB movem o cursor do `hud` sem atraso?
   - o prompt cita "Agachar + Pular" (`lastInputModeUsed = Gamepad`)?
3. **Actionbar:** o menu de 3 linhas do `hud` cabe e fica legível acima da hotbar em GUI scale padrão, em 16:9 e no
   celular? Não pisca ao reenviar a cada 2 s? O pulso do prompt (claro/escuro a cada 2 s) é perceptível?
4. **Sensação:** com `java`, dá para andar e fugir (≥ 32 blocos) com o prompt na tela, sem a tela reabrindo? Minimizar
   pela tecla R durante as animações é descobrível com o texto "Pressione Shift + Espaço para se mover"?
5. **Hipótese F (form que não bloqueia):** num RP de teste, `third_party_server_screen` com `"absorbs_input": false`,
   `"is_modal": false` e `"should_steal_mouse": false`. Observar:
   - o jogador anda com um form aberto?
   - o cursor ainda clica nos botões?
   - ESC fecha o form ou abre a pausa?
   - vale em console?

   Se funcionar, abre uma opção I ("GUI aberta andando"). Mas a propriedade vale para **todos** os forms, então só com
   um roteamento separado.

## 8. Fontes

- Código Java: `upstream/cobblemon` (1.8.2), caminhos citados nas §§1–2.
- Microsoft Learn (Script API estável 2.10.0 / server-ui 2.2.0):
  - https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/worldafterevents
  - https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/inputbutton
  - https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/inputinfo
  - https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/player
  - https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/screendisplay
  - https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/camera
  - https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/changelog
  - https://learn.microsoft.com/en-us/minecraft/creator/documents/update1.21.100
  - https://learn.microsoft.com/en-us/minecraft/creator/documents/update1.26.30?view=minecraft-bedrock-stable
  - https://learn.microsoft.com/en-us/minecraft/creator/documents/scripting/intro-to-ddui?view=minecraft-bedrock-stable
- Tipos locais: `node_modules/@minecraft/server/index.d.ts` (InputButton `:2075`, InputPermissionCategory `:2133`,
  InputInfo `:14066`, PlayerButtonInputAfterEvent `:17867`, HotbarEventOptions `:25266`) e
  `node_modules/@minecraft/server-ui/index.d.ts` (CustomForm `:364`, `closeAllForms` `:1533`).
- wiki.bedrock.dev:
  - https://wiki.bedrock.dev/scripting/server-forms
  - https://wiki.bedrock.dev/json-ui/buttons-and-toggles
  - https://wiki.bedrock.dev/json-ui/preserve-title-texts
  - https://wiki.bedrock.dev/json-ui/json-ui-intro
  - https://wiki.bedrock.dev/json-ui/json-ui-documentation
- Ore UI: https://minecraft.wiki/w/Ore_UI
- Controles: https://www.minecraft.net/en-us/article/minecraft-controls
- Add-ons:
  - https://pokebedrock.com/addon
  - https://github.com/r4isen1920/OriginsPE (AbilityWheelScreen.ts, UiBridge.ts)
  - https://github.com/Cookiesmuch/MinUI
- `Mojang/bedrock-samples` v1.26.50.4: `resource_pack/ui/hud_screen.json`, `hud_crosshair_overlay.json`,
  `server_form.json`.
