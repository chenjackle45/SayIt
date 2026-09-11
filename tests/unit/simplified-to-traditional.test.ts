import { describe, expect, it } from "vitest";
import { convertSimplifiedToTraditional } from "../../src/lib/simplifiedToTraditional";

describe("convertSimplifiedToTraditional（#39 簡→繁）", () => {
  it("[P0] 簡體字應轉成繁體", () => {
    expect(convertSimplifiedToTraditional("这是简体中文测试")).toBe(
      "這是簡體中文測試",
    );
  });

  it("[P0] 常見一對多字應轉成台灣正體", () => {
    // 発/發、机→機、后→後、里→裡（依詞轉正）
    expect(convertSimplifiedToTraditional("计算机里面发现问题")).toBe(
      "計算機裡面發現問題",
    );
  });

  it("[P0] 已是繁體的文字應保持不變", () => {
    expect(convertSimplifiedToTraditional("這已經是繁體字了")).toBe(
      "這已經是繁體字了",
    );
  });

  it("[P0] 空字串原樣返回", () => {
    expect(convertSimplifiedToTraditional("")).toBe("");
  });

  it("[P1] 粵語專用字不在轉換表、原樣保留（gh-74 廣東話也套簡→繁）", () => {
    const cantonese = "今日我哋去咗茶餐廳食嘢，你想飲奶茶定係鴛鴦，唔好玩到咁夜，佢哋喺邊度，我嘅嘢冇幾多，早啲走";
    expect(convertSimplifiedToTraditional(cantonese)).toBe(cantonese);
    // 混入簡體時只轉簡體字
    expect(convertSimplifiedToTraditional("我们哋去饮奶茶")).toBe("我們哋去飲奶茶");
  });

  it("[P1] 中英數混雜只轉中文字", () => {
    expect(convertSimplifiedToTraditional("请打开 GitHub issue 3")).toBe(
      "請打開 GitHub issue 3",
    );
  });
});
