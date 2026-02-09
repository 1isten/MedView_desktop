<template>
  <v-card tile color="background" :loading="refreshing">
    <UScrollArea
      v-slot="{ item, index }"
      :items="items"
      :virtualize="{
        estimateSize: 32,
        getItemKey: (index) => items[index].path,
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
        :class="item.path === selectedItem ? 'text-white bg-elevated! hover:bg-accented/50!' : 'hover:bg-elevated/30!'"
        :style="{ height: '32px', paddingStart: `${16 * item.level}px` }"
        :data-expanded="item.expanded ? true : null"
        @keydown="handleKeyPressedItem($event, item, index)"
        @click.prevent="handleClickItem(item, index)"
        @dblclick.prevent="handleDoubleClickItem(item, index)"
        @contextmenu.prevent="handleRightClickItem($event, item)"
      >
        <template v-if="item.isDirectory">
          <UIcon :name="item.expanded ? 'i-mdi-folder-open-outline' : 'i-mdi-folder-outline'" class="shrink-0 relative size-5" />
        </template>
        <template v-else>
          <UIcon :name="'i-mdi-file-document-outline'" class="shrink-0 relative size-5" />
        </template>
        <span class="truncate">{{ item.name + (item.isDirectory ? '/' : '') }}</span>
        <span class="ms-auto me-3 inline-flex gap-1.5 items-center" v-if="item.isDirectory">
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
    type: String,
    default: null,
  },
  refreshedAt: {
    type: Number,
    default: 0,
  },
});

const emit = defineEmits([
  'update:selected',
  'root:remove',
  'folder:toggle',
  'folder:refresh',
]);

const items = computed(() => {
  const list = [];
  (function iter(items, parentItem = null) {
    for (let index = 0; index < items.length; index++) {
      const { children, ...item } = items[index];
      item.level = parentItem ? parentItem.level + 1 : 1;
      item.indexes = parentItem ? [...parentItem.indexes, index] : [index];
      item.index = list.length;
      items[index].i = item.index;
      list.push(item);
      if (item.isDirectory && item.expanded && children?.length) {
        iter(children, item);
      }
    }
  })(props.roots);
  return list;
});
const findItem = (indexes = []) => {
  let item = null;
  for (let i = 0; i < indexes.length; i++) {
    const index = indexes[i];
    item = i === 0 ? props.roots[index] : item.children[index];
  }
  return item;
};

async function handleClickItem(_item, index, expanded) {
  emit('update:selected', _item.path);
  if (_item.isDirectory) {
    if (expanded === null) {
      return;
    } else {
      emit('folder:toggle', findItem(_item.indexes));
    }
  }
}
function handleDoubleClickItem(_item, index) {
  if (_item.isDirectory) {
    return;
  }
  console.log(index, _item);
}

const rightClickContext = shallowRef(null);
const { onContextMenu } = useContextMenu('file-explorer-item', computed(() => [
  rightClickContext.value?.level === 1 && {
    label: 'Remove',
    click: () => {
      emit('root:remove', findItem(rightClickContext.value.indexes));
    },
  },
  rightClickContext.value?.isDirectory && {
    label: 'Refresh',
    click: () => {
      emit('folder:refresh', findItem(rightClickContext.value.indexes));
    },
  },
  rightClickContext.value?.path && {
    label: 'Show in Folder',
    click: () => {
      let openFolder = false;
      // if (rightClickContext.value.isDirectory) openFolder = true;
      window.$electron?.showInFolder(rightClickContext.value.path, openFolder);
      rightClickContext.value = null;
    },
  },
]));
async function handleRightClickItem(e, _item) {
  emit('update:selected', _item.path);
  rightClickContext.value = _item;
  return onContextMenu(e);
}

function handleKeyPressedItem(e, _item, index) {
  if (!e?.key) {
    return;
  } else if (e.key === 'ArrowUp') {
    const prevItem = items.value[index - 1];
    if (prevItem) {
      const prevEl = scrollArea.value?.virtualizer?.scrollElement?.querySelector(`[data-index='${index - 1}']`)?.querySelector('a');
      if (prevEl) {
        handleClickItem(prevItem, index - 1, null);
        nextTick(() => {
          prevEl.focus();
        });
      }
    }
  } else if (e.key === 'ArrowDown') {
    const nextItem = items.value[index + 1];
    if (nextItem) {
      const nextEl = scrollArea.value?.virtualizer?.scrollElement?.querySelector(`[data-index='${index + 1}']`)?.querySelector('a');
      if (nextEl) {
        handleClickItem(nextItem, index + 1, null);
        nextTick(() => {
          nextEl.focus();
        });
      }
    }
  } else if (e.key === 'ArrowLeft') {
    if (_item.isDirectory && _item.expanded) {
      handleClickItem(_item, index);
    } else {
      const parentItem = findItem(_item.indexes.slice(0, -1));
      if (parentItem) {
        const parentEl = scrollArea.value?.virtualizer?.scrollElement?.querySelector(`[data-index='${parentItem.i}']`)?.querySelector('a');
        if (parentEl) {
          handleClickItem(parentItem, parentItem.i, null);
          nextTick(() => {
            parentEl.focus();
          });
        }
      }
    }
  } else if (e.key === 'ArrowRight') {
    if (_item.isDirectory && !_item.expanded) {
      handleClickItem(_item, index);
    }
  } else if (e.key === 'Enter') {
    if (_item.isDirectory) {
      handleClickItem(_item, index);
    } else {
      handleDoubleClickItem(_item, index);
    }
  }
  if ([
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'Enter',
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

const refreshing = ref(false);
watch(() => props.refreshedAt, async (refreshed) => {
  if (typeof $electron === 'undefined') {
    return;
  }
  if (refreshing.value) {
    return;
  }
  refreshing.value = true;
  if (refreshed) {
    let removedRoots = [];
    for (const rootItem of props.roots) {
      const access = await $electron.pathExists(rootItem.path);
      if (!access) {
        removedRoots.push(rootItem);
        continue;
      }
      if (rootItem.isDirectory) {
        emit('folder:refresh', rootItem);
      }
    }
    while (removedRoots.length > 0) {
      emit('root:remove', removedRoots.pop());
    }
  }
  await new Promise(resolve => setTimeout(resolve, 1000));
  refreshing.value = false;
});
</script>
