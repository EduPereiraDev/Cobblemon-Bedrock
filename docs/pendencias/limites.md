# Pendências da frente "limites" (pesquisa 8)

Pesquisa: `docs/pesquisa/8-limites-bedrock.md`. BDS próprio: `COBBLEMON_DIST=dist-limites COBBLEMON_BDS=limites
COBBLEMON_BDS_PORT=19152 COBBLEMON_BDS_TRANSPORT=raknet COBBLEMON_BDS_ONLINE_MODE=false`. O container foi removido.

Arquivos da frente:
- `scripts/experimental/limits/**`
- `tests/limites.test.ts`
- `tests/e2e/experimental/limites.e2e.mjs`
- `behavior_packs/CobblemonBedrock/entities/{npc/npc.json,experimental/limits_web_probe.json}`
- `resource_packs/CobblemonBedrock/render_controllers/npc/cobblemon_npc.render_controllers.json`
- em `scripts/main.ts`, 1 import e 1 chamada `registerLimitPrototypes()`

Exports novos no mock: `ControlScheme`, `LinearSpline`, `TextPrimitive`.

## Status proposto (o orquestrador consolida em PARIDADE-*)

| Item | Antes | Proposta | Prova |
|---|---|---|---|
| #53 / §8 NPC com modelo de Pokémon | NÃO POSSÍVEL | VIÁVEL (protótipo) | BDS: exibição montada no NPC (`montada_em=<npc>`, dist 0); clique na exibição e no NPC abre o diálogo |
| #33 Sprint na montaria | NÃO POSSÍVEL | VIÁVEL (protótipo) | BDS: duplo toque liga o sprint, com fôlego e aceleração; a tecla de correr montado não chega (`isSprinting=false`) |
| #79 Teia nas aranhas | NÃO POSSÍVEL | VIÁVEL | BDS: `block_movement_slowdown_immunity` faz a sonda cair 10,2 blocos contra 0,31; exige format 1.26.50 |
| NPC escondido por jogador | NÃO POSSÍVEL | VIÁVEL (protótipo) | BDS: `player_update_entity_overrides` só para o escondido; `TextPrimitive` só para quem vê |
| #38 Freelook | NÃO POSSÍVEL | APROXIMAÇÃO | `setControlScheme(PlayerRelative)` → `clientbound_controls_scheme player_relative` |
| #38 Roll da câmera | NÃO POSSÍVEL | NÃO POSSÍVEL na câmera nativa; spline com z a conferir no cliente | Presets Vector2; só `RotationKeyFrame` é Vector3 |
| #31 Pokédex na estante | NÃO POSSÍVEL | PROVÁVEL VIÁVEL (conferir no cliente) | Tag `minecraft:bookshelf_books` |
| #30 Pinturas | NÃO POSSÍVEL | APROXIMAÇÃO (entidade própria) | Registro de pintura é só do Java |
| #99/#113 Enfermeira | NÃO POSSÍVEL | APROXIMAÇÃO (override do `villager_v2` + script) | POI data-driven só experimental (26.50) |
| #136 Fazendeiro e sementes | NÃO POSSÍVEL | APROXIMAÇÃO (script) | `harvest_farm_block` sem lista |
| #146 Livro de receitas | NÃO POSSÍVEL | APROXIMAÇÃO (grupos do catálogo) | O livro usa o catálogo criativo |
| Estruturas vanilla como condição | PARCIAL | APROXIMAÇÃO por assinatura de blocos | `getGeneratedStructures` só no beta |
| #114 Vilas vanilla | NÃO POSSÍVEL | NÃO POSSÍVEL (confirmado) | Doc oficial: vila = jigsaw legado |
| Skin de jogador no NPC | NÃO POSSÍVEL | NÃO POSSÍVEL (confirmado) | Skin só no gametest beta |

## Pedidos a outras frentes

> Produção A: os pedidos 1 a 3 abaixo foram feitos pela própria frente limites-a, com aprovação do usuário (ver
> "Produção A").

1. **social** (`scripts/npc/index.ts`, `beforeEvents.playerInteractWithEntity` do NPC): antes do `system.run`, sair
   se o jogador não deve ver o NPC (`shouldHideFrom`, hoje em `scripts/experimental/limits/NpcHide.ts`).
   Motivo: o handler abre o diálogo mesmo com outro assinante cancelando.
2. **importador / entidades** (`tools/importer/entities.ts`), três pedidos:
   - teia: `minecraft:block_movement_slowdown_immunity {"blocks":["minecraft:web"]}` nas 8 espécies com
     `immuneToCobwebBlock`, com `format_version` 1.26.50 e `minecraft:pushable` →
     `pushable_by_entity`/`pushable_by_block`;
   - montaria: exportar `walkSpeed` em `RideStyleInfo` (sprint);
   - NPC: propriedade `cobblemon:npc_hidden` e `part_visibility` no NPC gerado.
3. **motor** (`scripts/entity/Riding.ts`): adotar `SprintLogic.ts` no estilo LAND e o freelook como modo de câmera.

## Produção A (frente limites-a)

Protótipos promovidos a código de produção, **ligados por padrão** e acionados pelos mesmos dados do Java. BDS próprio:
`COBBLEMON_DIST=dist-lima COBBLEMON_BDS=lima COBBLEMON_BDS_PORT=19154 COBBLEMON_BDS_TRANSPORT=raknet
COBBLEMON_BDS_ONLINE_MODE=false` (BDS 1.26.52.3). Cenário: `tests/e2e/experimental/limites.e2e.mjs` (✓, 130 s, sem
ERROR/WARN no log nem no content log). Container removido no fim.

Os `cblimits:on|off|npc_model|freelook|...` saíram. Em `scripts/experimental/limits/index.ts` ficaram só as sondas
(`npc_model_info`, `npc_hide`, `npc_hide_info`, `input_probe`, `ride_camera_info`, `camera_roll_test`, `web_fall`,
`item_tags`). Elas só respondem com `/scriptevent cobblemon:debug_probes on`, dado pelo console.

### Arquivos

| Arquivo | Mudança |
|---|---|
| `scripts/npc/PokemonModel.ts` (novo) | Entidade de exibição da espécie montada no NPC; cabeça, clique, dano, limpeza e recriação |
| `scripts/npc/PokemonModelData.ts` (novo) | Regras puras: espécie pelo resourceIdentifier, escala, hitbox, rotação |
| `scripts/npc/NpcHide.ts` (novo) | NPC escondido por jogador (override por jogador, rótulo `TextPrimitive`, clique e dano) |
| `scripts/npc/NPCEntity.ts` | `npcAppearanceHooks`, `resourceIdentifier`, `pokemonModelSpecies`, `defaultHitbox` (hitbox da espécie), aviso em `refreshSkin`/`applyDimensions` |
| `scripts/npc/NPCEditor.ts` | Só grava a hitbox se o jogador mudou o que o editor mostrou |
| `scripts/npc/index.ts` | A correção de 1 linha pedida à frente social (`if (shouldHideFrom(target, player)) return;`) + `startNpcPokemonModels()`/`startNpcHide()` |
| `scripts/entity/RideSprint.ts` (novo) | Port puro do HorseBehaviour (handleSprinting, tickStamina, velocidade, FOV, barra) |
| `scripts/entity/RideCameraRoll.ts` (novo) | Câmera perseguidora com roll (modo `roll`, desligado por padrão) e a sonda do roll |
| `scripts/entity/Riding.ts` | Sprint na terra (`tickRideSprint`), modos de câmera `freelook` e `roll`, barra de fôlego |
| `scripts/entity/index.ts` | `system.runInterval(tickRideSprint, 1)` |
| `scripts/experimental/limits/index.ts` | Só sondas, atrás de `debug_probes` (protótipos apagados) |
| `tools/importer/npcs.ts` | Propriedade `cobblemon:npc_hidden`, `part_visibility` e grupo/eventos `cobblemon:npc_model_seat` no NPC gerado |
| `tools/importer/entities.ts` | `sprint`/`walkSpeed` no LAND; aranhas em 1.26.50 com `block_movement_slowdown_immunity` e `migratePushable` |
| `tools/importer/items.ts` | `vanillaItemTagsFor`: `minecraft:bookshelf_books` pelas tags vanilla do Cobblemon |
| `tests/limites.test.ts` | 25 testes |
| `tests/e2e/experimental/limites.e2e.mjs` | Cenário da produção |
| Removidos | Overlays `behavior_packs/.../entities/npc/npc.json`, `resource_packs/.../render_controllers/npc/cobblemon_npc.render_controllers.json` e `behavior_packs/.../entities/experimental/limits_web_probe.json`. Isso zera o erro "render controller duplicado" do `npm run validate` |

### Itens

| Item | Status | Como liga (dado do Java) | Evidência (BDS/E2E) | Conferir no cliente |
|---|---|---|---|---|
| #53/§8 NPC com modelo de Pokémon | FEITO (aproximação: entidade de exibição) | resourceIdentifier efetivo de espécie: classe/preset, behaviour `cobblemon:npc/resource_identifier` (editor `/npcedit`, variável `resource_identifier`, padrão `cobblemon:pikachu` como no Java) ou MoLang `q.entity.set_resource_identifier(...)`; `player_textured` vence | Pelo editor: `rid=cobblemon:pikachu … hitbox=0.66x1.22 exibição=cobblemon:pikachu modo=ride montada=true dist=0.000 escala=1.875 nameTag=""`; o bot recebe `npc_hidden=1`; cabeça `cabeça_npc=(0,-90) rot_exib=(0,-90)`; os cliques na exibição e no NPC abrem o diálogo; a troca para `cobblemon:bulbasaur` remove o Pikachu; depois de reiniciar o servidor, e de descarregar e recarregar o chunk (tickingarea), volta 1 exibição montada | Se o modelo do NPC some por inteiro; se o Pokémon anda (ver "Limites") |
| NPC escondido por jogador | FEITO | Dados MoLang `get_npc_data(npc).hide == 1` (o mesmo do Java); SEE_HIDDEN_NPCS = tag `cobblemon_see_hidden_npcs` | `esconde=true aplicado=true` só para Lim; Lim recebeu 2 `player_update_entity_overrides` (NPC `npc_hidden`, exibição `scale_modifier`), Viz nenhum; `rótulo=true nameTag=""`; forms ao clicar: **Lim=0 Viz=1**; ao desligar, o nameTag volta | Se o rótulo aparece na altura certa; se a exibição encolhida some de fato |
| #33 Sprint na montaria | FEITO | LAND `cobblemon:land/horse` com `canSprint` (54 espécies); duplo toque para frente em 7 ticks | Andar `vel=0.027` (**1,2 b/s** medidos); duplo toque → `sprint=true`, 1,8 → **7,1 b/s** em 2,2 s, fôlego 1 → 0,977, para ao soltar; controle (analógico 0,8) e toque também correm | Sensação do FOV |
| #33 FOV do sprint | FEITO | `rideFovMultiplier` 1,15 | Pacote cru decodificado: ao correr `fov=80.5 ease=0.25 out_sine clear=false`; ao parar `clear=true` (volta ao FOV do jogador) | A base 70 é suposição: a API só aceita valor absoluto e não lê o FOV do jogador |
| #33 Barra de fôlego | FEITO (actionbar) | `setRideBar` do HorseBehaviour (a barra de pulo mostra o fôlego) | Código + teste (10 blocos, cores) | Visual |
| #79 Aranhas imunes à teia | FEITO | `behaviour.blockInteract.immuneToCobwebBlock` (8 espécies) | Coluna 3×3 de 10 teias: spinarak, galvantula e ariados caem **10,2**; caterpie **0,46**. Boot e content log sem erro com as 8 em `format_version` 1.26.50 | — |
| #31 Pokédex na estante entalhada | FEITO (tag) | `data/minecraft/tags/item/bookshelf_books.json` = `#cobblemon:pokedex` | `ItemStack.getTags()` no BDS: `cobblemon:pokedex, minecraft:bookshelf_books` (mesma tag do `minecraft:book`); `give` aceita os 7 itens | Pôr a Pokédex na estante: o bot não clica em bloco |
| #38 Freelook | FEITO (aproximação) | `/scriptevent cobblemon:ride_camera freelook`: órbita em todos os estilos + `ControlScheme.PlayerRelative` | `clientbound_controls_scheme player_relative` ao ligar e `locked_player_relative_strafe` ao voltar para `auto`; `getControlScheme()=PlayerRelative` | Como a montaria reage a A/D. Não é "segurar a tecla" |
| #38 Roll da câmera | CÓDIGO PRONTO, **DESLIGADO** por padrão | Só no modo `/scriptevent cobblemon:ride_camera roll` | O servidor aceita a spline com z (`camera_roll_test`) | Se o z da spline rola a tela; se a perseguidora por splines é jogável |

### Limites que ficam

- **Animação de andar** da exibição montada: o Pokémon usa `q.ground_speed`/`q.modified_move_speed`, e não há
  documentação sobre esses valores num passageiro. Se no cliente o Pokémon ficar parado enquanto o NPC anda, o plano
  da pesquisa (§1, item 3) é criar uma propriedade `cobblemon:display_moving` no `pre_animation` dos Pokémon.
  Isso não foi feito sem o cliente para confirmar.
- **Cabeça:** a exibição gira o corpo inteiro para onde o NPC olha. A rotação só da cabeça (`q.head_*`) não tem API.
- **NPC escondido:** a sombra e o empurrão físico continuam (sem API por jogador). A exibição encolhe a 5% em vez de
  sumir.
- **Hitbox:** no Java, a hitbox do NPC continua a da classe. Aqui ela vira a da espécie no tamanho desenhado
  (pedido da frente), salvo `set_hitbox`/editor.
- **Batalha:** o clique na exibição passa pelo mesmo `tryPromptNPCBattle` do NPC, e `in_battle` é espelhado na
  exibição (pose de batalha). O E2E só cobriu diálogo; não houve batalha de treinador com modelo de Pokémon.
- A tecla de correr não chega ao script montado (pesquisa 8 §2). O gatilho é o duplo toque, o mesmo do Java.

### Pedido a outra frente

1. **orquestrador / motor** (`scripts/events/ScriptEvents.ts`, dicionário `scriptIDDictionary`): acrescentar
   `"cobblemon:ride_camera": function () { },`, como já existe para `cobblemon:battle_ui_mode`. Motivo: o comando é
   tratado em `scripts/world/index.ts`, mas o dicionário responde `§4ScriptEvent cobblemon:ride_camera is invalid!` ao
   jogador. Visto no E2E ao ligar o freelook, e é anterior a esta frente.

### Verificação

- `npm run import`: ok. As 8 aranhas saem em 1.26.50; `pokedex_*` com `minecraft:bookshelf_books`; 54 estilos LAND
  com `sprint`.
- `npm run validate`: **OK, nenhum erro**. O "render controller duplicado" era do overlay removido.
- `npx tsc -p tsconfig.json`: 0 erros.
- `npm test`: todos passam (`limites: 25 testes ok`).
- BDS `lima`: boot, E2E e reinício sem nenhum ERROR/WARN de conteúdo ou script desta frente. O único ERROR do boot é
  o aviso de transporte do RakNet dos bots. Os avisos no content log são de rodadas anteriores às correções (nome do
  bot na sonda e ordem do freelook).

## Produção B (frente limites-b)

Aproximações aprovadas da pesquisa 8 (§7–§11), ligadas por padrão e movidas pelos dados do Java. BDS próprio:
`COBBLEMON_DIST=dist-limb COBBLEMON_BDS=limb COBBLEMON_BDS_PORT=19155 COBBLEMON_BDS_TRANSPORT=raknet` (BDS 1.26.52.3).
Sondas `cobblemon:limb_*` (só console, com `scriptevent cobblemon:debug_probes on`; lista em `scripts/limitesB/probe.ts`).
Cenário E2E avulso: `tests/e2e/experimental/limites-b.e2e.mjs` (✓, 83 s). Container removido no fim.

O mundo `.bds-limb/worlds/cobblemon` (criado antes desta rodada) ficou com chunks que não carregam depois de um
watchdog causado por uma sonda (corrigida). Ele foi **movido** para `.bds-limb/worlds/cobblemon.bak-limb-crash`, não
apagado; o E2E e as últimas sondas rodaram num mundo novo.

### Arquivos

| Arquivo | Mudança |
|---|---|
| `scripts/limitesB/{index,paintings,paintingLogic,nurse,nurseLogic,farmer,farmerLogic,vanillaStructures,structureSignatures,probe}.ts` (novos) | Pinturas, Enfermeira, fazendeiro, estruturas vanilla e sonda |
| `tools/importer/limitesB.ts` (novo) | Grupos de receita no catálogo (+ `menu_category` dos blocos), entidade/geometria/render controller/texturas da pintura, trocas e texturas da Enfermeira, `generated/scripts/limitesB.ts` |
| `behavior_packs/.../entities/vanilla_overrides/villager_v2.json` (novo) | Cópia do `villager_v2` do bedrock-samples **v1.26.50.4** (idêntico ao vanilla_1.26.20 do BDS 1.26.52) + propriedade `cobblemon:nurse_joy`, grupos `cobblemon:nurse`/`nurse_schedule`/`nurse_work`, eventos `cobblemon:become_nurse`/`unbecome_nurse`/`schedule_work_nurse`, os `minecraft:become_*` e `schedule_*` tirando os grupos da enfermeira, e as 9 sementes da tag nos `shareables` do `work_schedule_farmer`. Os comentários do original se perderam (JSON regravado) |
| `resource_packs/.../entity/limites_b/villager_v2.entity.json` (novo) | Client entity do bedrock-samples v1.26.50.4 + texturas `cobblemon_nurse`/`cobblemon_nurse_joy` e índice de profissão 15/16 |
| `resource_packs/.../render_controllers/limites_b/cobblemon_villager.render_controllers.json` (novo) | Cópias do `villager_v3_masked`/`_level` com a enfermeira no fim do array (os vanilla não mudam) |
| `resource_packs/.../texts/{en_US,pt_BR}.lang` | Seção `## limites-b`: nome da Enfermeira, da pintura e dos 44 grupos de receita |
| `scripts/world/StructureRegistry.ts` (frente motor) | 3 ganchos: `registerStructureTag`, `getStructuresAt(..., only)` (só roda as consultas dos ids pedidos) e `isDetectableStructure` aceita ids com consulta preguiçosa |
| `scripts/main.ts` | 1 import + `startLimitesB()` no `worldLoad` |
| `tools/importer/index.ts` | 1 import + `emitLimitesB(!contentOnlyPokemon)` depois do catálogo |
| `tests/limites-b.test.ts` (novo) | 17 testes |
| `tests/mocks/minecraft-server.ts` | + export `BlockTypes` |
| `tests/e2e/experimental/limites-b.e2e.mjs` (novo) | Pintura com jogador, trocas da Enfermeira e do fazendeiro vanilla |

### Itens

| Item | Status | Como funciona (dado do Java) | Evidência (BDS/E2E) | Desvio do Java / conferir no cliente |
|---|---|---|---|---|
| #30 Pinturas do Cobblemon | FEITO (aproximação: entidade própria) | `painting_variant` + tag `placeable`: altar 4×2, nomad 2×2, premonition 2×1, slumber 3×2. O clique do item **Pintura vanilla** numa parede refaz o `Painting.create` (variantes que cabem → maior área → sorteio) com as 47 vanilla do Bedrock + as 4; se sair do Cobblemon, o clique é cancelado e entra `cobblemon:painting` (gasta 1 item fora do criativo); se sair vanilla, o Bedrock segue sem mudança | 900 sorteios por parede: 3×2 → `slumber 900`; 4×2 → `vanilla 750 / altar 150` (1/6); 2×2 → `800/100` nomad (1/9); 2×1 → `750/150` premonition; 4×4 → `vanilla 900`. 1 clique = 2–4 ms. Colocação nos 4 lados (`axis` 0/1, 1/32 à frente da parede); sobreposição recusada. Tirar um bloco da parede → cai em ≤100 ticks e solta `minecraft:painting`; TNT → cai e solta; golpe de bot **sobrevivência → solta, criativo → não solta**; reinício do servidor → as 4 voltam com o mesmo id, variante, eixo e registro | A variante vanilla sorteada pelo Bedrock pode diferir da nossa conta (o motor não expõe o sorteio). O Bedrock não coloca as nossas nas estruturas (Java também não). Conferir no cliente: o clique real (o bot não clica em bloco), imagem/orientação da placa e se a caixa de acerto (`custom_hit_test` por coluna) cobre a pintura toda |
| #99/#113 Enfermeira | FEITO (aproximação: override do villager_v2 + script) | AcquirePoi: desempregado (família `unskilled`) a até 48 blocos (±16 na vertical) de uma Healing Machine livre vira enfermeira; WorkAtPoi: a cada 300 ticks, 50%, a ≤1,73 do centro da máquina → som `cobblemon.entity.villager.work_nurse` + `minecraft:resupply_trades`; ResetProfession: máquina quebrada → perde a estação, e volta a desempregada se nunca negociou; `move_to_block` leva à máquina no horário de trabalho; Joy pelo nome (`endsWith`, sem §) | `famílias=cobblemon_nurse,mob,villager variant=15 estação=...|1005,100,1045`; estável por 2,5 min com um composter do lado (o motor não troca a profissão); 2 máquinas → 2 enfermeiras; máquina quebrada → `reset 1`, volta a `unskilled variant=0`; `joy=true` para "Joy"; `workSounds=5 restocks=5`. E2E: `update_trade display=entity.villager.cobblemon.nurse` com as ofertas do Java (oran berry, medicinal leek→esmeralda, mint leaf, medicinal brew+frasco, mulch base, frasco, revival herb, vivichoke seeds, vivichoke dip+tigela, paralyze heal); depois de abrir as trocas, quebrar a máquina **não** tira a profissão; o fazendeiro vanilla abre `entity.villager.farmer` com as trocas vanilla | Horário de trabalho do Bedrock (0–8000 e 10000–11000), não o 2000–9000 do Java. "Negociou" = abriu a tela de trocas (o script não lê a XP de troca). Sem posse de POI do motor: `move_to_block` vai à máquina mais próxima, não necessariamente à dela. Enfermeira zumbificada e curada não volta enfermeira (o zumbi vanilla não conhece a profissão). Conferir no cliente: textura nurse/nurse_joy sobre o bioma e o selo de nível |
| #136 Fazendeiro e sementes do Cobblemon | FEITO (aproximação: shareables + script) | `villager_plantable_seeds` (9 itens) nos `shareables` do fazendeiro (pega do chão, `VillagerGatherableItems`); a cada 40 ticks, no horário de trabalho e com `mobGriefing`, cada fazendeiro olha o 3×3×3 (HarvestFarmland): colhe planta madura do Cobblemon (`setblock … destroy`, hearty grains pelas duas metades) ou planta no ar sobre farmland a primeira semente da tag no inventário (vanilla primeiro = o Bedrock planta) | Red mint `age=7` e hearty grains maduro colhidos; o fazendeiro **pegou do chão** `hearty_grains×2` e `red_mint_seeds` (leaf fica no chão); plantou na ordem do inventário (`hearty_grains` antes de `red_mint_seeds`); vivichoke `age=3` não foi tocado. Passe: 3–7 ms com 3 fazendeiros agindo; filtro de 1 `containsBlock` por fazendeiro quando não há nada do Cobblemon por perto | O fazendeiro não anda até as plantas do Cobblemon (o `harvest_farm_block` só procura as vanilla): age quando passa perto. Medicinal leek (água) e bugwort (não portado) ficam de fora |
| #146 Livro de receitas agrupado | FEITO (aproximação: grupos do catálogo) | O livro do Bedrock usa o catálogo: os itens com o mesmo `group` das receitas Java (≥ 2 na mesma aba) viram 44 subgrupos `cobblemon:recipe_group.<group>` logo depois do grupo da aba (red_mints, basic_balls, gilded_chest, plaque, evolution_stone_from_block…). Os blocos levam o grupo novo no `menu_category` | Catálogo sem item duplicado nem perdido (teste); boot sem os avisos "The item … is now being set to …" (apareciam antes de acertar o `menu_category` de 98 blocos); `npm run validate` OK | Os grupos também aparecem no inventário criativo (o Bedrock usa a mesma lista; não dá para agrupar só no livro). **Busca "poke" = "poké": NÃO POSSÍVEL** — a busca é do cliente, sem sinônimos por pack (o Java usa `SearchTreeMixin`). Conferir no cliente se a busca ignora acento |
| Estruturas vanilla como condição | FEITO (aproximação: assinatura de blocos por chunk) | 14 assinaturas (monumento, cabana da bruxa, iglu, mansão/woodland_mansion, posto avançado, ruínas de trilha, ruína oceânica fria/morna, portal em ruínas, cidade ancestral, cidade do End, fortaleza, bastião, fóssil do Nether) + tags `#minecraft:ocean_ruin`/`ruined_portal`/`shipwreck`. Consulta preguiçosa no `StructureRegistry` só para os ids pedidos, só na dimensão/bioma da estrutura (bioma do topo da coluna para as de superfície), 1–3 `containsBlock` num volume de ~16×40×16; positivo vai para o registro persistente, negativo fica 10 min em cache | Com `/locate` em dois mundos: **monumento, posto avançado, ruína oceânica, portal em ruínas, ruínas de trilha, cidade ancestral, mansão (pale_garden e roofed_forest), fortaleza, bastião e cidade do End → `true`**; planície → `false` para monumento/posto/trilha/portal/cidade; posto dentro da mansão → pulado pelo bioma; `#minecraft:shipwreck` → `undefined` (como antes). Os 41 ids de bloco das assinaturas existem no 1.26.52 (`BlockTypes.get`) | Cabana da bruxa e iglu só testados em teste unitário (nenhum a distância razoável nos 2 mundos). Um chunk conta se tem blocos da assinatura (± margem), não pela caixa exata do Java. **Naufrágio e poço do deserto ficam sem detector** (assinatura fraca, como a pesquisa pediu): a condição não é cumprida |

### Pedidos a outras frentes

1. **motor** (`scripts/world/StructureRegistry.ts`): os 3 ganchos acima já estão no arquivo (mudança mínima, retrocompatível;
   `tests/motor.test.ts` passa). Revisar/adotar.
2. **mundo-detalhes** (`tools/importer/mundoDetalhes.ts`, catálogo): o catálogo gerado por eles é reprocessado depois
   por `tools/importer/limitesB.ts` (subgrupos de receita). Se o catálogo mudar de formato, manter o prefixo
   `cobblemon:itemGroup.` nos grupos de aba.
3. **orquestrador**: o override do `villager_v2` (BP e RP) precisa ser refeito a cada versão do Minecraft que mudar o
   aldeão (mesmo risco dos outros overrides vanilla).

### Verificação

- `npm run import`: ok (`grupos de receita: 44`, `blocos com o grupo de receita: 98`, `pinturas: 4`, `trocas da enfermeira: 21`).
- `npm run validate`: **OK, nenhum erro**.
- `npx tsc -p tsconfig.json`: 0 erros.
- `npm test`: todos passam (`limites-b: 17 testes ok`).
- BDS `limb`: boots, sondas, reinício e E2E sem nenhum ERROR/WARN de conteúdo ou script desta frente (os ERROR do log
  são o aviso de transporte RakNet e saídas de comando como "No targets matched selector"). Um watchdog de 11 s veio
  de uma sonda de 900 sorteios síncronos, antes do cache de blocos; corrigido (900 sorteios = 180 ms).
