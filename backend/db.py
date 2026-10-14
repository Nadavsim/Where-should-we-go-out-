"""MongoDB access. Every document belongs to one circle (a friend group);
every query is scoped by circle_id so one group can never see another's data.

Removing a member, list or place only marks it inactive - its visit history
is kept, so a wrong tap can be undone and old visits still mean something.
"""

import os
import secrets
from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from .ranking import DEFAULT_NEVER_DAYS

load_dotenv()

MONGODB_URI = os.environ.get("MONGODB_URI", "")
MONGODB_DB_NAME = os.environ.get("MONGODB_DB_NAME", "wsgo")

_client: AsyncIOMotorClient | None = None


def set_client(client) -> None:
    """Swap in a different client (tests use mongomock-motor)."""
    global _client
    _client = client


def get_db() -> AsyncIOMotorDatabase:
    global _client
    if _client is None:
        if not MONGODB_URI:
            raise RuntimeError("MONGODB_URI is not set")
        _client = AsyncIOMotorClient(MONGODB_URI)
    return _client[MONGODB_DB_NAME]


def to_object_id(value: str) -> ObjectId | None:
    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        return None


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def ensure_indexes() -> None:
    db = get_db()
    await db.circles.create_index("token", unique=True)
    await db.lists.create_index("circle_id")
    await db.places.create_index([("circle_id", 1), ("list_id", 1)])
    await db.visits.create_index([("circle_id", 1), ("place_id", 1), ("date", -1)])


async def ping() -> bool:
    try:
        await get_db().command("ping")
        return True
    except Exception:
        return False


# --- circles & members ---------------------------------------------------


def new_token() -> str:
    # 128 bits: the token in the share link is the group's only key.
    return secrets.token_urlsafe(16)


async def create_circle(name: str, member_names: list[str], never_days: int = DEFAULT_NEVER_DAYS) -> dict:
    doc = {
        "name": name,
        "token": new_token(),
        "members": [{"id": str(ObjectId()), "name": n, "active": True} for n in member_names],
        "never_days": never_days,
        "created_at": _now(),
    }
    result = await get_db().circles.insert_one(doc)
    doc["_id"] = result.inserted_id
    return doc


async def get_circle_by_token(token: str) -> dict | None:
    return await get_db().circles.find_one({"token": token})


async def add_member(circle_id: ObjectId, name: str) -> dict:
    member = {"id": str(ObjectId()), "name": name, "active": True}
    await get_db().circles.update_one({"_id": circle_id}, {"$push": {"members": member}})
    return member


async def update_member(circle_id: ObjectId, member_id: str, changes: dict) -> bool:
    update = {f"members.$.{k}": v for k, v in changes.items()}
    result = await get_db().circles.update_one(
        {"_id": circle_id, "members.id": member_id}, {"$set": update}
    )
    return result.matched_count == 1


# --- lists ---------------------------------------------------------------


async def get_lists(circle_id: ObjectId, include_inactive: bool = False) -> list[dict]:
    query: dict = {"circle_id": circle_id}
    if not include_inactive:
        query["active"] = True
    return await get_db().lists.find(query).sort("created_at", 1).to_list(None)


async def get_list(circle_id: ObjectId, list_id: ObjectId) -> dict | None:
    return await get_db().lists.find_one({"_id": list_id, "circle_id": circle_id})


async def create_list(circle_id: ObjectId, name: str) -> dict:
    doc = {"circle_id": circle_id, "name": name, "active": True, "created_at": _now()}
    result = await get_db().lists.insert_one(doc)
    doc["_id"] = result.inserted_id
    return doc


async def update_list(circle_id: ObjectId, list_id: ObjectId, changes: dict) -> bool:
    result = await get_db().lists.update_one(
        {"_id": list_id, "circle_id": circle_id}, {"$set": changes}
    )
    return result.matched_count == 1


# --- places --------------------------------------------------------------


async def get_places(
    circle_id: ObjectId, list_id: ObjectId | None = None, include_inactive: bool = False
) -> list[dict]:
    query: dict = {"circle_id": circle_id}
    if list_id is not None:
        query["list_id"] = list_id
    if not include_inactive:
        query["active"] = True
    return await get_db().places.find(query).sort("created_at", 1).to_list(None)


async def get_place(circle_id: ObjectId, place_id: ObjectId) -> dict | None:
    return await get_db().places.find_one({"_id": place_id, "circle_id": circle_id})


async def create_place(circle_id: ObjectId, list_id: ObjectId, name: str, link: str | None, notes: str | None) -> dict:
    doc = {
        "circle_id": circle_id,
        "list_id": list_id,
        "name": name,
        "link": link,
        "notes": notes,
        "active": True,
        "created_at": _now(),
    }
    result = await get_db().places.insert_one(doc)
    doc["_id"] = result.inserted_id
    return doc


async def update_place(circle_id: ObjectId, place_id: ObjectId, changes: dict) -> bool:
    result = await get_db().places.update_one(
        {"_id": place_id, "circle_id": circle_id}, {"$set": changes}
    )
    return result.matched_count == 1


# --- visits --------------------------------------------------------------


async def get_visits(circle_id: ObjectId, place_ids: list[ObjectId] | None = None) -> list[dict]:
    query: dict = {"circle_id": circle_id}
    if place_ids is not None:
        query["place_id"] = {"$in": place_ids}
    return await get_db().visits.find(query).sort("date", -1).to_list(None)


async def create_visit(circle_id: ObjectId, place_id: ObjectId, date: str, attendees: list[str]) -> dict:
    doc = {
        "circle_id": circle_id,
        "place_id": place_id,
        "date": date,  # ISO "YYYY-MM-DD" - sorts correctly as a string
        "attendees": attendees,
        "created_at": _now(),
    }
    result = await get_db().visits.insert_one(doc)
    doc["_id"] = result.inserted_id
    return doc


async def delete_visit(circle_id: ObjectId, visit_id: ObjectId) -> bool:
    result = await get_db().visits.delete_one({"_id": visit_id, "circle_id": circle_id})
    return result.deleted_count == 1
