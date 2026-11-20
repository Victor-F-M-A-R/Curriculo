# Caixa de revisão do Farol

Receptor interno do fluxo FastAPI → n8n → Inbox. Recebe apenas `event_id`, `run_id` (GUIDs sem hífens) e `kind: "review.requested"`; requer `X-Inbox-Token`. A configuração e a execução integrada estão no [Farol](../README.md).

O evento persistido recebe confirmação somente após a gravação. Reenvios convergem pelo ID, inclusive com diferenças entre maiúsculas e minúsculas. Registros antigos são consultados sem reescrever seu ID ou horário. O mesmo evento associado a outra consulta ou tipo recebe HTTP 409. Um tipo desconhecido em evento novo, JSON inválido ou campos extras recebem HTTP 400. O limite do corpo é 4 KiB; a autenticação acontece antes da leitura do corpo. As rotas têm a mesma proteção com barra final e variação de caixa.

SQLite é o padrão. O caminho SQL Server já existente usa `INBOX_ENGINE=sqlserver` e `INBOX_CONNECTION`. O token é fornecido pelo ambiente e nunca deve entrar no repositório. Conexões e comandos esperam até cinco segundos; falhas temporárias retornam HTTP 503. Depois de timeout ou desconexão, o emissor deve reenviar o **mesmo ID**, porque a confirmação pode ter sido perdida após a gravação. O health check verifica conexão ao banco.

## Verificação

```sh
dotnet test tests -c Release
python tests/test_http.py
```

Os testes .NET usam um SQLite temporário por caso. Para SQL Server, forneça `TEST_INBOX_ENGINE=sqlserver` e `TEST_INBOX_CONNECTION` de uma base descartável dedicada. São independentes das variáveis de Lastro. Há casos de concorrência, conflito, legado com ID em caixa alta, reabertura, cancelamento e trava seguida de recuperação.

O teste HTTP inicia a aplicação Release real em porta local efêmera, com token sintético e banco temporário próprios. Verifica autenticação, contrato, corpo inválido/grande/chunked, tamanho não numérico, reenvio após desconexão e reinício. Encerra apenas o processo que criou. Não necessita Docker, n8n nem novas bibliotecas Python. O CI da integração completa verifica separadamente a entrega pelo n8n.
