import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const initMock = vi.fn();
vi.mock("@sentry/vue", () => ({
  init: (...args: unknown[]) => initMock(...args),
  browserTracingIntegration: vi.fn(() => ({})),
  withScope: vi.fn(),
  captureException: vi.fn(),
}));

import {
  dropConsoleBreadcrumb,
  initSentryForDashboard,
  initSentryForHud,
} from "../../src/lib/sentry";

describe("dropConsoleBreadcrumb", () => {
  it("console 類 breadcrumb 一律丟棄（可能夾帶逐字稿）", () => {
    expect(
      dropConsoleBreadcrumb({ category: "console", message: "transcript: 你好" }),
    ).toBeNull();
  });

  it("其他類別原樣保留", () => {
    const crumb = { category: "navigation", data: { from: "/", to: "/history" } };
    expect(dropConsoleBreadcrumb(crumb)).toBe(crumb);
  });
});

describe("Sentry init 接線", () => {
  beforeEach(() => {
    initMock.mockClear();
    vi.stubEnv("PROD", true);
    vi.stubEnv("VITE_SENTRY_RELEASE", "sayit@test");
    vi.stubEnv("VITE_SENTRY_DSN", "https://key@example.ingest.sentry.io/1");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("HUD 與 Dashboard 兩個入口都掛上 console breadcrumb 過濾", () => {
    const app = {} as never;
    initSentryForHud(app);
    initSentryForDashboard(app, {} as never);

    expect(initMock).toHaveBeenCalledTimes(2);
    for (const call of initMock.mock.calls) {
      expect((call[0] as { beforeBreadcrumb: unknown }).beforeBreadcrumb).toBe(
        dropConsoleBreadcrumb,
      );
    }
  });
});
