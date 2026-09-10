/// <reference types="vite/client" />
import * as Sentry from "@sentry/vue";
import type { App } from "vue";
import type { Router } from "vue-router";

declare const __APP_VERSION__: string;

function getSentryDsn(): string {
  return import.meta.env.VITE_SENTRY_DSN?.trim() ?? "";
}

function getSentryEnvironment(): string {
  return import.meta.env.VITE_SENTRY_ENVIRONMENT?.trim() || import.meta.env.MODE;
}

function getSentryRelease(): string {
  return import.meta.env.VITE_SENTRY_RELEASE?.trim() || `sayit@${__APP_VERSION__}`;
}

function getTracesSampleRate(): number {
  const rawValue = import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE?.trim();
  if (!rawValue) return 0;

  const rate = Number(rawValue);
  return Number.isFinite(rate) && rate > 0 ? rate : 0;
}

// `integrations: []` 不會關掉 SDK 預設整合，console breadcrumb 仍會收集、可能夾帶逐字稿；
// 這裡把 console 類 breadcrumb 丟掉。不用 defaultIntegrations:false，那會連未捕捉錯誤的攔截一起關。
export function dropConsoleBreadcrumb(
  breadcrumb: Sentry.Breadcrumb,
): Sentry.Breadcrumb | null {
  return breadcrumb.category === "console" ? null : breadcrumb;
}

function isSentryEnabled(): boolean {
  return import.meta.env.PROD && Boolean(getSentryDsn());
}

export function initSentryForHud(app: App): void {
  if (!isSentryEnabled()) return;

  Sentry.init({
    app,
    dsn: getSentryDsn(),
    environment: getSentryEnvironment(),
    release: getSentryRelease(),
    sendDefaultPii: false,
    integrations: [],
    beforeBreadcrumb: dropConsoleBreadcrumb,
    initialScope: {
      tags: { window: "hud" },
    },
  });
}

export function initSentryForDashboard(app: App, router: Router): void {
  if (!isSentryEnabled()) return;

  const tracesSampleRate = getTracesSampleRate();

  Sentry.init({
    app,
    dsn: getSentryDsn(),
    environment: getSentryEnvironment(),
    release: getSentryRelease(),
    sendDefaultPii: false,
    integrations:
      tracesSampleRate > 0 ? [Sentry.browserTracingIntegration({ router })] : [],
    ...(tracesSampleRate > 0 ? { tracesSampleRate } : {}),
    beforeBreadcrumb: dropConsoleBreadcrumb,
    initialScope: {
      tags: { window: "dashboard" },
    },
  });
}

export function captureError(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (!isSentryEnabled()) return;

  if (context) {
    Sentry.withScope((scope) => {
      scope.setExtras(context);
      Sentry.captureException(error);
    });
    return;
  }

  Sentry.captureException(error);
}
