# Evidências de execução

Ambiente de referência de 18 de novembro de 2026. Dados sintéticos. Resultados abaixo obtidos antes do empacotamento.

| Verificação | Resultado medido | Como reproduzir |
| --- | --- | --- |
| Spring · pátio e políticas de acesso | 5 testes aprovados em H2 e repetidos com PostgreSQL 17.12 | `mvn -f doca-norte/server/pom.xml test` |
| Spring · projeção da portaria | 1 teste aprovou leitura fresca, defasada, vencida e ausente | `mvn -f doca-norte/portaria/pom.xml test` |
| .NET · reconciliação | 8 casos aprovados em SQLite e repetidos com PostgreSQL 17.12 | `dotnet test lastro/tests -c Release` |
| Flutter · aplicativo de campo | 3 testes aprovados, análise estática limpa e artefato Flutter Web de distribuição compilado | `flutter test`, `flutter analyze`, `flutter build web` em `doca-norte/field` |
| FastAPI · assistente | 7 testes aprovados, incluindo isolamento de sessão, citação inventada, perda de medida, fila e reenvio | `python -m unittest -v` em `farol/service` |
| Chromium · produtos completos | 7 testes aprovados. Reserva completa, importação/replay, login, revisão, citação e largura de tela | `bash tests/run-local.sh` após compilar os projetos |
| Interface · enquadramento | Três produtos exercitados em 320, 390 e 1280 px. O documento coube na largura antes e após interação. | [Demonstrações](demonstracoes.md) |
| FastAPI → n8n 2.48.5 → Inbox .NET | Entrega confirmada; reenvio manteve exatamente um evento; as duas bordas rejeitaram chamadas sem a credencial | `python tests/n8n_verify.py` |
| Docker Compose | Configuração resolvida para cinco serviços na base e oito no perfil de automação. O host de verificação não forneceu daemon Docker. | `docker compose config --quiet` e `docker compose -f compose.yaml -f compose.automation.yaml --profile automation config --quiet` |
| RAG · modo extrativo | Seção correta em 17 de 18 perguntas respondíveis, recuperação top-3 em 18 de 18 e 4 de 4 recusas corretas | [Resultado por pergunta](../farol/service/data/evaluation.json) |
| RAG · Qwen local em CPU | Dois papéis executados por HTTPX e LangChain no caso WAN. Ensaio com as 22 perguntas disponível por consulta. | [Configuração e resultados](modelo.md) |

## Limites da demonstração

Os testes usaram bibliotecas reais, processos HTTP, persistência e o Chromium. Flutter Web não mede a latência da biometria nem o desempenho de um aparelho físico. O papel OIDC foi exercitado em teste de política de grupo. O login em um tenant corporativo aguarda configuração.

Os adaptadores para SQL Server e Azure Cosmos DB foram compilados. A integração contra instâncias externas, o deploy em AWS, o teste de carga e a operação de produção ficam fora dos resultados locais. Os workflows do GitHub estão incluídos no código. Uma execução hospedada do GitHub Actions precisa de um repositório onde Actions esteja habilitado.

## Repetir os testes ponta a ponta

1. Instale Node 24, Java 21 com Maven, .NET 10 e Python 3.12 com `farol/service/requirements.txt`.
2. Em cada `web/`, execute `npm ci && npm run build`. Execute `mvn -f doca-norte/server/pom.xml package`, `mvn -f doca-norte/portaria/pom.xml package` e `dotnet build lastro/server -c Release`.
3. Em `tests/`, execute `npm ci` e `npx playwright install chromium`. No Linux, se faltarem dependências, use a opção oficial `--with-deps`.
4. Na raiz em Bash, execute `bash tests/run-local.sh`. O script inicia os serviços com dados descartáveis, opera o navegador e encerra apenas os processos que iniciou. Escolha portas alternativas com `PORT_DOCA`, `PORT_LASTRO`, `PORT_FAROL` e `PORT_GATE`.
