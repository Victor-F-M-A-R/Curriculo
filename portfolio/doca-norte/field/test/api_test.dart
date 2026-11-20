import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:doca_field/api.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

final instant = DateTime.utc(2026, 11, 20, 12);
Map<String, dynamic> board({DateTime? at}) => {
  'sampledAt': (at ?? instant).toIso8601String(), 'stale': false,
  'docks': List.generate(6, (i) => <String, dynamic>{
    'id': 'D${i + 1}', 'name': 'Doca ${i + 1}', 'cargo': 'Seca', 'status': 'free', 'carrier': '',
  }),
};

YardApi apiFor(Object? body, {int status = 200}) => YardApi(
  Uri.parse('https://yard.example'),
  MockClient((request) async {
    expect(request.url.path, '/api/field');
    expect(request.headers['Accept'], 'application/json');
    return http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});
  }), now: () => instant,
);

class WaitingClient extends http.BaseClient {
  final aborted = Completer<void>();
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    expect(request, isA<http.AbortableRequest>());
    await (request as http.AbortableRequest).abortTrigger;
    aborted.complete();
    throw http.RequestAbortedException(request.url);
  }
}

class BodyClient extends http.BaseClient {
  BodyClient(this.chunks, {this.headers = const {}});
  final List<List<int>> chunks;
  final Map<String, String> headers;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async =>
      http.StreamedResponse(Stream.fromIterable(chunks), 200, headers: headers);
}

// Instrumentation only: requests and cancellation still run through http.Client's real socket transport.
class ObservedHttpClient extends http.BaseClient {
  final inner = http.Client();
  final firstBodyChunk = Completer<void>();
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final response = await inner.send(request);
    return http.StreamedResponse(response.stream.map((chunk) {
      if (!firstBodyChunk.isCompleted) firstBodyChunk.complete();
      return chunk;
    }), response.statusCode, headers: response.headers, contentLength: response.contentLength,
      request: response.request, isRedirect: response.isRedirect, persistentConnection: response.persistentConnection);
  }
  @override
  void close() => inner.close();
}

// Real loopback HTTP with a body that starts but never finishes. Detaching the
// socket lets the test observe the peer closing it, rather than only an abort flag.
class StalledLoopback {
  StalledLoopback._(this.server) {
    server.listen((request) { unawaited(_respond(request)); });
  }
  final HttpServer server;
  final sent = Completer<void>();
  final peerClosed = Completer<void>();
  final sockets = <Socket>[];
  Uri get base => Uri.parse('http://127.0.0.1:${server.port}');

  static Future<StalledLoopback> start() async =>
      StalledLoopback._(await HttpServer.bind(InternetAddress.loopbackIPv4, 0));

  Future<void> _respond(HttpRequest request) async {
    try {
      if (request.method != 'GET' || request.uri.path != '/api/field') {
        throw StateError('Unexpected request to the isolated fixture.');
      }
      final socket = await request.response.detachSocket(writeHeaders: false);
      sockets.add(socket);
      unawaited(socket.done.then<void>((_) {}, onError: (Object _, StackTrace __) {}));
      void closed() { if (!peerClosed.isCompleted) peerClosed.complete(); }
      socket.listen((_) {}, onDone: closed, onError: (Object _) { closed(); });
      final prefix = utf8.encode('{"sampledAt":');
      socket.add(ascii.encode('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n'
          'Transfer-Encoding: chunked\r\n\r\n${prefix.length.toRadixString(16)}\r\n'));
      socket.add(prefix);
      socket.add(ascii.encode('\r\n'));
      await socket.flush();
      sent.complete();
      // No terminating chunk and no server close: completion must come from the client.
    } catch (error, stack) {
      if (!sent.isCompleted) sent.completeError(error, stack);
    }
  }

  Future<void> close() async {
    for (final socket in sockets) { socket.destroy(); }
    await server.close(force: true);
  }
}

void main() {
  test('preserva instante de origem e aceita fuso explícito equivalente', () async {
    final value = board()..['sampledAt'] = '2026-11-20T09:00:00-03:00';
    final sample = await apiFor(value).load();
    expect(sample.sampledAt, instant);
    expect(sample.docks.length, 6);
    expect(sample.docks.first.status, 'free');
  });

  test('recusa ausência/tipo errado de stale, horário, docas ou esquema', () async {
    final missingStale = board()..remove('stale');
    final missingTime = board()..remove('sampledAt');
    for (final value in [null, [], {}, missingStale, missingTime,
      board()..['stale'] = 'false', board()..['docks'] = {}, board()..['docks'] = [],
      board()..['sampledAt'] = 42]) {
      await expectLater(apiFor(value).load(), throwsA(isA<YardProtocolFailure>()));
    }
  });

  test('valida IDs únicos, seis posições, tipos, estado e transportadora', () async {
    for (final patch in [
      {'id': 'D0'}, {'id': 'D2'}, {'name': 12}, {'name': ''}, {'cargo': ''},
      {'status': 'unknown'}, {'status': 'booked', 'carrier': ''}, {'carrier': 'Linha Azul'},
      {'carrier': null}, {'name': 'x' * 56}, {'cargo': 'x' * 41}, {'name': 'Linha\nNova'},
    ]) {
      final value = board();
      (value['docks'] as List)[0].addAll(patch);
      await expectLater(apiFor(value).load(), throwsA(isA<YardProtocolFailure>()));
    }
    final missing = board();
    (missing['docks'] as List).removeLast();
    await expectLater(apiFor(missing).load(), throwsA(isA<YardProtocolFailure>()));
  });

  test('ISO estrito não normaliza calendário impossível nem omite timezone', () async {
    for (final stamp in ['2026-02-30T12:00:00Z', '2026-11-20T24:00:00Z',
      '2026-11-20T12:00:00', '2026-11-20', '2026-11-20T12:00:60Z',
      '2026-11-20T12:00:00+24:00', '2026-11-20T12:00:00+00:99', 'n/a']) {
      await expectLater(apiFor(board()..['sampledAt'] = stamp).load(), throwsA(isA<YardProtocolFailure>()));
    }
  });

  test('limiares de idade e futuro são medidos desde a origem', () async {
    expect((await apiFor(board(at: instant.subtract(const Duration(seconds: 12)))).load()).sampledAt,
      instant.subtract(const Duration(seconds: 12)));
    await apiFor(board(at: instant.add(const Duration(seconds: 5)))).load();
    for (final at in [instant.subtract(const Duration(seconds: 12, microseconds: 1)),
      instant.add(const Duration(seconds: 5, microseconds: 1))]) {
      await expectLater(apiFor(board(at: at)).load(), throwsA(isA<YardStaleFailure>()));
    }
    await expectLater(apiFor(board()..['stale'] = true).load(), throwsA(isA<YardStaleFailure>()));
  });

  test('401 e 403 têm erro de autorização distinto de indisponibilidade', () async {
    for (final status in [401, 403]) {
      await expectLater(apiFor({}, status: status).load(), throwsA(isA<YardAuthorizationFailure>()));
    }
    for (final status in [302, 500, 503]) {
      await expectLater(apiFor({}, status: status).load(), throwsA(isA<YardUnavailableFailure>()));
    }
  });

  test('prazo total sinaliza abortTrigger ao cliente simulado', () async {
    final client = WaitingClient();
    final api = YardApi(Uri.parse('https://yard.example'), client, timeout: const Duration(milliseconds: 20));
    await expectLater(api.load(), throwsA(isA<YardUnavailableFailure>()));
    await client.aborted.future;
  });

  test('cancelamento explícito aborta a leitura em andamento', () async {
    final client = WaitingClient();
    final api = YardApi(Uri.parse('https://yard.example'), client);
    final reading = api.load();
    api.cancel();
    await expectLater(reading, throwsA(isA<YardCancelledFailure>()));
    expect(client.aborted.isCompleted, isTrue);
  });

  test('limita bytes recebidos mesmo sem Content-Length ou com valor inválido', () async {
    for (final headers in <Map<String, String>>[{}, {'content-length': 'not-a-number'}, {'content-length': '1'}]) {
      final client = BodyClient([List.filled(33000, 32), List.filled(33000, 32)], headers: headers);
      await expectLater(YardApi(Uri.parse('https://yard.example'), client).load(), throwsA(isA<YardProtocolFailure>()));
    }
    final declared = BodyClient([], headers: {'content-length': '999999'});
    await expectLater(YardApi(Uri.parse('https://yard.example'), declared).load(), throwsA(isA<YardProtocolFailure>()));
  });

  test('JSON e UTF-8 malformados nunca viram uma lista parcial', () async {
    for (final bytes in [[123], [0xff, 0xfe]]) {
      await expectLater(YardApi(Uri.parse('https://yard.example'), BodyClient([bytes])).load(),
        throwsA(isA<YardProtocolFailure>()));
    }
  });

  test('HTTP loopback: prazo total interrompe corpo lento e fecha socket antes do cleanup', () async {
    final server = await StalledLoopback.start();
    final client = ObservedHttpClient();
    addTearDown(() async { client.close(); await server.close(); });
    final api = YardApi(server.base, client, timeout: const Duration(seconds: 2));
    final result = expectLater(api.load(), throwsA(isA<YardUnavailableFailure>()));
    await server.sent.future.timeout(const Duration(seconds: 3));
    await client.firstBodyChunk.future.timeout(const Duration(seconds: 3));
    await result;
    await server.peerClosed.future.timeout(const Duration(seconds: 3));
  });

  test('HTTP loopback: cancelamento explícito encerra corpo em streaming antes do cleanup', () async {
    final server = await StalledLoopback.start();
    final client = ObservedHttpClient();
    addTearDown(() async { client.close(); await server.close(); });
    final api = YardApi(server.base, client);
    final result = expectLater(api.load(), throwsA(isA<YardCancelledFailure>()));
    await server.sent.future.timeout(const Duration(seconds: 3));
    await client.firstBodyChunk.future.timeout(const Duration(seconds: 3));
    api.cancel();
    await result;
    await server.peerClosed.future.timeout(const Duration(seconds: 3));
  });

  test('HTTP loopback: JSON válido acima de 64 KiB é recusado mesmo em chunks', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final client = http.Client();
    addTearDown(() async { client.close(); await server.close(force: true); });
    final bytes = [...List<int>.filled(66000, 32), ...utf8.encode(jsonEncode(board()))];
    server.listen((request) async {
      final response = request.response;
      response.headers.contentType = ContentType.json;
      response.bufferOutput = false;
      unawaited(response.done.then<void>((_) {}, onError: (Object _, StackTrace __) {}));
      try {
        response.add(bytes.sublist(0, 33000));
        await response.flush();
        response.add(bytes.sublist(33000));
        await response.close();
      } on IOException {
        // The bounded client may close the connection as soon as it crosses its limit.
      }
    });
    final base = Uri.parse('http://127.0.0.1:${server.port}');
    // Positive control: the oversized response really is otherwise valid input.
    final unrestricted = await client.get(base.resolve('/api/field'));
    expect(unrestricted.statusCode, 200);
    expect(unrestricted.headers['transfer-encoding'], 'chunked');
    expect(unrestricted.bodyBytes.length, greaterThan(YardApi.maxBodyBytes));
    expect(YardSnapshot.fromJson(jsonDecode(unrestricted.body), instant).docks.length, 6);
    await expectLater(YardApi(base, client, now: () => instant).load(), throwsA(isA<YardProtocolFailure>()));
  });

  test('HTTP loopback: servidor encerrado produz falha recuperável de transporte', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final base = Uri.parse('http://127.0.0.1:${server.port}');
    await server.close(force: true);
    final client = http.Client();
    addTearDown(client.close);
    await expectLater(YardApi(base, client, timeout: const Duration(seconds: 2)).load(),
      throwsA(isA<YardUnavailableFailure>()));
  });
}
