import { codes } from './app/model.js';

const performanceUrl = 'https://finviz.com/forex/performance?tv=1&v=1';
const rounded = value => Math.round(value * 100) / 100 || 0;

export function performanceSnapshot(rows, source = 'Finviz') {
  const instruments = new Map(rows.map(row => [row.ticker, row]));
  function factor(ticker, field) {
    const percent = instruments.get(ticker)?.[field];
    if (!Number.isFinite(percent) || percent <= -100) throw Error('Missing Finviz performance: ' + ticker);
    return 1 + percent / 100;
  }
  function usdFactor(currency, field) {
    if (currency === 'USD') return 1;
    if (instruments.has(currency+'USD')) return factor(currency+'USD',field);
    return 1 / factor('USD'+currency,field);
  }
  const returns = {};
  codes.forEach((base,i) => {
    for (const quote of codes.slice(i+1)) {
      const ticker = base+quote;
      const row = instruments.get(ticker);
      const value = field => {
        if (row) {
          factor(ticker,field);
          return rounded(row[field]);
        }
        return rounded((usdFactor(base,field)/usdFactor(quote,field)-1)*100);
      };
      returns[base+'/'+quote] = {week:value('perfWeekPct'),month:value('perfMonthPct'),direct:Boolean(row)};
    }
  });
  return {source, fetchedAt:new Date().toISOString(), returns};
}

export function fixtureHistory() {
  return performanceSnapshot(codes.filter(c=>c!=='USD').map(c=>({
    ticker:c+'USD',perfWeekPct:(1/(1+codes.indexOf(c)/100)-1)*100,
    perfMonthPct:((1+codes.indexOf(c)*.02)/(1+codes.indexOf(c)*.01)-1)*100
  })), 'Fixture');
}
let cached, expires=0, pending;
export async function historicalFeed() {
  if (Date.now() < expires) return cached;
  if (!pending) pending = (async () => {
    const reply = await fetch(performanceUrl,{signal:AbortSignal.timeout(7000)});
    if (!reply.ok) throw Error('Finviz unavailable');
    const html = await reply.text();
    const match = html.match(/<script\b[^>]*\bid=["']forex-perf-init-data["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match) throw Error('Missing Finviz performance table');
    cached = performanceSnapshot(JSON.parse(match[1]).rows);
    expires = Date.now()+3600000;
    return cached;
  })().finally(()=>{pending=null;});
  return pending;
}
