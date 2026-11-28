<script setup lang="ts">
import SettingsView from "./SettingsView.vue";
import { Button } from "@/components/ui/button";
import { Flag } from "lucide-vue-next";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useSettingsNavigation } from "../composables/useSettingsNavigation";
import type { PreferencesTab } from "../types/settings";

// 主視窗內的設定模式：路由 /settings/:tab（全域守衛已擋掉不認得的分頁），同一個元件換分頁
defineProps<{ tab: PreferencesTab }>();
const { exitSettings } = useSettingsNavigation();
const settingsStore = useSettingsStore();
</script>

<template>
  <div>
    <SettingsView :tab="tab" @exit="exitSettings" />
    <div v-if="tab === 'about'" class="-mt-3 px-6 pb-6">
      <Button variant="link" class="h-auto px-0" data-testid="reopen-onboarding" @click="settingsStore.reopenOnboarding()">
        <Flag class="h-4 w-4" />
        {{ $t("onboarding.reopen") }}
      </Button>
    </div>
  </div>
</template>
