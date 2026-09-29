# Frente item-segurado: o item segurado fica só nos dados do Pokémon (sem "baú" montado)

Relato do cliente real (Windows, beta 7): "Ao subir no Charizard aperto E e abre tipo um baú pra guardar item; eu guardo
o item no Charizard. Se eu desço e subo e aperto E de novo, ele aparece lá. Mas se ele volta pra Pokébola e eu solto de
novo, abro o inventário dele e o item simplesmente some, e eu perco ele."

## Causa (medida no BDS)

- Toda entidade de Pokémon tinha `"minecraft:inventory": { container_type: "inventory", inventory_size: 1 }`
  (`tools/importer/entities.ts`, comentário "Slot 0 = item segurado"). O port usava esse espaço como segundo
  armazenamento do item segurado. `PokemonData.applyToCobblemon` gravava nele `minecraftItem` (ou o esvaziava), e isso
  roda a cada `tryUpdatePokemonOut`. `loadFromCobblemon` lia o espaço 0 por cima do JSON.
- Montado, o Bedrock trata o inventário da montaria como o do cavalo: a tecla E (pacote `interact`/`open_inventory`)
  abre esse espaço. O item posto ali não entrava nos dados (JSON `data` e time do jogador), e a próxima gravação do
  Pokémon o sobrescrevia. Também dava para pôr pilha de 64 e itens proibidos (shulker, bolsa).
- **Reprodução com o código do beta 7** (`tests/e2e/experimental/item-segurado.e2e.mjs`, BDS próprio na porta 19197):
  montado no Charizard, o `open_inventory` recebeu `container_open type=container` com o unique id do Charizard (duas
  vezes, `ent=-8589934586`). A sonda também mostrou o espaço 0 preenchido.

## Paridade com o Java

`PokemonEntity` (Cobblemon 1.8.2, `upstream/cobblemon/.../entity/pokemon/PokemonEntity.kt` l. 186) não implementa
`HasCustomInventoryScreen` nem `ContainerEntity` (no mod, só `CobblemonChestBoatEntity` implementa). Montado, o E abre o
inventário do jogador. O item segurado só muda pelos caminhos do mod: `offerHeldItem` (agachar + usar), o menu do
Pokémon, a batalha (berry consumida), a captura, os comandos.

## Correção

| Arquivo | O quê |
| --- | --- |
| `tools/importer/entities.ts` | Sem `minecraft:inventory` na entidade de Pokémon. O import regenera o base e o MSD: 0 entidades de Pokémon com inventário em `generated/behavior_packs/*/entities/pokemon`. Cavalo, mula, burro, vaso decorado, baús e máquinas continuam com o deles. |
| `scripts/pokemon/HeldItemStore.ts` (novo) | Helper único: `getHeldItemOnEntity`, `setHeldItemOnEntity` (lê e grava `minecraftItem`/`item` no JSON `data` da entidade; sem dados válidos devolve `false` e não grava nada), `giveHeldItemIfEmpty` e `forgetHeldItemCache`. O cache por entidade é invalidado pela própria string do JSON. |
| `scripts/Pokemon.ts` | `applyToCobblemon` não escreve mais no espaço 0 (o JSON já leva o item). `loadFromCobblemon` usa o item do JSON. |
| `scripts/events/ExchangeHeldItem.ts` | Agachar + usar lê e grava pelo helper. Grava antes de consumir o item do jogador (se falhar, o inventário do jogador não muda). Devolve uma pilha nova do item. Na troca com o inventário cheio, a sobra cai no chão (antes sumia). |
| `scripts/GUI/Party.ts` (`setHeldItem`) | Menu "Mudar item segurado" e `/cobblemon:helditem`: grava nos dados da entidade pelo helper. |
| `scripts/entity/HeldItemDisplay.ts` | Item mostrado no modelo: lido pelo helper. |
| `scripts/entity/index.ts` | Roda de interação ("Pokémon sem item") lê pelo helper; o cache é esquecido no `entityRemove`. |
| `scripts/spawning/Despawner.ts` | Selvagem com item segurado não some (lido pelo helper). |
| `scripts/catching/CaptureSequence.ts` | Item da boca na captura: `giveHeldItemIfEmpty` (só a chamada foi trocada). |
| `scripts/world/mundoDetalhesProbe.ts` | Sonda `md_pokemon`: `segurado` (dados), `espaço0` (inventário legado, ou `sem-inventario`) e itens soltos no chão. `md_spawn` grava o item pelo helper. |
| `scripts/entity/SpeciesBehaviours.ts` | Só comentário. |

Não mudaram: `scripts/commands.ts` l. 724 e 1214 (inventário do jogador), `scripts/controle` (`purgeContainer` genérico:
sem inventário no Pokémon, não faz nada), outras entidades com inventário.

## Migração (medida no BDS)

Mundo criado com os pacotes do beta 7. Dois selvagens: charmander com `diamond` nos dados e `emerald` posto direto no
espaço 0 (`replaceitem ... slot.inventory 0`, simula o E) e squirtle só com `gold_ingot` no espaço 0. Depois, deploy dos
pacotes novos no mesmo mundo:

- **O item segurado oficial continua**: charmander `segurado=minecraft:diamond`, agora também mostrado no modelo
  (`mão2=true`). Sem inventário (`espaço0=sem-inventario`).
- **O conteúdo do espaço 0 legado é apagado pelo motor, sem ir para o chão**: 0 itens soltos perto dali. Voltando os
  pacotes antigos no mesmo mundo, o espaço 0 dos dois veio `vazio`. O motor não guarda o conteúdo para depois.
- Consequência: um item que o jogador tenha posto pelo E e que ainda não tinha sumido **se perde na atualização**. No
  beta 7 ele já se perdia na próxima gravação do Pokémon (recolher/soltar, cura passiva, amizade, qualquer
  `tryUpdatePokemonOut`), então a janela é curta. Não dá para resgatar pelo script: a API não lê um componente que a
  definição não tem mais. Recomendação ao jogador: antes de atualizar, tire pelo E o que tiver posto no "baú" do
  Pokémon.
- Pokémon do time/PC: o item vive no JSON do time (`team`/PC), que já era a fonte ao soltar. Nada muda.

## Verificação

- `tests/item-segurado.test.ts` (novo): helper (ler, gravar, tirar, dados ausentes/ilegíveis/não-objeto, entidade que
  lança, cache sem dado velho), `giveHeldItemIfEmpty`, importador sem inventário (Pokémon comum e montável), `generated/`
  sem inventário e guarda estática contra `getItem(0)`/`getSlot(0)`/`setItem(0,` nos leitores do item segurado.
- `tests/batalhas.test.ts`: berry consumida some dos dados da entidade; o inventário da entidade nunca é usado, e um item
  deixado nele não é lido. `tests/spawn.test.ts`: o despawn usa o item dos dados; o inventário legado não conta.
- E2E `tests/e2e/experimental/item-segurado.e2e.mjs` (BDS 19197): dar agachado → nos dados, no modelo
  (`mob_equipment` da mão secundária) e −1 no inventário. Recolher e soltar → continua. Montado: E (`open_inventory`
  com alvo vazio, o jogador e a montaria) e usar na montaria → só `container_open type=inventory ent=-1` (o do jogador),
  nada do Pokémon. Tirar/dar pelo menu, trocar e tirar agachado → contagens exatas, sem item no chão.

## O que só o cliente real confirma

- A tecla E montado (Windows e toque) abre o inventário do jogador e não o "baú" do Pokémon. O bot manda o mesmo
  `interact/open_inventory` do cliente, mas a UI em si só aparece no cliente.
- O item segurado aparece no modelo depois de dar, recolher e soltar (o bot recebe o `mob_equipment`; o desenho é do
  cliente).
- Mundo do beta 7 com Pokémon soltos segurando itens: continuam segurando depois de atualizar os pacotes.

## Limitações conhecidas (não mudaram)

- O item segurado guarda só o id (`minecraftItem`), como já era: encantamentos, nome e lore da pilha não são guardados.
  Antes, a pilha do espaço 0 também era recriada só pelo id a cada gravação.
- `npm run test:e2e` fixa `COBBLEMON_BDS=e2e`/porta 19148 na linha do script, sobrescrevendo as variáveis passadas.
  Para BDS próprio, use `node tools/e2e/run.mjs` com as variáveis (foi o que esta frente fez).
