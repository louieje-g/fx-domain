import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { fixture } from "../app/model.js";

const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "cloudflare:workers")
      return {url:"data:text/javascript,export class DurableObject { constructor(ctx) { this.ctx = ctx; } }",shortCircuit:true};
    return next(specifier,context);
  }
});
const {SharedFeed} = await import("../worker/index.js");
hook.deregister();

test("dashboard delivery reuses the 25-second Finviz poll and alerts keep polling without viewers", async t => {
  const epoch = Date.UTC(2026,0,1);
  t.mock.timers.enable({apis:["Date"],now:epoch});
  const requests = [];
  let rateLimited = false;
  t.mock.method(globalThis,"fetch",async url => {
    assert.equal(url,"https://finviz.com/api/forex_perf?v=1");
    requests.push(Date.now()-epoch);
    if (rateLimited) return new Response(null,{status:429,headers:{"Retry-After":"60"}});
    return Response.json({...fixture,EUR:requests.length});
  });
  const stored = new Map([["rule:daily",{frame:"1"}]]);
  const sockets = [];
  let alarm = null;
  const storage = {
    list: async () => new Map([...stored].filter(([key])=>key.startsWith("rule:"))),
    get: async key => stored.get(key),
    put: async (key,value) => stored.set(key,value),
    getAlarm: async () => alarm,
    setAlarm: async time => { alarm = time; }
  };
  let ready;
  const ctx = {storage,getWebSockets:()=>sockets,blockConcurrencyWhile:init=>{ready=init();}};
  const deliveries = [];
  let attachment = {v:"1",interval:10000,due:0};
  sockets.push({
    deserializeAttachment:()=>attachment,
    serializeAttachment:value=>{attachment=value;},
    send:message=>deliveries.push([Date.now()-epoch,JSON.parse(message)])
  });
  let worker;
  const evaluated = [];
  async function startWorker() {
    worker = new SharedFeed(ctx);
    await ready;
    t.mock.method(worker.alerts,"evaluate",async (frame,data)=>evaluated.push([Date.now()-epoch,frame,data.EUR]));
  }
  async function runAt(ms) {
    t.mock.timers.setTime(epoch+ms);
    alarm = null;
    await worker.alarm();
  }

  await startWorker();
  await runAt(0);
  await runAt(10000);
  await startWorker();
  await runAt(20000);
  await runAt(25000);
  await runAt(30000);
  await runAt(40000);
  await runAt(50000);
  assert.deepEqual(requests,[0,25000,50000]);
  assert.deepEqual(deliveries.map(([at,msg])=>[at,msg.data.EUR]),[[0,1],[10000,1],[20000,1],[30000,2],[40000,2],[50000,3]]);
  assert.equal(deliveries[0][1].time,deliveries[1][1].time);
  assert.deepEqual(evaluated,[[0,"1",1],[25000,"1",2],[50000,"1",3]]);

  sockets.length = 0;
  await runAt(60000);
  assert.equal(alarm,epoch+75000);
  await runAt(75000);
  assert.deepEqual(evaluated.at(-1),[75000,"1",4]);

  rateLimited = true;
  await runAt(100000);
  assert.equal(alarm,epoch+160000);
  await runAt(125000);
  assert.equal(requests.at(-1),100000);
  assert.deepEqual(evaluated.at(-1),[75000,"1",4]);
  rateLimited = false;
  await runAt(160000);
  assert.equal(requests.at(-1),160000);

  worker.alerts.rules.clear();
  await runAt(185000);
  assert.equal(alarm,null);
  assert.equal(requests.at(-1),160000);
});
