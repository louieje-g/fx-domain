const byFrame = new Map();
export function recordGaps(frame,pairs,time) {
  if (byFrame.get(frame)?.time === time) return;
  byFrame.set(frame,{time,gaps:new Map(pairs.map(p=>[p.name,p.gap]))});
  window.dispatchEvent(new Event("gap-reading"));
}
export function latestGap(frame,pair) {return byFrame.get(frame)?.gaps.get(pair);}
