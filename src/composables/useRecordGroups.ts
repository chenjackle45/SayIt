import type { TranscriptionRecord } from "../types/transcription";

export type RecordDayKind = "today" | "yesterday" | "other";

export interface RecordDayGroup {
  key: string;
  kind: RecordDayKind;
  /** 該日 00:00 的本地時間戳，給畫面用 Intl 格式化日期 */
  dayStartMs: number;
  recordList: TranscriptionRecord[];
}

function toLocalDayStart(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * 依本地日期把記錄分組（輸入已依時間新到舊排序，輸出保持同順序）。
 * 「今天／昨天」以 nowMs 的本地日期判斷，其餘一律 other。
 */
export function groupRecordsByDay(
  recordList: TranscriptionRecord[],
  nowMs: number = Date.now(),
): RecordDayGroup[] {
  const todayStart = toLocalDayStart(nowMs);
  const yesterdayStart = new Date(
    new Date(todayStart).getFullYear(),
    new Date(todayStart).getMonth(),
    new Date(todayStart).getDate() - 1,
  ).getTime();

  const groupList: RecordDayGroup[] = [];
  for (const record of recordList) {
    const dayStart = toLocalDayStart(record.timestamp);
    const last = groupList[groupList.length - 1];
    if (last && last.dayStartMs === dayStart) {
      last.recordList.push(record);
      continue;
    }
    const kind: RecordDayKind =
      dayStart === todayStart
        ? "today"
        : dayStart === yesterdayStart
          ? "yesterday"
          : "other";
    groupList.push({
      key: String(dayStart),
      kind,
      dayStartMs: dayStart,
      recordList: [record],
    });
  }
  return groupList;
}
