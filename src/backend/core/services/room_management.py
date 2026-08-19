"""Room management service for LiveKit rooms."""

# pylint: disable=no-name-in-module

import json
from logging import getLogger
from typing import Dict, Optional

import aiohttp
from asgiref.sync import async_to_sync
from livekit.api import (
    DeleteRoomRequest,
    ListParticipantsRequest,
    ListRoomsRequest,
    TwirpError,
    UpdateRoomMetadataRequest,
)
from livekit.protocol.models import ParticipantInfo

from core import utils

logger = getLogger(__name__)


# The kinds LiveKit itself leaves out of a room's participant count.
MACHINE_KINDS = frozenset({ParticipantInfo.Kind.AGENT, ParticipantInfo.Kind.EGRESS})


def _is_machine(participant: ParticipantInfo) -> bool:
    """Check whether a participant is a recorder, an agent, or a person."""
    return (
        participant.kind in MACHINE_KINDS
        or participant.permission.agent
        or participant.permission.recorder
    )


class RoomManagementException(Exception):
    """Exception raised when a room management operation fails."""


class RoomNotFoundException(RoomManagementException):
    """Raised when the target room does not exist in LiveKit."""


class RoomManagement:
    """Service for managing LiveKit rooms."""

    @async_to_sync
    async def update_metadata(
        self,
        room_name: str,
        metadata: Optional[Dict] = None,
        remove_keys: Optional[list[str]] = None,
    ):
        """Merge values into a LiveKit room's metadata.

        The `room_name` corresponds to the LiveKit room identifier
        (i.e. the Room model's UUID as a string).

        Raises:
            RoomNotFoundException: the room does not exist in LiveKit.
            RoomManagementException: the metadata update otherwise fails.
        """

        lkapi = utils.create_livekit_client()

        try:
            response = await lkapi.room.list_rooms(ListRoomsRequest(names=[room_name]))

            if not response.rooms:
                logger.warning(
                    "Room %s not found in LiveKit, skipping metadata update",
                    room_name,
                )
                raise RoomNotFoundException("Room does not exist")

            existing_metadata = json.loads(response.rooms[0].metadata or "{}")

            for key in remove_keys or []:
                existing_metadata.pop(key, None)

            updated_metadata = {**existing_metadata, **(metadata or {})}

            await lkapi.room.update_room_metadata(
                UpdateRoomMetadataRequest(
                    room=room_name,
                    metadata=json.dumps(updated_metadata),
                )
            )

        except TwirpError as e:
            if e.code == "not_found":
                logger.warning(
                    "Room %s not found in LiveKit, skipping metadata update",
                    room_name,
                )
                raise RoomNotFoundException("Room does not exist") from e

            logger.exception(
                "Unexpected error updating metadata for room %s",
                room_name,
            )
            raise RoomManagementException("Could not update room metadata") from e

        finally:
            await lkapi.aclose()

    @async_to_sync
    async def get_participants(self, room_name: str) -> list[str]:
        """Name each person currently in a LiveKit room.

        Someone who gave no display name is in the list as an empty string, so a
        caller counts them without naming them. Agents and recorders are left
        out, which is the rule LiveKit applies to the count it reports for a
        room itself.

        Raises:
            RoomManagementException: the room could not be read.
        """

        lkapi = utils.create_livekit_client()

        try:
            response = await lkapi.room.list_participants(
                ListParticipantsRequest(room=room_name)
            )

        # A LiveKit outage would otherwise surface as a 500 on every poll of the
        # join screen, so the connection error is turned into the same failure
        # as a refusal.
        except (TwirpError, aiohttp.ClientError) as e:
            if isinstance(e, TwirpError) and e.code == "not_found":
                # LiveKit creates a room when its first participant joins, so a
                # name it does not know has nobody in it.
                return []

            logger.exception("Unexpected error listing participants of %s", room_name)
            raise RoomManagementException("Could not list participants") from e

        finally:
            await lkapi.aclose()

        return [
            participant.name
            for participant in response.participants
            if not _is_machine(participant)
        ]

    @async_to_sync
    async def delete_room(self, room_name: str):
        """Delete a LiveKit room and disconnect all participants.

        Raises:
            RoomNotFoundException: the room does not exist in LiveKit.
            RoomManagementException: the deletion otherwise fails.
        """

        lkapi = utils.create_livekit_client()

        try:
            await lkapi.room.delete_room(DeleteRoomRequest(room=room_name))
            logger.info("Deleted LiveKit room %s", room_name)
        except TwirpError as e:
            if e.code == "not_found":
                logger.warning(
                    "Room %s not found in LiveKit, skipping deletion",
                    room_name,
                )
                raise RoomNotFoundException("Room does not exist") from e

            logger.exception("Unexpected error deleting room %s", room_name)
            raise RoomManagementException("Could not delete room") from e
        finally:
            await lkapi.aclose()
