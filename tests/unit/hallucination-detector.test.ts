import { describe, it, expect } from "vitest";
import {
  detectHallucination,
  detectEnhancementAnomaly,
  SPEED_ANOMALY_MAX_DURATION_MS,
  SPEED_ANOMALY_MIN_CHARS,
  SILENCE_PEAK_ENERGY_THRESHOLD,
  SILENCE_RMS_THRESHOLD,
  SILENCE_NSP_THRESHOLD,
  LAYER2B_PEAK_ENERGY_CEILING,
  ENHANCEMENT_LENGTH_EXPLOSION_RATIO,
  detectSemanticDrift,
  SEMANTIC_DRIFT_MIN_OVERLAP,
} from "../../src/lib/hallucinationDetector";

/** 正常語音的預設參數（Layer 1/2 都不觸發） */
const NORMAL_DEFAULTS = {
  rmsEnergyLevel: 0.1,
  noSpeechProbability: 0.1,
};

describe("hallucinationDetector.ts", () => {
  describe("常數值驗證", () => {
    it("[P0] 常數應符合設計規格", () => {
      expect(SPEED_ANOMALY_MAX_DURATION_MS).toBe(1000);
      expect(SPEED_ANOMALY_MIN_CHARS).toBe(10);
      expect(SILENCE_PEAK_ENERGY_THRESHOLD).toBe(0.01);
      expect(SILENCE_RMS_THRESHOLD).toBe(0.015);
      expect(SILENCE_NSP_THRESHOLD).toBe(0.7);
      expect(LAYER2B_PEAK_ENERGY_CEILING).toBe(0.03);
    });
  });

  describe("Layer 1: 語速異常偵測", () => {
    it("[P0] 錄音 < 1 秒且文字 > 10 字 → 幻覺", () => {
      const result = detectHallucination({
        rawText: "謝謝收看請訂閱我的頻道感謝大家",
        recordingDurationMs: 500,
        peakEnergyLevel: 0.5,
        ...NORMAL_DEFAULTS,
      });

      expect(result.isHallucination).toBe(true);
      expect(result.reason).toBe("speed-anomaly");
      expect(result.detectedText).toBe("謝謝收看請訂閱我的頻道感謝大家");
    });

    it("[P0] 錄音恰好 1000ms 不應觸發 Layer 1", () => {
      const result = detectHallucination({
        rawText: "謝謝收看請訂閱我的頻道感謝大家",
        recordingDurationMs: 1000,
        peakEnergyLevel: 0.001,
        ...NORMAL_DEFAULTS,
      });

      // Layer 1 不觸發，但 Layer 2 無人聲偵測會攔截
      expect(result.reason).not.toBe("speed-anomaly");
    });

    it("[P0] 文字恰好 10 字不應觸發 Layer 1", () => {
      const result = detectHallucination({
        rawText: "一二三四五六七八九十",
        recordingDurationMs: 500,
        peakEnergyLevel: 0.5,
        ...NORMAL_DEFAULTS,
      });

      expect(result.isHallucination).toBe(false);
    });

    it("[P1] 帶前後空白的文字應 trim 後計算字數", () => {
      const result = detectHallucination({
        rawText: "  謝謝收看請訂閱我的頻道感謝大家  ",
        recordingDurationMs: 500,
        peakEnergyLevel: 0.5,
        ...NORMAL_DEFAULTS,
      });

      expect(result.isHallucination).toBe(true);
      expect(result.detectedText).toBe("謝謝收看請訂閱我的頻道感謝大家");
    });
  });

  describe("Layer 2: 無人聲偵測", () => {
    describe("2a: 靜音（peak energy）", () => {
      it("[P0] peakEnergyLevel 低於門檻 → 幻覺", () => {
        const result = detectHallucination({
          rawText: "謝謝收看",
          recordingDurationMs: 2000,
          peakEnergyLevel: 0.001,
          ...NORMAL_DEFAULTS,
        });

        expect(result.isHallucination).toBe(true);
        expect(result.reason).toBe("no-speech-detected");
      });

      it("[P0] peakEnergyLevel 恰好等於門檻 → 放行", () => {
        const result = detectHallucination({
          rawText: "謝謝收看",
          recordingDurationMs: 2000,
          peakEnergyLevel: SILENCE_PEAK_ENERGY_THRESHOLD,
          ...NORMAL_DEFAULTS,
        });

        expect(result.isHallucination).toBe(false);
      });

      it("[P0] peakEnergyLevel = 0.0（完全靜音）→ 攔截", () => {
        const result = detectHallucination({
          rawText: "字幕由Amara社區提供",
          recordingDurationMs: 5000,
          peakEnergyLevel: 0.0,
          ...NORMAL_DEFAULTS,
        });

        expect(result.isHallucination).toBe(true);
        expect(result.reason).toBe("no-speech-detected");
      });
    });

    describe("2b: 低 RMS + 高 NSP 聯合判斷", () => {
      it("[P0] 低 RMS + 低 NSP → 放行（小聲說話不應被誤判）", () => {
        const result = detectHallucination({
          rawText: "MING PAO CANADA // MING PAO TORONTO",
          recordingDurationMs: 1388,
          peakEnergyLevel: 0.031,
          rmsEnergyLevel: 0.0066,
          noSpeechProbability: 0.0,
        });

        // RMS 很低但 NSP 也低（Whisper 認為有人說話）→ 放行
        expect(result.isHallucination).toBe(false);
      });

      it("[P0] peak < 0.03 且 rms < 0.015 且 NSP > 0.7 → 幻覺", () => {
        const result = detectHallucination({
          rawText: "MING PAO CANADA // MING PAO TORONTO",
          recordingDurationMs: 3729,
          peakEnergyLevel: 0.025,
          rmsEnergyLevel: 0.012,
          noSpeechProbability: 0.85,
        });

        expect(result.isHallucination).toBe(true);
        expect(result.reason).toBe("no-speech-detected");
      });

      it("[P0] rms < 0.015 但 NSP <= 0.7 → 放行", () => {
        const result = detectHallucination({
          rawText: "一些文字",
          recordingDurationMs: 2000,
          peakEnergyLevel: 0.15,
          rmsEnergyLevel: 0.012,
          noSpeechProbability: 0.3,
        });

        expect(result.isHallucination).toBe(false);
      });

      it("[P0] rms >= 0.015 但 NSP > 0.7 → 放行（有持續聲音）", () => {
        const result = detectHallucination({
          rawText: "一些文字",
          recordingDurationMs: 2000,
          peakEnergyLevel: 0.15,
          rmsEnergyLevel: 0.05,
          noSpeechProbability: 0.85,
        });

        expect(result.isHallucination).toBe(false);
      });

      it("[P0] rms 恰好等於門檻 → 放行", () => {
        const result = detectHallucination({
          rawText: "一些文字",
          recordingDurationMs: 2000,
          peakEnergyLevel: 0.025,
          rmsEnergyLevel: SILENCE_RMS_THRESHOLD,
          noSpeechProbability: 0.85,
        });

        expect(result.isHallucination).toBe(false);
      });

      it("[P0] NSP 恰好等於門檻 → 放行", () => {
        const result = detectHallucination({
          rawText: "一些文字",
          recordingDurationMs: 2000,
          peakEnergyLevel: 0.025,
          rmsEnergyLevel: 0.012,
          noSpeechProbability: SILENCE_NSP_THRESHOLD,
        });

        expect(result.isHallucination).toBe(false);
      });
    });

    describe("2b: peak energy escape hatch", () => {
      it("[P0] peak >= 0.03 + 低 RMS + 高 NSP → 放行（使用者真實案例）", () => {
        const result = detectHallucination({
          rawText: "我覺得這個方案基本上還不錯",
          recordingDurationMs: 5019,
          peakEnergyLevel: 0.0347,
          rmsEnergyLevel: 0.006,
          noSpeechProbability: 0.89,
        });

        expect(result.isHallucination).toBe(false);
      });

      it("[P0] peak 恰好等於 ceiling (0.03) → 放行", () => {
        const result = detectHallucination({
          rawText: "一些文字",
          recordingDurationMs: 2000,
          peakEnergyLevel: LAYER2B_PEAK_ENERGY_CEILING,
          rmsEnergyLevel: 0.01,
          noSpeechProbability: 0.85,
        });

        expect(result.isHallucination).toBe(false);
      });

      it("[P0] peak 略低於 ceiling (0.029) → 攔截（仍在 gap zone）", () => {
        const result = detectHallucination({
          rawText: "一些文字",
          recordingDurationMs: 2000,
          peakEnergyLevel: 0.029,
          rmsEnergyLevel: 0.01,
          noSpeechProbability: 0.85,
        });

        expect(result.isHallucination).toBe(true);
        expect(result.reason).toBe("no-speech-detected");
      });

      it("[P1] peak 高 (0.15) + 低 RMS + 高 NSP → 放行", () => {
        const result = detectHallucination({
          rawText: "一些文字",
          recordingDurationMs: 2000,
          peakEnergyLevel: 0.15,
          rmsEnergyLevel: 0.012,
          noSpeechProbability: 0.85,
        });

        expect(result.isHallucination).toBe(false);
      });
    });

    it("[P0] 實際案例：peak=0.031, rms=0.0066, NSP=0.000 → 放行（NSP 低代表 Whisper 認為有語音）", () => {
      const result = detectHallucination({
        rawText: "MING PAO CANADA // MING PAO TORONTO",
        recordingDurationMs: 1388,
        peakEnergyLevel: 0.031,
        rmsEnergyLevel: 0.0066,
        noSpeechProbability: 0.0,
      });

      // RMS 低但 NSP 也低 → 不符合聯合判斷條件 → 放行
      expect(result.isHallucination).toBe(false);
    });

    it("[P0] 實際案例：peak=0.031, rms=0.0066, NSP=0.900 → 放行（peak >= 0.03 escape hatch）", () => {
      const result = detectHallucination({
        rawText: "MING PAO CANADA // MING PAO TORONTO",
        recordingDurationMs: 1388,
        peakEnergyLevel: 0.031,
        rmsEnergyLevel: 0.0066,
        noSpeechProbability: 0.9,
      });

      // peak >= 0.03 → escape hatch 跳過 RMS+NSP 檢查 → 放行
      expect(result.isHallucination).toBe(false);
    });
  });

  describe("正常放行", () => {
    it("[P0] 有能量的正常語音 → 放行", () => {
      const result = detectHallucination({
        rawText: "這是一段正常的語音轉錄文字",
        recordingDurationMs: 3000,
        peakEnergyLevel: 0.3,
        ...NORMAL_DEFAULTS,
      });

      expect(result.isHallucination).toBe(false);
      expect(result.reason).toBeNull();
    });

    it("[P0] 有能量 + 曾被誤判的正常文字 → 放行（不再有字典比對）", () => {
      const result = detectHallucination({
        rawText: "謝謝收看",
        recordingDurationMs: 1500,
        peakEnergyLevel: 0.15,
        ...NORMAL_DEFAULTS,
      });

      expect(result.isHallucination).toBe(false);
    });
  });

  describe("增強後語意偏移偵測 (detectEnhancementAnomaly)", () => {
    it("[P0] 常數應為 2", () => {
      expect(ENHANCEMENT_LENGTH_EXPLOSION_RATIO).toBe(2);
    });

    it("[P0] 正常增強（長度相近）→ 放行", () => {
      const result = detectEnhancementAnomaly({
        rawText: "我覺得這個方案不錯",
        enhancedText: "我覺得這個方案不錯",
      });
      expect(result.isAnomaly).toBe(false);
      expect(result.reason).toBeNull();
    });

    it("[P0] 長度爆炸（超過 2 倍）→ 攔截", () => {
      const rawText = "怎樣才能更有效率";
      const enhancedText =
        "要更有效率地工作，可以：1. 制定清晰目標 2. 優先處理重要事項 3. 減少不必要的會議 4. 使用生產力工具 5. 定期回顧和調整 6. 保持適當的休息 7. 學習委派任務";
      const result = detectEnhancementAnomaly({ rawText, enhancedText });
      expect(result.isAnomaly).toBe(true);
      expect(result.reason).toBe("length-explosion");
    });

    it("[P0] 恰好 2 倍 → 攔截（>= 觸發）", () => {
      const rawText = "abc";
      const enhancedText = "abcabc"; // 恰好 2 倍
      const result = detectEnhancementAnomaly({ rawText, enhancedText });
      expect(result.isAnomaly).toBe(true);
    });

    it("[P0] 低於 2 倍一個字 → 放行", () => {
      const rawText = "abc";
      const enhancedText = "abcab"; // 5 < 6
      const result = detectEnhancementAnomaly({ rawText, enhancedText });
      expect(result.isAnomaly).toBe(false);
    });

    it("[P1] rawText 為空 → 放行（避免除以零）", () => {
      const result = detectEnhancementAnomaly({
        rawText: "",
        enhancedText: "some text",
      });
      expect(result.isAnomaly).toBe(false);
    });

    it("[P1] rawText 只有空白 → 放行", () => {
      const result = detectEnhancementAnomaly({
        rawText: "   ",
        enhancedText: "some text",
      });
      expect(result.isAnomaly).toBe(false);
    });

    it("[P1] enhancedText 為空 → 放行", () => {
      const result = detectEnhancementAnomaly({
        rawText: "一些文字",
        enhancedText: "",
      });
      expect(result.isAnomaly).toBe(false);
    });

    it("[P1] 前後空白應 trim 後計算", () => {
      const rawText = "  abc  ";
      const enhancedText = "  abcabcabcd  "; // trim 後 10 > 3*3=9
      const result = detectEnhancementAnomaly({ rawText, enhancedText });
      expect(result.isAnomaly).toBe(true);
    });
  });

  describe("Layer 優先級", () => {
    it("[P0] Layer 1 優先於 Layer 2（即使靜音，語速異常優先）", () => {
      const result = detectHallucination({
        rawText: "謝謝收看請訂閱我的頻道感謝大家",
        recordingDurationMs: 500,
        peakEnergyLevel: 0.001,
        ...NORMAL_DEFAULTS,
      });

      expect(result.reason).toBe("speed-anomaly");
    });

    it("[P0] Layer 2 peak 優先於 Layer 2 rms（都在同一個 if 中）", () => {
      const result = detectHallucination({
        rawText: "謝謝收看",
        recordingDurationMs: 2000,
        peakEnergyLevel: 0.001,
        rmsEnergyLevel: 0.001,
        noSpeechProbability: 0.9,
      });

      // 都返回 "no-speech-detected"，不需要區分子原因
      expect(result.reason).toBe("no-speech-detected");
    });
  });

  describe("detectSemanticDrift（#43 語意守衛）", () => {
    it("[P0] 正常校對（同內容加標點）不應判定 drift", () => {
      const r = detectSemanticDrift(
        "我明天要去公司開會然後下午回家",
        "我明天要去公司開會，然後下午回家。",
      );
      expect(r.isDrift).toBe(false);
      expect(r.overlapRatio).toBeGreaterThan(0.8);
    });

    it("[P0] 去口語贅字的校對不應判定 drift", () => {
      const r = detectSemanticDrift(
        "呃我想說我們明天要不要約個時間開會討論一下",
        "我想我們明天要約時間開會討論一下",
      );
      expect(r.isDrift).toBe(false);
    });

    it("[P0] 答非所問／內容不相干應判定 drift", () => {
      const r = detectSemanticDrift(
        "今天天氣真好想出去走走曬曬太陽",
        "好的請問有什麼可以幫您的嗎",
      );
      expect(r.isDrift).toBe(true);
      expect(r.overlapRatio).toBeLessThan(SEMANTIC_DRIFT_MIN_OVERLAP);
    });

    it("[P0] 極短原文（< 6 字）豁免、不判定 drift", () => {
      const r = detectSemanticDrift("現在幾點", "現在是下午三點整");
      expect(r.isDrift).toBe(false);
    });

    it("[P1] enhanced 為空不判定 drift", () => {
      expect(detectSemanticDrift("我要去開會討論專案進度", "").isDrift).toBe(
        false,
      );
    });
  });
});
