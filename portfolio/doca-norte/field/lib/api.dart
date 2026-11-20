import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

class Dock {
  const Dock(this.id, this.name, this.cargo, this.status, this.carrier);
  final String id, name, cargo, status, carrier;
  factory Dock.fromJson(Object? value) {
    if (value is! Map<String, dynamic>) throw const YardProtocolFailure();
    String field(String key, int max, {bool empty = false}) {
      final text = value[key];
      if (text is! String || text.length > max || (!empty && text.trim().isEmpty) ||
          RegExp(r'[\x00-\x1f\x7f]').hasMatch(text)) {
        throw const YardProtocolFailure();
      }
      return text;
    }
    final id = field('id', 2);
    final name = field('name', 55);
    final cargo = field('cargo', 40);
    final status = field('status', 10);
    final carrier = field('carrier', 50, empty: true);
    if (!RegExp(r'^D[1-6]$').hasMatch(id) ||
        !const {'free', 'booked', 'servicing'}.contains(status) ||
        ((status == 'free') != carrier.trim().isEmpty)) {
      throw const YardProtocolFailure();
    }
    return Dock(id, name, cargo, status, carrier);
  }
}

class YardSnapshot {
  YardSnapshot(List<Dock> docks, this.sampledAt) : docks = List.unmodifiable(docks);
  final List<Dock> docks;
  final DateTime sampledAt;
  static const maxAge = Duration(seconds: 12);
  static const futureTolerance = Duration(seconds: 5);

  bool isFresh(DateTime now) => now.difference(sampledAt) <= maxAge &&
      sampledAt.difference(now) <= futureTolerance;

  factory YardSnapshot.fromJson(Object? value, DateTime now) {
    if (value is! Map<String, dynamic> || value['stale'] is! bool || value['docks'] is! List) {
      throw const YardProtocolFailure();
    }
    final sampledAt = _timestamp(value['sampledAt']);
    final list = value['docks'] as List;
    if (list.length != 6) throw const YardProtocolFailure();
    final docks = list.map(Dock.fromJson).toList();
    if (docks.map((dock) => dock.id).toSet().length != 6) throw const YardProtocolFailure();
    final snapshot = YardSnapshot(docks, sampledAt);
    if (value['stale'] == true || !snapshot.isFresh(now)) throw const YardStaleFailure();
    return snapshot;
  }

  static DateTime _timestamp(Object? value) {
    if (value is! String) throw const YardProtocolFailure();
    final match = RegExp(r'^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$').firstMatch(value);
    if (match == null) throw const YardProtocolFailure();
    final year = int.parse(match[1]!);
    final month = int.parse(match[2]!);
    final day = int.parse(match[3]!);
    final hour = int.parse(match[4]!);
    final minute = int.parse(match[5]!);
    final second = int.parse(match[6]!);
    final zone = match[7]!;
    // DateTime.parse normalizes impossible dates; reject them before parsing.
    if (year < 1 || month < 1 || month > 12 || day < 1 ||
        day > DateTime.utc(year, month + 1, 0).day || hour > 23 || minute > 59 || second > 59 ||
        (zone != 'Z' && (int.parse(zone.substring(1, 3)) > 23 || int.parse(zone.substring(4)) > 59))) {
      throw const YardProtocolFailure();
    }
    return DateTime.parse(value).toUtc();
  }
}

sealed class YardFailure implements Exception {
  const YardFailure(this.message);
  final String message;
  @override
  String toString() => message;
}
class YardProtocolFailure extends YardFailure {
  const YardProtocolFailure() : super('A portaria enviou uma leitura inválida. Tente atualizar o pátio.');
}
class YardStaleFailure extends YardFailure {
  const YardStaleFailure() : super('A leitura de origem está antiga ou tem horário inválido. Atualize o pátio.');
}
class YardAuthorizationFailure extends YardFailure {
  const YardAuthorizationFailure() : super('Acesso à portaria não autorizado. Os dados anteriores foram ocultados.');
}
class YardUnavailableFailure extends YardFailure {
  const YardUnavailableFailure() : super('Sem leitura atualizada da portaria. Tente atualizar o pátio.');
}
class YardCancelledFailure extends YardFailure {
  const YardCancelledFailure() : super('Leitura cancelada.');
}

class YardApi {
  YardApi(this.base, this.client, {DateTime Function()? now, this.timeout = const Duration(seconds: 8)})
      : now = now ?? DateTime.now;
  final Uri base;
  final http.Client client;
  final DateTime Function() now;
  final Duration timeout;
  static const maxBodyBytes = 64 * 1024;
  Completer<void>? _abort;

  void cancel() {
    final abort = _abort;
    if (abort != null && !abort.isCompleted) abort.complete();
    _abort = null;
  }

  Future<YardSnapshot> load() async {
    if (kReleaseMode && base.scheme != 'https') {
      throw StateError(
        'Configure um endpoint HTTPS para a versão de distribuição.',
      );
    }
    cancel();
    final abort = Completer<void>();
    _abort = abort;
    final request = http.AbortableRequest('GET', base.resolve('/api/field'), abortTrigger: abort.future)
      ..followRedirects = false
      ..headers['Accept'] = 'application/json';
    try {
      return await _read(request, abort).timeout(timeout, onTimeout: () {
        if (!abort.isCompleted) abort.complete();
        throw const YardUnavailableFailure();
      });
    } on http.RequestAbortedException {
      throw const YardCancelledFailure();
    } on FormatException {
      throw const YardProtocolFailure();
    } on http.ClientException {
      throw const YardUnavailableFailure();
    } finally {
      if (!abort.isCompleted) abort.complete();
      if (identical(_abort, abort)) _abort = null;
    }
  }

  Future<YardSnapshot> _read(http.AbortableRequest request, Completer<void> abort) async {
    final reply = await client.send(request);
    if (abort.isCompleted) throw const YardCancelledFailure();
    if (reply.statusCode == 401 || reply.statusCode == 403) throw const YardAuthorizationFailure();
    if (reply.statusCode != 200) throw const YardUnavailableFailure();
    final length = int.tryParse(reply.headers['content-length'] ?? '');
    if (length != null && (length < 0 || length > maxBodyBytes)) throw const YardProtocolFailure();
    final contentType = reply.headers['content-type'];
    if (contentType != null && contentType.split(';').first.trim().toLowerCase() != 'application/json') {
      throw const YardProtocolFailure();
    }
    final bytes = BytesBuilder(copy: false);
    await for (final chunk in reply.stream) {
      if (abort.isCompleted) throw const YardCancelledFailure();
      if (bytes.length + chunk.length > maxBodyBytes) throw const YardProtocolFailure();
      bytes.add(chunk);
    }
    return YardSnapshot.fromJson(jsonDecode(utf8.decode(bytes.takeBytes())), now());
  }
}
