import { codes, normalize, pairsFor } from "./model.js";
const byId = (id) => document.getElementById(id);
const demo = new URLSearchParams(location.search).get("mode") === "fixture";
const source = demo ? "Development fixture" : "Finviz";
const storageKey = demo ? "fx-fixture-snapshot" : "snapshot";
let snapshot,
  busy = false,
  timer;
if (demo) {
  document.querySelector(".eyebrow").textContent =
    "Currency monitor · Fixture mode";
  document.querySelector("footer").textContent =
    "Development fixture · Gap in percentage points = base performance − quote performance.";
}
try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  if (typeof saved?.time === "string" && saved.time.trim())
    snapshot = { data: normalize(saved.data), time: saved.time };
} catch {}
byId("status").textContent = snapshot
  ? "Cached · " + source + " · " + snapshot.time
  : "Connecting to " + source + "…";
function signed(n) {
  return (n > 0 ? "+" : "") + n.toFixed(2);
}
const pairOrders = {
  wide: (a, b) => Math.abs(b.gap) - Math.abs(a.gap),
  narrow: (a, b) => Math.abs(a.gap) - Math.abs(b.gap),
  high: (a, b) => b.gap - a.gap,
  low: (a, b) => a.gap - b.gap,
  az: (a, b) => a.name.localeCompare(b.name),
  za: (a, b) => b.name.localeCompare(a.name),
};
try {
  const saved = localStorage.getItem("fx-pair-sort");
  if (Object.hasOwn(pairOrders, saved)) byId("sort").value = saved;
} catch {}
byId("sort").onchange = () => {
  try {
    localStorage.setItem("fx-pair-sort", byId("sort").value);
  } catch {}
  render();
};
let periods;
const historyKey = storageKey + '-history';
let nextHistoryCheck = 0;
let loadingHistory = false;
function validHistory(h) {
  return h && [h.week,h.month,h.end].every(d => typeof d==='string' && /^\d{4}-\d\d-\d\d$/.test(d)) &&
    codes.every((base,i)=>codes.slice(i+1).every(quote=>{
      const pair=h.returns?.[base+'/'+quote];
      return Number.isFinite(pair?.week) && Number.isFinite(pair?.month);
    }));
}
function historyStatus(prefix) {
  byId('history-status').textContent = prefix + (periods ?
    ' · Through '+periods.end+' · Week from '+periods.week+' · Month from '+periods.month : '');
}
try {
  const saved=JSON.parse(localStorage.getItem(historyKey));
  if(validHistory(saved)) {periods=saved; historyStatus('Cached history');}
} catch {}
async function refreshHistory() {
  if(loadingHistory || Date.now()<nextHistoryCheck) return;
  loadingHistory=true;
  try {
    const r=await fetch(demo ? '/fixture-history' : '/history',{cache:'no-store',signal:AbortSignal.timeout(8500)});
    if(!r.ok) throw Error();
    const h=await r.json();
    if(!validHistory(h)) throw Error();
    periods=h;
    try { localStorage.setItem(historyKey,JSON.stringify(h)); } catch {}
    historyStatus(demo ? 'Fixture history' : 'Frankfurter reference rates');
    nextHistoryCheck=Date.now()+3600000;
  } catch {
    historyStatus(periods ? 'Cached history' : 'Historical returns unavailable');
    nextHistoryCheck=Date.now()+60000;
  } finally { loadingHistory=false; render(); }
}
function periodCell(pair, period) {
  const value=periods?.returns[pair.name][period];
  if(value===undefined) return '<td aria-label="Historical return unavailable">—</td>';
  const label = !pair.gap ? 'No daily bias' : !value ? 'Flat' :
    Math.sign(value)===Math.sign(pair.gap) ? 'Supports' : 'Opposes';
  return '<td>'+signed(value)+'%<small class="legs">'+label+'</small></td>';
}
function render() {
  if (!snapshot) return;
  const values = snapshot.data;
  const ranked = [...codes].sort((a, b) => values[b] - values[a]);
  const peak = Math.max(0.01, ...codes.map((code) => Math.abs(values[code])));
  const unit = 10 ** Math.floor(Math.log10(peak));
  const scale = Math.ceil(peak / unit) * unit;
  byId("ticks").innerHTML = [1, 0.5, 0, -0.5, -1]
    .map(
      (ratio) =>
        `<div class="tick ${ratio === 0 ? "zero" : ""}" style="top:${50 - 37 * ratio}%"><span>${signed(scale * ratio)}%</span></div>`,
    )
    .join("");
  ranked.forEach((code, rank) => {
    const value = values[code];
    let column = byId("currency-" + code);
    if (!column) {
      column = document.createElement("div");
      column.id = "currency-" + code;
      column.innerHTML =
        "<b>" +
        code +
        '</b><span class="stick"></span><span class="value"></span>';
      byId("bars").append(column);
    }
    column.className =
      "column " + (value < 0 ? "negative" : value > 0 ? "positive" : "neutral");
    column.style.transform = "translateX(" + rank * 100 + "%)";
    column.style.setProperty("--change", (37 * value) / scale + "%");
    column.querySelector(".value").textContent = signed(value) + "%";
  });
  for (const [id, code] of [
    ["high", ranked[0]],
    ["low", ranked.at(-1)],
  ]) {
    byId(id).innerHTML = `${code}<em>${signed(values[code])}%</em>`;
  }
  const pairs = pairsFor(values);
  const widest = pairs.reduce((best, pair) =>
    Math.abs(pair.gap) > Math.abs(best.gap) ? pair : best,
  );
  byId("wide").innerHTML =
    widest.name + "<em>" + Math.abs(widest.gap).toFixed(2) + " pp</em>";
  const query = byId("query")
    .value.toUpperCase()
    .replace(/[^A-Z]/g, "");
  byId("pairs").innerHTML =
    pairs
      .filter((p) => p.name.replace("/", "").includes(query))
      .sort(pairOrders[byId("sort").value])
      .map(
        (p) =>
          '<tr class="' +
          (p.gap > 0 ? "long" : p.gap < 0 ? "short" : "even") +
          '"><td><b>' +
          p.name +
          "</b><small class=legs>" + p.name.split("/").map(code => code + " " + signed(values[code]) + "%").join(" · ") + "</small></td><td>" +
          signed(p.gap) +
          '</td><td><mark class="' +
          (p.gap < 0 ? "sell" : p.gap === 0 ? "flat" : "") +
          '">' +
          (p.gap > 0 ? "BUY" : p.gap < 0 ? "SELL" : "NEUTRAL") +
          "</mark></td>" + periodCell(p,"week") + periodCell(p,"month") + "</tr>",
      )
      .join("") || '<tr><td colspan="5">No matching pairs.</td></tr>';
}
async function refresh() {
  if (busy) return;
  busy = true;
  void refreshHistory();
  try {
    const r = await fetch(demo ? "/fixture-feed" : "/feed", {
      cache: "no-store",
      signal: AbortSignal.timeout(8500),
    });
    if (!r.ok) throw Error();
    const data = normalize(await r.json());
    snapshot = { data, time: new Date().toLocaleString() };
    try {
      localStorage.setItem(storageKey, JSON.stringify(snapshot));
    } catch {}
    render();
    byId("status").textContent = source + " fetched · " + snapshot.time;
  } catch {
    byId("status").textContent =
      "Feed unavailable" +
      (snapshot?.time
        ? " · Cached " + source + " · " + snapshot.time
        : " · Waiting for data");
  } finally {
    busy = false;
  }
}
function schedule() {
  clearInterval(timer);
  const seconds = Number(byId("interval").value);
  if (seconds) {
    refresh();
    timer = setInterval(refresh, seconds * 1000);
  }
}
byId("interval").onchange = schedule;
byId("query").oninput = render;
render();
schedule();
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("/sw.js").catch(() => {});

const switcher = byId("theme");
function syncThemeButton() {
  const dark = document.documentElement.dataset.theme === "dark";
  switcher.textContent = dark ? "☾  Dark" : "☀  Light";
  switcher.setAttribute("aria-pressed", String(dark));
  document.querySelector('meta[name="theme-color"]').content = dark
    ? "#101826"
    : "#111c32";
}
switcher.onclick = () => {
  const next =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("fx-domain-theme", next);
  } catch {}
  syncThemeButton();
};
syncThemeButton();

