import { normalize, fixture, codes } from "./app/model.js";

export async function readPerformance(v, request = fetch) {
  if (!/^[1-8]$/.test(v)) throw Error("Unknown timeframe");
  const response = await request("https://finviz.com/api/forex_perf?v=" + v, {
    signal: AbortSignal.timeout(7000), cache: "no-store"
  });
  if (response.status === 429) {
    const header=response.headers.get("retry-after");
    const delay=header && /^\d+$/.test(header) ? Number(header)*1000 : Date.parse(header)-Date.now();
    throw Object.assign(Error("Finviz rate limit"), {status:429,retryMs:Math.max(0,delay || 0)});
  }
  if (!response.ok) throw Error("Finviz HTTP " + response.status);
  return normalize(await response.json());
}

export function fixtureFor(v) {
  if (Number(v) === 1) return fixture;
  return Object.fromEntries(codes.map((c,i) => [c, c === "USD" ? 0 : (i-3)*Number(v)*(Number(v)%2 ? 1 : -1)]));
}
export async function feed(request = fetch, v = "1") {
  try {
    return Response.json(await readPerformance(v,request),{headers:{"Cache-Control":"no-store"}});
  } catch {
    return Response.json({error:"Finviz unavailable"},{status:502,headers:{"Cache-Control":"no-store"}});
  }
}
export const fixtureResponse = v => Response.json(fixtureFor(v),{headers:{"Cache-Control":"no-store"}});
