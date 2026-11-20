import 'package:doca_field/api.dart';
import 'package:doca_field/main.dart';
import 'package:doca_field/notes.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:local_auth/local_auth.dart';

YardSnapshot reading() => YardSnapshot(List.generate(6,
  (i) => Dock('D${i + 1}', 'Doca ${i + 1}', 'Seca', 'free', '')), DateTime.now());

// Explicit test substitute: authorization is simulated; storage remains the native plugin.
// This test does not prove recognition of a fingerprint, Face ID, or hardware security.
class GrantedAuthWithNativeStorage implements NotesBoundary {
  GrantedAuthWithNativeStorage(this.storage);
  final NativeNotesBoundary storage;
  @override
  bool get supported => true;
  @override
  Future<NoteAuthorization> authorize(String name) async => NoteAuthorization.granted;
  @override
  Future<void> cancelAuthorization() async {}
  @override
  Future<String?> read(String id) => storage.read(id);
  @override
  Future<void> write(String id, String text) => storage.write(id, text);
}

Future<void> visible(WidgetTester tester, Finder finder) async {
  for (var attempt = 0; attempt < 100; attempt++) {
    await tester.pump(const Duration(milliseconds: 100));
    if (finder.evaluate().isNotEmpty) return;
  }
  expect(finder, findsWidgets);
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('plugins nativos: sem biometria inscrita não abre nota nem causa crash', (tester) async {
    await tester.pumpWidget(FieldApp(load: () async => reading(), notes: NativeNotesBoundary()));
    await tester.pumpAndSettle();
    final available = await LocalAuthentication().getAvailableBiometrics();
    expect(available, isEmpty, reason: 'Execute este cenário em emulador limpo, sem biometria cadastrada.');
    await tester.tap(find.byTooltip('Nota privada de D1'));
    await visible(tester, find.textContaining('Cadastre uma biometria'));
    expect(find.text('Nota local · D1'), findsNothing);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('storage nativo + auth simulada: salva, relê e fecha no retorno sem reabrir', (tester) async {
    final prefix = 'qa-native-${DateTime.now().microsecondsSinceEpoch}-';
    const vault = FlutterSecureStorage();
    final notes = GrantedAuthWithNativeStorage(NativeNotesBoundary(keyPrefix: prefix));
    try {
      await tester.pumpWidget(FieldApp(load: () async => reading(), notes: notes));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Nota privada de D1'));
      await visible(tester, find.text('Nota local · D1'));
      await tester.enterText(find.byType(EditableText), 'Nota sintética persistida no plugin nativo.');
      await tester.tap(find.text('Salvar'));
      await visible(tester, find.text('Nota salva neste aparelho.'));
      expect(await vault.read(key: '${prefix}D1'), 'Nota sintética persistida no plugin nativo.');
      await tester.tap(find.byTooltip('Nota privada de D1'));
      await visible(tester, find.text('Nota sintética persistida no plugin nativo.'));
      // Lifecycle notifications are injected here; physical OS transitions remain a device check.
      binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(find.text('Nota local · D1'), findsNothing);
      expect(find.text('Nota sintética persistida no plugin nativo.'), findsNothing);
      await tester.tap(find.byTooltip('Nota privada de D1'));
      await visible(tester, find.text('Nota local · D1'));
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.text('Nota local · D1'), findsNothing);
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text('Nota local · D1'), findsNothing);
    } finally {
      await tester.pumpWidget(const SizedBox());
      await vault.delete(key: '${prefix}D1');
    }
  });
}
