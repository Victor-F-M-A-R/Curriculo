import { useEffect, useRef, useState } from 'react';
import type { WebMCP } from '@w3c/webmcp-polyfill';
import { describeTool, registerFarol, type Bridge } from './webmcp';

export function WebMCPPanel(props: Bridge) {
  const bridge = useRef(props);
  bridge.current = props;
  const [context, setContext] = useState<WebMCP.ModelContext>();
  const [mode, setMode] = useState('Conectando…');
  const [tools, setTools] = useState<WebMCP.Tool[]>([]);
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('Quem dá o aceite de uma mudança programada e quando podemos executá-la?');
  const [citation, setCitation] = useState('RB-06#s1');
  const running = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    void registerFarol({
      acquire: () => bridge.current.acquire(), release: () => bridge.current.release(),
      onRun: run => bridge.current.onRun(run),
    }, controller.signal).then(async ({ context: registered, mode: label }) => {
      const discovered = await registered.getTools();
      controller.signal.throwIfAborted();
      setTools(discovered.filter(tool => tool.source === window && tool.name.startsWith('farol_')));
      setContext(registered);
      setMode(label);
    }).catch(error => {
      const cancelled = controller.signal.aborted;
      controller.abort();
      if (!cancelled) { setMode('Indisponível'); setError(String(error)); }
    });
    return () => controller.abort();
  }, []);

  async function execute(name: string, input: object = {}) {
    if (!context || running.current) return;
    const tool = tools.find(tool => tool.name === name);
    if (!tool) return;
    running.current = true;
    setBusy(true); setError(''); setOutput('');
    try {
      // Do not spread/clone Tool or substitute a same-named registration.
      const result = await context.executeTool(tool, input);
      setOutput(JSON.stringify(JSON.parse(result), null, 2));
    } catch (error) {
      setError(`A ferramenta não concluiu: ${String(error)}. Confira o histórico antes de repetir uma consulta.`);
    } finally { running.current = false; setBusy(false); }
  }
  return <details className="webmcp-panel">
    <summary>Laboratório de agentes · WebMCP</summary>
    <div className="webmcp-body">
      <p className="kicker">FERRAMENTAS COM FONTES E CONTROLE HUMANO</p>
      <h2>Do manual ao agente, com evidências.</h2>
      <p>Um agente pode descobrir funções e consultar as mesmas fontes do plantonista. Este laboratório executa o protocolo real com um cliente determinístico, sem modelo de IA.</p>
      <p role="status">{mode} · {tools.length} ferramentas</p>
      <div className="webmcp-actions">
        <button disabled={!context || busy} onClick={() => execute('farol_catalog')}>Listar manuais</button>
        <button disabled={!context || busy} onClick={() => execute('farol_history')}>Ler histórico da sessão</button>
      </div>
      <form onSubmit={event => { event.preventDefault(); void execute('farol_ask', { query }); }}>
        <label htmlFor="agent-question">Pergunta do agente</label>
        <textarea id="agent-question" required minLength={4} maxLength={500} value={query} onChange={event => setQuery(event.target.value)} />
        <button className="action" disabled={!context || busy}>Solicitar consulta com aprovação</button>
      </form>
      <form onSubmit={event => { event.preventDefault(); void execute('farol_source', { citation }); }}>
        <label htmlFor="agent-citation">Citação a conferir</label>
        <input id="agent-citation" required maxLength={24} value={citation} onChange={event => setCitation(event.target.value)} />
        <button disabled={!context || busy}>Recuperar fonte</button>
      </form>
      <p>Consultar grava histórico e pede confirmação a cada chamada. Revisar e apagar continuam disponíveis somente nos controles humanos do Farol. O histórico é compartilhado entre abas do mesmo perfil; perfis separados têm sessões separadas.</p>
      {error && <p role="alert">{error}</p>}
      {output && <pre aria-label="Resultado da ferramenta" tabIndex={0}>{output}</pre>}
      <details><summary>Contrato das ferramentas</summary><pre>{JSON.stringify(tools.map(describeTool), null, 2)}</pre></details>
    </div>
  </details>;
}
