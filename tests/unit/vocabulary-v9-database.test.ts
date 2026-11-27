// @vitest-environment node
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const state = vi.hoisted(() => ({ connection: null as unknown as DatabaseSync, failVersion: false }));
vi.mock("@tauri-apps/plugin-sql", () => {
  const adapter = {
  execute: async (sql: string, params: SQLInputValue[] = []) => {
    if (state.failVersion && sql.includes("VALUES (9)")) {
      state.connection.exec(sql.slice(0, sql.indexOf("INSERT OR IGNORE INTO schema_version")));
      state.failVersion = false;
      throw new Error("模擬版本寫入前中斷");
    }
    if (params.length === 0) { state.connection.exec(sql); return { rowsAffected: 0 }; }
    const result = state.connection.prepare(sql).run(Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value])));
    return { rowsAffected: Number(result.changes) };
  },
  select: async (sql: string, params: SQLInputValue[] = []) => params.length
    ? state.connection.prepare(sql).all(Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value])))
    : state.connection.prepare(sql).all(),
  };
  return { default: { load: async () => adapter, get: () => adapter } };
});
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../src/lib/sentry", () => ({ captureError: vi.fn() }));
vi.mock("../../src/i18n", () => ({ default: { global: { locale: { value: "zh-TW" }, t: (key: string) => key } } }));

beforeEach(() => {
  vi.resetModules();
  state.connection = new DatabaseSync(":memory:");
  state.failVersion = false;
  setActivePinia(createPinia());
});
afterEach(() => state.connection.close());

async function initialize() {
  const { initializeDatabase } = await import("../../src/lib/database");
  return initializeDatabase();
}
function seedV8(columns = "weight INTEGER NOT NULL DEFAULT 1, source TEXT NOT NULL DEFAULT 'manual',") {
  state.connection.exec(`CREATE TABLE schema_version (version INTEGER PRIMARY KEY); INSERT INTO schema_version VALUES (8);
    CREATE TABLE vocabulary (id TEXT PRIMARY KEY, term TEXT NOT NULL UNIQUE, ${columns} created_at TEXT NOT NULL DEFAULT (datetime('now')));`);
}
function row(term: string): Record<string, unknown> {
  return state.connection.prepare("SELECT * FROM vocabulary WHERE term = ?").get(term) as Record<string, unknown>;
}
async function restart() { vi.resetModules(); await initialize(); }

describe("migration v9（真 SQLite）", () => {
  it("新庫從舊 migrations 走到 v9，手動詞預設0／null", async () => {
    await initialize();
    state.connection.exec("INSERT INTO vocabulary (id, term) VALUES ('m', 'Tauri')");
    expect(row("Tauri")).toMatchObject({ correction_count: 0, last_corrected_at: null });
    expect(state.connection.prepare("SELECT MAX(version) AS version FROM schema_version").get()).toMatchObject({ version: 10 });
    expect(() => state.connection.exec("INSERT INTO vocabulary_replacements (id, vocabulary_id, misheard, status) VALUES ('bad', 'm', '陶里', 'invalid')")).toThrow(/CHECK/);
  });
  it("v8升級：只有AI回填1；時間是遷移當下，非created_at", async () => {
    seedV8();
    state.connection.exec("INSERT INTO vocabulary (id,term,source,created_at) VALUES ('a','Tauri','ai','2020-01-01'), ('m','React','manual','2020-01-01')");
    await initialize();
    expect(row("Tauri")).toMatchObject({ correction_count: 1 });
    expect(row("Tauri").last_corrected_at).toBe(state.connection.prepare("SELECT datetime('now') AS now").get()?.now);
    expect(row("React")).toMatchObject({ correction_count: 0, last_corrected_at: null });
  });
  it.each(["", "source TEXT NOT NULL DEFAULT 'manual',"])("缺欄恢復後升級（%s）", async (columns) => {
    seedV8(columns);
    state.connection.exec("INSERT INTO vocabulary (id,term) VALUES ('m','Tauri')");
    if (columns) state.connection.exec("UPDATE vocabulary SET source='ai'");
    await initialize();
    expect(row("Tauri")).toMatchObject({ weight: 1, source: columns ? "ai" : "manual", correction_count: columns ? 1 : 0 });
  });
  it("重跑DDL不重複；學到3次後重啟仍為3且保留時間", async () => {
    seedV8();
    await initialize();
    const { useVocabularyStore } = await import("../../src/stores/useVocabularyStore");
    const store = useVocabularyStore();
    for (let i = 0; i < 3; i++) await store.recordCorrections([{ term: "Tauri", misheard: "陶里" }]);
    const correctedAt = row("Tauri").last_corrected_at;
    await restart();
    expect(row("Tauri")).toMatchObject({ correction_count: 3, last_corrected_at: correctedAt });
    expect(state.connection.prepare("SELECT hit_count FROM vocabulary_replacements").get()).toMatchObject({ hit_count: 3 });
    expect(state.connection.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name='delete_vocabulary_replacements'").get()).toMatchObject({ n: 1 });
  });
  it("v9重跑只做DDL恢復，即使AI詞count仍為0也不再次回填", async () => {
    await initialize();
    state.connection.exec("INSERT INTO vocabulary (id, term, source) VALUES ('z','保持零值','ai')");
    await restart();
    expect(row("保持零值")).toMatchObject({ correction_count: 0, last_corrected_at: null });
  });
  it("回填後版本寫入中斷→HUD學到3次→重啟不覆蓋累計和時間", async () => {
    seedV8();
    state.connection.exec("INSERT INTO vocabulary (id,term,source) VALUES ('a','Tauri','ai')");
    state.failVersion = true;
    await expect(initialize()).rejects.toThrow("模擬版本寫入前中斷");
    // 中斷點仍是 v9 schema，以當版 HUD 的 SQL 模擬學習；不在 v10 欄位尚未存在時載入 v10 store。
    state.connection.exec(`
      UPDATE vocabulary SET correction_count = correction_count + 2 WHERE term='Tauri';
      INSERT INTO vocabulary_replacements (id, vocabulary_id, misheard, hit_count)
        VALUES ('pair', 'a', '陶里', 2);
    `);
    state.connection.exec("UPDATE vocabulary SET last_corrected_at='2026-11-26 00:00:00'");
    await restart();
    expect(row("Tauri")).toMatchObject({ correction_count: 3, last_corrected_at: "2026-11-26 00:00:00" });
  });
  it("DDL已存在但版本未寫入、回填後中斷均能重跑", async () => {
    seedV8();
    state.connection.exec("INSERT INTO vocabulary (id,term,source) VALUES ('a','Tauri','ai')");
    state.failVersion = true;
    await expect(initialize()).rejects.toThrow("模擬版本寫入前中斷");
    expect(row("Tauri").correction_count).toBe(1);
    await initialize();
    expect(row("Tauri").correction_count).toBe(1);
    await restart();
    expect(row("Tauri").correction_count).toBe(1);
  });
});

describe("v9 store 寫入、配對與匯入（真 SQLite）", () => {
  it("同詞同次只加1，配對累計、dismissed保持，改詞保留、刪詞由trigger連帶刪", async () => {
    await initialize();
    const { useVocabularyStore } = await import("../../src/stores/useVocabularyStore");
    const store = useVocabularyStore();
    expect(await store.recordCorrections([{ term: "Tauri", misheard: "陶里" }, { term: "Tauri", misheard: "桃里" }])).toEqual(["Tauri"]);
    expect(row("Tauri").correction_count).toBe(1);
    state.connection.exec("UPDATE vocabulary_replacements SET status='dismissed', updated_at='2020-01-01' WHERE misheard='陶里'");
    await store.recordCorrections([{ term: "Tauri", misheard: "陶里" }]);
    expect(row("Tauri").correction_count).toBe(2);
    expect(state.connection.prepare("SELECT status,hit_count,updated_at FROM vocabulary_replacements WHERE misheard='陶里'").get()).toMatchObject({ status: "dismissed", hit_count: 2, updated_at: row("Tauri").last_corrected_at });
    const id = String(row("Tauri").id);
    await store.updateTerm(id, "Tauri v2");
    expect(state.connection.prepare("SELECT COUNT(*) AS n FROM vocabulary_replacements").get()).toMatchObject({ n: 2 });
    await store.removeTerm(id);
    expect(state.connection.prepare("SELECT COUNT(*) AS n FROM vocabulary_replacements").get()).toMatchObject({ n: 0 });
  });
  it("沒有可學配對時不動DB、不發變更通知；選詞讀取失敗沿用空清單退路", async () => {
    await initialize();
    const { emit } = await import("@tauri-apps/api/event");
    const { captureError } = await import("../../src/lib/sentry");
    const { useVocabularyStore } = await import("../../src/stores/useVocabularyStore");
    const store = useVocabularyStore();
    vi.mocked(emit).mockClear();
    expect(await store.recordCorrections([])).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
    state.connection.exec("DROP TABLE vocabulary_replacements");
    expect(await store.getAiTermList("陶里")).toEqual([]);
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), { source: "vocabulary", step: "ai-selection" });
    state.connection.exec("DROP TABLE transcriptions");
    expect(await store.getWhisperTermList(true)).toEqual([]);
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), { source: "vocabulary", step: "whisper-selection" });
  });
  it("手動詞改正仍為手動；既有詞更新最近改正，大小寫沿用原詞", async () => {
    await initialize();
    state.connection.exec("INSERT INTO vocabulary (id, term, source, last_corrected_at) VALUES ('m','Tauri','manual','2020-01-01')");
    const { useVocabularyStore } = await import("../../src/stores/useVocabularyStore");
    const store = useVocabularyStore();
    await store.fetchTermList();
    expect(await store.recordCorrections([{ term: "tauri", misheard: "陶里" }])).toEqual([]);
    expect(row("Tauri")).toMatchObject({ source: "manual", correction_count: 1 });
    expect(row("Tauri").last_corrected_at).not.toBe("2020-01-01");
  });
  it("匯入AI起始1／遷移時間，手動0；衝突不覆蓋已學3次和時間", async () => {
    await initialize();
    const { useVocabularyStore } = await import("../../src/stores/useVocabularyStore");
    const store = useVocabularyStore();
    await store.importEntries([{ term: "Tauri", source: "ai", weight: 2 }, { term: "React", source: "manual", weight: 1 }]);
    expect(row("Tauri")).toMatchObject({ correction_count: 1 });
    expect(row("Tauri").last_corrected_at).toEqual(expect.any(String));
    expect(row("React")).toMatchObject({ correction_count: 0, last_corrected_at: null });
    await store.recordCorrections([{ term: "Tauri", misheard: "陶里" }]);
    await store.recordCorrections([{ term: "Tauri", misheard: "陶里" }]);
    const correctedAt = row("Tauri").last_corrected_at;
    await store.importEntries([{ term: "tauri", source: "manual", weight: 99 }]);
    await restart();
    expect(row("Tauri")).toMatchObject({ correction_count: 3, last_corrected_at: correctedAt, weight: 99, source: "ai" });
  });
  it("讀取最新DB給純選詞模組，配對隨AI清單送出；無候選不附詞庫", async () => {
    await initialize();
    const { useVocabularyStore } = await import("../../src/stores/useVocabularyStore");
    const { buildSystemPrompt } = await import("../../src/lib/enhancer");
    const store = useVocabularyStore();
    await store.recordCorrections([{ term: "Tauri", misheard: "陶里" }]);
    expect(await store.getWhisperTermList(true)).toEqual(["Tauri"]);
    // 自動學到的配對是 suggested：收件匣確認前不送 AI
    expect(await store.getAiTermList("使用陶里打包")).toEqual([]);
    state.connection.exec("UPDATE vocabulary_replacements SET status='applied'");
    expect(await store.getAiTermList("使用陶里打包")).toEqual(["Tauri (陶里 → Tauri)"]);
    expect(await store.getAiTermList("Tauri")).toEqual(["Tauri"]);
    const empty = await store.getAiTermList("今天天氣很好");
    expect(buildSystemPrompt("原指示", empty)).toBe("原指示");
    state.connection.exec("UPDATE vocabulary_replacements SET status='dismissed'");
    expect(await store.getAiTermList("陶里")).toEqual([]);
  });
});
