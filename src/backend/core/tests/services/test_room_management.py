"""Tests for the RoomManagement service."""

import asyncio
import uuid
from unittest import mock

import pytest
from livekit.api import TwirpError

from core.factories import RoomFactory
from core.models import RoomAccessLevel
from core.services import room_management
from core.services.room_management import (
    RoomManagement,
    RoomManagementException,
    RoomNotFoundException,
)


async def hang(*args, **kwargs):
    """A media server call that never answers."""
    await asyncio.sleep(60)


@mock.patch("core.services.room_management.utils.create_livekit_client")
def test_delete_room_calls_livekit(mock_create_livekit_client):
    """DeleteRoom is forwarded to the LiveKit API."""
    mock_api = mock.MagicMock()
    mock_api.room.delete_room = mock.AsyncMock()
    mock_api.aclose = mock.AsyncMock()
    mock_create_livekit_client.return_value = mock_api

    RoomManagement.delete_room("room-abc")

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
        RoomManagement.delete_room("missing-room")

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
        RoomManagement.delete_room("room-abc")

    mock_api.aclose.assert_awaited_once()


@mock.patch.object(RoomManagement, "update_metadata")
def test_sync_room_metadata_pushes_configuration_and_access_level(mock_update_metadata):
    """The room's configuration and access level are forwarded to LiveKit."""
    room = RoomFactory.build(
        access_level=RoomAccessLevel.RESTRICTED,
        configuration={"everyone_can_mute": True},
    )

    RoomManagement.sync_room_metadata(room)

    mock_update_metadata.assert_called_once_with(
        room_name=str(room.id),
        metadata={
            "configuration": {"everyone_can_mute": True},
            "access_level": RoomAccessLevel.RESTRICTED,
        },
    )


@pytest.mark.parametrize(
    "hanging", ["list_rooms", "update_room_metadata", "delete_room"]
)
def test_media_server_call_bounded(hanging):
    """A media server that never answers costs one deadline, then a clean failure."""
    client = mock.MagicMock()
    client.aclose = mock.AsyncMock()
    for call in ("list_rooms", "update_room_metadata", "delete_room"):
        side_effect = hang if call == hanging else None
        setattr(client.room, call, mock.AsyncMock(side_effect=side_effect))
    client.room.list_rooms.return_value = mock.Mock(rooms=[mock.Mock(metadata="{}")])

    with (
        mock.patch.object(
            room_management.utils, "create_livekit_client", return_value=client
        ),
        mock.patch.object(room_management, "MEDIA_SERVER_TIMEOUT_SECONDS", 0.05),
        pytest.raises(RoomManagementException),
    ):
        if hanging == "delete_room":
            RoomManagement.delete_room("room-abc")
        else:
            RoomManagement.update_metadata(str(uuid.uuid4()), {"key": "value"})

    client.aclose.assert_awaited_once()
