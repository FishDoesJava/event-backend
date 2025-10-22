import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// --- CORS & JSON ---
app.use(express.json());
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 204,
  })
);
app.options("*", cors());

const port = process.env.PORT || 3000;

/* ---------- UTIL HELPERS ---------- */
function parseLocation(loc = "") {
  const [cityRaw = "", stateRaw = ""] = String(loc).split(",").map((s) => s.trim());
  let city = cityRaw,
    stateCode = stateRaw;
  if (!stateCode && cityRaw.includes(" ")) {
    const parts = cityRaw.split(" ");
    stateCode = parts.pop();
    city = parts.join(" ");
  }
  return { city, stateCode };
}
function dayBoundsLocal(dateStr) {
  return { start: `${dateStr}T00:00:00`, end: `${dateStr}T23:59:59` };
}
function mapSG(ev) {
  const v = ev.venue || {};
  const venue = [v.name, v.city, v.state].filter(Boolean).join(", ") || null;
  return {
    title: ev.title || "Untitled event",
    startTime: ev.datetime_local || null,
    venue,
    url: ev.url || null,
  };
}

/* ---------- HEALTH/VERSION ---------- */
app.get("/", (_req, res) => res.send("API is up. Try GET /health or POST /events"));
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/version", (_req, res) =>
  res.json({
    name: "event-backend",
    version: "1.0.0",
    environment: process.env.NODE_ENV || "development",
    time: new Date().toISOString(),
  })
);

/* ---------- HINT ROUTE FOR QUICK MANUAL TESTS ---------- */
app.get("/events", (_req, res) =>
  res.json({ hint: "POST /events with { location: 'City, ST', interests: [..], date: 'YYYY-MM-DD' }" })
);

/* ---------- /events (SeatGeek) ---------- */
app.post("/events", async (req, res) => {
  try {
    const { location = "", interests = [], date } = req.body || {};

    if (!process.env.SEATGEEK_CLIENT_ID) {
      return res.status(500).json({ error: "Server missing SEATGEEK_CLIENT_ID" });
    }

    const { city, stateCode } = parseLocation(location);
    const bounds = date ? dayBoundsLocal(date) : null;

    // helper to build and call SeatGeek
    const callSeatGeek = async ({ useKeywords = true, useCity = true }) => {
      const params = new URLSearchParams({
        client_id: process.env.SEATGEEK_CLIENT_ID,
        per_page: "25",
        sort: "datetime_local.asc",
      });

      if (useCity && city) params.set("venue.city", city);
      if (useCity && stateCode) params.set("venue.state", stateCode);

      if (bounds) {
        params.set("datetime_local.gte", bounds.start);
        params.set("datetime_local.lte", bounds.end);
      }

      const q = interests.join(" ").trim();
      if (useKeywords && q) params.set("q", q);

      const url = `https://api.seatgeek.com/2/events?${params.toString()}`;
      const resp = await fetch(url);
      const text = await resp.text();

      if (!resp.ok) {
        console.error("SeatGeek error", resp.status, text);
        return { items: [], debug: { url, status: resp.status, body: text } };
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = {};
      }

      const events = data.events || [];
      const items = events.map(mapSG);
      console.log(`[SeatGeek] ${items.length} results from: ${url}`);
      return { items, debug: { url, status: resp.status } };
    };

    // 1) full filters
    let { items, debug } = await callSeatGeek({ useKeywords: true, useCity: true });

    // 2) if empty, drop keywords
    if (!items.length) ({ items, debug } = await callSeatGeek({ useKeywords: false, useCity: true }));

    // 3) if still empty, try only date (ignore city/state too)
    if (!items.length) ({ items, debug } = await callSeatGeek({ useKeywords: false, useCity: false }));

    return res.json({ items, debug })
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server error" });
  }
});

/* ---------- START SERVER ---------- */
app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
