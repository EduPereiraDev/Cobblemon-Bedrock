# Frente "extras-final"

Arquivos da frente: `scripts/pokedex/**`, `scripts/GUI/PC.ts`, `scripts/GUI/PCWallpapers.ts` (novo),
`scripts/catching/**`, `tests/extras-final.test.ts`, seção `## extras-final` de `resource_packs/CobblemonBedrock/texts/{en_US,pt_BR}.lang`.
Também editados, por pedido explícito da tarefa: `resource_packs/CobblemonBedrock/ui/pc.json` (papel de parede atrás da grade)
e as texturas novas do port `resource_packs/CobblemonBedrock/textures/ui/cobblemon/pc_slot_clear*.png` (feitas à mão, sem asset do Cobblemon).

Verificação: `npx tsc -p tsconfig.json` sem erros; `npm test` passa (inclui `tests/extras-final.test.ts`).
Sem build, import nem BDS (regras da onda).

## Situação por item

| # | Item | Situação | Notas |
|---|---|---|---|
| 1 | Variações na Pokédex (`variations`/`displayAspects`) | FEITO | `DexEntry` agora traz `variations` e `displayAspects` de `dex_entries` (aglutinadas na nacional como `PokedexEntry.combinedWith`). A entrada ganhou a seção "Variações" (`PokedexVariations.ts` + `variationLines` em `PokedexUI.ts`): gêneros vistos da forma, "★ Shiny visto", formas vistas/capturadas (as regionais incluídas) e, por variação cosmética, `nome (vistos/total): aspectos`. Como no PokemonInfoWidget, conta o que o registro da Pokédex já tem (visto **ou** capturado: o registro do Cobblemon não separa shiny visto de shiny capturado). Rótulos dos aspectos são montados no servidor ("vivillon-wings-high-plains" → "High Plains") porque só metade tem chave `cobblemon.ui.pokedex.info.form.<aspecto>`. `displayAspects` só muda o modelo 3D da entrada: NÃO POSSÍVEL NO BEDROCK (formulário sem modelo). |
| 2 | Papéis de parede do PC | FEITO (lógica, comandos, tela); visual PARCIAL | `PCWallpapers.ts`: 11 básicos do pack + 6 desbloqueáveis de `unlockable_pc_box_wallpapers` (caverna, floresta, oceano, Nether, End por bioma 1×/s; Alfa ao capturar um Alfa), trancados até liberar, "NOVO" até ver, escolha por caixa guardada no jogador (`cobblemon:pcwp:<caixa>`, `cobblemon:pcwp_state`), versão `alt/` (o Shift do Cobblemon vira uma pergunta), aviso (chat + actionbar + som `cobblemon.pc.wallpaper.unlock`). Menu da caixa → "Papel de Parede" com miniaturas. Comandos `/cobblemon:unlockpcboxwallpaper <jogador> <papel> [tocarSom]` e `/cobblemon:changewallpaper <jogador> <caixa> <textura>`. Visual: `ui/pc.json` desenha a textura da caixa (o corpo do formulário leva o caminho) atrás dos 30 espaços, e os botões ficam translúcidos só quando há papel de parede. **Depende do importador copiar as texturas** (pedido abaixo) e **precisa de conferência no jogo** (não deu para rodar o cliente: nomes das variáveis de textura do `light_text_button`). Camada `glow/` e a moldura padrão `pc_screen_overlay`: NÃO FEITO (o JSON UI não deriva o caminho da glow a partir do corpo; o padrão continua "sem papel de parede" para não mudar o PC atual). |
| 3 | Scanner da Pokédex | FEITO (dentro da API) | Sons do Cobblemon (`scan_open`, `scan_loop` a cada 3 ticks, `scan_register_pokemon`/`scan_register_aspect`, `scan_detail`, `scan_close`, `open`/`close`/`click_short` nas telas). Actionbar: nome + o que há de novo (espécie/forma/variação, port de `getNewInformation`) + barra + porcentagem; interrompido avisa. Sem novidade, não espera os 15 ticks: diz "Já registrado"/"Capturado" e abre a entrada. Zoom/overlay 3D continuam NÃO POSSÍVEL NO BEDROCK. |
| 4 | `block_click` e outros callbacks | `block_click`: FORA DA FRENTE (dono: evolução) | No Cobblemon `block_click` é uma **variante de evolução** (`BlockClickEvolution`: clicar com o botão direito num bloco testa as evoluções travadas dos Pokémon do time), não é callback nem som. Nenhuma espécie do 1.8.2 usa. Trecho para a frente de evolução abaixo. Callbacks da área: `pokemon_captured/wallpaper_unlocks` e `player_tick_pre/wallpaper_unlocks` FEITOS aqui; `pokemon_captured/remove_aspects` e `apply_marks` já estavam feitos (`CaptureEffects.ts`, `Marks.ts`); `player_tick_pre/partner_mark` é da frente de marcas. |
| 5 | Advancements | NÃO POSSÍVEL NO BEDROCK; alternativa FEITA | Add-ons do Bedrock não criam conquistas. "Progresso Cobblemon" na lista de Pokédex (`Progress.ts`, `openProgress`): 13 objetivos da aba de captura com o texto original (`advancements.cobblemon.<id>`): craft_pokedex (usar a Pokédex), first_catch, first_shiny_catch, first_alpha_catch, full_party, first_evolution, evolve_shedinja, trade_pokemon, catch_alpha_wailord, collect_all_vivillon (19), collect_all_vivillon_full (23), evolve_gholdengo_netherite, resurrect_pokemon. Contadores de `PlayerAdvancementData` na dynamic property `cobblemon:progress`. Captura e aspectos obtidos já alimentam; evolução, troca e fósseis precisam dos ganchos abaixo. |

## Pedidos para outras frentes

### mundo-final (importador, `tools/importer`)

1. **Texturas dos papéis de parede** (obrigatório para o visual): copiar
   `upstream/cobblemon/common/src/main/resources/assets/cobblemon/textures/gui/pc/wallpaper/**` para
   `generated/resource_packs/CobblemonBedrock/textures/gui/pc/wallpaper/**`, **mantendo as subpastas** (`basic/`, `biome/`,
   `misc/` e dentro delas `alt/` e `glow/`; 17 × 3 = 51 PNG de 174×155). O script usa o caminho
   `textures/gui/pc/wallpaper/<pasta>/<arquivo sem .png>` como miniatura do botão e como imagem do `ui/pc.json`.
2. (Opcional) gerar `generated/scripts/wallpapers.ts` a partir de `data/cobblemon/unlockable_pc_box_wallpapers/*.json`:
   ```ts
   export const UNLOCKABLE_WALLPAPERS: { id: string; texture: string; displayName?: string; enabled: boolean }[] = [
     { id: "cobblemon:biome_cave", texture: "cobblemon:textures/gui/pc/wallpaper/biome/wallpaper_biome_cave.png",
       displayName: "generator.single_biome_caves", enabled: true },
     // ...
   ];
   ```
   e o main.ts chamaria `setUnlockableWallpapers(UNLOCKABLE_WALLPAPERS)` (de `scripts/GUI/PCWallpapers`). Hoje a lista
   do 1.8.2 está embutida em `PCWallpapers.ts` (os `displayName` do Java não existem no Bedrock; se vier do importador,
   mapear para `cobblemon.port.wallpaper.<id sem namespace>`).

### Evolução (`scripts/evolution/**`)

1. Contar evoluções no "Progresso Cobblemon" (AdvancementHandler.onEvolve), depois que a evolução termina, para o dono:
   ```ts
   import { recordEvolution } from "../pokedex/Progress";
   // from = espécie antes, sem namespace ("nincada"); to = Pokémon resultante (e o Shedinja, se houver)
   recordEvolution(player, fromSpeciesId, { species: toSpeciesId(evolved.species), aspects: evolved.aspects });
   ```
2. `block_click` (`BlockClickEvolution`, opcional: nenhuma espécie do 1.8.2 usa):
   ```ts
   // variants/BlockClickEvolution.ts: ContextEvolution<string /* id do bloco */, string /* id ou "#tag" */>
   // requiredContext é um id de bloco ("minecraft:dirt") ou uma tag ("#minecraft:logs"); tags de bloco exigiriam uma
   // tabela gerada pelo importador (hoje só há tags de bioma).
   testContext(pokemon, blockId) { return !this.requiredContext.startsWith("#") && blockId === this.requiredContext; }
   // variants/index.ts: "block_click": BlockClickEvolution.getFromSerializied
   // gatilho (PlatformEvents.RIGHT_CLICK_BLOCK):
   world.afterEvents.playerInteractWithBlock.subscribe(({ player, block }) => {
     for (const pokemon of getSafeTeam(player)) pokemon?.lockedEvolutions
       .filter(e => e instanceof BlockClickEvolution)
       .forEach(e => e.attemptEvolution(pokemon, block.typeId));
   });
   ```

### Troca (`scripts/trade/**`)

Ao concluir a troca, para cada jogador e o Pokémon que ele **recebeu**:
```ts
import { recordTrade } from "../pokedex/Progress";
recordTrade(player, { species: toSpeciesId(received.species), aspects: received.aspects });
```

### Máquinas / fósseis (`scripts/machines/**`)

Ao reviver um fóssil (callback `fossil_revived`), para o jogador que recebe o Pokémon:
```ts
import { recordResurrection } from "../pokedex/Progress";
recordResurrection(player, { species: toSpeciesId(pokemon.species), aspects: pokemon.aspects });
```

### main.ts (opcional)

`bindPCWallpapers()` já é chamado por `bindCatchEvents()` (idempotente). Nada obrigatório.

### Documento de paridade (`docs/PARIDADE-MECANICAS.md`, quem integra)

- "Variações (`variations`/`displayAspects`) na tela da Pokédex": FALTA → FEITO (displayAspects: só modelo 3D, NÃO POSSÍVEL).
- "Scanner da Pokédex": continua PARCIAL; notas: sons e novidade/porcentagem na actionbar feitos; zoom/overlay NÃO POSSÍVEL.
- "Wallpapers do PC, advancements": dividir em "Wallpapers do PC" PARCIAL (tudo feito; visual depende das texturas do
  importador e de conferência no jogo; sem glow) e "Advancements" NÃO POSSÍVEL NO BEDROCK (lista "Progresso Cobblemon" na Pokédex).
- "block_click" (evolução): continua FALTA, dono evolução; nenhuma espécie do 1.8.2 usa.
- Comandos: `changewallpaper` e `unlockpcboxwallpaper` feitos (`/cobblemon:` no Bedrock).
