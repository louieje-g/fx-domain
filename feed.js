import { normalize, fixture } from "./app/model.js";

export async function feed(request = fetch) {
  try {
    const response = await request("https://finviz.com/api/forex_perf", {
      signal: AbortSignal.timeout(7000),
      cache: "no-store",
    });
    if (!response.ok) throw Error("Provider unavailable");
    return Response.json(normalize(await response.json()), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "Finviz unavailable" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
export const fixtureResponse = () =>
  Response.json(fixture, { headers: { "Cache-Control": "no-store" } });
