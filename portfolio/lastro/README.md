# Lastro

[Ver demonstração](../docs/demonstracoes.md#lastro) · [Todos os projetos](../../README.md)

![Mesa de conciliação do Lastro](../docs/media/lastro.webp)

O financeiro recebe títulos previstos e um extrato de repasses. O Lastro compara os valores por referência, separa as diferenças e mantém um livro de revisões. A tela abre diretamente em uma mesa com oito títulos fictícios. Uma conta registrada permite sair e recuperar sua própria mesa.

## Demonstrar

1. Abra [a mesa](http://localhost:8082) após iniciar o [Compose](../README.md).
2. Clique em **Importar extrato → Usar extrato de exemplo → Conciliar lote**. O arquivo também está em [samples/repasses.csv](samples/repasses.csv).
3. Importe o mesmo lote outra vez. Abra REP-1048, confira os R$ 17,50 de diferença e registre a justificativa.
4. Abra **Trilha de auditoria**. A página Blazor lê os eventos da mesma mesa. O valor financeiro original continua no livro.

## O que acontece no servidor

O parser valida o arquivo inteiro, interpreta vírgula decimal e converte os valores para centavos inteiros. A referência e a impressão digital do lote têm unicidade por mesa. O banco grava o lote, seus repasses e o evento em uma transação. Se a última linha conflitar, o banco reverte o lote inteiro.

`Book.cs` oferece SQLite em arquivo, PostgreSQL e SQL Server usando Dapper. A operação de revisão aceita divergências abertas e repasses sem título. O histórico registra a justificativa sem modificar o recebimento. O cookie de sessão assinado inclui o identificador da mesa. A API usa esse identificador para todas as consultas. Cadastro e login usam o PasswordHasher do ASP.NET, limite de tentativas e cookies HTTP-only.

| Rota | Uso |
| --- | --- |
| `POST /api/session/demo` | Abrir uma mesa com dados sintéticos |
| `POST /api/register`, `/api/login`, `/api/logout` | Criar conta, entrar e sair |
| `GET /api/book`, `GET /api/book/events` | Ler lançamentos e eventos da mesa autenticada |
| `POST /api/book/import` | Enviar `{"csv":"..."}` com até 500 linhas |
| `POST /api/book/{referencia}/review` | Enviar `{"note":"..."}` para uma divergência |
| `GET /audit` | Livro de auditoria renderizado em Blazor |

Os POSTs da aplicação exigem o cabeçalho `X-Lastro-Client: desk`. A política de mesma origem do navegador e o cookie SameSite Strict fazem parte do desenho. Uma mesa anônima dura a sessão do navegador. Uma conta nova recebe um lote próprio.

## Desenvolvimento e testes

Instale .NET 10 e Node 24. Execute estes comandos em dois terminais.

```sh
dotnet run --project server --urls http://127.0.0.1:8082
```

```sh
cd web
npm ci
npm run dev
```

Abra o endereço indicado pelo Vite. Rode `dotnet test tests -c Release` na pasta Lastro. A suíte testa replay, rollback, precisão, referência órfã e isolamento de mesas.

Para conectar SQL Server, configure `BOOK_ENGINE=sqlserver` e `BOOK_CONNECTION` com uma base vazia dedicada. PostgreSQL usa `BOOK_ENGINE=postgres`. Em PostgreSQL gerenciado ou Aurora, configure TLS, credencial e conectividade privada do ambiente. Os testes aceitam `TEST_BOOK_ENGINE` e `TEST_BOOK_CONNECTION` para uma base descartável.

## Projeção de auditoria em Cosmos DB

Ao definir `COSMOS_CONNECTION`, o serviço de fundo lê o outbox e envia até 50 eventos por iteração ao contêiner existente. Use `COSMOS_DATABASE` (padrão `lastro`), `COSMOS_CONTAINER` (padrão `audit`) e partição `/workspace`. O ID do documento é o ID imutável do evento. Uma repetição entre o upsert e a marca de exportação converge para o mesmo documento.

Os testes locais rodaram com SQLite e PostgreSQL. O caminho SQL Server e o projetor Cosmos foram compilados. A conexão a uma instância real de cada um está identificada na [matriz de evidências](../docs/verificacao.md).
