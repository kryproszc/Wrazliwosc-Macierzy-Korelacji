from __future__ import annotations

from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
import os
from pathlib import Path
import secrets
import smtplib
from typing import Any, Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel

from app.auth_security import (
    clear_login_failures,
    ensure_login_allowed,
    ensure_password_reset_allowed,
    extract_bearer_token,
    get_user_id_by_token,
    hash_password,
    hash_token,
    issue_session_token,
    register_login_failure,
    register_password_reset_request,
    revoke_user_sessions,
    revoke_token,
    verify_password,
)
from app.db import get_connection
from app.permissions import get_effective_permissions


ROLE_ID_TO_NAME = {
    1: "inspector",
    2: "team_lead",
    3: "director",
    4: "external_user",
}

router = APIRouter()


class LoginRequest(BaseModel):
    login: str


class PasswordLoginRequest(BaseModel):
    login: str
    password: str


class LoginUser(BaseModel):
    id: int
    login: str
    imie: str
    nazwisko: str
    rolaId: int
    rola: str
    accountType: Literal["diu", "observer", "technical"]
    zespolId: int | None = None
    zespolSkroconaNazwa: str | None = None
    zespolPelnaNazwa: str | None = None
    canViewTimeReports: bool
    canViewOwnTimeReport: bool
    effectivePermissions: list[str]


class LoginResponse(BaseModel):
    ok: bool
    user: LoginUser


class PasswordLoginResponse(BaseModel):
    ok: bool
    token: str
    expiresAt: str
    user: LoginUser


class LogoutResponse(BaseModel):
    ok: bool


class InviteValidationResponse(BaseModel):
    ok: bool
    login: str
    expiresAt: str


class SetPasswordByInviteRequest(BaseModel):
    token: str
    password: str


class SetPasswordByInviteResponse(BaseModel):
    ok: bool


class ChangePasswordRequest(BaseModel):
    oldPassword: str
    newPassword: str


class ChangePasswordResponse(BaseModel):
    ok: bool


class ForgotPasswordRequest(BaseModel):
    loginOrEmail: str
    frontendResetPasswordUrl: str | None = None


class ForgotPasswordResponse(BaseModel):
    ok: bool
    delivery: str


class PasswordResetValidationResponse(BaseModel):
    ok: bool
    login: str
    expiresAt: str


class PasswordResetConfirmRequest(BaseModel):
    token: str
    password: str


class PasswordResetConfirmResponse(BaseModel):
    ok: bool


def _can_view_time_reports(rola_id: int) -> bool:
    return int(rola_id) in {2, 3, 4}


def _can_view_own_time_report(rola_id: int) -> bool:
    return int(rola_id) == 1


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _attempt_noun(value: int) -> str:
    if value == 1:
        return "proba"
    if value % 10 in {2, 3, 4} and value % 100 not in {12, 13, 14}:
        return "proby"
    return "prob"


def _invalid_credentials_detail(remaining_attempts: int) -> str:
    remaining = max(0, int(remaining_attempts))
    return f"Niepoprawny login lub haslo. Pozostalo jeszcze {remaining} {_attempt_noun(remaining)} logowania."


def _auth_lockout_minutes() -> int:
    raw = (os.getenv("AUTH_LOCKOUT_MINUTES") or "5").strip()
    try:
        parsed = int(raw)
    except ValueError:
        return 5
    return parsed if parsed > 0 else 5


def _invalid_credentials_payload(remaining_attempts: int, max_attempts: int) -> dict[str, Any]:
    remaining = max(0, int(remaining_attempts))
    maximum = max(1, int(max_attempts))
    return {
        "code": "AUTH_INVALID_CREDENTIALS",
        "message": _invalid_credentials_detail(remaining),
        "attemptsRemaining": remaining,
        "maxAttempts": maximum,
        "lockoutMinutes": _auth_lockout_minutes(),
    }


def _login_locked_payload(locked_until: str | None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "code": "AUTH_LOGIN_LOCKED",
        "message": f"Zbyt wiele nieudanych prob logowania. Sprobuj ponownie po: {locked_until}",
        "lockedUntil": locked_until,
    }

    if locked_until:
        try:
            locked_dt = datetime.fromisoformat(str(locked_until))
            remaining = int((locked_dt - datetime.now(timezone.utc)).total_seconds())
            payload["retryAfterSeconds"] = max(0, remaining)
        except ValueError:
            pass

    return payload


def _password_reset_ttl_minutes() -> int:
    raw = (os.getenv("AUTH_PASSWORD_RESET_TTL_MINUTES") or "60").strip()
    try:
        parsed = int(raw)
    except ValueError:
        return 60
    return parsed if parsed > 0 else 60


def _build_password_reset_link(token: str, frontend_reset_password_url: str | None = None) -> str:
    base = (
        frontend_reset_password_url
        or os.getenv("FRONTEND_RESET_PASSWORD_URL")
        or "http://172.25.210.87:3002/reset-password"
    ).strip()
    if not base:
        base = "http://172.25.210.87:3002/reset-password"

    parts = urlsplit(base)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query["token"] = token
    updated_query = urlencode(query)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, updated_query, parts.fragment))


def _load_smtp_password() -> str:
    direct = os.getenv("SMTP_PASS") or ""
    if direct:
        return direct

    secret_file_raw = (os.getenv("SMTP_PASS_FILE") or "").strip()
    if not secret_file_raw:
        return ""

    try:
        return Path(secret_file_raw).read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Nie mozna odczytac SMTP_PASS_FILE") from exc


def _audit(event: str, **fields: str) -> None:
    pairs = " ".join(f"{key}={value}" for key, value in fields.items())
    print(f"[AUDIT] event={event} {pairs}".strip())


def _send_password_reset_email(to_email: str, login: str, reset_link: str, expires_at: str) -> str:
    mode = (os.getenv("INVITE_EMAIL_MODE") or "log").strip().lower()
    if mode not in {"log", "smtp"}:
        mode = "log"

    if mode == "log":
        print(
            "[PASSWORD-RESET-EMAIL]",
            f"to={to_email}",
            f"login={login}",
            f"expires_at={expires_at}",
            f"link={reset_link}",
        )
        return "log"

    smtp_host = (os.getenv("SMTP_HOST") or "").strip()
    smtp_port_raw = (os.getenv("SMTP_PORT") or "465").strip()
    smtp_login = (os.getenv("SMTP_LOGIN") or "").strip()
    smtp_pass = _load_smtp_password()
    smtp_login_mail = (os.getenv("SMTP_LOGIN_MAIL") or "").strip()
    from_email = (os.getenv("FROM_EMAIL") or smtp_login_mail or "").strip()
    smtp_security = (os.getenv("SMTP_SECURITY") or "starttls").strip().lower()

    if not smtp_host or not smtp_login or not smtp_pass or not from_email:
        raise HTTPException(status_code=500, detail="Brak konfiguracji SMTP do resetu hasla")

    try:
        smtp_port = int(smtp_port_raw)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail="Niepoprawna konfiguracja SMTP_PORT") from exc

    if smtp_security not in {"starttls", "ssl", "plain"}:
        raise HTTPException(status_code=500, detail="Niepoprawna konfiguracja SMTP_SECURITY")

    base_dir = Path(__file__).resolve().parents[2]
    template_path = Path(
        (
            os.getenv("RESET_PASSWORD_EMAIL_TEMPLATE_FILE")
            or str(base_dir / "config" / "reset_password_email_template.txt")
        ).strip()
    )
    if template_path.exists() and template_path.is_file():
        template_text = template_path.read_text(encoding="utf-8")
    else:
        template_text = "\n".join(
            [
                "Witaj {{LOGIN}},",
                "",
                "Otrzymalismy prosbe o zmiane hasla. Ustaw nowe haslo przez ponizszy link:",
                "{{RESET_LINK}}",
                "",
                "Link wygasa: {{EXPIRES_AT}}",
            ]
        )

    body = (
        template_text.replace("{{LOGIN}}", login)
        .replace("{{RESET_LINK}}", reset_link)
        .replace("{{EXPIRES_AT}}", expires_at)
    )

    msg = EmailMessage()
    msg["Subject"] = (os.getenv("RESET_PASSWORD_EMAIL_SUBJECT") or "Reset hasla").strip()
    msg["From"] = from_email
    msg["To"] = to_email
    msg.set_content(body)

    try:
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
    except (smtplib.SMTPException, OSError) as exc:
        raise HTTPException(status_code=502, detail="Nie udalo sie wyslac emaila resetu hasla") from exc

    return "smtp"


def _load_user_by_login(conn: Any, login: str) -> dict[str, Any] | None:
    row = conn.execute(
        """
        SELECT
            u.id,
            u.login,
            u.imie,
            u.nazwisko,
            u.rola_id,
            u.account_type,
            u.zespol_id,
            u.aktywny,
            u.password_hash,
            t.kod AS zespol_skrocona_nazwa,
            t.nazwa AS zespol_pelna_nazwa
        FROM users u
        LEFT JOIN teams t ON t.id = u.zespol_id
        WHERE lower(u.login) = lower(?)
        LIMIT 1
        """,
        (login,),
    ).fetchone()
    return None if row is None else dict(row)


def _load_user_by_id(conn: Any, user_id: int) -> dict[str, Any] | None:
    row = conn.execute(
        """
        SELECT
            u.id,
            u.login,
            u.imie,
            u.nazwisko,
            u.rola_id,
            u.account_type,
            u.zespol_id,
            u.aktywny,
            u.password_hash,
            t.kod AS zespol_skrocona_nazwa,
            t.nazwa AS zespol_pelna_nazwa
        FROM users u
        LEFT JOIN teams t ON t.id = u.zespol_id
        WHERE u.id = ?
        LIMIT 1
        """,
        (int(user_id),),
    ).fetchone()
    return None if row is None else dict(row)


def _resolve_team_lead_scope(conn: Any, user_id: int, current_team_id: int | None) -> tuple[int | None, str | None, str | None]:
    if current_team_id is not None:
        row = conn.execute(
            "SELECT id, kod, nazwa FROM teams WHERE id = ? LIMIT 1",
            (int(current_team_id),),
        ).fetchone()
        if row is not None:
            return int(row["id"]), row["kod"], row["nazwa"]

    managed_team = conn.execute(
        """
        SELECT id, kod, nazwa
        FROM teams
        WHERE kierownik_user_id = ?
        ORDER BY id ASC
        LIMIT 1
        """,
        (int(user_id),),
    ).fetchone()
    if managed_team is None:
        return None, None, None
    return int(managed_team["id"]), managed_team["kod"], managed_team["nazwa"]


def _to_login_response(conn: Any, data: dict[str, Any]) -> dict[str, Any]:
    rola_id = int(data["rola_id"])
    rola_name = ROLE_ID_TO_NAME.get(rola_id, "unknown")
    account_type = str(data.get("account_type") or ("observer" if rola_id == 4 else "diu")).strip().lower()
    if account_type not in {"diu", "observer", "technical"}:
        account_type = "observer" if rola_id == 4 else "diu"
    effective_permissions = get_effective_permissions(conn, int(data["id"]), rola_id)

    team_id = data.get("zespol_id")
    team_short = data.get("zespol_skrocona_nazwa")
    team_full = data.get("zespol_pelna_nazwa")
    if rola_id == 2:
        team_id, team_short, team_full = _resolve_team_lead_scope(conn, int(data["id"]), team_id)

    return {
        "ok": True,
        "user": {
            "id": data["id"],
            "login": data["login"],
            "imie": data["imie"],
            "nazwisko": data["nazwisko"],
            "rolaId": rola_id,
            "rola": rola_name,
            "accountType": account_type,
            "zespolId": team_id,
            "zespolSkroconaNazwa": team_short,
            "zespolPelnaNazwa": team_full,
            "canViewTimeReports": _can_view_time_reports(rola_id),
            "canViewOwnTimeReport": _can_view_own_time_report(rola_id),
            "effectivePermissions": effective_permissions,
        },
    }


@router.post("/api/auth/login", response_model=LoginResponse)
def login_only(payload: LoginRequest) -> dict[str, Any]:
    login = payload.login.strip()
    if not login:
        raise HTTPException(status_code=400, detail="Login is required")

    with get_connection() as conn:
        data = _load_user_by_login(conn, login)

    if data is None:
        raise HTTPException(status_code=401, detail="Uzytkownik nie istnieje")

    if int(data["aktywny"]) != 1:
        raise HTTPException(status_code=403, detail="Uzytkownik jest nieaktywny")

    with get_connection() as conn:
        fresh = _load_user_by_login(conn, login)
        if fresh is None:
            raise HTTPException(status_code=401, detail="Uzytkownik nie istnieje")
        return _to_login_response(conn, fresh)


@router.get("/api/auth/me", response_model=LoginResponse)
def auth_me(x_operator_login: str | None = Header(default=None, alias="X-Operator-Login")) -> dict[str, Any]:
    login = (x_operator_login or "").strip()
    if not login:
        raise HTTPException(status_code=401, detail="Uzytkownik nie istnieje")

    with get_connection() as conn:
        data = _load_user_by_login(conn, login)

    if data is None:
        raise HTTPException(status_code=401, detail="Uzytkownik nie istnieje")

    if int(data["aktywny"]) != 1:
        raise HTTPException(status_code=403, detail="Uzytkownik jest nieaktywny")

    with get_connection() as conn:
        fresh = _load_user_by_login(conn, login)
        if fresh is None:
            raise HTTPException(status_code=401, detail="Uzytkownik nie istnieje")
        return _to_login_response(conn, fresh)


@router.post("/api/auth/password-login", response_model=PasswordLoginResponse)
def password_login(payload: PasswordLoginRequest) -> dict[str, Any]:
    login = payload.login.strip()
    password = payload.password
    if not login:
        raise HTTPException(status_code=400, detail="Login is required")
    if not password:
        raise HTTPException(status_code=400, detail="Password is required")

    with get_connection() as conn:
        allowed, locked_until = ensure_login_allowed(conn, login)
        if not allowed:
            raise HTTPException(status_code=429, detail=_login_locked_payload(locked_until))

        data = _load_user_by_login(conn, login)
        if data is None:
            failure_state = register_login_failure(conn, login)
            conn.commit()
            locked_after_failure = str(failure_state.get("locked_until") or "").strip() or None
            if locked_after_failure is not None:
                raise HTTPException(
                    status_code=429,
                    detail=_login_locked_payload(locked_after_failure),
                )
            raise HTTPException(
                status_code=401,
                detail=_invalid_credentials_payload(
                    int(failure_state.get("remaining_attempts") or 0),
                    int(failure_state.get("max_attempts") or 1),
                ),
            )
        if int(data["aktywny"]) != 1:
            raise HTTPException(status_code=403, detail="Uzytkownik jest nieaktywny")
        if not verify_password(password, data.get("password_hash")):
            failure_state = register_login_failure(conn, login)
            conn.commit()
            locked_after_failure = str(failure_state.get("locked_until") or "").strip() or None
            if locked_after_failure is not None:
                raise HTTPException(
                    status_code=429,
                    detail=_login_locked_payload(locked_after_failure),
                )
            raise HTTPException(
                status_code=401,
                detail=_invalid_credentials_payload(
                    int(failure_state.get("remaining_attempts") or 0),
                    int(failure_state.get("max_attempts") or 1),
                ),
            )

        clear_login_failures(conn, login)
        token, expires_at = issue_session_token(conn, int(data["id"]))
        conn.commit()

    with get_connection() as conn:
        refreshed = _load_user_by_id(conn, int(data["id"]))
        if refreshed is None:
            raise HTTPException(status_code=401, detail="Uzytkownik nie istnieje")
        response = _to_login_response(conn, refreshed)
    response["token"] = token
    response["expiresAt"] = expires_at
    return response


@router.get("/api/auth/me-token", response_model=LoginResponse)
def auth_me_token(authorization: str | None = Header(default=None, alias="Authorization")) -> dict[str, Any]:
    token = extract_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Brak lub niepoprawny token")

    with get_connection() as conn:
        user_id = get_user_id_by_token(conn, token)
        if user_id is None:
            raise HTTPException(status_code=401, detail="Sesja wygasla lub jest niepoprawna")

        data = _load_user_by_id(conn, user_id)
        if data is None:
            raise HTTPException(status_code=401, detail="Uzytkownik nie istnieje")
        if int(data["aktywny"]) != 1:
            raise HTTPException(status_code=403, detail="Uzytkownik jest nieaktywny")

    with get_connection() as conn:
        refreshed = _load_user_by_id(conn, int(data["id"]))
        if refreshed is None:
            raise HTTPException(status_code=401, detail="Uzytkownik nie istnieje")
        return _to_login_response(conn, refreshed)


@router.post("/api/auth/logout-token", response_model=LogoutResponse)
def auth_logout_token(authorization: str | None = Header(default=None, alias="Authorization")) -> dict[str, bool]:
    token = extract_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Brak lub niepoprawny token")

    with get_connection() as conn:
        revoke_token(conn, token)
        conn.commit()

    return {"ok": True}


@router.post("/api/auth/change-password", response_model=ChangePasswordResponse)
def change_password(
    payload: ChangePasswordRequest,
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> dict[str, bool]:
    token = extract_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Brak lub niepoprawny token")

    if not payload.oldPassword:
        raise HTTPException(status_code=400, detail="Stare haslo jest wymagane")

    try:
        new_password_hash = hash_password(payload.newPassword)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    with get_connection() as conn:
        user_id = get_user_id_by_token(conn, token)
        if user_id is None:
            raise HTTPException(status_code=401, detail="Sesja wygasla lub jest niepoprawna")

        data = _load_user_by_id(conn, user_id)
        if data is None:
            raise HTTPException(status_code=401, detail="Uzytkownik nie istnieje")
        if int(data["aktywny"]) != 1:
            raise HTTPException(status_code=403, detail="Uzytkownik jest nieaktywny")
        if not verify_password(payload.oldPassword, data.get("password_hash")):
            raise HTTPException(status_code=401, detail="Niepoprawne stare haslo")

        conn.execute(
            """
            UPDATE users
            SET password_hash = ?,
                zaktualizowano_o = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (new_password_hash, int(user_id)),
        )
        revoke_user_sessions(conn, int(user_id))
        conn.commit()

    return {"ok": True}


@router.post("/api/auth/forgot-password", response_model=ForgotPasswordResponse)
def forgot_password(payload: ForgotPasswordRequest, request: Request) -> dict[str, Any]:
    login_or_email = payload.loginOrEmail.strip()
    if not login_or_email:
        raise HTTPException(status_code=400, detail="Login lub email jest wymagany")

    normalized = login_or_email.lower()
    fwd_for = (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
    client_ip = fwd_for or (request.client.host if request.client is not None else "unknown")
    identity_key = f"identity:{normalized}"
    ip_key = f"ip:{client_ip.lower()}"

    def _accepted() -> dict[str, Any]:
        return {"ok": True, "delivery": "accepted"}

    with get_connection() as conn:
        identity_allowed, identity_retry_at = ensure_password_reset_allowed(conn, identity_key)
        ip_allowed, ip_retry_at = ensure_password_reset_allowed(conn, ip_key)
        if not identity_allowed or not ip_allowed:
            _audit(
                "password_reset_throttled",
                identity_key=identity_key,
                ip=client_ip,
                retry_at=identity_retry_at or ip_retry_at or "unknown",
            )
            return _accepted()

        register_password_reset_request(conn, identity_key)
        register_password_reset_request(conn, ip_key)

        row_login = conn.execute(
            """
            SELECT id, login, email, aktywny
            FROM users
            WHERE lower(login) = lower(?)
            LIMIT 1
            """,
            (login_or_email,),
        ).fetchone()
        row = row_login

        if row is None:
            email_rows = conn.execute(
                """
                SELECT id, login, email, aktywny
                FROM users
                WHERE lower(email) = lower(?)
                LIMIT 2
                """,
                (login_or_email,),
            ).fetchall()
            if len(email_rows) == 1:
                row = email_rows[0]
            else:
                conn.commit()
                return _accepted()

        if row is None:
            conn.commit()
            return _accepted()

        user = dict(row)
        if int(user["aktywny"]) != 1:
            conn.commit()
            return _accepted()

        email = str(user.get("email") or "").strip()
        if not email or "@" not in email:
            conn.commit()
            return _accepted()

        token = secrets.token_urlsafe(48)
        token_hash = hash_token(token)
        expires_at = (datetime.now(timezone.utc) + timedelta(minutes=_password_reset_ttl_minutes())).isoformat(
            timespec="seconds"
        )

        conn.execute(
            """
            UPDATE user_password_resets
            SET used_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND used_at IS NULL
            """,
            (int(user["id"]),),
        )
        conn.execute(
            """
            INSERT INTO user_password_resets (user_id, token_hash, expires_at)
            VALUES (?, ?, ?)
            """,
            (int(user["id"]), token_hash, expires_at),
        )

        reset_link = _build_password_reset_link(token, payload.frontendResetPasswordUrl)
        try:
            _send_password_reset_email(email, str(user["login"]), reset_link, expires_at)
            _audit("password_reset_requested", user_id=str(user["id"]), method="email")
        except HTTPException:
            # Keep response neutral to avoid user/account enumeration.
            _audit("password_reset_email_failed", user_id=str(user["id"]), method="email")
        conn.commit()

    return _accepted()


@router.get("/api/auth/password-reset/validate", response_model=PasswordResetValidationResponse)
def validate_password_reset_token(token: str = Query(..., min_length=10)) -> dict[str, Any]:
    token_hash = hash_token(token)
    now_iso = _now_iso()

    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT u.login, pr.expires_at
            FROM user_password_resets pr
            JOIN users u ON u.id = pr.user_id
            WHERE pr.token_hash = ?
              AND pr.used_at IS NULL
              AND pr.expires_at > ?
              AND u.aktywny = 1
            LIMIT 1
            """,
            (token_hash, now_iso),
        ).fetchone()

    if row is None:
        raise HTTPException(status_code=400, detail="Token resetu hasla jest niepoprawny lub wygasl")

    data = dict(row)
    return {
        "ok": True,
        "login": data["login"],
        "expiresAt": data["expires_at"],
    }


@router.post("/api/auth/password-reset/confirm", response_model=PasswordResetConfirmResponse)
def confirm_password_reset(payload: PasswordResetConfirmRequest) -> dict[str, bool]:
    token = payload.token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="Token jest wymagany")

    try:
        password_hash_value = hash_password(payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    token_hash = hash_token(token)
    now_iso = _now_iso()
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT pr.id, pr.user_id
            FROM user_password_resets pr
            JOIN users u ON u.id = pr.user_id
            WHERE pr.token_hash = ?
              AND pr.used_at IS NULL
              AND pr.expires_at > ?
              AND u.aktywny = 1
            LIMIT 1
            """,
            (token_hash, now_iso),
        ).fetchone()

        if row is None:
            raise HTTPException(status_code=400, detail="Token resetu hasla jest niepoprawny lub wygasl")

        reset_row = dict(row)
        user_id = int(reset_row["user_id"])

        conn.execute(
            """
            UPDATE users
            SET password_hash = ?,
                zaktualizowano_o = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (password_hash_value, user_id),
        )
        conn.execute(
            """
            UPDATE user_password_resets
            SET used_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (int(reset_row["id"]),),
        )
        revoke_user_sessions(conn, user_id)
        conn.commit()

    return {"ok": True}


@router.get("/api/auth/invitations/validate", response_model=InviteValidationResponse)
def validate_invitation_token(token: str = Query(..., min_length=10)) -> dict[str, Any]:
    token_hash = hash_token(token)
    now_iso = _now_iso()
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT u.login, ui.expires_at
            FROM user_invites ui
            JOIN users u ON u.id = ui.user_id
            WHERE ui.token_hash = ?
              AND ui.used_at IS NULL
              AND ui.expires_at > ?
              AND u.aktywny = 1
            LIMIT 1
            """,
            (token_hash, now_iso),
        ).fetchone()

    if row is None:
        raise HTTPException(status_code=400, detail="Token zaproszenia jest niepoprawny lub wygasl")

    data = dict(row)
    return {
        "ok": True,
        "login": data["login"],
        "expiresAt": data["expires_at"],
    }


@router.post("/api/auth/invitations/set-password", response_model=SetPasswordByInviteResponse)
def set_password_by_invite(payload: SetPasswordByInviteRequest) -> dict[str, bool]:
    token = payload.token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="Token jest wymagany")

    try:
        password_hash_value = hash_password(payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    token_hash = hash_token(token)
    now_iso = _now_iso()
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT ui.id, ui.user_id
            FROM user_invites ui
            JOIN users u ON u.id = ui.user_id
            WHERE ui.token_hash = ?
              AND ui.used_at IS NULL
              AND ui.expires_at > ?
              AND u.aktywny = 1
            LIMIT 1
            """,
            (token_hash, now_iso),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=400, detail="Token zaproszenia jest niepoprawny lub wygasl")

        invite = dict(row)
        conn.execute(
            """
            UPDATE users
            SET password_hash = ?,
                zaktualizowano_o = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (password_hash_value, int(invite["user_id"])),
        )
        conn.execute(
            """
            UPDATE user_invites
            SET used_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (int(invite["id"]),),
        )
        conn.commit()

    return {"ok": True}
