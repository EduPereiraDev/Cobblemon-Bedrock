# Testes E2E (bots de protocolo)

A suíte E2E coloca **bots de protocolo** no BDS de teste como jogadores de verdade. Eles entram pela rede e
exercitam o add-on como um cliente faria: forms, comandos, interação com entidades, uso de item e troca entre
jogadores. Não há renderização. A pesquisa que levou a esta escolha está em `docs/pesquisa/6-cliente-teste.md`.

## Como rodar

```sh
npm run test:e2e                          # usa o container E2E; builda e faz deploy se ele não existir
npm run test:e2e -- --deploy              # build em dist-e2e + deploy antes de rodar (build atual)
npm run test:e2e -- --only starter        # só os cenários cujo nome/arquivo contém o texto (vírgulas = vários)
npm run test:e2e -- --list                # lista os cenários
npm run test:e2e -- --verbose             # mostra passos e eventos dos bots também nos cenários que passam
npm run test:e2e -- --scenario x.mjs      # roda um cenário avulso (mesmo formato de tests/e2e/scenarios)
npm run test:e2e -- --keep                # deixa o servidor de pé no fim (o padrão é `docker stop`)
npm run test:e2e -- --rm                  # apaga o container no fim (o mundo continua em .bds-e2e)
E2E_WORKAROUNDS=1 npm run test:e2e        # contorna bugs conhecidos do add-on para testar o resto do fluxo
E2E_KNOWN_BUGS=1 npm run test:e2e         # repete fluxos com bug intermitente conhecido (E2E-3: captura 4×)
```

O script `test:e2e` fixa o ambiente do servidor de teste:

| Variável | Valor | Por quê |
|---|---|---|
| `COBBLEMON_BDS` | `e2e` | container `cobblemon-bds-e2e`, dados em `.bds-e2e/` |
| `COBBLEMON_BDS_PORT` | `19148` | porta UDP no host |
| `COBBLEMON_DIST` | `dist-e2e` | build separado do `dist/` |
| `COBBLEMON_BDS_TRANSPORT` | `raknet` | o padrão do `tools/server.mjs` é NetherNet (clientes oficiais); os bots só falam RakNet |
| `COBBLEMON_BDS_ONLINE_MODE` | `false` | bots offline, sem conta Xbox |

`transport` e `online-mode` só são gravados no `server.properties` pelo `deploy`. Por isso o runner refaz o deploy
quando `.bds-e2e/server.properties` não está com `transport=raknet` e `online-mode=false`. Com RakNet, o BDS
1.26.5x escreve um aviso "TRANSPORT TYPE ERROR" no log, mas continua aceitando conexões RakNet. O runner ignora
esse aviso.

### Requisitos

- **Node ≥ 24** (exigido pelo `bedrock-protocol` 3.60). Com Node 22 na raiz, o `tools/e2e/run.mjs` se reexecuta
  sozinho com `fnm exec --using 24`. Para instalar: `fnm install 24`.
- **Docker** com a imagem `itzg/minecraft-bedrock-server`.
- **Dependências isoladas em `tools/e2e/`**, com `package.json` e `.npmrc` próprios. O runner instala sozinho na
  primeira vez, com `npm install --ignore-scripts`: o `raknet-native` tentaria compilar com cmake, mas a suíte usa o
  backend JS `jsp-raknet`.
- **Memória no Docker:** o BDS com o add-on usa cerca de 2 GiB. A VM do Docker Desktop desta máquina tem 7,6 GiB, e
  com vários BDS de pé o kernel mata algum por OOM.
  - Antes de ligar o servidor, o runner espera ter pelo menos 2,2 GiB livres (até 10 min; mede o `MemAvailable` da VM).
  - Se o servidor morrer no meio de um cenário, o runner o religa e repete o cenário uma vez.
  - No fim, o container é parado (`docker stop`), a não ser que se use `--keep`.

## O que cada cenário cobre

| Arquivo | Fluxo | Asserts |
|---|---|---|
| `01-starter` | 1º login: a tela de iniciais abre sozinha. Kanto → Bulbasaur → confirmar | `/cobblemon:party` mostra exatamente 1 Pokémon (bulbasaur); `/cobblemon:starter` de novo responde `alreadyselected` |
| `02-party` | `/cobblemon:givepokemon` ×2 e depois `/cobblemon:party` → Pikachu → Mandar para fora → Recolher | time = pikachu, eevee; aparece a entidade `cobblemon:pikachu` com o marcador ●; a entidade some ao recolher |
| `03-battle` | plataforma no alto, `/cobblemon:spawnpokemon rattata`, interagir → Lutar → golpe, em loop | form de ação com Lutar/Mochila/Trocar/Fugir; forms de golpe; termina com `{cobblemon.battle.win}` |
| `04-capture` | `/give` de Master Ball, Snorlax selvagem parado a 3 blocos numa plataforma, mirar e usar o item | a bola é lançada; `{cobblemon.capture.succeeded}`; o snorlax entra no time. O bug E2E-3 (captura abortava no meio) foi corrigido; o passo ainda registra os sons da sequência e o dano na bola |
| `05-pc` | `/cobblemon:pc`: `>>`, `<<`, menu da caixa → "Ir para caixa" (ModalForm/slider = 3); Eevee → "Mandar para o PC"; botão PC → retirar | 36 botões (6 de navegação + 30 espaços); caixas 1→2→1→3; o eevee sai do time, aparece na caixa 1 e volta |
| `06-npc` | `/cobblemon:npcspawn cobblemon:standard`, interagir → diálogo → Continuar → Cancelar; `/cobblemon:opendialogue cobblemon:example @s` | diálogo com a opção Battle; nenhum form depois de cancelar; o diálogo por comando abre |
| `07-trade` | 2 bots. A: `/cobblemon:trade B`; B aceita o pedido (MessageForm); ofertas; os dois aceitam | pedido `{cobblemon.trade.received}`; `{cobblemon.port.trade.completed}` nos dois; os times trocam (A = charmander, B = bulbasaur) |
| `08-pokedex` | `/give cobblemon:pokedex_red`, olhar para cima e usar o item | form `{item.cobblemon.pokedex_red}` com a busca; abre uma página de entradas |

Antes dos cenários, o runner prepara o mundo pelo console:
- `difficulty peaceful`, dia fixo e sem chuva;
- spawn natural desligado (`gamerule domobspawning false` e `cobblemonconfig set enableSpawning false`);
- `gamerule spawnradius 0` e `kill @e[type=!player]`.

Depois do primeiro bot entrar, o runner cria a ticking area `e2espawn` no spawn. Esse spawn também serve de âncora
das plataformas (`arena()`).

Cada cenário conecta bots novos. O nome é `<rótulo><id da execução>`, e a identidade offline deriva do nome, então
os dados de jogador são sempre limpos. Cada cenário tem timeout próprio e um resultado claro (✓/✗). Ao falhar, o
runner mostra:

- a mensagem e os passos do cenário;
- por bot: os últimos 5 forms (título, corpo e botões já achatados) e os últimos 60 eventos (forms, respostas,
  chat, títulos, entidades, comandos e saídas);
- as linhas ERROR/WARN do log do servidor durante o cenário, mais as últimas 25 linhas do log.

Mesmo nos cenários que passam, ERROR/WARN do servidor aparecem como ⚠.

## Como os textos aparecem nos asserts

- Forms e chat chegam como rawtext. O bot achata tudo para texto:
  - `translate` vira `{chave}`;
  - os parâmetros viram `{chave}(arg1arg2)`;
  - exemplo: `{cobblemon.species.bulbasaur.name} {cobblemon.label.lv}(10)`.
- Os asserts usam as chaves, sem depender do idioma. Alguns títulos têm marcadores de layout do JSON UI (`§0§2§r…`),
  por isso os cenários usam "contém", e não "começa com".

## Estrutura

```
tools/e2e/run.mjs          runner (Node 24 via fnm, memória, deploy, retry por OOM, dumps, resumo)
tools/e2e/package.json     bedrock-protocol 3.60.1 (isolado da raiz)
tests/e2e/lib/bot.mjs      Bot: connect/spawn, command, forms (wait/answer/close), texto/título,
                           entidades (wait/interact/attack), hotbar/useItem, lookAt, teleport, inventário, dump
tests/e2e/lib/server.mjs   container E2E: console, logs, estado/OOM, memória, deploy, ping RakNet
tests/e2e/lib/flows.mjs    fluxos do add-on: starter, party, givepokemon, spawnWild, giveItem/holdItem, arena
tests/e2e/scenarios/*.e2e.mjs   um cenário por arquivo: export default { name, timeout, run(t) }
```

Contexto `t` de um cenário:

- `t.bot(rótulo)` conecta, espera o spawn e a posição real e devolve o `Bot`. Tenta 2 vezes.
- `t.step(msg)` registra um passo; `t.warn(msg)` registra um aviso; `t.assert(cond, msg)` faz um assert.
- `t.console(cmd)` manda um comando pelo console do servidor; `t.sleep(ms)` espera.

API principal do `Bot`:

- **Comandos:**
  - `command(cmd)`: comandos vanilla esperam `command_output`. Os comandos `cobblemon:*` não mandam saída quando
    dão certo; a resposta chega por chat ou form.
  - `commandOk(cmd)`.
- **Forms:**
  - `waitForForm(match)` e `clickForm(match, botão)`;
  - `answerForm(form, índiceOuTexto | 0/1 | [valores])` e `closeForm(form)`;
  - `buttonIndex(form, match)`.
- **Chat e títulos:** `mark()`, `waitForText(match, { since })` e `waitForTitle(match, { actionbar })`.
- **Entidades:**
  - `waitForEntity(tipoOuFiltro)`, `waitForEntityGone(e)` e `findEntities(f)`;
  - `interact(e)` e `attack(e)`.
- **Itens:**
  - `selectSlot(n)`, `useItem()` e `lookAt(pos)`;
  - `inventoryItems()`, `findSlot(networkId)` e `itemNetworkId(id)`.
- **Posição:** `queryPosition()` e `teleport(x, y, z)`.
- **Diagnóstico:** `dump()`.

## Detalhes do protocolo

Coisas que custaram horas e ficam documentadas no código:

1. **RakNet protocolo 11.** O BDS 1.26.5x responde `IncompatibleProtocolVersion` ao protocolo 10 que o
   `jsp-raknet` 2.2 manda fixo. O `bot.mjs` troca esse byte, e o patch só vale com `useRaknetWorkers: false`.
2. **Fim da tela de carregamento.** Sem `serverbound_loading_screen` (tipos 1 e 2) depois do spawn, o BDS 1.26
   ignora o `player_auth_input` e as interações: o jogador não anda, não bate e não interage.
3. **Item vazio no `inventory_transaction`.** O `bedrock-protocol` serializa o `extra` de um ItemV4 vazio como
   nada; o BDS espera um varint 0. Sem isso, interagir e usar item eram descartados. O bot corrige isso no
   `_sendTransaction`.
4. **Ticking area sem preload.** O runner cria uma ticking area no spawn para as entradas seguintes ficarem
   rápidas: cerca de 5 s em vez de cerca de 45 s. Não pode ter `preload`: com preload, o BDS segura o spawn de
   jogadores até carregar a área toda.
5. **Primeiro comando depois do spawn.** Às vezes o servidor o ignora. O `queryPosition()` repete o `/tp @s ~ ~ ~`
   até o `move_player` chegar.
6. **Posição inicial.** O `start_game` manda y=32769 (o servidor ainda não achou o chão). A posição real vem do tp.
7. **Arremessos e interações.** Usam a rotação do `player_auth_input`: `lookAt()` e esperar um tick antes de
   `useItem()`.
8. **Janelas de recepção do jsp-raknet.** As janelas têm tamanho fixo (256) e são o principal motivo de a conexão
   "parar".
   - Um datagrama perdido prende o início da janela, porque o reenvio chega com outro número.
   - Depois de 256 datagramas, os novos são descartados, mas já foram confirmados com ACK.
   - Resultado: o bot para de receber qualquer coisa segundos depois do spawn, e o servidor acha que está tudo bem.
   - O `bot.mjs` troca as duas janelas (datagramas e mensagens confiáveis) por versões sem limite superior.
   - Também esvazia a fila de recepção inteira a cada tick; o original processa 4 datagramas por tick.
   - Se ainda assim a conexão parar, os timeouts dizem `[conexão parada: nenhum pacote há N s]`, e o runner
     repete o cenário uma vez (falha de infraestrutura, não do add-on).
9. **Plataformas.** As plataformas de teste (`arena()`) ficam deslocadas do spawn. Uma plataforma acima do ponto
   de spawn vira o chão onde os próximos jogadores nascem, e eles caem dela.
10. **Forms fechados pelo servidor.** O servidor fecha forms (`clientbound_close_form`, por exemplo nas atualizações
   da troca). O bot marca esses forms como respondidos, e os cenários sempre respondem o form mais novo.

## Status

O status da suíte e os bugs encontrados no add-on (com repro) ficam em `docs/pendencias/e2e.md`.
