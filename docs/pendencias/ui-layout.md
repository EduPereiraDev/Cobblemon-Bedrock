# Frente ui-layout (3º teste em cliente real: telas renderizam, mas o layout não bate com o Java)

Sintomas do usuário, com prints:
- inicial: ícone de tipo por cima do nome e pontinhos encavalando;
- resumo, aba Info: todos os campos num bloco de texto corrido por cima das caixas, e as caixas de baixo vazias;
- resumo: os 6 espaços do time vazios em todas as abas;
- resumo, aba Marcas: caixas vazias;
- Pokédex, entrada: só um "???" solto à esquerda.

## Causas-raiz (com evidência)

| # | Sintoma | Causa | Evidência |
|---|---|---|---|
| 1 | Ícones enormes por cima de nomes (tipo no inicial, ♀ no resumo, tipo/categoria nos golpes) | Os campos usavam glifos de página própria (U+E2xx, página 512 px, célula de 32 px) dentro do texto. O cliente desenha o glifo com 32 px × `font_scale_factor`: são 24 px a 0,75 e 19 px a 0,6, contra 7,5 px da linha. | Print 9.webp: o ♀ tem 88 px na tela, e o painel de 211 px ocupa 907 px (4,3 px por px de GUI). Isso dá 20,5 px de GUI para um ícone de 27/32 da célula a 0,75, ou seja, célula = 32 × escala. O "Pikachu" (7 px × 0,75) bate com a mesma escala. |
| 2 | Aba Info corrida e desalinhada; caixas de baixo vazias | A aba era um único rótulo `#form_text` (tamanho `[122, "default"]`, cresce para baixo) com 13 linhas `rótulo: valor`. O Java desenha 6 linhas de 15 px (rótulo em x 8, valor em x 53), o ícone de tamanho, a descrição da habilidade e os valores de EXP nas caixas de baixo. | `InfoWidget.kt`/`InfoOneLineWidget.kt` × `gen-telas.ts` antigo, `info: tabPanel(... body ...)`. |
| 3 | Time vazio no resumo | Fora do time, o `showSummary` passava `party: undefined` e nenhuma célula aparecia. O selftest abre o resumo com um Pokémon de exemplo. O Java abre o resumo do PC com `Summary.open(listOf(pokemon))`, e o próprio Pokémon aparece no painel. | `Summary.ts`: `party: inParty ? team : undefined`. A prévia com o time mostra os 4 espaços; sem o time, 0. |
| 4 | Marcas: caixas vazias | O layout só punha ícones das marcas obtidas. O `MarksWidget` desenha sempre a grade de 30 espaços (6×5, `summary_mark_slot`), o ícone da marca escolhida em x 12, y 12, a descrição em x 38 e o título. | `MarksWidget.kt`/`MarksScrollingWidget.kt`. |
| 5 | Pokédex, entrada: só "???" à esquerda | O port trocava a tela inteira: a lista sumia e o corpo da entrada ia para a esquerda. Para espécie não vista, o corpo é "???". O `PokedexGUI` é uma tela só: a grade fica à esquerda e a entrada aparece à direita com abas. | `PokedexGUI.kt` (`EntriesScrollingWidget` em x 26, y 39; `PokemonInfoWidget` em x 180, y 28; abas em y 181,5). |
| 6 | Textos longos invadindo o vizinho | Os rótulos tinham tamanho fixo e nenhum corte. No Bedrock, o texto que passa da largura quebra em mais linhas e desce sobre o campo de baixo. | Prévia do layout antigo: "Choque do Trovão" em 3 linhas por cima do tile de baixo. |

## Ferramentas novas (sem cliente)

- **`tools/ui/layoutScene.mjs`**: interpreta o subconjunto de JSON UI que o gerador usa e monta a cena com os dados de um form (título, corpo, botões):
  - `@base`, âncoras, `%`, `100%c` e `default`;
  - bindings `collection`/`view` com `not`/`and`/`or`/`=`/`-`/`+`;
  - `collection_index`, `clips_children`, `common.scrolling_panel` e grade da mochila.

  Métricas medidas nos prints: linha de 10 px × escala, avanço dos caracteres da fonte do Minecraft, glifo de página com 32 px × escala.

  `checkScene` acusa:
  - texto ou ícone por cima de outro texto ou ícone;
  - texto que não cabe no rótulo;
  - rótulo sem largura máxima;
  - janela de uma linha em que as linhas anteriores quebram.

  Corte proposital vira `AVISO`.
- **`tools/ui/previewFixtures.ts`**: monta cada tela com o código do jogo, com a API trocada pelos mocks dos testes:
  - inicial;
  - resumo, nas 4 abas, no estúdio e fora do time;
  - PC com Pokémon na caixa;
  - Pokédex, com a lista e as entradas capturada, vista e nunca vista;
  - batalha: uma batalha selvagem de verdade no mundo falso, gravando os menus ação/golpes/troca/mochila, além do alvo em duplas.

  Os textos são traduzidos com o `.lang` pt_BR.
- **`tools/ui/preview.mjs`**: gera a prévia visual, `node tools/ui/preview.mjs [--outline] [--no-battle] [tela...]`. Desenha em PNG com as texturas de `resource_packs/` e `generated/` e grava em **`docs/ui-preview/<tela>.png`**, junto com o `.json` dos textos do form. Os PNGs não são versionados (`docs/ui-preview/.gitignore`): são regeneráveis em cerca de 2 s e ocupam MBs por rodada.
- **`tools/ui/javaFields.mjs`**: relaciona 84 campos do Java (com a coordenada do código Kotlin) ao elemento do layout que os desenha.
- **`tools/ui/layoutRules.mjs`**: lista os pares que podem se sobrepor de propósito: modelo sobre a plataforma, "?" sobre a plataforma e brilho do papel de parede.
- **`tests/ui-layout.test.ts`**:
  - roda o checador nas 18 telas e exige 0 erro;
  - confere os 84 campos: existem, estão visíveis, têm conteúdo e ficam na posição do Java (±1,5 px);
  - na aba Info, exige uma célula por campo e o corpo só com a descrição;
  - nenhum glifo de página no texto das telas roteadas;
  - tile de golpe com 3 linhas;
  - caso negativo: acusa o corpo corrido, o rótulo sem largura e o glifo alto.

## O que mudou, por tela

### Inicial (`starter.json`, `StarterGUI.ts`)

Segue o `StarterSelectionScreen`:
- nome na aba de cima, com a bola (x 4 e x 14, y 2);
- número `#0004` em x 79;
- título "Escolha um Inicial" centrado em x 172, y 11;
- tipos como ícone (`types.png`) centrado em x 65, y 120, com o espaçador simples. Com dois tipos, os dois ícones ficam em x 48,5 e 63,5, como o `TypeIcon`;
- Poké Ball de fundo (x 10,5, y 12,5) e base da plataforma (x 8,5, y 88);
- descrição em x 8, y 143, 114 px, cortada em 5 linhas;
- X da vanilla no canto de baixo (ExitButton do Java em x 210, y 181).

Os índices mudaram:
- `STARTER.TYPE2` = 22;
- `STARTER.DEX_NUMBER` = 23;
- `COUNT` = 24;
- `STARTER.TYPES` agora leva o texto `single`/`double` e o ícone = chave do tipo.

**Conferir:** "Charmander" inteiro na aba de cima, com #0004 ao lado. Ícone do tipo entre os pontinhos, sem cobrir nada. Com Bulbasaur, dois ícones (planta e veneno).

### Resumo (`summary.json`, `Summary.ts`)

**Cabeçalho** (Summary.kt):
- "Nv. 30" em x 6, y 4,5, com a bola embaixo (x 3,5, y 15);
- status (x 34, y 4, pílula `battle_status_*` + texto);
- apelido (x 12, y 14,5) com o gênero em ícone (`party_gender_*`) em x 69;
- brilhante (`icon_shiny`) em x 62,5, y 33,5;
- markings em y 102;
- nome do item no lugar do rótulo "Item segurado" (x 24, y 114,5);
- tipos como ícones no espaçador (x 5,5, y 126), centrados em x 39;
- X em x 306, y 139.

A linha de PV saiu do cabeçalho e foi para a aba Atributos, como no Java.

**Aba Info**:
- rótulos fixos (chave de tradução, o cliente traduz) em x 8 e valores em células próprias em x 53, nas 6 caixas: Nº Dex (0025), Espécie, Tipo, TO, Natureza, Habilidade;
- ícone de tamanho (x 107,5, y 6,5);
- descrição da habilidade (x 8, y 94,5, 3 linhas);
- Pontos de exp. e Exp. p/ próximo nv. nas caixas de baixo à direita, com os valores alinhados em x 127;
- barra de EXP azul em passos (x 72, y 131);
- na caixa de baixo à esquerda, linhas do port sem lugar no Java: forma, item cosmético, passos, moedas e o Tera/Gigantamax da extensão.

Amizade e saciedade continuam na aba Atributos.

**Time** (PartyWidget em x 216, y 24):
- rótulo "Equipe" (lang `cobblemon.ui.party`);
- espaços nas posições do Java (x 222/273, y 31 + 32·n + 8 nos ímpares) com rosto, "Nv.30", nome, gênero e barra de HP de 37 px;
- o escolhido com o quadro realçado;
- fora do time, o próprio Pokémon no 1º espaço.

**Aba Golpes** (MovesWidget):
- tiles em x 13, y 6 + 25·i;
- ícone do tipo em x 2, nome em x 28, barra de PP com a categoria (ícone de `categories.png`) e PP centrado;
- embaixo, Poder/Precisão/Efeito com ícones e valores à direita;
- descrição rolável em x 69, y 113.

**Aba Atributos**: linhas a cada 16 px e, abaixo, PV atual, EVs, amizade e saciedade, acima da linha pontilhada.

**Aba Marcas** (MarksWidget):
- grade 6×5 de espaços sempre desenhada;
- marcas nos primeiros espaços, com a escolhida realçada;
- ícone e descrição da escolhida em cima e o nome do Pokémon centrado (y 38).

Novos índices:
- `SUMMARY.TYPE2` = 34, `SHINY` = 35, `STATUS` = 36;
- `PARTY_NAMES` = 37 a 42, `PARTY_BARS` = 43 a 48, `EXTRA` = 49 e 50;
- `COUNT` = 51;
- mapas `SUMMARY_INFO`, `SUMMARY_MOVES` e `SUMMARY_MARKS` em `layoutSpec.ts`.

**Conferir:**
- aba Info: cada valor dentro da sua caixa escura/clara, sem texto por cima das bordas;
- caixas de baixo com "Pontos de exp." e "Exp. p/ próximo nv." à esquerda e o número à direita;
- time com 1 a 6 espaços preenchidos em todas as abas (no selftest, com o Pikachu);
- Marcas com a grade de espaços cinza;
- golpes: "Choque do Trovão" inteiro numa linha e o PP em "15/15" na barra escura.

### Pokédex (`pokedex.json`, `PokedexUI.ts`)

**Lista e entrada numa tela só, como o PokedexGUI.** Os dois modos mostram:
- o cabeçalho: globo + região (x 36, y 14), vistos e capturados com os ícones (x 252/262 e 290/300);
- a barra de busca (x 26, y 28);
- a grade 5×5 (x 26, y 39) com o rosto de quem já foi visto, "?" (`pokedex_slot_unknown`) de quem não foi e o número;
- setas de página na coluna da barra de rolagem;
- a barra de filtro (x 26, y 180).

**Entrada**:
- a mesma grade, com a entrada realçada (`slot_select`) e "Voltar" na barra de baixo;
- à direita:
  - `#0025 Pikachu` (x 183, y 29) e o ícone de capturado (x 309);
  - barra de tipos (y 42) com os ícones (x 183);
  - forma à direita, com setas quando há mais de uma vista;
  - janela do retrato com a Poké Ball e a plataforma do tipo (x 193, y 94);
  - texto da aba (x 189, y 138, rolável);
  - 6 abas-ícone (x 190,5 + 22·i, y 181,5): Descrição, Habilidades, Tamanho, Atributos, Drops e Golpes (Move Dex), com a seta na ativa.

Cada aba mostra só a sua parte, como o Java:
- descrição + variações;
- habilidades com a descrição;
- altura/peso;
- atributos base + montaria;
- drops + onde aparece.

Drops e golpes abrem com a forma vista. O resto pede captura.

**Não vista**: plataforma sem tipo e o "?" (`platform_unknown`), o número com "???" e nada nas abas.

Índices: `POKEDEX_LIST.REGION/SEEN/CAUGHT` = 32 a 34 (`COUNT` = 35). `POKEDEX_ENTRY` foi refeito (`COUNT` = 48, grade em 18 a 42, abas em 12 a 16, golpes em 17).

**Conferir:**
- abrir uma entrada e ver a grade continuar à esquerda;
- tocar em outro espaço da grade troca a entrada;
- as abas trocam o texto de baixo;
- espécie nunca vista mostra o "?" grande.

### PC (`pc.json`, `PC.ts`)

**Painel da esquerda campo a campo**, como o PCGUI:
- "Nv." (x 6, y 1,5) com a bola;
- nome com gênero (x 12, y 11,5), sem repetir o nível;
- brilhante;
- item (x 24, y 108,5);
- tipos pequenos (`types_small`) no espaçador (x 9, y 118,5);
- caixa de informação (`info_box`, x 9, y 128) com Natureza, Habilidade e Golpes, com rótulo e valor nas linhas da caixa.

Tocar na caixa troca a página: IVs e depois EVs, como as páginas de atributos do PCGUI.

Novos índices:
- `PC.PREVIEW_LEVEL` a `PREVIEW_SHINY` = 44 a 49;
- `PREVIEW_NATURE`/`ABILITY`/`MOVES`/`PAGE` = 50 a 53;
- `COUNT` = 54.

**Conferir:**
- nada do texto antigo encavalado com o ícone de tipo;
- tocar na caixa de baixo alterna Info → IVs → EVs.

### Batalha (`battle.json`, `Battle.ts`)

**Golpes** (BattleMoveSelection):
- tiles em x 0/105, y 0/29 (13 e 5 px de espaço; antes, x 97);
- ícone do tipo em x − 9;
- nome em x 17, numa linha;
- categoria (ícone) em x 48;
- PP centrado em x 75;
- dica de efetividade embaixo do nome;
- voltar com a textura `battle_back` (x − 11, altura − 22);
- gimmicks alinhados ao voltar, como o Java.

Para não mudar o contrato de 5 células + gimmicks (testes da frente msd-fase1), o texto do tile tem 3 linhas (`MOVE_TILE_LINES`: PP com o prefixo da categoria, dica, nome). O layout mostra cada linha na sua janela cortada. O tile indisponível continua começando com `§8`.

Troca, alvo, ação e mochila: sem mudança de estrutura. O checador não acusa nada. O voltar da troca e do alvo passou a usar `battle_back`.

**Conferir:**
- 4 tiles com o ícone do tipo saindo pela esquerda;
- nome inteiro;
- ícone da categoria e o PP no canto de baixo à direita;
- "Supereficaz"/"Pouco eficaz" pequeno embaixo do nome.

### Party/time, troca, diálogo de NPC, HUD

- Party/time, troca e diálogo de NPC não são roteados: usam o `long_form` e os diálogos da vanilla, então não há layout próprio a ajustar.
- O HUD (`gen-hud.ts`) foi revisto no código: coordenadas do PartyOverlay/BattleOverlay e todos os rótulos com largura fixa. Não mudou. A prévia não cobre o HUD, porque ele depende do protocolo fatiado do título.
- Observação: glifos de página no texto dessas telas (ex.: tipo/categoria no `promptMoveReplacement`, que usa `renderMoveButton`) também saem com 32 px × escala. Ver os pedidos abaixo.

## Verificação (2026-09-28)

- `node tools/ui/preview.mjs`: 18 telas, 0 problema (e 0 aviso de corte). As prévias ficam em `docs/ui-preview/*.png`.
- `node --experimental-strip-types tools/ui/gen-telas.ts --check`: em dia. `gen-hud.ts --check`: em dia.
- `node tools/check-ui-baseline.mjs`: ok contra v1.26.50.4 e v1.26.60.28-preview, inclusive as regras do cliente da seção 7. O `clips_children` só é usado em `panel`, como na vanilla.
- `npx tsc -p tsconfig.json`: 0 erros.
- `npm test`: tudo passa, inclusive `ui-layout` (novo), `telas`, `ui-cliente`, `msd-fase1` (5 células + gimmick) e `extras-final`.
- E2E base no BDS próprio (`uil`, 19181, `dist-uil`, raknet, sem MSD): **10/10**. O `01-starter` escolhe pelo nome (célula NAME), o `03-battle` escolhe o 1º tile que não começa com `§8` e o `08-pokedex` abre a página. No log do BDS, a única linha é o "No targets matched selector" do `kill` do cenário do inicial, que já existia. Nenhum ERROR/WARN de script. O container foi removido (`--rm`).

## Pedidos a outras frentes

1. **cliente-teste3** (`scripts/debug/SelfTest.ts`, `sampleBattleForms` e a amostra de gimmicks, linhas ~1409 e ~1480): trocar `renderMoveButton(id, pp, max, disabled, undefined, [])` por `moveTileText(id, pp, max, disabled, undefined, [])`, exportado de `scripts/GUI/Battle.ts`, com a mesma assinatura. O layout novo espera 3 linhas (PP, dica, nome). Com o texto antigo, o tile de exemplo mostra o glifo + nome na janela do PP e deixa a do nome vazia. Só afeta o roteiro de prints do selftest.
2. **ui-base/importador** (`tools/importer/guiTextures.ts`, páginas E2/E3): os glifos são desenhados com o tamanho da célula (32 px × escala). Para ícones inline do tamanho do texto em chat/forms vanilla, desenhar o ícone com cerca de 8 px de altura na base da célula (ou página de 128 px). As telas roteadas não usam mais glifos, então isso é só para as telas vanilla e o chat.
3. **msd** (E2E privados `tests/e2e/msd/*.mjs`): os logs de passo usam `b.replace(/\n.*/s, "")`, que agora mostra o PP (1ª linha) em vez do nome. As asserções (`includes("{cobblemon.move.x}")`, `startsWith("§8")`) não mudam. Para o log, usar `b.split("\n").pop()`, como fiz em `tests/e2e/scenarios/03-battle.e2e.mjs`.

## Status

| Item | Status |
|---|---|
| Inicial: tipo sobre o nome, pontinhos | FEITO (prévia `starter.png`, `ui-layout.test`) |
| Resumo Info: campo por célula | FEITO (`summary-info.png`, 10 campos na tabela Java) |
| Resumo: time vazio | FEITO (fora do time mostra o próprio; `summary-pc.png`) |
| Resumo Marcas | FEITO (`summary-marks.png`) |
| Pokédex entrada: lista + painel com abas | FEITO (`pokedex-entry-*.png`) |
| Batalha (golpes) | FEITO (`battle-moves.png`) |
| Batalha (ação, troca, alvo, mochila) | Sem erro de layout; voltar com `battle_back` |
| PC: painel da esquerda | FEITO (`pc.png`) |
| Party/troca/diálogo | N/A (vanilla, sem layout próprio) |
| HUD do time/batalha | Revisto, sem mudança (fora da prévia) |
| Checagem automática | FEITO (`tests/ui-layout.test.ts`, `tools/ui/layoutScene.mjs`) |
| Prévia visual | FEITO (`tools/ui/preview.mjs` → `docs/ui-preview/`) |
