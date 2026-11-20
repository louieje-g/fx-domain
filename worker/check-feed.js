import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { normalize } from "../app/model.js";

const endpoint = new URL(process.argv[2]);
endpoint.search = new URLSearchParams({v:"1", seconds:"10"});
const browser = await chromium.launch({channel:"chrome"});
try {
  const page = await browser.newPage();
  await page.goto("https://fx-domain.web.app/");
  const streams = await page.evaluate(url => Promise.all([0,1].map(() => new Promise((resolve,reject) => {
    const ws = new WebSocket(url);
    const frames = [];
    const timeout = setTimeout(() => { ws.close(); reject(Error("Timed out")); }, 85000);
    ws.onerror = () => reject(Error("WebSocket failed"));
    ws.onmessage = ({data}) => {
      frames.push(JSON.parse(data));
      if (frames.length === 8) {
        clearTimeout(timeout);
        ws.close();
        resolve(frames);
      }
    };
  }))), endpoint.href);
  for (const frames of streams) {
    const times = frames.map(frame => {
      assert.equal(frame.v,"1");
      normalize(frame.data);
      return Date.parse(frame.time);
    });
    const unique = [...new Set(times)];
    assert.ok(unique.length >= 3 && unique.length < times.length);
    const cadence = (unique.at(-1)-unique[0])/(unique.length-1);
    assert.ok(cadence >= 24500 && cadence < 27000, "Unexpected average Finviz interval: "+cadence);
    console.log(frames.length+" deliveries, "+unique.length+" Finviz readings, average poll interval "+Math.round(cadence)+" ms");
  }
  const unique = new Set(streams[0].map(frame => frame.time));
  const shared = [...unique].filter(time => streams[1].some(frame => frame.time === time));
  assert.ok(shared.length >= 2, "Clients did not receive shared observations");
} finally {
  await browser.close();
}
