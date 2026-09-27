# Pendências da frente "retratos" (retratos e perfis pré-renderizados)

Pesquisa: [`docs/pesquisa/2-retratos.md`](../pesquisa/2-retratos.md). Folha de revisão:
[`docs/pesquisa/retratos-amostra.png`](../pesquisa/retratos-amostra.png) (40 pares retrato + perfil).

Arquivos da frente:

- `tools/importer/portraits.ts`: plano por espécie, workers, dedupe, módulo gerado e `credits.txt`.
- `tools/importer/portraits/`:
  - `render.ts`: rasterizador;
  - `molang.ts`: avaliador de Molang para t = 0;
  - `posers.ts`: enquadramento e pose de UI;
  - `job.ts` e `worker.ts`: renderização e cache;
  - `cli.ts`, `sheet.ts`, `amostra.ts` e `verify.ts`: ferramentas de inspeção.
- Wiring em `tools/importer/index.ts`: 3 linhas marcadas "Frente retratos".
- `generated/scripts/portraits.ts`.
- `getPokemonSpriteTexture` e `getPokemonProfileTexture` em `scripts/GUI/common.ts`.
- `tests/retratos.test.ts`.

## Status

| Item | Status | Prova |
|---|---|---|
| Rasterizador no importador (retrato = rosto do `drawPosablePortrait`, perfil = corpo do `drawProfilePokemon`) | FEITO | `npm run import` gera 8.219 PNGs, 0 falhas, 0 retratos com cobertura < 15% |
| Tamanhos: retrato 64 + ícone 32 + perfil 128 | FEITO | ver "Tamanhos medidos" |
| Um PNG por imagem distinta (dedupe pelo hash do PNG, por espécie) | FEITO | 7.909 variants → 2.826 retratos / 2.567 perfis |
| Cache por hash das entradas | FEITO | import com cache: 192 re-renderizados + 5.651 do cache |
| Workers paralelos | FEITO | até 8 `worker_threads`, em paralelo com o resto do import |
| Shiny/forma/gênero/camadas conferidos numa amostra ampla | FEITO | ver "Verificação do shiny" |
| Posers só em Kotlin | FEITO | ver "Posers só em Kotlin" |
| `generated/scripts/portraits.ts` | FEITO | 38,8 KB; tabela compacta em base 62 |
| `getPokemonSpriteTexture` com variante | FEITO | ver "Scripts" |
| Atribuição CC BY-NC 3.0 | FEITO | `credits.txt` na raiz do RP gerado (sai em `dist*/resource_packs/CobblemonBedrock/credits.txt`) |
| Folha de contato | FEITO | `docs/pesquisa/retratos-amostra.png` |
| Comparação pixel a pixel com o Cobblemon Java rodando | NÃO FEITO | não há cliente Java aqui; a iluminação segue lightmap = 1 (o Java usa `LightTexture.pack(11, 7)`) |

### Tamanhos medidos (import completo, 894 espécies)

| Conjunto | Arquivos | Total | Média |
|---|---|---|---|
| `textures/cobblemon/portraits/<espécie>_<n>.png` (64 px) | 2.826 | 11,2 MB | 4,2 KB |
| `textures/cobblemon/portrait_icons/<espécie>_<n>.png` (32 px) | 2.826 | 5,7 MB | 2,1 KB |
| `textures/cobblemon/profiles/<espécie>_<n>.png` (128 px) | 2.567 | 15,6 MB | 6,4 KB |
| **Total** | **8.219** | **32,5 MB** | |

**Decisão:** o perfil 128 cabe no orçamento. O RP gerado já tem ~208 MB e ~25 mil arquivos, então os perfis
somam ~8%. Para isso:

- o perfil cobre só o recorte "base + shiny + formas", sem fêmea e sem cosmético. Variantes fora do recorte usam o
  perfil mais parecido, com o mesmo placar do `resolveVariant`;
- há um teto por espécie: 80 retratos e 64 perfis. O Spinda tem 1.534 combinações de manchas e o Gholdengo, 144.
  Ficam as imagens com menos aspects, e o resto usa a mais parecida. Sem o teto, seriam 4.510 renders.

### Tempos

| Execução | Tempo |
|---|---|
| `npm run import` com cache quente (normal) | 28,8 s de parede, igual ao import sem retratos; os workers terminam junto com as outras fases |
| `npm run import` com cache frio (`COBBLEMON_PORTRAIT_CACHE` vazio) | 75,6 s de parede; retratos em 52,7 s dentro do import, 5.843 renders |
| Só os retratos, cache frio (`portraits/cli.ts --all`) | 48,5 s |
| Só os retratos, cache quente | 4 s |

Cache: `node_modules/.cache/cobblemon-portraits/`, que o git ignora e pode ser apagado sem risco. A chave é
`sha1(versão do renderizador + geo + texturas + flags de camada + animações da pose + enquadramento +
transformedParts + aspects relevantes + modo + supersampling)`.

### Verificação do shiny

`node --experimental-strip-types --no-warnings tools/importer/portraits/verify.ts`

- **7.909 variants:** todos apontam para PNGs existentes (retrato, ícone e perfil). 0 problemas.
- **3.769 pares shiny × normal com textura diferente:** todos têm retrato ou perfil diferente, exceto 4 espécies.
  Nelas a diferença da textura fica escondida, conferido pixel a pixel na textura e na folha:
  - `komala`: o tronco é camada;
  - `electrode` melancia: a camada cobre tudo;
  - `gimmighoul` baú: a diferença fica dentro do baú;
  - `tinkatuff_dot`: a região alterada não é usada pelo modelo.
- **Gyarados shiny azul (relato da pesquisa): não reproduz.** Os variants 8 a 15 (shiny) renderizam vermelhos no
  retrato e no perfil, e o teste `tests/retratos.test.ts` §3 garante isso.
  - O bug real encontrado na produtização foi outro: o recorte do perfil tratava combinações com 4 ou mais aspects
    como "core" e mandava a Gyarados fêmea para o perfil shiny. Corrigido: combinação não resolvida fica fora do
    recorte.
- **Amostra visual de 40 espécies/variantes** (`amostra.ts`):
  - formas regionais: Alola, Galar, Hisui, Paldea;
  - camadas emissivas: Charizard, Magmar, Rapidash, Umbreon, Chandelure, Lanturn, Ceruledge, Armarouge;
  - camadas translúcidas: Gengar, Misdreavus, Mismagius, Starmie;
  - posers só em Kotlin: Aggron, Ampharos, Turtwig, Donphan;
  - outros: Unown, Vivillon, Alcremie, Spinda e Gholdengo.
- Correções de fidelidade feitas em relação ao protótipo:
  - camadas ordenadas por `translucent`, como o `PosableModel.setLayerContext`;
  - camada sem `translucent` em modo cutout, e não em mistura;
  - emissiva sem luz;
  - pose PROFILE separada da PORTRAIT;
  - aspects da combinação passados para `q.has_aspect`;
  - comentários removidos antes das regex de Kotlin. O protótipo lia `portraitTranslation` comentado, por exemplo no
    Ninetales.

### Posers só em Kotlin

- `portraits/posers.ts` prefere os JSON convertidos pela frente animacao
  (`tools/importer/data/kotlin-posers/<poser>.json`) para poses, animações e transformedParts.
- Esses JSON ainda não trazem `portraitTranslation`/`profileTranslation`, então esses campos vêm da leitura por
  regex do `.kt`. Sem JSON, a regex cobre tudo: pose, `bedrock(...)` e `transformedParts` com
  `withVisibility`/`addPosition`/`addRotation*`.
- Resultado: 6.019 combos com poser JSON e 1.890 com poser Kotlin (todos via JSON da frente animacao + translação do .kt); nenhum usa o enquadramento padrão.

### Scripts

```ts
import { hasPortrait, portraitTexture, portraitIconTexture, profileTexture } from "../generated/scripts/portraits";
portraitTexture("gyarados", pokemon.variant)     // "textures/cobblemon/portraits/gyarados_4"
profileTexture(speciesId, variant)               // corpo inteiro 128 px
portraitIconTexture(speciesId, variant)          // rosto 32 px
```

`scripts/GUI/common.ts`:

- `getPokemonSpriteTexture(species: string | PokemonData, variant?: number)`. A assinatura antiga,
  `getPokemonSpriteTexture(species)`, continua valendo e usa o variant 0.
- Passando o PokemonData, a função usa `species` e `variant` dele.
- Espécie sem retrato cai no `textures/sprites/<nome>` antigo.
- Novo: `getPokemonProfileTexture(...)`, com a mesma regra, para o corpo inteiro.

## Pedidos

### 1. Chamadores de `getPokemonSpriteTexture`: passar o Pokémon (shiny/forma no ícone)

Hoje todos passam `x.species` e recebem o retrato da forma base. Trocar por `getPokemonSpriteTexture(pokemon)`, o
PokemonData inteiro. O efeito é o retrato da variante certa: shiny, forma regional, gênero e cosméticos.

| Arquivo (frente) | Linhas | Troca |
|---|---|---|
| `scripts/GUI/Party.ts` (interface) | 52, 83 | `getPokemonSpriteTexture(pokemon.species)` → `getPokemonSpriteTexture(pokemon)` |
| `scripts/GUI/Party.ts` (interface) | 164 | `result.species` → `result` (se for PokemonData) |
| `scripts/GUI/PC.ts` (interface) | 108, 236, 263, 281 | `pokemon.species` → `pokemon` |
| `scripts/GUI/index.ts` (interface) | 41, 73 | `x.species` → `x` |
| `scripts/items/usage.ts` (itens) | 250 | `pokemon.species` → `pokemon` |
| `scripts/machines/pasture.ts` (mundo-maquinas) | 268 | `p.species` → `p` |
| `scripts/machines/pasture.ts` (mundo-maquinas) | 222 | o tether só tem `species`: gravar também `variant` no registro e passar `getPokemonSpriteTexture(t.species, t.variant)` |

`StarterGUI.ts` (51, 58) pode ficar como está, porque o inicial é a forma base.

Telas no visual do Cobblemon (frente telas): usar `getPokemonProfileTexture(pokemon)` no Summary, no inicial e no
painel da Pokédex, e `portraitTexture` no tile de batalha e no HUD da party.

### 2. Frente animacao: gravar o enquadramento nos posers Kotlin convertidos

Em `tools/importer/kotlinPosers.ts`, `convertKotlinPoser` grava só `portraitScale`/`profileScale`, e só com sufixo
`F`. Pedido: gravar também `portraitTranslation` e `profileTranslation` como `[x, y, z]`, lidos de
`Vec3(...)`/`Vec3d(...)`. Hoje eles vêm da regex da frente retratos. Com isso, `portraits/posers.ts` passa a usar só o
JSON.

### 3. Orquestrador: `npm run validate` quebrado pela pasta temporária do import

`tools/importer/util.ts` passou a exportar `OUT_RP = generated.tmp-<pid>`, e o `validate.ts` usa esse `OUT_RP`. Por
isso ele sempre acusa "generated/ não existe". Contorno usado aqui: um lançador que cria o link
`generated.tmp-<pid> → generated` antes de importar o `validate.ts`.

Correção sugerida: o `validate.ts` usar `OUT_FINAL` (ou `join(OUT_FINAL, "resource_packs", PACK)` etc.).

Os 83 erros restantes da validação são de outras frentes:

- blocos: `cobblemon:pressed`/`block_face`, bloco duplicado `undefined`;
- render controllers: `ponyta`/`rapidash`/`slugma`/`toxel`/`toxtricity` com `Array.tex` maior que os combos.

Nenhum erro é de retratos.

### 4. Docs (orquestrador)

- `docs/pesquisa/ALVOS.md`: a linha "Tela de batalha fiel (tiles, retratos 3D)" pode virar "PARCIAL: retratos 2D
  pré-renderizados com o enquadramento do Cobblemon (frente retratos); falta a tela".
- `resource_packs/CobblemonBedrock/textures/sprites/`, com 1.025 PNGs e 9,3 MB, agora só serve de reserva do
  `getPokemonSpriteTexture`. Pode sair quando os chamadores estiverem migrados.

## Verificação feita (2026-09-26)

- **`npm run import`:** OK. 28,8 s com cache quente, 75,6 s com cache frio. Retratos: 0 falhas, 0 com cobertura
  baixa.
- **`npm run validate`** (com o contorno do pedido 3): 0 erros de retratos. Os 83 erros são de outras frentes.
- **`npx tsc -p tsconfig.json`:** 0 erros no projeto inteiro. Os arquivos de `tools/importer/portraits*` também
  passam no `tsc --strict` avulso.
- **`npm test`:** `retratos: ok`. Na hora da execução, `interface`, `batalhas`, `mundo-final` e `social` falhavam por
  asserções das próprias frentes: contagem de caixas 40 ≠ 30, batalha `stopped`, partículas `poodle_hair_*`, skin
  de NPC. Nenhuma passa por `getPokemonSpriteTexture`.
- **BDS próprio** (`retratos`, porta 19142, `dist-retratos`):
  - `Server started`;
  - `[Scripting] Cobblemon Bedrock: scripts carregados em 484 ms`;
  - nenhum ERROR/WARN de retratos, `credits.txt` ou `scripts/GUI/common.ts`.

  Os erros do log são de outras frentes: `[Structure]` com `spread_type: 'triangle'` em `structure_sets`, e
  `[Actor]` com `npc_render_scale` e `cobblemon:roll` fora do tipo. Container removido no fim.
