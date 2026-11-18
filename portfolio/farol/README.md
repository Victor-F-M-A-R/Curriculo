# Farol

[Ver demonstração](../docs/demonstracoes.md#farol) · [Todos os projetos](../../README.md)

![Assistente de operações do campus](../docs/media/farol.webp)

Um plantonista precisa saber o que fazer e mostrar de qual procedimento saiu a orientação. O Farol pesquisa **oito manuais fictícios de TI escolar, divididos em 17 seções**. O operador lê a resposta, abre o trecho destacado no manual e vê a revisão do documento. Uma pergunta sem evidência pode seguir para revisão humana.

## Escopo e decisões

O produto atende consultas de plantão sobre rede, impressão, salas, empréstimos, incidentes, mudanças e recuperação de arquivos. O contexto disponível é o acervo aprovado e, quando a pessoa escolhe, um manual específico para a próxima pergunta. O serviço de IA tem acesso de leitura a essas fontes. O encaminhamento de uma revisão depende de uma ação do operador.

O modo padrão roda localmente sem chave de modelo. FastAPI atende a interface React/TypeScript, SQLite-vec ordena os trechos e SQLite guarda o histórico por sessão. O perfil com modelo usa um provedor compatível com Chat Completions. A revisão externa passa pelo n8n e é recebida por uma API .NET. Nestes estudos o acervo e os incidentes são sintéticos.

## Demonstrar

1. Abra [o caderno](http://localhost:8083) após iniciar o [Compose](../README.md).
2. Pergunte **Quem dá o aceite de uma mudança programada e quando podemos executá-la?** Abra a citação RB-06#s1. O leitor destaca o trecho com os dois responsáveis e a janela de manutenção. Use **Voltar à resposta** para retomar a consulta.
3. Pergunte **Qual é o preço mensal do contrato da WAN Cedro?** O preço fica fora do acervo. Encaminhe a consulta para revisão e confira o estado de entrega.
4. Abra o histórico para recuperar uma consulta daquela sessão. Em uma consulta já respondida, é possível restringir a pergunta seguinte ao manual citado. O botão de apagar histórico remove as consultas e revisões locais da sessão.

## Como os componentes cooperam

- **Planejamento**. Sem modelo, a busca usa os manuais selecionados pelo operador. Com LLM, um arquivista pode escolher entre duas ferramentas tipadas: buscar no acervo ou em um manual conhecido. Um escopo escolhido pelo modelo pode ser ampliado quando faltam evidências.
- **Recuperação**. TF-IDF de palavras e de fragmentos de palavras forma os vetores. Um vocabulário curto aproxima termos operacionais como “aceite” e “aprovação”. Perguntas de identificação como “nome do fornecedor” exigem que o trecho contenha o campo e seu assunto. SQLite-vec executa KNN com distância de cosseno. O índice pode ser persistido em `FAROL_INDEX_DB` e é reconstruído quando os vetores mudam.
- **Resposta**. No modo extrativo, o melhor trecho é exibido integralmente. Com modelo, o editor seleciona um excerto. A API verifica a origem do ID e a literalidade da citação. Se a pergunta exigir mais de uma informação ou o excerto omitir medidas da seção, o leitor recebe a seção inteira para preservar o contexto.
- **Revisão**. O FastAPI persiste o pedido e o evento. A fila tenta a entrega, espera um identificador de confirmação e retenta falhas transitórias. O workflow n8n envia o envelope ao receptor .NET, que usa Dapper e uma chave única por evento. O envelope carrega IDs e tipo de evento.
- **Memória**. O histórico pertence à sessão HTTP-only. Consultas com mais de sete dias deixam de ser visíveis mesmo que ninguém registre uma nova consulta. Uma entrega pendente mantém seu registro enquanto a fila conclui o envio. O pedido de revisão e sua associação à sessão são registrados na mesma transação. Registros já entregues ao serviço externo seguem a política dele.

## Como medimos a qualidade

A primeira suíte exercita a busca real em SQLite-vec. A suíte de conteúdo também chama o mesmo caminho de resposta usado pela API e compara o texto com as fontes aprovadas. As perguntas e os fatos esperados ficam no avaliador, fora do índice pesquisado.

| Verificação do modo extrativo | Versão inicial (8bc9cca) | Revisão atual |
| --- | ---: | ---: |
| Seção correta nas 18 perguntas respondíveis da suíte original | 17/18 | 18/18 |
| Recusa nas quatro perguntas fora do escopo da suíte original | 4/4 | 4/4 |
| Resposta com a fonte e todos os fatos pedidos nas oito perguntas adicionais | 8/8 | 8/8 |
| Recusa nas quatro perguntas adicionais fora do escopo | 2/4 | 4/4 |

A suíte adicional contém 12 perguntas de revisão interna. A primeira versão apontava um procedimento de toner para uma pergunta sobre preço e um manual de empréstimo para identificar o fornecedor de um Chromebook. Essas duas consultas passaram a orientar correções. A comparação usa as mesmas perguntas e critérios nas duas versões. A verificação de fatos busca expressões explícitas com acentos e pontuação normalizados. A generalização para outros acervos, paráfrases e usuários depende de avaliação separada.

[Perguntas e fatos esperados](service/data/content-cases.json) · [Resultado inicial, caso a caso](../docs/evidence/farol-content-baseline.json) · [Resultado atual, caso a caso](service/data/content-evaluation.json) · [Resultado de recuperação](service/data/evaluation.json)

O [ensaio histórico com Qwen](../docs/modelo.md) registrou 17 de 18 fontes corretas e quatro recusas. As medidas da tabela são do modo extrativo. Para repetir a suíte de conteúdo com um modelo configurado, acrescente `--model` ao segundo comando abaixo. O resultado registra o modelo e o modo realmente usado em cada resposta, incluindo eventual contingência extrativa.

```sh
cd service
python evaluate.py
python evaluate.py --suite content
```

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
