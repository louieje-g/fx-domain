import {recordGaps} from "./trends.js";
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
    "Development fixture · Absolute gap in percentage points.";
}
const dailyFrame = "1";
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
function setLoading(loading) {
  const indicator = byId("frame-loading");
  indicator.hidden = !loading;
  indicator.textContent = loading ? "Loading daily performance…" : "";
  byId("bars").setAttribute("aria-busy", String(loading));
}
function loadSnapshot() {
try {
  const saved = JSON.parse(localStorage.getItem(keyPrefix));
  if (typeof saved?.time === "string" && saved.time.trim())
    snapshot = { data: normalize(saved.data), time: saved.time };
} catch {}
showFetchStatus(snapshot ? "Cached · Last fetched from " + source : "Connecting to " + source + "…", Boolean(snapshot));
}
function signed(n) {
  return (n > 0 ? "+" : "") + n.toFixed(2);
}
const pairOrders = {
  wide: (a, b) => b.gap - a.gap,
  narrow: (a, b) => a.gap - b.gap,
  high: (a, b) => b.direction * b.gap - a.direction * a.gap,
  low: (a, b) => a.direction * a.gap - b.direction * b.gap,
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
  byId("ticks").innerHTML = [1, 0.8, 0.6, 0.4, 0.2, 0, -0.2, -0.4, -0.6, -0.8, -1]
    .map(
      (ratio) =>
        `<div class="tick ${ratio === 0 ? "zero" : ""}" style="top:calc(${50 - 37 * ratio}% - ${Math.sign(ratio)} * var(--badge-half))"><span>${signed(ratio * limit)}%</span></div>`,
    )
    .join("");

}
drawAxis(1);

window.addEventListener("pair-preferences", () => render());
function render() {
  if (!snapshot) return;
  const values = snapshot.data;
  const limit = Math.max(1, Math.ceil(Math.max(...codes.map(code => Math.abs(values[code])))));
  drawAxis(limit);
  const ranked = [...codes].sort((a, b) => values[b] - values[a]);
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
    const magnitude = Math.abs(value) / limit;
    column.style.setProperty("--strength", 100 * Math.pow(magnitude, 0.8) + "%");
    column.style.setProperty("--bar-fill", (20 + 52 * magnitude) + "%");
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
    pair.gap > best.gap ? pair : best,
  );
  byId("wide").innerHTML =
    widest.name + "<em>" + widest.gap.toFixed(2) + " pp</em>";
  const query = byId("query")
    .value.toUpperCase()
    .replace(/[^A-Z]/g, "");
  const table = byId("pairs");
  table.innerHTML =
    pairs
      .filter(p => !byId("only-watched").checked || window.pairPreferences?.watched(p.name))
      .filter((p) => p.name.replace("/", "").includes(query))
      .sort(pairOrders[byId("sort").value])
      .map(
        (p) =>
          '<tr class="' +
          (p.direction > 0 ? "long" : p.direction < 0 ? "short" : "even") +
          '" data-pair="' + p.name + '"><td><b>' +
          p.name +
          "</b><small class=legs>" + p.name.split("/").map(code => code + " " + signed(values[code]) + "%").join(" · ") + "</small></td><td>" +
          p.gap.toFixed(2) +
          '</td><td><mark class="' +
          (p.direction < 0 ? "sell" : p.gap === 0 ? "flat" : "") +
          '">' +
          (p.direction > 0 ? "BUY" : p.direction < 0 ? "SELL" : "NEUTRAL") +
          '</mark></td><td><button type="button" class="alert-action" aria-haspopup="dialog">Watch</button></td></tr>',
      )
      .join("") || '<tr><td colspan="4">No matching pairs.</td></tr>';
  window.pairPreferences?.decorate();
}
async function refresh() {
  if (activeRequest) return;
  const controller = new AbortController();
  activeRequest = controller;

  try {
    const endpoint = hostedSnapshots
      ? "./data/" + (demo ? "fixture-" : "") + "1.json"
      : demo ? "./fixture-feed" : "./feed";
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
    recordGaps(dailyFrame,pairsFor(snapshot.data),snapshot.time);
    setLoading(false);
    try {
      localStorage.setItem(keyPrefix, JSON.stringify(snapshot));
    } catch {}
    render();
    showFetchStatus("Last fetched from " + source);
}
function showFeedError(retryAt) {
    setLoading(false);
    if (!snapshot) byId("bars").replaceChildren();
    const reason = Number.isFinite(retryAt) ? "Finviz rate limit · Retry at "+new Date(retryAt).toLocaleTimeString() : "Feed unavailable";
    showFetchStatus(reason + (snapshot ? " · Cached · Last fetched from " + source : " · Waiting for data"), Boolean(snapshot));
}

let stream;
function closeStream() {
  const previous = stream;
  stream = undefined;
  previous?.close();
}
function subscribe(seconds) {
  const url = new URL(liveFeed);
  url.search = new URLSearchParams({v: dailyFrame, seconds: seconds || 10});
  const socket = new WebSocket(url);
  stream = socket;
  const watchdog = () => setTimeout(() => socket.close(), (seconds || 10) * 1000 + 15000);
  let timeout = watchdog();
  socket.onmessage = ({data}) => {
    if (stream !== socket) return;
    clearTimeout(timeout);
    timeout = watchdog();
    try {
      const message = JSON.parse(data);
      if (message.v !== dailyFrame) throw Error();
      if (message.error) throw Object.assign(Error(),{retryAt:message.retryAt});
      snapshot = {data: normalize(message.data), time: new Date(message.time).toISOString()};
      displaySnapshot();
    } catch (error) {
      showFeedError(error.retryAt);
    }
    if (!seconds) closeStream();
  };
  socket.onclose = () => {
    clearTimeout(timeout);
    if (stream !== socket) return;
    stream = undefined;
    showFeedError();
    if (seconds) timer = setTimeout(() => subscribe(seconds), 10000);
  };
}
function schedule(fetchOnce = false) {
  clearInterval(timer);
  const seconds = Number(byId("interval").value);
  if (!snapshot && (seconds || fetchOnce)) setLoading(true);
  if (liveFeed) {
    closeStream();
    if (seconds || fetchOnce) subscribe(seconds);
    return;
  }
  if (seconds || fetchOnce) refresh();
  if (seconds) timer = setInterval(refresh, seconds * 1000);
}
window.addEventListener("gap-alerts-changed", () => schedule(true));
loadSnapshot();
const interval = byId("interval");
const query = byId("query");
try {
  let savedInterval = localStorage.getItem("fx-refresh-interval");
  if (savedInterval === "5") {
    savedInterval = "10";
    localStorage.setItem("fx-refresh-interval", savedInterval);
  }
  if (Array.from(interval.options).some(option => option.value === savedInterval)) {
    interval.value = savedInterval;
  }
  query.value = localStorage.getItem("fx-pair-query") ?? "";
} catch {}
interval.onchange = () => {
  if (interval.value === "0") setLoading(false);
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
if ("serviceWorker" in navigator) {
  const workers = navigator.serviceWorker;
  let controlled = Boolean(workers.controller);
  workers.addEventListener("controllerchange", () => {
    if (controlled) location.reload();
    controlled = true;
  });
  workers.register("./sw.js", {updateViaCache: "none"}).then(registration => {
    if (!registration) return;
    const check = () => {
      if (document.visibilityState === "visible") registration.update().catch(() => {});
    };
    document.addEventListener("visibilitychange", check);
    setInterval(check, 60000);
  }).catch(() => {});
}

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
  setLoading(false);
  activeRequest?.abort();
  activeRequest = undefined;
  for (const key of ["fx-pair-query","fx-frame","fx-pair-sort","fx-domain-theme","fx-refresh-interval"]) {
    try { localStorage.removeItem(key); } catch {}
  }
  query.value = "";
  byId("sort").value = "wide";
  interval.value = "30";
  document.documentElement.dataset.theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  syncThemeButton();
  render();
  schedule();
};
