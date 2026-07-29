"use client";

import { Eye, Pencil, Plus, Trash2 } from "lucide-react";
import {
	type SetStateAction,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import type { AuthRole } from "@/app/_components/home-tabs/types";
import { fetchDictionaryEntries } from "@/features/dictionaries/api";
import { INSPECTION_VIEW_OPTIONS } from "@/features/inspections/data";
import {
	type AddInspectionForm,
	type DictionarySelectOption,
	type InspectionListResponse,
	type InspectionPeopleOption,
	type RawInspectionRow,
	getBaseInspectionColumnKeys,
	getInspectionApiErrorMessage,
	getUserDisplayName,
	joinMultiValueField,
	mapDictionaryEntriesToOptions,
	mapDictionaryEntriesToSelectOptions,
	mapRowToAddForm,
	normalizeInspectionRow,
} from "@/features/inspections/components/inspections-panel.utils";
import { InspectionsDataTable } from "@/features/inspections/components/inspections-panel/InspectionsDataTable";
import { InspectionsFormModal } from "@/features/inspections/components/inspections-panel/InspectionsFormModal";
import { InspectionsPreviewModal } from "@/features/inspections/components/inspections-panel/InspectionsPreviewModal";
import { useInspectionsTableState } from "@/features/inspections/hooks/useInspectionsTableState";
import { fetchObligatingDecisions } from "@/features/obligating-decisions/api";
import { fetchRecommendations } from "@/features/recommendations/api";
import { fetchSanctionRequests } from "@/features/sanction-requests/api";
import { EntitySuccessModal } from "@/shared/components/EntitySuccessModal";
import { ExportConfigModal } from "@/shared/components/export/ExportConfigModal";
import { TableAdvancedFilterModal } from "@/shared/components/table/TableAdvancedFilterModal";
import { TableColumnPickerModal } from "@/shared/components/table/TableColumnPickerModal";
import { TableFullscreenContainer } from "@/shared/components/table/TableFullscreenContainer";
import { TablePagination } from "../../../shared/components/table/TablePagination";
import { TablePanelToolbar } from "@/shared/components/table/TablePanelToolbar";
import { useInactivityTimeout } from "@/shared/hooks/useInactivityTimeout";
import { useRecordLock } from "@/shared/hooks/useRecordLock";

const INACTIVITY_TIMEOUT_MS = 5 * 60_000; // 5 minut
const INACTIVITY_WARNING_MS = 60_000; // 1 minuta ostrzeżenia
const TABLE_PAGE_SIZE_OPTIONS = [20, 30, 50, 70, 100];
const INSPECTIONS_COLUMN_WIDTHS_STORAGE_PREFIX =
	"triangle.ui.inspections.column-widths";
const INSPECTIONS_NAME_VARIANTS_STORAGE_PREFIX =
	"triangle.ui.inspections.name-variants";
const INSPECTIONS_TABLE_VIEW_STORAGE_PREFIX =
	"triangle.ui.inspections.table-view";
const INSPECTIONS_QUICK_FILTER_TEAM_LABELS_STORAGE_PREFIX =
	"triangle.ui.inspections.quick-filter-team-labels";
const INSPECTIONS_QUICK_FILTER_SELECTIONS_STORAGE_PREFIX =
	"triangle.ui.inspections.quick-filter-selections";
const INSPECTIONS_DATE_COLUMN_WIDTH = 125;
const INSPECTIONS_EXTENDED_DATE_COLUMN_WIDTH = 145;
const INSPECTIONS_SCOPE_DETAILS_COLUMN_WIDTH = 320;
// Manualna konfiguracja szerokosci kolumn tabeli Inspekcji (wartosci w px).
const DEFAULT_INSPECTIONS_COLUMN_WIDTHS: Partial<
	Record<InspectionColumnKey, number>
> = {
	lp: 80,
	kodInspekcji: 132,
	nazwaPodmiotu: 140,
	typInspekcji: 140,
	zakresInspekcji: 280,
	szczegolyDotyczaceZakresu: INSPECTIONS_SCOPE_DETAILS_COLUMN_WIDTH,
	aspektKonsumencki: 125,
	poczatekInspekcji: INSPECTIONS_DATE_COLUMN_WIDTH,
	koniecInspekcji: INSPECTIONS_DATE_COLUMN_WIDTH,
	osobaKierujaca: 185,
	skladZespolu: 185,
	rynek: 145,
	rodzajPodmiotu: 145,
	dataProtokolu: INSPECTIONS_DATE_COLUMN_WIDTH,
	dataDoreczeniaProtokolu: INSPECTIONS_DATE_COLUMN_WIDTH,
	dataAkceptacjiSprawozdania: INSPECTIONS_EXTENDED_DATE_COLUMN_WIDTH,
	dataDoreczeniaPisma: INSPECTIONS_DATE_COLUMN_WIDTH,
	dataPismaZastrzezenia: INSPECTIONS_EXTENDED_DATE_COLUMN_WIDTH,
	dataWyslaniaPismaZZastrzezeniami: INSPECTIONS_EXTENDED_DATE_COLUMN_WIDTH,
	dataWplywuPisma: INSPECTIONS_EXTENDED_DATE_COLUMN_WIDTH,
	dataPismaZOdpowiedzia: INSPECTIONS_EXTENDED_DATE_COLUMN_WIDTH,
	dataWyslaniaPismaZOdpowiedzia: INSPECTIONS_EXTENDED_DATE_COLUMN_WIDTH,
	dataAkceptacjiNoty: INSPECTIONS_DATE_COLUMN_WIDTH,
	dataZalecen: INSPECTIONS_DATE_COLUMN_WIDTH,
	status: 190,
	komentarz: 240,
	zespoly: 110,
};
// Minimalna szerokosc dowolnej kolumny podczas recznej zmiany rozmiaru.
const INSPECTIONS_MIN_COLUMN_WIDTH = 70;
// Maksymalna wysokosc zawartosci komorki (wiersza) tabeli Inspekcji.
const INSPECTIONS_MAX_ROW_HEIGHT_PX = 92;
import type {
	InspectionColumnKey,
	InspectionRow,
	InspectionViewId,
} from "@/features/inspections/types";
import {
	addWorksheetWithStyles,
	createStyledExportWorkbook,
	saveWorkbookAsXlsx,
} from "@/shared/utils/excel-export";
import { toDateInputValue, toDateList } from "@/shared/utils/date";


const INSPECTIONS_API_URL = "/api/structure/inspections";
const INSPECTIONS_DEFAULT_SORT_BY = "poczatekInspekcji";
const INSPECTIONS_DEFAULT_SORT_ORDER = "desc";
const RECOMMENDATIONS_AVAILABLE_INSPECTIONS_API_URL =
	"/api/recommendations/available-inspections";
const SANCTIONS_AVAILABLE_INSPECTIONS_API_URL =
	"/api/sanction-requests/available-inspections";

const DEFAULT_ADD_INSPECTION_FORM: AddInspectionForm = {
	nazwaPodmiotu: "",
	typInspekcji: "",
	zakresInspekcji: "",
	szczegolyDotyczaceZakresu: "",
	aspektKonsumencki: "NIE",
	poczatekInspekcji: "",
	koniecInspekcji: "",
	osobaKierujaca: "",
	skladZespolu: "",
	zespoly: "",
	rynek: "",
	rodzajPodmiotu: "",
	dataProtokolu: "",
	dataDoreczeniaProtokolu: "",
	dataAkceptacjiSprawozdania: "",
	dataDoreczeniaPisma: "",
	dataPismaZastrzezenia: "",
	dataWyslaniaPismaZZastrzezeniami: "",
	dataWplywuPisma: "",
	dataPismaZOdpowiedzia: "",
	dataWyslaniaPismaZOdpowiedzia: "",
	dataAkceptacjiNoty: "",
	dataZalecen: "",
	status: "",
	komentarz: "",
	brakDataDoreczeniaPisma: false,
	brakDataPismaZastrzezenia: false,
	brakDataWyslaniaPismaZZastrzezeniami: false,
	brakDataWplywuPisma: false,
	brakDataPismaZOdpowiedzia: false,
	brakDataWyslaniaPismaZOdpowiedzia: false,
};

function normalizeInspectionScopeValues(values: string[]) {
	const normalized = values
		.map((value) => value.trim())
		.filter(Boolean)
		.filter((value) => {
			const lowered = value.toLowerCase();
			return lowered !== "brak" && lowered !== "-";
		});

	return Array.from(new Set(normalized)).sort((left, right) =>
		left.localeCompare(right, "pl", { sensitivity: "base" }),
	);
}

function normalizeTeamNameKey(value: string | null | undefined) {
	if (!value) {
		return "";
	}

	return value
		.trim()
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/\s+/g, " ");
}

function readTrimmedString(value: unknown) {
	return typeof value === "string" ? value.trim() : "";
}

function parsePositiveNumericId(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		return value;
	}

	if (typeof value === "string") {
		const parsed = Number(value.trim());
		if (Number.isFinite(parsed) && parsed > 0) {
			return parsed;
		}
	}

	return null;
}

function parseTeamMemberDisplayTokens(value: string) {
	return value
		.split(/\r?\n|;/)
		.map((token) => token.trim())
		.map((token) => token.replace(/^\d+\.\s*/, "").trim())
		.filter(Boolean);
}

function resolvePeopleOptionDisplayName(
	raw: Record<string, unknown>,
	login: string,
) {
	const directDisplayName =
		readTrimmedString(raw.displayName) ||
		readTrimmedString(raw.fullName) ||
		readTrimmedString(raw.nazwaUzytkownika);
	const firstName = readTrimmedString(raw.firstName) || readTrimmedString(raw.imie);
	const lastName = readTrimmedString(raw.lastName) || readTrimmedString(raw.nazwisko);
	const displayNameFromParts = [firstName, lastName]
		.filter(Boolean)
		.join(" ")
		.trim();

	const nestedUser =
		raw.user && typeof raw.user === "object"
			? (raw.user as Record<string, unknown>)
			: null;
	const nestedDisplayName = nestedUser
		? readTrimmedString(nestedUser.displayName) ||
			readTrimmedString(nestedUser.fullName) ||
			readTrimmedString(nestedUser.nazwaUzytkownika)
		: "";
	const nestedFirstName = nestedUser
		? readTrimmedString(nestedUser.firstName) || readTrimmedString(nestedUser.imie)
		: "";
	const nestedLastName = nestedUser
		? readTrimmedString(nestedUser.lastName) || readTrimmedString(nestedUser.nazwisko)
		: "";
	const nestedDisplayNameFromParts = [nestedFirstName, nestedLastName]
		.filter(Boolean)
		.join(" ")
		.trim();

	return (
		directDisplayName ||
		displayNameFromParts ||
		nestedDisplayName ||
		nestedDisplayNameFromParts ||
		login
	);
}

type InspectionsPanelProps = {
	operatorLogin: string;
	authRole: AuthRole;
	isObserver?: boolean;
};

type InspectionLockConflict = {
	ownerLogin: string;
	ownerDisplayName: string;
	acquiredAt: string;
};

type InspectionDomainError = {
	code: string;
	detail: string;
	memberUserId: number | null;
};

type InspectionStatusValidationViolation = {
	violationCodeId: number | null;
	message: string;
};

type InspectionNoLetterFlags = {
	brakDataDoreczeniaPisma: boolean;
	brakDataPismaZastrzezenia: boolean;
	brakDataWyslaniaPismaZZastrzezeniami: boolean;
	brakDataWplywuPisma: boolean;
	brakDataPismaZOdpowiedzia: boolean;
	brakDataWyslaniaPismaZOdpowiedzia: boolean;
};

type InspectionNoAcceptanceDatesFlags = {
	brakDatAkceptacjiNoty: boolean;
};

type InspectionNameVariant = "full" | "short" | "user";

type InspectionNameVariantColumnKey =
	| "nazwaPodmiotu"
	| "typInspekcji"
	| "zakresInspekcji"
	| "rynek"
	| "rodzajPodmiotu"
	| "status";

type InspectionNameVariantByColumn = Record<
	InspectionNameVariantColumnKey,
	InspectionNameVariant
>;

type InspectionShortValuesByColumn = Partial<
	Record<InspectionNameVariantColumnKey, string>
>;

const INSPECTION_NAME_VARIANT_COLUMN_KEYS: InspectionNameVariantColumnKey[] = [
	"nazwaPodmiotu",
	"typInspekcji",
	"zakresInspekcji",
	"rynek",
	"rodzajPodmiotu",
	"status",
];

const INSPECTION_NAME_VARIANT_OPTIONS = [
	{ value: "full", label: "Nazwa pełna" },
	{ value: "short", label: "Nazwa skrócona" },
] as const;

const DEFAULT_INSPECTION_NAME_VARIANTS: InspectionNameVariantByColumn = {
	nazwaPodmiotu: "short",
	typInspekcji: "full",
	zakresInspekcji: "full",
	rynek: "full",
	rodzajPodmiotu: "full",
	status: "full",
};

function isInspectionNameVariantColumnKey(
	columnKey: InspectionColumnKey,
): columnKey is InspectionNameVariantColumnKey {
	return INSPECTION_NAME_VARIANT_COLUMN_KEYS.includes(
		columnKey as InspectionNameVariantColumnKey,
	);
}

function isInspectionNameVariant(value: unknown): value is InspectionNameVariant {
	return value === "full" || value === "short" || value === "user";
}

function isInspectionNameVariantAllowedForColumn(
	columnKey: InspectionNameVariantColumnKey,
	value: InspectionNameVariant,
) {
	void columnKey;
	return value === "full" || value === "short";
}

const RECOMMENDATIONS_CHANGED_EVENT = "recommendations:changed";
const INSPECTIONS_CHANGED_EVENT = "inspections:changed";
const DICTIONARIES_CHANGED_EVENT = "dictionaries:changed";
const DASHBOARD_OPEN_INSPECTION_EVENT = "dashboard:open-inspection";
const DASHBOARD_OPEN_INSPECTION_CODE_KEY = "triangle.dashboard.openInspectionCode";
const DASHBOARD_OPEN_RECOMMENDATION_EVENT = "dashboard:open-recommendation";
const DASHBOARD_OPEN_RECOMMENDATION_CODE_KEY =
	"triangle.dashboard.openRecommendationCode";
const QUICK_FILTER_EXCLUDED_STATUS_CODE_POSITIONS = new Set([
	"I_SI_9",
	"I_SI_10",
	"I_SI_12",
	"I_SI_13",
]);
const CLOSED_STATUS_CODE_POSITIONS = new Set([
	"I_SI_9",
	"I_SI_10",
	"I_SI_12",
	"I_SI_13",
]);
const STATUS_CODES_WITHOUT_DATES = new Set(["I_SI_1", "I_SI_2", "I_SI_3"]);
const STATUS_CODES_REQUIRING_ONLY_PROTOCOL_DATE = new Set(["I_SI_14"]);
const CONTROL_STATUS_CODE_POSITIONS = new Set([
	"I_SI_1",
	"I_SI_2",
	"I_SI_3",
	"I_SI_4",
	"I_SI_6",
	"I_SI_8",
	"I_SI_9",
	"I_SI_10",
	"I_SI_12",
	"I_SI_13",
	"I_SI_14",
]);
const SUPERVISORY_VISIT_STATUS_CODE_POSITIONS = new Set([
	"I_SI_1",
	"I_SI_2",
	"I_SI_3",
	"I_SI_5",
	"I_SI_8",
	"I_SI_9",
	"I_SI_10",
	"I_SI_11",
	"I_SI_12",
	"I_SI_13",
]);
const CONTROL_ONLY_STATUS_CODE_POSITIONS = new Set([
	"I_SI_4",
	"I_SI_6",
	"I_SI_14",
]);
const SUPERVISORY_VISIT_ONLY_STATUS_CODE_POSITIONS = new Set([
	"I_SI_5",
	"I_SI_11",
]);
const INSPECTION_FILTER_GROUPS = ["DYREKCJA", "DIU", "DNU"] as const;
type InspectionFilterGroup = (typeof INSPECTION_FILTER_GROUPS)[number];

function normalizeInspectionFilterGroup(
	value: unknown,
): InspectionFilterGroup | null {
	if (typeof value !== "string") {
		return null;
	}

	const normalized = value.trim().toUpperCase();
	if (normalized === "DYREKCJA" || normalized === "DIU" || normalized === "DNU") {
		return normalized;
	}

	return null;
}

function normalizeStatusCodePosition(value: unknown): string {
	if (typeof value !== "string") {
		return "";
	}

	const normalized = value.trim().toUpperCase();
	if (!normalized) {
		return "";
	}

	const match = normalized.match(/(\d+)$/);
	if (!match) {
		return "";
	}

	return `I_SI_${match[1]}`;
}

function resolveInspectionTimelineModeFromTypeValue(
	inspectionTypeValue: string,
): InspectionTimelineMode | null {
	const normalizedType = inspectionTypeValue.trim().toLowerCase();
	const isControlType =
		normalizedType.includes("kontrol") ||
		normalizedType.startsWith("kont") ||
		normalizedType === "k";
	const isSupervisoryVisitType =
		normalizedType.includes("wizyta") ||
		normalizedType.startsWith("wiz") ||
		normalizedType === "w";

	if (isControlType && !isSupervisoryVisitType) {
		return "control";
	}

	if (isSupervisoryVisitType && !isControlType) {
		return "visit";
	}

	return null;
}

type InspectionTimelineMode = "control" | "visit";

type InspectionDatesValidationKind =
	| "status-forbids-dates"
	| "status-extra-dates"
	| "status-extra-no-suggestion"
	| "timeline-continuity"
	| "status-required"
	| "status-mismatch";

type InspectionDatesValidationModalData = {
	kind: InspectionDatesValidationKind;
	mode: InspectionTimelineMode;
	selectedStatusCode: string;
	suggestedStatusCode: string | null;
	enteredFieldNumbers: number[];
	expectedFieldNumbers: number[];
	missingFieldNumbers: number[];
	message: string;
};

const INSPECTION_DATE_FIELD_ID = {
	PROTOCOL_OR_REPORT: "protocolOrReport",
	PROTOCOL_DELIVERY: "protocolDelivery",
	OBJECTIONS_LETTER: "objectionsLetter",
	OBJECTIONS_SENT: "objectionsSent",
	OBJECTIONS_RECEIVED: "objectionsReceived",
	CONTROL_RESPONSE_SENT: "controlResponseSent",
	CONTROL_RESPONSE_LETTER: "controlResponseLetter",
	ACCEPTANCE_NOTE: "acceptanceNote",
	VISIT_REPORT_ACCEPTANCE: "visitReportAcceptance",
	VISIT_LETTER_DELIVERY: "visitLetterDelivery",
} as const;

type InspectionDateFieldId =
	(typeof INSPECTION_DATE_FIELD_ID)[keyof typeof INSPECTION_DATE_FIELD_ID];

const CONTROL_DATE_FIELD_NUMBER_BY_ID: Partial<
	Record<InspectionDateFieldId, number>
> = {
	[INSPECTION_DATE_FIELD_ID.PROTOCOL_OR_REPORT]: 1,
	[INSPECTION_DATE_FIELD_ID.PROTOCOL_DELIVERY]: 2,
	[INSPECTION_DATE_FIELD_ID.OBJECTIONS_LETTER]: 3,
	[INSPECTION_DATE_FIELD_ID.OBJECTIONS_SENT]: 4,
	[INSPECTION_DATE_FIELD_ID.OBJECTIONS_RECEIVED]: 5,
	[INSPECTION_DATE_FIELD_ID.CONTROL_RESPONSE_SENT]: 6,
	[INSPECTION_DATE_FIELD_ID.CONTROL_RESPONSE_LETTER]: 7,
	[INSPECTION_DATE_FIELD_ID.ACCEPTANCE_NOTE]: 8,
};

const VISIT_DATE_FIELD_NUMBER_BY_ID: Partial<
	Record<InspectionDateFieldId, number>
> = {
	[INSPECTION_DATE_FIELD_ID.PROTOCOL_OR_REPORT]: 9,
	[INSPECTION_DATE_FIELD_ID.VISIT_REPORT_ACCEPTANCE]: 10,
	[INSPECTION_DATE_FIELD_ID.VISIT_LETTER_DELIVERY]: 11,
	[INSPECTION_DATE_FIELD_ID.OBJECTIONS_LETTER]: 12,
	[INSPECTION_DATE_FIELD_ID.OBJECTIONS_SENT]: 13,
	[INSPECTION_DATE_FIELD_ID.OBJECTIONS_RECEIVED]: 14,
	[INSPECTION_DATE_FIELD_ID.ACCEPTANCE_NOTE]: 15,
};

const CONTROL_TIMELINE_GROUPS: InspectionDateFieldId[][] = [
	[INSPECTION_DATE_FIELD_ID.PROTOCOL_OR_REPORT],
	[INSPECTION_DATE_FIELD_ID.PROTOCOL_DELIVERY],
	[
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_LETTER,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_SENT,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_RECEIVED,
	],
	[
		INSPECTION_DATE_FIELD_ID.CONTROL_RESPONSE_SENT,
		INSPECTION_DATE_FIELD_ID.CONTROL_RESPONSE_LETTER,
	],
	[INSPECTION_DATE_FIELD_ID.ACCEPTANCE_NOTE],
];

const VISIT_TIMELINE_GROUPS: InspectionDateFieldId[][] = [
	[
		INSPECTION_DATE_FIELD_ID.PROTOCOL_OR_REPORT,
		INSPECTION_DATE_FIELD_ID.VISIT_REPORT_ACCEPTANCE,
	],
	[INSPECTION_DATE_FIELD_ID.VISIT_LETTER_DELIVERY],
	[
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_LETTER,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_SENT,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_RECEIVED,
	],
	[INSPECTION_DATE_FIELD_ID.ACCEPTANCE_NOTE],
];

function mapInspectionDateFieldIdsToNumbers(
	mode: InspectionTimelineMode,
	fieldIds: InspectionDateFieldId[],
): number[] {
	const fieldNumberById =
		mode === "control"
			? CONTROL_DATE_FIELD_NUMBER_BY_ID
			: VISIT_DATE_FIELD_NUMBER_BY_ID;

	return Array.from(
		new Set(
			fieldIds
				.map((fieldId) => fieldNumberById[fieldId])
				.filter((fieldNumber): fieldNumber is number =>
					typeof fieldNumber === "number",
				),
		),
	).sort((left, right) => left - right);
}

const CONTROL_STATUS_REQUIRED_FIELDS_BY_CODE: Record<
	string,
	InspectionDateFieldId[]
> = {
	I_SI_1: [],
	I_SI_2: [],
	I_SI_3: [],
	I_SI_14: [INSPECTION_DATE_FIELD_ID.PROTOCOL_OR_REPORT],
	I_SI_4: [
		INSPECTION_DATE_FIELD_ID.PROTOCOL_OR_REPORT,
		INSPECTION_DATE_FIELD_ID.PROTOCOL_DELIVERY,
	],
	I_SI_6: [
		INSPECTION_DATE_FIELD_ID.PROTOCOL_OR_REPORT,
		INSPECTION_DATE_FIELD_ID.PROTOCOL_DELIVERY,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_LETTER,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_SENT,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_RECEIVED,
	],
	I_SI_8: [
		INSPECTION_DATE_FIELD_ID.PROTOCOL_OR_REPORT,
		INSPECTION_DATE_FIELD_ID.PROTOCOL_DELIVERY,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_LETTER,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_SENT,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_RECEIVED,
		INSPECTION_DATE_FIELD_ID.CONTROL_RESPONSE_SENT,
		INSPECTION_DATE_FIELD_ID.CONTROL_RESPONSE_LETTER,
	],
	I_SI_9: [
		INSPECTION_DATE_FIELD_ID.PROTOCOL_OR_REPORT,
		INSPECTION_DATE_FIELD_ID.PROTOCOL_DELIVERY,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_LETTER,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_SENT,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_RECEIVED,
		INSPECTION_DATE_FIELD_ID.CONTROL_RESPONSE_SENT,
		INSPECTION_DATE_FIELD_ID.CONTROL_RESPONSE_LETTER,
		INSPECTION_DATE_FIELD_ID.ACCEPTANCE_NOTE,
	],
	I_SI_10: [
		INSPECTION_DATE_FIELD_ID.PROTOCOL_OR_REPORT,
		INSPECTION_DATE_FIELD_ID.PROTOCOL_DELIVERY,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_LETTER,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_SENT,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_RECEIVED,
		INSPECTION_DATE_FIELD_ID.CONTROL_RESPONSE_SENT,
		INSPECTION_DATE_FIELD_ID.CONTROL_RESPONSE_LETTER,
		INSPECTION_DATE_FIELD_ID.ACCEPTANCE_NOTE,
	],
	I_SI_12: [
		INSPECTION_DATE_FIELD_ID.PROTOCOL_OR_REPORT,
		INSPECTION_DATE_FIELD_ID.PROTOCOL_DELIVERY,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_LETTER,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_SENT,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_RECEIVED,
		INSPECTION_DATE_FIELD_ID.CONTROL_RESPONSE_SENT,
		INSPECTION_DATE_FIELD_ID.CONTROL_RESPONSE_LETTER,
		INSPECTION_DATE_FIELD_ID.ACCEPTANCE_NOTE,
	],
	I_SI_13: [
		INSPECTION_DATE_FIELD_ID.PROTOCOL_OR_REPORT,
		INSPECTION_DATE_FIELD_ID.PROTOCOL_DELIVERY,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_LETTER,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_SENT,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_RECEIVED,
		INSPECTION_DATE_FIELD_ID.CONTROL_RESPONSE_SENT,
		INSPECTION_DATE_FIELD_ID.CONTROL_RESPONSE_LETTER,
		INSPECTION_DATE_FIELD_ID.ACCEPTANCE_NOTE,
	],
};

const VISIT_STATUS_REQUIRED_FIELDS_BY_CODE: Record<
	string,
	InspectionDateFieldId[]
> = {
	I_SI_1: [],
	I_SI_2: [],
	I_SI_3: [],
	I_SI_11: [
		INSPECTION_DATE_FIELD_ID.PROTOCOL_OR_REPORT,
		INSPECTION_DATE_FIELD_ID.VISIT_REPORT_ACCEPTANCE,
	],
	I_SI_5: [
		INSPECTION_DATE_FIELD_ID.PROTOCOL_OR_REPORT,
		INSPECTION_DATE_FIELD_ID.VISIT_REPORT_ACCEPTANCE,
		INSPECTION_DATE_FIELD_ID.VISIT_LETTER_DELIVERY,
	],
	I_SI_8: [
		INSPECTION_DATE_FIELD_ID.PROTOCOL_OR_REPORT,
		INSPECTION_DATE_FIELD_ID.VISIT_REPORT_ACCEPTANCE,
		INSPECTION_DATE_FIELD_ID.VISIT_LETTER_DELIVERY,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_LETTER,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_SENT,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_RECEIVED,
	],
	I_SI_9: [
		INSPECTION_DATE_FIELD_ID.PROTOCOL_OR_REPORT,
		INSPECTION_DATE_FIELD_ID.VISIT_REPORT_ACCEPTANCE,
		INSPECTION_DATE_FIELD_ID.VISIT_LETTER_DELIVERY,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_LETTER,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_SENT,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_RECEIVED,
		INSPECTION_DATE_FIELD_ID.ACCEPTANCE_NOTE,
	],
	I_SI_10: [
		INSPECTION_DATE_FIELD_ID.PROTOCOL_OR_REPORT,
		INSPECTION_DATE_FIELD_ID.VISIT_REPORT_ACCEPTANCE,
		INSPECTION_DATE_FIELD_ID.VISIT_LETTER_DELIVERY,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_LETTER,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_SENT,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_RECEIVED,
		INSPECTION_DATE_FIELD_ID.ACCEPTANCE_NOTE,
	],
	I_SI_12: [
		INSPECTION_DATE_FIELD_ID.PROTOCOL_OR_REPORT,
		INSPECTION_DATE_FIELD_ID.VISIT_REPORT_ACCEPTANCE,
		INSPECTION_DATE_FIELD_ID.VISIT_LETTER_DELIVERY,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_LETTER,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_SENT,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_RECEIVED,
		INSPECTION_DATE_FIELD_ID.ACCEPTANCE_NOTE,
	],
	I_SI_13: [
		INSPECTION_DATE_FIELD_ID.PROTOCOL_OR_REPORT,
		INSPECTION_DATE_FIELD_ID.VISIT_REPORT_ACCEPTANCE,
		INSPECTION_DATE_FIELD_ID.VISIT_LETTER_DELIVERY,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_LETTER,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_SENT,
		INSPECTION_DATE_FIELD_ID.OBJECTIONS_RECEIVED,
		INSPECTION_DATE_FIELD_ID.ACCEPTANCE_NOTE,
	],
};

const CONTROL_PROGRESS_STATUS_BY_REQUIRED_FIELDS: Array<{
	statusCode: string;
	requiredFieldIds: InspectionDateFieldId[];
}> = [
	{
		statusCode: "I_SI_8",
		requiredFieldIds: [
			INSPECTION_DATE_FIELD_ID.PROTOCOL_OR_REPORT,
			INSPECTION_DATE_FIELD_ID.PROTOCOL_DELIVERY,
			INSPECTION_DATE_FIELD_ID.OBJECTIONS_LETTER,
			INSPECTION_DATE_FIELD_ID.OBJECTIONS_SENT,
			INSPECTION_DATE_FIELD_ID.OBJECTIONS_RECEIVED,
			INSPECTION_DATE_FIELD_ID.CONTROL_RESPONSE_SENT,
			INSPECTION_DATE_FIELD_ID.CONTROL_RESPONSE_LETTER,
		],
	},
	{
		statusCode: "I_SI_6",
		requiredFieldIds: [
			INSPECTION_DATE_FIELD_ID.PROTOCOL_OR_REPORT,
			INSPECTION_DATE_FIELD_ID.PROTOCOL_DELIVERY,
			INSPECTION_DATE_FIELD_ID.OBJECTIONS_LETTER,
			INSPECTION_DATE_FIELD_ID.OBJECTIONS_SENT,
			INSPECTION_DATE_FIELD_ID.OBJECTIONS_RECEIVED,
		],
	},
	{
		statusCode: "I_SI_4",
		requiredFieldIds: [
			INSPECTION_DATE_FIELD_ID.PROTOCOL_OR_REPORT,
			INSPECTION_DATE_FIELD_ID.PROTOCOL_DELIVERY,
		],
	},
];

const VISIT_PROGRESS_STATUS_BY_REQUIRED_FIELDS: Array<{
	statusCode: string;
	requiredFieldIds: InspectionDateFieldId[];
}> = [
	{
		statusCode: "I_SI_8",
		requiredFieldIds: [
			INSPECTION_DATE_FIELD_ID.PROTOCOL_OR_REPORT,
			INSPECTION_DATE_FIELD_ID.VISIT_REPORT_ACCEPTANCE,
			INSPECTION_DATE_FIELD_ID.VISIT_LETTER_DELIVERY,
			INSPECTION_DATE_FIELD_ID.OBJECTIONS_LETTER,
			INSPECTION_DATE_FIELD_ID.OBJECTIONS_SENT,
			INSPECTION_DATE_FIELD_ID.OBJECTIONS_RECEIVED,
		],
	},
	{
		statusCode: "I_SI_5",
		requiredFieldIds: [
			INSPECTION_DATE_FIELD_ID.PROTOCOL_OR_REPORT,
			INSPECTION_DATE_FIELD_ID.VISIT_REPORT_ACCEPTANCE,
			INSPECTION_DATE_FIELD_ID.VISIT_LETTER_DELIVERY,
		],
	},
	{
		statusCode: "I_SI_11",
		requiredFieldIds: [
			INSPECTION_DATE_FIELD_ID.PROTOCOL_OR_REPORT,
			INSPECTION_DATE_FIELD_ID.VISIT_REPORT_ACCEPTANCE,
		],
	},
];

const INSPECTION_DATE_FIELD_LABEL_BY_NUMBER: Record<number, string> = {
	1: "Data protokołu kontroli",
	2: "Data doręczenia protokołu kontroli",
	3: "Data pisma podmiotu z zastrzeżeniami do protokołu kontroli",
	4: "Data wysłania pisma podmiotu z zastrzeżeniami do protokołu kontroli",
	5: "Data wpływu pisma podmiotu z zastrzeżeniami do protokołu kontroli",
	6: "Data wysłania pisma z odpowiedzią na zastrzeżenia do protokołu kontroli",
	7: "Data pisma z odpowiedzią na zastrzeżenia do protokołu kontroli",
	8: "Data akceptacji noty (lista)",
	9: "Data sprawozdania z wizyty nadzorczej",
	10: "Data akceptacji sprawozdania z wizyty nadzorczej",
	11: "Data doręczenia pisma do podmiotu z ustaleniami wizyty nadzorczej",
	12: "Data uwag do pisma po wizycie nadzorczej",
	13: "Data wysłania uwag do pisma po wizycie nadzorczej",
	14: "Data wpływu uwag do pisma po wizycie nadzorczej",
	15: "Data akceptacji noty (lista)",
};

const OPTIONAL_ACCEPTANCE_NOTE_VALIDATION_LABEL =
	"Data akceptacji noty (opcjonalnie dla opracowywanie rekomendacji dalszych dzialan/zalecen)";

function getInspectionDateFieldLabelForValidation(fieldNumber: number) {
	if (fieldNumber === 8 || fieldNumber === 15) {
		return OPTIONAL_ACCEPTANCE_NOTE_VALIDATION_LABEL;
	}

	return INSPECTION_DATE_FIELD_LABEL_BY_NUMBER[fieldNumber] ?? "Pole daty";
}

const CLOSED_STATUS_REQUIRED_FIELD_NUMBERS_BY_MODE: Record<
	InspectionTimelineMode,
	number[]
> = {
	control: [1, 2, 3, 4, 5, 6, 7, 8],
	visit: [9, 10, 11, 12, 13, 14, 15],
};
const CONTROL_IS6_OBJECTIONS_FIELD_NUMBERS = [3, 4, 5] as const;
const CONTROL_IS8_PROGRESS_FIELD_NUMBERS = [3, 4, 5, 6, 7] as const;
const CONTROL_CLOSED_EXTRA_FIELD_NUMBERS = [3, 4, 5, 6, 7, 8] as const;
const FORBIDDEN_DATES_STATUS_GUIDANCE_BY_MODE: Record<
	InspectionTimelineMode,
	Array<{
		statusCode: string;
		requiredFieldNumbers: number[];
		matchingFieldNumbers?: number[];
	}>
> = {
	control: [
		{ statusCode: "I_SI_14", requiredFieldNumbers: [1] },
		{ statusCode: "I_SI_4", requiredFieldNumbers: [1, 2] },
		{ statusCode: "I_SI_6", requiredFieldNumbers: [1, 2, 3, 4, 5] },
		{
			statusCode: "I_SI_8",
			requiredFieldNumbers: [1, 2, 3, 4, 5, 6, 7],
			matchingFieldNumbers: [1, 2, 3, 4, 5, 6, 7, 8],
		},
	],
	visit: [
		{ statusCode: "I_SI_11", requiredFieldNumbers: [9, 10] },
		{ statusCode: "I_SI_5", requiredFieldNumbers: [9, 10, 11] },
		{
			statusCode: "I_SI_8",
			requiredFieldNumbers: [9, 10, 11, 12, 13, 14],
			matchingFieldNumbers: [9, 10, 11, 12, 13, 14, 15],
		},
	],
};

function getForbiddenDatesStatusGuidanceItems(
	modalData: InspectionDatesValidationModalData,
) {
	if (
		modalData.kind !== "status-forbids-dates" ||
		!STATUS_CODES_WITHOUT_DATES.has(modalData.selectedStatusCode)
	) {
		return [] as Array<{
			statusCode: string;
			requiredFieldNumbers: number[];
			missingFieldNumbers: number[];
		}>;
	}

	const guidanceItems =
		FORBIDDEN_DATES_STATUS_GUIDANCE_BY_MODE[modalData.mode] ?? [];

	const enteredFieldNumbers = Array.from(
		new Set(modalData.enteredFieldNumbers),
	).sort((left, right) => left - right);

	const matchingItems = guidanceItems.filter((guidanceItem) =>
		enteredFieldNumbers.every((fieldNumber) =>
			(
				guidanceItem.matchingFieldNumbers ?? guidanceItem.requiredFieldNumbers
			).includes(fieldNumber),
		),
	);

	if (matchingItems.length === 0) {
		return [];
	}

	const bestMatch = matchingItems.reduce((best, current) =>
		current.requiredFieldNumbers.length < best.requiredFieldNumbers.length
			? current
			: best,
	);

	return [
		{
			statusCode: bestMatch.statusCode,
			requiredFieldNumbers: bestMatch.requiredFieldNumbers,
			missingFieldNumbers: bestMatch.requiredFieldNumbers.filter(
				(fieldNumber) => !enteredFieldNumbers.includes(fieldNumber),
			),
		},
	];
}

function getEnteredFieldNumbersForGuidance(
	modalData: InspectionDatesValidationModalData,
) {
	const enteredFieldNumbers = Array.from(
		new Set(modalData.enteredFieldNumbers),
	).sort((left, right) => left - right);

	if (
		modalData.kind === "status-extra-dates" &&
		modalData.mode === "control" &&
		modalData.selectedStatusCode === "I_SI_14" &&
		!modalData.missingFieldNumbers.includes(1)
	) {
		return Array.from(new Set([...enteredFieldNumbers, 1])).sort(
			(left, right) => left - right,
		);
	}

	return enteredFieldNumbers;
}

function getControlIS14StatusGuidanceItem(
	modalData: InspectionDatesValidationModalData,
) {
	if (
		modalData.kind !== "status-extra-dates" ||
		modalData.mode !== "control" ||
		modalData.selectedStatusCode !== "I_SI_14"
	) {
		return null;
	}

	const enteredFieldNumbers = getEnteredFieldNumbersForGuidance(modalData);
	const enteredFieldNumbersForMatching = modalData.missingFieldNumbers.includes(1)
		? enteredFieldNumbers.filter((fieldNumber) => fieldNumber !== 1)
		: enteredFieldNumbers;
	const guidanceItems = FORBIDDEN_DATES_STATUS_GUIDANCE_BY_MODE.control.filter(
		(guidanceItem) => guidanceItem.statusCode !== "I_SI_14",
	);

	const matchingItems = guidanceItems.filter((guidanceItem) =>
		enteredFieldNumbersForMatching.every((fieldNumber) =>
			(
				guidanceItem.matchingFieldNumbers ?? guidanceItem.requiredFieldNumbers
			).includes(fieldNumber),
		),
	);

	if (matchingItems.length === 0) {
		return null;
	}

	const bestMatch = matchingItems.reduce((best, current) =>
		current.requiredFieldNumbers.length < best.requiredFieldNumbers.length
			? current
			: best,
	);

	return {
		statusCode: bestMatch.statusCode,
		missingFieldNumbers: bestMatch.requiredFieldNumbers.filter(
			(fieldNumber) => !enteredFieldNumbers.includes(fieldNumber),
		),
	};
}

function getControlIS4StatusGuidanceItem(
	modalData: InspectionDatesValidationModalData,
) {
	if (
		modalData.mode !== "control" ||
		modalData.selectedStatusCode !== "I_SI_4" ||
		(modalData.kind !== "status-required" &&
			modalData.kind !== "status-extra-no-suggestion")
	) {
		return null;
	}

	const enteredFieldNumbers = Array.from(
		new Set(modalData.enteredFieldNumbers),
	).sort((left, right) => left - right);
	const extraFieldNumbers = enteredFieldNumbers.filter(
		(fieldNumber) => ![1, 2].includes(fieldNumber),
	);

	if (extraFieldNumbers.length === 0) {
		return null;
	}

	const guidanceItems = FORBIDDEN_DATES_STATUS_GUIDANCE_BY_MODE.control.filter(
		(guidanceItem) =>
			guidanceItem.statusCode === "I_SI_6" || guidanceItem.statusCode === "I_SI_8",
	);

	const matchingItems = guidanceItems.filter((guidanceItem) =>
		enteredFieldNumbers.every((fieldNumber) =>
			(
				guidanceItem.matchingFieldNumbers ?? guidanceItem.requiredFieldNumbers
			).includes(fieldNumber),
		),
	);

	if (matchingItems.length === 0) {
		return null;
	}

	const bestMatch = matchingItems.reduce((best, current) =>
		current.requiredFieldNumbers.length < best.requiredFieldNumbers.length
			? current
			: best,
	);

	return {
		statusCode: bestMatch.statusCode,
		extraFieldNumbers,
		missingFieldNumbers: bestMatch.requiredFieldNumbers.filter(
			(fieldNumber) => !enteredFieldNumbers.includes(fieldNumber),
		),
	};
}

function getVisitIS11StatusGuidanceItem(
	modalData: InspectionDatesValidationModalData,
) {
	if (
		modalData.mode !== "visit" ||
		modalData.selectedStatusCode !== "I_SI_11" ||
		(modalData.kind !== "status-required" &&
			modalData.kind !== "status-extra-no-suggestion")
	) {
		return null;
	}

	const enteredFieldNumbers = Array.from(
		new Set(modalData.enteredFieldNumbers),
	).sort((left, right) => left - right);
	const enteredFieldNumbersForGuidance =
		modalData.kind === "status-extra-no-suggestion"
			? Array.from(
				new Set([
					...modalData.expectedFieldNumbers,
					...modalData.enteredFieldNumbers,
				]),
			).sort((left, right) => left - right)
			: enteredFieldNumbers;
	const extraFieldNumbers = enteredFieldNumbers.filter(
		(fieldNumber) => ![9, 10].includes(fieldNumber),
	);

	if (extraFieldNumbers.length === 0) {
		return null;
	}

	const guidanceItems = FORBIDDEN_DATES_STATUS_GUIDANCE_BY_MODE.visit.filter(
		(guidanceItem) =>
			guidanceItem.statusCode === "I_SI_5" || guidanceItem.statusCode === "I_SI_8",
	);

	const matchingItems = guidanceItems.filter((guidanceItem) =>
		enteredFieldNumbersForGuidance.every((fieldNumber) =>
			(
				guidanceItem.matchingFieldNumbers ?? guidanceItem.requiredFieldNumbers
			).includes(fieldNumber),
		),
	);

	if (matchingItems.length === 0) {
		return null;
	}

	const bestMatch = matchingItems.reduce((best, current) =>
		current.requiredFieldNumbers.length < best.requiredFieldNumbers.length
			? current
			: best,
	);

	return {
		statusCode: bestMatch.statusCode,
		extraFieldNumbers,
		missingFieldNumbers: bestMatch.requiredFieldNumbers.filter(
			(fieldNumber) => !enteredFieldNumbersForGuidance.includes(fieldNumber),
		),
	};
}

function getVisitIS5StatusGuidanceItem(
	modalData: InspectionDatesValidationModalData,
) {
	if (
		modalData.mode !== "visit" ||
		modalData.selectedStatusCode !== "I_SI_5" ||
		(modalData.kind !== "status-required" &&
			modalData.kind !== "status-extra-no-suggestion")
	) {
		return null;
	}

	const enteredFieldNumbers = Array.from(
		new Set(modalData.enteredFieldNumbers),
	).sort((left, right) => left - right);
	const enteredFieldNumbersForGuidance =
		modalData.kind === "status-extra-no-suggestion"
			? Array.from(
				new Set([
					...modalData.expectedFieldNumbers,
					...modalData.enteredFieldNumbers,
				]),
			).sort((left, right) => left - right)
			: enteredFieldNumbers;
	const extraFieldNumbers = enteredFieldNumbers.filter(
		(fieldNumber) => ![9, 10, 11].includes(fieldNumber),
	);

	if (extraFieldNumbers.length === 0) {
		return null;
	}

	const guidanceItems = FORBIDDEN_DATES_STATUS_GUIDANCE_BY_MODE.visit.filter(
		(guidanceItem) => guidanceItem.statusCode === "I_SI_8",
	);

	const matchingItems = guidanceItems.filter((guidanceItem) =>
		enteredFieldNumbersForGuidance.every((fieldNumber) =>
			(
				guidanceItem.matchingFieldNumbers ?? guidanceItem.requiredFieldNumbers
			).includes(fieldNumber),
		),
	);

	if (matchingItems.length === 0) {
		return null;
	}

	const bestMatch = matchingItems.reduce((best, current) =>
		current.requiredFieldNumbers.length < best.requiredFieldNumbers.length
			? current
			: best,
	);

	return {
		statusCode: bestMatch.statusCode,
		extraFieldNumbers,
		missingFieldNumbers: bestMatch.requiredFieldNumbers.filter(
			(fieldNumber) => !enteredFieldNumbersForGuidance.includes(fieldNumber),
		),
	};
}

function getControlIS6StatusGuidanceItem(
	modalData: InspectionDatesValidationModalData,
) {
	if (
		modalData.mode !== "control" ||
		modalData.selectedStatusCode !== "I_SI_6" ||
		modalData.kind !== "status-required"
	) {
		return null;
	}

	const enteredFieldNumbers = Array.from(
		new Set(modalData.enteredFieldNumbers),
	).sort((left, right) => left - right);
	const extraFieldNumbers = enteredFieldNumbers.filter(
		(fieldNumber) => ![1, 2, 3, 4, 5].includes(fieldNumber),
	);

	if (extraFieldNumbers.length === 0) {
		return null;
	}

	const guidanceItems = FORBIDDEN_DATES_STATUS_GUIDANCE_BY_MODE.control.filter(
		(guidanceItem) => guidanceItem.statusCode === "I_SI_8",
	);

	const matchingItems = guidanceItems.filter((guidanceItem) =>
		enteredFieldNumbers.every((fieldNumber) =>
			(
				guidanceItem.matchingFieldNumbers ?? guidanceItem.requiredFieldNumbers
			).includes(fieldNumber),
		),
	);

	if (matchingItems.length === 0) {
		return null;
	}

	const bestMatch = matchingItems.reduce((best, current) =>
		current.requiredFieldNumbers.length < best.requiredFieldNumbers.length
			? current
			: best,
	);

	return {
		statusCode: bestMatch.statusCode,
		extraFieldNumbers,
		missingFieldNumbers: bestMatch.requiredFieldNumbers.filter(
			(fieldNumber) => !enteredFieldNumbers.includes(fieldNumber),
		),
	};
}

function getControlIS6LowerStatusGuidanceCode(
	modalData: InspectionDatesValidationModalData,
) {
	if (
		modalData.mode !== "control" ||
		modalData.selectedStatusCode !== "I_SI_6" ||
		modalData.kind !== "status-required"
	) {
		return null;
	}

	const enteredFieldNumbers = Array.from(
		new Set(modalData.enteredFieldNumbers),
	).sort((left, right) => left - right);

	if (
		enteredFieldNumbers.length === 1 &&
		enteredFieldNumbers[0] === 1
	) {
		return "I_SI_14";
	}

	if (
		enteredFieldNumbers.length === 2 &&
		enteredFieldNumbers[0] === 1 &&
		enteredFieldNumbers[1] === 2
	) {
		return "I_SI_4";
	}

	return null;
}

function getControlIS8LowerStatusGuidanceCode(
	modalData: InspectionDatesValidationModalData,
) {
	if (
		modalData.mode !== "control" ||
		(modalData.selectedStatusCode !== "I_SI_8" &&
			!CLOSED_STATUS_CODE_POSITIONS.has(modalData.selectedStatusCode)) ||
		modalData.kind !== "status-required"
	) {
		return null;
	}

	const enteredFieldNumbers = Array.from(
		new Set(modalData.enteredFieldNumbers),
	).sort((left, right) => left - right);

	if (enteredFieldNumbers.length === 1 && enteredFieldNumbers[0] === 1) {
		return "I_SI_14";
	}

	if (
		enteredFieldNumbers.length === 2 &&
		enteredFieldNumbers[0] === 1 &&
		enteredFieldNumbers[1] === 2
	) {
		return "I_SI_4";
	}

	if (
		enteredFieldNumbers.length === 5 &&
		enteredFieldNumbers.every((fieldNumber, index) =>
			fieldNumber === [1, 2, 3, 4, 5][index],
		)
	) {
		return "I_SI_6";
	}

	if (
		enteredFieldNumbers.length === 7 &&
		enteredFieldNumbers.every((fieldNumber, index) =>
			fieldNumber === [1, 2, 3, 4, 5, 6, 7][index],
		)
	) {
		return "I_SI_8";
	}

	return null;
}

function getVisitIS8LowerStatusGuidanceCode(
	modalData: InspectionDatesValidationModalData,
) {
	if (
		modalData.mode !== "visit" ||
		(modalData.selectedStatusCode !== "I_SI_8" &&
			!CLOSED_STATUS_CODE_POSITIONS.has(modalData.selectedStatusCode)) ||
		modalData.kind !== "status-required"
	) {
		return null;
	}

	const enteredFieldNumbers = Array.from(
		new Set(modalData.enteredFieldNumbers),
	).sort((left, right) => left - right);

	if (
		enteredFieldNumbers.length === 2 &&
		enteredFieldNumbers[0] === 9 &&
		enteredFieldNumbers[1] === 10
	) {
		return "I_SI_11";
	}

	if (
		enteredFieldNumbers.length === 3 &&
		enteredFieldNumbers[0] === 9 &&
		enteredFieldNumbers[1] === 10 &&
		enteredFieldNumbers[2] === 11
	) {
		return "I_SI_5";
	}

	if (
		enteredFieldNumbers.length === 6 &&
		enteredFieldNumbers.every((fieldNumber, index) =>
			fieldNumber === [9, 10, 11, 12, 13, 14][index],
		)
	) {
		return "I_SI_8";
	}

	return null;
}

function shouldShowClosedStatusGuidance(
	modalData: InspectionDatesValidationModalData,
) {
	const requiredFieldNumbers =
		CLOSED_STATUS_REQUIRED_FIELD_NUMBERS_BY_MODE[modalData.mode] ?? [];

	if (requiredFieldNumbers.length === 0) {
		return false;
	}

	const enteredFieldNumbers = getEnteredFieldNumbersForGuidance(modalData);

	return requiredFieldNumbers.every((fieldNumber) =>
		enteredFieldNumbers.includes(fieldNumber),
	);
}

function getControlIS4ToIS6MissingFieldNumbers(
	modalData: InspectionDatesValidationModalData,
) {
	if (
		modalData.kind !== "status-extra-no-suggestion" ||
		modalData.mode !== "control" ||
		modalData.selectedStatusCode !== "I_SI_4"
	) {
		return [] as number[];
	}

	const hasAnyObjectionField = CONTROL_IS6_OBJECTIONS_FIELD_NUMBERS.some(
		(fieldNumber) => modalData.enteredFieldNumbers.includes(fieldNumber),
	);
	if (!hasAnyObjectionField) {
		return [] as number[];
	}

	return CONTROL_IS6_OBJECTIONS_FIELD_NUMBERS.filter(
		(fieldNumber) => !modalData.enteredFieldNumbers.includes(fieldNumber),
	);
}

function shouldShowControlIS4ToIS8Guidance(
	modalData: InspectionDatesValidationModalData,
) {
	if (
		modalData.kind !== "status-extra-no-suggestion" ||
		modalData.mode !== "control" ||
		modalData.selectedStatusCode !== "I_SI_4"
	) {
		return false;
	}

	return [6, 7, 8].some((fieldNumber) =>
		modalData.enteredFieldNumbers.includes(fieldNumber),
	);
}

function getControlIS4ToIS8MissingFieldNumbers(
	modalData: InspectionDatesValidationModalData,
) {
	if (!shouldShowControlIS4ToIS8Guidance(modalData)) {
		return [] as number[];
	}

	return CONTROL_IS8_PROGRESS_FIELD_NUMBERS.filter(
		(fieldNumber) => !modalData.enteredFieldNumbers.includes(fieldNumber),
	);
}

function hasControlIS4ClosedFieldsCompleted(
	modalData: InspectionDatesValidationModalData,
) {
	if (!shouldShowControlIS4ToIS8Guidance(modalData)) {
		return false;
	}

	return CONTROL_CLOSED_EXTRA_FIELD_NUMBERS.every((fieldNumber) =>
		modalData.enteredFieldNumbers.includes(fieldNumber),
	);
}

function shouldShowControlIS6ToIS8Guidance(
	modalData: InspectionDatesValidationModalData,
) {
	if (
		modalData.kind !== "status-extra-no-suggestion" ||
		modalData.mode !== "control" ||
		modalData.selectedStatusCode !== "I_SI_6"
	) {
		return false;
	}

	return [6, 7, 8].some((fieldNumber) =>
		modalData.enteredFieldNumbers.includes(fieldNumber),
	);
}

function getControlIS6ToIS8MissingFieldNumbers(
	modalData: InspectionDatesValidationModalData,
) {
	if (!shouldShowControlIS6ToIS8Guidance(modalData)) {
		return [] as number[];
	}

	return [6, 7].filter(
		(fieldNumber) => !modalData.enteredFieldNumbers.includes(fieldNumber),
	);
}

function hasControlIS6ClosedFieldsCompleted(
	modalData: InspectionDatesValidationModalData,
) {
	if (!shouldShowControlIS6ToIS8Guidance(modalData)) {
		return false;
	}

	const enteredFieldNumbers = Array.from(
		new Set([
			...modalData.expectedFieldNumbers,
			...modalData.enteredFieldNumbers,
		]),
	).sort((left, right) => left - right);

	const closedRequiredFieldNumbers =
		CLOSED_STATUS_REQUIRED_FIELD_NUMBERS_BY_MODE.control;

	return closedRequiredFieldNumbers.every((fieldNumber) =>
		enteredFieldNumbers.includes(fieldNumber),
	);
}

function hasVisitIS11ClosedFieldsCompleted(
	modalData: InspectionDatesValidationModalData,
) {
	if (
		modalData.kind !== "status-extra-no-suggestion" ||
		modalData.mode !== "visit" ||
		modalData.selectedStatusCode !== "I_SI_11"
	) {
		return false;
	}

	const enteredFieldNumbers = Array.from(
		new Set([
			...modalData.expectedFieldNumbers,
			...modalData.enteredFieldNumbers,
		]),
	).sort((left, right) => left - right);

	const closedRequiredFieldNumbers =
		CLOSED_STATUS_REQUIRED_FIELD_NUMBERS_BY_MODE.visit;

	return closedRequiredFieldNumbers.every((fieldNumber) =>
		enteredFieldNumbers.includes(fieldNumber),
	);
}

function hasVisitIS5ClosedFieldsCompleted(
	modalData: InspectionDatesValidationModalData,
) {
	if (
		modalData.kind !== "status-extra-no-suggestion" ||
		modalData.mode !== "visit" ||
		modalData.selectedStatusCode !== "I_SI_5"
	) {
		return false;
	}

	const enteredFieldNumbers = Array.from(
		new Set([
			...modalData.expectedFieldNumbers,
			...modalData.enteredFieldNumbers,
		]),
	).sort((left, right) => left - right);

	const closedRequiredFieldNumbers =
		CLOSED_STATUS_REQUIRED_FIELD_NUMBERS_BY_MODE.visit;

	return closedRequiredFieldNumbers.every((fieldNumber) =>
		enteredFieldNumbers.includes(fieldNumber),
	);
}

function getOptionalFieldNumberForStatusIS8(
	modalData: InspectionDatesValidationModalData,
) {
	if (modalData.selectedStatusCode !== "I_SI_8") {
		return null;
	}

	return modalData.mode === "control" ? 8 : 15;
}

function getControlClosedStatusMissingFieldNumbersForForbiddenDates(
	modalData: InspectionDatesValidationModalData,
) {
	if (
		modalData.kind !== "status-forbids-dates" ||
		modalData.mode !== "control" ||
		!STATUS_CODES_WITHOUT_DATES.has(modalData.selectedStatusCode) ||
		!modalData.enteredFieldNumbers.includes(8)
	) {
		return [] as number[];
	}

	return CONTROL_CLOSED_EXTRA_FIELD_NUMBERS.filter(
		(fieldNumber) => !modalData.enteredFieldNumbers.includes(fieldNumber),
	);
}

function getControlClosedStatusMissingFieldNumbersForIS14ExtraDates(
	modalData: InspectionDatesValidationModalData,
) {
	if (
		modalData.kind !== "status-extra-dates" ||
		modalData.mode !== "control" ||
		modalData.selectedStatusCode !== "I_SI_14"
	) {
		return [] as number[];
	}

	const enteredFieldNumbers = getEnteredFieldNumbersForGuidance(modalData);
	if (!enteredFieldNumbers.includes(8)) {
		return [] as number[];
	}

	return CONTROL_CLOSED_EXTRA_FIELD_NUMBERS.filter(
		(fieldNumber) => !enteredFieldNumbers.includes(fieldNumber),
	);
}

function getControlClosedStatusMissingFieldNumbersForIS4ExtraDates(
	modalData: InspectionDatesValidationModalData,
) {
	if (
		(modalData.kind !== "status-required" &&
			modalData.kind !== "status-extra-no-suggestion") ||
		modalData.mode !== "control" ||
		modalData.selectedStatusCode !== "I_SI_4" ||
		!modalData.enteredFieldNumbers.includes(8)
	) {
		return [] as number[];
	}

	return CONTROL_CLOSED_EXTRA_FIELD_NUMBERS.filter(
		(fieldNumber) => !modalData.enteredFieldNumbers.includes(fieldNumber),
	);
}

function getControlClosedStatusMissingFieldNumbersForIS6ExtraDates(
	modalData: InspectionDatesValidationModalData,
) {
	if (
		(modalData.kind !== "status-required" &&
			modalData.kind !== "status-extra-no-suggestion") ||
		modalData.mode !== "control" ||
		modalData.selectedStatusCode !== "I_SI_6"
	) {
		return [] as number[];
	}

	const enteredFieldNumbers = Array.from(
		new Set([
			...modalData.expectedFieldNumbers,
			...modalData.enteredFieldNumbers,
		]),
	).sort((left, right) => left - right);

	if (!enteredFieldNumbers.includes(8)) {
		return [] as number[];
	}

	const closedRequiredFieldNumbers =
		CLOSED_STATUS_REQUIRED_FIELD_NUMBERS_BY_MODE.control;

	return closedRequiredFieldNumbers.filter(
		(fieldNumber) => !enteredFieldNumbers.includes(fieldNumber),
	);
}

function getControlClosedStatusMissingFieldNumbersForIS8Required(
	modalData: InspectionDatesValidationModalData,
) {
	if (
		modalData.kind !== "status-required" ||
		modalData.mode !== "control" ||
		modalData.selectedStatusCode !== "I_SI_8"
	) {
		return [] as number[];
	}

	const enteredFieldNumbers = Array.from(
		new Set([
			...modalData.expectedFieldNumbers,
			...modalData.enteredFieldNumbers,
		]),
	).sort((left, right) => left - right);

	if (!enteredFieldNumbers.includes(8)) {
		return [] as number[];
	}

	const closedRequiredFieldNumbers =
		CLOSED_STATUS_REQUIRED_FIELD_NUMBERS_BY_MODE.control;

	return closedRequiredFieldNumbers.filter(
		(fieldNumber) => !enteredFieldNumbers.includes(fieldNumber),
	);
}

function getVisitClosedStatusMissingFieldNumbersForIS8Required(
	modalData: InspectionDatesValidationModalData,
) {
	if (
		modalData.kind !== "status-required" ||
		modalData.mode !== "visit" ||
		modalData.selectedStatusCode !== "I_SI_8"
	) {
		return [] as number[];
	}

	const enteredFieldNumbers = Array.from(
		new Set([
			...modalData.expectedFieldNumbers,
			...modalData.enteredFieldNumbers,
		]),
	).sort((left, right) => left - right);

	if (!enteredFieldNumbers.includes(15)) {
		return [] as number[];
	}

	const closedRequiredFieldNumbers =
		CLOSED_STATUS_REQUIRED_FIELD_NUMBERS_BY_MODE.visit;

	return closedRequiredFieldNumbers.filter(
		(fieldNumber) => !enteredFieldNumbers.includes(fieldNumber),
	);
}

function getVisitClosedStatusMissingFieldNumbersForIS11(
	modalData: InspectionDatesValidationModalData,
) {
	if (
		(modalData.kind !== "status-required" &&
			modalData.kind !== "status-extra-no-suggestion") ||
		modalData.mode !== "visit" ||
		modalData.selectedStatusCode !== "I_SI_11"
	) {
		return [] as number[];
	}

	const enteredFieldNumbers = Array.from(
		new Set([
			...modalData.expectedFieldNumbers,
			...modalData.enteredFieldNumbers,
		]),
	).sort((left, right) => left - right);

	if (!enteredFieldNumbers.includes(15)) {
		return [] as number[];
	}

	const closedRequiredFieldNumbers =
		CLOSED_STATUS_REQUIRED_FIELD_NUMBERS_BY_MODE.visit;

	return closedRequiredFieldNumbers.filter(
		(fieldNumber) => !enteredFieldNumbers.includes(fieldNumber),
	);
}

function getVisitClosedStatusMissingFieldNumbersForIS5(
	modalData: InspectionDatesValidationModalData,
) {
	if (
		(modalData.kind !== "status-required" &&
			modalData.kind !== "status-extra-no-suggestion") ||
		modalData.mode !== "visit" ||
		modalData.selectedStatusCode !== "I_SI_5"
	) {
		return [] as number[];
	}

	const enteredFieldNumbers = Array.from(
		new Set([
			...modalData.expectedFieldNumbers,
			...modalData.enteredFieldNumbers,
		]),
	).sort((left, right) => left - right);

	if (!enteredFieldNumbers.includes(15)) {
		return [] as number[];
	}

	const closedRequiredFieldNumbers =
		CLOSED_STATUS_REQUIRED_FIELD_NUMBERS_BY_MODE.visit;

	return closedRequiredFieldNumbers.filter(
		(fieldNumber) => !enteredFieldNumbers.includes(fieldNumber),
	);
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

function normalizeDateValueForRecommendationLookup(value: string) {
	const normalizedValue = value.trim();
	if (!normalizedValue) {
		return "";
	}

	if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
		return normalizedValue;
	}

	const dotMatch = normalizedValue.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
	if (!dotMatch) {
		return "";
	}

	const [, day, month, year] = dotMatch;
	return `${year}-${month}-${day}`;
}

function resolveInspectionLockRecordIds(
	rawRow: RawInspectionRow,
	fallbackId: string,
) {
	const rawId = String(rawRow.id ?? "").trim();
	const rawLp = String(rawRow.lp ?? "").trim();
	const rawInspectionKod = String(
		(rawRow as { inspectionKod?: unknown }).inspectionKod ??
			(rawRow as { kodInspekcji?: unknown }).kodInspekcji ??
			"",
	).trim();

	const candidates = [rawId, rawLp, rawInspectionKod, fallbackId]
		.map((value) => value.trim())
		.filter(Boolean);

	return Array.from(new Set(candidates));
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

async function readInspectionDomainError(
	response: Response,
): Promise<InspectionDomainError | null> {
	const contentType = response.headers.get("content-type") ?? "";
	if (!contentType.includes("application/json")) {
		return null;
	}

	try {
		const payload = (await response.clone().json()) as Record<string, unknown>;
		const detailSource = payload.detail;
		const detailObject =
			detailSource && typeof detailSource === "object" && !Array.isArray(detailSource)
				? (detailSource as Record<string, unknown>)
				: payload;
		const code =
			typeof detailObject.code === "string"
				? detailObject.code.trim().toUpperCase()
				: typeof payload.code === "string"
					? payload.code.trim().toUpperCase()
					: "";
		const detail =
			typeof detailObject.detail === "string"
				? detailObject.detail.trim()
				: typeof detailObject.message === "string"
					? detailObject.message.trim()
					: typeof payload.detail === "string"
						? payload.detail.trim()
						: "";
		const memberCandidate =
			detailObject.memberUserId ?? detailObject.member_user_id ?? detailObject.userId;
		const memberNumeric =
			typeof memberCandidate === "number"
				? memberCandidate
				: typeof memberCandidate === "string"
					? Number(memberCandidate.trim())
					: NaN;

		if (!code) {
			return null;
		}

		return {
			code,
			detail,
			memberUserId:
				Number.isFinite(memberNumeric) && memberNumeric > 0 ? memberNumeric : null,
		};
	} catch {
		return null;
	}
}

function mapInspectionStatusViolationMessage(violationCodeId: number | null) {
	switch (violationCodeId) {
		case 1001:
			return "Nie można ustawić statusu \"zamknięty - wydano zalecenia\", jeśli inspekcja nie ma zaleceń.";
		case 1002:
			return "Nie można ustawić statusu \"zamknięty - brak zaleceń\", jeśli inspekcja ma zalecenia.";
		case 1003:
			return "Brak wymaganego wniosku sankcyjnego.";
		case 1004:
			return "Jest wniosek sankcyjny, a powinno go nie być.";
		default:
			return "Nie można zapisać rekordu z powodu niespełnionych relacji dla wybranego statusu.";
	}
}

async function readInspectionStatusValidationViolations(
	response: Response,
): Promise<InspectionStatusValidationViolation[] | null> {
	const contentType = response.headers.get("content-type") ?? "";
	if (!contentType.includes("application/json")) {
		return null;
	}

	try {
		const payload = (await response.clone().json()) as Record<string, unknown>;
		const detailSource = payload.detail;
		const detailObject =
			detailSource &&
			typeof detailSource === "object" &&
			!Array.isArray(detailSource)
				? (detailSource as Record<string, unknown>)
				: payload;

		const code =
			typeof detailObject.code === "string"
				? detailObject.code.trim().toUpperCase()
				: typeof payload.code === "string"
					? payload.code.trim().toUpperCase()
					: "";
		const codeIdCandidate = detailObject.codeId ?? payload.codeId;
		const codeId =
			typeof codeIdCandidate === "number"
				? codeIdCandidate
				: typeof codeIdCandidate === "string"
					? Number(codeIdCandidate.trim())
					: NaN;

		const isStatusValidationError =
			code === "INSPECTION_STATUS_RELATIONS_VALIDATION_FAILED" ||
			code === "INSPECTION_STATUS_RELATIONS_VIOLATION" ||
			(Number.isFinite(codeId) && codeId === 1100);
		if (!isStatusValidationError) {
			return null;
		}

		const violationsSource =
			detailObject.violations ?? payload.violations ?? detailObject.items ?? payload.items;
		const violationItems = Array.isArray(violationsSource) ? violationsSource : [];

		const parsedViolations = violationItems
			.map((item) => {
				if (!item || typeof item !== "object") {
					return null;
				}

				const source = item as Record<string, unknown>;
				const violationCodeCandidate =
					source.violationCodeId ?? source.codeId ?? source.code;
				const numericViolationCode =
					typeof violationCodeCandidate === "number"
						? violationCodeCandidate
						: typeof violationCodeCandidate === "string"
							? Number(violationCodeCandidate.trim())
							: NaN;
				const normalizedViolationCode = Number.isFinite(numericViolationCode)
					? numericViolationCode
					: null;

				const detailMessage =
					typeof source.detail === "string"
						? source.detail.trim()
						: typeof source.message === "string"
							? source.message.trim()
							: "";
				const mappedMessage =
					normalizedViolationCode === 1001 ||
					normalizedViolationCode === 1002 ||
					normalizedViolationCode === 1003 ||
					normalizedViolationCode === 1004
						? mapInspectionStatusViolationMessage(normalizedViolationCode)
						: "";

				return {
					violationCodeId: normalizedViolationCode,
					message:
						mappedMessage ||
						detailMessage ||
						mapInspectionStatusViolationMessage(normalizedViolationCode),
				};
			})
			.filter(
				(
					violation,
				): violation is InspectionStatusValidationViolation => violation !== null,
			);

		if (parsedViolations.length > 0) {
			return parsedViolations;
		}

		return [
			{
				violationCodeId: null,
				message: mapInspectionStatusViolationMessage(null),
			},
		];
	} catch {
		return null;
	}
}

type RecommendationExportColumnKey =
	| "lp"
	| "kodZalecenia"
	| "inspectionLp"
	| "zespoly"
	| "nazwaPodmiotu"
	| "pozycja"
	| "dataZalecen"
	| "terminyWykonaniaZalecenList"
	| "dataAkceptacjiNotyWeryfikacjiList"
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

const RECOMMENDATION_EXPORT_COLUMNS: ExportColumnDefinition<RecommendationExportColumnKey>[] =
	[
		{ key: "lp", label: "Lp. zalecenia" },
		{ key: "kodZalecenia", label: "Id zalecenia" },
		{ key: "inspectionLp", label: "Id inspekcji" },
		{ key: "zespoly", label: "Zespoły" },
		{ key: "nazwaPodmiotu", label: "Nazwa podmiotu" },
		{ key: "pozycja", label: "Liczba zaleceń" },
		{ key: "dataZalecen", label: "Data zaleceń" },
		{ key: "terminyWykonaniaZalecenList", label: "Termin wykonania zaleceń" },
		{
			key: "dataAkceptacjiNotyWeryfikacjiList",
			label: "Data akceptacji noty z weryfikacji",
		},
		{ key: "status", label: "Status" },
		{ key: "komentarz", label: "Komentarz" },
	];

const SANCTION_EXPORT_COLUMNS: ExportColumnDefinition<SanctionExportColumnKey>[] =
	[
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

const DECISION_EXPORT_COLUMNS: ExportColumnDefinition<DecisionExportColumnKey>[] =
	[
		{ key: "lp", label: "Lp. decyzji" },
		{ key: "kodDecyzji", label: "Id decyzji" },
		{ key: "kodZalecenia", label: "Id zalecenia" },
		{ key: "inspectionLp", label: "Id inspekcji" },
		{ key: "zespoly", label: "Zespoły" },
		{ key: "nazwaPodmiotu", label: "Nazwa podmiotu" },
		{ key: "liczbaZalecen", label: "Liczba zaleceń" },
		{
			key: "dataWszczeciaPostepowaniaIInstancji",
			label: "Data wszczęcia postępowania I instancji",
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
		{ key: "rozstrzygniecieI", label: "Rozstrzygnięcie decyzji I instancji" },
		{
			key: "dataWnioskuPonowneRozpatrzenie",
			label: "Data wniosku o ponowne rozpatrzenie",
		},
		{
			key: "dataWplywuWnioskuPonowneRozpatrzenie",
			label: "Data wpływu wniosku o ponowne rozpatrzenie",
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
		{ key: "rozstrzygniecieII", label: "Rozstrzygnięcie decyzji II instancji" },
		{ key: "komentarz", label: "Komentarz" },
	];

export function InspectionsPanel({
	operatorLogin,
	authRole,
	isObserver,
}: InspectionsPanelProps) {
	const [inspectionRows, setInspectionRows] = useState<InspectionRow[]>([]);
	const [inspectionShortValuesByRowId, setInspectionShortValuesByRowId] =
		useState<Record<string, InspectionShortValuesByColumn>>({});
	const [inspectionNameVariants, setInspectionNameVariants] =
		useState<InspectionNameVariantByColumn>(DEFAULT_INSPECTION_NAME_VARIANTS);
	const [draftInspectionNameVariants, setDraftInspectionNameVariants] =
		useState<InspectionNameVariantByColumn>(DEFAULT_INSPECTION_NAME_VARIANTS);
	const [areNameVariantsHydrated, setAreNameVariantsHydrated] =
		useState(false);
	const [selectedInspectionId, setSelectedInspectionId] = useState<
		string | null
	>(null);
	const [flashInspectionId, setFlashInspectionId] = useState<string | null>(null);
	const [centerInspectionId, setCenterInspectionId] = useState<string | null>(
		null,
	);
	const [pendingDashboardInspectionCode, setPendingDashboardInspectionCode] =
		useState<string | null>(null);
	const [isAddModalOpen, setIsAddModalOpen] = useState(false);
	const [isPreviewMode, setIsPreviewMode] = useState(false);
	const [isTeamPickerOpen, setIsTeamPickerOpen] = useState(false);
	const [editingInspectionId, setEditingInspectionId] = useState<string | null>(
		null,
	);
	const [addInspectionForm, setAddInspectionForm] = useState<AddInspectionForm>(
		DEFAULT_ADD_INSPECTION_FORM,
	);
	const [addInspectionError, setAddInspectionError] = useState<string | null>(
		null,
	);
	const [showRequiredInspectionFieldErrors, setShowRequiredInspectionFieldErrors] =
		useState(false);
	const [rowsError, setRowsError] = useState<string | null>(null);
	const [isRowsLoading, setIsRowsLoading] = useState(true);
	const [isSubmittingInspection, setIsSubmittingInspection] = useState(false);
	const [isCreateSuccessModalOpen, setIsCreateSuccessModalOpen] =
		useState(false);
	const [createSuccessEntityName, setCreateSuccessEntityName] = useState("");
	const [createSuccessMode, setCreateSuccessMode] = useState<"create" | "edit">(
		"create",
	);
	const [isExporting, setIsExporting] = useState(false);
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [isExportConfigModalOpen, setIsExportConfigModalOpen] = useState(false);
	const [includeRecommendationsInExport, setIncludeRecommendationsInExport] =
		useState(false);
	const [includeSanctionsInExport, setIncludeSanctionsInExport] =
		useState(false);
	const [includeDecisionsInExport, setIncludeDecisionsInExport] =
		useState(false);
	const [activeExportColumnsTab, setActiveExportColumnsTab] = useState<
		"recommendations" | "sanctions" | "decisions"
	>("recommendations");
	const [
		selectedRecommendationExportColumns,
		setSelectedRecommendationExportColumns,
	] = useState<RecommendationExportColumnKey[]>(
		RECOMMENDATION_EXPORT_COLUMNS.map((column) => column.key),
	);
	const [selectedSanctionExportColumns, setSelectedSanctionExportColumns] =
		useState<SanctionExportColumnKey[]>(
			SANCTION_EXPORT_COLUMNS.map((column) => column.key),
		);
	const [selectedDecisionExportColumns, setSelectedDecisionExportColumns] =
		useState<DecisionExportColumnKey[]>(
			DECISION_EXPORT_COLUMNS.map((column) => column.key),
		);
	const [entityNameOptions, setEntityNameOptions] = useState<
		DictionarySelectOption[]
	>([]);
	const [inspectionTypeOptions, setInspectionTypeOptions] = useState<string[]>(
		[],
	);
	const [inspectionTypeIdByValue, setInspectionTypeIdByValue] = useState<
		Record<string, number>
	>({});
	const [inspectionTypeCodeByValue, setInspectionTypeCodeByValue] = useState<
		Record<string, string>
	>({});
	const [inspectionTypeValueById, setInspectionTypeValueById] = useState<
		Record<number, string>
	>({});
	const [inspectionTypeValueByCode, setInspectionTypeValueByCode] = useState<
		Record<string, string>
	>({});
	const [inspectionScopeOptions, setInspectionScopeOptions] = useState<
		DictionarySelectOption[]
	>([]);
	const [inspectionScopeMapByValue, setInspectionScopeMapByValue] =
		useState<Record<string, string>>({});
	const [inspectionScopeIdByValue, setInspectionScopeIdByValue] = useState<
		Record<string, number>
	>({});
	const [inspectionScopeValueById, setInspectionScopeValueById] = useState<
		Record<number, string>
	>({});
	const [marketShortLabelByValue, setMarketShortLabelByValue] =
		useState<Record<string, string>>({});
	const [marketIdByValue, setMarketIdByValue] = useState<Record<string, number>>(
		{},
	);
	const [marketCodeByValue, setMarketCodeByValue] = useState<
		Record<string, string>
	>({});
	const [marketValueById, setMarketValueById] = useState<Record<number, string>>(
		{},
	);
	const [marketValueByCode, setMarketValueByCode] = useState<
		Record<string, string>
	>({});
	const [teamShortLabelByTeamId, setTeamShortLabelByTeamId] = useState<
		Record<number, string>
	>({});
	const [teamShortLabelByTeamName, setTeamShortLabelByTeamName] = useState<
		Record<string, string>
	>({});
	const [marketOptions, setMarketOptions] = useState<string[]>([]);
	const [inspectionTeamOptions, setInspectionTeamOptions] = useState<
		Array<{ id: number; label: string; filterGroup: InspectionFilterGroup | null }>
	>([]);
	const [entityTypeOptions, setEntityTypeOptions] = useState<string[]>([]);
	const [entityTypeIdByValue, setEntityTypeIdByValue] = useState<
		Record<string, number>
	>({});
	const [entityTypeCodeByValue, setEntityTypeCodeByValue] = useState<
		Record<string, string>
	>({});
	const [entityTypeValueById, setEntityTypeValueById] = useState<
		Record<number, string>
	>({});
	const [entityTypeValueByCode, setEntityTypeValueByCode] = useState<
		Record<string, string>
	>({});
	const [inspectionStatusOptions, setInspectionStatusOptions] = useState<
		DictionarySelectOption[]
	>([]);
	const [inspectionStatusIdByValue, setInspectionStatusIdByValue] = useState<
		Record<string, number>
	>({});
	const [inspectionStatusCodeByValue, setInspectionStatusCodeByValue] = useState<
		Record<string, string>
	>({});
	const [inspectionStatusValueById, setInspectionStatusValueById] = useState<
		Record<number, string>
	>({});
	const [inspectionStatusValueByCode, setInspectionStatusValueByCode] = useState<
		Record<string, string>
	>({});
	const [allUsers, setAllUsers] = useState<InspectionPeopleOption[]>([]);
	const [activeUsers, setActiveUsers] = useState<InspectionPeopleOption[]>([]);
	const [selectedInspectionScopes, setSelectedInspectionScopes] = useState<
		string[]
	>([]);
	const [selectedTeamMemberIds, setSelectedTeamMemberIds] = useState<number[]>(
		[],
	);
	const [selectedInspectionTeamIds, setSelectedInspectionTeamIds] = useState<
		number[]
	>([]);
	const [isInspectionTeamSelectionManual, setIsInspectionTeamSelectionManual] =
		useState(false);
	const [teamMemberScopeError, setTeamMemberScopeError] = useState<string | null>(
		null,
	);
	const [outOfScopeTeamMemberUserId, setOutOfScopeTeamMemberUserId] = useState<
		number | null
	>(null);
	const [operatorUserId, setOperatorUserId] = useState<number | null>(null);
	const [operatorTeamId, setOperatorTeamId] = useState<number | null>(null);
	const [selectedLeaderUserId, setSelectedLeaderUserId] = useState<
		number | null
	>(null);
	const [inspectionLeaderUserIdByRowId, setInspectionLeaderUserIdByRowId] =
		useState<Record<string, number | null>>({});
	const [inspectionTeamMemberIdsByRowId, setInspectionTeamMemberIdsByRowId] =
		useState<Record<string, number[]>>({});
	const [inspectionTeamIdsByRowId, setInspectionTeamIdsByRowId] = useState<
		Record<string, number[]>
	>({});
	const [inspectionScopeIdsByRowId, setInspectionScopeIdsByRowId] =
		useState<Record<string, number[]>>({});
	const [inspectionScopeValuesByRowId, setInspectionScopeValuesByRowId] =
		useState<Record<string, string[]>>({});
	const [inspectionTypeIdByRowId, setInspectionTypeIdByRowId] = useState<
		Record<string, number | null>
	>({});
	const [inspectionTypeCodeByRowId, setInspectionTypeCodeByRowId] = useState<
		Record<string, string>
	>({});
	const [marketIdByRowId, setMarketIdByRowId] = useState<
		Record<string, number | null>
	>({});
	const [marketCodeByRowId, setMarketCodeByRowId] = useState<
		Record<string, string>
	>({});
	const [entityTypeIdByRowId, setEntityTypeIdByRowId] = useState<
		Record<string, number | null>
	>({});
	const [entityTypeCodeByRowId, setEntityTypeCodeByRowId] = useState<
		Record<string, string>
	>({});
	const [inspectionStatusIdByRowId, setInspectionStatusIdByRowId] = useState<
		Record<string, number | null>
	>({});
	const [inspectionStatusCodePositionByRowId, setInspectionStatusCodePositionByRowId] =
		useState<Record<string, string>>({});
	const [
		inspectionAcceptanceDatesByRowId,
		setInspectionAcceptanceDatesByRowId,
	] = useState<Record<string, string[]>>({});
	const [inspectionNoAcceptanceDatesByRowId, setInspectionNoAcceptanceDatesByRowId] =
		useState<Record<string, InspectionNoAcceptanceDatesFlags>>({});
	const [inspectionNoLetterFlagsByRowId, setInspectionNoLetterFlagsByRowId] =
		useState<Record<string, InspectionNoLetterFlags>>({});
	const [inspectionCanEditByRowId, setInspectionCanEditByRowId] = useState<
		Record<string, boolean>
	>({});
	const [inspectionStatusCodeByRowId, setInspectionStatusCodeByRowId] = useState<
		Record<string, string>
	>({});
	const [inspectionStatusStyleByCode, setInspectionStatusStyleByCode] = useState<
		Record<
			string,
			{ kolor: string | null; odcien: number | null; intensywnosc: number | null }
		>
	>({});
	const [inspectionLockRecordIdsByRowId, setInspectionLockRecordIdsByRowId] =
		useState<Record<string, string[]>>({});
	const [inspectionUpdatedAtByRowId, setInspectionUpdatedAtByRowId] = useState<
		Record<string, string | null>
	>({});
	const [inspectionCreatedByLabelByRowId, setInspectionCreatedByLabelByRowId] =
		useState<Record<string, string>>({});
	const [recommendationCodeByDateByInspectionRowId, setRecommendationCodeByDateByInspectionRowId] =
		useState<Record<string, Record<string, string>>>({});
	const [versionConflictUpdatedAt, setVersionConflictUpdatedAt] = useState<
		string | null
	>(null);
	const [statusValidationViolations, setStatusValidationViolations] = useState<
		InspectionStatusValidationViolation[]
	>([]);
	const [isStatusValidationModalOpen, setIsStatusValidationModalOpen] =
		useState(false);
	const [inspectionDatesValidationModalData, setInspectionDatesValidationModalData] =
		useState<InspectionDatesValidationModalData | null>(null);
	const [saveLockConflict, setSaveLockConflict] =
		useState<InspectionLockConflict | null>(null);
	const [operatorDisplayName, setOperatorDisplayName] = useState(
		operatorLogin.trim(),
	);
	const [dataAkceptacjiNotyList, setDataAkceptacjiNotyList] = useState<
		string[]
	>([]);
	const [isDataAkceptacjiNotyBrak, setIsDataAkceptacjiNotyBrak] =
		useState(false);
	const [didToggleDataAkceptacjiNotyBrak, setDidToggleDataAkceptacjiNotyBrak] =
		useState(false);
	const [isDeleteConfirmModalOpen, setIsDeleteConfirmModalOpen] =
		useState(false);
	const [isDeletingInspection, setIsDeletingInspection] = useState(false);
	const [isDeleteSuccessModalOpen, setIsDeleteSuccessModalOpen] =
		useState(false);
	const [deleteSuccessModalMessage, setDeleteSuccessModalMessage] = useState<
		string | null
	>(null);
	const [columnWidths, setColumnWidths] = useState<
		Partial<Record<InspectionColumnKey, number>>
	>(DEFAULT_INSPECTIONS_COLUMN_WIDTHS);
	const [isStatusHighlightingEnabled, setIsStatusHighlightingEnabled] =
		useState(true);
	const [isStatusHighlightingHydrated, setIsStatusHighlightingHydrated] =
		useState(false);
	const [cachedQuickFilterTeamLabels, setCachedQuickFilterTeamLabels] = useState<
		string[]
	>([]);
	const [teamFilterGroupByTeamId, setTeamFilterGroupByTeamId] = useState<
		Record<number, InspectionFilterGroup>
	>({});
	const [areQuickFiltersHydrated, setAreQuickFiltersHydrated] = useState(false);
	const [areColumnWidthsHydrated, setAreColumnWidthsHydrated] = useState(false);
	const canManageInspections = authRole !== "external_user" && !isObserver;
	const isDirector = authRole === "director";
	const normalizedOperatorLogin = operatorLogin.trim().toLowerCase();
	const columnWidthsStorageKey = `${INSPECTIONS_COLUMN_WIDTHS_STORAGE_PREFIX}.${normalizedOperatorLogin}`;
	const statusHighlightingStorageKey = `triangle.ui.inspections.status-highlighting.${normalizedOperatorLogin}`;
	const nameVariantsStorageKey = `${INSPECTIONS_NAME_VARIANTS_STORAGE_PREFIX}.${normalizedOperatorLogin}`;
	const tableViewStorageKey = `${INSPECTIONS_TABLE_VIEW_STORAGE_PREFIX}.${normalizedOperatorLogin}`;
	const quickFilterTeamLabelsStorageKey = `${INSPECTIONS_QUICK_FILTER_TEAM_LABELS_STORAGE_PREFIX}.${normalizedOperatorLogin}`;
	const quickFilterSelectionsStorageKey = `${INSPECTIONS_QUICK_FILTER_SELECTIONS_STORAGE_PREFIX}.${normalizedOperatorLogin}`;

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		const raw = window.localStorage.getItem(quickFilterTeamLabelsStorageKey);
		if (!raw) {
			setCachedQuickFilterTeamLabels([]);
			return;
		}

		try {
			const parsed = JSON.parse(raw) as unknown;
			if (!Array.isArray(parsed)) {
				setCachedQuickFilterTeamLabels([]);
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

			setCachedQuickFilterTeamLabels(normalized);
		} catch {
			setCachedQuickFilterTeamLabels([]);
		}
	}, [quickFilterTeamLabelsStorageKey]);

	const selectedInspectionRow = useMemo(
		() =>
			selectedInspectionId
				? (inspectionRows.find((row) => row.id === selectedInspectionId) ??
					null)
				: null,
		[inspectionRows, selectedInspectionId],
	);

	const selectedInspectionCanEdit = useMemo(
		() =>
			selectedInspectionId
				? (inspectionCanEditByRowId[selectedInspectionId] ?? false)
				: false,
		[inspectionCanEditByRowId, selectedInspectionId],
	);

	const previewInspectionCanEdit = useMemo(
		() =>
			editingInspectionId
				? (inspectionCanEditByRowId[editingInspectionId] ?? false)
				: false,
		[editingInspectionId, inspectionCanEditByRowId],
	);

	const currentEditingInspectionLeaderUserId = useMemo(
		() =>
			editingInspectionId
				? (inspectionLeaderUserIdByRowId[editingInspectionId] ?? null)
				: null,
		[editingInspectionId, inspectionLeaderUserIdByRowId],
	);

	const currentEditingInspectionCreatedByLabel = useMemo(
		() =>
			editingInspectionId
				? (inspectionCreatedByLabelByRowId[editingInspectionId] ?? "-")
				: "-",
		[editingInspectionId, inspectionCreatedByLabelByRowId],
	);

	const isEditMode = Boolean(editingInspectionId);
	const canChangeLeaderInEdit = selectedInspectionCanEdit;
	const canChangeLeaderSelection = !isEditMode || canChangeLeaderInEdit;
	const editingInspectionLockRecordIds = editingInspectionId
		? (inspectionLockRecordIdsByRowId[editingInspectionId] ?? [
				editingInspectionId,
			])
		: [];
	const primaryEditingInspectionLockRecordId =
		editingInspectionLockRecordIds[0] ?? null;
	const alternateEditingInspectionLockRecordIds = useMemo(
		() => editingInspectionLockRecordIds.slice(1),
		[editingInspectionLockRecordIds.join("|")],
	);
	const editInspectionLock = useRecordLock({
		enabled: isAddModalOpen && isEditMode && !isPreviewMode,
		module: "inspections",
		recordId: primaryEditingInspectionLockRecordId,
		alternateRecordIds: alternateEditingInspectionLockRecordIds,
		operatorLogin,
		heartbeatIntervalMs: 20_000,
	});
	const shouldShowLockedByOtherUser =
		Boolean(saveLockConflict) || editInspectionLock.isBlocked;
	const isReadOnlyDueToLock = isEditMode && shouldShowLockedByOtherUser;
	const lockOwnerDisplayName =
		saveLockConflict?.ownerDisplayName ||
		editInspectionLock.owner?.displayName ||
		"";
	const lockOwnerLogin =
		saveLockConflict?.ownerLogin || editInspectionLock.owner?.login || "";
	const lockOwnerLabel =
		lockOwnerDisplayName || lockOwnerLogin
			? `${lockOwnerDisplayName || "Nieznany użytkownik"}${
					lockOwnerLogin ? ` (${lockOwnerLogin})` : ""
				}`
			: "inny użytkownik";
	const lockAcquiredAt =
		saveLockConflict?.acquiredAt ||
		editInspectionLock.lockDetails?.acquiredAt ||
		null;
	const selectedStatusForValidation = addInspectionForm.status.trim();

	const closeInspectionFormModalRef = useRef<() => void>(() => {});
	const inactivityTimeout = useInactivityTimeout({
		enabled: isAddModalOpen,
		inactivityMs: INACTIVITY_TIMEOUT_MS,
		warningMs: INACTIVITY_WARNING_MS,
		onTimeout: () => closeInspectionFormModalRef.current(),
	});

	const inspectionLockNotice = shouldShowLockedByOtherUser
		? `Nie możesz teraz edytować tego wpisu, ponieważ jest edytowany przez innego użytkownika. Rekord edytuje teraz: ${lockOwnerLabel}, od ${formatLockStartHourMinute(lockAcquiredAt)}.`
		: isEditMode && editInspectionLock.isConnectionLost
				? (editInspectionLock.error ??
					"Utracono połączenie z serwerem — trwa próba odnowienia blokady...")
				: isEditMode && editInspectionLock.isExpired
					? (editInspectionLock.error ??
						"Czas edycji wygasł — połączenie zostało przerwane zbyt długo. Zamknij formularz i otwórz ponownie.")
					: isEditMode && editInspectionLock.isAcquireFailed
						? (editInspectionLock.error ??
							"Nie udało się założyć blokady rekordu.")
						: null;

	const loadInspections = useCallback(async () => {
		setRowsError(null);
		setIsRowsLoading(true);

		try {
			const inspectionsUrl = new URL(
				INSPECTIONS_API_URL,
				typeof window === "undefined" ? "http://localhost" : window.location.origin,
			);
			inspectionsUrl.searchParams.set("sortBy", INSPECTIONS_DEFAULT_SORT_BY);
			inspectionsUrl.searchParams.set("sortOrder", INSPECTIONS_DEFAULT_SORT_ORDER);

			const [response, recommendationsResult] = await Promise.all([
				fetch(inspectionsUrl.toString(), {
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
			]);

			const recommendationDatesByInspectionId = new Map<number, Set<string>>();
			const recommendationCodeByInspectionIdAndDate = new Map<
				number,
				Map<string, string>
			>();
			if (recommendationsResult.ok) {
				for (const recommendation of recommendationsResult.data.items) {
					const inspectionId = recommendation.inspectionId;
					const recommendationSingleDateSource =
						recommendation.dataZalecen ?? recommendation.terminWykonaniaZalecen;
					const recommendationDates = toDateList(recommendationSingleDateSource).sort(
						(left, right) =>
							left.localeCompare(right, "pl", { sensitivity: "base" }),
					);
					const recommendationCode =
						typeof recommendation.kodZalecenia === "string"
							? recommendation.kodZalecenia.trim()
							: "";
					const recommendationNavigationToken =
						recommendationCode ||
						(typeof recommendation.id === "number" && Number.isFinite(recommendation.id)
							? String(recommendation.id)
							: "");

					if (
						typeof inspectionId !== "number" ||
						!Number.isFinite(inspectionId) ||
						inspectionId <= 0 ||
						recommendationDates.length === 0
					) {
						continue;
					}

					const existing =
						recommendationDatesByInspectionId.get(inspectionId) ?? new Set<string>();
					for (const dateValue of recommendationDates) {
						existing.add(dateValue);
						if (recommendationNavigationToken) {
							const mapByDate =
								recommendationCodeByInspectionIdAndDate.get(inspectionId) ??
								new Map<string, string>();
							if (!mapByDate.has(dateValue)) {
								mapByDate.set(dateValue, recommendationNavigationToken);
							}
							recommendationCodeByInspectionIdAndDate.set(inspectionId, mapByDate);
						}
					}
					recommendationDatesByInspectionId.set(inspectionId, existing);
				}
			}

			if (!response.ok) {
				const apiMessage = await getInspectionApiErrorMessage(
					response,
					"Nie udało się pobrać danych",
				);
				throw new Error(apiMessage);
			}

			const payload = (await response.json()) as unknown;
			const rawItems: unknown[] = Array.isArray(payload)
				? payload
				: Array.isArray((payload as Partial<InspectionListResponse>).items)
					? ((payload as Partial<InspectionListResponse>).items ?? [])
					: [];

			const items = rawItems.map((row, index) => {
				const normalized = normalizeInspectionRow(
					(row ?? {}) as RawInspectionRow,
					index,
				);
				const descendingLp = rawItems.length - index;
				const rowInspectionId = Number((row as { id?: unknown }).id);
				const recommendationDates = Number.isFinite(rowInspectionId)
					? recommendationDatesByInspectionId.get(rowInspectionId)
					: undefined;

				if (!recommendationDates || recommendationDates.size === 0) {
					return {
						...normalized,
						lp: descendingLp,
					};
				}

				const mergedRecommendationDates = Array.from(recommendationDates).sort(
					(left, right) => left.localeCompare(right, "pl", { sensitivity: "base" }),
				);

				return {
					...normalized,
					lp: descendingLp,
					dataZalecen: mergedRecommendationDates.join(", "),
				};
			});

			const leaderMap: Record<string, number | null> = {};
			const relationMap: Record<string, number[]> = {};
			const inspectionTeamIdsMap: Record<string, number[]> = {};
			const scopeIdsMap: Record<string, number[]> = {};
			const scopeValuesMap: Record<string, string[]> = {};
			const inspectionTypeIdsMap: Record<string, number | null> = {};
			const inspectionTypeCodesMap: Record<string, string> = {};
			const marketIdsMap: Record<string, number | null> = {};
			const marketCodesMap: Record<string, string> = {};
			const entityTypeIdsMap: Record<string, number | null> = {};
			const entityTypeCodesMap: Record<string, string> = {};
			const inspectionStatusIdsMap: Record<string, number | null> = {};
			const inspectionStatusCodesMap: Record<string, string> = {};
			const acceptanceDatesMap: Record<string, string[]> = {};
			const noAcceptanceDatesMap: Record<
				string,
				InspectionNoAcceptanceDatesFlags
			> = {};
			const noLetterFlagsMap: Record<string, InspectionNoLetterFlags> = {};
			const canEditMap: Record<string, boolean> = {};
			const statusCodeByRowIdMap: Record<string, string> = {};
			const lockRecordIdsMap: Record<string, string[]> = {};
			const updatedAtMap: Record<string, string | null> = {};
			const createdByLabelMap: Record<string, string> = {};
			const recommendationCodeByDateByRowIdMap: Record<
				string,
				Record<string, string>
			> = {};
			const shortValuesByRowId: Record<string, InspectionShortValuesByColumn> = {};
			const resolveBooleanFlag = (value: unknown) => {
				if (typeof value === "boolean") {
					return value;
				}

				if (typeof value === "number") {
					return value === 1;
				}

				if (typeof value === "string") {
					const normalized = value.trim().toLowerCase();
					return (
						normalized === "true" ||
						normalized === "1" ||
						normalized === "tak"
					);
				}

				return false;
			};
			const isLegacyNoLetterValue = (value: unknown) =>
				String(value ?? "").trim().toLowerCase() === "brak pisma";
			const parseDictionaryId = (value: unknown) => {
				if (typeof value === "number" && Number.isFinite(value) && value > 0) {
					return value;
				}

				if (typeof value === "string") {
					const parsed = Number(value.trim());
					if (Number.isFinite(parsed) && parsed > 0) {
						return parsed;
					}
				}

				return null;
			};
			const parseDictionaryCode = (value: unknown) =>
				typeof value === "string" ? value.trim().toUpperCase() : "";
			const parseNumericIdList = (value: unknown) => {
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
							.filter(
								(item): item is number => Number.isFinite(item) && item > 0,
							),
					),
				).sort((left, right) => left - right);
			};
			rawItems.forEach((rawRow, index) => {
				const normalizedRow = normalizeInspectionRow(
					(rawRow ?? {}) as RawInspectionRow,
					index,
				);
				const maybeLeaderId = (rawRow as { osobaKierujacaUserId?: unknown })
					.osobaKierujacaUserId;
				const maybeTeamIds = (rawRow as { teamMemberUserIds?: unknown })
					.teamMemberUserIds;
				const maybeScopeValues =
					(rawRow as { zakresInspekcjiList?: unknown }).zakresInspekcjiList ??
					(rawRow as { zakres_inspekcji_list?: unknown }).zakres_inspekcji_list;
				const maybeScopeIds =
					(rawRow as { zakresInspekcjiIds?: unknown }).zakresInspekcjiIds ??
					(rawRow as { zakres_inspekcji_ids?: unknown }).zakres_inspekcji_ids;
				const maybeInspectionTeamIds =
					(rawRow as { inspectionTeamIds?: unknown }).inspectionTeamIds ??
					(rawRow as { inspection_team_ids?: unknown }).inspection_team_ids ??
					(rawRow as { zespolyInspekcjiIds?: unknown }).zespolyInspekcjiIds ??
					(rawRow as { zespoly_inspekcji_ids?: unknown }).zespoly_inspekcji_ids;
				const maybeAcceptanceDates = (
					rawRow as { dataAkceptacjiNotyList?: unknown }
				).dataAkceptacjiNotyList;
				const maybeCanEdit = (rawRow as { canEdit?: unknown }).canEdit;
				const noAcceptanceDates = resolveBooleanFlag(
					(rawRow as { brakDatAkceptacjiNoty?: unknown }).brakDatAkceptacjiNoty ??
						(rawRow as { brakDataAkceptacjiNotyList?: unknown })
							.brakDataAkceptacjiNotyList,
				);
				const noLetterDoreczenia = resolveBooleanFlag(
					(rawRow as { brakDataDoreczeniaPisma?: unknown })
						.brakDataDoreczeniaPisma,
				);
				const noLetterZastrzezenia = resolveBooleanFlag(
					(rawRow as { brakDataPismaZastrzezenia?: unknown })
						.brakDataPismaZastrzezenia,
				);
				const noLetterWyslaniaZastrzezen = resolveBooleanFlag(
					(rawRow as { brakDataWyslaniaPismaZZastrzezeniami?: unknown })
						.brakDataWyslaniaPismaZZastrzezeniami,
				);
				const noLetterWplywu = resolveBooleanFlag(
					(rawRow as { brakDataWplywuPisma?: unknown }).brakDataWplywuPisma,
				);
				const noLetterOdpowiedzi = resolveBooleanFlag(
					(rawRow as { brakDataPismaZOdpowiedzia?: unknown })
						.brakDataPismaZOdpowiedzia,
				);
				const noLetterWyslaniaOdpowiedzi = resolveBooleanFlag(
					(rawRow as { brakDataWyslaniaPismaZOdpowiedzia?: unknown })
						.brakDataWyslaniaPismaZOdpowiedzia,
				);
				const maybeUpdatedAt =
					(rawRow as { zaktualizowanoO?: unknown }).zaktualizowanoO ??
					(rawRow as { updatedAt?: unknown }).updatedAt;
				const maybeCreatedByDisplayName =
					(rawRow as { createdByDisplayName?: unknown }).createdByDisplayName ??
					(rawRow as { createdByFullName?: unknown }).createdByFullName ??
					(rawRow as { utworzylDisplayName?: unknown }).utworzylDisplayName ??
					(rawRow as { createdBy?: { displayName?: unknown } }).createdBy
						?.displayName;
				const maybeCreatedByLogin =
					(rawRow as { createdByLogin?: unknown }).createdByLogin ??
					(rawRow as { utworzylLogin?: unknown }).utworzylLogin ??
					(rawRow as { createdBy?: { login?: unknown } }).createdBy?.login;
				const maybeInspectionTypeId =
					(rawRow as { typInspekcjiId?: unknown }).typInspekcjiId ??
					(rawRow as { typ_inspekcji_id?: unknown }).typ_inspekcji_id;
				const maybeInspectionTypeCode =
					(rawRow as { typInspekcjiKodPozycji?: unknown }).typInspekcjiKodPozycji ??
					(rawRow as { typ_inspekcji_kod_pozycji?: unknown })
						.typ_inspekcji_kod_pozycji ??
					(rawRow as { typInspekcjiKod?: unknown }).typInspekcjiKod;
				const maybeMarketId =
					(rawRow as { rynekId?: unknown }).rynekId ??
					(rawRow as { rynek_id?: unknown }).rynek_id;
				const maybeMarketCode =
					(rawRow as { rynekKodPozycji?: unknown }).rynekKodPozycji ??
					(rawRow as { rynek_kod_pozycji?: unknown }).rynek_kod_pozycji ??
					(rawRow as { rynekKod?: unknown }).rynekKod;
				const maybeEntityTypeId =
					(rawRow as { rodzajPodmiotuId?: unknown }).rodzajPodmiotuId ??
					(rawRow as { rodzaj_podmiotu_id?: unknown }).rodzaj_podmiotu_id;
				const maybeEntityTypeCode =
					(rawRow as { rodzajPodmiotuKodPozycji?: unknown })
						.rodzajPodmiotuKodPozycji ??
					(rawRow as { rodzaj_podmiotu_kod_pozycji?: unknown })
						.rodzaj_podmiotu_kod_pozycji ??
					(rawRow as { rodzajPodmiotuKod?: unknown }).rodzajPodmiotuKod;
				const maybeStatusId =
					(rawRow as { statusId?: unknown }).statusId ??
					(rawRow as { status_id?: unknown }).status_id;
				const maybeStatusCode =
					(rawRow as { statusKodPozycji?: unknown }).statusKodPozycji ??
					(rawRow as { status_kod_pozycji?: unknown }).status_kod_pozycji;

				const legacyAcceptanceDate = toDateInputValue(
					normalizedRow.dataAkceptacjiNoty,
				);

				leaderMap[normalizedRow.id] =
					parsePositiveNumericId(maybeLeaderId);
				relationMap[normalizedRow.id] = parseNumericIdList(maybeTeamIds);
				const rowInspectionId = Number((rawRow as { id?: unknown }).id);
				if (Number.isFinite(rowInspectionId) && rowInspectionId > 0) {
					const recommendationMapByDate =
						recommendationCodeByInspectionIdAndDate.get(rowInspectionId);
					if (recommendationMapByDate) {
						recommendationCodeByDateByRowIdMap[normalizedRow.id] =
							Object.fromEntries(recommendationMapByDate.entries());
					}
				}
				inspectionTeamIdsMap[normalizedRow.id] = parseNumericIdList(
					maybeInspectionTeamIds,
				);
				scopeIdsMap[normalizedRow.id] = Array.isArray(maybeScopeIds)
					? maybeScopeIds
							.map((value) =>
								typeof value === "number"
									? value
									: typeof value === "string"
										? Number(value.trim())
										: NaN,
							)
							.filter(
								(value): value is number =>
									Number.isFinite(value) && value > 0,
							)
					: [];
				scopeValuesMap[normalizedRow.id] = Array.isArray(maybeScopeValues)
					? normalizeInspectionScopeValues(
							maybeScopeValues.map((value) => String(value ?? "")),
						)
					: [];
				inspectionTypeIdsMap[normalizedRow.id] = parseDictionaryId(
					maybeInspectionTypeId,
				);
				inspectionTypeCodesMap[normalizedRow.id] = parseDictionaryCode(
					maybeInspectionTypeCode,
				);
				marketIdsMap[normalizedRow.id] = parseDictionaryId(maybeMarketId);
				marketCodesMap[normalizedRow.id] = parseDictionaryCode(maybeMarketCode);
				entityTypeIdsMap[normalizedRow.id] = parseDictionaryId(maybeEntityTypeId);
				entityTypeCodesMap[normalizedRow.id] = parseDictionaryCode(
					maybeEntityTypeCode,
				);
				inspectionStatusIdsMap[normalizedRow.id] = parseDictionaryId(maybeStatusId);
				inspectionStatusCodesMap[normalizedRow.id] = parseDictionaryCode(
					maybeStatusCode,
				);
				const rawStatusCode =
					(rawRow as { statusKodPozycji?: unknown }).statusKodPozycji ??
					(rawRow as { status_kod_pozycji?: unknown }).status_kod_pozycji ??
					(rawRow as { statusCode?: unknown }).statusCode ??
					(rawRow as { status?: unknown }).status ??
					normalizedRow.status;
				const normalizedStatusCode =
					typeof rawStatusCode === "string" ? rawStatusCode.trim() : "";
				if (normalizedStatusCode) {
					statusCodeByRowIdMap[normalizedRow.id] = normalizedStatusCode;
				}
				acceptanceDatesMap[normalizedRow.id] = toDateList(maybeAcceptanceDates)
					.length
					? toDateList(maybeAcceptanceDates)
					: legacyAcceptanceDate
						? [legacyAcceptanceDate]
						: [];
				noAcceptanceDatesMap[normalizedRow.id] = {
					brakDatAkceptacjiNoty: noAcceptanceDates,
				};
				noLetterFlagsMap[normalizedRow.id] = {
					brakDataDoreczeniaPisma:
						noLetterDoreczenia ||
						isLegacyNoLetterValue(
							(rawRow as { dataDoreczeniaPisma?: unknown }).dataDoreczeniaPisma,
						),
					brakDataPismaZastrzezenia:
						noLetterZastrzezenia ||
						isLegacyNoLetterValue(
							(rawRow as { dataPismaZastrzezenia?: unknown })
								.dataPismaZastrzezenia,
						),
					brakDataWyslaniaPismaZZastrzezeniami:
						noLetterWyslaniaZastrzezen ||
						isLegacyNoLetterValue(
							(rawRow as { dataWyslaniaPismaZZastrzezeniami?: unknown })
								.dataWyslaniaPismaZZastrzezeniami,
						),
					brakDataWplywuPisma:
						noLetterWplywu ||
						isLegacyNoLetterValue(
							(rawRow as { dataWplywuPisma?: unknown }).dataWplywuPisma,
						),
					brakDataPismaZOdpowiedzia:
						noLetterOdpowiedzi ||
						isLegacyNoLetterValue(
							(rawRow as { dataPismaZOdpowiedzia?: unknown })
								.dataPismaZOdpowiedzia,
						),
					brakDataWyslaniaPismaZOdpowiedzia:
						noLetterWyslaniaOdpowiedzi ||
						isLegacyNoLetterValue(
							(rawRow as { dataWyslaniaPismaZOdpowiedzia?: unknown })
								.dataWyslaniaPismaZOdpowiedzia,
						),
				};
				canEditMap[normalizedRow.id] =
					typeof maybeCanEdit === "boolean" ? maybeCanEdit : false;
				lockRecordIdsMap[normalizedRow.id] = resolveInspectionLockRecordIds(
					(rawRow ?? {}) as RawInspectionRow,
					normalizedRow.id,
				);
				updatedAtMap[normalizedRow.id] =
					typeof maybeUpdatedAt === "string" && maybeUpdatedAt.trim()
						? maybeUpdatedAt.trim()
						: null;
				const createdByDisplayName =
					typeof maybeCreatedByDisplayName === "string"
						? maybeCreatedByDisplayName.trim()
						: "";
				const createdByLogin =
					typeof maybeCreatedByLogin === "string"
						? maybeCreatedByLogin.trim()
						: "";
				createdByLabelMap[normalizedRow.id] =
					createdByDisplayName || createdByLogin || "-";
				shortValuesByRowId[normalizedRow.id] = {
					nazwaPodmiotu: String(
						(rawRow as { nazwaPodmiotuSkrocona?: unknown }).nazwaPodmiotuSkrocona ??
							(rawRow as { nazwaPodmiotuSkrot?: unknown }).nazwaPodmiotuSkrot ??
							"",
					).trim(),
					typInspekcji: String(
						(rawRow as { typInspekcjiSkrocona?: unknown }).typInspekcjiSkrocona ??
							(rawRow as { typInspekcjiSkrot?: unknown }).typInspekcjiSkrot ??
							"",
					).trim(),
					zakresInspekcji: String(
						(rawRow as { zakresInspekcjiSkrocona?: unknown })
							.zakresInspekcjiSkrocona ??
							(rawRow as { zakresInspekcjiSkrot?: unknown }).zakresInspekcjiSkrot ??
							"",
					).trim(),
					rodzajPodmiotu: String(
						(rawRow as { rodzajPodmiotuSkrocona?: unknown }).rodzajPodmiotuSkrocona ??
							(rawRow as { rodzajPodmiotuSkrot?: unknown }).rodzajPodmiotuSkrot ??
							"",
					).trim(),
					status: String(
						(rawRow as { statusSkrocona?: unknown }).statusSkrocona ??
							(rawRow as { statusSkrot?: unknown }).statusSkrot ??
							"",
					).trim(),
				};
			});

			setInspectionLeaderUserIdByRowId(leaderMap);
			setInspectionTeamMemberIdsByRowId(relationMap);
			setInspectionTeamIdsByRowId(inspectionTeamIdsMap);
			setInspectionScopeIdsByRowId(scopeIdsMap);
			setInspectionScopeValuesByRowId(scopeValuesMap);
			setInspectionTypeIdByRowId(inspectionTypeIdsMap);
			setInspectionTypeCodeByRowId(inspectionTypeCodesMap);
			setMarketIdByRowId(marketIdsMap);
			setMarketCodeByRowId(marketCodesMap);
			setEntityTypeIdByRowId(entityTypeIdsMap);
			setEntityTypeCodeByRowId(entityTypeCodesMap);
			setInspectionStatusIdByRowId(inspectionStatusIdsMap);
			setInspectionStatusCodePositionByRowId(inspectionStatusCodesMap);
			setInspectionAcceptanceDatesByRowId(acceptanceDatesMap);
			setInspectionNoAcceptanceDatesByRowId(noAcceptanceDatesMap);
			setInspectionNoLetterFlagsByRowId(noLetterFlagsMap);
			setInspectionCanEditByRowId(canEditMap);
			setInspectionStatusCodeByRowId(statusCodeByRowIdMap);
			setInspectionLockRecordIdsByRowId(lockRecordIdsMap);
			setInspectionUpdatedAtByRowId(updatedAtMap);
			setInspectionCreatedByLabelByRowId(createdByLabelMap);
			setRecommendationCodeByDateByInspectionRowId(
				recommendationCodeByDateByRowIdMap,
			);
			setInspectionShortValuesByRowId(shortValuesByRowId);
			setInspectionRows(items);
			setSelectedInspectionId((prev) =>
				prev && items.some((row) => row.id === prev) ? prev : null,
			);
		} catch (error) {
			setRowsError(
				error instanceof Error && error.message
					? error.message
					: "Nie udało się pobrać danych Ewidencji kontroli z backendu.",
			);
			setInspectionRows([]);
			setSelectedInspectionId(null);
			setInspectionLeaderUserIdByRowId({});
			setInspectionTeamMemberIdsByRowId({});
			setInspectionTeamIdsByRowId({});
			setInspectionScopeIdsByRowId({});
			setInspectionScopeValuesByRowId({});
			setInspectionTypeIdByRowId({});
			setInspectionTypeCodeByRowId({});
			setMarketIdByRowId({});
			setMarketCodeByRowId({});
			setEntityTypeIdByRowId({});
			setEntityTypeCodeByRowId({});
			setInspectionStatusIdByRowId({});
			setInspectionStatusCodePositionByRowId({});
			setInspectionAcceptanceDatesByRowId({});
			setInspectionNoAcceptanceDatesByRowId({});
			setInspectionNoLetterFlagsByRowId({});
			setInspectionCanEditByRowId({});
			setInspectionStatusCodeByRowId({});
			setInspectionLockRecordIdsByRowId({});
			setInspectionUpdatedAtByRowId({});
			setInspectionCreatedByLabelByRowId({});
			setRecommendationCodeByDateByInspectionRowId({});
			setInspectionShortValuesByRowId({});
		} finally {
			setIsRowsLoading(false);
		}
	}, [operatorLogin]);

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
		void loadInspections();
	}, [loadInspections]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		const fromSession = window.sessionStorage.getItem(
			DASHBOARD_OPEN_INSPECTION_CODE_KEY,
		);
		if (fromSession?.trim()) {
			setPendingDashboardInspectionCode(fromSession.trim());
		}

		const handleOpenInspectionFromDashboard = (event: Event) => {
			const customEvent = event as CustomEvent<{ inspectionCode?: unknown }>;
			const inspectionCode =
				typeof customEvent.detail?.inspectionCode === "string"
					? customEvent.detail.inspectionCode.trim()
					: "";
			if (!inspectionCode) {
				return;
			}

			window.sessionStorage.setItem(
				DASHBOARD_OPEN_INSPECTION_CODE_KEY,
				inspectionCode,
			);
			setPendingDashboardInspectionCode(inspectionCode);
		};

		window.addEventListener(
			DASHBOARD_OPEN_INSPECTION_EVENT,
			handleOpenInspectionFromDashboard,
		);

		return () => {
			window.removeEventListener(
				DASHBOARD_OPEN_INSPECTION_EVENT,
				handleOpenInspectionFromDashboard,
			);
		};
	}, []);

	useEffect(() => {
		const handleRecommendationsChanged = () => {
			void loadInspections();
		};

		window.addEventListener(
			RECOMMENDATIONS_CHANGED_EVENT,
			handleRecommendationsChanged,
		);
		return () => {
			window.removeEventListener(
				RECOMMENDATIONS_CHANGED_EVENT,
				handleRecommendationsChanged,
			);
		};
	}, [loadInspections]);

	const loadInspectionDictionaries = useCallback(async () => {
		const resolveOptions = (
			result: Awaited<ReturnType<typeof fetchDictionaryEntries>>,
		) => {
			if (!result.ok) {
				return [];
			}

			return mapDictionaryEntriesToOptions(result.data);
		};

		const resolveSelectOptions = (
			result: Awaited<ReturnType<typeof fetchDictionaryEntries>>,
		) => {
			if (!result.ok) {
				return [];
			}

			return mapDictionaryEntriesToSelectOptions(result.data);
		};

		const resolveDictionaryValueMaps = (
			result: Awaited<ReturnType<typeof fetchDictionaryEntries>>,
		) => {
			const idByValue: Record<string, number> = {};
			const codeByValue: Record<string, string> = {};
			const valueById: Record<number, string> = {};
			const valueByCode: Record<string, string> = {};

			if (!result.ok) {
				return { idByValue, codeByValue, valueById, valueByCode };
			}

			for (const entry of result.data) {
				const value = entry.nazwaPozycji.trim();
				const entryId =
					typeof entry.id === "number" && Number.isFinite(entry.id)
						? entry.id
						: null;
				const entryCode = (entry.kodPozycji ?? "").trim().toUpperCase();

				if (!value) {
					continue;
				}

				if (entryId && !idByValue[value]) {
					idByValue[value] = entryId;
				}

				if (entryId && !valueById[entryId]) {
					valueById[entryId] = value;
				}

				if (entryCode && !codeByValue[value]) {
					codeByValue[value] = entryCode;
				}

				if (entryCode && !valueByCode[entryCode]) {
					valueByCode[entryCode] = value;
				}
			}

			return { idByValue, codeByValue, valueById, valueByCode };
		};

		try {
			const normalizedOperatorLogin = operatorLogin.trim().toLowerCase();
			const [
				entityNamesResult,
				inspectionTypesResult,
				inspectionScopesResult,
				marketsResult,
				teamsResult,
				entityTypesResult,
				inspectionStatusesResult,
			] = await Promise.all([
				fetchDictionaryEntries("nazwy_podmiotow"),
				fetchDictionaryEntries("typy_inspekcji"),
				fetchDictionaryEntries("zakresy_inspekcji"),
				fetchDictionaryEntries("rynki"),
				fetchDictionaryEntries("zespoly", operatorLogin),
				fetchDictionaryEntries("rodzaje_podmiotu"),
				fetchDictionaryEntries("statusy_inspekcji"),
			]);

			type BackendInspectionTeamOption = {
				id: number;
				code: string;
				name: string;
				filterGroup: InspectionFilterGroup | null;
				isActive: boolean;
			};
			const parseInspectionTeamOptionsPayload = (payload: unknown) => {
				const rawItems = Array.isArray(payload)
					? payload
					: Array.isArray((payload as { items?: unknown[] })?.items)
						? ((payload as { items?: unknown[] }).items ?? [])
						: [];

				return rawItems
					.map((item) => {
						const raw = (item ?? {}) as {
							id?: unknown;
							code?: unknown;
							kod?: unknown;
							name?: unknown;
							nazwa?: unknown;
							filterGroup?: unknown;
							grupaFiltrow?: unknown;
							isActive?: unknown;
							aktywny?: unknown;
						};

						const id = Number(raw.id);
						const code =
							typeof raw.code === "string"
								? raw.code.trim()
								: typeof raw.kod === "string"
									? raw.kod.trim()
									: "";
						const name =
							typeof raw.name === "string"
								? raw.name.trim()
								: typeof raw.nazwa === "string"
									? raw.nazwa.trim()
									: "";
						const filterGroup = normalizeInspectionFilterGroup(
							raw.filterGroup ?? raw.grupaFiltrow,
						);
						const isActive =
							typeof raw.isActive === "boolean"
								? raw.isActive
								: typeof raw.aktywny === "boolean"
									? raw.aktywny
									: true;

						if (!Number.isFinite(id) || id <= 0 || !name) {
							return null;
						}

						return {
							id,
							code,
							name,
							filterGroup,
							isActive,
						} as BackendInspectionTeamOption;
					})
					.filter(
						(option): option is BackendInspectionTeamOption => option !== null,
					);
			};

			let users: InspectionPeopleOption[] = [];
			let backendInspectionTeamOptions: BackendInspectionTeamOption[] = [];
			const [usersResponse, inspectionTeamsResponse] = await Promise.all([
				fetch("/api/inspections/people-options", {
					method: "GET",
					headers: {
						"Content-Type": "application/json",
						"X-Operator-Login": operatorLogin,
					},
					cache: "no-store",
				}),
				fetch("/api/inspections/team-options", {
					method: "GET",
					headers: {
						"Content-Type": "application/json",
						"X-Operator-Login": operatorLogin,
					},
					cache: "no-store",
				}),
			]);

			if (usersResponse.ok) {
				const payload = (await usersResponse.json()) as unknown;
				users = Array.isArray(payload)
					? payload
							.map((item) => {
								const raw = (item ?? {}) as {
									id?: unknown;
									login?: unknown;
									displayName?: unknown;
									active?: unknown;
									listVisibility?: unknown;
									widocznoscNaLiscie?: unknown;
									visibleOnList?: unknown;
									canBeLeader?: unknown;
									createdByOperator?: unknown;
									addedByOperator?: unknown;
									createdByLogin?: unknown;
									addedByLogin?: unknown;
									operatorLogin?: unknown;
									createdBy?: unknown;
									createdByUserLogin?: unknown;
									creatorLogin?: unknown;
									createdByOperatorLogin?: unknown;
									addedBy?: unknown;
									teamId?: unknown;
									zespolId?: unknown;
									teamName?: unknown;
									filterGroup?: unknown;
									grupaFiltrow?: unknown;
									includeInFilters?: unknown;
								};

								const id = parsePositiveNumericId(raw.id) ?? 0;
								const login =
									typeof raw.login === "string" ? raw.login.trim() : "";
								if (!id || !login) {
									return null;
								}

								const displayName = resolvePeopleOptionDisplayName(
									raw as Record<string, unknown>,
									login,
								);
								const active = raw.active !== false;
								const listVisibilityRaw =
									typeof raw.listVisibility === "string"
										? raw.listVisibility.trim().toLowerCase()
										: typeof raw.widocznoscNaLiscie === "string"
											? raw.widocznoscNaLiscie.trim().toLowerCase()
											: null;
								const isVisibleOnList =
									typeof raw.visibleOnList === "boolean"
										? raw.visibleOnList
										: typeof raw.visibleOnList === "string"
											? raw.visibleOnList.trim().toLowerCase() === "true"
											: typeof raw.visibleOnList === "number"
												? raw.visibleOnList === 1
										: listVisibilityRaw === "hidden" ||
											  listVisibilityRaw === "ukryty"
											? false
											: listVisibilityRaw === "visible" ||
											    listVisibilityRaw === "widoczny"
										  ? true
										  : active;
								const numericTeamId = Number(raw.teamId ?? raw.zespolId);
								const teamId =
									Number.isFinite(numericTeamId) && numericTeamId > 0
										? numericTeamId
										: null;
								const teamName =
									typeof raw.teamName === "string" ? raw.teamName : null;
								const createdByObjectLogin =
									raw.createdBy && typeof raw.createdBy === "object"
										? ((raw.createdBy as { login?: unknown }).login ?? "")
										: "";
								const addedByObjectLogin =
									raw.addedBy && typeof raw.addedBy === "object"
										? ((raw.addedBy as { login?: unknown }).login ?? "")
										: "";
								const creatorLoginRaw =
									typeof raw.createdByLogin === "string"
										? raw.createdByLogin
										: typeof raw.addedByLogin === "string"
											? raw.addedByLogin
											: typeof raw.createdByUserLogin === "string"
												? raw.createdByUserLogin
												: typeof raw.creatorLogin === "string"
													? raw.creatorLogin
													: typeof raw.createdByOperatorLogin === "string"
														? raw.createdByOperatorLogin
														: typeof raw.operatorLogin === "string"
															? raw.operatorLogin
															: typeof raw.createdBy === "string"
																? raw.createdBy
																: typeof createdByObjectLogin === "string"
																	? createdByObjectLogin
																	: typeof addedByObjectLogin === "string"
																		? addedByObjectLogin
																		: "";
								const normalizedCreatorLogin = creatorLoginRaw
									.trim()
									.toLowerCase();
								const normalizeBooleanLike = (value: unknown) => {
									if (typeof value === "boolean") {
										return value;
									}

									if (typeof value === "number") {
										return value === 1;
									}

									if (typeof value === "string") {
										const normalized = value.trim().toLowerCase();
										return (
											normalized === "true" ||
											normalized === "1" ||
											normalized === "tak"
										);
									}

									return false;
								};
								const createdByOperator =
									normalizeBooleanLike(raw.createdByOperator) ||
									normalizeBooleanLike(raw.addedByOperator) ||
									(Boolean(normalizedCreatorLogin) &&
										normalizedCreatorLogin === normalizedOperatorLogin);
								const filterGroup = normalizeInspectionFilterGroup(
									raw.filterGroup ?? raw.grupaFiltrow,
								);
								const includeInFiltersRaw = raw.includeInFilters;
								const includeInFilters =
									typeof includeInFiltersRaw === "boolean"
										? includeInFiltersRaw
										: typeof includeInFiltersRaw === "number"
											? includeInFiltersRaw === 1
											: typeof includeInFiltersRaw === "string"
												? ["true", "1", "tak"].includes(
														includeInFiltersRaw.trim().toLowerCase(),
												  )
												: true;

								return {
									id,
									login,
									displayName,
									active,
									visibleOnList: isVisibleOnList,
									canBeLeader:
										typeof raw.canBeLeader === "boolean"
											? raw.canBeLeader
											: typeof raw.canBeLeader === "string"
											? ["true", "1", "tak"].includes(
													raw.canBeLeader.trim().toLowerCase(),
												)
											: typeof raw.canBeLeader === "number"
												? raw.canBeLeader === 1
											: false,
									createdByOperator,
									teamId,
									teamName,
									filterGroup,
									includeInFilters,
								};
							})
							.filter((user): user is InspectionPeopleOption => user !== null)
					: [];
			}

			if (inspectionTeamsResponse.ok) {
				const payload = (await inspectionTeamsResponse.json()) as unknown;
				backendInspectionTeamOptions = parseInspectionTeamOptionsPayload(payload);
			}

			const activeUsers = users.filter(
				(user) => user.visibleOnList && user.includeInFilters,
			);
			setAllUsers(users);
			setActiveUsers(activeUsers);

			const operatorUser = users.find(
				(user) => user.login.trim().toLowerCase() === normalizedOperatorLogin,
			);
			setOperatorDisplayName(
				operatorUser ? getUserDisplayName(operatorUser) : operatorLogin.trim(),
			);
			setOperatorUserId(operatorUser?.id ?? null);
			setOperatorTeamId(operatorUser?.teamId ?? null);

			setEntityNameOptions(resolveSelectOptions(entityNamesResult));
			setInspectionTypeOptions(resolveOptions(inspectionTypesResult));
			const inspectionTypeValueMaps =
				resolveDictionaryValueMaps(inspectionTypesResult);
			setInspectionTypeIdByValue(inspectionTypeValueMaps.idByValue);
			setInspectionTypeCodeByValue(inspectionTypeValueMaps.codeByValue);
			setInspectionTypeValueById(inspectionTypeValueMaps.valueById);
			setInspectionTypeValueByCode(inspectionTypeValueMaps.valueByCode);
			const inspectionScopeSelectOptions = resolveSelectOptions(
				inspectionScopesResult,
			);
			const inspectionScopeMapByValue: Record<string, string> = {};
			const inspectionScopeIdByValue: Record<string, number> = {};
			const inspectionScopeValueById: Record<number, string> = {};
			if (inspectionScopesResult.ok) {
				for (const entry of inspectionScopesResult.data) {
					const scopeValue = entry.nazwaPozycji.trim();
					const userLabel = (entry.nazwaUzytkowa ?? "").trim();
					const scopeId =
						typeof entry.id === "number" && Number.isFinite(entry.id)
							? entry.id
							: null;

					if (!scopeValue) {
						continue;
					}

					if (scopeId && !inspectionScopeIdByValue[scopeValue]) {
						inspectionScopeIdByValue[scopeValue] = scopeId;
					}

					if (scopeId && !inspectionScopeValueById[scopeId]) {
						inspectionScopeValueById[scopeId] = scopeValue;
					}

					if (!userLabel || inspectionScopeMapByValue[scopeValue]) {
						continue;
					}

					inspectionScopeMapByValue[scopeValue] = userLabel;
				}
			}
			setInspectionScopeMapByValue(inspectionScopeMapByValue);
			setInspectionScopeIdByValue(inspectionScopeIdByValue);
			setInspectionScopeValueById(inspectionScopeValueById);
			setInspectionScopeOptions(
				normalizeInspectionScopeValues(
					inspectionScopeSelectOptions.map((option) => option.value),
				).map((value) => {
					return { value, label: value };
				}),
			);
			const nextMarketShortLabelByValue: Record<string, string> = {};
			if (marketsResult.ok) {
				for (const entry of marketsResult.data) {
					const value = entry.nazwaPozycji.trim();
					const shortLabel = (entry.skrotPozycji ?? "").trim();

					if (!value || !shortLabel || nextMarketShortLabelByValue[value]) {
						continue;
					}

					nextMarketShortLabelByValue[value] = shortLabel;
				}
			}
			setMarketShortLabelByValue(nextMarketShortLabelByValue);
			const nextTeamShortLabelByTeamId: Record<number, string> = {};
			const nextTeamShortLabelByTeamName: Record<string, string> = {};
			const nextInspectionTeamOptions = new Map<
				number,
				{ label: string; filterGroup: InspectionFilterGroup | null }
			>();
			const nextTeamFilterGroupByTeamId: Record<number, InspectionFilterGroup> = {};
			for (const teamOption of backendInspectionTeamOptions) {
				if (!teamOption.isActive) {
					continue;
				}

				nextInspectionTeamOptions.set(teamOption.id, {
					label: teamOption.name,
					filterGroup: teamOption.filterGroup,
				});
				if (teamOption.filterGroup) {
					nextTeamFilterGroupByTeamId[teamOption.id] = teamOption.filterGroup;
				}

				if (teamOption.code) {
					nextTeamShortLabelByTeamId[teamOption.id] = teamOption.code;
					const normalizedTeamName = normalizeTeamNameKey(teamOption.name);
					if (normalizedTeamName) {
						nextTeamShortLabelByTeamName[normalizedTeamName] = teamOption.code;
					}
				}
			}

			// Keep selectable team IDs aligned with backend /team-options contract.
			if (teamsResult.ok) {
				for (const entry of teamsResult.data) {
					const shortLabel =
						(entry.skrotPozycji ?? entry.kodPozycji ?? "").trim();
					if (!shortLabel) {
						continue;
					}

					const teamId = Number(entry.teamId ?? NaN);
					if (
						Number.isFinite(teamId) &&
						teamId > 0 &&
						typeof nextTeamShortLabelByTeamId[teamId] !== "string"
					) {
						nextTeamShortLabelByTeamId[teamId] = shortLabel;
					}

					const normalizedTeamName = normalizeTeamNameKey(entry.nazwaPozycji);
					if (
						normalizedTeamName &&
						typeof nextTeamShortLabelByTeamName[normalizedTeamName] !== "string"
					) {
						nextTeamShortLabelByTeamName[normalizedTeamName] = shortLabel;
					}
				}
			}
			setTeamShortLabelByTeamId(nextTeamShortLabelByTeamId);
			setTeamShortLabelByTeamName(nextTeamShortLabelByTeamName);
			setTeamFilterGroupByTeamId(nextTeamFilterGroupByTeamId);
			setInspectionTeamOptions(
				Array.from(nextInspectionTeamOptions.entries())
					.map(([id, option]) => ({
						id,
						label: option.label,
						filterGroup: option.filterGroup,
					}))
					.sort((left, right) =>
						left.label.localeCompare(right.label, "pl", {
							sensitivity: "base",
						}),
					),
			);
			setMarketOptions(resolveOptions(marketsResult));
			const marketValueMaps = resolveDictionaryValueMaps(marketsResult);
			setMarketIdByValue(marketValueMaps.idByValue);
			setMarketCodeByValue(marketValueMaps.codeByValue);
			setMarketValueById(marketValueMaps.valueById);
			setMarketValueByCode(marketValueMaps.valueByCode);
			setEntityTypeOptions(resolveOptions(entityTypesResult));
			const entityTypeValueMaps = resolveDictionaryValueMaps(entityTypesResult);
			setEntityTypeIdByValue(entityTypeValueMaps.idByValue);
			setEntityTypeCodeByValue(entityTypeValueMaps.codeByValue);
			setEntityTypeValueById(entityTypeValueMaps.valueById);
			setEntityTypeValueByCode(entityTypeValueMaps.valueByCode);
			if (inspectionStatusesResult.ok) {
				const statusOptions: DictionarySelectOption[] = [];
				const seenStatusValues = new Set<string>();
				for (const entry of inspectionStatusesResult.data) {
					if (!entry.aktywny) {
						continue;
					}

					const value = entry.nazwaPozycji.trim();
					if (!value || seenStatusValues.has(value)) {
						continue;
					}

					seenStatusValues.add(value);
					statusOptions.push({ value, label: value });
				}
				setInspectionStatusOptions(statusOptions);
			} else {
				setInspectionStatusOptions([]);
			}
			const inspectionStatusValueMaps =
				resolveDictionaryValueMaps(inspectionStatusesResult);
			setInspectionStatusIdByValue(inspectionStatusValueMaps.idByValue);
			setInspectionStatusCodeByValue(inspectionStatusValueMaps.codeByValue);
			setInspectionStatusValueById(inspectionStatusValueMaps.valueById);
			setInspectionStatusValueByCode(inspectionStatusValueMaps.valueByCode);

			const nextStatusStyleByCode: Record<
				string,
				{ kolor: string | null; odcien: number | null; intensywnosc: number | null }
			> = {};
			if (inspectionStatusesResult.ok) {
				const addStatusStyleMapping = (
					rawKey: string | null | undefined,
					style: { kolor: string | null; odcien: number | null; intensywnosc: number | null },
				) => {
					const key = String(rawKey ?? "").trim().toUpperCase();
					if (!key) {
						return;
					}

					nextStatusStyleByCode[key] = style;
				};

				for (const entry of inspectionStatusesResult.data) {
					const style = {
						kolor: entry.kolor ?? null,
						odcien: entry.odcien ?? null,
						intensywnosc: entry.intensywnosc ?? null,
					};

					addStatusStyleMapping(entry.kodPozycji, style);
					addStatusStyleMapping(entry.skrotPozycji, style);
					addStatusStyleMapping(entry.nazwaPozycji, style);
				}
			}
			setInspectionStatusStyleByCode(nextStatusStyleByCode);
		} catch {
			setEntityNameOptions([]);
			setInspectionTypeOptions([]);
			setInspectionTypeIdByValue({});
			setInspectionTypeCodeByValue({});
			setInspectionTypeValueById({});
			setInspectionTypeValueByCode({});
			setInspectionScopeOptions([]);
			setInspectionScopeMapByValue({});
			setInspectionScopeIdByValue({});
			setInspectionScopeValueById({});
			setMarketShortLabelByValue({});
			setMarketIdByValue({});
			setMarketCodeByValue({});
			setMarketValueById({});
			setMarketValueByCode({});
			setTeamShortLabelByTeamId({});
			setTeamShortLabelByTeamName({});
			setTeamFilterGroupByTeamId({});
			setInspectionTeamOptions([]);
			setMarketOptions([]);
			setEntityTypeOptions([]);
			setEntityTypeIdByValue({});
			setEntityTypeCodeByValue({});
			setEntityTypeValueById({});
			setEntityTypeValueByCode({});
			setInspectionStatusOptions([]);
			setInspectionStatusIdByValue({});
			setInspectionStatusCodeByValue({});
			setInspectionStatusValueById({});
			setInspectionStatusValueByCode({});
			setInspectionStatusStyleByCode({});
			setAllUsers([]);
			setActiveUsers([]);
			setOperatorUserId(null);
			setOperatorTeamId(null);
			setSelectedLeaderUserId(null);
			setOperatorDisplayName(operatorLogin.trim());
		}
	}, [operatorLogin]);

	useEffect(() => {
		void loadInspectionDictionaries();
	}, [loadInspectionDictionaries]);

	useEffect(() => {
		const handleDictionariesChanged = (event: Event) => {
			const customEvent = event as CustomEvent<{ kodTypu?: string }>;
			const changedKodTypu =
				typeof customEvent.detail?.kodTypu === "string"
					? customEvent.detail.kodTypu.trim().toLowerCase()
					: "";

			if (!changedKodTypu || changedKodTypu === "statusy_inspekcji") {
				void loadInspectionDictionaries();
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
	}, [loadInspectionDictionaries]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		const raw = window.localStorage.getItem(columnWidthsStorageKey);
		if (!raw) {
			setColumnWidths(DEFAULT_INSPECTIONS_COLUMN_WIDTHS);
			setAreColumnWidthsHydrated(true);
			return;
		}

		try {
			const parsed = JSON.parse(raw) as Record<string, unknown>;
			const next: Partial<Record<InspectionColumnKey, number>> = {};
			for (const [key, value] of Object.entries(parsed)) {
				const width = Number(value);
				if (!Number.isFinite(width)) {
					continue;
				}

				const columnKey = key as InspectionColumnKey;
				const normalizedWidth = Math.max(
					INSPECTIONS_MIN_COLUMN_WIDTH,
					Math.min(1200, Math.round(width)),
				);
				next[columnKey] = normalizedWidth;
			}

			setColumnWidths({
				...DEFAULT_INSPECTIONS_COLUMN_WIDTHS,
				...next,
			});
		} catch {
			setColumnWidths(DEFAULT_INSPECTIONS_COLUMN_WIDTHS);
		}

		setAreColumnWidthsHydrated(true);
	}, [columnWidthsStorageKey]);

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
			const parsed = JSON.parse(raw) as Partial<Record<InspectionColumnKey, unknown>>;
			const next: InspectionNameVariantByColumn = {
				...DEFAULT_INSPECTION_NAME_VARIANTS,
			};

			for (const columnKey of INSPECTION_NAME_VARIANT_COLUMN_KEYS) {
				const value = parsed[columnKey];
				if (
					isInspectionNameVariant(value) &&
					isInspectionNameVariantAllowedForColumn(columnKey, value)
				) {
					next[columnKey] = value;
				}
			}

			setInspectionNameVariants(next);
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
			JSON.stringify(inspectionNameVariants),
		);
	}, [areNameVariantsHydrated, inspectionNameVariants, nameVariantsStorageKey]);

	const hasCustomColumnWidths = useMemo(() => {
		const keys = new Set<string>([
			...Object.keys(DEFAULT_INSPECTIONS_COLUMN_WIDTHS),
			...Object.keys(columnWidths),
		]);

		for (const key of keys) {
			const columnKey = key as InspectionColumnKey;
			const currentWidth = columnWidths[columnKey];
			const defaultWidth = DEFAULT_INSPECTIONS_COLUMN_WIDTHS[columnKey];

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
		if (typeof window === "undefined") {
			return;
		}

		if (!areColumnWidthsHydrated) {
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

	const handleResizeColumn = useCallback(
		(columnKey: InspectionColumnKey, width: number) => {
			setColumnWidths((prev) => ({
				...prev,
				[columnKey]: Math.max(
					INSPECTIONS_MIN_COLUMN_WIDTH,
					Math.min(1200, Math.round(width)),
				),
			}));
		},
		[],
	);

	const handleResetColumnWidths = useCallback(() => {
		setColumnWidths(DEFAULT_INSPECTIONS_COLUMN_WIDTHS);
		if (typeof window !== "undefined") {
			window.localStorage.removeItem(columnWidthsStorageKey);
		}
	}, [columnWidthsStorageKey]);

	const loadInspectionPeopleOptionsForEdit = useCallback(
		async (inspectionId: string) => {
			try {
				const query = new URLSearchParams();
				const normalizedInspectionId = inspectionId.trim();
				if (normalizedInspectionId) {
					query.set("inspectionId", normalizedInspectionId);
				}
				const querySuffix = query.toString() ? `?${query.toString()}` : "";

				const response = await fetch(
					`/api/inspections/people-options${querySuffix}`,
					{
						method: "GET",
						headers: {
							"Content-Type": "application/json",
							"X-Operator-Login": operatorLogin,
						},
						cache: "no-store",
					},
				);

				if (!response.ok) {
					return;
				}

				const payload = (await response.json()) as unknown;
				const normalizedOperatorLogin = operatorLogin.trim().toLowerCase();
				const users = Array.isArray(payload)
					? payload
							.map((item) => {
								const raw = (item ?? {}) as {
									id?: unknown;
									login?: unknown;
									displayName?: unknown;
									active?: unknown;
									visibleOnList?: unknown;
									listVisibility?: unknown;
									widocznoscNaLiscie?: unknown;
									canBeLeader?: unknown;
									teamId?: unknown;
									zespolId?: unknown;
									teamName?: unknown;
									createdByOperator?: unknown;
									addedByOperator?: unknown;
									createdByLogin?: unknown;
									addedByLogin?: unknown;
									createdByOperatorLogin?: unknown;
									creatorLogin?: unknown;
									operatorLogin?: unknown;
									filterGroup?: unknown;
									grupaFiltrow?: unknown;
									includeInFilters?: unknown;
								};

								const id = parsePositiveNumericId(raw.id) ?? 0;
								const login =
									typeof raw.login === "string" ? raw.login.trim() : "";
								if (!id || !login) {
									return null;
								}

								const normalizeBooleanLike = (value: unknown) => {
									if (typeof value === "boolean") {
										return value;
									}
									if (typeof value === "number") {
										return value === 1;
									}
									if (typeof value === "string") {
										const normalized = value.trim().toLowerCase();
										return (
											normalized === "true" ||
											normalized === "1" ||
											normalized === "tak"
										);
									}
									return false;
								};

								const creatorLoginRaw =
									typeof raw.createdByLogin === "string"
										? raw.createdByLogin
										: typeof raw.addedByLogin === "string"
											? raw.addedByLogin
											: typeof raw.createdByOperatorLogin === "string"
												? raw.createdByOperatorLogin
												: typeof raw.creatorLogin === "string"
													? raw.creatorLogin
													: typeof raw.operatorLogin === "string"
														? raw.operatorLogin
														: "";

								const listVisibilityRaw =
									typeof raw.listVisibility === "string"
										? raw.listVisibility.trim().toLowerCase()
										: typeof raw.widocznoscNaLiscie === "string"
											? raw.widocznoscNaLiscie.trim().toLowerCase()
											: "";
								const active = raw.active !== false;
								const visibleOnList =
									typeof raw.visibleOnList === "boolean"
										? raw.visibleOnList
										: listVisibilityRaw === "hidden" || listVisibilityRaw === "ukryty"
											? false
											: active;

								const numericTeamId = Number(raw.teamId ?? raw.zespolId);
								const filterGroup = normalizeInspectionFilterGroup(
									raw.filterGroup ?? raw.grupaFiltrow,
								);
								const includeInFiltersRaw = raw.includeInFilters;
								const includeInFilters =
									typeof includeInFiltersRaw === "boolean"
										? includeInFiltersRaw
										: typeof includeInFiltersRaw === "number"
											? includeInFiltersRaw === 1
											: typeof includeInFiltersRaw === "string"
												? ["true", "1", "tak"].includes(
														includeInFiltersRaw.trim().toLowerCase(),
												  )
												: true;

								return {
									id,
									login,
									displayName: resolvePeopleOptionDisplayName(
										raw as Record<string, unknown>,
										login,
									),
									active,
									visibleOnList,
									canBeLeader: normalizeBooleanLike(raw.canBeLeader),
									createdByOperator:
										normalizeBooleanLike(raw.createdByOperator) ||
										normalizeBooleanLike(raw.addedByOperator) ||
										(Boolean(creatorLoginRaw) &&
											creatorLoginRaw.trim().toLowerCase() === normalizedOperatorLogin),
									teamId:
										Number.isFinite(numericTeamId) && numericTeamId > 0
											? numericTeamId
											: null,
									teamName:
										typeof raw.teamName === "string" ? raw.teamName : null,
									filterGroup,
									includeInFilters,
								};
							})
							.filter((user): user is InspectionPeopleOption => user !== null)
					: [];

				const scopedTeamMemberIds =
					inspectionTeamMemberIdsByRowId[inspectionId] ?? [];
				const scopedLeaderUserId =
					inspectionLeaderUserIdByRowId[inspectionId] ?? null;
				const preservedUserIds = new Set<number>(scopedTeamMemberIds);
				if (
					typeof scopedLeaderUserId === "number" &&
					Number.isFinite(scopedLeaderUserId) &&
					scopedLeaderUserId > 0
				) {
					preservedUserIds.add(scopedLeaderUserId);
				}

				if (preservedUserIds.size > 0) {
					const incomingUsersById = new Map(users.map((user) => [user.id, user]));
					const previousUsersById = new Map(allUsers.map((user) => [user.id, user]));
					const fallbackTeamId =
						inspectionTeamIdsByRowId[inspectionId]?.[0] ?? null;
					const fallbackTeamName =
						typeof fallbackTeamId === "number"
							? (inspectionTeamOptions.find((team) => team.id === fallbackTeamId)
								?.label ?? `Zespół ${fallbackTeamId}`)
							: null;
					const fallbackFilterGroup =
						typeof fallbackTeamId === "number"
							? (teamFilterGroupByTeamId[fallbackTeamId] ?? null)
							: null;
					const fallbackLeaderLabel =
						inspectionRows
							.find((row) => row.id === inspectionId)
							?.osobaKierujaca.trim() ?? "";

					for (const userId of preservedUserIds) {
						if (incomingUsersById.has(userId)) {
							continue;
						}

						const previousUser = previousUsersById.get(userId);
						if (previousUser) {
							users.push(previousUser);
							incomingUsersById.set(userId, previousUser);
							continue;
						}

						if (scopedLeaderUserId === userId && fallbackLeaderLabel) {
							const fallbackUser: InspectionPeopleOption = {
								id: userId,
								login: `hidden-user-${userId}`,
								displayName: fallbackLeaderLabel,
								active: false,
								visibleOnList: false,
								canBeLeader: true,
								createdByOperator: false,
								teamId: fallbackTeamId,
								teamName: fallbackTeamName,
								filterGroup: fallbackFilterGroup,
								includeInFilters: false,
							};
							users.push(fallbackUser);
							incomingUsersById.set(userId, fallbackUser);
						}
					}
				}

				const visibleUsers = users.filter(
					(user) => user.visibleOnList && user.includeInFilters,
				);
				setAllUsers(users);
				setActiveUsers(visibleUsers);
				const operatorUser = users.find(
					(user) => user.login.trim().toLowerCase() === normalizedOperatorLogin,
				);
				setOperatorDisplayName(
					operatorUser ? getUserDisplayName(operatorUser) : operatorLogin.trim(),
				);
				setOperatorUserId(operatorUser?.id ?? null);
				setOperatorTeamId(operatorUser?.teamId ?? null);
			} catch {
				// Keep existing people options when scoped refresh fails.
			}
		},
		[
			allUsers,
			inspectionLeaderUserIdByRowId,
			inspectionRows,
			inspectionTeamIdsByRowId,
			inspectionTeamOptions,
			inspectionTeamMemberIdsByRowId,
			operatorLogin,
			teamFilterGroupByTeamId,
		],
	);

	const inspectionTeamLabelById = useMemo(() => {
		return Object.fromEntries(
			inspectionTeamOptions.map((option) => [option.id, option.label]),
		) as Record<number, string>;
	}, [inspectionTeamOptions]);

	const inspectionTeamDisplayLabelById = useMemo(() => {
		const map: Record<number, string> = {};
		for (const option of inspectionTeamOptions) {
			map[option.id] =
				teamShortLabelByTeamId[option.id] || inspectionTeamLabelById[option.id] || "";
		}

		return map;
	}, [inspectionTeamLabelById, inspectionTeamOptions, teamShortLabelByTeamId]);

	const inspectionRowsForDisplay = useMemo(
		() => {
			const resolveScopeValuesFromIds = (rowId: string) =>
				(inspectionScopeIdsByRowId[rowId] ?? [])
					.map((scopeId) => inspectionScopeValueById[scopeId] ?? "")
					.map((value) => value.trim())
					.filter(Boolean);

			const resolveMappableScopeValues = (rowId: string) =>
				(inspectionScopeValuesByRowId[rowId] ?? [])
					.map((value) => value.trim())
					.filter(
						(value) =>
							Boolean(value) &&
							typeof inspectionScopeIdByValue[value] === "number",
					);

			const inspectionScopeMap = new Map<string, string>();
			for (const [scopeValue, userLabel] of Object.entries(
				inspectionScopeMapByValue,
			)) {
				const normalizedScopeValue = scopeValue.trim().toLowerCase();
				const normalizedUserLabel = userLabel.trim();
				if (!normalizedScopeValue || !normalizedUserLabel) {
					continue;
				}

				inspectionScopeMap.set(normalizedScopeValue, normalizedUserLabel);
			}

			return inspectionRows.map((row) => {
				const inspectionTeamIds = inspectionTeamIdsByRowId[row.id] ?? [];
				const inspectionTeamLabels = Array.from(
					new Set(
						inspectionTeamIds.map(
							(teamId) =>
								inspectionTeamDisplayLabelById[teamId] ||
								inspectionTeamLabelById[teamId] ||
								`ID: ${teamId}`,
						),
					),
				);
				const rowWithInspectionTeams = {
					...row,
					zespoly: inspectionTeamLabels.join(", "),
				};

				const shortValues = inspectionShortValuesByRowId[row.id];
				if (!shortValues) {
					if (inspectionNameVariants.rynek !== "short") {
						return rowWithInspectionTeams;
					}

					const marketShortLabel = marketShortLabelByValue[rowWithInspectionTeams.rynek] ?? "";
					if (!marketShortLabel) {
						return rowWithInspectionTeams;
					}

					return {
						...rowWithInspectionTeams,
						rynek: marketShortLabel,
					};
				}

				const getDisplayValue = (columnKey: InspectionNameVariantColumnKey) => {
					const shortValue = shortValues[columnKey]?.trim() ?? "";

					if (columnKey === "rynek") {
						if (inspectionNameVariants.rynek === "short") {
							const marketShortLabel = marketShortLabelByValue[rowWithInspectionTeams.rynek] ?? "";
							if (marketShortLabel) {
								return marketShortLabel;
							}
						}

						return rowWithInspectionTeams.rynek;
					}

					if (columnKey === "zakresInspekcji") {
						if (inspectionNameVariants.zakresInspekcji === "short" && shortValue) {
							return shortValue;
						}

						if (inspectionNameVariants.zakresInspekcji === "user") {
							const scopesFromIds = resolveScopeValuesFromIds(row.id);
							const scopes =
								scopesFromIds.length > 0
									? Array.from(new Set(scopesFromIds))
									: inspectionScopeValuesByRowId[row.id]?.length
										? Array.from(new Set(resolveMappableScopeValues(row.id)))
										: [];
							if (scopes.length === 0) {
								return "";
							}

							const mappedScopes = scopes.map((scope) => {
								const mapped = inspectionScopeMap.get(scope.trim().toLowerCase());
								return mapped ?? "";
							});

							return joinMultiValueField(mappedScopes);
						}
					}

					return inspectionNameVariants[columnKey] === "short" && shortValue
						? shortValue
						: rowWithInspectionTeams[columnKey];
				};

				return {
					...rowWithInspectionTeams,
					nazwaPodmiotu: getDisplayValue("nazwaPodmiotu"),
					typInspekcji: getDisplayValue("typInspekcji"),
					zakresInspekcji: getDisplayValue("zakresInspekcji"),
					rynek: getDisplayValue("rynek"),
					rodzajPodmiotu: getDisplayValue("rodzajPodmiotu"),
					status: getDisplayValue("status"),
				};
			});
		},
		[
			inspectionNameVariants,
			inspectionTeamIdsByRowId,
			inspectionTeamDisplayLabelById,
			inspectionTeamLabelById,
			inspectionRows,
			inspectionScopeIdsByRowId,
			marketShortLabelByValue,
			inspectionScopeMapByValue,
			inspectionScopeValueById,
			inspectionScopeValuesByRowId,
			inspectionShortValuesByRowId,
		],
	);

	const advancedFilterTokensByColumnByRowId = useMemo(() => {
		const scopeTokensByRowId: Record<string, string[]> = {};
		const teamTokensByRowId: Record<string, string[]> = {};
		const inspectionTeamsTokensByRowId: Record<string, string[]> = {};

		const userDisplayNameById = new Map<number, string>();
		for (const user of allUsers) {
			userDisplayNameById.set(user.id, getUserDisplayName(user));
		}

		for (const row of inspectionRowsForDisplay) {
			const scopeTokensFromIds = (inspectionScopeIdsByRowId[row.id] ?? [])
				.map((scopeId) => inspectionScopeValueById[scopeId] ?? "")
				.map((value) => value.trim())
				.filter(Boolean);
			const scopeTokens =
				scopeTokensFromIds.length > 0
					? Array.from(new Set(scopeTokensFromIds))
					: inspectionScopeValuesByRowId[row.id]?.length
						? Array.from(
								new Set(
									(inspectionScopeValuesByRowId[row.id] ?? [])
										.map((value) => value.trim())
										.filter(
											(value) =>
												Boolean(value) &&
												typeof inspectionScopeIdByValue[value] === "number",
										),
								),
							)
						: [];
			scopeTokensByRowId[row.id] = scopeTokens;

			const teamMemberIds = inspectionTeamMemberIdsByRowId[row.id] ?? [];
			const teamTokensFromIds = teamMemberIds
				.map((userId) => userDisplayNameById.get(userId) ?? "")
				.map((value) => value.trim())
				.filter(Boolean);
			const teamTokensFromRowValue = parseTeamMemberDisplayTokens(
				String(row.skladZespolu ?? ""),
			);
			teamTokensByRowId[row.id] =
				teamTokensFromIds.length > 0 || teamTokensFromRowValue.length > 0
					? Array.from(new Set([...teamTokensFromIds, ...teamTokensFromRowValue]))
					: [];

			const inspectionTeamIds = inspectionTeamIdsByRowId[row.id] ?? [];
			inspectionTeamsTokensByRowId[row.id] =
				inspectionTeamIds.length > 0
					? Array.from(
							new Set(
								inspectionTeamIds.map(
									(teamId) =>
										inspectionTeamDisplayLabelById[teamId] ||
										inspectionTeamLabelById[teamId] ||
										`ID: ${teamId}`,
								),
							),
						)
					: [];
		}

		return {
			zakresInspekcji: scopeTokensByRowId,
			skladZespolu: teamTokensByRowId,
			zespoly: inspectionTeamsTokensByRowId,
		} as const;
	}, [
		allUsers,
		inspectionTeamIdsByRowId,
		inspectionTeamDisplayLabelById,
		inspectionTeamLabelById,
		inspectionRowsForDisplay,
		inspectionScopeIdsByRowId,
		inspectionScopeValueById,
		inspectionScopeValuesByRowId,
		inspectionTeamMemberIdsByRowId,
	]);

	const {
		advancedFilterAnchor,
		advancedFilterColumnKey,
		advancedFilterSearch,
		advancedFilters,
		clearAdvancedFilterForSelectedColumn,
		clearFilters,
		canClearFilters,
		columnFilters,
		draftHiddenColumns,
		draftSelectableColumnDefinitions,
		draftVisibleInspectionColumnsCount,
		draftSelectedInspectionView,
		filteredAndSortedInspectionRows,
		paginatedInspectionRows,
		currentPage,
		totalPages,
		paginationItems,
		resolvePageForRowIndex,
		handlePageChange,
		handlePageSizeChange,
		pageSize,
		handleApplyViewChanges,
		handleDraftColumnVisibilityChange,
		handleDraftDeselectAllColumns,
		handleDraftResetSelection,
		handleDraftSelectAllColumns,
		handleDraftViewSelect,
		handleFilterChange,
		handleOpenViewModal,
		handleSortByColumn,
		isAdvancedFilterModalOpen,
		isColumnPickerOpen,
		openAdvancedFilterForColumn,
		selectedAdvancedFilterDateRange,
		selectedAdvancedFilterValues,
		selectedInspectionView,
		selectAllVisibleAdvancedFilterValues,
		setAdvancedFilterSearch,
		setAdvancedFilterDateRange,
		setDraftHiddenColumns,
		setIsAdvancedFilterModalOpen,
		setIsColumnPickerOpen,
		sortColumnKey,
		sortDirection,
		toggleAdvancedFilterValue,
		toggleAdvancedFilterValueForColumn,
		setAdvancedFilterValuesForColumn,
		visibleAdvancedFilterValues,
		visibleInspectionColumnDefinitions,
	} = useInspectionsTableState({
		inspectionRows: inspectionRowsForDisplay,
		advancedFilterTokensByColumnByRowId,
		tableViewStorageKey,
		tableViewStorageArea: "localStorage",
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

	const scopeDisplayItemsByRowId = useMemo(() => {
		const scopeLabelMap = new Map<string, string>();
		for (const [scopeValue, userLabel] of Object.entries(inspectionScopeMapByValue)) {
			const normalizedScopeValue = scopeValue.trim().toLowerCase();
			const normalizedUserLabel = userLabel.trim();
			if (!normalizedScopeValue || !normalizedUserLabel) {
				continue;
			}

			scopeLabelMap.set(normalizedScopeValue, normalizedUserLabel);
		}

		const map: Record<string, string[]> = {};
		for (const row of paginatedInspectionRows) {
			const valuesFromIds = (inspectionScopeIdsByRowId[row.id] ?? [])
				.map((scopeId) => inspectionScopeValueById[scopeId] ?? "")
				.map((value) => value.trim())
				.filter(Boolean);
			const values =
				valuesFromIds.length > 0
					? Array.from(new Set(valuesFromIds))
					: Array.from(
							new Set(
								(inspectionScopeValuesByRowId[row.id] ?? [])
									.map((value) => value.trim())
									.filter(
										(value) =>
											Boolean(value) &&
											typeof inspectionScopeIdByValue[value] === "number",
									),
							),
						);

			map[row.id] =
				inspectionNameVariants.zakresInspekcji === "user"
					? values
							.map((value) => scopeLabelMap.get(value.toLowerCase()) ?? value)
							.filter(Boolean)
					: values;
		}

		return map;
	}, [
		inspectionNameVariants.zakresInspekcji,
		inspectionScopeIdByValue,
		inspectionScopeIdsByRowId,
		inspectionScopeMapByValue,
		inspectionScopeValueById,
		inspectionScopeValuesByRowId,
		paginatedInspectionRows,
	]);

	const teamDisplayItemsByRowId = useMemo(() => {
		const userDisplayNameById = new Map<number, string>();
		for (const user of allUsers) {
			userDisplayNameById.set(user.id, getUserDisplayName(user));
		}

		const map: Record<string, string[]> = {};
		for (const row of paginatedInspectionRows) {
			const teamMemberIds = inspectionTeamMemberIdsByRowId[row.id] ?? [];
			const teamTokensFromRowValue = parseTeamMemberDisplayTokens(
				String(row.skladZespolu ?? ""),
			);
			map[row.id] = Array.from(
				new Set(
					[
						...teamMemberIds
							.map((userId) => userDisplayNameById.get(userId) ?? "")
							.map((value) => value.trim())
							.filter(Boolean),
						...teamTokensFromRowValue,
					],
				),
			);
		}

		return map;
	}, [allUsers, inspectionTeamMemberIdsByRowId, paginatedInspectionRows]);

	const columnDisplayModeOptionsByKey = useMemo(
		() =>
			Object.fromEntries(
				INSPECTION_NAME_VARIANT_COLUMN_KEYS.map((columnKey) => [
					columnKey,
					[...INSPECTION_NAME_VARIANT_OPTIONS],
				]),
			) as Partial<
				Record<
					InspectionColumnKey,
					Array<{ value: string; label: string }>
				>
			>,
		[],
	);

	const draftColumnDisplayModeValuesByKey = useMemo(
		() =>
			Object.fromEntries(
				INSPECTION_NAME_VARIANT_COLUMN_KEYS.map((columnKey) => [
					columnKey,
					draftInspectionNameVariants[columnKey],
				]),
			) as Partial<Record<InspectionColumnKey, string>>,
		[draftInspectionNameVariants],
	);

	const handleOpenInspectionViewModal = () => {
		setDraftInspectionNameVariants(inspectionNameVariants);
		handleOpenViewModal();
	};

	const handleApplyInspectionViewChanges = () => {
		setInspectionNameVariants(draftInspectionNameVariants);
		handleApplyViewChanges();
	};

	const handleResetInspectionViewSelection = () => {
		handleDraftResetSelection();
		setDraftInspectionNameVariants(DEFAULT_INSPECTION_NAME_VARIANTS);
	};

	useEffect(() => {
		if (!pendingDashboardInspectionCode || isRowsLoading) {
			return;
		}

		const normalizedCode = pendingDashboardInspectionCode.trim().toLowerCase();
		if (!normalizedCode) {
			setPendingDashboardInspectionCode(null);
			return;
		}

		const targetRow = filteredAndSortedInspectionRows.find(
			(row) => row.kodInspekcji.trim().toLowerCase() === normalizedCode,
		);

		if (!targetRow) {
			const targetExistsOutsideFilters = inspectionRowsForDisplay.some(
				(row) => row.kodInspekcji.trim().toLowerCase() === normalizedCode,
			);
			if (targetExistsOutsideFilters && canClearFilters) {
				clearFilters();
			}
			return;
		}

		const rowIndex = filteredAndSortedInspectionRows.findIndex(
			(row) => row.id === targetRow.id,
		);
		if (rowIndex < 0) {
			return;
		}

		const targetPage = resolvePageForRowIndex(rowIndex);
		handlePageChange(targetPage);
		setSelectedInspectionId(targetRow.id);
		setFlashInspectionId(targetRow.id);
		setCenterInspectionId(targetRow.id);
		setPendingDashboardInspectionCode(null);

		if (typeof window !== "undefined") {
			window.sessionStorage.removeItem(DASHBOARD_OPEN_INSPECTION_CODE_KEY);
		}

		window.setTimeout(() => {
			setFlashInspectionId((current) =>
				current === targetRow.id ? null : current,
			);
		}, 2200);
	}, [
		canClearFilters,
		clearFilters,
		filteredAndSortedInspectionRows,
		handlePageChange,
		inspectionRowsForDisplay,
		isRowsLoading,
		pendingDashboardInspectionCode,
		resolvePageForRowIndex,
	]);

	useEffect(() => {
		if (!selectedInspectionId) {
			return;
		}

		const isSelectedVisibleOnPage = paginatedInspectionRows.some(
			(row) => row.id === selectedInspectionId,
		);

		if (!isSelectedVisibleOnPage) {
			setSelectedInspectionId(null);
		}
	}, [paginatedInspectionRows, selectedInspectionId]);

	const selectedTeamMembers = useMemo(() => {
		return selectedTeamMemberIds
			.map((userId) => {
				const user = allUsers.find((item) => item.id === userId);
				return user ? getUserDisplayName(user) : null;
			})
			.filter((name): name is string => Boolean(name));
	}, [allUsers, selectedTeamMemberIds]);

	const teamIdByUserId = useMemo(() => {
		const map: Record<number, number> = {};
		for (const user of allUsers) {
			if (typeof user.teamId === "number" && user.teamId > 0) {
				map[user.id] = user.teamId;
			}
		}

		return map;
	}, [allUsers]);

	const validInspectionTeamIdSet = useMemo(() => {
		return new Set(inspectionTeamOptions.map((option) => option.id));
	}, [inspectionTeamOptions]);

	const deriveInspectionTeamIdsFromMemberIds = useCallback(
		(memberIds: number[]) => {
			return Array.from(
				new Set(
					memberIds
						.map((userId) => teamIdByUserId[userId] ?? NaN)
						.filter(
							(teamId): teamId is number =>
								Number.isFinite(teamId) &&
								teamId > 0 &&
								validInspectionTeamIdSet.has(teamId),
						),
				),
			).sort((left, right) => left - right);
		},
		[teamIdByUserId, validInspectionTeamIdSet],
	);

	useEffect(() => {
		if (isInspectionTeamSelectionManual) {
			return;
		}

		setSelectedInspectionTeamIds(
			deriveInspectionTeamIdsFromMemberIds(selectedTeamMemberIds),
		);
	}, [
		deriveInspectionTeamIdsFromMemberIds,
		isInspectionTeamSelectionManual,
		selectedTeamMemberIds,
	]);

	const inspectionTeamOptionsWithShortLabels = useMemo(() => {
		return inspectionTeamOptions.map((option) => {
			const shortLabel = teamShortLabelByTeamId[option.id];
			return {
				id: option.id,
				label: shortLabel || option.label,
			};
		});
	}, [inspectionTeamOptions, teamShortLabelByTeamId]);

	const quickFilterTeamLabels = useMemo(() => {
		const dictionaryLabels = inspectionTeamOptionsWithShortLabels
			.map((option) => option.label.trim())
			.filter(Boolean);

		if (dictionaryLabels.length > 0) {
			return Array.from(new Set(dictionaryLabels)).sort((left, right) =>
				left.localeCompare(right, "pl", { sensitivity: "base", numeric: true }),
			);
		}

		if (cachedQuickFilterTeamLabels.length > 0) {
			return cachedQuickFilterTeamLabels;
		}

		const rowLabels = inspectionRowsForDisplay
			.flatMap((row) => row.zespoly.split(","))
			.map((value) => value.trim())
			.filter(Boolean);

		return Array.from(new Set(rowLabels)).sort((left, right) =>
			left.localeCompare(right, "pl", { sensitivity: "base", numeric: true }),
		);
	}, [
		cachedQuickFilterTeamLabels,
		inspectionRowsForDisplay,
		inspectionTeamOptionsWithShortLabels,
	]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		if (quickFilterTeamLabels.length === 0) {
			return;
		}

		window.localStorage.setItem(
			quickFilterTeamLabelsStorageKey,
			JSON.stringify(quickFilterTeamLabels),
		);
	}, [quickFilterTeamLabels, quickFilterTeamLabelsStorageKey]);

	const selectedQuickTeamLabels = useMemo(
		() =>
			new Set(
				(advancedFilters.zespoly ?? [])
					.map((value) => value.trim())
					.filter(Boolean),
			),
		[advancedFilters.zespoly],
	);

	const quickFilterExcludedStatusCodePositionSet =
		QUICK_FILTER_EXCLUDED_STATUS_CODE_POSITIONS;

	const quickFilterAllowedStatusLabels = useMemo(() => {
		const labels = inspectionRowsForDisplay
			.filter((row) => {
				const statusCodePosition = normalizeStatusCodePosition(
					inspectionStatusCodePositionByRowId[row.id],
				);
				return !quickFilterExcludedStatusCodePositionSet.has(statusCodePosition);
			})
			.map((row) => row.status.trim())
			.filter(Boolean);

		return Array.from(new Set(labels)).sort((left, right) =>
			left.localeCompare(right, "pl", { sensitivity: "base", numeric: true }),
		);
	}, [
		inspectionRowsForDisplay,
		inspectionStatusCodePositionByRowId,
		quickFilterExcludedStatusCodePositionSet,
	]);

	const selectedQuickStatusLabels = useMemo(
		() =>
			(advancedFilters.status ?? [])
				.map((value) => value.trim())
				.filter(Boolean),
		[advancedFilters.status],
	);

	const isQuickExcludeClosedActive = useMemo(() => {
		if (quickFilterAllowedStatusLabels.length === 0) {
			return false;
		}

		if (selectedQuickStatusLabels.length !== quickFilterAllowedStatusLabels.length) {
			return false;
		}

		const selectedSet = new Set(selectedQuickStatusLabels);
		return quickFilterAllowedStatusLabels.every((label) => selectedSet.has(label));
	}, [quickFilterAllowedStatusLabels, selectedQuickStatusLabels]);

	const handleQuickTeamFilterToggle = useCallback(
		(teamLabel: string) => {
			toggleAdvancedFilterValueForColumn("zespoly", teamLabel);
		},
		[toggleAdvancedFilterValueForColumn],
	);

	const handleQuickExcludeClosedToggle = useCallback(() => {
		if (isQuickExcludeClosedActive) {
			setAdvancedFilterValuesForColumn("status", []);
			return;
		}

		setAdvancedFilterValuesForColumn("status", quickFilterAllowedStatusLabels);
	}, [
		isQuickExcludeClosedActive,
		quickFilterAllowedStatusLabels,
		setAdvancedFilterValuesForColumn,
	]);

	const selectedInspectionTeamLabels = useMemo(() => {
		return selectedInspectionTeamIds.map(
			(teamId) =>
				teamShortLabelByTeamId[teamId] ||
				inspectionTeamLabelById[teamId] ||
				`Zespół ${teamId}`,
		);
	}, [inspectionTeamLabelById, selectedInspectionTeamIds, teamShortLabelByTeamId]);

	const handleInspectionTeamIdsChange = useCallback((nextIds: number[]) => {
		const normalizedIds = Array.from(
			new Set(
				nextIds.filter(
					(teamId): teamId is number =>
						Number.isFinite(teamId) &&
						teamId > 0 &&
						validInspectionTeamIdSet.has(teamId),
				),
			),
		).sort((left, right) => left - right);

		setIsInspectionTeamSelectionManual(true);
		setSelectedInspectionTeamIds(normalizedIds);
	}, [validInspectionTeamIdSet]);

	const teamMemberUsersForModal = useMemo(() => {
		if (!isEditMode || selectedTeamMemberIds.length === 0) {
			return activeUsers;
		}

		const usersById = new Map<number, InspectionPeopleOption>();
		for (const user of activeUsers) {
			usersById.set(user.id, user);
		}

		for (const userId of selectedTeamMemberIds) {
			if (usersById.has(userId)) {
				continue;
			}

			const selectedUser = allUsers.find((user) => user.id === userId);
			if (selectedUser) {
				usersById.set(userId, selectedUser);
			}
		}

		return Array.from(usersById.values());
	}, [activeUsers, allUsers, isEditMode, selectedTeamMemberIds]);

	const activeUsersWithShortTeamLabel = useMemo(
		() =>
			teamMemberUsersForModal.map((user) => {
				const shortById =
					typeof user.teamId === "number"
						? teamShortLabelByTeamId[user.teamId]
						: undefined;
				const normalizedTeamName = normalizeTeamNameKey(user.teamName);
				const shortByName = normalizedTeamName
					? teamShortLabelByTeamName[normalizedTeamName]
					: undefined;

				return {
					...user,
					teamName: shortById || shortByName || user.teamName,
				};
			}),
		[
			teamMemberUsersForModal,
			teamShortLabelByTeamId,
			teamShortLabelByTeamName,
		],
	);

	useEffect(() => {
		if (!teamMemberScopeError && outOfScopeTeamMemberUserId === null) {
			return;
		}

		setTeamMemberScopeError(null);
		setOutOfScopeTeamMemberUserId(null);
	}, [
		selectedTeamMemberIds,
		teamMemberScopeError,
		outOfScopeTeamMemberUserId,
	]);

	const availableLeaderUsers = useMemo(() => {
		const sourceUsers = allUsers.filter((user) => user.canBeLeader);
		const selectedTeamMemberIdSet = new Set(selectedTeamMemberIds);

		const usersById = new Map<number, InspectionPeopleOption>();
		for (const user of allUsers) {
			usersById.set(user.id, user);
		}
		for (const user of activeUsers) {
			if (!usersById.has(user.id)) {
				usersById.set(user.id, user);
			}
		}

		const selectedTeamUsers = Array.from(selectedTeamMemberIdSet)
			.map((userId) => usersById.get(userId) ?? null)
			.filter((user): user is InspectionPeopleOption => user !== null);

		if (selectedTeamUsers.length > 0) {
			return selectedTeamUsers;
		}

		if (!operatorUserId) {
			return sourceUsers;
		}

		if (authRole === "director") {
			return sourceUsers;
		}

		if (authRole === "team_lead") {
			return sourceUsers.filter((user) => {
				if (user.id === operatorUserId) {
					return true;
				}

				if (operatorTeamId !== null && user.teamId === operatorTeamId) {
					return true;
				}

				return user.createdByOperator;
			});
		}

		if (authRole === "inspector") {
			return sourceUsers.filter((user) => user.id === operatorUserId);
		}

		return sourceUsers.filter((user) => user.id === operatorUserId);
	}, [
		activeUsers,
		allUsers,
		authRole,
		isEditMode,
		operatorTeamId,
		operatorUserId,
		selectedTeamMemberIds,
	]);


	const leaderOptionsForModal = useMemo(() => {
		if (!isEditMode || selectedLeaderUserId === null) {
			return availableLeaderUsers;
		}

		if (availableLeaderUsers.some((user) => user.id === selectedLeaderUserId)) {
			return availableLeaderUsers;
		}

		const currentLeader = allUsers.find((user) => user.id === selectedLeaderUserId);
		if (!currentLeader) {
			return availableLeaderUsers;
		}

		return [...availableLeaderUsers, currentLeader];
	}, [
		allUsers,
		availableLeaderUsers,
		isEditMode,
		selectedLeaderUserId,
	]);

	const leaderChangeIrreversibleWarning = useMemo(() => {
		if (authRole !== "team_lead") {
			return null;
		}

		if (!isEditMode || currentEditingInspectionLeaderUserId === null) {
			return null;
		}

		const isCurrentLeaderAvailable = availableLeaderUsers.some(
			(user) => user.id === currentEditingInspectionLeaderUserId,
		);
		if (isCurrentLeaderAvailable) {
			return null;
		}

		return "Osoba kierująca jest spoza Twojego zespołu. Jeśli ją zmienisz i zapiszesz rekord, nie będziesz mógł wybrać jej ponownie.";
	}, [
		authRole,
		availableLeaderUsers,
		currentEditingInspectionLeaderUserId,
		isEditMode,
	]);

	const inspectionStatusOptionsForSelectedType = useMemo(() => {
		let allowedCodes: Set<string> | null = null;
		const selectedMode = resolveInspectionTimelineModeFromTypeValue(
			addInspectionForm.typInspekcji,
		);
		if (selectedMode === "control") {
			allowedCodes = CONTROL_STATUS_CODE_POSITIONS;
		} else if (selectedMode === "visit") {
			allowedCodes = SUPERVISORY_VISIT_STATUS_CODE_POSITIONS;
		}

		if (!allowedCodes) {
			return inspectionStatusOptions;
		}

		const filteredOptions = inspectionStatusOptions.filter((option) => {
			const code = normalizeStatusCodePosition(
				inspectionStatusCodeByValue[option.value],
			);
			return Boolean(code) && allowedCodes.has(code);
		});

		const selectedStatusValue = addInspectionForm.status.trim();
		if (
			selectedStatusValue &&
			!filteredOptions.some((option) => option.value === selectedStatusValue)
		) {
			const selectedOption = inspectionStatusOptions.find(
				(option) => option.value === selectedStatusValue,
			);
			if (selectedOption) {
				filteredOptions.push(selectedOption);
			}
		}

		return filteredOptions.length > 0 ? filteredOptions : inspectionStatusOptions;
	}, [
		addInspectionForm.status,
		addInspectionForm.typInspekcji,
		inspectionStatusCodeByValue,
		inspectionStatusOptions,
	]);

	const getInspectionStatusLabelByCode = useCallback(
		(statusCode: string) => {
			const normalizedCode = normalizeStatusCodePosition(statusCode);
			if (!normalizedCode) {
				return "Nieznany status";
			}

			const direct = inspectionStatusValueByCode[normalizedCode];
			if (direct?.trim()) {
				return direct.trim();
			}

			for (const [rawCode, label] of Object.entries(inspectionStatusValueByCode)) {
				if (
					normalizeStatusCodePosition(rawCode) === normalizedCode &&
					typeof label === "string" &&
					label.trim()
				) {
					return label.trim();
				}
			}

			return normalizedCode;
		},
		[inspectionStatusValueByCode],
	);

	useEffect(() => {
		if (isEditMode) {
			return;
		}

		if (availableLeaderUsers.length === 0) {
			if (selectedLeaderUserId !== null) {
				setSelectedLeaderUserId(null);
			}
			return;
		}

		if (selectedLeaderUserId === null) {
			return;
		}

		const isSelectedLeaderValid =
			availableLeaderUsers.some((user) => user.id === selectedLeaderUserId);

		if (!isSelectedLeaderValid) {
			setSelectedLeaderUserId(null);
		}
	}, [availableLeaderUsers, isEditMode, selectedLeaderUserId]);

	useEffect(() => {
		setAddInspectionForm((prev) => {
			if (!selectedLeaderUserId) {
				if (isEditMode) {
					return prev;
				}

				const fallback = "";
				return prev.osobaKierujaca === fallback
					? prev
					: { ...prev, osobaKierujaca: fallback };
			}

			const selectedLeader =
				availableLeaderUsers.find((user) => user.id === selectedLeaderUserId) ??
				allUsers.find((user) => user.id === selectedLeaderUserId);
			const nextLeaderName = selectedLeader
				? getUserDisplayName(selectedLeader)
				: "";
			return prev.osobaKierujaca === nextLeaderName
				? prev
				: { ...prev, osobaKierujaca: nextLeaderName };
		});
	}, [
		allUsers,
		availableLeaderUsers,
		isEditMode,
		selectedLeaderUserId,
	]);

	useEffect(() => {
		setAddInspectionForm((prev) => ({
			...prev,
			skladZespolu: selectedTeamMembers.join("; "),
		}));
	}, [selectedTeamMembers]);

	useEffect(() => {
		setAddInspectionForm((prev) => ({
			...prev,
			zakresInspekcji: joinMultiValueField(selectedInspectionScopes),
		}));
	}, [selectedInspectionScopes]);

	const handleExportCurrentView = useCallback(
		async (
			recommendationColumnKeys: RecommendationExportColumnKey[],
			sanctionColumnKeys: SanctionExportColumnKey[],
			decisionColumnKeys: DecisionExportColumnKey[],
			includeRecommendations: boolean,
			includeSanctions: boolean,
			includeDecisions: boolean,
		) => {
			if (
				isExporting ||
				filteredAndSortedInspectionRows.length === 0 ||
				visibleInspectionColumnDefinitions.length === 0
			) {
				return;
			}

			setIsExporting(true);
			setAddInspectionError(null);

			try {
				const workbook = await createStyledExportWorkbook("Ewidencja kontroli");

				const loadInspectionCodeMap = async (url: string) => {
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
							return new Map<number, string>();
						}

						const payload = (await response.json()) as
							| Array<{
									id?: unknown;
									lp?: unknown;
									inspectionLp?: unknown;
									inspectionKod?: unknown;
									kodInspekcji?: unknown;
							  }>
							| {
									items?: Array<{
										id?: unknown;
										lp?: unknown;
										inspectionLp?: unknown;
										inspectionKod?: unknown;
										kodInspekcji?: unknown;
									}>;
							  };
						const rawItems = Array.isArray(payload)
							? payload
							: (payload.items ?? []);

						return new Map(
							rawItems
								.map((item) => {
									const id = Number(item.id);
									if (!Number.isFinite(id) || id <= 0) {
										return null;
									}

									const inspectionCode = String(
										item.inspectionKod ??
											item.kodInspekcji ??
											item.inspectionLp ??
											item.lp ??
											"",
									).trim();
									if (!inspectionCode) {
										return null;
									}

									return [id, inspectionCode] as const;
								})
								.filter(
									(entry): entry is readonly [number, string] => entry !== null,
								),
						);
					} catch {
						return new Map<number, string>();
					}
				};

				const exportedInspectionIds = new Set(
					filteredAndSortedInspectionRows
						.map((row) => Number(row.id))
						.filter((id) => Number.isFinite(id) && id > 0),
				);

				const inspectionCodeById = new Map(
					filteredAndSortedInspectionRows
						.map((row) => {
							const numericId = Number(row.id);
							if (!Number.isFinite(numericId) || numericId <= 0) {
								return null;
							}

							return [numericId, row.kodInspekcji] as const;
						})
						.filter(
							(entry): entry is readonly [number, string] => entry !== null,
						),
				);
					const inspectionTeamsById = new Map(
						filteredAndSortedInspectionRows
							.map((row) => {
								const numericId = Number(row.id);
								if (!Number.isFinite(numericId) || numericId <= 0) {
									return null;
								}

								const teamsValue = String(row.zespoly ?? "").trim();
								return [numericId, teamsValue] as const;
							})
							.filter(
								(entry): entry is readonly [number, string] => entry !== null,
							),
					);

				const [
					recommendationsResult,
					sanctionRequestsResult,
					decisionsResult,
					recommendationCodeById,
					sanctionCodeById,
				] = await Promise.all([
					fetchRecommendations(operatorLogin, {
						sortBy: "id",
						sortOrder: "asc",
					}),
					fetchSanctionRequests(operatorLogin, {
						sortBy: "id",
						sortOrder: "asc",
					}),
					fetchObligatingDecisions(operatorLogin),
					loadInspectionCodeMap(RECOMMENDATIONS_AVAILABLE_INSPECTIONS_API_URL),
					loadInspectionCodeMap(SANCTIONS_AVAILABLE_INSPECTIONS_API_URL),
				]);

				const relatedRecommendationsSource = recommendationsResult.ok
					? recommendationsResult.data.items
					: [];
				const relatedSanctionRequestsSource = sanctionRequestsResult.ok
					? sanctionRequestsResult.data.items
					: [];
				const decisionsSource = decisionsResult.ok
					? decisionsResult.data.items
					: [];

				const relatedRecommendations = relatedRecommendationsSource.filter(
					(item) =>
						typeof item.inspectionId === "number" &&
						exportedInspectionIds.has(item.inspectionId),
				);

				const relatedSanctionRequests = relatedSanctionRequestsSource.filter(
					(item) =>
						typeof item.inspectionId === "number" &&
						exportedInspectionIds.has(item.inspectionId),
				);

				const recommendationInspectionIdByCode = new Map<string, number>();
				for (const recommendation of relatedRecommendationsSource) {
					const code = String(recommendation.kodZalecenia ?? "")
						.trim()
						.toUpperCase();
					if (!code) {
						continue;
					}

					if (
						typeof recommendation.inspectionId === "number" &&
						Number.isFinite(recommendation.inspectionId)
					) {
						recommendationInspectionIdByCode.set(
							code,
							recommendation.inspectionId,
						);
					}
				}

				const relatedDecisions = decisionsSource.filter((decision) => {
					const recommendationCode = String(
						decision.recommendationKodZalecenia ?? "",
					)
						.trim()
						.toUpperCase();
					if (!recommendationCode) {
						return false;
					}

					const relatedInspectionId =
						recommendationInspectionIdByCode.get(recommendationCode);
					return (
						typeof relatedInspectionId === "number" &&
						exportedInspectionIds.has(relatedInspectionId)
					);
				});

				const normalizeExportValue = (value: unknown) => {
					const normalized = String(value ?? "").trim();
					if (!normalized) {
						return "";
					}

					return normalized.toLowerCase() === "brak" ? "-" : normalized;
				};

				const isNotApplicableByInspectionType = (
					inspectionType: string,
					columnKey: InspectionColumnKey,
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

				const inspectionHeaders = visibleInspectionColumnDefinitions.map(
					(column) => column.label,
				);
				const inspectionRowsForExport = filteredAndSortedInspectionRows.map(
					(row) => {
						const noLetterFlags = inspectionNoLetterFlagsByRowId[row.id];
						const noAcceptanceDatesFlags = inspectionNoAcceptanceDatesByRowId[row.id];

						return visibleInspectionColumnDefinitions.map((column) => {
							const shouldExportNotApplicable = isNotApplicableByInspectionType(
								String(row.typInspekcji ?? ""),
								column.key,
							);
							const shouldExportNoLetter =
								(column.key === "dataDoreczeniaPisma" &&
									noLetterFlags?.brakDataDoreczeniaPisma) ||
								(column.key === "dataPismaZastrzezenia" &&
									noLetterFlags?.brakDataPismaZastrzezenia) ||
								(column.key === "dataWyslaniaPismaZZastrzezeniami" &&
									noLetterFlags?.brakDataWyslaniaPismaZZastrzezeniami) ||
								(column.key === "dataWplywuPisma" &&
									noLetterFlags?.brakDataWplywuPisma) ||
								(column.key === "dataPismaZOdpowiedzia" &&
									noLetterFlags?.brakDataPismaZOdpowiedzia) ||
								(column.key === "dataWyslaniaPismaZOdpowiedzia" &&
									noLetterFlags?.brakDataWyslaniaPismaZOdpowiedzia);
							const shouldExportNoAcceptanceDates =
								column.key === "dataAkceptacjiNoty" &&
								noAcceptanceDatesFlags?.brakDatAkceptacjiNoty;

							if (shouldExportNotApplicable) {
								return "Nie dotyczy";
							}

							if (shouldExportNoLetter) {
								return "Brak pisma";
							}

							if (shouldExportNoAcceptanceDates) {
								return "Brak pisma";
							}

							return normalizeExportValue(row[column.key]);
						});
					},
				);

				const getRecommendationExportValue = (
					item: (typeof relatedRecommendations)[number],
					key: RecommendationExportColumnKey,
				) => {
					const inspectionId = item.inspectionId ?? null;
					const inspectionCode =
						String(item.inspectionKod ?? "").trim() ||
						String(item.kodInspekcji ?? "").trim() ||
						String(item.inspectionLp ?? "").trim() ||
						(typeof inspectionId === "number"
							? (recommendationCodeById.get(inspectionId) ??
								inspectionCodeById.get(inspectionId) ??
								"")
							: "");

					switch (key) {
						case "lp":
							return String(item.lp);
						case "kodZalecenia":
							return String(item.kodZalecenia ?? "").trim();
						case "inspectionLp":
							return inspectionCode;
						case "zespoly":
							return typeof inspectionId === "number"
								? (inspectionTeamsById.get(inspectionId) ?? "")
								: "";
						case "nazwaPodmiotu":
							return item.nazwaPodmiotu;
						case "pozycja":
							return String(item.pozycja);
						case "dataZalecen":
							return item.dataZalecen ?? "";
						case "terminyWykonaniaZalecenList":
							return item.terminyWykonaniaZalecenList.join(", ");
						case "dataAkceptacjiNotyWeryfikacjiList":
							return item.dataAkceptacjiNotyWeryfikacjiList.join(", ");
						case "status":
							return item.status ?? "";
						case "komentarz":
							return item.komentarz ?? "";
					}
				};

				const recommendationHeaders = recommendationColumnKeys.map(
					(key) =>
						RECOMMENDATION_EXPORT_COLUMNS.find((column) => column.key === key)
							?.label ?? key,
				);
				const recommendationRowsForExport = relatedRecommendations.map((item) =>
					recommendationColumnKeys.map((key) =>
						normalizeExportValue(getRecommendationExportValue(item, key)),
					),
				);

				const getSanctionExportValue = (
					item: (typeof relatedSanctionRequests)[number],
					key: SanctionExportColumnKey,
				) => {
					const inspectionId = item.inspectionId ?? null;
					const inspectionCode =
						String(item.inspectionKod ?? "").trim() ||
						String(item.kodInspekcji ?? "").trim() ||
						String(item.inspectionLp ?? "").trim() ||
						(typeof inspectionId === "number"
							? (sanctionCodeById.get(inspectionId) ??
								inspectionCodeById.get(inspectionId) ??
								"")
							: "");

					switch (key) {
						case "lp":
							return String(item.lp);
						case "requestId":
							return String(item.kodSankcji ?? item.lp ?? "").trim();
						case "inspectionLp":
							return inspectionCode;
						case "zespoly":
							return typeof inspectionId === "number"
								? (inspectionTeamsById.get(inspectionId) ?? "")
								: "";
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
				};

				const sanctionHeaders = sanctionColumnKeys.map(
					(key) =>
						SANCTION_EXPORT_COLUMNS.find((column) => column.key === key)
							?.label ?? key,
				);
				const sanctionRowsForExport = relatedSanctionRequests.map((item) =>
					sanctionColumnKeys.map((key) =>
						normalizeExportValue(getSanctionExportValue(item, key)),
					),
				);

				const getDecisionExportValue = (
					item: (typeof relatedDecisions)[number],
					key: DecisionExportColumnKey,
					rowIndex: number,
				) => {
					const recommendationCode = String(
						item.recommendationKodZalecenia ?? "",
					).trim();
					const mappedInspectionId = recommendationCode
						? recommendationInspectionIdByCode.get(
								recommendationCode.toUpperCase(),
							)
						: undefined;
					const inspectionCode =
						typeof mappedInspectionId === "number"
							? (inspectionCodeById.get(mappedInspectionId) ?? "")
							: "";

					switch (key) {
						case "lp":
							return String(rowIndex + 1);
						case "kodDecyzji":
							return item.kodDecyzji ?? "";
						case "kodZalecenia":
							return recommendationCode;
						case "inspectionLp":
							return inspectionCode;
						case "zespoly":
							return typeof mappedInspectionId === "number"
								? (inspectionTeamsById.get(mappedInspectionId) ?? "")
								: "";
						case "nazwaPodmiotu":
							return item.nazwaPodmiotu ?? "";
						case "liczbaZalecen":
							return item.liczbaZalecen === null
								? ""
								: String(item.liczbaZalecen);
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
				};

				const decisionHeaders = decisionColumnKeys.map(
					(key) =>
						DECISION_EXPORT_COLUMNS.find((column) => column.key === key)
							?.label ?? key,
				);
				const decisionRowsForExport = relatedDecisions.map((item, index) =>
					decisionColumnKeys.map((key) =>
						normalizeExportValue(getDecisionExportValue(item, key, index)),
					),
				);

				addWorksheetWithStyles(
					workbook,
					"Inspekcje",
					inspectionHeaders,
					inspectionRowsForExport,
				);

				if (includeRecommendations && recommendationColumnKeys.length > 0) {
					addWorksheetWithStyles(
						workbook,
						"Zalecenia",
						recommendationHeaders,
						recommendationRowsForExport,
					);
				}

				if (includeSanctions && sanctionColumnKeys.length > 0) {
					addWorksheetWithStyles(
						workbook,
						"Wnioski sankcyjne",
						sanctionHeaders,
						sanctionRowsForExport,
					);
				}

				if (includeDecisions && decisionColumnKeys.length > 0) {
					addWorksheetWithStyles(
						workbook,
						"Decyzje zobowiązujące",
						decisionHeaders,
						decisionRowsForExport,
					);
				}

				const fileName = "inspekcje-zalecenia-sankcje-decyzje.xlsx";
				await saveWorkbookAsXlsx(workbook, fileName);
			} catch (error) {
				if (error instanceof DOMException && error.name === "AbortError") {
					return;
				}

				setAddInspectionError("Nie udało się wyeksportować danych do Excela.");
			} finally {
				setIsExporting(false);
			}
		},
		[
			operatorLogin,
			filteredAndSortedInspectionRows,
			inspectionNoLetterFlagsByRowId,
			isExporting,
			visibleInspectionColumnDefinitions,
		],
	);

	const handleOpenExportConfigModal = () => {
		if (isExporting || filteredAndSortedInspectionRows.length === 0) {
			return;
		}

		setIncludeRecommendationsInExport(false);
		setIncludeSanctionsInExport(false);
		setIncludeDecisionsInExport(false);
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
			(includeRecommendationsInExport &&
				selectedRecommendationExportColumns.length === 0) ||
			(includeSanctionsInExport &&
				selectedSanctionExportColumns.length === 0) ||
			(includeDecisionsInExport && selectedDecisionExportColumns.length === 0)
		) {
			return;
		}

		const orderedRecommendationColumns = RECOMMENDATION_EXPORT_COLUMNS.map(
			(column) => column.key,
		).filter((key) => selectedRecommendationExportColumns.includes(key));

		const orderedSanctionColumns = SANCTION_EXPORT_COLUMNS.map(
			(column) => column.key,
		).filter((key) => selectedSanctionExportColumns.includes(key));

		const orderedDecisionColumns = DECISION_EXPORT_COLUMNS.map(
			(column) => column.key,
		).filter((key) => selectedDecisionExportColumns.includes(key));

		setIsExportConfigModalOpen(false);
		void handleExportCurrentView(
			orderedRecommendationColumns,
			orderedSanctionColumns,
			orderedDecisionColumns,
			includeRecommendationsInExport,
			includeSanctionsInExport,
			includeDecisionsInExport,
		);
	};

	const handleTeamMemberToggle = (userId: number) => {
		setTeamMemberScopeError(null);
		setOutOfScopeTeamMemberUserId(null);
		setSelectedTeamMemberIds((prev) =>
			prev.includes(userId)
				? prev.filter((item) => item !== userId)
				: [...prev, userId],
		);
	};

	const handleSetIsDataAkceptacjiNotyBrak = useCallback(
		(next: SetStateAction<boolean>) => {
			setIsDataAkceptacjiNotyBrak((prev) => {
				const resolved =
					typeof next === "function"
						? (next as (previousState: boolean) => boolean)(prev)
						: next;
				if (resolved !== prev) {
					setDidToggleDataAkceptacjiNotyBrak(true);
				}
				return resolved;
			});
		},
		[],
	);

	const resolveDictionaryFormValueForRow = (
		rowId: string,
		fallbackValue: string,
		idsByRowId: Record<string, number | null>,
		codesByRowId: Record<string, string>,
		valueById: Record<number, string>,
		valueByCode: Record<string, string>,
	) => {
		const fallback = fallbackValue.trim();
		if (fallback) {
			return fallback;
		}

		const rowIdValue = idsByRowId[rowId];
		if (
			typeof rowIdValue === "number" &&
			Number.isFinite(rowIdValue) &&
			rowIdValue > 0
		) {
			const mappedById = valueById[rowIdValue] ?? "";
			if (mappedById) {
				return mappedById;
			}
		}

		const rowCodeValue = (codesByRowId[rowId] ?? "").trim().toUpperCase();
		if (rowCodeValue) {
			const mappedByCode = valueByCode[rowCodeValue] ?? "";
			if (mappedByCode) {
				return mappedByCode;
			}
		}

		return fallback;
	};

	const handleOpenAddModal = () => {
		if (!canManageInspections) {
			setRowsError("Konto zewnętrzne ma dostęp tylko do odczytu.");
			return;
		}

		const defaultLeaderUserId =
			null;

		const defaultLeaderName = defaultLeaderUserId
			? getUserDisplayName(
					availableLeaderUsers.find(
						(user) => user.id === defaultLeaderUserId,
					) ?? {
						id: defaultLeaderUserId,
						login: operatorLogin,
						displayName: operatorDisplayName,
						active: true,
						visibleOnList: true,
						canBeLeader: true,
						createdByOperator: true,
						teamId: null,
						teamName: null,
						filterGroup: null,
						includeInFilters: true,
					},
				)
			: "";

		setAddInspectionForm({
			...DEFAULT_ADD_INSPECTION_FORM,
			osobaKierujaca: defaultLeaderName,
		});
		setSelectedLeaderUserId(defaultLeaderUserId);
		setAddInspectionError(null);
		setTeamMemberScopeError(null);
		setOutOfScopeTeamMemberUserId(null);
		setSelectedInspectionScopes([]);
		setSelectedTeamMemberIds([]);
		setSelectedInspectionTeamIds([]);
		setIsInspectionTeamSelectionManual(false);
		setDataAkceptacjiNotyList([]);
		setIsDataAkceptacjiNotyBrak(false);
		setDidToggleDataAkceptacjiNotyBrak(false);
		setIsTeamPickerOpen(false);
		setEditingInspectionId(null);
		setShowRequiredInspectionFieldErrors(false);
		setVersionConflictUpdatedAt(null);
		setStatusValidationViolations([]);
		setIsStatusValidationModalOpen(false);
		setInspectionDatesValidationModalData(null);
		setSaveLockConflict(null);
		setIsAddModalOpen(true);
	};

	const handleOpenEditModal = async () => {
		if (!canManageInspections) {
			setRowsError("Konto zewnętrzne ma dostęp tylko do odczytu.");
			return;
		}

		if (!selectedInspectionId) {
			return;
		}

		if (!selectedInspectionCanEdit) {
			setAddInspectionError("Brak uprawnień do edycji tej inspekcji.");
			return;
		}

		const rowToEdit = inspectionRows.find(
			(row) => row.id === selectedInspectionId,
		);

		if (!rowToEdit) {
			return;
		}

		await loadInspectionPeopleOptionsForEdit(rowToEdit.id);

		const nextForm = mapRowToAddForm(rowToEdit);
		const noLetterFlags = inspectionNoLetterFlagsByRowId[rowToEdit.id] ?? {
			brakDataDoreczeniaPisma: false,
			brakDataPismaZastrzezenia: false,
			brakDataWyslaniaPismaZZastrzezeniami: false,
			brakDataWplywuPisma: false,
			brakDataPismaZOdpowiedzia: false,
			brakDataWyslaniaPismaZOdpowiedzia: false,
		};
		const existingLeaderUserId =
			inspectionLeaderUserIdByRowId[rowToEdit.id] ?? null;
		const resolvedInspectionType = resolveDictionaryFormValueForRow(
			rowToEdit.id,
			nextForm.typInspekcji,
			inspectionTypeIdByRowId,
			inspectionTypeCodeByRowId,
			inspectionTypeValueById,
			inspectionTypeValueByCode,
		);
		const resolvedMarket = resolveDictionaryFormValueForRow(
			rowToEdit.id,
			nextForm.rynek,
			marketIdByRowId,
			marketCodeByRowId,
			marketValueById,
			marketValueByCode,
		);
		const resolvedEntityType = resolveDictionaryFormValueForRow(
			rowToEdit.id,
			nextForm.rodzajPodmiotu,
			entityTypeIdByRowId,
			entityTypeCodeByRowId,
			entityTypeValueById,
			entityTypeValueByCode,
		);
		const resolvedStatus = resolveDictionaryFormValueForRow(
			rowToEdit.id,
			nextForm.status,
			inspectionStatusIdByRowId,
			inspectionStatusCodePositionByRowId,
			inspectionStatusValueById,
			inspectionStatusValueByCode,
		);
		setAddInspectionForm({
			...nextForm,
			typInspekcji: resolvedInspectionType,
			rynek: resolvedMarket,
			rodzajPodmiotu: resolvedEntityType,
			status: resolvedStatus,
			...noLetterFlags,
			dataDoreczeniaPisma: noLetterFlags.brakDataDoreczeniaPisma
				? ""
				: nextForm.dataDoreczeniaPisma,
			dataPismaZastrzezenia: noLetterFlags.brakDataPismaZastrzezenia
				? ""
				: nextForm.dataPismaZastrzezenia,
			dataWyslaniaPismaZZastrzezeniami:
				noLetterFlags.brakDataWyslaniaPismaZZastrzezeniami
					? ""
					: nextForm.dataWyslaniaPismaZZastrzezeniami,
			dataWplywuPisma: noLetterFlags.brakDataWplywuPisma
				? ""
				: nextForm.dataWplywuPisma,
			dataPismaZOdpowiedzia: noLetterFlags.brakDataPismaZOdpowiedzia
				? ""
				: nextForm.dataPismaZOdpowiedzia,
			dataWyslaniaPismaZOdpowiedzia:
				noLetterFlags.brakDataWyslaniaPismaZOdpowiedzia
					? ""
					: nextForm.dataWyslaniaPismaZOdpowiedzia,
		});
		setSelectedLeaderUserId(existingLeaderUserId);
		setSelectedInspectionScopes(
			inspectionScopeIdsByRowId[rowToEdit.id]?.length
				? normalizeInspectionScopeValues(
						(inspectionScopeIdsByRowId[rowToEdit.id] ?? [])
							.map((scopeId) => inspectionScopeValueById[scopeId] ?? "")
							.filter(Boolean),
					)
				: inspectionScopeValuesByRowId[rowToEdit.id]?.length
					? (inspectionScopeValuesByRowId[rowToEdit.id] ?? []).filter(
							(value) => typeof inspectionScopeIdByValue[value] === "number",
						)
					: [],
		);
		setSelectedTeamMemberIds(
			inspectionTeamMemberIdsByRowId[rowToEdit.id] ?? [],
		);
		const existingInspectionTeamIds = inspectionTeamIdsByRowId[rowToEdit.id] ?? [];
		const fallbackInspectionTeamIds = deriveInspectionTeamIdsFromMemberIds(
			inspectionTeamMemberIdsByRowId[rowToEdit.id] ?? [],
		);
		setSelectedInspectionTeamIds(
			existingInspectionTeamIds.length > 0
				? existingInspectionTeamIds
				: fallbackInspectionTeamIds,
		);
		setIsInspectionTeamSelectionManual(existingInspectionTeamIds.length > 0);
		const acceptanceDates =
			inspectionAcceptanceDatesByRowId[rowToEdit.id] ?? [];
		const noAcceptanceDatesFlags =
			inspectionNoAcceptanceDatesByRowId[rowToEdit.id] ?? {
				brakDatAkceptacjiNoty: false,
			};
		setDataAkceptacjiNotyList(acceptanceDates);
		setIsDataAkceptacjiNotyBrak(noAcceptanceDatesFlags.brakDatAkceptacjiNoty);
		setDidToggleDataAkceptacjiNotyBrak(false);
		setAddInspectionError(null);
		setTeamMemberScopeError(null);
		setOutOfScopeTeamMemberUserId(null);
		setIsTeamPickerOpen(false);
		setEditingInspectionId(rowToEdit.id);
		setShowRequiredInspectionFieldErrors(false);
		setVersionConflictUpdatedAt(null);
		setStatusValidationViolations([]);
		setIsStatusValidationModalOpen(false);
		setInspectionDatesValidationModalData(null);
		setSaveLockConflict(null);
		setIsAddModalOpen(true);
	};

	const handleOpenDeleteConfirmModal = () => {
		if (!isDirector || !selectedInspectionId) {
			return;
		}

		setRowsError(null);
		setIsDeleteConfirmModalOpen(true);
	};

	const handleOpenPreviewModal = (inspectionId: string) => {
		const rowToPreview = inspectionRows.find((row) => row.id === inspectionId);
		if (!rowToPreview) {
			return;
		}

		const nextForm = mapRowToAddForm(rowToPreview);
		const noLetterFlags = inspectionNoLetterFlagsByRowId[rowToPreview.id] ?? {
			brakDataDoreczeniaPisma: false,
			brakDataPismaZastrzezenia: false,
			brakDataWyslaniaPismaZZastrzezeniami: false,
			brakDataWplywuPisma: false,
			brakDataPismaZOdpowiedzia: false,
			brakDataWyslaniaPismaZOdpowiedzia: false,
		};
		const existingLeaderUserId =
			inspectionLeaderUserIdByRowId[rowToPreview.id] ?? null;
		const resolvedInspectionType = resolveDictionaryFormValueForRow(
			rowToPreview.id,
			nextForm.typInspekcji,
			inspectionTypeIdByRowId,
			inspectionTypeCodeByRowId,
			inspectionTypeValueById,
			inspectionTypeValueByCode,
		);
		const resolvedMarket = resolveDictionaryFormValueForRow(
			rowToPreview.id,
			nextForm.rynek,
			marketIdByRowId,
			marketCodeByRowId,
			marketValueById,
			marketValueByCode,
		);
		const resolvedEntityType = resolveDictionaryFormValueForRow(
			rowToPreview.id,
			nextForm.rodzajPodmiotu,
			entityTypeIdByRowId,
			entityTypeCodeByRowId,
			entityTypeValueById,
			entityTypeValueByCode,
		);
		const resolvedStatus = resolveDictionaryFormValueForRow(
			rowToPreview.id,
			nextForm.status,
			inspectionStatusIdByRowId,
			inspectionStatusCodePositionByRowId,
			inspectionStatusValueById,
			inspectionStatusValueByCode,
		);

		setAddInspectionForm({
			...nextForm,
			typInspekcji: resolvedInspectionType,
			rynek: resolvedMarket,
			rodzajPodmiotu: resolvedEntityType,
			status: resolvedStatus,
			...noLetterFlags,
			dataDoreczeniaPisma: noLetterFlags.brakDataDoreczeniaPisma
				? ""
				: nextForm.dataDoreczeniaPisma,
			dataPismaZastrzezenia: noLetterFlags.brakDataPismaZastrzezenia
				? ""
				: nextForm.dataPismaZastrzezenia,
			dataWyslaniaPismaZZastrzezeniami:
				noLetterFlags.brakDataWyslaniaPismaZZastrzezeniami
					? ""
					: nextForm.dataWyslaniaPismaZZastrzezeniami,
			dataWplywuPisma: noLetterFlags.brakDataWplywuPisma
				? ""
				: nextForm.dataWplywuPisma,
			dataPismaZOdpowiedzia: noLetterFlags.brakDataPismaZOdpowiedzia
				? ""
				: nextForm.dataPismaZOdpowiedzia,
			dataWyslaniaPismaZOdpowiedzia:
				noLetterFlags.brakDataWyslaniaPismaZOdpowiedzia
					? ""
					: nextForm.dataWyslaniaPismaZOdpowiedzia,
		});
		setSelectedLeaderUserId(existingLeaderUserId);
		setSelectedInspectionScopes(
			inspectionScopeIdsByRowId[rowToPreview.id]?.length
				? normalizeInspectionScopeValues(
						(inspectionScopeIdsByRowId[rowToPreview.id] ?? [])
							.map((scopeId) => inspectionScopeValueById[scopeId] ?? "")
							.filter(Boolean),
					)
				: inspectionScopeValuesByRowId[rowToPreview.id]?.length
					? (inspectionScopeValuesByRowId[rowToPreview.id] ?? []).filter(
							(value) => typeof inspectionScopeIdByValue[value] === "number",
						)
					: [],
		);
		setSelectedTeamMemberIds(inspectionTeamMemberIdsByRowId[rowToPreview.id] ?? []);
		const existingPreviewInspectionTeamIds =
			inspectionTeamIdsByRowId[rowToPreview.id] ?? [];
		const fallbackPreviewInspectionTeamIds = deriveInspectionTeamIdsFromMemberIds(
			inspectionTeamMemberIdsByRowId[rowToPreview.id] ?? [],
		);
		setSelectedInspectionTeamIds(
			existingPreviewInspectionTeamIds.length > 0
				? existingPreviewInspectionTeamIds
				: fallbackPreviewInspectionTeamIds,
		);
		setIsInspectionTeamSelectionManual(
			existingPreviewInspectionTeamIds.length > 0,
		);
		const acceptanceDates = inspectionAcceptanceDatesByRowId[rowToPreview.id] ?? [];
		const noAcceptanceDatesFlags =
			inspectionNoAcceptanceDatesByRowId[rowToPreview.id] ?? {
				brakDatAkceptacjiNoty: false,
			};
		setDataAkceptacjiNotyList(acceptanceDates);
		setIsDataAkceptacjiNotyBrak(noAcceptanceDatesFlags.brakDatAkceptacjiNoty);
		setDidToggleDataAkceptacjiNotyBrak(false);
		setAddInspectionError(null);
		setTeamMemberScopeError(null);
		setOutOfScopeTeamMemberUserId(null);
		setIsTeamPickerOpen(false);
		setEditingInspectionId(rowToPreview.id);
		setShowRequiredInspectionFieldErrors(false);
		setVersionConflictUpdatedAt(null);
		setStatusValidationViolations([]);
		setIsStatusValidationModalOpen(false);
		setInspectionDatesValidationModalData(null);
		setSaveLockConflict(null);
		setIsPreviewMode(true);
		setIsAddModalOpen(true);
	};

	const handleStartEditFromPreview = useCallback(() => {
		if (!editingInspectionId) {
			return;
		}

		if (!canManageInspections) {
			setAddInspectionError("Konto zewnętrzne ma dostęp tylko do odczytu.");
			return;
		}

		if (!(inspectionCanEditByRowId[editingInspectionId] ?? false)) {
			setAddInspectionError("Brak uprawnień do edycji tej inspekcji.");
			return;
		}

		void loadInspectionPeopleOptionsForEdit(editingInspectionId);
		setAddInspectionError(null);
		setSaveLockConflict(null);
		setVersionConflictUpdatedAt(null);
		setStatusValidationViolations([]);
		setIsStatusValidationModalOpen(false);
		setInspectionDatesValidationModalData(null);
		setShowRequiredInspectionFieldErrors(false);
		setIsPreviewMode(false);
	}, [
		canManageInspections,
		editingInspectionId,
		inspectionCanEditByRowId,
		loadInspectionPeopleOptionsForEdit,
	]);

	const getDeleteRelatedCount = (
		payload: Record<string, unknown>,
		keys: string[],
	): number | null => {
		for (const key of keys) {
			const value = payload[key];
			if (typeof value === "number" && Number.isFinite(value)) {
				return value;
			}

			if (typeof value === "string") {
				const parsed = Number(value.trim());
				if (Number.isFinite(parsed) && parsed >= 0) {
					return parsed;
				}
			}
		}

		return null;
	};

	const handleDeleteInspection = async () => {
		if (!isDirector || !selectedInspectionId || isDeletingInspection) {
			return;
		}

		setIsDeletingInspection(true);
		setRowsError(null);

		try {
			const deleteResponse = await fetch(
				`${INSPECTIONS_API_URL}/${selectedInspectionId}`,
				{
					method: "DELETE",
					headers: {
						"Content-Type": "application/json",
						"X-Operator-Login": operatorLogin,
					},
				},
			);

			if (!deleteResponse.ok) {
				const apiMessage = await getInspectionApiErrorMessage(
					deleteResponse,
					"Nie udało się usunąć inspekcji",
				);
				throw new Error(apiMessage);
			}

			let deletedRecommendationsCount: number | null = null;
			let deletedSanctionRequestsCount: number | null = null;
			let deletedObligatingDecisionsCount: number | null = null;

			const contentType = deleteResponse.headers.get("content-type") ?? "";
			if (contentType.includes("application/json")) {
				const payload = (await deleteResponse.json()) as Record<
					string,
					unknown
				>;
				const nestedDeleted =
					typeof payload.deleted === "object" && payload.deleted !== null
						? (payload.deleted as Record<string, unknown>)
						: null;

				deletedRecommendationsCount =
					getDeleteRelatedCount(payload, [
						"deletedRecommendations",
						"recommendationsDeleted",
						"deleted_recommendations",
						"recommendations_deleted",
						"deletedZalecenia",
						"zaleceniaDeleted",
						"deleted_zalecenia",
						"zalecenia",
					]) ??
					(nestedDeleted
						? getDeleteRelatedCount(nestedDeleted, [
								"recommendations",
								"recommendation",
								"recommendationCount",
								"recommendations_count",
								"zalecenia_count",
								"zalecenia",
							])
						: null);

				deletedSanctionRequestsCount =
					getDeleteRelatedCount(payload, [
						"deletedSanctionRequests",
						"sanctionRequestsDeleted",
						"deletedSanctions",
						"sanctionsDeleted",
						"deleted_sanction_requests",
						"sanction_requests_deleted",
						"deleted_sanctions",
						"sanctions_deleted",
						"deletedWnioskiSankcyjne",
						"wnioskiSankcyjneDeleted",
						"deleted_wnioski_sankcyjne",
						"wnioskiSankcyjne",
						"wnioski_sankcyjne",
						"sanctions",
						"sanctionsCount",
						"sanctions_count",
					]) ??
					(nestedDeleted
						? getDeleteRelatedCount(nestedDeleted, [
								"sanctionRequests",
								"sanctionRequest",
								"sanction_requests",
								"sanctions",
								"sanction",
								"sanctionRequestsCount",
								"sanction_requests_count",
								"sanctionsCount",
								"sanctions_count",
								"wnioskiSankcyjneCount",
								"wnioski_sankcyjne_count",
								"wnioskiSankcyjne",
								"wnioski_sankcyjne",
							])
						: null);

				deletedObligatingDecisionsCount =
					getDeleteRelatedCount(payload, [
						"deletedObligatingDecisions",
						"obligatingDecisionsDeleted",
						"deletedBindingDecisions",
						"bindingDecisionsDeleted",
						"deletedDecyzjeZobowiazujace",
						"decyzjeZobowiazujaceDeleted",
						"deleted_obligating_decisions",
						"obligating_decisions_deleted",
						"deleted_binding_decisions",
						"binding_decisions_deleted",
						"deleted_decyzje_zobowiazujace",
						"decyzje_zobowiazujace_deleted",
						"decyzjeZobowiazujace",
						"decyzje_zobowiazujace",
						"obligatingDecisions",
						"obligating_decisions",
						"bindingDecisions",
						"binding_decisions",
					]) ??
					(nestedDeleted
						? getDeleteRelatedCount(nestedDeleted, [
								"obligatingDecisions",
								"obligatingDecision",
								"obligating_decisions",
								"bindingDecisions",
								"bindingDecision",
								"binding_decisions",
								"obligatingDecisionsCount",
								"obligating_decisions_count",
								"bindingDecisionsCount",
								"binding_decisions_count",
								"decyzjeZobowiazujaceCount",
								"decyzje_zobowiazujace_count",
								"decyzjeZobowiazujace",
								"decyzje_zobowiazujace",
							])
						: null);
			}

			setIsDeleteConfirmModalOpen(false);
			setSelectedInspectionId(null);
			await loadInspections();
			window.dispatchEvent(new CustomEvent(INSPECTIONS_CHANGED_EVENT));

			const recommendationsLabel =
				deletedRecommendationsCount === null
					? "0"
					: String(deletedRecommendationsCount);
			const sanctionsLabel =
				deletedSanctionRequestsCount === null
					? "0"
					: String(deletedSanctionRequestsCount);
			const decisionsLabel =
				deletedObligatingDecisionsCount === null
					? "0"
					: String(deletedObligatingDecisionsCount);

			setDeleteSuccessModalMessage(
				`Usunięto inspekcję (zalecenia: ${recommendationsLabel}, wnioski sankcyjne: ${sanctionsLabel}, decyzje zobowiązujące: ${decisionsLabel})`,
			);
			setIsDeleteSuccessModalOpen(true);
		} catch (error) {
			setRowsError(
				error instanceof Error && error.message
					? error.message
					: "Nie udało się usunąć inspekcji.",
			);
		} finally {
			setIsDeletingInspection(false);
		}
	};

	const closeInspectionFormModal = () => {
		const shouldReloadPeopleOptions = Boolean(editingInspectionId);

		if (editInspectionLock.lockToken) {
			void editInspectionLock.release();
		}

		setIsAddModalOpen(false);
		setIsPreviewMode(false);
		setIsTeamPickerOpen(false);
		setEditingInspectionId(null);
		setSelectedInspectionScopes([]);
		setSelectedTeamMemberIds([]);
		setSelectedInspectionTeamIds([]);
		setIsInspectionTeamSelectionManual(false);
		setSelectedLeaderUserId(null);
		setDataAkceptacjiNotyList([]);
		setIsDataAkceptacjiNotyBrak(false);
		setDidToggleDataAkceptacjiNotyBrak(false);
		setVersionConflictUpdatedAt(null);
		setStatusValidationViolations([]);
		setIsStatusValidationModalOpen(false);
		setInspectionDatesValidationModalData(null);
		setSaveLockConflict(null);
		setShowRequiredInspectionFieldErrors(false);
		setTeamMemberScopeError(null);
		setOutOfScopeTeamMemberUserId(null);

		if (shouldReloadPeopleOptions) {
			void loadInspectionDictionaries();
		}
	};
	closeInspectionFormModalRef.current = closeInspectionFormModal;

	const handleRefreshAfterConflict = async () => {
		await loadInspections();
		closeInspectionFormModal();
		setVersionConflictUpdatedAt(null);
		setStatusValidationViolations([]);
		setIsStatusValidationModalOpen(false);
		setInspectionDatesValidationModalData(null);
		setSaveLockConflict(null);
		setAddInspectionError(null);
	};

	const handleOpenRecommendationForInspectionDate = useCallback(
		async (inspectionId: string, dateValue: string) => {
			const numericInspectionId = Number(inspectionId);
			const normalizedDate = normalizeDateValueForRecommendationLookup(dateValue);
			if (!Number.isFinite(numericInspectionId) || numericInspectionId <= 0 || !normalizedDate) {
				return;
			}

			const result = await fetchRecommendations(operatorLogin, {
				inspectionId: numericInspectionId,
				sortBy: "id",
				sortOrder: "asc",
			});
			if (!result.ok) {
				return;
			}

			const matchedRecommendation = result.data.items.find((item) => {
				const singleDate = toDateInputValue(item.dataZalecen);
				if (singleDate === normalizedDate) {
					return true;
				}

				return toDateList(item.dataZalecenList).includes(normalizedDate);
			});
			if (!matchedRecommendation) {
				return;
			}

			const navigationToken =
				typeof matchedRecommendation.kodZalecenia === "string" &&
				matchedRecommendation.kodZalecenia.trim()
					? matchedRecommendation.kodZalecenia.trim()
					: String(matchedRecommendation.id);

			openRecommendationFromDashboard(navigationToken);
		},
		[operatorLogin],
	);

	const handleAddInspection = async (
		event?: React.FormEvent<HTMLFormElement>,
		options?: { skipDatesValidation?: boolean },
	) => {
		event?.preventDefault();
		setInspectionDatesValidationModalData(null);

		if (!canManageInspections) {
			setAddInspectionError("Konto zewnętrzne ma dostęp tylko do odczytu.");
			return;
		}

		if (shouldShowLockedByOtherUser) {
			setAddInspectionError(
				"Nie możesz teraz edytować tego wpisu, ponieważ jest edytowany przez innego użytkownika.",
			);
			return;
		}

		const isRequiredInspectionTypeMissing = !addInspectionForm.typInspekcji.trim();
		const isRequiredEntityNameMissing = !addInspectionForm.nazwaPodmiotu.trim();
		const isRequiredStartDateMissing = !addInspectionForm.poczatekInspekcji;
		const isRequiredEndDateMissing = !addInspectionForm.koniecInspekcji;
		const isRequiredStatusMissing = !addInspectionForm.status.trim();
		const hasMissingRequiredFields =
			isRequiredInspectionTypeMissing ||
			isRequiredEntityNameMissing ||
			isRequiredStartDateMissing ||
			isRequiredEndDateMissing ||
			isRequiredStatusMissing;

		setShowRequiredInspectionFieldErrors(true);

		if (hasMissingRequiredFields) {
			setAddInspectionError(null);
			return;
		}

		setShowRequiredInspectionFieldErrors(false);

		if (
			addInspectionForm.koniecInspekcji < addInspectionForm.poczatekInspekcji
		) {
			setAddInspectionError(
				"Data końca inspekcji nie może być wcześniejsza niż data początku.",
			);
			return;
		}

		const lockedEditLeaderUserId =
			editingInspectionId && !canChangeLeaderSelection
				? (inspectionLeaderUserIdByRowId[editingInspectionId] ?? selectedLeaderUserId)
				: null;
		const leaderUserIdForSave =
			lockedEditLeaderUserId ??
			selectedLeaderUserId;

		if (!leaderUserIdForSave) {
			setAddInspectionError("Wybierz osobę kierującą.");
			return;
		}

		if (!selectedTeamMemberIds.includes(leaderUserIdForSave)) {
			setAddInspectionError(
				"Osoba kierująca kontrolą/wizytą musi być dodana do składu zespołu.",
			);
			return;
		}

		const allowedLeaderIds = new Set(availableLeaderUsers.map((user) => user.id));
		const isKeepingCurrentLeaderInEdit =
			Boolean(editingInspectionId) &&
			currentEditingInspectionLeaderUserId !== null &&
			leaderUserIdForSave === currentEditingInspectionLeaderUserId;
		if (
			!(editingInspectionId && !canChangeLeaderSelection) &&
			!isKeepingCurrentLeaderInEdit &&
			!allowedLeaderIds.has(leaderUserIdForSave)
		) {
			setAddInspectionError(
				"Wybrana osoba kierująca jest poza listą dozwolonych użytkowników.",
			);
			return;
		}

		const toNullable = (value: string) => {
			const normalized = value.trim();
			return normalized ? normalized : null;
		};

		const normalizeDateList = (list: string[]) => {
			const normalized = list
				.map((value) => toDateInputValue(value))
				.filter(Boolean);
			return Array.from(new Set(normalized)).sort((left, right) =>
				left.localeCompare(right),
			);
		};

		const resolveDictionaryIdentity = (
			value: string,
			idByValue: Record<string, number>,
			codeByValue: Record<string, string>,
		) => {
			const normalizedValue = value.trim();
			if (!normalizedValue) {
				return { id: null as number | null, code: null as string | null };
			}

			const id = idByValue[normalizedValue] ?? null;
			const code = codeByValue[normalizedValue] ?? null;

			return { id, code };
		};

		const buildInspectionWritePayload = (
			formState: AddInspectionForm,
			scopeValues: string[],
			teamMemberIds: number[],
			inspectionTeamIds: number[],
			acceptanceDates: string[],
			isNoAcceptanceDates: boolean,
		) => {
			const inspectionTypeIdentity = resolveDictionaryIdentity(
				formState.typInspekcji,
				inspectionTypeIdByValue,
				inspectionTypeCodeByValue,
			);
			const marketIdentity = resolveDictionaryIdentity(
				formState.rynek,
				marketIdByValue,
				marketCodeByValue,
			);
			const entityTypeIdentity = resolveDictionaryIdentity(
				formState.rodzajPodmiotu,
				entityTypeIdByValue,
				entityTypeCodeByValue,
			);
			const statusIdentity = resolveDictionaryIdentity(
				formState.status,
				inspectionStatusIdByValue,
				inspectionStatusCodeByValue,
			);

			const normalizedZakresInspekcjiList = normalizeInspectionScopeValues(
				scopeValues,
			);
			const normalizedZakresInspekcjiIds = Array.from(
				new Set(
					normalizedZakresInspekcjiList
						.map((scopeValue) => inspectionScopeIdByValue[scopeValue] ?? NaN)
						.filter(
							(scopeId): scopeId is number =>
								Number.isFinite(scopeId) && scopeId > 0,
						),
				),
			).sort((left, right) => left - right);
			const normalizedDataAkceptacjiNotyList = isNoAcceptanceDates
				? []
				: normalizeDateList(acceptanceDates);
			const brakDatAkceptacjiNoty =
				isNoAcceptanceDates && normalizedDataAkceptacjiNotyList.length === 0;
			const dataDoreczeniaPisma = toNullable(formState.dataDoreczeniaPisma);
			const dataPismaZastrzezenia = toNullable(formState.dataPismaZastrzezenia);
			const dataWyslaniaPismaZZastrzezeniami = toNullable(
				formState.dataWyslaniaPismaZZastrzezeniami,
			);
			const dataWplywuPisma = toNullable(formState.dataWplywuPisma);
			const dataPismaZOdpowiedzia = toNullable(formState.dataPismaZOdpowiedzia);
			const dataWyslaniaPismaZOdpowiedzia = toNullable(
				formState.dataWyslaniaPismaZOdpowiedzia,
			);
			const brakDataDoreczeniaPisma =
				formState.brakDataDoreczeniaPisma && !dataDoreczeniaPisma;
			const brakDataPismaZastrzezenia =
				formState.brakDataPismaZastrzezenia && !dataPismaZastrzezenia;
			const brakDataWyslaniaPismaZZastrzezeniami =
				formState.brakDataWyslaniaPismaZZastrzezeniami &&
				!dataWyslaniaPismaZZastrzezeniami;
			const brakDataWplywuPisma =
				formState.brakDataWplywuPisma && !dataWplywuPisma;
			const brakDataPismaZOdpowiedzia =
				formState.brakDataPismaZOdpowiedzia && !dataPismaZOdpowiedzia;
			const brakDataWyslaniaPismaZOdpowiedzia =
				formState.brakDataWyslaniaPismaZOdpowiedzia &&
				!dataWyslaniaPismaZOdpowiedzia;

			return {
				nazwaPodmiotu: formState.nazwaPodmiotu.trim(),
				typInspekcji: toNullable(formState.typInspekcji),
				typInspekcjiId: inspectionTypeIdentity.id,
				typInspekcjiKodPozycji: inspectionTypeIdentity.code,
				zakresInspekcjiIds: normalizedZakresInspekcjiIds,
				szczegolyDotyczaceZakresu: toNullable(
					formState.szczegolyDotyczaceZakresu,
				),
				aspektKonsumencki: toNullable(formState.aspektKonsumencki),
				poczatekInspekcji: formState.poczatekInspekcji,
				koniecInspekcji: formState.koniecInspekcji,
				rynek: toNullable(formState.rynek),
				rynekId: marketIdentity.id,
				rynekKodPozycji: marketIdentity.code,
				rodzajPodmiotu: toNullable(formState.rodzajPodmiotu),
				rodzajPodmiotuId: entityTypeIdentity.id,
				rodzajPodmiotuKodPozycji: entityTypeIdentity.code,
				dataProtokolu: toNullable(formState.dataProtokolu),
				dataDoreczeniaProtokolu: toNullable(formState.dataDoreczeniaProtokolu),
				dataAkceptacjiSprawozdania: toNullable(
					formState.dataAkceptacjiSprawozdania,
				),
				dataDoreczeniaPisma: brakDataDoreczeniaPisma ? null : dataDoreczeniaPisma,
				brakDataDoreczeniaPisma,
				dataPismaZastrzezenia: brakDataPismaZastrzezenia
					? null
					: dataPismaZastrzezenia,
				brakDataPismaZastrzezenia,
				dataWyslaniaPismaZZastrzezeniami:
					brakDataWyslaniaPismaZZastrzezeniami
						? null
						: dataWyslaniaPismaZZastrzezeniami,
				brakDataWyslaniaPismaZZastrzezeniami,
				dataWplywuPisma: brakDataWplywuPisma ? null : dataWplywuPisma,
				brakDataWplywuPisma,
				dataPismaZOdpowiedzia: brakDataPismaZOdpowiedzia
					? null
					: dataPismaZOdpowiedzia,
				brakDataPismaZOdpowiedzia,
				dataWyslaniaPismaZOdpowiedzia: brakDataWyslaniaPismaZOdpowiedzia
					? null
					: dataWyslaniaPismaZOdpowiedzia,
				brakDataWyslaniaPismaZOdpowiedzia,
				dataAkceptacjiNotyList: normalizedDataAkceptacjiNotyList,
				brakDatAkceptacjiNoty,
				status: toNullable(formState.status),
				statusId: statusIdentity.id,
				statusKodPozycji: statusIdentity.code,
				komentarz: toNullable(formState.komentarz),
				teamMemberUserIds: [...teamMemberIds].sort((left, right) => left - right),
				inspectionTeamIds: [...inspectionTeamIds].sort(
					(left, right) => left - right,
				),
			};
		};

		const toComparablePayload = (
			payload: ReturnType<typeof buildInspectionWritePayload>,
			leaderUserId: number | null,
		) =>
			JSON.stringify({
				...payload,
				dataAkceptacjiNotyList: [...payload.dataAkceptacjiNotyList].sort(
					(left, right) => left.localeCompare(right),
				),
				osobaKierujacaUserId: leaderUserId,
			});

		const inspectionWritePayload = buildInspectionWritePayload(
			addInspectionForm,
			selectedInspectionScopes,
			selectedTeamMemberIds,
			selectedInspectionTeamIds.filter((teamId) =>
				validInspectionTeamIdSet.has(teamId),
			),
			dataAkceptacjiNotyList,
			isDataAkceptacjiNotyBrak,
		);

		const inspectionTypeIdentity = resolveDictionaryIdentity(
			addInspectionForm.typInspekcji,
			inspectionTypeIdByValue,
			inspectionTypeCodeByValue,
		);
		const marketIdentity = resolveDictionaryIdentity(
			addInspectionForm.rynek,
			marketIdByValue,
			marketCodeByValue,
		);
		const entityTypeIdentity = resolveDictionaryIdentity(
			addInspectionForm.rodzajPodmiotu,
			entityTypeIdByValue,
			entityTypeCodeByValue,
		);
		const statusIdentity = resolveDictionaryIdentity(
			addInspectionForm.status,
			inspectionStatusIdByValue,
			inspectionStatusCodeByValue,
		);
		const unresolvedScopeValues = normalizeInspectionScopeValues(
			selectedInspectionScopes,
		).filter(
			(scopeValue) => typeof inspectionScopeIdByValue[scopeValue] !== "number",
		);

		const buildDateFieldFilledById = () => {
			const hasDate = (value: string) => Boolean(value.trim());
			const hasAcceptanceDate =
				dataAkceptacjiNotyList.some((value) => Boolean(toDateInputValue(value))) ||
				isDataAkceptacjiNotyBrak;

			return {
				[INSPECTION_DATE_FIELD_ID.PROTOCOL_OR_REPORT]: hasDate(
					addInspectionForm.dataProtokolu,
				),
				[INSPECTION_DATE_FIELD_ID.PROTOCOL_DELIVERY]: hasDate(
					addInspectionForm.dataDoreczeniaProtokolu,
				),
				[INSPECTION_DATE_FIELD_ID.OBJECTIONS_LETTER]:
					hasDate(addInspectionForm.dataPismaZastrzezenia) ||
					addInspectionForm.brakDataPismaZastrzezenia,
				[INSPECTION_DATE_FIELD_ID.OBJECTIONS_SENT]:
					hasDate(addInspectionForm.dataWyslaniaPismaZZastrzezeniami) ||
					addInspectionForm.brakDataWyslaniaPismaZZastrzezeniami,
				[INSPECTION_DATE_FIELD_ID.OBJECTIONS_RECEIVED]:
					hasDate(addInspectionForm.dataWplywuPisma) ||
					addInspectionForm.brakDataWplywuPisma,
				[INSPECTION_DATE_FIELD_ID.CONTROL_RESPONSE_SENT]:
					hasDate(addInspectionForm.dataWyslaniaPismaZOdpowiedzia) ||
					addInspectionForm.brakDataWyslaniaPismaZOdpowiedzia,
				[INSPECTION_DATE_FIELD_ID.CONTROL_RESPONSE_LETTER]:
					hasDate(addInspectionForm.dataPismaZOdpowiedzia) ||
					addInspectionForm.brakDataPismaZOdpowiedzia,
				[INSPECTION_DATE_FIELD_ID.ACCEPTANCE_NOTE]: hasAcceptanceDate,
				[INSPECTION_DATE_FIELD_ID.VISIT_REPORT_ACCEPTANCE]: hasDate(
					addInspectionForm.dataAkceptacjiSprawozdania,
				),
				[INSPECTION_DATE_FIELD_ID.VISIT_LETTER_DELIVERY]:
					hasDate(addInspectionForm.dataDoreczeniaPisma) ||
					addInspectionForm.brakDataDoreczeniaPisma,
			} as Record<InspectionDateFieldId, boolean>;
		};

		const selectedStatusCode = normalizeStatusCodePosition(
			statusIdentity.code ?? inspectionStatusCodeByValue[addInspectionForm.status],
		);
		const shouldSkipDatesValidation = options?.skipDatesValidation === true;
		const selectedInspectionTimelineMode = (() => {
			const fromTypeValue = resolveInspectionTimelineModeFromTypeValue(
				addInspectionForm.typInspekcji,
			);
			if (fromTypeValue) {
				return fromTypeValue;
			}

			if (CONTROL_ONLY_STATUS_CODE_POSITIONS.has(selectedStatusCode)) {
				return "control" as InspectionTimelineMode;
			}

			if (SUPERVISORY_VISIT_ONLY_STATUS_CODE_POSITIONS.has(selectedStatusCode)) {
				return "visit" as InspectionTimelineMode;
			}

			return null;
		})();

		if (!selectedInspectionTimelineMode) {
			setAddInspectionError(
				"Nie można wykonać walidacji dat: nierozpoznany typ inspekcji dla wybranych danych.",
			);
			return;
		}

		const filledByFieldId = buildDateFieldFilledById();
		const timelineGroups =
			selectedInspectionTimelineMode === "control"
				? CONTROL_TIMELINE_GROUPS
				: VISIT_TIMELINE_GROUPS;
		const statusRequiredFieldsByCode =
			selectedInspectionTimelineMode === "control"
				? CONTROL_STATUS_REQUIRED_FIELDS_BY_CODE
				: VISIT_STATUS_REQUIRED_FIELDS_BY_CODE;
		const progressStatusByFields =
			selectedInspectionTimelineMode === "control"
				? CONTROL_PROGRESS_STATUS_BY_REQUIRED_FIELDS
				: VISIT_PROGRESS_STATUS_BY_REQUIRED_FIELDS;

		const modeFieldSet = new Set(timelineGroups.flat());
		const enteredFieldIds = Array.from(modeFieldSet).filter(
			(fieldId) => filledByFieldId[fieldId],
		);
		const enteredFieldNumbers = mapInspectionDateFieldIdsToNumbers(
			selectedInspectionTimelineMode,
			enteredFieldIds,
		);
		const exactMatchedProgressStatus = progressStatusByFields.find(
			(progressItem) =>
				progressItem.requiredFieldIds.length === enteredFieldIds.length &&
				progressItem.requiredFieldIds.every(
					(fieldId) => filledByFieldId[fieldId],
				),
		);
		const suggestedProgressStatus = progressStatusByFields.find((progressItem) =>
			progressItem.requiredFieldIds.every(
				(fieldId) => filledByFieldId[fieldId],
			),
		);
		const shouldSuggestProtocolOnlyStatus =
			selectedInspectionTimelineMode === "control" &&
			enteredFieldNumbers.length === 1 &&
			enteredFieldNumbers[0] === 1 &&
			selectedStatusCode !== "I_SI_14";
		const forcedSuggestedStatusCode = shouldSuggestProtocolOnlyStatus
			? "I_SI_14"
			: null;
		const suggestedStatusCodeFromEnteredFields =
			forcedSuggestedStatusCode ??
			(exactMatchedProgressStatus?.statusCode === selectedStatusCode
				? null
				: exactMatchedProgressStatus?.statusCode ?? null);

		if (!selectedStatusCode) {
			setAddInspectionError(
				"Nie można wykonać walidacji dat: brak rozpoznanego kodu statusu dla wybranego statusu.",
			);
			return;
		}

		if (!(selectedStatusCode in statusRequiredFieldsByCode)) {
			setAddInspectionError(
				`Nie można wykonać walidacji dat: kod statusu ${selectedStatusCode} nie ma zdefiniowanych reguł walidacji.`,
			);
			return;
		}

		if (
			!shouldSkipDatesValidation &&
			STATUS_CODES_WITHOUT_DATES.has(selectedStatusCode) &&
			enteredFieldNumbers.length > 0
		) {
			setInspectionDatesValidationModalData({
				kind: "status-forbids-dates",
				mode: selectedInspectionTimelineMode,
				selectedStatusCode,
				suggestedStatusCode: suggestedStatusCodeFromEnteredFields,
				enteredFieldNumbers,
				expectedFieldNumbers: [],
				missingFieldNumbers: [],
				message: "Dla wybranego statusu nie powinny być wprowadzone daty.",
			});
			setAddInspectionError(null);
			return;
		}

		const furthestTriggeredGroupIndex = timelineGroups.reduce(
			(furthestIndex, group, groupIndex) =>
				group.some((fieldId) => filledByFieldId[fieldId])
					? groupIndex
					: furthestIndex,
			-1,
		);
		let timelineExpectedFieldNumbers: number[] = [];
		let timelineMissingFieldNumbers: number[] = [];

		if (furthestTriggeredGroupIndex >= 0) {
			const expectedFieldIds = timelineGroups
				.slice(0, furthestTriggeredGroupIndex + 1)
				.flat();
			const missingFieldIds = expectedFieldIds.filter(
				(fieldId) => !filledByFieldId[fieldId],
			);
			timelineExpectedFieldNumbers = mapInspectionDateFieldIdsToNumbers(
				selectedInspectionTimelineMode,
				expectedFieldIds,
			);
			timelineMissingFieldNumbers = mapInspectionDateFieldIdsToNumbers(
				selectedInspectionTimelineMode,
				missingFieldIds,
			);
		}

		const selectedStatusRequiredDateFieldIds: InspectionDateFieldId[] =
			statusRequiredFieldsByCode[selectedStatusCode] ?? [];
		const missingStatusRequiredDateFieldIds =
			selectedStatusRequiredDateFieldIds.filter(
			(fieldId) => !filledByFieldId[fieldId],
		);
		const selectedStatusRequiredFieldNumberList =
			mapInspectionDateFieldIdsToNumbers(
			selectedInspectionTimelineMode,
			selectedStatusRequiredDateFieldIds,
		);
		const selectedStatusRequiredFieldIdSet = new Set(
			selectedStatusRequiredDateFieldIds,
		);
		const missingStatusRequiredFieldNumberList =
			mapInspectionDateFieldIdsToNumbers(
				selectedInspectionTimelineMode,
				missingStatusRequiredDateFieldIds,
			);
		const extraEnteredDateFieldIdsBeyondSelectedStatus = enteredFieldIds.filter(
			(fieldId) => !selectedStatusRequiredFieldIdSet.has(fieldId),
		);
		const extraEnteredDateFieldNumbersBeyondSelectedStatus =
			mapInspectionDateFieldIdsToNumbers(
				selectedInspectionTimelineMode,
				extraEnteredDateFieldIdsBeyondSelectedStatus,
			);
		const extraEnteredDateFieldIdsForSelectedStatus =
			STATUS_CODES_REQUIRING_ONLY_PROTOCOL_DATE.has(selectedStatusCode)
				? enteredFieldIds.filter(
					(fieldId) =>
						fieldId !== INSPECTION_DATE_FIELD_ID.PROTOCOL_OR_REPORT,
				)
				: [];
		const extraEnteredDateFieldNumbersForSelectedStatus =
			mapInspectionDateFieldIdsToNumbers(
				selectedInspectionTimelineMode,
				extraEnteredDateFieldIdsForSelectedStatus,
			);
		const closedStatusRequiredFieldNumbersForSelectedMode =
			CLOSED_STATUS_REQUIRED_FIELD_NUMBERS_BY_MODE[
				selectedInspectionTimelineMode
			] ?? [];
		const hasAllClosedStatusDateFieldsFilled =
			closedStatusRequiredFieldNumbersForSelectedMode.length > 0 &&
			closedStatusRequiredFieldNumbersForSelectedMode.every((fieldNumber) =>
				enteredFieldNumbers.includes(fieldNumber),
			);

		if (
			!shouldSkipDatesValidation &&
			STATUS_CODES_REQUIRING_ONLY_PROTOCOL_DATE.has(selectedStatusCode) &&
			extraEnteredDateFieldNumbersForSelectedStatus.length > 0
		) {
			setInspectionDatesValidationModalData({
				kind: "status-extra-dates",
				mode: selectedInspectionTimelineMode,
				selectedStatusCode,
				suggestedStatusCode: suggestedStatusCodeFromEnteredFields,
				enteredFieldNumbers: extraEnteredDateFieldNumbersForSelectedStatus,
				expectedFieldNumbers: selectedStatusRequiredFieldNumberList,
				missingFieldNumbers: missingStatusRequiredFieldNumberList,
				message:
					"Dla wybranego statusu wymagana jest data protokołu kontroli.",
			});
			setAddInspectionError(null);
			return;
		}

		if (!shouldSkipDatesValidation && selectedStatusCode === "I_SI_4") {
			if (missingStatusRequiredFieldNumberList.length > 0) {
				setInspectionDatesValidationModalData({
					kind: "status-required",
					mode: selectedInspectionTimelineMode,
					selectedStatusCode,
					suggestedStatusCode: null,
					enteredFieldNumbers,
					expectedFieldNumbers: selectedStatusRequiredFieldNumberList,
					missingFieldNumbers: missingStatusRequiredFieldNumberList,
					message:
						"Wybrany status wymaga uzupełnienia określonych pól dat.",
				});
				setAddInspectionError(null);
				return;
			}

			if (extraEnteredDateFieldNumbersBeyondSelectedStatus.length > 0) {
				setInspectionDatesValidationModalData({
					kind: "status-extra-no-suggestion",
					mode: selectedInspectionTimelineMode,
					selectedStatusCode,
					suggestedStatusCode: null,
					enteredFieldNumbers: extraEnteredDateFieldNumbersBeyondSelectedStatus,
					expectedFieldNumbers: selectedStatusRequiredFieldNumberList,
					missingFieldNumbers: [],
					message:
						"Wybrany status ma określone wymagane pola, ale uzupełniono dodatkowe daty.",
				});
				setAddInspectionError(null);
				return;
			}
		}

		if (!shouldSkipDatesValidation && selectedStatusCode === "I_SI_11") {
			if (missingStatusRequiredFieldNumberList.length > 0) {
				setInspectionDatesValidationModalData({
					kind: "status-required",
					mode: selectedInspectionTimelineMode,
					selectedStatusCode,
					suggestedStatusCode: null,
					enteredFieldNumbers,
					expectedFieldNumbers: selectedStatusRequiredFieldNumberList,
					missingFieldNumbers: missingStatusRequiredFieldNumberList,
					message:
						"Wybrany status wymaga uzupełnienia określonych pól dat.",
				});
				setAddInspectionError(null);
				return;
			}

			if (extraEnteredDateFieldNumbersBeyondSelectedStatus.length > 0) {
				setInspectionDatesValidationModalData({
					kind: "status-extra-no-suggestion",
					mode: selectedInspectionTimelineMode,
					selectedStatusCode,
					suggestedStatusCode: null,
					enteredFieldNumbers: extraEnteredDateFieldNumbersBeyondSelectedStatus,
					expectedFieldNumbers: selectedStatusRequiredFieldNumberList,
					missingFieldNumbers: [],
					message:
						"Wybrany status ma określone wymagane pola, ale uzupełniono dodatkowe daty.",
				});
				setAddInspectionError(null);
				return;
			}
		}

		if (!shouldSkipDatesValidation && selectedStatusCode === "I_SI_5") {
			if (missingStatusRequiredFieldNumberList.length > 0) {
				setInspectionDatesValidationModalData({
					kind: "status-required",
					mode: selectedInspectionTimelineMode,
					selectedStatusCode,
					suggestedStatusCode: null,
					enteredFieldNumbers,
					expectedFieldNumbers: selectedStatusRequiredFieldNumberList,
					missingFieldNumbers: missingStatusRequiredFieldNumberList,
					message:
						"Wybrany status wymaga uzupełnienia określonych pól dat.",
				});
				setAddInspectionError(null);
				return;
			}

			if (extraEnteredDateFieldNumbersBeyondSelectedStatus.length > 0) {
				setInspectionDatesValidationModalData({
					kind: "status-extra-no-suggestion",
					mode: selectedInspectionTimelineMode,
					selectedStatusCode,
					suggestedStatusCode: null,
					enteredFieldNumbers: extraEnteredDateFieldNumbersBeyondSelectedStatus,
					expectedFieldNumbers: selectedStatusRequiredFieldNumberList,
					missingFieldNumbers: [],
					message:
						"Wybrany status ma określone wymagane pola, ale uzupełniono dodatkowe daty.",
				});
				setAddInspectionError(null);
				return;
			}
		}

		if (!shouldSkipDatesValidation && selectedStatusCode === "I_SI_6") {
			if (missingStatusRequiredFieldNumberList.length > 0) {
				setInspectionDatesValidationModalData({
					kind: "status-required",
					mode: selectedInspectionTimelineMode,
					selectedStatusCode,
					suggestedStatusCode: null,
					enteredFieldNumbers,
					expectedFieldNumbers: selectedStatusRequiredFieldNumberList,
					missingFieldNumbers: missingStatusRequiredFieldNumberList,
					message:
						"Wybrany status wymaga uzupełnienia określonych pól dat.",
				});
				setAddInspectionError(null);
				return;
			}

			if (extraEnteredDateFieldNumbersBeyondSelectedStatus.length > 0) {
				setInspectionDatesValidationModalData({
					kind: "status-extra-no-suggestion",
					mode: selectedInspectionTimelineMode,
					selectedStatusCode,
					suggestedStatusCode: null,
					enteredFieldNumbers: extraEnteredDateFieldNumbersBeyondSelectedStatus,
					expectedFieldNumbers: selectedStatusRequiredFieldNumberList,
					missingFieldNumbers: [],
					message:
						"Wybrany status ma określone wymagane pola, ale uzupełniono dodatkowe daty.",
				});
				setAddInspectionError(null);
				return;
			}
		}

		if (
			!shouldSkipDatesValidation &&
			selectedInspectionTimelineMode === "visit" &&
			selectedStatusCode === "I_SI_8"
		) {
			if (missingStatusRequiredFieldNumberList.length > 0) {
				setInspectionDatesValidationModalData({
					kind: "status-required",
					mode: selectedInspectionTimelineMode,
					selectedStatusCode,
					suggestedStatusCode: null,
					enteredFieldNumbers,
					expectedFieldNumbers: selectedStatusRequiredFieldNumberList,
					missingFieldNumbers: missingStatusRequiredFieldNumberList,
					message:
						"Wybrany status wymaga uzupełnienia określonych pól dat.",
				});
				setAddInspectionError(null);
				return;
			}
		}
		const shouldPrioritizeStatusRequirements =
			CLOSED_STATUS_CODE_POSITIONS.has(selectedStatusCode);

		if (!shouldSkipDatesValidation && shouldPrioritizeStatusRequirements) {
			if (missingStatusRequiredFieldNumberList.length > 0) {
				setInspectionDatesValidationModalData({
					kind: "status-required",
					mode: selectedInspectionTimelineMode,
					selectedStatusCode,
					suggestedStatusCode: null,
					enteredFieldNumbers,
					expectedFieldNumbers: selectedStatusRequiredFieldNumberList,
					missingFieldNumbers: missingStatusRequiredFieldNumberList,
					message:
						"Wybrany status wymaga dodatkowych dat, które nie zostały jeszcze uzupełnione.",
				});
				setAddInspectionError(null);
				return;
			}

			if (timelineMissingFieldNumbers.length > 0) {
				setInspectionDatesValidationModalData({
					kind: "timeline-continuity",
					mode: selectedInspectionTimelineMode,
					selectedStatusCode,
					suggestedStatusCode: null,
					enteredFieldNumbers,
					expectedFieldNumbers: timelineExpectedFieldNumbers,
					missingFieldNumbers: timelineMissingFieldNumbers,
					message:
						"Wprowadzono daty z dalszego etapu, ale brakuje dat wymaganych dla zachowania ciągłości.",
				});
				setAddInspectionError(null);
				return;
			}
		} else if (!shouldSkipDatesValidation && timelineMissingFieldNumbers.length > 0) {
			setInspectionDatesValidationModalData({
				kind: "timeline-continuity",
				mode: selectedInspectionTimelineMode,
				selectedStatusCode,
				suggestedStatusCode: suggestedStatusCodeFromEnteredFields,
				enteredFieldNumbers,
				expectedFieldNumbers: timelineExpectedFieldNumbers,
				missingFieldNumbers: timelineMissingFieldNumbers,
				message:
					"Wprowadzono daty z dalszego etapu, ale brakuje dat wymaganych dla zachowania ciągłości.",
			});
			setAddInspectionError(null);
			return;
		}

		if (!shouldSkipDatesValidation && missingStatusRequiredFieldNumberList.length > 0) {
			setInspectionDatesValidationModalData({
				kind: "status-required",
				mode: selectedInspectionTimelineMode,
				selectedStatusCode,
				suggestedStatusCode: suggestedStatusCodeFromEnteredFields,
				enteredFieldNumbers,
				expectedFieldNumbers: selectedStatusRequiredFieldNumberList,
				missingFieldNumbers: missingStatusRequiredFieldNumberList,
				message:
					"Wybrany status wymaga dodatkowych dat, które nie zostały jeszcze uzupełnione.",
			});
			setAddInspectionError(null);
			return;
		}

		if (
			!shouldSkipDatesValidation &&
			extraEnteredDateFieldNumbersBeyondSelectedStatus.length > 0 &&
			!suggestedStatusCodeFromEnteredFields &&
			!hasAllClosedStatusDateFieldsFilled
		) {
			setInspectionDatesValidationModalData({
				kind: "status-extra-no-suggestion",
				mode: selectedInspectionTimelineMode,
				selectedStatusCode,
				suggestedStatusCode: null,
				enteredFieldNumbers: extraEnteredDateFieldNumbersBeyondSelectedStatus,
				expectedFieldNumbers: selectedStatusRequiredFieldNumberList,
				missingFieldNumbers: [],
				message:
					"Wprowadzono dodatkowe daty, które nie odpowiadają jednoznacznie żadnemu statusowi.",
			});
			setAddInspectionError(null);
			return;
		}

		if (
			!shouldSkipDatesValidation &&
			suggestedProgressStatus &&
			selectedStatusRequiredFieldNumberList.length <
				suggestedProgressStatus.requiredFieldIds.length
		) {
			const suggestedProgressFieldNumbers = mapInspectionDateFieldIdsToNumbers(
				selectedInspectionTimelineMode,
				suggestedProgressStatus.requiredFieldIds,
			);
			setInspectionDatesValidationModalData({
				kind: "status-mismatch",
				mode: selectedInspectionTimelineMode,
				selectedStatusCode,
				suggestedStatusCode: hasAllClosedStatusDateFieldsFilled
					? null
					: suggestedProgressStatus.statusCode,
				enteredFieldNumbers,
				expectedFieldNumbers: suggestedProgressFieldNumbers,
				missingFieldNumbers: [],
				message:
					"Wprowadzone daty odpowiadają dalszemu etapowi niż wybrany status.",
			});
			setAddInspectionError(null);
			return;
		}
		if (!inspectionTypeIdentity.id) {
			setAddInspectionError(
				"Nie można zapisać rekordu: wybrany typ inspekcji nie ma mapowania do ID słownika.",
			);
			return;
		}

		if (!statusIdentity.id) {
			setAddInspectionError(
				"Nie można zapisać rekordu: wybrany status nie ma mapowania do ID słownika.",
			);
			return;
		}

		if (addInspectionForm.rynek.trim() && !marketIdentity.id) {
			setAddInspectionError(
				"Nie można zapisać rekordu: wybrany rynek nie ma mapowania do ID słownika.",
			);
			return;
		}

		if (addInspectionForm.rodzajPodmiotu.trim() && !entityTypeIdentity.id) {
			setAddInspectionError(
				"Nie można zapisać rekordu: wybrany rodzaj podmiotu nie ma mapowania do ID słownika.",
			);
			return;
		}

		if (unresolvedScopeValues.length > 0) {
			setAddInspectionError(
				"Nie można zapisać rekordu: co najmniej jeden zakres inspekcji nie ma mapowania do ID słownika.",
			);
			return;
		}

		if (editingInspectionId) {
			const rowToEdit = inspectionRows.find((row) => row.id === editingInspectionId);
			if (rowToEdit) {
				const baseNoLetterFlags = inspectionNoLetterFlagsByRowId[rowToEdit.id] ?? {
					brakDataDoreczeniaPisma: false,
					brakDataPismaZastrzezenia: false,
					brakDataWyslaniaPismaZZastrzezeniami: false,
					brakDataWplywuPisma: false,
					brakDataPismaZOdpowiedzia: false,
					brakDataWyslaniaPismaZOdpowiedzia: false,
				};
				const baseForm = {
					...mapRowToAddForm(rowToEdit),
					...baseNoLetterFlags,
					dataDoreczeniaPisma: baseNoLetterFlags.brakDataDoreczeniaPisma
						? ""
						: toDateInputValue(rowToEdit.dataDoreczeniaPisma),
					dataPismaZastrzezenia: baseNoLetterFlags.brakDataPismaZastrzezenia
						? ""
						: toDateInputValue(rowToEdit.dataPismaZastrzezenia),
					dataWyslaniaPismaZZastrzezeniami:
						baseNoLetterFlags.brakDataWyslaniaPismaZZastrzezeniami
							? ""
							: toDateInputValue(rowToEdit.dataWyslaniaPismaZZastrzezeniami),
					dataWplywuPisma: baseNoLetterFlags.brakDataWplywuPisma
						? ""
						: toDateInputValue(rowToEdit.dataWplywuPisma),
					dataPismaZOdpowiedzia: baseNoLetterFlags.brakDataPismaZOdpowiedzia
						? ""
						: toDateInputValue(rowToEdit.dataPismaZOdpowiedzia),
					dataWyslaniaPismaZOdpowiedzia:
						baseNoLetterFlags.brakDataWyslaniaPismaZOdpowiedzia
							? ""
							: toDateInputValue(rowToEdit.dataWyslaniaPismaZOdpowiedzia),
				};
				const baseTeamMemberIds =
					inspectionTeamMemberIdsByRowId[rowToEdit.id] ?? [];
				const baseInspectionTeamIds =
					inspectionTeamIdsByRowId[rowToEdit.id]?.length
						? (inspectionTeamIdsByRowId[rowToEdit.id] ?? []).filter((teamId) =>
								validInspectionTeamIdSet.has(teamId),
						  )
						: deriveInspectionTeamIdsFromMemberIds(baseTeamMemberIds);
				const baseScopeValues = inspectionScopeIdsByRowId[rowToEdit.id]?.length
					? normalizeInspectionScopeValues(
							(inspectionScopeIdsByRowId[rowToEdit.id] ?? [])
								.map((scopeId) => inspectionScopeValueById[scopeId] ?? "")
								.filter(Boolean),
						)
					: (inspectionScopeValuesByRowId[rowToEdit.id] ?? []).filter(
							(value) => typeof inspectionScopeIdByValue[value] === "number",
						);
				const baseAcceptanceDates =
					inspectionAcceptanceDatesByRowId[rowToEdit.id] ?? [];
				const baseNoAcceptanceDates =
					inspectionNoAcceptanceDatesByRowId[rowToEdit.id]?.brakDatAkceptacjiNoty ??
					false;
				const baseLeaderUserId =
					inspectionLeaderUserIdByRowId[rowToEdit.id] ?? operatorUserId ?? null;
				const basePayload = buildInspectionWritePayload(
					baseForm,
					baseScopeValues,
					baseTeamMemberIds,
					baseInspectionTeamIds,
					baseAcceptanceDates,
					baseNoAcceptanceDates,
				);
				const isPayloadUnchanged =
					toComparablePayload(basePayload, baseLeaderUserId) ===
					toComparablePayload(inspectionWritePayload, leaderUserIdForSave);

				if (isPayloadUnchanged) {
					setAddInspectionError("Brak zmian do zapisania.");
					return;
				}
			}
		}

		setIsSubmittingInspection(true);
		setAddInspectionError(null);
		setTeamMemberScopeError(null);
		setOutOfScopeTeamMemberUserId(null);
		setVersionConflictUpdatedAt(null);
		setStatusValidationViolations([]);
		setIsStatusValidationModalOpen(false);
		setInspectionDatesValidationModalData(null);
		setSaveLockConflict(null);

		try {
			if (editingInspectionId) {
				const expectedUpdatedAt =
					inspectionUpdatedAtByRowId[editingInspectionId] ?? null;
				const updateResponse = await fetch(
					`${INSPECTIONS_API_URL}/${editingInspectionId}`,
					{
						method: "PUT",
						headers: {
							"Content-Type": "application/json",
							"X-Operator-Login": operatorLogin,
						},
						body: JSON.stringify({
							...inspectionWritePayload,
							osobaKierujacaUserId: leaderUserIdForSave,
							expectedUpdatedAt,
							lockToken: editInspectionLock.lockToken,
						}),
					},
				);

				if (!updateResponse.ok) {
					if (updateResponse.status === 423) {
						let lockCode = "";
						let lockReason = "";
						let lockConflict: InspectionLockConflict | null = null;
						try {
							const payload = (await updateResponse.json()) as Record<
								string,
								unknown
							>;
							lockCode = typeof payload.code === "string" ? payload.code : "";
							lockReason =
								typeof payload.reason === "string" ? payload.reason : "";
							lockConflict = {
								ownerLogin:
									typeof payload.ownerLogin === "string"
										? payload.ownerLogin
										: "",
								ownerDisplayName:
									typeof payload.ownerDisplayName === "string"
										? payload.ownerDisplayName
										: "",
								acquiredAt:
									typeof payload.acquiredAt === "string"
										? payload.acquiredAt
										: "",
							};
						} catch {
							lockCode = "";
							lockReason = "";
							lockConflict = null;
						}

						if (lockCode === "RECORD_LOCKED") {
							setSaveLockConflict(lockConflict);
							setAddInspectionError(
								"Nie możesz teraz edytować tego wpisu, ponieważ jest edytowany przez innego użytkownika.",
							);
							return;
						}

						setSaveLockConflict(null);
						if (
							lockCode === "LOCK_REQUIRED" ||
							lockReason === "lock_required"
						) {
							setAddInspectionError(
								"Do zapisu wymagana jest aktywna blokada rekordu. Odśwież dane i otwórz formularz ponownie.",
							);
							return;
						}

						if (
							lockCode === "LOCK_TOKEN_INVALID" ||
							lockReason === "lock_token_invalid"
						) {
							setAddInspectionError(
								"Blokada edycji wygasła lub jest nieprawidłowa. Odśwież dane i otwórz formularz ponownie.",
							);
							return;
						}

						setAddInspectionError("Błąd blokady rekordu.");
						return;
					}

					if (updateResponse.status === 409) {
						const statusValidationViolations =
							await readInspectionStatusValidationViolations(updateResponse);
						if (statusValidationViolations) {
							setVersionConflictUpdatedAt(null);
							setStatusValidationViolations(statusValidationViolations);
							setIsStatusValidationModalOpen(true);
							setAddInspectionError(null);
							return;
						}

						let currentUpdatedAt: string | null = null;
						try {
							const payload = (await updateResponse.json()) as Record<
								string,
								unknown
							>;
							currentUpdatedAt =
								typeof payload.currentUpdatedAt === "string"
									? payload.currentUpdatedAt
									: typeof payload.updatedAt === "string"
										? payload.updatedAt
										: null;
						} catch {
							currentUpdatedAt = null;
						}

						setVersionConflictUpdatedAt(currentUpdatedAt);
						setAddInspectionError(
							"Dane zostały zmienione przez innego użytkownika. Odśwież widok i spróbuj ponownie.",
						);
						return;
					}

					const apiMessage = await getInspectionApiErrorMessage(
						updateResponse,
						"Nie udało się zapisać zmian",
					);
					const domainError = await readInspectionDomainError(updateResponse);
					if (
						updateResponse.status === 403 &&
						domainError?.code === "MEMBER_OUT_OF_SCOPE"
					) {
						setAddInspectionError(null);
						setTeamMemberScopeError(
							domainError.detail ||
								"Wskazana osoba w składzie zespołu jest poza zakresem operatora.",
						);
						setOutOfScopeTeamMemberUserId(domainError.memberUserId);
						return;
					}
					throw new Error(apiMessage);
				}

				await loadInspections();
				window.dispatchEvent(new CustomEvent(INSPECTIONS_CHANGED_EVENT));
				setSelectedInspectionId(editingInspectionId);
				setCreateSuccessEntityName(inspectionWritePayload.nazwaPodmiotu);
				setCreateSuccessMode("edit");
				closeInspectionFormModal();
				setIsCreateSuccessModalOpen(true);
				return;
			}

			const createResponse = await fetch(INSPECTIONS_API_URL, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Operator-Login": operatorLogin,
				},
				body: JSON.stringify({
					...inspectionWritePayload,
					osobaKierujacaUserId: leaderUserIdForSave,
				}),
			});

			if (!createResponse.ok) {
				if (createResponse.status === 409) {
					const statusValidationViolations =
						await readInspectionStatusValidationViolations(createResponse);
					if (statusValidationViolations) {
						setVersionConflictUpdatedAt(null);
						setStatusValidationViolations(statusValidationViolations);
						setIsStatusValidationModalOpen(true);
						setAddInspectionError(null);
						return;
					}
				}

				const domainError = await readInspectionDomainError(createResponse);
				if (
					createResponse.status === 403 &&
					domainError?.code === "MEMBER_OUT_OF_SCOPE"
				) {
					setAddInspectionError(null);
					setTeamMemberScopeError(
						domainError.detail ||
							"Wskazana osoba w składzie zespołu jest poza zakresem operatora.",
					);
					setOutOfScopeTeamMemberUserId(domainError.memberUserId);
					return;
				}
				const apiMessage = await getInspectionApiErrorMessage(
					createResponse,
					"Nie udało się dodać rekordu",
				);
				throw new Error(apiMessage);
			}

			let createdRecordId: string | null = null;
			const contentType = createResponse.headers.get("content-type") ?? "";
			if (contentType.includes("application/json")) {
				const createdRecord =
					(await createResponse.json()) as Partial<InspectionRow>;
				createdRecordId =
					typeof createdRecord.id === "string" ? createdRecord.id : null;
			}

			await loadInspections();
			window.dispatchEvent(new CustomEvent(INSPECTIONS_CHANGED_EVENT));
			handlePageChange(totalPages);
			if (createdRecordId) {
				setSelectedInspectionId(createdRecordId);
			}
			setCreateSuccessEntityName(inspectionWritePayload.nazwaPodmiotu);
			setCreateSuccessMode("create");
			closeInspectionFormModal();
			setIsCreateSuccessModalOpen(true);
		} catch (error) {
			setAddInspectionError(
				error instanceof Error && error.message
					? error.message
					: "Nie udało się zapisać rekordu. Sprawdź połączenie z backendem.",
			);
		} finally {
			setIsSubmittingInspection(false);
		}
	};

	const InspectionModalComponent = isPreviewMode
		? InspectionsPreviewModal
		: InspectionsFormModal;

	return (
		<>
			<TableFullscreenContainer
				isFullscreen={isFullscreen}
				onClose={() => setIsFullscreen(false)}
				className="relative flex h-full min-h-0 w-full flex-col rounded-2xl border border-slate-700/70 bg-[#101f39] px-2 pt-4 pb-2 sm:px-2 sm:pt-5 sm:pb-2"
			onClick={(event) => {
				if (event.target === event.currentTarget) {
					setSelectedInspectionId(null);
				}
				event.stopPropagation();
			}}
			>
			{!isFullscreen ? (
			<TablePanelToolbar
				title="Inspekcje"
				canClearFilters={canClearFilters}
				canResetColumnWidths={hasCustomColumnWidths}
				isExporting={isExporting}
				hasRowsToExport={filteredAndSortedInspectionRows.length > 0}
				onOpenViewModal={handleOpenInspectionViewModal}
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
								{quickFilterTeamLabels.length > 0 ? (
									quickFilterTeamLabels.map((label) => (
										<button
											key={label}
											type="button"
											onClick={() => handleQuickTeamFilterToggle(label)}
											className={`inline-flex h-6 shrink-0 items-center rounded-full border px-2.5 font-semibold text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition-colors ${
												selectedQuickTeamLabels.has(label)
													? "border-emerald-300/80 bg-emerald-300/25 text-emerald-100 hover:bg-emerald-300/35"
													: "border-slate-500/80 bg-[#1f3658] text-slate-100 hover:bg-[#294673]"
											}`}
											aria-pressed={selectedQuickTeamLabels.has(label)}
										>
											{label}
										</button>
									))
								) : (
									<span className="px-1 text-slate-400 text-xs">
										{isRowsLoading ? "Ładowanie..." : "Brak zespołów"}
									</span>
								)}
							</div>
							<span className="shrink-0 rounded-md border border-slate-500/60 bg-slate-900/35 px-2 py-1 font-semibold text-[10px] text-slate-300 uppercase tracking-wide">
								Statusy
							</span>
							<button
								type="button"
								onClick={handleQuickExcludeClosedToggle}
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
						{canManageInspections ? (
							<>
								<button
									type="button"
									onClick={handleOpenAddModal}
									className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#8ec5a1] bg-[#b9e8c9] px-3.5 font-semibold text-[#1f5130] text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] transition-colors hover:bg-[#a5debb]"
								>
									<Plus size={15} />
									Dodaj inspekcję
								</button>

								<button
									type="button"
									disabled={!selectedInspectionId}
									onClick={() => {
										if (!selectedInspectionId) {
											return;
										}

										handleOpenPreviewModal(selectedInspectionId);
									}}
									className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 font-semibold text-sm transition-colors enabled:border-[#93b9ee] enabled:bg-[#d9e9ff] enabled:text-[#21508f] enabled:hover:bg-[#c9e0ff] disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-[#1a2946] disabled:text-slate-500"
								>
									<Eye size={15} />
									Podgląd
								</button>

								<button
									type="button"
									disabled={!selectedInspectionId || !selectedInspectionCanEdit}
									onClick={() => {
										void handleOpenEditModal();
									}}
									className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 font-semibold text-sm transition-colors enabled:border-[#93b9ee] enabled:bg-[#d9e9ff] enabled:text-[#21508f] enabled:hover:bg-[#c9e0ff] disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-[#1a2946] disabled:text-slate-500"
								>
									<Pencil size={15} />
									Edytuj
								</button>
							</>
						) : null}

						{isDirector ? (
							<button
								type="button"
								disabled={!selectedInspectionId || isDeletingInspection}
								onClick={handleOpenDeleteConfirmModal}
								className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 font-semibold text-sm transition-colors enabled:border-[#f2a3a3] enabled:bg-[#6f2a36] enabled:text-[#ffe5e8] enabled:hover:bg-[#833242] disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-500"
							>
								<Trash2 size={15} />
								{isDeletingInspection ? "Usuwanie..." : "Usuń"}
							</button>
						) : null}
					</>
				}
			/>
			) : null}

			<InspectionsDataTable
				rowsError={rowsError}
				isRowsLoading={isRowsLoading}
				visibleColumns={visibleInspectionColumnDefinitions}
				columnWidths={columnWidths}
				minColumnWidth={INSPECTIONS_MIN_COLUMN_WIDTH}
				maxRowHeightPx={INSPECTIONS_MAX_ROW_HEIGHT_PX}
				sortColumnKey={sortColumnKey}
				sortDirection={sortDirection}
				advancedFilters={advancedFilters}
				columnFilters={columnFilters}
				rows={paginatedInspectionRows}
				scopeDisplayItemsByRowId={scopeDisplayItemsByRowId}
				teamDisplayItemsByRowId={teamDisplayItemsByRowId}
				noAcceptanceDatesByRowId={inspectionNoAcceptanceDatesByRowId}
				noLetterFlagsByRowId={inspectionNoLetterFlagsByRowId}
				statusCodeByRowId={inspectionStatusCodeByRowId}
				statusStyleByCode={inspectionStatusStyleByCode}
				enableStatusHighlighting={isStatusHighlightingEnabled}
				recommendationCodeByDateByRowId={
					recommendationCodeByDateByInspectionRowId
				}
				selectedInspectionId={selectedInspectionId}
				flashInspectionId={flashInspectionId}
				centerOnInspectionId={centerInspectionId}
				onInspectionCentered={() => setCenterInspectionId(null)}
				onSelectInspection={setSelectedInspectionId}
				onOpenRecommendationFromDashboard={openRecommendationFromDashboard}
				onOpenRecommendationForInspectionDate={
					handleOpenRecommendationForInspectionDate
				}
				onOpenInspectionPreview={handleOpenPreviewModal}
				onSortByColumn={handleSortByColumn}
				onResizeColumn={handleResizeColumn}
				onOpenAdvancedFilter={openAdvancedFilterForColumn}
				onFilterChange={handleFilterChange}
				footer={
					<TablePagination
						currentPage={currentPage}
						totalPages={totalPages}
						paginationItems={paginationItems}
						totalItems={filteredAndSortedInspectionRows.length}
						showTotalRowsLabel
						pageSize={pageSize}
						onPageChange={handlePageChange}
						pageSizeOptions={TABLE_PAGE_SIZE_OPTIONS}
						onPageSizeChange={handlePageSizeChange}
						showWhenSinglePage
					/>
				}
			/>

			<TableColumnPickerModal<InspectionColumnKey, InspectionViewId>
				isOpen={isColumnPickerOpen}
				layoutOptions={INSPECTION_VIEW_OPTIONS}
				selectedLayoutId={draftSelectedInspectionView}
				onSelectLayout={handleDraftViewSelect}
				columns={draftSelectableColumnDefinitions}
				hiddenColumns={draftHiddenColumns}
				visibleColumnsCount={draftVisibleInspectionColumnsCount}
				onClose={() => setIsColumnPickerOpen(false)}
				onChangeColumnVisibility={handleDraftColumnVisibilityChange}
				onChangeColumnDisplayMode={(columnKey, value) => {
					if (!isInspectionNameVariantColumnKey(columnKey)) {
						return;
					}

					if (
						!isInspectionNameVariant(value) ||
						!isInspectionNameVariantAllowedForColumn(columnKey, value)
					) {
						return;
					}

					setDraftInspectionNameVariants((prev) => ({
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
				onResetSelection={handleResetInspectionViewSelection}
				onShowAllColumns={handleDraftSelectAllColumns}
				onHideAllColumns={handleDraftDeselectAllColumns}
				onApply={handleApplyInspectionViewChanges}
			/>

			<TableAdvancedFilterModal
				isOpen={isAdvancedFilterModalOpen}
				anchor={advancedFilterAnchor}
				columnLabel={
					draftSelectableColumnDefinitions.find(
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

			<InspectionModalComponent
				isOpen={isAddModalOpen}
				isPreviewMode={isPreviewMode}
				canStartEditFromPreview={canManageInspections && previewInspectionCanEdit}
				onStartEditFromPreview={handleStartEditFromPreview}
				editingInspectionId={editingInspectionId}
				editingInspectionCode={
					editingInspectionId ? (selectedInspectionRow?.kodInspekcji ?? null) : null
				}
				editingInspectionCreatedByLabel={
					editingInspectionId ? currentEditingInspectionCreatedByLabel : null
				}
				showRequiredFieldErrors={showRequiredInspectionFieldErrors}
				isReadOnly={isPreviewMode || isReadOnlyDueToLock}
				isSaveDisabledDueToLock={
					isEditMode &&
					(editInspectionLock.isAcquireFailed ||
						editInspectionLock.isConnectionLost ||
						editInspectionLock.isExpired)
				}
				lockNotice={inspectionLockNotice}
				inactivityIsWarning={inactivityTimeout.isWarning}
				inactivitySecondsRemaining={inactivityTimeout.secondsRemaining}
				onInactivityContinue={inactivityTimeout.resetTimer}
				onRetryAcquire={
					isEditMode && editInspectionLock.isAcquireFailed
						? editInspectionLock.retryAcquire
						: undefined
				}
				versionConflictUpdatedAt={versionConflictUpdatedAt}
				onRefreshAfterConflict={() => {
					void handleRefreshAfterConflict();
				}}
				addInspectionForm={addInspectionForm}
				setAddInspectionForm={setAddInspectionForm}
				inspectionNameVariants={inspectionNameVariants}
				previewShortValuesByColumn={
					editingInspectionId
						? inspectionShortValuesByRowId[editingInspectionId]
						: undefined
				}
				marketShortLabelByValue={marketShortLabelByValue}
				entityNameOptions={entityNameOptions}
				inspectionTypeOptions={inspectionTypeOptions}
				inspectionScopeOptions={inspectionScopeOptions}
				inspectionTeamOptions={inspectionTeamOptionsWithShortLabels}
				marketOptions={marketOptions}
				entityTypeOptions={entityTypeOptions}
				inspectionStatusOptions={inspectionStatusOptionsForSelectedType}
				selectedInspectionScopes={selectedInspectionScopes}
				setSelectedInspectionScopes={setSelectedInspectionScopes}
				operatorDisplayName={operatorDisplayName}
				operatorLogin={operatorLogin}
				isTeamPickerOpen={isTeamPickerOpen}
				setIsTeamPickerOpen={setIsTeamPickerOpen}
				selectedTeamMemberIds={selectedTeamMemberIds}
				setSelectedTeamMemberIds={setSelectedTeamMemberIds}
				selectedTeamMembers={selectedTeamMembers}
				selectedInspectionTeamIds={selectedInspectionTeamIds}
				onChangeInspectionTeamIds={handleInspectionTeamIdsChange}
				selectedInspectionTeamLabels={selectedInspectionTeamLabels}
				teamMemberScopeError={teamMemberScopeError}
				outOfScopeTeamMemberUserId={outOfScopeTeamMemberUserId}
				activeUsers={activeUsersWithShortTeamLabel}
				availableLeaderUsers={leaderOptionsForModal}
				leaderChangeIrreversibleWarning={leaderChangeIrreversibleWarning}
				forceLeaderSelectionReadonly={!canChangeLeaderSelection}
				selectedLeaderUserId={selectedLeaderUserId}
				setSelectedLeaderUserId={setSelectedLeaderUserId}
				dataAkceptacjiNotyList={dataAkceptacjiNotyList}
				setDataAkceptacjiNotyList={setDataAkceptacjiNotyList}
				isDataAkceptacjiNotyBrak={isDataAkceptacjiNotyBrak}
				setIsDataAkceptacjiNotyBrak={handleSetIsDataAkceptacjiNotyBrak}
				addInspectionError={addInspectionError}
				isSubmittingInspection={isSubmittingInspection}
				onToggleTeamMember={handleTeamMemberToggle}
				onClose={closeInspectionFormModal}
				onSubmit={handleAddInspection}
			/>

			<EntitySuccessModal
				isOpen={isCreateSuccessModalOpen}
				heading={
					createSuccessMode === "edit"
						? "Inspekcja została zaktualizowana"
						: "Inspekcja została dodana"
				}
				detailsMessage={
					createSuccessEntityName.trim()
						? `Dla podmiotu ${createSuccessEntityName.trim()}.`
						: createSuccessMode === "edit"
							? "Rekord zaktualizowano w tabeli."
							: "Rekord został dodany do tabeli."
				}
				onClose={() => {
					setIsCreateSuccessModalOpen(false);
					setCreateSuccessEntityName("");
					setCreateSuccessMode("create");
				}}
			/>

			<EntitySuccessModal
				isOpen={isDeleteSuccessModalOpen}
				heading="Inspekcja została usunięta"
				detailsMessage={
					deleteSuccessModalMessage ??
					"Inspekcja oraz powiązane rekordy zostały usunięte."
				}
				onClose={() => {
					setIsDeleteSuccessModalOpen(false);
					setDeleteSuccessModalMessage(null);
				}}
			/>

			{isDeleteConfirmModalOpen ? (
				<div className="fixed inset-0 z-60 flex items-center justify-center p-4">
					<button
						type="button"
						aria-label="Zamknij okno usuwania inspekcji"
						className="absolute inset-0 bg-slate-950/65"
						onClick={() => {
							if (isDeletingInspection) {
								return;
							}

							setIsDeleteConfirmModalOpen(false);
						}}
					/>

					<div
						role="dialog"
						aria-modal="true"
						aria-label="Potwierdzenie usunięcia inspekcji"
						className="relative z-10 w-full max-w-xl rounded-2xl border border-slate-300 bg-white p-5 text-slate-900 shadow-[0_24px_56px_rgba(2,8,23,0.35)]"
					>
						<h3 className="font-semibold text-base text-slate-900">
							Usuń inspekcję
						</h3>
						<p className="mt-2 text-slate-700 text-sm leading-6">
							Usunięcie inspekcji spowoduje trwałe usunięcie wszystkich
							powiązanych zaleceń, wniosków sankcyjnych oraz decyzji
							zobowiązujących. Czy na pewno chcesz kontynuować?
						</p>
						{selectedInspectionRow?.nazwaPodmiotu ? (
							<p className="mt-2 text-slate-500 text-xs">
								Podmiot: {selectedInspectionRow.nazwaPodmiotu}
							</p>
						) : null}

						<div className="mt-5 flex items-center justify-end gap-2">
							<button
								type="button"
								onClick={() => setIsDeleteConfirmModalOpen(false)}
								disabled={isDeletingInspection}
								className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 font-semibold text-slate-700 text-sm transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
							>
								Anuluj
							</button>
							<button
								type="button"
								onClick={() => void handleDeleteInspection()}
								disabled={isDeletingInspection}
								className="inline-flex h-10 items-center rounded-lg border border-[#f2a3a3] bg-[#6f2a36] px-4 font-semibold text-[#ffe5e8] text-sm transition-colors hover:bg-[#833242] disabled:cursor-not-allowed disabled:opacity-60"
							>
								{isDeletingInspection ? "Usuwanie..." : "Usuń inspekcję"}
							</button>
						</div>
					</div>
				</div>
			) : null}

			<ExportConfigModal
				isOpen={isExportConfigModalOpen}
				description="Inspekcje eksportują aktualny widok tabeli. Wybierz kolumny dla zakładek powiązanych."
				relationsLabel="Powiąż wybrane inspekcje z:"
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
						tabId as "recommendations" | "sanctions" | "decisions",
					)
				}
				onClose={() => setIsExportConfigModalOpen(false)}
				onConfirm={handleConfirmExportFromModal}
				isConfirmDisabled={
					isExporting ||
					(includeRecommendationsInExport &&
						selectedRecommendationExportColumns.length === 0) ||
					(includeSanctionsInExport &&
						selectedSanctionExportColumns.length === 0) ||
					(includeDecisionsInExport &&
						selectedDecisionExportColumns.length === 0)
				}
				isExporting={isExporting}
			/>

			{inspectionDatesValidationModalData ? (
				<div className="fixed inset-0 z-60 flex items-center justify-center p-4">
					<button
						type="button"
						aria-label="Zamknij okno walidacji dat inspekcji"
						className="absolute inset-0 bg-slate-950/65"
						onClick={() => setInspectionDatesValidationModalData(null)}
					/>

					<div
						role="dialog"
						aria-modal="true"
						aria-label="Walidacja dat i statusu inspekcji"
						className="relative z-10 w-full max-w-3xl rounded-2xl border border-slate-300 bg-white p-5 text-slate-900 shadow-[0_24px_56px_rgba(2,8,23,0.35)]"
					>
						<h3 className="font-semibold text-base text-slate-900">
							Nie można zapisać inspekcji
						</h3>
						{inspectionDatesValidationModalData.kind ===
						"status-forbids-dates" ||
						inspectionDatesValidationModalData.kind ===
							"status-extra-dates" ||
						inspectionDatesValidationModalData.kind ===
							"status-extra-no-suggestion" ? null : (
							<p className="mt-2 text-slate-800 text-sm">
								{inspectionDatesValidationModalData.message}
							</p>
						)}

						<div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3">
							{inspectionDatesValidationModalData.kind ===
							"status-forbids-dates" ? (
								<>
									<p className="font-semibold text-blue-900 text-sm">
										Dla statusu: {" "}
										<span className="font-bold">
											{getInspectionStatusLabelByCode(
												inspectionDatesValidationModalData.selectedStatusCode,
											)}
										</span>{" "}
										nie powinny być uzupełnione poniższe pola dat:
									</p>
									{inspectionDatesValidationModalData.enteredFieldNumbers.length >
									0 ? (
										<ul className="mt-2 list-disc space-y-1 pl-5 text-blue-900 text-sm">
											{inspectionDatesValidationModalData.enteredFieldNumbers.map(
												(fieldNumber) => (
													<li key={`entered-field-${fieldNumber}`}>
														{getInspectionDateFieldLabelForValidation(fieldNumber)}
													</li>
												),
											)}
										</ul>
									) : (
										<p className="mt-2 text-blue-900 text-sm">
											Brak wprowadzonych dat dla tego statusu.
										</p>
									)}
									{(() => {
										const forbiddenDatesGuidanceItems =
											getForbiddenDatesStatusGuidanceItems(
												inspectionDatesValidationModalData,
											);

										if (forbiddenDatesGuidanceItems.length === 0) {
											return null;
										}

										return (
											<div className="mt-2 pt-1">
												{forbiddenDatesGuidanceItems.map((guidanceItem) =>
													guidanceItem.missingFieldNumbers.length > 0 ? (
														<div
															className="mt-2"
															key={`forbidden-guidance-${guidanceItem.statusCode}`}
														>
															<p className="text-blue-900 text-sm">
																Aby ustawić status {" "}
																<span className="font-semibold">
																	{getInspectionStatusLabelByCode(guidanceItem.statusCode)}
																</span>{" "}
																uzupełnij:
															</p>
															<ul className="mt-2 list-disc space-y-1 pl-5 text-blue-900 text-sm">
																{guidanceItem.missingFieldNumbers.map((fieldNumber) => (
																	<li
																		key={`forbidden-guidance-field-${guidanceItem.statusCode}-${fieldNumber}`}
																	>
																		{getInspectionDateFieldLabelForValidation(fieldNumber)}
																	</li>
																))}
															</ul>
														</div>
													) : (
														<p
															className="mt-2 text-blue-900 text-sm"
															key={`forbidden-guidance-complete-${guidanceItem.statusCode}`}
														>
															Status zgodny z danymi: {" "}
															<span className="font-semibold">
																{getInspectionStatusLabelByCode(guidanceItem.statusCode)}
															</span>
															.
														</p>
													),
												)}
											</div>
										);
									})()}
									{(() => {
										const missingClosedFields =
											getControlClosedStatusMissingFieldNumbersForForbiddenDates(
												inspectionDatesValidationModalData,
											);

										if (missingClosedFields.length === 0) {
											return null;
										}

										return (
											<div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm">
												<p>
													Jeśli zamykasz inspekcję, to w zależności od tego, czy dodano zalecenie oraz wniosek sankcyjny, ustaw status:
												</p>
												<ul className="mt-2 list-disc space-y-1 pl-5">
													<li>
														<strong>Zamknięte - wydano zalecenia</strong>
													</li>
													<li>
																<strong>Zamknięte - brak zaleceń i wniosku sankcyjnego</strong>
													</li>
													<li>
														<strong>Zamknięte - sporządzono wniosek sankcyjny</strong>
													</li>
													<li>
																<strong>Zamknięte - wydano zalecenia i sporządzono wniosek sankcyjny</strong>
													</li>
												</ul>
											</div>
										);
									})()}
								</>
							) : inspectionDatesValidationModalData.kind ===
							  "status-extra-dates" ? (
								<>
									{inspectionDatesValidationModalData.mode === "control" &&
									inspectionDatesValidationModalData.selectedStatusCode ===
										"I_SI_14" ? (
										<>
											{inspectionDatesValidationModalData.missingFieldNumbers.includes(
												1,
											) ? (
												<>
													<p className="font-semibold text-blue-900 text-sm">
														Dla statusu: {" "}
														<span className="font-bold">
															{getInspectionStatusLabelByCode(
																inspectionDatesValidationModalData.selectedStatusCode,
															)}
														</span>{" "}
														należy uzupełnić:
													</p>
													<ul className="mt-2 list-disc space-y-1 pl-5 text-blue-900 text-sm">
														{(
															inspectionDatesValidationModalData.expectedFieldNumbers
																.length > 0
																? inspectionDatesValidationModalData.expectedFieldNumbers
																: [1]
														).map((fieldNumber) => (
															<li key={`is14-required-field-${fieldNumber}`}>
																{getInspectionDateFieldLabelForValidation(fieldNumber)}
															</li>
														))}
													</ul>
												</>
											) : (
												<>
													<p className="font-semibold text-blue-900 text-sm">
														Dla statusu: {" "}
														<span className="font-bold">
															{getInspectionStatusLabelByCode(
																inspectionDatesValidationModalData.selectedStatusCode,
															)}
														</span>{" "}
														nie powinny być uzupełnione poniższe pola dat:
													</p>
													{inspectionDatesValidationModalData.enteredFieldNumbers.length >
													0 ? (
														<ul className="mt-2 list-disc space-y-1 pl-5 text-blue-900 text-sm">
															{inspectionDatesValidationModalData.enteredFieldNumbers.map(
																(fieldNumber) => (
																	<li key={`is14-extra-field-${fieldNumber}`}>
																		{getInspectionDateFieldLabelForValidation(fieldNumber)}
																	</li>
																),
															)}
														</ul>
													) : (
														<p className="mt-2 text-blue-900 text-sm">-</p>
													)}
												</>
											)}
										</>
									) : (
										<>
											<p className="font-semibold text-blue-900 text-sm">
												Dla statusu: {" "}
												<span className="font-bold">
													{getInspectionStatusLabelByCode(
														inspectionDatesValidationModalData.selectedStatusCode,
													)}
												</span>
											</p>
											<div className="mt-2 grid grid-cols-2 gap-3 text-blue-900 text-sm">
												<div>
													<p className="font-semibold">Wymagana jest data:</p>
													{inspectionDatesValidationModalData.expectedFieldNumbers.length >
													0 ? (
														<ul className="mt-1 list-disc space-y-1 pl-5">
															{inspectionDatesValidationModalData.expectedFieldNumbers.map(
																(fieldNumber) => (
																	<li key={`expected-field-${fieldNumber}`}>
																		{getInspectionDateFieldLabelForValidation(fieldNumber)}
																	</li>
																),
															)}
														</ul>
													) : (
														<p className="mt-1">-</p>
													)}
												</div>
												<div>
													<p className="font-semibold">Wprowadzono dodatkowo:</p>
													{inspectionDatesValidationModalData.enteredFieldNumbers.length >
													0 ? (
														<ul className="mt-1 list-disc space-y-1 pl-5">
															{inspectionDatesValidationModalData.enteredFieldNumbers.map(
																(fieldNumber) => (
																	<li key={`extra-field-${fieldNumber}`}>
																		{getInspectionDateFieldLabelForValidation(fieldNumber)}
																	</li>
																),
															)}
														</ul>
													) : (
														<p className="mt-1">-</p>
													)}
												</div>
											</div>
										</>
									)}
									{(() => {
										const guidanceItem = getControlIS14StatusGuidanceItem(
											inspectionDatesValidationModalData,
										);

										if (!guidanceItem) {
											return null;
										}

										return guidanceItem.missingFieldNumbers.length > 0 ? (
											<div className="mt-3 border-blue-200 border-t pt-3">
												{inspectionDatesValidationModalData.missingFieldNumbers.includes(
													1,
												) &&
												inspectionDatesValidationModalData.enteredFieldNumbers.length >
													0 ? (
													<>
														<p className="mt-2 font-semibold text-blue-900 text-sm">
															Dodatkowo nie powinny być uzupełnione poniższe pola dat:
														</p>
														<ul className="mt-2 list-disc space-y-1 pl-5 text-blue-900 text-sm">
															{inspectionDatesValidationModalData.enteredFieldNumbers.map(
																(fieldNumber) => (
																	<li key={`is14-extra-field-${fieldNumber}`}>
																		{getInspectionDateFieldLabelForValidation(fieldNumber)}
																	</li>
																),
															)}
														</ul>
													</>
												) : null}
												<p className="mt-2 text-blue-900 text-sm">
													Ewentualnie, jeśli chcesz pozostawić {inspectionDatesValidationModalData.enteredFieldNumbers.length === 1 ? "to pole" : "te pola"}, uzupełnij {guidanceItem.missingFieldNumbers.length === 1 ? "pole" : "pola"}:
												</p>
												<ul className="mt-1 list-disc space-y-1 pl-5 text-blue-900 text-sm">
													{guidanceItem.missingFieldNumbers.map((fieldNumber) => (
														<li key={`is14-guidance-${fieldNumber}`}>
															{getInspectionDateFieldLabelForValidation(fieldNumber)}
														</li>
													))}
												</ul>
												<p className="mt-2 text-blue-900 text-sm">
													Dla wybranych pól można ustawić status: {" "}
													<span className="font-semibold">
														{getInspectionStatusLabelByCode(guidanceItem.statusCode)}
													</span>
													.
												</p>
											</div>
										) : (
											<p className="mt-3 border-blue-200 border-t pt-3 text-blue-900 text-sm">
												Status zgodny z danymi: {" "}
												<span className="font-semibold">
													{getInspectionStatusLabelByCode(guidanceItem.statusCode)}
												</span>
												.
											</p>
										);
									})()}
									{(() => {
										const missingClosedFields =
											getControlClosedStatusMissingFieldNumbersForIS14ExtraDates(
												inspectionDatesValidationModalData,
											);

										if (missingClosedFields.length === 0) {
											return null;
										}

										return (
											<div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm">
												<p>
													Jeśli zamykasz inspekcję, to w zależności od tego, czy dodano zalecenie oraz wniosek sankcyjny, ustaw status:
												</p>
												<ul className="mt-2 list-disc space-y-1 pl-5">
													<li>
														<strong>Zamknięte - wydano zalecenia</strong>
													</li>
													<li>
														<strong>Zamknięte - brak zaleceń i wniosku sankcyjnego</strong>
													</li>
													<li>
														<strong>Zamknięte - sporządzono wniosek sankcyjny</strong>
													</li>
													<li>
														<strong>Zamknięte - wydano zalecenia i sporządzono wniosek sankcyjny</strong>
													</li>
												</ul>
											</div>
										);
									})()}
								</>
							) : inspectionDatesValidationModalData.kind ===
							  "status-extra-no-suggestion" ? (
								<>
									{inspectionDatesValidationModalData.mode === "control" &&
									inspectionDatesValidationModalData.selectedStatusCode ===
										"I_SI_4" ? (
										<>
											<p className="font-semibold text-blue-900 text-sm">
												Dla statusu: {" "}
												<span className="font-bold">
													{getInspectionStatusLabelByCode(
														inspectionDatesValidationModalData.selectedStatusCode,
													)}
												</span>{" "}
												nie powinny być uzupełnione poniższe pola dat:
											</p>
											{inspectionDatesValidationModalData.enteredFieldNumbers.length >
											0 ? (
												<ul className="mt-2 list-disc space-y-1 pl-5 text-blue-900 text-sm">
													{inspectionDatesValidationModalData.enteredFieldNumbers.map(
														(fieldNumber) => (
															<li key={`extra-no-suggestion-${fieldNumber}`}>
																{getInspectionDateFieldLabelForValidation(fieldNumber)}
															</li>
														),
													)}
												</ul>
											) : (
												<p className="mt-2 text-blue-900 text-sm">-</p>
											)}
										</>
									) : inspectionDatesValidationModalData.mode === "control" &&
									inspectionDatesValidationModalData.selectedStatusCode ===
										"I_SI_6" ? (
										<>
											<p className="font-semibold text-blue-900 text-sm">
												Dla statusu: {" "}
												<span className="font-bold">
													{getInspectionStatusLabelByCode(
														inspectionDatesValidationModalData.selectedStatusCode,
													)}
												</span>{" "}
												nie powinny być uzupełnione poniższe pola dat:
											</p>
											{inspectionDatesValidationModalData.enteredFieldNumbers.length >
											0 ? (
												<ul className="mt-2 list-disc space-y-1 pl-5 text-blue-900 text-sm">
													{inspectionDatesValidationModalData.enteredFieldNumbers.map(
														(fieldNumber) => (
															<li key={`extra-no-suggestion-${fieldNumber}`}>
																{getInspectionDateFieldLabelForValidation(fieldNumber)}
															</li>
														),
													)}
												</ul>
											) : (
												<p className="mt-2 text-blue-900 text-sm">-</p>
											)}
										</>
									) : inspectionDatesValidationModalData.mode === "visit" &&
									inspectionDatesValidationModalData.selectedStatusCode ===
										"I_SI_11" ? (
										<>
											<p className="font-semibold text-blue-900 text-sm">
												Dla statusu: {" "}
												<span className="font-bold">
													{getInspectionStatusLabelByCode(
														inspectionDatesValidationModalData.selectedStatusCode,
													)}
												</span>{" "}
												nie powinny być uzupełnione poniższe pola dat:
											</p>
											{inspectionDatesValidationModalData.enteredFieldNumbers.length >
											0 ? (
												<ul className="mt-2 list-disc space-y-1 pl-5 text-blue-900 text-sm">
													{inspectionDatesValidationModalData.enteredFieldNumbers.map(
														(fieldNumber) => (
															<li key={`extra-no-suggestion-${fieldNumber}`}>
																{getInspectionDateFieldLabelForValidation(fieldNumber)}
															</li>
														),
													)}
												</ul>
											) : (
												<p className="mt-2 text-blue-900 text-sm">-</p>
											)}
										</>
									) : inspectionDatesValidationModalData.mode === "visit" &&
									inspectionDatesValidationModalData.selectedStatusCode ===
										"I_SI_5" ? (
										<>
											<p className="font-semibold text-blue-900 text-sm">
												Dla statusu: {" "}
												<span className="font-bold">
													{getInspectionStatusLabelByCode(
														inspectionDatesValidationModalData.selectedStatusCode,
													)}
												</span>{" "}
												nie powinny być uzupełnione poniższe pola dat:
											</p>
											{inspectionDatesValidationModalData.enteredFieldNumbers.length >
											0 ? (
												<ul className="mt-2 list-disc space-y-1 pl-5 text-blue-900 text-sm">
													{inspectionDatesValidationModalData.enteredFieldNumbers.map(
														(fieldNumber) => (
															<li key={`extra-no-suggestion-${fieldNumber}`}>
																{getInspectionDateFieldLabelForValidation(fieldNumber)}
															</li>
														),
													)}
												</ul>
											) : (
												<p className="mt-2 text-blue-900 text-sm">-</p>
											)}
										</>
									) : (
										<>
											<p className="font-semibold text-blue-900 text-sm">
												Dla statusu: {" "}
												<span className="font-bold">
													{getInspectionStatusLabelByCode(
														inspectionDatesValidationModalData.selectedStatusCode,
													)}
												</span>
											</p>
											<div className="mt-2 grid grid-cols-2 gap-3 text-blue-900 text-sm">
												<div>
													<p className="font-semibold">Wymagane dla wybranego statusu:</p>
													{inspectionDatesValidationModalData.expectedFieldNumbers.length >
													0 ? (
														<ul className="mt-1 list-disc space-y-1 pl-5">
															{inspectionDatesValidationModalData.expectedFieldNumbers.map(
																(fieldNumber) => (
																	<li key={`expected-extra-no-suggestion-${fieldNumber}`}>
																		{getInspectionDateFieldLabelForValidation(fieldNumber)}
																	</li>
																),
															)}
														</ul>
													) : (
														<p className="mt-1">-</p>
													)}
												</div>
												<div>
													<p className="font-semibold">Wprowadzono dodatkowo:</p>
													{inspectionDatesValidationModalData.enteredFieldNumbers.length >
													0 ? (
														<ul className="mt-1 list-disc space-y-1 pl-5">
															{inspectionDatesValidationModalData.enteredFieldNumbers.map(
																(fieldNumber) => (
																	<li key={`extra-no-suggestion-${fieldNumber}`}>
																		{getInspectionDateFieldLabelForValidation(fieldNumber)}
																	</li>
																),
															)}
														</ul>
													) : (
														<p className="mt-1">-</p>
													)}
												</div>
											</div>
											<p className="mt-2 text-blue-900 text-sm">
												Usuń dodatkowe daty albo wybierz status zgodny z etapem sprawy.
											</p>
										</>
									)}
									{!shouldShowControlIS4ToIS8Guidance(
										inspectionDatesValidationModalData,
									) &&
									getControlIS4ToIS6MissingFieldNumbers(
										inspectionDatesValidationModalData,
									).length > 0 ? (
										<>
											<p className="mt-2 text-blue-900 text-sm">
												Ewentualnie, jeśli chcesz pozostawić {inspectionDatesValidationModalData.enteredFieldNumbers.length === 1 ? "to pole" : "te pola"}, uzupełnij {getControlIS4ToIS6MissingFieldNumbers(
													inspectionDatesValidationModalData,
												).length === 1 ? "pole" : "pola"}:
											</p>
											<ul className="mt-1 list-disc space-y-1 pl-5 text-blue-900 text-sm">
												{getControlIS4ToIS6MissingFieldNumbers(
													inspectionDatesValidationModalData,
												).map((fieldNumber) => (
													<li key={`missing-is6-${fieldNumber}`}>
														{getInspectionDateFieldLabelForValidation(fieldNumber)}
													</li>
												))}
											</ul>
											<p className="mt-2 text-blue-900 text-sm">
												Dla wybranych pól można ustawić status: {" "}
												<span className="font-semibold">
													{getInspectionStatusLabelByCode("I_SI_6")}
												</span>
												.
											</p>
										</>
									) : getControlIS4ToIS6MissingFieldNumbers(
										inspectionDatesValidationModalData,
									).length === 0 &&
									!shouldShowControlIS4ToIS8Guidance(
										inspectionDatesValidationModalData,
									) &&
									inspectionDatesValidationModalData.mode === "control" &&
									inspectionDatesValidationModalData.selectedStatusCode ===
										"I_SI_4" &&
									([3, 4, 5] as number[]).some((fieldNumber) =>
										inspectionDatesValidationModalData.enteredFieldNumbers.includes(
											fieldNumber,
										),
									) ? (
										<p className="mt-2 text-blue-900 text-sm">
											Status zgodny z danymi: {" "}
											<span className="font-semibold">
												{getInspectionStatusLabelByCode("I_SI_6")}
											</span>
											.
										</p>
									) : null}
									{shouldShowControlIS6ToIS8Guidance(
										inspectionDatesValidationModalData,
									) ? (
										getControlIS6ToIS8MissingFieldNumbers(
											inspectionDatesValidationModalData,
										).length > 0 ? (
											<>
												<p className="mt-2 text-blue-900 text-sm">
													Ewentualnie, jeśli chcesz pozostawić {inspectionDatesValidationModalData.enteredFieldNumbers.length === 1 ? "to pole" : "te pola"}, uzupełnij {getControlIS6ToIS8MissingFieldNumbers(
														inspectionDatesValidationModalData,
													).length === 1 ? "pole" : "pola"}:
												</p>
												<ul className="mt-1 list-disc space-y-1 pl-5 text-blue-900 text-sm">
													{getControlIS6ToIS8MissingFieldNumbers(
														inspectionDatesValidationModalData,
													).map((fieldNumber) => (
														<li key={`missing-is8-from-is6-${fieldNumber}`}>
															{getInspectionDateFieldLabelForValidation(fieldNumber)}
														</li>
													))}
												</ul>
												<ul className="mt-2 list-disc space-y-1 pl-5 text-blue-900 text-sm">
													<li>
															{(INSPECTION_DATE_FIELD_LABEL_BY_NUMBER[8] ?? "Pole daty").replace(" (lista)", "")} (opcjonalne dla statusu opracowywanie rekomendacji dalszych dzialan/zalecen.)
													</li>
												</ul>
												<p className="mt-2 text-blue-900 text-sm">
													Dla wybranych pól można ustawić status: {" "}
													<span className="font-semibold">
														{getInspectionStatusLabelByCode("I_SI_8")}
													</span>
													.
												</p>
											</>
										) : (
											<p className="mt-2 text-blue-900 text-sm">
												Status zgodny z danymi: {" "}
												<span className="font-semibold">
													{getInspectionStatusLabelByCode("I_SI_8")}
												</span>
												.
											</p>
										)
									) : null}
									{shouldShowControlIS4ToIS8Guidance(
										inspectionDatesValidationModalData,
									) ? (
										getControlIS4ToIS8MissingFieldNumbers(
											inspectionDatesValidationModalData,
										).length > 0 ? (
											<>
												<p className="mt-2 text-blue-900 text-sm">
													Ewentualnie, jeśli chcesz pozostawić {inspectionDatesValidationModalData.enteredFieldNumbers.length === 1 ? "to pole" : "te pola"}, uzupełnij {getControlIS4ToIS8MissingFieldNumbers(
														inspectionDatesValidationModalData,
													).length === 1 ? "pole" : "pola"}:
												</p>
												<ul className="mt-1 list-disc space-y-1 pl-5 text-blue-900 text-sm">
													{getControlIS4ToIS8MissingFieldNumbers(
														inspectionDatesValidationModalData,
													).map((fieldNumber) => (
														<li key={`missing-is8-${fieldNumber}`}>
															{getInspectionDateFieldLabelForValidation(fieldNumber)}
														</li>
													))}
												</ul>
												<ul className="mt-2 list-disc space-y-1 pl-5 text-blue-900 text-sm">
													<li>
															{(INSPECTION_DATE_FIELD_LABEL_BY_NUMBER[8] ?? "Pole daty").replace(" (lista)", "")} (opcjonalne dla statusu opracowywanie rekomendacji dalszych dzialan/zalecen.)
													</li>
												</ul>
												<p className="mt-2 text-blue-900 text-sm">
													Dla wybranych pól można ustawić status: {" "}
													<span className="font-semibold">
														{getInspectionStatusLabelByCode("I_SI_8")}
													</span>
													.
												</p>
											</>
										) : (
											<p className="mt-2 text-blue-900 text-sm">
												Status zgodny z danymi: {" "}
												<span className="font-semibold">
													{getInspectionStatusLabelByCode("I_SI_8")}
												</span>
												.
											</p>
										)
									) : null}
									{(() => {
										const guidanceItem = getVisitIS11StatusGuidanceItem(
											inspectionDatesValidationModalData,
										);

										if (!guidanceItem) {
											return null;
										}

										if (guidanceItem.missingFieldNumbers.length === 0) {
											return (
												<>
													{guidanceItem.statusCode === "I_SI_8" ? (
														<ul className="mt-2 list-disc space-y-1 pl-5 text-blue-900 text-sm">
															<li>{OPTIONAL_ACCEPTANCE_NOTE_VALIDATION_LABEL}</li>
														</ul>
													) : null}
													<p className="mt-2 text-blue-900 text-sm">
														Status zgodny z danymi: {" "}
														<span className="font-semibold">
															{getInspectionStatusLabelByCode(guidanceItem.statusCode)}
														</span>
														.
													</p>
												</>
											);
										}

										return (
											<>
												<p className="mt-2 text-blue-900 text-sm">
													Ewentualnie, jeśli chcesz pozostawić {guidanceItem.extraFieldNumbers.length === 1 ? "to pole" : "te pola"}, uzupełnij {guidanceItem.missingFieldNumbers.length === 1 ? "pole" : "pola"}:
												</p>
												<ul className="mt-1 list-disc space-y-1 pl-5 text-blue-900 text-sm">
													{guidanceItem.missingFieldNumbers.map((fieldNumber) => (
														<li key={`is11-guidance-${fieldNumber}`}>
															{getInspectionDateFieldLabelForValidation(fieldNumber)}
														</li>
													))}
												</ul>
												{guidanceItem.statusCode === "I_SI_8" ? (
													<ul className="mt-2 list-disc space-y-1 pl-5 text-blue-900 text-sm">
														<li>{OPTIONAL_ACCEPTANCE_NOTE_VALIDATION_LABEL}</li>
													</ul>
												) : null}
												<p className="mt-2 text-blue-900 text-sm">
													Dla wybranych pól można ustawić status: {" "}
													<span className="font-semibold">
														{getInspectionStatusLabelByCode(guidanceItem.statusCode)}
													</span>
													.
												</p>
											</>
										);
									})()}
									{(() => {
										const guidanceItem = getVisitIS5StatusGuidanceItem(
											inspectionDatesValidationModalData,
										);

										if (!guidanceItem) {
											return null;
										}

										if (guidanceItem.missingFieldNumbers.length === 0) {
											return (
												<>
													{guidanceItem.statusCode === "I_SI_8" ? (
														<ul className="mt-2 list-disc space-y-1 pl-5 text-blue-900 text-sm">
															<li>{OPTIONAL_ACCEPTANCE_NOTE_VALIDATION_LABEL}</li>
														</ul>
													) : null}
													<p className="mt-2 text-blue-900 text-sm">
														Status zgodny z danymi: {" "}
														<span className="font-semibold">
															{getInspectionStatusLabelByCode(guidanceItem.statusCode)}
														</span>
														.
													</p>
												</>
											);
										}

										return (
											<>
												<p className="mt-2 text-blue-900 text-sm">
													Ewentualnie, jeśli chcesz pozostawić {guidanceItem.extraFieldNumbers.length === 1 ? "to pole" : "te pola"}, uzupełnij {guidanceItem.missingFieldNumbers.length === 1 ? "pole" : "pola"}:
												</p>
												<ul className="mt-1 list-disc space-y-1 pl-5 text-blue-900 text-sm">
													{guidanceItem.missingFieldNumbers.map((fieldNumber) => (
														<li key={`is5-guidance-${fieldNumber}`}>
															{getInspectionDateFieldLabelForValidation(fieldNumber)}
														</li>
													))}
												</ul>
												{guidanceItem.statusCode === "I_SI_8" ? (
													<ul className="mt-2 list-disc space-y-1 pl-5 text-blue-900 text-sm">
														<li>{OPTIONAL_ACCEPTANCE_NOTE_VALIDATION_LABEL}</li>
													</ul>
												) : null}
												<p className="mt-2 text-blue-900 text-sm">
													Dla wybranych pól można ustawić status: {" "}
													<span className="font-semibold">
														{getInspectionStatusLabelByCode(guidanceItem.statusCode)}
													</span>
													.
												</p>
											</>
										);
									})()}
									{(() => {
										const shouldShowVisitClosedGuidance =
											hasVisitIS11ClosedFieldsCompleted(
												inspectionDatesValidationModalData,
											) ||
											getVisitClosedStatusMissingFieldNumbersForIS11(
												inspectionDatesValidationModalData,
											).length > 0;

										if (!shouldShowVisitClosedGuidance) {
											return null;
										}

										return (
											<div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm">
												<p>
													Jeśli zamykasz inspekcję, to w zależności od tego, czy dodano zalecenie oraz wniosek sankcyjny, ustaw status:
												</p>
												<ul className="mt-2 list-disc space-y-1 pl-5">
													<li>
														<strong>Zamknięte - wydano zalecenia</strong>
													</li>
													<li>
														<strong>Zamknięte - brak zaleceń i wniosku sankcyjnego</strong>
													</li>
													<li>
														<strong>Zamknięte - sporządzono wniosek sankcyjny</strong>
													</li>
													<li>
														<strong>Zamknięte - wydano zalecenia i sporządzono wniosek sankcyjny</strong>
													</li>
												</ul>
											</div>
										);
									})()}
									{(() => {
										const shouldShowVisitClosedGuidance =
											hasVisitIS5ClosedFieldsCompleted(
												inspectionDatesValidationModalData,
											) ||
											getVisitClosedStatusMissingFieldNumbersForIS5(
												inspectionDatesValidationModalData,
											).length > 0;

										if (!shouldShowVisitClosedGuidance) {
											return null;
										}

										return (
											<div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm">
												<p>
													Jeśli zamykasz inspekcję, to w zależności od tego, czy dodano zalecenie oraz wniosek sankcyjny, ustaw status:
												</p>
												<ul className="mt-2 list-disc space-y-1 pl-5">
													<li>
														<strong>Zamknięte - wydano zalecenia</strong>
													</li>
													<li>
														<strong>Zamknięte - brak zaleceń i wniosku sankcyjnego</strong>
													</li>
													<li>
														<strong>Zamknięte - sporządzono wniosek sankcyjny</strong>
													</li>
													<li>
														<strong>Zamknięte - wydano zalecenia i sporządzono wniosek sankcyjny</strong>
													</li>
												</ul>
											</div>
										);
									})()}
									{(() => {
										const missingClosedFields =
											getControlClosedStatusMissingFieldNumbersForIS4ExtraDates(
												inspectionDatesValidationModalData,
											);

										if (missingClosedFields.length === 0) {
											return null;
										}

										return (
											<div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm">
												<p>
													Jeśli zamykasz inspekcję, to w zależności od tego, czy dodano zalecenie oraz wniosek sankcyjny, ustaw status:
												</p>
												<ul className="mt-2 list-disc space-y-1 pl-5">
													<li>
														<strong>Zamknięte - wydano zalecenia</strong>
													</li>
													<li>
														<strong>Zamknięte - brak zaleceń i wniosku sankcyjnego</strong>
													</li>
													<li>
														<strong>Zamknięte - sporządzono wniosek sankcyjny</strong>
													</li>
													<li>
														<strong>Zamknięte - wydano zalecenia i sporządzono wniosek sankcyjny</strong>
													</li>
												</ul>
											</div>
										);
									})()}
									{hasControlIS4ClosedFieldsCompleted(
										inspectionDatesValidationModalData,
									) ? (
										<div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm">
											<p>
												Jeśli zamykasz inspekcję, to w zależności od tego, czy dodano zalecenie oraz wniosek sankcyjny, ustaw status:
											</p>
											<ul className="mt-2 list-disc space-y-1 pl-5">
												<li>
													<strong>Zamknięte - wydano zalecenia</strong>
												</li>
												<li>
													<strong>Zamknięte - brak zaleceń i wniosku sankcyjnego</strong>
												</li>
												<li>
													<strong>Zamknięte - sporządzono wniosek sankcyjny</strong>
												</li>
												<li>
													<strong>Zamknięte - wydano zalecenia i sporządzono wniosek sankcyjny</strong>
												</li>
											</ul>
										</div>
									) : null}
									{(() => {
										const missingClosedFields =
											getControlClosedStatusMissingFieldNumbersForIS6ExtraDates(
												inspectionDatesValidationModalData,
											);

										if (missingClosedFields.length === 0) {
											return null;
										}

										return (
											<div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm">
												<p>
													Jeśli zamykasz inspekcję, to w zależności od tego, czy dodano zalecenie oraz wniosek sankcyjny, ustaw status:
												</p>
												<ul className="mt-2 list-disc space-y-1 pl-5">
													<li>
														<strong>Zamknięte - wydano zalecenia</strong>
													</li>
													<li>
														<strong>Zamknięte - brak zaleceń i wniosku sankcyjnego</strong>
													</li>
													<li>
														<strong>Zamknięte - sporządzono wniosek sankcyjny</strong>
													</li>
													<li>
														<strong>Zamknięte - wydano zalecenia i sporządzono wniosek sankcyjny</strong>
													</li>
												</ul>
											</div>
										);
									})()}
									{hasControlIS6ClosedFieldsCompleted(
										inspectionDatesValidationModalData,
									) ? (
										<div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm">
											<p>
												Jeśli zamykasz inspekcję, to w zależności od tego, czy dodano zalecenie oraz wniosek sankcyjny, ustaw status:
											</p>
											<ul className="mt-2 list-disc space-y-1 pl-5">
												<li>
													<strong>Zamknięte - wydano zalecenia</strong>
												</li>
												<li>
													<strong>Zamknięte - brak zaleceń i wniosku sankcyjnego</strong>
												</li>
												<li>
													<strong>Zamknięte - sporządzono wniosek sankcyjny</strong>
												</li>
												<li>
													<strong>Zamknięte - wydano zalecenia i sporządzono wniosek sankcyjny</strong>
												</li>
											</ul>
										</div>
									) : null}
								</>
							) : (
								<>
									<p className="font-semibold text-blue-900 text-sm">
										{inspectionDatesValidationModalData.kind === "status-required" &&
										(inspectionDatesValidationModalData.selectedStatusCode ===
											"I_SI_4" ||
											inspectionDatesValidationModalData.selectedStatusCode ===
												"I_SI_6" ||
											inspectionDatesValidationModalData.selectedStatusCode ===
												"I_SI_5" ||
											inspectionDatesValidationModalData.selectedStatusCode ===
												"I_SI_8" ||
											inspectionDatesValidationModalData.selectedStatusCode ===
												"I_SI_11")
											? `Dla statusu: `
											: `Aby ustawić status: `}
										<span className="font-bold">
											{getInspectionStatusLabelByCode(
												inspectionDatesValidationModalData.selectedStatusCode,
											)}
										</span>{" "}
										{inspectionDatesValidationModalData.kind === "status-required" &&
										(inspectionDatesValidationModalData.selectedStatusCode ===
											"I_SI_4" ||
											inspectionDatesValidationModalData.selectedStatusCode ===
												"I_SI_6" ||
											inspectionDatesValidationModalData.selectedStatusCode ===
												"I_SI_5" ||
											inspectionDatesValidationModalData.selectedStatusCode ===
												"I_SI_8" ||
											inspectionDatesValidationModalData.selectedStatusCode ===
												"I_SI_11")
											? inspectionDatesValidationModalData.missingFieldNumbers.length === 1
												? "brakuje wymaganego pola:"
												: "brakuje wymaganych pól:"
											: "uzupełnij poniższe pola:"}
									</p>
									{inspectionDatesValidationModalData.missingFieldNumbers.length >
									0 ? (
										<ul className="mt-2 list-disc space-y-1 pl-5 marker:text-blue-900 text-blue-900 text-sm">
											{inspectionDatesValidationModalData.missingFieldNumbers.map(
												(fieldNumber) => (
													<li key={`missing-field-${fieldNumber}`}>
														{getInspectionDateFieldLabelForValidation(fieldNumber)}
													</li>
												),
											)}
											{inspectionDatesValidationModalData.kind === "status-required" &&
											inspectionDatesValidationModalData.selectedStatusCode === "I_SI_8" ? (
												<li>
													{INSPECTION_DATE_FIELD_LABEL_BY_NUMBER[
														getOptionalFieldNumberForStatusIS8(
															inspectionDatesValidationModalData,
														) as number
																	] ?? "Pole daty"} <span className="italic">(opcjonalne dla statusu opracowywanie rekomendacji dalszych dzialan/zalecen.)</span>
												</li>
											) : null}
										</ul>
									) : (
										<p className="mt-2 text-blue-900 text-sm">
											Brak brakujących pól dat. Zweryfikuj zgodność wybranego statusu z etapem sprawy.
										</p>
									)}
									{inspectionDatesValidationModalData.kind === "status-mismatch" &&
									inspectionDatesValidationModalData.suggestedStatusCode ? (
										<p className="mt-2 text-blue-900 text-sm">
											Status zgodny z danymi: {" "}
											<span className="font-semibold">
												{getInspectionStatusLabelByCode(
													inspectionDatesValidationModalData.suggestedStatusCode,
												)}
											</span>
											.
										</p>
									) : null}
									{(() => {
										const guidanceStatusCode =
											getControlIS8LowerStatusGuidanceCode(
												inspectionDatesValidationModalData,
											);

										if (!guidanceStatusCode) {
											return null;
										}

										return (
											<p className="mt-2 text-blue-900 text-sm">
												Dla wybranych pól można ustawić status: {" "}
												<span className="font-semibold">
													{getInspectionStatusLabelByCode(guidanceStatusCode)}
												</span>
												.
											</p>
										);
									})()}
										{(() => {
											const guidanceStatusCode =
												getVisitIS8LowerStatusGuidanceCode(
													inspectionDatesValidationModalData,
												);

											if (!guidanceStatusCode) {
												return null;
											}

											return (
												<p className="mt-2 text-blue-900 text-sm">
													Dla wybranych pól można ustawić status: {" "}
													<span className="font-semibold">
														{getInspectionStatusLabelByCode(guidanceStatusCode)}
													</span>
													.
												</p>
											);
										})()}
									{(() => {
										if (
											inspectionDatesValidationModalData.kind !== "status-required" ||
											(inspectionDatesValidationModalData.selectedStatusCode !==
												"I_SI_4" &&
												inspectionDatesValidationModalData.selectedStatusCode !==
													"I_SI_6" &&
												inspectionDatesValidationModalData.selectedStatusCode !==
													"I_SI_5" &&
												inspectionDatesValidationModalData.selectedStatusCode !==
													"I_SI_11")
										) {
											return null;
										}

										const extraFieldNumbers =
											inspectionDatesValidationModalData.enteredFieldNumbers.filter(
												(fieldNumber) =>
													!inspectionDatesValidationModalData.expectedFieldNumbers.includes(
														fieldNumber,
													),
											);

										if (extraFieldNumbers.length === 0) {
											return null;
										}

										return (
											<div className="mt-3 border-blue-200 border-t pt-3">
												<p className="font-semibold text-blue-900 text-sm">
													Dodatkowo nie powin{extraFieldNumbers.length === 1 ? "no" : "ny"} być uzupełnione poniższe pola dat:
												</p>
												<ul className="mt-2 list-disc space-y-1 pl-5 text-blue-900 text-sm">
													{extraFieldNumbers.map((fieldNumber) => (
														<li key={`missing-with-extra-is4-${fieldNumber}`}>
															{getInspectionDateFieldLabelForValidation(fieldNumber)}
														</li>
													))}
												</ul>
											</div>
										);
									})()}
									{(() => {
										const guidanceItem = getVisitIS5StatusGuidanceItem(
											inspectionDatesValidationModalData,
										);

										if (!guidanceItem || guidanceItem.missingFieldNumbers.length === 0) {
											return null;
										}

										return (
											<div className="mt-3 border-blue-200 border-t pt-3">
												<p className="mt-2 text-blue-900 text-sm">
													Ewentualnie, jeśli chcesz pozostawić {guidanceItem.extraFieldNumbers.length === 1 ? "to pole" : "te pola"}, uzupełnij {guidanceItem.missingFieldNumbers.length === 1 ? "pole" : "pola"}:
												</p>
												<ul className="mt-1 list-disc space-y-1 pl-5 text-blue-900 text-sm">
													{guidanceItem.missingFieldNumbers.map((fieldNumber) => (
														<li key={`is5-guidance-required-${fieldNumber}`}>
															{getInspectionDateFieldLabelForValidation(fieldNumber)}
														</li>
													))}
												</ul>
												{guidanceItem.statusCode === "I_SI_8" ? (
													<ul className="mt-2 list-disc space-y-1 pl-5 text-blue-900 text-sm">
														<li>{OPTIONAL_ACCEPTANCE_NOTE_VALIDATION_LABEL}</li>
													</ul>
												) : null}
												<p className="mt-2 text-blue-900 text-sm">
													Dla wybranych pól można ustawić status: {" "}
													<span className="font-semibold">
														{getInspectionStatusLabelByCode(guidanceItem.statusCode)}
													</span>
													.
												</p>
											</div>
										);
									})()}
									{(() => {
										const guidanceItem = getControlIS4StatusGuidanceItem(
											inspectionDatesValidationModalData,
										);

										if (!guidanceItem || guidanceItem.missingFieldNumbers.length === 0) {
											return null;
										}

										return (
											<div className="mt-3 border-blue-200 border-t pt-3">
												<p className="mt-2 text-blue-900 text-sm">
													Ewentualnie, jeśli chcesz pozostawić {guidanceItem.extraFieldNumbers.length === 1 ? "to pole" : "te pola"}, uzupełnij {guidanceItem.missingFieldNumbers.length === 1 ? "pole" : "pola"}:
												</p>
												<ul className="mt-1 list-disc space-y-1 pl-5 text-blue-900 text-sm">
													{guidanceItem.missingFieldNumbers.map((fieldNumber) => (
														<li key={`is4-guidance-${fieldNumber}`}>
															{getInspectionDateFieldLabelForValidation(fieldNumber)}
														</li>
													))}
												</ul>
												{guidanceItem.statusCode === "I_SI_8" ? (
													<ul className="mt-2 list-disc space-y-1 pl-5 text-blue-900 text-sm">
														<li>
															{(INSPECTION_DATE_FIELD_LABEL_BY_NUMBER[8] ?? "Pole daty").replace(" (lista)", "")} (opcjonalne dla statusu opracowywanie rekomendacji dalszych dzialan/zalecen.)
														</li>
													</ul>
												) : null}
												<p className="mt-2 text-blue-900 text-sm">
													Dla wybranych pól można ustawić status: {" "}
													<span className="font-semibold">
														{getInspectionStatusLabelByCode(guidanceItem.statusCode)}
													</span>
													.
												</p>
											</div>
										);
									})()}
									{(() => {
										const guidanceItem = getVisitIS11StatusGuidanceItem(
											inspectionDatesValidationModalData,
										);

										if (!guidanceItem || guidanceItem.missingFieldNumbers.length === 0) {
											return null;
										}

										return (
											<div className="mt-3 border-blue-200 border-t pt-3">
												<p className="mt-2 text-blue-900 text-sm">
													Ewentualnie, jeśli chcesz pozostawić {guidanceItem.extraFieldNumbers.length === 1 ? "to pole" : "te pola"}, uzupełnij {guidanceItem.missingFieldNumbers.length === 1 ? "pole" : "pola"}:
												</p>
												<ul className="mt-1 list-disc space-y-1 pl-5 text-blue-900 text-sm">
													{guidanceItem.missingFieldNumbers.map((fieldNumber) => (
														<li key={`is11-guidance-required-${fieldNumber}`}>
															{getInspectionDateFieldLabelForValidation(fieldNumber)}
														</li>
													))}
												</ul>
												{guidanceItem.statusCode === "I_SI_8" ? (
													<ul className="mt-2 list-disc space-y-1 pl-5 text-blue-900 text-sm">
														<li>{OPTIONAL_ACCEPTANCE_NOTE_VALIDATION_LABEL}</li>
													</ul>
												) : null}
												<p className="mt-2 text-blue-900 text-sm">
													Dla wybranych pól można ustawić status: {" "}
													<span className="font-semibold">
														{getInspectionStatusLabelByCode(guidanceItem.statusCode)}
													</span>
													.
												</p>
											</div>
										);
									})()}
											{shouldShowControlIS6ToIS8Guidance(
												inspectionDatesValidationModalData,
											) ? (
												<div className="mt-3 border-blue-200 border-t pt-3">
													{getControlIS6ToIS8MissingFieldNumbers(
														inspectionDatesValidationModalData,
													).length > 0 ? (
														<>
															<p className="mt-2 text-blue-900 text-sm">
																Ewentualnie, jeśli chcesz pozostawić {inspectionDatesValidationModalData.enteredFieldNumbers.length === 1 ? "to pole" : "te pola"}, uzupełnij {getControlIS6ToIS8MissingFieldNumbers(
																	inspectionDatesValidationModalData,
																).length === 1 ? "pole" : "pola"}:
															</p>
															<ul className="mt-1 list-disc space-y-1 pl-5 text-blue-900 text-sm">
																{getControlIS6ToIS8MissingFieldNumbers(
																	inspectionDatesValidationModalData,
																).map((fieldNumber) => (
																	<li key={`is6-to-is8-guidance-${fieldNumber}`}>
																		{getInspectionDateFieldLabelForValidation(fieldNumber)}
																	</li>
																))}
															</ul>
														</>
													) : null}
													<ul className="mt-2 list-disc space-y-1 pl-5 text-blue-900 text-sm">
														<li>
															{(INSPECTION_DATE_FIELD_LABEL_BY_NUMBER[8] ?? "Pole daty").replace(" (lista)", "")} (opcjonalne dla statusu opracowywanie rekomendacji dalszych dzialan/zalecen.)
														</li>
													</ul>
													<p className="mt-2 text-blue-900 text-sm">
														Dla wybranych pól można ustawić status: {" "}
														<span className="font-semibold">
															{getInspectionStatusLabelByCode("I_SI_8")}
														</span>
														.
													</p>
												</div>
											) : null}
									{(() => {
										const guidanceItem = getControlIS6StatusGuidanceItem(
											inspectionDatesValidationModalData,
										);

										if (!guidanceItem || guidanceItem.missingFieldNumbers.length === 0) {
											return null;
										}

										return (
											<div className="mt-3 border-blue-200 border-t pt-3">
												<p className="mt-2 text-blue-900 text-sm">
													Ewentualnie, jeśli chcesz pozostawić {guidanceItem.extraFieldNumbers.length === 1 ? "to pole" : "te pola"}, uzupełnij {guidanceItem.missingFieldNumbers.length === 1 ? "pole" : "pola"}:
												</p>
												<ul className="mt-1 list-disc space-y-1 pl-5 text-blue-900 text-sm">
													{guidanceItem.missingFieldNumbers.map((fieldNumber) => (
														<li key={`is6-guidance-${fieldNumber}`}>
															{getInspectionDateFieldLabelForValidation(fieldNumber)}
														</li>
													))}
												</ul>
												{guidanceItem.statusCode === "I_SI_8" ? (
													<ul className="mt-2 list-disc space-y-1 pl-5 text-blue-900 text-sm">
														<li>
															{(INSPECTION_DATE_FIELD_LABEL_BY_NUMBER[8] ?? "Pole daty").replace(" (lista)", "")} (opcjonalne dla statusu opracowywanie rekomendacji dalszych dzialan/zalecen.)
														</li>
													</ul>
												) : null}
												<p className="mt-2 text-blue-900 text-sm">
													Dla wybranych pól można ustawić status: {" "}
													<span className="font-semibold">
														{getInspectionStatusLabelByCode(guidanceItem.statusCode)}
													</span>
													.
												</p>
											</div>
										);
									})()}
									{(() => {
										const guidanceStatusCode =
											getControlIS6LowerStatusGuidanceCode(
												inspectionDatesValidationModalData,
											);

										if (!guidanceStatusCode) {
											return null;
										}

										return (
											<p className="mt-2 text-blue-900 text-sm">
												Dla wybranych pól można ustawić status: {" "}
												<span className="font-semibold">
													{getInspectionStatusLabelByCode(guidanceStatusCode)}
												</span>
												.
											</p>
										);
									})()}
										{(() => {
											const missingClosedFields =
												getVisitClosedStatusMissingFieldNumbersForIS11(
													inspectionDatesValidationModalData,
												);

											if (missingClosedFields.length === 0) {
												return null;
											}

											return (
												<div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm">
													<p>
														Jeśli zamykasz inspekcję, to w zależności od tego, czy dodano zalecenie oraz wniosek sankcyjny, ustaw status:
													</p>
													<ul className="mt-2 list-disc space-y-1 pl-5">
														<li>
															<strong>Zamknięte - wydano zalecenia</strong>
														</li>
														<li>
															<strong>Zamknięte - brak zaleceń i wniosku sankcyjnego</strong>
														</li>
														<li>
															<strong>Zamknięte - sporządzono wniosek sankcyjny</strong>
														</li>
														<li>
															<strong>Zamknięte - wydano zalecenia i sporządzono wniosek sankcyjny</strong>
														</li>
													</ul>
												</div>
											);
										})()}
										{(() => {
											const missingClosedFields =
												getVisitClosedStatusMissingFieldNumbersForIS5(
													inspectionDatesValidationModalData,
												);

											if (missingClosedFields.length === 0) {
												return null;
											}

											return (
												<div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm">
													<p>
														Jeśli zamykasz inspekcję, to w zależności od tego, czy dodano zalecenie oraz wniosek sankcyjny, ustaw status:
													</p>
													<ul className="mt-2 list-disc space-y-1 pl-5">
														<li>
															<strong>Zamknięte - wydano zalecenia</strong>
														</li>
														<li>
															<strong>Zamknięte - brak zaleceń i wniosku sankcyjnego</strong>
														</li>
														<li>
															<strong>Zamknięte - sporządzono wniosek sankcyjny</strong>
														</li>
														<li>
															<strong>Zamknięte - wydano zalecenia i sporządzono wniosek sankcyjny</strong>
														</li>
													</ul>
												</div>
											);
										})()}
									{(() => {
										const missingClosedFields =
											getControlClosedStatusMissingFieldNumbersForIS4ExtraDates(
												inspectionDatesValidationModalData,
											);

										if (missingClosedFields.length === 0) {
											return null;
										}

										return (
											<div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm">
												<p>
													Jeśli zamykasz inspekcję, to w zależności od tego, czy dodano zalecenie oraz wniosek sankcyjny, ustaw status:
												</p>
												<ul className="mt-2 list-disc space-y-1 pl-5">
													<li>
														<strong>Zamknięte - wydano zalecenia</strong>
													</li>
													<li>
														<strong>Zamknięte - brak zaleceń i wniosku sankcyjnego</strong>
													</li>
													<li>
														<strong>Zamknięte - sporządzono wniosek sankcyjny</strong>
													</li>
													<li>
														<strong>Zamknięte - wydano zalecenia i sporządzono wniosek sankcyjny</strong>
													</li>
												</ul>
											</div>
										);
									})()}
									{(() => {
										const missingClosedFields =
											getVisitClosedStatusMissingFieldNumbersForIS8Required(
												inspectionDatesValidationModalData,
											);

										if (missingClosedFields.length === 0) {
											return null;
										}

										return (
											<div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm">
												<p>
													Jeśli zamykasz inspekcję, to w zależności od tego, czy dodano zalecenie oraz wniosek sankcyjny, ustaw status:
												</p>
												<ul className="mt-2 list-disc space-y-1 pl-5">
													<li>
														<strong>Zamknięte - wydano zalecenia</strong>
													</li>
													<li>
														<strong>Zamknięte - brak zaleceń i wniosku sankcyjnego</strong>
													</li>
													<li>
														<strong>Zamknięte - sporządzono wniosek sankcyjny</strong>
													</li>
													<li>
														<strong>Zamknięte - wydano zalecenia i sporządzono wniosek sankcyjny</strong>
													</li>
												</ul>
											</div>
										);
									})()}
											{hasControlIS6ClosedFieldsCompleted(
												inspectionDatesValidationModalData,
											) ? (
												<div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm">
													<p>
														Jeśli zamykasz inspekcję, to w zależności od tego, czy dodano zalecenie oraz wniosek sankcyjny, ustaw status:
													</p>
													<ul className="mt-2 list-disc space-y-1 pl-5">
														<li>
															<strong>Zamknięte - wydano zalecenia</strong>
														</li>
														<li>
															<strong>Zamknięte - brak zaleceń i wniosku sankcyjnego</strong>
														</li>
														<li>
															<strong>Zamknięte - sporządzono wniosek sankcyjny</strong>
														</li>
														<li>
															<strong>Zamknięte - wydano zalecenia i sporządzono wniosek sankcyjny</strong>
														</li>
													</ul>
												</div>
											) : null}
									{(() => {
										const missingClosedFields =
											getControlClosedStatusMissingFieldNumbersForIS6ExtraDates(
												inspectionDatesValidationModalData,
											);

										if (missingClosedFields.length === 0) {
											return null;
										}

										return (
											<div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm">
												<p>
													Jeśli zamykasz inspekcję, to w zależności od tego, czy dodano zalecenie oraz wniosek sankcyjny, ustaw status:
												</p>
												<ul className="mt-2 list-disc space-y-1 pl-5">
													<li>
														<strong>Zamknięte - wydano zalecenia</strong>
													</li>
													<li>
														<strong>Zamknięte - brak zaleceń i wniosku sankcyjnego</strong>
													</li>
													<li>
														<strong>Zamknięte - sporządzono wniosek sankcyjny</strong>
													</li>
													<li>
														<strong>Zamknięte - wydano zalecenia i sporządzono wniosek sankcyjny</strong>
													</li>
												</ul>
											</div>
										);
									})()}
									{(() => {
										const missingClosedFields =
											getControlClosedStatusMissingFieldNumbersForIS8Required(
												inspectionDatesValidationModalData,
											);

										if (missingClosedFields.length === 0) {
											return null;
										}

										return (
											<div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm">
												<p>
													Jeśli zamykasz inspekcję, to w zależności od tego, czy dodano zalecenie oraz wniosek sankcyjny, ustaw status:
												</p>
												<ul className="mt-2 list-disc space-y-1 pl-5">
													<li>
														<strong>Zamknięte - wydano zalecenia</strong>
													</li>
													<li>
														<strong>Zamknięte - brak zaleceń i wniosku sankcyjnego</strong>
													</li>
													<li>
														<strong>Zamknięte - sporządzono wniosek sankcyjny</strong>
													</li>
													<li>
														<strong>Zamknięte - wydano zalecenia i sporządzono wniosek sankcyjny</strong>
													</li>
												</ul>
											</div>
										);
									})()}
									{getOptionalFieldNumberForStatusIS8(
										inspectionDatesValidationModalData,
									) && inspectionDatesValidationModalData.kind !== "status-required" ? (
										<ul className="mt-2 list-disc space-y-1 pl-5 marker:text-blue-900 text-blue-900 text-sm">
											<li>
												{INSPECTION_DATE_FIELD_LABEL_BY_NUMBER[
													getOptionalFieldNumberForStatusIS8(
														inspectionDatesValidationModalData,
													) as number
												] ?? "Pole daty"} <span className="italic">(opcjonalne dla statusu opracowywanie rekomendacji dalszych dzialan/zalecen.)</span>
											</li>
										</ul>
									) : null}
								</>
							)}
						</div>

						{shouldShowClosedStatusGuidance(
								inspectionDatesValidationModalData,
							) ? (
								<div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 text-sm">
									<p>
										Jeśli zamykasz inspekcję, to w zależności od tego, czy dodano zalecenie oraz wniosek sankcyjny, ustaw status:
									</p>
									<ul className="mt-2 list-disc space-y-1 pl-5">
										<li>
											<strong>Zamknięte - wydano zalecenia</strong>
										</li>
										<li>
											<strong>Zamknięte - brak zaleceń i wniosku sankcyjnego</strong>
										</li>
										<li>
											<strong>Zamknięte - sporządzono wniosek sankcyjny</strong>
										</li>
										<li>
											<strong>Zamknięte - wydano zalecenia i sporządzono wniosek sankcyjny</strong>
										</li>
									</ul>
								</div>
							) : null}

						<div className="mt-5 flex items-center justify-end gap-2">
							<button
								type="button"
								onClick={() => setInspectionDatesValidationModalData(null)}
								className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 font-semibold text-slate-700 text-sm transition-colors hover:bg-slate-100"
							>
								Anuluj
							</button>
							<button
								type="button"
								onClick={() => {
									void handleAddInspection(undefined, {
										skipDatesValidation: true,
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

			{isStatusValidationModalOpen ? (
				<div className="fixed inset-0 z-60 flex items-center justify-center p-4">
					<button
						type="button"
						aria-label="Zamknij okno walidacji statusu"
						className="absolute inset-0 bg-slate-950/65"
						onClick={() => setIsStatusValidationModalOpen(false)}
					/>

					<div
						role="dialog"
						aria-modal="true"
						aria-label="Walidacja statusu inspekcji"
						className="relative z-10 w-full max-w-2xl rounded-2xl border border-slate-300 bg-white p-5 text-slate-900 shadow-[0_24px_56px_rgba(2,8,23,0.35)]"
					>
						<h3 className="font-semibold text-base text-slate-900">
							Nie można zapisać inspekcji z tym statusem
						</h3>
						{selectedStatusForValidation ? (
							<p className="mt-2 text-slate-800 text-sm">
								Status: <span className="font-semibold">{selectedStatusForValidation}</span>
							</p>
						) : null}

						<div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3">
							<p className="font-semibold text-rose-700 text-sm">Naruszenia:</p>
							<ul className="mt-2 list-disc space-y-1 pl-5 text-rose-800 text-sm">
								{statusValidationViolations.map((violation, index) => (
									<li
										key={`${String(violation.violationCodeId)}-${violation.message}-${index}`}
									>
										{violation.message}
									</li>
								))}
							</ul>
						</div>

						<div className="mt-5 flex items-center justify-end gap-2">
							<button
								type="button"
								onClick={() => setIsStatusValidationModalOpen(false)}
								className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 font-semibold text-slate-700 text-sm transition-colors hover:bg-slate-100"
							>
								Wróć do formularza
							</button>
						</div>
					</div>
				</div>
			) : null}
			</TableFullscreenContainer>
		</>
	);
}

