from __future__ import annotations

import csv
import base64
from collections import defaultdict
from datetime import date, datetime
from email.message import EmailMessage
import importlib
import io
import os
import re
import smtplib
from statistics import median
from typing import Any, Literal
import unicodedata

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.api.reports.generation_data import build_year_count_sections
from app.db import get_connection
from app.permissions import (
	PERMISSION_RECOMMENDATIONS_READ,
	PERMISSION_REPORTS_EXECUTED_INSPECTIONS_READ,
	PERMISSION_REPORTS_PROTOCOL_TIME_READ,
	PERMISSION_REPORTS_REPORT_TIME_READ,
	require_permission,
)


router = APIRouter()


class InspectionsMatrixRow(BaseModel):
	nazwa_podmiotu: str
	rodzaj_podmiotu: str
	wartosci: dict[str, str]
	cells: dict[str, list[dict[str, Any]]]


class InspectionsMatrixResponse(BaseModel):
	formatVersion: str
	lata: list[str]
	rows: list[InspectionsMatrixRow]


class InspectionsDetailedRow(BaseModel):
	kod_inspekcji: str
	nazwa_podmiotu: str
	nazwa_podmiotu_skrocona: str | None = None
	nazwa_podmiotu_skrot: str | None = None
	nazwaPodmiotuSkrocona: str | None = None
	nazwaPodmiotuSkrot: str | None = None
	rodzaj_podmiotu: str | None = None
	inspekcja: str
	typ_inspekcji: str | None = None
	status: str | None = None
	status_inspekcji_skrot: str | None = None
	status_inspekcji_id: int | None = None
	status_inspekcji: str | None = None
	zakres_inspekcji: str | None = None
	zakres_inspekcji_items: list[str] = []
	typ_zakres_inspekcji: str
	rok_poczatku: str
	poczatek_inspekcji: str
	koniec_inspekcji: str
	inspektor_kierujacy: str
	is_leader_current_user: bool = False
	is_leader_in_manager_team: bool = False
	is_member_current_user: bool = False
	is_member_in_manager_team: bool = False
	liczba_dni_od_konca_inspekcji_do_dzis: int | None = None
	wartosc_liczbowa_przedzialu: int | None = None
	wartosc_liczbowa_przedzialu_alt: int | None = None
	osoba_kierujaca: str
	zespol_osoby_kierujacej_kod: str
	zespol: str = ""
	zespolyInspekcji: str = ""
	zespoly: str = ""
	inspection_team_codes: list[str] = []
	inspectionTeamCodes: list[str] = []
	inspection_team_ids: list[int] = []
	inspectionTeamIds: list[int] = []
	data_protokolu_sprawozdania: str | None = None
	roznica_dni_miedzy_data_protokolu_a_koncem: int | None = None


class InspectionsDetailedResponse(BaseModel):
	rows: list[InspectionsDetailedRow]


class InspectionsTimeAnalyticsResponse(BaseModel):
	inspectionType: str
	trendMode: str
	selectedMetric: str
	selectedMetricLabel: str
	baseCount: int
	filteredCount: int
	departmentMinTime: int | None = None
	departmentMaxTime: int | None = None
	departmentMinTimeByYear: dict[str, int | None] = {}
	departmentMaxTimeByYear: dict[str, int | None] = {}
	myCountByYear: dict[str, int] = {}
	myCountByYearBreakdown: dict[str, dict[str, int]] = {}
	myMetricByYearBreakdown: dict[str, dict[str, float]] = {}
	myCountAllYearsBreakdown: dict[str, int] = {}
	myMetricAllYearsBreakdown: dict[str, float] = {}
	teamOptions: list[str]
	yearOptions: list[str]
	detailRows: list[dict[str, Any]]
	summaryColumns: list[dict[str, str]] = []
	summaryRows: list[dict[str, Any]]
	summaryPivotYears: list[str] = []
	summaryPivotRows: list[dict[str, Any]] = []
	trendRows: list[dict[str, Any]]
	scatterRows: list[dict[str, Any]]
	overallColumns: list[dict[str, str]] = []
	overallRows: list[dict[str, Any]] = []
	yearCountColumns: list[str] = []
	yearCountRows: list[dict[str, Any]] = []
	yearCountByTeamColumns: list[str] = []
	yearCountByTeamRows: list[dict[str, Any]] = []
	alertStatusCounts: list[dict[str, Any]] = []
	alertPiszemyProtokolCount: int = 0


class StageSummarySubgroup(BaseModel):
	stageSubgroupCode: str
	stageSubgroupLabel: str
	stageSubgroupOrder: int
	count: int
	countTeam: int
	countManagerAdded: int
	countTeamAndManagerAdded: int


class StageSummaryGroup(BaseModel):
	stageGroupCode: str
	stageGroupLabel: str
	stageGroupOrder: int
	count: int
	countTeam: int
	countManagerAdded: int
	countTeamAndManagerAdded: int
	subgroups: list[StageSummarySubgroup]


class StageSummaryFlatSubgroup(BaseModel):
	stageGroupCode: str
	stageGroupLabel: str
	stageGroupOrder: int
	stageSubgroupCode: str
	stageSubgroupLabel: str
	stageSubgroupOrder: int
	count: int
	countTeam: int
	countManagerAdded: int
	countTeamAndManagerAdded: int


class InspectionsStageSummaryResponse(BaseModel):
	generatedAt: str
	stageDictionaryVersion: str
	totalInspections: int
	qualityErrorCount: int
	statuses: list[RecommendationStatusGroup]


class RecommendationStatusGroup(BaseModel):
	stageGroupCode: str
	stageGroupLabel: str
	stageGroupShortLabel: str | None = None
	stageGroupOrder: int
	count: int
	countTeam: int
	countManagerAdded: int
	countTeamAndManagerAdded: int


class RecommendationsStageSummaryResponse(BaseModel):
	generatedAt: str
	stageDictionaryVersion: str
	totalRecommendations: int
	qualityErrorCount: int
	groups: list[RecommendationStatusGroup]


class RecommendationsDetailedRow(BaseModel):
	status: str
	status_skrot: str | None = None
	statusSkrot: str | None = None
	kod_zalecenia: str | None = None
	kod_inspekcji: str | None = None
	kodZalecenia: str | None = None
	kodInspekcji: str | None = None
	nazwa_podmiotu: str
	nazwa_podmiotu_skrocona: str | None = None
	nazwa_podmiotu_skrot: str | None = None
	nazwaPodmiotuSkrocona: str | None = None
	nazwaPodmiotuSkrot: str | None = None
	data_zalecen: str | None = None
	termin_zalecen: str | None = None
	termin_wykonania_zalecen: str | None = None
	zespol: str = ""
	zespolyInspekcji: str = ""
	zespoly: str = ""
	inspection_team_codes: list[str] = []
	inspectionTeamCodes: list[str] = []
	inspection_team_ids: list[int] = []
	inspectionTeamIds: list[int] = []
	liczba_zalecen: int


class RecommendationsDetailedResponse(BaseModel):
	rows: list[RecommendationsDetailedRow]


ReportExportType = Literal["inspections", "recommendations"]


class ReportExportEmailRequest(BaseModel):
	reportTypes: list[ReportExportType] = Field(default_factory=lambda: ["inspections", "recommendations"])
	toEmails: list[str]
	subject: str | None = None
	body: str | None = None
	managerUserId: int | None = None


class ReportExportEmailResponse(BaseModel):
	sentCount: int
	attachmentNames: list[str]


DashboardRequestedFileFormat = Literal["html", "pdf"]


class DashboardHtmlMeta(BaseModel):
	generatedAt: str | None = None
	requestedFileFormat: DashboardRequestedFileFormat | None = None
	activeTopSection: str | None = None
	includedSections: list[str] | None = None
	filters: dict[str, Any] | None = None
	sender: dict[str, Any] | None = None


class DashboardSendHtmlRequest(BaseModel):
	toEmails: list[str] = Field(default_factory=list)
	subject: str | None = None
	bodyText: str | None = None
	fileName: str
	pdfBase64: str | None = None
	html: str | None = None
	reportType: ReportExportType
	meta: DashboardHtmlMeta | None = None


class DashboardSendHtmlResponse(BaseModel):
	message: str
	recipientEmail: str
	fileName: str
	fileFormat: DashboardRequestedFileFormat


STAGE_DICTIONARY_VERSION = "1.0.0"
RECOMMENDATIONS_STAGE_DICTIONARY_VERSION = "1.0.0"

STAGE_GROUPS: list[dict[str, Any]] = [
	{
		"code": "pre",
		"label": "Przed inspekcja",
		"order": 1,
		"subgroups": [
			{"code": "pre_planned", "label": "Plan", "order": 1},
			{"code": "pre_preparation", "label": "Przygotowanie", "order": 2},
		],
	},
	{
		"code": "during",
		"label": "W trakcie inspekcji",
		"order": 2,
		"subgroups": [
			{"code": "in_progress_active", "label": "Trwa", "order": 1},
			{"code": "in_progress_report_writing", "label": "Zakonczona - piszemy", "order": 2},
		],
	},
	{
		"code": "post",
		"label": "Po inspekcji",
		"order": 3,
		"subgroups": [
			{"code": "post_protocol_sent", "label": "Przekazano protokol", "order": 1},
			{"code": "post_post_visit_letter_sent", "label": "Przekazano pismo po wizycie", "order": 2},
			{"code": "post_objections_received", "label": "Wplynely zastrzezenia", "order": 3},
			{"code": "post_post_visit_response_received", "label": "Wplynela odpowiedz po wizycie", "order": 4},
		],
	},
	{
		"code": "recommendations",
		"label": "Rekomendacje",
		"order": 4,
		"subgroups": [
			{"code": "rec_writing_recommendations", "label": "Piszemy zalecenia/odstapienie", "order": 1},
			{"code": "rec_findings_letter", "label": "Pismo ustalenia", "order": 2},
		],
	},
	{
		"code": "closed",
		"label": "Zamkniete inspekcje",
		"order": 5,
		"subgroups": [
			{"code": "closed_with_recommendations", "label": "Zamkniete - wydano zalecenia", "order": 1},
			{"code": "closed_without_recommendations", "label": "Zamkniete - brak zalecen", "order": 2},
		],
	},
	{
		"code": "unknown",
		"label": "Nieprzypisane",
		"order": 99,
		"subgroups": [
			{"code": "unknown_unmapped", "label": "Brak mapowania", "order": 1},
		],
	},
]

STAGE_SUBGROUP_INDEX: dict[str, dict[str, Any]] = {
	subgroup["code"]: {
		"stage_group_code": group["code"],
		"stage_group_label": group["label"],
		"stage_group_order": int(group["order"]),
		"stage_subgroup_code": subgroup["code"],
		"stage_subgroup_label": subgroup["label"],
		"stage_subgroup_order": int(subgroup["order"]),
	}
	for group in STAGE_GROUPS
	for subgroup in group["subgroups"]
}


def _resolve_operator(conn: Any, operator_login: str | None) -> dict[str, Any]:
	login = (operator_login or "").strip()
	if not login:
		raise HTTPException(status_code=401, detail="Operator nie istnieje")

	row = conn.execute(
		"""
		SELECT id, login, rola_id, zespol_id, aktywny
		FROM users
		WHERE lower(login)=lower(?)
		LIMIT 1
		""",
		(login,),
	).fetchone()
	if row is None:
		raise HTTPException(status_code=401, detail="Operator nie istnieje")

	operator = dict(row)
	if int(operator["aktywny"]) != 1:
		raise HTTPException(status_code=403, detail="Operator jest nieaktywny")

	return operator


def _year_from_date(value: str | None) -> str | None:
	if value is None:
		return None
	cleaned = value.strip()
	if len(cleaned) < 4:
		return None
	year = cleaned[:4]
	if not year.isdigit():
		return None
	return year


def _matrix_cell_value(typ_inspekcji: str | None, zakres_inspekcji: str | None) -> str:
	typ_clean = (typ_inspekcji or "").strip()
	zakres_clean = (zakres_inspekcji or "").strip()

	first_letter = typ_clean[:1].upper() if typ_clean else ""
	if first_letter and zakres_clean:
		parts = [part.strip() for part in re.split(r"[;,]", zakres_clean) if part.strip()]
		if parts:
			return ", ".join(f"{first_letter}_{part}" for part in parts)
		return f"{first_letter}_{zakres_clean}"
	return "-"


def _parse_iso_date(value: str | None) -> date | None:
	if value is None:
		return None
	cleaned = value.strip()
	if len(cleaned) < 10:
		return None
	try:
		return date.fromisoformat(cleaned[:10])
	except ValueError:
		return None


def _days_difference(date_from: str | None, date_to: str | None) -> int | None:
	left = _parse_iso_date(date_from)
	right = _parse_iso_date(date_to)
	if left is None or right is None:
		return None
	# Analytics in "czas protokolu" should not expose negative durations.
	return max((left - right).days, 0)


def _days_from_end_to_today(end_date: str | None) -> int | None:
	parsed_end = _parse_iso_date(end_date)
	if parsed_end is None:
		return None
	return (date.today() - parsed_end).days


def _end_to_today_bucket(days_value: int | None) -> int | None:
	if days_value is None:
		return None
	if days_value < 21:
		return 0
	if days_value < 28:
		return 1
	if days_value < 35:
		return 2
	return 3


def _end_to_today_bucket_alt(days_value: int | None) -> int | None:
	if days_value is None:
		return None
	if days_value < 14:
		return 0
	if days_value < 21:
		return 1
	if days_value < 28:
		return 2
	return 3


def _inspekcja_code(typ_inspekcji: str | None) -> str:
	cleaned = (typ_inspekcji or "").strip().lower()
	if cleaned.startswith("kontrola"):
		return "K"
	if cleaned.startswith("wizyta nadzorcza"):
		return "W"
	return "-"


def _matrix_type_code(typ_inspekcji: str | None) -> str:
	code = _inspekcja_code(typ_inspekcji)
	if code == "W":
		return "WN"
	return code


def _normalize_matrix_scopes(raw_scopes: str | None) -> list[str]:
	if raw_scopes is None:
		return []
	parts: list[str] = []
	for part in str(raw_scopes).split(";"):
		cleaned = part.strip()
		if cleaned and cleaned != "-":
			parts.append(cleaned)
	# Keep insertion order while removing duplicates.
	return list(dict.fromkeys(parts))


def _parse_scope_id_csv(raw_scope_ids: str | None) -> list[int]:
	if raw_scope_ids is None:
		return []
	ids: list[int] = []
	for part in str(raw_scope_ids).split(";"):
		cleaned = part.strip()
		if not cleaned:
			continue
		try:
			ids.append(int(cleaned))
		except ValueError:
			continue
	# Keep insertion order while removing duplicates.
	return list(dict.fromkeys(ids))


def _scope_items_from_ids_csv(conn: Any, raw_scope_ids: str | None, cache: dict[int, str]) -> list[str]:
	scope_ids = _parse_scope_id_csv(raw_scope_ids)
	if not scope_ids:
		return []

	missing_ids = [scope_id for scope_id in scope_ids if scope_id not in cache]
	if missing_ids:
		placeholders = ",".join("?" for _ in missing_ids)
		rows = conn.execute(
			f"""
			SELECT id, COALESCE(NULLIF(trim(nazwa_pozycji), ''), '-') AS scope_name
			FROM slownik_pozycje
			WHERE id IN ({placeholders})
			""",
			tuple(missing_ids),
		).fetchall()
		for row in rows:
			cache[int(row["id"])] = str(row["scope_name"] or "-")

	return [cache[scope_id] for scope_id in scope_ids if scope_id in cache]


def _normalize_text_key(value: str | None) -> str:
	cleaned = (value or "").strip().lower()
	if not cleaned:
		return ""
	normalized = unicodedata.normalize("NFKD", cleaned)
	ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
	return " ".join(ascii_only.split())


def _is_valid_email(value: str | None) -> bool:
	cleaned = str(value or "").strip()
	if not cleaned:
		return False
	return re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", cleaned) is not None


def _normalize_emails(values: list[str]) -> list[str]:
	result: list[str] = []
	seen: set[str] = set()
	for value in values:
		email = str(value or "").strip().lower()
		if not _is_valid_email(email):
			continue
		if email in seen:
			continue
		seen.add(email)
		result.append(email)
	return result


def _smtp_error_detail(kind: str, exc: Exception) -> dict[str, Any]:
	debug_enabled = (os.getenv("REPORTS_EMAIL_DEBUG_ERRORS") or "0").strip().lower() in {"1", "true", "yes", "on"}
	detail: dict[str, Any] = {
		"code": "REPORTS_EMAIL_SMTP_ERROR",
		"message": "Blad SMTP podczas wysylki raportu",
		"smtpErrorType": type(exc).__name__,
		"smtpErrorKind": kind,
	}
	if debug_enabled:
		detail["smtpError"] = str(exc)
	return detail


def _reports_env_truthy(name: str, default: str = "0") -> bool:
	value = (os.getenv(name, default) or "").strip().lower()
	return value in {"1", "true", "yes", "on"}


def _smtp_retry_attempts() -> int:
	raw_value = (os.getenv("REPORTS_SMTP_RETRY_ATTEMPTS") or "2").strip()
	try:
		parsed = int(raw_value)
	except ValueError:
		return 2
	return min(max(parsed, 1), 5)


def _smtp_timeout_seconds() -> int:
	raw_value = (os.getenv("REPORTS_SMTP_TIMEOUT_SECONDS") or "30").strip()
	try:
		parsed = int(raw_value)
	except ValueError:
		return 30
	return min(max(parsed, 5), 120)


def _smtp_max_message_bytes() -> int:
	raw_value = (os.getenv("REPORTS_SMTP_MAX_MESSAGE_MB") or "24").strip()
	try:
		parsed_mb = int(raw_value)
	except ValueError:
		parsed_mb = 24
	parsed_mb = min(max(parsed_mb, 1), 100)
	return parsed_mb * 1024 * 1024


def _smtp_message_too_large_detail(size_bytes: int) -> dict[str, Any]:
	limit_bytes = _smtp_max_message_bytes()
	return {
		"code": "REPORTS_EMAIL_MESSAGE_TOO_LARGE",
		"message": "Wiadomosc email przekracza limit rozmiaru serwera SMTP",
		"limitMb": round(limit_bytes / (1024 * 1024), 2),
		"messageSizeMb": round(size_bytes / (1024 * 1024), 2),
	}


def _is_smtp_size_error(exc: Exception) -> bool:
	smtp_code = getattr(exc, "smtp_code", None)
	if smtp_code == 552:
		return True
	text = str(exc).lower()
	return "message size" in text or "maxsizeerror" in text or "exceeded" in text


def _smtp_config() -> dict[str, Any]:
	smtp_host = (os.getenv("SMTP_HOST") or "").strip()
	smtp_port_raw = (os.getenv("SMTP_PORT") or "465").strip()
	smtp_login = (os.getenv("SMTP_LOGIN") or "").strip()
	smtp_pass = (os.getenv("SMTP_PASS") or "").strip()
	smtp_login_mail = (os.getenv("SMTP_LOGIN_MAIL") or "").strip()
	from_email = (os.getenv("FROM_EMAIL") or smtp_login_mail or "").strip()
	smtp_security = (os.getenv("SMTP_SECURITY") or "starttls").strip().lower()

	if smtp_security not in {"ssl", "starttls", "plain"}:
		smtp_security = "starttls"

	if not smtp_host or not smtp_login or not smtp_pass or not from_email:
		raise RuntimeError("Brak konfiguracji SMTP")

	try:
		smtp_port = int(smtp_port_raw)
	except ValueError as exc:
		raise RuntimeError("Niepoprawny SMTP_PORT") from exc

	return {
		"host": smtp_host,
		"port": smtp_port,
		"login": smtp_login,
		"password": smtp_pass,
		"from_email": from_email,
		"security": smtp_security,
	}


def _send_smtp_message(msg: EmailMessage, *, config: dict[str, Any]) -> None:
	message_bytes = msg.as_bytes()
	if len(message_bytes) > _smtp_max_message_bytes():
		raise HTTPException(status_code=413, detail=_smtp_message_too_large_detail(len(message_bytes)))

	attempts = _smtp_retry_attempts()
	timeout_seconds = _smtp_timeout_seconds()
	last_exc: Exception | None = None

	for attempt in range(1, attempts + 1):
		try:
			if config["security"] == "ssl":
				with smtplib.SMTP_SSL(config["host"], int(config["port"]), timeout=timeout_seconds) as server:
					server.login(config["login"], config["password"])
					server.send_message(msg)
			else:
				with smtplib.SMTP(config["host"], int(config["port"]), timeout=timeout_seconds) as server:
					server.ehlo()
					if config["security"] == "starttls":
						server.starttls()
						server.ehlo()
					server.login(config["login"], config["password"])
					server.send_message(msg)
			return
		except smtplib.SMTPException as exc:
			last_exc = exc
			print(f"[REPORTS-EMAIL][SMTP-ERROR][attempt={attempt}/{attempts}] {type(exc).__name__}: {exc}")
			if _is_smtp_size_error(exc):
				raise HTTPException(status_code=413, detail=_smtp_message_too_large_detail(len(message_bytes))) from exc
			is_retryable = isinstance(exc, (smtplib.SMTPServerDisconnected, smtplib.SMTPConnectError))
			if is_retryable and attempt < attempts:
				continue
			raise HTTPException(status_code=502, detail=_smtp_error_detail("smtp", exc)) from exc
		except OSError as exc:
			last_exc = exc
			print(f"[REPORTS-EMAIL][SMTP-CONNECTION-ERROR][attempt={attempt}/{attempts}] {type(exc).__name__}: {exc}")
			if attempt < attempts:
				continue
			raise HTTPException(status_code=502, detail=_smtp_error_detail("connection", exc)) from exc

	if last_exc is not None:
		raise HTTPException(status_code=502, detail=_smtp_error_detail("connection", last_exc)) from last_exc


def run_reports_startup_checks() -> None:
	strict_mode = _reports_env_truthy("REPORTS_STARTUP_STRICT", "0")

	if _reports_env_truthy("REPORTS_STARTUP_VALIDATE_PDF", "1"):
		try:
			sync_api_module = importlib.import_module("playwright.sync_api")
			sync_playwright = getattr(sync_api_module, "sync_playwright")
			with sync_playwright() as playwright:
				browser = playwright.chromium.launch()
				browser.close()
			print("[REPORTS-STARTUP] PDF engine OK (Playwright + Chromium)")
		except Exception as exc:
			message = f"[REPORTS-STARTUP] PDF engine validation failed: {type(exc).__name__}: {exc}"
			if strict_mode:
				raise RuntimeError(message) from exc
			print(message)

	if _reports_env_truthy("REPORTS_STARTUP_VALIDATE_SMTP", "1"):
		mode = (os.getenv("EMAIL_SEND_MODE") or os.getenv("INVITE_EMAIL_MODE") or "log").strip().lower()
		if mode != "smtp":
			print("[REPORTS-STARTUP] SMTP validation skipped (mode != smtp)")
			return

		try:
			config = _smtp_config()
		except RuntimeError as exc:
			message = f"[REPORTS-STARTUP] SMTP config invalid: {exc}"
			if strict_mode:
				raise RuntimeError(message) from exc
			print(message)
			return

		try:
			timeout_seconds = _smtp_timeout_seconds()
			if config["security"] == "ssl":
				with smtplib.SMTP_SSL(config["host"], int(config["port"]), timeout=timeout_seconds) as server:
					server.login(config["login"], config["password"])
			else:
				with smtplib.SMTP(config["host"], int(config["port"]), timeout=timeout_seconds) as server:
					server.ehlo()
					if config["security"] == "starttls":
						server.starttls()
						server.ehlo()
					server.login(config["login"], config["password"])
			print("[REPORTS-STARTUP] SMTP connectivity/login OK")
		except Exception as exc:
			message = f"[REPORTS-STARTUP] SMTP validation failed: {type(exc).__name__}: {exc}"
			if strict_mode:
				raise RuntimeError(message) from exc
			print(message)


def _csv_bytes(rows: list[dict[str, Any]], headers: list[tuple[str, str]]) -> bytes:
	buffer = io.StringIO()
	writer = csv.writer(buffer, delimiter=";")
	writer.writerow([label for _, label in headers])
	for row in rows:
		writer.writerow([str(row.get(key) or "") for key, _ in headers])
	# UTF-8 BOM improves default opening in Excel.
	return buffer.getvalue().encode("utf-8-sig")


def _report_export_payload(
	report_type: ReportExportType,
	*,
	x_operator_login: str,
	manager_user_id: int | None,
) -> tuple[str, bytes]:
	if report_type == "inspections":
		payload = get_inspections_detailed(
			manager_user_id=manager_user_id,
			x_operator_login=x_operator_login,
		)
		rows = list(payload.get("rows") or [])
		headers = [
			("status", "Status"),
			("kod_inspekcji", "Kod inspekcji"),
			("nazwa_podmiotu", "Nazwa podmiotu"),
			("rodzaj_podmiotu", "Rodzaj podmiotu"),
			("zakres_inspekcji", "Zakres inspekcji"),
			("inspektor_kierujacy", "Inspektor kierujacy"),
			("zespoly", "Zespoly"),
			("poczatek_inspekcji", "Poczatek inspekcji"),
			("koniec_inspekcji", "Koniec inspekcji"),
		]
		return "inspekcje.csv", _csv_bytes(rows, headers)

	payload = get_recommendations_detailed(
		manager_user_id=manager_user_id,
		x_operator_login=x_operator_login,
	)
	rows = list(payload.get("rows") or [])
	headers = [
		("status", "Status"),
		("kod_zalecenia", "Kod zalecenia"),
		("kod_inspekcji", "Kod inspekcji"),
		("nazwa_podmiotu", "Nazwa podmiotu"),
		("data_zalecen", "Data zalecen"),
		("termin_zalecen", "Termin zalecen"),
		("zespoly", "Zespoly"),
	]
	return "zalecenia.csv", _csv_bytes(rows, headers)


def _send_email_with_attachments(
	*,
	to_email: str,
	subject: str,
	body: str,
	attachments: list[tuple[str, bytes]],
) -> None:
	mode = (os.getenv("EMAIL_SEND_MODE") or os.getenv("INVITE_EMAIL_MODE") or "log").strip().lower()
	if mode not in {"log", "smtp"}:
		mode = "log"

	if mode == "log":
		print("[REPORTS-EMAIL]", f"to={to_email}", f"subject={subject}", f"attachments={','.join(name for name, _ in attachments)}")
		return

	try:
		config = _smtp_config()
	except RuntimeError as exc:
		raise HTTPException(status_code=500, detail=str(exc)) from exc

	msg = EmailMessage()
	msg["Subject"] = subject
	msg["From"] = str(config["from_email"])
	msg["To"] = to_email
	msg.set_content(body)
	for filename, content in attachments:
		msg.add_attachment(content, maintype="text", subtype="csv", filename=filename)
	_send_smtp_message(msg, config=config)


def _send_email_with_typed_attachments(
	*,
	to_email: str,
	subject: str,
	body: str,
	attachments: list[tuple[str, bytes, str]],
) -> None:
	mode = (os.getenv("EMAIL_SEND_MODE") or os.getenv("INVITE_EMAIL_MODE") or "log").strip().lower()
	if mode not in {"log", "smtp"}:
		mode = "log"

	if mode == "log":
		print("[REPORTS-EMAIL]", f"to={to_email}", f"subject={subject}", f"attachments={','.join(name for name, _, _ in attachments)}")
		return

	try:
		config = _smtp_config()
	except RuntimeError as exc:
		raise HTTPException(status_code=500, detail=str(exc)) from exc

	msg = EmailMessage()
	msg["Subject"] = subject
	msg["From"] = str(config["from_email"])
	msg["To"] = to_email
	msg.set_content(body)
	for filename, content, mime_type in attachments:
		if "/" not in mime_type:
			raise HTTPException(status_code=500, detail="Niepoprawny typ MIME zalacznika")
		maintype, subtype = mime_type.split("/", 1)
		msg.add_attachment(content, maintype=maintype, subtype=subtype, filename=filename)
	_send_smtp_message(msg, config=config)


def _resolve_dashboard_recipient(conn: Any, operator_id: int) -> tuple[str, str]:
	row = conn.execute(
		"""
		SELECT login, imie, nazwisko, email
		FROM users
		WHERE id = ?
		LIMIT 1
		""",
		(int(operator_id),),
	).fetchone()
	if row is None:
		raise HTTPException(status_code=401, detail="Operator nie istnieje")
	data = dict(row)
	email = str(data.get("email") or "").strip().lower()
	if not _is_valid_email(email):
		raise HTTPException(status_code=422, detail="Zalogowany uzytkownik nie ma poprawnego adresu email")
	full_name = f"{str(data.get('imie') or '').strip()} {str(data.get('nazwisko') or '').strip()}".strip()
	if not full_name:
		full_name = str(data.get("login") or "").strip() or "Uzytkowniku"
	return email, full_name


def _dashboard_subject_date(generated_at: str | None) -> str:
	value = str(generated_at or "").strip()
	if value:
		candidate = value.replace("Z", "+00:00")
		try:
			return datetime.fromisoformat(candidate).date().isoformat()
		except ValueError:
			if re.match(r"^\d{4}-\d{2}-\d{2}", value):
				return value[:10]
	return date.today().isoformat()


def _resolve_dashboard_file_format(payload: DashboardSendHtmlRequest) -> DashboardRequestedFileFormat:
	requested = str(payload.meta.requestedFileFormat).strip().lower() if payload.meta and payload.meta.requestedFileFormat else ""
	if requested in {"html", "pdf"}:
		return requested  # type: ignore[return-value]
	file_name = str(payload.fileName or "").strip().lower()
	if file_name.endswith(".pdf"):
		return "pdf"
	return "html"


def _sanitize_dashboard_filename(file_name: str, target_format: DashboardRequestedFileFormat) -> str:
	raw = os.path.basename(str(file_name or "").strip())
	if not raw:
		raw = f"zrzut_dashboard.{target_format}"
	cleaned = re.sub(r"[^A-Za-z0-9._-]", "_", raw)
	if not cleaned:
		cleaned = f"zrzut_dashboard.{target_format}"
	if not cleaned.lower().endswith(f".{target_format}"):
		base = cleaned.rsplit(".", 1)[0] if "." in cleaned else cleaned
		cleaned = f"{base}.{target_format}"
	return cleaned[:180]


def _render_pdf_bytes_from_html(html: str) -> bytes:
	try:
		sync_api_module = importlib.import_module("playwright.sync_api")
		sync_playwright = getattr(sync_api_module, "sync_playwright")
	except ImportError as exc:
		raise HTTPException(
			status_code=500,
			detail="Brak zaleznosci playwright. Zainstaluj pakiet i przegladarke Chromium.",
		) from exc

	try:
		with sync_playwright() as playwright:
			browser = playwright.chromium.launch()
			page = browser.new_page()

			def _route_request(route: Any) -> None:
				url = str(route.request.url or "")
				if url.startswith("http://") or url.startswith("https://"):
					route.abort()
					return
				route.continue_()

			page.route("**/*", _route_request)
			page.set_content(html, wait_until="networkidle")
			page.emulate_media(media="screen")
			pdf = page.pdf(print_background=True, prefer_css_page_size=True)
			browser.close()
			return pdf
	except HTTPException:
		raise
	except Exception as exc:
		raise HTTPException(status_code=500, detail="Nie udalo sie wygenerowac PDF z HTML") from exc


def _decode_pdf_base64(raw_value: str) -> bytes:
	cleaned = str(raw_value or "").strip()
	if not cleaned:
		raise HTTPException(status_code=422, detail="pdfBase64 jest wymagane")
	if cleaned.startswith("data:"):
		_, _, tail = cleaned.partition(",")
		cleaned = tail.strip()
	try:
		decoded = base64.b64decode(cleaned, validate=True)
	except Exception as exc:
		raise HTTPException(status_code=422, detail="pdfBase64 ma niepoprawny format") from exc
	if not decoded:
		raise HTTPException(status_code=422, detail="pdfBase64 jest puste")
	if not decoded.startswith(b"%PDF"):
		raise HTTPException(status_code=422, detail="Przeslany plik nie jest poprawnym PDF")
	return decoded


def _normalize_code_key(value: str | None) -> str:
	cleaned = (value or "").strip().lower().replace("-", "_").replace(" ", "_")
	if not cleaned:
		return ""
	normalized = unicodedata.normalize("NFKD", cleaned)
	ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
	return re.sub(r"_+", "_", ascii_only)


def _resolve_stage_subgroup_code(status_code: str | None) -> str:
	code = _normalize_code_key(status_code)
	if code == "plan":
		return "pre_planned"
	if code == "przygotowanie":
		return "pre_preparation"
	if code == "trwa":
		return "in_progress_active"
	if code == "zakonczona_piszemy":
		return "in_progress_report_writing"
	if code.startswith("przekazano_protoko"):
		return "post_protocol_sent"
	if code == "przekazano_pismo_po_wizycie":
		return "post_post_visit_letter_sent"
	if code == "wplynely_zastrzezenia":
		return "post_objections_received"
	if code == "wplynela_odp_po_wizycie":
		return "post_post_visit_response_received"
	if code == "piszemy_zalecenia_odstapienie":
		return "rec_writing_recommendations"
	if code.startswith("pismo_ustalen"):
		return "rec_findings_letter"
	if "zamkn" in code and ("wydano_zalec" in code or "z_zalec" in code):
		return "closed_with_recommendations"
	if "zamkn" in code and ("brak_zalec" in code or "bez_zalec" in code):
		return "closed_without_recommendations"
	return "unknown_unmapped"


def _stage_payload_from_status_code(status_code: str | None) -> dict[str, Any]:
	subgroup_code = _resolve_stage_subgroup_code(status_code)
	return dict(STAGE_SUBGROUP_INDEX.get(subgroup_code, STAGE_SUBGROUP_INDEX["unknown_unmapped"]))


def _manager_scope_flags_for_inspection(conn: Any, inspection_id: int, manager: dict[str, Any]) -> tuple[bool, bool]:
	team_id = manager.get("zespol_id")
	has_team = team_id is not None

	leader_row = conn.execute(
		"""
		SELECT u.zespol_id AS leader_team_id, u.created_by_user_id AS leader_created_by
		FROM inspections i
		LEFT JOIN users u ON u.id = i.osoba_kierujaca_user_id
		WHERE i.id = ?
		LIMIT 1
		""",
		(int(inspection_id),),
	).fetchone()

	in_team_scope = False
	in_added_scope = False
	if leader_row is not None:
		leader_team_id = leader_row["leader_team_id"]
		leader_created_by = leader_row["leader_created_by"]
		if has_team and leader_team_id is not None and int(leader_team_id) == int(team_id):
			in_team_scope = True
		if leader_created_by is not None and int(leader_created_by) == int(manager["id"]):
			in_added_scope = True

	if has_team:
		member_row = conn.execute(
			"""
			SELECT
				MAX(CASE WHEN u.zespol_id = ? THEN 1 ELSE 0 END) AS has_team_member,
				MAX(CASE WHEN u.created_by_user_id = ? THEN 1 ELSE 0 END) AS has_added_member
			FROM inspection_members im
			JOIN users u ON u.id = im.user_id
			WHERE im.inspection_id = ?
			""",
			(int(team_id), int(manager["id"]), int(inspection_id)),
		).fetchone()
	else:
		member_row = conn.execute(
			"""
			SELECT
				0 AS has_team_member,
				MAX(CASE WHEN u.created_by_user_id = ? THEN 1 ELSE 0 END) AS has_added_member
			FROM inspection_members im
			JOIN users u ON u.id = im.user_id
			WHERE im.inspection_id = ?
			""",
			(int(manager["id"]), int(inspection_id)),
		).fetchone()
	if member_row is not None:
		in_team_scope = in_team_scope or int(member_row["has_team_member"] or 0) == 1
		in_added_scope = in_added_scope or int(member_row["has_added_member"] or 0) == 1

	return in_team_scope, in_added_scope


def _recommendation_ids_for_manager_team(conn: Any, manager: dict[str, Any]) -> set[int]:
	team_id = manager.get("zespol_id")
	if team_id is None:
		return set()
	rows = conn.execute(
		"""
		SELECT DISTINCT recommendation_id
		FROM recommendation_teams
		WHERE team_id = ?
		""",
		(int(team_id),),
	).fetchall()
	return {
		int(row["recommendation_id"])
		for row in rows
		if row["recommendation_id"] is not None
	}


def _public_status_label(value: str | None) -> str:
	return str(value or "-").strip() or "-"


def _should_compute_bucket_code(status_code: str | None) -> bool:
	return _is_excluded_status_code(status_code, _DASHBOARD_ALERT_INSPECTION_STATUS_CODES)


def _parse_csv_values(raw_value: str | list[str] | None) -> list[str]:
	if raw_value is None:
		return []
	items = raw_value if isinstance(raw_value, list) else [raw_value]
	parts: list[str] = []
	for item in items:
		for part in re.split(r"[,;\n]", str(item)):
			cleaned = part.strip()
			if cleaned:
				parts.append(cleaned)
	# Keep insertion order while removing duplicates.
	return list(dict.fromkeys(parts))


def _parse_int_csv_values(raw_value: str | list[str] | None) -> list[int]:
	values: list[int] = []
	for part in _parse_csv_values(raw_value):
		if str(part).strip().isdigit():
			values.append(int(str(part).strip()))
	return values


def _load_excluded_status_codes(env_key: str) -> set[str]:
	raw_value = os.getenv(env_key)
	if raw_value is None:
		return set()
	return {
		normalized
		for normalized in (_normalize_code_key(v) for v in _parse_csv_values(raw_value))
		if normalized
	}


def _load_ordered_status_codes(env_key: str) -> list[str]:
	raw_value = os.getenv(env_key)
	if raw_value is None:
		return []
	ordered: list[str] = []
	for value in _parse_csv_values(raw_value):
		normalized = _normalize_code_key(value)
		if normalized:
			ordered.append(normalized)
	# Keep insertion order while removing duplicates.
	return list(dict.fromkeys(ordered))


def _dashboard_status_display_order(status_code: str | None, fallback_order: int) -> int:
	normalized = _normalize_code_key(status_code)
	custom_index = _DASHBOARD_INSPECTION_STATUS_ORDER_INDEX.get(normalized)
	if custom_index is not None:
		return custom_index + 1
	# Unlisted statuses are displayed after explicitly configured ones.
	return 10000 + int(fallback_order)


_DASHBOARD_EXCLUDED_INSPECTION_STATUS_CODES = _load_excluded_status_codes("DASHBOARD_EXCLUDED_INSPECTION_STATUS_CODES")
_DASHBOARD_EXCLUDED_RECOMMENDATION_STATUS_CODES = _load_excluded_status_codes("DASHBOARD_EXCLUDED_RECOMMENDATION_STATUS_CODES")
_DASHBOARD_INSPECTION_STATUS_ORDER_CODES = _load_ordered_status_codes("DASHBOARD_INSPECTION_STATUS_ORDER_CODES")
_DASHBOARD_INSPECTION_STATUS_ORDER_INDEX = {
	code: idx for idx, code in enumerate(_DASHBOARD_INSPECTION_STATUS_ORDER_CODES)
}
_DASHBOARD_ALERT_INSPECTION_STATUS_CODES = (
	_load_excluded_status_codes("DASHBOARD_ALERT_INSPECTION_STATUS_CODES")
	or {_normalize_code_key("I_SI_4")}
)
_REPORTS_EXCLUDED_INSPECTION_STATUS_CODES = _load_excluded_status_codes("REPORTS_EXCLUDED_INSPECTION_STATUS_CODES")
_REPORTS_EXCLUDED_RECOMMENDATION_STATUS_CODES = _load_excluded_status_codes("REPORTS_EXCLUDED_RECOMMENDATION_STATUS_CODES")
_MAX_DASHBOARD_HTML_MB_DEFAULT = 64
try:
	_MAX_DASHBOARD_HTML_MB = int((os.getenv("REPORTS_SEND_HTML_MAX_MB") or str(_MAX_DASHBOARD_HTML_MB_DEFAULT)).strip())
except ValueError:
	_MAX_DASHBOARD_HTML_MB = _MAX_DASHBOARD_HTML_MB_DEFAULT
if _MAX_DASHBOARD_HTML_MB < 1:
	_MAX_DASHBOARD_HTML_MB = _MAX_DASHBOARD_HTML_MB_DEFAULT
_MAX_DASHBOARD_HTML_BYTES = _MAX_DASHBOARD_HTML_MB * 1024 * 1024


def _is_excluded_status_code(status_code: str | None, excluded_codes: set[str]) -> bool:
	return _normalize_code_key(status_code) in excluded_codes


def _is_dashboard_hidden_status_code(status_code: str | None) -> bool:
	return _is_excluded_status_code(status_code, _DASHBOARD_EXCLUDED_INSPECTION_STATUS_CODES)


def _is_dashboard_hidden_recommendation_status_code(status_code: str | None) -> bool:
	return _is_excluded_status_code(status_code, _DASHBOARD_EXCLUDED_RECOMMENDATION_STATUS_CODES)


def _is_reports_hidden_status_code(status_code: str | None) -> bool:
	return _is_excluded_status_code(status_code, _REPORTS_EXCLUDED_INSPECTION_STATUS_CODES)


def _is_reports_hidden_recommendation_status_code(status_code: str | None) -> bool:
	return _is_excluded_status_code(status_code, _REPORTS_EXCLUDED_RECOMMENDATION_STATUS_CODES)


def _can_access_inspection_for_reports(conn: Any, inspection_row: dict[str, Any], operator: dict[str, Any]) -> bool:
	if int(operator["rola_id"]) == 3:
		return True
	if int(operator["rola_id"]) == 4:
		return True

	inspection_id = int(inspection_row["id"])

	if int(operator["rola_id"]) == 2:
		operator_team_id = operator.get("zespol_id")
		has_team = operator_team_id is not None

		if has_team:
			leader_row = conn.execute(
				"""
				SELECT 1
				FROM inspections i
				JOIN users u ON u.id = i.osoba_kierujaca_user_id
				WHERE i.id = ?
				  AND (
				      u.zespol_id = ?
				      OR u.created_by_user_id = ?
				  )
				LIMIT 1
				""",
				(inspection_id, int(operator_team_id), int(operator["id"])),
			).fetchone()
		else:
			leader_row = conn.execute(
				"""
				SELECT 1
				FROM inspections i
				JOIN users u ON u.id = i.osoba_kierujaca_user_id
				WHERE i.id = ?
				  AND u.created_by_user_id = ?
				LIMIT 1
				""",
				(inspection_id, int(operator["id"])),
			).fetchone()
		if leader_row is not None:
			return True

		if has_team:
			member_team_row = conn.execute(
				"""
				SELECT 1
				FROM inspection_members im
				JOIN users u ON u.id = im.user_id
				WHERE im.inspection_id = ?
				  AND (
				      u.zespol_id = ?
				      OR u.created_by_user_id = ?
				  )
				LIMIT 1
				""",
				(inspection_id, int(operator_team_id), int(operator["id"])),
			).fetchone()
		else:
			member_team_row = conn.execute(
				"""
				SELECT 1
				FROM inspection_members im
				JOIN users u ON u.id = im.user_id
				WHERE im.inspection_id = ?
				  AND u.created_by_user_id = ?
				LIMIT 1
				""",
				(inspection_id, int(operator["id"])),
			).fetchone()
		return member_team_row is not None

	created_by_user_id = inspection_row.get("created_by_user_id")
	if created_by_user_id is not None and int(created_by_user_id) == int(operator["id"]):
		return True

	member_row = conn.execute(
		"SELECT 1 FROM inspection_members WHERE inspection_id = ? AND user_id = ? LIMIT 1",
		(inspection_id, int(operator["id"])),
	).fetchone()
	if member_row is not None:
		return True

	leader_row = conn.execute(
		"SELECT 1 FROM inspections WHERE id = ? AND osoba_kierujaca_user_id = ? LIMIT 1",
		(inspection_id, int(operator["id"])),
	).fetchone()
	return leader_row is not None


def _can_access_recommendation_for_reports(conn: Any, recommendation_row: dict[str, Any], operator: dict[str, Any]) -> bool:
	if int(operator["rola_id"]) == 3:
		return True

	inspection_id_raw = recommendation_row.get("inspection_id")
	if inspection_id_raw is not None:
		inspection_row = {
			"id": int(inspection_id_raw),
			"created_by_user_id": recommendation_row.get("inspection_created_by_user_id"),
		}
		return _can_access_inspection_for_reports(conn, inspection_row, operator)

	author_id_raw = recommendation_row.get("recommendation_created_by_user_id")
	if author_id_raw is None:
		return False
	author_id = int(author_id_raw)

	if author_id == int(operator["id"]):
		return True

	if int(operator["rola_id"]) == 2:
		author_team_id = recommendation_row.get("recommendation_author_team_id")
		author_created_by = recommendation_row.get("recommendation_author_created_by_user_id")
		if author_created_by is not None and int(author_created_by) == int(operator["id"]):
			return True
		operator_team_id = operator.get("zespol_id")
		if operator_team_id is None or author_team_id is None:
			return False
		return int(author_team_id) == int(operator_team_id)

	return False


def _safe_average(values: list[int]) -> float | None:
	if not values:
		return None
	return float(sum(values)) / float(len(values))


def _metric_from_values(values: list[int], trend_mode: str) -> float | None:
	if not values:
		return None
	if trend_mode == "average":
		return _safe_average(values)
	return float(median(values))


def _is_member_current_user(conn: Any, inspection_id: int, operator_id: int) -> bool:
	row = conn.execute(
		"SELECT 1 FROM inspection_members WHERE inspection_id = ? AND user_id = ? LIMIT 1",
		(int(inspection_id), int(operator_id)),
	).fetchone()
	return row is not None


def _is_leader_in_manager_scope(conn: Any, leader_user_id: int | None, operator: dict[str, Any]) -> bool:
	if int(operator.get("rola_id", 0)) != 2:
		return False
	if leader_user_id is None:
		return False
	operator_team_id = operator.get("zespol_id")
	if operator_team_id is None:
		return False
	row = conn.execute(
		"""
		SELECT 1
		FROM users u
		WHERE u.id = ?
		  AND (
		      u.zespol_id = ?
		      OR u.created_by_user_id = ?
		  )
		LIMIT 1
		""",
		(int(leader_user_id), int(operator_team_id), int(operator["id"])),
	).fetchone()
	return row is not None


def _is_member_in_manager_scope(conn: Any, inspection_id: int, operator: dict[str, Any]) -> bool:
	if int(operator.get("rola_id", 0)) != 2:
		return False
	operator_team_id = operator.get("zespol_id")
	if operator_team_id is None:
		return False
	row = conn.execute(
		"""
		SELECT 1
		FROM inspection_members im
		JOIN users u ON u.id = im.user_id
		WHERE im.inspection_id = ?
		  AND (
		      u.zespol_id = ?
		      OR u.created_by_user_id = ?
		  )
		LIMIT 1
		""",
		(int(inspection_id), int(operator_team_id), int(operator["id"])),
	).fetchone()
	return row is not None


@router.get("/api/reports/inspections-time-analytics", response_model=InspectionsTimeAnalyticsResponse)
def get_inspections_time_analytics(
	x_operator_login: str | None = Header(default=None, alias="X-Operator-Login"),
	inspectionType: str = Query(...),
	trendMode: str = Query("median"),
	teams: str | None = Query(default=None),
	years: list[str] | None = Query(default=None),
) -> dict[str, Any]:
	inspection_type = inspectionType.strip().upper()
	if inspection_type not in {"K", "W"}:
		raise HTTPException(status_code=400, detail="inspectionType musi byc K albo W")

	trend_mode = trendMode.strip().lower()
	if trend_mode not in {"average", "median"}:
		raise HTTPException(status_code=400, detail="trendMode musi byc average albo median")
	metric_label = "Srednia" if trend_mode == "average" else "Mediana"

	# Frontend may pass teams='-' from stale/default state; treat it as no team filter.
	team_filter = {
		str(value).strip()
		for value in _parse_csv_values(teams)
		if str(value).strip() not in {"", "-"}
	}
	year_filter = set(_parse_csv_values(years))

	with get_connection() as conn:
		operator = _resolve_operator(conn, x_operator_login)
		require_permission(conn, operator, PERMISSION_REPORTS_REPORT_TIME_READ)
		if int(operator["rola_id"]) not in {1, 2, 3, 4}:
			raise HTTPException(status_code=403, detail="Brak uprawnien")

		operator_team_id = int(operator["zespol_id"]) if operator.get("zespol_id") is not None else None
		operator_team_code = "-"
		if operator_team_id is not None:
			team_row = conn.execute("SELECT kod FROM teams WHERE id = ? LIMIT 1", (operator_team_id,)).fetchone()
			if team_row is not None:
				operator_team_code = str(team_row["kod"] or "-").strip() or "-"

		operator_member_inspections: set[int] = set()
		operator_member_rows = conn.execute(
			"""
			SELECT DISTINCT inspection_id
			FROM inspection_members
			WHERE user_id = ?
			""",
			(int(operator["id"]),),
		).fetchall()
		operator_member_inspections = {int(item["inspection_id"]) for item in operator_member_rows}

		rows = conn.execute(
			"""
			SELECT
				i.id,
				i.kod_inspekcji,
				i.created_by_user_id,
				i.osoba_kierujaca_user_id,
				i.poczatek_inspekcji,
				i.koniec_inspekcji,
				i.data_protokolu_sprawozdania,
				i.status_inspekcji_id,
				COALESCE(si.kod_pozycji, '') AS status_inspekcji_kod,
				ti.nazwa_pozycji AS typ_inspekcji,
				COALESCE(si.nazwa_pozycji, '-') AS status_inspekcji,
				COALESCE(NULLIF(trim(si.skrot_pozycji), ''), si.nazwa_pozycji, '-') AS status_inspekcji_skrot,
				COALESCE(NULLIF(trim(np.skrot_pozycji), ''), np.nazwa_pozycji, '-') AS nazwa_podmiotu,
				(
					SELECT group_concat(x.scope_name, '; ')
					FROM (
						SELECT COALESCE(NULLIF(trim(sp.nazwa_pozycji), ''), '-') AS scope_name
						FROM inspection_scopes isc
						JOIN slownik_pozycje sp ON sp.id = isc.scope_id
						WHERE isc.inspection_id = i.id
						ORDER BY lower(COALESCE(NULLIF(trim(sp.nazwa_pozycji), ''), '-')), sp.id
					) x
				) AS zakres_inspekcji,
				(
					SELECT group_concat(x.scope_id, ';')
					FROM (
						SELECT CAST(isc.scope_id AS TEXT) AS scope_id
						FROM inspection_scopes isc
						JOIN slownik_pozycje sp ON sp.id = isc.scope_id
						WHERE isc.inspection_id = i.id
						ORDER BY lower(COALESCE(NULLIF(trim(sp.nazwa_pozycji), ''), '-')), sp.id
					) x
				) AS zakres_inspekcji_ids_csv,
				COALESCE(u.login, '-') AS osoba_kierujaca,
				COALESCE(t.kod, '-') AS zespol_osoby_kierujacej_kod,
				u.zespol_id AS lead_team_id,
				(
					SELECT group_concat(x.team_code, ', ')
					FROM (
						SELECT DISTINCT COALESCE(NULLIF(trim(tt.kod), ''), '-') AS team_code
						FROM inspection_teams it
						JOIN teams tt ON tt.id = it.team_id
						WHERE it.inspection_id = i.id
						ORDER BY lower(COALESCE(NULLIF(trim(tt.kod), ''), '-')), tt.id
					) x
				) AS inspection_team_codes,
				(
					SELECT group_concat(x.team_id, ',')
					FROM (
						SELECT DISTINCT CAST(it.team_id AS TEXT) AS team_id
						FROM inspection_teams it
						WHERE it.inspection_id = i.id
						ORDER BY it.team_id ASC
					) x
				) AS inspection_team_ids_csv
			FROM inspections i
			LEFT JOIN slownik_pozycje ti ON ti.id = i.typ_inspekcji_id
			LEFT JOIN slownik_pozycje si ON si.id = i.status_inspekcji_id
			LEFT JOIN slownik_pozycje np ON np.id = i.nazwa_podmiotu_id
			LEFT JOIN users u ON u.id = i.osoba_kierujaca_user_id
			LEFT JOIN teams t ON t.id = u.zespol_id
			ORDER BY i.id ASC
			"""
		).fetchall()

	typed_rows: list[dict[str, Any]] = []
	all_type_base_rows: list[dict[str, Any]] = []
	base_rows: list[dict[str, Any]] = []
	scope_name_cache: dict[int, str] = {}
	for raw_row in rows:
		row = dict(raw_row)
		if _is_reports_hidden_status_code(row.get("status_inspekcji_kod")):
			continue
		row_type = _inspekcja_code(row.get("typ_inspekcji"))
		if row_type not in {"K", "W"}:
			continue

		diff = _days_difference(row.get("data_protokolu_sprawozdania"), row.get("koniec_inspekcji"))
		year = _year_from_date(row.get("poczatek_inspekcji"))
		team_code = str(row.get("zespol_osoby_kierujacej_kod") or "-").strip() or "-"
		status_label = _public_status_label(row.get("status_inspekcji"))
		stage_payload = _stage_payload_from_status_code(row.get("status_inspekcji_kod"))
		inspection_id = int(row["id"])
		inspection_team_codes = [
			value.strip()
			for value in str(row.get("inspection_team_codes") or "").split(",")
			if value.strip()
		]
		inspection_team_ids = [
			int(value)
			for value in str(row.get("inspection_team_ids_csv") or "").split(",")
			if value.strip().isdigit()
		]
		leader_user_id = row.get("osoba_kierujaca_user_id")
		is_leader_current_user = leader_user_id is not None and int(leader_user_id) == int(operator["id"])
		is_member_current_user = inspection_id in operator_member_inspections
		zakres_inspekcji_raw = str(row.get("zakres_inspekcji") or "-").strip() or "-"
		zakres_inspekcji_items = _scope_items_from_ids_csv(conn, row.get("zakres_inspekcji_ids_csv"), scope_name_cache)
		normalized_row = {
			"inspectionId": inspection_id,
			"kodInspekcji": str(row.get("kod_inspekcji") or "-").strip() or "-",
			"inspekcja": row_type,
			"statusInspekcjiId": int(row["status_inspekcji_id"]) if row.get("status_inspekcji_id") is not None else None,
			"statusInspekcji": status_label,
				"statusInspekcjiSkrot": str(row.get("status_inspekcji_skrot") or status_label or "-").strip() or "-",
			"nazwaPodmiotu": str(row.get("nazwa_podmiotu") or "-").strip() or "-",
				"zakresInspekcji": zakres_inspekcji_raw,
				"zakresInspekcjiItems": zakres_inspekcji_items,
			"osobaKierujaca": str(row.get("osoba_kierujaca") or "-").strip() or "-",
			"rokPoczatku": year,
			"poczatekInspekcji": row.get("poczatek_inspekcji"),
			"koniecInspekcji": row.get("koniec_inspekcji"),
			"data": row.get("data_protokolu_sprawozdania"),
			"zespol": team_code,
			"inspectionTeamCodes": inspection_team_codes,
			"inspectionTeamIds": inspection_team_ids,
			"zespolyInspekcji": ", ".join(inspection_team_codes) if inspection_team_codes else "-",
			"czas": diff,
			"isLeaderCurrentUser": is_leader_current_user,
			"isMemberCurrentUser": is_member_current_user,
			"leadTeamId": row.get("lead_team_id"),
			"stageGroupCode": stage_payload["stage_group_code"],
			"stageGroupLabel": stage_payload["stage_group_label"],
			"stageGroupOrder": stage_payload["stage_group_order"],
			"stageSubgroupCode": stage_payload["stage_subgroup_code"],
			"stageSubgroupLabel": stage_payload["stage_subgroup_label"],
			"stageSubgroupOrder": stage_payload["stage_subgroup_order"],
		}

		all_type_base_rows.append(normalized_row)

		if row_type != inspection_type:
			continue

		typed_rows.append(normalized_row)

		base_rows.append(normalized_row)

	if year_filter:
		rows_after_year = [row for row in base_rows if str(row.get("rokPoczatku") or "") in year_filter]
	else:
		rows_after_year = list(base_rows)

	if team_filter:
		filtered_rows = [row for row in rows_after_year if str(row.get("zespol") or "") in team_filter]
	else:
		filtered_rows = list(rows_after_year)

	# Year-count section is intentionally based on all inspection types (K + W)
	# and mirrors permission + team filtering used by this report.
	rows_for_counts = list(all_type_base_rows)
	if year_filter:
		rows_for_counts = [row for row in rows_for_counts if str(row.get("rokPoczatku") or "") in year_filter]
	if team_filter:
		rows_for_counts = [row for row in rows_for_counts if str(row.get("zespol") or "") in team_filter]

	(
		year_count_columns,
		year_count_rows,
		year_count_by_team_columns,
		year_count_by_team_rows,
	) = build_year_count_sections(rows_for_counts, inspection_type)

	team_options = sorted({str(row["zespol"]) for row in base_rows if str(row.get("zespol") or "") not in {"", "-"}})
	year_options = sorted({str(row["rokPoczatku"]) for row in base_rows if row.get("rokPoczatku") is not None}, reverse=True)
	# Business rule: inspector must receive the same dataset as director/team_lead in this report.
	is_personal_scope_mode = False

	def _is_valid_for_aggregations(row: dict[str, Any]) -> bool:
		if row.get("rokPoczatku") is None:
			return False
		czas_value = row.get("czas")
		return isinstance(czas_value, (int, float))

	if is_personal_scope_mode:
		if year_filter:
			department_min_max_source = [
				row
				for row in typed_rows
				if str(row.get("rokPoczatku") or "") in year_filter and _is_valid_for_aggregations(row)
			]
		else:
			department_min_max_source = [row for row in typed_rows if _is_valid_for_aggregations(row)]
	else:
		department_min_max_source = [row for row in rows_after_year if _is_valid_for_aggregations(row)]

	department_times_for_bounds = [int(row["czas"]) for row in department_min_max_source]
	department_min_time = min(department_times_for_bounds) if department_times_for_bounds else None
	department_max_time = max(department_times_for_bounds) if department_times_for_bounds else None

	agg_filtered_rows = [row for row in filtered_rows if _is_valid_for_aggregations(row)]
	department_scope_rows = [row for row in rows_after_year if _is_valid_for_aggregations(row)]

	summary_rows: list[dict[str, Any]] = []
	overall_rows: list[dict[str, Any]] = []
	all_year_metric_by_team: dict[str, float | None] = {}
	overall_metric_key = "average" if trend_mode == "average" else "median"
	overall_metric_label = "Srednia" if trend_mode == "average" else "Mediana"

	if is_personal_scope_mode:
		if year_filter:
			typed_rows_after_year = [row for row in typed_rows if str(row.get("rokPoczatku") or "") in year_filter]
		else:
			typed_rows_after_year = list(typed_rows)
		typed_rows_all_year = list(typed_rows_after_year)

		department_user_scope_all_year = [row for row in typed_rows_all_year if _is_valid_for_aggregations(row)]

		department_user_scope = [row for row in typed_rows_after_year if _is_valid_for_aggregations(row)]

		team_user_scope: list[dict[str, Any]] = []
		team_user_scope_all_year: list[dict[str, Any]] = []
		if operator_team_id is not None:
			for row in typed_rows_all_year:
				if not _is_valid_for_aggregations(row):
					continue
				lead_team_id = row.get("leadTeamId")
				is_team_row = lead_team_id is not None and int(lead_team_id) == int(operator_team_id)
				if is_team_row:
					team_user_scope_all_year.append(row)

			for row in typed_rows_after_year:
				if not _is_valid_for_aggregations(row):
					continue
				lead_team_id = row.get("leadTeamId")
				is_team_row = lead_team_id is not None and int(lead_team_id) == int(operator_team_id)
				if is_team_row:
					team_user_scope.append(row)

		my_user_scope_all_year = [
			row
			for row in base_rows
			if _is_valid_for_aggregations(row)
			and (bool(row.get("isLeaderCurrentUser")) or bool(row.get("isMemberCurrentUser")))
		]
		my_user_scope = [
			row
			for row in rows_after_year
			if _is_valid_for_aggregations(row)
			and (bool(row.get("isLeaderCurrentUser")) or bool(row.get("isMemberCurrentUser")))
		]

		dept_groups: dict[str, list[int]] = defaultdict(list)
		for row in department_user_scope:
			dept_groups[str(row["rokPoczatku"])].append(int(row["czas"]))

		team_groups: dict[str, list[int]] = defaultdict(list)
		for row in team_user_scope:
			team_groups[str(row["rokPoczatku"])].append(int(row["czas"]))

		my_groups: dict[str, list[int]] = defaultdict(list)
		for row in my_user_scope:
			my_groups[str(row["rokPoczatku"])].append(int(row["czas"]))

		all_years = sorted(set(dept_groups.keys()) | set(team_groups.keys()) | set(my_groups.keys()))
		for year in all_years:
			for scope_name, values in (
				("Departament", dept_groups.get(year, [])),
				(operator_team_code, team_groups.get(year, [])),
				("Moj czas", my_groups.get(year, [])),
			):
				if not values:
					continue
				avg_value = _safe_average(values)
				med_value = float(median(values)) if values else None
				metric_value = avg_value if trend_mode == "average" else med_value
				summary_rows.append(
					{
						"rok": year,
						"zespol": scope_name,
						"year": year,
						"team": scope_name,
						"count": len(values),
						"average": avg_value,
						"median": med_value,
						"min": min(values),
						"max": max(values),
						"metric": metric_value,
					}
				)

		for scope_name, rows_scope in (
			("Departament", department_user_scope),
			(operator_team_code, team_user_scope),
			("Moj czas", my_user_scope),
		):
			values = [int(item["czas"]) for item in rows_scope]
			if not values:
				continue
			avg_value = _safe_average(values)
			med_value = float(median(values)) if values else None
			metric_value = avg_value if trend_mode == "average" else med_value
			overall_rows.append(
				{
					"zespol": scope_name,
					"count": len(values),
					"average": avg_value,
					"median": med_value,
					"min": min(values),
					"max": max(values),
					"metric": metric_value,
				}
			)

		for scope_name, rows_scope in (
			("Departament", department_user_scope_all_year),
			(operator_team_code, team_user_scope_all_year),
			("Moj czas", my_user_scope_all_year),
		):
			values = [int(item["czas"]) for item in rows_scope]
			if not values:
				continue
			all_year_metric_by_team[scope_name] = _metric_from_values(values, trend_mode)
	else:
		summary_groups: dict[tuple[str, str], list[int]] = defaultdict(list)
		for row in agg_filtered_rows:
			summary_groups[(str(row["rokPoczatku"]), str(row["zespol"]))].append(int(row["czas"]))

		for (year, team), values in sorted(summary_groups.items(), key=lambda item: (item[0][0], item[0][1])):
			avg_value = _safe_average(values)
			med_value = float(median(values)) if values else None
			metric_value = avg_value if trend_mode == "average" else med_value
			summary_rows.append(
				{
					"rok": year,
					"zespol": team,
					"year": year,
					"team": team,
					"count": len(values),
					"average": avg_value,
					"median": med_value,
					"min": min(values) if values else None,
					"max": max(values) if values else None,
					"metric": metric_value,
				}
			)

		department_groups: dict[str, list[int]] = defaultdict(list)
		for row in department_scope_rows:
			department_groups[str(row["rokPoczatku"])].append(int(row["czas"]))

		for year, values in sorted(department_groups.items(), key=lambda item: item[0]):
			avg_value = _safe_average(values)
			med_value = float(median(values)) if values else None
			metric_value = avg_value if trend_mode == "average" else med_value
			summary_rows.append(
				{
					"rok": year,
					"zespol": "Departament",
					"year": year,
					"team": "Departament",
					"count": len(values),
					"average": avg_value,
					"median": med_value,
					"min": min(values) if values else None,
					"max": max(values) if values else None,
					"metric": metric_value,
				}
			)

		team_all_year_groups: dict[str, list[int]] = defaultdict(list)
		for row in rows_after_year:
			if not _is_valid_for_aggregations(row):
				continue
			if team_filter and str(row.get("zespol") or "") not in team_filter:
				continue
			team_all_year_groups[str(row["zespol"])].append(int(row["czas"]))

		for team_name, values in team_all_year_groups.items():
			all_year_metric_by_team[team_name] = _metric_from_values(values, trend_mode)

		department_all_year_values = [int(row["czas"]) for row in rows_after_year if _is_valid_for_aggregations(row)]
		if department_all_year_values:
			all_year_metric_by_team["Departament"] = _metric_from_values(department_all_year_values, trend_mode)

		# Overall rows for general summary table (all years, same dataset for count/metric).
		for team_name, values in sorted(team_all_year_groups.items(), key=lambda item: item[0]):
			if not values:
				continue
			avg_value = _safe_average(values)
			med_value = float(median(values)) if values else None
			overall_rows.append(
				{
					"zespol": team_name,
					"count": len(values),
					"average": avg_value,
					"median": med_value,
					overall_metric_key: avg_value if trend_mode == "average" else med_value,
					"metric": avg_value if trend_mode == "average" else med_value,
				}
			)

		if department_all_year_values:
			dept_avg = _safe_average(department_all_year_values)
			dept_median = float(median(department_all_year_values)) if department_all_year_values else None
			overall_rows.append(
				{
					"zespol": "Departament",
					"count": len(department_all_year_values),
					"average": dept_avg,
					"median": dept_median,
					overall_metric_key: dept_avg if trend_mode == "average" else dept_median,
					"metric": dept_avg if trend_mode == "average" else dept_median,
				}
			)

	trend_groups: dict[str, list[int]] = defaultdict(list)
	for row in agg_filtered_rows:
		trend_groups[str(row["rokPoczatku"])].append(int(row["czas"]))

	trend_rows: list[dict[str, Any]] = []
	for year, values in sorted(trend_groups.items(), key=lambda item: item[0]):
		if not str(year).isdigit():
			continue
		avg_value = _safe_average(values)
		med_value = float(median(values)) if values else None
		trend_rows.append(
			{
				"year": int(year),
				"count": len(values),
				"average": avg_value,
				"median": med_value,
				"min": min(values) if values else None,
				"max": max(values) if values else None,
				"trend": avg_value if trend_mode == "average" else med_value,
			}
		)

	department_year_values: dict[str, list[int]] = defaultdict(list)
	for row in department_min_max_source:
		year_key = str(row.get("rokPoczatku") or "").strip()
		if not year_key:
			continue
		department_year_values[year_key].append(int(row["czas"]))

	target_years_for_bounds: list[str]
	if year_filter:
		target_years_for_bounds = sorted({str(item).strip() for item in year_filter if str(item).strip()})
	else:
		target_years_for_bounds = [str(item["year"]) for item in trend_rows if item.get("year") is not None]

	department_min_time_by_year: dict[str, int | None] = {}
	department_max_time_by_year: dict[str, int | None] = {}
	for year_key in target_years_for_bounds:
		year_values = department_year_values.get(year_key, [])
		department_min_time_by_year[year_key] = min(year_values) if year_values else None
		department_max_time_by_year[year_key] = max(year_values) if year_values else None

	summary_pivot_years = sorted({str(row.get("rok")) for row in summary_rows if row.get("rok") not in {None, ""}})
	pivot_team_order: list[str] = []
	pivot_team_values: dict[str, dict[str, float]] = {}
	for row in summary_rows:
		team_name = str(row.get("zespol") or "").strip()
		year_value = str(row.get("rok") or "").strip()
		metric_value = row.get("metric")
		if not team_name or not year_value or not isinstance(metric_value, (int, float)):
			continue
		if team_name not in pivot_team_values:
			pivot_team_values[team_name] = {}
			pivot_team_order.append(team_name)
		pivot_team_values[team_name][year_value] = float(metric_value)

	summary_pivot_rows: list[dict[str, Any]] = []
	for team_name in all_year_metric_by_team.keys():
		if team_name not in pivot_team_order:
			pivot_team_order.append(team_name)
	include_all_years_pivot = is_personal_scope_mode or bool(year_filter)
	if include_all_years_pivot and "allYears" not in summary_pivot_years:
		summary_pivot_years.append("allYears")
	for team_name in pivot_team_order:
		values = {
			year: float(pivot_team_values[team_name].get(year) or 0)
			for year in summary_pivot_years
			if year != "allYears"
		}
		if include_all_years_pivot:
			values["allYears"] = float(all_year_metric_by_team.get(team_name) or 0)
		summary_pivot_rows.append(
			{
				"zespol": team_name,
				"values": values,
			}
		)

	detail_source_rows = [row for row in filtered_rows if _is_valid_for_aggregations(row)]
	if is_personal_scope_mode:
		detail_source_rows = [
			row
			for row in detail_source_rows
			if bool(row.get("isLeaderCurrentUser")) or bool(row.get("isMemberCurrentUser"))
		]

	detail_rows = [
		{
			"inspectionId": row["inspectionId"],
			"inspekcja": row["inspekcja"],
			"kontrola": row["kodInspekcji"],
			"kodInspekcji": row["kodInspekcji"],
			"kod_inspekcji": row["kodInspekcji"],
			"year": row.get("rokPoczatku") or "-",
			"rokPoczatku": row.get("rokPoczatku") or "-",
			"statusInspekcjiId": row.get("statusInspekcjiId"),
			"statusInspekcji": row.get("statusInspekcji") or "-",
			"status": row.get("statusInspekcji") or "-",
			"stage_group_code": row.get("stageGroupCode"),
			"stage_group_label": row.get("stageGroupLabel"),
			"stage_group_order": row.get("stageGroupOrder"),
			"stage_subgroup_code": row.get("stageSubgroupCode"),
			"stage_subgroup_label": row.get("stageSubgroupLabel"),
			"stage_subgroup_order": row.get("stageSubgroupOrder"),
			"nazwaPodmiotu": row["nazwaPodmiotu"],
			"zakres_inspekcji": row.get("zakresInspekcji") or "-",
			"zakres_inspekcji_items": row.get("zakresInspekcjiItems") or [],
			"poczatekInspekcji": row.get("poczatekInspekcji") or "-",
			"koniecInspekcji": row.get("koniecInspekcji") or "-",
			"osobaKierujaca": row.get("osobaKierujaca", "-"),
			"isLeaderCurrentUser": bool(row.get("isLeaderCurrentUser")),
			"isMemberCurrentUser": bool(row.get("isMemberCurrentUser")),
			"zespol": row["zespol"],
			"zespolyInspekcji": row.get("zespolyInspekcji") or "-",
			"inspectionTeamCodes": row.get("inspectionTeamCodes") or [],
			"inspectionTeamIds": row.get("inspectionTeamIds") or [],
			"data": row.get("data") or "-",
			"czas": int(row["czas"]) if isinstance(row.get("czas"), (int, float)) else None,
		}
		for row in detail_source_rows
	]

	my_count_by_year_groups: dict[str, int] = defaultdict(int)
	for row in rows_after_year:
		if not (bool(row.get("isLeaderCurrentUser")) or bool(row.get("isMemberCurrentUser"))):
			continue
		year_key = str(row.get("rokPoczatku") or "").strip()
		if not year_key:
			continue
		my_count_by_year_groups[year_key] += 1
	my_count_by_year = {
		year: int(my_count_by_year_groups[year])
		for year in sorted(my_count_by_year_groups.keys())
	}

	my_count_by_year_breakdown_groups: dict[str, dict[str, int]] = defaultdict(
		lambda: {"leader": 0, "member": 0, "combined": 0}
	)
	for row in rows_after_year:
		year_key = str(row.get("rokPoczatku") or "").strip()
		if not year_key:
			continue
		is_leader = bool(row.get("isLeaderCurrentUser"))
		is_member = bool(row.get("isMemberCurrentUser"))
		if not (is_leader or is_member):
			continue
		if is_leader:
			my_count_by_year_breakdown_groups[year_key]["leader"] += 1
		if is_member:
			my_count_by_year_breakdown_groups[year_key]["member"] += 1
		my_count_by_year_breakdown_groups[year_key]["combined"] += 1

	my_count_by_year_breakdown = {
		year: {
			"leader": int(values["leader"]),
			"member": int(values["member"]),
			"combined": int(values["combined"]),
		}
		for year, values in sorted(my_count_by_year_breakdown_groups.items(), key=lambda item: item[0])
	}

	my_metric_by_year_leader_groups: dict[str, list[int]] = defaultdict(list)
	my_metric_by_year_member_groups: dict[str, list[int]] = defaultdict(list)
	my_metric_by_year_combined_groups: dict[str, list[int]] = defaultdict(list)
	for row in rows_after_year:
		if not _is_valid_for_aggregations(row):
			continue
		year_key = str(row.get("rokPoczatku") or "").strip()
		if not year_key:
			continue
		czas_value = int(row["czas"])
		is_leader = bool(row.get("isLeaderCurrentUser"))
		is_member = bool(row.get("isMemberCurrentUser"))
		if not (is_leader or is_member):
			continue
		if is_leader:
			my_metric_by_year_leader_groups[year_key].append(czas_value)
		if is_member:
			my_metric_by_year_member_groups[year_key].append(czas_value)
		my_metric_by_year_combined_groups[year_key].append(czas_value)

	all_metric_years = sorted(
		set(my_metric_by_year_leader_groups.keys())
		| set(my_metric_by_year_member_groups.keys())
		| set(my_metric_by_year_combined_groups.keys())
	)
	my_metric_by_year_breakdown: dict[str, dict[str, float]] = {}
	for year in all_metric_years:
		leader_metric = _metric_from_values(my_metric_by_year_leader_groups.get(year, []), trend_mode)
		member_metric = _metric_from_values(my_metric_by_year_member_groups.get(year, []), trend_mode)
		combined_metric = _metric_from_values(my_metric_by_year_combined_groups.get(year, []), trend_mode)
		my_metric_by_year_breakdown[year] = {
			"leader": float(leader_metric or 0),
			"member": float(member_metric or 0),
			"combined": float(combined_metric or 0),
		}

	my_count_all_years_breakdown = {
		"leader": int(sum(values["leader"] for values in my_count_by_year_breakdown.values())),
		"member": int(sum(values["member"] for values in my_count_by_year_breakdown.values())),
		"combined": int(sum(values["combined"] for values in my_count_by_year_breakdown.values())),
	}

	my_metric_all_years_breakdown = {
		"leader": float(
			_metric_from_values([v for values in my_metric_by_year_leader_groups.values() for v in values], trend_mode) or 0
		),
		"member": float(
			_metric_from_values([v for values in my_metric_by_year_member_groups.values() for v in values], trend_mode) or 0
		),
		"combined": float(
			_metric_from_values([v for values in my_metric_by_year_combined_groups.values() for v in values], trend_mode) or 0
		),
	}

	scatter_source_rows = list(agg_filtered_rows)
	if is_personal_scope_mode:
		scatter_source_rows = [
			row
			for row in scatter_source_rows
			if bool(row.get("isLeaderCurrentUser")) or bool(row.get("isMemberCurrentUser"))
		]

	scatter_rows = [
		{
			"inspectionId": row["inspectionId"],
			"year": int(row["rokPoczatku"]),
			"time": float(row["czas"]),
			"nazwaPodmiotu": row["nazwaPodmiotu"],
			"kontrola": row["kodInspekcji"],
			"osobaKierujaca": row.get("osobaKierujaca", "-"),
			"zespol": row["zespol"],
		}
		for row in scatter_source_rows
	]

	status_counter: dict[tuple[int | None, str], int] = defaultdict(int)
	piszemy_protokol_count = 0
	piszemy_key = "piszemy protokol"
	for row in all_type_base_rows:
		status_id = row.get("statusInspekcjiId")
		status_label_raw = str(row.get("statusInspekcji") or "-").strip()
		status_label = status_label_raw if status_label_raw else "-"
		status_counter[(status_id if isinstance(status_id, int) else None, status_label)] += 1
		if _normalize_text_key(status_label) == piszemy_key:
			piszemy_protokol_count += 1

	alert_status_counts = [
		{
			"statusInspekcjiId": status_id,
			"statusInspekcji": status_label,
			"count": count,
		}
		for (status_id, status_label), count in sorted(
			status_counter.items(),
			key=lambda item: (-item[1], str(item[0][1]).lower()),
		)
	]

	return {
		"inspectionType": inspection_type,
		"trendMode": trend_mode,
		"selectedMetric": trend_mode,
		"selectedMetricLabel": metric_label,
		"baseCount": len(base_rows),
		"filteredCount": len(filtered_rows),
		"departmentMinTime": department_min_time,
		"departmentMaxTime": department_max_time,
		"departmentMinTimeByYear": department_min_time_by_year,
		"departmentMaxTimeByYear": department_max_time_by_year,
		"myCountByYear": my_count_by_year,
		"myCountByYearBreakdown": my_count_by_year_breakdown,
		"myMetricByYearBreakdown": my_metric_by_year_breakdown,
		"myCountAllYearsBreakdown": my_count_all_years_breakdown,
		"myMetricAllYearsBreakdown": my_metric_all_years_breakdown,
		"teamOptions": team_options,
		"yearOptions": year_options,
		"detailRows": detail_rows,
		"summaryColumns": [
			{"key": "zespol", "label": "Zespol"},
			{"key": "rok", "label": "Rok"},
			{"key": "metric", "label": f"{metric_label} czasu"},
			{"key": "average", "label": "Srednia"},
			{"key": "median", "label": "Mediana"},
			{"key": "count", "label": "Liczba"},
		],
		"summaryRows": summary_rows,
		"summaryPivotYears": summary_pivot_years,
		"summaryPivotRows": summary_pivot_rows,
		"trendRows": trend_rows,
		"scatterRows": scatter_rows,
		"overallColumns": [
			{"key": "zespol", "label": "Zespol"},
			{"key": "metric", "label": f"{overall_metric_label}"},
			{"key": "count", "label": "Liczba"},
		],
		"overallRows": overall_rows,
		"yearCountColumns": year_count_columns,
		"yearCountRows": year_count_rows,
		"yearCountByTeamColumns": year_count_by_team_columns,
		"yearCountByTeamRows": year_count_by_team_rows,
		"alertStatusCounts": alert_status_counts,
		"alertPiszemyProtokolCount": piszemy_protokol_count,
	}


@router.get("/api/reports/inspections-matrix", response_model=InspectionsMatrixResponse)
def get_inspections_matrix(
	x_operator_login: str = Header(..., alias="X-Operator-Login"),
	rodzaj_podmiotu: str | list[str] | None = Query(default=None, alias="rodzaj_podmiotu"),
	rodzajPodmiotu: str | list[str] | None = Query(default=None),
) -> dict[str, Any]:
	raw_entity_type_filters = _parse_csv_values(rodzaj_podmiotu) + _parse_csv_values(rodzajPodmiotu)
	entity_type_filter_keys = {_normalize_text_key(item) for item in raw_entity_type_filters if _normalize_text_key(item)}

	with get_connection() as conn:
		operator = _resolve_operator(conn, x_operator_login)
		require_permission(conn, operator, PERMISSION_REPORTS_EXECUTED_INSPECTIONS_READ)

		rows = conn.execute(
			"""
			SELECT
				i.id,
				i.kod_inspekcji,
				i.created_by_user_id,
				COALESCE(ss.kod_pozycji, '') AS status_inspekcji_kod,
				COALESCE(ss.nazwa_pozycji, '-') AS status_inspekcji,
				COALESCE(NULLIF(trim(ss.skrot_pozycji), ''), ss.nazwa_pozycji, '-') AS status_inspekcji_skrot,
				COALESCE(NULLIF(trim(np.skrot_pozycji), ''), np.nazwa_pozycji, '-') AS nazwa_podmiotu,
				COALESCE(NULLIF(trim(rp.nazwa_pozycji), ''), '-') AS rodzaj_podmiotu,
				ti.nazwa_pozycji AS typ_inspekcji,
				(
					SELECT group_concat(x.scope_name, '; ')
					FROM (
						SELECT COALESCE(NULLIF(trim(sp.skrot_pozycji), ''), sp.nazwa_pozycji, '-') AS scope_name
						FROM inspection_scopes isc
						JOIN slownik_pozycje sp ON sp.id = isc.scope_id
						WHERE isc.inspection_id = i.id
						ORDER BY lower(COALESCE(NULLIF(trim(sp.skrot_pozycji), ''), sp.nazwa_pozycji, '-')), sp.id
					) x
				) AS zakres_inspekcji,
				i.poczatek_inspekcji AS poczatek_inspekcji,
				i.koniec_inspekcji AS koniec_inspekcji,
				u.zespol_id AS lead_team_id
				,
				(
					SELECT group_concat(x.team_code, ',')
					FROM (
						SELECT DISTINCT COALESCE(NULLIF(trim(tt.kod), ''), '-') AS team_code
						FROM inspection_teams it
						JOIN teams tt ON tt.id = it.team_id
						WHERE it.inspection_id = i.id
						ORDER BY lower(COALESCE(NULLIF(trim(tt.kod), ''), '-')), tt.id
					) x
				) AS inspection_team_codes_csv
				,
				(
					SELECT group_concat(x.team_id, ',')
					FROM (
						SELECT DISTINCT CAST(it.team_id AS TEXT) AS team_id
						FROM inspection_teams it
						WHERE it.inspection_id = i.id
						ORDER BY it.team_id ASC
					) x
				) AS inspection_team_ids_csv
			FROM inspections i
			LEFT JOIN slownik_pozycje np ON np.id = i.nazwa_podmiotu_id
			LEFT JOIN slownik_pozycje rp ON rp.id = i.rodzaj_podmiotu_id
			LEFT JOIN slownik_pozycje ti ON ti.id = i.typ_inspekcji_id
			LEFT JOIN slownik_pozycje ss ON ss.id = i.status_inspekcji_id
			LEFT JOIN users u ON u.id = i.osoba_kierujaca_user_id
			ORDER BY lower(np.nazwa_pozycji) ASC, i.poczatek_inspekcji ASC, i.id ASC
			"""
		).fetchall()

	values_map: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
	entries_map: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))
	entity_type_map: dict[str, list[str]] = defaultdict(list)
	years_set: set[str] = set()

	for row in rows:
		row_data = dict(row)
		if _is_reports_hidden_status_code(row_data.get("status_inspekcji_kod")):
			continue
		nazwa_podmiotu = str(row["nazwa_podmiotu"] or "-").strip() or "-"
		resolved_entity_type = str(row["rodzaj_podmiotu"] or "-").strip() or "-"
		if entity_type_filter_keys and _normalize_text_key(resolved_entity_type) not in entity_type_filter_keys:
			continue
		year = _year_from_date(row["poczatek_inspekcji"])
		if year is None:
			continue

		years_set.add(year)
		cell_value = _matrix_cell_value(row["typ_inspekcji"], row["zakres_inspekcji"])
		values_map[nazwa_podmiotu][year].append(cell_value)
		entries_map[nazwa_podmiotu][year].append(
			{
				"type": _matrix_type_code(row["typ_inspekcji"]),
				"scopes": _normalize_matrix_scopes(row["zakres_inspekcji"]),
				"inspectionId": int(row["id"]),
				"kodInspekcji": str(row_data.get("kod_inspekcji") or "-").strip() or "-",
				"date": str(row_data.get("poczatek_inspekcji") or "-").strip() or "-",
				"startDate": str(row_data.get("poczatek_inspekcji") or "-").strip() or "-",
				"endDate": str(row_data.get("koniec_inspekcji") or "-").strip() or "-",
				"status": _public_status_label(row_data.get("status_inspekcji")),
				"statusShort": str(row_data.get("status_inspekcji_skrot") or row_data.get("status_inspekcji") or "-").strip() or "-",
			}
		)
		entity_type_map[nazwa_podmiotu].append(resolved_entity_type)

	lata = sorted(years_set)
	result_rows: list[dict[str, Any]] = []

	for nazwa_podmiotu in sorted(values_map.keys(), key=lambda value: value.lower()):
		wartosci: dict[str, str] = {}
		cells: dict[str, list[dict[str, Any]]] = {}
		for year in lata:
			cell_values = values_map[nazwa_podmiotu].get(year, [])
			entries = entries_map[nazwa_podmiotu].get(year, [])
			cells[year] = sorted(
				entries,
				key=lambda item: (
					str(item.get("date") or "9999-99-99"),
					0 if str(item.get("type") or "") == "K" else 1,
					int(item.get("inspectionId") or 0),
				),
			)
			if not cell_values:
				wartosci[year] = "-"
				continue

			# Keep insertion order while removing duplicates.
			deduplicated = list(dict.fromkeys(cell_values))
			if len(deduplicated) > 1:
				deduplicated = [value for value in deduplicated if value != "-"]
			wartosci[year] = ", ".join(deduplicated)

		entity_types = list(dict.fromkeys(entity_type_map.get(nazwa_podmiotu, ["-"])))
		if len(entity_types) > 1:
			entity_types = [value for value in entity_types if value != "-"]
		resolved_entity_types = ", ".join(entity_types) if entity_types else "-"

		result_rows.append(
			{
				"nazwa_podmiotu": nazwa_podmiotu,
				"rodzaj_podmiotu": resolved_entity_types,
				"wartosci": wartosci,
				"cells": cells,
			}
		)

	return {
		"formatVersion": "2.0",
		"lata": lata,
		"rows": result_rows,
	}


@router.get("/api/reports/inspections-detailed", response_model=InspectionsDetailedResponse)
def get_inspections_detailed(
	manager_user_id: int | None = Query(default=None, alias="managerUserId"),
	x_operator_login: str = Header(..., alias="X-Operator-Login"),
) -> dict[str, Any]:
	with get_connection() as conn:
		operator = _resolve_operator(conn, x_operator_login)
		require_permission(conn, operator, PERMISSION_REPORTS_EXECUTED_INSPECTIONS_READ)
		if int(operator["rola_id"]) not in {1, 2, 3, 4}:
			raise HTTPException(status_code=403, detail="Brak uprawnien")

		manager_context: dict[str, Any] | None = None
		if int(operator["rola_id"]) == 2:
			manager_context = operator
		elif int(operator["rola_id"]) == 3 and manager_user_id is not None:
			manager_row = conn.execute(
				"""
				SELECT id, login, rola_id, zespol_id, aktywny
				FROM users
				WHERE id = ?
				LIMIT 1
				""",
				(int(manager_user_id),),
			).fetchone()
			if manager_row is None:
				raise HTTPException(status_code=404, detail="Kierownik nie istnieje")
			manager_data = dict(manager_row)
			if int(manager_data.get("aktywny") or 0) != 1:
				raise HTTPException(status_code=400, detail="Kierownik jest nieaktywny")
			if int(manager_data.get("rola_id") or 0) != 2:
				raise HTTPException(status_code=400, detail="managerUserId musi wskazywac kierownika")
			manager_context = {
				"id": int(manager_data["id"]),
				"login": manager_data["login"],
				"rola_id": int(manager_data["rola_id"]),
				"zespol_id": manager_data["zespol_id"],
			}
		elif manager_user_id is not None:
			raise HTTPException(status_code=400, detail="managerUserId jest dozwolone tylko dla dyrektora")

		rows = conn.execute(
			"""
			SELECT
				i.id AS id,
				i.created_by_user_id AS created_by_user_id,
				i.osoba_kierujaca_user_id AS osoba_kierujaca_user_id,
				i.kod_inspekcji AS kod_inspekcji,
				i.status_inspekcji_id AS status_inspekcji_id,
				COALESCE(si.kod_pozycji, '') AS status_inspekcji_kod,
				COALESCE(si.nazwa_pozycji, '-') AS status_inspekcji,
				COALESCE(NULLIF(trim(si.skrot_pozycji), ''), si.nazwa_pozycji, '-') AS status_inspekcji_skrot,
				COALESCE(NULLIF(trim(np.skrot_pozycji), ''), np.nazwa_pozycji, '-') AS nazwa_podmiotu,
				COALESCE(rp.nazwa_pozycji, '-') AS rodzaj_podmiotu,
				ti.nazwa_pozycji AS typ_inspekcji,
				(
					SELECT group_concat(x.scope_name, '; ')
					FROM (
						SELECT COALESCE(NULLIF(trim(sp.nazwa_pozycji), ''), '-') AS scope_name
						FROM inspection_scopes isc
						JOIN slownik_pozycje sp ON sp.id = isc.scope_id
						WHERE isc.inspection_id = i.id
						ORDER BY lower(COALESCE(NULLIF(trim(sp.nazwa_pozycji), ''), '-')), sp.id
					) x
				) AS zakres_inspekcji,
				(
					SELECT group_concat(x.scope_id, ';')
					FROM (
						SELECT CAST(isc.scope_id AS TEXT) AS scope_id
						FROM inspection_scopes isc
						JOIN slownik_pozycje sp ON sp.id = isc.scope_id
						WHERE isc.inspection_id = i.id
						ORDER BY lower(COALESCE(NULLIF(trim(sp.nazwa_pozycji), ''), '-')), sp.id
					) x
				) AS zakres_inspekcji_ids_csv,
				i.poczatek_inspekcji AS poczatek_inspekcji,
				i.koniec_inspekcji AS koniec_inspekcji,
				i.data_protokolu_sprawozdania AS data_protokolu_sprawozdania,
				COALESCE(
					nullif(trim(u.imie || ' ' || u.nazwisko), ''),
					'-'
				) AS osoba_kierujaca,
				COALESCE(NULLIF(trim(t.kod), ''), '') AS zespol_osoby_kierujacej_kod,
				u.zespol_id AS lead_team_id,
				(
					SELECT group_concat(x.team_code, ',')
					FROM (
						SELECT DISTINCT COALESCE(NULLIF(trim(tt.kod), ''), '') AS team_code
						FROM inspection_teams it
						JOIN teams tt ON tt.id = it.team_id
						WHERE it.inspection_id = i.id
						ORDER BY lower(COALESCE(NULLIF(trim(tt.kod), ''), '')), tt.id
					) x
				) AS inspection_team_codes_csv,
				(
					SELECT group_concat(x.team_id, ',')
					FROM (
						SELECT DISTINCT CAST(it.team_id AS TEXT) AS team_id
						FROM inspection_teams it
						WHERE it.inspection_id = i.id
						ORDER BY it.team_id ASC
					) x
				) AS inspection_team_ids_csv
			FROM inspections i
			LEFT JOIN slownik_pozycje np ON np.id = i.nazwa_podmiotu_id
			LEFT JOIN slownik_pozycje ti ON ti.id = i.typ_inspekcji_id
			LEFT JOIN slownik_pozycje rp ON rp.id = i.rodzaj_podmiotu_id
			LEFT JOIN slownik_pozycje si ON si.id = i.status_inspekcji_id
			LEFT JOIN users u ON u.id = i.osoba_kierujaca_user_id
			LEFT JOIN teams t ON t.id = u.zespol_id
			ORDER BY lower(np.nazwa_pozycji) ASC, i.poczatek_inspekcji ASC, i.id ASC
			"""
		).fetchall()

	result_rows: list[dict[str, Any]] = []
	scope_name_cache: dict[int, str] = {}
	for row in rows:
		if _is_dashboard_hidden_status_code(row["status_inspekcji_kod"]):
			continue
		if manager_context is not None:
			in_team_scope, in_added_scope = _manager_scope_flags_for_inspection(conn, int(row["id"]), manager_context)
			if not (in_team_scope or in_added_scope):
				continue
		else:
			if int(operator["rola_id"]) != 3 and not _can_access_inspection_for_reports(conn, dict(row), operator):
				continue
		poczatek_inspekcji = str(row["poczatek_inspekcji"] or "-")
		koniec_inspekcji = str(row["koniec_inspekcji"] or "-")
		data_protokolu = row["data_protokolu_sprawozdania"]
		end_to_today_days = _days_from_end_to_today(row["koniec_inspekcji"])
		status_label = _public_status_label(row["status_inspekcji"])
		bucket_value = _end_to_today_bucket(end_to_today_days) if _should_compute_bucket_code(row["status_inspekcji_kod"]) else None
		bucket_value_alt = _end_to_today_bucket_alt(end_to_today_days) if _should_compute_bucket_code(row["status_inspekcji_kod"]) else None
		inspection_id = int(row["id"])
		zakres_inspekcji_raw = str(row["zakres_inspekcji"] or "-").strip() or "-"
		zakres_inspekcji_items = _scope_items_from_ids_csv(conn, row["zakres_inspekcji_ids_csv"], scope_name_cache)
		leader_user_id = int(row["osoba_kierujaca_user_id"]) if row["osoba_kierujaca_user_id"] is not None else None
		is_leader_current_user = leader_user_id is not None and int(operator["id"]) == leader_user_id
		is_member_current_user = _is_member_current_user(conn, inspection_id, int(operator["id"]))
		inspection_team_codes = [
			value.strip()
			for value in str(row["inspection_team_codes_csv"] or "").split(",")
			if value.strip()
		]
		inspection_team_ids = _parse_int_csv_values(row["inspection_team_ids_csv"])
		leader_team_code = str(row["zespol_osoby_kierujacej_kod"] or "").strip()
		teams_display = "; ".join(inspection_team_codes) if inspection_team_codes else ""
		scope_operator = manager_context if manager_context is not None else operator
		is_leader_in_manager_team = _is_leader_in_manager_scope(conn, leader_user_id, scope_operator)
		is_member_in_manager_team = _is_member_in_manager_scope(conn, inspection_id, scope_operator)

		result_rows.append(
			{
				"kod_inspekcji": str(row["kod_inspekcji"] or "-").strip() or "-",
				"nazwa_podmiotu": str(row["nazwa_podmiotu"] or "-").strip() or "-",
				"nazwa_podmiotu_skrocona": str(row["nazwa_podmiotu"] or "-").strip() or "-",
				"nazwa_podmiotu_skrot": str(row["nazwa_podmiotu"] or "-").strip() or "-",
				"nazwaPodmiotuSkrocona": str(row["nazwa_podmiotu"] or "-").strip() or "-",
				"nazwaPodmiotuSkrot": str(row["nazwa_podmiotu"] or "-").strip() or "-",
				"rodzaj_podmiotu": str(row["rodzaj_podmiotu"] or "-").strip() or "-",
				"inspekcja": _inspekcja_code(row["typ_inspekcji"]),
				"typ_inspekcji": str(row["typ_inspekcji"] or "-").strip() or "-",
				"status": status_label,
				"status_inspekcji_skrot": str(row["status_inspekcji_skrot"] or status_label or "-").strip() or "-",
				"status_inspekcji_id": int(row["status_inspekcji_id"]) if row["status_inspekcji_id"] is not None else None,
				"status_inspekcji": status_label,
				"zakres_inspekcji": zakres_inspekcji_raw,
				"zakres_inspekcji_items": zakres_inspekcji_items,
				"typ_zakres_inspekcji": _matrix_cell_value(row["typ_inspekcji"], row["zakres_inspekcji"]),
				"rok_poczatku": _year_from_date(row["poczatek_inspekcji"]) or "-",
				"poczatek_inspekcji": poczatek_inspekcji,
				"koniec_inspekcji": koniec_inspekcji,
				"inspektor_kierujacy": str(row["osoba_kierujaca"] or "-").strip() or "-",
				"is_leader_current_user": bool(is_leader_current_user),
				"is_leader_in_manager_team": bool(is_leader_in_manager_team),
				"is_member_current_user": bool(is_member_current_user),
				"is_member_in_manager_team": bool(is_member_in_manager_team),
				"liczba_dni_od_konca_inspekcji_do_dzis": end_to_today_days,
				"wartosc_liczbowa_przedzialu": bucket_value,
				"wartosc_liczbowa_przedzialu_alt": bucket_value_alt,
				"osoba_kierujaca": str(row["osoba_kierujaca"] or "-").strip() or "-",
				"zespol_osoby_kierujacej_kod": leader_team_code,
				"zespol": leader_team_code,
				"zespolyInspekcji": teams_display,
				"zespoly": teams_display,
				"inspection_team_codes": inspection_team_codes,
				"inspectionTeamCodes": inspection_team_codes,
				"inspection_team_ids": inspection_team_ids,
				"inspectionTeamIds": inspection_team_ids,
				"data_protokolu_sprawozdania": data_protokolu,
				"roznica_dni_miedzy_data_protokolu_a_koncem": _days_difference(data_protokolu, row["koniec_inspekcji"]),
			}
		)

	return {
		"rows": result_rows,
	}


@router.get("/api/reports/inspections-stage-summary", response_model=InspectionsStageSummaryResponse)
def get_inspections_stage_summary(
	manager_user_id: int | None = Query(default=None, alias="managerUserId"),
	x_operator_login: str = Header(..., alias="X-Operator-Login"),
) -> dict[str, Any]:
	with get_connection() as conn:
		operator = _resolve_operator(conn, x_operator_login)
		require_permission(conn, operator, PERMISSION_REPORTS_EXECUTED_INSPECTIONS_READ)
		if int(operator["rola_id"]) not in {1, 2, 3, 4}:
			raise HTTPException(status_code=403, detail="Brak uprawnien")

		manager_context: dict[str, Any] | None = None
		if int(operator["rola_id"]) == 2:
			manager_context = operator
		elif int(operator["rola_id"]) == 3 and manager_user_id is not None:
			manager_row = conn.execute(
				"""
				SELECT id, login, rola_id, zespol_id, aktywny
				FROM users
				WHERE id = ?
				LIMIT 1
				""",
				(int(manager_user_id),),
			).fetchone()
			if manager_row is None:
				raise HTTPException(status_code=404, detail="Kierownik nie istnieje")
			manager_data = dict(manager_row)
			if int(manager_data.get("aktywny") or 0) != 1:
				raise HTTPException(status_code=400, detail="Kierownik jest nieaktywny")
			if int(manager_data.get("rola_id") or 0) != 2:
				raise HTTPException(status_code=400, detail="managerUserId musi wskazywac kierownika")
			manager_context = {
				"id": int(manager_data["id"]),
				"login": manager_data["login"],
				"rola_id": int(manager_data["rola_id"]),
				"zespol_id": manager_data["zespol_id"],
			}
		elif manager_user_id is not None:
			raise HTTPException(status_code=400, detail="managerUserId jest dozwolone tylko dla dyrektora")

		status_rows = conn.execute(
			"""
			SELECT
				id,
				COALESCE(NULLIF(trim(kod_pozycji), ''), '') AS kod_pozycji,
				COALESCE(nazwa_pozycji, 'brak') AS nazwa_pozycji,
				COALESCE(kolejnosc, 999999) AS kolejnosc
			FROM slownik_pozycje
			WHERE lower(kod_typu) = 'statusy_inspekcji'
			ORDER BY COALESCE(kolejnosc, 999999) ASC, id ASC
			"""
		).fetchall()

		status_stats: dict[str, dict[str, Any]] = {}
		status_id_index: dict[int, str] = {}
		for status_row in status_rows:
			if _is_dashboard_hidden_status_code(status_row["kod_pozycji"]):
				continue
			status_id = int(status_row["id"])
			status_name = str(status_row["nazwa_pozycji"] or "").strip() or f"status_{status_id}"
			status_code = _normalize_code_key(status_name) or f"status_{status_id}"
			stage_group_order = _dashboard_status_display_order(
				status_row["kod_pozycji"],
				int(status_row["kolejnosc"]),
			)
			status_stats[status_code] = {
				"statusId": status_id,
				"stageGroupCode": status_code,
				"stageGroupLabel": status_name,
				"stageGroupShortLabel": status_name,
				"stageGroupOrder": int(stage_group_order),
				"count": 0,
				"countTeam": 0,
				"countManagerAdded": 0,
				"countTeamAndManagerAdded": 0,
			}
			status_id_index[status_id] = status_code

		unknown_code = "unknown_unmapped"
		if unknown_code not in status_stats:
			status_stats[unknown_code] = {
				"statusId": None,
				"stageGroupCode": unknown_code,
				"stageGroupLabel": "Nieprzypisany status",
				"stageGroupShortLabel": "Nieprzypisany status",
				"stageGroupOrder": 999999,
				"count": 0,
				"countTeam": 0,
				"countManagerAdded": 0,
				"countTeamAndManagerAdded": 0,
			}

		rows = conn.execute(
			"""
			SELECT
				i.id,
				i.created_by_user_id,
				i.status_inspekcji_id,
				COALESCE(si.kod_pozycji, '') AS status_inspekcji_kod
			FROM inspections i
			LEFT JOIN slownik_pozycje si ON si.id = i.status_inspekcji_id
			ORDER BY i.id ASC
			"""
		).fetchall()

		total_inspections = 0
		quality_error_count = 0

		for row in rows:
			row_dict = dict(row)
			inspection_id = int(row_dict["id"])
			in_team_scope = False
			in_added_scope = False

			if _is_dashboard_hidden_status_code(row_dict.get("status_inspekcji_kod")):
				continue

			if manager_context is not None:
				in_team_scope, in_added_scope = _manager_scope_flags_for_inspection(conn, inspection_id, manager_context)
				if not (in_team_scope or in_added_scope):
					continue
			else:
				if int(operator["rola_id"]) != 3 and not _can_access_inspection_for_reports(conn, row_dict, operator):
					continue

			status_id = row_dict.get("status_inspekcji_id")
			group_code = unknown_code
			if status_id is not None:
				group_code = status_id_index.get(int(status_id), unknown_code)

			if group_code == unknown_code:
				quality_error_count += 1

			total_inspections += 1
			group_item = status_stats[group_code]

			group_item["count"] += 1

			if manager_context is not None:
				if in_team_scope:
					group_item["countTeam"] += 1
				if in_added_scope:
					group_item["countManagerAdded"] += 1
				if in_team_scope and in_added_scope:
					group_item["countTeamAndManagerAdded"] += 1

		statuses_payload = [
			{
				"stageGroupCode": item["stageGroupCode"],
				"stageGroupLabel": item["stageGroupLabel"],
				"stageGroupShortLabel": item.get("stageGroupShortLabel"),
				"stageGroupOrder": item["stageGroupOrder"],
				"count": item["count"],
				"countTeam": item["countTeam"],
				"countManagerAdded": item["countManagerAdded"],
				"countTeamAndManagerAdded": item["countTeamAndManagerAdded"],
			}
			for item in sorted(status_stats.values(), key=lambda x: (int(x["stageGroupOrder"]), str(x["stageGroupLabel"]).lower()))
		]

	return {
		"generatedAt": datetime.now().isoformat(timespec="seconds"),
		"stageDictionaryVersion": "2.0.0",
		"totalInspections": int(total_inspections),
		"qualityErrorCount": int(quality_error_count),
		"statuses": statuses_payload,
	}


@router.get("/api/reports/recommendations-stage-summary", response_model=RecommendationsStageSummaryResponse)
def get_recommendations_stage_summary(
	manager_user_id: int | None = Query(default=None, alias="managerUserId"),
	x_operator_login: str = Header(..., alias="X-Operator-Login"),
) -> dict[str, Any]:
	with get_connection() as conn:
		operator = _resolve_operator(conn, x_operator_login)
		require_permission(conn, operator, PERMISSION_RECOMMENDATIONS_READ)
		if int(operator["rola_id"]) not in {1, 2, 3, 4}:
			raise HTTPException(status_code=403, detail="Brak uprawnien")

		manager_context: dict[str, Any] | None = None
		if int(operator["rola_id"]) == 2:
			manager_context = operator
		elif int(operator["rola_id"]) == 3 and manager_user_id is not None:
			manager_row = conn.execute(
				"""
				SELECT id, login, rola_id, zespol_id, aktywny
				FROM users
				WHERE id = ?
				LIMIT 1
				""",
				(int(manager_user_id),),
			).fetchone()
			if manager_row is None:
				raise HTTPException(status_code=404, detail="Kierownik nie istnieje")
			manager_data = dict(manager_row)
			if int(manager_data.get("aktywny") or 0) != 1:
				raise HTTPException(status_code=400, detail="Kierownik jest nieaktywny")
			if int(manager_data.get("rola_id") or 0) != 2:
				raise HTTPException(status_code=400, detail="managerUserId musi wskazywac kierownika")
			manager_context = {
				"id": int(manager_data["id"]),
				"login": manager_data["login"],
				"rola_id": int(manager_data["rola_id"]),
				"zespol_id": manager_data["zespol_id"],
			}
		elif manager_user_id is not None:
			raise HTTPException(status_code=400, detail="managerUserId jest dozwolone tylko dla dyrektora")

		manager_team_recommendation_ids: set[int] = set()
		if manager_context is not None:
			manager_team_recommendation_ids = _recommendation_ids_for_manager_team(conn, manager_context)

		status_rows = conn.execute(
			"""
			SELECT
				id,
				COALESCE(kod_pozycji, '') AS kod_pozycji,
				COALESCE(nazwa_pozycji, 'brak') AS nazwa_pozycji,
				COALESCE(kolejnosc, 999999) AS kolejnosc
			FROM slownik_pozycje
			WHERE lower(kod_typu) = 'statusy_zalecen'
			ORDER BY COALESCE(kolejnosc, 999999) ASC, id ASC
			"""
		).fetchall()

		group_stats: dict[str, dict[str, Any]] = {}
		status_id_to_code: dict[int, str] = {}
		for status_row in status_rows:
			status_id = int(status_row["id"])
			status_code = str(status_row["kod_pozycji"] or "").strip() or f"status_{status_id}"
			group_stats[status_code] = {
				"statusId": status_id,
				"stageGroupCode": status_code,
				"stageGroupLabel": str(status_row["nazwa_pozycji"]),
				"stageGroupShortLabel": status_row["nazwa_pozycji"],
				"stageGroupOrder": int(status_row["kolejnosc"]),
				"count": 0,
				"countTeam": 0,
				"countManagerAdded": 0,
				"countTeamAndManagerAdded": 0,
			}
			status_id_to_code[status_id] = status_code

		unknown_code = "unknown_unmapped"
		if unknown_code not in group_stats:
			group_stats[unknown_code] = {
				"statusId": None,
				"stageGroupCode": unknown_code,
				"stageGroupLabel": "Nieprzypisany status",
				"stageGroupShortLabel": "Nieprzypisany status",
				"stageGroupOrder": 999999,
				"count": 0,
				"countTeam": 0,
				"countManagerAdded": 0,
				"countTeamAndManagerAdded": 0,
			}

		recommendation_rows = conn.execute(
			"""
			SELECT
				r.id,
				r.inspection_id,
				r.created_by_user_id AS recommendation_created_by_user_id,
				r.status_zalecenia_id,
				i.created_by_user_id AS inspection_created_by_user_id,
				ru.zespol_id AS recommendation_author_team_id,
				ru.created_by_user_id AS recommendation_author_created_by_user_id
			FROM recommendations r
			LEFT JOIN inspections i ON i.id = r.inspection_id
			LEFT JOIN users ru ON ru.id = r.created_by_user_id
			ORDER BY r.id ASC
			"""
		).fetchall()

		total_recommendations = 0
		quality_error_count = 0

		for row in recommendation_rows:
			row_dict = dict(row)

			status_id = row_dict.get("status_zalecenia_id")
			if status_id is not None:
				status_code = status_id_to_code.get(int(status_id))
				if _is_dashboard_hidden_recommendation_status_code(status_code):
					continue

			in_team_scope = False
			in_added_scope = False

			if manager_context is not None:
				recommendation_id_raw = row_dict.get("id")
				if recommendation_id_raw is None:
					continue
				in_team_scope = int(recommendation_id_raw) in manager_team_recommendation_ids
				if not in_team_scope:
					continue
			else:
				if not _can_access_recommendation_for_reports(conn, row_dict, operator):
					continue

			group_code = unknown_code
			if status_id is not None:
				for code, payload in group_stats.items():
					if payload.get("statusId") is not None and int(payload["statusId"]) == int(status_id):
						group_code = code
						break

			if group_code == unknown_code:
				quality_error_count += 1

			total_recommendations += 1
			group_item = group_stats[group_code]
			group_item["count"] += 1

			if manager_context is not None:
				if in_team_scope:
					group_item["countTeam"] += 1
				if in_added_scope:
					group_item["countManagerAdded"] += 1
				if in_team_scope and in_added_scope:
					group_item["countTeamAndManagerAdded"] += 1

		groups_payload = [
			{
				"stageGroupCode": item["stageGroupCode"],
				"stageGroupLabel": item["stageGroupLabel"],
				"stageGroupShortLabel": item.get("stageGroupShortLabel"),
				"stageGroupOrder": item["stageGroupOrder"],
				"count": item["count"],
				"countTeam": item["countTeam"],
				"countManagerAdded": item["countManagerAdded"],
				"countTeamAndManagerAdded": item["countTeamAndManagerAdded"],
			}
			for item in sorted(group_stats.values(), key=lambda x: (int(x["stageGroupOrder"]), str(x["stageGroupCode"])))
		]

	return {
		"generatedAt": datetime.now().isoformat(timespec="seconds"),
		"stageDictionaryVersion": RECOMMENDATIONS_STAGE_DICTIONARY_VERSION,
		"totalRecommendations": int(total_recommendations),
		"qualityErrorCount": int(quality_error_count),
		"groups": groups_payload,
	}


@router.get("/api/reports/recommendations-detailed", response_model=RecommendationsDetailedResponse)
def get_recommendations_detailed(
	manager_user_id: int | None = Query(default=None, alias="managerUserId"),
	x_operator_login: str = Header(..., alias="X-Operator-Login"),
) -> dict[str, Any]:
	with get_connection() as conn:
		operator = _resolve_operator(conn, x_operator_login)
		require_permission(conn, operator, PERMISSION_RECOMMENDATIONS_READ)
		if int(operator["rola_id"]) not in {1, 2, 3, 4}:
			raise HTTPException(status_code=403, detail="Brak uprawnien")

		manager_context: dict[str, Any] | None = None
		if int(operator["rola_id"]) == 2:
			manager_context = operator
		elif int(operator["rola_id"]) == 3 and manager_user_id is not None:
			manager_row = conn.execute(
				"""
				SELECT id, login, rola_id, zespol_id, aktywny
				FROM users
				WHERE id = ?
				LIMIT 1
				""",
				(int(manager_user_id),),
			).fetchone()
			if manager_row is None:
				raise HTTPException(status_code=404, detail="Kierownik nie istnieje")
			manager_data = dict(manager_row)
			if int(manager_data.get("aktywny") or 0) != 1:
				raise HTTPException(status_code=400, detail="Kierownik jest nieaktywny")
			if int(manager_data.get("rola_id") or 0) != 2:
				raise HTTPException(status_code=400, detail="managerUserId musi wskazywac kierownika")
			manager_context = {
				"id": int(manager_data["id"]),
				"login": manager_data["login"],
				"rola_id": int(manager_data["rola_id"]),
				"zespol_id": manager_data["zespol_id"],
			}
		elif manager_user_id is not None:
			raise HTTPException(status_code=400, detail="managerUserId jest dozwolone tylko dla dyrektora")

		manager_team_recommendation_ids: set[int] = set()
		if manager_context is not None:
			manager_team_recommendation_ids = _recommendation_ids_for_manager_team(conn, manager_context)

		rows = conn.execute(
			"""
			SELECT
				r.id,
				r.kod_zalecenia,
				r.inspection_id,
				i.kod_inspekcji,
				r.created_by_user_id AS recommendation_created_by_user_id,
				r.status_zalecenia_id,
				COALESCE(st.kod_pozycji, '') AS status_kod,
				r.data_zalecen,
				COALESCE(st.nazwa_pozycji, 'brak') AS status_nazwa,
				COALESCE(NULLIF(trim(st.skrot_pozycji), ''), st.nazwa_pozycji, 'brak') AS status_skrot,
				COALESCE(
					NULLIF(trim(np_rec.skrot_pozycji), ''),
					np_rec.nazwa_pozycji,
					NULLIF(trim(np_ins.skrot_pozycji), ''),
					np_ins.nazwa_pozycji,
					'brak'
				) AS nazwa_podmiotu,
				i.created_by_user_id AS inspection_created_by_user_id,
				ru.zespol_id AS recommendation_author_team_id,
				ru.created_by_user_id AS recommendation_author_created_by_user_id,
				COALESCE(NULLIF(trim(tlead.kod), ''), '') AS inspection_leader_team_code,
				(
					SELECT group_concat(x.dv, ',')
					FROM (
						SELECT rmd.date_value AS dv
						FROM recommendation_multi_dates rmd
						WHERE rmd.recommendation_id = r.id
							AND rmd.date_type = 'TERMIN_WYKONANIA_ZALECEN'
						ORDER BY rmd.date_value ASC
					) x
				) AS terminy_wykonania_csv,
				(
					SELECT group_concat(x.team_code, ',')
					FROM (
						SELECT DISTINCT COALESCE(NULLIF(trim(tt.kod), ''), '') AS team_code
						FROM recommendation_teams rt
						JOIN teams tt ON tt.id = rt.team_id
						WHERE rt.recommendation_id = r.id
						ORDER BY lower(COALESCE(NULLIF(trim(tt.kod), ''), '')), tt.id
					) x
				) AS inspection_team_codes_csv,
				(
					SELECT group_concat(x.team_id, ',')
					FROM (
						SELECT DISTINCT CAST(rt.team_id AS TEXT) AS team_id
						FROM recommendation_teams rt
						WHERE rt.recommendation_id = r.id
						ORDER BY rt.team_id ASC
					) x
				) AS inspection_team_ids_csv,
				COALESCE(r.pozycja, 0) AS liczba_zalecen
			FROM recommendations r
			LEFT JOIN inspections i ON i.id = r.inspection_id
			LEFT JOIN users ru ON ru.id = r.created_by_user_id
			LEFT JOIN users ulead ON ulead.id = i.osoba_kierujaca_user_id
			LEFT JOIN teams tlead ON tlead.id = ulead.zespol_id
			LEFT JOIN slownik_pozycje st ON st.id = r.status_zalecenia_id
			LEFT JOIN slownik_pozycje np_rec ON np_rec.id = r.nazwa_podmiotu_id
			LEFT JOIN slownik_pozycje np_ins ON np_ins.id = i.nazwa_podmiotu_id
			ORDER BY r.id DESC
			"""
		).fetchall()

		def _first_deadline(csv_value: str | None) -> str | None:
			if csv_value is None:
				return None
			parts = [p.strip() for p in str(csv_value).split(",") if p.strip()]
			if not parts:
				return None
			return parts[0]

		payload_rows: list[dict[str, Any]] = []
		for row in rows:
			row_dict = dict(row)
			if _is_dashboard_hidden_recommendation_status_code(row_dict.get("status_kod")):
				continue

			in_team_scope = False
			in_added_scope = False

			if manager_context is not None:
				recommendation_id_raw = row_dict.get("id")
				if recommendation_id_raw is None:
					continue
				in_team_scope = int(recommendation_id_raw) in manager_team_recommendation_ids
				if not in_team_scope:
					continue
			else:
				if not _can_access_recommendation_for_reports(conn, row_dict, operator):
					continue

			terminy_csv = row_dict.get("terminy_wykonania_csv")
			inspection_team_codes = [
				value.strip()
				for value in str(row_dict.get("inspection_team_codes_csv") or "").split(",")
				if value.strip()
			]
			inspection_team_ids = _parse_int_csv_values(row_dict.get("inspection_team_ids_csv"))
			leader_team_code = str(row_dict.get("inspection_leader_team_code") or "").strip()
			teams_display = "; ".join(inspection_team_codes) if inspection_team_codes else ""
			payload_rows.append(
				{
					"status": str(row_dict.get("status_nazwa") or "brak"),
					"status_skrot": str(row_dict.get("status_skrot") or row_dict.get("status_nazwa") or "brak"),
					"statusSkrot": str(row_dict.get("status_skrot") or row_dict.get("status_nazwa") or "brak"),
					"kod_zalecenia": row_dict.get("kod_zalecenia"),
					"kod_inspekcji": row_dict.get("kod_inspekcji"),
					"kodZalecenia": row_dict.get("kod_zalecenia"),
					"kodInspekcji": row_dict.get("kod_inspekcji"),
					"nazwa_podmiotu": str(row_dict.get("nazwa_podmiotu") or "brak"),
					"nazwa_podmiotu_skrocona": str(row_dict.get("nazwa_podmiotu") or "brak"),
					"nazwa_podmiotu_skrot": str(row_dict.get("nazwa_podmiotu") or "brak"),
					"nazwaPodmiotuSkrocona": str(row_dict.get("nazwa_podmiotu") or "brak"),
					"nazwaPodmiotuSkrot": str(row_dict.get("nazwa_podmiotu") or "brak"),
					"data_zalecen": row_dict.get("data_zalecen"),
					"termin_zalecen": _first_deadline(terminy_csv),
					"termin_wykonania_zalecen": terminy_csv,
					"zespol": leader_team_code,
					"zespolyInspekcji": teams_display,
					"zespoly": teams_display,
					"inspection_team_codes": inspection_team_codes,
					"inspectionTeamCodes": inspection_team_codes,
					"inspection_team_ids": inspection_team_ids,
					"inspectionTeamIds": inspection_team_ids,
					"liczba_zalecen": int(row_dict.get("liczba_zalecen") or 0),
				}
			)

	return {"rows": payload_rows}


@router.get("/api/reports/export")
def download_report_export(
	reportType: ReportExportType = Query(...),
	manager_user_id: int | None = Query(default=None, alias="managerUserId"),
	x_operator_login: str = Header(..., alias="X-Operator-Login"),
) -> StreamingResponse:
	filename, content = _report_export_payload(
		reportType,
		x_operator_login=x_operator_login,
		manager_user_id=manager_user_id,
	)
	headers = {
		"Content-Disposition": f'attachment; filename="{filename}"',
	}
	return StreamingResponse(io.BytesIO(content), media_type="text/csv; charset=utf-8", headers=headers)


@router.post("/api/reports/send-email", response_model=ReportExportEmailResponse)
def send_report_export_email(
	payload: ReportExportEmailRequest,
	x_operator_login: str = Header(..., alias="X-Operator-Login"),
) -> dict[str, Any]:
	if not payload.toEmails:
		raise HTTPException(status_code=422, detail="toEmails jest wymagane")

	recipients = _normalize_emails(payload.toEmails)
	if not recipients:
		raise HTTPException(status_code=422, detail="Brak poprawnych adresow email")

	report_types = list(dict.fromkeys(payload.reportTypes or []))
	if not report_types:
		raise HTTPException(status_code=422, detail="reportTypes jest wymagane")

	attachments: list[tuple[str, bytes]] = []
	for report_type in report_types:
		filename, content = _report_export_payload(
			report_type,
			x_operator_login=x_operator_login,
			manager_user_id=payload.managerUserId,
		)
		attachments.append((filename, content))

	subject = (payload.subject or "Raport - Inspekcje/Zalecenia").strip() or "Raport - Inspekcje/Zalecenia"
	body = (
		(payload.body or "W zalaczeniu raport CSV wygenerowany z systemu.").strip()
		or "W zalaczeniu raport CSV wygenerowany z systemu."
	)

	for email in recipients:
		_send_email_with_attachments(
			to_email=email,
			subject=subject,
			body=body,
			attachments=attachments,
		)

	return {
		"sentCount": len(recipients),
		"attachmentNames": [name for name, _ in attachments],
	}


@router.post("/api/reports/send-html", response_model=DashboardSendHtmlResponse)
def send_dashboard_html_email(
	payload: DashboardSendHtmlRequest,
	x_operator_login: str = Header(..., alias="X-Operator-Login"),
) -> dict[str, Any]:
	requested_format = _resolve_dashboard_file_format(payload)
	if requested_format != "pdf":
		raise HTTPException(
			status_code=422,
			detail={
				"code": "REPORTS_SEND_PDF_ONLY",
				"message": "Endpoint /api/reports/send-html przyjmuje teraz tylko PDF",
			},
		)
	file_name = _sanitize_dashboard_filename(payload.fileName, "pdf")
	pdf_bytes = _decode_pdf_base64(payload.pdfBase64 or "")

	with get_connection() as conn:
		operator = _resolve_operator(conn, x_operator_login)
		recipient_email, _recipient_name = _resolve_dashboard_recipient(conn, int(operator["id"]))

	date_text = _dashboard_subject_date(payload.meta.generatedAt if payload.meta else None)
	subject = f"Przesłanie dashboardu ({date_text})"
	body = "W załączeniu przesyłamy zrzut dashboardu dotyczącego inspekcji oraz zaleceń, w formacie PDF."
	attachment = (file_name, pdf_bytes, "application/pdf")

	_send_email_with_typed_attachments(
		to_email=recipient_email,
		subject=subject,
		body=body,
		attachments=[attachment],
	)

	return {
		"message": "Wyslano PDF na email zalogowanego uzytkownika",
		"recipientEmail": recipient_email,
		"fileName": file_name,
		"fileFormat": "pdf",
	}
