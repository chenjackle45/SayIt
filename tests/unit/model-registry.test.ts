import { describe, expect, it } from "vitest";
import {
  DECOMMISSIONED_MODEL_MAP,
  DEFAULT_LLM_MODEL_ID,
  findLlmModelConfig,
  getEffectiveLlmModelId,
  LLM_MODEL_LIST,
} from "../../src/lib/modelRegistry";

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
