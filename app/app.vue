<template>
  <NuxtLayout>
    <UApp :locale="locales[locale]">
      <NuxtPage />
    </UApp>
  </NuxtLayout>
</template>

<script setup lang="ts">
import * as locales from '@nuxt/ui/locale';

const { locale } = useI18n();
</script>
