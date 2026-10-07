'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as XLSX from 'xlsx';
import { useEffect, useState } from 'react';
import { useIncurredTableStore } from '@/stores/useIncurredTableStore';
import { useTrainDevideStoreIncurred } from '@/stores/useTrainDevideStoreIncurred';
import { useTrainDevideStoreDet } from '@/stores/trainDevideStoreDeterministyczny';
import { useTrainDevideStoreSummary } from '@/stores/trainDevideStoreSummary';
import { useDeterministicIncurredResultsStore } from '@/stores/deterministicIncurredResultsStore';
import { useSimulationResultsStore } from '@/stores/simulationResultsStore';
import { useCLSimulationStore } from '@/stores/clSimulationStore';
import { useLabelsStore } from '@/stores/useLabelsStore';
import { useInflacjaStore } from '@/stores/inflacjaStore';
import { inflationApiService } from '@/services/inflationApi';
import { useUserStore } from '@/app/_components/useUserStore';
import { z } from 'zod';
import { SheetSelectIncurred } from '@/components/SheetSelectIncurred';
import { HeadersSelector } from '@/components/HeadersSelector';
import { DataTypeSelector } from '@/components/DataTypeSelector';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

import type { DataType } from '@/components/DataTypeSelector';
import { convertIncrementalToCumulative } from '@/utils/dataConversion';
import { validateDataValues, ValidationPresets } from '@/utils/dataValidation';
import Modal from '@/components/Modal';
import { getApiBaseUrl } from '@/lib/apiBaseUrl';
import { 
  parsePolishNumber, 
  isMostlyNonNumeric, 
  looksLikeYears, 
  looksLikeDevPeriods,
  DataInputDialogs,
  DataInputLoading,
  FileUploadSection,
} from '@/shared/components/data-input';

const schema = z.object({
  rowStart: z.coerce.number().min(1),
  rowEnd: z.coerce.number().min(1),
  colStart: z.coerce.number().min(1),
  colEnd: z.coerce.number().min(1),
  file: z.any(),
});
type FormField = z.infer<typeof schema>;
type DataFormatMode = 'triangle' | 'list';

type ListColumnsDetection = {
  headerRowIndex: number;
  lobIndex: number;
  ayIndex: number;
  dyIndex: number;
  amountIndex: number;
};

function detectListColumns(
  rawData: unknown[][],
  amountCandidates: string[],
): ListColumnsDetection | null {
  const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase();

  const findColumn = (headerRow: string[], candidates: string[]) => {
    for (const candidate of candidates) {
      const exactMatch = headerRow.findIndex((header) => header === candidate);
      if (exactMatch >= 0) {
        return exactMatch;
      }
    }

    for (const candidate of candidates) {
      const partialMatch = headerRow.findIndex((header) =>
        header.includes(candidate),
      );
      if (partialMatch >= 0) {
        return partialMatch;
      }
    }

    return -1;
  };

  for (let rowIndex = 0; rowIndex < rawData.length; rowIndex += 1) {
    const headerRow = (rawData[rowIndex] ?? []).map((cell) => normalize(cell));

    const lobIndex = findColumn(headerRow, ['lob']);
    const ayIndex = findColumn(headerRow, ['ay', 'accident year', 'origin year', 'rok szkody']);
    const dyIndex = findColumn(headerRow, ['dy', 'development year', 'development period', 'okres rozwoju']);
    const amountIndex = findColumn(headerRow, amountCandidates);

    if (lobIndex >= 0 && ayIndex >= 0 && dyIndex >= 0 && amountIndex >= 0) {
      return {
        headerRowIndex: rowIndex,
        lobIndex,
        ayIndex,
        dyIndex,
        amountIndex,
      };
    }
  }

  return null;
}

const DETERMINISTIC_INCURRED_TAB_STORAGE_KEY = 'deterministic-incurred-results-storage';
const INCURRED_INPUT_UI_STATE_KEY = 'deterministic-incurred-input-ui-state';
const STOCHASTIC_INCURRED_RESULTS_STORAGE_KEY = 'simulation-results-storage';
const STOCHASTIC_INCURRED_STATS_STORAGE_KEY = 'cl-simulation-store';

/* ---------- DODATKOWA WALIDACJA (dziury, nienumeryczne itd.) ---------- */
function localValidateDataValues(data: any[][]): boolean {
  // Ta funkcja została przeniesiona do @/utils/dataValidation
  // Używamy teraz importowanej wersji z ValidationPresets dla Incurred
  const result = validateDataValues(data, ValidationPresets.paid()); // Używamy paid bo nie ma incurred preset
  return result.isValid;
}

/* --------------------------------------------------------------------- */
export function InputDataTabIncurred() {
  /* ---------- Lokalny UI‑owy stan ---------- */
  const [showDialog, setShowDialog] = useState(false);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [showNoChangesDialog, setShowNoChangesDialog] = useState(false);
  const [showWarningDialog, setShowWarningDialog] = useState(false);
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [pendingFormData, setPendingFormData] = useState<FormField | null>(null);
  const [showInflationErrorModal, setShowInflationErrorModal] = useState(false);
  const [showInflationSuccessModal, setShowInflationSuccessModal] = useState(false);
  const [inflationErrorMessage, setInflationErrorMessage] = useState('');
  const [isUiStateHydrated, setIsUiStateHydrated] = useState(false);
  const [dataFormatMode, setDataFormatMode] = useState<DataFormatMode>('triangle');
  const [availableLobs, setAvailableLobs] = useState<string[]>([]);
  const [selectedLob, setSelectedLob] = useState('');
  const [isLobLoaded, setIsLobLoaded] = useState(false);
  const [lobLoadSignature, setLobLoadSignature] = useState('');
  const [isRangeStateHydrated, setIsRangeStateHydrated] = useState(false);

  /* ---------- Zustanda – store „incurred" ---------- */
  const {
    workbook,
    isValid,
    selectedSheetJSON,
    previousSheetJSON,
    validationErrorReason,
    setWorkbook,
    getDefaultRange,
    setRangeAndUpdate,
    uploadedFileName,
    setUploadedFileName,
    selectedSheetName,
    lastApprovedSettings,
    setLastApprovedSettings,
  } = useIncurredTableStore();

  const { 
    incurredRowLabels: rowLabels, 
    incurredColumnLabels: columnLabels, 
    setIncurredRowLabels: setRowLabels, 
    setIncurredColumnLabels: setColumnLabels,
    detRowLabels: paidRowLabels,
    detColumnLabels: paidColumnLabels,
    globalRowLabels,
    globalColumnLabels,
    lastLoadedFile
  } = useLabelsStore();

  // Store Incurred dla funkcji czyszczących
  const incurredStore = useTrainDevideStoreIncurred();
  const summaryStore = useTrainDevideStoreSummary();

  // 🆕 Store Paid dla dostępu do danych paid bez inflacji
  const paidStore = useTrainDevideStoreDet();

  const setIncurredTriangle = useTrainDevideStoreIncurred((s) => s.setIncurredTriangle);
  const setIncurredTriangle_bez_inf = useTrainDevideStoreIncurred((s) => s.setIncurredTriangle_bez_inf);
  const incurredTriangle_bez_inf = useTrainDevideStoreIncurred((s) => s.incurredTriangle_bez_inf);
  const setReserve = useTrainDevideStoreIncurred((s) => s.setReserve);

  // Store dla ustawień input'a - używamy indywidualnych ustawień z incurredTableStore
  const {
    dataType,
    setDataType,
    incrementDataGeneration,
    hasHeaders,
    setHasHeaders,
    useInflation,
    setUseInflation,
  } = useIncurredTableStore();

  // Store inflacji - do sprawdzania czy są dane
  const { inflacjaTriangle, selectedInflacjaLine, availableInflacjaLines } = useInflacjaStore();

  // User ID dla API
  const userId = useUserStore((s) => s.userId);

  /* ---------- React‑hook‑form ---------- */
  const {
    register,
    handleSubmit,
    watch,
    setValue,
  } = useForm<FormField>({
    resolver: zodResolver(schema),
    defaultValues: {
      rowStart: 1,
      rowEnd: 1,
      colStart: 1,
      colEnd: 1,
    },
  });

  const file = watch('file');
  const rowStartValue = watch('rowStart');
  const rowEndValue = watch('rowEnd');
  const colStartValue = watch('colStart');
  const colEndValue = watch('colEnd');

  const currentLobSignature = [
    uploadedFileName ?? '',
    selectedSheetName ?? '',
    String(rowStartValue ?? ''),
    String(rowEndValue ?? ''),
    String(colStartValue ?? ''),
    String(colEndValue ?? ''),
  ].join('|');

  useEffect(() => {
    if (typeof window === 'undefined') {
      setIsUiStateHydrated(true);
      return;
    }

    try {
      const rawState = window.sessionStorage.getItem(INCURRED_INPUT_UI_STATE_KEY);
      if (rawState) {
        const parsedState = JSON.parse(rawState) as {
          hasHeaders?: boolean;
          dataType?: DataType;
          useInflation?: boolean;
          dataFormatMode?: DataFormatMode;
          availableLobs?: string[];
          selectedLob?: string;
          isLobLoaded?: boolean;
          lobLoadSignature?: string;
        };

        if (typeof parsedState.hasHeaders === 'boolean') {
          setHasHeaders(parsedState.hasHeaders);
        }
        if (parsedState.dataType === 'cumulative' || parsedState.dataType === 'incremental') {
          setDataType(parsedState.dataType);
        }
        if (typeof parsedState.useInflation === 'boolean') {
          setUseInflation(parsedState.useInflation);
        }
        if (parsedState.dataFormatMode) {
          setDataFormatMode(parsedState.dataFormatMode);
        }
        setAvailableLobs(parsedState.availableLobs ?? []);
        setSelectedLob(parsedState.selectedLob ?? '');
        setIsLobLoaded(Boolean(parsedState.isLobLoaded));
        setLobLoadSignature(parsedState.lobLoadSignature ?? '');
      }
    } catch {
      // Ignore invalid persisted state and continue with defaults.
    }

    setIsUiStateHydrated(true);
  }, [setDataType, setHasHeaders, setUseInflation]);

  useEffect(() => {
    if (!isUiStateHydrated || typeof window === 'undefined') {
      return;
    }

    window.sessionStorage.setItem(
      INCURRED_INPUT_UI_STATE_KEY,
      JSON.stringify({
        hasHeaders,
        dataType,
        useInflation,
        dataFormatMode,
        availableLobs,
        selectedLob,
        isLobLoaded,
        lobLoadSignature,
      }),
    );
  }, [
    isUiStateHydrated,
    hasHeaders,
    dataType,
    useInflation,
    dataFormatMode,
    availableLobs,
    selectedLob,
    isLobLoaded,
    lobLoadSignature,
  ]);

  useEffect(() => {
    if (!isUiStateHydrated || !isRangeStateHydrated) {
      return;
    }

    if (dataFormatMode !== 'list') {
      setAvailableLobs([]);
      setSelectedLob('');
      setIsLobLoaded(false);
      setLobLoadSignature('');
      return;
    }

    if (isLobLoaded && lobLoadSignature !== currentLobSignature) {
      setAvailableLobs([]);
      setSelectedLob('');
      setIsLobLoaded(false);
      setLobLoadSignature('');
    }
  }, [
    isUiStateHydrated,
    isRangeStateHydrated,
    dataFormatMode,
    isLobLoaded,
    lobLoadSignature,
    currentLobSignature,
  ]);

  const clearDeterministicIncurredCalculations = () => {
    console.log('🧹 Czyszczę wszystkie dotychczasowe obliczenia (Incurred deterministic)...');

    // Wyczyść cache zakładki "Obliczenia deterministyczne -> Incurred"
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(DETERMINISTIC_INCURRED_TAB_STORAGE_KEY);
      window.sessionStorage.removeItem(STOCHASTIC_INCURRED_RESULTS_STORAGE_KEY);
      window.sessionStorage.removeItem(STOCHASTIC_INCURRED_STATS_STORAGE_KEY);
    }

    // Wyczyść też stan runtime tej zakładki (na wypadek aktywnej sesji bez przeładowania)
    useDeterministicIncurredResultsStore.getState().clearResults();
    useSimulationResultsStore.getState().clearResults();
    useCLSimulationStore.getState().clearStatisticsResults();

    // Dane wejściowe i pochodne
    incurredStore.setIncurredTriangle([]);
    incurredStore.setIncurredTriangle_bez_inf(null);
    incurredStore.setReserve(null);
    incurredStore.setTrainDevideIncurred(undefined);

    // Wyniki CL/Sigma/SD
    incurredStore.clearCurrentCoefficientResults();
    incurredStore.clearDevJResults();
    incurredStore.clearSigmaResults();
    incurredStore.setDevJ([]);
    incurredStore.setSigma([]);
    incurredStore.setSd([]);
    incurredStore.setFinalDevJ(undefined);
    incurredStore.setFinalSigma(undefined);
    incurredStore.clearAllDevFinalValues();

    // FitCurve + podsumowania
    incurredStore.clearFitCurveData();
    incurredStore.clearDevSummaryData();

    // Wyczyść również moduł PaidIncurred (other2), bo bazuje na danych paid+incurred
    incurredStore.setTrainPaidToIncurred(undefined);
    incurredStore.setSelectedWeightsPaidToIncurred(undefined);
    incurredStore.setSelectedCellsPaidToIncurred([]);
    incurredStore.setVolumePaidToIncurred(20);
    incurredStore.setMinMaxHighlightingPaidToIncurred(false);
    incurredStore.clearPaidToIncurredCalculationResults();
    incurredStore.clearPaidToIncurredFitCurveData();

    // Tabele porównawcze summary
    summaryStore.clearSummaryData();
  };

  // Używamy normalnych selectorów zamiast subscribe
  const startRow = useIncurredTableStore((s) => s.startRow);
  const endRow = useIncurredTableStore((s) => s.endRow);
  const startCol = useIncurredTableStore((s) => s.startCol);
  const endCol = useIncurredTableStore((s) => s.endCol);

  /* ---------- Synchronizacja zakresu z form ---------- */
  useEffect(() => {
    setValue('rowStart', startRow);
    setValue('rowEnd', endRow);
    setValue('colStart', startCol);
    setValue('colEnd', endCol);
    setIsRangeStateHydrated(true);
  }, [setValue, startRow, endRow, startCol, endCol]);

  /* ---------- Ładowanie pliku ---------- */
  const handleFileLoad = () => {
    const f = file?.[0];
    if (!f) {
      alert('Najpierw wybierz plik.');
      return;
    }

    const reader = new FileReader();

    reader.onloadstart = () => {
      setIsLoading(true);
      setProgress(0);
    };

    reader.onprogress = (e) => {
      if (e.lengthComputable) {
        setProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    reader.onload = (evt) => {
      const binaryStr = evt.target?.result;
      if (typeof binaryStr === 'string') {
        try {
          const wb = XLSX.read(binaryStr, { type: 'binary' });

          // Podczas wyboru pliku nie czyścimy obliczeń.
          // Czyszczenie wykonujemy dopiero po potwierdzeniu w modalu przy "Wybierz".
          // Reset tylko store'a dla zakładki Incurred (nie wszystkich store'ów)
          useIncurredTableStore.getState().resetData();
          setWorkbook(wb);
          if (wb.SheetNames && wb.SheetNames.length > 0) {
            const firstSheetName = wb.SheetNames[0];
            if (firstSheetName) {
              useIncurredTableStore
                .getState()
                .setSelectedSheetName(firstSheetName);
            }
          }

          setAvailableLobs([]);
          setSelectedLob('');
          setIsLobLoaded(false);
          setLobLoadSignature('');

          setUploadedFileName(f.name);
        } catch (err) {
          alert('Błąd podczas wczytywania pliku: ' + (err as Error).message);
        }
      } else {
        alert('Niepoprawny typ danych z FileReadera.');
      }

      setIsLoading(false);
      setProgress(0);
    };

    reader.onerror = () => {
      alert('Błąd podczas wczytywania pliku.');
      setIsLoading(false);
    };

    reader.readAsBinaryString(f);
  };

  /* ---------- Wykryj zakres automatycznie ---------- */
  const handleAutoRange = () => {
    const range = getDefaultRange();
    if (!range) return;
    setValue('rowStart', range.startRow);
    setValue('rowEnd', range.endRow);
    setValue('colStart', range.startCol);
    setValue('colEnd', range.endCol);
  };

  const handleLoadLobs = () => {
    if (!workbook || !selectedSheetName) {
      alert('Najpierw załaduj plik i wybierz arkusz.');
      return;
    }

    const worksheet = workbook.Sheets[selectedSheetName];
    if (!worksheet) {
      alert('Nie znaleziono wybranego arkusza.');
      return;
    }

    const rangeString = XLSX.utils.encode_range({
      s: { r: (rowStartValue || 1) - 1, c: (colStartValue || 1) - 1 },
      e: { r: (rowEndValue || 1) - 1, c: (colEndValue || 1) - 1 },
    });

    const rawData = XLSX.utils.sheet_to_json(worksheet, {
      range: rangeString,
      header: 1,
      defval: null,
    }) as unknown[][];

    if (rawData.length < 2) {
      alert('W wybranym zakresie brakuje danych do odczytu LoB.');
      setAvailableLobs([]);
      setSelectedLob('');
      setIsLobLoaded(false);
      setLobLoadSignature('');
      return;
    }

    const detectedColumns = detectListColumns(rawData, ['amount', 'reserve', 'wartosc', 'value']);
    if (!detectedColumns) {
      alert('Nie znaleziono nagłówków listy (LoB, AY, DY, Amount/Reserve) w wybranym zakresie.');
      setAvailableLobs([]);
      setSelectedLob('');
      setIsLobLoaded(false);
      setLobLoadSignature('');
      return;
    }

    const { headerRowIndex, lobIndex } = detectedColumns;

    const uniqueLobs = Array.from(
      new Set(
        rawData
          .slice(headerRowIndex + 1)
          .map((row) => row?.[lobIndex])
          .filter(
            (value) =>
              value !== null && value !== undefined && String(value).trim() !== '',
          )
          .map((value) => String(value).trim()),
      ),
    );

    if (uniqueLobs.length === 0) {
      alert('Nie znaleziono żadnych wartości LoB w wybranym zakresie.');
      setAvailableLobs([]);
      setSelectedLob('');
      setIsLobLoaded(false);
      setLobLoadSignature('');
      return;
    }

    setAvailableLobs(uniqueLobs);
    setSelectedLob((prev) =>
      prev && uniqueLobs.includes(prev) ? prev : (uniqueLobs[0] ?? ''),
    );
    setIsLobLoaded(true);
    setLobLoadSignature(currentLobSignature);
  };

  const buildReserveTriangleFromList = (data: FormField) => {
    if (!workbook || !selectedSheetName) {
      return { error: 'Najpierw załaduj plik i wybierz arkusz.' };
    }

    const worksheet = workbook.Sheets[selectedSheetName];
    if (!worksheet) {
      return { error: 'Nie znaleziono wybranego arkusza.' };
    }

    const rangeString = XLSX.utils.encode_range({
      s: { r: data.rowStart - 1, c: data.colStart - 1 },
      e: { r: data.rowEnd - 1, c: data.colEnd - 1 },
    });

    const rawData = XLSX.utils.sheet_to_json(worksheet, {
      range: rangeString,
      header: 1,
      defval: null,
    }) as unknown[][];

    if (rawData.length < 2) {
      return { error: 'W wybranym zakresie brakuje danych listy.' };
    }

    const normalize = (value: unknown) => String(value ?? '').trim();
    const detectedColumns = detectListColumns(rawData, ['amount', 'reserve', 'wartosc', 'value']);

    if (!detectedColumns) {
      return {
        error:
          'Brak wymaganych kolumn. Oczekiwane: LoB, AY, DY, Amount/Reserve (lub odpowiedniki).',
      };
    }

    const { headerRowIndex, lobIndex, ayIndex, dyIndex, amountIndex } = detectedColumns;

    const aySet = new Set<string>();
    const dySet = new Set<string>();
    const valueMap = new Map<string, number>();

    for (const row of rawData.slice(headerRowIndex + 1)) {
      const rowLob = normalize(row?.[lobIndex]);
      if (!rowLob || rowLob !== selectedLob) {
        continue;
      }

      const ay = normalize(row?.[ayIndex]);
      const dy = normalize(row?.[dyIndex]);
      const amount = parsePolishNumber(row?.[amountIndex]);

      if (!ay || !dy || amount === null || Number.isNaN(amount)) {
        continue;
      }

      aySet.add(ay);
      dySet.add(dy);

      const key = `${ay}|||${dy}`;
      valueMap.set(key, (valueMap.get(key) ?? 0) + amount);
    }

    if (aySet.size === 0 || dySet.size === 0) {
      return {
        error: `Brak poprawnych danych AY/DY/Amount dla LoB: ${selectedLob}.`,
      };
    }

    const sortLabels = (labels: string[]) => {
      const allNumeric = labels.every((label) => {
        const parsed = Number(label.replace(',', '.'));
        return Number.isFinite(parsed);
      });

      if (allNumeric) {
        return [...labels].sort(
          (a, b) => Number(a.replace(',', '.')) - Number(b.replace(',', '.')),
        );
      }

      return [...labels].sort((a, b) =>
        a.localeCompare(b, 'pl', { numeric: true, sensitivity: 'base' }),
      );
    };

    const ayLabels = sortLabels(Array.from(aySet));
    const dyLabels = sortLabels(Array.from(dySet));

    const triangle: (number | null)[][] = ayLabels.map((ay) =>
      dyLabels.map((dy) => valueMap.get(`${ay}|||${dy}`) ?? null),
    );

    return {
      triangle,
      ayLabels,
      dyLabels,
      headerAbsoluteRow: data.rowStart + headerRowIndex,
      dataStartAbsoluteRow: data.rowStart + headerRowIndex + 1,
    };
  };

  /* ---------- Sprawdzanie czy ustawienia się zmieniły ---------- */
  const hasSettingsChanged = (newData: FormField) => {
    console.log('🔍 Sprawdzanie zmian ustawień:', {
      selectedSheetJSON: selectedSheetJSON?.length || 0,
      lastApprovedSettings,
      currentSheetName: selectedSheetName,
      newData,
      currentHasHeaders: hasHeaders,
      currentDataType: dataType
    });

    // Sprawdź czy nie ma zapisanych ostatnich ustawień - to oznacza pierwsze użycie
    if (!lastApprovedSettings) {
      console.log('❌ Brak ostatnich ustawień - pierwsze użycie');
      return false;
    }
    
    // Sprawdź czy arkusz się zmienił
    if (selectedSheetName !== lastApprovedSettings.sheetName) {
      console.log('✅ Arkusz się zmienił:', selectedSheetName, '!=', lastApprovedSettings.sheetName);
      return true;
    }

    // Sprawdź czy zakres się zmienił
    if (newData.rowStart !== lastApprovedSettings.rowStart ||
        newData.rowEnd !== lastApprovedSettings.rowEnd ||
        newData.colStart !== lastApprovedSettings.colStart ||
        newData.colEnd !== lastApprovedSettings.colEnd) {
      console.log('✅ Zakres się zmienił');
      return true;
    }

    // 🆕 Sprawdź czy ustawienia nagłówków się zmieniły
    if (hasHeaders !== lastApprovedSettings.hasHeaders) {
      console.log('✅ Ustawienie nagłówków się zmieniło:', hasHeaders, '!=', lastApprovedSettings.hasHeaders);
      return true;
    }

    // 🆕 Sprawdź czy typ danych się zmienił
    if (dataType !== lastApprovedSettings.dataType) {
      console.log('✅ Typ danych się zmienił:', dataType, '!=', lastApprovedSettings.dataType);
      return true;
    }

    // 🆕 Sprawdź czy ustawienie inflacji się zmieniło
    if (useInflation !== lastApprovedSettings.useInflation) {
      console.log('✅ Ustawienie inflacji się zmieniło:', useInflation, '!=', lastApprovedSettings.useInflation);
      return true;
    }

    console.log('❌ Brak zmian');
    return false;
  };

  /* ---------- Submit formularza ---------- */
  const onSubmit = async (data: FormField) => {
    console.log('📝 Submit formularza:', data);

    if (dataFormatMode === 'list') {
      if (!isLobLoaded) {
        alert('Najpierw kliknij "Wczytaj LoB" dla wybranego zakresu.');
        return;
      }

      if (lobLoadSignature !== currentLobSignature) {
        alert('Zmienił się plik, arkusz albo zakres. Kliknij ponownie "Wczytaj LoB".');
        return;
      }

      if (!selectedLob) {
        alert('Wybierz LoB do analizy.');
        return;
      }
    }

    // Zawsze pytaj o potwierdzenie przed podmianą danych i usunięciem obliczeń.
    // Spójne zachowanie z InputDataTabDet.
    setPendingFormData(data);
    setShowWarningModal(true);
  };

  // Funkcja do przetwarzania danych formularza
  const processFormData = async (data: FormField) => {
    console.log('🔄 [processFormData] Rozpoczynam przetwarzanie danych incurred...', data);

    // reset dialogów
    setShowDialog(false);
    setShowSuccessDialog(false);
    setShowNoChangesDialog(false);
    setShowWarningDialog(false);

    if (dataFormatMode === 'list') {
      if (lobLoadSignature !== currentLobSignature) {
        alert('Kliknij ponownie "Wczytaj LoB" dla bieżącego zakresu.');
        return;
      }

      // Utrzymaj zakres w store tak samo jak w InputDataTabDet,
      // żeby podpis LoB nie rozjeżdżał się po zatwierdzeniu danych.
      setRangeAndUpdate({
        startRow: data.rowStart,
        endRow: data.rowEnd,
        startCol: data.colStart,
        endCol: data.colEnd,
      });

      const listResult = buildReserveTriangleFromList(data);
      if ('error' in listResult) {
        alert(listResult.error);
        return;
      }

      const { triangle, ayLabels, dyLabels, dataStartAbsoluteRow } = listResult;
      setRowLabels(ayLabels);
      setColumnLabels(dyLabels);

      // W trybie listy rezerwy są już skumulowane po AY/DY
      setDataType('cumulative');
      setHasHeaders(true);

      console.log('📊 [processFormData] Zapisuję dane listy jako reserve...');
      setReserve(triangle);

      const currentPaidTriangle_bez_inf = paidStore.paidTriangle_bez_inf;
      if (currentPaidTriangle_bez_inf && currentPaidTriangle_bez_inf.length > 0) {
        const maxRows = Math.max(currentPaidTriangle_bez_inf.length, triangle.length);
        const maxCols = Math.max(
          currentPaidTriangle_bez_inf[0]?.length || 0,
          triangle[0]?.length || 0,
        );

        const summedTriangle: (number | null)[][] = [];
        for (let i = 0; i < maxRows; i++) {
          const row: (number | null)[] = [];
          for (let j = 0; j < maxCols; j++) {
            const paidValue = currentPaidTriangle_bez_inf[i]?.[j] ?? 0;
            const reserveValue = triangle[i]?.[j] ?? 0;
            const sum = (paidValue || 0) + (reserveValue || 0);
            row.push(sum === 0 ? null : sum);
          }
          summedTriangle.push(row);
        }

        setIncurredTriangle_bez_inf(summedTriangle);
        setIncurredTriangle(summedTriangle);
      } else {
        setIncurredTriangle_bez_inf(triangle);
        setIncurredTriangle(triangle);
      }

      const sheetForStore: (string | number)[][] = triangle.map((row) =>
        row.map((cell) => (cell == null ? '' : cell)),
      );
      useTrainDevideStoreIncurred.setState({ selectedSheetIncurred: sheetForStore });

      if (!localValidateDataValues(triangle as any[][])) {
        setShowWarningDialog(true);
        return;
      }

      setLastApprovedSettings({
        sheetName: selectedSheetName || null,
        rowStart: dataStartAbsoluteRow,
        rowEnd: data.rowEnd,
        colStart: data.colStart,
        colEnd: data.colEnd,
        hasHeaders: true,
        dataType: 'cumulative',
        useInflation,
        dataId: `incurred_list_${selectedLob}_${uploadedFileName}_${Date.now()}`,
      });

      const canApplyInflation =
        useInflation &&
        !!userId &&
        selectedInflacjaLine !== null &&
        !!useTrainDevideStoreIncurred.getState().reserve?.length &&
        !!useTrainDevideStoreDet.getState().paidTriangle_bez_inf?.length;

      if (canApplyInflation) {
        await processInflation();
      } else {
        setShowSuccessDialog(true);
      }
      return;
    }

    setRangeAndUpdate({
      startRow: data.rowStart,
      endRow: data.rowEnd,
      startCol: data.colStart,
      endCol: data.colEnd,
    });

    setTimeout(async () => {
      let { isValid: v, selectedSheetJSON: json, previousSheetJSON: prev } =
        useIncurredTableStore.getState();

      // (1) ewentualna konwersja inkrementalnych -> skumulowane
      if (dataType === 'incremental' && json) {
        const converted = convertIncrementalToCumulative(json);
        useIncurredTableStore.setState({ selectedSheetJSON: converted });
        json = converted;
      }

      // (2) budowa body + etykiet zgodnie z hasHeaders
      let body: any[][] = [];
      let rowNames: string[] = [];
      let colNames: string[] = [];

      if (json && json.length > 1) {
        if (hasHeaders) {
          // ✅ Mamy podpisy – wyciągamy je z pierwszego wiersza/kolumny
          colNames = (json[0] ?? []).slice(1).map(c => String(c ?? ''));
          rowNames = json.slice(1).map(r => String((r && r[0]) ?? ''));
          body = json.slice(1).map(r => r.slice(1)); // samo „ciało"
        } else {
          // ❌ Brak podpisów – generujemy 1..N po wycięciu pierwszego wiersza/kolumny
          body = json.slice(1).map(r => r.slice(1));
          rowNames = Array.from({ length: body.length }, (_, i) => String(i + 1));
          colNames = Array.from({ length: body[0]?.length || 0 }, (_, i) => String(i + 1));
        }

        // zapis etykiet do store'a
        setRowLabels(rowNames);
        setColumnLabels(colNames);

        // numericTriangle (number|null) na bazie body z polskim formatowaniem liczb
        let numericTriangle: (number | null)[][] = body.map(row =>
          row.map(cell => parsePolishNumber(cell))
        );

        // � USUNIĘTO: Automatyczne nakładanie inflacji podczas wczytywania
        // Inflacja będzie nakładana tylko przez przycisk "Nałóż inflację"

        if (numericTriangle && numericTriangle.length > 0) {
          // 🔥 NOWA LOGIKA: wczytywane dane to RESERVE
          console.log('📊 [processFormData] Zapisuję wczytane dane jako reserve...');
          setReserve(numericTriangle);
          
          // 🔥 incurredTriangle_bez_inf = paidTriangle_bez_inf + reserve
          const currentPaidTriangle_bez_inf = paidStore.paidTriangle_bez_inf;
          
          if (currentPaidTriangle_bez_inf && currentPaidTriangle_bez_inf.length > 0) {
            console.log('➕ [processFormData] Sumuję paidTriangle_bez_inf + reserve...');
            console.log('📊 Paid triangle (bez inflacji):', {
              rows: currentPaidTriangle_bez_inf.length,
              cols: currentPaidTriangle_bez_inf[0]?.length || 0
            });
            console.log('📊 Reserve triangle:', {
              rows: numericTriangle.length,
              cols: numericTriangle[0]?.length || 0
            });
            
            // Sprawdź czy wymiary się zgadzają
            const maxRows = Math.max(currentPaidTriangle_bez_inf.length, numericTriangle.length);
            const maxCols = Math.max(
              currentPaidTriangle_bez_inf[0]?.length || 0, 
              numericTriangle[0]?.length || 0
            );
            
            // Stwórz nowy trójkąt jako suma paid_bez_inf + reserve
            const summedTriangle: (number | null)[][] = [];
            
            for (let i = 0; i < maxRows; i++) {
              const row: (number | null)[] = [];
              for (let j = 0; j < maxCols; j++) {
                const paidValue = currentPaidTriangle_bez_inf[i]?.[j] ?? 0;
                const reserveValue = numericTriangle[i]?.[j] ?? 0;
                
                // Suma: paid_bez_inf + reserve
                const sum = (paidValue || 0) + (reserveValue || 0);
                row.push(sum === 0 ? null : sum);
              }
              summedTriangle.push(row);
            }
            
            console.log('✅ [processFormData] Summed triangle (paid_bez_inf + reserve):', {
              rows: summedTriangle.length,
              cols: summedTriangle[0]?.length || 0
            });
            
            setIncurredTriangle_bez_inf(summedTriangle);
            setIncurredTriangle(summedTriangle); // Domyślnie bez inflacji
          } else {
            console.log('⚠️ [processFormData] Brak danych paid_bez_inf - używam tylko reserve');
            setIncurredTriangle_bez_inf(numericTriangle);
            setIncurredTriangle(numericTriangle); // Domyślnie bez inflacji
          }
        }

        // widok tabeli do podglądu (string|number)
        const sheetForStore: (string | number)[][] = body.map(row =>
          row.map(cell => (cell == null ? '' : typeof cell === 'number' ? cell : String(cell)))
        );
        if (sheetForStore && sheetForStore.length > 0) {
          useTrainDevideStoreIncurred.setState({ selectedSheetIncurred: sheetForStore });
        }
      }

      // (3) walidacje i komunikaty  
      // 🔥 DODATKOWY IDENTYFIKATOR - zawsze różne dane dla incurred vs paid
      const currentDataId = `incurred_${selectedSheetName}_${uploadedFileName}_${Date.now()}`;
      const previousDataId = lastApprovedSettings?.dataId || '';
      
      // 🔥 DODATKOWE ZABEZPIECZENIE: sprawdź czy to są dane z tego samego kontekstu (incurred)
      const isFromSameContext = previousDataId.startsWith('incurred_') || previousDataId === '';
      const same = JSON.stringify(json) === JSON.stringify(prev) 
                  && currentDataId === previousDataId 
                  && isFromSameContext;

      console.log('🔍 [processFormData] Porównanie danych:', {
        jsonLength: json?.length || 'undefined',
        prevLength: prev?.length || 'undefined', 
        jsonType: typeof json,
        prevType: typeof prev,
        currentDataId,
        previousDataId,
        isFromSameContext,
        same: same,
        v: v
      });

      if (!v) {
        setShowDialog(true);
      } else if (same && prev !== undefined) {
        // Pokaż "brak zmian" tylko jeśli poprzednie dane rzeczywiście istniały
        console.log('⚠️ [processFormData] Pokazuję dialog "brak zmian"');
        setShowNoChangesDialog(true);
      } else if (!localValidateDataValues(body || [])) {
        console.log('⚠️ [processFormData] Pokazuję dialog walidacji');
        setShowWarningDialog(true);
      } else {
        console.log('✅ [processFormData] Dane poprawne, zapisuję ustawienia');
        setLastApprovedSettings({
          sheetName: selectedSheetName || null,
          rowStart: data.rowStart,
          rowEnd: data.rowEnd,
          colStart: data.colStart,
          colEnd: data.colEnd,
          hasHeaders,
          dataType,
          useInflation,
          dataId: currentDataId, // 🔥 Unikalny identyfikator dla tej operacji
        });

        const canApplyInflation =
          useInflation &&
          !!userId &&
          selectedInflacjaLine !== null &&
          !!useTrainDevideStoreIncurred.getState().reserve?.length &&
          !!useTrainDevideStoreDet.getState().paidTriangle_bez_inf?.length;

        if (canApplyInflation) {
          await processInflation();
        } else {
          setShowSuccessDialog(true);
        }
      }
    }, 0);
  };

  // Obsługa potwierdzenia w modalu
  const handleConfirmDataReplace = () => {
    console.log('🚨 [handleConfirmDataReplace] Rozpoczynam czyszczenie danych incurred...');
    setShowWarningModal(false);

    clearDeterministicIncurredCalculations();
    
    // Nie resetujemy useIncurredTableStore tutaj, bo to czyści workbook/selectedSheetJSON
    // potrzebne do processFormData po potwierdzeniu.
    
    if (pendingFormData) {
      console.log('📝 [handleConfirmDataReplace] Przetwarzam odłożone dane formularza...');
      
      // 🆕 Wymusimy odświeżenie komponentów przez incrementDataGeneration - PRZED processFormData
      console.log('🔄 [handleConfirmDataReplace] Incrementing dataGenerationId...');
      incrementDataGeneration();
      
      // Małe opóźnienie żeby React zdążył przetworzyć zmianę dataGenerationId
      setTimeout(async () => {
        console.log('⏰ [handleConfirmDataReplace] Wywołuję processFormData po timeout...');
        await processFormData(pendingFormData);
      }, 0);
      
      setPendingFormData(null);
    } else {
      console.log('⚠️ [handleConfirmDataReplace] Brak pendingFormData!');
    }
    console.log('✅ [handleConfirmDataReplace] Zakończono');
  };

  // Obsługa anulowania w modalu
  const handleCancelDataReplace = () => {
    setShowWarningModal(false);
    setPendingFormData(null);
  };

  // Funkcja do nakładania inflacji
  const processInflation = async () => {
    // 🔥 UŻYWAJ ŚWIEŻYCH DANYCH ZE STORE (bez ryzyka "stale state" po setReserve)
    const originalReserveData = useTrainDevideStoreIncurred.getState().reserve;
    const originalPaidTriangle_bez_inf = useTrainDevideStoreDet.getState().paidTriangle_bez_inf;
    const inflationLine = availableInflacjaLines.find(line => line.index === selectedInflacjaLine);
    
    if (!originalReserveData || originalReserveData.length === 0) {
      setInflationErrorMessage('Brak oryginalnych danych reserve do przetworzenia.');
      setShowInflationErrorModal(true);
      return;
    }
    
    if (!originalPaidTriangle_bez_inf || originalPaidTriangle_bez_inf.length === 0) {
      setInflationErrorMessage('Brak danych paid_bez_inf do przetworzenia.');
      setShowInflationErrorModal(true);
      return;
    }
    
    if (!inflationLine) {
      setInflationErrorMessage('Nie znaleziono wybranej linii inflacji');
      setShowInflationErrorModal(true);
      return;
    }

    if (!userId) {
      setInflationErrorMessage('Brak user ID.');
      setShowInflationErrorModal(true);
      return;
    }

    try {
      console.log('🔥 [processInflation] Nakładanie inflacji - wysyłanie OSOBNYCH danych paid_bez_inf + reserve...');
      
      setIsLoading(true);
      setProgress(50);
      
      console.log('📊 OSOBNE dane dla backendu:');
      console.log('📊 Paid triangle (bez inflacji):', {
        rows: originalPaidTriangle_bez_inf.length,
        cols: originalPaidTriangle_bez_inf[0]?.length || 0
      });
      console.log('📊 Reserve triangle:', {
        rows: originalReserveData.length,
        cols: originalReserveData[0]?.length || 0
      });

      const reversedInflationVector = [...inflationLine.values].reverse();
      
      // 🔥 WYŚLIJ OSOBNE TRÓJKĄTY - backend zrobi sumowanie i inflację
      const inflationRequest = {
        user_id: userId,
        triangle_paid: originalPaidTriangle_bez_inf,    // Dane paid bez inflacji
        triangle_reserved: originalReserveData,         // 🔥 Dane reserve
        inflationVector: reversedInflationVector
      };

      console.log('📊 [processInflation] Request dla backendu (paid_bez_inf + reserve):', {
        paidTriangleRows: originalPaidTriangle_bez_inf?.length || 0,
        paidTriangleCols: originalPaidTriangle_bez_inf?.[0]?.length || 0,
        reserveTriangleRows: originalReserveData?.length || 0,
        reserveTriangleCols: originalReserveData?.[0]?.length || 0,
        inflationVectorLength: reversedInflationVector.length
      });

      // Wyślij na backend endpoint /calc/incurred/inflation
      const API_URL = getApiBaseUrl();
      const response = await fetch(`${API_URL}/calc/incurred/inflation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inflationRequest),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Nieznany błąd backendu');
      }

      // Zastąp dane skorygowanymi o inflację z backendu
      // 🔥 WYNIK to zsumowane paid_bez_inf + reserve + inflacja
      setIncurredTriangle(result.adjustedTriangle || result.data);
      
      console.log('✅ [processInflation] Inflacja nałożona na paid_bez_inf + reserve - wynik zapisany do incurredTriangle');
      
      // 🔥 WYMUSIMY ODŚWIEŻENIE KOMPONENTÓW - kluczowe dla przeliczenia współczynników CL
      incrementDataGeneration();
      
      // Wyczyść wszystkie obliczone dane z zakładek (jak przy wczytywaniu nowych danych)
      console.log('🔄 [processInflation] Czyszczę wszystkie obliczone dane po nałożeniu inflacji...');
      incurredStore.setTrainDevideIncurred(undefined);
      incurredStore.clearDevJResults();
      incurredStore.setFinalDevJ(undefined);
      incurredStore.clearAllDevFinalValues();
      incurredStore.clearFitCurveData();
      incurredStore.clearDevSummaryData();
      
      // Wyczyść również wyniki obliczeń CL (devJ, sigma, sd)
      incurredStore.setDevJ([]);
      incurredStore.setSigma([]);
      incurredStore.setSd([]);
      
      // Wyczyść tabele ResultSummary
      summaryStore.clearSummaryData();
      
      console.log('✅ [processInflation] Inflacja nakoładana pomyślnie');
      setShowInflationSuccessModal(true);

    } catch (error) {
      console.error('❌ [processInflation] Błąd:', error);
      const errorMessage = error instanceof Error ? error.message : 'Nieznany błąd';
      setInflationErrorMessage(`Błąd podczas nakładania inflacji: ${errorMessage}`);
      setShowInflationErrorModal(true);
    } finally {
      setIsLoading(false);
      setProgress(0);
    }
  };

  /* ------------------------------- JSX ------------------------------- */
  return (
    <div>
      {/* ---------- FORMULARZ ---------- */}
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-col gap-3"
      >
        <section className="rounded-xl bg-[#1f2f49]/70 p-3 md:p-3.5">
          <div className="pb-1">
            <h2 className="text-base leading-tight tracking-tight font-semibold text-slate-100">
              Wprowadź trójkąt danych reserve, który wykorzystasz w dalszej analizie
            </h2>
          </div>
          <div className="space-y-3">
            {/* --- Plik --- */}
            <FileUploadSection
              file={file}
              uploadedFileName={uploadedFileName}
              onFileChange={(e) => setValue('file', e.target.files)}
              onFileLoad={handleFileLoad}
              isLoading={isLoading}
            />

            {/* --- Arkusz --- */}
            <div className="space-y-1">
              <Label className="text-slate-100">Wybór arkusza</Label>
              <SheetSelectIncurred />
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div>
                <div className="w-full p-1">
                  <h3 className="mb-1.5 text-base leading-tight tracking-tight font-semibold text-slate-100">
                    Podaj zakres danych, które chcesz wczytać.
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div className="w-full space-y-1">
                      <Label className="text-slate-100">Wiersz początkowy</Label>
                      <Input
                        type="number"
                        disabled={!workbook}
                        {...register('rowStart')}
                      />
                    </div>
                    <div className="w-full space-y-1">
                      <Label className="text-slate-100">Wiersz końcowy</Label>
                      <Input
                        type="number"
                        disabled={!workbook}
                        {...register('rowEnd')}
                      />
                    </div>
                    <div className="w-full space-y-1">
                      <Label className="text-slate-100">Kolumna początkowa</Label>
                      <Input
                        type="number"
                        disabled={!workbook}
                        {...register('colStart')}
                      />
                    </div>
                    <div className="w-full space-y-1">
                      <Label className="text-slate-100">Kolumna końcowa</Label>
                      <Input
                        type="number"
                        disabled={!workbook}
                        {...register('colEnd')}
                      />
                    </div>
                  </div>

                  <Button
                    type="button"
                    onClick={handleAutoRange}
                    variant="outline"
                    disabled={!workbook}
                    className="mt-2 h-9 bg-slate-600 text-slate-100 border-slate-500 hover:bg-slate-500 text-sm"
                  >
                    Wykryj zakres automatycznie
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
                <div className="max-w-xl space-y-3">
                  <div className="w-full rounded-lg border border-slate-500/40 bg-slate-800/20 p-2.5">
                    <Label className="text-base leading-tight tracking-tight font-semibold text-slate-100">
                      Typ danych
                    </Label>
                    <div className="mt-2 flex flex-col gap-1">
                      <label className="group flex cursor-pointer items-center space-x-2 rounded-md px-1 py-1 transition-colors hover:bg-slate-600/60">
                        <input
                          type="radio"
                          name="dataFormatMode"
                          checked={dataFormatMode === 'triangle'}
                          onChange={() => setDataFormatMode('triangle')}
                          className="h-4 w-4 border-slate-400 bg-slate-700 text-blue-500 focus:ring-2 focus:ring-blue-400"
                        />
                        <span className="text-sm text-slate-200 group-hover:text-white">Trójkąt</span>
                      </label>
                      <label className="group flex cursor-pointer items-center space-x-2 rounded-md px-1 py-1 transition-colors hover:bg-slate-600/60">
                        <input
                          type="radio"
                          name="dataFormatMode"
                          checked={dataFormatMode === 'list'}
                          onChange={() => setDataFormatMode('list')}
                          className="h-4 w-4 border-slate-400 bg-slate-700 text-blue-500 focus:ring-2 focus:ring-blue-400"
                        />
                        <span className="text-sm text-slate-200 group-hover:text-white">Lista</span>
                      </label>
                    </div>
                  </div>

                  {dataFormatMode === 'triangle' && (
                    <HeadersSelector
                      hasHeaders={hasHeaders}
                      onHeadersChange={setHasHeaders}
                    />
                  )}

                  {dataFormatMode === 'list' && (
                    <div className="w-full rounded-lg border border-slate-500/40 bg-slate-800/20 p-2.5">
                      <Label className="text-base leading-tight tracking-tight font-semibold text-slate-100">
                        Wybierz LoB
                      </Label>
                      <Button
                        type="button"
                        onClick={handleLoadLobs}
                        disabled={!workbook}
                        className="mt-2 h-8 rounded-md bg-slate-600 px-4 text-sm text-slate-100 hover:bg-slate-500"
                      >
                        Wczytaj LoB
                      </Button>
                      <select
                        className="mt-2 w-full rounded-md border border-slate-500 bg-slate-700 px-2 py-1.5 text-sm text-slate-100"
                        value={selectedLob}
                        onChange={(e) => setSelectedLob(e.target.value)}
                        disabled={
                          !isLobLoaded ||
                          lobLoadSignature !== currentLobSignature ||
                          availableLobs.length === 0
                        }
                      >
                        {!isLobLoaded || lobLoadSignature !== currentLobSignature ? (
                          <option value="">Najpierw kliknij Wczytaj LoB</option>
                        ) : availableLobs.length === 0 ? (
                          <option value="">Brak LoB w zakresie</option>
                        ) : (
                          availableLobs.map((lob) => (
                            <option key={lob} value={lob}>
                              {lob}
                            </option>
                          ))
                        )}
                      </select>
                    </div>
                  )}

                  <label className="inline-flex items-center gap-2 text-sm text-slate-100">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-500 bg-slate-700"
                      checked={useInflation}
                      onChange={(e) => setUseInflation(e.target.checked)}
                      disabled={Object.keys(inflacjaTriangle).length === 0 || selectedInflacjaLine === null}
                    />
                    Nałóż inflację
                  </label>
                </div>

                {dataFormatMode === 'triangle' && (
                  <div className="max-w-xl space-y-3">
                    <DataTypeSelector
                      dataType={dataType}
                      onDataTypeChange={setDataType}
                      title="Format danych"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="pt-1">
              <Button
                type="submit"
                className="h-8 rounded-md bg-emerald-600 px-4 text-sm text-white hover:bg-emerald-500"
                disabled={!workbook}
              >
                Zaakceptuj
              </Button>
            </div>
          </div>
        </section>
      </form>

      {/* ---------- DIALOGI ---------- */}
      <DataInputDialogs
        showErrorDialog={showDialog}
        onErrorDialogChange={setShowDialog}
        errorMessage={validationErrorReason || 'Dane wejściowe nie spełniają określonego formatu. Sprawdź dane!'}
        showWarningDialog={showWarningDialog}
        onWarningDialogChange={setShowWarningDialog}
        showSuccessDialog={showSuccessDialog}
        onSuccessDialogChange={setShowSuccessDialog}
        successMessage={dataType === 'incremental' 
          ? "Dane inkrementalne zostały przekonwertowane na skumulowane i poprawnie wczytane (Reserve)."
          : "Dane reserve zostały poprawnie wczytane i zsumowane z paid."}
        showInfoDialog={showNoChangesDialog}
        onInfoDialogChange={setShowNoChangesDialog}
      />

      {/* ---------- DIALOGI INFLACJI ---------- */}
      <DataInputDialogs
        showErrorDialog={showInflationErrorModal}
        onErrorDialogChange={setShowInflationErrorModal}
        errorMessage={inflationErrorMessage}
        showWarningDialog={false}
        onWarningDialogChange={() => {}}
        showSuccessDialog={showInflationSuccessModal}
        onSuccessDialogChange={setShowInflationSuccessModal}
        successMessage="Inflacja została pomyślnie nałożona na dane paid + reserve."
        showInfoDialog={false}
        onInfoDialogChange={() => {}}
      />

      {/* ---------- LOADING ---------- */}
      <DataInputLoading 
        isLoading={isLoading} 
        progress={progress} 
      />

      {/* MODAL OSTRZEŻENIA O UTRACIE DANYCH */}
      <Modal
        title="Ostrzeżenie"
        message="Czy napewno chcesz wczytać dane? Wszystkie obliczenia w zakładce Metody deterministyczne (incurred) zostaną utracone."
        isOpen={showWarningModal}
        onConfirm={handleConfirmDataReplace}
        onCancel={handleCancelDataReplace}
      />

    </div>
  );
}
