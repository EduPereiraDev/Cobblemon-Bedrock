# Pendências da frente "ui-base" (infra de interface: texturas de GUI, glifos, roteamento de forms, HUD, conquistas)

Arquivos da frente: `resource_packs/CobblemonBedrock/ui/{_ui_defs,server_form,hud_screen,cobblemon_forms,cobblemon_hud}.json`
(e o `'Battle:'` → marcador em `ui/battle.json`), `resource_packs/CobblemonBedrock/font/**` (a E0 saiu),
`scripts/ui/**`, `scripts/GUI/PartyHud.ts`, `tools/importer/{guiTextures,advancements}.ts` (+ 4 linhas em
`tools/importer/index.ts`), `tools/ui/gen-hud.ts`, `tools/check-ui-baseline.mjs`, `tests/ui-base.test.ts`, `glyph_key.txt`,
seção `## ui-base` dos `.lang`. Troca de título (marcador) em `scripts/GUI/PC.ts` e `scripts/GUI/Battle.ts`; glifos em
`scripts/language/index.ts` e `scripts/GUI/Battle.ts` (`categorySymbols`, que estava vazio).

## Status por item

| # | Item | Status | Prova / observação |
|---|---|---|---|
| 1 | Texturas de GUI do Cobblemon no RP | FEITO | `tools/importer/guiTextures.ts`: 735 PNG de `assets/cobblemon/textures/gui/**` → `textures/gui/cobblemon/**` (os 51 de `pc/wallpaper` continuam em `textures/gui/pc/wallpaper`, de `wallpapers.ts`) = 786. Mais 237 texturas derivadas em `textures/ui/cobblemon/hud/` (HP/EXP por passo de 1 px, molduras de toast). `npm run import` → contagem no `import-report.json`. |
| 2 | Glifos fora da página E0 | FEITO | `font/glyph_E0.png` (cópia da vanilla com os tipos) apagado; `font/glyph_E2.png` (18 tipos, 3 categorias, ♂/♀, brilhante, capturado) e `glyph_E3.png` (48 Poké Balls) gerados de `scripts/ui/glyphs.ts` + texturas do Cobblemon. `typeSymbols`/`moveCategorySymbols` (language) e `categorySymbols` (Battle.ts) usam `TYPE_GLYPHS`/`CATEGORY_GLYPHS`. Teste confere que nenhum script usa U+E0xx. `glyph_key.txt` regenerado. |
| 3 | Roteamento de forms por marcador + sem redeclarar telas vanilla | FEITO (conferir visual no cliente) | `scripts/ui/screens.ts`: `SCREEN.PC = §0§1§r`, `BATTLE = §0§2§r`, `SUMMARY/STARTER/POKEDEX/ACHIEVEMENTS` reservados; `withScreen()`. `ui/server_form.json` só com `modifications` (2ª fábrica `server_form_factory` → `cobblemon_forms.router`; `long_form` vanilla escondido só para marcadores com layout). "PCgamer" (nome de jogador/caixa/tradução com "PC") não cai mais na grade. `tools/check-ui-baseline.mjs` ok contra bedrock-samples v1.26.50.4 e v1.26.60.28-preview. |
| 4a | HudBus (canal título, ≤1 título/tick/jogador, fila/prioridade) | FEITO | `scripts/ui/HudBus.ts` + `hudProtocol.ts` (larguras fixas em bytes UTF-8, sem TextEncoder). Prioridade batalha > toast > party; só reenvia o que mudou; reenvio de segurança a cada 10 s, no respawn e ao trocar de dimensão. Bot E2E: 0 pares de títulos do HUD < 20 ms. |
| 4b | Party overlay (esquerda, 6 slots, retrato, HP/EXP verticais, status, gênero, bola, selecionado +6 px, desmaiado, vazio) | FEITO (conferir visual no cliente) | `scripts/ui/PartyOverlay.ts` + `ui/cobblemon_hud.json` (gerado por `tools/ui/gen-hud.ts`). Retrato: `portraitTexture()` de `generated/scripts/portraits.ts` (frente retratos) com reserva no sprite. Pop-up de evolução disponível / golpe novo ao lado do slot (3 s). Bot E2E decodificou o título real do BDS (Pikachu/Eevee, nível, HP, gênero, bola, slot selecionado). Estilo texto antigo na actionbar mantido (`party_hud_style = "text"`). |
| 4c | HUD de batalha (caixas dos dois lados, HP barra/texto, status, nível, gênero, capturado, nomes dos treinadores, 1v1–3v3) | FEITO (conferir visual no cliente) | `scripts/ui/BattleHud.ts` (lê `battleMap` a cada 2 ticks, só leitura). HP do próprio Pokémon em "atual/máx", do oponente em "NN%" (BattleOverlay). Espectadores veem o lado 1 à esquerda. |
| 4d | Toasts | FEITO | `scripts/ui/Toast.ts`: fila por jogador, 5 s, moldura/cor por tipo (task/goal/challenge). `captureToast`/`evolutionToast` existem como API mas NÃO são disparados automaticamente: o Cobblemon 1.8.2 não tem toast de captura nem de evolução (usa chat e o pop-up do slot, que foi feito). Bot E2E: toast de `root_catching` apareceu e sumiu. |
| 5 | Conquistas (61 advancements não-receita) + toast + chat + tela | FEITO (com 2 critérios dependentes de gancho) | `tools/importer/advancements.ts` → `generated/scripts/advancements.ts` (critérios normalizados, tags de item expandidas, ícones). `scripts/ui/achievements/{engine,tracker,screen}.ts`: mesma semântica das classes `advancement/criterion/*.kt` (inclusive a regra estranha do `LevelUpCriterion`). Toast se `show_toast`, chat para todos se `announce_to_chat` (as duas raízes com `false` ficam quietas). Tela: `openAchievements(player)` (abas → lista → detalhe, visibilidade do Java). Bot E2E: `give poke_ball` → `root_catching` com toast e chat. Sem gancho, NÃO avançam: `max_ride_stats` (riding_stat_boost) e `use_poke_bait` (reel_in) — pedidos abaixo. |
| 6 | Slot selecionado da party | FEITO | `scripts/ui/PartySelection.ts`: `getSelectedSlot`, `setSelectedSlot`, `cycleSelectedSlot` (ClientStorageManager.shiftSelected, segue o UUID), `getSelectedPokemon`, `onSelectionChanged`. Compatível com `scripts/pokemon/PartySelection.ts` (jogabilidade): mesma dynamic property numérica `cobblemon:selected_slot`; o UUID fica em `cobblemon:selected_uuid`. Bot E2E: `/cobblemon:selectslot 2` → HUD mostra o slot 2 como selecionado. |
| — | CI de UI | FEITO | `node tools/check-ui-baseline.mjs [--tag vX]`: JSON válido, arquivos vanilla só com modifications, âncoras vanilla, referências `@ns.elemento`, bindings view com `#propriedade` e `source_control_name` existentes, texturas (estáticas e famílias dinâmicas), glifos, `cobblemon_hud.json` em dia com o gerador. Baixa o bedrock-samples (git sparse) em `node_modules/.cache` ou usa `$BEDROCK_SAMPLES`. |

### Verificação (2026-09-26)

- `npx tsc -p tsconfig.json`: 0 erros (projeto inteiro). `npm test`: todos passam (inclui `tests/ui-base.test.ts`, que
  decodifica o título interpretando as expressões do `cobblemon_hud.json` gerado).
- `node tools/check-ui-baseline.mjs`: ok contra v1.26.50.4 e v1.26.60.28-preview.
- BDS próprio (`ui-base`, porta 19141): nenhum ERROR/WARN desta frente. Bots de protocolo (sonda descartável baseada em
  `tests/e2e/lib`, não versionada) confirmaram no servidor real: título `cbHP` com Pikachu/Eevee e retratos
  `cobblemon/portraits/*_0`, seleção via `/cobblemon:selectslot`, toast + chat de `root_catching`, HUD de batalha PvP
  (Pikachu "49/49" à esquerda, Onix "100%" à direita, nomes dos treinadores) e HUD escondido após `/cobblemon:stopbattle`;
  nenhum par de títulos do HUD a menos de 20 ms. Os `Battle menu error: FormRejectError: Player quit` do log vêm dos bots
  saindo com o menu da batalha aberto (Battle.ts registra como ERROR; sugestão para a dona da batalha: rebaixar para aviso).
  O container caiu várias vezes por OOM do Docker (várias frentes ao mesmo tempo), não por script.

### Pedido E da jogabilidade (docs/pendencias/jogabilidade.md) — atendido

1. HUD marca o selecionado lendo a mesma `cobblemon:selected_slot` e redesenha em `onSelectedSlotChanged` (PartyHud.ts). FEITO.
2. `GUI/Party.ts` (item segurado): recusa `isForbiddenHeldItem` com `FORBIDDEN_HELD_ITEM_LANG`. FEITO.
3. `GUI/Summary.ts`: saciedade (`getFullness/getMaxFullness`), passos (só com `hasBlocksTraveledRequirement`) e estoques do Gimmighoul. FEITO.
4. `GUI/StarterGUI.ts`: `getStarterCategories()` usa `sortStarterCategories`. FEITO.
5. `setAdvancementLookup`: requisito `advancement` consulta as conquistas reais (ids desconhecidos caem na Progresso). FEITO (em `startUiBase`).

### Diferenças conhecidas (não dá para fazer só com JSON UI/forms, ou fica para a frente "telas")

- Retrato animado (modelo 3D) no HUD: NÃO POSSÍVEL no HUD (nenhum renderer de entidade vinculável); usamos o retrato 2D.
- Party: sem ícone do item segurado, sem texto "+N EXP" e sem animação de level up; sem ícone de estado (ombro/montado).
- Batalha: sem a faixa colorida do ator ("role"), sem deslizar as caixas na entrada e sem opacidade reduzida quando minimizada.
- Tela de conquistas em árvore com fundo por aba: lista funcional agora; o layout em árvore é da frente "telas" (marcador `SCREEN.ACHIEVEMENTS` já no título).
- Nomes no HUD: nome da espécie do `species.ts` (igual em en_US e pt_BR, salvo erros de digitação do próprio pt_BR do Cobblemon) ou o apelido; sem tradução no cliente.
- Toasts do inicial/tutorial da party do Cobblemon (dependem de teclas): N/A no Bedrock.

### Validação que falta (só dá no cliente; o BDS não carrega UI)

1. `('%.Ns' * X)` conta bytes UTF-8 (pesquisa §1.3c). Se contar caracteres, só campos depois de um nome acentuado deslocam.
2. `hud_title_text` com `bindings` esconde o título vanilla sem piscar o fundo.
3. `stack_panel` recolhe filhos invisíveis (recuo de 6 px do slot selecionado e de 4 px por posição na batalha).
4. `modifications` em `long_form` (bindings) e a 2ª `server_form_factory` (padrão da wiki) — PC e batalha continuam com o layout.
5. Custo de frame: ~530 bindings no HUD (6 slots + 6 caixas + toast) em console/Switch.

## Pedidos

### main.ts (orquestrador)

Nada obrigatório: `startPartyHud()` (já chamado no `worldLoad`) liga HudBus, HUD de batalha, toasts e conquistas
(`startUiBase()` de `scripts/ui`). Se preferir explícito: `import { startUiBase } from "./ui";` e `startUiBase();` no `worldLoad`.

### jogabilidade (`scripts/Config.ts`, `scripts/commands.ts`, `scripts/pokemon/PartySelection.ts`, evolução)

1. `Config.ts`: no estilo overlay o HUD vem ligado (como no Cobblemon); `partyHudDefaultOn` passou a valer só para o estilo
   texto. Atualizar a descrição do campo (ex.: "Party HUD (texto na actionbar) ligado por padrão").
2. `commands.ts`: `/cobblemon:partyhud` ganhar um argumento de estilo: `setPartyHudStyle(player, "overlay" | "text")`
   (exportado de `scripts/GUI/PartyHud.ts`).
3. `commands.ts`: comando para a tela de conquistas: `import { openAchievements } from "./ui";` →
   `/cobblemon:advancements` → `openAchievements(player)` (ou um botão no menu do time/Pokédex).
4. `scripts/pokemon/PartySelection.ts`: `cycleSelection` pode usar `cycleSelectedSlot(player, step > 0)` de `scripts/ui`
   (segue o UUID como o Cobblemon); e `showSelection` (actionbar) é redundante quando o overlay está ligado
   (`getPartyHudStyle(player) === "overlay" && isPartyHudOn(player)` → não mostrar).
5. TMs `PlayerHasAdvancementObtainMethod` (se existir no port): `hasAchievement(player, "catching/first_catch")` de `scripts/ui`
   (o requisito de evolução `advancement` já foi ligado por `setAdvancementLookup`).

### mundo-sons (`scripts/fishing`, `scripts/items`, `scripts/machines`)

Todos opcionais exceto o 1 (o rastreio já tem detecção somente leitura para os outros; o gancho deixa exato):

1. **Pesca** (obrigatório para `use_poke_bait`): ao puxar um Pokémon com a vara,
   `recordAchievementEvent(player, { type: "reel_in", bait: "<id da isca, ex. cobblemon:poke_bait>", species: "<espécie sem namespace>" })`.
2. `scripts/items/usage.ts`: ao aplicar com sucesso um item num Pokémon (balas, mentas, reviver, poções),
   `recordAchievementEvent(player, { type: "pokemon_interact", item: stack.typeId, species })` (hoje: item "armado" que sai do inventário).
3. `scripts/machines/pasture.ts`: ao prender um Pokémon, `recordAchievementEvent(player, { type: "pasture_use" })` (hoje: leitura a cada 10 s).
4. `scripts/machines/fossils.ts`: ao reviver, `recordAchievementEvent(player, { type: "resurrect", species })` (hoje: diferença do time).
5. `scripts/machines/tm.ts` (`learnTMs`): para cada TM novo `{ type: "learn_tm", tm: move }` e, se todos, `{ type: "learn_all_tm" }` (hoje: leitura a cada 10 s).

### motor / jogabilidade (montaria)

- Aprijuice/boost de montaria (`max_ride_stats`): quando os stats de montaria mudarem,
  `recordAchievementEvent(player, { type: "riding_stat_boost", allMax: <todos no máximo>, anyMax: <algum no máximo> })`.

### social (`scripts/trade/TradeManager.ts`)

- Opcional (hoje: diferença do time + contador da Progresso): na troca concluída, para cada jogador,
  `recordAchievementEvent(player, { type: "trade", traded: "<espécie dada>", received: "<espécie recebida>" })`.

### telas (onda 2)

- Layouts novos: `withScreen(SCREEN.SUMMARY | STARTER | POKEDEX | ACHIEVEMENTS, título)`, filho no
  `ui/cobblemon_forms.json` (`router`), marcador na condição do `long_form` em `ui/server_form.json` e em `ROUTED_SCREENS`
  (o teste `tests/ui-base.test.ts` e o `check-ui-baseline` conferem).
- Texturas: `textures/gui/cobblemon/<pasta do Cobblemon>/<arquivo>`; barras prontas em `textures/ui/cobblemon/hud/hp_{v,h,hr}_NN`.
- HUD: novos canais pelo `setHudChannel(player, canal, corpo)`; campos em `hudProtocol.ts` e desenho em `tools/ui/gen-hud.ts`
  (rodar `node --experimental-strip-types tools/ui/gen-hud.ts`).

### todas as frentes

- Glifos: `typeGlyph`, `categoryGlyph`, `ballGlyph`, `GLYPH_MALE/FEMALE/SHINY/OWNED` de `scripts/ui/glyphs.ts`. Não usar U+E0xx (é da vanilla).
- Títulos de HUD: não chamar `onScreenDisplay.setTitle` com texto que contenha `cbH` (é do protocolo e fica invisível).
