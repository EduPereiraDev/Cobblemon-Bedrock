# Frente ui-cliente (1º teste em cliente real: telas sem texto, HUD sem nível, Poké Ball mirando o Pokémon)

Cliente: Windows, Bedrock 26.x. Evidências: screenshots do usuário e o content log do cliente
`ContentLog2026-09-27_05-17-38_1.txt`. O BDS não carrega UI e os bots não renderizam, então nenhum teste anterior via isso.

## Causas-raiz (com evidência)

| # | Sintoma | Causa | Evidência |
|---|---|---|---|
| 1 | Nas telas roteadas (inicial, batalha, resumo, PC, Pokédex), células sem texto, sem retrato e sem fundo (os "pontinhos" do inicial, o PC com todas as células vazias) | `tools/ui/gen-telas.ts` colocava os filhos das células **sem nome** em `controls` (`[{ "type": "image", ... }]` em vez de `[{ "nome": { ... } }]`). O cliente descarta o controle. | Log: 11.700× `Type not specified (or @-base not found) for control:` em `.../router/<tela>/.../cell_N/{ui_control}`. Validador novo: 431 itens sem nome nos 5 arquivos. |
| 2 | As 4 células da batalha iguais (4 tiles vermelhos com o ícone de Lutar, 4 tiles de golpe da mesma cor) e cliques que não escolhem a célula certa | Os contêineres das células eram `type: "panel"` com `collection_name`. Na vanilla, `collection_name` só existe em `grid`, `stack_panel`, `collection_panel` e `grid_page_indicator`. Num `panel` a coleção não é criada, o `collection_index` dos filhos é ignorado e toda célula lê o botão 0. O único controle que sobrava (o `hover` do clique, 2º quadro da textura) mostrava o botão 0: o quadro vermelho de `battle_menu_fight`. | Log: 7.000× `Unknown property [collection_index]` em `def[cell_N]` e 540× `Unknown property [collection_name]` em `def[box]`, `def[pc_form]`, `def[tiles]`, `def[cells]`, `def[info]`... (`def[info]` não tem filho sem nome, então o erro 2 é independente do 1). No bedrock-samples 26.50, `collection_name` aparece em grid (133×), stack_panel (93×), collection_panel (3×) e grid_page_indicator (1×), e nunca em panel. |
| 3 | HUD do time: nome e retrato aparecem, o nível fica vazio | Os campos são fatiados do título com `('%.Ns' * #p) - '\t'`. Um resultado só com dígitos (`31`) vira **número** no cliente. `('§r' + #lvl)` deixa de ser texto, e o label não mostra número cru (pesquisa §1.3d). O nome, que é texto, aparece. Afeta todo campo numérico: nível (party e batalha), barras (`'.../hp_v_' + #hp`), EXP e as flags comparadas com `'1'` (`v`, `own`, `min`, `pr`, `cur`, `n`, `use`, `lu`). | Único campo exibido que falhava é o único numérico. O log não tem erro de HUD (é semântica, não estrutura). |
| 4 | Poké Ball só sai mirando acima do Pokémon | No Bedrock, usar item com a mira numa entidade dispara `playerInteractWithEntity`, e não `itemUse`. O `main.ts` cancelava a interação e chamava `handlePokemonInteract`, então o `minecraft:throwable` nunca lançava. | Relato do usuário. No Java, `PokemonEntity.mobInteract` não trata Poké Ball, passa, e o `PokeBallItem.use` arremessa. |

Observações sem correção (fora da causa comum):
- "Retrato do 1º cortado": `portraits/<espécie>_0` é um recorte do rosto, como o party overlay do Cobblemon (modelo com
  tesoura de 21 px). O 1º slot é o selecionado e fica 6 px à direita, como no Java. Conferir se o recorte é o esperado.
- "3 slots vazios": o Cobblemon também desenha os espaços vazios do time (`party_slot_collapsed`). Paridade.
- O log também mostra erros de outras frentes, que não são desta: `variable.worldx` em feature rules,
  `*_berry_growth` sem geometria, animações "Precomputed cubic interpolation" e partículas sem `collision_radius`.
  O `item.cobblemon.strange_ball` aparecia sem tradução no inventário (screenshot). O `generated/` atual já tem a
  chave, em pt_BR ("Bola Estranha") e en_US, vinda da mudança em andamento em `tools/importer/lang.ts`.

## Correções

- `tools/ui/gen-telas.ts`:
  - `cellPanel`, `pc_form` e `pc_content` passam a ser `collection_panel`, o padrão vanilla para índices fixos em
    posições livres (`store_common.json` `screenshots_grid`);
  - `nameControls()` no `generate()` dá nome estável a todo item de `controls` sem nome (`image_0`, `label_1`...).
  - Regerados: `ui/{battle,summary,starter,pokedex,pc}.json`.
- `tools/ui/uiRules.mjs` (novo): reproduz as regras do carregador do cliente. Cobre item de `controls` com uma chave e
  valor objeto, `type` ou `@base` resolvível, `collection_name` só nos tipos de coleção, `collection_index` só em filho
  direto de contêiner de coleção e propriedade que a vanilla nunca usa naquele tipo (tabela derivada do
  bedrock-samples). Ligado ao `tools/check-ui-baseline.mjs` (seção 7) e ao `tests/ui-cliente.test.ts`. Contra os
  arquivos antigos, acusa 710 erros das mesmas classes do log. Contra os atuais, 0.
- HUD (`scripts/ui/hudProtocol.ts`, `tools/ui/gen-hud.ts` → `ui/cobblemon_hud.json`):
  - `FieldSpec.lead` é um prefixo fixo que faz parte do valor, e o `encodeRecord` o aplica a valores não vazios;
  - campos exibidos usam código de formatação invisível: nível da party `§r31`, nível da batalha `§l50`, EXP ganha
    `§l120`;
  - campos comparados ou usados em caminho de textura usam `_` (`NUM_LEAD`): `hp`/`exp`/`hpw` = `_18`, e o JSON junta
    `hp_v` + `_18` = `hp_v_18`. As flags `v`/`own`/`use`/`lu`/`min`/`pr`/`cur`/`n` são comparadas com `'_1'` etc.;
  - larguras: +1 byte por campo `_` e +3 por campo `§`. Cabeçalho da batalha: `min`/`pr`/`cur` em 55/57/59.
    Registro: tile 90 e golpe 41.
- Poké Ball: `scripts/catching/ThrowBall.ts` (novo) e 8 linhas no `scripts/main.ts`
  (`beforeEvents.playerInteractWithEntity`). Com qualquer Poké Ball do Cobblemon na mão, usar mirando um Pokémon cancela
  a interação. No tick seguinte, o jogador arremessa o mesmo projétil `cobblemon:<bola>` do throwable nativo, com
  `EntityProjectileComponent.shoot`, dono = jogador, potência `projectilePower(bola)` e 1 unidade consumida fora do
  criativo. A captura segue igual em `catching/index.ts`. Exceções como no Java:
  - agachado (Java: roda de interação; port: dar item ao próprio Pokémon);
  - clone de batalha (`mobInteract` = FAIL);
  - exibição de NPC com modelo de Pokémon.

  Em batalha, mirar no selvagem com a bola arremessa (captura em batalha) em vez de reabrir o menu. Mirar num Pokémon
  de uma batalha alheia arremessa (o Java faz o mesmo e falha com "em batalha"), em vez de assistir. Entidades que não
  são Pokémon ficam com a interação própria (barco, carrinho, aldeão, NPC, jogador), como no Java, onde o
  `mobInteract` delas consome o clique.
- Testes:
  - `tests/ui-cliente.test.ts` (novo): regras do cliente em todos os `ui/*.json` e o caso negativo com os 4 erros do log;
    células em `collection_panel` com rótulo e ícone nomeados; HUD sem campo só de dígitos e sem comparação com
    literal numérico; decisão, velocidade, origem, dono, consumo, criativo e troca de item do arremesso;
  - `tests/ui-base.test.ts` e `tests/batalha-minimizavel.test.ts`: valores decodificados com o prefixo (`§r5`, `_18`,
    `_1`) e offsets 55/57/59;
  - `tests/e2e/scenarios/10-batalha-minimizavel.e2e.mjs`: o parser do bot lê os campos de 2 bytes e tira o `_`. Não é
    máscara: o bot compara o mesmo valor lógico.

## Premissas sobre o cliente (documentadas; escolhidas pela robustez)

1. `collection_panel` + `collection_index` fixo é o padrão vanilla (store) e funciona com a coleção `form_buttons` do
   form de servidor, como `stack_panel`/`grid`. Os filhos herdam o índice da célula, como em `pdp_screenshots_section`.
2. Resultado de expressão só com dígitos vira número. Com o prefixo, o protocolo fica certo nas duas hipóteses.

## O que conferir no cliente (com o content log ligado)

- Content log: nenhuma linha `[UI][error]` com `cobblemon_form_factory/router` (antes eram ~19 mil).
- Inicial: lista de categorias à direita com fundo e nome (Kanto em amarelo), nome do inicial embaixo do modelo, tipos,
  descrição, setas ◀ ▶ com os vizinhos, "Eu escolho você!" (e "Aleatório" quando a categoria tiver). Cada linha
  clicável troca a categoria.
- Batalha, "O que você fará?": 4 tiles cinza com o nome (Lutar, Mochila, Pokémon, Fugir) e o ícone de cada ação
  à direita (espadas, mochila, troca, corredor). Ao passar o mouse, cada tile mostra a própria cor: vermelho, amarelo,
  verde e azul.
- Batalha, golpes: 4 tiles pintados pela cor do TIPO de cada golpe, com nome, PP, categoria e efetividade, mais o
  voltar. Alvo, troca (retrato + barra de HP) e mochila com texto.
- Resumo: nome, nível, item, tipos, abas, atributos com barras, golpes, marcas, time à direita.
- PC: rostos na caixa e no time, nome da caixa entre as setas << >>, prévia do selecionado à esquerda.
- Pokédex: grade 5×5 com rostos e números, botões com texto, entrada com perfil e plataforma.
- HUD do time: "Nv." com o número embaixo, barras verticais de HP (verde) e EXP (azul), bola, gênero.
- HUD de batalha: caixas com nome, "Nv." + nível em negrito, barra de HP e "atual/máx" (ou "NN%" do oponente).
- Poké Ball: mirando direto no Pokémon, a bola sai (e some 1 do inventário no sobrevivência). Agachado, o
  comportamento antigo continua (dar item ao próprio Pokémon).

## Verificação (2026-09-27)

- `npx tsc -p tsconfig.json`: 0 erros.
- `npm test`: tudo passa, inclusive `ui-cliente`, `ui-base`, `telas`, `batalha-minimizavel` e `dados-ui`, exceto
  `motor.test.ts`. A falha é "classes alagáveis: RingTargetBlock", de `tools/importer/blocks.ts`, que outra frente está
  editando. Não é desta frente.
- `node tools/check-ui-baseline.mjs`: ok contra v1.26.50.4 e v1.26.60.28-preview, agora com a seção 7 (regras do
  cliente). `gen-telas.ts --check` e `gen-hud.ts --check`: em dia.
- `npm run validate`: falha só com erros de conteúdo de outras frentes, os mesmos do content log:
  - `v.worldx` em feature rules;
  - geometria `*_berry_growth` fora dos limites.

  Nenhum erro é de UI.
- E2E base no BDS próprio (`uifix`, 19172, `dist-uifix`, raknet, sem MSD): **10/10**, inclusive `01-starter` com o
  fluxo novo do orquestrador (68 s) e `10-batalha-minimizavel` com o parser dos campos de 2 bytes.
- E2E avulso (`scratchpad/ui-cliente-ball.e2e.mjs`): agachado + interação no selvagem não lança bola. Com a Master Ball
  na mão, `item_use_on_entity` no Snorlax lança a bola na 1ª tentativa, `{cobblemon.capture.succeeded}`, e o time
  fica pikachu + snorlax: 1/1.
- Log do BDS: `scripts carregados em ~520 ms`. Nenhum ERROR/WARN de conteúdo ou script. Só aparecem o aviso de
  transporte raknet e o "No targets matched selector" do `kill` do cenário. Container removido.
- O lembrete do inicial na actionbar (orquestrador) não conflita com o HUD. O HUD usa o título e o scanner usa a
  actionbar com o prefixo `cbS`. Sem inicial não há time, então o estilo texto da party não disputa a actionbar.

## Pedidos

- telas/ui-base: nada a fazer. As mudanças nos arquivos gerados vêm dos geradores (`gen-telas.ts`/`gen-hud.ts`).
  Sub-marcadores, índices e o contrato do `layoutSpec.ts` não mudaram.
