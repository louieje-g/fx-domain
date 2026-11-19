import "../build.js";
import {mkdir,writeFile,readFile} from "node:fs/promises";
import {readPerformance,fixtureFor} from "../feed.js";

await mkdir("dist/data",{recursive:true});
for(let v=1;v<=8;v++) {
  const data=await readPerformance(String(v));
  const time=new Date().toISOString();
  await writeFile("dist/data/"+v+".json", JSON.stringify({data,time}));
  await writeFile("dist/data/fixture-"+v+".json", JSON.stringify({data:fixtureFor(v),time}));
}
const html=await readFile("dist/index.html","utf8");
await writeFile("dist/index.html",html.replace("<html ", "<html data-snapshots ").replace("Last fetched from Finviz","Finviz snapshot"));
