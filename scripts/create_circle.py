"""Create a friend group from a JSON file and print its share link.

    python -m scripts.create_circle circles/example.json [--base-url https://...]

Everything about a group - its people, lists and places - is data in this
file (and editable in the app afterwards), so starting a new group or
swapping the lists is a new file, not a code change. See circles/example.json.
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

from backend import db
from backend.models import NameBody, PlaceCreate
from backend.ranking import DEFAULT_NEVER_DAYS


def load(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    # Validate everything up front so a typo doesn't leave a half-made group.
    NameBody(name=data["name"])
    if not data.get("members"):
        sys.exit("The file needs at least one member")
    for name in data["members"]:
        NameBody(name=name)
    for list_name, places in data.get("lists", {}).items():
        NameBody(name=list_name)
        for place in places:
            PlaceCreate(**(place if isinstance(place, dict) else {"name": place}))
    return data


async def create(data: dict) -> dict:
    await db.ensure_indexes()
    circle = await db.create_circle(
        data["name"], data["members"], data.get("never_days", DEFAULT_NEVER_DAYS)
    )
    for list_name, places in data.get("lists", {}).items():
        lst = await db.create_list(circle["_id"], list_name.strip())
        for place in places:
            p = PlaceCreate(**(place if isinstance(place, dict) else {"name": place}))
            await db.create_place(circle["_id"], lst["_id"], p.name, str(p.link) if p.link else None, p.notes)
    return circle


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("file", type=Path)
    parser.add_argument("--base-url", default="http://localhost:8000")
    args = parser.parse_args()

    circle = asyncio.run(create(load(args.file)))
    print(f"Created '{circle['name']}' in database '{db.MONGODB_DB_NAME}'.")
    print("Share this link with the group (anyone with it can view and edit):")
    print(f"  {args.base_url.rstrip('/')}/c/{circle['token']}")


if __name__ == "__main__":
    main()
