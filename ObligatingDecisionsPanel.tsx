"use client";

import {
	CalendarDays,
	ChevronDown,
	CircleAlert,
	Pencil,
	Plus,
	Trash2,
} from "lucide-react";
import { DateCalendar } from "@mui/x-date-pickers/DateCalendar";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { pl } from "date-fns/locale";
import type { AuthRole } from "@/app/_components/home-tabs/types";

import { fetchDictionaryEntries } from "@/features/dictionaries/api";
import type { DictionaryEntry } from "@/features/dictionaries/types";
import {
	type RawInspectionRow,
	normalizeInspectionRow,
} from "@/features/inspections/components/inspections-panel.utils";
import {
	createObligatingDecision,
	deleteObligatingDecision,
	fetchAvailableFirstInstancePeople,
	fetchAvailableRecommendations,
	fetchAvailableSecondInstancePeople,
	fetchObligatingDecisions,
	type ObligatingDecisionLockConflict,
	updateObligatingDecision,
} from "@/features/obligating-decisions/api";
import { ObligatingDecisionsSuccessModal } from "@/features/obligating-decisions/components/ObligatingDecisionsSuccessModal";
import type {
	AvailableRecommendation,
	ObligatingDecisionRead,
	ObligatingDecisionWrite,
} from "@/features/obligating-decisions/types";
import { fetchRecommendations } from "@/features/recommendations/api";
import { fetchSanctionRequests } from "@/features/sanction-requests/api";
import { RegistryFormScaffold } from "@/shared/components/forms/RegistryFormScaffold";
import { SingleSelectPortalField } from "@/shared/components/forms/SingleSelectPortalField";
import { ExportConfigModal } from "@/shared/components/export/ExportConfigModal";
import { RegistryDataTable } from "@/shared/components/table/RegistryDataTable";
import { TableAdvancedFilterModal } from "@/shared/components/table/TableAdvancedFilterModal";
import { TableColumnPickerModal } from "@/shared/components/table/TableColumnPickerModal";
import { TableFullscreenContainer } from "@/shared/components/table/TableFullscreenContainer";
import { TablePanelToolbar } from "@/shared/components/table/TablePanelToolbar";
import { TablePagination } from "@/shared/components/table/TablePagination";
import { useInactivityTimeout } from "@/shared/hooks/useInactivityTimeout";
import { useTableState } from "@/shared/hooks/useTableState";
import {
	addWorksheetWithStyles,
	createStyledExportWorkbook,
	saveWorkbookAsXlsx,
} from "@/shared/utils/excel-export";
import { useRecordLock } from "@/shared/hooks/useRecordLock";
import { getFloatingPanelAnchor } from "@/shared/utils/floating-panel";
import { formatDatesInDisplayText } from "@/shared/utils/date";

const INACTIVITY_TIMEOUT_MS = 5 * 60_000; // 5 minut
const INACTIVITY_WARNING_MS = 60_000; // 1 minuta ostrzeżenia
const TABLE_PAGE_SIZE_OPTIONS = [20, 30, 50, 70, 100] as const;
const DEFAULT_TABLE_PAGE_SIZE = 30;
const OBLIGATING_DECISIONS_COLUMN_WIDTHS_STORAGE_PREFIX =
	"triangle.ui.obligating-decisions.column-widths";
const OBLIGATING_DECISIONS_NAME_VARIANTS_STORAGE_PREFIX =
	"triangle.ui.obligating-decisions.name-variants";
const OBLIGATING_DECISIONS_TABLE_VIEW_STORAGE_PREFIX =
	"triangle.ui.obligating-decisions.table-view";
const OBLIGATING_DECISIONS_MIN_COLUMN_WIDTH = 90;
// Maksymalna wysokosc zawartosci komorki (wiersza) tabeli Decyzji zobowiazujacych.
const OBLIGATING_DECISIONS_MAX_ROW_HEIGHT_PX = 84;

type ObligatingDecisionsPanelProps = {
	operatorLogin: string;
	authRole: AuthRole;
	isObserver?: boolean;
};

type PersonOption = {
	id: number;
	label: string;
};

type ResolutionOption = {
	id: number;
	name: string;
};

type DecisionFormState = {
	recommendationKodZalecenia: string;
	nazwaPodmiotuId: string;
	nazwaPodmiotu: string;
	liczbaZalecen: string;
	dataWszczeciaPostepowaniaIInstancji: string;
	osobyProwadzaceIInstancjeIds: number[];
	dataDecyzjiIInstancji: string;
	dataDoreczeniaDecyzjiIInstancji: string;
	rozstrzygniecieIId: string;
	dataWnioskuPonowneRozpatrzenie: string;
	dataWplywuWnioskuPonowneRozpatrzenie: string;
	osobyProwadzaceIIInstancjeIds: number[];
	dataDecyzjiIIInstancji: string;
	dataDoreczeniaDecyzjiIIInstancji: string;
	rozstrzygniecieIIId: string;
	komentarz: string;
};

const RECOMMENDATIONS_CHANGED_EVENT = "recommendations:changed";
const INSPECTIONS_CHANGED_EVENT = "inspections:changed";
const DASHBOARD_OPEN_RECOMMENDATION_EVENT = "dashboard:open-recommendation";
const DASHBOARD_OPEN_RECOMMENDATION_CODE_KEY =
	"triangle.dashboard.openRecommendationCode";

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

function openRecommendationFromDashboard(recommendationCode: string) {
	const normalizedCode = recommendationCode.trim();
	if (!normalizedCode || typeof window === "undefined") {
		return;
	}

	window.sessionStorage.setItem(
		DASHBOARD_OPEN_RECOMMENDATION_CODE_KEY,
		normalizedCode,
	);
	window.dispatchEvent(
		new CustomEvent(DASHBOARD_OPEN_RECOMMENDATION_EVENT, {
			detail: { recommendationCode: normalizedCode },
		}),
	);
}

type DecisionColumnKey =
	| "lp"
	| "kodDecyzji"
	| "recommendationKodZalecenia"
	| "nazwaPodmiotu"
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

type DecisionColumn = {
	key: DecisionColumnKey;
	label: string;
};

type DecisionNameVariant = "full" | "short";

type DecisionNameVariantColumnKey =
	| "nazwaPodmiotu"
	| "rozstrzygniecieI"
	| "rozstrzygniecieII";

type DecisionNameVariantByColumn = Record<
	DecisionNameVariantColumnKey,
	DecisionNameVariant
>;

const DECISION_NAME_VARIANT_COLUMN_KEYS: DecisionNameVariantColumnKey[] = [
	"nazwaPodmiotu",
	"rozstrzygniecieI",
	"rozstrzygniecieII",
];

const DECISION_NAME_VARIANT_OPTIONS = [
	{ value: "full", label: "Nazwa pełna" },
	{ value: "short", label: "Nazwa skrócona" },
] as const;

const DEFAULT_DECISION_NAME_VARIANTS: DecisionNameVariantByColumn = {
	nazwaPodmiotu: "short",
	rozstrzygniecieI: "full",
	rozstrzygniecieII: "full",
};

function isDecisionNameVariantColumnKey(
	columnKey: DecisionColumnKey,
): columnKey is DecisionNameVariantColumnKey {
	return DECISION_NAME_VARIANT_COLUMN_KEYS.includes(
		columnKey as DecisionNameVariantColumnKey,
	);
}

const DECISION_COLUMNS: DecisionColumn[] = [
	{ key: "lp", label: "Lp." },
	{ key: "kodDecyzji", label: "Id decyzji" },
	{ key: "recommendationKodZalecenia", label: "Id zalecenia" },
	{ key: "nazwaPodmiotu", label: "Nazwa podmiotu" },
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

const DEFAULT_DECISION_COLUMN_WIDTHS: Partial<Record<DecisionColumnKey, number>> = {
	// Manualna konfiguracja szerokosci kolumn tabeli Decyzji zobowiazujacych (wartosci w px).
	lp: 90,
	kodDecyzji: 170,
	recommendationKodZalecenia: 170,
	nazwaPodmiotu: 220,
	dataWszczeciaPostepowaniaIInstancji: 250,
	osobyProwadzaceIInstancjeList: 230,
	dataDecyzjiIInstancji: 170,
	dataDoreczeniaDecyzjiIInstancji: 200,
	rozstrzygniecieI: 210,
	dataWnioskuPonowneRozpatrzenie: 230,
	dataWplywuWnioskuPonowneRozpatrzenie: 250,
	osobyProwadzaceIIInstancjeList: 230,
	dataDecyzjiIIInstancji: 170,
	dataDoreczeniaDecyzjiIIInstancji: 200,
	rozstrzygniecieII: 210,
	komentarz: 240,
};

const DECISION_COLUMN_TOOLTIPS: Partial<Record<DecisionColumnKey, string>> = {
	kodDecyzji: "Unikalne id decyzji zobowiązującej",
	recommendationKodZalecenia: "Unikalne id zalecenia",
};

const ALL_DECISION_COLUMN_KEYS: DecisionColumnKey[] = DECISION_COLUMNS.map(
	(column) => column.key,
);

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

type SanctionExportColumnKey =
	| "lp"
	| "requestId"
	| "inspectionLp"
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

const SANCTION_EXPORT_COLUMNS: ExportColumnDefinition<SanctionExportColumnKey>[] =
	[
		{ key: "lp", label: "Lp. wniosku" },
		{ key: "requestId", label: "Id wniosku" },
		{ key: "inspectionLp", label: "Id inspekcji" },
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

const INSPECTIONS_API_URL = "/api/structure/inspections";

const EMPTY_FORM: DecisionFormState = {
	recommendationKodZalecenia: "",
	nazwaPodmiotuId: "",
	nazwaPodmiotu: "",
	liczbaZalecen: "",
	dataWszczeciaPostepowaniaIInstancji: "",
	osobyProwadzaceIInstancjeIds: [],
	dataDecyzjiIInstancji: "",
	dataDoreczeniaDecyzjiIInstancji: "",
	rozstrzygniecieIId: "",
	dataWnioskuPonowneRozpatrzenie: "",
	dataWplywuWnioskuPonowneRozpatrzenie: "",
	osobyProwadzaceIIInstancjeIds: [],
	dataDecyzjiIIInstancji: "",
	dataDoreczeniaDecyzjiIIInstancji: "",
	rozstrzygniecieIIId: "",
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

function toDateOrNull(value: string) {
	const normalized = value.trim();
	return normalized || null;
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

function toOptionalString(value: string) {
	const normalized = value.trim();
	return normalized || null;
}

function normalizeStringList(values: Array<string | null | undefined>) {
	return values.map((value) => String(value ?? "").trim()).filter(Boolean);
}

function getRecommendationEntityDisplayName(
	recommendation: AvailableRecommendation | null | undefined,
) {
	if (!recommendation) {
		return "";
	}

	const shortName = recommendation.nazwaPodmiotuSkrocona?.trim() ?? "";
	if (shortName) {
		return shortName;
	}

	return recommendation.nazwaPodmiotu;
}

function getResolutionDisplayName(entry: DictionaryEntry) {
	const fullName = String(entry.nazwaPozycji ?? "").trim();
	if (fullName) {
		return fullName;
	}

	const shortName = String(entry.skrotPozycji ?? "").trim();
	if (shortName) {
		return shortName;
	}

	const fallbackShortName = String(
		(entry as { nazwaPozycjiSkrocona?: unknown }).nazwaPozycjiSkrocona ??
			(entry as { nazwaPozycjiSkrot?: unknown }).nazwaPozycjiSkrot ??
			"",
	).trim();

	return fallbackShortName;
}

function mapDecisionToForm(item: ObligatingDecisionRead): DecisionFormState {
	return {
		recommendationKodZalecenia: item.recommendationKodZalecenia ?? "",
		nazwaPodmiotuId:
			typeof item.nazwaPodmiotuId === "number" &&
			Number.isFinite(item.nazwaPodmiotuId)
				? String(item.nazwaPodmiotuId)
				: "",
		nazwaPodmiotu: item.nazwaPodmiotu ?? "",
		liczbaZalecen:
			typeof item.liczbaZalecen === "number" &&
			Number.isFinite(item.liczbaZalecen)
				? String(item.liczbaZalecen)
				: "",
		dataWszczeciaPostepowaniaIInstancji:
			item.dataWszczeciaPostepowaniaIInstancji ?? "",
		osobyProwadzaceIInstancjeIds: item.osobyProwadzaceIInstancjeIds ?? [],
		dataDecyzjiIInstancji: item.dataDecyzjiIInstancji ?? "",
		dataDoreczeniaDecyzjiIInstancji: item.dataDoreczeniaDecyzjiIInstancji ?? "",
		rozstrzygniecieIId:
			typeof item.rozstrzygniecieIId === "number" &&
			Number.isFinite(item.rozstrzygniecieIId)
				? String(item.rozstrzygniecieIId)
				: "",
		dataWnioskuPonowneRozpatrzenie: item.dataWnioskuPonowneRozpatrzenie ?? "",
		dataWplywuWnioskuPonowneRozpatrzenie:
			item.dataWplywuWnioskuPonowneRozpatrzenie ?? "",
		osobyProwadzaceIIInstancjeIds: item.osobyProwadzaceIIInstancjeIds ?? [],
		dataDecyzjiIIInstancji: item.dataDecyzjiIIInstancji ?? "",
		dataDoreczeniaDecyzjiIIInstancji:
			item.dataDoreczeniaDecyzjiIIInstancji ?? "",
		rozstrzygniecieIIId:
			typeof item.rozstrzygniecieIIId === "number" &&
			Number.isFinite(item.rozstrzygniecieIIId)
				? String(item.rozstrzygniecieIIId)
				: "",
		komentarz: item.komentarz ?? "",
	};
}

type DecisionEditPermissions = {
	canEditIInstance: boolean;
	canAssignIInstancePeople: boolean;
	canEditIIInstance: boolean;
	canAssignIIInstancePeople: boolean;
	canEditComment: boolean;
};

function getDecisionEditPermissions(
	item: ObligatingDecisionRead,
	authRole: AuthRole,
): DecisionEditPermissions {
	const hasGranularInstancePermissions =
		typeof item.canEditIInstance === "boolean" ||
		typeof item.canEditIIInstance === "boolean" ||
		typeof item.canAssignIInstancePeople === "boolean" ||
		typeof item.canAssignIIInstancePeople === "boolean";
	const canEditIInstance = hasGranularInstancePermissions
		? (item.canEditIInstance ?? false)
		: item.canEdit;
	const canEditIIInstance = hasGranularInstancePermissions
		? (item.canEditIIInstance ?? false)
		: item.canEdit;
	const canAssignIInstancePeopleFallback = canEditIInstance;
	const canAssignIIInstancePeopleFallback = canEditIIInstance;
	return {
		canEditIInstance,
		canAssignIInstancePeople:
			item.canAssignIInstancePeople ?? canAssignIInstancePeopleFallback,
		canEditIIInstance,
		canAssignIIInstancePeople:
			item.canAssignIIInstancePeople ?? canAssignIIInstancePeopleFallback,
		canEditComment: item.canEditComment ?? item.canEdit,
	};
}

function hasAnyDecisionEditPermission(
	item: ObligatingDecisionRead,
	authRole: AuthRole,
) {
	const permissions = getDecisionEditPermissions(item, authRole);
	return (
		permissions.canEditIInstance ||
		permissions.canAssignIInstancePeople ||
		permissions.canEditIIInstance ||
		permissions.canAssignIIInstancePeople ||
		permissions.canEditComment
	);
}

function createWritePayload(form: DecisionFormState): ObligatingDecisionWrite {
	const liczbaZalecen = Number(form.liczbaZalecen);
	const nazwaPodmiotuId = Number(form.nazwaPodmiotuId);
	const rozstrzygniecieIId = Number(form.rozstrzygniecieIId);
	const rozstrzygniecieIIId = Number(form.rozstrzygniecieIIId);
	const hasSecondInstanceFlow = Boolean(
		form.dataWplywuWnioskuPonowneRozpatrzenie.trim(),
	);

	return {
		recommendationKodZalecenia: toOptionalString(
			form.recommendationKodZalecenia,
		),
		nazwaPodmiotuId:
			Number.isFinite(nazwaPodmiotuId) && nazwaPodmiotuId > 0
				? nazwaPodmiotuId
				: null,
		nazwaPodmiotu: toOptionalString(form.nazwaPodmiotu),
		liczbaZalecen:
			Number.isFinite(liczbaZalecen) && liczbaZalecen >= 0
				? liczbaZalecen
				: null,
		dataWszczeciaPostepowaniaIInstancji: toDateOrNull(
			form.dataWszczeciaPostepowaniaIInstancji,
		),
		osobyProwadzaceIInstancjeIds:
			form.osobyProwadzaceIInstancjeIds.length > 0
				? form.osobyProwadzaceIInstancjeIds
				: null,
		osobyProwadzaceIInstancjeList: null,
		dataDecyzjiIInstancji: toDateOrNull(form.dataDecyzjiIInstancji),
		dataDoreczeniaDecyzjiIInstancji: toDateOrNull(
			form.dataDoreczeniaDecyzjiIInstancji,
		),
		rozstrzygniecieIId:
			Number.isFinite(rozstrzygniecieIId) && rozstrzygniecieIId > 0
				? rozstrzygniecieIId
				: null,
		rozstrzygniecieI: null,
		dataWnioskuPonowneRozpatrzenie: toDateOrNull(
			form.dataWnioskuPonowneRozpatrzenie,
		),
		dataWplywuWnioskuPonowneRozpatrzenie: toDateOrNull(
			form.dataWplywuWnioskuPonowneRozpatrzenie,
		),
		osobyProwadzaceIIInstancjeIds:
			hasSecondInstanceFlow && form.osobyProwadzaceIIInstancjeIds.length > 0
				? form.osobyProwadzaceIIInstancjeIds
				: null,
		osobyProwadzaceIIInstancjeList: null,
		dataDecyzjiIIInstancji: hasSecondInstanceFlow
			? toDateOrNull(form.dataDecyzjiIIInstancji)
			: null,
		dataDoreczeniaDecyzjiIIInstancji: toDateOrNull(
			hasSecondInstanceFlow ? form.dataDoreczeniaDecyzjiIIInstancji : "",
		),
		rozstrzygniecieIIId:
			hasSecondInstanceFlow &&
			Number.isFinite(rozstrzygniecieIIId) &&
			rozstrzygniecieIIId > 0
				? rozstrzygniecieIIId
				: null,
		rozstrzygniecieII: null,
		komentarz: toOptionalString(form.komentarz),
	};
}

function createPatchPayload(
	current: ObligatingDecisionWrite,
	base: ObligatingDecisionWrite,
): ObligatingDecisionWrite {
	const patch: ObligatingDecisionWrite = {};
	const patchRecord = patch as Record<string, unknown>;
	for (const [key, value] of Object.entries(current) as Array<
		[
			keyof ObligatingDecisionWrite,
			ObligatingDecisionWrite[keyof ObligatingDecisionWrite],
		]
	>) {
		const baseValue = base[key];
		if (JSON.stringify(value) !== JSON.stringify(baseValue)) {
			patchRecord[key as string] = value;
		}
	}
	return patch;
}

function filterPatchPayloadByPermissions(
	patch: ObligatingDecisionWrite,
	permissions: DecisionEditPermissions,
) {
	const filtered: ObligatingDecisionWrite = { ...patch };
	const iInstanceKeys: Array<keyof ObligatingDecisionWrite> = [
		"dataWszczeciaPostepowaniaIInstancji",
		"dataDecyzjiIInstancji",
		"dataDoreczeniaDecyzjiIInstancji",
		"rozstrzygniecieIId",
		"rozstrzygniecieI",
		"dataWnioskuPonowneRozpatrzenie",
		"dataWplywuWnioskuPonowneRozpatrzenie",
	];
	const iInstancePeopleKeys: Array<keyof ObligatingDecisionWrite> = [
		"osobyProwadzaceIInstancjeIds",
		"osobyProwadzaceIInstancjeList",
	];
	const iiInstanceKeys: Array<keyof ObligatingDecisionWrite> = [
		"dataDecyzjiIIInstancji",
		"dataDoreczeniaDecyzjiIIInstancji",
		"rozstrzygniecieIIId",
		"rozstrzygniecieII",
	];

	if (!permissions.canEditIInstance) {
		for (const key of iInstanceKeys) {
			delete filtered[key];
		}
	}

	if (!permissions.canAssignIInstancePeople) {
		for (const key of iInstancePeopleKeys) {
			delete filtered[key];
		}
	}

	if (!permissions.canEditIIInstance) {
		for (const key of iiInstanceKeys) {
			delete filtered[key];
		}
	}

	if (!permissions.canAssignIIInstancePeople) {
		delete filtered.osobyProwadzaceIIInstancjeIds;
		delete filtered.osobyProwadzaceIIInstancjeList;
	}

	if (!permissions.canEditComment) {
		delete filtered.komentarz;
	}

	return filtered;
}

function compactCreatePayload(payload: ObligatingDecisionWrite) {
	const compactedEntries = Object.entries(payload).filter(([, value]) => {
		if (value === null || value === undefined) {
			return false;
		}

		if (Array.isArray(value) && value.length === 0) {
			return false;
		}

		return true;
	});

	return Object.fromEntries(compactedEntries) as ObligatingDecisionWrite;
}

function MultiSelectPeopleField({
	label,
	options,
	values,
	onChange,
	searchPlaceholder = "Wyszukaj osobę...",
	disabled = false,
	invalid = false,
	errorMessage = null,
}: {
	label: string;
	options: PersonOption[];
	values: number[];
	onChange: (next: number[]) => void;
	searchPlaceholder?: string;
	disabled?: boolean;
	invalid?: boolean;
	errorMessage?: string | null;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const popupRef = useRef<HTMLDivElement | null>(null);
	const [popupPosition, setPopupPosition] = useState<{
		top: number;
		left: number;
		width: number;
	} | null>(null);
	const selectedLabels = options
		.filter((option) => values.includes(option.id))
		.map((option) => option.label);
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
		const popupHeight = 240;
		const dialog = trigger.closest('[role="dialog"]') as HTMLElement | null;
		const dialogRect = dialog?.getBoundingClientRect() ?? null;
		const availableBottom = Math.min(
			window.innerHeight,
			dialogRect ? dialogRect.bottom - 8 : window.innerHeight,
		);
		const spaceBelow = availableBottom - rect.bottom;
		const shouldOpenUp =
			spaceBelow < popupHeight + 8 && rect.top > popupHeight + 8;

		setPopupPosition({
			top: shouldOpenUp ? rect.top - popupHeight - 8 : rect.bottom + 8,
			left: Math.min(
				Math.max(viewportPadding, rect.left),
				window.innerWidth - rect.width - viewportPadding,
			),
			width: rect.width,
		});
	};

	useEffect(() => {
		if (!isOpen) {
			setPopupPosition(null);
			setSearchQuery("");
			return;
		}

		updatePopupPosition();
		const handleAnyScroll = (event: Event) => {
			const target = event.target as Node | null;
			if (target && popupRef.current?.contains(target)) {
				return;
			}
			setIsOpen(false);
		};
		window.addEventListener("resize", updatePopupPosition);
		window.addEventListener("scroll", handleAnyScroll, true);
		return () => {
			window.removeEventListener("resize", updatePopupPosition);
			window.removeEventListener("scroll", handleAnyScroll, true);
		};
	}, [isOpen]);

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

	return (
		<label className="text-slate-700 text-sm">
			<span className="mb-1 block">{label}</span>
			<div className="relative">
				<button
					ref={triggerRef}
					type="button"
					disabled={disabled}
					onClick={() => setIsOpen((prev) => !prev)}
					className={`flex w-full items-center justify-between rounded-lg border bg-white px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-700 ${
						invalid ? "border-rose-300 focus:border-rose-400" : "border-slate-300"
					}`}
				>
					<span className="truncate">
						{selectedLabels.length > 0
							? selectedLabels.join(", ")
							: "Wybierz osoby"}
					</span>
					<ChevronDown size={14} className="text-slate-500" />
				</button>

				{isOpen && !disabled && popupPosition
					? createPortal(
							<div
								ref={popupRef}
								className="fixed z-[80] rounded-xl border border-slate-200 bg-white p-2.5 shadow-[0_14px_34px_rgba(15,23,42,0.14)]"
								style={{
									top: popupPosition.top,
									left: popupPosition.left,
									width: popupPosition.width,
								}}
							>
								<div className="mb-2">
									<input
										type="text"
										value={searchQuery}
										onChange={(event) => setSearchQuery(event.target.value)}
										placeholder={searchPlaceholder}
										className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] text-slate-900 placeholder:text-slate-400 outline-none transition-colors focus:border-blue-400"
									/>
								</div>
								<div
									className="max-h-52 space-y-1 overflow-y-auto pr-1 text-[13px] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb:hover]:bg-slate-400 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-2"
									style={{ scrollbarWidth: "thin" }}
								>
									{visibleOptions.map((option) => {
										const isSelected = values.includes(option.id);
										return (
											<label
												key={option.id}
												className={`flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2.5 transition-colors ${
													isSelected
														? "bg-blue-100 text-blue-900"
														: "text-slate-900 hover:bg-blue-50 hover:text-blue-900"
												}`}
											>
												<input
													type="checkbox"
													checked={isSelected}
													className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-1 focus:ring-blue-300"
													onChange={(event) => {
														if (event.target.checked) {
															onChange([...values, option.id]);
															return;
														}

														onChange(values.filter((id) => id !== option.id));
													}}
												/>
												<span>{option.label}</span>
											</label>
										);
									})}
									{visibleOptions.length === 0 ? (
										<p className="px-3 py-2 text-slate-500 text-xs">Brak wyników.</p>
									) : null}
								</div>
							</div>,
							document.body,
						)
					: null}
			</div>
			{invalid && errorMessage ? (
				<span className="mt-1 block text-rose-700 text-xs">{errorMessage}</span>
			) : null}
		</label>
	);
}

function ResolutionSelectField({
	label,
	value,
	options,
	onChange,
	disabled = false,
	placeholder = "Wybierz",
}: {
	label: string;
	value: string;
	options: ResolutionOption[];
	onChange: (next: string) => void;
	disabled?: boolean;
	placeholder?: string;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const popupRef = useRef<HTMLDivElement | null>(null);
	const [popupPosition, setPopupPosition] = useState<{
		top: number;
		left: number;
		width: number;
	} | null>(null);

	const selectedOption = options.find((entry) => String(entry.id) === value) ?? null;

	const updatePopupPosition = () => {
		const trigger = triggerRef.current;
		if (!trigger) {
			return;
		}

		const rect = trigger.getBoundingClientRect();
		const viewportPadding = 8;
		const popupHeight = Math.min(260, Math.max(120, options.length * 36 + 10));
		const dialog = trigger.closest('[role="dialog"]') as HTMLElement | null;
		const dialogRect = dialog?.getBoundingClientRect() ?? null;
		const availableBottom = Math.min(
			window.innerHeight,
			dialogRect ? dialogRect.bottom - 8 : window.innerHeight,
		);
		const spaceBelow = availableBottom - rect.bottom;
		const shouldOpenUp =
			spaceBelow < popupHeight + 8 && rect.top > popupHeight + 8;

		setPopupPosition({
			top: shouldOpenUp ? rect.top - popupHeight - 8 : rect.bottom + 8,
			left: Math.min(
				Math.max(viewportPadding, rect.left),
				window.innerWidth - rect.width - viewportPadding,
			),
			width: rect.width,
		});
	};

	useEffect(() => {
		if (!isOpen) {
			setPopupPosition(null);
			return;
		}

		updatePopupPosition();
		const handleAnyScroll = (event: Event) => {
			const target = event.target as Node | null;
			if (target && popupRef.current?.contains(target)) {
				return;
			}
			setIsOpen(false);
		};
		window.addEventListener("resize", updatePopupPosition);
		window.addEventListener("scroll", handleAnyScroll, true);
		return () => {
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

		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setIsOpen(false);
			}
		};

		document.addEventListener("mousedown", handlePointerDown);
		document.addEventListener("keydown", handleEscape);

		return () => {
			document.removeEventListener("mousedown", handlePointerDown);
			document.removeEventListener("keydown", handleEscape);
		};
	}, [isOpen]);

	return (
		<label className="text-slate-700 text-sm">
			<span className="mb-1 block">{label}</span>
			<button
				ref={triggerRef}
				type="button"
				disabled={disabled}
				onClick={() => {
						if (disabled) {
							return;
						}
					setIsOpen((prev) => !prev);
				}}
				className="flex w-full items-center justify-between rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm outline-none transition-colors focus:border-blue-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-700"
			>
				<span className="truncate">{selectedOption?.name ?? placeholder}</span>
				<ChevronDown size={14} className="text-slate-500" />
			</button>

			{isOpen && popupPosition
				? createPortal(
						<div
							ref={popupRef}
							className="fixed z-[80] max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1.5 shadow-[0_14px_34px_rgba(15,23,42,0.14)] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb:hover]:bg-slate-400 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-2"
							style={{
								top: popupPosition.top,
								left: popupPosition.left,
								width: popupPosition.width,
								scrollbarWidth: "thin",
							}}
						>
							<button
								type="button"
								onClick={() => {
									onChange("");
									setIsOpen(false);
								}}
								className={`block w-full rounded-sm px-3 py-2.5 text-left text-sm transition-colors ${
									value === ""
										? "bg-blue-100 text-blue-900"
										: "text-slate-800 hover:bg-blue-50 hover:text-blue-900"
								}`}
							>
								{placeholder}
							</button>
							{options.map((entry) => {
								const isSelected = String(entry.id) === value;
								return (
									<button
										key={entry.id}
										type="button"
										onClick={() => {
											onChange(String(entry.id));
											setIsOpen(false);
										}}
										className={`block w-full rounded-sm px-3 py-2.5 text-left text-sm transition-colors ${
											isSelected
												? "bg-blue-100 text-blue-900"
												: "text-slate-800 hover:bg-blue-50 hover:text-blue-900"
										}`}
									>
										{entry.name}
									</button>
								);
							})}
						</div>,
						document.body,
					)
				: null}
		</label>
	);
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

export function ObligatingDecisionsPanel({
	operatorLogin,
	authRole,
	isObserver,
}: ObligatingDecisionsPanelProps) {
	const [items, setItems] = useState<ObligatingDecisionRead[]>([]);
	const [total, setTotal] = useState(0);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const [selectedId, setSelectedId] = useState<number | null>(null);
	const [isFormOpen, setIsFormOpen] = useState(false);
	const [editingItem, setEditingItem] = useState<ObligatingDecisionRead | null>(
		null,
	);
	const [form, setForm] = useState<DecisionFormState>(EMPTY_FORM);
	const [formError, setFormError] = useState<string | null>(null);
	const [showRequiredFieldErrors, setShowRequiredFieldErrors] = useState(false);
	const [versionConflictUpdatedAt, setVersionConflictUpdatedAt] = useState<
		string | null
	>(null);
	const [saveLockConflict, setSaveLockConflict] =
		useState<ObligatingDecisionLockConflict | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false);
	const [successEntityName, setSuccessEntityName] = useState("");
	const [successRecommendationCode, setSuccessRecommendationCode] =
		useState("");
	const [successMode, setSuccessMode] = useState<"create" | "edit">("create");
	const canManageDecisions = authRole !== "external_user" && !isObserver;
	const isDirector = authRole === "director";
	const [isDeleteConfirmModalOpen, setIsDeleteConfirmModalOpen] =
		useState(false);
	const [isDeletingItem, setIsDeletingItem] = useState(false);
	const [tablePageSize, setTablePageSize] = useState<number>(() =>
		readPersistedTablePageSize(
			`${OBLIGATING_DECISIONS_TABLE_VIEW_STORAGE_PREFIX}.${operatorLogin
				.trim()
				.toLowerCase()}.page-size`,
		),
	);
	const [columnWidths, setColumnWidths] = useState<
		Partial<Record<DecisionColumnKey, number>>
	>(DEFAULT_DECISION_COLUMN_WIDTHS);
	const [decisionNameVariants, setDecisionNameVariants] =
		useState<DecisionNameVariantByColumn>(DEFAULT_DECISION_NAME_VARIANTS);
	const [draftDecisionNameVariants, setDraftDecisionNameVariants] =
		useState<DecisionNameVariantByColumn>(DEFAULT_DECISION_NAME_VARIANTS);
	const [areNameVariantsHydrated, setAreNameVariantsHydrated] =
		useState(false);
	const [areColumnWidthsHydrated, setAreColumnWidthsHydrated] = useState(false);
	const [advancedFilterAnchor, setAdvancedFilterAnchor] = useState({
		top: 120,
		left: 120,
	});
	const [isExporting, setIsExporting] = useState(false);
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [isExportConfigModalOpen, setIsExportConfigModalOpen] = useState(false);
	const [includeRecommendationsInExport, setIncludeRecommendationsInExport] =
		useState(false);
	const [includeInspectionsInExport, setIncludeInspectionsInExport] =
		useState(false);
	const [includeSanctionsInExport, setIncludeSanctionsInExport] =
		useState(false);
	const [activeExportColumnsTab, setActiveExportColumnsTab] = useState<
		"recommendations" | "inspections" | "sanctions"
	>("recommendations");
	const [
		selectedRecommendationExportColumns,
		setSelectedRecommendationExportColumns,
	] = useState<RecommendationExportColumnKey[]>(
		RECOMMENDATION_EXPORT_COLUMNS.map((column) => column.key),
	);
	const [selectedInspectionExportColumns, setSelectedInspectionExportColumns] =
		useState<InspectionExportColumnKey[]>(
			INSPECTION_EXPORT_COLUMNS.map((column) => column.key),
		);
	const [selectedSanctionExportColumns, setSelectedSanctionExportColumns] =
		useState<SanctionExportColumnKey[]>(
			SANCTION_EXPORT_COLUMNS.map((column) => column.key),
		);

	const [availableRecommendations, setAvailableRecommendations] = useState<
		AvailableRecommendation[]
	>([]);
	const [recommendationShortNameByCode, setRecommendationShortNameByCode] =
		useState<Record<string, string>>({});
	const [firstInstancePersonOptions, setFirstInstancePersonOptions] = useState<
		PersonOption[]
	>([]);
	const [secondInstancePersonOptions, setSecondInstancePersonOptions] = useState<
		PersonOption[]
	>([]);
	const [resolutionIOptions, setResolutionIOptions] = useState<
		ResolutionOption[]
	>([]);
	const [resolutionIIOptions, setResolutionIIOptions] = useState<
		ResolutionOption[]
	>([]);
	const [isLookupsLoading, setIsLookupsLoading] = useState(false);
	const normalizedOperatorLogin = operatorLogin.trim().toLowerCase();
	const columnWidthsStorageKey = `${OBLIGATING_DECISIONS_COLUMN_WIDTHS_STORAGE_PREFIX}.${normalizedOperatorLogin}`;
	const nameVariantsStorageKey = `${OBLIGATING_DECISIONS_NAME_VARIANTS_STORAGE_PREFIX}.${normalizedOperatorLogin}`;
	const tableViewStorageKey = `${OBLIGATING_DECISIONS_TABLE_VIEW_STORAGE_PREFIX}.${normalizedOperatorLogin}`;
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

	const selectedItem = useMemo(
		() => items.find((item) => item.id === selectedId) ?? null,
		[items, selectedId],
	);
	const isEditMode = Boolean(editingItem);
	const editingItemPermissions = useMemo(
		() =>
			editingItem ? getDecisionEditPermissions(editingItem, authRole) : null,
		[authRole, editingItem],
	);
	const canEditIInstance = isEditMode
		? (editingItemPermissions?.canEditIInstance ?? false)
		: true;
	const canAssignIInstancePeopleBase = isEditMode
		? (editingItemPermissions?.canAssignIInstancePeople ?? canEditIInstance)
		: true;
	const canAssignIInstancePeople = canAssignIInstancePeopleBase;
	const canEditIIInstanceRaw = isEditMode
		? (editingItemPermissions?.canEditIIInstance ?? false)
		: true;
	const canAssignIIInstancePeopleBase = isEditMode
		? (editingItemPermissions?.canAssignIIInstancePeople ?? false)
		: true;
	const canAssignIIInstancePeople = canAssignIIInstancePeopleBase;
	const canEditIIInstance = canEditIIInstanceRaw;
	const canEditComment = isEditMode
		? (editingItemPermissions?.canEditComment ?? (canEditIInstance || canEditIIInstance))
		: true;
	const isSecondInstanceUnlocked = Boolean(
		form.dataWplywuWnioskuPonowneRozpatrzenie.trim(),
	);
	const isSecondInstanceLockedByFlow = !isSecondInstanceUnlocked;
	const hasSecondInstancePeopleAssigned =
		form.osobyProwadzaceIIInstancjeIds.length > 0;
	const isSecondInstanceLockedByPeople = !hasSecondInstancePeopleAssigned;
	const isSecondInstancePeopleDisabled =
		isSecondInstanceLockedByFlow || !canAssignIIInstancePeople;
	const isSecondInstanceFieldsDisabled =
		isSecondInstanceLockedByFlow ||
		isSecondInstanceLockedByPeople ||
		!canEditIIInstance;
	const secondInstanceInfoTooltip = isSecondInstanceLockedByFlow
		? 'II instancja będzie aktywna po uzupełnieniu pola "Data wpływu wniosku o ponowne rozpatrzenie sprawy"'
		: isSecondInstanceLockedByPeople
			? 'II instancja będzie aktywna po wskazaniu pola "Osoby prowadzące II instancję"'
			: !canEditIIInstance && canAssignIIInstancePeople
				? "Możliwa jest tylko zmiana osób II instancji"
			: !canEditIIInstance && !canAssignIIInstancePeople
				? "Brak uprawnień do edycji pól II instancji"
				: null;

	const editRecordLock = useRecordLock({
		enabled: isFormOpen && isEditMode,
		module: "obligating-decisions",
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

	const orderedItems = useMemo(
		() => [...items].sort((left, right) => left.id - right.id),
		[items],
	);

	const decisionLpById = useMemo(
		() => new Map(orderedItems.map((item, index) => [item.id, index + 1])),
		[orderedItems],
	);

	const getCellValue = (
		item: ObligatingDecisionRead,
		key: DecisionColumnKey,
	) => {
		switch (key) {
			case "lp":
				return String(decisionLpById.get(item.id) ?? "");
			case "kodDecyzji":
				return item.kodDecyzji ?? "";
			case "recommendationKodZalecenia":
				return item.recommendationKodZalecenia ?? "";
			case "nazwaPodmiotu":
				return item.nazwaPodmiotu ?? "";
			case "dataWszczeciaPostepowaniaIInstancji":
				return item.dataWszczeciaPostepowaniaIInstancji ?? "";
			case "osobyProwadzaceIInstancjeList":
				return normalizeStringList(
					item.osobyProwadzaceIInstancjeList ?? [],
				).join(", ");
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
				return normalizeStringList(
					item.osobyProwadzaceIIInstancjeList ?? [],
				).join(", ");
			case "dataDecyzjiIIInstancji":
				return item.dataDecyzjiIIInstancji ?? "";
			case "dataDoreczeniaDecyzjiIIInstancji":
				return item.dataDoreczeniaDecyzjiIIInstancji ?? "";
			case "rozstrzygniecieII":
				return item.rozstrzygniecieII ?? "";
			case "komentarz":
				return item.komentarz ?? "";
		}
	};

	const {
		advancedFilterColumnKey,
		advancedFilterSearch,
		advancedFilters,
		canClearFilters,
		clearAdvancedFilterForSelectedColumn,
		clearFilters,
		columnFilters,
		draftHiddenColumns,
		draftVisibleColumns: draftVisibleDecisionColumns,
		filteredAndSortedRows: filteredAndSortedItems,
		paginatedRows: paginatedDecisionItems,
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
		visibleColumns: visibleDecisionColumns,
	} = useTableState<ObligatingDecisionRead, DecisionColumnKey>({
		rows: useMemo(
			() =>
				orderedItems.map((item) => {
					const getDisplayValue = (columnKey: DecisionNameVariantColumnKey) => {
						const shortValue =
							columnKey === "nazwaPodmiotu"
								? item.nazwaPodmiotuSkrocona
								: columnKey === "rozstrzygniecieI"
									? item.rozstrzygniecieISkrocona
									: item.rozstrzygniecieIISkrocona;

						if (
							decisionNameVariants[columnKey] === "short" &&
							typeof shortValue === "string" &&
							shortValue.trim()
						) {
							return shortValue.trim();
						}

						return String(item[columnKey] ?? "").trim();
					};

					return {
						...item,
						nazwaPodmiotu: getDisplayValue("nazwaPodmiotu") || null,
						rozstrzygniecieI: getDisplayValue("rozstrzygniecieI") || null,
						rozstrzygniecieII: getDisplayValue("rozstrzygniecieII") || null,
					};
				}),
			[decisionNameVariants, orderedItems],
		),
		allColumnKeys: ALL_DECISION_COLUMN_KEYS,
		initialAdvancedFilterColumnKey: "kodDecyzji",
		getCellValue,
		pageSize: tablePageSize,
		hiddenColumnsStorageKey: tableViewStorageKey,
		hiddenColumnsStorageArea: "localStorage",
		alignToEndPageSize: true,
		sortComparators: {
			lp: (left, right) =>
				(Number(getCellValue(left, "lp")) || 0) -
				(Number(getCellValue(right, "lp")) || 0),
		},
	});

	const columnDisplayModeOptionsByKey = useMemo(
		() =>
			Object.fromEntries(
				DECISION_NAME_VARIANT_COLUMN_KEYS.map((columnKey) => [
					columnKey,
					[...DECISION_NAME_VARIANT_OPTIONS],
				]),
			) as Partial<
				Record<DecisionColumnKey, Array<{ value: string; label: string }>>
			>,
		[],
	);

	const draftColumnDisplayModeValuesByKey = useMemo(
		() =>
			Object.fromEntries(
				DECISION_NAME_VARIANT_COLUMN_KEYS.map((columnKey) => [
					columnKey,
					draftDecisionNameVariants[columnKey],
				]),
			) as Partial<Record<DecisionColumnKey, string>>,
		[draftDecisionNameVariants],
	);

	const handleOpenDecisionViewModal = () => {
		setDraftDecisionNameVariants(decisionNameVariants);
		handleOpenViewModal();
	};

	const handleApplyDecisionViewChanges = () => {
		setDecisionNameVariants(draftDecisionNameVariants);
		handleApplyViewChanges();
	};

	const handleResetDecisionViewSelection = () => {
		handleDraftSelectAllColumns();
		setDraftDecisionNameVariants(DEFAULT_DECISION_NAME_VARIANTS);
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
			const parsed = JSON.parse(raw) as Partial<Record<DecisionColumnKey, unknown>>;
			const next: DecisionNameVariantByColumn = {
				...DEFAULT_DECISION_NAME_VARIANTS,
			};

			for (const columnKey of DECISION_NAME_VARIANT_COLUMN_KEYS) {
				const value = parsed[columnKey];
				if (value === "full" || value === "short") {
					next[columnKey] = value;
				}
			}

			setDecisionNameVariants(next);
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
			JSON.stringify(decisionNameVariants),
		);
	}, [areNameVariantsHydrated, decisionNameVariants, nameVariantsStorageKey]);

	const handlePageSizeChange = (nextPageSize: number) => {
		if (
			!TABLE_PAGE_SIZE_OPTIONS.includes(
				nextPageSize as (typeof TABLE_PAGE_SIZE_OPTIONS)[number],
			)
		) {
			return;
		}

		const nextTotalPages = Math.max(
			1,
			Math.ceil(filteredAndSortedItems.length / nextPageSize),
		);
		setTablePageSize(nextPageSize);
		handlePageChange(nextTotalPages);
	};

	const visibleDecisionColumnDefinitions = useMemo(
		() =>
			DECISION_COLUMNS.filter((column) =>
				visibleDecisionColumns.includes(column.key),
			),
		[visibleDecisionColumns],
	);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		try {
			const raw = window.localStorage.getItem(columnWidthsStorageKey);
			if (!raw) {
				setColumnWidths(DEFAULT_DECISION_COLUMN_WIDTHS);
				setAreColumnWidthsHydrated(true);
				return;
			}

			const parsed = JSON.parse(raw) as Partial<Record<DecisionColumnKey, unknown>>;
			const sanitized: Partial<Record<DecisionColumnKey, number>> = {
				...DEFAULT_DECISION_COLUMN_WIDTHS,
			};

			for (const key of ALL_DECISION_COLUMN_KEYS) {
				const value = parsed[key];
				if (typeof value !== "number" || !Number.isFinite(value)) {
					continue;
				}

				sanitized[key] = Math.max(
					OBLIGATING_DECISIONS_MIN_COLUMN_WIDTH,
					Math.round(value),
				);
			}

			setColumnWidths(sanitized);
		} catch {
			setColumnWidths(DEFAULT_DECISION_COLUMN_WIDTHS);
		} finally {
			setAreColumnWidthsHydrated(true);
		}
	}, [columnWidthsStorageKey]);

	const hasCustomColumnWidths = useMemo(() => {
		const keys = new Set<DecisionColumnKey>([
			...ALL_DECISION_COLUMN_KEYS,
			...(Object.keys(columnWidths) as DecisionColumnKey[]),
		]);

		for (const columnKey of keys) {
			const currentWidth = columnWidths[columnKey];
			const defaultWidth = DEFAULT_DECISION_COLUMN_WIDTHS[columnKey];
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
	}, [areColumnWidthsHydrated, columnWidths, columnWidthsStorageKey, hasCustomColumnWidths]);

	const handleResizeColumn = (columnKey: DecisionColumnKey, width: number) => {
		if (!Number.isFinite(width)) {
			return;
		}

		setColumnWidths((prev) => ({
			...prev,
			[columnKey]: Math.max(OBLIGATING_DECISIONS_MIN_COLUMN_WIDTH, Math.round(width)),
		}));
	};

	const handleResetColumnWidths = () => {
		setColumnWidths(DEFAULT_DECISION_COLUMN_WIDTHS);
	};

	const availableRecommendationsForCreate = useMemo(
		() =>
			availableRecommendations.filter(
				(entry) => entry.canCreateDecisionForRecommendation !== false,
			),
		[availableRecommendations],
	);
	const recommendationOptionsForForm = isEditMode
		? availableRecommendations
		: availableRecommendationsForCreate;
	const selectedRecommendationForForm = useMemo(
		() =>
			recommendationOptionsForForm.find(
				(entry) => entry.kodZalecenia === form.recommendationKodZalecenia,
			) ?? null,
		[form.recommendationKodZalecenia, recommendationOptionsForForm],
	);
	const getRecommendationDisplayName = (
		recommendation: AvailableRecommendation | null | undefined,
	) => {
		if (!recommendation) {
			return "";
		}

		const direct = getRecommendationEntityDisplayName(recommendation).trim();
		if (direct) {
			return direct;
		}

		const codeKey = recommendation.kodZalecenia.trim().toUpperCase();
		const fallbackFromRecommendations = recommendationShortNameByCode[codeKey] ?? "";
		if (fallbackFromRecommendations) {
			return fallbackFromRecommendations;
		}

		return recommendation.nazwaPodmiotu;
	};
	const selectedRecommendationEntityDisplayName = useMemo(() => {
		const fromRecommendation = getRecommendationDisplayName(selectedRecommendationForForm).trim();
		if (fromRecommendation) {
			return fromRecommendation;
		}

		if (
			editingItem?.recommendationKodZalecenia &&
			editingItem.recommendationKodZalecenia === form.recommendationKodZalecenia
		) {
			const fromEditingItem =
				editingItem.nazwaPodmiotuSkrocona?.trim() ||
				editingItem.nazwaPodmiotu?.trim() ||
				"";
			if (fromEditingItem) {
				return fromEditingItem;
			}
		}

		const selectedCodeKey = form.recommendationKodZalecenia.trim().toUpperCase();
		const fromFallbackMap = recommendationShortNameByCode[selectedCodeKey] ?? "";
		if (fromFallbackMap) {
			return fromFallbackMap;
		}

		return form.nazwaPodmiotu;
	}, [
		editingItem,
		form.nazwaPodmiotu,
		form.recommendationKodZalecenia,
		recommendationShortNameByCode,
		selectedRecommendationForForm,
	]);
	const canCreateDecision =
		canManageDecisions && availableRecommendationsForCreate.length > 0;

	const loadItems = async () => {
		setError(null);
		setIsLoading(true);

		const result = await fetchObligatingDecisions(operatorLogin);
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

	const mapDictionaryToResolutionOptions = (entries: DictionaryEntry[]) => {
		return entries
			.filter((entry) => entry.aktywny && typeof entry.id === "number")
			.map((entry) => ({
				id: entry.id as number,
				name: getResolutionDisplayName(entry),
			}))
			.sort((left, right) =>
				left.name.localeCompare(right.name, "pl", { sensitivity: "base" }),
			);
	};

	const refreshAvailableRecommendations = async () => {
		const [availableResult, recommendationsResult] = await Promise.all([
			fetchAvailableRecommendations(operatorLogin),
			fetchRecommendations(operatorLogin, {
				sortBy: "id",
				sortOrder: "asc",
			}),
		]);

		if (recommendationsResult.ok) {
			const shortNameMap = recommendationsResult.data.items.reduce<
				Record<string, string>
			>((acc, recommendation) => {
				const key = String(recommendation.kodZalecenia ?? "")
					.trim()
					.toUpperCase();
				if (!key) {
					return acc;
				}

				const shortName = String(recommendation.nazwaPodmiotuSkrocona ?? "").trim();
				if (shortName) {
					acc[key] = shortName;
				}

				return acc;
			}, {});

			setRecommendationShortNameByCode(shortNameMap);
		} else {
			setRecommendationShortNameByCode({});
		}

		const result = availableResult;
		if (!result.ok) {
			setAvailableRecommendations([]);
			return [] as AvailableRecommendation[];
		}

		setAvailableRecommendations(result.data);
		return result.data;
	};

	const loadFirstInstancePeople = async (recommendationCode?: string) => {
		const result = await fetchAvailableFirstInstancePeople(
			operatorLogin,
			recommendationCode,
		);
		const nextOptions = result.ok ? result.data : [];
		setFirstInstancePersonOptions(nextOptions);
		return nextOptions;
	};

	const loadLookups = async (firstInstanceRecommendationCode?: string) => {
		setIsLookupsLoading(true);
		let loadedRecommendations: AvailableRecommendation[] = [];
		try {
			const [
				recommendationsResult,
				firstInstancePeopleResult,
				secondInstancePeopleResult,
				resolutionIResult,
				resolutionIIResult,
			] = await Promise.all([
				fetchAvailableRecommendations(operatorLogin),
				fetchAvailableFirstInstancePeople(
					operatorLogin,
					firstInstanceRecommendationCode,
				),
				fetchAvailableSecondInstancePeople(operatorLogin),
				fetchDictionaryEntries("rozstrzygniecie_decyzji_i", operatorLogin),
				fetchDictionaryEntries("rozstrzygniecie_decyzji_ii", operatorLogin),
			]);

			if (recommendationsResult.ok) {
				loadedRecommendations = recommendationsResult.data;
				setAvailableRecommendations(recommendationsResult.data);
			}

			setFirstInstancePersonOptions(
				firstInstancePeopleResult.ok ? firstInstancePeopleResult.data : [],
			);
			setSecondInstancePersonOptions(
				secondInstancePeopleResult.ok ? secondInstancePeopleResult.data : [],
			);

			if (resolutionIResult.ok) {
				setResolutionIOptions(
					mapDictionaryToResolutionOptions(resolutionIResult.data),
				);
			}

			if (resolutionIIResult.ok) {
				setResolutionIIOptions(
					mapDictionaryToResolutionOptions(resolutionIIResult.data),
				);
			}
		} finally {
			setIsLookupsLoading(false);
		}

		return {
			recommendations: loadedRecommendations,
		};
	};

	useEffect(() => {
		void loadItems();
		void refreshAvailableRecommendations();
	}, [operatorLogin]);

	useEffect(() => {
		const handleUpstreamDataChanged = () => {
			void refreshAvailableRecommendations();
		};

		window.addEventListener(
			RECOMMENDATIONS_CHANGED_EVENT,
			handleUpstreamDataChanged,
		);
		window.addEventListener(
			INSPECTIONS_CHANGED_EVENT,
			handleUpstreamDataChanged,
		);

		return () => {
			window.removeEventListener(
				RECOMMENDATIONS_CHANGED_EVENT,
				handleUpstreamDataChanged,
			);
			window.removeEventListener(
				INSPECTIONS_CHANGED_EVENT,
				handleUpstreamDataChanged,
			);
		};
	}, [operatorLogin]);

	const openCreateModal = async () => {
		if (!canManageDecisions) {
			setError("Konto zewnętrzne ma dostęp tylko do odczytu.");
			return;
		}

		const lookupData = await loadLookups();
		const creatableRecommendations = lookupData.recommendations.filter(
			(recommendation) =>
				recommendation.canCreateDecisionForRecommendation !== false,
		);
		if (creatableRecommendations.length === 0) {
			setError(
				"Nie masz uprawnień do dodania decyzji zobowiązującej dla dostępnych zaleceń.",
			);
			return;
		}

		setEditingItem(null);
		setForm(EMPTY_FORM);
		setFormError(null);
		setShowRequiredFieldErrors(false);
		setVersionConflictUpdatedAt(null);
		setSaveLockConflict(null);
		setIsFormOpen(true);
		const firstRecommendation = creatableRecommendations[0] ?? null;
		if (firstRecommendation) {
			setForm((prev) => ({
				...prev,
				recommendationKodZalecenia: firstRecommendation.kodZalecenia,
				nazwaPodmiotu: firstRecommendation.nazwaPodmiotu,
			}));
			void loadFirstInstancePeople(firstRecommendation.kodZalecenia);
		}
	};

	const openEditModal = async () => {
		if (!canManageDecisions) {
			setError("Konto zewnętrzne ma dostęp tylko do odczytu.");
			return;
		}

		if (!selectedItem || !hasAnyDecisionEditPermission(selectedItem, authRole)) {
			return;
		}

		setEditingItem(selectedItem);
		setForm(mapDecisionToForm(selectedItem));
		setFormError(null);
		setShowRequiredFieldErrors(false);
		setVersionConflictUpdatedAt(null);
		setSaveLockConflict(null);
		await loadLookups(selectedItem.recommendationKodZalecenia ?? undefined);
		setIsFormOpen(true);
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

		setIsDeletingItem(true);
		setError(null);

		const result = await deleteObligatingDecision(
			operatorLogin,
			selectedItem.id,
		);
		if (!result.ok) {
			if (result.status === 404) {
				setIsDeleteConfirmModalOpen(false);
				await loadItems();
				setIsDeletingItem(false);
				return;
			}

			if (result.status === 403) {
				setError("Brak uprawnień do usunięcia rekordu.");
			} else {
				setError(result.error);
			}
			setIsDeletingItem(false);
			return;
		}

		setItems((prev) => prev.filter((item) => item.id !== selectedItem.id));
		setTotal((prev) => Math.max(0, prev - 1));
		setSelectedId(null);
		setIsDeleteConfirmModalOpen(false);
		setIsDeletingItem(false);
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
		setIsSubmitting(false);
	};
	closeModalRef.current = closeModal;

	const handleRefreshAfterConflict = async () => {
		if (!editingItem) {
			return;
		}

		const result = await fetchObligatingDecisions(operatorLogin);
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
		setForm(mapDecisionToForm(refreshed));
		setFormError(null);
		setVersionConflictUpdatedAt(null);
		setSaveLockConflict(null);
	};

	const handleRecommendationChange = (kodZalecenia: string) => {
		const selected =
			availableRecommendations.find(
				(item) => item.kodZalecenia === kodZalecenia,
			) ?? null;

		setForm((prev) => ({
			...prev,
			recommendationKodZalecenia: kodZalecenia,
			nazwaPodmiotu: selected ? selected.nazwaPodmiotu : prev.nazwaPodmiotu,
		}));

		void loadFirstInstancePeople(kodZalecenia).then((options) => {
			const allowedIds = new Set(options.map((option) => option.id));
			setForm((prev) => ({
				...prev,
				osobyProwadzaceIInstancjeIds: prev.osobyProwadzaceIInstancjeIds.filter(
					(id) => allowedIds.has(id),
				),
			}));
		});
	};

	const openAdvancedFilterForColumn = (
		columnKey: DecisionColumnKey,
		triggerElement: HTMLElement,
	) => {
		setAdvancedFilterAnchor(getFloatingPanelAnchor(triggerElement));
		setAdvancedFilterColumnKey(columnKey);
		setAdvancedFilterSearch("");
		setIsAdvancedFilterModalOpen(true);
	};

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!canManageDecisions) {
			setFormError("Konto zewnętrzne ma dostęp tylko do odczytu.");
			return;
		}

		if (shouldShowLockedByOtherUser) {
			setFormError(
				"Nie możesz teraz edytować tego wpisu, ponieważ jest edytowany przez innego użytkownika.",
			);
			return;
		}

		const isCreateMode = !editingItem;

		if (editingItem && !hasAnyDecisionEditPermission(editingItem, authRole)) {
			setFormError("Brak uprawnień do edycji tego rekordu.");
			return;
		}

		const isRequiredRecommendationMissing =
			!form.recommendationKodZalecenia.trim();
		const isRequiredFirstInstancePeopleMissing =
			isCreateMode && form.osobyProwadzaceIInstancjeIds.length === 0;
		const isRequiredSecondInstancePeopleMissing =
			isCreateMode &&
			isSecondInstanceUnlocked &&
			form.osobyProwadzaceIIInstancjeIds.length === 0;
		const hasMissingRequiredFields =
			isRequiredRecommendationMissing ||
			isRequiredFirstInstancePeopleMissing ||
			isRequiredSecondInstancePeopleMissing;

		setShowRequiredFieldErrors(true);

		if (hasMissingRequiredFields) {
			setFormError(null);
			return;
		}

		const payload = createWritePayload(form);
		if (!payload.recommendationKodZalecenia) {
			setFormError(null);
			return;
		}

		if (!editingItem && form.osobyProwadzaceIInstancjeIds.length === 0) {
			setFormError(null);
			return;
		}

		if (
			!editingItem &&
			isSecondInstanceUnlocked &&
			form.osobyProwadzaceIIInstancjeIds.length === 0
		) {
			setFormError(null);
			return;
		}

		setShowRequiredFieldErrors(false);
		setFormError(null);
		setIsSubmitting(true);
		setVersionConflictUpdatedAt(null);
		setSaveLockConflict(null);

		try {
			if (editingItem) {
				const basePayload = createWritePayload(mapDecisionToForm(editingItem));
				const patchPayload = createPatchPayload(payload, basePayload);
				const effectivePermissions = {
					...getDecisionEditPermissions(editingItem, authRole),
					canAssignIInstancePeople,
					canAssignIIInstancePeople,
				};
				const allowedPatchPayload = filterPatchPayloadByPermissions(
					patchPayload,
					effectivePermissions,
				);

				if (Object.keys(patchPayload).length > 0 && Object.keys(allowedPatchPayload).length === 0) {
					setFormError("Brak uprawnień do zapisania zmienionych pól.");
					setIsSubmitting(false);
					return;
				}

				if (Object.keys(allowedPatchPayload).length === 0) {
					setFormError("Brak zmian do zapisania.");
					setIsSubmitting(false);
					return;
				}

				const result = await updateObligatingDecision(
					operatorLogin,
					editingItem.id,
					allowedPatchPayload,
					{
						expectedUpdatedAt: editingItem.zaktualizowanoO,
						lockToken: editRecordLock.lockToken,
					},
				);
				if (!result.ok) {
					if (result.status === 423) {
						if (result.lockErrorCode === "RECORD_LOCKED") {
							setSaveLockConflict(result.lockConflict ?? null);
							setFormError(
								"Nie możesz teraz edytować tego wpisu, ponieważ jest edytowany przez innego użytkownika.",
							);
							setIsSubmitting(false);
							return;
						}

						setSaveLockConflict(null);
						setFormError(result.error);
						setIsSubmitting(false);
						return;
					}

					if (result.status === 409) {
						setVersionConflictUpdatedAt(result.currentUpdatedAt ?? null);
						setFormError(
							"Dane zostały zmienione przez innego użytkownika. Odśwież widok i spróbuj ponownie.",
						);
						setIsSubmitting(false);
						return;
					}

					if (result.status === 403 && result.errorCode) {
						if (result.errorCode === "PERMISSION_DENIED_I_INSTANCE") {
							setFormError("Brak uprawnień do edycji pól I instancji.");
						} else if (result.errorCode === "PERMISSION_DENIED_II_INSTANCE") {
							setFormError("Brak uprawnień do edycji pól II instancji.");
						} else {
							setFormError(result.error);
						}
					} else {
						setFormError(result.error);
					}
					setIsSubmitting(false);
					return;
				}
			} else {
				const createPayload = compactCreatePayload(payload);
				const result = await createObligatingDecision(
					operatorLogin,
					createPayload,
				);
				if (!result.ok) {
					if (result.status === 403 && result.errorCode === "PERMISSION_DENIED_CREATE_FOR_RECOMMENDATION") {
						setFormError("Brak uprawnień do utworzenia decyzji dla wybranego zalecenia.");
					} else if (result.status === 400 && result.errorCode === "VALIDATION_RECOMMENDATION_REQUIRED") {
						setFormError("Wybierz id zalecenia.");
					} else {
						setFormError(result.error);
					}
					setIsSubmitting(false);
					return;
				}
			}

			closeModal();
			setSuccessEntityName(payload.nazwaPodmiotu ?? "");
			setSuccessRecommendationCode(payload.recommendationKodZalecenia ?? "");
			setSuccessMode(isCreateMode ? "create" : "edit");
			setIsSuccessModalOpen(true);
			void loadItems();
		} catch {
			setFormError("Nie udało się zapisać decyzji zobowiązującej.");
			setIsSubmitting(false);
		}
	};

	const isRequiredRecommendationMissing =
		showRequiredFieldErrors && !form.recommendationKodZalecenia.trim();
	const isRequiredFirstInstancePeopleMissing =
		showRequiredFieldErrors &&
		!editingItem &&
		form.osobyProwadzaceIInstancjeIds.length === 0;
	const isRequiredSecondInstancePeopleMissing =
		showRequiredFieldErrors &&
		!editingItem &&
		isSecondInstanceUnlocked &&
		form.osobyProwadzaceIIInstancjeIds.length === 0;

	const handleExportCurrentView = async (
		recommendationColumnKeys: RecommendationExportColumnKey[],
		inspectionColumnKeys: InspectionExportColumnKey[],
		sanctionColumnKeys: SanctionExportColumnKey[],
		includeRecommendations: boolean,
		includeInspections: boolean,
		includeSanctions: boolean,
	) => {
		if (isExporting || filteredAndSortedItems.length === 0) {
			return;
		}

		setIsExporting(true);
		setError(null);

		try {
			const workbook = await createStyledExportWorkbook(
				"Decyzje zobowiązujące",
			);

			const [recommendationsResult, inspectionsResponse, sanctionsResult] =
				await Promise.all([
					fetchRecommendations(operatorLogin, {
						sortBy: "id",
						sortOrder: "asc",
					}),
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
				]);

			const rawInspectionRows: unknown[] = [];
			if (inspectionsResponse.ok) {
				const payload = (await inspectionsResponse.json()) as
					| unknown[]
					| { items?: unknown[] };
				const rows = Array.isArray(payload) ? payload : (payload.items ?? []);
				rawInspectionRows.push(...rows);
			}

			const mappedInspections = rawInspectionRows.map((rawRow, index) =>
				normalizeInspectionRow((rawRow ?? {}) as RawInspectionRow, index),
			);

			const decisionCodes = new Set(
				filteredAndSortedItems
					.map((item) =>
						String(item.recommendationKodZalecenia ?? "")
							.trim()
							.toUpperCase(),
					)
					.filter((code) => code.length > 0),
			);

			const recommendationsSource = recommendationsResult.ok
				? recommendationsResult.data.items
				: [];

			const recommendationByCode = new Map<
				string,
				(typeof recommendationsSource)[number]
			>();
			for (const recommendation of recommendationsSource) {
				const code = String(recommendation.kodZalecenia ?? "")
					.trim()
					.toUpperCase();
				if (!code || recommendationByCode.has(code)) {
					continue;
				}
				recommendationByCode.set(code, recommendation);
			}

			const relatedRecommendations = Array.from(decisionCodes)
				.map((code) => recommendationByCode.get(code) ?? null)
				.filter(
					(item): item is (typeof recommendationsSource)[number] =>
						item !== null,
				);

			const relatedInspectionIds = new Set(
				relatedRecommendations
					.map((item) => item.inspectionId)
					.filter(
						(value): value is number =>
							typeof value === "number" && Number.isFinite(value) && value > 0,
					),
			);

			const relatedInspections = mappedInspections.filter((row) =>
				relatedInspectionIds.has(Number(row.id)),
			);

			const relatedSanctionsSource = sanctionsResult.ok
				? sanctionsResult.data.items
				: [];
			const relatedSanctions = relatedSanctionsSource.filter(
				(item) =>
					typeof item.inspectionId === "number" &&
					relatedInspectionIds.has(item.inspectionId),
			);

			const inspectionCodeById = new Map(
				relatedInspections.map((row) => [Number(row.id), row.kodInspekcji]),
			);

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

				const inspectionId = Number(payload.inspectionId);
				if (Number.isFinite(inspectionId) && inspectionId > 0) {
					return String(inspectionCodeById.get(inspectionId) ?? inspectionId);
				}

				return "";
			};

			const isNotApplicableByInspectionType = (
				inspectionType: string,
				columnKey: InspectionExportColumnKey,
			) => {
				const normalizedType = inspectionType.trim().toLowerCase();
				const isControlType =
					normalizedType.includes("kontrol") ||
					normalizedType.startsWith("kont") ||
					normalizedType === "k";
				const isSupervisoryVisitType =
					normalizedType.includes("wizyta") ||
					normalizedType.startsWith("wiz") ||
					normalizedType === "w";

				if (isControlType && !isSupervisoryVisitType) {
					return (
						columnKey === "dataAkceptacjiSprawozdania" ||
						columnKey === "dataDoreczeniaPisma"
					);
				}

				if (isSupervisoryVisitType && !isControlType) {
					return (
						columnKey === "dataDoreczeniaProtokolu" ||
						columnKey === "dataWyslaniaPismaZOdpowiedzia" ||
						columnKey === "dataPismaZOdpowiedzia"
					);
				}

				return false;
			};

			const decisionHeaders = [
				"Lp.",
				"Id decyzji",
				"Id zalecenia",
				"Nazwa podmiotu",
				"Liczba zaleceń",
				"Data wszczęcia postępowania administracyjnego I instancji",
				"Osoby prowadzące I instancję",
				"Data decyzji I instancji",
				"Data doręczenia decyzji I instancji",
				"Rozstrzygnięcie I instancji",
				"Data wniosku o ponowne rozpatrzenie sprawy",
				"Data wpływu wniosku o ponowne rozpatrzenie sprawy",
				"Osoby prowadzące II instancję",
				"Data decyzji II instancji",
				"Data doręczenia decyzji II instancji",
				"Rozstrzygnięcie II instancji",
			];

			const decisionRows = filteredAndSortedItems.map((item, index) => [
				String(index + 1),
				item.kodDecyzji ?? "",
				item.recommendationKodZalecenia ?? "",
				item.nazwaPodmiotu ?? "",
				item.liczbaZalecen === null ? "" : String(item.liczbaZalecen),
				item.dataWszczeciaPostepowaniaIInstancji ?? "",
				normalizeStringList(item.osobyProwadzaceIInstancjeList ?? []).join(
					", ",
				),
				item.dataDecyzjiIInstancji ?? "",
				item.dataDoreczeniaDecyzjiIInstancji ?? "",
				item.rozstrzygniecieI ?? "",
				item.dataWnioskuPonowneRozpatrzenie ?? "",
				item.dataWplywuWnioskuPonowneRozpatrzenie ?? "",
				normalizeStringList(item.osobyProwadzaceIIInstancjeList ?? []).join(
					", ",
				),
				item.dataDecyzjiIIInstancji ?? "",
				item.dataDoreczeniaDecyzjiIIInstancji ?? "",
				item.rozstrzygniecieII ?? "",
			]);

			addWorksheetWithStyles(
				workbook,
				"Decyzje zobowiązujące",
				decisionHeaders,
				decisionRows,
			);

			if (includeRecommendations && recommendationColumnKeys.length > 0) {
				const recommendationHeaders = recommendationColumnKeys.map(
					(key) =>
						RECOMMENDATION_EXPORT_COLUMNS.find((column) => column.key === key)
							?.label ?? key,
				);
				const recommendationRows = relatedRecommendations.map((item) =>
					recommendationColumnKeys.map((key) => {
						switch (key) {
							case "lp":
								return String(item.lp);
							case "kodZalecenia":
								return String(item.kodZalecenia ?? "").trim();
							case "inspectionLp":
								return resolveInspectionCode({
									inspectionKod: item.inspectionKod,
									kodInspekcji: item.kodInspekcji,
									inspectionLp: item.inspectionLp,
									inspectionId: item.inspectionId,
								});
							case "nazwaPodmiotu":
								return item.nazwaPodmiotu ?? "";
							case "pozycja":
								return String(item.pozycja ?? "");
							case "terminWykonaniaZalecen":
								return item.terminWykonaniaZalecen ?? "";
							case "dataZalecenList":
								return item.dataZalecenList.join(", ");
							case "dataAkceptacjiNotyWeryfikacjiList":
								return item.dataAkceptacjiNotyWeryfikacjiList.join(", ");
							case "status":
								return item.status ?? "";
							case "komentarz":
								return item.komentarz ?? "";
						}
					}),
				);
				addWorksheetWithStyles(
					workbook,
					"Zalecenia",
					recommendationHeaders,
					recommendationRows,
				);
			}

			if (includeInspections && inspectionColumnKeys.length > 0) {
				const inspectionHeaders = inspectionColumnKeys.map(
					(key) =>
						INSPECTION_EXPORT_COLUMNS.find((column) => column.key === key)
							?.label ?? key,
				);
				const inspectionRows = relatedInspections.map((row) =>
					inspectionColumnKeys.map((key) => {
						if (isNotApplicableByInspectionType(String(row.typInspekcji ?? ""), key)) {
							return "Nie dotyczy";
						}

						return String(row[key] ?? "");
					}),
				);
				addWorksheetWithStyles(
					workbook,
					"Inspekcje",
					inspectionHeaders,
					inspectionRows,
				);
			}

			if (includeSanctions && sanctionColumnKeys.length > 0) {
				const sanctionHeaders = sanctionColumnKeys.map(
					(key) =>
						SANCTION_EXPORT_COLUMNS.find((column) => column.key === key)
							?.label ?? key,
				);
				const sanctionRows = relatedSanctions.map((item) =>
					sanctionColumnKeys.map((key) => {
						switch (key) {
							case "lp":
								return String(item.lp);
							case "requestId":
								return String(item.kodSankcji ?? item.lp ?? "").trim();
							case "inspectionLp":
								return resolveInspectionCode({
									inspectionKod: item.inspectionKod,
									kodInspekcji: item.kodInspekcji,
									inspectionLp: item.inspectionLp,
									inspectionId: item.inspectionId,
								});
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
					}),
				);
				addWorksheetWithStyles(
					workbook,
					"Wnioski sankcyjne",
					sanctionHeaders,
					sanctionRows,
				);
			}

			const fileName = "decyzje-zobowiazujace-zalecenia-inspekcje-sankcje.xlsx";
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

		setIncludeRecommendationsInExport(false);
		setIncludeInspectionsInExport(false);
		setIncludeSanctionsInExport(false);
		setActiveExportColumnsTab("recommendations");
		setIsExportConfigModalOpen(true);
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

	const handleConfirmExportFromModal = () => {
		if (
			(includeRecommendationsInExport &&
				selectedRecommendationExportColumns.length === 0) ||
			(includeInspectionsInExport &&
				selectedInspectionExportColumns.length === 0) ||
			(includeSanctionsInExport && selectedSanctionExportColumns.length === 0)
		) {
			return;
		}

		const orderedRecommendationColumns = RECOMMENDATION_EXPORT_COLUMNS.map(
			(column) => column.key,
		).filter((key) => selectedRecommendationExportColumns.includes(key));

		const orderedInspectionColumns = INSPECTION_EXPORT_COLUMNS.map(
			(column) => column.key,
		).filter((key) => selectedInspectionExportColumns.includes(key));

		const orderedSanctionColumns = SANCTION_EXPORT_COLUMNS.map(
			(column) => column.key,
		).filter((key) => selectedSanctionExportColumns.includes(key));

		setIsExportConfigModalOpen(false);
		void handleExportCurrentView(
			orderedRecommendationColumns,
			orderedInspectionColumns,
			orderedSanctionColumns,
			includeRecommendationsInExport,
			includeInspectionsInExport,
			includeSanctionsInExport,
		);
	};

	return (
		<>
			<TableFullscreenContainer
				isFullscreen={isFullscreen}
				onClose={() => setIsFullscreen(false)}
				className="relative flex h-full min-h-0 w-full flex-col rounded-2xl border border-slate-700/70 bg-[#101f39] px-2 pt-4 pb-2 sm:px-2 sm:pt-5 sm:pb-2"
			>
				{!isFullscreen ? (
			<TablePanelToolbar
				title="Decyzje zobowiązujące"
				canClearFilters={canClearFilters}
				canResetColumnWidths={hasCustomColumnWidths}
				isExporting={isExporting}
				hasRowsToExport={filteredAndSortedItems.length > 0}
				onOpenViewModal={handleOpenDecisionViewModal}
				isFullscreen={isFullscreen}
				onToggleFullscreen={() => setIsFullscreen((prev) => !prev)}
				onClearFilters={clearFilters}
				onResetColumnWidths={handleResetColumnWidths}
				onExport={handleOpenExportConfigModal}
				actions={
					<>
						{canManageDecisions ? (
							<>
								<button
									type="button"
									onClick={() => void openCreateModal()}
									disabled={!canCreateDecision}
									title={
										canCreateDecision
											? undefined
											: canManageDecisions
												? "Brak uprawnień do dodania decyzji dla dostępnych zaleceń"
												: "Konto zewnętrzne ma dostęp tylko do odczytu"
									}
									className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 font-semibold text-sm transition-colors enabled:border-[#8ec5a1] enabled:bg-[#b9e8c9] enabled:text-[#1f5130] enabled:hover:bg-[#a5debb] disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-[#1a2946] disabled:text-slate-500"
								>
									<Plus size={15} />
									Dodaj decyzję
								</button>

								<button
									type="button"
									onClick={() => void openEditModal()}
									disabled={
										!selectedItem ||
										!hasAnyDecisionEditPermission(selectedItem, authRole)
									}
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
				tableClassName="min-w-575 border-collapse text-slate-900 text-sm"
				visibleColumns={visibleDecisionColumnDefinitions.map((column) => ({
					...column,
					tooltip: DECISION_COLUMN_TOOLTIPS[column.key],
				}))}
				sortColumnKey={sortColumnKey}
				sortDirection={sortDirection}
				advancedFilters={advancedFilters}
				columnFilters={columnFilters}
				onSortByColumn={handleSortByColumn}
				onOpenAdvancedFilter={openAdvancedFilterForColumn}
				onFilterChange={handleFilterChange}
				columnWidths={columnWidths}
				onResizeColumn={handleResizeColumn}
				minColumnWidth={OBLIGATING_DECISIONS_MIN_COLUMN_WIDTH}
				controlsInFilterRow
				wrapHeaderLabels
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
					<tbody>
						{paginatedDecisionItems.map((item, rowIndex) => {
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
									{visibleDecisionColumnDefinitions.map((column) => {
										const isPeopleListColumn =
											column.key === "osobyProwadzaceIInstancjeList" ||
											column.key === "osobyProwadzaceIIInstancjeList";
										const peopleValues = isPeopleListColumn
											? normalizeStringList(
													column.key === "osobyProwadzaceIInstancjeList"
														? (item.osobyProwadzaceIInstancjeList ?? [])
														: (item.osobyProwadzaceIIInstancjeList ?? []),
											  )
											: [];
										const rawValue =
											column.key === "lp"
												? String((currentPage - 1) * pageSize + rowIndex + 1)
												: isPeopleListColumn
													? (peopleValues.length > 0 ? peopleValues.join("\n") : "-")
													: getCellValue(item, column.key) || "-";
										const value = formatDatesInDisplayText(rawValue);
										const recommendationCode =
											column.key === "recommendationKodZalecenia"
												? String(item.recommendationKodZalecenia ?? "").trim()
												: "";
										const hasRecommendationLink =
											column.key === "recommendationKodZalecenia" &&
											recommendationCode.length > 0;
										const cellTooltipValue = value !== "-" ? value : undefined;

										return (
											<td
												key={column.key}
												className="break-words whitespace-normal px-3 py-2.5 align-top"
											>
												<div
													className="subtle-vertical-scroll w-full overflow-y-auto pr-1 whitespace-normal break-words leading-5"
													style={{ maxHeight: `${OBLIGATING_DECISIONS_MAX_ROW_HEIGHT_PX}px` }}
													title={cellTooltipValue}
												>
													{hasRecommendationLink ? (
														<button
															type="button"
															onClick={(event) => {
																event.stopPropagation();
																openRecommendationFromDashboard(recommendationCode);
															}}
															className="cursor-pointer rounded px-1 text-left text-[#1f4f8f] underline decoration-[#9bb8de] underline-offset-2 transition-colors hover:text-[#163a68]"
															title={`Przejdź do rejestru Zalecenia i zaznacz ten rekord: ${value}`}
														>
															{value}
														</button>
													) : isPeopleListColumn && peopleValues.length > 0 ? (
														<div className="space-y-0.5">
															{peopleValues.map((person, index) => (
																<p key={`${column.key}-${item.id}-${person}-${index}`}>
																	{index + 1}. {person}
																</p>
															))}
														</div>
													) : (
														value
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
									colSpan={visibleDecisionColumnDefinitions.length}
									className="px-3 py-6 text-center text-slate-500 text-sm"
								>
									Brak rekordów. Łącznie: {total}.
								</td>
							</tr>
						) : null}
					</tbody>
			</RegistryDataTable>

			<TableAdvancedFilterModal
				isOpen={isAdvancedFilterModalOpen}
				anchor={advancedFilterAnchor}
				columnLabel={
					DECISION_COLUMNS.find(
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

			<TableColumnPickerModal<DecisionColumnKey, never>
				isOpen={isColumnPickerOpen}
				columns={DECISION_COLUMNS}
				hiddenColumns={draftHiddenColumns}
				visibleColumnsCount={draftVisibleDecisionColumns.length}
				onClose={() => setIsColumnPickerOpen(false)}
				onChangeColumnVisibility={handleDraftColumnVisibilityChange}
				onChangeColumnDisplayMode={(columnKey, value) => {
					if (!isDecisionNameVariantColumnKey(columnKey)) {
						return;
					}

					if (value !== "full" && value !== "short") {
						return;
					}

					setDraftDecisionNameVariants((prev) => ({
						...prev,
						[columnKey]: value,
					}));
				}}
				columnDisplayModeOptions={columnDisplayModeOptionsByKey}
				columnDisplayModeValues={draftColumnDisplayModeValuesByKey}
				onResetSelection={handleResetDecisionViewSelection}
				onShowAllColumns={handleDraftSelectAllColumns}
				onHideAllColumns={handleDraftDeselectAllColumns}
				onApply={handleApplyDecisionViewChanges}
				title="Widok tabeli"
			/>

			<ExportConfigModal
				isOpen={isExportConfigModalOpen}
				description="Decyzje zobowiązujące eksportują aktualny widok tabeli. Wybierz dane powiązane."
				relationsLabel="Powiąż wybrane decyzje z:"
				relations={[
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
				]}
				tabs={[
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
							toggleSanctionExportColumn(
								key as SanctionExportColumnKey,
								isSelected,
							),
						onSelectAll: () =>
							setSelectedSanctionExportColumns(
								SANCTION_EXPORT_COLUMNS.map((column) => column.key),
							),
					},
				]}
				activeTabId={activeExportColumnsTab}
				onActiveTabChange={(tabId) =>
					setActiveExportColumnsTab(
						tabId as "recommendations" | "inspections" | "sanctions",
					)
				}
				onClose={() => setIsExportConfigModalOpen(false)}
				onConfirm={handleConfirmExportFromModal}
				isConfirmDisabled={
					isExporting ||
					(includeRecommendationsInExport &&
						selectedRecommendationExportColumns.length === 0) ||
					(includeInspectionsInExport &&
						selectedInspectionExportColumns.length === 0) ||
					(includeSanctionsInExport &&
						selectedSanctionExportColumns.length === 0)
				}
				isExporting={isExporting}
			/>

			<RegistryFormScaffold
				isOpen={isFormOpen}
				title={
					editingItem
						? "Edytuj decyzję zobowiązującą"
						: "Dodaj decyzję zobowiązującą"
				}
				subtitle={
					editingItem
						? `Id decyzji: ${editingItem.kodDecyzji} | Utworzone przez: ${
							(editingItem.createdByDisplayName ?? editingItem.createdByLogin ?? "").trim() ||
							"-"
						}`
						: undefined
				}
				onClose={closeModal}
				onSubmit={handleSubmit}
				isContentReadOnly={isReadOnlyDueToLock}
				closeOnBackdropClick={false}
				maxWidthClassName="max-w-6xl"
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
						{isLookupsLoading ? (
							<p className="mb-2 text-slate-600 text-sm">Ładowanie słowników...</p>
						) : null}
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
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.25fr_1fr_1fr]">
									<SingleSelectPortalField
										label="Powiązanie z zaleceniami"
										value={form.recommendationKodZalecenia}
										options={recommendationOptionsForForm.map((entry) => ({
											value: entry.kodZalecenia,
											label: `${entry.kodZalecenia} - ${getRecommendationDisplayName(entry)}`,
										}))}
										enableSearch
										searchPlaceholder="Wyszukaj zalecenie..."
										placeholder={
											recommendationOptionsForForm.length === 0
												? "Brak dostępnych zaleceń"
												: "Wybierz powiązanie"
										}
										invalid={isRequiredRecommendationMissing}
										errorMessage={
											isRequiredRecommendationMissing ? "Pole wymagane." : null
										}
										onChange={handleRecommendationChange}
										disabled={isEditMode || recommendationOptionsForForm.length === 0}
									/>

									<label className="text-slate-700 text-sm">
										<span className="mb-1 block">Nazwa podmiotu</span>
										<input
											value={selectedRecommendationEntityDisplayName}
											onChange={(event) =>
												setForm((prev) => ({
													...prev,
													nazwaPodmiotu: event.target.value,
												}))
											}
											disabled
											className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-700"
										/>
									</label>

									<div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-semibold text-slate-700 text-sm sm:col-span-2 lg:col-span-3">
										<span>I instancja</span>
										{!canEditIInstance && !canAssignIInstancePeople ? (
											<span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 font-medium text-amber-800 text-xs">
												Brak uprawnień do edycji pól I instancji
											</span>
										) : !canEditIInstance ? (
											<span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 font-medium text-amber-800 text-xs">
												Możliwa jest tylko zmiana osób I instancji
											</span>
										) : null}
									</div>

									<DateFieldWithClear
										label="Data wszczęcia postępowania administracyjnego I instancji"
										value={form.dataWszczeciaPostepowaniaIInstancji}
										disabled={!canEditIInstance}
										onChange={(next) =>
											setForm((prev) => ({
												...prev,
												dataWszczeciaPostepowaniaIInstancji: next,
											}))
										}
									/>

									<MultiSelectPeopleField
										label="Osoby prowadzące I instancję *"
										options={firstInstancePersonOptions}
										values={form.osobyProwadzaceIInstancjeIds}
										invalid={isRequiredFirstInstancePeopleMissing}
										errorMessage={
											isRequiredFirstInstancePeopleMissing ? "Pole wymagane." : null
										}
										disabled={!canAssignIInstancePeople}
										onChange={(next) =>
											setForm((prev) => ({
												...prev,
												osobyProwadzaceIInstancjeIds: next,
											}))
										}
									/>

									<DateFieldWithClear
										label="Data decyzji I instancji"
										value={form.dataDecyzjiIInstancji}
										disabled={!canEditIInstance}
										onChange={(next) =>
											setForm((prev) => ({
												...prev,
												dataDecyzjiIInstancji: next,
											}))
										}
									/>

									<DateFieldWithClear
										label="Data doręczenia decyzji I instancji"
										value={form.dataDoreczeniaDecyzjiIInstancji}
										disabled={!canEditIInstance}
										onChange={(next) =>
											setForm((prev) => ({
												...prev,
												dataDoreczeniaDecyzjiIInstancji: next,
											}))
										}
									/>

									<SingleSelectPortalField
										label="Rozstrzygnięcie I instancji"
										value={form.rozstrzygniecieIId}
										options={resolutionIOptions.map((entry) => ({
											value: String(entry.id),
											label: entry.name,
										}))}
										enableSearch
										searchPlaceholder="Wyszukaj rozstrzygnięcie..."
										placeholder="Wybierz"
										disabled={!canEditIInstance}
										onChange={(next) =>
											setForm((prev) => ({
												...prev,
												rozstrzygniecieIId: next,
											}))
										}
									/>

									<DateFieldWithClear
										label="Data wniosku o ponowne rozpatrzenie sprawy"
										value={form.dataWnioskuPonowneRozpatrzenie}
										disabled={!canEditIInstance}
										onChange={(next) =>
											setForm((prev) => ({
												...prev,
												dataWnioskuPonowneRozpatrzenie: next,
											}))
										}
									/>

									<DateFieldWithClear
										label="Data wpływu wniosku o ponowne rozpatrzenie sprawy"
										value={form.dataWplywuWnioskuPonowneRozpatrzenie}
										disabled={!canEditIInstance}
										onChange={(next) =>
											setForm((prev) => ({
												...prev,
												dataWplywuWnioskuPonowneRozpatrzenie: next,
												...(next.trim()
													? {}
													: {
															osobyProwadzaceIIInstancjeIds: [],
															dataDecyzjiIIInstancji: "",
															dataDoreczeniaDecyzjiIIInstancji: "",
															rozstrzygniecieIIId: "",
													}),
											}))
										}
									/>

									<div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-semibold text-slate-700 text-sm sm:col-span-2 lg:col-span-3">
										<span className="inline-flex items-center gap-1.5">
											<span>II instancja</span>
											{secondInstanceInfoTooltip ? (
												<span
													title={secondInstanceInfoTooltip}
													aria-label={secondInstanceInfoTooltip}
													className="inline-flex h-5 w-5 items-center justify-center rounded-full text-amber-600"
												>
													<CircleAlert size={14} />
												</span>
											) : null}
										</span>
									</div>

									<MultiSelectPeopleField
										label="Osoby prowadzące II instancję"
										options={secondInstancePersonOptions}
										values={form.osobyProwadzaceIIInstancjeIds}
										invalid={isRequiredSecondInstancePeopleMissing}
										errorMessage={
											isRequiredSecondInstancePeopleMissing ? "Pole wymagane." : null
										}
										disabled={isSecondInstancePeopleDisabled}
										onChange={(next) =>
											setForm((prev) => ({
												...prev,
												osobyProwadzaceIIInstancjeIds: next,
											}))
										}
									/>

									<DateFieldWithClear
										label="Data decyzji II instancji"
										value={form.dataDecyzjiIIInstancji}
										disabled={isSecondInstanceFieldsDisabled}
										onChange={(next) =>
											setForm((prev) => ({
												...prev,
												dataDecyzjiIIInstancji: next,
											}))
										}
									/>

									<DateFieldWithClear
										label="Data doręczenia decyzji II instancji"
										value={form.dataDoreczeniaDecyzjiIIInstancji}
										disabled={isSecondInstanceFieldsDisabled}
										onChange={(next) =>
											setForm((prev) => ({
												...prev,
												dataDoreczeniaDecyzjiIIInstancji: next,
											}))
										}
									/>

									<SingleSelectPortalField
										label="Rozstrzygnięcie II instancji"
										value={form.rozstrzygniecieIIId}
										options={resolutionIIOptions.map((entry) => ({
											value: String(entry.id),
											label: entry.name,
										}))}
										enableSearch
										searchPlaceholder="Wyszukaj rozstrzygnięcie..."
										placeholder="Wybierz"
										disabled={isSecondInstanceFieldsDisabled}
										onChange={(next) =>
											setForm((prev) => ({
												...prev,
												rozstrzygniecieIIId: next,
											}))
										}
									/>

									<label className="text-slate-700 text-sm sm:col-span-2 lg:col-span-3">
										<span className="mb-1 block">Komentarz</span>
										<textarea
											rows={2}
											value={form.komentarz}
											disabled={!canEditComment}
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

			<ObligatingDecisionsSuccessModal
				isOpen={isSuccessModalOpen}
				entityName={successEntityName}
				recommendationCode={successRecommendationCode}
				mode={successMode}
				onClose={() => {
					setIsSuccessModalOpen(false);
					setSuccessEntityName("");
					setSuccessRecommendationCode("");
					setSuccessMode("create");
				}}
			/>

			{isDeleteConfirmModalOpen ? (
				<div className="fixed inset-0 z-60 flex items-center justify-center p-4">
					<button
						type="button"
						aria-label="Zamknij potwierdzenie usunięcia decyzji"
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
						aria-label="Potwierdzenie usunięcia decyzji zobowiązującej"
						className="relative z-10 w-full max-w-lg rounded-2xl border border-slate-300 bg-white p-5 text-slate-900 shadow-[0_24px_56px_rgba(2,8,23,0.35)]"
					>
						<h3 className="font-semibold text-base text-slate-900">
							Usuń decyzję zobowiązującą
						</h3>
						<p className="mt-2 text-slate-700 text-sm">
							Czy usunąć decyzję zobowiązującą?
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
