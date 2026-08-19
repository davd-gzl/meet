"""Tests for the RoomManagement service."""

from unittest import mock

from django.conf import settings

import aiohttp
import pytest
from livekit.api import TwirpError
from livekit.protocol.models import Room as LiveKitRoom
from livekit.protocol.room import ListRoomsResponse

from core.services.room_management import (
    RoomManagement,
    RoomManagementException,
    RoomNotFoundException,
)


def livekit_client(mock_create_livekit_client, **calls):
    """Wire a mocked LiveKit client, one keyword per room method under test.

    An exception becomes that call's side effect, anything else its return
    value. Every test needs the same four lines otherwise.
    """
    mock_api = mock.MagicMock()

    for name, outcome in calls.items():
        answer = (
            {"side_effect": outcome}
            if isinstance(outcome, Exception)
            else {"return_value": outcome}
        )
        setattr(mock_api.room, name, mock.AsyncMock(**answer))

    mock_api.aclose = mock.AsyncMock()
    mock_create_livekit_client.return_value = mock_api

    return mock_api


@mock.patch("core.services.room_management.utils.create_livekit_client")
def test_delete_room_calls_livekit(mock_create_livekit_client):
    """DeleteRoom is forwarded to the LiveKit API."""
    mock_api = livekit_client(mock_create_livekit_client, delete_room=None)

    RoomManagement().delete_room("room-abc")

    mock_api.room.delete_room.assert_awaited_once()
    request = mock_api.room.delete_room.await_args.args[0]
    assert request.room == "room-abc"
    mock_api.aclose.assert_awaited_once()


@mock.patch("core.services.room_management.utils.create_livekit_client")
def test_delete_room_raises_not_found(mock_create_livekit_client):
    """Missing rooms raise RoomNotFoundException."""
    mock_api = livekit_client(
        mock_create_livekit_client,
        delete_room=TwirpError("not_found", "room not found", status=404),
    )

    with pytest.raises(RoomNotFoundException):
        RoomManagement().delete_room("missing-room")

    mock_api.aclose.assert_awaited_once()


@mock.patch("core.services.room_management.utils.create_livekit_client")
def test_delete_room_raises_management_exception(mock_create_livekit_client):
    """Unexpected Twirp errors raise RoomManagementException."""
    mock_api = livekit_client(
        mock_create_livekit_client,
        delete_room=TwirpError("internal", "boom", status=500),
    )

    with pytest.raises(RoomManagementException):
        RoomManagement().delete_room("room-abc")

    mock_api.aclose.assert_awaited_once()


@mock.patch("core.services.room_management.utils.create_livekit_client")
def test_get_participants_count_reads_livekit(mock_create_livekit_client):
    """The count is the one LiveKit reports for the room."""
    mock_api = livekit_client(
        mock_create_livekit_client,
        list_rooms=ListRoomsResponse(
            rooms=[LiveKitRoom(name="room-abc", num_participants=3)]
        ),
    )

    assert RoomManagement().get_participants_count("room-abc") == 3

    request = mock_api.room.list_rooms.await_args.args[0]
    assert list(request.names) == ["room-abc"]
    mock_api.aclose.assert_awaited_once()


@mock.patch("core.services.room_management.utils.create_livekit_client")
def test_get_participants_count_of_a_room_livekit_does_not_know(
    mock_create_livekit_client,
):
    """A room LiveKit has never created has nobody in it."""
    mock_api = livekit_client(
        mock_create_livekit_client, list_rooms=ListRoomsResponse(rooms=[])
    )

    assert RoomManagement().get_participants_count("room-abc") == 0

    mock_api.aclose.assert_awaited_once()


@pytest.mark.parametrize(
    "error",
    [
        TwirpError("internal", "boom", status=500),
        aiohttp.ClientConnectorError(mock.Mock(), OSError("connection refused")),
        TimeoutError(),
    ],
)
@mock.patch("core.services.room_management.utils.create_livekit_client")
def test_get_participants_count_raises_management_exception(
    mock_create_livekit_client, error
):
    """A refusal, an unreachable server and a slow one all fail the same way."""
    mock_api = livekit_client(mock_create_livekit_client, list_rooms=error)
    service = RoomManagement()

    with pytest.raises(RoomManagementException):
        service.get_participants_count("room-abc")

    mock_api.aclose.assert_awaited_once()


@mock.patch("core.services.room_management.utils.create_livekit_client")
def test_get_participants_count_bounds_how_long_it_waits(mock_create_livekit_client):
    """The join screen must not hold a worker for the client's own minute."""
    livekit_client(mock_create_livekit_client, list_rooms=ListRoomsResponse(rooms=[]))

    RoomManagement().get_participants_count("room-abc")

    timeout = mock_create_livekit_client.call_args.kwargs["timeout"]
    assert timeout.total == settings.ROOM_PARTICIPANTS_TIMEOUT_SECONDS
