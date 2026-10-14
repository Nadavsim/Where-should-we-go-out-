"""The recommendation logic, kept pure (no I/O) so it can be tested directly.

Rule: a past visit matters for tonight if ANY of tonight's people were there.
Each person coming tonight scores a place by how many days it's been since
they personally last went there (never = `never_days`). A place's score is
the average over tonight's people; higher means "more overdue" and ranks
first.

That way a place two of three people visited last week ranks below one
nobody has been to, while a place only one person went to yesterday still
ranks above one the whole group did two months ago.
"""

import random
from dataclasses import dataclass, field
from datetime import date

DEFAULT_NEVER_DAYS = 365


@dataclass(frozen=True)
class Visit:
    id: str
    place_id: str
    date: date
    attendees: frozenset[str]


@dataclass
class RankedPlace:
    place_id: str
    # Average days-since over tonight's people (never-visited counts as
    # never_days). Higher = recommend sooner.
    score: float
    # Per tonight-person: days since they last went, or None if never.
    days_since: dict[str, int | None]
    # Most recent visit that included at least one of tonight's people.
    last_visit: Visit | None
    # How many visits included at least one of tonight's people.
    visit_count: int
    _total: int = field(default=0, repr=False)


def rank_places(
    place_ids: list[str],
    visits: list[Visit],
    members: list[str],
    today: date,
    never_days: int = DEFAULT_NEVER_DAYS,
    rng: random.Random | None = None,
) -> list[RankedPlace]:
    """Rank `place_ids` for tonight's `members`, most overdue first.

    Ties break by fewer visits involving tonight's people, then randomly, so
    a set of never-visited places doesn't always come out in the same order.
    """
    if not members:
        raise ValueError("at least one member is needed to rank places")
    tonight = frozenset(members)
    wanted = set(place_ids)

    last_seen: dict[tuple[str, str], date] = {}
    last_visit: dict[str, Visit] = {}
    visit_count: dict[str, int] = {}
    for v in visits:
        if v.place_id not in wanted:
            continue
        overlap = v.attendees & tonight
        if not overlap:
            continue
        visit_count[v.place_id] = visit_count.get(v.place_id, 0) + 1
        prev = last_visit.get(v.place_id)
        if prev is None or v.date > prev.date:
            last_visit[v.place_id] = v
        for m in overlap:
            key = (v.place_id, m)
            if key not in last_seen or v.date > last_seen[key]:
                last_seen[key] = v.date

    ranked = []
    for pid in place_ids:
        days_since: dict[str, int | None] = {}
        total = 0
        for m in members:
            seen = last_seen.get((pid, m))
            if seen is None:
                days_since[m] = None
                total += never_days
            else:
                # Clamp: a visit dated in the future counts as today, and
                # anything older than never_days is as good as never.
                days = min(max((today - seen).days, 0), never_days)
                days_since[m] = days
                total += days
        ranked.append(
            RankedPlace(
                place_id=pid,
                score=total / len(members),
                days_since=days_since,
                last_visit=last_visit.get(pid),
                visit_count=visit_count.get(pid, 0),
                _total=total,
            )
        )

    # Shuffle, then stable-sort: equal keys keep their random order.
    (rng or random.Random()).shuffle(ranked)
    # Compare the integer total, not the float average, so ties are exact.
    ranked.sort(key=lambda r: (-r._total, r.visit_count))
    return ranked
