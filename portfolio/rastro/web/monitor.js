const el = (id) => document.getElementById(id);
const clock = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const dateLabel = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric",
});
const number = new Intl.NumberFormat("pt-BR");
const coord = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const outcomes = {
  advanced: "atualizou a posição",
  replay: "reenvio reconhecido",
  late: "leitura atrasada preservada",
};
let vehicles = [];
let selected = null;
let points = [];
let fleetRequest = 0;
let historyRequest = 0;

function node(tag, value, className) {
  const n = document.createElement(tag);
  n.textContent = value;
  if (className) n.className = className;
  return n;
}

async function api(path, options = {}) {
  const r = await fetch(path, { cache: "no-store", ...options });
  if (!r.ok) throw new Error("O serviço não conseguiu concluir a consulta.");
  return r.json();
}

function notice(message = "") {
  el("notice").textContent = message;
  el("notice").hidden = !message;
}

function drawTrack() {
  const canvas = el("track-map");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  ctx.scale(scale, scale);
  ctx.strokeStyle = "#31515b";
  ctx.lineWidth = 0.75;
  ctx.beginPath();
  for (let x = 0; x <= w; x += 26) { ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, h); }
  for (let y = 0; y <= h; y += 26) { ctx.moveTo(0, y + .5); ctx.lineTo(w, y + .5); }
  ctx.stroke();
  if (!points.length) return;
  const path = points.slice().reverse();
  const cosLat = Math.cos(Number(path[0].latitude) * Math.PI / 180);
  const xs = path.map(p => Number(p.longitude) * cosLat);
  const ys = path.map(p => Number(p.latitude));
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const ymin = Math.min(...ys), ymax = Math.max(...ys);
  const zoom = Math.min((w - 42) / Math.max(.00001, xmax - xmin),
                        (h - 36) / Math.max(.00001, ymax - ymin));
  const coords = xs.map((val, i) => [
    w / 2 + (val - (xmin + xmax) / 2) * zoom,
    h / 2 - (ys[i] - (ymin + ymax) / 2) * zoom,
  ]);
  ctx.strokeStyle = "#d3ee8f";
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.beginPath();
  coords.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.stroke();
  coords.forEach(([x, y], i) => {
    const current = i === coords.length - 1;
    ctx.fillStyle = current ? "#d7f58e" : "#9db9b6";
    ctx.beginPath(); ctx.arc(x, y, current ? 5.5 : 3.6, 0, Math.PI * 2); ctx.fill();
    if (current) {
      ctx.strokeStyle = "#b7d37e";
      ctx.lineWidth = 1.25;
      ctx.beginPath(); ctx.arc(x, y, 10.5, 0, Math.PI * 2); ctx.stroke();
    }
  });
}

function renderFleet() {
  const list = el("vehicle-list");
  const focused = list.contains(document.activeElement) ? document.activeElement.dataset.asset : null;
  const items = vehicles.map(v => {
    const b = node("button", "", "vehicle");
    b.type = "button";
    b.dataset.asset = v.vehicle_id;
    b.setAttribute("aria-pressed", String(v.vehicle_id === selected));
    const name = node("span", "", "vehicle-main");
    name.append(node("strong", v.name), node("small", v.route));
    b.append(name, node("span", v.vehicle_id, "vehicle-code"));
    b.addEventListener("click", () => selectVehicle(v.vehicle_id));
    return b;
  });
  list.replaceChildren(...(items.length ? items : [node("p", "Nenhum veículo cadastrado.", "muted")]));
  if (focused) items.find(b => b.dataset.asset === focused)?.focus({ preventScroll: true });
}

function renderHistory() {
  const rows = points.map(p => {
    const timestamp = new Date(p.observed_at);
    const time = node("time", clock.format(timestamp));
    time.dateTime = p.observed_at;
    time.append(node("small", dateLabel.format(timestamp)));
    const speed = node("span", p.speed_kmh + " km/h");
    speed.append(node("small", "seq. " + p.device_seq));
    const status = node("span", p.arrived_late ? "Atrasada" : "Em ordem",
                        p.arrived_late ? "badge late" : "badge");
    const row = node("div", "", "history-row");
    row.append(time, speed, status);
    return row;
  });
  el("event-list").replaceChildren(...(rows.length ? rows : [node("p", "Sem posições registradas.", "muted")]));
  drawTrack();
}

async function selectVehicle(vehicleId) {
  const requestId = ++historyRequest;
  selected = vehicleId;
  renderFleet();
  const v = vehicles.find(item => item.vehicle_id === selected);
  points = [];
  drawTrack();
  el("track-heading").textContent = v?.name || "Selecione um veículo";
  el("vehicle-code").textContent = v?.vehicle_id || "";
  el("timeline-asset").textContent = v?.route || "";
  el("last-time").textContent = v?.observed_at ? clock.format(new Date(v.observed_at)) : "—";
  el("last-speed").textContent = v?.speed_kmh != null ? v.speed_kmh + " km/h" : "—";
  el("coordinates").textContent = v?.latitude != null
    ? coord.format(Number(v.latitude)) + " / " + coord.format(Number(v.longitude)) : "—";
  if (!v) { renderHistory(); return; }
  el("event-list").replaceChildren(node("p", "Carregando posições…", "muted"));
  try {
    const result = await api("/api/vehicles/" + encodeURIComponent(v.vehicle_id) + "/events");
    if (requestId !== historyRequest) return;
    points = result.events;
    renderHistory();
  } catch {
    if (requestId !== historyRequest) return;
    el("event-list").replaceChildren(node("p", "Histórico indisponível. Use Atualizar para tentar novamente.", "muted"));
  }
}

async function loadFleet(prefer) {
  const requestId = ++fleetRequest;
  el("reload").disabled = true;
  try {
    const result = await api("/api/fleet");
    if (requestId !== fleetRequest) return;
    vehicles = result.vehicles;
    document.body.dataset.ready = "true";
    el("db-status").textContent = "PostgreSQL conectado";
    el("dataset").textContent = result.demo ? "Turno de demonstração · dados sintéticos" : "Operação";
    el("simulate").hidden = !result.demo;
    el("vehicles-total").textContent = number.format(vehicles.length);
    el("events-total").textContent = number.format(vehicles.reduce((sum, v) => sum + Number(v.unique_count), 0));
    el("late-total").textContent = number.format(vehicles.reduce((sum, v) => sum + Number(v.late_count), 0));
    notice();
    const desired = prefer ?? selected;
    await selectVehicle(vehicles.some(v => v.vehicle_id === desired) ? desired : vehicles[0]?.vehicle_id);
  } catch {
    if (requestId !== fleetRequest) return;
    document.body.dataset.ready = "false";
    el("db-status").textContent = "Sem conexão";
    notice("Não foi possível atualizar a frota. Use Atualizar para tentar novamente.");
  } finally {
    if (requestId === fleetRequest) el("reload").disabled = false;
  }
}

function showReceipt(receipts) {
  const counts = { advanced: 0, replay: 0, late: 0 };
  const items = receipts.map(r => {
    counts[r.outcome]++;
    return node("li", "Seq. " + r.sequence + " · " + outcomes[r.outcome]);
  });
  const labels = { advanced: ["posição atualizada", "posições atualizadas"],
    replay: ["reenvio", "reenvios"], late: ["leitura atrasada", "leituras atrasadas"] };
  el("result-summary").textContent = Object.entries(counts).filter(([, n]) => n)
    .map(([key, n]) => n + " " + labels[key][n === 1 ? 0 : 1]).join(" · ");
  el("result-items").replaceChildren(...items);
  el("scenario-result").hidden = false;
}

el("reload").addEventListener("click", () => loadFleet());
el("simulate").addEventListener("click", async () => {
  el("simulate").disabled = true;
  try {
    const batch = await api("/api/demo/scenario", { method: "POST", headers: { "X-Rastro-Client": "monitor" } });
    showReceipt(batch.receipts);
    await loadFleet(batch.vehicle_id);
  } catch {
    notice("Não foi possível confirmar a chegada. Você pode reenviar o mesmo lote.");
  } finally { el("simulate").disabled = false; }
});
const ro = new ResizeObserver(drawTrack);
ro.observe(el("track-map"));
loadFleet();
