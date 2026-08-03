"use client";

import {
	CalendarDays,
	Pencil,
	Plus,
	Trash2,
	X,
} from "lucide-react";
import type { CSSProperties, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DateCalendar } from "@mui/x-date-pickers/DateCalendar";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import { pl } from "date-fns/locale";
import type { AuthRole } from "@/app/_components/home-tabs/types";

import { fetchDictionaryEntries } from "@/features/dictionaries/api";
import type { DictionaryEntry } from "@/features/dictionaries/types";
import {
	type RawInspectionRow,
	normalizeInspectionRow,
} from "@/features/inspections/components/inspections-panel.utils";
import { fetchObligatingDecisions } from "@/features/obligating-decisions/api";
import { RecommendationsSuccessModal } from "@/features/recommendations/components/RecommendationsSuccessModal";
import {
	createRecommendation,
	deleteRecommendation,
	fetchRecommendations,
	type RecommendationLockConflict,
	updateRecommendation,
} from "@/features/recommendations/api";
import { fetchSanctionRequests } from "@/features/sanction-requests/api";
import type {
	RecommendationRead,
	RecommendationWrite,
} from "@/features/recommendations/types";
import { DateListEditor } from "@/shared/components/forms/DateListEditor";
import { RegistryFormScaffold } from "@/shared/components/forms/RegistryFormScaffold";
import { SingleSelectPortalField } from "@/shared/components/forms/SingleSelectPortalField";
import {
	formatDatesInDisplayText,
	formatIsoDateForDisplay,
	toDateList,
} from "@/shared/utils/date";
import {
	getAdvancedDateRangeFromSelectedValues,
	isAdvancedDateRangeFilterToken,
	matchesAdvancedFilterCellValue,
	splitAdvancedFilterCellValue,
} from "@/shared/utils/table-filters";
import { DeleteSuccessModal } from "@/shared/components/DeleteSuccessModal";
import { ExportConfigModal } from "@/shared/components/export/ExportConfigModal";
import { RegistryDataTable } from "@/shared/components/table/RegistryDataTable";
import { TableAdvancedFilterModal } from "@/shared/components/table/TableAdvancedFilterModal";
import { TableColumnPickerModal } from "@/shared/components/table/TableColumnPickerModal";
import { TableFullscreenContainer } from "@/shared/components/table/TableFullscreenContainer";
import { TablePanelToolbar } from "@/shared/components/table/TablePanelToolbar";
import { TablePagination } from "@/shared/components/table/TablePagination";
import {
	addWorksheetWithStyles,
	createStyledExportWorkbook,
	saveWorkbookAsXlsx,
} from "@/shared/utils/excel-export";
import { getFloatingPanelAnchor } from "@/shared/utils/floating-panel";
import { useTableState } from "@/shared/hooks/useTableState";
import { useInactivityTimeout } from "@/shared/hooks/useInactivityTimeout";
import { useRecordLock } from "@/shared/hooks/useRecordLock";

const INACTIVITY_TIMEOUT_MS = 5 * 60_000; // 5 minut
const INACTIVITY_WARNING_MS = 60_000; // 1 minuta ostrzeżenia
const TABLE_PAGE_SIZE_OPTIONS = [20, 30, 50, 70, 100] as const;
const DEFAULT_TABLE_PAGE_SIZE = 30;
const NO_DATES_MARKER = "Brak";
const RECOMMENDATIONS_COLUMN_WIDTHS_STORAGE_PREFIX =
	"triangle.ui.recommendations.column-widths";
const RECOMMENDATIONS_NAME_VARIANTS_STORAGE_PREFIX =
	"triangle.ui.recommendations.name-variants";
const RECOMMENDATIONS_TABLE_VIEW_STORAGE_PREFIX =
	"triangle.ui.recommendations.table-view";
const RECOMMENDATIONS_STATUS_HIGHLIGHTING_STORAGE_PREFIX =
	"triangle.ui.recommendations.status-highlighting";
const RECOMMENDATIONS_QUICK_FILTER_TEAM_LABELS_STORAGE_PREFIX =
	"triangle.ui.recommendations.quick-filter-team-labels";
const RECOMMENDATIONS_QUICK_FILTER_SELECTIONS_STORAGE_PREFIX =
	"triangle.ui.recommendations.quick-filter-selections";
// Keep this list editable - add more status codes as business rules evolve.
const RECOMMENDATION_STATUS_CODES_REQUIRING_ACCEPTANCE_NOTE_DATE: string[] = [
	"Z_SZ_3",
	"Z_SZ_5",
	"Z_SZ_6",
	"Z_SZ_7",
	"Z_SZ_8",
	"Z_SZ_9",
];
const RECOMMENDATION_STATUS_CODES_REQUIRING_ACCEPTANCE_NOTE_DATE_SET = new Set(
	RECOMMENDATION_STATUS_CODES_REQUIRING_ACCEPTANCE_NOTE_DATE,
);
const QUICK_FILTER_RECOMMENDATIONS_EXCLUDED_STATUS_CODE_POSITIONS: string[] = ["Z_SZ_3"
];
const RECOMMENDATIONS_MIN_COLUMN_WIDTH = 90;
// Maksymalna wysokosc zawartosci komorki (wiersza) tabeli Zalecen.
const RECOMMENDATIONS_MAX_ROW_HEIGHT_PX = 84;

type RecommendationsPanelProps = {
	operatorLogin: string;
	authRole: AuthRole;
	isObserver?: boolean;
};

const RECOMMENDATIONS_CHANGED_EVENT = "recommendations:changed";
const INSPECTIONS_CHANGED_EVENT = "inspections:changed";
const DICTIONARIES_CHANGED_EVENT = "dictionaries:changed";
const DASHBOARD_OPEN_RECOMMENDATION_EVENT = "dashboard:open-recommendation";
const DASHBOARD_OPEN_RECOMMENDATION_CODE_KEY =
	"triangle.dashboard.openRecommendationCode";
const DASHBOARD_OPEN_INSPECTION_EVENT = "dashboard:open-inspection";
const DASHBOARD_OPEN_INSPECTION_CODE_KEY = "triangle.dashboard.openInspectionCode";

function readPersistedTablePageSize(storageKey: string) {
	if (typeof window === "undefined") {
		return DEFAULT_TABLE_PAGE_SIZE;
	}

	const raw = window.localStorage.getItem(storageKey);
	const parsed = Number(raw);
	if (
		Number.isFinite(parsed) &&
		TABLE_PAGE_SIZE_OPTIONS.includes(
			parsed as (typeof TABLE_PAGE_SIZE_OPTIONS)[number],
		)
	) {
		return parsed;
	}

	return DEFAULT_TABLE_PAGE_SIZE;
}

function openInspectionFromDashboard(inspectionCode: string) {
	const normalizedCode = inspectionCode.trim();
	if (!normalizedCode || typeof window === "undefined") {
		return;
	}

	window.sessionStorage.setItem(
		DASHBOARD_OPEN_INSPECTION_CODE_KEY,
		normalizedCode,
	);
	window.dispatchEvent(
		new CustomEvent(DASHBOARD_OPEN_INSPECTION_EVENT, {
			detail: { inspectionCode: normalizedCode },
		}),
	);
}

type RecommendationColumnKey =
	| "lp"
	| "kodZalecenia"
	| "pozycja"
	| "inspectionId"
	| "zespoly"
	| "nazwaPodmiotu"
	| "terminWykonaniaZalecen"
	| "status"
	| "komentarz"
	| "dataZalecenList"
	| "dataAkceptacjiNotyWeryfikacjiList";

type RecommendationColumn = {
	key: RecommendationColumnKey;
	label: string;
};

const RECOMMENDATION_SPLITTABLE_ADVANCED_FILTER_COLUMNS = new Set<RecommendationColumnKey>([
	"dataZalecenList",
	"dataAkceptacjiNotyWeryfikacjiList",
	"zespoly",
]);

function splitRecommendationAdvancedFilterCellValue(
	columnKey: RecommendationColumnKey,
	rawValue: string,
) {
	const normalizedValue = rawValue.trim();
	if (!normalizedValue) {
		return ["(puste)"];
	}

	if (!RECOMMENDATION_SPLITTABLE_ADVANCED_FILTER_COLUMNS.has(columnKey)) {
		return [normalizedValue];
	}

	return splitAdvancedFilterCellValue(rawValue);
}

function matchesRecommendationAdvancedFilterCellValue(
	columnKey: RecommendationColumnKey,
	rawValue: string,
	selectedValues: string[],
) {
	if (RECOMMENDATION_SPLITTABLE_ADVANCED_FILTER_COLUMNS.has(columnKey)) {
		return matchesAdvancedFilterCellValue(rawValue, selectedValues);
	}

	if (selectedValues.length === 0) {
		return true;
	}

	const selectedDateRange = getAdvancedDateRangeFromSelectedValues(selectedValues);
	if (selectedDateRange) {
		return false;
	}

	const selectedDiscreteValues = selectedValues.filter(
		(value) => !isAdvancedDateRangeFilterToken(value),
	);
	if (selectedDiscreteValues.length === 0) {
		return true;
	}

	const tokens = splitRecommendationAdvancedFilterCellValue(columnKey, rawValue);
	return tokens.some((token) => selectedDiscreteValues.includes(token));
}

const RECOMMENDATION_COLUMNS: RecommendationColumn[] = [
	{ key: "lp", label: "Lp." },
	{ key: "kodZalecenia", label: "Id zalecenia" },
	{ key: "inspectionId", label: "Id inspekcji" },
	{ key: "nazwaPodmiotu", label: "Nazwa podmiotu" },
	{ key: "terminWykonaniaZalecen", label: "Data zaleceń" },
	{ key: "dataZalecenList", label: "Termin wykonania zaleceń" },
	{ key: "pozycja", label: "Liczba zaleceń" },
	{
		key: "dataAkceptacjiNotyWeryfikacjiList",
		label: "Data akceptacji noty z weryfikacji wykonania zaleceń",
	},
	{ key: "zespoly", label: "Zespoły" },
	{ key: "status", label: "Status" },
	{ key: "komentarz", label: "Komentarz" },
];

const DEFAULT_RECOMMENDATION_COLUMN_WIDTHS: Partial<
	Record<RecommendationColumnKey, number>
> = {
	// Manualna konfiguracja szerokosci kolumn tabeli Zalecen (wartosci w px).
	lp: 90,
	kodZalecenia: 170,
	inspectionId: 170,
	zespoly: 220,
	nazwaPodmiotu: 220,
	terminWykonaniaZalecen: 180,
	dataZalecenList: 230,
	pozycja: 140,
	dataAkceptacjiNotyWeryfikacjiList: 300,
	status: 170,
	komentarz: 240,
};

const RECOMMENDATION_COLUMN_TOOLTIPS: Partial<
	Record<RecommendationColumnKey, string>
> = {
	kodZalecenia: "Unikalne id zalecenia",
	inspectionId: "Unikalne id inspekcji",
};

const ALL_RECOMMENDATION_COLUMN_KEYS: RecommendationColumnKey[] =
	RECOMMENDATION_COLUMNS.map((column) => column.key);

type RecommendationFormState = {
	inspectionId: string;
	isInspectionMissing: boolean;
	inspectionTeamIds: number[];
	pozycja: string;
	nazwaPodmiotu: string;
	terminWykonaniaZalecen: string;
	status: string;
	komentarz: string;
	dataZalecenList: string[];
	dataAkceptacjiList: string[];
	isDataZalecenBrak: boolean;
	isDataAkceptacjiBrak: boolean;
};

type RecommendationValidationModalData = {
	statusLabel: string;
	statusCode: string;
	requiredFieldLabel: string;
};

type InspectionOption = {
	id: number;
	lp: number;
	inspectionCode: string;
	nazwaPodmiotu: string;
	nazwaPodmiotuSkrocona: string;
	inspectionTeamIds: number[];
};

type InspectionTeamOption = {
	id: number;
	label: string;
	shortLabel: string;
};

type SelectOption = {
	value: string;
	label: string;
};

type RecommendationNameVariant = "full" | "short";

type RecommendationNameVariantColumnKey = "nazwaPodmiotu" | "status";

type RecommendationNameVariantByColumn = Record<
	RecommendationNameVariantColumnKey,
	RecommendationNameVariant
>;

const RECOMMENDATION_NAME_VARIANT_COLUMN_KEYS: RecommendationNameVariantColumnKey[] =
	["nazwaPodmiotu", "status"];

const RECOMMENDATION_NAME_VARIANT_OPTIONS = [
	{ value: "full", label: "Nazwa pełna" },
	{ value: "short", label: "Nazwa skrócona" },
] as const;

const DEFAULT_RECOMMENDATION_NAME_VARIANTS: RecommendationNameVariantByColumn = {
	nazwaPodmiotu: "short",
	status: "full",
};

function isRecommendationNameVariantColumnKey(
	columnKey: RecommendationColumnKey,
): columnKey is RecommendationNameVariantColumnKey {
	return RECOMMENDATION_NAME_VARIANT_COLUMN_KEYS.includes(
		columnKey as RecommendationNameVariantColumnKey,
	);
}

const INSPECTIONS_API_URL = "/api/structure/inspections";
const AVAILABLE_INSPECTIONS_API_URL = "/api/recommendations/available-inspections";
const INSPECTION_TEAMS_API_URL = "/api/inspections/team-options";

const BLOCKING_INSPECTION_STATUS_CODES = new Set([
	"CLOSED_WITH_RECOMMENDATIONS",
	"CLOSED_WITHOUT_RECOMMENDATIONS",
]);

const BLOCKING_INSPECTION_STATUS_FALLBACK_LABELS = new Set([
	"zamkniete - brak zalecen i wniosku sankcyjnego",
	"zamkniete - brak zalecen",
	"zamkniete - wydano zalecenia i sporzadzono wniosek sankcyjny",
	"zamkniete - sporzadzono wniosek sankcyjny",
]);

function normalizeInspectionStatusLabel(value: string) {
	return value
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
}

function normalizeRecommendationStatusCode(value: unknown) {
	return String(value ?? "").trim().toUpperCase();
}

type RecommendationStatusStyle = {
	kolor: string | null;
	odcien: number | null;
	intensywnosc: number | null;
};

const RECOMMENDATION_STATUS_PALETTE_HUE_SAT_BY_KEY: Record<string, string> = {
	emerald: "160 84%",
	green: "142 76%",
	teal: "173 80%",
	lime: "84 81%",
	sky: "198 93%",
	cyan: "188 94%",
	blue: "221 83%",
	indigo: "239 84%",
	rose: "343 87%",
	red: "0 84%",
	pink: "330 81%",
	fuchsia: "292 84%",
	yellow: "48 96%",
	amber: "43 96%",
	orange: "27 96%",
};

const RECOMMENDATION_STATUS_SHADE_TO_LIGHTNESS: Record<number, number> = {
	50: 97,
	100: 94,
	200: 88,
	300: 79,
	400: 67,
	500: 56,
	600: 46,
	700: 38,
	800: 31,
	900: 26,
	950: 14,
};

function resolveRecommendationStatusRowStyle(
	statusValue: string | null | undefined,
	statusStyleByCode: Record<string, RecommendationStatusStyle>,
): CSSProperties | undefined {
	const normalizedStatus = String(statusValue ?? "").trim().toUpperCase();
	if (!normalizedStatus) {
		return undefined;
	}

	const style = statusStyleByCode[normalizedStatus];
	if (!style) {
		return undefined;
	}

	const paletteKey = String(style.kolor ?? "").trim().toLowerCase();
	const hueSat = RECOMMENDATION_STATUS_PALETTE_HUE_SAT_BY_KEY[paletteKey];
	if (!hueSat) {
		return undefined;
	}

	const normalizedShade =
		typeof style.odcien === "number" && Number.isFinite(style.odcien)
			? Math.round(style.odcien)
			: 200;
	const lightness =
		RECOMMENDATION_STATUS_SHADE_TO_LIGHTNESS[normalizedShade] ??
		RECOMMENDATION_STATUS_SHADE_TO_LIGHTNESS[200];
	const opacity =
		typeof style.intensywnosc === "number" && Number.isFinite(style.intensywnosc)
			? Math.max(0, Math.min(100, style.intensywnosc)) / 100
			: 0.65;

	return {
		backgroundColor: `hsl(${hueSat} ${lightness}% / ${opacity})`,
	};
}

type InspectionExportColumnKey =
	| "kodInspekcji"
	| "nazwaPodmiotu"
	| "typInspekcji"
	| "zakresInspekcji"
	| "szczegolyDotyczaceZakresu"
	| "aspektKonsumencki"
	| "poczatekInspekcji"
	| "koniecInspekcji"
	| "osobaKierujaca"
	| "skladZespolu"
	| "zespoly"
	| "rynek"
	| "rodzajPodmiotu"
	| "dataProtokolu"
	| "dataDoreczeniaProtokolu"
	| "dataAkceptacjiSprawozdania"
	| "dataDoreczeniaPisma"
	| "dataPismaZastrzezenia"
	| "dataWyslaniaPismaZZastrzezeniami"
	| "dataWplywuPisma"
	| "dataPismaZOdpowiedzia"
	| "dataWyslaniaPismaZOdpowiedzia"
	| "dataAkceptacjiNoty"
	| "dataZalecen"
	| "status"
	| "komentarz";

type SanctionExportColumnKey =
	| "lp"
	| "requestId"
	| "inspectionLp"
	| "zespoly"
	| "nazwaPodmiotuObjetegoInspekcja"
	| "nazwaPodmiotuObjetegoSankcjaList"
	| "dataWniosku"
	| "wniosekDo"
	| "sankcjaList"
	| "podstawaPrawnaSankcjiList"
	| "naruszeniaSkutkujaceSankcjaList"
	| "czyMamyInformacjeOWszczeciuPostepowania"
	| "rozstrzygniecie"
	| "komentarz";

type DecisionExportColumnKey =
	| "lp"
	| "kodDecyzji"
	| "kodZalecenia"
	| "inspectionLp"
	| "zespoly"
	| "nazwaPodmiotu"
	| "liczbaZalecen"
	| "dataWszczeciaPostepowaniaIInstancji"
	| "osobyProwadzaceIInstancjeList"
	| "dataDecyzjiIInstancji"
	| "dataDoreczeniaDecyzjiIInstancji"
	| "rozstrzygniecieI"
	| "dataWnioskuPonowneRozpatrzenie"
	| "dataWplywuWnioskuPonowneRozpatrzenie"
	| "osobyProwadzaceIIInstancjeList"
	| "dataDecyzjiIIInstancji"
	| "dataDoreczeniaDecyzjiIIInstancji"
	| "rozstrzygniecieII"
	| "komentarz";

type ExportColumnDefinition<T extends string> = {
	key: T;
	label: string;
};

const INSPECTION_EXPORT_COLUMNS: ExportColumnDefinition<InspectionExportColumnKey>[] = [
	{ key: "kodInspekcji", label: "Id inspekcji" },
	{ key: "nazwaPodmiotu", label: "Nazwa podmiotu" },
	{ key: "typInspekcji", label: "Typ inspekcji" },
	{ key: "zakresInspekcji", label: "Zakres inspekcji według upoważnienia" },
	{
		key: "szczegolyDotyczaceZakresu",
		label: "Szczegóły dotyczące zakresu",
	},
	{ key: "aspektKonsumencki", label: "Aspekt konsumencki" },
	{ key: "poczatekInspekcji", label: "Początek inspekcji" },
	{ key: "koniecInspekcji", label: "Koniec inspekcji" },
	{ key: "osobaKierujaca", label: "Osoba kierująca kontrolą / wizytą" },
	{ key: "skladZespolu", label: "Skład zespołu inspekcyjnego" },
	{ key: "zespoly", label: "Zespoły" },
	{ key: "rynek", label: "Rynek" },
	{ key: "rodzajPodmiotu", label: "Rodzaj podmiotu" },
	{ key: "dataProtokolu", label: "Data protokołu / sprawozdania" },
	{ key: "dataDoreczeniaProtokolu", label: "Data doręczenia protokołu" },
	{
		key: "dataAkceptacjiSprawozdania",
		label: "Data akceptacji sprawozdania z wizyty",
	},
	{ key: "dataDoreczeniaPisma", label: "Data doręczenia pisma po wizycie" },
	{
		key: "dataPismaZastrzezenia",
		label: "Data pisma z zastrzeżeniami do protokołu / pisma po wizycie",
	},
	{
		key: "dataWyslaniaPismaZZastrzezeniami",
		label: "Data wysłania pisma z zastrzeżeniami",
	},
	{
		key: "dataWplywuPisma",
		label: "Data wpływu pisma z zastrzeżeniami do protokołu / pisma po wizycie",
	},
	{
		key: "dataPismaZOdpowiedzia",
		label: "Data pisma z odpowiedzią na zastrzeżenia",
	},
	{
		key: "dataWyslaniaPismaZOdpowiedzia",
		label: "Data wysłania pisma z odpowiedzią na zastrzeżenia",
	},
	{ key: "dataAkceptacjiNoty", label: "Data akceptacji noty" },
	{ key: "dataZalecen", label: "Data zaleceń" },
	{ key: "status", label: "Status" },
	{ key: "komentarz", label: "Komentarz" },
];

const SANCTION_EXPORT_COLUMNS: ExportColumnDefinition<SanctionExportColumnKey>[] = [
	{ key: "lp", label: "Lp. wniosku" },
	{ key: "requestId", label: "Id wniosku" },
	{ key: "inspectionLp", label: "Id inspekcji" },
	{ key: "zespoly", label: "Zespoły" },
	{
		key: "nazwaPodmiotuObjetegoInspekcja",
		label: "Nazwa podmiotu objętego inspekcją",
	},
	{
		key: "nazwaPodmiotuObjetegoSankcjaList",
		label: "Nazwa podmiotu objętego sankcją",
	},
	{ key: "dataWniosku", label: "Data wniosku" },
	{ key: "wniosekDo", label: "Wniosek do" },
	{ key: "sankcjaList", label: "Sankcja" },
	{ key: "podstawaPrawnaSankcjiList", label: "Podstawa prawna sankcji" },
	{
		key: "naruszeniaSkutkujaceSankcjaList",
		label: "Naruszenia skutkujące sankcją",
	},
	{
		key: "czyMamyInformacjeOWszczeciuPostepowania",
		label: "Informacja o wszczęciu postępowania",
	},
	{ key: "rozstrzygniecie", label: "Rozstrzygnięcie" },
	{ key: "komentarz", label: "Komentarz" },
];

const DECISION_EXPORT_COLUMNS: ExportColumnDefinition<DecisionExportColumnKey>[] = [
	{ key: "lp", label: "Lp." },
	{ key: "kodDecyzji", label: "Id decyzji" },
	{ key: "kodZalecenia", label: "Id zalecenia" },
	{ key: "inspectionLp", label: "Id inspekcji" },
	{ key: "zespoly", label: "Zespoły" },
	{ key: "nazwaPodmiotu", label: "Nazwa podmiotu" },
	{ key: "liczbaZalecen", label: "Liczba zaleceń" },
	{
		key: "dataWszczeciaPostepowaniaIInstancji",
		label: "Data wszczęcia postępowania administracyjnego I instancji",
	},
	{ key: "osobyProwadzaceIInstancjeList", label: "Osoby prowadzące I instancję" },
	{ key: "dataDecyzjiIInstancji", label: "Data decyzji I instancji" },
	{
		key: "dataDoreczeniaDecyzjiIInstancji",
		label: "Data doręczenia decyzji I instancji",
	},
	{ key: "rozstrzygniecieI", label: "Rozstrzygnięcie I instancji" },
	{
		key: "dataWnioskuPonowneRozpatrzenie",
		label: "Data wniosku o ponowne rozpatrzenie sprawy",
	},
	{
		key: "dataWplywuWnioskuPonowneRozpatrzenie",
		label: "Data wpływu wniosku o ponowne rozpatrzenie sprawy",
	},
	{ key: "osobyProwadzaceIIInstancjeList", label: "Osoby prowadzące II instancję" },
	{ key: "dataDecyzjiIIInstancji", label: "Data decyzji II instancji" },
	{
		key: "dataDoreczeniaDecyzjiIIInstancji",
		label: "Data doręczenia decyzji II instancji",
	},
	{ key: "rozstrzygniecieII", label: "Rozstrzygnięcie II instancji" },
	{ key: "komentarz", label: "Komentarz" },
];

const EMPTY_FORM: RecommendationFormState = {
	inspectionId: "",
	isInspectionMissing: false,
	inspectionTeamIds: [],
	pozycja: "",
	nazwaPodmiotu: "",
	terminWykonaniaZalecen: "",
	status: "",
	komentarz: "",
	dataZalecenList: [],
	dataAkceptacjiList: [],
	isDataZalecenBrak: false,
	isDataAkceptacjiBrak: false,
};

function resolveSetStateAction<T>(
	nextValue: SetStateAction<T>,
	prevValue: T,
): T {
	if (typeof nextValue === "function") {
		return (nextValue as (prev: T) => T)(prevValue);
	}

	return nextValue;
}

function parseNumericIdList(value: unknown) {
	const source = Array.isArray(value)
		? value
		: typeof value === "number"
			? [value]
			: typeof value === "string"
				? value
					.split(/[;,]/)
					.map((item) => item.trim())
					.filter(Boolean)
				: [];

	return Array.from(
		new Set(
			source
				.map((item) =>
					typeof item === "number"
						? item
						: typeof item === "string"
							? Number(item.trim())
							: NaN,
				)
				.filter((item): item is number => Number.isFinite(item) && item > 0),
		),
	).sort((left, right) => left - right);
}

function mapDictionaryEntriesToOptions(entries: DictionaryEntry[]): SelectOption[] {
	const mappedOptions = entries
		.filter((entry) => entry.aktywny)
		.sort((left, right) => {
			const leftOrder = left.kolejnosc ?? Number.MAX_SAFE_INTEGER;
			const rightOrder = right.kolejnosc ?? Number.MAX_SAFE_INTEGER;
			if (leftOrder !== rightOrder) {
				return leftOrder - rightOrder;
			}

			return left.nazwaPozycji.localeCompare(right.nazwaPozycji, "pl", {
				sensitivity: "base",
			});
		})
		.map((entry) => {
			const value = entry.nazwaPozycji.trim();
			const shortLabel = String(entry.skrotPozycji ?? "").trim();
			const label = shortLabel || value;

			if (!value) {
				return null;
			}

			return { value, label };
		})
		.filter((option): option is SelectOption => Boolean(option));

	const uniqueByValue = new Map<string, SelectOption>();
	for (const option of mappedOptions) {
		if (!uniqueByValue.has(option.value)) {
			uniqueByValue.set(option.value, option);
		}
	}

	return Array.from(uniqueByValue.values());
}

function formatDateListDisplay(values: string[], isNoDatesSelected: boolean) {
	if (isNoDatesSelected) {
		return NO_DATES_MARKER;
	}

	const normalizedDates = toDateList(values);
	if (normalizedDates.length === 0) {
		return "-";
	}

	return normalizedDates
		.map((date) => formatIsoDateForDisplay(date) || date)
		.join(", ");
}

function formatDateListDisplayLines(values: string[], isNoDatesSelected: boolean) {
	if (isNoDatesSelected) {
		return [NO_DATES_MARKER];
	}

	const normalizedDates = toDateList(values);
	if (normalizedDates.length === 0) {
		return ["-"];
	}

	return normalizedDates.map((date) => formatIsoDateForDisplay(date) || date);
}

function formToPayload(
	form: RecommendationFormState,
	entityNameIdByValue: Record<string, number>,
	statusIdByValue: Record<string, number>,
	validInspectionTeamIdSet: Set<number>,
	mode: "create" | "update",
	existingItem?: RecommendationRead | null,
): RecommendationWrite | null {
	const inspectionId = Number(form.inspectionId);
	const pozycja = Number(form.pozycja);

	if (!Number.isFinite(pozycja) || pozycja <= 0) {
		return null;
	}

	if (
		!form.isInspectionMissing &&
		(!Number.isFinite(inspectionId) || inspectionId <= 0)
	) {
		return null;
	}

	const normalizedListDates = form.isDataZalecenBrak
		? []
		: toDateList(form.dataZalecenList);
	const singleDate = form.terminWykonaniaZalecen.trim() || null;
	const normalizedEntityName = form.nazwaPodmiotu.trim();
	const normalizedStatus = form.status.trim();
	const existingEntityName = String(existingItem?.nazwaPodmiotu ?? "").trim();
	const existingStatus = String(existingItem?.status ?? "").trim();
	const fallbackEntityId =
		normalizedEntityName &&
		normalizedEntityName === existingEntityName &&
		typeof existingItem?.nazwaPodmiotuId === "number" &&
		Number.isFinite(existingItem.nazwaPodmiotuId) &&
		existingItem.nazwaPodmiotuId > 0
			? existingItem.nazwaPodmiotuId
			: NaN;
	const fallbackStatusId =
		normalizedStatus &&
		normalizedStatus === existingStatus &&
		typeof existingItem?.statusId === "number" &&
		Number.isFinite(existingItem.statusId) &&
		existingItem.statusId > 0
			? existingItem.statusId
			: NaN;
	const nazwaPodmiotuId =
		entityNameIdByValue[normalizedEntityName] ?? fallbackEntityId;
	const statusId = statusIdByValue[normalizedStatus] ?? fallbackStatusId;
	const requiresEntityId = form.isInspectionMissing;
	const requiresStatusId = mode === "create";

	const hasEntityId = Number.isFinite(nazwaPodmiotuId) && nazwaPodmiotuId > 0;
	const hasStatusId = Number.isFinite(statusId) && statusId > 0;

	if (requiresEntityId && !hasEntityId) {
		return null;
	}

	if (requiresStatusId && !hasStatusId) {
		return null;
	}

	return {
		inspectionId: form.isInspectionMissing ? null : inspectionId,
		pozycja,
		...(hasEntityId ? { nazwaPodmiotuId } : {}),
		dataZalecen: singleDate,
		terminyWykonaniaZalecenList: normalizedListDates,
		brakTerminowWykonaniaZalecen: form.isDataZalecenBrak,
		brakDatAkceptacjiNotyWeryfikacji: form.isDataAkceptacjiBrak,
		...(hasStatusId ? { statusId } : {}),
		komentarz: form.komentarz.trim() || null,
		dataAkceptacjiNotyWeryfikacjiList: form.isDataAkceptacjiBrak
			? []
			: toDateList(form.dataAkceptacjiList),
		inspectionTeamIds: form.inspectionTeamIds.filter((teamId) =>
			validInspectionTeamIdSet.has(teamId),
		),
	};
}

function recommendationToForm(
	item: RecommendationRead,
): RecommendationFormState {
	const hasInspectionLink =
		typeof item.inspectionId === "number" &&
		Number.isFinite(item.inspectionId) &&
		item.inspectionId > 0;
	const normalizedStatus = String(item.status ?? "").trim();
	const statusValue =
		normalizedStatus.toLowerCase() === "brak" ? "" : normalizedStatus;

	return {
		inspectionId: hasInspectionLink ? String(item.inspectionId) : "",
		isInspectionMissing: !hasInspectionLink,
		inspectionTeamIds: parseNumericIdList(item.inspectionTeamIds),
		pozycja: String(item.pozycja),
		nazwaPodmiotu: item.nazwaPodmiotu,
		terminWykonaniaZalecen: item.dataZalecen ?? item.terminWykonaniaZalecen ?? "",
		status: statusValue,
		komentarz: item.komentarz ?? "",
		dataZalecenList: toDateList(
			item.terminyWykonaniaZalecenList.length > 0
				? item.terminyWykonaniaZalecenList
				: item.dataZalecenList,
		),
		dataAkceptacjiList: toDateList(item.dataAkceptacjiNotyWeryfikacjiList),
		isDataZalecenBrak: item.brakTerminowWykonaniaZalecen === true,
		isDataAkceptacjiBrak: item.brakDatAkceptacjiNotyWeryfikacji === true,
	};
}

function MultiSelectTeamField({
	label,
	options,
	values,
	onChange,
	disabled = false,
	placeholder = "Wybierz zespoły",
	searchPlaceholder = "Wyszukaj zespół...",
}: {
	label: string;
	options: InspectionTeamOption[];
	values: number[];
	onChange: (next: number[]) => void;
	disabled?: boolean;
	placeholder?: string;
	searchPlaceholder?: string;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const popupRef = useRef<HTMLDivElement | null>(null);
	const [popupPosition, setPopupPosition] = useState<{
		top: number;
		left: number;
		width: number;
		maxHeight: number;
	} | null>(null);

	const optionById = new Map(options.map((option) => [option.id, option]));
	const selectedLabels = values
		.map((teamId) => optionById.get(teamId)?.label ?? `ID: ${teamId}`)
		.filter(Boolean);
	const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase("pl-PL");
	const visibleOptions = normalizedSearchQuery
		? options.filter((option) =>
				option.label.toLocaleLowerCase("pl-PL").includes(normalizedSearchQuery),
		  )
		: options;

	const updatePopupPosition = () => {
		const trigger = triggerRef.current;
		if (!trigger) {
			return;
		}

		const rect = trigger.getBoundingClientRect();
		const viewportPadding = 8;
		const dialog = trigger.closest('[role="dialog"]') as HTMLElement | null;
		const dialogRect = dialog?.getBoundingClientRect() ?? null;
		const availableTop = Math.max(
			viewportPadding,
			dialogRect ? dialogRect.top + viewportPadding : viewportPadding,
		);
		const availableBottom = Math.min(
			window.innerHeight - viewportPadding,
			dialogRect
				? dialogRect.bottom - viewportPadding
				: window.innerHeight - viewportPadding,
		);
		const popupContentHeight = popupRef.current
			? popupRef.current.scrollHeight
			: 300;
		const gap = 8;
		const spaceBelow = Math.max(0, availableBottom - rect.bottom - gap);
		const spaceAbove = Math.max(0, rect.top - availableTop - gap);
		const shouldOpenUp = spaceBelow < 220 && spaceAbove > spaceBelow;
		const maxHeight = Math.max(160, shouldOpenUp ? spaceAbove : spaceBelow);
		const desiredHeight = Math.min(Math.max(180, popupContentHeight), maxHeight);
		const requestedTop = shouldOpenUp
			? rect.top - desiredHeight - gap
			: rect.bottom + gap;
		const minTop = availableTop;
		const maxTop = Math.max(minTop, availableBottom - desiredHeight);

		setPopupPosition({
			top: Math.min(Math.max(requestedTop, minTop), maxTop),
			left: Math.min(
				Math.max(viewportPadding, rect.left),
				window.innerWidth - rect.width - viewportPadding,
			),
			width: rect.width,
			maxHeight,
		});
	};

	useEffect(() => {
		if (!isOpen) {
			setPopupPosition(null);
			setSearchQuery("");
			return;
		}

		updatePopupPosition();
		const frameId = window.requestAnimationFrame(() => {
			updatePopupPosition();
		});
		const handleAnyScroll = (event: Event) => {
			const target = event.target as Node | null;
			if (target && popupRef.current?.contains(target)) {
				return;
			}
			updatePopupPosition();
		};

		window.addEventListener("resize", updatePopupPosition);
		window.addEventListener("scroll", handleAnyScroll, true);

		return () => {
			window.cancelAnimationFrame(frameId);
			window.removeEventListener("resize", updatePopupPosition);
			window.removeEventListener("scroll", handleAnyScroll, true);
		};
	}, [isOpen, options.length]);

	useEffect(() => {
		if (!isOpen) {
			return;
		}

		const handlePointerDown = (event: MouseEvent) => {
			const target = event.target as Node | null;
			if (!target) {
				return;
			}

			const isInsideTrigger =
				triggerRef.current && triggerRef.current.contains(target);
			const isInsidePopup = popupRef.current && popupRef.current.contains(target);

			if (!isInsideTrigger && !isInsidePopup) {
				setIsOpen(false);
			}
		};

		document.addEventListener("mousedown", handlePointerDown);
		return () => {
			document.removeEventListener("mousedown", handlePointerDown);
		};
	}, [isOpen]);

	const toggleOption = (teamId: number) => {
		if (disabled) {
			return;
		}

		if (values.includes(teamId)) {
			onChange(values.filter((value) => value !== teamId));
			return;
		}

		onChange([...values, teamId].sort((left, right) => left - right));
	};

	return (
		<label className="text-sm text-slate-700">
			<span className="mb-1 block">{label}</span>
			<div className="relative">
				<button
					ref={triggerRef}
					type="button"
					disabled={disabled}
					onClick={() => setIsOpen((prev) => !prev)}
					className="flex w-full items-start justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-slate-900 text-sm outline-none transition-colors hover:bg-slate-50 focus:border-blue-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-600"
				>
					<span className="min-w-0 whitespace-normal break-words">
						{selectedLabels.length > 0
							? selectedLabels.join(", ")
							: placeholder}
					</span>
					<X size={14} className="rotate-45 text-slate-500" />
				</button>

				{isOpen && popupPosition
					? createPortal(
							<div
								ref={popupRef}
								className="fixed z-[80] rounded-xl border border-slate-200 bg-white p-2 shadow-[0_14px_34px_rgba(15,23,42,0.14)]"
								style={{
									top: popupPosition.top,
									left: popupPosition.left,
									width: popupPosition.width,
									maxHeight: popupPosition.maxHeight,
									overflowY: "auto",
								}}
							>
								<div className="mb-2 border-slate-200 border-b pb-2 font-medium text-slate-600 text-xs">
									Wybierz jeden lub więcej zespołów
								</div>

								<div className="mb-2">
									<input
										type="text"
										value={searchQuery}
										onChange={(event) => setSearchQuery(event.target.value)}
										placeholder={searchPlaceholder}
										className="h-8 w-full rounded-md border border-slate-300 px-2 text-slate-900 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-blue-400"
									/>
								</div>

								<div className="subtle-vertical-scroll max-h-52 space-y-1 overflow-y-auto pr-1">
									{visibleOptions.length === 0 ? (
										<p className="px-2 py-1 text-slate-500 text-sm">
											Brak dostępnych opcji.
										</p>
									) : null}

									{visibleOptions.map((option) => {
										const isSelected = values.includes(option.id);
										return (
											<button
												key={`${option.id}-${option.label}`}
												type="button"
												disabled={disabled}
												onClick={() => toggleOption(option.id)}
												className={`flex w-full items-center gap-2 rounded-sm px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
													isSelected
														? "!bg-transparent !text-slate-900 hover:!bg-transparent"
														: "text-slate-900 hover:bg-blue-50 hover:text-blue-900"
												}`}
											>
												<input
													type="checkbox"
													checked={isSelected}
													disabled={disabled}
													readOnly
													className="h-4 w-4 accent-blue-600"
												/>
												<span className="min-w-0 whitespace-normal break-words">
													{option.label}
												</span>
											</button>
										);
									})}
								</div>
							</div>,
							document.body,
					  )
					: null}
			</div>
			<span className="mt-1 block text-xs text-slate-500">Wybrano zespołów: {values.length}</span>
		</label>
	);
}

function formatLockStartHourMinute(value: string | null | undefined) {
	if (!value) {
		return "--:--";
	}

	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return "--:--";
	}

	return new Intl.DateTimeFormat("pl-PL", {
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	}).format(date);
}


function parseIsoDate(value: string): Date | undefined {
	if (!value) {
		return undefined;
	}

	const [yearText, monthText, dayText] = value.split("-");
	const year = Number(yearText);
	const month = Number(monthText);
	const day = Number(dayText);
	if (
		!Number.isInteger(year) ||
		!Number.isInteger(month) ||
		!Number.isInteger(day) ||
		month < 1 ||
		month > 12 ||
		day < 1 ||
		day > 31
	) {
		return undefined;
	}

	const date = new Date(year, month - 1, day);
	if (
		date.getFullYear() !== year ||
		date.getMonth() !== month - 1 ||
		date.getDate() !== day
	) {
		return undefined;
	}

	return date;
}

function toIsoDateValue(date: Date) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

const MIN_CALENDAR_DATE = new Date(2016, 0, 1);
const MAX_CALENDAR_DATE = new Date(2030, 11, 31);

function clampDateToCalendarRange(date: Date) {
	if (date < MIN_CALENDAR_DATE) {
		return MIN_CALENDAR_DATE;
	}

	if (date > MAX_CALENDAR_DATE) {
		return MAX_CALENDAR_DATE;
	}

	return date;
}

function formatDisplayDate(value: string) {
	const parsed = parseIsoDate(value);
	if (!parsed) {
		return "";
	}

	const day = String(parsed.getDate()).padStart(2, "0");
	const month = String(parsed.getMonth() + 1).padStart(2, "0");
	const year = parsed.getFullYear();
	return `${day}.${month}.${year}`;
}

function DateFieldWithClear({
	label,
	value,
	onChange,
	disabled = false,
}: {
	label: string;
	value: string;
	onChange: (next: string) => void;
	disabled?: boolean;
}) {
	const [isCalendarOpen, setIsCalendarOpen] = useState(false);
	const [calendarView, setCalendarView] = useState<"year" | "month" | "day">(
		"day",
	);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const popupRef = useRef<HTMLDivElement | null>(null);
	const [popupPosition, setPopupPosition] = useState<{
		top: number;
		left: number;
	} | null>(null);
	const [tempDate, setTempDate] = useState<Date | null>(() =>
		parseIsoDate(value) ?? null,
	);
	const popupWidth = calendarView === "day" ? 288 : 336;
	const popupHeight = calendarView === "day" ? 420 : 372;

	const updatePopupPosition = () => {
		const anchor = containerRef.current;
		if (!anchor) {
			return;
		}

		const anchorRect = anchor.getBoundingClientRect();
		const viewportPadding = 8;
		const offset = 8;
		const spaceBelow = window.innerHeight - anchorRect.bottom;
		const canOpenUp =
			spaceBelow < popupHeight + offset && anchorRect.top > popupHeight + offset;
		const top = canOpenUp
			? anchorRect.top - popupHeight - offset
			: anchorRect.bottom + offset;
		const left = Math.min(
			Math.max(viewportPadding, anchorRect.right - popupWidth),
			window.innerWidth - popupWidth - viewportPadding,
		);

		setPopupPosition({ top, left });
	};

	useEffect(() => {
		setTempDate(parseIsoDate(value) ?? null);
	}, [value]);

	useEffect(() => {
		if (!isCalendarOpen) {
			setPopupPosition(null);
			return;
		}

		updatePopupPosition();
		const handleAnyScroll = (event: Event) => {
			const target = event.target as Node | null;
			if (target && popupRef.current?.contains(target)) {
				return;
			}
			setIsCalendarOpen(false);
		};

		window.addEventListener("resize", updatePopupPosition);
		window.addEventListener("scroll", handleAnyScroll, true);
		return () => {
			window.removeEventListener("resize", updatePopupPosition);
			window.removeEventListener("scroll", handleAnyScroll, true);
		};
	}, [isCalendarOpen, calendarView]);

	useEffect(() => {
		if (!isCalendarOpen) {
			return;
		}

		const handlePointerDown = (event: MouseEvent) => {
			const target = event.target as Node | null;
			if (!target) {
				return;
			}

			const isInsideAnchor =
				containerRef.current && containerRef.current.contains(target);
			const isInsidePopup = popupRef.current && popupRef.current.contains(target);

			if (!isInsideAnchor && !isInsidePopup) {
				setIsCalendarOpen(false);
			}
		};

		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setIsCalendarOpen(false);
			}
		};

		document.addEventListener("mousedown", handlePointerDown);
		document.addEventListener("keydown", handleEscape);

		return () => {
			document.removeEventListener("mousedown", handlePointerDown);
			document.removeEventListener("keydown", handleEscape);
		};
	}, [isCalendarOpen]);

	const handleClear = () => {
		onChange("");
		setTempDate(null);
		setCalendarView("day");
		setIsCalendarOpen(false);
	};

	const handleToday = () => {
		const today = clampDateToCalendarRange(new Date());
		setTempDate(today);
		onChange(toIsoDateValue(today));
		setCalendarView("day");
		setIsCalendarOpen(false);
	};

	return (
		<label className="text-slate-700 text-sm">
			<span className="mb-1 block overflow-hidden text-ellipsis whitespace-nowrap">
				{label}
			</span>
			<div ref={containerRef} className="relative">
				<input
					type="text"
					value={formatDisplayDate(value)}
					placeholder="dd.mm.rrrr"
					readOnly
					disabled={disabled}
					onKeyDown={(event) => {
						if (disabled || !value) {
							return;
						}

						if (event.key === "Backspace" || event.key === "Delete") {
							event.preventDefault();
							handleClear();
						}
					}}
					onClick={() => {
						if (!disabled) {
							setIsCalendarOpen((prev) => {
								const next = !prev;
								if (next) {
									setTempDate(parseIsoDate(value) ?? null);
									setCalendarView("day");
								}
								return next;
							});
						}
					}}
					className="w-full cursor-pointer rounded-lg border border-slate-300 px-3 py-2 pr-10 text-sm outline-none transition-colors focus:border-blue-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-700"
				/>
				<button
					type="button"
					aria-label={`Otwórz kalendarz dla pola: ${label}`}
					disabled={disabled}
					onMouseDown={(event) => {
						event.preventDefault();
						event.stopPropagation();
					}}
					onClick={(event) => {
						event.preventDefault();
						event.stopPropagation();
						if (disabled) {
							return;
						}

						setIsCalendarOpen((prev) => {
							const next = !prev;
							if (next) {
								setTempDate(parseIsoDate(value) ?? null);
								setCalendarView("day");
							}
							return next;
						});
					}}
					className="absolute top-1/2 right-2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
				>
					<CalendarDays size={13} />
				</button>

				{isCalendarOpen && !disabled && popupPosition
					? createPortal(
							<div
								ref={popupRef}
								className={`fixed z-[80] rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_16px_40px_rgba(15,23,42,0.14)] ${
									calendarView === "day" ? "w-[18rem]" : "w-[21rem]"
								}`}
								style={{
									top: popupPosition.top,
									left: popupPosition.left,
								}}
							>
								<LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={pl}>
									<DateCalendar
										value={tempDate}
										onChange={(nextValue) => {
											setTempDate(nextValue);
											if (calendarView === "day" && nextValue) {
												onChange(toIsoDateValue(nextValue));
												setCalendarView("day");
												setIsCalendarOpen(false);
											}
										}}
										view={calendarView}
										onViewChange={(nextView) => setCalendarView(nextView)}
										views={["year", "month", "day"]}
										openTo="day"
										minDate={MIN_CALENDAR_DATE}
										maxDate={MAX_CALENDAR_DATE}
										referenceDate={tempDate ?? new Date()}
										sx={{
											width: "100%",
											maxHeight: calendarView === "day" ? 336 : 356,
											"& .MuiPickersCalendarHeader-root": {
												paddingLeft: 0,
												paddingRight: 0,
												marginBottom: "0.35rem",
											},
											"& .MuiPickersCalendarHeader-label": {
												fontSize: "1.05rem",
												fontWeight: 700,
												color: "#0f172a",
											},
											"& .MuiPickersArrowSwitcher-button": {
												color: "#64748b",
											},
											"& .MuiDayCalendar-weekDayLabel": {
												fontSize: "0.76rem",
												fontWeight: 600,
												color: "#64748b",
											},
											"& .MuiPickersDay-root": {
												fontSize: "0.95rem",
												fontWeight: 500,
												color: "#0f172a",
											},
											"& .MuiPickersDay-root.Mui-selected": {
												backgroundColor: "#1976d2",
												color: "#fff",
											},
											"& .MuiPickersDay-root.MuiPickersDay-today": {
												borderColor: "#94a3b8",
											},
											"& .MuiYearCalendar-button": {
												fontSize: "0.98rem",
												fontWeight: 500,
												color: "#0f172a",
											},
											"& .MuiYearCalendar-button.Mui-selected": {
												backgroundColor: "#1976d2",
												color: "#fff",
											},
											"& .MuiMonthCalendar-button": {
												fontSize: "0.98rem",
												fontWeight: 600,
												color: "#0f172a",
											},
											"& .MuiMonthCalendar-button.Mui-selected": {
												backgroundColor: "#1976d2",
												color: "#fff",
											},
											"& .MuiYearCalendar-root": {
												height: 252,
											},
											"& .MuiMonthCalendar-root": {
												height: 252,
											},
										}}
									/>
								</LocalizationProvider>

								<div className="mt-3 flex items-center justify-between border-slate-100 border-t pt-3">
									<button
										type="button"
										onClick={handleToday}
										className="font-bold text-[11px] text-slate-400 uppercase tracking-wide transition-colors hover:text-slate-500"
									>
										Dzisiaj
									</button>
									<button
										type="button"
										onClick={handleClear}
										className="rounded-lg bg-blue-50 px-4 py-2 font-bold text-[11px] text-blue-600 uppercase tracking-wide transition-colors hover:bg-blue-100"
									>
										Wyczyść
									</button>
								</div>
							</div>,
							document.body,
						)
					: null}
			</div>
		</label>
	);
}

export function RecommendationsPanel({
	operatorLogin,
	authRole,
	isObserver,
}: RecommendationsPanelProps) {
	const [items, setItems] = useState<RecommendationRead[]>([]);
	const [total, setTotal] = useState(0);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [advancedFilterAnchor, setAdvancedFilterAnchor] = useState({
		top: 120,
		left: 120,
	});
	const [isExporting, setIsExporting] = useState(false);
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [isExportConfigModalOpen, setIsExportConfigModalOpen] = useState(false);
	const [includeInspectionsInExport, setIncludeInspectionsInExport] =
		useState(false);
	const [includeSanctionsInExport, setIncludeSanctionsInExport] = useState(false);
	const [includeDecisionsInExport, setIncludeDecisionsInExport] = useState(false);
	const [activeExportColumnsTab, setActiveExportColumnsTab] = useState<
		"inspections" | "sanctions" | "decisions"
	>("inspections");
	const [selectedInspectionExportColumns, setSelectedInspectionExportColumns] =
		useState<InspectionExportColumnKey[]>(
			INSPECTION_EXPORT_COLUMNS.map((column) => column.key),
		);
	const [selectedSanctionExportColumns, setSelectedSanctionExportColumns] =
		useState<SanctionExportColumnKey[]>(
			SANCTION_EXPORT_COLUMNS.map((column) => column.key),
		);
	const [selectedDecisionExportColumns, setSelectedDecisionExportColumns] =
		useState<DecisionExportColumnKey[]>(
			DECISION_EXPORT_COLUMNS.map((column) => column.key),
		);

	const [selectedId, setSelectedId] = useState<number | null>(null);
	const [centerRecommendationId, setCenterRecommendationId] = useState<
		number | null
	>(null);
	const [pendingDashboardRecommendationCode, setPendingDashboardRecommendationCode] =
		useState<string | null>(null);
	const [isFormOpen, setIsFormOpen] = useState(false);
	const [editingItem, setEditingItem] = useState<RecommendationRead | null>(
		null,
	);
	const [form, setForm] = useState<RecommendationFormState>(EMPTY_FORM);
	const [formError, setFormError] = useState<string | null>(null);
	const [recommendationValidationModalData, setRecommendationValidationModalData] =
		useState<RecommendationValidationModalData | null>(null);
	const [showRequiredFieldErrors, setShowRequiredFieldErrors] = useState(false);
	const [versionConflictUpdatedAt, setVersionConflictUpdatedAt] = useState<string | null>(null);
	const [saveLockConflict, setSaveLockConflict] =
		useState<RecommendationLockConflict | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false);
	const [successEntityName, setSuccessEntityName] = useState("");
	const [successInspectionCode, setSuccessInspectionCode] = useState("");
	const [successMode, setSuccessMode] = useState<"create" | "edit">(
		"create",
	);
	const didNormalizeEditStatusRef = useRef(false);
	const recommendationTableBodyRef = useRef<HTMLTableSectionElement | null>(null);
	const [isDeleteConfirmModalOpen, setIsDeleteConfirmModalOpen] =
		useState(false);
	const [isDeletingItem, setIsDeletingItem] = useState(false);
	const [isDeleteSuccessModalOpen, setIsDeleteSuccessModalOpen] =
		useState(false);
	const [deleteSuccessEntityName, setDeleteSuccessEntityName] = useState("");
	const [tablePageSize, setTablePageSize] = useState<number>(() =>
		readPersistedTablePageSize(
			`${RECOMMENDATIONS_TABLE_VIEW_STORAGE_PREFIX}.${operatorLogin
				.trim()
				.toLowerCase()}.page-size`,
		),
	);
	const [inspectionOptions, setInspectionOptions] = useState<
		InspectionOption[]
	>([]);
	const [isInspectionOptionsLoading, setIsInspectionOptionsLoading] =
		useState(false);
	const [inspectionTeamOptions, setInspectionTeamOptions] = useState<
		InspectionTeamOption[]
	>([]);
	const [isInspectionTeamSelectionManual, setIsInspectionTeamSelectionManual] =
		useState(false);
	const [recommendationStatusOptions, setRecommendationStatusOptions] =
		useState<SelectOption[]>([]);
	const [recommendationStatusIdByValue, setRecommendationStatusIdByValue] =
		useState<Record<string, number>>({});
	const [recommendationStatusCodeByValue, setRecommendationStatusCodeByValue] =
		useState<Record<string, string>>({});
	const [recommendationStatusStyleByCode, setRecommendationStatusStyleByCode] =
		useState<Record<string, RecommendationStatusStyle>>({});
	const [entityNameOptions, setEntityNameOptions] = useState<SelectOption[]>([]);
	const [entityNameIdByValue, setEntityNameIdByValue] = useState<
		Record<string, number>
	>({});
	const [columnWidths, setColumnWidths] = useState<
		Partial<Record<RecommendationColumnKey, number>>
	>(DEFAULT_RECOMMENDATION_COLUMN_WIDTHS);
	const [recommendationNameVariants, setRecommendationNameVariants] =
		useState<RecommendationNameVariantByColumn>(
			DEFAULT_RECOMMENDATION_NAME_VARIANTS,
		);
	const [isStatusHighlightingEnabled, setIsStatusHighlightingEnabled] =
		useState(true);
	const [isStatusHighlightingHydrated, setIsStatusHighlightingHydrated] =
		useState(false);
	const [draftRecommendationNameVariants, setDraftRecommendationNameVariants] =
		useState<RecommendationNameVariantByColumn>(
			DEFAULT_RECOMMENDATION_NAME_VARIANTS,
		);
	const [areNameVariantsHydrated, setAreNameVariantsHydrated] =
		useState(false);
	const [cachedQuickRecommendationTeamLabels, setCachedQuickRecommendationTeamLabels] =
		useState<string[]>([]);
	const [areQuickFiltersHydrated, setAreQuickFiltersHydrated] =
		useState(false);
	const [areColumnWidthsHydrated, setAreColumnWidthsHydrated] = useState(false);
	const canManageRecommendations = authRole !== "external_user" && !isObserver;
	const isDirector = authRole === "director";
	const normalizedOperatorLogin = operatorLogin.trim().toLowerCase();
	const columnWidthsStorageKey = `${RECOMMENDATIONS_COLUMN_WIDTHS_STORAGE_PREFIX}.${normalizedOperatorLogin}`;
	const nameVariantsStorageKey = `${RECOMMENDATIONS_NAME_VARIANTS_STORAGE_PREFIX}.${normalizedOperatorLogin}`;
	const tableViewStorageKey = `${RECOMMENDATIONS_TABLE_VIEW_STORAGE_PREFIX}.${normalizedOperatorLogin}`;
	const statusHighlightingStorageKey = `${RECOMMENDATIONS_STATUS_HIGHLIGHTING_STORAGE_PREFIX}.${normalizedOperatorLogin}`;
	const quickFilterTeamLabelsStorageKey = `${RECOMMENDATIONS_QUICK_FILTER_TEAM_LABELS_STORAGE_PREFIX}.${normalizedOperatorLogin}`;
	const quickFilterSelectionsStorageKey = `${RECOMMENDATIONS_QUICK_FILTER_SELECTIONS_STORAGE_PREFIX}.${normalizedOperatorLogin}`;
	const tablePageSizeStorageKey = `${tableViewStorageKey}.page-size`;

	useEffect(() => {
		if (!isFullscreen || typeof document === "undefined") {
			return;
		}

		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setIsFullscreen(false);
			}
		};

		window.addEventListener("keydown", handleKeyDown);

		return () => {
			document.body.style.overflow = previousOverflow;
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [isFullscreen]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		const raw = window.localStorage.getItem(quickFilterTeamLabelsStorageKey);
		if (!raw) {
			setCachedQuickRecommendationTeamLabels([]);
			return;
		}

		try {
			const parsed = JSON.parse(raw) as unknown;
			if (!Array.isArray(parsed)) {
				setCachedQuickRecommendationTeamLabels([]);
				return;
			}

			const normalized = Array.from(
				new Set(
					parsed
						.map((value) => String(value ?? "").trim())
						.filter(Boolean),
				),
			).sort((left, right) =>
				left.localeCompare(right, "pl", {
					sensitivity: "base",
					numeric: true,
				}),
			);

			setCachedQuickRecommendationTeamLabels(normalized);
		} catch {
			setCachedQuickRecommendationTeamLabels([]);
		}
	}, [quickFilterTeamLabelsStorageKey]);

	useEffect(() => {
		setTablePageSize(readPersistedTablePageSize(tablePageSizeStorageKey));
	}, [tablePageSizeStorageKey]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		window.localStorage.setItem(
			tablePageSizeStorageKey,
			String(tablePageSize),
		);
	}, [tablePageSize, tablePageSizeStorageKey]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		const raw = window.localStorage.getItem(statusHighlightingStorageKey);
		if (raw === null) {
			setIsStatusHighlightingEnabled(true);
			setIsStatusHighlightingHydrated(true);
			return;
		}

		const normalized = raw.trim().toLowerCase();
		setIsStatusHighlightingEnabled(
			normalized !== "0" && normalized !== "false" && normalized !== "off",
		);
		setIsStatusHighlightingHydrated(true);
	}, [statusHighlightingStorageKey]);

	useEffect(() => {
		if (typeof window === "undefined" || !isStatusHighlightingHydrated) {
			return;
		}

		window.localStorage.setItem(
			statusHighlightingStorageKey,
			isStatusHighlightingEnabled ? "1" : "0",
		);
	}, [
		isStatusHighlightingEnabled,
		isStatusHighlightingHydrated,
		statusHighlightingStorageKey,
	]);

	const selectedItem = useMemo(
		() => items.find((item) => item.id === selectedId) ?? null,
		[items, selectedId],
	);

	const selectedInspectionOption = useMemo(
		() =>
			inspectionOptions.find(
				(option) => String(option.id) === form.inspectionId,
			) ?? null,
		[form.inspectionId, inspectionOptions],
	);

	const validInspectionTeamIdSet = useMemo(() => {
		return new Set(inspectionTeamOptions.map((option) => option.id));
	}, [inspectionTeamOptions]);

	const entityShortLabelByFullName = useMemo(() => {
		const byFullName = new Map<string, string>();
		for (const option of entityNameOptions) {
			const normalizedFullName = option.value.trim().toLowerCase();
			if (!normalizedFullName) {
				continue;
			}

			if (!byFullName.has(normalizedFullName)) {
				byFullName.set(normalizedFullName, option.label);
			}
		}

		return byFullName;
	}, [entityNameOptions]);

	const inspectionSelectOptions = useMemo(
		() => {
			const baseOptions = inspectionOptions.map((option) => {
				const shortEntityNameFromDictionary = entityShortLabelByFullName.get(
					option.nazwaPodmiotu.trim().toLowerCase(),
				);
				const displayEntityName =
					option.nazwaPodmiotuSkrocona ||
					shortEntityNameFromDictionary ||
					option.nazwaPodmiotu;

				return {
					value: String(option.id),
					label: `${option.inspectionCode}${displayEntityName ? ` - ${displayEntityName}` : ""}`,
				};
			});

			const selectedInspectionId = form.inspectionId.trim();
			if (!selectedInspectionId) {
				return baseOptions;
			}

			const hasSelectedOption = baseOptions.some(
				(option) => option.value === selectedInspectionId,
			);
			if (hasSelectedOption) {
				return baseOptions;
			}

			const inspectionCode = String(
				editingItem?.inspectionKod ??
					editingItem?.kodInspekcji ??
					editingItem?.inspectionLp ??
					selectedInspectionId,
			)
				.trim();
			const fallbackEntityName =
				String(editingItem?.nazwaPodmiotuSkrocona ?? "").trim() ||
				String(editingItem?.nazwaPodmiotu ?? "").trim() ||
				form.nazwaPodmiotu.trim();
			const fallbackLabel = `${inspectionCode}${
				fallbackEntityName ? ` - ${fallbackEntityName}` : ""
			}`;

			return [
				{
					value: selectedInspectionId,
					label: fallbackLabel,
				},
				...baseOptions,
			];
		},
		[
			editingItem,
			entityShortLabelByFullName,
			form.inspectionId,
			form.nazwaPodmiotu,
			inspectionOptions,
		],
	);

	const displayEntityNameInForm = useMemo(() => {
		if (form.isInspectionMissing) {
			return form.nazwaPodmiotu;
		}

		if (selectedInspectionOption) {
			const shortEntityNameFromDictionary = entityShortLabelByFullName.get(
				selectedInspectionOption.nazwaPodmiotu.trim().toLowerCase(),
			);

			return (
				selectedInspectionOption.nazwaPodmiotuSkrocona ||
				shortEntityNameFromDictionary ||
				selectedInspectionOption.nazwaPodmiotu
			);
		}

		return form.nazwaPodmiotu;
	}, [
		entityShortLabelByFullName,
		form.isInspectionMissing,
		form.nazwaPodmiotu,
		selectedInspectionOption,
	]);

	const isEditMode = Boolean(editingItem);
	const editRecordLock = useRecordLock({
		enabled: isFormOpen && isEditMode,
		module: "recommendations",
		recordId: editingItem?.id ?? null,
		operatorLogin,
		heartbeatIntervalMs: 20_000,
	});
	const shouldShowLockedByOtherUser = Boolean(saveLockConflict) || editRecordLock.isBlocked;
	const isReadOnlyDueToLock = isEditMode && shouldShowLockedByOtherUser;
	const isSaveDisabledDueToLock = isEditMode && (editRecordLock.isAcquireFailed || editRecordLock.isConnectionLost || editRecordLock.isExpired);
	const lockOwnerDisplayName =
		saveLockConflict?.ownerDisplayName || editRecordLock.owner?.displayName || "";
	const lockOwnerLogin =
		saveLockConflict?.ownerLogin || editRecordLock.owner?.login || "";
	const lockOwnerLabel =
		lockOwnerDisplayName || lockOwnerLogin
			? `${lockOwnerDisplayName || "Nieznany użytkownik"}${
					lockOwnerLogin ? ` (${lockOwnerLogin})` : ""
			  }`
			: "inny użytkownik";
	const lockAcquiredAt =
		saveLockConflict?.acquiredAt || editRecordLock.lockDetails?.acquiredAt || null;

	const closeModalRef = useRef<() => void>(() => {});
	const inactivityTimeout = useInactivityTimeout({
		enabled: isFormOpen,
		inactivityMs: INACTIVITY_TIMEOUT_MS,
		warningMs: INACTIVITY_WARNING_MS,
		onTimeout: () => closeModalRef.current(),
	});

	const inspectionCodeById = useMemo(
		() => new Map(inspectionOptions.map((option) => [option.id, option.inspectionCode])),
		[inspectionOptions],
	);

	const inspectionTeamDisplayLabelById = useMemo(() => {
		return Object.fromEntries(
			inspectionTeamOptions.map((option) => [option.id, option.shortLabel || option.label]),
		) as Record<number, string>;
	}, [inspectionTeamOptions]);

	const resolveInspectionCode = (payload: {
		inspectionKod?: unknown;
		kodInspekcji?: unknown;
		inspectionLp?: unknown;
		lp?: unknown;
		inspectionId?: unknown;
	}) => {
		const inspectionKod = String(payload.inspectionKod ?? "").trim();
		if (inspectionKod) {
			return inspectionKod;
		}

		const kodInspekcji = String(payload.kodInspekcji ?? "").trim();
		if (kodInspekcji) {
			return kodInspekcji;
		}

		const inspectionLp = String(payload.inspectionLp ?? "").trim();
		if (inspectionLp) {
			return inspectionLp;
		}

		const lp = String(payload.lp ?? "").trim();
		if (lp) {
			return lp;
		}

		const numericInspectionId = Number(payload.inspectionId);
		if (Number.isFinite(numericInspectionId) && numericInspectionId > 0) {
			const mappedCode = inspectionCodeById.get(numericInspectionId);
			if (mappedCode) {
				return mappedCode;
			}
			return String(numericInspectionId);
		}

		return "";
	};

	const getCellValue = (
		item: RecommendationRead,
		columnKey: RecommendationColumnKey,
	) => {
		if (columnKey === "terminWykonaniaZalecen") {
			return item.dataZalecen ?? item.terminWykonaniaZalecen ?? "";
		}

		if (columnKey === "inspectionId") {
			return resolveInspectionCode({
				inspectionKod: item.inspectionKod,
				kodInspekcji: item.kodInspekcji,
				inspectionLp: item.inspectionLp,
				inspectionId: item.inspectionId,
			});
		}

		if (columnKey === "zespoly") {
			const ids = parseNumericIdList(item.inspectionTeamIds);
			if (ids.length === 0) {
				return "";
			}

			return ids
				.map(
					(teamId) => inspectionTeamDisplayLabelById[teamId] ?? `ID: ${teamId}`,
				)
				.join(", ");
		}

		if (columnKey === "kodZalecenia") {
			return String(item.kodZalecenia ?? "").trim();
		}

		if (columnKey === "dataZalecenList") {
			const source = item.terminyWykonaniaZalecenList.length > 0
				? item.terminyWykonaniaZalecenList
				: item.dataZalecenList;
			return formatDateListDisplay(
				source,
				item.brakTerminowWykonaniaZalecen === true,
			);
		}

		if (columnKey === "dataAkceptacjiNotyWeryfikacjiList") {
			return formatDateListDisplay(
				item.dataAkceptacjiNotyWeryfikacjiList,
				item.brakDatAkceptacjiNotyWeryfikacji === true,
			);
		}

		const raw = item[columnKey as keyof RecommendationRead];
		if (raw === null || raw === undefined) {
			return "";
		}

		return String(raw);
	};

	const recommendationRowsForDisplay = useMemo(
		() =>
			items.map((item, index) => {
				const resolveDisplayText = (
					columnKey: RecommendationNameVariantColumnKey,
				) => {
					if (recommendationNameVariants[columnKey] !== "short") {
						return String(item[columnKey] ?? "").trim();
					}

					const shortValue =
						columnKey === "nazwaPodmiotu"
							? item.nazwaPodmiotuSkrocona
							: item.statusSkrocona;

					return String(shortValue ?? item[columnKey] ?? "").trim();
				};

				return {
					...item,
					lp: items.length - index,
					nazwaPodmiotu: resolveDisplayText("nazwaPodmiotu"),
					status: resolveDisplayText("status") || null,
				};
			}),
		[items, recommendationNameVariants],
	);

	const setFormDataZalecenList = (nextValue: SetStateAction<string[]>) => {
		setForm((prev) => ({
			...prev,
			dataZalecenList: resolveSetStateAction(nextValue, prev.dataZalecenList),
		}));
	};

	const setFormDataAkceptacjiList = (nextValue: SetStateAction<string[]>) => {
		setForm((prev) => ({
			...prev,
			dataAkceptacjiList: resolveSetStateAction(
				nextValue,
				prev.dataAkceptacjiList,
			),
		}));
	};

	const setFormIsDataZalecenBrak = (nextValue: SetStateAction<boolean>) => {
		setForm((prev) => ({
			...prev,
			isDataZalecenBrak: resolveSetStateAction(
				nextValue,
				prev.isDataZalecenBrak,
			),
		}));
	};

	const setFormIsDataAkceptacjiBrak = (nextValue: SetStateAction<boolean>) => {
		setForm((prev) => ({
			...prev,
			isDataAkceptacjiBrak: resolveSetStateAction(
				nextValue,
				prev.isDataAkceptacjiBrak,
			),
		}));
	};

	const statusOptionsForForm = useMemo(() => {
		const fullStatusOptions = recommendationStatusOptions.map((option) => ({
			value: option.value,
			label: option.value,
		}));
		const normalizedCurrentStatus = form.status.trim();
		if (!normalizedCurrentStatus) {
			return fullStatusOptions;
		}

		return fullStatusOptions.some(
			(option) => option.value === normalizedCurrentStatus,
		)
			? fullStatusOptions
			: [
				{ value: normalizedCurrentStatus, label: normalizedCurrentStatus },
				...fullStatusOptions,
		  ];
	}, [form.status, recommendationStatusOptions]);

	const inspectionTeamOptionsForForm = useMemo(() => {
		return inspectionTeamOptions.map((option) => ({
			...option,
			label: option.shortLabel || option.label,
		}));
	}, [inspectionTeamOptions]);

	useEffect(() => {
		if (!isFormOpen || !isEditMode) {
			didNormalizeEditStatusRef.current = false;
			return;
		}

		if (didNormalizeEditStatusRef.current) {
			return;
		}

		didNormalizeEditStatusRef.current = true;
		if (form.status.trim().toLowerCase() === "brak") {
			setForm((prev) => ({ ...prev, status: "" }));
		}
	}, [form.status, isEditMode, isFormOpen]);

	const {
		advancedFilterColumnKey,
		advancedFilterSearch,
		advancedFilters,
		canClearFilters,
		clearAdvancedFilterForSelectedColumn,
		clearFilters,
		columnFilters,
		draftHiddenColumns,
		draftVisibleColumns: draftVisibleRecommendationColumns,
		filteredAndSortedRows: filteredAndSortedItems,
		paginatedRows: paginatedRecommendationItems,
		currentPage,
		totalPages,
		pageSize,
		paginationItems,
		resolvePageForRowIndex,
		handlePageChange,
		handleApplyViewChanges,
		handleDraftColumnVisibilityChange,
		handleDraftDeselectAllColumns,
		handleDraftSelectAllColumns,
		handleFilterChange,
		handleOpenViewModal,
		handleSortByColumn,
		isAdvancedFilterModalOpen,
		isColumnPickerOpen,
		selectedAdvancedFilterDateRange,
		selectedAdvancedFilterValues,
		selectAllVisibleAdvancedFilterValues,
		setAdvancedFilterColumnKey,
		setAdvancedFilterDateRange,
		setAdvancedFilterSearch,
		setAdvancedFilterValuesForColumn,
		setIsAdvancedFilterModalOpen,
		setIsColumnPickerOpen,
		sortColumnKey,
		sortDirection,
		toggleAdvancedFilterValue,
		toggleAdvancedFilterValueForColumn,
		visibleAdvancedFilterValues,
		visibleColumns: visibleRecommendationColumns,
	} = useTableState<RecommendationRead, RecommendationColumnKey>({
		rows: recommendationRowsForDisplay,
		allColumnKeys: ALL_RECOMMENDATION_COLUMN_KEYS,
		initialAdvancedFilterColumnKey: "nazwaPodmiotu",
		paginationResetMode: "start",
		initialPageMode: "start",
		getCellValue,
		advancedFilterValueSplitter: (rawValue, columnKey) =>
			splitRecommendationAdvancedFilterCellValue(columnKey, rawValue),
		advancedFilterMatcher: (rawValue, selectedValues, columnKey) =>
			matchesRecommendationAdvancedFilterCellValue(
				columnKey,
				rawValue,
				selectedValues,
			),
		pageSize: tablePageSize,
		hiddenColumnsStorageKey: tableViewStorageKey,
		hiddenColumnsStorageArea: "localStorage",
		alignToEndPageSize: false,
		sortComparators: {
			lp: (left, right) => (Number(getCellValue(left, "lp")) || 0) - (Number(getCellValue(right, "lp")) || 0),
			pozycja: (left, right) =>
				(Number(getCellValue(left, "pozycja")) || 0) -
				(Number(getCellValue(right, "pozycja")) || 0),
		},
	});

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		const raw = window.localStorage.getItem(quickFilterSelectionsStorageKey);
		if (!raw) {
			setAreQuickFiltersHydrated(true);
			return;
		}

		try {
			const parsed = JSON.parse(raw) as {
				teams?: unknown;
				statuses?: unknown;
			};

			const teams = Array.isArray(parsed.teams)
				? parsed.teams
						.map((value) => String(value ?? "").trim())
						.filter(Boolean)
				: [];
			const statuses = Array.isArray(parsed.statuses)
				? parsed.statuses
						.map((value) => String(value ?? "").trim())
						.filter(Boolean)
				: [];

			setAdvancedFilterValuesForColumn("zespoly", teams);
			setAdvancedFilterValuesForColumn("status", statuses);
		} catch {
			setAdvancedFilterValuesForColumn("zespoly", []);
			setAdvancedFilterValuesForColumn("status", []);
		} finally {
			setAreQuickFiltersHydrated(true);
		}
	}, [quickFilterSelectionsStorageKey, setAdvancedFilterValuesForColumn]);

	useEffect(() => {
		if (typeof window === "undefined" || !areQuickFiltersHydrated) {
			return;
		}

		const teams = (advancedFilters.zespoly ?? [])
			.map((value) => value.trim())
			.filter(Boolean);
		const statuses = (advancedFilters.status ?? [])
			.map((value) => value.trim())
			.filter(Boolean);

		if (teams.length === 0 && statuses.length === 0) {
			window.localStorage.removeItem(quickFilterSelectionsStorageKey);
			return;
		}

		window.localStorage.setItem(
			quickFilterSelectionsStorageKey,
			JSON.stringify({ teams, statuses }),
		);
	}, [
		advancedFilters.status,
		advancedFilters.zespoly,
		areQuickFiltersHydrated,
		quickFilterSelectionsStorageKey,
	]);

	const quickRecommendationTeamLabels = useMemo(() => {
		const dictionaryLabels = inspectionTeamOptions
			.map((option) => (option.shortLabel || option.label).trim())
			.filter(Boolean);

		if (dictionaryLabels.length > 0) {
			return Array.from(new Set(dictionaryLabels)).sort((left, right) =>
				left.localeCompare(right, "pl", { sensitivity: "base", numeric: true }),
			);
		}

		if (cachedQuickRecommendationTeamLabels.length > 0) {
			return cachedQuickRecommendationTeamLabels;
		}

		const rowLabels = recommendationRowsForDisplay
			.flatMap((item) => getCellValue(item, "zespoly").split(","))
			.map((value) => value.trim())
			.filter(Boolean);

		return Array.from(new Set(rowLabels)).sort((left, right) =>
			left.localeCompare(right, "pl", { sensitivity: "base", numeric: true }),
		);
	}, [
		cachedQuickRecommendationTeamLabels,
		inspectionTeamOptions,
		recommendationRowsForDisplay,
	]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		if (quickRecommendationTeamLabels.length === 0) {
			return;
		}

		window.localStorage.setItem(
			quickFilterTeamLabelsStorageKey,
			JSON.stringify(quickRecommendationTeamLabels),
		);
	}, [quickFilterTeamLabelsStorageKey, quickRecommendationTeamLabels]);

	const quickRecommendationExcludedStatusCodePositionSet = useMemo(
		() =>
			new Set(
				QUICK_FILTER_RECOMMENDATIONS_EXCLUDED_STATUS_CODE_POSITIONS.map((value) =>
					value.trim().toLowerCase(),
				).filter(Boolean),
			),
		[],
	);

	const quickRecommendationAllowedStatusLabels = useMemo(
		() =>
			recommendationStatusOptions
				.map((option) => option.value.trim())
				.filter(Boolean)
				.filter((statusLabel) => {
					const code =
						recommendationStatusCodeByValue[statusLabel]?.trim().toLowerCase() ?? "";
					if (!code) {
						return true;
					}

					return !quickRecommendationExcludedStatusCodePositionSet.has(code);
				}),
		[
			quickRecommendationExcludedStatusCodePositionSet,
			recommendationStatusCodeByValue,
			recommendationStatusOptions,
		],
	);

	const selectedQuickRecommendationTeams = useMemo(
		() =>
			new Set(
				(advancedFilters.zespoly ?? [])
					.map((value) => value.trim())
					.filter(Boolean),
			),
		[advancedFilters.zespoly],
	);

	const selectedQuickRecommendationStatuses = useMemo(
		() =>
			(advancedFilters.status ?? [])
				.map((value) => value.trim())
				.filter(Boolean),
		[advancedFilters.status],
	);

	const handleQuickRecommendationTeamToggle = useCallback(
		(teamLabel: string) => {
			toggleAdvancedFilterValueForColumn("zespoly", teamLabel);
		},
		[toggleAdvancedFilterValueForColumn],
	);

	const isQuickExcludeClosedActive = useMemo(() => {
		if (quickRecommendationAllowedStatusLabels.length === 0) {
			return false;
		}

		if (
			selectedQuickRecommendationStatuses.length !==
			quickRecommendationAllowedStatusLabels.length
		) {
			return false;
		}

		const selectedSet = new Set(selectedQuickRecommendationStatuses);
		return quickRecommendationAllowedStatusLabels.every((label) =>
			selectedSet.has(label),
		);
	}, [quickRecommendationAllowedStatusLabels, selectedQuickRecommendationStatuses]);

	const handleQuickExcludeClosedRecommendationsToggle = useCallback(() => {
		if (isQuickExcludeClosedActive) {
			setAdvancedFilterValuesForColumn("status", []);
			return;
		}

		setAdvancedFilterValuesForColumn("status", quickRecommendationAllowedStatusLabels);
	}, [
		isQuickExcludeClosedActive,
		quickRecommendationAllowedStatusLabels,
		setAdvancedFilterValuesForColumn,
	]);

	const columnDisplayModeOptionsByKey = useMemo(
		() =>
			Object.fromEntries(
				RECOMMENDATION_NAME_VARIANT_COLUMN_KEYS.map((columnKey) => [
					columnKey,
					[...RECOMMENDATION_NAME_VARIANT_OPTIONS],
				]),
			) as Partial<
				Record<
					RecommendationColumnKey,
					Array<{ value: string; label: string }>
				>
			>,
		[],
	);

	const draftColumnDisplayModeValuesByKey = useMemo(
		() =>
			Object.fromEntries(
				RECOMMENDATION_NAME_VARIANT_COLUMN_KEYS.map((columnKey) => [
					columnKey,
					draftRecommendationNameVariants[columnKey],
				]),
			) as Partial<Record<RecommendationColumnKey, string>>,
		[draftRecommendationNameVariants],
	);

	const handleOpenRecommendationViewModal = () => {
		setDraftRecommendationNameVariants(recommendationNameVariants);
		handleOpenViewModal();
	};

	const handleApplyRecommendationViewChanges = () => {
		setRecommendationNameVariants(draftRecommendationNameVariants);
		handleApplyViewChanges();
	};

	const handleResetRecommendationViewSelection = () => {
		handleDraftSelectAllColumns();
		setDraftRecommendationNameVariants(DEFAULT_RECOMMENDATION_NAME_VARIANTS);
	};

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		const raw = window.localStorage.getItem(nameVariantsStorageKey);
		if (!raw) {
			setAreNameVariantsHydrated(true);
			return;
		}

		try {
			const parsed = JSON.parse(raw) as Partial<Record<RecommendationColumnKey, unknown>>;
			const next: RecommendationNameVariantByColumn = {
				...DEFAULT_RECOMMENDATION_NAME_VARIANTS,
			};

			for (const columnKey of RECOMMENDATION_NAME_VARIANT_COLUMN_KEYS) {
				const value = parsed[columnKey];
				if (value === "full" || value === "short") {
					next[columnKey] = value;
				}
			}

			setRecommendationNameVariants(next);
		} catch {
			// ignore invalid persisted data
		}

		setAreNameVariantsHydrated(true);
	}, [nameVariantsStorageKey]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		if (!areNameVariantsHydrated) {
			return;
		}

		window.localStorage.setItem(
			nameVariantsStorageKey,
			JSON.stringify(recommendationNameVariants),
		);
	}, [
		areNameVariantsHydrated,
		nameVariantsStorageKey,
		recommendationNameVariants,
	]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		const raw = window.localStorage.getItem(columnWidthsStorageKey);
		if (!raw) {
			setColumnWidths(DEFAULT_RECOMMENDATION_COLUMN_WIDTHS);
			setAreColumnWidthsHydrated(true);
			return;
		}

		try {
			const parsed = JSON.parse(raw) as Record<string, unknown>;
			const next: Partial<Record<RecommendationColumnKey, number>> = {};
			for (const [key, value] of Object.entries(parsed)) {
				const width = Number(value);
				if (!Number.isFinite(width)) {
					continue;
				}

				const columnKey = key as RecommendationColumnKey;
				next[columnKey] = Math.max(
					RECOMMENDATIONS_MIN_COLUMN_WIDTH,
					Math.min(1200, Math.round(width)),
				);
			}

			setColumnWidths({
				...DEFAULT_RECOMMENDATION_COLUMN_WIDTHS,
				...next,
			});
		} catch {
			setColumnWidths(DEFAULT_RECOMMENDATION_COLUMN_WIDTHS);
		}

		setAreColumnWidthsHydrated(true);
	}, [columnWidthsStorageKey]);

	const hasCustomColumnWidths = useMemo(() => {
		const keys = new Set<string>([
			...Object.keys(DEFAULT_RECOMMENDATION_COLUMN_WIDTHS),
			...Object.keys(columnWidths),
		]);

		for (const key of keys) {
			const columnKey = key as RecommendationColumnKey;
			const currentWidth = columnWidths[columnKey];
			const defaultWidth = DEFAULT_RECOMMENDATION_COLUMN_WIDTHS[columnKey];

			if (typeof currentWidth === "number") {
				if (typeof defaultWidth !== "number" || currentWidth !== defaultWidth) {
					return true;
				}
				continue;
			}

			if (typeof defaultWidth === "number") {
				return true;
			}
		}

		return false;
	}, [columnWidths]);

	useEffect(() => {
		if (typeof window === "undefined" || !areColumnWidthsHydrated) {
			return;
		}

		if (!hasCustomColumnWidths) {
			window.localStorage.removeItem(columnWidthsStorageKey);
			return;
		}

		window.localStorage.setItem(
			columnWidthsStorageKey,
			JSON.stringify(columnWidths),
		);
	}, [
		areColumnWidthsHydrated,
		columnWidths,
		columnWidthsStorageKey,
		hasCustomColumnWidths,
	]);

	const handleResizeColumn = (columnKey: RecommendationColumnKey, width: number) => {
		setColumnWidths((prev) => ({
			...prev,
			[columnKey]: Math.max(
				RECOMMENDATIONS_MIN_COLUMN_WIDTH,
				Math.min(1200, Math.round(width)),
			),
		}));
	};

	const handleResetColumnWidths = () => {
		setColumnWidths(DEFAULT_RECOMMENDATION_COLUMN_WIDTHS);
		if (typeof window !== "undefined") {
			window.localStorage.removeItem(columnWidthsStorageKey);
		}
	};

	const handlePageSizeChange = (nextPageSize: number) => {
		if (
			!TABLE_PAGE_SIZE_OPTIONS.includes(
				nextPageSize as (typeof TABLE_PAGE_SIZE_OPTIONS)[number],
			)
		) {
			return;
		}

		setTablePageSize(nextPageSize);
		handlePageChange(1);
	};

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		const fromSession = window.sessionStorage.getItem(
			DASHBOARD_OPEN_RECOMMENDATION_CODE_KEY,
		);
		if (fromSession?.trim()) {
			setPendingDashboardRecommendationCode(fromSession.trim());
		}

		const handleOpenRecommendationFromDashboard = (event: Event) => {
			const customEvent = event as CustomEvent<{ recommendationCode?: unknown }>;
			const recommendationCode =
				typeof customEvent.detail?.recommendationCode === "string"
					? customEvent.detail.recommendationCode.trim()
					: "";
			if (!recommendationCode) {
				return;
			}

			window.sessionStorage.setItem(
				DASHBOARD_OPEN_RECOMMENDATION_CODE_KEY,
				recommendationCode,
			);
			setPendingDashboardRecommendationCode(recommendationCode);
		};

		window.addEventListener(
			DASHBOARD_OPEN_RECOMMENDATION_EVENT,
			handleOpenRecommendationFromDashboard,
		);

		return () => {
			window.removeEventListener(
				DASHBOARD_OPEN_RECOMMENDATION_EVENT,
				handleOpenRecommendationFromDashboard,
			);
		};
	}, []);

	useEffect(() => {
		if (!pendingDashboardRecommendationCode || isLoading) {
			return;
		}

		const normalizedToken = pendingDashboardRecommendationCode.trim().toLowerCase();
		if (!normalizedToken) {
			setPendingDashboardRecommendationCode(null);
			return;
		}

		const targetItem = filteredAndSortedItems.find(
			(item) => {
				const codeToken = String(item.kodZalecenia ?? "").trim().toLowerCase();
				const idToken = String(item.id ?? "").trim().toLowerCase();
				const lpToken = String(item.lp ?? "").trim().toLowerCase();
				return (
					codeToken === normalizedToken ||
					idToken === normalizedToken ||
					lpToken === normalizedToken
				);
			},
		);

		if (!targetItem) {
			const targetExistsOutsideFilters = recommendationRowsForDisplay.some((item) => {
				const codeToken = String(item.kodZalecenia ?? "").trim().toLowerCase();
				const idToken = String(item.id ?? "").trim().toLowerCase();
				const lpToken = String(item.lp ?? "").trim().toLowerCase();
				return (
					codeToken === normalizedToken ||
					idToken === normalizedToken ||
					lpToken === normalizedToken
				);
			});

			if (targetExistsOutsideFilters && canClearFilters) {
				clearFilters();
			}
			return;
		}

		const rowIndex = filteredAndSortedItems.findIndex((item) => item.id === targetItem.id);
		if (rowIndex < 0) {
			return;
		}

		const targetPage = resolvePageForRowIndex(rowIndex);
		handlePageChange(targetPage);
		setSelectedId(targetItem.id);
		setCenterRecommendationId(targetItem.id);
		setPendingDashboardRecommendationCode(null);

		if (typeof window !== "undefined") {
			window.sessionStorage.removeItem(DASHBOARD_OPEN_RECOMMENDATION_CODE_KEY);
		}
	}, [
		canClearFilters,
		clearFilters,
		filteredAndSortedItems,
		handlePageChange,
		isLoading,
		pendingDashboardRecommendationCode,
		recommendationRowsForDisplay,
		resolvePageForRowIndex,
	]);

	useEffect(() => {
		if (centerRecommendationId === null) {
			return;
		}

		const rows =
			recommendationTableBodyRef.current?.querySelectorAll<HTMLTableRowElement>(
				"tr[data-recommendation-id]",
			);
		if (!rows || rows.length === 0) {
			return;
		}

		const targetRow = Array.from(rows).find(
			(row) => row.dataset.recommendationId === String(centerRecommendationId),
		);
		if (!targetRow) {
			return;
		}

		targetRow.scrollIntoView({ block: "center", inline: "nearest" });
		setCenterRecommendationId(null);
	}, [centerRecommendationId, paginatedRecommendationItems]);

	const visibleRecommendationColumnDefinitions = useMemo(
		() =>
			RECOMMENDATION_COLUMNS.filter((column) =>
				visibleRecommendationColumns.includes(column.key),
			),
		[visibleRecommendationColumns],
	);

	const draftSelectableColumnDefinitions = RECOMMENDATION_COLUMNS;

	const loadItems = async () => {
		setError(null);
		setIsLoading(true);

		const result = await fetchRecommendations(operatorLogin, {
			sortBy: "dataZalecen",
			sortOrder: "desc",
		});

		if (!result.ok) {
			setItems([]);
			setTotal(0);
			setError(result.error);
			setIsLoading(false);
			return;
		}

		setItems(result.data.items);
		setTotal(result.data.total);
		setSelectedId((prev) =>
			prev && result.data.items.some((item) => item.id === prev) ? prev : null,
		);
		setIsLoading(false);
	};

	const loadInspectionOptions = async () => {
		setIsInspectionOptionsLoading(true);

		try {
			const structureResponsePromise = fetch(INSPECTIONS_API_URL, {
				method: "GET",
				headers: {
					"Content-Type": "application/json",
					"X-Operator-Login": operatorLogin,
				},
				cache: "no-store",
			}).catch(() => null);
			const inspectionTeamsResponsePromise = fetch(INSPECTION_TEAMS_API_URL, {
				method: "GET",
				headers: {
					"Content-Type": "application/json",
					"X-Operator-Login": operatorLogin,
				},
				cache: "no-store",
			}).catch(() => null);

			const response = await fetch(AVAILABLE_INSPECTIONS_API_URL, {
				method: "GET",
				headers: {
					"Content-Type": "application/json",
					"X-Operator-Login": operatorLogin,
				},
				cache: "no-store",
			});

			if (!response.ok) {
				setInspectionOptions([]);
				if (response.status === 401) {
					setFormError(
						"Brak autoryzacji operatora. Odśwież sesję i zaloguj się ponownie.",
					);
				} else if (response.status === 403) {
					setFormError("Brak uprawnień do listy dostępnych inspekcji.");
				}
				return;
			}

			const payload = (await response.json()) as
				| Array<{
						id?: unknown;
						lp?: unknown;
						inspectionKod?: unknown;
						kodInspekcji?: unknown;
						inspectionStatusCode?: unknown;
						statusCode?: unknown;
						status?: unknown;
						statusInspekcji?: unknown;
						inspectionStatus?: unknown;
						nazwaPodmiotu?: unknown;
						nazwaPodmiotuSkrocona?: unknown;
						nazwaPodmiotuSkrot?: unknown;
				  }>
				| {
						items?: Array<{
							id?: unknown;
							lp?: unknown;
							inspectionKod?: unknown;
							kodInspekcji?: unknown;
							inspectionStatusCode?: unknown;
							statusCode?: unknown;
							status?: unknown;
							statusInspekcji?: unknown;
							inspectionStatus?: unknown;
							nazwaPodmiotu?: unknown;
							nazwaPodmiotuSkrocona?: unknown;
							nazwaPodmiotuSkrot?: unknown;
						}>;
				  };
			const rawItems = Array.isArray(payload) ? payload : (payload.items ?? []);

			const mapped = rawItems
				.map((item) => {
					const id = Number(item.id);
					const lp = Number(item.lp);
					const inspectionCode = String(
						(item as { inspectionKod?: unknown }).inspectionKod ??
							(item as { kodInspekcji?: unknown }).kodInspekcji ??
							(item as { inspectionCode?: unknown }).inspectionCode ??
							item.lp ??
							"",
					).trim();
					const inspectionStatus = String(
						(item as { status?: unknown }).status ??
							(item as { statusInspekcji?: unknown }).statusInspekcji ??
							(item as { inspectionStatus?: unknown }).inspectionStatus ??
							"",
					).trim();
					const inspectionStatusCode = String(
						(item as { inspectionStatusCode?: unknown }).inspectionStatusCode ??
							(item as { statusCode?: unknown }).statusCode ??
							"",
					).trim();
					const nazwaPodmiotu = String(item.nazwaPodmiotu ?? "").trim();
					const nazwaPodmiotuSkrocona = String(
						(item as { nazwaPodmiotuSkrocona?: unknown }).nazwaPodmiotuSkrocona ??
							(item as { nazwaPodmiotuSkrot?: unknown }).nazwaPodmiotuSkrot ??
							"",
					).trim();

					const normalizedInspectionStatusCode = inspectionStatusCode
						.toUpperCase()
						.trim();
					const normalizedInspectionStatus = normalizeInspectionStatusLabel(
						inspectionStatus,
					);
					if (
						(normalizedInspectionStatusCode &&
							BLOCKING_INSPECTION_STATUS_CODES.has(normalizedInspectionStatusCode)) ||
						(normalizedInspectionStatus &&
							BLOCKING_INSPECTION_STATUS_FALLBACK_LABELS.has(
								normalizedInspectionStatus,
							))
					) {
						return null;
					}

					if (!Number.isFinite(id) || id <= 0 || !inspectionCode) {
						return null;
					}

					return {
						id,
						lp: Number.isFinite(lp) && lp > 0 ? lp : id,
						inspectionCode,
						nazwaPodmiotu,
						nazwaPodmiotuSkrocona,
					};
				})
				.filter((item): item is InspectionOption => Boolean(item))
				.sort((left, right) =>
					left.inspectionCode.localeCompare(right.inspectionCode, "pl", {
						numeric: true,
						sensitivity: "base",
					}),
				);

			const blockedInspectionIds = new Set<number>();
			const inspectionTeamIdsByInspectionId = new Map<number, number[]>();
			const structureResponse = await structureResponsePromise;

			if (structureResponse?.ok) {
				const structurePayload = (await structureResponse.json()) as
					| Array<{
							id?: unknown;
							inspectionStatusCode?: unknown;
							statusCode?: unknown;
							status?: unknown;
							statusInspekcji?: unknown;
							inspectionStatus?: unknown;
					  }>
					| {
							items?: Array<{
								id?: unknown;
								inspectionStatusCode?: unknown;
								statusCode?: unknown;
								status?: unknown;
								statusInspekcji?: unknown;
								inspectionStatus?: unknown;
							}>;
					  };

				const structureItems = Array.isArray(structurePayload)
					? structurePayload
					: (structurePayload.items ?? []);

				for (const item of structureItems) {
					const id = Number(item.id);
					if (!Number.isFinite(id) || id <= 0) {
						continue;
					}

					inspectionTeamIdsByInspectionId.set(
						id,
						parseNumericIdList(
							(item as { inspectionTeamIds?: unknown }).inspectionTeamIds ??
								(item as { inspection_team_ids?: unknown }).inspection_team_ids ??
								(item as { zespolyInspekcjiIds?: unknown }).zespolyInspekcjiIds ??
								(item as { zespoly_inspekcji_ids?: unknown }).zespoly_inspekcji_ids,
						),
					);

					const inspectionStatus = String(
						(item as { status?: unknown }).status ??
							(item as { statusInspekcji?: unknown }).statusInspekcji ??
							(item as { inspectionStatus?: unknown }).inspectionStatus ??
							"",
					).trim();
					const inspectionStatusCode = String(
						(item as { inspectionStatusCode?: unknown }).inspectionStatusCode ??
							(item as { statusCode?: unknown }).statusCode ??
							"",
					).trim();

					const normalizedInspectionStatusCode = inspectionStatusCode
						.toUpperCase()
						.trim();
					const normalizedInspectionStatus = normalizeInspectionStatusLabel(
						inspectionStatus,
					);

					if (
						(normalizedInspectionStatusCode &&
							BLOCKING_INSPECTION_STATUS_CODES.has(normalizedInspectionStatusCode)) ||
						(normalizedInspectionStatus &&
							BLOCKING_INSPECTION_STATUS_FALLBACK_LABELS.has(
								normalizedInspectionStatus,
							))
					) {
						blockedInspectionIds.add(id);
					}
				}
			}

			const inspectionTeamsResponse = await inspectionTeamsResponsePromise;
			if (inspectionTeamsResponse?.ok) {
				const payload = (await inspectionTeamsResponse.json()) as
					| Array<{
						id?: unknown;
						code?: unknown;
						kod?: unknown;
						name?: unknown;
						nazwa?: unknown;
						isActive?: unknown;
						aktywny?: unknown;
					}>
					| { items?: Array<{ id?: unknown; code?: unknown; kod?: unknown; name?: unknown; nazwa?: unknown; isActive?: unknown; aktywny?: unknown }> };
				const rawItems = Array.isArray(payload) ? payload : (payload.items ?? []);
				const mappedTeamOptions = rawItems
					.map((item) => {
						const id = Number(item.id);
						const fullLabel = String(item.name ?? item.nazwa ?? "").trim();
						const shortLabel = String(item.code ?? item.kod ?? "").trim();
						const isActive =
							typeof item.isActive === "boolean"
								? item.isActive
								: typeof item.aktywny === "boolean"
									? item.aktywny
									: true;

						if (!Number.isFinite(id) || id <= 0 || !fullLabel || !isActive) {
							return null;
						}

						return {
							id,
							label: fullLabel,
							shortLabel,
						} satisfies InspectionTeamOption;
					})
					.filter((item): item is InspectionTeamOption => item !== null)
					.sort((left, right) =>
						(left.shortLabel || left.label).localeCompare(
							right.shortLabel || right.label,
							"pl",
							{ sensitivity: "base" },
						),
					);
				setInspectionTeamOptions(mappedTeamOptions);
			} else {
				setInspectionTeamOptions([]);
			}

			setInspectionOptions(
				mapped
					.filter((option) => !blockedInspectionIds.has(option.id))
					.map((option) => ({
						...option,
						inspectionTeamIds:
							inspectionTeamIdsByInspectionId.get(option.id) ?? [],
					})),
			);
		} catch {
			setInspectionOptions([]);
			setInspectionTeamOptions([]);
			setFormError("Nie udało się pobrać dostępnych inspekcji.");
		} finally {
			setIsInspectionOptionsLoading(false);
		}
	};

	const loadRecommendationStatusOptions = async () => {
		try {
			const result = await fetchDictionaryEntries("statusy_zalecen");
			if (!result.ok) {
				setRecommendationStatusOptions([]);
				setRecommendationStatusIdByValue({});
				setRecommendationStatusCodeByValue({});
				setRecommendationStatusStyleByCode({});
				return;
			}

			const nextStatusStyleByCode: Record<string, RecommendationStatusStyle> = {};
			const nextStatusIdByValue: Record<string, number> = {};
			const nextStatusCodeByValue: Record<string, string> = {};
			const addStatusStyleMapping = (
				rawKey: string | null | undefined,
				style: RecommendationStatusStyle,
			) => {
				const key = String(rawKey ?? "").trim().toUpperCase();
				if (!key) {
					return;
				}

				nextStatusStyleByCode[key] = style;
			};

			for (const entry of result.data) {
				const value = entry.nazwaPozycji.trim();
				if (
					value &&
					typeof entry.id === "number" &&
					Number.isFinite(entry.id) &&
					!nextStatusIdByValue[value]
				) {
					nextStatusIdByValue[value] = entry.id;
				}

				const entryCode = String(entry.kodPozycji ?? entry.skrotPozycji ?? "")
					.trim()
					.toUpperCase();
				if (value && entryCode && !nextStatusCodeByValue[value]) {
					nextStatusCodeByValue[value] = entryCode;
				}

				const style = {
					kolor: entry.kolor ?? null,
					odcien: entry.odcien ?? null,
					intensywnosc: entry.intensywnosc ?? null,
				};

				addStatusStyleMapping(entry.kodPozycji, style);
				addStatusStyleMapping(entry.skrotPozycji, style);
				addStatusStyleMapping(entry.nazwaPozycji, style);
			}

			setRecommendationStatusOptions(
				mapDictionaryEntriesToOptions(result.data),
			);
			setRecommendationStatusIdByValue(nextStatusIdByValue);
			setRecommendationStatusCodeByValue(nextStatusCodeByValue);
			setRecommendationStatusStyleByCode(nextStatusStyleByCode);
		} catch {
			setRecommendationStatusOptions([]);
			setRecommendationStatusIdByValue({});
			setRecommendationStatusCodeByValue({});
			setRecommendationStatusStyleByCode({});
		}
	};

	const loadEntityNameOptions = async () => {
		try {
			const result = await fetchDictionaryEntries("nazwy_podmiotow");
			if (!result.ok) {
				setEntityNameOptions([]);
				setEntityNameIdByValue({});
				return;
			}

			const nextEntityNameIdByValue: Record<string, number> = {};
			for (const entry of result.data) {
				const value = entry.nazwaPozycji.trim();
				if (
					value &&
					typeof entry.id === "number" &&
					Number.isFinite(entry.id) &&
					!nextEntityNameIdByValue[value]
				) {
					nextEntityNameIdByValue[value] = entry.id;
				}
			}

			setEntityNameOptions(mapDictionaryEntriesToOptions(result.data));
			setEntityNameIdByValue(nextEntityNameIdByValue);
		} catch {
			setEntityNameOptions([]);
			setEntityNameIdByValue({});
		}
	};

	useEffect(() => {
		void loadItems();
		void loadRecommendationStatusOptions();
		void loadEntityNameOptions();
	}, []);

	useEffect(() => {
		void loadInspectionOptions();
	}, [operatorLogin]);

	useEffect(() => {
		const handleInspectionsChanged = () => {
			void loadInspectionOptions();
		};

		window.addEventListener(INSPECTIONS_CHANGED_EVENT, handleInspectionsChanged);
		return () => {
			window.removeEventListener(INSPECTIONS_CHANGED_EVENT, handleInspectionsChanged);
		};
	}, [operatorLogin]);

	useEffect(() => {
		const handleDictionariesChanged = (event: Event) => {
			const customEvent = event as CustomEvent<{ kodTypu?: unknown }>;
			const changedKodTypu =
				typeof customEvent.detail?.kodTypu === "string"
					? customEvent.detail.kodTypu.trim().toLowerCase()
					: "";

			if (!changedKodTypu || changedKodTypu === "statusy_zalecen") {
				void loadRecommendationStatusOptions();
			}

			if (!changedKodTypu || changedKodTypu === "nazwy_podmiotow") {
				void loadEntityNameOptions();
			}
		};

		window.addEventListener(
			DICTIONARIES_CHANGED_EVENT,
			handleDictionariesChanged as EventListener,
		);

		return () => {
			window.removeEventListener(
				DICTIONARIES_CHANGED_EVENT,
				handleDictionariesChanged as EventListener,
			);
		};
	}, []);

	useEffect(() => {
		if (form.isInspectionMissing) {
			return;
		}

		if (!selectedInspectionOption) {
			setForm((prev) => ({
				...prev,
				nazwaPodmiotu: "",
			}));
			return;
		}

		setForm((prev) => ({
			...prev,
			nazwaPodmiotu: selectedInspectionOption.nazwaPodmiotu,
		}));
	}, [form.isInspectionMissing, selectedInspectionOption]);

	useEffect(() => {
		if (isInspectionTeamSelectionManual) {
			return;
		}

		if (form.isInspectionMissing) {
			setForm((prev) => ({
				...prev,
				inspectionTeamIds: [],
			}));
			return;
		}

		const inspectionTeamIds =
			selectedInspectionOption?.inspectionTeamIds.filter((teamId) =>
				validInspectionTeamIdSet.has(teamId),
			) ?? [];
		setForm((prev) => ({
			...prev,
			inspectionTeamIds,
		}));
	}, [
		form.isInspectionMissing,
		isInspectionTeamSelectionManual,
		selectedInspectionOption,
		validInspectionTeamIdSet,
	]);

	const openAdvancedFilterForColumn = (
		columnKey: RecommendationColumnKey,
		triggerElement: HTMLElement,
	) => {
		setAdvancedFilterAnchor(getFloatingPanelAnchor(triggerElement));
		setAdvancedFilterColumnKey(columnKey);
		setAdvancedFilterSearch("");
		setIsAdvancedFilterModalOpen(true);
	};

	const handleExportCurrentView = async (
		inspectionColumnKeys: InspectionExportColumnKey[],
		sanctionColumnKeys: SanctionExportColumnKey[],
		decisionColumnKeys: DecisionExportColumnKey[],
		includeInspections: boolean,
		includeSanctions: boolean,
		includeDecisions: boolean,
	) => {
		if (
			isExporting ||
			filteredAndSortedItems.length === 0 ||
			visibleRecommendationColumnDefinitions.length === 0
		) {
			return;
		}

		setIsExporting(true);
		setError(null);

		try {
			const workbook = await createStyledExportWorkbook("Ewidencja zaleceń");

			const linkedInspectionIds = new Set(
				filteredAndSortedItems
					.map((item) => item.inspectionId)
					.filter(
						(value): value is number =>
							typeof value === "number" && Number.isFinite(value) && value > 0,
					),
			);

			const loadInspectionLpMap = async (url: string) => {
				try {
					const response = await fetch(url, {
						method: "GET",
						headers: {
							"Content-Type": "application/json",
							"X-Operator-Login": operatorLogin,
						},
						cache: "no-store",
					});

					if (!response.ok) {
						return new Map<number, number>();
					}

					const payload = (await response.json()) as
						| Array<{ id?: unknown; lp?: unknown }>
						| { items?: Array<{ id?: unknown; lp?: unknown }> };
					const rawItems = Array.isArray(payload)
						? payload
						: (payload.items ?? []);

					return new Map(
						rawItems
							.map((item) => {
								const id = Number(item.id);
								const lp = Number(item.lp);
								if (
									!Number.isFinite(id) ||
									id <= 0 ||
									!Number.isFinite(lp) ||
									lp <= 0
								) {
									return null;
								}

								return [id, lp] as const;
							})
							.filter((entry): entry is readonly [number, number] => entry !== null),
					);
				} catch {
					return new Map<number, number>();
				}
			};

			const [inspectionsResponse, sanctionsResult, decisionsResult, sanctionsLpById] =
				await Promise.all([
					fetch(INSPECTIONS_API_URL, {
						method: "GET",
						headers: {
							"Content-Type": "application/json",
							"X-Operator-Login": operatorLogin,
						},
						cache: "no-store",
					}),
					fetchSanctionRequests(operatorLogin, {
						sortBy: "id",
						sortOrder: "asc",
					}),
					fetchObligatingDecisions(operatorLogin),
					loadInspectionLpMap(INSPECTIONS_API_URL),
				]);

			const rawInspectionRows: unknown[] = [];

			if (inspectionsResponse.ok) {
				const payload = (await inspectionsResponse.json()) as
					| unknown[]
					| { items?: unknown[] };
				const items = Array.isArray(payload) ? payload : (payload.items ?? []);
				rawInspectionRows.push(...items);
			}

			const mappedInspections = rawInspectionRows.map((rawRow, index) =>
				normalizeInspectionRow((rawRow ?? {}) as RawInspectionRow, index),
			);

			const relatedInspections = mappedInspections.filter((row) =>
				linkedInspectionIds.has(Number(row.id)),
			);

			const relatedSanctionsSource = sanctionsResult.ok
				? sanctionsResult.data.items
				: [];
			const relatedDecisionsSource = decisionsResult.ok
				? decisionsResult.data.items
				: [];
			const relatedSanctions = relatedSanctionsSource.filter(
				(item) =>
					typeof item.inspectionId === "number" &&
					linkedInspectionIds.has(item.inspectionId),
			);

			const inspectionCodeByIdForExport = new Map(
				relatedInspections.map((row) => [Number(row.id), row.kodInspekcji]),
			);
			const inspectionTeamsByIdForExport = new Map(
				relatedInspections.map((row) => [
					Number(row.id),
					String(row.zespoly ?? "").trim() || String(row.skladZespolu ?? "").trim(),
				]),
			);

			const inspectionCodeByRecommendationCode = new Map<string, string>();
			const inspectionIdByRecommendationCode = new Map<string, number>();
			for (const recommendation of filteredAndSortedItems) {
				const recommendationCode = String(recommendation.kodZalecenia ?? "")
					.trim()
					.toUpperCase();
				if (!recommendationCode) {
					continue;
				}

				const inspectionId = recommendation.inspectionId ?? null;
				if (
					typeof inspectionId === "number" &&
					Number.isFinite(inspectionId) &&
					inspectionId > 0
				) {
					inspectionIdByRecommendationCode.set(recommendationCode, inspectionId);
				}
				const inspectionCode =
					resolveInspectionCode({
						inspectionKod: recommendation.inspectionKod,
						kodInspekcji: recommendation.kodInspekcji,
						inspectionLp: recommendation.inspectionLp,
						inspectionId,
					}) ||
					(typeof inspectionId === "number"
						? String(
								inspectionCodeByIdForExport.get(inspectionId) ??
								sanctionsLpById.get(inspectionId) ??
								"",
							)
						: "");

				inspectionCodeByRecommendationCode.set(recommendationCode, inspectionCode);
			}

			const relatedDecisions = relatedDecisionsSource.filter((item) => {
				const recommendationCode = String(item.recommendationKodZalecenia ?? "")
					.trim()
					.toUpperCase();
				return recommendationCode.length > 0 &&
					inspectionCodeByRecommendationCode.has(recommendationCode);
			});

			const recommendationHeaders = visibleRecommendationColumnDefinitions.map(
				(column) => column.label,
			);
			const recommendationRows = filteredAndSortedItems.map((item) =>
				visibleRecommendationColumnDefinitions.map((column) =>
					getCellValue(item, column.key),
				),
			);

			addWorksheetWithStyles(
				workbook,
				"Zalecenia",
				recommendationHeaders,
				recommendationRows,
			);

			if (includeInspections && inspectionColumnKeys.length > 0) {
				const inspectionHeaders = inspectionColumnKeys.map(
					(key) =>
						INSPECTION_EXPORT_COLUMNS.find((column) => column.key === key)?.label ??
						key,
				);
				const inspectionRowsForExport = relatedInspections.map((row) =>
					inspectionColumnKeys.map((key) => String(row[key] ?? "")),
				);
				addWorksheetWithStyles(
					workbook,
					"Inspekcje",
					inspectionHeaders,
					inspectionRowsForExport,
				);
			}

			if (includeSanctions && sanctionColumnKeys.length > 0) {
				const sanctionHeaders = sanctionColumnKeys.map(
					(key) =>
						SANCTION_EXPORT_COLUMNS.find((column) => column.key === key)?.label ??
						key,
				);
				const sanctionRowsForExport = relatedSanctions.map((item) => {
					const inspectionId = item.inspectionId ?? null;
					const inspectionCode =
						resolveInspectionCode({
							inspectionKod: item.inspectionKod,
							kodInspekcji: item.kodInspekcji,
							inspectionLp: item.inspectionLp,
							inspectionId,
						}) ||
						(typeof inspectionId === "number"
							? String(
									inspectionCodeByIdForExport.get(inspectionId) ??
										sanctionsLpById.get(inspectionId) ??
										"",
								)
							: "");

					return sanctionColumnKeys.map((key) => {
						switch (key) {
							case "lp":
								return String(item.lp);
							case "requestId":
								return String(item.kodSankcji ?? item.lp ?? "").trim();
							case "inspectionLp":
								return inspectionCode;
							case "zespoly":
								return (
									typeof inspectionId === "number"
										? String(inspectionTeamsByIdForExport.get(inspectionId) ?? "")
										: ""
								);
							case "nazwaPodmiotuObjetegoInspekcja":
								return item.nazwaPodmiotuObjetegoInspekcja ?? "";
							case "nazwaPodmiotuObjetegoSankcjaList":
								return item.nazwaPodmiotuObjetegoSankcjaList.join(", ");
							case "dataWniosku":
								return item.dataWniosku ?? "";
							case "wniosekDo":
								return item.wniosekDo ?? "";
							case "sankcjaList":
								return item.sankcjaList.join(", ");
							case "podstawaPrawnaSankcjiList":
								return item.podstawaPrawnaSankcjiList.join(", ");
							case "naruszeniaSkutkujaceSankcjaList":
								return item.naruszeniaSkutkujaceSankcjaList.join(", ");
							case "czyMamyInformacjeOWszczeciuPostepowania":
								return item.czyMamyInformacjeOWszczeciuPostepowania ?? "";
							case "rozstrzygniecie":
								return item.rozstrzygniecie ?? "";
							case "komentarz":
								return item.komentarz ?? "";
						}

						return "";
					});
				});
				addWorksheetWithStyles(
					workbook,
					"Wnioski sankcyjne",
					sanctionHeaders,
					sanctionRowsForExport,
				);
			}

			if (includeDecisions && decisionColumnKeys.length > 0) {
				const decisionHeaders = decisionColumnKeys.map(
					(key) =>
						DECISION_EXPORT_COLUMNS.find((column) => column.key === key)?.label ??
						key,
				);
				const decisionRowsForExport = relatedDecisions.map((item, index) =>
					decisionColumnKeys.map((key) => {
						const recommendationCode = String(
							item.recommendationKodZalecenia ?? "",
						)
							.trim()
							.toUpperCase();
						const linkedInspectionId =
							inspectionIdByRecommendationCode.get(recommendationCode) ?? null;
						switch (key) {
							case "lp":
								return String(index + 1);
							case "kodDecyzji":
								return item.kodDecyzji ?? "";
							case "kodZalecenia":
								return recommendationCode;
							case "inspectionLp":
								return (
									inspectionCodeByRecommendationCode.get(recommendationCode) ?? ""
								);
							case "zespoly":
								return (
									typeof linkedInspectionId === "number"
										? String(inspectionTeamsByIdForExport.get(linkedInspectionId) ?? "")
										: ""
								);
							case "nazwaPodmiotu":
								return item.nazwaPodmiotu ?? "";
							case "liczbaZalecen":
								return item.liczbaZalecen === null ? "" : String(item.liczbaZalecen);
							case "dataWszczeciaPostepowaniaIInstancji":
								return item.dataWszczeciaPostepowaniaIInstancji ?? "";
							case "osobyProwadzaceIInstancjeList":
								return (item.osobyProwadzaceIInstancjeList ?? []).join(", ");
							case "dataDecyzjiIInstancji":
								return item.dataDecyzjiIInstancji ?? "";
							case "dataDoreczeniaDecyzjiIInstancji":
								return item.dataDoreczeniaDecyzjiIInstancji ?? "";
							case "rozstrzygniecieI":
								return item.rozstrzygniecieI ?? "";
							case "dataWnioskuPonowneRozpatrzenie":
								return item.dataWnioskuPonowneRozpatrzenie ?? "";
							case "dataWplywuWnioskuPonowneRozpatrzenie":
								return item.dataWplywuWnioskuPonowneRozpatrzenie ?? "";
							case "osobyProwadzaceIIInstancjeList":
								return (item.osobyProwadzaceIIInstancjeList ?? []).join(", ");
							case "dataDecyzjiIIInstancji":
								return item.dataDecyzjiIIInstancji ?? "";
							case "dataDoreczeniaDecyzjiIIInstancji":
								return item.dataDoreczeniaDecyzjiIIInstancji ?? "";
							case "rozstrzygniecieII":
								return item.rozstrzygniecieII ?? "";
							case "komentarz":
								return item.komentarz ?? "";
						}

						return "";
					}),
				);
				addWorksheetWithStyles(
					workbook,
					"Decyzje zobowiązujące",
					decisionHeaders,
					decisionRowsForExport,
				);
			}

			const fileName = "zalecenia-inspekcje-sankcje-decyzje.xlsx";
			await saveWorkbookAsXlsx(workbook, fileName);
		} catch (caughtError) {
			if (
				caughtError instanceof DOMException &&
				caughtError.name === "AbortError"
			) {
				return;
			}

			setError("Nie udało się wyeksportować danych do Excela.");
		} finally {
			setIsExporting(false);
		}
	};

	const handleOpenExportConfigModal = () => {
		if (isExporting || filteredAndSortedItems.length === 0) {
			return;
		}

		setIncludeInspectionsInExport(false);
		setIncludeSanctionsInExport(false);
		setIncludeDecisionsInExport(false);
		setActiveExportColumnsTab("inspections");
		setIsExportConfigModalOpen(true);
	};

	const toggleInspectionExportColumn = (
		columnKey: InspectionExportColumnKey,
		isSelected: boolean,
	) => {
		setSelectedInspectionExportColumns((prev) => {
			const nextSet = new Set(prev);
			if (isSelected) {
				nextSet.add(columnKey);
			} else {
				if (prev.length <= 1) {
					return prev;
				}
				nextSet.delete(columnKey);
			}

			return INSPECTION_EXPORT_COLUMNS.map((column) => column.key).filter((key) =>
				nextSet.has(key),
			);
		});
	};

	const toggleSanctionExportColumn = (
		columnKey: SanctionExportColumnKey,
		isSelected: boolean,
	) => {
		setSelectedSanctionExportColumns((prev) => {
			const nextSet = new Set(prev);
			if (isSelected) {
				nextSet.add(columnKey);
			} else {
				if (prev.length <= 1) {
					return prev;
				}
				nextSet.delete(columnKey);
			}

			return SANCTION_EXPORT_COLUMNS.map((column) => column.key).filter((key) =>
				nextSet.has(key),
			);
		});
	};

	const toggleDecisionExportColumn = (
		columnKey: DecisionExportColumnKey,
		isSelected: boolean,
	) => {
		setSelectedDecisionExportColumns((prev) => {
			const nextSet = new Set(prev);
			if (isSelected) {
				nextSet.add(columnKey);
			} else {
				if (prev.length <= 1) {
					return prev;
				}
				nextSet.delete(columnKey);
			}

			return DECISION_EXPORT_COLUMNS.map((column) => column.key).filter((key) =>
				nextSet.has(key),
			);
		});
	};

	const handleConfirmExportFromModal = () => {
		if (
			(includeInspectionsInExport && selectedInspectionExportColumns.length === 0) ||
			(includeSanctionsInExport && selectedSanctionExportColumns.length === 0) ||
			(includeDecisionsInExport && selectedDecisionExportColumns.length === 0)
		) {
			return;
		}

		const orderedInspectionColumns = INSPECTION_EXPORT_COLUMNS.map(
			(column) => column.key,
		).filter((key) => selectedInspectionExportColumns.includes(key));

		const orderedSanctionColumns = SANCTION_EXPORT_COLUMNS.map(
			(column) => column.key,
		).filter((key) => selectedSanctionExportColumns.includes(key));

		const orderedDecisionColumns = DECISION_EXPORT_COLUMNS.map(
			(column) => column.key,
		).filter((key) => selectedDecisionExportColumns.includes(key));

		setIsExportConfigModalOpen(false);
		void handleExportCurrentView(
			orderedInspectionColumns,
			orderedSanctionColumns,
			orderedDecisionColumns,
			includeInspectionsInExport,
			includeSanctionsInExport,
			includeDecisionsInExport,
		);
	};

	const openCreateModal = async () => {
		if (!canManageRecommendations) {
			setError("Konto zewnętrzne ma dostęp tylko do odczytu.");
			return;
		}

		setEditingItem(null);
		setForm(EMPTY_FORM);
		setFormError(null);
		setRecommendationValidationModalData(null);
		setShowRequiredFieldErrors(false);
		setVersionConflictUpdatedAt(null);
		setSaveLockConflict(null);
		setIsInspectionTeamSelectionManual(false);
		setIsFormOpen(true);
		await loadInspectionOptions();
	};

	const openEditModal = async () => {
		if (!canManageRecommendations) {
			setError("Konto zewnętrzne ma dostęp tylko do odczytu.");
			return;
		}

		if (!selectedItem || !selectedItem.canEdit) {
			return;
		}

		setEditingItem(selectedItem);
		setForm(recommendationToForm(selectedItem));
		setFormError(null);
		setRecommendationValidationModalData(null);
		setShowRequiredFieldErrors(false);
		setVersionConflictUpdatedAt(null);
		setSaveLockConflict(null);
		setIsInspectionTeamSelectionManual(
			parseNumericIdList(selectedItem.inspectionTeamIds).length > 0,
		);
		await loadInspectionOptions();
		setIsFormOpen(true);
	};

	const closeModal = () => {
		if (editRecordLock.lockToken) {
			void editRecordLock.release();
		}

		setIsFormOpen(false);
		setEditingItem(null);
		setFormError(null);
		setRecommendationValidationModalData(null);
		setShowRequiredFieldErrors(false);
		setVersionConflictUpdatedAt(null);
		setSaveLockConflict(null);
		setIsInspectionTeamSelectionManual(false);
		setIsSubmitting(false);
	};
	closeModalRef.current = closeModal;

	const handleRefreshAfterConflict = async () => {
		if (!editingItem) {
			return;
		}

		const result = await fetchRecommendations(operatorLogin, {
			sortBy: "dataZalecen",
			sortOrder: "desc",
		});

		if (!result.ok) {
			setFormError(result.error);
			return;
		}

		setItems(result.data.items);
		setTotal(result.data.total);
		const refreshed = result.data.items.find((item) => item.id === editingItem.id);
		if (!refreshed) {
			closeModal();
			return;
		}

		setEditingItem(refreshed);
		setForm(recommendationToForm(refreshed));
		setFormError(null);
		setVersionConflictUpdatedAt(null);
		setSaveLockConflict(null);
	};

	const openDeleteModal = () => {
		if (!isDirector || !selectedItem) {
			return;
		}

		setError(null);
		setIsDeleteConfirmModalOpen(true);
	};

	const handleDeleteItem = async () => {
		if (!isDirector || !selectedItem || isDeletingItem) {
			return;
		}

		const deletedEntityName = selectedItem.nazwaPodmiotu?.trim() ?? "";

		setIsDeletingItem(true);
		setError(null);

		const result = await deleteRecommendation(operatorLogin, selectedItem.id);
		if (!result.ok) {
			setError(result.error);
			setIsDeletingItem(false);
			return;
		}

		setIsDeleteConfirmModalOpen(false);
		setSelectedId(null);
		await loadItems();
		window.dispatchEvent(new CustomEvent(RECOMMENDATIONS_CHANGED_EVENT));
		setDeleteSuccessEntityName(deletedEntityName);
		setIsDeleteSuccessModalOpen(true);
		setIsDeletingItem(false);
	};

	const handleSubmit = async (
		event?: React.FormEvent<HTMLFormElement>,
		options?: { skipAcceptanceNoteDateValidation?: boolean },
	) => {
		event?.preventDefault();
		if (!canManageRecommendations) {
			setFormError("Konto zewnętrzne ma dostęp tylko do odczytu.");
			return;
		}

		if (shouldShowLockedByOtherUser) {
			setFormError(
				"Nie możesz teraz edytować tego wpisu, ponieważ jest edytowany przez innego użytkownika.",
			);
			return;
		}

		const wasEditing = Boolean(editingItem);
		const payloadMode: "create" | "update" = wasEditing ? "update" : "create";
		const isRequiredInspectionMissing =
			!form.isInspectionMissing && !form.inspectionId.trim();
		const isRequiredEntityNameMissing =
			form.isInspectionMissing && !form.nazwaPodmiotu.trim();
		const isRequiredPositionMissing = !form.pozycja.trim();
		const isRequiredRecommendationDateMissing =
			!form.terminWykonaniaZalecen.trim();
		const isRequiredStatusMissing = !wasEditing && !form.status.trim();
		const hasMissingRequiredFields =
			isRequiredInspectionMissing ||
			isRequiredEntityNameMissing ||
			isRequiredPositionMissing ||
			isRequiredRecommendationDateMissing ||
			isRequiredStatusMissing;

		setShowRequiredFieldErrors(true);

		if (hasMissingRequiredFields) {
			setFormError(null);
			return;
		}

		const selectedStatusCode = normalizeRecommendationStatusCode(
			recommendationStatusCodeByValue[form.status.trim()] ?? form.status,
		);
		const selectedStatusLabel = form.status.trim();
		const requiresAcceptanceNoteDate =
			selectedStatusCode &&
			RECOMMENDATION_STATUS_CODES_REQUIRING_ACCEPTANCE_NOTE_DATE_SET.has(
				selectedStatusCode,
			);
		const hasAcceptanceNoteDate =
			form.isDataAkceptacjiBrak ||
			toDateList(form.dataAkceptacjiList).length > 0;
		const shouldSkipAcceptanceNoteDateValidation =
			options?.skipAcceptanceNoteDateValidation === true;
		if (
			requiresAcceptanceNoteDate &&
			!hasAcceptanceNoteDate &&
			!shouldSkipAcceptanceNoteDateValidation
		) {
			setRecommendationValidationModalData({
				statusLabel: selectedStatusLabel || selectedStatusCode,
				statusCode: selectedStatusCode,
				requiredFieldLabel:
					"Data akceptacji noty z weryfikacji wykonania zaleceń",
			});
			setFormError(null);
			return;
		}
		setRecommendationValidationModalData(null);

		const payload = formToPayload(
			form,
			entityNameIdByValue,
			recommendationStatusIdByValue,
			validInspectionTeamIdSet,
			payloadMode,
			editingItem,
		);
		if (!payload) {
			setFormError(
				"Wprowadź poprawne wartości: id inspekcji, liczba zaleceń oraz mapowanie nazwy podmiotu i statusu do ID słownika.",
			);
			return;
		}

		setShowRequiredFieldErrors(false);

		if (editingItem) {
			const basePayload = formToPayload(
				recommendationToForm(editingItem),
				entityNameIdByValue,
				recommendationStatusIdByValue,
				validInspectionTeamIdSet,
				"update",
				editingItem,
			);
			if (basePayload && JSON.stringify(payload) === JSON.stringify(basePayload)) {
				setFormError("Brak zmian do zapisania.");
				return;
			}
		}

		setIsSubmitting(true);
		setFormError(null);
		setVersionConflictUpdatedAt(null);
		setSaveLockConflict(null);

		try {
			const result = editingItem
				? await updateRecommendation(operatorLogin, editingItem.id, payload, {
						expectedUpdatedAt: editingItem.zaktualizowanoO,
						lockToken: editRecordLock.lockToken,
				  })
				: await createRecommendation(operatorLogin, payload);

			if (!result.ok) {
				if (
					result.status === 409 &&
					result.errorCode === "INSPECTION_STATUS_BLOCKS_OPERATION"
				) {
					setVersionConflictUpdatedAt(null);
					setSaveLockConflict(null);
					setFormError(result.error);
					await loadInspectionOptions();
					return;
				}

				if (result.status === 423) {
					if (result.lockErrorCode === "RECORD_LOCKED") {
						setSaveLockConflict(result.lockConflict ?? null);
						setFormError(
							"Nie możesz teraz edytować tego wpisu, ponieważ jest edytowany przez innego użytkownika.",
						);
						return;
					}

					setSaveLockConflict(null);
					setFormError(result.error);
					return;
				}

				if (result.status === 409) {
					if (wasEditing) {
						setVersionConflictUpdatedAt(result.currentUpdatedAt ?? null);
						setFormError(
							"Dane zostały zmienione przez innego użytkownika. Odśwież widok i spróbuj ponownie.",
						);
					} else {
						setFormError(result.error);
					}
					return;
				}

				setFormError(result.error);
				return;
			}

			closeModal();
			setSelectedId(result.data.id);
			setSuccessEntityName(form.nazwaPodmiotu.trim());
			setSuccessInspectionCode(
				resolveInspectionCode({
					inspectionKod: result.data.inspectionKod,
					kodInspekcji: result.data.kodInspekcji,
					inspectionLp: result.data.inspectionLp,
					inspectionId: result.data.inspectionId,
				}) ||
				(selectedInspectionOption?.inspectionCode ?? ""),
			);
			setSuccessMode(wasEditing ? "edit" : "create");
			setIsSuccessModalOpen(true);
			void loadItems();
			window.dispatchEvent(new CustomEvent(RECOMMENDATIONS_CHANGED_EVENT));
		} catch {
			setFormError("Nie udało się zapisać zalecenia.");
		} finally {
			setIsSubmitting(false);
		}
	};

	const isRequiredInspectionMissing =
		showRequiredFieldErrors && !form.isInspectionMissing && !form.inspectionId.trim();
	const isRequiredEntityNameMissing =
		showRequiredFieldErrors && form.isInspectionMissing && !form.nazwaPodmiotu.trim();
	const isRequiredPositionMissing =
		showRequiredFieldErrors && !form.pozycja.trim();
	const isRequiredRecommendationDateMissing =
		showRequiredFieldErrors && !form.terminWykonaniaZalecen.trim();
	const isRequiredStatusMissing =
		showRequiredFieldErrors && !isEditMode && !form.status.trim();

	return (
		<>
			<TableFullscreenContainer
				isFullscreen={isFullscreen}
				onClose={() => setIsFullscreen(false)}
				className="relative flex h-full min-h-0 w-full flex-col rounded-2xl border border-slate-700/70 bg-[#101f39] px-2 pt-4 pb-2 sm:px-2 sm:pt-5 sm:pb-2"
			>
				{!isFullscreen ? (
			<TablePanelToolbar
				title="Zalecenia"
				canClearFilters={canClearFilters}
				canResetColumnWidths={hasCustomColumnWidths}
				isExporting={isExporting}
				hasRowsToExport={
					filteredAndSortedItems.length > 0 &&
					visibleRecommendationColumnDefinitions.length > 0
				}
				onOpenViewModal={handleOpenRecommendationViewModal}
				isFullscreen={isFullscreen}
				onToggleFullscreen={() => setIsFullscreen((prev) => !prev)}
				onClearFilters={clearFilters}
				onResetColumnWidths={handleResetColumnWidths}
				onExport={handleOpenExportConfigModal}
				leftControls={isFullscreen ? null : (
					<div className="flex max-w-[560px] min-w-0 flex-nowrap items-center gap-2 rounded-xl border border-[#3a588b]/90 bg-[#172c4a]/95 px-2.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
						<span className="shrink-0 rounded-md border border-slate-500/60 bg-slate-900/35 px-2 py-1 font-semibold text-[10px] text-slate-300 uppercase tracking-wide">
							Zespoły
						</span>
						<div className="h-5 w-px shrink-0 bg-slate-500/50" />
						<div className="flex min-w-0 flex-nowrap items-center gap-2">
							<div className="flex max-w-[300px] flex-nowrap items-center gap-1 overflow-x-auto rounded-lg border border-slate-600/70 bg-slate-900/35 px-1.5 py-1">
								{quickRecommendationTeamLabels.length > 0 ? (
									quickRecommendationTeamLabels.map((label) => (
										<button
											key={label}
											type="button"
											onClick={() => handleQuickRecommendationTeamToggle(label)}
											className={`inline-flex h-6 shrink-0 items-center rounded-full border px-2.5 font-semibold text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition-colors ${
												selectedQuickRecommendationTeams.has(label)
													? "border-emerald-300/80 bg-emerald-300/25 text-emerald-100 hover:bg-emerald-300/35"
													: "border-slate-500/80 bg-[#1f3658] text-slate-100 hover:bg-[#294673]"
											}`}
											aria-pressed={selectedQuickRecommendationTeams.has(label)}
										>
											{label}
										</button>
									))
								) : (
									<span className="px-1 text-slate-400 text-xs">
										{isLoading ? "Ładowanie..." : "Brak zespołów"}
									</span>
								)}
							</div>
							<span className="shrink-0 rounded-md border border-slate-500/60 bg-slate-900/35 px-2 py-1 font-semibold text-[10px] text-slate-300 uppercase tracking-wide">
								Statusy
							</span>
							<button
								type="button"
								onClick={handleQuickExcludeClosedRecommendationsToggle}
								className={`inline-flex h-6 shrink-0 items-center rounded-full border px-2.5 font-semibold text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition-colors ${
									isQuickExcludeClosedActive
										? "border-emerald-300/80 bg-emerald-300/25 text-emerald-100 hover:bg-emerald-300/35"
										: "border-slate-500/80 bg-[#1f3658] text-slate-100 hover:bg-[#294673]"
								}`}
								aria-pressed={isQuickExcludeClosedActive}
							>
								Bez zamkniętych
							</button>
						</div>
					</div>
				)}
				actions={
					<>
						{canManageRecommendations ? (
							<>
								<button
									type="button"
									onClick={() => void openCreateModal()}
									className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#8ec5a1] bg-[#b9e8c9] px-3.5 font-semibold text-[#1f5130] text-sm transition-colors hover:bg-[#a5debb]"
								>
									<Plus size={15} />
									Dodaj zalecenie
								</button>

								<button
									type="button"
									onClick={() => void openEditModal()}
									disabled={!selectedItem || !selectedItem.canEdit}
									className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 font-semibold text-sm transition-colors enabled:border-[#7ea8e7] enabled:bg-[#c7dcff] enabled:text-[#1d4882] enabled:hover:bg-[#b7d3ff] disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-[#1a2946] disabled:text-slate-500"
								>
									<Pencil size={15} />
									Edytuj
								</button>
							</>
						) : null}

						{isDirector ? (
							<button
								type="button"
								onClick={openDeleteModal}
								disabled={!selectedItem || isDeletingItem}
								className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#f2a3a3] bg-[#6f2a36] px-3.5 font-semibold text-[#ffe5e8] text-sm transition-colors hover:bg-[#833242] disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-[#1a2946] disabled:text-slate-500"
							>
								<Trash2 size={15} />
								Usuń
							</button>
						) : null}
					</>
				}
			/>
				) : null}

			{error ? (
				<p className="mb-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 font-medium text-rose-700 text-sm">
					{error}
				</p>
			) : null}

			<RegistryDataTable
				isLoading={isLoading}
				errorMessage={null}
				containerClassName="-mt-1 flex h-full min-h-0 flex-1 flex-col"
				scrollAreaClassName="min-h-0 flex-1"
				tableClassName="min-w-350 table-fixed border-collapse text-slate-900 text-sm"
				visibleColumns={visibleRecommendationColumnDefinitions.map((column) => ({
					...column,
					tooltip: RECOMMENDATION_COLUMN_TOOLTIPS[column.key],
				}))}
				sortColumnKey={sortColumnKey}
				sortDirection={sortDirection}
				advancedFilters={advancedFilters}
				columnFilters={columnFilters}
				onSortByColumn={handleSortByColumn}
				onOpenAdvancedFilter={openAdvancedFilterForColumn}
				onFilterChange={handleFilterChange}
				columnWidths={columnWidths}
				minColumnWidth={RECOMMENDATIONS_MIN_COLUMN_WIDTH}
				onResizeColumn={handleResizeColumn}
				wrapHeaderLabels
				controlsInFilterRow
				showInfoIcon
				infoIconSize={11}
				footer={
					<TablePagination
						currentPage={currentPage}
						totalPages={totalPages}
						paginationItems={paginationItems}
						totalItems={filteredAndSortedItems.length}
						showTotalRowsLabel
						pageSize={pageSize}
						onPageChange={handlePageChange}
						pageSizeOptions={[...TABLE_PAGE_SIZE_OPTIONS]}
						onPageSizeChange={handlePageSizeChange}
						showWhenSinglePage
					/>
				}
			>
					<tbody ref={recommendationTableBodyRef}>
						{paginatedRecommendationItems.map((item) => {
							const isSelected = selectedId === item.id;
							const statusRowStyle = isStatusHighlightingEnabled && !isSelected
								? resolveRecommendationStatusRowStyle(
										item.status,
										recommendationStatusStyleByCode,
								  )
								: undefined;
							return (
								<tr
									key={item.id}
									data-recommendation-id={item.id}
									onClick={() => setSelectedId(item.id)}
									style={statusRowStyle}
									className={`cursor-pointer border-slate-200 border-b transition-[filter,background-color] hover:drop-shadow-[0_2px_6px_rgba(15,23,42,0.14)] last:border-b-0 ${
										isSelected
											? "bg-blue-100 text-slate-900 ring-1 ring-blue-300 ring-inset"
											: "bg-white text-slate-900 hover:bg-slate-50"
									}`}
								>
									{visibleRecommendationColumnDefinitions.map((column) => {
										const rawValue = getCellValue(item, column.key);
										const normalizedRawValue = rawValue.trim();
										const inspectionCode =
											column.key === "inspectionId"
												? resolveInspectionCode({
													inspectionKod: item.inspectionKod,
													kodInspekcji: item.kodInspekcji,
													inspectionLp: item.inspectionLp,
													inspectionId: item.inspectionId,
												}).trim()
												: "";
										const hasInspectionLink =
											column.key === "inspectionId" && inspectionCode.length > 0;
										const value =
											column.key === "inspectionId"
												? normalizedRawValue || "Brak powiązania"
												: column.key === "status"
													? normalizedRawValue.toLowerCase() === "brak"
														? "-"
														: normalizedRawValue || "-"
													: normalizedRawValue || "-";
										const formattedValue = formatDatesInDisplayText(value);
										const shouldWrapValue =
											column.key === "komentarz" || column.key === "status";
										const isTeamsColumn = column.key === "zespoly";
										const isScrollableValue =
											column.key === "dataZalecenList" ||
											column.key === "dataAkceptacjiNotyWeryfikacjiList";
										const teamValueLines = isTeamsColumn
											? formattedValue
													.split(",")
													.map((line) => line.trim())
													.filter(Boolean)
											: [];
										const scrollableValueLines =
											column.key === "dataZalecenList"
												? formatDateListDisplayLines(
													item.terminyWykonaniaZalecenList.length > 0
														? item.terminyWykonaniaZalecenList
														: item.dataZalecenList,
													item.brakTerminowWykonaniaZalecen === true,
												)
												: column.key === "dataAkceptacjiNotyWeryfikacjiList"
													? formatDateListDisplayLines(
														item.dataAkceptacjiNotyWeryfikacjiList,
														item.brakDatAkceptacjiNotyWeryfikacji === true,
													)
													: [];

										return (
											<td
												key={column.key}
												className="px-3 py-2.5 font-normal whitespace-normal break-words align-top"
											>
												<div
													className="subtle-vertical-scroll w-full overflow-y-auto pr-1 whitespace-normal break-words leading-5"
													style={{ maxHeight: `${RECOMMENDATIONS_MAX_ROW_HEIGHT_PX}px` }}
													title={formattedValue !== "-" ? formattedValue : undefined}
												>
												{isScrollableValue ? (
													<div className="space-y-1 whitespace-normal break-words">
														{scrollableValueLines.map((line, index) => (
															<div key={`${column.key}-${item.id}-${index}`}>{line}</div>
														))}
													</div>
												) : isTeamsColumn && formattedValue !== "-" ? (
													<div className="space-y-1 whitespace-normal break-words">
														{teamValueLines.length > 1 ? (
															<ol className="list-inside list-decimal space-y-1 pl-1">
																{teamValueLines.map((line, index) => (
																	<li key={`${column.key}-${item.id}-${index}`}>{line}</li>
																))}
															</ol>
														) : (
															teamValueLines.map((line, index) => (
																<div key={`${column.key}-${item.id}-${index}`}>{line}</div>
															))
														)}
													</div>
												) : shouldWrapValue ? (
													<div className="whitespace-normal break-words">{formattedValue}</div>
												) : hasInspectionLink ? (
													<button
														type="button"
														onClick={(event) => {
															event.stopPropagation();
															openInspectionFromDashboard(inspectionCode);
														}}
														className="cursor-pointer rounded px-1 text-left text-[#1f4f8f] underline decoration-[#9bb8de] underline-offset-2 transition-colors hover:text-[#163a68]"
														title="Przejdź do rejestru Inspekcje i zaznacz ten rekord"
													>
														{formattedValue}
													</button>
												) : (
													formattedValue
												)}
												</div>
											</td>
										);
									})}
								</tr>
							);
						})}
						{!isLoading && filteredAndSortedItems.length === 0 ? (
							<tr>
								<td
									colSpan={visibleRecommendationColumnDefinitions.length}
									className="px-3 py-6 text-center text-slate-500 text-sm"
								>
									Brak rekordów. Łącznie: {total}.
								</td>
							</tr>
						) : null}
					</tbody>
			</RegistryDataTable>

			<ExportConfigModal
				isOpen={isExportConfigModalOpen}
				description="Zalecenia eksportują aktualny widok tabeli. Wybierz dane powiązane."
				relationsLabel="Powiąż wybrane zalecenia z:"
				relations={[
					{
						id: "inspections",
						label: "Inspekcje",
						enabled: includeInspectionsInExport,
						selectedCount: selectedInspectionExportColumns.length,
						onToggle: () => {
							setIncludeInspectionsInExport((prev) => {
								const next = !prev;
								if (next) {
									setActiveExportColumnsTab("inspections");
								}
								return next;
							});
						},
					},
					{
						id: "sanctions",
						label: "Wnioski sankcyjne",
						enabled: includeSanctionsInExport,
						selectedCount: selectedSanctionExportColumns.length,
						onToggle: () => {
							setIncludeSanctionsInExport((prev) => {
								const next = !prev;
								if (next) {
									setActiveExportColumnsTab("sanctions");
								}
								return next;
							});
						},
					},
					{
						id: "decisions",
						label: "Decyzje zobowiązujące",
						enabled: includeDecisionsInExport,
						selectedCount: selectedDecisionExportColumns.length,
						onToggle: () => {
							setIncludeDecisionsInExport((prev) => {
								const next = !prev;
								if (next) {
									setActiveExportColumnsTab("decisions");
								}
								return next;
							});
						},
					},
				]}
				tabs={[
					{
						id: "inspections",
						label: "Inspekcje",
						columns: INSPECTION_EXPORT_COLUMNS.map((column) => ({
							key: column.key,
							label: column.label,
						})),
						selectedKeys: selectedInspectionExportColumns,
						onToggleKey: (key, isSelected) =>
							toggleInspectionExportColumn(
								key as InspectionExportColumnKey,
								isSelected,
							),
						onSelectAll: () =>
							setSelectedInspectionExportColumns(
								INSPECTION_EXPORT_COLUMNS.map((column) => column.key),
							),
					},
					{
						id: "sanctions",
						label: "Wnioski sankcyjne",
						columns: SANCTION_EXPORT_COLUMNS.map((column) => ({
							key: column.key,
							label: column.label,
						})),
						selectedKeys: selectedSanctionExportColumns,
						onToggleKey: (key, isSelected) =>
							toggleSanctionExportColumn(key as SanctionExportColumnKey, isSelected),
						onSelectAll: () =>
							setSelectedSanctionExportColumns(
								SANCTION_EXPORT_COLUMNS.map((column) => column.key),
							),
					},
					{
						id: "decisions",
						label: "Decyzje zobowiązujące",
						columns: DECISION_EXPORT_COLUMNS.map((column) => ({
							key: column.key,
							label: column.label,
						})),
						selectedKeys: selectedDecisionExportColumns,
						onToggleKey: (key, isSelected) =>
							toggleDecisionExportColumn(key as DecisionExportColumnKey, isSelected),
						onSelectAll: () =>
							setSelectedDecisionExportColumns(
								DECISION_EXPORT_COLUMNS.map((column) => column.key),
							),
					},
				]}
				activeTabId={activeExportColumnsTab}
				onActiveTabChange={(tabId) =>
					setActiveExportColumnsTab(tabId as "inspections" | "sanctions" | "decisions")
				}
				onClose={() => setIsExportConfigModalOpen(false)}
				onConfirm={handleConfirmExportFromModal}
				isConfirmDisabled={
					isExporting ||
					(includeInspectionsInExport && selectedInspectionExportColumns.length === 0) ||
					(includeSanctionsInExport && selectedSanctionExportColumns.length === 0) ||
					(includeDecisionsInExport && selectedDecisionExportColumns.length === 0)
				}
				isExporting={isExporting}
			/>

			<TableAdvancedFilterModal
				isOpen={isAdvancedFilterModalOpen}
				anchor={advancedFilterAnchor}
				columnLabel={
					RECOMMENDATION_COLUMNS.find(
						(column) => column.key === advancedFilterColumnKey,
					)?.label ?? "Kolumna"
				}
				searchValue={advancedFilterSearch}
				visibleValues={visibleAdvancedFilterValues}
				selectedValues={selectedAdvancedFilterValues}
				selectedDateRange={selectedAdvancedFilterDateRange}
				onDateRangeChange={setAdvancedFilterDateRange}
				onClose={() => setIsAdvancedFilterModalOpen(false)}
				onSearchChange={setAdvancedFilterSearch}
				onSelectAllVisible={selectAllVisibleAdvancedFilterValues}
				onClearSelectedColumn={clearAdvancedFilterForSelectedColumn}
				onToggleValue={toggleAdvancedFilterValue}
				onClearAllFilters={clearFilters}
			/>

			<TableColumnPickerModal<RecommendationColumnKey, never>
				isOpen={isColumnPickerOpen}
				columns={draftSelectableColumnDefinitions}
				hiddenColumns={draftHiddenColumns}
				visibleColumnsCount={draftVisibleRecommendationColumns.length}
				onClose={() => setIsColumnPickerOpen(false)}
				onChangeColumnVisibility={handleDraftColumnVisibilityChange}
				onChangeColumnDisplayMode={(columnKey, value) => {
					if (!isRecommendationNameVariantColumnKey(columnKey)) {
						return;
					}

					if (value !== "full" && value !== "short") {
						return;
					}

					setDraftRecommendationNameVariants((prev) => ({
						...prev,
						[columnKey]: value,
					}));
				}}
				columnDisplayModeOptions={columnDisplayModeOptionsByKey}
				columnDisplayModeValues={draftColumnDisplayModeValuesByKey}
				headerControls={
					<label className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-2.5 text-slate-700 text-sm">
						<input
							type="checkbox"
							checked={isStatusHighlightingEnabled}
							onChange={(event) =>
								setIsStatusHighlightingEnabled(event.target.checked)
							}
							className="h-4 w-4 rounded border-slate-300"
						/>
						Wyróżnianie statusów
					</label>
				}
				onResetSelection={handleResetRecommendationViewSelection}
				onShowAllColumns={handleDraftSelectAllColumns}
				onHideAllColumns={handleDraftDeselectAllColumns}
				onApply={handleApplyRecommendationViewChanges}
			/>

			<RegistryFormScaffold
				isOpen={isFormOpen}
				title={editingItem ? "Edytuj zalecenie" : "Dodaj zalecenie"}
				subtitle={
					editingItem
						? `Id zalecenia: ${editingItem.kodZalecenia} | Utworzone przez: ${
							(editingItem.createdByDisplayName ?? editingItem.createdByLogin ?? "").trim() ||
							"-"
						}`
						: undefined
				}
				onClose={closeModal}
				onSubmit={(event) => void handleSubmit(event)}
				isContentReadOnly={isReadOnlyDueToLock}
				closeOnBackdropClick={false}
				headerNotices={
					<>
						{inactivityTimeout.isWarning ? (
							<div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 text-sm">
								<p className="font-semibold">
									Nie wykryto aktywności. Formularz zostanie zamknięty za{" "}
									<span className="tabular-nums">{inactivityTimeout.secondsRemaining}</span> s.
								</p>
								<button
									type="button"
									onClick={inactivityTimeout.resetTimer}
									className="mt-2 inline-flex h-7 items-center rounded border border-amber-400 bg-amber-100 px-2 font-semibold text-amber-900 text-xs transition-colors hover:bg-amber-200"
								>
									Kontynuuj edycję
								</button>
							</div>
						) : null}

						{isEditMode && shouldShowLockedByOtherUser ? (
							<div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800 text-sm">
								<p className="font-semibold">
									Nie możesz teraz edytować tego wpisu, ponieważ jest edytowany przez innego użytkownika.
								</p>
								<p className="mt-1">
									Rekord edytuje teraz: {lockOwnerLabel}, od {formatLockStartHourMinute(lockAcquiredAt)}.
								</p>
							</div>
						) : null}

						{isEditMode && editRecordLock.isConnectionLost ? (
							<p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 font-medium text-amber-800 text-sm">
								{editRecordLock.error ?? "Utracono połączenie z serwerem — trwa próba odnowienia blokady..."}
							</p>
						) : null}

						{isEditMode && editRecordLock.isExpired ? (
							<p className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 font-medium text-rose-800 text-sm">
								{editRecordLock.error ?? "Czas edycji wygasł — połączenie zostało przerwane zbyt długo. Zamknij formularz i otwórz ponownie."}
							</p>
						) : null}

						{isEditMode && editRecordLock.isAcquireFailed ? (
							<div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800 text-sm">
								<p className="font-medium">
									{editRecordLock.error ?? "Nie udało się założyć blokady rekordu."}
								</p>
								<button
									type="button"
									onClick={() => editRecordLock.retryAcquire()}
									className="mt-2 inline-flex h-7 items-center rounded border border-rose-300 bg-rose-100 px-2 font-semibold text-rose-800 text-xs transition-colors hover:bg-rose-200"
								>
									Spróbuj ponownie
								</button>
							</div>
						) : null}
					</>
				}
				footerContent={
					<>
						{formError ? (
							<div className="mb-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700 text-sm">
								<p className="font-medium">{formError}</p>
								{versionConflictUpdatedAt ? (
									<p className="mt-1 text-rose-700/90">
										Aktualna wersja rekordu: {versionConflictUpdatedAt}
									</p>
								) : null}
							</div>
						) : null}

						{versionConflictUpdatedAt ? (
							<div className="mb-2">
								<button
									type="button"
									onClick={() => void handleRefreshAfterConflict()}
									className="inline-flex h-8 items-center rounded-md border border-amber-300 bg-amber-50 px-3 font-semibold text-amber-800 text-xs transition-colors hover:bg-amber-100"
								>
									Odśwież dane
								</button>
							</div>
						) : null}
					</>
				}
				isSubmitDisabled={isSubmitting || isReadOnlyDueToLock || isSaveDisabledDueToLock}
				cancelLabel={"Anuluj"}
				submitLabel={
					isSubmitting
						? "Zapisywanie..."
						: isReadOnlyDueToLock
							? "Tylko podgląd"
							: isSaveDisabledDueToLock
								? "Brak blokady"
								: editingItem
									? "Zapisz"
									: "Dodaj"
				}
			>
				<div className="grid gap-3 sm:grid-cols-2">
								<div className="text-slate-700 text-sm">
									<SingleSelectPortalField
										label="Powiązanie z inspekcją *"
										value={form.inspectionId}
										options={inspectionSelectOptions}
										placeholder={
											isInspectionOptionsLoading
												? "Ładowanie listy inspekcji..."
												: "Wybierz id inspekcji"
										}
										enableSearch
										searchPlaceholder="Wyszukaj id inspekcji..."
										invalid={isRequiredInspectionMissing}
										errorMessage={
											isRequiredInspectionMissing ? "Pole wymagane." : null
										}
										onChange={(next) => {
											const selectedOption = inspectionOptions.find(
												(option) => String(option.id) === next,
											);
											setForm((prev) => ({
												...prev,
												inspectionId: next,
												nazwaPodmiotu: selectedOption?.nazwaPodmiotu ?? prev.nazwaPodmiotu,
												inspectionTeamIds:
													!isInspectionTeamSelectionManual && selectedOption
														? selectedOption.inspectionTeamIds.filter((teamId) =>
																validInspectionTeamIdSet.has(teamId),
														  )
														: prev.inspectionTeamIds,
											}));
										}}
										disabled={form.isInspectionMissing || isInspectionOptionsLoading}
									/>
									<label className="mt-2 inline-flex items-center gap-2 font-medium text-slate-700 text-xs">
										<input
											type="checkbox"
											checked={form.isInspectionMissing}
											onChange={(event) => {
												const checked = event.target.checked;
												setForm((prev) => ({
													...prev,
													isInspectionMissing: checked,
													inspectionId: checked ? "" : prev.inspectionId,
													nazwaPodmiotu: checked
														? prev.nazwaPodmiotu
														: prev.nazwaPodmiotu,
													inspectionTeamIds: checked ? [] : prev.inspectionTeamIds,
												}));
												if (checked) {
													setIsInspectionTeamSelectionManual(false);
												}
											}}
										/>
										Brak powiązania z kodem inspekcji
									</label>
									<input
										readOnly
										tabIndex={-1}
										aria-hidden="true"
										value={form.inspectionId}
										className="sr-only"
									/>
								</div>

								<div className="text-slate-700 text-sm">
									{form.isInspectionMissing ? (
										<SingleSelectPortalField
											label="Nazwa podmiotu *"
											value={form.nazwaPodmiotu}
											options={entityNameOptions}
											placeholder="Wybierz podmiot"
											enableSearch
											searchPlaceholder="Wyszukaj podmiot..."
											invalid={isRequiredEntityNameMissing}
											errorMessage={
												isRequiredEntityNameMissing ? "Pole wymagane." : null
											}
											onChange={(next) =>
												setForm((prev) => ({
													...prev,
													nazwaPodmiotu: next,
												}))
											}
											disabled={isReadOnlyDueToLock}
										/>
									) : (
										<label className="text-slate-700 text-sm">
											<span className="mb-1 block">Nazwa podmiotu *</span>
											<input
												disabled
												value={displayEntityNameInForm}
												className="w-full cursor-not-allowed rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-700 text-sm outline-none"
											/>
										</label>
									)}
								</div>

								<label className="text-slate-700 text-sm">
									<span className="mb-1 block">Liczba zaleceń *</span>
									<input
										value={form.pozycja}
										onChange={(event) =>
											setForm((prev) => ({
												...prev,
												pozycja: event.target.value,
											}))
										}
										className={`w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors ${
											isRequiredPositionMissing ? "border-rose-300 focus:border-rose-400" : "border-slate-300 focus:border-blue-400"
										}`}
									/>
									{isRequiredPositionMissing ? (
										<span className="mt-1 block text-rose-700 text-xs">Pole wymagane.</span>
									) : null}
								</label>

								<div>
									<DateFieldWithClear
										label="Data zaleceń *"
										value={form.terminWykonaniaZalecen}
										onChange={(next) =>
											setForm((prev) => ({
												...prev,
												terminWykonaniaZalecen: next,
											}))
										}
									/>
									{isRequiredRecommendationDateMissing ? (
										<span className="mt-1 block text-rose-700 text-xs">Pole wymagane.</span>
									) : null}
								</div>

								<div className="sm:col-span-2">
									<DateListEditor
										title="Termin wykonania zaleceń"
										addButtonLabel="Dodaj datę"
										noDatesLabel="Brak terminów wykonania zaleceń"
										noDatesMessage="Oznaczono brak terminów wykonania zaleceń."
										values={form.dataZalecenList}
										setValues={setFormDataZalecenList}
										isNoDates={form.isDataZalecenBrak}
										setIsNoDates={setFormIsDataZalecenBrak}
										itemKeyPrefix="zalecenia"
									/>
								</div>

								<div className="sm:col-span-2">
									<DateListEditor
										title="Data akceptacji noty z weryfikacji wykonania zaleceń"
										addButtonLabel="Dodaj datę"
										noDatesLabel="Brak dat akceptacji noty"
										noDatesMessage="Oznaczono brak dat akceptacji noty."
										values={form.dataAkceptacjiList}
										setValues={setFormDataAkceptacjiList}
										isNoDates={form.isDataAkceptacjiBrak}
										setIsNoDates={setFormIsDataAkceptacjiBrak}
										itemKeyPrefix="akceptacja-noty"
									/>
								</div>

								<div className="sm:col-span-2">
									<MultiSelectTeamField
										label="Zespoły"
										options={inspectionTeamOptionsForForm}
										values={form.inspectionTeamIds}
										onChange={(next) => {
											setIsInspectionTeamSelectionManual(true);
											setForm((prev) => ({
												...prev,
												inspectionTeamIds: next.filter((teamId) =>
													validInspectionTeamIdSet.has(teamId),
												),
											}));
										}}
										disabled={isReadOnlyDueToLock}
									/>
								</div>

								<div className="sm:col-span-2">
									<SingleSelectPortalField
										label={isEditMode ? "Status" : "Status *"}
										value={form.status}
										options={statusOptionsForForm}
										placeholder="Wybierz status"
										invalid={isRequiredStatusMissing}
										errorMessage={
											isRequiredStatusMissing ? "Pole wymagane." : null
										}
										onChange={(next) =>
											setForm((prev) => ({
												...prev,
												status: next,
											}))
										}
										disabled={isReadOnlyDueToLock}
									/>
								</div>

								<label className="text-slate-700 text-sm sm:col-span-2">
									<span className="mb-1 block">Komentarz</span>
									<textarea
										rows={2}
										value={form.komentarz}
										onChange={(event) =>
											setForm((prev) => ({
												...prev,
												komentarz: event.target.value,
											}))
										}
										className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400"
									/>
								</label>
				</div>
			</RegistryFormScaffold>

			{recommendationValidationModalData ? (
				<div className="fixed inset-0 z-60 flex items-center justify-center p-4">
					<button
						type="button"
						aria-label="Zamknij okno walidacji statusu zalecenia"
						className="absolute inset-0 bg-slate-950/65"
						onClick={() => setRecommendationValidationModalData(null)}
					/>

					<div
						role="dialog"
						aria-modal="true"
						aria-label="Walidacja pól zaleceń"
						className="relative z-10 w-full max-w-3xl rounded-2xl border border-slate-300 bg-white p-5 text-slate-900 shadow-[0_24px_56px_rgba(2,8,23,0.35)]"
					>
						<h3 className="font-semibold text-base text-slate-900">
							Nie można zapisać zalecenia
						</h3>
						<p className="mt-2 text-slate-800 text-sm">
							Wybrany status wymaga dodatkowych dat, które nie zostały jeszcze uzupełnione.
						</p>

						<div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3">
							<p className="font-semibold text-blue-900 text-sm">
								Aby ustawić status:{" "}
								<span className="font-bold">
									{recommendationValidationModalData.statusLabel ||
										recommendationValidationModalData.statusCode}
								</span>{" "}
								uzupełnij poniższe pole:
							</p>
							<ul className="mt-2 list-disc space-y-1 pl-5 text-blue-900 text-sm">
								<li>{recommendationValidationModalData.requiredFieldLabel}</li>
							</ul>
						</div>

						<div className="mt-5 flex items-center justify-end gap-2">
							<button
								type="button"
								onClick={() => setRecommendationValidationModalData(null)}
								className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 font-semibold text-slate-700 text-sm transition-colors hover:bg-slate-100"
							>
								Anuluj
							</button>
							<button
								type="button"
								onClick={() => {
									void handleSubmit(undefined, {
										skipAcceptanceNoteDateValidation: true,
									});
								}}
								className="inline-flex h-10 items-center rounded-lg border border-[#93b9ee] bg-[#d9e9ff] px-4 font-semibold text-[#21508f] text-sm transition-colors hover:bg-[#c9e0ff]"
							>
								Mimo to zapisz
							</button>
						</div>
					</div>
				</div>
			) : null}

			<RecommendationsSuccessModal
				isOpen={isSuccessModalOpen}
				entityName={successEntityName}
				inspectionCode={successInspectionCode}
				mode={successMode}
				onClose={() => {
					setIsSuccessModalOpen(false);
					setSuccessEntityName("");
					setSuccessInspectionCode("");
					setSuccessMode("create");
				}}
			/>

			<DeleteSuccessModal
				isOpen={isDeleteSuccessModalOpen}
				heading="Zalecenie zostało usunięte"
				detailsMessage={
					deleteSuccessEntityName
						? `Dla podmiotu ${deleteSuccessEntityName}.`
						: "Rekord został usunięty z tabeli."
				}
				onClose={() => {
					setIsDeleteSuccessModalOpen(false);
					setDeleteSuccessEntityName("");
				}}
			/>

			{isDeleteConfirmModalOpen ? (
				<div className="fixed inset-0 z-60 flex items-center justify-center p-4">
					<button
						type="button"
						aria-label="Zamknij potwierdzenie usunięcia zalecenia"
						className="absolute inset-0 bg-slate-950/65"
						onClick={() => {
							if (isDeletingItem) {
								return;
							}

							setIsDeleteConfirmModalOpen(false);
						}}
					/>

					<div
						role="dialog"
						aria-modal="true"
						aria-label="Potwierdzenie usunięcia zalecenia"
						className="relative z-10 w-full max-w-lg rounded-2xl border border-slate-300 bg-white p-5 text-slate-900 shadow-[0_24px_56px_rgba(2,8,23,0.35)]"
					>
						<h3 className="font-semibold text-base text-slate-900">
							Usuń zalecenie
						</h3>
						<p className="mt-2 text-slate-700 text-sm">Czy usunąć zalecenie?</p>

						<div className="mt-5 flex items-center justify-end gap-2">
							<button
								type="button"
								onClick={() => setIsDeleteConfirmModalOpen(false)}
								disabled={isDeletingItem}
								className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 font-semibold text-slate-700 text-sm transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
							>
								Anuluj
							</button>
							<button
								type="button"
								onClick={() => void handleDeleteItem()}
								disabled={isDeletingItem}
								className="inline-flex h-10 items-center rounded-lg border border-[#f2a3a3] bg-[#6f2a36] px-4 font-semibold text-[#ffe5e8] text-sm transition-colors hover:bg-[#833242] disabled:cursor-not-allowed disabled:opacity-60"
							>
								{isDeletingItem ? "Usuwanie..." : "Usuń"}
							</button>
						</div>
					</div>
				</div>
			) : null}
			</TableFullscreenContainer>
		</>
	);
}
