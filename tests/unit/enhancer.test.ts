import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn();
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: mockFetch,
}));

const TEST_API_KEY = "test-api-key-123";

function createSuccessResponse(
  content: string,
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_time: number;
    completion_time: number;
    total_time: number;
  },
) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({
      choices: [{ message: { content } }],
      usage,
    }),
  };
}

describe("enhancer.ts", () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("正常流程", () => {
    it("[P0] 應回傳 AI 整理後的文字", async () => {
      mockFetch.mockResolvedValue(
        createSuccessResponse("這是整理後的書面語文字。"),
      );

      const { enhanceText } = await import("../../src/lib/enhancer");
      const result = await enhanceText(
        "嗯那個就是我想說的就是這個東西很好用",
        TEST_API_KEY,
      );

      expect(result.text).toBe("這是整理後的書面語文字。");
      expect(result.usage).toBeNull();
    });

    it("[P0] 有 usage 時應回傳解析後的 ChatUsageData", async () => {
      mockFetch.mockResolvedValue(
        createSuccessResponse("整理後文字", {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          prompt_time: 0.2,
          completion_time: 0.3,
          total_time: 0.5,
        }),
      );

      const { enhanceText } = await import("../../src/lib/enhancer");
      const result = await enhanceText("測試輸入文字測試", TEST_API_KEY);

      expect(result.text).toBe("整理後文字");
      expect(result.usage).toEqual({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        promptTimeMs: 200,
        completionTimeMs: 300,
        totalTimeMs: 500,
      });
    });

    it("[P0] 應傳送正確的請求 body 格式", async () => {
      mockFetch.mockResolvedValue(createSuccessResponse("整理後文字"));

      const { enhanceText } = await import("../../src/lib/enhancer");
      await enhanceText("測試輸入文字", TEST_API_KEY);

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe(
        "https://api.groq.com/openai/v1/chat/completions",
      );
      expect(callArgs[1].method).toBe("POST");
      expect(callArgs[1].headers["Content-Type"]).toBe("application/json");
      expect(callArgs[1].headers.Authorization).toBe(`Bearer ${TEST_API_KEY}`);

      const body = JSON.parse(callArgs[1].body);
      expect(body.model).toBe("qwen/qwen3-32b");
      expect(body.temperature).toBe(0.3);
      expect(body.max_tokens).toBe(2048);
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[1].role).toBe("user");
      expect(body.messages[1].content).toBe("測試輸入文字");
    });

    it("[P0] 應 trim 回傳的文字", async () => {
      mockFetch.mockResolvedValue(
        createSuccessResponse("  整理後文字有空白  \n"),
      );

      const { enhanceText } = await import("../../src/lib/enhancer");
      const result = await enhanceText(
        "原始文字原始文字原始文字",
        TEST_API_KEY,
      );

      expect(result.text).toBe("整理後文字有空白");
    });
  });

  describe("API Key 驗證", () => {
    it("[P0] 空 API Key 應拋出錯誤", async () => {
      const { enhanceText } = await import("../../src/lib/enhancer");
      await expect(enhanceText("測試文字", "")).rejects.toThrow(
        "API Key 未設定",
      );
    });

    it("[P0] 純空白 API Key 應拋出錯誤", async () => {
      const { enhanceText } = await import("../../src/lib/enhancer");
      await expect(enhanceText("測試文字", "   ")).rejects.toThrow(
        "API Key 未設定",
      );
    });
  });

  describe("空 choices 回應", () => {
    it("[P0] choices 陣列為空時應回傳原始文字", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ choices: [] }),
      });

      const { enhanceText } = await import("../../src/lib/enhancer");
      const result = await enhanceText("原始口語文字測試", TEST_API_KEY);

      expect(result.text).toBe("原始口語文字測試");
    });

    it("[P0] message content 為空字串時應回傳原始文字", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          choices: [{ message: { content: "" } }],
        }),
      });

      const { enhanceText } = await import("../../src/lib/enhancer");
      const result = await enhanceText("原始口語文字測試", TEST_API_KEY);

      expect(result.text).toBe("原始口語文字測試");
    });
  });

  describe("HTTP 錯誤處理", () => {
    it("[P0] HTTP 非 200 應拋出包含狀態碼的錯誤", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
      });

      const { enhanceText } = await import("../../src/lib/enhancer");
      await expect(
        enhanceText("測試文字測試文字測試", TEST_API_KEY),
      ).rejects.toThrow("AI 整理失敗：401");
    });

    it("[P0] HTTP 500 應拋出包含狀態碼的錯誤", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const { enhanceText } = await import("../../src/lib/enhancer");
      await expect(
        enhanceText("測試文字測試文字測試", TEST_API_KEY),
      ).rejects.toThrow("AI 整理失敗：500");
    });

    it("[P0] 網路錯誤應自然拋出", async () => {
      mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));

      const { enhanceText } = await import("../../src/lib/enhancer");
      await expect(
        enhanceText("測試文字測試文字測試", TEST_API_KEY),
      ).rejects.toThrow("Failed to fetch");
    });
  });

  describe("自訂 prompt 與上下文注入 (Story 2.2)", () => {
    it("[P0] 傳入自訂 systemPrompt 應使用自訂 prompt", async () => {
      mockFetch.mockResolvedValue(createSuccessResponse("整理後文字"));

      const { enhanceText } = await import("../../src/lib/enhancer");
      await enhanceText("測試輸入文字", TEST_API_KEY, {
        systemPrompt: "你是一個英文助手",
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.messages[0].content).toBe("你是一個英文助手");
    });

    it("[P0] 不傳 options 應使用 DEFAULT_SYSTEM_PROMPT", async () => {
      mockFetch.mockResolvedValue(createSuccessResponse("整理後文字"));

      const { enhanceText, DEFAULT_SYSTEM_PROMPT } = await import(
        "../../src/lib/enhancer"
      );
      await enhanceText("測試輸入文字", TEST_API_KEY);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.messages[0].content).toBe(DEFAULT_SYSTEM_PROMPT);
    });

    it("[P0] vocabularyTermList 應注入 <vocabulary> 標籤", async () => {
      mockFetch.mockResolvedValue(createSuccessResponse("整理後文字"));

      const { enhanceText } = await import("../../src/lib/enhancer");
      await enhanceText("測試輸入文字", TEST_API_KEY, {
        vocabularyTermList: ["TypeScript", "Vue.js", "Tauri"],
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.messages[0].content).toContain(
        "<vocabulary>\nTypeScript, Vue.js, Tauri\n</vocabulary>",
      );
    });

    it("[P0] 空 vocabularyTermList 不應注入 <vocabulary> 標籤", async () => {
      mockFetch.mockResolvedValue(createSuccessResponse("整理後文字"));

      const { enhanceText } = await import("../../src/lib/enhancer");
      await enhanceText("測試輸入文字", TEST_API_KEY, {
        vocabularyTermList: [],
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.messages[0].content).not.toContain("<vocabulary>");
    });
  });

  describe("buildSystemPrompt (Story 2.2)", () => {
    it("[P0] 應正確組裝 vocabulary", async () => {
      const { buildSystemPrompt } = await import("../../src/lib/enhancer");
      const result = buildSystemPrompt("基礎 prompt", ["詞彙A", "詞彙B"]);

      expect(result).toBe(
        "基礎 prompt\n\n<vocabulary>\n詞彙A, 詞彙B\n</vocabulary>",
      );
    });

    it("[P0] vocabulary 為空時只回傳基礎 prompt", async () => {
      const { buildSystemPrompt } = await import("../../src/lib/enhancer");
      const result = buildSystemPrompt("基礎 prompt", []);

      expect(result).toBe("基礎 prompt");
    });

    it("[P0] 有 vocabulary 時應包含 vocabulary 標籤", async () => {
      const { buildSystemPrompt } = await import("../../src/lib/enhancer");
      const result = buildSystemPrompt("基礎 prompt", ["詞彙"]);

      expect(result).toContain("<vocabulary>");
    });

    it("[P0] 無 vocabulary 時不應有 vocabulary 標籤", async () => {
      const { buildSystemPrompt } = await import("../../src/lib/enhancer");
      const result = buildSystemPrompt("基礎 prompt");

      expect(result).not.toContain("<vocabulary>");
    });
  });

  describe("大量詞彙截取 (Story 3.2)", () => {
    it("[P0] buildSystemPrompt 應截取最多 100 個詞彙", async () => {
      const { buildSystemPrompt } = await import("../../src/lib/enhancer");
      const largeTermList = Array.from(
        { length: 120 },
        (_, i) => `Term${i + 1}`,
      );

      const result = buildSystemPrompt("基礎 prompt", largeTermList);

      expect(result).toContain("Term1");
      expect(result).toContain("Term100");
      expect(result).not.toContain("Term101");
    });

    it("[P0] 恰好 100 個詞彙應全部包含", async () => {
      const { buildSystemPrompt } = await import("../../src/lib/enhancer");
      const exactTermList = Array.from(
        { length: 100 },
        (_, i) => `Term${i + 1}`,
      );

      const result = buildSystemPrompt("基礎 prompt", exactTermList);

      expect(result).toContain("Term1");
      expect(result).toContain("Term100");
    });
  });

  describe("stripReasoningTags", () => {
    it("[P0] 應移除 <think> 標籤及其內容", async () => {
      const { stripReasoningTags } = await import("../../src/lib/enhancer");
      const input = "<think>\n這是思考過程\n</think>\n整理後的文字";
      expect(stripReasoningTags(input)).toBe("整理後的文字");
    });

    it("[P0] 無 <think> 標籤時應原樣回傳", async () => {
      const { stripReasoningTags } = await import("../../src/lib/enhancer");
      expect(stripReasoningTags("純文字內容")).toBe("純文字內容");
    });

    it("[P1] 應處理多個 <think> 區塊", async () => {
      const { stripReasoningTags } = await import("../../src/lib/enhancer");
      const input = "<think>思考1</think>結果1<think>思考2</think>結果2";
      expect(stripReasoningTags(input)).toBe("結果1結果2");
    });

    it("[P0] reasoning model 回應應只保留最終輸出", async () => {
      mockFetch.mockResolvedValueOnce(
        createSuccessResponse(
          "<think>\n分析語意...\n確認修正方向\n</think>\n這是整理後的書面文字",
        ),
      );
      const { enhanceText } = await import("../../src/lib/enhancer");
      const result = await enhanceText("口語轉錄", TEST_API_KEY);
      expect(result.text).toBe("這是整理後的書面文字");
    });
  });

  describe("Timeout 處理", () => {
    it("[P0] 超過 5 秒應拋出逾時錯誤", async () => {
      vi.useFakeTimers();

      mockFetch.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(createSuccessResponse("晚了")), 6000);
          }),
      );

      const { enhanceText } = await import("../../src/lib/enhancer");
      const promise = enhanceText("測試文字測試文字測試", TEST_API_KEY);

      vi.advanceTimersByTime(5000);

      await expect(promise).rejects.toThrow("AI 整理逾時");

      vi.useRealTimers();
    });
  });
});
