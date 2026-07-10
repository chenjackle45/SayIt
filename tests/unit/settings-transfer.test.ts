import { describe, expect, it } from "vitest";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  EXPORTABLE_SETTING_KEYS,
  SENSITIVE_SETTING_KEYS,
  base64ToBytes,
  buildBackupFile,
  buildBackupFilename,
  bytesToBase64,
  encryptBackup,
  getBackupPayload,
  isSupportedDictionaryBlock,
  parseBackup,
  serializeBackup,
  sanitizeSettingsPayload,
  stripSensitiveKeys,
  type BackupFile,
  type SettingsPayload,
} from "../../src/lib/settingsTransfer";
import { buildExportFile } from "../../src/lib/vocabularyTransfer";
import type { VocabularyExportFile } from "../../src/types/vocabulary";

const sampleSettings: SettingsPayload = {
  hotkeyTriggerKey: "fn",
  hotkeyTriggerMode: "hold",
  selectedLocale: "zh-TW",
  groqApiKey: "gsk_secret_value",
  openaiApiKey: "sk_secret_value",
  muteOnRecording: true,
};

const sampleDictionary: VocabularyExportFile = buildExportFile(
  [{ term: "Groq", weight: 30, source: "manual" }],
  "2026-06-23T00:00:00.000Z",
);

function buildPlainBackup(
  settings: SettingsPayload | null,
  dictionary: VocabularyExportFile | null,
): BackupFile {
  return buildBackupFile({
    settings,
    dictionary,
    appVersion: "0.10.0",
    exportedAt: "2026-06-23T00:00:00.000Z",
  });
}

describe("buildBackupFile / serializeBackup", () => {
  it("產生帶 format/version/contents 的明文物件", () => {
    const file = buildPlainBackup(sampleSettings, sampleDictionary);
    expect(file.format).toBe(BACKUP_FORMAT);
    expect(file.version).toBe(BACKUP_VERSION);
    expect(file.encryption).toBeNull();
    expect(file.contents).toEqual({ settings: true, dictionary: true });
    expect(file.payload?.settings).toEqual(sampleSettings);
  });

  it("未選區塊時 contents 對應為 false、payload 為 null", () => {
    const file = buildPlainBackup(sampleSettings, null);
    expect(file.contents).toEqual({ settings: true, dictionary: false });
    expect(file.payload?.dictionary).toBeNull();
  });

  it("serializeBackup 產生可解析的 JSON", () => {
    const json = serializeBackup(buildPlainBackup(sampleSettings, null));
    expect(() => JSON.parse(json)).not.toThrow();
  });
});

describe("buildBackupFilename", () => {
  it("格式為 sayit-backup-YYYYMMDD-HHmmss.json", () => {
    const name = buildBackupFilename(new Date());
    expect(name).toMatch(/^sayit-backup-\d{8}-\d{6}\.json$/);
  });

  it("不含冒號（Windows 檔名安全）", () => {
    const name = buildBackupFilename(new Date(2026, 5, 23, 17, 45, 1));
    expect(name).not.toContain(":");
  });

  it("以本機時間各欄位補零", () => {
    // 月份 0-indexed：0 → 一月；2026-01-05 09:07:03
    const name = buildBackupFilename(new Date(2026, 0, 5, 9, 7, 3));
    expect(name).toBe("sayit-backup-20260105-090703.json");
  });
});

describe("stripSensitiveKeys", () => {
  it("剔除所有敏感 key、保留其餘", () => {
    const stripped = stripSensitiveKeys(sampleSettings);
    for (const key of SENSITIVE_SETTING_KEYS) {
      expect(stripped).not.toHaveProperty(key);
    }
    expect(stripped.hotkeyTriggerKey).toBe("fn");
    expect(stripped.muteOnRecording).toBe(true);
  });

  it("白名單不含內部 migration 旗標", () => {
    const keys = EXPORTABLE_SETTING_KEYS as readonly string[];
    expect(keys).not.toContain("hasInitAutoStart");
    expect(keys).not.toContain("lastSeenVersion");
    expect(keys).not.toContain("llmMigratedFromKimiK2");
  });
});

describe("base64 helpers", () => {
  it("大型位元組陣列 round-trip 不爆 stack 且內容一致", () => {
    const bytes = new Uint8Array(200_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    const restored = base64ToBytes(bytesToBase64(bytes));
    expect(restored.length).toBe(bytes.length);
    expect(restored[0]).toBe(0);
    expect(restored[255]).toBe(255);
    expect(restored[199_999]).toBe(bytes[199_999]);
  });
});

describe("parseBackup（明文）", () => {
  it("round-trip 還原 payload", () => {
    const json = serializeBackup(buildPlainBackup(sampleSettings, sampleDictionary));
    const parsed = parseBackup(json);
    expect(parsed.encryption).toBeNull();
    expect(parsed.payload?.settings).toEqual(sampleSettings);
  });

  it("非 JSON → INVALID_JSON", () => {
    expect(() => parseBackup("{ not json")).toThrow("INVALID_JSON");
  });

  it("錯誤 format → INVALID_FORMAT", () => {
    expect(() => parseBackup(JSON.stringify({ format: "other", version: 1 }))).toThrow(
      "INVALID_FORMAT",
    );
  });

  it("version 超過上限 → UNSUPPORTED_VERSION", () => {
    const future = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION + 1,
      contents: { settings: true, dictionary: false },
      encryption: null,
      payload: { settings: sampleSettings, dictionary: null },
    };
    expect(() => parseBackup(JSON.stringify(future))).toThrow("UNSUPPORTED_VERSION");
  });

  it("contents 宣稱有設定但 payload 缺 → CORRUPT_FILE", () => {
    const corrupt = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      contents: { settings: true, dictionary: false },
      encryption: null,
      payload: { settings: null, dictionary: null },
    };
    expect(() => parseBackup(JSON.stringify(corrupt))).toThrow("CORRUPT_FILE");
  });

  it("partial（只含字典）合法", () => {
    const parsed = parseBackup(serializeBackup(buildPlainBackup(null, sampleDictionary)));
    expect(parsed.contents).toEqual({ settings: false, dictionary: true });
    expect(parsed.payload?.settings).toBeNull();
    expect(parsed.payload?.dictionary).not.toBeNull();
  });
});

describe("加密 round-trip", () => {
  const password = "correct horse battery staple";

  it("加密後外層無明文、可用正確密碼解回", async () => {
    const encrypted = await encryptBackup(
      buildPlainBackup(sampleSettings, sampleDictionary),
      password,
    );
    expect(encrypted.encryption).not.toBeNull();
    expect(encrypted.payload).toBeUndefined();
    expect(typeof encrypted.ciphertext).toBe("string");
    // 外層序列化不應含明文金鑰
    expect(serializeBackup(encrypted)).not.toContain("gsk_secret_value");

    const parsed = parseBackup(serializeBackup(encrypted));
    const payload = await getBackupPayload(parsed, password);
    expect(payload.settings).toEqual(sampleSettings);
    expect(payload.dictionary?.terms).toHaveLength(1);
  });

  it("錯誤密碼 → DECRYPT_FAILED", async () => {
    const encrypted = await encryptBackup(buildPlainBackup(sampleSettings, null), password);
    const parsed = parseBackup(serializeBackup(encrypted));
    await expect(getBackupPayload(parsed, "wrong password")).rejects.toThrow(
      "DECRYPT_FAILED",
    );
  });

  it("加密檔未提供密碼 → PASSWORD_REQUIRED", async () => {
    const encrypted = await encryptBackup(buildPlainBackup(sampleSettings, null), password);
    const parsed = parseBackup(serializeBackup(encrypted));
    await expect(getBackupPayload(parsed)).rejects.toThrow("PASSWORD_REQUIRED");
  });

  it("空密碼加密 → PASSWORD_REQUIRED", async () => {
    await expect(
      encryptBackup(buildPlainBackup(sampleSettings, null), ""),
    ).rejects.toThrow("PASSWORD_REQUIRED");
  });

  it("大型字典加密 round-trip", async () => {
    const bigDict = buildExportFile(
      Array.from({ length: 5000 }, (_, i) => ({
        term: `term-${i}`,
        weight: (i % 50) + 1,
        source: "manual" as const,
      })),
      "2026-06-23T00:00:00.000Z",
    );
    const encrypted = await encryptBackup(buildPlainBackup(null, bigDict), password);
    const payload = await getBackupPayload(
      parseBackup(serializeBackup(encrypted)),
      password,
    );
    expect(payload.dictionary?.terms).toHaveLength(5000);
  });
});

describe("isSupportedDictionaryBlock", () => {
  it("相容格式/版本 → true", () => {
    expect(isSupportedDictionaryBlock(sampleDictionary)).toBe(true);
  });

  it("null / 錯誤格式 / 錯誤版本 → false", () => {
    expect(isSupportedDictionaryBlock(null)).toBe(false);
    expect(
      isSupportedDictionaryBlock({
        ...sampleDictionary,
        format: "other" as never,
      }),
    ).toBe(false);
    expect(
      isSupportedDictionaryBlock({ ...sampleDictionary, version: 999 }),
    ).toBe(false);
  });
});

describe("sanitizeSettingsPayload", () => {
  it("丟棄型別不符與未知 key、保留合法值", () => {
    const clean = sanitizeSettingsPayload({
      selectedLocale: "zh-TW",
      muteOnRecording: true,
      enhancementThresholdCharCount: 42,
      enhancementThresholdEnabled: "yes" as unknown as boolean, // 型別錯 → 丟棄
      recordingAutoCleanupDays: "7" as unknown as number, // 型別錯 → 丟棄
      bogusKey: "x", // 未知 → 丟棄
    });
    expect(clean.selectedLocale).toBe("zh-TW");
    expect(clean.muteOnRecording).toBe(true);
    expect(clean.enhancementThresholdCharCount).toBe(42);
    expect(clean).not.toHaveProperty("enhancementThresholdEnabled");
    expect(clean).not.toHaveProperty("recordingAutoCleanupDays");
    expect(clean).not.toHaveProperty("bogusKey");
  });

  it("hotkeyTriggerKey 接受字串或物件", () => {
    expect(
      sanitizeSettingsPayload({ hotkeyTriggerKey: "fn" }).hotkeyTriggerKey,
    ).toBe("fn");
    const combo = { combo: { modifiers: ["command"], keycode: 1 } };
    expect(
      sanitizeSettingsPayload({ hotkeyTriggerKey: combo }).hotkeyTriggerKey,
    ).toEqual(combo);
    expect(
      sanitizeSettingsPayload({ hotkeyTriggerKey: 123 as unknown as string }),
    ).not.toHaveProperty("hotkeyTriggerKey");
  });
});

describe("加密 metadata 防護", () => {
  const password = "pw";

  it("iterations 超過上限 → INVALID_FORMAT", async () => {
    const encrypted = await encryptBackup(
      buildPlainBackup(sampleSettings, null),
      password,
    );
    const tampered = serializeBackup({
      ...encrypted,
      encryption: { ...encrypted.encryption!, iterations: 1e10 },
    });
    expect(() => parseBackup(tampered)).toThrow("INVALID_FORMAT");
  });

  it("salt/iv base64 毀損 → CORRUPT_FILE", async () => {
    const encrypted = await encryptBackup(
      buildPlainBackup(sampleSettings, null),
      password,
    );
    const parsed = parseBackup(
      serializeBackup({
        ...encrypted,
        encryption: { ...encrypted.encryption!, salt: "!!!not-base64!!!" },
      }),
    );
    await expect(getBackupPayload(parsed, password)).rejects.toThrow(
      "CORRUPT_FILE",
    );
  });
});
