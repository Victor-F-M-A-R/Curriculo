# Operação e implantação

## Perfis

| Componente | Desenvolvimento | Integração disponível |
| --- | --- | --- |
| Doca Norte | H2 em arquivo, sessão local | PostgreSQL com JDBC e perfil OIDC |
| Lastro | SQLite, cookies assinados e senha derivada | SQL Server ou PostgreSQL com Dapper, projeção em Cosmos |
| Farol | SQLite-vec, histórico SQLite, fila local | LLM compatível com Chat Completions, LangChain e workflow n8n |
| Portaria e Inbox | Serviços dedicados em processos próprios | Leitura REST do pátio e recepção autenticada de eventos |

## AWS por ambiente de GitHub

O workflow [deploy-aws.yml](../../.github/workflows/deploy-aws.yml) compila a imagem escolhida, envia ao ECR, resolve seu digest, registra uma revisão da definição de tarefa e aguarda estabilidade do serviço ECS. Ele é acionado manualmente para uma infraestrutura já existente.

1. Crie um ambiente de GitHub com o nome `doca-norte-aws`, `lastro-aws` ou `farol-aws`. Configure `AWS_REGION`, `AWS_ROLE_ARN`, `ECR_REPOSITORY`, `ECS_CLUSTER`, `ECS_SERVICE` e `ECS_CONTAINER`.
2. Configure a confiança OIDC do IAM para o repositório e o ambiente escolhidos. Restrinja o papel ao ECR e serviço ECS de destino e aos papéis que a tarefa usa.
3. Na definição de tarefa, associe logs, rede, health checks e credenciais do banco via Secrets Manager ou Parameter Store. Use HTTPS no balanceador. O perfil OIDC do Doca precisa do issuer, retorno, segredo e grupos correspondentes.
4. Para Lastro em múltiplas réplicas, compartilhe as chaves de Data Protection e use o mesmo banco relacional. Para o Farol com SQLite, mantenha um escritor e armazenamento persistente com semântica de lock compatível. A adaptação para múltiplas réplicas requer mover memória, índice e fila para serviços apropriados.
5. Execute o workflow para o serviço desejado e inspecione a revisão e os logs antes de aumentar o tráfego. Um rollback aponta o serviço de volta à definição de tarefa anterior.

A demonstração entregue rodou nos SDKs locais. Os recursos de AWS não foram provisionados. O pipeline de publicação requer uma conta, custos e permissões definidos pelo responsável pelo ambiente.

## Exposição e dados

O pátio de demonstração é compartilhado. No perfil OIDC, a escrita e as métricas operacionais exigem o grupo configurado, e o pátio continua legível. Revise essa política antes de introduzir nomes, horários ou volumes reais. O Lastro cria uma mesa por conta ou sessão. O Farol envia ao provedor LLM configurado apenas a pergunta e os documentos candidatos usados no respectivo papel.

A fila externa do Farol recebe identificadores opacos. O pedido de remoção no navegador cobre o armazenamento local do Farol. Se uma revisão já foi entregue, a caixa de entrada .NET mantém seu registro próprio. Logs, backups, permissões e prazos dos serviços externos pertencem à implantação que os opera.
