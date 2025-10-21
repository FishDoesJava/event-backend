import express from "express";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors({ methods: ["GET", "POST"] }));

// Helpers
const parseLocation = (loc = "") => {
  const [cityRaw = "", stateRaw = ""] = String(loc).split(",").map(s => s.trim());
  return { city: cityRaw, stateCode: stateRaw };
};
const dayBoundsLocal = d => ({ start: `${d}T00:00:00`, end: `${d}T23:59:59` });
const mapSG = ev => {
  const v = ev.venue || {};
  const venue = [v.name, v.city, v.state].filter(Boolean).join(", ") || null;
  return { title: ev.title || "Untitled event", startTime: ev.datetime_local || null, venue, url: ev.url || null };
};

// Health
app.get("/health", (_req, res) => res.json({ ok: true }));

// Events (SeatGeek)
app.post("/events", async (req, res) => {
  try {
    const { location = "", interests = [], date } = req.body || {};
    if (!process.env.SEATGEEK_CLIENT_ID) return res.status(500).json({ error: "Missing SEATGEEK_CLIENT_ID" });

    const { city, stateCode } = parseLocation(location);
    const call = async ({ useKeywords = true, useCity = true }) => {
      const params = new URLSearchParams({
        client_id: process.env.SEATGEEK_CLIENT_ID,
        per_page: "25",
        sort: "datetime_local.asc"
      });
      if (useCity && city) params.set("venue.city", city);
      if (useCity && stateCode) params.set("venue.state", stateCode);
      if (date) {
        const { start, end } = dayBoundsLocal(date);
        params.set("datetime_local.gte", start);
        params.set("datetime_local.lte", end);
      }
      const q = interests.join(" ").trim();
      if (useKeywords && q) params.set("q", q);

      const url = `https://api.seatgeek.com/2/events?${params.toString()}`;
      const r = await fetch(url);
      if (!r.ok) return [];
      const data = await r.json().catch(() => ({}));
      return (data.events || []).map(mapSG);
    };

    let items = await call({ useKeywords: true, useCity: true });
    if (!items.length) items = await call({ useKeywords: false, useCity: true });
    if (!items.length) items = await call({ useKeywords: false, useCity: false });

    res.json({ items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// Render sets PORT for you
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`API listening on :${port}`));