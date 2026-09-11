import { describe, expect, it } from "vitest";
import {
  DECOMMISSIONED_MODEL_MAP,
  DEFAULT_LLM_MODEL_ID,
  findLlmModelConfig,
  getEffectiveLlmModelId,
  LLM_MODEL_LIST,
} from "../../src/lib/modelRegistry";

describe("modelRegistry — 免費專案可用性標示（gh-71）", () => {
  // 逐模型斷言：全部標 full 也不會意外變綠
  const expected: Record<string, "full" | "limited" | "none"> = {
    "qwen/qwen3.6-27b": "full",
    "openai/gpt-oss-120b": "full",
    "openai/gpt-oss-20b": "full",
    "gemini-3.5-flash": "limited",
    "gemini-3.1-flash-lite": "full",
    "gpt-5.6-luna": "none",
    "gpt-5.4-nano": "none",
    "claude-haiku-4-5-20251001": "none",
  };

  it("[P1] 每個模型的 freeTier 都符合查證後的分類", () => {
    expect(LLM_MODEL_LIST.map((m) => m.id).sort()).toEqual(
      Object.keys(expected).sort(),
    );
    for (const model of LLM_MODEL_LIST) {
      expect(model.freeTier, model.id).toBe(expected[model.id]);
    }
  });

  it("[P1] 標 none 的模型 freeQuotaRpd 必為 0；Groq 全部 full", () => {
    for (const model of LLM_MODEL_LIST) {
      if (model.freeTier === "none") expect(model.freeQuotaRpd, model.id).toBe(0);
      if (model.providerId === "groq") expect(model.freeTier, model.id).toBe("full");
    }
  });
});

describe("modelRegistry — 下架遷移", () => {
  it("[P0] 現存 registry id 應原樣通過", () => {
    for (const model of LLM_MODEL_LIST) {
      expect(getEffectiveLlmModelId(model.id)).toBe(model.id);
    }
  });

  it("[P0] 遷移表每個舊 id 都必須解析到「存活於 registry」的模型", () => {
    // 防迴歸不變量：歷史上曾因單跳查找 + 舊 entry 指向「後來也下架」的模型，
    // 讓老使用者拿到 registry 查不到的死值（下游交叉驗證對 undefined 短路救不回）
    for (const oldId of Object.keys(DECOMMISSIONED_MODEL_MAP)) {
      const resolved = getEffectiveLlmModelId(oldId);
      expect(findLlmModelConfig(resolved), `${oldId} → ${resolved}`).toBeDefined();
    }
  });

  it("[P0] 遷移應保持同 provider（避免觸發 provider 交叉驗證重設）", () => {
    const legacyProvider: Record<string, string> = {
      "llama-3.3-70b-versatile": "groq",
      "qwen/qwen3-32b": "groq",
      "gemini-2.5-flash": "gemini",
      "gemini-2.5-flash-lite": "gemini",
      "gpt-5.4-mini": "openai",
      "claude-3-5-haiku-20241022": "anthropic",
    };
    for (const [oldId, provider] of Object.entries(legacyProvider)) {
      const resolved = getEffectiveLlmModelId(oldId);
      expect(findLlmModelConfig(resolved)?.providerId, oldId).toBe(provider);
    }
  });

  it("[P1] 連鎖 entry（舊 id 指向另一個舊 id）應迴圈解析到終點", () => {
    // "gpt-oss-120b"（無前綴短版）→ "openai/gpt-oss-120b"（registry 存活）
    expect(getEffectiveLlmModelId("gpt-oss-120b")).toBe("openai/gpt-oss-120b");
  });

  it("[P1] null 與未知 id 應 fallback 到預設", () => {
    expect(getEffectiveLlmModelId(null)).toBe(DEFAULT_LLM_MODEL_ID);
    expect(getEffectiveLlmModelId("no-such-model")).toBe(DEFAULT_LLM_MODEL_ID);
  });
});
