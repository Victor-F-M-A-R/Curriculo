import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  CornerDownLeft,
  FileText,
  Layers3,
  RadioTower,
  Search,
} from "lucide-react";
import "./style.css";

type Section = { id: string; heading: string; text: string };
type Manual = {
  id: string;
  title: string;
  category: string;
  owner: string;
  revision: string;
  sections: Section[];
};
type Stage = { name: string; ms: number; detail: string };
type Run = {
  id: string;
  question: string;
  state: "answered" | "abstained";
  answer: string;
  mode: string;
  delivery: string | null;
  evidence: { id: string; title: string; heading: string; revision: string; quote: string }[];
  trace: Stage[];
};
type Visit = { id: string; question: string; created: number };
type Tab = "Consulta" | "Acervo" | "Histórico";
const examples = [
  "Quantas falhas na WAN Ipê fazem a Cedro assumir?",
  "Em qual percentual do toner o almoxarifado deve ser acionado?",
  "Qual é o preço mensal do contrato da WAN Cedro?",
];
const deliveries: Record<string, string> = {
  local: "Na fila local",
  queued: "Aguardando n8n",
  sending: "Enviando ao n8n",
  delivered: "Recebida pelo n8n",
  failed: "Entrega falhou",
};
async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch("/api/" + path, {
    ...options,
    headers: { "X-Farol-Client": "desk", "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error("A consulta falhou. Tente novamente.");
  return res.status === 204 ? (undefined as T) : res.json();
}
function App() {
  const [tab, setTab] = useState<Tab>("Consulta"),
    [docs, setDocs] = useState<Manual[]>([]),
    [history, setHistory] = useState<Visit[]>([]);
  const [question, setQuestion] = useState(""),
    [run, setRun] = useState<Run | null>(null),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  const [error, setError] = useState(""),
    [filter, setFilter] = useState(""),
    [openDoc, setOpenDoc] = useState(""),
    [scope, setScope] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  async function initialize() {
    try {
      setError("");
      setDocs(await api<Manual[]>("catalog"));
      setHistory(await api<Visit[]>("runs"));
      setReady(true);
    } catch {
      setError("O serviço está indisponível. Tente reconectar.");
    }
  }
  useEffect(() => {
    void initialize();
  }, []);
  useEffect(() => {
    if (tab === "Acervo" && openDoc) {
      document.getElementById(openDoc)?.scrollIntoView({ block: "center" });
    }
  }, [tab, openDoc]);
  async function ask(value: string) {
    const q = value.trim();
    if (busy || !ready || q.length < 4) return;
    setBusy(true);
    setError("");
    setQuestion(q);
    setTab("Consulta");
    try {
      const previous = run?.evidence[0]?.id.split("#")[0];
      const next = await api<Run>("ask", {
        method: "POST",
        body: JSON.stringify({ query: q, document: scope && previous ? previous : null }),
      });
      setRun(next);
      setScope(false);
      setHistory(await api<Visit[]>("runs"));
      requestAnimationFrame(() => resultRef.current?.focus());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function showVisit(id: string) {
    try {
      const item = await api<Run>("runs/" + id);
      setRun(item);
      setQuestion(item.question);
      setTab("Consulta");
      setScope(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function source(id: string) {
    setFilter("");
    setOpenDoc(id);
    setTab("Acervo");
  }
  async function review() {
    if (!run || busy) return;
    setBusy(true);
    try {
      const r = await api<{ delivery: string }>("runs/" + run.id + "/review", { method: "POST" });
      setRun({ ...run, delivery: r.delivery });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function clear() {
    try {
      await api("runs", { method: "DELETE" });
      setHistory([]);
      setRun(null);
      setQuestion("");
      setConfirmClear(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const sections = docs.reduce((total, d) => total + d.sections.length, 0);
  return (
    <>
      <header className="mast">
        <div className="mast-in">
          <a href="#content" className="logo">
            <RadioTower size={27} strokeWidth={1.6} />
            farol<span>/</span>
          </a>
          <span className="mast-sub">Operações de campus</span>
          <nav aria-label="Principal">
            {(["Consulta", "Acervo", "Histórico"] as Tab[]).map((t) => (
              <button key={t} aria-current={tab === t ? "page" : undefined} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main id="content">
        {error && (
          <div className="error" role="alert">
            {error} {!ready && <button onClick={initialize}>Reconectar</button>}
          </div>
        )}
        {tab === "Consulta" && (
          <div className="spread">
            <section className="workspace">
              <p className="kicker">
                <i /> CADERNO DE PLANTÃO
              </p>
              <h1>
                {run ? (
                  "Consulta de campo."
                ) : (
                  <>
                    O que houve
                    <br />
                    no <em>plantão?</em>
                  </>
                )}
              </h1>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  ask(question);
                }}
                className="ask"
              >
                <label htmlFor="question">Pergunte aos manuais do campus</label>
                <textarea
                  id="question"
                  placeholder="Descreva o que aconteceu…"
                  required
                  minLength={4}
                  maxLength={500}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                      e.preventDefault();
                      ask(question);
                    }
                  }}
                />
                <div className="ask-foot">
                  <span>
                    <CornerDownLeft size={13} /> Ctrl + Enter
                  </span>
                  <button className="action" disabled={busy || !ready || question.trim().length < 4}>
                    {busy ? "Consultando…" : "Consultar"} <ArrowRight size={16} />
                  </button>
                </div>
                {run?.evidence.length ? (
                  <label className="scope">
                    <input
                      type="checkbox"
                      checked={scope}
                      onChange={(e) => setScope(e.target.checked)}
                    />{" "}
                    Restringir a {run.evidence[0].id.split("#")[0]}
                  </label>
                ) : null}
              </form>
              {!run && (
                <div className="prompts">
                  <p className="small-label">EXPERIMENTE UMA CONSULTA</p>
                  {examples.map((q) => (
                    <button
                      className="question"
                      key={q}
                      disabled={!ready || busy}
                      onClick={() => ask(q)}
                    >
                      {q}
                      <ArrowUpRight size={16} />
                    </button>
                  ))}
                </div>
              )}
              {run && (
                <div ref={resultRef} tabIndex={-1} className="result">
                  <div className="result-head">
                    <span className="kicker">
                      {run.state === "answered" ? <Check size={15} /> : <Search size={15} />}{" "}
                      {run.state === "answered" ? "TRECHO VERIFICADO" : "SEM EVIDÊNCIA SUFICIENTE"}
                    </span>
                    <span className="small-label">{run.mode}</span>
                  </div>
                  <p className="answer">{run.answer}</p>
                  {run.evidence.map((e) => (
                    <button key={e.id} className="source" onClick={() => source(e.id)}>
                      <FileText size={17} />
                      <span>
                        <b>{e.id}</b> · {e.heading}
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                  <details className="trace">
                    <summary>Ver execução da consulta</summary>
                    <ol>
                      {run.trace.map((t) => (
                        <li key={t.name}>
                          <b>{t.name}</b>
                          <span>{t.ms} ms</span>
                          <p>{t.detail}</p>
                        </li>
                      ))}
                    </ol>
                  </details>
                  {run.delivery ? (
                    <p className="delivery">
                      {deliveries[run.delivery]}{" "}
                      <button onClick={() => showVisit(run.id)}>Atualizar</button>
                    </p>
                  ) : (
                    <button className="link-button" disabled={busy} onClick={review}>
                      Encaminhar para revisão <ArrowUpRight size={14} />
                    </button>
                  )}
                </div>
              )}
            </section>
            <aside className="archive-cover">
              <div className="cover-head">
                <span className="small-label">ACERVO TÉCNICO</span>
                <BookOpen size={19} />
              </div>
              <h2>
                Atlas do
                <br />
                campus<span>.</span>
              </h2>
              <p>Procedimentos de rede, salas de aula e suporte ao plantão.</p>
              <figure>
                <img
                  src="/topologia.png"
                  alt="Diagrama do circuito principal Ipê e do circuito de reserva Cedro"
                />
                <figcaption>Fig. 01 / Continuidade de rede</figcaption>
              </figure>
              <div className="cover-stats">
                <span>
                  <b>{docs.length || "—"}</b> manuais
                </span>
                <span>
                  <b>{sections || "—"}</b> trechos
                </span>
              </div>
              <button onClick={() => setTab("Acervo")}>
                Consultar o acervo <ArrowUpRight size={17} />
              </button>
            </aside>
          </div>
        )}
        {tab === "Acervo" && (
          <section className="library">
            <p className="kicker">
              <Layers3 size={14} /> DOCUMENTAÇÃO DE CAMPO
            </p>
            <h1>Acervo técnico.</h1>
            <label className="filter">
              <Search size={16} />
              <input
                aria-label="Filtrar manuais"
                placeholder="Filtrar por título, categoria ou código"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </label>
            {docs
              .filter((d) => (d.title + d.category + d.id).toLowerCase().includes(filter.toLowerCase()))
              .map((d) => (
                <article className="manual" key={d.id}>
                  <button
                    aria-expanded={openDoc.split("#")[0] === d.id}
                    onClick={() => setOpenDoc(openDoc.split("#")[0] === d.id ? "" : d.id)}
                  >
                    <span className="small-label">{d.id}</span>
                    <b>{d.title}</b>
                    <span>{d.category}</span>
                    <ChevronRight size={16} />
                  </button>
                  {openDoc.split("#")[0] === d.id && (
                    <div className="manual-body">
                      <p className="small-label">
                        {d.owner} / REVISÃO {d.revision}
                      </p>
                      {d.sections.map((s) => (
                        <section key={s.id} id={d.id + "#" + s.id}>
                          <h3>{s.heading}</h3>
                          <p>{s.text}</p>
                        </section>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            {!docs.some((d) =>
              (d.title + d.category + d.id).toLowerCase().includes(filter.toLowerCase()),
            ) && <p>Nenhum manual corresponde ao filtro.</p>}
          </section>
        )}
        {tab === "Histórico" && (
          <section className="library">
            <p className="kicker">
              <Clock3 size={14} /> MEMÓRIA DA SESSÃO
            </p>
            <h1>Consultas recentes.</h1>
            <p>
              Até 30 consultas deste navegador. Prazo de retenção de sete dias para consultas sem entrega
              pendente.
            </p>
            {history.map((r) => (
              <button className="question" key={r.id} onClick={() => showVisit(r.id)}>
                <span>{r.question}</span>
                <ArrowUpRight size={17} />
              </button>
            ))}
            {!history.length ? (
              <p>Nenhuma consulta registrada.</p>
            ) : confirmClear ? (
              <p>
                Apagar consultas e revisões desta sessão? <button onClick={clear}>Confirmar</button>{" "}
                <button onClick={() => setConfirmClear(false)}>Voltar</button>
              </p>
            ) : (
              <button className="link-button" onClick={() => setConfirmClear(true)}>
                Apagar histórico
              </button>
            )}
          </section>
        )}
      </main>
      <footer>
        <span>FAROL / CAMPUS FICTÍCIO</span>
        <span>Arquivo de operações</span>
      </footer>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
