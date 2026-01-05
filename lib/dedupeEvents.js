export function dedupeEvents(arr = []) {
  const map = new Map();
  for (const ev of arr) {
    const titleKey = String(ev.title || "").toLowerCase().trim();
    const venueKey = String(ev.venue || "").toLowerCase().trim();
    const key = `${titleKey}|${venueKey}`;

    if (!map.has(key)) {
      // keep the first (or earliest) showing as the representative
      map.set(key, { ...ev, showings: 1, otherStartTimes: [] });
      continue;
    }

    const existing = map.get(key);
    existing.showings = (existing.showings || 1) + 1;

    const evStart = ev.startTime;
    const existingStart = existing.startTime;

    if (evStart) {
      if (!existingStart) {
        existing.startTime = evStart;
      } else if (evStart === existingStart) {
        // same time, nothing to add
      } else if (evStart < existingStart) {
        // new one is earlier: move previous representative into otherStartTimes (if not present)
        if (!existing.otherStartTimes.includes(existingStart)) {
          existing.otherStartTimes.push(existingStart);
        }
        existing.startTime = evStart;
      } else {
        // new one is later: record as an additional showing if not already recorded
        if (!existing.otherStartTimes.includes(evStart)) {
          existing.otherStartTimes.push(evStart);
        }
      }
    }
  }
  return Array.from(map.values());
}
