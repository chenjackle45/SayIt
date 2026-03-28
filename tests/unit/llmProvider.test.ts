import { describe, it, expect } from "vitest";
import {
  buildFetchParams,
  parseProviderResponse,
  getProviderTimeout,
  findProviderConfig,
  getProviderIdForModel,
  type LlmChatRequest,
} from "../../src/lib/llmProvider";

const TEST_API_KEY = "test-api-key-123";

const BASE_REQUEST: LlmChatRequest = {
  model: "test-model",
  messages: [
    { role: "system", content: "You are a helper" },
    { role: "user", content: "Hello" },
  ],
  temperature: 0.1,
  maxTokens: 2048,
};

describe("llmProvider.ts", () => {
  // ==========================================================================
  // buildFetchParams
  // ==========================================================================

  describe("buildFetchParams", () => {
    it("[P0] Groq：正確 URL、Bearer auth、OpenAI-compatible body", () => {
      const { url, init } = buildFetchParams("groq", BASE_REQUEST, TEST_API_KEY);

      expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
      expect(init.method).toBe("POST");

      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${TEST_API_KEY}`);
      expect(headers["Content-Type"]).toBe("application/json");

      const body = JSON.parse(init.body as string);
      expect(body.model).toBe("test-model");
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].role).toBe("system");
      expect(body.temperature).toBe(0.1);
      expect(body.max_tokens).toBe(2048);
      expect(body.max_completion_tokens).toBeUndefined();
    });

    it("[P0] OpenAI：正確 URL、Bearer auth、max_completion_tokens", () => {
      const { url, init } = buildFetchParams("openai", BASE_REQUEST, TEST_API_KEY);

      expect(url).toBe("https://api.openai.com/v1/chat/completions");

      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${TEST_API_KEY}`);

      const body = JSON.parse(init.body as string);
      expect(body.model).toBe("test-model");
      expect(body.messages).toHaveLength(2);
      expect(body.max_completion_tokens).toBe(2048);
      expect(body.max_tokens).toBeUndefined();
    });

    it("[P0] Anthropic：正確 URL、x-api-key header、anthropic-version header", () => {
      const { url, init } = buildFetchParams("anthropic", BASE_REQUEST, TEST_API_KEY);

      expect(url).toBe("https://api.anthropic.com/v1/messages");

      const headers = init.headers as Record<string, string>;
      expect(headers["x-api-key"]).toBe(TEST_API_KEY);
      expect(headers["anthropic-version"]).toBe("2023-06-01");
      expect(headers.Authorization).toBeUndefined();
    });

    it("[P0] Anthropic：system message 提取到頂層", () => {
      const { init } = buildFetchParams("anthropic", BASE_REQUEST, TEST_API_KEY);
      const body = JSON.parse(init.body as string);

      expect(body.system).toBe("You are a helper");
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].role).toBe("user");
    });

    it("[P0] Anthropic：max_tokens 必填，未提供時預設 2048", () => {
      const requestWithoutMaxTokens: LlmChatRequest = {
        model: "test-model",
        messages: [{ role: "user", content: "Hello" }],
      };
      const { init } = buildFetchParams("anthropic", requestWithoutMaxTokens, TEST_API_KEY);
      const body = JSON.parse(init.body as string);

      expect(body.max_tokens).toBe(2048);
    });

    it("[P0] Gemini：URL 含 model、x-goog-api-key header、system_instruction 格式", () => {
      const { url, init } = buildFetchParams("gemini", BASE_REQUEST, TEST_API_KEY);

      expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent");
      expect(init.method).toBe("POST");

      const headers = init.headers as Record<string, string>;
      expect(headers["x-goog-api-key"]).toBe(TEST_API_KEY);
      expect(headers.Authorization).toBeUndefined();

      const body = JSON.parse(init.body as string);
      expect(body.system_instruction.parts[0].text).toBe("You are a helper");
      expect(body.contents).toHaveLength(1);
      expect(body.contents[0].role).toBe("user");
      expect(body.contents[0].parts[0].text).toBe("Hello");
      expect(body.generationConfig.temperature).toBe(0.1);
      expect(body.generationConfig.maxOutputTokens).toBe(2048);
      expect(body.model).toBeUndefined();
    });

    it("[P1] Gemini：無 system message 時不含 system_instruction", () => {
      const requestNoSystem: LlmChatRequest = {
        model: "test-model",
        messages: [{ role: "user", content: "Hello" }],
        temperature: 0.5,
      };
      const { init } = buildFetchParams("gemini", requestNoSystem, TEST_API_KEY);
      const body = JSON.parse(init.body as string);

      expect(body.system_instruction).toBeUndefined();
      expect(body.contents).toHaveLength(1);
    });

    it("[P1] Gemini：assistant role 轉換為 model", () => {
      const requestWithAssistant: LlmChatRequest = {
        model: "test-model",
        messages: [
          { role: "user", content: "Hi" },
          { role: "assistant", content: "Hello" },
          { role: "user", content: "Thanks" },
        ],
      };
      const { init } = buildFetchParams("gemini", requestWithAssistant, TEST_API_KEY);
      const body = JSON.parse(init.body as string);

      expect(body.contents[1].role).toBe("model");
    });

    it("[P1] Anthropic：無 system message 時不含 system 欄位", () => {
      const requestNoSystem: LlmChatRequest = {
        model: "test-model",
        messages: [{ role: "user", content: "Hello" }],
        temperature: 0,
        maxTokens: 1024,
      };
      const { init } = buildFetchParams("anthropic", requestNoSystem, TEST_API_KEY);
      const body = JSON.parse(init.body as string);

      expect(body.system).toBeUndefined();
      expect(body.messages).toHaveLength(1);
      expect(body.temperature).toBe(0);
    });
  });

  // ==========================================================================
  // parseProviderResponse
  // ==========================================================================

  describe("parseProviderResponse", () => {
    it("[P0] Groq：choices[0].message.content、usage 含時間", () => {
      const result = parseProviderResponse("groq", {
        choices: [{ message: { content: "Hello result" } }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
          prompt_time: 0.1,
          completion_time: 0.2,
          total_time: 0.3,
        },
      });

      expect(result.text).toBe("Hello result");
      expect(result.usage).toEqual({
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
        promptTimeMs: 100,
        completionTimeMs: 200,
        totalTimeMs: 300,
      });
    });

    it("[P0] OpenAI：choices[0].message.content、usage 不含時間", () => {
      const result = parseProviderResponse("openai", {
        choices: [{ message: { content: "  OpenAI result  " } }],
        usage: {
          prompt_tokens: 50,
          completion_tokens: 100,
          total_tokens: 150,
        },
      });

      expect(result.text).toBe("OpenAI result");
      expect(result.usage).toEqual({
        promptTokens: 50,
        completionTokens: 100,
        totalTokens: 150,
      });
      expect(result.usage?.promptTimeMs).toBeUndefined();
    });

    it("[P0] Anthropic：content[0].text、input_tokens/output_tokens", () => {
      const result = parseProviderResponse("anthropic", {
        content: [{ type: "text", text: "Anthropic result" }],
        usage: {
          input_tokens: 25,
          output_tokens: 75,
        },
      });

      expect(result.text).toBe("Anthropic result");
      expect(result.usage).toEqual({
        promptTokens: 25,
        completionTokens: 75,
        totalTokens: 100,
      });
    });

    it("[P0] Gemini：candidates[0].content.parts[0].text、usageMetadata", () => {
      const result = parseProviderResponse("gemini", {
        candidates: [{
          content: { parts: [{ text: "Gemini result" }] },
          finishReason: "STOP",
        }],
        usageMetadata: {
          promptTokenCount: 15,
          candidatesTokenCount: 30,
          totalTokenCount: 45,
        },
      });

      expect(result.text).toBe("Gemini result");
      expect(result.usage).toEqual({
        promptTokens: 15,
        completionTokens: 30,
        totalTokens: 45,
      });
    });

    it("[P1] Gemini：finishReason 為 SAFETY 時拋出錯誤", () => {
      expect(() =>
        parseProviderResponse("gemini", {
          candidates: [{
            content: { parts: [] },
            finishReason: "SAFETY",
          }],
        }),
      ).toThrow("Gemini blocked response (reason: SAFETY)");
    });

    it("[P1] Gemini：空 candidates 回傳空字串", () => {
      const result = parseProviderResponse("gemini", { candidates: [] });
      expect(result.text).toBe("");
      expect(result.usage).toBeNull();
    });

    it("[P1] 空 choices 回傳空字串", () => {
      const result = parseProviderResponse("groq", { choices: [] });
      expect(result.text).toBe("");
      expect(result.usage).toBeNull();
    });

    it("[P1] 空 Anthropic content 回傳空字串", () => {
      const result = parseProviderResponse("anthropic", { content: [] });
      expect(result.text).toBe("");
      expect(result.usage).toBeNull();
    });
  });

  // ==========================================================================
  // Helpers
  // ==========================================================================

  describe("helpers", () => {
    it("[P0] getProviderTimeout 回傳正確值", () => {
      expect(getProviderTimeout("groq")).toBe(5000);
      expect(getProviderTimeout("openai")).toBe(30000);
      expect(getProviderTimeout("anthropic")).toBe(30000);
      expect(getProviderTimeout("gemini")).toBe(30000);
    });

    it("[P0] findProviderConfig 回傳正確設定", () => {
      const groq = findProviderConfig("groq");
      expect(groq?.baseUrl).toContain("groq.com");

      const openai = findProviderConfig("openai");
      expect(openai?.baseUrl).toContain("openai.com");

      const anthropic = findProviderConfig("anthropic");
      expect(anthropic?.baseUrl).toContain("anthropic.com");

      const gemini = findProviderConfig("gemini");
      expect(gemini?.baseUrl).toContain("googleapis.com");
    });

    it("[P0] getProviderIdForModel 根據 modelId 回傳 providerId", () => {
      expect(getProviderIdForModel("llama-3.3-70b-versatile")).toBe("groq");
      expect(getProviderIdForModel("gpt-5.4-mini")).toBe("openai");
      expect(getProviderIdForModel("claude-haiku-4-5-20251001")).toBe("anthropic");
      expect(getProviderIdForModel("gemini-2.5-flash")).toBe("gemini");
    });

    it("[P1] getProviderIdForModel 未知模型 fallback 到 groq", () => {
      expect(getProviderIdForModel("unknown-model-xyz")).toBe("groq");
    });
  });
});
