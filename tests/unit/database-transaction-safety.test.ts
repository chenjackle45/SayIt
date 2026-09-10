import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * 回歸守門：禁止以「獨立 execute() 呼叫」發出 BEGIN/COMMIT/ROLLBACK。
 *
 * tauri-plugin-sql 每次 execute()/select() 都從 sqlx 連線池借一條全新連線，
 * 無連線親和性；跨呼叫的 BEGIN 與 COMMIT 可能落在不同實體連線，導致
 * "cannot commit - no transaction is active"（首次啟動跑 migration 必現）。
 * Migration / 批次寫入必須改用冪等語句，不可依賴跨呼叫交易。
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

function readSource(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

describe("DB 連線池安全：禁止跨呼叫交易語句", () => {
  const files = ["src/lib/database.ts", "src/stores/useVocabularyStore.ts"];

  for (const file of files) {
    it(`[P1] ${file} 不得有獨立的 execute("BEGIN/COMMIT/ROLLBACK") 呼叫`, () => {
      const source = readSource(file);
      // 全檔掃描（\s* 可跨換行），亦能捕捉跨行的 .execute(\n  "COMMIT"\n)
      const pattern =
        /\.execute\(\s*[`"'](?:BEGIN(?:\s+TRANSACTION)?|COMMIT|ROLLBACK)\b/gi;
      const offending = [...source.matchAll(pattern)].map((match) => {
        const lineNo = source.slice(0, match.index).split("\n").length;
        return `L${lineNo}: ${match[0]}`;
      });

      expect(
        offending,
        `發現跨呼叫交易語句（連線池無親和性，COMMIT 可能落在無交易的連線）：\n${offending.join(
          "\n",
        )}`,
      ).toEqual([]);
    });
  }
});
