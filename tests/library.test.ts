import { describe, expect, it } from "vitest";
import { dateGroup } from "../src/app/LibraryPage";
describe("library date groups", () => {
  const now = new Date(2026, 10, 2, 15);
  it("groups by local calendar day", () => {
    expect(dateGroup(new Date(2026, 10, 2, 0).getTime(), now)).toBe("Today");
    expect(dateGroup(new Date(2026, 10, 1, 23).getTime(), now)).toBe(
      "Yesterday",
    );
    expect(dateGroup(new Date(2026, 9, 29).getTime(), now)).toBe(
      "Previous 7 days",
    );
    expect(dateGroup(null, now)).toBe("Creation date unknown");
  });
});
