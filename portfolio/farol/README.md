# Farol

[Ver demonstração](../docs/demonstracoes.md#farol) · [Todos os projetos](../../README.md)

![Assistente de operações do campus](../docs/media/farol.webp)

Um plantonista precisa agir a partir de um manual aprovado e conseguir mostrar de onde veio uma orientação. O Farol pesquisa oito runbooks fictícios de TI escolar. A busca opera em 17 trechos, com texto, dono, revisão e identificador de seção.

## Demonstrar

1. Abra [o caderno](http://localhost:8083) após iniciar o [Compose](../README.md).
2. Pergunte **Quantas falhas na WAN Ipê fazem a Cedro assumir?** Abra a citação e leia a seção que define o limite e o intervalo das sondagens.
3. Pergunte **Qual é o preço mensal do contrato da WAN Cedro?** O manual descreve o circuito, mas não estabelece preço. Encaminhe a consulta para revisão.
4. Abra o histórico para recuperar uma consulta daquela sessão. Em uma consulta já respondida, é possível restringir a pergunta seguinte ao manual citado. O botão de apagar histórico remove as consultas e revisões locais da sessão.

## Como os componentes cooperam

- **Planejamento**. Sem modelo, a busca usa os manuais selecionados pelo operador. Com LLM, um arquivista pode escolher entre duas ferramentas tipadas: buscar no acervo ou em um manual conhecido. Um escopo escolhido pelo modelo pode ser ampliado quando faltam evidências.
- **Recuperação**. TF-IDF de palavras e de fragmentos de palavras formam os vetores. SQLite-vec executa KNN com distância de cosseno. O índice pode ser persistido em `FAROL_INDEX_DB` e é reconstruído quando os vetores mudam.
- **Resposta**. No modo extrativo, o melhor trecho é exibido integralmente. Com modelo, o editor seleciona um excerto entre os candidatos. A API exige que o ID exista e que a citação esteja contida no texto da fonte. Uma citação literal ainda pode ser irrelevante para uma pergunta. O benchmark mede essa diferença.
- **Revisão**. O FastAPI persiste o pedido e o evento. A fila tenta a entrega, espera um identificador de confirmação e retenta falhas transitórias. O workflow n8n envia o envelope ao receptor .NET, que usa Dapper e uma chave única por evento. O envelope carrega IDs e tipo de evento.
- **Memória**. O histórico pertence à sessão HTTP-only. A busca textual usa os manuais aprovados. A consulta seguinte só herda escopo quando o operador escolhe um manual. Registros de revisão já entregues ao serviço externo seguem a retenção desse serviço.

## Executar com SDKs

Python 3.12 e Node 24. A partir de `farol/`, crie um ambiente Python e instale as dependências. Em Windows, ative com `.venv\Scripts\Activate.ps1`.

```sh
python -m venv .venv
. .venv/bin/activate
python -m pip install -r service/requirements.txt
(cd web && npm ci && npm run build)
cd service
python -m uvicorn app:app --host 127.0.0.1 --port 8083
```

Em `service/`, rode `python -m unittest -v` e `python evaluate.py`. A documentação OpenAPI é gerada pelo FastAPI em [localhost:8083/docs](http://localhost:8083/docs). Para medir um modelo de verdade, siga [o ensaio do LLM local](../docs/modelo.md). O conector direto usa HTTPX. O adaptador opcional usa LangChain.

## Automatizar a revisão

Com Docker, o comando do perfil de automação no [README principal](../README.md) inicializa n8n, o workflow e a caixa de entrada. Abra uma consulta, clique em **Encaminhar para revisão** e depois em **Atualizar**. O estado final é **Recebida pelo n8n**.

No n8n, o cabeçalho de entrada é `X-Farol-Token`. A requisição ao Inbox usa `X-Inbox-Token`. Os padrões com prefixo `demo-local` servem à rede local de demonstração. Configure valores próprios ao adaptar a instalação. O Compose da automação usa um volume específico para o workflow gerenciado pelo projeto. O receptor aceita SQLite ou SQL Server por `INBOX_ENGINE` e `INBOX_CONNECTION`.

O teste [tests/n8n_verify.py](../tests/n8n_verify.py) inicia o workflow exportado no n8n real, uma API Inbox compilada e o FastAPI. Para reproduzir com SDKs, disponibilize n8n 2.48.5 no PATH (`npm install --prefix .artifacts/n8n n8n@2.48.5` em Node 24), compile `dotnet build farol/inbox -c Release` e rode `python tests/n8n_verify.py` da raiz com o ambiente Python ativo.
