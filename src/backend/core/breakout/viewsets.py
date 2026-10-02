"""API endpoints for breakout sessions, nested under a meeting."""

from django.contrib.auth.models import AnonymousUser
from django.db.models import prefetch_related_objects
from django.shortcuts import get_object_or_404
from django.urls.converters import UUIDConverter

from rest_framework import decorators, viewsets
from rest_framework import response as drf_response
from rest_framework import status as drf_status

from core import models
from core.api import permissions
from core.api.feature_flag import FeatureFlag
from core.authentication.livekit import LiveKitTokenAuthentication

from . import serializers, services


class BreakoutSessionViewSet(viewsets.GenericViewSet):
    """Open, list and close a meeting's breakout sessions, and move its participants.

    Every action answers 404 with the flag off to a caller its authentication and
    permissions let through. A session left open when the flag goes off still
    closes when its meeting ends.
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
        return drf_response.Response(self.get_serializer(session).data)

    @decorators.action(
        detail=False,
        methods=["post"],
        permission_classes=[permissions.HasLiveKitRoomAccess],
        authentication_classes=[LiveKitTokenAuthentication],
    )
    @FeatureFlag.require("breakout_rooms")
    def join(self, request, **kwargs):
        """The caller's room in the active session, with a pass to it.

        The caller proves who they are with their pass to the main meeting.
        """
        room = self.get_room()
        assignment = get_object_or_404(
            models.BreakoutAssignment.objects.select_related("breakout_room"),
            session__room=room,
            session__status=models.BreakoutSessionStatusChoices.ACTIVE,
            identity=request.auth.identity,
        )
        # A guest's pass can carry an account's sub: trust the account it was minted for.
        signed_in = (request.auth.attributes or {}).get("is_authenticated") == "true"
        user = request.user if signed_in else AnonymousUser()
        return drf_response.Response(services.join_pass(room, assignment, user))
