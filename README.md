# Cobblemon Bedrock

> **Unofficial** fan port of the Java mod [Cobblemon](https://cobblemon.com) to **Minecraft Bedrock Edition** (add-on),
> so console (Xbox, PlayStation, Switch), mobile and Windows players can play it. Free, non-commercial, no monetization.
> Not affiliated with or endorsed by the Cobblemon team, Mojang, Nintendo or The Pokémon Company.
>
> Port **não oficial** do mod Java Cobblemon para o **Minecraft Bedrock**, para jogar com amigos no console, celular e
> PC. Gratuito, sem fins comerciais e sem monetização.

**Status:** stable (v1.0). Everything from Cobblemon 1.8 was ported, passes automated tests (unit, content validation
and end-to-end tests with protocol bots on a dedicated server) and was play-tested on a real Windows client through eight
betas. Please report any issue in [Issues](../../issues).

**Status:** estável (v1.0). Tudo do Cobblemon 1.8 foi portado, passa nos testes automáticos e foi testado com o jogo
aberto (Windows) ao longo de oito betas. Reporte qualquer problema em [Issues](../../issues).

## O que tem / What's included

- 894 Pokémon jogáveis (modelos, animações, texturas, shiny, formas e variantes, sons e retratos)
- Batalhas com o motor do Pokémon Showdown (selvagens, treinadores NPC, PvP, duplas/triplas, Multi 2×2, nível fixo),
  captura, PC, Pokédex, evolução, troca, pasto, criação de berries/apricorns, medicina, pesca, montaria
- Itens, blocos, máquinas, receitas e loot do Cobblemon; 85 estruturas (ruínas, altares, torres do Gimmighoul,
  habitats, Pokécenters)
- Só APIs **estáveis** do Bedrock: **não precisa ligar nenhum experimento** e funciona em Realms e consoles

Detalhes da paridade em [docs/PARIDADE-MECANICAS.md](docs/PARIDADE-MECANICAS.md).

## Como instalar / How to install

Baixe o `Cobblemon.mcaddon` da última versão em [Releases](../../releases). Requer Minecraft Bedrock **26.x**
(atualizado).

| Onde | Como |
|---|---|
| **Windows / Android / iPhone** | Abra o `Cobblemon.mcaddon` (no celular: "abrir com Minecraft"). Crie um mundo e, em *Pacotes de comportamento* e *Pacotes de recursos*, ative **Cobblemon Bedrock**. |
| **Consoles (Xbox, PlayStation, Switch)** | Console não instala arquivos de fora. Entre num mundo que já tenha o mod: o pacote baixa sozinho. Opções: (1) um amigo no PC/celular abre o mundo para vocês; (2) **Realm**: crie o mundo com o mod no PC/celular e envie para o Realm; (3) servidor dedicado (Xbox adiciona servidor; PlayStation/Switch precisam de apps como BedrockTogether). |
| **Servidor dedicado (BDS)** | Copie as pastas do `.mcaddon` (é um zip com dois `.mcpack`) para `behavior_packs/` e `resource_packs/` do servidor e liste-as em `world_behavior_packs.json` / `world_resource_packs.json`. Use `texturepack-required=true`. |

Quem entra num mundo com o mod baixa o pacote (~113 MB) na primeira vez.

## Desenvolvimento / Building from source

Requisitos: Node 22+, npm, Docker (opcional, servidor de teste) e o código-fonte do Cobblemon em `upstream/cobblemon`:

```bash
git clone --depth 1 https://gitlab.com/cable-mc/cobblemon.git upstream/cobblemon
npm install
npm run import        # converte assets e dados do Cobblemon para generated/
npm run build:release # gera dist/Cobblemon.mcaddon
```

| Comando | O que faz |
|---|---|
| `npm run import` | converte assets e dados do Cobblemon para `generated/` (não versionado) |
| `npm run validate` | valida referências cruzadas do conteúdo gerado |
| `npm run check` | type-check dos scripts |
| `npm test` | testes em Node |
| `npm run build` | monta os packs em `dist/` |
| `npm run build:release` | gera `dist/Cobblemon.mcaddon`, o pacote **público** |
| `npm run test:e2e` | testes ponta a ponta com bots num servidor Bedrock em Docker |
| `node tools/server.mjs deploy\|logs\|cmd` | servidor Bedrock local (Docker) com os packs |

Arquitetura e decisões: [docs/ARQUITETURA.md](docs/ARQUITETURA.md). Como jogar: [docs/COMO-JOGAR.md](docs/COMO-JOGAR.md).
Comandos do jogo: [docs/COMANDOS.md](docs/COMANDOS.md).

Extensões de terceiros com licença só para uso privado (ex.: Mega Showdown) não fazem parte deste repositório nem do
pacote público; o build público falha se encontrar qualquer resto delas.

## Licença e créditos / License and credits

- **Código** deste repositório: [Mozilla Public License 2.0](LICENSE.txt), a mesma do Cobblemon e do port em que este
  projeto se baseou ([Incoherent-Code/Cobblemon-Bedrock](https://github.com/Incoherent-Code/Cobblemon-Bedrock)).
- **Assets** (modelos, texturas, animações, sons, textos): do **time do Cobblemon e seus criadores**, usados conforme a
  [Fair Use Policy do Cobblemon](https://cobblemon.com/en/fairuse): uso não comercial, com atribuição e sem sugerir
  afiliação. A publicação deste port foi autorizada pela equipe do Cobblemon, desde que siga essa política. Nada deste
  projeto pode ser vendido, monetizado ou usado no Marketplace.
- Veja [NOTICE.md](NOTICE.md) para a lista completa de créditos e marcas.

Pokémon is a trademark of Nintendo, Creatures Inc. and GAME FREAK inc. Minecraft is a trademark of Mojang Synergies AB.
This project is not affiliated with any of them.
