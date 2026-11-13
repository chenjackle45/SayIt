import { describe, expect, it } from "vitest";
import {
  DECOMMISSIONED_MODEL_MAP,
  DEFAULT_LLM_MODEL_ID,
  findLlmModelConfig,
  getDefaultModelIdForProvider,
  getEffectiveLlmModelId,
  LLM_MODEL_LIST,
} from "../../src/lib/modelRegistry";

describe("modelRegistry — 各 provider 預設模型（2026-11 拍板）", () => {
  it("[P0] 切換 provider 時選到的預設模型符合拍板", () => {
    expect(DEFAULT_LLM_MODEL_ID).toBe("qwen/qwen3.8-27b");
    const expected = {
      groq: "qwen/qwen3.8-27b",
      gemini: "gemini-3.5-flash-lite",
      openai: "gpt-6-luna",
      anthropic: "claude-haiku-5-5",
    } as const;
    for (const [provider, modelId] of Object.entries(expected)) {
      expect(getDefaultModelIdForProvider(provider as keyof typeof expected), provider).toBe(modelId);
      const defaults = LLM_MODEL_LIST.filter((m) => m.providerId === provider && m.isDefault);
      expect(defaults, `${provider} 恰好一個預設`).toHaveLength(1);
    }
  });
});

describe("modelRegistry — 免費專案可用性標示（gh-71）", () => {
  // 逐模型斷言：全部標 full 也不會意外變綠
  const expected: Record<string, "full" | "limited" | "none"> = {
    "qwen/qwen3.8-27b": "full",
    "openai/gpt-oss-120b": "full",
    "openai/gpt-oss-20b": "full",
    "gemini-3.5-flash-lite": "full",
    "gemini-3.6-flash": "limited",
    "gpt-6-luna": "none",
    "gpt-5.6-luna": "none",
    "claude-haiku-5-5": "none",
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
      "gpt-5.4-nano": "openai",
      "qwen/qwen3.6-27b": "groq",
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
    // 歷史條目指向 qwen3.6、qwen3.6 再指向 qwen3.8（兩跳）
    expect(getEffectiveLlmModelId("llama-3.3-70b-versatile")).toBe("qwen/qwen3.8-27b");
  });

  it("[P0] 2026-11 下架：qwen3.6 → qwen3.8、gpt-5.4-nano → gpt-6-luna", () => {
    // 直接斷言映射：qwen3.8 恰為全域預設，只看解析結果會被 fallback 假陽性掩蓋
    expect(DECOMMISSIONED_MODEL_MAP["qwen/qwen3.6-27b"]).toBe("qwen/qwen3.8-27b");
    expect(getEffectiveLlmModelId("qwen/qwen3.6-27b")).toBe("qwen/qwen3.8-27b");
    expect(getEffectiveLlmModelId("gpt-5.4-nano")).toBe("gpt-6-luna");
    // Gemini：3.5-flash → 3.6-flash（官方已自動轉址）、3.1-flash-lite → 3.5-flash-lite
    expect(getEffectiveLlmModelId("gemini-3.5-flash")).toBe("gemini-3.6-flash");
    expect(getEffectiveLlmModelId("gemini-3.1-flash-lite")).toBe("gemini-3.5-flash-lite");
    // 2.5 世代經兩跳落到新 id
    expect(getEffectiveLlmModelId("gemini-2.5-flash")).toBe("gemini-3.6-flash");
    expect(getEffectiveLlmModelId("gemini-2.5-flash-lite")).toBe("gemini-3.5-flash-lite");
  });

  it("[P1] null 與未知 id 應 fallback 到預設", () => {
    expect(getEffectiveLlmModelId(null)).toBe(DEFAULT_LLM_MODEL_ID);
    expect(getEffectiveLlmModelId("no-such-model")).toBe(DEFAULT_LLM_MODEL_ID);
  });
});
