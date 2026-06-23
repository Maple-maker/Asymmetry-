// lib/rubric/schedule.test.ts — ported verbatim from spcx (no behavior change).
import { describe, it, expect } from "vitest";
import { isBiweeklyDcaDay } from "./schedule.js";

describe("isBiweeklyDcaDay", () => {
  const anchor = "2026-06-23";
  it("true on the anchor day", () => expect(isBiweeklyDcaDay(anchor, "2026-06-23")).toBe(true));
  it("true 14 days later", () => expect(isBiweeklyDcaDay(anchor, "2026-07-07")).toBe(true));
  it("false 7 days later", () => expect(isBiweeklyDcaDay(anchor, "2026-06-30")).toBe(false));
  it("false before the anchor", () => expect(isBiweeklyDcaDay(anchor, "2026-06-22")).toBe(false));
});
