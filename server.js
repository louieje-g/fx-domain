import { localAlerts } from "./alerts.js";
import {historicalFeed,fixtureHistory} from './history.js';
import http from "node:http";
import { readFile } from "node:fs/promises";
import { feed, fixtureResponse } from "./feed.js";
const root = process.argv.includes("--production") ? "./dist/" : "./app/";
const types = {
  "index.html": "text/html",
  "alerts-ui.js":"text/javascript",
  "trends.js":"text/javascript",
  "app.js": "text/javascript",
  "model.js": "text/javascript",
  "sw.js": "text/javascript",
  "manifest.json": "application/manifest+json",
  "icon192.png": "image/png",
  "icon512.png": "image/png",
};
const port = Number(process.env.PORT || 4173);
let handleAlerts;
const server = http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/alerts") return await handleAlerts(req,res);
      if (req.method !== "GET") {
        res.writeHead(405, { Allow: "GET" }).end();
        return;
      }
      if (url.pathname === "/feed" || url.pathname === "/fixture-feed") {
        const v = url.searchParams.get("v") ?? "1";
        if (!/^[1-8]$/.test(v)) { res.writeHead(400).end("Unknown timeframe"); return; }
        const reply =
          url.pathname === "/feed" ? await feed(fetch,v) : fixtureResponse(v);
        res
          .writeHead(reply.status, Object.fromEntries(reply.headers))
          .end(await reply.text());
        return;
      }
      if (url.pathname === '/history' || url.pathname === '/fixture-history') {
        res.setHeader('Cache-Control','no-store');
        res.setHeader('Content-Type','application/json');
        try {
          res.end(JSON.stringify(url.pathname === '/history' ? await historicalFeed() : fixtureHistory()));
        } catch { res.writeHead(502).end('{"error":"History unavailable"}'); }
        return;
      }
      const file = url.pathname.slice(1) || "index.html";
      if (!Object.hasOwn(types, file)) {
        res.writeHead(404).end();
        return;
      }
      res
        .writeHead(200, {
          "Content-Type": types[file],
          "Cache-Control": "no-cache",
        })
        .end(await readFile(new URL(root + file, import.meta.url)));
    } catch {
      res.statusCode = 500;
      res.end();
    }
  })
  .listen(port, "127.0.0.1", () => {
    handleAlerts = localAlerts(port);
    console.log(
      "FX Domain http://127.0.0.1:" +
        server.address().port +
        "/" +
        (process.argv.includes("--fixture") ? "?mode=fixture" : ""),
    );
  });

