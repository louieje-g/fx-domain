import { codes, pairsFor, fixture } from './app/model.js';

const day = 86400000;
const iso = time => new Date(time).toISOString().slice(0, 10);

export function historySnapshot(series) {
  if (series.base !== 'USD' || series.amount !== 1) throw Error('Unexpected history units');
  const dates = Object.keys(series.rates).filter(d => /^\d{4}-\d\d-\d\d$/.test(d)).sort();
  const end = dates.at(-1);
  const time = Date.parse(end);
  const priorMonthEnd = new Date(Date.UTC(new Date(time).getUTCFullYear(), new Date(time).getUTCMonth(), 0));
  priorMonthEnd.setUTCDate(Math.min(priorMonthEnd.getUTCDate(), new Date(time).getUTCDate()));
  const onOrBefore = target => dates.findLast(d => d <= target);
  const week = onOrBefore(iso(time - 7 * day));
  const month = onOrBefore(iso(priorMonthEnd));
  const rates = {};
  for (const date of [end, week, month]) {
    if (!date) throw Error('Missing history');
    rates[date] = {...series.rates[date], USD:1};
    if (!codes.every(c => Number.isFinite(rates[date][c]) && rates[date][c] > 0)) throw Error('Invalid history');
  }
  const returns = {};
  for (const {name} of pairsFor(fixture)) {
    const [base, quote] = name.split('/');
    const rate = date => rates[date][quote] / rates[date][base];
    const change = date => Math.round((rate(end) / rate(date) - 1) * 10000) / 100 || 0;
    returns[name] = {week:change(week), month:change(month)};
  }
  return {end, week, month, returns};
}

export function fixtureHistory() {
  const row = step => Object.fromEntries(codes.map((c,i) => [c,1 + step*i/100]));
  return historySnapshot({base:'USD',amount:1,rates:{
    '2026-10-19':row(2), '2026-11-12':row(0), '2026-11-19':row(1)
  }});
}
let cached, expires=0, pending;
export async function historicalFeed() {
  if (Date.now() < expires) return cached;
  if (!pending) pending = (async () => {
    const today = Date.now();
    const url = 'https://api.frankfurter.dev/v1/'+iso(today-48*day)+'..'+iso(today)+'?base=USD&symbols='+codes.filter(c=>c!=='USD').join(',');
    const reply = await fetch(url,{signal:AbortSignal.timeout(7000)});
    if (!reply.ok) throw Error('History unavailable');
    cached = historySnapshot(await reply.json());
    expires = Date.now()+3600000;
    return cached;
  })().finally(()=>{pending=null;});
  return pending;
}
