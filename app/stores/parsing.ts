import { decodeMultiStream } from '@msgpack/msgpack';

export const useParsingStore = defineStore('parsing', () => {

  const parsing = ref(false);

  // nested tree structure
  const parsedData = ref({
    patients: {
      // ...
    },
  }) as Ref<Record<string, any>>;

  async function parse(rootPaths: string[], deep = true, cache = true, refresh = false) {
    if (parsing.value) {
      return 0;
    }
    parsedItemsPathMap.value = {};
    if (rootPaths.length > 0) {
      Object.keys(parsedData.value.patients).forEach((patientKey) => {
        const patientItem = parsedData.value.patients[patientKey];
        if (!rootPaths.includes(patientItem.root)) {
          delete parsedData.value.patients[patientKey];
          const patientIndex = parsedData.value.patientsInOrder?.findIndex((item: any) => item.key === patientKey) ?? -1;
          if (patientIndex !== -1) {
            parsedData.value.patientsInOrder?.splice(patientIndex, 1);
          }
        }
      });
    } else {
      parsedData.value.patients = {};
      parsedData.value.patientsInOrder = [];
      return 0;
    }
    console.time('[done parsing]');
    parsing.value = true;
    const stream: any = await $fetch('h3://localhost/api/parse', {
      method: 'POST',
      body: {
        rootPaths,
        deep,
        cache,
        refresh,
      },
      responseType: 'stream',
    });
    let count = 0;
    for await (const chunk of decodeMultiStream(stream) as AsyncIterable<any>) {
      if (chunk?.type === 'DICOMDIR') {
        // console.log('is DICOMDIR:', chunk);
        continue;
      }
      if (chunk?.type === 'application/dicom') {
        const { name: fileName, path: filePath, root: rootPath } = chunk;
        const {
          MediaStorageSOPClassUID,
          MediaStorageSOPInstanceUID,
          TransferSyntaxUID,

          // ...

          PatientName,
          PatientID,

          StudyInstanceUID,
          StudyDescription,
          StudyID,
          StudyDate,
          StudyTime,
          AccessionNumber,

          SeriesInstanceUID,
          SeriesDescription,
          Modality,
          SeriesNumber,

          SOPInstanceUID,
          SOPClassUID,
          ReferencedSOPClassUIDInFile,
          ReferencedSOPInstanceUIDInFile,
          ReferencedTransferSyntaxUIDInFile,
          InstanceNumber,
        } = chunk.tags;

        if (SOPInstanceUID && SeriesInstanceUID && StudyInstanceUID) {
          const PatientDescription = PatientName || PatientID || 'Anonymous';
          if (!parsedData.value.patients[PatientDescription]) {
            parsedData.value.patients[PatientDescription] = {
              root: rootPath,
              PatientName,
              PatientID,
              studies: {},
            };
            if (!parsedData.value.patientsInOrder) {
              parsedData.value.patientsInOrder = [] as any[];
            }
            const patientIndex = parsedData.value.patientsInOrder.findIndex((item: any) => {
              if (item.PatientDescription && PatientDescription) {
                return item.PatientDescription.localeCompare(PatientDescription) > 0;
              }
              return false;
            });
            parsedData.value.patientsInOrder.splice((patientIndex !== -1 ? patientIndex : parsedData.value.patientsInOrder.length), 0, {
              key: PatientDescription,
              PatientDescription,
            });
          }
          const patient = parsedData.value.patients[PatientDescription];
          if (!patient.studies[StudyInstanceUID]) {
            patient.studies[StudyInstanceUID] = {
              StudyDescription,
              StudyID,
              StudyDate,
              StudyTime,
              AccessionNumber,
              series: {},
            };
            if (!patient.studiesInOrder) {
              patient.studiesInOrder = [] as any[];
            }
            const studyIndex = patient.studiesInOrder.findIndex((item: any) => {
              if (item.StudyDate && StudyDate) {
                if (item.StudyTime && StudyTime) {
                  return Number(`${StudyDate}${StudyTime}`) - Number(`${item.StudyDate}${item.StudyTime}`) > 0;
                }
                return Number(StudyDate) - Number(item.StudyDate) > 0;
              }
              if (item.StudyDescription && StudyDescription) {
                return item.StudyDescription.localeCompare(StudyDescription) > 0;
              }
              if (item.StudyID && StudyID) {
                return item.StudyID.localeCompare(StudyID) > 0;
              }
              return false;
            });
            patient.studiesInOrder.splice((studyIndex !== -1 ? studyIndex : patient.studiesInOrder.length), 0, {
              key: StudyInstanceUID,
              StudyDescription,
              StudyID,
              StudyDate,
              StudyTime,
            });
          }
          patient.expanded = false;
          const study = patient.studies[StudyInstanceUID];
          if (!study.series[SeriesInstanceUID]) {
            study.series[SeriesInstanceUID] = {
              SeriesDescription,
              Modality,
              SeriesNumber,
              instances: {},
            };
            if (!study.seriesInOrder) {
              study.seriesInOrder = [] as any[];
            }
            const seriesIndex = study.seriesInOrder.findIndex((item: any) => {
              if (item.SeriesNumber !== undefined && SeriesNumber !== undefined) {
                return item.SeriesNumber - SeriesNumber > 0;
              }
              return false;
            });
            study.seriesInOrder.splice((seriesIndex !== -1 ? seriesIndex : study.seriesInOrder.length), 0, {
              key: SeriesInstanceUID,
              SeriesNumber,
            });
          }
          study.expanded = false;
          const series = study.series[SeriesInstanceUID];
          if (!series.instances[SOPInstanceUID]) {
            series.instances[SOPInstanceUID] = {
              InstanceNumber,
              fileName,
              filePath,
              isVolume: !!chunk.isVolume,
              ...(chunk.key ? { cacheKey: chunk.key } : {}),
            };
            if (!series.instancesInOrder) {
              series.instancesInOrder = [] as any[];
            }
            const instanceIndex = series.instancesInOrder.findIndex((item: any) => {
              if (item.InstanceNumber !== undefined && InstanceNumber !== undefined) {
                return item.InstanceNumber - InstanceNumber > 0;
              }
              return false;
            });
            series.instancesInOrder.splice((instanceIndex !== -1 ? instanceIndex : series.instancesInOrder.length), 0, {
              key: SOPInstanceUID,
              InstanceNumber,
            });
          }
          series.expanded = false;
        }
      }
      ++count;
    }
    console.timeEnd('[done parsing]');
    parsing.value = false;
    return count;
  }

  // flattened list
  const parsedItems = computed(() => {
    const list: any[] = [];
    if (parsing.value) {
      return list;
    }
    parsedData.value.patientsInOrder?.forEach(({ key: patientKey }: any, patientIndex: number) => {
      const PatientDescription = patientKey as string;
      const patientInfo = parsedData.value.patients[PatientDescription] as any;
      if (!patientInfo) {
        return;
      }
      const patient = {
        slot: 'patient',
        level: 1,
        index: -1,
        id: PatientDescription,
        keys: [PatientDescription],
        name: PatientDescription,
        icon: 'i-lucide-user',
        expanded: patientInfo.expanded,
      };
      patient.index = list.length;
      parsedData.value.patients[patient.id].i = patient.index;
      list.push(patient);
      if (patient.expanded) {
        patientInfo.studiesInOrder?.forEach(({ key: studyKey }: any, studyIndex: number) => {
          const StudyInstanceUID = studyKey as string;
          const studyInfo = patientInfo.studies[StudyInstanceUID] as any;
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
            studyInfo.seriesInOrder?.forEach(({ key: seriesKey }: any, seriesIndex: number) => {
              const SeriesInstanceUID = seriesKey as string;
              const seriesInfo = studyInfo.series[SeriesInstanceUID] as any;
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
                seriesInfo.instancesInOrder?.forEach(({ key: instanceKey }: any, instanceIndex: number) => {
                  const SOPInstanceUID = instanceKey as string;
                  const instanceInfo = seriesInfo.instances[SOPInstanceUID] as any;
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
    parse,
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
          item = item?.studies?.[studyKey];
          if (seriesKey) {
            item = item?.series?.[seriesKey];
            if (instanceKey) {
              item = item?.instances?.[instanceKey];
            }
          }
        }
      }
      return item ?? null;
    },

    recentClickedThumbnail,
  };
});
