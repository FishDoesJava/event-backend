import { dedupeEvents } from "../lib/dedupeEvents.js";

describe("dedupeEvents", () => {
  test("combines multiple showings of the same title+venue, keeps earliest startTime and counts showings", () => {
    const input = [
      { title: "Show A", venue: "Main Hall", startTime: "2026-01-07T19:00:00" },
      { title: "Show A", venue: "Main Hall", startTime: "2026-01-06T19:00:00" },
    ];

    const out = dedupeEvents(input);
    expect(out).toHaveLength(1);
    expect(out[0].showings).toBe(2);
    // earliest startTime should be kept
    expect(out[0].startTime).toBe("2026-01-06T19:00:00");
    // otherStartTimes should include the later one
    expect(out[0].otherStartTimes).toContain("2026-01-07T19:00:00");
  });

  test("treats same title at different venues as distinct", () => {
    const input = [
      { title: "Comedy Night", venue: "Venue A", startTime: "2026-01-07T19:00:00" },
      { title: "Comedy Night", venue: "Venue B", startTime: "2026-01-07T20:00:00" },
    ];

    const out = dedupeEvents(input);
    expect(out).toHaveLength(2);
  });

  test("handles missing startTime gracefully and still counts showings", () => {
    const input = [
      { title: "No Time Show", venue: "Hall", startTime: null },
      { title: "No Time Show", venue: "Hall" },
    ];

    const out = dedupeEvents(input);
    expect(out).toHaveLength(1);
    expect(out[0].showings).toBe(2);
    expect(Array.isArray(out[0].otherStartTimes)).toBe(true);
  });
});
