import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as webpush from "web-push";
import { readPerformance } from "./feed.js";
import { pairsFor, fixture } from "./app/model.js";

export function createAlerts(file, read = readPerformance, send = webpush.sendNotification.bind(webpush)) {
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value TEXT); CREATE TABLE IF NOT EXISTS alerts (id TEXT PRIMARY KEY, subscription TEXT, pair TEXT, frame TEXT, threshold REAL, above INTEGER)");
  const columns=db.prepare("PRAGMA table_info(alerts)").all().map(c=>c.name);
  for (const [name,type] of [["lastHit","TEXT"],["gap","REAL"],["seen","TEXT"],["pending","INTEGER"],["direction","TEXT DEFAULT 'up'"]]) {
    if (!columns.includes(name)) db.exec("ALTER TABLE alerts ADD COLUMN "+name+" "+type);
  }
  let keys = db.prepare("SELECT value FROM settings WHERE name='vapid'").get();
  if (!keys) {
    db.prepare("INSERT INTO settings VALUES ('vapid',?)").run(JSON.stringify(webpush.generateVAPIDKeys()));
    keys = db.prepare("SELECT value FROM settings WHERE name='vapid'").get();
  }
  const vapidDetails = {subject:"mailto:alerts@localhost.localdomain", ...JSON.parse(keys.value)};
  const names = new Set(pairsFor(fixture).map(p => p.name));
  function validate(rule) {
    const {subscription, pair, frame, threshold} = rule;
    const url = new URL(subscription.endpoint);
    if (url.protocol !== "https:" || url.port || url.username || url.password ||
        !/^(fcm\.googleapis\.com|(?:[a-z0-9-]+\.)*push\.apple\.com|(?:[a-z0-9-]+\.)*push\.services\.mozilla\.com|(?:[a-z0-9-]+\.)*notify\.windows\.com)$/.test(url.hostname) ||
        !names.has(pair) || frame !== "1" || !Number.isFinite(threshold) || !["up","down"].includes(rule.direction ?? "up") || threshold < 0 || (threshold === 0 && rule.direction !== "down") ||
        !/^[\w-]{87}$/.test(subscription.keys?.p256dh) || !/^[\w-]{22}$/.test(subscription.keys?.auth)) throw Error("Invalid alert");
  }
  function save(id,rule) {
    validate(rule);
    const {subscription,pair,frame,threshold}=rule;
    db.prepare("INSERT INTO alerts (id,subscription,pair,frame,threshold,direction) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET subscription=excluded.subscription, pair=excluded.pair, frame=excluded.frame, threshold=excluded.threshold, direction=excluded.direction, above=CASE WHEN alerts.threshold=excluded.threshold AND alerts.direction=excluded.direction AND alerts.frame=excluded.frame AND alerts.pair=excluded.pair THEN alerts.above END, lastHit=CASE WHEN alerts.threshold=excluded.threshold AND alerts.direction=excluded.direction AND alerts.frame=excluded.frame AND alerts.pair=excluded.pair THEN alerts.lastHit END, pending=0, gap=NULL, seen=NULL").run(id,JSON.stringify(subscription),pair,frame,threshold,rule.direction ?? "up");
  }
  let running = false;
  async function poll() {
    if (running) return;
    running = true;
    try {
      for (const {frame} of db.prepare("SELECT DISTINCT frame FROM alerts WHERE frame='1'").all()) {
        let pairs;
        try { pairs = pairsFor(await read(frame)); } catch { continue; }
        for (const row of db.prepare("SELECT * FROM alerts WHERE frame=?").all(frame)) {
          const gap = pairs.find(p => p.name === row.pair).gap;
          const above = Number(row.direction==="down" ? gap <= row.threshold : gap >= row.threshold);
          const seen=new Date().toISOString();
          const crossed=above && row.above===0;
          const pending=above && (crossed || row.pending);
          db.prepare("UPDATE alerts SET above=?,gap=?,seen=?,lastHit=?,pending=? WHERE id=?").run(above,gap,seen,crossed?seen:row.lastHit,Number(Boolean(pending)),row.id);
          const match = [row.id,row.pair,row.frame,row.threshold,row.subscription,row.direction];
          if (pending) {
            try {
              await send(JSON.parse(row.subscription),JSON.stringify({pair:row.pair,frame,threshold:row.threshold,direction:row.direction,gap}),{vapidDetails,TTL:300,timeout:8000});
            } catch (err) {
              if ([404,410].includes(err.statusCode)) db.prepare("DELETE FROM alerts WHERE id=? AND pair=? AND frame=? AND threshold=? AND subscription=? AND direction=?").run(...match);
              continue;
            }
          }
          if (pending) db.prepare("UPDATE alerts SET pending=0 WHERE id=? AND pair=? AND frame=? AND threshold=? AND subscription=? AND direction=?").run(...match);
        }
      }
    } finally { running = false; }
  }
  return {publicKey:vapidDetails.publicKey,save,poll,status:id=>db.prepare("SELECT gap,seen,lastHit,threshold,direction FROM alerts WHERE id=?").get(id) ?? null,async sendTest(subscription) {
    validate({subscription,pair:"EUR/USD",frame:"1",threshold:1});
    await send(subscription,JSON.stringify({type:"test"}),{vapidDetails,TTL:60,timeout:8000});
  },remove:id=>db.prepare("DELETE FROM alerts WHERE id=?").run(id)};
}

export function localAlerts(port) {
  mkdirSync(".local-alerts",{recursive:true});
  let file = port ? ".local-alerts/alerts-"+port+".sqlite" : ":memory:";
  const legacy = ".local-alerts/alerts.sqlite";
  if (port && existsSync(legacy)) {
    // Assign pre-upgrade subscriptions to one preview origin only.
    const owner = ".local-alerts/legacy-port";
    try {writeFileSync(owner,String(port),{flag:"wx"});}
    catch (error) {if(error.code!=="EEXIST") throw error;}
    if (readFileSync(owner,"utf8")===String(port)) file=legacy;
  }
  const alerts = createAlerts(file);
  setInterval(()=>alerts.poll().catch(console.error),10000).unref();
  return async (req,res) => {
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host)) return res.writeHead(403).end();
    res.setHeader("Cache-Control","no-store");
    if (req.method==="GET") return res.end(JSON.stringify({key:alerts.publicKey}));
    if (req.method==="POST" && new URL(req.url,"http://localhost").searchParams.has("status")) {
      if (req.headers.origin !== "http://"+req.headers.host) return res.writeHead(403).end();
      let body="";
      for await (const chunk of req) {body+=chunk;if(body.length>20000)return res.writeHead(413).end();}
      try {
        const ids=JSON.parse(body);
        if (!Array.isArray(ids)||ids.length>224||!ids.every(id=>typeof id==="string" && /^[a-f0-9]{64}$/.test(id))) throw Error();
        return res.end(JSON.stringify(ids.map(alerts.status)));
      } catch {return res.writeHead(400).end();}
    }
    if (req.headers.origin !== "http://"+req.headers.host || !/^Bearer [a-f0-9]{64}$/.test(req.headers.authorization ?? "")) return res.writeHead(403).end();
    const id = req.headers.authorization.slice(7);
    if (req.method==="DELETE") alerts.remove(id);
    else if (req.method==="PUT" || req.method==="POST") {
      let body="";
      for await (const chunk of req) {body+=chunk; if(body.length>8192) return res.writeHead(413).end();}
      if (req.method==="POST") {
        try {await alerts.sendTest(JSON.parse(body).subscription);} catch {return res.writeHead(400).end();}
        return res.writeHead(204).end();
      }
      try {alerts.save(id,JSON.parse(body));} catch {return res.writeHead(400).end();}
      void alerts.poll().catch(console.error);
    } else return res.writeHead(405).end();
    res.writeHead(204).end();
  };
}
