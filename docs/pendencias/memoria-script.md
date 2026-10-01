# Frente memoria-script — "[Watchdog] High memory usage detected" andando pelo mundo

Relato (cliente Windows, mundo multiplayer com 3 jogadores, base privado v1.0.11 + Mega Showdown v1.0.0): o aviso
`[Scripting][warning]-[Watchdog] High memory usage detected` aparece repetidamente "conforme eu ando pelo mundo".
Regra: corrigir sem tirar mecânica nem mudar a experiência; redução de dados dos Pokémon NÃO aprovada (não aplicada).

## Resumo

- **Causa 1 (o aviso que se repete): lixo que só o coletor de ciclos do QuickJS libera.** O QuickJS só roda o GC de
  ciclos quando o heap passa de um limiar que ele fixa em 1,5× o heap ao fim do GC anterior (`js_trigger_gc` no código de
  referência do QuickJS; no Bedrock só o efeito foi medido). Medido:
  23 MB de lixo cíclico em cima de 67,7 MB (90,9 MB) não dispararam o GC. Com 70–77 MB vivos, o heap sobe até ~105–115 MB
  antes de cair, acima do aviso padrão de 100 MB (BDS). O lixo vinha quase todo do spawner: os caches por
  posição de `neededNearbyBlocks` ficavam em `WeakMap<SpawnContext, …>`, e **no QuickJS do Bedrock o valor de um WeakMap
  só sai no GC de ciclos, mesmo com a chave já liberada** (cada posição deixava um Map e um `BlockVolume` nativo presos).
- **Causa 2 (peso fixo): ~13 MB de espécies parseadas guardadas para sempre.** O aquecimento do spawner lê o hitbox de
  todas as entradas de spawn e deixava as ~860 espécies parseadas no `speciesCache`, embora só precise de largura/altura.
- Não há vazamento sem limite: depois de um GC forçado, o que sobra da exploração são caches com teto ou estado do mundo.
- `entityRemove` dispara no descarregamento de chunk (medido): os caches por entidade já eram limpos.

| (build público, BDS, 1 bot, 30 teleportes + 4 min no spawn) | antes | depois |
|---|---|---|
| heap do script no início (`allocated`) | 68,6 MB | 55,6 MB |
| pico (fim da exploração + 4 min no spawn) | 77,2 MB | 59,3 MB |
| lixo coletado por um GC forçado no fim | 5,7 MB | 0,02 MB |
| taxa de crescimento parado no spawn (spawner ligado) | 0,56 MB/min | 0,15 MB/min |

(3 bots e Mega Showdown: tabelas mais abaixo.)

## Como foi medido

BDS 1.26.52.3 (pasta `.bds-v8`, container `cobblemon-bds-v8`, porta 19199, raknet, emulado com box64 no Mac).

- **Instrumento:** `/script diagnostics startcapture|stopcapture` grava `diagnostics/*.mcstats` (JSON + linhas
  base64-gzip) com `runtime_memory/allocated|used` e o detalhamento do QuickJS por amostra (`Memory Used`, `Malloc
  Count/Size`, objetos, strings, propriedades, funções, arrays), além de chunks carregados, entidades e handles de
  `Entity` por pack. Isso substituiu a bissecção cega do limiar.
- **Calibração do watchdog:** com `script-watchdog-memory-warning=60` e `=66` o aviso aparece; com `=72` não, com
  `allocated` ≈ 67,7 MB e `used` ≈ 54,7 MB. **O watchdog compara o heap alocado do QuickJS (`allocated`)**. Padrões do
  BDS (documentados no `server.properties` dele): aviso **100 MB**, limite **250 MB** (salva e encerra o mundo).
- **Exploração:** bots de protocolo (tests/e2e/lib/bot.mjs) em criativo, `spreadplayers` (superfície) a cada 8 s, passos
  de 64–128 blocos com desvio, direções diferentes por bot, spawn natural ligado (vanilla e Cobblemon); checkpoints a
  cada 5 teleportes; depois volta ao spawn (15/45/90/150/240 s) e sem jogadores (+20 s). Mundo novo por cenário.
- **Sonda temporária (removida):** contagem de ~90 estruturas (Maps/Sets de módulo, caches por entidade/posição),
  eventos `entityRemove`/`entityLoad`/`entitySpawn`, e ações para forçar GC (lixo cíclico em lotes até um `WeakRef`
  canário sumir) e isolar fontes de lixo. Prelúdios de medição (só no dist de teste, colados no topo do `main.js`)
  contaram Map/Set e generators por local de criação.

## Evidências

1. **`entityRemove` dispara no descarregamento:** `removePokemon` sobe enquanto `loadedPokemon` cai, e `dataCache`,
   `nextAmbient`, `heldItemCache`, `heldShown` acompanham os Pokémon carregados (ex.: 45/46, 56/57); sem jogadores,
   todos voltam a 0. Handles de `Entity` retidos pelo pack = Pokémon carregados.
2. **O crescimento era quase todo memória fora dos objetos JS contados:** `used` +1,7 MB contra `allocated` +8,4 MB. No
   QuickJS, registros de Map/Set/WeakMap e dados de handles nativos não entram em `used` (conferido num QuickJS local:
   50 mil entradas de Map = +50 mil alocações, `used` igual).
3. **GC forçado (antes da correção, 1 bot):** 72,5 → 96,0 MB durante a exploração; depois do GC, 75,0 MB. O GC liberou
   52 mil objetos e 176 mil alocações "sem dono" (−14,5 MB), com strings e arrays iguais.
4. **Fontes isoladas (20 mil chamadas, descartando o resultado):** Map local, generator completo, `getBlock`,
   `BlockVolume`, permutação: liberados na hora. Generator abandonado no meio: +6,9 MB até o GC. **WeakMap com chave
   descartável (valor: Map de 20): +4,45 MB até o GC; o mesmo Map numa propriedade da chave: liberado na hora.**
5. **Generators do spawner:** todos os 18 mil iniciados terminaram (nenhum abandonado), então não eram eles.
6. **Bissecção por subsistema (1 bot parado, janelas de 2 min após GC forçado):** a taxa vem do spawner da Cobblemon
   (desligado: ≤ 0; sem Pokémon e sem spawn vanilla: 0).
7. **Maps de `hasNearbyBlock` (valor do WeakMap) continuavam vivos depois do GC forçado** (1.903 de 2.007 criados, 13,6
   mil entradas), enquanto as outras estruturas de passe tinham saído.
8. **Espécies parseadas:** limpar `speciesCache` + learnsets derrubou `allocated` em 13,55 MB (74,8 → 61,2) e 133 mil
   strings. No QuickJS local, parsear as 894 espécies custa +7,2 MB de `used` (mais o custo por alocação).

## Correção (nada muda no jogo)

1. `scripts/speciesData.ts`: `peekSpeciesData` devolve os dados da espécie sem guardar no cache (se já estiver no
   cache, devolve a mesma instância). `scripts/spawning/SpawnSelector.ts` (`spawnSizeOf`, usado pelo aquecimento e
   pelo passe) usa `peekSpeciesData`: o tamanho continua pré-calculado para todas as entradas (o passe não parseia nada) e
   a espécie só entra no cache quando é usada de fato (Pokémon criado, telas…). Custo novo: um `JSON.parse` por espécie
   na primeira vez que ela nasce (QuickJS: 0,045 ms na mediana, 0,3 ms na maior, Milcery). Nenhum código compara
   objetos de espécie por identidade nem os altera (conferido).
2. `scripts/spawning/SpawnConditions.ts`: o cache de respostas e a caixa (`BlockVolume`) de `neededNearbyBlocks` ficam na
   própria posição, em propriedades não enumeráveis com chave `Symbol` (não aparecem em `Object.keys`/JSON e o
   `{ ...ctx }` da posição de pesca não as copia, então ela continua com cache e caixa próprios, como antes). Posição não
   extensível cai no WeakMap de antes. Mesmas respostas e o mesmo número de consultas ao mundo.

Teste: `tests/memoria-script.test.ts` (7 grupos): depois do aquecimento nenhuma espécie de spawn fica no cache
(controle negativo com o código antigo: falha listando bulbasaur, ivysaur…); `peekSpeciesData` sem cache = dados iguais
e objeto novo, com cache = mesma instância; tamanho de spawn de todas as entradas e membros de herd igual à conta antiga
sobre `getSpeciesData`; `neededNearbyBlocks` com uma consulta por lista e posição, cache oculto, cópia de pesca com cache
próprio, posição congelada e `nearbyBlocks` explícito.

## Medições (antes → depois)

Heap do script (`runtime_memory/allocated`, MB) no BDS, mundo novo por cenário. "GC" = GC de ciclos forçado pela
sonda; "lixo" = quanto esse GC liberou no fim. Os builds "antes" e "depois" de cada linha diferem só nos 3 arquivos da
correção (mesma sonda).

**(a) Mundo novo parado, só o base** (build público): sem jogador, logo após o boot, 67,6 (`used` 54,7) antes; com 1
bot recém-conectado, 68,6 → 55,6.

**(b) Base + Mega Showdown, 1 bot parado no spawn:**

| build | início | após GC | sem jogador |
|---|---|---|---|
| v1.0.11 privado original + MSD 1.0.0 (o do cliente) | 75,4 | – (sem sonda) | 77,4 |
| privado atual sem a correção + MSD | 76,1 | 76,3 | 76,2 |
| privado atual com a correção + MSD | **62,3** | 63,2 | 63,2 |

O MSD (tabelas + extensão) custa +6,9 MB sobre o público. `speciesCache` no boot: 872 → 11 espécies.

**(c) e (d) Exploração (30 teleportes de 64–128 blocos, 8 s cada) e volta ao spawn:**

| cenário | início | após GC inicial | pico (spawn +240 s) | lixo no GC final | após GC final | sem jogador +20 s |
|---|---|---|---|---|---|---|
| público, 1 bot, antes | 68,6 | 68,8 | 77,2 | 5,71 | 71,5 | 70,3 |
| público, 1 bot, depois | 55,6 | 56,1 | **59,3** | **0,02** | 59,3 | 58,3 |
| público, 3 bots, antes | 70,9 | 69,7 | 77,3 | 5,43 | 71,8 | 70,4 |
| público, 3 bots, depois | 56,2 | 57,3 | **60,0** | **0,08** | 60,0 | 58,2 |
| privado + MSD, 1 bot, antes | 75,7 | 75,6 | 84,4 | 5,01 | 79,4 | 77,7 |
| privado + MSD, 1 bot, depois | 62,4 | 62,8 | **67,5** | **0,02** | 67,4 | 65,9 |

Curva completa (público, 1 bot, antes → depois; MB × teleportes × chunks × Pokémon carregados):

| fase | teleportes | chunks | Pokémon | antes | depois |
|---|---|---|---|---|---|
| início | 0 | 358 | 26 / 23 | 68,6 | 55,6 |
| explora | 5 | 789 / 769 | 94 / 76 | 71,5 | 57,6 |
| explora | 10 | 625 / 935 | 72 / 108 | 71,7 | 58,3 |
| explora | 15 | 678 / 872 | 77 / 86 | 71,9 | 58,6 |
| explora | 20 | 923 / 723 | 104 / 70 | 73,5 | 58,7 |
| explora | 25 | 928 / 472 | 90 / 63 | 73,9 | 58,6 |
| explora | 30 | 645 / 512 | 73 / 63 | 74,1 | 58,7 |
| spawn +15 s | 30 | 501 / 330 | 73 / 50 | 74,9 | 58,7 |
| spawn +90 s | 30 | 501 / 376 | 123 / 80 | 76,3 | 59,2 |
| spawn +240 s | 30 | 501 / 376 | 106 / 89 | 77,2 | 59,3 |
| GC forçado | 30 | | | 71,5 | 59,3 |
| sem jogador +20 s | 30 | 0 | 0 | 70,3 | 58,3 |

**Taxa parado no spawn** (1 bot, janelas de 2 min após GC forçado): antes 0,56 MB/min (+6.795 alocações sem dono),
depois 0,15 MB/min (+485). Spawner da Cobblemon desligado: ≤ 0 nos dois.

Leitura: antes, o lixo do spawner crescia ~0,5 MB/min por jogador parado e mais explorando (1 bot: +8,4 MB em ~10 min),
e só o GC de ciclos devolvia; com 70–77 MB vivos (MSD), esse GC só roda perto de 105–115 MB, acima do aviso de 100 MB. Depois, o heap vivo fica 13–14 MB
menor e quase não sobra lixo para o GC; o que ainda cresce com a exploração é estado vivo (Pokémon carregados, espécies
usadas entrando no cache, caches com teto) e volta quando os chunks descarregam.

Sem vazamento: depois do GC forçado, o que a exploração deixa sem jogadores (+1,4 a +2,1 MB) é limitado (contagens da
sonda): cache negativo de estruturas vanilla (teto 8192; 764 entradas), consultas de vila (teto 4096; 152), habitats
encontrados (39, estado do mundo), regiões do registro de estruturas (9), learnsets e espécies usadas (≤ nº de
espécies).

## Peso de base (o que sobra) e opções (não aplicadas)

Heap no início, sem jogador, build público: 67,6 MB (`used` 54,7 MB) antes; ~55 MB depois. `used` por módulo, avaliado
isolado num QuickJS local (o Bedrock guarda também o bytecode do módulo, então os números reais são maiores):

| item | `used` |
|---|---|
| `@pkmn/sim` como o build monta (com o `slimShowdown`, que já troca os learnsets do Showdown por stub) | 9,4 MB |
| `species.ts` (JSON por espécie, strings) | 3,2 MB |
| `variants.ts` | 3,2 MB |
| `spawns.ts` | 2,1 MB |
| `msd.ts` + `megaShowdownContent.ts` (só no privado) | 1,6 + 1,3 MB |
| `habitats.ts`, `actionEffects.ts`, `entityData.ts`, `dex.ts` | 1,1 / 0,9 / 0,8 / 0,8 MB |
| código dos scripts (12 mil funções; bytecode 4,4 MB) | ~7,8 MB |

- Sem os learnsets do Showdown (já é o que o build faz) o `@pkmn/sim` cai de 24,2 para 9,4 MB. Trocar também a
  `legality` dos mods de geração por stub não muda nada (medido: 9,37 → 9,37 MB).
- As tabelas do MSD no `main.js` privado são +2,44 MB de bundle (15,23 contra 12,79 MB) e ~2,9 MB de `used` local. Peso
  medido no BDS: ver "Medições". Carregar sob demanda (JSON por espécie, como `SPECIES`) economizaria só a diferença
  entre objeto e string (~1 MB) e mexe em dados do MSD; não aplicado.
- O que mais pesa e daria ganho grande seria reduzir os dados dos Pokémon (não aprovado).

## O que só o cliente real confirma

- No mundo hospedado pelo cliente, o limiar do aviso é o do cliente (no BDS o padrão é 100 MB). Esperado depois da
  correção: o heap vivo ~13 MB menor e quase sem lixo do spawner. O GC ainda roda perto de 1,5× o heap vivo, e com
  muitos Pokémon carregados (3 grupos de ~100) o heap vivo sobe (~25 KB de dados por Pokémon carregado), então o aviso
  ainda pode aparecer, mas bem mais raro.
- O BDS emulado (box64) passa por menos passes de spawn por minuto que um PC; as taxas absolutas no cliente são maiores,
  e as proporções valem.

## Verificação (2026-10-01)

- `npx tsc -p tsconfig.json`: 0 erros.
- `npm test`: todos passaram, inclusive `memoria-script: 7 grupos de testes ok`.
- `npm run validate`: "OK: nenhum erro"; "MSD: OK".
- `node tools/check-ui-baseline.mjs`: ok (11 arquivos de UI, 0 aviso).
- E2E base (`COBBLEMON_BDS=v8 COBBLEMON_BDS_PORT=19199 COBBLEMON_MSD=0 node tools/e2e/run.mjs --deploy`, mundo novo):
  **10/10**, sem ⚠.
- E2E MSD 01 (`COBBLEMON_MSD=1 … --scenario tests/e2e/msd/01-gimmicks.e2e.mjs`, mundo novo): **1/1**; 1 linha ERROR do
  preparo do bot ("No targets matched selector"), como nas outras frentes.
- E2E MSD 07 (`… --scenario tests/e2e/msd/07-selftest.e2e.mjs --rm`, mundo novo): **1/1**, `/cobblemon:selftest msd`
  com 0 falhas e área limpa.
- Container `cobblemon-bds-v8` removido; `server.properties` do v8 sem limiar de watchdog (só os testes de calibração,
  desfeitos); capturas de diagnóstico e dists de medição apagados.

## Arquivos

Editados: `scripts/speciesData.ts`, `scripts/spawning/SpawnSelector.ts`, `scripts/spawning/SpawnConditions.ts`.
Novos: `tests/memoria-script.test.ts`, este documento. A sonda, os prelúdios e os scripts de medição ficaram fora do
repositório (scratchpad) e foram removidos do código.
