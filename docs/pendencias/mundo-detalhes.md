# Frente "mundo-detalhes" (BDS `mundo-detalhes`, porta 19152, `dist-mundo-detalhes`)

Detalhes de mundo e entidade do Cobblemon 1.8.2 que faltavam: vestíveis e item segurado visível, luz dinâmica,
feto no tanque, estante de discos (discos + sequenciador), compostagem, catálogo do criativo, vasos, Fortuna,
apricorn (soco e semente na folha), espeleotema, escambo dos piglins, tags de comida vanilla, comportamentos de
espécie (Combee, Vulpix), raio/imunidades e limpezas (Braised Vivichoke, inflamáveis, atrito do Never-Melt Ice).

## Arquivos

| Tipo | Arquivos |
|---|---|
| Importador | `tools/importer/mundoDetalhes.ts` (novo), ganchos em `index.ts`, `models.ts` (ossos do item segurado), `entities.ts` (âncoras, `minecraft:equipment`, raposa, abelha), `items.ts` (`minecraft:compostable`, `minecraft:wearable`), `validate.ts` (attachables, entidades `display/`, overrides vanilla, texturas vanilla usadas de propósito); `tools/importer/data/vanilla_entities/` (cópia v1.26.50.4 do bedrock-samples: galinha, papagaio, cavalo, burro, mula) |
| Scripts | `scripts/entity/{HeldItemDisplay,DynamicLight,SpeciesBehaviours}.ts` (novos) + `scripts/entity/index.ts`; `scripts/world/{Lightning,VanillaInteractions,Fortune,mundoDetalhesProbe}.ts` (novos) + `scripts/world/index.ts`; `scripts/machines/{discShelfSequencer,fossilFetus}.ts` (novos) + ganchos em `decor.ts` (estante, luz do atril) e `fossils.ts` (feto); `scripts/custom_components/DripstoneGrowthComponent.ts` (novo) + `index.ts` |
| Gerado | `generated/scripts/mundoDetalhes.ts`; RP: `attachables/cobblemon/*.json` (34), `models/entity/wearables/*.geo.json` (17), `animations/pokemon/_generated/*_held.animation.json` (538), `entity/display/{disc_shelf_display,fossil_fetus}.entity.json`, geometrias/animações/render controllers do feto e da estante, `textures/block/disc_shelf/*` (47), `textures/fossils/*`; BP: `item_catalog/crafting_item_catalog.json`, `entities/display/*.json`, `entities/vanilla_overrides/{chicken,parrot,horse,donkey,mule}.json` |
| BP/RP à mão | `behavior_packs/.../entities/vanilla_overrides/piglin.json` (novo: cópia v1.26.50.4 + Relic Coin Pouch/moedas), `.../fox.json` (berries acrescentadas às listas de comida; o arquivo perdeu os comentários ao ser regravado), apagados: `items/generic/braised_vivichoke.json`, `recipes/braised_vivichoke*.recipe.json` (3), `resource_packs/.../textures/item/braised_vivichoke.png` e `textures/item_texture.json` (só tinha essa entrada) |
| Teste | `tests/mundo-detalhes.test.ts`; mock: `Direction` e `EntityDamageCause` acrescentados em `tests/mocks/minecraft-server.ts` |

## Verificação (2026-09-26)

- `npm run import` OK → `npm run validate` **OK, nenhum erro** (12 769 JSON, 897 client entities, 34 attachables).
- `npx tsc -p tsconfig.json` **0 erros**. `npm test` **todos os arquivos passam** (inclui `tests/mundo-detalhes.test.ts`).
- BDS `mundo-detalhes` (1.26.52): boot com **zero ERROR/WARN** de conteúdo ou script (último deploy 10:12) (o log só mostra o aviso de
  transporte RakNet do próprio BDS, usado para o bot). Conferência no mundo com um bot de protocolo
  (`tools/e2e/run.mjs --scenario`, cenários em scratchpad) + sonda de console `scriptevent cobblemon:md_*`
  (`scripts/world/mundoDetalhesProbe.ts`). Resultados no log do servidor citados abaixo como "BDS".
- **Limite:** sem cliente gráfico (pesquisa 6). Tudo o que é desenho (attachables, âncoras, discos, feto, orientação)
  foi validado por JSON/validador e pelo servidor aceitar o pacote, mas **precisa ser conferido no cliente**.

## Situação por item

| # | Item (tabelas de paridade) | Situação | Prova / notas |
|---|---|---|---|
| 1 | Vestíveis do 1.8.2 no jogador (17 itens: WearableHatItem + WearableBlockItem) | FEITO (conferir no cliente) | `minecraft:wearable` `slot.armor.head` nos 17 itens; attachable `.player` com a geometria convertida de `item/wearable/<nome>` (display.head × 0,625 em volta do centro da cabeça, como o CustomHeadLayer) e, na mão, o sprite do ícone com a geometria/animação do arco vanilla. BDS: `replaceitem ... slot.armor.head ... cobblemon:choice_band` aceito e lido de volta (`capacete=cobblemon:choice_band`). **Desvio:** pilha 1 (o Bedrock força pilha 1 em slot de armadura; no Java é 64). O "19" das tabelas contava os 2 modelos-molde (template_band/glasses), que não são itens |
| 2 | Vestíveis no Pokémon | FEITO (conferir no cliente) | Attachable padrão preso à âncora `cobblemon_anchor_hat`/`face` (osso novo em toda geometria de Pokémon, com pivô na origem, levado ao locator `item_hat`/`item_face` por uma animação gerada por espécie/variante — o binding de attachable usa coordenadas absolutas, então a âncora precisa ficar na origem); deslocamento e escala 0,62 do HeldItemRenderer; tag held/visibility hat/face; sem `item_hat` cai no locator `item` |
| 3 | Item segurado visível no modelo | FEITO (conferir no cliente) | Cópia visual do slot 0 na mão secundária (`replaceitem`, chance de drop 0 via `minecraft:equipment`), `leftItem`/`rightItem` no locator `item` de 753 arquivos de geometria; regras do updateShownItem: `heldItemVisible`, tag hidden (barreira), Alfa selvagem, sem locator = nada. BDS: Charmander com Choice Band e Pikachu com Leftovers → `mão2=true` (testfor hasitem offhand). 356 espécies não têm locator de item no modelo do Cobblemon (no Java também não desenham) |
| 4 | Luz dinâmica (`lightingData`, 70 espécies importadas das 88 com dado + formas) | FEITO | `minecraft:light_block_<n>` seguindo a cabeça a cada 5 ticks, LiquidGlowMode (LAND/UNDERWATER/BOTH; submerso a luz vai alagada), formas com luz própria, várias fontes na mesma célula = maior nível; só troca ar/água parada/luz nossa; posições gravadas (`cobblemon:dyn_lights`) e limpas ao recarregar; Pokédex na mão = 13 (PlayerLuminance). `/scriptevent cobblemon:dynamic_lights off` desliga. BDS: Charmander em terra → `luz=minecraft:light_block_11`; na água → sem luz (LAND); bot com Pokédex → `cabeça=minecraft:light_block_13`. **Desvio:** no Java isso só existe com um mod de luz dinâmica |
| 5 | NPC com modelo de Pokémon (`resourceIdentifier` de espécie) | NÃO POSSÍVEL NO BEDROCK | A client entity tem geometrias/texturas/animações fixas no pacote: desenhar qualquer espécie no `cobblemon:npc` exigiria pôr as 1149 geometrias e ~12 mil animações/controllers de Pokémon dentro da client entity do NPC. A alternativa (entidade "fantasia" de Pokémon montada no NPC) colide com os sistemas de Pokémon (spawner, captura, limpeza no entityLoad). Nenhum preset/NPC do 1.8.2 usa isso (só editor/datapack). |
| 6 | Feto no tanque de restauração | FEITO (conferir no cliente) | Entidade `cobblemon:fossil_fetus` gerada dos 19 modelos de `bedrock/fossils` (3 embriões + 16 fetos), curvas EMBRYO_CURVE_1..3/FOSSIL_CURVE em Molang sobre `cobblemon:progress`, escala em volta do `yGrowthPoint`, `maxScale`, `yTranslation`, animação sleep/gooping do poser; `fossils.ts` cria/atualiza/remove. BDS: `fetos: 10@0.9` (Kabuto), `12@0.3` (Omanyte). **Desvio:** vira para a frente do tanque (o Java usa o lado do analisador) |
| 7 | Estante de discos: discos visíveis | FEITO (conferir no cliente) | Entidade `cobblemon:disc_shelf_display` com 14 quadros 6×2 px (posições do DiscShelfBlockEntityRenderer), 47 texturas (`<disco>`, `<tipo>_tm`, blank_tm, upgrade, dubious_disc, `music_disc_unknown`), girada para a frente. BDS: `estante: 0,0,0,0,0,46,...` (Upgrade no espaço 5), yaw −90 (leste); estantes antigas ganham exibição sozinhas |
| 8 | Sequenciador de note block | FEITO (desvio) | Note block acima da estante (clique, soco, pulso de redstone por borda de subida) toca os espaços ocupados (NOTE_SLOT_TO_SEMITONE, oitavas pelos espaços 1/12, volume 3, instrumento do bloco embaixo, ar = bit). BDS: pulso sem erro. **Desvio:** a nota do próprio note block também toca (o Bedrock não deixa suprimir) |
| 9 | Compostagem (registerCompostable) | FEITO | `minecraft:compostable` (chance do Kotlin em %) em 140 itens com JSON (berries, mints, sementes, apricorns, ervas, remédios...); os 3 itens de bloco sem JSON (folhas de apricorn e de saccharine, fardo de hearty grain) pelo script na composteira (ComposterBlock.addItem, 7 → 8 após 20 ticks). BDS: folhas de apricorn → nível 1, 2 (chance 0,3) |
| 10 | Tags de comida vanilla | FEITO (3) / NÃO POSSÍVEL (1) | chicken_food/parrot_food (sementes de vivichoke e mint) → galinha (reproduzir/crescer/atrair) e papagaio (domar); horse_food (maçãs) → cavalo/burro/mula como a maçã (cura 3, temperamento +3, crescimento); fox_food (70 berries) → raposa; piglin_loved (moedas, saco, baús dourados) → piglin admira. **bee_growables** (bloco): NÃO POSSÍVEL — a abelha do Bedrock só faz crescer as plantas vanilla |
| 11 | Creative tabs | FEITO | `item_catalog/crafting_item_catalog.json` com as 7 abas do CobblemonItemGroups.kt na ordem do Kotlin (Blocos → construção, Utilitários → equipamento, Agricultura → natureza, demais → itens), nome `cobblemon:itemGroup.cobblemon.<aba>` com a tradução do Cobblemon (en_US/pt_BR), ícone da aba. BDS: sem avisos de categoria (blocos levam categoria+grupo do catálogo no menu_category) |
| 12 | Mudas/plantas em vaso | FEITO | Vaso vazio + semente de apricorn / muda de saccharine / Pep-Up Flower → `cobblemon:potted_*`; mão vazia devolve a planta. BDS: `plantou=true → potted_red_apricorn_sapling`, `tirou red_apricorn_seed → flower_pot` |
| 13 | Restos do Braised Vivichoke (removido no 1.7.0) | FEITO | Item, 3 receitas, textura e entrada do atlas apagados (a linha da .lang ficou: regra 10) |
| 14 | Fortuna (`apply_bonus`) | FEITO | Fórmulas ore_drops / uniform_bonus_count / binomial_with_bonus_count + limit_count e estados (`age`), sem bônus com Toque Suave, sobre a loot base: minérios de pedra evolutiva, blocos de gema, cachos de tumblestone, medicinal leek, galarica. **Correção da tabela:** as sementes de mint não têm Fortuna no 1.8.2 (nenhum `apply_bonus` nas loot tables de mint). BDS: `fortuna moon_stone_ore: 2 extras` |
| 15 | Colher apricorn com soco | FEITO | `entityHitBlock` no apricorn maduro → loot `blocks/apricorns/<cor>`, volta à idade 0, som de colheita; quebrar o maduro (criativo) colhe. BDS: `colheita: true → growth_state 0` |
| 16 | Semente de apricorn na lateral das folhas | FEITO | Face lateral da folha de apricorn → apricorn idade 0 virado para a folha. BDS: `red_apricorn_block {growth_state:0, cardinal_direction:"south"}` |
| 17 | Espeleotema sob o minério de pedra da lua | FEITO | Componente `cobblemon:dripstone_growable` (tag `dripstone_growable`) no minério: água parada em cima + estalactite presa → chance 0,011377778 por random tick de alongar (até 7) ou fazer crescer a estalagmite (até 10 abaixo), espessuras recalculadas. BDS: `tip` → `frustum,tip` → `base,frustum,tip` |
| 18 | Relic Coin Pouch no escambo dos piglins | FEITO | Override do piglin (cópia v1.26.50.4): interação de escambo e shareable `barter` com a bolsa |
| 19 | Pérola do ender no próprio Pokémon | FEITO | `beforeEvents.itemUse`: agachado mirando o próprio Pokémon (10 blocos) não arremessa |
| 20 | Combee poliniza (pokemon_bee) | FEITO (aproximação) | Grupos `bee_look_for_flower` (move_to_block nas flores da abelha vanilla, 20 s) e `bee_return` (folha de saccharine; colmeia/ninho), script troca por dia/chuva/néctar, deposita (saccharine +1 estágio / colmeia `honey_level`+1), 200 ticks de espera, partícula de néctar. BDS: ciclo completo — foi às dentes-de-leão e ganhou néctar (`néctar=true`), voou até a folha de saccharine, depositou (`cobblemon:age` 0 → 1, néctar zerado), esperou e voltou a polinizar. **Desvio:** o Combee não entra na colmeia (sobe o mel direto); abelhas vanilla não enchem folhas de saccharine |
| 21 | Raposa (Vulpix): pega itens/comida, come, colhe sweet berry | FEITO | BP: `pickup_items` (andar até o item) e `raid_garden` (sweet berry bush) no grupo selvagem; a coleta é por script (`beforeEvents.entityItemPickup`, cancelada sempre: o Bedrock guardava o item no inventário de 1 espaço — o do item segurado — e ele sumia, visto no BDS): 1 item na boca (mão principal, cai inteiro ao morrer), comida comida após 28 ticks com cura 2 (berries) ou 1. BDS: graveto fica na boca (`hasitem` na mão principal), 3 sweet berries pegas e comidas uma a uma. **Desvio:** o item da boca some se o Vulpix for capturado |
| 22 | `picks_up_items` / `gets_mad_at_thrower` | N/A NO COBBLEMON (dados base) | Nenhuma espécie do 1.8.2 aplica esses behaviours. O importador já liga `picks_up_items` se aparecer em `ai`; `onHitByPokeball` (scripts/entity) fica pronto para `gets_mad_at_thrower` |
| 23 | Imunidades: raio | FEITO | Terra imune; Lightning Rod (Força II 60 s), Motor Drive (Velocidade II 60 s), Volt Absorb (cura) imunes e sem fogo em volta (LightningBoltMixin); o fogo que o raio acende no imune é ignorado. BDS: Sandshrew vida 20 após o raio, Bulbasaur 20 → 12 |
| 24 | Mooshtank e o raio | FEITO | `behaviour.lightningHit.rotateFeatures` (vermelho ↔ marrom) uma vez por raio, som de conversão, imune ao resto do raio. BDS: `mooshtank-red` (variante 1) → `mooshtank-brown` (variante 2), vida 20 |
| 25 | Imunidades: neve fofa, sweet berry bush, congelamento | FEITO | Vulpix: família `lightweight` (fica em pé na neve fofa; o componente `can_stand_on_powder_snow` só existe no formato 1.26.50, o BDS recusou no 1.21.90) e `damage_sensor` do sweet berry bush; tipo Gelo ou `freezeImmune` sem dano de congelamento |
| 26 | Aranhas imunes a teia (`immuneToCobwebBlock`, 8 espécies) | NÃO POSSÍVEL NO BEDROCK | A lentidão da teia é fixa no motor (aranha vanilla é tratada por tipo); não há componente nem API para um mob ignorá-la |
| 27 | Inflamáveis | FEITO | `minecraft:flammable` exatamente nos 21 blocos do `setFlammable` do Kotlin com os valores do Java (toras 5/5, tábuas/cercas/lajes/escadas 5/20, folhas 30/60); botões, alçapões, portas e placas de pressão deixaram de ser inflamáveis (no Java não são) |
| 28 | Never-Melt Ice sem atrito | FEITO | `minecraft:friction` 0,011 (1 − 0,989) |
| 29 | Luz do atril com Pokédex | FEITO | Estado `cobblemon:emit_light` + permutação com luz 13 enquanto alguém lê a Pokédex no atril (LecternBlockEntity.hasViewer) |

Não conferidos no BDS (só teste unitário/validador): pérola do ender (precisa de jogador agachado mirando o próprio
Pokémon), congelamento do tipo Gelo, neve fofa do Vulpix, luz do atril, Fortuna quebrando o bloco com picareta
encantada (a fórmula e os dados foram conferidos pela sonda), sequenciador por redstone.

## Pedidos para outras frentes

- **captura** (opcional): quando a bola acerta um Pokémon selvagem, chamar `onHitByPokeball(pokemon, thrower)` de
  `scripts/entity` (gancho do `pokemon_gets_mad_at_thrower`; hoje nenhuma espécie usa, então não muda nada).
- **orquestrador**: o `tools/build.mjs` só tira comentários `//` no começo da linha ao mesclar JSON do BP escrito à
  mão com o gerado; arquivos com comentário no fim da linha (como era o `fox.json`) quebram o build se o importador
  gerar o mesmo caminho. Por isso o `fox.json` foi regravado sem comentários.

## Riscos / conferir no cliente

- Posição/escala dos vestíveis na cabeça do jogador e no Pokémon, do item na mão secundária (a transformação de mão
  do Bedrock não é o FIXED do Java), dos discos da estante (lado/espelhamento da textura) e do feto.
- Sinal do eixo X das âncoras (posição de animação) nos modelos em que o vestível cai no locator `item` fora do
  centro (≈ 90 variantes sem `item_hat`/`item_face`).
- Luz dinâmica: cada Pokémon com luz troca 1 bloco quando anda; muitas espécies luminosas juntas = muitas trocas.

Container removido no fim (`docker rm -f cobblemon-bds-mundo-detalhes`); os dados do mundo de teste ficam em
`.bds-mundo-detalhes/`.
