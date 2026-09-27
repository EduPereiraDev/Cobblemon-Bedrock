# Pendências da frente "mundo-máquinas"

Arquivos da frente: `scripts/custom_components/machines/index.ts` (`MACHINE_BLOCK_COMPONENTS`), `scripts/machines/**`,
`tests/maquinas.test.ts`. Um export novo em `tests/mocks/minecraft-server.ts` (`EntityComponentTypes`, usado pela
Pokédex que a frente importa).

`scripts/machines/data.ts` é gerado por `node --experimental-strip-types --no-warnings scripts/machines/gen-data.mjs`
a partir de `upstream/cobblemon` (fósseis, materiais orgânicos, temperos, TMs, tags de item resolvidas para ids Bedrock
e limiares de Aprijuice). O importador ainda não emite esses dados; se o dono do importador quiser assumir, basta gerar
o mesmo módulo em `generated/scripts/machines.ts` e trocar o import (o importador apaga `generated/` a cada execução,
por isso o arquivo ficou na frente).

## O que existe (paridade Cobblemon 1.8.2)

| Bloco / sistema | Arquivos | Paridade |
|---|---|---|
| **Pasto** (`cobblemon:pasture`, 2 partes) | `pasture.ts`, `pastureLogic.ts` | Coloca a metade de cima, dono do bloco, tela (ActionForm) com a lista, "Adicionar Pokémon" (time ou caixa do PC; do time vai antes para o PC, como no Cobblemon que só pasta do PC), recolher um / "Recall All" (só os próprios), limite `defaultPasturedPokemonLimit` (e por jogador = o mesmo, PasturePermissions padrão), desmaiado não entra, cap de Pokémon por perto (`pastureMaxPerChunk × (raio/16×2)²`), área de passeio `pastureMaxWanderDistance` (fora dela volta para trás do bloco), checagem a cada `pastureBlockUpdateTicks` (saiu do PC/foi solto → recolhe), `cobblemon:on` enquanto alguém está com a tela aberta. Quebrar solta todos. |
| **Fósseis** (`fossil_analyzer` + `monitor` em cima + `restoration_tank` ao lado) | `fossils.ts`, `fossilLogic.ts` | Estrutura forma ao colocar/usar qualquer parte (FossilMultiblockBuilder), combinações de `data/cobblemon/fossils` (Fossil.matchesIngredients), até `maxInsertedFossilItems`+1 itens (o 1.8.2 compara com `>`), mão vazia devolve o último, material orgânico de `natural_materials` (itens e tags, item devolvido, até 128), liga sozinha com 128 + combinação válida, 12 min (14 400 ticks), 8 estágios na tela do monitor (`blue_progress_1..9`, `green_progress_9` na proteção), `cobblemon:on` no analisador/tanque, proteção de 5 min para quem inseriu, retirada com Poké Ball (a bola vira a do Pokémon, nível 1, shiny pela taxa global ou 1/`fossilMachineShinyChance`, Alfa 1/`fossilMachineAlphaChance`, vai para time/PC e Pokédex). Quebrar: devolve fósseis (se não começou ou faltam ≥ 20 ticks) e solta o Pokémon pronto como selvagem. Pausa com o chunk descarregado. |
| **Monitor sozinho** | `fossils.ts` | TM/disco de música (tela `music`, `tm_bug`, `tm_dark`; destrava o TM para quem mexe), Upgrade/Dubious Disc → processo do Porygon (90 ticks): Upgrade vira `damaged_monitor` e solta Porygon 20 (20% Porygon2 25); Dubious Disc explode (1–3 ferros, 1–2 corações de dano em raio 3) e 50% Porygon-Z 35; shiny 1/`monitorShinyRate`, Alfa 1/`monitorAlphaRate`. |
| **Máquina de TMs** | `tm.ts` | TMs disponíveis = "default" + aprendidos (golpes acessíveis dos Pokémon do time e TMs lidos no monitor; `cobblemon:tms` no jogador, aviso `cobblemon.tms.unlock_tm`), filtros por texto, tipo e "o time aprende", receita de `data/cobblemon/tms` (até 3 ingredientes + Blank TM, itens ou tags), 114 ticks (queima 100 + grava no 110), `cobblemon:active/empty/dispensed`, agachar abre/fecha a tampa (`cobblemon:open`), TM pronto sai no próximo clique. Lore do TM no formato de `scripts/items/tm.ts`. |
| **Panela na fogueira** (`cobblemon:campfire`/`soul_campfire`) | `cooking.ts`, `cookingLogic.ts` | Panela usada numa fogueira vanilla acesa vira a fogueira do Cobblemon (mesma direção); tela com grade 3×3, 3 temperos, resultado e tampa; agachar (ou botão) retira a panela e volta a fogueira vanilla. Receitas de `COOKING_POT_RECIPES` (com forma: recorte + espelho; sem forma: casamento 1-para-1 com tags), 100 ticks por prato com a tampa fechada, resultado empilha só se igual, consome 1 de cada espaço e os temperos que algum processador consome, restos (balde, garrafa) caem ao lado. Processadores: `ingredient`, `food_colour`, `spawn_bait`, `food` (FoodUtils.merge), `mob_effects` (MobEffectUtils.merge), `ride_boosts` (limiares de sabor + apricorn). |
| **Pratos temperados** | `cooking.ts` | Temperos na lore (`cobblemon.port.cooking.seasoned_with` [nome, id]); ao comer: efeitos de poção (chá sinistro) e `foodData.add` (ponigiri). Se a frente itens achar `cobblemon:food_data` no item, ela cuida. |
| **Poké Snack temperado** | `pokeSnack.ts` | O bloco é da frente pesca. Ao colocar um Poké Snack cozido, os ids de isca dos temperos (BaitSeasoningProcessor: `spawn_bait_effects` do item + `seasonings:<path>`) vão para `setPokeSnackBaits`; os efeitos (bite_time, rarity_bucket, grupo de ovo, tipo, EV, shiny...) passam a valer nos spawns do bloco. |
| **Poções do Cobblemon** | `cooking.ts` | Usar um ingrediente/frasco do Cobblemon num suporte de poções vanilla abre a tela própria: receitas possíveis com o inventário, 1 ingrediente + até 3 frascos, 1 pó de blaze = 20 usos, 400 ticks; o resultado sai no próximo clique (ou cai ao quebrar o suporte). |
| **Vitrine** (`display_case`) | `decor.ts` | updateItem exato (colocar, retirar, trocar, criativo). Visual depende da entidade pedida abaixo. |
| **Estante de discos** (`disc_shelf`) | `decor.ts` | 14 espaços (2×7) pelo ponto clicado na face, itens válidos (TM, Blank TM, Upgrade, Dubious Disc, discos), troca/retira. |
| **Atril** (`lectern`) | `decor.ts` | Agachar + Pokédex num atril vanilla vira o atril do Cobblemon; usar abre a Pokédex (`openPokedex`), agachar devolve a Pokédex e volta o atril vanilla. |
| **Baús dourados** / **Gimmighoul chest** | `decor.ts` | Gimmighoul chest: abrir ou quebrar revela um Gimmighoul nível 5–30 e começa a batalha (`startWildBattle`, fora do criativo). Baús: armazenamento pela entidade pedida abaixo (colocada no `onPlace`, conteúdo cai ao quebrar). |
| **Panela solta** (`campfire_pot_*`) | `cooking.ts` | Decorativa como no Java: usar abre/fecha a tampa (`cobblemon:open`). |

## Ligação no `main.ts` (dono: orquestrador)

Os componentes de bloco entram sozinhos pelo registro (`MACHINE_BLOCK_COMPONENTS`). Falta ligar o agendador e os eventos
de mundo (ticks de fósseis/panelas/TM/poções, checagem dos pastos, fogueira/atril/suporte vanilla, Poké Snack
temperado, entidades de pasto recarregadas, comer prato temperado):

```ts
import { startMachines } from "./machines";
// dentro de world.afterEvents.worldLoad.subscribe(...), junto de startSpawner():
startMachines();
```

## Pedidos

### 1. Textos do port (dono de `resource_packs/CobblemonBedrock/texts/*.lang` / importador)

`en_US.lang`
```
cobblemon.port.pasture.add=Add Pokémon
cobblemon.port.pasture.empty=No Pokémon in this pasture.
cobblemon.port.pasture.full=This pasture is full.
cobblemon.port.pasture.choose=Choose a Pokémon
cobblemon.port.pasture.owner=Owner: %1$s
cobblemon.port.pasture.none_available=No Pokémon available to pasture here.
cobblemon.port.pasture.fainted=Fainted Pokémon can't be pastured.
cobblemon.port.fossil.status=%1$s — fossils: %2$s, organic material: %3$s, progress: %4$s
cobblemon.port.fossil.no_structure=Build the machine: a Fossil Analyzer with a Monitor on top and a Restoration Tank beside it.
cobblemon.port.fossil.need_ball=The Pokémon is ready! Use a Poké Ball on the machine.
cobblemon.port.fossil.unknown=No valid fossil
cobblemon.port.cooking.slot=Ingredient slot %1$s
cobblemon.port.cooking.seasoning_slot=Seasoning slot %1$s
cobblemon.port.cooking.result=Result
cobblemon.port.cooking.lid_open=Open the lid
cobblemon.port.cooking.lid_close=Close the lid (cook)
cobblemon.port.cooking.progress=Cooking: %1$s
cobblemon.port.cooking.no_recipe=No recipe matches.
cobblemon.port.cooking.hint=Tap an empty slot to add an item from your inventory, a filled slot to take it back. Close the lid to cook.
cobblemon.port.cooking.remove_pot=Take the pot
cobblemon.port.cooking.seasoned_with=§7+ %1$s
cobblemon.port.brewing.title=Cobblemon Brewing
cobblemon.port.brewing.none=You have no Cobblemon brewing ingredient and bottle.
cobblemon.port.brewing.fuel=Fuel: %1$s (blaze powder)
cobblemon.port.brewing.brewing=Brewing: %1$s
cobblemon.port.tm_machine.choose_move=Choose a TM to print
cobblemon.port.tm_machine.missing=Missing materials for %1$s: %2$s
cobblemon.port.tm_machine.busy=Printing %1$s: %2$s
cobblemon.port.tm_machine.search=Search / filter
cobblemon.port.tm_machine.filter_party=Only moves my party can learn
cobblemon.port.tm_machine.type=Type
cobblemon.port.tm_machine.none=No TMs available.
cobblemon.port.tm.move=§7%1$s
cobblemon.port.gilded_chest.no_storage=This chest has no storage yet (content pending).
cobblemon.port.display_case.empty=Use an item on the display case to show it.
```

`pt_BR.lang`
```
cobblemon.port.pasture.add=Adicionar Pokémon
cobblemon.port.pasture.empty=Nenhum Pokémon neste pasto.
cobblemon.port.pasture.full=Este pasto está cheio.
cobblemon.port.pasture.choose=Escolha um Pokémon
cobblemon.port.pasture.owner=Dono: %1$s
cobblemon.port.pasture.none_available=Nenhum Pokémon disponível para este pasto.
cobblemon.port.pasture.fainted=Pokémon desmaiado não pode ir para o pasto.
cobblemon.port.fossil.status=%1$s — fósseis: %2$s, material orgânico: %3$s, progresso: %4$s
cobblemon.port.fossil.no_structure=Monte a máquina: um Analisador de Fósseis com um Monitor em cima e um Tanque de Restauração ao lado.
cobblemon.port.fossil.need_ball=O Pokémon está pronto! Use uma Poké Ball na máquina.
cobblemon.port.fossil.unknown=Nenhum fóssil válido
cobblemon.port.cooking.slot=Espaço de ingrediente %1$s
cobblemon.port.cooking.seasoning_slot=Espaço de tempero %1$s
cobblemon.port.cooking.result=Resultado
cobblemon.port.cooking.lid_open=Abrir a tampa
cobblemon.port.cooking.lid_close=Fechar a tampa (cozinhar)
cobblemon.port.cooking.progress=Cozinhando: %1$s
cobblemon.port.cooking.no_recipe=Nenhuma receita corresponde.
cobblemon.port.cooking.hint=Toque num espaço vazio para pôr um item do inventário e num cheio para pegá-lo de volta. Feche a tampa para cozinhar.
cobblemon.port.cooking.remove_pot=Retirar a panela
cobblemon.port.cooking.seasoned_with=§7+ %1$s
cobblemon.port.brewing.title=Poções do Cobblemon
cobblemon.port.brewing.none=Você não tem ingrediente e frasco de poção do Cobblemon.
cobblemon.port.brewing.fuel=Combustível: %1$s (pó de blaze)
cobblemon.port.brewing.brewing=Preparando: %1$s
cobblemon.port.tm_machine.choose_move=Escolha um TM para gravar
cobblemon.port.tm_machine.missing=Faltam materiais para %1$s: %2$s
cobblemon.port.tm_machine.busy=Gravando %1$s: %2$s
cobblemon.port.tm_machine.search=Buscar / filtrar
cobblemon.port.tm_machine.filter_party=Só golpes que meu time aprende
cobblemon.port.tm_machine.type=Tipo
cobblemon.port.tm_machine.none=Nenhum TM disponível.
cobblemon.port.tm.move=§7%1$s
cobblemon.port.gilded_chest.no_storage=Este baú ainda não tem armazenamento (conteúdo pendente).
cobblemon.port.display_case.empty=Use um item na vitrine para exibi-lo.
```

(`cobblemon.port.tm.move` também foi pedida pela frente itens; é a mesma linha.) Chaves do Cobblemon reaproveitadas:
`cobblemon.ui.pasture`, `cobblemon.ui.pasture.recall_all`, `cobblemon.pasture.too_many_nearby`,
`cobblemon.fossilmachine.protected`, `cobblemon.container.campfire_pot`, `cobblemon.container.tm_machine`,
`cobblemon.tms.unlock_tm`, `cobblemon.tms.new_tms_learned`, `cobblemon.type.*`, `cobblemon.move.*`, `cobblemon.species.*`.

### 2. Conteúdo (dono de `behavior_packs/`/`resource_packs/` escritos à mão)

1. **Armazenamento do baú dourado**: entidade `cobblemon:gilded_chest_storage` (o script a coloca no centro do bloco ao
   colocar o baú e solta o conteúdo ao quebrar). BP:
   ```json
   { "format_version": "1.21.90", "minecraft:entity": {
     "description": { "identifier": "cobblemon:gilded_chest_storage", "is_spawnable": false, "is_summonable": true },
     "components": {
       "minecraft:type_family": { "family": ["cobblemon_storage", "inanimate"] },
       "minecraft:collision_box": { "width": 0.95, "height": 0.9 },
       "minecraft:inventory": { "container_type": "minecart_chest", "inventory_size": 27 },
       "minecraft:physics": { "has_gravity": false, "has_collision": false },
       "minecraft:pushable": { "is_pushable": false, "is_pushable_by_piston": false },
       "minecraft:damage_sensor": { "triggers": [{ "cause": "all", "deals_damage": "no" }] },
       "minecraft:health": { "value": 1, "max": 1 },
       "minecraft:knockback_resistance": { "value": 1 },
       "minecraft:persistent": {}
     } } }
   ```
   RP: client entity com geometria vazia (sem cubos) e `"materials": { "default": "entity_alphatest" }`. Conferir no
   jogo que o clique na caixa de colisão abre o inventário (é o truque usual de "baú por entidade"; se não abrir, trocar
   `container_type` para `"container"`).
2. **Item da vitrine**: entidade `cobblemon:display_case_item` invisível, sem colisão/IA/gravidade, que renderiza o item
   da mão principal (geometria com o osso/locator `rightitem`, como o armor stand; escala ~0,5). O script põe o item com
   `replaceitem entity @s slot.weapon.mainhand 0 <item>` e a remove quando a vitrine esvazia/quebra.

### 3. Importador

1. **Sons de bloco**: importar `fossil_machine.*`, `campfire_pot.*`, `tm_machine.*`, `pc.on`, `monitor.*` de
   `assets/cobblemon/sounds.json` como `cobblemon.<evento>` (mesma regra dos sons `pokemon.*`). Hoje
   `scripts/machines/common.ts` (`SOUNDS`) usa sons vanilla parecidos; troco os ids quando existirem.
2. **Telas do monitor**: `cobblemon:screen` foi truncado em 16 valores (limite de enum do Bedrock); faltam `tm_<tipo>`
   para 16 tipos. Sugestão: um 2º estado `cobblemon:tm_screen` (`none`, `normal`, `fire`, ...). Até lá, TM de outro tipo
   deixa a tela apagada.
3. **Habitat block** (`cobblemon:habitat_block`): não recebeu componente — o mapa de classes em `tools/importer/blocks.ts`
   usa a chave `entry` em vez de `HabitatBlock`. Mesmo corrigido, o bloco (ferramenta de criativo do 1.8.2 com
   `habitat_pools`, fases e tela de configuração) precisa dos 51 pools emitidos para scripts; fica para uma próxima onda.

### 4. Interface (`scripts/GUI/PC.ts`, opcional)

`isPastured(uuid)` / `pasturedIds()` (`scripts/machines/pasture.ts`) para marcar no PC os Pokémon que estão num pasto
(no Cobblemon o PC mostra o ícone de pasto). Mexer neles no PC funciona: tirar do PC recolhe a entidade na próxima
checagem.

## API para outras frentes

```ts
import { isPastured, getTMMove, createTMStack, learnTMs, getLearnedTMs, seasonedDataFromLore, seasoningIdsFromLore,
  baitIdsForSeasonings, baitIdsFromLore } from "../machines";
```

## Aproximações

- **Sem GUI de contêiner**: cozinha, pasto, TM e poções usam formulários (server-ui). Na panela, tocar num espaço vazio
  lista as pilhas do inventário; a pilha inteira vai para o espaço (junta com a mesma).
- **Itens guardados** (panela, vitrine, estante, monitor, atril) preservam id, quantidade, lore e nome; encantamentos e
  outros componentes se perdem (por isso só aceitam os itens que usam).
- **Pasto**: a entidade usa o `wild_ai` (passeio) com `cobblemon:wild = false`, `cobblemon:persistent` e sem
  `owner_name`; a área é garantida por teleporte a cada checagem (não por pathfinding). Se sumir com o dono offline,
  volta de um instantâneo salvo. Sem o `beamMode`/partícula de shiny da soltura.
- **Máquina de fósseis**: hopper/redstone (tanque recebendo material por funil, soltar selvagem por redstone) e o
  inventário do tanque não foram portados.
- **TM**: aprendizado de TMs só pelo time (o Cobblemon também varre o PC em lotes) e pelo monitor; sem automação por
  redstone nem "repeat".
- **Fogueira com panela**: o bloco do Bedrock é só a fogueira (a panela e o caldo colorido eram desenhados por block
  entity renderer); a panela fica guardada no registro. Sem partículas de caldo nem som ambiente; não queima quem pisa.
- **Poções**: tela própria em vez do suporte vanilla (o suporte do Bedrock só aceita receitas de poção vanilla).
- **Dubious Disc**: sem a propagação de sculk.
- **Sons**: vanilla até o pedido 3.1.

## Não possível (API estável)

- Block entity com inventário/renderização própria (baú, vitrine, estante, panela): dependem das entidades do pedido 2
  para visual/armazenamento.
- Mudar a receita do suporte de poções vanilla com itens de add-on.
- Saber se um atril vanilla tem livro (por isso a conversão para o atril da Pokédex exige agachar).

## Status da integração

- Ligação no `main.ts` (`startMachines()` no `worldLoad`): ✅ feito (integração).
- 1. Textos do port (pasto, fósseis, panela, poções, TM, baú, vitrine): ✅ feito (integração) (com `pasture.recall`, `pasture.no_space`, `brewing.done`, `tm_machine.need_blank`, `tm_machine.craft` também presentes).
- 2.1 Entidade `cobblemon:gilded_chest_storage` (BP + client entity vazia): ✅ feito (integração) — `entities/machines/gilded_chest_storage.json`; conferir no jogo se o clique abre o inventário (senão trocar `container_type`).
- 2.2 Entidade `cobblemon:display_case_item` (item na mão principal, escala 0,5, osso `rightItem`): ✅ feito (integração) — precisa de conferência visual no jogo.
- 3.1 Sons de bloco (`fossil_machine.*`, `campfire_pot.*`, `tm_machine.*`, `display_case.*`, `monitor.*`, `pc.on`): ✅ feito (integração) — `SOUNDS` em `scripts/machines/common.ts`.
- 3.2 Telas `tm_<tipo>` do monitor: ✅ feito (integração) — o importador divide enums > 16 valores em `cobblemon:screen`, `cobblemon:screen_2`, `cobblemon:screen_3`; `setState` grava no estado certo.
- 3.3 Habitat block: mapeamento da classe corrigido (✅ feito (integração): o parser aceita `entry = HabitatBlock(...)`); comportamento ⏭️ não feito: ferramenta de criativo com `habitat_pools`, fases e tela própria (fica pendente em `blockBehaviours.ts`).
- 4. PC marca Pokémon no pasto (`⌂`): ✅ feito (integração).
- Dados das máquinas gerados pelo importador (`tools/importer/machinesData.mjs` → `generated/scripts/machines.ts`; `scripts/machines/data.ts` só reexporta): ✅ feito (integração).
