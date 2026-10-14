import asyncio
from datetime import timedelta

import pytest

from backend import app as app_module
from backend import db


@pytest.fixture
def group(client):
    """A circle with Alice, Bob, Carol and two lists. Returns (base_url, ids)."""
    circle = asyncio.run(db.create_circle("Friends", ["Alice", "Bob", "Carol"]))
    base = f"/api/c/{circle['token']}"
    members = {m["name"].lower(): m["id"] for m in circle["members"]}
    ramen = client.post(f"{base}/lists", json={"name": "Ramen"}).json()
    return base, members, ramen


def add_place(client, base, list_id, name, **extra):
    r = client.post(f"{base}/lists/{list_id}/places", json={"name": name, **extra})
    assert r.status_code == 201, r.text
    return r.json()


def log_visit(client, base, place_id, attendees, days_ago=0):
    date = (app_module.today() - timedelta(days=days_ago)).isoformat()
    r = client.post(f"{base}/visits", json={"place_id": place_id, "attendees": attendees, "date": date})
    assert r.status_code == 201, r.text
    return r.json()


def recs(client, base, list_id, *member_ids):
    r = client.get(f"{base}/lists/{list_id}/recommendations", params={"members": ",".join(member_ids)})
    assert r.status_code == 200, r.text
    return r.json()["places"]


def test_unknown_token_is_404(client):
    assert client.get("/api/c/nope").status_code == 404


def test_read_circle(client, group):
    base, members, _ = group
    body = client.get(base).json()
    assert body["name"] == "Friends"
    assert [m["name"] for m in body["members"]] == ["Alice", "Bob", "Carol"]
    assert body["never_days"] == 365


def test_end_to_end_recommendation_example(client, group):
    base, m, ramen = group
    x = add_place(client, base, ramen["id"], "X", link="https://maps.google.com/?q=x")
    y = add_place(client, base, ramen["id"], "Y")
    log_visit(client, base, x["id"], [m["alice"], m["bob"]], days_ago=7)

    places = recs(client, base, ramen["id"], m["alice"], m["bob"], m["carol"])
    assert [p["name"] for p in places] == ["Y", "X"]
    assert places[1]["days_since"] == {m["alice"]: 7, m["bob"]: 7, m["carol"]: None}
    assert places[1]["score"] == round((7 + 7 + 365) / 3, 1)
    assert places[1]["last_visit"]["attendees"] == sorted([m["alice"], m["bob"]])
    assert places[1]["link"] == "https://maps.google.com/?q=x"
    assert places[0]["last_visit"] is None


def test_overview_gives_top_pick_per_list(client, group):
    base, m, ramen = group
    burgers = client.post(f"{base}/lists", json={"name": "Hamburger"}).json()
    solo = client.post(f"{base}/lists", json={"name": "Our bar"}).json()
    a = add_place(client, base, ramen["id"], "A")
    add_place(client, base, ramen["id"], "B")
    bar = add_place(client, base, solo["id"], "The bar")
    log_visit(client, base, a["id"], [m["alice"]], days_ago=1)
    log_visit(client, base, bar["id"], [m["bob"], m["carol"]], days_ago=3)

    r = client.get(f"{base}/overview", params={"members": f"{m['alice']},{m['bob']}"})
    assert r.status_code == 200
    by_name = {lst["name"]: lst for lst in r.json()}
    assert by_name["Ramen"]["top"]["name"] == "B"
    assert by_name["Ramen"]["place_count"] == 2
    assert by_name["Hamburger"]["top"] is None
    assert by_name["Our bar"]["place_count"] == 1
    assert by_name["Our bar"]["top"]["last_visit"]["date"] == (app_module.today() - timedelta(days=3)).isoformat()


def test_members_param_validation(client, group):
    base, m, ramen = group
    url = f"{base}/lists/{ramen['id']}/recommendations"
    assert client.get(url, params={"members": ""}).status_code == 422
    assert client.get(url, params={"members": "someone-else"}).status_code == 422
    assert client.get(url).status_code == 422


def test_visit_validation(client, group):
    base, m, ramen = group
    x = add_place(client, base, ramen["id"], "X")
    tomorrow = (app_module.today() + timedelta(days=1)).isoformat()
    post = lambda body: client.post(f"{base}/visits", json=body)  # noqa: E731
    assert post({"place_id": x["id"], "attendees": []}).status_code == 422
    assert post({"place_id": x["id"], "attendees": ["stranger"]}).status_code == 422
    assert post({"place_id": x["id"], "attendees": [m["alice"]], "date": tomorrow}).status_code == 422
    assert post({"place_id": "not-an-id", "attendees": [m["alice"]]}).status_code == 404
    ok = post({"place_id": x["id"], "attendees": [m["alice"], m["alice"]]})
    assert ok.status_code == 201
    assert ok.json()["date"] == app_module.today().isoformat()
    assert ok.json()["attendees"] == [m["alice"]]


def test_delete_visit_undoes_it(client, group):
    base, m, ramen = group
    x = add_place(client, base, ramen["id"], "X")
    v = log_visit(client, base, x["id"], [m["alice"]])
    assert client.get(f"{base}/places/{x['id']}/visits").json()[0]["id"] == v["id"]
    assert client.delete(f"{base}/visits/{v['id']}").status_code == 200
    assert client.get(f"{base}/places/{x['id']}/visits").json() == []
    assert client.delete(f"{base}/visits/{v['id']}").status_code == 404


def test_removed_place_is_hidden_but_restorable_with_history(client, group):
    base, m, ramen = group
    x = add_place(client, base, ramen["id"], "X")
    log_visit(client, base, x["id"], [m["alice"]], days_ago=5)
    assert client.patch(f"{base}/places/{x['id']}", json={"active": False}).status_code == 200
    assert recs(client, base, ramen["id"], m["alice"]) == []
    removed = client.get(f"{base}/lists/{ramen['id']}/places", params={"include_removed": True}).json()
    assert removed[0]["active"] is False

    client.patch(f"{base}/places/{x['id']}", json={"active": True})
    assert recs(client, base, ramen["id"], m["alice"])[0]["days_since"] == {m["alice"]: 5}


def test_edit_place_fields_and_move_list(client, group):
    base, m, ramen = group
    other = client.post(f"{base}/lists", json={"name": "Cocktail bars"}).json()
    x = add_place(client, base, ramen["id"], "X", notes="good")
    r = client.patch(f"{base}/places/{x['id']}", json={"name": "X2", "notes": "", "link": "https://x.example"})
    assert r.status_code == 200
    client.patch(f"{base}/places/{x['id']}", json={"list_id": other["id"]})
    moved = client.get(f"{base}/lists/{other['id']}/places").json()[0]
    assert moved["name"] == "X2"
    assert moved["notes"] is None
    assert moved["link"] == "https://x.example/"
    assert client.patch(f"{base}/places/{x['id']}", json={"list_id": "bad"}).status_code == 404


def test_place_input_validation(client, group):
    base, _, ramen = group
    url = f"{base}/lists/{ramen['id']}/places"
    assert client.post(url, json={"name": "  "}).status_code == 422
    assert client.post(url, json={"name": "x" * 81}).status_code == 422
    assert client.post(url, json={"name": "X", "link": "javascript:alert(1)"}).status_code == 422


def test_lists_rename_remove(client, group):
    base, _, ramen = group
    client.patch(f"{base}/lists/{ramen['id']}", json={"name": "Ramen!"})
    assert client.get(f"{base}/lists").json()[0]["name"] == "Ramen!"
    client.patch(f"{base}/lists/{ramen['id']}", json={"active": False})
    assert client.get(f"{base}/lists").json() == []
    assert len(client.get(f"{base}/lists", params={"include_removed": True}).json()) == 1


def test_members_add_rename_remove(client, group):
    base, m, _ = group
    dan = client.post(f"{base}/members", json={"name": "Dan"}).json()
    client.patch(f"{base}/members/{dan['id']}", json={"name": "Daniel"})
    client.patch(f"{base}/members/{m['carol']}", json={"active": False})
    names = [x["name"] for x in client.get(base).json()["members"]]
    assert names == ["Alice", "Bob", "Daniel"]
    assert client.patch(f"{base}/members/nobody", json={"name": "x"}).status_code == 404


def test_cannot_remove_last_member(client):
    circle = asyncio.run(db.create_circle("Solo", ["Alice"]))
    base = f"/api/c/{circle['token']}"
    r = client.patch(f"{base}/members/{circle['members'][0]['id']}", json={"active": False})
    assert r.status_code == 422


def test_groups_are_isolated(client, group):
    base, m, ramen = group
    other = asyncio.run(db.create_circle("Others", ["Zed"]))
    other_base = f"/api/c/{other['token']}"
    assert client.get(f"{other_base}/lists/{ramen['id']}/places").status_code == 404
    x = add_place(client, base, ramen["id"], "X")
    r = client.post(f"{other_base}/visits", json={"place_id": x["id"], "attendees": [other["members"][0]["id"]]})
    assert r.status_code == 404


def test_security_headers_and_pages(client):
    r = client.get("/robots.txt")
    assert r.headers["Referrer-Policy"] == "no-referrer"
    assert "noindex" in r.headers["X-Robots-Tag"]
    assert "Disallow: /" in r.text
