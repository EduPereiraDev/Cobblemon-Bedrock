# Frente "cliente-log" (BDS `clog`, porta 19173, RakNet)

Erros que o primeiro content log do cliente real mostrou (Windows, Bedrock 26.x,
`ContentLog2026-09-27_05-17-38_1.txt`, 151.612 linhas) e que o BDS não acusa: o servidor não carrega o resource pack e
não valida tudo. Cada categoria foi corrigida na origem (importador, arquivos à mão ou scripts). Uma regra no
`npm run validate` pega a volta de cada uma sem precisar do cliente. Sem commit.

Escopo, depois do ajuste do orquestrador: ficaram aqui sons, berries, features, partículas, barcos e desempenho do
spawner. Animações, Molang de animação, locators e `geometry.gN`/`geometry.default` foram para a frente
`cliente-modelos`. JSON UI é da frente `ui-cliente`.

## Ferramenta para os próximos testes

`node tools/client-log-summary.mjs <ContentLog.txt> [--no-ui] [--category X,Y] [--examples N] [--json] [--all]`

- Tira o caminho `%APPDATA%/.../resource_packs/<pack>/` das linhas.
- Agrupa por categoria/nível e por molde da mensagem. Números, aspas, ids, locators e tokens viram marcadores.
- Mostra os "assuntos" de cada grupo (arquivo, objeto ou caminho) e os valores entre aspas.
- No fim, uma tabela por frente com as regras do validate. O que for diferente de 0 num teste novo aponta a regra que
  deixou passar. Nesta tabela, o log do primeiro teste dá:

| Categoria (frente cliente-log) | Linhas | Assuntos |
|---|---|---|
| som sem arquivo (`sound_definitions` mesclado) | 448 | 224 |
| geometria de bloco fora dos limites (o bloco some) | 3.488 | 16 |
| feature: `v.worldx`/`v.worldz` fora da ordem de avaliação | 14.579 | 11 |
| partícula: `sound_effect` que não é LevelSoundEvent | 144 | 72 |
| partícula: componente/colisão/flipbook recusado | 52 | 26 |
| partícula: Molang recusado | 29 | 14 |
| entidade escrita à mão sem geometria (barcos) | 8 | 4 |
| spawner: passe lento no tick (`[Scripting][warning]`) | 19 | 19 |

A frente cliente-modelos acrescentou a tabela dela no mesmo script.

## Por categoria

### 1. Sons — 448 linhas, 224 arquivos (`[Json][error] sounds/sound_definitions.json Invalid asset path sounds/pokemon/<x>/<x>_cry`)

- **Causa:** `resource_packs/CobblemonBedrock/sounds/sound_definitions.json` é o arquivo herdado do CobbleBuild e o build
  faz deep-merge dele com o gerado. Ele tinha 2.060 definições:
  - 224 apontavam para arquivos que não existem (`sounds/pokemon/<x>/<x>_cry`, `mightyena_quirk1/2`,
    `evolution_notification`);
  - 1.812 estavam vazias (`pokemon.<x>.ambient/cry` sem som);
  - só 24 tinham arquivo.

  Os ids legados (`pokemon.<x>.cry`) não são usados: scripts e animações usam `cobblemon.*`. Busca por
  literais e templates em `scripts/`, `resource_packs/`, `behavior_packs/`, `generated/` e `tools/importer`.
- **Correção:** o arquivo à mão ficou só com as 24 definições que têm arquivo, todas usadas:
  - `medicine_*.use` e `berry.eat` (BagItems, BattleInterpreter);
  - `poke_ball.*`, `pc.*`, `mulch.*`, `healing_machine.active`, `gui.click`, `item.use`, `berry.harvest`.

  Voltaram as 3 músicas de batalha vazias `cobblemon.battle.pv{n,p,w}.default`. O `BattleMusic.ts` monta esse id e o
  `tests/motor.test.ts` confere. O Cobblemon deixa essas músicas vazias para os resource packs.
- **Validate:** `checkSoundDefinitions` (`tools/importer/clientRules.ts`) roda na árvore MESCLADA (gerado + à mão, como em
  `dist/`). Toda definição, gerada ou à mão, precisa de `.ogg`, `.wav` ou `.fsb` em algum dos dois RPs. Antes, só as
  geradas eram conferidas.
- **Prova:**
  - arquivo legado original: 224 erros; atual: 0; gerado: 0;
  - `dist-clog`: 2.269 definições, 0 sem arquivo;
  - teste `sound_definitions escrito à mão…`.

### 2. Berries — 3.488 linhas, 16 blocos

Erros no log:

- `Total length of parts … on axis y is greater than 1 + 14/16ths`: 10 blocos;
- `contains N boxes outside the error bounds of (-0.875..1.875)`: 6 blocos;
- `cannot find geometry.cobblemon.<x>_berry_growth geometry JSON`: 3.456 linhas.

O bloco some.

- **Causa:** `addBerryGrowthBones` (`tools/importer/blocks.ts`) junta numa geometria só o arbusto, as flores e os frutos
  dos `growthPoints` e a muda (idade 0). O cliente mede as caixas JÁ ROTACIONADAS: a wacan tem 28 px sem rotação e
  mesmo assim foi recusada. Os limites são 30 px por eixo e caixas entre -14 e 30 px em y (-22..22 em x/z).
  - pinap, yache e iapapa empilham 10 pontos até 49,5 px;
  - lum, occa e pamtre têm planos rotacionados do arbusto passando de 30 px;
  - nas outras, a muda abaixo do chão somada ao arbusto alto passa de 30 px.
- **Correção:** `fitBerryGrowthGeometry`, com folga de 0,25 px. Os passos vão do mais fiel ao menos fiel:
  1. Sai o ponto de crescimento (flor e fruto juntos) que nem a escala mínima de 92% traz para dentro. Com
     `growthPoints` fixos, o Java enche os pontos na ordem, então os últimos (mais altos) só aparecem em colheitas
     acima de `baseYield`. Saíram: pinap 5 de 10, yache 3 de 10, iapapa 1 de 10.
  2. A muda sobe o necessário, no máximo o que estava enterrado. Ela só aparece sozinha, na idade 0.
  3. Escala uniforme em torno do centro do chão do bloco (a UV por face não muda):
     - lum 92,6%, occa 92,3%, pamtre 97%, grepa 95,6%, chilan 96,9%, kebia 97,1%;
     - rindo e tamato 99,2%;
     - as outras, 100%.

  Mover as partes para uma entidade de exibição foi descartado. Custaria uma entidade por arbusto e script por bloco,
  e daria menos fidelidade que isto.
- **Validate:** `checkBlockGeometry` (`clientRules.ts`, com rotação da hierarquia) roda para TODA geometria citada por
  bloco (`validateContent.ts`).
- **Prova:**
  - calibração com as 859 geometrias usadas por blocos: sobre o `generated/` anterior, a regra acusou exatamente os
    16 blocos do log, e nenhum outro;
  - a contagem de caixas fora bate com a do cliente em 5 de 6 (iapapa 17, lum 6, occa 24, pinap 45, yache 21);
  - hoje: 0;
  - testes `checkBlockGeometry…`, `geometrias de berry geradas…` e `fitBerryGrowthGeometry…`.

### 3. Features — 14.579 linhas, 11 feature rules (`q.heightmap(v.worldx, v.worldz) | unknown variable 'variable.worldx'`)

Ocorrências no log:

| Feature rule | Linhas |
|---|---|
| medicinal_leek | 11.459 |
| apricorn_trees_dense | 2.258 |
| berry_grove_* | ~700 |
| apricorn_trees_normal | 169 |
| structure_fossils_prehistoric_lush_den | 8 |

- **Causa:** `features.ts` e `structures.ts` geravam `coordinate_eval_order: "zyx"`, o que avalia y ANTES de x.
  - A documentação oficial (bedrock-samples `documentation/Features.html`) diz: *"The order in which coordinates will be
    evaluated. Should be used when a coordinate depends on another. If omitted, defaults to 'xzy'"*.
  - Com "zyx", `v.worldz` já existe e `v.worldx` não: o log acusa só `variable.worldx`.
  - A sintaxe `q.heightmap(v.worldx, v.worldz)` está certa. O que estava errado era a ordem.
- **Correção:** `coordinate_eval_order` é `"xzy"` quando o y depende de `v.worldx`/`v.worldz` (`heightDependsOnXz`); nos
  outros casos fica como estava. As 62 feature rules com heightmap usam "xzy".
- **Validate:** `checkScatterFeatureMolang` roda em toda `minecraft:scatter_feature` e na `distribution` de toda feature
  rule. Cada eixo só enxerga os eixos avaliados antes dele; `iterations` e `scatter_chance` não enxergam nenhum.
- **Prova:**
  - `medicinal_leek` atual: 0 problemas; com "zyx", a regra acusa a mesma variável do log;
  - teste `feature rules geradas…`.

### 6. Partículas — 229 linhas, 93 arquivos

- **`[Sound][error] … Event name 'x' is not a valid LevelSoundEvent` (144 linhas, 72 arquivos).**
  - Causa: segundo `documentation/Particles.html` ("name of the level sound event"), o `sound_effect.event_name` de
    partícula só aceita LevelSoundEvents. Nas partículas vanilla há só `block.beehive.drip` e
    `drip.*.pointed_dripstone`. O importador punha eventos de `sound_definitions` (`cobblemon.move.bite.target`,
    `mob.sheep.shear` …).
  - Correção: `clientSafeParticle` (em `particles.ts`, aplicado em `emit()`) tira esses sons do JSON e grava os "cues"
    em `generated/scripts/particleSounds.ts`, com o tempo do disparo e as partículas-filhas já somadas (73 partículas).
    Os tempos vêm de:
    - `emitter_lifetime_events`: `creation`, `timeline`, `expiration` = `active_time`;
    - `particle_lifetime_events`.
  - Quem dispara a partícula por script toca o som no mesmo tempo com `scripts/visual/ParticleSounds.ts`: o
    `ActionEffects.spawnParticle` (53 golpes/status, mais 3 filhas) e o corte do Furfrou (16 `poodle_hair_*`, tesoura).
  - Nomes sem namespace (`status.up.actor`, `move.absorb.actor`) ficariam mudos no Java. Como o evento do Cobblemon com
    esse nome existe, viram alias `cobblemon.<nome>`, na mesma política de `soundAlias`.
  - `entity.generic.explode` vira `random.explode`.
  - A lista de LevelSoundEvents do validate vem das chaves `events` do `sounds.json` vanilla (bedrock-samples
    v1.26.50.4, 543 nomes).
- **`particle_motion_collision | collision_radius | required field does not exist` (9 geradas, 1 de pesca e 3 do MSD).**
  O `SnowstormParticleReader` do Cobblemon DESLIGA a colisão quando falta o raio (`enabled` 0). Por isso o componente
  sai; com `enabled` explícito, fica raio 0,1.
- **`radius is too large, clamping to 0.5`:** `thunder_actor`/`thunder_target` passam de 5 para 0,5, o valor que o cliente
  já usava. A documentação limita a ½ bloco.
- **Flipbook:**
  - `max_frame` ausente: `balls_masterball_battle_ballsendsparkle` passa a 11 quadros, contados pela textura 99×9 (no
    Cobblemon o padrão 0 dá quadro inválido); `metal_sparks`, à mão, passa a 2;
  - `step_UV` em Molang ("Expected Number"; eggbomb, magicalleaf, razorleaf): vira UV por expressão, com o mesmo quadro
    pela idade;
  - `loop: "true"` (mudsport) vira booleano.
- **`Unrecognized component name 'cobblemon:emitter_space'` (9 de `cobblemon_fishing`, à mão):** o componente saiu. Em
  `accessory_fish_splash`, `q.entity_radius` virou `v.entity_radius ?? 0`: o clamp mínimo 1,5 é o valor sem entidade.
- **Molang de partícula (29 linhas):**
  - `)` sobrando em dragonrage, flamecharge×4, flamewheel×2, sandattack×3;
  - vírgula solta em powder_cloud;
  - `math.max` com 4 argumentos em explosion_actorfire.

  `repairParticleMolang` corta no primeiro `)` sem par ou na vírgula de nível de cima (o resto é descartado, como no
  parser tolerante do Snowstorm) e aninha `math.max/min`. Em `statup_actoraura`, filha de `statup_actor`, o log
  acusou `unknown variable 'variable.entity_width'`: a filha não herda as variáveis do pai. As filhas agora recebem
  `v.entity_<x> = v.entity_<x> ?? <padrão>` na criação, com os mesmos padrões do script para espécie sem tamanho.
- **Validate:** `checkParticle` em toda partícula gerada e à mão confere:
  - componente fora da lista `minecraft:*`;
  - colisão sem raio ou com raio acima de 0,5;
  - `max_frame`, `step_UV` numérico e booleanos do flipbook;
  - evento de som fora dos LevelSoundEvents;
  - Molang com parênteses sem par, vírgula solta, `math.max/min` com mais de 2 argumentos e `q.entity_*`.
- **Prova:**
  - antes, 100 arquivos acusados (os 72 sons e todos os outros do log);
  - depois, 0 nas 1.364 partículas (base + MSD);
  - testes `Molang de partícula…`, `clientSafeParticle…`, `partículas geradas e à mão…` e `sons de partícula tocados
    pelo script…`.

### 7. Barcos — 8 linhas, 4 entidades (`cobblemon:apricorn_boat | geometry not found?`, e o mesmo para chest e saccharine)

- **Causa:** as client entities à mão (`entity/boats/*.entity.json`) citavam `geometry.boat`/`geometry.chest_boat`. Esses
  são modelos do renderer nativo do barco e não existem como JSON: não estão em `models/` do bedrock-samples. A
  entidade ficava invisível.
- **Correção:** `resource_packs/CobblemonBedrock/models/entity/boats/{boat,chest_boat}.geo.json` convertem o `BoatModel` e
  o `ChestBoatModel` do Java 1.21.1, que o Cobblemon usa com as próprias texturas. A conversão segue o mapeamento do
  Blockbench e do `TexturedModel` do Cobblemon:
  - pivô `(ox, H−oy, oz)`, com rotação de mesmo valor;
  - `H` = 6 px, porque o `BoatRenderer` faz `translate(0, 0.375, 0)`;
  - osso raiz com `rotation [0, 90, 0]`, porque o `BoatRenderer` faz `rotY(90°)`.

  A UV bate com o mapa de alfa da textura: fundo 0,0; laterais 0,19…0,43; remos 62,0/62,20; baú 0,59/0,76. As 4
  client entities passam a citar `geometry.cobblemon.boat`/`geometry.cobblemon.chest_boat`.
- **Validate:** client entities escritas à mão também precisam citar uma geometria que exista no pack. Das vanilla, só
  as que existem em JSON (`geometry.villager_v2`, `geometry.villager.baby`).
- **Prova:** teste `client entities dos barcos…` e validate OK.
- **Falta:** confirmar no cliente a orientação (proa/popa) e os remos. O modelo segue o Java; a direção da raiz foi
  deduzida e não pôde ser vista sem cliente.

### 8. Desempenho do spawner — 19 linhas (`[Scripting][warning] [spawn] passe lento: 26–148 ms (… seleção 20–124 …)`)

- **Causa:** um passe inteiro rodava num tick só. A seleção percorria as ~1.800 entradas do bioma × 12 posições × cada
  bucket e avaliava `entryAllowed` entrada por entrada. No QuickJS isso fica entre 20 e 124 ms. No mundo hospedado pelo
  cliente, o anfitrião travava.
- **Correção** (a mesma seleção; com semente fixa deu 240/240 iguais e as mesmas leituras de bloco do orçamento):
  - `SpawnSelector.ts`, CPU:
    - índice bioma → bucket → entradas;
    - "grupo de condição" por entrada (tipo de posição + condição + anticondições, ~350 grupos por bioma), com
      `entryAllowed` memorizado por posição no passe e checado antes dos outros filtros (E lógico sem efeito
      colateral);
    - condições dos `weightMultipliers` memorizadas do mesmo jeito;
    - tamanho do hitbox por entrada via `WeakMap`;
    - `removePositions` sem copiar Maps;
    - influências por posição memorizadas.
  - `SpawnConditions.ts`: o relógio do mundo (`timeRange`/`moonPhase`) é lido uma vez por passe (`ctx.clock`), não
    uma vez por condição. Sem `ctx.clock`, continua como antes.
  - Passe fatiado (`spawnPass` em `system.runJob`, `selectSpawnActionsJob`, `resolvePositionsJob`, `makeHasSpaceJob`).
    Cada parte cede o tick por tempo (3–4 ms):
    - zona;
    - posições, entre colunas e no meio da coluna;
    - condições, por posição;
    - candidatas do bucket sorteado, montadas na hora como no síncrono, com a leitura de espaço (`hasSpace`)
      fatiada entre leituras de bloco;
    - cada sorteio;
    - gerar o Pokémon;
    - criar a entidade.
  - No carregamento, um job aquece em fatias os índices, os grupos e os tamanhos das espécies (o `JSON.parse` dos
    dados de cada espécie caía no meio do passe) e o Dex do `@pkmn/sim`.
  - Um passe por jogador em andamento. Com passe em andamento, o timer fica vencido e o próximo começa logo que ele
    termina. A taxa de passes (`ticksBetweenSpawnAttempts` = 20) continua a do Java: no BDS, um passe leva 3–20 ticks.
  - `trySpawnNear`, usado por comandos e testes, continua síncrono (o mesmo gerador, drenado).
- **Prova:**
  - Benchmark (Node `--jitless`, próximo do QuickJS interpretado, 12 posições; script no scratchpad):

    | Medida | Antes | Depois |
    |---|---|---|
    | Seleção síncrona, mediana (`maxSpawns` 3, 4 biomas) | 12,7 ms | 3,2 ms |
    | Seleção síncrona, p90 | 22,9 ms | — |
    | Seleção síncrona, máximo | 39,6 ms | — |
    | Maior fatia do passe fatiado (`maxSpawns` 8, 8 biomas) | — | 3,6 ms |

  - BDS próprio (BDS x86 no box64 do Mac, 5–20× mais lento que o nativo e com a máquina carregada), bot RakNet posto
    no chão com `spreadplayers`, contagem por `testfor @e[family=pokemon]`. Medição temporária por passe:
    - maior fatia de 3 a 11 ms;
    - 3–20 ticks por passe;
    - 1–6 spawns por passe;
    - 68 Pokémon vistos.
  - Sessão final (7 min): 65 Pokémon aos 2 min e 1 único aviso (fatia de 28 ms, no fim, com o bot saindo). Na primeira
    versão (só a CPU otimizada), eram 8 avisos em 150 s, com fatias de 30 a 132 ms. O log do cliente tinha 19 passes
    de 26–148 ms num tick só.
  - O aviso agora diz qual fatia pesou (`passe lento: X ms na maior fatia (<parte>; passe em Y ms de relógio)`), para o
    próximo teste no cliente.
  - Testes:
    - `seleção fatiada (runJob) = seleção síncrona…`;
    - `hasSpace fatiado… = hasSpace síncrono`;
    - os de `tests/spawn.test.ts` e `tests/mundo-final.test.ts` continuam passando.
  - Achado no caminho: o job começa num tick seguinte, e o jogador que saiu nesse meio-tempo gerava
    `Erro no spawner: InvalidEntityError`. Agora o passe confere `player.isValid` antes.

### Fora do escopo (N/A aqui)

- **Das outras frentes:**
  - `cliente-modelos`, com o que o orquestrador tirou do escopo desta frente:
    - `[Animation]` Precomputed cubic, 18.060 linhas;
    - Molang de animação (parênteses, `speed`, `NaN`);
    - locators repetidos;
    - `friendly name 'geometry.g0'/'geometry.default'`;
    - `Required child not found` em controllers;
    - `flabebe.geo.json`;
    - Molang do `metagross.entity.json`;
    - `ctrl.cobblemon.tentacool.quirk0`.
  - `ui-cliente`: `[UI]`, 19.224 linhas.
- **Achados para `cliente-modelos`, não acusados no log:**
  - `animations/pokemon/gumshoos.animation.json` usa `sound_effects` `"effect": "pokemon.gumshoos.cry"` sem mapa na
    client entity. O id legado saiu do `sound_definitions` à mão porque não tinha arquivo, então esse som já era mudo.
  - `torterra_cherry.animation.json` tem na timeline `s.sound('pokemon.torterra.cry', …)`, que não é Molang do Bedrock.
- `[Sound][verbose]` (810) e `[Scripting][inform]`/`[verbose]` foram ignorados, como pedido.

## Arquivos

| Tipo | Arquivos |
|---|---|
| Regras do cliente | `tools/importer/clientRules.ts` (novo) |
| Importador | `tools/importer/blocks.ts` (`fitBerryGrowthGeometry`), `tools/importer/features.ts`, `tools/importer/structures.ts` (`coordinate_eval_order`), `tools/importer/particles.ts` (`clientSafeParticle`, `repairParticleMolang`, `flattenParticleSounds`, `particleSounds.ts`; a linha da frente msd-fase3 foi mantida) |
| Validate | `tools/importer/validate.ts` (sons mesclados, partículas, client entities à mão), `tools/importer/validateContent.ts` (limites de geometria de bloco, scatter/feature rules) |
| Ferramenta | `tools/client-log-summary.mjs` (novo; a frente cliente-modelos acrescentou a tabela dela) |
| RP à mão | `sounds/sound_definitions.json`, `particles/cobblemon_fishing/*.json` (9), `particles/metal_sparks.particle.json`, `entity/boats/*.entity.json` (4), `models/entity/boats/{boat,chest_boat}.geo.json` (novos) |
| Scripts | `scripts/visual/ParticleSounds.ts` (novo), `scripts/battle/effects/ActionEffects.ts` (1 chamada), `scripts/entity/Interactions.ts` (1 chamada), `scripts/spawning/SpawnSelector.ts`, `scripts/spawning/Spawner.ts`, `scripts/spawning/SpawnConditions.ts` (`hasSpaceJob`, `clock`) |
| Teste | `tests/cliente-log.test.ts` (17 casos) |

Coordenação: vários destes arquivos são de outras frentes. Em todos a mudança foi pequena e está comentada com
"Frente cliente-log":

- ActionEffects/Interactions (animacao/visual-final);
- Spawner/SpawnSelector (spawn);
- barcos (mundo-sons);
- partículas de pesca (pesca);
- validate/validateContent.

## Verificação

- `npm run import`: OK. Contagens:
  - berries: 9 pontos removidos, 16 mudas erguidas, 9 escalas;
  - partículas: 8 colisões sem raio, 2 raios, 1 `max_frame`, 3 flipbooks por expressão, 73 com sons no script.
- `npm run validate`: OK, nenhum erro (base e árvore efetiva com MSD).
- `npx tsc -p tsconfig.json`: 0 erros.
- `npm test`: todos passam, incluindo `tests/cliente-log.test.ts` (17 ok).
- BDS próprio (`COBBLEMON_DIST=dist-clog COBBLEMON_BDS=clog COBBLEMON_BDS_PORT=19173 COBBLEMON_BDS_TRANSPORT=raknet`,
  `ONLINE_MODE=false` para o bot):
  - `sound_definitions` do `dist-clog`: 2.269 definições, 0 sem arquivo;
  - content log do servidor: 0 grupos;
  - log: nenhum ERROR/WARN de conteúdo;
  - sobraram só o aviso fixo de transporte RakNet do BDS, as saídas "No targets matched selector" dos meus `testfor`
    e 1 aviso de spawner (acima);
  - container, `dist-clog` e `.bds-clog` removidos ao fim, assim como o bot temporário `tests/e2e/.clog-bot.tmp.mjs`.
- **Falta:** confirmar no cliente real (Windows) os barcos (orientação/remos), as berries ajustadas e os sons das
  partículas por script. O próximo content log passa por `node tools/client-log-summary.mjs <log> --no-ui`; a tabela da
  frente deve dar 0.
