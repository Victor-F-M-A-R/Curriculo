# Doca Norte · Campo

O aplicativo lê a portaria, mostra as seis docas e permite registrar uma nota local por posição em Android ou iOS. O protocolo de leitura e o estado da interface têm testes independentes. A tela mostra a hora em que o aparelho recebeu a última lista confirmada. Depois de vinte segundos ela passa a indicar leitura antiga. Use o botão de atualização ou arraste a lista para consultar a portaria. Uma falha mantém as posições conhecidas e apresenta a indicação de indisponibilidade.

1. Inicie o pátio e a portaria. Instale Flutter 3.50.0 com Dart 3.14.
2. Nesta pasta execute `flutter pub get`, `flutter analyze` e `flutter test`.
3. No emulador Android, execute `flutter run --dart-define=YARD_API=http://10.0.2.2:8085`. A rede sem TLS serve ao build debug. Um aparelho físico precisa de um endpoint acessível a ele. O host padrão do Compose publica em loopback.
4. Para distribuir, configure `--dart-define=YARD_API=https://sua-portaria` e as credenciais de assinatura do projeto. Em Android, a configuração padrão de desenvolvimento usa a chave de depuração. No iOS, selecione sua equipe no Xcode e valide o acesso ao Keychain.

`local_auth` solicita a biometria antes da leitura da nota. `flutter_secure_storage` guarda o conteúdo no aparelho. O app fecha uma nota visível ao ir para segundo plano. O cancelamento e a falta de biometria mantêm a nota fechada. O build web oferece a leitura da portaria. Para servir web e API em origens diferentes, use um proxy de mesma origem ou configure CORS com a origem específica.

A suíte de quatro testes cobre a leitura REST, a apresentação das docas, a recuperação de falha e o envelhecimento da última leitura no aparelho. O [workflow de verificação](../../../.github/workflows/verify.yml) também executa análise estática e compila o Flutter Web de distribuição. Reconhecimento biométrico, desempenho no telefone e assinatura de distribuição precisam de ensaio em aparelho real.
