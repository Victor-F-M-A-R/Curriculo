# Evidências de validação

Execução local em 24/11/2026, Windows, Node 24.17.0, Python 3.12.13, polyfill 0.2.0 e Playwright 1.58.2 com Chromium disponível no host. Código-base: `c3cb7b52f4d2659d3b39b99e17d4b84d3949b4eb`; alterações na branch `feat/farol-webmcp`.

| Verificação | Resultado local |
| --- | --- |
| TypeScript estrito + build Vite | Passou |
| Testes Python do serviço | 44/44 |
| Testes WebMCP com FastAPI e polyfill reais | 10/10 na primeira rodada |
| Rodada final de navegador: WebMCP + resiliência existente | 16/16 (10 novos + 6 regressões existentes) |
| Interface desktop 1280 px / celular 390 px | Capturas inspecionadas, sem overflow horizontal; foco verificado |
| Auditoria npm web / testes | Zero vulnerabilidades conhecidas reportadas na instalação |

Os testes novos exercitam o fluxo real de registro, descoberta e execução, serialização do metadata, referência `source`, nulabilidade, revogação de Tool, aprovação/recusa, fontes, isolamento entre perfis, validação, falha de rede, cancelamento e concorrência. Não usam um polyfill simulado. A aprovação é acionada automaticamente nos testes apenas para cobrir ambos os caminhos do diálogo.

A primeira execução Python revelou que um teste antigo deixava uma conexão SQLite aberta, impedindo o Windows de remover o banco temporário. O teste agora usa `contextlib.closing`; não houve alteração da busca, das respostas ou da persistência de produção. A suíte completa passou após a correção. O aviso de depreciação de HTTPX no TestClient permanece; não impediu os testes.

Os resultados são testes de desenvolvimento e regressão conhecidos, não uma avaliação independente de qualidade de IA. Chrome 160 nativo, integrações com agentes comerciais e entrega n8n não foram validados nesta atualização. Nenhum resultado anterior de avaliação de respostas foi reescrito.

[Resultado por cenário, sem caminhos privados](webmcp-results.json) · [Captura desktop](webmcp-1280.png) · [Captura celular](webmcp-390.png)
