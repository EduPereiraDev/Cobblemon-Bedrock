# Pesquisa 8: limites do Bedrock (itens "NÃO POSSÍVEL" revistos)

> Status: **concluída (v1)**. Data: 2026-09-26.
>
> **Restrições:** só APIs estáveis (`@minecraft/server` **2.10.0**, `@minecraft/server-ui` **2.2.0**), JSON UI e
> recursos de pack estáveis, sem toggles experimentais (Realms e consoles).
>
> **Protótipos:** ficam em `scripts/experimental/limits/` e estão **desligados por padrão**. No carregamento, o
> `main.ts` só registra a escuta do namespace `cblimits:`. Cada protótipo liga com `/scriptevent cblimits:on <nome>`
> (lista completa em `scripts/experimental/limits/index.ts`).
>
> **Ambiente de teste:**
> - BDS próprio **1.26.52.3**: `cobblemon-bds-limites`, UDP 19152, RakNet, `online-mode=false`. O container foi
>   removido no fim.
> - Bots de protocolo: `tests/e2e/experimental/limites.e2e.mjs` (cenário avulso, fora da suíte normal).
> - Os bots não renderizam. Tudo que é **visual ou câmera** está marcado como "conferir no cliente".
>
> **Verificação:** `npx tsc -p tsconfig.json` sem erros; `npm test` passando, com `tests/limites.test.ts` (12 testes)
> e os protótipos desligados.

## Resumo

| # | Item | Veredito | Fidelidade esperada | Esforço |
|---|---|---|---|---|
| 53 / §8 | NPC com modelo de Pokémon | **VIÁVEL**: entidade de exibição da espécie presa ao NPC (montada ou seguindo), modelo do NPC oculto por propriedade | Alta: modelo, variante, escala, nome, diálogo, batalha e hitbox da espécie. Faltam a cabeça que olha e as animações de ação do NPC | M |
| 33 | Sprint na montaria terrestre | **VIÁVEL**: duplo toque para frente (o gatilho do próprio Java), com fôlego, aceleração e FOV do HorseBehaviour | Alta no teclado e no toque; no controle é o duplo toque no analógico. A tecla de correr não chega montado (provado) | P |
| 79 | Aranhas imunes à teia | **VIÁVEL**: `minecraft:block_movement_slowdown_immunity` (estável no 26.50) | Exata | P (exige format 1.26.50 nas 8 espécies) |
| — | NPC escondido por jogador | **VIÁVEL**: override de propriedade por jogador + `TextPrimitive` com `visibleTo` + interação cancelada | Alta: modelo, nome e clique somem só para quem deve. Sombra e empurrão ficam | P–M |
| 38 | Freelook na montaria | **APROXIMAÇÃO**: `Player.setControlScheme(PlayerRelative)` no preset `follow_orbit` | Média: câmera livre com o mouse, montaria virando por A/D (não é "segurar tecla") | P |
| 38 | Roll da câmera | **APROXIMAÇÃO fraca / conferir no cliente**: só o `RotationKeyFrame` (Vector3) das splines tem eixo z | Baixa: a câmera perseguidora por splines tem atraso de rede; o roll visual do modelo (já feito) continua sendo o principal | M (se o z rolar) |
| 31 | Pokédex na estante entalhada | **PROVÁVEL VIÁVEL**: tag de item `minecraft:bookshelf_books` na Pokédex (o Java faz o mesmo) | Exata, se o motor respeitar a tag em item custom | P (conferir no cliente) |
| 30 | Pinturas crossover | **APROXIMAÇÃO**: entidade "pintura" própria colocada no lugar de parte das pinturas vanilla | Média: sorteio e tamanhos fiéis, mas não é a entidade `painting` | M |
| 99 / 113 | Enfermeira (profissão, trocas, `work_nurse`) | **APROXIMAÇÃO**: override do `villager_v2` com grupo "enfermeira" atribuído por script perto da Healing Machine | Média: trocas, nome, som e textura; sem posse de job site (POI é experimental no 26.50) | M–G |
| 136 | Fazendeiro planta sementes do Cobblemon | **APROXIMAÇÃO**: `shareables` + tarefa de script que planta e colhe | Média | M |
| 146 | Livro de receitas agrupado | **APROXIMAÇÃO**: grupos do `crafting_items_catalog` iguais aos `group` das receitas Java | Média: o agrupamento sai; a busca "poke" = "poké" não (conferir se a busca ignora acento) | P |
| — | Estruturas vanilla como condição | **APROXIMAÇÃO** por blocos-assinatura (como a vila) | Média para monumento, cabana, iglu e mansão; fraca para naufrágio | M |
| 114 | Injeção nas vilas vanilla | **IMPOSSÍVEL** (doc oficial); a adaptação atual continua | — | — |
| — | Skin de jogador no NPC | **IMPOSSÍVEL** no estável (skin só em `@minecraft/server-gametest`, beta) | — | — |

## 1. NPC com modelo de Pokémon (#53, §8)

### Como é no Java

O NPC desenha o modelo que o `resourceIdentifier` indica:
- `NPCRenderer.getTextureLocation` → `VaryingModelRepository.getTexture(entity.resourceIdentifier, …)`
  (`client/render/npc/NPCRenderer.kt:24-26`);
- `render` → `VaryingModelRepository.getPoser(entity.resourceIdentifier, …)` e as camadas
  (`NPCRenderer.kt:45-52`).

O repositório é o mesmo dos Pokémon. Por isso `resourceIdentifier = "cobblemon:bulbasaur"` desenha o Bulbasaur com
poser, camadas e animações. A entidade continua sendo o `NPCEntity`: IA, hitbox da classe ou do NPC
(`hitbox`/`hitboxScale`), nome (`hideNameTag`), diálogo, batalha, escala `renderScale × modelScale`
(`NPCRenderer.kt:29-31, 55-58`) e item na mão.

O `resourceIdentifier` vem da classe ou é forçado pelo editor/datapack (`entity/npc/NPCEntity.kt:115, 187`).
Nenhum preset do 1.8.2 usa espécie: o `grep` em `data/cobblemon/{npcs,npc_presets}` volta vazio.

### Opções avaliadas

| Opção | Resultado |
|---|---|
| Todas as espécies na client entity do NPC (geometria por `Array.geos[q.property(...)]`) | **Descartada.** São 894 client entities de Pokémon (4,5 MB), e só o `pre_animation` do Pikachu tem ~50 KB de MoLang. Todo NPC avaliaria scripts e animações de todas as espécies, e o limite de 32 propriedades e as condições de animação somariam milhares de entradas. Não há limite documentado, mas o custo por quadro é proibitivo. |
| Trocar o tipo da entidade (a lógica de NPC num `cobblemon:<espécie>`) | **Descartada.** Os sistemas de Pokémon (spawner, captura, limpeza, `setupCobblemon`, batalha de Pokémon) disparam pelo tipo e pela família `pokemon`. |
| **Entidade de exibição da espécie presa ao NPC** | **Escolhida.** É o mesmo padrão do disfarce de batalha (`battle/effects/Mock.ts`) e do estúdio (`ui/studio/Studio.ts`), que já resolvem as colisões apontadas em 2026 com a tag `cobblemon_ui_display`. |

A entidade de exibição funciona assim:
- o `main.ts` não cria dados de selvagem para ela;
- o `entityLoad` a remove quando o chunk recarrega, e o protótipo a recria a partir do NPC;
- a interação e o dano são repassados ao NPC.

### Protótipo: `scripts/experimental/limits/NpcPokemonModel.ts`

Comando: `/execute as <npc> run scriptevent cblimits:npc_model <espécie> [ride|follow]` (`off` desfaz). Liga com
`cblimits:on npc_model`.

**Pack** (arquivos novos, mesclados pelo build; nada muda enquanto nada é ligado):
- propriedade `cobblemon:npc_hidden` (bool, `client_sync`, padrão false) em `behavior_packs/…/entities/npc/npc.json`;
- `part_visibility: [{"*": "!q.property('cobblemon:npc_hidden')"}]` no render controller do NPC
  (`resource_packs/…/render_controllers/npc/cobblemon_npc.render_controllers.json`);
- grupo `cobblemon:npc_model_seat` (`minecraft:rideable`, 1 assento na origem, `lock_rider_rotation: 0`, família
  `pokemon`), ligado só pelo evento `cobblemon:npc_model_seat_on`.

**Script:**
- `spawnEntity("cobblemon:<espécie>", { spawnEvent: "cobblemon:interacted" })` + tag do estúdio + tag
  `cobblemon_npc_model`;
- variante pelos aspects do NPC (`resolveVariant`) e `scale_modifier` = `renderScale` do NPC;
- hitbox do NPC trocada pela da espécie, e a anterior guardada para desfazer;
- no modo **ride**, `rideable.addRider(exibição)` 5 ticks depois do evento. Com 1 tick falha: o grupo ainda não
  entrou. Se falhar de novo, cai para **follow**, que teleporta a exibição a cada tick.

**Evidência (BDS + bot, rodada 4 do cenário):**
- ride: `exibição=cobblemon:pikachu … modo=ride montada_em=<id do NPC> dist=0.000 oculto=true`;
- o bot recebe a propriedade do NPC com `{"index":1,"value":1}`, ou seja, `npc_hidden=true` sincronizado;
- clicar no Pikachu abriu o diálogo do NPC (`[{cobblemon.port.dialogue.continue}]`), e clicar no NPC com a hitbox
  da espécie também;
- follow: `dist=0.000`, mesmos cliques abrindo o diálogo;
- log sem ERROR/WARN do protótipo.

### Conferir no cliente

- Se o modelo do NPC some por inteiro (`part_visibility` com `*`).
- Se a animação de andar do Pokémon toca como passageiro (ride) ou teleportado (follow). O Pokémon usa
  `q.ground_speed > 0.3 || q.modified_move_speed > 0.1`, e não há documentação sobre esses valores num passageiro.

### Veredito e plano: **VIÁVEL**

1. **Frente NPC/social:** `NPC.setResourceIdentifier` com id de espécie (`getEntityInfo(id)` existe) liga o modo
   exibição. Isso substitui o protótipo e troca o comando pelo `resource_identifier` do editor/MoLang.
2. **Importador (`tools/importer/entities.ts`):** deixar a propriedade e o `part_visibility` no NPC gerado, e
   gerar o grupo de assento.
3. **Animação:** se o teste no cliente mostrar o passageiro parado, adicionar ao `pre_animation` dos Pokémon
   `v.cobblemon_moving = … || q.property('cobblemon:display_moving')`. É uma propriedade nova e há folga: os
   Pokémon têm 10 de 32. O script liga a propriedade quando o NPC anda.
4. **Cabeça:** copiar a rotação da cabeça do NPC para a exibição. No modo follow isso sai por `teleport` com
   rotação. No modo ride, testar `lock_rider_rotation` ≠ 0.
5. **Batalha do NPC:** as animações de ação (`send_out`, `win`…) não existem no poser do Pokémon, e no Java também
   não tocam num modelo de Pokémon. Nada a fazer.
6. **Limites que ficam:** a sombra e o nome usam a hitbox do NPC (como no Java). O scanner da Pokédex pode
   "ver" a exibição, então é preciso ignorar a tag `cobblemon_npc_model`.

## 2. Sprint na montaria terrestre (#33)

### Como é no Java

`api/riding/behaviour/types/land/HorseBehaviour.kt`:
- **Gatilho** (`handleSprinting`, :141-178): `tryingToSprint = (keySprint && keyUp) || duploToque`. O duplo toque
  usa um timer de 7 ticks ("Emulate vanillas tick timer length").
- **Parar e rearmar:** o sprint para ao soltar a frente ou com o fôlego em 0. Depois de zerar, só volta a funcionar
  com fôlego > 0,33.
- **Fôlego** (`tickStamina`, :184-197): gasta `(1/staminaExpr)/20` por tick correndo e recupera 8× isso.
  `staminaExpr = q.get_ride_stats('STAMINA','LAND',240,4)` (`data/cobblemon/ride_settings/horse.json`).
- **Velocidade** (:287-293): topo `speedExpr` correndo e `getWalkSpeed` (= walkSpeed × 0,7 × 0,42 b/tick, :393-398)
  andando. Aceleração `accelerationExpr` (0,1 a 12 s).
- **FOV:** `rideFovMultiplier` = 1,15 correndo (:470-476).

### Fontes

- `InputButton` só tem `Jump`/`Sneak` de 1.18.0 até 2.10.0. Os betas 2.11.0-rc e 2.12.0-beta (26.60 preview.28)
  também não têm `Sprint`:
  - https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/inputbutton?view=minecraft-bedrock-stable
  - https://cdn.jsdelivr.net/npm/@minecraft/server@2.12.0-beta.1.26.60-preview.28/index.d.ts
- `InputPermissionCategory` não tem categoria de sprint (typings 2.10.0).
- Flags `SprintDown`/`StartSprinting` do PlayerAuthInput:
  https://github.com/Sandertv/gophertunnel/blob/master/minecraft/protocol/packet/player_auth_input.go.
  Desde 1.26.40 são uma lista de ordinais (`minecraft-data` 1.26.40, `proto.yml` `InputData`).

### Protótipo: `scripts/experimental/limits/{SprintLogic,RideSprint}.ts`

`cblimits:on ride_sprint` (ou `ride_sprint_fov`), mais `cblimits:on input_probe` para a sonda de entrada.
- `SprintLogic.ts` é o port 1:1 de `handleSprinting`/`tickStamina` + passo de velocidade. Os 8 testes em
  `tests/limites.test.ts` cobrem duplo toque, janela, tecla, zerar/rearmar e aceleração.
- Entrada: frente = `inputInfo.getMovementVector().y > 0,5`; tecla = `player.isSprinting`.
- Andar = `walkMovementValue()`, a fórmula do `getWalkSpeed` convertida como no importador (walkSpeed padrão 0,35
  → 0,038). Topo = `rideValuesFor(...,"LAND").speed` (com ride boosts). O fôlego e a aceleração vêm dos atributos
  com bônus.
- Barra de fôlego na actionbar. FOV opcional com `camera.setFov`, devolvido com `setFov()`.

### Evidência (bot montado num Arcanine)

| Teste | Resultado |
|---|---|
| Andar | `montado=cobblemon:arcanine estilo=LAND move=(0.00,1.00) … vel=0.038` |
| **Duplo toque** (100 ms, solta 200 ms, segura) | `sprint …: LIGOU (frente=true tecla=false fôlego=1.000)`, depois `sprint=true folego=0.999 vel=0.044 → 0.996/0.059 → 0.993/0.074`. Acelera com ACCELERATION 70 = 3,7 s e gasta fôlego |
| **Tecla de correr montado** (flags `sprint_down`, `start_sprinting`, `sprinting`, como o cliente manda) | `montado=cobblemon:arcanine … isSprinting=false`, em todas as amostras |
| Mesmas flags desmontado | `isSprinting=true` (rodada 2) |

Conclusão: o BDS ignora o sprint do jogador montado. A tecla de correr (Ctrl, L3 ou o botão do toque) **não chega
ao script** enquanto se está montado. Isso vem do servidor, não de uma limitação do bot.

No FOV, o bot recebeu um `camera_instruction` na virada do sprint. O `bedrock-protocol` 3.60 não decodifica a
variante com `fov` ("Read error"), então o efeito visual fica para conferir no cliente.

### Veredito e plano: **VIÁVEL**

Duplo toque para frente é o gatilho do próprio Cobblemon (`hasDoubleTapped`) e funciona igual no teclado, no
analógico e no joystick de toque.

1. Mover a lógica para `scripts/entity/Riding.ts`, no estilo LAND, no lugar da velocidade fixa no topo.
2. O importador passa a exportar `walkSpeed` no `RideStyleInfo`, trocando o 0,35 padrão.
3. A barra de fôlego da terra divide a actionbar com a do voo.
4. FOV: ligar só se o teste no cliente mostrar que `setFov()` devolve o FOV do jogador. É o único ponto que pode
   brigar com o FOV configurado.
5. Custo: um loop por tick só para condutores.

## 3. Aranhas imunes à teia (#79)

### Como é no Java

`PokemonEntity.makeStuckInBlock` ignora a teia se `behaviour.blockInteract.immuneToCobwebBlock`
(`entity/pokemon/PokemonEntity.kt:632-636`, `pokemon/ai/BlockBehavior.kt:18`). São 8 espécies: Spinarak, Ariados,
Joltik, Galvantula, Dewpider, Araquanid, Tarountula e Spidops.

### Fonte

- Componente de entidade `minecraft:block_movement_slowdown_immunity {"blocks":["minecraft:web"]}`, schema estável
  1.26.50. É o que a aranha vanilla usa: `Mojang/bedrock-samples` 1.26.50.4, `behavior_pack/entities/spider.json`,
  `metadata/json_schemas/server/entity/1.26.50/`.
- Changelog 26.50: https://www.minecraft.net/en-us/article/minecraft--bedrock-edition-26-50-changelog

### Protótipo e evidência

Entidade de teste `cobblemon:limits_web_probe` (format 1.26.50, grupo com o componente). A sonda
`cblimits:web_probe x y z` solta duas cópias numa coluna de 10 teias:
- `t=20 ticks: fv1.26.50+imune: caiu 10.20 | fv1.26.50: caiu 0.31`;
- `t=60: 10.20 | 0.46`.

Com format **1.21.90**, o dos Pokémon gerados hoje, o BDS recusa a entidade:
`minecraft:block_movement_slowdown_immunity: this component was found in the input, but is not present in the
Schema`. No 1.26.50 também caiu o `minecraft:pushable`, que virou `minecraft:pushable_by_entity` +
`minecraft:pushable_by_block`.

### Veredito e plano: **VIÁVEL**

1. O importador gera as 8 espécies com `format_version` 1.26.50, o componente e a migração do `pushable`.
2. Validar no BDS que nenhum outro componente dos Pokémon cai no schema 1.26.50. Alternativa: subir todos os
   Pokémon para 1.26.50 de uma vez.
3. Remover `WebProbe.ts` e `entities/experimental/limits_web_probe.json` depois.

## 4. NPC escondido por jogador

### Como é no Java

`NPCEntity.broadcastToPlayer` não envia o NPC a quem tem `dados MoLang[npc.uuid].hide == 1`, salvo com a
permissão `SEE_HIDDEN_NPCS` (`entity/npc/NPCEntity.kt:410-427`). Para esse jogador somem tudo: modelo, nome,
sombra, colisão e clique.

### Fontes

- `Player.setPropertyOverrideForEntity`/`removePropertyOverrideForEntity` são estáveis (changelog de script:
  https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/changelog?view=minecraft-bedrock-stable).
  Só propriedades `client_sync`, efeito no próximo tick, só para aquele jogador. O limite de entidades com
  override caiu no 1.21.120 (https://minecraft.wiki/w/Bedrock_Edition_1.21.120).
- `world.primitiveShapesManager` + `TextPrimitive` com `visibleTo` e `attachedTo` são estáveis desde a 2.8.0
  (typings 2.10.0). `visibleTo` vazio = todos.
- A sombra é do motor. Nenhum campo de render controller a esconde por jogador:
  https://wiki.bedrock.dev/visuals/remove-shadows

### Protótipo: `scripts/experimental/limits/NpcHide.ts`

Liga com `cblimits:on npc_hide`; o comando é `/execute as <npc> run scriptevent cblimits:npc_hide <jogador> on|off`.
Usa o mesmo dado do Java (`get_npc_data(npc).hide`, `scripts/npc/PlayerStruct.ts`):
- override de `cobblemon:npc_hidden=true` só para quem não vê;
- nameTag global vazio e um `TextPrimitive` preso ao NPC só para quem vê;
- clique e dano de quem não vê são cancelados;
- reaplicação no `playerSpawn`/`entityLoad`.

### Evidência (2 bots)

- Servidor: `Lim:esconde=true aplicado=true Viz:esconde=false aplicado=false rótulo=true nameTag=""`.
- Só o Lim recebeu o pacote `player_update_entity_overrides` (`{"property_index":1,"type":"set_int",…}`). O Viz não
  recebeu nenhum.
- Só o Viz recebeu um pacote novo, que o `bedrock-protocol` 3.60 não decodifica, logo depois de esconder: o
  `TextPrimitive`.
- Clique: numa rodada o clique do Lim foi bloqueado e o do Viz abriu o diálogo. Em outra, o Lim também abriu.
  Motivo: o handler de interação do NPC (`scripts/npc/index.ts`) agenda o diálogo sozinho, sem olhar o
  `event.cancel` dos outros assinantes.

### Veredito e plano: **VIÁVEL**

1. **Frente social**, em `scripts/npc/index.ts`: no `beforeEvents.playerInteractWithEntity` do NPC, retornar sem
   abrir nada se `shouldHideFrom(target, player)`. Uma linha; pedido registrado em `docs/pendencias/limites.md`.
2. Mover o laço de override e rótulo para `scripts/npc/`.
3. Conferir no cliente se o modelo some (`part_visibility`) e se o rótulo aparece na altura certa.
4. NPC com modelo de Pokémon e escondido: a exibição precisa da mesma propriedade nos Pokémon, com o mesmo
   `part_visibility` no importador.
5. Limites que ficam: a sombra e o empurrão físico continuam para quem não vê.

## 5. Roll da câmera e freelook (#38)

### Como é no Java

- **Roll:** a montaria orientável (jet, bird…) tem um `OrientationController` em quaternion, e a câmera herda o roll
  (`client/RidingCameraInterface.kt`, `mixin/client/CameraMixin.java`).
- **Freelook:** com a tecla `key.cobblemon.ridingfreelook` segurada, o mouse gira só a visão do condutor
  (`mixin/client/MouseHandlerMixin.java:163-203`).

### Fontes

- Presets e `setCamera` só têm yaw/pitch (`CameraSetRotOptions.rotation: Vector2`; presets `rot_x`/`rot_y`):
  https://github.com/MicrosoftDocs/minecraft-creator/blob/main/creator/Documents/CameraSystem/CameraCommandIntroduction.md
- O único Vector3 é o `RotationKeyFrame.rotation` de `Camera.playAnimation`, estável desde a 2.6.0 / 1.26.10:
  - https://learn.microsoft.com/en-us/minecraft/creator/documents/update1.26.10?view=minecraft-bedrock-stable
  - https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/rotationkeyframe?view=minecraft-bedrock-stable
  - A Mojang listou "Camera spline with Z rotation" como próximo passo na 1.21.130:
    https://github.com/MicrosoftDocs/minecraft-creator/blob/main/creator/Documents/Update1.21.130.md
- `Player.setControlScheme(ControlScheme)` é estável desde a 2.4.0, e o `follow_orbit` aceita `player_relative`
  e `camera_relative`: https://learn.microsoft.com/en-us/minecraft/creator/documents/controlschemes
- `addShake` rotacional é um tremor aleatório, não controlável.

### Protótipo: `scripts/experimental/limits/CameraRoll.ts`

- `cblimits:camera_roll_test [graus]`: câmera `minecraft:free` parada, spline de 4 s com roll 0 → +30 → −30 → 0.
- `cblimits:on camera_roll`: câmera perseguidora no voo, com splines de 0,2 s atrás da montaria e o roll de
  `cobblemon:roll`.
- `cblimits:freelook on|off`: `setControlScheme(PlayerRelative)` ou o padrão.

### Evidência

- O servidor aceitou a spline com z. Log: `camera_roll_test …: spline enviada (roll ±30°)`. O bot recebeu o
  `camera_instruction`, mas o `bedrock-protocol` 3.60 (definições 1.26.40) não decodifica a parte `spline`
  ("Read error"). O formato no fio é `vec3f` (`types.yml` `CameraRotationOption.value`).
- Freelook: o bot recebeu `clientbound_controls_scheme {"scheme":"player_relative"}` e depois
  `{"scheme":"locked_player_relative_strafe"}`. A API devolve `getControlScheme() = PlayerRelative`.

### Veredito e plano

- **Freelook: APROXIMAÇÃO.** No `cobblemon:ride_orbit` (follow_orbit), o `PlayerRelative` deixa a câmera orbitar
  livre com o mouse. O jogador, e com ele a montaria que segue o olhar (`free_camera_controlled`), gira por A/D. Não
  dá para alternar "segurando uma tecla": não há botão livre. Plano:
  1. opção por jogador (`/scriptevent cobblemon:ride_camera freelook` ou `control_scheme` no preset);
  2. conferir no cliente como `input_ground_controlled` e `free_camera_controlled` reagem ao `PlayerRelative`.
- **Roll da câmera: APROXIMAÇÃO fraca, conferir no cliente.** Se o `camera_roll_test` rolar a tela, o z funciona.
  Mesmo assim, a câmera perseguidora depende de ida e volta pela rede (≥ 100 ms entre o mouse e a imagem) e deixa
  a visão presa à spline. É provável que enjoe e não substitua a câmera nativa. Recomendação: manter o roll visual
  do modelo (já feito) e só adotar a perseguidora como opção se o teste no cliente surpreender.

## 6. Pokédex na estante entalhada (#31)

- **Java:** `data/minecraft/tags/item/bookshelf_books.json` = `["#cobblemon:pokedex"]`.
- **Fonte:** o Bedrock tem a tag `minecraft:bookshelf_books`, que "filter[s] what type of items are storable in a
  chiseled bookshelf" (https://minecraft.wiki/w/Item_tag_(Bedrock_Edition)). Há precedente de tag vanilla
  funcionando em item custom (`minecraft:is_shovel`). Não achei confirmação específica da estante.
- **Protótipo:** o bot não consegue usar item em bloco. Nem o livro vanilla entrou, com 4 direções testadas: o BDS
  ignora a transação `click_block` dele. O teste fica para o cliente. No caminho apareceu que itens escritos à mão
  no BP não são reconhecidos pelo `/give`: o item-sonda falhou e a `strange_ball` que já existe também. Isso virou
  a tarefa "Investigar itens feitos à mão não registrados".
- **Veredito: PROVÁVEL VIÁVEL.** Plano: o importador acrescenta `minecraft:bookshelf_books` às tags dos 7 itens de
  Pokédex (já têm `cobblemon:pokedex`) e confere no cliente. O dispenser que tosquia (outra metade do #31) é de
  outra frente.

## 7. Pinturas crossover (#30)

- **Java:** `data/cobblemon/painting_variant/{altar 4×2, nomad 2×2, premonition 2×1, slumber 3×2}.json` e
  `data/minecraft/tags/painting_variant/placeable.json`. Entram no sorteio do item Pintura vanilla.
- **Fontes:**
  - O registro `painting_variant` é só do Java ("Bedrock does not load paintings this way":
    https://mctoolbox.net/blog/minecraft-custom-paintings-guide-java-bedrock, https://minecraft.wiki/w/Painting_variant).
  - Não há API de pintura no 2.10.0. O `grep painting` nos schemas 1.26.50 volta vazio.
- **Veredito: APROXIMAÇÃO.** A variante nativa é impossível. Plano, uma entidade `cobblemon:painting`:
  - geometria plana, uma textura por variante via propriedade int, sem física, quebra com um golpe e solta o item
    `minecraft:painting`;
  - no `entitySpawn` de uma `minecraft:painting` colocada por jogador, com chance 4/(n + 4), onde n é o número de
    variantes vanilla que cabem, testa o espaço (4×2, 3×2, 2×2 ou 2×1) e troca pela nossa.

  A variante vanilla sorteada não é legível por script, daí a chance fixa.

## 8. Enfermeira: profissão, trocas e som `work_nurse` (#99, #113)

- **Java:**
  - `CobblemonPoiTypes.kt:27`: POI `nurse` = Healing Machine;
  - `CobblemonVillagerProfessions.kt:27`: profissão `NURSE` com `VILLAGER_WORK_NURSE`;
  - trocas em `CobblemonTradeOffers`.
- **Fontes:**
  - `minecraft:dweller.preferred_profession` é string, e o schema `POIType` estável só tem `bed`, `meeting_area` e
    `jobsite`.
  - POIs data-driven (`PoiManager`) chegaram no 26.50 atrás dos toggles "Points of Interest" + Beta APIs:
    https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/poimanager?view=minecraft-bedrock-experimental
  - `behavior.work` só tem `sound_delay_*`, sem som próprio.
- **Veredito: APROXIMAÇÃO.** Plano:
  1. Override do `villager_v2`, copiado do bedrock-samples da versão-alvo, com o grupo
     `cobblemon:profession_nurse`: `economy_trade_table` com as trocas do Java e textura por `mark_variant` + RP.
  2. Script: aldeão desempregado a até 16 blocos de uma Healing Machine livre recebe o evento. No horário de
     trabalho, perto da máquina, toca `cobblemon.villager.work_nurse` com a cadência do `behavior.work`.
  3. Risco: conflito com outros add-ons que mexem no `villager_v2`, e o override precisa ser mantido a cada
     versão.

## 9. Fazendeiro planta sementes do Cobblemon (#136)

- **Java:** `data/minecraft/tags/item/villager_plantable_seeds.json`: mints, vivichoke, revival herb e hearty
  grains.
- **Fontes:**
  - `harvest_farm_block` não tem lista de blocos ou itens:
    https://learn.microsoft.com/en-us/minecraft/creator/reference/content/entityreference/examples/entitygoals/minecraftbehavior_harvest_farm_block?view=minecraft-bedrock-stable
  - Crop custom não é CropBlock (https://wiki.bedrock.dev/blocks/custom-crops).
  - `minecraft:shareables` aceita qualquer item (bedrock-samples `villager_v2.json`).
- **Veredito: APROXIMAÇÃO.** Plano:
  - override com as sementes em `shareables`, para o aldeão pegar;
  - tarefa de script a cada 40 ticks para fazendeiros perto de farmland livre com semente no inventário: planta o
    crop custom, colhe os maduros e replanta. Mesma prioridade do `HarvestFarmland` do Java.

## 10. Livro de receitas agrupado e busca "poke" = "poké" (#146)

- **Java:**
  - 423 receitas com `"group"` (`red_mints`, `basic_ancient_balls`…);
  - `mixin/client/RecipeCollectionMixin.java`, `ClientRecipeBookMixin.java`, `RecipeBookTabButtonMixin.java`;
  - `SearchTreeMixin.java:30-48` repete a busca trocando "poke" por "poké".
- **Fontes:**
  - O livro do Bedrock usa a lista do catálogo criativo ("the creative inventory and recipe book both share the
    same list of items"):
    https://learn.microsoft.com/en-us/minecraft/creator/documents/craftingitemcatalogdocumentation?view=minecraft-bedrock-stable
  - A receita shaped não tem `group`:
    https://learn.microsoft.com/en-us/minecraft/creator/reference/content/recipereference/examples/recipedefinitions/minecraftrecipe_shaped?view=minecraft-bedrock-stable
- **Veredito: APROXIMAÇÃO.** Plano: no `crafting_item_catalog.json` (frente mundo-detalhes), subgrupos com os mesmos
  nomes dos `group` do Java (mints vermelhas, bolas ancient básicas…), que no livro viram grupos recolhíveis.
- **Busca:** é do cliente. Conferir se ela já ignora acento. Se não ignorar, não há como injetar sinônimo.

## 11. Estruturas vanilla como condição de spawn

- **Java:** 889 condições `structures`. As vanilla fora da vila: `minecraft:monument` 33, `#minecraft:shipwreck` 18,
  `minecraft:swamp_hut` 9, mansão 7 e `minecraft:igloo` 4.
- **Fontes:**
  - `Dimension.getGeneratedStructures` é pre-release e só está no 2.12.0-beta:
    https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/dimension?view=minecraft-bedrock-stable
  - `CommandResult` só tem `successCount`, então `/locate` não devolve posição.
  - O filtro `is_in_village` é sobre dwellers.
- **Veredito: APROXIMAÇÃO.** Plano: estender `scripts/world/Villages.ts`/`StructureRegistry.ts` com assinaturas de
  bloco por chunk, usando `Dimension.containsBlock` estável e cache:

  | Estrutura | Assinatura |
  |---|---|
  | Monumento | prismarine bricks/dark prismarine + sea lantern em bioma oceânico, ou guardian/elder guardian por perto |
  | Cabana da bruxa | spruce planks + caldeirão + vaso em pântano |
  | Iglu | snow block + white carpet em bioma nevado |
  | Mansão | dark oak planks + cobblestone em dark forest, com volume grande |
  | Naufrágio | fraca; ficar como hoje |

## 12. Injeção nas vilas vanilla (#114)

- **Fonte:** "Villages and Bastions use a legacy version of the Jigsaw Structure System and cannot be modified via
  JSON"
  (https://learn.microsoft.com/en-us/minecraft/creator/reference/content/worldgenreference/examples/jigsawjigsawstructures?view=minecraft-bedrock-stable).
  A Mojang não tem a conversão no roadmap de curto ou médio prazo (https://wiki.bedrock.dev/meta/world-gen-qna).
- **Veredito: IMPOSSÍVEL.** Mantém a adaptação atual: Pokécenter por script em vila recém-gerada.
  `StructureManager.placeJigsawStructure` (estável) permite trocar a colocação por pool, sem ganho de fidelidade na
  ligação com as ruas: a vila legada não deixa blocos jigsaw.

## 13. Skin de jogador no NPC (`applyplayertexture`)

- **Java:** `NPCEntity.loadTextureFromGameProfileName` baixa a skin da conta (`entity/npc/NPCEntity.kt:563-590`).
- **Fontes:**
  - `Player` não tem membro de skin no estável nem no preview 26.60
    (https://jaylydev.github.io/scriptapi-docs/preview/classes/_minecraft_server.Player.html).
  - `getPlayerSkin`/`SimulatedPlayer.setSkin` são do `@minecraft/server-gametest` (pre-release, Beta APIs), e o
    `PlayerSkinData` é persona, não textura
    (https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server-gametest/playerskindata?view=minecraft-bedrock-experimental).
  - `q.skin_id` não acessa a textura.
- **Veredito: IMPOSSÍVEL.** Mantém a adaptação atual: skin do conjunto escolhida pelo nome.

## Arquivos desta pesquisa

| Caminho | O que é |
|---|---|
| `scripts/experimental/limits/{index,SprintLogic,RideSprint,NpcPokemonModel,NpcHide,CameraRoll,WebProbe}.ts` | Protótipos, desligados por padrão |
| `scripts/main.ts` | +1 import e +1 chamada `registerLimitPrototypes()`, que só escuta `cblimits:*` |
| `behavior_packs/CobblemonBedrock/entities/npc/npc.json` | Propriedade `cobblemon:npc_hidden` + grupo/eventos de assento, mesclados ao gerado |
| `resource_packs/CobblemonBedrock/render_controllers/npc/cobblemon_npc.render_controllers.json` | `part_visibility` pela propriedade |
| `behavior_packs/CobblemonBedrock/entities/experimental/limits_web_probe.json` | Sonda da teia (só `/summon`) |
| `tests/limites.test.ts` | 12 testes |
| `tests/mocks/minecraft-server.ts` | +`ControlScheme`, `LinearSpline`, `TextPrimitive` (só exports novos) |
| `tests/e2e/experimental/limites.e2e.mjs` | Cenário E2E avulso |
