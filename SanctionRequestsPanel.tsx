"use client";

import { ChevronDown, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AuthRole } from "@/app/_components/home-tabs/types";

import {
	createDictionaryEntry,
	fetchDictionaryEntries,
} from "@/features/dictionaries/api";
import type { DictionaryEntry } from "@/features/dictionaries/types";
import {
	type RawInspectionRow,
	normalizeInspectionRow,
} from "@/features/inspections/components/inspections-panel.utils";
import { fetchObligatingDecisions } from "@/features/obligating-decisions/api";
import { fetchRecommendations } from "@/features/recommendations/api";
import {
	createSanctionRequest,
	deleteSanctionRequest,
	fetchSanctionRequests,
	type SanctionRequestLockConflict,
	updateSanctionRequest,
} from "@/features/sanction-requests/api";
import { SanctionRequestsSuccessModal } from "./SanctionRequestsSuccessModal";
import type {
	SanctionRequestRead,
	SanctionRequestWrite,
} from "@/features/sanction-requests/types";
import { DeleteSuccessModal } from "@/shared/components/DeleteSuccessModal";
import { DateInputWithCalendar } from "@/shared/components/forms/DateInputWithCalendar";
import { RegistryFormScaffold } from "@/shared/components/forms/RegistryFormScaffold";
import { SingleSelectPortalField } from "@/shared/components/forms/SingleSelectPortalField";
import { ExportConfigModal } from "@/shared/components/export/ExportConfigModal";
import { TableAdvancedFilterModal } from "@/shared/components/table/TableAdvancedFilterModal";
import { TableColumnPickerModal } from "@/shared/components/table/TableColumnPickerModal";
import { TableFullscreenContainer } from "@/shared/components/table/TableFullscreenContainer";
import { TableHeaderWithFilters } from "@/shared/components/table/TableHeaderWithFilters";
import { TablePanelToolbar } from "@/shared/components/table/TablePanelToolbar";
import { TablePagination } from "@/shared/components/table/TablePagination";
import { TableSurface } from "@/shared/components/table/TableSurface";
import { useRecordLock } from "@/shared/hooks/useRecordLock";
import { useInactivityTimeout } from "@/shared/hooks/useInactivityTimeout";
import { useTableState } from "@/shared/hooks/useTableState";
import {
	addWorksheetWithStyles,
	createStyledExportWorkbook,
	saveWorkbookAsXlsx,
} from "@/shared/utils/excel-export";
import { getFloatingPanelAnchor } from "@/shared/utils/floating-panel";
import { formatDatesInDisplayText } from "@/shared/utils/date";
import {
	getAdvancedDateRangeFromSelectedValues,
	isAdvancedDateRangeFilterToken,
	matchesAdvancedFilterCellValue,
	splitAdvancedFilterCellValue,
} from "@/shared/utils/table-filters";

const INACTIVITY_TIMEOUT_MS = 5 * 60_000; // 5 minut
const INACTIVITY_WARNING_MS = 60_000; // 1 minuta ostrzeżenia
const TABLE_PAGE_SIZE_OPTIONS = [20, 30, 50, 70, 100] as const;
const DEFAULT_TABLE_PAGE_SIZE = 30;
const SANCTION_REQUESTS_COLUMN_WIDTHS_STORAGE_PREFIX =
	"triangle.ui.sanction-requests.column-widths";
const SANCTION_REQUESTS_NAME_VARIANTS_STORAGE_PREFIX =
	"triangle.ui.sanction-requests.name-variants";
const SANCTION_REQUESTS_TABLE_VIEW_STORAGE_PREFIX =
	"triangle.ui.sanction-requests.table-view";
const SANCTION_REQUESTS_MIN_COLUMN_WIDTH = 90;
// Maksymalna wysokosc zawartosci komorki (wiersza) tabeli Wnioskow sankcyjnych.
const SANCTION_REQUESTS_MAX_ROW_HEIGHT_PX = 84;
const DASHBOARD_OPEN_INSPECTION_EVENT = "dashboard:open-inspection";
const DASHBOARD_OPEN_INSPECTION_CODE_KEY = "triangle.dashboard.openInspectionCode";
const DASHBOARD_OPEN_SANCTION_REQUEST_EVENT = "dashboard:open-sanction-request";
const DASHBOARD_OPEN_SANCTION_REQUEST_CODE_KEY =
	"triangle.dashboard.openSanctionRequestCode";

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

type SanctionRequestsPanelProps = {
	operatorLogin: string;
	authRole: AuthRole;
	isObserver?: boolean;
	canEditDictionaries?: boolean;
};

type SanctionRequestColumnKey =
	| "lp"
	| "requestId"
	| "inspectionId"
	| "nazwaPodmiotuObjetegoInspekcja"
	| "nazwaPodmiotuObjetegoSankcjaList"
	| "dataWniosku"
	| "wniosekDo"
	| "sankcjaList"
	| "podstawaPrawnaSankcjiList"
	| "naruszeniaSkutkujaceSankcjaList"
	| "czyMamyInformacjeOWszczeciuPostepowania"
	| "rozstrzygniecie"
	| "zespol"
	| "komentarz";

type SanctionRequestColumn = {
	key: SanctionRequestColumnKey;
	label: string;
};

const SANCTION_SPLITTABLE_ADVANCED_FILTER_COLUMNS = new Set<SanctionRequestColumnKey>([
	"nazwaPodmiotuObjetegoSankcjaList",
	"sankcjaList",
	"podstawaPrawnaSankcjiList",
	"naruszeniaSkutkujaceSankcjaList",
]);

type SanctionSplittableColumnKey =
	| "nazwaPodmiotuObjetegoSankcjaList"
	| "sankcjaList"
	| "podstawaPrawnaSankcjiList"
	| "naruszeniaSkutkujaceSankcjaList";

function isSanctionSplittableColumnKey(
	columnKey: SanctionRequestColumnKey,
): columnKey is SanctionSplittableColumnKey {
	return SANCTION_SPLITTABLE_ADVANCED_FILTER_COLUMNS.has(columnKey);
}

function splitSanctionAdvancedFilterCellValue(
	columnKey: SanctionRequestColumnKey,
	rawValue: string,
	row: SanctionRequestRead,
) {
	if (isSanctionSplittableColumnKey(columnKey)) {
		const listValues = normalizeStringList(row[columnKey]);

		if (listValues.length === 0) {
			return ["(puste)"];
		}

		return listValues;
	}

	const normalizedValue = rawValue.trim();
	if (!normalizedValue) {
		return ["(puste)"];
	}

	return [normalizedValue];
}

function matchesSanctionAdvancedFilterCellValue(
	columnKey: SanctionRequestColumnKey,
	rawValue: string,
	selectedValues: string[],
	row: SanctionRequestRead,
) {
	if (isSanctionSplittableColumnKey(columnKey)) {
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

		const tokens = splitSanctionAdvancedFilterCellValue(columnKey, rawValue, row);
		return tokens.some((token) => selectedDiscreteValues.includes(token));
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

	const tokens = splitSanctionAdvancedFilterCellValue(columnKey, rawValue, row);
	return tokens.some((token) => selectedDiscreteValues.includes(token));
}

type SanctionShortNameVariant = "full" | "short";

type SanctionShortNameColumnKey =
	| "nazwaPodmiotuObjetegoInspekcja"
	| "nazwaPodmiotuObjetegoSankcjaList"
	| "wniosekDo"
	| "sankcjaList"
	| "podstawaPrawnaSankcjiList"
	| "naruszeniaSkutkujaceSankcjaList"
	| "czyMamyInformacjeOWszczeciuPostepowania"
	| "rozstrzygniecie";

type SanctionShortNameVariantByColumn = Record<
	SanctionShortNameColumnKey,
	SanctionShortNameVariant
>;

const SANCTION_SHORT_NAME_COLUMN_KEYS: SanctionShortNameColumnKey[] = [
	"nazwaPodmiotuObjetegoInspekcja",
	"nazwaPodmiotuObjetegoSankcjaList",
	"wniosekDo",
	"sankcjaList",
	"podstawaPrawnaSankcjiList",
	"naruszeniaSkutkujaceSankcjaList",
	"czyMamyInformacjeOWszczeciuPostepowania",
	"rozstrzygniecie",
];

const SANCTION_SHORT_NAME_VARIANT_OPTIONS = [
	{ value: "full", label: "Nazwa pełna" },
	{ value: "short", label: "Nazwa skrócona" },
] as const;

const DEFAULT_SANCTION_SHORT_NAME_VARIANTS: SanctionShortNameVariantByColumn = {
	nazwaPodmiotuObjetegoInspekcja: "short",
	nazwaPodmiotuObjetegoSankcjaList: "short",
	wniosekDo: "short",
	sankcjaList: "full",
	podstawaPrawnaSankcjiList: "short",
	naruszeniaSkutkujaceSankcjaList: "short",
	czyMamyInformacjeOWszczeciuPostepowania: "full",
	rozstrzygniecie: "full",
};

function isSanctionShortNameColumnKey(
	columnKey: SanctionRequestColumnKey,
): columnKey is SanctionShortNameColumnKey {
	return SANCTION_SHORT_NAME_COLUMN_KEYS.includes(
		columnKey as SanctionShortNameColumnKey,
	);
}

const SANCTION_REQUEST_COLUMNS: SanctionRequestColumn[] = [
	{ key: "lp", label: "Lp." },
	{ key: "requestId", label: "Id wniosku" },
	{ key: "inspectionId", label: "Id inspekcji" },
	{
		key: "nazwaPodmiotuObjetegoInspekcja",
		label: "Nazwa podmiotu\nobjętego inspekcją",
	},
	{
		key: "nazwaPodmiotuObjetegoSankcjaList",
		label: "Nazwa podmiotu\nobjętego sankcją",
	},
	{ key: "dataWniosku", label: "Data wniosku" },
	{ key: "wniosekDo", label: "Wniosek do" },
	{ key: "sankcjaList", label: "Sankcja" },
	{
		key: "podstawaPrawnaSankcjiList",
		label: "Podstawa prawna\nsankcji",
	},
	{
		key: "naruszeniaSkutkujaceSankcjaList",
		label: "Naruszenia skutkujące\nsankcją",
	},
	{
		key: "czyMamyInformacjeOWszczeciuPostepowania",
		label: "Informacja o wszczęciu\npostępowania",
	},
	{ key: "rozstrzygniecie", label: "Rozstrzygnięcie" },
	{ key: "zespol", label: "Zespół" },
	{ key: "komentarz", label: "Komentarz" },
];

const SANCTION_REQUEST_COLUMN_TOOLTIPS: Partial<
	Record<SanctionRequestColumnKey, string>
> = {
	requestId: "Unikalne id wniosku sankcyjnego",
	inspectionId: "Unikalne id inspekcji",
};

const ALL_SANCTION_REQUEST_COLUMN_KEYS: SanctionRequestColumnKey[] =
	SANCTION_REQUEST_COLUMNS.map((column) => column.key);

const DEFAULT_SANCTION_REQUEST_COLUMN_WIDTHS: Partial<
	Record<SanctionRequestColumnKey, number>
> = {
	// Manualna konfiguracja szerokosci kolumn tabeli Wnioskow sankcyjnych (wartosci w px).
	lp: 90,
	requestId: 170,
	inspectionId: 170,
	nazwaPodmiotuObjetegoInspekcja: 240,
	nazwaPodmiotuObjetegoSankcjaList: 250,
	dataWniosku: 170,
	wniosekDo: 190,
	sankcjaList: 220,
	podstawaPrawnaSankcjiList: 260,
	naruszeniaSkutkujaceSankcjaList: 280,
	czyMamyInformacjeOWszczeciuPostepowania: 260,
	rozstrzygniecie: 210,
	zespol: 220,
	komentarz: 500,
};

type InspectionOption = {
	id: number;
	lp: number;
	inspectionCode: string;
	nazwaPodmiotu: string;
	inspectionTeamIds: number[];
};

type InspectionTeamOption = {
	id: number;
	label: string;
	shortLabel: string;
};

type SanctionRequestFormState = {
	inspectionId: string;
	isInspectionMissing: boolean;
	inspectionTeamIds: number[];
	nazwaPodmiotuObjetegoInspekcja: string;
	nazwaPodmiotuObjetegoSankcjaList: string[];
	dataWniosku: string;
	wniosekDo: string;
	sankcjaList: string[];
	podstawaPrawnaSankcjiList: string[];
	naruszeniaSkutkujaceSankcjaList: string[];
	czyMamyInformacjeOWszczeciuPostepowania: string;
	rozstrzygniecie: string;
	komentarz: string;
};

type SanctionDictionaryIdMaps = {
	nazwaPodmiotuObjetegoInspekcjaIdByValue: Record<string, number>;
	nazwaPodmiotuObjetegoSankcjaIdByValue: Record<string, number>;
	wniosekDoIdByValue: Record<string, number>;
	sankcjaIdByValue: Record<string, number>;
	podstawaPrawnaIdByValue: Record<string, number>;
	naruszeniaIdByValue: Record<string, number>;
	informacjaIdByValue: Record<string, number>;
	rozstrzygniecieIdByValue: Record<string, number>;
};

const EMPTY_FORM: SanctionRequestFormState = {
	inspectionId: "",
	isInspectionMissing: false,
	inspectionTeamIds: [],
	nazwaPodmiotuObjetegoInspekcja: "",
	nazwaPodmiotuObjetegoSankcjaList: [],
	dataWniosku: "",
	wniosekDo: "",
	sankcjaList: [],
	podstawaPrawnaSankcjiList: [],
	naruszeniaSkutkujaceSankcjaList: [],
	czyMamyInformacjeOWszczeciuPostepowania: "",
	rozstrzygniecie: "",
	komentarz: "",
};

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

const INSPECTIONS_API_URL = "/api/structure/inspections";
const AVAILABLE_INSPECTIONS_API_URL =
	"/api/sanction-requests/available-inspections";
const AVAILABLE_INSPECTIONS_ALIAS_API_URL =
	"/api/risk-exposure/available-inspections";
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
	const normalized =
		typeof value.normalize === "function" ? value.normalize("NFD") : value;

	return value
		? normalized
		: ""
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
}

const SANCTION_ENTITY_OPTIONS_API_URL =
	"/api/sanction-requests/entity-options";
const SANCTION_ENTITY_OPTIONS_ALIAS_API_URL =
	"/api/risk-exposure/entity-options";

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

type RecommendationExportColumnKey =
	| "lp"
	| "kodZalecenia"
	| "inspectionLp"
	| "nazwaPodmiotu"
	| "pozycja"
	| "terminWykonaniaZalecen"
	| "dataZalecenList"
	| "dataAkceptacjiNotyWeryfikacjiList"
	| "status"
	| "komentarz";

type DecisionExportColumnKey =
	| "lp"
	| "kodDecyzji"
	| "kodZalecenia"
	| "inspectionLp"
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

const INSPECTION_EXPORT_COLUMNS: ExportColumnDefinition<InspectionExportColumnKey>[] =
	[
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

const RECOMMENDATION_EXPORT_COLUMNS: ExportColumnDefinition<RecommendationExportColumnKey>[] =
	[
		{ key: "lp", label: "Lp." },
		{ key: "kodZalecenia", label: "Id zalecenia" },
		{ key: "inspectionLp", label: "Id inspekcji" },
		{ key: "nazwaPodmiotu", label: "Nazwa podmiotu" },
		{ key: "pozycja", label: "Liczba zaleceń" },
		{ key: "terminWykonaniaZalecen", label: "Data zaleceń" },
		{ key: "dataZalecenList", label: "Termin wykonania zaleceń" },
		{
			key: "dataAkceptacjiNotyWeryfikacjiList",
			label: "Data akceptacji noty z weryfikacji wykonania zaleceń",
		},
		{ key: "status", label: "Status" },
		{ key: "komentarz", label: "Komentarz" },
	];

const DECISION_EXPORT_COLUMNS: ExportColumnDefinition<DecisionExportColumnKey>[] =
	[
		{ key: "lp", label: "Lp." },
		{ key: "kodDecyzji", label: "Id decyzji" },
		{ key: "kodZalecenia", label: "Id zalecenia" },
		{ key: "inspectionLp", label: "Id inspekcji" },
		{ key: "nazwaPodmiotu", label: "Nazwa podmiotu" },
		{ key: "liczbaZalecen", label: "Liczba zaleceń" },
		{
			key: "dataWszczeciaPostepowaniaIInstancji",
			label: "Data wszczęcia postępowania administracyjnego I instancji",
		},
		{
			key: "osobyProwadzaceIInstancjeList",
			label: "Osoby prowadzące I instancję",
		},
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
		{
			key: "osobyProwadzaceIIInstancjeList",
			label: "Osoby prowadzące II instancję",
		},
		{ key: "dataDecyzjiIIInstancji", label: "Data decyzji II instancji" },
		{
			key: "dataDoreczeniaDecyzjiIIInstancji",
			label: "Data doręczenia decyzji II instancji",
		},
		{ key: "rozstrzygniecieII", label: "Rozstrzygnięcie II instancji" },
		{ key: "komentarz", label: "Komentarz" },
	];

function mapDictionaryEntriesToOptions(entries: DictionaryEntry[]) {
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
		.map((entry) => entry.nazwaPozycji.trim())
		.filter(Boolean);

	return Array.from(new Set(mappedOptions));
}

function normalizeStringList(values: unknown) {
	if (!Array.isArray(values)) {
		return [] as string[];
	}

	const normalized = values
		.map((value) => (typeof value === "string" ? value.trim() : ""))
		.filter(Boolean);

	return Array.from(new Set(normalized)).sort((left, right) =>
		left.localeCompare(right, "pl", { sensitivity: "base" }),
	);
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

function shortenInsuranceEntityName(name: string) {
	const trimmed = name.trim();
	if (!trimmed) {
		return "";
	}

	// Avoid Unicode property escapes (\p{...}) for better compatibility
	// with older browser engines used in some production environments.
	const tokens = trimmed.split(/\s+/);
	const compactedTokens: string[] = [];
	for (const token of tokens) {
		const previousToken = compactedTokens[compactedTokens.length - 1];
		if (
			typeof previousToken === "string" &&
			previousToken.localeCompare(token, "pl", { sensitivity: "base" }) === 0
		) {
			continue;
		}

		compactedTokens.push(token);
	}

	const withoutRepeatedWords = compactedTokens.join(" ");

	return withoutRepeatedWords
		.replace(/Towarzystwo\s+Ubezpieczen\s+na\s+Zycie/gi, "TU na Zycie")
		.replace(/Towarzystwo\s+Ubezpieczeń\s+na\s+Życie/gi, "TU na Życie")
		.replace(/Towarzystwo\s+Ubezpieczen/gi, "TU")
		.replace(/Towarzystwo\s+Ubezpieczeń/gi, "TU")
		.replace(/Zaklad\s+Ubezpieczen/gi, "ZU")
		.replace(/Zakład\s+Ubezpieczeń/gi, "ZU")
		.replace(/Spolka\s+Akcyjna/gi, "SA")
		.replace(/Spółka\s+Akcyjna/gi, "SA")
		.replace(/Spolka\s+z\s+ograniczona\s+odpowiedzialnoscia/gi, "Sp. z o.o.")
		.replace(/Spółka\s+z\s+ograniczoną\s+odpowiedzialnością/gi, "Sp. z o.o.")
		.replace(/\s{2,}/g, " ")
		.trim();
}

function getCellValue(
	item: SanctionRequestRead,
	key: SanctionRequestColumnKey,
) {
	if (
		key === "nazwaPodmiotuObjetegoSankcjaList" ||
		key === "sankcjaList" ||
		key === "podstawaPrawnaSankcjiList" ||
		key === "naruszeniaSkutkujaceSankcjaList"
	) {
		return item[key].join("; ");
	}

	if (key === "zespol") {
		return item.inspectionTeamIds.join("; ");
	}

	if (key === "inspectionId") {
		if (!item.inspectionId) {
			return "Brak";
		}
		return String(item.inspectionId);
	}

	if (key === "requestId") {
		return String(item.id);
	}

	const raw = item[key];
	if (raw === null || raw === undefined) {
		return "";
	}

	return String(raw);
}

function requestToForm(item: SanctionRequestRead): SanctionRequestFormState {
	const inspectionEntityName =
		String(item.nazwaPodmiotuObjetegoInspekcja ?? "").trim() ||
		String(item.nazwaPodmiotuObjetegoInspekcjaSkrocona ?? "").trim();

	return {
		inspectionId: item.inspectionId ? String(item.inspectionId) : "",
		isInspectionMissing: item.inspectionId === null,
		inspectionTeamIds: parseNumericIdList(item.inspectionTeamIds),
		nazwaPodmiotuObjetegoInspekcja: inspectionEntityName,
		nazwaPodmiotuObjetegoSankcjaList: normalizeStringList(
			item.nazwaPodmiotuObjetegoSankcjaList,
		),
		dataWniosku: item.dataWniosku ?? "",
		wniosekDo: item.wniosekDo ?? "",
		sankcjaList: normalizeStringList(item.sankcjaList),
		podstawaPrawnaSankcjiList: normalizeStringList(
			item.podstawaPrawnaSankcjiList,
		),
		naruszeniaSkutkujaceSankcjaList: normalizeStringList(
			item.naruszeniaSkutkujaceSankcjaList,
		),
		czyMamyInformacjeOWszczeciuPostepowania:
			item.czyMamyInformacjeOWszczeciuPostepowania ?? "",
		rozstrzygniecie: item.rozstrzygniecie ?? "",
		komentarz: item.komentarz ?? "",
	};
}

function formToPayload(
	form: SanctionRequestFormState,
	idMaps: SanctionDictionaryIdMaps,
	validInspectionTeamIdSet: Set<number>,
	mode: "create" | "update",
	existingItem?: SanctionRequestRead | null,
): SanctionRequestWrite | null {
	const inspectionId = Number(form.inspectionId);

	if (
		!form.isInspectionMissing &&
		(!Number.isFinite(inspectionId) || inspectionId <= 0)
	) {
		return null;
	}

	const findMappedId = (mapping: Record<string, number>, value: string) => {
		const normalizedValue = value.trim();
		if (!normalizedValue) {
			return NaN;
		}

		const exactId = mapping[normalizedValue] ?? NaN;
		if (Number.isFinite(exactId) && exactId > 0) {
			return exactId;
		}

		const normalizedLower = normalizedValue.toLocaleLowerCase("pl-PL");
		for (const [key, mappedId] of Object.entries(mapping)) {
			if (
				key.toLocaleLowerCase("pl-PL") === normalizedLower &&
				Number.isFinite(mappedId) &&
				mappedId > 0
			) {
				return mappedId;
			}
		}

		return NaN;
	};

	const toExistingIdByValue = (values: string[] | undefined, ids: number[] | undefined) => {
		const mapping: Record<string, number> = {};
		if (!Array.isArray(values) || !Array.isArray(ids)) {
			return mapping;
		}

		for (let index = 0; index < values.length; index += 1) {
			const value = values[index]?.trim() ?? "";
			const id = Number(ids[index]);
			if (!value || !Number.isFinite(id) || id <= 0 || mapping[value]) {
				continue;
			}

			mapping[value] = id;
		}

		return mapping;
	};

	const resolveSingleId = (
		value: string,
		mapping: Record<string, number>,
		existingValue: string | null | undefined,
		existingId: number | null | undefined,
	) => {
		const normalizedValue = value.trim();
		if (!normalizedValue) {
			return Number.NaN;
		}

		const directId = findMappedId(mapping, normalizedValue);
		if (Number.isFinite(directId) && directId > 0) {
			return directId;
		}

		const normalizedExistingValue = String(existingValue ?? "").trim();
		const normalizedExistingId = Number(existingId);
		if (
			normalizedValue === normalizedExistingValue &&
			Number.isFinite(normalizedExistingId) &&
			normalizedExistingId > 0
		) {
			return normalizedExistingId;
		}

		return NaN;
	};

	const resolveListIds = (
		values: string[],
		mapping: Record<string, number>,
		existingValues: string[] | undefined,
		existingIds: number[] | undefined,
	) => {
		const normalizedValues = normalizeStringList(values);
		if (normalizedValues.length === 0) {
			return [] as number[];
		}

		const existingIdByValue = toExistingIdByValue(existingValues, existingIds);
		const resolvedIds: number[] = [];
		for (const value of normalizedValues) {
			const mappedId =
				findMappedId(mapping, value) ||
				findMappedId(existingIdByValue, value) ||
				NaN;
			if (!Number.isFinite(mappedId) || mappedId <= 0) {
				return null;
			}

			resolvedIds.push(mappedId);
		}

		return resolvedIds;
	};

	const requiresEntityId = form.isInspectionMissing;
	const requiresEntityInCreate = mode === "create" && form.isInspectionMissing;
	const nazwaPodmiotuObjetegoInspekcjaId = resolveSingleId(
		form.nazwaPodmiotuObjetegoInspekcja,
		idMaps.nazwaPodmiotuObjetegoInspekcjaIdByValue,
		existingItem?.nazwaPodmiotuObjetegoInspekcja,
		existingItem?.nazwaPodmiotuObjetegoInspekcjaId,
	);

	if (
		(requiresEntityId || requiresEntityInCreate) &&
		(!Number.isFinite(nazwaPodmiotuObjetegoInspekcjaId) ||
			nazwaPodmiotuObjetegoInspekcjaId <= 0)
	) {
		return null;
	}

	const nazwaPodmiotuObjetegoSankcjaIds = resolveListIds(
		form.nazwaPodmiotuObjetegoSankcjaList,
		idMaps.nazwaPodmiotuObjetegoSankcjaIdByValue,
		existingItem?.nazwaPodmiotuObjetegoSankcjaList,
		existingItem?.nazwaPodmiotuObjetegoSankcjaIds,
	);
	if (!nazwaPodmiotuObjetegoSankcjaIds) {
		return null;
	}

	const sankcjaIds = resolveListIds(
		form.sankcjaList,
		idMaps.sankcjaIdByValue,
		existingItem?.sankcjaList,
		existingItem?.sankcjaIds,
	);
	if (!sankcjaIds) {
		return null;
	}

	const podstawaPrawnaSankcjiIds = resolveListIds(
		form.podstawaPrawnaSankcjiList,
		idMaps.podstawaPrawnaIdByValue,
		existingItem?.podstawaPrawnaSankcjiList,
		existingItem?.podstawaPrawnaSankcjiIds,
	);
	if (!podstawaPrawnaSankcjiIds) {
		return null;
	}

	const naruszeniaSkutkujaceSankcjaIds = resolveListIds(
		form.naruszeniaSkutkujaceSankcjaList,
		idMaps.naruszeniaIdByValue,
		existingItem?.naruszeniaSkutkujaceSankcjaList,
		existingItem?.naruszeniaSkutkujaceSankcjaIds,
	);
	if (!naruszeniaSkutkujaceSankcjaIds) {
		return null;
	}

	const wniosekDoId = resolveSingleId(
		form.wniosekDo,
		idMaps.wniosekDoIdByValue,
		existingItem?.wniosekDo,
		existingItem?.wniosekDoId,
	);
	if (form.wniosekDo.trim() && (!Number.isFinite(wniosekDoId) || wniosekDoId <= 0)) {
		return null;
	}

	const czyMamyInformacjeOWszczeciuPostepowaniaId = resolveSingleId(
		form.czyMamyInformacjeOWszczeciuPostepowania,
		idMaps.informacjaIdByValue,
		existingItem?.czyMamyInformacjeOWszczeciuPostepowania,
		existingItem?.czyMamyInformacjeOWszczeciuPostepowaniaId,
	);
	if (
		form.czyMamyInformacjeOWszczeciuPostepowania.trim() &&
		(!Number.isFinite(czyMamyInformacjeOWszczeciuPostepowaniaId) ||
			czyMamyInformacjeOWszczeciuPostepowaniaId <= 0)
	) {
		return null;
	}

	const rozstrzygniecieId = resolveSingleId(
		form.rozstrzygniecie,
		idMaps.rozstrzygniecieIdByValue,
		existingItem?.rozstrzygniecie,
		existingItem?.rozstrzygniecieId,
	);
	if (
		form.rozstrzygniecie.trim() &&
		(!Number.isFinite(rozstrzygniecieId) || rozstrzygniecieId <= 0)
	) {
		return null;
	}

	return {
		inspectionId: form.isInspectionMissing ? null : inspectionId,
		inspectionTeamIds: form.inspectionTeamIds.filter((teamId) =>
			validInspectionTeamIdSet.has(teamId),
		),
		nazwaPodmiotuObjetegoInspekcjaId:
			Number.isFinite(nazwaPodmiotuObjetegoInspekcjaId) &&
			nazwaPodmiotuObjetegoInspekcjaId > 0
				? nazwaPodmiotuObjetegoInspekcjaId
				: null,
		nazwaPodmiotuObjetegoSankcjaIds,
		dataWniosku: form.dataWniosku || null,
		wniosekDoId:
			Number.isFinite(wniosekDoId) && wniosekDoId > 0 ? wniosekDoId : null,
		sankcjaIds,
		podstawaPrawnaSankcjiIds,
		naruszeniaSkutkujaceSankcjaIds,
		czyMamyInformacjeOWszczeciuPostepowaniaId:
			Number.isFinite(czyMamyInformacjeOWszczeciuPostepowaniaId) &&
			czyMamyInformacjeOWszczeciuPostepowaniaId > 0
				? czyMamyInformacjeOWszczeciuPostepowaniaId
				: null,
		rozstrzygniecieId:
			Number.isFinite(rozstrzygniecieId) && rozstrzygniecieId > 0
				? rozstrzygniecieId
				: null,
		komentarz: form.komentarz.trim() || null,
	};
}

type MultiSelectFieldProps = {
	label: string;
	options: string[] | Array<{ value: string; label: string }>;
	values: string[];
	onChange: (next: string[]) => void;
	enableSearch?: boolean;
	searchPlaceholder?: string;
	disabled?: boolean;
	placeholder?: string;
	allowCustomValue?: boolean;
	onAddCustomValue?: (value: string) => boolean | Promise<boolean>;
	customAddLabel?: string;
};

function MultiSelectField({
	label,
	options,
	values,
	onChange,
	enableSearch = false,
	searchPlaceholder = "Wyszukaj...",
	disabled = false,
	placeholder = "Wybierz",
	allowCustomValue = false,
	onAddCustomValue,
	customAddLabel = "Dodaj pozycję",
}: MultiSelectFieldProps) {
	const [isOpen, setIsOpen] = useState(false);
	const [customValueInput, setCustomValueInput] = useState("");
	const [searchQuery, setSearchQuery] = useState("");
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const popupRef = useRef<HTMLDivElement | null>(null);
	const [popupPosition, setPopupPosition] = useState<{
		top: number;
		left: number;
		width: number;
		maxHeight: number;
	} | null>(null);
	const baseOptions = options.map((option) =>
		typeof option === "string"
			? { value: option, label: option }
			: { value: option.value, label: option.label },
	);
	const normalizedOptions = values.reduce(
		(acc, selectedValue) => {
			if (acc.some((option) => option.value === selectedValue)) {
				return acc;
			}

			return [...acc, { value: selectedValue, label: selectedValue }];
		},
		baseOptions,
	);
	const labelByValue = new Map(
		normalizedOptions.map((option) => [option.value, option.label]),
	);
	const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase("pl-PL");
	const visibleOptions = normalizedSearchQuery
		? normalizedOptions.filter((option) =>
				option.label.toLocaleLowerCase("pl-PL").includes(normalizedSearchQuery),
		  )
		: normalizedOptions;
	const MAX_VISIBLE_OPTIONS = 6;
	const OPTION_ROW_HEIGHT_ESTIMATE = 42;
	const POPUP_VERTICAL_PADDING = 20;
	const POPUP_MIN_HEIGHT = 140;
	const POPUP_GAP = 8;
	const visibleOptionsCount = Math.min(
		MAX_VISIBLE_OPTIONS,
		Math.max(1, normalizedOptions.length),
	);
	const estimatedOptionsHeight =
		visibleOptionsCount * OPTION_ROW_HEIGHT_ESTIMATE + POPUP_VERTICAL_PADDING;

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
			: estimatedOptionsHeight;
		const desiredHeight = Math.max(
			POPUP_MIN_HEIGHT,
			Math.min(popupContentHeight, estimatedOptionsHeight),
		);
		const spaceBelow = Math.max(0, availableBottom - rect.bottom - POPUP_GAP);
		const spaceAbove = Math.max(0, rect.top - availableTop - POPUP_GAP);
		const shouldOpenUp =
			spaceBelow < Math.min(desiredHeight, 180) && spaceAbove > spaceBelow;
		const maxHeight = Math.max(
			POPUP_MIN_HEIGHT,
			shouldOpenUp ? spaceAbove : spaceBelow,
		);
		const requestedHeight = Math.min(desiredHeight, maxHeight);
		const requestedTop = shouldOpenUp
			? rect.top - requestedHeight - POPUP_GAP
			: rect.bottom + POPUP_GAP;
		const minTop = availableTop;
		const maxTop = Math.max(minTop, availableBottom - requestedHeight);

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

		let resizeObserver: ResizeObserver | null = null;
		if (typeof ResizeObserver !== "undefined") {
			resizeObserver = new ResizeObserver(() => {
				updatePopupPosition();
			});

			if (triggerRef.current) {
				resizeObserver.observe(triggerRef.current);
			}
			if (popupRef.current) {
				resizeObserver.observe(popupRef.current);
			}
			const dialog = triggerRef.current?.closest('[role="dialog"]');
			if (dialog instanceof HTMLElement) {
				resizeObserver.observe(dialog);
			}
		}

		return () => {
			window.cancelAnimationFrame(frameId);
			window.removeEventListener("resize", updatePopupPosition);
			window.removeEventListener("scroll", handleAnyScroll, true);
			resizeObserver?.disconnect();
		};
	}, [estimatedOptionsHeight, isOpen, normalizedOptions.length]);

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

	const displayValue =
		values.length > 0
			? values
					.map((value) => labelByValue.get(value) ?? value)
					.join("; ")
			: placeholder;

	const toggleOption = (optionValue: string) => {
		if (disabled) {
			return;
		}

		if (values.includes(optionValue)) {
			onChange(values.filter((value) => value !== optionValue));
			return;
		}

		onChange([...values, optionValue]);
	};

	const handleAddCustomValue = async () => {
		if (disabled) {
			return;
		}

		const normalized = customValueInput.trim();
		if (!normalized) {
			return;
		}

		const canAdd = (await onAddCustomValue?.(normalized)) ?? true;
		if (!canAdd) {
			return;
		}

		if (!values.includes(normalized)) {
			onChange([...values, normalized]);
		}

		setCustomValueInput("");
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
					<span className="min-w-0 whitespace-normal break-words">{displayValue}</span>
					{allowCustomValue ? (
						<Plus size={14} className="text-slate-500" />
					) : (
						<ChevronDown size={14} className="text-slate-500" />
					)}
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
						{allowCustomValue ? (
							<div className="mb-2 flex items-center gap-2 border-slate-200 border-b pb-2">
								<input
									type="text"
									value={customValueInput}
									disabled={disabled}
									onChange={(event) => setCustomValueInput(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === "Enter") {
											event.preventDefault();
											void handleAddCustomValue();
										}
									}}
									placeholder={customAddLabel}
									className="h-8 flex-1 rounded-md border border-slate-300 px-2 text-slate-900 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-blue-400"
								/>
								<button
									type="button"
									disabled={disabled}
									onClick={() => {
										void handleAddCustomValue();
									}}
									className="inline-flex h-8 items-center rounded-md border border-[#6ea3f0] bg-[#2d4d7f] px-2.5 font-semibold text-slate-100 text-xs transition-colors hover:bg-[#375f99] disabled:cursor-not-allowed disabled:opacity-60"
								>
									Dodaj
								</button>
							</div>
						) : null}

						<div className="mb-2 border-slate-200 border-b pb-2 font-medium text-slate-600 text-xs">
							Wybierz jedną lub więcej pozycji
						</div>

						{enableSearch ? (
							<div className="mb-2">
								<input
									type="text"
									value={searchQuery}
									onChange={(event) => setSearchQuery(event.target.value)}
									placeholder={searchPlaceholder}
									className="h-8 w-full rounded-md border border-slate-300 px-2 text-slate-900 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-blue-400"
								/>
							</div>
						) : null}

						<div className="subtle-vertical-scroll max-h-52 space-y-1 overflow-y-auto pr-1">
							{visibleOptions.length === 0 ? (
								<p className="px-2 py-1 text-slate-500 text-sm">
									Brak dostępnych opcji.
								</p>
							) : null}

							{visibleOptions.map((option) => {
								const isSelected = values.includes(option.value);
								return (
									<button
										key={`${option.value}-${option.label}`}
										type="button"
										disabled={disabled}
										onClick={() => toggleOption(option.value)}
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
			<span className="mt-1 block text-xs text-slate-500">
				Wybrano: {values.length}
			</span>
		</label>
	);
}

export function SanctionRequestsPanel({
	operatorLogin,
	authRole,
	isObserver,
	canEditDictionaries = false,
}: SanctionRequestsPanelProps) {
	const [items, setItems] = useState<SanctionRequestRead[]>([]);
	const [total, setTotal] = useState(0);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const [selectedId, setSelectedId] = useState<number | null>(null);
	const [pendingDashboardSanctionRequestCode, setPendingDashboardSanctionRequestCode] =
		useState<string | null>(null);
	const [isFormOpen, setIsFormOpen] = useState(false);
	const [editingItem, setEditingItem] = useState<SanctionRequestRead | null>(
		null,
	);
	const [form, setForm] = useState<SanctionRequestFormState>(EMPTY_FORM);
	const [formError, setFormError] = useState<string | null>(null);
	const [showRequiredFieldErrors, setShowRequiredFieldErrors] = useState(false);
	const [versionConflictUpdatedAt, setVersionConflictUpdatedAt] = useState<
		string | null
	>(null);
	const [saveLockConflict, setSaveLockConflict] =
		useState<SanctionRequestLockConflict | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false);
	const [successEntityName, setSuccessEntityName] = useState("");
	const [successInspectionCode, setSuccessInspectionCode] = useState("");
	const [successMode, setSuccessMode] = useState<"create" | "edit">("create");
	const [isDeleteConfirmModalOpen, setIsDeleteConfirmModalOpen] =
		useState(false);
	const [isDeletingItem, setIsDeletingItem] = useState(false);
	const [isDeleteSuccessModalOpen, setIsDeleteSuccessModalOpen] =
		useState(false);
	const [deleteSuccessEntityName, setDeleteSuccessEntityName] = useState("");
	const [tablePageSize, setTablePageSize] = useState<number>(() =>
		readPersistedTablePageSize(
			`${SANCTION_REQUESTS_TABLE_VIEW_STORAGE_PREFIX}.${operatorLogin
				.trim()
				.toLowerCase()}.page-size`,
		),
	);
	const [columnWidths, setColumnWidths] = useState<
		Partial<Record<SanctionRequestColumnKey, number>>
	>(DEFAULT_SANCTION_REQUEST_COLUMN_WIDTHS);
	const [sanctionShortNameVariants, setSanctionShortNameVariants] =
		useState<SanctionShortNameVariantByColumn>(
			DEFAULT_SANCTION_SHORT_NAME_VARIANTS,
		);
	const [draftSanctionShortNameVariants, setDraftSanctionShortNameVariants] =
		useState<SanctionShortNameVariantByColumn>(
			DEFAULT_SANCTION_SHORT_NAME_VARIANTS,
		);
	const [areNameVariantsHydrated, setAreNameVariantsHydrated] =
		useState(false);
	const [areColumnWidthsHydrated, setAreColumnWidthsHydrated] = useState(false);
	const canManageSanctionRequests = authRole !== "external_user" && !isObserver;
	const canManageDictionaryEntries = canEditDictionaries && canManageSanctionRequests;
	const isDirector = authRole === "director";
	const normalizedOperatorLogin = operatorLogin.trim().toLowerCase();
	const columnWidthsStorageKey = `${SANCTION_REQUESTS_COLUMN_WIDTHS_STORAGE_PREFIX}.${normalizedOperatorLogin}`;
	const nameVariantsStorageKey = `${SANCTION_REQUESTS_NAME_VARIANTS_STORAGE_PREFIX}.${normalizedOperatorLogin}`;
	const tableViewStorageKey = `${SANCTION_REQUESTS_TABLE_VIEW_STORAGE_PREFIX}.${normalizedOperatorLogin}`;
	const tablePageSizeStorageKey = `${tableViewStorageKey}.page-size`;

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
	const [advancedFilterAnchor, setAdvancedFilterAnchor] = useState({
		top: 120,
		left: 120,
	});
	const [isExporting, setIsExporting] = useState(false);
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [isExportConfigModalOpen, setIsExportConfigModalOpen] = useState(false);
	const [includeInspectionsInExport, setIncludeInspectionsInExport] =
		useState(false);
	const [includeRecommendationsInExport, setIncludeRecommendationsInExport] =
		useState(false);
	const [includeDecisionsInExport, setIncludeDecisionsInExport] =
		useState(false);
	const [activeExportColumnsTab, setActiveExportColumnsTab] = useState<
		"inspections" | "recommendations" | "decisions"
	>("inspections");
	const [selectedInspectionExportColumns, setSelectedInspectionExportColumns] =
		useState<InspectionExportColumnKey[]>(
			INSPECTION_EXPORT_COLUMNS.map((column) => column.key),
		);
	const [
		selectedRecommendationExportColumns,
		setSelectedRecommendationExportColumns,
	] = useState<RecommendationExportColumnKey[]>(
		RECOMMENDATION_EXPORT_COLUMNS.map((column) => column.key),
	);
	const [selectedDecisionExportColumns, setSelectedDecisionExportColumns] =
		useState<DecisionExportColumnKey[]>(
			DECISION_EXPORT_COLUMNS.map((column) => column.key),
		);

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

	const [inspectionOptions, setInspectionOptions] = useState<
		InspectionOption[]
	>([]);
	const [inspectionTeamOptions, setInspectionTeamOptions] = useState<
		InspectionTeamOption[]
	>([]);
	const [isInspectionTeamSelectionManual, setIsInspectionTeamSelectionManual] =
		useState(false);
	const [isInspectionOptionsLoading, setIsInspectionOptionsLoading] =
		useState(false);
	const [nazwaPodmiotuSankcjaOptions, setNazwaPodmiotuSankcjaOptions] =
		useState<Array<{ value: string; label: string }>>([]);
	const [nazwaPodmiotuSankcjaIdByValue, setNazwaPodmiotuSankcjaIdByValue] =
		useState<Record<string, number>>({});
	const [nazwaPodmiotuInspekcjaOptions, setNazwaPodmiotuInspekcjaOptions] =
		useState<string[]>([]);
	const [nazwaPodmiotuInspekcjaIdByValue, setNazwaPodmiotuInspekcjaIdByValue] =
		useState<Record<string, number>>({});
	const [wniosekDoOptions, setWniosekDoOptions] = useState<
		Array<{ value: string; label: string }>
	>([]);
	const [wniosekDoIdByValue, setWniosekDoIdByValue] = useState<
		Record<string, number>
	>({});
	const [sankcjaOptions, setSankcjaOptions] = useState<
		Array<{ value: string; label: string }>
	>([]);
	const [sankcjaIdByValue, setSankcjaIdByValue] = useState<
		Record<string, number>
	>({});
	const [podstawaPrawnaOptions, setPodstawaPrawnaOptions] = useState<
		Array<{ value: string; label: string }>
	>([]);
	const [podstawaPrawnaIdByValue, setPodstawaPrawnaIdByValue] = useState<
		Record<string, number>
	>({});
	const [naruszeniaOptions, setNaruszeniaOptions] = useState<
		Array<{ value: string; label: string }>
	>([]);
	const [naruszeniaIdByValue, setNaruszeniaIdByValue] = useState<
		Record<string, number>
	>({});
	const [informacjaOptions, setInformacjaOptions] = useState<
		Array<{ value: string; label: string }>
	>([]);
	const [informacjaIdByValue, setInformacjaIdByValue] = useState<
		Record<string, number>
	>({});
	const [rozstrzygniecieOptions, setRozstrzygniecieOptions] = useState<
		Array<{ value: string; label: string }>
	>([]);
	const [rozstrzygniecieIdByValue, setRozstrzygniecieIdByValue] = useState<
		Record<string, number>
	>({});

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

	const inspectionTeamLabelById = useMemo(() => {
		const byId = new Map<number, string>();
		for (const option of inspectionTeamOptions) {
			byId.set(option.id, option.shortLabel || option.label);
		}

		return byId;
	}, [inspectionTeamOptions]);

	const validInspectionTeamIdSet = useMemo(() => {
		return new Set(inspectionTeamOptions.map((option) => option.id));
	}, [inspectionTeamOptions]);

	const inspectionSelectOptions = useMemo(
		() =>
			inspectionOptions.map((option) => ({
				value: String(option.id),
				label: `${option.inspectionCode}${
					option.nazwaPodmiotu
						? ` - ${shortenInsuranceEntityName(option.nazwaPodmiotu)}`
						: ""
				}`,
			})),
		[inspectionOptions],
	);

	const resolvedInspectionSelectOptions = useMemo(() => {
		const baseOptions = [...inspectionSelectOptions];
		if (!form.inspectionId.trim()) {
			return baseOptions;
		}

		if (baseOptions.some((option) => option.value === form.inspectionId)) {
			return baseOptions;
		}

		const fallbackCode =
			resolveInspectionCode({
				inspectionKod: editingItem?.inspectionKod,
				kodInspekcji: editingItem?.kodInspekcji,
				inspectionLp: editingItem?.inspectionLp,
				inspectionId: editingItem?.inspectionId,
			}) || form.inspectionId;
		const fallbackEntityName = shortenInsuranceEntityName(
			form.nazwaPodmiotuObjetegoInspekcja,
		);

		return [
			{
				value: form.inspectionId,
				label: fallbackEntityName
					? `${fallbackCode} - ${fallbackEntityName}`
					: fallbackCode,
			},
			...baseOptions,
		];
	}, [
		editingItem?.inspectionId,
		editingItem?.inspectionKod,
		editingItem?.inspectionLp,
		editingItem?.kodInspekcji,
		form.inspectionId,
		form.nazwaPodmiotuObjetegoInspekcja,
		inspectionSelectOptions,
	]);

	const inspectionTeamSelectOptions = useMemo(
		() =>
			inspectionTeamOptions.map((option) => ({
				value: String(option.id),
				label: option.shortLabel || option.label,
			})),
		[inspectionTeamOptions],
	);

	const isEditMode = Boolean(editingItem);
	const editRecordLock = useRecordLock({
		enabled: isFormOpen && isEditMode,
		module: "sanction-requests",
		recordId: editingItem?.id ?? null,
		operatorLogin,
		heartbeatIntervalMs: 20_000,
	});
	const shouldShowLockedByOtherUser =
		Boolean(saveLockConflict) || editRecordLock.isBlocked;
	const isReadOnlyDueToLock = isEditMode && shouldShowLockedByOtherUser;
	const lockOwnerDisplayName =
		saveLockConflict?.ownerDisplayName ||
		editRecordLock.owner?.displayName ||
		"";
	const lockOwnerLogin =
		saveLockConflict?.ownerLogin || editRecordLock.owner?.login || "";
	const lockOwnerLabel =
		lockOwnerDisplayName || lockOwnerLogin
			? `${lockOwnerDisplayName || "Nieznany użytkownik"}${
					lockOwnerLogin ? ` (${lockOwnerLogin})` : ""
				}`
			: "inny użytkownik";
	const lockAcquiredAt =
		saveLockConflict?.acquiredAt ||
		editRecordLock.lockDetails?.acquiredAt ||
		null;

	const isSaveDisabledDueToLock =
		isEditMode &&
		(editRecordLock.isAcquireFailed ||
			editRecordLock.isConnectionLost ||
			editRecordLock.isExpired);
	const closeModalRef = useRef<() => void>(() => {});
	const inactivityTimeout = useInactivityTimeout({
		enabled: isFormOpen,
		inactivityMs: INACTIVITY_TIMEOUT_MS,
		warningMs: INACTIVITY_WARNING_MS,
		onTimeout: () => closeModalRef.current(),
	});

	const inspectionCodeById = useMemo(
		() =>
			new Map(
				inspectionOptions.map((option) => [option.id, option.inspectionCode]),
			),
		[inspectionOptions],
	);

	function resolveInspectionCode(payload: {
		inspectionKod?: unknown;
		kodInspekcji?: unknown;
		inspectionLp?: unknown;
		lp?: unknown;
		inspectionId?: unknown;
	}) {
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
	}

	const getCellValue = (
		item: SanctionRequestRead,
		key: SanctionRequestColumnKey,
	) => {
		if (key === "requestId") {
			const sanctionCode = String(item.kodSankcji ?? "").trim();
			if (sanctionCode) {
				return sanctionCode;
			}

			if (Number.isFinite(item.id) && item.id > 0) {
				return String(item.id);
			}

			return "";
		}

		if (
			key === "nazwaPodmiotuObjetegoSankcjaList" ||
			key === "sankcjaList" ||
			key === "podstawaPrawnaSankcjiList" ||
			key === "naruszeniaSkutkujaceSankcjaList"
		) {
			return item[key].join("; ");
		}

		if (key === "zespol") {
			const teamIds = parseNumericIdList(item.inspectionTeamIds);
			if (teamIds.length === 0) {
				return "";
			}

			return teamIds
				.map((teamId) => inspectionTeamLabelById.get(teamId) ?? `ID: ${teamId}`)
				.join("; ");
		}

		if (key === "inspectionId") {
			return (
				resolveInspectionCode({
					inspectionKod: item.inspectionKod,
					kodInspekcji: item.kodInspekcji,
					inspectionLp: item.inspectionLp,
					inspectionId: item.inspectionId,
				}) || "-"
			);
		}

		const raw = item[key];
		if (raw === null || raw === undefined) {
			return "";
		}

		return String(raw);
	};

	const resolvedNazwaPodmiotuSankcjaSelectOptions = useMemo(
		() => {
			const uniqueByValue = new Map<string, { value: string; label: string }>();

			for (const option of nazwaPodmiotuSankcjaOptions) {
				const value = option.value.trim();
				if (!value) {
					continue;
				}

				const label = option.label.trim() || value;
				if (!uniqueByValue.has(value)) {
					uniqueByValue.set(value, { value, label });
				}
			}

			for (const selectedValue of form.nazwaPodmiotuObjetegoSankcjaList) {
				const value = selectedValue.trim();
				if (!value || uniqueByValue.has(value)) {
					continue;
				}

				uniqueByValue.set(value, {
					value,
					label: shortenInsuranceEntityName(value) || value,
				});
			}

			return Array.from(uniqueByValue.values()).sort((left, right) =>
				left.label.localeCompare(right.label, "pl", {
					sensitivity: "base",
				}),
			);
		},
		[form.nazwaPodmiotuObjetegoSankcjaList, nazwaPodmiotuSankcjaOptions],
	);

	const sankcjaOptionsFull = useMemo(
		() => sankcjaOptions.map((option) => ({ value: option.value, label: option.value })),
		[sankcjaOptions],
	);

	const podstawaPrawnaOptionsFull = useMemo(
		() =>
			podstawaPrawnaOptions.map((option) => ({
				value: option.value,
				label: option.label || option.value,
			})),
		[podstawaPrawnaOptions],
	);

	const naruszeniaOptionsFull = useMemo(
		() =>
			naruszeniaOptions.map((option) => ({
				value: option.value,
				label: option.label || option.value,
			})),
		[naruszeniaOptions],
	);

	const informacjaOptionsFull = useMemo(
		() =>
			informacjaOptions.map((option) => ({
				value: option.value,
				label: option.value,
			})),
		[informacjaOptions],
	);

	const rozstrzygniecieOptionsFull = useMemo(
		() =>
			rozstrzygniecieOptions.map((option) => ({
				value: option.value,
				label: option.value,
			})),
		[rozstrzygniecieOptions],
	);

	const sanctionRequestRowsForDisplay = useMemo(
		() =>
			items.map((item, index) => {
				const withScalarFallback = (
					fullValue: string | null,
					shortValue: string | null,
				) => {
					const normalizedShortValue = String(shortValue ?? "").trim();
					if (normalizedShortValue) {
						return normalizedShortValue;
					}

					return fullValue;
				};

				const withListFallback = (fullValue: string[], shortValue: string[]) =>
					Array.isArray(shortValue) && shortValue.length > 0
						? shortValue
						: fullValue;

				return {
					...item,
					lp: items.length - index,
					nazwaPodmiotuObjetegoInspekcja:
						sanctionShortNameVariants.nazwaPodmiotuObjetegoInspekcja === "short"
							? withScalarFallback(
									item.nazwaPodmiotuObjetegoInspekcja,
									item.nazwaPodmiotuObjetegoInspekcjaSkrocona,
								)
							: item.nazwaPodmiotuObjetegoInspekcja,
					nazwaPodmiotuObjetegoSankcjaList:
						sanctionShortNameVariants.nazwaPodmiotuObjetegoSankcjaList === "short"
							? withListFallback(
									item.nazwaPodmiotuObjetegoSankcjaList,
									item.nazwaPodmiotuObjetegoSankcjaListSkrocona,
								)
							: item.nazwaPodmiotuObjetegoSankcjaList,
					wniosekDo:
						sanctionShortNameVariants.wniosekDo === "short"
							? withScalarFallback(item.wniosekDo, item.wniosekDoSkrocona)
							: item.wniosekDo,
					sankcjaList:
						sanctionShortNameVariants.sankcjaList === "short"
							? withListFallback(item.sankcjaList, item.sankcjaListSkrocona)
							: item.sankcjaList,
					podstawaPrawnaSankcjiList:
						sanctionShortNameVariants.podstawaPrawnaSankcjiList === "short"
							? withListFallback(
									item.podstawaPrawnaSankcjiList,
									item.podstawaPrawnaSankcjiListSkrocona,
								)
							: item.podstawaPrawnaSankcjiList,
					naruszeniaSkutkujaceSankcjaList:
						sanctionShortNameVariants.naruszeniaSkutkujaceSankcjaList === "short"
							? withListFallback(
									item.naruszeniaSkutkujaceSankcjaList,
									item.naruszeniaSkutkujaceSankcjaListSkrocona,
								)
							: item.naruszeniaSkutkujaceSankcjaList,
					czyMamyInformacjeOWszczeciuPostepowania:
						sanctionShortNameVariants.czyMamyInformacjeOWszczeciuPostepowania ===
						"short"
							? withScalarFallback(
									item.czyMamyInformacjeOWszczeciuPostepowania,
									item.czyMamyInformacjeOWszczeciuPostepowaniaSkrocona,
								)
							: item.czyMamyInformacjeOWszczeciuPostepowania,
					rozstrzygniecie:
						sanctionShortNameVariants.rozstrzygniecie === "short"
							? withScalarFallback(
									item.rozstrzygniecie,
									item.rozstrzygniecieSkrocona,
								)
							: item.rozstrzygniecie,
				};
			}),
		[items, sanctionShortNameVariants],
	);

	const {
		advancedFilterColumnKey,
		advancedFilterSearch,
		advancedFilters,
		canClearFilters,
		clearAdvancedFilterForSelectedColumn,
		clearFilters,
		columnFilters,
		draftHiddenColumns,
		draftVisibleColumns: draftVisibleSanctionRequestColumns,
		filteredAndSortedRows: filteredAndSortedItems,
		paginatedRows: paginatedSanctionRequestItems,
		currentPage,
		totalPages,
		pageSize,
		paginationItems,
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
		setIsAdvancedFilterModalOpen,
		setIsColumnPickerOpen,
		sortColumnKey,
		sortDirection,
		toggleAdvancedFilterValue,
		visibleAdvancedFilterValues,
		visibleColumns: visibleSanctionRequestColumns,
	} = useTableState<SanctionRequestRead, SanctionRequestColumnKey>({
		rows: sanctionRequestRowsForDisplay,
		allColumnKeys: ALL_SANCTION_REQUEST_COLUMN_KEYS,
		initialAdvancedFilterColumnKey: "nazwaPodmiotuObjetegoInspekcja",
		paginationResetMode: "start",
		initialPageMode: "start",
		getCellValue,
		advancedFilterValueSplitter: (rawValue, columnKey, row) =>
			splitSanctionAdvancedFilterCellValue(columnKey, rawValue, row),
		advancedFilterMatcher: (rawValue, selectedValues, columnKey, row) =>
			matchesSanctionAdvancedFilterCellValue(
				columnKey,
				rawValue,
				selectedValues,
				row,
			),
		pageSize: tablePageSize,
		hiddenColumnsStorageKey: tableViewStorageKey,
		hiddenColumnsStorageArea: "localStorage",
		alignToEndPageSize: false,
		sortComparators: {
			lp: (left, right) =>
				(Number(getCellValue(left, "lp")) || 0) -
				(Number(getCellValue(right, "lp")) || 0),
		},
	});

	const columnDisplayModeOptionsByKey = useMemo(
		() =>
			Object.fromEntries(
				SANCTION_SHORT_NAME_COLUMN_KEYS.map((columnKey) => [
					columnKey,
					[...SANCTION_SHORT_NAME_VARIANT_OPTIONS],
				]),
			) as Partial<
				Record<
					SanctionRequestColumnKey,
					Array<{ value: string; label: string }>
				>
			>,
		[],
	);

	const draftColumnDisplayModeValuesByKey = useMemo(
		() =>
			Object.fromEntries(
				SANCTION_SHORT_NAME_COLUMN_KEYS.map((columnKey) => [
					columnKey,
					draftSanctionShortNameVariants[columnKey],
				]),
			) as Partial<Record<SanctionRequestColumnKey, string>>,
		[draftSanctionShortNameVariants],
	);

	const handleOpenSanctionViewModal = () => {
		setDraftSanctionShortNameVariants(sanctionShortNameVariants);
		handleOpenViewModal();
	};

	const handleApplySanctionViewChanges = () => {
		setSanctionShortNameVariants(draftSanctionShortNameVariants);
		handleApplyViewChanges();
	};

	const handleResetSanctionViewSelection = () => {
		handleDraftSelectAllColumns();
		setDraftSanctionShortNameVariants(DEFAULT_SANCTION_SHORT_NAME_VARIANTS);
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
			const parsed = JSON.parse(raw) as Partial<
				Record<SanctionRequestColumnKey, unknown>
			>;
			const next: SanctionShortNameVariantByColumn = {
				...DEFAULT_SANCTION_SHORT_NAME_VARIANTS,
			};

			for (const columnKey of SANCTION_SHORT_NAME_COLUMN_KEYS) {
				const value = parsed[columnKey];
				if (value === "full" || value === "short") {
					next[columnKey] = value;
				}
			}

			// Keep these two columns short by default after introducing short labels.
			next.podstawaPrawnaSankcjiList = "short";
			next.naruszeniaSkutkujaceSankcjaList = "short";

			setSanctionShortNameVariants(next);
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
			JSON.stringify(sanctionShortNameVariants),
		);
	}, [
		areNameVariantsHydrated,
		nameVariantsStorageKey,
		sanctionShortNameVariants,
	]);

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
			DASHBOARD_OPEN_SANCTION_REQUEST_CODE_KEY,
		);
		if (fromSession?.trim()) {
			setPendingDashboardSanctionRequestCode(fromSession.trim());
		}

		const handleOpenSanctionRequestFromDashboard = (event: Event) => {
			const customEvent = event as CustomEvent<{ sanctionRequestCode?: unknown }>;
			const sanctionRequestCode =
				typeof customEvent.detail?.sanctionRequestCode === "string"
					? customEvent.detail.sanctionRequestCode.trim()
					: "";
			if (!sanctionRequestCode) {
				return;
			}

			window.sessionStorage.setItem(
				DASHBOARD_OPEN_SANCTION_REQUEST_CODE_KEY,
				sanctionRequestCode,
			);
			setPendingDashboardSanctionRequestCode(sanctionRequestCode);
		};

		window.addEventListener(
			DASHBOARD_OPEN_SANCTION_REQUEST_EVENT,
			handleOpenSanctionRequestFromDashboard,
		);

		return () => {
			window.removeEventListener(
				DASHBOARD_OPEN_SANCTION_REQUEST_EVENT,
				handleOpenSanctionRequestFromDashboard,
			);
		};
	}, []);

	useEffect(() => {
		if (!pendingDashboardSanctionRequestCode || isLoading) {
			return;
		}

		const normalizedToken = pendingDashboardSanctionRequestCode.trim().toLowerCase();
		if (!normalizedToken) {
			setPendingDashboardSanctionRequestCode(null);
			return;
		}

		const matchesToken = (item: SanctionRequestRead) => {
			const codeToken = String(item.kodSankcji ?? "").trim().toLowerCase();
			const idToken = String(item.id ?? "").trim().toLowerCase();
			const lpToken = String(item.lp ?? "").trim().toLowerCase();

			return (
				codeToken === normalizedToken ||
				idToken === normalizedToken ||
				lpToken === normalizedToken
			);
		};

		const targetItem = filteredAndSortedItems.find(matchesToken);

		if (!targetItem) {
			const targetExistsOutsideFilters = sanctionRequestRowsForDisplay.some(matchesToken);

			if (targetExistsOutsideFilters && canClearFilters) {
				clearFilters();
			}
			return;
		}

		const rowIndex = filteredAndSortedItems.findIndex((item) => item.id === targetItem.id);
		if (rowIndex < 0) {
			return;
		}

		const targetPage = Math.max(1, Math.floor(rowIndex / pageSize) + 1);
		handlePageChange(targetPage);
		setSelectedId(targetItem.id);
		setPendingDashboardSanctionRequestCode(null);

		if (typeof window !== "undefined") {
			window.sessionStorage.removeItem(DASHBOARD_OPEN_SANCTION_REQUEST_CODE_KEY);
		}
	}, [
		canClearFilters,
		clearFilters,
		filteredAndSortedItems,
		handlePageChange,
		isLoading,
		pageSize,
		pendingDashboardSanctionRequestCode,
		sanctionRequestRowsForDisplay,
	]);

	const visibleSanctionRequestColumnDefinitions = useMemo(
		() =>
			SANCTION_REQUEST_COLUMNS.filter((column) =>
				visibleSanctionRequestColumns.includes(column.key),
			),
		[visibleSanctionRequestColumns],
	);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		try {
			const raw = window.localStorage.getItem(columnWidthsStorageKey);
			if (!raw) {
				setColumnWidths(DEFAULT_SANCTION_REQUEST_COLUMN_WIDTHS);
				setAreColumnWidthsHydrated(true);
				return;
			}

			const parsed = JSON.parse(raw) as Partial<
				Record<SanctionRequestColumnKey, unknown>
			>;
			const sanitized: Partial<Record<SanctionRequestColumnKey, number>> = {
				...DEFAULT_SANCTION_REQUEST_COLUMN_WIDTHS,
			};

			for (const key of ALL_SANCTION_REQUEST_COLUMN_KEYS) {
				if (key === "lp") {
					// Keep LP width aligned with recommendations default even if older localStorage saved a different width.
					continue;
				}

				const value = parsed[key];
				if (typeof value !== "number" || !Number.isFinite(value)) {
					continue;
				}

				sanitized[key] = Math.max(
					SANCTION_REQUESTS_MIN_COLUMN_WIDTH,
					Math.round(value),
				);
			}

			setColumnWidths(sanitized);
		} catch {
			setColumnWidths(DEFAULT_SANCTION_REQUEST_COLUMN_WIDTHS);
		} finally {
			setAreColumnWidthsHydrated(true);
		}
	}, [columnWidthsStorageKey]);

	const hasCustomColumnWidths = useMemo(() => {
		const keys = new Set<SanctionRequestColumnKey>([
			...ALL_SANCTION_REQUEST_COLUMN_KEYS,
			...(Object.keys(columnWidths) as SanctionRequestColumnKey[]),
		]);

		for (const columnKey of keys) {
			const currentWidth = columnWidths[columnKey];
			const defaultWidth = DEFAULT_SANCTION_REQUEST_COLUMN_WIDTHS[columnKey];
			if (currentWidth !== defaultWidth) {
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

	const handleResizeColumn = (
		columnKey: SanctionRequestColumnKey,
		width: number,
	) => {
		if (!Number.isFinite(width)) {
			return;
		}

		setColumnWidths((prev) => ({
			...prev,
			[columnKey]: Math.max(SANCTION_REQUESTS_MIN_COLUMN_WIDTH, Math.round(width)),
		}));
	};

	const handleResetColumnWidths = () => {
		setColumnWidths(DEFAULT_SANCTION_REQUEST_COLUMN_WIDTHS);
	};

	const loadItems = async () => {
		setError(null);
		setIsLoading(true);

		const result = await fetchSanctionRequests(operatorLogin, {
			sortBy: "dataWniosku",
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

			let response = await fetch(AVAILABLE_INSPECTIONS_API_URL, {
				method: "GET",
				headers: {
					"Content-Type": "application/json",
					"X-Operator-Login": operatorLogin,
				},
				cache: "no-store",
			});

			if (response.status === 404) {
				response = await fetch(AVAILABLE_INSPECTIONS_ALIAS_API_URL, {
					method: "GET",
					headers: {
						"Content-Type": "application/json",
						"X-Operator-Login": operatorLogin,
					},
					cache: "no-store",
				});
			}

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
					| {
						items?: Array<{
							id?: unknown;
							code?: unknown;
							kod?: unknown;
							name?: unknown;
							nazwa?: unknown;
							isActive?: unknown;
							aktywny?: unknown;
						}>;
					};
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

	const loadDictionaryOptions = async (
		kodTypu: string,
		setter: (value: string[]) => void,
		idSetter: (value: Record<string, number>) => void,
	) => {
		try {
			const result = await fetchDictionaryEntries(kodTypu);
			if (!result.ok) {
				setter([]);
				idSetter({});
				return;
			}

			const nextIdByValue: Record<string, number> = {};
			for (const entry of result.data) {
				const value = entry.nazwaPozycji.trim();
				if (
					value &&
					typeof entry.id === "number" &&
					Number.isFinite(entry.id) &&
					entry.id > 0 &&
					!nextIdByValue[value]
				) {
					nextIdByValue[value] = entry.id;
				}
			}

			setter(mapDictionaryEntriesToOptions(result.data));
			idSetter(nextIdByValue);
		} catch {
			setter([]);
			idSetter({});
		}
	};

	const loadDictionarySelectOptions = async (
		kodTypu: string,
		setter: (value: Array<{ value: string; label: string }>) => void,
		idSetter: (value: Record<string, number>) => void,
	) => {
		try {
			const result = await fetchDictionaryEntries(kodTypu);
			if (!result.ok) {
				setter([]);
				idSetter({});
				return;
			}

			const mapped = result.data
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
					const shortLabel = (entry.skrotPozycji ?? "").trim();
					return {
						value,
						label: shortLabel || value,
					};
				})
				.filter((option) => option.value.length > 0);

			const uniqueByValue = new Map<string, { value: string; label: string }>();
			const nextIdByValue: Record<string, number> = {};
			for (const option of mapped) {
				if (!uniqueByValue.has(option.value)) {
					uniqueByValue.set(option.value, option);
				}
			}

			for (const entry of result.data) {
				if (!entry.aktywny) {
					continue;
				}

				const value = entry.nazwaPozycji.trim();
				if (
					value &&
					typeof entry.id === "number" &&
					Number.isFinite(entry.id) &&
					entry.id > 0 &&
					!nextIdByValue[value]
				) {
					nextIdByValue[value] = entry.id;
				}
			}

			setter(Array.from(uniqueByValue.values()));
			idSetter(nextIdByValue);
		} catch {
			setter([]);
			idSetter({});
		}
	};

	const loadSanctionEntityOptions = async () => {
		const registerIdMapping = (
			mapping: Record<string, number>,
			key: string,
			id: unknown,
		) => {
			const normalizedKey = String(key).trim();
			const normalizedId = Number(id);
			if (
				!normalizedKey ||
				!Number.isFinite(normalizedId) ||
				normalizedId <= 0 ||
				mapping[normalizedKey]
			) {
				return;
			}

			mapping[normalizedKey] = normalizedId;
		};

		const dictionaryOptions: Array<{ value: string; label: string }> = [];
		const apiOptions: Array<{ value: string; label: string }> = [];
		const nextIdByValue: Record<string, number> = {};

		const ingestDictionaryEntries = (entries: DictionaryEntry[]) => {
			for (const entry of entries) {
				if (!entry.aktywny) {
					continue;
				}

				const fullValue = entry.nazwaPozycji.trim();
				const shortValue = String(entry.skrotPozycji ?? "").trim();
				if (!fullValue && !shortValue) {
					continue;
				}

				if (fullValue) {
					const fullLabel = shortenInsuranceEntityName(fullValue) || fullValue;
					dictionaryOptions.push({ value: fullValue, label: fullLabel });
					registerIdMapping(nextIdByValue, fullValue, entry.id);
					registerIdMapping(nextIdByValue, fullLabel, entry.id);

					// Keep short value as a mapping key, but do not add it as a separate
					// visible option to avoid duplicate labels in the dropdown.
					if (shortValue) {
						registerIdMapping(nextIdByValue, shortValue, entry.id);
					}
				} else if (shortValue) {
					dictionaryOptions.push({ value: shortValue, label: shortValue });
					registerIdMapping(nextIdByValue, shortValue, entry.id);
				}
			}
		};

		try {
			const [sanctionDictionaryResult, entitiesDictionaryResult] =
				await Promise.all([
					fetchDictionaryEntries("nazwy_podmiotow_sankcje"),
					fetchDictionaryEntries("nazwy_podmiotow"),
				]);

			if (sanctionDictionaryResult.ok) {
				ingestDictionaryEntries(sanctionDictionaryResult.data);
			}

			if (entitiesDictionaryResult.ok) {
				ingestDictionaryEntries(entitiesDictionaryResult.data);
			}
		} catch {
			// Intentionally ignored: API source can still provide usable options.
		}

		try {
			const searchParams = new URLSearchParams({
				includeHistorical: "true",
				limit: "1000",
				offset: "0",
			});

			let response = await fetch(
				`${SANCTION_ENTITY_OPTIONS_API_URL}?${searchParams.toString()}`,
				{
					method: "GET",
					headers: {
						"Content-Type": "application/json",
						"X-Operator-Login": operatorLogin,
					},
					cache: "no-store",
				},
			);

			if (response.status === 404) {
				response = await fetch(
					`${SANCTION_ENTITY_OPTIONS_ALIAS_API_URL}?${searchParams.toString()}`,
					{
						method: "GET",
						headers: {
							"Content-Type": "application/json",
							"X-Operator-Login": operatorLogin,
						},
						cache: "no-store",
					},
				);
			}

			if (!response.ok) {
				// Keep dictionary-based options when entity-options endpoint is unavailable.
			} else {
				const payload = (await response.json()) as
					| Array<{
							id?: unknown;
							value?: unknown;
							label?: unknown;
							source?: unknown;
							active?: unknown;
					  }>
					| {
							items?: Array<{
								id?: unknown;
								value?: unknown;
								label?: unknown;
								source?: unknown;
								active?: unknown;
							}>;
					  };

				const rawItems = Array.isArray(payload) ? payload : (payload.items ?? []);

				for (const item of rawItems) {
					const value = String(item.value ?? "").trim();
					if (!value) {
						continue;
					}

					const isActive =
						typeof item.active === "boolean" ? item.active : true;
					if (!isActive) {
						continue;
					}

					const label = String(item.label ?? "").trim() || value;
					apiOptions.push({ value, label });
					registerIdMapping(nextIdByValue, value, item.id);
					registerIdMapping(nextIdByValue, label, item.id);
				}
			}
		} catch {
			// Intentionally ignored: dictionary source can still provide usable options.
		}

		const mergedOptionsByValue = new Map<string, { value: string; label: string }>();
		for (const option of [...apiOptions, ...dictionaryOptions]) {
			if (!option.value.trim() || mergedOptionsByValue.has(option.value)) {
				continue;
			}

			mergedOptionsByValue.set(option.value, option);
		}

		setNazwaPodmiotuSankcjaOptions(
			Array.from(mergedOptionsByValue.values()).sort((left, right) =>
				left.label.localeCompare(right.label, "pl", {
					sensitivity: "base",
				}),
			),
		);
		setNazwaPodmiotuSankcjaIdByValue(nextIdByValue);
	};

	const handleAddSanctionEntityOption = async (rawValue: string) => {
		if (!canManageDictionaryEntries) {
			setFormError("Brak uprawnień do dodawania pozycji słownika.");
			return false;
		}

		const value = rawValue.trim();
		if (!value) {
			return false;
		}

		const existingId = Number(nazwaPodmiotuSankcjaIdByValue[value]);
		if (Number.isFinite(existingId) && existingId > 0) {
			return true;
		}

		const result = await createDictionaryEntry({
			operatorLogin,
			kodTypu: "nazwy_podmiotow_sankcje",
			form: {
				kodPozycji: "",
				nazwaPozycji: value,
				nazwaUzytkowa: "",
				skrotPozycji: "",
				aktywny: true,
				kierownikUserId: null,
				kolor: null,
				odcien: null,
				intensywnosc: null,
			},
		});

		if (!result.ok) {
			if (result.status === 409) {
				await loadSanctionEntityOptions();
				return true;
			}

			setFormError(result.error);
			return false;
		}

		const shortened = shortenInsuranceEntityName(value) || value;
		setNazwaPodmiotuSankcjaOptions((previous) => {
			if (previous.some((option) => option.value === value)) {
				return previous;
			}

			return [...previous, { value, label: shortened }].sort((left, right) =>
				left.label.localeCompare(right.label, "pl", {
					sensitivity: "base",
				}),
			);
		});

		if (Number.isFinite(result.entryId) && (result.entryId ?? 0) > 0) {
			setNazwaPodmiotuSankcjaIdByValue((previous) => ({
				...previous,
				[value]: result.entryId as number,
				[shortened]: result.entryId as number,
			}));
		} else {
			await loadSanctionEntityOptions();
		}

		return true;
	};

	useEffect(() => {
		void loadItems();
		void loadDictionaryOptions(
			"nazwy_podmiotow",
			setNazwaPodmiotuInspekcjaOptions,
			setNazwaPodmiotuInspekcjaIdByValue,
		);
		void loadSanctionEntityOptions();
		void loadDictionarySelectOptions(
			"department",
			setWniosekDoOptions,
			setWniosekDoIdByValue,
		);
		void loadDictionarySelectOptions(
			"sankcja",
			setSankcjaOptions,
			setSankcjaIdByValue,
		);
		void loadDictionarySelectOptions(
			"podstawa_prawna_sankcji",
			setPodstawaPrawnaOptions,
			setPodstawaPrawnaIdByValue,
		);
		void loadDictionarySelectOptions(
			"naruszenia_skutkujace_sankcja",
			setNaruszeniaOptions,
			setNaruszeniaIdByValue,
		);
		void loadDictionarySelectOptions(
			"informacja_o_wszczeciu_postepowania_sankcyjnego",
			setInformacjaOptions,
			setInformacjaIdByValue,
		);
		void loadDictionarySelectOptions(
			"rozstrzygniecie_wniosku_sankcyjnego_i",
			setRozstrzygniecieOptions,
			setRozstrzygniecieIdByValue,
		);
		void loadInspectionOptions();
	}, []);

	useEffect(() => {
		const areNumberListsEqual = (left: number[], right: number[]) => {
			if (left.length !== right.length) {
				return false;
			}

			for (let index = 0; index < left.length; index += 1) {
				if (left[index] !== right[index]) {
					return false;
				}
			}

			return true;
		};

		if (form.isInspectionMissing) {
			if (isInspectionTeamSelectionManual) {
				return;
			}

			setForm((prev) => {
				if (prev.inspectionTeamIds.length === 0) {
					return prev;
				}

				return {
					...prev,
					inspectionTeamIds: [],
				};
			});
			return;
		}

		if (!selectedInspectionOption) {
			setForm((prev) => {
				const nextInspectionTeamIds = isInspectionTeamSelectionManual
					? prev.inspectionTeamIds
					: [];

				const isNameUnchanged = prev.nazwaPodmiotuObjetegoInspekcja === "";
				const areTeamsUnchanged = areNumberListsEqual(
					prev.inspectionTeamIds,
					nextInspectionTeamIds,
				);

				if (isNameUnchanged && areTeamsUnchanged) {
					return prev;
				}

				return {
					...prev,
					nazwaPodmiotuObjetegoInspekcja: "",
					inspectionTeamIds: nextInspectionTeamIds,
				};
			});
			return;
		}

		setForm((prev) => {
			const nextEntityName = shortenInsuranceEntityName(
				selectedInspectionOption.nazwaPodmiotu,
			);
			const nextInspectionTeamIds = isInspectionTeamSelectionManual
				? prev.inspectionTeamIds
				: selectedInspectionOption.inspectionTeamIds.filter((teamId) =>
						validInspectionTeamIdSet.has(teamId),
					);

			const isNameUnchanged =
				prev.nazwaPodmiotuObjetegoInspekcja === nextEntityName;
			const areTeamsUnchanged = areNumberListsEqual(
				prev.inspectionTeamIds,
				nextInspectionTeamIds,
			);

			if (isNameUnchanged && areTeamsUnchanged) {
				return prev;
			}

			return {
				...prev,
				nazwaPodmiotuObjetegoInspekcja: nextEntityName,
				inspectionTeamIds: nextInspectionTeamIds,
			};
		});
	}, [
		form.isInspectionMissing,
		isInspectionTeamSelectionManual,
		selectedInspectionOption,
		validInspectionTeamIdSet,
	]);

	const openAdvancedFilterForColumn = (
		columnKey: SanctionRequestColumnKey,
		triggerElement: HTMLElement,
	) => {
		setAdvancedFilterAnchor(getFloatingPanelAnchor(triggerElement));
		setAdvancedFilterColumnKey(columnKey);
		setAdvancedFilterSearch("");
		setIsAdvancedFilterModalOpen(true);
	};

	const handleExportCurrentView = async (
		inspectionColumnKeys: InspectionExportColumnKey[],
		recommendationColumnKeys: RecommendationExportColumnKey[],
		decisionColumnKeys: DecisionExportColumnKey[],
		includeInspections: boolean,
		includeRecommendations: boolean,
		includeDecisions: boolean,
	) => {
		if (
			isExporting ||
			filteredAndSortedItems.length === 0 ||
			visibleSanctionRequestColumnDefinitions.length === 0
		) {
			return;
		}

		setIsExporting(true);
		setError(null);

		try {
			const workbook = await createStyledExportWorkbook(
				"Ewidencja wnioskow sankcyjnych",
			);

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
							.filter(
								(entry): entry is readonly [number, number] => entry !== null,
							),
					);
				} catch {
					return new Map<number, number>();
				}
			};

			const [
				inspectionsResponse,
				recommendationsResult,
				decisionsResult,
				recommendationsLpById,
			] = await Promise.all([
				fetch(INSPECTIONS_API_URL, {
					method: "GET",
					headers: {
						"Content-Type": "application/json",
						"X-Operator-Login": operatorLogin,
					},
					cache: "no-store",
				}),
				fetchRecommendations(operatorLogin, {
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

			const relatedRecommendationsSource = recommendationsResult.ok
				? recommendationsResult.data.items
				: [];
			const relatedDecisionsSource = decisionsResult.ok
				? decisionsResult.data.items
				: [];
			const relatedRecommendations = relatedRecommendationsSource.filter(
				(item) =>
					typeof item.inspectionId === "number" &&
					linkedInspectionIds.has(item.inspectionId),
			);

			const linkedRecommendationCodes = new Set(
				relatedRecommendations
					.map((item) =>
						String(item.kodZalecenia ?? "")
							.trim()
							.toUpperCase(),
					)
					.filter((value) => value.length > 0),
			);

			const relatedDecisions = relatedDecisionsSource.filter((item) => {
				const recommendationCode = String(item.recommendationKodZalecenia ?? "")
					.trim()
					.toUpperCase();

				return (
					recommendationCode.length > 0 &&
					linkedRecommendationCodes.has(recommendationCode)
				);
			});

			const relatedInspectionsForExport = mappedInspections.filter((row) =>
				linkedInspectionIds.has(Number(row.id)),
			);

			const inspectionCodeByIdForExport = new Map(
				relatedInspectionsForExport.map((row) => [
					Number(row.id),
					row.kodInspekcji,
				]),
			);

			const sanctionHeaders = visibleSanctionRequestColumnDefinitions.map(
				(column) => column.label,
			);
			const sanctionRows = filteredAndSortedItems.map((item) =>
				visibleSanctionRequestColumnDefinitions.map((column) =>
					getCellValue(item, column.key),
				),
			);

			addWorksheetWithStyles(
				workbook,
				"Wnioski sankcyjne",
				sanctionHeaders,
				sanctionRows,
			);

			if (includeInspections && inspectionColumnKeys.length > 0) {
				const inspectionHeaders = inspectionColumnKeys.map(
					(key) =>
						INSPECTION_EXPORT_COLUMNS.find((column) => column.key === key)
							?.label ?? key,
				);
				const inspectionRowsForExport = relatedInspectionsForExport.map((row) =>
					inspectionColumnKeys.map((key) => String(row[key] ?? "")),
				);
				addWorksheetWithStyles(
					workbook,
					"Inspekcje",
					inspectionHeaders,
					inspectionRowsForExport,
				);
			}

			if (includeRecommendations && recommendationColumnKeys.length > 0) {
				const recommendationHeaders = recommendationColumnKeys.map(
					(key) =>
						RECOMMENDATION_EXPORT_COLUMNS.find((column) => column.key === key)
							?.label ?? key,
				);
				const recommendationRows = relatedRecommendations.map((item) => {
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
										recommendationsLpById.get(inspectionId) ??
										"",
								)
							: "");

					return recommendationColumnKeys.map((key) => {
						switch (key) {
							case "lp":
								return String(item.lp);
							case "kodZalecenia":
								return String(item.kodZalecenia ?? "").trim();
							case "inspectionLp":
								return inspectionCode;
							case "nazwaPodmiotu":
								return item.nazwaPodmiotu;
							case "pozycja":
								return String(item.pozycja);
							case "terminWykonaniaZalecen":
								return item.terminWykonaniaZalecen ?? "";
							case "dataZalecenList":
								return item.dataZalecenList.join("; ");
							case "dataAkceptacjiNotyWeryfikacjiList":
								return item.dataAkceptacjiNotyWeryfikacjiList.join("; ");
							case "status":
								return item.status ?? "";
							case "komentarz":
								return item.komentarz ?? "";
						}
					});
				});
				addWorksheetWithStyles(
					workbook,
					"Zalecenia",
					recommendationHeaders,
					recommendationRows,
				);
			}

			if (includeDecisions && decisionColumnKeys.length > 0) {
				const decisionHeaders = decisionColumnKeys.map(
					(key) =>
						DECISION_EXPORT_COLUMNS.find((column) => column.key === key)
							?.label ?? key,
				);
				const decisionRows = relatedDecisions.map((item, index) =>
					decisionColumnKeys.map((key) => {
						const recommendationCode = String(
							item.recommendationKodZalecenia ?? "",
						)
							.trim()
							.toUpperCase();
						switch (key) {
							case "lp":
								return String(index + 1);
							case "kodDecyzji":
								return item.kodDecyzji ?? "";
							case "kodZalecenia":
								return recommendationCode;
							case "inspectionLp": {
								const relatedRecommendation = relatedRecommendations.find(
									(recommendation) =>
										String(recommendation.kodZalecenia ?? "")
											.trim()
											.toUpperCase() === recommendationCode,
								);
								if (!relatedRecommendation) {
									return "";
								}

								const inspectionId = relatedRecommendation.inspectionId ?? null;
								return (
									resolveInspectionCode({
										inspectionKod: relatedRecommendation.inspectionKod,
										kodInspekcji: relatedRecommendation.kodInspekcji,
										inspectionLp: relatedRecommendation.inspectionLp,
										inspectionId,
									}) ||
									(typeof inspectionId === "number"
										? String(
												inspectionCodeByIdForExport.get(inspectionId) ??
													recommendationsLpById.get(inspectionId) ??
													"",
											)
										: "")
								);
							}
							case "nazwaPodmiotu":
								return item.nazwaPodmiotu ?? "";
							case "liczbaZalecen":
								return item.liczbaZalecen === null
									? ""
									: String(item.liczbaZalecen);
							case "dataWszczeciaPostepowaniaIInstancji":
								return item.dataWszczeciaPostepowaniaIInstancji ?? "";
							case "osobyProwadzaceIInstancjeList":
								return (item.osobyProwadzaceIInstancjeList ?? []).join("; ");
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
								return (item.osobyProwadzaceIIInstancjeList ?? []).join("; ");
							case "dataDecyzjiIIInstancji":
								return item.dataDecyzjiIIInstancji ?? "";
							case "dataDoreczeniaDecyzjiIIInstancji":
								return item.dataDoreczeniaDecyzjiIIInstancji ?? "";
							case "rozstrzygniecieII":
								return item.rozstrzygniecieII ?? "";
							case "komentarz":
								return item.komentarz ?? "";
						}
					}),
				);
				addWorksheetWithStyles(
					workbook,
					"Decyzje zobowiązujące",
					decisionHeaders,
					decisionRows,
				);
			}

			const fileName = "wnioski-sankcyjne-inspekcje-zalecenia-decyzje.xlsx";
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
		setIncludeRecommendationsInExport(false);
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

			return INSPECTION_EXPORT_COLUMNS.map((column) => column.key).filter(
				(key) => nextSet.has(key),
			);
		});
	};

	const toggleRecommendationExportColumn = (
		columnKey: RecommendationExportColumnKey,
		isSelected: boolean,
	) => {
		setSelectedRecommendationExportColumns((prev) => {
			const nextSet = new Set(prev);
			if (isSelected) {
				nextSet.add(columnKey);
			} else {
				if (prev.length <= 1) {
					return prev;
				}
				nextSet.delete(columnKey);
			}

			return RECOMMENDATION_EXPORT_COLUMNS.map((column) => column.key).filter(
				(key) => nextSet.has(key),
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
			(includeInspectionsInExport &&
				selectedInspectionExportColumns.length === 0) ||
			(includeRecommendationsInExport &&
				selectedRecommendationExportColumns.length === 0) ||
			(includeDecisionsInExport && selectedDecisionExportColumns.length === 0)
		) {
			return;
		}

		const orderedInspectionColumns = INSPECTION_EXPORT_COLUMNS.map(
			(column) => column.key,
		).filter((key) => selectedInspectionExportColumns.includes(key));

		const orderedRecommendationColumns = RECOMMENDATION_EXPORT_COLUMNS.map(
			(column) => column.key,
		).filter((key) => selectedRecommendationExportColumns.includes(key));

		const orderedDecisionColumns = DECISION_EXPORT_COLUMNS.map(
			(column) => column.key,
		).filter((key) => selectedDecisionExportColumns.includes(key));

		setIsExportConfigModalOpen(false);
		void handleExportCurrentView(
			orderedInspectionColumns,
			orderedRecommendationColumns,
			orderedDecisionColumns,
			includeInspectionsInExport,
			includeRecommendationsInExport,
			includeDecisionsInExport,
		);
	};

	const openCreateModal = async () => {
		if (!canManageSanctionRequests) {
			setError("Konto zewnętrzne ma dostęp tylko do odczytu.");
			return;
		}

		setEditingItem(null);
		setForm(EMPTY_FORM);
		setFormError(null);
		setShowRequiredFieldErrors(false);
		setVersionConflictUpdatedAt(null);
		setSaveLockConflict(null);
		setIsInspectionTeamSelectionManual(false);
		setIsFormOpen(true);
		await loadInspectionOptions();
	};

	const openEditModal = async () => {
		if (!canManageSanctionRequests) {
			setError("Konto zewnętrzne ma dostęp tylko do odczytu.");
			return;
		}

		if (!selectedItem || !selectedItem.canEdit) {
			return;
		}

		try {
			setEditingItem(selectedItem);
			setForm(requestToForm(selectedItem));
			setFormError(null);
			setShowRequiredFieldErrors(false);
			setVersionConflictUpdatedAt(null);
			setSaveLockConflict(null);
			setIsInspectionTeamSelectionManual(
				parseNumericIdList(selectedItem.inspectionTeamIds).length > 0,
			);
			setIsFormOpen(true);
			await loadInspectionOptions();
		} catch (error) {
			console.error("[sanction-requests] openEditModal failed", {
				error,
				selectedItem,
			});
			setIsFormOpen(false);
			setEditingItem(null);
			setFormError(
				"Nie udało się otworzyć formularza edycji. Odśwież dane i spróbuj ponownie.",
			);
		}
	};

	const closeModal = () => {
		if (editRecordLock.lockToken) {
			void editRecordLock.release();
		}

		setIsFormOpen(false);
		setEditingItem(null);
		setFormError(null);
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

		const result = await fetchSanctionRequests(operatorLogin, {
			sortBy: "dataWniosku",
			sortOrder: "desc",
		});
		if (!result.ok) {
			setFormError(result.error);
			return;
		}

		setItems(result.data.items);
		setTotal(result.data.total);
		const refreshed = result.data.items.find(
			(item) => item.id === editingItem.id,
		);
		if (!refreshed) {
			closeModal();
			return;
		}

		setEditingItem(refreshed);
		setForm(requestToForm(refreshed));
		setFormError(null);
		setVersionConflictUpdatedAt(null);
		setSaveLockConflict(null);
		setIsInspectionTeamSelectionManual(
			parseNumericIdList(refreshed.inspectionTeamIds).length > 0,
		);
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

		const deletedEntityName =
			selectedItem.nazwaPodmiotuObjetegoInspekcja?.trim() ||
			selectedItem.nazwaPodmiotuObjetegoSankcjaList[0]?.trim() ||
			"";

		setIsDeletingItem(true);
		setError(null);

		const result = await deleteSanctionRequest(operatorLogin, selectedItem.id);
		if (!result.ok) {
			setError(result.error);
			setIsDeletingItem(false);
			return;
		}

		setIsDeleteConfirmModalOpen(false);
		setSelectedId(null);
		await loadItems();
		setDeleteSuccessEntityName(deletedEntityName);
		setIsDeleteSuccessModalOpen(true);
		setIsDeletingItem(false);
	};

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!canManageSanctionRequests) {
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
		const isRequiredInspectionMissing =
			!form.isInspectionMissing && !form.inspectionId.trim();
		const hasMissingRequiredFields = isRequiredInspectionMissing;

		setShowRequiredFieldErrors(true);

		if (hasMissingRequiredFields) {
			setFormError(null);
			return;
		}

		const payload = formToPayload(
			form,
			{
				nazwaPodmiotuObjetegoInspekcjaIdByValue:
					nazwaPodmiotuInspekcjaIdByValue,
				nazwaPodmiotuObjetegoSankcjaIdByValue: nazwaPodmiotuSankcjaIdByValue,
				wniosekDoIdByValue,
				sankcjaIdByValue,
				podstawaPrawnaIdByValue,
				naruszeniaIdByValue,
				informacjaIdByValue,
				rozstrzygniecieIdByValue,
			},
			validInspectionTeamIdSet,
			wasEditing ? "update" : "create",
			editingItem,
		);
		if (!payload) {
			console.error("[SanctionRequests] Submit blocked - invalid dictionary mapping", {
				mode: wasEditing ? "update" : "create",
				form,
				idMaps: {
					nazwaPodmiotuObjetegoInspekcjaIdByValue:
						nazwaPodmiotuInspekcjaIdByValue,
					nazwaPodmiotuObjetegoSankcjaIdByValue:
						nazwaPodmiotuSankcjaIdByValue,
					wniosekDoIdByValue,
					sankcjaIdByValue,
					podstawaPrawnaIdByValue,
					naruszeniaIdByValue,
					informacjaIdByValue,
					rozstrzygniecieIdByValue,
				},
			});
			setFormError(
				"Wprowadź poprawne dane słownikowe: brak wymaganego wyboru lub nieprawidłowe mapowanie wartości do ID.",
			);
			return;
		}

		console.info("[SanctionRequests] Submit payload", {
			mode: wasEditing ? "update" : "create",
			payload,
		});

		setShowRequiredFieldErrors(false);

		if (editingItem) {
			const basePayload = formToPayload(
				requestToForm(editingItem),
				{
					nazwaPodmiotuObjetegoInspekcjaIdByValue:
						nazwaPodmiotuInspekcjaIdByValue,
					nazwaPodmiotuObjetegoSankcjaIdByValue:
						nazwaPodmiotuSankcjaIdByValue,
					wniosekDoIdByValue,
					sankcjaIdByValue,
					podstawaPrawnaIdByValue,
					naruszeniaIdByValue,
					informacjaIdByValue,
					rozstrzygniecieIdByValue,
				},
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
				? await updateSanctionRequest(operatorLogin, editingItem.id, payload, {
						expectedUpdatedAt: editingItem.zaktualizowanoO,
						lockToken: editRecordLock.lockToken,
					})
				: await createSanctionRequest(operatorLogin, payload);

			if (!result.ok) {
				if (result.status === 422) {
					const normalizedErrorCode = String(result.errorCode ?? "")
						.trim()
						.toUpperCase();

					if (normalizedErrorCode === "MISSING_DICTIONARY_ID") {
						setFormError("Brak wymaganego wyboru słownika.");
						return;
					}

					if (normalizedErrorCode === "UNKNOWN_DICTIONARY_ID") {
						setFormError("Nieprawidłowa lub nieaktualna wartość słownika.");
						return;
					}

					if (normalizedErrorCode === "EXTRA_FORBIDDEN") {
						setFormError("Klient wysyła nieobsługiwane pole.");
						return;
					}
				}

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
					setVersionConflictUpdatedAt(result.currentUpdatedAt ?? null);
					setFormError(
						"Dane zostały zmienione przez innego użytkownika. Odśwież widok i spróbuj ponownie.",
					);
					return;
				}

				setFormError(result.error);
				return;
			}

			closeModal();
			await loadItems();
			setSelectedId(result.data.id);
			setSuccessEntityName(
				form.nazwaPodmiotuObjetegoInspekcja.trim() ||
					shortenInsuranceEntityName(
						selectedInspectionOption?.nazwaPodmiotu ?? "",
					) ||
					form.nazwaPodmiotuObjetegoSankcjaList[0] ||
					"",
			);
			setSuccessInspectionCode(
				resolveInspectionCode({
					inspectionKod: result.data.inspectionKod,
					kodInspekcji: result.data.kodInspekcji,
					inspectionLp: result.data.inspectionLp,
					inspectionId: result.data.inspectionId,
				}) ||
					selectedInspectionOption?.inspectionCode ||
					"",
			);
			setSuccessMode(wasEditing ? "edit" : "create");
			setIsSuccessModalOpen(true);
		} catch {
			setFormError("Nie udało się zapisać wniosku sankcyjnego.");
		} finally {
			setIsSubmitting(false);
		}
	};

	const isRequiredInspectionMissing =
		showRequiredFieldErrors && !form.isInspectionMissing && !form.inspectionId.trim();

	return (
		<>
			<TableFullscreenContainer
				isFullscreen={isFullscreen}
				onClose={() => setIsFullscreen(false)}
				className="relative flex h-full min-h-0 w-full flex-col rounded-2xl border border-slate-700/70 bg-[#101f39] px-2 pt-4 pb-2 sm:px-2 sm:pt-5 sm:pb-2"
			>
				{!isFullscreen ? (
			<TablePanelToolbar
				title="Wnioski sankcyjne"
				canClearFilters={canClearFilters}
				canResetColumnWidths={hasCustomColumnWidths}
				isExporting={isExporting}
				hasRowsToExport={
					filteredAndSortedItems.length > 0 &&
					visibleSanctionRequestColumnDefinitions.length > 0
				}
				onOpenViewModal={handleOpenSanctionViewModal}
				isFullscreen={isFullscreen}
				onToggleFullscreen={() => setIsFullscreen((prev) => !prev)}
				onClearFilters={clearFilters}
				onResetColumnWidths={handleResetColumnWidths}
				onExport={handleOpenExportConfigModal}
				actions={
					<>
						{canManageSanctionRequests ? (
							<>
								<button
									type="button"
									onClick={() => void openCreateModal()}
									className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#8ec5a1] bg-[#b9e8c9] px-3.5 font-semibold text-[#1f5130] text-sm transition-colors hover:bg-[#a5debb]"
								>
									<Plus size={15} />
									Dodaj wniosek
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

			<TableSurface
				isLoading={isLoading}
				containerClassName="-mt-1 flex h-full min-h-0 flex-1 flex-col"
				scrollAreaClassName="min-h-0 flex-1"
				footer={
					<TablePagination
						currentPage={currentPage}
						totalPages={totalPages}
						paginationItems={paginationItems}
						totalItems={filteredAndSortedItems.length}
						pageSize={pageSize}
						onPageChange={handlePageChange}
						pageSizeOptions={[...TABLE_PAGE_SIZE_OPTIONS]}
						onPageSizeChange={handlePageSizeChange}
						showWhenSinglePage
					/>
				}
			>
				<table className="min-w-420 border-collapse text-slate-900 text-sm">
					<TableHeaderWithFilters
						visibleColumns={visibleSanctionRequestColumnDefinitions.map(
							(column) => ({
								...column,
								tooltip:
									column.key === "lp"
										? undefined
										: (SANCTION_REQUEST_COLUMN_TOOLTIPS[column.key] ??
											column.label.replace(/\s*\n\s*/g, " ")),
							}),
						)}
						sortColumnKey={sortColumnKey}
						sortDirection={sortDirection}
						advancedFilters={advancedFilters}
						columnFilters={columnFilters}
						onSortByColumn={handleSortByColumn}
						onOpenAdvancedFilter={openAdvancedFilterForColumn}
						onFilterChange={handleFilterChange}
						columnWidths={columnWidths}
						onResizeColumn={handleResizeColumn}
						minColumnWidth={SANCTION_REQUESTS_MIN_COLUMN_WIDTH}
						controlsInFilterRow
						wrapHeaderLabels
						truncateWrappedHeaderLabels={false}
					/>
					<tbody>
						{paginatedSanctionRequestItems.map((item) => {
							const isSelected = selectedId === item.id;
							return (
								<tr
									key={item.id}
									onClick={() => setSelectedId(item.id)}
									className={`cursor-pointer border-slate-200 border-b transition-[filter,background-color] hover:drop-shadow-[0_2px_6px_rgba(15,23,42,0.14)] last:border-b-0 ${
										isSelected
											? "bg-blue-100 text-slate-900 ring-1 ring-blue-300 ring-inset"
											: "bg-white text-slate-900 hover:bg-slate-50"
									}`}
								>
									{visibleSanctionRequestColumnDefinitions.map((column) => {
										const rawValue = getCellValue(item, column.key) || "-";
										const value = formatDatesInDisplayText(rawValue);
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
										const isListColumn =
											column.key === "nazwaPodmiotuObjetegoSankcjaList" ||
											column.key === "sankcjaList" ||
											column.key === "podstawaPrawnaSankcjiList" ||
											column.key === "naruszeniaSkutkujaceSankcjaList" ||
											column.key === "zespol";
										const isScrollableTextColumn =
											column.key === "czyMamyInformacjeOWszczeciuPostepowania" ||
											column.key === "komentarz";
										const rawListValues =
											column.key === "nazwaPodmiotuObjetegoSankcjaList"
												? item.nazwaPodmiotuObjetegoSankcjaList
												: column.key === "sankcjaList"
													? item.sankcjaList
													: column.key === "podstawaPrawnaSankcjiList"
														? item.podstawaPrawnaSankcjiList
														: column.key === "naruszeniaSkutkujaceSankcjaList"
															? item.naruszeniaSkutkujaceSankcjaList
															: column.key === "zespol"
																? parseNumericIdList(item.inspectionTeamIds).map(
																	(teamId) =>
																		inspectionTeamLabelById.get(teamId) ?? `ID: ${teamId}`,
																)
															: [];
										const stackedLineValues = isListColumn
											? rawListValues.filter((entry: string) => entry.trim().length > 0)
											: [];
										const shouldShowScrollableList =
											isListColumn && stackedLineValues.length > 0;
										const shouldRenderOrderedList =
											column.key === "zespol"
												? stackedLineValues.length > 0
												: stackedLineValues.length > 1;
										const shouldShowScrollableText =
											isScrollableTextColumn && value !== "-";
										const cellTooltipValue = value !== "-" ? value : undefined;

										return (
											<td
												key={column.key}
												className="whitespace-normal break-words px-3 py-2.5 align-top"
											>
												{shouldShowScrollableList ? (
													<div
														className="subtle-vertical-scroll w-full overflow-y-auto pr-1"
														style={{ maxHeight: `${SANCTION_REQUESTS_MAX_ROW_HEIGHT_PX}px` }}
														title={stackedLineValues.join("\n") || undefined}
													>
														{shouldRenderOrderedList ? (
															<ol className="list-inside list-decimal space-y-1 pl-1">
																{stackedLineValues.map((entry: string, index: number) => (
																	<li key={`${column.key}-${item.id}-${index}`}>{entry}</li>
																))}
															</ol>
														) : (
															<div>{stackedLineValues[0]}</div>
														)}
													</div>
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
														{value}
													</button>
												) : shouldShowScrollableText ? (
													<div
														className="subtle-vertical-scroll w-full overflow-y-auto pr-1 whitespace-normal break-words leading-5"
														style={{ maxHeight: `${SANCTION_REQUESTS_MAX_ROW_HEIGHT_PX}px` }}
														title={cellTooltipValue}
													>
														{value}
													</div>
												) : (
													<div
														className="subtle-vertical-scroll w-full overflow-y-auto pr-1 whitespace-normal break-words leading-5"
														style={{ maxHeight: `${SANCTION_REQUESTS_MAX_ROW_HEIGHT_PX}px` }}
														title={cellTooltipValue}
													>
														{value}
													</div>
												)}
											</td>
										);
									})}
								</tr>
							);
						})}

						{!isLoading && filteredAndSortedItems.length === 0 ? (
							<tr>
								<td
									colSpan={visibleSanctionRequestColumnDefinitions.length}
									className="px-3 py-6 text-center text-slate-500 text-sm"
								>
									Brak rekordów. Łącznie: {total}.
								</td>
							</tr>
						) : null}
					</tbody>
				</table>
			</TableSurface>

			<ExportConfigModal
				isOpen={isExportConfigModalOpen}
				description="Wnioski sankcyjne eksportują aktualny widok tabeli. Wybierz dane powiązane."
				relationsLabel="Powiąż wybrane wnioski sankcyjne z:"
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
						id: "recommendations",
						label: "Zalecenia",
						enabled: includeRecommendationsInExport,
						selectedCount: selectedRecommendationExportColumns.length,
						onToggle: () => {
							setIncludeRecommendationsInExport((prev) => {
								const next = !prev;
								if (next) {
									setActiveExportColumnsTab("recommendations");
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
						id: "recommendations",
						label: "Zalecenia",
						columns: RECOMMENDATION_EXPORT_COLUMNS.map((column) => ({
							key: column.key,
							label: column.label,
						})),
						selectedKeys: selectedRecommendationExportColumns,
						onToggleKey: (key, isSelected) =>
							toggleRecommendationExportColumn(
								key as RecommendationExportColumnKey,
								isSelected,
							),
						onSelectAll: () =>
							setSelectedRecommendationExportColumns(
								RECOMMENDATION_EXPORT_COLUMNS.map((column) => column.key),
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
							toggleDecisionExportColumn(
								key as DecisionExportColumnKey,
								isSelected,
							),
						onSelectAll: () =>
							setSelectedDecisionExportColumns(
								DECISION_EXPORT_COLUMNS.map((column) => column.key),
							),
					},
				]}
				activeTabId={activeExportColumnsTab}
				onActiveTabChange={(tabId) =>
					setActiveExportColumnsTab(
						tabId as "inspections" | "recommendations" | "decisions",
					)
				}
				onClose={() => setIsExportConfigModalOpen(false)}
				onConfirm={handleConfirmExportFromModal}
				isConfirmDisabled={
					isExporting ||
					(includeInspectionsInExport &&
						selectedInspectionExportColumns.length === 0) ||
					(includeRecommendationsInExport &&
						selectedRecommendationExportColumns.length === 0) ||
					(includeDecisionsInExport &&
						selectedDecisionExportColumns.length === 0)
				}
				isExporting={isExporting}
			/>

			<TableAdvancedFilterModal
				isOpen={isAdvancedFilterModalOpen}
				anchor={advancedFilterAnchor}
				columnLabel={
					SANCTION_REQUEST_COLUMNS.find(
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

			<TableColumnPickerModal<SanctionRequestColumnKey, never>
				isOpen={isColumnPickerOpen}
				columns={SANCTION_REQUEST_COLUMNS}
				hiddenColumns={draftHiddenColumns}
				visibleColumnsCount={draftVisibleSanctionRequestColumns.length}
				onClose={() => setIsColumnPickerOpen(false)}
				onChangeColumnVisibility={handleDraftColumnVisibilityChange}
				onChangeColumnDisplayMode={(columnKey, value) => {
					if (!isSanctionShortNameColumnKey(columnKey)) {
						return;
					}

					if (value !== "full" && value !== "short") {
						return;
					}

					setDraftSanctionShortNameVariants((prev) => {
						const next = {
							...prev,
							[columnKey]: value,
						};

						// Persist name variant changes immediately, even before applying column visibility changes.
						setSanctionShortNameVariants(next);

						return next;
					});
				}}
				columnDisplayModeOptions={columnDisplayModeOptionsByKey}
				columnDisplayModeValues={draftColumnDisplayModeValuesByKey}
				onResetSelection={handleResetSanctionViewSelection}
				onShowAllColumns={handleDraftSelectAllColumns}
				onHideAllColumns={handleDraftDeselectAllColumns}
				onApply={handleApplySanctionViewChanges}
				title="Widok tabeli"
			/>

			<RegistryFormScaffold
				isOpen={isFormOpen}
				title={editingItem ? "Edytuj wniosek sankcyjny" : "Dodaj wniosek sankcyjny"}
				subtitle={
					editingItem
						? `Id wniosku: ${editingItem.kodSankcji} | Utworzone przez: ${
							(editingItem.createdByDisplayName ?? editingItem.createdByLogin ?? "").trim() ||
							"-"
						}`
						: undefined
				}
				onClose={closeModal}
				onSubmit={(event) => void handleSubmit(event)}
				isContentReadOnly={isReadOnlyDueToLock}
				maxWidthClassName="max-w-5xl"
				closeOnBackdropClick={false}
				headerNotices={
					<>
						{inactivityTimeout.isWarning ? (
							<div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 text-sm">
								<p className="font-semibold">
									Nie wykryto aktywności. Formularz zostanie zamknięty za{" "}
									<span className="tabular-nums">
										{inactivityTimeout.secondsRemaining}
									</span>{" "}
									s.
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
									Nie możesz teraz edytować tego wpisu, ponieważ jest
									edytowany przez innego użytkownika.
								</p>
								<p className="mt-1">
									Rekord edytuje teraz: {lockOwnerLabel}, od{" "}
									{formatLockStartHourMinute(lockAcquiredAt)}.
								</p>
							</div>
						) : null}

						{isEditMode && editRecordLock.isConnectionLost ? (
							<p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 font-medium text-amber-800 text-sm">
								{editRecordLock.error ??
									"Utracono połączenie z serwerem — trwa próba odnowienia blokady..."}
							</p>
						) : null}

						{isEditMode && editRecordLock.isExpired ? (
							<p className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 font-medium text-rose-800 text-sm">
								{editRecordLock.error ??
									"Czas edycji wygasł — połączenie zostało przerwane zbyt długo. Zamknij formularz i otwórz ponownie."}
							</p>
						) : null}

						{isEditMode && editRecordLock.isAcquireFailed ? (
							<div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800 text-sm">
								<p className="font-medium">
									{editRecordLock.error ??
										"Nie udało się założyć blokady rekordu."}
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
									<div className="text-sm text-slate-700">
										<SingleSelectPortalField
											label="Powiązanie z inspekcją *"
											value={form.inspectionId}
											options={resolvedInspectionSelectOptions}
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
													nazwaPodmiotuObjetegoInspekcja:
														shortenInsuranceEntityName(
															selectedOption?.nazwaPodmiotu ?? "",
														) ||
														prev.nazwaPodmiotuObjetegoInspekcja,
													inspectionTeamIds:
														!isInspectionTeamSelectionManual && selectedOption
															? selectedOption.inspectionTeamIds.filter((teamId) =>
																	validInspectionTeamIdSet.has(teamId),
															  )
															: prev.inspectionTeamIds,
												}));
											}}
											disabled={
												isReadOnlyDueToLock ||
												form.isInspectionMissing ||
												isInspectionOptionsLoading
											}
										/>
										<label className="mt-2 inline-flex items-center gap-2 font-medium text-slate-700 text-xs">
											<input
												type="checkbox"
												checked={form.isInspectionMissing}
												disabled={isReadOnlyDueToLock}
												onChange={(event) => {
													const checked = event.target.checked;
													setForm((prev) => ({
														...prev,
														isInspectionMissing: checked,
														inspectionId: checked ? "" : prev.inspectionId,
														inspectionTeamIds: checked ? [] : prev.inspectionTeamIds,
														nazwaPodmiotuObjetegoInspekcja: checked
															? ""
															: prev.nazwaPodmiotuObjetegoInspekcja,
													}));
													if (checked) {
														setIsInspectionTeamSelectionManual(false);
													}
												}}
											/>
											Brak powiązania z kodem inspekcji
										</label>
										</div>

									{form.isInspectionMissing ? (
										<SingleSelectPortalField
											label="Nazwa podmiotu objętego inspekcją"
											options={nazwaPodmiotuInspekcjaOptions}
											value={form.nazwaPodmiotuObjetegoInspekcja}
											onChange={(next) =>
												setForm((prev) => ({
													...prev,
													nazwaPodmiotuObjetegoInspekcja: next,
												}))
											}
											placeholder="Wybierz podmiot"
											enableSearch
											searchPlaceholder="Wyszukaj podmiot..."
											disabled={isReadOnlyDueToLock}
										/>
									) : (
										<label className="text-sm text-slate-700">
											<span className="mb-1 block">
												Nazwa podmiotu objętego inspekcją
											</span>
											<input
												value={form.nazwaPodmiotuObjetegoInspekcja}
												onChange={(event) =>
													setForm((prev) => ({
														...prev,
														nazwaPodmiotuObjetegoInspekcja: event.target.value,
													}))
												}
												disabled
												className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-700"
											/>
										</label>
									)}

									<div className="sm:col-span-2">
										<MultiSelectField
											label="Zespół"
											options={inspectionTeamSelectOptions}
											values={form.inspectionTeamIds.map((value) => String(value))}
											enableSearch
											searchPlaceholder="Wyszukaj zespół..."
											disabled={isReadOnlyDueToLock}
											onChange={(next) => {
												setIsInspectionTeamSelectionManual(true);
												setForm((prev) => ({
													...prev,
													inspectionTeamIds: parseNumericIdList(next).filter((teamId) =>
														validInspectionTeamIdSet.has(teamId),
													),
												}));
											}}
										/>
									</div>

									<MultiSelectField
										label="Nazwa podmiotu objętego sankcją"
										options={resolvedNazwaPodmiotuSankcjaSelectOptions}
										values={form.nazwaPodmiotuObjetegoSankcjaList}
										enableSearch
										searchPlaceholder="Wyszukaj podmiot objęty sankcją..."
										disabled={isReadOnlyDueToLock}
										allowCustomValue={canManageDictionaryEntries}
										onAddCustomValue={handleAddSanctionEntityOption}
										customAddLabel="Dodaj pozycję słownika"
										onChange={(next) =>
											setForm((prev) => ({
												...prev,
												nazwaPodmiotuObjetegoSankcjaList: next,
											}))
										}
									/>

									<DateInputWithCalendar
										label="Data wniosku"
										value={form.dataWniosku}
										onChange={(next) =>
											setForm((prev) => ({
												...prev,
												dataWniosku: next,
											}))
										}
										disabled={isReadOnlyDueToLock}
									/>

									<SingleSelectPortalField
										label="Wniosek do"
										options={wniosekDoOptions}
										value={form.wniosekDo}
										placeholder="Wybierz"
										onChange={(next) =>
											setForm((prev) => ({ ...prev, wniosekDo: next }))
										}
										disabled={isReadOnlyDueToLock}
									/>

									<MultiSelectField
										label="Sankcja"
										options={sankcjaOptionsFull}
										values={form.sankcjaList}
										disabled={isReadOnlyDueToLock}
										onChange={(next) =>
											setForm((prev) => ({ ...prev, sankcjaList: next }))
										}
									/>

									<MultiSelectField
										label="Podstawa prawna sankcji"
										options={podstawaPrawnaOptionsFull}
										values={form.podstawaPrawnaSankcjiList}
										disabled={isReadOnlyDueToLock}
										onChange={(next) =>
											setForm((prev) => ({
												...prev,
												podstawaPrawnaSankcjiList: next,
											}))
										}
									/>

									<MultiSelectField
										label="Naruszenia skutkujące sankcją"
										options={naruszeniaOptionsFull}
										values={form.naruszeniaSkutkujaceSankcjaList}
										disabled={isReadOnlyDueToLock}
										onChange={(next) =>
											setForm((prev) => ({
												...prev,
												naruszeniaSkutkujaceSankcjaList: next,
											}))
										}
									/>

									<SingleSelectPortalField
										label="Informacja o wszczęciu postępowania"
										options={informacjaOptionsFull}
										value={form.czyMamyInformacjeOWszczeciuPostepowania}
										placeholder="Wybierz"
										onChange={(next) =>
											setForm((prev) => ({
												...prev,
												czyMamyInformacjeOWszczeciuPostepowania: next,
											}))
										}
										disabled={isReadOnlyDueToLock}
									/>

									<SingleSelectPortalField
										label="Rozstrzygnięcie"
										options={rozstrzygniecieOptionsFull}
										value={form.rozstrzygniecie}
										placeholder="Wybierz"
										onChange={(next) =>
											setForm((prev) => ({ ...prev, rozstrzygniecie: next }))
										}
										disabled={isReadOnlyDueToLock}
									/>

									<label className="text-sm text-slate-700 sm:col-span-2">
										<span className="mb-1 block">Komentarz</span>
										<textarea
											rows={2}
											value={form.komentarz}
											disabled={isReadOnlyDueToLock}
											onChange={(event) =>
												setForm((prev) => ({
													...prev,
													komentarz: event.target.value,
												}))
											}
											className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-700"
										/>
									</label>
				</div>
			</RegistryFormScaffold>

			<SanctionRequestsSuccessModal
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
				heading="Wniosek sankcyjny został usunięty"
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
						aria-label="Zamknij potwierdzenie usunięcia wniosku sankcyjnego"
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
						aria-label="Potwierdzenie usunięcia wniosku sankcyjnego"
						className="relative z-10 w-full max-w-lg rounded-2xl border border-slate-300 bg-white p-5 text-slate-900 shadow-[0_24px_56px_rgba(2,8,23,0.35)]"
					>
						<h3 className="font-semibold text-base text-slate-900">
							Usuń wniosek sankcyjny
						</h3>
						<p className="mt-2 text-slate-700 text-sm">
							Czy usunąć wniosek sankcyjny?
						</p>

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
