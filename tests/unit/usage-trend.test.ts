import { describe, expect, it } from "vitest";
import { buildDailyUsageSeries } from "../../src/lib/usageTrend";
import type { DailyUsageTrend } from "../../src/types/transcription";

function toLocalKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

describe("buildDailyUsageSeries", () => {
  it("空輸入回傳空陣列（保留圖表空狀態）", () => {
    expect(buildDailyUsageSeries([], 14)).toEqual([]);
  });

  it("days <= 0 回傳空陣列", () => {
    const rows: DailyUsageTrend[] = [
      { date: "2026-03-05", count: 1, totalChars: 10 },
    ];
    expect(buildDailyUsageSeries(rows, 0)).toEqual([]);
    expect(buildDailyUsageSeries(rows, -3)).toEqual([]);
  });

  it("補零成長度為 days 的升冪連續區間，末日為 endDate", () => {
    const endDate = new Date(2026, 2, 5); // 2026-03-05 本地
    const rows: DailyUsageTrend[] = [
      { date: "2026-03-05", count: 5, totalChars: 250 },
    ];
    const series = buildDailyUsageSeries(rows, 7, endDate);

    expect(series).toHaveLength(7);
    // 升冪
    const dates = series.map((d) => d.date);
    expect(dates).toEqual([
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
    ]);
    expect(series[series.length - 1]).toEqual({
      date: "2026-03-05",
      count: 5,
      totalChars: 250,
    });
  });

  it("缺席日補 0、命中日正確映射 count/totalChars", () => {
    const endDate = new Date(2026, 2, 5);
    const rows: DailyUsageTrend[] = [
      { date: "2026-03-05", count: 5, totalChars: 250 },
      { date: "2026-03-01", count: 3, totalChars: 120 },
    ];
    const series = buildDailyUsageSeries(rows, 7, endDate);
    const byDate = new Map(series.map((d) => [d.date, d]));

    expect(byDate.get("2026-03-01")).toEqual({
      date: "2026-03-01",
      count: 3,
      totalChars: 120,
    });
    expect(byDate.get("2026-03-05")).toEqual({
      date: "2026-03-05",
      count: 5,
      totalChars: 250,
    });
    // 其餘 5 天皆為 0
    const zeroDays = series.filter(
      (d) => d.date !== "2026-03-01" && d.date !== "2026-03-05",
    );
    expect(zeroDays).toHaveLength(5);
    for (const day of zeroDays) {
      expect(day.count).toBe(0);
      expect(day.totalChars).toBe(0);
    }
  });

  it("跨月邊界產生正確的連續日期", () => {
    const endDate = new Date(2026, 2, 2); // 2026-03-02
    const series = buildDailyUsageSeries(
      [{ date: "2026-03-02", count: 1, totalChars: 4 }],
      5,
      endDate,
    );
    expect(series.map((d) => d.date)).toEqual([
      "2026-02-26",
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
  });

  it("忽略落在區間外的資料列", () => {
    const endDate = new Date(2026, 2, 5);
    const rows: DailyUsageTrend[] = [
      { date: "2026-03-05", count: 5, totalChars: 250 },
      { date: "2026-02-20", count: 9, totalChars: 999 }, // 區間外
    ];
    const series = buildDailyUsageSeries(rows, 7, endDate);

    expect(series).toHaveLength(7);
    expect(series.some((d) => d.date === "2026-02-20")).toBe(false);
    // 區間外資料不影響總和
    const total = series.reduce((sum, d) => sum + d.count, 0);
    expect(total).toBe(5);
  });

  it("預設 endDate 為今天，末日為今天的本地日期", () => {
    const series = buildDailyUsageSeries(
      [{ date: toLocalKey(new Date()), count: 2, totalChars: 8 }],
      14,
    );
    expect(series).toHaveLength(14);
    expect(series[series.length - 1].date).toBe(toLocalKey(new Date()));
    expect(series[series.length - 1].count).toBe(2);
  });
});
