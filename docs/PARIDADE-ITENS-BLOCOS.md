# Paridade de itens, blocos, worldgen e receitas — Cobblemon 1.8.2 vs port Bedrock

Status atual depois da onda "fechar os impossíveis + lacunas da auditoria" (frentes motor, mundo-sons, animacao,
retratos, ui-base e telas), da onda final (visual-batalha, mundo-detalhes, dados-ui e correções E2E), da revisão
final, da onda de fechamento (multi, visual-final, dados-ia, battle-leave e review-fixes) e da onda "adaptações e
limites" (adaptacoes, limites A e B, give e as rodadas 2 e 3 da review-fixes), em 2026-09-26. Ver
[`PARIDADE-MECANICAS.md`](PARIDADE-MECANICAS.md) para as mecânicas, a lista de lacunas da auditoria (§10) e o
que conferir num cliente real. Itens, blocos, receitas, loot e worldgen são gerados por `tools/importer/**` a
partir de `upstream/cobblemon` (não versionados em `generated/`); o comportamento fica em `scripts/**`. Números
da última execução de `npm run import` / `npm run validate` (12 769 JSON, 897 client entities, 34 attachables,
nenhum erro; na onda de fechamento, 902 entidades BP, 897 client entities e 2006 render controllers, nenhum erro e
nenhum aviso).

Legenda: **FEITO** · **PARCIAL** · **NÃO POSSÍVEL NO BEDROCK** (provado; a nota diz a adaptação) · **N/A NO COBBLEMON**
· **FALTA** (possível, ainda não feito).

## Estado final

Nas 57 linhas das tabelas abaixo: **57 FEITO** (2 delas FEITO (aproximação): sherds no vaso decorado e variantes de
pintura), nenhum PARCIAL, nenhum NÃO POSSÍVEL NO BEDROCK como status de linha e nenhuma FALTA.

| Contagem | Antes desta onda | Depois |
|---|---|---|
| Linhas | 56 | 57 (+1: "Variantes de pintura" em Cobertura) |
| FEITO | 55 | 57 |
| NÃO POSSÍVEL NO BEDROCK | 1 (sherds) | 0 |
| PARCIAL / FALTA | 0 / 0 | 0 / 0 |

Nesta onda ("adaptações e limites"): sherds no vaso decorado viraram FEITO (aproximação: vaso próprio, criado pela
mesa de trabalho); "Tags de comida vanilla" deixou de ser mista (`bee_growables` feito); a panela ganhou funil e
comparador; Mental Herb, Enfermeira (trocas, textura e `work_nurse`), dispenser (tesoura, mel, água), fazendeiro com as
sementes do Cobblemon, Pokédex na estante entalhada (tag), livro de receitas agrupado e as 4 pinturas entraram;
`strange_ball` e vaso decorado passaram a aceitar `/give` (frente give).

A única linha mista é "Partículas" (FEITO / NÃO POSSÍVEL NO BEDROCK: brilho e rastro dos olhos do Alfa). Notas de NÃO
POSSÍVEL ou FALTA dentro de linhas FEITO, com a adaptação anotada: ícone de TM por tipo, trim `automaton` (receita
pulada), busca "poke" = "poké" no livro, injeção em vilas vanilla, `hearty_grains` alagado e o comparador da Healing
Machine e do Metronome (FALTA: a técnica da panela serve, não foi aplicada).

Contagem com o trecho Python de [`PARIDADE-MECANICAS.md`](PARIDADE-MECANICAS.md#estado-final) (mesmas regras), com
os argumentos `docs/PARIDADE-ITENS-BLOCOS.md '## Cobertura'`: saída `57 {'FEITO': 57}` (antes desta onda:
`56 {'FEITO': 55, 'NÃO POSSÍVEL NO BEDROCK': 1}`). Verificação da onda: `npx tsc` sem erros, 41 arquivos de `npm test`
verdes, `npm run validate` "OK: nenhum erro" (com a checagem nova de itens invisíveis ao `/give`), BDS das frentes sem
ERROR/WARN de conteúdo ou script.

## Cobertura

| Conteúdo | Cobblemon 1.8.2 | Port | Status |
|---|---|---|---|
| Itens (`CobblemonItems.kt`) | 749 ids | 749 (589 JSON de item + itens de bloco) | FEITO |
| Blocos (`CobblemonBlocks.kt`) | 392 | 388 (394 blocos Bedrock) | FEITO — placas de parede (`*_wall_sign`, `*_wall_hanging_sign`) são a mesma placa no Bedrock |
| Receitas próprias (sem `mod_compatibility`) | 779 | 1079 receitas Bedrock + 117 de panela e 27 de poção por script + vaso decorado com sherds do Cobblemon pela tela da mesa de trabalho | FEITO — 1 pulada: o trim `automaton` (NÃO POSSÍVEL NO BEDROCK, reconfirmado na onda adaptações: `minecraft:recipe_smithing_trim` só aceita templates da tag `minecraft:trim_templates` com padrão vanilla, doc `minecraftRecipe_SmithingTrim.md`, e não há esquema `trim_pattern` no bedrock-samples v1.26.50.4; o template fica como item, com receita de cópia e loot); os restos do Braised Vivichoke (removido no 1.7.0: item, 3 receitas, textura) foram apagados |
| Loot tables | 639 | 670 geradas + 40 do Alfa (`loot_table/alpha`, convertidas para script) + 23 vanilla sobrescritas | FEITO — Fortuna (`apply_bonus`: `ore_drops`, `uniform_bonus_count`, `binomial_with_bonus_count`, `limit_count`) por script em `scripts/world/Fortune.ts` nos minérios de pedra evolutiva, blocos de gema, tumblestone, medicinal leek e galarica; as sementes de mint não têm Fortuna no 1.8.2 (correção da auditoria) |
| Features de worldgen | apricorns, berry groves, mints, ervas, gemas, saccharine, minérios | 97 features, 89 feature rules | FEITO — `liechi` sem bioma no Bedrock |
| Texturas de terreno / ícones | — | 696 / 588 | FEITO — texturas animadas de Pokémon (36 flipbooks) agora animam |
| Attachables (vestíveis) e âncoras | `WearableHatItem`/`WearableBlockItem` + `HeldItemRenderer` | 34 attachables (17 itens × jogador/Pokémon), 17 geometrias de vestível, 538 animações de âncora por espécie/variante | FEITO — conferir posição e escala no cliente |
| Abas do criativo (`CobblemonItemGroups.kt`) | 7 abas | `item_catalog/crafting_item_catalog.json` com as 7 abas na ordem do Kotlin, nome traduzido e ícone | FEITO — livro de receitas agrupado (aproximação, limites-b): o livro do Bedrock usa esse catálogo, então os `group` das receitas Java viram 44 subgrupos `cobblemon:recipe_group.<group>` (`tools/importer/limitesB.ts`; também aparecem no criativo). Busca "poke" = "poké": NÃO POSSÍVEL NO BEDROCK (busca do cliente, sem sinônimos por pack) |
| Variantes de pintura (`painting_variant` + tag `placeable`) | 4 (altar, nomad, premonition, slumber) | entidade `cobblemon:painting` com as 4 texturas, sorteada no clique do item Pintura vanilla | FEITO (aproximação) — o registro de pintura é só do Java; ver #30 em `PARIDADE-MECANICAS.md` |
| Texturas de GUI | `textures/gui/**` | 735 + 237 derivadas (barras de HP/EXP, molduras de toast) + 51 papéis de parede | FEITO |
| Retratos | renderizados em tempo real no Java | 8.219 PNG pré-renderizados (2.826 retratos 64 px, 2.826 ícones 32 px, 2.567 perfis 128 px) | FEITO — antes NÃO POSSÍVEL; rasterizador offline no importador com o enquadramento do Cobblemon (`tools/importer/portraits.ts`), atribuição CC BY-NC 3.0 em `credits.txt` |
| Estruturas (habitats, ruínas, fósseis, shipwreck coves, barcos, vilas; 1235 `.nbt`) | 67 jigsaw + 43 features por template | 65 estruturas **jigsaw data-driven** (1.179 peças, 214 pools, 9 structure sets) + 43 features (207 moldes) + 5 Pokécenters | FEITO — enseadas de naufrágio entraram (antes NÃO POSSÍVEL); `/locate` funciona; marcador por peça para o registro de estruturas. Injeção nos pools da vila vanilla: NÃO POSSÍVEL NO BEDROCK, confirmado na pesquisa 8 §12 (doc oficial: vilas e bastiões usam o jigsaw legado, que não aceita JSON) → Pokécenter colocado por script em vila nova. Conferir a rotação das juntas verticais |
| Trocas de aldeão / vendedor ambulante (`CobblemonTradeOffers`) | pescador, enfermeira, vendedor | pescador + enfermeira + vendedor | FEITO — Enfermeira por aproximação (limites-b): override do `villager_v2` + script, 21 trocas do Java, textura `nurse`/`nurse_joy`, som `work_nurse` na Healing Machine; ver #113 em `PARIDADE-MECANICAS.md` |

## Itens por categoria (comportamento)

| Categoria | Status | Como |
|---|---|---|
| Poké Balls (48 + strange_ball) | FEITO | Projéteis próprios (ancient com `throwPower`), captura por script. Envio com arremesso (`poke_ball.throw`/`trail`), bola em arco e as 346 partículas de `balls/**` do Cobblemon (envio e recolha, em batalha e fora). Bug E2E-3 da captura fora de batalha **corrigido** (bolas ignoram dano; E2E 4/4). Sequência de captura com os sons `cobblemon.poke_ball.*`/`.ancient`, as partículas do Cobblemon e a tinta vermelha do feixe (onda de fechamento; ver §2 de `PARIDADE-MECANICAS.md`). `strange_ball` (do port, fora do registro do 1.8.2) ganhou ícone 2D gerado da `poke_ball` com o matiz da tampa do modelo (`tools/importer/legacyBallIcons.ts`); `validate` sem avisos. Frente give: a `strange_ball` (escrita à mão) não entrava no `/give` por estar fora do catálogo e sem `menu_category`; agora tem `equipment` + grupo `utility_item` e aparece no criativo junto das outras bolas. Conferir o ícone no cliente |
| Medicina (poções, status, revives, éteres, remédios, PP Up/Max, Energy Root, Heal Powder, Revival Herb) | FEITO | `cobblemon:use_on_pokemon` (162 itens) + mochila em batalha |
| X items / Dire Hit / Guard Spec | FEITO | Mochila em batalha |
| Vitaminas, penas, mochis (+4), Fresh Start Mochi | FEITO | Mochis/berries/Aprijuice respeitam a barriga (fome) |
| Doces (EXP, Rare, Hyper Training) | FEITO | |
| Itens de evolução (pedras, Link Cable etc.) | FEITO | Só gasta se a evolução começa |
| Held items de batalha | FEITO | Eggant Berry segurada registrada no simulador (`held_items/eggantberry.js`) |
| Berries (cura, status, PP, EV/amizade, iscas, temperos, plantio) | FEITO | Limitadas pela fome |
| Mints (item, folha, semente) | FEITO | |
| TMs / Blank TM | FEITO | Ícone por tipo: NÃO POSSÍVEL NO BEDROCK (ícone de item fixo por id) |
| Comidas (Ponigiri, Sinister Tea, Aprijuice, comidas regionais, Poké Cake) | FEITO | Temperos `cobblemon:cleanse_negative`/`cleanse_all` (`scripts/events/MobEffects.ts`); Aprijuice com ride boosts no Pokémon ou pela escolha do time (`scripts/pokemon/Aprijuice.ts`). `mental_restoration` (Mental Herb): antes NÃO POSSÍVEL, agora FEITO por equivalência estatística (`scripts/adaptacoes/mentalRestoration.ts`: desconto do Java por jogador e sorteio que mantém o phantom natural na taxa do `PhantomSpawner`; ver #43 em `PARIDADE-MECANICAS.md`). Desvio: segurar o botão com uma Aprijuice temperada ainda bebe (o Bedrock não cancela o uso de comida) |
| Poké Rods (48) e iscas | FEITO | Isca puxada registra a conquista `use_poke_bait` |
| Pokédex (7 cores) | FEITO | Scanner com zoom (`setFov`) e overlay; moldura da tela na cor da Pokédex. Tag `minecraft:bookshelf_books` (a mesma do Java) para ir na estante entalhada; conferir no cliente |
| Mulch (8) | FEITO | |
| Fósseis | FEITO | Máquina de fósseis com os sons do Cobblemon |
| Cosméticos (`cosmetic_items`, 29) | FEITO | Menu do Pokémon; o aspect troca a variação visual |
| Vestíveis do 1.8.2 (17 chapéus/itens de rosto no jogador e no Pokémon) | FEITO | `minecraft:wearable` no slot de cabeça + attachable no jogador; no Pokémon, âncoras `cobblemon_anchor_hat`/`face` levadas aos locators `item_hat`/`item_face` (escala 0,62 do HeldItemRenderer). O "19" antigo contava 2 modelos-molde que não são itens. Desvio: pilha 1 no slot de armadura. Conferir no cliente |
| Item segurado visível no modelo | FEITO | `scripts/entity/HeldItemDisplay.ts`: cópia visual na mão secundária (drop 0) no locator `item`; regras do `updateShownItem` (`heldItemVisible`, tag hidden, Alfa selvagem). 356 espécies sem o locator não desenham, como no Java. Conferir no cliente |
| Relic coins | FEITO | Stash do Gimmighoul → Gholdengo; moedas, Relic Coin Pouch e baús dourados no escambo e na admiração dos piglins (override da entidade) |
| Sherds | FEITO (aproximação) | Antes NÃO POSSÍVEL. O vaso vanilla não aceita padrão custom, então o port tem o vaso `cobblemon:decorated_pot` (bloco + item + entidade que desenha os lados; `scripts/adaptacoes/`, `tools/importer/adaptacoes.ts`) com os 6 sherds do Cobblemon e os 23 vanilla. Criação: usar a mesa de trabalho segurando um sherd do Cobblemon (sem agachar) abre a tela (fundo, esquerda, direita, frente); a grade não chama scripts. Guarda 1 pilha, funil, comparador, quebra como no Java; `/give cobblemon:decorated_pot` dá o vaso liso. Desvios: sem balançar, pistão não quebra, ícone liso. Conferir os lados no cliente |
| Itens colocáveis como bloco (1.8.2) | FEITO | Never-Melt Ice com `minecraft:friction` 0,011 (sem atrito 0,989) |
| Poções/vitaminas no suporte de poções | FEITO | Tela própria ao usar ingrediente do Cobblemon no suporte vanilla |
| Compostagem | FEITO | `minecraft:compostable` (chance do Kotlin) em 140 itens com JSON; folhas de apricorn/saccharine e fardo de hearty grain pela composteira por script |
| Tags de comida vanilla (raposa, cavalo, piglin, abelha) | FEITO | Overrides de galinha, papagaio, cavalo/burro/mula, raposa e piglin. `bee_growables` (antes NÃO POSSÍVEL): abelha com néctar faz crescer as plantas da tag por script (`scripts/adaptacoes/bees.ts`) |
| Creative tabs | FEITO | 7 abas do `CobblemonItemGroups.kt` no catálogo do criativo, com os 44 subgrupos de receita (livro agrupado) |

## Blocos por grupo

| Grupo | Status | Como |
|---|---|---|
| Máquinas (PC, Healing Machine, pasto, fósseis, monitor, TM, panela/fogueira) | FEITO | Custom components; sons e partículas do Cobblemon; luz do pasto/monitor/PC/Healing Machine cheia; monitor com todas as telas de TM; feto visível no tanque de restauração (`cobblemon:fossil_fetus`); Healing Machine "natural" das estruturas (estado `cobblemon:natural`, modelos `healing_machine_limited_1..5`, solta 1–4 barras de ferro). Panela (antes NÃO POSSÍVEL): funil por script e comparador por `minecraft:redstone_producer` nas permutações da fogueira, com a tampa lendo a redstone dos vizinhos (`scripts/adaptacoes/{potHoppers,potRedstone}.ts`). Comparador na Healing Machine e no Metronome: FALTA (a mesma técnica serve; não aplicada) |
| Madeira apricorn e saccharine (portas, lajes, escadas, cercas, placas) | FEITO | Folhas com decaimento, tora descascável, mel na saccharine; dispenser com mel/poção de água na folha de saccharine (`scripts/adaptacoes/dispenser.ts`; mel na tora deitada não vira tora com mel) |
| Barcos de apricorn/saccharine (4) | FEITO | Antes só item. Entidades `cobblemon:*_boat`/`*_chest_boat` com `runtime_identifier` `minecraft:boat`/`chest_boat` (física, remo, 2 lugares, baú de 27) e textura do Cobblemon; o drop é o item do Cobblemon. Sem animação de remo |
| Botões, placas de pressão, Eject Button, Ring Target | FEITO | Antes sem redstone. `minecraft:redstone_producer` por permutação (15 por 30/40 ticks; Ring Target pela distância do centro) |
| Apricorns na árvore / mudas | FEITO | Soco no apricorn maduro colhe; semente na lateral das folhas planta; mudas de apricorn, saccharine e Pep-Up Flower em vaso (`cobblemon:potted_*`); dispenser com tesoura colhe o apricorn maduro |
| Berry bushes | FEITO | Dispenser com tesoura colhe berries e big root (`scripts/adaptacoes/dispenser.ts`) |
| Mints, ervas e cultivos | FEITO | Abelhas fazem crescer as da tag `bee_growables`; o fazendeiro pega, planta e colhe as 9 sementes de `villager_plantable_seeds` perto dele (aproximação, `scripts/limitesB/farmer.ts`; medicinal leek fica de fora) |
| Minérios de pedra evolutiva | FEITO | Fortuna por script; espeleotema cresce sob o minério de pedra da lua (componente `cobblemon:dripstone_growable`) |
| Tumblestone e type gems | FEITO | |
| Poké Snack / Poké Cake | FEITO | Partículas de `animateTick` (vela/mordida): FALTA (efeito do cliente no Java) |
| Baús dourados / Gimmighoul chest | FEITO | Antes PARCIAL. Contêiner real: entidade invisível `cobblemon:gilded_chest_storage` com inventário (UI de baú, funil, NBT/encantamento/nome preservados), caixa 1,02 que recebe o clique, 4 golpes quebram e soltam o conteúdo, sons de abrir/fechar. Clique: conferir no cliente |
| Vitrine / estante de discos / atril | FEITO | Antes PARCIAL. Vitrine com ItemStack real (1 espaço na entidade `cobblemon:display_case_item`; sem brilho de encantamento no modelo); estante com 14 espaços (`cobblemon:machine_storage`); dados antigos migram. Discos visíveis (`cobblemon:disc_shelf_display`, 47 texturas) e sequenciador de note block (desvio: a nota do note block também toca). Atril emite luz 13 enquanto alguém lê a Pokédex. Conferir no cliente |
| Habitat block | FEITO | |
| Waterlogging de blocos custom | FEITO | Antes NÃO POSSÍVEL. `minecraft:liquid_detection` nas 23 classes do Cobblemon (lidas do Kotlin) + lajes/escadas/cercas/muros/alçapões/folhas; a vitrine não alaga, como no Java; a água de `waterlogged=true` das estruturas passou a ficar |
| Inflamáveis | FEITO | `minecraft:flammable` exatamente nos 21 blocos do `setFlammable` do Kotlin, com os valores do Java; botões, alçapões, portas e placas de pressão deixaram de ser inflamáveis |

## Sons e partículas

| Conteúdo | Status | Notas |
|---|---|---|
| Sons do Cobblemon | FEITO | Blocos (101 de 103) por conjuntos próprios no `sounds.json` do RP; máquinas, pesca, captura, shiny, NPC (gibber), troca, stash, golpes/impactos, `gui.levelup`/`levelup_start`, `poke_ball.throw/trail`, `pc.grab/drop/release`, `gui.click`, `ride.loop.*` e `scan_zoom_increment`. A sequência de captura usa `cobblemon.poke_ball.*` com as variantes `.ancient` desde a onda de fechamento; `hearty_grains` alagado: NÃO POSSÍVEL (um conjunto por bloco, não por estado) |
| Música de batalha | FEITO | Eventos `cobblemon.battle.pvw/pvp/pvn.default` vazios, como no 1.8.2; tocam com um pack de faixas + `/scriptevent cobblemon:battle_music on` |
| Partículas | FEITO / NÃO POSSÍVEL NO BEDROCK | Antes PARCIAL. 660 arquivos de golpes, animações de espécie, shiny, `evo_*`, `poodle_hair_*`, `broth_*` e pesca, as 346 de bola (envio/recolha) e as de status/boost em batalha. Onda de fechamento (visual-final): sequência de captura com `recall_beam`, `capturesparks`/`capturestar`/`afterspark`, `hisui*` e `ancient_pokeball_smoke`; mel e migalhas do Poké Snack por aspect (`cobblemon:poke_snack_crumbs`, partícula à mão com a textura do Cobblemon); `alpha_eyes` nos locators dos olhos (871 espécies); corte do Furfrou com `poodle_hair_<cor>`. `alphaboost_*` fora de batalha e `heal_circles`/`heal_sparkles`: N/A NO COBBLEMON (o 1.8.2 não usa). NÃO POSSÍVEL NO BEDROCK: brilho em anéis e rastro dos olhos do Alfa (o `AlphaEyeRenderer` desenha direto no buffer; o Bedrock não tem renderização customizada por entidade), adaptação: só a partícula. Conferir no cliente |
| Papéis de parede do PC (`textures/gui/pc/wallpaper/**`) | FEITO | 51 PNG + `generated/scripts/wallpapers.ts`; a tela do PC desenha o papel de parede na tela inteira com a camada `glow` (17 texturas `glow/`), e a caixa sem escolha mostra `basic/wallpaper_basic_05`, o padrão do Java. Conferir no cliente |

---

## Anexo: pesquisa inicial (antes do importador de conteúdo; status desatualizado)

Fonte Cobblemon: `CobblemonItems.kt` (parse das registrações; 749 ids, bate com lang `item.cobblemon.*`/`block.cobblemon.*` — só 5 chaves de lang sem registro: bugwort, cream_puff, jelly_doughnut, poke_puff, shalour_sable, todas comentadas no código).
Fonte port: `"identifier"` em `behavior_packs/CobblemonBedrock/items` (319 cobblemon:*) e `blocks` (57). Um id conta como presente se existir como item OU bloco no port.

### 1. ITENS

Total Cobblemon: **749** ids de item (inclui 182+ block items). Port: **319** itens + 57 blocos.

Aliases (mesmo item, id diferente no port — renomear): `x_defence`→port `x_defense`, `x_special_attack`→port `x_sp_atk`, `x_special_defence`→port `x_sp_def`, `charcoal_stick`→port `charcoal`, `roseli_berry`→port `roselei_berry`.
Ids do port que não existem no Cobblemon 1.8.2: `strange_ball`, `braised_vivichoke`, `*_apricorn_sapling` (itens; Cobblemon usa `*_apricorn_seed` + bloco `*_apricorn_sapling`), blocos `*_apricorn_block(_generated)`, `*_apricorn_sapling_block`, `apricorn_door_bottom_left/top_left`, `pc_top` (divisões técnicas de multibloco).
Observação de comportamento: no port quase todos os itens são só ícone+nome (`minecraft:icon`, `display_name`, `tags`). Com comportamento real hoje: 33 poké balls (throwable), rare/exp candies (ScriptEvents.ts), held item (ExchangeHeldItem.ts), evolução por item (ItemInteractionEvolution). Medicina, vitaminas, mints, berries, etc. NÃO têm script.

| Categoria | Cobblemon | Port (presentes) | Faltando |
|---|---|---|---|
| 01 Poké Balls | 48 | 32 | 16 |
| 02 Medicina (potions/status/revives/ethers/remedies/PP) | 34 | 31 | 3 |
| 02b Itens de batalha X/Dire Hit/Guard Spec | 8 | 8 | 0 |
| 03 Vitaminas, penas EV e mochis | 19 | 6 | 13 |
| 04 Candies (EXP / Hyper Training / Rare) | 18 | 6 | 12 |
| 05 Itens de evolução | 65 | 43 | 22 |
| 06 Held items de batalha | 103 | 41 | 62 |
| 07 Berries | 71 | 70 | 1 |
| 08 Apricorns (fruto/semente) | 14 | 7 | 7 |
| 09 Mints (natureza, folhas, sementes) | 33 | 33 | 0 |
| 10 Cultivos e ervas (sementes/colheitas) | 6 | 2 | 4 |
| 11 Máquinas e blocos funcionais (item de bloco) | 10 | 2 | 8 |
| 12 Fósseis e sherds | 21 | 0 | 21 |
| 13 Culinária (campfire pot, aprijuice, snacks, bait, comidas) | 34 | 0 | 34 |
| 14 Varas de pesca (Poké Rods) | 49 | 0 | 49 |
| 15 Pokédex | 7 | 0 | 7 |
| 16 Mulch | 9 | 9 | 0 |
| 17 Cosméticos/wearables (held + chapéu) | 17 | 15 | 2 |
| 18 Misc (TMs, relic coins, dev) | 9 | 0 | 9 |
| 19 Itens de bloco (block items) | 174 | 36 | 138 |
| **Total** | **749** | **341** | **408** |

#### 01 Poké Balls

Cobblemon 48 · port 32 · faltando 16

Faltando: `ancient_poke_ball`, `ancient_citrine_ball`, `ancient_verdant_ball`, `ancient_azure_ball`, `ancient_roseate_ball`, `ancient_slate_ball`, `ancient_ivory_ball`, `ancient_great_ball`, `ancient_ultra_ball`, `ancient_feather_ball`, `ancient_wing_ball`, `ancient_jet_ball`, `ancient_heavy_ball`, `ancient_leaden_ball`, `ancient_gigaton_ball`, `ancient_origin_ball`

Comportamento necessário: Arremessável (minecraft:throwable+projectile já existe em 33) + entidade de projétil por bola + modificador de captura (scripts/catching). Bolas ancient: mesmo fluxo com física/alcance diferentes (feather/wing/jet = mais longe; heavy/leaden/gigaton = mais curto, bônus fora de visão).

#### 02 Medicina (potions/status/revives/ethers/remedies/PP)

Cobblemon 34 · port 31 · faltando 3

Faltando: `moomoo_milk`, `ability_capsule`, `ability_patch`

Comportamento necessário: Uso fora de batalha: abrir seletor de party (form/ActionForm) e aplicar cura de HP / status / PP / revive ao Pokémon escolhido; dentro de batalha: ação "usar item" que consome o turno e envia ao Showdown (`>p1 useitem` equivalente) ou aplica direto no estado. Remedies/ervas amargas reduzem friendship. Ability capsule/patch trocam habilidade. Heal powder/energy root também. Itens colocáveis (potion etc. são ItemNameBlockItem em Cobblemon, i.e. podem ser postos como bloco decorativo).

#### 02b Itens de batalha X/Dire Hit/Guard Spec

Cobblemon 8 · port 8 · faltando 0

Faltando: (nenhum)

Comportamento necessário: Uso só em batalha: boost de stat (X items), crit (Dire Hit), Mist (Guard Spec) — via ação de item no Showdown. Também colocáveis como bloco decorativo em Cobblemon.

#### 03 Vitaminas, penas EV e mochis

Cobblemon 19 · port 6 · faltando 13

Faltando: `health_mochi`, `muscle_mochi`, `resist_mochi`, `genius_mochi`, `clever_mochi`, `swift_mochi`, `fresh_start_mochi`, `genius_feather`, `swift_feather`, `health_feather`, `resist_feather`, `muscle_feather`, `clever_feather`

Comportamento necessário: Uso na party fora de batalha: vitaminas +10 EV (limite 252/510), penas +1 EV, mochis +10 EV; fresh_start_mochi zera EVs. potato_mochi é comida.

#### 04 Candies (EXP / Hyper Training / Rare)

Cobblemon 18 · port 6 · faltando 12

Faltando: `health_candy`, `mighty_candy`, `tough_candy`, `smart_candy`, `courage_candy`, `quick_candy`, `sickly_candy`, `weak_candy`, `brittle_candy`, `numb_candy`, `coward_candy`, `slow_candy`

Comportamento necessário: Exp candies e rare candy já têm script (ScriptEvents.ts). Hyper Training candies (health/mighty/...): setar IV do stat (efeito "hyper trained") em Pokémon nível >= X; cada um afeta um stat/faixa.

#### 05 Itens de evolução

Cobblemon 65 · port 43 · faltando 22

Faltando: `masterpiece_teacup`, `unremarkable_teacup`, `syrupy_apple`, `metal_alloy`, `scroll_of_darkness`, `scroll_of_waters`, `white_plaque`, `light_gray_plaque`, `gray_plaque`, `black_plaque`, `brown_plaque`, `red_plaque`, `orange_plaque`, `yellow_plaque`, `lime_plaque`, `green_plaque`, `cyan_plaque`, `light_blue_plaque`, `blue_plaque`, `purple_plaque`, `magenta_plaque`, `pink_plaque`

Comportamento necessário: Pedras de evolução/itens de troca: interação com Pokémon dispara ItemInteractionEvolution (já existe o mecanismo em scripts/evolution). Itens de trade (link cable = forçar evolução por troca; metal coat/upgrade etc. são held-item + trade). Doces Alcremie, plaques Arceus (held -> forma), teacups/pots Sinistcha/Polteageist. Maioria é mecânica (dados) + requisito de evolução.

#### 06 Held items de batalha

Cobblemon 103 · port 41 · faltando 62

Faltando: `ability_shield`, `absorb_bulb`, `air_balloon`, `binding_band`, `blunder_policy`, `cell_battery`, `clear_amulet`, `eject_button`, `eject_pack`, `electric_seed`, `eviolite`, `expert_belt`, `float_stone`, `focus_sash`, `grassy_seed`, `grip_claw`, `iron_ball`, `lagging_tail`, `light_ball`, `loaded_dice`, `luminous_moss`, `metronome`, `psychic_seed`, `protective_pads`, `punching_glove`, `red_card`, `ring_target`, `room_service`, `scope_lens`, `shed_shell`, `shell_bell`, `soothe_bell`, `sticky_barb`, `terrain_extender`, `throat_spray`, `utility_umbrella`, `weakness_policy`, `wide_lens`, `zoom_lens`, `misty_seed`, `damp_rock`, `heat_rock`, `smooth_rock`, `icy_rock`, `normal_gem`, `fire_gem`, `water_gem`, `grass_gem`, `electric_gem`, `ice_gem`, `fighting_gem`, `poison_gem`, `ground_gem`, `flying_gem`, `psychic_gem`, `bug_gem`, `rock_gem`, `ghost_gem`, `dragon_gem`, `dark_gem`, `steel_gem`, `fairy_gem`

Comportamento necessário: Held items: dar ao Pokémon (ExchangeHeldItem.ts já existe) e repassar `item` ao time no Showdown; efeito é do próprio Showdown. Portanto só precisa do item + tag held_item; nenhum comportamento extra além de registro.

#### 07 Berries

Cobblemon 71 · port 70 · faltando 1

Faltando: `eggant_berry`

Comportamento necessário: Berries: item + bush plantável (BerryBlock com estágios, mutação, mulch); uso como held item em batalha (Showdown resolve), algumas curam fora de batalha (oran/sitrus/status berries/leppa) e EV-reducing (pomeg etc.) e friendship. Berry juice: cura.

#### 08 Apricorns (fruto/semente)

Cobblemon 14 · port 7 · faltando 7

Faltando: `red_apricorn_seed`, `yellow_apricorn_seed`, `green_apricorn_seed`, `blue_apricorn_seed`, `pink_apricorn_seed`, `black_apricorn_seed`, `white_apricorn_seed`

Comportamento necessário: Apricorn: fruto usado em receitas de poké ball; seed planta sapling -> árvore que gera apricorns (port já tem componentes Sapling/ApricornGenerated).

#### 09 Mints (natureza, folhas, sementes)

Cobblemon 33 · port 33 · faltando 0

Faltando: (nenhum)

Comportamento necessário: Mint (natureza): usar na party -> muda natureza efetiva (mintedNature). Mint leaves/seeds: plantio de mint crop, leaves craftam mints.

#### 10 Cultivos e ervas (sementes/colheitas)

Cobblemon 6 · port 2 · faltando 4

Faltando: `hearty_grains`, `hearty_grain_bale`, `saccharine_sapling`, `galarica_nuts`

Comportamento necessário: Cultivos: sementes plantáveis (vivichoke, hearty grains, galarica nuts) com crop blocks; produtos usados em culinária/receitas.

#### 11 Máquinas e blocos funcionais (item de bloco)

Cobblemon 10 · port 2 · faltando 8

Faltando: `restoration_tank`, `fossil_analyzer`, `monitor`, `damaged_monitor`, `tm_machine`, `disc_shelf`, `pasture`, `display_case`

Comportamento necessário: Blocos funcionais com UI/estado: PC, healing machine (existem), pasture (armazenar/soltar Pokémon para passear), display case, monitor/restoration tank/fossil analyzer (multibloco reviver fósseis), TM machine e disc shelf.

#### 12 Fósseis e sherds

Cobblemon 21 · port 0 · faltando 21

Faltando: `armor_fossil`, `fossilized_bird`, `claw_fossil`, `cover_fossil`, `fossilized_dino`, `dome_fossil`, `fossilized_drake`, `fossilized_fish`, `helix_fossil`, `jaw_fossil`, `old_amber_fossil`, `plume_fossil`, `root_fossil`, `sail_fossil`, `skull_fossil`, `bygone_sherd`, `capture_sherd`, `dome_sherd`, `helix_sherd`, `nostalgic_sherd`, `suspicious_sherd`

Comportamento necessário: Fósseis: inserir no fossil analyzer/restoration tank para reviver espécie. Sherds: cerâmica decorada (decorated pot) — Bedrock tem pottery sherds nativos mas não permite novos padrões custom.

#### 13 Culinária (campfire pot, aprijuice, snacks, bait, comidas)

Cobblemon 34 · port 0 · faltando 34

Faltando: `campfire_pot_red`, `campfire_pot_yellow`, `campfire_pot_green`, `campfire_pot_blue`, `campfire_pot_pink`, `campfire_pot_black`, `campfire_pot_white`, `poke_bait`, `poke_cake`, `poke_snack`, `aprijuice_red`, `aprijuice_yellow`, `aprijuice_green`, `aprijuice_blue`, `aprijuice_pink`, `aprijuice_black`, `aprijuice_white`, `ponigiri`, `sinister_tea`, `sweet_heart`, `tasty_tail`, `pewter_crunchies`, `rage_candy_bar`, `lava_cookie`, `old_gateau`, `casteliacone`, `lumiose_galette`, `big_malasada`, `smoked_tail_curry`, `jubilife_muffin`, `open_faced_sandwich`, `candied_apple`, `candied_berry`, `potato_mochi`

Comportamento necessário: Campfire pot (bloco colocado sobre fogueira, UI de cozinha com seasonings -> poke snack/ aprijuice / poke puff), poke bait (isca de spawn com efeitos), poke snack/cake (bloco que atrai spawns). Comidas regionais: minecraft:food simples.

#### 14 Varas de pesca (Poké Rods)

Cobblemon 49 · port 0 · faltando 49

Faltando: `pokerod_smithing_template`, `poke_rod`, `citrine_rod`, `verdant_rod`, `azure_rod`, `roseate_rod`, `slate_rod`, `premier_rod`, `great_rod`, `ultra_rod`, `safari_rod`, `fast_rod`, `level_rod`, `lure_rod`, `heavy_rod`, `love_rod`, `friend_rod`, `moon_rod`, `sport_rod`, `park_rod`, `net_rod`, `dive_rod`, `nest_rod`, `repeat_rod`, `timer_rod`, `luxury_rod`, `dusk_rod`, `heal_rod`, `quick_rod`, `dream_rod`, `beast_rod`, `master_rod`, `cherish_rod`, `ancient_poke_rod`, `ancient_citrine_rod`, `ancient_verdant_rod`, `ancient_azure_rod`, `ancient_roseate_rod`, `ancient_slate_rod`, `ancient_ivory_rod`, `ancient_great_rod`, `ancient_ultra_rod`, `ancient_feather_rod`, `ancient_wing_rod`, `ancient_jet_rod`, `ancient_heavy_rod`, `ancient_leaden_rod`, `ancient_gigaton_rod`, `ancient_origin_rod`

Comportamento necessário: Poké Rods: vara de pesca com bola + isca (bait) que pesca Pokémon (spawn pool de pesca). Bedrock não permite item de vara custom com bobber nativo -> precisaria entidade de bobber + script. smithing template para criar rods.

#### 15 Pokédex

Cobblemon 7 · port 0 · faltando 7

Faltando: `pokedex_red`, `pokedex_yellow`, `pokedex_green`, `pokedex_blue`, `pokedex_pink`, `pokedex_black`, `pokedex_white`

Comportamento necessário: Pokédex: item que abre UI (form) do dex com espécies vistas/capturadas; scanner. Variantes de cor = só visual.

#### 16 Mulch

Cobblemon 9 · port 9 · faltando 0

Faltando: (nenhum)

Comportamento necessário: Mulch: aplicado em berry bush / soil para alterar crescimento/mutação/rendimento.

#### 17 Cosméticos/wearables (held + chapéu)

Cobblemon 17 · port 15 · faltando 2

Faltando: `covert_cloak`, `shell_helmet`

Comportamento necessário: Wearables: held items que também renderizam como chapéu no Pokémon (requer attachable/geo no RP e render por bone). Mecanicamente iguais aos held items.

#### 18 Misc (TMs, relic coins, dev)

Cobblemon 9 · port 0 · faltando 9

Faltando: `npc_editor`, `habitat_block`, `automaton_armor_trim_smithing_template`, `pokemon_model`, `relic_coin`, `relic_coin_pouch`, `relic_coin_sack`, `technical_machine`, `blank_tm`

Comportamento necessário: TMs (technical_machine com componente de movimento, blank_tm, relic coins, npc_editor/pokemon_model (dev/admin), habitat_block (dev), trim template.

#### 19 Itens de bloco (block items)

Cobblemon 174 · port 36 · faltando 138

Faltando: `tatami_block`, `tatami_mat`, `apricorn_fence`, `apricorn_fence_gate`, `apricorn_stairs`, `gilded_chest`, `blue_gilded_chest`, `yellow_gilded_chest`, `pink_gilded_chest`, `black_gilded_chest`, `white_gilded_chest`, `green_gilded_chest`, `gimmighoul_chest`, `saccharine_log`, `saccharine_log_slathered`, `stripped_saccharine_log`, `saccharine_wood`, `stripped_saccharine_wood`, `saccharine_planks`, `saccharine_leaves`, `saccharine_boat`, `saccharine_chest_boat`, `saccharine_door`, `saccharine_trapdoor`, `saccharine_fence`, `saccharine_fence_gate`, `saccharine_button`, `saccharine_pressure_plate`, `saccharine_slab`, `saccharine_stairs`, `saccharine_sign`, `saccharine_hanging_sign`, `terracotta_sun_stone_ore`, `nether_fire_stone_ore`, `tumblestone`, `black_tumblestone`, `sky_tumblestone`, `small_budding_tumblestone`, `medium_budding_tumblestone`, `large_budding_tumblestone`, `tumblestone_cluster`, `small_budding_sky_tumblestone`, `medium_budding_sky_tumblestone`, `large_budding_sky_tumblestone`, `sky_tumblestone_cluster`, `small_budding_black_tumblestone`, `medium_budding_black_tumblestone`, `large_budding_black_tumblestone`, `black_tumblestone_cluster`, `tumblestone_block`, `sky_tumblestone_block`, `black_tumblestone_block`, `deepslate_crystal_core`, `normal_gem_cluster`, `fire_gem_cluster`, `water_gem_cluster`, `electric_gem_cluster`, `grass_gem_cluster`, `ice_gem_cluster`, `fighting_gem_cluster`, `poison_gem_cluster`, `ground_gem_cluster`, `flying_gem_cluster`, `psychic_gem_cluster`, `bug_gem_cluster`, `rock_gem_cluster`, `ghost_gem_cluster`, `dragon_gem_cluster`, `dark_gem_cluster`, `steel_gem_cluster`, `fairy_gem_cluster`, `normal_gem_block`, `fire_gem_block`, `water_gem_block`, `electric_gem_block`, `grass_gem_block`, `ice_gem_block`, `fighting_gem_block`, `poison_gem_block`, `ground_gem_block`, `flying_gem_block`, `psychic_gem_block`, `bug_gem_block`, `rock_gem_block`, `ghost_gem_block`, `dragon_gem_block`, `dark_gem_block`, `steel_gem_block`, `fairy_gem_block`, `polished_tumblestone`, `polished_tumblestone_stairs`, `polished_tumblestone_slab`, `polished_tumblestone_wall`, `chiseled_polished_tumblestone`, `smooth_tumblestone`, `smooth_tumblestone_stairs`, `smooth_tumblestone_slab`, `tumblestone_bricks`, `tumblestone_brick_stairs`, `tumblestone_brick_slab`, `tumblestone_brick_wall`, `chiseled_tumblestone_bricks`, `polished_sky_tumblestone`, `polished_sky_tumblestone_stairs`, `polished_sky_tumblestone_slab`, `polished_sky_tumblestone_wall`, `chiseled_polished_sky_tumblestone`, `smooth_sky_tumblestone`, `smooth_sky_tumblestone_stairs`, `smooth_sky_tumblestone_slab`, `sky_tumblestone_bricks`, `sky_tumblestone_brick_stairs`, `sky_tumblestone_brick_slab`, `sky_tumblestone_brick_wall`, `chiseled_sky_tumblestone_bricks`, `polished_black_tumblestone`, `polished_black_tumblestone_stairs`, `polished_black_tumblestone_slab`, `polished_black_tumblestone_wall`, `chiseled_polished_black_tumblestone`, `smooth_black_tumblestone`, `smooth_black_tumblestone_stairs`, `smooth_black_tumblestone_slab`, `black_tumblestone_bricks`, `black_tumblestone_brick_stairs`, `black_tumblestone_brick_slab`, `black_tumblestone_brick_wall`, `chiseled_black_tumblestone_bricks`, `fire_stone_block`, `water_stone_block`, `thunder_stone_block`, `leaf_stone_block`, `ice_stone_block`, `sun_stone_block`, `moon_stone_block`, `shiny_stone_block`, `dawn_stone_block`, `dusk_stone_block`

Comportamento necessário: Blocos puros (madeiras, tumblestone, gems, ores): ver seção 2.


### 2. BLOCOS

Total Cobblemon: **392** blocos registrados (`CobblemonBlocks.kt`, inclui 70 berry bushes e ~67 "itens colocáveis"). Port: **57** ids de bloco (inclui partes técnicas: portas em 2 metades, `pc_top`, apricorn `_generated`).
Equivalências aceitas: `X_apricorn`↔port `X_apricorn_block`(+`_generated`), `X_apricorn_sapling`↔`X_apricorn_sapling_block`, `apricorn_door`↔`apricorn_door_bottom_left/top_left`, `pc`↔`pc`+`pc_top`.

| Categoria | Cobblemon | Port | Faltando |
|---|---|---|---|
| A Máquinas / blocos funcionais | 12 | 2 | 10 |
| B Conjunto de madeira Apricorn | 18 | 11 | 7 |
| C Conjunto de madeira Saccharine (+sapling) | 21 | 0 | 21 |
| D Apricorns na árvore + saplings (+potted) | 21 | 14 | 7 |
| E Berry bushes | 70 | 0 | 70 |
| F Mints (crop) | 6 | 0 | 6 |
| G Ervas e cultivos | 10 | 0 | 10 |
| H Minérios e blocos de pedra evolutiva | 33 | 21 | 12 |
| I Tumblestone (budding/cluster/construção) | 54 | 0 | 54 |
| J Type gems (core/blocos/clusters) | 37 | 0 | 37 |
| K Culinária (campfire pot, campfire, poke snack/cake) | 11 | 0 | 11 |
| L Baús dourados / relic coins | 10 | 0 | 10 |
| M Itens colocáveis decorativos (plaques, orbs, potions, vitaminas, etc.) | 87 | 0 | 87 |
| N Decoração (tatami) | 2 | 0 | 2 |
| **Total** | **392** | **48** | **344** |

#### A Máquinas / blocos funcionais

Faltando: `habitat_block`, `monitor`, `damaged_monitor`, `fossil_analyzer`, `restoration_tank`, `tm_machine`, `lectern`, `disc_shelf`, `display_case`, `pasture`

Comportamento: PC (existe, com pc_top) e healing machine (existe). Faltam: pasture (UI de lista do PC, soltar Pokémon para vagar preso ao bloco, coleta de itens), display_case (renderizar item dentro — Bedrock: entidade/item frame fake), tm_machine (UI de TMs, consome TM/blank_tm), disc_shelf (armazenar TMs), lectern Cobblemon (colocar pokédex, abrir UI), monitor/fossil_analyzer/restoration_tank (multibloco de ressurreição de fósseis, timer, entidade do Pokémon resultante), habitat_block (dev).

#### B Conjunto de madeira Apricorn

Faltando: `apricorn_fence`, `apricorn_fence_gate`, `apricorn_sign`, `apricorn_wall_sign`, `apricorn_hanging_sign`, `apricorn_wall_hanging_sign`, `apricorn_stairs`

Comportamento: Mecânico (vanilla-like): fence/fence_gate/stairs/sign/hanging_sign/boat — Bedrock ≥1.21 suporta via block traits/states + custom components (script para fence connections e gate). Sign/hanging sign/boat custom NÃO são suportados nativamente em Bedrock (sem block entity de texto custom; barco custom exige entidade própria).

#### C Conjunto de madeira Saccharine (+sapling)

Faltando: `saccharine_log`, `saccharine_log_slathered`, `stripped_saccharine_log`, `saccharine_wood`, `stripped_saccharine_wood`, `saccharine_planks`, `saccharine_leaves`, `saccharine_fence`, `saccharine_fence_gate`, `saccharine_button`, `saccharine_pressure_plate`, `saccharine_sign`, `saccharine_wall_sign`, `saccharine_hanging_sign`, `saccharine_wall_hanging_sign`, `saccharine_slab`, `saccharine_stairs`, `saccharine_door`, `saccharine_trapdoor`, `saccharine_sapling`, `potted_saccharine_sapling`

Comportamento: Idem B para saccharine + saccharine_log/_slathered (Combee/mel: slathered log gera mel), leaves (SaccharineLeafBlock com estágio de mel/flores), sapling -> árvore (feature).

#### D Apricorns na árvore + saplings (+potted)

Faltando: `potted_red_apricorn_sapling`, `potted_yellow_apricorn_sapling`, `potted_green_apricorn_sapling`, `potted_blue_apricorn_sapling`, `potted_pink_apricorn_sapling`, `potted_black_apricorn_sapling`, `potted_white_apricorn_sapling`

Comportamento: Apricorn na árvore com 4 estágios (randomTicks, colher com interação) — port tem como *_apricorn_block + _generated. Potted saplings: Bedrock não aceita plantas custom em vaso vanilla -> criar bloco "potted_*" próprio.

#### E Berry bushes

Faltando: `aguav_berry`, `apicot_berry`, `aspear_berry`, `babiri_berry`, `belue_berry`, `bluk_berry`, `charti_berry`, `cheri_berry`, `chesto_berry`, `chilan_berry`, `chople_berry`, `coba_berry`, `colbur_berry`, `cornn_berry`, `custap_berry`, `durin_berry`, `eggant_berry`, `enigma_berry`, `figy_berry`, `ganlon_berry`, `grepa_berry`, `haban_berry`, `hondew_berry`, `hopo_berry`, `iapapa_berry`, `jaboca_berry`, `kasib_berry`, `kebia_berry`, `kee_berry`, `kelpsy_berry`, `lansat_berry`, `leppa_berry`, `liechi_berry`, `lum_berry`, `mago_berry`, `magost_berry`, `maranga_berry`, `micle_berry`, `nanab_berry`, `nomel_berry`, `occa_berry`, `oran_berry`, `pamtre_berry`, `passho_berry`, `payapa_berry`, `pecha_berry`, `persim_berry`, `petaya_berry`, `pinap_berry`, `pomeg_berry`, `qualot_berry`, `rabuta_berry`, `rawst_berry`, `razz_berry`, `rindo_berry`, `roseli_berry`, `rowap_berry`, `salac_berry`, `shuca_berry`, `sitrus_berry`, `spelon_berry`, `starf_berry`, `tamato_berry`, `tanga_berry`, `touga_berry`, `wacan_berry`, `watmel_berry`, `wepear_berry`, `wiki_berry`, `yache_berry`

Comportamento: Berry bush: 6 estágios de crescimento, mutação entre berries vizinhas, mulch, colheita com quantidade variável, forma dinâmica por estágio (modelos Java por berry/estágio). Requer script (random tick via custom component onRandomTick) + geometrias.

#### F Mints (crop)

Faltando: `red_mint`, `blue_mint`, `cyan_mint`, `pink_mint`, `green_mint`, `white_mint`

Comportamento: Mint crop: planta de 4 estágios, colheita dá mint_leaf; spawna na natureza (features).

#### G Ervas e cultivos

Faltando: `medicinal_leek`, `energy_root`, `big_root`, `revival_herb`, `vivichoke_seeds`, `pep_up_flower`, `potted_pep_up_flower`, `hearty_grains`, `galarica_nut_bush`, `hearty_grain_bale`

Comportamento: Crops/plantas: medicinal leek (aquático, colhe), energy root/big root (raízes que crescem em teto, raiz grande espalha), revival herb (crop com pep-up flower chance), vivichoke (crop), hearty grains (crop 2 blocos), galarica nut bush, pep-up flower (flor + vaso). hearty_grain_bale: bloco simples rotacionável.

#### H Minérios e blocos de pedra evolutiva

Faltando: `nether_fire_stone_ore`, `terracotta_sun_stone_ore`, `fire_stone_block`, `water_stone_block`, `thunder_stone_block`, `leaf_stone_block`, `ice_stone_block`, `sun_stone_block`, `moon_stone_block`, `shiny_stone_block`, `dawn_stone_block`, `dusk_stone_block`

Comportamento: Minérios: bloco simples com loot table + XP (port tem DropExpRewardComponent). Faltam variantes terracotta/nether e blocos de pedra evolutiva (bloco de armazenamento 3x3).

#### I Tumblestone (budding/cluster/construção)

Faltando: `tumblestone_cluster`, `large_budding_tumblestone`, `medium_budding_tumblestone`, `small_budding_tumblestone`, `sky_tumblestone_cluster`, `large_budding_sky_tumblestone`, `medium_budding_sky_tumblestone`, `small_budding_sky_tumblestone`, `black_tumblestone_cluster`, `large_budding_black_tumblestone`, `medium_budding_black_tumblestone`, `small_budding_black_tumblestone`, `tumblestone_block`, `sky_tumblestone_block`, `black_tumblestone_block`, `polished_tumblestone`, `polished_tumblestone_stairs`, `polished_tumblestone_slab`, `polished_tumblestone_wall`, `chiseled_polished_tumblestone`, `smooth_tumblestone`, `smooth_tumblestone_stairs`, `smooth_tumblestone_slab`, `tumblestone_bricks`, `tumblestone_brick_stairs`, `tumblestone_brick_slab`, `tumblestone_brick_wall`, `chiseled_tumblestone_bricks`, `polished_sky_tumblestone`, `polished_sky_tumblestone_stairs`, `polished_sky_tumblestone_slab`, `polished_sky_tumblestone_wall`, `chiseled_polished_sky_tumblestone`, `smooth_sky_tumblestone`, `smooth_sky_tumblestone_stairs`, `smooth_sky_tumblestone_slab`, `sky_tumblestone_bricks`, `sky_tumblestone_brick_stairs`, `sky_tumblestone_brick_slab`, `sky_tumblestone_brick_wall`, `chiseled_sky_tumblestone_bricks`, `polished_black_tumblestone`, `polished_black_tumblestone_stairs`, `polished_black_tumblestone_slab`, `polished_black_tumblestone_wall`, `chiseled_polished_black_tumblestone`, `smooth_black_tumblestone`, `smooth_black_tumblestone_stairs`, `smooth_black_tumblestone_slab`, `black_tumblestone_bricks`, `black_tumblestone_brick_stairs`, `black_tumblestone_brick_slab`, `black_tumblestone_brick_wall`, `chiseled_black_tumblestone_bricks`

Comportamento: Tumblestone: budding que cresce clusters (como amethyst) via random tick + variantes de construção (polished/smooth/bricks/chiseled com slab/stairs/wall) — puramente mecânicas.

#### J Type gems (core/blocos/clusters)

Faltando: `deepslate_crystal_core`, `normal_gem_block`, `fire_gem_block`, `water_gem_block`, `grass_gem_block`, `electric_gem_block`, `ice_gem_block`, `fighting_gem_block`, `poison_gem_block`, `ground_gem_block`, `flying_gem_block`, `psychic_gem_block`, `bug_gem_block`, `rock_gem_block`, `ghost_gem_block`, `dragon_gem_block`, `dark_gem_block`, `steel_gem_block`, `fairy_gem_block`, `normal_gem_cluster`, `fire_gem_cluster`, `water_gem_cluster`, `grass_gem_cluster`, `electric_gem_cluster`, `ice_gem_cluster`, `fighting_gem_cluster`, `poison_gem_cluster`, `ground_gem_cluster`, `flying_gem_cluster`, `psychic_gem_cluster`, `bug_gem_cluster`, `rock_gem_cluster`, `ghost_gem_cluster`, `dragon_gem_cluster`, `dark_gem_cluster`, `steel_gem_cluster`, `fairy_gem_cluster`

Comportamento: Type gems: deepslate_crystal_core (gera clusters das 18 gems), clusters colhíveis, blocos de armazenamento — mecânico + random tick.

#### K Culinária (campfire pot, campfire, poke snack/cake)

Faltando: `poke_cake`, `poke_snack`, `campfire_pot_black`, `campfire_pot_blue`, `campfire_pot_green`, `campfire_pot_pink`, `campfire_pot_red`, `campfire_pot_white`, `campfire_pot_yellow`, `campfire`, `soul_campfire`

Comportamento: Campfire pot: bloco colocado sobre a fogueira Cobblemon (substitui campfire/soul_campfire vanilla ao receber o pot), inventário/UI de cozinha com seasonings, receitas cooking_pot. Poke snack/cake: bloco com mordidas + atração de spawn (bait). Alto custo de script + UI.

#### L Baús dourados / relic coins

Faltando: `relic_coin_pouch`, `relic_coin_sack`, `gilded_chest`, `blue_gilded_chest`, `black_gilded_chest`, `yellow_gilded_chest`, `white_gilded_chest`, `green_gilded_chest`, `pink_gilded_chest`, `gimmighoul_chest`

Comportamento: Gilded chest (baú custom com inventário — Bedrock não tem container custom em bloco; alternativa: entidade com inventário ou bloco + entidade). gimmighoul_chest vira Gimmighoul ao abrir. Relic coin pouch/sack: bloco colocável.

#### M Itens colocáveis decorativos (plaques, orbs, potions, vitaminas, etc.)

Faltando: `white_plaque`, `light_gray_plaque`, `gray_plaque`, `black_plaque`, `brown_plaque`, `red_plaque`, `orange_plaque`, `yellow_plaque`, `lime_plaque`, `green_plaque`, `cyan_plaque`, `light_blue_plaque`, `blue_plaque`, `purple_plaque`, `magenta_plaque`, `pink_plaque`, `cleanse_tag`, `spell_tag`, `blunder_policy`, `weakness_policy`, `ring_target`, `magnet`, `galarica_wreath`, `flame_orb`, `toxic_orb`, `life_orb`, `light_ball`, `smoke_ball`, `kings_rock`, `galarica_cuff`, `unremarkable_teacup`, `masterpiece_teacup`, `chipped_pot`, `cracked_pot`, `sachet`, `metal_powder`, `quick_powder`, `bright_powder`, `never_melt_ice`, `scope_lens`, `wide_lens`, `zoom_lens`, `icy_rock`, `heat_rock`, `smooth_rock`, `damp_rock`, `destiny_knot`, `luminous_moss`, `metronome`, `eject_button`, `loaded_dice`, `iron_ball`, `metal_coat`, `upgrade`, `dubious_disc`, `throat_spray`, `full_heal`, `antidote`, `awakening`, `burn_heal`, `ice_heal`, `paralyze_heal`, `ether`, `max_ether`, `elixir`, `max_elixir`, `potion`, `super_potion`, `hyper_potion`, `max_potion`, `full_restore`, `dire_hit`, `guard_spec`, `x_accuracy`, `x_attack`, `x_defence`, `x_special_attack`, `x_special_defence`, `x_speed`, `hp_up`, `protein`, `iron`, `carbos`, `calcium`, `zinc`, `pp_up`, `pp_max`

Comportamento: Cobblemon deixa colocar muitos itens como bloco decorativo (StackableItemBlock empilha até N no mesmo bloco; OrbBlock; plaque; WallAttached). Puramente cosmético: gerar bloco com geometria convertida + minecraft:block_placer no item. Baixa prioridade.

#### N Decoração (tatami)

Faltando: `tatami_block`, `tatami_mat`

Comportamento: Tatami block (rotacional) e tatami mat (carpet rotacional): mecânico.


### 3. WORLDGEN

Cobblemon: `data/cobblemon/worldgen/` — 21 configured_features raiz + ore/12 + habitats/17 + fossils/23 + ruins/3 + galarica_nuts/2 + hearty_grains/2; placed_features: 18 raiz + ore/42 + habitats/17 + fossils/23 + ruins/3. Features "coded" (Kotlin: `ApricornTreeFeature`, `BerryGroveFeature`, `MintBlockFeature`, `SaccharineTreeFeature`, `TypeGemFeature`). Injeção em biomas: Fabric via `CobblemonImplementation.addFeatureToWorldGen` + tags `data/cobblemon/tags/worldgen/biome/has_feature/*` (apricorns_dense/normal/sparse, revival_herbs, saccharine_tree) e `has_ore/*` (22 tags); NeoForge via `neoforge/biome_modifier/coded.json` + `CobblemonBiomeModifiers.kt`. 67 biome tags `is_*` (usadas também pelo spawn).

Port: `features/` 28 arquivos (7 `*_apricorn_prefab` + `apricorn_prefab` genérico via `.mcstructure`, 20 ore features = 10 pedras × common/rare) e `feature_rules/` 31 (1 `apricorn_prefab_rules` + 30 ore rules = 10 pedras × lower/lower_rare/upper). `structures/cobblemon/*_apricorn_tree.mcstructure` (7) + `structures/old/`.

| Grupo | Cobblemon | Port | Faltando / observação |
|---|---|---|---|
| Minérios de pedra evolutiva (overworld/deepslate) | 10 pedras, 42 placed (normal/rare/upper/lower) | 10 pedras (20 features + 30 rules) | Paridade aproximada; conferir contagens/alturas vs `placed_feature/ore/*.json`. |
| Minérios especiais | nether_fire_stone, dripstone_moon_stone (+ terracotta_sun_stone bloco) | 0 | Faltam 2 features (nether + dripstone) e bloco terracotta. |
| Apricorn trees | 7 árvores + `apricorn_trees` (seleção aleatória), densidade por tag dense/normal/sparse | 7 prefabs + 1 regra | Existe; falta diferenciar densidades por bioma. |
| Saccharine tree | 1 | 0 | Falta (depende dos blocos saccharine). |
| Berry groves | 1 (coded, gera bushes maduros por bioma conforme `berries/*.json` spawn) | 0 | Falta (depende dos berry bushes). |
| Mints | `mints` + 6 por cor | 0 | Falta. |
| Ervas/cultivos | medicinal_leek, big_root, revival_herb, swamp_grains, plains_grains, galarica_nuts | 0 | Faltam 6. |
| Type gems | `type_gems` (crystal core em deepslate) | 0 | Falta. |
| Habitats (features decorativas) | 17 (treasure_hoard, abandoned_fortress, ancient_wellsprings, chorus_briars, deep_roots, earthen_hives, exposed_geodes, lost_ruins, quartz_spikes, rocky_outcrops, rocky_tidepools, root_nurseries, sandy_tidepools, skeletal_fall, strange_crimson/warped_fungal_dwellings, volcanic_plumes) | 0 | Faltam 17 (usam templates NBT). |
| Fossils (features) | 23 (`prehistoric_*`) | 0 | Faltam 23 (NBT em `structure/fossils`, 78 .nbt). |
| Ruins (features) | 3 | 0 | Faltam 3. |
| Estruturas jigsaw | 32 habitats, 29 ruins (inclui 6 gimmi towers), 3 shipwreck coves, 3 fishing boats; 4 structure_sets + 7 structure_sets "avoid_*" | 0 | Faltam todas (67 estruturas). Bedrock só tem jigsaw data-driven em versões recentes/experimentais; alternativa: feature `minecraft:structure_template_feature` com `.mcstructure` (sem peças jigsaw). |
| Vilas (Pokécenter etc.) | `data/minecraft/worldgen/template_pool/village/*/houses.json` + 70 .nbt em `structure/village_*` e `villages/` | 0 | Bedrock não permite injetar peças em vilas vanilla; alternativa: estrutura avulsa perto de vilas ou nenhuma. |

Templates NBT totais em `data/cobblemon/structure`: **1.235** .nbt (habitats 584, ruins 431, fossils 78, shipwreck_coves 54, villages 50, village_* 20, fishing_boats 18). Todos precisariam conversão Java NBT → `.mcstructure` com remapeamento de ids/estados de bloco (e blocos Cobblemon custom). Processors (`processor_list`: habitats 84, ruins 54, fossils 23…) — aleatorização/erosão — não têm equivalente em Bedrock (aplicar na conversão, estaticamente).

### 4. RECEITAS

Cobblemon (`data/cobblemon/recipe`): **988** JSON, dos quais **209** em `mod_compatibility/` (Create, Farmer's Delight — irrelevantes para Bedrock) → **779** receitas próprias, **496** saídas `cobblemon:*` distintas. 213 usam `{"tag": ...}` em ingredientes.
Port (`behavior_packs/CobblemonBedrock/recipes`): **280** (`recipe_shaped` 138, `recipe_shapeless` 82, `recipe_furnace` 60), cabeçalho "generated with CobbleBuild" (ferramenta antiga, era 1.5, `format_version` 1.20.30). **168** saídas cobblemon distintas; extra fora do 1.8.2: `braised_vivichoke`. Ingredientes por tag `cobblemon:berries`/`cobblemon:apricorns` dependem de os itens terem essas tags em `minecraft:tags`.

| Tipo Cobblemon | Qtde | Equivalente Bedrock | Obs |
|---|---|---|---|
| minecraft:crafting_shaped | 302 | `minecraft:recipe_shaped` (tags `crafting_table`) | mecânico; expandir tags Java (`#c:...`, `#minecraft:planks`) para item/tag Bedrock |
| minecraft:crafting_shapeless | 74 | `minecraft:recipe_shapeless` | mecânico |
| minecraft:smelting | 107 | `minecraft:recipe_furnace` (tags `furnace`) | mecânico |
| minecraft:blasting / smoking / campfire_cooking | 25 / 1 / 1 | `recipe_furnace` com tags `blast_furnace` / `smoker` / `campfire`,`soul_campfire` | mecânico |
| minecraft:stonecutting | 76 | `recipe_shapeless` com tags `["stonecutter"]` | mecânico (tumblestone) |
| minecraft:smithing_transform | 48 | `minecraft:recipe_smithing_transform` (template/base/addition) | suportado; template precisa de tag `minecraft:transform_templates`; base = vara de pesca vanilla → poke rod |
| minecraft:smithing_trim | 1 | `recipe_smithing_trim` | trim pattern custom não suportado em Bedrock → pular |
| cobblemon:cooking_pot / cooking_pot_shapeless | 27 / 90 | **nenhum** | receitas do campfire pot com seasoning (ingrediente extra muda sabor/efeitos, `seasoningProcessors`); exige UI + script |
| cobblemon:brewing_stand | 27 | **nenhum nativo** (`recipe_brewing_mix` só aceita tipos de poção vanilla) | potions, status heals, ethers, ability capsule: input + bottle(`medicinal_brew`/`potion`...) → resultado; exige script (ex.: interação com brewing stand custom ou bloco próprio) ou converter para shapeless (perde a mecânica de brewing) |

Saídas Cobblemon sem nenhuma receita no port: **329**. Por tipo das receitas faltantes: crafting_shaped 189, stonecutting 76, cooking_pot_shapeless 54, smithing_transform 48, crafting_shapeless 37, cooking_pot 26, brewing_stand 20, smelting 3.

Lista completa: `ability_capsule`, `ability_shield`, `air_balloon`, `ancient_azure_ball`, `ancient_azure_rod`, `ancient_citrine_ball`, `ancient_citrine_rod`, `ancient_feather_ball`, `ancient_feather_rod`, `ancient_gigaton_ball`, `ancient_gigaton_rod`, `ancient_great_ball`, `ancient_great_rod`, `ancient_heavy_ball`, `ancient_heavy_rod`, `ancient_ivory_ball`, `ancient_ivory_rod`, `ancient_jet_ball`, `ancient_jet_rod`, `ancient_leaden_ball`, `ancient_leaden_rod`, `ancient_origin_rod`, `ancient_poke_ball`, `ancient_poke_rod`, `ancient_roseate_ball`, `ancient_roseate_rod`, `ancient_slate_ball`, `ancient_slate_rod`, `ancient_ultra_ball`, `ancient_ultra_rod`, `ancient_verdant_ball`, `ancient_verdant_rod`, `ancient_wing_ball`, `ancient_wing_rod`, `antidote`, `apricorn_fence`, `apricorn_fence_gate`, `apricorn_stairs`, `aprijuice_black`, `aprijuice_blue`, `aprijuice_green`, `aprijuice_pink`, `aprijuice_red`, `aprijuice_white`, `aprijuice_yellow`, `automaton_armor_trim_smithing_template`, `awakening`, `azure_rod`, `beast_rod`, `big_malasada`, `binding_band`, `black_gilded_chest`, `black_plaque`, `black_tumblestone`, `black_tumblestone_block`, `black_tumblestone_brick_slab`, `black_tumblestone_brick_stairs`, `black_tumblestone_brick_wall`, `black_tumblestone_bricks`, `blank_tm`, `blue_gilded_chest`, `blue_plaque`, `blunder_policy`, `brittle_candy`, `brown_plaque`, `bug_gem_block`, `burn_heal`, `campfire_pot_black`, `campfire_pot_blue`, `campfire_pot_green`, `campfire_pot_pink`, `campfire_pot_red`, `campfire_pot_white`, `campfire_pot_yellow`, `candied_apple`, `candied_berry`, `casteliacone`, `cell_battery`, `cherish_rod`, `chiseled_black_tumblestone_bricks`, `chiseled_polished_black_tumblestone`, `chiseled_polished_sky_tumblestone`, `chiseled_polished_tumblestone`, `chiseled_sky_tumblestone_bricks`, `chiseled_tumblestone_bricks`, `citrine_rod`, `clear_amulet`, `clever_feather`, `clever_mochi`, `courage_candy`, `covert_cloak`, `coward_candy`, `cyan_plaque`, `damp_rock`, `dark_gem_block`, `dawn_stone_block`, `disc_shelf`, `display_case`, `dive_rod`, `dragon_gem_block`, `dream_rod`, `dusk_rod`, `dusk_stone_block`, `eject_button`, `eject_pack`, `electric_gem_block`, `elixir`, `ether`, `eviolite`, `exp_candy_l`, `exp_candy_m`, `exp_candy_s`, `exp_candy_xl`, `exp_candy_xs`, `expert_belt`, `fairy_feather`, `fairy_gem_block`, `fast_rod`, `fighting_gem_block`, `fire_gem_block`, `fire_stone_block`, `flying_gem_block`, `focus_sash`, `fossil_analyzer`, `fresh_start_mochi`, `friend_rod`, `full_heal`, `full_restore`, `galarica_cuff`, `galarica_wreath`, `genius_feather`, `genius_mochi`, `ghost_gem_block`, `gilded_chest`, `grass_gem_block`, `gray_plaque`, `great_rod`, `green_gilded_chest`, `green_plaque`, `ground_gem_block`, `heal_rod`, `health_candy`, `health_feather`, `health_mochi`, `hearty_grain_bale`, `hearty_grains`, `heat_rock`, `heavy_rod`, `hyper_potion`, `ice_gem_block`, `ice_heal`, `ice_stone_block`, `icy_rock`, `iron`, `iron_ball`, `jubilife_muffin`, `lava_cookie`, `leaf_stone_block`, `level_rod`, `light_ball`, `light_blue_plaque`, `light_gray_plaque`, `lime_plaque`, `loaded_dice`, `love_rod`, `luminous_moss`, `lumiose_galette`, `lure_rod`, `luxury_rod`, `magenta_plaque`, `master_rod`, `masterpiece_teacup`, `max_elixir`, `max_ether`, `max_potion`, `medicinal_brew`, `metal_alloy`, `metronome`, `mighty_candy`, `monitor`, `moon_rod`, `moon_stone_block`, `muscle_feather`, `muscle_mochi`, `nest_rod`, `net_rod`, `normal_gem_block`, `numb_candy`, `old_gateau`, `open_faced_sandwich`, `orange_plaque`, `paralyze_heal`, `park_rod`, `pasture`, `pewter_crunchies`, `pink_gilded_chest`, `pink_plaque`, `poison_gem_block`, `poke_bait`, `poke_cake`, `poke_rod`, `poke_snack`, `pokedex_black`, `pokedex_blue`, `pokedex_green`, `pokedex_pink`, `pokedex_red`, `pokedex_white`, `pokedex_yellow`, `pokerod_smithing_template`, `polished_black_tumblestone`, `polished_black_tumblestone_slab`, `polished_black_tumblestone_stairs`, `polished_black_tumblestone_wall`, `polished_sky_tumblestone`, `polished_sky_tumblestone_slab`, `polished_sky_tumblestone_stairs`, `polished_sky_tumblestone_wall`, `polished_tumblestone`, `polished_tumblestone_slab`, `polished_tumblestone_stairs`, `polished_tumblestone_wall`, `ponigiri`, `potato_mochi`, `potion`, `premier_rod`, `protective_pads`, `psychic_gem_block`, `punching_glove`, `purple_plaque`, `quick_candy`, `quick_rod`, `rage_candy_bar`, `red_card`, `red_plaque`, `relic_coin`, `relic_coin_pouch`, `relic_coin_sack`, `repeat_rod`, `resist_feather`, `resist_mochi`, `restoration_tank`, `ring_target`, `rock_gem_block`, `room_service`, `roseate_rod`, `saccharine_boat`, `saccharine_button`, `saccharine_chest_boat`, `saccharine_door`, `saccharine_fence`, `saccharine_fence_gate`, `saccharine_hanging_sign`, `saccharine_planks`, `saccharine_pressure_plate`, `saccharine_sign`, `saccharine_slab`, `saccharine_stairs`, `saccharine_trapdoor`, `saccharine_wood`, `safari_rod`, `scope_lens`, `sharp_beak`, `shell_bell`, `shiny_stone_block`, `sickly_candy`, `silver_powder`, `sinister_tea`, `sky_tumblestone`, `sky_tumblestone_block`, `sky_tumblestone_brick_slab`, `sky_tumblestone_brick_stairs`, `sky_tumblestone_brick_wall`, `sky_tumblestone_bricks`, `slate_rod`, `slow_candy`, `smart_candy`, `smoke_ball`, `smoked_tail_curry`, `smooth_black_tumblestone`, `smooth_black_tumblestone_slab`, `smooth_black_tumblestone_stairs`, `smooth_rock`, `smooth_sky_tumblestone`, `smooth_sky_tumblestone_slab`, `smooth_sky_tumblestone_stairs`, `smooth_tumblestone`, `smooth_tumblestone_slab`, `smooth_tumblestone_stairs`, `soothe_bell`, `sport_rod`, `steel_gem_block`, `stripped_saccharine_wood`, `sun_stone_block`, `super_potion`, `sweet_heart`, `swift_feather`, `swift_mochi`, `tatami_block`, `tatami_mat`, `terrain_extender`, `throat_spray`, `thunder_stone_block`, `timer_rod`, `tm_machine`, `tough_candy`, `tumblestone`, `tumblestone_block`, `tumblestone_brick_slab`, `tumblestone_brick_stairs`, `tumblestone_brick_wall`, `tumblestone_bricks`, `ultra_rod`, `unremarkable_teacup`, `utility_umbrella`, `verdant_rod`, `water_gem_block`, `water_stone_block`, `weak_candy`, `weakness_policy`, `white_gilded_chest`, `white_plaque`, `wide_lens`, `x_defence`, `x_special_attack`, `x_special_defence`, `yellow_gilded_chest`, `yellow_plaque`, `zoom_lens`


### 5. TEXTURAS E MODELOS

Base: `upstream/cobblemon/common/src/main/resources/assets/cobblemon/`.

| Pasta | Arquivos | Formato / conversão |
|---|---|---|
| `textures/item/` | 831 PNG (subpastas: poke_balls, medicine, held_items, berries, mints, mochis, feathers, iv_candy, experience_candy, evolution, battle_items, food, aprijuice, campfire_pots, fishing, pokedexes, fossils, sherds, tms, type_gem, wearable, wood, mulches, poke_puffs, trims, advancements) | PNG direto → `textures/item/...` + entrada em `item_texture.json`. **Mecânico.** |
| `textures/block/` (+ `textures/berries`, `textures/poke_balls`, `textures/fossils`) | 706 em `block/` (777 com berries/`block`) — wood, building_blocks, crops, berries, campfire_pot, decorative, disc_shelf, evolution, food, functional, plaques, tumblestone, type_gems | PNG direto → `terrain_texture.json`. Texturas animadas (`.png.mcmeta`) → `flipbook_textures.json`. **Mecânico.** |
| `models/item/` | 1.145 JSON: 660 `item/generated` (ícone 2D — basta textura), 192 herdando de outros modelos de item, 164 herdando de modelo de bloco (block items), 63 `amethyst_bud` (tumblestone), 48 `handheld_rod` (poke rods), 15 com `elements` 3D, 1 `builtin/entity` | 2D: só `minecraft:icon`. Item 3D/handheld: attachable no RP (geo convertida). |
| `models/block/` | 1.099 JSON Java: **405 com `elements` custom** (precisam virar `.geo.json`), 101 `cross`, 77 `cube_all`, 10 `cube_column`, 10 `crop`, 9 `flower_pot_cross`, 44 stairs/slab (inner/outer/top), 7 `orientable`, restante herda de modelos-pai Cobblemon (monitor 24+9, revival_herb 17, plaque 48, vitamin_1..4 32, dire_hit_1..4 28, mulch 8, campfire_pot 21…) | Pais vanilla simples → `minecraft:geometry.full_block`/material_instances por face; cross/crop/stairs/slab/pot → geometrias template reutilizáveis; `elements` → conversor Java-block-model→Bedrock geo (cubos + UV por face + rotação; Blockbench faz isso manualmente, dá para automatizar). |
| `blockstates/` | 399 (319 `variants`, 80 `multipart`) | Viram `states`/`traits` + `permutations` no bloco Bedrock (propriedades age/facing/half/etc.). Multipart (fences, walls, berry bushes, campfire pot) exige permutações por combinação ou geometria com bones condicionais (`bone_visibility`). |
| `bedrock/` (já em formato Bedrock) | 5.872 arquivos: pokemon 4.510, particles 1.104, fossils 76 (fetos p/ restoration tank), berries 72 (`*_berry.geo.json` — frutos/arbusto), poke_balls 53, generic 28, npcs 12, block_entities 10 (`gilded_chest.geo.json`), misc 6 (`tm_disk`, water platforms), fishing 1 (`pokerod_hook`) | **Reuso direto** (geo/animações Bedrock) — Cobblemon usa esses para block entities renderizados (gilded chest, berry bush, restoration tank). |

Port RP (`resource_packs/CobblemonBedrock/textures`): 357 PNG em `item/`, 206 em `block/`; `item_texture.json` 323 chaves, `terrain_texture.json` 208; `models/blocks` 36 geos (portas, botão, slab, pressure plate, PC, healing machine, apricorn…).

### 6. ESTIMATIVA E PROPOSTA DE IMPORTADOR

#### Estimativa

| Frente | Esforço | Racional |
|---|---|---|
| Itens "burros" (ícone + nome + tags + stack size + food) — ~250 ids faltantes (held items, gems, plaques, fósseis, sherds, comidas, relic coins, mochis/penas, candies HT, pokédex visual, rods visual, bolas ancient) | **S** (gerado) | 100% dedutível de `CobblemonItems.kt` + lang + `models/item` + `textures/item`. |
| Blocos mecânicos (wood sets completos, tumblestone 54, gems 37, ores/blocos de pedra 12, tatami, hearty grain bale, plaques/decorativos 87) | **M** | Geometrias vanilla-like são template; `elements` (405) precisam do conversor; fences/walls/stairs precisam permutações. Sign/hanging sign/boat custom: **não suportados nativamente** (pular ou emular com entidade). |
| Receitas crafting/smelting/blasting/stonecutting/smithing (~355 faltantes destes tipos) | **S** | Tradução 1:1 + expansão de tags Java→Bedrock. |
| Worldgen simples (ores extras, mints, ervas, grains, galarica, saccharine tree, type gems) | **M** | Features Bedrock (`ore_feature`, `scatter_feature`, `structure_template_feature`) + feature_rules por biome tag (já há `BiomeResolver` no importer). |
| Estruturas (1.235 NBT, 67 estruturas jigsaw, habitats/fossils/ruins, vilas) | **L** | Conversão NBT→mcstructure com remapeamento de blocos + processors estáticos; jigsaw/vilas limitados em Bedrock. |
| Comportamento: medicina/vitaminas/mints/hyper training/ability capsule/berries curativas (uso na party e em batalha) | **M** | Um único "ItemUseRouter" em script com seletor de party + integração Showdown; itens dirigidos por dados (tipo → efeito). |
| Comportamento: berry bushes (crescimento/mutação/mulch), mint/crops, apricorn, tumblestone/gem budding | **M** | Custom components com `onRandomTick`/`onPlayerInteract`; lógica de mutação de `data/cobblemon/berries/*.json`. |
| Comportamento: campfire pot + 117 receitas cooking_pot + seasonings + poke bait/snack; brewing stand (27) | **L** | UI custom (forms) + inventário emulado + efeitos de seasoning/bait em spawn. |
| Comportamento: pasture, display case, TM machine/disc shelf/TMs, fossil analyzer+restoration tank+monitor, gilded chests, lectern/pokédex UI, poke rods (bobber + pesca) | **L** | Cada um é um subsistema com estado/UI/entidades. |

**Total geral: L** (itens+blocos+receitas mecânicos ≈ M juntos; o grosso do custo é comportamento).

#### Proposta: estender `tools/importer` (já existe em TS, gera espécies/modelos/spawns/lang com `BiomeResolver`/`BlockResolver`)

Novos módulos, todos idempotentes e escrevendo em `generated/` → copiados para os packs (mesmo fluxo de `import-report.json`):

1. **`items.ts`** — parser de `CobblemonItems.kt` igual ao usado nesta análise (regex por `val X = helper(...)` + tabela de helpers: `pokeBallItem`→path, `berryItem`→`${n}_berry`, `apricornItem`, `mintSeed`, `pokerodItem`, `pokedexItem`, `campfirePotItem`, `aprijuiceItem`, `x_${Stats}`), capturando também `stacksTo`, `rarity`, `food(nutrition,saturation)`, `craftRemainder`, classe (`PotionItem`, `VitaminItem`, `MintItem`…). Emite `items/<cat>/<id>.json` com `minecraft:icon`, `display_name` (chave lang), `max_stack_size`, `minecraft:food`/`use_animation`, `minecraft:block_placer` (para ItemNameBlockItem/BlockItem), `minecraft:tags` (a partir de `data/cobblemon/tags/item/*`) e `minecraft:custom_components: ["cobblemon:<behaviour>"]` onde a classe mapeia para um comportamento script (medicine, vitamin, mint, hyper_training, evolution_item, held_item…). Textura: resolver `models/item/<id>.json` → `layer0` → copiar PNG e registrar em `item_texture.json`. Corrigir aliases (`x_defense`→`x_defence` etc.).
2. **`blocks.ts`** — parser de `CobblemonBlocks.kt` + `blockstates/<id>.json` + `models/block/*.json`. Tabela de "arquétipos" por classe/pai: `cube_all`/`cube_column`/`orientable` → full_block + material_instances; `cross`/`crop`/`flower_pot_cross`/`stairs`/`slab`/`wall`/`fence`/`door`/`trapdoor`/`button`/`pressure_plate` → geos-template já existentes no port (`models/blocks`) + custom components existentes (`SlabComponent`, `DoorComponent`, `ButtonComponent`, `PressurePlateComponent`, `StripLogComponent`, `LeavesDecayComponent`…); `elements` → conversor Java model → `.geo.json` (um bone por modelo, cubo por element, UV por face, rotação origin/angle); `variants` → `states` + `permutations`; multipart → permutações/`bone_visibility`. Loot: traduzir `data/cobblemon/loot_table/blocks/*.json` → `loot_tables/blocks/*.json`. Classes que exigem lógica (`BerryBlock`, `MintBlock`, `ApricornBlock`, `TumblestoneBlock`, `TypeGemCluster`, `PastureBlock`…) recebem só o `custom_components` apontando para o componente script correspondente (escrito à mão).
3. **`recipes.ts`** — `data/cobblemon/recipe/*.json` (ignorando `mod_compatibility/`): shaped/shapeless → `recipe_shaped`/`recipe_shapeless`; smelting/blasting/smoking/campfire → `recipe_furnace` com tags; stonecutting → shapeless `["stonecutter"]`; smithing_transform → `recipe_smithing_transform`; tags Java `#ns:tag` expandidas via `data/*/tags/item` para lista de itens ou tag Bedrock equivalente; ids Java→Bedrock via `BlockResolver`/tabela de itens vanilla. `cooking_pot*` e `brewing_stand` → exportar para um módulo de dados TS (`scripts/generated/cookingRecipes.ts`, `brewingRecipes.ts`) consumido por script, em vez de JSON de receita. Substituir as 280 receitas CobbleBuild (1.5) pelas geradas.
4. **`worldgen.ts` (estender)** — `configured_feature/ore/*` + `placed_feature/ore/*` → `ore_feature` + `feature_rules` (altura/contagem de `height_range`/`count`); features simples (mints, ervas, grains, galarica) → `scatter_feature` + `single_block_feature`; árvores (apricorn/saccharine) → reuso `structure_template_feature`; biomas via tags `has_feature/*` e `has_ore/*` já resolvidas pelo `BiomeResolver`.
5. **`structures.ts` (fase posterior, L)** — NBT Java → `.mcstructure` (lib `prismarine-nbt`), remapeando paleta de blocos com `BlockResolver` e aplicando processors estaticamente; começar pelos habitats/fossils usados como features simples.

**Escrito à mão (scripts/):** roteador de uso de item na party/batalha (medicina, vitaminas/penas/mochis, mints, hyper training, ability capsule/patch, berries curativas, PP), crescimento/mutação de berry bushes e crops, campfire pot + seasonings + bait, brewing stand custom, pasture, display case, TM machine/disc shelf/TMs, fósseis (analyzer + tank + monitor), gilded/gimmighoul chest, lectern/pokédex UI, poke rods (bobber + pesca), wearables (attachables de chapéu).
