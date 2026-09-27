# Frente "comparadores" — comparador da Healing Machine (#143) e do Metronome (#74)

Técnica da panela (#40, `docs/pendencias/adaptacoes.md`): bloco custom **sem** `minecraft:redstone_consumer`, com
`minecraft:redstone_producer` por permutação (formato ≥ 1.21.120) ligado só nas faces com comparador encostado e com
a entrada virada para o bloco. Nenhum dos dois blocos tem entrada de redstone no Java nem `redstone_consumer` no port,
então não há entrada a replicar por script.

## Status

| Item | Status | Prova |
|---|---|---|
| #143 Healing Machine: comparador | FEITO | `HealingMachineBlock.getAnalogOutputSignal` = `currentSignal` = `((carga / máx) * 100).toInt() / 10`, no máximo 10. BDS `cmp` com bot conectado, variante `natural` (circuito: comparador ao norte → fio → fio → lâmpada): 35 % → comparador 3, fio 3 → 2, lâmpada acesa; 72 % → 7 → 6; 100 % → 10 → 9; 0 % → comparador desligado, fio 0, lâmpada apagada; 50 % → 5; 29,85 % → 2 e, 6 s depois, sem comando (recarga natural) → 3. Comparador de lado (entrada lateral) → 0. Segundo comparador (oeste) numa máquina já emitindo → máscara 9, 7 e depois 9 nos dois; tirar o do norte → oeste continua 9; fio no lugar do comparador → 0 (sem sinal preso); comparador de volta → 9. Luz (à noite, `getLightLevel` acima do bloco): cheia 11 (emissão 12), abaixo de cheia 10 (luz da lâmpada a 5 blocos) — a luz de cheia continua. Recarga do chunk (bot a 3000 blocos: `getBlock` = `undefined`; volta): 7 nos dois comparadores, fio 6, lâmpada acesa. Reinício do servidor: 8 nos dois (a carga subiu durante a parada; `java=8`), lâmpada acesa, sem comando nenhum |
| Panela e vaso: as duas limitações do `redstone_producer` | FEITO | Seção "Panela e vaso" abaixo: reproduzidas no BDS `cmp2` com bot (sinal preso ao esvaziar; troca norte → oeste não religa) e corrigidas com o produtor base e a recolocação do bloco, sem perder conteúdo, registro, entidade nem tampa |
| Healing Machine: recarga por tick do servidor | FEITO | Seção "Healing Machine: recarga por tick" abaixo: `doDaylightCycle false` 1,791 → 1,872 em ~12 s (antes: parada); servidor parado ~70 s e chunk descarregado ~70 s sem recarga (1,93 → 1,944), como no Java |
| #74 Metronome: comparador | FEITO | `ActivatableDecorationBlock.getAnalogOutputSignal` = 4 quando `active`, 0 senão. BDS `cmp` com bot: o **clique real do bot** (`item_use`/`click_block`, dispara `onPlayerInteract` e `playerInteractWithBlock`) alterna o bloco e o registra → comparador 4, fio 4 → 3, lâmpada acesa; clicar de novo → 0, lâmpada apagada; com um segundo comparador a leste → máscara 3, 4 nos dois; desligar → 0 nos dois. Recarga do chunk e reinício do servidor: 4 nos dois, fio 3, lâmpada acesa |

## Arquivos

| Arquivo | O quê |
|---|---|
| `scripts/comparadores/logic.ts` (novo, sem imports) | Sinais do Java, codificação em estados e as permutações (lido também pelo importador) |
| `scripts/comparadores/index.ts` (novo) | Registro, laço de 8 ticks, eventos, recolocação do bloco e sonda |
| `tools/importer/comparadores.ts` (novo) | Estados, produtor base e permutações nos blocos gerados |
| `tests/comparadores.test.ts` (novo) | Teste da frente |
| `tools/importer/index.ts` | +2 linhas: import e `emitComparadores()` depois de `emitAdaptacoes()` |
| `scripts/main.ts` | +2 linhas: import e `startComparadores()` depois de `startAdaptacoes()` |
| `scripts/custom_components/HealingMachineComponent.ts` | `export` em `readCharge`, `isInfinite` e `writeCharge`; relógio persistente por tick do servidor (`healerClock`), máquina parada com o chunk descarregado, migração dos registros antigos |
| `scripts/comparadores/replace.ts` (novo) | Utilitário comum: `replaceBlock` (recolocação no mesmo tick, mantém a água) e `replacedInPlace` (o `onBreak` que a recolocação dispara não conta como quebra) |
| `scripts/adaptacoes/potHoppers.ts` | `applyComparatorStates` recoloca o bloco quando as faces mudam (panela e vaso) |
| `tools/importer/adaptacoes.ts` | `addComparator` põe o produtor base `{ power: 0, connected_faces: [] }` (fogueiras e vaso) |
| `scripts/custom_components/machines/index.ts` (frente mundo-máquinas) | +5 linhas: o `onBreak` da fogueira ignora a recolocação (`replacedInPlace`) |
| `scripts/adaptacoes/index.ts` | Sonda: `adapt_pot <x> <y> <z> new [panela]` (panela sem jogador) e `adapt_replace <x> <y> <z>` (recoloca e mostra registro, entidade, conteúdo e itens soltos) |

## Como funciona

- **Estados** (importador): `cobblemon:comparator_faces` (0..15, máscara N=1, L=2, S=4, O=8) nos dois blocos e, na
  Healing Machine, `cobblemon:comparator_high` (bool). Formato dos dois blocos: 1.21.120.
- **Limite de permutações:** o teto de 65.536 vale para **todos os blocos do mundo** (Microsoft Learn, "Block states
  and permutations"). O pack somava 17.243 e a Healing Machine já tinha 512 combinações; um estado de força (11) ×
  máscara (16) daria 90.112 só nela. O sinal sai então do medidor que já existe (`cobblemon:charge` = floor(15 ×
  carga / máx)) + 1 bit: cada nível c cobre carga/máx em [c/15, (c+1)/15), onde o sinal é floor(2c/3) ou +1. Healing
  Machine: 512 → 16.384; Metronome: 8 → 128; pack: 17.243 → 33.235. 150 + 15 permutações com produtor (força ×
  máscara; na Healing Machine a condição lista os pares (medidor, bit) de cada força).
- **Script** (`scripts/comparadores/index.ts`): a cada 8 ticks, só blocos registrados e carregados; sem comparador e
  com os estados zerados, sai depois de olhar os 4 vizinhos. Máscara = `comparatorMask` da panela (comparador
  encostado com `cardinal_direction` = lado do bloco). Healing Machine: o medidor só é refeito pelo random tick, então
  o laço o refaz (`writeCharge`) quando está velho e há comparador (fora da cura, `busy`).
- **Registro:** Healing Machine = toda máquina com registro de carga (`cobblemon:healer|...`, criado ao pôr, usar ou no
  random tick; relido a cada 200 ticks); os dois blocos também por evento (pôr o bloco, pôr ou tirar um comparador ao
  lado, interagir), em `cobblemon:mach:comparator:<posição>`. Interação ou comparador posto/tirado atualiza no tick
  seguinte.
- **Duas limitações do Bedrock medidas nesta frente (BDS 1.26.52.3) e contornadas:**
  1. Trocar para uma permutação **sem** `redstone_producer` deixa o último sinal preso no circuito (10 → estados
     zerados, comparador e fio continuaram em 10). Entre permutações com produtor a queda propaga (10 → 1). Correção:
     produtor base `{ power: 0, connected_faces: [] }` nos componentes do bloco.
  2. Trocar `connected_faces` por permutação **não refaz as ligações**: a face nova não recebe (a oeste ficou 0 com a
     máscara 9, mesmo mudando a força 5 → 7) e a face que saiu continua recebendo (máscara 15 → 2: os 4 em 4).
     Recolocar o comparador também não liga. Com o bloco posto do zero (`setblock` sobre ar) cada máscara acende
     exatamente os comparadores certos, e recolocar o bloco no mesmo tick (`setType(air)` + `setPermutation`) refaz as
     ligações nos dois sentidos (máscara 3 → 1 → 10 → 4 → 15, medido). Correção: quando as faces mudam, o bloco é
     recolocado no mesmo tick (`replaceBlock`, mantém a água); quando só a força muda, basta a permutação. Sem block
     entity, sem drop e sem evento de jogador; os componentes dos dois blocos não usam `onPlace`/`onBreak`.

## Desvios do Java (e por quê)

1. Só comparador encostado e com a entrada virada para o bloco; ler através de bloco sólido não é reproduzido (como
   na panela e no vaso).
2. O sinal muda em até 8 ticks (o Java atualiza a cada tick da recarga); interação e comparador posto/tirado por
   jogador atualizam no tick seguinte.
3. Healing Machine depois de recarregar o chunk: no Java o `currentSignal` não é salvo (o `init` o calcula com carga 0
   antes do `loadAdditional`) e a máquina **cheia** não passa pela recarga, então lê 0 até ser usada. Aqui o sinal
   sai da carga salva (o pedido é "recarga de chunk mantém").
4. Carga em double (o Java usa Float): o cálculo usa a mesma fração do medidor, para os dois concordarem nas
   fronteiras exatas (ex. 60 %); diferença de 1 ulp em relação ao Float do Kotlin.
5. Carga infinita: no Java o ramo infinito cai no cálculo normal (bug: sem `return`). No port a máquina posta no
   criativo tem carga = máx (`readCharge`), então 10; com a config `infiniteHealerCharge` o medidor fica em 15, e a
   saída também é 10.
6. Metronome posto por estrutura ou comando, nunca tocado, fica sem registro; como ele nasce desligado (sinal 0), o
   primeiro clique o registra.

## Pedidos e observações para outras frentes

1. **ATENDIDO (ver "Panela e vaso") — adaptacoes (panela e vaso):** as duas limitações medidas acima valem para qualquer
   `redstone_producer` por permutação. Na panela/vaso, `comparatorStates(0, …)` e a máscara 0 vão para uma permutação
   sem produtor (limitação 1: sinal preso ao esvaziar com o comparador encostado), e pôr um segundo comparador numa
   panela que já emite muda só `connected_faces` (limitação 2). Não medi na panela. Se confirmar, o mesmo conserto
   serve: produtor base `{ power: 0, connected_faces: [] }` em `addComparator` (`tools/importer/adaptacoes.ts`) e
   recolocar o bloco no mesmo tick quando `cobblemon:comparator_faces` muda (`applyComparatorStates` em
   `scripts/adaptacoes/potHoppers.ts`; ver `replaceBlock` em `scripts/comparadores/index.ts`).
2. **ATENDIDO (ver "Healing Machine: recarga por tick") — dona do `HealingMachineComponent`:** esta frente só pôs `export` em `readCharge`, `isInfinite` e `writeCharge`.
   Observação anterior a esta frente: a carga do port é contada por `world.getAbsoluteTime()`, que para com
   `gamerule doDaylightCycle false` (medido: 29,85 % parado 6 s; com o ciclo ligado, 2 → 3). No Java a recarga é por
   tick e não depende do ciclo do dia.

## Panela e vaso

Reproduzido no BDS `cmp2` (1.26.52.3, RakNet, `online-mode=false`) com o bot de protocolo `Cmp2Bot` conectado o tempo
todo, circuito comparador → fio → fio → lâmpada em cada face. Estado lido pela sonda `adapt_state` (estados do bloco,
`getRedstonePower()` do comparador, `redstone_signal` do fio, lâmpada acesa ou não).

**Antes da correção (as duas limitações confirmadas nos dois blocos):**

| Caso | Panela na fogueira (terra na grade) | Vaso decorado (diamantes) |
|---|---|---|
| Esvaziar até sinal 0 | 6 pilhas → estados 7/máscara 1, comparador 7, fio 7, lâmpada acesa; `fill … 0` → estados 0/0, mas comparador **7**, fio 7, lâmpada acesa (8 s depois, igual): **preso** | 32 diamantes → 8; funil embaixo tirando 1 por vez → 7, 6, 4, 3, 1, estados 0/0 e comparador **1** (lâmpada já apagada pelo alcance do fio), igual 20 s depois: **preso** |
| Comparador norte → oeste | Estados 4, máscara 1 → 8 (só as faces mudam): comparador oeste **0**, fio 0, lâmpada apagada (6 s depois, igual): **não religa** | Estados 8, máscara 1 → 8: oeste **0**, lâmpada apagada: **não religa** |
| Recolocar o bloco no mesmo tick (sonda `adapt_replace`) | **Perde a panela:** o `onBreak` do componente da fogueira chega entre 1 e 10 ticks depois (com o bloco já de volta) e roda `onCampfireRemoved`: registro apagado e 4 itens no chão (3 pilhas de terra + a panela) | Nada se perde (registro, a mesma entidade com os 32 diamantes, 0 itens soltos; o vaso não tem `onBreak`, e o `onPlace` só reencontra a entidade) e o oeste passou a receber 8 |

**Correção** (as mesmas da Healing Machine/Metronome, com o código comum em `scripts/comparadores/replace.ts`):

1. Produtor base `{ power: 0, connected_faces: [] }` nas fogueiras e no vaso (`addComparator` em
   `tools/importer/adaptacoes.ts`; `BASE_PRODUCER` vem de `tools/importer/comparadores.ts`).
2. `applyComparatorStates` (`scripts/adaptacoes/potHoppers.ts`, usado pela panela e pelo vaso) recoloca o bloco no
   mesmo tick (`replaceBlock`: `setType(air)` + `setPermutation`, mantém a água) quando `cobblemon:comparator_faces`
   muda; quando só a força muda, basta a permutação.
3. A fogueira: `replaceBlock` anota posição e tick; o `onBreak`/`onPlayerBreak` da fogueira
   (`scripts/custom_components/machines/index.ts`) ignora a quebra se houve recolocação ali há até 40 ticks **e** o bloco
   continua sendo uma fogueira do Cobblemon (`replacedInPlace`). Quebra de verdade (bloco virou ar/outro) solta como
   antes. A tampa e o inventário ficam no registro da panela (`cookingStore`), que não é tocado.

**Depois da correção (mesmo BDS, bot conectado):**

- Panela: comparador oeste → norte (máscara 8 → 1, recolocada): norte 7, fio 7, lâmpada acesa; tampa fechada por um
  bloco de redstone embaixo (`lid: true`). Esvaziar → estados 0/0, **comparador 0, fio 0, lâmpada apagada** (5 s depois,
  igual); panela registrada, `lid: true`, 0 itens soltos. 3 pilhas → 4 no norte; norte → oeste (máscara 1 → 8):
  **oeste 4, fio 4, lâmpada acesa**; panela com as 3 pilhas, `lid: true`, `cardinal_direction` mantida, 0 itens soltos.
  Os dois comparadores (máscara 9): 4 nos dois. Tirar o bloco de redstone → `lid: false` (a tampa por redstone continua
  lendo os vizinhos). Depois de reiniciar o servidor: panela com as 3 pilhas. `setblock … air destroy` (quebra de
  verdade) → registro apagado e panela + 3 pilhas de terra no chão (a guarda não esconde quebras reais).
- Vaso: oeste → norte (máscara 8 → 1): norte 8, lâmpada acesa, mesma entidade (`-8589934474`) com 32 diamantes. Funil
  embaixo: 7, 6, 4, 3, 1 e **0** (comparador `unpowered`, 0, estável por 10 s); os 32 diamantes no funil, 0 itens
  soltos, entidade vazia. 32 diamantes de volta → 8; norte → oeste: **oeste 8, fio 8, lâmpada acesa**; registro com as
  decorações, a mesma entidade e os 32 diamantes, 0 itens soltos.
- Isolar o produtor base na fogueira não foi possível ao vivo: esvaziar sempre zera também a máscara (0/0), então a
  recolocação já solta o circuito; o produtor base fica como defesa (troca só de força para 0), como na Healing Machine.

## Healing Machine: recarga por tick

No Java a recarga está no `HealingMachineBlockEntity.TICKER`: a cada tick do servidor, com a máquina fora de uso e o
chunk carregado (block entity sem tick não recarrega), soma `maxCharge / (secondsToChargeHealingMachine × 20)`. Não há
recarga offline: servidor parado ou chunk descarregado não contam. O port contava por `world.getAbsoluteTime()`, que
para com `doDaylightCycle false` e anda com o chunk descarregado.

- Relógio `healerClock()` = ticks do servidor persistentes: dynamic property `cobblemon:healer_clock` gravada a cada 20
  ticks e retomada no `worldLoad` (`system.currentTick` zera a cada sessão). O registro guarda `s` (tick do relógio) no
  lugar de `t`.
- Chunk descarregado: a cada 20 ticks as máquinas registradas (lista relida das dynamic properties a cada 200 ticks) são
  conferidas com `isChunkLoaded`; quando o chunk volta, o `s` do registro anda o tempo que ficou fora (erro de até 20
  ticks por transição).
- Registros antigos (`t` = tempo absoluto) são convertidos uma vez no `worldLoad` com a carga de agora.
- BDS `cmp2`, `gamerule dodaylightcycle false` (`time query daytime` = 17101 o tempo todo): `cmp_heal … 0.2985` →
  1,791, ~12 s depois 1,872 (sinal 2 → 3). Servidor parado (~60 s) e, depois de ligar, chunk descarregado até o bot
  entrar (~70 s): 1,932 antes de parar → 1,944 ao voltar (sem os ~0,47 que 140 s dariam); 10 s depois 2,018. Comparador
  ao norte: `java=3 emitido=3`, comparador 3.
- Desvio que continua: durante a cura o Java não recarrega (`isInUse`); o port grava a carga ao começar a cura e soma os
  ~2–6 s da animação (≤ 0,7 % da carga com 900 s).

## Verificação

- `npm run import`: ok (`blocos com comparador (comparadores): 2`, `fogueiras com comparador (adaptacoes): 2`).
- `npm run validate`: `OK: nenhum erro`.
- `npx tsc -p tsconfig.json`: 0 erros.
- `npm test`: todos passam (`comparadores: ok`): sinais do Java, medidor + bit reproduzindo o sinal em toda a faixa e
  nas fronteiras (±1 ulp) para máx 6/7,5/10/13, exatamente uma permutação por (medidor, bit, máscara) avaliando as
  condições, Metronome, chave do registro, `updateBlock` com blocos falsos (máscara pela direção, medidor refeito,
  variante `natural` preservada, recolocação só quando as faces mudam, água mantida) e os JSON gerados (formato, sem
  `redstone_consumer`, permutações iguais às da lógica, ≤ 16.384/128 combinações).
- BDS próprio: `COBBLEMON_DIST=dist-cmp npm run build` e `COBBLEMON_DIST=dist-cmp COBBLEMON_BDS=cmp
  COBBLEMON_BDS_PORT=19159 COBBLEMON_BDS_TRANSPORT=raknet COBBLEMON_BDS_ONLINE_MODE=false node tools/server.mjs
  deploy|logs|cmd`, bot de protocolo `CmpBot` conectado o tempo todo (os circuitos só são avaliados ao vivo com
  jogador). Log com content log no console: nenhum ERROR/WARN de conteúdo ou script desta frente (só o aviso fixo de
  transporte do raknet, as sondas e as respostas dos meus comandos: `fill` sobre ar, `setblock` do mesmo estado).
  Container removido no fim (`docker rm -f cobblemon-bds-cmp`).
- O bot temporário (item_use `click_block` com o `block_runtime_id` atual do bloco, rastreado por `update_block` e
  `update_subchunk_blocks`; com o id velho o servidor recusa o clique) foi apagado. Não E2E: o caminho "pôr comparador
  como jogador" (`playerPlaceBlock`), coberto pelo laço de 8 ticks (comparadores postos por `setblock` foram
  pegos), e a cura real pelo jogador (exige Pokémon com HP faltando; o desconto usa o mesmo `writeCharge` da sonda).

- Rodada "Panela e vaso" + recarga por tick: `npm run import` ok (fogueiras e vaso com o produtor base, conferido no
  JSON gerado), `npm run validate` `OK: nenhum erro`, `npx tsc -p tsconfig.json` 0 erros, `npm test` todos passam
  (saída 0). Testes novos: `tests/adaptacoes.test.ts` seção 8 (só força → permutação; faces mudam → recolocado com os
  outros estados e a água, nos dois blocos; esvaziar → 0/0 recolocado; `replacedInPlace`: sem recolocação, recolocada e
  ainda fogueira, quebrada logo depois, outra dimensão, janela vencida; produtor base nos 3 JSON gerados) e
  `tests/comparadores.test.ts` seção 8 (sobe por tick com o tempo absoluto parado; relógio retomado do valor gravado,
  sem recarga com o servidor parado; parado com o chunk descarregado; limite e infinita; migração do registro antigo;
  tick à frente do relógio sem carga negativa). BDS `cmp2` (`COBBLEMON_DIST=dist-cmp2`, `COBBLEMON_BDS=cmp2`, porta
  19160, RakNet, `online-mode=false`), bot `Cmp2Bot` conectado; content log no console sem ERROR/WARN de conteúdo e
  nenhum WARN de script desta frente fora das sondas (só `[spawn] passe lento`, da frente spawn, e o aviso fixo de
  transporte). Container removido no fim (`docker rm -f cobblemon-bds-cmp2`); `cobblemon-bds` não foi tocado.

Sonda (console, com `scriptevent cobblemon:debug_probes on`): `scriptevent cobblemon:cmp_state <x> <y> <z>` (estados,
carga, sinal do Java, emitido, máscara, força e luz acima, vizinhos e o bloco depois deles), `cmp_heal <x> <y> <z>
<fração>` (grava a carga e registra) e `cmp_list`.
