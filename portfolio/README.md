# Caderno aplicado
### Victor Almeida · Engenharia de software

Três produtos de portfólio com dados fictícios, interfaces de operação, serviços persistentes e testes executáveis. Os estudos tratam de concorrência no pátio, integridade de lotes financeiros e rastreabilidade de respostas de IA.

| Produto | Experimente | Código e decisões |
| --- | --- | --- |
| **Doca Norte** | Reserve a D1, inicie a descarga e libere a posição na maquete. | [Java, Angular, PostgreSQL e Flutter](doca-norte/README.md) |
| **Lastro** | Importe o extrato de exemplo duas vezes e justifique a diferença de um repasse. | [.NET, React, Blazor e Dapper](lastro/README.md) |
| **Farol** | Pergunte sobre o link de reserva, abra a fonte e encaminhe uma pergunta sem resposta para revisão. | [FastAPI, busca vetorial, LLM e n8n](farol/README.md) |

## Rodar os três aplicativos

Instale Docker com Compose v2. A partir da raiz deste repositório, execute

```sh
cd portfolio
docker compose up --build -d
docker compose ps
```

| Endereço local | Aplicativo |
| --- | --- |
| [localhost:8081](http://localhost:8081) | Pátio compartilhado da demonstração |
| [localhost:8082](http://localhost:8082) | Mesa de conciliação, isolada por sessão ou conta |
| [localhost:8083](http://localhost:8083) | Assistente Farol com índice vetorial e histórico da sessão |
| [localhost:8085/api/field](http://localhost:8085/api/field) | Leitura da portaria para o cliente Flutter |

O primeiro build baixa os SDKs e as dependências. As portas publicadas aceitam conexões da máquina local. O PostgreSQL e os volumes guardam os dados entre reinícios. Para encerrar os serviços, execute `docker compose down`. Os READMEs individuais também trazem a execução com SDKs nativos.

Para experimentar a entrega da fila do Farol pelo workflow n8n e pelo receptor .NET, use `docker compose -f compose.yaml -f compose.automation.yaml --profile automation up --build -d`. O inicializador prepara o workflow e as duas credenciais no volume dedicado à demonstração. O modo padrão do assistente responde sem chave de IA.

## Explorar em cinco minutos

1. Abra o [índice de vídeos](docs/demonstracoes.md). As gravações mostram o resultado real de operações executadas no navegador.
2. Escolha a documentação do [pátio](doca-norte/), do [livro financeiro](lastro/) ou do [assistente](farol/) para seguir uma operação da tela até o banco.
3. Confira os [resultados de verificação](docs/verificacao.md). Há um teste de concorrência no pátio, um de rollback do lote financeiro e um teste que atravessa FastAPI, n8n e .NET.
4. Veja o [registro de decisões e revisão](docs/revisao.md) e o [roteiro técnico em inglês](docs/lastro-walkthrough.en.md).

## Organização

```text
doca-norte/    server/ (Spring), portaria/ (Spring), web/ (Angular), field/ (Flutter)
lastro/        server/ (ASP.NET e Blazor), web/ (React), tests/, samples/
farol/         service/ (FastAPI), inbox/ (.NET), web/ (React), automation/ (n8n)
tests/         Playwright e integração com o workflow real
showcase/      página estática de apresentação e maquete navegável
docs/          demonstrações e evidências reproduzíveis
../.github/    verificação e deploy manual no ECS
```

O histórico público está organizado por entregas. Para obter o código e os commits no computador, execute `git clone https://github.com/Victor-F-M-A-R/Curriculo.git`.

Implementação assistida por IA, com dados construídos para este portfólio. O registro de verificação identifica os serviços externos que ainda precisam de validação.
