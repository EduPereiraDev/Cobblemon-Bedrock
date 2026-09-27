# Pendências da frente "give" (itens escritos à mão que o `/give` não reconhece)

Origem: `docs/pesquisa/8-limites-bedrock.md` (§6). No BDS, `/give` não reconhecia a `strange_ball` nem os itens-sonda
escritos à mão, mesmo com JSON idêntico ao de um item gerado que funciona.

BDS próprio: `COBBLEMON_DIST=dist-give COBBLEMON_BDS=give COBBLEMON_BDS_PORT=19153 COBBLEMON_BDS_TRANSPORT=raknet`
(BDS 1.26.52.3). O container foi removido (`docker rm -f cobblemon-bds-give`).

Arquivos da frente:
- `behavior_packs/CobblemonBedrock/items/pokeballs/strange_ball.json` (só o `menu_category`)
- `tools/importer/commandVisibility.ts` (novo)
- `tools/importer/validate.ts` (1 import e a seção 9b)
- `tests/give.test.ts` (novo)

## Causa raiz

Um **item** data-driven só entra no enum de itens dos comandos (`/give`, `/clear`, ...) se:
- estiver no `crafting_items_catalog` (`item_catalog/crafting_item_catalog.json`), **ou**
- tiver `description.menu_category.category` diferente de `"none"`;
- e, nos dois casos, não tiver `is_hidden_in_commands: true`.

Se nenhuma das duas condições vale (sem `menu_category` e fora do catálogo, ou `"none"`), o item **existe**
(`loot spawn` da tabela `pokeballs/strange_ball` derrubou 1 item), mas o comando responde
`Syntax error: Unexpected "<id>"` e o content log fica **vazio**. Em item, `category: "none"` com
`is_hidden_in_commands: false` **continua invisível**. Blocos seguem outra regra: sem `menu_category` ou com `"none"`
aparecem normalmente.

Os 580 itens gerados sem `menu_category` funcionam porque o importador põe todos no catálogo. Os itens escritos à mão
não entram no catálogo e não tinham `menu_category`. Por isso "JSON idêntico" falhava: o que faltava estava no catálogo,
não no arquivo.

**Descartado com prova:**
- **Build/merge (`deepMerge`, `stripJsonComments`):** sondas copiadas direto em `dist-give` (sem passar pelo build) falham
  igual.
- **Pasta ou nome do arquivo:** uma cópia da `poke_ball` com outro id falha em `items/cobblemon/`, `items/pokeballs/` e
  `items/`. Já o `npc_editor.json` renomeado para `zz_renamed_npc.json` continua funcionando.
- **Cache do mundo ou do pack:** o mundo foi criado do zero. Apagar `sweet_heart.json` tira o item do `/give` no boot
  seguinte.
- **`contents.json` (`{}`):** o mesmo arquivo vale para os 795 itens que funcionam.
- **Registro em outro lugar:** `cobblemon:npc_editor` só aparece no próprio arquivo e funciona.

## Experimentos no BDS (sonda = `poke_ball.json` com outro id, fora do catálogo salvo quando indicado)

| Caso | `give @a <id>` |
|---|---|
| item sem `menu_category` | Syntax error |
| item `category: "none"` | Syntax error |
| item `category: "none"`, `is_hidden_in_commands: false` | Syntax error |
| item `category: "items"` | aceito ("No targets matched selector") |
| item `category: "items"`, `is_hidden_in_commands: true` | Syntax error |
| item sem `menu_category`, **no catálogo** | aceito |
| `pokemon_model.json` (tem `category: "items"`) com o id trocado para `probe_changed_id` | aceito |
| bloco sem `menu_category` / `category: "none"` / `"construction"` | aceito / aceito / aceito |
| `strange_ball` com `category: "equipment"` + grupo `utility_item` (correção) | aceito |

Pelo console, sem jogador: "No targets matched selector" = o item foi reconhecido; `Syntax error: Unexpected` = não foi.

## Itens e blocos escritos à mão (o que o build copia de `behavior_packs/CobblemonBedrock`)

| Arquivo | Tipo | Antes | Depois |
|---|---|---|---|
| `items/pokeballs/strange_ball.json` | item novo | **FALHA** | OK |
| `items/apple.json` (`minecraft:apple`, `category: "nature"`) | override vanilla | OK | OK |
| `blocks/cobblemon/{campfire,soul_campfire,monitor,damaged_monitor,ring_target,eject_button,tm_machine,apricorn_button,apricorn_pressure_plate,saccharine_button,saccharine_pressure_plate,pasture}.json` | overlay de bloco gerado | OK (12) | OK (12) |
| gerado `items/adaptacoes/decorated_pot.json` (frente adaptacoes) | item novo | **FALHA** | **FALHA**: arquivo de outra frente, pedido em `adaptacoes.md` |

Varredura completa no BDS (todos os ids de `items/` e `blocks/` do `dist-give`):
- **Antes:** 800 ids, 795 aceitos. Falharam `strange_ball`, `decorated_pot` e as 3 sondas.
- **Depois:** build limpo, 797 ids, **796 aceitos**. Só `cobblemon:decorated_pot` falha.

Boot do build final sem nenhum ERROR/WARN de conteúdo, e o content log ficou vazio. Com `strange_ball` no grupo
`cobblemon:itemGroup.cobblemon.utility_item`, ela também aparece no inventário criativo, junto das outras bolas.

## Correção

- `strange_ball.json`: `menu_category: { category: "equipment", group: "cobblemon:itemGroup.cobblemon.utility_item" }`,
  a mesma categoria e o mesmo grupo das outras bolas no catálogo.
- `tools/importer/commandVisibility.ts`: a regra acima (`itemCommandProblem`) aplicada ao pack montado como o build monta:
  gerado + escrito à mão, com o mesmo `deepMerge`, catálogo incluído.
- `tools/importer/validate.ts` (9b): **erro** para todo item que o `/give` não aceitaria por acidente. Quem quiser esconder
  o item de propósito declara `is_hidden_in_commands: true`.
- `tests/give.test.ts`: cobre a tabela medida, a fusão (overlay que acrescenta `menu_category`, catálogo gerado e a
  `strange_ball` antiga, que é acusada) e os itens reais escritos à mão.

**Regra para itens novos escritos à mão:** dê um `menu_category` com categoria visível (`items`, `equipment`, `nature`,
`construction`) ou coloque o item no catálogo.

## Verificação

- `npm run validate`: **2 erros, nenhum desta frente**.
  1. `cobblemon:decorated_pot: /give não aceita o item`: é a nova checagem acusando o item da frente adaptacoes (pedido em
     `adaptacoes.md`).
  2. `render controller duplicado: controller.render.cobblemon_npc`: já existia. É o overlay da frente limites em
     `resource_packs/.../render_controllers/npc/`.
  A `strange_ball` não aparece mais.
- `npx tsc -p tsconfig.json`: 0 erros. O tsconfig não inclui `tests/` nem `tools/`; um type-check avulso e estrito de
  `tests/give.test.ts` e `tools/importer/commandVisibility.ts` também deu 0 erros.
- `npm test`: todos passam (`give: 6 casos medidos, 2 itens escritos à mão aceitos pelo /give`).

## Status

| Item | Status |
|---|---|
| Causa raiz de "itens à mão não reconhecidos pelo `/give`" | FEITO |
| `strange_ball` no `/give` | FEITO |
| Checagem para o futuro (validate + teste) | FEITO |
| `decorated_pot` no `/give` | Pedido à frente adaptacoes |
| Itens-sonda da frente limites | N/A. Eram temporários. Recriar com `menu_category` visível. |
