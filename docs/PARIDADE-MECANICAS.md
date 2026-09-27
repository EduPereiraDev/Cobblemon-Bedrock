# Paridade de mecânicas: Cobblemon 1.8.2 (Java) x Cobblemon Bedrock (port)

Status atual depois da onda "fechar os impossíveis + lacunas da auditoria" (frentes ui-base, retratos, animacao,
motor, jogabilidade, mundo-sons, ia-npc, e2e e telas; plano em [`pesquisa/PLANO.md`](pesquisa/PLANO.md)), da onda
final (frentes visual-batalha, mundo-detalhes, dados-ui e as correções E2E), da revisão final, da onda de
fechamento (frentes multi, visual-final com o "Fechamento" da tinta, dados-ia, battle-leave e review-fixes) e da onda
"adaptações e limites" (frentes adaptacoes, batalha-minimizavel, limites A e B, give e as rodadas 2 e 3 da
review-fixes). Data: 2026-09-26. Fontes: o código em `scripts/` e `tools/`, os testes em `tests/`, as pesquisas em
[`docs/pesquisa/1..8-*.md`](pesquisa/) e os status em `docs/pendencias/{ui-base,retratos,animacao,motor,jogabilidade,
mundo-sons,ia-npc,e2e,telas,visual-batalha,mundo-detalhes,dados-ui,multi,visual-final,dados-ia,battle-leave,
review-fixes,adaptacoes,batalha-minimizavel,limites,give}.md`. Resultado de cada alvo "impossível":
[`pesquisa/ALVOS.md`](pesquisa/ALVOS.md); a revisão dos "NÃO POSSÍVEL" desta onda está em
[`pesquisa/8-limites-bedrock.md`](pesquisa/8-limites-bedrock.md) e a da batalha minimizável em
[`pesquisa/7-batalha-minimizavel.md`](pesquisa/7-batalha-minimizavel.md).

Legenda: **FEITO** (comportamento do 1.8.2 portado; desvios pequenos anotados) · **FEITO (aproximação)** (adaptação
aprovada pelo usuário que chega ao comportamento do Java por outro caminho; conta como FEITO) · **PARCIAL** (funciona com lacunas
relevantes) · **NÃO POSSÍVEL NO BEDROCK** (a pesquisa provou que não há API estável; a nota diz a adaptação usada) ·
**FALTA** (possível, ainda não feito). O que o Cobblemon 1.8.2 não tem (selvagem em duplas, Tera/Dynamax/Mega/Z,
espécies não implementadas no upstream, integração com mods Java) foi retirado da tabela: não é mecânica a portar.

## Estado final

Contagem real das tabelas das seções 1 a 10 (só mecânicas que existem no Cobblemon 1.8.2; script e saída no fim desta
seção), depois da frente vilas2 (2026-09-26): **274 linhas, 274 FEITO**. Nenhuma linha tem PARCIAL, NÃO POSSÍVEL NO
BEDROCK ou FALTA como status principal. Pelo texto completo da coluna "Status":

| Status | Linhas |
|---|---|
| FEITO | 253 |
| FEITO (aproximação) | 7 |
| FEITO (adaptação) | 4 |
| FEITO / NÃO POSSÍVEL NO BEDROCK (mista) | 7 |
| FEITO (aproximação) / NÃO POSSÍVEL NO BEDROCK (mista) | 2 |
| FEITO / PARCIAL (mista) | 1 |
| **Total** | **274** |

A linha mista conta pelo primeiro status: o comportamento principal está portado e a nota isola a parte que ficou de
fora (lista "Partes NÃO POSSÍVEL" abaixo).

**Linhas retiradas da tabela** (282 antes da onda "adaptações e limites", + 1 "Batalha minimizável" em §3, − 5 − 4 =
274):
- 5 linhas **N/A NO COBBLEMON**: o 1.8.2 não tem a mecânica (ver a legenda: selvagem em duplas, Tera/Dynamax/Mega/Z,
  espécies não implementadas no upstream, integração com mods Java). Não há o que portar.
- 4 linhas retiradas **a pedido do usuário**, por não afetarem quem joga: #69 (`/changejointscale`,
  `/calculateseatpositions`, ferramentas de modelagem), #125 (`enableDebugKeys`/`walkingInBattleAnimations`, opções de
  desenvolvedor/visuais do cliente Java), #126 (câmera/sensibilidade do cliente Java, cobertas pelas opções do próprio
  Bedrock, e infra MongoDB) e #114 (injeção nas vilas vanilla, que o Bedrock não permite: vira a adaptação da linha
  "Vilas do Cobblemon" em §7).

**Adaptações e aproximações aprovadas** (contam como FEITO; o desvio está na nota de cada linha):
- FEITO (adaptação), 4 linhas: Vilas do Cobblemon (§7; Pokécenter, mini-habitats e fazendas de berries viram estruturas
  próprias do mod espalhadas pelo mundo com a frequência do Java; sem exclusion zone, cada peça fica sozinha e não
  ligada à rua; a porta de dobradiça direita sai como a esquerda, única no Bedrock), Estatísticas de jogador (§7 e
  #106; `/cobblemon:stats` no lugar da tela vanilla de Estatísticas) e Skin de jogador em NPC (§8; sem API de skin no
  estável, pesquisa 8 §13).
- FEITO (aproximação), 9 linhas (7 + as 2 mistas): estruturas vanilla como condição de spawn (§1, por assinatura de
  blocos), NPC com modelo de Pokémon (§8 e #53), sherds no vaso decorado (#10), pinturas crossover (#30),
  `work_nurse` (#99), fazendeiro com sementes do Cobblemon (#136), freelook (#38) e livro de receitas agrupado (#146).

**Partes NÃO POSSÍVEL NO BEDROCK ou PARCIAL dentro das 10 linhas mistas** (prova ou fonte na nota):
- §2 sequência de captura: o vermelho do feixe clareia (`overlay_color`); verde e azul exatos.
- §8 `isMovable`/`isLeashable`/`allowProjectileHits`: o projétil não atravessa o NPC (só deixa de ferir).
- #22: `mobTargetInBattle` é PARCIAL (cancela o dano).
- #38: roll da câmera nativa (o modo `roll` está pronto e desligado até conferir no cliente).
- #70: funções MoLang sem equivalente retornam 0 (`swing_hand`, `seen_credits`, structs de batalha/servidor, Brain,
  `curve`).
- #84: mudar a posição de um assento quando um anterior é filtrado.
- #88: brilho em anéis e rastro dos olhos do Alfa (só a partícula).
- #111: `fly_in_circles`, `flee_nearest_hostile` e `walk_away_from_avoid_target` (sem componente vanilla).
- #113: trim `automaton`.
- #146: busca "poke" = "poké" (a busca é do cliente).

**Só para conferir no cliente:** as 94 checagens da seção seguinte ("O que precisa de conferência num cliente real").
O BDS não carrega o resource pack nem desenha UI, som ou partícula, então HUD e telas JSON UI, retratos, animações e
modelos, partículas, sons, câmera da montaria (roll de #38), busca do livro de receitas (#146) e a aparência das peças de
vila (Pokécenters, mini-habitats, fazendas de berries e portas de apricorn) só podem ser confirmados por um jogador.
Nenhuma dessas checagens foi feita.

Script da contagem (coluna "Status"; linha mista conta pelo status antes do primeiro ` / `; `\|` dentro da célula não
separa colunas). Rodado na raiz do repositório:

```bash
python3 - docs/PARIDADE-MECANICAS.md '## 1. Spawning' <<'EOF'
import sys, collections
txt = open(sys.argv[1], encoding="utf-8").read()
a = txt.index("\n" + sys.argv[2]); txt = txt[a:txt.index("\n## Anexo", a)]
c, col = collections.Counter(), None
for l in txt.splitlines():
    if not l.startswith("|") or set(l) <= set("|-: "): continue
    cells = [x.strip() for x in l.replace("\\|", "¦").strip("|").split("|")]
    if "Status" in cells: col = cells.index("Status"); continue
    if col is not None: c[cells[col].split(" / ")[0].split(" — ")[0].split(" (")[0].replace(" NO COBBLEMON", "")] += 1
print(sum(c.values()), dict(c))
EOF
```

Saída: `274 {'FEITO': 274}` (antes da onda "adaptações e limites":
`282 {'FEITO': 255, 'PARCIAL': 4, 'N/A': 5, 'NÃO POSSÍVEL NO BEDROCK': 18}`). Para
[`PARIDADE-ITENS-BLOCOS.md`](PARIDADE-ITENS-BLOCOS.md), o mesmo trecho com os argumentos
`docs/PARIDADE-ITENS-BLOCOS.md '## Cobertura'`.

Verificação da frente vilas2 (portas do Cobblemon nas estruturas e fazendas de berries; `docs/pendencias/vilas.md`):
`npm run import` ok (85 estruturas jigsaw, 1.364 peças, 29 structure sets), `npm run validate` "OK: nenhum erro",
`npx tsc -p tsconfig.json` 0 erros, `npm test` verde (`vilas`: 9 testes). BDS próprio (`vila2`, mundo novo, bot E2E):
`/locate` acha as 10 fazendas; as 10 visitadas batem 100 % com o molde, no nível do chão, com berries de um par do
`crop_to_berry`; Pokécenters de taiga, neve e deserto com 100 % dos blocos do molde (antes 98–99,6 %: faltavam só as
portas) e portas/máquina de cura na direção do molde (`testforblock`). Log sem ERROR/WARN de conteúdo ou worldgen (fora
o aviso de transporte do raknet, os `testforblock` do console e o `[spawn] passe lento` da frente spawn); uma queda do
BDS na 1ª entrada do bot no mundo novo, sem dump, não se repetiu em 4 entradas seguintes (inclusive com a mesma
sequência de comandos e o mesmo destino).

Verificação da onda "adaptações e limites" (última rodada, review-fixes 3): `npm run import` ok, `npm run validate`
"OK: nenhum erro" (inclui a checagem nova de itens invisíveis ao `/give` e o JSON mesclado), `npx tsc -p
tsconfig.json` 0 erros e `npm test` com **41 arquivos** verdes (inclui `adaptacoes`, `batalha-minimizavel`,
`limites`, `limites-b`, `give`, `review-fixes-2` e `review-fixes-3`). BDS próprios das frentes (`adapt`, `pot`,
`bmin`, `give`, `lima`, `limb`, `rf2`, `rf3`) sem ERROR/WARN de conteúdo ou script (fora o aviso de transporte do
raknet e a saída das sondas); E2E completo **10/10** na frente batalha-minimizavel, com o cenário novo
`10-batalha-minimizavel`, mais os cenários
avulsos `tests/e2e/experimental/limites.e2e.mjs` e `limites-b.e2e.mjs`. Uma queda do BDS na rodada 3 (`corrupted size
vs. prev_size`, glibc, content log vazio) não se repetiu em 6 subidas.

Verificação da onda de fechamento: `npx tsc -p tsconfig.json` sem erros, `npm test` com os **33 arquivos** verdes
(inclui `multi`, `visual-final`, `tint`, `dados-ia`, `battle-leave` e `review-fixes`), `npm run import`/`validate` sem
erro e sem aviso, os BDS próprios das frentes (`multi`, `visual`, `tint`, `dadosia`, `leave`, `rfix`) com **zero
ERROR/WARN** de conteúdo ou script (fora o aviso de transporte do raknet) e o cenário E2E novo **`09-multi`** (4 bots)
passando, além dos 8/8 da onda anterior (inicial, time, batalha selvagem, captura, PC, NPC, troca e Pokédex). O BDS
não carrega o resource pack nem desenha UI, som ou partícula: tudo o que é visual está na lista abaixo.

## O que precisa de conferência num cliente real

Lista consolidada (sem repetição) das checagens que só um cliente Bedrock consegue fazer. Nenhuma foi feita ainda.

### Conexão

- [ ] Cliente oficial entra no servidor do Mac pelo NetherNet: IP do Mac na porta `19132` (TCP + UDP) e a faixa UDP
      `19200-19209` anunciada com o IP do Mac na rede local (o IP muda com o DHCP: conferir com `ipconfig getifaddr en0`
      e refazer o deploy se mudou). Console: pelo MCXboxBroadcast.

### HUD (canal título, JSON UI)

- [ ] Party overlay à esquerda: 6 espaços, retrato, barras verticais de HP/EXP, status, gênero, bola, selecionado
      deslocado 6 px, desmaiado, vazio; pop-up de golpe novo/evolução ao lado do espaço.
- [ ] Overlay de EXP: "+N EXP" e rolo de level-up no retrato (fora e dentro de batalha), com `gui.levelup_start` e
      `gui.levelup`.
- [ ] HUD de batalha: caixas dos dois lados (1v1 a 3v3), HP em barra e texto ("atual/máx" no seu, "NN%" no do
      oponente), status, nível, gênero, capturado, nomes dos treinadores; espectador vê o lado 1 à esquerda.
- [ ] HUD de batalha com Illusion/Transform: o oponente vê o disfarce (espécie, nome, gênero, retrato; nível e HP do
      real); com Transform todos veem a espécie copiada.
- [ ] Toasts das conquistas: moldura e cor por tipo (tarefa/objetivo/desafio), entram e somem em 5 s.
- [ ] `('%.Ns' * X)` conta bytes UTF-8: campos depois de um nome acentuado não podem deslocar.
- [ ] O título vanilla fica escondido sem piscar o fundo; o actionbar vanilla não mostra mensagens `cbS…`.
- [ ] `stack_panel` recolhe filhos invisíveis (recuo de 6 px do selecionado e de 4 px por posição na batalha).
- [ ] Custo de frame dos ~530 bindings do HUD em console/Switch.

### Batalha minimizável (HUD do modo `java` e preferência `hud`)

- [ ] O `#hud_title_text_string` recebe a cauda rawtext **já traduzida**: o aviso aparece como "Você precisa escolher
      uma ação. Pressione …" com a tecla certa, e não como JSON cru ou chave (plano B: chaves por gesto).
- [ ] O aviso pisca em laço (`prompt_fade_out` ↔ `prompt_fade_in`, 2 s + 2 s, `in_out_sine`), cabe e fica legível a
      y = 20 % em 16:9, no celular e em GUI scale padrão.
- [ ] Caixas dos ativos esmaecidas a 50 % com a batalha minimizada (`alpha` + `propagate_alpha`) e `hide_label` a
      0,75 com a tela aberta esperando.
- [ ] Celular: duplo toque em Pular reabre a tela sem que os dois pulos atrapalhem; o aviso diz "Toque duas vezes em
      Pular".
- [ ] Controle: segurar B (agachar) e apertar A funciona como a tecla R.
- [ ] Preferência `hud`: o menu 2×2 de golpes acima da hotbar não cobre corações nem fome; o cursor segue a hotbar
      (1–4, roda, LB/RB, toque no espaço).
- [ ] Glifos das páginas `E2`/`E3` (tipos, categorias, ♂/♀, brilhante, capturado, 48 Poké Balls) no chat, actionbar e
      forms; a página `E0` vanilla voltou a ser a original.

### Telas (forms roteados por marcador)

- [ ] `modifications` em `long_form` e a 2ª `server_form_factory`: PC e batalha continuam com o layout próprio e
      forms comuns (nome de jogador/caixa com "PC") não caem na grade.
- [ ] `collection_index` em células dentro de painéis `form_buttons`: cada clique chega com o índice certo.
- [ ] Botões com `bindings` próprios: estados `hover`/`pressed` com o 2º quadro da textura.
- [ ] Tiles de golpe pintados pelo tipo (18 imagens com `color`), PP dourado/vermelho, categoria e efetividade.
- [ ] Tipo efetivo no tile e na dica de efetividade: Hidden Power pelo tipo sorteado, golpes Normal com
      Pixilate/Aerilate/Refrigerate/Galvanize, Normalize.
- [ ] Batalha (tiles Lutar/Mochila/Pokémon/Fugir, alvo, troca com retratos e barras, mochila em grade), Resumo
      (perfil 128 px, abas, barras de atributo), PC (6×5 com rostos, coluna do time, papel de parede, prévia),
      Inicial (carrossel, plataforma do tipo), Pokédex (grade 5×5, moldura na cor da Pokédex, entrada com perfil).
- [ ] Move Dex (botão "Golpes" na entrada da Pokédex): lista, filtros Todos/Nível/TM/Ovo, ordens, troca de forma e
      painel do golpe; filtros novos da Pokédex (montáveis, TM não descoberto, busca por habilidade/golpe/drop).
- [ ] PC: ordenar a caixa, filtro que escurece quem não passa, reabrir na última caixa vista; prévia com markings,
      natureza, habilidade, IVs e EVs.
- [ ] Resumo: 6 markings (texturas `icon_marking_*`, 3 estados), grito ao tocar no retrato/modelo 3D e página de
      montaria na aba Atributos (tocar de novo na aba).
- [ ] Tela de `/cobblemon:stats` e o toque `gui.click` nos forms da batalha, do resumo e das iniciais.
- [ ] Papéis de parede do PC (51 texturas): a caixa sem escolha mostra `wallpaper_basic_05` (padrão do Java), o papel
      ocupa a tela inteira (174×155) e a camada `glow` (208×189 em x−17, y−17) aparece entre o papel e a grade, com a
      textura montada por concatenação de string no `#texture` do `pc.json`.
- [ ] Equipes Multi no menu de interação de jogador: "Formar grupo", "Recusar (Formar grupo)", "Batalha Multi" e
      "Abandonar grupo" aparecem no caso certo; a tela da regra de nível (Luta Livre / Nível 50 / 100 / 5 para todos)
      abre depois do formato (simples, dupla, tripla e Multi) e fechar a tela não desafia ninguém.
- [ ] Texto nas células (escala 0,45–0,8) legível no Switch/celular; ordem de foco com controle; hover/foco nas
      células vazias do PC (espaço vazio clicável como destino).

### Retratos

- [ ] Orientação e enquadramento dos retratos (64 px), ícones (32 px) e perfis (128 px) iguais aos do Cobblemon Java
      (a iluminação usa lightmap 1; o Java usa `LightTexture.pack(11, 7)`); shiny, forma regional e gênero certos no
      HUD, PC, pasto, batalha e Pokédex.

### Estúdio de câmera e scanner

- [ ] Estúdio (modelo 3D ao vivo) no inicial e no resumo: o modelo cai dentro da janela vazada em 16:9 e 4:3 e com
      escalas de GUI diferentes; luz à noite (visão noturna temporária); no Nether cai para 2D.
- [ ] `camera.setFov`/`fov_clear` devolvem o FOV do jogador; `hideAllExcept([])`/`resetHudElementsVisibility`
      convivem com o HUD da ui-base.
- [ ] Scanner da Pokédex: zoom pela roda/hotbar (70 → 30), overlay do actionbar `cbS` (some em 1,5 s), modo scanner
      com agachar + usar.

### Animações e modelos

- [ ] Posers Kotlin convertidos (308) e as 8 espécies novas (tangela, pupitar, lillipup, herdier, jellicent, durant,
      bounsweet, pyukumuku) com a pose certa; Y de `transformedParts` (ex.: corpo do Charizard afunda na água).
- [ ] `pitch_tilt`, look compensado, asas/ondas procedurais, texturas animadas (36 flipbooks: chamas de Charmander,
      Ponyta, Magcargo, Toxel...).
- [ ] Camadas emissivas (`ignore_lighting`) e o flash de dano (`is_hurt_color`) com Vibrant Visuals.
- [ ] Escala individual (`cobblemon:scale_modifier`, bebês, Mini/Jumbo) e tamanho do Alfa.
- [ ] Lã por aspect (`q.has_aspect` → propriedade `cobblemon:aspects`): Mareep, Wooloo e Dubwool com lã e, tosquiados
      (`sheared`), sem lã; o Mareep toca uma caminhada só. Cauda do Slowpoke (`regrown-tail-1..3`).
- [ ] Rolagem de textura `scrolling` (`uv_anim` por variante). Nenhum dado do 1.8.2 usa: conferir com uma camada de
      teste.

### Vestíveis e item segurado

- [ ] 17 vestíveis na cabeça do jogador (slot de capacete): posição e escala (display.head × 0,625 em volta do centro
      da cabeça) e o sprite na mão com a geometria do arco vanilla.
- [ ] Vestíveis no Pokémon: âncoras `cobblemon_anchor_hat`/`face` nos locators `item_hat`/`item_face`, escala 0,62;
      sinal do eixo X nas ~90 variantes sem esses locators (caem no locator `item`).
- [ ] Item segurado desenhado no locator `item` pela mão secundária (a transformação de mão do Bedrock não é o FIXED
      do Java); some com a tag hidden e no Alfa selvagem. Item na boca do Vulpix.

### Partículas

- [ ] Efeitos de golpe: direção dos feixes (`v.target_*`), `pre_effect_script` com `v.entity_*`, partícula no locator
      (nasce na pose de repouso, sem seguir o osso).
- [ ] Brilho de shiny (anel, brilho ambiente, soltar da bola), `cobblemon:evo_particles`, `broth_bubbles` da panela,
      partículas presas às animações das espécies (35).
- [ ] Envio com bola: bola em arco de 0,5 s, estouro com as partículas da bola e o Pokémon crescendo em 0,4 s; recolha
      com o feixe vermelho (`recall_beam`) e o Pokémon encolhendo. Em batalha e fora dela (menu do time, envio rápido).
- [ ] Partículas de status/boost em batalha (`statup`/`statdown`, paralisia, sono, paixão, confusão, Protect).
- [ ] Partículas de espécie que antes repetiam: o importador trocou emissor `looping` sem `sleep_time` por `once`
      (72 partículas; a animação que as dispara em laço continua re-emitindo). Néctar do Combee.
- [ ] Tinta vermelha do feixe (`cobblemon:beam_tint` + `overlay_color`): na captura e na recolha (fora e dentro de
      batalha), verde e azul caem de 1 a 0,4 entre 0,2 s e 0,44 s e ficam assim até o fim do feixe; o flash de dano
      continua normal fora do feixe. O vermelho clareia um pouco (desvio conhecido do `overlay_color`).
- [ ] Sequência de captura: `recall_beam` da bola ao Pokémon (0,7 → 1,5 s), `capturesparks`/`capturestar`/
      `afterspark` no sucesso, `hisui*` e `ancient_pokeball_smoke` na ancient, `<bola>_casual_sendflash` no escape.
- [ ] Partículas de aspect: gota de mel (`honey_drenched`) e migalhas do Poké Snack (`cobblemon:poke_snack_crumbs`)
      em volta do Pokémon; olhos do Alfa (`cobblemon:alpha_eyes`) presos aos locators dos olhos, 5 por segundo.
- [ ] Corte do Furfrou: `cobblemon:poodle_hair_<cor>` pelo corante em 0 / 0,2 / 0,7 s, com o som de tesoura.

### Sons e música

- [ ] Sons de bloco (quebrar/colocar/bater/pisar) dos conjuntos do Cobblemon; sons das máquinas (TM Machine,
      panela, fósseis, monitor, Healing Machine, PC, baú dourado, vitrine), pesca e chimes de shiny.
- [ ] Sons de golpe/impacto (`cobblemon.move.*`, `cobblemon.impact.*`) nos tempos da timeline.
- [ ] Música de batalha com um resource pack que preencha `cobblemon.battle.pvw/pvp/pvn.default` e
      `/scriptevent cobblemon:battle_music on` (troca/fade em `playMusic`).

### Montaria

- [ ] Câmera `cobblemon:ride_orbit` (follow_orbit, raio 7) no ar/água e `cobblemon:ride_boom`;
      `/scriptevent cobblemon:ride_camera auto|always|boom|off`; `camera.clear()` ao desmontar.
- [ ] No ar/água: agachar segurado desce, agachar 2× rápido desmonta, pulo segurado sobe.
- [ ] Rolagem visual no voo: sinal do `cobblemon:roll` (±45°) no `root_part`; `q.rider_head_x_rotation(0)` nas molas.
- [ ] Velocidades por estilo: terra sem sprint no `getWalkSpeed` do Java (Altaria ≈ 1,12 b/s, medido no BDS); ar e
      água aproximadas.
- [ ] Sprint na terra: duplo toque para frente (teclado, analógico, joystick de toque) corre; a barra de fôlego na
      actionbar; o FOV sobe para 80,5 com `out_sine` e volta ao FOV do próprio jogador ao parar (quem joga com FOV
      maior que 80,5 vê o FOV cair enquanto corre).
- [ ] Freelook (`/scriptevent cobblemon:ride_camera freelook`): a câmera orbita livre com o mouse e como a montaria
      reage a A/D (`input_ground_controlled`, `free_camera_controlled`).
- [ ] Roll da câmera: `/scriptevent cblimits:camera_roll_test` (como jogador, com `scriptevent cobblemon:debug_probes
      on` dado pelo console) rola a tela pelo z da spline?
      Se rolar, avaliar se o modo `roll` (câmera perseguidora) é jogável antes de ligá-lo por padrão.
- [ ] Overlay de controles na actionbar (com `displayControlSeconds` > 0), loops `ride.loop.*` com volume/tom pela
      velocidade (stereo para quem monta, posicional para quem está perto) e bônus de velocidade/fôlego da Aprijuice.

### Mundo, blocos e estruturas

- [ ] Clique no baú dourado abre a UI de baú (caixa 1,02 da entidade) e 4 golpes quebram (criativo: 1).
- [ ] Vitrine mostra o item (sem o brilho de encantamento no modelo); estante de discos e atril com Pokédex.
- [ ] Estante de discos: os 14 discos visíveis (lado e espelhamento da textura, virada para a frente) e o sequenciador
      de note block; luz 13 do atril enquanto alguém lê a Pokédex.
- [ ] Feto no tanque de restauração (19 modelos, crescimento pelas curvas, orientação para a frente do tanque).
- [ ] Luz dinâmica: blocos de luz seguindo a cabeça dos Pokémon luminosos e do jogador com a Pokédex na mão, sem
      piscar nem deixar luz para trás; custo com muitos Pokémon luminosos juntos.
- [ ] Abas do inventário criativo: as 7 do Cobblemon, na ordem do Kotlin, com ícone e nome traduzido.
- [ ] Rotação das juntas verticais dos jigsaws (221 de 3.695): se peças empilhadas saírem giradas 90°, trocar
      `TOP_ROTATION` em `tools/importer/jigsaw.ts`.
- [ ] Pokécenters, mini-habitats e fazendas de berries de vila (estruturas próprias): aparência no cliente, portas de
      apricorn (a de dobradiça direita sai como a esquerda: conferir a porta dupla) e integração com o terreno em encosta.
- [ ] Barcos de apricorn/saccharine: textura/UV e remos (sem animação de remo).
- [ ] Redstone com jogador conectado: lâmpada ao lado de botões/placas de apricorn e saccharine, Eject Button e Ring
      Target acende ao vivo.
- [ ] Waterlogging visual dos blocos do Cobblemon (lajes, escadas, baú dourado, PC...).
- [ ] Ícone 2D da `strange_ball` no inventário (gerado da `poke_ball` com a tampa verde-água do modelo).
- [ ] Healing Machine "natural" das estruturas: textura `healing_machine_limited` nos 5 níveis de carga.
- [ ] Vaso decorado do Cobblemon: os 4 lados com o sherd certo (se esquerda e direita saírem trocadas, inverter
      `SIDE_BONES.east/west` em `tools/importer/adaptacoes.ts`), o corpo liso e o ícone; a tela aberta ao usar a mesa
      de trabalho segurando um sherd do Cobblemon (sem agachar) e o vaso com a lore no inventário.
- [ ] Panela e vaso com comparador e redstone ao vivo, com jogador conectado (o BDS só provou com bot).
- [ ] Healing Machine e Metronome com comparador ao vivo (o BDS provou com bot): pôr/tirar um comparador recoloca o
      bloco no mesmo tick (sem piscar nem perder a água do Metronome); o fio encostado no bloco não se desenha ligado
      a ele (produtor base de força 0 sem faces).
- [ ] Pinturas do Cobblemon: o clique real com o item Pintura numa parede, imagem e orientação da placa nos 4 lados e
      se a caixa de acerto (`custom_hit_test` por coluna) cobre a pintura toda.
- [ ] Pokédex na estante entalhada: pôr e tirar as 7 Pokédex (tag `minecraft:bookshelf_books`; o bot não clica em
      bloco).
- [ ] Livro de receitas: os 44 grupos do Cobblemon aparecem recolhidos no livro (e no criativo); a busca do cliente
      acha "poké" digitando "poke"?

### Entidades, NPC e batalha

- [ ] Pokémon e NPC ficam parados durante a batalha (eventos `cobblemon:battle_start`/`battle_end`), NPC na água
      continua flutuando, e a IA volta depois.
- [ ] Mobs vanilla (creeper, esqueletos, raposa, phantom) fogem de Pokémon no ombro.
- [ ] Skin do NPC (Steve/Alex/treinadores; `model-default`/`model-slim`) e escala do modelo por
      `cobblemon:npc_render_scale`; gibber (sons de fala) nos diálogos.
- [ ] Rótulo acima do Pokémon ("???" para espécie não vista; só agachado com a config).
- [ ] Entidade de exibição de Illusion/Transform/Imposter: o rótulo do Pokémon real some e a invisibilidade não
      mostra partículas.
- [ ] Balsa na água: orientação e textura das 5 geometrias `water_platform_*`, convés rente aos pés.
- [ ] Combee indo às flores e à folha de saccharine; Vulpix levando o item na boca.
- [ ] Nosepass parado vira o corpo/cabeça para o spawn do mundo (a cada 10 ticks) e não "treme" perto dele; andando,
      não aponta.
- [ ] Envio rápido (agachado + pular) e troca de selecionado (agachar 2×) em toque e controle; em voo no criativo,
      agachado + pular também solta o Pokémon.
- [ ] NPC com modelo de Pokémon (editor `/npcedit`, `resource_identifier` = espécie): o modelo do NPC some por
      inteiro, o Pokémon aparece na escala certa, anima ao andar (se ficar parado, o plano é a propriedade
      `cobblemon:display_moving`) e vira para onde o NPC olha; pose de batalha contra o NPC.
- [ ] NPC escondido por jogador: some só para quem deve; o rótulo `TextPrimitive` fica na altura certa para quem vê;
      a exibição encolhida (5 %) some de fato; sombra e empurrão continuam (esperado).
- [ ] Enfermeira: textura `nurse`/`nurse_joy` sobre a do bioma e o selo de nível; anda até a Healing Machine no
      horário de trabalho; a tela de trocas com o título "Enfermeira".

## Correções do orquestrador nesta onda

| Correção | Onde | Efeito |
|---|---|---|
| IA congelada na batalha | `scripts/battle/PokemonBattle.ts` (`triggerEvent`), `tools/importer/{entities,npcs}.ts` | `cobblemon:battle_start` tira os grupos de IA do Pokémon e do NPC (o NPC mantém `float`); `cobblemon:battle_end` devolve |
| Fim de batalha certo | `PokemonBattle.outcomeDecided` (gravado pelo `BattleInterpreter` no `\|win\|`/`\|tie\|`) | selvagem que some no desmaio antes do `\|win\|` não vira mais `stopped` |
| `switchOut` robusto | `scripts/battle/BattleInterpreter.ts` | oponente/treinador inválido não quebra a troca; local de envio de reserva quando não há posição |
| Transporte do servidor | `tools/server.mjs` | BDS principal em `transport=nethernet` (TCP 19132 + faixa UDP fixa `19200-19209` anunciada com o IP do Mac na LAN); bots do E2E em `raknet` |

## Correções da revisão final

| Correção | Onde | Efeito |
|---|---|---|
| Raposa só pega pilhas comuns | `scripts/entity/SpeciesBehaviours.ts` (`isPlainStack`) | A boca guarda só o id do item: pilhas com nome, lore, propriedades, encantamento, desgaste ou conteúdo ficam no chão; de uma pilha maior sai 1 item |
| Item da boca não se perde | `scripts/spawning/Despawner.ts`, `scripts/catching/CaptureSequence.ts` | Pokémon com item na boca não some pelo despawner; na captura o item cai no chão |
| Luz dinâmica persistida | `scripts/entity/DynamicLight.ts` | As posições das luzes vão para propriedades do mundo divididas em partes a cada tick com mudança; uma queda não deixa blocos de luz para trás |
| Sondas de depuração desligadas | `scripts/Config.ts`, `scripts/events/ScriptEvents.ts` | `md_*`, `ms_*`, `debug_visual` e `ianpc_*` só respondem com a config `enableDebugProbes` (padrão desligado), ligada por `scriptevent cobblemon:debug_probes on\|off` no console do servidor |
| Balsa e entidades de exibição limpas | `scripts/Cleanup.ts`, `scripts/battle/Platform.ts`, `scripts/main.ts`, `scripts/catching/CaptureSequence.ts` | Balsas de batalha e entidades de Illusion/Transform que sobraram de uma queda somem ao carregar o mundo/chunk (o Pokémon real volta a aparecer) e também na captura |
| Envio cancelado libera a fila | `scripts/battle/SendOut.ts` | Se a bola não chega a estourar, quem espera o envio (fila da batalha, trava do envio casual) é avisado e a batalha continua |
| Corrida recolha × batalha | `scripts/pokemon/SendOutAnimation.ts` | Um Pokémon que entra em batalha durante a recolha não é tirado de campo (só desfaz o encolhimento) |

## Correções da onda de fechamento (battle-leave e review-fixes)

| Correção | Onde | Efeito |
|---|---|---|
| Jogador sai no meio de PvP/Multi | `scripts/battle/index.ts` (`stopBattlesOfLeavingPlayer` no `playerLeave`), `scripts/battle/BattleActor.ts`, `scripts/ui/BattleHud.ts` | A batalha para na hora com `stop()` (sem vencedor, como o `SERVER_PLAYER_LOGOUT` do Cobblemon); menu e HUD não tocam mais a entidade inválida (acabaram `Battle menu error: InvalidEntityError` e `Failed to get property 'name'`). Na Multi a equipe recebe `team.left.other`/`team.disband`. Prova: `tests/battle-leave.test.ts` e BDS com bots (1×1 e 2×2, 0 ERROR/WARN; o build sem a correção reproduz os erros) |
| Nosepass girado por dois loops | `scripts/visual/PointToSpawn.ts`, `scripts/entity/SpeciesAi.ts` | Um só caminho (`lookAt` a cada 10 ticks); em cima do centro do bloco do spawn não gira, como o `LookControl` do Java |
| Tela rejeitada quando o jogador sai | `scripts/trade/PlayerInteraction.ts` (`showFormSafely`), `scripts/battle/index.ts` (`report`) | Menu de interação e tela da regra de nível sem `unhandledRejection`; aviso de erro só para jogador válido |
| Conflito do pasto fora da área | `scripts/machines/pastureConflict.ts` | Liga a IA só se o hostil mais próximo (mesmo critério do `nearest_attackable_target`) estiver dentro da área. Limite: o `must_see` do componente não é reproduzido |
| Guia do NPC readicionada a cada carga | `scripts/npc/NpcFlags.ts` | Estado aplicado guardado em dynamic properties; o evento só dispara quando muda |
| PvP sem o lead escolhido | `scripts/battle/index.ts` (`playerBattleLead`), `scripts/ChallengePlayer.ts` | Lead = quem está em campo ou o selecionado no HUD; o do desafiante fica guardado no desafio. Multi: N/A (o Java usa a ordem do time) |

## Correções da onda "adaptações e limites" (review-fixes, rodadas 2 e 3)

Detalhes e provas em [`pendencias/review-fixes.md`](pendencias/review-fixes.md); testes em
`tests/review-fixes-{2,3}.test.ts`.

| Correção | Onde | Efeito |
|---|---|---|
| Nome do NPC escondido não voltava | `scripts/npc/NpcHide.ts` | O nameTag original fica em `npc:hide_blanked` (vale depois de /reload); sem ninguém precisando da ocultação, o nome volta |
| Montaria `horse` sem sprint a ~15 b/s | `tools/importer/entities.ts`, `scripts/entity/RideSprint.ts`, `scripts/pokemon/RideStats.ts` | Andar usa o `getWalkSpeed` do Java (`walkMovementValue`); o fator 0,8 era erro. BDS: Altaria 1,12–1,16 b/s (Java 1,12) |
| Clique na exibição do NPC tirava a pose de batalha | `scripts/main.ts`, `scripts/npc/PokemonModel.ts` | A exibição (tag `cobblemon_npc_model`) não passa pelo menu do Pokémon; `in_battle` reaplicado a cada tick |
| Modo `hud` no Multi mandava golpe sem alvo | `scripts/battle/BattleUiMode.ts` | `hud` só em singles (1 posição e 1 ator por lado); no resto fica o aviso do `java` |
| Menu do HUD preso ao trocar de modo | `scripts/battle/BattleUiMode.ts` | Menu só com `mode === "hud"`; trocar de modo limpa o pedido |
| Espectador via o overlay do time | `scripts/GUI/PartyHud.ts` | Espectador conta como "em batalha", como no Java |
| `/scriptevent cobblemon:ride_camera` respondia "is invalid" | `scripts/events/ScriptEvents.ts` | Entrada vazia no dicionário; o comando segue em `scripts/world/index.ts` |
| Exibição recriada visível e nome devolvido a todos | `scripts/npc/{PokemonModel,NpcHide,NPCEntity}.ts` | Override aplicado no mesmo tick da criação e de todo `refreshNameTag`; rótulo acompanha nome e hitbox |
| FOV base do sprint | `scripts/entity/Riding.ts` | NÃO POSSÍVEL NO BEDROCK ler o FOV do jogador: fica 70 × 1,15 = 80,5 e `setFov()` sem valor ao parar; `RIDE_SPRINT_FOV.enabled` desliga no código |
| Filhote virava Enfermeira | `scripts/limitesB/nurse.ts`, override `villager_v2.json` | Só adultos (`onlyIfAdult` do Java), também no filtro do evento |
| Pintura caía com a parede em chunk descarregado | `scripts/limitesB/paintings.ts` | Bloco ilegível = "não sei", nunca "caiu" |
| Sobreposição com pintura vanilla | `scripts/limitesB/paintings.ts` | Caixa `getAABB()` quando tem cara de pintura, senão estimativa conservadora; clique repetido cancelado |
| Entidade órfã do vaso com item preso; custo com muitos vasos | `scripts/adaptacoes/decoratedPot.ts` | Órfã solta o item e some; interação adiada até a entidade carregar; laço fatiado (200 vasos: 88,8–91,3 ms → 4,1–4,2 ms por tick) |
| Mental Herb decidia pelo jogador mais próximo | `scripts/adaptacoes/mentalRestoration.ts` | Vale a maior chance de manter entre todos os jogadores da faixa |
| Redstone da panela lendo tudo de todo vizinho | `scripts/adaptacoes/potRedstone.ts` | `getAllStates`/`getRedstonePower` só onde importa (mesmo resultado); pré-filtro por `containsBlock` medido e descartado (mais caro) |
| Vaso trocado sem evento (`/setblock`, Wither) | `scripts/adaptacoes/decoratedPot.ts` | Confirmado em 2 visitas, solta o vaso com as decorações e o conteúdo |
| Validador não via o JSON mesclado | `tools/importer/{commandVisibility,validate}.ts` | Checagens sobre gerado + escrito à mão com o mesmo `deepMerge` do build |
| Cache negativo de estruturas sem limite real | `scripts/limitesB/vanillaStructures.ts` | Vencidos e mais antigos saem primeiro |
| Enfermeira curada de zumbi perdia a profissão | `scripts/limitesB/nurse.ts` | Casada com a entidade transformada; curada volta enfermeira (e "negociou"). Desvio: o aldeão zumbi dela fica sem família de profissão |
| `FormRejectError` na tela do vaso | `scripts/adaptacoes/decoratedPot.ts` | Rejeição = "fechou"; só avisa se o jogador ainda é válido |

## 1. Spawning (`scripts/spawning/**`, `tools/importer/spawns.ts`)

| Sistema | Status | Notas |
|---|---|---|
| Spawner (BestSpawner: buckets 94/5/0,5/0,2/boss 0,3, tipos de posição, pesos, condições e anticondições, weight multipliers, presets) | FEITO | Zona 16–64 blocos puxada pelo movimento, caps por 3×3 chunks, `maximumSpawnsPerPass`, `minimumDistanceBetweenEntities`, `maxVerticalSpace`, config lida a cada passe; gamerule `doPokemonSpawning` somada a `enableSpawning` |
| Herds (1700, líder/seguidores, `levelRangeOffset`, `maxHerdSize`) | FEITO | Tag `cobblemon_herd_leader` na criação; seguidores com `follow_mob` |
| Alfa (aspects, marca, moveset "alpha", escala, AlphaLevelMatchingSensor, recompensas) | FEITO | Recompensas ao derrotar: 40 tabelas `loot_table/alpha` convertidas (tier pelo nível + 2 chances pelo tipo primário, como o MoLang do upstream) em `pokemon/AlphaRewards.ts` |
| Pesca (591 entradas, `rodType`, `bait`, `minLureLevel`, buckets de pesca) | FEITO | `bucketTier` = rarity_bucket da isca + Luck of the Sea |
| Iscas (`spawn_bait_effects`, 79) e Poké Snack (isca de área, raio 8) | FEITO | Temperos da culinária viram iscas do Poké Snack |
| Tora de saccharine com mel (`SaccharineLogSlatheredInfluence`) | FEITO | `spawning/HoneyLog.ts`: registro por posição (sem POI no Bedrock); 5 % HA, `honeySlatherShinyChance`/`AlphaChance`, `honey_drenched`, arroto, a tora volta a comum |
| Despawn (CobblemonAgingDespawner) | FEITO | Por script; ignora batalha, montado, item segurado, `cobblemon:persistent`; `savePokemonToWorld=false` apaga selvagens ao recarregar |
| Shiny rate / nível / held items / drops por spawn | FEITO | `shinyRate <= 0` = nunca |
| Nível pelo time (`PlayerLevelRangeInfluence`) | FEITO | Desligado como no 1.8.2 (sobrescrito pelo `levelRange`) |
| Slime chunk, `timeRange`/`moonPhase` do 1.8.2 | FEITO | Algoritmo de slime chunk do Bedrock |
| Marcas em potencial do spawn e Mini/Jumbo | FEITO | Clima/hora/raras/personalidade; `spawnGivenMarks(alpha, categoria de tamanho)` |
| Habitats (`habitat_pools`, 51; estilos natural e ativado, fases, `activatedHabitatBuckets`) | FEITO | `scripts/spawning/Habitats.ts`; editor em criativo |
| Estruturas como condição (`structures`) | FEITO (aproximação) | Antes PARCIAL. Estruturas do Cobblemon por **marcador** (`cobblemon:structure_marker` em cada peça jigsaw → registro por chunk em `scripts/world/StructureRegistry.ts`), vilas vanilla por **heurística** (`scripts/world/Villages.ts`) e, nesta onda (limites-b), as outras vanilla por **assinatura de blocos por chunk** (`scripts/limitesB/{vanillaStructures,structureSignatures}.ts`): 14 assinaturas (monumento, cabana da bruxa, iglu, mansão, posto avançado, ruínas de trilha, ruína oceânica, portal em ruínas, cidade ancestral, cidade do End, fortaleza, bastião, fóssil do Nether) com consulta preguiçosa só para os ids pedidos, positivo persistido e negativo 10 min em cache. BDS com `/locate`: 10 estruturas → `true`, planície → `false`. O caminho exato (`Dimension.getGeneratedStructures`) só existe no beta 2.12. Desvios: o chunk conta pelos blocos da assinatura, não pela caixa do Java; **naufrágio e poço do deserto ficam sem detector** (assinatura fraca: a condição não cumpre); cabana e iglu só em teste unitário; estruturas do Cobblemon geradas antes do marcador não contam |
| `hasSpace` pela largura do hitbox | FEITO | Caixa exata do `AreaSpawnablePosition.hasSpace` |
| Comandos `checkspawn` / `spawnpokemonfrompool` (`forcespawn`) | FEITO | |
| Spawn rules (`D/spawn_rules`) | FEITO | Antes FALTA. `scripts/spawning/SpawnRules.ts`: motor do `CobblemonSpawnRules` (componentes `weight`, `filter`, `location`; seletores por expressão e `conditional`; MoLang `v.spawn_detail`, `v.spawnable_position`, `v.world.is_of`) ligado ao spawner do jogador. O exemplo do 1.8.2 vem embutido e desligado. Sem datapack no Bedrock: `/cobblemon:spawnrule list/enable/disable/add/remove` guarda as regras no mundo |

## 2. Captura e Pokédex (`scripts/catching/**`, `scripts/pokedex/**`)

| Sistema | Status | Notas |
|---|---|---|
| Fórmula (`CobblemonCaptureCalculator`, Float32, crítica, penalidade de nível, Pokédex) | FEITO | |
| 49 bolas (32 + 16 ancient + strange_ball do port), efeitos pós-captura (Heal/Friend/Luxury) | FEITO | Ancient com `throwPower`, 1 pulo; `liquid_inertia` = water drag |
| Sequência (quique, feixe, queda, sacudidas, crítica, sons com variantes `.ancient`) | FEITO / NÃO POSSÍVEL NO BEDROCK | Antes PARCIAL. Bug E2E-3 corrigido (bolas ignoram dano, E2E 4/4). Frente visual-final (`scripts/catching/CaptureSequence.ts`): sons `cobblemon.poke_ball.*` e variantes `.ancient` nos tempos das animações do Cobblemon (#101); feixe `cobblemon:recall_beam` com o Pokémon encolhendo/voltando por `cobblemon:scale_modifier`; `capturesparks`/`capturestar`/`afterspark` no sucesso, `hisui*` e `ancient_pokeball_smoke` na ancient, `<bola>_casual_sendflash` no escape (saíram `endrod`, `villager_happy` e as vanilla). Tinta vermelha do feixe: propriedade `cobblemon:beam_tint` + `overlay_color` em todos os render controllers de Pokémon (`scripts/pokemon/BeamTint.ts`, `tools/importer/entities.ts`), fórmula do `PokemonRenderer` (verde/azul 1 → 0,4 entre 0,2 e 0,44 s; `tests/tint.test.ts`). Escala não fica mais presa em 0,05 num abort (trabalhos canceláveis). NÃO POSSÍVEL NO BEDROCK: o vermelho clareia (`R·(1 − a) + a`), porque o `overlay_color` mistura e o `color` só vale em materiais de máscara, não no `entity_alphatest`; adaptação: verde e azul exatos. Desvio: acerto em bloco mantém `white_smoke_particle` (CLOUD sem par exato). Conferir no cliente |
| Captura em batalha (singles, ação forçada, `captureSucceeded`) | FEITO | Como o 1.8.2 (só singles); usa a mesma sequência (E2E-3 corrigido) |
| Marcas em potencial aplicadas na captura (`apply_marks`) | FEITO | `scripts/pokemon/Marks.ts` |
| Pokédex (visto/obtido por forma, 12 Pokédex exatas, 1098 entradas, contagens, comando) | FEITO | Tela no visual do Cobblemon: grade 5×5 com rostos, moldura na cor da Pokédex, entrada com perfil na plataforma do tipo, formas vistas, texto rolável (`scripts/pokedex/PokedexUI.ts`, `ui/pokedex.json`) |
| Scanner da Pokédex (zoom/overlay) | FEITO | Antes PARCIAL/NÃO POSSÍVEL. Zoom por `camera.setFov` (70 → 30 em 6 passos; a roda/hotbar vira zoom e o slot volta para a Pokédex; o Java vai de 80 a 10), overlay pelo actionbar com prefixo `cbS` (`ui/cobblemon_scanner.json`), modo scanner com agachar + usar (mirar 15 ticks registra). Som `scan_zoom_increment` a cada passo (`scripts/ui/studio/ScannerZoom.ts`). Conferir no cliente |
| Variações (`variations`/`displayAspects`) | FEITO | Seção "Variações" da entrada; o perfil pré-renderizado mostra a forma |
| Atril com Pokédex | FEITO | Exige agachar (o Bedrock não diz se o atril vanilla tem livro). Luz 13 enquanto alguém lê a Pokédex no atril (estado `cobblemon:emit_light`, como `LecternBlockEntity.hasViewer`) |
| Move Dex (golpes na Pokédex) | FEITO | Antes FALTA. `scripts/pokedex/MoveDex.ts` + botão "Golpes" na entrada: regras do `MovesLearnsetWidget` (nível pelo `highestLevel` da forma e das evoluções, TM travado sem aprender, ovo sempre), filtros Todos/Nível/TM/Ovo, ordem por nível/nome/tipo/descoberto, troca de forma e painel do golpe (PP, categoria, poder, precisão, efeito, descrição). `unlockAllMoveDexMovesByDefault` agora tem efeito e também libera os TMs na máquina |
| Filtros extras (montáveis, TM não descoberto, busca por habilidade/golpe/drops) | FEITO | Antes PARCIAL. `PokedexCategoryFilter` completo (Visto = visto ou capturado, como no Java; Montáveis; TM não descoberto) e `SearchFilter` por espécie/habilidade/golpe/drop (`scripts/pokedex/PokedexUI.ts`). O servidor não tem os nomes traduzidos: a busca usa o nome do Cobblemon/Showdown |

## 3. Batalhas (`scripts/battle/**`)

| Sistema | Status | Notas |
|---|---|---|
| Motor `@pkmn/sim`, selvagem, PvP por desafio | FEITO | |
| Singles / Doubles / Triples / Multi | FEITO | Multi pelo menu de interação e por `/pokebattle ... multi` (equipes: linha abaixo) |
| Equipes Multi (`TeamManager`: pedido de equipe pela roda de interação, `abandonmultiteam`) | FEITO | Antes FALTA. `scripts/battle/{TeamManager,Teams}.ts` portam `TeamManager.kt`, `RequestManager.kt` e a parte Multi do `ChallengeManager.kt`: convite de equipe (60 s, equipe de 2), desafio equipe → equipe (20 s, avisa os 4, qualquer membro aceita, raio 15, mesma dimensão) e batalha 2×2 (`startMultiBattle`). A roda vira o menu de interação de jogador (Formar grupo / Recusar / Batalha Multi / Abandonar grupo); `/cobblemon:abandonmultiteam` e alias. Sair do servidor tira da equipe e encerra a batalha (battle-leave). Sem os ícones de membros no HUD (cliente Java). Prova: `tests/multi.test.ts` e E2E `09-multi` com 4 bots |
| Treinadores NPC (StrongBattleAI, time fixo/pool/script/composed_pool, vitória/derrota, cooldown) | FEITO | `scripts/battle/ai/StrongBattleAI.ts`: porta inteira das 986 linhas (troca, dano, status, anti-boost, perigos, clima, Trick Room...) com as esquisitices do original e skill 0–5; RandomBattleAI para selvagens; 100 batalhas IA × IA sem escolha inválida |
| IA congelada durante a batalha | FEITO | `cobblemon:battle_start`/`battle_end` em Pokémon e NPC (o NPC mantém `float`) |
| Fim de batalha (`\|win\|` depois do desmaio) | FEITO | `outcomeDecided` impede `stopped`; `switchOut` aceita oponente/treinador inválido e tem local de envio de reserva |
| Fuga, desistência, `stopbattle` | FEITO | |
| Distâncias (`battleWildMaxDistance`, PvP, fuga) | FEITO | |
| EXP (participação, Exp. Share, Lucky Egg, trocado ×1,5), EVs, amizade em batalha | FEITO | |
| Mochila em batalha (poções, status, revive, éteres, X items, Dire Hit, Guard Spec, Poké Balls) | FEITO | |
| Aprender golpe novo (pergunta de troca) | FEITO | |
| Drops ao derrotar selvagem | FEITO | Gamerule `doPokemonLoot`, `defaultDropItemMethod`, `announceDropItems`, `dropAfterDeathAnimation` (30 ticks), `drops_reroll` da isca |
| Efeitos de golpe (`action_effects`), cry e faint na entidade; gestos do NPC | FEITO | Antes PARCIAL. 154 timelines traduzidas no import; o intérprete (`scripts/battle/effects`) toca animação do poser (`battle_<nome>` primeiro), 22 animações genéricas no `root_part`, partículas do Cobblemon nos locators (660 arquivos) e sons `move.*`/`impact.*` no tempo certo. NPC faz `command`/`lose`. Limites: partícula nasce no locator de repouso, sem "andar até o alvo" (`do_effect_walks`) |
| Partículas/sons de status e stat up/down (`-status`, `-boost`) | FEITO | Antes FALTA. Intérprete como o 1.8.2: `-boost`/`-unboost` → `statup`/`statdown`, `cant` → timeline do status (paralisia, sono, paixão), `-activate` → status (confusão, paixão) ou `activate_<id>` (Protect, Powder), `-start` → `start_<id>`, `-prepare` → `prepare_<id>`; dano de status distingue `tox`. `-status` não toca efeito, igual ao `StatusInstruction` do 1.8.2 |
| Música de batalha | FEITO | Antes NÃO POSSÍVEL (rótulo errado). `scripts/world/BattleMusic.ts`: `playMusic` em laço com fade por tipo (PvW/PvP/PvN). Os eventos `cobblemon.battle.*.default` são vazios como no 1.8.2 (N/A NO COBBLEMON para faixas): liga com `/scriptevent cobblemon:battle_music on` + um pack com as faixas |
| Espectador | FEITO | `/cobblemon:spectatebattle` |
| Batalha minimizável (`ClientBattle.minimised`, tecla R, aviso pulsante) | FEITO | Antes NÃO POSSÍVEL (#145). Modo `java` padrão (`scripts/battle/{BattleUiMode,BattlePromptHooks}.ts`): a tela abre sozinha só no início e enquanto a batalha está "aberta"; fechar/Fugir minimiza; minimizada não reabre (nem para a troca depois de desmaio, como o `BattleGUI` do Java); agachado + pular (tecla R do port) alterna; no celular, duplo toque em Pular. HUD: aviso do Cobblemon traduzido pela cauda rawtext do título, pulsando (2 s + 2 s), caixas esmaecidas a 0,5 e overlay do time escondido em batalha (também para espectador). Preferências por jogador `hud` (golpes acima da hotbar, só em singles) e `classic` em `/cobblemon:battleui`. Prova: `tests/batalha-minimizavel.test.ts`, E2E `10-batalha-minimizavel` (10/10 cenários). Desvios: a tela continua um form modal (sem andar com ela aberta), sem fade de 0,25 s nas caixas, o pulso não reinicia a cada request, sem message pane minimizado. Conferir no cliente |
| Tela de batalha fiel (tiles, retratos, HP) | FEITO | Antes NÃO POSSÍVEL. Forms roteados por marcador: tiles Lutar/Mochila/Pokémon/Fugir, golpes pintados pelo tipo com PP/categoria/efetividade, alvo, troca com retratos e barras, mochila em grade (`ui/battle.json`). HUD de batalha persistente no canal título (`scripts/ui/BattleHud.ts`). Sem a faixa do ator, sem deslizar as caixas. Conferir no cliente |
| PvP de nível fixo (5/50/100) | FEITO | Antes PARCIAL. Tela da regra depois do formato no menu de interação (ordem do `BattleConfigureGUI`) para simples/dupla/tripla/Multi e `/cobblemon:pokebattle <jogador> [formato] [nível]`; cópias no nível e curadas (`adjustLevel`), o time real não muda; quem é desafiado vê a regra no chat. Lead do PvP 1×1 = Pokémon em campo ou selecionado (review-fixes). Prova: `tests/multi.test.ts`, E2E `09-multi` (Multi nível 50, `/pokebattle` nível 100) |
| Sketch permanente | FEITO | Antes FALTA. `-activate …\|move: Sketch\|<golpe>` troca Sketch pelo golpe no `PokemonData` (proporção de PP; Sketch vai para os guardados) e salva; o clone de batalha não afeta o real. Corrigidos no caminho: `Effect.typelessData` cortava a 1ª letra de efeitos sem prefixo e o `-activate` ia para o fim da fila |
| Visual de Illusion / Transform / Imposter | FEITO | Antes FALTA. `showdown.ts` mantém a identidade real do Pokémon com Illusion e manda o disfarce em `[is]` (formato do fork do Cobblemon). Em campo, uma entidade de exibição da espécie do disfarce ou do alvo (`scripts/battle/effects/Mock.ts`) fica no lugar do real, que fica invisível e sem rótulo; mensagens, Pokédex, alvos e HUD de batalha mostram o disfarce a quem não é aliado. `replace`, desmaio, recolha e fim da batalha tiram o efeito. Desvio: o selvagem transformado volta ao normal no fim (no Java o efeito fica salvo) |
| Envio com bola e recolha com feixe | FEITO | Antes FALTA. `scripts/battle/SendOut.ts`: `poke_ball.throw`, bola em arco por 0,5 s com `poke_ball.trail`, estouro com as partículas da bola, o Pokémon cresce em 0,4 s; recolha com feixe vermelho (`cobblemon:recall_beam`) e encolhimento. Posição de envio por slot (`getSendOutPosition`) virada para o oponente. Fora de batalha também (menu do time, menu rápido, envio rápido: `scripts/pokemon/SendOutAnimation.ts`). Desvio: `poke_ball.recall` toca quando o Pokémon some, não no início do feixe. Tinta vermelha na recolha (em batalha e fora dela) desde a onda de fechamento (`setBeamTint`; ver §2) |
| Balsa na água | FEITO | Antes FALTA. `scripts/battle/Platform.ts` + entidade `cobblemon:battle_platform` (5 tamanhos, geometria e textura do Cobblemon). Regra do Cobblemon: Pokémon com dono na água, sem estar submerso, que não respira debaixo d'água, não anda na água e não voa; sai ao pisar em terra, ao sair de campo e no fim da batalha. Conferir a orientação no cliente |
| Tipo efetivo de Hidden Power/-ate/Normalize na tela, mensagem de troca no log | FEITO | Antes FALTA. `GUI/Battle.ts` pinta o tile e a dica de efetividade pelo `getEffectiveElementalType`; `switch.self`/`switch.other`/`withdraw.*`/`dragged_out` chegam a cada jogador certo |
| Limpeza e corridas da batalha | FEITO | Revisão final: balsas e entidades de exibição de Illusion/Transform são removidas ao carregar o mundo/chunk e na captura; cancelar um envio libera a fila da batalha; um Pokémon que entra em batalha durante a recolha não é tirado de campo. Jogador que sai no meio de PvP/Multi encerra a batalha na hora sem erro (ver "Correções da onda de fechamento") |

## 4. Dados do Pokémon (`scripts/Pokemon.ts`, `scripts/pokemon/**`)

| Sistema | Status | Notas |
|---|---|---|
| IVs/EVs, naturezas, Mints, Hyper Training | FEITO | |
| Habilidades (slot preservado, HA, Capsule/Patch) | FEITO | HA nunca sorteada no spawn (como o 1.8.2) |
| Formas/aspects (regionais, features, hitbox/escala por forma) | FEITO | Features inteiras (`gimmighoul_coins=999`) e de escolha (`netherite_coating=stageN`) no `PokemonProperties`; `weighted_choice` (Dudunsparce, Maushold) |
| Moveset (nível, guardados, TMs, relearner, PP Up/Max) | FEITO | |
| Amizade | FEITO | |
| Marcas | FEITO | `mark_partner` pela distância medida por script |
| Item segurado → Showdown; itens proibidos | FEITO | Caixas de shulker e bolsas recusadas (`held/container_held_items`); encantamento/nome de item segurado se perdem (armazenado por id) |
| `tradeable`, `tradeFriendship` | FEITO | |
| Cosméticos (`cosmetic_items`, 29) | FEITO | |
| Tamanho intrínseco/bebê | FEITO | Visual por `cobblemon:scale_modifier` (conferir no cliente) |
| Fome/saciedade (`fullness`, metabolismo) | FEITO | `pokemon/Fullness.ts`: barriga pelo peso, metabolismo por velocidade/BST, som `berry.eat.full`; cheio recusa berries/mochis/Aprijuice. Comer a berry segurada: N/A (só com behaviours de Pokémon fora do time) |
| Cura do time ao dormir | FEITO | `pokemon/SleepHeal.ts` (+50 % HP, status, metade do PP) pelo pulo da noite |
| Tera Type (`teraTypeRate`) | FEITO | Só dado, como o 1.8.2 |
| Cauda do Smeargle (Characteristic), tingir Wooloo/Dubwool/Conkeldurr, Tasty Tail | FEITO | |
| Cura passiva fora de batalha, timer de desmaio, `passiveStatuses` | FEITO | `scripts/pokemon/PassiveHealing.ts` |

## 5. Evolução (`scripts/evolution/**`)

| Sistema | Status | Notas |
|---|---|---|
| level_up / item_interact / trade / block_click + requisitos | FEITO | `blocks_traveled` (contador real, `pokemon/BlocksTraveled.ts`), `advancement` (consulta as conquistas reais), `property_range`, `structure` (consulta do registro de estruturas) deixaram de ser "sempre verdadeiros" |
| Evoluções passivas (a cada segundo) | FEITO | Eevee de dia, Pawmot, Gholdengo fora do level-up |
| Gimmighoul → Gholdengo (stash de moedas) | FEITO | Relic Coin/Pouch/Sack e netherite |
| Shedinja ("shedder") e drops de evolução | FEITO | Shed Shell, Shell Helmet (Karrablast/Shelmet em single-player) |
| Everstone, confirmação, aviso | FEITO | |
| Animação de evolução | FEITO | Emissor `cobblemon:evo_particles` + som + troca de modelo. Estúdio de câmera na cena: N/A NO COBBLEMON (a evolução do Cobblemon não tem câmera própria) |

## 6. Entidades (`scripts/entity/**`, `scripts/world/**`, `tools/importer/entities.ts`)

| Sistema | Status | Notas |
|---|---|---|
| Movimento por `behaviour`, IA selvagem x com dono, pânico/retaliação | FEITO | |
| Dano corpo a corpo por Pokémon | FEITO | Antes NÃO POSSÍVEL. `scripts/world/PokemonDamage.ts` (`beforeEvents.entityHurt`): dano × curva do Ataque, armadura pela Defesa, `playerDamagePokemon` |
| Posers e animações | FEITO | 308/308 posers Kotlin convertidos para dados (0 de reserva); 894 espécies (+8); `pitch_tilt`, look compensado, procedurais do Kotlin; 36 texturas animadas; `root_part`. Emissivos: PARCIAL (sem `is_hurt_color` na camada, sem Vibrant Visuals) |
| Sono (DrowsySensor, luz, cama do dono) | FEITO | |
| Montaria terra/ar/água (ride_settings) | FEITO | Antes PARCIAL. Molang de montaria (`q.r.*`, molas), câmera `follow_orbit`/`fixed_boom`, agachar não desmonta no ar/água (2× desmonta), roll visual por `cobblemon:roll`, `minimumRidingScale`. Ride boosts (`scripts/pokemon/RideStats.ts`: faixas, bônus da Aprijuice, velocidade e fôlego aplicados em `scripts/entity/Riding.ts`), sons `ride.loop.*` com volume/tom pela velocidade (`RideSounds.ts`; reinicia por faixa de volume, porque o Bedrock não muda o volume de um som tocando) e overlay de controles na actionbar (`scripts/ui/RideControls.ts`, `displayControlSeconds`, padrão 0 como no 1.8.2). Sprint na terra (#33, limites-a): port do `HorseBehaviour` em `scripts/entity/RideSprint.ts` com duplo toque para frente em 7 ticks (o gatilho do Java; a tecla de correr não chega ao script montado), fôlego, aceleração, FOV × 1,15 e barra de fôlego na actionbar, nas 54 espécies `cobblemon:land/horse` com `canSprint` (BDS: 1,2 → 7,1 b/s). Velocidade corrigida (review-fixes rodada 2): terra sem sprint usa o `getWalkSpeed` do Java (`walkMovementValue`, sem o fator 0,8 errado; BDS Altaria 1,12–1,16 b/s = Java 1,12). Freelook: FEITO (aproximação) com `/scriptevent cobblemon:ride_camera freelook` (ver #38). NÃO POSSÍVEL NO BEDROCK: roll da câmera nativa (presets e `setCamera` só yaw/pitch; o modo `roll` por splines está pronto e desligado até conferir no cliente), pulo com bônus (`horse.jump_strength` não é exposto a scripts) e o FOV relativo do sprint (`Camera.setFov` só aceita valor absoluto: base 70 × 1,15 = 80,5). Ar e água: velocidades aproximadas |
| Ombro | FEITO | |
| Interações (167) com cooldown | FEITO | |
| Som ambiente, tamanho por forma/Alfa | FEITO | Altura dos olhos: NÃO POSSÍVEL NO BEDROCK (sem componente nem API; hitbox por grupo) |
| Mobs vanilla fugindo de Pokémon no ombro | FEITO | Conferir no cliente |
| Brilho e som de shiny selvagem | FEITO | `pokemon/ProximityEffects.ts` (`shinyNoticeParticlesDistance`), partículas do Cobblemon sem som embutido |
| Rótulos (`displayEntity*Label`, "???") | FEITO | Aproximação: o `nameTag` é global, vale o jogador mais perto |
| Luz dinâmica (`lightingData`) | FEITO | Antes FALTA. `scripts/entity/DynamicLight.ts`: `minecraft:light_block_<n>` seguindo a cabeça a cada 5 ticks (70 espécies com dado + formas), modos LAND/UNDERWATER/BOTH, Pokédex na mão = 13. As posições são gravadas em propriedades do mundo divididas em partes (a cada tick com mudança) e limpas ao recarregar ou quando o chunk volta. `/scriptevent cobblemon:dynamic_lights off\|on`. Desvio: no Java isso só existe com um mod de luz dinâmica |
| Item segurado visível e vestíveis | FEITO | Antes FALTA. Item segurado: cópia visual na mão secundária (drop 0) desenhada no locator `item` (753 geometrias); 356 espécies não têm o locator no Cobblemon e também não desenham no Java. Vestíveis: 17 itens com `minecraft:wearable` e attachable no jogador; no Pokémon, âncoras `cobblemon_anchor_hat`/`face` levadas aos locators `item_hat`/`item_face`. Desvio: pilha 1 no slot de cabeça. Conferir no cliente |
| Imunidades (raio, gelo, neve fofa, sweet berry, teia) | FEITO | Antes FALTA. Raio: Terra imune; Lightning Rod, Motor Drive e Volt Absorb com o efeito do `LightningBoltMixin`; Mooshtank troca de cor. Tipo Gelo e `freezeImmune` sem congelamento; Vulpix em pé na neve fofa e sem dano do sweet berry bush. Teia nas aranhas (`immuneToCobwebBlock`, 8 espécies): antes NÃO POSSÍVEL, agora FEITO com `minecraft:block_movement_slowdown_immunity` (estável no 26.50; `tools/importer/entities.ts`, `format_version` 1.26.50). BDS: spinarak/galvantula/ariados caem 10,2 blocos por 10 teias, caterpie 0,46 |
| Comportamentos de espécie (Combee, raposa, pegar itens) | FEITO | Antes FALTA. Combee poliniza (flores → folha de saccharine ou colmeia, partícula de néctar; aproximação: não entra na colmeia). Vulpix pega 1 item na boca, come comida e colhe sweet berry; só pega pilhas comuns (sem nome, lore, encantamento, desgaste ou conteúdo); o item da boca impede o despawn e cai no chão na captura. `picks_up_items`/`gets_mad_at_thrower`: N/A NO COBBLEMON (nenhuma espécie do 1.8.2 usa; o gancho está pronto) |

## 7. Mundo, máquinas e culinária

| Sistema | Status | Notas |
|---|---|---|
| Berries (crescimento, mutação, mulch, colheita, flores/frutos visíveis) | FEITO | |
| Cultivos, raízes, tumblestone, gemas, saccharine | FEITO | |
| Apricorns | FEITO | Antes PARCIAL. Soco no apricorn maduro colhe (loot da cor, volta à idade 0, som); semente na lateral da folha planta o apricorn virado para ela; mudas em vaso |
| Pasto | FEITO | Antes PARCIAL. Luz 13 ligado, sons, retratos por variante. Atacar hostis por IA: grupo `cobblemon:pasture_conflict` (`nearest_attackable_target` contra `monster` sem creeper/slime/magma cube/piglin + `melee_box_attack`), ligado só enquanto o hostil mais próximo está dentro da área (`scripts/machines/pastureConflict.ts`; BDS: husk morto em 4–6 s). Dono em itálico (`§7§o`) numa segunda linha (o form não tem hover). Desvio: o `must_see` do componente não é reproduzido |
| Fósseis (analisador + monitor + tanque) | FEITO | 11 sons do Cobblemon; feto no tanque: entidade `cobblemon:fossil_fetus` dos 19 modelos, curvas de crescimento e animação do poser (desvio: vira para a frente do tanque). Conferir no cliente |
| Máquina de TMs | FEITO | Sons certos, laço de queima, tampa fecha com algo em cima |
| Panela na fogueira | FEITO | Antes PARCIAL. Receitas, temperos, sons, `broth_bubbles`. Adaptacoes: funil por script (`scripts/adaptacoes/potHoppers.ts`: em cima → temperos, de lado → grade, embaixo puxa só o resultado; 1 item a cada 8 ticks), comparador por `minecraft:redstone_producer` nas permutações da fogueira (`CAMPFIRE_COMPARATOR`, `tools/importer/adaptacoes.ts`) e tampa por redstone lida dos 6 vizinhos com as regras do Java (`potRedstone.ts`), porque o `redstone_consumer` anulava o produtor e fechava a tampa com a própria saída. BDS com bot conectado: comparador 7 → fio 6, alma 10 → lâmpada, também depois de reiniciar. Desvios: só comparador encostado e virado para a panela, sinal em até 8 ticks, pilhas com dados extras não entram pelo funil |
| Healing Machine | FEITO | Carga, `healersHealPC`, sons, partículas, luz quando cheia. Comparador feito (#143: sinal do Java 0–10 pela carga, técnica da panela). NPC usa sem gastar carga (PARCIAL). Variante "natural" das estruturas (estado `cobblemon:natural`, textura `healing_machine_limited`, solta 1–4 barras de ferro) |
| Baú dourado / Gimmighoul chest | FEITO | Antes PARCIAL. Contêiner real por entidade invisível com inventário (`cobblemon:gilded_chest_storage`): UI de baú, funil, NBT preservado; 4 golpes quebram; sons de abrir/fechar. Clique: conferir no cliente |
| Vitrine / estante de discos / atril | FEITO | ItemStack real (vitrine 1 espaço, estante 14); dados antigos migram. Vitrine sem brilho de encantamento no modelo. Estante com discos visíveis (entidade `cobblemon:disc_shelf_display`, 14 quadros, 47 texturas) e sequenciador de note block (desvio: a nota do próprio note block também toca). Atril com Pokédex emite luz 13 |
| Waterlogging de blocos custom | FEITO | Antes NÃO POSSÍVEL. `minecraft:liquid_detection` nas 23 classes do Cobblemon + lajes/escadas/cercas/muros/alçapões/folhas |
| Habitat block | FEITO | |
| Estruturas (fósseis, ruínas, habitats, barcos, enseadas de naufrágio) | FEITO | Antes enseadas NÃO POSSÍVEL. Jigsaw data-driven estável: 65 estruturas, 1.179 peças, 214 pools, 9 structure sets, `/locate` funciona; 43 features de molde. Conferir a rotação das juntas verticais |
| Vilas do Cobblemon | FEITO (adaptação) | Injeção nos pools da vila vanilla: NÃO POSSÍVEL NO BEDROCK (pesquisa 8 §12: as vilas são jigsaw legado, "cannot be modified via JSON"). Adaptação: as peças que o Java injeta viram estruturas jigsaw próprias do mod (`tools/importer/villages.ts`): `cobblemon:village_pokecenters_<bioma>` (o Pokécenter do bioma), `cobblemon:village_habitats_<bioma>` (um dos 6 mini-habitats, peso 1 cada) e `cobblemon:village_berry_farms_<bioma>_<small\|large>` (as 2 fazendas de berries do `addBerryFarms`; o processador `crop_to_berry` vira 15 variantes da peça, uma por par de berries, cada trigo vira uma berry do par com idade 1–3), nos biomas de `#minecraft:has_structure/village_<bioma>`, com `beard_thin`, a camada 0 no nível do chão e marcador no StructureRegistry (condições de spawn). Frequência = vilas do tipo × peças por vila, pelos pesos do pool de casas (JSON + Kotlin, Pokécenter limitado a 1 e fazendas a 2) com N = 10 peças de casa por vila: Pokécenter em ≈ 100 % das vilas → spacing 34 / separation 8 (o das vilas); mini-habitats 0,17–0,28 por vila → spacing 65–82; fazendas 0,11–0,18 por vila (metade para cada molde) → spacing 112–142 (conta e sensibilidade a N em `docs/pendencias/vilas.md`). Portas do Cobblemon nas estruturas com as duas metades e a direção do molde (`bedrockStateFor`). BDS: `/locate` acha as 20 (Pokécenters e mini-habitats na frente vilas, fazendas e Pokécenters de novo na vilas2); Pokécenters de taiga, neve e deserto com 100 % dos blocos do molde (portas incluídas; antes 98–99,6 %), 5 mini-habitats com 85–100 % e as 10 fazendas com 100 %, no nível do chão. Desvios: o structure_set do Bedrock não tem exclusion zone (pode cair dentro de vila vanilla: 1 das 10 visitadas); cada peça fica sozinha, não ligada à rua; a porta de dobradiça direita sai como a esquerda (o Bedrock do mod só tem a `_left`). O Pokécenter por script junto de vilas novas ficou desligado (`/scriptevent cobblemon:village_pokecenters on` religa) |
| Injeções de loot em baús/pesca vanilla (`LootInjector`) | FEITO | 23 tabelas vanilla sobrescritas |
| Redstone dos decorativos (botões e placas de madeira, Eject Button, Ring Target) | FEITO | Metronome: comparador feito (#74: 4 quando ativo, técnica da panela) |
| Barcos de apricorn/saccharine | FEITO | Aproximação: `runtime_identifier` `minecraft:boat`/`chest_boat` com textura do Cobblemon |
| Wallpapers do PC | FEITO | Antes PARCIAL. Papel de parede na tela inteira (174×155) e camada `glow` (`wallpaper_glow_<basic\|biome\|misc>` no `ui/pc.json`, gerador `tools/ui/gen-telas.ts`); a caixa sem escolha mostra `basic/wallpaper_basic_05`, o padrão do Java (`scripts/GUI/PCWallpapers.ts`). Conferir no cliente |
| Advancements (conquistas) | FEITO | Antes NÃO POSSÍVEL. Conquistas nativas: NÃO POSSÍVEL NO BEDROCK. Adaptação: 61 conquistas (5 raízes, 56 objetivos) com a semântica dos critérios do Kotlin, toast no HUD, chat e tela `/cobblemon:advancements` (lista recuada pela profundidade no lugar da árvore por aba). `max_ride_stats` avança ao montar |
| Estatísticas de jogador (`CobblemonStats`) | FEITO (adaptação) | Antes FALTA. `scripts/events/PlayerStats.ts` + `StatHandler.ts`: os 21 registros; 19 sobem como no 1.8.2 e `battles_lost`, `pokemon_interacted_with` e ovos ficam 0 como lá. Tela vanilla de Estatísticas: NÃO POSSÍVEL NO BEDROCK; adaptação: `/cobblemon:stats [jogador]` |
| Detalhes de mundo (compostagem, vasos, Fortuna, espeleotema, escambo, tags de comida, abas do criativo, inflamáveis, pérola do ender) | FEITO | Frente mundo-detalhes; detalhes em §10. `bee_growables`: antes NÃO POSSÍVEL, agora FEITO por script (`scripts/adaptacoes/bees.ts`, ver #108). Dispenser com tesoura/mel/água, vaso decorado com sherds, pinturas, fazendeiro e estruturas vanilla: ver #31, #10, #30, #136 e §1 |

## 8. Social (`scripts/npc/**`, `scripts/trade/**`)

| Sistema | Status | Notas |
|---|---|---|
| NPCs (classes, presets, skins, nomes, editor, comandos) | FEITO | Nome localizado por jogador (chat/diálogo); hitbox configurável quantizada (300 grupos); `/cobblemon:npcdelete [alvo]` pelo console |
| Behaviours de NPC (andar, olhar, lutar, curar, conversar) | FEITO | Aproximação: grupos de componentes vanilla + tarefas de script; voltar para casa teleporta; `standard` fica parado como no 1.8.2 |
| Times de NPC (fixo, pool, `script`, `composed_pool`) e `start_battle` | FEITO | `movesetBuilders` das entradas não aplicados |
| Diálogos (4 do Cobblemon, MoLang do servidor) + gibber | FEITO | Retrato do NPC no diálogo: FALTA (forms não desenham modelo) |
| Troca entre jogadores | FEITO | Som `gui.trade`; cada atualização reabre a tela dos dois (UX, não paridade) |
| Menu de interação jogador→jogador | FEITO | |
| Trocas com aldeões e vendedor ambulante | FEITO | Profissão Enfermeira: antes NÃO POSSÍVEL, agora FEITO (aproximação) por override do `villager_v2` + script (limites-b; ver #99 e #113) |
| Skin de jogador em NPC (`applyplayertexture`) | FEITO (adaptação) | Confirmado na pesquisa 8 §13: `Player` não tem membro de skin no estável nem no preview 26.60; `getPlayerSkin`/`SimulatedPlayer.setSkin` só no `@minecraft/server-gametest` (beta) e devolvem persona, não textura; `q.skin_id` não dá a textura. Adaptação: skin escolhida por hash do nome num conjunto (Steve, Alex e treinadores), com `model-default`/`model-slim`. Aceito pelo usuário: o NPC cumpre o papel com skin do conjunto fixo. |
| NPC com modelo de Pokémon | FEITO (aproximação) | Antes NÃO POSSÍVEL. Limites-a (`scripts/npc/{PokemonModel,PokemonModelData}.ts`): entidade de exibição da espécie montada no NPC (dist 0), com o modelo do NPC escondido por `part_visibility`; liga pelo resourceIdentifier do Java (classe/preset, behaviour `cobblemon:npc/resource_identifier` no `/npcedit` ou MoLang `q.entity.set_resource_identifier`); escala, hitbox da espécie, rotação, clique/dano/diálogo/batalha pelo NPC, `in_battle` espelhado (review-fixes rodada 2), recriada depois de reinício e recarga de chunk. Desvios: a cabeça não gira sozinha (o corpo inteiro vira), a animação de andar da exibição não foi conferida, a hitbox vira a da espécie. Conferir no cliente |
| NPC escondido por jogador | FEITO | Antes NÃO POSSÍVEL. `scripts/npc/NpcHide.ts`: dados MoLang `hide == 1` (como no Java) e tag `cobblemon_see_hidden_npcs`; override de propriedade por jogador (`player_update_entity_overrides` só para quem não vê), rótulo por `TextPrimitive` só para quem vê, clique e dano cancelados. BDS com 2 bots: forms ao clicar Lim=0, Viz=1. Review-fixes rodada 2: o nome volta ao desfazer (também depois de /reload) e a exibição recriada já nasce escondida. Desvios: sombra e empurrão continuam (sem API por jogador); a exibição encolhe a 5 % em vez de sumir |
| `isMovable`/`isLeashable`/`allowProjectileHits` | FEITO / NÃO POSSÍVEL NO BEDROCK | Antes PARCIAL. `scripts/npc/NpcFlags.ts`: valor do NPC (MoLang `set_movable`/`set_leashable`/`set_allow_projectile_hits`) ou da classe/preset liga os grupos `npc_pushable`/`npc_not_pushable`, `npc_leashable` e `cobblemon:projectile_hits` (estado aplicado guardado; só dispara quando muda). NÃO POSSÍVEL NO BEDROCK: o projétil atravessar o NPC (o projétil para na entidade; não há filtro de colisão por entidade); adaptação: o projétil não fere. Prova: BDS `dadosia_npc`/`dadosia_leash` |

## 9. Interface, HUD e comandos (`scripts/GUI/**`, `scripts/ui/**`, `scripts/commands.ts`)

| Sistema | Status | Notas |
|---|---|---|
| Infra de UI (texturas de GUI, glifos, roteamento, CI) | FEITO | 735 texturas de GUI do Cobblemon + 237 derivadas; glifos em `E2`/`E3`; forms roteados por marcador invisível no título; `tools/check-ui-baseline.mjs` contra bedrock-samples |
| Party overlay | FEITO | Antes "HUD na actionbar". Canal título + `ui/cobblemon_hud.json` (`scripts/ui/PartyOverlay.ts`); `/cobblemon:partyhud [ligado] [overlay\|text]`. "+N EXP" e rolo de level-up no retrato com `gui.levelup_start`/`gui.levelup` (a EXP de batalha vai para o overlay; sem ele, para o chat). Some durante a batalha, para participante e espectador (`CobblemonClient.kt:423-432`; `scripts/GUI/PartyHud.ts`). Sem ícone do item segurado. Conferir no cliente |
| Pokémon selecionado e envio rápido (tecla R, setas do overlay) | FEITO | Adaptação sem teclas próprias: agachado + pular = R (em batalha, minimiza/reabre a tela; no celular, duplo toque em Pular); agachar 2× = próximo (em batalha não troca); `/cobblemon:sendout`, `/cobblemon:selectslot` |
| Resumo | FEITO | Perfil 128 px, abas Info/Golpes/Atributos/Marcas, estúdio 3D/2D, saciedade, passos, stash. 6 markings editáveis (3 estados, texturas `icon_marking_*`), grito ao tocar no retrato/modelo 3D e página de montaria na aba Atributos (por estilo: valor/máx e % de bônus) |
| PC | FEITO | 40 caixas (padrão do 1.8.2), 6×5 com rostos, coluna do time, nome da caixa, papel de parede, prévia (markings, natureza, habilidade, IVs, EVs). Ordenar (`PokemonSortMode`: nome, nível, tipo, nº, gênero; crescente/decrescente), filtro `Search.of` (nome parcial, `!`, holding/fainted/legendary/mythical/ultrabeast, propriedades) que escurece quem não passa, reabre na última caixa vista; sons `pc.grab/drop/release` |
| Inicial | FEITO | Carrossel por categoria (ordem `order`), plataforma do tipo, estúdio 3D |
| Retratos | FEITO | Antes NÃO POSSÍVEL. Rasterizador offline no importador: 8.219 PNG (retrato 64, ícone 32, perfil 128) com o enquadramento do Cobblemon, por variante |
| Modelo 3D nas telas | FEITO | Antes NÃO POSSÍVEL. "Estúdio de câmera": a espécie é spawnada fora da vista e a câmera `free` a enquadra atrás de um form vazado (inicial e resumo) |
| Toasts | FEITO | Antes NÃO POSSÍVEL (sem API de toast). Toast próprio no HUD; o Cobblemon não tem toast de captura/evolução |
| Config do Cobblemon | FEITO | Antes os 21 campos "mortos" não tinham efeito; agora todos são lidos, e 5 de cliente Java ficam só informativos. Config do port `enableDebugProbes` (padrão desligado) guarda as sondas de depuração |
| Gamerules do Cobblemon (6) | FEITO | Adaptação (o Bedrock não registra gamerule de add-on): dynamic property + `/cobblemon:cobblemongamerule`. `mobTargetInBattle`: PARCIAL (cancela o dano do mob em vez de tirar o alvo) |
| Comandos do Cobblemon (ver `docs/COMANDOS.md`) | FEITO | Novos: `/cobblemon:advancements`, `/cobblemon:sendout`, `/cobblemon:selectslot`, `/cobblemon:technicalmachine`, `/cobblemon:stats`, `/cobblemon:spawnrule`, `/cobblemon:rideboost` (admin, testes de montaria), `/cobblemon:battleui` (modo da tela de batalha; ver "Batalha minimizável" em §3). `abandonmultiteam`: ver "Equipes Multi" em §3. Give: itens escritos à mão (`strange_ball`, vaso decorado) entram no `/give` com `menu_category` visível; `npm run validate` acusa item invisível aos comandos (`tools/importer/commandVisibility.ts`, frente give) |
| Textos do port | FEITO | Seções por frente no fim dos `.lang` (en_US e pt_BR) |

## 10. Lacunas da auditoria ([pesquisa 5](pesquisa/5-auditoria.md)) e status atual

Cada linha é uma lacuna ou divergência apontada pela auditoria (seção entre parênteses), sem repetição.

### 10.1 Changelogs 1.5 → 1.8.2

| # | Lacuna | Status | Como / onde |
|---|---|---|---|
| 1 | Stash do Gimmighoul → Gholdengo (§2.1) | FEITO | `pokemon/SpeciesFeatures.ts`, `FeatureInteractions.ts` |
| 2 | Vivillon Poké Ball exige `collect_all_vivillon` (§2.1) | FEITO | Requisito `advancement` consulta as conquistas (`setAdvancementLookup`) |
| 3 | Colher apricorn com soco (§2.1) | FEITO | `entityHitBlock` no apricorn maduro → loot da cor, idade 0, som |
| 4 | Semente de apricorn na lateral das folhas (§2.1) | FEITO | Face lateral da folha → apricorn idade 0 virado para ela |
| 5 | Visual de Illusion/Imposter/Transform (§2.1) | FEITO | Entidade de exibição (`battle/effects/Mock.ts`); ver §3 |
| 6 | Arremesso ao enviar + VFX por bola (§2.1, §3.0) | FEITO | `battle/SendOut.ts`, em batalha e fora dela |
| 7 | Luz dinâmica (`lightingData`, 88 espécies) (§2.1) | FEITO | `entity/DynamicLight.ts` (70 espécies importadas + formas; as outras não estão implementadas no 1.8.2) |
| 8 | Resource packs embutidos: viés regional, Gyarados Jump, shiny únicos (§2.1) | FEITO | `tools/importer/embeddedPacks.ts`: `gyaradosjump` e `regionbiasforms` ligados por padrão (como no Cobblemon), `uniqueshinyforms` com `COBBLEMON_PACKS=...`; `adorncompatibility` exige o mod |
| 9 | Tingir Wooloo/Dubwool (+ Conkeldurr) (§2.1) | FEITO | Corante / balde de água |
| 10 | Sherds em vaso decorado (§2.1, §4.7) | FEITO (aproximação) | Antes NÃO POSSÍVEL. Vaso próprio `cobblemon:decorated_pot` (`scripts/adaptacoes/{decoratedPot,decoratedPotLogic,sherds}.ts`, `tools/importer/adaptacoes.ts`): corpo liso do vaso vanilla + entidade que desenha os 4 lados com os 6 sherds do Cobblemon e os 23 vanilla. A grade de criação não chama scripts: usar a mesa de trabalho segurando um sherd do Cobblemon (sem agachar) abre a tela do vaso (fundo, esquerda, direita, frente); só sherds vanilla continuam no vaso vanilla da grade. Guarda 1 pilha, funil, comparador, quebra/Toque Suave/explosão/flecha como no Java; `/give` aceita. Review-fixes rodada 3: entidade órfã removida, laço fatiado (200 vasos: 4,1 ms por tick), `/setblock destroy` solta vaso + conteúdo. Desvios: sem balançar, pistão não quebra, ícone liso. Conferir no cliente os lados e a tela |
| 11 | Leftovers ao comer maçã (`appleLeftoversChance`) (§2.1) | FEITO | 5 maçãs da tag `held/leaves_leftovers` |
| 12 | Spawn rules (§2.1) | FEITO | `spawning/SpawnRules.ts` + `/cobblemon:spawnrule` |
| 13 | Feto no tanque de restauração (§2.1) | FEITO | `machines/fossilFetus.ts`; conferir no cliente |
| 14 | Propriedades `originaltrainer=`/`originaltrainertype=` (§2.1) | FEITO | `scripts/PokemonProperties.ts` com todas as chaves do `PokemonProperties.kt` 1.8.2 |
| 15 | Shedinja por "shedder" (§2.2) | FEITO | `evolution/EvolutionDrops.ts` |
| 16 | Drops de evolução (§2.2) | FEITO | |
| 17 | PvP de nível fixo 5/50/100 (§2.2) | FEITO | Tela da regra no menu de interação e `/pokebattle [formato] [nível]`; ver §3 (frente multi) |
| 18 | Balsa para Pokémon em batalha na água (§2.2) | FEITO | `battle/Platform.ts` |
| 19 | Envio virado para o oponente, posição por slot (§2.2) | FEITO | `getSendOutPosition` do ActiveBattlePokemon; o Pokémon vira para o oponente |
| 20 | Brilho/som de shiny selvagem (§2.2, §3.0) | FEITO | |
| 21 | Rótulos configuráveis e "???" (§2.2) | FEITO | Aproximação pelo jogador mais perto |
| 22 | Gamerules `battleInvulnerability`, `mobTargetInBattle` (§2.2) | FEITO / PARCIAL | `mobTargetInBattle` cancela o dano |
| 23 | Propriedades `aspect`/`unaspect`, `type`, `no_ai`, `freeze_frame` (§2.2) | FEITO | `no_ai`: adaptação (movimento 0 + tag; o Bedrock não desliga a IA por script). `freeze_frame`: guardado e comparado; efeito visual NÃO POSSÍVEL NO BEDROCK (animação do cliente) |
| 24 | Golpe copiado por Sketch fica depois da batalha (§2.2) | FEITO | Ver §3 |
| 25 | Tipo efetivo de Hidden Power/-ate/Normalize na UI (§2.2) | FEITO | `GUI/Battle.ts` pelo `getEffectiveElementalType` |
| 26 | Mensagem de troca no log (§2.2) | FEITO | `switch.*`, `withdraw.*`, `dragged_out` |
| 27 | Som da troca entre jogadores (§2.2) | FEITO | `cobblemon.gui.trade` |
| 28 | Callbacks MoLang genéricos, `q.has_aspect` em posers JSON (§2.2) | FEITO | `q.has_aspect` nos posers JSON e Kotlin: propriedade sincronizada `cobblemon:aspects` (1 bit por aspect, só em Mareep, Wooloo, Dubwool e Slowpoke) lida no `pre_animation`; vale em pose, animação e visibilidade (`scripts/entity/AspectSync.ts`, `tools/importer/entities.ts`). De brinde: o conversor Kotlin perdia `withCondition`/`withVisibility` (lã sempre ausente, Mareep com duas caminhadas). Callbacks MoLang: ver #70. Conferir a lã no cliente |
| 29 | Fortuna em sementes de mint e minérios (§2.2) | FEITO | `world/Fortune.ts`: `ore_drops`, `uniform_bonus_count`, `binomial_with_bonus_count`, `limit_count`, sem bônus com Toque Suave. Correção da auditoria: as sementes de mint não têm Fortuna no 1.8.2 |
| 30 | Pinturas crossover (§2.2) | FEITO (aproximação) | Antes NÃO POSSÍVEL. O registro `painting_variant` é só do Java; entidade própria `cobblemon:painting` (`scripts/limitesB/{paintings,paintingLogic}.ts`) com altar 4×2, nomad 2×2, premonition 2×1 e slumber 3×2: o clique do item Pintura vanilla refaz o sorteio do `Painting.create` com as 47 vanilla + as 4 e, se sair uma do Cobblemon, coloca a nossa. BDS: 900 sorteios por parede nas proporções do Java; cai sem parede, com TNT e golpe; volta depois de reiniciar. Review-fixes rodada 3: não cai com a parede em chunk descarregado; sobreposição com vanilla recusada. Desvios: a vanilla sorteada pelo Bedrock pode diferir da nossa conta; segurar o botão não coloca várias. Conferir no cliente |
| 31 | Pokédex na estante entalhada; dispenser tosquia berry/apricorn (§2.2) | FEITO | Antes NÃO POSSÍVEL. Estante: tag `minecraft:bookshelf_books` nos 7 itens de Pokédex (`tools/importer/items.ts`, a mesma tag do Java; `getTags()` no BDS igual ao `minecraft:book`); pôr na estante: conferir no cliente (o bot não clica em bloco). Dispenser (`scripts/adaptacoes/dispenser.ts`): tesoura colhe berry, apricorn e big root, com desgaste de 1 por tosquia; BDS: oran berry 5→3 com 2 frutos, apricorn 3→0 com o loot, big root → hanging roots + linha. Desvio: com tesoura e outro item no mesmo dispenser, o sorteio do Bedrock às vezes não solta nada (chance do outro item cai de `1 − p` para `(1 − p)²`) |
| 32 | Aprijuice dá ride boosts (§2.3, §3.6) | FEITO | `pokemon/Aprijuice.ts` (clique no Pokémon ou escolha do time) |
| 33 | Sprint na montaria terrestre (§2.3) | FEITO | Antes NÃO POSSÍVEL. `scripts/entity/RideSprint.ts` + `Riding.ts`: duplo toque para frente em 7 ticks (gatilho do próprio `HorseBehaviour`; a tecla de correr não chega ao script montado, provado no BDS), fôlego, aceleração, FOV × 1,15 e barra de fôlego; teclado, analógico e toque. BDS: 1,2 → 7,1 b/s em 2,2 s. Desvio: FOV absoluto 80,5 (a API não lê o FOV do jogador; review-fixes rodada 2). Ver §6 |
| 34 | `enableInFlightDismounting` (não desmontar em voo) (§2.3) | FEITO | Agachar não desmonta no ar/água; 2× desmonta |
| 35 | Sons de montaria (`rideSounds`, `ride.loop.*`) (§2.3, §2.4) | FEITO | `pokemon/RideSounds.ts` |
| 36 | Overlay de controles de montaria (§2.3) | FEITO | `ui/RideControls.ts` (actionbar) |
| 37 | Câmera de montaria (presets) (§2.3) | FEITO | `cobblemon:ride_orbit`/`ride_boom` |
| 38 | Roll da câmera e freelook (§2.3, §4.2) | FEITO (aproximação) / NÃO POSSÍVEL NO BEDROCK | Freelook: `/scriptevent cobblemon:ride_camera freelook` = órbita em todos os estilos + `ControlScheme.PlayerRelative` (a câmera gira livre com o mouse e a montaria vira por A/D; não é "segurar a tecla", sem botão livre). BDS: `clientbound_controls_scheme player_relative`. Roll da câmera: NÃO POSSÍVEL NO BEDROCK na câmera nativa (presets e `setCamera` só yaw/pitch; pesquisa 8 §5). O modo `roll` (câmera perseguidora por splines com o z do `RotationKeyFrame`, `scripts/entity/RideCameraRoll.ts`) está pronto e **desligado até confirmar no cliente** que o z rola a tela; o servidor aceita a spline. Roll visual do modelo feito antes |
| 39 | Estilo/atributos de montaria na Pokédex e no resumo (§2.3) | FEITO | Página de montaria no resumo; estilos, assentos e faixas na entrada da Pokédex |
| 40 | Panela: redstone, funil, observador, comparador (§2.3) | FEITO | Antes PARCIAL. Funil (`potHoppers.ts`), comparador (`redstone_producer` por permutação) e tampa por redstone dos vizinhos (`potRedstone.ts`); ver §7 |
| 41 | Tasty Tail (§2.3, §3.6) | FEITO | |
| 42 | Tora de saccharine com mel (§2.3, §4.1) | FEITO | |
| 43 | Temperos White Herb/Mental Herb/leite (`cleanse_*`, `mental_restoration`) (§2.3, §3.4) | FEITO | `events/MobEffects.ts`: `cleanse_negative` e `cleanse_all`. `mental_restoration` (antes NÃO POSSÍVEL): o contador de insônia não é visível, então `scripts/adaptacoes/mentalRestoration.ts` guarda por jogador os ticks acordado e o desconto do Java (31 × (nível + 1) por tick) e, quando o Bedrock gera um phantom natural, mantém o grupo com a probabilidade que dá a taxa do `PhantomSpawner` (equivalência estatística). BDS: desconto 6200 → phantoms somem. Review-fixes rodada 3: vale o jogador mais cansado da faixa. Desvios: contador começa em 0 na primeira entrada; `/summon phantom` alto acima de quem tem desconto pode sumir (mesma causa `Spawned`) |
| 44 | Mudas em vaso (§2.3) | FEITO | Semente de apricorn, muda de saccharine e Pep-Up Flower → `cobblemon:potted_*`; mão vazia devolve |
| 45 | Compostagem (§2.3, §3.6) | FEITO | `minecraft:compostable` em 140 itens; folhas e fardo sem JSON pela composteira por script |
| 46 | Restos do Braised Vivichoke (§2.3) | FEITO | Item, 3 receitas e textura apagados |
| 47 | Itens segurados proibidos (shulker/bolsa) (§2.3) | FEITO | |
| 48 | Propriedades `scale_modifier`, `tag`/`label` (§2.3) | FEITO | `scripts/PokemonProperties.ts` |
| 49 | Raio: Lightning Rod, Motor Drive, Volt Absorb, Terra; Mooshtank (§2.3, §5) | FEITO | `world/Lightning.ts` |
| 50 | Combee poliniza (§2.3, §4.6) | FEITO | Aproximação: sobe o mel direto, sem entrar na colmeia |
| 51 | Pasto: dormir, vir ao jogador, atacar hostis (§2.3, §5) | FEITO | Atacar hostis por IA (`cobblemon:pasture_conflict`, só com o hostil dentro da área); ver §7 |
| 52 | Behaviours de NPC + editor (§2.3) | FEITO | Aproximação |
| 53 | NPC com modelo de Pokémon (§2.3) | FEITO (aproximação) | Antes NÃO POSSÍVEL. Entidade de exibição montada no NPC (`scripts/npc/PokemonModel.ts`); ver §8 |
| 54 | Cor da cauda do Smeargle (§2.3) | FEITO | |
| 55 | Luz por estado: pasto, monitor, atril (§2.3) | FEITO | Atril com Pokédex: estado `cobblemon:emit_light` |
| 56 | Item segurado visível no modelo (§2.3, §2.4) | FEITO | `entity/HeldItemDisplay.ts`; conferir no cliente |
| 57 | Partículas de golpes (§2.3) | FEITO | `action_effects` |
| 58 | Texturas animadas de Pokémon (§2.3) | FEITO | 36 flipbooks |
| 59 | Evolução por passos (`blocks_traveled`) + contador (§2.3) | FEITO | Contador no resumo |
| 60 | Level-up no overlay (§2.3, §5) | FEITO | "+N EXP" e rolo de level-up no HUD; a EXP de batalha também vai para o overlay |
| 61 | Markings no resumo (§2.3, §5) | FEITO | 6 markings, 3 estados |
| 62 | Ordenar caixa do PC (§2.3, §5) | FEITO | `pokemon/SortMode.ts` |
| 63 | Filtro por nome parcial e reabrir na última caixa (§2.3, §5) | FEITO | `Search.of` e `lastPcBoxViewed` |
| 64 | `defaultBoxCount` 30 → 40 (§2.3) | FEITO | Configs antigas migram |
| 65 | Advancements novos (§2.3) | FEITO | 61 conquistas |
| 66 | StrongBattleAI completa (§2.3) | FEITO | |
| 67 | `/pokedex printcalculations` sem dex = Nacional (§2.3) | FEITO | |
| 68 | `/npcdelete <alvo>` pelo console; `/pctake` apaga (§2.3) | FEITO | |
| 70 | MoLang de datapack (~71 de ~416 funções) (§2.3, §4.4) | FEITO / NÃO POSSÍVEL NO BEDROCK | `scripts/molang/*`: ~30 funções gerais novas, `q.item`, `q.pokemon` completo (`PokemonMoLangFunctions.kt` + marcas), `q.player` do 1.8 (inicial, TMs, Pokédex, inventário, time, PC) e `q.world` (inclui `spawn_loot_table_items`). NÃO POSSÍVEL NO BEDROCK (retornam 0): `swing_hand`, `seen_credits`, structs de batalha/servidor, memórias/pathfinding de Brain, estados de montaria por script e `curve` (cliente Java); chuva/neve por posição aproximadas por evento de clima + tags de bioma |
| 71 | Requisito `chance` em interações (§2.3) | FEITO | `evaluateChance` nas interações e nas evoluções |
| 72 | Recompensas ao derrotar Alfa (§2.4) | FEITO | |
| 73 | Vestíveis no jogador e no Pokémon (19 itens) (§2.4) | FEITO | 17 itens (o "19" contava 2 modelos-molde que não são itens); 34 attachables; conferir no cliente |
| 74 | Redstone em Ring Target/Eject Button/Metronome e botões/placas de madeira (§2.4) | FEITO | Metronome com comparador (frente comparadores, `scripts/comparadores/`): `ActivatableDecorationBlock.getAnalogOutputSignal` = 4 quando `active`, 0 senão; `minecraft:redstone_producer` por permutação só nas faces com comparador lendo o bloco (máscara `cobblemon:comparator_faces`), sem `redstone_consumer` (o Java também não tem entrada). BDS com bot conectado: o clique real do bot (`item_use`/`click_block`) alterna o bloco → comparador 4, fio 4 → 3, lâmpada acesa; clicar de novo → 0 e lâmpada apagada; dois comparadores (norte e leste) → 4 nos dois; mantido depois da recarga do chunk e do reinício do servidor. Antes NÃO POSSÍVEL, depois FALTA |
| 76 | Itens colocáveis como bloco (§2.4) | FEITO | Never-Melt Ice com `minecraft:friction` 0,011 |
| 77 | Move Dex na Pokédex (§2.4) | FEITO | `pokedex/MoveDex.ts` |
| 78 | Estante: sequenciador de note block e discos visíveis (§2.4, §4.7) | FEITO | `machines/discShelfSequencer.ts`; a nota do note block também toca (o Bedrock não deixa suprimir) |
| 79 | Tipo Gelo imune a congelamento; aranhas imunes a teia (§2.4) | FEITO | Gelo feito antes. Teia (antes NÃO POSSÍVEL): `minecraft:block_movement_slowdown_immunity` nas 8 espécies com `immuneToCobwebBlock` (`tools/importer/entities.ts`); ver §6 |
| 80 | `weighted_choice` (Dudunsparce, Maushold) (§2.4) | FEITO | |
| 81 | Grito ao clicar no Pokémon no resumo (§2.4) | FEITO | Som + animação `cry` |
| 82 | `order` das categorias de iniciais (§2.4) | FEITO | |
| 83 | Chatter de NPC (§2.4) | FEITO | |
| 84 | Só datapack: `negate`, `area`, `owner_holds_item`, MoLang novos, `party_pools`/`composed_pool`, `scrolling`, assentos condicionais (§2.4) | FEITO / NÃO POSSÍVEL NO BEDROCK | `negate`, `area`, `owner_held_item`, `chance`, `party_pools`/`composed_pool` feitos antes; agora MoLang novos (#70), `scrolling` (`uv_anim` no render controller da camada, velocidade por variante, como `getScrollingLayer`) e assentos condicionais (`SEAT_CONDITIONS` + `canRidePokemon`, `scripts/entity/{SeatConditions,Riding}.ts`). NÃO POSSÍVEL NO BEDROCK: mudar a posição de um assento quando um anterior é filtrado (o `minecraft:rideable` tem assentos fixos); adaptação: só deixa subir até o número de assentos válidos. Nenhum dado do 1.8.2 usa `scrolling` nem `condition` em assentos |

### 10.2 Registries, sons, partículas e dados

| # | Lacuna | Status | Como / onde |
|---|---|---|---|
| 85 | 8 espécies implementadas fora do port (§3.0) | FEITO | Pose sem animação aceita |
| 86 | Efeitos de golpe/impacto (`action_effects`) (§3.0) | FEITO | |
| 87 | Partículas de bola (envio, recolha, feixe, estrelas) (§3.0, §3.3) | FEITO | As 346 partículas de `balls/**` no RP; usadas no envio e na recolha e, desde a onda de fechamento, também na sequência de captura (ver §2) |
| 88 | Partículas de aspect (`honey_drenched`, migalhas, néctar, olhos do Alfa) (§3.0) | FEITO / NÃO POSSÍVEL NO BEDROCK | `scripts/visual/AspectParticles.ts`: mel 7,5 %/tick (`minecraft:honey_drip_particle`) e migalhas 5 % × 3 (`cobblemon:poke_snack_crumbs`, textura do Cobblemon) no hitbox (BDS: 13 partículas em 100 ticks, esperado ≈ 22 ± 7); néctar do Combee já feito. Olhos do Alfa: animação por geometria (`tools/importer/visualFinal.ts`) com `cobblemon:alpha_eyes` em cada locator de olho a cada 0,2 s, 871 espécies. NÃO POSSÍVEL NO BEDROCK: o brilho em anéis e o rastro de 400 ms do `AlphaEyeRenderer` (desenhados direto no buffer com `RenderType.dragonRays/lightning`; o Bedrock não tem renderização customizada por entidade); adaptação: só a partícula |
| 89 | Partículas presas a animações de espécie (35) (§3.0) | FEITO | 35/35 |
| 90 | Sons de blocos (quebrar/colocar/pisar) (§3.0, §3.2) | FEITO | 101 de 103 blocos; `hearty_grains` alagado: NÃO POSSÍVEL (um conjunto por bloco, não por estado) |
| 91 | Barcos de apricorn/saccharine (§3.1) | FEITO | Aproximação por `runtime_identifier` |
| 92 | Sons de máquinas (TM Machine, panela, fósseis, monitor, Healing Machine, baú dourado) (§3.2) | FEITO | 332 de 394 eventos não-espécie tocados (antes ~80) |
| 93 | `gui.levelup`/`levelup_start` (§3.2) | FEITO | `battle/LevelUpSounds.ts` e o overlay |
| 94 | `poke_ball.throw`/`trail`/`shiny_send_out` (§3.2) | FEITO | `battle/SendOut.ts` |
| 95 | Chimes de shiny (§3.2) | FEITO | |
| 96 | `move.*`/`impact.*` (§3.2) | FEITO | Pelos efeitos de golpe |
| 97 | `pc.grab/drop/release`, `gui.click` (§3.2) | FEITO | PC, resumo, iniciais e forms da batalha |
| 98 | Gibber, `gimmighoul.give_item`, `berry.eat.full` (§3.2) | FEITO | |
| 99 | `entity.villager.work_nurse` (§3.2) | FEITO (aproximação) | Antes NÃO POSSÍVEL. Enfermeira (ver #113): a cada 300 ticks, 50 %, a ≤ 1,73 do centro da Healing Machine no horário de trabalho → som `cobblemon.entity.villager.work_nurse` + reabastece as trocas (`scripts/limitesB/nurse.ts`). BDS: `workSounds=5 restocks=5` |
| 100 | `item.pokedex.scan_zoom_increment` (§3.2) | FEITO | `ui/studio/ScannerZoom.ts` |
| 101 | Dívida: chaves de som sem prefixo do CobbleBuild (§3.2) | FEITO | `CaptureSequence.ts` usa `cobblemon.poke_ball.*` e as variantes `.ancient`; o código não tem mais `"poke_ball.`; acerto em bloco = `dig.wood` pitch 2 (visual-final) |
| 102 | Partículas de status/boost em batalha (§3.3) | FEITO | Ver §3 |
| 103 | `evo_*` e `poodle_hair_*` usadas pelos scripts (§3.3) | FEITO | Corte do Furfrou: `cobblemon:poodle_hair_<cor>` pelo corante em 0 / 0,2 / 0,7 s, como `action_effects/misc/furfrou_trim.json` (`scripts/entity/Interactions.ts`) |
| 104 | `broth_*`, `alpha_eyes`, `alphaboost_*`, `heal_circles/sparkles` (§3.3) | FEITO | `broth_bubbles` e `alphaboost_*` (pelo `-start` em batalha) feitos antes; `alpha_eyes` feito (ver #88, brilho/rastro NÃO POSSÍVEL). N/A NO COBBLEMON: `alphaboost_*` fora de batalha (só `start_alphaboost.json` usa) e `heal_circles`/`heal_sparkles` (nenhuma referência; a Healing Machine do 1.8.2 usa `HAPPY_VILLAGER`, já feito). `tests/visual-final.test.ts` confere |
| 105 | 61 conquistas no lugar dos 13 objetivos do Progresso (§3.5) | FEITO | |
| 106 | Estatísticas de jogador (§3.5, §5) | FEITO (adaptação) | `/cobblemon:stats` |
| 107 | Inflamáveis (8 blocos de madeira/folha) (§3.6) | FEITO | `minecraft:flammable` exatamente nos 21 blocos do `setFlammable` do Kotlin, com os valores do Java |
| 108 | Tags de comida vanilla (raposa, cavalo, piglin, abelha) (§3.6) | FEITO | Galinha, papagaio, cavalo/burro/mula, raposa e piglin por override das entidades vanilla. `bee_growables` (antes NÃO POSSÍVEL): `scripts/adaptacoes/bees.ts` faz a abelha com néctar crescer as plantas da tag (limite de 10 por polinização). BDS: red mint 0→7, revival herb 3→8 (mutação volta a `none`, como `CropBlock.getStateForAge`), folha de saccharine 0→2. Desvios: sem exigir colmeia válida (invisível a scripts); amostragem a cada 10 ticks |
| 109 | `species_feature_assignments` (87) (§3.6) | FEITO | `scripts/pokemon/FeatureAssignments.ts` + `generated/scripts/dadosIa.ts`: 95 `species_features` e as features de 268 espécies, com padrão/sorteio/pesos na criação e na troca de espécie; `chave=valor` em propriedades e `matches`. Conferido com 3576 Pokémon gerados |
| 110 | Eggant Berry segurada no simulador (§3.6) | FEITO | Registrada no dex do simulador com `held_items/eggantberry.js` |
| 111 | Presets de IA de espécie (`behaviours`, 49) (§3.6) | FEITO / NÃO POSSÍVEL NO BEDROCK | `tools/importer/pokemonBehaviours.ts` avalia os behaviours (auto + `ai` da espécie, com as condições MoLang) em 5 contextos e converte as tarefas em componentes vanilla (`cobblemon:wild_ai`, `owned_ai`, `alpha_ai`, `pasture_conflict`): Alfa revida, Pidgeotto caça Magikarp, Ninjask/Combee voam na faixa de altura, `avoids_water`, Nosepass aponta o spawn. NÃO POSSÍVEL NO BEDROCK: `fly_in_circles`, `flee_nearest_hostile` e `walk_away_from_avoid_target` (sem componente vanilla equivalente); adaptação: ignoradas, a IA vanilla gerada continua. `hate_entity` (Seviper/Zangoose): N/A NO COBBLEMON (o `HateEntityTaskConfig.kt` avalia a condição na própria entidade e nunca dispara no 1.8.2) |
| 112 | Creative tabs (§3.6) | FEITO | `item_catalog/crafting_item_catalog.json` com as 7 abas na ordem do Kotlin |
| 113 | Dispenser (mel/água na saccharine), trim `automaton`, Enfermeira (§3.6) | FEITO / NÃO POSSÍVEL NO BEDROCK | Dispenser (`scripts/adaptacoes/dispenser.ts`): mel → folha de saccharine 0→2 com garrafa vazia de volta; poção de água → 2→0 (desvio: mel na tora deitada não vira tora com mel). Enfermeira: FEITO (aproximação), override do `villager_v2` (bedrock-samples v1.26.50.4) + `scripts/limitesB/nurse.ts`: desempregado adulto a até 48 blocos de uma Healing Machine livre vira enfermeira (AcquirePoi), trabalha nela (#99), perde a profissão se a máquina quebra e nunca negociou; 21 trocas do Java, textura `nurse`/`nurse_joy` (Joy pelo nome); curada de zumbi volta enfermeira (review-fixes rodada 3). Desvios: horário de trabalho do Bedrock, sem posse de POI (POI data-driven só experimental no 26.50), "negociou" = abriu as trocas, o zumbi dela fica sem família de profissão. Trim `automaton`: NÃO POSSÍVEL NO BEDROCK, o `minecraft:recipe_smithing_trim` só aceita templates da tag `minecraft:trim_templates` e o padrão vem do template vanilla (doc `minecraftRecipe_SmithingTrim.md`; não há esquema `trim_pattern` no bedrock-samples v1.26.50.4); o item fica como item (receita de cópia e loot) |

### 10.3 Config, keybinds, gamerules, comportamentos e mixins

| # | Lacuna | Status | Como / onde |
|---|---|---|---|
| 115 | `playerDamagePokemon` (§4.1) | FEITO | `world/PokemonDamage.ts` |
| 116 | `shinyNoticeParticlesDistance` (§4.1) | FEITO | |
| 117 | `honeySlatherAlphaChance`/`ShinyChance` (§4.1) | FEITO | |
| 118 | `teraTypeRate` (§4.1) | FEITO | |
| 119 | `displayEntityLevelLabel`/`NameLabel`/`LabelsWhenCrouchingOnly`/`displayNameForUnknownPokemon` (§4.1) | FEITO | Aproximação (nameTag global) |
| 120 | `announceDropItems`/`dropAfterDeathAnimation` (§4.1) | FEITO | |
| 121 | `maxVerticalSpace` (§4.1) | FEITO | |
| 122 | `minimumRidingScale` (§4.1) | FEITO | |
| 123 | `savePokemonToWorld` (§4.1) | FEITO | |
| 124 | `defaultKeyItems` (§4.1) | FEITO | Só dado |
| 127 | Tecla R (`SEND_OUT_POKEMON`) (§4.2) | FEITO | Agachado + pular |
| 128 | Setas do overlay (`PARTY_OVERLAY_UP/DOWN`) (§4.2) | FEITO | Agachar 2× |
| 129 | Gamerules `doPokemonSpawning`, `doPokemonLoot`, `doShinyStarters`, `healersHealPC` (§4.3) | FEITO | Dynamic property + `/cobblemon:cobblemongamerule` |
| 130 | `/technicalmachine` (§4.5) | FEITO | `/cobblemon:technicalmachine unlock\|lock <jogador> only <TM>\|all` e `check <jogador>` |
| 131 | Raposa (Vulpix) colhe e pega comida; `picks_up_items`; `gets_mad_at_thrower` (§4.6) | FEITO | Vulpix feito (só pilhas comuns; item da boca não some no despawn e cai na captura). Os dois behaviours: nenhuma espécie do 1.8.2 usa |
| 132 | Fome/`fullness` (§4.6) | FEITO | |
| 133 | Imunidades por mixin (raio não queima, neve fofa, sweet berry) (§4.6) | FEITO | Ver §6 |
| 134 | Relic Coin Pouch no escambo dos piglins (§4.7) | FEITO | Override do piglin |
| 135 | Espeleotema cresce sob o minério de pedra da lua (§4.7) | FEITO | Componente `cobblemon:dripstone_growable` |
| 136 | Fazendeiro recolhe sementes do Cobblemon (§4.7) | FEITO (aproximação) | Antes NÃO POSSÍVEL (`harvest_farm_block` sem lista). As 9 sementes da tag `villager_plantable_seeds` nos `shareables` do override do `villager_v2` (pega do chão) + `scripts/limitesB/farmer.ts` a cada 40 ticks, com `mobGriefing`, no 3×3×3 do fazendeiro: colhe planta madura do Cobblemon e planta a primeira semente do inventário em farmland livre. BDS: pegou hearty grains e red mint do chão, colheu maduros, plantou na ordem do inventário. Desvios: não anda até as plantas do Cobblemon (age quando passa perto); medicinal leek (água) fica de fora |
| 137 | Pérola do ender no próprio Pokémon (§4.7) | FEITO | Agachado mirando o próprio Pokémon não arremessa |
| 138 | Poções/vitaminas no suporte de poções (§4.7) | FEITO | Tela própria (`scripts/machines/cooking.ts`) |

### 10.4 Fontes web

| # | Lacuna | Status | Como / onde |
|---|---|---|---|
| 139 | Cura do time ao dormir (§5) | FEITO | |
| 140 | Painel de IVs/EVs no PC (§5) | FEITO | Prévia com markings, natureza, habilidade, IVs e EVs |
| 141 | Resumo: passos, saciedade, montaria, grito (§5) | FEITO | |
| 142 | Filtros da Pokédex (montáveis, TM, habilidade/golpe/drops) (§5) | FEITO | |
| 143 | Healing Machine: comparador, luz quando cheia, variante "natural" (§5) | FEITO | Luz quando cheia feita antes; variante "natural" feita (estado `cobblemon:natural`, modelos `healing_machine_limited_1..5`, 1–4 barras de ferro; BDS `debug_visual_final healing`). Comparador feito (frente comparadores, `scripts/comparadores/`): `currentSignal` do Java = `((carga / máx) * 100).toInt() / 10`, no máximo 10, pela técnica da panela (#40), sem `redstone_consumer` (o Java também não tem entrada). Por causa do limite de 65.536 permutações do mundo, o sinal sai do medidor `cobblemon:charge` + 1 bit (512 → 16.384 combinações; pack 17.243 → 33.235). BDS com bot conectado, variante `natural`: 35 % → comparador 3, fio 3 → 2, lâmpada acesa; 72 % → 7; 100 % → 10 (luz acima 11 à noite contra 10 abaixo de cheia); 0 % → 0 e lâmpada apagada; recarga natural 2 → 3 sem comando; comparador de lado 0; dois comparadores (norte e oeste) → mesmo sinal nos dois; fio no lugar do comparador → 0; mantido depois da recarga do chunk e do reinício do servidor. Antes NÃO POSSÍVEL, depois FALTA |
| 144 | Quirks: Nosepass aponta para o spawn, bolhas do Krabby ao pôr do sol (§5) | FEITO | Nosepass: `scripts/visual/PointToSpawn.ts` (`lookAt` ao centro do bloco do spawn a cada 10 ticks, parado, fora de batalha/ombro/montaria; um só loop depois da review-fixes; BDS: diferença 0,0°). Partículas de espécie (Krabby) feitas antes |
| 145 | Batalha "minimizável" para andar (§5) | FEITO | Antes NÃO POSSÍVEL. Modo `java` padrão (estado `minimised` do Java no servidor, aviso pulsante no HUD, tecla R = agachado + pular, duplo toque em Pular no celular); ver §3. A tela aberta continua modal, como a `BattleGUI` do Java (que também não deixa andar) |
| 146 | Recipe book agrupado, busca "poke" = "poké" (§5) | FEITO (aproximação) / NÃO POSSÍVEL NO BEDROCK | Livro agrupado: o livro do Bedrock usa a lista do catálogo criativo, então os itens com o mesmo `group` das receitas Java (≥ 2 na mesma aba) viram 44 subgrupos `cobblemon:recipe_group.<group>` (`tools/importer/limitesB.ts`; 98 blocos com o grupo no `menu_category`). Desvio: os grupos também aparecem no inventário criativo. Busca "poke" = "poké": NÃO POSSÍVEL NO BEDROCK, a busca é do cliente, sem sinônimos por pack (o Java usa `SearchTreeMixin`; pesquisa 8 §10). Conferir no cliente se a busca já ignora acento |

---

## Anexo: pesquisa inicial (antes das frentes; status desatualizado, mantido pelas referências ao código do Cobblemon)

Data: 2026-09-25. Pesquisa read-only. Convenções:
- `K/` = `upstream/cobblemon/common/src/main/kotlin/com/cobblemon/mod/common/`
- `D/` = `upstream/cobblemon/common/src/main/resources/data/cobblemon/`
- Status: **PORT_HAS** / **PARTIAL** / **MISSING** / **NOT_POSSIBLE_IN_BEDROCK** (motivo). Tamanho: S (≤1 dia) / M (2–5 dias) / L (>1 semana).
- Tamanho do port: ~8.5k linhas TS em `scripts/` (1.5k só no `BattleInterpreter.ts`).

Observações gerais do port:
- `generated/import-report.json`: 886 espécies, 2595 spawns importadas, **1962 spawns ignoradas (tipo `pokemon-herd`)**, 310 sem bioma/bloco equivalente.
- Itens no BP (`behavior_packs/CobblemonBedrock/items`, 320 arquivos): bolas, berries, mints, vitaminas, poções, X-items, held items, doces, mulch, apricorns etc. existem como **itens**, mas só uma fração tem comportamento em script (rare/exp candy, pedras de evolução via `ItemInteractionEvolution`, troca de held item, leftovers/apricorn/PC/healing machine por custom components).

### 1. Spawning

| Sistema | Status | Tam. | Fonte Cobblemon | Notas do port |
|---|---|---|---|---|
| Spawner base (buckets, peso, condições bioma/luz/céu/tempo/lua/Y/blocos base/próximos, anticondições, weight multipliers) | PORT_HAS (com desvios) | – | `K/api/spawning/BestSpawner.kt`, `condition/*`, `spawner/PlayerSpawner*.kt`, `D/spawning/best-spawner-config.json` | `scripts/spawning/Spawner.ts`. Pesos de bucket desatualizados (94.4/5/0.5/0.1; 1.8.2 usa 94/5/0.5/0.2 + **boss 0.3**). Sem `spawnablePositionTypeWeights`, `spawn_detail_presets` são mesclados pelo importador (`tools/importer/spawns.ts:111`). Entradas `fishing` são importadas mas nunca escolhidas (nenhum `positionType` "fishing" no Spawner). Sem `minimumDistanceBetweenEntities` (8), sem `maximumSpawnsPerPass`. |
| Herds (`type: "pokemon-herd"`, `herdablePokemon`, `maxHerdSize`, líder/seguidores, `levelRangeOffset`) | MISSING | M | `K/api/spawning/detail/PokemonHerdSpawnDetail.kt`; 1962 entradas em `D/spawn_pool_world` | Importador descarta (`tools/importer/spawns.ts:103`). Inclui praticamente todos os **Alphas** (bucket `boss`, `alpha=true`, `held_item=`). Precisa: importar herds, spawn em grupo, propriedade/aspect `alpha` (escala maior, moveset `D/moveset_builders/alpha.json`, marca `mark_alpha`). |
| Alpha Pokémon | MISSING | M | `D/moveset_builders/alpha.json`, `D/marks/mark_alpha.json`, `D/loot_table/alpha` | Depende de herds; escala via `minecraft:scale` dinâmico não existe em script estável → usar component group/propriedade de entidade gerada pelo importador. |
| Pesca (`spawnablePositionType: fishing`, 591 entradas), Poké Rods (`D/pokerods`, 48), bobber, `rodType`, `minLureLevel` | MISSING | L | `K/api/spawning/spawner/FishingSpawnerFactory.kt`, `K/api/spawning/fishing/FishingSpawnCause.kt`, `K/item/interactive/PokerodItem.kt`, `K/entity/fishing/PokeRodFishingBobberEntity.kt` | Filtradas no `conditionMatches` (`c.rodType`, `minLureLevel`). Bedrock não expõe evento "peixe fisgou" estável com loot customizável; alternativa: item vara customizado que lança projétil-boia (entidade própria) + timer por script → spawn da entrada "fishing" e início de batalha. Viável, mas grande. Buckets próprios (`fishingBuckets`). |
| Iscas de pesca / efeitos (`D/spawn_bait_effects`, 79: berries, fruits, poke_bait, sweet_heart) | MISSING | M | `K/api/fishing/SpawnBaitEffect*.kt`, `K/api/spawning/influence/SpawnBaitInfluence.kt` | Depende de pesca e de Poké Snack. Efeitos: shiny chance, nível, natureza, IV, gênero, tipo, EV yield, HA, bite time, etc. |
| Lures (Lure level via enchant Lure na Poké Rod) | MISSING | S | `FishingSpawningCondition` (`minLureLevel`/`maxLureLevel`) | Encantamentos no Bedrock são legíveis via `ItemEnchantableComponent` (estável) – viável depois da pesca. |
| Poké Snack (bloco que atrai spawns; `isPokeSnack`, 1571 condições) | MISSING | M | `K/block/PokeSnackBlock.kt`, `K/api/spawning/spawner/PokeSnackSpawnerFactory.kt`, `config.pokeSnackPokemonPerChunk` | Filtrado. Precisa bloco + custom component tick + spawner de área fixa (`FixedAreaSpawner`). Depende de culinária (seção 9). |
| Saccharine log "slathered" (mel) / Incense sweet | MISSING | S | `K/api/spawning/influence/SaccharineLogSlatheredInfluence.kt`, `IncenseSweetInfluence.kt`, `prospecting/*` | Aumenta chance alpha/shiny perto do bloco. |
| Habitats ativados (`D/habitat_pools`, 51; `activatedHabitatBuckets`) | MISSING | M | `K/api/spawning/.../habitat*`, `D/structure/habitats` | Estruturas "habitat" são Java-only; Bedrock tem structures (mcstructure) — conversão possível mas pesada. |
| Estruturas como condição (`structures`, 864 condições) | NOT_POSSIBLE_IN_BEDROCK (parcial) | – | `AreaSpawningCondition` | Script API estável não consulta "está dentro de estrutura X". Aproximação possível por blocos marcadores/biomas; hoje o port descarta a entrada inteira. |
| Slime chunk | NOT_POSSIBLE_IN_BEDROCK (sem API) | S | condição `isSlimeChunk` | Dá para reimplementar o algoritmo de slime chunk do Bedrock (conhecido: baseado em x,z) → na prática viável (S). |
| Level scaling por nível do time (`PlayerLevelRangeInfluence`) | MISSING | S | `K/api/spawning/influence/PlayerLevelRangeInfluence.kt`, `PlayerSpawnerFactory.kt:41` | Port sorteia `minLevel..maxLevel` puro. |
| Regras de spawn (`D/spawn_rules`, ex. `pikachu_bright`) | MISSING | S | `K/api/spawning/rules/*` | Só 1 arquivo de exemplo. |
| Despawn | PARTIAL | S | `K/entity/pokemon/CobblemonAgingDespawner.kt` (idade × distância, `despawnerNear/FarDistance`, `Min/MaxAgeTicks`) | Port usa `minecraft:despawn` vanilla (48–128 blocos) no entity JSON (`tools/importer/entities.ts:222`), sem idade mínima; `entityLoad` mata Pokémon com dono (anti-dup). |
| Caps de spawn | PARTIAL | S | `config.pokemonPerChunk`=1, `maximumSpawnsPerPass`=8, `minimumDistanceBetweenEntities`=8 | Port: `MAX_WILD_NEAR_PLAYER=10` em raio 64, 3 tentativas/10 ticks por jogador em rodízio. Sem cap por chunk. |
| Held items de spawn (`heldItems` com chance), `drops` por spawn | MISSING (verificar importador) | S | `K/api/spawning/detail/PossibleHeldItem.kt` | Não há campo `heldItems` em `SpawnEntry` usado no Spawner. |
| Shiny rate configurável | PARTIAL | S | `config.shinyRate` 8192 | Constante `SHINY_RATE` em `scripts/Pokemon.ts:54`, não na config. |
| Aspects/spawn `pokemon` strings (`alpha=true`, `held_item=`, formas regionais) | PARTIAL | S | `PokemonProperties` | Port passa `entry.aspects`; `scripts/PokemonProperties.ts` parse parcial. |

### 2. Captura

| Sistema | Status | Tam. | Fonte Cobblemon | Notas do port |
|---|---|---|---|---|
| Fórmula de captura (HP, catch rate, status, bônus de nível <13, in-battle 1×/fora 0.5×) | PORT_HAS | – | `K/pokeball/catching/calculators/CobblemonCaptureCalculator.kt` | `scripts/catching/index.ts` `processCapture`. Usa catch rate da espécie, não da forma (TODO no código). |
| Modificadores por bola (great/ultra/master/safari/fast/level/lure/heavy/love/moon/sport/net/dive/nest/timer/dusk/quick/park/dream/beast) | PORT_HAS | – | `K/api/pokeball/PokeBalls.kt:250-297`, `K/api/pokeball/catching/modifiers/*` | `scripts/catching/StandardModifiers.ts`. Divergências: timer usa `1*turn*1229/4096` (upstream `1 + turn*…`); beast ball não aplica 0.1× em não-UB; lure ball upstream = `CatchRateModifiers.LURE` (pescado), port = boost tipo Água. |
| Repeat Ball | MISSING | S | `CatchRateModifiers.REPEAT` | Depende de Pokédex (espécie já capturada). |
| Efeitos pós-captura: Heal Ball (full restore), Friend Ball (amizade 150), Luxury Ball (2× ganho de amizade) | MISSING | S | `K/api/pokeball/catching/effects/CaptureEffects.kt`, `FriendshipEarningBoostEffect.kt` | Port só salva `pokeball`. Luxury depende de sistema de amizade. |
| Bolas "ancient" (16 variantes: feather/wing/jet com throwPower, heavy/leaden/gigaton, origin) | MISSING | S | `PokeBalls.kt:282-297`, receitas em `D/recipe` | Itens nem existem no BP. Throw power = velocidade do projétil (`minecraft:projectile.power`) – viável. |
| Captura crítica | MISSING | S | `CriticalCaptureProvider` (`K/api/pokeball/catching/calculators/`), depende de nº de espécies capturadas (Pokédex) | `let critical = false` + TODO. |
| Animação de sacudir / sons / abrir | PORT_HAS (básica) | – | `K/entity/pokeball/EmptyPokeBallEntity.kt` | Animações `capture`, `bob1..6`, `open`, sons `poke_ball.*`. `todo.md` registra arremesso "janky". Sem partículas de sucesso/estrelas nem animação de "sugar" o Pokémon (usa invisibilidade). |
| Captura em batalha | PORT_HAS (só singles) | – | `K/battles/BattleCaptureAction.kt` | Bloqueada fora de singles (`cobblemon.capture.not_single`); upstream permite em doubles contra selvagem. Botão "Capture" no menu de batalha só manda mensagem pedindo para arremessar. |
| Water drag da Dive Ball, `throwPower` | MISSING | S | `WaterDragModifier.kt` | Cosmético. |
| Pokémon capturado: OT, trainer id, bola | PORT_HAS | – | – | Sem amizade inicial da bola, sem “caught ball” efeitos, sem evento para Pokédex. |

### 3. Batalhas

| Sistema | Status | Tam. | Fonte Cobblemon | Notas do port |
|---|---|---|---|---|
| Motor (Showdown) | PORT_HAS | – | `K/battles/ShowdownInterpreter.kt`, `K/battles/runner` | `@pkmn/sim` embutido; interpretador em `scripts/battle/BattleInterpreter.ts` (1.5k linhas). |
| Batalha selvagem (singles) | PORT_HAS | – | `K/battles/BattleBuilder.kt` (`pve`) | Interagir com selvagem → `startWildBattle`. |
| PvP por desafio | PORT_HAS (simples) | – | `K/battles/ChallengeManager.kt`, `K/net/.../BattleChallengePacket` | `scripts/ChallengePlayer.ts`, disparado por interação player→player (`behavior_packs/.../player.json:193`). Sem escolha de formato, sem team preview, sem `battlePvPMaxDistance` (32), expira em 60 s. |
| Doubles / Triples / Multi / Royal | PARTIAL | M | `K/battles/BattleFormat.kt`, `BattleTypes.kt` | Formatos definidos (`scripts/battle/BattleFormat.ts`) mas nenhuma entrada usa (wild/PvP são sempre `GEN_9_SINGLES`). Upstream: wild doubles quando há 2 selvagens próximos/herd, PvP doubles/triples/multi via UI de desafio. GUI de alvo (target selection) não existe. |
| Treinadores NPC | MISSING | L | `K/entity/npc/*`, `K/api/npc/*`, `K/battles/actor/NPCBattleActor.kt`, `D/npcs`, `D/npc_presets`, `D/behaviours/battler.json` | Ver seção 8. IA de batalha existe só como "random/strongest" para selvagens? (`scripts/battle` não tem `ai/`). Upstream: `K/battles/ai/StrongBattleAI.kt`, `RandomBattleAI.kt`. |
| Fugir (Run) | PARTIAL | S | `K/battles/actor/PlayerBattleActor.kt` (`ForfeitAction`), `config.defaultFleeDistance`=32 | Botão Run só manda mensagem "afaste-se"; fuga real ocorre por distância (`fleeDistance=30` fixo em `PokemonBattle.ts:17`). Sem forfeit explícito em PvP. |
| Forfeit | MISSING | S | `K/battles/actor/*` `forfeit` | Só `>forcetie` quando alguém sai/fica longe. |
| Distância máxima de batalha (`battleWildMaxDistance`=12 para iniciar, PvP 32, espectador 64) | PARTIAL | S | `CobblemonConfig.kt:297-308` | Não valida distância ao iniciar; espectadores existem na classe mas sem entrada de UI. |
| EXP (fórmula gen5+, participação, lucky egg, afeição ≥220, multiplicador) | PORT_HAS | – | `K/pokemon/experience/*`, `K/battles/interpreter/instructions/FaintInstruction.kt` | `scripts/Experience.ts`, `BattleInterpreter.ts:311`. Falta: bônus não-OT (1.5×), bônus de evolução pendente, `awardExperienceOnBattleLoss`, `allowExperienceFromPvP` não checado. |
| Exp. Share | PARTIAL | S | `K/item/...exp_share`, `config.experienceShareMultiplier` | Port trata `exp_share` como **held item** (0.5×) — confere com Cobblemon (held item). |
| Ganho de EV | MISSING | S | `K/pokemon/EVs.kt`, `K/battles/...` (EV yield no faint; power items; macho brace) | `evYield` é lido em `speciesData.ts` mas nunca aplicado. |
| Ganho de amizade (level up, batalha, andar, luxury/soothe bell) | MISSING | S | `K/pokemon/Pokemon.kt` (`incrementFriendship`), `K/api/pokemon/friendship/*` | `happiness` fixo em `baseFriendship`. Afeta evoluções por amizade (nunca evoluem naturalmente). |
| Held items em batalha | PORT_HAS (via Showdown) | – | `K/pokemon/helditem/*`, `D/held_items/eggantberry.js` | Item vai no set do Showdown. Consumo (berries) sincroniza? parcial (`BattleInterpreter.ts:1326` toca som de berry). |
| Itens da mochila em batalha (poções, status heals, revives, X items, Dire Hit, Guard Spec, éteres) | PARTIAL (backend) / MISSING (UI) | M | `K/battles/BagItems.kt`, `K/item/battle/*`, `D/bag_items/*.js` (11 scripts Showdown) | `BagItemActionResponse`/`HealItemActionResponse` existem em `scripts/battle/ActionResponse.ts` mas nenhuma GUI os usa; precisa botão "Bag" no `GUI/Battle.ts`, listar itens do inventário e injetar os `bag_items/*.js` no sim. |
| Uso de itens fora de batalha (poções, revive, vitaminas, mints, PP Up, ability capsule/patch, berries de EV) | MISSING | M | `K/item/interactive/*` (ex.: `MintItem`, `VitaminItem`, `PotionItem`, `ReviveItem`, `PPUpItem`) | Só Rare/Exp Candy e itens de evolução (`scripts/events/ScriptEvents.ts:113-139`). |
| Regras pós-batalha / cura | PARTIAL | S | `K/battles/...` + `healingMachine`, `config.defaultFaintTimer`, `healTimer/healPercent` | Selvagem é curado ao fugir. Sem cura passiva do time fora de batalha (`healPercent` a cada `healTimer`), sem timer de desmaio. Healing Machine existe (`custom_components/HealingMachineComponent.ts`). |
| Drops ao derrotar selvagem | MISSING | S | `K/api/drop/*`, `drops` na espécie | `drops` parseado em `speciesData.ts` mas não usado. |
| Música de batalha | PORT_HAS (básica) | S | `K/client/battle/BattleMusic*`, sons `battle.pvw/pvp/pvn` | `BattleActor.updateMusic()` com `playMusic` (estável). |
| Animações de golpe / cry / faint na entidade | PARTIAL | M | `K/client/render/...` + `D/action_effects/moves` | Port toca só `cry` ao entrar. `action_effects` (154 arquivos, partículas/animações por golpe) não portado. Bedrock suporta `playAnimation` + `spawnParticle` estáveis → viável. |
| Espectar batalha | PARTIAL | S | `config.allowSpectating` | `spectators` existe; sem forma de entrar. |
| Tela de batalha (HUD com HP, retratos, log) | NOT_POSSIBLE_IN_BEDROCK (fiel) | – | `K/client/gui/battle/*` | Só forms modais; ver seção 11. |

### 4. Dados do Pokémon

| Sistema | Status | Tam. | Fonte Cobblemon | Notas do port |
|---|---|---|---|---|
| IVs (aleatórios 0–31) | PORT_HAS | – | `K/pokemon/IVs.kt` | `Pokemon.ts:418`. Sem "perfect IVs" de lendários/spawn bait, sem Bottle Cap/Hyper Training. |
| EVs (armazenamento + fórmula de status) | PARTIAL | S | `K/pokemon/EVs.kt` | Campo e fórmula ok; **ganho** e vitaminas/asas/berries redutoras MISSING (itens existem no BP). |
| Naturezas | PORT_HAS | – | `K/pokemon/Nature.kt` | Stat calc aplica natureza. |
| Mints (natureza de stat) | MISSING | S | `K/item/interactive/MintItem.kt`, blocos `*_MINT` | Itens `*_mint.json` existem, sem efeito; plantas de mint (`*_mint_seeds`, `*_mint_leaf`) sem bloco. |
| Habilidades (normais) | PORT_HAS | – | `K/pokemon/abilities/*` | Sorteio entre não-ocultas. |
| Habilidade oculta (HA) | MISSING | S | `K/pokemon/abilities/HiddenAbility*`, aspects/spawn bait, Ability Patch | Nunca atribuída; sem Ability Capsule/Patch. |
| Formas (regionais, aspects, features) | PARTIAL | M | `K/pokemon/FormData.kt`, `D/species_features`, `D/species_feature_assignments` | Aspects escolhem variante visual e nome Showdown (`Pokemon.ts:348`). Status/tipos/habilidades/catch rate/moves por forma não aplicados em todo lugar (TODO em `catching/index.ts`, `Experience.ts`). Troca de forma (Rotom, Deoxys, Oricorio etc.) MISSING. |
| Aprendizado por nível | PORT_HAS | – | `K/pokemon/Pokemon.kt` (learnset) | Mensagem de novo golpe; seleção pelo menu (dropdown) = relearner implícito. Moveset de selvagem é **4 aleatórios** ≤ nível (upstream: `D/moveset_builders/wild.json`, últimos golpes aprendidos). |
| TMs (`D/tms`, 335; TM Machine; `obtainMethods`) | MISSING | M | `K/item/interactive/TechnicalMachineItem.kt`, `K/block/entity/TMMachineBlockEntity.kt`, `K/tms/obtain/*` | Prefixo `tm:` do learnset ignorado (`speciesData.ts:227` só aceita nível numérico). |
| Egg moves / Tutor | MISSING | S | learnset `egg:`/`tutor:`, `TeachCommand.kt` | Idem. Sem breeding upstream, egg moves só via tutor/teach. |
| Move relearner | PARTIAL | S | `K/client/gui/summary/...` (move swap) | Implícito no dropdown de golpes do `showPokemonGUI`. |
| Apelido | PORT_HAS | – | `K/pokemon/Pokemon.kt` nickname | `textField` no `showPokemonGUI`. Não aplica `nameTag` na entidade? (verificar). |
| Amizade | PARTIAL | S | `K/pokemon/Pokemon.kt` friendship, `FriendshipCommand.kt` | Valor inicial = baseFriendship; nunca muda (ver seção 3). |
| Held items (dar/trocar) | PORT_HAS | – | `K/pokemon/helditem/*` | Agachar+interagir (`events/ExchangeHeldItem.ts`); inventário slot 0 da entidade. Efeitos fora de batalha (leftovers? Amulet Coin, Everstone bloqueando evolução, Lucky Egg) parciais: Lucky Egg sim; Everstone não checado. |
| Marcas (`D/marks`, 168) + callbacks `apply_marks` | MISSING | M | `K/api/mark/*`, `D/callbacks/*/apply_marks.molang`, `MarkGiveCommand.kt` | Títulos de marca aparecem no nome; exige sistema de marcas + UI na summary. |
| Cosmetic items (`D/cosmetic_items`, 29) | MISSING | M | `K/CobblemonCosmeticItems.kt`, `K/pokemon/cosmetic/*` | Aspect `cosmetic_item-*` → variante visual; o importador já resolve variantes por aspect, falta interação "dar item cosmético". |
| Tamanho intrínseco / baby size | MISSING | S | `config.pokemonIntrinsicSizeMin/Max`, `babyPokemon*` | Sem escala por indivíduo (Script API estável não muda `minecraft:scale` dinamicamente; exigiria component groups por faixa). |
| Tera type / Dynamax level / Gmax | MISSING | S | `config.teraTypeRate`, `maxDynamaxLevel` | Showdown suporta; Cobblemon 1.8 não usa em batalha por padrão (só dados). |
| Gênero, shiny, OT | PORT_HAS | – | – | Shiny rate fixo 1/8192. |

### 5. Evolução

| Sistema | Status | Tam. | Fonte Cobblemon | Notas do port |
|---|---|---|---|---|
| Variantes level_up / item_interact / trade | PORT_HAS (trade sem troca real) | – | `K/pokemon/evolution/variants/*` | `scripts/evolution/variants`. Trade depende de sistema de troca (MISSING). |
| Variante block_click (ex.: pedra/bloco específico) | MISSING | S | `K/pokemon/evolution/variants/BlockClickEvolution.kt` | Viável com `playerInteractWithBlock`. |
| Requisitos | PARTIAL | S | `K/pokemon/requirements/*` (29 classes) | Port cobre ~23. **Não rastreados** (`UntrackedRequirement`): `blocks_traveled`, `advancement`, `property_range`. Faltam `area`, `chance`, `negate`/`not`, `owner_held_item`. `structure` sempre falso (Bedrock). Progressos: `defeat` ok; `use_move`, `recoil`, `damage_taken`, `battle_critical_hits` existem. |
| Confirmação | PORT_HAS (form) | – | `K/client/gui/summary/...` evolve button | Evolução fica em `readyEvolutions` + som/mensagem; confirmada pelo toggle "Evolve" no `showPokemonGUI`. |
| Animação de evolução | MISSING | S | `K/client/render/...EvolutionAnimation`, partículas `evolution` | Viável com partículas + `playSound` + `camera` fade (estável) — só cosmético. |
| Everstone bloqueando | MISSING | S | `HeldItemRequirement`/`everstone` | Não verificado no port. |

### 6. Pokédex (1.6+)

| Sistema | Status | Tam. | Fonte Cobblemon | Notas do port |
|---|---|---|---|---|
| Registro visto/capturado por jogador | MISSING | M | `K/pokedex/*`, `K/api/pokedex/*` | Base para Repeat Ball, captura crítica, callbacks. Armazenamento: dynamic property por jogador (bitset). |
| Item Pokédex (7 cores) + scanner | PARTIAL-VIÁVEL / scanner NOT_POSSIBLE fiel | M | `K/item/PokedexItem.kt`, `K/client/pokedex/scanner` | Scanner com overlay/zoom é client-side Java. Aproximação: usar item → raycast `getEntitiesFromViewDirection` (estável) → registra "visto" e abre entrada. |
| Entradas (`D/dex_entries`, 1098) e dexes regionais (`D/dexes`, 12) | MISSING | M | `D/dex_entries/pokemon`, `D/dexes/*.json` | Importador ainda não gera. UI via ActionForm/CustomForm (lista paginada + detalhes com textos do lang). |
| Dex additions | N/A (só README) | – | `D/dex_additions`, `D/dex_entry_additions` | Pastas de extensão para datapacks. |

### 7. Criação, pasto, montaria, ombro, seguir, comportamentos, interações, drops

| Sistema | Status | Tam. | Fonte Cobblemon | Notas do port |
|---|---|---|---|---|
| Breeding / ovos | N/A no upstream | – | só `K/api/pokemon/egg/EggGroup.kt` e eventos `CollectEggEvent`/`HatchEggEvent` (ganchos para addons) | Cobblemon 1.8.2 **não** tem breeding jogável. Fora do escopo de paridade. |
| Pasture (bloco de pasto, até 16 Pokémon soltos, `pasture_*` config) | MISSING | M | `K/block/PastureBlock.kt`, `K/block/entity/PokemonPastureBlockEntity.kt`, `K/client/gui/pasture/*` | Viável: bloco custom + custom component + form de seleção do PC + entidades "owned" com `home`/`restrict` (componente `minecraft:home` estável no JSON). Importante: port hoje mata Pokémon com dono ao recarregar chunk (`main.ts` `entityLoad`), precisa exceção para pastados. |
| Montaria (`D/ride_settings`, 13 controladores: horse, bird, jet, glider, dolphin, submarine, boat, hover, rocket…; `riding` em 48+ espécies só da gen1) | PARTIAL-VIÁVEL (terra) / difícil (ar/água) | L | `K/CobblemonRideSettings.kt`, `K/api/riding/*`, `K/client/gui/RideControlsOverlay.kt` | Nada no port. Terra: `minecraft:rideable` + `minecraft:input_ground_controlled` + `behavior.player_ride_tamed` no JSON gerado (importador), por component group ativado ao montar. Ar/água: controle por script com `player.inputInfo.getMovementVector()` + `entity.applyImpulse` (ambos estáveis em 2.10) — jitter de rede provável. Stamina/HUD: `onScreenDisplay.setActionBar`. |
| Ombro (shoulder mount, 92 espécies `shoulderMountable`) | MISSING (viável) | M | `K/pokemon/activestate/ShoulderedState.kt`, `K/client/render/...Shoulder` | Bedrock já monta papagaio no ombro: `minecraft:rideable` do `player.json` com seats para família `parrot_tame`. Adicionar seats/família `pokemon_shoulder` no `behavior_packs/CobblemonBedrock/entities/player.json` + `addRider` por script. Posição/rotação do assento é fixa por seat. |
| Seguir o dono (Pokémon fora da bola) | PORT_HAS | – | `K/entity/pokemon/ai/*` | `cobblemon:owned` com `behavior.follow_owner` (`tools/importer/entities.ts:224`). Sem teleporte ao dono quando longe? (vanilla follow_owner teleporta a >12). Sem "stay"/"wander" comandos. |
| Comportamentos (`D/behaviours`, 49 JSON: wanders, wanders_air/water/hover, panics, retaliates, fights_melee, attack_hostile_mobs, defend_owner, moves_to_water/lava, looks_*, stationary, uses_healing_machine, battler, chats…) | PARTIAL | M | `K/CobblemonBehaviours.kt`, `K/entity/ai/*` (incl. `FollowHerdLeaderTask`, `FleeFromAttackerTask`) | Importador mapeia só andar/nadar/voar/olhar (`entities.ts:158-196`). Faltam: pânico/fuga, retaliação, atacar mobs hostis, defender dono, seguir líder de herd, preferências de água/lava. Quase tudo existe como componente vanilla (`behavior.panic`, `behavior.hurt_by_target`, `behavior.nearest_attackable_target`, `behavior.owner_hurt_by_target`, `behavior.follow_mob`) → S–M no importador. |
| Dormir (`sleep` na espécie: luz, horário, deita) | MISSING | S | `K/entity/pokemon/ai/tasks/*Sleep*`, `behaviour.resting` na espécie | Propriedade `cobblemon:sleeping` existe na entidade e é usada pelo animation controller, mas **nenhum script a liga**. Viável por loop de script (tempo/luz) ou `minecraft:environment_sensor` + `behavior.sleep`. |
| Nadar/voar | PORT_HAS | – | `behaviour.moving` | Via importador. |
| Interações (`D/pokemon_interactions`, 167: tosar/escovar/ordenhar/balde com item → drop, som, `shrink_item`, cooldown) | MISSING | M | `K/api/interaction/*`, `D/pokemon_interactions/*.json` | Viável: gerar tabela no importador + tratar em `handlePokemonInteract` (`scripts/events/ScriptEvents.ts`) por item na mão. Hoje qualquer item em Pokémon próprio vira tentativa de uso/evolução; propriedade `cobblemon:has_been_sheared` já é citada. |
| Drops/loot (espécie `drops`, `D/loot_table` 639 incl. `alpha`, `fishing`, `fossils`; callback `pokemon_alpha_drops.molang`) | MISSING | S | `K/api/drop/*`, `K/loot/*` | `drops` parseado mas não usado. Viável via `dimension.spawnItem` ao derrotar/matar selvagem. Loot tables Java de blocos precisam conversão (vanilla Bedrock loot tables têm formato próximo). |
| Cry ambiente (`ambientPokemonCryTicks`) | MISSING | S | `config.ambientPokemonCryTicks` | Sons de cry já gerados; basta loop/`minecraft:ambient_sound_interval`. |

### 8. NPCs, diálogos, troca, inicial

| Sistema | Status | Tam. | Fonte Cobblemon | Notas do port |
|---|---|---|---|---|
| NPCs (`D/npcs`: ai_test, kitchen_sink, sacchi, standard; `D/npc_presets/battler_test.json`) | MISSING | L | `K/entity/npc/*`, `K/api/npc/*`, `D/behaviours/npc`, `D/molang/npc` | Upstream é framework (MoLang + brain); só exemplos + Sacchi. Port: entidade NPC própria com skin (geometria humanoide), config por dynamic property, `interact` → diálogo, `battle` → `BattleActor` NPC com IA. |
| Treinadores NPC em batalha (party fixa/pool, IA) | MISSING | M | `K/entity/npc/NPCBattleActor.kt`, `K/battles/ai/*`, `K/CobblemonPartyPools.kt`, `CobblemonPartyCompositions.kt` | Precisa IA (Showdown tem `RandomPlayerAI`; port pode portar `StrongBattleAI`). |
| Diálogos (`D/dialogues`, 4: example, npc-example, sacchi_*) | MISSING | M | `K/api/dialogue/*`, `K/client/gui/dialogue/*` | Mapeia bem para `ActionFormData`/`MessageFormData` (páginas + escolhas) ou DDUI `CustomForm` (retrato via `image`). Expressões MoLang nos diálogos precisam de um mini-interpretador ou subset. |
| Troca entre jogadores | MISSING | M | `K/trade/*` (`TradeManager`, `ActiveTrade`), `K/client/gui/trade/*`, `config.tradeMaxDistance` | Viável com forms (pedido → cada um escolhe Pokémon do time → confirmação dupla). Destrava `TradeEvolution`. |
| Trocas com aldeões (`K/CobblemonTradeOffers.kt`, profissões) | MISSING | S | `K/CobblemonVillagerProfessions.kt` | Bedrock: trade tables de aldeão são JSON de entidade vanilla — sobrescrever é invasivo; baixo impacto. |
| Seleção de inicial | PORT_HAS (simplificada) | S | `K/starter/CobbledStarterHandler.kt`, `K/config/starter/*`, `K/client/gui/startselection/*` | 27 iniciais fixos (`scripts/GUI/StarterGUI.ts`), nível 5, sem categorias por geração nem config (`starterConfig.json`), sem shiny/aspects configuráveis. |

### 9. Culinária, fósseis, berries, apricorns e pastas de dados diversas

| Sistema / pasta | O que representa | Status | Tam. | Fonte Cobblemon | Notas do port |
|---|---|---|---|---|---|
| Campfire Pot (culinária) | Panela sobre fogueira; receitas `cobblemon:cooking_pot` (27) e `cooking_pot_shapeless` (91) em `D/recipe/campfire_pot` → Poké Puffs, Poké Snacks, Aprijuices, iscas, comidas regionais, com temperos | MISSING | L | `K/block/campfirepot/*`, `K/block/entity/CampfireBlockEntity.kt`, `K/client/gui/cookingpot/*`, `K/api/cooking/*` | Bedrock não tem container de UI customizável estável; alternativa: bloco custom + form (ModalForm/CustomForm) que lê o inventário do jogador e consome ingredientes; ou bloco com `minecraft:inventory` via entidade auxiliar (padrão já usado no PC? PC usa forms). |
| `D/seasonings` (76) | Ingrediente → cor/sabor/efeito aplicado a Poké Snack, Puff, Aprijuice, isca (`spawn_bait_effects`) | MISSING | M | `K/api/cooking/Seasonings.kt`, `Seasoning.kt` | Depende da panela. |
| Poké Snack (bloco) | Isca de área: spawns por perto (ver seção 1) | MISSING | M | `K/block/PokeSnackBlock.kt` | Idem. |
| Poké Puff, Aprijuice, comidas regionais | Itens de amizade/EV/boost de ride stats | MISSING | M | `K/item/PokePuffItem.kt`, `AprijuiceItem.kt`, `RegionalFoodItem.kt`, `D/mechanics/aprijuices.json` | Itens de comida regional existem parcialmente no BP (ex.: `braised_vivichoke`, `leek_and_potato_stew`) sem efeito em Pokémon. |
| Iscas (bait) | Consumidas pela Poké Rod; efeitos em `D/spawn_bait_effects` | MISSING | M | seção 1 | – |
| Fósseis (`D/fossils`, 15) + `D/natural_materials` | Fóssil → espécie; *natural materials* = "matéria orgânica" (conteúdo 1–4) que alimenta o Restoration Tank. Multibloco Fossil Analyzer + Monitor + Restoration Tank; callback `fossil_revived/apply_marks` | MISSING | L | `K/api/fossil/*`, `K/block/multiblock/*`, `K/block/entity/FossilAnalyzerBlockEntity.kt`, `RestorationTankBlockEntity.kt` | Multibloco + animação do tanque; viável simplificado (1 bloco + form), itens de fóssil não existem no BP. |
| Berries (`D/berries`, 70) | Arbusto de berry: tempo de crescimento, fatores de bioma/temperatura/umidade, mulch favorito, **mutações** entre berries vizinhas, yield, formas/modelos | PARTIAL | M | `K/block/BerryBlock.kt`, `K/block/entity/BerryBlockEntity.kt`, `K/berry/*` | Itens de berry existem (com tag `cobblemon:plants`), **sem bloco de arbusto**. Crescimento viável com `PlantComponent` existente; mutações/yield por script. |
| Apricorn trees | Árvore que gera apricorns por estágio | PORT_HAS | – | `K/block/ApricornBlock.kt`, `ApricornSaplingBlock.kt` | Blocos, sementes, crescimento, geração (`features/*_apricorn_prefab`), madeira/portas/placas. Sem `baseApricornTreeGenerationChance` configurável. |
| Mulch | Acelera/altera crescimento de berries e apricorns | MISSING | S | `K/item/MulchItem.kt` | Itens existem (`*_mulch.json`), sem efeito. |
| Mints (planta) | Folhas/sementes de mint → Mint items | MISSING | S | blocos `RED_MINT…WHITE_MINT` | Itens existem, blocos de planta não. |
| Hourglass dusts (`D/hourglass_dusts`, 6) | Compat com o mod **Supplementaries** (pó na ampulheta: bright/heal/metal/quick/silver powder, remedy) | NOT_POSSIBLE_IN_BEDROCK (N/A) | – | condição `fabric:all_mods_loaded supplementaries` | Integração com mod Java; ignorar. |
| `D/moonlight/soft_fluid` (16) | Compat com o mod **Moonlight Lib** (poções como fluidos em jarros) | NOT_POSSIBLE_IN_BEDROCK (N/A) | – | condição `moonlight` | Ignorar. |
| `D/arts_and_crafts/paintbrush_palette` | Compat com o mod **Arts & Crafts** (pincel pinta Plaques) | NOT_POSSIBLE_IN_BEDROCK (N/A) | – | – | Ignorar (Plaques também não existem no port). |
| `D/mechanics` (5: potions, remedies, berries, aprijuices, slowpoke_tails) | Constantes de balanceamento de itens (cura de poção 20/60/120, remédios, berries, aprijuice, cauda de Slowpoke) | MISSING (consumidores) | S | `K/mechanics/*Mechanic.kt`, `K/CobblemonMechanics.kt` | Usar ao implementar itens fora/dentro de batalha. |
| `D/callbacks` (11 MoLang) | Ganchos em eventos: `battle_fainted/pokemon_alpha_drops`, `battle_victory/npc_battle_end_scripts`, `pokemon_captured/{apply_marks,remove_aspects,wallpaper_unlocks}`, `pokemon_entity_spawn/{apply_marks,apply_potential_marks}`, `fossil_revived/apply_marks`, `bobber_spawn_pokemon_post/apply_marks`, `player_tick_pre/{wallpaper_unlocks,partner_mark}` | MISSING | M | `K/CobblemonCallbacks.kt` | Port tem `scripts/events/CobblemonEvents.ts` (emite `BATTLE_FAINTED`); reimplementar em TS em vez de MoLang. |
| `D/action_effects` (154: moves, activates, damages, statuses, starts, misc, npc) | Timelines de efeito visual de batalha (animação do golpe, partículas, sons, câmera) | MISSING | M | `K/api/moves/animations/*` | Viável parcialmente: `playAnimation` + `spawnParticle` + `playSound`. Partículas Snowstorm do Cobblemon já são Bedrock-format (ver RP `particles`). |
| `D/molang` (12) | Scripts MoLang server-side (home_walk_task, wander_around_hive, npc, pokemon) | MISSING / NOT_POSSIBLE direto | – | `K/api/molang/*` | Bedrock não executa MoLang server-side arbitrário; reescrever em TS. |
| `D/structure` (1235), `D/worldgen` (651) | Estruturas (fishing boats, fossils, habitats, ruins, shipwreck coves) e features (apricorns, ores, gemas, tumblestone, berries) | PARTIAL | L | `D/worldgen/*` | Port gera apricorns e minérios de pedras evolutivas. `.nbt` Java → `.mcstructure` exige conversão (existem ferramentas); jigsaw estável no Bedrock desde 1.21.50 (verificar). |
| `D/painting_variant`, `D/trim_pattern`, `D/unlockable_pc_box_wallpapers` | Pinturas, padrão de armadura, papéis de parede do PC | MISSING | S | – | Baixo impacto. Wallpapers dependem de UI de PC rica. |
| `D/advancement` (804) | Conquistas | NOT_POSSIBLE_IN_BEDROCK (advancements) | – | – | Bedrock não tem advancements de add-on; afeta requisito `advancement` e TMs com `PlayerHasAdvancementObtainMethod`. Alternativa: flags em dynamic properties + toasts via `setTitle`. |
| `D/habitat_pools` (51) | Pools de spawn de "habitats" (estruturas ativáveis) | MISSING | M | seção 1 | – |
| `D/held_items/eggantberry.js` | Script Showdown de held item custom | PARTIAL | S | – | Verificar se é injetado no `@pkmn/sim`. |
| `D/bag_items/*.js` (11) | Scripts Showdown dos itens de mochila | MISSING | S | – | Ver seção 3. |
| `D/species_features*`, `D/global_species_features` | Features de espécie (formas, padrões, blocks_traveled) | PARTIAL | – | – | Importador usa para variantes; `blocks_traveled` não rastreado. |
| `D/tags`, `D/loot_table`, `D/recipe` (988) | Tags, loot, receitas | PARTIAL | M | – | BP tem 280 receitas e 2 loot tables à mão. Receitas `cobblemon:brewing_stand` (27) → Bedrock `recipe_brewing_mix` só aceita poções como base: NOT_POSSIBLE fiel, usar crafting. Receitas `create:*`/`farmersdelight:*` = compat mods (N/A). |
| Gems de tipo / Tumblestone / Gilded chest / Gimmighoul / Display case / Lectern / Disc shelf / Relic coins / Plaques / Incense Sweet | Blocos novos 1.6–1.8 | MISSING | M | `K/CobblemonBlocks.kt` | Conteúdo; baixa prioridade exceto Incense (spawn). |

### 10. Comandos

Registrados em `K/CobblemonCommands.kt`; implementações em `K/command/*.kt`. Port: `scripts/commands.ts` (custom commands estáveis `CustomCommandRegistry`, funcionam em console) + script events de debug em `scripts/events/ScriptEvents.ts` (`cobblemon:give_pokemon_to_self`, `cobblemon:debug_battle`, `cobblemon:gain_level`).

| Comando Cobblemon | Função | Port | Tam. |
|---|---|---|---|
| `givepokemon`/`pokegive` (args `properties`, `player`) | Dá Pokémon por PokemonProperties | PARTIAL (`cobblemon:givepokemon <espécie> [nível] [shiny]`; sem properties completas nem alvo) | S |
| `spawnpokemon`/`pokespawn` (args `pos`, `properties`) | Spawna selvagem | PARTIAL (`cobblemon:spawnpokemon`, sem posição/properties) | S |
| `spawnpokemonfrompool`, `checkspawn` | Spawn forçado do pool / listar spawns possíveis aqui | MISSING | S |
| `spawnallpokemon`, `giveallpokemon` | Debug massa | MISSING | S |
| `pc`, `pokebox`/`pokeboxall` | Abre PC / guarda no PC | PC PORT_HAS (`cobblemon:pc`); pokebox MISSING | S |
| `pcsearch`, `pctake`, `takepokemon` | Buscar/retirar Pokémon de outro jogador (admin) | MISSING | S |
| `clearparty`, `clearpc` | Limpar | MISSING | S |
| `boxcount`, `renamebox`, `changewallpaper`, `unlockpcboxwallpaper` | PC: nº de caixas, nome, papel de parede | MISSING (storage já prevê nome de caixa `pc:<box>:name`) | S |
| `healpokemon` | Cura time | MISSING | S |
| `levelup` | Sobe nível | MISSING (só script event `cobblemon:gain_level`) | S |
| `friendship` | Ver/definir amizade | MISSING | S |
| `held_item` | Definir held item | MISSING | S |
| `teach` | Ensinar golpe | MISSING | S |
| `querylearnset` | Pode aprender golpe? | MISSING | S |
| `pokemonedit` | Editar propriedades | MISSING | S |
| `pokemonrestart` | Reiniciar (apagar time/PC e reoferecer inicial) | MISSING | S |
| `openstarterscreen` | Reabrir escolha de inicial | PARTIAL (`cobblemon:starter`, só sem time) | S |
| `stopbattle`, `spectatebattle` | Encerrar / assistir batalha | MISSING | S |
| `abandonmultiteam` | Sair de time multi | MISSING (depende de multi) | S |
| `pokedex grant/revoke all/only` | Conceder/remover registros | MISSING (sem Pokédex) | S |
| `givemark`, `takemark`, `giveallmarks` | Marcas | MISSING | S |
| `givetm`, `technicalmachine` | TMs | MISSING | S |
| `spawnnpc`, `npcedit`, `npcdelete`, `opendialogue`, `applyplayertexture` | NPCs/diálogos | MISSING | M |
| `behaviouredit` | Editor de comportamento (UI) | MISSING | – |
| `freezepokemon` | Congela animação (debug/screenshot) | MISSING | S |
| `cobblemonconfig` | Editar config em jogo | MISSING (config só via dynamic property `cobblemon_config`) | S |
| `cobblemon` (info) | Versão/info | MISSING | S |
| `runmolang`, `runmolangscript`, `bedrockparticle`, `transformmodelpart`, `changescaleandsize`, `changewalkspeed`, `changeeyeheight`, `getnbt`, `reloadshowdown`, `testcommand`, `teststore`, `testpcslot`, `testpartyslot`, `cobblemonclicktext` | Debug/dev/internos | NOT_POSSIBLE ou irrelevante (MoLang server, NBT, modelos Java) — `bedrockparticle` ≈ `/particle` vanilla | – |
| (port) `cobblemon:party` | Time (mandar/recolher) | Extra do port (no Java é tecla/HUD) | – |

### 11. Telas (client/gui) → Bedrock

Ferramentas disponíveis (estáveis, verificadas em `node_modules`): `@minecraft/server-ui` **2.2.0** exporta `ActionFormData`, `ModalFormData`, `MessageFormData` **e DDUI estável**: `CustomForm` (métodos `button, closeButton, divider, dropdown, header, image, label, slider, spacer, textField, toggle`), `MessageBox`, `Observable{Boolean,Number,String,UIRawMessage}`, `UIManager.closeAllForms`. `@minecraft/server` 2.10: `onScreenDisplay.setActionBar/setTitle/setHudVisibility/hideAllExcept`, `player.inputInfo.getMovementVector()`, `playMusic`, `applyImpulse`, `EntityRideableComponent.addRider`. O RP já usa **JSON UI** (`resource_packs/CobblemonBedrock/ui/battle.json`, `pc.json`, `server_form.json`) para reestilizar forms pelo prefixo do título ("Battle:", "PC").

| Tela Cobblemon (`K/client/gui/...`) | Status | Mapeamento Bedrock | Tam. |
|---|---|---|---|
| Party overlay HUD (`PartyOverlay.kt`) | PARTIAL-VIÁVEL (hack) | Não há HUD custom por script. Opções: (a) `setActionBar`/`setTitle` com texto codificado + JSON UI em `hud_screen.json` que lê `#hud_title_text_string` e desenha ícones/HP (técnica conhecida da comunidade; frágil, mas sem beta); (b) item "Party" que abre `CustomForm`. Hoje: só `/cobblemon:party` e emote. | M |
| Summary (`summary/*`: info, stats, moves, marks, ribbons) | PARTIAL | Hoje `ModalFormData` (apelido + dropdown de golpes + evoluir). Migrar para `CustomForm` com `header/label/image` (sprite), abas via botões, stats/IV/EV/natureza/habilidade/amizade/held item. | M |
| PC (`pc/*`: grid 30 slots, arrastar, filtro, release, wallpapers, nome de caixa) | PARTIAL | `ActionFormData` paginado (30 botões + JSON UI grid em `pc.json`). Sem arrastar (NOT_POSSIBLE), usar "selecionar origem → destino". Busca/filtro via `textField`. | S–M |
| Starter (`startselection/*`) | PORT_HAS (simplificada) | `ActionFormData` com sprites (`GUI/StarterGUI.ts`); falta categorias/modelo 3D (NOT_POSSIBLE: preview 3D de entidade em form). | S |
| Batalha (`battle/BattleGUI.kt`, `BattleOverlay.kt`: tiles de HP, retratos, log, seleção de alvo, bag, switch) | PARTIAL | `ActionFormData` + JSON UI (`battle.json`). Com DDUI `CustomForm` + `Observable*` dá para ter HP/estado ao vivo sem reabrir. Overlay persistente durante animações: NOT_POSSIBLE fiel (forms são modais); aproximar com actionbar. Falta aba "Bag" e seleção de alvo (doubles). | M |
| Pokédex (`pokedex/*`) + scanner | MISSING | Lista/detalhe em `ActionFormData`/`CustomForm` com sprites e textos de `dex_entries`. Scanner (lente + zoom) NOT_POSSIBLE fiel. | M |
| Evolução (tela de confirmação + animação) | PARTIAL | Toggle no summary; `MessageFormData` "Evoluir? Sim/Não" + partículas/som. | S |
| Troca (`trade/*`) | MISSING | Duas `ActionFormData` (escolha) + `MessageFormData` (confirmação) sincronizadas por script; sem visualização simultânea ao vivo (DDUI observables ajudam). | M |
| Diálogo NPC (`dialogue/*`) | MISSING | `ActionFormData`/`CustomForm` (retrato via `image`, opções como botões); vanilla também tem `minecraft:npc` dialogue (`/dialogue` + `.dialogue.json` no BP) — alternativa nativa estável. | M |
| Culinária (`cookingpot/*`) | MISSING | Sem grid de container custom: form de receita (lista do que dá para cozinhar com o inventário). | M |
| Pasture (`pasture/*`) | MISSING | `ActionFormData` listando time/PC + recall. | S |
| TM Machine (`tmmachine/*`) | MISSING | Form de lista de TMs desbloqueados + custo. | S |
| Interação rápida (`interact/wheel`, partyselect, moveselect, battleRequest) | PARTIAL | Wheel NOT_POSSIBLE; hoje interação abre menu/batalha direto. `ActionFormData` "Batalhar / Trocar / Desafiar em dupla" ao interagir com jogador. | S |
| Ride controls overlay, habitat editor, NPC editor, behaviour editor, config screen, toasts | MISSING | Ride: actionbar. Config: `ModalFormData` para admin. Toasts: `setTitle`/`sendMessage`. Editores: baixa prioridade. | S–M |
| Retratos 3D animados / modelos em GUI | NOT_POSSIBLE_IN_BEDROCK | Forms só aceitam textura 2D; usar sprites gerados (o importador já fornece `getPokemonSpriteTexture`). | – |

### 12. Config / gamerules

Config do port: `scripts/Config.ts` (`CobblemonConfig` salvo em `world` dynamic property `cobblemon_config`), com 11 campos: `maxPokemonLevel`, `maxPokemonFriendShip`, `defaultBoxCount` (**30**; upstream 40), `preventCompletePartyDeposit`, `allowExperienceFromPVP`, `experienceShareMultiplier`, `luckyEggMultiplier`, `experienceMultiplier`, `mainCharacter`, `maxNearbyBlocksHorizontalRange`, `maxNearbyBlocksVerticleRange`. Sem comando/UI para editar. Upstream: `K/config/CobblemonConfig.kt` (~90 campos).

| Opção upstream (default) | Port | Impacto |
|---|---|---|
| `shinyRate` 8192 | constante `SHINY_RATE` (`Pokemon.ts:54`), fora da config | Alto (servidores costumam mexer) |
| `enableSpawning`, `pokemonPerChunk` 1, `pokeSnackPokemonPerChunk` 2, `maximumSpawnsPerPass` 8, `ticksBetweenSpawnAttempts` 20, `minimum/maximumSpawningZoneDistanceFromPlayer` 16/64, `minimumDistanceBetweenEntities` 8, `worldSpawningBlocklist`, `minimumLevelRangeMax` 10 | constantes em `spawning/Spawner.ts` (20–48 blocos, 10 selvagens/64 blocos, 10 ticks) + `setNaturalSpawning` | Alto |
| `despawnerNear/FarDistance`, `despawnerMin/MaxAgeTicks` | `minecraft:despawn` fixo 48–128 no entity JSON | Médio |
| `defaultFleeDistance` 32, `battleWildMaxDistance` 12, `battlePvPMaxDistance` 32, `battleSpectateMaxDistance` 64, `allowSpectating`, `awardExperienceToFaintedPokemon`, `awardExperienceOnBattleLoss`, `tradeMaxDistance` 12 | `fleeDistance` 30 fixo; resto ausente | Médio |
| Cura: `healPercent` 0.05 / `healTimer` 60, `defaultFaintTimer` 300, `faintAwakenHealthPercent`, `infiniteHealerCharge`, `maxHealerCharge` 6, `secondsToChargeHealingMachine` 900 | Healing Machine tem carga própria (`HealingMachineComponent.ts`), sem cura passiva | Médio |
| `playerDamagePokemon` true | não tratado (selvagens recebem dano vanilla?) | Médio |
| `announceDropItems`, `defaultDropItemMethod`, `dropAfterDeathAnimation` | sem drops | Baixo |
| `ambientPokemonCryTicks` 1080 | ausente | Baixo |
| `displayEntityLevelLabel/NameLabel`, `displayEntityLabelsWhenCrouchingOnly` (client) | nametag? (não verificado; Bedrock mostra `nameTag` só ao mirar) | Baixo |
| `pokemonIntrinsicSizeMin/Max`, `baby*`, `minimumRidingScale` | ausente | Baixo |
| `fossilMachine*Chance`, `honeySlather*Chance`, `teraTypeRate`, `maxDynamaxLevel`, `infiniteTmUses`, `defaultPasturedPokemonLimit`, `pasture*`, `maxInsertedFossilItems`, `maxRootsInArea`, `bigRootPropagationChance`, `energyRootChance`, `appleLeftoversChance`, `baseApricornTreeGenerationChance` | ausente (sistemas não existem; leftovers/apricorn têm constantes próprias) | – |
| `maxPokedexScanningDetectionRange`, `unlockAllMoveDexMovesByDefault`, `hideUnimplementedPokemonInThePokedex` | ausente | – |
| `passiveStatuses` (duração de sono/veneno fora de batalha) | ausente | Baixo |
| Starter config (`K/config/starter/StarterConfig.kt`: categorias, `promptStarterOnceOnly`, `allowStarterOnJoin`, `useLevelOverride`) | lista fixa | Médio |
| Interface/riding (client) | N/A | – |

Gamerules: Bedrock não permite gamerules custom; usar a config em dynamic property + comando `cobblemon:config` (ModalFormData para operadores).

### 13. Proposta de workstreams (ordem por impacto no jogador)

Regras: cada workstream é dono exclusivo dos arquivos listados; integração só por funções exportadas (contratos). Arquivos "quentes" com dono único: `scripts/Pokemon.ts` e `scripts/events/ScriptEvents.ts` (WS1), `scripts/main.ts` e `scripts/Config.ts` (WS4 — os outros pedem campos/assinaturas por PR pequeno), `tools/importer/entities.ts` (WS6), `tools/importer/spawns.ts` (WS3).

| # | Workstream | Escopo (paridade) | Arquivos (dono) | Contratos expostos/consumidos | Tam. |
|---|---|---|---|---|---|
| 1 | **Dados do Pokémon e itens** | Ganho de EV (API), sistema de amizade (level up, andar, batalha, Luxury/Soothe Bell), HA + Ability Capsule/Patch, mints, vitaminas/PP Up/asas, poções/revive/status heal **fora** de batalha, TMs/tutor/egg moves (learnset `tm:`/`tutor:`/`egg:`), moveset selvagem por `moveset_builders/wild.json`, formas (stats/tipos/habilidades por forma), troca de forma por item, Everstone, marcas (`D/marks`) e cosméticos (`D/cosmetic_items`), `D/mechanics` | `scripts/Pokemon.ts`, `PokemonProperties.ts`, `speciesData.ts`, `Experience.ts`, `events/*` (inclui `ScriptEvents.ts` e `useItemOnPokemon`), novo `scripts/items/**`, `scripts/marks/**`; importador: novo `tools/importer/data.ts` (tms, marks, cosmetics, mechanics) | Exporta `addEvs(pokemon, yield)`, `changeFriendship(pokemon, delta, cause)`, `registerPokemonItemHandler(itemId, fn)`, `registerInteraction(...)` (usado por WS6), `applyCaptureEffect` hooks | L |
| 2 | **Batalhas** | Aba Bag (poções/X items/revive + `D/bag_items/*.js` no sim), Run/forfeit reais, distâncias (12/32/64), wild doubles + PvP doubles/triples/multi com seleção de alvo, IA (`StrongBattleAI`) para NPC/selvagem, chamada de `addEvs`/`changeFriendship` no faint/vitória, drops de selvagem derrotado (+ alpha drops), `awardExperience*`, bônus não-OT, espectador, `action_effects` (animações/partículas de golpe) | `scripts/battle/**` (inclui novo `battle/ai/`), `scripts/GUI/Battle.ts`, `resource_packs/.../ui/battle.json`, `scripts/showdown.ts` | Consome WS1 (EV/amizade); exporta `startBattle({format, sides})`, `NPCBattleActor` (para WS8) | L |
| 3 | **Spawning** | Herds (1962 entradas) + Alphas (bucket boss, aspect `alpha`, moveset alpha), buckets 1.8.2, level scaling pelo time, caps (`pokemonPerChunk`, distância mínima entre entidades, spawns por passe), held items de spawn, slime chunk, despawn por idade×distância (script), shiny rate/config de spawn, `spawn_rules`, `checkspawn`/`spawnpokemonfrompool` | `scripts/spawning/**`, `tools/importer/spawns.ts`, `generated/scripts/spawns.ts` (formato) | Exporta `spawnFrom(positionType, ctx, influences[])` e `SpawnInfluence` (usado por WS7 pesca/snack/iscas e WS9 incenso/mel); consome propriedade/aspect `alpha` do WS6 | M |
| 4 | **UI, HUD, comandos e config** | Summary rico (DDUI `CustomForm`: stats/IV/EV/natureza/amizade/marcas), PC (busca, renomear caixa, nº de caixas 40, release confirm), party HUD (actionbar/JSON UI `hud_screen.json`), starter com categorias/config, tela de evolução (confirmar + animação), todos os comandos admin da seção 10 (`healpokemon`, `levelup`, `teach`, `pokemonedit`, `clearparty`, `pctake`, `stopbattle`, `cobblemonconfig`…), config completa + editor em form | `scripts/GUI/index.ts`, `GUI/StarterGUI.ts`, `GUI/OKDialogBox.ts`, `scripts/commands.ts`, `scripts/Config.ts`, `scripts/starter.ts`, `scripts/pokemonStorage.ts`, `scripts/main.ts`, `resource_packs/.../ui/{pc,server_form,_ui_defs}.json` + novo `hud_screen.json` | Consome APIs de WS1/2/3/5; expõe `getConfig()` ampliado | M |
| 5 | **Captura e Pokédex** | Efeitos Heal/Friend/Luxury Ball, Repeat Ball, captura crítica, correções (timer, beast, lure), bolas ancient (16 itens + throwPower), captura em doubles, Pokédex (visto/capturado por jogador, item Pokédex + "scanner" por raycast, entradas `D/dex_entries` e `D/dexes`, UI), comando `pokedex grant/revoke`, callbacks `pokemon_captured` | `scripts/catching/**`, novo `scripts/pokedex/**`, `behavior_packs/.../items/pokeballs/**`, `behavior_packs/.../entities/pokeballs/**`, novo `tools/importer/dex.ts` | Exporta `markSeen/markCaught/hasCaught` (usado por WS2 ao ver oponente, WS4 summary) | M |
| 6 | **Entidades, IA, montaria, ombro, interações** | Comportamentos `D/behaviours` (pânico, retaliar, atacar hostis, defender dono, seguir líder de herd), dormir (`cobblemon:sleeping`), cry ambiente, escala alpha/tamanho, **montaria** (terra via `rideable`+`input_ground_controlled`; ar/água via `inputInfo`+`applyImpulse`; stamina na actionbar; `D/ride_settings`), **ombro** (seats no `player.json`), `D/pokemon_interactions` (tosar/escovar/ordenhar), exceção de despawn para pastados/ombro | `tools/importer/entities.ts`, `tools/importer/posers.ts`/`animations.ts` (se preciso), `behavior_packs/.../entities/player.json`, novo `scripts/riding/**`, `scripts/behaviour/**`, `scripts/interactions/**` | Consome `registerInteraction` do WS1; expõe component groups `cobblemon:alpha`, `cobblemon:rideable_*`, `cobblemon:pastured` | L |
| 7 | **Pesca, iscas, Poké Snack e culinária** | Poké Rods (48) + bobber (entidade projétil própria) + timer de fisgada + buckets de pesca + lure (encantamento), `spawn_bait_effects` (79), Campfire Pot (bloco + form de receita, 118 receitas), temperos (76), Poké Snack (bloco + spawner de área), Poké Puff/Aprijuice (amizade/boosts), comidas regionais | novos `scripts/fishing/**`, `scripts/cooking/**`, `behavior_packs/.../items/{rods,cooking}/**`, `behavior_packs/.../blocks/{campfire_pot,poke_snack}/**`, `behavior_packs/.../entities/bobber.json`, novo `tools/importer/cooking.ts` | Consome `spawnFrom("fishing", …)` e `SpawnInfluence` do WS3; `changeFriendship` do WS1 | L |
| 8 | **Social: troca, NPCs, diálogos, treinadores** | Troca jogador↔jogador (destrava `TradeEvolution`), menu de interação com jogador (desafiar singles/doubles, trocar), entidade NPC + skins, `D/npcs`/`D/npc_presets`/`D/dialogues` (subset MoLang), treinador NPC com party pool, `spawnnpc`/`npcedit`/`opendialogue` | novos `scripts/trade/**`, `scripts/npc/**`, `scripts/dialogue/**`, `scripts/ChallengePlayer.ts`, `behavior_packs/.../entities/npc.json`, RP de NPC | Consome `startBattle`/`NPCBattleActor` (WS2), `TradeEvolution` (WS1) | L |
| 9 | **Mundo: berries, mulch, mints, fósseis, pasto, blocos 1.6+** | Arbustos de berry (70, crescimento por bioma, mutações, yield), mulch, plantas de mint, fósseis (itens + máquina simplificada + `natural_materials`), **Pasture** (bloco + form + Pokémon soltos persistentes), TM Machine (bloco; lógica de TM do WS1), Incense Sweet/Saccharine (influências de spawn), gemas de tipo, estruturas (`.nbt`→`.mcstructure`) | `scripts/custom_components/**`, `behavior_packs/.../blocks/**` (exceto os do WS7), `features/**`, `feature_rules/**`, `loot_tables/**`, `recipes/**`, novo `scripts/pasture/**`, novo `tools/importer/worldgen*.ts` (estruturas/berries) | Consome `SpawnInfluence` (WS3), grupo `cobblemon:pastured` (WS6), `learnTM` (WS1) | L |

Sequência sugerida: WS1, WS2 e WS3 em paralelo (maior impacto: 320 itens sem efeito, batalha sem mochila/EV/amizade, 40% das spawns (1962 de 4892) descartadas incluindo todos os Alphas); WS4 e WS5 logo depois (dependem de APIs de 1/2/3 mas podem começar pela UI); WS6 em paralelo desde o início (arquivos isolados no importador); WS7, WS8, WS9 por último.
