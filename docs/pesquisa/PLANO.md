# Plano: fechar os itens "impossíveis" e as lacunas da auditoria

Base: relatórios em `docs/pesquisa/1..6-*.md`. Frentes paralelas (regras em `docs/pendencias/REGRAS.md`):

| Frente | Porta BDS | Escopo principal | Pesquisa |
|---|---|---|---|
| ui-base | 19141 | Texturas de GUI do Cobblemon, glifos em página própria, roteamento de forms por marcador, HUD por título (time, batalha, toasts), tela e rastreio de conquistas | 1, 3 §6 |
| retratos | 19142 | `tools/importer/portraits.ts` (rasterizador), retratos/perfis por variante, `portraitTexture()` nos scripts | 2 |
| animacao | 19143 | Posers Kotlin→dados, correção do Y, pitch_tilt, Molang de montaria, texturas animadas, partículas e sons do Cobblemon, 8 espécies, efeitos de golpe | 4 |
| motor | 19144 | Waterlogging, contêineres reais, música de batalha, dano por Pokémon, jigsaw data-driven (enseadas), registro de estruturas + vilas, câmera/controles de montaria | 3 |
| jogabilidade | 19145 | Backlog da auditoria em Pokémon/evolução/config/gamerules/fome/cama/shiny/Alfa/Gholdengo/Shedinja/envio rápido/spawns | 5 |
| mundo-sons | 19146 | Os ~311 sons nunca tocados e partículas nos blocos/máquinas/itens/pesca; completude de pasto/panela/redstone/barcos | 5 |
| ia-npc | 19147 | StrongBattleAI completa, completude de NPCs | 5 |
| e2e | 19148 | Bot de protocolo (bedrock-protocol) + cenários ponta a ponta | 6 |
| telas (onda 2) | 19149 | Telas no visual do Cobblemon (batalha, resumo, PC, inicial, Pokédex) com retratos + estúdio de câmera + zoom do scanner | 1, 2 |
