import { GapAlerts } from "./gap-alerts.js";
import { DurableObject } from "cloudflare:workers";
import { readPerformance } from "../feed.js";

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (request.headers.get("Origin") !== "https://fx-domain.web.app")
      return new Response("Forbidden", {status:403});
    if (url.pathname === "/alerts") return env.FEED.getByName("market-monitor").fetch(request);
    if (url.pathname !== "/feed") return new Response("Not found", {status:404});
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return new Response("WebSocket required", {status:426});
    if (!/^[1-8]$/.test(url.searchParams.get("v")) ||
        !["5","10","30","60"].includes(url.searchParams.get("seconds")))
      return new Response("Invalid subscription", {status:400});
    return env.FEED.getByName("market-monitor").fetch(request);
  }
};

export class SharedFeed extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env);
    this.alerts=new GapAlerts(ctx.storage);
    this.latest = new Map();
    ctx.blockConcurrencyWhile(async()=>{
      await this.alerts.init();
      this.throttle = await ctx.storage.get("finviz-throttle") || {until:0,delay:0};
    });
  }
  async fetch(request) {
    if (new URL(request.url).pathname === "/alerts") return this.alerts.handle(request);
    const params = new URL(request.url).searchParams;
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({v:params.get("v"), interval:Number(params.get("seconds"))*1000, due:0});
    const tick = (Math.floor(Date.now() / 5000) + 1) * 5000;
    const scheduled = await this.ctx.storage.getAlarm();
    if (scheduled === null || scheduled > tick) await this.ctx.storage.setAlarm(tick);
    return new Response(null, {status:101, webSocket:client});
  }

  async alarm() {
    const now = Date.now();
    const groups = new Map();
    let next = Infinity;
    for (const socket of this.ctx.getWebSockets()) {
      const sub = socket.deserializeAttachment();
      if (sub.due <= now) {
        const sockets = groups.get(sub.v) ?? [];
        sockets.push(socket);
        groups.set(sub.v, sockets);
        sub.due = Math.floor(now / 5000) * 5000 + sub.interval;
        socket.serializeAttachment(sub);
      }
      next = Math.min(next, sub.due);
    }
    const checkAlerts=this.alerts.rules.size && !(this.nextAlertCheck > now);
    if (checkAlerts) {
      this.nextAlertCheck=Math.floor(now/5000)*5000+10000;
      for (const {frame} of this.alerts.rules.values()) if (!groups.has(frame)) groups.set(frame,[]);
    }
    if (this.alerts.rules.size) next=Math.min(next,this.nextAlertCheck);
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(next);
    for (const [v, sockets] of groups) {
      let message=this.latest.get(v);
      if (this.throttle.delay && Date.now() > this.throttle.until + 3600000) {
        this.throttle={until:0,delay:0};
        await this.ctx.storage.delete("finviz-throttle");
      }
      const limited = Date.now() < this.throttle.until;
      const recentlyRead = message && Date.now()-Date.parse(message.time) < (this.throttle.delay ? 30000 : 0);
      let fresh=false;
      if (!limited && !recentlyRead) try {
        const data = await readPerformance(v);
        message = {v, data, time:new Date().toISOString()};
        this.latest.set(v,message);
        fresh=true;
      } catch (error) {
        if (error.status===429) {
          const delay=Math.max(error.retryMs,Math.min(900000,Math.max(60000,this.throttle.delay*2)));
          this.throttle={until:Date.now()+delay,delay};
          await this.ctx.storage.put("finviz-throttle",this.throttle);
          console.warn("Finviz rate limit; next retry in seconds",delay/1000);
        }
        message = {v, error:"Finviz unavailable"};
      }
      if (limited || !message) message={v,error:"Finviz unavailable"};
      if (message.error && this.throttle.until>Date.now()) message.retryAt=this.throttle.until;
      for (const socket of sockets) {
        try { socket.send(JSON.stringify(message)); } catch {}
      }
      if (fresh && this.alerts.rules.size) await this.alerts.evaluate(v,message.data);
    }
  }

  webSocketClose(socket) { socket.close(1000); }
}
