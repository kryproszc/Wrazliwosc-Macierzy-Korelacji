"use client";

import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { VisuallyHidden } from "@/components/ui/visually-hidden";
import { useParamsymStore } from "@/stores/paramsymStore";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import * as XLSX from "xlsx";
import { z } from "zod";

const schema = z.object({
	rowStart: z.coerce.number().min(1),
	rowEnd: z.coerce.number().min(1),
	colStart: z.coerce.number().min(1),
	colEnd: z.coerce.number().min(1),
	file: z.any(),
});
type FormField = z.infer<typeof schema>;

function detectNetBruttoHeaderRowIndex(rawData: unknown[][]): number {
	const normalize = (value: unknown) => String(value ?? "").trim().toLowerCase();

	for (let rowIndex = 0; rowIndex < rawData.length; rowIndex += 1) {
		const row = rawData[rowIndex] ?? [];
		const firstCell = normalize(row[0]);

		if (!firstCell) {
			continue;
		}

		const tailValues = row.slice(1).filter((value) => {
			const text = String(value ?? "").trim();
			return text !== "";
		});

		if (tailValues.length === 0) {
			continue;
		}

		const hasNumericTail = tailValues.some((value) => {
			const parsed = Number(String(value).replace(",", "."));
			return Number.isFinite(parsed);
		});

		const looksLikeHeader =
			firstCell.includes("lob") ||
			firstCell.includes("line") ||
			firstCell.includes("gross") ||
			firstCell.includes("net") ||
			hasNumericTail;

		if (looksLikeHeader) {
			return rowIndex;
		}
	}

	return 0;
}

export function NetBruttoTab() {
	const {
		paramsymTriangle,
		workbook,
		availableSheetNames,
		previewParamsymTriangle,
		selectedSheetName,
		uploadedFileName,
		decimalPlaces,
		selectedParamsymLine,
		setParamsymTriangle,
		setWorkbook,
		setAvailableSheetNames,
		setPreviewParamsymTriangle,
		setSelectedSheetName,
		setUploadedFileName,
		setSelectedParamsymLine,
		resetData,
	} = useParamsymStore();

	// Stan lokalny formularza
	const [showSuccessDialog, setShowSuccessDialog] = useState(false);
	const [showErrorDialog, setShowErrorDialog] = useState(false);
	const [errorDialogMessage, setErrorDialogMessage] = useState(
		"Wystąpił błąd podczas przetwarzania współczynników netto/brutto. Sprawdź format pliku!",
	);
	const previewData = previewParamsymTriangle;
	const isDataLoaded = Object.keys(previewData).length > 0;
	// Używamy selectedParamsymLine z store zamiast lokalnego stanu
	const selectedLineForSubmit = selectedParamsymLine;

	const {
		register,
		handleSubmit,
		setValue,
		watch,
		formState: { errors },
	} = useForm<FormField>({
		resolver: zodResolver(schema),
		defaultValues: {
			rowStart: 1,
			rowEnd: 11,
			colStart: 1,
			colEnd: 11,
		},
	});

	const file = watch("file");

	const sortedPreviewEntries = Object.entries(previewData).sort(
		([a], [b]) => Number(a) - Number(b),
	);

	// Pierwszy wczytany wiersz zawsze traktujemy jako nagłówek (nazwy kolumn)
	const headerRow = sortedPreviewEntries[0];

	const previewRows = sortedPreviewEntries.slice(1).filter(([, rowData]) => {
		const firstCell = rowData[0];
		return (
			firstCell !== null &&
			firstCell !== undefined &&
			String(firstCell).trim() !== ""
		);
	});

	const visibleColumnIndices = Array.from(
		new Set(
			previewRows.flatMap(([, rowData]) =>
				Object.keys(rowData)
					.map(Number)
					.filter((colIndex) => colIndex !== 0),
			),
		),
	).sort((a, b) => a - b);

	const columnLabels: Record<number, string> = Object.fromEntries(
		visibleColumnIndices.map((colIndex, displayIndex) => {
			const rawHeaderValue = headerRow?.[1][colIndex];
			const label =
				rawHeaderValue !== null &&
				rawHeaderValue !== undefined &&
				String(rawHeaderValue).trim() !== ""
					? String(rawHeaderValue)
					: String(displayIndex + 1);
			return [colIndex, label];
		}),
	);

	// Załaduj podgląd przy inicjalizacji jeśli mamy już dane w store
	useEffect(() => {
		if (Object.keys(previewParamsymTriangle).length > 0) {
			return;
		}

		if (Object.keys(paramsymTriangle).length > 0) {
			setPreviewParamsymTriangle(paramsymTriangle);
		}
	}, [previewParamsymTriangle, paramsymTriangle, setPreviewParamsymTriangle]);

	// Funkcja ładowania pliku
	const handleFileLoad = () => {
		if (!file || file.length === 0) return;

		const selectedFile = file[0];
		const reader = new FileReader();

		reader.onload = (e) => {
			const data = new Uint8Array(e.target?.result as ArrayBuffer);
			const wb = XLSX.read(data, { type: "array" });
			setWorkbook(wb);
			setAvailableSheetNames(wb.SheetNames);
			setSelectedSheetName(wb.SheetNames[0] || "");
			setUploadedFileName(selectedFile.name);

			// Resetuj stan załadowania danych
			setPreviewParamsymTriangle({});
		};

		reader.readAsArrayBuffer(selectedFile);
	};

	// Funkcja wczytywania danych (Etap 1)
	const handleLoadData = () => {
		if (!workbook || !selectedSheetName) {
			setErrorDialogMessage(
				"Brak aktywnego pliku w pamięci. Załaduj plik ponownie, aby wczytać dane z arkusza.",
			);
			setShowErrorDialog(true);
			return;
		}

		const worksheet = workbook.Sheets[selectedSheetName];
		if (!worksheet) {
			setErrorDialogMessage(
				"Nie znaleziono arkusza w pamięci. Wybierz inny arkusz lub załaduj plik ponownie.",
			);
			setShowErrorDialog(true);
			return;
		}

		try {
			// Użyj wartości z formularza
			const formData = watch();
			const rangeString = XLSX.utils.encode_range({
				s: { r: (formData.rowStart || 1) - 1, c: (formData.colStart || 1) - 1 },
				e: { r: (formData.rowEnd || 11) - 1, c: (formData.colEnd || 11) - 1 },
			});

			const rawData = XLSX.utils.sheet_to_json(worksheet, {
				range: rangeString,
				header: 1,
				defval: null,
			}) as unknown[][];

			if (rawData.length === 0) {
				setErrorDialogMessage(
					"Wybrany zakres nie zawiera danych. Zmień zakres i spróbuj ponownie.",
				);
				setShowErrorDialog(true);
				return;
			}

			const headerRowIndex = detectNetBruttoHeaderRowIndex(rawData);
			const rawDataFromHeader = rawData.slice(headerRowIndex);

			if (rawDataFromHeader.length === 0) {
				setErrorDialogMessage(
					"Nie udało się odnaleźć nagłówka netto/brutto w wybranym zakresie.",
				);
				setShowErrorDialog(true);
				return;
			}

			// Przetwórz dane na format trójkąta dla podglądu
			const triangleData: {
				[rowIndex: number]: { [colIndex: number]: number | string | null };
			} = {};

			for (let i = 0; i < rawDataFromHeader.length; i++) {
				const rawRow = rawDataFromHeader[i];
				if (!rawRow) continue;

				const row: { [colIndex: number]: number | string | null } = {};

				for (let j = 0; j < rawRow.length; j++) {
					const value = rawRow[j];
					if (value !== null && value !== undefined && value !== "") {
						const numValue = Number(value);
						row[j] = Number.isFinite(numValue)
							? numValue
							: (value as string | number);
					} else {
						row[j] = null;
					}
				}

				triangleData[i] = row;
			}

			console.log(
				"🔍 [NetBruttoTab] handleLoadData triangleData:",
				triangleData,
			);
			console.log("🔍 [NetBruttoTab] Wykryty nagłówek netto/brutto w wierszu:", {
				headerRowInSelection: headerRowIndex + 1,
				headerRowInSheet: (formData.rowStart || 1) + headerRowIndex,
			});

			setPreviewParamsymTriangle(triangleData);
		} catch (error) {
			console.warn("Błąd podczas wczytywania danych netto/brutto:", error);
			setErrorDialogMessage(
				"Wystąpił błąd podczas wczytywania danych do podglądu. Sprawdź zakres i format arkusza.",
			);
			setShowErrorDialog(true);
		}
	};

	// Funkcja automatycznego wykrywania zakresu
	const handleAutoRange = () => {
		if (!workbook || !selectedSheetName) {
			setErrorDialogMessage(
				"Brak aktywnego pliku w pamięci. Załaduj plik ponownie, aby wykryć zakres automatycznie.",
			);
			setShowErrorDialog(true);
			return;
		}

		const worksheet = workbook.Sheets[selectedSheetName];
		if (!worksheet) return;

		const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1:A1");
		setValue("rowStart", range.s.r + 1);
		setValue("rowEnd", range.e.r + 1);
		setValue("colStart", range.s.c + 1);
		setValue("colEnd", range.e.c + 1);
	};

	// Funkcja przetwarzania danych
	const onSubmit = (_data: FormField) => {
		try {
			// Akceptuj to, co użytkownik realnie widzi w podglądzie (krok 2)
			const triangleData = previewData;

			if (Object.keys(triangleData).length === 0) {
				setErrorDialogMessage(
					"Brak wczytanych danych podglądu. Kliknij najpierw Wczytaj dane.",
				);
				setShowErrorDialog(true);
				return;
			}

			console.log("🔍 [NetBruttoTab] onSubmit triangleData:", triangleData);

			setParamsymTriangle(triangleData);
			// Pobierz najnowszy wybór linii w momencie submit
			const latestSelectedLine =
				useParamsymStore.getState().selectedParamsymLine;
			if (latestSelectedLine !== null) {
				setSelectedParamsymLine(latestSelectedLine);
			}
			setShowSuccessDialog(true);
		} catch (error) {
			console.warn("Błąd podczas przetwarzania danych netto/brutto:", error);
			setErrorDialogMessage(
				"Wystąpił błąd podczas przetwarzania współczynników netto/brutto. Sprawdź format pliku!",
			);
			setShowErrorDialog(true);
		}
	};

	return (
		<div className="flex flex-col gap-6">
			{/* Nagłówek */}
			<div className="border-gray-700 border-b pb-2 font-medium text-lg text-white">
				Netto/Brutto
			</div>

			<div>
				{/* ---------- FORMULARZ ---------- */}
				<form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
					<Card className="border-slate-600 bg-[#1f2f49]">
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500 font-bold text-sm text-white">
									1
								</span>
								Etap 1: Wprowadź współczynniki netto/brutto
							</CardTitle>
						</CardHeader>
						<CardContent className="space-y-4">
							{/* --- Plik --- */}
							<div className="flex items-center gap-4">
								<input
									type="file"
									accept=".xlsx,.xls"
									className="rounded-lg border p-2"
									{...register("file")}
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
									<span className="ml-2 text-green-400 text-sm">
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
										setPreviewParamsymTriangle({});
										setSelectedParamsymLine(null);
									}}
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
								<CardTitle>
									Podaj zakres danych, które chcesz wczytać.
								</CardTitle>
							</CardHeader>

							<div className="grid grid-cols-2 gap-4">
								<div>
									<Label>Wiersz początkowy</Label>
									<Input type="number" {...register("rowStart")} />
								</div>
								<div>
									<Label>Wiersz końcowy</Label>
									<Input type="number" {...register("rowEnd")} />
								</div>
								<div>
									<Label>Kolumna początkowa</Label>
									<Input type="number" {...register("colStart")} />
								</div>
								<div>
									<Label>Kolumna końcowa</Label>
									<Input type="number" {...register("colEnd")} />
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
									<h4 className="flex items-center gap-2 font-semibold text-lg text-slate-100">
										<span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500 font-bold text-sm text-white">
											2
										</span>
										Wybierz wiersz, który zostanie wykorzystany w obliczeniach
									</h4>

									<div className="max-h-96 overflow-auto rounded border border-slate-500 bg-slate-700/70 text-slate-100">
										<table className="w-full text-sm">
											<thead>
												<tr>
													<th className="border px-2 py-1 text-center">
														Wybór
													</th>
													<th className="min-w-[140px] border px-2 py-1 text-left">
														LoB
													</th>
													{visibleColumnIndices.map((colIndex) => (
														<th
															key={colIndex}
															className="border px-2 py-1 text-center"
														>
															{columnLabels[colIndex]}
														</th>
													))}
												</tr>
											</thead>
											<tbody>
												{previewRows.map(([rowIndex, rowData]) => (
													<tr
														key={rowIndex}
														className={
															Number.parseInt(rowIndex) ===
															selectedLineForSubmit
																? "bg-green-200 font-bold text-black"
																: "hover:bg-slate-600/60"
														}
													>
														<td className="border px-2 py-1 text-center">
															<button
																type="button"
																onClick={() =>
																	setSelectedParamsymLine(
																		Number.parseInt(rowIndex),
																	)
																}
																className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white/10"
																aria-label={`Wybierz wiersz ${Number.parseInt(rowIndex) + 1}`}
															>
																<span
																	className={`h-2.5 w-2.5 rounded-full ${Number.parseInt(rowIndex) === selectedLineForSubmit ? "bg-blue-500" : "bg-transparent"}`}
																/>
															</button>
														</td>
														<td className="whitespace-nowrap border px-2 py-1 text-left font-medium">
															{rowData[0] !== null && rowData[0] !== undefined
																? String(rowData[0])
																: `Wiersz ${Number.parseInt(rowIndex) + 1}`}
														</td>
														{visibleColumnIndices.map((colIndex) => (
															<td
																key={colIndex}
																className="border px-2 py-1 text-center"
															>
																{rowData[colIndex] !== null &&
																rowData[colIndex] !== undefined
																	? rowData[colIndex]
																	: ""}
															</td>
														))}
													</tr>
												))}
											</tbody>
										</table>
									</div>

									{/* Przycisk akceptacji */}
								<div className="flex justify-start">
										<Button
											type="submit"
											className="bg-gradient-to-r from-emerald-600 to-emerald-500 px-8 py-3 text-lg text-white hover:from-emerald-700 hover:to-emerald-600"
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
				<AlertDialog
					open={showSuccessDialog}
					onOpenChange={setShowSuccessDialog}
				>
					<AlertDialogContent>
						<AlertDialogHeader className="flex flex-col items-center">
							<VisuallyHidden>
								<AlertDialogTitle>Powiadomienie</AlertDialogTitle>
							</VisuallyHidden>
							<div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
								<svg
									className="h-6 w-6 text-green-600"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<title>Sukces</title>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth="2"
										d="M5 13l4 4L19 7"
									/>
								</svg>
							</div>
							<AlertDialogDescription className="text-center font-medium text-green-600">
								Dane współczynników netto/brutto zostały pomyślnie wczytane i
								przetworzone.
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
							<div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
								<svg
									className="h-6 w-6 text-red-600"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<title>Błąd</title>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth="2"
										d="M6 18L18 6M6 6l12 12"
									/>
								</svg>
							</div>
							<AlertDialogDescription className="text-center font-medium text-red-600">
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
