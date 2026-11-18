import { mountYard } from "./model/yard.js";

const cases = JSON.parse(document.getElementById("case-data").textContent);
const samples = [
  ["D1", "free"], ["D2", "servicing"], ["D3", "booked"],
  ["D4", "free"], ["D5", "servicing"], ["D6", "free"],
].map(([id, status], i) => ({ id, status, name: "Doca 0" + (i + 1) }));
const names = { free: "Livre", servicing: "Em operação", booked: "Reservada" };

const nav = document.querySelector(".selector");
const player = document.getElementById("demo");
const section = document.getElementById("projetos");
let selected;

function display(key) {
  const info = cases[key];
  if (!info || key === selected) return;
  selected = key;
  for (const link of nav.querySelectorAll("[data-project]")) {
    if (link.dataset.project === key) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  }
  for (const [id, data] of Object.entries({ category: info.category, title: info.name, blurb: info.brief, stack: info.stack })) {
    document.getElementById(id).textContent = data;
  }
  document.getElementById("study").href = "case/" + key + ".html";
  document.getElementById("source").href =
    "https://github.com/Victor-F-M-A-R/Curriculo/tree/main/portfolio/" + info.project;
  player.pause();
  player.poster = "media/" + key + ".webp";
  player.setAttribute("aria-label", "Demonstração de " + info.name);
  player.querySelector("source").src = "media/" + key + ".mp4";
  player.querySelector('track[srclang="pt-BR"]').src = "media/" + key + ".vtt";
  player.querySelector('track[srclang="en"]')?.remove();
  if (info.english) {
    const captions = document.createElement("track");
    Object.assign(captions, { kind: "captions", label: "English", srclang: "en", src: "media/" + key + ".en.vtt" });
    player.append(captions);
  }
  player.load();
}

function syncLocation() {
  const key = location.hash.slice(1);
  if (Object.hasOwn(cases, key)) {
    display(key);
    section.scrollIntoView({ block: "start", behavior: "instant" });
  } else {
    display("doca");
  }
}

nav.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-project]");
  if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const key = link.dataset.project;
  if (location.hash !== "#" + key) history.pushState(null, "", "#" + key);
  display(key);
});
window.addEventListener("hashchange", syncLocation);
syncLocation();

mountYard(document.getElementById("scene"), {
  docks: samples,
  selectedId: "D1",
  onSelect(id) {
    const dock = samples.find((d) => d.id === id);
    document.getElementById("dock-caption").textContent = id + " · " + names[dock.status];
  },
});
