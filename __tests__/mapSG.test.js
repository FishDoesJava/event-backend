import { mapSG } from "../lib/mapSG.js";

describe("mapSG image selection", () => {
  test("prefers performer image when one performer has image", () => {
    const ev = {
      title: "Show",
      venue: { name: "Hall" },
      datetime_local: "2026-01-06T19:00:00",
      performers: [
        { name: "A", image: "http://img-a" },
        { name: "B", image: "http://img-b" },
      ],
      image: "http://event-img",
    };

    const out = mapSG(ev);
    expect(out.image).toBe("http://img-a");
  });

  test("falls back to first performer image if find() not used", () => {
    const ev = {
      title: "Show",
      performers: [{ name: "A", image: "http://img-first" }],
    };

    const out = mapSG(ev);
    expect(out.image).toBe("http://img-first");
  });

  test("falls back to event-level image if no performer images", () => {
    const ev = {
      title: "Show",
      performers: [{ name: "A" }],
      image: "http://event-img",
    };

    const out = mapSG(ev);
    expect(out.image).toBe("http://event-img");
  });

  test("returns null for image when none present", () => {
    const ev = { title: "Show" };
    const out = mapSG(ev);
    expect(out.image).toBeNull();
  });
});
