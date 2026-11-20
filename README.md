# Victor Almeida

**Desenvolvimento de software, automação e IA aplicada.**

Tenho experiência em suporte de TI escolar e avaliação de respostas de IA. Estes quatro projetos levam problemas de operação para o código: uma reserva disputada, um repasse divergente, uma resposta sem evidência e uma posição de veículo recebida com atraso.

| Currículo para leitura | Currículo para sistemas de candidatura |
| --- | --- |
| **[Abrir currículo em PDF](curriculo/Victor_Almeida_Curriculo.pdf)** | **[Abrir currículo em texto · ATS](curriculo/Victor_Almeida_Curriculo_ATS.txt)** |
| Documento pesquisável, com experiência, formação e projetos. | Texto UTF-8 em uma coluna, fácil de copiar para formulários. |

São Paulo, SP · **[victor.f.a.r277@gmail.com](mailto:victor.f.a.r277@gmail.com)**

## Da operação para o desenvolvimento

Na recepção de uma escola, investiguei travamentos testando atualizações, rede, memória da máquina virtual e execução local. Identifiquei o limite dos Raspberry Pi, propus a substituição e instalei três Dell All-in-One com migração dos dados. Também trabalhei com Active Directory, UniFi, relatórios em Power BI e capacitação de professores no uso do Gemini. Na DataAnnotation, avaliei respostas geradas por IA entre março e junho de 2026.

## Portfólio

Os projetos usam **dados fictícios** e têm implementação assistida por IA. Cada caso apresenta o problema, as decisões de engenharia, o código, a demonstração e os limites da validação.

Revisão de 20/11/2026: cenários de falha, recuperação e limites documentados nas [evidências de execução](portfolio/docs/verificacao.md).

| Projeto | Problema de engenharia | Explore |
| --- | --- | --- |
| **Doca Norte** · Java, Angular e Flutter | Dois operadores reservam a mesma doca. A API aceita uma única reserva e atualiza o pátio e a portaria. | [Ver demonstração](portfolio/docs/demonstracoes.md#doca-norte) · [Código e arquitetura](portfolio/doca-norte/) |
| **Lastro** · C#, React e Blazor | Um extrato chega duas vezes ou traz uma referência conflitante. O livro de conciliação precisa conservar os valores e a trilha de auditoria. | [Ver demonstração](portfolio/docs/demonstracoes.md#lastro) · [Código e arquitetura](portfolio/lastro/) |
| **Farol** · Python, busca vetorial e n8n | Um plantonista pergunta quando o link de reserva deve assumir. O assistente mostra o trecho do manual ou encaminha a pergunta para revisão. | [Ver demonstração](portfolio/docs/demonstracoes.md#farol) · [Código e arquitetura](portfolio/farol/) |
| **Rastro** · PostgreSQL, SQL e FastAPI | Eventos da frota chegam repetidos ou fora de ordem. O histórico preserva as leituras e a posição atual não recua. | [Ver demonstração](portfolio/docs/demonstracoes.md#rastro) · [Código, índices e consultas](portfolio/rastro/) |

[![Maquete do pátio do Doca Norte com as posições das docas](portfolio/docs/media/doca.webp)](portfolio/docs/demonstracoes.md#doca-norte)

[Assistir aos quatro projetos](portfolio/docs/demonstracoes.md) · [Executar localmente](portfolio/) · [Conferir evidências e limites](portfolio/docs/verificacao.md) · [GitHub Actions](https://github.com/Victor-F-M-A-R/Curriculo/actions/workflows/verify.yml) · [Estudo financeiro em inglês](portfolio/docs/lastro-walkthrough.en.md)
