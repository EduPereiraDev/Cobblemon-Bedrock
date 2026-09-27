# Frente "mundo-sons" (BDS `mundo-sons`, porta 19146)

Sons de gatilho do Cobblemon nos blocos/máquinas/itens/pesca, partículas do Cobblemon nas máquinas e a completude
de pasto, panela, TM Machine, redstone dos decorativos e barcos.

## Arquivos

| Tipo | Arquivos |
|---|---|
| Scripts | `scripts/custom_components/{ButtonComponent,PressurePlateComponent,RedstoneEvents,HealingMachineComponent,PCComponents,PlantComponent,GiveLeftoversComponent,index}.ts`, `scripts/custom_components/machines/index.ts`, `scripts/custom_components/plants/saccharine.ts`, `scripts/machines/{common,tm,cooking,fossils,pasture,pastureLogic,index,probe}.ts`, `scripts/items/{boats,components,usage}.ts` |
| Gerador | `scripts/custom_components/gen-block-sounds.mjs` (rodar depois de `npm run import` se a lista de blocos mudar) |
| RP | `resource_packs/CobblemonBedrock/sounds.json` (conjuntos `block_sounds`/`interactive_sounds`), `resource_packs/CobblemonBedrock/blocks.json` (208 blocos → conjunto do Cobblemon), `entity/boats/*.entity.json`, `textures/entity/cobblemon_boat/*.png`, `texts/*.lang` (seção `## mundo-sons`) |
| BP | `behavior_packs/CobblemonBedrock/blocks/cobblemon/*.json` (complementos parciais mesclados por cima do bloco gerado pelo `tools/build.mjs`: botões, placas, Ring Target, fogueiras, TM Machine, pasto, monitores), `entities/boats/*.json` |
| Teste | `tests/mundo-sons.test.ts` |
| Fora da lista | `tools/importer/validateContent.ts` (ver "Coordenação") |

### Complementos de bloco no BP manual

O importador (frente motor) gera o bloco inteiro; o arquivo no mesmo caminho em `behavior_packs/CobblemonBedrock/blocks/cobblemon/`
só acrescenta: o `tools/build.mjs` faz `deepMerge` (objetos mesclados, listas de permutações concatenadas, `format_version`
substituído). Se o importador deixar de gerar um desses blocos, o complemento sozinho fica inválido: apagar o arquivo.

| Bloco | Acrescenta | Formato |
|---|---|---|
| `apricorn_button`, `saccharine_button`, `eject_button` | `minecraft:redstone_producer` (15) com `cobblemon:pressed`, face forte = bloco de apoio (6 permutações por `minecraft:block_face`) | 1.21.120 (exigido pelo componente) |
| `apricorn_pressure_plate`, `saccharine_pressure_plate` | `redstone_producer` 15 (forte para baixo) com `cobblemon:pressed` | 1.21.120 |
| `ring_target` | estado `cobblemon:power` 0..15 + 15 permutações `redstone_producer` = força | 1.21.120 |
| `campfire`, `soul_campfire` | `minecraft:redstone_consumer` (sem ele `Block.getRedstonePower()` devolve `undefined`) | 1.26.0 (exigido pelo componente) |
| `tm_machine` | `minecraft:entity_fall_on` (dispara `onEntityFallOn`) | — |
| `pasture` | luz 13 com `on` na parte de cima (CobblemonBlocks.PASTURE) | — |
| `monitor` / `damaged_monitor` | luz 13 com tela ligada / 10 com `glitching` | — |

## Verificação

- `npm run import` e `npm run validate`: 0 erros desta frente (os 2 restantes na última rodada eram de `cobblemon:npc`,
  texturas `steve`/`alex`, frente ia-npc).
- `npx tsc -p tsconfig.json`: 0 erros.
- `npm test`: todos passam, incluindo `mundo-sons: ok` (11 blocos de checagem).
- BDS próprio (`COBBLEMON_DIST=dist-mundo-sons COBBLEMON_BDS=mundo-sons COBBLEMON_BDS_PORT=19146`): log sem nenhum
  ERROR/WARN de conteúdo ou script (só o aviso fixo de transporte NetherNet do servidor). Conferências por console com
  a sonda `scriptevent cobblemon:ms_*` (`scripts/machines/probe.ts`, só responde ao console):
  - redstone: com o estado apertado, lâmpada ao lado do bloco de apoio do Eject Button e ao lado do botão/placa de
    apricorn acende; Ring Target com `power=12` acende a lâmpada e com `power=0` não; `ms_press` apertou e o botão
    voltou sozinho (Eject 40 ticks, madeira 30); `ms_hit` 9 → `power` 9 e volta a 0 depois de 20 ticks.
    Observação: sem jogador conectado o BDS não reavalia circuitos vanilla ao vivo (lâmpada ao lado de bloco de
    redstone também não acende); a prova foi feita recarregando o chunk (reinício), quando o motor recalcula.
  - panela: `getRedstonePower` = 15 com bloco de redstone ao lado → tampa fechou (`lid: true, powered: true`); tirando
    o bloco → `redstone=0`, tampa abriu. Estado `idle` com ingrediente sem receita (laço `ambient`).
  - TM Machine: `ms_tm` → queima, grava (`result: tackle ×1`), estados `active/empty/dispensed` certos, sem exceções.
  - barcos: `cobblemon:apricorn_boat`/`saccharine_boat` boiam (y 68,4 em água com superfície em 69) e o de baú idem;
    continuam no lugar depois de reiniciar; `applyDamage` quebra e o item que cai é o do Cobblemon
    (`cobblemon:saccharine_chest_boat×1`, `cobblemon:apricorn_boat×1`), não o barco de carvalho.
  - As quedas do servidor durante os testes eram OOM da VM do Docker (aviso do orquestrador), não conteúdo.
- Som e partícula são só do cliente: no servidor a prova é "sem exceção e id existente no `sound_definitions`"
  (checado no teste para todos os ids usados).

## Sons: evento → gatilho → status

Contagem geral (ids citados em scripts, RP e `generated/`): **332 de 394** eventos não-espécie, contra ~80 antes.
Blocos: 101 de 103. Abaixo, os desta frente e os que ficaram de fora.

### Blocos (quebrar/colocar/bater/pisar) — `sounds.json` + `blocks.json` do RP

| Conjunto (SoundType do Kotlin) | Eventos | Blocos | Status |
|---|---|---|---|
| TUMBLESTONE_SOUNDS / TUMBLESTONE_BLOCK_SOUNDS | `block.tumblestone.{break,block_break,hit,place,step}` | 12 cristais + 43 blocos/lajes/muros/escadas | FEITO |
| TYPE_GEM_BLOCK / TYPE_GEM_CLUSTER | `block.type_gem_block.{break,hit,place,step}`, `block.type_gem_cluster.break` | 18 + 18 | FEITO |
| EVOLUTION_STONE_BLOCK | `block.evolution_stone_block.*` | 10 | FEITO |
| TATAMI_BLOCK / TATAMI_MAT | `block.tatami.*`, `block.tatami_mat.{break,place}` | 2 | FEITO |
| BERRY_BUSH | `block.berry_bush.{break,place}` (+ grama vanilla) | 70 berries | FEITO |
| BIG_ROOT / ENERGY_ROOT | `block.big_root.break`, `block.energy_root.place` (+ grama vanilla) | 2 | FEITO |
| MEDICINAL_LEEK, VIVICHOKE, MINT, REVIVAL_HERB | `block.<planta>.{break,place/plant}` | 1+1+6+1 | FEITO |
| HEARTY_GRAIN_BALE / HEARTY_GRAINS | `block.hearty_grain_bale.*`, `block.hearty_grains.{break,place}` | 2 | FEITO |
| HEARTY_GRAINS_WATER | `block.hearty_grains.{break_water,place_water}` | — | NÃO POSSÍVEL: o `blocks.json` dá um conjunto por bloco, não por estado (alagado); toca o seco |
| GILDED_CHEST | `block.gilded_chest.{break,hit,place,step}` | 8 | FEITO (abrir/fechar: frente motor, `scripts/world/Containers.ts`) |
| DISPLAY_CASE | `block.display_case.{break,hit,place,step}` | 1 | FEITO (`add_item`/`remove_item` por script) |
| CAMPFIRE_POT | `block.campfire_pot.{break,hit,place,step}` | 7 panelas | FEITO |
| RELIC_COIN_SACK / POUCH | `block.relic_coin_*` | 2 | FEITO |
| ITEM_BLOCK_PAPER_SMALL / LARGE | `block.item_block.paper_*` (+ lã vanilla) | Cleanse/Spell Tag, Blunder/Weakness Policy | FEITO |

### Máquinas, itens e mundo — scripts

| Evento | Gatilho no Cobblemon | Gatilho no port | Status |
|---|---|---|---|
| `block.tm_machine.open` / `.close` | agachar na máquina (TMMachineBlock) / cair em cima aberta | `openTMMachine` (antes tocava o som da panela) / `onEntityFallOn` | FEITO |
| `block.tm_machine.tm_insert`, `.item_insert`, `.start` | Blank TM, ingrediente e início da queima na tela | início da gravação (sem slots: em sequência, 0/4/8 ticks) | FEITO |
| `block.tm_machine.burn_loop` | laço enquanto queima | `keepMachineLoop` a cada 80 ticks durante os 100 de queima; `/stopsound` no fim | FEITO |
| `block.tm_machine.craft` | TM gravado | `tickTMMachines` | FEITO |
| `block.tm_machine.tm_retrieve` | tirar o TM pronto | clique que entrega o TM | FEITO |
| `block.tm_machine.item_retrieve` | tirar ingrediente de um slot | — | N/A (sem slots no Bedrock; ingredientes saem do inventário ao começar) |
| `block.campfire_pot.set` / `.retrieve` | panela posta na fogueira / retirada | `placePotOnCampfire` / `removePot` | FEITO |
| `block.campfire_pot.open` / `.close` | tampa (tela, redstone) | tela e redstone | FEITO |
| `block.campfire_pot.cook` | prato pronto | `tickCookingPots` | FEITO |
| `block.campfire_pot.take_item` | tirar o resultado | botão "resultado" (som só para o jogador) | FEITO |
| `block.campfire_pot.active` / `.ambient` | laço cozinhando / com itens parados | laços de 360 ticks, trocados conforme `potActivity` | FEITO |
| `block.fossil_machine.*` (11) | analisador/tanque | fósseis, DNA (`insert_dna_small` em inserções < 10 ticks), `active_loop` enquanto restaura | FEITO |
| `block.monitor.insert` / `.loading` / `.glitching` / `.break` | disco/TM, Upgrade, Dubious Disc | monitor solto (laço cortado no fim do processo) | FEITO |
| `block.healing_machine.active` | ativar a cura | ao curar (antes: id sem prefixo) | FEITO |
| `pc.on` / `pc.off` | abrir/fechar PC e pasto | `PCComponents` (migrado para `cobblemon.pc.*`), pasto | FEITO |
| `block.apricorn.harvest` | colher apricorn madura | `PlantComponent` | FEITO |
| `block.berry_bush.harvest`, `block.mulch.*` | colher/adubar | `plants/berry.ts` | FEITO (já existia) |
| `poke_ball.send_out` / `.recall` no pasto | soltar/recolher | migrado para `cobblemon.poke_ball.*` | FEITO |
| `item.medicine.*`, `item.berry.eat`, `item.tm.use`, `gui.move_learn`, `item.use` | usar item | `items/effects.ts` | FEITO (já existia) |
| `item.berry.eat.full` | Pokémon cheio | `pokemon/Fullness.ts` (frente jogabilidade) | FEITO por outra frente |
| `fishing.*` (8) | pesca | `FishingController.ts` | FEITO (já existia) |

### Fora desta frente (sem gatilho nos meus arquivos)

| Eventos | Dono | Observação |
|---|---|---|
| `move.*`, `impact.*`, `status.*`, `animation.*` | animacao / batalhas | action_effects |
| `ride.loop.*` (14) | motor (`Riding.ts`) | |
| `battle.pv*.default` (3) | motor | o 1.8.2 não traz faixas |
| `pc.grab/drop/release`, `gui.click`, `gui.trade`, `gui.levelup(_start)` | interface / social / jogabilidade | telas |
| `poke_ball.*.ancient`, `poke_ball.throw/trail` | captura | |
| `item.pokedex.scan_zoom_increment` | captura/extras | zoom do scanner NÃO POSSÍVEL |
| `entity.npc.gibber.*` | ia-npc | |
| `entity.villager.work_nurse` | N/A | não há profissão de enfermeira no port |

## Partículas

| Onde | Cobblemon | Port | Status |
|---|---|---|---|
| Panela cozinhando | `cobblemon:broth_bubbles` (+ `broth_bubblepop`) a cada 20 ticks | `spawnBroth` (com `variable.size = 1`) | PARCIAL: o id é usado, mas a partícula só aparece quando o importador emitir (pedido 1) |
| Healing Machine | `HAPPY_VILLAGER` enquanto cura | `minecraft:villager_happy` a cada 4 ticks, metade das vezes | FEITO |
| Monitor (Porygon) | `LARGE_SMOKE`; `EXPLOSION` + `SMOKE` | `basic_smoke_particle`, `large_explosion` | FEITO |
| Tora com mel lavada | `SPLASH` | `water_splash_particle` | FEITO |
| Pesca | `bob_splash`, ripples, `*_fish_splash` | `FishingController.ts` | FEITO (já existia) |
| Folhas de saccharine com mel, Poké Snack (vela/mordida) | partículas vanilla em `animateTick` | — | NÃO FEITO: `animateTick` é do cliente; em script exigiria tick por bloco |

## Completude

| Item | Status | Detalhes |
|---|---|---|
| Pasto: "ataca mobs hostis" | PARCIAL | Botão por Pokémon (recolher / alternar), salvo no vínculo (`conflict`). O JSON do Pokémon não tem IA de ataque: a cada 20 ticks o Pokémon com a opção ligada recebe impulso até o monstro mais próximo (família `monster`, até 8 blocos, dentro da área) e bate por script (2 + nível/10). Pedido 3 para ataque pela IA. |
| Pasto: luz 13 ligado | FEITO | complemento `pasture.json` |
| Panela: redstone abre/fecha a tampa | FEITO | só na mudança do sinal (CampfireBlock.neighborChanged) |
| Panela: comparador, funil | NÃO POSSÍVEL | bloco custom não tem saída analógica nem inventário para funil |
| Panela: sons/partículas | FEITO / PARCIAL | ver tabelas |
| TM Machine | FEITO | sons certos, laço de queima, fecha a tampa quando algo cai em cima |
| Ring Target | FEITO | projétil → força pela distância do centro da face (TargetBlock), 20 ticks para flecha/tridente, 8 para o resto |
| Eject Button | FEITO | redstone 15 por 40 ticks (BlockSetType.IRON), sem flechas |
| Botões de madeira | FEITO | redstone 15 por 30 ticks; flecha aperta |
| Placas de pressão de madeira | FEITO | redstone 15; soltam 20 ticks depois de não ter entidade em cima |
| Metronome | PARCIAL | alterna `active` (frente plantas); saída de comparador 4 NÃO POSSÍVEL (sem saída analógica em bloco custom) |
| Healing Machine | FEITO / NÃO POSSÍVEL | som e partículas do Cobblemon; `healersHealPC` cura o PC (pedido B da jogabilidade); comparador NÃO POSSÍVEL |
| Barcos (4 itens) | FEITO (aproximação) | entidades `cobblemon:<madeira>_boat`/`_chest_boat` com `runtime_identifier` `minecraft:boat`/`chest_boat` (física, remo, 2 lugares / baú de 27) e textura do Cobblemon (geometria vanilla `geometry.boat`/`chest_boat`). Usar o item mirando água/bloco coloca o barco virado para o jogador. O drop vanilla (carvalho) é trocado pelo item do Cobblemon. Conferir no cliente: textura/UV e remos (sem animação de remo). |
| Leftovers das maçãs | FEITO | `appleLeftoversChance` (pedido F da jogabilidade) nas 5 maçãs da tag `held/leaves_leftovers` |
| Monitor: telas de TM de todos os tipos | FEITO | o enum passou de 16 valores e o importador divide em `screen_2/3`: antes só bug/dark |
| Retratos no pasto/itens | FEITO | `getPokemonSpriteTexture(pokemon)`; o vínculo guarda `variant` (pedido da frente retratos) |
| Tasty Tail | N/A | não está nos arquivos desta frente (já feito em `scripts/pokemon/SpeciesFeatures.ts`) |

## Coordenação

- `tools/importer/validateContent.ts` (sem dono declarado, fora da lista da frente): a validação de blocos passou a
  mesclar o arquivo do BP manual por cima do gerado quando os dois existem no mesmo caminho, igual ao `tools/build.mjs`.
  Sem isso os complementos acima davam "bloco duplicado"/"estado não declarado" (57 erros). Mudança de 15 linhas,
  marcada "frente mundo-sons".
- `resource_packs/CobblemonBedrock/blocks.json`: o arquivo antigo (feito à mão, antes do importador) aparece como apagado
  no índice do git; o novo no mesmo caminho é outro conteúdo, só `"sound"` por bloco (gerado por
  `gen-block-sounds.mjs`, sem `format_version`, porque o build concatenaria a lista com a do gerado).
- A sonda `scripts/machines/probe.ts` (`/scriptevent cobblemon:ms_*`) só atende o console do servidor e só lê/escreve
  estado de máquina; pode ficar para a frente e2e ou ser removida na integração (tirar a linha `safe("sonda", ...)` de
  `scripts/machines/index.ts`).

## Pedidos

### 1. animacao (`tools/importer/particles.ts`, `emitScriptParticles`)

Emitir também as partículas da panela (`cooking/broth_bubbles.particle.json` pede `broth_bubblepop` pelo fecho):

```ts
const ids = [...index.files].filter(([, f]) => /^(evo_|poodle_hair_|broth_)/.test(basename(f))).map(([id]) => id);
```

O script já usa `cobblemon:broth_bubbles` com `variable.size = 1` (`scripts/machines/cooking.ts`, `spawnBroth`).

### 2. motor (`tools/importer/blocks.ts`) — opcional

Os sons de bloco e a redstone vivem como complementos no RP/BP manual. Se o importador quiser assumir:
- `SOUND_MAP`: `TUMBLESTONE_SOUNDS` → `"cobblemon.tumblestone"` etc. (a lista completa está em
  `scripts/custom_components/gen-block-sounds.mjs`, `SETS`), e apagar `resource_packs/CobblemonBedrock/blocks.json`;
- `ButtonBlock`/`EjectButtonBlock`/`PressurePlateBlock`/`RingTargetBlock`: as permutações de
  `behavior_packs/CobblemonBedrock/blocks/cobblemon/*.json` (formato 1.21.120), e apagar os complementos.

### 3. entidades — opcional (ataque de verdade no pasto)

Um grupo de componentes `cobblemon:pasture_conflict` no JSON do Pokémon (`minecraft:behavior.nearest_attackable_target`
com `family monster` + `minecraft:behavior.melee_box_attack` + `minecraft:attack`) e os eventos
`cobblemon:enable_pasture_conflict`/`cobblemon:disable_pasture_conflict`. Com isso `tickPastureConflicts`
(`scripts/machines/pasture.ts`) troca o impulso/dano por `triggerEvent`.
