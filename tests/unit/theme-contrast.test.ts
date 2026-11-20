import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// 改版色票的文字對比把關：深淺兩套的每組「文字色／背景色」都要達 WCAG AA（小字 4.5:1）。
const css = readFileSync(resolve(__dirname, "../../src/style.css"), "utf-8");

function readThemeBlock(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const end = css.indexOf("}", start);
  const block = css.slice(start, end);
  const tokens: Record<string, string> = {};
  for (const match of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens[match[1]] = match[2];
  }
  return tokens;
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_ON_SURFACE_PAIRS: Array<[string, string]> = [
  ["foreground", "background"],
  ["card-foreground", "card"],
  ["popover-foreground", "popover"],
  ["muted-foreground", "background"],
  ["muted-foreground", "card"],
  ["muted-foreground", "muted"],
  ["link", "background"],
  ["link", "card"],
  ["success", "background"],
  ["success", "card"],
  ["destructive", "background"],
  ["destructive", "card"],
  ["warning", "background"],
  ["warning", "card"],
  ["primary-foreground", "primary"],
  ["accent-foreground", "accent"],
  ["sidebar-foreground", "sidebar"],
  ["sidebar-accent-foreground", "sidebar-accent"],
  ["sidebar-primary-foreground", "sidebar-primary"],
];

// 「文字疊在同色系半透明淡底」：畫面實際用到的組合（例如 AI 整理標籤 bg-success/15 text-success）。
// 只測純背景會漏掉疊色後對比下降（實作閘 R1 抓到淺色 4.1:1）。
const TINTED_PAIRS: Array<[text: string, tint: string, alpha: number]> = [
  ["success", "success", 0.15],
  ["destructive", "destructive", 0.15],
  ["link", "primary", 0.1],
  ["foreground", "primary", 0.1],
];

function blendOver(fg: string, alpha: number, bg: string): string {
  const mix = [1, 3, 5].map((i) => {
    const f = parseInt(fg.slice(i, i + 2), 16);
    const b = parseInt(bg.slice(i, i + 2), 16);
    return Math.round(f * alpha + b * (1 - alpha));
  });
  return `#${mix.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

describe.each([
  ["淺色", ":root"],
  ["深色", ".dark"],
])("%s主題文字對比", (_label, selector) => {
  const tokens = readThemeBlock(selector);

  it.each(TEXT_ON_SURFACE_PAIRS)("%s 在 %s 上至少 4.5:1", (fg, bg) => {
    expect(tokens[fg], `缺 --${fg}`).toBeDefined();
    expect(tokens[bg], `缺 --${bg}`).toBeDefined();
    expect(contrastRatio(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(TINTED_PAIRS)("%s 疊在 %s 淡底（%s）上至少 4.5:1", (text, tint, alpha) => {
    for (const surface of ["background", "card"]) {
      const tinted = blendOver(tokens[tint], alpha, tokens[surface]);
      expect(contrastRatio(tokens[text], tinted), `${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
