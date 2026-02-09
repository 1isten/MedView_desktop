<template>
  <v-sheet :height="128" color="background-dark" class="flex-none border-t border-default" v-mouse-in-element="onMouseInElement">
    <UScrollArea
      v-slot="{ item, index }"
      :items="thumbnailItems"
      :orientation="'horizontal'"
      :virtualize="{
        paddingStart: selectedDataSlot === 'instance' ? 32 : 32,
        paddingEnd: selectedDataSlot === 'instance' ? activeThumbnailIndex === -1 ? 96 : 128 : 32,
        gap: 12,
        overscan: 15,
        estimateSize: selectedDataSlot === 'instance' ? 24 : 96,
        getItemKey: (index) => thumbnailItems[index].file.path,
      }"
      :ui="{
        viewport: 'mx-auto',
        item: 'flex items-center justify-center pointer-events-none',
      }"
      class="data-[orientation=horizontal]:h-[128px] w-full overflow-hidden"
      ref="scrollArea"
      @wheel.passive="handleCoverFlowScrollAreaOnWheel"
    >
      <UPageCard
        v-bind="item"
        variant="soft"
        class="bg-transparent rounded-none"
        :class="`h-[96px] ${(selectedDataSlot === 'instance') ? (index !== activeThumbnailIndex ? 'w-[24px]' : 'w-[96px]') : 'w-[96px]'} transform transition-all duration-200`"
        :ui="{
          container: `p-0! transition transform ${index === activeThumbnailIndex ? 'scale-95' : 'scale-90'}`,
        }"
      >
        <div
          class="absolute inset-0 w-full h-full perspective-midrange perspective-origin-top transform duration-300"
          :class="selectedDataSlot === 'instance' ? `${activeThumbnailIndex === -1 ? '' : index < activeThumbnailIndex ? '-translate-x-[8px]' : index === activeThumbnailIndex ? 'translate-x-[48px]' : 'translate-x-[32px]'}` : ''"
        >
          <DicomThumbnail
            :selected-data-slot="selectedDataSlot"
            :thumbnail-item="item"
            :thumbnail-index="index"
            :active-thumbnail-index="activeThumbnailIndex"
            :rendered-thumbnails="renderedThumbnails"
            @rendered="handleRenderedThumbnail"
            @keypressed="handleKeyPressedThumbnail($event, item, index)"
            @click:thumbnail="handleClickThumbnail(item, index)"
          />
        </div>
      </UPageCard>
    </UScrollArea>
  </v-sheet>
</template>

<script setup>
import { useOverlayScrollbars } from 'overlayscrollbars-vue';
import { vMouseInElement } from '@vueuse/components';

const props = defineProps({
  selectedDataItem: {
    type: Object,
    default: null,
  },
});

const selectedDataSlot = computed(() => {
  if (props.selectedDataItem?.slot) {
    if (props.selectedDataItem.slot === 'series') {
      return 'instance';
    }
    return props.selectedDataItem?.slot;
  }
  return '';
});

const parsingStore = useParsingStore();
const { recentClickedThumbnail } = storeToRefs(parsingStore);

const thumbnailItems = ref([]);
const renderedThumbnails = ref({});
function handleRenderedThumbnail({ filePath, renderingResult, renderer }) {
  renderedThumbnails.value[filePath] = renderingResult;
};
function handleClickThumbnail(item, index) {
  if (recentClickedThumbnail.value !== item) {
    recentClickedThumbnail.value = item;
  }
}

const scrollArea = useTemplateRef('scrollArea');
const scrollToItem = (index, options = { align: 'auto', behavior: 'auto' }) => scrollArea.value?.virtualizer?.scrollToIndex(index, options);

const [osInitialize, osInstance] = useOverlayScrollbars({
  options: {
    overflow: {
      x: 'scroll',
      y: 'hidden',
    },
    scrollbars: {
      theme: 'os-theme-light',
      autoHide: 'scroll',
    },
  },
  events: {
    scroll(e) {
      if (scrollArea.value?.virtualizer) {
        // console.log(e.elements().viewport.scrollLeft, scrollArea.value.virtualizer);
      }
    },
  },
  defer: true,
});

onMounted(() => {
  const scrollAreaEl = scrollArea.value?.$el;
  if (scrollAreaEl) {
    osInitialize({
      target: scrollAreaEl,
      elements: {
        viewport: scrollAreaEl,
      },
      scrollbars: {
        slot: scrollAreaEl.parentElement,
      },
    });
    setTimeout(() => {
      scrollAreaEl.classList.remove('overflow-hidden');
    }, 200);
  }
});

function handleCoverFlowScrollAreaOnWheel(e) {
  if (e.deltaX !== 0 || e.deltaY === 0) {
    return;
  }
  if (scrollArea.value?.virtualizer) {
    scrollArea.value.virtualizer.scrollElement.scrollBy(e.deltaY, 0);
  }
}

// --- sync selection changes to update thumbnails ---

const activeThumbnailIndex = computed(() => {
  if (props.selectedDataItem?.slot === 'instance') {
    return thumbnailItems.value.findIndex(({ slot, file }) => {
      return slot === 'instance' && file?.path === (props.selectedDataItem.filePath || props.selectedDataItem.path);
    });
  }
  return -1;
});
watch(activeThumbnailIndex, (activeIndex) => {
  if (activeIndex === -1 || selectedDataSlot.value !== 'instance') {
    return;
  }
  scrollArea.value?.virtualizer?.resizeItem(activeIndex, 96);
});

const appStore = useAppStore();
const { isMouseInCoverFlow } = storeToRefs(appStore);
function onMouseInElement({ isOutside }) {
  isMouseInCoverFlow.value = !isOutside;
}

let scrollTimer = null;
function handleKeyPressedThumbnail(e, item, index) {
  const scrollTo = (index) => {
    if (scrollTimer) {
      clearTimeout(scrollTimer);
      scrollTimer = null;
    }
    scrollTimer = setTimeout(() => {
      scrollToItem(index);
    }, 10);
  }
  if (!e?.key) {
    return;
  } else if (['ArrowUp', 'ArrowLeft'].includes(e.key)) {
    const prevItem = thumbnailItems.value[index - 1];
    if (prevItem) {
      const prevEl = scrollArea.value?.virtualizer?.scrollElement?.querySelector(`[data-index='${index - 1}']`)?.querySelector('a > img')?.parentElement;
      if (prevEl) {
        scrollTo(index - 1);
        handleClickThumbnail(prevItem, index - 1);
        nextTick(() => {
          prevEl.focus();
        });
      }
    }
  } else if (['ArrowDown', 'ArrowRight'].includes(e.key)) {
    const nextItem = thumbnailItems.value[index + 1];
    if (nextItem) {
      const nextEl = scrollArea.value?.virtualizer?.scrollElement?.querySelector(`[data-index='${index + 1}']`)?.querySelector('a > img')?.parentElement;
      if (nextEl) {
        scrollTo(index + 1);
        handleClickThumbnail(nextItem, index + 1);
        nextTick(() => {
          nextEl.focus();
        });
      }
    }
  }
}

watch(() => props.selectedDataItem, (currSelection, prevSelection) => {
  if (currSelection) {
    if (currSelection?.id !== prevSelection?.id) {
      if (currSelection.slot === 'instance' && !isMouseInCoverFlow.value) {
        nextTick(() => {
          if (activeThumbnailIndex.value !== -1) {
            if (scrollTimer) {
              clearTimeout(scrollTimer);
              scrollTimer = null;
            }
            scrollTimer = setTimeout(() => {
              scrollToItem(activeThumbnailIndex.value, { align: 'center' });
            }, prevSelection ? 100 : 200);
          }
        });
      }
    } else {
      return;
    }
    if (
      (prevSelection?.slot === 'series' && currSelection?.slot === 'instance') &&
      (prevSelection?.keys[2] === currSelection?.keys[2]) // go from a series to its child instance
    ) {
      return;
    }
    if (
      (prevSelection?.slot === 'instance' && currSelection?.slot === 'series') &&
      (prevSelection?.keys[2] === currSelection?.keys[2]) // go from an instance to its parent series
    ) {
      return;
    }
    if (
      (prevSelection?.slot === 'instance' && currSelection?.slot === prevSelection?.slot) &&
      (prevSelection?.keys[2] === currSelection?.keys[2]) // go from an instance to another instance in the same series
    ) {
      return;
    }
    const thumbnails = [];
    switch (currSelection.slot) {
      case 'patient': {
        const patientInfo = currSelection;
        Object.entries(patientInfo.studies).forEach(([StudyInstanceUID, studyInfo]) => {
          const seriesThumbnails = [];
          Object.entries(studyInfo.series).forEach(([SeriesInstanceUID, seriesInfo]) => {
            if (seriesThumbnails.length > 0) {
              return; // pick only first series per study
            }
            const seriesInstances = [];
            Object.entries(seriesInfo.instances).forEach(([SOPInstanceUID, instanceInfo]) => {
              const instance = {
                name: instanceInfo.fileName,
                path: instanceInfo.filePath,
                n: instanceInfo.InstanceNumber,
              };
              // insert in order by InstanceNumber
              const insertIndex = seriesInstances.findIndex(i => i.n > instance.n);
              if (insertIndex === -1) {
                seriesInstances.push(instance);
              } else {
                seriesInstances.splice(insertIndex, 0, instance);
              }
            });
            const middleInstance = seriesInstances[Math.floor(seriesInstances.length / 2)];
            if (middleInstance) {
              seriesThumbnails.push({
                slot: 'study',
                keys: [...patientInfo.keys, StudyInstanceUID],
                name: studyInfo.StudyDescription || studyInfo.StudyID || 'Unknown Study',
                file: middleInstance,
              });
            }
          });
          thumbnails.push(...seriesThumbnails);
        });
        break;
      }
      case 'study': {
        const studyInfo = currSelection;
        const seriesThumbnails = [];
        Object.entries(studyInfo.series).forEach(([SeriesInstanceUID, seriesInfo]) => {
          const seriesInstances = [];
          Object.entries(seriesInfo.instances).forEach(([SOPInstanceUID, instanceInfo]) => {
            const instance = {
              name: instanceInfo.fileName,
              path: instanceInfo.filePath,
              n: instanceInfo.InstanceNumber,
            };
            // insert in order by InstanceNumber
            const insertIndex = seriesInstances.findIndex(i => i.n > instance.n);
            if (insertIndex === -1) {
              seriesInstances.push(instance);
            } else {
              seriesInstances.splice(insertIndex, 0, instance);
            }
          });
          const middleInstance = seriesInstances[Math.floor(seriesInstances.length / 2)];
          if (middleInstance) {
            seriesThumbnails.push({
              slot: 'series',
              keys: [...studyInfo.keys, SeriesInstanceUID],
              name: (seriesInfo.SeriesDescription || 'Unknown Series') + (seriesInfo.SeriesNumber ? ` #${seriesInfo.SeriesNumber}` : ''),
              file: middleInstance,
            });
          }
        });
        thumbnails.push(...seriesThumbnails);
        break;
      }
      case 'series': {
        const seriesInfo = currSelection;
        const seriesInstances = [];
        Object.entries(seriesInfo.instances).forEach(([SOPInstanceUID, instanceInfo]) => {
          const instance = {
            name: instanceInfo.fileName,
            path: instanceInfo.filePath,
            n: instanceInfo.InstanceNumber,
          };
          const thumbnail = {
            slot: 'instance',
            keys: [...seriesInfo.keys, SOPInstanceUID],
            name: instanceInfo.fileName,
            file: instance,
          }
          // insert in order by InstanceNumber
          const insertIndex = seriesInstances.findIndex(i => i.n > instance.n);
          if (insertIndex === -1) {
            seriesInstances.push(instance);
            thumbnails.push(thumbnail);
          } else {
            seriesInstances.splice(insertIndex, 0, instance);
            thumbnails.splice(insertIndex, 0, thumbnail);
          }
        });
        break;
      }
      case 'instance': {
        const seriesInfo = currSelection.parentSeries;
        const seriesInstances = [];
        Object.entries(seriesInfo.instances).forEach(([SOPInstanceUID, instanceInfo]) => {
          const instance = {
            name: instanceInfo.fileName,
            path: instanceInfo.filePath,
            n: instanceInfo.InstanceNumber,
          };
          const thumbnail = {
            slot: 'instance',
            keys: [...currSelection.keys.slice(0, -1), SOPInstanceUID],
            name: instanceInfo.fileName,
            file: instance,
          }
          // insert in order by InstanceNumber
          const insertIndex = seriesInstances.findIndex(i => i.n > instance.n);
          if (insertIndex === -1) {
            seriesInstances.push(instance);
            thumbnails.push(thumbnail);
          } else {
            seriesInstances.splice(insertIndex, 0, instance);
            thumbnails.splice(insertIndex, 0, thumbnail);
          }
        });
        break;
      }
    }
    thumbnailItems.value = thumbnails;
    return;
  }
  thumbnailItems.value = [];
}, { immediate: true });
</script>
