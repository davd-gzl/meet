"""
Test how the LiveKit webhook treats breakout rooms and their meeting.
"""
# pylint: disable=W0621,W0613,W0212

import uuid
from unittest import mock

from django.test import override_settings

import pytest
from livekit.api import TwirpError
from rest_framework.test import APIClient

from core import utils
from core.factories import RoomFactory, UserFactory, UserResourceAccessFactory
from core.models import BreakoutRoom, BreakoutSession, BreakoutSessionStatusChoices
from core.services.livekit_events import (
    ActionFailedError,
    LiveKitEventsService,
    api,
)
from core.services.lobby import LobbyService
from core.services.sip_management import SIPException, SIPManagement

pytestmark = pytest.mark.django_db


@pytest.fixture
def service(settings):
    """A LiveKitEventsService with a test LiveKit configuration."""
    settings.LIVEKIT_CONFIGURATION = {
        "api_key": "test_api_key",
        "api_secret": "test_api_secret",
        "url": "https://test-livekit.example.com/",
    }
    return LiveKitEventsService()


@mock.patch.object(api.WebhookReceiver, "receive")
def test_receive_ignores_breakout_room(mock_receive, service):
    """A breakout room is no meeting: its events are acknowledged and ignored."""
    mock_request = mock.MagicMock()
    mock_request.headers = {"Authorization": "test_token"}
    mock_data = mock.MagicMock()
    mock_data.room.name = f"breakout_{uuid.uuid4()}_0"
    mock_data.event = "room_started"
    mock_receive.return_value = mock_data
    # receive() dispatches through the handlers bound at construction.
    handlers = {"room_started": mock.Mock(), "room_finished": mock.Mock()}

    with mock.patch.dict(service._webhook_handlers, handlers):
        service.receive(mock_request)

    for handler in handlers.values():
        handler.assert_not_called()


@pytest.fixture
def livekit():
    """A media server client whose main room has already finished."""
    client = mock.MagicMock()
    client.aclose = mock.AsyncMock()
    client.room.create_room = mock.AsyncMock()
    client.room.delete_room = mock.AsyncMock()
    client.room.update_room_metadata = mock.AsyncMock()
    client.room.list_rooms = mock.AsyncMock(return_value=mock.Mock(rooms=[]))
    with mock.patch.object(utils, "create_livekit_client", return_value=client):
        yield client


def open_session(room, status=BreakoutSessionStatusChoices.ACTIVE):
    """Rows of an open session with two rooms, without the media server."""
    session = BreakoutSession.objects.create(room=room, status=status)
    for index in range(2):
        BreakoutRoom.objects.create(
            session=session,
            name=f"Room {index + 1}",
            livekit_room_name=f"breakout_{session.id!s}_{index}",
            position=index,
        )
    return session


@pytest.mark.parametrize(
    "status",
    [BreakoutSessionStatusChoices.ACTIVE, BreakoutSessionStatusChoices.CLOSING],
)
@mock.patch.object(LobbyService, "clear_room_cache")
@mock.patch.object(SIPManagement, "delete_dispatch_rule")
def test_handle_room_finished_closes_breakout_session(
    mock_delete_dispatch_rule, mock_clear_cache, livekit, service, status
):
    """The meeting ending closes its open split, and the next Open succeeds."""
    room = RoomFactory()
    owner = UserFactory()
    UserResourceAccessFactory(resource=room, user=owner, role="owner")
    session = open_session(room, status)
    mock_data = mock.MagicMock()
    mock_data.room.name = str(room.id)

    service._handle_room_finished(mock_data)

    session.refresh_from_db()
    assert session.status == BreakoutSessionStatusChoices.CLOSED
    assert sorted(
        call.args[0].room for call in livekit.room.delete_room.await_args_list
    ) == [f"breakout_{session.id!s}_0", f"breakout_{session.id!s}_1"]
    mock_clear_cache.assert_called_once_with(room.id)

    livekit.room.list_rooms.return_value = mock.Mock(rooms=[mock.Mock(metadata="{}")])
    client = APIClient()
    client.force_login(owner)
    response = client.post(
        f"/api/v1.0/rooms/{room.id!s}/breakout-sessions/",
        {
            "rooms": [
                {"name": "A", "participants": [{"identity": "alice", "name": "Al"}]},
                {"name": "B", "participants": [{"identity": "bob", "name": "Bo"}]},
            ]
        },
        "json",
    )
    assert response.status_code == 201


@mock.patch.object(LobbyService, "clear_room_cache")
@mock.patch.object(SIPManagement, "delete_dispatch_rule")
def test_handle_room_finished_breakout_close_fails(
    mock_delete_dispatch_rule, mock_clear_cache, livekit, service
):
    """A close the media server refuses fails the event and leaves the split closing."""
    room = RoomFactory()
    session = open_session(room)
    livekit.room.delete_room.side_effect = TwirpError("internal", "boom", status=500)
    mock_data = mock.MagicMock()
    mock_data.room.name = str(room.id)

    with pytest.raises(ActionFailedError):
        service._handle_room_finished(mock_data)

    session.refresh_from_db()
    assert session.status == BreakoutSessionStatusChoices.CLOSING
    mock_clear_cache.assert_called_once_with(room.id)


@pytest.mark.parametrize("failing", ["sip", "lobby"])
@override_settings(ROOM_TELEPHONY_ENABLED=True)
@mock.patch.object(LobbyService, "clear_room_cache")
@mock.patch.object(SIPManagement, "delete_dispatch_rule")
def test_handle_room_finished_cleanup_fails_still_closes_breakout(
    mock_delete_dispatch_rule, mock_clear_cache, livekit, service, failing
):
    """A failed dispatch rule delete or lobby clear still closes the split."""
    if failing == "sip":
        mock_delete_dispatch_rule.side_effect = SIPException("boom")
    else:
        mock_clear_cache.side_effect = RuntimeError("boom")
    room = RoomFactory()
    session = open_session(room)
    mock_data = mock.MagicMock()
    mock_data.room.name = str(room.id)

    with pytest.raises(ActionFailedError):
        service._handle_room_finished(mock_data)

    session.refresh_from_db()
    assert session.status == BreakoutSessionStatusChoices.CLOSED
