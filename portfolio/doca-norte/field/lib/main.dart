import 'dart:async';

import 'package:material_ui/material_ui.dart';
import 'package:http/http.dart' as http;

import 'api.dart';
import 'notes.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  const endpoint = String.fromEnvironment('YARD_API', defaultValue: 'http://10.0.2.2:8085');
  final api = YardApi(Uri.parse(endpoint), http.Client());
  runApp(FieldApp(load: api.load, cancelRead: api.cancel));
}

class FieldApp extends StatelessWidget {
  const FieldApp({super.key, required this.load, this.cancelRead, this.notes, this.now});
  final Future<YardSnapshot> Function() load;
  final void Function()? cancelRead;
  final NotesBoundary? notes;
  final DateTime Function()? now;

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Doca Norte · Campo',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xff385e4d)),
      scaffoldBackgroundColor: const Color(0xfff3f0e7),
    ),
    home: FieldScreen(load: load, cancelRead: cancelRead, notes: notes, now: now),
  );
}

class FieldScreen extends StatefulWidget {
  const FieldScreen({super.key, required this.load, this.cancelRead, this.notes, this.now});
  final Future<YardSnapshot> Function() load;
  final void Function()? cancelRead;
  final NotesBoundary? notes;
  final DateTime Function()? now;
  @override
  State<FieldScreen> createState() => _FieldScreenState();
}

class _FieldScreenState extends State<FieldScreen> with WidgetsBindingObserver {
  List<Dock> docks = [];
  String? error;
  DateTime? sampledAt;
  Timer? readExpiry;
  bool expired = false, busy = false, readingNote = false;
  bool foreground = true, active = true, readingPrivateNote = false;
  int readEpoch = 0, backgroundEpoch = 0;
  late final NotesBoundary notes = widget.notes ?? NativeNotesBoundary();
  DialogRoute<bool>? noteRoute;
  Future<void> closingAuthorization = Future.value();
  DateTime get now => widget.now?.call() ?? DateTime.now();
  static const labels = {'free': 'Livre', 'booked': 'Reservada', 'servicing': 'Em operação'};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    refresh();
  }

  @override
  void dispose() {
    readEpoch++;
    backgroundEpoch++;
    readExpiry?.cancel();
    widget.cancelRead?.call();
    unawaited(notes.cancelAuthorization().catchError((Object _) {}));
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  void closePrivateNote() {
    backgroundEpoch++;
    readingNote = false;
    readingPrivateNote = false;
    final route = noteRoute;
    noteRoute = null;
    if (route != null && route.isActive) route.navigator?.removeRoute(route);
    closingAuthorization = notes.cancelAuthorization().catchError((Object _) {});
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused || state == AppLifecycleState.hidden || state == AppLifecycleState.detached) {
      foreground = false;
      active = false;
      readEpoch++;
      widget.cancelRead?.call();
      readExpiry?.cancel();
      closePrivateNote();
      if (mounted) setState(() { busy = false; expired = sampledAt != null; });
    } else if (state == AppLifecycleState.inactive) {
      active = false;
      // Authentication may present system UI; already authorized content must close.
      if (noteRoute != null || readingPrivateNote) {
        closePrivateNote();
        if (mounted) setState(() {});
      }
    } else if (state == AppLifecycleState.resumed) {
      foreground = true;
      active = true;
      refresh();
    }
  }

  Future<void> refresh() async {
    if (busy || !foreground) return;
    final request = ++readEpoch;
    setState(() => busy = true);
    try {
      final data = await widget.load();
      if (!mounted || !foreground || request != readEpoch) return;
      if (!data.isFresh(now)) throw const YardStaleFailure();
      if (sampledAt != null && data.sampledAt.isBefore(sampledAt!)) throw const YardProtocolFailure();
      setState(() {
        docks = data.docks;
        sampledAt = data.sampledAt;
        expired = false;
        error = null;
      });
      readExpiry?.cancel();
      final remaining = YardSnapshot.maxAge - now.difference(data.sampledAt);
      readExpiry = Timer(remaining.isNegative ? Duration.zero : remaining, () {
        if (mounted && sampledAt == data.sampledAt) setState(() => expired = true);
      });
    } catch (failure) {
      if (!mounted || request != readEpoch || !foreground) return;
      if (failure is YardAuthorizationFailure) {
        readExpiry?.cancel();
        closePrivateNote();
        docks = [];
        sampledAt = null;
        expired = false;
      }
      if (failure is! YardCancelledFailure) {
        setState(() => error = failure is YardFailure ? failure.message : const YardUnavailableFailure().message);
      }
    } finally {
      if (mounted && request == readEpoch) setState(() => busy = false);
    }
  }

  void message(String text) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  Future<void> note(Dock dock) async {
    if (readingNote || !notes.supported || !foreground || !active) return;
    final epoch = backgroundEpoch;
    bool current() => mounted && foreground && epoch == backgroundEpoch;
    setState(() => readingNote = true);
    try {
      await closingAuthorization;
      if (!current()) return;
      final authorization = await notes.authorize(dock.name);
      if (!current() || !active) return;
      if (authorization == NoteAuthorization.cancelled) return;
      if (authorization == NoteAuthorization.unavailable) {
        message('Cadastre uma biometria no aparelho para abrir notas privadas.');
        return;
      }
      readingPrivateNote = true;
      final previous = await notes.read(dock.id) ?? '';
      if (!current()) return;
      readingPrivateNote = false;
      if (previous.length > 300) throw StateError('Nota local inválida.');
      final route = DialogRoute<bool>(
        context: context,
        builder: (_) => NoteDialog(dock: dock, initial: previous, save: (text) async {
          if (!current()) throw StateError('Nota fechada.');
          await notes.write(dock.id, text);
          if (!current()) throw StateError('Nota fechada.');
        }),
      );
      noteRoute = route;
      final saved = await Navigator.of(context, rootNavigator: true).push(route);
      if (identical(noteRoute, route)) noteRoute = null;
      if (saved == true && current()) message('Nota salva neste aparelho.');
    } catch (_) {
      if (current()) message('Não foi possível abrir a nota com biometria e armazenamento seguro. Tente novamente.');
    } finally {
      if (current()) setState(() { readingNote = false; readingPrivateNote = false; });
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      backgroundColor: const Color(0xff19352a), foregroundColor: Colors.white,
      title: const Text('Doca Norte / Campo'),
      actions: [IconButton(tooltip: 'Atualizar pátio', icon: const Icon(Icons.refresh), onPressed: busy ? null : refresh)],
    ),
    body: SafeArea(
      child: RefreshIndicator(
        onRefresh: refresh,
        child: ListView(
          padding: const EdgeInsets.all(20), physics: const AlwaysScrollableScrollPhysics(),
          children: [
            const Text('PASSAGEM DE TURNO', style: TextStyle(fontSize: 12, letterSpacing: 2)),
            const SizedBox(height: 8),
            Text('Docas do pátio', style: Theme.of(context).textTheme.headlineLarge),
            if (sampledAt case final time?) Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text('Leitura de origem: ${time.toIso8601String()} (UTC)'),
            ),
            if (expired) const Text('Leitura antiga. Atualize antes de orientar o pátio.'),
            if (busy) const LinearProgressIndicator(),
            if (error != null) Padding(
              padding: const EdgeInsets.symmetric(vertical: 14),
              child: Semantics(liveRegion: true, child: Text(error!)),
            ),
            for (final dock in docks) Card(
              elevation: 0, color: const Color(0xfffffcf3),
              child: ListTile(
                title: Text('${dock.id}  ·  ${dock.name}'),
                subtitle: Text('${dock.cargo} · ${labels[dock.status]}\n${dock.carrier.isEmpty ? "Sem transportadora" : dock.carrier}'),
                isThreeLine: true,
                trailing: notes.supported ? IconButton(
                  tooltip: 'Nota privada de ${dock.id}', icon: const Icon(Icons.fingerprint),
                  onPressed: readingNote ? null : () => note(dock),
                ) : null,
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

class NoteDialog extends StatefulWidget {
  const NoteDialog({super.key, required this.dock, required this.initial, required this.save});
  final Dock dock;
  final String initial;
  final Future<void> Function(String) save;
  @override
  State<NoteDialog> createState() => _NoteDialogState();
}

class _NoteDialogState extends State<NoteDialog> {
  late final controller = TextEditingController(text: widget.initial);
  bool saving = false;
  String? error;
  @override
  void dispose() { controller.dispose(); super.dispose(); }

  Future<void> save() async {
    if (saving) return;
    setState(() { saving = true; error = null; });
    try {
      await widget.save(controller.text.trim());
      if (mounted) Navigator.pop(context, true);
    } catch (_) {
      if (mounted) setState(() => error = 'A gravação não foi confirmada. Seu texto continua aqui; tente salvar novamente.');
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !saving,
    child: AlertDialog(
      title: Text('Nota local · ${widget.dock.id}'),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(controller: controller, enabled: !saving, maxLength: 300, maxLines: 3,
          decoration: const InputDecoration(labelText: 'Passagem de turno')),
        if (error != null) Semantics(liveRegion: true, child: Text(error!)),
      ]),
      actions: [
        TextButton(onPressed: saving ? null : () => Navigator.pop(context), child: const Text('Fechar')),
        FilledButton(onPressed: saving ? null : save, child: Text(saving ? 'Salvando…' : 'Salvar')),
      ],
    ),
  );
}
