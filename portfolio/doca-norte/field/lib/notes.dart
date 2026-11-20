import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:local_auth/local_auth.dart';

enum NoteAuthorization { granted, cancelled, unavailable }

abstract interface class NotesBoundary {
  bool get supported;
  Future<NoteAuthorization> authorize(String dockName);
  Future<void> cancelAuthorization();
  Future<String?> read(String dockId);
  Future<void> write(String dockId, String text);
}

class NativeNotesBoundary implements NotesBoundary {
  NativeNotesBoundary({LocalAuthentication? authentication, FlutterSecureStorage? storage, this.keyPrefix = 'note-'})
      : _authentication = authentication ?? LocalAuthentication(),
        _storage = storage ?? const FlutterSecureStorage();
  final LocalAuthentication _authentication;
  final FlutterSecureStorage _storage;
  final String keyPrefix;
  int _authorizationEpoch = 0;

  @override
  bool get supported => !kIsWeb && (defaultTargetPlatform == TargetPlatform.android || defaultTargetPlatform == TargetPlatform.iOS);

  @override
  Future<NoteAuthorization> authorize(String dockName) async {
    final epoch = ++_authorizationEpoch;
    if (!supported) return NoteAuthorization.unavailable;
    final capable = await _authentication.canCheckBiometrics;
    if (epoch != _authorizationEpoch) return NoteAuthorization.cancelled;
    if (!capable) return NoteAuthorization.unavailable;
    final enrolled = await _authentication.getAvailableBiometrics();
    if (epoch != _authorizationEpoch) return NoteAuthorization.cancelled;
    if (enrolled.isEmpty) return NoteAuthorization.unavailable;
    final granted = await _authentication.authenticate(
      localizedReason: 'Abrir a nota local de $dockName', biometricOnly: true,
      persistAcrossBackgrounding: false,
    );
    return granted && epoch == _authorizationEpoch ? NoteAuthorization.granted : NoteAuthorization.cancelled;
  }

  @override
  Future<void> cancelAuthorization() async {
    _authorizationEpoch++;
    await _authentication.stopAuthentication();
  }
  @override
  Future<String?> read(String dockId) => _storage.read(key: '$keyPrefix$dockId');
  @override
  Future<void> write(String dockId, String text) => _storage.write(key: '$keyPrefix$dockId', value: text);
}
