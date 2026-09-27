# Frente "selftest" (teste automático no mundo para gerar o ContentLog do cliente)

Pedido: um comando que o jogador roda DENTRO do mundo, no cliente real (Windows/celular), e que exercita o add-on de
ponta a ponta sozinho, para o ContentLog do cliente registrar os erros de recursos (o cliente só acusa um recurso quando
ele é usado: modelo, animação, render controller, partícula, som, bloco, tela JSON UI).

## O que foi feito

- `/cobblemon:selftest [quick|full|ui|entities|movement|blocks|particles|sounds|battle|stop|status]` (operador + cheats;
  sem argumento = `quick`) e `scriptevent cobblemon:selftest <modo> [jogador]`.
- `scripts/debug/SelfTest.ts` (runtime), `scripts/debug/selfTestPlan.ts` (lógica pura: modos, amostras, lotes com
  parada, grade, registro de blocos, diferença de dynamic properties, journal, âncoras),
  `scripts/debug/selfTestManifest.ts` (stub; no build vira o manifesto lido dos packs).
- `tools/selftest/manifest.mjs`: plugin do esbuild que lê os packs JÁ MESCLADOS em `dist*/` (só o pack base, nada do
  Mega Showdown) e gera as listas de partículas (1040), sons (2266), blocos com estados (395 / 2059 permutações de um
  estado por vez), entidades que não são Pokémon (110, com propriedades inteiras e animações `animation.*`) e as
  capacidades de locomoção de cada Pokémon lidas do JSON da entidade (`w` anda / `s` nada / `f` voa: random_stroll,
  random_swim, random_fly e o tipo de navegação; 894 espécies). Os Pokémon vêm de `generated/scripts/variants.ts`
  (894 espécies, 8485 combinações renderizáveis = `cobblemon:variant`).
- Registro (mudança mínima): 1 import + 1 chamada em `scripts/commands.ts` (`registerSelfTestCommand`), 1 entrada no-op em
  `scripts/events/ScriptEvents.ts` (para o `scriptevent` não avisar "inválido"), 2 linhas em `tools/build.mjs` (plugin).
- Textos: seção `## selftest` no fim de `resource_packs/CobblemonBedrock/texts/en_US.lang` e `pt_BR.lang` (fase
  `movement` e o resumo dela incluídos).
- Docs: `docs/COMO-JOGAR.md` (seção "5. Teste automático para gerar o log") e `docs/COMANDOS.md` (comando e script event).
- Testes: `tests/selftest.test.ts` (Node, 15 testes) e `tests/e2e/experimental/selftest.e2e.mjs` (BDS + bot).
- Fase `movement` (esta rodada): só arquivos da frente (`SelfTest.ts`, `selfTestPlan.ts`, `selfTestManifest.ts`,
  `tools/selftest/manifest.mjs`, testes, docs, seção dos `.lang`). Usa, sem editar, as funções exportadas do módulo de
  montaria (`trackMountIfRidden`, `onJumpPressed`, `getRideStyle`, `forgetMount` em `scripts/entity/Riding.ts`),
  `flushRidingDistance` (`scripts/events/PlayerStats.ts`) e o estado do rastreador de conquistas (`getAchievements`,
  `ADVANCEMENT_DEFS`, `parseAchievements`).

Só APIs estáveis (`@minecraft/server` 2.10.0 / `@minecraft/server-ui` 2.2.0): `spawnEntity` com `spawnEvent`,
`setProperty`, `playAnimation`, `BlockPermutation.resolve`/`setPermutation`, `Player.spawnParticle`/`playSound`,
`camera.setCamera("minecraft:free")`, `uiManager.closeAllForms` (estável na 2.2.0; já usado por `TradeUI`/diálogo),
`system.runJob`/`waitTicks`, dynamic properties, `Dimension.isChunkLoaded`.

## Como funciona

- Área no céu acima do jogador (25 × 15 × 31), que precisa estar só com ar (procura 48/64/32/80/24 blocos acima). Chão
  de barreira, jogador em criativo, câmera livre fixa olhando a grade.
- `entities`: lotes de 16 (grade 4×4) com `spawnEvent: cobblemon:interacted` (sem IA, como o estúdio das telas) e as tags
  `cobblemon_ui_display` + `cobblemon_selftest` (sem dados de selvagem; sobra removida no carregamento); 3 poses de 15
  ticks: parado → `cobblemon:in_battle` + animação `cry` → `cobblemon:sleeping` + `physical|special|status|recoil`.
  Depois NPC (5 skins), barcos, exibições, boia de pesca, balsa, vitrine e bolas: cada valor das propriedades inteiras
  (4 ticks cada) e cada animação da entidade cliente; bolas também arremessadas de verdade (`projectile.shoot`, marcadas
  `activated` para não capturar nem virar item).
- `movement` (depois de `entities` no `quick`/`full`): dentro da mesma área, três caixas seladas de barreira na frente da
  câmera (chão y = -1, teto y = 10, paredes x = -12/-4/4/12 e z = 0/21; interior 7 × 10 × 20 cada): **cercado**
  (andar/correr), **piscina** com água até y = 3 (nadar/flutuar) e **volume aéreo** (voar/planar). As âncoras do journal
  (y = 11) ficam acima do teto e o jogador (z = -4,5) fora das caixas; câmera livre em (0,5; 11,5; -7,5) olhando as três.
  Os originais de todas as posições são anotados antes de colocar qualquer bloco (a água que escorre não vira
  "original"); a água é colocada por último, com a piscina já fechada.
  - Montarias primeiro (`amostra`: terra `mudsdale`, água `lapras`, ar `altaria`; `all`: cada espécie montável em cada
    estilo, 109 passeios de 93 espécies; quem tem AIR e LAND faz os dois no mesmo passeio). A montaria nasce na zona do
    estilo com `cobblemon:set_owned` (grupo `cobblemon:rideable`), o jogador sobe com `rideable.addRider` e o módulo de
    montaria de verdade assume (`trackMountIfRidden` com dados de exemplo, sem dono): grupos `ride_land/ride_liquid/
    ride_air`, câmera `cobblemon:ride_orbit` no ar/água, sons de montaria. Terra: empurrões e a câmera
    `cobblemon:ride_boom` por 1 s; água: vira LIQUID ao entrar; ar: 0,7 s no chão, pulo duplo pelo mesmo caminho do
    botão (`onJumpPressed` duas vezes) → AIR, 2 s de voo e 0,6 s planando (`cobblemon:ride_air_tired`). No fim de cada
    passeio: `forgetMount`, `ejectRiders`, remove, permissão de desmontar ligada e o jogador volta ao lugar.
  - Depois as rodadas: cada espécie (cada poser diferente, ex. formas de Alola; `all` = 1018 posers) vai para as zonas do
    jeito que se move (voa → ar e, se nada, também piscina; senão anda → cercado, nada → piscina); até 20 + 10 + 12 por
    rodada, as três zonas juntas, por 80 ticks. IA de selvagem (`cobblemon:set_wild`; a propriedade `cobblemon:wild`
    volta a false no tick seguinte para despawner/spawner/brilho não tratarem como selvagem), Resistência V (nada morre
    nem solta item) e empurrões a cada 8 ticks (mais forte a cada 3º = correr; no ar, sempre com subida). Evidência no
    log: `[selftest] movimento: cercado A/B andaram, piscina C/D nadaram, ar E/F voaram; montarias G/H`.
  - Fim da fase (também no `stop`/saída): Pokémon e montaria removidos, a piscina seca com as paredes de pé (água → ar
    de cima para baixo, repetindo até não sobrar; nenhum bloco é colocado na água, porque a barreira aceita água no
    Bedrock e a soltaria depois), e cada posição volta ao que era antes da fase.
  - Conquistas: montar concluiria "started_riding" (o rastreador confere se o jogador está montado, com toast e anúncio no
    chat); durante a fase, as conquistas com esse critério contam como feitas só na memória. No fim, o estado em memória
    do rastreador é reescrito no lugar com a property restaurada (vale para todas as fases).
  - Estatísticas: a distância montada (em memória, gravada a cada 5 s) é gravada antes da restauração das dynamic
    properties, então volta ao valor antigo.
- `blocks`: páginas de 64 (grade 8×8, grama embaixo), 30 ticks à vista; cada bloco no estado padrão e cada valor de cada
  estado (um por vez; faixas limitadas a 16 valores). `quick`: padrão + estágios de crescimento.
- `particles`/`sounds`: só para o jogador (`Player.spawnParticle`/`playSound`, volume 0,12), 6 e 3 por tick;
  `stopsound` a cada 300 sons e no fim.
- `ui`: 24 telas com ~2,5 s cada, fechadas com `closeAllForms` (inicial 2D/3D montada com `buildStarterForm`, sem
  escolher; time; resumo nas 4 abas + 3D com Pokémon de exemplo; PC real + caixa de exemplo; Pokédex lista/página/
  entrada; diálogo `cobblemon:example`; troca de exemplo; batalha: menu, golpes, troca, mochila, alvo, desistir nos
  layouts de `ui/battle.json`; conquistas; estatísticas) e o HUD (time de exemplo, caixas da batalha simples/duplas/
  minimizada, 2 toasts; os canais do HudBus voltam ao que eram).
- `battle`: `startBattle` com um `BattleActor` do jogador com time temporário (Pikachu/Charmander/Squirtle nível 5,
  `battleClone`) contra um Magikarp nível 80 só com Splash; `decider` abre o menu de verdade por 2 s, fecha e joga
  golpe → troca → X Attack → golpe; `stop()` no fim (sem vencedor, sem recompensa).
- Fim: desce da montaria do teste, remove entidades (ids anotados + varredura da área), seca a água (com `movement` no
  plano e sempre na recuperação de queda), devolve blocos (registro) e limpa sobras do Cobblemon na
  área, apaga registros por posição que os blocos deixaram no mundo (ex.: `cobblemon:berry|dim|x,y,z`, só apagado
  quando um jogador quebra), devolve o jogador (posição, dimensão, rotação, modo de jogo, câmera, sons), restaura as
  dynamic properties do jogador que mudaram (Pokédex + descarte do cache, estatísticas, progresso...) e o inventário,
  manda o resumo e as instruções do ContentLog no chat e registra a verificação no log (`[selftest] verificação`).
- Parada: `stop`, jogador saiu (a área é limpa na hora; o jogador é restaurado ao voltar, pelo id ou pelo nome) ou
  queda do servidor (journal por jogador em dynamic property do mundo + "âncoras" `cobblemon:machine_storage` com o
  journal em cada chunk da área, porque um `docker kill` perdeu a dynamic property do mundo mas não os chunks; a área
  é limpa quando os chunks carregam e o jogador é restaurado ao entrar; testes resolvidos ficam em
  `cobblemon:selftest_done` para âncoras retardatárias só serem removidas).

## Tempos (BDS próprio, bot E2E, Mac com box64)

| Modo | Tempo | Cobertura |
|---|---|---|
| `quick` | 4 min 08 s | 628 Pokémon (430 espécies base + 204 combinações dos 13 casos conhecidos), 12 entidades + 5 bolas, 4 arremessos, movimento em amostra (19 s: 40 no cercado, 20 na piscina, 24 no ar, 3 montarias), blocos padrão + crescimento, 160 partículas, 160 sons, 24 telas + HUD, batalha de 4 turnos |
| `movement` | 7 min 25 s | 108 passeios de montaria (93 espécies) + 1112 Pokémon soltos (669 no cercado, 174 na piscina, 269 no ar = 1018 posers, anfíbios nas duas zonas), 34 rodadas, 0 falhas |
| `ui` | 1 min 09 s | 24 telas + HUD |
| `battle` | 31 s | 4 turnos (golpe, troca, mochila, golpe) |
| `blocks` | 58 s | 2059 permutações de 395 blocos, 0 falhas |
| `particles` | 13 s | 1040 |
| `sounds` | 40 s | 2266 |
| `entities` | 22 min 04 s | 8485 combinações de 894 espécies + 110 entidades + 49 arremessos, 0 falhas |
| `full` | ~33 min (soma das fases acima) | tudo |

## Evidência da fase `movement` (BDS `cobblemon-bds-selft2`, porta 19176, `dist-selft2`, RakNet, online-mode=false)

`tests/e2e/experimental/selftest.e2e.mjs` (✓ 909,8 s, build definitivo): `movement` completo, `ui` e `quick` até o fim,
`full` e `movement` com `stop` no meio (o do movimento durante uma montaria, com a piscina cheia), `entities` e
`movement` com o bot saindo no meio (o do movimento montado). Em todos: `verificação: área 0 bloco(s) não-ar, 0
entidade(s)`, 0 falhas, bot de volta ao lugar (e desmontado) e nenhum ERROR/WARN de script no log (só o `No targets
matched selector` do preparo do runner, antes de o bot entrar). Linhas do log:

```text
[selftest] movimento: cercado 669/669 andaram, piscina 173/174 nadaram, ar 267/269 voaram; montarias 106/108, 2 derrubada(s) pelo motor; o motor tirou o jogador da montaria: garchomp LIQUID (-), drampa LIQUID (-); sem o movimento esperado: zubat#0@air, wailord#0@water, eternatus#0@air
[selftest] fase movement (all) em 7 min 22 s
[selftest] fim (ok) em 7 min 25 s; restaurado(s) no jogador: cobblemon:adapt_rest, cobblemon:stats, -cobblemon:partner_distance, -cobblemon:last_partner_mark_check; 0 falha(s)
[selftest] verificação: área 0 bloco(s) não-ar, 0 entidade(s); dynamic properties do mundo +0 -0 ~2 [cobblemon:healer_clock, cobblemon:selftest_done]
[selftest] movimento: cercado 40/40 andaram, piscina 20/20 nadaram, ar 24/24 voaram; montarias 3/3, 0 derrubada(s) pelo motor (mudsdale LAND, lapras LAND>LIQUID, altaria LAND>AIR>LAND)
[selftest] fase movement (sample) em 19 s
[selftest] fim (ok) em 4 min 08 s; ...; 0 falha(s)
```

- `cobblemon:advancements` não aparece mais entre as restaurações (antes da correção, montar criava a property e
  concluía "started_riding" no cache em memória).
- Wailord (8 blocos de largura) e Eternatus (6 × 6) não cabem nas zonas de 7 blocos e ficam presos (imunes a dano, sem
  escapar); o zubat da rodada completa não saiu do chão nos 4 s (na amostra, 24/24 voaram).
- Queda do servidor (cenário avulso, `docker kill` 20 s depois de começar `movement`, com a piscina cheia conferida por
  `testforblock`): `teste interrompido encontrado` → bot restaurado exatamente na posição inicial → `área de um teste
  interrompido limpa ...; verificação: área 0 bloco(s) não-ar, 0 entidade(s)`; 27/27 sondas `testforblock ... air`
  embaixo da piscina e das paredes dela (3, 6 e 12 blocos abaixo): nenhuma água escorreu.
- Primeira versão (água → barreira antes de virar ar) deixou 477 blocos de água corrente na verificação (secaram
  sozinhos segundos depois): a barreira aceita água no Bedrock e a soltou ao virar ar. Trocado por secar no lugar (água
  → ar de cima para baixo, repetindo) com as paredes de pé; depois disso, 0 em todas as rodadas.

## Evidência das fases anteriores (BDS `cobblemon-bds-selft`, porta 19175, `dist-selft`, RakNet, online-mode=false)

`tests/e2e/experimental/selftest.e2e.mjs` (✓ 387,7 s na rodada final, build definitivo): `ui` e `quick` até o fim, `full` com `stop` depois de 20 s e
`entities` com o bot saindo no meio e voltando. Em todos: `[selftest] verificação: área 0 bloco(s) não-ar, 0
entidade(s)`, o bot volta para a posição inicial, 0 falhas, e o log do servidor sem nenhum ERROR/WARN de script (só o
`No targets matched selector` do preparo do runner e o aviso de transporte RakNet do BDS). Dynamic properties do mundo
no fim: +0 -0 (só `cobblemon:healer_clock`, que é o relógio da máquina de cura, e `cobblemon:selftest_done` mudam).
Do jogador, só voltam `cobblemon:stats` (batalhas), `cobblemon:adapt_rest` e os marcadores de parceiro.

Queda do servidor (`docker kill` 15 s depois de começar `blocks`, cenário avulso): a dynamic property do journal no
mundo NÃO sobreviveu, os blocos sim; com as âncoras: `âncora de um teste interrompido carregada` → jogador restaurado
na posição inicial → `área de um teste interrompido limpa ...; verificação: área 0 bloco(s) não-ar, 0 entidade(s)`.
Antes das âncoras, a mesma queda deixava 194 blocos no céu (limpos à mão com `fill` no servidor de teste).

Watchdog: nenhum aviso de script lento/travado (nem ERROR/WARN de script) em ~1 h 10 min de testes seguidos no mesmo servidor (`ui`, `quick`, `stop`, saída, queda, `blocks`, `particles`, `sounds`, `battle` e `entities` completo, 22 min); o servidor seguiu respondendo (bot com pacotes até o fim); trabalho por tick fatiado com
`system.runJob` (um spawn, um bloco ou uma célula por passo) e lotes com pausa.

## Status

| Item | Status | Prova |
|---|---|---|
| Comando + scriptevent, operador + cheats | FEITO | BDS (bot com operador) |
| `entities` (Pokémon, shiny, regionais, gênero, Alfa, NPC com skins, bolas paradas e arremessadas, barcos, exibições) | FEITO | BDS |
| `blocks` (todos os estados relevantes, máquinas e plantas) | FEITO | BDS, 2059/2059 |
| `particles`, `sounds` | FEITO | BDS |
| `ui` (inicial, time, resumo, PC, Pokédex, diálogo, troca, batalha, HUD) com fechamento automático | FEITO | BDS; `closeAllForms` estável |
| `battle` com time temporário e turnos automáticos | FEITO | BDS |
| Restauração: área, entidades, blocos, registros no mundo, posição, modo de jogo, inventário, time, Pokédex, estatísticas | FEITO | BDS + Node |
| `stop`, saída no meio, queda do servidor | FEITO | BDS |
| Progresso na actionbar, resumo e instruções do ContentLog no chat (pt_BR/en_US) | FEITO | BDS (textos no chat do bot) |
| Conquistas | FEITO | o estado em memória do rastreador é reescrito no lugar com a property restaurada; "started_riding" contido durante a fase de movimento (BDS: sem `cobblemon:advancements` nas restaurações) |
| Andar/correr, nadar/flutuar, voar/planar dos Pokémon (IA ligada + empurrões) | FEITO | BDS: 669/669 andaram, 173/174 nadaram, 267/269 voaram (1018 posers) |
| Montaria terrestre, aquática e voadora (animações de ride, câmera `ride_orbit`/`ride_boom`, planeio) | FEITO | BDS: 106/108 passeios no estilo; 2 derrubadas pelo motor (Garchomp/Drampa LIQUID, pedido abaixo) |
| Restauração do movimento: água, caixas, montaria, câmera, permissão de desmontar, distância montada | FEITO | BDS: `stop` montado, saída montado, queda com a piscina cheia |
| Resposta do cliente ao `closeAllForms` | A CONFERIR NO CLIENTE | o bot não responde ao fechamento; o cenário E2E responde "cancelado" como um cliente. Sem resposta, a promessa da tela só fica pendente (sem efeito) |
| Resultado visual no cliente real | A CONFERIR | o BDS não desenha; o ContentLog do Windows/celular é o objetivo do comando |

## Pedidos a outras frentes

- (ui-base, opcional; contornado) `forgetAchievements(playerId)` exportado em `scripts/ui/achievements/tracker.ts`. Sem
  ele, o selftest reescreve no lugar o objeto que `getAchievements` devolve (é o mesmo do cache) com a property
  restaurada; uma API de descarte deixaria isso explícito.
- (montaria / importador) **Montaria aquática de Garchomp e Drampa derruba o jogador.** O `movement` completo monta cada
  espécie em cada estilo da forma padrão; nos dois, o estilo LIQUID existe na forma padrão (`ride.""` em
  `generated/scripts/entityData.ts`), mas assim que a montaria afunda na piscina o motor tira o jogador (antes de o
  `tickRiding` trocar para LIQUID). Correlação exata no BDS: as 3 montarias derrubadas na água (Garchomp, Drampa e o
  Tauros, cujo LIQUID é só da forma Paldea-Aqua) são as únicas montáveis na água com
  `minecraft:breathable.breathes_water: false`; as outras 16 (Lapras, Wailord, Gyarados, Dragonite, Lugia...) têm
  `true` e funcionam. Hipótese a conferir: incluir `minecraft:breathable` com `breathes_water: true` no grupo
  `cobblemon:ride_liquid` gerado (ou na entidade das espécies com estilo LIQUID). O selftest lista as derrubadas na linha
  `[selftest] movimento: ... N derrubada(s) pelo motor; o motor tirou o jogador da montaria: ...`.
- (plantas, opcional) Os registros por posição (`cobblemon:berry|...`, `cobblemon:healer|...`) só somem quando um jogador
  quebra o bloco (`onPlayerBreak`); `onBreak` (troca por script, explosão, pistão) deixa o registro para trás. O selftest
  limpa os da própria área.

Container `cobblemon-bds-selft` removido no fim (`docker rm -f`); o mundo de teste fica em `.bds-selft/`. O
`cobblemon-bds` não foi tocado.

Comandos da verificação:

```sh
npx tsc -p tsconfig.json                     # 0 erros
npm test                                     # inclui tests/selftest.test.ts (15 testes)
npm run validate                             # OK: nenhum erro
COBBLEMON_BDS=selft2 COBBLEMON_BDS_PORT=19176 COBBLEMON_DIST=dist-selft2 COBBLEMON_BDS_TRANSPORT=raknet \
  COBBLEMON_BDS_ONLINE_MODE=false node tools/e2e/run.mjs --scenario tests/e2e/experimental/selftest.e2e.mjs --deploy
docker rm -f cobblemon-bds-selft2
```
