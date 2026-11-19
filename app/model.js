export const codes = ["EUR", "GBP", "AUD", "NZD", "USD", "CAD", "CHF", "JPY"];
export const fixture = {
  EUR: 0.5,
  GBP: 0.2,
  AUD: 0.2,
  NZD: -0.1,
  USD: 0,
  CAD: 0.1,
  CHF: -0.25,
  JPY: -0.4,
};
export function normalize(raw) {
  if (!codes.every((code) => Number.isFinite(raw?.[code])))
    throw Error("Invalid currency snapshot");
  return Object.fromEntries(codes.map((code) => [code, raw[code]]));
}
export function pairsFor(values) {
  return codes.flatMap((base, i) =>
    codes.slice(i + 1).map((quote) => {
      const difference = values[base] - values[quote];
      const gap = Math.round(Math.abs(difference) * 100) / 100;
      return {name: base + "/" + quote, gap, direction: gap ? Math.sign(difference) : 0};
    }),
  );
}
