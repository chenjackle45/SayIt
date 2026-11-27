// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasInternalCorrection, learnVocabularyCorrections } from "../../src/lib/vocabularyLearning";

// 固定的模擬 AI 專有名詞候選池，含純新增詞與截斷詞；不從 expectTerms 取得輸入。
// 只評位置把關與配對，不測 AI 對「專有名詞」的語義判斷。
const candidates: Record<string, string[]> = {
  "zh-TW": ["阿欽", "製令單", "Tauri", "React", "Kubernetes", "陳泰呈", "烏帕替尼", "第五琦"],
  "zh-CN": ["Golang", "诸葛琳", "上官靖", "代位权", "尼拉帕利", "达格列净"],
  en: ["Anny", "Ariya", "Supabase", "Teleg", "Telegram", "RabbitMQ", "Kafka", "Tailscale", "Meilisearch", "Fjällräven", "Kubernetes"],
  ja: ["東海林", "小鳥遊", "アクセシビリティ", "デュピルマブ", "ヘリノックス"],
  ko: ["쿠버네티스", "제갈윤", "우스테키누맙", "선우정아"],
};

interface LearningCase {
  id: string; lang: string; pasted: string; corrected: string;
  expectTerms: string[]; expectPairs: { term: string; misheard: string }[];
}

for (const suite of ["a", "b"]) {
  const cases = readFileSync(new URL(`../eval/vocab/learning-${suite}.jsonl`, import.meta.url), "utf8")
    .trim().split("\n").map((line) => JSON.parse(line) as LearningCase);
  describe(`learning-${suite} 離線位置／配對評估（固定候選池，無 API）`, () => {
    it("不該學的 0 筆；召回 ≥80%、精確 ≥90%", () => {
      let expected = 0;
      let output = 0;
      let hits = 0;
      let falseTerms = 0;
      for (const row of cases) {
        const pairs = learnVocabularyCorrections(row.pasted, row.corrected, candidates[row.lang]);
        expected += row.expectPairs.length;
        output += pairs.length;
        hits += pairs.filter((pair) => row.expectPairs.some((target) => target.term === pair.term && target.misheard === pair.misheard)).length;
        falseTerms += pairs.filter((pair) => !row.expectTerms.includes(pair.term)).length;
      }
      console.log(JSON.stringify({ suite: `learning-${suite}`, expected, output, hits, recall: hits / expected, precision: output ? hits / output : 0, falseTerms, mode: "固定候選池；非 AI 端到端" }));
      expect(falseTerms).toBe(0);
      expect(hits / expected).toBeGreaterThanOrEqual(0.8);
      expect(hits / output).toBeGreaterThanOrEqual(0.9);
    });
  });
}

describe("對齊回推", () => {
  it("R1 純新增詞不因另一處標點刪除而存成配對", () => {
    expect(learnVocabularyCorrections("今天用電腦，開會", "今天用台積電的電腦開會", ["台積電"])).toEqual([]);
    expect(learnVocabularyCorrections("We use Go, now", "We use Golang and Go now", ["Golang"])).toEqual([]);
  });

  it("另一處有改正時，句尾純新增不能回推成整段原文", () => {
    expect(learnVocabularyCorrections("李明哲完成部署", "李銘哲完成部署 Kubernetes", ["李銘哲", "Kubernetes"]))
      .toEqual([{ term: "李銘哲", misheard: "李明哲" }]);
  });

  it("R2 同詞一處改正一處刪空白，只存真正改正的配對", () => {
    expect(learnVocabularyCorrections("先用 Tauri  再用陶里打包", "先用 Tauri 再用 Tauri 打包", ["Tauri"]))
      .toEqual([{ term: "Tauri", misheard: "陶里" }]);
  });

  it("R3 連續空白不把原文連接詞吞進配對", () => {
    expect(learnVocabularyCorrections("用Tauri  和陶里打包", "用Tauri 和 Tauri 打包", ["Tauri"]))
      .toEqual([{ term: "Tauri", misheard: "陶里" }]);
  });

  it.each(["\t\t", "\n\n", "\u00a0\u00a0"])("其他連續空白也不吞進配對：%j", (gap) => {
    expect(learnVocabularyCorrections(`用Tauri${gap}和陶里打包`, "用Tauri 和 Tauri 打包", ["Tauri"]))
      .toEqual([{ term: "Tauri", misheard: "陶里" }]);
  });

  it("改後增加的連續空白仍映回原詞位置", () => {
    expect(learnVocabularyCorrections("先用 Tauri 再用陶里打包", "先用 Tauri   再用 Tauri 打包", ["Tauri"]))
      .toEqual([{ term: "Tauri", misheard: "陶里" }]);
  });

  it.each([
    ["請用陶里，陶里打包", "請用 React、陶里，Tauri 打包"],
    ["請用陶里，陶里打包", "請用 React、陶里、Tauri 打包"],
    ["請用陶里。陶里打包", "請用 React、陶里，Tauri 打包"],
    ["請用陶里，陶里打包", "請用 React，陶里，Tauri 打包"],
    ["請用陶里、陶里打包", "請用 React、陶里、Tauri 打包"],
  ])("分隔標點改寫時不把新增詞配給重複錯詞：%s → %s", (pasted, corrected) => {
    expect(learnVocabularyCorrections(pasted, corrected, ["React", "Tauri"])).toEqual([]);
  });

  it.each([
    ["請用 Preact，Preact 打包", "請用 React，Preact，Tauri 打包"],
    ["Please use Preact, Preact package", "Please use React, Preact, Tauri package"],
  ])("排除候選時不能挖掉較長原詞裡的片段：%s → %s", (pasted, corrected) => {
    expect(learnVocabularyCorrections(pasted, corrected, ["React", "Tauri"])).toEqual([]);
  });

  it("重疊中日韓候選只排除原始區段聯集，不多刪保留的來源", () => {
    expect(learnVocabularyCorrections("請找阿安，阿安確認", "請找安安安阿安，Tauri確認", ["安安", "Tauri"]))
      .toEqual([]);
  });

  it("來源重複但全部明確改正時仍學習，英文插字不當成保留舊詞", () => {
    expect(learnVocabularyCorrections("Go now and Go later", "Golang now and Golang later", ["Golang"]))
      .toEqual([{ term: "Golang", misheard: "Go" }]);
    expect(learnVocabularyCorrections("Go now and 陶里 later", "Golang now and 陶里 later", ["Golang"]))
      .toEqual([{ term: "Golang", misheard: "Go" }]);
    expect(learnVocabularyCorrections("Use Go for logos", "Use Golang for logos", ["Golang"]))
      .toEqual([{ term: "Golang", misheard: "Go" }]);
    expect(learnVocabularyCorrections("找李明開會，李明確認", "找李明哲開會，李明哲確認", ["李明哲"]))
      .toEqual([{ term: "李明哲", misheard: "李明" }]);
  });

  it.each([
    ["用 C# 打包", "用 C++ 打包", "C++", "C#"],
    ["使用 .NET 部署", "使用 dotnet 部署", "dotnet", ".NET"],
  ])("來源詞保留有語義的首尾符號：%s → %s", (pasted, corrected, term, misheard) => {
    expect(learnVocabularyCorrections(pasted, corrected, [term])).toEqual([{ term, misheard }]);
  });

  it("同次其他地方有改正，也不把摘錄句尾後續內容配給新增詞", () => {
    expect(learnVocabularyCorrections("先用陶里，然後確認資料夾", "先用Tauri，然後React", ["Tauri", "React"]))
      .toEqual([{ term: "Tauri", misheard: "陶里" }]);
  });

  it("R4 完整句尾替換回推完整錯詞", () => {
    expect(learnVocabularyCorrections("請找陳太誠", "請找陳泰呈", ["陳泰呈"]))
      .toEqual([{ term: "陳泰呈", misheard: "陳太誠" }]);
  });

  it.each([
    ["請找陳太誠", "請找陳泰呈太誠", "陳泰呈"],
    ["請找李哲後", "請找李銘哲", "李銘哲"],
    ["請找陳太誠開會", "請找陳泰呈", "陳泰呈"],
    ["我用陶里先打包", "我用 Tauri", "Tauri"],
  ])("句尾補全不能吞入新增或摘錄外內容：%s → %s", (pasted, corrected, term) => {
    expect(learnVocabularyCorrections(pasted, corrected, [term])).toEqual([]);
  });

  it("正規化相同的配對不學（包含大小寫）", () => {
    expect(learnVocabularyCorrections("使用 tauri 打包", "使用 Tauri 打包", ["Tauri"])).toEqual([]);
  });

  it.each(["陶", "あ", "タ", "타", "𠮷"])("只有一個中日韓字元的來源不學：%s", (misheard) => {
    expect(learnVocabularyCorrections(`用${misheard}打包`, "用 Tauri 打包", ["Tauri"])).toEqual([]);
  });

  it("正規化只影響對齊，配對保留原文內的空白及 Unicode 位置", () => {
    expect(learnVocabularyCorrections("😀用super  base打包", "😀用 Supabase 打包", ["Supabase"]))
      .toEqual([{ term: "Supabase", misheard: "super  base" }]);
  });

  it("只有空白標點變動不呼叫 AI，拉丁詞仍依原文詞界判斷", () => {
    expect(hasInternalCorrection("用 Tauri，打包", "用Tauri 打包")).toBe(false);
    expect(learnVocabularyCorrections("使用 Preact 打包", "使用 Reacts 打包", ["React"])).toEqual([]);
  });

  it.each([
    ["We use Go now", "We use Golang and Go now", ["Golang"]],
    ["今天用電腦開會", "今天用台積電的電腦開會", ["台積電"]],
    ["前文今天用電腦開會後文", "今天用台積電的電腦開會", ["台積電"]],
    ["prefix We use Go now suffix", "We use Golang and Go now", ["Golang"]],
    ["今天用电脑开会", "今天用台积电的电脑开会", ["台积电"]],
    ["今日は東口で会議", "今日は東芝の東口で会議", ["東芝"]],
    ["오늘 삼성동에서 회의", "오늘 삼성전자의 삼성동에서 회의", ["삼성전자"]],
    ["We use Go now", "We use Golang and Go right now", ["Golang"]],
    ["We use Go now", "We use Golang and Go with Golang now", ["Golang"]],
    ["😀今天用電腦跑 Go", "😀今天用台積電的電腦跑 Golang 和 Go", ["台積電", "Golang"]],
  ])("候選可完全視為純新增時不學：%s → %s", (pasted, corrected, terms) => {
    expect(learnVocabularyCorrections(pasted, corrected, terms)).toEqual([]);
  });

  it.each([
    ["電腦很好用", "台積電，電腦很好用", ["台積電"]],
    ["Go now", "Golang Go now", ["Golang"]],
    ["電腦很好用", "電腦很好用，台積電", ["台積電"]],
    ["Go now", "Go now Golang", ["Golang"]],
    ["電腦很好用", "台積電，電腦很好用，台積電", ["台積電"]],
    ["Go now", "Golang Go now Golang", ["Golang"]],
  ])("完整保留原文時不學周邊新增：%s → %s", (pasted, corrected, terms) => {
    expect(hasInternalCorrection(pasted, corrected)).toBe(false);
    expect(learnVocabularyCorrections(pasted, corrected, terms)).toEqual([]);
  });

  it.each([
    ["原文完全不變", "原文完全不變", false],
    ["前面文字，原文不變，後面文字", "原文不變", false],
    ["用 Tauri", "前文用 Tauri後文", false],
    ["用 Tauri", "用 Tauri，後面新增文字", false],
    ["用 Tauri", "前面新增文字，用 Tauri", false],
    ["😀用 Tauri", "前文😀用 Tauri後文", false],
    ["請用 Kubernetess 部署", "請用 Kubernetes 部署", true],
    ["請找陳太誠", "請找陳泰呈", true],
    ["Kubernets", "Kubernetes", true],
    ["李小銘哲", "李銘哲", true],
    ["李明哲確認", "王明哲確認", true],
    ["", "", false],
  ])("AI 前檢查 %s → %s", (pasted, corrected, expected) => {
    expect(hasInternalCorrection(pasted, corrected)).toBe(expected);
  });

  it.each([
    ["Go now", "Golang now", ["Golang"], [{ term: "Golang", misheard: "Go" }]],
    ["找李哲開會", "找李明哲開會", ["李明哲"], [{ term: "李明哲", misheard: "李哲" }]],
    ["請用 XKubernetes 部署", "請用 Kubernetes 部署", ["Kubernetes"], [{ term: "Kubernetes", misheard: "XKubernetes" }]],
    ["請用 Kubernetesx 部署", "請用 Kubernetes 部署", ["Kubernetes"], [{ term: "Kubernetes", misheard: "Kubernetesx" }]],
    ["安裝陶里結束", "安裝 Tauri 和 React 結束", ["Tauri"], []],
    ["安裝陶里結束", "安裝 Tauri 和 React 結束", ["Tauri", "React"], []],
    ["請部署完再回報", "請部署 Kubernetes 完再回報", ["Kubernetes"], []],
    ["李明哲完成部署", "李銘哲完成 Kubernetes 部署", ["Kubernetes"], []],
    ["請聯絡李明哲處理", "李銘哲處理", ["李銘哲"], []],
    ["請用 Kubernets 完成部署", "請用 Kubernetes", ["Kubernetes"], []],
    ["請找李明哲", "請找李銘哲", ["李銘哲"], [{ term: "李銘哲", misheard: "李明哲" }]],
    ["李明哲", "李銘哲", ["李銘哲"], [{ term: "李銘哲", misheard: "李明哲" }]],
    ["Kubernets", "Kubernetes", ["Kubernetes"], [{ term: "Kubernetes", misheard: "Kubernets" }]],
    ["用 Kubernets 部署", "用 Kubernetes 部署", ["Kubernetes"], [{ term: "Kubernetes", misheard: "Kubernets" }]],
    ["請用 Kubernetess 部署", "請用 Kubernetes 部署", ["Kubernetes"], [{ term: "Kubernetes", misheard: "Kubernetess" }]],
    ["請找李小銘哲", "請找李銘哲", ["李銘哲"], [{ term: "李銘哲", misheard: "李小銘哲" }]],
    ["請部署", "請部署，改用 Kubernetes", ["Kubernetes"], []],
    ["Send it to Telegram", "Send it to Teleg", ["Teleg"], []],
    ["請聯絡李明哲處理", "銘哲處理", ["銘哲"], []],
    ["用陶里打包", "用 Tauri 打包", ["Tauri", "tauri"], [{ term: "Tauri", misheard: "陶里" }]],
    ["用陶里打包", "用 Tauri 打包", [" tauri ", "Tauri"], [{ term: "tauri", misheard: "陶里" }]],
    ["前方內容用陶里後方內容", "用 Tauri", ["Tauri"], []],
    ["我用陶里打包", "Tauri 打包", ["Tauri"], []],
    ["我用陶里打包", "我用 Tauri", ["Tauri"], []],
    ["請聯絡小李", "請聯絡小李，另外邀請李銘哲", ["李銘哲"], []],
    ["今天要找阿親", "今天要找阿親，還有親民黨", ["親民黨"], []],
    ["請聯絡小李確認", "請聯絡小李，另外邀請李銘哲確認", ["李銘哲"], []],
    ["請聯絡小李處理", "請聯絡小李、李銘哲處理", ["李銘哲"], []],
    ["今天要找阿親開會", "今天要找阿親，還有親民黨開會", ["親民黨"], []],
    ["今天要找阿親開會", "今天要找親民黨和阿親開會", ["親民黨"], []],
    ["陶里瑞艾克特", "Tauri React", ["Tauri", "React"], []],
    ["安裝陶里", "安裝 Tauri 和 React", ["Tauri"], []],
    ["安裝陶里", "安裝 Tauri 和 React", ["Tauri", "React"], []],
    ["用 Tauri 開發", "用 Tauri 和 React 開發", ["Tauri", "React"], []],
    ["React 生態", "Preact 生態", ["react"], []],
    ["工具用陶里", "工具用 Tauri", ["Tauri", "Tauri"], []],
    ["工具用陶里打包", "工具用 Tauri 打包", ["Tauri", "Tauri"], [{ term: "Tauri", misheard: "陶里" }]],
    ["😀用陶里打包", "😀用 Tauri 打包", ["Tauri"], [{ term: "Tauri", misheard: "陶里" }]],
    ["小鳥あそびさん", "小鳥遊さん", ["小鳥遊"], [{ term: "小鳥遊", misheard: "小鳥あそび" }]],
    ["쿠버네티즈로", "쿠버네티스로", ["쿠버네티스"], [{ term: "쿠버네티스", misheard: "쿠버네티즈" }]],
    ["介面給阿親用 Kubernets", "介面給阿欽用 Kubernetes", ["阿欽", "Kubernetes"], [{ term: "阿欽", misheard: "阿親" }, { term: "Kubernetes", misheard: "Kubernets" }]],
    ["用陶里打包，陶里很小", "用 Tauri 打包，Tauri 很小", ["Tauri"], [{ term: "Tauri", misheard: "陶里" }]],
  ])("%s → %s", (pasted, corrected, terms, expected) => {
    expect(learnVocabularyCorrections(pasted, corrected, terms)).toEqual(expected);
  });
});
