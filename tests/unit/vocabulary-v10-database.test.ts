// @vitest-environment node
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const state = vi.hoisted(() => ({
  connection: null as unknown as DatabaseSync,
  beforeDelete: null as null | (() => Promise<void>),
  beforeRestore: null as null | (() => Promise<void>),
  calls: [] as string[],
  failVersion: false,
  failRefresh: false,
}));
vi.mock("@tauri-apps/plugin-sql", () => {
  const bind = (params: SQLInputValue[]) => Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value]));
  const adapter = {
    execute: async (sql: string, params: SQLInputValue[] = []) => {
      state.calls.push(sql);
      if (state.failVersion && sql.includes("VALUES (10)")) {
        state.failVersion = false;
        throw new Error("版本寫入前中斷");
      }
      if (!params.length) { state.connection.exec(sql); return { rowsAffected: 0 }; }
      const result = state.connection.prepare(sql).run(bind(params));
      return { rowsAffected: Number(result.changes) };
    },
    select: async (sql: string, params: SQLInputValue[] = []) => {
      state.calls.push(sql);
      if (sql.startsWith("SELECT id, term, weight") && state.failRefresh) {
        state.failRefresh = false;
        throw new Error("refresh failed");
      }
      if (sql.startsWith("DELETE") && state.beforeDelete) {
        const callback = state.beforeDelete;
        state.beforeDelete = null;
        await callback();
      }
      if (sql.startsWith("INSERT INTO vocabulary_snapshots") && state.beforeRestore) {
        const callback = state.beforeRestore;
        state.beforeRestore = null;
        await callback();
      }
      return params.length ? state.connection.prepare(sql).all(bind(params)) : state.connection.prepare(sql).all();
    },
  };
  return { default: { load: async () => adapter, get: () => adapter } };
});
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../src/lib/sentry", () => ({ captureError: vi.fn() }));
vi.mock("../../src/i18n", () => ({ default: { global: { t: (key: string) => key } } }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  state.connection = new DatabaseSync(":memory:");
  state.beforeDelete = null;
  state.beforeRestore = null;
  state.calls = [];
  state.failVersion = false;
  state.failRefresh = false;
  setActivePinia(createPinia());
});
afterEach(() => state.connection.close());

async function initialize() {
  const { initializeDatabase } = await import("../../src/lib/database");
  await initializeDatabase();
}
async function restart() { vi.resetModules(); await initialize(); }
async function store() {
  const { useVocabularyStore } = await import("../../src/stores/useVocabularyStore");
  return useVocabularyStore();
}
function row(term: string) { return state.connection.prepare("SELECT * FROM vocabulary WHERE term = ?").get(term); }
function replacements() { return state.connection.prepare("SELECT * FROM vocabulary_replacements ORDER BY id").all(); }
function seedV9(columns = "weight INTEGER NOT NULL DEFAULT 1, source TEXT NOT NULL DEFAULT 'manual', correction_count INTEGER NOT NULL DEFAULT 0, last_corrected_at TEXT,") {
  state.connection.exec(`CREATE TABLE schema_version (version INTEGER PRIMARY KEY); INSERT INTO schema_version VALUES (9);
    CREATE TABLE vocabulary (id TEXT PRIMARY KEY, term TEXT NOT NULL UNIQUE, ${columns} created_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO vocabulary (id, term) VALUES ('old', 'Old');`);
}

describe("migration v10", () => {
  it("新庫走完 v9 才寫 v10；舊 AI 回填不被 v10 跳過", async () => {
    await initialize();
    expect(state.connection.prepare("SELECT MAX(version) AS version FROM schema_version").get()).toMatchObject({ version: 10 });
    expect(state.calls.findIndex((sql) => sql.includes("VALUES (9)"))).toBeLessThan(state.calls.findIndex((sql) => sql.includes("VALUES (10)")));
    state.connection.exec("INSERT INTO vocabulary (id,term) VALUES ('m','Manual')");
    expect(row("Manual")).toMatchObject({ is_reviewed: 1 });
  });
  it("v8 AI 經 v9 回填後升 v10，既有詞全部已檢視", async () => {
    state.connection.exec(`CREATE TABLE schema_version (version INTEGER PRIMARY KEY); INSERT INTO schema_version VALUES (8);
      CREATE TABLE vocabulary (id TEXT PRIMARY KEY, term TEXT NOT NULL UNIQUE, weight INTEGER NOT NULL DEFAULT 1, source TEXT NOT NULL DEFAULT 'manual', created_at TEXT NOT NULL DEFAULT (datetime('now')));
      INSERT INTO vocabulary (id,term,source) VALUES ('a','Tauri','ai');`);
    await initialize();
    expect(row("Tauri")).toMatchObject({ is_reviewed: 1, correction_count: 1 });
  });
  it("v9 升級預設已檢視，suggested 配對仍留在收件匣", async () => {
    seedV9(); await initialize();
    const s = await store();
    await s.recordCorrections([{ term: "Old", misheard: "歐德" }]);
    expect(row("Old")).toMatchObject({ is_reviewed: 1 });
    expect(s.inboxTermList).toHaveLength(0);
    expect(s.suggestedReplacementList[0]).toMatchObject({ term: "Old", status: "suggested" });
    expect(s.inboxCount).toBe(1);
  });
  it("缺欄恢復後升級", async () => {
    seedV9(""); await initialize();
    expect(row("Old")).toMatchObject({ weight: 1, source: "manual", correction_count: 0, is_reviewed: 1 });
  });
  it("欄位已加而版本未寫入，中斷恢復保留新學的未檢視與配對", async () => {
    seedV9(); state.failVersion = true;
    await expect(initialize()).rejects.toThrow("版本寫入前中斷");
    state.connection.exec("UPDATE vocabulary SET is_reviewed=0 WHERE id='old'");
    await restart();
    expect(row("Old")).toMatchObject({ is_reviewed: 0 });
  });
  it("重跑保留 reviewed=0、次數、時間與配對狀態，DDL 不重複", async () => {
    await initialize(); const s = await store();
    await s.addAiSuggestedTerm("Tauri");
    await s.recordCorrections([{ term: "Tauri", misheard: "陶里" }]);
    await s.dismissReplacement(s.suggestedReplacementList[0].id);
    const before = row("Tauri"); const pairs = replacements();
    await restart();
    expect(row("Tauri")).toEqual(before);
    expect(replacements()).toEqual(pairs);
    expect(row("Tauri")).toMatchObject({ is_reviewed: 0 });
    expect(state.connection.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='restore_vocabulary_snapshot'").get()).toMatchObject({ n: 1 });
  });
});

describe("v10 寫入點與提示", () => {
  it("收件匣只列 AI 未檢視詞，不把 manual 或已檢視詞算入徽章", async () => {
    await initialize();
    state.connection.exec(`INSERT INTO vocabulary (id, term, source, is_reviewed)
      VALUES ('manual', 'Manual', 'manual', 0), ('unread', 'Unread', 'ai', 0), ('read', 'Read', 'ai', 1)`);
    const s = await store();
    await s.fetchTermList();
    expect(s.inboxTermList.map((entry) => entry.term)).toEqual(["Unread"]);
    expect(s.inboxCount).toBe(1);
    expect(s.termCount).toBe(3);
  });
  it("手動1／改字新詞1／AI建議新詞0；重學、UNIQUE與加權不改檢視狀態；改詞1", async () => {
    await initialize(); const s = await store();
    await s.addTerm("Manual"); expect(row("Manual")).toMatchObject({ is_reviewed: 1 });
    // 規格 A 要求各寫入點明寫，不能只依賴 migration 的 DEFAULT 1。
    expect(state.calls.find((sql) => sql.startsWith("INSERT INTO vocabulary (id, term, source,"))).toContain("is_reviewed");
    await s.addAiSuggestedTerm("AI"); expect(row("AI")).toMatchObject({ is_reviewed: 0 });
    await s.addAiSuggestedTerm("AI"); expect(row("AI")).toMatchObject({ is_reviewed: 0 });
    await s.recordCorrections([{ term: "Tauri", misheard: "陶里" }]);
    expect(row("Tauri")).toMatchObject({ is_reviewed: 1, correction_count: 1 });
    await s.batchIncrementWeights([String(row("Tauri")!.id)]);
    expect(row("Tauri")).toMatchObject({ is_reviewed: 1, weight: 2 });
    await s.markTermReviewed(String(row("AI")!.id));
    await s.addAiSuggestedTerm("AI"); expect(row("AI")).toMatchObject({ is_reviewed: 1 });
    state.connection.exec("UPDATE vocabulary SET last_corrected_at='2020-01-01' WHERE term='Tauri'");
    const before = row("Tauri")!;
    await s.recordCorrections([{ term: "Tauri", misheard: "桃里" }]);
    expect(row("Tauri")).toEqual({ ...before, correction_count: 2, last_corrected_at: expect.any(String) });
    expect(row("Tauri")!.last_corrected_at).not.toBe(before.last_corrected_at);
    await s.recordCorrections([{ term: "Manual", misheard: "曼紐" }]);
    expect(row("Manual")).toMatchObject({ is_reviewed: 1, source: "manual" });
    await s.addAiSuggestedTerm("AIEdit");
    await s.updateTerm(String(row("AIEdit")!.id), "Edited");
    expect(row("Edited")).toMatchObject({ is_reviewed: 1, source: "manual" });
  });
  it.each(["addAiSuggestedTerm", "舊資料"])("重學 reviewed=0 的詞（%s）只更新次數與時間，仍在收件匣", async (producer) => {
    await initialize(); const s = await store();
    if (producer === "addAiSuggestedTerm") await s.addAiSuggestedTerm("Tauri");
    else state.connection.exec("INSERT INTO vocabulary (id, term, source, is_reviewed, correction_count) VALUES ('old', 'Tauri', 'ai', 0, 7)");
    state.connection.exec("UPDATE vocabulary SET last_corrected_at='2020-01-01' WHERE term='Tauri'");
    const before = row("Tauri")!;
    await s.recordCorrections([{ term: "Tauri", misheard: "陶里" }]);
    expect(row("Tauri")).toEqual({ ...before, correction_count: Number(before.correction_count) + 1, last_corrected_at: expect.any(String) });
    expect(row("Tauri")!.last_corrected_at).not.toBe(before.last_corrected_at);
    expect(s.inboxTermList.map((entry) => entry.term)).toEqual(["Tauri"]);
    expect(s.suggestedReplacementList[0]).toMatchObject({ term: "Tauri", misheard: "陶里", status: "suggested" });
    expect(s.inboxCount).toBe(2);
  });
  it("匯入新增／合併／略過一律1，保留既有次數、時間、配對與來源", async () => {
    await initialize(); const s = await store();
    await s.addAiSuggestedTerm("Merged"); await s.addAiSuggestedTerm("Skipped");
    await s.recordCorrections([{ term: "Merged", misheard: "合併" }, { term: "Skipped", misheard: "略過" }]);
    const before = row("Merged")!; const pairs = replacements();
    expect(before.is_reviewed).toBe(0); expect(row("Skipped")!.is_reviewed).toBe(0);
    expect(await s.importEntries([{ term: "New", source: "ai", weight: 1 }, { term: "merged", source: "manual", weight: 9 }, { term: "skipped", source: "manual", weight: 0 }])).toEqual({ added: 1, merged: 1, skipped: 1 });
    expect(row("New")).toMatchObject({ is_reviewed: 1 });
    expect(state.calls.find((sql) => sql.startsWith("INSERT INTO vocabulary (id, term, weight, source,"))).toContain("last_corrected_at, is_reviewed");
    expect(row("Merged")).toMatchObject({ is_reviewed: 1, source: "ai", weight: 9, correction_count: before.correction_count, last_corrected_at: before.last_corrected_at });
    expect(row("Skipped")).toMatchObject({ is_reviewed: 1, weight: 1 });
    expect(replacements()).toEqual(pairs);
  });
  it("未檢視詞立即入選；只有 applied 送箭頭；保留詞不套用，dismissed重學不復活", async () => {
    await initialize(); const s = await store();
    await s.addAiSuggestedTerm("Tauri");
    await s.recordCorrections([{ term: "Tauri", misheard: "陶里" }]);
    const id = s.suggestedReplacementList[0].id;
    expect(await s.getWhisperTermList(true)).toContain("Tauri");
    expect(await s.getAiTermList("Tauri")).toEqual(["Tauri"]);
    expect(await s.getAiTermList("陶里")).toEqual([]);
    await s.markTermReviewed(String(row("Tauri")!.id));
    expect(s.inboxCount).toBe(1);
    expect(await s.getAiTermList("陶里")).toEqual([]);
    await s.applyReplacement(id);
    expect(await s.getAiTermList("陶里")).toEqual(["Tauri (陶里 → Tauri)"]);
    await s.dismissReplacement(id);
    expect(await s.getAiTermList("陶里")).toEqual([]);
    await s.recordCorrections([{ term: "Tauri", misheard: "陶里" }]);
    expect(replacements()[0]).toMatchObject({ status: "dismissed", hit_count: 2 });
    expect(s.inboxCount).toBe(0);
    await s.recordCorrections([{ term: "Kubernetes", misheard: "Kubernets" }]);
    const approximate = s.suggestedReplacementList[0].id;
    expect(await s.getAiTermList("Kubernets")).toEqual(["Kubernetes"]);
    await s.dismissReplacement(approximate);
    expect(await s.getAiTermList("Kubernets")).toEqual(["Kubernetes"]);
  });
});

describe("原子快照、刪除與復原", () => {
  async function seed() {
    await initialize(); const s = await store();
    await s.recordCorrections([{ term: "Tauri", misheard: "陶里" }, { term: "Tauri", misheard: "桃里" }, { term: "Tauri", misheard: "套里" }, { term: "Other", misheard: "歐瑟" }]);
    const pairs = s.suggestedReplacementList.filter((p) => p.term === "Tauri");
    await s.applyReplacement(pairs[0].id); await s.dismissReplacement(pairs[1].id);
    state.connection.exec("UPDATE vocabulary SET weight=17, created_at='2020-01-01', last_corrected_at='2026-01-01' WHERE term='Tauri'");
    return s;
  }
  it("完整還原8欄主詞與所有7欄配對（含三種狀態），其他詞不受影響", async () => {
    const s = await seed(); const before = row("Tauri"); const pairs = replacements(); const other = row("Other");
    const snapshot = await s.removeTermWithUndo(String(before!.id));
    expect(snapshot!.entry).toMatchObject({ isReviewed: true, weight: 17, correctionCount: 1 });
    expect(snapshot!.replacements).toHaveLength(3);
    expect(row("Tauri")).toBeUndefined(); expect(s.termCount).toBe(1);
    expect(replacements()).toHaveLength(1);
    await s.restoreTerm(snapshot!);
    expect(row("Tauri")).toEqual(before); expect(replacements()).toEqual(pairs); expect(row("Other")).toEqual(other);
    expect(s.termCount).toBe(2); expect(s.inboxCount).toBe(2);
  });
  it("快照操作前完成的 HUD 學習完整入快照，沒有讀後刪除的交錯窗口", async () => {
    const s = await seed();
    const id = String(row("Tauri")!.id);
    state.beforeDelete = () => s.recordCorrections([{ term: "Tauri", misheard: "新陶里" }]).then(() => undefined);
    const start = state.calls.length;
    const snapshot = await s.removeTermWithUndo(id);
    expect(snapshot!.entry.correctionCount).toBe(2);
    expect(snapshot!.replacements).toHaveLength(4);
    expect(state.calls.slice(start).filter((sql) => sql.includes("vocabulary_snapshots"))).toHaveLength(1);
    await s.restoreTerm(snapshot!);
    expect(row("Tauri")).toMatchObject({ correction_count: 2 });
    expect(replacements()).toHaveLength(5);
  });
  it.each(["Tauri", "tauri"])("同名%s已重建時保留目前資料，不通知成功並回傳清楚錯誤", async (term) => {
    const s = await seed(); const snapshot = await s.removeTermWithUndo(String(row("Tauri")!.id));
    await s.recordCorrections([{ term, misheard: "重學" }]);
    const current = row(term); const pairs = replacements();
    const { emit } = await import("@tauri-apps/api/event"); vi.mocked(emit).mockClear();
    await expect(s.restoreTerm(snapshot!)).rejects.toThrow("dictionary.inbox.restoreConflict");
    expect(row(term)).toEqual(current); expect(replacements()).toEqual(pairs); expect(emit).not.toHaveBeenCalled();
  });
  it.each([["Éclair", "éclair"], ["Δέλτα", "δέλτα"]])("Unicode 同名 %s→%s 手動重建後不能覆蓋", async (original, currentTerm) => {
    await initialize(); const s = await store();
    await s.addAiSuggestedTerm(original);
    const snapshot = await s.removeTermWithUndo(String(row(original)!.id));
    await s.addTerm(currentTerm);
    const current = row(currentTerm);
    await expect(s.restoreTerm(snapshot!)).rejects.toThrow("dictionary.inbox.restoreConflict");
    expect(row(currentTerm)).toEqual(current); expect(row(original)).toBeUndefined();
  });
  it.each(["learn", "rename"])("讀取後 HUD 學習或同數量改名（%s）造成 Unicode 同名，復原重讀後拒絕", async (operation) => {
    await initialize(); const s = await store();
    await s.recordCorrections([{ term: "Éclair", misheard: "點心" }, { term: "Other", misheard: "別詞" }]);
    const snapshot = await s.removeTermWithUndo(String(row("Éclair")!.id));
    state.beforeRestore = async () => {
      if (operation === "learn") await s.recordCorrections([{ term: "éclair", misheard: "新學" }]);
      else await s.updateTerm(String(row("Other")!.id), "éclair");
    };
    await expect(s.restoreTerm(snapshot!)).rejects.toThrow("dictionary.inbox.restoreConflict");
    expect(row("Éclair")).toBeUndefined(); expect(row("éclair")).toBeDefined();
    expect(replacements()).toHaveLength(operation === "learn" ? 2 : 1);
  });
  it("讀取後 HUD 學到不同詞，復原重試仍成功並保留新詞", async () => {
    const s = await seed(); const snapshot = await s.removeTermWithUndo(String(row("Tauri")!.id));
    state.beforeRestore = () => s.recordCorrections([{ term: "Unrelated", misheard: "另個詞" }]).then(() => undefined);
    await s.restoreTerm(snapshot!);
    expect(row("Tauri")).toBeDefined(); expect(row("Unrelated")).toBeDefined();
    expect(replacements()).toHaveLength(5);
  });
  it("配對回存失敗會回滾主詞與先前配對，不回報成功", async () => {
    const s = await seed(); const snapshot = await s.removeTermWithUndo(String(row("Tauri")!.id));
    state.connection.exec("CREATE TRIGGER fail_pair BEFORE INSERT ON vocabulary_replacements WHEN NEW.misheard='套里' BEGIN SELECT RAISE(ABORT, 'disk full'); END");
    const { emit } = await import("@tauri-apps/api/event"); vi.mocked(emit).mockClear();
    await expect(s.restoreTerm(snapshot!)).rejects.toThrow("disk full");
    expect(row("Tauri")).toBeUndefined(); expect(replacements()).toHaveLength(1); expect(emit).not.toHaveBeenCalled();
  });
  it("同詞條dismissed不復活；刪掉重學視為新詞；空快照可復原", async () => {
    await initialize(); const s = await store();
    await s.recordCorrections([{ term: "Tauri", misheard: "陶里" }]);
    await s.dismissReplacement(s.suggestedReplacementList[0].id);
    await s.removeTermWithUndo(String(row("Tauri")!.id));
    await s.recordCorrections([{ term: "Tauri", misheard: "陶里" }]);
    expect(s.suggestedReplacementList).toHaveLength(1);
    await s.addTerm("Manual");
    const snapshot = await s.removeTermWithUndo(String(row("Manual")!.id));
    expect(snapshot!.replacements).toEqual([]);
    await s.restoreTerm(snapshot!); expect(row("Manual")).toMatchObject({ is_reviewed: 1 });
    expect(await s.removeTermWithUndo("missing")).toBeNull();
  });
  it("mark/remove/restore/apply/dismiss 每次都刷新本地與通知其他視窗", async () => {
    await initialize(); const s = await store();
    await s.recordCorrections([{ term: "Tauri", misheard: "陶里" }]);
    const id = String(row("Tauri")!.id); const pairId = s.suggestedReplacementList[0].id;
    const { emit } = await import("@tauri-apps/api/event");
    for (const operation of [() => s.markTermReviewed(id), () => s.applyReplacement(pairId), () => s.dismissReplacement(pairId)]) {
      vi.mocked(emit).mockClear(); await operation();
      expect(emit).toHaveBeenCalledWith("vocabulary:changed", expect.anything());
    }
    expect(s.inboxCount).toBe(0);
    vi.mocked(emit).mockClear(); const snapshot = await s.removeTermWithUndo(id);
    expect(s.termCount).toBe(0); expect(emit).toHaveBeenCalledTimes(1);
    vi.mocked(emit).mockClear(); await s.restoreTerm(snapshot!);
    expect(s.termCount).toBe(1); expect(emit).toHaveBeenCalledTimes(1);
  });
  it("已提交刪除但刷新失敗，仍拿到完整快照並通知其他視窗，之後可復原", async () => {
    const s = await seed(); const before = row("Tauri"); const pairs = replacements();
    const { emit } = await import("@tauri-apps/api/event"); vi.mocked(emit).mockClear();
    state.failRefresh = true;
    const snapshot = await s.removeTermWithUndo(String(before!.id));
    expect(snapshot!.entry.term).toBe("Tauri"); expect(snapshot!.replacements).toHaveLength(3);
    expect(row("Tauri")).toBeUndefined(); expect(emit).toHaveBeenCalledTimes(1);
    await s.restoreTerm(snapshot!);
    expect(row("Tauri")).toEqual(before); expect(replacements()).toEqual(pairs);
  });
  it.each(["mark", "restore", "apply", "dismiss"] as const)("%s 已提交後刷新失敗仍成功並通知其他視窗", async (operation) => {
    const s = await seed(); const id = String(row("Tauri")!.id); const pairId = s.suggestedReplacementList[0].id;
    const snapshot = operation === "restore" ? await s.removeTermWithUndo(id) : null;
    const { emit } = await import("@tauri-apps/api/event"); vi.mocked(emit).mockClear();
    state.failRefresh = true;
    if (operation === "mark") { await s.markTermReviewed(id); expect(row("Tauri")).toMatchObject({ is_reviewed: 1 }); }
    if (operation === "restore") { await s.restoreTerm(snapshot!); expect(row("Tauri")).toBeDefined(); }
    if (operation === "apply") { await s.applyReplacement(pairId); expect(replacements().find((r) => r.id === pairId)).toMatchObject({ status: "applied" }); }
    if (operation === "dismiss") { await s.dismissReplacement(pairId); expect(replacements().find((r) => r.id === pairId)).toMatchObject({ status: "dismissed" }); }
    expect(emit).toHaveBeenCalledTimes(1);
  });
});
