"""
Test breakout sessions API endpoints in the Meet core app.
"""

# pylint: disable=W0621,W0613
import asyncio
import json
import time
from unittest import mock

from django.conf import settings
from django.contrib.auth.models import AnonymousUser
from django.db import IntegrityError

import jwt
import pytest
from asgiref.sync import sync_to_async
from livekit.api import TwirpError
from livekit.protocol.models import ParticipantInfo
from rest_framework.test import APIClient

from core import models, utils
from core.breakout import services
from core.factories import RoomFactory, UserFactory, UserResourceAccessFactory
from core.services import room_management
from core.services.lobby import LobbyService
from core.tests.guests import guest_request

pytestmark = pytest.mark.django_db

ACTIVE = models.BreakoutSessionStatusChoices.ACTIVE
CLOSING = models.BreakoutSessionStatusChoices.CLOSING
CLOSED = models.BreakoutSessionStatusChoices.CLOSED


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
    with mock.patch.object(
        services.utils, "create_livekit_client", return_value=client
    ):
        yield client


def logged_in(room, role=None):
    """A new user, holding role in the meeting if given, and a client logged in as them."""
    user = UserFactory()
    if role:
        UserResourceAccessFactory(resource=room, user=user, role=role)
    client = APIClient()
    client.force_login(user)
    return user, client


@pytest.fixture
def owner_room():
    """A meeting and an API client logged in as its owner."""
    room = RoomFactory(configuration={"can_publish_sources": ["microphone"]})
    _owner, client = logged_in(room, "owner")
    return room, client


def url(room, suffix=""):
    """The breakout sessions URL of a meeting."""
    return f"/api/v1.0/rooms/{room.id!s}/breakout-sessions/{suffix}"


def payload(*room_participants):
    """A split with one room per list of identities."""
    return {
        "rooms": [
            {
                "name": f"Room {index + 1}",
                "participants": [
                    {"identity": identity, "name": identity.title()}
                    for identity in identities
                ],
            }
            for index, identities in enumerate(room_participants)
        ]
    }


def make_session(room, *room_participants):
    """Rows of an active session, without the media server."""
    session = models.BreakoutSession.objects.create(room=room)
    for index, identities in enumerate(room_participants):
        breakout_room = models.BreakoutRoom.objects.create(
            session=session,
            name=f"Room {index + 1}",
            livekit_room_name=f"breakout_{session.id!s}_{index}",
            position=index,
        )
        for identity in identities:
            models.BreakoutAssignment.objects.create(
                session=session, breakout_room=breakout_room, identity=identity
            )
    return session


def written_metadata(livekit):
    """The metadata of the last write to the main room."""
    request = livekit.room.update_room_metadata.await_args.args[0]
    return json.loads(request.metadata)


def guest_client(room):
    """A guest's client carrying a signed capability, and its identity in the room."""
    cookie = LobbyService.sign_guest_capability("capability")
    client = APIClient()
    client.cookies[settings.LOBBY_COOKIE_NAME] = cookie
    replay = guest_request(cookie)
    return client, LobbyService.get_or_create_participant_id(replay, room.id)


# Create


def test_api_breakout_sessions_create_owner(livekit, owner_room):
    """The owner opens rooms on the media server, then rows, then the signal."""
    room, client = owner_room

    response = client.post(url(room), payload(["alice"], ["bob", "carol"]), "json")

    assert response.status_code == 201
    session = models.BreakoutSession.objects.get()
    assert session.status == ACTIVE
    assert response.json()["rooms"] == [
        {
            "id": str(breakout_room.id),
            "name": breakout_room.name,
            "participants": [
                {"identity": a.identity, "name": a.name}
                for a in breakout_room.assignments.all()
            ],
        }
        for breakout_room in session.rooms.all()
    ]
    assert [r["name"] for r in response.json()["rooms"]] == ["Room 1", "Room 2"]
    created = [call.args[0] for call in livekit.room.create_room.await_args_list]
    assert sorted(request.name for request in created) == [
        f"breakout_{session.id!s}_0",
        f"breakout_{session.id!s}_1",
    ]
    assert all(request.empty_timeout == 300 for request in created)
    assert written_metadata(livekit) == {
        "access_level": "public",
        "breakout": {"session_id": str(session.id), "status": "active"},
    }
    livekit.room.delete_room.assert_not_awaited()


@pytest.mark.parametrize("role", [None, "member"])
def test_api_breakout_sessions_create_not_manager(livekit, role):
    """Only the meeting's owner or administrators open a session."""
    room = RoomFactory()
    client = logged_in(room, role)[1] if role else APIClient()

    response = client.post(url(room), payload(["alice"], ["bob"]), "json")

    assert response.status_code == (401 if role is None else 403)
    assert not models.BreakoutSession.objects.exists()
    livekit.room.create_room.assert_not_awaited()


@pytest.mark.parametrize(
    "rooms",
    [
        [["alice"]],
        [[f"p{index}"] for index in range(21)],
        [["alice"], ["alice"]],
    ],
)
def test_api_breakout_sessions_create_invalid(livekit, owner_room, rooms):
    """Two to twenty rooms, and one room per participant."""
    room, client = owner_room

    response = client.post(url(room), payload(*rooms), "json")

    assert response.status_code == 400
    livekit.room.create_room.assert_not_awaited()


def test_api_breakout_sessions_create_twenty_rooms(livekit, owner_room):
    """Twenty rooms, the most a split takes, are all opened."""
    room, client = owner_room

    response = client.post(
        url(room), payload(*([f"p{index}"] for index in range(20))), "json"
    )

    assert response.status_code == 201
    assert models.BreakoutRoom.objects.count() == 20
    assert livekit.room.create_room.await_count == 20


def test_api_breakout_sessions_create_long_name(livekit, owner_room):
    """A name longer than the column, which joining accepts, is cut, not refused."""
    room, client = owner_room
    split = payload(["alice"], ["bob"])
    split["rooms"][0]["participants"][0]["name"] = "x" * 300

    response = client.post(url(room), split, "json")

    assert response.status_code == 201
    assert models.BreakoutAssignment.objects.get(identity="alice").name == "x" * 255


def test_api_breakout_sessions_create_already_active(livekit, owner_room):
    """A second session is refused before the media server is called."""
    room, client = owner_room
    make_session(room, ["alice"])

    response = client.post(url(room), payload(["alice"], ["bob"]), "json")

    assert response.status_code == 409
    livekit.room.create_room.assert_not_awaited()


def test_api_breakout_sessions_create_while_closing(livekit, owner_room):
    """A session still closing holds the meeting: a new one answers 409."""
    room, client = owner_room
    make_session(room, ["alice"])
    models.BreakoutSession.objects.update(status=CLOSING)

    response = client.post(url(room), payload(["alice"], ["bob"]), "json")

    assert response.status_code == 409
    livekit.room.create_room.assert_not_awaited()


def test_api_breakout_sessions_create_media_server_fails(livekit, owner_room):
    """A room the media server refuses deletes the others and leaks nothing."""
    room, client = owner_room
    livekit.room.create_room.side_effect = [
        None,
        TwirpError("internal", "dial tcp livekit.internal:7880", status=500),
    ]

    response = client.post(url(room), payload(["alice"], ["bob"]), "json")

    assert response.status_code == 503
    assert "livekit.internal" not in response.content.decode()
    assert livekit.room.delete_room.await_count == 2
    assert not models.BreakoutSession.objects.exists()


def test_api_breakout_sessions_create_rows_fail(livekit, owner_room):
    """Rows that cannot be written delete the media server rooms."""
    room, client = owner_room

    with mock.patch.object(
        models.BreakoutAssignment.objects, "bulk_create", side_effect=IntegrityError
    ):
        response = client.post(url(room), payload(["alice"], ["bob"]), "json")

    assert response.status_code == 409
    assert livekit.room.delete_room.await_count == 2
    assert not models.BreakoutSession.objects.exists()


@pytest.mark.parametrize("main_room_live", [True, False])
def test_api_breakout_sessions_create_signal_fails(livekit, owner_room, main_room_live):
    """Without the signal nobody moves, so the session is undone."""
    room, client = owner_room
    if main_room_live:
        livekit.room.update_room_metadata.side_effect = TimeoutError
    else:
        livekit.room.list_rooms.return_value = mock.Mock(rooms=[])

    response = client.post(url(room), payload(["alice"], ["bob"]), "json")

    assert response.status_code == 503
    assert livekit.room.delete_room.await_count == 2
    assert not models.BreakoutSession.objects.exists()


def test_api_breakout_sessions_create_signal_times_out_after_landing(
    livekit, owner_room
):
    """A signal write that times out is taken back, in case it landed."""
    room, client = owner_room
    livekit.room.update_room_metadata.side_effect = [TimeoutError, None]

    response = client.post(url(room), payload(["alice"], ["bob"]), "json")

    assert response.status_code == 503
    assert livekit.room.update_room_metadata.await_count == 2
    assert written_metadata(livekit) == {"access_level": "public"}
    assert not models.BreakoutSession.objects.exists()


def test_api_breakout_sessions_create_races_another_open(livekit, owner_room):
    """An Open landing during this one's media server calls wins; this one is undone."""
    room, client = owner_room
    run = services._run  # pylint: disable=protected-access
    competing = []

    def run_then_compete(step, *args):
        result = run(step, *args)
        if step is services._create_rooms:  # pylint: disable=protected-access
            competing.append(make_session(room, ["carol"]))
        return result

    with mock.patch.object(services, "_run", side_effect=run_then_compete):
        response = client.post(url(room), payload(["alice"], ["bob"]), "json")

    assert response.status_code == 409
    created = {c.args[0].name for c in livekit.room.create_room.await_args_list}
    deleted = {c.args[0].room for c in livekit.room.delete_room.await_args_list}
    assert len(created) == 2 and deleted == created
    assert list(models.BreakoutSession.objects.all()) == competing
    livekit.room.update_room_metadata.assert_not_awaited()


def test_api_breakout_sessions_media_server_call_is_bounded(livekit, owner_room):
    """A media server that never answers costs one deadline, not a worker."""
    room, client = owner_room

    async def hang(*args, **kwargs):
        await asyncio.sleep(60)

    livekit.room.create_room.side_effect = hang
    livekit.room.delete_room.side_effect = hang

    started = time.monotonic()
    with mock.patch.object(room_management, "MEDIA_SERVER_TIMEOUT_SECONDS", 0.05):
        response = client.post(url(room), payload(["alice"], ["bob"]), "json")

    assert time.monotonic() - started < 10
    assert response.status_code == 503
    assert not models.BreakoutSession.objects.exists()


# List


def test_api_breakout_sessions_list(livekit, owner_room):
    """The owner reads the open session only."""
    room, client = owner_room
    make_session(room, ["alice"])
    models.BreakoutSession.objects.update(status=CLOSED)
    session = make_session(room, ["alice"], ["bob"])

    response = client.get(url(room))

    assert response.status_code == 200
    assert [s["id"] for s in response.json()] == [str(session.id)]
    assert [
        [p["identity"] for p in r["participants"]] for r in response.json()[0]["rooms"]
    ] == [["alice"], ["bob"]]

    models.BreakoutSession.objects.filter(pk=session.pk).update(status=CLOSING)
    response = client.get(url(room))
    assert [(s["id"], s["status"]) for s in response.json()] == [
        (str(session.id), "closing")
    ]


def test_api_breakout_sessions_list_empty_and_member(livekit, owner_room):
    """No session reads as an empty list, and a member reads nothing."""
    room, client = owner_room
    assert client.get(url(room)).json() == []

    _member, member_client = logged_in(room, "member")
    assert member_client.get(url(room)).status_code == 403


# Close


def test_api_breakout_sessions_close(livekit, owner_room):
    """Close removes the signal, deletes the rooms, and a second close answers 200."""
    room, client = owner_room
    session = make_session(room, ["alice"], ["bob"])

    response = client.post(url(room, f"{session.id!s}/close/"))

    assert response.status_code == 200
    assert response.json()["status"] == "closed"
    session.refresh_from_db()
    assert session.status == CLOSED
    assert session.closed_at is not None
    assert written_metadata(livekit) == {"access_level": "public"}
    assert sorted(
        call.args[0].room for call in livekit.room.delete_room.await_args_list
    ) == [f"breakout_{session.id!s}_0", f"breakout_{session.id!s}_1"]

    livekit.reset_mock()
    assert client.post(url(room, f"{session.id!s}/close/")).status_code == 200
    livekit.room.delete_room.assert_not_awaited()
    livekit.room.update_room_metadata.assert_not_awaited()


def test_api_breakout_sessions_close_room_already_gone(livekit, owner_room):
    """A room the media server already dropped counts as deleted."""
    room, client = owner_room
    session = make_session(room, ["alice"], ["bob"])
    livekit.room.delete_room.side_effect = TwirpError("not_found", "gone", status=404)

    response = client.post(url(room, f"{session.id!s}/close/"))

    assert response.status_code == 200


def test_api_breakout_sessions_close_fails_then_retries(livekit, owner_room):
    """A failed delete leaves the session closing, and closing again finishes it."""
    room, client = owner_room
    session = make_session(room, ["alice"], ["bob"])
    livekit.room.delete_room.side_effect = TwirpError(
        "internal", "livekit.internal refused", status=500
    )

    response = client.post(url(room, f"{session.id!s}/close/"))

    assert response.status_code == 503
    assert "livekit.internal" not in response.content.decode()
    assert [s["status"] for s in client.get(url(room)).json()] == ["closing"]

    livekit.room.delete_room.side_effect = None
    livekit.room.delete_room.reset_mock()
    response = client.post(url(room, f"{session.id!s}/close/"))

    assert response.status_code == 200
    assert response.json()["status"] == "closed"
    assert livekit.room.delete_room.await_count == 2
    assert client.get(url(room)).json() == []


def test_api_breakout_sessions_close_signal_fails_then_retries(livekit, owner_room):
    """A signal removal that fails leaves the session closing with its rooms kept."""
    room, client = owner_room
    session = make_session(room, ["alice"], ["bob"])
    livekit.room.update_room_metadata.side_effect = TimeoutError

    response = client.post(url(room, f"{session.id!s}/close/"))

    assert response.status_code == 503
    assert [s["status"] for s in client.get(url(room)).json()] == ["closing"]
    livekit.room.delete_room.assert_not_awaited()

    livekit.room.update_room_metadata.side_effect = None
    response = client.post(url(room, f"{session.id!s}/close/"))

    assert response.status_code == 200
    assert response.json()["status"] == "closed"
    assert livekit.room.delete_room.await_count == 2


def test_api_breakout_sessions_join_during_close(livekit, owner_room):
    """Closing is written before any media server call: join 404s, Open 409s."""
    room, client = owner_room
    user, member_client = logged_in(room)
    session = make_session(room, [str(user.sub)], ["bob"])
    own = session.rooms.get(name="Room 1")
    during = {}

    def compete():
        join = url(room, f"{session.id!s}/rooms/{own.id!s}/join/")
        during["join"] = member_client.post(join).status_code
        during["assignment"] = member_client.get(
            url(room, "current-assignment/")
        ).status_code
        during["open"] = client.post(
            url(room), payload(["carol"], ["dave"]), "json"
        ).status_code

    list_rooms = livekit.room.list_rooms.return_value

    async def compete_then_list(*args, **kwargs):
        if not during:
            await sync_to_async(compete)()
        return list_rooms

    livekit.room.list_rooms.side_effect = compete_then_list

    response = client.post(url(room, f"{session.id!s}/close/"))

    assert response.status_code == 200
    assert during == {"join": 404, "assignment": 404, "open": 409}


@pytest.mark.parametrize("main_room_live", [True, False])
@mock.patch.object(LobbyService, "clear_room_cache")
def test_api_breakout_sessions_close_lobby_admissions(
    mock_clear, livekit, owner_room, main_room_live
):
    """Close leaves the meeting's admissions alone, live or not."""
    room, client = owner_room
    session = make_session(room, ["alice"], ["bob"])
    if not main_room_live:
        livekit.room.list_rooms.return_value = mock.Mock(rooms=[])

    response = client.post(url(room, f"{session.id!s}/close/"))

    assert response.status_code == 200
    mock_clear.assert_not_called()


def test_api_breakout_sessions_close_member(livekit, owner_room):
    """A member cannot close a session."""
    room, _client = owner_room
    session = make_session(room, ["alice"], ["bob"])
    _member, client = logged_in(room, "member")

    response = client.post(url(room, f"{session.id!s}/close/"))

    assert response.status_code == 403
    livekit.room.delete_room.assert_not_awaited()


# Flag


def test_api_breakout_sessions_flag_off(livekit, owner_room, settings):
    """Flag off, every call answers 404, close included."""
    settings.BREAKOUT_ROOMS_ENABLED = False
    room, client = owner_room
    session = make_session(room, ["alice"], ["bob"])
    breakout_room = session.rooms.first()

    assert client.get(url(room)).status_code == 404
    assert client.post(url(room), payload(["a"], ["b"]), "json").status_code == 404
    assert client.get(url(room, "current-assignment/")).status_code == 404
    join = f"{session.id!s}/rooms/{breakout_room.id!s}/join/"
    assert client.post(url(room, join)).status_code == 404
    assert client.post(url(room, f"{session.id!s}/close/")).status_code == 404
    livekit.room.create_room.assert_not_awaited()
    livekit.room.delete_room.assert_not_awaited()
    session.refresh_from_db()
    assert session.status == ACTIVE


# Current assignment and join


def test_api_breakout_sessions_current_assignment_user(livekit):
    """A signed-in participant finds their room by their sub."""
    room = RoomFactory()
    user, client = logged_in(room)
    session = make_session(room, ["alice"], [str(user.sub)])

    response = client.get(url(room, "current-assignment/"))

    breakout_room = session.rooms.get(name="Room 2")
    assert response.status_code == 200
    assert response.json() == {
        "session_id": str(session.id),
        "room": {"id": str(breakout_room.id), "name": "Room 2"},
    }


def test_api_breakout_sessions_current_assignment_guest(livekit):
    """A guest finds their room by the identity their signed cookie gives."""
    room = RoomFactory()
    client, identity = guest_client(room)
    session = make_session(room, [identity], ["bob"])

    response = client.get(url(room, "current-assignment/"))

    assert response.status_code == 200
    assert response.json()["room"]["id"] == str(session.rooms.get(name="Room 1").id)
    assert APIClient().get(url(room, "current-assignment/")).status_code == 404


def test_api_breakout_sessions_current_assignment_closed(livekit):
    """A closed session assigns nobody."""
    room = RoomFactory()
    user, client = logged_in(room)
    make_session(room, [str(user.sub)], ["bob"])
    models.BreakoutSession.objects.update(status=CLOSED)

    assert client.get(url(room, "current-assignment/")).status_code == 404


def test_api_breakout_sessions_join(livekit):
    """The assigned participant gets a short member pass to that room only."""
    room = RoomFactory(configuration={"can_publish_sources": ["microphone"]})
    user, client = logged_in(room, "owner")
    session = make_session(room, [str(user.sub)], ["bob"])
    own, other = session.rooms.all()

    response = client.post(url(room, f"{session.id!s}/rooms/{own.id!s}/join/"))

    assert response.status_code == 200
    data = response.json()
    assert data["url"] == settings.LIVEKIT_CONFIGURATION["url"]
    assert data["room"] == own.livekit_room_name
    claims = jwt.decode(
        data["token"],
        settings.LIVEKIT_CONFIGURATION["api_secret"],
        algorithms=["HS256"],
    )
    assert claims["sub"] == str(user.sub)
    assert claims["exp"] - claims["nbf"] == 60
    assert claims["video"]["room"] == own.livekit_room_name
    assert claims["video"].get("roomAdmin", False) is False
    assert claims["video"]["canPublishSources"] == ["microphone"]
    assert claims["attributes"]["room_role"] == "member"

    other_join = url(room, f"{session.id!s}/rooms/{other.id!s}/join/")
    assert client.post(other_join).status_code == 404


def test_api_breakout_sessions_join_guest(livekit):
    """A guest joins with the identity they hold in the meeting."""
    room = RoomFactory()
    client, identity = guest_client(room)
    session = make_session(room, [identity])
    breakout_room = session.rooms.get()

    response = client.post(
        url(room, f"{session.id!s}/rooms/{breakout_room.id!s}/join/")
    )

    assert response.status_code == 200
    claims = jwt.decode(response.json()["token"], options={"verify_signature": False})
    assert claims["sub"] == identity


# Removing a participant


def remove(room, host, identity):
    """The host removes an identity from the meeting."""
    return host.post(
        f"/api/v1.0/rooms/{room.id!s}/remove-participant/",
        {"participant_identity": identity},
        format="json",
    )


@pytest.mark.parametrize("signed_in", [False, True])
def test_api_breakout_sessions_removed_participant_loses_room(
    livekit, owner_room, signed_in
):
    """Someone the host removes can neither find nor join their breakout room."""
    room, host = owner_room
    if signed_in:
        user, client = logged_in(room)
        identity = str(user.sub)
    else:
        client, identity = guest_client(room)
    session = make_session(room, [identity], ["bob"])
    own = session.rooms.get(name="Room 1")
    livekit.room.remove_participant = mock.AsyncMock()

    assert remove(room, host, identity).status_code == 200

    assert client.get(url(room, "current-assignment/")).status_code == 404
    join = url(room, f"{session.id!s}/rooms/{own.id!s}/join/")
    assert client.post(join).status_code == 404
    assert list(session.assignments.values_list("identity", flat=True)) == ["bob"]


def test_api_breakout_sessions_remove_participant_in_breakout_room(livekit, owner_room):
    """Removing someone in a breakout room takes them out of it."""
    room, host = owner_room
    session = make_session(room, ["alice"], ["bob"])
    own = session.rooms.get(name="Room 2")

    async def remove_participant(request):
        if request.room != own.livekit_room_name:
            raise TwirpError("not_found", "not in this room", status=404)

    livekit.room.remove_participant = mock.AsyncMock(side_effect=remove_participant)

    assert remove(room, host, "bob").status_code == 200

    asked = {
        call.args[0].room for call in livekit.room.remove_participant.await_args_list
    }
    assert asked == {
        str(room.id),
        *session.rooms.values_list("livekit_room_name", flat=True),
    }


def test_api_breakout_sessions_remove_participant_retries(livekit, owner_room):
    """A removal the media server fails answers 503, and a retry still finds them."""
    room, host = owner_room
    session = make_session(room, ["alice"])
    own = session.rooms.get()
    failures = [TwirpError("internal", "boom", status=500)]

    async def remove_participant(request):
        if request.room != own.livekit_room_name:
            raise TwirpError("not_found", "not in this room", status=404)
        if failures:
            raise failures.pop()

    livekit.room.remove_participant = mock.AsyncMock(side_effect=remove_participant)

    assert remove(room, host, "alice").status_code == 503
    assert not session.assignments.exists()
    assert remove(room, host, "alice").status_code == 200


# Muting and subtitles inside a breakout room


def pass_for(room, identity):
    """A main-meeting pass for identity, as a browser in a breakout room holds it."""
    return utils.generate_token(str(room.id), AnonymousUser(), participant_id=identity)


def mute(room, token, breakout_room_id):
    """Mute bob's microphone, addressing a breakout room."""
    return APIClient().post(
        f"/api/v1.0/rooms/{room.id!s}/mute-participant/",
        {
            "participant_identity": "bob",
            "track_sid": "TR_mic",
            "breakout_room_id": str(breakout_room_id),
        },
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )


def test_api_breakout_sessions_mute_in_breakout_room(livekit):
    """The caller's presence is checked, and the track muted, in their breakout room."""
    room = RoomFactory()
    session = make_session(room, ["alice", "bob"])
    own = session.rooms.get()
    livekit.room.get_participant = mock.AsyncMock(
        return_value=ParticipantInfo(
            identity="alice", state=ParticipantInfo.State.ACTIVE
        )
    )
    livekit.room.mute_published_track = mock.AsyncMock()

    response = mute(room, pass_for(room, "alice"), own.id)

    assert response.status_code == 200
    assert livekit.room.get_participant.await_args.args[0].room == own.livekit_room_name
    muted = livekit.room.mute_published_track.await_args.args[0]
    assert (muted.room, muted.identity) == (own.livekit_room_name, "bob")


@pytest.mark.parametrize("which", ["closing", "other meeting"])
def test_api_breakout_sessions_mute_outside_active_split(livekit, which):
    """A breakout room of a closing split or of another meeting is not found."""
    room = RoomFactory()
    other = room if which == "closing" else RoomFactory()
    session = make_session(other, ["alice", "bob"])
    if which == "closing":
        models.BreakoutSession.objects.update(status=CLOSING)
    livekit.room.get_participant = mock.AsyncMock(
        return_value=ParticipantInfo(
            identity="alice", state=ParticipantInfo.State.ACTIVE
        )
    )
    livekit.room.mute_published_track = mock.AsyncMock()

    response = mute(room, pass_for(room, "alice"), session.rooms.get().id)

    assert response.status_code == 404
    livekit.room.mute_published_track.assert_not_awaited()


@pytest.mark.parametrize("status", ["active", "closing"])
def test_api_breakout_sessions_raise_hand_in_breakout_room(livekit, status):
    """A hand goes up in the caller's breakout room, and only while the split is active."""
    room = RoomFactory()
    session = make_session(room, ["alice"])
    own = session.rooms.get()
    if status == "closing":
        models.BreakoutSession.objects.update(status=CLOSING)
    livekit.room.update_participant = mock.AsyncMock()

    response = APIClient().post(
        f"/api/v1.0/rooms/{room.id!s}/toggle-hand/",
        {"raised": True, "breakout_room_id": str(own.id)},
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {pass_for(room, 'alice')}",
    )

    if status == "closing":
        assert response.status_code == 404
        livekit.room.update_participant.assert_not_awaited()
        return
    assert response.status_code == 200
    update = livekit.room.update_participant.await_args.args[0]
    assert (update.room, update.identity) == (own.livekit_room_name, "alice")
    assert update.attributes["handRaisedAt"]


def test_api_breakout_sessions_start_subtitle_in_breakout_room(livekit, settings):
    """Subtitles start in the caller's breakout room, and only a member of it starts them."""
    settings.ROOM_SUBTITLE_ENABLED = True
    room = RoomFactory()
    session = make_session(room, ["alice"], ["bob"])
    own = session.rooms.get(name="Room 1")
    livekit.agent_dispatch.create_dispatch = mock.AsyncMock()

    def start(identity):
        return APIClient().post(
            f"/api/v1.0/rooms/{room.id!s}/start-subtitle/",
            {"breakout_room_id": str(own.id)},
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {pass_for(room, identity)}",
        )

    assert start("alice").status_code == 200
    dispatch = livekit.agent_dispatch.create_dispatch.await_args.args[0]
    assert dispatch.room == own.livekit_room_name

    livekit.agent_dispatch.create_dispatch.reset_mock()
    assert start("bob").status_code == 403
    livekit.agent_dispatch.create_dispatch.assert_not_awaited()


# Passes of browsers that can move


@pytest.mark.parametrize("query, assignable", [("?breakout=1", True), ("", False)])
def test_api_breakout_sessions_pass_marks_a_browser_that_can_move(query, assignable):
    """Only a browser asking for it gets a pass the host's panel can assign."""
    room = RoomFactory(access_level=models.RoomAccessLevel.PUBLIC)
    client = APIClient()
    base = f"/api/v1.0/rooms/{room.id!s}/"

    retrieved = client.get(f"{base}{query}")
    entered = client.post(
        f"{base}request-entry/{query}", {"username": "Ann"}, format="json"
    )

    for response in (retrieved, entered):
        assert response.status_code == 200
        token = response.json()["livekit"]["token"]
        claims = jwt.decode(token, options={"verify_signature": False})
        assert (claims["attributes"].get("breakout") == "true") is assignable
