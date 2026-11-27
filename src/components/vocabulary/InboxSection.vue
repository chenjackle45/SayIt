<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { useVocabularyStore } from "@/stores/useVocabularyStore";
import { extractErrorMessage } from "@/lib/errorUtils";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const store = useVocabularyStore();
const { t } = useI18n();
const errorMessage = ref("");

async function runAction(action: () => Promise<void>) {
  errorMessage.value = "";
  try {
    await action();
  } catch (error) {
    errorMessage.value = extractErrorMessage(error);
  }
}

function removeTerm(id: string) {
  return runAction(async () => {
    const snapshot = await store.removeTermWithUndo(id);
    if (!snapshot) return;
    toast.success(t("dictionary.removed", { term: snapshot.entry.term }), {
      action: {
        label: t("dictionary.inbox.undo"),
        onClick: async () => {
          try {
            await store.restoreTerm(snapshot);
            toast.success(t("dictionary.inbox.restored"));
          } catch (error) {
            toast.error(extractErrorMessage(error));
          }
        },
      },
    });
  });
}
</script>

<template>
  <section class="mb-6 min-w-0" :aria-label="t('dictionary.inbox.title')">
    <Card v-if="store.inboxCount > 0">
      <CardHeader class="pb-3">
        <div class="flex items-center gap-2">
          <CardTitle class="text-base">{{ t("dictionary.inbox.title") }}</CardTitle>
          <Badge variant="secondary">{{ store.inboxCount }}</Badge>
        </div>
      </CardHeader>
      <CardContent class="space-y-3">
        <div
          v-for="entry in store.inboxTermList"
          :key="entry.id"
          data-inbox-term
          class="flex min-w-0 flex-wrap items-center gap-2"
        >
          <span class="min-w-0 flex-1 basis-40 break-all text-sm font-medium">{{ entry.term }}</span>
          <div class="flex gap-2">
            <Button size="sm" variant="outline" @click="runAction(() => store.markTermReviewed(entry.id))">
              {{ t("dictionary.inbox.keep") }}
            </Button>
            <Button size="sm" variant="outline" @click="removeTerm(entry.id)">
              {{ t("dictionary.inbox.delete") }}
            </Button>
          </div>
        </div>
        <div
          v-for="replacement in store.suggestedReplacementList"
          :key="replacement.id"
          data-inbox-replacement
          class="flex min-w-0 flex-wrap items-center gap-2"
        >
          <span class="min-w-0 flex-1 basis-40 break-all text-sm">
            {{ t("dictionary.inbox.replacement", { misheard: replacement.misheard, term: replacement.term }) }}
          </span>
          <div class="flex gap-2">
            <Button size="sm" @click="runAction(() => store.applyReplacement(replacement.id))">
              {{ t("dictionary.inbox.apply") }}
            </Button>
            <Button size="sm" variant="outline" @click="runAction(() => store.dismissReplacement(replacement.id))">
              {{ t("dictionary.inbox.dismiss") }}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
    <p v-else class="text-sm text-muted-foreground">{{ t("dictionary.inbox.empty") }}</p>
    <p v-if="errorMessage" role="alert" class="mt-2 break-all text-sm text-destructive">{{ errorMessage }}</p>
  </section>
</template>
