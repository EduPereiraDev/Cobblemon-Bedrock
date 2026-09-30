# Telas empilhadas: o menu do Infernape desenhado por todos os layouts de uma vez

Relato do cliente real (Windows, Cobblemon público v1.0.10, sem Mega Showdown): "Meu [Pokémon] evoluiu para a última
evolução [Infernape]; quando clico nele dá isso". No print aparecem, uns por cima dos outros, a grade do PC com
"Recolher/Sumário/Mandar/Soltar" nas células do time, o resumo com "Poder/Precisão/Efeito", a barra da batalha
("Recolher Recolher Sumário Sumário Movimentos…"), o título da tela inicial (bola + "In…"), botões 👍/👎 e a lista
do menu do Pokémon. O Pokémon segura o Cabo de Ligação (`cobblemon:link_cable`).

## Leitura do print

Todas as cópias mostram **o mesmo conteúdo**: o menu do Pokémon (Nv. 36, 107/107, "Item segurado: Cabo de Ligação",
Recolher/Sumário/Movimentos/Mudar item segurado/Apelido/Mandar para o PC/Soltar). Ou seja, é o mesmo form desenhado
pelos layouts do roteador (`ui/cobblemon_forms.json`: PC, resumo, inicial, Pokédex, diálogo, batalha), e não telas
diferentes abertas juntas. As cópias deslocadas ("Recolher Recolher") indicam também mais de um form empilhado.

## Causa (duas, medidas no BDS)

### 1. Título lido como número pelo JSON UI (causa principal; por que só o Infernape)

- O título do menu do Pokémon (`scripts/GUI/Party.ts`, `showPartyPokemonMenu`) é só o nome:
  `{"rawtext":[{"translate":"cobblemon.species.infernape.name"}]}`, que resolve para "Infernape", sem marcador de tela.
- O roteador escolhe o layout com operações de string em `#title_text`: `((#title_text - '§0§1§r') = #title_text)`
  (`ui/server_form.json` para o `long_form` vanilla, `ui/cobblemon_forms.json` para cada layout).
- O JSON UI converte para número uma string que começa com algo que um parser numérico aceita. O parser é do tipo
  `strtod`: espaço, sinal, dígito, ".5", **"inf"**, "nan". "**Inf**ernape" vira infinito. Com número, o `-`/`=` de
  string deixa de valer (inf − inf = NaN), a condição `not (… = #title_text)` fica verdadeira para **todos** os
  marcadores, e todos os layouts aparecem ao mesmo tempo.
- **Só o Infernape**, entre as 1025 espécies nas duas línguas (`generated/.../texts/en_US.lang` e `pt_BR.lang`),
  começa com um prefixo numérico. Chimchar e Monferno não começam. Isso bate com o relato: o bug começou na última
  evolução. Também seriam afetados apelidos como "Nancy", "Info" ou "007", o golpe "10,000,000 Volt Thunderbolt"
  (título da tela do golpe em `Moves.ts`), nomes de jogador e de caixa que comecem com dígito, e títulos de NPC.
- **Baseline (código v1.0.10)**, `tests/e2e/experimental/telas-empilhadas.e2e.mjs`: 11 menus do Infernape com
  `{"rawtext":[{"translate":"cobblemon.species.infernape.name"}]}` → "Infernape", todos marcados como numéricos.

### 2. Um menu por clique, mesmo com o anterior aberto (agravante: as cópias empilhadas)

- Cada clique no Pokémon chega como uma interação, e `showPokemonMenuFromEntity` abria um form novo em cada uma.
- **Baseline**: 5 cliques a cada 60 ms geraram 5 `modal_form_request` sem resposta (4 sobreposições), e 3 cliques a
  cada 400 ms geraram 3 (2 sobreposições). O item de controle na mão e a mão vazia abrem 1 form cada. Agachado com a
  mão vazia troca o item segurado, sem form.
- `third_party_server_screen` tem `force_render_below: true` (`ui/server_form.json`: mundo e HUD visíveis atrás dos
  forms). Forms empilhados no cliente ficam todos visíveis uns através dos outros. Com título normal, as cópias do
  mesmo `long_form` se sobrepõem exatamente e passam despercebidas. Com o título do Infernape, cada cópia desenha
  todos os layouts.

### Hipóteses descartadas

- **Confirmação de evolução junto com o menu (👍/👎)**: o port não abre prompt de evolução. A subida de nível só põe
  a evolução em `readyEvolutions` e manda `cobblemon.ui.evolve.hint`. A evolução vem do botão "Evoluir" do menu.
  No E2E, a batalha que levou o Monferno ao nível 38 abriu só `cobblemon.ui.moves.forget` (Close Combat), sem
  sobreposição. Os 👍/👎 do print vêm de um dos layouts roteados, desenhando os botões do mesmo menu.
- **Retentativas de UserBusy do `CellForm.show`**: esse caminho não aparece aqui. O menu do Pokémon usa
  `ActionFormData.show` direto, sem retentativa.

## Paridade com o Java

No Cobblemon Java existe uma tela por vez: interagir com o Pokémon abre a roda de interação, que ocupa a tela, e o
título nunca muda o layout. O port agora garante que o título não altera o layout e que há um menu do Pokémon (pela
entidade) por jogador de cada vez.

## Correção

| Arquivo | O quê |
| --- | --- |
| `scripts/ui/formTitleGuard.ts` (novo) | `guardFormTitle`: título sem marcador ganha o prefixo invisível `§r`. Quem já começa com `§` (marcadores de `withScreen`/`layoutTitle`, cores) fica igual, e a função é idempotente. `installFormTitleGuard` envolve `title()` de `ActionFormData`, `ModalFormData` e `MessageFormData` uma vez, e vale para todas as telas, inclusive as de extensões. Se uma classe não puder ser envolvida, só avisa no log. |
| `scripts/main.ts` | Chama `installFormTitleGuard()` no topo do módulo, antes de qualquer evento ou tela. |
| `scripts/GUI/Party.ts` (`showPokemonMenuFromEntity`) | Um menu do Pokémon (aberto pela entidade) por jogador: cliques com o menu em andamento são ignorados. `try/finally` libera a trava ao fechar e também em erro (jogador saiu). |

Não mexe no JSON UI, nos marcadores nem no roteador. Os títulos com marcador saem idênticos (conferido no teste).

## Verificação

- `tests/telas-empilhadas.test.ts` (novo):
  - reproduz o título do Infernape como numérico e confirma que, com a guarda, vira texto;
  - confere todas as espécies e golpes das duas línguas com a guarda (encontra os casos reais: Infernape e
    10,000,000 Volt Thunderbolt);
  - confere as formas de título e que marcados, `layoutTitle` e o resumo ficam intactos;
  - confere que a instalação é única e sem dupla guarda, e que `main.ts` instala no topo;
  - confere o menu único: 5 cliques geram 1 form, fechar libera, erro libera. Com a trava removida (mutante), o
    teste falha com "5 menus (esperado 1)".
- E2E `telas-empilhadas` (BDS `msd2`, porta 19212, `COBBLEMON_MSD=0`, mundo apagado antes):
  - baseline v1.0.10: **FALHA**, com 11 títulos numéricos e 6 sobreposições (acima);
  - com a correção: **ok**, com 18 forms, 0 sobreposições e 0 títulos numéricos. O título chega como
    `{"rawtext":[{"text":"§r"},{"translate":"cobblemon.species.infernape.name"}]}`, o que prova que o envoltório do
    protótipo funciona no motor de scripts do BDS 1.26.52. Os 5 cliques a cada 60 ms e os 3 a cada 400 ms abriram
    1 form cada.
- `npx tsc -p tsconfig.json`, `npm test`, `node tools/check-ui-baseline.mjs`, `npm run validate` e a suíte E2E base
  (10/10, com a correção, no mesmo BDS).

## O que só o cliente confirma

1. Menu do Infernape (clique nele fora da bola, e também pelo `/cobblemon:party` → Infernape, e pelo PC): só a
   lista vanilla, sem a grade do PC, o resumo ou a barra de batalha por trás. A premissa "o JSON UI lê o título como
   número" é inferida (print + só o Infernape + regra do `strtod`). O BDS não desenha JSON UI.
2. Clique repetido e rápido (ou segurar o botão) no Pokémon: uma tela só.
3. Apelidos que começam com dígito ou "Nan"/"Inf" (ex.: "007", "Nancy") e a tela do golpe "10.000.000 Volt
   Thunderbolt" (Movimentos → golpe): layout normal.
4. Telas roteadas (PC, resumo, batalha, inicial, Pokédex, diálogo de NPC) sem mudança visual. O título delas já
   começava com o marcador, e a guarda não as altera.

## Lacunas

- A trava de "um form por vez" cobre o menu aberto pela entidade (o caminho do relato). O `/cobblemon:party` e o
  item de controle no ar têm só o debounce de 6 ticks do controle (`REPEAT_TICKS`). Dois usos no ar com mais de
  0,3 s entre eles, antes de a tela aparecer, ainda podem abrir duas listas do time. Não houve relato desse caso nem
  medição dele neste ciclo.
