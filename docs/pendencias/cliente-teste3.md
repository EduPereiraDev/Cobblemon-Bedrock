# Frente "scr": 3º teste em cliente real (beta 4) — bola que erra, modo `telas`, cobertura do `full`

BDS `scr`, porta 19179, `dist-scr`, RakNet, online-mode=false (removido ao fim). Sem commit.

## 1. Poké Ball que erra "some"

### Regra do Java (upstream/cobblemon/common/src/main/kotlin/com/cobblemon/mod/common/…)

| Situação | Java | Onde |
|---|---|---|
| Arremesso | gasta 1, menos no criativo (`itemStack.consume(1, player)`) | `item/PokeBallItem.kt:42` |
| Bateu num bloco antes de capturar | some (`discard`); **item da mesma bola** se o dono é jogador fora do criativo (`player?.isCreative == false` → `spawnAtLocation(defaultItem)`); sem dono, só some | `entity/pokeball/EmptyPokeBallEntity.kt:181-197` (188-191) |
| Acertou Pokémon e a captura foi recusada: não selvagem (209), incapturável (214), batalha de outro (224), caso impossível (228), não é 1x1 (233), não é a vez (239), ocupado (256), jogador em batalha (259), evento cancelado (272) | `drop()`: some e cai o item, menos para jogador no criativo | `EmptyPokeBallEntity.kt:199-275`, `drop()` 282-288 |
| Acertou entidade que não é Pokémon | `super.onHitEntity` (nada): a bola segue voando e cai no próximo bloco → item | `EmptyPokeBallEntity.kt:279` |
| Voou 600 ticks sem capturar | removida, sem item | `EmptyPokeBallEntity.kt:300-302` |
| Dono sumiu/morreu, ou o alvo morreu no meio | `breakFree` + `discard`, sem item | `EmptyPokeBallEntity.kt:304-308`, 333-340 |
| Pokémon escapou (captura falhou) | a bola **é gasta**: `breakFree` → `discard` 1,2 s depois, sem item | `EmptyPokeBallEntity.kt:375-377`, 394-418 |
| Capturou | a bola é gasta (vira a `caughtBall` do Pokémon) | `EmptyPokeBallEntity.kt:343-374` |

### O que o port fazia (medido no BDS antes da mudança)

Sonda com bot em sobrevivência (`/tmp` do agente, não versionada): chão, arremesso mirando um Pokémon
incapturável (caminho do `ThrowBall`), porco (entidade que não é Pokémon), água (bola afunda e bate no fundo), reto a
10 blocos e criativo. **Em todos os casos de sobrevivência o item já caía** e o bot o pegava de volta; no criativo
não caía. O "some" do cliente não se reproduziu no BDS.

Causas plausíveis no cliente, todas cobertas agora ou de acordo com o Java:
- teste no **criativo** (o `selftest` põe o jogador no criativo e restaura no fim): a bola some e não é gasta, como no
  Java;
- **Pokémon escapou**: a bola é gasta, como no Java (não é bug);
- arremesso de perto: o item cai a ~2 blocos e o jogador o pega na hora (a contagem volta, a bola "some" da tela);
- o item nascia na posição da **entidade** do projétil (`pokeball.location`/`dimension`): se o projétil já estivesse
  inválido no afterEvent, o `spawnItem` falhava num `try` (só `console.warn`) e a bola sumia; o `triggerEvent` em
  seguida ainda lançava fora do `try`.

Diferenças reais para o Java, corrigidas: bola **sem dono** caía como item (o Java só descarta) e não havia o limite
de **600 ticks** (bola que nunca acerta nada ficava para sempre).

### Mudança

- `scripts/catching/MissedBall.ts` (novo, puro): `missedBallItem(ballTypeId, thrower)` = id do item da mesma bola, ou
  `undefined` no criativo/sem dono; `BALL_MAX_FLIGHT_TICKS = 600` e `shouldExpireBall(ticks, capturing)`.
- `scripts/catching/index.ts`:
  - `dropPokeball` usa a regra acima e o **ponto do acerto do evento** (`arg.dimension`/`arg.location` do
    `projectileHitBlock`/`projectileHitEntity`), com fallback na entidade; `triggerEvent` protegido;
  - sem dono → só some; entidade que não é Pokémon → item no ponto do acerto (no Bedrock o projétil para no acerto;
    mesmo resultado, outro lugar — adaptação);
  - captura recusada (`handleBallHit`) → item no ponto do acerto;
  - `entitySpawn` agenda a expiração em 600 ticks (some sem item se não começou captura).
- Sem mudança: `ThrowBall.ts` (já gasta 1 só fora do criativo, igual ao `PokeBallItem.use`) e `CaptureSequence.ts`
  (escapou/capturou = bola gasta, como no Java; a devolução ao inventário quando a entidade da bola morre antes do
  cálculo é a proteção do E2E-3, específica do Bedrock, mantida).

### Testes

- `tests/cliente-teste3.test.ts` (10): regra pura (mesma bola, ancient, desconhecida → Poké Ball; criativo e sem dono →
  nada; 600 ticks) e os **handlers de verdade** do `catching/index.ts` com entidades falsas: bloco em sobrevivência
  (1 item no ponto/dimensão do evento, bola removida), criativo (sem item), bola já em captura (ignorada), porco (item),
  não selvagem e incapturável (mensagem + item; criativo sem item), sem dono (sem item), expiração agendada em 600
  ticks (sem item; não expira em captura).
- `tests/e2e/experimental/bola-erra.e2e.mjs` (BDS + bot, ✓ 62,7 s):
  - `chão: 8 → 7 bolas; item @17.5,170.3,42.7` (`add_item_entity cobblemon:great_ball`), `coleta: 8 bolas` (o bot anda
    até o item e ele volta ao inventário);
  - `recusada: mensagem sim ({cobblemon.capture.cannot_be_caught}); item sim` (arremesso mirando o Pokémon);
  - `criativo: arremesso sim; 0 item(ns); 7 → 7 bolas`.
  - Log do servidor: só o `No targets matched selector` do preparo do runner (antes de o bot entrar).

Status: FEITO (regra do Java inteira; o "some" do cliente não se reproduz no BDS; ver as causas acima).

## 2. Modo `telas` do selftest

`/cobblemon:selftest telas [segundos]` (alias `screens`; `scriptevent cobblemon:selftest telas [segundos] [jogador]`).
Pedido do orquestrador incorporado: cada tela fica um tempo fixo (padrão 10 s, de 3 a 60) e avança sozinha; fechar
antes avança na hora; `stop` funciona; mesma sessão/restauração dos outros modos (área, journal, criativo, câmera,
inventário, dados, HUD).

Por tela:
- actionbar por ~2 s: "Tela N/total: nome", e no chat "Tela N/total: nome - tire o print" (o começo explica o atalho
  Win+Alt+PrtScn → `Videos\Captures`);
- com a tela aberta, a actionbar conta os segundos que faltam (nas telas de form o Bedrock pode não desenhar a
  actionbar por cima: não dá para conferir sem o cliente; o aviso antes basta);
- fim: `closed` (o jogador fechou/clicou: a promessa da tela terminou; no diálogo, o diálogo acabou), `timeout` ou
  `stopped`; linha `[selftest] tela N/total <chave>: <fim> em X s` no log.
- No fim, o chat lista a ordem numerada (a mesma dos prints) e o resumo "Telas: X de Y (A fechadas por você, B pelo
  tempo)".

### Telas (36, nesta ordem)

1. Inicial: categorias (2D) · 2. Inicial: estúdio 3D · 3. Inicial: confirmação · 4. Lembrete do inicial (actionbar) ·
5. Time · 6. HUD do time · 7–10. Resumo: Info, Golpes, Atributos, Marcas · 11–14. Resumo 3D: Info, Golpes,
Atributos, Marcas · 15. PC: caixa com Pokémon · 16. PC: caixa vazia · 17. Pokédex: lista de Pokédex · 18. Pokédex:
página de entradas · 19. Pokédex: entrada (Pikachu) · 20. Diálogo de NPC · 21. Troca · 22. Batalha: ações ·
23. Batalha: golpes · 24. Batalha: golpes com gimmick (Mega, Z, Tera; Mega ligado) · 25. Batalha: troca ·
26. Batalha: mochila · 27. Batalha: alvo · 28. Batalha: desistir · 29. Batalha: HUD (simples) · 30. Batalha: HUD
(duplas) · 31. Batalha minimizada: aviso no HUD · 32. Batalha minimizada: golpes no HUD · 33. Conquistas ·
34. Estatísticas · 35. Aviso de captura (toast) · 36. Aviso de conquista (toast).

Sem categorias de inicial na config, 1–3 saem; sem Pokédex regionais, 18 sai. Time, PC, troca e golpes com gimmick são
montados com Pokémon de exemplo (mesmo título/ordem de botões das telas reais), nada entra no time do jogador.
Fora do roteiro (precisam de contexto real e um clique mudaria dados de verdade): menu de um Pokémon do time e seus
submenus (apelido, item, evolução, soltar), submenus do PC (ordenar, filtro, papel de parede, renomear, busca), editor
de config/NPC, máquinas (panela, pasto, habitat, TM), isca de pesca, Aprijuice, visão de espectador.

### Mudança

- `scripts/debug/selfTestPlan.ts`: modo `telas` + alias `screens`, fase `screens` (fora do quick/full),
  `parseScreenSeconds`, `SCREEN_TOUR`/`screenTour`, `holdScreen` (fechou / tempo / stop, contagem por segundo).
- `scripts/debug/SelfTest.ts`: `screensPhase`/`showScreen`/`screenRuns` (+ forms de exemplo do time, confirmação do
  inicial, PC vazio e golpes com gimmick), parâmetro inteiro `seconds` no comando e no scriptevent, resumo e lista da
  ordem, `showProgress` não disputa a actionbar nesta fase.
- `.lang` (en_US e pt_BR): seção `## cliente-teste3` no fim.
- Docs: `docs/COMO-JOGAR.md` (linha na tabela + "Prints de todas as telas") e `docs/COMANDOS.md`.

### Testes

- `tests/selftest.test.ts` (+4): modo/alias/plano/segundos; roteiro (telas pedidas, chaves únicas, textos nos dois
  `.lang`, abertura em `SelfTest.ts` para cada chave, filtros); `holdScreen` (fecha no tick 30 → `closed`; nunca
  fecha → exatamente o tempo, contagem 3-2-1; stop → `stopped`, e vence um fechamento no mesmo instante).
- `tests/e2e/experimental/selftest-telas.e2e.mjs` (BDS + bot): ✓ 220,7 s (build final).
  - `telas 3`, o bot fecha cada tela ~0,7 s depois de ela chegar: `[selftest] telas: 36/36 (28 fechada(s) pelo
    jogador, 8 pelo tempo de 3 s)`; cada form `closed` em 0,9–1,1 s (o diálogo em 2,0 s), as 8 de HUD `timeout` em
    3,0 s; aviso "Tela N/total" na actionbar antes de cada uma (≥ 36); instrução do print no começo; a ordem no chat é
    exatamente a das telas; `fim (ok) em 2 min 08 s ... 0 falha(s)`; `verificação: área 0 bloco(s) não-ar, 0
    entidade(s)`; bot de volta ao lugar.
  - `screens 3` (alias), o bot não fecha nada e manda `stop` em 30 s: `starter=timeout(3.0s) starter_3d=timeout(3.1s)
    starter_confirm=timeout(3.1s) starter_reminder=timeout(3.0s) party=timeout(3.0s) party_hud=stopped(1.6s)`;
    `fim (stop) em 32 s ... 0 falha(s)`; área 0/0; bot de volta ao lugar.
  - Nenhum ERROR/WARN de script no log do servidor.

Status: FEITO.

## 3. `full`: cobertura das combinações em vez da enumeração

A fase `entities` mostrava TODAS as combinações renderizáveis (8485; o Spinda sozinho 1534). Agora mostra a cobertura
mínima gulosa (`coverCombos` em `selfTestPlan.ts`): começa pela combinação 0 e pega, enquanto sobrar recurso sem
aparecer, a que mostra mais recursos novos (empate: menor índice). Recursos por combinação (`comboFeatures`): modelo
(geometria), textura base, poser (animações), cada camada `nome=textura` e o conjunto de nomes de camada (decide o
render controller). As poses/animações exercitadas por Pokémon são as mesmas de antes (parado, batalha + grito,
dormindo + golpe).

- `all`: 2588 de 8485 combinações (Spinda 1534 → 50, Pikachu 352 → 44, Gholdengo 288 → 12); `quick`: os casos
  conhecidos também pela cobertura.
- Cálculo fatiado no `system.runJob` (uma espécie por passo); no Node leva ~35 ms para as 894 espécies.
- Resumo no chat: "Combinações de Pokémon: X de Y (cobertura de todos os modelos, texturas, camadas e posers)" e a
  linha `[selftest] entidades: X de Y combinações` no log.
- Teste (`tests/selftest.test.ts`): para as 894 espécies de `generated/scripts/variants.ts`, a cobertura mostra 100% dos
  recursos (cada um conferido), inclui a 0, sem repetição, em ordem; Spinda ≤ 60; total < 40% (2588/8485);
  `pokemonTargets` usa a cobertura.

### Tempo do `full` (BDS scr, bot, Mac com box64)

`/cobblemon:selftest full` com bot (sonda no scratchpad do agente): **18 min 50 s** (antes ~33 min, soma das fases
em `docs/pendencias/selftest.md`), 0 falhas, `verificação: área 0 bloco(s) não-ar, 0 entidade(s)`, nenhuma linha de
watchdog/ERROR/WARN de script.

| Fase | Antes | Agora |
|---|---|---|
| `entities` | 22 min 04 s (8485 combinações) | **7 min 59 s** (2588 de 8485; cálculo da cobertura fatiado em ~6 s) |
| `movement` | 7 min 25 s | 7 min 25 s |
| `blocks` | 58 s | 56 s |
| `particles` | 13 s | 11 s |
| `sounds` | 40 s | 38 s |
| `ui` | 1 min 09 s | 1 min 08 s |
| `battle` | 31 s | 28 s |

Chat: `summary.entities_cover(2588, 8485)`. Pedido ao orquestrador: a tabela de tempos de `docs/pendencias/selftest.md`
(`entities` 22 min, `full` ~33 min) ficou velha; os números novos estão aqui e em `docs/COMO-JOGAR.md`.

Status: FEITO.

## Verificação

Com as mudanças desta frente sobre o HEAD (antes de outras frentes começarem a editar a árvore):

- `npx tsc -p tsconfig.json`: 0 erros.
- `npm test`: todos passaram (`cliente-teste3: 10 ok`, `selftest: 19 testes ok`, `captura: ok`, `ui-cliente: ok`).
- `npm run validate`: `OK: nenhum erro` (base e MSD).
- E2E base (`COBBLEMON_MSD=0 node tools/e2e/run.mjs --deploy --rm`, BDS scr): **10/10**, nenhum ERROR/WARN no log
  durante os cenários; o `--rm` removeu `cobblemon-bds-scr` (conferido com `docker ps -a`). O container
  `cobblemon-bds` não foi tocado.
- E2E experimentais desta frente: `bola-erra` ✓, `selftest-telas` ✓ (duas vezes; a 2ª com o build final), sonda do
  `full` ✓.

**Atenção (outras frentes ativas):** durante a verificação final apareceram na árvore mudanças de outras frentes
(ui-layout: `scripts/GUI/{Battle,PC,StarterGUI,Summary,layout,layoutSpec}.ts`, `scripts/pokedex/PokedexUI.ts`,
`resource_packs/.../ui/*.json`, `tools/ui/*`; pesca: `scripts/fishing/*`; importador: `tools/importer/*`, incluindo o
novo `validateVariables.ts`). Com elas, na última rodada:

- `tsc`: 2 erros, só em `scripts/pokedex/PokedexUI.ts` (`POKEDEX_ENTRY.FORM_SLOTS`/`FORMS` saíram do `layoutSpec.ts`);
- `npm test`: `extras-final` (a chave `cobblemon.port.pokedex.tab` do novo `PokedexUI.ts` ainda não está no `.lang`) e
  `msd-fase1` (`5 células + 1 gimmick`: 16 ≠ 17, do novo `BATTLE_MOVES`) falham; os desta frente passam;
- `validate`: 1 erro do validador novo (`dynamax_aura.particle.json` lê `v.entity_width` sem definir).

Nenhum desses é desta frente. O roteiro `telas` usa `BATTLE_MOVES`, `GIMMICK_ON_MARKER`, `buildStarterForm`,
`showSummary`, `openDexList`/`openDexPage`/`openPokedex` e `CellForm` pelos nomes exportados. Se a ui-layout mudar o
layout, as telas de exemplo acompanham os índices, mas **vale rodar `selftest-telas.e2e.mjs` de novo depois que ela
terminar**.

## Arquivos

- `scripts/catching/MissedBall.ts` (novo), `scripts/catching/index.ts`
- `scripts/debug/selfTestPlan.ts`, `scripts/debug/SelfTest.ts`
- `resource_packs/CobblemonBedrock/texts/en_US.lang`, `pt_BR.lang` (seção `## cliente-teste3`)
- `tests/cliente-teste3.test.ts` (novo), `tests/selftest.test.ts`
- `tests/e2e/experimental/bola-erra.e2e.mjs`, `tests/e2e/experimental/selftest-telas.e2e.mjs` (novos)
- `docs/COMO-JOGAR.md`, `docs/COMANDOS.md`, este arquivo
