# Frente ball-hit: acertar a Poké Ball ficou tão fácil quanto no Java

Relato do cliente real (beta 6): para capturar era preciso acertar a bola "de um jeito muito específico"; muito difícil
acertar o Pokémon. (No sobrevivência a bola que erra já caía no chão corretamente: continua igual.)

## Causa raiz (medida no BDS)

Três causas somadas. A primeira era a maior.

1. **A bola andava duas vezes por tick.** As entidades `cobblemon:<bola>` (BP à mão, vindas do CobbleBuild) não
   tinham `runtime_identifier`. O ator genérico do Bedrock anda de novo pela velocidade depois do `minecraft:projectile`.
   Um rastro por tick no servidor (`getVelocity`/`location` no `system.runInterval`) mostrou isto: ao setar
   `v = (0,0,1)`, a bola andou 1,91 no tick seguinte (1 + atrito 0,91). Na vertical, `Δy = 1,98·vy − 0,0784`, que é a
   gravidade de mob 0,08 × 0,98 somada à do projétil. Com `power` 1,5 (throwPower × 1,2) e `gravity` 0,1, a bola saía
   a ~2,5–2,8 blocos/tick e caía ~3 blocos a 10 blocos de distância. Só acertava quem mirava bem acima do Pokémon.
2. **Faltava o arremesso "por cima" do Java.** O `PokeBallItem.throwPokeBall` faz
   `shootFromRotation(player, xRot − overhandFactor, …)`, com 5° (ou 5·cos(xRot) olhando para cima). Com a gravidade
   0,03, esse ângulo faz a bola chegar perto da mira até ~11 blocos.
3. **O teste de acerto não era o do Java.** O `ProjectileUtil.getEntityHitResult` (MC 1.21.1) testa o segmento do tick
   contra a caixa do alvo **inflada em 0,3** em cada lado. A caixa do Pokémon é `hitbox × baseScale × effectiveScale`
   (`PokemonEntity.getDimensions`). O `minecraft:projectile` do Bedrock usa a caixa de colisão sem a margem. Um Joltik
   (0,24 × 0,24 no Java) ficava quase impossível de acertar, e no Java ele vira 0,84 × 0,84 para a bola.

Referências do Java: `upstream/cobblemon/.../item/PokeBallItem.kt` l. 46-58 (overhand, throwPower, +1 bloco à
frente), `entity/pokeball/EmptyPokeBallEntity.kt` (ThrowableItemProjectile; `DIMENSIONS` 0,4 só no broadphase),
`entity/pokemon/PokemonEntity.kt` l. 1327-1333 (`getDimensions`), `api/pokeball/PokeBalls.kt` l. 339 (throwPower 1,25,
heavy 0,75, feather 2,5).

## Mudanças

| Arquivo | O quê |
| --- | --- |
| `behavior_packs/CobblemonBedrock/entities/pokeballs/*.json` (49 bolas, não os `_dummy`) | `runtime_identifier: minecraft:snowball` (a classe de arremessável do vanilla: anda só pelo `minecraft:projectile`); `power` = throwPower do Java (1,25 / 0,75 / 2,5); `gravity` 0,03 e `inertia` 0,99 (ThrowableProjectile); `angle_offset` −5 (overhand). `physics`, `liquid_inertia` (waterDragValue) e o resto ficam iguais. |
| `scripts/catching/BallHitTest.ts` (novo) | Lógica pura: segmento × AABB (placas), margem 0,3 do Java, caixa do Java a partir do `getAABB()` × `cobblemon:scale_modifier` (base e centro fixos), alvo mais próximo no caminho. |
| `scripts/catching/BallFlight.ts` (novo) | Acerto por proximidade. Cada bola em voo é acompanhada por tick; o caminho testado é o trecho percorrido desde o tick anterior mais o trecho `pos → pos + v` que ela vai andar, cortado no 1º bloco (`getBlockFromRay`). Considera só Pokémon (família `pokemon`); fora ficam a montaria/ombro de quem arremessou (Java `isPassengerOfSameVehicle`), clone de batalha, exibição de NPC e Pokémon sem vida. `runInterval` só enquanto há bola voando. |
| `scripts/catching/index.ts` | Liga o `BallFlight` no `entitySpawn` da bola. O acerto por proximidade chama o **mesmo** `handleBallHit` do acerto nativo. `resolved` marca a bola que virou item; os handlers nativos (bloco/entidade) ignoram bola já resolvida ou ativada, então não há acerto nem item duplo. |
| `scripts/catching/PokeBalls.ts` | `projectilePower` = throwPower (1:1, medido); `overhandPitch` (fórmula do PokeBallItem). |
| `scripts/catching/ThrowBall.ts` | Arremesso por interação (mira no Pokémon): `overhandDirection` (+5°) e throwPower do Java, igual ao nativo. |
| `tests/ball-hit.test.ts` (novo) | Segmento × AABB, caixas, margem, escala, escolha do alvo, `BallFlight` com entidades falsas (acerto pela margem, sem acerto duplo, bloco antes do alvo, montaria/ombro/clone/NPC/desmaiado de fora), overhand e as 49 bolas do BP contra o throwPower do Java. |
| `tests/captura.test.ts`, `tests/ui-cliente.test.ts` | As expectativas de potência antigas (1,25 × 1,2 = 1,5) viraram os valores exatos do Java (1,25; 0,75; 2,5; +5°). Os asserts continuam exatos. |
| `tests/e2e/experimental/ball-hit.e2e.mjs` (novo) | Medição E2E contra o Java, arremesso a arremesso (abaixo). |

Sem mudança no importador: as entidades de bola do BP são escritas à mão. A caixa de colisão dos Pokémon
(`tools/importer/entities.ts`, de outra frente) já é fiel: `collision_box` = hitbox e `minecraft:scale` = baseScale, então
`getAABB()` = hitbox × baseScale. Conferido no BDS: o Zubat (0,6 × 1,1 × 0,8 = 0,48 × 0,88) deu a caixa
0,44 × 0,82 = 0,48 × 0,88 × `scale_modifier` 0,93. A escala efetiva (filhote × intrínseca) é só visual no Bedrock
(`cobblemon:scale_modifier`) e entra pelo script no teste de acerto.

## Medição E2E (antes × depois)

Cenário `tests/e2e/experimental/ball-hit.e2e.mjs`, BDS `ball` (porta 19189, `dist-ball`, raknet, online-mode false).
O bot fica em sobrevivência. Os alvos são Pokémon nível 20 parados com a tag `uncatchable`: acerto → "cannot_be_caught"
e a bola cai como item, pelo mesmo fluxo da captura. São 4 Pokémon (Joltik 0,24 × 0,24; Pikachu 0,35 × 0,65; Snorlax
2,3 × 3,35; Zubat 0,48 × 0,88 parado no ar sobre uma barreira) × 7 posições (2,5 por interação; 4; 7; 11; 15 blocos;
direções 0°/30°/−40°/60°/180°/120°; bot no chão e 3–4 blocos acima) × 5 miras no corpo (centro, alto, baixo, esquerda,
direita) = 140 arremessos. Há ainda 28 tiros de controle, com a linha passando ≥ 0,35 bloco fora da região de acerto do
Java. Para cada arremesso o cenário simula o Java 1.21.1 com a mesma mira e o mesmo mundo.

| Pokémon | Java (simulado) | Antes (port) | Depois (port) | Depois: acerta do que o Java acerta |
| --- | --- | --- | --- | --- |
| pequeno (Joltik) | 30/35 (86%) | 1/35 (3%) | 30/35 (86%) | 30/30 (100%) |
| médio (Pikachu) | 31/35 (89%) | 5/35 (14%) | 30/35 (86%) | 30/31 (97%) |
| grande (Snorlax) | 35/35 (100%) | 20/35 (57%) | 35/35 (100%) | 35/35 (100%) |
| voando (Zubat) | 34/35 (97%) | 8/35 (23%) | 31/35 (89%) | 31/34 (91%) |
| **total** | **130/140 (93%)** | **34/140 (24%)** | **126/140 (90%)** | **126/130 (97%)** |

- Acertos a mais que o Java: 0. Controle fora da região de acerto: 0/28 antes e depois (o Java também 0/28).
- O "antes" foi medido com o mesmo cenário sobre um build isolado do HEAD para `scripts/catching/*` e as entidades de
  bola (cópia da árvore no scratchpad; resto igual à árvore atual).
- As 4 diferenças que sobraram estão todas a 15 blocos, no limite do alcance. A bola do Java nasce 1 bloco à frente do
  olho (`setPos(position + delta.normalize())`) e chega ~1 tick antes (≤ 0,2 bloco mais alta a 15 blocos). Mirando no
  corpo de um Pokémon no chão a 15 blocos, o Java também erra: a bola toca o chão antes.
- Trajetória (`set_entity_motion` e rastro por tick) depois da mudança: sai a 1,25 bloco/tick com +5°, anda por `v`,
  retém 0,99 e a vertical perde 0,03 por tick, exatamente o `ThrowableProjectile.tick`. Ângulo de saída igual nos dois
  caminhos (nativo e interação/`shoot()` do script): o `angle_offset` não soma no `shoot()`.
- Primeira medição (cenário antigo, descartada): 32/140 → 105/140. O Zubat "voando" estava no chão no servidor, com o
  cache do bot desatualizado. Por isso o cenário passou a usar a barreira e a posição do `tp`, e a comparar com o Java.

Outros E2E no mesmo build (`dist-ball`): suíte base **10/10** (inclui `04-capture`, Master Ball → sequência completa
→ time) e `experimental/bola-erra` OK (chão → item da mesma bola e coletado; captura recusada → mensagem + item;
criativo → só some). Logs do servidor sem ERROR/WARN de script/conteúdo da captura; só aparece o "No targets matched
selector" dos `kill` dos cenários.

## Status

| Item | Status |
| --- | --- |
| Física do arremesso do Java (potência, gravidade, retenção, +5° por cima) nas 49 bolas e no arremesso por interação | FEITO |
| Caixa do Pokémon do Java (hitbox × baseScale × escala efetiva) + margem 0,3 no teste de acerto | FEITO (por script; a caixa de colisão do BP já era hitbox × baseScale) |
| Acerto por proximidade por tick (trecho percorrido + trecho à frente cortado no bloco), mesmo fluxo de captura | FEITO |
| Não acerta o jogador que arremessou, a montaria/ombro dele, clone de batalha nem exibição de NPC | FEITO |
| Pokémon de batalha de outro jogador | FEITO como no Java: a bola acerta, o fluxo recusa ("in_battle") e cai o item |
| Sem acerto duplo (proximidade + nativo; bloco depois do acerto) | FEITO (`activated`/`resolved`; teste unitário) |
| Regra de drop ao errar | FEITO (inalterada; E2E `bola-erra`) |
| Bola que nasce dentro de um Pokémon colado no jogador | Diferença proposital: conta como acerto (t = 0). No Java o `AABB.clip` não conta e a bola atravessaria |
| Bola nasce 1 bloco à frente e 0,1 abaixo do olho (Java) | NÃO FEITO: diferença ≤ 0,2 bloco a 15 blocos (4/130 arremessos). O `offset` do projétil e o teleporte no spawn não foram medidos |
| `inaccuracy` 1,0 do Java (gaussiano × 0,0075 ≈ ±0,4°) | N/A: arremesso determinístico, sem `uncertainty_*` |
| Velocidade do jogador somada ao arremesso (`shootFromRotation` + `getKnownMovement`) | NÃO FEITO: fora do relato (arremesso parado) |

## Notas de ambiente (não são da frente)

- O BDS emulado caiu duas vezes no boot por `[Watchdog] 13–16 s hang` (load do host ~150, 5 BDS ao mesmo tempo; ver
  `estabilidade.md`). Para medir, subi temporariamente `script-watchdog-hang-threshold` só no `.bds-ball`; o ajuste já
  foi desfeito. Uma vez o BDS abortou com `realloc(): invalid next size` (box64) logo depois de subir; um `docker
  restart` resolveu. Um `fill ... outOfWorld` no 1º bot de um run (ticking area recém-criada) fez o `bola-erra` falhar
  uma vez antes do arremesso; ao repetir, passou.
- `npm test`: falha só `spawn-multi.test.ts` (frente spawn-multi, em andamento). O `cliente-teste2` (p99 das fatias do
  spawner) falhou uma vez sob carga e passou na seguinte.
- Container `cobblemon-bds-ball` removido; o `cobblemon-bds` não foi tocado.

Reproduzir:

```sh
COBBLEMON_BDS=ball COBBLEMON_BDS_PORT=19189 COBBLEMON_DIST=dist-ball COBBLEMON_BDS_TRANSPORT=raknet \
COBBLEMON_BDS_ONLINE_MODE=false node tools/e2e/run.mjs --scenario tests/e2e/experimental/ball-hit.e2e.mjs --deploy --verbose
```

## Afundando no chão (beta 7)

Relato do cliente real (Windows, beta 7 / v1.0.7): "A Pokébola, quando acerta o Pokémon, agora está entrando dentro do
chão, qualquer uma, na animação de captura." Não acontecia na beta 6.

### Causa (medida no BDS, não só no cliente)

Cenário `tests/e2e/experimental/bola-chao.e2e.mjs` (BDS `bola`, porta 19196). O bot acompanha pelos pacotes
(`add_entity`, `move_entity(_delta)`, `set_entity_motion`, `play_sound`) a entidade que faz a animação, numa plataforma
de vidro com o topo em y = 170. Linha de base (árvore da beta 7, `BOLA_CHAO_BASELINE=1`, duas rodadas iguais):

| | quique | 1ª/2ª/3ª sacudida | fim | y mínimo |
| --- | --- | --- | --- | --- |
| Master Ball × Snorlax (captura) | 160,62 | 154,16 / 132,60 / 99,16 | 55,6 (capture) | 24,0 |
| Poké Ball × Mewtwo nv. 100 (escape) | 160,62 | 154,16 | 132,60 (break) | 128,4 |

Duas causas somadas:

1. **Principal, nova na beta 7: o projétil com `runtime_identifier: minecraft:snowball` cai sozinho no servidor.** O
   ator de arremessável aplica a gravidade do `minecraft:projectile` sempre que o script para de teleportá-lo. Do pouso
   em diante o `CaptureSequence` não move mais a bola, e o servidor manda `set_entity_motion (0; −0,204; 0)`. O
   `cobblemon:disable` tira o `minecraft:physics`, então não há colisão: a bola atravessa o chão durante as sacudidas
   (de 160 até 24 no exemplo). Isso vale em qualquer chão, e é o que o jogador viu. Na beta 6 o ator genérico não fazia
   isso depois do `disable`.
2. **Antiga, aparece em alguns blocos: o `groundBelow` não achava o chão.** O
   `getBlockBelow(…, { includeLiquidBlocks: true, includePassableBlocks: false })` devolve `undefined` em vidro, folhas,
   laje, gelo, terra arada, painel de vidro e água. Ele só acha blocos "sólidos" do Bedrock (pedra, grama, terra),
   conforme a sonda no BDS. Sem chão, o `fall()` cai o 1,5 s inteiro e para ~9 blocos abaixo do ponto de onde caiu
   (160,6 com o chão em 170): dentro do chão, ou no ar sobre um vão. No Java o FALL para no primeiro bloco com colisão
   (`onHit` BLOCK; o clip ignora fluidos) ou desiste em 1,5 s.

### Correção

| Arquivo | O quê |
| --- | --- |
| `scripts/catching/CaptureDummy.ts` (novo) | `swapToCaptureDummy`: no acerto que começa a captura, cria a `cobblemon:<bola>_dummy` (a mesma entidade do envio, `SendOut.ts`: sem projétil nem física, só se move por teleporte). Ela nasce na posição do projétil (ou no ponto do acerto por proximidade), com a mesma direção e o evento `cobblemon:capture`. Recebe `player_id`/`activated`. O projétil fica `activated` + `resolved` e é removido com `remove()`, sem item. Se a dummy não puder ser criada, a captura segue no projétil (comportamento da beta 7). |
| `scripts/catching/index.ts` | `handleBallHit` troca a bola depois de todas as validações e do `beginBattleCapture` (nada que possa lançar erro vem depois da troca, então o `catch` de quem chama nunca derruba item de um projétil já removido). `attempt.ballEntity` e `battleAction.ballEntity` passam a ser a dummy. Por isso o quique, o feixe, a tinta, o encolhimento, a queda, as sacudidas, a crítica, o sucesso/`break`, as partículas, os sons, o `target.teleport(ballEntity.location)` do escape, o `killBall` e o `isCaptureInProgress` (o `entityLoad` do `main.ts` não mata a dummy em captura) acontecem na dummy. O acerto por proximidade passa o ponto para onde teleportou a bola. |
| `behavior_packs/.../entities/pokeballs/*_dummy.json` (49) | Grupo e evento `cobblemon:capture` com `minecraft:scale` 1,0, a mesma escala do projétil (que não tem `minecraft:scale`). A dummy do envio continua 0,4. O client entity da dummy já era igual ao da bola (geometria, textura, material, animações). |
| `scripts/catching/CaptureSequence.ts` | `groundBelow` virou um `getBlockFromRay` para baixo, sem fluidos e sem passáveis, com o topo pela `faceLocation`. Medido: 0 no bloco inteiro (vidro, pedra, folhas, gelo), 0,5 na laje, 0,9375 na terra arada. Água e vazio: sem chão, cai o 1,5 s como no Java. |
| `tests/bola-chao.test.ts` (novo) | Dados das 49 dummies (sem projétil/física/runtime; evento de captura = escala do projétil; envio 0,4; client entity igual ao da bola); a troca (posição, direção, evento, propriedades, sem item, fallback); os handlers de verdade (acerto → dummy anima, projétil removido e não movido, eventos atrasados sem item/2ª dummy; recusas continuam no projétil com item); `groundBelow` com os valores medidos. |
| `tests/e2e/experimental/bola-chao.e2e.mjs` (novo) | Cenário acima, com as asserções da dummy. |

Não mudam: o voo, a física e o acerto da beta 7 (o projétil continua `snowball`); a bola que erra (bloco, entidade que
não é Pokémon), as recusas (não selvagem, `uncatchable`, `busy`, em batalha, sem vez) e a bola sem dono. Esses ramos não
começam a captura e o projétil vira item ou some na hora, como antes.

### Depois (mesmo cenário, build final com `npm run import`)

| | entidade no chão | quique / sacudidas / fim | y mínimo | `set_entity_motion` na dummy | escala (projétil → dummy) | itens no chão | bolas |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Master Ball × Snorlax (captura) | `master_ball_dummy` | 170,000 em todas | 170,000 | 0 | 1 → 1 | 0 | 4 → 3 |
| Poké Ball × Mewtwo (escape) | `poke_ball_dummy` | 170,000 em todas | 170,000 | 0 | 1 → 1 | 0 (igual à linha de base) | 16 → 15 (igual) |

- O projétil some ~50–75 ms depois do som de acerto (`remove_entity`), no mesmo pacote de tick em que a dummy aparece
  (`add_entity`). Daí em diante a dummy é a única entidade de bola.
- O quique agora cai no vidro em ~3,4 s (antes 4,2 s): a bola pousa no bloco, como no Java, em vez de cair o 1,5 s
  inteiro.
- Escape: mesma mensagem, o Mewtwo continua no mundo e nenhum item cai, como antes. Na linha de base o Pokémon
  reaparecia onde estava a bola (`target.teleport(ballEntity.location)`), ou seja, dentro do chão; agora reaparece em
  cima do bloco.

Outros E2E no mesmo build (BDS `bola`, porta 19196, `dist-e2e-bola`, raknet, online-mode false, `COBBLEMON_MSD=0`, sempre
`node tools/e2e/run.mjs` direto, nunca `npm run test:e2e`, que fixa o BDS `e2e`):

- Suíte base **10/10** (duas vezes: antes e depois do `npm run import` da frente do item segurado).
- `04-capture` com `E2E_KNOWN_BUGS=1`: 4/4 capturas (3 delas pela crítica). O contador `hurt_animation` do cenário
  procura o tipo `master_ball`, não a dummy: o "0" dele não diz nada sobre o E2E-3. Esse bug provavelmente vinha da
  bola afundando (dano de sufocamento), mas isso não foi provado.
- `experimental/bola-erra`: OK (chão → item da mesma bola e coletado; recusada → mensagem + item; criativo → só some).
- `experimental/ball-hit`: port 126/140, Java 130/140, 126/130 do que o Java acerta, 0 a mais, controle 0/28: os
  mesmos números da beta 7. O voo e o acerto não mudaram.
- Logs do servidor: só o "No targets matched selector" dos `kill` dos cenários.

### O que só dá para confirmar no cliente real

- **Renderização.** O BDS prova a posição do servidor e os pacotes (dummy parada no topo do bloco, sem velocidade, escala
  1). Que o cliente Windows desenha a bola em cima do chão, sem piscar na troca projétil → dummy (os pacotes chegam no
  mesmo tick), é **INCONCLUSIVE** até alguém testar no jogo.
- O tamanho da bola na captura. A escala é a mesma do projétil (1,0, medida no `add_entity`), mas o tamanho aparente
  só se confere olhando.
- Animações (`open`, `shut`, `bounce`, `bob1–6`, `critical`, `capture`, `break`, pulos da ancient) na dummy: mesmo client
  entity e mesmas chamadas `playAnimation`; os sons chegaram ao bot na ordem certa, mas a animação é só do cliente.
- Blocos em que a sonda do chão acertou o topo: vidro, pedra, grama, folhas, laje (0,5), gelo, terra arada (0,9375) e
  painel. Água: o raio passa (a bola cai o 1,5 s, como no Java, que ignora fluidos). Neve em camada e cerca: sonda
  inconclusiva (o bot não ficou em cima do bloco).

### Status

| Item | Status |
| --- | --- |
| Sequência de captura inteira na `_dummy` (quique, feixe, tinta, queda, sacudidas, crítica, sucesso, escape, partículas, sons) | FEITO (E2E `bola-chao`, unitário) |
| Projétil removido sem item/sem devolução/sem duplicar; eventos atrasados do projétil ignorados | FEITO (unitário; E2E: 0 itens, 1 bola gasta) |
| Dummy do tamanho do projétil (evento `cobblemon:capture`); envio continua 0,4 | FEITO (E2E: escala 1 → 1; unitário nas 49) |
| Chão achado em vidro/folhas/laje/gelo/terra arada/painel (`groundBelow` por raio, topo da colisão) | FEITO (sonda no BDS, E2E, unitário) |
| Captura/escape com o mesmo resultado de antes (mensagem, time, item, Pokémon de volta) | FEITO (E2E) |
| Ramos que não começam a captura, bola que erra, voo/acerto da beta 7 | SEM MUDANÇA (E2E `bola-erra`, `ball-hit`) |
| Bola desenhada em cima do chão no cliente Windows | INCONCLUSIVE (só no cliente real) |
| E2E-3 (bola levando dano depois de pousar) | NÃO PROVADO (provável efeito colateral da correção) |

Reproduzir:

```sh
COBBLEMON_BDS=bola COBBLEMON_BDS_PORT=19196 COBBLEMON_DIST=dist-e2e-bola COBBLEMON_BDS_TRANSPORT=raknet \
COBBLEMON_BDS_ONLINE_MODE=false COBBLEMON_MSD=0 node tools/e2e/run.mjs \
  --scenario tests/e2e/experimental/bola-chao.e2e.mjs --deploy --rm --verbose
# BOLA_CHAO_BASELINE=1 só mede (sem as asserções da dummy/do chão), para o "antes".
```
