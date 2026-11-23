import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import { toast } from "vue-sonner";
import { Toaster } from "../../src/components/ui/sonner";

// v0.16 #7：成功 toast 2.5 秒後要自己消失。vue-sonner 預設的 Alt+T 會把通知卡在展開、計時暫停，
// 所以我們的 Toaster 預設關掉這個熱鍵（實作閘 R2 以真實套件重現）

let wrapper: VueWrapper | undefined;

afterEach(() => {
  wrapper?.unmount();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

async function showSuccessToast() {
  vi.useFakeTimers();
  wrapper = mount(Toaster, { attachTo: document.body, props: { position: "bottom-right", duration: 2500 } });
  toast.success("已儲存");
  await nextTick();
  await nextTick();
  await nextTick();
}

describe("Toaster", () => {
  it("成功 toast 約 2.5 秒後自行消失", async () => {
    await showSuccessToast();
    expect(document.querySelector("[data-sonner-toast]")).not.toBeNull();
    await vi.advanceTimersByTimeAsync(4000);
    expect(document.querySelector("[data-sonner-toast]")).toBeNull();
  });

  it("按 Alt+T 不會讓通知卡住", async () => {
    await showSuccessToast();
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyT", key: "t", altKey: true, bubbles: true }));
    await nextTick();
    await vi.advanceTimersByTimeAsync(4000);
    expect(document.querySelector("[data-sonner-toast]")).toBeNull();
  });
});
