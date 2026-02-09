<template>
  <a v-if="filePath"
    href="#"
    :data-selected="isActive || null"
    class="relative group flex w-[96px] h-[96px] hover:cursor-default transform transform-3d origin-bottom"
    :class="`${(selectedDataSlot === 'series' || selectedDataSlot === 'instance') ? (isActive ? 'opacity-100' : 'hover:opacity-90 opacity-75 rotate-y-45') : ''}`"
    @keydown="onkeydown"
    @click.prevent
  >
    <img v-if="renderedThumbnail"
      :title="name || fileName"
      :src="renderedThumbnail.src"
      :width="renderedThumbnail.width"
      :height="renderedThumbnail.height"
      :class="renderedThumbnail.class"
      class="transition hover:ring hover:ring-white/5 border group-data-selected:border-white/80! group-data-selected:hover:border-white/90! border-white/10! hover:border-white/20! hover:cursor-pointer pointer-events-auto"
      @click.prevent.stop="$emit('click:thumbnail')"
    />
  </a>
</template>

<script setup>
const props = defineProps({
  selectedDataSlot: {
    type: String,
    required: true,
  },
  thumbnailItem: {
    type: Object,
    default: null,
  },
  thumbnailIndex: {
    type: Number,
    default: 0,
  },
  activeThumbnailIndex: {
    type: Number,
    default: -1,
  },
  renderedThumbnails: {
    type: Object,
    default: () => ({}),
  },
});

const emit = defineEmits(['rendered', 'keypressed', 'click:thumbnail']);

function onkeydown(e) {
  if ([
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
  ].includes(e.key)) {
    emit('keypressed', { key: e.key });
    e.preventDefault();
  }
}

const { $dcmjsImaging } = useNuxtApp();

const name = computed(() => props.thumbnailItem?.name);
const fileName = computed(() => props.thumbnailItem?.file?.name);
const filePath = computed(() => props.thumbnailItem?.file?.path);
watch(filePath, () => {
  render();
}, { immediate: true });

const isActive = computed(() => props.selectedDataSlot === 'instance' ? (props.thumbnailIndex === props.activeThumbnailIndex) : false);

const renderedThumbnail = computed(() => {
  const thumbnail = filePath.value && props.renderedThumbnails[filePath.value] || null;
  if (thumbnail) {
    const { dataURL, width, height } = thumbnail;
    return {
      src: dataURL,
      width,
      height,
      class: width >= height ? 'max-w-full w-full h-auto' : 'max-h-full h-full w-auto',
    };
  }
  return null;
});

async function render(type = 'image/webp', quality = 0.1) {
  if (!filePath.value) {
    return;
  }
  if (props.renderedThumbnails[filePath.value]) {
    return props.renderedThumbnails[filePath.value];
  }
  let base64 = '';
  const arrayBuffer = await $fetch(`h3://localhost/file/${encodeURIComponent(filePath.value)}`, { responseType: 'arrayBuffer' });
  const renderingResult = await $dcmjsImaging.render(arrayBuffer);
  if (renderingResult) {
    const { canvas: canvasElement, renderer } = renderingResult;
    base64 = canvasElement.toDataURL(type, quality);
    if (base64) {
      emit('rendered', {
        filePath: filePath.value,
        renderingResult: {
          dataURL: base64,
          width: canvasElement.width,
          height: canvasElement.height,
        },
        renderer,
      });
    }
    canvasElement.remove();
  }
}
</script>
