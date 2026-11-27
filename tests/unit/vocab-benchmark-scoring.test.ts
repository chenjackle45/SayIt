import { describe, expect, it } from "vitest";
// @ts-expect-error 評估腳本是純 JS 模組（不隨 App 出貨），沒有型別宣告
import { countTerm, scoreCase, aggregate, decidePromotion } from "../../scripts/vocab-benchmark/scoring.mjs";

const baseCase = {
  id: "t",
  lang: "en",
  domain: "names",
  spoken: "",
  expected: "",
  entities: [] as string[],
  keep: [] as string[],
  selfCorrection: false,
};

describe("countTerm", () => {
  it("拉丁詞看詞界：Ann 不算出現在 Anna 裡", () => {
    expect(countTerm("Ask Anna to join", "Ann")).toBe(0);
    expect(countTerm("Ask Ann to join", "Ann")).toBe(1);
  });

  it("拉丁詞不分大小寫、多字詞容許空白或連字號差異", () => {
    expect(countTerm("we use KUBERNETES", "Kubernetes")).toBe(1);
    expect(countTerm("attorney client privilege", "attorney-client privilege")).toBe(1);
  });

  it("中日韓詞以子字串計次，忽略標點", () => {
    expect(countTerm("不要，不要再用了", "不要")).toBe(2);
    expect(countTerm("我跟阿欽、阿欽約", "阿欽")).toBe(1 + 1);
  });
});

describe("scoreCase", () => {
  it("同句兩個否定只保留一個，算刪除", () => {
    const c = { ...baseCase, lang: "zh-TW", keep: ["不要"] };
    const reference = "不要開，也不要寄";
    const row = scoreCase(c, "不要開，也寄", reference, []);
    expect(row.keepMissing).toBe(1);
  });

  it("刪掉否定詞即使字元錯誤率很低也記為刪除", () => {
    const c = { ...baseCase, lang: "zh-TW", entities: ["Kubernetes"], keep: ["禁止", "Kubernetes"] };
    const row = scoreCase(c, "請開啟 Kubernetes，刪除備份", "請開啟 Kubernetes，禁止刪除備份", []);
    expect(row.entityHits).toBe(1);
    expect(row.keepMissing).toBe(1);
  });

  it("詞庫詞出現在輸出但標準答案沒有，記為誤改", () => {
    const c = { ...baseCase };
    const row = scoreCase(c, "Book Tauri for Tuesday", "Book the room for Tuesday", ["Tauri"]);
    expect(row.hasFalseReplacement).toBe(1);
  });

  it("數字字元不計入字元錯誤率", () => {
    const c = { ...baseCase, lang: "zh-TW", keep: ["120"] };
    expect(scoreCase(c, "血糖降到一百二十", "血糖降到120", []).cer).toBe(0);
  });
});

describe("decidePromotion", () => {
  const ids = ["a1", "a2"];
  const metrics = (entityHitCount: number, falseReplacementCount = 0, overrides = {}) => ({ entityHitCount, falseReplacementCount, ids, ...overrides });

  it("命中數多 3 個以上且誤改題數不增才換；只多 1–2 個視為雜訊", () => {
    expect(decidePromotion({ all: metrics(10, 1) }, { all: metrics(13, 1) }, ids)).toEqual({ promote: true, reasons: [] });
    expect(decidePromotion({ all: metrics(10, 1) }, { all: metrics(12, 1) }, ids).promote).toBe(false);
  });

  it("命中數持平或下降不換", () => {
    expect(decidePromotion({ all: metrics(10) }, { all: metrics(10) }, ids).promote).toBe(false);
    expect(decidePromotion({ all: metrics(10) }, { all: metrics(9) }, ids).promote).toBe(false);
  });

  it("誤改題數多一題就不換（不再容忍 +1pt）", () => {
    expect(decidePromotion({ all: metrics(10, 1) }, { all: metrics(20, 2) }, ids).promote).toBe(false);
  });

  it("缺成績、缺題目或沒有題單不得放行", () => {
    expect(decidePromotion({}, {}, ids).promote).toBe(false);
    expect(decidePromotion({ all: metrics(10) }, { all: metrics(20, 0, { ids: ["a1"] }) }, ids).promote).toBe(false);
    expect(decidePromotion({ all: metrics(10) }, { all: metrics(20) }, []).promote).toBe(false);
  });

  it("C++、C# 不得被只有 C 的輸出算命中", () => {
    expect(countTerm("We use C", "C++")).toBe(0);
    expect(countTerm("We use C", "C#")).toBe(0);
    expect(countTerm("We use C++ daily", "C++")).toBe(1);
  });

  it("aggregate 以總數計百分比並帶出題目 ID", () => {
    const row = { entityTotal: 2, entityHits: 1, hasFalseReplacement: 0, keepTotal: 2, keepMissing: 0, numericTotal: 0, numericHits: 0, cer: 0.1, selfCorrection: 0, id: "b" };
    const row2 = { ...row, entityHits: 2, hasFalseReplacement: 1, keepMissing: 1, numericTotal: 1, numericHits: 1, cer: 0.3, selfCorrection: 1, id: "a" };
    expect(aggregate([row, row2])).toMatchObject({ entityHitRate: 75, entityHitCount: 3, falseReplacementCount: 1, keepDeletionRate: 25, cer: 20, selfCorrectionCer: 30, ids: ["a", "b"] });
  });
});
