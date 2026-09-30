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


def fake_livekit(list_rooms=None, update_room_metadata=None, delete_room=None):
    """A LiveKit client whose room service calls are the given coroutines."""
    client = mock.MagicMock()
    client.aclose = mock.AsyncMock()
    client.room.list_rooms = mock.AsyncMock(side_effect=list_rooms)
    client.room.update_room_metadata = mock.AsyncMock(side_effect=update_room_metadata)
    client.room.delete_room = mock.AsyncMock(side_effect=delete_room)
    return client


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


@pytest.mark.parametrize("hanging", ["list_rooms", "update_room_metadata"])
def test_update_metadata_bounded(hanging):
    """A media server that never answers costs one deadline, then a clean failure."""
    client = fake_livekit(
        list_rooms=None if hanging != "list_rooms" else hang,
        update_room_metadata=None if hanging != "update_room_metadata" else hang,
    )
    client.room.list_rooms.return_value = mock.Mock(rooms=[mock.Mock(metadata="{}")])

    with (
        mock.patch.object(
            room_management.utils, "create_livekit_client", return_value=client
        ),
        mock.patch.object(room_management, "MEDIA_SERVER_TIMEOUT_SECONDS", 0.05),
        pytest.raises(RoomManagementException),
    ):
        RoomManagement.update_metadata(str(uuid.uuid4()), {"key": "value"})

    client.aclose.assert_awaited_once()


def test_delete_room_bounded():
    """A delete the media server never answers fails after its deadline."""
    client = fake_livekit(delete_room=hang)

    with (
        mock.patch.object(
            room_management.utils, "create_livekit_client", return_value=client
        ),
        mock.patch.object(room_management, "MEDIA_SERVER_TIMEOUT_SECONDS", 0.05),
        pytest.raises(RoomManagementException),
    ):
        RoomManagement.delete_room("room-abc")

    client.aclose.assert_awaited_once()
