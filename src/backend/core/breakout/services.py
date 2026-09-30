"""Open and close breakout sessions, keeping the media server in step with the database."""

# pylint: disable=no-name-in-module

import asyncio
import contextlib
from datetime import timedelta
from logging import getLogger
from uuid import uuid4

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from asgiref.sync import async_to_sync
from livekit.api import CreateRoomRequest, DeleteRoomRequest, TwirpError
from rest_framework import exceptions

from core import models, utils
from core.services.room_management import (
    RoomManagement,
    RoomNotFoundException,
    bounded,
)

logger = getLogger(__name__)

METADATA_KEY = "breakout"
# How long the media server keeps a breakout room nobody has joined yet.
EMPTY_TIMEOUT_SECONDS = 300
# Closing deletes the rooms, and an unspent pass could recreate one until it expires.
JOIN_TOKEN_TTL = timedelta(seconds=60)


class SessionAlreadyActive(exceptions.APIException):
    """The meeting already has an active breakout session."""

    status_code = 409
    default_detail = _("This meeting already has an active breakout session.")


class MediaServerError(exceptions.APIException):
    """A media server call failed; the detail never carries the upstream error."""

    status_code = 503
    default_detail = _("The media server could not be reached. Try again.")


async def _delete_rooms(lkapi, names):
    """Delete media server rooms, a room already gone counting as deleted."""
    results = await asyncio.gather(
        *(
            bounded(lkapi.room.delete_room(DeleteRoomRequest(room=name)))
            for name in names
        ),
        return_exceptions=True,
    )
    for result in results:
        if isinstance(result, Exception) and not (
            isinstance(result, TwirpError) and result.code == "not_found"
        ):
            raise result


async def _create_rooms(lkapi, names):
    """Create media server rooms, deleting them all if any one fails."""
    results = await asyncio.gather(
        *(
            bounded(
                lkapi.room.create_room(
                    CreateRoomRequest(name=name, empty_timeout=EMPTY_TIMEOUT_SECONDS)
                )
            )
            for name in names
        ),
        return_exceptions=True,
    )
    errors = [result for result in results if isinstance(result, Exception)]
    if errors:
        await _delete_rooms(lkapi, names)
        raise errors[0]


def _run(step, *args):
    """Run one async step with its own client, turning any failure into a 503."""

    async def run():
        lkapi = utils.create_livekit_client()
        try:
            return await step(lkapi, *args)
        finally:
            await lkapi.aclose()

    try:
        return async_to_sync(run)()
    except Exception as error:
        logger.exception("Breakout media server step %s failed", step.__name__)
        raise MediaServerError() from error


def _write_signal(room_id, **changes):
    """Change the meeting's metadata through its one writer; False when it is not live."""
    try:
        RoomManagement.update_metadata(str(room_id), **changes)
    except RoomNotFoundException:
        return False
    except Exception as error:
        logger.exception("Breakout signal write to room %s failed", room_id)
        raise MediaServerError() from error
    return True


def _discard_rooms(names):
    """Best-effort cleanup; a room left behind expires after EMPTY_TIMEOUT_SECONDS."""
    try:
        _run(_delete_rooms, names)
    except MediaServerError:
        pass


def open_session(room, user, rooms):
    """Create the media server rooms, then the rows, then signal the meeting."""
    active = models.BreakoutSessionStatusChoices.ACTIVE
    if room.breakout_sessions.filter(status__in=models.OPEN_BREAKOUT_STATUSES).exists():
        raise SessionAlreadyActive()

    session_id = uuid4()
    names = [
        f"{models.BreakoutRoom.LIVEKIT_ROOM_PREFIX}{session_id}_{index}"
        for index in range(len(rooms))
    ]
    _run(_create_rooms, names)

    try:
        with transaction.atomic():
            session = models.BreakoutSession.objects.create(
                id=session_id, room=room, created_by=user
            )
            breakout_rooms = models.BreakoutRoom.objects.bulk_create(
                models.BreakoutRoom(
                    session=session,
                    name=data["name"],
                    livekit_room_name=name,
                    position=position,
                )
                for position, (data, name) in enumerate(zip(rooms, names, strict=True))
            )
            models.BreakoutAssignment.objects.bulk_create(
                models.BreakoutAssignment(
                    session=session,
                    breakout_room=breakout_room,
                    identity=participant["identity"],
                    name=participant["name"],
                )
                for data, breakout_room in zip(rooms, breakout_rooms, strict=True)
                for participant in data["participants"]
            )
    except Exception as error:
        _discard_rooms(names)
        if isinstance(error, (IntegrityError, ValidationError)):
            raise SessionAlreadyActive() from error
        raise

    signal = {"session_id": str(session.id), "status": active}
    try:
        is_live = _write_signal(room.id, metadata={METADATA_KEY: signal})
    except MediaServerError:
        is_live = False
        # A write cut off by its deadline may still have landed; take it back.
        with contextlib.suppress(MediaServerError):
            _write_signal(room.id, remove_keys=[METADATA_KEY])
    if not is_live:
        session.delete()
        _discard_rooms(names)
        raise MediaServerError()
    return session


def close_session(session):
    """Mark the session closing, remove the signal, delete the rooms, then mark it closed.

    Closing a closed session does nothing. A close that fails leaves the session
    closing, and closing it again runs the media server calls again.
    """
    statuses = models.BreakoutSessionStatusChoices
    models.BreakoutSession.objects.filter(pk=session.pk, status=statuses.ACTIVE).update(
        status=statuses.CLOSING, updated_at=timezone.now()
    )
    session.refresh_from_db(fields=["status", "closed_at", "updated_at"])
    if session.status == statuses.CLOSED:
        return session

    _write_signal(session.room_id, remove_keys=[METADATA_KEY])
    _run(_delete_rooms, list(session.rooms.values_list("livekit_room_name", flat=True)))

    session.status = statuses.CLOSED
    session.closed_at = timezone.now()
    session.save(update_fields=["status", "closed_at", "updated_at"])
    return session


def join_pass(room, assignment, user):
    """A member's pass to the participant's breakout room, publishing what room allows."""
    breakout_room = assignment.breakout_room
    return {
        "url": settings.LIVEKIT_CONFIGURATION["url"],
        "room": breakout_room.livekit_room_name,
        "token": utils.generate_token(
            room=breakout_room.livekit_room_name,
            user=user,
            username=assignment.name or None,
            sources=room.configuration.get("can_publish_sources"),
            role=models.RoleChoices.MEMBER,
            participant_id=assignment.identity,
            ttl=JOIN_TOKEN_TTL,
        ),
    }
