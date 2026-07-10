import { describe, it, expect } from "vitest";
import {
  buildFetchParams,
  normalizeAzureEndpoint,
  parseProviderResponse,
  type LlmChatRequest,
  type AzureRequestOptions,
} from "../../src/lib/llmProvider";

const REQUEST: LlmChatRequest = {
  model: "my-gpt4o-deployment",
  messages: [
    { role: "system", content: "sys" },
    { role: "user", content: "hi" },
  ],
  temperature: 0.1,
  maxTokens: 1024,
};

describe("Azure provider", () => {
  describe("normalizeAzureEndpoint", () => {
    it("[P1] 去尾斜線", () => {
      expect(normalizeAzureEndpoint("https://r.openai.azure.com/")).toBe(
        "https://r.openai.azure.com",
      );
    });

    it("[P1] 去掉多餘的 /openai/v1/chat/completions", () => {
      expect(
        normalizeAzureEndpoint(
          "https://r.openai.azure.com/openai/v1/chat/completions",
        ),
      ).toBe("https://r.openai.azure.com");
    });

    it("[P1] 去掉 /openai 與 /openai/v1", () => {
      expect(normalizeAzureEndpoint("https://r.openai.azure.com/openai")).toBe(
        "https://r.openai.azure.com",
      );
      expect(
        normalizeAzureEndpoint("https://r.services.ai.azure.com/openai/v1"),
      ).toBe("https://r.services.ai.azure.com");
    });

    it("[P1] 去掉含 query string 的完整 URL", () => {
      expect(
        normalizeAzureEndpoint(
          "https://r.openai.azure.com/openai/deployments/x/chat/completions?api-version=2024-10-21",
        ),
      ).toBe("https://r.openai.azure.com");
    });
  });

  describe("buildFetchParams azure", () => {
    it("[P0] uses v1 URL, api-key header, deployment model, and max_completion_tokens", () => {
      const azure: AzureRequestOptions = {
        endpoint: "https://r.openai.azure.com",
        apiKey: "azkey",
      };
      const { url, init } = buildFetchParams("azure", REQUEST, "", azure);

      expect(url).toBe(
        "https://r.openai.azure.com/openai/v1/chat/completions",
      );
      const headers = init.headers as Record<string, string>;
      expect(headers["api-key"]).toBe("azkey");
      expect(headers.Authorization).toBeUndefined();

      const body = JSON.parse(init.body as string);
      expect(body.model).toBe("my-gpt4o-deployment");
      expect(body.max_completion_tokens).toBe(1024);
      expect(body.max_tokens).toBeUndefined();
    });

    it("[P1] apiVersion 帶入 query string", () => {
      const azure: AzureRequestOptions = {
        endpoint: "https://r.openai.azure.com",
        apiVersion: "preview",
        apiKey: "k",
      };
      const { url } = buildFetchParams("azure", REQUEST, "", azure);
      expect(url).toBe(
        "https://r.openai.azure.com/openai/v1/chat/completions?api-version=preview",
      );
    });

    it("[P1] 缺 azureOptions 時拋錯", () => {
      expect(() => buildFetchParams("azure", REQUEST, "")).toThrow();
    });

    it("[P1] 回應走 OpenAI-compatible 解析（無 groq 計時欄位）", () => {
      const result = parseProviderResponse("azure", {
        choices: [{ message: { content: "  hello  " } }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      });
      expect(result.text).toBe("hello");
      expect(result.usage?.totalTokens).toBe(5);
      expect(result.usage?.promptTimeMs).toBeUndefined();
    });
  });
});
