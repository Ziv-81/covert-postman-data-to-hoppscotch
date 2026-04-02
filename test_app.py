"""
Unit tests for converter.py and the Flask application routes.
"""

import json
import pytest

from converter import convert, convert_json_string
from app import app as flask_app

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

MINIMAL_COLLECTION = {
    "info": {
        "_postman_id": "abc123",
        "name": "Test Collection",
        "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    "item": [],
}

FULL_COLLECTION = {
    "info": {"name": "My API", "schema": "..."},
    "item": [
        {
            "name": "Get Users",
            "request": {
                "method": "GET",
                "header": [{"key": "Accept", "value": "application/json"}],
                "url": {
                    "raw": "https://api.example.com/users?page=1",
                    "protocol": "https",
                    "host": ["api", "example", "com"],
                    "path": ["users"],
                    "query": [{"key": "page", "value": "1"}],
                },
            },
        },
        {
            "name": "Create User",
            "request": {
                "method": "POST",
                "header": [{"key": "Content-Type", "value": "application/json"}],
                "body": {
                    "mode": "raw",
                    "raw": '{"name": "Alice"}',
                    "options": {"raw": {"language": "json"}},
                },
                "url": {"raw": "https://api.example.com/users"},
                "auth": {
                    "type": "bearer",
                    "bearer": [{"key": "token", "value": "mytoken"}],
                },
            },
        },
        {
            "name": "Folder",
            "item": [
                {
                    "name": "Delete User",
                    "request": {
                        "method": "DELETE",
                        "header": [],
                        "url": {"raw": "https://api.example.com/users/1"},
                    },
                }
            ],
        },
    ],
}


# ---------------------------------------------------------------------------
# converter.py tests
# ---------------------------------------------------------------------------


class TestConvert:
    def test_empty_collection_returns_valid_structure(self):
        result = convert(MINIMAL_COLLECTION)
        assert result["v"] == 1
        assert result["name"] == "Test Collection"
        assert result["folders"] == []
        assert result["requests"] == []

    def test_request_fields(self):
        result = convert(FULL_COLLECTION)
        requests = result["requests"]
        # First two items in 'item' are direct requests (not folders)
        assert len(requests) == 2

        get_req = requests[0]
        assert get_req["name"] == "Get Users"
        assert get_req["method"] == "GET"
        assert get_req["endpoint"] == "https://api.example.com/users?page=1"
        assert get_req["params"] == [{"key": "page", "value": "1", "active": True}]
        assert {"key": "Accept", "value": "application/json", "active": True} in get_req["headers"]

    def test_post_request_body(self):
        result = convert(FULL_COLLECTION)
        post_req = result["requests"][1]
        assert post_req["method"] == "POST"
        assert post_req["contentType"] == "application/json"
        assert '"name": "Alice"' in post_req["rawParams"]
        assert post_req["isRawParams"] is True

    def test_bearer_auth(self):
        result = convert(FULL_COLLECTION)
        post_req = result["requests"][1]
        assert post_req["auth"]["authType"] == "bearer"
        assert post_req["auth"]["token"] == "mytoken"
        assert post_req["auth"]["authActive"] is True

    def test_folder_structure(self):
        result = convert(FULL_COLLECTION)
        assert len(result["folders"]) == 1
        folder = result["folders"][0]
        assert folder["name"] == "Folder"
        assert len(folder["requests"]) == 1
        assert folder["requests"][0]["name"] == "Delete User"

    def test_url_as_string(self):
        data = {
            "info": {"name": "C", "schema": ""},
            "item": [
                {
                    "name": "Ping",
                    "request": {
                        "method": "GET",
                        "header": [],
                        "url": "http://example.com/ping",
                    },
                }
            ],
        }
        result = convert(data)
        assert result["requests"][0]["endpoint"] == "http://example.com/ping"

    def test_no_auth_defaults_to_none(self):
        result = convert(FULL_COLLECTION)
        get_req = result["requests"][0]
        assert get_req["auth"]["authType"] == "none"
        assert get_req["auth"]["authActive"] is False

    def test_basic_auth(self):
        data = {
            "info": {"name": "C", "schema": ""},
            "item": [
                {
                    "name": "Secure",
                    "request": {
                        "method": "GET",
                        "header": [],
                        "url": "https://secure.example.com/",
                        "auth": {
                            "type": "basic",
                            "basic": [
                                {"key": "username", "value": "user"},
                                {"key": "password", "value": "pass"},
                            ],
                        },
                    },
                }
            ],
        }
        result = convert(data)
        auth = result["requests"][0]["auth"]
        assert auth["authType"] == "basic"
        assert auth["username"] == "user"
        assert auth["password"] == "pass"

    def test_disabled_headers_are_inactive(self):
        data = {
            "info": {"name": "C", "schema": ""},
            "item": [
                {
                    "name": "R",
                    "request": {
                        "method": "GET",
                        "header": [
                            {"key": "X-Enabled", "value": "yes", "disabled": False},
                            {"key": "X-Disabled", "value": "no", "disabled": True},
                        ],
                        "url": "http://example.com/",
                    },
                }
            ],
        }
        result = convert(data)
        headers = result["requests"][0]["headers"]
        active_map = {h["key"]: h["active"] for h in headers}
        assert active_map["X-Enabled"] is True
        assert active_map["X-Disabled"] is False


class TestConvertJsonString:
    def test_valid_json_string(self):
        output = convert_json_string(json.dumps(MINIMAL_COLLECTION))
        data = json.loads(output)
        assert data["name"] == "Test Collection"

    def test_invalid_json_raises_value_error(self):
        with pytest.raises(ValueError, match="Invalid JSON"):
            convert_json_string("{not valid json}")

    def test_non_postman_json_raises_value_error(self):
        with pytest.raises(ValueError, match="Postman"):
            convert_json_string(json.dumps({"foo": "bar"}))


# ---------------------------------------------------------------------------
# Flask route tests
# ---------------------------------------------------------------------------


@pytest.fixture()
def client():
    flask_app.config["TESTING"] = True
    with flask_app.test_client() as c:
        yield c


class TestFlaskRoutes:
    def test_index_returns_200(self, client):
        resp = client.get("/")
        assert resp.status_code == 200
        assert b"Postman" in resp.data

    def test_convert_no_file(self, client):
        resp = client.post("/convert")
        assert resp.status_code == 400
        assert b"No file part" in resp.data

    def test_convert_empty_filename(self, client):
        data = {"file": (b"", "")}
        resp = client.post("/convert", data=data, content_type="multipart/form-data")
        assert resp.status_code == 400

    def test_convert_non_json_extension(self, client):
        from io import BytesIO
        data = {"file": (BytesIO(b"{}"), "collection.xml")}
        resp = client.post("/convert", data=data, content_type="multipart/form-data")
        assert resp.status_code == 400
        body = json.loads(resp.data)
        assert "JSON" in body["error"]

    def test_convert_invalid_json_content(self, client):
        from io import BytesIO
        data = {"file": (BytesIO(b"not json"), "collection.json")}
        resp = client.post("/convert", data=data, content_type="multipart/form-data")
        assert resp.status_code == 422

    def test_convert_non_postman_json(self, client):
        from io import BytesIO
        payload = json.dumps({"foo": "bar"}).encode()
        data = {"file": (BytesIO(payload), "collection.json")}
        resp = client.post("/convert", data=data, content_type="multipart/form-data")
        assert resp.status_code == 422

    def test_convert_valid_collection(self, client):
        from io import BytesIO
        payload = json.dumps(FULL_COLLECTION).encode()
        data = {"file": (BytesIO(payload), "my_collection.json")}
        resp = client.post("/convert", data=data, content_type="multipart/form-data")
        assert resp.status_code == 200
        assert resp.content_type == "application/json"
        disposition = resp.headers.get("Content-Disposition", "")
        assert "attachment" in disposition
        assert "hoppscotch" in disposition

        result = json.loads(resp.data)
        assert result["name"] == "My API"
        assert len(result["requests"]) == 2
        assert len(result["folders"]) == 1
