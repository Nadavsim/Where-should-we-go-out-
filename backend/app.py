import os
from contextlib import asynccontextmanager
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from bson import ObjectId
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from . import db
from .models import ListUpdate, MemberUpdate, NameBody, PlaceCreate, PlaceUpdate, VisitCreate
from .ranking import Visit, rank_places

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"

# "Today" for visit dates and day counts. The group is in Israel, so a visit
# logged at 00:30 belongs to the night before only if we use local time.
APP_TZ = ZoneInfo(os.environ.get("APP_TIMEZONE", "Asia/Jerusalem"))


def today() -> date:
    return datetime.now(APP_TZ).date()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.ensure_indexes()
    yield


app = FastAPI(lifespan=lifespan)
# check_dir=False: the API (and the tests) work before the frontend is built.
app.mount("/static", StaticFiles(directory=STATIC_DIR, check_dir=False), name="static")


@app.middleware("http")
async def security_headers(request, call_next):
    """The share link's token is the group's only key, so: never send it in a
    Referer (no-referrer), never let search engines index it, and never cache
    the page shell (so a deploy is picked up immediately)."""
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Robots-Tag"] = "noindex, nofollow"
    response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data:; object-src 'none'; "
        "base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
    )
    path = request.url.path
    if path.startswith("/static/assets/"):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    elif not path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


# --- helpers -------------------------------------------------------------


async def get_circle(token: str) -> dict:
    circle = await db.get_circle_by_token(token)
    if circle is None:
        raise HTTPException(404, "Group not found - check the link")
    return circle


def parse_id(value: str, what: str) -> ObjectId:
    oid = db.to_object_id(value)
    if oid is None:
        raise HTTPException(404, f"{what} not found")
    return oid


def active_member_ids(circle: dict) -> set[str]:
    return {m["id"] for m in circle["members"] if m["active"]}


def all_member_ids(circle: dict) -> set[str]:
    return {m["id"] for m in circle["members"]}


def format_circle(circle: dict) -> dict:
    return {
        "name": circle["name"],
        "never_days": circle.get("never_days", 365),
        "members": [{"id": m["id"], "name": m["name"]} for m in circle["members"] if m["active"]],
    }


def format_list(doc: dict) -> dict:
    return {"id": str(doc["_id"]), "name": doc["name"], "active": doc["active"]}


def format_place(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "list_id": str(doc["list_id"]),
        "name": doc["name"],
        "link": doc.get("link"),
        "notes": doc.get("notes"),
        "active": doc["active"],
    }


def format_visit(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "place_id": str(doc["place_id"]),
        "date": doc["date"],
        "attendees": doc["attendees"],
    }


def to_ranking_visit(doc: dict) -> Visit:
    return Visit(
        id=str(doc["_id"]),
        place_id=str(doc["place_id"]),
        date=date.fromisoformat(doc["date"]),
        attendees=frozenset(doc["attendees"]),
    )


def parse_members(circle: dict, members: str) -> list[str]:
    ids = list(dict.fromkeys(m for m in members.split(",") if m))
    if not ids:
        raise HTTPException(422, "Pick at least one person")
    unknown = set(ids) - active_member_ids(circle)
    if unknown:
        raise HTTPException(422, "Unknown person in the group")
    return ids


async def rank_list(circle: dict, places: list[dict], members: list[str]) -> list[dict]:
    if not places:
        return []
    by_id = {str(p["_id"]): p for p in places}
    visits = await db.get_visits(circle["_id"], [p["_id"] for p in places])
    ranked = rank_places(
        list(by_id),
        [to_ranking_visit(v) for v in visits],
        members,
        today(),
        circle.get("never_days", 365),
    )
    return [
        {
            **format_place(by_id[r.place_id]),
            "score": round(r.score, 1),
            "days_since": r.days_since,
            "visit_count": r.visit_count,
            "last_visit": (
                {
                    "id": r.last_visit.id,
                    "date": r.last_visit.date.isoformat(),
                    "attendees": sorted(r.last_visit.attendees),
                }
                if r.last_visit
                else None
            ),
        }
        for r in ranked
    ]


# --- health --------------------------------------------------------------


@app.get("/health")
async def health():
    if await db.ping():
        return {"status": "ok"}
    return JSONResponse({"status": "database unreachable"}, status_code=503)


# --- circle & members ----------------------------------------------------


@app.get("/api/c/{token}")
async def read_circle(circle: dict = Depends(get_circle)):
    return format_circle(circle)


@app.post("/api/c/{token}/members", status_code=201)
async def add_member(body: NameBody, circle: dict = Depends(get_circle)):
    member = await db.add_member(circle["_id"], body.name)
    return {"id": member["id"], "name": member["name"]}


@app.patch("/api/c/{token}/members/{member_id}")
async def update_member(member_id: str, body: MemberUpdate, circle: dict = Depends(get_circle)):
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    if changes.get("active") is False and active_member_ids(circle) == {member_id}:
        raise HTTPException(422, "A group needs at least one person")
    if not changes or not await db.update_member(circle["_id"], member_id, changes):
        raise HTTPException(404, "Person not found")
    return {"ok": True}


# --- lists ---------------------------------------------------------------


@app.get("/api/c/{token}/lists")
async def read_lists(include_removed: bool = False, circle: dict = Depends(get_circle)):
    lists = await db.get_lists(circle["_id"], include_inactive=include_removed)
    places = await db.get_places(circle["_id"])
    counts: dict[ObjectId, int] = {}
    for p in places:
        counts[p["list_id"]] = counts.get(p["list_id"], 0) + 1
    return [{**format_list(lst), "place_count": counts.get(lst["_id"], 0)} for lst in lists]


@app.post("/api/c/{token}/lists", status_code=201)
async def create_list(body: NameBody, circle: dict = Depends(get_circle)):
    return {**format_list(await db.create_list(circle["_id"], body.name)), "place_count": 0}


@app.patch("/api/c/{token}/lists/{list_id}")
async def update_list(list_id: str, body: ListUpdate, circle: dict = Depends(get_circle)):
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    if not changes or not await db.update_list(circle["_id"], parse_id(list_id, "List"), changes):
        raise HTTPException(404, "List not found")
    return {"ok": True}


@app.get("/api/c/{token}/overview")
async def overview(members: str = Query(...), circle: dict = Depends(get_circle)):
    """Every list with its top suggestion for tonight's people - the home
    screen in one request. Fine at friend-group scale (all of a group's
    places and visits are a few hundred documents at most)."""
    member_ids = parse_members(circle, members)
    lists = await db.get_lists(circle["_id"])
    places = await db.get_places(circle["_id"])
    out = []
    for lst in lists:
        ranked = await rank_list(circle, [p for p in places if p["list_id"] == lst["_id"]], member_ids)
        out.append({**format_list(lst), "place_count": len(ranked), "top": ranked[0] if ranked else None})
    return out


# --- places --------------------------------------------------------------


async def require_list(circle: dict, list_id: str) -> dict:
    lst = await db.get_list(circle["_id"], parse_id(list_id, "List"))
    if lst is None:
        raise HTTPException(404, "List not found")
    return lst


@app.get("/api/c/{token}/lists/{list_id}/places")
async def read_places(list_id: str, include_removed: bool = False, circle: dict = Depends(get_circle)):
    lst = await require_list(circle, list_id)
    places = await db.get_places(circle["_id"], lst["_id"], include_inactive=include_removed)
    return [format_place(p) for p in places]


@app.post("/api/c/{token}/lists/{list_id}/places", status_code=201)
async def create_place(list_id: str, body: PlaceCreate, circle: dict = Depends(get_circle)):
    lst = await require_list(circle, list_id)
    place = await db.create_place(
        circle["_id"], lst["_id"], body.name, str(body.link) if body.link else None, body.notes
    )
    return format_place(place)


@app.patch("/api/c/{token}/places/{place_id}")
async def update_place(place_id: str, body: PlaceUpdate, circle: dict = Depends(get_circle)):
    changes = body.model_dump(exclude_unset=True)
    if "name" in changes and changes["name"] is None:
        del changes["name"]
    if "active" in changes and changes["active"] is None:
        del changes["active"]
    if changes.get("link") is not None:
        changes["link"] = str(changes["link"])
    if "list_id" in changes:
        if changes["list_id"] is None:
            del changes["list_id"]
        else:
            changes["list_id"] = (await require_list(circle, changes["list_id"]))["_id"]
    if not changes or not await db.update_place(circle["_id"], parse_id(place_id, "Place"), changes):
        raise HTTPException(404, "Place not found")
    return {"ok": True}


@app.get("/api/c/{token}/lists/{list_id}/recommendations")
async def recommendations(list_id: str, members: str = Query(...), circle: dict = Depends(get_circle)):
    lst = await require_list(circle, list_id)
    member_ids = parse_members(circle, members)
    places = await db.get_places(circle["_id"], lst["_id"])
    return {"list": format_list(lst), "places": await rank_list(circle, places, member_ids)}


# --- visits --------------------------------------------------------------


@app.get("/api/c/{token}/places/{place_id}/visits")
async def read_visits(place_id: str, circle: dict = Depends(get_circle)):
    visits = await db.get_visits(circle["_id"], [parse_id(place_id, "Place")])
    return [format_visit(v) for v in visits]


@app.post("/api/c/{token}/visits", status_code=201)
async def create_visit(body: VisitCreate, circle: dict = Depends(get_circle)):
    place = await db.get_place(circle["_id"], parse_id(body.place_id, "Place"))
    if place is None or not place["active"]:
        raise HTTPException(404, "Place not found")
    attendees = list(dict.fromkeys(body.attendees))
    if set(attendees) - all_member_ids(circle):
        raise HTTPException(422, "Unknown person in the group")
    visit_date = body.date or today()
    if visit_date > today():
        raise HTTPException(422, "A visit can't be in the future")
    visit = await db.create_visit(circle["_id"], place["_id"], visit_date.isoformat(), attendees)
    return format_visit(visit)


@app.delete("/api/c/{token}/visits/{visit_id}")
async def delete_visit(visit_id: str, circle: dict = Depends(get_circle)):
    if not await db.delete_visit(circle["_id"], parse_id(visit_id, "Visit")):
        raise HTTPException(404, "Visit not found")
    return {"ok": True}


# --- pages ---------------------------------------------------------------


def index_page():
    index = STATIC_DIR / "index.html"
    if not index.exists():
        return PlainTextResponse("Frontend not built - run `npm run build` in frontend/.", status_code=503)
    return FileResponse(index)


@app.get("/", include_in_schema=False)
async def home():
    return index_page()


@app.get("/c/{token}", include_in_schema=False)
async def circle_page(token: str):
    # The page itself loads for any token; the app shows "group not found"
    # if the API rejects it.
    return index_page()


@app.get("/robots.txt", include_in_schema=False)
async def robots():
    return PlainTextResponse("User-agent: *\nDisallow: /\n")
