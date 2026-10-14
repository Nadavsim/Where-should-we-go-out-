# Its presence makes pytest add the project root to sys.path so tests can
# `from backend import ...`.

import pytest
from fastapi.testclient import TestClient
from mongomock_motor import AsyncMongoMockClient


@pytest.fixture
def client():
    """A TestClient backed by an in-memory MongoDB, fresh per test."""
    from backend import db
    from backend.app import app

    db.set_client(AsyncMongoMockClient())
    with TestClient(app) as c:
        yield c
    db.set_client(None)
