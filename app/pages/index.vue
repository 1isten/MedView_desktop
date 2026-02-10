<template>
  <v-layout ref="app" full-height @dragover.prevent="onDragOver" @dragleave="onDragLeave" @drop.prevent="onDrop">
    <ClientOnly>
      <v-navigation-drawer name="drawer" v-model="drawer" :location="drawerLocation" :width="drawerWidth" color="background" :style="isDrawerResizing ? 'transition: none !important;' : ''">
        <v-toolbar flat density="comfortable" class="border-b border-default" color="background">
          <v-btn slim prepend-icon="mdi-plus" class="ml-2" @click="addRoots()">
            {{ 'Add' }}
          </v-btn>
          <v-spacer></v-spacer>
          <v-btn-group density="comfortable" variant="plain" class="mr-2">
            <v-btn icon>
              <v-icon :icon="showFileExplorer ? 'mdi-file-tree' : 'mdi-database-outline'"></v-icon>
              <v-menu activator="parent">
                <v-list density="compact">
                  <v-list-item :active="!showFileExplorer" @click="showFileExplorer = false">
                    <template v-slot:prepend>
                      <v-icon icon="mdi-database-outline" class="me-n5"></v-icon>
                    </template>
                    <v-list-item-title>{{ 'Patients' }}</v-list-item-title>
                  </v-list-item>
                  <v-list-item :active="showFileExplorer" @click="showFileExplorer = true">
                    <template v-slot:prepend>
                      <v-icon icon="mdi-file-tree" class="me-n5"></v-icon>
                    </template>
                    <v-list-item-title>{{ 'Files' }}</v-list-item-title>
                  </v-list-item>
                </v-list>
              </v-menu>
            </v-btn>
            <v-btn icon="mdi-refresh" :loading="refreshingTree" @click="refreshTree"></v-btn>
          </v-btn-group>
        </v-toolbar>
        <KeepAlive>
          <component
            :is="activeTreeComponent"
            :open-from="openFrom"
            :refreshed-at="refreshedAt"
            :roots="roots"
            :selected-item="selectedTreeItem"
            @update:selected="selectedTreeItem = $event"
            @root:remove="removeRoot($event)"
            @folder:toggle="toggleFolder($event)"
            @folder:refresh="refreshFolder($event)"
            @userselectfiles="loadUserSelectedFiles"
            style="height: calc(100% - 56px - 1px)"
          />
        </KeepAlive>
      </v-navigation-drawer>
    </ClientOnly>
    <div ref="drawerResizeHandle" id="drawer-resize-handle" :class="{ 'drawer-resize-handle-disabled': !drawer }" :style="`width: ${drawerResizerWidth}px; ${drawerResizeHandleStyle}`" @dblclick="resetDrawerWidth">
      <!-- <div style="width: 2px; background-color: rgb(var(--v-theme-primary), 0.5);"></div> -->
    </div>

    <v-app-bar density="comfortable" flat color="background" class="border-b border-default" :style="isDrawerResizing ? 'transition: none !important;' : ''">
      <v-app-bar-nav-icon v-if="display?.mobile" variant="text" @click.stop="drawer = !drawer"></v-app-bar-nav-icon>
      <v-toolbar-title>{{ appName }}</v-toolbar-title>
      <v-spacer></v-spacer>
      <v-btn icon variant="plain">
        <v-icon icon="mdi-information-outline"></v-icon>
        <v-dialog activator="parent" max-width="360" transition="fade-transition">
          <template v-slot:default="{ isActive }">
            <v-card prepend-icon="$info" :title="`${appName} v${appVersion} (${buildVersion})`" :text="appDescription">
              <template v-slot:actions v-if="contactInformation">
                <v-btn variant="plain" class="ml-2 mr-auto normal-case! select-text! hover:cursor-text!">
                  {{ contactInformation }}
                </v-btn>
              </template>
            </v-card>
          </template>
        </v-dialog>
      </v-btn>
      <v-btn icon variant="text">
        <v-icon icon="mdi-dots-vertical"></v-icon>
        <v-menu activator="parent">
          <v-list density="compact">
            <v-list-item :active="showCoverFlow" @click="showCoverFlow = !showCoverFlow">
              <template v-slot:prepend>
                <v-icon :icon="showCoverFlow ? 'mdi-panorama' : 'mdi-panorama-outline'" class="me-n5"></v-icon>
              </template>
              <v-list-item-title>{{ 'Thumbnail Preview' }}</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>
      </v-btn>
    </v-app-bar>

    <v-main :style="isDrawerResizing ? 'transition: none !important; pointer-events: none;' : ''">
      <v-container fluid height="100%" class="relative overflow-hidden">
        <div class="absolute top-0 left-0 w-full h-full flex flex-col">
          <div class="flex-auto overflow-auto bg-black">
            <iframe
              v-if="volviewURL"
              :src="volviewURL"
              v-show="volviewMounted"
              ref="volviewRef"
              frameborder="0"
              width="100%"
              height="100%"
            ></iframe>
          </div>
          <CoverFlow
            v-if="showCoverFlow"
            :selected-data-item="showFileExplorer ? null : selectedDataItem"
          />
        </div>
      </v-container>
    </v-main>
  </v-layout>
</template>

<script setup>
import CoverFlow from '~/components/CoverFlow.vue';
import { TreeFiles, TreePatients } from '#components';

definePageMeta({
  title: 'appName',
  colorMode: 'dark',
});

const appStore = useAppStore();
const { appName, appVersion, buildVersion, description: appDescription, contact: contactInformation } = appStore;

const app = ref(null);
const display = computed(() => app.value?.$vuetify.display);
const displayWidth = computed(() => display.value?.width || 0);

const drawer = ref();
const drawerLocation = ['left', 'right'][0];
const drawerWidthMin = 256;
const drawerWidthMax = 700;
const drawerWidth = useLocalStorage('app-drawer-width', drawerWidthMin);
const drawerResizerWidth = 8;
const drawerResizerInitialX = computed(() => {
  if (drawerLocation === 'left') {
    return drawerWidthMin - (drawerResizerWidth / 2);
  } else if (drawerLocation === 'right') {
    return displayWidth.value - drawerWidthMin - (drawerResizerWidth / 2);
  }
});
const drawerResizerFinalX = computed(() => {
  if (drawerLocation === 'left') {
    return drawerWidthMax - (drawerResizerWidth / 2);
  } else if (drawerLocation === 'right') {
    return displayWidth.value - drawerWidthMax - (drawerResizerWidth / 2)
  }
});
const drawerResizeHandle = useTemplateRef('drawerResizeHandle');
const { x: drawerResizeHandleX, style: drawerResizeHandleStyle, isDragging: isDrawerResizing } = useDraggable(drawerResizeHandle, {
  axis: 'x',
  initialValue: { x: drawerResizerInitialX.value, y: 0 },
  preventDefault: true,
});
watchDebounced(drawerResizeHandleX, (x) => {
  if (drawerLocation === 'left') {
    if (x < drawerResizerInitialX.value) {
      drawerResizeHandleX.value = drawerResizerInitialX.value;
    } else if (x > drawerResizerFinalX.value) {
      drawerResizeHandleX.value = drawerResizerFinalX.value;
    }
    drawerWidth.value = Math.round(drawerResizeHandleX.value + (drawerResizerWidth / 2));
  } else if (drawerLocation === 'right') {
    if (x > drawerResizerInitialX.value) {
      drawerResizeHandleX.value = drawerResizerInitialX.value;
    } else if (x < drawerResizerFinalX.value) {
      drawerResizeHandleX.value = drawerResizerFinalX.value;
    }
    drawerWidth.value = Math.round(displayWidth.value - drawerResizeHandleX.value - (drawerResizerWidth / 2));
  }
});
watch(displayWidth, (dw) => {
  if (dw > 0) {
    if (drawerLocation === 'left') {
      drawerResizeHandleX.value = drawerWidth.value - (drawerResizerWidth / 2);
    } else if (drawerLocation === 'right') {
      drawerResizeHandleX.value = dw - drawerWidth.value - (drawerResizerWidth / 2);
    }
  }
}, {
  immediate: true,
  once: false,
});
function resetDrawerWidth() {
  drawerWidth.value = drawerWidthMin;
  drawerResizeHandleX.value = drawerResizerInitialX.value;
}

const showCoverFlow = ref(true);

const showFileExplorer = ref(false);
const activeTreeComponent = computed(() => showFileExplorer.value ? TreeFiles : TreePatients);

const roots = ref([]);
const selectedFileOrFolderPath = ref(null);
const selectedDataId = ref(null);
const selectedDataItem = ref(null);
const selectedTreeItem = computed({
  get() {
    return showFileExplorer.value ? selectedFileOrFolderPath.value : selectedDataItem.value;
  },
  set(selection) {
    if (showFileExplorer.value) {
      selectedFileOrFolderPath.value = selection || null;
    } else {
      selectedDataItem.value = selection || null;
      selectedDataId.value = selectedDataItem.value?.id || null;
    }
  },
});

async function addRoots(fullPaths = []) {
  if (typeof $electron === 'undefined') {
    return;
  }
  if (fullPaths.length === 0) {
    const { canceled, filePaths } = await $electron.showOpenDialog({
      properties: ['openFile', 'openDirectory', 'multiSelections'],
    });
    if (!canceled && filePaths?.length > 0) {
      fullPaths = filePaths;
    }
  }
  if (fullPaths.length === 0) {
    return;
  }
  const [folders, files] = await $electron.readDirs(fullPaths);
  [...folders, ...files].forEach((item) => {
    let sameRoot = null;
    let parentRoot = null;
    let childRoots = [];
    roots.value.forEach((root) => {
      if (item.path === root.path) {
        sameRoot = root;
      } else if (item.path.startsWith(root.path + '/')) {
        parentRoot = root;
      } else if (root.path.startsWith(item.path + '/')) {
        childRoots.push(root);
      }
    });
    if (sameRoot) {
      return;
    }
    if (parentRoot) {
      return;
    }
    while (childRoots.length > 0) {
      removeRoot(childRoots.pop());
    }
    roots.value.push(item);
  });
}
function removeRoot(rootItem) {
  const rootIndex = roots.value.findIndex(item => item.path === rootItem.path);
  if (rootIndex !== -1) {
    roots.value.splice(rootIndex, 1);
    selectedFileOrFolderPath.value = null;
  }
}

async function toggleFolder(folderItem, expanded) {
  if (typeof $electron === 'undefined') {
    return;
  }
  const item = folderItem;
  if (item?.isDirectory) {
    item.expanded = typeof expanded === 'boolean' ? expanded : !item.expanded;
    if (item.expanded && !item.children?.length) {
      const [folders, files] = await $electron.readDirectory(item.path);
      item.children = [
        ...folders,
        ...files,
      ];
    }
  }
}
function refreshFolder(folderItem) {
  folderItem.children = [];
  toggleFolder(folderItem, folderItem.expanded ? true : false);
}

const refreshedAt = ref(0);
const refreshingTree = ref(false);
async function refreshTree() {
  if (refreshingTree.value) {
    return;
  }
  selectedTreeItem.value = null;
  // refreshingTree.value = true;
  refreshedAt.value = Date.now();
  nextTick(() => {
    refreshedAt.value = 0;
    // refreshingTree.value = false;
  })
}

// ...

const openFrom = ref(null);
onMounted(async () => {
  if (typeof $electron === 'undefined') {
    return;
  }
  volviewURL.value = await $electron.getVolViewURL();
  openFrom.value = await $electron.handleOpenFromPath();
  if (openFrom.value?.path) {
    await addRoots([openFrom.value.path]);
    selectedFileOrFolderPath.value = openFrom.value.path;
    if (openFrom.value.isDirectory) {
      nextTick(() => {
        const rootItem = roots.value.find(root => root.path === openFrom.value.path);
        if (rootItem) {
          toggleFolder(rootItem, true);
        }
      });
    }
  }
});

let dragTimeout = null;
const dragHover = ref(false);
function onDragOver(e) {
  dragHover.value = true;
  if (dragTimeout !== null) {
    clearTimeout(dragTimeout);
    dragTimeout = null;
  }
}
function onDragLeave() {
  dragTimeout = setTimeout(() => {
    dragHover.value = false;
    dragTimeout = null;
  }, 50);
}
async function onDrop(e, files) {
  const items = Array.isArray(files) && files.length > 0 ? files : e?.dataTransfer?.files;
  if (items?.length) {
    let fullPaths = await Promise.all([...items].map(file => getPathForFile(file)));
    if (fullPaths?.length > 0) {
      fullPaths = fullPaths.filter(Boolean);
    }
    if (fullPaths?.length > 0) {
      return addRoots(fullPaths);
    }
  }
}

function loadUserSelectedFiles(files) {
  if (files?.length) {
    return onDrop(null, files);
  }
  addRoots();
}

// --- VolView ---

const volviewStore = useVolViewStore();
const { volviewRef, volviewURL } = storeToRefs(volviewStore);
const volviewMounted = computed(() => volviewStore.volviewMounted);

// ...
</script>

<style scoped>
#drawer-resize-handle {
  position: fixed;
  z-index: 1005;
  right: 0;
  top: 0;
  bottom: 0;
  display: flex;
  justify-content: center;
  cursor: ew-resize;
}
#drawer-resize-handle.drawer-resize-handle-disabled {
  display: none !important;
  cursor: default !important;
  pointer-events: none !important;
}
</style>
