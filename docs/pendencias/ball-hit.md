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
