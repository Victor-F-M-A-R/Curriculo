import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:material_ui/material_ui.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:local_auth/local_auth.dart';
import 'package:http/http.dart' as http;

import 'api.dart';

void main() {
  const endpoint = String.fromEnvironment(
    'YARD_API',
    defaultValue: 'http://10.0.2.2:8085',
  );
  final api = YardApi(Uri.parse(endpoint), http.Client());
  runApp(FieldApp(load: api.load));
}

class FieldApp extends StatelessWidget {
  const FieldApp({super.key, required this.load});
  final Future<List<Dock>> Function() load;
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Doca Norte · Campo',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xff385e4d)),
      scaffoldBackgroundColor: const Color(0xfff3f0e7),
    ),
    home: FieldScreen(load: load),
  );
}

class FieldScreen extends StatefulWidget {
  const FieldScreen({super.key, required this.load});
  final Future<List<Dock>> Function() load;
  @override
  State<FieldScreen> createState() => _FieldScreenState();
}

class _FieldScreenState extends State<FieldScreen> with WidgetsBindingObserver {
  List<Dock> docks = [];
  String? error;
  DateTime? confirmedAt;
  Timer? readExpiry;
  bool expired = false;
  bool busy = false, readingNote = false, noteVisible = false;
  int backgroundEpoch = 0;
  static const labels = {
    'free': 'Livre',
    'booked': 'Reservada',
    'servicing': 'Em operação',
  };
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    refresh();
  }

  @override
  void dispose() {
    readExpiry?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      final last = confirmedAt;
      if (last == null || DateTime.now().difference(last) > const Duration(seconds: 20)) {
        refresh();
      }
    }
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.hidden) {
      backgroundEpoch++;
      if (noteVisible && mounted) {
        Navigator.of(context, rootNavigator: true).pop();
      }
    }
  }

  Future<void> refresh() async {
    if (busy) return;
    setState(() {
      busy = true;
    });
    try {
      final data = await widget.load();
      if (!mounted) return;
      setState(() {
        docks = data;
        confirmedAt = DateTime.now();
        expired = false;
        error = null;
      });
      readExpiry?.cancel();
      readExpiry = Timer(const Duration(seconds: 20), () {
        if (mounted) setState(() => expired = true);
      });
    } catch (_) {
      if (mounted) {
        setState(
          () => error = 'Sem leitura atualizada da portaria. Tente atualizar o pátio.',
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  bool get supportsNotes =>
      !kIsWeb &&
      (defaultTargetPlatform == TargetPlatform.android ||
          defaultTargetPlatform == TargetPlatform.iOS);
  Future<void> note(Dock dock) async {
    if (readingNote || !supportsNotes) return;
    setState(() => readingNote = true);
    const vault = FlutterSecureStorage();
    try {
      final epoch = backgroundEpoch;
      final auth = LocalAuthentication();
      if (!await auth.canCheckBiometrics ||
          (await auth.getAvailableBiometrics()).isEmpty) {
        throw StateError('Biometria indisponível');
      }
      if (!await auth.authenticate(
        localizedReason: 'Abrir a nota local de ${dock.name}',
        biometricOnly: true,
      )) {
        return;
      }
      if (!mounted || epoch != backgroundEpoch) return;
      final previous = await vault.read(key: 'note-${dock.id}') ?? '';
      if (!mounted || epoch != backgroundEpoch) return;
      noteVisible = true;
      final saved = await showDialog<String>(
        context: context,
        builder: (_) => NoteDialog(dock: dock, initial: previous),
      );
      noteVisible = false;
      if (saved != null && epoch == backgroundEpoch) {
        await vault.write(key: 'note-${dock.id}', value: saved);
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'A nota requer biometria cadastrada e armazenamento seguro no aparelho.',
            ),
          ),
        );
      }
    } finally {
      noteVisible = false;
      if (mounted) setState(() => readingNote = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      backgroundColor: const Color(0xff19352a),
      foregroundColor: Colors.white,
      title: const Text('Doca Norte / Campo'),
      actions: [
        IconButton(
          tooltip: 'Atualizar pátio',
          icon: const Icon(Icons.refresh),
          onPressed: busy ? null : refresh,
        ),
      ],
    ),
    body: SafeArea(
      child: RefreshIndicator(
        onRefresh: refresh,
        child: ListView(
          padding: const EdgeInsets.all(20),
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            const Text(
              'PASSAGEM DE TURNO',
              style: TextStyle(fontSize: 12, letterSpacing: 2),
            ),
            const SizedBox(height: 8),
            Text(
              'Docas do pátio',
              style: Theme.of(context).textTheme.headlineLarge,
            ),
            if (confirmedAt case final time?)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  'Leitura recebida às ${MaterialLocalizations.of(context).formatTimeOfDay(TimeOfDay.fromDateTime(time), alwaysUse24HourFormat: true)}',
                ),
              ),
            if (expired && error == null)
              const Text('Leitura antiga. Atualize antes de orientar o pátio.'),
            if (busy) const LinearProgressIndicator(),
            if (error != null)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 14),
                child: Text(error!),
              ),
            for (final dock in docks)
              Card(
                elevation: 0,
                color: const Color(0xfffffcf3),
                child: ListTile(
                  title: Text('${dock.id}  ·  ${dock.name}'),
                  subtitle: Text(
                    '${dock.cargo} · ${labels[dock.status] ?? dock.status}\n${dock.carrier.isEmpty ? "Sem transportadora" : dock.carrier}',
                  ),
                  isThreeLine: true,
                  trailing: supportsNotes
                      ? IconButton(
                          tooltip: 'Nota privada de ${dock.id}',
                          icon: const Icon(Icons.fingerprint),
                          onPressed: readingNote ? null : () => note(dock),
                        )
                      : null,
                ),
              ),
          ],
        ),
      ),
    ),
  );
}

class NoteDialog extends StatefulWidget {
  const NoteDialog({super.key, required this.dock, required this.initial});
  final Dock dock;
  final String initial;
  @override
  State<NoteDialog> createState() => _NoteDialogState();
}

class _NoteDialogState extends State<NoteDialog> {
  late final controller = TextEditingController(text: widget.initial);
  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text('Nota local · ${widget.dock.id}'),
    content: TextField(
      controller: controller,
      maxLength: 300,
      maxLines: 3,
      decoration: const InputDecoration(labelText: 'Passagem de turno'),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Fechar'),
      ),
      FilledButton(
        onPressed: () => Navigator.pop(context, controller.text.trim()),
        child: const Text('Salvar'),
      ),
    ],
  );
}
