# Alvos "impossíveis" e o resultado da onda

Alvos marcados como NÃO POSSÍVEL/PARCIAL antes da onda (pesquisas 1–6, plano em [`PLANO.md`](PLANO.md)) e o que a
pesquisa + implementação conseguiram (2026-09-26). Status consolidado em
[`../PARIDADE-MECANICAS.md`](../PARIDADE-MECANICAS.md) e [`../PARIDADE-ITENS-BLOCOS.md`](../PARIDADE-ITENS-BLOCOS.md);
o que ainda depende de cliente real está no topo da primeira.

| Alvo | Antes | Resultado | Como (frente) |
|---|---|---|---|
| Baús dourados / Gimmighoul chest | PARCIAL | **FEITO** (clique: conferir no cliente) | Contêiner real por entidade invisível com inventário `cobblemon:gilded_chest_storage`: UI de baú, funil, NBT preservado; 4 golpes quebram (motor) |
| Vitrine / estante de discos / atril | PARCIAL | **FEITO**; estante sem discos visíveis nem sequenciador (FALTA) | ItemStack real na entidade (vitrine 1 espaço, estante 14); vitrine sem brilho de encantamento no modelo (motor) |
| Waterlogging de blocos custom | NÃO POSSÍVEL | **FEITO** | `minecraft:liquid_detection` (estável, format ≥ 1.21.60) nas 23 classes do Cobblemon + lajes/escadas/cercas (motor) |
| Estruturas como condição (`structures`) | NÃO POSSÍVEL | **PARCIAL** | Estruturas do Cobblemon por marcador em cada peça → registro por chunk; vilas vanilla por heurística (sino/camas). Monumento, iglu, cabana da bruxa e End City: NÃO POSSÍVEL (`getGeneratedStructures` só no beta) (motor) |
| Scanner da Pokédex (zoom/overlay) | PARCIAL | **FEITO** (conferir no cliente) | Zoom por `camera.setFov` 70 → 30 pela roda/hotbar, overlay pelo actionbar `cbS` em JSON UI, modo scanner com agachar + usar (telas) |
| Animações de golpe/cry/faint na entidade; gestos do NPC | PARCIAL | **FEITO** (com limites) | 308 posers Kotlin → dados, 154 timelines de `action_effects`, 660 partículas do Cobblemon, sons de golpe, NPC `command`/`lose`. Limites: partícula no locator de repouso, sem andar até o alvo, status/boost sem efeito (animacao) |
| Música de batalha | NÃO POSSÍVEL | **FEITO** | Era rótulo errado: `playMusic`/`stopMusic` são estáveis; eventos `battle.pv*.default` vazios como no 1.8.2 (faixas: N/A NO COBBLEMON); `/scriptevent cobblemon:battle_music on` (motor) |
| Tela de batalha fiel (tiles, retratos 3D) | NÃO POSSÍVEL | **FEITO** (conferir no cliente) | Forms roteados por marcador com tiles, golpes pintados pelo tipo, alvo, troca com retratos 2D pré-renderizados, mochila em grade; HUD de batalha persistente no canal título (ui-base, retratos, telas) |
| Montaria terra/ar/água (ride_settings) | PARCIAL | **PARCIAL** (melhorou) | Molang de montaria (`q.r.*`), câmera `follow_orbit`/`fixed_boom`, agachar não desmonta no ar (2× desmonta), roll visual por `cobblemon:roll`. Sprint e roll da câmera: NÃO POSSÍVEL (sem botão de sprint na API; câmera só yaw/pitch). Ride boosts, sons de montaria e overlay de controles: FALTA (motor, animacao) |
| Wallpapers do PC | PARCIAL | **PARCIAL** | A tela nova do PC desenha o papel de parede; falta a camada `glow` (telas) |
| Advancements | NÃO POSSÍVEL | **FEITO por adaptação** | Conquistas nativas continuam NÃO POSSÍVEL. 61 conquistas rastreadas por script com os critérios do Kotlin, toast próprio no HUD, chat e tela `/cobblemon:advancements` (lista; árvore por aba: FALTA) (ui-base) |
| Skin de jogador em NPC (`applyplayertexture`) | NÃO POSSÍVEL | **NÃO POSSÍVEL** (confirmado) | Adaptação: skin escolhida por hash do nome num conjunto (Steve, Alex, treinadores do Cobblemon), `model-default`/`model-slim` (ia-npc) |

## Alvos acrescentados pela onda

| Alvo | Antes | Resultado | Como (frente) |
|---|---|---|---|
| HUD do time (party overlay) | actionbar em texto | **FEITO** (conferir no cliente) | Canal título + `ui/cobblemon_hud.json`; seleção do slot e pop-ups (ui-base) |
| Toasts | NÃO POSSÍVEL (sem API) | **FEITO** | Toast próprio no HUD, fila por jogador (ui-base) |
| Retratos 3D nas telas | NÃO POSSÍVEL | **FEITO** | Rasterizador offline no importador: 8.219 PNG por variante com o enquadramento do Cobblemon (retratos) |
| Modelo 3D nas telas (inicial, resumo) | NÃO POSSÍVEL | **FEITO** (enquadramento: conferir) | Estúdio de câmera: entidade fora da vista + câmera `free` atrás de form vazado (telas); na evolução: FALTA |
| Resumo, PC, inicial, Pokédex no visual do Cobblemon | forms simples | **FEITO** (conferir no cliente) | Layouts gerados por `tools/ui/gen-telas.ts`, células fixas por `collection_index` (telas) |
| Glifos de tipo/categoria/bola | página `E0` sobrescrevia a vanilla | **FEITO** | Páginas `E2`/`E3` (ui-base) |
| Enseadas de naufrágio (> 64 blocos) | NÃO POSSÍVEL | **FEITO** | Jigsaw data-driven estável desde 1.21.120; 65 estruturas com `/locate` (motor) |
| Injeção em vilas vanilla | NÃO POSSÍVEL | **NÃO POSSÍVEL** (confirmado) | Vilas usam jigsaw legado. Adaptação: Pokécenter colocado por script em vila recém-gerada (motor) |
| Dano corpo a corpo por Pokémon | NÃO POSSÍVEL | **FEITO** | `beforeEvents.entityHurt` com dano gravável (motor) |
| Altura dos olhos | NÃO POSSÍVEL | **NÃO POSSÍVEL** (confirmado) | Sem componente nem API; hitbox por grupo |
| 8 espécies sem idle, posers de reserva | puladas / 293 por convenção | **FEITO** | 894 espécies; 0 posers de reserva (animacao) |
| Texturas animadas (40) | 1º quadro | **FEITO** | Flipbook por array de texturas indexado por Molang (animacao) |
| ~311 sons nunca tocados | ~80 tocados | **PARCIAL** | 332 de 394 eventos não-espécie (mundo-sons, animacao) |
| StrongBattleAI | 168 de 986 linhas | **FEITO** | Porta inteira + RandomBattleAI (ia-npc) |
| Backlog da auditoria (Alto/Médio) | — | **PARCIAL** | Fome, cama, shiny, Alfa, Gholdengo, Shedinja, envio rápido, tora com mel, gamerules, config… feitos; o resto na §10 de `PARIDADE-MECANICAS.md` (jogabilidade, mundo-sons, ia-npc) |
| E2E por bot de protocolo | — | **FEITO** | 8 cenários, 7/8 passam; a captura (E2E-3) está em correção (e2e) |
