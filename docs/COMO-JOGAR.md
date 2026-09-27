# Como jogar com os amigos

O add-on roda em qualquer Bedrock 26.50+. Os scripts rodam no **host** (Realm, servidor ou quem
abre o mundo); quem entra só baixa o resource pack automaticamente.

## 1. Gerar o pacote

```bash
npm run import && npm run build:release
```

Sai `dist/Cobblemon.mcaddon` (~113 MB com os retratos pré-renderizados). É o pacote **público**: não leva nada do
Mega Showdown, e o build falha se encontrar algo dele. É o único que pode ser publicado. `npm run build:public` faz o
mesmo, de forma explícita.

### Pacote privado com o Mega Showdown (só entre amigos)

Com o clone do Mega Showdown em `upstream/mega-showdown` e a extensão privada na árvore:

```bash
npm run import && npm run build:release -- --private
```

Saem `dist/Cobblemon-private.mcaddon` (o base com as tabelas do MSD) e `dist/CobblemonMegaShowdown.mcaddon`. Abra os
dois e, no mundo, ponha o "Cobblemon: Mega Showdown" (recursos **e** comportamento) **acima** do "Cobblemon Bedrock".
A licença do Mega Showdown só permite uso privado: **não publique nem redistribua esses arquivos**.

## 2. Escolher onde hospedar

### Opção A: Realm (mais simples para console)

Consoles entram direto num Realm, sem truque.

1. Num celular/tablet (iOS/Android) ou PC Windows com Minecraft, abra o `Cobblemon.mcaddon`
   (no iPhone/iPad: mande o arquivo para o aparelho e toque em "Abrir com Minecraft").
2. Crie um mundo novo e ative **os dois packs** (Behavior e Resource) nas configurações do mundo.
   Não precisa ligar nenhum experimento.
3. Nas configurações do Realm, use **Substituir mundo** e envie esse mundo.
4. Convide os amigos para o Realm. Na primeira entrada eles baixam o pacote.

### Opção B: servidor no Mac (Docker)

```bash
node tools/server.mjs deploy
```

O servidor usa o transporte **NetherNet** (o padrão do Bedrock 26.x e o único que os clientes oficiais
usam): TCP `19132` para a sinalização e a faixa UDP fixa `19200-19209`, anunciada aos clientes com o IP do
Mac na rede local.

- **Mesma rede Wi-Fi**: no celular/PC, Servidores → Adicionar servidor → **IP do Mac**, porta `19132`.
  Descubra o IP com `ipconfig getifaddr en0`. Ele muda quando o roteador (DHCP) dá outro endereço ao Mac:
  nesse caso atualize o servidor salvo no jogo e rode `node tools/server.mjs deploy` de novo, para o BDS
  anunciar o IP novo.
- **Console**: não tem "adicionar servidor". Para consoles verem o servidor na aba Amigos é preciso
  o [MCXboxBroadcast](https://github.com/MCXboxBroadcast/Broadcaster) com uma conta Microsoft
  secundária. Para jogar fora da rede de casa também é preciso liberar no roteador a porta `19132`
  (TCP e UDP) e a faixa UDP `19200-19209`.
- Os bots do teste E2E (`npm run test:e2e`) usam outro servidor, em RakNet; nada muda para quem joga.

## 3. No jogo

| Ação | Como |
|---|---|
| Escolher o inicial (11 regiões, como no Cobblemon) | aparece sozinho no primeiro login, ou `/cobblemon:starter` |
| Menu do time: mandar para fora/recolher, resumo, golpes, item segurado, apelido, evoluir, mandar para o PC, soltar | `/cobblemon:party` ou fazer um emote |
| Resumo (info, atributos/IVs/EVs, golpes, marcas, saciedade, passos) | no menu do time, ou `/cobblemon:summary [espaço]`; o botão 3D/2D mostra o modelo ao vivo (lembrado por jogador). Tocar no retrato/modelo faz o Pokémon gritar; tocar de novo na aba Atributos mostra a página de montaria (valor/máx e % de bônus por estilo) |
| Markings (os 6 símbolos do Cobblemon) | no resumo, toque em cada símbolo para passar pelos 3 estados; ficam gravados ao sair ou trocar de Pokémon e aparecem na prévia do PC |
| Time na tela (HUD do Cobblemon à esquerda: retrato, HP/EXP, status, selecionado) | ligado por padrão; `/cobblemon:partyhud [true/false] [overlay/text]` liga/desliga e troca o estilo (`text` = a linha antiga na actionbar) |
| PC (40 caixas, como no Cobblemon 1.7+; grade 6×5 com o time ao lado, papel de parede, mover/trocar, levar para o time, renomear caixa, soltar) | bloco de PC, botão "PC" no menu do time, ou `/cobblemon:pc [caixa]`. Reabre na última caixa vista |
| PC: ordenar e filtrar | **Ordenar** a caixa por nome, nível, tipo, nº da Pokédex ou gênero (crescente/decrescente). **Filtrar** escurece quem não passa: nome parcial (`pika`), `!` para negar, `holding`, `fainted`, `legendary`, `mythical`, `ultrabeast` ou propriedades (`shiny`, `level=50`, `gender=female`...) |
| Pokémon selecionado do time (setas do overlay no Cobblemon) | agachar duas vezes rápido passa para o próximo (o HUD marca o selecionado; em batalha não troca), ou `/cobblemon:selectslot <1-6>` |
| Envio rápido (tecla R do Cobblemon) | agachado + pular: solta/recolhe o selecionado onde você olha; mirando um selvagem, batalha com ele na frente; mirando um jogador, abre batalha/troca; em batalha, minimiza ou reabre a tela da batalha (linha abaixo). Também `/cobblemon:sendout [1-6]` |
| Capturar | arremessar uma Poké Bola no Pokémon selvagem |
| Pokédex e scanner | usar a Pokédex sem mirar abre a tela; usar mirando um Pokémon (até 10 blocos) escaneia com zoom por 15 ticks e abre a entrada. **Agachar + usar** liga o modo scanner: a roda do mouse/troca de hotbar dá zoom e mirar registra sem abrir a tela; usar sem agachar, trocar de item ou morrer desliga |
| Move Dex (golpes na Pokédex) | na entrada de uma espécie, botão **Golpes**: golpes por nível, TM e ovo (filtros Todos/Nível/TM/Ovo), ordem por nível/nome/tipo/descoberto, troca de forma e detalhes do golpe. TMs que você ainda não aprendeu aparecem travados (a config `unlockAllMoveDexMovesByDefault` libera todos) |
| Filtros e busca da Pokédex | filtros Todos/Obtidos/Vistos/Não registrados/Montáveis/TM não descoberto; a busca aceita espécie, habilidade, golpe ou drop (pelo nome em inglês do Cobblemon, não pelo traduzido) |
| Batalhar | interagir (botão usar/toque) com um Pokémon selvagem, ou envio rápido mirando nele |
| Tela da batalha minimizável (como no Cobblemon) | a tela abre sozinha no começo da batalha e a cada turno enquanto você não a fechar. **Esc/fechar** ou **Fugir** minimiza: você anda livre, as caixas dos Pokémon ficam esmaecidas e o aviso "Você precisa escolher uma ação. Pressione …" pisca no HUD. Minimizada, a tela não reabre sozinha, nem para a troca depois de um desmaio. Para reabrir: **agachado + pular** (teclado Shift + Espaço; no controle, segurar Agachar e apertar Pular); **no celular, toque duas vezes em Pular**, o que só vale com a batalha minimizada e uma ação pendente. Interagir com o oponente também reabre. Com a tela aberta esperando as animações, agachado + pular minimiza. Não há tempo limite. Durante a batalha o HUD do time some (volta no fim; também para quem assiste). `/cobblemon:battleui` (sem nada abre um menu) troca o modo só para você: `hud` para escolher golpes pela hotbar andando (espaços 1–4 + agachado + pular; só em batalhas simples, nas outras fica o aviso normal), `classic` para a tela reabrir a cada turno, `default` volta ao padrão |
| Desafiar outro jogador | interagir com ele e escolher Batalha simples/dupla/tripla e a regra de nível, ou `/cobblemon:pokebattle <jogador> [formato] [nível]` (ele aceita pelo mesmo botão ou comando). Equipes Multi e nível fixo: seção 4 |
| Menu do seu Pokémon | interagir com ele |
| Montar | agachar + interagir com o seu Pokémon de mão vazia (ou "Montar" no menu do time); em quem voa, pulo duplo decola. No ar/na água: pular segurado sobe, agachar segurado desce, **agachar 2× rápido desmonta** (agachar uma vez não derruba). **Correr na terra** (espécies que correm no Cobblemon, como Arcanine): toque duas vezes para frente (W, o analógico ou o joystick do celular) e mantenha; gasta fôlego (barra na actionbar), o FOV abre um pouco e para ao soltar ou quando o fôlego acaba. A tecla de correr não funciona montado (o Bedrock não a passa ao add-on). Sons de montaria por velocidade; o resumo de controles na actionbar aparece se o operador ajustar a config `displayControlSeconds` (padrão 0, como no Cobblemon) |
| Ride boosts (Aprijuice) | segurar uma Aprijuice temperada e interagir com o Pokémon (ou usar e escolher no time): sobe os atributos de montaria (velocidade, fôlego...) até o máximo da faixa |
| Câmera da montaria | `/scriptevent cobblemon:ride_camera auto` (padrão: órbita no ar/água), `always` (órbita sempre), `boom` (câmera fixa atrás), `off`, `freelook` (órbita sempre e a câmera gira livre com o mouse, a montaria vira por A/D; o "olhar em volta" do Cobblemon, sem precisar segurar tecla) ou `roll` (experimental: câmera que inclina nas curvas do voo; ainda não conferida num cliente real, pode enjoar) |
| Vaso decorado com sherds do Cobblemon | segure um sherd do Cobblemon (bygone, capture, dome, helix, nostalgic, suspicious) e use a **mesa de trabalho sem agachar**: abre a tela do vaso para escolher fundo, esquerda, direita e frente (tijolo ou qualquer sherd do inventário); os itens são gastos. Só com sherds vanilla, faça o vaso vanilla na grade normal. O vaso guarda uma pilha (clique com o item), aceita funil e comparador e, quebrado com picareta, solta os sherds |
| Enfermeira (aldeã do Cobblemon) | um aldeão adulto desempregado a até 48 blocos de uma Healing Machine livre vira Enfermeira (Joy, se o nome terminar em "Joy"): troca berries, remédios e ingredientes, trabalha na máquina no horário de trabalho. Quebrar a máquina antes da primeira troca a devolve a desempregada |
| Pinturas do Cobblemon (altar, nomad, premonition, slumber) | coloque uma Pintura vanilla numa parede: quando o espaço comporta, às vezes sai uma do Cobblemon, no mesmo sorteio do Java. Segurar o botão não coloca várias: clique uma vez por pintura |
| Fazendeiros e sementes do Cobblemon | fazendeiros pegam do chão as sementes de mint, vivichoke, revival herb e hearty grains, plantam em farmland livre e colhem as maduras quando passam perto (não andam até elas) |
| NPC com modelo de Pokémon (operador) | no editor `/cobblemon:npcedit`, dê ao NPC o behaviour `cobblemon:npc/resource_identifier` e ponha a espécie em `resource_identifier` (padrão `cobblemon:pikachu`, como no Cobblemon): o NPC aparece como o Pokémon e continua conversando e batalhando |
| Conquistas do Cobblemon (61, com toast e aviso no chat) | `/cobblemon:advancements` |
| Estatísticas do Cobblemon (capturas, shiny, batalhas, evoluções, trocas, distância montado...) | `/cobblemon:stats` (operador: `/cobblemon:stats <jogador>`) |
| Vestíveis (chapéus e itens de rosto do Cobblemon) | pôr no slot de capacete do jogador, ou dar como item segurado ao Pokémon (aparece na cabeça/rosto dele) |
| Item segurado visível | o item segurado aparece no modelo do Pokémon (nas espécies que têm o ponto de item no modelo do Cobblemon) |
| Luz dinâmica | Pokémon luminosos (Charmander, Ampharos...) iluminam em volta e a Pokédex na mão ilumina o jogador. Operador: `/scriptevent cobblemon:dynamic_lights off` desliga (e apaga as luzes), `on` religa |
| Dar/trocar item segurado | agachar + interagir, ou "Item segurado" no menu do time |
| Rare Candy, Exp. Candy, pedras de evolução | segurar o item e interagir com o seu Pokémon |
| Berries, mochis e Berry Juice | enchem a barriga do Pokémon (máximo pelo peso da espécie); de barriga cheia ele não aceita berries de EV/amizade, mochis nem Aprijuice. A barriga esvazia com o tempo |
| Curar o time sem Centro | dormir na cama a noite toda: +50 % de HP, sem status, metade do PP |
| Gimmighoul → Gholdengo | dar Relic Coins (1), Pouch (9) ou Sack (81) ao seu Gimmighoul até 999 moedas (a actionbar mostra o stash); netherite no stash decide a cobertura |
| Tasty Tail | tesoura num Slowpoke (a cauda cresce de novo em 20 min) |
| Nincada → Shedinja | com espaço no time e uma Poké Ball no inventário, o Shedinja vem junto com o Ninjask |
| Shiny selvagem por perto | brilho e som quando você chega a 24 blocos (config `shinyNoticeParticlesDistance`) |
| Alfa derrotado | solta recompensas pelo nível e pelo tipo |
| Tora de saccharine com mel | atrai spawn por perto (5 % habilidade oculta, chance de shiny/Alfa) e é consumida |
| Admin (operador + cheats) | `/cobblemon:pokegive "<propriedades>"`, `/cobblemon:pokespawn`, `/cobblemon:healpokemon`, `/cobblemon:levelup`, `/cobblemon:teach`, `/cobblemon:pokemonedit <espaço>` (formulário), `/cobblemon:givestarterkit` |
| TMs aprendidos (operador + cheats) | `/cobblemon:technicalmachine unlock <jogador> only <TM>` ou `... all`, `lock` do mesmo jeito, e `check <jogador>` (libera os TMs que os Pokémon do time e do PC dele já sabem) |
| Spawn rules (operador + cheats; o Java usa datapack) | `/cobblemon:spawnrule list`, `enable <id>`, `disable <id>`, `add <id> <json>`, `remove <id>` |
| Ride boosts para teste (operador + cheats) | `/cobblemon:rideboost <espaço> <acceleration\|skill\|speed\|stamina\|jump\|all> <valor\|max> [jogador]` |
| Config do servidor (operador) | `/cobblemon:cobblemonconfig` (editor por categorias) |
| Gamerules do Cobblemon (operador) | `/cobblemon:cobblemongamerule <regra> [true/false]`: `doPokemonSpawning`, `doPokemonLoot`, `battleInvulnerability`, `mobTargetInBattle`, `doShinyStarters`, `healersHealPC` |
| Música de batalha (operador) | `/scriptevent cobblemon:battle_music on` (desligada por padrão; o Cobblemon 1.8.2 não traz faixas, então só toca com um resource pack que as tenha) |
| Pokécenter em vilas novas (operador) | ligado por padrão; `/scriptevent cobblemon:village_pokecenters off` desliga |
| Sondas de depuração (só no console do servidor) | desligadas por padrão (config `enableDebugProbes`); `scriptevent cobblemon:debug_probes on` liga as sondas `md_*`, `ms_*`, `debug_visual`, `debug_visual_final`, `dadosia_*`, `ianpc_*`, `adapt_*`, `limb_*` e as `cblimits:*`, `off` desliga |

Lista completa de comandos e o mapeamento para os do Cobblemon: [COMANDOS.md](COMANDOS.md).

## 4. Equipes Multi e batalha de nível fixo

Tudo pelo menu de interação de jogador (interagir com outro jogador), que faz o papel da roda de interação do
Cobblemon:

- **Formar grupo**: com os dois sem equipe, manda o convite (vale 60 s). O outro aceita pelo mesmo botão no menu
  dele ou recusa em "Recusar (Formar grupo)". A equipe tem 2 jogadores.
- **Batalha Multi**: mirando alguém de outra equipe, desafia a equipe dele (vale 20 s; os quatro recebem o aviso).
  Qualquer membro da equipe desafiada aceita pelo mesmo botão ou com `/cobblemon:pokebattle <jogador> multi`. Para
  começar: todos com Pokémon, na mesma dimensão e a até 15 blocos do centro do grupo. É uma batalha 2×2, com um
  Pokémon ativo por jogador.
- **Abandonar grupo** (mesma equipe) ou `/cobblemon:abandonmultiteam`. Sair do servidor também tira da equipe; com
  um jogador só, a equipe é desfeita e os convites e desafios dela caem.
- **Regra de nível**: depois de escolher o formato (simples, dupla, tripla ou Multi) abre a tela **Luta Livre /
  Nível 50 / Nível 100 / Nível 5 para todos**. Com nível fixo, todos lutam com cópias curadas naquele nível e o time
  de verdade não muda. Pelo comando: `/cobblemon:pokebattle <jogador> [formato] [5|50|100]`; quem é desafiado vê
  a regra no chat e, ao aceitar, vale a regra de quem desafiou.
- Quem começa a batalha 1×1 é o Pokémon que você tem em campo ou, sem ninguém em campo, o selecionado no HUD (na
  Multi vale a ordem do time, como no Cobblemon).
- Se alguém sai do servidor no meio de uma batalha entre jogadores (1×1 ou Multi), a batalha acaba na hora para
  todos, sem vencedor e sem recompensa, como no Cobblemon.

## 5. Teste automático para gerar o log

O cliente (Windows, celular, console) só registra um erro de recurso quando usa o recurso: um modelo quebrado só
aparece no ContentLog quando aquele Pokémon é desenhado, um som ausente só quando ele toca, uma tela JSON UI só quando
abre. Para não precisar fazer tudo à mão, há um teste automático que força esse uso dentro do mundo:

1. Ligue o registro no cliente: **Configurações > Criador**: "Ativar arquivo de registro do conteúdo" (Enable Content
   Log File) e o nível **"Inform."**. Com o registro desligado durante o teste, rode o teste de novo depois de ligar.
2. No mundo (operador e cheats ligados), num lugar aberto do Mundo Superior, com o céu livre acima de você, digite:

   ```
   /cobblemon:selftest quick
   ```

   Também funciona como `/scriptevent cobblemon:selftest quick` (no console do servidor:
   `scriptevent cobblemon:selftest quick <jogador>`).
3. Espere a mensagem **"[Selftest] Concluído em ..."** no chat. O progresso aparece na actionbar. Para parar a qualquer
   momento: `/cobblemon:selftest stop` (tudo é restaurado do mesmo jeito). `/cobblemon:selftest status` mostra onde está.
4. Pegue o arquivo `ContentLog__<data>.txt`:
   - Windows (versão nova): `%APPDATA%\Minecraft Bedrock\logs`;
   - Windows (versão antiga, UWP): `%LOCALAPPDATA%\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\LocalState\logs`;
   - celular: a pasta `games/com.mojang/logs` nos dados do Minecraft (no Android, dentro de
     `Android/data/com.mojang.minecraftpe/files/`). O botão "Histórico do registro de conteúdo" em Configurações >
     Criador mostra as mesmas linhas no jogo.

| Modo | O que faz | Tempo medido (servidor de teste) |
|---|---|---|
| `quick` (padrão) | Tudo, em amostra: 1 Pokémon por família (forma padrão) + todas as variantes dos casos já vistos no log (torchic, altaria, zubat, skarmory, porygon-z, exeggutor/dugtrio/ninetales de Alola, flabébé, unown, furret, blaziken, frillish); NPC, barcos, exibições e 4 bolas (paradas e arremessadas); movimento em amostra (os casos já vistos + outras espécies andando, nadando e voando, e 3 montarias: terra, água e ar); cada bloco no estado padrão e em todos os estágios de crescimento; 160 partículas e 160 sons; todas as telas; batalha curta | ~4 min 10 s |
| `full` | Tudo, completo: todas as espécies × todas as combinações (shiny, formas regionais, gênero, Alfa, formas como Unown/Flabébé), todas as entidades do pack com cada valor das propriedades e cada animação, todas as bolas arremessadas, o movimento completo, cada bloco em cada estado (um estado por vez), todas as partículas e todos os sons | ~33 min (soma das fases) |
| `entities` | Só as entidades, completo (a parte mais longa do `full`) | ~22 min |
| `movement` | Só o movimento, completo. Três caixas fechadas por barreira na frente da câmera: um **cercado** (andar e correr), uma **piscina** de água (nadar e flutuar) e um **volume aberto com teto** (voar e planar). Cada espécie (cada forma com animações próprias, como as de Alola) vai para a caixa do jeito que ela se move, com a IA ligada e empurrões para não ficar parada, em rodadas de 20 + 10 + 12 Pokémon por ~4 s. Antes, você monta cada montaria (terra no cercado, água na piscina, ar decolando do chão com pulo duplo, voando e planando no fim), com a câmera de montaria de verdade | ~7 min 30 s |
| `blocks` | Só os blocos, cada estado | ~1 min |
| `particles` | Só as partículas (todas) | ~15 s |
| `sounds` | Só os sons (todos, volume baixo) | ~40 s |
| `ui` | Só as telas: inicial (2D e 3D), time, resumo (4 abas e 3D), PC (o seu e uma caixa de exemplo cheia), Pokédex (lista, página, entrada), diálogo de NPC, troca, batalha (menu, golpes, troca, mochila, alvo, desistir), conquistas, estatísticas e o HUD (time, caixas da batalha em simples/duplas/minimizada, toasts). Cada tela fica ~2,5 s e fecha sozinha | ~1 min 10 s |
| `battle` | Batalha contra um Magikarp selvagem de teste com um time temporário (Pikachu, Charmander, Squirtle nível 5): golpe, troca, item da mochila (X Attack) e golpe; o menu de verdade aparece a cada turno e fecha sozinho | ~30 s |

Como fica o mundo e o jogador:

- O teste roda numa área temporária **no céu, acima de você** (25 × 15 × 31 blocos), que precisa estar só com ar: se
  houver qualquer bloco (construção, árvore, teto do Nether), o teste procura outra altura ou avisa que não há espaço.
  Nada fora dessa área é tocado. O chão é de barreira (invisível) e a câmera fica fixa olhando a grade.
- No movimento, as três caixas (chão, paredes e teto de barreira, invisíveis) ficam dentro dessa área e nada sai delas;
  os Pokémon soltos ficam imunes a dano (nada morre nem solta item). A piscina seca com as paredes ainda de pé antes de
  a caixa ser desmontada, então a água nunca escorre para fora (nem depois de uma queda do servidor). Durante as
  montarias a câmera é a da montaria; no fim você desce, a câmera e a permissão de desmontar voltam ao normal.
- Você vai para lá no **modo criativo** (sem dano e sem gastar itens na mochila da batalha) e volta no fim para o mesmo
  lugar, na mesma dimensão e rotação, no modo de jogo de antes, com a câmera normal e desmontado (o teste não começa
  com você montado).
- No fim, tudo o que foi criado some: blocos (voltam a ser ar, inclusive as metades de cima e o que o bloco criou ao
  ser colocado, como o registro das berries), entidades, itens soltos, música e sons.
- **Progresso não muda**: o time temporário são cópias que nunca entram no seu time; Pokédex, estatísticas, progresso e
  conquistas voltam ao que eram (o teste guarda as dynamic properties do jogador antes e restaura as que mudaram);
  inventário conferido e restaurado. As conquistas têm um cache em memória sem como descartar pela API, mas o teste
  não dispara nenhum critério delas (não mexe no seu time nem no inventário e não vence batalhas).
- **Se você sair no meio** (ou o jogo fechar), a área é limpa na hora (ou, depois de uma queda do servidor, assim que
  o chunk carregar) e você é devolvido ao lugar e aos dados de antes quando entrar de novo (mensagem "[Selftest] Um
  teste foi interrompido..."). Um teste por vez no mundo.
- Nada roda sem o comando. Os Pokémon exibidos não têm dados de selvagem (não dá para capturar nem batalhar com eles) e
  somem no fim; o que a batalha de teste marca na Pokédex (o Magikarp "visto") volta ao que era. A distância montada
  nas estatísticas também volta ao que era.
- As linhas `[selftest]` do log do servidor dizem quanto cada fase levou, o que falhou no servidor (espécie que não
  existe, estado de bloco inválido) e a verificação final da área (tem de ser "0 bloco(s) não-ar, 0 entidade(s)").

## Limitações conhecidas

- Spawns que dependem de estruturas funcionam nas estruturas do Cobblemon (ruínas, habitats, barcos, enseadas)
  geradas com esta versão, em vilas e, por aproximação (blocos típicos no chunk), em monumento, cabana da bruxa, iglu,
  mansão, posto avançado, ruínas de trilha e oceânicas, portal em ruínas, cidade ancestral, cidade do End, fortaleza,
  bastião e fóssil do Nether. **Naufrágio e poço do deserto** não são detectados (a Script API estável não diz se um
  ponto está dentro de uma estrutura, e os blocos deles não bastam para reconhecer). Estruturas do Cobblemon geradas
  por versões antigas do add-on também não contam. Os demais spawns aparecem em superfície, água e cavernas, e também por isca, pesca, Poké Snack,
  blocos de habitat e tora com mel.
- As telas (batalha, resumo, PC, inicial, Pokédex) são formulários do Bedrock redesenhados no visual do Cobblemon:
  no PC não dá para arrastar (escolhe-se origem e destino). Sem teclas próprias: o envio rápido usa agachado + pular
  (no voo do criativo isso também solta o Pokémon) e a troca de selecionado usa agachar 2×. A tela da batalha é um
  formulário (bloqueia o movimento enquanto aberta); "minimizar" fecha a tela, como no Cobblemon. No celular o botão
  de agachar dura só um instante, então lá o gesto de reabrir a batalha é o toque duplo em Pular.
- O HUD, as telas (inclusive Move Dex, markings e PC com ordenar/filtrar), os retratos, o modelo 3D do estúdio, o zoom
  do scanner, a câmera e o resumo de controles da montaria, os efeitos de golpe, o envio com bola e o feixe da recolha,
  a balsa na água, os vestíveis, o item segurado no modelo, a luz dinâmica, o feto no tanque, os discos da estante,
  a tinta vermelha do feixe de captura, as partículas de mel/migalhas/olhos do Alfa, o papel de parede com brilho do
  PC, as telas de equipe Multi e de regra de nível, o aviso da batalha minimizada, o vaso decorado e sua tela, as
  pinturas, a textura da Enfermeira, o NPC com modelo de Pokémon, o NPC escondido, o FOV da corrida montado, o
  `freelook`/`roll` e a Pokédex na estante entalhada ainda não foram conferidos num cliente real (o servidor de teste
  não desenha nada): se algo aparecer torto, vale reportar com uma captura de tela.
- Montaria: a corrida é só pelo duplo toque para frente; a câmera nativa não inclina nas curvas (o modo `roll` é
  experimental); sem bônus de pulo (a força do pulo não é exposta aos scripts). Ao correr, o FOV vai para 80,5 fixo
  (o add-on não lê o FOV do jogador): quem joga com FOV maior vê o campo diminuir enquanto corre.
- Vestíveis ocupam o slot de capacete com pilha de 1 (o Bedrock não empilha armadura).
- NPC com modelo de Pokémon: o Pokémon vira o corpo inteiro para onde o NPC olha (sem girar só a cabeça). NPC
  escondido para um jogador continua fazendo sombra e empurrando.
- Vaso decorado: não balança ao ser tocado e o pistão não o quebra. Enfermeira: segue o horário de trabalho do
  Bedrock e vai à Healing Machine mais próxima, não necessariamente à dela.
- Livro de receitas: os grupos do Cobblemon também aparecem no inventário criativo, e a busca não troca "poke" por
  "poké" (a busca é do jogo, não do add-on).
- Os olhos do Alfa soltam as partículas do Cobblemon, mas sem o brilho em anéis e o rastro do Java (o Bedrock não
  deixa desenhar efeitos próprios na entidade). Na captura, o vermelho do feixe fica um pouco mais claro que no Java.
- Equipes Multi: não há os ícones dos membros da equipe no HUD nem uma tela de pedido pendente (aceita-se pelo mesmo
  botão do menu ou pelo comando).
- O rótulo acima do Pokémon ("???" para espécie não registrada na Pokédex, ou só agachado com a config) é um só para
  todos: vale o que o jogador mais perto veria.
- NPCs com a skin de um jogador usam uma skin de um conjunto fixo (Steve, Alex, treinadores): o Bedrock não deixa
  copiar a skin de um jogador.
- Não há conquistas nativas do Bedrock: as do Cobblemon aparecem como toast no HUD, no chat e em
  `/cobblemon:advancements`.
- Caixas de shulker e bolsas não podem ser dadas como item segurado (o conteúdo se perderia).
- 894 espécies convertidas; 131 não entram porque o próprio Cobblemon 1.8.2 ainda não as implementou.
- O pacote é grande (~5.300 texturas de Pokémon e ~8.200 retratos pré-renderizados). Se um console fraco travar ou
  ficar sem memória, gere um recorte menor: `npm run import -- --gens 1,2,3,4` e refaça o build.
