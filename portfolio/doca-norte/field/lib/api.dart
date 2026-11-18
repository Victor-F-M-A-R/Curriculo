import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

class Dock {
  const Dock(this.id, this.name, this.cargo, this.status, this.carrier);
  final String id, name, cargo, status, carrier;
  factory Dock.fromJson(Map<String, dynamic> json) => Dock(
    json['id'],
    json['name'],
    json['cargo'],
    json['status'],
    json['carrier'],
  );
}

class YardApi {
  YardApi(this.base, this.client);
  final Uri base;
  final http.Client client;
  Future<List<Dock>> load() async {
    if (kReleaseMode && base.scheme != 'https') {
      throw StateError(
        'Configure um endpoint HTTPS para a versão de distribuição.',
      );
    }
    final reply = await client
        .get(base.resolve('/api/field'))
        .timeout(const Duration(seconds: 8));
    if (reply.statusCode != 200) throw StateError('Pátio indisponível.');
    final json =
        jsonDecode(utf8.decode(reply.bodyBytes)) as Map<String, dynamic>;
    if (json['stale'] == true) {
      throw StateError('Leitura desatualizada na portaria.');
    }
    return [for (final item in json['docks'] as List) Dock.fromJson(item)];
  }
}
