import {
  EXPORT_FORMAT as DICTIONARY_FORMAT,
  EXPORT_VERSION as DICTIONARY_VERSION,
} from "./vocabularyTransfer";
import type { VocabularyExportFile } from "../types/vocabulary";

export const BACKUP_FORMAT = "sayit-backup" as const;
export const BACKUP_VERSION = 1 as const;

/** 備份檔大小上限（位元組）。獨立於字典單檔的 2MB，因設定+字典+加密 base64 會更大。 */
export const MAX_BACKUP_FILE_BYTES = 8 * 1024 * 1024;

/** PBKDF2 迭代次數（OWASP 建議 SHA-256 ≥ 210,000）。 */
export const PBKDF2_ITERATIONS = 210_000;

const SALT_BYTES = 16;
const IV_BYTES = 12;

/**
 * 可匯出的設定 key 白名單（單一真實來源；store 端據此讀寫）。
 * 刻意排除內部 migration / 首次啟動旗標：
 * `hasInitAutoStart`、`lastSeenVersion`、`llmMigratedFromKimiK2`
 * —— 匯出它們會抑制他機的 migration 與升級通知。
 * 注意：autostart 不在 settings.json，由 store 以合成欄位 `autoStartEnabled` 另行處理。
 */
export const EXPORTABLE_SETTING_KEYS = [
  "hotkeyTriggerKey",
  "hotkeyTriggerMode",
  "customTriggerKey",
  "customTriggerKeyDomCode",
  "aiPrompt",
  "promptMode",
  "llmProviderId",
  "llmModelId",
  "whisperModelId",
  "selectedLocale",
  "selectedTranscriptionLocale",
  "muteOnRecording",
  "soundEffectsEnabled",
  "smartDictionaryEnabled",
  "enhancementThresholdEnabled",
  "enhancementThresholdCharCount",
  "recordingAutoCleanupEnabled",
  "recordingAutoCleanupDays",
  "copyTranscriptionToClipboard",
  "audioInputDeviceName",
  "groqApiKey",
  "openaiApiKey",
  "anthropicApiKey",
  "geminiApiKey",
] as const;

export type ExportableSettingKey = (typeof EXPORTABLE_SETTING_KEYS)[number];

/** 含明文金鑰／密鑰的敏感 key —— 「排除金鑰」匯出時會被剔除。 */
export const SENSITIVE_SETTING_KEYS: readonly ExportableSettingKey[] = [
  "groqApiKey",
  "openaiApiKey",
  "anthropicApiKey",
  "geminiApiKey",
];

const SENSITIVE_KEY_SET = new Set<string>(SENSITIVE_SETTING_KEYS);

export type SettingsPayload = Record<string, unknown>;

export interface BackupContents {
  settings: boolean;
  dictionary: boolean;
}

export interface BackupPayload {
  settings: SettingsPayload | null;
  dictionary: VocabularyExportFile | null;
}

export interface EncryptionMeta {
  algorithm: "AES-GCM";
  kdf: "PBKDF2";
  hash: "SHA-256";
  iterations: number;
  salt: string; // base64
  iv: string; // base64
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  appVersion: string;
  contents: BackupContents;
  encryption: EncryptionMeta | null;
  /** 明文時存在 */
  payload?: BackupPayload;
  /** 加密時存在（base64） */
  ciphertext?: string;
}

/**
 * 符號錯誤碼。**絕不**在訊息中放入檔案內容、payload、密文或密碼
 * —— 這些錯誤可能被 captureError 上報到 Sentry。
 */
export type BackupErrorCode =
  | "INVALID_JSON"
  | "INVALID_FORMAT"
  | "UNSUPPORTED_VERSION"
  | "CORRUPT_FILE"
  | "PASSWORD_REQUIRED"
  | "CRYPTO_UNAVAILABLE"
  | "DECRYPT_FAILED";

// ---------------------------------------------------------------------------
// base64 helpers（chunked，避免 String.fromCharCode(...bytes) 爆 call stack）
// ---------------------------------------------------------------------------

const CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// 建立 / 序列化
// ---------------------------------------------------------------------------

export interface BuildBackupOptions {
  settings: SettingsPayload | null;
  dictionary: VocabularyExportFile | null;
  appVersion: string;
  exportedAt: string;
}

/** 組明文備份物件（encryption = null）。 */
export function buildBackupFile(opts: BuildBackupOptions): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: opts.exportedAt,
    appVersion: opts.appVersion,
    contents: {
      settings: opts.settings !== null,
      dictionary: opts.dictionary !== null,
    },
    encryption: null,
    payload: {
      settings: opts.settings,
      dictionary: opts.dictionary,
    },
  };
}

/** 從設定物件剔除敏感 key（用於「排除金鑰」匯出）。 */
export function stripSensitiveKeys(settings: SettingsPayload): SettingsPayload {
  const result: SettingsPayload = {};
  for (const [key, value] of Object.entries(settings)) {
    if (SENSITIVE_KEY_SET.has(key)) continue;
    result[key] = value;
  }
  return result;
}

/** 序列化為帶縮排的 JSON 字串。 */
export function serializeBackup(file: BackupFile): string {
  return JSON.stringify(file, null, 2);
}

/**
 * 產生 Windows 檔名安全的備份檔名：`sayit-backup-YYYYMMDD-HHmmss.json`（本機時間）。
 * 刻意以本機時間各欄位手動補零，**不**用 `toISOString()`——其輸出含冒號，
 * 是 Windows 檔名的非法字元。
 */
export function buildBackupFilename(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `sayit-backup-${stamp}.json`;
}

type ExpectedType = "string" | "number" | "boolean" | "object" | "stringOrObject";

/**
 * 各設定 key 的期望值型別（含合成 autoStartEnabled）。
 * 用於匯入前清洗：丟棄型別不符的 key，避免把壞值（如數字欄位存字串、
 * locale 存非字串）持久化後造成 runtime 狀態損壞。
 */
const SETTING_VALUE_TYPES: Record<string, ExpectedType> = {
  hotkeyTriggerKey: "stringOrObject",
  hotkeyTriggerMode: "string",
  customTriggerKey: "object",
  customTriggerKeyDomCode: "string",
  aiPrompt: "string",
  promptMode: "string",
  llmProviderId: "string",
  llmModelId: "string",
  whisperModelId: "string",
  selectedLocale: "string",
  selectedTranscriptionLocale: "string",
  muteOnRecording: "boolean",
  soundEffectsEnabled: "boolean",
  smartDictionaryEnabled: "boolean",
  enhancementThresholdEnabled: "boolean",
  enhancementThresholdCharCount: "number",
  recordingAutoCleanupEnabled: "boolean",
  recordingAutoCleanupDays: "number",
  copyTranscriptionToClipboard: "boolean",
  audioInputDeviceName: "string",
  groqApiKey: "string",
  openaiApiKey: "string",
  anthropicApiKey: "string",
  geminiApiKey: "string",
  autoStartEnabled: "boolean",
};

function matchesExpectedType(value: unknown, expected: ExpectedType): boolean {
  switch (expected) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return value !== null && typeof value === "object";
    case "stringOrObject":
      return (
        typeof value === "string" ||
        (value !== null && typeof value === "object")
      );
  }
}

/**
 * 匯入前清洗設定 payload：丟棄未知 key 與型別不符的值。
 * 回傳只含合法項目的新物件（缺漏的 key 之後會 fallback 至既有/預設值）。
 */
export function sanitizeSettingsPayload(
  settings: SettingsPayload,
): SettingsPayload {
  const result: SettingsPayload = {};
  for (const [key, value] of Object.entries(settings)) {
    const expected = SETTING_VALUE_TYPES[key];
    if (!expected) continue; // 未知 key
    if (!matchesExpectedType(value, expected)) continue; // 型別不符
    result[key] = value;
  }
  return result;
}

// ---------------------------------------------------------------------------
// 加密 / 解密（WebCrypto AES-GCM + PBKDF2）
// ---------------------------------------------------------------------------

function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("CRYPTO_UNAVAILABLE");
  }
  return subtle;
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const subtle = getSubtle();
  const baseKey = await subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * 將明文備份加密：payload → ciphertext（base64），並填入 encryption 中介資料。
 * AES-GCM 的 auth tag 已附在密文尾端，不另行編碼。
 */
export async function encryptBackup(
  file: BackupFile,
  password: string,
): Promise<BackupFile> {
  if (!password) throw new Error("PASSWORD_REQUIRED");
  if (!file.payload) throw new Error("CORRUPT_FILE");

  const subtle = getSubtle();
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);

  const plaintext = new TextEncoder().encode(JSON.stringify(file.payload));
  const cipherBuffer = await subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    plaintext as BufferSource,
  );

  return {
    format: file.format,
    version: file.version,
    exportedAt: file.exportedAt,
    appVersion: file.appVersion,
    contents: file.contents,
    encryption: {
      algorithm: "AES-GCM",
      kdf: "PBKDF2",
      hash: "SHA-256",
      iterations: PBKDF2_ITERATIONS,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
    },
    ciphertext: bytesToBase64(new Uint8Array(cipherBuffer)),
  };
}

/** PBKDF2 迭代次數上限，避免惡意/毀損檔以超大值癱瘓 UI（DoS）。 */
export const MAX_PBKDF2_ITERATIONS = 5_000_000;

function isValidEncryptionMeta(meta: unknown): meta is EncryptionMeta {
  if (!meta || typeof meta !== "object") return false;
  const m = meta as Partial<EncryptionMeta>;
  return (
    m.algorithm === "AES-GCM" &&
    m.kdf === "PBKDF2" &&
    m.hash === "SHA-256" &&
    typeof m.iterations === "number" &&
    Number.isSafeInteger(m.iterations) &&
    m.iterations > 0 &&
    m.iterations <= MAX_PBKDF2_ITERATIONS &&
    typeof m.salt === "string" &&
    typeof m.iv === "string"
  );
}

// ---------------------------------------------------------------------------
// 解析 / 驗證
// ---------------------------------------------------------------------------

function isValidContents(value: unknown): value is BackupContents {
  if (!value || typeof value !== "object") return false;
  const c = value as Partial<BackupContents>;
  return typeof c.settings === "boolean" && typeof c.dictionary === "boolean";
}

/**
 * 解析備份檔的「外層信封」並驗證（**不**解密）。
 * - 未知 format → INVALID_FORMAT
 * - version > BACKUP_VERSION → UNSUPPORTED_VERSION
 * - 加密：須有合法 encryption 中介資料 + ciphertext
 * - 明文：須有 payload，且 payload 與 contents 一致
 */
export function parseBackup(content: string): BackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("INVALID_JSON");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("INVALID_FORMAT");
  }
  const raw = parsed as Partial<BackupFile>;

  if (raw.format !== BACKUP_FORMAT) {
    throw new Error("INVALID_FORMAT");
  }
  if (typeof raw.version !== "number") {
    throw new Error("INVALID_FORMAT");
  }
  if (raw.version > BACKUP_VERSION) {
    throw new Error("UNSUPPORTED_VERSION");
  }
  if (!isValidContents(raw.contents)) {
    throw new Error("INVALID_FORMAT");
  }

  if (raw.encryption != null) {
    if (!isValidEncryptionMeta(raw.encryption)) {
      throw new Error("INVALID_FORMAT");
    }
    if (typeof raw.ciphertext !== "string" || raw.ciphertext === "") {
      throw new Error("CORRUPT_FILE");
    }
    return {
      format: BACKUP_FORMAT,
      version: raw.version,
      exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : "",
      appVersion: typeof raw.appVersion === "string" ? raw.appVersion : "",
      contents: raw.contents,
      encryption: raw.encryption,
      ciphertext: raw.ciphertext,
    };
  }

  // 明文
  if (!raw.payload || typeof raw.payload !== "object") {
    throw new Error("CORRUPT_FILE");
  }
  const payload = normalizePayload(raw.payload as Partial<BackupPayload>);
  assertPayloadMatchesContents(payload, raw.contents);

  return {
    format: BACKUP_FORMAT,
    version: raw.version,
    exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : "",
    appVersion: typeof raw.appVersion === "string" ? raw.appVersion : "",
    contents: raw.contents,
    encryption: null,
    payload,
  };
}

function normalizePayload(raw: Partial<BackupPayload>): BackupPayload {
  const settings =
    raw.settings && typeof raw.settings === "object"
      ? (raw.settings as SettingsPayload)
      : null;
  const dictionary =
    raw.dictionary && typeof raw.dictionary === "object"
      ? (raw.dictionary as VocabularyExportFile)
      : null;
  return { settings, dictionary };
}

function assertPayloadMatchesContents(
  payload: BackupPayload,
  contents: BackupContents,
): void {
  if (contents.settings && payload.settings === null) {
    throw new Error("CORRUPT_FILE");
  }
  if (contents.dictionary && payload.dictionary === null) {
    throw new Error("CORRUPT_FILE");
  }
}

/**
 * 取得備份 payload（必要時解密）。
 * - 明文：直接回傳已驗證的 payload。
 * - 加密：須提供密碼；解密失敗一律歸為 DECRYPT_FAILED。
 */
export async function getBackupPayload(
  file: BackupFile,
  password?: string,
): Promise<BackupPayload> {
  if (file.encryption == null) {
    if (!file.payload) throw new Error("CORRUPT_FILE");
    return file.payload;
  }

  if (!password) throw new Error("PASSWORD_REQUIRED");
  if (!file.ciphertext) throw new Error("CORRUPT_FILE");

  const subtle = getSubtle();
  let salt: Uint8Array;
  let iv: Uint8Array;
  let cipherBytes: Uint8Array;
  try {
    salt = base64ToBytes(file.encryption.salt);
    iv = base64ToBytes(file.encryption.iv);
    cipherBytes = base64ToBytes(file.ciphertext);
  } catch {
    throw new Error("CORRUPT_FILE");
  }
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES) {
    throw new Error("CORRUPT_FILE");
  }

  let plainBuffer: ArrayBuffer;
  try {
    const key = await deriveKey(password, salt, file.encryption.iterations);
    plainBuffer = await subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      cipherBytes as BufferSource,
    );
  } catch {
    // 密碼錯誤、auth tag 不符、檔案毀損都歸於此
    throw new Error("DECRYPT_FAILED");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plainBuffer));
  } catch {
    throw new Error("DECRYPT_FAILED");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("DECRYPT_FAILED");
  }

  const payload = normalizePayload(parsed as Partial<BackupPayload>);
  assertPayloadMatchesContents(payload, file.contents);
  return payload;
}

/** 字典區塊是否為相容的 SayIt 字典格式與版本。 */
export function isSupportedDictionaryBlock(
  dictionary: VocabularyExportFile | null,
): dictionary is VocabularyExportFile {
  return (
    dictionary != null &&
    dictionary.format === DICTIONARY_FORMAT &&
    dictionary.version === DICTIONARY_VERSION &&
    Array.isArray(dictionary.terms)
  );
}
