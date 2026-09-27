# Pesquisa 6 — Cliente Bedrock de teste no Mac (visual + E2E automatizado)

> Data: 2026-09-26. Máquina: **Apple M1 Max, 64 GB**, macOS 26.5 (Darwin 25.5), Docker Desktop 4.54.
> Servidor: container `cobblemon-bds` (`itzg/minecraft-bedrock-server:latest`) rodando **BDS 1.26.52.3**.
> Protocolo de rede da linha 1.26.50/1.26.51 = **2193** (Mojang/bedrock-protocol-docs). O 1.26.52 não tem
> notas públicas. Deve ser um hotfix só do servidor com o mesmo protocolo, mas isso precisa ser confirmado
> no primeiro handshake.
> Objetivo: (a) um cliente **real** para conferir o visual (modelos, animações, forms JSON UI, HUD) com
> screenshots e input comandados por agente; (b) testes E2E dos scripts (entrar como jogador, abrir e responder
> forms, interagir com entidades), mesmo sem renderização.

---

## TL;DR

| # | Opção | Viável? | Custo | Automação | Veredito |
|---|---|---|---|---|---|
| 1 | **mcpelauncher** (Android nativo no macOS) | **ARRISCADO** no M1 com 1.26.5x | Minecraft no Google Play (~US$ 7) | Boa: computer-use/`screencapture` + `cliclick`; fork com socket de agente (não confiável ainda) | **Primeira tentativa para o visual** (spike de 1–2 h) |
| 2 | Android Emulator (AVD arm64 + Play Store) | **ARRISCADO, tendendo a NÃO** (GLES 3.1 no host macOS) | Grátis + mesma compra no Play | Excelente (`adb`) | Só um spike rápido, se o item 1 falhar |
| 3 | VM Windows 11 ARM (Parallels / VMware Fusion) | **SIM, mas pesado** (x64 emulado via Prism, DX11) | Parallels US$ 99,99–119,99/ano (Fusion é grátis) + Windows + Minecraft for Windows (~US$ 30) | Boa (`prlctl capture` / `send-key-event` / `exec`) | Plano B para o visual, e para conferir o cliente "PC" |
| 4 | App de iPad no Mac Apple Silicon | **NÃO** | — | — | A Mojang não habilita "Designed for iPad" no Mac |
| 5 | **Bot de protocolo** (bedrock-protocol / gophertunnel) | **SIM** (1.26.51 / 2193 suportado) | Grátis | Total: pacotes como objetos JS/Go | **Melhor caminho para E2E dos scripts** |
| + | Aparelho Android físico + `adb`/`scrcpy` | SIM | Aparelho (~US$ 150+) + compra no Play | Excelente (`adb`) | Plano B mais robusto para o visual, se o M1 não rodar o 1.2 |

**Achado bloqueante no ambiente atual (seção 0):** o BDS está com `transport=nethernet`. Ele escuta **TCP** 19132
(sinalização) e UDP 7551, mas o container só publica **UDP** 19132. Hoje **nenhum cliente, real ou bot, conecta
a partir do Mac**. Correção recomendada para teste: `TRANSPORT=raknet`.

---

## 0. Achado local: o BDS 1.26.5x está em NetherNet e fica inacessível pelo host

Evidência coletada nesta sessão (somente leitura):

- `/data/server.properties` no container tem `transport=nethernet` e `enable-lan-visibility=true`.
- `/proc/net/tcp6` no container mostra LISTEN em `:4ABC` (= **TCP 19132**). `/proc/net/udp6` só tem `:1D7F`
  (= UDP 7551, descoberta de LAN do NetherNet). **Não há socket UDP 19132.**
- `docker port cobblemon-bds` mostra só `19132/udp`. Um ping RakNet (unconnected ping) do Mac para
  `127.0.0.1:19132` dá **timeout**. De outro container para `host.docker.internal:19132` também dá timeout.
  O `mc-monitor status-bedrock` feito de outro container direto no IP do container (172.17.0.3) responde
  `version=1.26.52`.
- NetherNet é o transporte WebRTC que o BDS passou a usar por padrão por volta do 26.50/26.51. Ele quebrou túneis
  e NAT: veja playit.gg e o PR #675 do itzg, que mapeou `TRANSPORT`, `SERVER_UDP_PORTS` e `SERVER_IP` e documenta
  **TCP 19132** para sinalização mais uma faixa UDP anunciada, como `reachable-ipv4:19140-19155:19140-19155`.
  Dentro do Docker Desktop, o ICE anuncia o IP interno do container. Por isso só funciona com
  `server-udp-ports` mapeado e publicado.

**Correção recomendada para testes** (não apliquei; `tools/server.mjs` controla o container):

```sh
# opção simples: voltar ao RakNet (clientes 1.26.5x ainda aceitam RakNet)
docker run ... -e TRANSPORT=raknet -p 19132:19132/udp itzg/minecraft-bedrock-server:latest
# ou editar /data/server.properties: transport=raknet  (depois reiniciar)
```

Alternativa com NetherNet: publicar `-p 19132:19132/tcp` e uma faixa UDP (por exemplo `-p 19140-19155:19140-19155/udp`),
com `SERVER_UDP_PORTS=127.0.0.1:19140-19155:19140-19155`. Isso é mais frágil, e nem todo bot fala a sinalização
direta do NetherNet (seção 5).

Para o bot E2E também é preciso `online-mode=false` (env `ONLINE_MODE=false`). O ideal é um container **separado**
só para E2E (por exemplo `cobblemon-bds-e2e`, porta 19142), para o servidor de desenvolvimento continuar com
`online-mode=true` para clientes reais.

---

## 1. mcpelauncher (minecraft-linux / ChristopherHX): APK Android rodando no macOS

**Status em set/2026**
- O port para macOS foi refeito na linha **v1.8.x**. A última versão é a **v1.8.5 (2026-09-19)**, um DMG único de
  ~307 MB em `minecraft-linux/macos-builder`, que também aparece como `ChristopherHX/osx-packaging-scripts`.
  A v1.7.6 era só Intel/Rosetta e parava nas versões anteriores ao GLES 3.1.
- **Aviso conhecido da própria release v1.8.5:** "*m3 devices are not supported anymore in 26.50+ due to graphical
  glitches*". O autor testa em M4 Pro (macOS 15), que funciona, e M4/M5 também não têm o problema.
  **M1/M2 não aparecem em nenhum relato, nem a favor nem contra.** O M1 Max desta máquina é um caso não testado,
  por isso o **ARRISCADO**.
- O **1.26.50+ precisa do mod `mcpelauncher-updates` ≥ 0.0.2**. Sem ele, o jogo aborta com
  `dlopen failed: cannot locate symbol "pthread_sigmask"` (issue #2030, macOS arm64, aberta em 17/09;
  issue #2037 no Linux). A v1.8.5 passou a sugerir a ativação e a atualização desse mod.
- Outros bugs recentes: digitação no chat e em campos de texto quebrou no runtime 1.8.0–1.8.3 e voltou na
  **v1.8.4 com 1.26.51.1** (#2034). Houve UI de Play/Settings invisível num M3 (#2023). Existe um crash antigo em
  `libPlayFabMultiplayer` no 1.26.45.1 (#2007).
- Renderização: o jogo usa GLES 3.1, traduzido por ANGLE para Vulkan e depois MoltenVK para Metal. O ANGLE sobre
  Metal só entrega ES 3.0, então não serve. Precisa de sessão gráfica: headless de verdade não existe no macOS.

**Requisitos pessoais do usuário** (eu não posso fazer):
1. **Ter o Minecraft comprado no Google Play**, cerca de US$ 7 (o preço regional varia), e **fazer login Google dentro do
   launcher**. O launcher baixa o APK do Google Play com essa conta.
2. **Login da conta Microsoft/Xbox dentro do jogo.** O cliente exige conta Microsoft para multiplayer em servidor
   externo, e o README do `mcpelauncher-agent` também pede "signed-in Xbox account". A conta é gratuita.
3. Liberar o app no Gatekeeper (Ajustes → Privacidade e Segurança) e, para automação, conceder **Gravação de Tela**
   e **Acessibilidade** ao terminal ou app que vai capturar e clicar.

**Instalação**
```sh
# 1) baixar Minecraft.Bedrock.Launcher.dmg (~307 MB):
#    https://github.com/minecraft-linux/macos-builder/releases/tag/v1.8.5
xattr -r -d com.apple.quarantine ~/Downloads/Minecraft.Bedrock.Launcher.dmg   # a release manda fazer isso
open ~/Downloads/Minecraft.Bedrock.Launcher.dmg      # arrastar para /Applications (precisa ser gravável p/ o updater)
open "/Applications/Minecraft Bedrock Launcher.app"
# 2) no launcher: login Google → escolher 1.26.51.1 → ativar/atualizar o mod mcpelauncher-updates (>= 0.0.2) → Play
# 3) no jogo: login Microsoft → Servidores → Adicionar: 127.0.0.1 : 19132   (com o BDS em transport=raknet)
```
Não há cask no Homebrew: `brew search mcpelauncher` não encontra nada. Existe um cask de terceiro
(`hugonote/tap/mcpelauncher-swift`, uma UI em SwiftUI), mas eu não o avaliei e não recomendo.

**Automação por agente**
- **Sem modificar nada no launcher:** a janela do jogo é um app nativo comum.
  - O MCP **computer-use**, já disponível nesta instalação do Claude Code, tira screenshot e clica e digita em apps
    nativos (nível "full" para não-navegadores).
  - Via shell: `screencapture -x -o -l <windowID> shot.png` para capturar e `brew install cliclick` para mouse e teclado.
  - Limitação: com o cursor travado no mundo, o "olhar" usa mouse relativo e fica ruim de dirigir com cliques absolutos.
- **Enquadramento determinístico pelo servidor**, sem depender do mouse. É o que torna o teste visual reprodutível:
  `node tools/server.mjs cmd "tp <bot> x y z"`, depois `camera <player> set minecraft:free pos x y z facing x y z`,
  `summon cobblemon:pokemon ...` e `playanimation ...`. Com isso o agente só precisa **capturar** e, nos forms,
  clicar em coordenadas estáveis (janela e escala da GUI fixas). F1 esconde o HUD.
- **Fork `bedrock-mc/mcpelauncher-manifest` (client-v0.1.0 a v0.1.3, 06/09/2026):** substitui o binário
  `mcpelauncher-client-arm64-v8a` e adiciona `--agent-socket <path>`, um socket JSON por linha com `screenshot`
  (PNG do framebuffer GL), `key`, `text`, `mouse_move` (relativo, bom para câmera), `click`, `uri`
  (`minecraft:` deep link para adicionar servidor), `fps` e `quit`. Também traz `--hidden` (a janela oculta
  continua renderizando) e `--fps-cap`. O `bedrock-mc/mcpelauncher-agent` expõe tudo isso como **servidor MCP**
  (TypeScript/Bun).
  - **Risco de confiança:** a organização foi criada em 06/09/2026, o repositório tem 2–3 estrelas e o binário é
    ad-hoc signed. Só foi verificado no **1.26.45.1**, em macOS 26.5.1 com Apple Silicon.
  - Recomendação: **não instalar o binário pronto.** Se o upstream funcionar no M1, considerar compilar o fork do
    código-fonte (GPL-3.0, branch `agent`) depois de revisar o código.

**Custo:** a compra no Google Play (~US$ 7), se ainda não houver.

---

## 2. Android Emulator (AVD arm64 com Google Play) + Minecraft da Play Store

- Performance da CPU no Apple Silicon: boa. Imagens arm64 rodam nativamente (Hypervisor.framework), e a versão
  estável atual é o emulator 37.1.11 (jul/2026).
- **GPU é o ponto fraco.** No host macOS, o emulador expõe **só OpenGL ES 3.0** para o guest (thread do projeto
  ANGLE, set/2024: "*only Metal has enough features on MacOS to provide ES 3.2*", sem planos oficiais). O
  Minecraft Android usa **só OpenGL ES** (RenderDragon não tem Vulkan no Android) e **a partir do 1.26.10 exige
  ES 3.1**, segundo as notas do fork bedrock-mc e o aviso do mcpelauncher de que "*mojang is going to make OpenGL
  ES 3.1 required*". Resultado provável: o jogo nem inicia com `-gpu host`. Com renderização por software
  (`-gpu swiftshader_indirect` / `-gpu software`, Lavapipe como padrão desde a 36.4.9) talvez inicie, mas fica
  muito lento. Não encontrei relato confirmado de 1.26.x funcionando em AVD no Mac.
- Requisitos do usuário: login Google na Play Store do emulador e a mesma compra do Minecraft (a conta é a mesma do
  item 1), mais login Microsoft no jogo.
- Instalação (spike de ~1 h):
```sh
brew install --cask android-commandlinetools   # ou android-studio
sdkmanager "platform-tools" "emulator" "system-images;android-35;google_apis_playstore;arm64-v8a"
avdmanager create avd -n mc -k "system-images;android-35;google_apis_playstore;arm64-v8a" -d pixel_7
emulator -avd mc -gpu host            # se falhar, testar: -gpu swiftshader_indirect
```
- Automação (a melhor de todas as opções com cliente real):
  `adb exec-out screencap -p > shot.png`, `adb shell input tap X Y`,
  `adb shell input swipe X1 Y1 X2 Y2 300`, `adb shell input text 'abc'`, `adb shell input keyevent 66` (Enter).
  O `-no-window` também funciona para capturas.
- Servidor a partir do emulador: **`10.0.2.2:19132`** (loopback do host), com o BDS em RakNet e a porta UDP
  publicada.
- **Veredito:** ARRISCADO, tendendo a NÃO por causa do GLES 3.1. A mesma automação por `adb` funciona **muito
  melhor num Android físico** (seção 6).

---

## 3. VM Windows 11 ARM (Parallels / VMware Fusion / UTM) + Minecraft for Windows

- **Não existe build nativo ARM64 do Minecraft for Windows em 2026.** No Windows on ARM roda o build **x64** pelo
  emulador Prism (24H2+). Há pedidos abertos no Minecraft Feedback, e o BDS também só existe para x86_64.
- **Parallels Desktop:** 3D em DirectX 11.1 no Windows 11 ARM, suficiente para o RenderDragon em DX11. A própria
  Parallels anuncia Bedrock rodando, mas relatos citam instabilidade conforme a versão do jogo e da Store.
  - Preço: Standard US$ 99,99/ano ou US$ 219,99 vitalício; **Pro US$ 119,99/ano**. O CLI `prlctl` é recurso das
    edições Pro/Business.
  - Automação pelo host: `prlctl capture "<VM>" --file shot.png`,
    `prlctl send-key-event "<VM>" -k <code>` (ou `-j` para uma sequência em JSON) e
    `prlctl exec "<VM>" powershell ...` (executa no guest: AutoHotkey, envio de comandos etc.).
  - O host é acessível do guest na rede compartilhada. O gateway padrão da rede Shared do Parallels é
    10.211.55.2; confira com `ipconfig` no guest.
- **VMware Fusion 13 Pro:** grátis para uso pessoal e comercial desde a mudança de licença da Broadcom (nov/2024).
  Tem 3D DX11 para Windows 11 ARM. Automação por `vmrun captureScreen` e `vmrun runProgramInGuest`, que pedem as
  credenciais do guest (a VM do próprio usuário).
- **UTM:** sem aceleração 3D útil para guest Windows. O projeto `MacBedrock` usa UTM com DXMT de forma experimental
  e diz textualmente que o gameplay **não foi verificado**. **NÃO**, para jogar.
- Requisitos do usuário: licença do Windows 11 (é possível rodar sem ativar, com limitações), **comprar o Minecraft
  for Windows** (ou o bundle Java+Bedrock, ~US$ 30; é uma licença **separada** da do Google Play), fazer login
  Microsoft e instalar pela Microsoft Store ou pelo Minecraft Launcher.
- M1 Max com 64 GB comporta bem uma VM de 8 GB e 4–6 vCPUs. O desempenho é "jogável" mas pesado, com x64 emulado
  e GPU paravirtualizada.
- **Veredito:** SIM (Parallels é a opção mais testada pela comunidade), com custo e manutenção maiores. Serve bem
  como **plano B para o visual** e para verificar o comportamento do cliente de PC (teclado/mouse, JSON UI no
  layout desktop).

---

## 4. App de iPad no Mac Apple Silicon

**NÃO.** O Minecraft não aparece na seção "Apps para iPhone e iPad" da Mac App Store: a Mojang/Microsoft não marcou
"disponível no Mac" no App Store Connect. Há um pedido aberto no Minecraft Feedback para habilitar. Fazer sideload
com IPA descriptografada (PlayCover etc.) é caminho de pirataria/DRM, e eu não recomendo.

---

## 5. Bots headless que falam o protocolo Bedrock (E2E sem renderização)

### 5.1 PrismarineJS `bedrock-protocol` (Node): recomendado, mesma linguagem do projeto
- **v3.60.1 (22/09/2026)**. A 3.60.0 adicionou *Support Minecraft 1.26.51*, a versão padrão `CURRENT_VERSION = '1.26.51'`
  e o **transporte NetherNet**, com descoberta pelo pong de RakNet ou NetherNet. O `minecraft-data` mapeia
  `1.26.51 → 2193`.
- **Requer Node ≥ 24.** O Node padrão aqui é o 22.14, mas o `fnm` já tem o **24.15.0**. O backend padrão
  `raknet-native` compila com cmake-js, e `cmake` não está instalado. Use `raknetBackend: 'jsp-raknet'` (JS puro)
  ou instale o cmake.
- **Offline:** `offline: true` no bot + `online-mode=false` no BDS. Sem login Xbox e sem credenciais.
- **Forms:** o cliente recebe `modal_form_request` (`form_id`, `data` = JSON do form: `type` `form`/`modal`/
  `custom_form`, título, botões, elementos) e **pode responder** com `modal_form_response`
  (`form_id`, `has_response_data`, `data` = JSON: índice do botão, `true`/`false`, ou array de valores do custom form;
  ou `has_cancel_reason` + `cancel_reason: 'closed'|'busy'`). Isso cobre `ActionFormData` (74 usos no código),
  `ModalFormData` (24) e `MessageFormData` (13).
- **DDUI (`CustomForm` + `Observable`, usado em `scripts/GUI/Summary.ts`):** usa outros pacotes, como
  `clientbound_data_driven_ui_show_screen`, `clientbound_data_store`, `serverbound_data_store` e
  `serverbound_data_driven_screen_closed`. O bot recebe e loga isso, mas responder exige entender a semântica
  das "data stores", que não está documentada. **ARRISCADO:** deixar para depois.
- **Entidades:** `add_entity` traz `runtime_id`, `entity_type` (por exemplo `cobblemon:pokemon`), posição,
  metadados e propriedades. Para interagir, o bot envia `inventory_transaction` com
  `transaction_type: 'item_use_on_entity'` e `transaction_data: { entity_runtime_id, action_type: 'interact'|'attack',
  hotbar_slot, held_item, player_pos, click_pos }`. Isso dispara `playerInteractWithEntity` nos scripts.
  Precisa estar a ≤ ~6 blocos: faça `/tp` antes.
  - O BDS 1.26 tem movimento com autoridade do servidor: para andar, o bot envia `player_auth_input` a cada tick.
    Para teste, é mais simples teleportar.
- **Comandos:** `command_request` com `version: 'latest'` e `origin.player_entity_id: 0n`. Esses dois campos mudaram
  no 1.21.130+ e, se errados, causam desconexão. A resposta chega em `command_output`, com `output_type`
  `'alloutput'`. Como o container usa `DEFAULT_PLAYER_PERMISSION_LEVEL=operator`, o bot pode rodar `/give`, `/tp`,
  `/summon` e `/scriptevent`.
- **Outros sinais úteis para asserts:**
  - `text` (chat/tellraw) e `set_title` (title/actionbar);
  - `animate_entity` (nomes de animação disparados por `playAnimation`: valida o lado script da animação);
  - `play_sound` / `level_sound_event`;
  - `inventory_content` / `inventory_slot`;
  - `set_entity_data` / `update_block`.
- Os resource packs com `texturepack-required=true` são aceitos automaticamente pelo `createClient`, que responde
  `resource_pack_client_response: completed`.
- **NetherNet no bot:** a sinalização padrão é `'lan'` (broadcast na 7551), que não atravessa o NAT do Docker.
  Para o bot, use **RakNet** (`TRANSPORT=raknet`) ou rode o bot **dentro** da rede Docker
  (`--network container:cobblemon-bds-e2e`).

### 5.2 Sandertv `gophertunnel` (Go): alternativa forte
- `CurrentProtocol = 2193`, `CurrentVersion = "1.26.50"` no master: o PR #520 foi mergeado em 16/09/2026 e há
  commits até 25/09. O último tag é `v1.62.0`; use o commit do master para ter o 2193.
- Tem RakNet e **NetherNet** (`go-nethernet`, com sinalização HTTP direta, a mesma do BDS com
  `transport=nethernet`, como no exemplo `example_nethernet_test.go`).
- Tipos fortes para todos os pacotes (`packet.ModalFormRequest`, `packet.ModalFormResponse`,
  `packet.InventoryTransaction` com `protocol.UseItemOnEntityTransactionData`, `packet.CommandRequest`).
- Modo offline: `minecraft.Dialer{IdentityData: login.IdentityData{DisplayName: "bot"}}` sem `TokenSource`, com o
  BDS em `online-mode=false`. O Go 1.27.1 já está instalado.
- Suporta uma versão de protocolo por vez, a mais recente, o que aqui é bom.

### 5.3 Complementos
- **Endstone** (v0.11.12, 20/09/2026, suporta BDS 1.26.51) é um framework de **plugins no servidor** (Python/C++),
  não um cliente. Pode servir de harness no servidor, mas prende a versão do BDS. Não é necessário agora.
- **`SimulatedPlayer`** (`@minecraft/server-gametest`: `interactWithEntity`, `attackEntity`, `useItem`,
  `navigateToEntity`, `chat`...) cria jogadores falsos dentro do próprio BDS, sem rede. **Só existe como Beta/
  experimental**, o que conflita com o alvo "estável, sem toggles" do projeto. Os eventos de item podem não disparar
  igual a um jogador real, e ele não responde forms. Serviria só num mundo de teste separado.

**Custo:** grátis. **O usuário não precisa fazer nada pessoalmente**: não há login nem compra.

---

## 6. Outras opções consideradas

- **Aparelho Android físico** (tablet ou celular com GPU GLES 3.1+) + `adb` por USB ou Wi-Fi + `scrcpy` para ver
  e gravar. É cliente real com GPU real e tem a mesma automação do item 2 (`screencap`, `input`). Conecta no IP de
  LAN do Mac, com o BDS em RakNet e o firewall liberando UDP 19132. Usa a mesma compra no Google Play. É o plano B
  mais **confiável e scriptável** se o mcpelauncher não rodar 1.26.5x no M1.
- **Windows x64 na nuvem com GPU** (VM de GPU por hora ou Shadow PC) + Minecraft for Windows + túnel até o BDS.
  Funciona, mas tem custo recorrente, latência, e precisa expor o servidor. Não recomendo.
- **Minecraft Education** (tem cliente nativo no macOS): **NÃO**. É outra linha de versão, precisa de licença
  educacional e não conecta a um BDS comum.

---

## 7. Recomendação

### (a) Melhor caminho para teste visual
1. **Spike mcpelauncher v1.8.5 no M1 Max**, com timebox de 2 h. Critério de sucesso: entrar no BDS local (após
   `TRANSPORT=raknet`) com 1.26.51.1 e ver um `cobblemon:pokemon` animado e um ActionForm sem glitches.
   - Se funcionar, a automação usa **computer-use MCP** ou `screencapture -l` + `cliclick`, e o enquadramento
     vem de comandos do servidor (`tp`/`camera`/`summon`/`playanimation`). Assim o agente só captura e compara.
   - Evolução opcional: compilar o fork `bedrock-mc` com `--agent-socket` e o MCP `mcpelauncher-agent`, depois
     de revisar o código.
2. Se o M1 mostrar os mesmos glitches do M3: **Android físico + adb/scrcpy** (baixo custo, altamente scriptável)
   ou **Parallels + Windows 11 ARM + Minecraft for Windows**, para validar também o layout de PC.
3. Emulador Android no Mac: só como curiosidade (limite de GLES 3.1).

### (b) Melhor caminho para E2E dos scripts: bot de protocolo (bedrock-protocol)

**Protótipo mínimo** (1 dia):

1. **Servidor E2E separado**, com o mesmo pack do `tools/server.mjs deploy`:
   ```sh
   docker run -d --name cobblemon-bds-e2e -e EULA=TRUE -e VERSION=LATEST -e LEVEL_NAME=cobblemon-e2e \
     -e ONLINE_MODE=false -e TRANSPORT=raknet -e ALLOW_CHEATS=true -e DEFAULT_PLAYER_PERMISSION_LEVEL=operator \
     -e TEXTUREPACK_REQUIRED=true -e SERVER_PORT=19142 -p 19142:19142/udp \
     -v "$PWD/.bds-e2e:/data" itzg/minecraft-bedrock-server:latest
   ```
   Outra forma: adicionar um subcomando `e2e` ao `tools/server.mjs` que reaproveite `deploy()` apontando para
   `.bds-e2e`.
2. **Dependência:** `npm i -D bedrock-protocol@3.60.1` e rodar com `fnm exec --using 24 node ...`.
3. **`tests/e2e/bot.mjs`** (esqueleto):
   ```js
   import { createClient } from 'bedrock-protocol'
   import { randomUUID } from 'node:crypto'

   export function connect(name = 'CobbleBot') {
     const client = createClient({
       host: '127.0.0.1', port: 19142, username: name,
       offline: true,              // BDS com online-mode=false
       transport: 'raknet',        // BDS com transport=raknet
       version: '1.26.51',         // protocolo 2193 (confirmar que o BDS 1.26.52 aceita)
       skipPing: true, raknetBackend: 'jsp-raknet', conLog: null,
     })
     const entities = new Map()
     client.on('add_entity', p => entities.set(p.runtime_id, p))
     client.on('remove_entity', p => { for (const [k, e] of entities) if (e.unique_id === p.entity_id_self) entities.delete(k) })

     const waitFor = (name, pred = () => true, ms = 10_000) => new Promise((res, rej) => {
       const t = setTimeout(() => rej(new Error(`timeout ${name}`)), ms)
       const h = p => { if (pred(p)) { clearTimeout(t); client.off(name, h); res(p) } }
       client.on(name, h)
     })
     const command = cmd => {
       const uuid = randomUUID()
       client.queue('command_request', { command: cmd, origin: { type: 'player', uuid, request_id: '', player_entity_id: 0n }, internal: false, version: 'latest' })
       return waitFor('command_output', p => p.origin.uuid === uuid).catch(() => null)
     }
     const answerForm = (form_id, value /* índice | true/false | array | null=fechar */) =>
       client.queue('modal_form_response', value === null
         ? { form_id, has_response_data: false, has_cancel_reason: true, cancel_reason: 'closed' }
         : { form_id, has_response_data: true, data: JSON.stringify(value), has_cancel_reason: false })
     const interact = (target, pos) => client.queue('inventory_transaction', { transaction: {
       legacy: { legacy_request_id: 0 }, transaction_type: 'item_use_on_entity', actions: [],
       transaction_data: { entity_runtime_id: target.runtime_id, action_type: 'interact', hotbar_slot: 0,
         held_item: { network_id: 0 }, player_pos: pos, click_pos: { x: 0, y: 0, z: 0 } } } })

     return { client, entities, waitFor, command, answerForm, interact, spawned: waitFor('spawn', () => true, 60_000) }
   }
   ```
   Os campos de `inventory_transaction`/`ItemV4` precisam ser conferidos contra
   `minecraft-data/data/bedrock/latest/{proto,types}.yml` no primeiro teste. O resto segue a documentação e o
   `proto.yml` atuais.
4. **Três cenários iniciais**, que podem entrar no `tools/run-tests.mjs` como suíte `e2e` opcional:
   - *login + starter*: o bot entra. Assert: recebe um `modal_form_request` do starter com N botões; o bot responde
     o índice 0; assert com `/scriptevent` ou lendo o tellraw/`text`: o Pokémon está na party.
   - *entidade*: `command('/summon cobblemon:pokemon ~2 ~ ~')`, aguardar `add_entity` com
     `entity_type === 'cobblemon:pokemon'` e `interact()`. Assert: form de interação ou `animate_entity` esperado.
   - *NPC/diálogo*: interagir com o NPC e percorrer 2–3 forms do `DialogueManager` respondendo índices.
     Assert: o texto final ou o estado esperado.
5. **Critérios de aceite:** a suíte roda em < 2 min com o BDS de pé, sem login humano. Falhas mostram o JSON do form
   ou pacote recebido. O Content Log do BDS (`node tools/server.mjs logs`) é anexado ao resultado.
6. **Depois:** suporte a DDUI (`Summary.ts`); bot em Go (gophertunnel) se o Node atrapalhar; testar NetherNet de
   verdade só quando for necessário.

---

## 8. O que só o usuário pode fazer

- [ ] Decidir e aplicar `TRANSPORT=raknet` (e `ONLINE_MODE=false` só no container E2E).
- [ ] (Visual) Comprar o Minecraft no Google Play, se ainda não tiver, e fazer login Google no mcpelauncher.
- [ ] (Visual) Fazer login Microsoft dentro do jogo.
- [ ] (Visual) Autorizar o app no Gatekeeper e conceder Gravação de Tela e Acessibilidade ao processo de automação.
- [ ] (Plano B) Comprar Parallels ou instalar o VMware Fusion, a licença do Windows 11 ARM e o Minecraft for Windows;
      ou comprar um aparelho Android.
- [ ] Autorizar qualquer download (DMG de ~307 MB, SDK Android, npm `bedrock-protocol`).

---

## Fontes

- mcpelauncher: [macos-builder v1.8.5](https://github.com/minecraft-linux/macos-builder/releases/tag/v1.8.5) ·
  [osx-packaging-scripts releases](https://github.com/ChristopherHX/osx-packaging-scripts/releases) ·
  [#2030 pthread_sigmask macOS arm64](https://github.com/minecraft-linux/mcpelauncher-manifest/issues/2030) ·
  [#2034 digitação / mod updates](https://github.com/minecraft-linux/mcpelauncher-manifest/issues/2034) ·
  [#2023 UI M3](https://github.com/minecraft-linux/mcpelauncher-manifest/issues/2023) ·
  [#2037 crash 1.26.51.1](https://github.com/minecraft-linux/mcpelauncher-manifest/issues/2037) ·
  [#2006 status Apple Silicon](https://github.com/minecraft-linux/mcpelauncher-manifest/issues/2006) ·
  [#2007 PlayFab crash](https://github.com/minecraft-linux/mcpelauncher-manifest/issues/2007) ·
  [docs Getting started](https://mcpelauncher.readthedocs.io/en/latest/getting_started/)
- Fork com socket de agente: [bedrock-mc/mcpelauncher-manifest client-v0.1.0](https://github.com/bedrock-mc/mcpelauncher-manifest/releases/tag/client-v0.1.0) ·
  [bedrock-mc/mcpelauncher-agent](https://github.com/bedrock-mc/mcpelauncher-agent)
- Protocolo: [Mojang bedrock-protocol-docs v1.26.50 (2193)](https://github.com/Mojang/bedrock-protocol-docs/releases/tag/v1.26.50) ·
  [Minecraft Wiki 26.51](https://minecraft.wiki/w/Bedrock_Edition_26.51) ·
  [bedrock-protocol](https://github.com/PrismarineJS/bedrock-protocol) ([HISTORY](https://github.com/PrismarineJS/bedrock-protocol/blob/master/HISTORY.md), [API](https://github.com/PrismarineJS/bedrock-protocol/blob/master/docs/API.md), [npm](https://www.npmjs.com/package/bedrock-protocol)) ·
  [minecraft-data proto.yml](https://github.com/PrismarineJS/minecraft-data/blob/master/data/bedrock/latest/proto.yml) ·
  [gophertunnel](https://github.com/Sandertv/gophertunnel) · [PR #520 (1.26.50)](https://github.com/Sandertv/gophertunnel/pull/520) ·
  [Endstone releases](https://github.com/EndstoneMC/endstone/releases) ·
  [SimulatedPlayer](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server-gametest/simulatedplayer)
- NetherNet/BDS: [itzg PR #675](https://github.com/itzg/docker-minecraft-bedrock-server/pull/675) ·
  [playit.gg: NetherNet → RakNet](https://playit.gg/support/minecraft-bedrock-nethernet/) ·
  [BDS server.properties](https://learn.microsoft.com/en-us/minecraft/creator/documents/bedrockserver/server-properties?view=minecraft-bedrock-stable)
- Emulador/GPU: [Emulator release notes](https://developer.android.com/studio/releases/emulator) ·
  [ANGLE: ES 3.2 no Apple Silicon](https://groups.google.com/g/angleproject/c/SYW2nmvaZgU) ·
  [RenderDragon](https://minecraft.wiki/w/RenderDragon)
- Windows ARM: [Feedback: Bedrock para Windows on ARM](https://feedback.minecraft.net/hc/en-us/community/posts/35438022809741-Add-windows-arm64-support-for-bedrock-edition) ·
  [Parallels KB 129497 (limitações)](https://kb.parallels.com/en/129497) · [Parallels preços](https://www.parallels.com/products/desktop/buy/) ·
  [prlctl capture](https://docs.parallels.com/parallels-desktop-developers-guide/command-line-interface-utility/manage-virtual-machines-from-cli/general-virtual-machine-management/capture-a-screen-area) ·
  [prlctl send-key-event](https://docs.parallels.com/parallels-desktop-developers-guide/command-line-interface-utility/manage-virtual-machines-from-cli/general-virtual-machine-management/send-a-keyboard-event-to-a-virtual-machine) ·
  [VMware Fusion 3D DX11 no ARM](https://www.techspot.com/news/99418-vmware-fusion-can-now-use-full-3d-acceleration.html) ·
  [MacBedrock (UTM, experimental)](https://github.com/jabreeflor/MacBedrock)
- iPad no Mac: [Feedback: marcar Minecraft iPad como disponível no Mac](https://feedback.minecraft.net/hc/en-us/community/posts/40685280553997-Mark-Minecraft-for-iPad-on-App-Store-Connect-as-available-on-Mac) ·
  [Apple: apps de iPhone/iPad no Mac](https://support.apple.com/guide/app-store/iphone-ipad-apps-mac-apple-silicon-fird2c7092da/3.0/mac/15.0)
