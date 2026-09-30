"""
Test how the LiveKit webhook treats breakout rooms and their meeting.
"""
# pylint: disable=W0621,W0613,W0212

import uuid
from unittest import mock

import pytest

from core.factories import RoomFactory
from core.models import BreakoutSession, BreakoutSessionStatusChoices
from core.services.livekit_events import LiveKitEventsService, api
from core.services.lobby import LobbyService
from core.services.sip_management import SIPManagement

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
@mock.patch.object(LiveKitEventsService, "_handle_room_finished")
@mock.patch.object(LiveKitEventsService, "_handle_room_started")
def test_receive_ignores_breakout_room(
    mock_handle_room_started, mock_handle_room_finished, mock_receive, service
):
    """A breakout room is no meeting: its events are acknowledged and ignored."""
    mock_request = mock.MagicMock()
    mock_request.headers = {"Authorization": "test_token"}
    mock_data = mock.MagicMock()
    mock_data.room.name = f"breakout_{uuid.uuid4()}_0"
    mock_data.event = "room_started"
    mock_receive.return_value = mock_data

    service.receive(mock_request)

    mock_handle_room_started.assert_not_called()
    mock_handle_room_finished.assert_not_called()


@mock.patch.object(LobbyService, "clear_room_cache")
@mock.patch.object(SIPManagement, "delete_dispatch_rule")
def test_handle_room_finished_keeps_lobby_during_breakout(
    mock_delete_dispatch_rule, mock_clear_cache, service
):
    """Admissions outlive the main room while its people are in breakout rooms."""
    room = RoomFactory()
    session = BreakoutSession.objects.create(room=room)
    mock_data = mock.MagicMock()
    mock_data.room.name = str(room.id)

    service._handle_room_finished(mock_data)
    mock_clear_cache.assert_not_called()

    session.status = BreakoutSessionStatusChoices.CLOSED
    session.save()
    service._handle_room_finished(mock_data)
    mock_clear_cache.assert_called_once_with(room.id)
