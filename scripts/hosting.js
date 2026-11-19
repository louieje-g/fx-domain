import {randomUUID} from "node:crypto";

import {cp,mkdir,writeFile,readFile} from "node:fs/promises";
import {fixtureFor} from "../feed.js";

await cp("app","dist/firebase",{recursive:true});
await mkdir("dist/firebase/data",{recursive:true});
for(let v=1;v<=8;v++) {
  const time=new Date().toISOString();
  await writeFile("dist/firebase/data/fixture-"+v+".json", JSON.stringify({data:fixtureFor(v),time}));
}
const release = randomUUID();
const html=await readFile("dist/firebase/index.html","utf8");
await writeFile("dist/firebase/index.html",html.replace("./app.js", "./app.js?v=" + release).replace("./alerts-ui.js","./alerts-ui.js?v="+release).replace("<html ", '<html data-alerts="https://fx-domain-feed.louiejeguisihan.workers.dev/alerts" data-snapshots data-live-feed="wss://fx-domain-feed.louiejeguisihan.workers.dev/feed" '));

const workerPath = "dist/firebase/sw.js";
const worker = await readFile(workerPath, "utf8");
await writeFile(workerPath, worker.replace("local-build", release));

for (const filename of ["app.js","alerts-ui.js"]) {
  const path = "dist/firebase/" + filename;
  const source = await readFile(path,"utf8");
  await writeFile(path,source.replace("./model.js","./model.js?v="+release).replace("./trends.js","./trends.js?v="+release));
}
