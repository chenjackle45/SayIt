// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/database", () => ({ getDatabase: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn() }));
vi.mock("../../src/i18n", () => ({
  default: { global: { locale: { value: "zh-TW" }, t: (key: string) => key } },
}));
vi.mock("../../src/lib/sentry", () => ({ captureError: vi.fn() }));

import { TOP_TERM_LIST_SQL } from "../../src/stores/useVocabularyStore";

interface SeedRow {
  term: string;
  weight: number;
  source: "manual" | "ai";
  createdAt: string;
}

/** 用真 SQLite 跑 store 的排序 SQL（mock DB 看不出排序結果，#84） */
function runTopTermQuery(rowList: SeedRow[], limit: number): string[] {
  const db = new DatabaseSync(":memory:");
  // 欄位對應 src/lib/database.ts 的 vocabulary 表（v3 起有 weight、source）
  db.exec(
    "CREATE TABLE vocabulary (id TEXT PRIMARY KEY, term TEXT NOT NULL UNIQUE, weight INTEGER NOT NULL DEFAULT 1, source TEXT NOT NULL DEFAULT 'manual', created_at TEXT NOT NULL)",
  );
  const insert = db.prepare(
    "INSERT INTO vocabulary (id, term, weight, source, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  rowList.forEach((row, index) =>
    insert.run(`id-${index}`, row.term, row.weight, row.source, row.createdAt),
  );
  // tauri-plugin-sql 的 $1 在 SQLite 是具名參數，這裡用具名方式綁定
  const result = db.prepare(TOP_TERM_LIST_SQL).all({ $1: limit }) as {
    term: string;
  }[];
  db.close();
  return result.map((row) => row.term);
}

function minuteStamp(minute: number): string {
  return `2026-10-01 00:${String(minute).padStart(2, "0")}:00`;
}

describe("TOP_TERM_LIST_SQL（真 SQLite）", () => {
  it("低權重的手動詞排在高權重的 AI 詞前面", () => {
    const rowList: SeedRow[] = Array.from({ length: 60 }, (_, i) => ({
      term: `AI${i}`,
      weight: 5,
      source: "ai" as const,
      createdAt: minuteStamp(i),
    }));
    rowList.push({
      term: "未來誌",
      weight: 1,
      source: "manual",
      createdAt: "2026-09-01 00:00:00",
    });

    const result = runTopTermQuery(rowList, 50);

    expect(result).toHaveLength(50);
    expect(result[0]).toBe("未來誌");
  });

  it("手動詞超過名額時只回手動詞，且依權重遞減", () => {
    const rowList: SeedRow[] = Array.from({ length: 60 }, (_, i) => ({
      term: `M${i}`,
      weight: i % 7,
      source: "manual" as const,
      createdAt: minuteStamp(i),
    }));
    for (let i = 0; i < 10; i++) {
      rowList.push({
        term: `AI${i}`,
        weight: 99,
        source: "ai",
        createdAt: "2026-10-02 00:00:00",
      });
    }

    const result = runTopTermQuery(rowList, 50);
    const weightByTerm = new Map(rowList.map((row) => [row.term, row.weight]));
    const weightList = result.map((term) => weightByTerm.get(term) ?? -1);

    expect(result).toHaveLength(50);
    expect(result.every((term) => term.startsWith("M"))).toBe(true);
    expect(weightList).toEqual([...weightList].sort((a, b) => b - a));
  });

  it("同類同權重時較新的在前", () => {
    const result = runTopTermQuery(
      [
        { term: "舊", weight: 2, source: "ai", createdAt: minuteStamp(1) },
        { term: "最新", weight: 2, source: "ai", createdAt: minuteStamp(3) },
        { term: "中", weight: 2, source: "ai", createdAt: minuteStamp(2) },
      ],
      50,
    );

    expect(result).toEqual(["最新", "中", "舊"]);
  });
});
