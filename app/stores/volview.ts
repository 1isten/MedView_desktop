export const useVolViewStore = defineStore('volview', () => {
  const volviewRef = ref('volviewRef');
  const volviewURL = ref(null);
  const volviewMounted = ref(false);

  const volviewLoading = ref({});

  const canOpenWithVolView = (fileName: string) => {
    if (fileName === 'DICOMDIR') {
      return false;
    }
    const name = fileName.toLowerCase();
    if (
      !name.includes('.') ||
      name.endsWith('.dcm') ||
      name.endsWith('.nii') || name.endsWith('.nii.gz') ||
      name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.tif') || name.endsWith('.tiff') || name.endsWith('.bmp') ||
      name.endsWith('.zip') // ...
    ) {
      return true;
    }
    return false;
  }
  async function openWithVolView(filePath: string, fileName?: string) {
    if (fileName && !canOpenWithVolView(fileName)) {
      return;
    }
    if ('$electron' in window) {
      // @ts-ignore window.$electron
      return $electron.openWithVolView(filePath, fileName);
    }
  }

  return {
    volviewRef,
    volviewURL,
    volviewMounted,
    volviewLoading,

    canOpenWithVolView,
    openWithVolView,
  };
});
