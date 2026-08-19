"""Tests for the RoomManagement service."""

from unittest import mock

import aiohttp
import pytest
from livekit.api import TwirpError
from livekit.protocol.models import ParticipantInfo, ParticipantPermission
from livekit.protocol.room import ListParticipantsResponse

from core.services.room_management import (
    RoomManagement,
    RoomManagementException,
    RoomNotFoundException,
)


@mock.patch("core.services.room_management.utils.create_livekit_client")
def test_delete_room_calls_livekit(mock_create_livekit_client):
    """DeleteRoom is forwarded to the LiveKit API."""
    mock_api = mock.MagicMock()
    mock_api.room.delete_room = mock.AsyncMock()
    mock_api.aclose = mock.AsyncMock()
    mock_create_livekit_client.return_value = mock_api

    RoomManagement().delete_room("room-abc")

    mock_api.room.delete_room.assert_awaited_once()
    request = mock_api.room.delete_room.await_args.args[0]
    assert request.room == "room-abc"
    mock_api.aclose.assert_awaited_once()


@mock.patch("core.services.room_management.utils.create_livekit_client")
def test_delete_room_raises_not_found(mock_create_livekit_client):
    """Missing rooms raise RoomNotFoundException."""
    mock_api = mock.MagicMock()
    mock_api.room.delete_room = mock.AsyncMock(
        side_effect=TwirpError("not_found", "room not found", status=404)
    )
    mock_api.aclose = mock.AsyncMock()
    mock_create_livekit_client.return_value = mock_api

    with pytest.raises(RoomNotFoundException):
        RoomManagement().delete_room("missing-room")

    mock_api.aclose.assert_awaited_once()


@mock.patch("core.services.room_management.utils.create_livekit_client")
def test_delete_room_raises_management_exception(mock_create_livekit_client):
    """Unexpected Twirp errors raise RoomManagementException."""
    mock_api = mock.MagicMock()
    mock_api.room.delete_room = mock.AsyncMock(
        side_effect=TwirpError("internal", "boom", status=500)
    )
    mock_api.aclose = mock.AsyncMock()
    mock_create_livekit_client.return_value = mock_api

    with pytest.raises(RoomManagementException):
        RoomManagement().delete_room("room-abc")

    mock_api.aclose.assert_awaited_once()


@mock.patch("core.services.room_management.utils.create_livekit_client")
def test_get_participants_names_the_people(mock_create_livekit_client):
    """The list is the display name of every person LiveKit reports."""
    mock_api = mock.MagicMock()
    mock_api.room.list_participants = mock.AsyncMock(
        return_value=ListParticipantsResponse(
            participants=[
                ParticipantInfo(name="Zora"),
                ParticipantInfo(name="Neel"),
            ]
        )
    )
    mock_api.aclose = mock.AsyncMock()
    mock_create_livekit_client.return_value = mock_api

    assert RoomManagement().get_participants("room-abc") == ["Zora", "Neel"]

    request = mock_api.room.list_participants.await_args.args[0]
    assert request.room == "room-abc"
    mock_api.aclose.assert_awaited_once()


@mock.patch("core.services.room_management.utils.create_livekit_client")
def test_get_participants_leaves_out_machines(mock_create_livekit_client):
    """A recorder and an agent are in the room and are not people."""
    mock_api = mock.MagicMock()
    mock_api.room.list_participants = mock.AsyncMock(
        return_value=ListParticipantsResponse(
            participants=[
                ParticipantInfo(name="Zora"),
                ParticipantInfo(name="egress", kind=ParticipantInfo.Kind.EGRESS),
                ParticipantInfo(name="agent", kind=ParticipantInfo.Kind.AGENT),
                ParticipantInfo(
                    name="recorder",
                    permission=ParticipantPermission(recorder=True),
                ),
                ParticipantInfo(
                    name="assistant",
                    permission=ParticipantPermission(agent=True),
                ),
                ParticipantInfo(name="phone", kind=ParticipantInfo.Kind.SIP),
            ]
        )
    )
    mock_api.aclose = mock.AsyncMock()
    mock_create_livekit_client.return_value = mock_api

    assert RoomManagement().get_participants("room-abc") == ["Zora", "phone"]


@mock.patch("core.services.room_management.utils.create_livekit_client")
def test_get_participants_keeps_someone_who_gave_no_name(mock_create_livekit_client):
    """An unnamed person stays in the list, so a caller still counts them."""
    mock_api = mock.MagicMock()
    mock_api.room.list_participants = mock.AsyncMock(
        return_value=ListParticipantsResponse(
            participants=[ParticipantInfo(name="Zora"), ParticipantInfo(name="")]
        )
    )
    mock_api.aclose = mock.AsyncMock()
    mock_create_livekit_client.return_value = mock_api

    assert RoomManagement().get_participants("room-abc") == ["Zora", ""]


@mock.patch("core.services.room_management.utils.create_livekit_client")
def test_get_participants_of_a_room_livekit_does_not_know(mock_create_livekit_client):
    """A room LiveKit has never created has nobody in it."""
    mock_api = mock.MagicMock()
    mock_api.room.list_participants = mock.AsyncMock(
        side_effect=TwirpError("not_found", "room not found", status=404)
    )
    mock_api.aclose = mock.AsyncMock()
    mock_create_livekit_client.return_value = mock_api

    assert RoomManagement().get_participants("room-abc") == []

    mock_api.aclose.assert_awaited_once()


@pytest.mark.parametrize(
    "error",
    [
        TwirpError("internal", "boom", status=500),
        aiohttp.ClientConnectorError(mock.Mock(), OSError("connection refused")),
    ],
)
@mock.patch("core.services.room_management.utils.create_livekit_client")
def test_get_participants_raises_management_exception(
    mock_create_livekit_client, error
):
    """A refusal and an unreachable server both fail the same way."""
    mock_api = mock.MagicMock()
    mock_api.room.list_participants = mock.AsyncMock(side_effect=error)
    mock_api.aclose = mock.AsyncMock()
    mock_create_livekit_client.return_value = mock_api
    service = RoomManagement()

    with pytest.raises(RoomManagementException):
        service.get_participants("room-abc")

    mock_api.aclose.assert_awaited_once()
