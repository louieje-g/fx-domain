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
await writeFile("dist/firebase/index.html",html.replace("./app.js", "./app.js?v=" + release).replace("<html ", '<html data-snapshots data-live-feed="wss://fx-domain-feed.louiejeguisihan.workers.dev/feed" '));

const workerPath = "dist/firebase/sw.js";
const worker = await readFile(workerPath, "utf8");
await writeFile(workerPath, worker.replace("local-build", release));

const appPath = "dist/firebase/app.js";
const app = await readFile(appPath, "utf8");
await writeFile(appPath, app.replace("./model.js", "./model.js?v=" + release));
