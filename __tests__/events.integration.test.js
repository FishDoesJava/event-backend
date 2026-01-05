// Integration test for /events: mock SeatGeek + OpenAI and assert dedup + image handling
import { jest } from "@jest/globals";

// Mock the OpenAI client before importing the server
await jest.unstable_mockModule("openai", () => ({
  default: jest.fn().mockImplementation(() => ({
    responses: { create: jest.fn().mockResolvedValue({ output_text: "Short blurb" }) },
  })),
}));

// Import after mocks
const { app } = await import("../index.js");
const request = (await import("supertest")).default;

describe("/events integration", () => {
  beforeEach(() => {
    // ensure env values expected by code
    process.env.SEATGEEK_CLIENT_ID = "test-id";
    process.env.OPENAI_API_KEY = "test-key";

    // Mock global fetch for SeatGeek
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          events: [
            // Two showings of the same title+venue (different datetimes)
            {
              title: "Kimberly Akimbo - Dallas",
              venue: { name: "The Grand", city: "Dallas", state: "TX" },
              datetime_local: "2026-01-07T13:30:00",
              performers: [{ name: "A", image: "http://perf-image" }],
              url: "http://example.com/e1",
            },
            {
              title: "Kimberly Akimbo - Dallas",
              venue: { name: "The Grand", city: "Dallas", state: "TX" },
              datetime_local: "2026-01-06T13:30:00",
              performers: [{ name: "A", image: "http://perf-image" }],
              url: "http://example.com/e1",
            },
            // A different event with an event-level image
            {
              title: "Other Show",
              venue: { name: "Side Hall", city: "Dallas", state: "TX" },
              datetime_local: "2026-01-07T15:00:00",
              image: "http://event-image",
              url: "http://example.com/e2",
            },
          ],
        }),
    });
  });

  afterEach(() => {
    jest.resetAllMocks();
    delete process.env.SEATGEEK_CLIENT_ID;
    delete process.env.OPENAI_API_KEY;
  });

  test("deduplicates showings and returns image + showings metadata", async () => {
    const payload = { location: "Dallas, TX", interests: ["theatre"], date: "2026-01-06" };

    const res = await request(app).post("/events").send(payload).expect(200);

    expect(res.body).toHaveProperty("items");
    const items = res.body.items;

    // We should have two unique events after dedup: Kimberly Akimbo + Other Show
    expect(items.length).toBe(2);

    const kim = items.find((i) => i.title.includes("Kimberly"));
    expect(kim).toBeDefined();
    // image should come from performer
    expect(kim.image).toBe("http://perf-image");
    // showings should be 2 for the duplicated title
    expect(kim.showings).toBe(2);
    // otherStartTimes should include the alternative date
    expect(kim.otherStartTimes).toContain("2026-01-07T13:30:00");

    const other = items.find((i) => i.title.includes("Other Show"));
    expect(other).toBeDefined();
    expect(other.image).toBe("http://event-image");
  });
});
