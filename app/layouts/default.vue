<template>
  <Html :lang="head.htmlAttrs.lang" :dir="head.htmlAttrs.dir">
    <Head>
      <Title>{{ title }}</Title>
      <Meta name="description" :content="description" />
      <template v-for="link in head.link" :key="link.key">
        <Link :id="link.key" :rel="link.rel" :href="link.href" :hreflang="link.hreflang" />
      </template>
      <template v-for="meta in head.meta" :key="meta.key">
        <Meta :id="meta.key" :property="meta.property" :content="meta.content" />
      </template>
    </Head>
    <Body>
      <v-app>
        <slot />
      </v-app>
    </Body>
  </Html>
</template>

<script setup>
const appStore = useAppStore();

const route = useRoute();
const { t } = useI18n();
const head = useLocaleHead();
const title = computed(() => t(route.meta.title ?? 'appName'));
const description = computed(() => route.meta.description ? t(`${route.meta.description}`) : appStore.description);
</script>
