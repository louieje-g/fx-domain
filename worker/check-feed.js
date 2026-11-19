import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { normalize } from "../app/model.js";

const endpoint = new URL(process.argv[2]);
endpoint.search = new URLSearchParams({v:"1", seconds:"5"});
const browser = await chromium.launch({channel:"chrome"});
try {
  const page = await browser.newPage();
  await page.goto("https://fx-domain.web.app/");
  const streams = await page.evaluate(url => Promise.all([0,1].map(() => new Promise((resolve,reject) => {
    const ws = new WebSocket(url);
    const frames = [];
    const timeout = setTimeout(() => { ws.close(); reject(Error("Timed out")); }, 65000);
    ws.onerror = () => reject(Error("WebSocket failed"));
    ws.onmessage = ({data}) => {
      frames.push(JSON.parse(data));
      if (frames.length === 10) {
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
    const cadence = (times.at(-1)-times[0])/(times.length-1);
    assert.ok(times.slice(1).every((t,i) => t > times[i]));
    assert.ok(cadence > 4000 && cadence < 6000, "Unexpected average interval: "+cadence);
    console.log(frames.length+" valid readings, average interval "+Math.round(cadence)+" ms");
  }
  const shared = streams[0].filter(a => streams[1].some(b => a.time === b.time));
  assert.ok(shared.length >= 9, "Clients did not receive shared observations");
} finally {
  await browser.close();
}
