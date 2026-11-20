import test from "node:test";
import assert from "node:assert/strict";
import {createAlerts} from "../alerts.js";
import {fixture} from "../app/model.js";

test("a closed-client rule triggers once per crossing and re-arms below threshold",async()=>{
  let change = -0.5;
  const sent = [];
  const alerts = createAlerts(":memory:",async()=>({...fixture,EUR:change}),async(sub,payload)=>sent.push(JSON.parse(payload)));
  alerts.save("device",{pair:"EUR/USD",frame:"1",threshold:1,subscription:{endpoint:"https://fcm.googleapis.com/test",keys:{auth:"a".repeat(22),p256dh:"a".repeat(87)}}});
  await alerts.poll();
  for (change of [-1,-1.2,0.99,1.1]) await alerts.poll();
  assert.deepEqual(sent.map(m=>m.gap),[1,1.1]);
  alerts.remove("device");
  for (change of [0,2]) await alerts.poll();
  assert.equal(sent.length,2);
});

test("production rule builds an authenticated encrypted push on crossing",async t=>{
  const {GapAlerts}=await import("../worker/gap-alerts.js");
  const storage=new Map();
  const engine=new GapAlerts({list:async()=>new Map(),get:k=>storage.get(k),put:(k,v)=>storage.set(k,v),getAlarm:()=>null,setAlarm:()=>{}});
  await engine.init();
  const keys=await crypto.subtle.generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveBits"]);
  const p256dh=Buffer.from(await crypto.subtle.exportKey("raw",keys.publicKey)).toString("base64url");
  const subscription={endpoint:"https://fcm.googleapis.com/test",keys:{p256dh,auth:Buffer.alloc(16,1).toString("base64url")}};
  const response=await engine.handle(new Request("https://example.test/alerts",{method:"PUT",headers:{Authorization:"Bearer "+"1".repeat(64)},body:JSON.stringify({subscription,pair:"EUR/USD",frame:"1",threshold:1})}));
  assert.equal(response.status,204);
  const send=t.mock.method(globalThis,"fetch",async()=>new Response(null,{status:201}));
  for (const EUR of [0.5,-1.1,-1.2]) await engine.evaluate("1",{...fixture,EUR});
  assert.equal(send.mock.callCount(),1);
  const [,request]=send.mock.calls[0].arguments;
  assert.equal(new Headers(request.headers).get("Content-Encoding"),"aes128gcm");
  assert.match(new Headers(request.headers).get("Authorization"),/^vapid /i);
  assert.ok(request.body.byteLength>0);
});

test("last hit persists after restart and is independent of push delivery",async t=>{
  const {mkdtempSync}=await import("node:fs");
  const {tmpdir}=await import("node:os");
  const {join}=await import("node:path");
  const file=join(mkdtempSync(join(tmpdir(),"fx-alert-test-")),"rules.sqlite");
  let gap=1.2;
  const engine=createAlerts(file,async()=>({...fixture,EUR:gap}),async()=>{throw Error("Temporary push failure");});
  engine.save("device",{pair:"EUR/USD",frame:"1",threshold:1,subscription:{endpoint:"https://fcm.googleapis.com/test",keys:{auth:"a".repeat(22),p256dh:"a".repeat(87)}}});
  await engine.poll();
  assert.equal(engine.status("device").lastHit,null);
  gap=.8;await engine.poll();
  gap=1;await engine.poll();
  const hit=engine.status("device").lastHit;
  assert.ok(Date.parse(hit));
  gap=.9;await engine.poll();
  const restored=createAlerts(file).status("device");
  assert.equal(restored.lastHit,hit);
  assert.equal(restored.gap,.9);
});

test("down alerts fire on equality and re-arm only above the threshold",async()=>{
  let gap=.5;
  const sent=[];
  const engine=createAlerts(":memory:",async()=>({...fixture,EUR:gap}),async(_,payload)=>sent.push(JSON.parse(payload)));
  engine.save("device",{pair:"EUR/USD",frame:"1",direction:"down",threshold:.5,subscription:{endpoint:"https://fcm.googleapis.com/test",keys:{auth:"a".repeat(22),p256dh:"a".repeat(87)}}});
  for(gap of [.5,.48,.56,.50,.49,.52,.48]) await engine.poll();
  assert.deepEqual(sent.map(msg=>[msg.direction,msg.gap]),[["down",.5],["down",.48]]);
  assert.equal(engine.status("device").direction,"down");
});
