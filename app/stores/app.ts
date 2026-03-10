import {
  appName,
  appVersion,
  buildVersion,
  description,
  contact,
} from '../../public/branding.json';

export const useAppStore = defineStore('app', () => {
  
  const thirdpartyModules: Ref<any[]> = ref([]);
  async function getThirdpartyModules() {
    if ('$electron' in window) {
      // @ts-ignore window.$electron
      const modules = await $electron.getThirdpartyModules();
      if (modules?.length) {
        thirdpartyModules.value = [...modules];
      }
    }
    return thirdpartyModules.value;
  }
  function openThirdpartyModuleUI(moduleId: string, ...args: any[]) {
    if ('$electron' in window) {
      // @ts-ignore window.$electron
      $electron.openThirdpartyModuleUI(moduleId, ...args);
    }
  }

  // ...

  const isMouseInCoverFlow = ref(false);

  return {
    appName,
    appVersion,
    buildVersion,
    description,
    contact,

    thirdpartyModules,
    getThirdpartyModules,
    openThirdpartyModuleUI,

    // ...

    isMouseInCoverFlow,
  };
});
