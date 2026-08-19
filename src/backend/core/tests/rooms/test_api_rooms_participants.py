"""
Test rooms API endpoints in the Meet core app: participants count.
"""

# pylint: disable=redefined-outer-name,unused-argument,no-name-in-module

import random
from unittest import mock

from django.core.cache import cache
from django.test.utils import override_settings
from django.urls import reverse

import pytest
from livekit.api import TwirpError
from livekit.protocol.models import Room as LiveKitRoom
from livekit.protocol.room import ListRoomsResponse
from rest_framework import status
from rest_framework.test import APIClient

from core.api.throttling import ParticipantsUserRateThrottle
from core.factories import RoomFactory, UserFactory, UserResourceAccessFactory
from core.models import RoomAccessLevel

pytestmark = pytest.mark.django_db

INSIDE = {"count": 2}


@pytest.fixture(autouse=True)
def clear_cache():
    """Keep one test's view of a meeting out of the next one."""
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def mock_livekit_client():
    """Mock LiveKit API client, reporting two people in every room."""
    with mock.patch("core.utils.create_livekit_client") as mock_create:
        mock_client = mock.AsyncMock()
        mock_client.room.list_rooms.return_value = ListRoomsResponse(
            rooms=[LiveKitRoom(num_participants=2)]
        )
        mock_create.return_value = mock_client
        yield mock_client


@pytest.mark.parametrize(
    "access_level,sign_in,with_role,expected",
    [
        # Anyone may enter a public room, so anyone may read it.
        (RoomAccessLevel.PUBLIC, False, False, status.HTTP_200_OK),
        (RoomAccessLevel.PUBLIC, True, False, status.HTTP_200_OK),
        # A trusted room admits anyone signed in, and holds anyone else.
        (RoomAccessLevel.TRUSTED, True, False, status.HTTP_200_OK),
        (RoomAccessLevel.TRUSTED, False, False, status.HTTP_404_NOT_FOUND),
        # A restricted room admits the people invited to it.
        (RoomAccessLevel.RESTRICTED, True, True, status.HTTP_200_OK),
        (RoomAccessLevel.RESTRICTED, True, False, status.HTTP_404_NOT_FOUND),
        (RoomAccessLevel.RESTRICTED, False, False, status.HTTP_404_NOT_FOUND),
    ],
)
def test_participants_answers_whoever_the_room_would_admit(
    mock_livekit_client, access_level, sign_in, with_role, expected
):
    """Only someone the room would let in without approval is told who is inside."""
    room = RoomFactory(access_level=access_level)
    client = APIClient()

    if sign_in:
        user = UserFactory()
        if with_role:
            UserResourceAccessFactory(
                resource=room,
                user=user,
                role=random.choice(["member", "administrator", "owner"]),
            )
        client.force_authenticate(user=user)

    response = client.get(reverse("rooms-participants", kwargs={"pk": room.id}))

    assert response.status_code == expected

    if expected == status.HTTP_200_OK:
        assert response.json() == INSIDE
        request = mock_livekit_client.room.list_rooms.call_args.args[0]
        assert list(request.names) == [str(room.id)]
    else:
        mock_livekit_client.room.list_rooms.assert_not_called()


def test_participants_by_slug(mock_livekit_client):
    """The room code in the address reaches the same answer as the id."""
    room = RoomFactory(access_level=RoomAccessLevel.PUBLIC)

    response = APIClient().get(reverse("rooms-participants", kwargs={"pk": room.slug}))

    assert response.status_code == status.HTTP_200_OK
    assert response.json() == INSIDE


def test_participants_is_read_once_for_everyone_waiting(mock_livekit_client):
    """The join screen is polled, so the answer is held rather than asked twice."""
    room = RoomFactory(access_level=RoomAccessLevel.PUBLIC)
    url = reverse("rooms-participants", kwargs={"pk": room.id})

    first = APIClient().get(url)
    second = APIClient().get(url)

    assert first.json() == second.json() == INSIDE
    assert mock_livekit_client.room.list_rooms.call_count == 1


@override_settings(ROOM_PARTICIPANTS_CACHE_SECONDS=0)
def test_participants_cache_can_be_turned_off(mock_livekit_client):
    """A zero hold sends every request through to LiveKit."""
    room = RoomFactory(access_level=RoomAccessLevel.PUBLIC)
    url = reverse("rooms-participants", kwargs={"pk": room.id})

    APIClient().get(url)
    APIClient().get(url)

    assert mock_livekit_client.room.list_rooms.call_count == 2


def test_participants_of_two_rooms_are_held_apart(mock_livekit_client):
    """One meeting's answer is never served for another."""
    first = RoomFactory(access_level=RoomAccessLevel.PUBLIC)
    second = RoomFactory(access_level=RoomAccessLevel.PUBLIC)

    APIClient().get(reverse("rooms-participants", kwargs={"pk": first.id}))
    APIClient().get(reverse("rooms-participants", kwargs={"pk": second.id}))

    assert mock_livekit_client.room.list_rooms.call_count == 2


@override_settings(ALLOW_UNREGISTERED_ROOMS=True)
def test_participants_unregistered_room(mock_livekit_client):
    """An unregistered room is read under the slug it is named by."""
    response = APIClient().get(
        reverse("rooms-participants", kwargs={"pk": "tst-room-dev"})
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.json() == INSIDE

    request = mock_livekit_client.room.list_rooms.call_args.args[0]
    assert list(request.names) == ["tst-room-dev"]


@override_settings(ALLOW_UNREGISTERED_ROOMS=False)
def test_participants_unregistered_room_disabled(mock_livekit_client):
    """With unregistered rooms off, an unknown room stays unknown."""
    response = APIClient().get(
        reverse("rooms-participants", kwargs={"pk": "tst-room-dev"})
    )

    assert response.status_code == status.HTTP_404_NOT_FOUND
    mock_livekit_client.room.list_rooms.assert_not_called()


def test_participants_livekit_unreachable(mock_livekit_client):
    """A media server that cannot answer gives 503, never a 500."""
    room = RoomFactory(access_level=RoomAccessLevel.PUBLIC)
    mock_livekit_client.room.list_rooms.side_effect = TwirpError(
        "internal", "boom", status=500
    )

    response = APIClient().get(reverse("rooms-participants", kwargs={"pk": room.id}))

    assert response.status_code == status.HTTP_503_SERVICE_UNAVAILABLE


def test_participants_anonymous_request_is_counted_once():
    """An anonymous poll must not spend two of its own allowance.

    Both throttles share a scope, and UserRateThrottle falls back to the IP
    address, so without the guard it builds the very key the anonymous throttle
    uses and every request counts twice.
    """
    request = mock.Mock()
    request.user.is_authenticated = False

    assert ParticipantsUserRateThrottle().get_cache_key(request, view=None) is None
