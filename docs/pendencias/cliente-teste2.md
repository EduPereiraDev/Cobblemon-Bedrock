# Frente "fix3": 2º teste em cliente real (BDS `fix3`, porta 19178, RakNet)

Teste em Windows, mundo hospedado no próprio cliente, com o content log
`ContentLog2026-09-27_18-07-38_1.txt` e três capturas (crash do selftest, estúdio do inicial, berries piscando).
Sem commit.

O arquivo de log tem duas sessões:

- Sessão 1 (linhas 1–36.557): BP 0.0.1 com o RP antigo da beta 1. Os dois packs tinham o mesmo UUID e a mesma
  versão; isso já foi corrigido na beta 3 com o `packVersion`.
- Sessão 2 (a partir da linha 36.558, 18:13:46): pack v1.0.2.

A ferramenta agora separa as sessões e, por padrão, resume só a última (ver o item 6).

## 1. Crash do mundo no `/cobblemon:selftest quick` (Watchdog StackOverflow)

### Causa raiz

O parser de MoLang dos scripts (`scripts/npc/molang/MoLang.ts`) era recursivo em 7 níveis de precedência. Cada nível
tinha um `binaryLevel` e uma closure, e isso dava ~27 chamadas por nível de aninhamento. O som em loop da montaria
aquática (`rideSounds` do estilo LIQUID do Lapras) tem a expressão
`math.max(1.0 ,0.2 + math.pow(math.min(q.ride_velocity() / 1.5, 1.0),2))`. O parse dela empilhava ~117 chamadas.

A pilha de script do Bedrock é minúscula, e um estouro derruba o mundo mesmo dentro de `try/catch`.

### Prova

**Medida no BDS (sonda temporária, já removida).**

- Uma recursão simples estoura entre 325 e 340 chamadas.
- A mensagem é idêntica à do cliente:
  `[Watchdog] Unhandled critical exception of type 'StackOverflow' ... Watchdog shutting down server`.
- O `InternalError: stack overflow` chega ao `catch`, mas o watchdog derruba o servidor assim mesmo.
- Parse + avaliação do som da montaria no fundo de uma recursão de N chamadas:
  - antes: OK com N = 200 e estouro com N = 250 (custo de 80 a 130 chamadas);
  - depois: OK com N = 280 e estouro com N = 300 (custo de 30 a 50 chamadas).
- No servidor integrado do cliente Windows, o orçamento é menor. Foi o primeiro MoLang avaliado na sessão: o
  mudsdale não tem `rideSounds`, e o Lapras em LIQUID tem.

**Linha do tempo no cliente (captura 6), na ordem:**

1. o StackOverflow;
2. `Watchdog shutting down server`;
3. o resumo `montarias 1/3 ... (mudsdale LAND, lapras LAND>LIQUID)`;
4. `fase movement em 6 s`;
5. `saiu no meio`.

O crash foi no passeio do Lapras, logo depois de virar LIQUID. Nesse passeio o `tickRiding` chama
`tickRideSounds`, que chama `evaluateRideSound`, que parseia a expressão.

**Por que as caixas deram 0/0:** as montarias vêm antes das rodadas das caixas (cercado, piscina, ar). O servidor
caiu no 2º passeio. O jogador "saiu", `stopped(s)` ficou verdadeiro e o `finally` imprimiu o resumo com as caixas
ainda vazias. Não é bug das caixas. No BDS a mesma fase dá `cercado 40/40, piscina 20/20, ar 24/24; montarias 3/3`.

### Mudança

- `MoLang.ts`:
  - os operadores binários agora usam precedence climbing, com uma chamada por nível;
  - a precedência e a associatividade são as mesmas de antes (tabela `BINARY_PRECEDENCE`);
  - `call` avalia os argumentos num laço, sem `map` e closure;
  - `parseTokens` foi exportado para os testes.
- O parse da expressão do som caiu de 117 para 38 chamadas; a avaliação, de 17 para 11. Isso também vale para os
  outros usuários do MoLang: assentos, regras de spawn, diálogos de NPC e requisitos de evolução.
- `SelfTest.ts`: o resumo da fase de movimento avisa quando a fase foi interrompida (`fase interrompida (motivo)
  depois de X de Y itens`). Assim, um 0/0 não parece mais falha das caixas.

### Teste

`tests/cliente-teste2.test.ts`:

- a precedência e a associatividade são iguais às antigas (13 casos + AST);
- a profundidade de pilha do parser e da avaliação da expressão da montaria fica ≤ 45 e ≤ 30 chamadas (o parser
  antigo dá 117 e reprova);
- o custo por nível de aninhamento fica ≤ 12 (parser) e ≤ 8 (avaliação).

## 2. Estúdio 3D do inicial: o modelo passava da janela

### Causa raiz

A câmera enquadrava o modelo em 34% da altura da TELA, com o centro 0,25 da meia-altura acima do centro. A janela
do form é de 118 × 100 px da UI, com o topo 81,5 px acima do centro. Isso só casa com uma tela de ~252 px de UI.

Na captura, a UI tem ~360 px. O cálculo daria um Charmander de 122 px numa janela de 100, com os pés logo acima da
borda de baixo e a cabeça 25 px acima do topo. É exatamente o que a captura 4 mostra.

O servidor não sabe a escala da interface do jogador.

### Mudança

Em `scripts/ui/studio/Studio.ts`, o enquadramento passou a ser o do Java. O `ModelWidget` do StarterSelectionScreen
e do Summary chama `drawProfilePokemon` com `profileSummaryScale`/`profileScale` e a translação de cada poser. O
Java usa `baseScale × 20 × profileScale` px por bloco do modelo, com os pés em
`topo + offsetY + baseScale·20·(ty + 1,5·ps)`.

- Novo `tools/importer/studioFraming.ts`: gera `generated/scripts/studioFraming.ts` (1.018 posers) com o mesmo leitor
  de posers dos retratos (JSON, Kotlin convertido e Kotlin por regex).
- A câmera reproduz o tamanho do Java para uma UI de referência de 400 px (`STUDIO_UI_HEIGHT`).
- A câmera fica inclinada 13°, como o `rotationVector` de 13° do widget.
- Limites calculados na maior UI, de 480 px (`STUDIO_UI_HEIGHT_MAX`), com 3 px de folga:
  - altura pela cabeça ×1,2;
  - largura pela caixa de colisão ×1,3;
  - a aresta da frente/de trás vista de cima;
  - perspectiva.
- O palco confere ar até 40 blocos ao sul e 10 acima. A distância máxima subiu de 9 para 40 blocos, porque o Onix no
  tamanho do Java pede ~22 no inicial e ~34 no resumo.

### Teste

Em `tests/cliente-teste2.test.ts`, com projeção perspectiva de verdade (FOV vertical de 60°):

- 12 espécies (bulbasaur, charmander, squirtle, wooper, onix, pikachu, eevee, piplup, rowlet, snorlax, lapras,
  chikorita) cabem na janela do inicial e na do resumo em UI de 270, 360, 400 e 480 px;
- na UI de referência, o Charmander tem a altura do Java (±15%) e os pés em −1,3 px (±6).

`tests/telas.test.ts`: o limite da distância acompanha a área conferida (`STUDIO_MAX_DISTANCE`).

### Não dá para conferir sem o cliente

A escala real da UI de cada jogador. Numa UI acima de 480 px, o modelo fica maior que a referência. Com o topo da
margem, ainda cabe até ~500 px.

## 3. Texturas piscando (z-fighting): berries e outras plantas, Pokémon

### Causas raiz, medidas pelo novo detector `tools/importer/zfight.ts`

O detector acha faces coplanares sobrepostas com aparência diferente. Ele leva em conta as combinações de estados do
bloco (`bone_visibility`, permutações) e o `render_method` de cada material instance.

**a) Planos de espessura zero em material `alpha_test`.**

- Um cubo de espessura zero tem as duas faces no mesmo plano.
- O `alpha_test` de bloco desenha a face de trás, então as duas aparecem dos dois lados, uma espelhada. São as folhas
  "azul-acinzentadas" da captura e o plano do fruto trocando vermelho/branco.
- Antes: 166 blocos, com centenas de pares por berry.
- O Java descarta a face de trás no modelo de bloco. O equivalente no Bedrock é `alpha_test_single_sided`, que existe
  no BDS 1.26.52 (conferido no binário).

**b) Plantas feitas para a terra arada (base em y = −1 no Java) achatadas em y = 0.**

- `blockModels.ts` cortava o y em 0, embora o cliente aceite até −14 (`clientRules.BLOCK_GEO_BOUNDS`).
- Com isso, o solo da muda, o mulch (em −0,95 no Java) e as bases das berries, mentas, vivichoke e revival herb
  ficavam no mesmo plano y = 0. O mulch piscava com o solo, tudo 1 px acima da terra arada.

**c) Cubos do mesmo osso com faces coplanares do mesmo lado.**

- Blocos: fruto/flor das berries, escadas, baús.
- Pokémon: 2.522 pares em 525 geometrias.
- No Java, o último cubo fica por cima quando a profundidade empata (LEQUAL). Na prática ela só empata em parte dos
  pixels.

**d) Camadas dos Pokémon.** Conferido: as camadas (emissiva, shiny, alfa) usam `entity_alphatest`/`entity_alphablend`
na mesma geometria, como o vanilla. Não é a causa. Uma regra no validate impede material opaco numa camada.

### Mudança (importador)

- `blockModels.ts`: y até −13,75 (limite do cliente menos a folga). O mulch e as bases voltam para a altura do Java.
  "Elemento recortado" caiu para 3 avisos.
- `zfight.ts`, com o pós-passe no `index.ts` e também no filho do Mega Showdown (`megaShowdown.ts`, depois do
  `emitMsdContent`):
  - `separateCoplanarCubes`: o cubo de depois ganha +0,01 px de `inflate` (o `inflate` em geometria de bloco já era
    aceito pelo cliente nos frutos, sem erro no log da sessão 2):
    - Pokémon: 1.960 cubos, em `models.ts`, antes de gravar;
    - blocos: 1.533 cubos;
  - `fixBlockDoubleSidedPlanes`: o bloco com faces opostas coplanares passa de `alpha_test` para
    `alpha_test_single_sided` (210 blocos, 4.652 instâncias). A troca vale para o bloco inteiro: na 1ª tentativa, só
    as instâncias das faces, o BDS avisou 20.544 vezes "All MaterialInstances must use the same render_method for a
    given block".
- Sobram só pares pequenos entre ossos diferentes, nos pontos de crescimento das berries (iapapa, persim, petaya,
  roseli, spelon: 0,1–1,2 px²). Eles vêm dos dados do Java e ficam como aviso no import.

### Validação (`npm run validate`)

- Erro: faces opostas coplanares com material de dois lados. Deu 0 no base e 0 no base + MSD; antes eram 81 só nos
  blocos do MSD.
- Resumo: pares do mesmo lado nos blocos (224, em 5 blocos) e nos Pokémon (42 no base).
- Erro: camada extra de Pokémon com material opaco.
- Erro: bloco com material instances de `render_method` diferentes (regra do BDS acima). Deu 0.

### Não dá para conferir sem o cliente

O efeito visual final: folhas, frutos e mulch sem piscar, e o `alpha_test_single_sided` na GPU. O BDS aceita os
blocos com o método novo sem nenhum erro de conteúdo (ver Verificação).

## 4. Spawner no cliente: fatias de 21–37 ms e um passe de 3,3 s

### Causa raiz

- O orçamento de 3–4 ms valia por posição, não por fatia. Em `SpawnSelector.bucketDataJob`, cada
  `addPositionDataJob` começava com o relógio zerado e não cedia ao terminar. Assim, 24 posições de ~2 ms somavam
  uma fatia de 24–37 ms, e 90 posições uma de ~86 ms.
- Reproduzido no Node `--jitless`, com `hasSpace` de 0,05 ms e `maxSpawns` 8:
  - antes: maior fatia de 23,9 ms (24 posições) e 86,5 ms (90 posições);
  - depois: 3,7 ms e 3,1 ms.
- O passe de 3,3 s de relógio (90 posições, logo depois de entrar no mundo) vem da mesma conta e do aquecimento das
  condições de todos os buckets do bioma. Só os buckets sorteados são usados.

### Mudança

- `SliceClock`: um relógio de fatia para o job inteiro (`SLICE_BUDGET_MS` = 3). Ele é usado pelo aquecimento, pelo
  `bucketDataJob` e pelo `addPositionDataJob`.
- `hasSpaceJob` recebe o que ainda cabe na fatia (`firstMs`).
- O aquecimento só avalia as condições do bucket sorteado, na primeira vez que ele sai. É ~15–20% menos trabalho por
  passe, e a seleção dá o mesmo resultado (teste com semente fixa).
- `zoneIsFull` e `wildNear` usam `closest` para não materializar centenas de entidades. O limite só precisa saber se
  chegou ao teto.

### Taxa de spawn

- A cadência dos passes é a de sempre: o timer de `ticksBetweenSpawnAttempts` é armado no começo do passe, e um
  passe em andamento adia o próximo só até terminar.
- A seleção é a mesma do Java: o teste `seleção fatiada (runJob) = seleção síncrona` continua passando, e o teste novo
  compara com a síncrona em 24/60/90 posições.
- Com menos trabalho por passe, o passe termina antes.

### Teste

Em `tests/cliente-teste2.test.ts`, 24, 60 e 90 posições com `hasSpace` lento:

- a mesma seleção da versão síncrona;
- o p99 das fatias ≤ 5 ms;
- a maior fatia ≤ 12 ms.

## 5. Locator `armor_offset.default_neck` (364 linhas, 144 entidades na sessão 2)

### Causa raiz

O cliente cria o locator `armor_offset.default_neck` sozinho em toda geometria com os ossos `head` e `body`, na
posição do `body`. O `pinArmorNeckLocator` da frente cliente-modelos declarava o locator igual em todas as
geometrias. O automático entra de qualquer jeito e colidia com o declarado em toda geometria.

### Prova com os dois logs

- **Sessão 2:** as 364 geometrias acusadas são exatamente as que têm `head` + `body`. Foram previstas 367 e não
  faltou nenhuma.
- **Log da beta 1 (sem declarar):**
  - 18 entidades;
  - a regra "pivô do body diferente da primeira geometria" acerta as 18 e erra uma (avalugg);
  - nuzleaf: só o body muda (10 → 10,1);
  - aipom: a cabeça é diferente e o body é igual, e não deu erro.
- Hipóteses descartadas: cabeça (pivô/rotação/cubos), transformação no mundo e pivô do pai.

### Mudança

- Saíram o `pinArmorNeckLocator` e a sua chamada.
- Novo `tools/importer/headLocator.ts`, pós-passe no `index.ts`:
  - nas geometrias cujo pivô do `body` difere do da primeira da entidade, o osso `head` vira `cobblemon_head`, e sem
    `head` o cliente não cria o locator. São 19 geometrias em 19 entidades (as 18 do log + avalugg);
  - as 153 animações dessas entidades ganham o canal `cobblemon_head` copiado do `head`, e a forma continua animando
    igual;
  - os locators declarados direto no osso da cabeça vão para um filho `cobblemon_head_locators` no mesmo pivô, em
    todas as geometrias da entidade. É o caso do `head` do zacian do MSD: a definição inclui o osso.
- O validate agora modela o locator automático na regra 3 e acusa quem declarar `armor_offset.default_neck`. Deu 0 no
  base e 0 no base + MSD.
- Nenhum outro nome de locator colidiu na sessão 2: as 364 linhas eram todas `armor_offset.default_neck`.

### Teste

`tests/cliente-modelos.test.ts`: o bloco do `pinArmorNeckLocator` foi trocado pela regra nova (assinatura pelo body,
plano de renomeação e renomeação com o `parent` dos filhos).

### Não dá para conferir sem o cliente

Se a regra "head + body" vale para as 19 formas. A sessão 2 explica 364/364 geometrias; a beta 1 explica 18/19.

## 6. `tools/client-log-summary.mjs`: sessões

- Uma sessão começa num bloco de `Plugin Discovered [<pack>] PackId [<uuid>_<versão>]`. O cabeçalho lista cada
  sessão com a linha, a hora, os packs e as versões.
- Por padrão, resume só a última sessão. `--all` junta todas e `--session N` escolhe uma.
- O antigo `--all` (níveis verbose/inform) virou `--all-levels`.
- Saída `--json` com as sessões.
- Nova tabela "Frente fix3": StackOverflow, `armor_offset.default_neck`, fatia lenta do spawner e `render_method`
  recusado. Deve ficar em 0 no próximo teste.

Neste arquivo: 2 sessões (v0.0.1 na linha 1 e v1.0.2 na linha 36.558). A sessão 2 tem só dois grupos:

- 364 `armor_offset.default_neck` (item 5);
- 8 fatias lentas do spawner (item 4).

## 7. Sessão 1 (mistura beta 1/beta 2): cada grupo contra o build atual

`node tools/client-log-summary.mjs ... --session 1`. Os grupos são antigos: o RP da beta 1 foi carregado junto com o
BP 0.0.1. Cada categoria tem regra no `npm run validate`, que dá OK no build atual (base e base + MSD):

| Grupo (sessão 1) | Linhas | Build atual |
|---|---|---|
| catmullrom com Molang (animação não toca) | 9.030 | regra 1 (cliente-modelos): 0 |
| Molang recusado em animação / client entity | 857 | regra 2: 0. `NaN` em animations do `dist-fix3`: 0 arquivos |
| locator repetido entre geometrias (inclui 18 `default_neck`) | 751 | regra 3: 0. `default_neck` no item 5 |
| geometria inválida / não encontrada (flabebe, barcos) | 7 | regra 4: 0 |
| render controller cita geometria não declarada | 28 | regra 4: 0 |
| estado de controller com `"animations": []` | 22 | regra 5: 0 |
| chave inválida em bones | 2 | regra 5: 0 |
| `can't find animation linoone.*` (arquivo recusado pelo catmullrom) | 15 | as animações existem no RP; o validate confere cada animação citada pela client entity |
| som sem arquivo (`Invalid asset path sounds/…`) | 224 | regra cliente-log: 0. `sounds/pokemon` no `sound_definitions` do `dist-fix3`: 0 |
| geometria de bloco fora dos limites / `cannot find geometry` | 1.744 | regra cliente-log: 0 (com o y até −13,75 do item 3) |
| feature `v.worldx`/`v.worldz` | 4.866 | regra cliente-log: 0 |
| partículas (LevelSoundEvent, componente, Molang, `radius too large`) | 112 | regras cliente-log: 0 |
| spawner: passe lento (fatia única, antes do fatiamento) | 5 | item 4 |

## Verificação

- `npm run import`: OK (base + MSD).
- `npm run validate`: `OK: nenhum erro` no base e no base + MSD.
- `npx tsc -p tsconfig.json`: 0 erros.
- `npm test`: todos passam, incluindo `tests/cliente-teste2.test.ts` (7 testes), `cliente-modelos` e `telas`.
- `node tools/check-ui-baseline.mjs`: ok.
- BDS `cobblemon-bds-fix3` (porta 19178, `dist-fix3`, RakNet, online-mode=false), com bot:
  - **Subida com o build final:** nenhum ERROR/WARN de conteúdo. Na tentativa anterior, com `render_method` misto,
    apareceram 20.544 avisos "same render_method"; ver o item 3. Uma subida abortou com `corrupted size vs.
    prev_size` (glibc, BDS x86 no box64 do Mac). Reiniciado com o mesmo build, subiu `healthy` e ficou estável em
    todos os testes.
  - **E2E base** (`COBBLEMON_MSD=0 node tools/e2e/run.mjs`): **10/10**. No log, só o que o harness já produzia:
    `No targets matched selector` do preparo e `FormRejectError: Player quit before responding` de bots saindo com a
    troca/diálogo aberto.
  - **`/cobblemon:selftest quick`** (cenário avulso com o bot no chão via `spreadplayers`): terminou em 4 min 07 s
    com 0 falhas. `verificação: área 0 bloco(s) não-ar, 0 entidade(s)`. Movimento:
    `cercado 40/40, piscina 20/20, ar 23/24; montarias 3/3 (mudsdale LAND, lapras LAND>LIQUID, altaria
    LAND>AIR>LAND)`. O Lapras virou LIQUID e tocou o som da montaria, que é o caminho do crash. O 23/24 é o unown no
    ar, que não se mexeu nessa rodada. As fases `ui` (estúdio do inicial) e `battle`
    rodaram sem nenhum ERROR/WARN de script.
  - **Spawner:** bot no chão, `enableSpawning` ligado por 150 s. **0 avisos de `passe lento`** (limite de 20 ms na
    maior fatia) e Pokémon nascendo em volta.
- Container removido no fim (`docker rm -f cobblemon-bds-fix3`). O `cobblemon-bds` não foi tocado.

## Arquivos

### Scripts

- `scripts/npc/molang/MoLang.ts`
- `scripts/debug/SelfTest.ts` (só a linha do resumo)
- `scripts/spawning/SpawnSelector.ts`, `Spawner.ts`, `SpawnConditions.ts` (tipo do `hasSpaceJob`)
- `scripts/ui/studio/Studio.ts`, `index.ts`

### Importador

- Novos: `tools/importer/zfight.ts`, `headLocator.ts`, `studioFraming.ts`.
- Alterados:
  - `blockModels.ts` (limite de y);
  - `models.ts` (sem o pin; `separateCoplanarCubes`);
  - `locators.ts` (sem `pinArmorNeckLocator`);
  - `index.ts` (pós-passes e o módulo novo);
  - `validate.ts` e `validateClientModels.ts` (regras);
  - `megaShowdown.ts` (arquivo privado, fora do git: uma chamada depois do `emitMsdContent`).

### Ferramentas

- `tools/client-log-summary.mjs`

### Testes

- Novo: `tests/cliente-teste2.test.ts`.
- Alterados: `tests/cliente-modelos.test.ts` (bloco do pin trocado) e `tests/telas.test.ts` (limite de distância).

### Observação

O `tsc` avulso de `tools/importer/megaShowdown.ts` acusa um erro que já existia, na linha 226 (`Combo.poser`), fora
do trecho alterado. O `npm run import` roda normalmente.
