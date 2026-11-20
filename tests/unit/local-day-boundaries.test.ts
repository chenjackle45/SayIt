import { describe, expect, it } from "vitest";
import {
  getLocalDayStartMs,
  getLocalWeekStartMs,
} from "../../src/stores/useHistoryStore";

describe("記錄頁統計的本地日界", () => {
  it("週日晚上的本週起點是六天前的週一", () => {
    const sundayNight = new Date(2026, 10, 22, 23, 30); // 2026-11-22 週日
    expect(new Date(getLocalWeekStartMs(sundayNight))).toEqual(
      new Date(2026, 10, 16, 0, 0),
    );
  });

  it("週一凌晨的本週起點是當天 00:00", () => {
    const mondayEarly = new Date(2026, 10, 16, 0, 5);
    expect(getLocalWeekStartMs(mondayEarly)).toBe(
      new Date(2026, 10, 16).getTime(),
    );
    expect(getLocalDayStartMs(mondayEarly)).toBe(
      new Date(2026, 10, 16).getTime(),
    );
  });

  it("跨月：12/1 週二的本週起點是 11/30", () => {
    expect(new Date(getLocalWeekStartMs(new Date(2026, 11, 1, 9)))).toEqual(
      new Date(2026, 10, 30),
    );
  });
});
