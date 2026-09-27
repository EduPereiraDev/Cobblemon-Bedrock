# 2 — Retratos pré-renderizados dos Pokémon (pesquisa + protótipo)

Data: 2026-09-26. Escopo: gerar offline, no macOS (Apple Silicon, Node 22), PNGs transparentes dos modelos Bedrock
do Cobblemon (geo + textura + camadas + pose de animação) com o enquadramento de retrato do próprio Cobblemon, para
uso na UI do Bedrock. Complementa o §3.4 de [`1-interface.md`](1-interface.md) (a parte de UI já assume sprites 2D
e explica por que o atlas não é endereçável em runtime).

## Resumo

- **Pipeline escolhido: rasterizador de software em TypeScript puro**, sem GL nem dependências, reaproveitando o
  `tools/importer/png.ts`. Ele reproduz o que o Cobblemon faz no Java: a conversão Bedrock → `ModelPart`
  (`TexturedModel.kt`), o box UV do `ModelPart.Cube` do Minecraft, a aplicação das animações
  (`BedrockAnimation.kt`), a cadeia de matrizes da GUI (`drawPosablePortrait` / `drawProfilePokemon`) e as duas luzes
  direcionais do shader de entidade.
- **O protótipo funciona.** Renderizou as 5 espécies pedidas e depois **todas as 886 espécies e 7.873 combos** do
  `generated/scripts/variants.ts`, sem nenhum modelo ou textura faltando e sem nenhum retrato vazio.
  - O pedido citava 7.797 combos; o `variants.ts` atual tem 7.873.
  - Tempo em um processo: **105 s** para 9.300 renders (retrato + corpo inteiro), gerando 27.900 PNGs (128, 64 e 32).
  - Com 8 processos em paralelo: **51 s**.
  - Custo médio de rasterização: 8 ms por render.
- **Imagens realmente distintas: 3.550.** Os 7.873 combos caem para 4.650 sem a camada `alpha_*`, e para 3.550
  deduplicando por conteúdo. Recortes menores:
  - base + shiny + formas (sem fêmea e sem cosméticos): **2.420**;
  - só a forma base: **886**.
- **Formato recomendado: um PNG por imagem.** Motivos:
  - `ActionFormData.button(text, icon)` só aceita caminho de arquivo.
  - O JSON UI não tem binding de `uv`.
  - Atlas só serve para ícones de fonte (glyph) e para quadros de animação com layout fixo.
  - Retrato 64×64: **4,2 KB** em média. Os 2.420 do recorte base + shiny + formas ficam em torno de **10 MB**.
- **Plano de integração:** novo módulo `tools/importer/portraits.ts`. Ele gera `textures/cobblemon/portraits/*`, um
  `generated/scripts/portraits.ts` que mapeia (espécie, índice de `variant`) → caminho, e um cache por hash de
  entrada. Nos scripts, `PokemonData.variant`, que já vem de `resolveVariant`, escolhe o retrato sem cálculo extra.
  Detalhes no §7.

As folhas de amostra ficam no scratchpad desta sessão, que é temporário. Para gerar de novo, veja o §3.

- `pesquisa-retratos/sheet1.png`: retratos e corpo inteiro das 5 espécies;
- `sheet2.png`: Gyarados shiny e Pikachu com boné, nos 3 enquadramentos;
- `sheet3.png`: tamanhos 64 e 32;
- `sheet4.png`: espécies com poser em Kotlin;
- `sheet5.png`: 4 quadros de `ground_idle`;
- `out/atlas/portrait64_0.png`: 1.024 retratos para inspeção.

---

## 1. Como o Cobblemon enquadra os retratos (fonte de verdade)

Arquivos lidos: `api/gui/GuiUtils.kt`, `client/gui/PokemonGuiUtils.kt`, `client/gui/PartyOverlay.kt`,
`client/gui/battle/BattleOverlay.kt`, `client/gui/summary/{Summary,widgets/ModelWidget}.kt`,
`client/render/models/blockbench/{TexturedModel,PosableModel}.kt`, `bedrock/animation/BedrockAnimation*.kt`,
`pose/ModelPartTransformation.kt` (todos em `upstream/cobblemon/common/src/main/kotlin/com/cobblemon/mod/common/`).

**Retrato (`drawPosablePortrait`).** A pose é a primeira que contém `PORTRAIT`, com `partialTicks = 0` e
`headYaw = headPitch = 0`. Os `q.look` do poser viram identidade e o `ground_idle` é avaliado em t=0. A cadeia de
matrizes, em coordenadas da GUI (y para baixo):

```
T(origem do tile) · T(0, PD+2, 0) · S(s, s, -s) · T(0, -PD/18, 0)            // PD = 28 (BattleOverlay.PORTRAIT_DIAMETER, importado por GuiUtils)
· T(pt.x, pt.y + 1.5·ps, pt.z - 4) · S(ps, ps, 1/ps) · RY(-32°) · RX(5°)   // ps/pt = portraitScale/portraitTranslation do poser
· partes do modelo (px/16)
luzes: (0.2, 1, -1) e (0.1, 0, 8); ambiente 0,4 + 0,6·Σ max(0, n·L)
```

| Tela | Scissor | Origem | `s` |
|---|---|---|---|
| Tile de batalha (`BattleOverlay`, não compacto) | 28×28 | (14, −5) | 18 |
| Party HUD (`PartyOverlay`) | 21×21 | (9,5, −12) | 13 |

Os dois recortes são quase iguais em proporção. O protótipo usa o de batalha (`portrait`) por ser centrado, e o de
party está disponível como `portrait_party`. O resultado é o rosto em close com o Pokémon virado para a direita. O
lado adversário do Cobblemon (`reversed = true`) espelha x.

**Perfil (`drawProfilePokemon`, Summary).** Scissor 66×66 com `T(33, −10)·S(2)·S(20, 20, −20)`, depois
`T(prt.x, prt.y + 1.5·prs, prt.z − 4)·S(prs, prs, 1/prs)` e rotação XYZ (13°, 325°, 0°). Usa
`profileSummaryScale/Translation` quando existirem, senão `profileScale/Translation`. Luzes (−1, 1, 1) e
(1,3, −1, 1).

**Detalhes do conversor do Java que o protótipo reproduz:**

- O osso raiz fica na origem e **a rotação dele é ignorada**. Os filhos ficam em `pivot − pivotDoPai`, com o y
  invertido.
- Cubo: `addBox(origin − pivot, −(origin.y − pivot.y + size.y), …)` com `CubeDeformation(inflate)`.
- Cubo com rotação vira uma subparte no pivot do cubo.
- O UV é **só box UV** (`uv: [u, v]`, que é o que o Cobblemon aceita), com as UVs do `ModelPart.Cube` 1.21.
- `mirror` troca os x e inverte a normal em x.
- Animação: posição com **y invertido**, rotação somada em graus, escala multiplicada.
- `transformedParts` do poser: posição crua, rotação e `isVisible` (Molang, por exemplo
  `q.has_aspect('regrown-tail-1')`).
- Texturas:
  - camada base em `entityCutout`, descartando alfa abaixo de 0,1;
  - camadas `emissive` sem luz e com blend;
  - demais camadas com luz e com blend;
  - `alpha_*` (olhos de Alfa) fica fora do retrato.

**Onde estão os parâmetros:**

- 725 posers em JSON (`bedrock/pokemon/posers/**`) têm todos `portraitScale/Translation` e
  `profileScale/Translation`.
- **301 posers em uso só existem em Kotlin**, registrados com `inbuilt("x", ::XModel)` em
  `VaryingModelRepository.kt`, por exemplo Aggron, Ampharos e Turtwig. O importador atual não lê esses arquivos (ele
  usa o `fallback`). O protótipo tira deles, por regex:
  - `portraitScale`/`portraitTranslation`/`profile*` (`override var … = 1.9F`, `Vec3(...)`);
  - a pose com `UI_POSES`/`PORTRAIT`;
  - as chamadas `bedrock("grupo", "anim")` dessa pose.

## 2. Opções avaliadas

| Opção | Estado no Mac arm64 + Node 22 | Prós | Contras | Veredito |
|---|---|---|---|---|
| **Rasterizador próprio em TS** (este protótipo) | Funciona, sem dependências | Determinístico (mesmo PNG em qualquer máquina e no CI); cópia fiel da matemática do Cobblemon; 8 ms por render; roda dentro do `npm run import` | Sem MSAA de hardware (usa supersampling 2×); UV por face aproximado (nenhum modelo de Pokémon usa) | **Escolhido** |
| `gl` (headless-gl) + three.js | **Testado aqui:** `gl@8.1.6` instala binário pronto e cria contexto "WebGL 1.0 stack-gl 8.1.6 / ANGLE" em 100 ms, com `readPixels` correto. O 9.0 rc (WebGL2) não tem binário pronto para Mac | GPU; three.js | Dependência nativa (+145 pacotes, avisos de `tar`/`glob` deprecados); ainda seria preciso escrever o loader Bedrock → three com as mesmas regras do §1; o ganho some porque o gargalo passa a ser a codificação PNG | Plano B |
| `@onirenaud/node-webgl` (ANGLE/Metal) | Binário arm64, WebGL2, three.js sem modificação (fonte: pesquisa web, versão 0.2.0 de 17/09/2026) | GPU real | Projeto muito novo (21 commits) | Não recomendado ainda |
| Puppeteer/Playwright + Chromium | Viável; o Chrome 137+ só usa SwiftShader com `--enable-unsafe-swiftshader`, e há bug aberto de WebGL headless em macOS arm64 (issues.chromium.org 338414704) | Ferramenta conhecida | ~150 MB de browser e ponte de arquivos; lento para iniciar; resultado muda com GPU e driver | Descartado |
| Blockbench | Sem CLI nem headless oficial (issue #2495); o `blockbench-mcp-plugin` PR #58 (24/09/2026) renderiza `.bbmodel` com WebGPU, pede Node ≥ 23.6 e ignora Molang | Visual idêntico ao editor | Exige converter geo → bbmodel; não roda no Node 22; sem poses | Descartado |
| `@bridge-editor/model-viewer` 0.8.1 + `@bridge-editor/molang` | Lê geo.json e tem animador com Molang; depende de DOM (`TextureLoader`, `window`) | Loader pronto | Semântica do Bedrock, não a do Cobblemon (raiz rotacionada, sinais de posição); precisa de GL e de shims | Referência |
| `strictlynifty/cobblemon-wiki` (Python + Pillow, CC0) | Rasterizador de software para os modelos do Cobblemon; 3.564 sprites em ~5 min com 6 workers; atlas + manifest | Prova independente de que o software dá conta | Python; pose PROFILE; sombreamento fixo por face | Confirma a escolha |

**Por que não GPU:** cada retrato tem no máximo 566 cubos (≈ 6.800 triângulos) numa área de 256² pixels. Em JS isso
custa 8 ms, e a codificação PNG (0,7 ms por imagem) já pesa tanto quanto a rasterização. Usar GPU só traria dependência
nativa e variação entre máquinas, sem ganho que compense.

## 3. O protótipo

Pasta: `/private/tmp/claude-502/-Users-edupereira-Projetos-Cobblemon-Bedrock/275d0c5f-c0ac-47f2-b984-775e3fe07697/scratchpad/pesquisa-retratos/`.
Nenhum arquivo de `scripts/`, `tools/`, `behavior_packs/` ou `resource_packs/` foi alterado.

| Arquivo | Papel |
|---|---|
| `molang.ts` | Compilador mínimo de Molang para JS, com lista branca de tokens. Suporta `math.*` em graus, `q.anim_time`/`life_time` e `q.has_aspect()`; `v./t./c.` valem 0. Atribuição e `;` devolvem `null`, e o chamador usa o valor de repouso |
| `render.ts` | Montagem do modelo (§1), aplicação de animação e keyframes (linear, com pre/post), `transformedParts`, enquadramentos `portrait`, `portrait_party`, `profile` e `icon` (corpo inteiro ajustado à caixa), rasterizador com z-buffer, cutout, blend e supersampling, e redução por média com alfa pré-multiplicado |
| `run.ts` | CLI: lê `variants.ts`, posers JSON e Kotlin, índice de animações, dedupe de combos e manifesto `species → variant → arquivo` |
| `pack.ts` | Mede PNG otimizado (paleta, filtros, deflate 9), atlas 2048² e os recortes de conjunto |
| `frames.ts` | Tira de 4 quadros do `ground_idle` |
| `sheet.ts`, `cov.ts`, `probe*.ts` | Inspeção: folhas de contato, cobertura de alfa, diagnóstico |

```sh
cd <scratchpad>/pesquisa-retratos
node --experimental-strip-types --no-warnings run.ts                      # 5 espécies (padrão)
node --experimental-strip-types --no-warnings run.ts --all --modes=portrait,icon
node --experimental-strip-types --no-warnings run.ts gyarados --modes=portrait_party,profile --ss=4
```

**Validação feita:**

- Inspeção visual das 5 espécies e de variantes: shiny do Charizard e do Gyarados, Gyarados fêmea, Pikachu com os
  bonés, chama emissiva do Charizard.
- Inspeção de 5 posers em Kotlin: Turtwig, Misdreavus, Aggron, Ampharos e Donphan.
- Inspeção de um atlas com 1.024 retratos.
- Nenhum dos 4.650 retratos 64×64 tem cobertura de alfa abaixo de 15%, ou seja, não há quadro vazio ou mal
  enquadrado.
- Molang: das **67.331 expressões distintas** em todas as animações, **174 (0,26%)** não compilam. Quase todas são lixo
  do upstream (`NaN-math.sin(...)`) ou strings que não são expressão (`catmullrom`, `entity`).

**Limitações conhecidas (a resolver no módulo definitivo):**

1. **Falta comparar pixel a pixel com o Cobblemon rodando.** O enquadramento e a orientação batem com a matemática do
   código, mas não houve captura de tela do cliente Java para confirmar. A iluminação usa lightmap = 1, o que é
   aproximado: o Cobblemon usa `LightTexture.pack(11, 7)`, que depende da hora do dia.
2. Posers em Kotlin: `transformedParts` e ossos escondidos declarados em Kotlin (`createTransformation()`,
   `withVisibility`) não são lidos. As regex de escala e pose funcionaram em 936 renders sem falha visível na amostra.
3. Keyframes `catmullrom` são interpolados como lineares. Em t=0 não faz diferença, porque o valor é exato no
   keyframe.
4. O quadro é fixo em t=0. O `blink` e os quirks estão desligados, como no Cobblemon com `doQuirks = false`.
5. Memória: 1,4 GB de pico no `--all`, porque o cache de modelos e texturas nunca é esvaziado. No módulo definitivo,
   processar por espécie e liberar o cache resolve.

## 4. Medições

Máquina: Apple M1 Max (10 núcleos), Node 22.14, supersampling 2× (buffer de 256² para o tamanho 128, reduzido por
média para 64 e 32).

| Execução | Renders | PNGs | Índices | Poses + setup | Rasterização | PNG encode | Total |
|---|---|---|---|---|---|---|---|
| 5 espécies (212 combos, retrato + corpo inteiro) | 212 | 636 | 0,11 s | 0,07 s | 2,4 s (11 ms/render) | 0,4 s | **3,0 s** |
| Todas: 886 espécies / 7.873 combos → 4.650 únicos | 9.300 | 27.900 | 0,12 s | 4,3 s | 75,8 s (8,2 ms/render) | 19,4 s | **105 s** (1 processo) |
| Idem, 8 processos | 9.300 | 27.900 | | | | | **51 s** de parede |
| Tira de 4 quadros × 2 espécies (64 px, SS 4×) | 8 | 2 | | | | | 0,18 s |

**Extrapolação.** O retrato de 64 px no recorte base + shiny + formas (2.420 imagens) leva ~20 s em 1 processo, ou
poucos segundos com cache (§7). Não afeta o tempo do `npm run import`.

Tamanhos das **3.550 imagens distintas**, com o encoder atual do `png.ts` e com o otimizado (melhor entre sem filtro e
filtro adaptativo, deflate 9, paleta quando há ≤ 256 cores):

| Conjunto | Média por arquivo (otimizado) | Total por arquivo | Atlas 2048² (folhas, total) | Memória se tudo residente |
|---|---|---|---|---|
| retrato 128 | 5,5 KB | 20,1 MB → 19,6 MB | 14 folhas, 14,7 MB | 222 MB |
| **retrato 64** | **4,2 KB** | 15,0 MB → 15,0 MB | 4 folhas, 9,7 MB | 55,5 MB |
| retrato 32 | 2,1 KB | 7,6 MB → 7,4 MB | 1 folha, 4,2 MB | 13,9 MB |
| corpo inteiro 128 | 6,5 KB | 23,6 MB → 23,1 MB | 14 folhas, 17,5 MB | 222 MB |
| corpo inteiro 64 | 3,9 KB | 14,2 MB → 13,9 MB | 4 folhas, 9,1 MB | 55,5 MB |
| corpo inteiro 32 | 1,55 KB | 5,5 MB | 1 folha, 3,3 MB | 13,9 MB |

Otimizar sem perda rende pouco, porque o antialiasing das bordas estoura a paleta de 256 cores. O atlas economiza de
35% a 45%. Para comparação, o que existe hoje é `resource_packs/CobblemonBedrock/textures/sprites/`: 1.025 PNGs de
120×112 (9,3 MB), só da forma base e de origem externa.

## 5. Formato de saída para a UI do Bedrock

**Arquivo por imagem, não atlas.** Três motivos:

- `ActionFormData.button(text, "textures/...")` recebe um caminho e não tem recorte.
- No JSON UI, `#texture` aceita caminho montado, mas **não existe binding de `uv`** (ver `1-interface.md` §1.3f).
- Um atlas exigiria um controle por imagem, com `uv` fixo e visibilidade condicional: milhares de controles gerados.

O atlas só compensa em dois casos:

1. **Glifos de fonte.** São mini-retratos 32×32 para chat, lore e listas. Cada página `glyph_XX.png` de 512² guarda
   256 ícones. As páginas E4 a F8 estão livres (`1-interface.md` §4), o que dá 5.376 glifos: cabem os 886 da forma
   base em 4 páginas, ou os 2.420 do recorte base + shiny + formas em 10 páginas.
2. **Quadros de animação** (§6), em tira com layout fixo por arquivo.

**Orçamento:**

- A recomendação da Microsoft para add-ons é de até 2.500 arquivos, 25 MB descompactado e até 800 texture handles
  (4.000 no jogo inteiro, acima disso a textura fica rosa). Os orçamentos de memória de textura vão de 150 MB (tier 1)
  a 800 MB (tier 5). Fontes: learn.microsoft.com `improvingperformanceandresourceusage` e `texturebudgets`.
- **O RP já passa do limite de arquivos:** `generated/resource_packs` + `resource_packs` somam ~15.500 arquivos, 5.046
  deles PNGs gerados. Os retratos não mudam essa situação, mas aumentam o tamanho.
- O que importa na prática é **não deixar os retratos residentes**. O JSON UI e os forms carregam a textura quando o
  controle aparece. Uma página de PC (30) + party (6) em 64 px ocupa ~0,6 MB.

**Nomes.** Arquivo plano, deduplicado:

- `textures/cobblemon/portraits/<espécie>_<n>.png`, com `n = 0` para a base e depois na ordem de aparição dos combos.
- O índice `variant` **não** entra no nome: os combos que diferem só por `alpha_eyes`, cosmético invisível ou gênero
  idêntico apontariam para PNGs repetidos, 4.650 contra 3.550.
- Uma tabela gerada faz `variant → n` (§7).
- O corpo inteiro segue o mesmo esquema em `textures/cobblemon/profiles/<espécie>_<n>.png`.

**O que gerar (sugestão):**

| Uso | Enquadramento | Tamanho | Conjunto | Custo aproximado |
|---|---|---|---|---|
| HUD da party (⌀21), tile de batalha (28), PC, Pokédex, ícones de botão | `portrait` | 64×64 (o JSON UI reduz para 21–32) | base + shiny + formas: 2.420 (ou todos os 3.550) | ~10 MB (ou 15 MB) |
| Summary, starter, painel da Pokédex (substitui `textures/sprites/`) | `profile` ou `icon` | 128×128 | base + shiny + formas | ~15,7 MB |
| Chat, lore, listas de texto | `icon` | 32×32 em glifos | 886 base | 4 páginas 512², ~1 MB |

**Opcionais:**

- **Retrato espelhado do lado adversário:** dobra os arquivos. É melhor validar antes se o JSON UI espelha com
  `uv_size` negativo.
- **Ícones de spawn egg:** hoje não existem. Como todas as espécies usam a mesma entidade, o spawn egg nativo não
  varia por espécie. Seria preciso um item por espécie com `minecraft:icon` no `item_texture.json`. Em 32×32 (modo
  `icon`), os 886 da forma base somam ~1,4 MB. O atlas de itens é montado pelo jogo e reduz a resolução sozinho se
  lotar, o que é um motivo para ficar em 32 px ou menos.

**Licença e risco:**

- Os modelos e texturas do Cobblemon vêm com arquivo `license` em Creative Commons (CC BY). O retrato é uma adaptação:
  mantenha a atribuição e a nota de modificação no pack.
- Continua existindo o risco de propriedade intelectual de Pokémon. O PokeBedrock sofreu DMCA em julho de 2026 (fonte:
  pesquisa web, `github/dmca` 2026-07-14).

## 6. Quadros de animação (opcional)

O renderizador aceita qualquer `t`. Quatro quadros do `ground_idle` em 64 px custam ~20 ms por espécie e ~15 KB por
tira de 256×64 (`sheet5.png`). A variação é sutil (respiração). Na UI, isso exigiria um `flip_book`/`uv` animado de
layout fixo sobre `#texture`, o que ainda falta validar em jogo. Também multiplica o tamanho por ~3,5. **Não
recomendo para a primeira versão.**

## 7. Plano de integração: `tools/importer/portraits.ts`

**Entradas** (todas já existem depois do `npm run import`):

- `generated/scripts/variants.ts` (`VARIANTS`: combos, variações e camadas com `emissive`/`translucent`). O ideal é
  receber a estrutura em memória do próprio `variants.ts` do importador, e não reler o arquivo gerado.
- Geometrias em `OUT_RP/models/entity/pokemon/**` via `ModelIndex`, e texturas em `OUT_RP/textures/pokemon/**` (já com
  o `firstFrame` do `png.ts`).
- Animações originais via `AnimationIndex` (`animations.ts`). Não usar `_generated/`, que são as animações de look e
  pose criadas pelo importador.
- Posers: JSON em `BEDROCK_POKEMON/posers` (o `PoserFactory` já indexa) e Kotlin por regex em
  `KOTLIN/client/render/models/blockbench/{repository/VaryingModelRepository.kt, pokemon/**}` (novo helper no
  `kotlin.ts`: `readInbuiltPortrait(name)`).

**Código:**

- Mover `render.ts` e `molang.ts` do protótipo para `tools/importer/portraits/{render,molang}.ts`.
- Avaliar se o `molang.ts` já existente no importador, que hoje só reescreve expressões, deve ganhar um `evaluate`, em
  vez de duplicar.
- `portraits.ts` expõe `emitPortraits(ctx)`, chamado no fim do `index.ts`, depois de modelos, texturas e variants.
- Configuração em `tools/importer/data/portraits.json`:
  - `sizes: {portrait: 64, profile: 128}`, `ss: 2`;
  - `set: "base_shiny_forms" | "all"`;
  - `glyphs: true`.

**Saídas:**

- `OUT_RP/textures/cobblemon/portraits/<espécie>_<n>.png` e `OUT_RP/textures/cobblemon/profiles/<espécie>_<n>.png`.
- (opcional) `OUT_RP/font/glyph_E4..E7.png` + tabela de code points.
- `generated/scripts/portraits.ts`:

```ts
// Gerado. PORTRAIT_INDEX[espécie][variant] = n (−1 = sem retrato → cair para o variant base).
export const PORTRAIT_INDEX: Record<string, number[]> = { "pikachu": [0,1,0,1,2,/*...*/], /*...*/ };
export function portraitTexture(speciesId: string, variant: number, kind: "portraits" | "profiles" = "portraits"): string {
	const n = PORTRAIT_INDEX[speciesId]?.[variant] ?? 0;
	return `textures/cobblemon/${kind}/${speciesId}_${n < 0 ? 0 : n}`;
}
export const PORTRAIT_GLYPH: Record<string, string> = { /* espécie → "" */ };
```

- Entrada no `import-report.json`: quantidade, bytes, tempo, falhas de Molang e posers sem enquadramento.

**Seleção nos scripts:**

- O `PokemonData` já guarda `variant = resolveVariant(toSpeciesId(species), aspects)` (`scripts/Pokemon.ts:899`).
- Troque `getPokemonSpriteTexture(species)` (`scripts/GUI/common.ts:84`) por
  `portraitTexture(toSpeciesId(p.species), p.variant, kind)`. Chamadores atuais: `PC.ts`, `StarterGUI.ts` e
  `GUI/index.ts`.
- Para o recorte `base_shiny_forms`, uma variante sem retrato próprio (fêmea, cosmético) recebe no gerador o `n` do
  combo mais próximo, pelo mesmo placar de `resolveVariant`. Assim a busca em runtime continua O(1) e nunca falha.

**Execução:**

- Sem dependências novas. Roda dentro do `npm run import` com `node --experimental-strip-types`.
- Paralelizar com `node:worker_threads` em lotes por espécie, com N = núcleos − 1. Dá ~50 s para tudo sem cache.
- Liberar o cache de modelos e texturas ao terminar cada espécie, para ficar abaixo de ~300 MB.

**Cache incremental:**

- Chave = `sha1(RENDERER_VERSION + geo + texturas + camadas + animações da pose + portraitScale/Translation + modo + tamanho)`.
- Guardar em `generated/.cache/portraits/<chave>.png` + `index.json`. Se a chave não mudou, copia o arquivo.
- A dedupe final é por hash do PNG, o que define os `n`.
- Um import sem mudanças no upstream leva menos de 1 s nesta etapa.

**Verificação no módulo:**

- Teste em `tests/`: renderizar o Pikachu base em 32×32 e comparar o hash com um arquivo de referência.
- Teste de cobertura de alfa acima de 15% para todos, como o `cov.ts`.
- Teste de que todo `variant` de todo `VARIANTS[s]` resolve para um arquivo existente.
- Antes de fechar os parâmetros de luz, **conferir 3 retratos contra capturas do Cobblemon Java** (party HUD e tile de
  batalha).

**Documentação ao implementar:**

- Atualizar a linha "Tela de batalha fiel (tiles, retratos 3D)" de `docs/pesquisa/ALVOS.md` para "PARCIAL: retratos
  2D pré-renderizados com o enquadramento do Cobblemon".
- Registrar a atribuição CC BY dos modelos no README do pack.

## 8. Fontes

Código local (Cobblemon 1.8.2, `upstream/`): os arquivos Kotlin do §1, `bedrock/pokemon/posers/**`,
`bedrock/pokemon/models/*/license`.

Web (levantamento de 2026-09-26):

- headless-gl: https://github.com/stackgl/headless-gl, https://github.com/stackgl/headless-gl/releases (conferido
  localmente: `gl@8.1.6` funciona no arm64 com Node 22)
- node-webgl (ANGLE/Metal): https://github.com/RenaudRohlinger/node-webgl
- Dawn/WebGPU no Node: https://github.com/dawn-gpu/node-webgpu
- Chromium sem fallback SwiftShader: https://chromestatus.com/feature/5166674414927872,
  https://groups.google.com/a/chromium.org/g/blink-dev/c/yhFguWS_3pM
- Bug de WebGL headless no macOS arm64: https://issues.chromium.org/issues/338414704
- Blockbench, pedido de render em lote: https://github.com/JannisX11/blockbench/issues/2495
- blockbench-mcp-plugin (render headless): https://github.com/jasonjgardner/blockbench-mcp-plugin/pull/58
- bridge. model viewer e molang: https://github.com/bridge-core/model-viewer, https://github.com/bridge-core/molang
- MolangJS: https://github.com/JannisX11/MolangJS
- Rasterizador de software do cobblemon-wiki: https://github.com/strictlynifty/cobblemon-wiki
- Poser do Cobblemon: https://wiki.cobblemon.com/index.php/Poser
- Limites de add-on: https://learn.microsoft.com/en-us/minecraft/creator/documents/practices/improvingperformanceandresourceusage,
  https://learn.microsoft.com/en-us/minecraft/creator/documents/texturebudgets
- Forms e ícones: https://wiki.bedrock.dev/scripting/server-forms
- JSON UI (`uv`/`uv_size`): https://wiki.bedrock.dev/json-ui/json-ui-documentation
- Ícones de item e spawn egg: https://learn.microsoft.com/en-us/minecraft/creator/reference/content/itemreference/examples/itemcomponents/minecraft_icon,
  https://wiki.bedrock.dev/visuals/retexturing-spawn-eggs, https://wiki.bedrock.dev/concepts/texture-atlases
- DMCA do PokeBedrock: https://github.com/github/dmca/blob/master/2026/07/2026-07-14-digital-assets.md
