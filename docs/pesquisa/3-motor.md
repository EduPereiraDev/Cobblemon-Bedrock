# Pesquisa 3 — Motor (estruturas, blocos, contêineres, música, câmera/montaria, worldgen)

> Status: **concluída (v1)**. Data: 2026-09-26. Documento incremental: novas rodadas entram no fim.
> Restrições: Script API estável `@minecraft/server` **2.10.0**, **sem toggles experimentais**, Realms + consoles.
> Ambiente de teste: BDS **1.26.52.3** descartável (`bds-pesquisa`, UDP 19140, mundo novo **sem experimentos**,
> seed 12345). Protótipos (pack de teste, geradores de `.mcstructure`) ficaram em
> `$SCRATCH/pesquisa-motor/` (fora do repo). Nenhum arquivo do projeto foi alterado além deste documento.
> Limite dos testes: BDS sem cliente conectado → tudo que é **renderização/áudio/câmera/entrada** do cliente está
> marcado como "precisa de teste no jogo".

## Resumo executivo

| # | Tema | Hoje no port | Veredito (estável + Realms + consoles) | Ganho |
|---|---|---|---|---|
| 1 | Estruturas como condição de spawn/evolução | "NÃO POSSÍVEL" (entrada descartada) | **SIM** para estruturas nossas (marcador no molde → registro por chunk, testado) e **SIM (heurística)** para vilas (sino/camas, testado: ≤3 ms); outras vanilla = heurística fraca | 852 condições; 199 de vila + 60 anticondições + 19 evoluções da Vivillon |
| 2 | Waterlogging de blocos custom | "NÃO POSSÍVEL" | **SIM** — `minecraft:liquid_detection` estável (format ≥ 1.21.60), testado | 23 classes de bloco do Cobblemon + lajes/escadas/cercas |
| 3 | NPC com skin de jogador | "NÃO POSSÍVEL" | **NÃO** (confirmado). Melhor aproximação: humanoide com skin de um conjunto (Steve/Alex/skins do Cobblemon) | — |
| 4 | Contêineres reais (baú dourado, vitrine, estante, panela) | entidade auxiliar (parcial) | **SIM** via entidade invisível com `minecraft:inventory` (UI de baú, funil, NBT preservado — testado) | fim do `SlotItem` com perda de encantamento |
| 5 | Música de batalha | "NÃO POSSÍVEL" | **SIM** — `player.playMusic/queueMusic/stopMusic` estáveis; o 1.8.2 define 3 eventos vazios (`battle.pv{w,p,n}.default`) para resource packs | paridade exata do `BattleMusicController` |
| 6 | Advancements | "NÃO POSSÍVEL" | **NÃO** nativo. Rastrear os 61 advancements não-receita por script (lista de gatilhos abaixo) + 743 de receita → `unlock` das receitas Bedrock | — |
| 7 | Câmera/entrada na montaria | parcial | **SIM** parcial: presets `follow_orbit`/`fixed_boom` estáveis, `setFov`, `attachToEntity`, `inputPermissions` (desligar Dismount), `playerButtonInput`. **Roll de câmera: NÃO**; roll visual do modelo: SIM (propriedade `client_sync` + animação) | sprint/boost/descida |
| 8 | Enseadas de naufrágio (> 64 blocos) | "NÃO POSSÍVEL" | **SIM** — jigsaw data-driven é **estável desde 1.21.120**; peças > 64 funcionam (testado 117×192) | 3 estruturas + 125+70 spawns |
| 9 | Injeção em vilas vanilla | "NÃO POSSÍVEL" | **NÃO** nos pools (vilas vanilla = jigsaw legado). **ARRISCADO/SIM** por script: detectar vila recém-gerada (spawn com causa `Event`, testado) e colocar o Pokécenter com `placeJigsawStructure` | Pokécenter/fazendas de berry |
| 9b | Jigsaw data-driven no lugar das montagens pré-prontas | montagem na conversão (`jigsaw.ts`) | **SIM, recomendado** (testado sem experimentos, com `/locate`) | aleatoriedade real, `/locate`, estruturas grandes |
| 10 | Outros de ALVOS (scanner com zoom, dano por Pokémon, tamanho individual) | parcial/"NÃO POSSÍVEL" | zoom: **SIM** (`camera.setFov`); dano por Pokémon: **SIM** (`beforeEvents.entityHurt.damage` gravável, T17); altura dos olhos: **NÃO** | — |

**Correções ao que está documentado hoje no repo:**
- `tools/importer/jigsaw.ts` diz "O Bedrock estável não tem jigsaw data-driven para add-ons". **Desatualizado**: desde a
  1.21.120 ("Jigsaw structures can now be customized without using any experiments", histórico da
  [Minecraft Wiki](https://minecraft.wiki/w/Jigsaw_structure)); o teste T2 confirma no BDS 1.26.52 em mundo sem experimentos.
  `StructureManager.placeJigsaw/placeJigsawStructure` estão no estável desde a 1.21.80 ([changelog 1.21.80](https://minecraft.wiki/w/Bedrock_Edition_1.21.80)).
  A nota do Microsoft Learn "only Trail Ruins can be modified" é sobre **sobrescrever estruturas vanilla**, não sobre as nossas.
- `ALVOS.md`/`PARIDADE-*`: "Waterlogging NÃO POSSÍVEL", "Música de batalha NÃO POSSÍVEL", "enseadas NÃO POSSÍVEL",
  "Estruturas como condição NÃO POSSÍVEL" e "zoom do scanner NÃO POSSÍVEL" devem mudar para FALTA/PARCIAL-VIÁVEL.

## 0. Achados de base (API)

- `@minecraft/server` no npm (2026-09-26): `latest` = **2.10.0**, `rc` = 2.11.0-rc.1.26.60-preview.28,
  `beta` = 2.11.0-beta.1.26.52-stable / 2.12.0-beta.1.26.60-preview.28 (diff feito com os `.d.ts` dos três pacotes).
- **2.11 (RC, vira estável na 1.26.60)**: `SoundInstance.fade/pause/resume/seekTo/setPitch/setVolume`,
  `PlayerSoundOptions.loopCount`, `WorldSoundOptions.loopCount/isBroadcast`, `Dimension.spawnXp`,
  `EntityIsTamedComponent.tamedToPlayer(Id)`. Útil para música/sons em laço por jogador (item 5).
- **2.12 beta (exige "Beta APIs" = proibido para nós)**: `Dimension.getGeneratedStructures(location)` (a solução
  "oficial" do item 1, ainda beta), `Dimension.poiManager` (POIs de vila, experimento `Poi`),
  `Block.scheduleNamedTick`, `BlockEntityStorageComponent`, `BlockRecipeCraftingComponent`,
  `EntityNpcComponent.skinIndex`, `Camera.setCameraWithEase`, `Player.stopSound/stopAllSounds`.
  → Planejar para trocar a heurística do item 1 por `getGeneratedStructures` quando ele sair do beta.
- Já estável em 2.10 e pouco usado no port: `world.afterEvents.entityContainerOpened/Closed` e
  `blockContainerOpened/Closed`, `EntityInventoryComponent.canBeSiphonedFrom`, `Camera.attachToEntity`,
  `Camera.setFov`, `Player.inputInfo` (`getMovementVector`, `getButtonState(Jump|Sneak)`),
  `world.afterEvents.playerButtonInput`, `Player.inputPermissions` (categoria `Dismount`),
  `Player.setControlScheme`, `Player.playMusic/queueMusic/stopMusic`, `StructureManager.placeJigsaw*`,
  `Dimension.getBlocks/containsBlock` com `BlockVolume`, `world.beforeEvents.entityHurt` (dano gravável),
  `Player.setPropertyOverrideForEntity`.

## Log de testes no BDS (2026-09-26, BDS 1.26.52.3, mundo SEM experimentos)

| # | Teste | Resultado |
|---|---|---|
| T1 | `dimension.runCommand("locate structure village")` | `CommandResult` só tem `successCount` (1 = achou, 0 = não existe). **Sem coordenadas.** Ids com `/` são rejeitados pelo parser do `/locate` (`Syntax error: Unexpected "/"`). Console do BDS mostra `The nearest minecraft:village is at block -488, (y?), 248`, mas isso não chega ao script. |
| T2 | Jigsaw data-driven próprio (`worldgen/structures`, `template_pools`, `structure_sets`, format 1.21.130/1.26.50) | **Carrega e gera sem toggle.** `/locate structure pm:marker_struct` → `The nearest pm:marker_struct is at block 16, (y?), 17`. |
| T3 | `location` do elemento de pool | É **caminho relativo a `structures/`** (`"pm/marker_piece"` ou `"pm:pm/marker_piece"`). `"pm:marker_piece"` (id do .mcstructure) gera caixa vazia **sem erro no log**. |
| T4 | Moldes `.nbt` (formato Java) no pack do add-on | **Não funcionam** (nem o `.nbt` vanilla copiado para o pack). Só o pack vanilla usa `.nbt` (a 1.26.50 traz `abandoned_camp` assim, com nomes de bloco Java). Um pool do add-on **pode** referenciar um `.nbt` vanilla (a tenda do `abandoned_camp` foi colocada pelo nosso pool). Para o add-on: `.mcstructure`. |
| T5 | Bloco jigsaw dentro de `.mcstructure` | Estados `facing_direction` (0–5) + `rotation` (0–3); block entity `{id:"JigsawBlock", name, target, target_pool, final_state, joint, placement_priority, selection_priority}`. Duas peças conectaram e `final_state` foi aplicado (glowstone/sea lantern). |
| T6 | `structureManager.placeJigsawStructure` | Devolve a caixa na hora (5–720 ms de script), mas **os blocos entram ~20–60 s depois** (assíncrono) e só em chunks carregados (a parte fora de chunk carregado não aparece). |
| T7 | Bloco marcador custom com `minecraft:tick` dentro de peça jigsaw **gerada pelo worldgen** | `onTick` dispara (com e sem `tick_queue_data` no molde); `onPlace` **não** dispara no worldgen, mas dispara em `structureManager.place`/`placeJigsawStructure`. Peças giradas aleatoriamente (as posições dos marcadores trocam). |
| T8 | Entidade dentro do `.mcstructure` (NBT mínimo: `identifier`, `definitions`, `Pos`, `Rotation`, `Motion`, `UniqueID`, `Persistent`, `Tags`) | Nasce com o worldgen/`place`; dispara **`entityLoad`** (não `entitySpawn`) com as tags preservadas; volta a disparar a cada recarga do chunk. |
| T9 | `minecraft:liquid_detection` (format 1.21.130) `can_contain_liquid: true` | `canContainLiquid(Water)=true`, `setWaterlogged(true)` funciona e persiste (igual à laje vanilla). Sem o componente: `Block type cannot be waterlogged`. |
| T10 | Entidade com `minecraft:inventory` + `can_be_siphoned_from: true` sobre funil | Funil **puxa** os itens (espada encantada + pedregulho). Sem a flag o funil não puxa. |
| T11 | `Container.setItem/getItem` na entidade | Round-trip preserva encantamento (`sharpness 5`), durabilidade (`damage 123`), nome, lore e dynamic property. |
| T12 | `world.playMusic("record.cat",{loop,volume,fade})`, `stopMusic`, `dimension.playSound` → `SoundInstance{id, soundEventId}` | Sem erro em 2.10 (o áudio em si precisa de cliente). |
| T13 | Vila real (−488, 248): `getBlocks(BlockVolume 97×65×97, includeTypes:[bell, camas, blocos de trabalho])` | 611 k blocos em **3 ms** → `bell:1, bed:14, composter:3, smoker:1`; `containsBlock(bell)` **1 ms**; 7 aldeões no raio. Fora da vila (48 blocos ao lado): 0 sinos, 2 camas. **Chunk não carregado → resultado vazio sem erro.** |
| T14 | Vila recém-gerada (5624, 6120) | Aldeões, golem de ferro e gatos nascem com `entitySpawn.cause = "Event"`; os já existentes disparam `entityLoad`. Gatilho barato de "vila nova aqui". |
| T15 | `structureManager.place` de `.mcstructure` 117×4×192 (22 k blocos não-ar) | Funciona (> 64 blocos) em **378 ms síncronos** com tudo carregado; parte em chunk descarregado é perdida. Peça jigsaw única de 117×192 também funciona (caixa 117×192). |
| T17 | `world.beforeEvents.entityHurt` com `e.damage *= 3` (porco, `applyDamage(2)`) | `beforeHurt 2` → `afterHurt 6`, vida 10 → 4. **Dano gravável confirmado.** |
| T16 | `structure_template_feature` via `dimension.placeFeature` | Inconclusivo: as features do pack de teste não entraram no registro (`cannot be found in the registry`) nem a pequena; não investigado (o jigsaw data-driven torna isso irrelevante). |

---

## 1. Estruturas como condição de spawn e requisito de evolução

**Semântica do Cobblemon 1.8.2** (conferida no código): spawn usa `structureManager.startsForStructure(ChunkPos)`
(`api/spawning/position/SpawnablePosition.kt:114`) e evolução usa `level.getChunk(pos).allReferences`
(`pokemon/requirements/StructureRequirement.kt`). Ou seja: **granularidade de chunk** — "este chunk é referenciado
pela caixa da estrutura". Não precisamos de precisão de bloco.

**O que as condições pedem** (tally de `data/cobblemon/spawn_pool_world`, 852 ocorrências):
`#minecraft:village` 199 (+60 anti), enseadas do Cobblemon 125+70+7 (+64+11 anti), `#cobblemon:ruin`/`ruins/*` 47,
`#aether:dungeons` 29 e `#the_bumblezone:*` 182 anti (mods — tratar como "nunca presente"), `minecraft:swamp_hut` 8,
`minecraft:monument` 6 (+26 anti), `#minecraft:shipwreck` 6, `minecraft:igloo` 4, `minecraft:desert_well` 2.
Evolução: só a Vivillon (19 requisitos, todos `#minecraft:village`). **Ancient city não aparece.**

**Opções avaliadas**
- `Dimension.getGeneratedStructures` — exatamente o que precisamos, mas **beta** (2.12). Não usar ainda.
- `/locate structure` por `runCommand` — só `successCount`; sem coordenadas (T1). **Inútil** para "estou dentro?".
- Marcadores nas **nossas** estruturas — **SIM** (T7/T8).
- Heurística de blocos para **vilas** — **SIM** (T13/T14), barato.

**Receita — estruturas do Cobblemon (convertidas por nós)**
1. Bloco `cobblemon:structure_marker` (sem geometria/`minecraft:geometry` invisível, sem colisão/seleção,
   `minecraft:tick {interval_range:[1,1], looping:false}`, custom component `cobblemon:structure_marker`,
   estado `cobblemon:structure` inteiro = índice na tabela gerada de ids de estrutura; estado `cobblemon:final`
   = índice do bloco final (ar/água/structure_void conforme o que o marcador substituiu)).
2. Importador injeta **um marcador por peça** (num bloco de ar/água interno do molde), e grava no
   `generated/scripts/structures.ts` o tamanho máximo da peça por índice.
3. `onTick` do componente: registra os chunks cobertos pela caixa `marcador ± max(sizeX,sizeZ)` (conservador,
   porque a rotação da peça é desconhecida), troca o marcador pelo bloco final. Idempotente.
4. Registro persistente: `world.setDynamicProperty("cobblemon:st:<dim>:<rx>:<rz>", json)` por região de 32×32 chunks
   (`chunkKey → [índices]`). Cache em memória por sessão.
5. `SpawnConditions.ts:181` e `ExtraRequirements.ts:66`: `structures.some(id => registry.has(dim, cx, cz, id))`,
   expandindo tags (`#cobblemon:ruin`, `#cobblemon:shipwreck_cove`) por tabela gerada pelo importador a partir de
   `data/cobblemon/tags/worldgen/structure`.
- Alternativa ao bloco: **entidade marcadora** no molde (T8: nasce com tags e dispara `entityLoad` a cada carga de
  chunk). Mais simples de depurar, mas custa 1 entidade persistente por peça. Preferir o bloco.
- Mundos já existentes: estruturas geradas antes da atualização não terão marcador (limitação aceita).

**Receita — vilas vanilla (`#minecraft:village`)**
1. Gatilho de geração nova (T14): `world.afterEvents.entitySpawn` com `cause === "Event"` e tipo
   `minecraft:villager_v2 | minecraft:iron_golem | minecraft:cat` → `system.runTimeout(…, 40)` (esperar o resto da vila).
2. Confirmação (T13): `dimension.containsBlock(new BlockVolume(p±48, y±32), {includeTypes:["minecraft:bell"]}, false)`;
   se achou, `getBlocks` com sino + camas + blocos de trabalho → caixa envolvente + 16 blocos de margem → registrar
   os chunks como `minecraft:village` no mesmo registro do item acima.
3. Mundo antigo / chunk sem registro: avaliação preguiçosa no spawner — na primeira consulta de um chunk, o mesmo
   `containsBlock(bell)` num raio de 64 blocos (≈1 ms), resultado (positivo **e** negativo) guardado em cache por
   chunk com validade (ex.: 10 min de jogo) para não repetir.
4. Pitfalls: chunk descarregado devolve vazio sem erro → só consultar com `isChunkLoaded`; jogadores podem colocar
   sinos (aceitar falso positivo, como Java aceita estruturas "mortas").

**Outras vanilla (baixa prioridade, heurística por bioma + blocos)**: monumento (`prismarine`/`dark_prismarine`/
`sea_lantern` abaixo do nível do mar em bioma oceano profundo), cabana da bruxa (bioma pântano + `cauldron` +
`spruce_planks` elevado), iglu (`snow` + `white_carpet`/`redstone_torch` em bioma nevado), naufrágio (madeira submersa +
baú — fraca), poço do deserto (`sandstone` + água isolada em deserto). Total afetado: 26 entradas + 26 anti.

**Viabilidade**: nossas estruturas **SIM**; vilas **SIM (heurística)**; demais vanilla **ARRISCADO** (heurística fraca).

## 2. Waterlogging de blocos custom

**SIM.** `minecraft:liquid_detection` é estável (exige `format_version` ≥ 1.21.60)
([Microsoft Learn](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/blockreference/examples/blockcomponents/minecraftblock_liquid_detection?view=minecraft-bedrock-stable)).
Teste T9: com `{"detection_rules":[{"liquid_type":"water","can_contain_liquid":true,"on_liquid_touches":"no_reaction"}]}`
o bloco aceita `setWaterlogged(true)` e continua alagado; sem o componente, `Block type cannot be waterlogged`.

**Receita**
- `on_liquid_touches`: `"no_reaction"` (água passa por dentro, ex.: decorações/plantas baixas), `"blocking"` (padrão),
  `"broken"`/`"popped"` (como tochas/sementes).
- Importador (`tools/importer/blocks.ts:4,209,908` hoje **descarta** `waterlogged`): para cada bloco cuja classe Java
  implementa `SimpleWaterloggedBlock` — 23 classes: `RingTarget, CoinPouch, DecorativeItem, EjectButton,
  ActivatableDecoration, Plaque, Orb, Tumblestone, SweetIncense, SaccharineLeaf, PC, WallAttachedDirectional,
  StackableItem, GalaricaWreath, SixFaceRotational, Pasture, WallAttachedStackableItem, Magnet, HeartyGrains,
  CampfirePot, TMMachine, Campfire, GildedChest` — e para lajes/escadas/cercas/portas/alçapões custom, emitir o componente.
- Estruturas (`tools/importer/structures.ts:117`, hoje apaga `waterlogged`): gravar a camada 1 (`layer1`) do
  `.mcstructure` com água quando `waterlogged=true` (o formato já tem a segunda camada; o writer grava tudo `-1`).
  No jigsaw data-driven use `liquid_settings: "apply_waterlogging"`.
- Pitfall: o componente só controla **se** pode conter; o jogador alaga com balde normalmente. Render da água dentro
  do bloco é do cliente — **conferir no jogo** blocos com geometria parcial.

## 3. NPC com skin de jogador (`applyplayertexture`)

**NÃO** há como pôr a textura da skin de um jogador numa entidade no Bedrock (skins são do cliente; não existe
fetch por UUID; o Mannequin é exclusivo do Java — [Minecraft Wiki](https://minecraft.wiki/w/Mannequin),
[pedido na Feedback](https://feedback.minecraft.net/hc/en-us/community/posts/41027961930637-Bedrock-Mannequins)).
A 2.12 beta só expõe `EntityNpcComponent.skinIndex` (skins do NPC vanilla, não do jogador).

**Melhor aproximação**
1. Entidade humanoide própria com `geometry.humanoid.custom` (e `geometry.humanoid.customSlim`) e uma lista de
   texturas no render controller indexada por propriedade de entidade (`cobblemon:skin` int, `client_sync`).
2. Conjunto: Steve/Alex clássicos + texturas de NPC do Cobblemon (`assets/cobblemon/textures/npcs`) + pack opcional
   do dono do servidor.
3. `applyplayertexture <jogador>` vira: escolher a skin do conjunto de forma determinística pelo nome do jogador
   (hash) ou abrir um formulário para o operador escolher; guardar em dynamic property.
**Viabilidade**: aproximação **SIM**; fiel **NÃO**. Arquivo-alvo: `scripts/npc/*`, entidade NPC no importador (`tools/importer/npcs.ts`).

## 4. Contêineres reais em blocos custom (baú dourado, vitrine, estante de discos, panela)

Blocos custom **não** têm `minecraft:inventory` (a lista `BlockComponentTypes` de 2.10 e da 2.12 beta não oferece
inventário para bloco custom; `BlockInventoryComponent` é só de blocos vanilla). O caminho estável é o "estilo carrinho
com baú": **entidade auxiliar invisível** com `minecraft:inventory`.

**Evidência**: T10 (funil puxa com `can_be_siphoned_from: true`), T11 (item completo preservado), e o `.d.ts` 2.10
tem `EntityInventoryComponent.canBeSiphonedFrom`/`containerType` e os eventos `entityContainerOpened/Closed`.
Pitfall conhecido: **`minecraft:interact` com `on_interact` cancela a tela do inventário** da entidade
([PlanetMinecraft](https://www.planetminecraft.com/forums/bedrock/addons/using-on-interact-cancels-entity-s-inventory-screen-689076/)) —
use `world.beforeEvents.playerInteractWithEntity` por script quando precisar de lógica extra.

**Receita (baú dourado — UI de baú real)**
- Entidade `cobblemon:gilded_chest_storage` (já existe em `behavior_packs/CobblemonBedrock/entities/machines/`):
  `"minecraft:inventory": {"container_type":"container","inventory_size":27,"can_be_siphoned_from":true}`,
  sem `minecraft:interact`, sem gravidade/colisão física, `damage_sensor` sem dano, `persistent`.
- **Hitbox ≥ bloco** (`collision_box` 1.0×1.0 ou 1.02): hoje é 0.95 → o raio do jogador tende a acertar a face do
  bloco antes da entidade (clique abre nada). **Conferir no jogo** e ajustar.
- Quebrar: o clique esquerdo acerta a entidade → `world.afterEvents.entityHitEntity` (jogador → entidade de baú)
  quebra o bloco por script (drop do bloco + drop do conteúdo + `entity.remove()`).
- Funil **abaixo** puxa (T10). Funil empurrando **para dentro** da entidade: não testado (improvável).
- Estado aberto/fechado (animação da tampa): `entityContainerOpened/Closed` → trocar estado do bloco.

**Receita (vitrine/estante de discos/panela — armazenamento sem UI)**
- Mesma entidade com `inventory_size` = nº de slots (1 vitrine, 9 estante, 9+1+tempero panela), **sem** a UI
  (`container_type` qualquer + o clique tratado por `beforeEvents.playerInteractWithEntity` com `cancel = true`
  e lógica própria). Guardar/retirar com `ContainerSlot`/`Container.transferItem/moveItem`: **preserva encantamento,
  durabilidade, poção, livro, dynamic properties** (T11) — elimina a limitação do `SlotItem` em
  `scripts/machines/itemUtil.ts:2-4` ("Encantamentos e outros componentes não são preservados").
- Panela sobre fogueira: se quiser a UI de contêiner, `container_type:"container"` com 9 slots + script que lê o
  inventário ao fechar (`entityContainerClosed`) e cozinha; o resultado vai para o último slot (`can_be_siphoned_from`
  deixa o funil coletar, como no Java).
**Viabilidade**: **SIM** (clique e hitbox precisam de teste no jogo). Alvos: `scripts/machines/decor.ts`,
`scripts/machines/cooking.ts`, `scripts/machines/itemUtil.ts`, `behavior_packs/.../entities/machines/*.json`.

## 5. Música de batalha e sons custom

- O Cobblemon 1.8.2 **tem** eventos de música de batalha, mas vazios, para resource packs:
  `battle.pvw.default`, `battle.pvp.default`, `battle.pvn.default` = `{"sounds": []}` (`assets/cobblemon/sounds.json`).
  O `client/sound/BattleMusicController.kt` toca em laço, pausa `AMBIENT/MUSIC/RECORDS` e faz fade ao terminar.
- Bedrock estável 2.10: `Player.playMusic(trackId, {loop, fade, volume})`, `queueMusic`, `stopMusic` (T12 sem erro).
  `playMusic` já para a música vanilla atual (substitui a faixa); `stopMusic` devolve ao ciclo normal.
- **Receita**: no RP, `sounds/sound_definitions.json` com `cobblemon.battle.pvw.default` etc. na categoria `music`
  (lista vazia ou uma faixa silenciosa curta); no início da batalha `player.playMusic(id, {loop:true, fade:2})`,
  no fim `player.stopMusic()`; PvP/NPC/selvagem escolhem o id. Um resource pack de terceiros só precisa preencher
  os eventos — paridade total com o Java. Na 2.11 (1.26.60) dá para usar `playSound(... loopCount)` + `SoundInstance.fade`
  se quiser música **posicional**.
- Pitfall: música é por jogador; espectadores recebem a mesma chamada. Consoles/Realms: API normal de cliente, sem risco.
**Viabilidade**: **SIM**. Alvos: `scripts/battle/*` (início/fim), `resource_packs/CobblemonBedrock/sounds/sound_definitions.json`.

## 6. Advancements (lado do script)

**NÃO** existem conquistas de add-on. Inventário do que rastrear (61 advancements não-receita em
`data/cobblemon/advancement`: catching 27, agriculture 20, geological 12, battle 1, root 1):

| Gatilho (nº de critérios) | Como detectar no Bedrock estável |
|---|---|
| `minecraft:inventory_changed` (223) | `world.afterEvents.playerInventoryItemChange` + tags de item geradas |
| `cobblemon:aspects_collected` (44) | hook no nosso `PokemonData` ao ganhar aspecto (pokédex/captura/evolução) |
| `cobblemon:pokemon_interact` (42) | `beforeEvents.playerInteractWithEntity` com item (mentas, etc.) |
| `cobblemon:has_learn_specific_tm` (22), `has_learn_all_tm` (1) | nosso sistema de TM (`scripts/machines/tm.ts`) |
| `minecraft:placed_block` (9) | `world.afterEvents.playerPlaceBlock` |
| `minecraft:player_interacted_with_entity` (6) | `afterEvents.playerInteractWithEntity` |
| `cobblemon:resurrect_pokemon` (5) | nossa máquina de fósseis |
| `minecraft:item_used_on_block` (4), `any_block_use` (1) | `afterEvents.playerInteractWithBlock` |
| `cobblemon:trade_pokemon` (3), `pokemon_evolved` (2), `pick_starter` (1), `battles_won` (1), `catch_*` (3), `level_up` (1), `party` (1), `pasture_use` (1), `reel_in_pokemon` (1), `plant_tumblestone` (1), `plant_type_gem` (1), `riding_stat_boost` (1) | eventos internos do port (`scripts/events/CobblemonEvents.ts`) |
| `minecraft:started_riding` (1) | `Riding.ts` ao montar |

- Persistência: dynamic property por jogador (bitset por advancement + contadores).
- Exibição (coordenar com o pesquisador de UI): toast via `onScreenDisplay.setTitle` + JSON UI, lista na Pokédex.
- Os **743 advancements de receita** são desbloqueio do livro de receitas → usar o campo `unlock` das receitas Bedrock
  (estável) com o mesmo item-gatilho, sem script.
- Efeito no jogo: requisito `advancement` de evolução e TMs `PlayerHasAdvancementObtainMethod` passam a checar o bitset.
**Viabilidade**: rastreamento **SIM**; conquista nativa **NÃO**. Alvos: novo `scripts/advancements/*`, gerador em `tools/importer`.

## 7. Câmera, entrada e montaria

**Estável em 2.10** (`.d.ts`): `Camera.setCamera(preset, CameraFixedBoomOptions | CameraSetFacingOptions |
CameraSetLocationOptions | CameraSetPosOptions | CameraSetRotOptions | CameraTargetOptions)`, `setDefaultCamera`,
`attachToEntity({entity, locator})` ("Attaches the camera to a non-player entity" —
[Microsoft Learn](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/camera?view=minecraft-bedrock-stable)),
`setFov({fov, easeOptions})`, `fade`, `addShake`, `playAnimation(spline)`. Presets no pack vanilla estável do BDS:
`first_person, fixed_boom, follow_orbit, free, third_person, third_person_front` (o `control_scheme_camera` está só no
pack `experimental_creator_cameras`). Presets próprios em `BP/cameras/presets/*.json` com `inherit_from` +
`radius`, `entity_offset`, `view_offset` ([doc dos presets de 3ª pessoa](https://learn.microsoft.com/en-us/minecraft/creator/documents/camerasystem/camerapresetthirdperson?view=minecraft-bedrock-stable);
a página ainda diz "experimental", mas os presets estão no pack vanilla estável do BDS 1.26.52).
Entrada: `InputInfo.getMovementVector()`, `getButtonState(InputButton.Jump|Sneak)` (só esses dois botões),
`world.afterEvents.playerButtonInput`, `Player.isSprinting/isJumping`, `Player.inputPermissions.setPermissionCategory(InputPermissionCategory.Dismount|Sneak|Jump|…, bool)`,
`Player.setControlScheme(CameraRelative|PlayerRelative|…Strafe)`.

**Mapa para os estilos do Cobblemon** (`data/cobblemon/ride_settings`: bird, boat, burst, dolphin, glider,
helicopter, horse, hover, jet, minekart, …; o port já usa `input_ground_controlled` e `free_camera_controlled`):
- **Câmera por estilo**: preset `cobblemon:ride_<estilo>` herdando `follow_orbit` (raio/offset do tamanho da
  espécie), aplicado ao montar e `camera.clear()` ao desmontar. Jet/rocket: `setFov` subindo com a velocidade (o
  Cobblemon faz "FOV kick" no boost). **Precisa de teste no jogo** (interação de `follow_orbit` com veículo).
- **Descer/boost sem sprint**: desligar `Dismount` enquanto voa/mergulha (`inputPermissions`), usar `Sneak` para
  descer/frear e **agachar duplo** (ou pulo+agachar) para desmontar; `Jump` segurado = subir/boost
  (`playerButtonInput`). O botão de sprint não é exposto — `player.isSprinting` enquanto montado **não testado**.
- **Roll/pitch do corpo**: roll da câmera **NÃO** (as opções só têm yaw/pitch). Roll **visual** do modelo: propriedade
  de entidade `cobblemon:roll` (float, `client_sync: true`) atualizada por script a partir do yaw delta +
  `q.property('cobblemon:roll')` num bone raiz na animação/controller do RP → **SIM** (sem experimento).
  Pitch do Pokémon voador: mesmo truque com `cobblemon:pitch`.
- **Stamina/HUD**: já na actionbar; `setFov` e `addShake` servem de feedback de boost.
**Viabilidade**: **SIM** parcial (câmera e roll visual precisam de teste no jogo). Alvos: `scripts/entity/Riding.ts`,
novo `behavior_packs/CobblemonBedrock/cameras/presets/`, animações de montaria no RP.

## 8. Enseadas de naufrágio e estruturas grandes

- Java: as 3 enseadas já são **jigsaw** (`worldgen/structure/shipwreck_coves/*.json`: `start_pool`, `size: 20`,
  `max_distance_from_center: 128`, `start_height` constante 25, `liquid_settings: ignore_waterlogging`,
  `structure_set` `random_spread` spacing 100 / separation 50), 39 template pools e 54 moldes `.nbt`.
- Bedrock: o jigsaw data-driven estável aceita `max_distance_from_center.horizontal` até **128**, `max_depth` até 20,
  `liquid_settings`, `dimension_padding`, `terrain_adaptation` (`beard_thin/box`, `bury`, `encapsulate`), projeção
  `minecraft:terrain_matching` e processadores `minecraft:rule`/`minecraft:capped`
  ([referência](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/worldgenreference/examples/jigsawjigsawstructures?view=minecraft-bedrock-stable)).
  Peças e estruturas > 64 funcionam (T15). **Tradução quase 1:1** das enseadas.
- Colocação por script (`structureManager.place` no primeiro carregamento do chunk): possível mas **não recomendada**
  — 378 ms síncronos para 22 k blocos (T15) → uma enseada inteira (dezenas de milhares de blocos) arrisca o watchdog;
  não existe evento estável de "chunk novo" (só `isChunkLoaded`); a parte em chunk não carregado é perdida.
- **Receita**: gerar `BP/worldgen/structure_sets/cobblemon_shipwreck_coves.json`, `worldgen/structures/*.json`
  (ids **sem `/`**, ex.: `cobblemon:lush_shipwreck_cove`, para o `/locate` aceitar — T1), `worldgen/template_pools/**`
  (`location` = caminho em `structures/`, T3) e `structures/cobblemon/shipwreck_coves/**.mcstructure` **mantendo os
  blocos jigsaw** no formato de T5 (`orientation` Java → `facing_direction` + `rotation`; `pool` → `target_pool`;
  `name`, `target`, `final_state`, `joint`, prioridades iguais). Biomas: `#cobblemon:is_cold_ocean` etc. →
  `biome_filters` com `has_biome_tag`.
**Viabilidade**: **SIM**. Alvos: `tools/importer/jigsaw.ts` (novo modo "data-driven"), `tools/importer/structures.ts`
(writer com jigsaw + camada de água), `tools/importer/worldgen.ts`.

## 9. Vilas do Cobblemon e jigsaw data-driven em geral

- **Injeção nos pools da vila vanilla: NÃO.** As vilas usam o jigsaw legado; só estruturas data-driven podem ser
  sobrescritas ("Other Jigsaw Structures such as Villages and Bastions use a legacy version…" —
  [Microsoft Learn](https://learn.microsoft.com/en-us/minecraft/creator/documents/structures/introductiontojigsawstructures?view=minecraft-bedrock-stable)).
  O pack vanilla 1.26.50 do BDS só tem `abandoned_camp` data-driven (vila continua fora).
- **Alternativa por script (ARRISCADO, opcional por config)**: gatilho T14 (`entitySpawn` com causa `Event` de aldeão/
  golem) → sino (T13) → procurar em anel de 24–48 blocos do sino um terreno plano (grade de `getTopmostBlock`,
  variação ≤ 2, sem camas/blocos de trabalho) → `structureManager.placeJigsawStructure("cobblemon:pokecenter_<bioma>",
  dim, pos)` uma vez por vila (registro pelo sino). Riscos: sobrepor casas/estradas, colocação assíncrona (T6).
- **Alternativa simples (SIM)**: Pokécenter como estrutura data-driven independente com `biome_filters` dos biomas
  de vila e spacing próprio (não fica "dentro" da vila).
- **Substituir as 62 montagens pré-prontas por jigsaw data-driven: SIM, recomendado.** Ganhos: variação real por mundo
  (hoje algumas sementes fixas), `/locate`, estruturas grandes, marcador por peça (item 1) e menos arquivos.
  Custos/pitfalls: só `.mcstructure` (T4); processadores fora de `rule/capped` continuam "assados" na conversão;
  `location` é caminho (T3, erro silencioso); pools com `fallback`; ids de estrutura sem `/`; conferir
  `terrain_matching` visualmente; `habitats`/`fossils` que hoje são features de molde podem continuar como estão.

## 10. Outros itens de ALVOS.md (lado do motor)

- **Scanner da Pokédex — zoom**: `player.camera.setFov({fov: 30, easeOptions:{easeTime:0.2}})` ao segurar e
  `setFov()` (sem args) ao soltar → **SIM** (estável; conferir no jogo). Overlay = pesquisador de UI.
- **Dano corpo a corpo por Pokémon** (PARIDADE-MECANICAS: "NÃO POSSÍVEL por Pokémon"): `world.beforeEvents.entityHurt`
  é estável e `damage` é gravável (`EntityHurtBeforeEvent { cancel; damage; damageSource; hurtEntity }`) → multiplicar
  pelo Ataque/nível do Pokémon atacante → **SIM** (T17: dano 2 virou 6 no BDS).
- **Tamanho individual (IV de tamanho/baby size)**: além dos grupos por evento do `Size.ts`, escala **visual** contínua
  por propriedade `client_sync` + `scale` no render controller/animação (hitbox segue por grupo) → **SIM** visual.
- **Altura dos olhos**: **NÃO** (sem componente/ API).
- **Música/sons em laço de máquinas** (cura, incenso): `playSound` → `SoundInstance.stop()` já em 2.10; laço nativo
  (`loopCount`) na 2.11.
- Baú dourado/vitrine/estante (ALVOS linhas 1–2): ver item 4.

## Plano priorizado

| Prio | Entrega | Arquivos-alvo | Tamanho | Depende de teste no jogo? |
|---|---|---|---|---|
| P0 | Waterlogging: `liquid_detection` nos 23 tipos + lajes/escadas/cercas; água na camada 1 dos `.mcstructure` | `tools/importer/blocks.ts`, `tools/importer/structures.ts` | S | render parcial |
| P0 | Contêiner real/armazenamento por entidade (baú dourado com UI + funil; vitrine/estante/panela preservando NBT) | `scripts/machines/decor.ts`, `cooking.ts`, `itemUtil.ts`, `entities/machines/*.json` | M | hitbox/clique |
| P0 | Música de batalha (eventos vazios no RP + `playMusic/stopMusic`) | `scripts/battle/*`, `resource_packs/.../sounds/sound_definitions.json` | S | não |
| P1 | Jigsaw data-driven no importador (enseadas primeiro, depois ruínas/barcos) | `tools/importer/jigsaw.ts`, `structures.ts`, `worldgen.ts` | L | visual |
| P1 | Registro de estruturas + marcador por peça; condição `structures` e requisito `structure` | novo `scripts/world/StructureRegistry.ts`, `scripts/spawning/SpawnConditions.ts:181`, `scripts/evolution/requirements/ExtraRequirements.ts:66`, bloco marcador no importador | M | não |
| P1 | Detector de vilas (gatilho `Event` + sino + cache por chunk) | `StructureRegistry.ts`, `scripts/spawning/Spawner.ts` | S | não |
| P2 | Montaria: presets de câmera, `inputPermissions` Dismount, sneak/jump, `setFov`, roll/pitch visual por propriedade | `scripts/entity/Riding.ts`, `BP/cameras/presets/`, RP animações | M | sim |
| P2 | Zoom do scanner (`setFov`) e dano por Pokémon (`beforeEvents.entityHurt`) | `scripts/pokedex/*`, `scripts/entity/*` | S | zoom |
| P2 | Rastreamento de advancements (61) + `unlock` das receitas | novo `scripts/advancements/*`, `tools/importer/recipes.ts` | M | não |
| P3 | Pokécenter junto de vilas por script (opcional, config) | `StructureRegistry.ts` + estrutura data-driven | M | sim |
| P3 | NPC com skin escolhida de um conjunto | `scripts/npc/*`, `tools/importer/npcs.ts` | S | sim |
| Futuro | Trocar heurísticas por `Dimension.getGeneratedStructures` quando sair do beta | `StructureRegistry.ts` | S | — |

## Fontes

- `.d.ts` de `@minecraft/server` 2.10.0 (repo), 2.11.0-rc.1.26.60-preview.28 e 2.12.0-beta.1.26.60-preview.28 (npm).
- Jigsaw: [Introduction to Jigsaw Structures](https://learn.microsoft.com/en-us/minecraft/creator/documents/structures/introductiontojigsawstructures?view=minecraft-bedrock-stable),
  [Jigsaw Structures reference](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/worldgenreference/examples/jigsawjigsawstructures?view=minecraft-bedrock-stable),
  [Minecraft Wiki – Jigsaw structure (histórico 1.21.50→1.21.120)](https://minecraft.wiki/w/Jigsaw_structure),
  [Bedrock Edition 1.21.80](https://minecraft.wiki/w/Bedrock_Edition_1.21.80),
  [Bedrock Wiki – Generating Custom Jigsaw Structures](https://wiki.bedrock.dev/world-generation/generate-custom-jigsaw-structures),
  [Bedrock Wiki – .mcstructure](https://wiki.bedrock.dev/nbt/mcstructure).
- Pack vanilla do BDS 1.26.52 (`behavior_packs/vanilla_1.26.50`: `worldgen` do `abandoned_camp`, moldes `.nbt`,
  `cameras/presets`).
- [minecraft:liquid_detection](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/blockreference/examples/blockcomponents/minecraftblock_liquid_detection?view=minecraft-bedrock-stable).
- [getGeneratedStructures (beta) – JaylyMC](https://jaylydev.github.io/scriptapi-docs/latest/classes/_minecraft_server.Dimension.html).
- [Camera class](https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/camera?view=minecraft-bedrock-stable),
  [Third Person Camera Presets](https://learn.microsoft.com/en-us/minecraft/creator/documents/camerasystem/camerapresetthirdperson?view=minecraft-bedrock-stable).
- [minecraft:inventory](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/entityreference/examples/entitycomponents/minecraftcomponent_inventory?view=minecraft-bedrock-stable),
  [on_interact cancela a tela do inventário](https://www.planetminecraft.com/forums/bedrock/addons/using-on-interact-cancels-entity-s-inventory-screen-689076/).
- [Mannequin (Java)](https://minecraft.wiki/w/Mannequin), [Bedrock Mannequins (Feedback)](https://feedback.minecraft.net/hc/en-us/community/posts/41027961930637-Bedrock-Mannequins).
- Código do Cobblemon 1.8.2 em `upstream/cobblemon` (spawn pools, `SpawnablePosition.kt`, `StructureRequirement.kt`,
  `BattleMusicController.kt`, `sounds.json`, `advancement/`, `worldgen/structure/shipwreck_coves`).
