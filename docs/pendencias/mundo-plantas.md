# Pendências da frente "mundo-plantas"

Arquivos da frente: `scripts/custom_components/plants/**` (`index.ts` registra `PLANT_BLOCK_COMPONENTS`;
`mulch.ts` exporta `PLANT_ITEM_COMPONENTS`), `tests/plantas.test.ts`. Linha acrescentada em
`scripts/custom_components/index.ts`: import de `PLANT_ITEM_COMPONENTS` e `Object.assign(itemComponents, …)`.

## O que existe (paridade Cobblemon 1.8.2)

25 componentes de bloco + o componente de item `cobblemon:mulch`. Depois de `npm run import`, os blocos gerados já
trazem os componentes (só os da frente "mundo-máquinas" continuam pendentes em `blockBehaviours.ts`).

- **`cobblemon:berry_bush`** (70 berries): `BerryBlock` + `BerryBlockEntity`. O Bedrock não tem block entity em bloco
  custom: timers, pontos de crescimento e duração do mulch ficam num registro JSON por posição
  (`world` dynamic property `cobblemon:berry|<dim>|x,y,z`); o tipo de mulch fica no estado `cobblemon:mulch`, que o
  modelo gerado já desenha. Crescimento com a mesma matemática do Java (`growthTime`/`refreshRate` × 1,4 min,
  `goToNextStageTimer` 80–100% da média, compensação de tempo por `world.getAbsoluteTime()` a cada random tick).
  Em 3→4 gera o rendimento (`baseYield` + fator `preferred_biome` ou mulch favorito + rich mulch 1..2, teto nos
  growthPoints do modelo) e tenta mutação com os 4 vizinhos (12,5%, ×4 com surprise mulch). Colheita por interação
  na idade 5 (volta a 3 com timers de `refreshRate`) e ao quebrar maduro (fora do criativo). Farinha de osso com
  `boneMealChance` (gasta sempre). Pá tira o mulch. Arbustos de worldgen (idade 5, sem registro) ganham rendimento
  simples (`generateSimpleYields`). `cobblemon:rooted` não cresce (como no Java).
- **Mulch** (`cobblemon:mulch` nos 8 itens): arbusto (solo arado ou raiz presa, sem mulch, antes de florir; growth
  mulch corta os timers pela metade e dura 5 ciclos; rich 5 colheitas; surprise 3 tentativas de mutação; os demais são
  permanentes) e revival herb (só surprise mulch, até a idade 6, sorteia `mental/power/white/mirror`). No Java o mulch
  **não** vai direto no solo; mantido assim. Também aceito pela interação com o bloco (caso o `onUseOn` do item não
  dispare em bloco interativo; a checagem impede aplicar duas vezes).
- **Cultivos**: mints (luz ≥ 9, 1/8, farinha +1), vivichoke e revival herb (CropBlock vanilla com umidade da farmland
  3x3 e penalidade de vizinhos iguais; farinha +1 / +2..5), medicinal leek (1/4, sem luz), galarica (luz acima ≥ 9,
  1/8; madura dá 1..2 nozes e volta a 1), hearty grains (2 blocos: metade de cima a partir da idade 4, 1/16 com luz ≥ 8,
  farinha +1..3, quebrar em cima volta a de baixo para 3, metade de cima órfã some). Drops ao quebrar = loot tables por
  idade do importador.
- **Raízes** (big/energy root): espalham no escuro (luz < 11, 50%, teto de terra/pedra, cap de 9 na caixa 9x3x9,
  25% de virar energy root), tesoura (energy → big root + item; big → hanging roots + linha), farinha espalha, sem teto
  quebra com drop.
- **Tumblestone**: small → medium → large → cluster (1/5 por random tick com lava/magma no cubo 3x3x3), mantendo
  `minecraft:block_face`.
- **Gemas de tipo**: núcleo (`deepslate_crystal_core`) brota clusters ao lado das gemas ligadas a ele (busca em
  largura), atrofia com 7+ gemas; cluster cresce estágio 0..3 e vira o bloco de gema com clusters decorativos em volta.
  `SHOULD_GROW/STUNTED` do Java ficam num registro por posição (`cobblemon:gem|…` = `g`/`s`).
- **Saccharine**: `leaves_decay` genérico (typeId do próprio bloco; decaimento com a loot natural das folhas via
  `setblock … destroy`, com busca de tora antes de decair para não apagar árvore recém-carregada; tesoura devolve as
  folhas; folhas colocadas pelo jogador não decaem), mel nas folhas (escorre para a folha de baixo; garrafa vazia
  colhe na idade 2, garrafa de mel enche), muda (luz ≥ 9 e 1/7, farinha 45%; vira a feature
  `cobblemon:saccharine_tree` via `dimension.placeFeature`, devolvendo a muda se não couber), tora (machado descasca
  mantendo `minecraft:facing_direction`; garrafa de mel numa face lateral da tora em pé → `saccharine_log_slathered`
  virada para a face com `honey_type` aleatório), tora com mel (garrafa de água na face do mel ou água encostada
  nela → volta a tora comum), portas (reuso de `EnforceTop/BottomHalfComponent`).
- **Construção**: laje genérica (completa com a mesma laje na metade livre, regra de `SlabBlock.canBeReplaced`; drops
  pelas loot tables `__type_double`), escadas (`StairBlock.getStairsShape` exato, lendo também escadas vanilla por
  `weirdo_direction`/`upside_down_bit`; recalcula ao colocar/quebrar, nos vizinhos, por `playerPlaceBlock` /
  `playerBreakBlock` e por random tick), portão entre muros (`cobblemon:in_wall`), itens empilháveis (até 4, mesmo item
  na mão, sem agachar), decoração ativável (metronome alterna `cobblemon:active`).

## Aproximações conhecidas

- **Frutos/flores no arbusto**: no Java são desenhados por block entity renderer (modelos `flower.geo`/`<berry>.geo` em
  cada growth point). No Bedrock o modelo gerado mostra só a planta por idade (0..5) e o mulch; as idades 4 (flor) e 5
  (frutos) ficam iguais à 3. Ver pedido ao importador abaixo.
- Sem `updateShape`/vizinhança no Bedrock: sobrevivência (solo das berries/cultivos, raiz sem teto, metade de hearty
  grains) é conferida no random tick ou na quebra pelo jogador, não na hora.
- Taxa de random tick do Bedrock é diferente da do Java: cultivos por chance (mints, vivichoke, leek…) crescem em ritmo
  parecido mas não idêntico; as berries não são afetadas (compensação de tempo).
- Registros por posição (berries, gemas) apagados só ao quebrar pelo jogador; blocos destruídos por explosão/pistão
  deixam um registro órfão pequeno, que é descartado quando outra planta ocupa a posição.
- Hearty grains/tumblestone/itens empilháveis não ficam alagados (sem waterlogging de bloco custom).
- Sons de bloco do Cobblemon (`block.mulch.place`, `block.mulch.remove`, `block.berry_bush.harvest`) não são importados;
  uso os vanilla `dig.gravel` e `block.sweet_berry_bush.pick` (constantes em `BERRY_SOUNDS`, `berry.ts`).

## Pedidos

1. **Importador (`tools/importer/items.ts`)**: levar `growthPoints.length` para `ITEMS[berry].berry.growthPointCount`
   (hoje há uma tabela fixa em `berry.ts`, que usa o campo do importador quando existir).
2. **Importador (`tools/importer/sounds.ts`)**: importar os eventos `block.*` do `sounds.json` do Cobblemon (pelo menos
   `block.mulch.place`, `block.mulch.remove`, `block.berry_bush.harvest`) como `cobblemon.block.…`; aí troco
   `BERRY_SOUNDS` para eles.
3. **Importador (`tools/importer/blocks.ts`, BerryBlock)**: bones extras visíveis por idade para flor (idade 4) e frutos
   (idade 5), com o `flowerModel`/`fruitModel` da berry posicionados nos `growthPoints` (posições fixas, sem
   embaralhar). Os scripts não precisam mudar: o estado `cobblemon:age` já é mantido.
4. **Importador (`blocks.ts`, TypeGemClusterBlock)**, opcional: estados `cobblemon:should_grow`/`cobblemon:stunted` no
   cluster permitiriam dispensar o registro por posição (`gems.ts`).
5. **Importador (`blocks.ts`)**, opcional: a descrição do `cobblemon:saccharine_sapling` cita
   `cobblemon:saccharine_tree_feature`, mas a feature gerada é `cobblemon:saccharine_tree` (o script usa esta).

Sem textos novos para `en_US`/`pt_BR`.

## Status da integração

- 1. `ITEMS[berry].berry.growthPointCount`: ✅ feito (integração).
- 2. Sons `cobblemon.block.*`: ✅ feito (integração) — `BERRY_SOUNDS` usa `cobblemon.block.berry_bush.harvest` e `cobblemon.block.mulch.place/remove`.
- 3. Flores (idade 4) e frutos (idade 5) no arbusto: ✅ feito (integração) — bones por growth point na geometria (`geometry.cobblemon.<berry>_growth`), `bone_visibility` pela idade, texturas `flowerTexture`/`fruitTexture` (todas as posições aparecem; rotação aproximada).
- 4. Estados `should_grow`/`stunted` no cluster: ⏭️ não feito: opcional; o registro por posição funciona e os estados dobrariam as permutações dos 18 clusters.
- 5. Nome da feature na descrição da muda (`cobblemon:saccharine_tree`): ✅ feito (integração).
