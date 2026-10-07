'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as XLSX from 'xlsx';
import { useState, useEffect } from 'react';
import { useExposureStore } from '@/stores/exposureStore';
import { useInflacjaStore } from '@/stores/inflacjaStore';
import { useUserStore } from '@/app/_components/useUserStore';
import { inflationApiService } from '@/services/inflationApi';
import { buildApiUrl, getApiBaseUrl } from '@/lib/apiBaseUrl';
import { z } from 'zod';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { VisuallyHidden } from '@/components/ui/visually-hidden';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const schema = z.object({
  rowStart: z.coerce.number().min(1),
  rowEnd: z.coerce.number().min(1),
  colStart: z.coerce.number().min(1),
  colEnd: z.coerce.number().min(1),
  file: z.any(),
});
type FormField = z.infer<typeof schema>;

// --- KONWERSJA LICZB Z POLSKIM FORMATOWANIEM ---
function parsePolishNumber(value: any): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  
  if (value == null || value === '') {
    return null;
  }
  
  let str = String(value).trim();
  
  // Usuń spacje (mogą być separatorami tysięcy)
  str = str.replace(/\s/g, '');
  // Usuń apostrof tysięcy spotykany w niektórych eksportach (np. 1'234.56)
  str = str.replace(/'/g, '');
  
  // Jeśli string zawiera przecinek i nie zawiera kropki, 
  // to prawdopodobnie przecinek to separator dziesiętny
  if (str.includes(',') && !str.includes('.')) {
    str = str.replace(',', '.');
  }
  // Jeśli zawiera i przecinek i kropkę, to prawdopodobnie:
  // - kropka = separator tysięcy, przecinek = separator dziesiętny (np. 1.234,56)
  else if (str.includes(',') && str.includes('.')) {
    // Sprawdź pozycje - jeśli kropka jest przed przecinkiem, to kropka = tysiące
    const lastDotIndex = str.lastIndexOf('.');
    const lastCommaIndex = str.lastIndexOf(',');
    
    if (lastDotIndex < lastCommaIndex) {
      // Format: 1.234,56 (kropka=tysiące, przecinek=dziesiętne)
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      // Format: 1,234.56 (przecinek=tysiące, kropka=dziesiętne)
      str = str.replace(/,/g, '');
    }
  } else if (str.includes(',') && !str.includes('.')) {
    // Obsługa samych przecinków: 123,45 (dziesiętne) vs 1,234 (tysiące)
    const parts = str.split(',');
    if (parts.length > 2) {
      // Format tysięcy: 1,234,567
      str = str.replace(/,/g, '');
    } else if (parts.length === 2) {
      const fractional = parts[1] ?? '';
      if (fractional.length === 3) {
        // Najczęściej separator tysięcy
        str = str.replace(',', '');
      } else {
        // Separator dziesiętny
        str = str.replace(',', '.');
      }
    }
  }
  
  const num = Number(str);
  return Number.isFinite(num) ? num : null;
}

// --- KONWERSJA EXPOSURE TRIANGLE DO FORMATU MATRIX ---
function convertExposureToMatrix(exposureData: { [rowIndex: number]: { [colIndex: number]: number | null } }): (number | null)[][] {
  const matrix: (number | null)[][] = [];
  const rowIndices = Object.keys(exposureData).map(Number).sort((a, b) => a - b);
  
  for (const rowIndex of rowIndices) {
    const row = exposureData[rowIndex];
    if (!row) continue; // Sprawdź czy wiersz istnieje
    
    const colIndices = Object.keys(row).map(Number).sort((a, b) => a - b);
    const matrixRow: (number | null)[] = [];
    
    for (const colIndex of colIndices) {
      matrixRow.push(row[colIndex] ?? null); // Zabezpiecz przed undefined
    }
    matrix.push(matrixRow);
  }
  
  return matrix;
}

export function ExposureTab() {
  const {
    exposureTriangle,
    originalExposureTriangle,
    workbook,
    availableSheetNames,
    previewExposureTriangle,
    selectedSheetName,
    uploadedFileName,
    decimalPlaces,
    selectedExposureLine,
    inflationResult,
    appliedInflationPreview,
    applyInflationOnAccept,
    setExposureTriangle,
    setOriginalExposureTriangle,
    setWorkbook,
    setAvailableSheetNames,
    setPreviewExposureTriangle,
    setSelectedSheetName,
    setUploadedFileName,
    setAppliedInflationPreview,
    setApplyInflationOnAccept,
    setSelectedExposureLine,
    setInflationResult,
    resetData
  } = useExposureStore();

  // Store'y dla inflacji
  const { inflacjaTriangle, selectedInflacjaLine, availableInflacjaLines } = useInflacjaStore();
  const userId = useUserStore((s) => s.userId);

  // Stan lokalny formularza
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [showErrorDialog, setShowErrorDialog] = useState(false);
  const [errorDialogMessage, setErrorDialogMessage] = useState('Wystąpił błąd podczas przetwarzania danych ekspozycji. Sprawdź format pliku!');
  const previewData = previewExposureTriangle;
  const isDataLoaded = Object.keys(previewData).length > 0;
  // Używamy selectedExposureLine z store zamiast lokalnego stanu
  const selectedLineForSubmit = selectedExposureLine;

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<FormField>({
    resolver: zodResolver(schema),
    defaultValues: {
      rowStart: 1,
      rowEnd: 11,
      colStart: 1,
      colEnd: 11,
    }
  });

  const file = watch('file');

  const previewRows = Object.entries(previewData)
    .sort(([a], [b]) => Number(a) - Number(b))
    .filter(([, rowData]) => {
      const firstCell = rowData[0];
      // Ukryj techniczne wiersze bez etykiety w kolumnie 0 (np. 0,1,2,3...)
      return firstCell !== null && firstCell !== undefined && String(firstCell).trim() !== '';
    });

  const visibleColumnIndices = Array.from(
    new Set(
      previewRows.flatMap(([, rowData]) =>
        Object.keys(rowData)
          .map(Number)
          .filter((colIndex) => colIndex !== 0)
      )
    )
  ).sort((a, b) => a - b);

  const headerRow = Object.entries(previewData)
    .sort(([a], [b]) => Number(a) - Number(b))
    .find(([, rowData]) => {
      const firstCell = rowData[0];
      const hasAnyColumnLabel = visibleColumnIndices.some((colIndex) => {
        const value = rowData[colIndex];
        return value !== null && value !== undefined && String(value).trim() !== '';
      });
      return (firstCell === null || firstCell === undefined || String(firstCell).trim() === '') && hasAnyColumnLabel;
    });

  const columnLabels: Record<number, string> = Object.fromEntries(
    visibleColumnIndices.map((colIndex, displayIndex) => {
      const rawHeaderValue = headerRow?.[1][colIndex];
      const label = rawHeaderValue !== null && rawHeaderValue !== undefined && String(rawHeaderValue).trim() !== ''
        ? String(rawHeaderValue)
        : String(displayIndex + 1);
      return [colIndex, label];
    })
  );

  // Załaduj podgląd przy inicjalizacji jeśli mamy już dane w store
  useEffect(() => {
    if (Object.keys(previewExposureTriangle).length > 0) {
      return;
    }

    if (Object.keys(originalExposureTriangle).length > 0) {
      // Podgląd zawsze pokazuje dane bazowe (bez nałożonej inflacji)
      setPreviewExposureTriangle(originalExposureTriangle);
    } else if (Object.keys(exposureTriangle).length > 0) {
      // Fallback dla starszego stanu, gdy originalExposureTriangle jest puste
      setPreviewExposureTriangle(exposureTriangle);
    }
  }, [previewExposureTriangle, originalExposureTriangle, exposureTriangle, setPreviewExposureTriangle]);

  // Funkcja ładowania pliku
  const handleFileLoad = () => {
    if (!file || file.length === 0) return;

    const selectedFile = file[0];
    const reader = new FileReader();

    reader.onload = (e) => {
      const data = new Uint8Array(e.target?.result as ArrayBuffer);
      const wb = XLSX.read(data, { type: 'array' });
      setWorkbook(wb);
      setAvailableSheetNames(wb.SheetNames);
      setSelectedSheetName(wb.SheetNames[0] || '');
      setUploadedFileName(selectedFile.name);
      
      // Resetuj stan załadowania danych
      setPreviewExposureTriangle({});
      setInflationResult(null); // Reset wyniku inflacji
      setAppliedInflationPreview(null);
      setApplyInflationOnAccept(false);
    };

    reader.readAsArrayBuffer(selectedFile);
  };

  // Funkcja wczytywania danych (Etap 1)
  const handleLoadData = () => {
    if (!workbook || !selectedSheetName) {
      setErrorDialogMessage('Brak aktywnego pliku w pamięci. Załaduj plik ponownie, aby wczytać dane z arkusza.');
      setShowErrorDialog(true);
      return;
    }

    const worksheet = workbook.Sheets[selectedSheetName];
    if (!worksheet) return;

    try {
      // Użyj wartości z formularza
      const formData = watch();
      const rangeString = XLSX.utils.encode_range({
        s: { r: (formData.rowStart || 1) - 1, c: (formData.colStart || 1) - 1 },
        e: { r: (formData.rowEnd || 11) - 1, c: (formData.colEnd || 11) - 1 }
      });

      const rawData = XLSX.utils.sheet_to_json(worksheet, {
        range: rangeString,
        header: 1,
        defval: null
      }) as any[][];

      // Przetwórz dane na format trójkąta dla podglądu
      const triangleData: { [rowIndex: number]: { [colIndex: number]: number | string | null } } = {};
      
      for (let i = 0; i < rawData.length; i++) {
        const row = rawData[i];
        if (!row) continue;
        
        triangleData[i] = {};
        
        for (let j = 0; j < row.length; j++) {
          const value = row[j];
          if (value !== null && value !== undefined && value !== '') {
            const parsedValue = parsePolishNumber(value);
            triangleData[i]![j] = parsedValue !== null ? parsedValue : value; // Zachowaj string label jeśli nie da się sparsować
          } else {
            triangleData[i]![j] = null;
          }
        }
      }

      setPreviewExposureTriangle(triangleData);
    } catch (error) {
      console.warn('Błąd podczas wczytywania danych:', error);
      setShowErrorDialog(true);
    }
  };

  // Funkcja automatycznego wykrywania zakresu
  const handleAutoRange = () => {
    if (!workbook || !selectedSheetName) {
      setErrorDialogMessage('Brak aktywnego pliku w pamięci. Załaduj plik ponownie, aby wykryć zakres automatycznie.');
      setShowErrorDialog(true);
      return;
    }

    const worksheet = workbook.Sheets[selectedSheetName];
    if (!worksheet) return;

    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
    setValue('rowStart', range.s.r + 1);
    setValue('rowEnd', range.e.r + 1);
    setValue('colStart', range.s.c + 1);
    setValue('colEnd', range.e.c + 1);
  };

  // Funkcja przetwarzania danych
  const onSubmit = async (data: FormField) => {
    try {
      // Akceptuj to, co użytkownik realnie widzi w podglądzie (krok 2),
      // zamiast ponownego czytania zakresu z formularza po przełączaniu zakładek.
      const triangleData = previewData;

      if (Object.keys(triangleData).length === 0) {
        setErrorDialogMessage('Brak wczytanych danych podglądu. Kliknij najpierw Wczytaj dane.');
        setShowErrorDialog(true);
        return;
      }

      setExposureTriangle(triangleData);
      // Zapisz też oryginalne dane (bez inflacji)
      setOriginalExposureTriangle(triangleData);
      // Pobierz najnowszy wybór linii w momencie submit (bez ryzyka starej wartości z renderu)
      const latestSelectedLine = useExposureStore.getState().selectedExposureLine;

      // Zapisz też wybraną linię ekspozycji
      if (latestSelectedLine !== null) {
        setSelectedExposureLine(latestSelectedLine);
      }
      setShowSuccessDialog(true);

      if (applyInflationOnAccept) {
        await handleApplyInflation({
          sourceTriangle: triangleData,
          selectedLineOverride: latestSelectedLine,
        });
      } else {
        // Gdy inflacja nie jest zaznaczona, czyścimy podgląd wyniku inflacji
        setAppliedInflationPreview(null);
        setInflationResult(null);
      }
    } catch (error) {
      console.warn('Błąd podczas przetwarzania danych:', error);
      setErrorDialogMessage('Wystąpił błąd podczas przetwarzania danych ekspozycji. Sprawdź format pliku!');
      setShowErrorDialog(true);
    }
  };

  // Funkcja nakładania inflacji
  const handleApplyInflation = async (options?: {
    sourceTriangle?: { [rowIndex: number]: { [colIndex: number]: number | string | null } };
    selectedLineOverride?: number | null;
  }) => {
    console.log('🔥 [ExposureTab] handleApplyInflation - rozpoczynam...');

    const sourceTriangle = options?.sourceTriangle ?? originalExposureTriangle;
    const selectedLine = options?.selectedLineOverride ?? useExposureStore.getState().selectedExposureLine;
    
    // Sprawdzenie czy są dane exposure
    if (!sourceTriangle || Object.keys(sourceTriangle).length === 0) {
      console.warn('❌ Brak danych exposure');
      setErrorDialogMessage('Brak danych ekspozycji. Najpierw wczytaj i zaakceptuj dane.');
      setShowErrorDialog(true);
      return;
    }

    // Sprawdzenie czy jest wybrany wektor exposure
    if (selectedLine === null) {
      console.warn('❌ Nie wybrano wektora exposure');
      setErrorDialogMessage('Nie wybrano wiersza ekspozycji. Zaznacz wiersz do analizy.');
      setShowErrorDialog(true);
      return;
    }

    // Sprawdzenie czy są dane inflacji
    if (selectedInflacjaLine === null || !userId) {
      console.warn('❌ Brak danych inflacji lub user ID');
      setErrorDialogMessage('Brak wybranej linii inflacji lub identyfikatora użytkownika. Wybierz linię inflacji i spróbuj ponownie.');
      setShowErrorDialog(true);
      return;
    }

    // Znalezienie wybranej linii inflacji
    const inflationLine = availableInflacjaLines.find(line => line.index === selectedInflacjaLine);
    if (!inflationLine) {
      console.warn('❌ Nie znaleziono wybranej linii inflacji');
      setErrorDialogMessage('Nie znaleziono wybranej linii inflacji. Sprawdź dane w zakładce Inflacja.');
      setShowErrorDialog(true);
      return;
    }

    const reversedInflationVector = [...inflationLine.values].reverse();

    try {
      // 🔥 WAŻNE: Używamy ORYGINALNYCH danych exposure (bez inflacji) do obliczeń
      const selectedRow = sourceTriangle[selectedLine];
      if (!selectedRow) {
        console.warn('❌ Nie znaleziono wybranego wiersza w oryginalnych danych exposure');
        setErrorDialogMessage('Nie znaleziono wybranego wiersza ekspozycji w danych źródłowych.');
        setShowErrorDialog(true);
        return;
      }

      console.log('🔍 [ExposureTab] Oryginalny selectedRow (bez inflacji):', selectedRow);
      
      // Pokaż wszystkie kolumny przed filtrowaniem
      const allColKeys = Object.keys(selectedRow).map(Number).sort((a, b) => a - b);
      console.log('🔍 [ExposureTab] Wszystkie kolumny przed filtrowaniem:', allColKeys);
      
      // Pokaż kolumny po filtrowaniu (bez kolumny 0)
      const filteredColKeys = allColKeys.filter(colIndex => colIndex !== 0);
      console.log('🔍 [ExposureTab] Kolumny po filtrowaniu (bez kolumny 0):', filteredColKeys);

      // Konwersja wiersza na tablicę liczb (POMIJAMY KOLUMNĘ 0 - ETYKIETĘ)
      const exposureVector: (number | null)[] = Object.keys(selectedRow)
        .map(Number)
        .sort((a, b) => a - b)
        .filter(colIndex => colIndex !== 0) // ← POMIJAMY KOLUMNĘ 0 (etykiety)
        .map(colIndex => {
          const cellValue = selectedRow[colIndex] ?? null;
          if (typeof cellValue === 'number' || cellValue === null) {
            return cellValue;
          }

          const parsedValue = parsePolishNumber(cellValue);
          return parsedValue !== null ? parsedValue : null;
        });
        
      console.log('🔍 [ExposureTab] Finalny exposureVector (bez kolumny 0):', exposureVector);
      console.log('🔍 [ExposureTab] Długość exposureVector:', exposureVector.length);

      // Przygotowanie requestu dla backendu
      const inflationRequest = {
        user_id: userId,
        inflationVector: reversedInflationVector,
        exposureVector: exposureVector
      };

      console.log('📊 [ExposureTab] Request do backendu - podstawowe info:', {
        userId: inflationRequest.user_id,
        inflationVectorLength: reversedInflationVector.length,
        exposureVectorLength: exposureVector.length,
        selectedExposureLine: selectedLine
      });

      console.log('🚀 [ExposureTab] DOKŁADNY REQUEST WYSYŁANY NA BACKEND /calc/exposure/inflation:', {
        user_id: inflationRequest.user_id,
        inflationVector: inflationRequest.inflationVector,
        exposureVector: inflationRequest.exposureVector
      });

      // Wywołanie API endpointu
      const response = await fetch(buildApiUrl('/calc/exposure/inflation'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(inflationRequest),
      });
      
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Endpoint nie istnieje (404). Sprawdź czy backend ma zaimplementowany endpoint /calc/exposure/inflation`);
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      
      console.log('✅ [ExposureTab] Odpowiedź z backendu:', result);
      
      // Zapisz wynik inflacji do stanu lokalnego - sprawdź różne możliwe nazwy pól
      let adjustedVector = null;
      if (result.adjustedExposure) {
        adjustedVector = result.adjustedExposure;
      } else if (result.adjustedExposureVector) {
        adjustedVector = result.adjustedExposureVector;
      } else if (result.adjusted_exposure_vector) {
        adjustedVector = result.adjusted_exposure_vector;
      } else if (result.result) {
        adjustedVector = result.result;
      } else if (result.adjustedVector) {
        adjustedVector = result.adjustedVector;
      }
      
      console.log('📊 [ExposureTab] Znaleziony skorygowany wektor:', adjustedVector);
      
      if (adjustedVector) {
        setInflationResult(adjustedVector);

        const rowNameValue = selectedRow[0];
        const rowName = rowNameValue !== null && rowNameValue !== undefined
          ? String(rowNameValue)
          : `Wiersz ${selectedLine + 1}`;
        const appliedColumnLabels = adjustedVector.map((_: unknown, index: number) => {
          const colIndex = filteredColKeys[index];
          if (colIndex === undefined) {
            return String(index + 1);
          }
          return columnLabels[colIndex] ?? String(index + 1);
        });
        setAppliedInflationPreview({ rowName, columnLabels: appliedColumnLabels });
        
        // 🔥 NADPISZ WYBRANY WIERSZ W EXPOSURE TRIANGLE SKORYGOWANYMI WARTOŚCIAMI
        const updatedTriangle = { ...sourceTriangle };
        const updatedRow = { ...updatedTriangle[selectedLine] };
        
        console.log('🔍 [ExposureTab] Przed nadpisaniem - updatedRow:', updatedRow);
        console.log('🔍 [ExposureTab] AdjustedVector ma elementów:', adjustedVector.length);
        
        // Zachowaj etykietę z kolumny 0, ale nadpisz pozostałe kolumny skorygowanymi wartościami
        // TYLKO dla kolumn 1 do 1+adjustedVector.length
        const startCol = 1; // Zaczynamy od kolumny 1 (pomijamy kolumnę 0 z etykietą)
        
        // Wyczyść wszystkie stare kolumny oprócz etykiety
        const colKeys = Object.keys(updatedRow).map(Number).sort((a, b) => a - b);
        colKeys.forEach(colIndex => {
          if (colIndex !== 0) { // Nie usuwaj etykiety
            delete updatedRow[colIndex];
          }
        });
        
        // Wstaw nowe wartości rozpoczynając od kolumny 1
        for (let i = 0; i < adjustedVector.length; i++) {
          updatedRow[startCol + i] = adjustedVector[i];
        }
        
        updatedTriangle[selectedLine] = updatedRow;
        setExposureTriangle(updatedTriangle);
        
        console.log('🔍 [ExposureTab] Po nadpisaniu - updatedRow:', updatedRow);
        console.log('🔄 [ExposureTab] Nadpisano exposure triangle skorygowanymi wartościami:', updatedTriangle[selectedLine]);
        
      } else {
        console.warn('⚠️ [ExposureTab] Nie znaleziono skorygowanego wektora w odpowiedzi:', Object.keys(result));
        
        // 🔧 TYMCZASOWY MOCK DO DEBUGOWANIA - pokaż przykładową tabelę
        const mockResult = exposureVector.map((value, index) => 
          value !== null ? value * (1.05 + index * 0.01) : null
        );
        setInflationResult(mockResult);
        const rowNameValue = selectedRow[0];
        const rowName = rowNameValue !== null && rowNameValue !== undefined
          ? String(rowNameValue)
          : `Wiersz ${selectedLine + 1}`;
        const appliedColumnLabels = mockResult.map((_, index) => {
          const colIndex = filteredColKeys[index];
          if (colIndex === undefined) {
            return String(index + 1);
          }
          return columnLabels[colIndex] ?? String(index + 1);
        });
        setAppliedInflationPreview({ rowName, columnLabels: appliedColumnLabels });
        console.log('🔧 [DEBUG] Używam mock wynik:', mockResult);
        
      }
      
    } catch (error) {
      console.warn('❌ [ExposureTab] Błąd podczas przygotowywania requestu:', error);
      const errorMessage = error instanceof Error ? error.message : 'Nieznany błąd podczas nakładania inflacji.';
      const normalizedMessage =
        errorMessage.toLowerCase().includes('failed to fetch')
          ? `Brak połączenia z backendem inflacji (${getApiBaseUrl()}). Sprawdź, czy backend działa i czy jest dostępny w sieci.`
          : errorMessage;
      setErrorDialogMessage(normalizedMessage);
      setShowErrorDialog(true);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Nagłówek */}
      <div className="text-white text-lg font-medium border-b border-gray-700 pb-2">
        Ekspozycja
      </div>

      <div>
        {/* ---------- FORMULARZ ---------- */}
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col gap-4"
        >
        <Card className="bg-[#1f2f49] border-slate-600">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="bg-blue-500 text-white rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold">1</span>
              Wprowadź trójkąt danych ekspozycji
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* --- Plik --- */}
            <div className="flex items-center gap-4">
              <input
                type="file"
                accept=".xlsx,.xls"
                className="border p-2 rounded-lg"
                {...register('file')}
              />
              <Button
                type="button"
                onClick={handleFileLoad}
                disabled={!file || file.length === 0}
                className="bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:from-blue-700 hover:to-blue-600"
              >
                Załaduj plik
              </Button>
              {uploadedFileName && (
                <span className="text-sm text-green-400 ml-2">
                  Wczytano: <strong>{uploadedFileName}</strong>
                </span>
              )}
            </div>

            {/* --- Arkusz --- */}
            <div>
              <Label>Wybór arkusza</Label>
              <Select
                value={selectedSheetName}
                onValueChange={(newSheetName) => {
                  setSelectedSheetName(newSheetName);
                  // Reset danych przy zmianie arkusza
                  setPreviewExposureTriangle({});
                  setSelectedExposureLine(null);
                }}
                disabled={availableSheetNames.length === 0}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Wybierz arkusz..." />
                </SelectTrigger>
                <SelectContent>
                  {availableSheetNames.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <CardHeader>
              <CardTitle>Podaj zakres danych, które chcesz wczytać.</CardTitle>
            </CardHeader>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Wiersz początkowy</Label>
                <Input
                  type="number"
                  {...register('rowStart')}
                />
              </div>
              <div>
                <Label>Wiersz końcowy</Label>
                <Input
                  type="number"
                  {...register('rowEnd')}
                />
              </div>
              <div>
                <Label>Kolumna początkowa</Label>
                <Input
                  type="number"
                  {...register('colStart')}
                />
              </div>
              <div>
                <Label>Kolumna końcowa</Label>
                <Input
                  type="number"
                  {...register('colEnd')}
                />
              </div>
            </div>

            <div className="flex gap-4">
              <Button
                type="button"
                onClick={handleAutoRange}
                variant="outline"
                disabled={!selectedSheetName}
                className="bg-gray-500 text-white"
              >
                Wykryj zakres automatycznie
              </Button>
              
              <Button
                type="button"
                onClick={handleLoadData}
                disabled={!selectedSheetName}
                className="bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:from-blue-700 hover:to-blue-600"
              >
                Wczytaj dane
              </Button>
            </div>

            {/* ---------- PODGLĄD I WYBÓR LINII (ETAP 2) ---------- */}
            {isDataLoaded && Object.keys(previewData).length > 0 && (
              <div className="mt-6 space-y-4 border-t pt-6">
                <h4 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                  <span className="bg-blue-500 text-white rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold">2</span>
                  Wybierz wiersz, który zostanie wykorzystany w obliczeniach
                </h4>
                
                <div className="space-y-2">
                </div>

                {/* Podgląd tabeli */}
                <div className="max-h-96 overflow-auto border border-slate-500 rounded bg-slate-700/70 text-slate-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className="border px-2 py-1 text-center">Wybór</th>
                        <th className="border px-2 py-1 text-left min-w-[140px]">LoB</th>
                        {visibleColumnIndices.map((colIndex) => (
                          <th key={colIndex} className="border px-2 py-1 text-center">
                            {columnLabels[colIndex]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map(([rowIndex, rowData]) => (
                        <tr key={rowIndex} className={parseInt(rowIndex) === selectedLineForSubmit ? 'bg-green-200 text-black font-bold' : 'hover:bg-slate-600/60'}>
                          <td className="border px-2 py-1 text-center">
                            <button
                              type="button"
                              onClick={() => setSelectedExposureLine(parseInt(rowIndex))}
                              className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white/10"
                              aria-label={`Wybierz wiersz ${parseInt(rowIndex) + 1}`}
                            >
                              <span
                                className={`h-2.5 w-2.5 rounded-full ${parseInt(rowIndex) === selectedLineForSubmit ? 'bg-blue-500' : 'bg-transparent'}`}
                              />
                            </button>
                          </td>
                          <td className="border px-2 py-1 text-left font-medium whitespace-nowrap">
                            {rowData[0] !== null && rowData[0] !== undefined ? String(rowData[0]) : `Wiersz ${parseInt(rowIndex) + 1}`}
                          </td>
                          {visibleColumnIndices.map((colIndex) => (
                            <td key={colIndex} className="border px-2 py-1 text-center">
                              {rowData[colIndex] !== null && rowData[colIndex] !== undefined ? rowData[colIndex] : ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                
                {/* Przycisk przejścia do analizy */}
                <div className="flex flex-col items-start gap-3">
                  <label className="inline-flex items-center gap-2 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={applyInflationOnAccept}
                      onChange={(e) => setApplyInflationOnAccept(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-400 bg-slate-800 accent-orange-500"
                    />
                    Nałóż inflację
                  </label>
                  <Button
                    type="submit"
                    className="bg-gradient-to-r from-emerald-600 to-emerald-500 text-white px-8 py-3 text-lg hover:from-emerald-700 hover:to-emerald-600"
                    disabled={selectedLineForSubmit === null}
                  >
                    Zaakceptuj
                  </Button>
                </div>

                {inflationResult && appliedInflationPreview && (
                  <Card className="mt-2 bg-[#1f2f49] border-slate-600">
                    <CardHeader>
                      <CardTitle className="text-blue-100 flex items-center gap-2">
                        Wiersz po nałożeniu inflacji
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-auto border border-slate-500 rounded bg-slate-700/70">
                        <table className="w-full text-sm text-white">
                          <thead>
                            <tr className="bg-slate-600">
                              <th className="border border-slate-500 px-2 py-1 text-center font-bold">LoB</th>
                              {appliedInflationPreview.columnLabels.map((label, index) => (
                                <th key={index} className="border border-slate-500 px-2 py-1 text-center font-bold">
                                  {label}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td className="border border-slate-500 px-2 py-1 text-left font-bold bg-slate-600 whitespace-nowrap">
                                {appliedInflationPreview.rowName}
                              </td>
                              {inflationResult.map((value, index) => (
                                <td key={index} className="border border-slate-500 px-2 py-1 text-center bg-slate-500">
                                  {value !== null ? value.toFixed(2) : ''}
                                </td>
                              ))}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </CardContent>
        </Card>

      </form>

      {/* ---------- ALERTY ---------- */}
      {/* Sukces (zielony) */}
      <AlertDialog open={showSuccessDialog} onOpenChange={setShowSuccessDialog}>
        <AlertDialogContent>
          <AlertDialogHeader className="flex flex-col items-center">
            <VisuallyHidden>
              <AlertDialogTitle>Powiadomienie</AlertDialogTitle>
            </VisuallyHidden>
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-green-100 mb-4">
              <svg
                className="w-6 h-6 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <AlertDialogDescription className="text-center text-green-600 font-medium">
              Dane ekspozycji zostały pomyślnie wczytane i przetworzone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>OK</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Błąd (czerwony) */}
      <AlertDialog open={showErrorDialog} onOpenChange={setShowErrorDialog}>
        <AlertDialogContent>
          <AlertDialogHeader className="flex flex-col items-center">
            <VisuallyHidden>
              <AlertDialogTitle>Błąd danych</AlertDialogTitle>
            </VisuallyHidden>
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mb-4">
              <svg
                className="w-6 h-6 text-red-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </div>
            <AlertDialogDescription className="text-center text-red-600 font-medium">
              {errorDialogMessage}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Zamknij</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      </div>
    </div>
  );
}
