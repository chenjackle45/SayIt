import { describe, expect, it } from "vitest";
import { groupRecordsByDay } from "../../src/composables/useRecordGroups";
import { createTranscriptionRecord } from "../support/factories/transcription-factory";

// 2026-11-21 10:00 本地時間
const NOW = new Date(2026, 10, 21, 10, 0).getTime();
const at = (y: number, m: number, d: number, h: number) =>
  createTranscriptionRecord({ timestamp: new Date(y, m, d, h, 0).getTime() });

describe("groupRecordsByDay 依日期分組", () => {
  it("今天、昨天、更早各自成組，保持新到舊順序", () => {
    const list = [
      at(2026, 10, 21, 9),
      at(2026, 10, 21, 1),
      at(2026, 10, 20, 20),
      at(2026, 10, 19, 22),
      at(2026, 10, 19, 21),
    ];
    const groups = groupRecordsByDay(list, NOW);
    expect(groups.map((g) => g.kind)).toEqual(["today", "yesterday", "other"]);
    expect(groups.map((g) => g.recordList.length)).toEqual([2, 1, 2]);
    expect(groups[0].recordList[0]).toBe(list[0]);
  });

  it("跨午夜：凌晨與前一晚分屬不同天", () => {
    const groups = groupRecordsByDay(
      [at(2026, 10, 21, 0), at(2026, 10, 20, 23)],
      NOW,
    );
    expect(groups).toHaveLength(2);
    expect(groups[1].kind).toBe("yesterday");
  });

  it("空列表回空陣列", () => {
    expect(groupRecordsByDay([], NOW)).toEqual([]);
  });
});
