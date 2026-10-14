"""Request bodies. Length caps keep junk out of the shared database."""

from datetime import date as Date

from pydantic import BaseModel, Field, HttpUrl, field_validator

def _strip(value):
    return value.strip() if isinstance(value, str) else value


class NameBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)

    _strip_name = field_validator("name", mode="before")(_strip)


class MemberUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    active: bool | None = None

    _strip_name = field_validator("name", mode="before")(_strip)


class ListUpdate(MemberUpdate):
    pass


class PlaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    link: HttpUrl | None = None
    notes: str | None = Field(default=None, max_length=300)

    _strip_text = field_validator("name", "notes", mode="before")(_strip)

    @field_validator("link", "notes", mode="before")
    @classmethod
    def _empty_is_none(cls, value):
        return None if value == "" else value


class PlaceUpdate(PlaceCreate):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    active: bool | None = None
    list_id: str | None = None


class VisitCreate(BaseModel):
    place_id: str
    # Defaults to today (in the app's timezone) when omitted.
    date: Date | None = None
    attendees: list[str] = Field(min_length=1, max_length=50)
