import 'package:doca_field/api.dart';
import 'package:doca_field/main.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  testWidgets('lista o estado recebido do pátio', (tester) async {
    await tester.pumpWidget(
      FieldApp(
        load: () async => [
          const Dock('D2', 'Doca 02', 'Fria', 'servicing', 'Linha Azul'),
        ],
      ),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('Em operação'), findsOneWidget);
  });
  testWidgets('sinaliza falha e permite tentar de novo', (tester) async {
    var attempt = 0;
    await tester.pumpWidget(
      FieldApp(
        load: () async {
          if (attempt++ == 0) throw StateError('offline');
          return [const Dock('D1', 'Doca 01', 'Seca', 'free', '')];
        },
      ),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('Sem leitura'), findsOneWidget);
    await tester.tap(find.byTooltip('Atualizar pátio'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Livre'), findsOneWidget);
  });
  test('cliente interpreta o contrato REST da portaria', () async {
    final client = MockClient((req) async {
      expect(req.url.path, '/api/field');
      return http.Response(
        '{"docks":[{"id":"D1","name":"Doca 01","cargo":"Seca","status":"free","carrier":""}]}',
        200,
      );
    });
    expect(
      (await YardApi(
        Uri.parse('https://yard.example'),
        client,
      ).load()).single.status,
      'free',
    );
  });
}
