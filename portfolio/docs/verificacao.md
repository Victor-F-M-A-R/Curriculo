# Evidências de execução

Revisão de **18 de novembro de 2026**, com dados sintéticos e bases dedicadas. A execução local usou serviços Java 21, .NET 10 e Python 3.12 em contêineres Linux, PostgreSQL real e navegador Chromium, com recursos limitados e um trabalhador de navegador. A seção de validação remota identifica separadamente o commit e as execuções do GitHub Actions.

## Resultados locais desta revisão

| Verificação | Resultado medido | Reprodução e escopo |
| --- | --- | --- |
| Spring · pátio e políticas de acesso | **7 testes aprovados em H2 e 7 em PostgreSQL** | `mvn -f doca-norte/server/pom.xml test`. Disputa de reserva, repetição, versão obrigatória, CSRF e papéis de leitura/escrita com identidades OIDC de teste. |
| Spring · projeção da portaria | **1 teste aprovado** | `mvn -f doca-norte/portaria/pom.xml test`. Leituras atual, defasada, vencida e ausente. |
| .NET · conciliação | **10 testes aprovados em SQLite e 10 em PostgreSQL** | `dotnet test lastro/tests -c Release`. Replay, rollback de lote, valores em centavos, isolamento por mesa, paginação com empate de horário e limite de bytes UTF-8. |
| Lastro · contraste dos estados | **1 teste aprovado, cobrindo os cinco estados com contraste mínimo de 4,5:1** | `npm test` em `lastro/web`. Mede os pares de cores do CSS; não equivale a uma avaliação completa de acessibilidade. |
| FastAPI · Farol | **14 testes aprovados** | `python -m unittest -v` em `farol/service`. Evidência literal e completa, recusas, isolamento de sessão, expiração, revisão concorrente e reenvio da fila. |
| PostgreSQL · Rastro | **13 testes aprovados** | `python -m unittest discover -s tests -v` em `rastro`. Banco real, HTTP real, concorrência entre conexões, eventos fora de ordem, replay, conflito, rollback, autenticação e recuperação após bloqueio. |
| Chromium · quatro produtos | **14 testes aprovados, sem cenários ignorados** | `bash tests/run-local.sh` com PostgreSQL configurado. Reserva, atualização após conflito, resposta de leitura atrasada, importação e replay, confirmação perdida, login, auditoria Blazor, citação, revisão, telemetria e recuperação de erro. |
| RAG · recuperação no modo extrativo | **18/18 fontes corretas, 18/18 acertos top-3 e 4/4 recusas corretas** | `python evaluate.py --output data/evaluation.json` em `farol/service`. [Resultado por pergunta](../farol/service/data/evaluation.json). |
| RAG · conteúdo no modo extrativo | **12/12 casos aprovados: 8 respostas completas e fundamentadas, 4 recusas corretas** | `python evaluate.py --suite content --output data/content-evaluation.json`. [Resultado por pergunta](../farol/service/data/content-evaluation.json). |
| Demonstrações em MP4 | **4 arquivos de 27 s, 1440 × 810, H.264/yuv420p**, com legendas em português; Lastro também em inglês | Captura de operações nas aplicações em execução, seguida de composição e conferência dos fluxos com FFprobe. [Vídeos e reprodução das capturas](demonstracoes.md). |

As repetições em dois bancos verificam os mesmos casos em cada mecanismo; não representam testes únicos adicionais. O [resumo estruturado](evidence/validation-2026-11-18.json) registra as contagens e os hashes SHA-256 dos quatro filmes, sem credenciais ou caminhos particulares do ambiente.

## Interface, teclado e enquadramento

A suíte usa **1280 × 840** como tamanho padrão e exercita os quatro aplicativos também em **390 px**. Doca e Rastro têm cenários adicionais em **320 px**. Os cenários correspondentes conferem que o documento cabe na largura disponível. Lastro verifica a seleção no celular, o retorno do foco ao repasse e a auditoria filtrada; Rastro verifica seleção por Tab/Enter e recuperação depois de falha na consulta.

A apresentação dos projetos foi inspecionada no navegador em desktop e 320 px. Os links dos dois currículos, a seleção do projeto pelo teclado e a transcrição expansível foram conferidos. Essa amostra não cobre todas as combinações de navegador, dispositivo ou tecnologia assistiva.

## Validação remota do código

Os resultados abaixo foram confirmados no commit [`68390a6079c67f27cb42f8c38f62f049801d4db9`](https://github.com/Victor-F-M-A-R/Curriculo/commit/68390a6079c67f27cb42f8c38f62f049801d4db9), na branch `portfolio-dados-e-curriculo`.

| Verificação | Resultado medido | Execução |
| --- | --- | --- |
| Flutter 3.50.0 · aplicativo de campo | **Análise sem problemas, 4 testes aprovados e build web concluído** | [Job do aplicativo de campo](https://github.com/Victor-F-M-A-R/Curriculo/actions/runs/44409690456/job/135174196327). Executado remotamente; não houve nova execução local de Flutter. |
| Lastro · SQL Server 15.0.4382.1 | **10 testes aprovados** contra SQL Server Express LocalDB real | [Job de persistência](https://github.com/Victor-F-M-A-R/Curriculo/actions/runs/44409690985/job/135174195055). Transações, rollback, replay, valores e auditoria exercitados no provedor SQL Server. |
| Imagens finais e Docker Compose | **6 imagens compiladas e operações dos quatro produtos confirmadas** | [Job de contêineres](https://github.com/Victor-F-M-A-R/Curriculo/actions/runs/44409690456/job/135174196928). Imagens Doca, Portaria, Lastro, Farol, Rastro e Inbox; conjunto Compose iniciado com PostgreSQL e perfil de automação. |
| FastAPI → n8n → Inbox .NET | **Entrega real confirmada, 1 evento persistido após dois reenvios, autenticação e isolamento aprovados** | Mesmo [job de contêineres](https://github.com/Victor-F-M-A-R/Curriculo/actions/runs/44409690456/job/135174196928), via `python tests/compose_verify.py`. Workflow e Inbox rejeitaram credenciais ausentes ou inválidas; outra sessão não acessou a consulta. |

## Evidências históricas e verificações restantes

| Item | Situação nesta revisão |
| --- | --- |
| Qwen local e adaptadores HTTPX/LangChain | **Ensaio histórico preservado, sem nova execução do modelo.** [Configuração, respostas e limitações](modelo.md). As métricas atuais acima pertencem exclusivamente ao modo extrativo. |
| Job remoto de integração geral | O resultado completo, incluindo os cenários no navegador do runner, ainda aguarda confirmação. Os 14 cenários locais já estão confirmados na tabela inicial. |
| Plano de consulta Rastro | A [captura em PostgreSQL 16.2](../rastro/evidence/explain-pg16.txt) é anterior a esta revisão e usa 60.000 eventos sintéticos. Os tempos não foram medidos novamente nesta sessão. |

[Consultar as execuções do GitHub Actions](https://github.com/Victor-F-M-A-R/Curriculo/actions/workflows/verify.yml). Uma configuração de workflow ou uma execução anterior aprovada não substitui o resultado do commit publicado.

## Limites da demonstração

Os testes utilizam bibliotecas reais, processos HTTP, persistência e navegador. OIDC foi exercitado com identidades de teste, sem a troca completa com um provedor corporativo. Flutter Web não demonstra biometria nem desempenho em um aparelho físico.

SQL Server foi verificado no ambiente remoto descrito acima. O adaptador Azure Cosmos DB foi compilado, mas sua integração com uma instância real não foi executada. Deploy AWS, carga sustentada, recuperação de backup e operação em produção também não foram verificados nesta sessão. Os dados de todos os projetos são fictícios; os resultados do Farol se restringem ao acervo e às perguntas publicados.

## Repetir os testes ponta a ponta

1. Disponibilize Node 24, Java 21 com Maven, .NET 10, Python 3.12 e uma base PostgreSQL **descartável e exclusiva dos testes**. Instale as dependências de `farol/service/requirements.txt` e `rastro/requirements.txt` em um ambiente Python isolado.
2. Em `doca-norte/web`, `lastro/web` e `farol/web`, execute `npm ci` e `npm run build`. Compile `mvn -f doca-norte/server/pom.xml package`, `mvn -f doca-norte/portaria/pom.xml package` e `dotnet build lastro/server -c Release`, a partir de `portfolio/`.
3. Em `portfolio/tests/`, execute `npm ci` e `npx playwright install chromium`. No Linux, se faltarem dependências, use a opção oficial `--with-deps`.
4. Configure `RASTRO_DATABASE_URL` e a autenticação para a base dedicada, conforme o [README do Rastro](../rastro/README.md). Execute `bash tests/run-local.sh` a partir de `portfolio/`. O script exige PostgreSQL e inicia o Rastro para evitar que seus cenários sejam ignorados.
5. O script encerra apenas os processos que iniciou. As portas podem ser alteradas com `PORT_DOCA`, `PORT_LASTRO`, `PORT_FAROL`, `PORT_GATE` e `PORT_RASTRO`. Para repetir Doca e Lastro em PostgreSQL, use também as variáveis de teste descritas nos READMEs de cada projeto.
