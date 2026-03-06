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
        :disabled="generatingDICOMDIR === item.path"
        :draggable="'true'"
        @dragstart="onDragStart($event, item, index)"
        @dragend="onDragEnd($event)"
        @keydown="handleKeyPressedItem($event, item, index)"
        @click.prevent="handleClickItem(item, index)"
        @dblclick.prevent="handleDoubleClickItem(item, index)"
        @contextmenu.prevent="handleRightClickItem($event, item)"
      >
        <template v-if="item.isDirectory">
          <UIcon v-if="generatingDICOMDIR === item.path" name="i-mdi-cog-clockwise" class="shrink-0 relative size-5 animate-spin" />
          <UIcon v-else :name="item.expanded ? 'i-mdi-folder-open-outline' : 'i-mdi-folder-outline'" class="shrink-0 relative size-5" />
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
  'folder:refresh',
  'folder:toggle',
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
    item = i === 0 ? props.roots[index] : item?.children?.[index];
  }
  return item ?? null;
};
const makePayloadForThirdpartyModule = (_item) => {
  const item = findItem(_item.indexes);
  if (item) {
    const selection = { name: _item.name, path: _item.path, isDirectory: _item.isDirectory, ...toRaw(item) };
    return { from: 'root', selection };
  } 
  return null;
};

async function handleClickItem(_item, index, expanded) {
  emit('update:selected', _item.path);
  if (_item.isDirectory) {
    if (expanded === null) {
      return;
    } else {
      emit('folder:toggle', { folderItem: findItem(_item.indexes), expanded });
    }
  }
}
function handleDoubleClickItem(_item, index) {
  if (_item.isDirectory) {
    return;
  }
  console.log(index, _item);
}

const appStore = useAppStore();
const thirdpartyModules = computed(() => appStore.thirdpartyModules);
const thirdpartyModulesContextMenus = computed(() => {
  const menus = [];
  if (thirdpartyModules.value?.length) {
    thirdpartyModules.value.forEach(({ id, contextMenus }) => {
      if (contextMenus?.length) {
        contextMenus.forEach((menu, index) => {
          if (
            menu.slots?.includes('folder') ||
            menu.slots?.includes('file')
          ) {
            menus.push({ moduleId: id, index, ...menu });
          }
        });
      }
    });
  }
  return menus;
});

const rightClickContext = shallowRef(null);
const { onContextMenu } = useContextMenu('file-explorer-item', computed(() => [
  ...thirdpartyModulesContextMenus.value.map((item, i) => {
    if (item.submenu && Array.isArray(item.submenu)) {
      return {
        label: item.label,
        submenu: item.submenu.map((subitem, j) => {
          if (subitem.slots) {
            if (rightClickContext.value?.isDirectory) {
              if (!subitem.slots.includes('folder')) {
                return false;
              }
            } else {
              if (!subitem.slots.includes('file')) {
                return false;
              }
            }
          }
          return {
            label: subitem.label,
            click: async () => {
              const payload = makePayloadForThirdpartyModule(rightClickContext.value);
              if (subitem.ui) {
                appStore.openThirdpartyModuleUI(item.moduleId, payload);
              } else {
                const res = await $electron?.clickThirdpartyModuleContextMenu(item.moduleId, [item.index, j], payload);
                console.log(res);
              }
            },
          };
        }).filter(Boolean),
      };
    } else {
      if (item.slots) {
        //
      }
      return {
        label: item.label,
        click: async () => {
          const payload = makePayloadForThirdpartyModule(rightClickContext.value);
          if (item.ui) {
            appStore.openThirdpartyModuleUI(item.moduleId, payload);
          } else {
            const res = await $electron?.clickThirdpartyModuleContextMenu(item.moduleId, [item.index], payload);
            console.log(res);
          }
        },
      };
    }
  }).filter(Boolean),

  // ...

  rightClickContext.value?.level === 1 && {
    label: 'Generate DICOMDIR…',
    click: () => {
      const rootItem = findItem(rightClickContext.value.indexes);
      if (rootItem.expanded) {
        handleClickItem(rightClickContext.value, rightClickContext.value.index);
      }
      generateRootDICOMDIR(rightClickContext.value.path).then(() => {
        if (rootItem.expanded) {
          emit('folder:refresh', { folderItem: rootItem });
        } else {
          if (rootItem.expanded === false) {
            emit('folder:refresh', { folderItem: rootItem });
          }
          handleClickItem(rightClickContext.value, rightClickContext.value.index);
        }
        setTimeout(() => {
          const item = items.value.find(item => item.level === 2 && item.name === 'DICOMDIR' && item.path.startsWith(rootItem.path));
          if (item) {
            scrollToItem(item.index);
            handleClickItem(item, item.index);
          }
        }, 100);
      });
    },
    enabled: !parsing.value,
  },
  rightClickContext.value?.level === 1 && {
    label: 'Remove',
    click: () => {
      emit('root:remove', { rootItem: findItem(rightClickContext.value.indexes) });
    },
  },
  rightClickContext.value?.isDirectory && {
    label: 'Refresh',
    click: () => {
      emit('folder:refresh', { folderItem: findItem(rightClickContext.value.indexes) });
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
  if (generatingDICOMDIR.value === _item.path) {
    return;
  }
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

function onDragStart(e, _item) {
  const payload = makePayloadForThirdpartyModule(_item);
  if (payload) {
    e.dataTransfer.setData('text', JSON.stringify(payload));
    e.effectAllowed = 'copy';
  } else {
    e.preventDefault();
  }
}
function onDragEnd(e) {
  // ...
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

const parsingStore = useParsingStore();
const parsing = computed(() => parsingStore.parsing);
const generatingDICOMDIR = ref(null);
async function generateRootDICOMDIR(rootPath) {
  if (parsing.value) {
    return;
  }
  if (generatingDICOMDIR.value) {
    return;
  }
  generatingDICOMDIR.value = rootPath;
  return parsingStore.parse([rootPath], {
    ignore: props.roots.map(root => root.path).filter(path => path !== rootPath),
    cache: true,
    refresh: true,
    DICOMDIR: true,
  }).finally(() => {
    generatingDICOMDIR.value = null;
  });
}

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
        emit('folder:refresh', { folderItem: rootItem });
      }
    }
    while (removedRoots.length > 0) {
      emit('root:remove', { rootItem: removedRoots.pop() });
    }
  }
  await new Promise(resolve => setTimeout(resolve, 1000));
  refreshing.value = false;
});
</script>
