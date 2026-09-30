"""API endpoints for breakout sessions, nested under a meeting."""

from django.db.models import prefetch_related_objects
from django.shortcuts import get_object_or_404
from django.urls.converters import UUIDConverter

from rest_framework import decorators, viewsets
from rest_framework import permissions as drf_permissions
from rest_framework import response as drf_response
from rest_framework import status as drf_status

from core import models
from core.api import permissions
from core.api.feature_flag import FeatureFlag
from core.services.lobby import LobbyService

from . import serializers, services


class BreakoutSessionViewSet(viewsets.GenericViewSet):
    """Open, list and close a meeting's breakout sessions, and move its participants.

    Every action answers 404 with the flag off. A session left open when the
    flag goes off still closes when its meeting ends.
    """

    permission_classes = [permissions.HasPrivilegesOnRoom]
    serializer_class = serializers.BreakoutSessionSerializer
    lookup_value_regex = UUIDConverter.regex

    def get_queryset(self):
        """The sessions of the meeting in the URL, with their rooms and assignments."""
        return models.BreakoutSession.objects.filter(
            room_id=self.kwargs["room_id"]
        ).prefetch_related("rooms__assignments")

    def get_room(self):
        """The meeting in the URL, checked against the action's permissions."""
        room = get_object_or_404(models.Room, pk=self.kwargs["room_id"])
        self.check_object_permissions(self.request, room)
        return room

    def _get_assignment(self, room, **filters):
        """The caller's assignment in the meeting's active session, or 404."""
        request = self.request
        assignments = models.BreakoutAssignment.objects.select_related("breakout_room")
        if (
            not request.user.is_authenticated
            and LobbyService.read_guest_capability(request) is None
        ):
            # A guest without a capability was never assigned: 404 without a query.
            return get_object_or_404(assignments.none())
        return get_object_or_404(
            assignments,
            session__room=room,
            session__status=models.BreakoutSessionStatusChoices.ACTIVE,
            identity=LobbyService.participant_identity(request, room.id),
            **filters,
        )

    @FeatureFlag.require("breakout_rooms")
    def list(self, request, *args, **kwargs):
        """The meeting's open session, as a list of zero or one."""
        self.get_room()
        sessions = self.get_queryset().filter(status__in=models.OPEN_BREAKOUT_STATUSES)
        return drf_response.Response(self.get_serializer(sessions, many=True).data)

    @FeatureFlag.require("breakout_rooms")
    def create(self, request, *args, **kwargs):
        """Open a session with its rooms and assignments."""
        room = self.get_room()
        serializer = serializers.OpenBreakoutSessionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        session = services.open_session(
            room, request.user, serializer.validated_data["rooms"]
        )
        prefetch_related_objects([session], "rooms__assignments")
        return drf_response.Response(
            self.get_serializer(session).data, status=drf_status.HTTP_201_CREATED
        )

    @decorators.action(detail=True, methods=["post"])
    @FeatureFlag.require("breakout_rooms")
    def close(self, request, pk=None, **kwargs):
        """Close a session; closing it again answers the same."""
        self.get_room()
        session = services.close_session(get_object_or_404(self.get_queryset(), pk=pk))
        prefetch_related_objects([session], "rooms__assignments")
        return drf_response.Response(self.get_serializer(session).data)

    @decorators.action(
        detail=False,
        methods=["get"],
        url_path="current-assignment",
        permission_classes=[drf_permissions.AllowAny],
    )
    @FeatureFlag.require("breakout_rooms")
    def current_assignment(self, request, **kwargs):
        """Where the caller belongs in the active session."""
        assignment = self._get_assignment(self.get_room())
        return drf_response.Response(
            {
                "session_id": str(assignment.session_id),
                "room": {
                    "id": str(assignment.breakout_room_id),
                    "name": assignment.breakout_room.name,
                },
            }
        )

    @decorators.action(
        detail=True,
        methods=["post"],
        url_path=f"rooms/(?P<room_pk>{UUIDConverter.regex})/join",
        permission_classes=[drf_permissions.AllowAny],
    )
    @FeatureFlag.require("breakout_rooms")
    def join(self, request, pk=None, room_pk=None, **kwargs):
        """A pass to the breakout room the caller is assigned to."""
        room = self.get_room()
        assignment = self._get_assignment(room, session_id=pk, breakout_room_id=room_pk)
        return drf_response.Response(services.join_pass(room, assignment, request.user))
