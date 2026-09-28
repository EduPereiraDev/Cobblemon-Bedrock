# Frente ui-polish (4º teste em cliente real, beta 5 / packs v1.0.5)

O usuário achou que as telas melhoraram muito. Faltavam os pontos abaixo (33 prints do selftest + 3 prints avulsos do
orquestrador).

## Causas-raiz (com evidência)

| # | Sintoma | Causa | Evidência |
|---|---|---|---|
| 1 | Ações da batalha: parados, coloridos e sem nome; sob o mouse, cinza com nome. Golpes: o nome some no hover | O botão (`hit@common.button`) ficava na camada 20 da célula. Os controles de estado dele (hover/pressed) desenhavam o quadro opaco da textura (`battle_menu_*` v 26, `party_select` v 29, realce branco) **por cima** do rótulo (camada 6) e dos ícones. O rótulo só aparecia no estado em que o botão não desenhava nada. | `gen-telas.ts` antigo: `hit()` com `layer: 20`. O checador novo acusa **888** problemas no layout do HEAD e **0** no novo (`checkButtonStates`). |
| 2 | "Duas telas de troca", uma com um tile claro vazio | É o mesmo bug do item 1: o tile claro é o do Pikachu sob o mouse. No hover somem nome, nível, retrato e barra de HP. A troca voluntária e a obrigatória (após desmaio) usam o mesmo `switch_layout`. | Print `images/21.webp` (orquestrador). A barra é outra célula (camada 5), coberta pelo hover da célula vizinha (camada 5+20). |
| 3 | HUD do time: espaços vazios como quadrados pretos | O espaço vazio (`k = 'e'`) trocava só o fundo para `party_slot_collapsed`. O conteúdo (fundo do retrato 21×21 e o "Nv.") continuava desenhado. | `PartyOverlay.kt`: com `pokemon == null`, só `partySlotCollapsed`. Prints 23 a 26. |
| 4 | PC: só "Bulbasaur Nv. 12" no painel da esquerda | O form de exemplo do selftest (`samplePcForm`) ainda mandava o layout antigo (perfil + nome em `PREVIEW_TEXT`) e nenhum dos campos novos. No PC real, a prévia era sempre o selecionado do time. Não há hover no servidor: o form não recebe o cursor. | `SelfTest.ts:1383`. Print 6 (tela "PC: caixa com Pokémon" = `pc-sample`). |
| 5 | Resumo, Atributos: texto + barras | A aba era linhas de texto. O `StatWidget` desenha um polígono (6 triângulos centro → vértice k → k+1) sobre o `summary_stats_chart`, com os rótulos nos vértices e a barra de modos Stats/IV/EV/(Montar)/Outro. | `StatWidget.kt` (`drawStatPolygon`, `hexagonVerticesOffset`, `statOptions`). |
| 6a | Pokédex abre numa lista de regiões (form vanilla) | O Java não tem essa lista: abre na grade da 1ª região e troca a região pelas setas do cabeçalho (x 95, y 14,5/19,5). | `PokedexGUI.kt` (`regionSelectWidgetUp/Down`, `updatePokedexRegion`). |
| 6b | Desistir: caixa de mensagem vanilla | O Java usa a `ForfeitConfirmationSelection` dentro da tela da batalha (113×45, 2 botões com ícone). | `ForfeitConfirmationSelection.kt`, `BattleResponseButton.kt`. |
| 6c | Diálogo de NPC: form vanilla | O Java tem o `DialogueScreen`: nome, caixa clara 196×74, retrato 38×36 com seta e opções (lado a lado ou em coluna). | `DialogueScreen.kt`, `widgets/*`. |
| 6d | Mochila da batalha só com texto | Tela do port (o Java não tem mochila na batalha). Faltavam os ícones dos itens. | Print 19. |
| 7 | Inicial em 3D: a plataforma cobre o Pokémon | No 3D o modelo é do mundo (câmera do estúdio). A plataforma era uma imagem do form, e a UI é sempre desenhada depois do mundo. | `images/4.webp`, `images/7.webp`. |

Sobre a cor das ações: no Java o tile **parado é cinza** (quadro de cima do `battle_menu_*`, pixel 103,103,103, com o filete
da cor à direita). **No hover ele fica colorido** (`BattleOptionTile.kt`: `vOffset = if (isHovered) OPTION_HEIGHT else 0`).
O texto é desenhado sempre. O port segue o Java: cinza parado, colorido no hover, e o nome visível nos dois. No print, três tiles apareciam
coloridos ao mesmo tempo. Isso é estado de hover/foco preso no cliente (o `common.button` tem foco de teclado/controle). Com a correção, o nome aparece em qualquer estado.

## O que mudou

### 1 e 2. Estados de botão (todas as células clicáveis)
- `tools/ui/gen-telas.ts`: `HIT_LAYER = 3` e `CONTENT_LAYER = 4`. O `hit()` põe os controles de estado na camada 0 dele. Assim o estado troca só o **fundo**, por baixo do conteúdo.
  - Ícones (`icon()`), categorias, retratos da Pokédex, busca/filtro e abas passaram para a camada 4 ou acima.
  - Fundos que vêm do botão levam o nome `bg*` (tile da ação, quadro do gimmick, moldura da Pokédex, setores do gráfico).
- Vale para batalha (ação, golpes, troca voluntária e obrigatória, alvo, mochila, gimmicks, voltar, desistir), resumo (abas, time, golpes, marcas, markings, modos), inicial, Pokédex, PC e diálogo.
- `tools/ui/layoutScene.mjs`:
  - `buildScene(..., { buttonState })` monta a tela com todos os botões num estado (default/hover/pressed/locked).
  - `checkButtonStates` acusa conteúdo que existe num estado e não em outro, nas duas direções. Acusa também imagem de estado por cima de conteúdo.
- `tools/ui/preview.mjs --state hover` gera `docs/ui-preview/<tela>-hover.png`.

### 3. HUD do time
`tools/ui/gen-hud.ts`: o painel de conteúdo do espaço tem `(not (#k = 'e'))`. O vazio fica só com o `party_slot_collapsed`, como o Java.

### 4. PC
- `scripts/GUI/PC.ts`:
  - `appendPreviewButtons(form, pokemon, página)` é exportada e usada também pelo selftest.
  - A prévia segue o **último Pokémon tocado** (caixa ou time) enquanto ele estiver no time ou na caixa aberta. Sem nenhum, vale o selecionado do time.
- O PCGUI usa o hover. No Bedrock o servidor não recebe o cursor, então isso não é possível.

### 5. Resumo, aba Atributos (gráfico como o Java)
- Geometria compartilhada em `scripts/GUI/layoutSpec.ts`:
  - `RADAR_HEXAGON`: centro (67, 70), raio 48;
  - `RADAR_PENTAGON`: centro (67, 71), raio 49;
  - `radarSectorBox`, `radarStep` com mínimo 5/raio e 10 passos, e `radarTextures`.
- `tools/ui/radar.ts` gera 1.100 texturas de setor (`summary/radar/<h|p><k>_<a>_<b>`, 2 px por px da GUI, borda suave, branco a 60%) e 111 barras `fill_<px>`. São 565 KB.
  - Roda sozinho (`node --experimental-strip-types tools/ui/radar.ts`).
  - Também roda pelo importador (`guiTextures.ts` chama `emitRadarTextures`).
- Layout, com o modo no título (`SUB.SUMMARY_STATS_RIDE`/`_OTHER`/`_RIDE_TAB`):
  - **hexágono**:
    - `summary_stats_chart` em x 25,5, y 22;
    - 6 setores pintados com a cor do modo (atributos 50,215,255; IVs 216,100,255; EVs 255,255,100);
    - rótulo + valor nos 6 vértices, com a seta da natureza e o rótulo em vermelho/azul;
  - **pentágono** (Montar):
    - `summary_stats_chart_pentagon` e 5 setores com a cor do estilo (terra/água/ar);
    - ícone do estilo no centro: tocar troca o estilo;
  - **Outro**: barras 116×24 com underlay, preenchimento pintado (amizade rosa, saciedade verde/amarelo/vermelho), sobreposição, nome, valor e %;
  - **barra de modos** em y 143: 4 modos em x 31 + 24·i, ou 5 com montaria em x 23 + 22·i, com o marcador.
- `scripts/GUI/Summary.ts`:
  - `statsMode` e as ações `statsMode`/`rideStyle`;
  - `statModesOf`;
  - atributo/400, IV/31 e EV/252, como o Java;
  - PV "atual / máx." no vértice.
- `SUMMARY.STAT_TABS` = 51 a 55, `COUNT` = 56.
- Limites:
  - o hover do Java (IV "x/31" e % ao passar o mouse nos rótulos) não existe no Bedrock;
  - no modo Outro cabem 4 barras, sem as setas de página do Java.

### 6a. Pokédex sem lista de regiões
- `openPokedex(player)` abre a grade da 1ª região.
- Setas `POKEDEX_LIST/ENTRY.REGION_PREV/NEXT`: `COUNT` passa a 37/50, e o rótulo da região fica com 57 px.
- `neighbourDex` dá a volta nas pontas.
- "Voltar" da grade principal saiu. Só os resultados da busca têm "Voltar".
- O "Progresso" volta para a grade.
- `openDexList` continua existindo (só como reserva quando não há Pokédex).

### 6b. Desistir
- `forfeitForm()` (`Battle.ts`): `SUB.BATTLE_FORFEIT` e `BATTLE_FORFEIT` (aceitar/recusar).
- `battle.json/forfeit_layout`: `confirmation_request` 113×45 no centro, "Desistir" e os botões `button_request_accept/decline` com os ícones.
- Esc = recusar.

### 6c. Diálogo de NPC (`ui/dialogue.json`, `SCREEN.DIALOGUE` = `§0§7§r`)
- `DialogueManager.buildDialogueForm`:
  - título = marcador + disposição + nome;
  - corpo = linhas;
  - botões = opções **na mesma ordem** (ou "Continuar"), células vazias e o retrato em `DIALOGUE.PORTRAIT` = 8.
- Disposições:
  - em coluna (`vertical` ou mais de 4 opções);
  - lado a lado com 1 a 4 opções (`DIALOGUE_H1..H4`, centradas como o Java);
  - "continuar" (a caixa inteira é o botão, com a dica "Continuar").
- Opção não selecionável: 3º quadro do botão e texto cinza.
- Retrato (`ActiveDialogue.parseFace`):
  - `artificial` de Pokémon → retrato da espécie;
  - `q.player.face(lado)` → rosto da skin padrão (`textures/entity/steve`, recorte 8×8 + chapéu). O servidor não tem a skin real do jogador;
  - `q.npc.face(lado)` → rosto da skin do NPC (`npcSkinTexture`).
- A página com campo de texto continua no `ModalFormData` da vanilla.
- A barra do prazo (`DialogueTimerWidget`) e o texto aparecendo aos poucos (gibber) não foram portados: o som do gibber continua.

### 6d. Mochila
- `bagItemIcon(typeId)` dá o ícone do item (medicine/berries/battle_items e os caminhos próprios, inclusive `x_defense`/`x_sp_atk`/`x_sp_def`).
- O layout mostra o ícone à esquerda. A dica de captura tem a Poké Bola.

### 7. Inicial em 3D: plataforma no mundo
- Entidade nova `cobblemon:studio_platform` (BP/RP em `entities|entity|models/entity|render_controllers/studio/`):
  - plano de 16×19 (só a face de cima, sem z-fighting);
  - textura `starter_platform_base_<tipo>` pela propriedade `cobblemon:platform`;
  - escala pela `cobblemon:platform_scale`, com `scripts.scale`.
- `Studio.ts`:
  - `StudioSubject.platformType` põe a plataforma 0,01 acima do chão de barreira, debaixo dos pés;
  - escala = 113 px ÷ px por bloco da câmera (`cameraFor` agora devolve `perBlock`);
  - tag `cobblemon_ui_display`, limpa com a sessão, na varredura e como órfã.
- Em 3D, `StarterGUI` não manda a imagem da plataforma. Em 2D ela continua atrás do retrato (camada 3 < 4).
- O resumo e a Pokédex não têm plataforma no estúdio.

## Prévias (`docs/ui-preview/`, `node tools/ui/preview.mjs [--state hover]`)

26 telas, 0 problema:
- `starter`, `starter-3d`;
- `summary-info|moves|stats|marks|info-3d|pc` e `summary-stats-ivs|evs|other|ride` (novos);
- `pc`, `pokedex-list`, `pokedex-entry-caught|seen|unknown`;
- `battle-action|moves|switch|target|bag` e `battle-forfeit` (novo);
- `dialogue-continue|options|vertical` (novos).

Em hover (`--state hover`), as telas da batalha conferidas uma a uma:
- `battle-action-hover`: tiles coloridos com o nome;
- `battle-switch-hover`: retrato, nome e barra visíveis;
- `battle-moves-hover`: nome, PP e categoria visíveis.

## Verificação (2026-09-28)
- `node tools/check-ui-baseline.mjs`: ok contra v1.26.50.4 e v1.26.60.28-preview.
- `gen-telas.ts --check` e `gen-hud.ts --check`: em dia.
- `npx tsc -p tsconfig.json`: 0 erros.
- `npm test`: tudo passa na rodada final. Numa rodada intermediária, `zfight2.test.ts` (frente paralela, `generated/` do importador em andamento) falhou por um momento e depois passou sem mudança desta frente.
- `tests/ui-layout.test.ts`:
  - regra nova: 26 telas × 4 estados;
  - casos negativos: nome coberto pelo hover/pressed, nome só no parado (some no hover e no locked) e nome só no hover.
- `tests/ui-polish.test.ts` (9 casos):
  - camadas dos botões;
  - HUD vazio;
  - prévia do PC;
  - gráfico e modos;
  - plataforma 3D;
  - desistir;
  - ícones da mochila (conferidos no RP);
  - diálogo;
  - Pokédex.
- E2E base (`COBBLEMON_BDS=uip`, porta 19183, `dist-uip`, raknet, sem MSD, `--deploy --rm`): **10/10**.
  - O `06-npc` confere o roteamento `§0§7§r` e responde pelas opções.
  - O `08-pokedex` abre a grade e troca a região pela seta.
  - Na 1ª rodada, o `07-trade` falhou por ambiente: o bot B nasceu no ar, em y 122, morreu de queda e o pedido saiu `unavailable`. Na 2ª rodada, 10/10.
  - Log do BDS sem ERROR/WARN. Container removido.

## Pedidos a outras frentes / notas
1. **Importador** (`tools/importer/guiTextures.ts`): acrescentei 1 import e 1 linha (`emitRadarTextures(OUT_RP)`), para o próximo `npm run import` gerar os setores do gráfico. Até lá eles já estão em `generated/` (escritos por `tools/ui/radar.ts`). Não mexi em `zfight*`, `models` nem `entities` do importador.
2. **cliente-teste3** (`scripts/debug/SelfTest.ts`), editado por esta frente:
   - `samplePcForm` com a prévia completa;
   - `battle-forfeit` com `forfeitForm()`;
   - `starter-3d` com a plataforma;
   - `pokedex_list` abre a grade.
   Sugestão: renomear o texto `cobblemon.selftest.screen.pokedex_list` ("lista de Pokédex") para "grade". Não mexi, pela regra 10.
3. **ui-base** (`server_form.json`, `cobblemon_forms.json`, `_ui_defs.json`): acrescentei o marcador `§0§7§r` (diálogo) e `ui/dialogue.json`.

## Status

| Item | Status |
|---|---|
| 1. Rótulo/ícones em todos os estados (ações, golpes, troca, alvo, mochila, inicial, PC, Pokédex, resumo, diálogo) | FEITO (`ui-layout.test`: 26 telas × 4 estados; prévias `*-hover.png`) |
| 2. Segunda tela de troca | FEITO: mesmo bug do 1 (a troca obrigatória usa o mesmo layout) |
| 3. HUD: espaços vazios | FEITO (`cobblemon_hud.json`, `ui-polish.test`) |
| 4. PC: painel da esquerda | FEITO (selftest com a prévia completa; a prévia segue o último tocado). Hover: NÃO POSSÍVEL (o form do servidor não recebe o cursor) |
| 5. Resumo: gráfico hexagonal + Stats/IV/EV (+ Montar e Outro) | FEITO (`summary-stats*.png`). Hover dos rótulos: NÃO POSSÍVEL |
| 6a. Pokédex sem lista de regiões | FEITO (setas no cabeçalho; E2E 08 troca a região) |
| 6b. Desistir na tela da batalha | FEITO (`battle-forfeit.png`) |
| 6c. Diálogo de NPC com retrato | FEITO (`dialogue-*.png`; E2E 06 confere o roteamento). Campo de texto, barra do prazo e texto gradual: vanilla/N/A |
| 6d. Mochila com ícones | FEITO (`battle-bag.png`) |
| 7. Inicial 3D: plataforma sob o Pokémon | FEITO (entidade `cobblemon:studio_platform`). Conferir no cliente: escala e orientação da textura |
| Troca entre jogadores, conquistas, estatísticas | Sem mudança (vanilla; fora do pedido) |
