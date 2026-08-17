from __future__ import annotations

from datetime import datetime, timezone
from email.message import EmailMessage
import json
import logging
import os
from pathlib import Path
import re
import smtplib
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.db import get_connection


logger = logging.getLogger(__name__)

def _resolve_schedule_timezone() -> ZoneInfo | timezone:
    try:
        return ZoneInfo("Europe/Warsaw")
    except ZoneInfoNotFoundError:
        print("[SCHEDULE-WORKER] Missing tzdata for Europe/Warsaw. Falling back to UTC.")
        return timezone.utc


WARSAW_TZ = _resolve_schedule_timezone()

MODULE_INSPECTIONS = "inspections"
MODULE_RECOMMENDATIONS = "recommendations"
MODULE_RISK_EXPOSURE = "risk_exposure"

RECIPIENT_STRATEGY_INSPECTION_CONTEXT = "inspection_context"
RECIPIENT_STRATEGY_AUTHOR_ONLY = "author_only"

CONTROL_TYPE_EMPTY_FIELD = "empty_field"
CONTROL_TYPE_STATUS_EQUALS = "status_equals"

DAYS_COMPARISON_EQ = 0
DAYS_COMPARISON_GT = 1
DAYS_COMPARISON_GTE = 2

_TEMPLATE_TOKEN_PATTERN = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}")

TARGET_INSPECTION_LEADER = "inspection_leader"
TARGET_INSPECTION_TEAM = "inspection_team"

FALLBACK_AUTHOR = "author"

DATE_FIELDS: dict[str, tuple[str, str]] = {
    "inspection.poczatek_inspekcji": (MODULE_INSPECTIONS, "poczatek_inspekcji"),
    "inspection.koniec_inspekcji": (MODULE_INSPECTIONS, "koniec_inspekcji"),
    "inspection.data_protokolu_sprawozdania": (MODULE_INSPECTIONS, "data_protokolu_sprawozdania"),
    "inspection.data_doreczenia_protokolu": (MODULE_INSPECTIONS, "data_doreczenia_protokolu"),
    "inspection.data_akceptacji_sprawozdania": (MODULE_INSPECTIONS, "data_akceptacji_sprawozdania"),
    "inspection.data_doreczenia_pisma": (MODULE_INSPECTIONS, "data_doreczenia_pisma"),
    "inspection.data_pisma_zastrzezenia": (MODULE_INSPECTIONS, "data_pisma_zastrzezenia"),
    "inspection.data_wplywu_pisma": (MODULE_INSPECTIONS, "data_wplywu_pisma"),
    "inspection.data_pisma_z_odpowiedzia": (MODULE_INSPECTIONS, "data_pisma_z_odpowiedzia"),
    "inspection.data_akceptacji_noty": (MODULE_INSPECTIONS, "data_akceptacji_noty"),
    "inspection.data_zalecen": (MODULE_INSPECTIONS, "data_zalecen"),
    "recommendation.data_zalecen": (MODULE_RECOMMENDATIONS, "data_zalecen"),
    "recommendation.termin_wykonania_zalecen": (MODULE_RECOMMENDATIONS, "termin_wykonania_zalecen"),
    "risk_exposure.data_wniosku": (MODULE_RISK_EXPOSURE, "data_wniosku"),
}

STATUS_FIELDS: dict[str, tuple[str, str, str]] = {
    "inspection.status_inspekcji": (MODULE_INSPECTIONS, "inspection_status_code", "statusy_inspekcji"),
    "recommendation.status_zalecenia": (MODULE_RECOMMENDATIONS, "recommendation_status_code", "statusy_zalecen"),
}

DATE_FIELD_LABELS: dict[str, str] = {
    "inspection.poczatek_inspekcji": "I - Poczatek inspekcji",
    "inspection.koniec_inspekcji": "I - Koniec inspekcji",
    "inspection.data_protokolu_sprawozdania": "I - Data protokolu/sprawozdania",
    "inspection.data_doreczenia_protokolu": "I - Data doreczenia protokolu",
    "inspection.data_akceptacji_sprawozdania": "I - Data akceptacji sprawozdania",
    "inspection.data_doreczenia_pisma": "I - Data doreczenia pisma",
    "inspection.data_pisma_zastrzezenia": "I - Data pisma zastrzezenia",
    "inspection.data_wplywu_pisma": "I - Data wplywu pisma",
    "inspection.data_pisma_z_odpowiedzia": "I - Data pisma z odpowiedzia",
    "inspection.data_akceptacji_noty": "I - Data akceptacji noty",
    "inspection.data_zalecen": "I - Data zalecen",
    "recommendation.data_zalecen": "Z - Data zalecen",
    "recommendation.termin_wykonania_zalecen": "Z - Termin wykonania zalecen",
    "risk_exposure.data_wniosku": "WN - Data wniosku sankcyjnego",
}

STATUS_FIELD_LABELS: dict[str, str] = {
    "inspection.status_inspekcji": "I - Status inspekcji",
    "recommendation.status_zalecenia": "Z - Status zalecenia",
}


def list_schedule_status_fields() -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    for code, (module_type, _column, dictionary_type) in STATUS_FIELDS.items():
        result.append(
            {
                "code": code,
                "label": STATUS_FIELD_LABELS.get(code, code),
                "moduleType": module_type,
                "dictionaryType": dictionary_type,
            }
        )
    return result


def _resolve_module_type_by_sources(src_a: str, src_b: str) -> str:
    if src_a == src_b:
        return src_a

    if MODULE_RECOMMENDATIONS in {src_a, src_b} and MODULE_RISK_EXPOSURE in {src_a, src_b}:
        raise ValueError("Nie mozna laczyc pol recommendation i risk_exposure w jednym harmonogramie")

    if MODULE_RECOMMENDATIONS in {src_a, src_b}:
        return MODULE_RECOMMENDATIONS
    if MODULE_RISK_EXPOSURE in {src_a, src_b}:
        return MODULE_RISK_EXPOSURE
    return MODULE_INSPECTIONS


def resolve_module_type(date_field_a: str, date_field_b: str) -> str:
    if date_field_a not in DATE_FIELDS:
        raise ValueError(f"Nieznane pole daty A: {date_field_a}")
    if date_field_b not in DATE_FIELDS:
        raise ValueError(f"Nieznane pole daty B: {date_field_b}")

    src_a = DATE_FIELDS[date_field_a][0]
    src_b = DATE_FIELDS[date_field_b][0]
    return _resolve_module_type_by_sources(src_a, src_b)


def resolve_module_type_with_status(date_field_a: str, status_field_code: str) -> str:
    if date_field_a not in DATE_FIELDS:
        raise ValueError(f"Nieznane pole daty A: {date_field_a}")
    if status_field_code not in STATUS_FIELDS:
        raise ValueError(f"Nieznane pole statusu: {status_field_code}")

    src_a = DATE_FIELDS[date_field_a][0]
    src_b = STATUS_FIELDS[status_field_code][0]
    return _resolve_module_type_by_sources(src_a, src_b)


def list_schedule_date_fields() -> list[dict[str, str]]:
    return [{"code": code, "label": DATE_FIELD_LABELS[code]} for code in DATE_FIELD_LABELS.keys()]


def resolve_recipient_strategy(date_field_a: str, date_field_b: str) -> str:
    if date_field_a not in DATE_FIELDS:
        raise ValueError(f"Nieznane pole daty A: {date_field_a}")
    if date_field_b not in DATE_FIELDS:
        raise ValueError(f"Nieznane pole daty B: {date_field_b}")

    src_a = DATE_FIELDS[date_field_a][0]
    src_b = DATE_FIELDS[date_field_b][0]

    if src_a == MODULE_RECOMMENDATIONS and src_b == MODULE_RECOMMENDATIONS:
        return RECIPIENT_STRATEGY_AUTHOR_ONLY
    if src_a == MODULE_RISK_EXPOSURE and src_b == MODULE_RISK_EXPOSURE:
        return RECIPIENT_STRATEGY_AUTHOR_ONLY

    return RECIPIENT_STRATEGY_INSPECTION_CONTEXT


def resolve_recipient_strategy_with_status(date_field_a: str, status_field_code: str) -> str:
    if date_field_a not in DATE_FIELDS:
        raise ValueError(f"Nieznane pole daty A: {date_field_a}")
    if status_field_code not in STATUS_FIELDS:
        raise ValueError(f"Nieznane pole statusu: {status_field_code}")

    src_a = DATE_FIELDS[date_field_a][0]
    src_b = STATUS_FIELDS[status_field_code][0]

    if src_a == MODULE_RECOMMENDATIONS and src_b == MODULE_RECOMMENDATIONS:
        return RECIPIENT_STRATEGY_AUTHOR_ONLY
    if src_a == MODULE_RISK_EXPOSURE and src_b == MODULE_RISK_EXPOSURE:
        return RECIPIENT_STRATEGY_AUTHOR_ONLY

    return RECIPIENT_STRATEGY_INSPECTION_CONTEXT


def _resolve_template_context(date_field_a: str, date_field_b: str) -> tuple[str, str]:
    if date_field_a not in DATE_FIELDS:
        raise ValueError(f"Nieznane pole daty A: {date_field_a}")
    if date_field_b not in DATE_FIELDS:
        raise ValueError(f"Nieznane pole daty B: {date_field_b}")

    src_a = DATE_FIELDS[date_field_a][0]
    src_b = DATE_FIELDS[date_field_b][0]
    return src_a, src_b


def _template_token_labels(date_field_a: str, date_field_b: str) -> dict[str, str]:
    src_a, src_b = _resolve_template_context(date_field_a, date_field_b)
    tokens: dict[str, str] = {
        "scheduleName": "Nazwa harmonogramu",
        "moduleType": "Typ modulu",
        "daysDifference": "Roznica dni: dzis - Data A",
        "dateA": "Data A (YYYY-MM-DD)",
        "dateB": "Wartosc pola kontrolnego (legacy)",
        "checkFieldCode": "Kod sprawdzanego pola",
        "checkFieldLabel": "Etykieta sprawdzanego pola",
        "checkFieldStatus": "Status sprawdzanego warunku",
        "recordId": "ID rekordu harmonogramu",
        "recipientFirstName": "Imie odbiorcy",
        "recipientLastName": "Nazwisko odbiorcy",
    }

    if src_a == MODULE_INSPECTIONS or src_b == MODULE_INSPECTIONS:
           tokens["inspectionId"] = "Kod inspekcji"
    if src_a == MODULE_RECOMMENDATIONS or src_b == MODULE_RECOMMENDATIONS:
           tokens["recommendationId"] = "Kod zalecenia"
    if src_a == MODULE_RISK_EXPOSURE or src_b == MODULE_RISK_EXPOSURE:
           tokens["sanctionRequestId"] = "Kod wniosku sankcyjnego"

    tokens["entityName"] = "Nazwa podmiotu"
    return tokens


def list_template_variables(date_field_a: str, date_field_b: str) -> list[dict[str, str]]:
    labels = _template_token_labels(date_field_a, date_field_b)
    return [{"token": token, "label": labels[token]} for token in labels.keys()]


def extract_template_tokens(template: str) -> set[str]:
    return {match.group(1) for match in _TEMPLATE_TOKEN_PATTERN.finditer(template or "")}


def validate_template_text(template: str, date_field_a: str, date_field_b: str) -> set[str]:
    allowed = set(_template_token_labels(date_field_a, date_field_b).keys())
    used = extract_template_tokens(template)
    return {token for token in used if token not in allowed}


def _render_template_text(template: str, values: dict[str, Any]) -> str:
    text = template or ""

    def _replace(match: re.Match[str]) -> str:
        token = match.group(1)
        if token not in values:
            raise ValueError(f"Brak danych dla tokenu: {token}")
        value = values[token]
        if value is None:
            raise ValueError(f"Brak danych dla tokenu: {token}")
        rendered = str(value)
        if rendered.strip() == "":
            raise ValueError(f"Brak danych dla tokenu: {token}")
        return rendered

    return _TEMPLATE_TOKEN_PATTERN.sub(_replace, text)


def _parse_iso_date(raw: str | None) -> datetime | None:
    if not raw:
        return None
    text = str(raw).strip()
    if len(text) < 10:
        return None
    try:
        return datetime.fromisoformat(text[:10])
    except ValueError:
        return None


def _load_smtp_password() -> str:
    direct = os.getenv("SMTP_PASS") or ""
    if direct:
        return direct
    secret_file = (os.getenv("SMTP_PASS_FILE") or "").strip()
    if not secret_file:
        return ""
    return Path(secret_file).read_text(encoding="utf-8").strip()


def _send_mail(to_email: str, subject: str, body: str) -> None:
    mode = (
        os.getenv("SCHEDULE_EMAIL_MODE")
        or os.getenv("EMAIL_SEND_MODE")
        or os.getenv("INVITE_EMAIL_MODE")
        or "log"
    ).strip().lower()
    if mode not in {"log", "smtp"}:
        mode = "log"

    if mode == "log":
        print("[SCHEDULE-EMAIL]", f"to={to_email}", f"subject={subject}", f"body={body}")
        return

    smtp_host = (os.getenv("SMTP_HOST") or "").strip()
    smtp_port_raw = (os.getenv("SMTP_PORT") or "465").strip()
    smtp_login = (os.getenv("SMTP_LOGIN") or "").strip()
    smtp_pass = _load_smtp_password()
    smtp_login_mail = (os.getenv("SMTP_LOGIN_MAIL") or "").strip()
    from_email = (os.getenv("FROM_EMAIL") or smtp_login_mail or "").strip()
    smtp_security = (os.getenv("SMTP_SECURITY") or "starttls").strip().lower()

    if not smtp_host or not smtp_login or not smtp_pass or not from_email:
        raise RuntimeError("Missing SMTP configuration")
    smtp_port = int(smtp_port_raw)

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_email
    msg["To"] = to_email
    msg.set_content(body)

    if smtp_security == "ssl":
        with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=30) as server:
            server.login(smtp_login, smtp_pass)
            server.send_message(msg)
    else:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=30) as server:
            server.ehlo()
            if smtp_security == "starttls":
                server.starttls()
                server.ehlo()
            server.login(smtp_login, smtp_pass)
            server.send_message(msg)


def _merge_recipient(
    recipients: dict[str, dict[str, Any]],
    email: str,
    first_name: str,
    last_name: str,
    source_role: str,
) -> None:
    key = (email or "").strip().lower()
    if not key or "@" not in key:
        return
    existing = recipients.get(key)
    if existing is None:
        recipients[key] = {
            "email": key,
            "firstName": (first_name or "").strip(),
            "lastName": (last_name or "").strip(),
            "roles": {source_role},
        }
        return
    roles = existing.get("roles")
    if not isinstance(roles, set):
        roles = set()
        existing["roles"] = roles
    roles.add(source_role)
    if not existing.get("firstName") and (first_name or "").strip():
        existing["firstName"] = (first_name or "").strip()
    if not existing.get("lastName") and (last_name or "").strip():
        existing["lastName"] = (last_name or "").strip()


def _collect_inspection_recipients(conn: Any, inspection_id: int, targets: set[str]) -> dict[str, dict[str, str]]:
    recipients: dict[str, dict[str, Any]] = {}
    if TARGET_INSPECTION_LEADER in targets:
        row = conn.execute(
            """
            SELECT u.email, u.imie, u.nazwisko
            FROM inspections i
            JOIN users u ON u.id = i.osoba_kierujaca_user_id
            WHERE i.id = ?
            LIMIT 1
            """,
            (inspection_id,),
        ).fetchone()
        if row is not None:
            _merge_recipient(
                recipients,
                str(row["email"] or ""),
                str(row["imie"] or ""),
                str(row["nazwisko"] or ""),
                TARGET_INSPECTION_LEADER,
            )

    if TARGET_INSPECTION_TEAM in targets:
        rows = conn.execute(
            """
            SELECT u.email, u.imie, u.nazwisko
            FROM inspection_members im
            JOIN users u ON u.id = im.user_id
            WHERE im.inspection_id = ?
            """,
            (inspection_id,),
        ).fetchall()
        for row in rows:
            _merge_recipient(
                recipients,
                str(row["email"] or ""),
                str(row["imie"] or ""),
                str(row["nazwisko"] or ""),
                TARGET_INSPECTION_TEAM,
            )

    return recipients


def _collect_author_recipient(conn: Any, user_id: int | None) -> dict[str, dict[str, str]]:
    if user_id is None:
        return {}
    row = conn.execute("SELECT email, imie, nazwisko FROM users WHERE id = ? LIMIT 1", (int(user_id),)).fetchone()
    if row is None:
        return {}
    recipients: dict[str, dict[str, Any]] = {}
    _merge_recipient(
        recipients,
        str(row["email"] or ""),
        str(row["imie"] or ""),
        str(row["nazwisko"] or ""),
        FALLBACK_AUTHOR,
    )
    return recipients


def _resolve_recipient_type(recipient: dict[str, Any]) -> str:
    roles_raw = recipient.get("roles")
    roles = roles_raw if isinstance(roles_raw, set) else set()
    if FALLBACK_AUTHOR in roles:
        return FALLBACK_AUTHOR
    if TARGET_INSPECTION_LEADER in roles and TARGET_INSPECTION_TEAM in roles:
        return "inspection_leader_team"
    if TARGET_INSPECTION_LEADER in roles:
        return TARGET_INSPECTION_LEADER
    if TARGET_INSPECTION_TEAM in roles:
        return TARGET_INSPECTION_TEAM
    return "unknown"


def _fetch_records(conn: Any, module_type: str) -> list[dict[str, Any]]:
    if module_type == MODULE_INSPECTIONS:
        rows = conn.execute(
            """
            SELECT
                i.id AS record_id,
                i.id AS inspection_id,
                i.kod_inspekcji AS inspection_code,
                isp.kod_pozycji AS inspection_status_code,
                i.poczatek_inspekcji,
                i.koniec_inspekcji,
                i.data_protokolu_sprawozdania,
                i.data_doreczenia_protokolu,
                i.data_akceptacji_sprawozdania,
                i.data_doreczenia_pisma,
                i.data_pisma_zastrzezenia,
                i.data_wplywu_pisma,
                i.data_pisma_z_odpowiedzia,
                i.data_akceptacji_noty,
                i.data_zalecen,
                np.nazwa_pozycji AS entity_name,
                i.created_by_user_id AS author_user_id
            FROM inspections i
            LEFT JOIN slownik_pozycje np ON np.id = i.nazwa_podmiotu_id
            LEFT JOIN slownik_pozycje isp ON isp.id = i.status_inspekcji_id
            """
        ).fetchall()
        return [dict(row) for row in rows]

    if module_type == MODULE_RECOMMENDATIONS:
        rows = conn.execute(
            """
            SELECT
                r.id AS record_id,
                r.data_zalecen,
                (
                    SELECT MIN(rmd.date_value)
                    FROM recommendation_multi_dates rmd
                    WHERE rmd.recommendation_id = r.id
                      AND rmd.date_type = 'TERMIN_WYKONANIA_ZALECEN'
                ) AS termin_wykonania_zalecen,
                r.id AS recommendation_id,
                r.inspection_id,
                i.kod_inspekcji AS inspection_code,
                r.kod_zalecenia AS recommendation_code,
                rsp.kod_pozycji AS recommendation_status_code,
                isp.kod_pozycji AS inspection_status_code,
                r.created_by_user_id AS author_user_id,
                COALESCE(rp.nazwa_pozycji, ip.nazwa_pozycji) AS entity_name,
                i.poczatek_inspekcji,
                i.koniec_inspekcji,
                i.data_protokolu_sprawozdania,
                i.data_doreczenia_protokolu,
                i.data_akceptacji_sprawozdania,
                i.data_doreczenia_pisma,
                i.data_pisma_zastrzezenia,
                i.data_wplywu_pisma,
                i.data_pisma_z_odpowiedzia,
                i.data_akceptacji_noty,
                i.data_zalecen
            FROM recommendations r
            LEFT JOIN inspections i ON i.id = r.inspection_id
            LEFT JOIN slownik_pozycje rp ON rp.id = r.nazwa_podmiotu_id
            LEFT JOIN slownik_pozycje ip ON ip.id = i.nazwa_podmiotu_id
            LEFT JOIN slownik_pozycje rsp ON rsp.id = r.status_zalecenia_id
            LEFT JOIN slownik_pozycje isp ON isp.id = i.status_inspekcji_id
            """
        ).fetchall()
        return [dict(row) for row in rows]

    if module_type == MODULE_RISK_EXPOSURE:
        rows = conn.execute(
            """
            SELECT
                r.id AS record_id,
                r.data_wniosku,
                r.id AS sanction_request_id,
                r.inspection_id,
                i.kod_inspekcji AS inspection_code,
                r.kod_sankcji AS sanction_request_code,
                isp.kod_pozycji AS inspection_status_code,
                r.utworzono_przez_user_id AS author_user_id,
                COALESCE(rp.nazwa_pozycji, ip.nazwa_pozycji) AS entity_name,
                i.poczatek_inspekcji,
                i.koniec_inspekcji,
                i.data_protokolu_sprawozdania,
                i.data_doreczenia_protokolu,
                i.data_akceptacji_sprawozdania,
                i.data_doreczenia_pisma,
                i.data_pisma_zastrzezenia,
                i.data_wplywu_pisma,
                i.data_pisma_z_odpowiedzia,
                i.data_akceptacji_noty,
                i.data_zalecen
            FROM risk_exposure_requests r
            LEFT JOIN inspections i ON i.id = r.inspection_id
            LEFT JOIN slownik_pozycje rp ON rp.id = r.nazwa_podmiotu_objetego_inspekcja_id
            LEFT JOIN slownik_pozycje ip ON ip.id = i.nazwa_podmiotu_id
            LEFT JOIN slownik_pozycje isp ON isp.id = i.status_inspekcji_id
            """
        ).fetchall()
        return [dict(row) for row in rows]

    return []


def _select_date_value(record: dict[str, Any], field_code: str) -> datetime | None:
    mapping = DATE_FIELDS.get(field_code)
    if mapping is None:
        return None
    _module, column = mapping
    return _parse_iso_date(record.get(column))


def _get_field_raw_value(record: dict[str, Any], field_code: str) -> Any:
    mapping = DATE_FIELDS.get(field_code)
    if mapping is None:
        return None
    _module, column = mapping
    return record.get(column)


def _is_empty_field_value(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ""
    return False


def _normalize_status_code(value: Any) -> str:
    return str(value or "").strip().upper()


def _is_status_field_match(record: dict[str, Any], status_field_code: str, expected_status_code: str) -> bool:
    mapping = STATUS_FIELDS.get(status_field_code)
    if mapping is None:
        return False
    _module, column, _dictionary_type = mapping
    actual_code = _normalize_status_code(record.get(column))
    expected_code = _normalize_status_code(expected_status_code)
    if not expected_code:
        return False
    return actual_code == expected_code


def _parse_expected_status_codes(raw_codes: Any, raw_code: Any) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()

    if isinstance(raw_codes, str) and raw_codes.strip():
        text = raw_codes.strip()
        parsed_values: list[Any] | None = None
        if text.startswith("["):
            try:
                loaded = json.loads(text)
                if isinstance(loaded, list):
                    parsed_values = loaded
            except Exception:  # noqa: BLE001
                parsed_values = None
        if parsed_values is None:
            parsed_values = [part.strip() for part in text.replace(";", ",").split(",")]

        for item in parsed_values:
            code = _normalize_status_code(item)
            if code and code not in seen:
                normalized.append(code)
                seen.add(code)

    legacy_code = _normalize_status_code(raw_code)
    if legacy_code and legacy_code not in seen:
        normalized.append(legacy_code)

    return normalized


def _is_status_field_match_any(record: dict[str, Any], status_field_code: str, expected_status_codes: list[str]) -> bool:
    if not expected_status_codes:
        return False
    return any(_is_status_field_match(record, status_field_code, code) for code in expected_status_codes)


def _status_labels_for_codes(conn: Any, status_field_code: str, expected_status_codes: list[str]) -> list[str]:
    mapping = STATUS_FIELDS.get(status_field_code)
    if mapping is None:
        return expected_status_codes
    _module, _column, dictionary_type = mapping
    cleaned_codes = [_normalize_status_code(code) for code in expected_status_codes if _normalize_status_code(code)]
    if not cleaned_codes:
        return []

    placeholders = ", ".join(["?"] * len(cleaned_codes))
    rows = conn.execute(
        f"""
        SELECT kod_pozycji, nazwa_pozycji
        FROM slownik_pozycje
        WHERE lower(kod_typu) = lower(?)
          AND upper(kod_pozycji) IN ({placeholders})
        """,
        (dictionary_type, *cleaned_codes),
    ).fetchall()
    by_code = {str(row["kod_pozycji"]).strip().upper(): str(row["nazwa_pozycji"] or "").strip() for row in rows}

    labels: list[str] = []
    for code in cleaned_codes:
        label = by_code.get(code) or code
        labels.append(label)
    return labels


def _format_expected_status_labels_multiline(expected_status_labels: list[str]) -> str:
    cleaned = [label for label in expected_status_labels if str(label or "").strip()]
    if not cleaned:
        return ""
    return "\n".join(f"{index}. {label}" for index, label in enumerate(cleaned, start=1))


def _normalize_days_comparison_mode(value: Any) -> int:
    try:
        mode = int(value)
    except (TypeError, ValueError):
        return DAYS_COMPARISON_EQ
    if mode not in {DAYS_COMPARISON_EQ, DAYS_COMPARISON_GT, DAYS_COMPARISON_GTE}:
        return DAYS_COMPARISON_EQ
    return mode


def _days_difference_matches(diff_days: int, threshold_days: int, mode: int) -> bool:
    if mode == DAYS_COMPARISON_GT:
        return diff_days > threshold_days
    if mode == DAYS_COMPARISON_GTE:
        return diff_days >= threshold_days
    return diff_days == threshold_days


def _db_insert_logs_enabled() -> bool:
    value = (os.getenv("SCHEDULE_DB_LOG_INSERTS") or "1").strip().lower()
    return value in {"1", "true", "yes", "on"}


def run_due_schedules_once(trigger_type: str = "auto") -> dict[str, int]:
    now = datetime.now(WARSAW_TZ)
    today = now.date().isoformat()
    sent = 0
    matched = 0

    with get_connection() as conn:
        schedules = conn.execute(
            """
             SELECT id, name, module_type, date_field_a, date_field_b,
                                 control_type, status_field_code, expected_status_code, expected_status_codes,
                                 days_comparison_mode,
                 days_difference, subject_template, body_template, send_hour, send_minute,
                   target_inspection_leader, target_inspection_team,
                   fallback_recipient, enabled, last_run_date
            FROM notification_schedules
            WHERE enabled = 1
            ORDER BY id ASC
            """
        ).fetchall()

        for schedule_row in schedules:
            schedule = dict(schedule_row)
            raw_send_hour = schedule.get("send_hour")
            send_hour = 7 if raw_send_hour is None else int(raw_send_hour)
            raw_send_minute = schedule.get("send_minute")
            send_minute = 0 if raw_send_minute is None else int(raw_send_minute)
            last_run_date = str(schedule.get("last_run_date") or "")
            current_minutes = now.hour * 60 + now.minute
            scheduled_minutes = send_hour * 60 + send_minute
            # Run once per day at configured time or later to survive short downtimes/restarts.
            if current_minutes < scheduled_minutes:
                continue
            if last_run_date == today:
                continue

            schedule_id = int(schedule["id"])
            run_cursor = conn.execute(
                """
                INSERT INTO notification_schedule_runs (schedule_id, trigger_type, status)
                VALUES (?, ?, 'ok')
                """,
                (schedule_id, "manual" if trigger_type == "manual" else "auto"),
            )
            run_id = int(run_cursor.lastrowid)
            if _db_insert_logs_enabled():
                logger.info(
                    "[SCHEDULE-DB-INSERT] table=notification_schedule_runs run_id=%s schedule_id=%s trigger_type=%s status=%s",
                    run_id,
                    schedule_id,
                    "manual" if trigger_type == "manual" else "auto",
                    "ok",
                )
            run_matched = 0
            run_sent = 0
            run_failed = 0
            control_type = str(schedule.get("control_type") or CONTROL_TYPE_EMPTY_FIELD).strip().lower()
            if control_type not in {CONTROL_TYPE_EMPTY_FIELD, CONTROL_TYPE_STATUS_EQUALS}:
                control_type = CONTROL_TYPE_EMPTY_FIELD

            if control_type == CONTROL_TYPE_STATUS_EQUALS:
                recipient_strategy = resolve_recipient_strategy_with_status(
                    str(schedule["date_field_a"]),
                    str(schedule.get("status_field_code") or ""),
                )
            else:
                recipient_strategy = resolve_recipient_strategy(
                    str(schedule["date_field_a"]),
                    str(schedule["date_field_b"]),
                )
            rule_row = conn.execute(
                "SELECT id FROM notification_schedule_rules WHERE schedule_id = ? ORDER BY id ASC LIMIT 1",
                (schedule_id,),
            ).fetchone()
            if rule_row is None:
                cursor = conn.execute(
                    """
                    INSERT INTO notification_schedule_rules (
                        schedule_id, days_difference, subject_template, body_template, enabled
                    ) VALUES (?, ?, ?, ?, 1)
                    """,
                    (
                        schedule_id,
                        int(schedule.get("days_difference") or 0),
                        str(schedule.get("subject_template") or ""),
                        str(schedule.get("body_template") or ""),
                    ),
                )
                rule_id = int(cursor.lastrowid)
            else:
                rule_id = int(rule_row["id"])
            schedule_days_difference = int(schedule.get("days_difference") or 0)
            schedule_days_comparison_mode = _normalize_days_comparison_mode(schedule.get("days_comparison_mode"))
            schedule_subject_template = str(schedule.get("subject_template") or "Powiadomienie")
            schedule_body_template = str(schedule.get("body_template") or "")

            module_type = str(schedule["module_type"])
            records = _fetch_records(conn, module_type)
            targets: set[str] = set()
            if recipient_strategy == RECIPIENT_STRATEGY_INSPECTION_CONTEXT:
                if int(schedule.get("target_inspection_leader") or 0) == 1:
                    targets.add(TARGET_INSPECTION_LEADER)
                if int(schedule.get("target_inspection_team") or 0) == 1:
                    targets.add(TARGET_INSPECTION_TEAM)

            for record in records:
                date_a = _select_date_value(record, str(schedule["date_field_a"]))
                if date_a is None:
                    continue
                diff_days = (now.date() - date_a.date()).days

                check_field_code = str(schedule["date_field_b"])
                check_field_status = "puste"
                check_field_value_for_template = "PUSTE"
                if control_type == CONTROL_TYPE_STATUS_EQUALS:
                    check_field_code = str(schedule.get("status_field_code") or "")
                    expected_status_codes = _parse_expected_status_codes(
                        schedule.get("expected_status_codes"),
                        schedule.get("expected_status_code"),
                    )
                    if not _is_status_field_match_any(record, check_field_code, expected_status_codes):
                        continue
                    expected_status_labels = _status_labels_for_codes(conn, check_field_code, expected_status_codes)
                    check_field_status = _format_expected_status_labels_multiline(expected_status_labels)
                    check_field_value_for_template = ", ".join(expected_status_labels)
                else:
                    check_field_value = _get_field_raw_value(record, check_field_code)
                    if not _is_empty_field_value(check_field_value):
                        continue

                recipients: dict[str, dict[str, str]] = {}
                if recipient_strategy == RECIPIENT_STRATEGY_AUTHOR_ONLY:
                    recipients.update(_collect_author_recipient(conn, record.get("author_user_id")))
                else:
                    inspection_id = record.get("inspection_id")
                    if inspection_id is not None:
                        recipients.update(_collect_inspection_recipients(conn, int(inspection_id), targets))
                if not recipients:
                    continue

                if not _days_difference_matches(diff_days, schedule_days_difference, schedule_days_comparison_mode):
                    continue

                matched += 1
                run_matched += 1
                for recipient in recipients.values():
                    render_error = None
                    rendered_subject = schedule_subject_template
                    rendered_body = schedule_body_template
                    try:
                        template_values: dict[str, Any] = {
                            "scheduleName": str(schedule.get("name") or ""),
                            "moduleType": module_type,
                            "daysDifference": diff_days,
                            "dateA": date_a.date().isoformat(),
                            # Keep legacy token non-empty for backward-compatible templates.
                            "dateB": check_field_value_for_template,
                            "checkFieldCode": check_field_code,
                            "checkFieldLabel": DATE_FIELD_LABELS.get(
                                check_field_code,
                                STATUS_FIELD_LABELS.get(check_field_code, check_field_code),
                            ),
                            "checkFieldStatus": check_field_status,
                            "recordId": int(record["record_id"]),
                            "inspectionId": record.get("inspection_code") or record.get("inspection_id"),
                            "recommendationId": record.get("recommendation_code") or record.get("recommendation_id"),
                            "sanctionRequestId": record.get("sanction_request_code") or record.get("sanction_request_id"),
                            "entityName": record.get("entity_name"),
                            "recipientFirstName": recipient.get("firstName"),
                            "recipientLastName": recipient.get("lastName"),
                        }
                        rendered_subject = _render_template_text(rendered_subject, template_values)
                        rendered_body = _render_template_text(rendered_body, template_values)
                    except Exception as exc:  # noqa: BLE001
                        render_error = str(exc)

                    recipient_email = str(recipient.get("email") or "")
                    recipient_type = _resolve_recipient_type(recipient)
                    status = "sent"
                    error_message = None
                    if render_error is not None:
                        status = "failed"
                        error_message = render_error
                        run_failed += 1
                    else:
                        try:
                            _send_mail(recipient_email, rendered_subject, rendered_body)
                            sent += 1
                            run_sent += 1
                        except Exception as exc:  # noqa: BLE001
                            status = "failed"
                            error_message = str(exc)
                            run_failed += 1

                    conn.execute(
                        """
                        INSERT INTO notification_schedule_dispatches (
                            run_id, schedule_id, rule_id, module_type, record_id, recipient_email, recipient_type,
                            status, error_message, rendered_subject, rendered_body
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            run_id,
                            schedule_id,
                            rule_id,
                            module_type,
                            int(record["record_id"]),
                            recipient_email,
                            recipient_type,
                            status,
                            error_message,
                            rendered_subject,
                            rendered_body,
                        ),
                    )
                    if _db_insert_logs_enabled():
                        logger.info(
                            "[SCHEDULE-DB-INSERT] table=notification_schedule_dispatches run_id=%s schedule_id=%s rule_id=%s module_type=%s record_id=%s recipient_email=%s recipient_type=%s status=%s error=%s",
                            run_id,
                            schedule_id,
                            rule_id,
                            module_type,
                            int(record["record_id"]),
                            recipient_email,
                            recipient_type,
                            status,
                            error_message,
                        )

            run_status = "ok"
            if run_sent > 0 and run_failed > 0:
                run_status = "partial"
            elif run_sent == 0 and run_failed > 0:
                run_status = "failed"
            conn.execute(
                """
                UPDATE notification_schedule_runs
                SET matched_count = ?,
                    sent_count = ?,
                    failed_count = ?,
                    status = ?,
                    finished_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (run_matched, run_sent, run_failed, run_status, run_id),
            )

            conn.execute(
                "UPDATE notification_schedules SET last_run_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (today, schedule_id),
            )

        conn.commit()

    return {"matched": matched, "sent": sent}


SCHEDULE_EMAIL_MODE=smtp

