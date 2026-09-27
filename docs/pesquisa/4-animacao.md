# Pesquisa 4 — Animação (posers Kotlin, procedurais, montaria, texturas animadas, partículas/sons, efeitos de golpe, emissivos)

> Data: 2026-09-26. Alvo: Bedrock 26.x (resource pack sem experimentais), `@minecraft/server` 2.x estável.
> Base: Cobblemon 1.8.2 em `upstream/cobblemon`, importador em `tools/importer`, relatório `generated/import-report.json`.
> Protótipos em `$SCRATCH/pesquisa-animacao` (scratchpad da sessão; nada do código do projeto foi alterado).
> Relatório escrito de forma incremental.


## Resumo executivo

| # | Frente | Situação hoje | Solução proposta | Cobertura estimada | Prioridade |
|---|---|---|---|---|---|
| 1 | Posers em Kotlin | 293 posers "de reserva" por convenção de nomes | Parser determinístico Kotlin → JSON de poser (protótipo pronto) | 285/308 arquivos sem pendência (92,5%); 2001/2027 animações (98,7%); 0 ossos inexistentes | **P0** |
| 7 | 8 espécies sem idle | Puladas | Cai junto com o item 1 (pose sem animação é válida) | 8/8 | **P0** (grátis com o 1) |
| — | Bug achado: `transformedParts.position` | Y copiado como está | Negar Y (espaço Java → animação Bedrock) | 78 transformações em 32 posers | **P0** (1 linha) |
| 2 | Procedurais (`pitch_tilt` etc.) | 204 `pitch_tilt` ignorados | Molang com `q.vertical_speed`/`q.ground_speed` + variável suavizada | 204/204 | P1 |
| 3 | Molang de montaria `q.r.*` | Tudo vira 0 (e `q.is_ridden` = 0 desliga as poses de montaria) | Queries do cliente + molas em `v.*`; só estilo de montaria vai por propriedade | 93% com queries do cliente + 7% (`input_*`) por proxy ou propriedade | P1 |
| 5 | Partículas/sons das animações | 35 partículas e 40 sons removidos | Importar sob demanda as partículas Bedrock do Cobblemon (1.101) + aliases de som | 35/35 partículas; 26/40 sons | P1 |
| 4 | Texturas animadas | 40 reduzidas ao 1º quadro | Array de texturas indexado por Molang (sem material custom) | 40/40 | P2 |
| 8 | Camadas emissivas | `ignore_lighting` no render controller | Manter p/ translúcidas; `entity_emissive_alpha` + PNG pré-processado p/ opacas | — | P2 |
| 6 | Efeitos de golpe (`action_effects`) | Só poses simples | Intérprete em script (animação + partícula + som com tempo) | ver seção 6 | P2/P3 |

_(Seções detalhadas abaixo; a 7 vem logo depois da 1 porque depende dela. Plano consolidado na seção 9.)_

## 1. Posers em Kotlin → dados (JSON de poser)

### 1.1 O que existe no Cobblemon 1.8.2

- `VaryingModelRepository.registerPosers()` chama `registerInBuiltPosers()` (334 `inbuilt(...)`, sendo 332 de Pokémon) e
  **depois** `registerJsonPosers()`. Como os dois gravam no mesmo mapa `posers[ResourceLocation]`, o JSON vence quando existe.
- Posers JSON: 726 arquivos em `bedrock/pokemon/posers`. Posers **só em Kotlin**: **308**, dos quais **301 são usados**
  por algum resolver (`variations[].poser`). O importador hoje gera 293 "posers de reserva" (a diferença são espécies
  `implemented != true`).
- As 301 classes usam um **vocabulário fechado e muito repetitivo** (contagem nas 301 classes):
  `registerPose` 1.154, `bedrock` 1.217, `bedrockStateful` 821, `singleBoneLook` 673, `quirk` 342,
  `createTransformation` 323, `CryProvider` 220, `getFaintAnimation`+`isPosedIn` ~220, `BipedWalkAnimation` 46,
  `BimanualSwingAnimation` 28, `QuadrupedWalkAnimation` 25, `WingFlapIdleAnimation`/`wingFlap` 31,
  `WaveAnimation` 5, `rotation/translation(sineFunction|parabolaFunction)` ~12.
- Condições de pose (lambdas `condition = { ... }`) têm só **50 formas distintas**, todas conjunções de
  `it.isBattling`, `it.isInWater`, `it.isUnderWater`, `isInWaterOrRain`, `isDusk()`, `isStandingOn(setOf(...))`,
  `containsAspect(HAS_BEEN_SHEARED)`, `isFalling()`, `ownerUUID == null`. Todas têm equivalente direto nas chaves do
  JSON de poser (`isBattle`, `isTouchingWater`, `isUnderWater`, `isInWaterOrRain`, `isDusk`, `isStandingOnSand`…),
  que `posers.ts/poseCondition` já traduz.

### 1.2 Estratégia

Não "rodar Kotlin": converter cada classe para **o mesmo JSON que o Cobblemon aceita em `posers/`** e entregar ao
`PoserFactory.fromJson` já existente. Assim a lógica de controllers/quirks/transformações continua num lugar só.

Mapeamento Kotlin → JSON de poser:

| Kotlin | JSON de poser gerado |
|---|---|
| `rootPart = root.registerChildWithAllChildren("x")` | `"rootBone": "x"` |
| `override val head = getPart("h")` (e `leftLeg`, `foreLeftLeg`, `leftArm`, `leftWing`…) | tabela nome→osso usada nos helpers |
| `registerPose(poseName=…, poseTypes=A + B - C, …)` / `poseType = PoseType.SLEEP` | `poses[nome].poseTypes` (conjuntos `STATIONARY_POSES`, `MOVING_POSES`, `UI_POSES`… expandidos) |
| `condition = { it.isBattling && !it.isInWater }` | `"isBattle": true, "isTouchingWater": false` |
| `bedrock("g","a")` / `bedrockStateful(…)` | `"q.bedrock('g', 'a')"` / `"q.bedrock_stateful('g', 'a')"` |
| `singleBoneLook(minPitch=-15F, …)` | `"q.look('<head>', pm, ym, maxPitch, minPitch, maxYaw, minYaw)"` (padrões 70/-45/45/-45; `invertX/disableX`→multiplicador) |
| `BipedWalkAnimation(this, periodMultiplier, amplitudeMultiplier)` | `"q.biped_walk(p, a, '<leftLeg>', '<rightLeg>')"` |
| `QuadrupedWalkAnimation(this, …)` | `"q.quadruped_walk(p, a, fl, fr, bl, br)"` |
| `BimanualSwingAnimation(this, …)` | `"q.bimanual_swing(p, a, '<leftArm>', '<rightArm>')"` |
| `WingFlapIdleAnimation(this, flapFunction = sineFunction(…), axis = Y_AXIS)` / `wingFlap(…)` | `"q.sine_wing_flap(amp, period, shift, 'y', left, right)"` |
| `part.rotation(sineFunction(…), axis) { state.animationSeconds }` | **extensão nova** `q.cobblemon_wave('rotation', osso, eixo, amp, period, phase, shift, 'anim'|'limb')` |
| `WaveAnimation(…segments…)` | **extensão nova** `q.cobblemon_wave_chain(…)` |
| `val blink = quirk(5F to 24F, loopTimes = 1..3) { bedrockStateful("g","blink") }` | `"q.bedrock_quirk('g', 'blink', 5, 24, 3)"` |
| `createTransformation().addPosition(Y_AXIS, 2F).withVisibility(false).addRotation(X_AXIS, 20F.toRadians())` | `transformedParts: [{part, position:[0,2,0] (espaço Java), rotation:[20,0,0] (graus), isVisible:false}]` |
| `namedAnimations = mutableMapOf("faint" to faint)` | `poses[n].namedAnimations.faint` |
| `cryAnimation = CryProvider { if (it.isBattling) A else B }` | `animations.cry = B` + `namedAnimations.cry = A` nas poses `isBattle: true` |
| `getFaintAnimation(state) = if (state.isPosedIn(a, b)) bedrockStateful(…) else null` | `namedAnimations.faint` nas poses `a`, `b` (`isNotPosedIn` = complemento; sem `if` = `animations.faint`) |

### 1.3 Protótipo e cobertura medida

Protótipo: `$SCRATCH/pesquisa-animacao/kotlinPosers.ts` (TypeScript puro, Node 22 `--experimental-strip-types`, sem
dependências). Remove comentários, acha chamadas por parênteses balanceados, lê argumentos nomeados e traduz **somente**
o vocabulário acima; qualquer coisa fora dele vai para `unsupported` (nunca é adivinhada).

Amostra de 10 arquivos espalhados pela lista (aggron, butterfree, dartrix, flittle, hitmonlee, loudred, naganadel,
quaquaval, sirfetchd, typhlosion): **10/10 sem pendência, 39 poses, 78/78 animações** (depois de 3 regras extras:
`translation(...) { lambda }`, `getFaintAnimation` sem `if`/com `isNotPosedIn`, e `CryProvider` com `isBattling`).

Rodando em **todos os 308** posers só-Kotlin:

```text
arquivos=308 sem pendência=285 (92.5%) poses=1170 animações convertidas=2001/2027 (98.7%)
pendências: anim(faint como val)=24 · wingFlap(triangleFunction)=12 · SingleBoneLookAnimation(posicional)=8 ·
            getFaintAnimation(when/complexo)=7 · cry(when)=5 · rotation/translation(parabolaFunction)=6
```

Conteúdo gerado (agregado): 1.184 `q.bedrock`, 682 `q.look`, 1.027 quirks, 375 `transformedParts`, 216 `cry`,
49 `biped_walk`, 28 `bimanual_swing`, 25 `quadruped_walk`, 25 `sine_wing_flap`, 8 ondas; 260 poses com `isBattle`,
125 com `isTouchingWater`, 49 com `isUnderWater`.

**Validação cruzada com a geometria**: todos os 598 ossos citados por look/walk/wing/transformações existem nos
`.geo.json` dos modelos usados pelos resolvers daquele poser — **0 ossos ausentes**.

Pendências restantes (≈23 arquivos) são todas de um conjunto pequeno e nomeado: Pidove/Tranquill/Squawkabilly
(`parabolaFunction` para pulinho), Yanma/Yanmega/Vibrava (`triangleFunction` em asas de inseto), Dodrio/Exeggutor/
Tandemaus (`SingleBoneLookAnimation(boneN, false, false, …)` posicional — várias cabeças), `when {}` em cry de
Arctovish/Dracovish/Hippowdon, e 7 `getFaintAnimation` com `when`. Cada caso é 1 regra de 5–15 linhas.

**É determinístico o bastante para rodar nos 290+?** Sim, com duas salvaguardas: (1) a conversão falha de forma
explícita (lista `unsupported` no `import-report.json`), e o poser cai no modo de reserva atual só nesses casos;
(2) congelar a saída em `tools/importer/data/kotlin-posers/*.json` (gerada por um comando separado,
`npm run import:kotlin-posers`) e revisar o diff quando o `upstream/cobblemon` mudar. Isso evita que o import normal
dependa de um parser de Kotlin e torna o resultado auditável.

### 1.4 Bug encontrado no caminho: sinal do Y em `transformedParts`

`ModelPartTransformation.apply()` soma `position` direto em `ModelPart.x/y/z` (espaço do Java, **Y para baixo**), e o
`ModelPartTransformationAdapter` lê o JSON sem converter. Já as animações Bedrock do Cobblemon negam o Y de posição ao
aplicar (`MolangBoneValue.yMul = -1` para POSITION). `posers.ts/transformAnimation` copia `t.position` como posição
de animação Bedrock **sem negar o Y**. Efeito: 78 transformações em 32 posers JSON sobem em vez de descer (ex.:
`charizard/surface_idle` `body [0, 22, 0]` deveria afundar 22 px na água; `magikarp/surface_*` `[0, 6, 0]`).
Correção (1 linha em `transformAnimation`): `b.position = [x, -y, z]`. Rotação não muda (graus, mesmo sinal — as
animações Bedrock do Cobblemon fazem `xRot += rot.x.toRadians()` sem trocar sinal).

### 1.5 Receita de integração (`tools/importer`)

1. `tools/importer/kotlinPosers.ts` (novo, a partir do protótipo): exporta `convertKotlinPoser(file)`.
2. `posers.ts/PoserFactory`: no construtor, além de `jsonPosers`, montar `kotlinPosers` = `inbuilt(...)` sem JSON
   (regex em `VaryingModelRepository.kt`) → arquivo `.kt`. Em `get()`: JSON → Kotlin convertido → reserva.
3. `GenContext.idleAnimation`: novos casos `cobblemon_wave`/`cobblemon_wave_chain` (fórmulas na seção 2).
4. `fromJson`: aceitar pose com `animations: []` (ver seção 7) e `transformAnimation` com Y negado (1.4).
5. `import-report.json`: nova contagem "posers Kotlin convertidos" e lista de pendências por arquivo.

## 7. As 8 espécies sem idle

As 8 puladas (tangela, pupitar, lillipup, herdier, jellicent, durant, bounsweet, pyukumuku) **são todas posers
Kotlin**, e no próprio Cobblemon **não têm animação de idle**: ficam na pose de repouso da geometria, com `look`,
caminhada procedural e quirks. Saída do protótipo:

| Espécie | Grupo de animação | Poses convertidas do Kotlin |
|---|---|---|
| tangela | só `cry` | standing: (nenhuma) · walk: `biped_walk(0.4, 1, leftfoot, rightfoot)` |
| pupitar | `blink`, `cry` | standing/walk vazias + quirk blink |
| lillipup / herdier | `blink`, `cry` | standing: `look(head)` · walk: `quadruped_walk(1.1, 1.4, …)` + `look` |
| jellicent | `render`, `blink` | `look` + `bedrock('jellicent','render')` |
| durant | `blink`, `cry`, `ground_walk` | standing: `look` · walk: `look` + `ground_walk` |
| bounsweet | sem arquivo de animação | walk: `biped_walk(1, 0.5, left_foot, right_foot)` |
| pyukumuku | sem arquivo de animação | standing vazia (estátua, como no Cobblemon) |

Receita: (a) com o item 1 elas deixam de cair no "reserva"; (b) em `posers.ts` não exigir idle — um estado de
controller sem animações é válido (ossos ficam na pose do `.geo`, igual ao Cobblemon); (c) no modo reserva
(sem Kotlin), gerar pose `standing` só com `look` quando houver `head`/`head_ai`. **Não** sintetizar "respiração"
artificial por padrão (o Cobblemon não tem); se desejado, opcional atrás de flag:
`"body": {"scale": [1, "1 + 0.012 * math.sin(q.anim_time * 120)", 1]}`.

## 2. Animações procedurais (walk, braços, asas, `pitch_tilt`, `look`, ondas)

### 2.1 Convenções que tornam a tradução exata

Verificadas no código do Cobblemon:

- **Rotação**: as classes Kotlin somam radianos em `ModelPart.xRot/yRot/zRot`; as animações Bedrock do Cobblemon fazem
  `xRot += rotation.x.toRadians()` **sem trocar sinal** (`BedrockAnimation.kt`). Logo `addRotation(eixo, r)` no Kotlin
  = canal `rotation` com `r × 57,29578°` e **mesmo sinal** no Bedrock.
- **Posição**: animações Bedrock do Cobblemon negam o Y (`MolangBoneValue.yMul = -1` para POSITION); somas diretas em
  `ModelPart.y` (Kotlin/`transformedParts`) têm de ter o **Y negado** ao virar animação Bedrock.
- **Tempo**: `limbSwing` ↔ `q.modified_distance_moved`; `limbSwingAmount` ↔ `q.modified_move_speed` (o próprio vanilla
  usa `math.cos(q.modified_distance_moved * 38.17) * 80 * q.modified_move_speed` = `cos(ls·0,6662)·1,4 rad·lsa`);
  `ageInTicks` ↔ `q.life_time * 20`; `state.animationSeconds` ↔ `q.anim_time`. `headPitch/headYaw` ↔
  `q.target_x_rotation/q.target_y_rotation` (mesma escolha já usada em `posers.ts`).
- Trigonometria do Molang (`math.sin/cos/atan/atan2`) é em **graus**.

O importador **já traduz corretamente** `biped_walk`, `quadruped_walk`, `bimanual_swing`, `sine_wing_flap` e `look`
(conferi fórmula a fórmula contra `BipedWalkAnimation`, `QuadrupedWalkAnimation`, `BimanualSwingAnimation`,
`WingFlapIdleAnimation`, `SingleBoneLookAnimation`). O buraco real dos "205 procedurais ignorados" é:
**204 × `q.pitch_tilt`** (160 `'body'`, 30 `'body', 1`, 11 `'body', 0.22`, 3 `'head'`) + 1 `bedrock_quirk` colocado por
engano em `animations` (beldum). Os 105 "`q.look` em osso inexistente" **não são lacuna**: no Cobblemon
`getPart()` lança exceção, `JsonPose` captura e descarta a animação — o pokémon também fica sem look lá.

### 2.2 Fórmulas (espelho do Kotlin)

| Kotlin | Bedrock (canal `rotation` salvo indicação) |
|---|---|
| `BipedWalk(p,a)` perna esq./dir. | `math.cos(q.modified_distance_moved * P + {0|180}) * A * q.modified_move_speed`, `P = p·57,296`, `A = a·57,296` |
| `QuadrupedWalk(p,a)` | frente-esq. e trás-dir. fase 0; frente-dir. e trás-esq. fase 180 |
| `BimanualSwing(p,a)` | Y: `cos(dist·P)·A·speed ∓ sin(q.life_time·20·3,839)·2,865`; Z: `±(cos(q.life_time·20·5,157)·2,865 + 2,865)` |
| `sineFunction(amp, per, phase, shift)(t)` | `math.sin(360/per * (t - phase)) * amp·57,296 + shift·57,296` |
| `triangleFunction(amp, per, phase, shift)(t)` | `4·amp°/per * math.abs(math.mod(t + 3per/4 - phase, per) - per/2) - amp° + shift°` |
| `parabolaFunction(peak, per)(t)` | `(-4·peak/per²) * math.pow(math.mod(t, per) - per/2, 2) + peak` |
| `WingFlapIdle(f, t, eixo)` | asa esq. `+f(t)`, dir. `-f(t)` no eixo |
| `part.translation(f, Y_AXIS)` | canal `position`, **`-f(t)`** em Y (px, sem conversão de unidade) |
| `WaveAnimation` (cauda em N segmentos) | por segmento i: `θi = math.atan((f(t+t1ᵢ) - f(t+t2ᵢ)) / (t2ᵢ - t1ᵢ))`, rotação `θi - θi-1`; `t1ᵢ/t2ᵢ` dependem só dos comprimentos → **constantes no import** |
| `SingleBoneLook` com `pitch_tilt` ativo | pitch `- v.<tilt>` (o Kotlin desconta a inclinação já aplicada no corpo) |

`pitch_tilt(bone, maxChangePerTick=1.5, min=-45, max=45)` — o Kotlin roda em `setupAnim` (por **quadro**), lê
`deltaMovement`, calcula `-clamp(atan2(vy, horizontal))` e limita a variação por chamada; não roda com passageiro.
Bedrock: estado numa variável da entidade, atualizada no `pre_animation` (também por quadro):

```jsonc
// client entity → scripts.pre_animation (uma por (osso, parâmetros) usada pelo poser)
"v.cobblemon_pt_body_t = q.has_rider ? 0 : -math.clamp(q.ground_speed < 0.01 ? (q.vertical_speed > 0.01 ? 45 : (q.vertical_speed < -0.01 ? -45 : 0)) : math.atan2(q.vertical_speed, q.ground_speed), -45, 45);",
"v.cobblemon_pt_body = (v.cobblemon_pt_body ?? 0) + math.clamp(v.cobblemon_pt_body_t - (v.cobblemon_pt_body ?? 0), -1.5, 1.5);"
// animação sintética
"animation.cobblemon_gen.pidgeot.pitch_tilt": { "loop": true, "bones": { "body": { "rotation": ["v.cobblemon_pt_body", 0, 0] } } }
```

`q.vertical_speed` e `q.ground_speed` são m/s calculados no cliente (Microsoft Learn), sem custo de rede.

### 2.3 Protótipos

`$SCRATCH/pesquisa-animacao/procedural.ts` gera `proto/procedural_demo.animation.json` com casos reais:

- **Bípede**: tangela (`BipedWalkAnimation(this, 0.4F, 1F)` em `leftfoot/rightfoot`).
- **Quadrúpede**: lillipup (`QuadrupedWalkAnimation(this, 1.1F, 1.4F)`, pernas traseiras `leg_back_*1`) + `look`.
- **Voador**: pidgeot (`q.pitch_tilt('body')` + look descontando a inclinação) e xatu
  (`wingFlap(sineFunction(verticalShift=-10°, period=0.9, amplitude=0.6), eixo Y)`); Yanma com `triangleFunction`.
- Extras: naganadel (`rootPart.translation(sine)` — flutuação) e huntail (`WaveAnimation` de 6 segmentos).

Todas as 25 expressões passam no validador de Molang do projeto (`BEDROCK_QUERIES`/`BEDROCK_MATH` de
`tools/importer/molang.ts`) e têm parênteses balanceados.

### 2.4 Integração

- `posers.ts/GenContext.idleAnimation`: caso `pitch_tilt` (gera animação + linhas de `pre_animation`; o `PoserOutput`
  ganha `preAnimation: string[]` somado em `entities.ts`), casos `cobblemon_wave`/`cobblemon_wave_chain` (Kotlin),
  e `lookAnimation` recebendo a variável de tilt quando a mesma pose tem `pitch_tilt`.
- Cobertura: 204/204 `pitch_tilt`; 100% dos procedurais dos posers Kotlin convertidos pelo item 1 (inclusive as
  `triangleFunction`/`parabolaFunction` pendentes, com as fórmulas acima).

## 3. Molang de montaria (`q.r.*` / `q.riding.*`)

### 3.1 O que o Cobblemon calcula

`PosableState.ridingFunctions` lê `RidingAnimationData`, atualizado **por tick** com molas `Vec3Spring`
(k = 90, amortecimento 18, dt = 1/20) sobre: velocidade do mundo (`x - xOld`, blocos/tick), velocidade local
(rotacionada pelo yaw — ou pela orientação completa em estilos que rolam), rotação (pitch/yaw/roll), **taxa** de
rotação (graus/s), entrada do condutor (`xxa`, `zza`, pulo/agachar) e "mergulho" `max(sin(pitch), 0)`. O argumento
`N` de `q.r.x(N)` é a média dos últimos N ticks (máx. 20). Saídas normalizadas: `yaw_change = taxa/-140`,
`pitch_change = taxa/140`, `pitch = pitch/90`, velocidades em blocos/tick, tudo com clamp em [-1, 1] (`dive` em [0, 1]).

Uso nas animações (contagem em `bedrock/pokemon/animations`): `yaw_change` 2.462, `velocity_y` 2.368, `dive` 1.059,
`pitch_change` 826, `input_forward` 378, `velocity_up` 153, `roll_change` 123, `velocity_forward` 95,
`input_right` 86, `velocity_right` 63, `input_up` 55, `target_distance_x/y` 26 (**não existe** no Cobblemon — vale 0
lá também), `pitch` 4, `speed` 1. Total 7.699; `input_*` = 519 (6,7%).

**Atenção**: hoje `COMMON_QUERY_MAP` troca `q.is_ridden` por `0.0`, então as **83 poses de montaria em 53 posers
JSON** nunca são escolhidas — os `q.r.*` só importam depois de mapear `q.is_ridden → q.has_rider` (query estável) e
`q.riding_style` para uma propriedade.

### 3.2 Mapeamento (tudo no cliente, sem rede, exceto `input_*` opcional)

| `q.r.*` | Fonte no cliente (pre_animation, por quadro) | Observação |
|---|---|---|
| `velocity_y` / `velocity_up` | `q.vertical_speed / 20` → mola | blocos/tick como no Cobblemon |
| `velocity_x/z`, `speed` | `(q.position(i) - v.prev_i) / q.delta_time / 20` → mola | `q.position` é interpolado → suave |
| `velocity_forward` | `-sin(yaw)·vx + cos(yaw)·vz` → mola, `yaw = q.body_y_rotation` | mesma matriz de `RidingAnimationData` (estilos sem rolagem) |
| `velocity_right` | `cos(yaw)·vx + sin(yaw)·vz` → mola | idem (o "right" do Cobblemon aponta para a esquerda do modelo — reproduzido tal qual) |
| `yaw_change` | `math.min_angle(yaw - v.last_yaw) / q.delta_time` → mola → `/ -140` | `q.yaw_speed` tem unidade não documentada; derivar é mais seguro |
| `pitch`, `pitch_change`, `dive` | `q.rider_head_x_rotation(0)` (olhar do condutor) → mola; `dive = max(sin(pitch), 0)` | montaria do Bedrock não inclina a entidade; o olhar do condutor é o melhor substituto |
| `roll`, `roll_change` | `0` | como estilos sem rolagem do Cobblemon; opcional: rolagem ∝ `yaw_change` |
| `input_forward/right/up` | (a) proxy: sinal da velocidade local × 8, clamp; (b) propriedade `cobblemon:ride_input` (int 0–26, 3 trits) | ver 3.3 |
| `target_distance_x/y` | `0` | igual ao Cobblemon |
| `(N)` | média exponencial com τ = N/40 s (`v = v + (x - v)·min(1, dt·40/N)`) | N limitado a 19 como no `Vec3Spring` |

Mola por quadro (mesma dinâmica contínua do `Vec3Spring`):
`v.s_v = v.s_v + (90·(alvo - v.s) - 18·v.s_v)·dt; v.s = v.s + v.s_v·dt`, com `dt = math.clamp(q.delta_time, 0.001, 0.05)`.

### 3.3 Rede e desempenho

- Tudo acima roda no cliente: **zero** tráfego. Custo: ~25 linhas de Molang por espécie que monta (Charizard);
  embrulhar em `q.has_rider ? { … };` para não pagar fora da montaria.
- Só o que o cliente não sabe vai por propriedade `client_sync`: `cobblemon:ride_style` (propriedade `enum` `["NONE","LAND","AIR","LIQUID"]`, muda só na
  troca de estilo — `Riding.ts` já detecta a troca); `q.property('cobblemon:ride_style') == 'AIR'` compara string direto, e **opcionalmente**
  `cobblemon:ride_input` (int) a partir de `player.inputInfo.getMovementVector()` + `getButtonState(InputButton.Jump/Sneak)`
  (API estável em `@minecraft/server` 2.10). Gravar **só quando o valor muda** (propriedades são sincronizadas por
  mudança): no pior caso alguns updates/s por montaria, contra 20/s se fosse contínuo. Sem a propriedade, o proxy por
  velocidade cobre os 6,7% de `input_*` com boa aparência.

### 3.4 Protótipo

`$SCRATCH/pesquisa-animacao/riding.ts` (`RidingMolang.rewrite()` + `preAnimation()`), aplicado às 4 animações
`ride_*` do Charizard: 138 expressões reescritas, 25 linhas de `pre_animation`. Lint: tudo válido, exceto que
`q.rider_head_x_rotation` **falta na lista `BEDROCK_QUERIES` do projeto** (a query existe — Microsoft Learn,
"Molang Query Functions"); acrescentar `rider_head_x_rotation`, `rider_head_y_rotation`, `rider_body_x_rotation`,
`rider_body_y_rotation` à lista.

Integração: `molang.ts` (`is_ridden → q.has_rider`, `riding_style → q.property('cobblemon:ride_style')`, propriedade enum), `animations.ts/convert` chama `RidingMolang.rewrite` por grupo e devolve as linhas de
`pre_animation` junto com `EmittedEffects`; `entities.ts` soma essas linhas; `scripts/entity/Riding.ts` grava
`cobblemon:ride_style` na troca de estilo.

## 4. Texturas animadas (flipbook)

### 4.1 No Cobblemon

Resolver com `texture: { frames: [...], fps, loop }` (na textura base ou numa camada). `AnimatedModelTextureSupplier`:
`frame = floor(state.animationSeconds * fps) % frames.size` (sem loop: fica no último). Nenhum resolver 1.8.2 usa
`interpolation` nem `scrolling`. As **40** ocorrências (17 arquivos): 32 em camadas (quase todas emissivas; 2–8
quadros; 8 ou 10 fps) e 8 na textura base (3–8 quadros), todas com `loop: true` — ex.: chamas de
charmander/charmeleon/charizard, ponyta/rapidash, slugma/magcargo (normal e shiny), golurk, braviary de Hisui, toxel…

### 4.2 Opções no Bedrock

| Opção | Como | Prós | Contras |
|---|---|---|---|
| **A. Array de texturas indexado por Molang** (recomendada) | Cada quadro é uma `Texture.*` separada (os PNGs já vêm separados); `Array.tex` com `combos × F` entradas; índice `variante·F + quadro` | Materiais **vanilla** (`entity_alphatest`/`entity_alphablend`), nada de `.material`; cada combo pode ter seu fps; reaproveita o render controller de camadas que já existe | Array maior (ex.: 3 combos × 4 = 12) — irrelevante |
| B. `uv_anim` no render controller | Empilhar quadros na vertical num PNG só; `uv_anim: {offset: [0, "math.mod(math.floor(t*fps), n)/n"], scale: [1, "1/n"]}` | Receita documentada (Bedrock Wiki, "Entity Texture Animation") | Exige material custom com `USE_UV_ANIM` em **todos** os materiais da entidade; o próprio guia avisa que arquivos `.material` ficaram "outdated" com o RenderDragon e a Microsoft diz que custom materials podem ser removidos — risco em consoles/Realms; e a UV afeta o modelo todo, então só serve se a textura base animar |

Receita A (protótipo `$SCRATCH/pesquisa-animacao/animatedTextures.ts` → `proto/charmander_flipbook.render_controllers.json`):

```jsonc
"controller.render.cobblemon.pokemon.charmander.layer0": {
  "arrays": {
    "geometries": { "Array.geo": ["Geometry.charmander", "Geometry.charmander", "Geometry.charmander"] },
    "textures": { "Array.tex": ["Texture.flame1","Texture.flame2","Texture.flame3","Texture.flame4",
                                "Texture.shiny_flame1", "…", "Texture.flame4"] }
  },
  "geometry": "Array.geo[q.property('cobblemon:variant')]",
  "materials": [{ "*": "Material.layer_translucent" }],
  "textures": ["Array.tex[q.property('cobblemon:variant') * 4 + math.mod(math.floor(v.cobblemon_tex_t * 10), 4)]"],
  "ignore_lighting": true
}
// client entity → pre_animation:  "v.cobblemon_tex_t = (v.cobblemon_tex_t ?? 0) + q.delta_time;"
```

- Relógio: usar `v.cobblemon_tex_t` acumulado com `q.delta_time` no `pre_animation` em vez de `q.life_time`
  direto no render controller (a documentação de `q.life_time` fala em "tempo desde o início da animação"; a variável
  evita depender desse detalhe). Combos com fps/nº de quadros diferentes: o protótipo gera
  `v.cobblemon_tex_frame` por variante no `pre_animation` e o índice usa essa variável.
- Combos estáticos dentro do mesmo canal repetem a mesma textura nos F quadros; camada ausente usa `Texture.blank`.
- Integração: `variants.ts` (hoje reduz ao 1º quadro) passa a emitir todos os quadros como texturas e a lista
  `frames/fps` por combo; `entities.ts/emitClientEntity` usa `flipbookChannel()` no canal base e em cada camada.
- Cobertura: 40/40.

## 5. Partículas e sons referenciados por animações

### 5.1 Partículas

- O Cobblemon traz **1.101** partículas em formato Bedrock/Snowstorm (`assets/cobblemon/bedrock/particles/**`; 127 pastas
  de golpes, `generic/`, `pokemon/`…). Materiais só vanilla (`particles_alpha` 745, `particles_blend` 349,
  `particles_add` 7).
- Os "35 removidos" do relatório são **20 efeitos distintos**; 11 já existem no RP manual e os outros **9 existem no
  Cobblemon** (nenhum inexistente): `lucario_aura`, `krabby_bubble_handler` (krabby/kingler), `annihilapeglare`,
  `hooh_tailtrail`, `heavy_collapse_smoke` + `heavy_collapse_lines` (desmaio do magnezone),
  `torkoal_particle_handler`, `impact_electric` (chinchou, 14 usos), `blastoise6`. Com dependências (partículas
  disparadas por `events`), são ~15 arquivos.
- Incompatibilidades a tratar na cópia (medido nos 1.101):
  - `cobblemon:emitter_space` `{"scaling": "entity"}` em **585** arquivos — componente só do Cobblemon (escala o
    emissor pelo tamanho da entidade). Remover na cópia; o efeito de escala se perde (partícula do mesmo tamanho em
    pokémon grande/pequeno), aceitável.
  - Queries só do Cobblemon: `q.entity_height` (83 arquivos), `entity_radius` (88), `entity_width` (35),
    `entity_size` (36), `entity_scale` (30) → reescrever para `v.cobblemon_entity_*` e preencher no
    `pre_effect_script` da animação (constantes por espécie a partir de hitbox × baseScale) ou no
    `MolangVariableMap` quando o script dispara (seção 6).
  - `v.target_deltax/y/z`, `v.target_distance` (~120 arquivos, feixes de golpe): só fazem sentido disparados por script
    com `MolangVariableMap` (seção 6).
  - `q.sound(...)` em 17 arquivos (tosa do Furfrou, brilho shiny): converter para `sound_effect.event_name` no evento
    de partícula (nativo do Bedrock).
  - Texturas: o JSON cita `textures/particles/...`, o arquivo está em `textures/particle/...` (já tratado em
    `particles.ts`).
- Receita: generalizar `particles.ts/emitScriptParticles` para `emitParticles(ids)` com fecho transitivo por
  `events.*.particle_effect.effect`, as reescritas acima e cópia de texturas; `animations.ts` passa a procurar o id
  também no índice do Cobblemon (não só em `HAND_RP`) e pede a emissão. O mapa `particle_effects` da client entity já é
  preenchido por `EmittedEffects` — nada muda lá.

### 5.2 Sons

Os 40 "sons inexistentes" são **36 eventos**. Achado importante: o Cobblemon resolve `sound_effects.effect` como
`cobblemon:<nome>` via `SoundEvent.createVariableRangeEvent` — evento fora do `sounds.json` **não toca nada no
Cobblemon também**. Ou seja, paridade = silêncio. Corrigir é melhoria, não paridade:

| Grupo | Eventos | Correção |
|---|---|---|
| Forma regional sem evento próprio | `pokemon.{pikachu,pichu,diglett,grimer}_alolan.cry` (6 refs) | alias → `pokemon.<base>.cry` |
| Nome "de arquivo" em vez de evento | `weedle_cry`, `porygon_cry`, `porygon2_cry`, `swinub_cry`, `zebstrika_cry`, `annihilape_cry`, `0555_darmanitan_cry`, `*_ambient` de arrokuda, barraskewda, centiskorch, illumise, kricketune, linoone, volbeat, wailord | alias → `pokemon.<espécie>.cry/ambient` (15 eventos) |
| Arquivo existe, evento com outro nome | `gilded_chest_open` → `block.gilded_chest.open`; `animation.plumage_wing_flap_medium_{2,8}` → `animation.plumage.wing_flap.medium`; `steel_wing_flap_large_2` → arquivo `animation/wings/steel_wing_flap_large_2.ogg` | alias / evento novo (4 eventos, 5 refs) |
| Piadas/WIP sem arquivo | `*.mp3` do mr_mime/rhyperior, `load_yippee_sound_here`, `070`, `Stone_jump3`, `bodyhardimpact3`, `evillaugh2`, `pokemon.bronzong.bell`, `pokemon.annihilape.quirk1` | manter removidos (13 eventos, 14 refs; silêncio, como no Cobblemon) |

Receita: tabela `SOUND_ALIASES` + regras regex em `animations.ts/soundShort` (antes de avisar), e `SoundIndex.emit`
aceitando "evento sintético" apontando para um `.ogg`. Resultado: **26 de 40** referências (23 de 36 eventos) passam a tocar; 14 seguem
mudas por não existirem em lugar nenhum.

## 6. Efeitos de golpe em batalha (`data/cobblemon/action_effects`)

### 6.1 Conteúdo

154 timelines: 135 golpes específicos + `generic_move` (fallback para os demais), 7 status, 4 misc, 3 damages, 2
activates, 1 starts, 1 npc. Tipos de keyframe (contagem): `pause` 397, `entity_particles` 375, `animation` 153,
`add_holds`/`remove_holds` ~152 cada, `entity_molang` 122, `molang` 52, `sequence` 29, `entity_sound` 10. **Não há
keyframe de câmera** no 1.8.2. 350 ids de partícula distintos (todos em `bedrock/particles`).

- `animation: ["thunderbolt", "electric", "special"]` + `delay` → toca a **primeira** animação que o poser tem
  (nome do golpe → tipo → categoria); `generic_move` usa `q.move.name`, `q.move.damage_category`.
- `entity_particles { effect, locators: ["middle"|"target"|"special"…], targetLocators, entityCondition }` →
  partícula num locator do usuário/alvo; com `targetLocators` o emissor recebe `v.target_delta*`/`v.target_distance`
  (feixes). `entityCondition` usa `q.entity.is_user`, `q.missed(uuid)`.
- `entity_molang`: `q.sound('move.x.actor')` (98), `q.play_animation(q.bedrock_stateful('tackle','actor'))` (23) —
  animações genéricas de golpe em `bedrock/generic/animations/moves/*.animation.json` (19), que mexem no osso
  `root_part` (23 usos) e em `body/head/leg_*`.
- `add_holds/remove_holds: ["effects"]` seguram a fila de mensagens da batalha até o efeito "acertar".
- Locators nos `.geo`: `target` (748 modelos), `middle` (749), `special` (693), `physical` (705), `head`, `mouth`…
  — já existem nos modelos Bedrock.

### 6.2 Plano de execução no Bedrock (script, sem API beta)

Intérprete em `scripts/battle/ActionEffects.ts`, chamado por `BattleInterpreter` no lugar de `playMoveAnimation`:

```ts
// dados gerados pelo importador: generated/scripts/actionEffects.ts (timelines já normalizadas) e
// generated/scripts/locators.ts (offset de cada locator por geometria, em blocos, no espaço do modelo)
async function runTimeline(tl: Keyframe[], ctx: { user: Entity; targets: Entity[]; move: MoveInfo; missed: Set<string> }) {
  for (const k of tl) {
    switch (k.type) {
      case "pause": await sleepTicks(Math.round(k.pause * 20)); break;
      case "animation": {                        // primeira animação existente no poser da espécie
        const id = firstNamedAnimation(ctx.user, k.animation.map((a) => evalName(a, ctx)));
        if (id) (k.delay ? system.runTimeout(() => safePlay(ctx.user, id), k.delay * 20) : safePlay(ctx.user, id));
        break;
      }
      case "entity_particles":
        for (const e of entitiesFor(k.entityCondition, ctx)) for (const loc of k.locators) {
          const vars = new MolangVariableMap();
          const h = hitboxOf(e); vars.setFloat("variable.cobblemon_entity_height", h.height); /* width/radius/scale */
          const from = locatorWorldPos(e, loc);
          if (k.targetLocators?.length) {           // feixe: delta até o alvo, como ParticleStorm.addAttackingFunctions
            const to = locatorWorldPos(ctx.targets[0], k.targetLocators[0]);
            vars.setFloat("variable.target_deltax", to.x - from.x); vars.setFloat("variable.target_deltay", -(to.y - from.y));
            vars.setFloat("variable.target_deltaz", to.z - from.z); vars.setFloat("variable.target_distance", dist(from, to));
          }
          e.dimension.spawnParticle(k.effect, from, vars);
        }
        break;
      case "entity_sound": case "entity_molang":   // q.sound('x') → dimension.playSound('cobblemon.x', pos)
        runMolangSubset(k, ctx); break;
      case "add_holds": ctx.holds.add(...k.holds); break;
      case "remove_holds": k.holds.forEach((h) => ctx.holds.delete(h)); ctx.releaseIfEmpty(); break;
      case "sequence": if (!k.condition || evalCond(k.condition, ctx)) await runTimeline(k.keyframes, ctx); break;
    }
  }
}
```

- `locatorWorldPos(e, name)`: `e.location + rotY(bodyYaw) · (offset_do_locator / 16 · escala)`; a tabela de offsets vem do
  `.geo` (pivô do osso + `locators`) no import. Ignora a pose animada (erro de poucos pixels) — suficiente.
- Sinal do `target_deltay`: o Cobblemon grava `y * -1`; manter.
- `q.play_animation(q.bedrock_stateful('tackle','actor'))`: as 19 animações genéricas de golpe mexem em `root_part`.
  Receita: no import, envolver os ossos de topo de **toda** geometria de Pokémon num osso `root_part` (pivô 0,0,0,
  sem cubos) — sem custo visual — e emitir `bedrock/generic/animations/moves/*` como `animation.cobblemon.move.<nome>`.
- Partículas: emitir via 5.1 (fecho de dependências) só as 350 usadas pelas timelines + `impact_<tipo>`/`hit`.
- Tempo: `system.runTimeout` em ticks (resolução de 50 ms; os `pause` do Cobblemon são ≥ 0,1 s). Holds viram uma
  `Promise` que o `BattleInterpreter` aguarda antes da próxima mensagem — hoje ele já sequencia mensagens.
- Rede: cada `spawnParticle`/`playSound` é um pacote pequeno; um golpe típico dispara 3–8. Irrelevante.
- Cobertura estimada: 135 golpes com efeito próprio + todos os outros pelo `generic_move` (impacto por tipo + animação
  por categoria). Fica de fora: seguir o locator animado quadro a quadro (as partículas nascem no ponto calculado) e
  `cobblemon:emitter_space` (escala pelo tamanho).

## 8. Camadas emissivas

### 8.1 O que o Cobblemon faz

`PosableModel.makeLayer`: camada `emissive` usa o shader `RENDERTYPE_ENTITY_TRANSLUCENT_EMISSIVE` com **lightmap
desligado** (brilho total, independente da luz), e transparência `TRANSLUCENT` só se `translucent: true`
(caso contrário, recorte). Não é "emissivo por alfa": o PNG da camada é um PNG comum com transparência.

### 8.2 Avaliação das alternativas

| Abordagem | Resultado | Veredito |
|---|---|---|
| **Atual**: render controller da camada com `ignore_lighting: true` e material vanilla (`entity_alphatest` / `entity_alphablend`) | Brilho total, respeita a transparência do PNG, funciona com camada translúcida; é exatamente o "lightmap off" do Cobblemon | **Manter** como padrão |
| `entity_emissive_alpha` (vanilla) na camada | No Bedrock a emissividade é ∝ **transparência** do pixel (alfa 0 = descartado). O PNG do Cobblemon (opaco onde brilha) ficaria **sem** brilho. Só funciona pré-processando: pixels com alfa>0 → alfa ≈ 1–5/255 | Opcional só para camadas **opacas** (não translúcidas) — ganha sombreamento direcional e bloom do Vibrant Visuals; não serve para translúcidas (o alfa não pode codificar translucidez e brilho ao mesmo tempo) |
| Material custom (`USE_EMISSIVE` + `Blending`) | É o que `resource_packs/CobblemonBedrock/materials/entity.material` define (`emissive_translucency*`, `cobblemon_animated*`) | **Evitar**: a Microsoft avisa que custom materials podem ser removidos; e esses materiais **não são usados** por nada gerado hoje (grep sem ocorrências fora do próprio arquivo) — candidatos a remoção |

Conflitos com materiais escritos à mão: não há colisão de nomes (os gerados usam só `entity_alphatest` e
`entity_alphablend` via as chaves `default/layer/layer_translucent`); o risco é só o arquivo `.material` manual
órfão. Recomendações:

1. Manter `ignore_lighting` (paridade com o Cobblemon). Conferir no jogo que o `is_hurt_color` (flash vermelho) ainda
   aparece na camada; se não, adicionar `"is_hurt_color": {"r": 1, "g": 0, "b": 0, "a": 0.5}` no render controller da
   camada.
2. Vibrant Visuals: texture sets (MER) valem para entidades; para a camada emissiva brilhar de verdade com VV ligado,
   gerar ao lado do PNG um `<nome>.texture_set.json` com `"metalness_emissive_roughness": [0, 255, 255]`
   (verificar no jogo se o caminho `textures/pokemon/...` é aceito — a documentação cita `textures/entity`).
3. Remover `materials/entity.material` manual (ou deixar documentado como não usado).

## 9. Plano priorizado (arquivos-alvo)

| Ordem | Entrega | Arquivos | Esforço | Ganho |
|---|---|---|---|---|
| P0-1 | Negar Y de `transformedParts.position` | `tools/importer/posers.ts` (`transformAnimation`) | 1 linha | 78 transformações em 32 posers corretas |
| P0-2 | Conversor Kotlin → JSON de poser (+ saída congelada revisável) | novo `tools/importer/kotlinPosers.ts`; `posers.ts` (`PoserFactory.get`); `index.ts` (comando `import:kotlin-posers`); `tools/importer/data/kotlin-posers/` | 1–2 dias | 285–301 posers fiéis (condições de batalha/água, transformações, walks, quirks, faint/cry por pose) em vez de convenção |
| P0-3 | Pose sem idle permitida; 8 espécies voltam | `posers.ts` (`fallback`/`fromJson`), `index.ts` (critério de pulo) | horas | 8 espécies |
| P1-1 | `pitch_tilt` + look compensado | `posers.ts` (`GenContext`), `entities.ts` (somar `preAnimation`) | ½ dia | 204 usos |
| P1-2 | Montaria: `is_ridden→has_rider`, `ride_style` enum, `q.r.*` por molas no cliente | `molang.ts`, `animations.ts`, `entities.ts`, `scripts/entity/Riding.ts`; lista `BEDROCK_QUERIES` | 1 dia | 83 poses de montaria + 7.699 usos de `q.r.*` |
| P1-3 | Partículas do Cobblemon sob demanda + aliases de som | `particles.ts`, `animations.ts`, `sounds.ts` | ½–1 dia | 35/35 partículas; 26/40 sons |
| P2-1 | Flipbook por array de texturas | `variants.ts`, `entities.ts` | ½ dia | 40/40 texturas animadas |
| P2-2 | Emissivo: `is_hurt_color`, texture sets VV, limpar `.material` órfão | `entities.ts`, RP manual | horas | robustez visual |
| P2/P3 | Intérprete de `action_effects` | importador: `actionEffects.ts` + tabela de locators; `scripts/battle/ActionEffects.ts`, `BattleInterpreter.ts`, `Animations.ts`; `root_part` nas geometrias | 3–5 dias | 135 golpes + genérico |

Critérios de verificação por etapa: `npm run import` sem novos avisos na categoria tratada; `npm run validate`;
diff de contagens no `import-report.json` ("posers de reserva" deve cair de 293 para ~8–23; "animação procedural
ignorada" de 205 para ~1; "textura animada reduzida" de 40 para 0; "partícula sem equivalente" de 35 para 0);
teste em jogo: charizard na água (afunda), pidgeot voando (inclina), charmander (chama anima), krabby (bolhas ao
entardecer, pose de batalha).

## 10. Protótipos (scratchpad)

`$SCRATCH` = `/private/tmp/claude-502/-Users-edupereira-Projetos-Cobblemon-Bedrock/275d0c5f-c0ac-47f2-b984-775e3fe07697/scratchpad`

| Arquivo | O que faz | Como rodar |
|---|---|---|
| `pesquisa-animacao/kotlinPosers.ts` | Kotlin → JSON de poser; relatório de cobertura | `node --experimental-strip-types kotlinPosers.ts all --out outAll` |
| `pesquisa-animacao/outAll/*.json` | 308 posers convertidos | — |
| `pesquisa-animacao/procedural.ts` | fórmulas procedurais + `pitch_tilt` → `proto/procedural_demo.animation.json` | `node --experimental-strip-types procedural.ts ./proto` |
| `pesquisa-animacao/riding.ts` | `q.r.*` → molas no cliente; demo Charizard | `node --experimental-strip-types riding.ts ./proto` |
| `pesquisa-animacao/animatedTextures.ts` | flipbook por array → `proto/charmander_flipbook.render_controllers.json` | `node --experimental-strip-types animatedTextures.ts ./proto` |
| `pesquisa-animacao/checkMolang.ts` | lint com `BEDROCK_QUERIES`/`BEDROCK_MATH` do projeto | `node --experimental-strip-types checkMolang.ts proto/*.json` |

Nada disso foi testado dentro do jogo; a validação foi estática (Molang, ossos, contagens).

## Fontes

- Código do Cobblemon 1.8.2 em `upstream/cobblemon`: `VaryingModelRepository.kt`, `PosableModel.kt`, `JsonPose.kt`,
  `ClientMoLangFunctions.kt`, `animation/*.kt`, `wavefunction/WaveFunctions.kt`, `PosableState.kt`,
  `RidingAnimationData.kt`, `Vec3Spring.kt`, `BedrockAnimation.kt`, `BedrockAnimationAdapter.kt`,
  `ModelPartTransformation(Adapter).kt`, `ParticleStorm.kt`, `SnowstormParticleReader.kt`,
  `AnimatedModelTextureSupplier` (`VaryingRenderableResolver.kt`), `data/cobblemon/action_effects/**`.
- Microsoft Learn — [Molang Query Functions](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/molangreference/examples/molangconcepts/queryfunctions?view=minecraft-bedrock-stable)
  (`vertical_speed`, `ground_speed`, `delta_time`, `position_delta`, `rider_head_x_rotation`, `has_rider`, `yaw_speed`).
- Microsoft Learn — [minecraft:render_controller v1.8.0](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/visualreference/render_controller.v1.8.0?view=minecraft-bedrock-stable)
  (`ignore_lighting`, `uv_anim`, `is_hurt_color`, arrays).
- Microsoft Learn — [Materials and Material Files](https://learn.microsoft.com/en-us/minecraft/creator/documents/material-files?view=minecraft-bedrock-stable)
  (aviso sobre custom materials; `entity_emissive_alpha`; `USE_EMISSIVE`).
- Bedrock Wiki — [Entity Texture Animation](https://wiki.bedrock.dev/visuals/animated-entity-texture) (`USE_UV_ANIM`, `uv_anim`).
- Bedrock Wiki — [Vanilla Materials](https://wiki.bedrock.dev/documentation/materials) e [Glowing Entity Texture](https://wiki.bedrock.dev/visuals/glowing-texture).
- Bedrock Wiki — [Render Controllers](https://wiki.bedrock.dev/entities/render-controllers) (arrays indexados por Molang).
- Microsoft Learn — [Vibrant Visuals Resource Packs](https://learn.microsoft.com/en-us/minecraft/creator/documents/vibrantvisuals/vvresourcepacks?view=minecraft-bedrock-stable) (texture sets para entidades).
- `@minecraft/server` 2.10.0 (`node_modules/@minecraft/server/index.d.ts`): `InputInfo.getMovementVector`,
  `getButtonState`, `Entity.setProperty`, `Dimension.spawnParticle` + `MolangVariableMap`.
