import { describe, it, expect } from "vitest";
import {
  calculateWhisperCostCeiling,
  calculateChatCostCeiling,
} from "../../src/lib/apiPricing";

describe("apiPricing.ts", () => {
  // ==========================================================================
  // calculateWhisperCostCeiling
  // ==========================================================================

  describe("calculateWhisperCostCeiling", () => {
    it("[P0] 10 秒音檔應按最低計費 10 秒計算", () => {
      // 10000ms = 10s → 10/3600 * 0.111 = 0.000308333...
      const cost = calculateWhisperCostCeiling(10_000);
      expect(cost).toBeCloseTo(0.000308, 5);
    });

    it("[P0] 低於 10 秒應按最低計費 10 秒計算", () => {
      const cost5s = calculateWhisperCostCeiling(5_000);
      const cost10s = calculateWhisperCostCeiling(10_000);
      expect(cost5s).toBe(cost10s);
    });

    it("[P0] 0ms 應按最低計費 10 秒計算", () => {
      const cost = calculateWhisperCostCeiling(0);
      const cost10s = calculateWhisperCostCeiling(10_000);
      expect(cost).toBe(cost10s);
    });

    it("[P0] 1 小時應回傳 $0.111", () => {
      const cost = calculateWhisperCostCeiling(3_600_000);
      expect(cost).toBeCloseTo(0.111, 6);
    });

    it("[P1] 30 秒應正確按比例計算", () => {
      // 30000ms = 30s → 30/3600 * 0.111 = 0.000925
      const cost = calculateWhisperCostCeiling(30_000);
      expect(cost).toBeCloseTo(0.000925, 5);
    });

    it("[P1] 1 秒應按最低 10 秒計費", () => {
      const cost1s = calculateWhisperCostCeiling(1_000);
      const cost10s = calculateWhisperCostCeiling(10_000);
      expect(cost1s).toBe(cost10s);
    });
  });

  // ==========================================================================
  // calculateChatCostCeiling
  // ==========================================================================

  describe("calculateChatCostCeiling", () => {
    it("[P0] 0 tokens 應回傳 0", () => {
      expect(calculateChatCostCeiling(0)).toBe(0);
    });

    it("[P0] 1000 tokens 應按 output 價格上限計算", () => {
      // 1000 * 0.00000079 = 0.00079
      const cost = calculateChatCostCeiling(1000);
      expect(cost).toBeCloseTo(0.00079, 6);
    });

    it("[P0] 1M tokens 應回傳 $0.79", () => {
      const cost = calculateChatCostCeiling(1_000_000);
      expect(cost).toBeCloseTo(0.79, 4);
    });

    it("[P1] 150 tokens 應正確計算", () => {
      // 150 * 0.00000079 = 0.0001185
      const cost = calculateChatCostCeiling(150);
      expect(cost).toBeCloseTo(0.0001185, 6);
    });
  });
});
