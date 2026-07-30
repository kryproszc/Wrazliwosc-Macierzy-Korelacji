from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Header, HTTPException, Query

from app.database import get_connection

router = APIRouter()

_VALID_REJESTRY = {"inspekcje", "zalecenia", "decyzje", "wnioski_sankcyjne"}
_VALID_AKCJE = {"CREATE", "UPDATE", "DELETE"}
_VALID_POLE_MODES = {"contains", "exact"}


@router.get("/api/audit-log")
def get_audit_log(
    x_operator_login: str | None = Header(default=None, alias="X-Operator-Login"),
    rejestr: str | None = Query(default=None),
    uzytkownik: str | None = Query(default=None),
    akcja: str | None = Query(default=None),
    pole: str | None = Query(default=None),
    pole_mode: str = Query(default="contains", description="Tryb filtrowania pola: contains albo exact"),
    id_rejestru: str | None = Query(default=None, description="Fragment kodu rekordu (LIKE)"),
    data_od: str | None = Query(default=None, description="ISO 8601 data od"),
    data_do: str | None = Query(default=None, description="ISO 8601 data do (włącznie z końcem dnia)"),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    with get_connection() as conn:
        operator = _resolve_operator(conn, x_operator_login)
        if int(operator.get("rola_id", 0)) == 4:
            raise HTTPException(status_code=403, detail="Brak uprawnien")

        where, params = _build_audit_filters(
            rejestr=rejestr,
            uzytkownik=uzytkownik,
            akcja=akcja,
            pole=pole,
            pole_mode=pole_mode,
            id_rejestru=id_rejestru,
            data_od=data_od,
            data_do=data_do,
        )

        where_sql = _build_where_sql(where)

        total_row = conn.execute(
            f"SELECT COUNT(*) as cnt FROM audit_log {where_sql}", params
        ).fetchone()
        total = int(total_row["cnt"])

        rows = conn.execute(
            f"""
            SELECT session_id, id, uzytkownik, akcja, data_godz, rejestr, rekord_kod, pole, przed, po
            FROM audit_log
            {where_sql}
            ORDER BY data_godz DESC, id DESC
            LIMIT ? OFFSET ?
            """,
            params + [limit, offset],
        ).fetchall()

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [dict(r) for r in rows],
    }


@router.get("/api/audit-log/filter-options")
def get_audit_log_filter_options(
    x_operator_login: str | None = Header(default=None, alias="X-Operator-Login"),
    rejestr: str | None = Query(default=None),
    uzytkownik: str | None = Query(default=None),
    akcja: str | None = Query(default=None),
    pole: str | None = Query(default=None),
    pole_mode: str = Query(default="contains", description="Tryb filtrowania pola: contains albo exact"),
    id_rejestru: str | None = Query(default=None),
    data_od: str | None = Query(default=None),
    data_do: str | None = Query(default=None),
    fraza: str | None = Query(default=None, description="Fraza wyszukiwania opcji (case-insensitive contains)"),
    limit: int | None = Query(default=None, ge=1, le=5000, description="Ignorowane przez filter-options; endpoint zawsze zwraca pelne listy"),
    offset: int = Query(default=0, ge=0, description="Ignorowane przez filter-options; endpoint zawsze zwraca pelne listy"),
) -> dict[str, Any]:
    with get_connection() as conn:
        operator = _resolve_operator(conn, x_operator_login)
        if int(operator.get("rola_id", 0)) == 4:
            raise HTTPException(status_code=403, detail="Brak uprawnien")

        where, params = _build_audit_filters(
            rejestr=rejestr,
            uzytkownik=uzytkownik,
            akcja=akcja,
            pole=pole,
            pole_mode=pole_mode,
            id_rejestru=id_rejestru,
            data_od=data_od,
            data_do=data_do,
        )

        normalized_phrase = _normalize_filter_text(fraza)
        _ = limit
        _ = offset
        effective_limit: int | None = None
        effective_offset = 0

        option_fields = {
            "uzytkownik": "uzytkownik",
            "akcja": "akcja",
            "pole": "pole",
            "rejestr": "rejestr",
            "id_rejestru": "rekord_kod",
        }

        options: dict[str, list[str]] = {}
        options_meta: dict[str, dict[str, Any]] = {}
        for response_key, column_name in option_fields.items():
            page = _fetch_distinct_values_page(
                conn=conn,
                column_name=column_name,
                where=where,
                params=params,
                phrase=normalized_phrase,
                limit=effective_limit,
                offset=effective_offset,
            )
            options[response_key] = page["values"]
            options_meta[response_key] = {
                "total": page["total"],
                "has_more": page["has_more"],
                "next_offset": page["next_offset"],
                "returned": len(page["values"]),
                "offset": effective_offset,
                "limit": effective_limit,
            }

        return {
            "limit": effective_limit,
            "offset": effective_offset,
            "fraza": normalized_phrase,
            "options": options,
            "options_meta": options_meta,
        }


def _build_audit_filters(
    *,
    rejestr: str | None,
    uzytkownik: str | None,
    akcja: str | None,
    pole: str | None,
    pole_mode: str,
    id_rejestru: str | None,
    data_od: str | None,
    data_do: str | None,
) -> tuple[list[str], list[Any]]:
    where: list[str] = []
    params: list[Any] = []

    normalized_rejestr = _normalize_filter_text(rejestr)
    if normalized_rejestr is not None:
        lowered_rejestr = normalized_rejestr.lower()
        if lowered_rejestr not in _VALID_REJESTRY:
            raise HTTPException(status_code=400, detail=f"Nieprawidłowy rejestr: {normalized_rejestr}")
        where.append("lower(rejestr) = ?")
        params.append(lowered_rejestr)

    normalized_akcja = _normalize_filter_text(akcja)
    if normalized_akcja is not None:
        upper_akcja = normalized_akcja.upper()
        if upper_akcja not in _VALID_AKCJE:
            raise HTTPException(status_code=400, detail=f"Nieprawidłowa akcja: {normalized_akcja}")
        where.append("upper(akcja) = ?")
        params.append(upper_akcja)

    normalized_user = _normalize_filter_text(uzytkownik)
    if normalized_user is not None:
        where.append("lower(uzytkownik) LIKE ?")
        params.append(f"%{normalized_user.lower()}%")

    normalized_pole = _normalize_filter_text(pole)
    normalized_pole_mode = (pole_mode or "contains").strip().lower()
    if normalized_pole_mode not in _VALID_POLE_MODES:
        raise HTTPException(status_code=400, detail=f"Nieprawidłowy pole_mode: {pole_mode}")
    if normalized_pole is not None:
        if normalized_pole_mode == "exact":
            where.append("lower(coalesce(pole, '')) = ?")
            params.append(normalized_pole.lower())
        else:
            where.append("lower(coalesce(pole, '')) LIKE ?")
            params.append(f"%{normalized_pole.lower()}%")

    normalized_record = _normalize_filter_text(id_rejestru)
    if normalized_record is not None:
        where.append("lower(rekord_kod) LIKE ?")
        params.append(f"%{normalized_record.lower()}%")

    normalized_data_od = _normalize_filter_text(data_od)
    if normalized_data_od is not None:
        where.append("data_godz >= ?")
        params.append(normalized_data_od)

    normalized_data_do = _normalize_filter_text(data_do)
    if normalized_data_do is not None:
        end = normalized_data_do if "T" in normalized_data_do else f"{normalized_data_do}T23:59:59.999Z"
        where.append("data_godz <= ?")
        params.append(end)

    return where, params


def _build_where_sql(where: list[str]) -> str:
    return ("WHERE " + " AND ".join(where)) if where else ""


def _fetch_distinct_values_page(
    conn: Any,
    column_name: str,
    where: list[str],
    params: list[Any],
    phrase: str | None,
    limit: int | None,
    offset: int,
) -> dict[str, Any]:
    local_where = list(where)
    local_params = list(params)

    local_where.append(f"{column_name} IS NOT NULL")
    local_where.append(f"trim({column_name}) <> ''")
    if phrase is not None:
        local_where.append(f"lower({column_name}) LIKE ?")
        local_params.append(f"%{phrase.lower()}%")

    where_sql = _build_where_sql(local_where)

    total_row = conn.execute(
        f"""
        SELECT COUNT(*) AS cnt
        FROM (
            SELECT DISTINCT {column_name} AS value
            FROM audit_log
            {where_sql}
        ) x
        """,
        local_params,
    ).fetchone()
    total = int(total_row["cnt"]) if total_row is not None else 0

    query = f"""
        SELECT DISTINCT {column_name} AS value
        FROM audit_log
        {where_sql}
        ORDER BY lower(value), value
    """
    query_params: list[Any] = list(local_params)
    if limit is not None:
        query += " LIMIT ? OFFSET ?"
        query_params.extend([limit, offset])

    rows = conn.execute(query, query_params).fetchall()
    values = [str(row["value"]) for row in rows]

    if limit is None:
        return {
            "values": values,
            "total": total,
            "has_more": False,
            "next_offset": None,
        }

    next_offset = offset + len(values)
    has_more = next_offset < total
    return {
        "values": values,
        "total": total,
        "has_more": has_more,
        "next_offset": next_offset if has_more else None,
    }


def _normalize_filter_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _resolve_operator(conn: Any, login: str | None) -> dict[str, Any]:
    if not login or not login.strip():
        raise HTTPException(status_code=401, detail="Brak nagłówka X-Operator-Login")
    row = conn.execute(
        "SELECT id, login, rola_id, aktywny FROM users WHERE lower(login) = lower(?) LIMIT 1",
        (login.strip(),),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=401, detail="Nieznany operator")
    return dict(row)
