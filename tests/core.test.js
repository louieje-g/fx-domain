import test from "node:test";
import assert from "node:assert/strict";
import { fixture, pairsFor, codes } from "../app/model.js";
import { feed } from "../feed.js";

test("28 stable pairs, signed gaps, ties and zero rounding", () => {
  const pairs = pairsFor(fixture);
  assert.equal(new Set(pairs.map((p) => p.name)).size, 28);
  assert.equal(pairs.length, 28);
  for (const [name, gap] of [
    ["EUR/JPY", 0.9],
    ["EUR/USD", 0.5],
    ["USD/CAD", -0.1],
    ["GBP/AUD", 0],
  ])
    assert.equal(pairs.find((p) => p.name === name).gap, gap);
  const zero = Object.fromEntries(codes.map((code) => [code, 0]));
  assert.ok(pairsFor(zero).every((p) => Object.is(p.gap, 0)));
  assert.equal(pairsFor({ ...zero, GBP: 0.004 })[0].gap, 0);
});
test("feed normalizes percent units and rejects whole malformed responses", async () => {
  const read = (payload) => feed(async () => Response.json(payload));
  const good = await read({ ...fixture, BTC: 0.3 });
  assert.deepEqual(await good.json(), fixture);
  assert.equal(good.headers.get("cache-control"), "no-store");
  for (const payload of [
    null,
    {},
    { ...fixture, CHF: null },
    { ...fixture, EUR: "0.50" },
  ])
    assert.equal((await read(payload)).status, 502);
  assert.equal(
    (
      await feed(async () => {
        throw Error("timeout");
      })
    ).status,
    502,
  );
  assert.equal(
    (await feed(async () => new Response("", { status: 503 }))).status,
    502,
  );
});

test("Finviz direct returns take priority and USD-first legs compound correctly", async () => {
  const {performanceSnapshot} = await import("../history.js");
  const rows = [
    ["EURUSD",-0.22,-1.92], ["GBPUSD",-0.33,-1.09], ["NZDUSD",0.23,-2.30],
    ["AUDUSD",-0.85,-3.83], ["USDCAD",0.29,1.39], ["USDCHF",0.47,1.91],
    ["USDJPY",0.14,0.89], ["EURGBP",0.24,-0.82], ["GBPJPY",-0.25,-0.18],
  ].map(([ticker,perfWeekPct,perfMonthPct])=>({ticker,perfWeekPct,perfMonthPct}));
  const {returns} = performanceSnapshot(rows);
  assert.deepEqual(returns["EUR/GBP"],{week:0.24,month:-0.82,direct:true});
  assert.deepEqual(returns["GBP/JPY"],{week:-0.25,month:-0.18,direct:true});
  assert.deepEqual(returns["NZD/JPY"],{week:0.37,month:-1.43,direct:false});
  assert.deepEqual(returns["CAD/JPY"],{week:-0.15,month:-0.49,direct:false});
});
