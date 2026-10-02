"""Fixtures shared by the breakout tests."""

import json
from unittest import mock

import pytest

from core import utils


@pytest.fixture
def livekit():
    """A media server client whose main room is live with some metadata."""
    client = mock.MagicMock()
    client.aclose = mock.AsyncMock()
    client.room.create_room = mock.AsyncMock()
    client.room.delete_room = mock.AsyncMock()
    client.room.update_room_metadata = mock.AsyncMock()
    client.room.list_rooms = mock.AsyncMock(
        return_value=mock.Mock(
            rooms=[mock.Mock(metadata=json.dumps({"access_level": "public"}))]
        )
    )
    with mock.patch.object(utils, "create_livekit_client", return_value=client):
        yield client
