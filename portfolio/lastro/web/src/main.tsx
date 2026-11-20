import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  ArrowRight,
  BookOpenText,
  Check,
  Layers2,
  Scale,
  Upload,
  X,
} from "lucide-react";
import "./style.css";
import { LedgerDesk } from "./LedgerDesk";
import { money, names, type Entry, type Status } from "./ledger";

type Session = { logged: boolean; name: string | null; workspace: string | null };
const csv = "referencia;data;recebido\nREP-1047;2026-11-16;710,00\nREP-1048;2026-11-16;1950,00";
class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly path: string, readonly code?: string) { super(message); }
}
async function api<T>(path: string, body?: unknown, workspace?: string | null): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch("/api/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", "X-Lastro-Client": "desk",
        ...(workspace ? { "X-Lastro-Workspace": workspace } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const problem = await response.json().catch(() => ({}));
      if (controller.signal.aborted) throw new Error("timeout");
      throw new ApiError(problem.detail || "A operação não pôde ser concluída.", response.status, path, problem.code);
    }
    return response.status === 204 ? (undefined as T) : await response.json();
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(body === undefined
        ? "A leitura demorou além do esperado. Tente atualizar a página."
        : "Não recebemos a confirmação a tempo. O resultado pode já ter sido gravado. Atualize a página para conferir os dados antes de tentar novamente.");
    }
    if (error instanceof ApiError) throw error;
    throw new Error(body === undefined
      ? "Não foi possível ler os dados. Confira a conexão e tente atualizar a página."
      : "A conexão foi interrompida antes da confirmação. O resultado pode já ter sido gravado. Atualize a página para conferir os dados antes de tentar novamente.");
  } finally {
    window.clearTimeout(timeout);
  }
}
function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      aria-label={title}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon" aria-label="Fechar" onClick={close}>
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function App() {
  const [rows, setRows] = useState<Entry[]>([]),
    [session, setSession] = useState<Session>({ logged: false, name: null, workspace: null });
  const [modal, setModal] = useState<"import" | "account" | null>(null),
    [content, setContent] = useState("");
  const fileRead = useRef(0);
  const [readingFile, setReadingFile] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login"),
    [user, setUser] = useState(""),
    [pass, setPass] = useState("");
  const [error, setError] = useState(""),
    [modalError, setModalError] = useState(""),
    [feedback, setFeedback] = useState(""),
    [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [expired, setExpired] = useState(false);
  const [changed, setChanged] = useState(false);
  const working = useRef(false);
  async function load(workspace = session.workspace) {
    setRows(await api<Entry[]>("book", undefined, workspace));
    setLoaded(true);
  }
  async function initialize() {
    try {
      setError("");
      setExpired(false);
      setChanged(false);
      let s = await api<Session>("session");
      if (!s.logged) {
        await api("session/demo", {});
        s = await api<Session>("session");
      }
      setSession(s);
      await load(s.workspace);
    } catch (e) {
      await handleError(e);
    }
  }
  useEffect(() => {
    void initialize();
  }, []);
  const expected = rows.reduce((s, r) => s + (r.expected || 0), 0),
    received = rows.reduce((s, r) => s + (r.received || 0), 0);
  const exception = rows.filter((r) => r.status === "disputed" || r.status === "orphan"),
    amount = exception.reduce((s, r) => s + Math.abs(r.delta), 0);
  const amountLabel = loaded ? money(amount) : "—";
  const expectedLabel = loaded ? money(expected) : "—";
  const receivedLabel = loaded ? money(received) : "—";
  function open(which: "import" | "account") {
    fileRead.current++;
    setReadingFile(false);
    setContent("");
    setPass("");
    setModalError("");
    if (!expired && !changed) setError("");
    setModal(which);
  }
  async function execute(fn: () => Promise<void>, inside = false) {
    if (working.current) return;
    working.current = true;
    setError("");
    setModalError("");
    setFeedback("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      await handleError(e, inside);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function handleError(error: unknown, inside = false) {
    if (error instanceof ApiError && error.status === 401 && error.path.startsWith("book")) {
      clearWorkspace();
      setExpired(true);
      setError("Sua sessão terminou. Entre novamente para recuperar sua mesa ou abra uma nova demonstração.");
    } else if (error instanceof ApiError && error.path.startsWith("book") &&
        (error.code === "workspace_changed" || error.code === "workspace_required")) {
      clearWorkspace();
      setChanged(true);
      setError("A conta mudou em outra aba. A operação não foi repetida. Carregue a mesa atual antes de continuar.");
      // Refresh only the identity. Loading the new ledger requires an explicit action; never retry the write.
      try {
        const current = await api<Session>("session");
        setSession(current);
        if (!current.logged) { setChanged(false); setExpired(true); }
      } catch { /* The reload button remains available. */ }
    } else (inside ? setModalError : setError)((error as Error).message);
  }
  function processBatch(e: FormEvent) {
    e.preventDefault();
    if (!content.trim() || busy || readingFile) return;
    execute(async () => {
      const r = await api<{ count: number; replay: boolean }>("book/import", { csv: content }, session.workspace);
      await load();
      setModal(null);
      setFeedback(r.replay ? "Este lote já havia sido importado." : r.count + " repasses importados.");
    }, true);
  }
  function review(reference: string, note: string) {
    void execute(async () => {
      await api("book/" + encodeURIComponent(reference) + "/review", { note }, session.workspace);
      await load();
      setFeedback("Justificativa registrada na auditoria.");
    });
  }
  function clearWorkspace() {
    fileRead.current++;
    setReadingFile(false);
    setRows([]);
    setLoaded(false);
    setContent("");
    setSession({ logged: false, name: null, workspace: null });
    setExpired(false);
    setChanged(false);
    setModal(null);
  }
  function sign(e: FormEvent) {
    e.preventDefault();
    execute(async () => {
      await api(mode, { user, password: pass });
      setPass("");
      clearWorkspace();
      await initialize();
    }, true);
  }
  return (
    <>
      <header className="mast">
        <div className="mast-in">
          <a className="brand" href="#main">
            <Layers2 strokeWidth={1.6} size={25} /> Lastro
          </a>
          <span className="divider" /> <span className="sub">Conciliação de repasses</span>
          <a href="/audit" className="audit-top">
            <BookOpenText size={16} /> Auditoria
          </a>
          <button className="account" disabled={(!loaded && !expired && !changed) || busy} onClick={() => open("account")}>
            {session.name || "Conta"}
          </button>
        </div>
      </header>
      <main id="main">
        <div className="heading">
          <div>
            <div className="folio">
              <span /> LIVRO DE NOVEMBRO / 2026
            </div>
            <h1>
              Mesa de fechamento<span>.</span>
            </h1>
          </div>
          <button className="dark" disabled={!loaded || busy} onClick={() => open("import")}>
            <Upload size={16} /> Importar extrato
          </button>
        </div>
        <div className="summary" aria-busy={!loaded}>
          <section className="exposure">
            <span className="tag">
              <Scale size={15} /> EM DIVERGÊNCIA ABERTA
            </span>
            <strong className={amountLabel.length > 12 ? "wide-amount" : undefined}>{amountLabel}</strong>
            <p>
              {loaded
                ? exception.length + (exception.length === 1 ? " referência para revisar" : " referências para revisar")
                : "Carregando lançamentos…"}
            </p>
          </section>
          <section className="balances">
            <div>
              <span>Valor previsto</span>
              <b className={expectedLabel.length > 12 ? "wide-amount" : undefined}>{expectedLabel}</b>
            </div>
            <div>
              <span>Valor recebido</span>
              <b className={receivedLabel.length > 12 ? "wide-amount" : undefined}>{receivedLabel}</b>
            </div>
            <div className="strip" role="img" aria-label={loaded
              ? "Distribuição por situação: " + Object.entries(names)
                .map(([status, label]) => `${label}: ${rows.filter(row => row.status === status).length}`).join("; ")
              : "Carregando distribuição por situação"}>
              {(Object.keys(names) as Status[]).map((s) => {
                const count = rows.filter((r) => r.status === s).length;
                return count > 0 ? (
                  <i key={s} className={s} style={{ flex: count }} title={names[s] + ": " + count} />
                ) : null;
              })}
            </div>
            <p className="strip-legend">
              {(Object.keys(names) as Status[])
                .filter((s) => rows.some((r) => r.status === s))
                .map((s) => (
                  <span key={s}>
                    <i className={s} />
                    {names[s]}
                  </span>
                ))}
            </p>
          </section>
        </div>
        {error && (
          <p className="alert" role="alert">
            {error} {!loaded && <button disabled={busy} onClick={() => void execute(initialize)}>{changed ? "Carregar mesa atual" : expired ? "Abrir nova mesa demo" : "Tentar novamente"}</button>}
          </p>
        )}
        {feedback && (
          <p role="status" className="feedback">
            <Check size={15} />
            {feedback}
          </p>
        )}
        {loaded && (
          <LedgerDesk key={session.name} rows={rows} busy={busy} onReview={review} />
        )}
      </main>
      {modal === "import" && (
        <Modal
          title="Importar extrato"
          close={() => {
            if (!busy) setModal(null);
          }}
        >
          <p>Envie um CSV separado por ponto e vírgula, com datas em AAAA-MM-DD e valores em reais.</p>
          <form onSubmit={processBatch}>
            <label>
              Arquivo CSV
              <input
                type="file" disabled={busy}
                accept=".csv,text/csv"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  const request = ++fileRead.current;
                  setContent("");
                  setModalError("");
                  setReadingFile(false);
                  if (!file) return;
                  if (file.size > 100_000) {
                    setModalError("Use um arquivo de até 100 KB.");
                    return;
                  }
                  setReadingFile(true);
                  try {
                    const value = await file.text();
                    if (request === fileRead.current) setContent(value);
                  } catch {
                    if (request === fileRead.current) setModalError("O arquivo não pôde ser lido.");
                  } finally {
                    if (request === fileRead.current) setReadingFile(false);
                  }
                }}
              />
            </label>
            <label>
              Conteúdo do lote
              <textarea
                required maxLength={100_000} value={content} rows={6} disabled={busy}
                onChange={(e) => {
                  fileRead.current++;
                  setReadingFile(false);
                  setModalError("");
                  setContent(e.target.value);
                }}
              />
            </label>
            <button type="button" className="example" disabled={busy} onClick={() => {
              fileRead.current++;
              setReadingFile(false);
              setModalError("");
              setContent(csv);
            }}>
              <ArrowDownToLine size={14} /> Usar extrato de exemplo
            </button>
            {modalError && (
              <p className="alert" role="alert">
                {modalError}
              </p>
            )}
            <button className="dark" disabled={!content || busy || readingFile}>
              Conciliar lote <ArrowRight size={16} />
            </button>
          </form>
        </Modal>
      )}
      {modal === "account" && (
        <Modal
          title="Sua mesa"
          close={() => {
            if (!busy) setModal(null);
          }}
        >
          <p>Cada conta mantém seu próprio livro. Uma nova conta começa com o lote de demonstração.</p>
          <form onSubmit={sign}>
            <div className="switch">
              {(["login", "register"] as const).map((m) => (
                <button type="button" key={m} disabled={busy} aria-pressed={mode === m} onClick={() => setMode(m)}>
                  {m === "login" ? "Entrar" : "Criar conta"}
                </button>
              ))}
            </div>
            <label>
              Usuário
              <input
                autoComplete="username"
                disabled={busy} maxLength={32}
                required
                pattern="[A-Za-z0-9._-]{3,32}"
                value={user}
                onChange={(e) => setUser(e.target.value)}
              />
            </label>
            <label>
              Senha
              <input
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                type="password"
                disabled={busy} maxLength={128}
                required
                minLength={mode === "register" ? 12 : 1}
                placeholder={mode === "register" ? "Mínimo 12 caracteres" : ""}
                value={pass}
                onChange={(e) => setPass(e.target.value)}
              />
            </label>
            {modalError && (
              <p className="alert" role="alert">
                {modalError}
              </p>
            )}
            <button className="dark" disabled={busy}>
              {mode === "login" ? "Acessar minha mesa" : "Criar minha mesa"}
            </button>
          </form>
          {session.logged && session.name !== "Mesa demo" && (
            <button
              className="example"
              disabled={busy}
              onClick={() =>
                execute(async () => {
                  await api("logout", {});
                  clearWorkspace();
                  await initialize();
                }, true)
              }
            >
              Sair da conta
            </button>
          )}
        </Modal>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
