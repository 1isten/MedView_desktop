export const useParsingStore = defineStore('parsing', () => {

  const parsing = ref(false);

  // nested tree structure
  const parsedData = ref({
    patients: {
      // ...
    },
  }) as Ref<Record<string, any>>;

  // flattened list
  const parsedItems = computed(() => {
    const list: any[] = [];
    if (parsing.value) {
      return list;
    }
    Object.entries(parsedData.value.patients).forEach(([patientDescription, patientInfo]: [string, any]) => {
      const patient = {
        slot: 'patient',
        level: 1,
        index: -1,
        id: patientDescription,
        keys: [patientDescription],
        name: patientDescription,
        icon: 'i-lucide-user',
        expanded: patientInfo.expanded,
      };
      patient.index = list.length;
      parsedData.value.patients[patient.id].i = patient.index;
      list.push(patient);
      if (patient.expanded) {
        Object.entries(patientInfo.studies).forEach(([StudyInstanceUID, studyInfo]: [string, any]) => {
          const study = {
            slot: 'study',
            level: 2,
            index: -1,
            id: StudyInstanceUID,
            keys: [...patient.keys, StudyInstanceUID],
            name: studyInfo.StudyDescription || studyInfo.StudyID || 'Unknown Study',
            icon: 'i-lucide-book-user',
            expanded: studyInfo.expanded,
          };
          study.index = list.length;
          patientInfo.studies[study.id].i = study.index;
          list.push(study);
          if (study.expanded) {
            Object.entries(studyInfo.series).forEach(([SeriesInstanceUID, seriesInfo]: [string, any]) => {
              const series = {
                slot: 'series',
                level: 3,
                index: -1,
                id: SeriesInstanceUID,
                keys: [...study.keys, SeriesInstanceUID],
                name: (seriesInfo.SeriesDescription || 'Unknown Series') + (seriesInfo.SeriesNumber ? ` #${seriesInfo.SeriesNumber}` : ''),
                n: seriesInfo.SeriesNumber,
                icon: 'i-lucide-list-tree',
                expanded: seriesInfo.expanded,
              };
              series.index = list.length;
              studyInfo.series[series.id].i = series.index;
              list.push(series);
              if (series.expanded) {
                const seriesInstances: any[] = [];
                Object.entries(seriesInfo.instances).forEach(([SOPInstanceUID, instanceInfo]: [string, any]) => {
                  const instance = {
                    slot: 'instance',
                    level: 4,
                    index: -1,
                    id: SOPInstanceUID,
                    keys: [...series.keys, SOPInstanceUID],
                    name: instanceInfo.fileName,
                    path: instanceInfo.filePath,
                    n: instanceInfo.InstanceNumber,
                    icon: 'i-lucide-file-text',
                  };
                  // insert in order by InstanceNumber
                  const insertIndex = seriesInstances.findIndex(i => i.n > instance.n);
                  if (insertIndex === -1) {
                    seriesInstances.push(instance);
                  } else {
                    seriesInstances.splice(insertIndex, 0, instance);
                  }
                });
                seriesInstances.forEach((instance) => {
                  instance.index = list.length;
                  seriesInfo.instances[instance.id].i = instance.index;
                  list.push(instance);
                  parsedItemsPathMap.value[instance.path] = {
                    index: instance.index,
                    keys: instance.keys,
                  };
                });
              }
            });
          }
        });
      }
    });
    return list;
  });
  const parsedItemsPathMap = shallowRef({}) as Ref<Record<string, any>>;

  const recentClickedThumbnail = ref(null) as Ref<null | Partial<{
    slot: 'study' | 'series' | 'instance';
    keys: string[];
    name: string;
    file: any;
  }>>;

  return {
    parsing,
    parsedData,
    parsedItems,
    parsedItemsPathMap,
    findItem: (keys = []) => {
      let item = null;
      const [patientKey, studyKey, seriesKey, instanceKey] = keys;
      if (patientKey) {
        item = parsedData.value.patients[patientKey];
        if (studyKey) {
          item = item.studies[studyKey];
          if (seriesKey) {
            item = item.series[seriesKey];
            if (instanceKey) {
              item = item.instances[instanceKey];
            }
          }
        }
      }
      return item;
    },

    recentClickedThumbnail,
  };
});
