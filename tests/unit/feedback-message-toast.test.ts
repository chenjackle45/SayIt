import { beforeEach, describe, expect, it, vi } from "vitest";

// v0.16 #7：成功類回饋改 toast；錯誤維持在原位（行內）顯示

const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("vue-sonner", () => ({ toast: { success: toastSuccess } }));

import { useFeedbackMessage } from "../../src/composables/useFeedbackMessage";

describe("useFeedbackMessage", () => {
  beforeEach(() => {
    toastSuccess.mockClear();
  });

  it("成功 → 發 toast，不佔行內", () => {
    const feedback = useFeedbackMessage();
    feedback.show("success", "已儲存");
    expect(toastSuccess).toHaveBeenCalledWith("已儲存");
    expect(feedback.message.value).toBe("");
  });

  it("錯誤 → 留在行內，不發 toast", () => {
    const feedback = useFeedbackMessage();
    feedback.show("error", "儲存失敗");
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(feedback.message.value).toBe("儲存失敗");
    expect(feedback.type.value).toBe("error");
  });

  it("錯誤之後成功 → 行內的錯誤清掉", () => {
    const feedback = useFeedbackMessage();
    feedback.show("error", "儲存失敗");
    feedback.show("success", "已儲存");
    expect(feedback.message.value).toBe("");
  });
});
