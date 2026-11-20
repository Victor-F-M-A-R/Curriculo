# QA de cenários reais

Esta revisão transforma os problemas encontrados em cenários reproduzíveis. Os dados são sintéticos e os bancos são exclusivos dos testes. Os resultados aprovados, a revisão do código e os links das execuções ficam no [registro de verificação](verificacao.md).

## Critérios por produto

| Produto | Situação exercitada | Comportamento exigido | Evidência executável |
| --- | --- | --- | --- |
| Doca Norte | Dois operadores disputam a mesma posição; a confirmação se perde; o cliente repete o comando | Uma única alteração, conflito explícito e repetição com a mesma chave | [YardTest](../doca-norte/server/src/test/java/br/dev/docanorte/YardTest.java), [fluxos do navegador](../tests/specs/products.spec.mjs) |
| Doca Norte | JSON malformado, campos repetidos, coerção de tipos, corpo excessivo e banco travado | 400/413 ou 503 recuperável; nenhum comando parcial | [YardResilienceTest](../doca-norte/server/src/test/java/br/dev/docanorte/YardResilienceTest.java) |
| Doca Norte | Sessão expira ou muda de grupo; token tem assinatura, nonce ou validade incorretos; respostas antigas chegam após a perda de autorização | Recusa de acesso, dados ocultos e novo login com grupos atualizados; respostas atrasadas não restauram dados ou permissões | [OIDC por HTTP](../doca-norte/server/src/test/java/br/dev/docanorte/OidcProtocolTest.java), [sessão na interface](../tests/specs/doca-resilience.spec.mjs) |
| Doca Norte | Maquete em desktop e celular; controles próximos ao seletor de docas | Alvo completo dentro do painel, centro e cantos clicáveis, contraste adequado e giro efetivo | [Geometria e interação real](../tests/specs/doca-resilience.spec.mjs) |
| Portaria | A origem nega acesso e depois fica indisponível ou envia projeção inválida | Cache protegido apagado; 401/403 preservado até uma leitura novamente autorizada e válida | [Autorização e cache](../doca-norte/portaria/src/test/java/br/dev/portaria/ReaderTest.java) |
| Portaria e Campo | Leitura antiga, futura, incompleta ou recebida depois de uma atualização mais recente; resposta começa mas não termina | Idade medida na origem, esquema validado, prazo e cancelamento efetivos; informação antiga não substitui nova | [Portaria](../doca-norte/portaria/src/test/java/br/dev/portaria/ReaderTest.java), [HTTP Flutter](../doca-norte/field/test/api_test.dart), [navegador](../tests/specs/doca-freshness.spec.mjs) |
| Campo | Autorização cancelada, ausência de biometria, falha ao ler/salvar, saída e retorno à tela | Nota não lida sem autorização; rascunho preservado após falha; conteúdo privado fechado ao perder atividade | [Widgets](../doca-norte/field/test/widget_test.dart), [plugins nativos](../doca-norte/field/integration_test/native_notes_test.dart) |
| Lastro | Lote duplicado ou conflitante, centavos e culturas diferentes, concorrência, cancelamento e travas | Valores exatos, rollback do lote, replay idempotente e resposta recuperável | [BookTests](../lastro/tests/BookTests.cs), [BatchTests](../lastro/tests/BatchTests.cs) |
| Lastro | Conta muda em outra aba enquanto há dados ou importação abertos | Operação vinculada à mesa exibida; recusa antes de gravar em outra conta | [Contexto entre abas](../tests/specs/lastro-session-context.spec.mjs) |
| Lastro | Upload interrompido, resposta perdida, limite de tentativas, formulário móvel e auditoria | Interface recuperável, sem repetição silenciosa de escrita; mensagem e Retry-After no 429 | [Rede](../tests/specs/lastro-network.spec.mjs), [robustez](../tests/specs/lastro-robustness.spec.mjs), [conta](../tests/specs/products.spec.mjs) |
| Lastro | Valores comuns e máximo aceito no CSV em 320 px | Moeda inteira na linha e no resumo, sem cortar centavos, sobrepor situação ou causar rolagem horizontal | [Importação HTTP e retângulos do texto](../tests/specs/lastro-robustness.spec.mjs) |
| Farol | Pergunta sem o atributo pedido, paráfrases, condições numéricas e datas | Resposta sustentada pelo próprio trecho ou recusa explícita; fonte literal e completa | [Cobertura](../farol/service/test_grounding.py), [avaliações e resultados independentes](../farol/README.md#como-medimos-a-qualidade) |
| Farol | Consulta/remoção concorrentes, outra sessão, corpo lento/excessivo, banco travado e histórico indisponível | Isolamento, limites, recuperação e ausência de ressurreição do histórico apagado | [Serviço](../farol/service/test_service.py), [HTTP](../farol/service/test_http_limits.py), [interface](../tests/specs/farol-resilience.spec.mjs) |
| Farol e Inbox | Workflow fora do ar, reinício durante entrega, confirmação perdida e reenvio | Evento persistente, tentativas limitadas e um único registro final; autenticação antes do corpo | [Fila](../farol/service/test_delivery.py), [Inbox HTTP](../farol/inbox/tests/test_http.py), [integração real](../tests/compose_verify.py) |
| Rastro | Evento repetido, antigo ou fora de ordem; empate de horário; cursor de outro veículo; números inválidos | Histórico íntegro, posição atual sem recuo, paginação correta e recusa de entrada inválida | [Transações](../rastro/tests/test_rastro.py), [HTTP](../rastro/tests/test_http.py), [interface](../tests/specs/rastro.spec.mjs) |
| Quatro produtos | Reinício com dados gravados, queda do PostgreSQL, recuperação e leituras concorrentes | Persistência e isolamento preservados, erro temporário delimitado e serviço recuperado | [Ensaio de resiliência do Compose](../tests/resilience_verify.py) |
| Quatro interfaces | Desktop e largura de 320 px, teclado, diálogo e estados de resultado | Sem transbordamento horizontal nos estados testados; foco restaurado; verificações automatizadas de acessibilidade sem violações | [Acessibilidade](../tests/specs/accessibility.spec.mjs), [demais fluxos](../tests/specs/) |

## Como interpretar a evidência

- Testes de contrato usam entradas deliberadamente inválidas; os fluxos integrados usam processos HTTP, persistência e interfaces reais. Simulação de rede e relógio é identificada nos testes que a utilizam.
- As repetições em H2/PostgreSQL, SQLite/PostgreSQL/SQL Server e Chromium/Firefox/WebKit verificam o mesmo comportamento em ambientes diferentes. Não são casos únicos adicionais.
- O emissor OIDC local executa discovery, JWKS, redirecionamento e troca de código. Uma implantação ainda precisa conferir sua configuração do provedor corporativo, HTTPS e grupos.
- O ensaio móvel usa plugins nativos em emulador/simulador. O cenário de armazenamento autoriza por uma implementação de teste e injeta notificações de ciclo de vida. Isso não comprova reconhecimento biométrico físico nem captura pelo seletor de aplicativos.
- A análise automatizada de acessibilidade complementa os testes de teclado e enquadramento. Não substitui uma sessão com leitor de tela e usuários de tecnologia assistiva.
- As medições de latência descrevem a rajada registrada no runner. Não representam capacidade sustentada, SLA ou dimensionamento de produção.
- As perguntas independentes do Farol são congeladas antes da correção, com hash e primeiro resultado preservados. Depois de reveladas, tornam-se regressões. O acervo e a política lexical continuam delimitados.

Os resultados de uma execução não garantem ausência de defeitos em toda entrada, dispositivo ou implantação possível. Cenários novos devem virar testes, e qualquer falha nos critérios desta matriz bloqueia a publicação da revisão correspondente.
