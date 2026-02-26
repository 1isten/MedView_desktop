<template>
  <v-card tile color="background" :loading="parsing">
    <UScrollArea
      v-slot="{ item, index }"
      :items="items"
      :virtualize="{
        estimateSize: 32,
        getItemKey: (index) => items[index].id,
      }"
      class="w-full h-full overflow-hidden"
      ref="scrollArea"
    >
      <UButton
        external
        href="#"
        variant="link"
        color="neutral"
        class="group w-full rounded-none ring-0!"
        :class="item.id === selectedItem?.id ? 'text-white bg-elevated! hover:bg-accented/50!' : 'hover:bg-elevated/30!'"
        :style="{ height: '32px', paddingStart: `${16 * item.level}px` }"
        :data-expanded="item.expanded ? true : null"
        :disabled="item.slot === 'instance' ? (!!volviewLoading[item.id] || !!volviewLoading[item.keys[2]]) : item.slot === 'series' ? !!volviewLoading[item.id] : false"
        @keydown="handleKeyPressedItem($event, item, index)"
        @click.prevent="handleClickItem(item, index)"
        @contextmenu.prevent="handleRightClickItem($event, item)"
      >
        <UIcon :name="item.icon" class="shrink-0 relative size-5" />
        <span class="truncate">{{ item.name }}</span>
        <span class="ms-auto me-3 inline-flex gap-1.5 items-center" v-if="item.slot !== 'instance'">
          <UIcon name="i-mdi-chevron-down" class="shrink-0 transform transition-transform duration-200 group-data-expanded:rotate-180 size-5" />
        </span>
      </UButton>
    </UScrollArea>
  </v-card>
</template>

<script setup>
import { useOverlayScrollbars } from 'overlayscrollbars-vue';

const props = defineProps({
  openFrom: {
    type: Object,
    default: null,
  },
  roots: {
    type: Array,
    default: () => [],
  },
  selectedItem: {
    type: Object,
    default: null,
  },
  refreshedAt: {
    type: Number,
    default: 0,
  },
});

const emit = defineEmits([
  'update:selected',
  'userselectfiles',
  // ...
]);

const openFromPath = computed(() => props.openFrom?.path || null);
const openFromDirectory = computed(() => props.openFrom?.isDirectory || false);
const openFromHandled = ref(false);

const rootPaths = computed(() => props.roots.map(root => root.path));

const parsingStore = useParsingStore();
const { parsing, parsedData: data, parsedItems: items, parsedItemsPathMap } = storeToRefs(parsingStore);
const findItem = parsingStore.findItem;

async function handleClickItem(_item, index, expanded, suppressLoadInVolView = false) {
  const item = findItem(_item.keys);
  if (_item.slot !== 'instance') {
    item.expanded = typeof expanded === 'boolean' ? expanded : !item.expanded;
    emit('update:selected', { ..._item, ...item });    
  } else {
    const selection = { ..._item, ...item, parentSeries: findItem(_item.keys.slice(0, -1)) };
    if (!suppressLoadInVolView) {
      pendingLoadSelectionInVolView.value = selection;
    }
    emit('update:selected', selection);
  }
}

const rightClickContext = shallowRef(null);
const { onContextMenu } = useContextMenu('parsed-tree-item', computed(() => [

  // ...

  rightClickContext.value?.path && {
    label: 'Show in Folder',
    click: () => {
      window.$electron?.showInFolder(rightClickContext.value.path);
      rightClickContext.value = null;
    },
  },
]));
async function handleRightClickItem(e, _item) {
  const item = findItem(_item.keys);
  if (_item.slot !== 'instance') {
    emit('update:selected', { ..._item, ...item });    
  } else {
    const selection = { ..._item, ...item, parentSeries: findItem(_item.keys.slice(0, -1)) };
    emit('update:selected', selection);
  }
  rightClickContext.value = _item;
  return onContextMenu(e);
}

function handleKeyPressedItem(e, _item, index) {
  if (!e?.key) {
    return;
  } else if (['ArrowUp', 'ArrowLeft'].includes(e.key)) {
    const prevItem = items.value[index - 1];
    if (prevItem && prevItem.slot === 'instance' && prevItem.slot === _item.slot) {
      const prevEl = scrollArea.value?.virtualizer?.scrollElement?.querySelector(`[data-index='${index - 1}']`)?.querySelector('a');
      if (prevEl) {
        prevEl.click();
        nextTick(() => {
          prevEl.focus();
        });
      }
    }
  } else if (['ArrowDown', 'ArrowRight'].includes(e.key)) {
    const nextItem = items.value[index + 1];
    if (nextItem && nextItem.slot === 'instance' && nextItem.slot === _item.slot) {
      const nextEl = scrollArea.value?.virtualizer?.scrollElement?.querySelector(`[data-index='${index + 1}']`)?.querySelector('a');
      if (nextEl) {
        nextEl.click();
        nextTick(() => {
          nextEl.focus();
        });
      }
    }
  }
  if ([
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
  ].includes(e.key)) {
    e.preventDefault();
  }
}

const scrollArea = useTemplateRef('scrollArea');
const isScrolling = computed(() => scrollArea.value?.virtualizer?.isScrolling || false);
const scrollToItem = (index, options = { align: 'auto', behavior: 'auto' }) => !isScrolling.value && scrollArea.value?.virtualizer?.scrollToIndex(index, options);

const [osInitialize, osInstance] = useOverlayScrollbars({
  options: {
    overflow: {
      x: 'hidden',
      y: 'scroll',
    },
    scrollbars: {
      theme: 'os-theme-light',
      autoHide: 'move',
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

onActivated(() => {
  if (osInstance) {
    const scrollAreaEl = osInstance()?.elements().viewport;
    if (scrollAreaEl) {
      scrollAreaEl.scrollTop += 1;
      requestAnimationFrame(() => {
        scrollAreaEl.scrollTop -= 1;
      });
    }
  }
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

async function parse({ refresh = false } = {}) {
  const count = await parsingStore.parse(rootPaths.value, true, !!refresh);
  console.log(count, { data, items, pathToKeys: parsedItemsPathMap.value, $scrollToItem: scrollToItem });
  if (openFromPath.value && !openFromHandled.value) {
    nextTick(() => {
      const firstPatient = findItem(items.value[0]?.keys || []);
      if (firstPatient) {
        firstPatient.expanded = true;
        nextTick(() => {
          const firstStudy = findItem(items.value.find(item => item.level === 2)?.keys || []);
          if (firstStudy) {
            firstStudy.expanded = true;
            nextTick(() => {
              const firstSeries = findItem(items.value.find(item => item.level === 3)?.keys || []);
              if (firstSeries) {
                firstSeries.expanded = true;
                nextTick(() => {
                  const firstInstance = openFromDirectory.value ? findItem(items.value.find(item => item.level === 4)?.keys || []) : findItem(parsedItemsPathMap.value[openFromPath.value]?.keys || []);
                  if (firstInstance?.filePath) {
                    const selection = items.value[firstInstance.i];
                    if (selection) {
                      handleClickItem(selection, selection.index);
                    }
                  }
                });
              }
            });
          }
        });
      }
    });
    openFromHandled.value = true;
  }
}
watch(rootPaths, (currRoots, prevRoots) => {
  if (!currRoots.length || currRoots.length < prevRoots.length) {
    return;
  }
  parse();
}, { immediate: true });
watch(() => props.refreshedAt, () => {
  parse({ refresh: true });
}, { immediate: false });

// --- sync thumbnail click ---

const recentClickedThumbnail = computed(() => parsingStore.recentClickedThumbnail);
watch(recentClickedThumbnail, (thumbnailItem) => {
  if (thumbnailItem) {
    const { slot, keys } = thumbnailItem;
    const parentItem = findItem(keys.slice(0, -1));
    if (parentItem) {
      if (!parentItem.expanded) {
        parentItem.expanded = true;
      }
      nextTick(() => {
        const item = items.value.find(item => item.slot === slot && item.id === keys[keys.length - 1]);
        if (item) {
          scrollToItem(item.index);
          handleClickItem(item, item.index, true);
        }
      });
    }
  }
});

// --- VolView ---

const recentVolViewSelection = shallowRef(null);

const volviewStore = useVolViewStore();
const volviewRef = computed(() => volviewStore.volviewRef);
const { volviewMounted, volviewLoading } = storeToRefs(volviewStore);

onMounted(() => {
  window.addEventListener('message', handleVolViewEvent);
});
onUnmounted(() => {
  window.removeEventListener('message', handleVolViewEvent);
});

const appStore = useAppStore();
const { isMouseInCoverFlow } = storeToRefs(appStore);

const handleVolViewSlicing = useDebounceFn(function handleVolViewSlicing({ uid, slice }) {
  const _seriesItem = items.value.find(item => item.slot === 'series' && item.id === uid);
  const seriesItem = _seriesItem && findItem(_seriesItem.keys);
  if (seriesItem && !seriesItem.expanded) {
    seriesItem.expanded = true;
  }
  nextTick(() => {
    if (seriesItem && seriesItem.expanded) {
      const instanceIndex = seriesItem.instancesInOrder?.findIndex(({ InstanceNumber }) => InstanceNumber === slice.n);
      const instanceItem = instanceIndex !== -1 ? seriesItem.instances[seriesItem.instancesInOrder[instanceIndex].key] : null;
      const _instanceItem = instanceItem && items.value[instanceItem.i];
      if (_instanceItem) {
        scrollToItem(_instanceItem.index);
        handleClickItem(_instanceItem, _instanceItem.index, undefined, true);
      }
    }
  });
}, 150);

function handleVolViewEvent(e) {
  if (e.data === 'volview:LOAD') {
    volviewMounted.value = true;
    console.log('[volview]', 'mounted!', volviewRef.value);
    // volviewRef.value.contentWindow.postMessage(..., '*');
    return;
  }
  if (e.data?.type === 'volview:userselectfiles') {
    const payload = e.data.payload;
    emit('userselectfiles', payload?.files);
    return;
  }
  if (e.data?.type === 'volview:slicing') {
    const payload = e.data.payload;
    if (payload?.uid) {
      if (volviewLoading.value[payload.uid] === true) {
        setTimeout(() => {
          volviewLoading.value[payload.uid] = false;
        }, 150);
      }
      isMouseInCoverFlow.value = false;
      handleVolViewSlicing(payload);
    }
    return;
  }
  // ...
}

const pendingLoadSelectionInVolView = shallowRef(null);
watch(pendingLoadSelectionInVolView, () => {
  if (volviewMounted.value && pendingLoadSelectionInVolView.value) {
    loadSelectionInVolView(pendingLoadSelectionInVolView.value);
  }
}, { immediate: true });
watch(volviewMounted, () => {
  if (volviewMounted.value && pendingLoadSelectionInVolView.value) {
    loadSelectionInVolView(pendingLoadSelectionInVolView.value);
  }
}, { immediate: true });

function loadSelectionInVolView(selection) {
  if (!volviewMounted.value || !selection) {
    return;
  }
  if (recentVolViewSelection.value && recentVolViewSelection.value.id === selection.id) {
    return;
  }
  recentVolViewSelection.value = selection;
  const payload = {
    urlParams: {
      urls: [],
      names: [],
    },
    uid: '',
    n: 0,
    prefetchFiles: true,
    // layoutName: 'Axial Primary',
  };
  if (selection.slot === 'instance') {
    if (selection.isVolume) {
      payload.uid = selection.keys[3]; // SOPInstanceUID
      payload.n = selection.InstanceNumber;
      payload.urlParams.urls.push(`h3://localhost/file/${encodeURIComponent(selection.filePath)}`);
      payload.urlParams.names.push(selection.fileName);
      payload.changeLayout = false;
      payload.changeSlice = false;
    } else {
      payload.uid = selection.keys[2]; // SeriesInstanceUID
      payload.n = selection.InstanceNumber;
      selection.parentSeries.instancesInOrder?.forEach(({ key: instanceKey }, instanceIndex) => {
        const instance = selection.parentSeries.instances[instanceKey];
        payload.urlParams.urls.push(`h3://localhost/file/${encodeURIComponent(instance.filePath)}`);
        payload.urlParams.names.push(instance.fileName);
      });
    }
    if (volviewLoading.value[payload.uid] === false) {
      payload.changeLayout = false;
    }
  }
  if (selection === pendingLoadSelectionInVolView.value) {
    pendingLoadSelectionInVolView.value = null;
  }
  if (payload.uid) {
    if (volviewLoading.value[payload.uid] === undefined) {
      volviewLoading.value[payload.uid] = true;
    }
    volviewRef.value.contentWindow.postMessage({
      type: 'volview:load',
      payload,
    }, '*');
    console.log('[volview]', 'load:', payload);
  }
}
</script>
