# Decisões e revisão de engenharia

Esta revisão registra problemas concretos, decisões e formas de reproduzir a verificação. As [evidências de execução](verificacao.md) distinguem os resultados medidos em 18 de novembro de 2026 dos ensaios históricos e das integrações ainda pendentes.

## Doca Norte · Duas pessoas escolhem a mesma doca

**Problema.** Ler o estado no navegador e enviar uma atualização sem versão permite que o segundo operador tome uma decisão sobre uma leitura vencida. Uma consulta já em andamento também pode chegar depois de uma reserva e substituir a confirmação por um estado antigo.

**Decisão.** A API exige a versão vista pelo operador, adquire uma trava na linha, verifica a transição e persiste o evento na mesma transação. A chave de idempotência identifica o comando na doca; uma repetição idêntica devolve o estado atual. No navegador, a confirmação de um comando invalida leituras anteriores em andamento. Após conflito ou falha, a tela conserva a última hora confirmada e bloqueia movimentos até obter uma leitura válida.

**Verificação.** `YardTest.concurrentBookingsHaveExactlyOneWinner` libera dois comandos simultâneos e exige uma aceitação, um conflito e um movimento durável. Os 7 testes do servidor passaram em H2 e PostgreSQL. O teste da portaria distingue leitura atual, defasada, vencida e ausente. Os [cenários de atualização no navegador](../tests/specs/doca-freshness.spec.mjs) verificam o conflito em 320 px e a chegada de uma consulta anterior à reserva. O ensaio de papéis OIDC usa identidades de teste; não comprova integração com um tenant real.

## Lastro · A última linha invalida o lote

**Problema.** Se cada linha do extrato fizer um commit, um arquivo rejeitado pode deixar parte dos valores no livro. Uma confirmação perdida também pode induzir o operador a reenviar um lote que o servidor já gravou.

**Decisão.** A impressão digital do lote e as referências têm unicidade por mesa. O parser valida valores e datas antes da escrita; recebimentos e evento compartilham a transação. A auditoria guarda a revisão como dado novo. No navegador, uma chamada tem prazo de 12 segundos. Se uma escrita não é confirmada, a mensagem explica que o resultado pode já ter sido gravado e orienta atualizar os dados antes de tentar novamente. O cancelamento da espera no cliente não é tratado como rollback do servidor.

**Verificação.** `ConflictingLastRowRollsBackFirstRow` exige que a primeira linha e o evento de importação desapareçam quando a última linha conflita. `ReplayKeepsTheSameLedger` cobre a reimportação idêntica. Os 10 casos passaram em SQLite e PostgreSQL. O [teste de confirmação perdida](../tests/specs/lastro-network.spec.mjs) deixa a API real concluir a importação e retém sua resposta: a tela libera os controles, informa a incerteza e, após recarregar e reenviar, conserva exatamente um evento de importação.

**Interface.** O teste de contraste confere os cinco estados com limite de 4,5:1. O [cenário de celular](../tests/specs/lastro-mobile.spec.mjs) verifica seleção, retorno do foco e consulta da auditoria Blazor com filtro. Esses testes não constituem cobertura completa de acessibilidade.

## Farol · A fonte certa ainda pode produzir uma resposta incompleta

**Falha observada no ensaio histórico.** Um Qwen local recuperou o manual correto para uma pergunta sobre informes de incidente P1, mas o editor selecionou uma frase que omitia o intervalo de 15 minutos. A versão inicial também recusava uma paráfrase sobre o aceite de mudança programada. Nas perguntas adicionais, houve respostas indevidas a consultas sobre preço e fornecedor ausentes do acervo.

**Correção.** A resposta precisa ser literal e pertencer à seção recuperada. Se uma seleção omite medidas ou informações exigidas pela pergunta, o modo extrativo conserva a seção inteira. A busca aproxima o vocabulário de aceite e aprovação; consultas de identificação exigem campo e assunto compatíveis com a passagem. Uma pergunta sem evidência continua disponível para encaminhamento pelo operador.

**Verificação atual.** Os 14 testes passaram, incluindo seleção incompleta, aprovação e janela de manutenção, isolamento de sessão, expiração e revisão concorrente. No modo extrativo, a suíte original acertou 18/18 fontes e 4/4 recusas; a suíte adicional verificou 8/8 respostas completas e 4/4 recusas. A [comparação de conteúdo](../farol/README.md#como-medimos-a-qualidade) expõe as perguntas e os fatos esperados.

**Limite.** As perguntas adicionais orientaram as correções, portanto não são uma avaliação independente. A qualidade em novos acervos, paráfrases e usuários exige outra amostra. O Qwen e os adaptadores HTTPX/LangChain não foram reexecutados nesta sessão; os [resultados históricos](modelo.md) permanecem separados das métricas extrativas atuais.

## Rastro · O evento atrasado pertence ao histórico

**Problema.** A ordem de chegada não identifica necessariamente a última posição de um veículo. Reenvios, duas conexões concorrentes e uma chave reutilizada com conteúdo diferente podem duplicar o histórico ou fazer a posição atual recuar.

**Decisão.** PostgreSQL conserva as leituras aceitas e a projeção da posição corrente na mesma transação. O horário observado e a sequência do dispositivo determinam a ordem. Um replay não cria uma nova leitura; uma identidade ou sequência conflitante é rejeitada. A leitura atrasada entra no histórico sem substituir a posição mais recente. O monitor mostra data e hora e nomeia conflitos explicitamente.

**Espera limitada.** O pool configura conexão em até 4 segundos, espera por conexão em até 5 segundos, bloqueio SQL em até 2 segundos e comando SQL em até 8 segundos. Falhas de conexão, espera ou bloqueio retornam HTTP 503. O navegador limita a requisição a 15 segundos. Esses limites encerram a espera; não substituem monitoramento, dimensionamento nem uma política de repetição do sistema que envia telemetria.

**Verificação.** Os 13 testes usam PostgreSQL e chamadas HTTP reais. Cobrem reenvio, evento fora de ordem, empate de horário, conflito, concorrência entre conexões, rollback de lote, autenticação e validação de entradas. Em `test_lock_timeout_rolls_back_and_same_event_can_be_retried`, uma conexão mantém a trava; a API responde 503 sem deixar o evento parcialmente gravado. Após liberar a trava, o mesmo evento pode ser reenviado. Os [três cenários no Chromium](../tests/specs/rastro.spec.mjs) verificam a linha do tempo, o segundo envio, seleção por teclado em 320 px e recuperação após falha de consulta.

**Limite.** O monitor é uma demonstração local com veículos sintéticos. Não inclui rastreador físico, autorização por empresa nem retenção e backup de uma operação real. A captura anterior do plano de consulta permanece identificada como medição histórica.

## Apresentação e assistência de IA

Os quatro filmes foram renovados a partir de operações nas aplicações em execução. Cada MP4 tem 27 segundos, texto na tela e legenda em português; Lastro inclui também legenda em inglês. O README e a apresentação destacam os currículos PDF e TXT ATS, contato, problema de cada projeto e seus limites.

A implementação é assistida por IA. Código, testes, dados sintéticos e [resultados medidos](verificacao.md) permitem inspecionar as decisões e reproduzir os cenários. As demonstrações e a aprovação das suítes não comprovam operação em produção.
