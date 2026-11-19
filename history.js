import {codes} from "./app/model.js";
import {readPerformance,fixtureFor} from "./feed.js";

export function periodReturns(week,month,source="Finviz") {
  const returns={};
  codes.forEach((base,i)=>{
    for(const quote of codes.slice(i+1)){
      const change = values => Math.round(((100+values[base])/(100+values[quote])-1)*10000)/100 || 0;
      returns[base+"/"+quote]={week:change(week),month:change(month),direct:quote==="USD"};
    }
  });
  return {source,fetchedAt:new Date().toISOString(),returns};
}
export const fixtureHistory=()=>periodReturns(fixtureFor(2),fixtureFor(3),"Fixture");
let cached, expires=0, pending;
export async function historicalFeed(){
  if(Date.now()<expires) return cached;
  if(!pending) pending=Promise.all([readPerformance(2),readPerformance(3)]).then(([week,month])=>{
    cached=periodReturns(week,month);
    expires=Date.now()+60000;
    return cached;
  }).finally(()=>{pending=null;});
  return pending;
}
