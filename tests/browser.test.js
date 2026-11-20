import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fixture, codes } from "../app/model.js";

test("production dashboard: controls, snapshots, layout and offline reload", async (t) => {
  const server = spawn(process.execPath, ["server.js", "--production"], {
    env: { ...process.env, PORT: "0" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  t.after(() => server.kill());
  // Use a dedicated test port assigned by the OS.
  const url = String((await once(server.stdout, "data"))[0])
    .trim()
    .split(" ")
    .at(-1);
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "chrome",
  });
  t.after(() => browser.close());
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url + "?mode=fixture");
  const rows = page.locator("#pairs tr");
  await page.waitForSelector("#currency-EUR");
  assert.equal(await page.locator(".column").count(), 8);
  assert.equal(await rows.count(), 28);
  for (const [id, str] of [
    ["high", "EUR+0.50%"],
    ["low", "JPY-0.40%"],
    ["wide", "EUR/JPY0.90 pp"],
  ])
    assert.equal(await page.locator("#" + id).textContent(), str);
  for (const [name, result] of [
    ["EUR/USD", "EUR +0.50% · USD 0.00%0.50BUY"],
    ["USD/CAD", "USD 0.00% · CAD +0.10%0.10SELL"],
    ["GBP/AUD", "GBP +0.20% · AUD +0.20%0.00NEUTRAL"],
  ])
    assert.equal(
      (await rows.filter({ hasText: name }).locator("td").allTextContents()).slice(0,3).join(""),
      name + result,
    );
  assert.equal(await rows.first().locator("td").count(),4);
  assert.match(await page.locator("#fetch-time").innerText(),/^[A-Z][a-z]{2}, \d{2} \d{4} · /);
  assert.equal(await page.locator("#frame, #alert-frame").count(),0);
  assert.equal((await page.request.get(new URL("/fixture-feed?v=2", url).href)).status(),400);
  await page.getByRole("button", {name:"Watch",exact:true}).first().click();
  const alert = page.getByRole("dialog", {name:"EUR/JPY gap alert"});
  assert.equal(await alert.isVisible(),true);
  assert.match(await alert.innerText(),/Current daily gap\s+0\.90 pp/);
  assert.equal(await alert.locator("select").count(),1);
  assert.equal(await page.inputValue("#alert-threshold"),"1.00");
  await page.selectOption("#alert-direction","down");
  assert.equal(await page.inputValue("#alert-threshold"),"0.80");
  await page.fill("#alert-threshold","0.70");
  await page.selectOption("#alert-direction","up");
  assert.equal(await page.inputValue("#alert-threshold"),"0.70");
  await page.getByRole("button", {name:"Close gap alert"}).click();
  for (const [q, n] of [
    ["jpy", 7],
    ["eur/usd", 1],
    ["EURUSD", 1],
    ["", 28],
  ]) {
    await page.fill("#query", q);
    assert.equal(await rows.count(), n);
  }
  for (const [sort, first] of [
    ["wide", "EUR/JPY"],
    ["narrow", "GBP/AUD"],
    ["high", "EUR/JPY"],
    ["low", "NZD/CAD"],
    ["az", "AUD/CAD"],
    ["za", "USD/JPY"],
  ]) {
    await page.selectOption("#sort", sort);
    assert.equal(await rows.first().locator("td b").innerText(), first);
  }
  await page.click("#theme");
  const theme = await page.locator("html").getAttribute("data-theme");
  for (const width of [320, 390, 420, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((r) =>
        navigator.serviceWorker.addEventListener("controllerchange", r, {
          once: true,
        }),
      );
  });
  assert.equal(await page.inputValue("#interval"),"30");
  assert.deepEqual(await page.locator("#interval option").evaluateAll(options => options.map(option => option.value)), ["10","30","60","0"]);
  await page.fill("#query","JPY");
  await page.evaluate(() => {
    localStorage.setItem("fx-frame","2");
    localStorage.setItem("fx-refresh-interval","5");
  });
  await page.reload();
  assert.equal(await page.inputValue("#interval"),"10");
  assert.equal(await page.evaluate(() => localStorage.getItem("fx-refresh-interval")),"10");
  assert.match(await page.locator(".panel-head").first().innerText(),/Daily · Relative to USD/);
  await page.waitForSelector("#pairs td b");
  assert.equal(await rows.count(),7);
  await page.selectOption("#interval","0");
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("Cached"),
  );
  assert.equal(await rows.count(), 7);
  assert.equal(await page.inputValue("#interval"), "0");
  assert.equal(await page.inputValue("#query"), "JPY");
  assert.equal(await page.inputValue("#sort"), "za");
  assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
  await context.setOffline(false);
  await page.click("#reset");
  for(const [id,value] of [["query",""],["sort","wide"],["interval","30"]]) assert.equal(await page.inputValue("#"+id),value);
  assert.ok(await page.evaluate(()=>document.documentElement.dataset.theme===(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light")));
  await page.reload();
  assert.equal(await page.inputValue("#interval"),"30");
  const live = await browser.newContext({ serviceWorkers: "block" });
  const view = await live.newPage();
  await view.clock.install();
  let count = 0,
    data = fixture,
    release;
  await view.route("**/feed", async (route) => {
    count++;
    if (count === 2)
      await new Promise((r) => {
        release = r;
      });
    await route.fulfill({ json: data });
  });
  await view.goto(url);
  await view.waitForSelector("#currency-EUR");
  const saved = () => view.evaluate(() => localStorage.getItem("snapshot"));
  const original = await saved();
  await view.selectOption("#interval", "0");
  await view.clock.fastForward(60000);
  assert.equal(count, 1);
  data = { EUR: 99 };
  await view.selectOption("#interval", "30");
  await view.waitForRequest("**/feed", { timeout: 500 }).catch(() => {});
  await view.selectOption("#interval", "60");
  assert.equal(count, 2);
  release();
  await view.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("Cached"),
  );
  assert.equal(await saved(), original);
  data = Object.fromEntries(codes.map((c) => [c, 0]));
  await view.clock.fastForward(30000);
  assert.equal(count, 2);
  await view.clock.fastForward(30000);
  await view.waitForFunction(
    () => document.querySelectorAll("mark.flat").length === 28,
  );
  assert.equal(await view.locator("#wide").textContent(), "EUR/GBP0.00 pp");
});


