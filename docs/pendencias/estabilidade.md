# Frente estabilidade (investigação do BDS)

Investigação dos três sinais de instabilidade vistos por várias frentes no BDS de teste
(itzg/minecraft-bedrock-server, BDS 1.26.52.3, Docker Desktop 24 GB, Mac arm64). Sem commit.

## Conclusão

**Não é bug do nosso conteúdo.** A causa é o ambiente: no Mac (arm64), a imagem roda o `bedrock_server` x86-64 pelo
**box64 0.4.5 com dynarec** (`mc-server-runner box64 ./bedrock_server-1.26.52.3`). Por padrão, o dynarec não reproduz a
ordem de memória forte (TSO) do x86. Com isso, as corridas entre as threads do BDS aparecem de vez em quando:

- o carregamento de chunks trava. O jogador fica sem spawn (sinal 2) e há chunks "fora do mundo" (sinal 3);
- com menos frequência, e provavelmente pela mesma causa, o heap é corrompido (sinal 1). Vi 1 queda em 63 boots com
  o MSD sem o ajuste; a amostra não prova a ligação.

O conteúdo só muda a exposição. Com o MSD (mais entidades, blocos e itens), o BDS trabalha mais em cada carga de
chunks. Com o MSD, travou 16 de 42 boots nos containers `crash` e `crash-b`. Sem o MSD, nenhum travamento na amostra:
0 de 35 boots vanilla e 0 de 15 só com o base. O dados-ui já tinha visto o travamento só com o base no mundo do E2E.
Nada no conteúdo é inválido: content log vazio e nenhum ERROR/WARN. A mesma semente trava ou não ao acaso. Sem as
estruturas e as features do MSD, continua travando.

Com `BOX64_DYNAREC_STRONGMEM=1`, o travamento sumiu:

- **0 de 47 boots** com o MSD com o ajuste: 92 de 93 entradas de bot. A que falhou foi um watchdog por sobrecarga do host (ver abaixo);
- **16 de 42 boots** sem o ajuste, nos mesmos containers (`crash`, `crash-b`) e sob a mesma carga;
- no mesmo container `crash`: 8/23 sem o ajuste contra 0/15 com ele;
- custo de desempenho não medível.

**Correção aplicada:** `tools/server.mjs` cria os containers com `BOX64_DYNAREC_STRONGMEM=1` e recria um container antigo
que não tenha o ajuste (o mundo fica no volume). `COBBLEMON_BDS_BOX64_STRONGMEM=0` desliga, para comparar.

## Método

- Harness próprio (scratchpad desta frente): `soak.mjs` e `soak2.mjs`. A cada boot:
  - `docker stop` e apaga `.bds-<nome>/worlds/*`;
  - grava de novo os `world_*_packs.json` e faz `docker start`;
  - espera "Server started" ou a morte do container;
  - 1 ou 2 entradas do bot E2E (`tests/e2e/lib/bot.mjs`, RakNet, offline), com spawn em até 180–240 s e depois
    `queryPosition`;
  - registra o `respawn` (estado 0/1), o `play_status`, os chunks recebidos, a semente, o content log e as linhas
    ERROR/WARN.
  - Com `--hold-on-stall`, o servidor fica de pé quando trava, para inspeção.
- Containers:
  - `cobblemon-bds-crash` (porta 19169) e variantes `crash-b`, `crash-v`, `crash-bo`, `crash-s1`, `crash-s2`, `crash-sm`
    (portas 19170–19176), todos com `transport=raknet` e `online-mode=false`;
  - build `dist-crash` (`COBBLEMON_DIST=dist-crash npm run build`, com o pack MSD);
  - variante `dist-crash-nowg` = MSD sem `worldgen/` e sem `structures/`.
- Carga: 4 a 7 BDS ao mesmo tempo (os meus, o `cobblemon-bds` do orquestrador e o `msd3` de outra frente). O load
  average do host ficou entre 30 e 100, igual ao dia a dia das frentes. As comparações abaixo rodaram em paralelo, sob
  a mesma carga.

## Taxas medidas

"Travado" = boot em que ao menos uma entrada de bot não recebeu o spawn (`respawn` com estado 1 e `play_status
player_spawn` nunca chegam; o bot fica em y = 32769 e o servidor continua mandando chunks).

| Configuração | Boots | Travado | Entradas ok | Queda nativa | Watchdog (sobrecarga) |
|---|---|---|---|---|---|
| (a) vanilla (sem nossos packs) | 35 | 0 | 50/50 | 0 | 0 |
| (b) só base (2 entradas) | 15 | 0 | 30/30 | 0 | 0 |
| (b) só base, só boot (+20 s de pé) | 40 | — | — | 0 | 0 |
| (c) base + MSD, containers `crash` e `crash-b` (r1, hold3, ctrl, ctrl2) | 27 | **11** (6 só na 2ª entrada, 5 nas duas) | 35/53 | **1** | 1 |
| (c) base + MSD, container `crash-s1` (hold, hold2, semente fixa) | 21 | 0 | 36/36 | 0 | 0 |
| base + MSD **sem worldgen/estruturas do MSD** (`crash-b`) | 15 | 5 | 23/30 | 0 | 0 |
| base + MSD + `BOX64_DYNAREC_STRONGMEM=1` (`crash-sm` 20, `crash` 15) | 35 | **0** | **70/70** | 0 | 0 |
| base + MSD pelo `tools/server.mjs` corrigido (`crash-b`, verificação) | 12 | **0** | 22/23 | 0 | 1 |

"Watchdog" = o BDS se desligou sozinho com `[Scripting] [Watchdog] 10017 ms hang detected in 'Cobblemon Bedrock Behavior
Pack'` logo depois do `worldLoad`. As duas vezes aconteceram no mesmo minuto (08:28 e 08:31 UTC) em containers
diferentes, com e sem o ajuste, e sob pico de carga do host: load average 128, `rm`/`fseventsd` no topo, I/O no volume
montado do macOS. O nosso `worldLoad` leva 55–105 ms. É o mesmo caso (a) do msd.md ("3 BDS emulados ao mesmo tempo"):
o processo inteiro fica sem CPU/I/O. Não é travamento de chunks e não muda com o STRONGMEM.

Tempos (mediana): boot com MSD 77–91 s (79 s com STRONGMEM), base 65 s, vanilla 14–21 s; spawn do bot 35–40 s em
todas as configurações, inclusive vanilla (é o custo do box64 e do RakNet do bot, não do conteúdo).

Observações:

- **Em um travamento, a 1ª entrada costuma passar e a 2ª não.** Em 9 de 16 boots travados, só a 2ª entrada (5 s depois)
  travou; nos outros 7, as duas travaram. Isso bate com o relato das frentes: "quando o servidor já rodou um cenário".
- **Não depende da semente.** Uma semente que travou (8168784672694433863) subiu 4 vezes sem travar, com e sem o MSD.
- **Não depende do worldgen do MSD.** Sem as estruturas jigsaw e as features do MSD, travou em 5 de 15 boots.
- **O `crash-s1` nunca travou (0/21), embora seja idêntico aos outros.** O mesmo build, `server.properties`, env, versão e
  arquivos do BDS; a pilha de packs muda só pela semente. É a variância esperada de uma corrida entre threads (depende de
  como o host escalona os processos). Por isso o STRONGMEM foi medido também no `crash` (8/23 sem ele, 0/15 com ele) e no `crash-b` (8/19 sem ele, 0/12 com ele, já pelo `tools/server.mjs`).
- O achado "Wishiwashi fora do pack → 0/6" (msd.md) cabe nessa variância: não há relação causal com a entidade.

## Evidência do travamento (servidor mantido de pé, `hold3` #2, semente 9125336422646731681)

- Contexto:
  - o 1º bot entrou em 38 s e saiu;
  - o 2º conectou 5 s depois e ficou 180 s sem spawn (`respawn` só com estado 0, y = 32768);
  - o servidor mandou 346 chunks e ficou com ~7% de CPU. Parado, não ocupado gerando.
- `tickingarea` em volta do spawn (78, 56) e `testforblock` chunk a chunk:
  - um **retângulo exato de 7×5 chunks** (cx 0..6, cz −1..3) ficou "Cannot test for block outside of the world" por
    mais de 5 min;
  - os chunks vizinhos em todas as direções e uma área nova a 600 blocos carregaram normalmente;
  - não há estrutura nossa dentro do retângulo (a mais próxima, `mega_showdown:megaroid`, está em (74, 86), fora dele).
- **Um `stop`/`start` limpo resolve:** o mesmo retângulo carregou inteiro depois de reiniciar. O mundo em disco está
  íntegro; o estado travado só existe na memória do processo (tarefa de carregamento perdida).
- Nenhuma linha de content log, nenhum ERROR/WARN de conteúdo ou script, nenhum aviso do box64.

## Sinal 1: queda nativa

- Vista **1 vez** (controle MSD, sem STRONGMEM), no mesmo instante dos travamentos: entrada do 2º bot, 34 s depois de
  ele conectar.
- O handler do próprio BDS imprimiu o relatório ("Package: com.mojang.minecraft.dedicatedserver … CrashReporter Key:
  f582e04b-… Crash") e saiu com exit 1.
- Nada de dump em `/data`, content log vazio. O `BOX64_SHOWBT=1` não mostrou nada, porque o handler do BDS trata o
  sinal antes.
- Nenhuma queda em 35 boots vanilla, 55 só base e 47 com STRONGMEM.
- As mensagens relatadas pelas frentes ("free(): invalid next size", "corrupted size vs. prev_size") são do glibc ao
  detectar heap corrompido. O mesmo sintoma do box64 com o BDS aparece em ptitSeb/box64#171.
- A taxa é baixa demais (1 em 63 boots com MSD sem o ajuste) para provar estatisticamente que o STRONGMEM também elimina a queda. Aponta
  para isso:
  - a queda aconteceu no mesmo ponto do código (carregamento de chunks na entrada do jogador) que o travamento;
  - o travamento tem a mesma causa e desapareceu com o ajuste.

## Sinal 3: chunk "fora do mundo" e `/locate`

- **Chunk "fora do mundo":** é o mesmo travamento visto por outro ângulo. Enquanto o processo está travado, o chunk não
  carrega nem por `tickingarea`.
  - Teste no vanilla: parei o servidor no meio da geração de 6 áreas de 9×9 chunks, com `stop` limpo e com `docker
    kill`.
  - Depois de reiniciar, as 54 sondas carregaram todas (algumas levaram até ~4 min, porque a geração pelo box64 é lenta).
  - Não reproduzi dano permanente em disco. Se voltar a aparecer, reinicie o servidor antes de concluir que o chunk
    está perdido.
- **`/locate` aponta estruturas que só aparecem depois:** é o comportamento normal do Bedrock, não um bug. O `/locate`
  calcula pela regra de posicionamento (`structure_set` + bioma). A estrutura só é colocada quando o chunk e os
  vizinhos terminam a geração. O msd-conteudo viu o sítio arqueológico aparecer inteiro na 2ª visita.

## Correção

`tools/server.mjs`:

- `BOX64_ENV = ["BOX64_DYNAREC_STRONGMEM=" + (COBBLEMON_BDS_BOX64_STRONGMEM ?? "1")]` entra no `docker run`;
- no `start()`, um container existente sem esse env é recriado, como já acontece quando muda a porta. O volume
  `.bds-<nome>` fica intacto;
- em host x86-64 a imagem não usa o box64, e o env é ignorado.

Verificação:

- `node --check`;
- `deploy --msd` no `crash-b`, que foi criado sem o ajuste: o container foi recriado, e o env está no processo
  `./bedrock_server`;
- `stop` + `start` mantém o mesmo container (sem recriar à toa);
- a rodada de verificação da tabela usa o container criado pelo `server.mjs`.

Efeito nas outras frentes: os containers existentes (inclusive `cobblemon-bds` e `cobblemon-bds-e2e`) serão recriados
no próximo `deploy`/`start` feito com o servidor parado. Esta frente não tocou no `cobblemon-bds`.

## Recomendações

1. Manter o ajuste (já aplicado). Quem tiver um container de pé criado antes: `docker rm -f cobblemon-bds-<frente>` e
   refazer o `deploy`, ou esperar o próximo `deploy`, que recria sozinho.
2. Pedido à frente e2e (`tools/e2e/run.mjs`):
   - quando uma entrada falhar por "sem spawn", reiniciar o container (`docker restart`, que limpa o estado travado)
     antes de repetir;
   - hoje o runner só tenta outro nome de bot, e isso não ajuda, porque o servidor continua travado para todos.
3. Opcional: ligar o Rosetta no Docker Desktop ("Use Rosetta for x86_64/amd64 emulation"; hoje
   `UseVirtualizationFrameworkRosetta: false`, e o x86-64 fora do box64 cai no qemu) e comparar a imagem amd64 sob o
   Rosetta. Não testado: é configuração do Docker Desktop do usuário.
4. As frentes podem parar de marcar essas quedas e travamentos como "instabilidade sem ligação com o conteúdo" sem
   medir. Com o ajuste, um travamento novo passa a ser suspeito de verdade.

## Limpeza

- Containers `cobblemon-bds-crash*` removidos.
- Removidos também os dados temporários desta frente: `.bds-crash-*` e `dist-crash-nowg`.
- Ficam `.bds-crash` e `dist-crash` para reprodução.
