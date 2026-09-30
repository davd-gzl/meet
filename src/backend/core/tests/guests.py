"""Helpers building a guest's signed lobby cookie and the request carrying it."""

from django.conf import settings
from django.core import signing
from django.http import HttpRequest

from core.services.lobby import LobbyService


def guest_request(cookie=None):
    """Return a request carrying the given lobby cookie, if any."""
    request = HttpRequest()
    if cookie is not None:
        request.COOKIES[settings.LOBBY_COOKIE_NAME] = cookie
    return request


def signed_capability(capability):
    """Return a lobby cookie value carrying the given capability."""
    return signing.dumps(capability, salt=LobbyService.GUEST_COOKIE_SALT)
