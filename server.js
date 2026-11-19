import http from "node:http";
import { readFile } from "node:fs/promises";
import { feed, fixtureResponse } from "./feed.js";
const root = process.argv.includes("--production") ? "./dist/" : "./app/";
const types = {
  "index.html": "text/html",
  "app.js": "text/javascript",
  "model.js": "text/javascript",
  "sw.js": "text/javascript",
  "manifest.json": "application/manifest+json",
  "icon192.png": "image/png",
  "icon512.png": "image/png",
};
const port = Number(process.env.PORT || 4173);
const server = http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method !== "GET") {
        res.writeHead(405, { Allow: "GET" }).end();
        return;
      }
      if (url.pathname === "/feed" || url.pathname === "/fixture-feed") {
        const reply =
          url.pathname === "/feed" ? await feed() : fixtureResponse();
        res
          .writeHead(reply.status, Object.fromEntries(reply.headers))
          .end(await reply.text());
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
  .listen(port, "127.0.0.1", () =>
    console.log(
      "FX Domain http://127.0.0.1:" +
        server.address().port +
        "/" +
        (process.argv.includes("--fixture") ? "?mode=fixture" : ""),
    ),
  );
