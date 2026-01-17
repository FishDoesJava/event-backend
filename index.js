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

import { mapSG } from "./lib/mapSG.js";

// Summarize a single SeatGeek event in 1–2 sentences
async function summarizeEvent(evt) {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }
  const prompt = [
    "Write a punchy 1–2 sentence blurb (≤200 chars) for a potential attendee.",
    "Hype the headline/team/artist if present. No dates; avoid repeating the venue.",
    "Return plain text only.",
    `Event JSON: ${JSON.stringify(evt)}`,
  ].join("\n");

  const resp = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: prompt,
    max_output_tokens: 120,
  });

  // output_text is the convenience helper from the Responses API
  return (resp.output_text || "").trim();
}

function buildFallbackSnippet(evt) {
  const venue = evt.venue ? ` at ${evt.venue}` : "";
  return `${evt.title}${venue}.`;
}

async function addSnippetsToEvents(events, concurrency) {
  if (!process.env.OPENAI_API_KEY) {
    return events.map((evt) => ({
      ...evt,
      snippet: evt.snippet || buildFallbackSnippet(evt),
    }));
  }
  const results = new Array(events.length);
  let cursor = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, events.length) },
    async () => {
      while (cursor < events.length) {
        const currentIndex = cursor;
        cursor += 1;
        const evt = events[currentIndex];
        if (evt.snippet) {
          results[currentIndex] = evt;
          continue;
        }
        try {
          const snippet = await summarizeEvent(evt);
          results[currentIndex] = {
            ...evt,
            snippet: snippet || buildFallbackSnippet(evt),
          };
        } catch (err) {
          console.error("summarizeEvent error", err);
          results[currentIndex] = {
            ...evt,
            snippet: buildFallbackSnippet(evt),
          };
        }
      }
    }
  );

  await Promise.all(workers);
  return results;
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

/* ---------- SIMPLE EVENT CACHE ---------- */

const eventCache = new Map();

function buildCacheKey({ location = "", interests = [], date = "" }) {
  const normalizedLocation = String(location).trim().toLowerCase();
  const normalizedInterests = Array.isArray(interests)
    ? interests.map((item) => String(item).trim().toLowerCase()).sort()
    : [];
  const normalizedDate = String(date || "").trim();
  return JSON.stringify({
    location: normalizedLocation,
    interests: normalizedInterests,
    date: normalizedDate,
  });
}

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
    const callSeatGeek = async ({
      useKeywords = true,
      useCity = true,
      page = 1,
    }) => {
      const params = new URLSearchParams({
        client_id: process.env.SEATGEEK_CLIENT_ID,
        per_page: "25",
        sort: "datetime_local.asc",
        page: String(page),
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

    const cacheKey = buildCacheKey({ location, interests, date });
    const searchModes = [
      { useKeywords: true, useCity: true },
      { useKeywords: false, useCity: true },
      { useKeywords: false, useCity: false },
    ];

    let cacheEntry = eventCache.get(cacheKey);
    if (!cacheEntry) {
      cacheEntry = {
        items: [],
        page: 1,
        modeIndex: null,
        done: false,
      };
      eventCache.set(cacheKey, cacheEntry);
    }

    let debug = null;
    let newItems = [];

    if (!cacheEntry.done) {
      if (cacheEntry.modeIndex === null) {
        for (let i = 0; i < searchModes.length; i += 1) {
          const { items, debug: modeDebug } = await callSeatGeek({
            ...searchModes[i],
            page: cacheEntry.page,
          });
          debug = modeDebug;
          if (items.length) {
            cacheEntry.modeIndex = i;
            newItems = items;
            break;
          }
        }
        if (!newItems.length) {
          cacheEntry.done = true;
        }
      } else {
        const { items, debug: modeDebug } = await callSeatGeek({
          ...searchModes[cacheEntry.modeIndex],
          page: cacheEntry.page,
        });
        debug = modeDebug;
        newItems = items;
        if (!newItems.length) {
          cacheEntry.done = true;
        }
      }

      if (newItems.length) {
        cacheEntry.page += 1;
        const merged = [...cacheEntry.items, ...newItems];
        cacheEntry.items = dedupeEvents(merged);
        console.log(
          `[Dedup] reduced ${merged.length} -> ${cacheEntry.items.length}`
        );
      }
    }

    const summaryConcurrency = 3;
    cacheEntry.items = await addSnippetsToEvents(
      cacheEntry.items,
      summaryConcurrency
    );

    // Also return just the descriptions
    const descriptions = cacheEntry.items
      .map((e) => e.snippet)
      .filter((s) => typeof s === "string" && s.length > 0);

    return res.json({
      items: cacheEntry.items,
      descriptions,
      debug,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Server error" });
  }
});

/* ---------- START SERVER ---------- */

// Only start the server when not running tests; tests import `app` directly.
if (process.env.NODE_ENV !== "test") {
  app.listen(port, () =>
    console.log(`API listening on http://localhost:${port}`)
  );
}

export { app };
