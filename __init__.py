"use client";

import { useUserStore } from "@/app/_components/useUserStore";
import { DataTypeSelector } from "@/components/DataTypeSelector";
import { HeadersSelector } from "@/components/HeadersSelector";
import { SheetSelectDet } from "@/components/SheetSelectDet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { inflationApiService } from "@/services/inflationApi";
import { useAddCoefficientsStore } from "@/stores/addCoefficientsStore";
import { useAddIncurredCoefficientsStore } from "@/stores/addIncurredCoefficientsStore";
import { useAddPaidStore } from "@/stores/addPaidStore";
import { useCLSimulationStore } from "@/stores/clSimulationStore";
import { useDeterministicIncurredResultsStore } from "@/stores/deterministicIncurredResultsStore";
import { useInflacjaStore } from "@/stores/inflacjaStore";
import { useSimulationResultsStore } from "@/stores/simulationResultsStore";
import { useStochasticPaidSimulationStore } from "@/stores/stochasticPaidSimulationStore";
import { useTrainDevideStoreDet } from "@/stores/trainDevideStoreDeterministyczny";
import { useTrainDevideStoreSummary } from "@/stores/trainDevideStoreSummary";
import { useDetailTableStore } from "@/stores/useDetailTableStore";
import { useLabelsStore } from "@/stores/useLabelsStore";
import { useTrainDevideStoreIncurred } from "@/stores/useTrainDevideStoreIncurred";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import * as XLSX from "xlsx";
import { z } from "zod";

import Modal from "@/components/Modal";
import {
	DataInputDialogs,
	DataInputLoading,
	FileUploadSection,
	isMostlyNonNumeric,
	looksLikeDevPeriods,
	looksLikeYears,
	parsePolishNumber,
} from "@/shared/components/data-input";
import { convertIncrementalToCumulative } from "@/utils/dataConversion";
import { ValidationPresets, validateDataValues } from "@/utils/dataValidation";

const schema = z.object({
	rowStart: z.coerce.number().min(1),
	rowEnd: z.coerce.number().min(1),
	colStart: z.coerce.number().min(1),
	colEnd: z.coerce.number().min(1),
	file: z.any(),
});
type FormField = z.infer<typeof schema>;
type DataFormatMode = "triangle" | "list";

type ListColumnsDetection = {
	headerRowIndex: number;
	lobIndex: number;
	ayIndex: number;
	dyIndex: number;
	amountIndex: number;
};

function detectListColumns(rawData: unknown[][]): ListColumnsDetection | null {
	const normalize = (value: unknown) => String(value ?? "").trim().toLowerCase();

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

		const lobIndex = findColumn(headerRow, ["lob"]);
		const ayIndex = findColumn(headerRow, ["ay", "accident year", "origin year", "rok szkody"]);
		const dyIndex = findColumn(headerRow, [
			"dy",
			"development year",
			"development period",
			"okres rozwoju",
		]);
		const amountIndex = findColumn(headerRow, ["amount", "paid", "wartosc", "value"]);

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

const PAID_TAB_STORAGE_KEY = "deterministic-paid-tab-state";
const PAID_INPUT_UI_STATE_KEY = "deterministic-paid-input-ui-state";
const DETERMINISTIC_INCURRED_TAB_STORAGE_KEY =
	"deterministic-incurred-results-storage";
const STOCHASTIC_PAID_TAB_STORAGE_KEY = "stochastic-paid-simulation-store";
const STOCHASTIC_INCURRED_RESULTS_STORAGE_KEY = "simulation-results-storage";
const STOCHASTIC_INCURRED_STATS_STORAGE_KEY = "cl-simulation-store";

/* ---------- DODATKOWA WALIDACJA (dziury, nienumeryczne itd.) ---------- */
function localValidateDataValues(data: any[][]): boolean {
	// Ta funkcja została przeniesiona do @/utils/dataValidation
	// Używamy teraz importowanej wersji z ValidationPresets dla Paid
	const result = validateDataValues(data, ValidationPresets.paid());
	return result.isValid;
}

/* --------------------------------------------------------------------- */
export function InputDataTabDet() {
	/* ---------- Lokalny UI‑owy stan ---------- */
	const [showDialog, setShowDialog] = useState(false);
	const [showSuccessDialog, setShowSuccessDialog] = useState(false);
	const [showWarningDialog, setShowWarningDialog] = useState(false);
	const [showWarningModal, setShowWarningModal] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [progress, setProgress] = useState(0);
	const [pendingFormData, setPendingFormData] = useState<FormField | null>(
		null,
	);
	const [showInflationErrorModal, setShowInflationErrorModal] = useState(false);
	const [showInflationSuccessModal, setShowInflationSuccessModal] =
		useState(false);
	const [inflationErrorMessage, setInflationErrorMessage] = useState("");
	const [dataFormatMode, setDataFormatMode] =
		useState<DataFormatMode>("triangle");
	const [availableLobs, setAvailableLobs] = useState<string[]>([]);
	const [selectedLob, setSelectedLob] = useState("");
	const [isLobLoaded, setIsLobLoaded] = useState(false);
	const [lobLoadSignature, setLobLoadSignature] = useState("");
	const [isUiStateHydrated, setIsUiStateHydrated] = useState(false);
	const [isRangeStateHydrated, setIsRangeStateHydrated] = useState(false);

	/* ---------- Zustanda – store „detaliczny” ---------- */
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
	} = useDetailTableStore();

	const {
		detRowLabels: rowLabels,
		detColumnLabels: columnLabels,
		setDetRowLabels: setRowLabels,
		setDetColumnLabels: setColumnLabels,
		globalRowLabels,
		globalColumnLabels,
		lastLoadedFile,
	} = useLabelsStore();

	// Store Paid dla funkcji czyszczących
	const paidStore = useTrainDevideStoreDet();
	const incurredStore = useTrainDevideStoreIncurred();
	const summaryStore = useTrainDevideStoreSummary();

	const setPaidTriangle = useTrainDevideStoreDet((s) => s.setPaidTriangle);
	const setPaidTriangle_bez_inf = useTrainDevideStoreDet(
		(s) => s.setPaidTriangle_bez_inf,
	);
	const paidTriangle_bez_inf = useTrainDevideStoreDet(
		(s) => s.paidTriangle_bez_inf,
	);

	// Store dla ustawień input'a - używamy indywidualnych ustawień z detailTableStore
	const {
		dataType,
		setDataType,
		incrementDataGeneration,
		hasHeaders,
		setHasHeaders,
		useInflation,
		setUseInflation,
	} = useDetailTableStore();

	// Store inflacji - do sprawdzania czy są dane
	const { inflacjaTriangle, selectedInflacjaLine, availableInflacjaLines } =
		useInflacjaStore();

	// User ID dla API
	const userId = useUserStore((s) => s.userId);

	/* ---------- React‑hook‑form ---------- */
	const { register, handleSubmit, watch, setValue } = useForm<FormField>({
		resolver: zodResolver(schema),
		defaultValues: {
			rowStart: 1,
			rowEnd: 1,
			colStart: 1,
			colEnd: 1,
		},
	});

	const file = watch("file");
	const rowStartValue = watch("rowStart");
	const rowEndValue = watch("rowEnd");
	const colStartValue = watch("colStart");
	const colEndValue = watch("colEnd");

	const currentLobSignature = [
		uploadedFileName ?? "",
		selectedSheetName ?? "",
		String(rowStartValue ?? ""),
		String(rowEndValue ?? ""),
		String(colStartValue ?? ""),
		String(colEndValue ?? ""),
	].join("|");

	useEffect(() => {
		if (typeof window === "undefined") {
			setIsUiStateHydrated(true);
			return;
		}

		try {
			const rawState = window.sessionStorage.getItem(PAID_INPUT_UI_STATE_KEY);
			if (rawState) {
				const parsedState = JSON.parse(rawState) as {
					dataFormatMode?: DataFormatMode;
					availableLobs?: string[];
					selectedLob?: string;
					isLobLoaded?: boolean;
					lobLoadSignature?: string;
				};

				if (parsedState.dataFormatMode) {
					setDataFormatMode(parsedState.dataFormatMode);
				}
				setAvailableLobs(parsedState.availableLobs ?? []);
				setSelectedLob(parsedState.selectedLob ?? "");
				setIsLobLoaded(Boolean(parsedState.isLobLoaded));
				setLobLoadSignature(parsedState.lobLoadSignature ?? "");
			}
		} catch {
			// Ignore invalid persisted state and continue with defaults.
		}

		setIsUiStateHydrated(true);
	}, []);

	useEffect(() => {
		if (!isUiStateHydrated || typeof window === "undefined") {
			return;
		}

		window.sessionStorage.setItem(
			PAID_INPUT_UI_STATE_KEY,
			JSON.stringify({
				dataFormatMode,
				availableLobs,
				selectedLob,
				isLobLoaded,
				lobLoadSignature,
			}),
		);
	}, [
		isUiStateHydrated,
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

		if (dataFormatMode !== "list") {
			setAvailableLobs([]);
			setSelectedLob("");
			setIsLobLoaded(false);
			setLobLoadSignature("");
			return;
		}

		if (isLobLoaded && lobLoadSignature !== currentLobSignature) {
			setAvailableLobs([]);
			setSelectedLob("");
			setIsLobLoaded(false);
			setLobLoadSignature("");
		}
	}, [
		isUiStateHydrated,
		isRangeStateHydrated,
		dataFormatMode,
		isLobLoaded,
		lobLoadSignature,
		currentLobSignature,
	]);

	const handleLoadLobs = () => {
		if (!workbook || !selectedSheetName) {
			alert("Najpierw załaduj plik i wybierz arkusz.");
			return;
		}

		const worksheet = workbook.Sheets[selectedSheetName];
		if (!worksheet) {
			alert("Nie znaleziono wybranego arkusza.");
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
			alert("W wybranym zakresie brakuje danych do odczytu LoB.");
			setAvailableLobs([]);
			setSelectedLob("");
			setIsLobLoaded(false);
			return;
		}

		const detectedColumns = detectListColumns(rawData);
		if (!detectedColumns) {
			alert(
				'Nie znaleziono nagłówków listy (LoB, AY, DY, Amount) w wybranym zakresie.',
			);
			setAvailableLobs([]);
			setSelectedLob("");
			setIsLobLoaded(false);
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
							value !== null &&
							value !== undefined &&
							String(value).trim() !== "",
					)
					.map((value) => String(value).trim()),
			),
		);

		if (uniqueLobs.length === 0) {
			alert("Nie znaleziono żadnych wartości LoB w wybranym zakresie.");
			setAvailableLobs([]);
			setSelectedLob("");
			setIsLobLoaded(false);
			return;
		}

		setAvailableLobs(uniqueLobs);
		setSelectedLob((prev) =>
			prev && uniqueLobs.includes(prev) ? prev : (uniqueLobs[0] ?? ""),
		);
		setIsLobLoaded(true);
		setLobLoadSignature(currentLobSignature);
	};

	const buildTriangleFromList = (data: FormField) => {
		if (!workbook || !selectedSheetName) {
			return { error: "Najpierw załaduj plik i wybierz arkusz." };
		}

		const worksheet = workbook.Sheets[selectedSheetName];
		if (!worksheet) {
			return { error: "Nie znaleziono wybranego arkusza." };
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
			return { error: "W wybranym zakresie brakuje danych listy." };
		}

		const normalize = (value: unknown) => String(value ?? "").trim();
		const detectedColumns = detectListColumns(rawData);

		if (!detectedColumns) {
			return {
				error:
					"Brak wymaganych kolumn. Oczekiwane: LoB, AY, DY, Amount (lub ich odpowiedniki).",
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
				const parsed = Number(label.replace(",", "."));
				return Number.isFinite(parsed);
			});

			if (allNumeric) {
				return [...labels].sort(
					(a, b) => Number(a.replace(",", ".")) - Number(b.replace(",", ".")),
				);
			}

			return [...labels].sort((a, b) =>
				a.localeCompare(b, "pl", { numeric: true, sensitivity: "base" }),
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

	const clearDeterministicPaidCalculations = () => {
		console.log(
			"🧹 Czyszczę wszystkie dotychczasowe obliczenia (Paid deterministic)...",
		);

		// Wyczyść cache zakładki "Obliczenia deterministyczne -> Paid"
		if (typeof window !== "undefined") {
			window.sessionStorage.removeItem(PAID_TAB_STORAGE_KEY);
			window.sessionStorage.removeItem(DETERMINISTIC_INCURRED_TAB_STORAGE_KEY);
			window.sessionStorage.removeItem(STOCHASTIC_PAID_TAB_STORAGE_KEY);
			window.sessionStorage.removeItem(STOCHASTIC_INCURRED_RESULTS_STORAGE_KEY);
			window.sessionStorage.removeItem(STOCHASTIC_INCURRED_STATS_STORAGE_KEY);
		}

		useDeterministicIncurredResultsStore.getState().clearResults();

		// Wyczyść też stan w pamięci dla stochastycznego Paid (nie tylko cache w sessionStorage)
		const stochasticStore = useStochasticPaidSimulationStore.getState();
		if (userId) {
			stochasticStore.clearResults(userId);
		}
		stochasticStore.clearResults("__anonymous__");
		useSimulationResultsStore.getState().clearResults();
		useCLSimulationStore.getState().clearStatisticsResults();

		// Dane wejściowe i pochodne
		paidStore.setPaidTriangle([]);
		paidStore.setPaidTriangle_bez_inf(null);
		paidStore.setTrainDevideDet(undefined);

		// Wyniki CL/Sigma/SD
		paidStore.setDevJ([]);
		paidStore.setSigma([]);
		paidStore.setSd([]);
		paidStore.clearDevJResults();
		paidStore.clearSigmaResults();
		paidStore.setFinalDevJ(undefined);
		paidStore.setFinalSigma(undefined);
		paidStore.clearAllDevFinalValues();
		paidStore.clearAllSigmaFinalValues();

		// FitCurve + podsumowania
		paidStore.clearFitCurveData();
		paidStore.clearFitCurveSigmaData();
		paidStore.clearDevSummaryData();

		// Tabele porównawcze summary
		summaryStore.clearSummaryData();

		// Wyczyść też obliczenia Incurred, bo bazują na danych paid
		incurredStore.setIncurredTriangle([]);
		incurredStore.setIncurredTriangle_bez_inf(null);
		incurredStore.setReserve(null);
		incurredStore.setTrainDevideIncurred(undefined);
		incurredStore.clearCurrentCoefficientResults();
		incurredStore.clearDevJResults();
		incurredStore.clearSigmaResults();
		incurredStore.setFinalDevJ(undefined);
		incurredStore.setFinalSigma(undefined);
		incurredStore.clearAllDevFinalValues();
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

		// Wyczyść moduł AddPaid (other1): współczynniki + fitcurve + podsumowania
		useAddCoefficientsStore.getState().resetAll();
		useAddPaidStore.getState().resetData();

		// Wyczyść moduł AddIncurred (other3): współczynniki + fitcurve + podsumowania
		useAddIncurredCoefficientsStore.getState().resetData();
	};

	/* ---------- Synchronizacja zakresu z store’em ---------- */
	// Używamy normalnych selektorów zamiast subscribe
	const startRow = useDetailTableStore((s) => s.startRow);
	const endRow = useDetailTableStore((s) => s.endRow);
	const startCol = useDetailTableStore((s) => s.startCol);
	const endCol = useDetailTableStore((s) => s.endCol);

	useEffect(() => {
		setValue("rowStart", startRow);
		setValue("rowEnd", endRow);
		setValue("colStart", startCol);
		setValue("colEnd", endCol);
		setIsRangeStateHydrated(true);
	}, [setValue, startRow, endRow, startCol, endCol]);

	/* ---------- Reset dialogów przy montowaniu komponentu ---------- */
	useEffect(() => {
		// Reset wszystkich dialogów gdy użytkownik wraca do zakładki
		setShowDialog(false);
		setShowSuccessDialog(false);
		setShowWarningDialog(false);
	}, []); // Wykonaj tylko raz przy montowaniu

	/* ---------- Ładowanie pliku ---------- */
	const handleFileLoad = () => {
		const f = file?.[0];
		if (!f) {
			alert("Najpierw wybierz plik.");
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
			if (typeof binaryStr === "string") {
				try {
					const wb = XLSX.read(binaryStr, { type: "binary" });

					// Podczas wyboru pliku nie czyścimy obliczeń.
					// Czyszczenie wykonujemy dopiero po potwierdzeniu w modalu przy "Wybierz".
					// Reset tylko store'a dla zakładki Det (nie wszystkich store'ów)
					useDetailTableStore.getState().resetData();
					setWorkbook(wb);
					useDetailTableStore.getState().setSelectedSheetName(wb.SheetNames[0]);
					setAvailableLobs([]);
					setSelectedLob("");
					setIsLobLoaded(false);
					setLobLoadSignature("");

					setUploadedFileName(f.name);
				} catch (err) {
					alert("Błąd podczas wczytywania pliku: " + (err as Error).message);
				}
			} else {
				alert("Niepoprawny typ danych z FileReadera.");
			}

			setIsLoading(false);
			setProgress(0);
		};

		reader.onerror = () => {
			alert("Błąd podczas wczytywania pliku.");
			setIsLoading(false);
		};

		reader.readAsBinaryString(f);
	};

	/* ---------- Wykryj zakres automatycznie ---------- */
	const handleAutoRange = () => {
		const range = getDefaultRange();
		if (!range) return;
		setValue("rowStart", range.startRow);
		setValue("rowEnd", range.endRow);
		setValue("colStart", range.startCol);
		setValue("colEnd", range.endCol);
	};

	/* ---------- Submit formularza ---------- */
	const onSubmit = async (data: FormField) => {
		console.log("📝 Submit formularza:", data);

		if (dataFormatMode === "list") {
			if (!isLobLoaded) {
				alert('Najpierw kliknij "Wczytaj LoB" dla wybranego zakresu.');
				return;
			}

			if (lobLoadSignature !== currentLobSignature) {
				alert(
					"Zmienił się plik, arkusz albo zakres. Kliknij ponownie \"Wczytaj LoB\".",
				);
				return;
			}

			if (!selectedLob) {
				alert("Wybierz LoB do analizy.");
				return;
			}

			setPendingFormData(data);
			setShowWarningModal(true);
			return;
		}

		// Zawsze pytaj o potwierdzenie przed podmianą danych i usunięciem obliczeń
		setPendingFormData(data);
		setShowWarningModal(true);
	};

	// Funkcja do przetwarzania danych formularza
	const processFormData = async (data: FormField, showDialogs = true) => {
		console.log(
			"🔄 [processFormData] Rozpoczynam przetwarzanie danych...",
			data,
			"showDialogs:",
			showDialogs,
		);

		if (dataFormatMode === "list") {
			if (lobLoadSignature !== currentLobSignature) {
				alert("Kliknij ponownie \"Wczytaj LoB\" dla bieżącego zakresu.");
				return;
			}

			setRangeAndUpdate({
				startRow: data.rowStart,
				endRow: data.rowEnd,
				startCol: data.colStart,
				endCol: data.colEnd,
			});

			const listResult = buildTriangleFromList(data);
			if ("error" in listResult) {
				alert(listResult.error);
				return;
			}

			const { triangle, ayLabels, dyLabels, dataStartAbsoluteRow } = listResult;

			setDataType("cumulative");
			setHasHeaders(true);
			setRowLabels(ayLabels);
			setColumnLabels(dyLabels);

			setPaidTriangle(triangle);
			setPaidTriangle_bez_inf(triangle);

			const sheetForStore: (string | number)[][] = triangle.map((row) =>
				row.map((cell) => (cell == null ? "" : cell)),
			);
			useTrainDevideStoreDet.setState({ selectedSheetDet: sheetForStore });

			if (showDialogs) {
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
					dataType: "cumulative",
					useInflation,
				});

				if (useInflation) {
					await processInflation();
				} else {
					setShowSuccessDialog(true);
				}
			} else {
				if (localValidateDataValues(triangle as any[][])) {
					setLastApprovedSettings({
						sheetName: selectedSheetName || null,
						rowStart: dataStartAbsoluteRow,
						rowEnd: data.rowEnd,
						colStart: data.colStart,
						colEnd: data.colEnd,
						hasHeaders: true,
						dataType: "cumulative",
						useInflation,
					});
				}
			}

			return;
		}

		// reset dialogów
		setShowDialog(false);
		setShowSuccessDialog(false);
		setShowWarningDialog(false);

		setRangeAndUpdate({
			startRow: data.rowStart,
			endRow: data.rowEnd,
			startCol: data.colStart,
			endCol: data.colEnd,
		});

		setTimeout(async () => {
			let {
				isValid: v,
				selectedSheetJSON: json,
				previousSheetJSON: prev,
			} = useDetailTableStore.getState();

			// (1) ewentualna konwersja inkrementalnych -> skumulowane
			if (dataType === "incremental" && json) {
				const converted = convertIncrementalToCumulative(json);
				useDetailTableStore.setState({ selectedSheetJSON: converted });
				json = converted;
			}

			// (2) budowa body + etykiet zgodnie z hasHeaders
			let body: any[][] = [];
			let rowNames: string[] = [];
			let colNames: string[] = [];

			if (json && json.length > 1) {
				if (hasHeaders) {
					// ✅ Mamy podpisy – wyciągamy je z pierwszego wiersza/kolumny
					colNames = (json[0] ?? []).slice(1).map((c) => String(c ?? ""));
					rowNames = json.slice(1).map((r) => String((r && r[0]) ?? ""));
					body = json.slice(1).map((r) => r.slice(1)); // samo „ciało”
				} else {
					// ❌ Brak podpisów – generujemy 1..N po wycięciu pierwszego wiersza/kolumny
					body = json.slice(1).map((r) => r.slice(1));
					rowNames = Array.from({ length: body.length }, (_, i) =>
						String(i + 1),
					);
					colNames = Array.from({ length: body[0]?.length || 0 }, (_, i) =>
						String(i + 1),
					);
				}

				// zapis etykiet do store'a
				setRowLabels(rowNames);
				setColumnLabels(colNames);

				// numericTriangle (number|null) na bazie body z polskim formatowaniem liczb
				const numericTriangle: (number | null)[][] = body.map((row) =>
					row.map((cell) => parsePolishNumber(cell)),
				);

				setPaidTriangle(numericTriangle);
				// Zapisz również surowe dane bez inflacji
				setPaidTriangle_bez_inf(numericTriangle);

				// widok tabeli do podglądu (string|number)
				const sheetForStore: (string | number)[][] = body.map((row) =>
					row.map((cell) =>
						cell == null ? "" : typeof cell === "number" ? cell : String(cell),
					),
				);
				useTrainDevideStoreDet.setState({ selectedSheetDet: sheetForStore });
			}

			// (3) walidacje i komunikaty - pokazuj tylko jeśli showDialogs = true
			if (showDialogs) {
				if (!v) {
					setShowDialog(true);
				} else if (!localValidateDataValues(body || [])) {
					setShowWarningDialog(true);
				} else {
					setLastApprovedSettings({
						sheetName: selectedSheetName || null,
						rowStart: data.rowStart,
						rowEnd: data.rowEnd,
						colStart: data.colStart,
						colEnd: data.colEnd,
						hasHeaders,
						dataType,
						useInflation,
					});

					if (useInflation) {
						await processInflation();
					} else {
						setShowSuccessDialog(true);
					}
				}
			} else {
				// Przy automatycznym przeliczaniu - tylko zapisz ustawienia bez dialogów
				if (v && localValidateDataValues(body || [])) {
					setLastApprovedSettings({
						sheetName: selectedSheetName || null,
						rowStart: data.rowStart,
						rowEnd: data.rowEnd,
						colStart: data.colStart,
						colEnd: data.colEnd,
						hasHeaders,
						dataType,
						useInflation,
					});
				}
			}
		}, 0);
	};

	// Obsługa potwierdzenia w modalu
	const handleConfirmDataReplace = () => {
		console.log(
			"🚨 [handleConfirmDataReplace] Użytkownik potwierdził wczytanie nowych danych",
		);
		setShowWarningModal(false);

		clearDeterministicPaidCalculations();

		if (pendingFormData) {
			console.log("📝 Przetwarzam odłożone dane formularza...");

			// Wymusimy odświeżenie komponentów
			incrementDataGeneration();

			// Małe opóźnienie żeby React zdążył przetworzyć zmiany
			setTimeout(async () => {
				await processFormData(pendingFormData);
			}, 0);

			setPendingFormData(null);
		}
	};

	// Obsługa anulowania w modalu
	const handleCancelDataReplace = () => {
		console.log(
			"❌ [handleCancelDataReplace] Użytkownik anulował wczytanie danych",
		);
		setShowWarningModal(false);
		setPendingFormData(null);
	};

	// Funkcja do nakładania inflacji
	const processInflation = async () => {
		const paidState = useTrainDevideStoreDet.getState();
		const basePaidTriangle =
			paidState.paidTriangle_bez_inf ?? paidState.paidTriangle;
		const inflationLine = availableInflacjaLines.find(
			(line) => line.index === selectedInflacjaLine,
		);

		if (!basePaidTriangle || basePaidTriangle.length === 0) {
			setInflationErrorMessage("Brak danych paid do przetworzenia.");
			setShowInflationErrorModal(true);
			return;
		}

		if (!inflationLine) {
			setInflationErrorMessage("Nie znaleziono wybranej linii inflacji");
			setShowInflationErrorModal(true);
			return;
		}

		if (!userId) {
			setInflationErrorMessage("Brak user ID.");
			setShowInflationErrorModal(true);
			return;
		}

		try {
			console.log(
				"🔥 [processInflation] Nakładanie inflacji na wczytane dane...",
			);

			setIsLoading(true);
			setProgress(50);

			// Przygotuj request
			const inflationRequest = {
				user_id: userId,
				triangle: basePaidTriangle,
				inflationVector: inflationLine.values,
				triangleMetadata: {
					rowLabels: rowLabels,
					columnLabels: columnLabels,
					dataType: dataType,
					hasHeaders: hasHeaders,
				},
			};

			console.log(
				"📊 [processInflation] Request dla backendu - podstawowe info:",
				{
					triangleRows: basePaidTriangle?.length || 0,
					triangleCols: basePaidTriangle?.[0]?.length || 0,
					inflationVectorLength: inflationLine.values.length,
				},
			);

			console.log(
				"🚀 [processInflation] DOKŁADNY REQUEST WYSYŁANY NA BACKEND /calc/paid/inflation:",
				{
					user_id: inflationRequest.user_id,
					triangle: inflationRequest.triangle,
					inflationVector: inflationRequest.inflationVector,
					triangleMetadata: inflationRequest.triangleMetadata,
				},
			);

			// Walidacja
			const validation = inflationApiService.validateRequest(inflationRequest);
			if (!validation.isValid) {
				throw new Error(`Błędy walidacji: ${validation.errors.join(", ")}`);
			}

			// Wyslij na backend
			const response =
				await inflationApiService.applyInflationToTriangle(inflationRequest);

			if (!response.success) {
				throw new Error(response.error || "Nieznany błąd backendu");
			}

			// Jeśli nie mamy jeszcze zapisanych oryginalnych danych, zapisz je teraz
			if (!paidState.paidTriangle_bez_inf) {
				setPaidTriangle_bez_inf(basePaidTriangle);
			}

			// Zastąp dane skorygowanymi o inflację
			setPaidTriangle(response.adjustedTriangle);

			// 🔥 WYMUSIMY ODŚWIEŻENIE KOMPONENTÓW - kluczowe dla przeliczenia współczynników CL
			incrementDataGeneration();

			// Wyczyść wszystkie obliczone dane z zakładek (jak przy wczytywaniu nowych danych)
			console.log(
				"🔄 [processInflation] Czyszczę wszystkie obliczone dane po nałożeniu inflacji...",
			);
			paidStore.setTrainDevideDet(undefined);
			paidStore.clearDevJResults();
			paidStore.setFinalDevJ(undefined);
			paidStore.clearAllDevFinalValues();
			paidStore.clearFitCurveData();
			paidStore.clearDevSummaryData();

			// Wyczyść również wyniki obliczeń CL (devJ, sigma, sd)
			paidStore.setDevJ([]);
			paidStore.setSigma([]);
			paidStore.setSd([]);

			// Wyczyść tabele ResultSummary
			summaryStore.clearSummaryData();

			console.log("✅ [processInflation] Inflacja nakoładana pomyślnie");
			setShowInflationSuccessModal(true);
		} catch (error) {
			console.error("❌ [processInflation] Błąd:", error);
			const errorMessage =
				error instanceof Error ? error.message : "Nieznany błąd";
			setInflationErrorMessage(
				`Błąd podczas nakładania inflacji: ${errorMessage}`,
			);
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
			<form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
				<section className="rounded-xl bg-[#1f2f49]/70 p-3 md:p-3.5">
					<div className="pb-1">
						<h2 className="font-semibold text-base text-slate-100 leading-tight tracking-tight">
							Wprowadź trójkąt danych paid, który wykorzystasz w dalszej
							analizie
						</h2>
					</div>
					<div className="space-y-3">
						{/* --- Plik --- */}
						<FileUploadSection
							file={file}
							uploadedFileName={uploadedFileName}
							onFileChange={(e) => setValue("file", e.target.files)}
							onFileLoad={handleFileLoad}
							isLoading={isLoading}
						/>

						{/* --- Arkusz --- */}
						<div className="space-y-1">
							<Label className="text-slate-100">Wybór arkusza</Label>
							{/* Jeśli Twój SheetSelect nie przyjmuje „store”, usuń ten prop */}
							<SheetSelectDet />
						</div>

						<div className="grid grid-cols-1 gap-3">
							<div>
								<div className="w-full p-1">
									<h3 className="mb-1.5 font-semibold text-base text-slate-100 leading-tight tracking-tight">
										Podaj zakres danych, które chcesz wczytać.
									</h3>
									<div className="grid grid-cols-1 gap-2 md:grid-cols-2">
										<div className="w-full space-y-1">
											<Label className="text-slate-100">
												Wiersz początkowy
											</Label>
											<Input
												type="number"
												disabled={!workbook}
												{...register("rowStart")}
											/>
										</div>
										<div className="w-full space-y-1">
											<Label className="text-slate-100">Wiersz końcowy</Label>
											<Input
												type="number"
												disabled={!workbook}
												{...register("rowEnd")}
											/>
										</div>
										<div className="w-full space-y-1">
											<Label className="text-slate-100">
												Kolumna początkowa
											</Label>
											<Input
												type="number"
												disabled={!workbook}
												{...register("colStart")}
											/>
										</div>
										<div className="w-full space-y-1">
											<Label className="text-slate-100">Kolumna końcowa</Label>
											<Input
												type="number"
												disabled={!workbook}
												{...register("colEnd")}
											/>
										</div>
									</div>

									<Button
										type="button"
										onClick={handleAutoRange}
										variant="outline"
										disabled={!workbook}
										className="mt-2 h-9 border-slate-500 bg-slate-600 text-slate-100 text-sm hover:bg-slate-500"
									>
										Wykryj zakres automatycznie
									</Button>
								</div>
							</div>
						</div>

						{/* --- Konfiguracja danych --- */}
						<div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
							<div className="max-w-xl space-y-3">
								<div className="w-full rounded-lg border border-slate-500/40 bg-slate-800/20 p-2.5">
									<Label className="font-semibold text-base text-slate-100 leading-tight tracking-tight">
										Typ danych
									</Label>
									<div className="mt-2 flex flex-col gap-1">
										<label className="group flex cursor-pointer items-center space-x-2 rounded-md px-1 py-1 transition-colors hover:bg-slate-600/60">
											<input
												type="radio"
												name="dataFormatMode"
												checked={dataFormatMode === "triangle"}
												onChange={() => setDataFormatMode("triangle")}
												className="h-4 w-4 border-slate-400 bg-slate-700 text-blue-500 focus:ring-2 focus:ring-blue-400"
											/>
											<span className="text-sm text-slate-200 group-hover:text-white">
												Trójkąt
											</span>
										</label>
										<label className="group flex cursor-pointer items-center space-x-2 rounded-md px-1 py-1 transition-colors hover:bg-slate-600/60">
											<input
												type="radio"
												name="dataFormatMode"
												checked={dataFormatMode === "list"}
												onChange={() => setDataFormatMode("list")}
												className="h-4 w-4 border-slate-400 bg-slate-700 text-blue-500 focus:ring-2 focus:ring-blue-400"
											/>
											<span className="text-sm text-slate-200 group-hover:text-white">
												Lista
											</span>
										</label>
									</div>
								</div>

								{dataFormatMode === "triangle" && (
									<div className="space-y-3">
										<HeadersSelector
											hasHeaders={hasHeaders}
											onHeadersChange={setHasHeaders}
										/>
									</div>
								)}

								{dataFormatMode === "list" && (
									<div className="w-full rounded-lg border border-slate-500/40 bg-slate-800/20 p-2.5">
										<Label className="font-semibold text-base text-slate-100 leading-tight tracking-tight">
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

								<label className="inline-flex items-center gap-2 text-slate-100 text-sm">
									<input
										type="checkbox"
										className="h-4 w-4 rounded border-slate-500 bg-slate-700"
										checked={useInflation}
										onChange={(e) => setUseInflation(e.target.checked)}
										disabled={
											Object.keys(inflacjaTriangle).length === 0 ||
											selectedInflacjaLine === null
										}
									/>
									Nałóż inflację
								</label>

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

							{dataFormatMode === "triangle" && (
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
				</section>
			</form>

			{/* ---------- DIALOGI ---------- */}
			<DataInputDialogs
				showErrorDialog={showDialog}
				onErrorDialogChange={setShowDialog}
				errorMessage={
					validationErrorReason ||
					"Dane wejściowe nie spełniają określonego formatu. Sprawdź dane!"
				}
				showWarningDialog={showWarningDialog}
				onWarningDialogChange={setShowWarningDialog}
				showSuccessDialog={showSuccessDialog}
				onSuccessDialogChange={setShowSuccessDialog}
				successMessage={
					dataType === "incremental"
						? "Dane inkrementalne zostały przekonwertowane na skumulowane i poprawnie wczytane (Det)."
						: "Dane skumulowane zostały poprawnie wczytane (Det)."
				}
				showInfoDialog={false}
				onInfoDialogChange={() => {}}
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
				successMessage="Inflacja została pomyślnie nałożona na dane paid."
				showInfoDialog={false}
				onInfoDialogChange={() => {}}
			/>

			{/* ---------- LOADING ---------- */}
			<DataInputLoading isLoading={isLoading} progress={progress} />

			{/* MODAL OSTRZEŻENIA O UTRACIE DANYCH */}
			<Modal
				title="Ostrzeżenie"
				message="Czy chcesz wczytać dane i usunąć wszystkie dotychczasowe obliczenia?"
				isOpen={showWarningModal}
				onConfirm={handleConfirmDataReplace}
				onCancel={handleCancelDataReplace}
			/>
		</div>
	);
}
