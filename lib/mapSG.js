export function mapSG(ev) {
  const v = ev.venue || {};
  const venue = [v.name, v.city, v.state].filter(Boolean).join(", ") || null;
  // Prefer an image from performers if available, otherwise fall back to an event-level image
  const image =
    (Array.isArray(ev.performers) && ev.performers.find((p) => p.image)?.image) ||
    ev.performers?.[0]?.image ||
    ev.image ||
    null;
  return {
    title: ev.title || "Untitled event",
    startTime: ev.datetime_local || null,
    venue,
    url: ev.url || null,
    image,
  };
}
