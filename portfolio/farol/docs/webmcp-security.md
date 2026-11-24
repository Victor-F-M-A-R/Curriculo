# Decisão de segurança e limites do protótipo

Data da revisão: 24/11/2026. Escopo: integração WebMCP do Farol, dependências novas e execução local. Não é uma auditoria completa da máquina ou certificação de segurança.

## Revisão antes da execução

- Repositório do usuário: clone separado a partir de `c3cb7b52f4d2659d3b39b99e17d4b84d3949b4eb`. README, manifestos, Dockerfile, serviço e fluxo de sessão inspecionados. Nenhum hook não amostral encontrado no clone. Não havia LICENSE/SECURITY geral nesse checkout; não foi atribuída uma licença ao trabalho do usuário.
- Polyfill: nome e origem conferidos no registro npm e em `w3c-oss/webmcp-polyfill`; versão 0.2.0, licença Apache-2.0. README, licença, manifesto e implementação de registro/execução/Tool inspecionados; busca de rede e execução dinâmica nos fontes. O pacote se comunica entre frames por mensagens, com verificações de origem. Não foi encontrado cliente HTTP de telemetria nos fontes examinados.
- A dependência nova `webmcp-types@0.2.0` contém declarações TypeScript, licença MIT e nenhum JavaScript de runtime. Instalação com `--ignore-scripts`; nenhum gancho de instalação do polyfill foi executado. Hash de integridade registrado no lockfile.
- Dependências Python isoladas em `.venv`, instaladas somente como wheels. Dependências JavaScript locais e scripts de instalação desabilitados. Não foram executados instaladores de shell externos nem lidos arquivos de credenciais.
- `npm audit` na instalação reportou zero vulnerabilidades conhecidas nas árvores web e de testes. Isso não prova ausência de vulnerabilidades desconhecidas ou de falhas lógicas.

**Veredito do escopo revisado: SAFE para o ensaio local delimitado.** É um pacote recente e uma API instável: a versão é fixa e a adoção em produção exige revisão adicional. Não há dependência de serviços externos durante a demonstração.

**Ambiente: RISKY quanto ao isolamento do host.** O executor possui acesso amplo ao sistema e o daemon Docker estava indisponível; não houve sandbox de sistema operacional. A mitigação aplicada foi clone separado, leitura prévia, diretórios locais, `.venv`, instalação sem scripts e API limitada a loopback. Não se afirma que um ambiente virtual Python seja uma barreira de segurança. Não foram alteradas permissões globais, perfis ou arquivos pessoais.

## Fronteiras de confiança

1. **Servidor:** a API decide quais registros pertencem ao cookie HTTP-only da requisição. A ferramenta não recebe nem lê esse cookie; usa `credentials: same-origin`. Histórico e revisão de outra sessão retornam 404. O header de cliente e SameSite existentes são preservados; não há liberação CORS nova.
2. **Ferramentas:** não aceitam URL arbitrária, sessão, aprovação ou seleção de provedor. Schemas são documentação; validação efetiva ocorre no callback e a API mantém a validação própria.
3. **Escrita:** `/api/ask` grava histórico, portanto `readOnlyHint` é falso. Cada chamada abre `window.confirm` com pergunta e escopo antes do POST. Recusa não grava. Não se publica ferramenta para revisão nem exclusão; os controles existentes continuam responsáveis por essas operações.
4. **Origem:** não há `exposedTo` para origens externas. O cliente do laboratório só seleciona ferramentas do próprio documento por `source`. Scripts e frames da mesma origem fazem parte da fronteira de confiança do navegador; o polyfill permite descoberta na mesma origem por padrão.
5. **Conteúdo:** manuais e respostas são dados não confiáveis para instruções de agente (`untrustedContentHint`). A interface usa renderização textual React, sem injeção de HTML. A anotação não resolve prompt injection sozinha.

## O que a aprovação não garante

O diálogo demonstra aprovação na interface, não comprova criptograficamente a identidade de uma pessoa. Código malicioso na mesma origem, uma extensão privilegiada ou um agente com controle de cliques pode contornar a intenção do fluxo. A API preexistente continua disponível à interface; não foi convertido todo o serviço para um protocolo de autorização com dupla aprovação.

Para uma operação empresarial sensível, seria necessário autenticar usuários e papéis, registrar aprovações no servidor vinculadas ao payload e expiração, exigir um canal humano confiável e limitar privilégios do agente. Este protótipo não publica ferramentas de escrita empresarial nem transmite dados reais.

## Concorrência e recuperação

Registro só depois da inicialização da sessão; trava compartilhada com a interface; chamadas concorrentes são rejeitadas, não enfileiradas. Há limite de 50 segundos e suporte a cancelamento. Uma requisição interrompida pode já ter persistido no servidor: nunca há retry automático. A proteção de versão de sessão do Farol impede que uma consulta iniciada antes da exclusão recrie o histórico apagado. A trava de página não substitui as verificações do servidor nem coordena abas diferentes.
