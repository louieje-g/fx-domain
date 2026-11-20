import {buildPushPayload} from "@block65/webcrypto-web-push";
import {pairsFor,fixture} from "../app/model.js";

const pairs = new Set(pairsFor(fixture).map(p=>p.name));
const headers = {"Access-Control-Allow-Origin":"https://fx-domain.web.app","Access-Control-Allow-Headers":"authorization, content-type","Access-Control-Allow-Methods":"GET, PUT, POST, DELETE, OPTIONS","Cache-Control":"no-store"};

export class GapAlerts {
  constructor(storage) { this.storage = storage; }
  async init() {
    this.rules = await this.storage.list({prefix:"rule:"});
    this.keys = await this.storage.get("push-keys");
    if (!this.keys) {
      const key = await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]);
      const raw = await crypto.subtle.exportKey("raw",key.publicKey);
      this.keys = {public:btoa(String.fromCharCode(...new Uint8Array(raw))).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,""), private:await crypto.subtle.exportKey("jwk",key.privateKey)};
      await this.storage.put("push-keys",this.keys);
    }
  }
  async send(subscription,data,ttl) {
    const payload=await buildPushPayload({data:JSON.stringify(data),options:{ttl}},subscription,{
      subject:"https://fx-domain.web.app/",publicKey:this.keys.public,privateKey:this.keys.private.d
    });
    const response=await fetch(subscription.endpoint,{...payload,redirect:"manual",signal:AbortSignal.timeout(8000)});
    if (!response.ok) console.warn("Push provider returned",response.status);
    return response;
  }
  async handle(request) {
    const reply = status=>new Response(null,{status,headers});
    if (request.method==="OPTIONS") return reply(204);
    if (request.method==="GET") return Response.json({key:this.keys.public},{headers});
    if (request.method==="POST" && new URL(request.url).searchParams.has("status")) {
      const ids=await request.json().catch(()=>null);
      if (!Array.isArray(ids)||ids.length>224||!ids.every(id=>typeof id==="string" && /^[a-f0-9]{64}$/.test(id))) return reply(400);
      return Response.json(ids.map(id=>{
        const rule=this.rules.get("rule:"+id);
        return rule ? {gap:rule.gap,seen:rule.seen,lastHit:rule.lastHit,threshold:rule.threshold,direction:rule.direction ?? "up"} : null;
      }),{headers});
    }
    const auth=request.headers.get("Authorization") || "";
    if (!/^Bearer [a-f0-9]{64}$/.test(auth)) return reply(403);
    const id="rule:"+auth.slice(7);
    if (request.method==="DELETE") {await this.remove(id); return reply(204);}
    if (!["POST","PUT"].includes(request.method)) return reply(405);
    if (Number(request.headers.get("Content-Length"))>8192) return reply(413);
    let rule;
    try {
      const body=await request.text();
      if (body.length>8192) return reply(413);
      const parsed=JSON.parse(body);
      const {pair,frame,threshold,subscription,direction="up"}=request.method==="POST" ? {pair:"EUR/USD",frame:"1",threshold:1,subscription:parsed.subscription} : parsed;
      const url=new URL(subscription.endpoint);
      if (!pairs.has(pair) || frame !== "1" || !Number.isFinite(threshold) || !["up","down"].includes(direction) || threshold<0 || (threshold===0 && direction!=="down") ||
          url.protocol!=="https:" || url.username || url.password || url.port ||
          !/^(fcm\.googleapis\.com|(?:[a-z0-9-]+\.)*push\.apple\.com|(?:[a-z0-9-]+\.)*push\.services\.mozilla\.com|(?:[a-z0-9-]+\.)*notify\.windows\.com)$/.test(url.hostname) ||
          !/^[\w-]{87}$/.test(subscription.keys?.p256dh) || !/^[\w-]{22}$/.test(subscription.keys?.auth)) return reply(400);
      rule={pair,frame,threshold,direction,subscription,above:null};
    } catch {return reply(400);}
    if (request.method==="POST") {
      try {
        const result=await this.send(rule.subscription,{type:"test"},60);
        return reply(result.ok ? 204 : 502);
      } catch(error) {console.error("Push failed:",error.name,error.message.replace(/https?:\/\/\S+/g,"[URL]"));return reply(502);}
    }
    const previous=this.rules.get(id);
    if (previous?.pair===rule.pair && previous.frame===rule.frame && previous.threshold===rule.threshold && (previous.direction ?? "up")===rule.direction) Object.assign(rule,{above:previous.above,lastHit:previous.lastHit ?? null});
    this.rules.set(id,rule);
    await this.storage.put(id,rule);
    const alarm=await this.storage.getAlarm();
    if (alarm===null || alarm>Date.now()+10000) await this.storage.setAlarm(Date.now()+1000);
    return reply(204);
  }
  async remove(id) {
    this.rules.delete(id);
    await this.storage.delete(id);
  }
  async evaluate(frame,data) {
    const gaps=new Map(pairsFor(data).map(p=>[p.name,p.gap]));
    await Promise.all([...this.rules].map(async ([id,rule])=>{
      if (rule.frame!==frame) return;
      const gap=gaps.get(rule.pair);
      const above=rule.direction==="down" ? gap<=rule.threshold : gap>=rule.threshold;
      const changed=above!==rule.above;
      rule.gap=gap;rule.seen=new Date().toISOString();
      if (above && rule.above===false) {rule.lastHit=rule.seen;rule.pending=true;}
      if (!above) rule.pending=false;
      rule.above=above;
      if (changed) await this.storage.put(id,rule);
      if (this.rules.get(id)!==rule || !rule.pending) return;
      {
        try {
          const response=await this.send(rule.subscription,{pair:rule.pair,frame,gap,threshold:rule.threshold,direction:rule.direction ?? "up"},300);
          if (this.rules.get(id)!==rule) return;
          if ([404,410].includes(response.status)) return this.remove(id);
          if (!response.ok) return;
        } catch {return;}
      }
      rule.pending=false;
      await this.storage.put(id,rule);
    }));
  }
}
