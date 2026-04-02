"""
Converts Postman Collection v2.1 JSON exports to Hoppscotch collection format.
"""

import json


def _convert_url(url_field):
    """Return a plain URL string from a Postman URL field (string or object)."""
    if isinstance(url_field, str):
        return url_field
    if isinstance(url_field, dict):
        raw = url_field.get("raw", "")
        if raw:
            return raw
        # Reconstruct from parts when "raw" is absent
        protocol = url_field.get("protocol", "https")
        host = ".".join(url_field.get("host", []))
        path = "/".join(url_field.get("path", []))
        return f"{protocol}://{host}/{path}"
    return ""


def _convert_query_params(url_field):
    """Extract query parameters from a Postman URL field."""
    if isinstance(url_field, dict):
        return [
            {
                "key": p.get("key", ""),
                "value": p.get("value", ""),
                "active": not p.get("disabled", False),
            }
            for p in url_field.get("query", [])
        ]
    return []


def _convert_headers(header_list):
    """Convert Postman headers list to Hoppscotch headers list."""
    if not header_list:
        return []
    return [
        {
            "key": h.get("key", ""),
            "value": h.get("value", ""),
            "active": not h.get("disabled", False),
        }
        for h in header_list
    ]


def _convert_auth(auth_field):
    """Convert Postman auth block to Hoppscotch auth object."""
    if not auth_field:
        return {"authType": "none", "authActive": False}

    auth_type = auth_field.get("type", "none")

    if auth_type == "bearer":
        bearer_list = auth_field.get("bearer", [])
        token = next(
            (item.get("value", "") for item in bearer_list if item.get("key") == "token"),
            "",
        )
        return {"authType": "bearer", "authActive": True, "token": token}

    if auth_type == "basic":
        basic_list = auth_field.get("basic", [])
        username = next(
            (item.get("value", "") for item in basic_list if item.get("key") == "username"),
            "",
        )
        password = next(
            (item.get("value", "") for item in basic_list if item.get("key") == "password"),
            "",
        )
        return {
            "authType": "basic",
            "authActive": True,
            "username": username,
            "password": password,
        }

    if auth_type == "apikey":
        apikey_list = auth_field.get("apikey", [])
        key = next(
            (item.get("value", "") for item in apikey_list if item.get("key") == "key"),
            "",
        )
        value = next(
            (item.get("value", "") for item in apikey_list if item.get("key") == "value"),
            "",
        )
        return {"authType": "apikey", "authActive": True, "key": key, "value": value}

    return {"authType": "none", "authActive": False}


def _convert_body(body_field):
    """Convert Postman request body to Hoppscotch body fields."""
    if not body_field:
        return {"contentType": "", "body": ""}

    mode = body_field.get("mode", "")

    if mode == "raw":
        options = body_field.get("options", {}).get("raw", {})
        lang = options.get("language", "json").lower()
        content_type_map = {
            "json": "application/json",
            "xml": "application/xml",
            "html": "text/html",
            "text": "text/plain",
            "javascript": "application/javascript",
        }
        content_type = content_type_map.get(lang, "text/plain")
        return {"contentType": content_type, "body": body_field.get("raw", "")}

    if mode == "urlencoded":
        items = body_field.get("urlencoded", [])
        encoded = "&".join(
            f"{item.get('key', '')}={item.get('value', '')}"
            for item in items
            if not item.get("disabled", False)
        )
        return {"contentType": "application/x-www-form-urlencoded", "body": encoded}

    if mode == "formdata":
        # Represent form-data as a JSON array of key/value pairs
        items = body_field.get("formdata", [])
        form_json = json.dumps(
            [
                {"key": item.get("key", ""), "value": item.get("value", "")}
                for item in items
                if not item.get("disabled", False)
            ]
        )
        return {"contentType": "multipart/form-data", "body": form_json}

    return {"contentType": "", "body": ""}


def _convert_request(item, inherited_auth=None):
    """Convert a single Postman request item to a Hoppscotch request object."""
    request = item.get("request", {})
    url_field = request.get("url", "")
    body_info = _convert_body(request.get("body"))
    auth = _convert_auth(request.get("auth") or inherited_auth)

    return {
        "v": "1",
        "endpoint": _convert_url(url_field),
        "name": item.get("name", "Untitled"),
        "params": _convert_query_params(url_field),
        "headers": _convert_headers(request.get("header", [])),
        "method": request.get("method", "GET").upper(),
        "auth": auth,
        "httpUser": "",
        "httpPassword": "",
        "passwordFieldType": "password",
        "rawParams": body_info["body"],
        "isRawParams": body_info["contentType"] not in (
            "application/x-www-form-urlencoded",
            "multipart/form-data",
        ),
        "contentType": body_info["contentType"],
    }


def _process_items(items, inherited_auth=None):
    """
    Recursively process Postman items, separating requests from folders.

    Returns:
        (requests_list, folders_list)
    """
    requests = []
    folders = []

    for item in items:
        sub_items = item.get("item")
        if sub_items is not None:
            # This item is a folder
            folder_auth = item.get("auth") or inherited_auth
            sub_requests, sub_folders = _process_items(sub_items, folder_auth)
            folders.append(
                {
                    "v": 1,
                    "name": item.get("name", "Untitled Folder"),
                    "folders": sub_folders,
                    "requests": sub_requests,
                }
            )
        else:
            requests.append(_convert_request(item, inherited_auth))

    return requests, folders


def convert(postman_data: dict) -> dict:
    """
    Convert a parsed Postman Collection v2 / v2.1 dict to Hoppscotch format.

    Args:
        postman_data: Parsed JSON from a Postman collection export.

    Returns:
        A dict that can be serialised as a Hoppscotch collection JSON.
    """
    info = postman_data.get("info", {})
    collection_name = info.get("name", "Converted Collection")
    collection_auth = postman_data.get("auth")

    top_requests, top_folders = _process_items(
        postman_data.get("item", []), collection_auth
    )

    return {
        "v": 1,
        "name": collection_name,
        "folders": top_folders,
        "requests": top_requests,
    }


def convert_json_string(postman_json_str: str) -> str:
    """
    Convert a Postman collection JSON string to a Hoppscotch collection JSON string.

    Args:
        postman_json_str: Raw JSON string from a Postman export file.

    Returns:
        Formatted JSON string in Hoppscotch collection format.

    Raises:
        ValueError: If the input is not valid JSON or not a recognised Postman collection.
    """
    try:
        postman_data = json.loads(postman_json_str)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON: {exc}") from exc

    if "info" not in postman_data or "item" not in postman_data:
        raise ValueError(
            "The uploaded file does not appear to be a Postman collection export. "
            "Expected top-level 'info' and 'item' fields."
        )

    result = convert(postman_data)
    return json.dumps(result, ensure_ascii=False, indent=2)
