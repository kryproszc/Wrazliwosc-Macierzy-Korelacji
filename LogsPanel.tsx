"use client";

import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TableAdvancedFilterModal } from "@/shared/components/table/TableAdvancedFilterModal";
import { TablePagination } from "@/shared/components/table/TablePagination";
import { TableSurface } from "@/shared/components/table/TableSurface";

import {
	fetchAuditLog,
	fetchAuditLogFilterOptions,
	type AuditLogFilters,
	type AuditLogItem,
	type AuditLogAkcja,
	type AuditLogRejestr,
} from "@/features/logs/api";
import { DateInputWithCalendar } from "@/shared/components/forms/DateInputWithCalendar";
import {
	fetchScheduleDispatches,
	fetchScheduleDispatchesKpi,
	fetchSchedules,
} from "@/features/schedules/api";
import type {
	Schedule,
	ScheduleDispatch,
	ScheduleDispatchFilters,
	ScheduleDispatchKpi,
} from "@/features/schedules/types";
import type { AuthRole } from "@/app/_components/home-tabs/types";

type LogsView = "registers" | "schedules";
type AuditAdvancedFilterColumn =
	| "uzytkownik"
	| "akcja"
	| "pole"
	| "rejestr"
	| "id_rejestru";

const VIEW_OPTIONS: Array<{ id: LogsView; label: string }> = [
	{ id: "registers", label: "Rejestry" },
	{ id: "schedules", label: "Harmonogramy" },
];

const AUDIT_FILTER_OPTIONS_PAGE_SIZE = 10;

const AUDIT_PAGE_SIZE_OPTIONS = [20, 30, 50, 70, 100] as const;

const DEFAULT_AUDIT_FILTERS: AuditLogFilters = { limit: 30 };

type PaginationItem = number | "ellipsis";

function createRange(start: number, end: number) {
	const length = end - start + 1;
	return Array.from({ length }, (_, index) => index + start);
}

function buildPaginationItems(
	currentPage: number,
	totalPages: number,
	siblingCount = 1,
): PaginationItem[] {
	const totalPageNumbers = siblingCount + 5;

	if (totalPageNumbers >= totalPages) {
		return createRange(1, totalPages);
	}

	const leftSiblingIndex = Math.max(currentPage - siblingCount, 1);
	const rightSiblingIndex = Math.min(currentPage + siblingCount, totalPages);

	const shouldShowLeftDots = leftSiblingIndex > 2;
	const shouldShowRightDots = rightSiblingIndex < totalPages - 2;

	if (!shouldShowLeftDots && shouldShowRightDots) {
		const leftItemCount = 3 + 2 * siblingCount;
		const leftRange = createRange(1, leftItemCount);
		return [...leftRange, "ellipsis", totalPages];
	}

	if (shouldShowLeftDots && !shouldShowRightDots) {
		const rightItemCount = 3 + 2 * siblingCount;
		const rightRange = createRange(totalPages - rightItemCount + 1, totalPages);
		return [1, "ellipsis", ...rightRange];
	}

	if (shouldShowLeftDots && shouldShowRightDots) {
		const middleRange = createRange(leftSiblingIndex, rightSiblingIndex);
		return [1, "ellipsis", ...middleRange, "ellipsis", totalPages];
	}

	return createRange(1, totalPages);
}

const AUDIT_ADVANCED_FILTER_LABELS: Record<AuditAdvancedFilterColumn, string> = {
	uzytkownik: "Użytkownik",
	akcja: "Akcja",
	pole: "Pozycja",
	rejestr: "Rejestr",
	id_rejestru: "Id rekordu",
};

const AUDIT_AKCJA_LABEL_BY_VALUE: Record<AuditLogAkcja, string> = {
	CREATE: "Utworzenie",
	UPDATE: "Edycja",
	DELETE: "Usunięcie",
};

const AUDIT_AKCJA_VALUE_BY_LABEL: Record<string, AuditLogAkcja> = Object.entries(
	AUDIT_AKCJA_LABEL_BY_VALUE,
).reduce(
	(acc, [value, label]) => {
		acc[label] = value as AuditLogAkcja;
		return acc;
	},
	{} as Record<string, AuditLogAkcja>,
);

const AUDIT_REJESTR_LABEL_BY_VALUE: Record<AuditLogRejestr, string> = {
	inspekcje: "Inspekcje",
	zalecenia: "Zalecenia",
	decyzje: "Decyzje",
	wnioski_sankcyjne: "Wnioski sankcyjne",
};

const AUDIT_REJESTR_VALUE_BY_LABEL: Record<string, AuditLogRejestr> = Object.entries(
	AUDIT_REJESTR_LABEL_BY_VALUE,
).reduce(
	(acc, [value, label]) => {
		acc[label] = value as AuditLogRejestr;
		return acc;
	},
	{} as Record<string, AuditLogRejestr>,
);

function normalizeAuditRejestrValue(value: string) {
	return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function toAuditRejestrLabel(value: string) {
	const normalized = normalizeAuditRejestrValue(value);
	const mapped = AUDIT_REJESTR_LABEL_BY_VALUE[normalized as AuditLogRejestr];

	if (mapped) {
		return mapped;
	}

	return value
		.replace(/_/g, " ")
		.trim()
		.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function formatAuditDate(value: string) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return new Intl.DateTimeFormat("pl-PL", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	}).format(date);
}

function toIsoDate(value: Date) {
	const year = value.getFullYear();
	const month = String(value.getMonth() + 1).padStart(2, "0");
	const day = String(value.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function AuditActionBadge({ akcja }: { akcja: AuditLogAkcja }) {
	if (akcja === "CREATE") {
		return <>Utworzono</>;
	}
	if (akcja === "DELETE") {
		return <>Usunięto</>;
	}
	return <>Edycja</>;
}

function RejestrBadge({ rejestr }: { rejestr: string }) {
	return <>{toAuditRejestrLabel(rejestr)}</>;
}

function normalizeAuditMatchText(value: string) {
	return value
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.trim()
		.toLowerCase();
}

function isAuditNoDateFlagField(fieldName: string | null) {
	if (!fieldName) {
		return false;
	}

	const normalized = normalizeAuditMatchText(fieldName);
	return normalized.includes("brak dat");
}

function isAuditDateLikeField(fieldName: string | null) {
	if (!fieldName) {
		return false;
	}

	const normalized = normalizeAuditMatchText(fieldName);
	return normalized.includes("data") || normalized.includes("termin");
}

function parseAuditDateList(value: string) {
	const normalized = value.trim();
	if (!normalized.startsWith("[") || !normalized.endsWith("]")) {
		return [] as string[];
	}

	try {
		const parsed = JSON.parse(normalized);
		if (!Array.isArray(parsed)) {
			return [];
		}

		return parsed
			.map((item) => String(item ?? "").trim())
			.filter(Boolean);
	} catch {
		return [];
	}
}

function formatAuditChangeValue(fieldName: string | null, value: string | null) {
	const text = String(value ?? "").trim();
	if (!text) {
		return "-";
	}

	const normalized = normalizeAuditMatchText(text);

	if (isAuditNoDateFlagField(fieldName)) {
		if (["1", "true", "tak"].includes(normalized)) {
			return "Brak";
		}

		if (["0", "false", "nie"].includes(normalized)) {
			return "-";
		}
	}

	if (isAuditDateLikeField(fieldName)) {
		if (
			normalized === "brak" ||
			normalized === "brak daty" ||
			normalized === "brak dat" ||
			normalized === "brak terminu" ||
			normalized === "brak terminow"
		) {
			return "Brak";
		}

		if (["0", "false"].includes(normalized)) {
			return "-";
		}

		if (["1", "true"].includes(normalized)) {
			return "Brak";
		}

		const parsedList = parseAuditDateList(text);
		if (parsedList.length > 0) {
			return parsedList.join(", ");
		}
	}

	return text;
}



function getDispatchStatusBadge(status: string) {
	if (status === "sent") {
		return "rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 text-xs";
	}

	if (status === "failed") {
		return "rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 font-medium text-rose-700 text-xs";
	}

	return "rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 font-medium text-slate-700 text-xs";
}

const SCHEDULE_MODULE_LABEL_BY_VALUE: Record<string, string> = {
	inspections: "Inspekcje",
	recommendations: "Zalecenia",
	obligating_decisions: "Decyzje",
	sanction_requests: "Wnioski sankcyjne",
};

const SCHEDULE_RECIPIENT_TYPE_LABEL_BY_VALUE: Record<string, string> = {
	inspection_leader: "Kierujący",
	inspection_team: "Skład zespołu",
	inspection_leader_team: "Kierujący i skład zespołu",
	author: "Autor",
};

const SCHEDULE_STATUS_LABEL_BY_VALUE: Record<string, string> = {
	sent: "Wysłane",
	failed: "Błędne",
};

function toScheduleModuleLabel(value: string) {
	const normalized = value.trim().toLowerCase();
	return SCHEDULE_MODULE_LABEL_BY_VALUE[normalized] ?? value;
}

function toScheduleRecipientTypeLabel(value: string) {
	const normalized = value.trim().toLowerCase();
	return SCHEDULE_RECIPIENT_TYPE_LABEL_BY_VALUE[normalized] ?? value;
}

function toScheduleStatusLabel(value: string) {
	const normalized = value.trim().toLowerCase();
	return SCHEDULE_STATUS_LABEL_BY_VALUE[normalized] ?? value;
}

const DEFAULT_FILTERS: ScheduleDispatchFilters = {
	limit: 100,
	period: "all",
};

type ScheduleColumnFilterKey =
	| "date"
	| "schedule"
	| "module"
	| "inspectionId"
	| "recommendationId"
	| "sanctionRequestId"
	| "recipientType"
	| "recipientEmail"
	| "status";

type ScheduleColumnFilters = Record<ScheduleColumnFilterKey, string[]>;

const SCHEDULE_ADVANCED_FILTER_LABELS: Record<ScheduleColumnFilterKey, string> = {
	date: "Data",
	schedule: "Harmonogram",
	module: "Moduł",
	inspectionId: "ID inspekcji",
	recommendationId: "ID zalecenia",
	sanctionRequestId: "ID wniosku",
	recipientType: "Do kogo (typ)",
	recipientEmail: "Do kogo (osoba)",
	status: "Status",
};

const DEFAULT_SCHEDULE_COLUMN_FILTERS: ScheduleColumnFilters = {
	date: [],
	schedule: [],
	module: [],
	inspectionId: [],
	recommendationId: [],
	sanctionRequestId: [],
	recipientType: [],
	recipientEmail: [],
	status: [],
};

const SCHEDULES_PAGE_SIZE_OPTIONS = [20, 30, 50, 70, 100] as const;
const DEFAULT_SCHEDULES_PAGE_SIZE = 30;

const LOGS_PANEL_STATE_KEY = "logs-panel-state-v1";
const DASHBOARD_OPEN_INSPECTION_EVENT = "dashboard:open-inspection";
const DASHBOARD_OPEN_INSPECTION_CODE_KEY = "triangle.dashboard.openInspectionCode";
const DASHBOARD_OPEN_RECOMMENDATION_EVENT = "dashboard:open-recommendation";
const DASHBOARD_OPEN_RECOMMENDATION_CODE_KEY =
	"triangle.dashboard.openRecommendationCode";

type PersistedLogsPanelState = {
	activeView?: LogsView;
	draftAuditFilters?: AuditLogFilters;
	appliedAuditFilters?: AuditLogFilters;
	auditOffset?: number;
	auditQuickRange?: "all" | "week" | "month" | "year";
	draftFilters?: ScheduleDispatchFilters;
	appliedFilters?: ScheduleDispatchFilters;
	scheduleSearch?: string;
	selectedScheduleIds?: number[];
	schedulePageSize?: number;
};

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

type LogsPanelProps = {
	operatorLogin: string;
	authRole: AuthRole;
};

export function LogsPanel({ operatorLogin, authRole }: LogsPanelProps) {
	const canViewScheduleLogs = authRole !== "team_lead";
	const visibleViewOptions = useMemo(
		() =>
			canViewScheduleLogs
				? VIEW_OPTIONS
				: VIEW_OPTIONS.filter((option) => option.id !== "schedules"),
		[canViewScheduleLogs],
	);
	const [activeView, setActiveView] = useState<LogsView>("registers");
	const [isFiltersHydrated, setIsFiltersHydrated] = useState(false);
	const [isViewSwitching, setIsViewSwitching] = useState(false);
	const [viewSwitchStartedAt, setViewSwitchStartedAt] = useState<number | null>(null);

	// ── Audit log state ────────────────────────────────────────────────────
	const [auditItems, setAuditItems] = useState<AuditLogItem[]>([]);
	const [auditTotal, setAuditTotal] = useState(0);
	const [auditOffset, setAuditOffset] = useState(0);
	const [isLoadingAudit, setIsLoadingAudit] = useState(false);
	const [auditError, setAuditError] = useState<string | null>(null);
	const [draftAuditFilters, setDraftAuditFilters] =
		useState<AuditLogFilters>(DEFAULT_AUDIT_FILTERS);
	const [appliedAuditFilters, setAppliedAuditFilters] =
		useState<AuditLogFilters>(DEFAULT_AUDIT_FILTERS);
	const [auditQuickRange, setAuditQuickRange] = useState<
		"all" | "week" | "month" | "year"
	>("all");
	const [isAuditAdvancedFilterModalOpen, setIsAuditAdvancedFilterModalOpen] =
		useState(false);
	const [isAuditDateFilterModalOpen, setIsAuditDateFilterModalOpen] =
		useState(false);
	const [auditAdvancedFilterColumn, setAuditAdvancedFilterColumn] =
		useState<AuditAdvancedFilterColumn>("uzytkownik");
	const [auditAdvancedFilterSearch, setAuditAdvancedFilterSearch] = useState("");
	const [auditDateFilterFrom, setAuditDateFilterFrom] = useState("");
	const [auditDateFilterTo, setAuditDateFilterTo] = useState("");
	const [auditAdvancedFilterValues, setAuditAdvancedFilterValues] = useState<string[]>(
		[],
	);
	const [auditAdvancedFilterOffset, setAuditAdvancedFilterOffset] = useState(0);
	const [hasMoreAuditAdvancedFilterValues, setHasMoreAuditAdvancedFilterValues] =
		useState(false);
	const [isLoadingAuditAdvancedFilterValues, setIsLoadingAuditAdvancedFilterValues] =
		useState(false);
	const [auditAdvancedFilterAnchor, setAuditAdvancedFilterAnchor] = useState({
		top: 0,
		left: 0,
	});
	const [auditDateFilterAnchor, setAuditDateFilterAnchor] = useState({
		top: 0,
		left: 0,
	});

	// ── Schedules state ────────────────────────────────────────────────────
	const [isLoadingSchedules, setIsLoadingSchedules] = useState(false);
	const [schedulesError, setSchedulesError] = useState<string | null>(null);
	const [schedules, setSchedules] = useState<Schedule[]>([]);
	const [selectedScheduleIds, setSelectedScheduleIds] = useState<number[]>([]);
	const [dispatches, setDispatches] = useState<ScheduleDispatch[]>([]);
	const [isLoadingDispatches, setIsLoadingDispatches] = useState(false);
	const [dispatchesError, setDispatchesError] = useState<string | null>(null);
	const [kpi, setKpi] = useState<ScheduleDispatchKpi | null>(null);
	const [isLoadingKpi, setIsLoadingKpi] = useState(false);
	const [kpiError, setKpiError] = useState<string | null>(null);
	const [draftFilters, setDraftFilters] =
		useState<ScheduleDispatchFilters>(DEFAULT_FILTERS);
	const [appliedFilters, setAppliedFilters] =
		useState<ScheduleDispatchFilters>(DEFAULT_FILTERS);
	const [scheduleSearch, setScheduleSearch] = useState("");
	const [scheduleCurrentPage, setScheduleCurrentPage] = useState(1);
	const [schedulePageSize, setSchedulePageSize] = useState<number>(
		DEFAULT_SCHEDULES_PAGE_SIZE,
	);
	const [scheduleColumnFilters, setScheduleColumnFilters] =
		useState<ScheduleColumnFilters>(DEFAULT_SCHEDULE_COLUMN_FILTERS);
	const [isScheduleAdvancedFilterModalOpen, setIsScheduleAdvancedFilterModalOpen] =
		useState(false);
	const [scheduleAdvancedFilterColumn, setScheduleAdvancedFilterColumn] =
		useState<ScheduleColumnFilterKey>("date");
	const [scheduleAdvancedFilterSearch, setScheduleAdvancedFilterSearch] =
		useState("");
	const [scheduleAdvancedFilterAnchor, setScheduleAdvancedFilterAnchor] = useState({
		top: 0,
		left: 0,
	});
	const [isScheduleDateFilterModalOpen, setIsScheduleDateFilterModalOpen] =
		useState(false);
	const [scheduleDateFilterFrom, setScheduleDateFilterFrom] = useState("");
	const [scheduleDateFilterTo, setScheduleDateFilterTo] = useState("");
	const [scheduleDateFilterAnchor, setScheduleDateFilterAnchor] = useState({
		top: 0,
		left: 0,
	});

	useEffect(() => {
		if (typeof window === "undefined") {
			setIsFiltersHydrated(true);
			return;
		}

		try {
			const raw = window.sessionStorage.getItem(LOGS_PANEL_STATE_KEY);
			if (!raw) {
				setIsFiltersHydrated(true);
				return;
			}

			const parsed = JSON.parse(raw) as PersistedLogsPanelState;
			if (parsed.activeView === "registers" || parsed.activeView === "schedules") {
				setActiveView(parsed.activeView);
			}

			if (parsed.draftAuditFilters && typeof parsed.draftAuditFilters === "object") {
				setDraftAuditFilters(parsed.draftAuditFilters);
			}

			if (
				parsed.appliedAuditFilters &&
				typeof parsed.appliedAuditFilters === "object"
			) {
				setAppliedAuditFilters(parsed.appliedAuditFilters);
			}

			if (typeof parsed.auditOffset === "number" && Number.isFinite(parsed.auditOffset)) {
				setAuditOffset(Math.max(0, Math.trunc(parsed.auditOffset)));
			}

			if (
				parsed.auditQuickRange === "all" ||
				parsed.auditQuickRange === "week" ||
				parsed.auditQuickRange === "month" ||
				parsed.auditQuickRange === "year"
			) {
				setAuditQuickRange(parsed.auditQuickRange);
			}

			if (parsed.draftFilters && typeof parsed.draftFilters === "object") {
				setDraftFilters(parsed.draftFilters);
			}

			if (parsed.appliedFilters && typeof parsed.appliedFilters === "object") {
				setAppliedFilters(parsed.appliedFilters);
			}

			if (typeof parsed.scheduleSearch === "string") {
				setScheduleSearch(parsed.scheduleSearch);
			}

			if (Array.isArray(parsed.selectedScheduleIds)) {
				setSelectedScheduleIds(
					parsed.selectedScheduleIds.filter(
						(item): item is number => typeof item === "number" && Number.isFinite(item),
					),
				);
			}

			if (
				typeof parsed.schedulePageSize === "number" &&
				SCHEDULES_PAGE_SIZE_OPTIONS.includes(
					parsed.schedulePageSize as (typeof SCHEDULES_PAGE_SIZE_OPTIONS)[number],
				)
			) {
				setSchedulePageSize(parsed.schedulePageSize);
			}
		} catch {
			// Ignore corrupted persisted state and continue with defaults.
		} finally {
			setIsFiltersHydrated(true);
		}
	}, []);

	useEffect(() => {
		if (!canViewScheduleLogs && activeView === "schedules") {
			setActiveView("registers");
		}
	}, [activeView, canViewScheduleLogs]);

	useEffect(() => {
		if (!isFiltersHydrated || typeof window === "undefined") {
			return;
		}

		const payload: PersistedLogsPanelState = {
			activeView,
			draftAuditFilters,
			appliedAuditFilters,
			auditOffset,
			auditQuickRange,
			draftFilters,
			appliedFilters,
			scheduleSearch,
			selectedScheduleIds,
			schedulePageSize,
		};

		window.sessionStorage.setItem(LOGS_PANEL_STATE_KEY, JSON.stringify(payload));
	}, [
		activeView,
		auditOffset,
		auditQuickRange,
		appliedAuditFilters,
		appliedFilters,
		draftAuditFilters,
		draftFilters,
		isFiltersHydrated,
		schedulePageSize,
		scheduleSearch,
		selectedScheduleIds,
	]);

	// ── Audit log load ─────────────────────────────────────────────────────
	const loadAuditLog = useCallback(
		async (filters: AuditLogFilters, offset: number) => {
			setIsLoadingAudit(true);
			setAuditError(null);
			const result = await fetchAuditLog(operatorLogin, { ...filters, offset });
			if (!result.ok) {
				setAuditError(result.error);
				setIsLoadingAudit(false);
				return;
			}
			setAuditItems(result.items);
			setAuditTotal(result.total);
			setAuditOffset(result.offset);
			setIsLoadingAudit(false);
		},
		[operatorLogin],
	);

	useEffect(() => {
		if (!isFiltersHydrated) {
			return;
		}

		if (activeView !== "registers") return;
		void loadAuditLog(appliedAuditFilters, auditOffset);
		// Only re-run when filters or view changes; NOT when auditOffset changes
		// (page nav calls loadAuditLog directly)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [activeView, appliedAuditFilters, isFiltersHydrated, loadAuditLog]);

	const auditLimit = appliedAuditFilters.limit ?? DEFAULT_AUDIT_FILTERS.limit ?? 30;
	const auditTotalPages = Math.max(1, Math.ceil(auditTotal / auditLimit));
	const auditCurrentPage = Math.floor(auditOffset / auditLimit) + 1;
	const auditPaginationItems = useMemo(
		() => buildPaginationItems(auditCurrentPage, auditTotalPages),
		[auditCurrentPage, auditTotalPages],
	);

	const handleAuditDraftFiltersChange = (
		nextDraft: AuditLogFilters,
		options?: { applyImmediately?: boolean },
	) => {
		setDraftAuditFilters(nextDraft);
		if (options?.applyImmediately) {
			const nextApplied: AuditLogFilters = {
				...nextDraft,
				limit:
					typeof nextDraft.limit === "number"
						? Math.max(1, Math.min(1000, Math.trunc(nextDraft.limit)))
						: DEFAULT_AUDIT_FILTERS.limit,
			};
			setAppliedAuditFilters(nextApplied);
			setAuditOffset(0);
		}
	};

	const handleAuditPageSizeChange = (nextPageSize: number) => {
		if (
			!AUDIT_PAGE_SIZE_OPTIONS.includes(
				nextPageSize as (typeof AUDIT_PAGE_SIZE_OPTIONS)[number],
			)
		) {
			return;
		}

		handleAuditDraftFiltersChange(
			{
				...draftAuditFilters,
				limit: nextPageSize,
			},
			{ applyImmediately: true },
		);
	};


	const handleAuditResetFilters = () => {
		setDraftAuditFilters(DEFAULT_AUDIT_FILTERS);
		setAppliedAuditFilters(DEFAULT_AUDIT_FILTERS);
		setAuditOffset(0);
		setAuditQuickRange("all");
		void loadAuditLog(DEFAULT_AUDIT_FILTERS, 0);
	};

	const handleAuditQuickDateRange = (range: "all" | "week" | "month" | "year") => {
		setAuditQuickRange(range);

		if (range === "all") {
			handleAuditResetFilters();
			return;
		}

		const now = new Date();
		const to = new Date(now);
		const from = new Date(now);

		if (range === "week") {
			from.setDate(from.getDate() - 6);
		} else if (range === "month") {
			from.setDate(from.getDate() - 29);
		} else {
			from.setDate(from.getDate() - 364);
		}

		const next: AuditLogFilters = {
			...draftAuditFilters,
			data_od: toIsoDate(from),
			data_do: toIsoDate(to),
			limit:
				typeof draftAuditFilters.limit === "number"
					? Math.max(1, Math.min(1000, Math.trunc(draftAuditFilters.limit)))
					: DEFAULT_AUDIT_FILTERS.limit,
		};

		setDraftAuditFilters(next);
		setAppliedAuditFilters(next);
		setAuditOffset(0);
		void loadAuditLog(next, 0);
	};

	const handleAuditPageChange = (newPage: number) => {
		const newOffset = (newPage - 1) * auditLimit;
		setAuditOffset(newOffset);
		void loadAuditLog(appliedAuditFilters, newOffset);
	};

	const isAuditColumnFilterActive = (column: AuditAdvancedFilterColumn) => {
		const value = draftAuditFilters[column];
		if (Array.isArray(value)) {
			return value.some((item) => item.trim().length > 0);
		}

		return typeof value === "string" && value.trim().length > 0;
	};

	const isAuditDateRangeFilterActive =
		(draftAuditFilters.data_od ?? "").trim().length > 0 ||
		(draftAuditFilters.data_do ?? "").trim().length > 0;

	const hasActiveAuditFilters = useMemo(() => {
		const hasValue = (value: unknown) => {
			if (Array.isArray(value)) {
				return value.some((item) => String(item ?? "").trim().length > 0);
			}

			if (typeof value === "string") {
				return value.trim().length > 0;
			}

			return false;
		};

		return (
			hasValue(draftAuditFilters.uzytkownik) ||
			hasValue(draftAuditFilters.akcja) ||
			hasValue(draftAuditFilters.pole) ||
			hasValue(draftAuditFilters.rejestr) ||
			hasValue(draftAuditFilters.id_rejestru) ||
			(draftAuditFilters.data_od ?? "").trim().length > 0 ||
			(draftAuditFilters.data_do ?? "").trim().length > 0
		);
	}, [draftAuditFilters]);

	const handleOpenAuditRecordFromLogs = useCallback((item: AuditLogItem) => {
		const recordCode = item.rekord_kod.trim();
		if (!recordCode) {
			return;
		}

		if (item.rejestr === "inspekcje") {
			openInspectionFromDashboard(recordCode);
			return;
		}

		if (item.rejestr === "zalecenia") {
			openRecommendationFromDashboard(recordCode);
		}
	}, []);

	const localAuditAdvancedFilterValuesByColumn = useMemo(() => {
		const toUniqueSortedValues = (values: string[]) =>
			Array.from(new Set(values.filter(Boolean))).sort((left, right) =>
				left.localeCompare(right, "pl", { sensitivity: "base", numeric: true }),
			);

		return {
			uzytkownik: toUniqueSortedValues(auditItems.map((item) => item.uzytkownik)),
			akcja: toUniqueSortedValues(
				auditItems.map((item) => AUDIT_AKCJA_LABEL_BY_VALUE[item.akcja] ?? item.akcja),
			),
			pole: toUniqueSortedValues(auditItems.map((item) => item.pole ?? "")),
			rejestr: toUniqueSortedValues(
				auditItems.map((item) => toAuditRejestrLabel(item.rejestr)),
			),
			id_rejestru: toUniqueSortedValues(auditItems.map((item) => item.rekord_kod ?? "")),
		};
	}, [auditItems]);

	const selectedAuditAdvancedFilterValues = useMemo(() => {
		const value = draftAuditFilters[auditAdvancedFilterColumn];
		const values = Array.isArray(value)
			? value.map((item) => item.trim()).filter(Boolean)
			: typeof value === "string" && value.trim()
				? [value.trim()]
				: [];

		if (auditAdvancedFilterColumn === "akcja") {
			return values.map((item) =>
				AUDIT_AKCJA_LABEL_BY_VALUE[item as AuditLogAkcja] ?? item,
			);
		}

		if (auditAdvancedFilterColumn === "rejestr") {
			return values.map((item) => toAuditRejestrLabel(item));
		}

		return values;
	}, [auditAdvancedFilterColumn, draftAuditFilters]);

	const loadAuditAdvancedFilterValues = useCallback(
		async (
			column: AuditAdvancedFilterColumn,
			offset: number,
			mode: "replace" | "append" = "replace",
		) => {
			setIsLoadingAuditAdvancedFilterValues(true);

			const contextFilters: AuditLogFilters = {
				...appliedAuditFilters,
				limit: undefined,
				offset: undefined,
			};
			delete contextFilters[column];

			const result = await fetchAuditLogFilterOptions(
				operatorLogin,
				column,
				contextFilters,
				{ limit: AUDIT_FILTER_OPTIONS_PAGE_SIZE, offset },
			);

			const localFallbackValues = localAuditAdvancedFilterValuesByColumn[column] ?? [];

			if (!result.ok) {
				if (mode === "replace") {
					setAuditAdvancedFilterValues(localFallbackValues);
					setAuditAdvancedFilterOffset(0);
					setHasMoreAuditAdvancedFilterValues(false);
				}
				setIsLoadingAuditAdvancedFilterValues(false);
				return;
			}

			const normalizedValues =
				column === "akcja"
					? result.values.map(
							(value) => AUDIT_AKCJA_LABEL_BY_VALUE[value as AuditLogAkcja] ?? value,
						)
					: column === "rejestr"
						? result.values.map((value) => toAuditRejestrLabel(value))
						: result.values;

			const safeValues =
				mode === "replace" && normalizedValues.length === 0
					? localFallbackValues
					: normalizedValues;

			if (mode === "replace") {
				setAuditAdvancedFilterValues(safeValues);
			} else {
				setAuditAdvancedFilterValues((previous) =>
					Array.from(new Set([...previous, ...safeValues])),
				);
			}

			setAuditAdvancedFilterOffset(offset);
			setHasMoreAuditAdvancedFilterValues(result.hasMore);
			setIsLoadingAuditAdvancedFilterValues(false);
		},
		[appliedAuditFilters, localAuditAdvancedFilterValuesByColumn, operatorLogin],
	);

	const visibleAuditAdvancedFilterValues = useMemo(() => {
		const sourceValues = auditAdvancedFilterValues;
		const trimmedSearch = auditAdvancedFilterSearch.trim();
		const normalizedSearch = trimmedSearch.toLowerCase();

		if (!normalizedSearch) {
			return sourceValues;
		}

		const filteredValues = sourceValues.filter((value) =>
			value.toLowerCase().includes(normalizedSearch),
		);

		// Allow applying an explicit value even if option lookup did not return it yet.
		const hasExactValue = sourceValues.some(
			(value) => value.toLowerCase() === normalizedSearch,
		);

		if (hasExactValue) {
			return filteredValues;
		}

		return [trimmedSearch, ...filteredValues];
	}, [
		auditAdvancedFilterValues,
		auditAdvancedFilterSearch,
	]);

	const setAuditFilterValues = (
		column: AuditAdvancedFilterColumn,
		values: string[],
	) => {
		const normalizedUniqueValues = Array.from(
			new Set(values.map((item) => item.trim()).filter(Boolean)),
		);

		const mappedValues =
			column === "akcja"
				? normalizedUniqueValues.map(
						(item) => AUDIT_AKCJA_VALUE_BY_LABEL[item] ?? item,
					)
				: column === "rejestr"
					? normalizedUniqueValues.map(
							(item) =>
								AUDIT_REJESTR_VALUE_BY_LABEL[item] ?? normalizeAuditRejestrValue(item),
						)
					: normalizedUniqueValues;

		const normalizedValue = mappedValues.length > 0 ? mappedValues : undefined;

		handleAuditDraftFiltersChange({
			...draftAuditFilters,
			[column]: normalizedValue,
		}, { applyImmediately: true });
	};

	const handleOpenAuditAdvancedFilter = (
		column: AuditAdvancedFilterColumn,
		triggerElement: HTMLElement,
	) => {
		const rect = triggerElement.getBoundingClientRect();
		const modalWidth = 340;
		const viewportWidth = window.innerWidth;
		const clampedLeft = Math.min(
			Math.max(12, rect.left),
			Math.max(12, viewportWidth - modalWidth - 12),
		);

		setAuditAdvancedFilterColumn(column);
		setAuditAdvancedFilterSearch("");
		setAuditAdvancedFilterValues([]);
		setAuditAdvancedFilterOffset(0);
		setHasMoreAuditAdvancedFilterValues(true);
		setAuditAdvancedFilterAnchor({
			top: rect.bottom + 8,
			left: clampedLeft,
		});
		setIsAuditAdvancedFilterModalOpen(true);
		void loadAuditAdvancedFilterValues(column, 0, "replace");
	};

	const handleOpenAuditDateFilter = (triggerElement: HTMLElement) => {
		const rect = triggerElement.getBoundingClientRect();
		const modalWidth = 320;
		const viewportWidth = window.innerWidth;
		const clampedLeft = Math.min(
			Math.max(12, rect.left),
			Math.max(12, viewportWidth - modalWidth - 12),
		);

		setAuditDateFilterFrom(draftAuditFilters.data_od ?? "");
		setAuditDateFilterTo(draftAuditFilters.data_do ?? "");
		setAuditDateFilterAnchor({
			top: rect.bottom + 8,
			left: clampedLeft,
		});
		setIsAuditDateFilterModalOpen(true);
	};

	const handleApplyAuditDateFilter = () => {
		handleAuditDraftFiltersChange(
			{
				...draftAuditFilters,
				data_od: auditDateFilterFrom || undefined,
				data_do: auditDateFilterTo || undefined,
			},
			{ applyImmediately: true },
		);
		setIsAuditDateFilterModalOpen(false);
	};

	const handleClearAuditDateFilter = () => {
		setAuditDateFilterFrom("");
		setAuditDateFilterTo("");
		handleAuditDraftFiltersChange(
			{
				...draftAuditFilters,
				data_od: undefined,
				data_do: undefined,
			},
			{ applyImmediately: true },
		);
		setIsAuditDateFilterModalOpen(false);
	};

	const handleAuditAdvancedFilterValuesScroll = (
		event: React.UIEvent<HTMLDivElement>,
	) => {
		if (!hasMoreAuditAdvancedFilterValues || isLoadingAuditAdvancedFilterValues) {
			return;
		}

		const target = event.currentTarget;
		const isNearBottom =
			target.scrollHeight - target.scrollTop - target.clientHeight < 24;

		if (!isNearBottom) {
			return;
		}

		const nextOffset = auditAdvancedFilterOffset + AUDIT_FILTER_OPTIONS_PAGE_SIZE;
		void loadAuditAdvancedFilterValues(
			auditAdvancedFilterColumn,
			nextOffset,
			"append",
		);
	};

	const handleToggleAuditAdvancedFilterValue = (value: string) => {
		const currentValues = selectedAuditAdvancedFilterValues;
		const selected = currentValues.includes(value);
		const nextValues = selected
			? currentValues.filter((item) => item !== value)
			: [...currentValues, value];

		setAuditFilterValues(auditAdvancedFilterColumn, nextValues);
	};

	const handleApplyAuditAdvancedFilterSearchValue = (value: string) => {
		const normalized = value.trim();
		if (!normalized) {
			return;
		}

		const merged = Array.from(
			new Set([...selectedAuditAdvancedFilterValues, normalized]),
		);

		setAuditFilterValues(auditAdvancedFilterColumn, merged);
	};

	const handleSelectAllVisibleAuditAdvancedFilterValues = () => {
		if (visibleAuditAdvancedFilterValues.length === 0) {
			return;
		}

		const merged = Array.from(
			new Set([...selectedAuditAdvancedFilterValues, ...visibleAuditAdvancedFilterValues]),
		);

		setAuditFilterValues(auditAdvancedFilterColumn, merged);
	};

	const handleClearAuditAdvancedFilterForSelectedColumn = () => {
		setAuditFilterValues(auditAdvancedFilterColumn, []);
	};

	// ── Schedules ──────────────────────────────────────────────────────────
	const selectedSchedules = useMemo(
		() => schedules.filter((item) => selectedScheduleIds.includes(item.id)),
		[schedules, selectedScheduleIds],
	);

	const visibleScheduleOptions = useMemo(() => {
		const phrase = scheduleSearch.trim().toLowerCase();
		if (!phrase) {
			return schedules;
		}

		return schedules.filter((item) => item.name.toLowerCase().includes(phrase));
	}, [scheduleSearch, schedules]);

	const selectedSchedulesLabel = useMemo(() => {
		if (selectedSchedules.length === 0) {
			return "brak";
		}

		if (selectedSchedules.length <= 2) {
			return selectedSchedules.map((item) => item.name).join(", ");
		}

		return `${selectedSchedules.length} harmonogramy`;
	}, [selectedSchedules]);

	const scheduleNameMap = useMemo(
		() => new Map(schedules.map((item) => [item.id, item.name])),
		[schedules],
	);

	const filteredDispatches = useMemo(() => {
		const normalize = (value: string | null | undefined) =>
			String(value ?? "").trim().toLowerCase();
		const hasDateRangeFilter =
			scheduleDateFilterFrom.trim().length > 0 || scheduleDateFilterTo.trim().length > 0;
		const normalizedDateFrom = scheduleDateFilterFrom.trim();
		const normalizedDateTo = scheduleDateFilterTo.trim();

		const selectedByColumn = {
			date: new Set(scheduleColumnFilters.date.map(normalize)),
			schedule: new Set(scheduleColumnFilters.schedule.map(normalize)),
			module: new Set(scheduleColumnFilters.module.map(normalize)),
			inspectionId: new Set(scheduleColumnFilters.inspectionId.map(normalize)),
			recommendationId: new Set(
				scheduleColumnFilters.recommendationId.map(normalize),
			),
			sanctionRequestId: new Set(
				scheduleColumnFilters.sanctionRequestId.map(normalize),
			),
			recipientType: new Set(scheduleColumnFilters.recipientType.map(normalize)),
			recipientEmail: new Set(scheduleColumnFilters.recipientEmail.map(normalize)),
			status: new Set(scheduleColumnFilters.status.map(normalize)),
		};

		return dispatches.filter((item) => {
			if (hasDateRangeFilter) {
				const itemDate = item.createdAt.trim().slice(0, 10);

				if (normalizedDateFrom && itemDate < normalizedDateFrom) {
					return false;
				}

				if (normalizedDateTo && itemDate > normalizedDateTo) {
					return false;
				}
			}

			const values = {
				date: normalize(item.createdAt),
				schedule: normalize(scheduleNameMap.get(item.scheduleId) ?? `#${item.scheduleId}`),
				module: normalize(toScheduleModuleLabel(item.moduleType || "-")),
				inspectionId: normalize(item.inspectionId || "-"),
				recommendationId: normalize(item.recommendationId || "-"),
				sanctionRequestId: normalize(item.sanctionRequestId || "-"),
				recipientType: normalize(toScheduleRecipientTypeLabel(item.recipientType || "-")),
				recipientEmail: normalize(item.recipientEmail || "-"),
				status: normalize(toScheduleStatusLabel(item.status || "-")),
			};

			for (const [column, selectedValues] of Object.entries(selectedByColumn) as Array<
				[ScheduleColumnFilterKey, Set<string>]
			>) {
				if (selectedValues.size > 0 && !selectedValues.has(values[column])) {
					return false;
				}
			}

			return true;
		});
	}, [
		dispatches,
		scheduleColumnFilters,
		scheduleDateFilterFrom,
		scheduleDateFilterTo,
		scheduleNameMap,
	]);

	const localScheduleAdvancedFilterValuesByColumn = useMemo(() => {
		const toUniqueSortedValues = (values: string[]) =>
			Array.from(new Set(values.filter(Boolean))).sort((left, right) =>
				left.localeCompare(right, "pl", { sensitivity: "base", numeric: true }),
			);

		return {
			date: toUniqueSortedValues(dispatches.map((item) => item.createdAt || "-")),
			schedule: toUniqueSortedValues(
				dispatches.map(
					(item) => scheduleNameMap.get(item.scheduleId) ?? `#${item.scheduleId}`,
				),
			),
			module: toUniqueSortedValues(
				dispatches.map((item) => toScheduleModuleLabel(item.moduleType || "-")),
			),
			inspectionId: toUniqueSortedValues(
				dispatches.map((item) => item.inspectionId || "-"),
			),
			recommendationId: toUniqueSortedValues(
				dispatches.map((item) => item.recommendationId || "-"),
			),
			sanctionRequestId: toUniqueSortedValues(
				dispatches.map((item) => item.sanctionRequestId || "-"),
			),
			recipientType: toUniqueSortedValues(
				dispatches.map((item) => toScheduleRecipientTypeLabel(item.recipientType || "-")),
			),
			recipientEmail: toUniqueSortedValues(
				dispatches.map((item) => item.recipientEmail || "-"),
			),
			status: toUniqueSortedValues(
				dispatches.map((item) => toScheduleStatusLabel(item.status || "-")),
			),
		};
	}, [dispatches, scheduleNameMap]);

	const visibleScheduleAdvancedFilterValues = useMemo(() => {
		const sourceValues =
			localScheduleAdvancedFilterValuesByColumn[scheduleAdvancedFilterColumn] ?? [];
		const normalizedSearch = scheduleAdvancedFilterSearch.trim().toLowerCase();

		if (!normalizedSearch) {
			return sourceValues;
		}

		return sourceValues.filter((value) =>
			value.toLowerCase().includes(normalizedSearch),
		);
	}, [
		localScheduleAdvancedFilterValuesByColumn,
		scheduleAdvancedFilterColumn,
		scheduleAdvancedFilterSearch,
	]);

	const selectedScheduleAdvancedFilterValues =
		scheduleColumnFilters[scheduleAdvancedFilterColumn] ?? [];

	const scheduleTotalPages = useMemo(
		() => Math.max(1, Math.ceil(filteredDispatches.length / schedulePageSize)),
		[filteredDispatches.length, schedulePageSize],
	);

	useEffect(() => {
		setScheduleCurrentPage(1);
	}, [appliedFilters, selectedScheduleIds]);

	useEffect(() => {
		setScheduleCurrentPage(1);
	}, [scheduleColumnFilters]);

	useEffect(() => {
		setScheduleCurrentPage((previous) =>
			Math.min(Math.max(previous, 1), scheduleTotalPages),
		);
	}, [scheduleTotalPages]);

	const paginatedDispatches = useMemo(() => {
		const startIndex = (scheduleCurrentPage - 1) * schedulePageSize;
		const endIndex = startIndex + schedulePageSize;
		return filteredDispatches.slice(startIndex, endIndex);
	}, [filteredDispatches, scheduleCurrentPage, schedulePageSize]);

	const schedulePaginationItems = useMemo(
		() => buildPaginationItems(scheduleCurrentPage, scheduleTotalPages),
		[scheduleCurrentPage, scheduleTotalPages],
	);

	const handleSchedulePageChange = (nextPage: number) => {
		if (!Number.isFinite(nextPage)) {
			return;
		}

		const normalizedPage = Math.trunc(nextPage);
		const boundedPage = Math.min(Math.max(normalizedPage, 1), scheduleTotalPages);
		setScheduleCurrentPage(boundedPage);
	};

	const handleSchedulePageSizeChange = (nextPageSize: number) => {
		if (
			!SCHEDULES_PAGE_SIZE_OPTIONS.includes(
				nextPageSize as (typeof SCHEDULES_PAGE_SIZE_OPTIONS)[number],
			)
		) {
			return;
		}

		setSchedulePageSize(nextPageSize);
		setScheduleCurrentPage(1);
	};

	const setScheduleFilterValues = (
		column: ScheduleColumnFilterKey,
		values: string[],
	) => {
		const normalizedUniqueValues = Array.from(
			new Set(values.map((item) => item.trim()).filter(Boolean)),
		);

		setScheduleColumnFilters((previous) => ({
			...previous,
			[column]: normalizedUniqueValues,
		}));
	};

	const handleOpenScheduleAdvancedFilter = (
		column: ScheduleColumnFilterKey,
		triggerElement: HTMLElement,
	) => {
		const rect = triggerElement.getBoundingClientRect();

		if (column === "date") {
			const modalWidth = 320;
			const viewportWidth = window.innerWidth;
			const clampedLeft = Math.min(
				Math.max(12, rect.left),
				Math.max(12, viewportWidth - modalWidth - 12),
			);

			setScheduleDateFilterAnchor({
				top: rect.bottom + 8,
				left: clampedLeft,
			});
			setIsScheduleDateFilterModalOpen(true);
			return;
		}

		const modalWidth = 340;
		const viewportWidth = window.innerWidth;
		const clampedLeft = Math.min(
			Math.max(12, rect.left),
			Math.max(12, viewportWidth - modalWidth - 12),
		);

		setScheduleAdvancedFilterColumn(column);
		setScheduleAdvancedFilterSearch("");
		setScheduleAdvancedFilterAnchor({
			top: rect.bottom + 8,
			left: clampedLeft,
		});
		setIsScheduleAdvancedFilterModalOpen(true);
	};

	const handleToggleScheduleAdvancedFilterValue = (value: string) => {
		const currentValues = selectedScheduleAdvancedFilterValues;
		const selected = currentValues.includes(value);
		const nextValues = selected
			? currentValues.filter((item) => item !== value)
			: [...currentValues, value];

		setScheduleFilterValues(scheduleAdvancedFilterColumn, nextValues);
	};

	const handleSelectAllVisibleScheduleAdvancedFilterValues = () => {
		const merged = Array.from(
			new Set([
				...selectedScheduleAdvancedFilterValues,
				...visibleScheduleAdvancedFilterValues,
			]),
		);

		setScheduleFilterValues(scheduleAdvancedFilterColumn, merged);
	};

	const handleClearScheduleAdvancedFilterForSelectedColumn = () => {
		setScheduleFilterValues(scheduleAdvancedFilterColumn, []);
	};

	const handleApplyScheduleDateFilter = () => {
		setIsScheduleDateFilterModalOpen(false);
	};

	const handleClearScheduleDateFilter = () => {
		setScheduleDateFilterFrom("");
		setScheduleDateFilterTo("");
		setIsScheduleDateFilterModalOpen(false);
	};

	const isScheduleColumnFilterActive = (column: ScheduleColumnFilterKey) => {
		if (column === "date") {
			return (
				scheduleDateFilterFrom.trim().length > 0 ||
				scheduleDateFilterTo.trim().length > 0
			);
		}

		return scheduleColumnFilters[column].length > 0;
	};

	const toggleScheduleSelection = (scheduleId: number) => {
		setSelectedScheduleIds((previous) => {
			if (previous.includes(scheduleId)) {
				return previous.filter((item) => item !== scheduleId);
			}

			return [...previous, scheduleId];
		});
	};

	const loadDispatches = useCallback(
		async (scheduleIds: number[], filters: ScheduleDispatchFilters) => {
			setIsLoadingDispatches(true);
			setDispatchesError(null);

			const responses = await Promise.all(
				scheduleIds.map((scheduleId) =>
					fetchScheduleDispatches(operatorLogin, scheduleId, filters),
				),
			);

			const errors = responses
				.filter((response) => !response.ok)
				.map((response) => response.error);

			const merged = responses
				.filter((response): response is { ok: true; dispatches: ScheduleDispatch[] } =>
					response.ok,
				)
				.flatMap((response) => response.dispatches)
				.sort((left, right) =>
					new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
				);

			const globalLimit = filters.limit ?? 100;
			setDispatches(merged.slice(0, globalLimit));

			if (errors.length > 0) {
				setDispatchesError(errors.join("; "));
			}

			setIsLoadingDispatches(false);
		},
		[operatorLogin],
	);

	const loadKpi = useCallback(
		async (scheduleIds: number[], filters: ScheduleDispatchFilters) => {
			setIsLoadingKpi(true);
			setKpiError(null);

			const responses = await Promise.all(
				scheduleIds.map((scheduleId) =>
					fetchScheduleDispatchesKpi(operatorLogin, scheduleId, filters),
				),
			);

			const errors = responses
				.filter((response) => !response.ok)
				.map((response) => response.error);

			const successful = responses.filter(
				(response): response is { ok: true; kpi: ScheduleDispatchKpi } => response.ok,
			);

			if (successful.length === 0) {
				setKpi(null);
				if (errors.length > 0) {
					setKpiError(errors.join("; "));
				}
				setIsLoadingKpi(false);
				return;
			}

			const total = successful.reduce((acc, item) => acc + item.kpi.total, 0);
			const sent = successful.reduce((acc, item) => acc + item.kpi.sent, 0);
			const failed = successful.reduce((acc, item) => acc + item.kpi.failed, 0);
			const successRate = total > 0 ? Number(((sent / total) * 100).toFixed(2)) : 0;

			const byModule = successful.reduce(
				(acc, item) => {
					for (const [key, value] of Object.entries(item.kpi.byModule)) {
						acc[key] = (acc[key] ?? 0) + value;
					}
					return acc;
				},
				{} as Record<string, number>,
			);

			const byRecipientType = successful.reduce(
				(acc, item) => {
					for (const [key, value] of Object.entries(item.kpi.byRecipientType)) {
						acc[key] = (acc[key] ?? 0) + value;
					}
					return acc;
				},
				{} as Record<string, number>,
			);

			setKpi({
				scheduleId: scheduleIds[0] ?? 0,
				total,
				sent,
				failed,
				successRate,
				byModule,
				byRecipientType,
			});

			if (errors.length > 0) {
				setKpiError(errors.join("; "));
			}

			setIsLoadingKpi(false);
		},
		[operatorLogin],
	);

	useEffect(() => {
		if (!isFiltersHydrated) {
			return;
		}

		if (activeView !== "schedules") {
			return;
		}

		const loadSchedules = async () => {
			setIsLoadingSchedules(true);
			setSchedulesError(null);
			const response = await fetchSchedules(operatorLogin);
			if (!response.ok) {
				setSchedules([]);
				setSelectedScheduleIds([]);
				setDispatches([]);
				setSchedulesError(response.error);
				setIsLoadingSchedules(false);
				return;
			}

			setSchedules(response.schedules);
			const allIds = response.schedules.map((item) => item.id);
			setSelectedScheduleIds((previous) => {
				const stillVisible = previous.filter((id) =>
					response.schedules.some((item) => item.id === id),
				);
				if (previous.length === 0) {
					return allIds;
				}

				if (stillVisible.length > 0) {
					return stillVisible;
				}

				return allIds;
			});
			setIsLoadingSchedules(false);
		};

		void loadSchedules();
	}, [activeView, isFiltersHydrated, operatorLogin]);

	useEffect(() => {
		if (activeView !== "schedules" || selectedScheduleIds.length === 0) {
			setDispatches([]);
			setDispatchesError(null);
			setKpi(null);
			setKpiError(null);
			return;
		}

		void loadDispatches(selectedScheduleIds, appliedFilters);
		void loadKpi(selectedScheduleIds, appliedFilters);
	}, [
		activeView,
		appliedFilters,
		loadDispatches,
		loadKpi,
		selectedScheduleIds,
	]);

	const handleApplyFilters = () => {
		setAppliedFilters({
			...draftFilters,
			recipientEmail: draftFilters.recipientEmail?.trim() || undefined,
			dateFrom: draftFilters.dateFrom?.trim() || undefined,
			dateTo: draftFilters.dateTo?.trim() || undefined,
			limit:
				typeof draftFilters.limit === "number"
					? Math.max(1, Math.min(1000, Math.trunc(draftFilters.limit)))
					: 100,
		});
	};

	const handleResetFilters = () => {
		const allIds = schedules.map((item) => item.id);
		setDraftFilters(DEFAULT_FILTERS);
		setAppliedFilters(DEFAULT_FILTERS);
		setScheduleSearch("");
		setScheduleColumnFilters(DEFAULT_SCHEDULE_COLUMN_FILTERS);
		setScheduleDateFilterFrom("");
		setScheduleDateFilterTo("");
		setSelectedScheduleIds(allIds);
	};

	const handleQuickPeriodChange = (
		value: "all" | "week" | "month" | "year",
	) => {
		setDraftFilters((previous) => ({ ...previous, period: value }));
		setAppliedFilters((previous) => ({ ...previous, period: value }));
	};

	const handleQuickStatusChange = (value: "sent" | "failed" | "") => {
		const nextValue = value || undefined;
		setDraftFilters((previous) => ({ ...previous, status: nextValue }));
		setAppliedFilters((previous) => ({ ...previous, status: nextValue }));
	};

	const handleQuickRecipientTypeChange = (
		value: "inspection_leader" | "inspection_team" | "author" | "",
	) => {
		const nextValue = value || undefined;
		setDraftFilters((previous) => ({ ...previous, recipientType: nextValue }));
		setAppliedFilters((previous) => ({ ...previous, recipientType: nextValue }));
	};

	const hasActiveScheduleFilters = useMemo(() => {
		const hasQuickOrFormFilters =
			(draftFilters.period ?? "all") !== "all" ||
			Boolean(draftFilters.status) ||
			Boolean(draftFilters.recipientType) ||
			(draftFilters.recipientEmail ?? "").trim().length > 0 ||
			(draftFilters.dateFrom ?? "").trim().length > 0 ||
			(draftFilters.dateTo ?? "").trim().length > 0;

		const hasColumnFilters = Object.values(scheduleColumnFilters).some(
			(values) => values.length > 0,
		);

		const hasDateRangeFilter =
			scheduleDateFilterFrom.trim().length > 0 ||
			scheduleDateFilterTo.trim().length > 0;

		const hasCustomScheduleSelection =
			schedules.length > 0 &&
			(selectedScheduleIds.length !== schedules.length ||
				schedules.some((item) => !selectedScheduleIds.includes(item.id)));

		return (
			hasQuickOrFormFilters ||
			hasColumnFilters ||
			hasDateRangeFilter ||
			hasCustomScheduleSelection
		);
	}, [
		draftFilters.dateFrom,
		draftFilters.dateTo,
		draftFilters.period,
		draftFilters.recipientEmail,
		draftFilters.recipientType,
		draftFilters.status,
		scheduleColumnFilters,
		scheduleDateFilterFrom,
		scheduleDateFilterTo,
		schedules,
		selectedScheduleIds,
	]);

	const handleChangeView = (nextView: LogsView) => {
		if (!canViewScheduleLogs && nextView === "schedules") {
			return;
		}

		if (nextView === activeView) {
			return;
		}

		setIsViewSwitching(true);
		setViewSwitchStartedAt(Date.now());
		setActiveView(nextView);
	};

	useEffect(() => {
		if (!isViewSwitching || viewSwitchStartedAt === null || !isFiltersHydrated) {
			return;
		}

		const isTargetViewLoaded =
			activeView === "registers"
				? !isLoadingAudit
				: !isLoadingSchedules && !isLoadingDispatches && !isLoadingKpi;

		if (!isTargetViewLoaded) {
			return;
		}

		const minimumSpinnerDurationMs = 220;
		const elapsed = Date.now() - viewSwitchStartedAt;
		const remaining = Math.max(0, minimumSpinnerDurationMs - elapsed);

		const timeoutId = window.setTimeout(() => {
			setIsViewSwitching(false);
			setViewSwitchStartedAt(null);
		}, remaining);

		return () => window.clearTimeout(timeoutId);
	}, [
		activeView,
		isFiltersHydrated,
		isLoadingAudit,
		isLoadingDispatches,
		isLoadingKpi,
		isLoadingSchedules,
		isViewSwitching,
		viewSwitchStartedAt,
	]);

	return (
		<section className="flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden rounded-2xl border border-slate-700/70 bg-[#101f39] p-4 sm:p-5">
			<div className="mb-3 flex flex-wrap items-end gap-2 border-[#2a4772] border-b">
				{visibleViewOptions.map((option) => {
					const isActive = option.id === activeView;
					return (
						<button
							key={option.id}
							type="button"
							onClick={() => handleChangeView(option.id)}
							aria-pressed={isActive}
							className={`-mb-px inline-flex h-9 items-center rounded-t-md border px-3.5 font-semibold text-sm transition-colors ${
								isActive
									? "border-[#8fb6ee] border-b-[#101f39] bg-[#f8fbff] text-slate-900"
									: "border-transparent bg-transparent text-white hover:bg-[#18365a]/35 hover:text-white"
							}`}
						>
							{option.label}
						</button>
					);
				})}
			</div>

			<div className="relative mt-0 flex min-h-0 min-w-0 flex-1 flex-col pt-1">
				{activeView === "registers" ? (
					<div className="flex min-h-0 min-w-0 flex-1 flex-col">
						<>
							<div className="mb-1 flex justify-end">
								<button
									type="button"
									onClick={handleAuditResetFilters}
									disabled={!hasActiveAuditFilters}
									className="inline-flex h-7 items-center rounded px-2 font-semibold text-xs transition-colors disabled:cursor-not-allowed disabled:text-slate-500 disabled:opacity-80 enabled:text-[#9fc4ff] enabled:hover:bg-[#18365a]/35 enabled:hover:text-white"
								>
									Wyczyść filtry
								</button>
							</div>
							<div className="min-h-0 flex-1">
								<TableSurface
									isLoading={isLoadingAudit}
									errorMessage={auditError}
									containerClassName="flex h-full min-h-0 flex-col border-0 shadow-none"
									scrollAreaClassName="h-full min-h-0"
									footer={
										<TablePagination
											currentPage={auditCurrentPage}
											totalPages={auditTotalPages}
											paginationItems={auditPaginationItems}
											totalItems={auditTotal}
											pageSize={auditLimit}
											onPageChange={handleAuditPageChange}
											showResultSummary={false}
											showPageSummary={false}
											pageSizeOptions={[...AUDIT_PAGE_SIZE_OPTIONS]}
											onPageSizeChange={handleAuditPageSizeChange}
											showWhenSinglePage
										/>
									}
								>
									<table className="w-max min-w-full border-collapse text-slate-900 text-sm">
											<thead className="sticky top-0 z-10">
												<tr>
													<th className="whitespace-nowrap border-slate-300 border-b bg-slate-100 px-3 py-2 text-left font-semibold text-slate-800">
														Lp.
													</th>
													<th className="whitespace-nowrap border-slate-300 border-b bg-slate-100 px-3 py-2 text-left font-semibold text-slate-800">
														<div className="flex items-center justify-between gap-1.5">
															<span>Data i godzina</span>
															<button
																type="button"
																onClick={(event) => handleOpenAuditDateFilter(event.currentTarget)}
																className={`inline-flex h-6 w-6 items-center justify-center rounded border transition-colors ${
																	isAuditDateRangeFilterActive
																		? "border-blue-400 bg-blue-50 text-blue-700"
																		: "border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
																}`}
															>
																<ChevronDown size={12} />
															</button>
														</div>
													</th>
													<th className="whitespace-nowrap border-slate-300 border-b bg-slate-100 px-3 py-2 text-left font-semibold text-slate-800">
														<div className="flex items-center justify-between gap-1.5">
															<span>Użytkownik</span>
															<button
																type="button"
																onClick={(event) =>
																	handleOpenAuditAdvancedFilter(
																		"uzytkownik",
																		event.currentTarget,
																	)
																}
																className={`inline-flex h-6 w-6 items-center justify-center rounded border transition-colors ${
																	isAuditColumnFilterActive("uzytkownik")
																		? "border-blue-400 bg-blue-50 text-blue-700"
																		: "border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
																}`}
															>
																<ChevronDown size={12} />
															</button>
														</div>
													</th>
													<th className="whitespace-nowrap border-slate-300 border-b bg-slate-100 px-3 py-2 text-left font-semibold text-slate-800">
														<div className="flex items-center justify-between gap-1.5">
															<span>Akcja</span>
															<button
																type="button"
																onClick={(event) =>
																	handleOpenAuditAdvancedFilter("akcja", event.currentTarget)
																}
																className={`inline-flex h-6 w-6 items-center justify-center rounded border transition-colors ${
																	isAuditColumnFilterActive("akcja")
																		? "border-blue-400 bg-blue-50 text-blue-700"
																		: "border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
																}`}
															>
																<ChevronDown size={12} />
															</button>
														</div>
													</th>
													<th className="whitespace-nowrap border-slate-300 border-b bg-slate-100 px-3 py-2 text-left font-semibold text-slate-800">
														<div className="flex items-center justify-between gap-1.5">
															<span>Pozycja</span>
															<button
																type="button"
																onClick={(event) =>
																	handleOpenAuditAdvancedFilter("pole", event.currentTarget)
																}
																className={`inline-flex h-6 w-6 items-center justify-center rounded border transition-colors ${
																	isAuditColumnFilterActive("pole")
																		? "border-blue-400 bg-blue-50 text-blue-700"
																		: "border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
																}`}
															>
																<ChevronDown size={12} />
															</button>
														</div>
													</th>
													<th className="whitespace-nowrap border-slate-300 border-b bg-slate-100 px-3 py-2 text-left font-semibold text-slate-800">
														<div className="flex items-center justify-between gap-1.5">
															<span>Rejestr</span>
															<button
																type="button"
																onClick={(event) =>
																	handleOpenAuditAdvancedFilter("rejestr", event.currentTarget)
																}
																className={`inline-flex h-6 w-6 items-center justify-center rounded border transition-colors ${
																	isAuditColumnFilterActive("rejestr")
																		? "border-blue-400 bg-blue-50 text-blue-700"
																		: "border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
																}`}
															>
																<ChevronDown size={12} />
															</button>
														</div>
													</th>
													<th className="whitespace-nowrap border-slate-300 border-b bg-slate-100 px-3 py-2 text-left font-semibold text-slate-800">
														<div className="flex items-center justify-between gap-1.5">
															<span>Id rekordu</span>
															<button
																type="button"
																onClick={(event) =>
																	handleOpenAuditAdvancedFilter(
																		"id_rejestru",
																		event.currentTarget,
																	)
																}
																className={`inline-flex h-6 w-6 items-center justify-center rounded border transition-colors ${
																	isAuditColumnFilterActive("id_rejestru")
																		? "border-blue-400 bg-blue-50 text-blue-700"
																		: "border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
																}`}
															>
																<ChevronDown size={12} />
															</button>
														</div>
													</th>
													<th className="border-slate-300 border-b bg-slate-100 px-3 py-2 text-left font-semibold text-slate-800">
														Wartość przed zmianą
													</th>
													<th className="border-slate-300 border-b bg-slate-100 px-3 py-2 text-left font-semibold text-slate-800">
														Wartość po zmianie
													</th>
												</tr>
											</thead>
											<tbody>
												{auditItems.length === 0 ? (
													<tr className="border-slate-200 border-b bg-white">
														<td
															colSpan={9}
															className="px-3 py-8 text-center text-slate-500 text-sm"
														>
															Brak wyników dla podanych filtrów.
														</td>
													</tr>
												) : (() => {
													const sessionGroupMap = new Map<string, number>();
													let groupCount = 0;
													return auditItems.map((item, index) => {
														const sessionKey = item.session_id ?? `__no_session_${index}`;
														const isFirstInGroup = !sessionGroupMap.has(sessionKey);
														if (isFirstInGroup) {
															sessionGroupMap.set(sessionKey, groupCount++);
														}
														const isEvenGroup = (sessionGroupMap.get(sessionKey)! % 2) === 0;
														return (
													<tr
														key={item.id || `${item.session_id}-${index}`}
														className={[
															"border-b last:border-b-0",
															isEvenGroup ? "bg-white hover:bg-slate-50" : "bg-indigo-100/70 hover:bg-indigo-100/90",
															isFirstInGroup && index > 0 ? "border-t border-t-slate-400" : "border-slate-200",
														].join(" ")}
													>
														<td className="whitespace-nowrap px-3 py-2.5">
															{auditOffset + index + 1}
														</td>
														<td className="whitespace-nowrap px-3 py-2.5">
															{formatAuditDate(item.data_godz)}
														</td>
														<td className="whitespace-nowrap px-3 py-2.5">
															{item.uzytkownik}
														</td>
														<td className="whitespace-nowrap px-3 py-2.5">
															<AuditActionBadge akcja={item.akcja} />
														</td>
														<td className="whitespace-nowrap px-3 py-2.5">
															{item.pole ?? "—"}
														</td>
														<td className="whitespace-nowrap px-3 py-2.5">
															<RejestrBadge rejestr={item.rejestr} />
														</td>
														<td className="whitespace-nowrap px-3 py-2.5 font-mono">
															{(() => {
																const recordCode = item.rekord_kod.trim();
																const isNavigableRegister =
																	item.rejestr === "inspekcje" || item.rejestr === "zalecenia";

																if (!recordCode || !isNavigableRegister) {
																	return recordCode || "—";
																}

																return (
																	<button
																		type="button"
																		onClick={(event) => {
																			event.stopPropagation();
																			handleOpenAuditRecordFromLogs(item);
																		}}
																		className="cursor-pointer border-0 bg-transparent p-0 text-left font-mono text-[#1459c5] underline underline-offset-2 hover:text-[#0f4396]"
																	>
																		{recordCode}
																	</button>
																);
															})()}
														</td>
														<td className="max-w-[22rem] whitespace-normal break-words px-3 py-2.5 align-top">
															{formatAuditChangeValue(item.pole, item.przed)}
														</td>
														<td className="max-w-[22rem] whitespace-normal break-words px-3 py-2.5 align-top">
															{formatAuditChangeValue(item.pole, item.po)}
														</td>
													</tr>
														);
													});
												})()}
											</tbody>
											</table>
										</TableSurface>
									</div>

											<TableAdvancedFilterModal
												isOpen={isAuditAdvancedFilterModalOpen}
												anchor={auditAdvancedFilterAnchor}
												columnLabel={AUDIT_ADVANCED_FILTER_LABELS[auditAdvancedFilterColumn]}
												searchValue={auditAdvancedFilterSearch}
												visibleValues={visibleAuditAdvancedFilterValues}
												selectedValues={selectedAuditAdvancedFilterValues}
												isLoadingValues={isLoadingAuditAdvancedFilterValues}
												onClose={() => {
													setIsAuditAdvancedFilterModalOpen(false);
													setAuditAdvancedFilterValues([]);
													setAuditAdvancedFilterOffset(0);
													setHasMoreAuditAdvancedFilterValues(false);
												}}
												onSearchChange={setAuditAdvancedFilterSearch}
												onSelectAllVisible={handleSelectAllVisibleAuditAdvancedFilterValues}
												onClearSelectedColumn={handleClearAuditAdvancedFilterForSelectedColumn}
												onToggleValue={handleToggleAuditAdvancedFilterValue}
												onApplySearchValue={handleApplyAuditAdvancedFilterSearchValue}
												onClearAllFilters={handleAuditResetFilters}
												onValuesScroll={handleAuditAdvancedFilterValuesScroll}
											/>

											{isAuditDateFilterModalOpen ? (
												<div className="fixed inset-0 z-40">
													<button
														type="button"
														aria-label="Zamknij filtr daty"
														className="absolute inset-0 bg-transparent"
														onClick={() => setIsAuditDateFilterModalOpen(false)}
													/>

													<div
														role="dialog"
														aria-modal="true"
														aria-label="Filtrowanie daty"
														className="absolute z-10 flex w-80 max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-xl border border-slate-300 bg-white p-3 text-slate-900 shadow-[0_20px_40px_rgba(2,8,23,0.28)]"
														style={{
															top: auditDateFilterAnchor.top,
															left: auditDateFilterAnchor.left,
														}}
														onClick={(event) => event.stopPropagation()}
													>
														<div className="mb-3 border-slate-200 border-b pb-2">
															<h3 className="font-semibold text-slate-900 text-sm">Filtr: Data i godzina</h3>
														</div>

														<div className="space-y-2">
															<DateInputWithCalendar
																label="Od"
																value={auditDateFilterFrom}
																onChange={setAuditDateFilterFrom}
															/>

															<DateInputWithCalendar
																label="Do"
																value={auditDateFilterTo}
																onChange={setAuditDateFilterTo}
															/>
														</div>

														<div className="mt-3 flex justify-end gap-2 border-slate-200 border-t pt-2.5">
															<button
																type="button"
																onClick={handleClearAuditDateFilter}
																className="inline-flex h-8 items-center rounded-md border border-slate-300 bg-white px-2.5 font-semibold text-slate-700 text-xs transition-colors hover:bg-slate-100"
															>
																Wyczyść
															</button>

															<button
																type="button"
																onClick={handleApplyAuditDateFilter}
																className="inline-flex h-8 items-center rounded-md border border-[#6ea3f0] bg-[#2d4d7f] px-2.5 font-semibold text-slate-100 text-xs transition-colors hover:bg-[#375f99]"
															>
																OK
															</button>
														</div>
													</div>
												</div>
											) : null}
						</>
					</div>
				) : (
					<div className="flex min-h-0 min-w-0 flex-1 flex-col">
						<div className="hidden mt-3 rounded-xl border border-[#43628f] bg-[#1b3a63] p-2.5 shadow-[0_8px_18px_rgba(2,8,23,0.22)]">
							<div className="flex flex-wrap items-end justify-between gap-2">
								<div className="flex flex-wrap items-end gap-2">
									<details className="group relative">
										<summary className="inline-flex w-56 cursor-pointer list-none items-center justify-between rounded-md border border-[#b6c6dc] bg-[#f8fbff] px-3 py-2 font-medium text-slate-800 text-sm">
											<span className="truncate">Harmonogramy: {selectedSchedulesLabel}</span>
											<ChevronDown size={14} className="shrink-0 text-slate-500 transition-transform duration-200 group-open:rotate-180" />
										</summary>
										<div className="absolute left-0 z-30 mt-2 w-72 rounded-lg border border-[#b6c6dc] bg-[#f8fbff] p-2 shadow-[0_14px_28px_rgba(2,8,23,0.24)]">
											<input
												type="text"
												value={scheduleSearch}
												onChange={(event) => setScheduleSearch(event.target.value)}
												placeholder="Szukaj harmonogramu"
												className="w-full rounded-md border border-[#b6c6dc] bg-white px-2.5 py-2 text-slate-800 text-sm outline-none placeholder:text-slate-400"
											/>
											<div className="mt-2 flex gap-1">
												<button
													type="button"
													onClick={() =>
														setSelectedScheduleIds(schedules.map((item) => item.id))
													}
													className="rounded border border-[#b6c6dc] bg-white px-2 py-1 font-medium text-slate-700 text-xs hover:bg-slate-100"
												>
													Zaznacz wszystkie
												</button>
												<button
													type="button"
													onClick={() => setSelectedScheduleIds([])}
													className="rounded border border-[#b6c6dc] bg-white px-2 py-1 font-medium text-slate-700 text-xs hover:bg-slate-100"
												>
													Wyczysc
												</button>
											</div>
											<div
												className={
													visibleScheduleOptions.length > 5
														? "subtle-horizontal-scroll subtle-vertical-scroll mt-2 max-h-44 space-y-1 overflow-auto pr-1"
														: "mt-2 space-y-1"
												}
											>
												{visibleScheduleOptions.map((item) => (
													<label
														key={item.id}
														className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-slate-800 text-sm hover:bg-[#e9f1fc]"
													>
														<input
															type="checkbox"
															checked={selectedScheduleIds.includes(item.id)}
															onChange={() => toggleScheduleSelection(item.id)}
															className="h-3.5 w-3.5"
														/>
														<span className="truncate">{item.name}</span>
													</label>
												))}
											</div>
										</div>
									</details>

									<select
										value={draftFilters.period ?? "all"}
										onChange={(event) =>
											handleQuickPeriodChange(
												event.target.value as "all" | "week" | "month" | "year",
											)
										}
										className="h-10 rounded-md border border-[#b6c6dc] bg-[#f8fbff] px-3 py-2 font-medium text-slate-800 text-sm"
									>
										<option value="all">Okres: wszystko</option>
										<option value="week">Okres: tydzien</option>
										<option value="month">Okres: miesiac</option>
										<option value="year">Okres: rok</option>
									</select>

									<select
										value={draftFilters.status ?? ""}
										onChange={(event) =>
											handleQuickStatusChange(event.target.value as "sent" | "failed" | "")
										}
										className="h-10 rounded-md border border-[#b6c6dc] bg-[#f8fbff] px-3 py-2 font-medium text-slate-800 text-sm"
									>
										<option value="">Status: wszystkie</option>
										<option value="sent">Status: wyslane</option>
										<option value="failed">Status: bledne</option>
									</select>

									<select
										value={draftFilters.recipientType ?? ""}
										onChange={(event) =>
											handleQuickRecipientTypeChange(
												event.target.value as
													| "inspection_leader"
													| "inspection_team"
													| "author"
													| "",
											)
										}
										className="h-10 rounded-md border border-[#b6c6dc] bg-[#f8fbff] px-3 py-2 font-medium text-slate-800 text-sm"
									>
										<option value="">Odbiorca: wszyscy</option>
										<option value="inspection_leader">Odbiorca: kierownik</option>
										<option value="inspection_team">Odbiorca: sklad zespolu</option>
										<option value="author">Odbiorca: autor wpisu</option>
									</select>
								</div>

							</div>

							<div className="mt-2 grid gap-2 md:grid-cols-[1fr_180px_180px_auto]">
							<label className="text-slate-200 text-xs">
								<span className="mb-1 block text-slate-300/90">E-mail (fragment)</span>
								<input
									value={draftFilters.recipientEmail ?? ""}
									onChange={(event) =>
										setDraftFilters((previous) => ({
											...previous,
											recipientEmail: event.target.value,
										}))
									}
									className="w-full rounded-md border border-slate-500/70 bg-[#12284a] px-2 py-1.5 text-slate-100 text-sm"
								/>
							</label>
							<label className="text-slate-200 text-xs">
								<span className="mb-1 block text-slate-300/90">Data od</span>
								<input
									type="date"
									value={draftFilters.dateFrom ?? ""}
									onChange={(event) =>
										setDraftFilters((previous) => ({
											...previous,
											dateFrom: event.target.value || undefined,
										}))
									}
									className="w-full rounded-md border border-slate-500/70 bg-[#12284a] px-2 py-1.5 text-slate-100 text-sm"
								/>
							</label>
							<label className="text-slate-200 text-xs">
								<span className="mb-1 block text-slate-300/90">Data do</span>
								<input
									type="date"
									value={draftFilters.dateTo ?? ""}
									onChange={(event) =>
										setDraftFilters((previous) => ({
											...previous,
											dateTo: event.target.value || undefined,
										}))
									}
									className="w-full rounded-md border border-slate-500/70 bg-[#12284a] px-2 py-1.5 text-slate-100 text-sm"
								/>
							</label>
							<div className="flex items-end gap-2">
								<button
									type="button"
									onClick={handleApplyFilters}
									className="inline-flex h-9 items-center rounded-md border border-[#6ea3f0] bg-[#2d4d7f] px-3 font-semibold text-slate-100 text-xs"
								>
									Zastosuj
								</button>
							</div>
							</div>
						</div>

						{schedulesError ? (
							<p className="mt-3 rounded-md border border-rose-300/45 bg-rose-950/20 px-2.5 py-2 text-rose-200 text-xs">
								{schedulesError}
							</p>
						) : null}

						{isLoadingSchedules ? (
							<p className="mt-2 text-slate-300/85 text-xs">Ladowanie harmonogramow...</p>
						) : null}



						{kpiError ? (
							<p className="mt-2 rounded-md border border-rose-300/45 bg-rose-950/20 px-2.5 py-2 text-rose-200 text-xs">
								{kpiError}
							</p>
						) : null}

						<div className="flex min-h-0 min-w-0 flex-1 flex-col">
								<div className="mb-1 flex justify-end">
									<button
										type="button"
										onClick={handleResetFilters}
										disabled={!hasActiveScheduleFilters}
										className="inline-flex h-7 items-center rounded px-2 font-semibold text-xs transition-colors disabled:cursor-not-allowed disabled:text-slate-500 disabled:opacity-80 enabled:text-[#9fc4ff] enabled:hover:bg-[#18365a]/35 enabled:hover:text-white"
									>
										Wyczyść filtry
									</button>
								</div>
								<TableSurface
									isLoading={isLoadingDispatches}
									errorMessage={dispatchesError}
									containerClassName="flex h-full min-h-0 flex-col border-0 shadow-none"
									scrollAreaClassName="h-full min-h-0"
									footer={
										<TablePagination
											currentPage={scheduleCurrentPage}
											totalPages={scheduleTotalPages}
											paginationItems={schedulePaginationItems}
											totalItems={filteredDispatches.length}
											pageSize={schedulePageSize}
											onPageChange={handleSchedulePageChange}
											pageSizeOptions={[...SCHEDULES_PAGE_SIZE_OPTIONS]}
											onPageSizeChange={handleSchedulePageSizeChange}
											showWhenSinglePage
										/>
									}
								>
									<table className="w-max min-w-full border-collapse text-slate-900 text-sm">
										<thead className="sticky top-0 z-10">
											<tr>
												<th className="border-slate-300 border-b bg-slate-100 px-3 py-2 text-left font-semibold text-slate-800">
													<div className="flex items-center justify-between gap-1.5">
														<span>Data</span>
														<button
															type="button"
															onClick={(event) =>
																handleOpenScheduleAdvancedFilter("date", event.currentTarget)
															}
															className={`inline-flex h-6 w-6 items-center justify-center rounded border transition-colors ${
																isScheduleColumnFilterActive("date")
																	? "border-blue-400 bg-blue-50 text-blue-700"
																	: "border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
															}`}
														>
															<ChevronDown size={12} />
														</button>
													</div>
												</th>
												<th className="border-slate-300 border-b bg-slate-100 px-3 py-2 text-left font-semibold text-slate-800">
													<div className="flex items-center justify-between gap-1.5">
														<span>Harmonogram</span>
														<button
															type="button"
															onClick={(event) =>
																handleOpenScheduleAdvancedFilter("schedule", event.currentTarget)
															}
															className={`inline-flex h-6 w-6 items-center justify-center rounded border transition-colors ${
																isScheduleColumnFilterActive("schedule")
																	? "border-blue-400 bg-blue-50 text-blue-700"
																	: "border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
															}`}
														>
															<ChevronDown size={12} />
														</button>
													</div>
												</th>
												<th className="border-slate-300 border-b bg-slate-100 px-3 py-2 text-left font-semibold text-slate-800">
													<div className="flex items-center justify-between gap-1.5">
														<span>Moduł</span>
														<button
															type="button"
															onClick={(event) =>
																handleOpenScheduleAdvancedFilter("module", event.currentTarget)
															}
															className={`inline-flex h-6 w-6 items-center justify-center rounded border transition-colors ${
																isScheduleColumnFilterActive("module")
																	? "border-blue-400 bg-blue-50 text-blue-700"
																	: "border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
															}`}
														>
															<ChevronDown size={12} />
														</button>
													</div>
												</th>
												<th className="border-slate-300 border-b bg-slate-100 px-3 py-2 text-left font-semibold text-slate-800">
													<div className="flex items-center justify-between gap-1.5">
														<span>ID inspekcji</span>
														<button
															type="button"
															onClick={(event) =>
																handleOpenScheduleAdvancedFilter("inspectionId", event.currentTarget)
															}
															className={`inline-flex h-6 w-6 items-center justify-center rounded border transition-colors ${
																isScheduleColumnFilterActive("inspectionId")
																	? "border-blue-400 bg-blue-50 text-blue-700"
																	: "border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
															}`}
														>
															<ChevronDown size={12} />
														</button>
													</div>
												</th>
												<th className="border-slate-300 border-b bg-slate-100 px-3 py-2 text-left font-semibold text-slate-800">
													<div className="flex items-center justify-between gap-1.5">
														<span>ID zalecenia</span>
														<button
															type="button"
															onClick={(event) =>
																handleOpenScheduleAdvancedFilter(
																	"recommendationId",
																	event.currentTarget,
																)
															}
															className={`inline-flex h-6 w-6 items-center justify-center rounded border transition-colors ${
																isScheduleColumnFilterActive("recommendationId")
																	? "border-blue-400 bg-blue-50 text-blue-700"
																	: "border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
															}`}
														>
															<ChevronDown size={12} />
														</button>
													</div>
												</th>
												<th className="border-slate-300 border-b bg-slate-100 px-3 py-2 text-left font-semibold text-slate-800">
													<div className="flex items-center justify-between gap-1.5">
														<span>ID wniosku</span>
														<button
															type="button"
															onClick={(event) =>
																handleOpenScheduleAdvancedFilter(
																	"sanctionRequestId",
																	event.currentTarget,
																)
															}
															className={`inline-flex h-6 w-6 items-center justify-center rounded border transition-colors ${
																isScheduleColumnFilterActive("sanctionRequestId")
																	? "border-blue-400 bg-blue-50 text-blue-700"
																	: "border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
															}`}
														>
															<ChevronDown size={12} />
														</button>
													</div>
												</th>
												<th className="border-slate-300 border-b bg-slate-100 px-3 py-2 text-left font-semibold text-slate-800">
													<div className="flex items-center justify-between gap-1.5">
														<span>Do kogo (typ)</span>
														<button
															type="button"
															onClick={(event) =>
																handleOpenScheduleAdvancedFilter(
																	"recipientType",
																	event.currentTarget,
																)
															}
															className={`inline-flex h-6 w-6 items-center justify-center rounded border transition-colors ${
																isScheduleColumnFilterActive("recipientType")
																	? "border-blue-400 bg-blue-50 text-blue-700"
																	: "border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
															}`}
														>
															<ChevronDown size={12} />
														</button>
													</div>
												</th>
												<th className="border-slate-300 border-b bg-slate-100 px-3 py-2 text-left font-semibold text-slate-800">
													<div className="flex items-center justify-between gap-1.5">
														<span>Do kogo (osoba)</span>
														<button
															type="button"
															onClick={(event) =>
																handleOpenScheduleAdvancedFilter(
																	"recipientEmail",
																	event.currentTarget,
																)
															}
															className={`inline-flex h-6 w-6 items-center justify-center rounded border transition-colors ${
																isScheduleColumnFilterActive("recipientEmail")
																	? "border-blue-400 bg-blue-50 text-blue-700"
																	: "border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
															}`}
														>
															<ChevronDown size={12} />
														</button>
													</div>
												</th>
												<th className="border-slate-300 border-b bg-slate-100 px-3 py-2 text-left font-semibold text-slate-800">
													<div className="flex items-center justify-between gap-1.5">
														<span>Status</span>
														<button
															type="button"
															onClick={(event) =>
																handleOpenScheduleAdvancedFilter("status", event.currentTarget)
															}
															className={`inline-flex h-6 w-6 items-center justify-center rounded border transition-colors ${
																isScheduleColumnFilterActive("status")
																	? "border-blue-400 bg-blue-50 text-blue-700"
																	: "border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
															}`}
														>
															<ChevronDown size={12} />
														</button>
													</div>
												</th>
											</tr>
										</thead>
										<tbody>
											{paginatedDispatches.map((item) => (
												<tr
													key={item.id}
													className="border-slate-200 border-b last:border-b-0 hover:bg-slate-50"
												>
													<td className="px-3 py-2.5">{item.createdAt}</td>
													<td className="px-3 py-2.5">
														{scheduleNameMap.get(item.scheduleId) ?? `#${item.scheduleId}`}
													</td>
													<td className="px-3 py-2.5">{toScheduleModuleLabel(item.moduleType)}</td>
													<td className="px-3 py-2.5">{item.inspectionId ?? "-"}</td>
													<td className="px-3 py-2.5">{item.recommendationId ?? "-"}</td>
													<td className="px-3 py-2.5">{item.sanctionRequestId ?? "-"}</td>
													<td className="px-3 py-2.5">{toScheduleRecipientTypeLabel(item.recipientType || "-")}</td>
													<td
														className="max-w-40 truncate px-3 py-2.5"
														title={item.recipientEmail}
													>
														{item.recipientEmail}
													</td>
													<td className="px-3 py-2.5">
														<span className={getDispatchStatusBadge(item.status)}>
															{toScheduleStatusLabel(item.status)}
														</span>
													</td>
												</tr>
											))}

											{!isLoadingDispatches && paginatedDispatches.length === 0 ? (
												<tr>
													<td
														colSpan={9}
														className="px-3 py-6 text-center text-slate-500 text-sm"
													>
														Brak wpisow historii.
													</td>
												</tr>
											) : null}
										</tbody>
									</table>
								</TableSurface>

								<TableAdvancedFilterModal
									isOpen={isScheduleAdvancedFilterModalOpen}
									anchor={scheduleAdvancedFilterAnchor}
									columnLabel={SCHEDULE_ADVANCED_FILTER_LABELS[scheduleAdvancedFilterColumn]}
									searchValue={scheduleAdvancedFilterSearch}
									visibleValues={visibleScheduleAdvancedFilterValues}
									selectedValues={selectedScheduleAdvancedFilterValues}
									onClose={() => setIsScheduleAdvancedFilterModalOpen(false)}
									onSearchChange={setScheduleAdvancedFilterSearch}
									onSelectAllVisible={handleSelectAllVisibleScheduleAdvancedFilterValues}
									onClearSelectedColumn={handleClearScheduleAdvancedFilterForSelectedColumn}
									onToggleValue={handleToggleScheduleAdvancedFilterValue}
									onClearAllFilters={() => setScheduleColumnFilters(DEFAULT_SCHEDULE_COLUMN_FILTERS)}
								/>

								{isScheduleDateFilterModalOpen ? (
									<div className="fixed inset-0 z-40">
										<button
											type="button"
											aria-label="Zamknij filtr daty harmonogramów"
											className="absolute inset-0 bg-transparent"
											onClick={() => setIsScheduleDateFilterModalOpen(false)}
										/>

										<div
											role="dialog"
											aria-modal="true"
											aria-label="Filtrowanie daty harmonogramów"
											className="absolute z-10 flex w-80 max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-xl border border-slate-300 bg-white p-3 text-slate-900 shadow-[0_20px_40px_rgba(2,8,23,0.28)]"
											style={{
												top: scheduleDateFilterAnchor.top,
												left: scheduleDateFilterAnchor.left,
											}}
											onClick={(event) => event.stopPropagation()}
										>
											<div className="mb-3 border-slate-200 border-b pb-2">
												<h3 className="font-semibold text-slate-900 text-sm">Filtr: Data</h3>
											</div>

											<div className="space-y-2">
												<DateInputWithCalendar
													label="Od"
													value={scheduleDateFilterFrom}
													onChange={setScheduleDateFilterFrom}
												/>

												<DateInputWithCalendar
													label="Do"
													value={scheduleDateFilterTo}
													onChange={setScheduleDateFilterTo}
												/>
											</div>

											<div className="mt-3 flex justify-end gap-2 border-slate-200 border-t pt-2.5">
												<button
													type="button"
													onClick={handleClearScheduleDateFilter}
													className="inline-flex h-8 items-center rounded-md border border-slate-300 bg-white px-2.5 font-semibold text-slate-700 text-xs transition-colors hover:bg-slate-100"
												>
													Wyczyść
												</button>

												<button
													type="button"
													onClick={handleApplyScheduleDateFilter}
													className="inline-flex h-8 items-center rounded-md border border-[#6ea3f0] bg-[#2d4d7f] px-2.5 font-semibold text-slate-100 text-xs transition-colors hover:bg-[#375f99]"
												>
													OK
												</button>
											</div>
										</div>
									</div>
								) : null}
						</div>
					</div>
				)}

				{isViewSwitching ? (
					<div className="absolute inset-0 z-20 flex items-center justify-center">
						<div className="flex items-center gap-2 rounded-xl border border-[#c8dbf5] bg-[#f8fbff]/95 px-3.5 py-2.5 text-[#234a78] text-sm shadow-[0_10px_28px_rgba(7,37,84,0.18)] backdrop-blur-sm">
							<span className="h-4 w-4 animate-spin rounded-full border-2 border-[#8fb6ee] border-t-transparent" />
							<span>Ładowanie widoku...</span>
						</div>
					</div>
				) : null}
			</div>
		</section>
	);
}