# Frente "adaptacoes" (BDS `adapt`, porta 19150, RakNet)

Cinco adaptações aprovadas pelo usuário para chegar o mais perto possível do Cobblemon 1.8.2 (Java) com APIs
estáveis (`@minecraft/server` 2.10.0, `@minecraft/server-ui` 2.2.0) e laços baratos.

## Arquivos

| Tipo | Arquivos |
|---|---|
| Scripts (novos) | `scripts/adaptacoes/{index,probe,containerLogic,potHoppers,potRedstone,bees,dispenser,decoratedPot,decoratedPotLogic,sherds,mentalRestoration,flags}.ts`, `scripts/custom_components/adaptacoes.ts` (só a chave do componente `cobblemon:decorated_pot`, para o validador) |
| Panela na fogueira (a frente passou a ser dona do bloco/tampa depois da mundo-sons) | `scripts/machines/cooking.ts` (`setPotPowered`; o `tickCookingPots` não lê mais o `getRedstonePower()` da fogueira), complementos `behavior_packs/CobblemonBedrock/blocks/cobblemon/{campfire,soul_campfire}.json` **apagados** (só traziam o `minecraft:redstone_consumer`), bloco 8 de `tests/mundo-sons.test.ts` (agora exige a fogueira sem o complemento). A linha "campfire, soul_campfire → redstone_consumer" da tabela de complementos em `docs/pendencias/mundo-sons.md` ficou obsoleta (arquivo de outra frente, não editado) |
| Importador (novo) | `tools/importer/adaptacoes.ts` (vaso decorado: bloco, item, entidade, geometrias, render controllers, texturas dos padrões do Cobblemon, atlas e sons; comparador da fogueira atrás da chave `CAMPFIRE_COMPARATOR`) |
| Teste | `tests/adaptacoes.test.ts` |
| Textos | seção `## adaptacoes` no fim de `resource_packs/CobblemonBedrock/texts/{en_US,pt_BR}.lang` |
| Ganchos de 1 linha fora da frente | `scripts/main.ts` (`startAdaptacoes()` no worldLoad + import), `tools/importer/index.ts` (`emitAdaptacoes()` depois do `patchBlocks()` + import), `tools/importer/validate.ts` (client entity pode usar `textures/blocks/*` do RP vanilla, a mesma regra que já valia para partículas) |

Conteúdo gerado (em `generated/`, rodar `npm run import`): `blocks/adaptacoes/decorated_pot.json`, `items/adaptacoes/decorated_pot.json`,
`entities/display/decorated_pot_display.json`, `entity/display/decorated_pot_display.entity.json`,
`models/blocks/adaptacoes/decorated_pot.geo.json`, `models/entity/adaptacoes/decorated_pot_sides.geo.json`,
`render_controllers/adaptacoes/decorated_pot.render_controllers.json`, `textures/entity/decorated_pot/*_pottery_pattern.png` (6), chaves
`cobblemon_decorated_pot_base/side` no `terrain_texture.json`, `cobblemon_decorated_pot` no `item_texture.json` e
`cobblemon:decorated_pot` (som `decorated_pot`) no `blocks.json`.

## Status por item

| Item (PARIDADE-MECANICAS) | Status | Prova |
|---|---|---|
| Panela na fogueira: funil (#40, linha "Panela na fogueira") | FEITO | `potHoppers.ts`. BDS: funil em cima com `oran_berry×2` + `stick×2` → berry nos temperos (espaço 10, `seasonings[0]×2`), graveto na grade; funil a oeste com maçã (tempero) → grade (pelo lado não entra nos temperos, como `canPlaceItemThroughFace`); funil embaixo puxou `ponigiri×2` do resultado (só o resultado sai). Em ~3 s, 1 item por funil a cada 8 ticks |
| Panela na fogueira: comparador (#40) | FEITO | `CAMPFIRE_COMPARATOR = true`; a fogueira não tem mais `minecraft:redstone_consumer` e a tampa lê a redstone dos vizinhos por script (linha abaixo). BDS `pot` com bot conectado (circuito ao vivo): panela com 6×64 terra (13 espaços) → `cobblemon:comparator` 7, fogueira `getRedstonePower()` = 7 estável (com o consumer era só no tick da troca), comparador encostado `powered_comparator` 7, fio 7 → 6; `soul_campfire` com 9×64 diamantes → 10, lâmpada acesa. A saída não fecha a tampa: `lid: false` e `powered` nunca gravado nessa panela por ~20 min. Comparador de lado (`cardinal_direction` = norte, panela a oeste) ficou em 0 e fora da máscara. Depois de reiniciar o servidor (recarga do chunk): comparador 7 → fio 6 e alma 10 → lâmpada acesa sozinhos, tampas como antes |
| Panela na fogueira: tampa por redstone sem `redstone_consumer` (CampfireBlock.neighborChanged / hasNeighborSignal) | FEITO | `potRedstone.ts` (a cada 2 ticks, só panelas registradas e carregadas). BDS com bot: alavanca ao lado → `lid: true`, desligar → `false`, ligar de novo → `true`, tirar → `false`; bloco de redstone ao lado → fecha, tirar → abre; fio vindo de um bloco de redstone → fecha, tirar a fonte → abre; repetidor com a saída para a panela → fecha, virado para fora → abre; tocha ao lado da fogueira de alma → fecha, tirar → abre (com o comparador 10 aceso o tempo todo). Bloco sólido: pedra com alavanca presa nela → fecha; alavanca no chão ao lado da pedra → abre (a pedra informa 15 no Bedrock, mas o Java não a energiza); pedra ao lado de bloco de redstone → não fecha; pó em cima da pedra → fecha, tirar a fonte → abre. Depois da recarga: a panela com a alavanca presa na pedra continua `lid: true, powered: true` || Abelhas: `bee_growables` (#108) | FEITO | `bees.ts`. BDS (abelhas com `collected_nectar` em caixas de vidro, sem forçar sorteio): red_mint 0→7, revival herb 3→8 com a mutação `mental` → `none` (CropBlock.getStateForAge volta ao estado padrão, igual ao Java), folha de saccharine 0→2; contador `cobblemon:bee_crops` subindo (limite de 10 por polinização) |
| Dispenser: tesoura em berry/apricorn (#31) | FEITO | `dispenser.ts`. BDS: `triggered_bit` sobe 1 tick depois do sinal e o disparo sai 4 ticks depois (medido). Tesoura: oran berry 5→3 com 2 frutos, apricorn 3→0 na folha com o loot, big root → hanging roots + linha; desgaste 1 por tosquia (238 de durabilidade). Dispenser com tesoura + terra em 10 disparos: 7 tosquias (14 frutos, desgaste 7→14); as 3 terras que o Bedrock ejetou em disparos de tesoura voltaram ao dispenser; a terra de um disparo legítimo de terra ficou no chão |
| Dispenser: mel/água na saccharine (#113) | FEITO | BDS: mel → folha 0→2 e garrafa vazia no dispenser; poção → folha 2→0 e garrafa vazia no espaço que ficou livre; o item ejetado some |
| Trim `automaton` (#113) | NÃO POSSÍVEL NO BEDROCK | O Java registra o padrão por dado (`data/cobblemon/trim_pattern/automaton.json` → `asset_id`/textura). O Bedrock não tem definição de padrão de trim por add-on: `minecraft:recipe_smithing_trim` só aceita templates com a tag `minecraft:trim_templates` e o padrão vem do template vanilla (doc oficial `minecraftRecipe_SmithingTrim.md`); não há esquema `trim_pattern` nos metadados do bedrock-samples v1.26.50.4. O item `cobblemon:automaton_armor_trim_smithing_template` continua como item (receita de cópia e loot) |
| Sherds no vaso decorado (#10) | FEITO (receita por tela, ver desvios) | `decoratedPot.ts` + importador. BDS: `vase` com fundo=tijolo, esquerda=dome, direita=angler, frente=helix, olhando para o norte → propriedades `north=0 east=1 south=27 west=26`; guardar: diamante 5→3 na mão, vaso ×2, graveto recusado; funil em cima pôs 3 diamantes e o de baixo puxou tudo; comparador aceso com fio = 3 depois da recarga; criação: 4 sherds vanilla → recusado, 3 domes com 2 no inventário → recusado, válido → vaso com lore (frente, esquerda, direita, fundo) e ingredientes gastos; quebra: picareta → rachou e soltou tijolo + 3 sherds + o diamante guardado, mão → vaso com as decorações, picareta com Toque Suave → vaso + 10 diamantes, criativo → nada além do conteúdo; flecha caindo → rachou; TNT → vaso + esmeralda guardada; `/setblock` → vaso liso registrado |
| Mental Herb / `mental_restoration` (#43) | FEITO (equivalência abaixo) | `mentalRestoration.ts`. BDS: jogador com contador 75000, tempero de 200 ticks nível 0 → desconto `c = 6200` (31 × 200), contador do Java 69020 < 72000 → probabilidade de manter phantom 0; dois `/summon phantom` acima do jogador (causa `Spawned`) sumiram na hora (`testfor @e[type=phantom]` → nenhum) |

### Equivalência do Mental Herb

- Java: `MentalRestorationEffect` desconta `31 × (nível + 1)` por tick de TIME_SINCE_REST (mínimo 0); `PhantomSpawner`
  gera phantom quando `random.nextInt(max(1, T)) >= 72000`, ou seja, com chance `p(T) = (T − 72000) / T`.
- Bedrock: o contador de insônia não é visível a scripts. Por jogador guardamos `b` (ticks acordado desde o último
  sono/morte, os dois jogos zeram nesses casos) e `c` (desconto do Mental Herb, limitado a `b` a cada 20 ticks, o
  equivalente ao mínimo 0). O contador do Java seria `J = b − c`.
- Quando o Bedrock gera um phantom natural (causa `Spawned`) até 16 blocos na horizontal e 10–48 acima de um jogador,
  o grupo inteiro daquele tick fica com probabilidade `p(J) / p(max(b, 72001))` (a taxa final é a do Java) e some
  caso contrário. Sem Mental Herb (`c = 0`) nada muda. Aplicação: `itemCompleteUse` de qualquer comida com o efeito
  nos dados do Campfire Pot (dynamic property ou lore), como o `MobEffectsComponent` do Java.

## Desvios do Java (e por quê)

1. **Funil na panela:** pilhas com dados que o `SlotItem` da panela não guarda (encantamento, desgaste, dynamic
   properties) não entram pelo funil (o Java aceita qualquer item). Laço a cada 8 ticks (o Java move quando o
   cooldown do funil zera; mesma taxa, fase diferente).
2. **Comparador (panela e vaso):** só comparador encostado e com a entrada virada para o bloco (a máscara liga só essas
   faces; no Java o comparador lê o bloco atrás dele e um de lado recebe 0 da panela/vaso); ler através de bloco sólido
   não é reproduzido. O sinal muda em até 8 ticks (o Java é imediato). O BDS sem jogador não reavalia circuitos ao vivo
   (nem vanilla), então a prova é com um bot de protocolo conectado (`tests/e2e/lib/bot.mjs`) ou pela recarga do chunk.
3. **Abelhas:** a exigência de colmeia válida (`isHiveValid`) fica de fora (a casa da abelha não é visível a scripts).
   Amostragem a cada 10 ticks com a posição do momento (5 ticks de meta simulados). Apricorns e galarica estão na tag,
   mas o Java não os faz crescer (não são CropBlock) — mantido. Berries não estão na tag.
4. **Dispenser com tesoura e outros itens:** o Bedrock sorteia o próprio espaço. Quando o sorteio do Java (feito
   pelo script) não é a tesoura e o do Bedrock é, nada sai (no Java o outro item sairia): a chance do outro item sair
   fica `(1 − p)²` em vez de `1 − p` (p = chance de sortear a tesoura). Com só tesoura é idêntico.
5. **Mel na tora de saccharine deitada:** não vira tora com mel (a `saccharine_log_slathered` do port só existe em pé).
6. **Garrafa vazia:** o Java perde a garrafa quando a pilha de mel/poção era a última do seu espaço e não há espaço
   livre antes dele (o `setItem` do dispenser sobrescreve); aqui a garrafa sempre volta ou cai no chão.
7. **Registro dos dispensers de tesoura:** dispensers postos antes desta versão passam a funcionar quando alguém abre
   o dispenser, põe/usa um bloco do Cobblemon ao lado, ou quando ele dispara mel/poção. Mel e poção funcionam sempre
   (evento de spawn do item).
8. **Vaso decorado:**
   - Receita: a grade de criação do Bedrock não chama scripts e não há como pôr as decorações no resultado. Usar uma
     mesa de trabalho segurando um sherd do Cobblemon (sem agachar) abre a tela do vaso (fundo, esquerda, direita,
     frente, entre os itens do inventário); exige ao menos um sherd do Cobblemon (só vanilla continua no vaso vanilla
     da grade); gasta os ingredientes também no criativo, como a grade.
   - Visual: corpo liso do vaso vanilla no bloco + entidade que desenha os lados com sherd. Não foi conferido em
     cliente (BDS não renderiza). A posição leste/oeste dos lados depende do espelhamento do eixo X dos modelos do
     Bedrock (assumido como no humanoide: X− do modelo = direita da entidade); se estiver trocado no jogo, é só inverter
     `SIDE_BONES.east/west` em `tools/importer/adaptacoes.ts`.
   - Sem a animação de balançar (o corpo é bloco estático). Ícone do item: o lado liso vanilla.
   - Pistão: imóvel (o Java quebra o vaso ao empurrar).
9. **Mental Herb:** o contador começa em 0 quando o jogador entra pela primeira vez com esta versão (o contador real do
   Bedrock pode ser maior; phantom nascendo corrige para ≥ 72001). Efeito aplicado por comida consumida (não por
   `/effect`, que não existe para efeito de add-on).
10. **Tampa por redstone (sem `redstone_consumer`):**
   - Por que não o consumer (medido antes por esta frente): com ele o `minecraft:redstone_producer` das permutações é
     ignorado (`getRedstonePower()` = força só no tick da troca, 0 depois; comparador e lâmpada apagados também depois
     da recarga) e a própria saída entra no `getRedstonePower()` da fogueira e fecha a tampa (`lid: true` sozinha). Sem ele a fogueira é só produtora (`getRedstonePower()` = a própria saída, `undefined` sem
     comparador) e a entrada é lida dos 6 vizinhos com as regras do Java (`weakSignal` = getSignal por estado e direção;
     `directSignalTo` = getDirectSignalTo para bloco condutor).
   - Laço de 2 ticks (o Java reage no mesmo tick do neighborChanged). Como antes (mundo-sons), a panela posta numa
     fogueira já energizada fecha logo; no Java só fecharia na próxima mudança de vizinho.
   - Bloco condutor: o Bedrock dá força à pedra em casos que o Java não energiza (bloco de redstone ou alavanca solta ao
     lado: `getRedstonePower()` = 15, mas a lâmpada do outro lado fica apagada — medido), então o energizado é
     recalculado pelos vizinhos da pedra; a força do Bedrock só serve de filtro (sem força, nem examina). Não-condutores
     do Java tratados: funil, pistões, portas, alçapões, portões, trilhos, sino, baús, componentes de redstone e blocos
     do Cobblemon. Condutores parciais do Java (vidro etc.) não têm força no Bedrock e ficam de fora pelo filtro.
   - Convenções do Bedrock usadas (medidas no BDS): repetidor/comparador `minecraft:cardinal_direction` = lado da
     entrada; observador `minecraft:facing_direction` = lado observado (saída atrás); alavanca/botão apontam para longe
     do apoio; tocha de parede `torch_facing_direction` = lado do apoio. Não medidas (raras): gancho de tripwire (`direction`
     antigo como FACING) e para-raios (`facing_direction` para onde aponta), só no caso "preso num bloco condutor".
   - Forma do pó: calculada como no Java (em cruz quando solto, linha que se estende, curva não aponta) para decidir se
     ele energiza a pedra ao lado; pode diferir do desenho do pó no Bedrock. Jukebox tocando não conta como fonte.

## Pedidos a outras frentes

1. **ATENDIDO (feito por esta frente, dona da panela desde o fim da mundo-sons) — comparador da panela.** Pedido original,
   para registro:
   - tirar `minecraft:redstone_consumer` de `behavior_packs/CobblemonBedrock/blocks/cobblemon/{campfire,soul_campfire}.json`;
   - em `scripts/machines/cooking.ts`, trocar `redstonePower(block)` por uma leitura que ignore a saída do próprio bloco,
     por exemplo o maior `getRedstonePower()` dos 6 vizinhos que sejam fonte de sinal (fio, tocha, alavanca, botão,
     bloco de redstone, repetidor/comparador virados para a fogueira). Sem o consumer, `getRedstonePower()` da fogueira
     devolve só a saída do comparador (0..15) e fecharia a tampa;
   - depois: `CAMPFIRE_COMPARATOR = true` em `scripts/adaptacoes/flags.ts` e `npm run import`.
   Feito assim, com uma correção: o "maior `getRedstonePower()` dos vizinhos" não basta, porque no Bedrock a pedra ao
   lado de um bloco de redstone informa 15 sem estar energizada (lâmpada do outro lado apagada). O sinal fraco sai do
   estado de cada fonte e o condutor é recalculado pelos vizinhos dele (`scripts/adaptacoes/potRedstone.ts`, desvio 10).
2. **dados-ui — `scripts/events/MobEffects.ts`:** `mental_restoration` agora tem efeito por `scripts/adaptacoes/mentalRestoration.ts`
   (assinatura própria de `itemCompleteUse`). O comentário "NÃO POSSÍVEL NO BEDROCK" desse arquivo e a linha do
   `dados-ui.md` podem apontar para cá. Se preferirem centralizar em `applyCobblemonMobEffect`, chamar
   `applyMentalRestoration(player, duration, amplifier)` e remover a assinatura de `itemCompleteUse` em `startMentalRestoration`
   (senão o efeito conta duas vezes).
3. **Registro de custom components:** `cobblemon:decorated_pot` é registrado por `scripts/adaptacoes/index.ts` no
   `system.beforeEvents.startup`. Não acrescentar `ADAPTACOES_BLOCK_COMPONENTS` ao `Object.assign` de
   `scripts/custom_components/index.ts` sem tirar o registro de lá (registro duplicado falha no startup).
4. **Observação (mundo-detalhes, a conferir no cliente):** `emitDiscShelfDisplay` supõe "coluna 0 (X+ do modelo) =
   lado leste" com a entidade virada para o norte. Pelo humanoide vanilla (braço direito em X−), X− do modelo fica à
   direita da entidade, isto é, a leste quando ela olha para o norte. Se os discos aparecerem espelhados no jogo, é isso.

## Verificação

- `npm run import`: ok (`vaso decorado do Cobblemon (adaptacoes): 1`).
- `npm run validate`: `OK: nenhum erro` (depois da correção do orquestrador para o `cobblemon_npc` e do item do vaso abaixo).
- `npx tsc -p tsconfig.json`: 0 erros (e nenhum local/import não usado nos arquivos da frente com `--noUnusedLocals`).
- `npm test`: todos passam (`adaptacoes: ok`, `mundo-sons: ok`); `tests/adaptacoes.test.ts` bloco 1b cobre a tampa
  por vizinhança (fontes, direções, condutor, pó, blocos do Cobblemon, a saída da própria panela) e `setPotPowered`.
- Tampa/comparador (rodada da panela): `npm run import` (`fogueiras com comparador (adaptacoes): 2`), `npm run validate`
  OK, `npx tsc` 0, BDS próprio `COBBLEMON_DIST=dist-pot COBBLEMON_BDS=pot COBBLEMON_BDS_PORT=19156
  COBBLEMON_BDS_TRANSPORT=raknet COBBLEMON_BDS_ONLINE_MODE=false` com o bot `PotBot` conectado; log sem ERROR/WARN desta
  frente (só o aviso fixo de transporte). Sonda nova: `scriptevent cobblemon:adapt_pot_rs <x> <y> <z>` (vizinhos, força
  do Bedrock, sinal fraco/direto calculado, tampa) e `adapt_pot <x> <y> <z> fill <item> <n> <espaços>`.
- `node tools/check-ui-baseline.mjs`: ok.
- BDS próprio (`COBBLEMON_DIST=dist-adapt COBBLEMON_BDS=adapt COBBLEMON_BDS_PORT=19150 COBBLEMON_BDS_TRANSPORT=raknet`,
  com `COBBLEMON_BDS_ONLINE_MODE=false` para um bot de protocolo de `tests/e2e/lib/bot.mjs` ficar conectado — sem
  jogador o BDS não dispara dispensers): boot sem nenhum ERROR/WARN de conteúdo ou script desta frente (os únicos WARN
  são `[spawn] passe lento`, da frente spawn, e o aviso fixo de transporte do servidor). Conferências pela sonda
  `scriptevent cobblemon:adapt_*` (`scripts/adaptacoes/probe.ts` e `index.ts`, só pelo console e com
  `scriptevent cobblemon:debug_probes on`).

## Pedido da frente give (`/give cobblemon:decorated_pot` falha) — ATENDIDO

Resposta da frente adaptacoes: o item passou a `menu_category: { category: "items" }` em `tools/importer/adaptacoes.ts`
(o bloco continua `"none"`, que em bloco não afeta os comandos). Conferido no BDS `adapt`: `give AdaptBot cobblemon:decorated_pot 1`
→ `Gave item.cobblemon.decorated_pot * 1`; `clear AdaptBot cobblemon:decorated_pot` → `removing 1 items`; `npm run validate` sem erros.
O item sem decorações (criativo, /give) é o vaso liso; o com sherds vem da tela da mesa de trabalho.

Pedido original:

- **O quê:** no BDS 1.26.52, `give @a cobblemon:decorated_pot` responde `Syntax error: Unexpected "cobblemon:decorated_pot"`
  (o content log fica vazio). O item existe, mas os comandos não o enxergam.
- **Por quê:** item com `menu_category: { category: "none" }` e fora do `crafting_item_catalog` fica fora do enum de itens dos
  comandos. Em **item**, `is_hidden_in_commands: false` junto com `"none"` **não** resolve (medido com uma sonda). Em bloco,
  `"none"` funciona, mas o item com `replace_block_item` substitui o item do bloco. Detalhes em `docs/pendencias/give.md`.
- **Onde:** `tools/importer/adaptacoes.ts`, na linha do item (`description: { identifier: DECORATED_POT, menu_category: { category: "none" } }`).
- **Correção sugerida:** usar uma categoria visível, por exemplo
  `menu_category: { category: "construction", group: "cobblemon:itemGroup.cobblemon.blocks" }` (em item, medi `items` e
  `equipment` + grupo; `construction` segue a mesma regra, mas não foi medida em item), ou colocar
  `cobblemon:decorated_pot` no catálogo. Se o vaso deve mesmo ficar fora dos comandos, declare `is_hidden_in_commands: true`.
- **Efeito no validate:** `npm run validate` agora acusa esse item (seção 9b, `tools/importer/commandVisibility.ts`).
  O erro some com qualquer uma das três opções acima.
