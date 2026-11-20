# Flutter 3.50.0: captura do log antes de iniciar o simulador

Backport restrito ao SDK descartável do job iOS. O [commit upstream c3ed85ef987759ee54a6bce275490cde2a238dc1](https://github.com/flutter/flutter/commit/c3ed85ef987759ee54a6bce275490cde2a238dc1), PR #193142, corrige a corrida descrita na [issue #181771](https://github.com/flutter/flutter/issues/181771): o aplicativo pode iniciar antes de o leitor de logs estar pronto, perdendo a mensagem com a URL do VM Service. A CLI então espera pela conexão sem iniciar os testes.

`ios-log-ready-c3ed85e.patch` contém os hunks de produção exatos desse commit, obtidos pela API oficial do GitHub, com cabeçalhos de patch locais. Altera somente `packages/flutter_tools/lib/src/ios/simulators.dart` (+35/-4). Os testes upstream foram revisados, mas não fazem parte deste backport. A [licença BSD-3-Clause do Flutter](LICENSE) acompanha o arquivo.

| Conteúdo | SHA-256 |
| --- | --- |
| Patch em UTF-8/LF | `d63955f376ee528b06293f29e6b9a5fcc5b4c0c96b141bf93cf408dc2ccfb67b` |
| [Arquivo original da tag 3.50.0](https://raw.githubusercontent.com/flutter/flutter/3.50.0/packages/flutter_tools/lib/src/ios/simulators.dart) | `8fd87b3480cd84dbed924eb1e067b04466e53282cea5959dc7e17895ab3a4a55` |

`.gitattributes` preserva os finais de linha LF. O workflow confere os dois hashes e executa `git apply --check` antes de alterar o SDK. Divergência encerra o job. O SDK modificado não é salvo em cache. Somente seu `flutter_tools.stamp` é invalidado para que a CLI recompilada use o patch; engine, código e testes do aplicativo permanecem intactos.

A mudança espera a primeira linha do processo de captura antes de lançar o aplicativo; não repete testes, não converte falhas em sucesso e não amplia o prazo da suíte. A execução mantém logs detalhados e coleta diagnóstico mesmo após falha. Remova este backport ao adotar uma versão estável que contenha a correção, após conferir o fonte e repetir a integração nativa.

A reprodução observada foi o [job iOS de ed694ab](https://github.com/Victor-F-M-A-R/Curriculo/actions/runs/44685758680/job/136119576877): `simctl launch` apareceu antes de `log stream`, seguido de espera pelo VM Service. Resultados de uma revisão com o backport devem ser registrados somente após os testes efetivamente concluírem.
