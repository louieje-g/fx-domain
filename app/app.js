import { codes, normalize, pairsFor } from "./model.js";
const byId = (id) => document.getElementById(id);
const demo = new URLSearchParams(location.search).get("mode") === "fixture";
const hostedSnapshots = document.documentElement.hasAttribute("data-snapshots");
const liveFeed = !demo && document.documentElement.dataset.liveFeed;
const source = demo ? "Development fixture" : "Finviz";
const keyPrefix = demo ? "fx-fixture-snapshot" : "snapshot";
let snapshot,
  activeRequest,
  timer;
if (demo) {
  document.querySelector(".eyebrow").textContent =
    "Currency monitor · Fixture mode";
  document.querySelector("footer").textContent =
    "Development fixture · Gap in percentage points = base performance − quote performance.";
}
const frameControl = byId("frame");
try {
  const saved = localStorage.getItem("fx-frame");
  if (/^[1-8]$/.test(saved)) frameControl.value = saved;
} catch {}
function snapshotKey() {
  return frameControl.value === "1" ? keyPrefix : keyPrefix + "-v" + frameControl.value;
}
function showFetchStatus(label, cached = false) {
  byId("status").dataset.cached = String(cached);
  byId("feed-label").textContent = label;
  const raw = snapshot?.time;
  const date = new Date(raw);
  byId("fetch-time").textContent = Number.isNaN(date.getTime()) ? raw || "" :
    date.toLocaleString("en-US", {month:"short"}) + ", " +
    String(date.getDate()).padStart(2,"0") + " " + date.getFullYear() + " · " +
    date.toLocaleTimeString("en-US");
}
function loadFrame() {
  snapshot = undefined;
  const label = frameControl.selectedOptions[0].textContent;
  if (!byId("bars").childElementCount) byId("chart-period").textContent = label + " · Relative to USD";
  byId("scanner-period").textContent = "28 currency pairs · " + label + " performance vs USD";
  byId("bias-heading").textContent = label + " bias";
  byId("pairs").replaceChildren();
  for(const id of ["low","high","wide"]) byId(id).textContent="—";
try {
  const saved = JSON.parse(localStorage.getItem(snapshotKey()));
  if (typeof saved?.time === "string" && saved.time.trim())
    snapshot = { data: normalize(saved.data), time: saved.time };
} catch {}
showFetchStatus(snapshot ? "Cached · Last fetched from " + source : "Connecting to " + source + "…", Boolean(snapshot));
}
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
function drawAxis(limit) {
  byId("ticks").innerHTML = [1, 0.5, 0, -0.5, -1]
    .map(
      (ratio) =>
        `<div class="tick ${ratio === 0 ? "zero" : ""}" style="top:${50 - 37 * ratio}%"><span>${signed(ratio * limit)}%</span></div>`,
    )
    .join("");

}
drawAxis(1);

function render() {
  if (!snapshot) return;
  const values = snapshot.data;
  const limit = Math.max(1, Math.ceil(Math.max(...codes.map(code => Math.abs(values[code])))));
  drawAxis(limit);
  const ranked = [...codes].sort((a, b) => values[b] - values[a]);
  byId("chart-period").textContent = frameControl.selectedOptions[0].textContent + " · Relative to USD";
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
    column.style.setProperty("--change", 37 * (value / limit) + "%");
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
          "</mark></td></tr>",
      )
      .join("") || '<tr><td colspan="3">No matching pairs.</td></tr>';
}
async function refresh() {
  if (activeRequest) return;
  const controller = new AbortController();
  activeRequest = controller;

  try {
    const endpoint = hostedSnapshots
      ? "./data/" + (demo ? "fixture-" : "") + frameControl.value + ".json"
      : (demo ? "./fixture-feed" : "./feed") + (frameControl.value === "1" ? "" : "?v="+frameControl.value);
    const r = await fetch(endpoint, {
      cache: "no-store",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8500)]),
    });
    if (!r.ok) throw Error();
    const payload = await r.json();
    const data = normalize(hostedSnapshots ? payload.data : payload);
    if (controller.signal.aborted) return;
    snapshot = { data, time: hostedSnapshots ? new Date(payload.time).toISOString() : new Date().toISOString() };
    displaySnapshot();
  } catch {
    if (controller.signal.aborted) return;
    showFeedError();
  } finally {
    if (activeRequest === controller) activeRequest = undefined;
  }
}
function displaySnapshot() {
    try {
      localStorage.setItem(snapshotKey(), JSON.stringify(snapshot));
    } catch {}
    render();
    showFetchStatus("Last fetched from " + source);
}
function showFeedError() {
    if (!snapshot) { byId("bars").replaceChildren(); byId("chart-period").textContent = frameControl.selectedOptions[0].textContent + " · Relative to USD"; }
    showFetchStatus(snapshot ? "Feed unavailable · Cached · Last fetched from " + source : "Feed unavailable · Waiting for data", Boolean(snapshot));
}

let stream;
function closeStream() {
  const previous = stream;
  stream = undefined;
  previous?.close();
}
function subscribe(seconds) {
  const url = new URL(liveFeed);
  const frame = frameControl.value;
  url.search = new URLSearchParams({v: frame, seconds: seconds || 5});
  const socket = new WebSocket(url);
  stream = socket;
  const watchdog = () => setTimeout(() => socket.close(), (seconds || 5) * 1000 + 15000);
  let timeout = watchdog();
  socket.onmessage = ({data}) => {
    if (stream !== socket) return;
    clearTimeout(timeout);
    timeout = watchdog();
    try {
      const message = JSON.parse(data);
      if (message.v !== frame || message.error) throw Error();
      snapshot = {data: normalize(message.data), time: new Date(message.time).toISOString()};
      displaySnapshot();
    } catch {
      showFeedError();
    }
    if (!seconds) closeStream();
  };
  socket.onclose = () => {
    clearTimeout(timeout);
    if (stream !== socket) return;
    stream = undefined;
    showFeedError();
    if (seconds) timer = setTimeout(() => subscribe(seconds), 5000);
  };
}
function schedule(fetchOnce = false) {
  clearInterval(timer);
  const seconds = Number(byId("interval").value);
  if (liveFeed) {
    closeStream();
    if (seconds || fetchOnce) subscribe(seconds);
    return;
  }
  if (seconds) {
    refresh();
    timer = setInterval(refresh, seconds * 1000);
  }
}
frameControl.onchange = () => {
  activeRequest?.abort();
  activeRequest = undefined;
  try { localStorage.setItem("fx-frame",frameControl.value); } catch {}
  loadFrame();
  render();
  schedule(true);
  if (!liveFeed && byId("interval").value === "0") refresh();
};
loadFrame();
const interval = byId("interval");
const query = byId("query");
try {
  const savedInterval = localStorage.getItem("fx-refresh-interval");
  if (Array.from(interval.options).some(option => option.value === savedInterval)) {
    interval.value = savedInterval;
  }
  query.value = localStorage.getItem("fx-pair-query") ?? "";
} catch {}
interval.onchange = () => {
  try { localStorage.setItem("fx-refresh-interval", interval.value); } catch {}
  schedule();
};
query.oninput = () => {
  try { localStorage.setItem("fx-pair-query", query.value); } catch {}
  render();
};
if (interval.value === "0" && !snapshot) showFetchStatus("Paused · Waiting for data");
render();
schedule();
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("./sw.js").catch(() => {});

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




byId("reset").onclick = () => {
  activeRequest?.abort();
  activeRequest = undefined;
  for (const key of ["fx-pair-query","fx-frame","fx-pair-sort","fx-domain-theme","fx-refresh-interval"]) {
    try { localStorage.removeItem(key); } catch {}
  }
  query.value = "";
  frameControl.value = "1";
  byId("sort").value = "wide";
  interval.value = "10";
  document.documentElement.dataset.theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  syncThemeButton();
  loadFrame();
  render();
  schedule();
};
