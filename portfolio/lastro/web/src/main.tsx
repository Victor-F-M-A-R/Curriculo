import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BookOpenText,
  Check,
  CircleDot,
  Layers2,
  Scale,
  Upload,
  X,
} from "lucide-react";
import "./style.css";
type Status = "matched" | "disputed" | "reviewed" | "pending" | "orphan";
type Entry = {
  reference: string;
  merchant: string;
  expected: number | null;
  received: number | null;
  day: string;
  reason: string | null;
  delta: number;
  status: Status;
};
type Session = { logged: boolean; name: string | null };
const names: Record<Status, string> = {
  matched: "Conciliado",
  disputed: "Divergente",
  reviewed: "Revisado",
  pending: "Pendente",
  orphan: "Sem título",
};
const fmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const money = (v: number | null) => (v === null ? "—" : fmt.format(v / 100));
const csv = "referencia;data;recebido\nREP-1047;2026-11-16;710,00\nREP-1048;2026-11-16;1950,00";
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch("/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "X-Lastro-Client": "desk" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    throw new Error(problem.detail || "A operação não pôde ser concluída.");
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
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
    [session, setSession] = useState<Session>({ logged: false, name: null });
  const [selected, setSelected] = useState("REP-1043"),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState("");
  const [modal, setModal] = useState<"import" | "account" | null>(null),
    [content, setContent] = useState(""),
    [note, setNote] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login"),
    [user, setUser] = useState(""),
    [pass, setPass] = useState("");
  const [error, setError] = useState(""),
    [modalError, setModalError] = useState(""),
    [feedback, setFeedback] = useState(""),
    [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  async function load() {
    setRows(await api<Entry[]>("book"));
    setLoaded(true);
  }
  async function initialize() {
    try {
      setError("");
      let s = await api<Session>("session");
      if (!s.logged) {
        await api("session/demo", {});
        s = await api<Session>("session");
      }
      setSession(s);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void initialize();
  }, []);
  const active = rows.find((r) => r.reference === selected);
  const visible = rows.filter(
    (r) =>
      (filter === "all" || r.status === filter) &&
      (r.reference + " " + r.merchant)
        .toLocaleLowerCase("pt-BR")
        .includes(query.toLocaleLowerCase("pt-BR")),
  );
  const expected = rows.reduce((s, r) => s + (r.expected || 0), 0),
    received = rows.reduce((s, r) => s + (r.received || 0), 0);
  const exception = rows.filter((r) => r.status === "disputed" || r.status === "orphan"),
    amount = exception.reduce((s, r) => s + Math.abs(r.delta), 0);
  function choose(ref: string) {
    setSelected(ref);
    setNote("");
    setFeedback("");
    setError("");
  }
  function open(which: "import" | "account") {
    setModalError("");
    setError("");
    setModal(which);
  }
  async function execute(fn: () => Promise<void>, inside = false) {
    if (busy) return;
    setError("");
    setModalError("");
    setFeedback("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      (inside ? setModalError : setError)((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function processBatch(e: FormEvent) {
    e.preventDefault();
    execute(async () => {
      const r = await api<{ count: number; replay: boolean }>("book/import", { csv: content });
      await load();
      setModal(null);
      setFeedback(r.replay ? "Este lote já havia sido importado." : r.count + " repasses importados.");
    }, true);
  }
  function review(e: FormEvent) {
    e.preventDefault();
    if (!active) return;
    execute(async () => {
      await api("book/" + active.reference + "/review", { note });
      await load();
      setNote("");
      setFeedback("Justificativa registrada na auditoria.");
    });
  }
  function sign(e: FormEvent) {
    e.preventDefault();
    execute(async () => {
      await api(mode, { user, password: pass });
      setPass("");
      setSession(await api("session"));
      await load();
      setModal(null);
      setFeedback("Mesa de " + user + " aberta.");
    }, true);
  }
  function changeFilter(value: string) {
    setFilter(value);
    setFeedback("");
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
          <button className="account" onClick={() => open("account")}>
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
        <div className="summary">
          <section className="exposure">
            <span className="tag">
              <Scale size={15} /> EM DIVERGÊNCIA ABERTA
            </span>
            <strong>{money(amount)}</strong>
            <p>
              {exception.length}{" "}
              {exception.length === 1 ? "referência para revisar" : "referências para revisar"}
            </p>
          </section>
          <section className="balances">
            <div>
              <span>Valor previsto</span>
              <b>{money(expected)}</b>
            </div>
            <div>
              <span>Valor recebido</span>
              <b>{money(received)}</b>
            </div>
            <div className="strip" aria-label="Distribuição por situação">
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
            {error} {!loaded && <button onClick={initialize}>Tentar novamente</button>}
          </p>
        )}
        {feedback && (
          <p role="status" className="feedback">
            <Check size={15} />
            {feedback}
          </p>
        )}
        <div className="desk">
          <section className="register">
            <div className="section-head">
              <h2>Livro de repasses</h2>
              <span className="type">{rows.length} REFERÊNCIAS</span>
            </div>
            <div className="filters">
              <select
                aria-label="Filtrar por situação"
                value={filter}
                onChange={(e) => changeFilter(e.target.value)}
              >
                <option value="all">Todas as situações</option>
                {Object.entries(names).map(([s, l]) => (
                  <option key={s} value={s}>
                    {l}
                  </option>
                ))}
              </select>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar referência ou empresa"
                aria-label="Buscar referência ou empresa"
              />
            </div>
            <div className="list">
              <div className="thead">
                <span>Favorecido / ref.</span>
                <span>Recebido</span>
                <span>Situação</span>
              </div>
              {visible.map((r) => (
                <button
                  key={r.reference}
                  className={"row " + (selected === r.reference ? "selected" : "")}
                  onClick={() => choose(r.reference)}
                  aria-pressed={selected === r.reference}
                >
                  <span>
                    <b>{r.merchant}</b>
                    <small>{r.reference}</small>
                  </span>
                  <span>{money(r.received)}</span>
                  <span>
                    <i className={"badge " + r.status}>{names[r.status]}</i>
                  </span>
                </button>
              ))}
              {!visible.length && (
                <p>{loaded ? "Nenhum repasse corresponde à busca." : "Abrindo sua mesa…"}</p>
              )}
            </div>
          </section>
          <aside className="detail">
            {active && (
              <>
                <p className="type">
                  <CircleDot size={15} /> FICHA DE CONCILIAÇÃO
                </p>
                <p className="ref">{active.reference}</p>
                <h2>{active.merchant}</h2>
                <i className={"badge " + active.status}>{names[active.status]}</i>
                <dl>
                  <div>
                    <dt>Competência</dt>
                    <dd>{active.day.split("-").reverse().join("/")}</dd>
                  </div>
                  <div>
                    <dt>Previsto</dt>
                    <dd>{money(active.expected)}</dd>
                  </div>
                  <div>
                    <dt>Recebido</dt>
                    <dd>{money(active.received)}</dd>
                  </div>
                  <div>
                    <dt>Diferença</dt>
                    <dd>{money(active.delta)}</dd>
                  </div>
                </dl>
                {["disputed", "orphan"].includes(active.status) && (
                  <form onSubmit={review}>
                    <label htmlFor="note">Justificativa de revisão</label>
                    <textarea
                      id="note"
                      placeholder="Descreva o motivo da diferença…"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      minLength={8}
                      maxLength={500}
                      required
                    />
                    <button className="dark" disabled={busy || note.trim().length < 8}>
                      Registrar revisão <ArrowRight size={15} />
                    </button>
                  </form>
                )}
                {active.reason && <p className="reason">{active.reason}</p>}
                <a className="audit-link" href="/audit">
                  Abrir trilha de auditoria <ArrowUpRight size={14} />
                </a>
              </>
            )}
          </aside>
        </div>
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
                type="file"
                accept=".csv,text/csv"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    if (file.size > 100000) {
                      setModalError("Use um arquivo de até 100 KB.");
                      return;
                    }
                    setContent(await file.text());
                  }
                }}
              />
            </label>
            <label>
              Conteúdo do lote
              <textarea required value={content} onChange={(e) => setContent(e.target.value)} rows={6} />
            </label>
            <button type="button" className="example" onClick={() => setContent(csv)}>
              <ArrowDownToLine size={14} /> Usar extrato de exemplo
            </button>
            {modalError && (
              <p className="alert" role="alert">
                {modalError}
              </p>
            )}
            <button className="dark" disabled={!content || busy}>
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
                <button type="button" key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>
                  {m === "login" ? "Entrar" : "Criar conta"}
                </button>
              ))}
            </div>
            <label>
              Usuário
              <input
                autoComplete="username"
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
          {session.name !== "Mesa demo" && (
            <button
              className="example"
              onClick={() =>
                execute(async () => {
                  await api("logout", {});
                  await initialize();
                  setModal(null);
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
