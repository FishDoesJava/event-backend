import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import { dedupeEvents } from "./lib/dedupeEvents.js";

dotenv.config();

// --- OpenAI client ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
if (!process.env.OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY");
}

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
//app.options("*", cors());

const port = process.env.PORT || 3000;

/* ---------- UTIL HELPERS ---------- */

function parseLocation(loc = "") {
  const [cityRaw = "", stateRaw = ""] = String(loc).split(",").map((s) => s.trim());
  let city = cityRaw;
  let stateCode = stateRaw;

  // allow "Dallas TX" style
  if (!stateCode && cityRaw.includes(" ")) {
    const parts = cityRaw.split(" ");
    stateCode = parts.pop();
    city = parts.join(" ");
  }

  return { city, stateCode };
}

function dayBoundsLocal(dateStr) {
  // naive local-day bounds, fine for this use case
  return { start: `${dateStr}T00:00:00`, end: `${dateStr}T23:59:59` };
}

function mapSG(ev) {
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

// Summarize a single SeatGeek event in 1–2 sentences
async function summarizeEvent(evt) {
  const prompt = [
    "Write a punchy 1–2 sentence blurb (≤200 chars) for a potential attendee.",
    "Hype the headline/team/artist if present. No dates; avoid repeating the venue.",
    "Return plain text only.",
    `Event JSON: ${JSON.stringify(evt)}`
  ].join("\n");

  const resp = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: prompt,
    max_output_tokens: 120,
  });

  // output_text is the convenience helper from the Responses API
  return (resp.output_text || "").trim();
}

/* ---------- HEALTH/VERSION ---------- */

app.get("/", (_req, res) =>
  res.send("API is up. Try GET /health or POST /events")
);

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
  res.json({
    hint:
      "POST /events with { location: 'City, ST', interests: [..], date: 'YYYY-MM-DD' }",
  })
);

/* ---------- /events (SeatGeek + OpenAI summaries) ---------- */

app.post("/events", async (req, res) => {
  try {
    const { location = "", interests = [], date } = req.body || {};

    if (!process.env.SEATGEEK_CLIENT_ID) {
      return res
        .status(500)
        .json({ error: "Server missing SEATGEEK_CLIENT_ID" });
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
    let { items, debug } = await callSeatGeek({
      useKeywords: true,
      useCity: true,
    });

    // 2) if empty, drop keywords
    if (!items.length) {
      ({ items, debug } = await callSeatGeek({
        useKeywords: false,
        useCity: true,
      }));
    }

    // 3) if still empty, try only date (ignore city/state too)
    if (!items.length) {
      ({ items, debug } = await callSeatGeek({
        useKeywords: false,
        useCity: false,
      }));
    }

    // Deduplicate events by normalized title + venue (group multiple showings of same event)
    // implemented in a small helper module so it can be unit-tested
    const deduped = dedupeEvents(items);
    console.log(`[Dedup] reduced ${items.length} -> ${deduped.length}`);

    // Summarize up to 12 unique events with OpenAI
    const withSnippets = [];
    for (const it of deduped.slice(0, 12)) {
      try {
        const snippet = await summarizeEvent(it);
        withSnippets.push({ ...it, snippet });
      } catch (err) {
        console.error("summarizeEvent error", err);
        withSnippets.push({ ...it, snippet: null });
      }
    }

    // If there were more events than summarized, append the rest (no snippet)
    if (deduped.length > withSnippets.length) {
      withSnippets.push(...deduped.slice(withSnippets.length));
    }

    // Also return just the descriptions
    const descriptions = withSnippets
      .map((e) => e.snippet)
      .filter((s) => typeof s === "string" && s.length > 0);

    return res.json({
      items: withSnippets,
      descriptions,
      debug,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server error" });
  }
});

/* ---------- START SERVER ---------- */

app.listen(port, () =>
  console.log(`API listening on http://localhost:${port}`)
);
