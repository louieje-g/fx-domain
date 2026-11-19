import {latestGap,recordGaps} from "./trends.js";
import {pairsFor,normalize} from "./model.js";
const el = id => document.getElementById(id);
const endpoint = document.documentElement.dataset.alerts || "./alerts";
const form = el("alert-form");
const table = el("pairs");
const period = el("alert-frame");
const dialog = el("alert-dialog");
const status = el("alert-status");
const filter = el("only-watched");
const ruleKey = (pair, frame) => "fx-alert:" + pair + ":" + frame;
const watchKey = pair => "fx-watch:" + pair;
const readRule = (pair, frame) => JSON.parse(localStorage.getItem(ruleKey(pair,frame)));
const framesFor = pair => [...period.options].filter(opt=>readRule(pair,opt.value));
const watched = pair => framesFor(pair).length > 0 || localStorage.getItem(watchKey(pair)) === "1";
let pair;
let busy = false;
let config;
let configFailed = false;
const fixtureMode = new URLSearchParams(location.search).get("mode") === "fixture";
if (!fixtureMode) fetch(endpoint).then(r=>r.json()).then(data=>{config=data; sync();}).catch(()=>{configFailed=true;sync();});
const legacy = JSON.parse(localStorage.getItem("fx-alert-rule"));
if (legacy && localStorage.getItem("fx-alert-token")) {
  localStorage.setItem(ruleKey(legacy.pair,legacy.frame),JSON.stringify({...legacy,token:localStorage.getItem("fx-alert-token")}));
  localStorage.removeItem("fx-alert-rule");
}
for (const option of el("frame").options) period.add(new Option(option.text,option.value));
const observations = new Map();
let loadingStatus = false;
async function refreshStatus() {
  if (fixtureMode || loadingStatus || document.hidden) return;
  const tokens = Object.keys(localStorage).filter(k=>k.startsWith("fx-alert:")).map(k=>JSON.parse(localStorage.getItem(k))?.token).filter(Boolean);
  if (!tokens.length) return;
  loadingStatus=true;
  try {
    const response=await fetch(endpoint+"?status",{method:"POST",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify(tokens),signal:AbortSignal.timeout(8000)});
    if (!response.ok) throw Error();
    const rows=await response.json();
    tokens.forEach((token,i)=>observations.set(token,rows[i]));
  } catch { /* Keep the last observation, with its original timestamp. */ }
  finally {loadingStatus=false;decorate();}
}
function hitTime(value) {
  const date=new Date(value);
  return date.toLocaleString(undefined,{...(date.toDateString()===new Date().toDateString()?{}:{month:"short",day:"numeric"}),hour:"numeric",minute:"2-digit"});
}
const alertKeys = () => Object.keys(localStorage).filter(key=>key.startsWith("fx-alert:"));
let clearing = false;
function updateClearButton() {
  el("clear-alerts").disabled = clearing || !alertKeys().length;
}
el("clear-alerts").onclick = async () => {
  const keys = alertKeys();
  if (!keys.length || clearing || busy) return;
  const prompt = el("clear-dialog");
  if (prompt.open) return;
  el("clear-result").textContent = "";
  el("clear-description").textContent = keys.length===1
    ? "This will remove your saved gap alert from this device."
    : "This will remove all "+keys.length+" saved gap alerts from this device.";
  prompt.returnValue = "";
  const confirmed = new Promise(resolve => {
    prompt.addEventListener("close",()=>resolve(prompt.returnValue==="clear"),{once:true});
  });
  prompt.showModal();
  if (!await confirmed) return;
  clearing=true;
  updateClearButton();
  const result=el("clear-result");
  result.textContent="Clearing alerts…";
  let failed=0;
  let removed=0;
  for (const key of keys) {
    const saved=localStorage.getItem(key);
    if (!saved) continue;
    try {
      const {token}=JSON.parse(saved);
      const response=await fetch(endpoint,{method:"DELETE",headers:{Authorization:"Bearer "+token},signal:AbortSignal.timeout(8000)});
      if (!response.ok) throw Error();
      if (localStorage.getItem(key)===saved) localStorage.removeItem(key);
      observations.delete(token);
      removed++;
    } catch {failed++;}
  }
  clearing=false;
  result.textContent=failed ? "Couldn’t clear "+failed+" alert"+(failed===1?"":"s")+". Try again." : "Alerts cleared.";
  updateClearButton();
  redraw();
  if (removed) alertsChanged();
};
updateClearButton();
function decorate() {
  updateClearButton();
  for (const row of table.querySelectorAll("tr[data-pair]")) {
    const name=row.dataset.pair;
    const button=row.querySelector(".alert-action");
    const rules=framesFor(name).map(option=>{
      const rule=readRule(name,option.value);
      return {option,rule,reading:observations.get(rule.token)};
    }).sort((a,b)=>(b.reading?.lastHit || "").localeCompare(a.reading?.lastHit || "") || Number(b.option.value===el("frame").value)-Number(a.option.value===el("frame").value));
    const active = watched(name);
    button.textContent = active ? "Watching" : "Watch";
    button.dataset.watched = String(active);
    button.title = (active ? "Manage alerts for " : "Set an alert for ") + name;
    const previous = row.nextElementSibling;
    if (previous?.classList.contains("alert-detail")) previous.remove();
    if (!rules.length) {delete button.dataset.frame; continue;}
    button.dataset.frame = rules[0].option.value;
    const details = document.createElement("tr");
    details.className = "alert-detail "+row.className;
    details.setAttribute("aria-label",name+" alert details");
    const cell = details.insertCell();
    cell.colSpan = 4;
    for (const {option,rule,reading} of rules) {
      const hit = reading?.lastHit;
      const fresh = reading?.seen && Date.now()-Date.parse(reading.seen)<45000 &&
        Number.isFinite(reading.gap) && reading.threshold===rule.threshold;
      const left = fresh ? Math.round((rule.threshold-reading.gap)*100) : null;
      let state = "Awaiting reading";
      if (fresh) state = left>0 ? (left/100).toFixed(2)+" pp to go" : hit ? "Threshold hit" : left===0 ? "At threshold" : "Above threshold";
      const line=document.createElement("div");
      const target=document.createElement("span");
      target.textContent=option.text+" · Target "+rule.threshold.toFixed(2)+" pp";
      const status=document.createElement("strong");
      status.textContent=state;
      line.append(target,status);
      if (hit) {
        const last=document.createElement("span");
        last.textContent="Last hit "+hitTime(hit);
        line.append(last);
      }
      cell.append(line);
    }
    row.after(details);
  }
}
setInterval(refreshStatus,10000);
document.addEventListener("visibilitychange",refreshStatus);
refreshStatus();
function close() {
  dialog.close();

}
function sync() {
  if (!pair) return;
  status.dataset.error = "false";
  const rule = readRule(pair,period.value);
  el("alert-save").textContent = rule ? "Update alert" : "Enable alert";
  const legacyWatch = !framesFor(pair).length && watched(pair);
  el("alert-remove").hidden = !rule && !legacyWatch;
  el("alert-remove").textContent = rule ? "Remove alert" : "Unwatch";
  const supported = "Notification" in window && "PushManager" in window && "serviceWorker" in navigator;
  el("alert-close").disabled = busy;
  el("test-notification").disabled = busy || !supported || !config?.key;
  el("alert-save").disabled = busy || !supported || !config?.key;
  period.disabled = el("alert-threshold").disabled = el("alert-remove").disabled = busy;
  status.textContent = fixtureMode ? "Push alerts are available in live mode." : !supported ? "Push requires a supported browser or installed PWA." : configFailed ? "Alert service unavailable. Reopen the dashboard to retry." : !config?.key ? "Connecting to the alert service…" : rule ? "Active at "+rule.threshold.toFixed(2)+" pp." : "Notify me when the absolute gap reaches this threshold from below.";
}
let stopReading = () => {};
function showDistance() {
  if (!dialog.open) return;
  const gap=latestGap(period.value,pair);
  const threshold=el("alert-threshold");
  el("current-gap").textContent = gap == null ? "—" : gap.toFixed(2)+" pp";
  const distance = Math.round((gap-threshold.valueAsNumber)*100);
  el("gap-distance").textContent = gap == null ? "Waiting for a reading…" : !threshold.validity.valid ? "Enter a positive threshold." :
    distance<0 ? (-distance/100).toFixed(2)+" pp below threshold." :
    (distance===0 ? "At threshold." : (distance/100).toFixed(2)+" pp above threshold.")+" A new crossing requires a drop below the threshold first.";
}
function followPeriod() {
  stopReading();stopReading=()=>{};
  showDistance();
  const frame=period.value;
  if (frame===el("frame").value && latestGap(frame,pair)!=null) return;
  const live=document.documentElement.dataset.liveFeed;
  if (live && !fixtureMode) {
    const socket=new WebSocket(live+"?v="+frame+"&seconds=10");
    socket.onmessage=({data})=>{const msg=JSON.parse(data);if(msg.data)recordGaps(frame,pairsFor(normalize(msg.data)),msg.time);};
    stopReading=()=>socket.close();
    return;
  }
  const controller=new AbortController();
  const read=async()=>{
    try {
      const path=fixtureMode && live ? "./data/fixture-"+frame+".json" : (fixtureMode?"./fixture-feed":"./feed")+"?v="+frame;
      const response=await fetch(path,{cache:"no-store",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8500)])});
      if (!response.ok) throw Error();
      const data=await response.json();
      if (!controller.signal.aborted) recordGaps(frame,pairsFor(normalize(data.data || data)),data.time || new Date().toISOString());
    } catch {if(!controller.signal.aborted) el("gap-distance").textContent="Latest reading unavailable.";}
  };
  read();
  const timer=setInterval(read,10000);
  stopReading=()=>{clearInterval(timer);controller.abort();};
}
window.addEventListener("gap-reading",showDistance);
const thresholdInput = el("alert-threshold");
function formatThreshold() {
  if (thresholdInput.value && thresholdInput.validity.valid)
    thresholdInput.value = thresholdInput.valueAsNumber.toFixed(2);
}
thresholdInput.oninput = event => {
  // Native steppers emit a plain input event; leave typed partial decimals alone.
  if (!(event instanceof InputEvent)) formatThreshold();
  showDistance();
};
thresholdInput.onblur = formatThreshold;
thresholdInput.onkeydown = event => {
  if (!["ArrowUp","ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  if (event.key === "ArrowUp") thresholdInput.stepUp();
  else thresholdInput.stepDown();
  formatThreshold();
  showDistance();
};
function loadThreshold() {
  el("alert-threshold").value = (readRule(pair,period.value)?.threshold ?? 1).toFixed(2);
  sync();
  followPeriod();
}
function alertsChanged() {
  window.dispatchEvent(new Event("gap-alerts-changed"));
  refreshStatus();
}
function redraw() { window.dispatchEvent(new Event("pair-preferences")); }
window.pairPreferences = {watched,close,decorate};
filter.checked = localStorage.getItem("fx-only-watched")==="1";
filter.onchange = () => {localStorage.setItem("fx-only-watched",filter.checked?"1":"0");redraw();};
table.onclick = event => {
  const button = event.target.closest(".alert-action");
  if (!button || busy || clearing) return;
  pair = button.closest("tr").dataset.pair;
  el("alert-title").textContent = pair+" gap alert";
  const selected = button.dataset.frame || el("frame").value;
  period.value = readRule(pair,selected) ? selected : framesFor(pair)[0]?.value || selected;
  dialog.showModal();
  loadThreshold();
  decorate();
};
dialog.addEventListener("close",()=>{
  stopReading();
  const row = [...table.rows].find(row=>row.dataset.pair===pair);
  (row?.querySelector(".alert-action") || filter).focus({preventScroll:true});
  pair=undefined;
});
period.onchange = loadThreshold;
el("alert-close").onclick = () => {close();decorate();};
dialog.addEventListener("cancel",event=>{if(busy) event.preventDefault();});
async function deviceSubscription() {
  if (await Notification.requestPermission() !== "granted") throw Error("Allow notifications in this browser to receive alerts.");
  const registration=await navigator.serviceWorker.ready;
  return await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:config.key});
}
el("test-notification").onclick=async()=>{
  if (busy) return;
  busy=true;sync();status.textContent="Sending test notification…";
  let feedback;
  try {
    const subscription=await deviceSubscription();
    const token=crypto.randomUUID().replaceAll("-","")+crypto.randomUUID().replaceAll("-","");
    const result=await fetch(endpoint,{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({subscription})});
    if (!result.ok) throw Error("The push service could not accept the test notification.");
    feedback="Test sent. Check this device’s notifications.";
  } catch(err) {feedback=err.message;}
  busy=false;sync();status.textContent=feedback;
};
async function change(remove) {
  if (!pair || busy) return;
  const name=pair, frame=period.value, threshold=el("alert-threshold").valueAsNumber;
  const key=ruleKey(name,frame);
  if (remove && !readRule(name,frame)) {
    localStorage.removeItem(watchKey(name));close();redraw();return;
  }
  const token = readRule(name,frame)?.token || crypto.randomUUID().replaceAll("-","")+crypto.randomUUID().replaceAll("-","");
  busy=true;sync();
  status.textContent = remove ? "Removing alert…" : "Saving alert…";
  try {
    let body;
    if (!remove) {
      const subscription=await deviceSubscription();
      body=JSON.stringify({pair:name,frame,threshold,subscription});
    }
    const result=await fetch(endpoint,{method:remove?"DELETE":"PUT",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body});
    if (!result.ok) throw Error("Could not save the alert change.");
    if (remove) localStorage.removeItem(key);
    else localStorage.setItem(key,JSON.stringify({token,threshold}));
    localStorage.removeItem(watchKey(name));
    busy=false;close();redraw();alertsChanged();
  } catch(err) {busy=false;sync();if(pair===name) {status.dataset.error="true";status.textContent=err.message;}}
}
form.onsubmit = event => {event.preventDefault();change(false);};
el("alert-remove").onclick = () => change(true);
window.addEventListener("storage",()=>{sync();redraw();});
el("reset").addEventListener("click",()=>{filter.checked=false;localStorage.removeItem("fx-only-watched");close();redraw();});
redraw();
