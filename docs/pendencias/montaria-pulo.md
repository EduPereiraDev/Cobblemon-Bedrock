# Frente montaria-pulo: Espaço derrubava do Dragonite e o pulo duplo não decolava

Relatos do cliente real (Windows, v1.0.7):

1. "Montei no Dragonite, mas ao apertar espaço pra voar ele pula do Pokémon" (o jogador sai da montaria).
2. "No Charizard, seguro espaço, sobe a barra que nem cavalo, mas ele só pula, não sai do chão."
3. "Aperto espaço duas vezes, ele fica no F5 e depois logo volta pra primeira pessoa, não chega a voar e volta pro chão."

Reprodução e verificação num BDS próprio (container `cobblemon-bds-ride`, porta 19195, bots de protocolo) com o cenário
`tests/e2e/experimental/montaria-pulo.e2e.mjs` e a sonda `cblimits:ride_probe` (estilo, chão, posição e velocidade por
tick, botões do `playerButtonInput`, eventos `cobblemon:ride_*`).

## Causa raiz (três causas, medidas no BDS)

### 1. Na terra, o Espaço não tinha ação: o cliente usa o Espaço para desmontar

- Flags que o servidor manda ao cliente no `set_entity_data` da montaria (linha de base, antes da correção):
  Dragonite montado `wasd_controlled+affected_by_gravity+can_fly` (**sem `can_power_jump`**); Charizard
  `wasd_controlled+can_power_jump+affected_by_gravity`; Lapras, Altaria, Latias, Milotic, Wailmer também sem.
  O importador só punha `minecraft:can_power_jump` no `ride_land` quando o `canJump` do Cobblemon era verdadeiro;
  `canJump: false` (29 espécies, entre elas Dragonite, Lapras, Altaria, Latias, Gyarados) deixava a terra sem nenhuma ação para o Espaço.
- Todos os mounts vanilla controláveis têm uma ação no Espaço: cavalo `can_power_jump`, nautilus `dash_action`, ghast
  feliz `vertical_movement_action` (extraído do `vanilla_1.26.50` do BDS). A documentação da API
  (`InputPermissionCategory.Dismount`) diz que "on horses players can still jump off": o pulo que desmonta existe.
- O desmontar é pedido pelo **cliente** (`interact leave_vehicle`): o bot mandando o Espaço como o cliente
  (`jump_down/jumping/start_jumping/want_up` + `*_raw`) nunca foi derrubado pelo servidor (nenhum `set_entity_link`
  remove), nem com agachar na terra. Quando o bot manda `leave_vehicle`, o servidor aceita em qualquer estilo.
- Conclusão: sem ação para o Espaço e com a trava de desmontar do cliente livre (na terra), o cliente trata o Espaço
  como desmontar. É inferência forte (flags + comportamento vanilla + API), não reproduzível só com o servidor.
- No ar e na água o `Riding.applyControls` desliga `InputPermissionCategory.Dismount`: medido o
  `update_client_input_locks` com `256` (= 1 << 8, Dismount) em todo AIR/LIQUID e `0` na terra. Lá o cliente não pede
  para desmontar, por isso o bug aparecia só na terra.

### 2. O `ride_air` não tirava a gravidade: a `minecraft:navigation.fly` a religava

- Trajetória no servidor depois do pulo duplo com impulso (Dragonite, `ride_air`): `vy` 0,539 → 0,448 → 0,367 … →
  −0,032 → −0,061 … → chão, ou seja `vy' = (vy − 0,08)·0,98`: a gravidade de mob continuava valendo, apesar de a
  flag `affected_by_gravity` sair do `set_entity_data` no AIR.
- Controle no mesmo BDS: o ghast feliz vanilla montado pelo bot fica parado no ar (y 178 por 3 s) e sobe com o pulo
  segurado (178 → 180,5). O Dragonite **sem cavaleiro** com `ride_air` caía de 178 para 170.
- Bisseção com cópias do `dragonite.json` (entidades de teste só no BDS, fora do repositório), cada uma com um
  componente a menos, `ride_air` e `tp` para y+8, y lido pelo bot a cada 0,4 s:
  controle cai (173,2 → 170); sem `can_fly`, sem `free_camera_controlled`, sem `vertical_movement_action`, sem
  `jump.static`, sem os valores de movimento: caem; sem `movement.fly`: cai; **sem `navigation.fly`: fica em 178**;
  com `navigation.generic` ou `navigation.walk` no lugar: fica em 178; com a `navigation.fly` dentro do
  `cobblemon:move_ai`: fica em 178 no `ride_air` (e `on_mount → ride_air`) e volta a cair no `ride_land`.
  Entidades mínimas (só colisão + `physics`) trocando `has_gravity` por grupo ficam no ar: a troca por grupo funciona,
  é a `navigation.fly` que a desfaz.
- O selftest `movement` do cliente real registrou "altaria LAND>AIR>LAND" sem derrubadas: o `rideOnce` empurra a
  montaria para cima com `applyImpulse` a cada 5 ticks (SelfTest.ts), o que mascarava a gravidade.

### 3. O pulo duplo não tirava a montaria do chão e o AIR voltava para LAND em 10 ticks

- Linha de base (Dragonite e Charizard): `ride_air` no tick 1474 (a câmera de órbita, o "F5") e `ride_land` no tick
  1484, `chao=true`, `y=170.000`, `vy=0.000` o tempo todo: o grupo só tirava a gravidade (e nem isso, causa 2), não
  havia impulso, e o `nextRideStyle` via o chão 10 ticks depois e voltava para LAND (a câmera volta à 1ª pessoa).
- No Java o 1º toque já tira a montaria do chão (pulo do `HorseBehaviour`, que aplica a força ao longo de 6 ticks) e o
  2º toque em até 12 ticks (`LocalPlayerMixin.cobblemon$survivalJumpTriggerTime`) passa ao AIR, sem gravidade
  (`BirdBehaviour.gravity = 0`); o jato anda sozinho (`minSpeedFactor`). O Cobblemon **não** tem barra de pulo no
  cavalo (`HorseBehaviour.canJump = false`, pula direto com o Espaço); a barra é do `can_power_jump` do Bedrock.
- O `playerButtonInput` chega com `can_power_jump` (o relato 3 mostra o F5 = `ride_air` disparado; no BDS, 4 botões
  por pulo duplo em todas as espécies).

## Correções (menor mudança)

| Arquivo | O quê |
|---|---|
| `tools/importer/entities.ts` | `ride_land` sempre com `minecraft:can_power_jump` + `minecraft:horse.jump_strength` (0 quando `canJump=false`: o Espaço não pula nem derruba). Quem voa montado leva a `minecraft:navigation.fly` no `cobblemon:move_ai` (só existe solto; montado quem guia é o jogador), fora da base e dos grupos de montaria. |
| `scripts/entity/Riding.ts` | Pulo duplo → AIR dá um impulso de 0,25 para cima (≈ 2,5 blocos sem gravidade, arrasto 0,91/tick) um tick depois do evento; o AIR só volta para LAND depois de sair do chão (`landingCounts`) ou após 40 ticks sem conseguir subir (teto). Janela do pulo duplo 7 → 12 ticks (a do Java); o agachar 2× continua com 7. |
| `scripts/experimental/limits/index.ts` | Sondas de depuração (só com `debug_probes on`): `cblimits:ride_probe on|off` e `execute as <entidade> run scriptevent cblimits:entity_info`. |
| `tests/e2e/lib/bot.mjs` | Guarda o `uniqueId` do jogador (o `set_entity_link` usa o unique id). |
| `tests/e2e/experimental/montaria-pulo.e2e.mjs` | Matriz por comportamento + dano do dono. |
| `tests/montaria-pulo.test.ts` | JSON gerado (ação de Espaço em todo `ride_land`, sem `navigation.fly` na base de quem voa montado) e as regras de pouso. |
| `docs/COMO-JOGAR.md` | Linha "Montar": decolagem, Espaço na terra, sair da água. |

Nada mudou em estilos, câmera, fôlego, sprint, sons, desmontar no ar/água (agachar 2×) nem na água.

## Evidência depois da correção (BDS, matriz `montaria-pulo.e2e.mjs`, rodada final: 1/1, 133 verificações OK)

Uma espécie por combinação de comportamento que existe nos dados (`air/glider`, `air/helicopter`, `land/vehicle`,
`land/minekart` e `liquid/burst` não têm nenhuma espécie no port):

| Espécie | Comportamentos | Espaço na terra | Andar | Pulo não desmonta | Decolar (pulo duplo + segurar) | Pulo duplo rápido | Subir no ar | Agachar 1× no ar/água | Pousar / sair da água | Desmontar |
|---|---|---|---|---|---|---|---|---|---|---|
| Arcanine | land/horse (pulo) | can_power_jump | OK 2,3 | OK (carga 0,6 s: +1,8) | não decola (sem AIR) | — | — | — | — | agachar na terra OK |
| Charizard | land/horse (pulo) + air/bird | can_power_jump | OK | OK | OK +7,9, fica no AIR | OK +3,0 | +4,5 | OK | pousa OK | agachar 2× no ar OK |
| Altaria | land (canJump=false) + air/bird | can_power_jump (força 0) | OK | OK | OK +6,8 | OK +2,75 | +4,1 | OK | pousa OK | agachar 2× OK |
| Dragonite | land (canJump=false) + air/jet + liquid/dolphin | can_power_jump (força 0) | OK | OK | OK +10,1 | OK +2,75 | +7,6 | OK | pousa OK | agachar 2× OK |
| Latias | land (canJump=false) + air/jet | can_power_jump (força 0) | OK | OK | OK +14,1 | OK +2,0 | +11,7 | OK | pousa OK | agachar 2× OK |
| Metagross | land (pulo) + air/hover | can_power_jump | OK | OK | OK +9,0 | sem fôlego: plana e pousa (esperado) | +5,5 | OK | pousa OK | agachar na terra OK |
| Golurk | land (pulo) + air/rocket | can_power_jump | OK | OK | OK +10,9 | OK +3,4 | +8,7 | OK | pousa OK | agachar 2× OK |
| Bronzong | air/hover (só ar) | trava 256 | OK | OK | — | — | +3,3 | OK | — | agachar 2× OK |
| Lapras | land (canJump=false) + liquid/boat | can_power_jump (força 0) | OK | OK | — | — | — | OK | entra e sai da água OK | agachar 2× na água OK |
| Milotic | land (canJump=false) + liquid/dolphin | can_power_jump (força 0) | OK | OK | — | — | — | OK | entra e sai OK | agachar 2× OK |
| Wailmer | land (canJump=false) + liquid/submarine | can_power_jump (força 0) | OK | OK | — | — | — | OK | entra e sai OK | agachar 2× OK |
| Sharpedo | liquid/dolphin (só água) | trava 256 | OK | OK | — | — | — | OK | — | agachar 2× OK |
| Seaking | liquid/submarine (só água) | trava 256 | OK | OK | — | — | — | OK | — | agachar 2× OK |

Antes da correção, na mesma matriz: Dragonite, Altaria, Latias, Lapras, Milotic, Wailmer sem ação de Espaço na terra;
decolagem de todos os voadores `LAND>AIR>LAND` em 10 ticks (sobe 0,02 a 0,99 bloco, o que vier do pulo de cavalo);
pulo segurado no ar 0 bloco. Sair da água só funciona olhando para cima (na água a montaria segue a câmera,
`free_camera_controlled`); com a câmera nivelada ela para no 1º degrau da margem, antes e depois da correção.

Dano (`PokemonDamage.isPokemonInvulnerable`, mesma rodada): o dono batendo de mão vazia, em pé e agachado, no próprio
Arcanine → vida 20 → 20, nenhum `hurt`; outro jogador batendo → 20 → 20, nenhum `hurt`; o dono batendo num Rattata
selvagem → 20 → 19, 1 `hurt`, nenhuma batalha aberta (`playerDamagePokemon` padrão).

## O que não dá para provar sem o cliente real

- **Espaço derrubando na terra**: o BDS não decide isso (o cliente manda `leave_vehicle`). A prova no servidor é que
  agora todo `ride_land` manda `can_power_jump` ao cliente, como o cavalo. Conferir: montar no Dragonite/Lapras,
  apertar e segurar Espaço na terra; não pode desmontar (a barra de pulo aparece e ele não sai do chão).
- **Decolagem e voo com a predição do cliente**: no BDS o servidor simula a montaria do bot. No cliente real, conferir
  com Dragonite e Charizard: dois toques em Espaço tiram do chão (~2,5 blocos) e a câmera fica na órbita; segurar
  Espaço sobe; agachar segurado desce até pousar (volta à 1ª pessoa); agachar 2× no ar desmonta; agachar 1× não.
- **Controle e toque**: o gesto é o mesmo botão Pular (playerButtonInput); conferir no controle (A duas vezes) e no
  toque (Pular duas vezes). A janela agora é de 12 ticks (0,6 s), a do Java.
- **Charizard**: a barra de força do cavalo continua no Espaço segurado (é o `can_power_jump` do Bedrock; o Java pula
  direto). Decolar é o pulo duplo.

## Observações (não corrigidas aqui)

- O servidor aceita `leave_vehicle` do cliente também no ar e na água; quem impede é a trava 256 que o cliente recebe.
- Montaria só-ar (Bronzong): o fôlego só recupera fora do AIR; como ela nunca sai do AIR, sem fôlego fica planando até
  desmontar (leitura de `staminaStep`; o Java recupera no chão). Não medido; fora do escopo.
