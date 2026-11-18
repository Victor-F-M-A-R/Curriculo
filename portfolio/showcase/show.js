import { mountYard } from "./model/yard.js";
const samples = [
  ["D1", "free"],
  ["D2", "servicing"],
  ["D3", "booked"],
  ["D4", "free"],
  ["D5", "servicing"],
  ["D6", "free"],
].map(([id, status], i) => ({ id, status, name: "Doca 0" + (i + 1) }));
const names = { free: "Livre", servicing: "Em operação", booked: "Reservada" };
const scene = mountYard(document.getElementById("scene"), {
  docks: samples,
  selectedId: "D1",
  onSelect(id) {
    const dock = samples.find((d) => d.id === id);
    document.getElementById("dock-caption").textContent = id + " · " + names[dock.status];
  },
});
const cases = {
  doca: [
    "OPERAÇÕES LOGÍSTICAS",
    "Doca Norte",
    "Reserve uma doca, inicie a descarga e libere a posição. A maquete acompanha cada mudança do pátio.",
    "A reserva usa uma trava no banco e uma chave de repetição. Duas reservas simultâneas disputam a mesma doca.",
    "Java · Spring Boot · Angular · Flutter · PostgreSQL",
  ],
  lastro: [
    "OPERAÇÕES FINANCEIRAS",
    "Lastro",
    "Importe um extrato e descubra quais repasses divergem dos títulos previstos. Uma justificativa guarda a decisão do analista.",
    "O lote inteiro participa de uma transação. Uma referência conflitante desfaz as demais linhas daquele lote.",
    "C# · ASP.NET Core · Dapper · React · Blazor",
  ],
  farol: [
    "OPERAÇÕES DE CAMPUS",
    "Farol",
    "Faça uma pergunta de plantão, abra o trecho original e encaminhe uma lacuna para revisão.",
    "O modelo seleciona texto dos manuais. O servidor confere a citação antes de exibi-la e registra o caminho da consulta.",
    "Python · FastAPI · React · SQLite-vec · n8n · .NET",
  ],
};
function select(key) {
  const fields = ["category", "title", "blurb", "decision", "stack"];
  fields.forEach((name, i) => (document.getElementById(name).textContent = cases[key][i]));
  for (const b of document.querySelectorAll("[data-project]"))
    b.setAttribute("aria-pressed", String(b.dataset.project === key));
  const video = document.getElementById("demo");
  video.pause();
  video.poster = "media/" + key + ".webp";
  video.setAttribute("aria-label", "Demonstração de " + cases[key][1]);
  video.querySelector("source").src = "media/" + key + ".mp4";
  video.querySelector("track").src = "media/" + key + ".vtt";
  video.load();
  const extra = video.querySelector('[srclang="en"]');
  if (extra) extra.remove();
  if (key === "lastro") {
    const t = document.createElement("track");
    t.kind = "captions";
    t.label = "English";
    t.srclang = "en";
    t.src = "media/lastro.en.vtt";
    video.append(t);
  }
  document.getElementById("readme").href = "case/" + key + ".html";
}
for (const b of document.querySelectorAll("[data-project]"))
  b.addEventListener("click", () => select(b.dataset.project));
if (location.hash === "#lastro" || location.hash === "#farol" || location.hash === "#doca") {
  select(location.hash.slice(1));
  document.getElementById("projetos").scrollIntoView();
}
