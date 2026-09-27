# Pesquisa 1 — Interface (HUD, telas, 3D na UI, glifos, conquistas, câmera)

> Data: 2026-09-26. Alvo: Bedrock 26.x com `@minecraft/server` 2.10.0 e `@minecraft/server-ui` 2.2.0 **estáveis**,
> sem Beta APIs nem toggles experimentais, para rodar em Realms e consoles (Xbox, PlayStation, Switch).
> Evidência primária: arquivos `resource_pack/ui/*.json` do `Mojang/bedrock-samples` na tag **v1.26.50.4**
> (comparados com **v1.26.60.28-preview**), `node_modules/@minecraft/*/index.d.ts` do repo, Microsoft Learn,
> wiki.bedrock.dev e packs/bibliotecas públicos citados em cada seção (lista completa no fim).
> Protótipos descartáveis (não testados em jogo) em
> `/private/tmp/claude-502/-Users-edupereira-Projetos-Cobblemon-Bedrock/275d0c5f-c0ac-47f2-b984-775e3fe07697/scratchpad/pesquisa-ui/prototipo/`.

## 0. Resumo executivo

| # | Tema | Viável em estável/Realms/console? | Caminho |
|---|------|------------------------------------|---------|
| 1 | HUD persistente (party à esquerda, HUD de batalha com barras, overlays de captura/evolução) | **SIM** | `ui/hud_screen.json` (ainda JSON UI em 26.50 e em 26.60-preview) + protocolo de dados no **título** (`#hud_title_text_string`) com padrão "preserve title" + fatias de largura fixa |
| 2 | Telas no visual do Cobblemon (batalha, summary, PC 6×5, starter, Pokédex) | **SIM** | `ActionFormData` roteado por marcador no título em `ui/server_form.json`; botões carregam dados (texto com marcadores `§` invisíveis + ícone); barras por `#size_binding_x` |
| 2b | Reskin do DDUI (`CustomForm`/`MessageBox`) | **NÃO** | DDUI é desenhado em Ore UI, sem arquivo JSON UI; também não mostra glifos. Usar só em telas utilitárias (config, editores) |
| 3 | Modelo 3D vivo dentro de tela JSON UI | **NÃO direto** (nenhum renderer vinculável a entidade arbitrária em forms) · **SIM** pelo "estúdio de câmera" · **ARRISCADO** pelo retrato de NPC | ver §3 |
| 4 | Glifos (ícones inline em chat, actionbar, títulos, forms) | **SIM** (JSON UI, qualquer plataforma) · **NÃO** em Ore UI/DDUI | mover da página `E0` (hoje sobrescreve a vanilla) para `glyph_E2.png`+ |
| 5 | Toasts / tela de conquistas | API de toast: **NÃO** · tela de conquistas vanilla: **NÃO** (Ore UI) · toast custom no HUD e tela de "advancements" custom: **SIM** | canal próprio no HUD + form com layout de árvore |
| 6 | Zoom do scanner da Pokédex, overlay, câmera de batalha, fade de evolução | **SIM** | `player.camera.setFov/fade/setCamera/playAnimation/addShake` (todos estáveis em 2.10) + overlay no HUD |

Ponto-chave: nada disto é "impossível". O que o Bedrock não tem é UI desenhada por script. A solução é mandar
**dados** do script (título, subtítulo, actionbar, botões de form) e deixar o **resource pack** desenhar.
Toda a lógica de desenho fica em JSON gerado por ferramenta, e o script só serializa estado.

Risco estrutural: JSON UI está marcado como "a ser removido no futuro" em favor de Ore UI
(wiki.bedrock.dev e minecraft.wiki). Em 26.50/26.60-preview, **HUD, `server_form.json`, `npc_interact_screen.json` e
`toast_screen.json` continuam sendo JSON UI** (diff `v1.26.50.4..v1.26.60.28-preview` só adiciona hotbar/editor
em `hud_screen.json` e muda `custom_multiselect` em `server_form.json`). A tela de conquistas e as de
configurações/mundo já são Ore UI. Recomendação: um check de CI que compara esses arquivos a cada tag nova do
`bedrock-samples` (§7, item P0-4) e fallbacks textuais que continuam funcionando sem o RP.

---
## 1. HUD persistente (party overlay, HUD de batalha, overlays)

### 1.1 `hud_screen.json` ainda vale em 26.x?

**SIM.** Evidências:

- `bedrock-samples` v1.26.50.4: `resource_pack/ui/hud_screen.json` (4.108 linhas) com `root_panel` (linha 3148) e as
  fábricas `hud_actionbar_text_factory` (3406) e `hud_title_text_factory` (3417); os bindings globais
  `#hud_title_text_string` (2314) e `#hud_subtitle_text_string` (2383) seguem ali.
- v1.26.60.28-preview: o arquivo continua JSON UI; o diff só troca a grade da hotbar por `hotbar_slots_renderer`
  e adiciona bindings `#editor_chat_*`. Nada do HUD migrou para Ore UI.
- A lista de telas convertidas para Ore UI (minecraft.wiki, "Ore UI") não inclui HUD, chat, inventário, forms de
  servidor nem diálogo de NPC. A tela de **Conquistas** é Ore UI desde 1.16.100.
- O próprio repo já depende disso: `ui/server_form.json`, `ui/pc.json`, `ui/battle.json`.

Realms e consoles: o RP é baixado pelo cliente (em Realms o pack do mundo é obrigatório para entrar; em BDS use
`texturepack-required=true`). JSON UI é o mesmo em Win/Android/iOS/Xbox/PS/Switch; as diferenças são perfil de
tela (`$pocket_edition`, `$is_console`, telas `*_pocket`) e safe zone. O HUD é único para todos os perfis.

### 1.2 Canais de dados do script para o HUD

| Canal (script) | Chega no JSON UI como | Característica | Uso recomendado |
|---|---|---|---|
| `onScreenDisplay.setTitle(title, …)` | binding global `#hud_title_text_string` | por jogador; persiste até o próximo título; pode ser "preservado" | **estado contínuo**: party, HUD de batalha, scanner |
| `setTitle(…, { subtitle })` / `updateSubtitle` | `#hud_subtitle_text_string` | chega junto com o título, no mesmo pacote | textos **localizados** de tamanho variável (nomes/apelidos) |
| `setActionBar(msg)` | variável `$actionbar_text`, só dentro de controles criados pela fábrica `hud_actionbar_text_factory` | o controle é recriado a cada mensagem, então animações reiniciam; some em ~3 s | **eventos**: toasts, "capturado!", "evoluindo" |
| `setHudVisibility` / `hideAllExcept` (estável) | esconde elementos vanilla (`Hotbar`, `Health`, `Hunger`, `StatusEffects`, `PaperDoll`…) | por jogador | limpar a tela na batalha e no scanner |

Precedentes reais: o RP público do PokeBedrock (`Kimtroll1/pokebedrock-res`, `ui/hud_screen.json`) desenha a
barra lateral do time a partir do **actionbar** com prefixo `sidebar:` e campos de 61 bytes fatiados com
`'%.Ns'`, e usa o título para a tela "aguardando batalha". O exemplo `rpg_hud.json` (repo
`boredape874/mcbejsonuimasterAI`) faz barras de HP/mana/XP pelo título com o padrão "preserve".

### 1.3 Receita exata (protocolo "CBUI v1")

**(a) Receptor preservado por canal.** Padrão da wiki (`json-ui/preserve-title-texts`): um painel invisível de
tamanho 0 guarda em `property_bag` a última string cujo prefixo é o do canal. `visibility_changed` copia o título
no instante em que o painel "pisca" visível, e outros títulos (vanilla, outros add-ons, outros canais) não o
alteram:

```json
"party_data": {
  "type": "panel", "size": [0, 0],
  "property_bag": { "#preserved": "" },
  "bindings": [
    { "binding_name": "#hud_title_text_string" },
    { "binding_name": "#hud_title_text_string", "binding_name_override": "#preserved",
      "binding_condition": "visibility_changed" },
    { "binding_type": "view",
      "source_property_name": "(not (#hud_title_text_string = #preserved) and not ((#hud_title_text_string - 'cbP1') = #hud_title_text_string))",
      "target_property_name": "#visible" },
    { "binding_type": "view", "source_property_name": "(#preserved - 'cbP1')", "target_property_name": "#body" }
  ]
}
```

Um receptor por canal (`cbP1` party, `cbB1` batalha, `cbS1` scanner, `cbE1` evolução/captura). Todos leem o
mesmo título, e cada um só "aceita" o próprio prefixo, então o HUD inteiro sobrevive a títulos alheios.

**(b) Esconder o título vanilla quando o payload é nosso.** Precisa ser um `ui/hud_screen.json` no **mesmo
caminho** do vanilla, porque `modifications` são resolvidas por caminho de arquivo, não por namespace (medido
em `bedrock-core/ui`, `docs/spikes/jsonui-container-facts.md`):

```json
{
  "namespace": "hud",
  "root_panel": { "modifications": [ { "array_name": "controls", "operation": "insert_front",
      "value": [ { "cobblemon_hud@cobblemon_hud.root": {} } ] } ] },
  "hud_title_text/title_frame/title": { "modifications": [ { "array_name": "bindings", "operation": "insert_back",
      "value": [ { "binding_type": "view",
        "source_property_name": "(((#text - 'cbP1') - 'cbB1' - 'cbS1' - 'cbE1') = #text)",
        "target_property_name": "#visible" } ] } ] }
}
```

(O fundo `title_background` fica com alpha animado, então esconda também `hud_title_text/title_frame` ou use
`fadeIn/stay/fadeOut = 0/1/0`. Faça o mesmo em `subtitle_frame` quando usar o subtítulo.)

**(c) Campos de largura fixa (fatiar a string).** Operadores de formatação em bindings (wiki `json-ui-intro`,
seção "String Formatting"): `('%.Ns' * X)` devolve os **N primeiros bytes** de `X`. A largura é em **bytes UTF-8**
(ASCII = 1, `§` e acentos latinos = 2, glifos e emojis = 3). O script completa cada campo com `\t`, que o JSON UI
remove com `- '\t'`. Para o campo no offset `O` com tamanho `L`, use dois passos (mais robusto que aninhar tudo
numa expressão só):

```json
{ "binding_type": "view", "source_control_name": "party_data", "source_property_name": "#body", "target_property_name": "#b" },
{ "binding_type": "view", "source_property_name": "(#b - ('%.24s' * #b))",  "target_property_name": "#r_lvl" },
{ "binding_type": "view", "source_property_name": "(('%.3s' * #r_lvl) - '\t')", "target_property_name": "#lvl" }
```

Isso é inequívoco porque o prefixo removido começa com o cabeçalho único do canal: a subtração de strings remove
ocorrências da substring, e um prefixo que contém `cbP1` só pode casar na posição 0. Evite separadores (`a/b/c`)
com subtração: a própria comunidade relata que valores iguais, numéricos puros e mais de 3 campos quebram esse
método. Largura fixa é o padrão recomendado.

**(d) Números.** Medições de 2026-09 (`bedrock-core/ui`, `docs/spikes/S12-live-layout.md` e
`jsonui-container-facts.md`):
- converter string numérica: **`(#v - 0)`**. Nesses testes `(#v * 1)` e `(1 * #v)` deram 0, embora a wiki cite
  `* 1`. Use `- 0`;
- a aritmética sobre valores vindos de string é **inteira**, então não dá para calcular `0.37`. `>=` não existe
  (use `>`/`<`/`=`), `%` não é operador, e `('' + #x)` ou divisão de string por número **derrubaram o cliente**;
- um binding `view` cuja expressão não lê nenhuma `#propriedade` invalida **todos** os bindings do controle.
  Constante se escreve `((#v = #v) * 40)`;
- label não renderiza número cru: concatene com string (`('Lv. ' + #lvl)`, e `#lvl` já é string).

**(e) Barras (HP, EXP, PP, captura).** Três opções, em ordem de robustez:
1. **`#size_binding_x`/`#size_binding_y` com largura inteira em pixels** (medido como funcionando em controles
   estáticos e em células de `form_buttons`, S12). O script manda `hpw = round(hp/max*32)` como `"00".."32"`. A
   barra fica dentro de um painel `[1, 1]`, porque as unidades são múltiplos do pai, e os **dois eixos** precisam de
   binding:
   ```json
   "hp_frame": { "type": "panel", "size": [1, 1], "anchor_from": "top_left", "anchor_to": "top_left", "offset": [27, 22],
     "controls": [ { "hp_bar": { "type": "image", "anchor_from": "top_left", "anchor_to": "top_left",
       "texture": "textures/ui/cobblemon/hud/hp_g",
       "bindings": [
         { "binding_type": "view", "source_control_name": "slot0", "source_property_name": "(#hpw - 0)", "target_property_name": "#size_binding_x" },
         { "binding_type": "view", "source_control_name": "slot0", "source_property_name": "((#hpw = #hpw) * 3)", "target_property_name": "#size_binding_y" },
         { "binding_type": "view", "source_control_name": "slot0", "source_property_name": "('textures/ui/cobblemon/hud/hp_' + #hpc)", "target_property_name": "#texture" } ] } } ] }
   ```
   Para a barra **vertical** da party do Cobblemon (`PartyOverlay.kt`: 2 px de largura, altura = razão), inverta
   os eixos e ancore em `bottom_left`.
2. **`#clip_ratio`** com `clip_direction` (`left`/`down`…), como fazem a fornalha vanilla (32 usos de
   `#clip_ratio` nos arquivos 26.50) e o `animated_bar.json` da comunidade, que usa `"$one": 1.0` e
   `($one - #v * #multiplier)`. Funciona com bindings float nativos. Com número vindo de string, a divisão
   inteira medida em S12 torna o resultado incerto: **validar em jogo antes de adotar**.
3. **Textura por passo** (`hp_00.png … hp_32.png`, 33 arquivos minúsculos) escolhida por `#texture`. Custo zero de
   aritmética; é o fallback à prova de balas.

**(f) Imagens escolhidas por texto.** `#texture` aceita string construída: `('textures/sprites/' + #key)`. A cor do
tipo, a bola e o ícone de status saem de conjuntos fechados de texturas (`status_brn`, `type_fire`, `poke_ball`…).
Não existe binding de `uv`, então **atlas não é endereçável em runtime**: um arquivo por imagem.

**(g) Script: fila por jogador e 1 título por tick.** Se dois `setTitle` chegam no mesmo frame, o cliente só vê o
último. Consolide tudo num `HudBus` (protótipo em `prototipo/HudBus.ts`):
- junta party, batalha e scanner num único envio por tick, com prioridade para batalha;
- `fadeInDuration: 0, stayDuration: 1, fadeOutDuration: 0`;
- só reenvia quando o payload muda (hoje `PartyHud.ts` já cacheia por JSON do time);
- use `TextEncoder` para medir bytes e cortar sem partir caractere multibyte.

**(h) Localização.** O título chega ao JSON UI já traduzido pelo cliente, então o tamanho em bytes de um nome
traduzido é imprevisível. Duas regras:
- campos de **largura fixa só com ASCII controlado** (chave do sprite, números, códigos de 1 letra);
- **nomes/apelidos no subtítulo**, um por linha (`\n`), num único label com `line_padding` ajustado para que altura da
  linha + `line_padding` = passo do slot (30 px na party). O subtítulo aceita `RawMessage` com `translate`, então a espécie é traduzida no cliente. Se um
  dia precisar de largura fixa com texto traduzido, `player.clientSystemInfo.locale` é **estável** e dá para
  resolver o `.lang` no servidor, mas a própria doc desaconselha isso para servidores multilíngues.

Gerador de exemplo: `prototipo/gen-hud.mjs` gera `RP/ui/cobblemon_hud.json` (6 slots, 8 campos cada) e o
`hud_screen.json` de modificação. O JSON sai válido, mas **não foi testado em jogo**. Ele gera expressões
**literais** porque `$variáveis` dentro de `source_property_name` falham em subárvores inseridas por
`modifications` ("Must define a source property name in the binding!", medido em `bedrock-core`). O pack
comunitário `rpg_hud` usa variáveis nesse ponto; as evidências conflitam, e o gerador elimina o problema.

### 1.4 O que desenhar em cada overlay

| Overlay Cobblemon | Canal | Campos (bytes) | Texturas (do upstream `assets/cobblemon/textures/gui/…`) |
|---|---|---|---|
| Party (`PartyOverlay.kt`: slot 62×30, retrato ⌀21, escala 0,5) | título `cbP1` + subtítulo (nomes) | por slot: chave 24, nível 3, hp px 2, cor 1, status 1, gênero 1, selecionado 1, desmaiado 1, EXP px 2 | `party/party_slot*.png`, `party_slot_portrait_background`, `party_gender_*`, `party/status_*` |
| HUD de batalha (`BattleOverlay.kt`) | título `cbB1` | por lado/posição (até 3×2): chave, nível, hp px, hp atual/máx (texto só do aliado), status, gênero, "capturado" (bola) | `battle/battle_info_base*.png`, `battle_info_underlay*`, `battle_status_*`, `battle_owned_indicator` |
| Captura (balanço da bola, 1–3 + resultado) | actionbar `cbC` (evento) | estágio 1, bola 16 | `gui/ball/*.png` |
| Evolução / level up / novo golpe | actionbar `cbE` | tipo 1 + texto | `party_slot_notification_*` |
| Scanner da Pokédex | título `cbS1` | alvo 24, progresso px 2, estado 1 | `pokedex/scan/*` (21 arquivos) |

Na batalha, o `third_party_server_screen` do repo já usa `force_render_below` para títulos "Battle:", então o HUD e o
mundo ficam visíveis **atrás** do menu de golpes, como no Cobblemon.

### 1.5 Desempenho e compatibilidade

- Bindings e expressões são reavaliados a cada frame e são o principal custo do JSON UI (wiki `best-practices`,
  "Maximizing Performance"). Use `"ignored": true` para eliminar controles fora de uso (`visible:false` continua
  avaliando), fatie cada campo **uma vez** no slot e deixe os filhos só lerem propriedades prontas, e mantenha a
  party em ~6×10 bindings.
- Rede: um título de ~220 bytes por mudança de estado é desprezível. Não reenvie a cada tick sem mudança.
- Consoles: sem diferença funcional. Respeite a safe zone (ancore em `left_middle` com offset e teste o slider
  "Safe area" do Xbox) e evite fontes pequenas demais (`font_scale_factor` ≥ 0,5 fica legível no Switch portátil).
- Realms: RP obrigatório, funciona. Sem RP, o jogador veria o payload como título. O fallback é a opção
  `partyHudEnabled` já existente e o modo actionbar textual atual (`PartyHud.ts`).

### 1.6 Armadilhas conhecidas

1. `modifications` de `hud_screen.json` só valem num arquivo **com esse caminho**. Definições novas ficam em
   namespace próprio (`ui/cobblemon_hud.json`, registrado em `_ui_defs.json`).
2. Não dê `remove` em filhos herdados: um `remove` inválido derrubou silenciosamente o arquivo inteiro (medido em
   `bedrock-core`). Esconda por binding.
3. `source_control_name` procura por **nome** no ecrã, então use nomes únicos (`cbhud_slot0`…) para não colidir com
   vanilla ou outros add-ons.
4. `#visible` default é `true`: uma expressão inválida **mostra** o controle. Toda expressão nova precisa de teste
   visual.
5. Outro add-on que também sobrescreve `hud_title_text` pode brigar. O padrão "preserve" isola os dados; só o
   esconder-título precisa ser aditivo (`insert_back`, nunca redefinição).
6. O label vanilla do actionbar tem `enable_profanity_filter: true`. Os labels próprios não devem ter isso, e os
   payloads devem ser códigos, não palavras.
7. Chat aberto cancela forms e tapa parte do HUD, o que é normal.

---
## 2. Server forms com layout do Cobblemon (JSON UI) e DDUI

### 2.1 Estado atual do repo e dois bugs de roteamento

- `resource_packs/CobblemonBedrock/ui/server_form.json` **redeclara** `main_screen_content` e
  `third_party_server_screen` inteiros. Qualquer outro add-on que customize forms briga com este, e vice-versa.
  O padrão compatível (wiki `json-ui/modifying-server-forms`) usa `modifications` com `insert_back` de uma
  **segunda** fábrica chamada `server_form_factory` num painel próprio e esconde `long_form`/`custom_form` por
  binding quando o título tem o marcador.
- O roteamento é por **substring visível**: `(#title_text - 'PC')` e `(#title_text - 'Battle:')`. Qualquer título
  que contenha "PC" cai na grade do PC: um jogador chamado "PCgamer" (`scripts/main.ts:91`,
  `trade/PlayerInteraction.ts:13` usam `target.name` como título), uma caixa renomeada, um nome de NPC ou uma
  tradução qualquer. **Correção:** use um marcador invisível de códigos de cor no início do título, como o PokeBedrock
  (`"§p§o§k§e"`, `"§b§a§t§l§e"`). Recomendo só códigos de cor válidos terminados em `§r`, por exemplo
  `§0§1§r` = PC, `§0§2§r` = batalha, `§0§3§r` = summary, `§0§4§r` = starter, `§0§5§r` = Pokédex,
  `§0§6§r` = conquistas. Um helper `withScreen(marker, title)` monta `{ rawtext: [{ text: marker }, title] }`.
  O JSON UI compara `((#title_text - '§0§1§r') = #title_text)`; o texto exibido continua limpo, porque códigos de
  cor não aparecem.

### 2.2 O que um form de servidor consegue fazer (medido em 2026-08/09)

Base: `ActionFormData` gera a coleção `form_buttons` com `#form_button_text`, `#form_button_texture` e
`#form_button_texture_file_system` por botão, `#form_button_length` e, no nível do form, `#title_text` e
`#form_text` (corpo).

1. **Botão = portador de dados.** O texto do botão leva um marcador de "tipo de célula" + campos ASCII de largura
   fixa + (no fim) texto localizado. O ícone (`button(text, iconPath)`) leva o sprite. Exemplo de tile de golpe:
   `rawtext: [{ text: "§0§a§r" + "fi" + "15" + "35" + "2" + "S" }, { translate: "cobblemon.move.ember" }]`, que dá tipo, PP atual,
   PP máx, efetividade e categoria, e o **resto** é o nome (`(#t - ('%.13s' * #t))`; o prefixo contém o marcador
   único).
   O PokeBedrock (`ui/pokemon/attack.json`) faz exatamente isso com `'§m§y§b§a§r'`, `'§0§0§1'`… no texto do botão.
2. **Layout livre por célula.** Nas células criadas pela fábrica `form_buttons` do engine, `#size_binding_x/y` **e**
   `#anchored_offset_value_x/y` funcionam por binding (S12 do `bedrock-core/ui`). Cada "botão" pode carregar
   `x,y,w,h` e ser desenhado em qualquer lugar da tela. Assim uma única fábrica monta summary, PC com party +
   caixa, Pokédex etc. Elementos só de exibição (barras, labels, retratos) são células **sem** controle `button`.
3. **Cliques.** Todo controle que deve reportar clique precisa do próprio binding
   `{ "binding_type": "collection_details", "binding_collection_name": "form_buttons" }`. Sem ele, o clique fecha o
   form e chega como `canceled`, idêntico a Esc (S1, medido). O `pc.json` atual já faz certo.
4. **Grades.** `grid` + `grid_item_template` + `#maximum_grid_items ← #form_button_length` (como `pc.json`). Grades
   têm tamanho padrão `100%c`; não use `grid_rescaling_type: "vertical"` (a wiki avisa que pode crashar).
5. **Barras e cores.** Mesmo esquema do HUD: `#size_binding_x` inteiro em px, ou textura por passo. Cor de tipo via
   `#texture` = `('textures/ui/cobblemon/type/tile_' + #type)` (18 texturas). Existe binding `#color` em vanilla
   (53 usos), mas frações não são calculáveis a partir de string: use texturas pré-coloridas.
6. **Custo.** Forms "interpretados" (layout calculado no script e serializado a cada abertura) custaram
   **14 ms com 50 células e 53 ms com 200** de servidor por abertura (S5). Com layout compilado no pack e só
   valores no form, esse custo some. É mais um motivo para gerar o JSON UI por ferramenta e mandar só dados.
7. Forms são modais: o chat aberto cancela o form (`UserBusy`), e entre fechar e abrir outro form DDUI é preciso
   esperar 1 tick (known issue de 26.10). Os fluxos de retry de `DialogueManager`/`Battle.ts` já tratam isso.

### 2.3 Receitas por tela

| Tela Cobblemon | Montagem no Bedrock | Texturas upstream (`assets/cobblemon/textures/gui/`) |
|---|---|---|
| **Batalha**: menu Lutar/Mochila/Pokémon/Fugir; tiles de golpe coloridos por tipo com PP e efetividade; troca; alvo em duplas | 1 form por submenu (como hoje), marcador `§0§2§r`. Menu = 4 células com `battle_menu_*.png`. Golpes = grade 2×2 de células `battle_move.png` tingidas por textura de tipo + ícone de categoria (glifo ou imagem) + PP como texto + seta de efetividade. `force_render_below` mantém o mundo e o HUD de batalha visíveis. | `battle/battle_move*.png`, `battle_menu_*.png`, `party_select*.png`, `target_select.png`, `battle_back.png` |
| **Summary** (retrato, info, stats, golpes, marcas) | Form "layout livre" (2.2.2): retrato 2D **ou** janela transparente para o estúdio 3D (§3.2), abas como botões, barras de stats/EV/IV por `size_binding`, golpes como células `summary_move.png`. Trocar de aba reabre o form na hora (sem esperar tick com `ActionFormData`). | `summary/summary_base.png`, `summary_info_base.png`, `summary_move*.png`, `icon_*`, `portrait_background.png` |
| **PC** 6×5 + party + prévia | Já existe grade 6×5 com wallpaper. Faltam a coluna da party (6 células à esquerda por offset ancorado), a prévia do selecionado (sprite + nível + tipos) e as setas de caixa com `pc/*.png`. Tudo na mesma fábrica, com posição por célula. | `pc/*.png`, `pc/wallpaper/**` (já importado) |
| **Starter** (carrossel por categoria, plataforma, "Escolher") | Botões ◀ ▶ + Escolher + abas de categoria. O centro fica transparente para o **estúdio 3D** (modelo animado real sobre a plataforma) ou mostra o sprite grande + `starter_platform_base_<tipo>.png`. | `starterselection/*.png` (30 arquivos) |
| **Pokédex** (lista + painel de info + formas + busca) | Lista = grade de células (sprite 32 px + número + ícone capturado/visto) paginada. Painel = campos no corpo (`#form_text`) com largura fixa. Busca via `ModalFormData.textField` (já existe em `PokedexUI.ts`). | `pokedex/*.png` (103), `pokedex/variation/*` |
| Troca, pasto, máquina de TM, panela, NPC editor | Layout livre com as texturas correspondentes. Para a troca "ao vivo", ver DDUI abaixo. | `trade/`, `pasture/`, `tmmachine/`, `campfirepot/`, `npc/` |

Observação: o import atual só trouxe `gui/pc/wallpaper`. Faltam **~786 PNGs** de GUI do Cobblemon (3,4 MB) em
`upstream/cobblemon/common/src/main/resources/assets/cobblemon/textures/gui/`. É trabalho do importador (§7).

### 2.4 DDUI (`CustomForm`, `MessageBox`, `Observable*`) em `@minecraft/server-ui` 2.2.0

Lido de `node_modules/@minecraft/server-ui/index.d.ts` (2.2.0 estável):
- `new CustomForm(player, title)` com `.button(label, onClick, {disabled, tooltip, visible})`, `.closeButton()`,
  `.divider()`, `.dropdown(label, ObservableNumber, items)`, `.header()`, `.label()`, `.slider(label, obs, min, max, {step})`,
  `.spacer()`, `.textField(label, ObservableString)`, `.toggle(label, ObservableBoolean)`,
  **`.image(src, pack, {onClick, tooltip, visible, width})`** (estável desde 26.50), `.show(): Promise<DataDrivenScreenClosedReason>`,
  `.close()`, `.isShowing()`;
- `MessageBox`, `ObservableBoolean/Number/String/UIRawMessage` (`subscribe`, `setData`, `{clientWritable}`);
- `uiManager.closeAllForms(player)`.

Não existe no estável: `multiButtonRow` (beta), grade, posicionamento livre, scroll horizontal, cores e
fundos.

Aparência: DDUI é um invólucro de **Ore UI** para scripts, e não há arquivo JSON UI dele no `bedrock-samples`
26.50. Ore UI "não pode ser modificado por resource packs" (wiki `json-ui-intro`) e **não renderiza emojis/glifos
custom** (wiki `text/custom-emojis`: "Emojis are not supported by Ore UI screens"). **Conclusão: DDUI não pode ser
reskinado para o visual do Cobblemon.** A vantagem real é a **atualização ao vivo** (Observables), sem fechar
e reabrir o form.

Uso recomendado no port:
- **DDUI:** `ConfigEditor.ts`, `NPCEditor.ts`, `PokemonEdit.ts` (telas de admin/utilitárias) e o diálogo de
  confirmação da troca, onde o estado do outro jogador muda enquanto a tela está aberta.
- **JSON UI + ActionFormData:** tudo o que o jogador vê como "tela do Cobblemon" (batalha, summary, PC, starter,
  Pokédex, party).
- Para "ao vivo" com visual Cobblemon: feche com `uiManager.closeAllForms` e reabra o `ActionFormData` com o
  estado novo no mesmo tick (`ActionFormData` não tem o atraso de 1 tick do DDUI; a correção de 26.30 permitiu
  abrir `ModalFormData`/`MessageFormData` logo após DDUI). A tela pisca, mas continua fiel ao visual.

---
## 3. Modelos 3D dentro da UI

### 3.1 Inventário dos renderers `custom` em 26.50

Contagem nos arquivos de `bedrock-samples` v1.26.50.4 (`"type": "custom", "renderer": …`):

| Renderer | O que desenha | Dá para apontar para uma entidade arbitrária em form de servidor? |
|---|---|---|
| `paper_doll_renderer` (13 usos), `live_player_renderer`, `hud_player_renderer` | o **jogador local** (skin) | Não |
| `live_horse_renderer` | a entidade da tela de cavalo (`#entity_id`, só em `horse_screen*.json`) | Não. A tela só abre quando o jogador interage com uma montaria de inventário tipo cavalo, e o script não abre containers |
| `actor_portrait_renderer` | o **NPC** do diálogo (`npc_interact_screen.json`, controle `skin_model`) | **Indireto**: a tela é aberta por `/dialogue open <npc> <player> [cena]`, o que dá para rodar pelo script via `runCommand` (§3.3) |
| `3d_structure_renderer`, `equipment_preview_renderer`, `inventory_item_renderer`, `banner_pattern_renderer` | estrutura / armadura / item / estandarte | Não serve para Pokémon |

**Conclusão:** não existe renderer de entidade vinculável a `ActionFormData`/HUD. Há duas saídas estáveis
para mostrar o **modelo real animado** do Pokémon, mais o fallback 2D.

### 3.2 Solução A (recomendada, **SIM**): "estúdio de câmera" + form transparente

Em vez de desenhar a entidade **na** UI, a UI fica por cima da **câmera** apontada para a entidade. Só APIs estáveis
de 2.10:

1. Spawne a espécie (`cobblemon:<espécie>`) num "estúdio" na coluna de chunks do próprio jogador (carregada), alto,
   ex.: `y = min(dimension.heightRange.max - 8, player.y + 64)`, para outros jogadores não verem. Na
   entidade, uma propriedade `cobblemon:ui_display` (bool) + um component group que tira IA, gravidade, dano,
   colisão, nameplate e despawn. O modelo, as texturas, a forma, o shiny e as animações de idle são os mesmos do
   mundo, então a fidelidade ao Cobblemon é total.
2. `player.camera.fade({ fadeTime: { fadeInTime: .15, holdTime: .1, fadeOutTime: .15 } })` para esconder o corte.
3. `player.camera.setCamera("minecraft:free", { location: stagePos + offset, facingLocation: stagePos + centro, easeOptions })`.
   Para girar o modelo: `entity.setRotation` a cada tick, ou `camera.playAnimation(CatmullRomSpline, …)` orbitando
   (estável desde 2.6.0 / 26.10).
4. Abra o `ActionFormData` com marcador `§0§4§r` (starter) ou `§0§3§r` (summary). O layout JSON UI deixa a região do
   modelo **vazia**. A tela de form já pode renderizar o que está atrás (`force_render_below`, como `battle.json`
   faz hoje). Zere a escurecida global (`$screen_background_alpha` / `screen_background` de `common.base_screen`)
   e deixe cada layout desenhar o próprio painel.
5. À noite ou em caverna, dê `night_vision` sem partículas durante a tela e esconda `HudElement.StatusEffects`, ou use
   material emissivo na variante de estúdio.
6. Ao fechar (`response.canceled` ou escolha): `camera.clear()`, `fade`, `entity.remove()`. Garanta a limpeza também
   em `playerLeave` e `worldLoad` (tag `cobblemon:ui_display`).

Serve para starter (carrossel 3D real), summary, prévia do PC, tela de evolução (duas entidades e troca com
flash/fade, como o Cobblemon) e Pokédex (visualizar forma/shiny). Riscos: jogadores voando alto veem o estúdio (não há
visibilidade por observador para entidades comuns no estável, então aceite ou suba mais o estúdio); no Nether o
estúdio fica acima do teto de bedrock (y≈200, que continua carregado). Custo: 1 entidade por jogador com
tela aberta.

### 3.3 Solução B (**ARRISCADA**, fazer spike): retrato do diálogo de NPC

- `npc_interact_screen.json` (26.50) desenha o NPC com `actor_portrait_renderer` na visão do jogador (`message_model`).
  A doc oficial de `/dialogue` diz que o NPC-alvo "will use that NPC's image inside the dialog's portrait".
- Receita: dar à entidade de exibição o componente `minecraft:npc` (com `npc_data.portrait_offsets`/`skin_list`)
  e rodar `dimension.runCommand("dialogue open @e[tag=ui_<id>] <jogador> cobblemon:summary")`. Os botões da cena rodam
  `/scriptevent cobblemon:ui …`, e o `ScriptEventCommandMessageAfterEvent` chega com `sourceType = NPCDialogue`
  (enum estável em 2.10). `npc_interact_screen.json` é JSON UI, então dá para reskinar por completo.
- Para esconder a entidade no mundo e mostrá-la só no retrato: render controller com
  `query.is_in_ui` ("1.0 if the entity is rendered as part of the UI") controlando visibilidade/escala.
- Incertezas a validar: (i) se `actor_portrait_renderer` desenha geometria e animações de **entidade custom**
  (o esperado, pela doc; não verificado em 26.x); (ii) distância máxima para o diálogo continuar aberto; (iii) texto
  dinâmico: cenas são arquivos estáticos (`rawtext` com `translate`/`score`/`selector`), então dados variáveis teriam
  de vir via `selector` apontando para uma entidade cujo `nameTag` o script define; (iv) em Criativo o NPC abre o
  editor para operadores. Por isso é plano B, e a solução A cobre todos os casos de uso.

### 3.4 Solução C (fallback e base de tudo): sprites 2D pré-renderizados

O que a UI precisa (a renderização offline é tarefa de outro pesquisador):

| Uso | Tamanho exibido (px de UI) | Arquivo recomendado |
|---|---|---|
| HUD party (retrato ⌀21) / seleção de party | 21–24 | mesmo PNG, reduzido pelo JSON UI |
| Grade do PC / lista da Pokédex / ícone de botão | 32 | idem |
| Summary / starter / Pokédex (painel) | 64–96 | idem |

- **Um PNG por forma/variante**, RGBA com fundo transparente, **128×128** (potência de 2, com margem de 4–8 px),
  nome estável `textures/sprites/<espécie>[_<forma>][_shiny].png`. Hoje são 1.025 PNGs de 120×112 (9,3 MB) só da
  forma base.
- **Nada de atlas:** JSON UI não tem binding de `uv`, e `#texture` recebe caminho de arquivo (§1.3f).
- Memória de textura: 128×128×4 = 64 KB descomprimido por sprite. Uma página de PC (30) + party (6) ≈ 2,3 MB, e o
  JSON UI carrega sob demanda (o `pc.json` já trata o estado `'loading'`). O conjunto completo com shiny (~2.600)
  daria ~170 MB se todos ficassem residentes: **nunca pré-carregar**. Isso importa no Switch.
- Retrato "vivo" do Cobblemon (modelo que respira) só pela solução A. Nas listas, o sprite estático é o padrão do
  próprio Cobblemon em telas pequenas.

---
## 4. Fontes de glifos (ícones inline)

**SIM**, em tudo que é JSON UI ou texto do mundo (chat, actionbar, títulos, texto de forms/botões, placas, nomes e lore
de itens, nameplates) e em todas as plataformas. **NÃO** em telas Ore UI, o que inclui o DDUI (wiki
`text/custom-emojis`: "Emojis are not supported by Ore UI screens").

Como funciona (wiki `text/custom-emojis`):
- `RP/font/glyph_XX.png` = grade **16×16** de células. A página `XX` cobre os code points `U+XX00–U+XXFF`, com
  célula `(linha, coluna)` = `U+XX<linha><coluna>` em hexadecimal. Imagem base 256×256 (células de 16 px); dá para
  dobrar para 512×512 (células de 32 px) para mais detalhe. O glifo é **desenhado na altura da linha de texto**, então
  resolução maior só dá nitidez, não tamanho.
- A largura do glifo é calculada pelos pixels não transparentes. Para deslocar ou dar espaçamento, a wiki usa
  pixels com 5–10% de opacidade na lateral.
- Páginas usadas pelo vanilla: **E0** (ícones de controle/teclado) e **E1**. **E2 a F8 estão livres** ("aren't being
  used by vanilla"): 23 páginas × 256 = **5.888 glifos** disponíveis.
- No JSON UI, o fatiamento `'%.Ns'` conta **3 bytes por glifo**.

**Problema no repo:** `resource_packs/CobblemonBedrock/font/glyph_E0.png` (512×512) é uma cópia da página E0 vanilla
com os 18 ícones de tipo e 3 de categoria acrescentados (`U+E090…`, ver `glyph_key.txt`). Ele **substitui** a E0
vanilla. Quando a Mojang atualizar a E0 (ícones novos de controle), o pack esconde as mudanças, e qualquer outro pack
que também customize E0 conflita. **Correção:** mova os ícones para `font/glyph_E2.png` (página só nossa), apague o
override de E0 e atualize `glyph_key.txt` e as tabelas em `scripts/language/index.ts` (`typeSymbols`,
`moveCategorySymbols`) e em `scripts/GUI/Battle.ts` (`categorySymbols`).

Mapa sugerido de páginas:

| Página | Conteúdo | Origem das imagens |
|---|---|---|
| E2 | 18 tipos (ícone), 18 tipos (etiqueta pequena), 3 categorias, 7 status (BRN/PAR/SLP/FRZ/PSN/TOX/FNT), gênero ♂/♀, shiny ★, "capturado", Poké Ball | `gui/summary/*`, `gui/battle/battle_status_*`, `gui/party/status_*`, `gui/pokedex/caught_icon*` |
| E3 | 48 bolas (`gui/ball/*.png`), marcas (`summary/icon_marking_*`), tamanhos (`icon_size_*`), montaria (`icon_ride_*`) | idem |
| E4–E8 (opcional) | Mini-retratos 16×16 dos 1.025 Pokémon (4,1 páginas) para chat, lore e listas de texto | sprites reduzidos (§3.4) |

Os mini-retratos são opcionais: na altura de uma linha (~9 px) ficam pequenos, mas servem para mensagens de chat
("Pikachu selvagem apareceu") e para o fallback textual do HUD. Gere as páginas por script no importador (PNG
512×512, célula de 32 px) e exporte um `glyphs.ts` com `codePoint` por chave, para nada ficar escrito à mão.

---

## 5. Conquistas (advancements) e toasts

- **API de toast:** não existe em `@minecraft/server` 2.10 nem em `server-ui` 2.2 (grep por `toast`/`achievement` nos
  `.d.ts` sem resultado). `toast_screen.json` é JSON UI, mas quem o alimenta são eventos do engine (conquista, convite,
  fila de matchmaking), e script não dispara isso. **NÃO** há toast nativo.
- **Tela de Conquistas vanilla:** Ore UI desde 1.16.100 e add-ons não registram conquistas. **NÃO**.
- **Toast custom no HUD: SIM.** Use o canal **actionbar** (fábrica `hud_actionbar_text_factory`), que recria o
  controle a cada mensagem e por isso reinicia a animação:
  ```json
  "cbtoast": { "type": "image", "texture": "textures/gui/cobblemon/toast/background",
    "size": [160, 32], "anchor_from": "top_right", "anchor_to": "top_right",
    "$t": "$actionbar_text",
    "visible": "(not (($t - 'cbT') = $t))",
    "offset": "@cobblemon_hud.toast_slide_in",
    "controls": [ /* ícone por ('textures/...' + campo), título/descrição por fatias de $t */ ] },
  "toast_slide_in":  { "anim_type": "offset", "easing": "out_quad", "duration": 0.25, "from": [170, 4], "to": [-4, 4], "next": "@cobblemon_hud.toast_hold" },
  "toast_hold":      { "anim_type": "wait", "duration": 3.5, "next": "@cobblemon_hud.toast_slide_out" },
  "toast_slide_out": { "anim_type": "offset", "easing": "in_quad", "duration": 0.25, "from": [-4, 4], "to": [170, 4] }
  ```
  e, em `hud_screen.json`, um painel com `"factory": { "name": "hud_actionbar_text_factory", "control_ids":
  { "hud_actionbar_text": "cbtoast@cobblemon_hud.cbtoast" } }` inserido no `root_panel`. O actionbar vanilla precisa
  ser escondido para mensagens `cbT` (`hud_actionbar_text` com `"$atext": "$actionbar_text"` e `visible`, como na
  wiki). Aqui, com variáveis, a fatia pode usar `('%.' + $n + 's')`, como o PokeBedrock faz. No script, o `HudBus`
  põe os toasts numa fila (1 por vez, ~4 s) e **segura** as outras mensagens de actionbar do add-on (máquinas,
  pesca etc.) enquanto um toast está na tela.
- **Tela de advancements do Cobblemon: SIM** (form custom). Uma aba por categoria, fundo `gui/advancements/backgrounds/*`,
  ícones como células com offset ancorado (§2.2.2), linhas de ligação desenhadas **no build** num PNG por aba (o
  gerador lê `parent` de `data/cobblemon/advancement/**`) e painel de detalhe ao selecionar. O progresso fica em
  dynamic properties (a lista "Progresso Cobblemon" de 13 objetivos em `PokedexUI.ts` já faz o rastreio). Ao
  concluir: toast + mensagem de chat traduzida.

---

## 6. Câmera e overlays (scanner da Pokédex, batalha, evolução)

API estável em 2.10 (`node_modules/@minecraft/server/index.d.ts`, classe `Camera`): `setFov({ fov, easeOptions })`,
`fade({ fadeColor, fadeTime })`, `setCamera(preset, { location, facingLocation | facingEntity | rotation, easeOptions })`,
`setDefaultCamera`, `attachToEntity({ entity, locator })` e `playAnimation(CatmullRomSpline | LinearSpline, …)`
(estáveis desde 2.6.0/26.10), `addShake`, `stopShaking`, `clear`. Presets: `minecraft:first_person`, `third_person`,
`third_person_front`, `free`, `fixed_boom`, `follow_orbit`, `control_scheme_camera`. Comando equivalente:
`/camera @s fov_set <fov> [ease] [tipo]` e `fov_clear`. Além disso: `ScreenDisplay.setHudVisibility/hideAllExcept`,
`world.afterEvents.playerHotbarSelectedSlotChange`, `Player.selectedSlotIndex` (gravável),
`world.afterEvents.playerButtonInput` (Jump/Sneak) e `player.inputInfo`.

### 6.1 Scanner da Pokédex (hoje "PARCIAL: zoom/overlay 3D NÃO POSSÍVEL" em `ALVOS.md`, o que é reversível)

Cobblemon (`PokedexUsageContext.kt`): zoom de FOV 80 → 10 em passos logarítmicos pela roda do mouse, com overlay
de bordas, anéis e scanlines e barra de progresso de 15 ticks.

Receita:
1. Ao usar o item Pokédex (já detectado em `scripts/pokedex/PokedexItem.ts`): `hideAllExcept([])` (ou esconder
   `Hotbar`, `Health`, `Hunger`, `Armor`, `StatusEffects`, `ItemText`, `ProgressBar`, `AirBubbles`, `Crosshair`) e
   `camera.setFov({ fov: 70, easeOptions: { easeTime: 0.2, easeType: EasingType.OutQuad } })`.
2. **Zoom pela roda:** durante o scan, a roda (ou LB/RB no controle) troca o slot da hotbar. Em
   `playerHotbarSelectedSlotChange`, calcule a direção (`newSlotSelected - previousSlotSelected`, com wrap 0↔8),
   aplique o passo logarítmico `fov = exp(lerp(ln 80, ln 10, step/N))` via `setFov` com ease curto e **devolva**
   `player.selectedSlotIndex` ao slot da Pokédex. O comportamento fica igual ao do Cobblemon em todas as plataformas.
   No toque, use botões de zoom no overlay (form transparente) ou Sneak/Jump via `playerButtonInput`.
3. **Overlay:** canal `cbS1` no HUD (§1.3) com as 21 texturas de `gui/pokedex/scan/`: bordas e cantos estáticos
   ancorados nas 4 laterais, scanlines com `tiled`, anéis girando. JSON UI não tem animação de **rotação**, então
   pré-renderize os quadros no importador e use `anim_type: "flip_book"` (ou `aseprite_flip_book`). O progresso é
   largura em px ou quadros. As informações do alvo (espécie, nível, visto/capturado) vão em campos do payload, e o
   nome traduzido vai no subtítulo.
4. A mão/item em primeira pessoa: attachable do item Pokédex com animação que tira o modelo da tela quando
   `q.is_using_item` (ou `v.scanning` via propriedade de ator).
5. Ao sair: `camera.setFov()` (confirmar em jogo se sem argumento restaura; se não, `player.runCommand("camera @s fov_clear 0.15 out_quad")`),
   `resetHudElementsVisibility()` e mandar o payload `cbS1` vazio.

### 6.2 Batalha

O Cobblemon 1.8.2 **não** assume a câmera na batalha (o jogador continua livre, com `BattleOverlay` + `BattleGUI`
por cima). Paridade é manter a câmera livre + HUD `cbB1` + form com `force_render_below`. Polimento opcional sem
quebrar paridade: `fade` curto ao entrar na batalha.

### 6.3 Evolução, captura, starter

- Evolução: `fade({ fadeColor: {red:1,green:1,blue:1}, fadeTime: {…} })` no clímax (o flash branco do Cobblemon) +
  overlay `cbE` + estúdio 3D (§3.2) com as duas formas, se for mostrar a cena em tela.
- Captura: overlay de balanço da bola (`cbC`) com as texturas `gui/ball/*`, sincronizado com a animação da
  entidade Poké Ball que já existe.
- Starter: estúdio 3D + `playAnimation` orbitando a plataforma.

---
## 7. Plano de implementação priorizado (arquivos concretos)

Regra de ouro: **o script manda dados e o RP desenha.** Todo JSON UI com expressões repetitivas é **gerado** por
ferramenta (expressões literais, nomes únicos), e o `tools/build.mjs` já mescla `generated/` com o que é escrito à mão.

### P0 — Fundação (pré-requisito de todo o resto)

| ID | Entrega | Arquivos | Aceite |
|---|---|---|---|
| P0-1 | Importar as **786 texturas de GUI** do Cobblemon, preservando a árvore | novo `tools/importer/gui.ts` (copia `upstream/cobblemon/common/src/main/resources/assets/cobblemon/textures/gui/**` para `generated/resource_packs/CobblemonBedrock/textures/gui/cobblemon/**`); registrar em `tools/importer/index.ts`; manter `wallpapers.ts` compatível com o caminho atual | `npm run import && npm run build` gera `dist/.../textures/gui/cobblemon/battle/battle_move.png` etc. |
| P0-2 | Texturas derivadas: `hp_{g,y,r}.png` 1×1 esticáveis, tiles de golpe por tipo (18), quadros dos anéis do scanner (flipbook), fundo de toast | mesmo `gui.ts` (usar `tools/importer/png.ts`) | arquivos em `textures/ui/cobblemon/**` |
| P0-3 | **Glifos fora da E0**: gerar `font/glyph_E2.png`/`glyph_E3.png` + `scripts/language/glyphs.ts` | novo `tools/importer/glyphs.ts`; **apagar** `resource_packs/CobblemonBedrock/font/glyph_E0.png`; atualizar `scripts/language/index.ts` (`typeSymbols`, `moveCategorySymbols`), `scripts/GUI/Battle.ts` (`categorySymbols`), `glyph_key.txt` | ícones de tipo aparecem no chat e nos forms, e os glifos de controle vanilla continuam intactos |
| P0-4 | Guarda contra Ore UI/mudanças vanilla | novo `tools/check-vanilla-ui.mjs`: baixa `bedrock-samples` na tag alvo e confere que `root_panel`, `hud_title_text/title_frame/title`, `hud_actionbar_text`, `main_screen_content`, `long_form`, `custom_form`, `npc_interact.skin_model` existem; `npm run check:ui` | falha de CI quando a Mojang mexer nos pontos de ancoragem |
| P0-5 | **Marcadores de tela** invisíveis e roteamento compatível | novo `scripts/GUI/screens.ts` (`SCREEN.PC = "§0§1§r"`, …, `withScreen()`); trocar os títulos em `scripts/GUI/PC.ts`, `Battle.ts`, `Summary.ts`, `StarterGUI.ts`, `scripts/pokedex/PokedexUI.ts`; reescrever `resource_packs/CobblemonBedrock/ui/server_form.json` só com `modifications` (`insert_back` de um painel com fábrica `server_form_factory` + binding que esconde `long_form`/`custom_form` quando há marcador) e um roteador `ui/cobblemon_forms.json` | um jogador chamado "PCgamer" abre a troca com o layout normal; o PC continua em grade |

### P1 — HUD persistente

| ID | Entrega | Arquivos | Aceite |
|---|---|---|---|
| P1-1 | `HudBus`: fila por jogador, 1 `setTitle` por tick, subtítulo para nomes, actionbar para eventos, `TextEncoder` para largura em bytes | novo `scripts/GUI/HudBus.ts` (base: protótipo `prototipo/HudBus.ts`) + testes de codificação em `tests/` | testes unitários de `fixed()`/`encodeParty()` com acentos e glifos |
| P1-2 | Party overlay do Cobblemon (retrato, nível, nome, gênero, status, HP vertical, EXP, selecionado) | `scripts/GUI/PartyHud.ts` (emitir `cbP1` pelo HudBus; manter o modo texto atual como fallback de config); novo gerador `tools/ui/gen-hud.mjs` (base: `prototipo/gen-hud.mjs`) → `generated/resource_packs/CobblemonBedrock/ui/cobblemon_hud.json`; novo `resource_packs/CobblemonBedrock/ui/hud_screen.json` (só `modifications`); `ui/_ui_defs.json` + `"ui/cobblemon_hud.json"` | time à esquerda em Win10 e num console, sem título vanilla piscando; sobrevive a `/title @s title oi` |
| P1-3 | HUD de batalha (caixas de info com HP/status/nível/bola de capturado, aliados e oponentes, 1v1 a 3v3) | novo `scripts/battle/BattleHud.ts` (inscrito nas atualizações de `PokemonBattle.ts`); canal `cbB1` no mesmo gerador; `setHudVisibility(Hide, [Hotbar, Health, Hunger, Armor])` durante a batalha | barras animam a cada dano; o menu de golpes (form) aparece sem cobrir as caixas |
| P1-4 | Toasts + overlays de captura/evolução | novo `scripts/GUI/Toast.ts`; trocar `setActionBar`/`setTitle` diretos de `scripts/evolution/EvolutionEffect.ts`, `scripts/catching/*` e `scripts/machines/*` por HudBus | toast desliza em cima à direita e não é cortado por mensagens de máquina |

### P2 — Telas no visual do Cobblemon

| ID | Tela | Arquivos |
|---|---|---|
| P2-1 | Batalha (menu, tiles 2×2 por tipo com PP/efetividade/categoria, troca, alvo, mochila) | `resource_packs/CobblemonBedrock/ui/battle.json` (reescrever com texturas `gui/cobblemon/battle/*` e células com campos), `scripts/GUI/Battle.ts` (codificar campos no texto do botão) |
| P2-2 | Summary (abas Info/Golpes/Stats, barras, marcas) em layout livre | novo `ui/summary.json` (gerado), `scripts/GUI/Summary.ts`, `scripts/GUI/Moves.ts` |
| P2-3 | PC com coluna da party, prévia e setas | `ui/pc.json`, `scripts/GUI/PC.ts`, `scripts/GUI/PCWallpapers.ts` (camada `glow`: segunda imagem com `alpha` fixo) |
| P2-4 | Starter (abas de região, carrossel, plataforma por tipo) | novo `ui/starter.json`, `scripts/GUI/StarterGUI.ts` |
| P2-5 | Pokédex (lista em grade, painel, formas, busca) | novo `ui/pokedex.json`, `scripts/pokedex/PokedexUI.ts`, `scripts/pokedex/PokedexVariations.ts` |
| P2-6 | Advancements do Cobblemon (árvore por aba) | novo `tools/importer/advancements.ts` (lê `data/cobblemon/advancement/**` e gera layout + PNG de linhas), novo `ui/advancements.json`, novo `scripts/pokedex/Advancements.ts` |
| P2-7 | DDUI nas telas utilitárias | `scripts/GUI/ConfigEditor.ts`, `scripts/npc/NPCEditor.ts`, `scripts/GUI/PokemonEdit.ts` (`CustomForm` + Observables) |

### P3 — 3D e câmera

| ID | Entrega | Arquivos | Aceite |
|---|---|---|---|
| P3-1 | **Estúdio 3D** (starter, summary, evolução, prévia do PC) | novo `scripts/GUI/Studio.ts` (spawn/limpeza, `camera.setCamera/fade/playAnimation/clear`, night vision); `tools/importer/entities.ts` (propriedade `cobblemon:ui_display` + component group sem IA/física/dano em todas as espécies); opcional `behavior_packs/CobblemonBedrock/cameras/presets/cobblemon_studio.json` herdando `minecraft:free` | modelo animado real visível à esquerda do form; nada fica para trás após fechar, sair ou recarregar |
| P3-2 | **Scanner** com zoom pela roda, overlay e mão escondida | novo `scripts/pokedex/Scanner.ts` (substitui a lógica de mira de `PokedexItem.ts`), canal `cbS1` no gerador, attachable do item com animação de guardar | FOV 80→10 em passos; overlay com anéis girando; `ALVOS.md` passa de PARCIAL para OK |
| P3-3 | Spike: retrato de NPC com Pokémon (plano B) | cena em `behavior_packs/CobblemonBedrock/dialogue/cobblemon_ui.json`, entidade de teste com `minecraft:npc`, render controller com `query.is_in_ui` | decisão go/no-go documentada |

### Itens que exigem validação em jogo antes de escalar (fazer em P0/P1, em Win10 + 1 console + Realms)

1. `(#v - 0)` versus `(#v * 1)` para converter string em número, no HUD e em forms.
2. `#size_binding_x/y` dentro de subárvore inserida no `root_panel` do HUD (S12 mediu em forms).
3. `#clip_ratio` alimentado por número vindo de string (`$one` float): se falhar, fica a textura por passo.
4. `setFov()` sem argumento restaura o FOV? Se não, `camera @s fov_clear`.
5. Esconder o `title_background` animado sem flash.
6. `actor_portrait_renderer` com entidade custom e `query.is_in_ui` (só para P3-3).
7. Custo de frame do HUD com 6 slots + batalha 3v3 no Switch (meta: sem queda perceptível; se houver, `ignored` nos
   slots vazios).

---

## 8. Fontes

Primárias (código/arquivos):
- `Mojang/bedrock-samples` tag `v1.26.50.4` e `v1.26.60.28-preview`: `resource_pack/ui/hud_screen.json`, `server_form.json`,
  `npc_interact_screen.json`, `toast_screen.json`, `ui_common.json`, `horse_screen*.json`, `inventory_screen*.json` —
  https://github.com/Mojang/bedrock-samples
- `node_modules/@minecraft/server/index.d.ts` (2.10.0) e `node_modules/@minecraft/server-ui/index.d.ts` (2.2.0) neste repo.
- Cobblemon 1.8.2 upstream neste repo: `upstream/cobblemon/common/src/main/kotlin/com/cobblemon/mod/common/client/gui/PartyOverlay.kt`,
  `battle/BattleOverlay.kt`, `pokedex/scanner/PokedexUsageContext.kt`, `client/gui/toast/CobblemonToast.kt`;
  texturas em `…/resources/assets/cobblemon/textures/gui/`.

Microsoft Learn:
- Introduction to DDUI — https://learn.microsoft.com/en-us/minecraft/creator/documents/scripting/intro-to-ddui?view=minecraft-bedrock-stable
- 1.26.10 Update Notes (câmera estável 2.6.0; DDUI beta e known issues) — https://learn.microsoft.com/en-us/minecraft/creator/documents/update1.26.10?view=minecraft-bedrock-stable
- 1.26.20 / 1.26.30 / 1.26.40 Update Notes (DDUI `show()` → `DataDrivenScreenClosedReason`; `CustomForm.image`) —
  https://learn.microsoft.com/en-us/minecraft/creator/documents/update1.26.40?view=minecraft-bedrock-stable
- Camera class — https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/camera?view=minecraft-bedrock-stable
- camera command (presets, `fov_set`/`fov_clear`) — https://learn.microsoft.com/en-us/minecraft/creator/commands/commands/camera?view=minecraft-bedrock-stable
- NPC Dialogue — https://learn.microsoft.com/en-us/minecraft/creator/documents/npcdialogue?view=minecraft-bedrock-stable
- Molang query functions (`query.is_in_ui`) — https://github.com/MicrosoftDocs/minecraft-creator/blob/main/creator/Reference/Content/MolangReference/Examples/MolangConcepts/QueryFunctions.md
- Changelog 26.50 (CustomForm.image em server-ui 2.2.0) — https://www.minecraft.net/en-us/article/minecraft--bedrock-edition-26-50-changelog

Bedrock Wiki (Bedrock-OSS/bedrock-wiki, branch `wiki`):
- Intro to JSON UI (deprecação, operadores, `$actionbar_text`, `#hud_title_text_string`, String Formatting `%.Ns`) — https://wiki.bedrock.dev/json-ui/json-ui-intro
- Preserve Title Texts — https://wiki.bedrock.dev/json-ui/preserve-title-texts
- Adding HUD Elements — https://wiki.bedrock.dev/json-ui/add-hud-elements
- Modifying Server Forms — https://wiki.bedrock.dev/json-ui/modifying-server-forms
- Dynamic Content Generation (factories/grids) — https://wiki.bedrock.dev/json-ui/dynamic-content-generation
- Type Conversion — https://wiki.bedrock.dev/json-ui/type-conversion
- Best Practices (performance) — https://wiki.bedrock.dev/json-ui/best-practices
- JSON UI Documentation (renderers, `clip_ratio`) — https://wiki.bedrock.dev/json-ui/json-ui-documentation
- Custom Emojis (páginas E2–F8 livres; sem suporte em Ore UI) — https://wiki.bedrock.dev/text/custom-emojis
- NPC Dialogue — https://wiki.bedrock.dev/entities/npc-dialogue

Comunidade / packs reais:
- `bedrock-core/ui` (JSX → JSON UI em server forms; spikes medidos em 2026-08/09: `docs/spikes/jsonui-container-facts.md`,
  `S1-form-entry.md`, `S5-compiled-cost.md`, `S12-live-layout.md`) — https://github.com/bedrock-core/ui · https://bedrock-core.drav.dev/docs/ui
- PokeBedrock RP (sidebar por actionbar com campos fixos; marcadores `§` em títulos/botões) — https://github.com/Kimtroll1/pokebedrock-res
- Padrões de HUD por título e barras (`rpg_hud.json`, `animated_bar.json`, notas de fatiamento) — https://github.com/boredape874/mcbejsonuimasterAI
- Ore UI (telas convertidas e status do JSON UI) — https://minecraft.wiki/w/Ore_UI
- DDUI com OreUI (limitações de layout) — https://note.com/karondaaa/n/nb8f89e49dffc
