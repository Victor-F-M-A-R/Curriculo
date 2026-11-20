# Evidências de execução

Revisão de **20 de novembro de 2026**, após reproduzir os problemas de funcionalidade apontados na avaliação externa. A bateria combina testes unitários e de contrato com fluxos em servidores HTTP e bancos reais, usando dados sintéticos e bases exclusivas. A [matriz de QA](qa-cenarios-reais.md) relaciona falhas prováveis, comportamento esperado e testes executáveis. A [verificação de 18/11](verificacao-2026-11-18.md) permanece como registro histórico.

## Resultado da revisão

A revisão `f316b9ab2bb291528b97b329134b737bd4585a24` passou na [verificação dos produtos](https://github.com/Victor-F-M-A-R/Curriculo/actions/runs/44689736563) e no [SQL Server](https://github.com/Victor-F-M-A-R/Curriculo/actions/runs/44689736630). O [Android/iOS](https://github.com/Victor-F-M-A-R/Curriculo/actions/runs/44688960475) passou em `98f5048`; o código, as dependências e o workflow nativos não mudaram entre essas revisões. Nenhum cenário da bateria final foi ignorado ou exigiu repetição automática para passar. O [manifesto de validação](evidence/validation-2026-11-20.json) reúne contagens, revisões, artefatos e limites.

| Camada | Resultado | Escopo e execução |
| --- | --- | --- |
| Doca · configuração H2 e repetição com PostgreSQL | **24/24 em cada execução** | Os 11 testes de pátio/resiliência usam o banco configurado. Os 13 testes de acesso/OIDC mantêm fixtures próprias/H2, inclusive na repetição. Concorrência, replay, rollback, JSON estrito, limite de corpo, sessão e protocolo OIDC por HTTP. |
| Portaria | **6/6** | Contrato, instante de origem, limites de idade, perda de autorização e recuperação. |
| Lastro · SQLite, PostgreSQL e SQL Server | **34/34 em cada banco** | Lotes, centavos, cultura, conflitos, transações, isolamento, paginação, cancelamento e recuperação. |
| Inbox · SQLite e SQL Server | **10/10 em cada banco, mais 8/8 HTTP** | Chave canônica, concorrência, legado, conflitos e persistência. Os oito cenários adicionais atravessam o servidor HTTP real. |
| Farol · serviço | **44/44** | Contrato, evidência, limites HTTP, isolamento, concorrência, persistência e fila. As perguntas internas aos métodos são identificadas separadamente abaixo. |
| Rastro · PostgreSQL e HTTP | **26/26** | Transações, concorrência, ingestão, ordenação, cursores, limites e entradas inválidas. |
| Lastro · contraste dos cinco estados | **1/1** | Teste dos pares de cores do CSS, complementado pelo axe nas interfaces renderizadas. |
| Chromium, Firefox e WebKit | **51/51 em cada motor** | Fluxos dos quatro produtos, falhas de rede, sessão entre abas, teclado, 320 px, valores monetários completos, alvos clicáveis e axe. |
| Flutter | **26/26; análise e build web aprovados** | 14 testes de API e 12 de widgets, incluindo quatro cenários HTTP por sockets reais. |
| Android e iOS | **2/2 em cada plataforma** | Plugins reais sem biometria cadastrada, armazenamento seguro, formulário e notificações de ciclo de vida injetadas. [Modos de teste e execução nativa](evidence/field-native-2026-11-20.json). |
| Compose e integração entre serviços | **Aprovados** | Seis imagens, operações dos quatro produtos e FastAPI → n8n → Inbox. |
| Reinício, queda e recuperação | **Aprovados** | Quatro serviços reiniciados, banco interrompido, workflow indisponível e reenvio sem duplicar o evento. |

Repetir a mesma suíte em outro banco ou navegador não aumenta a quantidade de cenários únicos. Os logs e artefatos identificam o ambiente realmente executado.

No [ensaio de resiliência](evidence/containers-resilience-2026-11-20.json), oito clientes concluíram **320/320 leituras válidas**. Os p95 medidos nessa execução foram 31,94 ms (Doca), 15,93 ms (Lastro), 20,00 ms (Farol) e 15,44 ms (Rastro). A queda controlada do PostgreSQL produziu seis respostas 503, seguida de recuperação; cada requisição tinha timeout de 12 s e asserção de duração inferior a 12,5 s, mas os tempos individuais não ficaram no log. Com n8n indisponível e Farol/Inbox reiniciados, a entrega e a confirmação de unicidade concluíram em **17,04 s**, com um único evento novo após dois reenvios.

## Farol: resultado conhecido e avaliação independente

Oito perguntas da avaliação externa foram reproduzidas antes das correções: **3/8** estavam corretas. O conjunto inicial ampliado passou em **9/24**. Esses casos agora são regressões conhecidas; não representam uma amostra independente após a correção.

| Rodada independente | Primeira execução, preservada | Situação posterior |
| --- | --- | --- |
| Primeira · 41 perguntas | 33/41: 11/17 respostas, 22/24 recusas | 41/41 após revelar as falhas e corrigir o mecanismo |
| Segunda · 30 perguntas | 19/30: 6/17 respostas, 13/13 recusas | 30/30 após a correção |
| Terceira · 30 perguntas | 25/30: 13/18 respostas, 12/12 recusas | 30/30 após a correção |
| Quarta · 20 perguntas | **20/20: 12/12 respostas, 8/8 recusas** | Primeira execução pela API real, após congelar o mecanismo; nenhuma alteração para essas perguntas |

Os resultados e hashes estão no [registro detalhado do Farol](../farol/README.md#regressões-de-2011). A última amostra cobre o acervo fixo de oito manuais fictícios; não mede compreensão universal. Os 125 cenários já revelados e as 38 consultas em acervos sintéticos novos verificam regressões e regras de cobertura. As suítes anteriores também passaram: 18/18 fontes, 4/4 recusas e 12/12 casos de conteúdo. O modelo Qwen não foi executado novamente.

## Interfaces e recuperação

As 36 capturas finais foram inspecionadas: seis estados em 1280 e 320 px, nos três motores. As [12 capturas originais do Chromium](evidence/ui-2026-11-20/README.md) ficam preservadas no repositório; os relatórios completos dos três motores estão no artefato vinculado ao [registro dos navegadores](evidence/browser-validation-2026-11-20.json).

A inspeção anterior encontrou controles de giro cortados no Doca e quebras de centavos no Lastro. O valor máximo aceito no CSV também revelou um resumo financeiro cortado. A correção agora é exercitada por cliques reais, verificação do centro e dos cantos dos alvos e medidas dos retângulos do texto após importar o limite por HTTP. Os 51 cenários passaram em cada motor, e as capturas corrigidas não mostraram esses defeitos.

O axe não detectou violações nos 36 estados. Permaneceram 14 ocorrências inconclusivas por motor, relacionadas aos símbolos de giro e ao contraste sobre a decoração do Lastro. Elas foram revistas separadamente: correspondência entre símbolos e nomes acessíveis, geometria e contraste calculado no Doca; cores e composição da faixa decorativa no Lastro. Os inconclusivos continuam registrados como tal, acompanhados da análise manual, sem serem convertidos em aprovação automática ou certificação de acessibilidade.

Os testes distinguem falha de conexão de perda de autorização. Falhas temporárias conservam informação anterior com indicação de idade quando isso faz parte do produto; perda de identidade oculta os dados protegidos. Nas interfaces, escritas sem confirmação não são repetidas automaticamente. O usuário pode conferir o estado e reenviar com a identidade/idempotência adequada. A fila persistente do Farol faz retentativas automáticas limitadas e idempotentes.

## Limites verificados

O emissor OIDC é uma fixture de protocolo com discovery, JWKS, redirecionamentos e tokens assinados. A configuração com um provedor corporativo, seus grupos e HTTPS precisa ser conferida na implantação.

Os testes móveis utilizam emulador Android e simulador iOS. O cenário de notas usa armazenamento nativo real com autorização biométrica simulada; as notificações de ciclo de vida são injetadas. Reconhecimento biométrico físico, captura pelo seletor de aplicativos, assinatura de distribuição e desempenho em aparelho não foram comprovados.

O runner iOS utiliza Flutter 3.50.0 com um [backport local de uma correção upstream do Flutter](../../.github/patches/flutter/README.md) somente na ferramenta de testes. Uma tentativa anterior perdeu o anúncio do VM Service e terminou por timeout antes de iniciar os cenários. Depois do ajuste, os logs confirmaram a captura iniciada antes do lançamento e os dois testes concluíram. O engine e os testes do aplicativo não foram alterados para contornar a falha.

SQL Server foi executado em LocalDB real no runner Windows. Azure Cosmos DB e deploy AWS não foram exercitados contra recursos de nuvem. A rajada de leituras mede somente a execução registrada, sem estimar capacidade sustentada ou SLA. A avaliação automatizada de acessibilidade e os testes de teclado não equivalem a uma sessão com leitor de tela.

As quatro demonstrações MP4 e os dois currículos destacados foram preservados. As gravações mostram operações reais registradas em 18/11; não são novas gravações desta rodada de QA.

## Reproduzir

Os workflows [produtos](../../.github/workflows/verify.yml), [SQL Server](../../.github/workflows/sql-server.yml) e [Android/iOS](../../.github/workflows/field-native.yml) registram os comandos e versões. Use bancos descartáveis e exclusivos. Os READMEs de cada projeto descrevem a execução com SDKs e Docker.

Para o caminho nativo dos navegadores, em `portfolio/tests`, execute `npm ci --ignore-scripts` e `npx playwright install --with-deps chromium firefox webkit`. Configure PostgreSQL como descrito no [Rastro](../rastro/README.md) e execute `bash tests/run-local.sh` em `portfolio`, uma vez por `PW_BROWSER=chromium`, `firefox` e `webkit`, usando uma base exclusiva em cada execução. As interfaces e serviços devem ser compilados antes; o workflow contém a sequência completa. O CI usa a imagem oficial Playwright 1.58.2 Noble fixada por digest, com os navegadores e bibliotecas já instalados, e mantém as aplicações e bases sintéticas no runner.

O ensaio de interrupção controlada opera apenas no projeto Compose descartável cujo nome segue `portfolio-ci-<run>-<attempt>`, confirma os rótulos de propriedade e restabelece os serviços ao terminar. A limpeza dos volumes pertence ao workflow do runner. Não deve ser apontado para dados pessoais ou uma implantação compartilhada.
