import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  Clock3,
  CornerDownLeft,
  Layers3,
  RadioTower,
  Search,
} from "lucide-react";
import { EvidenceResult, HighlightedPassage, type Run } from "./EvidenceResult";
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
type Visit = { id: string; question: string; created: number };
type Tab = "Consulta" | "Acervo" | "Histórico";
const examples = [
  "Quantas falhas na WAN Ipê fazem a Cedro assumir?",
  "Em qual percentual do toner o almoxarifado deve ser acionado?",
  "Qual é o preço mensal do contrato da WAN Cedro?",
];
async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 50_000);
  try {
    const res = await fetch("/api/" + path, {
      ...options,
      signal: controller.signal,
      headers: { "X-Farol-Client": "desk", "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const message = res.status === 404 ? "Esta consulta não está mais disponível nesta sessão."
        : res.status === 409 ? "O histórico foi apagado durante a consulta. Envie uma nova pergunta."
        : "O serviço não concluiu o pedido. Tente novamente.";
      throw new Error(message);
    }
    return res.status === 204 ? (undefined as T) : await res.json();
  } catch (error) {
    if (controller.signal.aborted) throw new Error("O serviço demorou demais. Consulte o histórico antes de reenviar a pergunta.");
    if (error instanceof TypeError) throw new Error("A conexão foi interrompida. Consulte o histórico antes de reenviar a pergunta.");
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
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
  // The ref closes the gap before React commits disabled buttons. Session
  // operations are serialized, including reading a visit and erasing history.
  const active = useRef(false);
  function start() {
    if (active.current) return false;
    active.current = true;
    setBusy(true);
    setError("");
    return true;
  }
  function finish() {
    active.current = false;
    setBusy(false);
  }
  async function initialize() {
    if (!start()) return;
    try {
      setError("");
      setDocs(await api<Manual[]>("catalog"));
      setHistory(await api<Visit[]>("runs"));
      setReady(true);
    } catch {
      setError("O serviço está indisponível. Tente reconectar.");
    } finally {
      finish();
    }
  }
  useEffect(() => {
    void initialize();
  }, []);
  useEffect(() => {
    if (tab === "Acervo" && openDoc) {
      const section = document.getElementById(openDoc);
      section?.focus({ preventScroll: true });
      section?.scrollIntoView({ block: "center" });
    }
  }, [tab, openDoc]);
  async function ask(value: string) {
    const q = value.trim();
    if (!ready || q.length < 4 || q.length > 500 || !start()) return;
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
      try {
        setHistory(await api<Visit[]>("runs"));
      } catch {
        setError("A resposta foi salva, mas o histórico não pôde ser atualizado. Use Atualizar histórico.");
      }
      requestAnimationFrame(() => resultRef.current?.focus());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      finish();
    }
  }
  async function showVisit(id: string) {
    if (!start()) return;
    setTab("Consulta");
    try {
      const item = await api<Run>("runs/" + id);
      setRun(item);
      setQuestion(item.question);
      setScope(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      finish();
    }
  }
  function source(id: string) {
    setFilter("");
    setOpenDoc(id);
    setTab("Acervo");
  }
  async function review() {
    if (!run || !start()) return;
    try {
      const r = await api<{ delivery: string }>("runs/" + run.id + "/review", { method: "POST" });
      setRun({ ...run, delivery: r.delivery });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      finish();
    }
  }
  async function clear() {
    if (!start()) return;
    try {
      await api("runs", { method: "DELETE" });
      setHistory([]);
      setRun(null);
      setQuestion("");
      setScope(false);
      setConfirmClear(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      finish();
    }
  }
  const citation = run?.evidence.find((item) => item.id === openDoc);
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
      <main id="content" aria-busy={busy}>
        {error && (
          <div className="error" role="alert">
            {error} {!ready && <button disabled={busy} onClick={initialize}>Reconectar</button>}
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
                <EvidenceResult
                  run={run}
                  busy={busy}
                  resultRef={resultRef}
                  source={source}
                  review={review}
                  refresh={() => showVisit(run.id)}
                />
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
            {citation && (
              <button
                className="link-button"
                onClick={() => {
                  setTab("Consulta");
                  requestAnimationFrame(() => resultRef.current?.focus());
                }}
              >
                Voltar à resposta
              </button>
            )}
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
                        <section key={s.id} id={d.id + "#" + s.id} tabIndex={-1}>
                          <h3>{s.heading}</h3>
                          <HighlightedPassage
                            text={s.text}
                            quote={citation?.id === d.id + "#" + s.id ? citation.quote : undefined}
                          />
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
            <button className="link-button" disabled={busy} onClick={initialize}>Atualizar histórico</button>
            <p>
              Até 30 consultas deste navegador. Prazo de retenção de sete dias para consultas sem entrega
              pendente.
            </p>
            {history.map((r) => (
              <button className="question" key={r.id} disabled={busy} onClick={() => showVisit(r.id)}>
                <span>{r.question}</span>
                <ArrowUpRight size={17} />
              </button>
            ))}
            {!history.length ? (
              <p>Nenhuma consulta registrada.</p>
            ) : confirmClear ? (
              <p>
                Apagar consultas e revisões desta sessão? Uma entrega já enviada não pode ser desfeita. <button disabled={busy} onClick={clear}>Confirmar</button>{" "}
                <button onClick={() => setConfirmClear(false)}>Voltar</button>
              </p>
            ) : (
              <button className="link-button" disabled={busy} onClick={() => setConfirmClear(true)}>
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
