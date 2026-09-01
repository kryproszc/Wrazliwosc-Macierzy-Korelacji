
from app.api import admin, audit_log, auth, email_admin, inspections, locks, notifications, obligating_decisions, recommendations, reports, risk_exposure, schedules, slowniki
from app.db_backup import is_backup_in_progress, run_daily_db_backup_once
from app.db import init_db
from app.schedule_engine import run_due_schedules_once



app.include_router(email_admin.router)


######
from __future__ import annotations

import sqlite3
from typing import Any, Literal

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel

from app.db import get_connection
from app.email_manual.service import (
    RECIPIENT_MODE_ALL_USERS,
    RECIPIENT_MODE_INSPECTION_MEMBERS,
    RECIPIENT_MODE_SELECTED_USERS,
    build_recipients,
    get_history,
    list_inspection_members,
    list_inspections,
    list_users,
    resolve_operator,
    send_manual_email,
)
from app.email_manual.storage import ensure_email_tables


router = APIRouter()


RecipientMode = Literal["selected_users", "inspection_members", "all_users"]


class EmailUserItem(BaseModel):
    id: int
    login: str
    displayName: str
    email: str


class EmailInspectionItem(BaseModel):
    id: str
    label: str


class EmailRecipientPreviewRequest(BaseModel):
    recipientMode: RecipientMode
    selectedUserIds: list[int] | None = None
    inspectionId: str | None = None


class EmailRecipientPreviewItem(BaseModel):
    userId: int | None = None
    displayName: str
    email: str
    source: RecipientMode


class EmailRecipientPreviewResponse(BaseModel):
    total: int
    items: list[EmailRecipientPreviewItem]


class EmailSendRequest(BaseModel):
    recipientMode: RecipientMode
    selectedUserIds: list[int] | None = None
    inspectionId: str | None = None
    subject: str
    body: str


class EmailSendResponse(BaseModel):
    jobId: str


class EmailHistoryItem(BaseModel):
    id: str
    templateId: str
    templateName: str
    subject: str
    body: str
    recipientCount: int
    recipients: list[EmailRecipientPreviewItem]
    status: Literal["queued", "processing", "sent", "partial", "failed"]
    requestedAt: str
    requestedBy: str
    jobId: str
    errorSummary: str


class EmailHistoryResponse(BaseModel):
    items: list[EmailHistoryItem]


def _with_ready_conn() -> sqlite3.Connection:
    conn = get_connection()
    ensure_email_tables(conn)
    return conn


@router.get("/api/admin/email/users", response_model=list[EmailUserItem])
def get_email_users(
    q: str | None = Query(default=None),
    x_operator_login: str = Header(..., alias="X-Operator-Login"),
) -> list[dict[str, Any]]:
    with _with_ready_conn() as conn:
        resolve_operator(conn, x_operator_login)
        return list_users(conn, q)


@router.get("/api/admin/email/inspections", response_model=list[EmailInspectionItem])
def get_email_inspections(
    q: str | None = Query(default=None),
    x_operator_login: str = Header(..., alias="X-Operator-Login"),
) -> list[dict[str, str]]:
    with _with_ready_conn() as conn:
        resolve_operator(conn, x_operator_login)
        return list_inspections(conn, q)


@router.get("/api/admin/email/inspections/{inspectionId:path}/members", response_model=list[EmailUserItem])
def get_email_inspection_members(
    inspectionId: str,
    x_operator_login: str = Header(..., alias="X-Operator-Login"),
) -> list[dict[str, Any]]:
    with _with_ready_conn() as conn:
        resolve_operator(conn, x_operator_login)
        return list_inspection_members(conn, inspectionId)


@router.post("/api/admin/email/recipients/preview", response_model=EmailRecipientPreviewResponse)
def preview_email_recipients(
    payload: EmailRecipientPreviewRequest,
    x_operator_login: str = Header(..., alias="X-Operator-Login"),
) -> dict[str, Any]:
    with _with_ready_conn() as conn:
        resolve_operator(conn, x_operator_login)
        items = build_recipients(
            conn,
            recipient_mode=payload.recipientMode,
            selected_user_ids=payload.selectedUserIds,
            inspection_id=payload.inspectionId,
        )

    return {
        "total": len(items),
        "items": items,
    }


@router.post("/api/admin/email/send", response_model=EmailSendResponse)
def send_email(
    payload: EmailSendRequest,
    x_operator_login: str = Header(..., alias="X-Operator-Login"),
) -> dict[str, str]:
    with _with_ready_conn() as conn:
        operator = resolve_operator(conn, x_operator_login)
        job_id = send_manual_email(
            conn,
            requested_by_login=str(operator["login"]),
            recipient_mode=payload.recipientMode,
            selected_user_ids=payload.selectedUserIds,
            inspection_id=payload.inspectionId,
            subject=payload.subject,
            body=payload.body,
        )
        conn.commit()

    return {"jobId": job_id}


@router.get("/api/admin/email/history", response_model=EmailHistoryResponse)
def get_email_history(
    limit: int = Query(default=100, ge=1, le=500),
    x_operator_login: str = Header(..., alias="X-Operator-Login"),
) -> dict[str, Any]:
    with _with_ready_conn() as conn:
        resolve_operator(conn, x_operator_login)
        items = get_history(conn, limit)
    return {"items": items}
