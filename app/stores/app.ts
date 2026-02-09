import {
  appName,
  appVersion,
  buildVersion,
  description,
  contact,
} from '../../public/branding.json';

export const useAppStore = defineStore('app', () => {

  // ...

  const isMouseInCoverFlow = ref(false);

  return {
    appName,
    appVersion,
    buildVersion,
    description,
    contact,

    // ...

    isMouseInCoverFlow,
  };
});
