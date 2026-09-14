"""Signup, login, logout, and current user."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response

from ..config import get_settings
from ..models.auth import LoginRequest, SignupRequest, UserPublic
from ..services.auth.sessions import create_session, get_session, revoke_session
from ..services.auth.users import authenticate, create_user, public_user, valid_email

router = APIRouter(prefix="/auth", tags=["auth"])

COOKIE_NAME = "selfrag_session"


def _set_session_cookie(response: Response, token: str, ttl: int) -> None:
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=ttl,
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=COOKIE_NAME, path="/")


def current_user_from_request(request: Request) -> dict | None:
    return get_session(request.cookies.get(COOKIE_NAME))


@router.post("/signup", response_model=UserPublic)
def signup(payload: SignupRequest, response: Response) -> UserPublic:
    settings = get_settings()
    if not valid_email(payload.email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    try:
        user = create_user(settings, payload.email, payload.password, payload.name)
    except ValueError:
        raise HTTPException(status_code=409, detail="An account with that email already exists.")
    token = create_session(user, settings.session_ttl_seconds)
    _set_session_cookie(response, token, settings.session_ttl_seconds)
    return UserPublic(**public_user(user))


@router.post("/login", response_model=UserPublic)
def login(payload: LoginRequest, response: Response) -> UserPublic:
    settings = get_settings()
    user = authenticate(settings, payload.email, payload.password)
    if user is None:
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
    token = create_session(user, settings.session_ttl_seconds)
    _set_session_cookie(response, token, settings.session_ttl_seconds)
    return UserPublic(**public_user(user))


@router.post("/logout")
def logout(request: Request, response: Response) -> dict[str, str]:
    revoke_session(request.cookies.get(COOKIE_NAME))
    _clear_session_cookie(response)
    return {"status": "ok"}


@router.get("/me", response_model=UserPublic)
def me(request: Request) -> UserPublic:
    user = current_user_from_request(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Not signed in.")
    return UserPublic(
        user_id=str(user.get("user_id", "")),
        email=str(user.get("email", "")),
        name=str(user.get("name", "")),
    )
