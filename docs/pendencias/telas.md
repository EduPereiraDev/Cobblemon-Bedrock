# Pendências da frente "telas" (telas no visual do Cobblemon, estúdio de câmera e scanner)

Pesquisa: [`docs/pesquisa/1-interface.md`](../pesquisa/1-interface.md) §2, §3 e §6, e
[`docs/pesquisa/2-retratos.md`](../pesquisa/2-retratos.md). Infra usada: marcadores e roteador da ui-base
(`scripts/ui/screens.ts`, `ui/cobblemon_forms.json`, `ui/server_form.json`), texturas `textures/gui/cobblemon/**`, barras
`textures/ui/cobblemon/hud/hp_h_NN`, glifos (`scripts/ui/glyphs.ts`) e os retratos/perfis da frente retratos.

## Como funciona

- Cada tela é um `ActionFormData` com título `marcador da tela + sub-marcador do layout + texto`
  (`layoutTitle`, `scripts/GUI/layout.ts`). O JSON UI desenha cada botão numa **posição fixa** pelo `collection_index`
  (padrão da vanilla em `realms_slots_screen.json`): o botão N é sempre a mesma célula. Texto vazio esconde a célula.
- **Sem fatiar strings** nestas telas. O que não é texto vai no **ícone** do botão: retrato/perfil, textura do tile,
  barra por passo (`hp_h_NN`) e a **chave do tipo** (`typeKeyTexture`, um caminho de textura real) que o layout compara
  para pintar o tile de golpe com o `hue` do tipo (18 cópias do tile com `color`).
- Contrato script ↔ pack: `scripts/GUI/layoutSpec.ts` (sub-marcadores e índices, sem imports). Os layouts são **gerados**
  por `tools/ui/gen-telas.ts` (lê o mesmo arquivo; `--check` falha se o versionado estiver velho) com expressões
  literais, `collection_details` em todo clique e as coordenadas do Cobblemon.
- **Estúdio de câmera** (`scripts/ui/studio/Studio.ts`, pesquisa §3.2): espécie spawnada 48 blocos acima do jogador,
  sobre uma barreira temporária, com evento de spawn vazio (sem IA de selvagem) e tag `cobblemon_ui_display`;
  câmera `minecraft:free` + FOV 60 + fade + HUD escondido + visão noturna (se o jogador não tinha). O layout
  "estúdio" (sub-marcador `§2§9§r`) vaza a janela do retrato e fica deslocado para ela cair no centro da tela, onde a
  câmera põe o modelo. Limpeza: ao fechar (`finally`), saída/morte/troca de dimensão, vigia de 1 s, varredura no
  `worldLoad` (entidades com a tag e barreiras anotadas na dynamic property do mundo) e `entityLoad` de órfã.
- **Scanner**: zoom por `camera.setFov` (70→30 em 6 passos; a roda/hotbar vira zoom e o slot volta para a Pokédex) e
  overlay pelo **actionbar** com prefixo `cbS` (2ª `hud_actionbar_text_factory` em `ui/hud_screen.json` →
  `ui/cobblemon_scanner.json`; o actionbar vanilla esconde `cbS`). Agachar + usar liga o modo scanner (mirar 15 ticks
  registra sem abrir a Pokédex); usar de novo, trocar de item, morrer ou mudar de dimensão desliga.

## Status

| # | Item | Status | Prova |
|---|---|---|---|
| 1 | Batalha: tiles Lutar/Mochila/Pokémon/Fugir (`battle_menu_*`, 2 quadros), log com o estado no `battle_log` | FEITO (visual: conferir no cliente) | `ui/battle.json` `action_layout`; sonda: título `§0§2§r§1§1§r`, ícones `battle_menu_fight/bag/switch/run` |
| 1b | Tiles de golpe pintados pelo tipo, PP (dourado ≤ metade, vermelho em 0), categoria, efetividade; voltar | FEITO | `moves_layout` (18 tints por `(#form_button_texture = '<chave>')`); `renderMoveButton`; sonda: 5 células, chave `platform_base_fire` |
| 1c | Alvo (inimigos em cima, aliados embaixo, retrato, %) | FEITO | `target_layout`; `showTargetMenu` mapeia inimigo 0..2, aliado 3..5 |
| 1d | Troca com retratos + barras de HP; alvo de item da mochila no mesmo layout; mochila em grade | FEITO | `switch_layout`/`list_layout`; sonda: retrato `portraits/charmander_0`, barra `hp_h_97`, mochila `§1§5§r`, alvo do Leite Moomoo `§1§4§r` |
| 2 | Resumo: perfil 128 px, abas Info/Golpes/Atributos/Marcas como forms roteados, barras de atributo, tipo/gênero/brilhante (glifos), Poké Ball, item, time à direita (troca o exibido) | FEITO | `scripts/GUI/Summary.ts` (`buildSummaryForm`), `ui/summary.json`; o DDUI saiu (não aceita skin). Sonda: 28 células, `§2§1§r`→`§2§3§r`→`§2§2§r`, barras `hp_h_NN`, tocar no Eevee troca |
| 3 | PC: 6×5 com rostos 32 px, coluna do time (36..41, escolhe espaço do time como na caixa), nome da caixa + setas, papel de parede, prévia do selecionado | FEITO | `ui/pc.json` (layout do PCGUI, contrato da extras-final mantido), `scripts/GUI/PC.ts`. Sonda: 44 células, `portrait_icons/*` no time, prévia `profiles/*` |
| 4 | Inicial: lista de categorias, carrossel ◀ ▶, plataforma do tipo, nome/tipos/descrição, "Eu escolho você!", aleatório | FEITO | `scripts/GUI/StarterGUI.ts` (`buildStarterForm`), `ui/starter.json`. Tocar no nome também escolhe (fluxo do e2e intacto). Sonda: `§0§4§r§3§1§r`, célula 14 = bulbasaur, ▶ → charmander |
| 5 | Pokédex: grade 5×5 com rostos, moldura na cor da Pokédex usada, entrada com perfil na plataforma, nome, tipos, formas vistas, texto rolável (descrição, variações, atributos, drops, spawns) | FEITO | `scripts/pokedex/PokedexUI.ts`, `ui/pokedex.json`. Sonda: `§4§1§r` 32 células, `pokedex_base_blue`, entrada `§4§2§r` com perfil + `platform_base_fire` + `caught_icon` |
| 6 | Estúdio de câmera (modelo 3D ao vivo) no inicial (padrão 3D) e no resumo (botão 3D/2D, lembrado por jogador) | FEITO (enquadramento: conferir no cliente) | `scripts/ui/studio/Studio.ts`; sonda: entidade com a tag existe com a tela aberta, troca de espécie mantém 1 entidade, 0 entidades depois de escolher/fechar/voltar ao 2D; 7 `camera_instruction` (fade + set free) |
| 6b | Estúdio na evolução | NÃO FEITO (pedido abaixo) | a cena de evolução é de `scripts/evolution` (outra frente); a API está pronta |
| 7 | Scanner: zoom (`setFov`) + overlay + modo scanner | FEITO (visual: conferir no cliente) | `ScannerZoom.ts`, `PokedexItem.ts`, `ui/cobblemon_scanner.json`. Sonda: actionbar `cbS…` durante o escaneamento, 2 instruções de FOV (zoom e `fov_clear`), entrada aberta no fim; agachar+usar liga, usar desliga |
| — | Ganchos pedidos pela ui-base | FEITO / N/A | `reel_in` na pesca (`FishingController.catchPokemon`, isca `b.bait.item`); `pokemon_interact` no uso bem-sucedido de item (`items/usage.ts` `finishUse`); `/cobblemon:partyhud [enabled] [overlay|text]`; `/cobblemon:advancements`; descrição de `party_hud_default_on` (en_US/pt_BR, linhas 66). `riding_stat_boost`: **N/A** — o port não aplica ride boosts (`items/food.ts`: "Sem montaria no port: a Aprijuice é só bebida"; `entity/Riding.ts`: "stats por ride boost ... não existem aqui") |
| — | Tela de conquistas em árvore (`SCREEN.ACHIEVEMENTS`) | NÃO FEITO | fora das 7 entregas; continua a lista da ui-base |

### Arquivos

- Novos: `scripts/GUI/layoutSpec.ts`, `scripts/GUI/layout.ts`, `scripts/ui/studio/{Studio,ScannerZoom,index}.ts`,
  `tools/ui/gen-telas.ts`, `resource_packs/CobblemonBedrock/ui/{summary,starter,pokedex,cobblemon_scanner}.json`,
  `tests/telas.test.ts`.
- Reescritos/gerados: `ui/battle.json`, `ui/pc.json`; `scripts/GUI/{Battle,Summary,StarterGUI,PC,common}.ts`,
  `scripts/pokedex/{PokedexUI,PokedexItem}.ts`.
- Pequenas edições: `scripts/main.ts` (estúdio: não iniciar dados na entidade de exibição, remover órfãs, `startStudio`),
  `scripts/commands.ts`, `ui/{_ui_defs,cobblemon_forms,server_form,hud_screen}.json`, `scripts/ui/screens.ts`
  (`ROUTED_SCREENS` + resumo/inicial/Pokédex, como a ui-base pediu), ganchos em `scripts/fishing/FishingController.ts` e
  `scripts/items/usage.ts`, `tests/mocks/minecraft-server.ts` (só exports novos: `HudElement`, `HudVisibility`,
  `EasingType`), seção `## telas` no fim dos `.lang`.
- Robustez: todo `form.show` das telas trata `FormRejectError` (jogador saiu com a tela aberta) como "fechado" — some o
  `Battle menu error` e o `Unhandled promise rejection` que apareciam no log.

## Verificação (2026-09-26)

- `npx tsc -p tsconfig.json`: 0 erros. `npm test`: todos passam (inclui `tests/telas.test.ts`: sub-marcadores sem
  colisão com os marcadores de tela, layouts em dia com o gerador, toda célula filha de painel com `collection_name`,
  bindings view com `#propriedade` e sem `$variável`, cliques com `collection_details`, texturas estáticas existentes,
  montagem pura dos forms do resumo/inicial, `findStage`/`cameraFor`, zoom).
- `node tools/check-ui-baseline.mjs`: ok contra v1.26.50.4 e v1.26.60.28-preview. `gen-telas.ts --check`: em dia.
- Carga do bundle com mocks (esbuild de `scripts/main.ts`): sem erro de avaliação de módulo (a tabela no topo do
  `Summary.ts` que quebrava por ciclo de imports virou função/literal).
- BDS próprio (`telas`, 19149, `dist-telas`): `scripts carregados em ~410 ms`, **nenhum ERROR/WARN desta frente**
  (só `[spawn] passe lento`, da frente spawn, e o banner de transporte raknet). Sonda de protocolo
  (`scratchpad/telas_probe.mjs`, Node 24): **50/50 verificações** — inicial, resumo, PC, Pokédex, scanner e batalha
  com os marcadores, índices e ícones certos e o estúdio criado/limpo. Container removido no fim.
- Observação: num mundo **novo** gerado com `dist-telas` o bot nunca recebeu `player_spawn` (7 min); o mesmo mundo
  gerado antes com `dist-e2e` spawnou em ~43 s e depois funcionou com `dist-telas`. Não é das telas (nada daqui roda
  antes do spawn); vale o orquestrador conferir geração de mundo nova com o build atual.

## Validação que só dá no cliente (o BDS não carrega UI)

1. `collection_index` em células dentro de painéis com `collection_name: form_buttons` num form de servidor (padrão
   vanilla de `realms_slots_screen.json`); cliques chegam com o índice certo.
2. `common.button` com `bindings` próprios (`collection_details`) e controles `hover`/`pressed` com imagem ligada ao
   ícone do botão (uv do 2º quadro).
3. Pintura por tipo: 18 imagens com `color` e visibilidade por `(#form_button_texture = '<caminho>')`.
4. Enquadramento do estúdio (FOV 60, `fraction`/`ny` em `FRAMING`): o modelo cai dentro da janela vazada em 16:9 e
   4:3 e com escalas de GUI diferentes; luz à noite (visão noturna) e no Nether (sem estúdio → 2D).
5. `camera.setFov`/`fov_clear` restauram o FOV do jogador; `hideAllExcept([])`/`resetHudElementsVisibility` com o HUD da ui-base.
6. Overlay do scanner: `$scan_text: "($actionbar_text - 'cbS')"` e `visible` com variável no controle criado pela
   2ª fábrica do actionbar; `destroy_at_end` some em 1,5 s; o actionbar vanilla não mostra `cbS…`.
7. Texto nas células (escala 0,45–0,8): legibilidade no Switch/celular; ordem de foco com controle.
8. Hover/foco nas células vazias do PC (espaço vazio clicável como destino).

## Pedidos

### e2e (`tests/e2e/scenarios/05-pc.e2e.mjs`)

- A tela da caixa agora tem **44 botões** (6 de navegação + 30 espaços + 6 do time + prévia 42/43; sem time, 42):
  trocar `box.buttons.length === 36` por `>= 36` (ou `=== 44` com time).
- `pcSprite` procura `textures/sprites/<espécie>`: os espaços usam o rosto 32 px `textures/cobblemon/portrait_icons/<espécie>_<n>`
  (e o `partyMembers` já lê a espécie pelo texto). Sugestão: `/portrait_icons\/${species}_\d+$/`.
- Os demais cenários continuam (inicial: a 1ª tela já é o carrossel, mas "Kanto" → "Bulbasaur" → confirmação segue
  funcionando; batalha: títulos com marcadores, botões iguais; Pokédex: lista de Pokédex sem layout).

### batalhas (`scripts/battle/BattleActor.ts:420`)

- Opcional: `Battle menu error` com `console.error` para jogador que saiu. As telas agora devolvem "fechado" nesse caso,
  então o erro não aparece mais; se outro caminho rejeitar, rebaixar para `console.warn`.

### jogabilidade / evolução (`scripts/evolution/EvolutionEffect.ts`)

- Estúdio na cena de evolução (Cobblemon mostra as duas formas com flash): `import { openStudio, setStudioSubject,
  closeStudio, FRAMING } from "../ui/studio"`; `openStudio(player, antes, FRAMING.starter)` → no clímax
  `player.camera.fade({ fadeColor: { red: 1, green: 1, blue: 1 }, ... })` + `setStudioSubject(player, depois)` →
  `closeStudio(player)` no fim (retorno `false` = sem espaço: manter o efeito atual).

### orquestrador

- `docs/pesquisa/ALVOS.md`: "Tela de batalha fiel", "Summary", "PC", "Starter", "Pokédex", "scanner zoom/overlay" e
  "modelo 3D nas telas" podem passar a "FEITO (conferir visual no cliente)", apontando para esta página.
