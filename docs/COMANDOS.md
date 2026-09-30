# Comandos

Todos os comandos do port ficam no namespace `cobblemon:` e são registrados como *custom commands*
estáveis (`scripts/commands.ts`), então funcionam em qualquer plataforma, inclusive console, Realms e o
console do servidor. Lista original do Cobblemon 1.8.2: `common/.../CobblemonCommands.kt` + `command/*.kt`.

Convenções:

- **Espaço do time** é 1–6 e **caixa/espaço do PC** começam em 1 (como no Cobblemon).
- **Propriedades** seguem o `PokemonProperties` do Cobblemon: `pikachu level=30 shiny nature=adamant
  gender=female ability=static hp_iv=31 attack_ev=252 held_item=cobblemon:light_ball nickname=Sparky`,
  além de `ivs=31`/`evs=0` (todos os atributos), `mint=timid`, `ha` (habilidade oculta), `friendship=200`,
  `pokeball=cobblemon:ultra_ball` e aspectos de forma (`alolan`, `region-bias-hisui`...). Com espaços,
  use aspas: `/cobblemon:pokegive "pikachu level=30 shiny"`.
- Os nomes dos parâmetros aparecem em inglês no jogo (`slot`, `box`, `player`, `properties`...); aqui estão
  traduzidos.
- **Jogador** aceita seletor (`@s`, `@a`, nome). Sem ele, o alvo é quem executou.
- **Permissões**: "Todos" = qualquer jogador, sem cheats. "Admin" = operador (`GameDirectors`); os que
  criam/alteram Pokémon também exigem cheats ligados.

## Comandos de jogador

| Comando | Faz | Permissão |
|---|---|---|
| `/cobblemon:party` | Menu do time: mandar para fora/recolher, resumo, golpes, item segurado, apelido, evoluir, mandar para o PC, soltar | Todos |
| `/cobblemon:pc [caixa]` | Abre o PC (não funciona em batalha) | Todos |
| `/cobblemon:starter` | Escolha do inicial (uma vez por jogador) | Todos |
| `/cobblemon:summary [espaço]` | Resumo de um Pokémon do time | Todos |
| `/cobblemon:partyhud [ligado] [estilo]` | Mostra/esconde o HUD do time; estilo `overlay` (party do Cobblemon à esquerda, padrão) ou `text` (linha na actionbar) | Todos |
| `/cobblemon:battleui [modo]` | Modo da tela de batalha, por jogador. Sem argumento abre um menu com os três modos. `java` (padrão, como o Cobblemon): a tela abre no começo; fechar (Esc) ou "Fugir" minimiza a batalha, e ela não reabre sozinha até você pedir com agachado + pular (no celular, toque duas vezes em Pular). `hud`: minimizada, os golpes aparecem acima da hotbar; escolhe-se com os espaços 1–4 e confirma com agachado + pular; 5–9 abrem o menu completo (só em batalhas simples; em duplas, triplas e Multi fica o aviso do `java`). `classic`: o comportamento antigo, em que a tela reabre a cada turno e fechar manda a dica no chat. `default` apaga a sua escolha; `status` mostra o modo atual. Pelo console, muda o padrão do mundo | Todos |
| `/cobblemon:sendout [espaço]` | Envio rápido (tecla R do Cobblemon): solta/recolhe o selecionado, ou batalha com o que você mira; em batalha, minimiza/reabre a tela. O mesmo que agachado + pular | Todos |
| `/cobblemon:controle` | Devolve a **Poké Ball do time** (o item de controle: usar = time, agachado + usar = envio rápido, agachado + atacar = próximo do time; ver [COMO-JOGAR.md](COMO-JOGAR.md)) e mostra a dica dos controles de novo. Todo jogador já recebe o item ao entrar e ele não sai do inventário | Todos |
| `/cobblemon:selectslot <1-6>` | Escolhe o Pokémon selecionado do time (setas do overlay no Cobblemon) | Todos |
| `/cobblemon:advancements` | Tela das 61 conquistas do Cobblemon | Todos |
| `/cobblemon:stats [jogador]` | Estatísticas do Cobblemon; ver as de outro jogador exige operador | Todos |
| `/cobblemon:renamebox <caixa> [nome]` | Renomeia uma caixa do PC (sem nome = padrão) | Todos |
| `/cobblemon:pokebattle <jogador> [formato] [nível]` | Desafia um jogador (ou aceita o desafio dele); formato `singles` (padrão), `doubles`, `triples` ou `multi` (a sua equipe desafia a equipe do jogador; ver abaixo). `nível` = regra de nível fixo `5`, `50` ou `100` (todos os Pokémon lutam como cópias nesse nível e curados; o time real não muda); `0`/`-1`/vazio = livre. Ao aceitar vale a regra de quem desafiou. No 1×1, cada lado começa com o Pokémon em campo ou, sem ninguém em campo, com o selecionado no HUD | Todos |
| `/cobblemon:abandonmultiteam` (alias `/cobblemon:abandonmultibattleteam`) | Sai da sua equipe de Batalha Multi; com um membro só, a equipe é desfeita e os pedidos/desafios dela caem | Todos |
| `/cobblemon:trade <jogador>` | Pede (ou aceita) uma troca com um jogador | Todos |
| `/cobblemon:cobblemon` | Versão/informações | Todos |

## Mapeamento Cobblemon → port

| Cobblemon (Java) | Port (Bedrock) | Observações |
|---|---|---|
| `givepokemon <props>` / `pokegive` | `/cobblemon:givepokemon <props> [nível] [shiny] [jogador]`, `/cobblemon:pokegive <props> [jogador]` | `givepokemon` mantém os parâmetros antigos do port (`nível`, `shiny`) |
| `givepokemonother <jogador> <props>` | `[jogador]` opcional nos dois acima | |
| `spawnpokemon <props>` / `pokespawn` | `/cobblemon:spawnpokemon <props> [nível] [shiny] [posição]`, `/cobblemon:pokespawn <props> [posição]` | Selvagem |
| `healpokemon [jogador]` | `/cobblemon:healpokemon [jogador]` e `/cobblemon:pokeheal [jogador]` | Recusa em batalha; atualiza os Pokémon fora da bola |
| `levelup [jogador] <espaço>` | `/cobblemon:levelup <espaço> [jogador]` | EXP até o próximo nível (golpes novos, amizade e evolução como no Cobblemon) |
| `teach <jogador> <espaço> <golpe>` | `/cobblemon:teach <espaço> <golpe> [jogador] [bypasslearnset]` | Valida o learnset (`canLearnMove`) salvo com `bypasslearnset=true` |
| `querylearnset <jogador> <espaço> <golpe>` | `/cobblemon:querylearnset <espaço> <golpe> [jogador]` | |
| `pokemonedit <espaço> <props>` / `pokeedit` | `/cobblemon:pokemonedit <espaço> [props] [jogador]`, `/cobblemon:pokeedit` | Sem propriedades abre um **formulário** (nível, shiny, gênero, natureza, habilidade, IVs, EVs) |
| `friendship <espaço>` | `/cobblemon:friendship <espaço> [valor] [jogador]` | O port também define o valor |
| `held_item <jogador> <espaço> <item>` | `/cobblemon:helditem <espaço> <item> [jogador]` | `minecraft:air` tira o item |
| `givemark` / `takemark` | `/cobblemon:givemark <espaço> <marca> [jogador]`, `/cobblemon:takemark ...` | Marca sem namespace vira `cobblemon:<marca>`; o id é validado (MarkArgumentType) |
| `giveallmarks <espaço> [jogador]` | `/cobblemon:giveallmarks <espaço> [jogador]` | Admin, exige cheats; todas as 168 marcas (fitas de ouro substituem as comuns) |
| `spectatebattle <jogador>` | `/cobblemon:spectatebattle <jogador>` | Admin (nível 4 no Java); ignora `allowSpectating` e a distância, como o comando do Cobblemon |
| `unlockpcboxwallpaper <jogador> <papel> [tocarSom]` | `/cobblemon:unlockpcboxwallpaper <jogador> <papel> [tocarSom]` | Admin; papéis de `unlockable_pc_box_wallpapers` (com ou sem `cobblemon:`) |
| `changewallpaper <jogador> <caixa> <textura>` | `/cobblemon:changewallpaper <jogador> <caixa> <textura>` | Admin; caixa começa em 1 |
| `clearparty <jogadores>` | `/cobblemon:clearparty [jogador]` | Recolhe quem estiver fora |
| `clearpc <jogadores>` | `/cobblemon:clearpc [jogador]` | |
| `pokemonrestart [starters]` / `pokerestart` | `/cobblemon:pokemonrestart [jogador] [resetstarter]` | Com `resetstarter=true` reabre a escolha do inicial |
| `pc [caixa]` | `/cobblemon:pc [caixa]` | |
| `pokebox <jogador> <espaço> [caixa]` | `/cobblemon:pokebox <espaço> [caixa] [jogador]` | Não manda o último Pokémon |
| `pokeboxall <jogador> [caixa]` | `/cobblemon:pokeboxall [caixa] [jogador]` | Mantém o último Pokémon no time |
| `pctake <jogador> <caixa> <espaço>` | `/cobblemon:pctake <jogador> <caixa> <espaço>` | Vai para o time/PC de quem executou |
| `takepokemon <jogador> <espaço>` | `/cobblemon:takepokemon <jogador> <espaço>` | Idem, do time |
| `pcsearch <jogador> <props>` | `/cobblemon:pcsearch <jogador> <props>` | Até 60 resultados |
| `boxcount query/add/remove/set` | `/cobblemon:boxcount <query\|add\|remove\|set> <jogador> [quantidade]` | Não remove caixas com Pokémon |
| `renamebox <jogador> <caixa> <nome>` | `/cobblemon:renamebox <caixa> [nome]` | Do próprio jogador; também pelo PC |
| `openstarterscreen [jogador]` | `/cobblemon:openstarterscreen [jogador]` | Admin: abre mesmo se já escolheu |
| `stopbattle [jogador]` | `/cobblemon:stopbattle [jogador]` | `stopBattle(jogador)` da API de batalhas |
| `abandonmultiteam` / `abandonmultibattleteam` | `/cobblemon:abandonmultiteam`, `/cobblemon:abandonmultibattleteam` | `TeamManager.removeTeamMember`; sem equipe avisa `cobblemon.port.multi.not_in_team` (o Java não diz nada) |
| `technicalmachine unlock\|lock <jogadores> only <TM>\|all`, `technicalmachine check <jogador>` | `/cobblemon:technicalmachine <unlock\|lock\|check> <jogador> [only\|all] [tm]` | Admin, exige cheats (TmCommand.kt) |
| `givetm <golpe> [jogador] [quantidade]` / `giveTM` | `/cobblemon:givetm <golpe> [jogador] [quantidade]` | Golpe na lore do TM (`createTechnicalMachine`); pilhas de 64, sobra cai no chão; até 2304 |
| `checkspawn <bucket>` | `/cobblemon:checkspawn <common\|uncommon\|rare\|ultra-rare\|boss>` | Chances por espécie na zona de spawn em volta (média das posições, cores do Cobblemon) |
| `spawnpokemonfrompool [quantidade]` / `forcespawn` | `/cobblemon:spawnpokemonfrompool [quantidade]`, `/cobblemon:forcespawn [quantidade]` | Spawn natural forçado perto de quem executa (até 20 por comando) |
| `pokedex grant\|revoke\|printcalculations` | `/cobblemon:pokedex <ação> <jogadores> [all\|only] [pokédex\|espécie] [forma]` | |
| `spawnnpc <classe> [nível]` / `npcspawn` | `/cobblemon:spawnnpc <classe\|preset> [nível] [skin]`, `/cobblemon:npcspawn ...` | Classes: `standard`, `sacchi`, `ai_test`, `kitchen_sink`; preset `battler_test` |
| `spawnnpcat <pos> <classe>` / `npcspawnat` | `/cobblemon:spawnnpcat <posição> <classe\|preset> [nível]`, `/cobblemon:npcspawnat ...` | |
| `npcdelete` / `npcedit` | `/cobblemon:npcdelete`, `/cobblemon:npcedit` | NPC para onde você olha; `npcedit` abre um formulário |
| `opendialogue <diálogo> <jogador>` | `/cobblemon:opendialogue <diálogo> <jogador>` | Diálogos: `example`, `npc-example`, `sacchi_interaction`, `sacchi_healed` |
| `giveallpokemon <min> <max>` | `/cobblemon:giveallpokemon [min] [max]` | Nº da Pokédex; vai para o PC (1 por tick) |
| `spawnallpokemon <min> <max>` | `/cobblemon:spawnallpokemon [min] [max]` | Máximo de 100 por comando, em grade na sua frente |
| `cobblemonconfig reload` | `/cobblemon:cobblemonconfig [edit\|get\|set\|reset\|reload] [campo] [valor]` | `edit` (padrão) abre o editor; `get/set` funcionam no console do servidor |
| `cobblemon` (info) | `/cobblemon:cobblemon` | |
| — (tecla/overlay no Java) | `/cobblemon:party`, `/cobblemon:summary`, `/cobblemon:partyhud` | Extras do port |
| — (tecla R e setas do overlay no Java) | `/cobblemon:sendout [espaço]`, `/cobblemon:selectslot <1-6>` | Extras do port; o gesto é agachado + pular / agachar 2× |
| — (tela de Progresso e de Estatísticas do Java) | `/cobblemon:advancements`, `/cobblemon:stats [jogador]` | O Bedrock não mostra conquistas nem estatísticas de add-on nas telas nativas |
| `/gamerule` (6 gamerules do Cobblemon) | `/cobblemon:cobblemongamerule <regra> [true\|false]` | Admin, exige cheats; regras `doPokemonSpawning`, `doPokemonLoot`, `battleInvulnerability`, `mobTargetInBattle`, `doShinyStarters`, `healersHealPC` (o Bedrock não registra gamerule de add-on) |
| datapack `spawn_rules` | `/cobblemon:spawnrule <list\|enable\|disable\|add\|remove> [id] [json]` | Admin, exige cheats; as regras ficam no mundo |
| — | `/cobblemon:rideboost <espaço> <acceleration\|skill\|speed\|stamina\|jump\|all> <valor\|max> [jogador]` | Admin, exige cheats; testes de montaria |
| — (`BattleGUI` minimizável + tecla R no Java) | `/cobblemon:battleui [java\|hud\|classic\|default\|status]` | Extra do port: o padrão `java` já é o comportamento do Cobblemon; `hud` e `classic` são preferências opcionais |
| — (roda de interação) | `/cobblemon:pokebattle <jogador> [formato] [nível]` | Extra do port. O "equivalente à roda" é o menu de interação de jogador (interagir com outro jogador): Batalha simples/dupla/tripla, Formar grupo / Batalha Multi / Abandonar grupo e Troca; depois do formato (inclusive Multi) vem a tela da regra de nível (Luta Livre / Nível 50 / 100 / 5 para todos) |
| — | `/cobblemon:givestarterkit [jogador]` | QA: 16 Poké Balls, 8 Great, 4 Ultra, poções, Revive, Rare Candy, Exp. Candy, Exp. Share, Lucky Egg, PC, Healing Machine (+ um inicial aleatório se não tiver time) |
| — | `/cobblemon:selftest [quick\|full\|ui\|entities\|movement\|blocks\|particles\|sounds\|battle\|telas\|stop\|status] [segundos]` | Operador + cheats. Teste automático dentro do mundo para o ContentLog do cliente registrar erros de recursos: numa área temporária no céu acima de você (só ar), mostra todos os Pokémon (no `full`, a cobertura das variantes: cada modelo, textura, camada e poser ao menos uma vez), NPCs, bolas (paradas e arremessadas), barcos e exibições, solta Pokémon com IA num cercado, numa piscina e num volume aéreo fechados por barreira (andar, correr, nadar, voar) e monta você numa montaria terrestre, aquática e voadora, coloca cada bloco em cada estado, dispara cada partícula e toca cada som, abre cada tela (inicial, time, resumo, PC, Pokédex, diálogo, troca, batalha, conquistas, HUD) e joga uma batalha curta com time temporário. Sem argumento = `quick`. `telas` (ou `screens`) é o roteiro para prints: abre cada tela custom (36) com dados de exemplo, uma por vez, por `[segundos]` (padrão 10, de 3 a 60) ou até você fechar, com "Tela N/total: nome" antes de cada uma e a ordem no chat no fim. `stop` para e restaura; `status` mostra o progresso. Extensões opcionais podem acrescentar um modo próprio (que também entra no `full`) e paradas no `telas`. No fim tudo volta (área, água, entidades, posição, modo de jogo, câmera, HUD, montaria, inventário, time, Pokédex, estatísticas). Detalhes em [COMO-JOGAR.md](COMO-JOGAR.md#5-teste-automático-para-gerar-o-log) |

## Ainda não portados

| Cobblemon | Motivo / dono |
|---|---|
| `applyplayertexture` | Skin de jogador em NPC não é possível no Bedrock estável |
| `behaviouredit`, `freezepokemon`, `runmolang`, `runmolangscript`, `bedrockparticle`, `transformmodelpart`, `changescaleandsize`, `changewalkspeed`, `changeeyeheight`, `getnbt`, `reloadshowdown`, `testcommand`, `teststore`, `testpcslot`, `testpartyslot`, `cobblemonclicktext` | Depuração do mod Java / impossíveis no Bedrock (MoLang no servidor, NBT, modelos Java). `bedrockparticle` ≈ `/particle` vanilla |

## Script events (`/scriptevent`)

Opções do port que não são *custom commands* (valem para quem executa, salvo indicação):

| Script event | Faz |
|---|---|
| `cobblemon:ride_camera <auto\|always\|boom\|off\|freelook\|roll>` | Câmera da montaria. `freelook` = órbita sempre com a câmera livre no mouse (a montaria vira por A/D); `roll` = câmera perseguidora que inclina no voo, experimental e fora do padrão até ser conferida num cliente |
| `cobblemon:battle_ui_mode <modo>` | Alias antigo de `/cobblemon:battleui` (pelo console muda o padrão do mundo) |
| `cobblemon:selftest <modo> [segundos] [jogador]` | Alias de `/cobblemon:selftest` (operador). Pelo console, informe o jogador que vai rodar o teste; `stop` e `status` valem para o teste em andamento. `[segundos]` só vale para `telas` (ex.: `scriptevent cobblemon:selftest telas 15 Steve`) |
| `cobblemon:battle_music on\|off` | Música de batalha (operador; precisa de um pack com as faixas) |
| `cobblemon:dynamic_lights on\|off` | Luz dinâmica dos Pokémon luminosos (operador) |
| `cobblemon:village_pokecenters on\|off` | Pokécenter em vilas novas (operador) |
| `cobblemon:debug_probes on\|off` | Só no console do servidor: liga as sondas de depuração (`md_*`, `ms_*`, `debug_visual*`, `dadosia_*`, `ianpc_*`, `adapt_*`, `limb_*` e `cblimits:*`) |

## Equipes e Batalha Multi

Como no `TeamManager` do Cobblemon 1.8.2, pelo menu de interação de jogador:

1. Os dois sem equipe: **Formar grupo** manda o convite (expira em 60 s). O outro aceita pelo mesmo botão no
   menu dele (ou recusa por "Recusar (Formar grupo)"). Equipe de no máximo 2 jogadores; aceitar cancela os
   outros convites recebidos.
2. Jogadores de equipes diferentes: **Batalha Multi** (depois a regra de nível) desafia a outra equipe (expira
   em 20 s; os quatro são avisados). Qualquer membro da equipe desafiada aceita pelo mesmo botão ou com
   `/cobblemon:pokebattle <jogador> multi`. Antes de começar: 2 jogadores por equipe, todos com Pokémon, mesma
   dimensão e todos a até 15 blocos do centro do grupo. A batalha é 2×2 (um Pokémon ativo por jogador).
3. Mesma equipe: **Abandonar grupo** (ou `/cobblemon:abandonmultiteam`). Sair do servidor também tira da equipe e,
   se for no meio de uma batalha, encerra a batalha para todos (sem vencedor, como no Cobblemon).

## Config (`/cobblemon:cobblemonconfig`)

A config fica na dynamic property de mundo `cobblemon_config` (JSON) e segue o `CobblemonConfig.kt` 1.8.2.
O editor mostra as categorias do Cobblemon (Pokémon, Spawn, Batalhas, Cura, Mundo, Pokédex,
Armazenamento, Iniciais, Interface, Montaria, Depuração) com os textos e dicas do próprio Cobblemon.
Exemplos pelo console: `cobblemon:cobblemonconfig set shiny_rate 1024`, `cobblemon:cobblemonconfig get defaultBoxCount`.
Lista completa de campos e padrões: `DEFAULT_CONFIG` em `scripts/Config.ts`. Campos que só têm efeito
quando a frente dona ler da config estão listados em `docs/pendencias/interface.md`.
