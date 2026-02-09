export const useVolViewStore = defineStore('volview', () => {
  const volviewRef = ref('volviewRef');
  const volviewURL = ref(null);
  const volviewMounted = ref(false);

  return {
    volviewRef,
    volviewURL,
    volviewMounted,
  };
});
