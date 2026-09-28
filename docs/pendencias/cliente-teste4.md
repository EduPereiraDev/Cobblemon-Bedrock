# Frente "cliente-teste4": o que sobrou no content log do 4º teste em cliente (beta 5, pack v1.0.5)

Log: `ContentLog2026-09-28_05-46-16_1.txt` (selftest telas + full completos; 5 linhas de problema, antes 108 mil).
BDS próprio `last` (porta 19185, `dist-last`, RakNet, online-mode=false), removido no fim. Sem commit.

| Linha no 4º teste | Qtde | Status |
|---|---:|---|
| `[Molang][error] evo_sparkleburst … 0.5 * math.clamp(v.entity_size,1,2) … unknown variable` | 2 | FEITO (importador + regra no validate) |
| `[Scripting][warning] [spawn] passe lento: 57 ms na maior fatia (espaço …)` | 1 | Diagnóstico FEITO; dividir mais a fatia NÃO POSSÍVEL (ver prova); aviso passa a dizer onde a parada ocorreu |
| `Falha ao spawnar … LocationInUnloadedChunkError` | 2 | FEITO pelo orquestrador (`spawnPreparedEntity` com `isChunkLoaded`) |

## 1. `evo_sparkleburst`: variável desconhecida com o guarda no creation_expression — FEITO

**Causa (medida no log).** A expressão acusada, `0.5 * math.clamp(v.entity_size,1,2)`, é só a do
`minecraft:emitter_lifetime_once.active_time`. A mesma partícula lê `v.entity_size` no
`emitter_rate_instant.num_particles`, no `emitter_shape_sphere.radius` e na aparência, e nenhuma dessas acusou; as
outras ~494 partículas guardadas no 3º teste leem v.* só em `emitter_rate_*`, `emitter_shape_*` e `particle_*` e também
não acusaram. As irmãs `evo_*` (mesmo pai `evo_particles`, mesmo guarda) têm `active_time` constante e não acusaram.
Conclusão: o cliente calcula o tempo de vida do emissor quando o emissor nasce, **antes** do `creation_expression`.
Aconteceu nos dois contextos: 06:18:09 = chamada direta da fase `particles` do selftest (sem MolangVariableMap);
06:18:19 = filha disparada pelo `evo_particles` 10,01 s depois (evento `event_sparkleburst`).

**Correção (importador, `tools/importer/molangVars.ts`).** `PARTICLE_PRE_INIT_COMPONENTS` =
`emitter_lifetime_once`, `emitter_lifetime_looping` (recalcula a cada ciclo) e `emitter_lifetime_expression` (a partir
do 1º quadro). Nesses componentes toda leitura sem `??` de variável que não é do motor vira `(v.x ?? padrão)` na
própria expressão (`guardPreInitReads`, chamado por `guardParticleVariables`, logo vale para `particles.ts` e para a
partícula própria do Dynamax). Mesmo padrão do guarda do `creation_expression` (entity_* do script sem tamanho, começo
da curva, 0 = Java); o `??` mantém o valor que o script passar. Escrita antes na mesma expressão conta como definida.
Resultado: `"active_time": "0.5 * math.clamp((v.entity_size ?? 1),1,2)"`. No import: 1 partícula no base
(`evo_sparkleburst`) e 34 no MSD (`silvally_*`, `rotom_*`, `mega_evolution_scythe*`, `darmanitan_part*`,
`primal_*_burst`, `z_move_*burst`, `minior_effect`…), as mesmas que o selftest do MSD acusaria.

**Regra (`npm run validate`).** `particleVariableProblems` (§1 de `validateVariables.ts`, base e base + MSD, geradas e à
mão): leitura sem guarda no tempo de vida do emissor é erro mesmo com o padrão no `creation_expression`.

**Prova.** Validate: nenhum erro de partícula (1.040 base, 1.364 base + MSD conferidas); os erros que sobram são de
z-fighting da frente zfight2 (11 no base, 15 no MSD — ver "Verificação"). Antes do import, a regra nova acusava o
`evo_sparkleburst` gerado. Teste `tests/cliente-teste4.test.ts` (regra, reescrita, idempotência, looping/expression,
todas as partículas geradas de base e MSD). O BDS não carrega o RP: a prova final da linha é o próximo teste em cliente.

## 2. Spawner: "passe lento: 57 ms na maior fatia (espaço …)" — diagnóstico FEITO; divisão NÃO POSSÍVEL

**O que roda numa fatia "espaço" (lido no código e medido).** O rótulo é o do `yield` que fecha a fatia. Só dois pontos
cedem com "espaço": dentro de `makeHasSpaceJob` (depois de uma leitura NOVA de bloco, quando o relógio passou do
orçamento de 3 ms) e em `addPositionDataJob` logo depois do `hasSpaceJob` (`clock.due`). Entre o `yield` anterior e esse
só cabe: os filtros antes do espaço de UMA entrada (`allowed` já memorizado pelo `warmJob` — as condições, com as
consultas de estrutura/blocos por perto, rodam nas fatias "condições"; `removedEntries`; influências `affectSpawnable`),
`entrySizeOf` (aquecido no carregamento) e leituras de bloco com o relógio conferido entre CADA leitura nova. Não há
`containsBlock`, `getBlocks` nem consulta de estrutura na fatia "espaço"; os pesos (`weightAt`, com os 12
`neededNearbyBlocks` de multiplicadores) fecham fatias "bucket".

**Medido no BDS** (cenário novo, sonda `[spawn] passe:` por passe, spawner natural com o bot andando 64 blocos a cada
20 s e os selvagens removidos para os passes não pararem no teto; tabela em "Rodadas no BDS"): em ~200 mil leituras de
bloco (288–614 por passe) e ~40 mil consultas ao mundo, a fatia "espaço" nunca passou de 6 ms e a maior consulta ao
mundo foi 11 ms. As leituras isoladas têm mediana ≤ 1 ms, mas UMA `getBlock` parou 17 ms numa rodada e 79 ms em
outra (virou uma fatia "posições" de 80 ms). Ou seja: o fatiamento do espaço funciona e a fatia só fica grande quando
uma única chamada para — o mesmo fenômeno do cliente, reproduzido no BDS.

**Por que 57 ms não é trabalho do spawner.** Com o relógio conferido entre leituras, 57 ms numa fatia "espaço" só é
possível com uma única chamada de ~57 ms (a leitura em curso). Nos dois testes o número é o mesmo (3º: 00:25:05, fase
`movement` do selftest; 4º: 06:20:32, fase `battle`), uma vez por sessão, sempre depois da fase `entities` do selftest
(heap no máximo: ~1.000 espécies parseadas e em cache, 1.100 entidades criadas/removidas). É o perfil de uma parada do
motor dentro de uma chamada nativa — o mais compatível é a coleta de ciclos do QuickJS, que roda quando o heap cresce
~50% e para o script pelo tempo de percorrer o heap inteiro (mesmo heap → mesma duração), disparada numa alocação (a
leitura de bloco cria o objeto `Block`). O spawner não controla quando ela roda nem pode dividi-la.
Tentativas de medir a coleta no BDS: `FinalizationRegistry` existe no QuickJS do Bedrock mas o callback não disparou em
60 s de lixo cíclico (o motor controla a coleta); laços puros sem alocação têm paradas de 20–56 ms (e até 421 ms com
outros BDS de pé) no BDS emulado (box64). O BDS não separa coleta de ruído de agendamento; não há API estável de
memória/GC. (NÃO POSSÍVEL provar a coleta sem cliente.)

**Correções.**
- `Spawner.ts`: `ZoneBlockCache`/`resolvePositionsJob` contam as leituras e medem cada `getBlock` (`ReadStats`: total, a
  maior do passe e a maior da fatia em andamento). O aviso de passe lento agora traz `leituras de bloco N, a maior X ms;
  consultas ao mundo M, a maior Y ms` e, quando ≥ 80% da maior fatia é UMA leitura (`singleReadNote`), `; X ms numa
  única leitura de bloco (chamada indivisível: parada do motor ou do coletor de lixo, não trabalho do spawner)`. No
  próximo teste em cliente a linha diz sozinha se a parada foi dentro de uma chamada ou trabalho acumulado.
- `SpawnConditions.ts`: `timedWorldQuery` mede os `containsBlock` de blocos por perto e as consultas de estrutura das
  condições (e o `containsBlock` da zona, no `Spawner.ts`) para o aviso e a sonda.
- Sonda por passe (desligada por padrão; `scriptevent cobblemon:debug_probes on`): `[spawn] passe: maior fatia …,
  leituras de bloco …, na maior fatia …, consultas ao mundo …` — usada pelo cenário novo.
- Fatia "zona" dividida: `zoneIsFull` e `wildNear` (duas `getEntities` nativas) em fatias separadas (medido: 22 ms
  juntas no BDS). Mesmas consultas, mesma ordem.

**Resultado do spawn igual.** Nada muda na seleção: as medições só leem o relógio. Teste com semente fixa já existente
(`tests/cliente-log.test.ts`, "seleção fatiada = síncrona", 12 rodadas) continua passando; teste novo: o `hasSpace`
com a cache medida dá o mesmo resultado e o mesmo número de leituras que sem medição, a fatia "espaço" nunca junta mais
que o orçamento + uma leitura (leitura de 1 ms → fatia ≤ 7 ms) e uma leitura parada de 60 ms vira a fatia inteira e é
atribuída pela nota.

## Verificação

- `npm run import`: OK (base + MSD). Contador novo no `import-report.json`: "partículas: variáveis lidas no tempo de vida
  do emissor com (v.x ?? padrão) na expressão" 1 (base).
- `npm run validate`: nenhum erro desta frente; 11 erros no base e 15 no base + MSD, todos de z-fighting/espessura zero
  da frente zfight2 (`studio_platform`, ambipom, articuno, chimecho, comfey, farigiraf, flamigo, graveler, hatterene,
  porygonz, primarina). Como o base falha, o `validateMsd` do `npm run validate` não roda; rodado à parte: só os mesmos
  erros de z-fighting.
- `npx tsc -p tsconfig.json`: 0 erros.
- `npm test`: todos passam (`tests/cliente-teste4.test.ts`: 7 testes).
- BDS `cobblemon-bds-last`: ver "Rodadas no BDS". Aviso alheio a esta frente no log: `cobblemon:studio_platform`
  `platform_scale` com `default` que não é float (frente ui-polish).
- `cobblemon-bds` (orquestrador) não foi tocado. Nenhum commit.

## Rodadas no BDS

Cenário `tests/e2e/experimental/cliente-teste4-spawn.e2e.mjs` (`CT4_MINUTES`, padrão 4).

Todas no mesmo `cobblemon-bds-last`, bot entrando pelo E2E; spawner natural ligado; sonda por passe ligada. As duas
últimas com o build final.

| Rodada | Passes | Leituras de bloco | Maior fatia "espaço" | Maior leitura isolada | Maior fatia (rótulo) | "passe lento" |
|---|---:|---:|---:|---:|---|---:|
| 4 min parado num lugar (sem mover/limpar) | 18 | ~8 mil | 4 ms | 1 ms | 20 ms (criar entidade) | 0 |
| 6 min, move 24 blocos/30 s + limpa selvagens | 136 | 49.841 | 4 ms | 5 ms | 41 ms (bucket, sem leitura nem consulta) | 1 |
| 8 min, move 64 blocos/20 s + limpa (antes da fatia "zona" dividida) | 143 | 52.527 | 6 ms | 17 ms (numa fatia "posições" de 19 ms) | 22 ms (zona: 2 `getEntities`) | 2 (21 e 22 ms) |
| 8 min, idem, **build final** | 130 | 48.508 | 5 ms | **79 ms** (fatia "posições" de 80 ms) | 80 ms (posições) | 1 (30 ms, bucket; o de 80 ms caiu no limite de 1 aviso/10 s) |
| 8 min, idem, **build final** | 129 | 48.157 | 4 ms | 5 ms | 20 ms (bucket) | **0** (cenário ✓) |

Leitura das rodadas:
- A fatia "espaço" ficou em 4–6 ms em ~200 mil leituras de bloco: o que o spawner faz nela respeita o orçamento.
- A 4ª rodada reproduziu no BDS o fenômeno do cliente: uma única `getBlock` de 79 ms (mediana ≤ 1 ms) virou uma fatia
  de 80 ms. As fatias "bucket" de 25–30 ms caíram no mesmo segundo (10:55:51–56), sem leitura de bloco e com consultas
  ao mundo ≤ 2 ms: parada do servidor inteiro (o BDS emulado para até 56 ms num laço de conta sem alocação, sonda
  temporária `cbprobe` só no `dist-last`, fora do código-fonte). No cliente o mesmo tipo de parada é o de 57 ms.
- A fatia "zona" (duas `getEntities`) somava 22 ms; dividida, ficou em 3–5 ms.
- Resultado: sem aviso de passe lento na rodada final limpa (0) e, nas de carga (terreno novo a cada 20 s no BDS
  emulado), só avisos de paradas isoladas que o spawner não divide; o aviso agora diz quando foi numa única leitura.
- Sonda temporária de GC/alocação (`cbprobe:*`, anexada ao `main.js` de `dist-last` e removida no build final): laço de
  alocação de lixo com o add-on carregado teve passos de 39–187 ms; laço sem alocação, 18–56 ms (15 s) e até 421 ms
  (90 s, com outro BDS de pé); `FinalizationRegistry` existe mas não chamou em 60 s. Inconclusivo para separar coleta de
  ruído no BDS.
- Container removido (`docker rm -f cobblemon-bds-last`).

## Arquivos

- Importador: `tools/importer/molangVars.ts` (componentes antes da inicialização, guarda na expressão, regra),
  `tools/importer/particles.ts` (contador).
- Scripts: `scripts/spawning/Spawner.ts` (medição das leituras, nota do aviso, sonda, fatia "zona" dividida),
  `scripts/spawning/SpawnConditions.ts` (medição das consultas ao mundo).
- Testes: `tests/cliente-teste4.test.ts`, `tests/e2e/experimental/cliente-teste4-spawn.e2e.mjs`.
