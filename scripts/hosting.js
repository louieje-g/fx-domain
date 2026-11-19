import {createHash,randomUUID} from "node:crypto";

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

async function versionIcon(path) {
  const filename=path.split("?")[0];
  const bytes=await readFile("dist/firebase/"+filename);
  const hash=createHash("sha256").update(bytes).digest("hex").slice(0,12);
  return filename+"?v="+hash;
}

const manifestPath="dist/firebase/manifest.json";
const manifest=JSON.parse(await readFile(manifestPath,"utf8"));
for (const icon of manifest.icons) icon.src=await versionIcon(icon.src);
await writeFile(manifestPath,JSON.stringify(manifest,null,2));

const indexPath="dist/firebase/index.html";
let index=await readFile(indexPath,"utf8");
for (const match of index.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)) {
  index=index.replace(match[0],match[0].replace(match[1],await versionIcon(match[1])));
}
await writeFile(indexPath,index);
const notificationIcon=await versionIcon("./icon192.png");
const shell=await readFile(workerPath,"utf8");
await writeFile(workerPath,shell.replaceAll("./icon192.png?v=purple-mark",notificationIcon));
