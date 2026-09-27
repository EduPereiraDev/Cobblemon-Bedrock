# Frente "mundo-final"

Arquivos da frente: `tools/importer/**` (única frente que roda `npm run import`), `scripts/spawning/**`,
`scripts/custom_components/**` (inclui `machines/`, `plants/`), `scripts/machines/**`,
`behavior_packs/CobblemonBedrock/trading/**` (novo) e `tests/mundo-final.test.ts`.

Verificação (2026-09-25): `npm run import` (OK, 12–18 s) → `npm run validate` **OK, nenhum erro**;
`npx tsc -p tsconfig.json` **0 erros**; `npm test` **16/16 arquivos passam** (inclui `tests/mundo-final.test.ts`).
Sem build nem BDS (regras da onda): **nada foi conferido no jogo**.

## Situação por item

| # | Item | Situação | Notas / evidência |
|---|---|---|---|
| 1 | Habitats (`habitat_pools`, 51) + `habitat_block` | FEITO | Importador: `tools/importer/habitats.ts` → `generated/scripts/habitats.ts` (`HABITAT_POOLS`: 51 pools, 1990 spawns; 11 descartadas por espécie não importada; `modifiers` → aspects, `phases` → faixas, `timeRange`/`maxLight`). Bloco: custom component `cobblemon:habitat_block` registrado (`scripts/custom_components/machines/index.ts`) e anexado pelo importador, `minecraft:tick` 10 ticks, estados `cobblemon:habitat_pool` (0–15) + `cobblemon:habitat_pool_hi` (0–3) = índice do pool (1..51) para blocos postos por estrutura. Lógica (`scripts/spawning/Habitats.ts`, port de `HabitatBlockEntity` + `HabitatBlockDetector` + estilos): **natural** — raio `rangeOfInfluence` (distância² da posição ao bloco, como `ConditionalSpawningZoneInfluence`), `injectSpawns` das spawns do pool no bucket sorteado (fase atual, tipo de posição), `replaceSpawns` = só as do bloco (`affectSpawnable`), afeta o spawner do mundo/Poké Snack se há spawns fora de pesca e a pesca se há spawns `fishing` (`getInfluentialRange`); **ativado** — spawner de área fixa (`Spawner.runHabitatSpawner`: zona de raio `spawnRange`, cap max(pokemonPerChunk, 16), buckets `activatedHabitatBuckets`, só spawns do bloco), gatilho REDSTONE (borda de subida do maior `getRedstonePower()` entre o bloco e os 6 vizinhos — ≈ `getDirectSignalTo` —, lido a cada 2 ticks por um laço global), TICK, `chance`, `maxSpawns` (ids vivos, limpos a cada 20 ticks), `maxSpawnsPerActivation`, `modifiers` do bloco (PokemonProperties) e `cancelledNaturalSpawningRange` (nenhum outro spawner no raio). Fases `SIMPLE`/`FIXED_RANDOM`/`FULL_RANDOM` por dia (24000 ticks), `getPhaseCount`, nível do bloco intersecta a faixa de cada spawn. Detector: registro em memória (tick do bloco + configurações salvas, relidas na 1ª detecção), raio max(128, 2 × zona), bloco trocado sai do registro. Configuração salva em `MachineStore("habitat")` (dynamic property do mundo). Editor em criativo (operador): `ModalFormData` com os campos do `HabitatEditGUI` (`scripts/machines/habitat.ts`), textos `cobblemon.ui.edit.habitat.*` do Cobblemon. Quebra fora do criativo dropa o bloco imitado. Integração: `trySpawnNear` (mundo), `trySpawnFromBait` (Poké Snack), `chooseFishingSpawn` (pesca). Fila global: no máximo **uma ativação por tick** (cada uma varre a zona do bloco), com aviso de ativação lenta (> 20 ms). RANDOM_TICK fica inerte, como no 1.8.2 (o `HabitatBlock` não recebe random ticks). Quebra: `onBreak` + `onPlayerBreak` da mesma quebra decidem o drop uma vez (criativo em qualquer um = sem drop). **Desvios**: TICK entra na fila a cada 10 ticks (não todo tick, watchdog); pulsos de redstone menores que 2 ticks podem passar; o editor não edita a lista de spawns de um pool "custom" (só escolhe entre os 51 pools de dados); `checkspawn` não mostra as spawns de habitat; o `Random(seed)` do Kotlin virou um gerador próprio (as fases FIXED/FULL_RANDOM são determinísticas, mas não as mesmas do Java). |
| 2 | `hasSpace` pela largura do hitbox | FEITO | `AreaSpawnablePosition.hasSpace(width, height)` exato (`hasSpaceBox`: x/z `[floor(p+0,5−(w−1)/2)−1, ceil(p+0,5+(w+1)/2)+1)`, y `p+1..ceil(p+(h+1)/2)+1`; `isSafeSpace` por tipo: não sólido em grounded/surface, mesmo fluido em submerged, água em seafloor), para entradas e membros de herd com largura ou altura > 1 (`PokemonSpawnDetail.width/height = ceil(hitbox × baseScale)`). Fora da zona conta como pedra (`SpawningZone.getBlockState`), então caixas que cruzam a borda falham como no Kotlin. Barato: cache de blocos da zona (reaproveita as colunas já lidas), coluna própria primeiro, resultado memorizado por tamanho, orçamento de 1200 leituras novas por passe (`SPAWN_TUNING.hasSpaceReadBudget`; acabou = só a coluna, como antes). |
| 3 | Trocas com aldeões (`CobblemonTradeOffers`) | FEITO (pescador) / NÃO POSSÍVEL (enfermeira) | `behavior_packs/CobblemonBedrock/trading/economy_trades/fisherman_trades.json` = cópia **literal** da tabela vanilla de `Mojang/bedrock-samples` tag `v1.26.50.4` + um grupo no tier Mestre com o `pokerod_smithing_template` (12 esmeraldas, 3 usos, 30 xp, `price_multiplier` 0,05). Desvio: no Java o mestre sorteia 2 de 3 ofertas; aqui o molde vem num grupo próprio (sempre oferecido) para não mexer nas vanilla. **Enfermeira (NURSE)**: profissão nova com POI do Healing Machine — NÃO POSSÍVEL NO BEDROCK sem API: profissões e locais de trabalho são fixos no motor; exigiria sobrescrever `villager_v2` inteiro (grupo de profissão + evento) e mesmo assim o motor não atribui um bloco custom como local de trabalho. |
| 4 | Vendedor ambulante | FEITO | `trading/economy_trades/wandering_trader_trades.json` = cópia literal v1.26.50.4 + as 5 ofertas comuns de `resolveWanderingTradeOffers` (vivichoke_seeds 6→1 ×1, saccharine_sapling 5→1 ×4, hearty_grains 1→1 ×12, chipped_pot 5→1 ×1, masterpiece_teacup 5→1 ×1) no grupo de vendas (escolhe 5). |
| 5 | Injeções de loot (`LootInjector`) | FEITO | `tools/importer/lootInjection.ts`: as 18 tabelas de `loot_table/injection/**` convertidas para `loot_tables/cobblemon/injection/**` e as 23 tabelas vanilla correspondentes **sobrescritas** com a cópia vanilla (`tools/importer/data/vanilla_loot/`, bedrock-samples v1.26.50.4) + o pool extra do Java (1 roll com a tabela aninhada): mineshaft, ancient city, 4 bastions, end city, igloo, jungle temple, nether bridge, pillager outpost, shipwreck supply (`shipwrecksupply`), masmorra (`simple_dungeon` e `monster_room`), bonus chest, stronghold corridor, mansion, 5 casas de vila (`village_house`) e tesouro de pesca. TMs com golpe (`set_components` `cobblemon:tm_move`) viram `set_lore` com o nome do golpe (lido por `parseTMMove`). Desvio: bônus de sorte (bonus_rolls 0..1) não existe no Bedrock. |
| 6a | Estruturas de molde único (43 features `cobblemon:structure`) | FEITO | `tools/importer/structures.ts`: 207 moldes → `structures/cobblemon/<cat>_<nome>.mcstructure` + `structure_template_feature` (rotação aleatória) + feature rules com os biomas de `CobblemonPlacedFeatures.kt` e a colocação do placed_feature (count, rarity, heightmap/height_range, random_offset): **23 sítios de fósseis**, 17 habitats de molde, 3 ruínas. Blocos Java → Bedrock por `tools/importer/data/java_bedrock_blocks.json` (2381 estados, subconjunto de PrismarineJS/minecraft-data `blocksJ2B` 1.26.30, MIT; gerado por `tools/importer/data/buildBlockMap.ts`), Cobblemon por `BlockBuilder.bedrockStateFor`, `waterlogged` na 2ª camada. Processadores rule/capped aplicados na conversão (semente fixa) → areia/cascalho suspeitos com `BrushableBlock` + `LootTable` das tabelas de fósseis convertidas (131 loot tables de estrutura). O molde `habitats/ancient_wellspring` citado pela feature não existe no Cobblemon (no Java a feature também falha). |
| 6b | Estruturas jigsaw (67) | FEITO (62) / NÃO POSSÍVEL (3 enseadas) / N/A (2) | `tools/importer/jigsaw.ts`: o `JigsawPlacement` do Java roda **na conversão** (peça inicial, `canAttach`, pools com fallback, prioridades, `size`, `max_distance_from_center`, espaço interno do pai) com 2 sementes → 124 `.mcstructure` montados (≤ 64×64). Processadores e `final_state` rodam no espaço do molde e a rotação da peça vem depois (como `placeInWorld`). Colocação: chance por chunk = peso/Σ pesos com bioma em comum/spacing² dos structure_sets × fração não vazia do start_pool; y = `q.heightmap` (ou `q.above_top_solid` no fundo do mar) − 1 + `start_height`. 32 habitats (inclui os monumentos "reclaimed"), 27 ruínas (torres Gimmighoul, henges, criptas...), 3 barcos de pesca. Tags `c:is_snowy_plains` mapeadas. **Enseadas de naufrágio** (69×81 a 117×192 blocos): NÃO POSSÍVEL como feature do Bedrock (só escreve perto do chunk de origem). `crumbling_arch_ruins`/`rooted_arch_ruins` têm start_pool vazio (N/A: o Cobblemon as gera pelas features, já convertidas em 6a). |
| 6c | Blocos de habitat nas estruturas | FEITO (aproximado) | No Java o bloco de habitat é invisível e imita outro (MimicId). Aqui cada molde/montagem vira o bloco imitado + **uma âncora** (o bloco de habitat mais enterrado) com o pool no estado e `tick_queue_data` para o 1º tick; o alcance da âncora cobre todos os blocos de habitat do molde (`HABITAT_ANCHOR_RANGES`). Configuração das estruturas do Cobblemon: natural, `replaceSpawns`, `FULL_RANDOM`. A âncora aparece com a textura do bloco de habitat. |
| 7 | Frutos/flores das berries (rotação) | FEITO | `BlockBuilder.addBerryGrowthBones`: a hierarquia do `.geo` do fruto/flor é copiada sob um bone por growth point com rotação `[-x, -y, z]` (derivada do `setRotation(180 − x, 180 + y, z)` do `BerryBlockRenderer` com o Y invertido do `TexturedModel` e o X espelhado do bloco do Bedrock); rotações de bones/cubos do modelo preservadas; idade 0 mostra o fruto em `stageOnePositioning` (`renderBabyToBuffer`). Aproximação que continua: todos os growth points aparecem. |
| 8 | Outras lacunas do importador em PARIDADE-ITENS-BLOCOS | FEITO | Estruturas e habitat (acima); FALTA restante na tabela: nenhum. `countOf` aceita `rolls` `{min,max}` sem `type`; loot tables aninhadas (`loot_table`) convertidas. |

## Pedidos atendidos de outras frentes

- **extras-final**: texturas `textures/gui/pc/wallpaper/**` copiadas (51 PNG com `basic/`, `biome/`, `misc/`, `alt/`, `glow/`) e
  `generated/scripts/wallpapers.ts` (`UNLOCKABLE_WALLPAPERS`, 6, `displayName` = `cobblemon.port.wallpaper.<id>`);
  fósseis: `recordResurrection` ao retirar o Pokémon revivido.
- **jogabilidade-final**: `spawnGivenMarks(alpha, data.getSizeCategory())` no spawn (Mini/Jumbo); `applyFossilMarks(data, true)`
  ao retirar do tanque e `applyFossilMarks(data, false)` ao soltar como selvagem; propriedade `cobblemon:scale_modifier`
  (float 0,05–3, `client_sync`) em toda entidade de Pokémon e `scripts.scale = q.property('cobblemon:scale_modifier')` no client
  entity; partículas `evo_*` (12) e `poodle_hair_*` (10) copiadas para `particles/cobblemon/` com as texturas (o Cobblemon cita
  `textures/particles/...` e guarda em `textures/particle/...`). Os ids ficam `cobblemon:evo_*` / `cobblemon:poodle_hair_*`
  para a frente trocar em `EVOLUTION_PARTICLES`/`trimParticles`.

## Pedidos para outras frentes

### main.ts (opcional)

Nada obrigatório: o componente do habitat é registrado pelo `registerCustomComponents` já chamado, e o spawner carrega as
configurações salvas na 1ª detecção. Para a lista de papéis de parede vir do importador (extras-final):
```ts
import { UNLOCKABLE_WALLPAPERS } from "../generated/scripts/wallpapers";
import { setUnlockableWallpapers } from "./GUI/PCWallpapers";
setUnlockableWallpapers(UNLOCKABLE_WALLPAPERS);
```

### Evolução / entidades (opcional)

Trocar as partículas vanilla pelas do Cobblemon: `cobblemon:evo_particles` (emissor com eventos para as demais) etc. em
`scripts/evolution/EvolutionEffect.ts` e `cobblemon:poodle_hair_<cor>` em `scripts/entity/Interactions.ts`.

## Conferência no jogo / riscos

- **Overrides vanilla** (trocas e 23 loot tables): congelam a versão 1.26.50.4; outro add-on que sobrescreva os mesmos
  arquivos ganha ou perde pela ordem dos packs. Atualizar: baixar as tabelas da tag nova do bedrock-samples para
  `tools/importer/data/vanilla_loot/` (loot) e reaplicar o grupo do Cobblemon nos dois arquivos de `trading/`.
- **Estruturas**: `structure_template_feature` com `grounded` (superfície) ou `block_intersection` (enterradas/subterrâneas);
  sem terrain adaptation (beard/bury), sem o processador `gravity` (peças seguem o relevo no Java), sem `cobblemon:height_range`
  (validade acima do nível do mar) e sem exclusion zones dos structure_sets. Conferir se montagens de até 64 blocos saem
  inteiras, a altura (`q.heightmap − 1 + start_height`) e o `BrushableBlock`/`LootTable` da areia suspeita.
- **Âncoras de habitat nas estruturas**: o 1º tick vem do `tick_queue_data` do `.mcstructure` (como nas árvores de
  apricorn do pack); se o motor não agendar esse tick para blocos postos por feature, a âncora entra no registro no
  primeiro random tick (`onRandomTick` → `touchHabitat`, alguns minutos) — conferir no jogo.
- **Variações jigsaw**: o deslocamento vertical de cada variação é um `scatter_feature` com `y` relativo (mesmo uso das
  features de plantas do pack); conferir a altura das peças no jogo.
- **Baús dourados** das ruínas: o baú do port guarda o inventário numa entidade criada ao colocar; o loot
  `ruins/gilded_chests/*` (convertido) não é ligado aos baús postos pela estrutura.
- **Vilas do Cobblemon** (`structure/villages`, peças injetadas nas vilas vanilla por jigsaw): NÃO POSSÍVEL NO BEDROCK (as vilas
  vanilla não são jigsaw data-driven).
- **Escala visual por Pokémon**: `scripts.scale` do client entity multiplica a do `minecraft:scale` do grupo de tamanho;
  conferir que Alfas/formas continuam no tamanho certo.
