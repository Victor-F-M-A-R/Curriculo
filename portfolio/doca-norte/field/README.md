# Doca Norte · Campo

O aplicativo lê a portaria, mostra as seis docas e permite registrar uma nota local por posição em Android ou iOS. A tela preserva `sampledAt`, o instante UTC em que o pátio produziu a leitura. O limite de doze segundos conta desde essa origem; receber novamente a mesma resposta não renova sua validade. Uma falha de conexão mantém as posições conhecidas com aviso. Perder autorização (401/403) remove os dados anteriores da tela.

O contrato exige seis IDs distintos D1–D6, textos e estados válidos, transportadora coerente com o estado, `stale` booleano e horário ISO com fuso. Rejeita datas impossíveis, leituras antigas e relógio mais de cinco segundos no futuro. O corpo tem limite de 64 KiB, inclusive quando o tamanho declarado está ausente ou incorreto. O prazo total de oito segundos aciona o cancelamento de `AbortableRequest`, incluindo a leitura do corpo. Pausar o aplicativo cancela o pedido; uma resposta anterior não substitui a nova leitura ao voltar.

1. Inicie o pátio e a portaria. Instale Flutter 3.50.0 com Dart 3.14.
2. Nesta pasta execute `flutter pub get`, `flutter analyze` e `flutter test`.
3. No emulador Android, execute `flutter run --dart-define=YARD_API=http://10.0.2.2:8085`. A rede sem TLS serve ao build debug. Um aparelho físico precisa de um endpoint acessível a ele. O host padrão do Compose publica em loopback.
4. Para distribuir, configure `--dart-define=YARD_API=https://sua-portaria` e as credenciais de assinatura do projeto. Em Android, a configuração padrão de desenvolvimento usa a chave de depuração. No iOS, selecione sua equipe no Xcode e valide o acesso ao Keychain.

`NotesBoundary` separa a autorização e o armazenamento da interface. Sua implementação nativa usa `local_auth` antes de consultar `flutter_secure_storage`. O cancelamento e a falta de inscrição não leem a nota. Ir para segundo plano invalida autenticações e leituras pendentes, fecha o diálogo e não o reabre no retorno. Um diálogo ou leitura já autorizada também é encerrado ao perder atividade. Se salvar falhar, o rascunho permanece no diálogo para tentar novamente; a mensagem de sucesso aparece somente após a confirmação do armazenamento.

Android exige SDK 24 ou superior, `FlutterFragmentActivity`, tema AppCompat e permissão biométrica. O backup automático está desativado. iOS já declara o uso de Face ID e inclui os entitlements de Keychain nos três perfis de build. Essas configurações seguem as instruções de [local_auth](https://pub.dev/packages/local_auth) e [flutter_secure_storage 10.3.4](https://pub.dev/packages/flutter_secure_storage/versions/10.3.4). Não constituem prova de reconhecimento biométrico nem de assinatura de distribuição.

O build web oferece apenas a leitura da portaria. Para servir web e API em origens diferentes, use proxy de mesma origem ou configure CORS com a origem específica.

## Testes e limites da evidência

`flutter test` exercita contrato REST, limites, cancelamento, origem e expiração, recuperação, autorização perdida e respostas fora de ordem. Os testes de widgets usam **biometria e armazenamento simulados**, incluindo cancelamento, ausência de inscrição, erros e retorno do segundo plano.

Em um emulador Android limpo, sem biometria cadastrada:

```sh
flutter test integration_test/native_notes_test.dart -d emulator-5554
```

No iOS, use o identificador de um simulador limpo no argumento `-d`.

O primeiro cenário chama o plugin nativo e verifica ausência de biometria sem abrir uma nota. O segundo grava e relê pelo armazenamento seguro real, mas **simula autorização biométrica** para exercitar o formulário e o retorno; usa uma chave sintética isolada e a remove ao terminar. Os cenários nativos recebem uma leitura de pátio sintética em memória, e suas notificações de ciclo de vida são injetadas. Reconhecimento biométrico real, captura pelo seletor de aplicativos, transições físicas do sistema e desempenho em aparelho continuam exigindo ensaio próprio. A suíte não afirma ter testado esses comportamentos físicos.

Em 20/11/2026, a revisão `98f5048fe8a459650c1c0b771f19e5e3b2eb42d1` passou os dois cenários no [emulador Android — 2/2](https://github.com/Victor-F-M-A-R/Curriculo/actions/runs/44688960475/job/136129904510) e no [simulador iOS — 2/2](https://github.com/Victor-F-M-A-R/Curriculo/actions/runs/44688960475/job/136129904031). Na mesma revisão, a [verificação Flutter](https://github.com/Victor-F-M-A-R/Curriculo/actions/runs/44688960412/job/136129904246) aprovou a análise, os 26 testes de API/widgets — incluindo quatro cenários HTTP com sockets reais — e o build web.

O job iOS usa Flutter 3.50.0 com um [backport local da correção upstream c3ed85e](../../../.github/patches/flutter/README.md) somente em `flutter_tools` do runner descartável. Engine, aplicativo e testes permanecem inalterados. O log confirmou a captura iniciada antes do lançamento do aplicativo. A tentativa anterior `ed694ab` encerrou por timeout na descoberta do VM Service, sem iniciar os cenários iOS; essa falha permanece no histórico de infraestrutura.

Os `pubspec.lock` dos artefatos Android/iOS de `df01e9e` e do diagnóstico iOS de `ed694ab` foram conferidos com o repositório, normalizando somente CRLF/LF. O arquivo permaneceu inalterado em `98f5048`. O [resumo de evidências](../../docs/evidence/field-native-2026-11-20.json) registra revisões, jobs, artefatos, contagens, modos de teste e o histórico.

Os workflows de [verificação geral](../../../.github/workflows/verify.yml) e [integração nativa](../../../.github/workflows/field-native.yml) contêm os comandos executáveis. Resultados só devem ser atribuídos à revisão que efetivamente concluiu seus jobs.
