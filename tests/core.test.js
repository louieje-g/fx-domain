import test from "node:test";
import assert from "node:assert/strict";
import { fixture, pairsFor, codes } from "../app/model.js";
import { feed } from "../feed.js";

test("28 stable pairs, absolute gaps, ties and zero rounding", () => {
  const pairs = pairsFor(fixture);
  assert.equal(new Set(pairs.map((p) => p.name)).size, 28);
  assert.equal(pairs.length, 28);
  for (const [name, gap] of [
    ["EUR/JPY", 0.9],
    ["EUR/USD", 0.5],
    ["USD/CAD", 0.1],
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

test("the feed requests only Daily from Finviz", async () => {
  const result = await feed(async url => {
    assert.equal(url, "https://finviz.com/api/forex_perf?v=1");
    return Response.json(fixture);
  });
  assert.equal(result.status, 200);
  const removed = await feed(() => assert.fail("Unexpected Finviz request"), "2");
  assert.equal(removed.status, 502);
});
