# Regras para as frentes paralelas

Várias frentes trabalham ao mesmo tempo na mesma árvore, sem commits. Para não colidir:

1. **Só edite os arquivos da sua frente.** Precisa de algo em arquivo de outra frente? Escreva o pedido
   em `docs/pendencias/<sua-frente>.md` (o que, onde, por quê, assinatura exata) e siga com um stub local.
2. **Servidor Bedrock próprio (obrigatório antes de terminar):** cada frente usa o seu, nunca o padrão:
   `COBBLEMON_DIST=dist-<frente> npm run build` e
   `COBBLEMON_DIST=dist-<frente> COBBLEMON_BDS=<frente> COBBLEMON_BDS_PORT=<porta> node tools/server.mjs deploy|logs|cmd`.
   Critério: `logs` sem nenhum ERROR/WARN de conteúdo ou script da sua frente. Ao terminar: `docker rm -f cobblemon-bds-<frente>`.
   Não use `npm run build` sem `COBBLEMON_DIST`, nem o container `cobblemon-bds` (é do orquestrador).
3. `npm run import` pode ser rodado por qualquer frente: ele escreve numa pasta temporária e troca
   `generated/` de forma atômica. Se o seu build pegar um `generated/` sem a sua mudança, rode o import de novo.
4. Verificação da sua frente: `npx tsc -p tsconfig.json` sem erros **nos seus arquivos** (erros em
   arquivos de outras frentes podem ser transitórios; anote-os) e `npm test` com os seus testes em
   `tests/<frente>.test.ts` (a API do Minecraft é mockada em `tests/mocks/`; estenda o mock se precisar,
   só adicionando exports).
5. Só APIs estáveis: `@minecraft/server` 2.10.0 e `@minecraft/server-ui` 2.2.0. Nada de beta.
6. Trabalho síncrono pesado por tick é proibido (watchdog do Bedrock: ~100 ms por tick).
7. Comentários em português, identificadores em inglês, indentação igual ao arquivo.
8. Não faça commit.

9. Não edite `docs/PARIDADE-*.md`: registre o status de cada item em `docs/pendencias/<frente>.md`
   (FEITO / NÃO POSSÍVEL + prova / N/A). O orquestrador consolida.
10. Textos novos: acrescente só no fim dos `.lang` numa seção `## <frente>` (en_US e pt_BR).
