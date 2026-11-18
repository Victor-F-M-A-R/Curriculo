# Decisões e revisão de engenharia

## Doca Norte · Duas pessoas escolhem a mesma doca

**Falha de projeto avaliada.** Ler o estado no navegador e enviar uma atualização sem versão permite que o segundo operador tome uma decisão sobre uma leitura vencida.

**Decisão.** A API aceita a versão vista pelo operador, adquire uma trava na linha, verifica a transição e persiste o evento em uma transação. A chave de idempotência identifica o comando na doca. Um replay com a mesma chave e parâmetros devolve o estado atual.

**Reprodução.** `YardTest.concurrentBookingsHaveExactlyOneWinner` solta dois comandos simultâneos por um latch e exige uma aceitação, um conflito e um movimento durável. A suíte foi executada em H2 e PostgreSQL. O navegador volta a buscar o pátio após um 409.

## Lastro · A última linha invalida o lote

**Falha de projeto avaliada.** Se cada linha do extrato fizer um commit, um arquivo rejeitado pode deixar parte dos valores no livro. Um reenvio comprometeria a contagem.

**Decisão.** A impressão digital do lote e as referências têm chaves únicas por mesa. O parser valida valor e data antes da escrita. A operação inclui recebimentos e evento no mesmo commit. A auditoria guarda a revisão como dado novo.

**Reprodução.** `ConflictingLastRowRollsBackFirstRow` começa com uma referência nova e termina com uma duplicada. O teste verifica a ausência da primeira referência e do evento de importação. `ReplayKeepsTheSameLedger` cobre o arquivo idêntico.

## Farol · O modelo citou a fonte certa e omitiu a informação pedida

**Falha observada.** Durante o ensaio com um Qwen local, a pergunta sobre o intervalo de informes de um incidente P1 recuperou o manual correto. A frase escolhida pelo editor dizia para registrar os blocos afetados. A resposta deixou de fora os 15 minutos solicitados.

**Correção.** Quando a pergunta exige uma medida e a seleção omite a unidade e a quantidade disponíveis, o seletor conserva a seção inteira. A checagem de literalidade continua obrigatória. O teste `test_time_question_keeps_the_interval_when_the_editor_drops_it` reproduz a seleção incompleta.

**Limite conhecido.** Uma paráfrase sobre o aceite de mudança programada foi recusada apesar de haver orientação no corpus. Relevância e fidelidade semântica precisam de uma amostra maior e independente antes de uso operacional.

## Assistência de IA

Esta entrega inclui código assistido por IA, execução de ferramentas, correções e testes registrados. O material de revisão é evidência de como inspecionar e rejeitar uma saída incorreta.
