import { appName } from '../public/branding.json';

export default defineI18nConfig(() => {
  return {
    messages: {
      en: {
        appName,
      },
    },
  };
});
