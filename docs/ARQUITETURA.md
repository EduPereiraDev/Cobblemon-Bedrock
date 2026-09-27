# Arquitetura do Cobblemon Bedrock

Port do mod Java **Cobblemon 1.8.2** (MC 1.21.1) para um add-on do **Minecraft Bedrock 26.x**.
Base de código: fork de [Incoherent-Code/Cobblemon-Bedrock](https://github.com/Incoherent-Code/Cobblemon-Bedrock) (MPL-2.0).

## Restrições de projeto

- **Só APIs estáveis**: `@minecraft/server` 2.10.0 e `@minecraft/server-ui` 2.2.0. Nada de Beta APIs
  ou toggles experimentais, para rodar em Realms e consoles.
- **Watchdog**: nenhum trabalho síncrono > ~100 ms por tick e nada perto de 3 s na inicialização.
  Dados grandes ficam como string JSON e são parseados sob demanda.
- **Assets do Cobblemon são CC BY-NC 3.0 + Fair Use Policy**: uso não comercial, com atribuição e sem sugerir afiliação. Publicação autorizada pela equipe do Cobblemon seguindo essa política (ver NOTICE.md)
  ou comercial. Por isso os assets convertidos **não são versionados** (`generated/` fica no
  `.gitignore`); cada máquina roda o importador a partir de `upstream/cobblemon`.

## Pastas

| Pasta | Conteúdo | Versionado |
|---|---|---|
| `upstream/cobblemon` | clone do código-fonte do Cobblemon (fonte dos assets e dados) | não |
| `tools/importer/` | importador Node/TS: `upstream/cobblemon` → `generated/` | sim |
| `generated/` | saída do importador (BP/RP de Pokémon, dados para scripts) | não |
| `behavior_packs/CobblemonBedrock`, `resource_packs/CobblemonBedrock` | conteúdo escrito à mão (itens, blocos, UI, player) | sim |
| `scripts/` | lógica do jogo em TypeScript (entrypoint `scripts/main.ts`) | sim |
| `dist/` | packs montados por `npm run build` | não |
| `.bds/` | servidor Bedrock local (Docker) usado nos testes | não |

`npm run build` junta `generated/` + pastas escritas à mão (as escritas à mão vencem em conflito)
e empacota os scripts com esbuild.

## Contrato entre importador e scripts

### Entidades de Pokémon

- Um tipo de entidade por espécie: `cobblemon:<speciesId>` (ex.: `cobblemon:pikachu`,
  `cobblemon:mrmime`). `speciesId` = nome do arquivo de espécie do Cobblemon sem extensão.
- Famílias: `pokemon`, `mob`, `cobblemon_<speciesId>` (usada pelo follow de herd); `pokemon_shoulder` só no ombro.
- Propriedades de entidade (BP, `client_sync: true`):
  - `cobblemon:variant` (int, 0..N-1): índice da combinação modelo+textura+camadas no render controller.
  - `cobblemon:in_battle`, `cobblemon:sleeping`, `cobblemon:wild`, `cobblemon:initialized`, `cobblemon:busy` (bool)
  - `cobblemon:alpha` (bool): Alfa (escala de `getAlphaScaleMultiplier`).
- Eventos: `cobblemon:set_wild`, `cobblemon:set_owned`, `cobblemon:instant_kill` (despawn imediato),
  `cobblemon:interacted`, `cobblemon:sleep` / `cobblemon:wake`, `cobblemon:set_alpha` / `cobblemon:unset_alpha`,
  `cobblemon:size_<n>` (tamanho por forma/Alfa), `cobblemon:shoulder_on` / `cobblemon:shoulder_off`,
  `cobblemon:ride_land|air|liquid`, `cobblemon:ride_air_tired`, `cobblemon:on_mount` / `cobblemon:on_dismount`,
  `cobblemon:ate_grass`.
- Grupos: `cobblemon:wild_ai`, `cobblemon:owned`, `cobblemon:owned_ai`, `cobblemon:idle_look`, `cobblemon:asleep`,
  `cobblemon:size_<n>`, `cobblemon:family_default|family_shoulder`, `cobblemon:rideable`, `cobblemon:move_ai`,
  `cobblemon:ride_*`, `cobblemon:gravity`, `cobblemon:instant_kill`. Não há `minecraft:despawn`: o despawn é o do
  Cobblemon por script (`scripts/spawning/Despawner.ts`).
- `minecraft:tameable` e `minecraft:inventory` (1 slot = item segurado) ficam na base.
- Regra do JSON: componente que muda por estado fica na base e em grupos sempre trocados no mesmo evento
  (`assertSwapInvariant` em `tests/entidades.test.ts`).
- Escala/hitbox: `minecraft:collision_box`/`minecraft:scale` por grupo `cobblemon:size_<n>` (forma ativa e Alfa);
  `PokemonData.applyToCobblemon` aplica o tamanho no mesmo tick (`applyEntitySize`).
- Movimento: derivado de `behaviour` (andar, nadar, voar) da espécie; IA de selvagem x com dono por grupo.
- Dados no script (dynamic properties): `data` (JSON do `PokemonData`), `uuid`, `cobblemon:spawn_time`,
  `cobblemon:spawn_bucket`, `cobblemon:herd_group`, `cobblemon:herd_leader` (+ tag `cobblemon_herd_leader`),
  `cobblemon:spawn_drops`, `cobblemon:persistent`, `cobblemon:size`. Tags: `cobblemon_alpha`, `fished`, `<uuid>`.

### Outras entidades

- `cobblemon:npc` (gerada por `tools/importer/npcs.ts`): propriedades `cobblemon:npc_skin`, `cobblemon:in_battle`,
  `cobblemon:invulnerable` (NPCClass.isInvulnerable; padrão false: o NPC leva dano, como no Cobblemon).
- Poké Balls (`entities/pokeballs/**`, projéteis e `_dummy`), boia (`cobblemon:poke_bobber`), e as entidades
  auxiliares das máquinas escritas à mão (`entities/machines/**`): `cobblemon:gilded_chest_storage` (inventário de
  27 espaços do baú dourado) e `cobblemon:display_case_item` (item exibido na vitrine, na mão principal).

### Blocos

- Propriedades do blockstate viram estados `cobblemon:<prop>`. O Bedrock aceita no máximo 16 valores por estado:
  enums de texto maiores são divididos em `<estado>`, `<estado>_2`, `<estado>_3`... (`"none"` = não usado); scripts
  gravam pelo mesmo esquema (`scripts/machines/common.ts` `setState`). Ex.: telas do monitor (`cobblemon:screen`).
- Comportamento que o Bedrock não tem vira custom component `cobblemon:<nome>`; os pendentes (sem script) ficam
  listados em `generated/scripts/blockBehaviours.ts`.
- Arbustos de berry: flores (idade 4) e frutos (idade 5) são bones da geometria nos `growthPoints` da berry.
- Bloco de habitat: estados `cobblemon:habitat_pool` + `cobblemon:habitat_pool_hi` (índice do pool em `HABITAT_POOLS`,
  0 = configurado por script em `MachineStore("habitat")`).
- Estruturas: `structures/cobblemon/*.mcstructure` gerados pelo importador (`structures.ts` para as features de molde,
  `jigsaw.ts` para as jigsaw montadas na conversão) com blocos Java → Bedrock de `tools/importer/data/java_bedrock_blocks.json`.
- Overrides de conteúdo vanilla: trocas em `behavior_packs/.../trading/economy_trades/` e loot tables com injeções do
  Cobblemon (importador, a partir de `tools/importer/data/vanilla_loot/`), cópias de bedrock-samples v1.26.50.4.

### Resource pack por espécie

- Client entity `cobblemon:<speciesId>` com todas as geometrias e texturas das variações.
- Render controller que escolhe geometria/textura por `q.property('cobblemon:variant')`.
  Camadas emissivas usam material emissivo.
- Animation controller gerado a partir do poser JSON do Cobblemon. Estados mínimos:
  standing, walking, sleep, battle-standing, float/swim, fly/hover quando existirem.
  Seleção por `q.property('cobblemon:in_battle')`, `q.property('cobblemon:sleeping')`,
  `q.is_in_water`, `q.is_on_ground`, `q.modified_move_speed`.
- Animações nomeadas acessíveis por script via `entity.playAnimation(...)`:
  `animation.<poserName>.cry`, `physical`, `special`, `status`, `recoil`, `faint` quando existirem.
- Sons: `cobblemon.pokemon.<speciesId>.cry` etc., conforme `sounds.json` do Cobblemon.

### Dados para scripts (`generated/scripts/`)

Módulos TypeScript gerados, importados pelos scripts:

- `species.ts`: `export const SPECIES: Record<string, string>` → JSON (string) da espécie do
  Cobblemon, só com os campos usados em jogo. Parse sob demanda em `scripts/speciesData.ts`.
- `variants.ts`: por espécie, lista ordenada de variações `{ aspects, model?, texture?, layers? }`
  (mesma semântica dos resolvers do Cobblemon) e a tabela combinação → índice de `cobblemon:variant`.
- `spawns.ts`: spawn pools do Cobblemon com tags de bioma resolvidas para IDs de bioma do Bedrock.
- `entityData.ts` (tamanhos, montaria, interações), `items.ts` (dados de cada item), `recipes.ts`, `dex.ts`
  (Pokédex exatas), `npcs.ts` (skins, classes, diálogos, scripts Molang), `machines.ts` (fósseis, temperos, TMs, tags de
  item), `biomeTags.ts`, `blockBehaviours.ts`, `habitats.ts` (habitat pools + alcance das âncoras das estruturas),
  `wallpapers.ts` (papéis de parede desbloqueáveis do PC).
- `lang`: `texts/en_US.lang` e `texts/pt_BR.lang` gerados a partir de `lang/*.json` do Cobblemon; as chaves do port
  (`cobblemon.port.*`) ficam em `resource_packs/CobblemonBedrock/texts/*.lang` (concatenadas no build).

## Batalhas

Motor: [`@pkmn/sim`](https://www.npmjs.com/package/@pkmn/sim) (Pokémon Showdown, MIT), empacotado
sem learnsets/legality (o Cobblemon traz os próprios learnsets): ~2,8 MB, batalha completa em ~40 ms
no Node. Substitui o submódulo `scripts/showdown` (40 MB), que estourava o watchdog na inicialização.

## Testes

- `npm run check`: type-check.
- `node tools/server.mjs deploy`: sobe o BDS no Docker com os packs; o log de conteúdo e erros de
  script aparecem em `node tools/server.mjs logs`. Critério de aceite de cada fase: zero erros
  de conteúdo/script no log do BDS.
