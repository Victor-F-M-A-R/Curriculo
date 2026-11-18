import { useRef, useState, type RefObject } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, CircleDot } from "lucide-react";
import { money, names, type Entry } from "./ledger";

type Review = (reference: string, note: string) => void;

function EntryDetails({ entry, busy, onReview, heading, returnToRow }: {
  entry: Entry;
  busy: boolean;
  onReview: Review;
  heading: RefObject<HTMLHeadingElement | null>;
  returnToRow: () => void;
}) {
  const [note, setNote] = useState("");
  const auditUrl = entry.reason ? "/audit?referencia=" + encodeURIComponent(entry.reference) : "/audit";
  return (
    <aside id="entry-detail" className="detail" aria-labelledby="entry-merchant">
      <button className="back-to-row" type="button" onClick={returnToRow}>
        <ArrowLeft size={15} /> Voltar ao repasse selecionado
      </button>
      <p className="type"><CircleDot size={15} /> FICHA DE CONCILIAÇÃO</p>
      <p className="ref">{entry.reference}</p>
      <h2 id="entry-merchant" ref={heading} tabIndex={-1}>{entry.merchant}</h2>
      <span className={"badge " + entry.status}>{names[entry.status]}</span>
      <dl>
        <div><dt>Competência</dt><dd>{entry.day.split("-").reverse().join("/")}</dd></div>
        <div><dt>Previsto</dt><dd>{money(entry.expected)}</dd></div>
        <div><dt>Recebido</dt><dd>{money(entry.received)}</dd></div>
        <div><dt>Diferença</dt><dd>{money(entry.delta)}</dd></div>
      </dl>
      {(entry.status === "disputed" || entry.status === "orphan") && (
        <form onSubmit={(event) => {
          event.preventDefault();
          if (!busy && note.trim().length >= 8) onReview(entry.reference, note.trim());
        }}>
          <label htmlFor="note">Justificativa de revisão</label>
          <textarea id="note" value={note} minLength={8} maxLength={500} required
            placeholder="Descreva o motivo da diferença…"
            onChange={(event) => setNote(event.target.value)}
          />
          <button className="dark" disabled={busy || note.trim().length < 8}>
            Registrar revisão <ArrowRight size={15} />
          </button>
        </form>
      )}
      {entry.reason && <p className="reason">{entry.reason}</p>}
      <a className="audit-link" href={auditUrl}>Abrir trilha de auditoria <ArrowUpRight size={14} /></a>
    </aside>
  );
}

export function LedgerDesk({ rows, busy, onReview }: { rows: Entry[]; busy: boolean; onReview: Review }) {
  const [selected, setSelected] = useState("REP-1043");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const activeRow = useRef<HTMLButtonElement>(null);
  const term = query.trim().toLocaleLowerCase("pt-BR");
  const visible = rows.filter((row) =>
    (filter === "all" || row.status === filter) &&
    (row.reference + " " + row.merchant).toLocaleLowerCase("pt-BR").includes(term),
  );
  const active = visible.find((row) => row.reference === selected) ?? visible[0];

  function choose(reference: string) {
    setSelected(reference);
    if (window.matchMedia("(max-width: 650px)").matches) {
      requestAnimationFrame(() => {
        detailHeading.current?.focus({ preventScroll: true });
        detailHeading.current?.closest("aside")?.scrollIntoView({ block: "start" });
      });
    }
  }

  return (
    <div className="desk">
      <section className="register" aria-labelledby="ledger-heading">
        <div className="section-head">
          <h2 id="ledger-heading">Livro de repasses</h2>
          <span className="type" aria-live="polite">{visible.length} de {rows.length} referências</span>
        </div>
        <div className="filters">
          <select aria-label="Filtrar por situação" value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="all">Todas as situações</option>
            {Object.entries(names).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
          </select>
          <input value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar referência ou empresa" aria-label="Buscar referência ou empresa" />
        </div>
        <div className="list">
          <div className="thead" aria-hidden="true">
            <span>Favorecido / ref.</span><span>Recebido</span><span>Situação</span>
          </div>
          {visible.map((row) => {
            const current = active?.reference === row.reference;
            return (
              <button key={row.reference} type="button" ref={current ? activeRow : undefined}
                className={"row" + (current ? " selected" : "")} onClick={() => choose(row.reference)}
                aria-pressed={current} aria-controls="entry-detail" disabled={busy}>
                <span><b>{row.merchant}</b><small>{row.reference}</small></span>
                <span>{money(row.received)}</span>
                <span><span className={"badge " + row.status}>{names[row.status]}</span></span>
              </button>
            );
          })}
          {!visible.length && <p className="empty-results">Nenhum repasse corresponde à busca.</p>}
        </div>
      </section>
      {active && (
        <EntryDetails key={active.reference} entry={active} busy={busy} onReview={onReview}
          heading={detailHeading} returnToRow={() => activeRow.current?.focus()} />
      )}
    </div>
  );
}
