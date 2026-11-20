import 'dart:async';

import 'package:doca_field/api.dart';
import 'package:doca_field/main.dart';
import 'package:doca_field/notes.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

YardSnapshot sample(DateTime now, {String name = 'Doca', String status = 'free'}) => YardSnapshot(
  List.generate(6, (i) => Dock('D${i + 1}', '$name ${i + 1}', 'Seca', status, status == 'free' ? '' : 'Linha Azul')),
  now,
);

// This boundary deliberately simulates authentication/storage. Native coverage is separate.
class FakeNotes implements NotesBoundary {
  @override
  bool supported = true;
  NoteAuthorization authorization = NoteAuthorization.granted;
  Completer<NoteAuthorization>? authentication;
  Completer<String?>? reading;
  Object? readError;
  Future<void> Function(String, String)? saving;
  final values = <String, String>{};
  int reads = 0, writes = 0, cancellations = 0;
  @override
  Future<NoteAuthorization> authorize(String name) async => authentication == null ? authorization : await authentication!.future;
  @override
  Future<void> cancelAuthorization() async { cancellations++; }
  @override
  Future<String?> read(String id) async {
    reads++;
    if (readError != null) throw readError!;
    return reading == null ? values[id] : await reading!.future;
  }
  @override
  Future<void> write(String id, String text) async {
    writes++;
    await saving?.call(id, text);
    values[id] = text;
  }
}

Future<void> dispose(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox());
  tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
  await tester.pump();
}

void main() {
  testWidgets('lista a origem confirmada sem substituir seu horário pelo recebimento', (tester) async {
    final now = DateTime.utc(2026, 11, 20, 12);
    final source = now.subtract(const Duration(seconds: 8));
    await tester.pumpWidget(FieldApp(load: () async => sample(source, status: 'servicing'), now: () => now));
    await tester.pumpAndSettle();
    expect(find.textContaining('Em operação'), findsWidgets);
    expect(find.textContaining(source.toIso8601String()), findsOneWidget);
    await tester.pump(const Duration(seconds: 5));
    expect(find.textContaining('Leitura antiga'), findsOneWidget);
    await dispose(tester);
  });

  testWidgets('falha mantém dados, relógio de origem expira e nova leitura recupera', (tester) async {
    var now = DateTime.utc(2026, 11, 20, 12);
    var attempt = 0;
    await tester.pumpWidget(FieldApp(load: () async {
      if (++attempt == 2) throw const YardUnavailableFailure();
      return sample(now);
    }, now: () => now));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Atualizar pátio'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Sem leitura atualizada'), findsOneWidget);
    expect(find.textContaining('Livre'), findsWidgets);
    now = now.add(const Duration(seconds: 13));
    await tester.pump(const Duration(seconds: 13));
    expect(find.textContaining('Leitura antiga'), findsOneWidget);
    await tester.tap(find.byTooltip('Atualizar pátio'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Sem leitura atualizada'), findsNothing);
    expect(find.textContaining('Leitura antiga'), findsNothing);
    await dispose(tester);
  });

  testWidgets('primeira falha permite retry e perda de autorização remove dados conhecidos', (tester) async {
    var attempt = 0;
    await tester.pumpWidget(FieldApp(load: () async {
      if (++attempt == 1) throw const YardUnavailableFailure();
      if (attempt == 3) throw const YardAuthorizationFailure();
      return sample(DateTime.now());
    }));
    await tester.pumpAndSettle();
    expect(find.textContaining('Sem leitura'), findsOneWidget);
    await tester.tap(find.byTooltip('Atualizar pátio'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Livre'), findsWidgets);
    await tester.tap(find.byTooltip('Atualizar pátio'));
    await tester.pumpAndSettle();
    expect(find.textContaining('não autorizado'), findsOneWidget);
    expect(find.textContaining('Livre'), findsNothing);
    expect(find.textContaining('Leitura de origem:'), findsNothing);
    await tester.tap(find.byTooltip('Atualizar pátio'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Livre'), findsWidgets);
    await dispose(tester);
  });

  testWidgets('resposta anterior ao pause não sobrescreve leitura nova após resume', (tester) async {
    final old = Completer<YardSnapshot>();
    var calls = 0, cancelled = 0;
    await tester.pumpWidget(FieldApp(load: () {
      if (++calls == 1) return old.future;
      return Future.value(sample(DateTime.now(), name: 'Nova'));
    }, cancelRead: () { cancelled++; }));
    await tester.pump();
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pump();
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(cancelled, greaterThan(0));
    expect(find.textContaining('Nova 1'), findsOneWidget);
    old.complete(sample(DateTime.now(), name: 'Velha'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Velha'), findsNothing);
    expect(find.textContaining('Nova 1'), findsOneWidget);
    await dispose(tester);
  });

  testWidgets('snapshot regressivo não substitui a confirmação mais recente', (tester) async {
    final now = DateTime.utc(2026, 11, 20, 12);
    var calls = 0;
    await tester.pumpWidget(FieldApp(load: () async => ++calls == 1 ? sample(now, name: 'Atual') :
      sample(now.subtract(const Duration(seconds: 2)), name: 'Regressiva'), now: () => now));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Atualizar pátio'));
    await tester.pumpAndSettle();
    expect(find.textContaining('leitura inválida'), findsOneWidget);
    expect(find.textContaining('Atual 1'), findsOneWidget);
    expect(find.textContaining('Regressiva'), findsNothing);
    await dispose(tester);
  });

  for (final authorization in [NoteAuthorization.cancelled, NoteAuthorization.unavailable]) {
    testWidgets('biometria simulada $authorization nunca lê nem abre nota', (tester) async {
      final notes = FakeNotes()..authorization = authorization;
      await tester.pumpWidget(FieldApp(load: () async => sample(DateTime.now()), notes: notes));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Nota privada de D1'));
      await tester.pumpAndSettle();
      expect(notes.reads, 0);
      expect(find.text('Nota local · D1'), findsNothing);
      if (authorization == NoteAuthorization.unavailable) expect(find.textContaining('Cadastre uma biometria'), findsOneWidget);
      await dispose(tester);
    });
  }

  testWidgets('falha simulada de leitura não expõe conteúdo e libera retry', (tester) async {
    final notes = FakeNotes()..readError = StateError('vault unavailable');
    await tester.pumpWidget(FieldApp(load: () async => sample(DateTime.now()), notes: notes));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Nota privada de D1'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Não foi possível abrir'), findsOneWidget);
    expect(find.text('Nota local · D1'), findsNothing);
    notes.readError = null;
    await tester.tap(find.byTooltip('Nota privada de D1'));
    await tester.pumpAndSettle();
    expect(find.text('Nota local · D1'), findsOneWidget);
    await tester.tap(find.text('Fechar'));
    await tester.pumpAndSettle();
    await dispose(tester);
  });

  testWidgets('falha simulada de gravação mantém rascunho aberto e confirma só após retry', (tester) async {
    final notes = FakeNotes();
    notes.saving = (_, _) async { if (notes.writes == 1) throw StateError('storage failed'); };
    await tester.pumpWidget(FieldApp(load: () async => sample(DateTime.now()), notes: notes));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Nota privada de D1'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(EditableText), 'Rascunho que precisa ser preservado.');
    await tester.tap(find.text('Salvar'));
    await tester.pumpAndSettle();
    expect(find.textContaining('A gravação não foi confirmada'), findsOneWidget);
    expect(find.text('Nota salva neste aparelho.'), findsNothing);
    expect(notes.values, isEmpty);
    expect(find.text('Rascunho que precisa ser preservado.'), findsOneWidget);
    await tester.tap(find.text('Salvar'));
    await tester.pumpAndSettle();
    expect(notes.values['D1'], 'Rascunho que precisa ser preservado.');
    expect(find.text('Nota local · D1'), findsNothing);
    expect(find.text('Nota salva neste aparelho.'), findsOneWidget);
    await dispose(tester);
  });

  testWidgets('background durante autenticação simulada invalida confirmação tardia', (tester) async {
    final auth = Completer<NoteAuthorization>();
    final notes = FakeNotes()..authentication = auth;
    await tester.pumpWidget(FieldApp(load: () async => sample(DateTime.now()), notes: notes));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Nota privada de D1'));
    await tester.pump();
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pump();
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    auth.complete(NoteAuthorization.granted);
    await tester.pumpAndSettle();
    expect(notes.reads, 0);
    expect(notes.cancellations, greaterThan(0));
    expect(find.text('Nota local · D1'), findsNothing);
    await dispose(tester);
  });

  testWidgets('background durante leitura simulada não reabre nota no retorno', (tester) async {
    final reading = Completer<String?>();
    final notes = FakeNotes()..reading = reading;
    await tester.pumpWidget(FieldApp(load: () async => sample(DateTime.now()), notes: notes));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Nota privada de D1'));
    await tester.pump();
    expect(notes.reads, 1);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pump();
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    reading.complete('Conteúdo privado tardio.');
    await tester.pumpAndSettle();
    expect(find.textContaining('Conteúdo privado tardio'), findsNothing);
    expect(find.text('Nota local · D1'), findsNothing);
    await dispose(tester);
  });

  testWidgets('nota simulada visível fecha ao perder atividade e nunca reabre sozinha', (tester) async {
    final notes = FakeNotes()..values['D1'] = 'Conteúdo privado.';
    await tester.pumpWidget(FieldApp(load: () async => sample(DateTime.now()), notes: notes));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Nota privada de D1'));
    await tester.pumpAndSettle();
    expect(find.text('Conteúdo privado.'), findsOneWidget);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    await tester.pumpAndSettle();
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(find.text('Conteúdo privado.'), findsNothing);
    expect(find.text('Nota local · D1'), findsNothing);
    expect(notes.writes, 0);
    await dispose(tester);
  });
}
