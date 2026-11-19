
import {cp,mkdir,writeFile,readFile} from "node:fs/promises";
import {readPerformance,fixtureFor} from "../feed.js";

await cp("app","dist/hosting/apps",{recursive:true});
await mkdir("dist/hosting/apps/data",{recursive:true});
for(let v=1;v<=8;v++) {
  const data=await readPerformance(String(v));
  const time=new Date().toISOString();
  await writeFile("dist/hosting/apps/data/"+v+".json", JSON.stringify({data,time}));
  await writeFile("dist/hosting/apps/data/fixture-"+v+".json", JSON.stringify({data:fixtureFor(v),time}));
}
const html=await readFile("dist/hosting/apps/index.html","utf8");
await writeFile("dist/hosting/apps/index.html",html.replace("<html ", "<html data-snapshots ").replace("Last fetched from Finviz","Finviz snapshot"));

await writeFile("dist/hosting/index.html", `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>FX Domain</title>
<script>location.replace("./apps/index.html" + location.search + location.hash);</script>
<noscript><meta http-equiv="refresh" content="0; url=./apps/index.html"></noscript>
</head><body><a href="./apps/index.html">Open FX Domain</a></body></html>`);
