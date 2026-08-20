"""Test the room access level settings guards, run at boot."""

import pytest

from meet.settings import ROOM_ACCESS_LEVELS, validate_access_level_settings

from ..models import RoomAccessLevel


def test_settings_access_levels_mirror_the_model():
    """The levels settings validate against are the ones the model declares."""
    assert ROOM_ACCESS_LEVELS == RoomAccessLevel.values


def test_settings_access_levels_default_list_is_accepted():
    """The shipped defaults pass their own guard."""
    assert (
        validate_access_level_settings(ROOM_ACCESS_LEVELS, "public", "trusted") is None
    )


def test_settings_access_levels_reject_an_unknown_level():
    """A typo in the allow-list stops the boot instead of dropping a level."""
    with pytest.raises(ValueError, match="unknown access levels: restrcited"):
        validate_access_level_settings(["trusted", "restrcited"], "trusted", "trusted")


def test_settings_access_levels_reject_a_default_outside_the_list():
    """Rooms created without an access level would land outside the allow-list."""
    with pytest.raises(ValueError, match="RESOURCE_DEFAULT_ACCESS_LEVEL"):
        validate_access_level_settings(["trusted", "restricted"], "public", "trusted")


def test_settings_access_levels_reject_an_external_default_outside_the_list():
    """The external API creates rooms at its own default, which the list covers too."""
    with pytest.raises(ValueError, match="EXTERNAL_API_DEFAULT_ACCESS_LEVEL"):
        validate_access_level_settings(["restricted"], "restricted", "trusted")
