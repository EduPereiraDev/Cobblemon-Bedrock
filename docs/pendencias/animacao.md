# Pendências da frente "animacao"

Pesquisa: `docs/pesquisa/4-animacao.md` (§9). BDS próprio: `COBBLEMON_DIST=dist-animacao COBBLEMON_BDS=animacao COBBLEMON_BDS_PORT=19143`
(container removido no fim).

Arquivos da frente:

- `tools/importer/{posers,animations,molang,models,sounds,particles}.ts`;
- novos `tools/importer/{kotlinPosers,animatedTextures,actionEffects}.ts`;
- `tools/importer/data/kotlin-posers/*.json`, com a saída congelada do conversor e o `_report.json`;
- a parte de client entity e render controller de `tools/importer/entities.ts`;
- `tools/importer/validate.ts`, na lista de queries e nas checagens de partículas e flipbook;
- ligações pequenas em `tools/importer/index.ts`;
- novo `scripts/battle/effects/{ActionEffects,index}.ts`;
- ganchos em `scripts/battle/BattleInterpreter.ts` e uma correção em `scripts/battle/PokemonBattle.ts` (ver abaixo);
- `tests/animacao.test.ts`, mais o export `MolangVariableMap` no mock.

Removido: `resource_packs/CobblemonBedrock/materials/entity.material`. Os 4 materiais custom dele não eram citados
por nenhum arquivo, nem no RP à mão nem no gerado.

## Status por item

| Prio | Item | Status | Prova / números |
|---|---|---|---|
| P0-1 | Y de `transformedParts.position` | **FEITO** | `posers.ts/transformAnimation` nega o Y, que vem no espaço do Java (Y para baixo), porque a animação Bedrock do Cobblemon usa `yMul = -1`. Vale para os 78 casos em 32 posers JSON e para os Kotlin. Teste: `charizard/surface_idle` com `body` em Y < 0, ou seja, afunda. |
| P0-2 | Posers Kotlin → dados | **FEITO** | `kotlinPosers.ts` converte **308/308** posers só em Kotlin, **100 % sem pendência**: 1.170 poses e **2.027/2.027** animações. A saída fica congelada e revisável em `tools/importer/data/kotlin-posers/`. Regenerar com `node --experimental-strip-types tools/importer/kotlinPosers.ts`. Falha alto: cada trecho não reconhecido vai para `unsupported` → `_report.json` → aviso "poser Kotlin com trecho não convertido" no import (hoje 0). Import: **301** posers Kotlin em uso; "posers de reserva (convenção)" caiu de **293 para 0**. O teste confere que o congelado é igual à saída do conversor. |
| P0-2b | Vocabulário do Kotlin | **FEITO** | Coberto: `registerPose`, `poseType(s)` com os conjuntos, as condições `isBattling/isInWater/isUnderWater/isInWaterOrRain/isDusk/isStandingOn/HAS_BEEN_SHEARED/isFalling/ownerUUID`, `bedrock/bedrockStateful`, `singleBoneLook`, `SingleBoneLookAnimation` nas duas formas e com frames `object : HeadedFrame`, `Biped/Quadruped/BimanualSwing`, `wingFlap/WingFlapIdleAnimation` (também em `object : BiWingedFrame`), `rotation/translation` com `sine/cosine/triangle/parabolaFunction` e lambdas de tempo, `WaveAnimation`, quirks, `transformedParts`, `namedAnimations`, `CryProvider` (if/when/batalha/`PrimaryAnimation`) e `getFaintAnimation` (if/else-if/when/isNotPosedIn). |
| P0-3 | 8 espécies sem idle | **FEITO** | "espécies geradas" subiu de **886 para 894**. Pose sem animação agora é aceita: fica na pose do `.geo` + look, como no Cobblemon. A reserva sem idle gera `standing` só com look. |
| P0-4 | `q.is_ridden` → `q.has_rider`; `rider_head_*` na lista | **FEITO** | `molang.ts` faz `is_ridden → q.has_rider`. `q.riding_style == 'AIR'` vira `(v.cobblemon_ride_style == 2)`, com o código calculado no cliente: 0 nenhum, 1 terra, 2 ar (fora do chão por mais de 0,4 s, só em quem voa montado), 3 água. Entraram em `BEDROCK_QUERIES`: `rider_head_x/y_rotation` e `rider_body_x/y_rotation`. Com isso as 401 condições `q.is_ridden` dos posers podem ser escolhidas. |
| P1-1 | `pitch_tilt` + look compensado | **FEITO** | Fórmula do `PitchTiltAnimation`, com o limite por quadro convertido em limite × 60 × `q.delta_time` para não depender do FPS e sem inclinar com passageiro. O estado vai em `v.cobblemon_pt_*` no `pre_animation`. O look da mesma pose desconta a inclinação. Os 204 usos foram convertidos (0 avisos de pitch_tilt): 96 animações sintéticas em 68 client entities e 113 looks compensados. |
| P1-1b | Procedurais do Kotlin | **FEITO** | `cobblemon_fn` (rotação/translação com seno, cosseno, triângulo e parábola periódica), `cobblemon_wing_flap` com qualquer função e `cobblemon_wave_chain` (`WaveAnimation`, com constantes t1/t2 calculadas no import). O teste confere numericamente contra as fórmulas do `WaveFunctions.kt`. Único aviso restante: `bedrock_quirk` dentro de `animations` do beldum, que também não funciona no Cobblemon. |
| P1-2 | Montaria `q.r.*` / `q.riding.*` | **FEITO** | `molang.ts/RidingMolang`: molas `Vec3Spring` (k = 90, c = 18) no `pre_animation`, alimentadas por `q.position`, `q.vertical_speed`, `q.body_y_rotation` e `q.rider_head_x_rotation(0)`. `(N)` vira média exponencial. `input_*` usa um proxy pela velocidade local, `roll/roll_change` e `target_distance_*` valem 0. 83 client entities receberam as linhas. Todos os `q.r.*` foram convertidos; sobra `q.riding_yaw_change` ×1, um erro de digitação no próprio Cobblemon. Sem propriedade nova e sem rede. |
| P1-2b | Rolagem visual no voo (pedido da frente motor em `Riding.ts`) | **FEITO no RP** / bloqueado pelo BP | As 43 espécies que voam montadas ganharam `animation.cobblemon_gen.<id>.ride_roll`: `root_part` gira em Z por `q.property('cobblemon:roll')` enquanto há condutor. **Mas o BDS rejeita a propriedade `cobblemon:roll`** (ver pedido 1). |
| P1-3 | Partículas do Cobblemon | **FEITO** | `particles.ts/ParticleIndex` emite sob demanda, com fecho das dependências e numa pasta só. Adaptações: remove `cobblemon:emitter_space` e componentes que não são do Bedrock, troca `q.entity_*` por `v.entity_*`, `q.random` por `math.random` e `q.sound` por `sound_effect`, e acerta o caminho da textura (`textures/particles` → `particle`, e o erro `textures/textures`). Lã vanilla vira um branco gerado. Evento que aponta para partícula inexistente fica vazio. As animações passam `v.entity_*` pelo `pre_effect_script` com o tamanho da espécie. Resultado: 35/35 referências de animação (aviso "partícula sem equivalente": **35 → 0**) e **660** arquivos emitidos (animações, golpes, scripts e shiny). O validador checa ids, eventos, sons, texturas e Molang das partículas. |
| P1-4 | Aliases de som | **FEITO** | `sounds.ts/soundAlias`: forma regional → base, "nome de arquivo" (`weedle_cry`, `*_ambient`, `0555_darmanitan_cry`), `gilded_chest_open`, `plumage_wing_flap_medium_N`, e o evento sintético `steel_wing_flap_large_2` para o `.ogg`. **26/40** referências (23/36 eventos) tocam. As 14 restantes (`*.mp3`, `070`, `Stone_jump3`, `load_yippee_sound_here`, `pokemon.bronzong.bell`...) não têm arquivo em lugar nenhum e ficam mudas, como no Cobblemon. |
| P2-1 | Texturas animadas (flipbook) | **FEITO** | `animatedTextures.ts` monta um array `combos × quadros` indexado por `variant·F + quadro`, com relógio `v.cobblemon_tex_t` e materiais vanilla. Cobertura: **36** flipbooks distintos das **40** ocorrências nos resolvers (**100 %**), 20 canais de render controller e 80 usos por combinação. `variants.ts` ainda avisa "reduzida ao 1º quadro", porque a chave do combo continua sendo o 1º quadro, mas esse quadro é expandido aqui (ver pedido 3). O validador aceita arrays `combos × F`. |
| P2-2 | Emissivos | **FEITO** (parcial) | `ignore_lighting` foi mantido nas camadas emissivas, que é o "lightmap off" do Cobblemon. O `entity.material` órfão saiu. **Não feito**: `is_hurt_color` na camada e texture sets de Vibrant Visuals, que precisam de conferência visual no cliente e não dá para provar no BDS. |
| P2/P3 | action_effects (154 timelines) | **FEITO** (ver limites) | O importador (`actionEffects.ts`) traduz o Molang das timelines para dados (`generated/scripts/actionEffects.ts`): 154 timelines, 389 partículas pedidas, 22 animações genéricas de golpe (`animation.cobblemon_generic.*`) e os locators por espécie. O intérprete em script (`scripts/battle/effects`) toca animação do poser (`battle_<nome>` primeiro), partícula no locator com `v.entity_*`/`v.target_*`, sons e animações genéricas, cada um no seu tempo (`system.runTimeout`). As holds viram a espera do dispatcher, com teto de 4 s. Timelines por espécie (`<golpe>_<espécie>`) vêm primeiro, com `generic_move` de reserva. |
| P2/P3b | `root_part` nas geometrias | **FEITO** | `models.ts/wrapRootPart`: osso `root_part` sem cubos, com o pivô do osso de topo, nas 1.149 geometrias. É o osso que as animações genéricas de golpe mexem, como o `rootPart` do Cobblemon. |

### Limites conhecidos (action_effects)

- A partícula nasce no ponto do locator calculado na pose de repouso: não segue o osso animado. Ela também sai em
  espaço do mundo, sem a rotação do emissor. A direção dos feixes vem de `v.target_*`, em coordenadas do mundo.
- `do_effect_walks`/`move_to_target`/`return_to_position` (andar até o alvo) não foram portados e contam como falso.
  O mesmo vale para os keyframes `molang` do `furfrou_trim` e do `npc_heal_player_pokemon`, que usam funções do
  Pokémon/NPC. São os 52 "trechos não portados" do relatório.
- 5 partículas citadas não existem no próprio Cobblemon: `intestation_*` (erro de digitação), `bubble_target`,
  `anger`, `anger_steaming` e `leechlife_targetdrain`. Os 2 `q.play_animation` de grupos inexistentes (`faint`,
  `explosion`) também ficam de fora.

## Ganchos na batalha (feitos; o núcleo da batalha não tem dono)

`scripts/battle/BattleInterpreter.ts`:

```ts
// import
import { playDamageEffect, playFaintEffect, playMoveEffects } from "./effects";

// handleMoveInstruction: dispatchGo → dispatch, e no lugar de playMoveAnimation(...)
const hold = playMoveEffects(userPokemon, targetPokemon, effect.id, remainingLines, message.argumentAt(0)?.split(":")[0], message.argumentAt(2)?.split(":")[0]);
...
return hold > 0 ? new WaitDispatch(hold) : GoDispatch;

// handleFaintInstruction
if (!playFaintEffect(pokemon)) playFaintAnimation(pokemon.entity, pokemon.data);

// handleDamageInstruction, dentro de `if (effect) {`
playDamageEffect(battlePokemon, effect.id);
```

`scripts/battle/PokemonBattle.ts/checkParticipants` ganhou 2 linhas, e isso é **correção de bug**. O
`FaintInstruction` mata a entidade selvagem antes de o `|win|` ser despachado. Com a espera dos efeitos, a checagem
de participantes passou a cair nessa janela e encerrava a batalha como `stopped`. Em `batalhas.test.ts` isso
aparecia como `'stopped' !== 'win'`. Agora um selvagem cujo time todo desmaiou não conta como "sumiu".

`scripts/battle/Animations.ts` (`playMoveAnimation`) ficou sem uso no golpe. Continua exportado.

## Pedidos a outras frentes

1. **motor**: o BDS rejeita `cobblemon:roll` em 43 entidades com `'range' array should contain only 'float' type elements`,
   então a propriedade não carrega (`Error loading Actor Properties`). O RP já lê
   `q.property('cobblemon:roll')` na animação `ride_roll`, só nas espécies que voam montadas. Sugestão: gravar a
   faixa com literais que o Bedrock aceite como float. Um exemplo é o mesmo truque do `scale_modifier`, com máximo
   não inteiro e `default` em string. Enquanto isso não for corrigido, a rolagem fica em 0.
   - Opcional: uma propriedade `cobblemon:ride_style` (int 0–3, `client_sync`) daria o estilo exato. Hoje o estilo sai
     de um proxy no cliente (`v.cobblemon_ride_style`). Para trocar, basta uma linha em `entities.ts`/`pre_animation`.
2. **orquestrador (package.json)**: alias `"import:kotlin-posers": "node --experimental-strip-types tools/importer/kotlinPosers.ts"`.
3. **dono de `variants.ts`**: o aviso "textura animada reduzida ao primeiro quadro" (×40) pode virar informativo, ou
   sair. O quadro é expandido em `animatedTextures.ts` e `index.ts` (`framesOf`).
4. **validate (orquestrador)**: `validate.ts` agora cria o link `generated.tmp-<pid> → generated/` no início.
   `util.ts` passou a apontar `OUT_*` para a pasta temporária, e sem o link o validador sempre acusava "generated/ não
   existe". Os 57 erros restantes são de outras frentes: blocos (`cobblemon:pressed`/`block_face`, "bloco duplicado
   undefined") e texturas `steve`/`alex` do NPC.

## Pedidos recebidos (atendidos)

- **retratos §2**: os JSON Kotlin agora trazem `portraitTranslation`/`profileTranslation` (`[x, y, z]`, de
  `Vec3(...)`) e as escalas também sem o sufixo `F`. São 308/308 arquivos.
- **jogabilidade C**: o brilho de shiny (`wild_shiny_ring`, `shiny_sparkle_ambient_wild`, `ambient_shiny_sparkle`,
  `shiny_ring*`, `shiny_glimmer` e as dependências) vai para o RP **sem os eventos de som**, porque o script toca os
  chimes. Isso está em `particles.ts/emitScriptParticles` (`request(id, { silent: true })`).

## Verificação (2026-09-26)

- `npm run import` OK. Contagens: 894 espécies, "posers de reserva" 0, "posers Kotlin convertidos" 301, 660
  partículas, "partícula sem equivalente" 0, "som inexistente" 14 (40 antes), "procedural sem conversão" 1 (205
  antes).
- `npm run validate`: nenhum erro desta frente. Isso cobre Molang de animações, controllers, client entities e
  partículas, que agora também inclui chamadas aninhadas: `scanMolang` passou a percorrer os argumentos. Também cobre
  arrays de flipbook, ids, eventos e texturas das partículas. Os 57 erros restantes são de blocos e do NPC.
- `npx tsc -p tsconfig.json`: 0 erros.
- `npm test`: todos passam. `tests/animacao.test.ts` tem 13 grupos: conversor Kotlin e saída congelada, funções de
  onda contra as fórmulas do Kotlin, Molang de montaria, adaptação de partícula (inclusive silenciosa), aliases de
  som, flipbook, root_part, conteúdo gerado, e o planejamento e a execução do Thunderbolt com entidades falsas.
- BDS próprio (`dist-animacao`, porta 19143) subiu **sem nenhum ERROR/WARN desta frente**. Os erros no carregamento
  são de outras frentes: `cobblemon:roll`, `npc_render_scale`, `spread_type` dos jigsaw, campfire.
  `scriptevent cobblemon:debug_battle charizard pikachu 50` terminou `(win)` sem erro de script. Com log temporário
  (já removido), a execução mostrou `generic_move`/`thunder`/`flamethrower` tocando animação do poser
  (`animation.charizard.air_physical`, `animation.pikachu.special`), 12 partículas nos locators e os sons
  `cobblemon.move.*`/`cobblemon.impact.*`. As quedas do servidor vistas no meio do trabalho foram OOM do Docker e não
  têm relação com o código; o teste final rodou com `OOMKilled=false`.
- Não foi testado no cliente, porque o BDS não renderiza. Falta conferir visualmente: a direção dos feixes
  (`v.target_*`), o sinal da rolagem, `q.rider_head_x_rotation(0)` e o `pre_effect_script` com `v.entity_*`.
