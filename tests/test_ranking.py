import random
from datetime import date, timedelta

import pytest

from backend.ranking import Visit, rank_places

TODAY = date(2026, 10, 14)


def visit(place, days_ago, *people, vid=None):
    return Visit(
        id=vid or f"{place}-{days_ago}-{'-'.join(people)}",
        place_id=place,
        date=TODAY - timedelta(days=days_ago),
        attendees=frozenset(people),
    )


def order(ranked):
    return [r.place_id for r in ranked]


def test_place_two_of_tonight_visited_ranks_below_unvisited_place():
    # Alice + Bob went to X a week ago; tonight Alice + Bob + Carol go out.
    ranked = rank_places(
        ["X", "Y"],
        [visit("X", 7, "alice", "bob")],
        ["alice", "bob", "carol"],
        TODAY,
    )
    assert order(ranked) == ["Y", "X"]
    x = ranked[1]
    assert x.days_since == {"alice": 7, "bob": 7, "carol": None}
    assert x.score == pytest.approx((7 + 7 + 365) / 3)
    assert ranked[0].score == 365


def test_one_person_yesterday_beats_whole_group_two_months_ago():
    # Plain "anyone was there" would rank Z last (most recent visit); the
    # per-person average ranks it first since two of three have never been.
    ranked = rank_places(
        ["X", "Z"],
        [visit("X", 60, "alice", "bob", "carol"), visit("Z", 1, "carol")],
        ["alice", "bob", "carol"],
        TODAY,
    )
    assert order(ranked) == ["Z", "X"]
    assert ranked[0].score == pytest.approx((365 + 365 + 1) / 3)
    assert ranked[1].score == 60


def test_visits_by_people_not_coming_tonight_are_ignored():
    ranked = rank_places(["X"], [visit("X", 1, "dan")], ["alice", "bob"], TODAY)
    assert ranked[0].score == 365
    assert ranked[0].last_visit is None
    assert ranked[0].visit_count == 0


def test_uses_each_persons_own_most_recent_visit():
    visits = [
        visit("X", 100, "alice", "bob"),
        visit("X", 10, "alice"),
    ]
    ranked = rank_places(["X"], visits, ["alice", "bob"], TODAY)
    assert ranked[0].days_since == {"alice": 10, "bob": 100}
    assert ranked[0].last_visit.date == TODAY - timedelta(days=10)
    assert ranked[0].visit_count == 2


def test_last_visit_only_counts_visits_involving_tonight():
    visits = [visit("X", 30, "alice"), visit("X", 2, "dan")]
    ranked = rank_places(["X"], visits, ["alice"], TODAY)
    assert ranked[0].last_visit.attendees == frozenset({"alice"})


def test_old_visits_are_capped_at_never_days():
    ranked = rank_places(
        ["old", "never"],
        [visit("old", 900, "alice")],
        ["alice"],
        TODAY,
        never_days=365,
    )
    assert ranked[0].score == ranked[1].score == 365
    # Tie on score -> fewer visits first.
    assert order(ranked) == ["never", "old"]
    assert ranked[1].days_since == {"alice": 365}


def test_never_days_is_configurable():
    ranked = rank_places(
        ["seen", "never"],
        [visit("seen", 50, "alice", "bob")],
        ["alice", "bob", "carol"],
        TODAY,
        never_days=30,
    )
    assert ranked[0].place_id == "never"
    assert ranked[1].score == 30


def test_future_dated_visit_counts_as_today():
    ranked = rank_places(["X"], [visit("X", -3, "alice")], ["alice"], TODAY)
    assert ranked[0].days_since == {"alice": 0}


def test_ties_break_by_fewer_visits_then_randomly():
    visits = [visit("A", 20, "alice"), visit("A", 30, "bob"), visit("B", 20, "alice"), visit("B", 30, "bob")]
    visits.append(visit("A", 25, "alice", vid="extra"))  # A: 3 visits, same per-person recency
    ranked = rank_places(["A", "B"], visits, ["alice", "bob"], TODAY)
    assert order(ranked) == ["B", "A"]

    seen_orders = {
        tuple(order(rank_places(["P", "Q", "R"], [], ["alice"], TODAY, rng=random.Random(seed))))
        for seed in range(30)
    }
    assert len(seen_orders) > 1


def test_single_place_list_reports_last_visit():
    ranked = rank_places(["solo"], [visit("solo", 40, "alice", "dan")], ["alice", "bob"], TODAY)
    assert len(ranked) == 1
    assert ranked[0].last_visit.attendees == frozenset({"alice", "dan"})


def test_needs_at_least_one_member():
    with pytest.raises(ValueError):
        rank_places(["X"], [], [], TODAY)


def test_places_with_no_entries_and_unknown_place_visits():
    assert rank_places([], [visit("X", 1, "alice")], ["alice"], TODAY) == []
