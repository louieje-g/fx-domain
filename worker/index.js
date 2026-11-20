import { GapAlerts } from "./gap-alerts.js";
import { DurableObject } from "cloudflare:workers";
import { readPerformance } from "../feed.js";

const minimumDashboardInterval = 10000;
const pollInterval = 25000;
const dailyFrame = "1";

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (request.headers.get("Origin") !== "https://fx-domain.web.app")
      return new Response("Forbidden", {status:403});
    if (url.pathname === "/alerts") return env.FEED.getByName("market-monitor").fetch(request);
    if (url.pathname !== "/feed") return new Response("Not found", {status:404});
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return new Response("WebSocket required", {status:426});
    if (url.searchParams.get("v") !== dailyFrame ||
        !["10","30","60"].includes(url.searchParams.get("seconds")))
      return new Response("Invalid subscription", {status:400});
    return env.FEED.getByName("market-monitor").fetch(request);
  }
};

export class SharedFeed extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env);
    this.alerts=new GapAlerts(ctx.storage);
    ctx.blockConcurrencyWhile(async()=>{
      await this.alerts.init();
      this.nextPollAt = await ctx.storage.get("next-poll-at") ?? 0;
      this.reading = await ctx.storage.get("daily-reading");
      this.throttle = await ctx.storage.get("finviz-throttle") || {until:0,delay:0};
    });
  }
  async fetch(request) {
    if (new URL(request.url).pathname === "/alerts") return this.alerts.handle(request);
    const params = new URL(request.url).searchParams;
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({v:params.get("v"), interval:Number(params.get("seconds"))*1000, due:0});
    const tick = Date.now() + 1;
    const scheduled = await this.ctx.storage.getAlarm();
    if (scheduled === null || scheduled > tick) await this.ctx.storage.setAlarm(tick);
    return new Response(null, {status:101, webSocket:client});
  }

  async alarm() {
    const now = Date.now();
    const sockets = [];
    let nextDelivery = Infinity;
    for (const socket of this.ctx.getWebSockets()) {
      const sub = socket.deserializeAttachment();
      if (sub?.v !== dailyFrame) { socket.close(1000); continue; }
      if (sub.due <= now) {
        sockets.push(socket);
        sub.due = now + Math.max(minimumDashboardInterval, sub.interval);
        socket.serializeAttachment(sub);
      }
      nextDelivery = Math.min(nextDelivery, sub.due);
    }
    const hasAlerts = [...this.alerts.rules.values()].some(rule => rule.frame === dailyFrame);
    if (!hasAlerts && !Number.isFinite(nextDelivery)) return;

    let freshData;
    if (now >= this.pollDueAt()) {
      this.nextPollAt = now + pollInterval;
      await this.ctx.storage.put("next-poll-at", this.nextPollAt);
      freshData = await this.pollFinviz();
    }

    const reading = this.reading ?? {v:dailyFrame,error:"Finviz unavailable"};
    const message = JSON.stringify(reading);
    for (const socket of sockets) {
      try { socket.send(message); } catch {}
    }
    const next = Math.min(nextDelivery, this.pollDueAt());
    const scheduled = await this.ctx.storage.getAlarm();
    if (scheduled === null || next < scheduled) await this.ctx.storage.setAlarm(next);
    if (freshData && hasAlerts) await this.alerts.evaluate(dailyFrame, freshData);
  }

  pollDueAt() {
    return Math.max(this.nextPollAt, this.throttle.until);
  }

  async pollFinviz() {
    if (this.throttle.delay && Date.now() > this.throttle.until + 3600000) {
      this.throttle = {until:0,delay:0};
      await this.ctx.storage.delete("finviz-throttle");
    }

    let data;
    try {
      data = await readPerformance(dailyFrame);
      this.reading = {v:dailyFrame,data,time:new Date().toISOString()};
    } catch (error) {
      this.reading = {v:dailyFrame,error:"Finviz unavailable"};
      if (error.status === 429) {
        const delay = Math.max(error.retryMs, Math.min(900000, Math.max(60000, this.throttle.delay * 2)));
        this.throttle = {until:Date.now() + delay,delay};
        await this.ctx.storage.put("finviz-throttle", this.throttle);
        this.reading.retryAt = this.throttle.until;
        console.warn("Finviz rate limit; next retry in seconds", delay / 1000);
      }
    }
    await this.ctx.storage.put("daily-reading", this.reading);
    return data;
  }

  webSocketClose(socket) { socket.close(1000); }
}
