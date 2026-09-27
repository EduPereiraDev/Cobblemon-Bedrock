# Frente "visual-batalha" (BDS `visual-batalha`, porta 19151)

Visual e áudio da batalha que faltavam para o Cobblemon 1.8.2: Illusion/Transform/Imposter, envio com bola e recolha
com feixe, balsa na água, efeitos de status/boost, Sketch permanente, tipo efetivo na tela, mensagens de troca,
Eggant Berry segurada e sons de level-up.

## Arquivos

| Tipo | Arquivos |
|---|---|
| Novos (scripts) | `scripts/battle/{Switching,SendOut,Platform,LevelUpSounds,DebugVisual}.ts`, `scripts/battle/effects/Mock.ts` |
| Alterados (scripts, da frente) | `scripts/battle/{BattleInterpreter,ActivePokemon,BattleActor,BattleSide,BattleMessage,PokemonBattle,Rewards,index}.ts`, `scripts/battle/effects/index.ts`, `scripts/GUI/Battle.ts`, `scripts/showdown.ts` |
| Fora da frente (mínimo) | `scripts/Pokemon.ts`: 1 import + 1 linha no fim de `gainExp` (gancho de som de level-up; não toquei `return`/`sendOut`) · `tools/importer/particles.ts`: acréscimos (partículas de bola, ids sem "/", looping → once) · `tests/mocks/minecraft-server.ts`: export `ScriptEventSource` |
| BP/RP (novos) | `behavior_packs/.../entities/visual_batalha/battle_platform.json`; `resource_packs/.../entity/visual_batalha/battle_platform.entity.json`, `render_controllers/visual_batalha/battle_platform.render_controllers.json`, `models/entity/visual_batalha/water_platform_{xs,s,m,l,xl}.geo.json`, `textures/entity/visual_batalha/water_platform_*.png`, `particles/visual_batalha/recall_beam.particle.json`, `textures/particle/visual_batalha/phase_beam.png` (geometrias/texturas copiadas do Cobblemon) |
| Teste | `tests/visual-batalha.test.ts` |
| Textos | nenhum novo (usa `cobblemon.battle.switch.*`, `withdraw.*`, `transform`, `activate.*` do Cobblemon) |

## Status por item

| Item (PARIDADE) | Status | Como / prova |
|---|---|---|
| Visual de Illusion (§3, §10.1 #5) | FEITO | **Bug corrigido antes**: o `@pkmn/sim` identifica o Pokémon com Illusion pelo nome do disfarce, e o port tirava de campo o Pokémon errado (o disfarce). `showdown.ts` agora mantém a identidade real e manda o disfarce em `[is] p1: <uuid>` no `switch`/`drag` (formato do fork do Cobblemon). Em campo: entidade de exibição da espécie do disfarce (variant pelos aspects, escala, tamanho, rótulo) no lugar do real, que fica invisível e sem rótulo (`effects/Mock.ts`). Nomes nas mensagens, "Vai! X!", Pokédex (vê o disfarce), menu de alvos e estado da batalha usam o disfarce para quem não é aliado. `replace` tira o disfarce: grito 1 s depois, anel de shiny, Pokédex revela o real (IllusionEffect.revert). Prova: teste (mock `cobblemon:pikachu` sobre o Zoroark, real invisível, `[is]` no protocolo) e BDS `debug_visual illusion` (`mocks=1` enquanto o Zoroark está em campo, 0 depois do `replace`/desmaio) |
| Visual de Transform (golpe) | FEITO | `-transform` → entidade de exibição da espécie do alvo com o shiny de quem se transforma (TransformEffect), grito 1 s depois, fila espera 1 s e só então a mensagem. Prova: BDS `debug_battle ditto mew 50` (`-transform` sem erro) e `debug_visual transform` (`mock=transform:cobblemon:mew` do turno 2 até o desmaio, `mocks=0` no fim) |
| Visual de Imposter | FEITO | Mesmo efeito, disparado pelo `-transform` que segue o `switch`; o grito do envio não toca (imposter), como no SwitchInstruction. Prova: `debug_visual imposter` (`mock=transform:cobblemon:pidgey` desde o turno 1) |
| Fim dos efeitos | FEITO (desvio) | Desmaio, recolha e fim da batalha tiram a entidade de exibição (jogador: com grito, `effects.wipe()`). Desvio: no Cobblemon o **selvagem** transformado continua transformado depois da batalha (efeito salvo no NBT); aqui volta ao normal no fim (a entidade de exibição não anda com a IA) |
| Sketch permanente (#24) | FEITO | `-activate …|move: Sketch|<golpe>` troca Sketch pelo golpe no `PokemonData` (exchangeMove: proporção de PP, Sketch vai para os guardados) e salva; clone de batalha não afeta o real. Dois bugs achados no caminho: `Effect.typelessData` cortava a 1ª letra de efeitos sem prefixo ("Tackle" → "ackle", afetava todos os `extraEffect`) e o `-activate` enfileirava a mensagem no fim da fila (em batalhas rápidas nunca rodava antes do `win`). Prova: teste (moveset salvo com `tackle`, `sketch` em `learnedMoves`) e BDS `debug_visual sketch` (moves `sketch` → `tackle`) e `debug_battle smeargle pidgey 50` limpo |
| Tipo efetivo de Hidden Power/-ate/Normalize na tela (#25) | FEITO | `GUI/Battle.ts`: cor/ícone do tile e dica de efetividade pelo tipo de `MoveTemplate.getEffectiveElementalType` (Hidden Power pelo `hpType`, Pixilate/Aerilate/Refrigerate/Galvanize em golpes Normal não-status, Normalize). Prova: teste |
| Mensagem de troca no log (#26) | FEITO | `switch.self` ("Vai! X!") para o dono, `switch.other`/`.nickname` para os outros, `withdraw.self/other` antes da recolha; drag (Roar) usa `dragged_out`. Prova: teste PvP (as quatro chaves chegam a cada jogador certo) |
| Balsa na água (#18) | FEITO | `Platform.ts` + entidade `cobblemon:battle_platform` (5 tamanhos pelo hitbox×baseScale, geometria/textura do Cobblemon, `minecraft:is_collidable`, sem gravidade). Regra do Cobblemon: Pokémon com dono (jogador ou NPC), na água sem estar submerso, que não respira debaixo d'água/não anda na água/não voa; o Pokémon fica no convés (+0,25); sai ao pisar em terra, ao sair de campo e no fim. Envio mira a superfície da água. Prova: BDS `debug_visual water` (piscina): `platform=1@62.89 (convés 63.14)` e o Pokémon com `y=63.14` (em pé na balsa pela física do servidor), balsas removidas no fim. Conferir no cliente: textura/orientação da geometria |
| Envio com bola (§10.1 #6, #87, #94) | FEITO | `SendOut.ts`: `poke_ball.throw`, bola (`<bola>_dummy`) em arco por 0,5 s, `poke_ball.trail`, estouro com `<bola>_battle_sendflash` → `ballsparks` + `ballsendsparkle` → (0,4 s) `<bola>_ballsparkle`, `send_out`/`shiny_send_out` (via `PokemonData.sendOut`), Pokémon cresce em 0,4 s pela `cobblemon:scale_modifier`, fim em 1,5 s (grito). Começo da batalha escalonado (0,35 s × posição + até 0,15 s) com a fila esperando `stillSendingOut`. Prova: teste (bola dummy criada, partícula `cobblemon:pokeball_battle_sendflash`) e BDS (todas as batalhas de NPC do `debug_visual` com envio/troca, sem erro) |
| Recolha com feixe (#87) | FEITO | Feixe vermelho (1; 0,1; 0,1) de partículas `cobblemon:recall_beam` (textura `phase_beam` do Cobblemon) da mão até o Pokémon, que encolhe de 0,2 a 0,6 s; sai de campo (`PokemonData.return`/instant_kill do NPC) e a troca continua em 1,5 s. Desvio: o som `poke_ball.recall` toca quando o Pokémon some (é o `return()`), não no início do feixe |
| Posição de envio e rotação (§10.1 #19) | FEITO | `getSendOutPosition` do ActiveBattlePokemon (posições iniciais dos atores, mínimo 4 + meia largura, singles 0,4/0,3 + passo lateral, duplas ±2,5, triplas −3,5/0/+3,5, raio contra parede) e o Pokémon vira para o oponente em frente |
| Partículas de bola no RP (#87) | FEITO | Importador: as 346 partículas de `balls/**` (envio casual/battle de todas as bolas, `capture/*`, `hisui/*`) com ids sem "/" (`cobblemon:pokeball_battle_sendflash`). Correção geral: emissor `looping` sem `sleep_time` vira `once` (no ParticleStorm do Cobblemon ele para depois de `active_time`; no Bedrock um emissor de `spawnParticle` repetiria para sempre) — afeta 72 partículas de golpes/espécies |
| Partículas/sons de status e boost (§3, #102) | FEITO | Intérprete como o 1.8.2: `-boost`/`-unboost` → `boost`/`unboost` (statup/statdown), `cant` → timeline do status (paralisia/sono/paixão), `-activate` → status (confusão, paixão) ou `activate_<id>` (Protect, Powder), `-start` → `start_<id>` (alphaboost), `-prepare` → `prepare_<id>`, dano de status já existia (agora distingue `tox`). `-status` não toca efeito (igual ao StatusInstruction do 1.8.2). Sons vêm dos eventos das partículas. Prova: teste (Growl → `cobblemon:statdown_actor`) |
| Eggant Berry segurada (#110) | FEITO | Registrada no dex do simulador com o script de `held_items/eggantberry.js` (come ao ficar apaixonado, `-end|…|move: Attract|[from] item: Eggant Berry`); `cobblemon:eggant_berry` vai para o set. Prova: simulação direta (linha `-enditem …Eggant Berry|[eat]` + `-end …[from] item: Eggant Berry`) e teste |
| `gui.levelup` / `levelup_start` (#93) | FEITO | `LevelUpSounds.ts` (PartyOverlayDataControl): `levelup_start` a cada ganho de EXP, `levelup` 15 ticks depois se subiu de nível (sem evolução nova, que já toca `evolution.notification`). Ligado na EXP de batalha (`Rewards.ts`) e em `PokemonData.gainExp` com jogador (doces, /levelup). Prova: teste |
| `gui.click` na tela de batalha | FEITO | Cada escolha nos forms da batalha toca `cobblemon.gui.click` (BattleGeneralActionSelection/MoveSelection/TargetSelection/SwitchPokemonSelection) |
| Nomes de Pokémon que entram no meio da batalha | FEITO (bug) | O Pokémon que entra passa a ocupar a posição já na leitura do `switch` (antes só no despacho): dano de Stealth Rock, Intimidate e desmaio logo na entrada eram descartados porque o handler não achava o Pokémon; quem sai fica achável até terminar a recolha |
| PvP de nível fixo (#17) | NÃO FEITO | Precisa de opção na tela de desafio/`/pokebattle` (`ChallengePlayer.ts`, `commands.ts`: fora desta frente). A API `adjustLevel` existe |
| UI de equipe para Multi | NÃO FEITO | Formação de dupla é tela de desafio (fora desta frente); o motor e a tela de batalha já aceitam multi |

## Conferência no servidor

`scriptevent cobblemon:debug_visual <illusion|transform|imposter|sketch|water> [x z]` (só pelo console): dois
treinadores (suportes de armadura como NPC) batalham e o log mostra a cada 2 s espécie, golpes, HP, disfarce,
entidade de exibição, altura e balsa. Sem jogador, crie antes um `tickingarea` no ponto.

Rodado no BDS `visual-batalha` (porta 19151): `debug_visual` illusion/transform/imposter/sketch/water e
`debug_battle ditto mew 50`, `zoroark eevee 50`, `smeargle pidgey 50` — todas até o `|win|`, sem erro de script. Log
sem ERROR/WARN desta frente; os únicos erros de conteúdo eram de outras frentes (`cobblemon:vulpix`
`can_stand_on_powder_snow`, `cobblemon:fossil_fetus` range, avisos do `crafting_item_catalog`).

## Verificação

- `npx tsc -p tsconfig.json`: 0 erros (em momentos intermediários apareceram erros transitórios de outras frentes:
  `generated/scripts/mundoDetalhes` sem exports novos até rodar o import de novo, `machines/discShelfSequencer`,
  `entity/SpeciesBehaviours`, `ui/RideControls` ainda sendo criados).
- `npm test`: todos ok na rodada final (incluindo `visual-batalha`, `batalhas` com 50 aleatórias, `showdown-adapter`,
  `animacao`, `captura`, `entidades`). Um ciclo de import meu (SendOut → catching/PokeBalls → StandardModifiers →
  batalha) chegou a quebrar `captura.test` e foi removido (nome da bola resolvido localmente).
- BDS parado no fim (`docker rm -f cobblemon-bds-visual-batalha`).

## Pedidos a outras frentes

1. **captura** (`scripts/catching/index.ts`, `handleBallHit`): com Illusion/Transform a entidade que aparece é a de
   exibição; a bola pode acertar nela. Resolver o alvo antes de tudo:
   `import { resolveMockTarget } from "../battle/effects/Mock"; target = resolveMockTarget(target);`
   (hoje o acerto na entidade de exibição cai no "drop" da bola). Também: `isBattleMock(entity)` para ignorar.
2. **captura** (envio fora de batalha, `Pokemon.sendOut`/`return`): as partículas por bola já estão no RP. API pronta:
   `playBallSendOutParticles(dimension, at, pokemon.pokeball, "casual")`, `animatedSendOut({... mode: "casual"})`,
   `animatedRecall(entity, undefined, player, () => pokemon.return(player))` em `scripts/battle/SendOut.ts`. Partículas
   de captura: `cobblemon:capturesparks`, `cobblemon:capturestar`, `cobblemon:afterspark`, `cobblemon:hisui*`.
   Dívida: `Pokemon.sendOut`/`return` tocam `poke_ball.send_out`/`recall` sem prefixo (existem no sounds manual).
3. **ui-base / telas** (`scripts/ui/BattleHud.ts`, `tileView`): mostrar o disfarce ao oponente (ActiveBattlePokemonDTO):
   `const shown = active.displayData(isAllyOfViewer)` para espécie/nome/gênero/retrato (nível e HP do real); com
   Transform (`active.mock?.kind === "transform"`) espécie/variant do `active.mock.data` para todos (fromMock).
4. **telas** (`scripts/ui/studio/Studio.ts`): a entidade de exibição de batalha usa a tag `cobblemon_ui_display`
   (para o `entitySpawn` do main.ts não criar dados de selvagem e o `entityLoad` a apagar se o chunk recarregar).
   Se o estúdio passar a apagar entidades com essa tag fora do `worldLoad`/`entityLoad`, excluir as com a tag
   `cobblemon_battle_mock`.
5. **animacao** (aviso): `tools/importer/particles.ts` agora converte `emitter_lifetime_looping` sem `sleep_time` em
   `emitter_lifetime_once` (semântica do ParticleStorm). Conferir no cliente as partículas de espécie que dependiam de
   repetir (a animação que as dispara em laço continua re-emitindo).

## Conferir no cliente

- Entidade de exibição: o rótulo do Pokémon real some (nameTag vazio) e a invisibilidade não mostra partículas.
- Bola em arco, estouro por bola e crescimento de 0,4 s; feixe vermelho e encolhimento na recolha.
- Balsa: orientação e textura das 5 geometrias (`water_platform_*`), convés rente aos pés.
