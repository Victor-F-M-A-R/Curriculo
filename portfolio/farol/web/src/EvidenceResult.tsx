import type { Ref } from "react";
import { ArrowUpRight, Check, ChevronRight, FileText, Search } from "lucide-react";

export type Run = {
  id: string;
  question: string;
  state: "answered" | "abstained";
  answer: string;
  mode: string;
  delivery: string | null;
  evidence: { id: string; title: string; heading: string; revision: string; quote: string }[];
  trace: { name: string; ms: number; detail: string }[];
};

const deliveries: Record<string, string> = {
  local: "Na fila local",
  queued: "Aguardando n8n",
  sending: "Enviando ao n8n",
  delivered: "Recebida pelo n8n",
  failed: "Entrega falhou",
};

type ResultProps = {
  run: Run;
  busy: boolean;
  resultRef: Ref<HTMLDivElement>;
  source: (id: string) => void;
  review: () => void;
  refresh: () => void;
};

export function EvidenceResult({ run, busy, resultRef, source, review, refresh }: ResultProps) {
  const answered = run.state === "answered";
  return (
    <div
      ref={resultRef}
      tabIndex={-1}
      className="result"
      role="region"
      aria-labelledby="result-question"
    >
      <div className="result-head">
        <span className="kicker">
          {answered ? <Check size={15} /> : <Search size={15} />}{" "}
          {answered ? "FONTE LOCALIZADA" : "SEM EVIDÊNCIA SUFICIENTE"}
        </span>
        <span className="small-label">{run.mode}</span>
      </div>
      <h2 id="result-question" className="result-question">
        {run.question}
      </h2>
      <p className="answer">{run.answer}</p>
      {run.evidence.map((e) => (
        <button key={e.id} className="source" onClick={() => source(e.id)}>
          <FileText size={17} />
          <span>
            <b>{e.id}</b> · {e.heading}
            <small>{e.title} · Revisão {e.revision}</small>
          </span>
          <ChevronRight size={16} />
        </button>
      ))}
      <details className="trace">
        <summary>Ver execução da consulta</summary>
        <ol>
          {run.trace.map((stage) => (
            <li key={stage.name}>
              <b>{stage.name}</b>
              <span>{stage.ms} ms</span>
              <p>{stage.detail}</p>
            </li>
          ))}
        </ol>
      </details>
      {run.delivery ? (
        <p className="delivery" role="status">
          {deliveries[run.delivery]}{" "}
          <button disabled={busy} onClick={refresh}>Atualizar</button>
        </p>
      ) : (
        <button className="link-button" disabled={busy} onClick={review}>
          Encaminhar para revisão <ArrowUpRight size={14} />
        </button>
      )}
    </div>
  );
}

export function HighlightedPassage({ text, quote }: { text: string; quote?: string }) {
  const start = quote ? text.indexOf(quote) : -1;
  if (!quote || start < 0) return <p>{text}</p>;
  return (
    <p>
      {text.slice(0, start)}<mark>{quote}</mark>{text.slice(start + quote.length)}
    </p>
  );
}
