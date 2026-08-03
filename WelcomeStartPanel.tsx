"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import {
        Cell,
        Pie,
        PieChart,
        ResponsiveContainer,
        Tooltip,
} from "recharts";

import { getStoredAuthSession } from "@/features/auth/session";
import { normalizeAuthRole } from "@/features/auth/types";
import { fetchDictionaryEntries } from "@/features/dictionaries/api";
import {
        fetchInspectionsDetailedReport,
        fetchInspectionsStageSummary,
        fetchRecommendationsDetailedReport,
        fetchRecommendationsStageSummary,
} from "@/features/reports/api";
import { TableSurface } from "@/shared/components/table/TableSurface";
import { formatDatesInDisplayText } from "@/shared/utils/date";
import type {
        ReportInspectionDetailedRow,
        ReportRecommendationDetailedRow,
        ReportsRecommendationsStageSummaryResponse,
        ReportsInspectionsStageSummaryResponse,
} from "@/features/reports/types";

type WelcomeStartPanelProps = {
        operatorLogin: string;
};

const DASHBOARD_OPEN_INSPECTION_EVENT = "dashboard:open-inspection";
const DASHBOARD_OPEN_INSPECTION_CODE_KEY = "triangle.dashboard.openInspectionCode";
const DASHBOARD_OPEN_RECOMMENDATION_EVENT = "dashboard:open-recommendation";
const DASHBOARD_OPEN_RECOMMENDATION_CODE_KEY =
        "triangle.dashboard.openRecommendationCode";
const DASHBOARD_ACTIVE_TOP_SECTION_KEY = "triangle.dashboard.activeTopSection";
const DASHBOARD_SELECTED_INSPECTION_STAGE_FILTERS_KEY =
        "triangle.dashboard.selectedInspectionStageFilters";
const DASHBOARD_INSPECTION_SUMMARY_COLLAPSED_KEY =
	"triangle.dashboard.inspectionSummaryCollapsed";
const DASHBOARD_RECOMMENDATION_SUMMARY_COLLAPSED_KEY =
	"triangle.dashboard.recommendationSummaryCollapsed";
const DASHBOARD_SELECTED_RECOMMENDATION_STATUSES_KEY =
        "triangle.dashboard.selectedRecommendationStatuses";
const INSPECTION_STATUS_SCROLL_THRESHOLD = 12;
const INSPECTION_STATUS_VISIBLE_ROWS = 12;
const INSPECTION_STATUS_ESTIMATED_ROW_HEIGHT_PX = 33;
const INSPECTION_STATUS_LIST_MAX_HEIGHT_PX =
	INSPECTION_STATUS_VISIBLE_ROWS * INSPECTION_STATUS_ESTIMATED_ROW_HEIGHT_PX;
const RECOMMENDATION_STATUS_SCROLL_THRESHOLD = 12;
const RECOMMENDATION_STATUS_VISIBLE_ROWS = 12;
const RECOMMENDATION_STATUS_ESTIMATED_ROW_HEIGHT_PX = 33;
const RECOMMENDATION_STATUS_LIST_MAX_HEIGHT_PX =
	RECOMMENDATION_STATUS_VISIBLE_ROWS * RECOMMENDATION_STATUS_ESTIMATED_ROW_HEIGHT_PX;
// Ustal ręczną kolejność statusów po kodzie etapu (kod_pozycji).
// Przykład: ["PLAN", "PRZYG", "TRWA"]
const INSPECTION_STAGE_ORDER_BY_CODE: string[] = [];
const STAGE_OVERVIEW_COLORS = [
	"#b4534b", // muted red
	"#c96a4b", // terracotta
	"#d48746", // muted orange
	"#d9a441", // amber
	"#c8b24a", // olive yellow
	"#8aa652", // moss green
	"#4f9a70", // soft green
	"#2f8f8a", // teal
	"#3f86b8", // muted blue
	"#5e73b8", // indigo blue
] as const;
const ENABLE_DASHBOARD_DEBUG_LOGS = false;

type InspectionStatusStyle = {
	kolor: string | null;
	odcien: number | null;
	intensywnosc: number | null;
};

const STATUS_PALETTE_HUE_SAT: Record<string, { hue: number; saturation: number }> = {
	emerald: { hue: 160, saturation: 84 },
	green: { hue: 142, saturation: 71 },
	teal: { hue: 173, saturation: 80 },
	lime: { hue: 83, saturation: 86 },
	sky: { hue: 199, saturation: 95 },
	cyan: { hue: 188, saturation: 94 },
	blue: { hue: 221, saturation: 83 },
	indigo: { hue: 239, saturation: 84 },
	rose: { hue: 350, saturation: 89 },
	red: { hue: 0, saturation: 84 },
	pink: { hue: 330, saturation: 81 },
	fuchsia: { hue: 292, saturation: 84 },
	yellow: { hue: 55, saturation: 96 },
	amber: { hue: 43, saturation: 96 },
	orange: { hue: 24, saturation: 92 },
};

const STATUS_SHADE_TO_LIGHTNESS: Record<number, number> = {
	50: 97,
	100: 93,
	200: 86,
	300: 76,
	400: 65,
	500: 54,
	600: 45,
	700: 37,
	800: 30,
	900: 23,
	950: 14,
};

function resolveStatusBackgroundColor(
	statusKeys: string[],
	statusStyleByCode: Record<string, InspectionStatusStyle>,
) {
	for (const keyCandidate of statusKeys) {
		const normalizedKey = keyCandidate.trim().toUpperCase();
		if (!normalizedKey) {
			continue;
		}

		const style = statusStyleByCode[normalizedKey];
		if (!style) {
			continue;
		}

		const palette = STATUS_PALETTE_HUE_SAT[String(style.kolor ?? "").trim().toLowerCase()];
		if (!palette) {
			continue;
		}

		const shade = Number.isFinite(style.odcien)
			? Math.round(Number(style.odcien))
			: 200;
		const lightness = STATUS_SHADE_TO_LIGHTNESS[shade] ?? STATUS_SHADE_TO_LIGHTNESS[200];
		const opacity = Number.isFinite(style.intensywnosc)
			? Math.max(0, Math.min(100, Number(style.intensywnosc))) / 100
			: 0.75;

		return `hsl(${palette.hue} ${palette.saturation}% ${lightness}% / ${opacity})`;
	}

	return "rgb(255 255 255 / 1)";
}

function getStoredDashboardActiveSection(): "inspections" | "recommendations" {
        if (typeof window === "undefined") {
                return "inspections";
        }

        const saved = window.sessionStorage.getItem(DASHBOARD_ACTIVE_TOP_SECTION_KEY);
        return saved === "recommendations" ? "recommendations" : "inspections";
}

function getStoredInspectionStageFilters(): StageFilter[] {
        if (typeof window === "undefined") {
                return [];
        }

        const raw = window.sessionStorage.getItem(
                DASHBOARD_SELECTED_INSPECTION_STAGE_FILTERS_KEY,
        );
        if (!raw) {
                return [];
        }

        try {
                const parsed = JSON.parse(raw);
                if (!Array.isArray(parsed)) {
                        return [];
                }

                return parsed
                        .map((item) => {
                                if (!item || typeof item !== "object") {
                                        return null;
                                }

                                const record = item as Record<string, unknown>;
                                const stageCode =
                                        typeof record.stageCode === "string"
                                                ? record.stageCode
                                                : typeof record.stageGroupCode === "string"
                                                        ? record.stageGroupCode
                                                        : typeof record.stageSubgroupCode === "string"
                                                                ? record.stageSubgroupCode
                                                                : "";
                                const stageLabel =
                                        typeof record.stageLabel === "string"
                                                ? record.stageLabel
                                                : typeof record.stageGroupLabel === "string"
                                                        ? record.stageGroupLabel
                                                        : typeof record.stageSubgroupLabel === "string"
                                                                ? record.stageSubgroupLabel
                                                                : "";

                                if (!stageCode.trim() || !stageLabel.trim()) {
                                        return null;
                                }

                                return {
                                        stageCode,
                                        stageLabel,
                                };
                        })
                        .filter((item): item is StageFilter => item !== null);
        } catch {
                window.sessionStorage.removeItem(DASHBOARD_SELECTED_INSPECTION_STAGE_FILTERS_KEY);
                return [];
        }
}

function getStoredInspectionSummaryCollapsed() {
	if (typeof window === "undefined") {
		return false;
	}

	return window.sessionStorage.getItem(DASHBOARD_INSPECTION_SUMMARY_COLLAPSED_KEY) === "1";
}

function getStoredRecommendationStatusFilters(): RecommendationStatusFilter[] {
        if (typeof window === "undefined") {
                return [];
        }

        const raw = window.sessionStorage.getItem(
                DASHBOARD_SELECTED_RECOMMENDATION_STATUSES_KEY,
        );
        if (!raw) {
                return [];
        }

        try {
                const parsed = JSON.parse(raw);
                if (!Array.isArray(parsed)) {
                        return [];
                }

                return parsed
                        .filter(
                                (item) =>
                                        item &&
                                        typeof item === "object" &&
                                        typeof (item as RecommendationStatusFilter).stageGroupCode === "string" &&
                                        typeof (item as RecommendationStatusFilter).stageGroupLabel === "string",
                        )
                        .map((item) => ({
                                stageGroupCode: (item as RecommendationStatusFilter).stageGroupCode,
                                stageGroupLabel: (item as RecommendationStatusFilter).stageGroupLabel,
                        }));
        } catch {
                window.sessionStorage.removeItem(DASHBOARD_SELECTED_RECOMMENDATION_STATUSES_KEY);
                return [];
        }
}

function getStoredRecommendationSummaryCollapsed() {
	if (typeof window === "undefined") {
		return false;
	}

	return (
		window.sessionStorage.getItem(DASHBOARD_RECOMMENDATION_SUMMARY_COLLAPSED_KEY) ===
		"1"
	);
}

function normalizePolishLabel(label: string) {
        return label
                .replace(/inspekcja\b/gi, "inspekcja")
                .replace(/inspekcji\b/gi, "inspekcji")
                .replace(/przed inspekcja\b/gi, "Przed inspekcją")
                .replace(/w trakcie inspekcji\b/gi, "W trakcie inspekcji")
                .replace(/po inspekcji\b/gi, "Po inspekcji")
                .replace(/rekomendacje\b/gi, "Rekomendacje")
                .replace(/wplynely\b/gi, "Wpłynęły")
                .replace(/wplynela\b/gi, "Wpłynęła")
                .replace(/zastrzezenia\b/gi, "zastrzeżenia")
                .replace(/odpowiedz\b/gi, "odpowiedź")
                .replace(/zamkniete\b/gi, "zamknięte")
                .replace(/piszemy zalecenia\b/gi, "Piszemy zalecenia")
                .replace(/pismo ustalenia\b/gi, "Pismo ustalenia");
}

function getInspectionCountLabel(count: number) {
	const absolute = Math.abs(Math.trunc(count));
	const mod10 = absolute % 10;
	const mod100 = absolute % 100;

	if (absolute === 1) {
		return "Inspekcja";
	}

	if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
		return "Inspekcje";
	}

	return "Inspekcji";
}

function renderDonutStatusTooltip({
	active,
	payload,
}: {
	active?: boolean;
	payload?: Array<{ payload?: { stageGroupLabel?: string } }>;
}) {
	if (!active || !payload || payload.length === 0) {
		return null;
	}

	const label = String(payload[0]?.payload?.stageGroupLabel ?? "Status").trim();

	return (
		<div
			className="max-w-[220px] whitespace-normal break-words rounded-[10px] border border-[#cbd5e1] bg-white px-3 py-2 text-slate-800 text-sm shadow-[0_8px_20px_rgba(2,8,23,0.08)]"
		>
			{label || "Status"}
		</div>
	);
}

function shouldHideInspectionStageStatus(stageLabel: string) {
        const normalized = normalizePolishLabel(stageLabel).trim().toLowerCase();
        if (!normalized) {
                return false;
        }

        return normalized.includes("zamknięte") || normalized.includes("nieprzypis");
}

function shouldHideRecommendationStatus(stageLabel: string) {
	const normalized = normalizePolishLabel(stageLabel).trim().toLowerCase();
	if (!normalized) {
		return false;
	}

	return (
		normalized.includes("zalecenia wykonano") ||
		normalized.includes("nieprzypisany status") ||
		normalized.includes("nieprzypisany")
	);
}

function shortenDuplicatedStatusLabel(label: string) {
        const normalized = String(label ?? "").trim();
        if (!normalized || normalized === "-") {
                return "-";
        }

        const separators = [/\s+i\s+/i, /\s*\/\s*/i, /\s*\|\s*/i, /\s*,\s*/i] as const;
        for (const separator of separators) {
                const parts = normalized
                        .split(separator)
                        .map((part) => part.trim())
                        .filter(Boolean);

                if (parts.length === 2) {
                        const left = parts[0] ?? "";
                        const right = parts[1] ?? "";
                        const leftKey = left.toLowerCase().replace(/\s+/g, " ");
                        const rightKey = right.toLowerCase().replace(/\s+/g, " ");
                        if (leftKey && leftKey === rightKey) {
                                return left;
                        }
                }
        }

        return normalized;
}

function buildStatusLabelVariants(label: string) {
	const variants = new Set<string>();
	const raw = String(label ?? "").trim();
	if (!raw || raw === "-") {
		return [] as string[];
	}

	const normalizedPolish = normalizePolishLabel(raw).trim();
	const shortened = shortenDuplicatedStatusLabel(raw).trim();
	const dashShort = raw.split("-")[0]?.trim() ?? "";
	const normalizedDashShort = normalizePolishLabel(dashShort).trim();

	for (const candidate of [raw, normalizedPolish, shortened, dashShort, normalizedDashShort]) {
		if (candidate && candidate !== "-") {
			variants.add(candidate);
		}
	}

	return Array.from(variants);
}

type StageFilter = {
        stageCode: string;
        stageLabel: string;
};

type StageOverviewSlice = {
        stageGroupCode: string;
        stageGroupLabel: string;
        count: number;
};

type RecommendationStatusFilter = {
        stageGroupCode: string;
        stageGroupLabel: string;
        stageGroupShortLabel?: string;
};

// Zmieniaj te wartości, aby ustawić startowe szerokości kolumn.
const DEFAULT_COLUMN_WIDTHS = {
	statusInspekcji: 240,
	kodInspekcji: 160,
	nazwaPodmiotu: 240,
	rodzajPodmiotu: 230,
	zakresInspekcji: 200,
	inspektorKierujacy: 240,
	poczatekInspekcji: 170,
	koniecInspekcji: 170,
} as const;

// Zmieniaj te wartości, aby ustawić minimalne szerokości kolumn.
const MIN_COLUMN_WIDTHS = {
	statusInspekcji: 160,
	kodInspekcji: 120,
	nazwaPodmiotu: 220,
	rodzajPodmiotu: 180,
	zakresInspekcji: 200,
	inspektorKierujacy: 180,
	poczatekInspekcji: 140,
	koniecInspekcji: 140,
} as const;

function resolveMinWidth(key: keyof typeof DEFAULT_COLUMN_WIDTHS) {
	// If default width is smaller than configured minimum, honor the default.
	return Math.min(MIN_COLUMN_WIDTHS[key], DEFAULT_COLUMN_WIDTHS[key]);
}

const TABLE_COLUMNS: Array<{
	key: keyof ReportInspectionDetailedRow;
	label: string;
	defaultWidth: number;
	minWidth: number;
}> = [
	{
		key: "statusInspekcji",
		label: "Status",
		defaultWidth: DEFAULT_COLUMN_WIDTHS.statusInspekcji,
		minWidth: resolveMinWidth("statusInspekcji"),
	},
	{
		key: "kodInspekcji",
		label: "Kod inspekcji",
		defaultWidth: DEFAULT_COLUMN_WIDTHS.kodInspekcji,
		minWidth: resolveMinWidth("kodInspekcji"),
	},
	{
		key: "nazwaPodmiotu",
		label: "Nazwa podmiotu",
		defaultWidth: DEFAULT_COLUMN_WIDTHS.nazwaPodmiotu,
		minWidth: resolveMinWidth("nazwaPodmiotu"),
	},
	{
		key: "rodzajPodmiotu",
		label: "Rodzaj podmiotu",
		defaultWidth: DEFAULT_COLUMN_WIDTHS.rodzajPodmiotu,
		minWidth: resolveMinWidth("rodzajPodmiotu"),
	},
	{
		key: "zakresInspekcji",
		label: "Zakres inspekcji",
		defaultWidth: DEFAULT_COLUMN_WIDTHS.zakresInspekcji,
		minWidth: resolveMinWidth("zakresInspekcji"),
	},
	{
		key: "inspektorKierujacy",
		label: "Inspektor kierujący",
		defaultWidth: DEFAULT_COLUMN_WIDTHS.inspektorKierujacy,
		minWidth: resolveMinWidth("inspektorKierujacy"),
	},
	{
		key: "poczatekInspekcji",
		label: "Początek inspekcji",
		defaultWidth: DEFAULT_COLUMN_WIDTHS.poczatekInspekcji,
		minWidth: resolveMinWidth("poczatekInspekcji"),
	},
	{
		key: "koniecInspekcji",
		label: "Koniec inspekcji",
		defaultWidth: DEFAULT_COLUMN_WIDTHS.koniecInspekcji,
		minWidth: resolveMinWidth("koniecInspekcji"),
	},
];

const INITIAL_COLUMN_WIDTHS: Record<keyof ReportInspectionDetailedRow, number> =
	TABLE_COLUMNS.reduce(
		(accumulator, column) => ({
			...accumulator,
			[column.key]: column.defaultWidth,
		}),
		{} as Record<keyof ReportInspectionDetailedRow, number>,
	);

const RECOMMENDATION_DEFAULT_COLUMN_WIDTHS = {
	status: 200,
	recommendationId: 140,
	inspectionId: 140,
	nazwaPodmiotu: 240,
	dataZalecen: 150,
	terminZalecen: 150,
	terminWykonaniaZalecen: 230,
	liczbaZalecen: 140,
} as const;

const RECOMMENDATION_MIN_COLUMN_WIDTHS = {
	status: 150,
	recommendationId: 120,
	inspectionId: 120,
	nazwaPodmiotu: 180,
	dataZalecen: 130,
	terminZalecen: 130,
	terminWykonaniaZalecen: 180,
	liczbaZalecen: 120,
} as const;

function resolveRecommendationMinWidth(
	key: keyof typeof RECOMMENDATION_DEFAULT_COLUMN_WIDTHS,
) {
	return Math.min(
		RECOMMENDATION_MIN_COLUMN_WIDTHS[key],
		RECOMMENDATION_DEFAULT_COLUMN_WIDTHS[key],
	);
}

const RECOMMENDATION_TABLE_COLUMNS: Array<{
	key: keyof ReportRecommendationDetailedRow;
	label: string;
	defaultWidth: number;
	minWidth: number;
}> = [
	{
		key: "status",
		label: "Status",
		defaultWidth: RECOMMENDATION_DEFAULT_COLUMN_WIDTHS.status,
		minWidth: resolveRecommendationMinWidth("status"),
	},
	{
		key: "recommendationId",
		label: "Id zalecenia",
		defaultWidth: RECOMMENDATION_DEFAULT_COLUMN_WIDTHS.recommendationId,
		minWidth: resolveRecommendationMinWidth("recommendationId"),
	},
	{
		key: "inspectionId",
		label: "Id inspekcji",
		defaultWidth: RECOMMENDATION_DEFAULT_COLUMN_WIDTHS.inspectionId,
		minWidth: resolveRecommendationMinWidth("inspectionId"),
	},
	{
		key: "nazwaPodmiotu",
		label: "Nazwa podmiotu",
		defaultWidth: RECOMMENDATION_DEFAULT_COLUMN_WIDTHS.nazwaPodmiotu,
		minWidth: resolveRecommendationMinWidth("nazwaPodmiotu"),
	},
	{
		key: "dataZalecen",
		label: "Data zaleceń",
		defaultWidth: RECOMMENDATION_DEFAULT_COLUMN_WIDTHS.dataZalecen,
		minWidth: resolveRecommendationMinWidth("dataZalecen"),
	},

	{
		key: "terminWykonaniaZalecen",
		label: "Termin wykonania zaleceń",
		defaultWidth: RECOMMENDATION_DEFAULT_COLUMN_WIDTHS.terminWykonaniaZalecen,
		minWidth: resolveRecommendationMinWidth("terminWykonaniaZalecen"),
	},
	{
		key: "liczbaZalecen",
		label: "Liczba zaleceń",
		defaultWidth: RECOMMENDATION_DEFAULT_COLUMN_WIDTHS.liczbaZalecen,
		minWidth: resolveRecommendationMinWidth("liczbaZalecen"),
	},
];

const INITIAL_RECOMMENDATION_COLUMN_WIDTHS: Record<
	keyof ReportRecommendationDetailedRow,
	number
> = RECOMMENDATION_TABLE_COLUMNS.reduce(
	(accumulator, column) => ({
		...accumulator,
		[column.key]: column.defaultWidth,
	}),
	{} as Record<keyof ReportRecommendationDetailedRow, number>,
);

export function WelcomeStartPanel({ operatorLogin }: WelcomeStartPanelProps) {
	const [activeTopSection, setActiveTopSection] = useState<"inspections" | "recommendations">(
		getStoredDashboardActiveSection,
	);
	const [rows, setRows] = useState<ReportInspectionDetailedRow[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [stageSummary, setStageSummary] =
		useState<ReportsInspectionsStageSummaryResponse | null>(null);
	const [isStageSummaryLoading, setIsStageSummaryLoading] = useState(true);
	const [stageSummaryError, setStageSummaryError] = useState<string | null>(null);
	const [selectedStageFilters, setSelectedStageFilters] = useState<StageFilter[]>(
		getStoredInspectionStageFilters,
	);
	const [isInspectionSummaryCollapsed, setIsInspectionSummaryCollapsed] = useState(
		getStoredInspectionSummaryCollapsed,
	);
	const [columnWidths, setColumnWidths] = useState(INITIAL_COLUMN_WIDTHS);
	const [recommendationRows, setRecommendationRows] = useState<ReportRecommendationDetailedRow[]>(
		[],
	);
	const [isRecommendationsLoading, setIsRecommendationsLoading] = useState(true);
	const [recommendationsError, setRecommendationsError] = useState<string | null>(null);
	const [recommendationSummary, setRecommendationSummary] =
		useState<ReportsRecommendationsStageSummaryResponse | null>(null);
	const [isRecommendationSummaryLoading, setIsRecommendationSummaryLoading] = useState(true);
	const [recommendationSummaryError, setRecommendationSummaryError] = useState<string | null>(
		null,
	);
	const [isRecommendationSummaryCollapsed, setIsRecommendationSummaryCollapsed] =
		useState(getStoredRecommendationSummaryCollapsed);
	const [selectedRecommendationStatuses, setSelectedRecommendationStatuses] = useState<
		RecommendationStatusFilter[]
	>(getStoredRecommendationStatusFilters);
	const [recommendationColumnWidths, setRecommendationColumnWidths] = useState(
		INITIAL_RECOMMENDATION_COLUMN_WIDTHS,
	);
	const [hoveredStageSliceIndex, setHoveredStageSliceIndex] = useState<number | null>(
		null,
	);
	const [hoveredRecommendationSliceIndex, setHoveredRecommendationSliceIndex] = useState<
		number | null
	>(null);
	const [inspectionStatusStyleByCode, setInspectionStatusStyleByCode] = useState<
		Record<string, InspectionStatusStyle>
	>({});
	const [recommendationStatusStyleByCode, setRecommendationStatusStyleByCode] = useState<
		Record<string, InspectionStatusStyle>
	>({});

	const authRole = useMemo(() => {
		const storedRole = getStoredAuthSession()?.user?.rola;
		return normalizeAuthRole(storedRole);
	}, []);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		window.sessionStorage.setItem(DASHBOARD_ACTIVE_TOP_SECTION_KEY, activeTopSection);
	}, [activeTopSection]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		window.sessionStorage.setItem(
			DASHBOARD_SELECTED_INSPECTION_STAGE_FILTERS_KEY,
			JSON.stringify(selectedStageFilters),
		);
	}, [selectedStageFilters]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		window.sessionStorage.setItem(
			DASHBOARD_INSPECTION_SUMMARY_COLLAPSED_KEY,
			isInspectionSummaryCollapsed ? "1" : "0",
		);
	}, [isInspectionSummaryCollapsed]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		window.sessionStorage.setItem(
			DASHBOARD_SELECTED_RECOMMENDATION_STATUSES_KEY,
			JSON.stringify(selectedRecommendationStatuses),
		);
	}, [selectedRecommendationStatuses]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		window.sessionStorage.setItem(
			DASHBOARD_RECOMMENDATION_SUMMARY_COLLAPSED_KEY,
			isRecommendationSummaryCollapsed ? "1" : "0",
		);
	}, [isRecommendationSummaryCollapsed]);

	const loadInspections = useCallback(async () => {
		setIsLoading(true);
		setIsStageSummaryLoading(true);
		setError(null);
		setStageSummaryError(null);

		const [detailedResult, summaryResult] = await Promise.all([
			fetchInspectionsDetailedReport(operatorLogin),
			fetchInspectionsStageSummary(operatorLogin),
		]);

		if (!detailedResult.ok) {
			setRows([]);
			setError(detailedResult.error);
		} else {
			setRows(detailedResult.data.rows);
		}

		if (!summaryResult.ok) {
			setStageSummary(null);
			setStageSummaryError(summaryResult.error);
		} else {
			setStageSummary(summaryResult.data);
		}

		setIsLoading(false);
		setIsStageSummaryLoading(false);
	}, [operatorLogin]);

	const loadRecommendations = useCallback(async () => {
		setIsRecommendationsLoading(true);
		setIsRecommendationSummaryLoading(true);
		setRecommendationsError(null);
		setRecommendationSummaryError(null);

		const [detailedResult, summaryResult] = await Promise.all([
			fetchRecommendationsDetailedReport(operatorLogin),
			fetchRecommendationsStageSummary(operatorLogin),
		]);

		if (!detailedResult.ok) {
			setRecommendationRows([]);
			setRecommendationsError(detailedResult.error);
		} else {
			setRecommendationRows(detailedResult.data.rows);
		}

		if (!summaryResult.ok) {
			setRecommendationSummary(null);
			setRecommendationSummaryError(summaryResult.error);
		} else {
			setRecommendationSummary(summaryResult.data);
		}

		setIsRecommendationsLoading(false);
		setIsRecommendationSummaryLoading(false);
	}, [operatorLogin]);

	useEffect(() => {
		void loadInspections();
	}, [loadInspections]);

	useEffect(() => {
		void loadRecommendations();
	}, [loadRecommendations]);

	useEffect(() => {
		let isMounted = true;

		const loadInspectionStatusStyles = async () => {
			const result = await fetchDictionaryEntries("statusy_inspekcji", operatorLogin);
			if (!isMounted) {
				return;
			}

			if (!result.ok) {
				setInspectionStatusStyleByCode({});
				return;
			}

			const nextStyleByCode: Record<string, InspectionStatusStyle> = {};
			const addStatusStyle = (rawKey: string | null | undefined, style: InspectionStatusStyle) => {
				const normalizedKey = String(rawKey ?? "").trim().toUpperCase();
				if (!normalizedKey) {
					return;
				}

				nextStyleByCode[normalizedKey] = style;
			};

			for (const entry of result.data) {
				const style: InspectionStatusStyle = {
					kolor: entry.kolor ?? null,
					odcien: entry.odcien ?? null,
					intensywnosc: entry.intensywnosc ?? null,
				};

				addStatusStyle(entry.kodPozycji, style);
				addStatusStyle(entry.skrotPozycji, style);
				addStatusStyle(entry.nazwaPozycji, style);
			}

			setInspectionStatusStyleByCode(nextStyleByCode);
		};

		void loadInspectionStatusStyles();

		return () => {
			isMounted = false;
		};
	}, [operatorLogin]);

	useEffect(() => {
		let isMounted = true;

		const loadRecommendationStatusStyles = async () => {
			const result = await fetchDictionaryEntries("statusy_zalecen", operatorLogin);
			if (!isMounted) {
				return;
			}

			if (!result.ok) {
				setRecommendationStatusStyleByCode({});
				return;
			}

			const nextStyleByCode: Record<string, InspectionStatusStyle> = {};
			const addStatusStyle = (
				rawKey: string | null | undefined,
				style: InspectionStatusStyle,
			) => {
				const normalizedKey = String(rawKey ?? "").trim().toUpperCase();
				if (!normalizedKey) {
					return;
				}

				nextStyleByCode[normalizedKey] = style;
			};

			for (const entry of result.data) {
				const style: InspectionStatusStyle = {
					kolor: entry.kolor ?? null,
					odcien: entry.odcien ?? null,
					intensywnosc: entry.intensywnosc ?? null,
				};

				addStatusStyle(entry.kodPozycji, style);
				addStatusStyle(entry.skrotPozycji, style);
				addStatusStyle(entry.nazwaPozycji, style);
			}

			setRecommendationStatusStyleByCode(nextStyleByCode);
		};

		void loadRecommendationStatusStyles();

		return () => {
			isMounted = false;
		};
	}, [operatorLogin]);

	useEffect(() => {
		if (isLoading || rows.length === 0) {
			return;
		}

		const leaderCurrentCount = rows.filter((row) => row.isLeaderCurrentUser).length;
		const leaderInManagerTeamCount = rows.filter(
			(row) => row.isLeaderInManagerTeam,
		).length;
		const memberCurrentCount = rows.filter((row) => row.isMemberCurrentUser).length;
		const memberInManagerTeamCount = rows.filter(
			(row) => row.isMemberInManagerTeam,
		).length;

		if (ENABLE_DASHBOARD_DEBUG_LOGS) {
			console.groupCollapsed("[Dashboard][inspections-detailed] flags summary");
			console.info("role", authRole);
			console.info("rows", rows.length);
			console.info("isLeaderCurrentUser", leaderCurrentCount);
			console.info("isLeaderInManagerTeam", leaderInManagerTeamCount);
			console.info("isMemberCurrentUser", memberCurrentCount);
			console.info("isMemberInManagerTeam", memberInManagerTeamCount);
			console.table(
				rows.slice(0, 15).map((row) => ({
					kodInspekcji: row.kodInspekcji,
					status: row.statusInspekcji,
					inspektorKierujacy: row.inspektorKierujacy,
					isLeaderCurrentUser: row.isLeaderCurrentUser,
					isLeaderInManagerTeam: row.isLeaderInManagerTeam,
					isMemberCurrentUser: row.isMemberCurrentUser,
					isMemberInManagerTeam: row.isMemberInManagerTeam,
				})),
			);
			console.groupEnd();
		}
	}, [authRole, isLoading, rows]);

	const orderedStageStatuses = useMemo(
		() => {
			const customOrderIndexByCode = new Map<string, number>();
			for (const [index, code] of INSPECTION_STAGE_ORDER_BY_CODE.entries()) {
				const normalizedCode = String(code ?? "").trim().toLowerCase();
				if (!normalizedCode || customOrderIndexByCode.has(normalizedCode)) {
					continue;
				}

				customOrderIndexByCode.set(normalizedCode, index);
			}

			return (stageSummary?.statuses ?? [])
				.slice()
				.sort((left, right) => {
					const leftCode = String(left.stageGroupCode ?? "").trim().toLowerCase();
					const rightCode = String(right.stageGroupCode ?? "").trim().toLowerCase();
					const leftCustomRank = customOrderIndexByCode.get(leftCode);
					const rightCustomRank = customOrderIndexByCode.get(rightCode);

					if (leftCustomRank !== undefined && rightCustomRank !== undefined) {
						if (leftCustomRank !== rightCustomRank) {
							return leftCustomRank - rightCustomRank;
						}
					}

					if (leftCustomRank !== undefined) {
						return -1;
					}

					if (rightCustomRank !== undefined) {
						return 1;
					}

					return left.stageGroupOrder - right.stageGroupOrder;
				})
				.map((status) => ({
					stageCode: status.stageGroupCode,
					stageLabel: normalizePolishLabel(status.stageGroupLabel),
					count: status.count,
				}))
				.filter(
					(status) =>
						status.stageLabel.trim().length > 0 &&
						!shouldHideInspectionStageStatus(status.stageLabel),
				);
		},
		[stageSummary],
	);

	const stageOverviewData = useMemo<StageOverviewSlice[]>(
		() =>
			orderedStageStatuses.map((status) => ({
				stageGroupCode: status.stageCode,
				stageGroupLabel: status.stageLabel,
				count: status.count,
			})),
		[orderedStageStatuses],
	);

	const stageOverviewTotal = useMemo(
		() => stageOverviewData.reduce((sum, slice) => sum + slice.count, 0),
		[stageOverviewData],
	);

	useEffect(() => {
		if (
			hoveredStageSliceIndex !== null &&
			(hoveredStageSliceIndex < 0 || hoveredStageSliceIndex >= stageOverviewData.length)
		) {
			setHoveredStageSliceIndex(null);
		}
	}, [hoveredStageSliceIndex, stageOverviewData.length]);

	const visibleStageStatuses = useMemo(
		() =>
			orderedStageStatuses.map((status) => ({
				stageCode: status.stageCode,
				stageLabel: status.stageLabel,
				count: status.count,
			})),
		[orderedStageStatuses],
	);

	const shouldShowInspectionStatusScroll =
		visibleStageStatuses.length > INSPECTION_STATUS_SCROLL_THRESHOLD;

	const inspectionStageLabelByCode = useMemo(() => {
		const map = new Map<string, string>();
		for (const status of stageSummary?.statuses ?? []) {
			const code = String(status.stageGroupCode ?? "").trim().toLowerCase();
			const label = normalizePolishLabel(String(status.stageGroupLabel ?? "").trim());
			if (!code || !label || label === "-") {
				continue;
			}
			map.set(code, label);
		}
		return map;
	}, [stageSummary]);

	const resolveInspectionStatusLabel = useCallback(
		(row: ReportInspectionDetailedRow) => {
			const groupCode = row.stageGroupCode.trim().toLowerCase();
			const subgroupCode = row.stageSubgroupCode.trim().toLowerCase();
			const mappedLabel =
				inspectionStageLabelByCode.get(groupCode) ??
				inspectionStageLabelByCode.get(subgroupCode);

			if (mappedLabel) {
				return mappedLabel;
			}

			return shortenDuplicatedStatusLabel(String(row.statusInspekcji ?? "-"));
		},
		[inspectionStageLabelByCode],
	);

	const inspectionStatusKeysByStageCode = useMemo(() => {
		const byCode = new Map<string, Set<string>>();

		for (const row of rows) {
			const normalizedCodes = [row.stageGroupCode, row.stageSubgroupCode]
				.map((value) => String(value ?? "").trim().toLowerCase())
				.filter(Boolean);
			if (normalizedCodes.length === 0) {
				continue;
			}

			const rowKeys = [
				String(row.stageGroupCode ?? "").trim(),
				String(row.stageSubgroupCode ?? "").trim(),
				...buildStatusLabelVariants(String(row.statusInspekcji ?? "")),
			].filter(Boolean);

			for (const normalizedCode of normalizedCodes) {
				const keySet = byCode.get(normalizedCode) ?? new Set<string>();
				for (const rowKey of rowKeys) {
					keySet.add(rowKey);
				}
				byCode.set(normalizedCode, keySet);
			}
		}

		return byCode;
	}, [rows]);

	const inspectionStatusKeysByStageLabel = useMemo(() => {
		const byLabel = new Map<string, Set<string>>();

		for (const row of rows) {
			const rowLabelVariants = buildStatusLabelVariants(String(row.statusInspekcji ?? ""));
			if (rowLabelVariants.length === 0) {
				continue;
			}

			const rowKeys = [
				String(row.stageGroupCode ?? "").trim(),
				String(row.stageSubgroupCode ?? "").trim(),
				...rowLabelVariants,
			].filter(Boolean);

			for (const rowLabelVariant of rowLabelVariants) {
				const normalizedLabelKey = rowLabelVariant.trim().toLowerCase();
				if (!normalizedLabelKey) {
					continue;
				}

				const keySet = byLabel.get(normalizedLabelKey) ?? new Set<string>();
				for (const rowKey of rowKeys) {
					keySet.add(rowKey);
				}
				byLabel.set(normalizedLabelKey, keySet);
			}
		}

		return byLabel;
	}, [rows]);

	useEffect(() => {
		if (visibleStageStatuses.length === 0) {
			if (selectedStageFilters.length > 0) {
				setSelectedStageFilters([]);
			}
			return;
		}

		const allowedCodes = new Set(
			visibleStageStatuses.map((status) => status.stageCode.trim().toLowerCase()),
		);
		const nextFilters = selectedStageFilters.filter((filter) =>
			allowedCodes.has(filter.stageCode.trim().toLowerCase()),
		);

		if (nextFilters.length !== selectedStageFilters.length) {
			setSelectedStageFilters(nextFilters);
		}
	}, [selectedStageFilters, visibleStageStatuses]);

	const orderedRecommendationGroups = useMemo(
		() =>
			(recommendationSummary?.groups ?? [])
				.slice()
				.sort((left, right) => left.stageGroupOrder - right.stageGroupOrder)
				.map((group) => ({
					...group,
					stageGroupLabel: normalizePolishLabel(group.stageGroupLabel),
					stageGroupShortLabel: normalizePolishLabel(group.stageGroupShortLabel),
				}))
				.filter(
					(group) =>
						!shouldHideRecommendationStatus(group.stageGroupLabel) &&
						!shouldHideRecommendationStatus(group.stageGroupShortLabel),
				),
		[recommendationSummary],
	);

	const shouldShowRecommendationStatusScroll =
		orderedRecommendationGroups.length > RECOMMENDATION_STATUS_SCROLL_THRESHOLD;

	useEffect(() => {
		if (orderedRecommendationGroups.length === 0) {
			if (selectedRecommendationStatuses.length > 0) {
				setSelectedRecommendationStatuses([]);
			}
			return;
		}

		const allowedCodes = new Set(
			orderedRecommendationGroups.map((group) =>
				group.stageGroupCode.trim().toLowerCase(),
			),
		);
		const nextFilters = selectedRecommendationStatuses.filter((filter) =>
			allowedCodes.has(filter.stageGroupCode.trim().toLowerCase()),
		);

		if (nextFilters.length !== selectedRecommendationStatuses.length) {
			setSelectedRecommendationStatuses(nextFilters);
		}
	}, [orderedRecommendationGroups, selectedRecommendationStatuses]);

	const recommendationOverviewData = useMemo<StageOverviewSlice[]>(
		() =>
			orderedRecommendationGroups.map((group) => ({
				stageGroupCode: group.stageGroupCode,
				stageGroupLabel: group.stageGroupShortLabel || group.stageGroupLabel,
				count: group.count,
			})),
		[orderedRecommendationGroups],
	);

	const recommendationOverviewTotal = useMemo(
		() => recommendationOverviewData.reduce((sum, slice) => sum + slice.count, 0),
		[recommendationOverviewData],
	);

	useEffect(() => {
		if (
			hoveredRecommendationSliceIndex !== null &&
			(hoveredRecommendationSliceIndex < 0 ||
				hoveredRecommendationSliceIndex >= recommendationOverviewData.length)
		) {
			setHoveredRecommendationSliceIndex(null);
		}
	}, [hoveredRecommendationSliceIndex, recommendationOverviewData.length]);

	const visibleRecommendationRows = useMemo(
		() =>
			recommendationRows.filter((row) => {
				const status = String(row.status ?? "");
				const statusShort = String(row.statusSkrot ?? "");
				return (
					!shouldHideRecommendationStatus(status) &&
					!shouldHideRecommendationStatus(statusShort)
				);
			}),
		[recommendationRows],
	);

	const recommendationStatusKeysByGroupCode = useMemo(() => {
		const byCode = new Map<string, Set<string>>();

		for (const group of orderedRecommendationGroups) {
			const groupCode = String(group.stageGroupCode ?? "").trim().toLowerCase();
			if (!groupCode) {
				continue;
			}

			const groupLabel = String(group.stageGroupLabel ?? "").trim().toLowerCase();
			const groupShortLabel = String(group.stageGroupShortLabel ?? "")
				.trim()
				.toLowerCase();
			const keySet = byCode.get(groupCode) ?? new Set<string>();

			for (const row of visibleRecommendationRows) {
				const rowStatus = String(row.status ?? "").trim();
				const rowStatusShort = String(row.statusSkrot ?? "").trim();
				const normalizedRowStatus = rowStatus.toLowerCase();
				const normalizedRowStatusShort = rowStatusShort.toLowerCase();
				const rowStatusDashShort = rowStatus.split("-")[0]?.trim().toLowerCase() ?? "";

				const matchesGroup =
					normalizedRowStatus === groupCode ||
					(groupLabel && normalizedRowStatus === groupLabel) ||
					(groupShortLabel && normalizedRowStatusShort === groupShortLabel) ||
					(groupLabel && normalizedRowStatus.includes(groupLabel)) ||
					(groupLabel && groupLabel.includes(normalizedRowStatus)) ||
					(groupShortLabel && normalizedRowStatusShort.includes(groupShortLabel)) ||
					(groupShortLabel && groupShortLabel.includes(normalizedRowStatusShort)) ||
					(groupShortLabel && rowStatusDashShort === groupShortLabel);

				if (!matchesGroup) {
					continue;
				}

				if (rowStatus) {
					keySet.add(rowStatus);
					for (const variant of buildStatusLabelVariants(rowStatus)) {
						keySet.add(variant);
					}
				}

				if (rowStatusShort) {
					keySet.add(rowStatusShort);
					for (const variant of buildStatusLabelVariants(rowStatusShort)) {
						keySet.add(variant);
					}
				}
			}

			byCode.set(groupCode, keySet);
		}

		return byCode;
	}, [orderedRecommendationGroups, visibleRecommendationRows]);

	const filteredRecommendationRows = useMemo(() => {
		if (selectedRecommendationStatuses.length === 0) {
			return visibleRecommendationRows;
		}

		const selectedCodes = new Set(
			selectedRecommendationStatuses.map((filter) => filter.stageGroupCode.trim().toLowerCase()),
		);
		const selectedLabels = new Set(
			selectedRecommendationStatuses.map((filter) =>
				filter.stageGroupLabel.trim().toLowerCase(),
			),
		);
		const selectedShortLabels = new Set(
			selectedRecommendationStatuses
				.map((filter) => (filter.stageGroupShortLabel ?? "").trim().toLowerCase())
				.filter(Boolean),
		);

		return visibleRecommendationRows.filter((row) => {
			const normalizedStatus = row.status.trim().toLowerCase();
			const normalizedStatusSkrot = row.statusSkrot.trim().toLowerCase();
			return (
				selectedCodes.has(normalizedStatus) ||
				selectedLabels.has(normalizedStatus) ||
				selectedShortLabels.has(normalizedStatusSkrot)
			);
		});
	}, [selectedRecommendationStatuses, visibleRecommendationRows]);

	const filteredRows = useMemo(() => {
		const statusOrder = orderedStageStatuses.map((status) =>
			normalizePolishLabel(status.stageLabel).trim().toLowerCase(),
		);

		const findStatusRank = (row: ReportInspectionDetailedRow) => {
			const normalizedStageLabel = normalizePolishLabel(String(row.statusInspekcji ?? "-"))
				.trim()
				.toLowerCase();
			const normalizedStageLabelShort = shortenDuplicatedStatusLabel(normalizedStageLabel)
				.trim()
				.toLowerCase();

			const rank = statusOrder.findIndex((label) => {
				const shortLabel = shortenDuplicatedStatusLabel(label).trim().toLowerCase();
				return (
					label === normalizedStageLabel ||
					shortLabel === normalizedStageLabelShort ||
					label.includes(normalizedStageLabelShort) ||
					normalizedStageLabel.includes(label)
				);
			});

			return rank >= 0 ? rank : Number.MAX_SAFE_INTEGER;
		};

		const sortRowsByStatusOrder = (inputRows: ReportInspectionDetailedRow[]) =>
			inputRows
				.map((row, originalIndex) => ({ row, originalIndex }))
				.sort((left, right) => {
					const leftRank = findStatusRank(left.row);
					const rightRank = findStatusRank(right.row);
					if (leftRank !== rightRank) {
						return leftRank - rightRank;
					}
					return left.originalIndex - right.originalIndex;
				})
				.map((entry) => entry.row);

		if (selectedStageFilters.length === 0) {
			return sortRowsByStatusOrder(rows);
		}

		const selectedCodes = new Set(
			selectedStageFilters.map((filter) => filter.stageCode.trim().toLowerCase()),
		);
		const selectedLabelsRaw = selectedStageFilters
			.map((filter) => normalizePolishLabel(filter.stageLabel).trim().toLowerCase())
			.filter(Boolean);
		const selectedLabels = new Set(selectedLabelsRaw);
		const selectedShortLabels = new Set(
			selectedLabelsRaw
				.map((label) => shortenDuplicatedStatusLabel(label).trim().toLowerCase())
				.filter(Boolean),
		);

		const filtered = rows.filter((row) => {
			const normalizedGroupCode = row.stageGroupCode.trim().toLowerCase();
			const normalizedSubgroupCode = row.stageSubgroupCode.trim().toLowerCase();
			const normalizedStageLabel = normalizePolishLabel(String(row.statusInspekcji ?? "-"))
				.trim()
				.toLowerCase();
			const normalizedStageLabelShort = shortenDuplicatedStatusLabel(normalizedStageLabel)
				.trim()
				.toLowerCase();

			const matchesLabel =
				selectedLabels.has(normalizedStageLabel) ||
				selectedShortLabels.has(normalizedStageLabelShort) ||
				selectedLabelsRaw.some(
					(label) =>
						label.includes(normalizedStageLabelShort) ||
						normalizedStageLabel.includes(label),
				);

			return (
				selectedCodes.has(normalizedGroupCode) ||
				selectedCodes.has(normalizedSubgroupCode) ||
				matchesLabel
			);
		});

		return sortRowsByStatusOrder(filtered);
	}, [orderedStageStatuses, rows, selectedStageFilters]);

	useEffect(() => {
		if (activeTopSection !== "inspections") {
			return;
		}

		const displayedStatusRows = filteredRows.map((row) => ({
			kodInspekcji: row.kodInspekcji,
			statusRaw: String(row.statusInspekcji ?? "-"),
			statusDisplayed: resolveInspectionStatusLabel(row),
		}));

		if (ENABLE_DASHBOARD_DEBUG_LOGS) {
			console.groupCollapsed("[Dashboard][inspections-status-column] displayed values");
			console.table(displayedStatusRows);
			console.groupEnd();
		}
	}, [activeTopSection, filteredRows, resolveInspectionStatusLabel]);

	const startColumnResize = useCallback(
		(columnKey: keyof ReportInspectionDetailedRow, event: React.MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();

			const startX = event.clientX;
			const startWidth = columnWidths[columnKey] ?? 180;
			const minWidth = TABLE_COLUMNS.find((column) => column.key === columnKey)?.minWidth ?? 100;

			const handleMouseMove = (mouseEvent: MouseEvent) => {
				const deltaX = mouseEvent.clientX - startX;
				setColumnWidths((current) => ({
					...current,
					[columnKey]: Math.max(minWidth, startWidth + deltaX),
				}));
			};

			const handleMouseUp = () => {
				window.removeEventListener("mousemove", handleMouseMove);
				window.removeEventListener("mouseup", handleMouseUp);
				document.body.style.cursor = "";
				document.body.style.userSelect = "";
			};

			document.body.style.cursor = "col-resize";
			document.body.style.userSelect = "none";
			window.addEventListener("mousemove", handleMouseMove);
			window.addEventListener("mouseup", handleMouseUp);
		},
		[columnWidths],
	);

	const startRecommendationColumnResize = useCallback(
		(columnKey: keyof ReportRecommendationDetailedRow, event: React.MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();

			const startX = event.clientX;
			const startWidth = recommendationColumnWidths[columnKey] ?? 160;
			const minWidth =
				RECOMMENDATION_TABLE_COLUMNS.find((column) => column.key === columnKey)?.minWidth ?? 100;

			const handleMouseMove = (mouseEvent: MouseEvent) => {
				const deltaX = mouseEvent.clientX - startX;
				setRecommendationColumnWidths((current) => ({
					...current,
					[columnKey]: Math.max(minWidth, startWidth + deltaX),
				}));
			};

			const handleMouseUp = () => {
				window.removeEventListener("mousemove", handleMouseMove);
				window.removeEventListener("mouseup", handleMouseUp);
				document.body.style.cursor = "";
				document.body.style.userSelect = "";
			};

			document.body.style.cursor = "col-resize";
			document.body.style.userSelect = "none";
			window.addEventListener("mousemove", handleMouseMove);
			window.addEventListener("mouseup", handleMouseUp);
		},
		[recommendationColumnWidths],
	);

	return (
		<section className="flex h-full min-h-0 w-full flex-col py-2">
			{error ? (
				<p className="mb-3 rounded-lg border border-rose-300/50 bg-rose-950/30 px-3 py-2 text-rose-100 text-sm">
					{error}
				</p>
			) : null}

			<div className="mb-3 flex flex-wrap items-end gap-2 border-[#2a4772] border-b">
				<button
					type="button"
					onClick={() => setActiveTopSection("inspections")}
					className={`-mb-px inline-flex h-9 items-center rounded-t-md border px-3.5 font-semibold text-sm transition-colors ${
						activeTopSection === "inspections"
							? "border-[#8fb6ee] border-b-[#101f39] bg-[#f8fbff] text-slate-900"
							: "border-transparent bg-transparent text-white hover:bg-[#18365a]/35 hover:text-white"
					}`}
				>
					Inspekcje
				</button>
				<button
					type="button"
					onClick={() => setActiveTopSection("recommendations")}
					className={`-mb-px inline-flex h-9 items-center rounded-t-md border px-3.5 font-semibold text-sm transition-colors ${
						activeTopSection === "recommendations"
							? "border-[#8fb6ee] border-b-[#101f39] bg-[#f8fbff] text-slate-900"
							: "border-transparent bg-transparent text-white hover:bg-[#18365a]/35 hover:text-white"
					}`}
				>
					Zalecenia
				</button>
			</div>

			{activeTopSection === "inspections" ? (
				<>
			<div className="mb-1 shrink-0 overflow-hidden rounded-2xl border border-slate-300 bg-white">
				<div
					className="flex cursor-pointer items-center justify-between gap-2 border-slate-300 border-b bg-slate-100 px-3 py-2"
					onClick={() => setIsInspectionSummaryCollapsed((current) => !current)}
					role="button"
					tabIndex={0}
					onKeyDown={(event) => {
						if (event.key === "Enter" || event.key === " ") {
							event.preventDefault();
							setIsInspectionSummaryCollapsed((current) => !current);
						}
					}}
					aria-expanded={!isInspectionSummaryCollapsed}
					aria-controls="inspection-summary-panel"
				>
					<div className="inline-flex items-center gap-2 text-left text-slate-800 text-xs transition-colors hover:text-slate-900">
						{isInspectionSummaryCollapsed ? (
							<ChevronRight className="h-4 w-4 shrink-0" />
						) : (
							<ChevronDown className="h-4 w-4 shrink-0" />
						)}
						<span className="font-semibold text-sm tracking-wide">Podsumowanie inspekcji</span>
					</div>

					<button
						type="button"
						onClick={(event) => {
							event.stopPropagation();
							setSelectedStageFilters([]);
						}}
						disabled={selectedStageFilters.length === 0}
						className={`rounded px-2 py-1 text-xs transition-colors ${
							selectedStageFilters.length === 0
								? "cursor-not-allowed text-slate-400"
								: "cursor-pointer font-semibold text-[#1f4f8f] hover:bg-slate-200 hover:text-[#163a68]"
						}`}
					>
						Wyczyść filtry
					</button>
				</div>

				{isInspectionSummaryCollapsed ? null : (
			<div id="inspection-summary-panel" className="px-2.5 pt-1.5 pb-1 text-slate-900">

				{stageSummaryError ? (
					<p className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 text-xs">
						{stageSummaryError}
					</p>
				) : null}

				{isStageSummaryLoading ? (
					<div className="flex h-[300px] items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500 text-sm">
						Ładowanie wykresu etapów...
					</div>
				) : visibleStageStatuses.length === 0 ? (
					<div className="flex h-[300px] items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500 text-sm">
						Brak danych etapów do wykresu.
					</div>
				) : (
					<div className="grid grid-cols-1 items-start gap-2 xl:grid-cols-[minmax(0,1fr)_minmax(480px,620px)]">
						<div className="rounded-xl border border-slate-300 bg-white p-1.5">
							<div
								className={`welcome-scroll-subtle pr-1 ${
									shouldShowInspectionStatusScroll ? "overflow-y-auto" : "overflow-y-hidden"
								}`}
								style={{ maxHeight: `${INSPECTION_STATUS_LIST_MAX_HEIGHT_PX}px` }}
							>
								{visibleStageStatuses.map((status, index) => {
									const isSelected = selectedStageFilters.some(
										(filter) => filter.stageCode === status.stageCode,
									);
									const statusColor = STAGE_OVERVIEW_COLORS[index % STAGE_OVERVIEW_COLORS.length];
									const statusLabelVariants = buildStatusLabelVariants(status.stageLabel);
									const rowDerivedStatusKeys = Array.from(
										inspectionStatusKeysByStageCode.get(
											status.stageCode.trim().toLowerCase(),
										) ?? [],
									);
									const rowDerivedLabelStatusKeys = Array.from(
										new Set(
											statusLabelVariants.flatMap((variant) =>
												Array.from(
													inspectionStatusKeysByStageLabel.get(
														variant.trim().toLowerCase(),
													) ?? [],
												),
											),
										),
									);
									const statusLegendColor = resolveStatusBackgroundColor(
										[
											status.stageCode,
											status.stageLabel,
											normalizePolishLabel(status.stageLabel),
											...statusLabelVariants,
											...rowDerivedStatusKeys,
											...rowDerivedLabelStatusKeys,
										],
										inspectionStatusStyleByCode,
									);
									const isZero = status.count === 0;

									return (
										<button
											key={`${status.stageCode}-${status.stageLabel}`}
											type="button"
											onClick={() => {
												setSelectedStageFilters((current) => {
													const isAlreadySelected = current.some(
														(filter) => filter.stageCode === status.stageCode,
													);

													if (isAlreadySelected) {
														return current.filter(
															(filter) => filter.stageCode !== status.stageCode,
														);
													}

													return [
														...current,
														{
															stageCode: status.stageCode,
															stageLabel: status.stageLabel,
														},
													];
												});
											}}
											className={`grid w-full grid-cols-[56px_auto_minmax(0,1fr)] items-center border-slate-200 border-b px-2.5 py-1.5 text-left text-sm transition-colors last:border-b-0 ${
												isSelected
													? "cursor-pointer bg-[#dbeafe] ring-1 ring-inset ring-[#93c5fd] shadow-[inset_3px_0_0_#2563eb]"
													: "cursor-pointer hover:bg-slate-50"
											}`}
										>
												<span className="mr-2 inline-flex items-center justify-center">
													<span
														className="inline-block h-4 w-8 rounded-[4px] border border-slate-300"
														style={{ backgroundColor: statusLegendColor }}
													/>
												</span>
												<span className="mr-3 flex items-center justify-start pr-2">
													<span
														className={`inline-flex items-center justify-center rounded-full px-2.5 py-0.5 font-semibold text-[11px] tabular-nums ${
															isZero
																? "bg-slate-200 text-slate-700"
																: "text-white shadow-[inset_0_-1px_0_rgba(255,255,255,0.2)]"
														}`}
														style={
															isZero
																? { width: "2.5rem" }
																: { width: "2.5rem", backgroundColor: statusColor }
														}
													>
													{status.count}
												</span>
											</span>
												<span className="min-w-0 whitespace-normal break-words text-slate-700 text-sm leading-snug">
													{status.stageLabel}
												</span>
										</button>
									);
								})}
							</div>
						</div>

						{stageOverviewData.length > 0 ? (
							<div className="flex min-h-[370px] rounded-xl border border-slate-300 bg-white p-1.5">
								<div className="grid h-full w-full grid-cols-1 items-center">
									<div className="relative mx-auto h-[290px] w-full max-w-[560px] sm:h-[340px] lg:h-full lg:min-h-[340px]">
										<ResponsiveContainer width="100%" height="100%">
											<PieChart margin={{ top: 16, right: 16, bottom: 16, left: 16 }}>
												<Pie
													data={stageOverviewData}
													dataKey="count"
													nameKey="stageGroupLabel"
													cx="50%"
													cy="50%"
													innerRadius="58%"
													outerRadius="92%"
													paddingAngle={2}
													isAnimationActive={false}
													activeIndex={hoveredStageSliceIndex ?? undefined}
													onMouseEnter={(_entry, index) => setHoveredStageSliceIndex(index)}
													onMouseLeave={() => setHoveredStageSliceIndex(null)}
													labelLine={false}
													label={({
														cx,
														cy,
														midAngle,
														innerRadius,
														outerRadius,
														value,
													}) => {
														if (
															typeof value !== "number" ||
															value <= 0 ||
															typeof cx !== "number" ||
															typeof cy !== "number" ||
															typeof midAngle !== "number" ||
															typeof innerRadius !== "number" ||
															typeof outerRadius !== "number"
														) {
															return null;
														}

														const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
														const angle = (-midAngle * Math.PI) / 180;
														const x = cx + radius * Math.cos(angle);
														const y = cy + radius * Math.sin(angle);

														return (
															<text
																x={x}
																y={y}
																fill="#ffffff"
																fontSize={16}
																fontWeight={700}
																textAnchor="middle"
																dominantBaseline="central"
																pointerEvents="none"
															>
																{value}
															</text>
														);
													}}
												>
													{stageOverviewData.map((entry, index) => (
														<Cell
															key={entry.stageGroupCode}
															opacity={
																hoveredStageSliceIndex === null || hoveredStageSliceIndex === index
																	? 1
																	: 0.45
															}
															stroke={
																hoveredStageSliceIndex === index ? "rgba(15,23,42,0.2)" : "transparent"
															}
															strokeWidth={hoveredStageSliceIndex === index ? 3 : 0}
															fill={
																STAGE_OVERVIEW_COLORS[index % STAGE_OVERVIEW_COLORS.length]
															}
														/>
													))}
												</Pie>
													<Tooltip
														content={renderDonutStatusTooltip}
														position={{ x: 22, y: 12 }}
														allowEscapeViewBox={{ x: true, y: true }}
													/>
											</PieChart>
										</ResponsiveContainer>
										<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
											<div className="rounded-full border border-slate-200 bg-white/90 px-3 py-2 text-center shadow-sm backdrop-blur-[1px]">
												<div className="font-semibold text-slate-900 text-sm leading-none">{stageOverviewTotal}</div>
												<div className="mt-0.5 text-[10px] text-slate-500 uppercase tracking-wide">{getInspectionCountLabel(stageOverviewTotal)}</div>
											</div>
										</div>
									</div>
								</div>
							</div>
						) : (
							<div className="flex min-h-[300px] items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500 text-sm">
								Brak danych etapów do wykresu.
							</div>
						)}
					</div>
				)}
			</div>
			)}
			</div>

			<div className="min-h-0 flex-1">
			<TableSurface
				isLoading={isLoading}
				errorMessage={error}
				containerClassName="h-full"
				scrollAreaClassName="welcome-scroll-subtle h-full min-h-0 [scrollbar-gutter:stable]"
			>
				<table className="w-full min-w-max border-collapse font-sans text-slate-900 text-sm">
					<thead>
						<tr className="bg-slate-100 text-slate-800">
							{TABLE_COLUMNS.map((column) => (
								<th
									key={String(column.key)}
									className="sticky top-0 z-10 border-slate-300 border-b bg-slate-100 px-3 py-2 text-left font-semibold"
									style={{ width: columnWidths[column.key], minWidth: column.minWidth }}
								>
									<span className="block truncate pr-3">{column.label}</span>
									<button
										type="button"
										onMouseDown={(event) => startColumnResize(column.key, event)}
										className="absolute top-0 right-0 h-full w-2 cursor-col-resize border-l border-slate-300/80 bg-transparent hover:bg-slate-300/40"
										aria-label={`Zmień szerokość kolumny ${column.label}`}
										title="Przeciągnij, aby zmienić szerokość kolumny"
									/>
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{filteredRows.length === 0 ? (
							<tr>
								<td colSpan={TABLE_COLUMNS.length} className="px-3 py-8 text-center text-slate-500 text-sm">
									{selectedStageFilters.length > 0
										? "Brak danych dla wybranego segmentu wykresu."
										: "Brak danych do wyświetlenia."}
								</td>
							</tr>
						) : null}

						{filteredRows.map((row, index) => (
									(() => {
										const shouldHighlightRow =
											authRole === "inspector"
												? row.isLeaderCurrentUser
												: authRole === "team_lead"
													? row.isLeaderInManagerTeam
													: false;
										const statusBackgroundColor = resolveStatusBackgroundColor(
											[
												row.stageGroupCode,
												row.stageSubgroupCode,
												row.statusInspekcji,
												resolveInspectionStatusLabel(row),
											],
											inspectionStatusStyleByCode,
										);

										return (
									<tr
										key={`${row.kodInspekcji}-${index}`}
										className={`border-slate-200 border-b transition-[filter,background-color] hover:drop-shadow-[0_2px_6px_rgba(15,23,42,0.14)] last:border-b-0 ${
											shouldHighlightRow
												? "hover:bg-slate-50"
												: "hover:bg-slate-50"
										}`}
										style={{ backgroundColor: statusBackgroundColor }}
									>
										{TABLE_COLUMNS.map((column, columnIndex) => (
											<td
												key={`${row.kodInspekcji}-${index}-${String(column.key)}`}
												className={`px-3 py-2.5 align-top ${
													shouldHighlightRow
														? columnIndex === 0
																? "border-slate-200 border-y-2 border-l-4"
															: columnIndex === TABLE_COLUMNS.length - 1
																	? "border-slate-200 border-y-2 border-r-2"
																	: "border-slate-200 border-y-2"
														: ""
												}`}
												style={{ width: columnWidths[column.key], minWidth: column.minWidth }}
											>
												{column.key === "zakresInspekcji" ? (
													(() => {
														const scopeValue = formatDatesInDisplayText(
															String(row[column.key] ?? "-"),
														).trim();
														const scopeItems = row.zakresInspekcjiItems
															.map((item) => formatDatesInDisplayText(String(item ?? "")).trim())
															.filter(Boolean);

														if (!scopeValue || scopeValue === "-") {
															if (scopeItems.length === 0) {
																return "-";
															}
														}

														if (scopeItems.length > 0) {
															return (
																<ol className="list-decimal space-y-1 pl-4">
																	{scopeItems.map((scopeItem, scopeIndex) => (
																		<li
																			key={`${row.kodInspekcji}-${index}-${scopeIndex}`}
																			className="whitespace-normal break-words"
																		>
																			{scopeItem}
																		</li>
																	))}
																</ol>
															);
														}

														return (
															<div className="whitespace-pre-line break-words">
																{scopeValue}
															</div>
														);
													})()
												) : column.key === "statusInspekcji" ? (
													(() => {
														const isWnType = row.inspekcja === "W";
														const level = isWnType
															? row.wartoscLiczbowaPrzedzialuAlt
															: row.wartoscLiczbowaPrzedzialu;
														const daysSinceEnd = row.liczbaDniOdKoncaInspekcjiDoDzis;
														const showIcon = level === 1 || level === 2 || level === 3;
														const iconClassName =
															level === 1
																? "text-yellow-700"
																: level === 2
																	? "text-orange-700"
																	: "text-red-700";
														const iconContainerClassName =
															level === 1
																? "border-yellow-300 bg-yellow-100"
																: level === 2
																	? "border-orange-300 bg-orange-100"
																	: "border-red-300 bg-red-100";
														const tooltipText =
																	typeof daysSinceEnd === "number"
																		? isWnType
																			? `Minęło ${daysSinceEnd} dni od zakończenia wizyty nadzorczej - brak sporządzenia sprawozdania`
																			: `Minęło ${daysSinceEnd} dni od zakończenia kontroli - brak sporządzonego protokołu`
																		: isWnType
																			? "Minęło - dni od zakończenia wizyty nadzorczej - brak sporządzenia sprawozdania"
																			: "Minęło - dni od zakończenia kontroli - brak sporządzonego protokołu";
															const displayedStatus = formatDatesInDisplayText(
																String(row[column.key] ?? "-"),
															);

														return (
															<div className="flex items-start justify-between gap-2">
																<span className="whitespace-normal break-words">
																	{displayedStatus}
																</span>
																{showIcon ? (
																			<span
																				className="group relative inline-flex shrink-0"
																				tabIndex={0}
																				aria-label={tooltipText}
																			>
																				<span
																					className={`inline-flex h-7 w-7 items-center justify-center rounded-full border shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] ${iconContainerClassName}`}
																				>
																					<AlertTriangle className={`h-[21px] w-[21px] shrink-0 ${iconClassName}`} />
																				</span>
																				<span className="pointer-events-none absolute top-full left-4 z-50 mt-1 hidden w-80 max-w-[90vw] whitespace-pre-line rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-700 text-sm leading-5 shadow-lg group-hover:block group-focus-within:block">
																					{tooltipText}
																				</span>
																			</span>
																) : null}
															</div>
														);
													})()
												) : column.key === "inspekcja" ? (
													row.inspekcja === "W" ? "WN" : row.inspekcja
												) : column.key === "kodInspekcji" ? (
													<button
														type="button"
														onClick={() => {
															const inspectionCode = String(row.kodInspekcji ?? "").trim();
															if (!inspectionCode || typeof window === "undefined") {
																return;
															}

															window.sessionStorage.setItem(
																DASHBOARD_OPEN_INSPECTION_CODE_KEY,
																inspectionCode,
															);
															window.dispatchEvent(
																new CustomEvent(DASHBOARD_OPEN_INSPECTION_EVENT, {
																	detail: { inspectionCode },
																}),
															);
														}}
														className="cursor-pointer rounded px-1 text-left text-[#1f4f8f] underline decoration-[#9bb8de] underline-offset-2 transition-colors hover:text-[#163a68]"
														title="Przejdź do rejestru Inspekcje i zaznacz ten rekord"
													>
														{String(row.kodInspekcji ?? "-")}
													</button>
												) : (
																	formatDatesInDisplayText(String(row[column.key] ?? "-"))
												)}
											</td>
										))}
									</tr>
										);
									})()
							  ))}
					</tbody>
				</table>
			</TableSurface>
			</div>
				</>
			) : (
				<>
					<div className="mb-1 shrink-0 overflow-hidden rounded-2xl border border-slate-300 bg-white">
						<div
							className="flex cursor-pointer items-center justify-between gap-2 border-slate-300 border-b bg-slate-100 px-3 py-2"
							onClick={() => setIsRecommendationSummaryCollapsed((current) => !current)}
							role="button"
							tabIndex={0}
							onKeyDown={(event) => {
								if (event.key === "Enter" || event.key === " ") {
									event.preventDefault();
									setIsRecommendationSummaryCollapsed((current) => !current);
								}
							}}
							aria-expanded={!isRecommendationSummaryCollapsed}
							aria-controls="recommendation-summary-panel"
						>
							<div className="inline-flex items-center gap-2 text-left text-slate-800 text-xs transition-colors hover:text-slate-900">
								{isRecommendationSummaryCollapsed ? (
									<ChevronRight className="h-4 w-4 shrink-0" />
								) : (
									<ChevronDown className="h-4 w-4 shrink-0" />
								)}
								<span className="font-semibold text-sm tracking-wide">Podsumowanie zaleceń</span>
							</div>

							<button
								type="button"
								onClick={(event) => {
									event.stopPropagation();
									setSelectedRecommendationStatuses([]);
								}}
								disabled={selectedRecommendationStatuses.length === 0}
								className={`rounded px-2 py-1 text-xs transition-colors ${
									selectedRecommendationStatuses.length === 0
										? "cursor-not-allowed text-slate-400"
										: "cursor-pointer font-semibold text-[#1f4f8f] hover:bg-slate-200 hover:text-[#163a68]"
								}`}
							>
								Wyczyść filtry
							</button>
						</div>

						{isRecommendationSummaryCollapsed ? null : (
							<div id="recommendation-summary-panel" className="px-2.5 pt-1.5 pb-1 text-slate-900">

						{recommendationSummaryError ? (
							<p className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 text-xs">
								{recommendationSummaryError}
							</p>
						) : null}

						{isRecommendationSummaryLoading ? (
							<div className="flex h-[300px] items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500 text-sm">
								Ładowanie wykresu statusów...
							</div>
						) : orderedRecommendationGroups.length === 0 ? (
							<div className="flex h-[300px] items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500 text-sm">
								Brak statusów zaleceń.
							</div>
						) : (
							<div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(480px,620px)]">
								<div className="rounded-xl border border-slate-300 bg-white p-2.5">
									<div
										className={`welcome-scroll-subtle pr-1 ${
											shouldShowRecommendationStatusScroll
												? "overflow-y-auto"
												: "overflow-y-hidden"
										}`}
										style={{ maxHeight: `${RECOMMENDATION_STATUS_LIST_MAX_HEIGHT_PX}px` }}
									>
										{orderedRecommendationGroups.map((group, index) => {
											const isSelected = selectedRecommendationStatuses.some(
												(filter) => filter.stageGroupCode === group.stageGroupCode,
											);
											const statusColor = STAGE_OVERVIEW_COLORS[index % STAGE_OVERVIEW_COLORS.length];
											const groupLabelVariants = buildStatusLabelVariants(group.stageGroupLabel);
											const groupShortLabelVariants = buildStatusLabelVariants(
												group.stageGroupShortLabel,
											);
											const rowDerivedStatusKeys = Array.from(
												recommendationStatusKeysByGroupCode.get(
													group.stageGroupCode.trim().toLowerCase(),
												) ?? [],
											);
											const statusLegendColor = resolveStatusBackgroundColor(
												[
													group.stageGroupCode,
													group.stageGroupShortLabel,
													group.stageGroupLabel,
													...groupShortLabelVariants,
													...groupLabelVariants,
													...rowDerivedStatusKeys,
												],
												recommendationStatusStyleByCode,
											);
											const isZero = group.count === 0;
											const statusLabel = group.stageGroupShortLabel || group.stageGroupLabel;

											return (
												<button
													key={group.stageGroupCode}
													type="button"
													onClick={() => {
														setSelectedRecommendationStatuses((current) => {
															const alreadySelected = current.some(
																(item) => item.stageGroupCode === group.stageGroupCode,
															);
															if (alreadySelected) {
																return current.filter(
																	(item) => item.stageGroupCode !== group.stageGroupCode,
																);
															}

															return [
																...current,
																{
																	stageGroupCode: group.stageGroupCode,
																	stageGroupLabel: group.stageGroupLabel,
																	stageGroupShortLabel: group.stageGroupShortLabel,
																},
															];
														});
													}}
													className={`grid w-full grid-cols-[56px_auto_minmax(0,1fr)] items-center border-slate-200 border-b px-2.5 py-1.5 text-left text-sm transition-colors last:border-b-0 ${
														isSelected
															? "cursor-pointer bg-[#dbeafe] ring-1 ring-inset ring-[#93c5fd] shadow-[inset_3px_0_0_#2563eb]"
															: "cursor-pointer hover:bg-slate-50"
													}`}
												>
														<span className="mr-2 inline-flex items-center justify-center">
															<span
																className="inline-block h-4 w-8 rounded-[4px] border border-slate-300"
																style={{ backgroundColor: statusLegendColor }}
															/>
														</span>
															<span className="mr-3 flex items-center justify-start pr-2">
														<span
															className={`inline-flex min-w-9 items-center justify-center rounded-full px-2.5 py-0.5 font-semibold text-[11px] tabular-nums ${
																isZero
																	? "bg-slate-200 text-slate-700"
																	: "text-white shadow-[inset_0_-1px_0_rgba(255,255,255,0.2)]"
															}`}
															style={isZero ? undefined : { backgroundColor: statusColor }}
														>
															{group.count}
														</span>
													</span>
															<span className="min-w-0 whitespace-normal break-words text-slate-700 text-sm leading-snug">
																{statusLabel}
															</span>
												</button>
											);
										})}
									</div>
								</div>

								{recommendationOverviewData.length > 0 ? (
									<div className="flex min-h-[370px] rounded-xl border border-slate-300 bg-white p-2.5">
										<div className="grid h-full w-full grid-cols-1 items-center">
											<div className="relative mx-auto h-[290px] w-full max-w-[560px] sm:h-[340px] lg:h-full lg:min-h-[340px]">
												<ResponsiveContainer width="100%" height="100%">
													<PieChart margin={{ top: 16, right: 16, bottom: 16, left: 16 }}>
														<Pie
															data={recommendationOverviewData}
															dataKey="count"
															nameKey="stageGroupLabel"
															cx="50%"
															cy="50%"
															innerRadius="58%"
															outerRadius="92%"
															paddingAngle={2}
															isAnimationActive={false}
															activeIndex={hoveredRecommendationSliceIndex ?? undefined}
															onMouseEnter={(_entry, index) => setHoveredRecommendationSliceIndex(index)}
															onMouseLeave={() => setHoveredRecommendationSliceIndex(null)}
															labelLine={false}
															label={({
																cx,
																cy,
																midAngle,
																innerRadius,
																outerRadius,
																value,
															}) => {
																if (
																	typeof value !== "number" ||
																	value <= 0 ||
																	typeof cx !== "number" ||
																	typeof cy !== "number" ||
																	typeof midAngle !== "number" ||
																	typeof innerRadius !== "number" ||
																	typeof outerRadius !== "number"
																) {
																	return null;
																}

																const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
																const angle = (-midAngle * Math.PI) / 180;
																const x = cx + radius * Math.cos(angle);
																const y = cy + radius * Math.sin(angle);

																return (
																	<text
																		x={x}
																		y={y}
																		fill="#ffffff"
																		fontSize={16}
																		fontWeight={700}
																		textAnchor="middle"
																		dominantBaseline="central"
																		pointerEvents="none"
																	>
																		{value}
																	</text>
																);
															}}
														>
															{recommendationOverviewData.map((entry, index) => (
																<Cell
																	key={entry.stageGroupCode}
																	opacity={
																		hoveredRecommendationSliceIndex === null ||
																		hoveredRecommendationSliceIndex === index
																			? 1
																			: 0.45
																	}
																	stroke={
																		hoveredRecommendationSliceIndex === index
																			? "rgba(15,23,42,0.2)"
																			: "transparent"
																	}
																	strokeWidth={hoveredRecommendationSliceIndex === index ? 3 : 0}
																	fill={STAGE_OVERVIEW_COLORS[index % STAGE_OVERVIEW_COLORS.length]}
																/>
															))}
														</Pie>
														<Tooltip
															content={renderDonutStatusTooltip}
															position={{ x: 22, y: 12 }}
															allowEscapeViewBox={{ x: true, y: true }}
														/>
													</PieChart>
												</ResponsiveContainer>
												<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
													<div className="rounded-full border border-slate-200 bg-white/90 px-3 py-2 text-center shadow-sm backdrop-blur-[1px]">
														<div className="font-semibold text-slate-900 text-sm leading-none">
															{recommendationOverviewTotal}
														</div>
														<div className="mt-0.5 text-[10px] text-slate-500 uppercase tracking-wide">Zalecenia</div>
													</div>
												</div>
											</div>
										</div>
									</div>
								) : (
									<div className="flex min-h-[300px] items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500 text-sm">
										Brak danych statusów do wykresu.
									</div>
								)}
									</div>
								)}
							</div>
						)}
					</div>

					<div className="min-h-0 flex-1">
						<TableSurface
							isLoading={isRecommendationsLoading}
							errorMessage={recommendationsError}
							containerClassName="h-full"
							scrollAreaClassName="welcome-scroll-subtle h-full min-h-0 [scrollbar-gutter:stable]"
						>
							<table className="w-full min-w-max border-collapse font-sans text-slate-900 text-sm">
								<thead>
									<tr className="bg-slate-100 text-slate-800">
										{RECOMMENDATION_TABLE_COLUMNS.map((column) => (
											<th
												key={String(column.key)}
												className="sticky top-0 z-10 border-slate-300 border-b bg-slate-100 px-3 py-2 text-left font-semibold"
												style={{
													width: recommendationColumnWidths[column.key],
													minWidth: column.minWidth,
												}}
											>
												<span className="block truncate pr-3">{column.label}</span>
												<button
													type="button"
													onMouseDown={(event) =>
														startRecommendationColumnResize(column.key, event)
													}
													className="absolute top-0 right-0 h-full w-2 cursor-col-resize border-l border-slate-300/80 bg-transparent hover:bg-slate-300/40"
													aria-label={`Zmień szerokość kolumny ${column.label}`}
													title="Przeciągnij, aby zmienić szerokość kolumny"
												/>
											</th>
										))}
									</tr>
								</thead>
								<tbody>
									{filteredRecommendationRows.length === 0 ? (
										<tr>
											<td
												colSpan={RECOMMENDATION_TABLE_COLUMNS.length}
												className="px-3 py-8 text-center text-slate-500 text-sm"
											>
												{selectedRecommendationStatuses.length > 0
													? "Brak danych dla wybranego statusu zaleceń."
													: "Brak danych do wyświetlenia."}
											</td>
										</tr>
									) : null}

									{filteredRecommendationRows.map((row, index) => (
										(() => {
											const statusBackgroundColor = resolveStatusBackgroundColor(
												[row.status, row.statusSkrot],
												recommendationStatusStyleByCode,
											);

											return (
										<tr
											key={`${row.recommendationId}-${row.inspectionId}-${index}`}
											className="border-slate-200 border-b bg-white transition-colors last:border-b-0 hover:bg-slate-50"
											style={{ backgroundColor: statusBackgroundColor }}
										>
											{RECOMMENDATION_TABLE_COLUMNS.map((column) => (
												<td
													key={`${row.recommendationId}-${row.inspectionId}-${index}-${String(column.key)}`}
													className="px-3 py-2.5 align-top"
													style={{
														width: recommendationColumnWidths[column.key],
														minWidth: column.minWidth,
													}}
												>
													{column.key === "terminWykonaniaZalecen" ? (
														(() => {
															const value = formatDatesInDisplayText(
																String(row[column.key] ?? "-"),
															);
															const terms = value
																.split(",")
																.map((item) => item.trim())
																.filter(Boolean);

															if (terms.length <= 1) {
																return value;
															}

															return (
																<div className="space-y-1">
																	{terms.map((term, termIndex) => (
																		<div key={`${row.recommendationId}-${termIndex}`}>{term}</div>
																	))}
																</div>
															);
														})()
													) : column.key === "inspectionId" ? (
														(() => {
															const inspectionCode = String(row.inspectionId ?? "").trim();
															if (!inspectionCode || inspectionCode === "-") {
																return "-";
															}

															return (
																<button
																	type="button"
																	onClick={() => {
																		if (typeof window === "undefined") {
																			return;
																		}

																		window.sessionStorage.setItem(
																			DASHBOARD_OPEN_INSPECTION_CODE_KEY,
																			inspectionCode,
																		);
																		window.dispatchEvent(
																			new CustomEvent(DASHBOARD_OPEN_INSPECTION_EVENT, {
																				detail: { inspectionCode },
																			}),
																		);
																	}}
																	className="cursor-pointer rounded px-1 text-left text-[#1f4f8f] underline decoration-[#9bb8de] underline-offset-2 transition-colors hover:text-[#163a68]"
																	title="Przejdź do rejestru Inspekcje i zaznacz ten rekord"
																>
																	{inspectionCode}
																</button>
															);
														})()
													) : column.key === "recommendationId" ? (
														(() => {
															const recommendationCode = String(row.recommendationId ?? "").trim();
															if (!recommendationCode || recommendationCode === "-") {
																return "-";
															}

															return (
																<button
																	type="button"
																	onClick={() => {
																		if (typeof window === "undefined") {
																			return;
																		}

																		window.sessionStorage.setItem(
																			DASHBOARD_OPEN_RECOMMENDATION_CODE_KEY,
																			recommendationCode,
																		);
																		window.dispatchEvent(
																			new CustomEvent(DASHBOARD_OPEN_RECOMMENDATION_EVENT, {
																				detail: { recommendationCode },
																			}),
																		);
																	}}
																	className="cursor-pointer rounded px-1 text-left text-[#1f4f8f] underline decoration-[#9bb8de] underline-offset-2 transition-colors hover:text-[#163a68]"
																	title="Przejdź do rejestru Zalecenia i zaznacz ten rekord"
																>
																	{recommendationCode}
																</button>
															);
														})()
													) : (
														column.key === "status"
															? String(row.status ?? row.statusSkrot ?? "-")
															: formatDatesInDisplayText(String(row[column.key] ?? "-"))
													)}
												</td>
											))}
										</tr>
											);
										})()
									))}
								</tbody>
							</table>
						</TableSurface>
					</div>
				</>
			)}
		</section>
	);
}
