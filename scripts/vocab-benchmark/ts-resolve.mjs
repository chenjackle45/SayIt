// 讓 Node 直接 import App 的 TypeScript 原始碼：補上省略的 .ts 副檔名（App 內是 Vite 解析）
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    if (specifier.startsWith(".") && !/\\.[cm]?[jt]s$/.test(specifier)) {
      return next(specifier + ".ts", context);
    }
    throw error;
  }
}
`),
  import.meta.url,
);
