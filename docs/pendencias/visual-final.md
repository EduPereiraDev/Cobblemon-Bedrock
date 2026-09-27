# Frente "visual-final" (BDS `visual`, porta 19142, raknet)

Itens PARCIAL de visual/áudio para fechar a paridade com o Cobblemon 1.8.2: sons e partículas da captura (#101), corte
do Furfrou (#103), partículas de aspect e olhos do Alfa (#88/#104), dono em itálico no pasto, camada `glow` dos papéis
de parede do PC, Healing Machine "natural" (#143) e o Nosepass apontando para o spawn (#144).

## Arquivos

| Tipo | Arquivos |
|---|---|
| Novos (scripts) | `scripts/visual/{index,AspectParticles,PointToSpawn,Debug}.ts` |
| Novos (importador) | `tools/importer/visualFinal.ts` (animação `alpha_eyes` por geometria) |
| Novos (RP à mão) | `resource_packs/CobblemonBedrock/particles/visual_final/poke_snack_crumbs.particle.json`, `textures/particle/visual_final/poke_snack_particle.png` (cópia de `textures/block/food/poke_snack_particle.png` do Cobblemon) |
| Alterados (itens pedidos) | `scripts/catching/CaptureSequence.ts`, `scripts/catching/index.ts` (import + som do acerto em bloco), `scripts/entity/Interactions.ts` (só `trimParticles` + tabela), `scripts/machines/pasture.ts` (só `tetherLabel`/`pastureOwnerLine`), `tools/ui/gen-telas.ts` (só `pcFile`) → `resource_packs/CobblemonBedrock/ui/pc.json` regenerado, `tools/importer/blocks.ts` (só `buildHealingMachine`) |
| Ganchos mínimos fora da frente | `scripts/main.ts`: 1 import + `startVisualFinal()` no worldLoad · `tools/importer/models.ts`: 1 import + `recordEyeLocators(geo, id)` em `emit` · `tools/importer/index.ts`: `name: l.name` na camada do `ComboOut` · `tools/importer/entities.ts`: campo opcional `name` em `ComboOut.layers`, 1 import e o bloco "alpha_eyes" em `emitClientEntity` |
| Teste | `tests/visual-final.test.ts` |
| Textos | nenhum novo (sem seção `## visual-final` nos `.lang`) |

## Status por item

| Item (PARIDADE) | Status | Como / prova |
|---|---|---|
| #101 Sons da captura sem prefixo | FEITO | `CAPTURE_SOUNDS` = `cobblemon.poke_ball.{hit,open,shut,recall,shake,shake.critical,capture_succeeded,break,bounce,land.ancient}` e `.ancient` (open, shut, bounce, break, capture_succeeded, shake dos pulos); `shake.critical` sem variante, como a animação `critical` da ancient. Sons tirados das animações do Cobblemon (`bedrock/poke_balls/animations/*.animation.json`), com os tempos delas: bounce só sem crítica (PokeBallPosableState pula o bounce na crítica), `land.ancient` no pouso de cada pulo (smallhop 0,75 s … weirdhop 1,0833 s), `capture_succeeded` em 0,034 s. Acerto em bloco sem captura: `dig.wood` pitch 2 (SoundEvents.WOOD_PLACE com pitch 2,5, limitado a 2 no Java) no lugar de `poke_ball.bounce`. Prova: teste (todos os ids existem em `generated/.../sound_definitions.json`; o código não tem mais `"poke_ball.`) |
| #101 Partículas vanilla da sequência | FEITO | Feixe (0,7 → 1,5 s): `cobblemon:recall_beam` da bola até o meio do Pokémon, cresce 0,2 s, recolhe depois de 0,6 s (ratio do `renderBeam`), no lugar de `endrod`; o Pokémon encolhe 1 → 0 em 0,4 s depois de 0,2 s (beamMode 3, `cobblemon:scale_modifier`) e volta 0 → 1 em 0,4 s ao escapar (beamMode 2). Sucesso: `capturesparks` + `capturestar` (0,0417 s) e `afterspark` (0,125 s) no `center_particles`; ancient: `hisuisendspark`/`hisuipuff`/`hisuitrail`/`hisuispark`/`hisuicapturestar`/`hisuiafterspark` no `top_particles`. Pulos da ancient: `ancient_pokeball_smoke`. Crítica: sem partícula (a animação não tem). Escape: `<bola>_casual_sendflash` 0,1 s depois e anel de shiny 0,5 s depois se shiny (sem som de envio: o selvagem não tem dono). Saem `endrod`, `villager_happy`, `white_smoke_particle` e `critical_hit_emitter`. Prova: teste (todas as partículas existem no RP gerado/à mão) |
| #103 Corte do Furfrou | FEITO | `FURFROU_TRIM_PARTICLES`: `cobblemon:poodle_hair_<cor>` pelo corante vestido, em 0 / 0,2 / 0,7 s no meio do hitbox, como a timeline de `action_effects/misc/furfrou_trim.json` (lime → verde, como no Cobblemon; sem corante, sem partícula). O som de tesoura vem do evento da própria partícula. Prova: teste confere a tabela contra o action effect do upstream |
| #88 `honey_drenched` e migalhas | FEITO | `scripts/visual/AspectParticles.ts` (AspectParticleMap + spawnAspectParticle): Pokémon na caixa 16×16×16 de cada jogador, fora da captura (`busy`), por tick: mel 7,5 % × 1 (`minecraft:honey_drip_particle`, a gota de mel do Bedrock no lugar de FALLING_HONEY), migalhas 5 % × 3 (`cobblemon:poke_snack_crumbs`: partícula de bloco com a textura `poke_snack_particle` do Cobblemon, tamanho/gravidade/atrito/UV do TerrainParticle), num ponto aleatório do hitbox. Passe a cada 2 ticks com 2 sorteios; aspects relidos de `data` a cada 2 s. Néctar continua no SpeciesBehaviours. Prova: teste + BDS `debug_visual_final aspects` → `50 passes (100 ticks), 13 partículas` (esperado ≈ 22 ± 7) |
| #88/#104 `alpha_eyes` | FEITO (partícula) / NÃO POSSÍVEL (bloom e rastro) | Importador (`tools/importer/visualFinal.ts`): cada geometria com locators "eye" ganha uma animação em loop com `cobblemon:alpha_eyes` em cada olho a cada 0,2 s (5/s = 0,25 × 20 ticks do Java), presa ao locator, ligada só nas variantes com a camada `alpha_eyes` (praticamente todas as espécies têm) — 871 espécies. `v.entity_*` com o tamanho do Alfa. Prova: teste (combee: 2 animações por geometria, condição de variante, partícula importada). NÃO POSSÍVEL: o `AlphaEyeRenderer` do 1.8.2 também desenha um brilho (anéis) e um rastro de 400 ms com `RenderType.dragonRays/lightning` direto no buffer — o Bedrock não tem renderização customizada por entidade; o RP só tem partículas/materiais de modelo |
| #104 `alphaboost_*` fora de batalha | N/A NO 1.8.2 | Prova: grep em `upstream/.../kotlin` e `data/` — só `action_effects/starts/start_alphaboost.json` usa (batalha, `-start`, já feito pela visual-batalha). Teste confere |
| #104 `heal_circles`/`heal_sparkles` na Healing Machine | N/A NO 1.8.2 | Prova: nenhuma referência fora dos próprios arquivos de partícula; a Healing Machine do 1.8.2 usa `HAPPY_VILLAGER` em `HealingMachineBlock.animateTick` (já feito). Teste confere |
| Pasto: dono em itálico | FEITO | `pastureOwnerLine`: `§7§o<dono>§r` em todos os Pokémon da lista (PasturePokemonScrollList: `ownerName.text().italicise()`; no Java aparece no hover, que o formulário não tem, então vai numa segunda linha). Prova: teste |
| Papéis de parede: camada `glow` | FEITO (precisa de conferência no cliente) | `ui/pc.json` (gerador `tools/ui/gen-telas.ts`): três imagens `wallpaper_glow_<basic|biome|misc>` (208×189 em x−17, y−17, entre o papel e a grade, como o StorageWidget), textura montada no binding: `'textures/gui/pc/wallpaper/<pasta>/glow/' + ((#form_text - '<raiz>/<pasta>/') - 'alt/')`, visível quando o corpo é daquela pasta (o alt usa a glow do papel base, como o `find { it.second == ... }` do Java). Papel de parede agora ocupa a tela inteira (174×155 na origem), como no Java (antes 160×133 na grade). Prova: teste (layout, e as 17 texturas `glow/` existem). Sem cliente: o concatenar string no `#texture` segue a regra (f) de `docs/pesquisa/1-interface.md` |
| #143 Healing Machine "natural" | FEITO | Estado `cobblemon:natural` (false/true) no bloco: natural usa os modelos `healing_machine_limited_1..5` (mesma forma, textura `healing_machine_limited`), 20 permutações; loot por permutação: natural → 1–4 barras de ferro (`healing_machine__natural_true`), comum → a máquina. `stateDefs` liga o `natural` do Java nas estruturas (bedrockStateFor). Prova: teste + BDS `debug_visual_final healing` → `natural=true estado=true drops=[minecraft:iron_ingot×1]` e `natural=false drops=[cobblemon:healing_machine×1]` |
| #143 Comparador | NÃO POSSÍVEL NO BEDROCK | (já registrado: bloco custom não emite sinal de comparador) |
| #144 Nosepass aponta para o spawn | FEITO | `scripts/visual/PointToSpawn.ts` (PointToSpawnTaskConfig, só o nosepass.json usa): a cada 10 ticks, Nosepass parado (vel. horizontal < 0,02), fora de batalha, acordado, não `busy`, sem montar/ser montado e fora do ombro → `Entity.lookAt(centro do bloco do spawn, altura dos olhos)` (API estável). Prova: teste + BDS `debug_visual_final nosepass` → `spawn=(88,-104) yaw=-145.6 esperado=-145.6 diferença=0.0°` |

## Desvios e o que ficou de fora

- **Tinta vermelha no feixe de captura**: FEITO no fechamento (ver "Fechamento" abaixo). Texto original: NÃO
  FEITO. Precisaria de uma propriedade sincronizada nova em todas as ~900 entidades de Pokémon + `overlay_color` nos render
  controllers (importador `entities.ts`, da frente dados-ia nesta onda). A recolha da visual-batalha tem o mesmo desvio.
- **Papel de parede padrão**: FEITO no fechamento (ver abaixo). Texto original: no Java a caixa nova usa `wallpaper_basic_05` (PCBoxWallpaperRepository.defaultWallpaper);
  o port mantém "sem papel de parede" como padrão (decisão da extras-final, testada em `tests/extras-final.test.ts:196`).
  Pedido abaixo.
- `open_idle`/`shut_idle` do Cobblemon têm `sound_effects` em 0 s num loop; não repetidos aqui (o port toca `open` e `shut`
  uma vez, nas transições).
- A bola que bate num bloco sem capturar continua com `minecraft:white_smoke_particle` (CLOUD do Java, sem par exato no
  Bedrock).

## Pedidos a outras frentes

1. **extras-final / telas** (`scripts/GUI/PCWallpapers.ts`, `boxWallpaperTexturePath`): para a caixa sem escolha mostrar o
   padrão do Java com a glow:
   ```ts
   const JAVA_DEFAULT = `${WALLPAPER_ROOT}basic/wallpaper_basic_05.png`;
   return bedrockTexturePath(texture === DEFAULT_WALLPAPER ? JAVA_DEFAULT : texture);
   ```
   e trocar `tests/extras-final.test.ts:196` para `"textures/gui/pc/wallpaper/basic/wallpaper_basic_05"`.
2. **dados-ia** (dona do `tools/importer/entities.ts` nesta onda): o bloco "Frente visual-final: partícula alpha_eyes" em
   `emitClientEntity` e o campo `name?` de `ComboOut.layers` são meus; manter ao mexer no arquivo.

## Conferência no servidor

`scriptevent cobblemon:debug_probes on` e `scriptevent cobblemon:debug_visual_final <nosepass|aspects|healing> [x z]`
(só pelo console; `tickingarea` antes, sem jogador). Rodado no BDS `visual` (porta 19142, raknet): as três sondas com os
resultados acima. Log sem ERROR/WARN desta frente; os únicos erros de conteúdo eram de outra frente
(`cobblemon:npc` `minecraft:leashable` `soft_distance/max_distance/hard_distance` "child not valid here") e o aviso de
transporte do raknet. Container removido no fim (`docker rm -f cobblemon-bds-visual`). O BDS não carrega o RP: partículas,
animação `alpha_eyes` e o `pc.json` foram conferidos por `npm run validate` e pelo teste, não num cliente.

## Verificação

- `npm run import` OK (871 animações de olhos do Alfa, 1010 partículas emitidas) → `npm run validate`: **OK, nenhum erro**.
- `npx tsc -p tsconfig.json`: 0 erros nos arquivos da frente. Na rodada final, 1 erro transitório de outra frente
  (`scripts/entity/Riding.ts(184,5)`); antes, `scripts/entity/SeatConditions.ts` sem `SEAT_CONDITIONS` até a dados-ia
  rodar o import.
- `npm test`: todos os arquivos passam, inclusive `visual-final: ok`.
- `node --experimental-strip-types tools/ui/gen-telas.ts --check`: em dia.

## Fechamento (BDS `tint`, porta 19145, raknet)

Dono de `tools/importer/entities.ts` nesta rodada. Não toquei em `scripts/battle/`, `scripts/trade/`,
`scripts/ChallengePlayer.ts` nem `scripts/commands.ts`.

### Arquivos

| Tipo | Arquivos |
|---|---|
| Novos | `scripts/pokemon/BeamTint.ts` (`setBeamTint`), `tools/importer/legacyBallIcons.ts`, `tests/tint.test.ts` |
| Alterados | `tools/importer/entities.ts` (propriedade `cobblemon:beam_tint`, `beamTintPreAnimation`, `overlay_color` em todo render controller de Pokémon), `tools/importer/items.ts` (1 import + chamada de `legacyBallIcons` antes de gravar o `item_texture.json`), `scripts/catching/CaptureSequence.ts` (tinta no raio + escala cancelável), `scripts/pokemon/SendOutAnimation.ts` (tinta na recolha fora de batalha), `scripts/GUI/PCWallpapers.ts` (`JAVA_DEFAULT_WALLPAPER`), `scripts/visual/Debug.ts` (cenário `tint`), `tests/extras-final.test.ts:196` (nova expectativa) |
| Gerado (`npm run import`) | 894 entidades BP com `cobblemon:beam_tint`, 1982 render controllers de Pokémon com `overlay_color` (todos), `textures/item/poke_balls/port/strange_ball.png` + entrada `strange_ball` no `item_texture.json` |

### Status

| Item | Status | Como / prova |
|---|---|---|
| Tinta vermelha no feixe (captura) | FEITO (conferência visual no cliente pendente) | Java (`PokemonRenderer.renderTransition`, `PokemonClientDelegate`): com beamMode 3, depois de `BEAM_EXTEND_TIME` = 0,2 s, verde e azul = `1 − min(0,6; (s − 0,2) / BEAM_SHRINK_TIME)` com `BEAM_SHRINK_TIME` = 0,4 s, ou seja, caem de 1 a 0,4 entre 0,2 s e 0,44 s e ficam em 0,4. Port: propriedade bool `cobblemon:beam_tint` (client_sync) ligada no começo do `beamUp` na entidade que aparece (o disfarce, se houver). No cliente, `v.cobblemon_beam_t` soma `q.delta_time` enquanto a propriedade está ligada, e `v.cobblemon_beam_tint = min(0,6; (t − 0,2)/0,4)` para 0,2 < t < 3. O `overlay_color` (1, 0, 0, a) fica em todos os render controllers (base e camadas). Desligada no `breakFree` (beamMode 2) e no `finally` (qualquer saída). Prova: `tests/tint.test.ts` avalia o Molang gerado e bate com a fórmula do Java em 10 instantes; as 894 entidades e os 1982 render controllers de Pokémon conferidos |
| Tinta vermelha na recolha fora de batalha | FEITO | `recallAnimated` (`scripts/pokemon/SendOutAnimation.ts`) liga a tinta antes do `animatedRecall`, porque o encolhimento também espera 0,2 s. Desliga se o Pokémon entrou em batalha durante a recolha ou se a animação falhou. Na recolha normal a entidade sai de campo |
| Tinta na recolha de batalha | FEITO | Orquestrador aplicou o pedido: `animatedRecall` (`scripts/battle/SendOut.ts`) chama `setBeamTint(shown, true)`; a recolha sempre tira a entidade de campo |
| Limite de propriedades por entidade | OK | Antes eram 9 ou 10 por entidade (847 e 47 entidades), agora são 10 ou 11 (o máximo é o aerodactyl, com `roll` + `aspects`). O limite é 32 e o teste confere |
| Papel de parede padrão do PC | FEITO | `PCBoxWallpaperRepository.defaultWallpaper` = `basic/wallpaper_basic_05.png`. O `PCBox.wallpaper` do servidor continua `pc_screen_overlay.png`, e o `StorageWidget` cai no padrão porque o overlay não está na lista. `boxWallpaperTexturePath` agora devolve `textures/gui/pc/wallpaper/basic/wallpaper_basic_05` para a caixa sem escolha. O dado salvo não muda (`getBoxWallpaper` ainda é `DEFAULT_WALLPAPER` e o botão "Padrão" continua igual), e a camada `glow` do `pc.json` pega `basic/glow/wallpaper_basic_05` sem mudança na UI |
| Teste da extras-final | AJUSTADO | `tests/extras-final.test.ts:196` esperava `""` (sem papel de parede), a decisão antiga da extras-final. Agora espera `"textures/gui/pc/wallpaper/basic/wallpaper_basic_05"`. Justificativa: é o que o cliente do Java desenha na caixa nova (`ClientBox()` e o fallback do `StorageWidget` acima). Nenhuma outra asserção de papel de parede mudou |
| Aviso `cobblemon:strange_ball: ícone strange_ball fora do item_texture` | FEITO | A strange_ball não está no registro do Cobblemon 1.8.2 e não tem sprite 2D (só `textures/item/poke_balls/models/strange_ball.png`). O item é feito à mão no BP. `legacyBallIcons` gera o ícone de cada item à mão em `items/pokeballs` que esteja fora do atlas: pega o ícone da `poke_ball` do Cobblemon e troca o matiz da tampa (±40° do vermelho do modelo da poke_ball) pelo matiz médio da tampa do modelo da bola (metade esquerda da textura 64×32; na strange_ball fica verde-água). Resultado: `npm run validate` sem nenhum aviso |
| Bug do revisor: escala presa em 0,05 | CORRIGIDO | Antes, o `lerpScale` agendava timeouts sem cancelamento. Um abort nos primeiros ~4 ticks do raio fazia o encolhimento (+4 a +12 ticks) escrever depois do crescimento do `breakFree`, e `cobblemon:scale_modifier` ficava em 0,05. Agora `scaleJobs` guarda um número de trabalho por entidade, `restoreScale` e `breakFree` cancelam o trabalho anterior e cada timeout confere o número antes de escrever. Prova: `tests/tint.test.ts` §6 roda `runCaptureSequence` com relógio falso e propriedades gravadas no fim do tick, e faz a bola sumir em +0/1/2/3/5/8 ticks do raio. Em todos, a escala final volta à original (1,25), a tinta termina desligada e `busy` fica false. Contra-prova: o mesmo teste falha sem o cancelamento (`escala final = original (abort em +0)`) |

### Desvios

- `overlay_color` mistura em vez de multiplicar. Verde e azul saem exatamente × (1 − a), como no Java. O vermelho vira
  `R·(1 − a) + a`, ou seja, clareia; no Java ele fica igual. O Bedrock só aplica `color` em materiais de máscara de cor
  (armadura de couro, peixe tropical), não no `entity_alphatest`. Fora do feixe o `overlay_color` devolve `this`, que
  mantém o overlay do motor (flash de dano), como no exemplo do wither no `bedrock-samples`.
- Trava de 3 s na tinta (`BEAM_TINT_MAX_SECONDS`): o feixe visível dura no máximo 1,5 s (0,7 → 2,2 s na captura), e a
  trava só entra se a propriedade ficar presa (servidor fechado no meio da captura).
- `setBeamTint` grava sempre, sem comparar antes. No BDS, o `getProperty` do mesmo tick ainda devolve o valor antigo
  (sonda: `liga=true→false` lido no mesmo tick na primeira versão), e comparar deixaria "liga e desliga no mesmo tick"
  com a tinta ligada. O teste cobre isso com um mock de gravação adiada.

### Pedido

1. **visual-batalha** (`scripts/battle/SendOut.ts`, `animatedRecall`): ligar a tinta na recolha de batalha, que vem do
   `Switching.ts`. Depois de calcular `shown`:
   ```ts
   import { setBeamTint } from "../pokemon/BeamTint";
   // beamMode 3: tinta vermelha no cliente (0,2 s depois, junto com o encolhimento).
   setBeamTint(shown, true);
   ```
   Se a recolha for desfeita, chamar `setBeamTint(shown, false)`. Hoje a recolha sempre tira a entidade de campo, então
   isso não acontece. Com isso a chamada em `SendOutAnimation.recallAnimated` fica redundante, mas é idempotente.

### Conferência no servidor

BDS `tint` (`COBBLEMON_DIST=dist-tint`, porta 19145, raknet). Os dois boots tiveram o log de conteúdo no console
ligado e nenhum ERROR/WARN de conteúdo ou script. O `ContentLog*.txt` em disco ficou com 0 linhas, e o único ERROR é o
aviso de transporte do raknet. Não existe sonda de captura/recolha, porque as duas precisam de um jogador que arremessa
ou recolhe. O cenário novo `scriptevent cobblemon:debug_visual_final tint 0 0` (com `debug_probes on` e `tickingarea`)
deu, para bulbasaur, rattata e aerodactyl (este com 11 propriedades):
`antes=false liga=true→true desliga=true→false liga+desliga no mesmo tick→false`. Container removido
(`docker rm -f cobblemon-bds-tint`); o `cobblemon-bds` não foi tocado. O BDS não carrega o RP, então a cor em si
(`overlay_color`) foi conferida pelo teste e pelo `validate`, não num cliente.

### Verificação

- `npm run import` OK (`ícones de Poké Balls à mão: 1`). `npm run validate`: **OK, nenhum erro e nenhum aviso** (o da
  strange_ball saiu).
- `npx tsc -p tsconfig.json`: 0 erros.
- `npm test`: exit 0, 32 arquivos, nenhum `FALHOU` (inclui `tint: ok`, `extras-final: ok` e `visual-final: ok`).
- `node tools/check-ui-baseline.mjs`: ok (0 avisos).
