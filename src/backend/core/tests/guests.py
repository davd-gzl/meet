"""Helper building the request a guest's lobby cookie arrives on."""

from django.conf import settings
from django.http import HttpRequest


def guest_request(cookie=None):
    """Return a request carrying the given lobby cookie, if any."""
    request = HttpRequest()
    if cookie is not None:
        request.COOKIES[settings.LOBBY_COOKIE_NAME] = cookie
    return request
