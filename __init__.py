'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as XLSX from 'xlsx';
import { useState, useEffect } from 'react';
import { useInflacjaStore } from '@/stores/inflacjaStore';
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

export function InflacjaTab() {
  const {
    inflacjaTriangle,
    workbook,
    availableSheetNames,
    selectedSheetName,
    uploadedFileName,
    decimalPlaces,
    selectedInflacjaLine,
    setInflacjaTriangle,
    setWorkbook,
    setAvailableSheetNames,
    setSelectedSheetName,
    setUploadedFileName,
    setSelectedInflacjaLine,
    resetData
  } = useInflacjaStore();

  // Stan lokalny formularza
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [showErrorDialog, setShowErrorDialog] = useState(false);
  const [previewData, setPreviewData] = useState<{ [rowIndex: number]: { [colIndex: number]: number | string | null } }>({});
  const [isDataLoaded, setIsDataLoaded] = useState(false); // Nowy stan dla kontroli etapów
  // Używamy selectedInflacjaLine z store zamiast lokalnego stanu
  const selectedLineForSubmit = selectedInflacjaLine;

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

  const firstVisibleRow = previewRows[0]?.[1];
  const visibleColumnIndices = firstVisibleRow
    ? Object.keys(firstVisibleRow)
        .map(Number)
        .sort((a, b) => a - b)
        .filter((colIndex) => colIndex !== 0)
    : [];

  // Załaduj podgląd przy inicjalizacji jeśli mamy już dane w store
  useEffect(() => {
    if (Object.keys(inflacjaTriangle).length > 0) {
      setPreviewData(inflacjaTriangle);
      setIsDataLoaded(true); // Jeśli są dane w store, oznacz jako załadowane
    }
  }, [inflacjaTriangle]);

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
      setIsDataLoaded(false);
      setPreviewData({});
    };

    reader.readAsArrayBuffer(selectedFile);
  };

  // Funkcja wczytywania danych (Etap 1)
  const handleLoadData = () => {
    if (!workbook || !selectedSheetName) return;

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
            const numValue = Number(value);
            triangleData[i]![j] = Number.isFinite(numValue) ? numValue : value; // Zachowaj string label
          } else {
            triangleData[i]![j] = null;
          }
        }
      }

      console.log('🔍 [InflacjaTab] handleLoadData triangleData:', triangleData);
      
      setPreviewData(triangleData);
      setInflacjaTriangle(triangleData);
      setIsDataLoaded(true); // Oznacz dane jako załadowane
    } catch (error) {
      console.error('Błąd podczas wczytywania danych inflacji:', error);
      setShowErrorDialog(true);
    }
  };

  // Funkcja automatycznego wykrywania zakresu
  const handleAutoRange = () => {
    if (!workbook || !selectedSheetName) return;

    const worksheet = workbook.Sheets[selectedSheetName];
    if (!worksheet) return;

    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
    setValue('rowStart', range.s.r + 1);
    setValue('rowEnd', range.e.r + 1);
    setValue('colStart', range.s.c + 1);
    setValue('colEnd', range.e.c + 1);
  };

  // Funkcja przetwarzania danych
  const onSubmit = (data: FormField) => {
    if (!workbook || !selectedSheetName) return;

    const worksheet = workbook.Sheets[selectedSheetName];
    if (!worksheet) return;

    try {
      // Pobierz dane z zakresu
      const rangeString = XLSX.utils.encode_range({
        s: { r: data.rowStart - 1, c: data.colStart - 1 },
        e: { r: data.rowEnd - 1, c: data.colEnd - 1 }
      });

      const rawData = XLSX.utils.sheet_to_json(worksheet, {
        range: rangeString,
        header: 1,
        defval: null
      }) as any[][];

      // Przetwórz dane na format trójkąta
      const triangleData: { [rowIndex: number]: { [colIndex: number]: number | string | null } } = {};
      
      // Przetwarzamy wszystkie dane bez pomijania nagłówków
      for (let i = 0; i < rawData.length; i++) {
        const row = rawData[i];
        if (!row) continue;
        
        triangleData[i] = {};
        
        for (let j = 0; j < row.length; j++) {
          const value = row[j];
          if (value !== null && value !== undefined && value !== '') {
            const numValue = Number(value);
            // ZACHOWAJ STRINGI TAK SAMO JAK W handleLoadData!
            triangleData[i]![j] = Number.isFinite(numValue) ? numValue : value;
          } else {
            triangleData[i]![j] = null;
          }
        }
      }

      console.log('🔍 [InflacjaTab] onSubmit triangleData:', triangleData);
      console.log('🔍 [InflacjaTab] selectedLineForSubmit:', selectedLineForSubmit);

      setInflacjaTriangle(triangleData);
      // Zapisz też wybraną linię parametrów
      if (selectedLineForSubmit !== null) {
        setSelectedInflacjaLine(selectedLineForSubmit);
      }
      setShowSuccessDialog(true);
    } catch (error) {
      console.error('Błąd podczas przetwarzania danych inflacji:', error);
      setShowErrorDialog(true);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Nagłówek */}
      <div className="text-white text-lg font-medium border-b border-gray-700 pb-2">
        Inflacja
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
              Wprowadź współczynniki inflacji
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
                  setIsDataLoaded(false);
                  setPreviewData({});
                  setSelectedInflacjaLine(null);
                }}
                disabled={!workbook}
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
                  disabled={!workbook}
                  {...register('rowStart')}
                />
              </div>
              <div>
                <Label>Wiersz końcowy</Label>
                <Input
                  type="number"
                  disabled={!workbook}
                  {...register('rowEnd')}
                />
              </div>
              <div>
                <Label>Kolumna początkowa</Label>
                <Input
                  type="number"
                  disabled={!workbook}
                  {...register('colStart')}
                />
              </div>
              <div>
                <Label>Kolumna końcowa</Label>
                <Input
                  type="number"
                  disabled={!workbook}
                  {...register('colEnd')}
                />
              </div>
            </div>

            <div className="flex gap-4">
              <Button
                type="button"
                onClick={handleAutoRange}
                variant="outline"
                disabled={!workbook}
                className="bg-gray-500 text-white"
              >
                Wykryj zakres automatycznie
              </Button>
              
              <Button
                type="button"
                onClick={handleLoadData}
                disabled={!workbook || !selectedSheetName}
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
                
                {/* Selektor linii */}
                <div className="space-y-2">
                </div>

                {/* Podgląd tabeli */}
                <div className="max-h-96 overflow-auto border border-slate-500 rounded bg-slate-700/70 text-slate-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className="border px-2 py-1 text-center">Wybór</th>
                        <th className="border px-2 py-1 text-left">Nazwa wiersza</th>
                        {visibleColumnIndices.map((colIndex, displayIndex) => (
                          <th key={colIndex} className="border px-2 py-1 text-center">
                            {displayIndex + 1}
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
                              onClick={() => setSelectedInflacjaLine(parseInt(rowIndex))}
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
                <div className="flex justify-start">
                  <Button
                    type="submit"
                    className="bg-gradient-to-r from-emerald-600 to-emerald-500 text-white px-8 py-3 text-lg hover:from-emerald-700 hover:to-emerald-600"
                    disabled={selectedLineForSubmit === null}
                  >
                    Zaakceptuj
                  </Button>
                </div>
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
              Dane współczynników inflacji zostały pomyślnie wczytane i przetworzone.
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
              Wystąpił błąd podczas przetwarzania współczynników inflacji. Sprawdź format pliku!
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
