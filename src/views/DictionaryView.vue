<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useVocabularyStore } from "../stores/useVocabularyStore";
import { extractErrorMessage } from "../lib/errorUtils";
import { useFeedbackMessage } from "../composables/useFeedbackMessage";
import { useI18n } from "vue-i18n";
import { Plus, Trash2, Bot, Hand, Info } from "lucide-vue-next";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { captureError } from "../lib/sentry";

const vocabularyStore = useVocabularyStore();
const { t, locale } = useI18n();

const newTermInput = ref("");
const isAdding = ref(false);
const removingTermIdSet = ref(new Set<string>());
const feedback = useFeedbackMessage();

const isAddDisabled = computed(
  () => !newTermInput.value.trim() || isAdding.value,
);

const showDuplicateHint = computed(
  () =>
    newTermInput.value.trim() !== "" &&
    vocabularyStore.isDuplicateTerm(newTermInput.value),
);

function getWeightVariant(weight: number): "default" | "secondary" | "outline" {
  if (weight >= 30) return "default";
  if (weight >= 10) return "secondary";
  return "outline";
}

async function handleAddTerm() {
  const term = newTermInput.value.trim();
  if (!term) return;

  try {
    isAdding.value = true;
    await vocabularyStore.addTerm(term);
    newTermInput.value = "";
    feedback.show("success", t("dictionary.added", { term }));
  } catch (err) {
    feedback.show("error", extractErrorMessage(err));
  } finally {
    isAdding.value = false;
  }
}

async function handleRemoveTerm(id: string, term: string) {
  if (removingTermIdSet.value.has(id)) return;

  try {
    removingTermIdSet.value.add(id);
    await vocabularyStore.removeTerm(id);
    feedback.show("success", t("dictionary.removed", { term }));
  } catch (err) {
    feedback.show("error", extractErrorMessage(err));
  } finally {
    removingTermIdSet.value.delete(id);
  }
}

function formatDate(dateString: string): string {
  try {
    // SQLite created_at 儲存為 UTC 且不帶時區後綴，附加 "Z" 確保以 UTC 解析
    const date = new Date(dateString + "Z");
    return date.toLocaleDateString(locale.value, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return dateString;
  }
}

onMounted(async () => {
  try {
    await vocabularyStore.fetchTermList();
  } catch (err) {
    feedback.show("error", t("dictionary.loadFailed"));
    captureError(err, { source: "dictionary-view-mount" });
  }
});

onBeforeUnmount(() => {
  feedback.clearTimer();
});
</script>

<template>
  <div class="p-6">
    <!-- Page header -->
    <div class="flex flex-wrap items-center justify-between gap-4">
      <Badge variant="secondary">{{ $t("dictionary.termCount", { count: vocabularyStore.termCount }) }}</Badge>

      <div class="flex items-center gap-2">
        <div class="flex flex-col">
          <Input
            v-model="newTermInput"
            :placeholder="$t('dictionary.inputPlaceholder')"
            class="w-48"
            @keydown.enter="handleAddTerm"
          />
          <p v-if="showDuplicateHint" class="mt-1 text-xs text-destructive">
            {{ $t("dictionary.duplicateEntry") }}
          </p>
        </div>
        <Button
          size="sm"
          :disabled="isAddDisabled || showDuplicateHint"
          @click="handleAddTerm"
        >
          <Plus class="h-4 w-4 mr-1" />{{ $t("dictionary.add") }}
        </Button>
      </div>
    </div>

    <!-- Description -->
    <div class="mt-4 rounded-lg border border-border bg-muted/50 p-4">
      <div class="flex gap-3">
        <Info class="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
        <div class="space-y-1 text-sm text-muted-foreground">
          <p>{{ $t("dictionary.description") }}</p>
          <p>{{ $t("dictionary.weightDescription", { limit: 50 }) }}</p>
        </div>
      </div>
    </div>

    <!-- Feedback message -->
    <transition name="feedback-fade">
      <p
        v-if="feedback.message.value !== ''"
        class="mt-3 text-sm"
        :class="feedback.type.value === 'success' ? 'text-emerald-500' : 'text-destructive'"
      >
        {{ feedback.message.value }}
      </p>
    </transition>

    <!-- Loading state -->
    <div v-if="vocabularyStore.isLoading" class="mt-6 text-center text-muted-foreground">
      {{ $t("dictionary.loading") }}
    </div>

    <!-- Empty state -->
    <div v-else-if="vocabularyStore.termCount === 0" class="mt-6">
      <Card>
        <div class="px-4 py-8 text-center text-muted-foreground">
          {{ $t("dictionary.emptyState") }}
        </div>
      </Card>
    </div>

    <!-- Dictionary sections -->
    <div v-else class="mt-6 space-y-6">
      <!-- AI Recommended Section -->
      <Card>
        <CardHeader class="pb-3">
          <div class="flex items-center gap-2">
            <CardTitle class="text-base">
              <Bot class="inline h-4 w-4 mr-1" />
              {{ $t("dictionary.aiRecommended") }}
            </CardTitle>
            <Badge v-if="vocabularyStore.aiSuggestedTermList.length > 0" variant="secondary">
              {{ $t("dictionary.aiTermCount", { count: vocabularyStore.aiSuggestedTermList.length }) }}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div
            v-if="vocabularyStore.aiSuggestedTermList.length === 0"
            class="py-4 text-center text-sm text-muted-foreground"
          >
            {{ $t("dictionary.noAiSuggestions") }}
          </div>
          <Table v-else>
            <TableHeader>
              <TableRow>
                <TableHead class="w-full">{{ $t("dictionary.termHeader") }}</TableHead>
                <TableHead class="w-24 text-center">{{ $t("dictionary.weight") }}</TableHead>
                <TableHead class="w-40">{{ $t("dictionary.dateHeader") }}</TableHead>
                <TableHead class="w-20 text-right">{{ $t("dictionary.actionHeader") }}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="entry in vocabularyStore.aiSuggestedTermList" :key="entry.id">
                <TableCell class="font-medium text-foreground">{{ entry.term }}</TableCell>
                <TableCell class="text-center">
                  <Badge :variant="getWeightVariant(entry.weight)">{{ entry.weight }}</Badge>
                </TableCell>
                <TableCell class="text-muted-foreground">{{ formatDate(entry.createdAt) }}</TableCell>
                <TableCell class="text-right">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    class="text-destructive"
                    :disabled="removingTermIdSet.has(entry.id)"
                    @click="handleRemoveTerm(entry.id, entry.term)"
                  >
                    <Trash2 class="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <!-- Manual Section -->
      <Card>
        <CardHeader class="pb-3">
          <CardTitle class="text-base">
            <Hand class="inline h-4 w-4 mr-1" />
            {{ $t("dictionary.manualAdded") }}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table v-if="vocabularyStore.manualTermList.length > 0">
            <TableHeader>
              <TableRow>
                <TableHead class="w-full">{{ $t("dictionary.termHeader") }}</TableHead>
                <TableHead class="w-24 text-center">{{ $t("dictionary.weight") }}</TableHead>
                <TableHead class="w-40">{{ $t("dictionary.dateHeader") }}</TableHead>
                <TableHead class="w-20 text-right">{{ $t("dictionary.actionHeader") }}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="entry in vocabularyStore.manualTermList" :key="entry.id">
                <TableCell class="font-medium text-foreground">{{ entry.term }}</TableCell>
                <TableCell class="text-center">
                  <Badge :variant="getWeightVariant(entry.weight)">{{ entry.weight }}</Badge>
                </TableCell>
                <TableCell class="text-muted-foreground">{{ formatDate(entry.createdAt) }}</TableCell>
                <TableCell class="text-right">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    class="text-destructive"
                    :disabled="removingTermIdSet.has(entry.id)"
                    @click="handleRemoveTerm(entry.id, entry.term)"
                  >
                    <Trash2 class="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <div v-else class="py-4 text-center text-sm text-muted-foreground">
            {{ $t("dictionary.emptyState") }}
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>

<style scoped>
.feedback-fade-enter-active,
.feedback-fade-leave-active {
  transition: opacity 180ms ease;
}

.feedback-fade-enter-from,
.feedback-fade-leave-to {
  opacity: 0;
}
</style>
