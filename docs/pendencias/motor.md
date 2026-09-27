# Pendências da frente "motor"

Pesquisa: `docs/pesquisa/3-motor.md`. BDS próprio: `COBBLEMON_DIST=dist-motor COBBLEMON_BDS=motor COBBLEMON_BDS_PORT=19144`.

Arquivos da frente: `tools/importer/{blocks,structures,jigsaw}.ts` (e o trecho BP de `entities.ts`: propriedade
`cobblemon:roll`), `scripts/world/**` (novo), `scripts/entity/{Riding,Shoulder}.ts`, a parte de contêiner de
`scripts/machines/{decor,itemUtil}.ts`, `behavior_packs/CobblemonBedrock/entities/{world/*,machines/gilded_chest_storage.json,machines/display_case_item.json}`,
`behavior_packs/CobblemonBedrock/cameras/presets/*`, `resource_packs/CobblemonBedrock/entity/world/*`,
3 eventos novos em `resource_packs/CobblemonBedrock/sounds/sound_definitions.json`, `tests/motor.test.ts`.
Exports novos no mock (`tests/mocks/minecraft-server.ts`): `InputPermissionCategory`, `StructureRotation`.

## Status por item

| Prio | Item | Status | Prova |
|---|---|---|---|
| P0 | Waterlogging (`minecraft:liquid_detection`) nas 23 classes do Cobblemon + lajes/escadas/cercas/muros/alçapões/folhas | **FEITO** | `blocks.ts` (`waterloggableClasses` lê o Kotlin: SimpleWaterloggedBlock/WATERLOGGED + herança). BDS: `setWaterlogged(true)` → `isWaterlogged=true` em gilded_chest, pc, apricorn_slab, ring_target; display_case (não alaga no Java) → `canContainLiquid=false`. Estruturas: a camada 2 do `.mcstructure` já recebia a água de `waterlogged=true` e agora o bloco aceita. |
| P0 | Contêiner real do baú dourado (UI de baú, funil, NBT) + correção do clique | **FEITO** (clique: conferir no jogo) | Entidade `cobblemon:gilded_chest_storage`: `container_type: container`, 27, `can_be_siphoned_from`, caixa 1,02 × 1,02 (maior que o bloco, recebe o clique). Quebrar: o golpe acerta a entidade → 4 golpes (criativo 1) quebram o bloco (`setblock … destroy`) e soltam o conteúdo (`scripts/world/Containers.ts` + `decor.ts`). Sons `block.gilded_chest.open/close/hit/break`. BDS: round-trip com espada (sharpness 5, dano 123, nome, lore, dynamic property) preservado; funil embaixo puxou 5 pedregulhos. |
| P0 | Vitrine com ItemStack real | **FEITO** | Inventário de 1 espaço na própria `cobblemon:display_case_item`; aceita qualquer item (acabou a recusa de itens "ricos"); dados antigos (MachineStore) migram no 1º uso/quebra. Exibição: `equippable` quando existir, senão `replaceitem` (só o id — o brilho de encantamento não aparece no modelo). BDS: round-trip preservado. |
| P0 | Estante de discos com ItemStack real | **FEITO** | Entidade `cobblemon:machine_storage` (27, sem UI, sem funil); 14 espaços; TMs/discos preservam lore/NBT; migração do MachineStore. BDS: round-trip preservado. |
| P0 | Panela (cooking pot) em entidade | **N/A (não muda paridade)** | A panela é da frente mundo-sons; os ingredientes são itens simples e `isPlainStack` já os aceita. Se quiserem, `ensureStorage(dim, loc, MACHINE_STORAGE)` + `containerOf` servem igual. |
| P0 | Música de batalha | **FEITO** (áudio: conferir no jogo) | Eventos `cobblemon.battle.pvw/pvp/pvn.default` (categoria music, vazios como no 1.8.2) no RP. `scripts/world/BattleMusic.ts`: `startBattleMusic(player, kind)` / `stopBattleMusic(player)` (`playMusic` em laço com fade / `stopMusic`) e um ticker (10 ticks) que detecta início/fim pela `in_battle` do jogador e o tipo por `isPvP/isPvN/isPvW` — funciona sem mexer na batalha. Desligado por padrão (Java só pausa a música quando o pack preenche o evento): `/scriptevent cobblemon:battle_music on`. |
| P0 | Dano corpo a corpo por Pokémon | **FEITO** | `scripts/world/PokemonDamage.ts` (`beforeEvents.entityHurt`, T17): atacante Pokémon → dano × `attackToDamageCurve(Ataque atual)` / dano fixo da espécie (mantém a escala de dificuldade); Pokémon atingido → armadura/tenacidade da Defesa (`defenceToArmourCurve` + `CombatRules.getDamageAfterAbsorb`); `playerDamagePokemon=false` cancela dano de jogador. Testes das fórmulas com os exemplos do Kotlin (Rhydon 176 → 10). |
| P1 | Estruturas jigsaw → jigsaw data-driven do Bedrock | **FEITO** | `jigsaw.ts` reescrito: 65 estruturas (`worldgen/structures`), ~214 pools, 9 structure sets, 1 179 peças `.mcstructure` com os blocos jigsaw (T5) e `location` = caminho em `structures/` (T3). Enseadas incluídas. Ids sem "/". Ajustes exigidos pelo BDS 1.26.52 (vistos no log): `spread_type` "triangular" (não "triangle"), `separation < spacing/2` (100/50 → 100/49), pools só com elemento vazio (`cobblemon:dead_coral`) derrubavam o servidor → viram `minecraft:empty`. BDS: `/locate structure cobblemon:ruins_temperate_gimmi_tower` (-1206, 154), `cobblemon:shipwreck_coves_lush_shipwreck_cove` (370, -5962), `cobblemon:habitats_berry_patch`, `cobblemon:fishing_boat_beach`; `placeJigsawStructure("cobblemon:ruins_temperate_gimmi_tower")` montou a torre (blocos conferidos). As 2 arcadas com `start_pool minecraft:empty` ficam de fora (como no Java, nunca geram). |
| P1 | Registro de estruturas (marcador por peça) | **FEITO** | Cada peça leva `cobblemon:structure_marker` (tags `cobblemon:st=<índices>`, `cobblemon:sr=<raio>`). `scripts/world/StructureRegistry.ts`: `entityLoad`/`entitySpawn` → chunks do raio registrados por região (world dynamic property) → marcador removido. BDS: após `placeJigsawStructure` da torre, `getStructuresAt(26,70,26)` → ids das torres Gimmighoul (peças compartilhadas entre as 5 torres devolvem as 5 — `#cobblemon:ruin` casa igual; limitação aceita). Estruturas geradas antes desta versão não têm marcador. |
| P1 | Detector de vilas + consulta preguiçosa | **FEITO** | `scripts/world/Villages.ts`: `entitySpawn` com causa `Event` de aldeão/golem/gato → sino num raio de 48 → caixa (sinos+camas+blocos de trabalho) + 16 registrada como `minecraft:village`; chunk sem registro → `containsBlock(bell)` na 1ª consulta, cache de 10 min. BDS (mundo novo): `/locate structure village` → (-520, -344); ticking area lá → `getStructuresAt(-520,70,-344)` = `["minecraft:village"]`, regiões gravadas em `cobblemon:st:overworld:*`. |
| P1 | Pokécenter em vila nova | **FEITO (opcional, padrão ligado)** | Moldes `village/<bioma>_pokecenter.mcstructure` (5 biomas). Em vila recém-gerada: anel de 18–40 blocos do sino, terreno plano (±1), superfície natural, sem blocos de vila/toras/tábuas no volume; entrada virada para o sino; uma vez por vila; `runJob`. Desliga com `/scriptevent cobblemon:village_pokecenters off`. BDS: a vila gerada acima recebeu o Pokécenter (3 `cobblemon:healing_machine` em (-500, 60, -339), sino em (-523, 66, -355); marca `cobblemon:pc_village:…` gravada). Visual/encaixe na rua: conferir no jogo. |
| P2 | Câmera de montaria (follow_orbit/fixed_boom) | **FEITO** (conferir no jogo) | Presets `cobblemon:ride_orbit` (herda `minecraft:follow_orbit`, raio 7) e `cobblemon:ride_boom` (`minecraft:fixed_boom`) em `BP/cameras/presets` (carregam sem erro no BDS). `Riding.ts`: órbita no ar/água; preferência por jogador `/scriptevent cobblemon:ride_camera auto|always|boom|off`; `camera.clear()` ao desmontar. |
| P2 | Controles da montaria | **FEITO** (conferir no jogo) | Ar/água: `InputPermissionCategory.Dismount` desligada (agachar não desmonta), agachar segurado desce (impulso), agachar 2× rápido desmonta (via `Shoulder.onSneakPressed`); pulo segurado sobe (já era do componente). Permissão devolvida ao desmontar/trocar para terra. Sprint: a API estável não expõe o botão — **NÃO POSSÍVEL** (só `isSprinting`, não testado montado). |
| P2 | Roll visual | **FEITO no BP/script**; RP pedido abaixo | Propriedade `cobblemon:roll` (float ±90,5, client_sync) nas 43 espécies montáveis que voam; `Riding.ts` calcula pela variação de yaw (suavizado, ±45°). Roll da câmera: **NÃO POSSÍVEL** (a API só tem yaw/pitch). |
| — | Conquistas por jogador | N/A (frente ui-base) | — |
| — | Pedido D (jogabilidade): consulta de estrutura para spawn/evolução | **FEITO** | `startWorld()` registra `setSpawnStructureLookup`/`setEvolutionStructureLookup` com `structureQuery` (true/false para estruturas detectáveis; undefined para vanilla sem detector: monumento, iglu, cabana, end city). |
| — | Pedido G (jogabilidade): `minimumRidingScale` | **FEITO** | `canRidePokemon`: `data.getEffectiveScale() < getConfig().minimumRidingScale` → não monta. |

## Pedidos a outras frentes

### 1. Orquestrador — ligar `startWorld()` no `scripts/main.ts`

```ts
import { startWorld } from "./world";
// dentro de world.afterEvents.worldLoad.subscribe(...), depois de startEntityBehaviours():
startWorld();
```
Sem isso ficam parados: registro de estruturas (marcadores não são processados), detector de vilas/Pokécenter,
dano por Pokémon, música de batalha e o `/scriptevent cobblemon:ride_camera`. O baú dourado (golpes/sons) e a
vitrine/estante funcionam mesmo sem a ligação (entram pelo `decor.ts`).

### 2 e 3. jogabilidade — condição `structures` do spawn e requisito `structure` da evolução

Resolvido sem editar os arquivos da frente: os ganchos `setSpawnStructureLookup` (`scripts/spawning/SpawnConditions.ts`)
e `setEvolutionStructureLookup` (`scripts/evolution/requirements/ExtraRequirements.ts`) são registrados por
`startWorld()` (pedido 1). API exposta em `scripts/world/StructureRegistry.ts`:
`isInStructure(dimension, location, idOuTag)`, `getStructuresAt(dimension, location)`, `structureQuery(dimension, location, lista)`.

### 4. Batalha (dono de `scripts/battle/*`) — ganchos diretos da música (opcional)

O ticker já cobre início/fim; para trocar sem a latência de até 0,5 s:
```ts
import { battleMusicKind, startBattleMusic, stopBattleMusic } from "../world/BattleMusic";
// ao iniciar a batalha (PokemonBattle, depois de marcar in_battle nos jogadores):
for (const p of this.players) { const k = battleMusicKind(this); if (k) startBattleMusic(p, k); }
// ao terminar (end/flee/forfeit), para cada jogador participante:
stopBattleMusic(player);
```

### 5. animacao — roll visual no RP

As entidades montáveis que voam declaram `cobblemon:roll` (graus, ±45 na prática, `client_sync`). No render/animação
da montaria: `rotation: [0, 0, "q.property('cobblemon:roll')"]` no bone raiz (ou somar ao roll do poser) só quando
`q.has_rider`. Sem isso o valor é enviado e ignorado.

### 6. Orquestrador/importador (arquivos compartilhados) — achados

- `npm run validate`: no fim da sessão, 0 erros de bloco; restam 2 de outra frente (`cobblemon:npc`: texturas
  `textures/entity/steve|alex` inexistentes). Os "~57 blocos duplicados com identifier undefined" não aparecem na
  execução atual (a única mudança da frente em blocos é o `minecraft:liquid_detection` dentro de `emit()`).
- BDS: `cobblemon:npc` — `'cobblemon:npc_render_scale': 'default' value does not match the specified type 'float'`
  (frente social/ia-npc; mesmo truque do `"1.0"` em string resolve).
- `tests/mundo-final.test.ts` §7b testava a saída antiga (features `jigsaw_*`); troquei só essas asserções pelas do
  jigsaw data-driven. A mesma suíte falha mais adiante em `partículas poodle_hair_*` (frente jogabilidade/animacao).

## Verificação (fim da sessão)

- `npx tsc -p tsconfig.json`: 0 erros. `npm test`: todas as suítes passam (`motor: 12 testes ok`).
- `npm run import`: 65 estruturas jigsaw data-driven, 1 179 peças, 214 pools, 9 structure sets, 5 Pokécenters.
- BDS `motor` (mundo novo, `dist-motor`): nenhum ERROR/WARN de conteúdo ou script da frente (só o `cobblemon:npc` de
  outra frente e os avisos de transporte do BDS). Checagens: waterlogging, round-trip dos 3 contêineres com
  encantamento/durabilidade/nome/lore/dynamic property, funil puxando do baú dourado, `placeJigsawStructure` da torre,
  `/locate` das estruturas, registro por marcador, vila detectada + Pokécenter colocado, dano do Rhydon escalado pelo
  Ataque (2 → 1,14 num Rhydon de nível baixo).
- Quedas do BDS durante os testes: eram **OOM** (`OOMKilled=true`; a VM do Docker tem 7,6 GB e havia 3–4 servidores
  de outras frentes). Um "free(): invalid next size" apareceu uma vez ao reabrir o mundo sob a mesma pressão de
  memória e não se repetiu com mundo novo; o único defeito real de conteúdo achado (pool só com elemento vazio) foi corrigido.

## O que conferir no jogo (sem cliente no BDS)

- Clique no baú dourado abre a UI (caixa 1,02) e 4 golpes quebram; a vitrine mostra o item (sem brilho de encantamento).
- `rotation` dos jigsaws verticais: usei a ordem 2D do Bedrock (sul 0, oeste 1, norte 2, leste 3). Só afeta joints
  "aligned" verticais (221 de 3 695); se as peças empilhadas saírem giradas 90°, trocar `TOP_ROTATION` em `jigsaw.ts`.
- Presets de câmera (`follow_orbit` montado), descer com agachar, desmontar com 2× agachar, roll no RP.
- Música: com um pack que preencha `cobblemon.battle.*.default` e `/scriptevent cobblemon:battle_music on`.
- Peças compartilhadas entre estruturas (ex.: torres Gimmighoul) registram todas as estruturas que podem usá-las —
  as tags (`#cobblemon:ruin`) casam igual; um id específico pode dar falso positivo entre torres irmãs.
