// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { selectAiVocabulary } from "../../src/lib/vocabularySelection";
import type { VocabularyEntry } from "../../src/types/vocabulary";

// 僅 cases-a 做候選門檻觀察；不讀 cases-b、不呼叫 API、不改凍結題單。
it("cases-a 既有辨識快取可離線共用 App 的候選選詞", () => {
  const rows = readFileSync(new URL("../eval/vocab/cases-a.jsonl", import.meta.url), "utf8").trim().split("\n")
    .map((line) => JSON.parse(line) as { id: string; lang: string; entities: string[] });
  const metrics = [];
  for (const baseline of ["none", "current"]) {
    let expected = 0;
    let output = 0;
    let hits = 0;
    for (const row of rows) {
      const vocabulary: VocabularyEntry[] = [...new Set(rows.filter((other) => other.lang === row.lang).flatMap((other) => other.entities))]
        .map((term) => ({ id: term, term, source: "ai", isReviewed: true, weight: 1, correctionCount: 1, createdAt: "2026-11-27 00:00:00", lastCorrectedAt: "2026-11-27 00:00:00" }));
      const cached = JSON.parse(readFileSync(new URL(`../eval/vocab/results/cache/whisper/${baseline}/${row.id}.json`, import.meta.url), "utf8")) as { status: number; text: string };
      expect(cached.status).toBe(200);
      const candidates = selectAiVocabulary(vocabulary, [], cached.text);
      expected += row.entities.length;
      output += candidates.length;
      hits += row.entities.filter((term) => candidates.some((candidate) => candidate.term === term)).length;
    }
    metrics.push({ baseline, expected, output, hits, recall: hits / expected, precision: hits / output });
  }
  console.log(JSON.stringify({ suite: "cases-a 候選門檻觀察", metrics }));
});
