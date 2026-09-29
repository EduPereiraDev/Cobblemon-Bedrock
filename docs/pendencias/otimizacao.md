# Frente otimizacao — otimizações "garantidas" (nada muda no jogo)

Aprovado pelo usuário: aplicar SOMENTE os itens "garantidos" do relatório de oportunidades (#2, #4, #6, #8, #10, #11,
#12, #14, #15), cada um com prova automática de equivalência. NÃO feitos (fora do escopo aprovado): #1, #3, #5, #7,
#9, #13, #16, o item de controle, redução de dados dos Pokémon e toda a lista de duvidosas.

Regra: nada muda na tela, no som, nas animações, nas partículas, na jogabilidade ou nos dados. Onde não dá para provar
que um arquivo/definição não é usado pelo nome, ele fica como está.

> **Decisão da beta 7 (orquestrador):** o #8 foi DESLIGADO (`USE_JSON_PARSE = false` em
> `tools/importer/jsonTable.ts`). Ele não é "garantido" do ponto de vista do jogador: ganha ~0,8 s de carga no servidor,
> mas custa ~4 MB fixos de memória do script, e já há aviso de memória alta com muitos Pokémon em console. O código e as
> provas ficam; religar é trocar a constante para `true`. As medições abaixo que citam o #8 são da rodada do agente.

## Onde cada item foi aplicado

| # | Item | Onde | Status |
|---|---|---|---|
| 2 | PNG sem perda (oxipng + só metadados) | build: `tools/optimize/png.mjs` | FEITO |
| 4 | OGG silencioso duplicado → 1 cópia | build: `tools/optimize/dedupe.mjs` | FEITO |
| 6 | Condições de variante compactas | import: `tools/importer/variantConditions.ts` (+ `entities.ts`) | FEITO |
| 8 | VARIANTS, ENTITY_INFO, HABITAT_POOLS, ACTION_EFFECTS por `JSON.parse` | import: `tools/importer/jsonTable.ts` (+ 4 emissores) | FEITO (ver custo de memória) |
| 10 | Render controllers idênticos compartilhados | build: `tools/optimize/renderControllers.mjs` | FEITO |
| 11 | Animações, animation controllers e geometrias em lotes | build: `tools/optimize/bundle.mjs` | FEITO |
| 12 | Tinta de gimmick com menos comparações | import: `entities.ts` (`gimmickTintController`) | FEITO |
| 14 | Geometrias idênticas (exceto o id) | build: `tools/optimize/dedupe.mjs` | FEITO |
| 15 | OGG/PNG/JSON idênticos byte a byte | build: `tools/optimize/dedupe.mjs` | FEITO (parcial por guarda, ver abaixo) |

Por que parte no build: os testes, os validadores e o diff do pack MSD (`megaShowdown.ts`) leem `generated/` arquivo a
arquivo (RC por espécie, geometria por pasta). O `dist/` é o que vai para o jogo e já tem tudo junto (inclusive o
escrito à mão), então todas as referências são visíveis ali. A etapa roda em `tools/build.mjs` depois de juntar os
packs e antes do bundle dos scripts (o manifest do selftest vê o pack final). `COBBLEMON_OPT=0` desliga;
`COBBLEMON_OPT_VERIFY=1` reconfere todo PNG do cache.

Pack MSD (builds de desenvolvimento/privado): o pack MSD não é mexido, e tudo o que ele sobrescreve (mesmo caminho) ou
cita (string em qualquer JSON dele) no base fica como está. Provado por `tools/optimize/proveDist.mjs` (7.346 arquivos
do pack MSD idênticos; 4.134 arquivos/definições do base citados pelo MSD com o mesmo conteúdo).

## Provas (automáticas)

Etapa do build (`tools/optimize/index.mjs`, derruba o build se falhar), antes × depois relidos do disco:
- toda string JSON que resolvia para um arquivo resolve para arquivo com o mesmo sha256 (16.093 referências);
- todo evento de som resolve para a mesma lista de sha256 e os mesmos campos (2.269 eventos);
- toda referência a geometria resolve para o mesmo conteúdo (4.453); cada geometria removida tem uma idêntica que ficou;
- animações (12.978) e animation controllers (2.290): conjunto id → format_version + conteúdo idêntico;
- cada client entity/attachable resolve a mesma lista (render controller, condição) (1.043);
- PNG: RGBA de 16 bits por canal decodificado idêntico, pixel a pixel, conferido na criação da entrada do cache
  (decodificador próprio, independente do oxipng: todos os tipos de cor, 1–16 bits, paleta, tRNS, Adam7).

Prova independente entre dois builds do mesmo `generated/` (`node tools/optimize/proveDist.mjs <sem> <com>`): refaz as
provas lendo as duas pastas, usa o hash dos PIXELS para referência a PNG, e decodifica os 17.491 PNG dos dois lados:
0 diferenças. Controle negativo (1 pixel, 1 evento de som, 1 render controller trocados numa cópia): as 3 falhas
aparecem.

Prova do import (`node --experimental-strip-types tools/optimize/proveImport.ts <generated-antes> <generated-depois>`):
- #8: todos os exports de variants/entityData/habitats/actionEffects deep-equal;
- #6: 1.088 client entities (base + MSD) iguais campo a campo, exceto as condições; 3.534 condições avaliadas para todo
  inteiro em [−2, faixa + 2] de `cobblemon:variant` (111.944 avaliações): 0 diferenças;
- #12: controller antigo × novo simulados: todas as sequências de 3 valores em [−1, 23] (1 e 3 frames cada) + 20 mil
  frames aleatórios, nos dois modelos de transição (uma por frame; encadeadas): 0 diferenças.

`tests/otimizacao.test.ts` (18 grupos, `npm test`): #6 exaustivo em todo subconjunto de até 11 variantes e aleatório
até 400, e em todas as condições do import atual (inclui a regra das camadas: #7 NÃO feito, a decisão de filtro é a
antiga); #12 simulação + controles negativos; #8 literal antigo (cópia tipada) × `JSON.parse` do módulo; #2
decodificador em todos os formatos + oxipng sem cinza, só formatos do pack, metadados fora e cor (gAMA) dentro; etapa
do build num pack pequeno (o que sai, o que fica pelas guardas, proteção do MSD) e as provas pegando cada tipo de erro.

## Detalhes por item

- **#2 PNG.** `@napi-rs/image` 1.15.0 (oxipng, binário pré-compilado; devDependency). Sem redução para cinza; só sai
  `tEXt/zTXt/iTXt/eXIf/tIME/pHYs` (sRGB, gAMA, iCCP, cHRM, sBIT, bKGD ficam). A saída tem de ser um formato que o pack
  JÁ usava (RGBA8, RGB8, paleta 1/2/4/8 bits com/sem tRNS; nada de cinza, 16 bits ou entrelaçado), senão tenta sem
  redução de profundidade, depois só recompressão, depois fica o original. Cache por sha256 em
  `node_modules/.cache/cobblemon-opt/png` (1º build ~27 s a mais; depois ~6 s). As tentativas do oxipng param na
  primeira que passa. Concorrência: metade dos núcleos, com o pool de 4 threads do libuv como teto real. 17.306 de
  17.491 otimizados; 185 sem ganho ficaram iguais.
- **#4/#15 arquivos idênticos.** Só sai a cópia referenciada APENAS por valores JSON que a etapa reescreve
  (`sound_definitions` para som; JSON do RP fora de `ui/` para textura; JSON do BP para loot). Fica onde está se o nome
  (caminho, caminho sem raiz, nome do arquivo) aparece em código de script ou JSON UI, se algum texto monta o caminho
  por prefixo (`textures/block/…`, `textures/cobblemon/profiles/…`), se aparece em `.mcstructure`, ou se o MSD cita.
  Resultado: OGG 1.168 cópias fora (−4,39 MB; o grupo silencioso de 1.146 incluído; `sounds/pokeball/recall.ogg`
  ficou: "recall" é nome em script); PNG só 12 de 81 cópias (28 KB: partículas das bolas, 3 árvores de berry, confete e
  fumaça); os caps do Pikachu/Raichu/Pichu, retratos e texturas de bloco usadas por script ficaram (nome usado em
  `variants.ts`/scripts: não dá para provar que ninguém monta o caminho); JSON: 6 loot tables de injeção de baú
  (referências nos loot tables vanilla sobrescritos apontam para a cópia idêntica).
- **#6.** Faixas `(v >= a && v <= b)` e progressões `(v >= a && v <= b && math.mod(v, d) == r)` (programação dinâmica,
  menor nº de comparações); mesma polaridade da antiga (negação só onde a antiga negava), então a função é a mesma para
  TODO inteiro, inclusive fora de [0, total). Conjunto vazio devolve `""` como antes. Conferido no próprio import
  (`assertSameMembership`, erro se divergir). Pior caso por frame, soma das 894 espécies: 10.153 → 6.163 comparações
  (Pikachu 1.584 → 104, Raichu 748 → 102, Pichu 672 → 66, Gholdengo 148 → 7, Gyarados 132 → 8; Unown 280 sem ganho,
  como o relatório previa). A decisão de filtro das camadas continua pela lista antiga (≤ 6 comparações): o #7 não foi
  feito (teste confere 877 camadas com filtro e 195 sem, iguais às de antes).
- **#8.** `export const X: Tipo = JSON.parse("…")` (string JSON simples, uma linha). Guardas: chave `__proto__` é erro;
  o tsc continua conferindo os dados pela cópia tipada `generated/scripts/_tipos/*.check.ts` (fora do bundle).
  Leitores textuais ajustados para os dois formatos via `tools/importer/generatedTable.mjs`: `readGeneratedTable`
  (megaShowdown.ts), E2E do MSD 01/02/03, E2E experimental habitat-mimic e `tests/jogabilidade.test.ts`.
  Onde está o ganho: o literal custa na COMPILAÇÃO do bundle; o JSON.parse, na execução. QuickJS (wasm), compilar +
  executar: VARIANTS 144 + 8 → 35 + 30 ms, ENTITY_INFO 35 + 2 → 4 + 8, HABITAT_POOLS 37 + 3 → 7 + 9, ACTION_EFFECTS
  10 + 1 → 2 + 2; soma 240 → 97 ms. No BDS isso aparece como: o "scripts carregados em N ms" do main.ts (que só mede
  a execução, porque o BOOT_STARTED roda depois da compilação) SOBE ~200 ms, e o total "Pack Stack → scripts
  carregados" (compilar + executar + BP) CAI ~770 ms. Ver a tabela do BDS.
  **Custo medido: memória.** QuickJS em modo módulo (como o Bedrock carrega): VARIANTS literal 3,4 MB → JSON.parse
  7,5 MB (a string fica no bytecode do módulo). `String.raw` (1ª tentativa, mantinha uma entrada por linha) era pior
  nos dois (76 ms / 10,0 MB) e foi trocado. Ganho de tempo em troca de ~+4 MB de heap do script (VARIANTS; as outras
  três tabelas são menores). Não aparece na tela; registrado para o orquestrador decidir se vale.
- **#10.** 75 definições compartilhadas `controller.render.cobblemon.shared.<hash>` no lugar de 1.828; 833 arquivos de
  render controller por espécie ficaram vazios e saíram. Só entra grupo de conteúdo EXATO (mesmo JSON, mesma ordem,
  mesmo format_version); os aliases Geometry/Texture/Material são resolvidos na entidade que usa.
- **#11.** Lotes de até ~1 MB em `<pasta>/_opt/` por pasta de 2º nível e format_version: animações 3.244 → 34 arquivos
  (17 grandes ficaram sozinhos), animation controllers 1.019 → 3, geometrias 2.049 → 25. Fora do lote: arquivo com outra
  chave no topo, geometria em formato antigo, id definido em mais de um arquivo, arquivo sobrescrito pelo MSD. Várias
  definições por arquivo nesses tipos é o formato do vanilla (bedrock-samples: `animations/*.animation.json`,
  `models/entity/*.geo.json` e `animation_controllers/*.json` com vários ids).
- **#12.** Máquina de 2 estados (`default` sem tinta; `on` com a cor) bissimilar à de 22: `default` tem UMA transição
  (faixa 1..21, 2 comparações no lugar de 21 por frame em todo Pokémon parado); `on` grava o valor em
  `v.cobblemon_gimmick_e` e a cor por busca binária (~5 comparações por canal, só na entrada) e volta ao `default`
  quando a propriedade muda, como o gN fazia. Continua sendo controller de animação (mesma fase de avaliação). O teste
  `msd-fase1` foi ajustado: as asserções da máquina de 22 estados valem para `legacyGimmickTintController` (referência)
  e a nova é conferida pelo resultado (alfa do Dynamax, cor do Tera Fogo, volta ao default).
- **#14.** 58 geometrias idênticas (menos o identifier) fora, 25 referências reescritas: frutos de berry (sem referência
  por id no pack), vestíveis `.pokemon`/`.player`, rotações idênticas de blocos (fossil analyzer, metronome), mudas de
  vivichoke e `geometry.exeggcute_alola_bias`. Exatamente os 37 grupos / 58 cópias do relatório.

## Medições (antes → depois)

Base = conteúdo v1.0.6 (`dist-opt-base`, build público do `generated/` de antes das mudanças). Depois = `dist-opt`.

| Medida | Antes | Depois |
|---|---|---|
| `Cobblemon.mcaddon` público | 117.047.867 B (117,0 MB) | 101.831.624 B (101,8 MB), −13,0% (o zip varia ±30 KB entre builds iguais) |
| Arquivos RP | 29.533 | 21.219 (−8.314) |
| Arquivos BP (sem scripts) | 6.261 | 6.255 |
| Instalado RP (descompactado) | 182,5 MB | 162,8 MB |
| PNG (bytes) | 61,00 MB | 49,56 MB |
| `main.js` público | 12,76 MB | 12,97 MB (string JSON com aspas escapadas) |
| `npm run import` | 169,6 s | 157,9 s (sem etapa pesada nova; variação do host) |
| `npm run build:public` | 26,2 s | 42,3 s com cache de PNG; 68,8 s no 1º build (cache vazio: PNG 27 s) |
| QuickJS, 4 tabelas (compilar + executar) | 240 ms | 97 ms |
| BDS "scripts carregados" do main.ts (só execução) | 452–515 ms (mediana 461) | 661–670 ms (mediana 663) |
| BDS "Pack Stack" → "scripts carregados" (compilar + executar + BP) | 3.921–4.930 ms (mediana ~3.955) | 3.168–3.245 ms (mediana ~3.186) |
| BDS "Opening level" → "scripts carregados" | 5.904–6.940 ms (mediana ~6.117) | 4.634–4.707 ms (mediana ~4.701) |

BDS (container `cobblemon-bds-opt`, porta 19192, BDS 1.26.52.3 emulado com box64 no Mac; boots alternados: 5 do base,
4 do otimizado e 2 do `dist-opt-noopt` = mesmo `generated/` com o #8 mas SEM a etapa do build). Atribuição:
- o `dist-opt-noopt` tem o mesmo "Pack Stack → carregados" do otimizado (3.175 / 3.195 ms): os −770 ms são do #8;
- "Opening → Pack Stack" (abertura do mundo e dos packs): base ~1,99 s, noopt ~1,96 s, otimizado ~1,50 s: os −0,45 s
  são do pack menor (−8.314 arquivos no RP).
Tempos absolutos inflados pela emulação; use as proporções.

## Verificação final (2026-09-28)

- `npm run import`: OK em 157,9 s (base 39,6 s + MSD; "MSD: ok").
- `npm run validate`: "OK: nenhum erro" (base e árvore efetiva com o MSD); "MSD: OK".
- `npx tsc -p tsconfig.json`: 0 erros.
- `npm test`: todos passaram (inclui `otimizacao: 18 grupos de testes ok`, `msd-fase1` e `jogabilidade` ajustados).
- `node tools/check-ui-baseline.mjs`: ok (11 arquivos de UI, 0 aviso).
- `npm run build:public` (`COBBLEMON_DIST=dist-opt`): provas OK; `node tools/optimize/proveDist.mjs dist-opt-noopt dist-opt`:
  0 diferenças (17.491 PNG pixel a pixel).
- Import antes × depois: `tools/optimize/proveImport.ts` contra o `generated/` de antes: 0 diferenças (#6, #8, #12).
- BDS `cobblemon-bds-opt` (porta 19192, raknet, online-mode=false, `dist-opt`): content log só com `[inform]`
  (0 ERROR/WARN); no console, só o aviso de transporte do raknet e os 2 de comando do preparo do bot ("No ticking areas
  named e2espawn", "No targets matched selector"), como nas outras frentes.
- `/cobblemon:selftest quick` com bot (`tests/e2e/experimental/otimizacao-selftest.e2e.mjs`): "fim (ok) em 4 min 14 s
  … 0 falha(s)", área 0 bloco(s) e 0 entidade(s), bot de volta ao lugar.
- E2E base: `COBBLEMON_MSD=0 node tools/e2e/run.mjs --deploy --rm`: 10/10; container removido.

## Arquivos

Novos: `tools/optimize/{index,common,png,dedupe,renderControllers,bundle,proveDist}.mjs`,
`tools/optimize/{proveImport,controllerSim}.ts`, `tools/importer/{jsonTable,variantConditions,molangEnv}.ts`,
`tools/importer/generatedTable.mjs`, `tests/otimizacao.test.ts`, `tests/e2e/experimental/otimizacao-selftest.e2e.mjs`.
Editados: `tools/build.mjs` (chama a etapa), `tools/importer/{entities,scriptsOut,habitats,actionEffects}.ts`,
`package.json`/`package-lock.json` (devDependency `@napi-rs/image` 1.15.0), `tests/jogabilidade.test.ts` e, na árvore
privada do MSD (fora do git), `tools/importer/megaShowdown.ts` (`readGeneratedTable`), `tests/msd-fase1.test.ts` e
`tests/e2e/msd/0{1,2,3}-*.e2e.mjs` (leitor textual da tabela).

## Pedidos a outras frentes / pendências

- Nenhum arquivo de outra frente depende do layout novo do `dist/`; quem ler `dist/` por caminho de animação,
  geometria ou render controller por espécie precisa resolver por id (o `generated/` continua um arquivo por espécie).
- #8 troca tempo de carga por memória do script (+~4 MB no VARIANTS). Se o heap do script ficar apertado em console ou
  celular, reverter só o #8 é trocar `jsonTableExpression`/`jsonValueExpression` pelo literal (os leitores aceitam os
  dois formatos).

