# Doca Norte

[Ver demonstração](../docs/demonstracoes.md#doca-norte) · [Todos os projetos](../../README.md)

![Pátio e maquete em operação](../docs/media/doca.webp)

Um operador precisa saber onde receber o próximo caminhão. A tela Angular permite selecionar a doca no modelo isométrico, reservar para uma transportadora, iniciar a descarga e registrar a liberação. A portaria e o aplicativo Flutter consultam uma projeção de leitura separada do histórico da operação.

## Escopo do projeto

| Quem usa | Decisão que o produto permite tomar |
| --- | --- |
| Operador de pátio | Escolher uma posição disponível, registrar a reserva, iniciar a descarga e liberar a doca. |
| Portaria | Ver a última situação recebida e reconhecer quando a comunicação com o pátio envelheceu. |
| Responsável pelo turno | Consultar movimentos recentes e, no aplicativo de campo, guardar uma nota privada por doca. |

A demonstração usa seis docas e transportadoras fictícias. O horário no painel corresponde à chegada de uma leitura bem-sucedida da API. A portaria possui seu próprio horário de amostragem. Uma integração com rastreadores de veículos exigiria receber também o horário de origem de cada posição.

## Demonstrar

1. Na [execução com Compose](../README.md), abra [o pátio](http://localhost:8081) e selecione D1, ou outra posição livre.
2. Informe uma transportadora. Clique em **Reservar doca**, **Iniciar descarga** e **Liberar doca**.
3. Confira a sequência no livro de movimentos. Recarregue a página para confirmar a persistência.
4. No celular, **Última leitura** continua visível. **Atualizar leitura** consulta o servidor imediatamente. Ao ficar sem conexão, o horário e a última posição confirmados permanecem na tela e o painel suspende os movimentos. A próxima leitura bem-sucedida libera as ações.
5. Consulte [a portaria](http://localhost:8085/api/field). A projeção é atualizada a cada cinco segundos.

## Contrato e arquitetura

| Entrada | Resultado |
| --- | --- |
| `GET /api/yard` | Seis docas, versão de cada agregado e os quarenta movimentos mais recentes |
| `GET /api/session` | Sessão, permissão de escrita, token CSRF e nome do cabeçalho |
| `POST /api/docks/{id}/moves` | Transição com `action`, `carrier`, `expectedVersion`, cabeçalhos CSRF e `Idempotency-Key` UUID |
| `GET /actuator/health`, `/actuator/prometheus` | Saúde, contadores de movimentos e conflitos |
| `GET /api/field` na portaria | Posição, transportadora, revisão temporal da leitura e indicador de desatualização |

O [contrato OpenAPI 3.1](server/src/main/resources/static/yard-api.json) descreve as rotas principais.

A requisição deve informar a versão vista pelo operador, inclusive quando ela vale zero. Uma versão omitida ou nula resulta em HTTP 400. O `Yard.apply` bloqueia a linha com `SELECT FOR UPDATE`, confere a versão do operador e grava o movimento na mesma transação da mudança de estado. Uma repetição idêntica retorna o estado atual da doca. Uma chave reutilizada com outra intenção, ou uma decisão feita sobre uma versão antiga, retorna 409. O medidor de atividade é telemetria de processo. O livro no banco é o registro durável. O histórico inclui a versão da doca após cada movimento, usada também para preservar a identidade visual da linha quando o painel é atualizado.

O painel consulta o pátio a cada dez segundos. Uma falha de leitura, ou mais de vinte segundos sem confirmação, marca o quadro como desatualizado. As últimas posições continuam visíveis para referência. Uma leitura iniciada antes de um comando não substitui a resposta que confirma a decisão. Em um conflito, o navegador apresenta o motivo e aguarda dados confirmados antes de liberar outra alteração.

A portaria consulta a API central e conserva a última leitura em memória. Após 12 segundos sinaliza defasagem. Após 120 segundos retorna 503. O cliente Flutter marca falha de atualização e permite tentar novamente. O modelo no navegador usa projeção axonométrica de geometria 3D desenhada em Canvas 2D, seleção por teclado e giro de câmera.

## Executar com SDKs

Requisitos: Java 21, Maven 3.9, Node 24. Abra terminais separados na pasta do projeto.

```sh
cd server
mvn spring-boot:run
```

```sh
cd web
npm ci
npm run dev
```

A interface de desenvolvimento abre em `http://localhost:4200`. Em outro terminal execute `mvn -f portaria/pom.xml spring-boot:run`. O modo nativo usa H2 em arquivo. Compose usa PostgreSQL. Configure `JDBC_URL`, `DB_USER` e `DB_PASSWORD` para um banco dedicado.

## Identidade e telemetria

O modo local demonstra a operação do pátio. Para uma equipe autenticada, configure o perfil `oidc` com `SPRING_PROFILES_ACTIVE=oidc`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` e `OIDC_OPERATOR_GROUP`. Registre `https://HOST/login/oauth2/code/yard` como retorno no provedor. O cliente Spring processa o login OIDC por authorization code e valida o ID token do emissor. O grupo no claim `groups` habilita as mudanças. O navegador guarda a sessão HTTP-only. Faça o teste com HTTPS e com usuários dos grupos de leitura e escrita antes de expor dados de operação.

A autorização vence junto com o ID token ou após `OIDC_MAX_AUTH_AGE_SECONDS` (300 segundos por padrão), o que ocorrer primeiro. É necessário novo login para renovar os grupos; o cliente não conserva permissão indefinidamente após uma mudança de papel no provedor. A interface relê a sessão a cada atualização, remove controles de escrita quando necessário e oculta dados ao receber 401/403. No modo OIDC, a leitura do pátio também exige autenticação. Para a portaria, configure o mesmo `YARD_READER_TOKEN` no servidor e no leitor; esse segredo de serviço concede apenas leitura e nunca deve ser entregue ao navegador.

O contrato inclui `sampledAt`, horário da leitura na origem. A portaria preserva esse horário em vez de renovar artificialmente a idade do cache. Painel e aplicativo recusam esquemas inválidos, horários no futuro e respostas antigas. Comandos HTTP têm limite de 16 KiB, tipos estritos e não aceitam campos desconhecidos/repetidos. Falhas temporárias de banco retornam 503 com `Retry-After`, sem exibir detalhes internos. O comando e a chave de idempotência devem ser preservados após uma confirmação perdida.

Os logs do servidor incluem ID de requisição, doca, ação e versão. `yard_movements_total` e `yard_conflicts_total` aparecem no Prometheus após os respectivos eventos.

## Verificar

```sh
mvn -f server/pom.xml test
mvn -f portaria/pom.xml test
```

Para executar novamente em PostgreSQL, use uma base **descartável** e configure `TEST_JDBC_URL`, `TEST_DB_USER` e `TEST_DB_PASSWORD`. O setup do teste limpa os movimentos da base escolhida. A suíte cobre disputa simultânea, repetição, CSRF, versão obrigatória e expiração da projeção. O [teste HTTP de papéis](server/src/test/java/br/dev/docanorte/OidcRolesTest.java) usa identidades OIDC de teste e exercita as permissões do leitor e do operador. A troca de credenciais com um provedor real permanece uma validação de implantação. Os [testes de navegador](../tests/specs/doca-freshness.spec.mjs) exercitam a releitura após conflito em 320 px e uma resposta atrasada que chega depois da reserva. [Aplicativo de campo](field/README.md) · [Gravação do fluxo](../docs/media/doca.mp4)
