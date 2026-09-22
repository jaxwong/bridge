import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

# main.py refuses to import without a key. This value is not a real key and is never sent anywhere:
# every test that reaches the model path replaces main.client with StubDeepSeek below.
os.environ["DEEPSEEK_API_KEY"] = "test-only"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402  (httpx-backed)

import main  # noqa: E402

# 1x1 transparent PNG.
PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="


class StubDeepSeek:
    """TEST STUB. Stands in for openai.OpenAI so tests never touch the network or need a key.

    Records the kwargs of each chat.completions.create call and replies with one canned choice.
    """

    def __init__(self, reply_text: str | None, finish_reason: str = "stop"):
        self.calls: list[dict] = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))
        self._reply_text = reply_text
        self._finish_reason = finish_reason

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(
            choices=[
                SimpleNamespace(
                    finish_reason=self._finish_reason,
                    message=SimpleNamespace(content=self._reply_text),
                )
            ]
        )


@pytest.fixture
def http():
    return TestClient(main.app)


def install_stub(monkeypatch, reply_text: str | None, finish_reason: str = "stop") -> StubDeepSeek:
    stub = StubDeepSeek(reply_text, finish_reason)
    monkeypatch.setattr(main, "client", stub)
    return stub


TWO_FIELDS = {
    "fields": [
        {
            "id": "0:form>div[3]>div[2]",
            "kind": "select",
            "nearbyText": ["Education", "Highest level completed"],
            "options": ["Secondary", "Diploma", "Bachelor's"],
        },
        {"id": "0:form>div[4]>input", "kind": "text", "nearbyText": ["Phone"]},
    ]
}


def test_empty_fields_returns_empty_labels_without_calling_model(http, monkeypatch):
    stub = install_stub(monkeypatch, "unused")
    response = http.post("/infer-labels", json={"fields": []})
    assert response.status_code == 200
    assert response.json() == {"labels": []}
    assert stub.calls == []


def test_two_fields_one_model_call_labels_in_request_order(http, monkeypatch):
    # The stub answers in reverse order; the proxy must return request order.
    stub = install_stub(
        monkeypatch,
        json.dumps(
            {
                "labels": [
                    {"id": "0:form>div[4]>input", "label": "Phone number", "confidence": 0.9},
                    {"id": "0:form>div[3]>div[2]", "label": "Highest level of education", "confidence": 0.8},
                ]
            }
        ),
    )
    response = http.post("/infer-labels", json=TWO_FIELDS)
    assert response.status_code == 200
    assert response.json() == {
        "labels": [
            {"id": "0:form>div[3]>div[2]", "label": "Highest level of education", "confidence": 0.8},
            {"id": "0:form>div[4]>input", "label": "Phone number", "confidence": 0.9},
        ]
    }
    assert len(stub.calls) == 1
    call = stub.calls[0]
    assert call["model"] == "deepseek-flash"
    # DeepSeek JSON mode needs all three: response_format, the word "json" in the prompt, max_tokens.
    assert call["response_format"] == {"type": "json_object"}
    assert isinstance(call["max_tokens"], int)
    # Greedy decoding: two identical requests must produce the same wording, because the
    # dashboard treats a differently-worded label as a different question.
    assert call["temperature"] == 0
    assert [message["role"] for message in call["messages"]] == ["system", "user"]
    assert "json" in call["messages"][0]["content"]
    sent_text = "".join(part["text"] for part in call["messages"][1]["content"] if part["type"] == "text")
    assert "0:form>div[3]>div[2]" in sent_text
    assert "0:form>div[4]>input" in sent_text


def test_unparseable_model_output_is_502_naming_all_ids(http, monkeypatch):
    install_stub(monkeypatch, "Sure! The first one is probably education.")
    response = http.post("/infer-labels", json=TWO_FIELDS)
    assert response.status_code == 502
    assert response.json()["detail"]["missingIds"] == ["0:form>div[3]>div[2]", "0:form>div[4]>input"]


def test_model_omitting_an_id_is_502_naming_that_id(http, monkeypatch):
    install_stub(
        monkeypatch,
        json.dumps({"labels": [{"id": "0:form>div[4]>input", "label": "Phone number", "confidence": 0.9}]}),
    )
    response = http.post("/infer-labels", json=TWO_FIELDS)
    assert response.status_code == 502
    assert response.json()["detail"]["missingIds"] == ["0:form>div[3]>div[2]"]


def test_confidence_out_of_range_is_502_not_clamped(http, monkeypatch):
    install_stub(
        monkeypatch,
        json.dumps(
            {
                "labels": [
                    {"id": "0:form>div[3]>div[2]", "label": "Education", "confidence": 1.7},
                    {"id": "0:form>div[4]>input", "label": "Phone number", "confidence": 0.9},
                ]
            }
        ),
    )
    response = http.post("/infer-labels", json=TWO_FIELDS)
    assert response.status_code == 502


def test_model_stopping_early_is_502(http, monkeypatch):
    install_stub(monkeypatch, '{"labels": [', finish_reason="length")
    response = http.post("/infer-labels", json=TWO_FIELDS)
    assert response.status_code == 502
    assert "length" in response.json()["detail"]["error"]


@pytest.mark.parametrize("empty", [None, "", "  \n"])
def test_empty_model_content_is_502_saying_so_and_is_not_retried(http, monkeypatch, empty):
    stub = install_stub(monkeypatch, empty)
    response = http.post("/infer-labels", json=TWO_FIELDS)
    assert response.status_code == 502
    detail = response.json()["detail"]
    assert detail["error"] == "model returned empty content"
    assert detail["missingIds"] == ["0:form>div[3]>div[2]", "0:form>div[4]>input"]
    assert len(stub.calls) == 1


def test_crop_png_reaches_client_as_image_url_part_after_its_field(http, monkeypatch):
    stub = install_stub(
        monkeypatch,
        json.dumps(
            {
                "labels": [
                    {"id": "0:name", "label": "Full name", "confidence": 0.9},
                    {"id": "0:slider", "label": "Years of experience", "confidence": 0.6},
                ]
            }
        ),
    )
    body = {
        "fields": [
            {"id": "0:name", "kind": "text", "nearbyText": ["Name"]},
            {"id": "0:slider", "kind": "slider", "nearbyText": [], "cropPng": PNG_B64},
        ]
    }
    response = http.post("/infer-labels", json=body)
    assert response.status_code == 200
    parts = stub.calls[0]["messages"][1]["content"]
    assert [part["type"] for part in parts] == ["text", "text", "image_url", "text"]
    assert "0:slider" in parts[1]["text"]
    assert parts[2] == {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{PNG_B64}"}}


def test_invalid_base64_crop_is_rejected_at_the_boundary(http, monkeypatch):
    stub = install_stub(monkeypatch, "unused")
    body = {"fields": [{"id": "0:x", "kind": "text", "nearbyText": [], "cropPng": "not base64!!"}]}
    response = http.post("/infer-labels", json=body)
    assert response.status_code == 422
    assert stub.calls == []


def test_logs_carry_ids_and_counts_but_never_structure_text(http, monkeypatch, caplog):
    install_stub(monkeypatch, "not json, echoing Highest level completed")
    with caplog.at_level("INFO", logger="bridge.proxy"):
        http.post("/infer-labels", json=TWO_FIELDS)
    assert "0:form>div[3]>div[2]" in caplog.text
    for private in ("Highest level completed", "Diploma", "Phone"):
        assert private not in caplog.text


def test_cors_preflight_from_extension_origin_allows_post(http):
    response = http.options(
        "/infer-labels",
        headers={
            "Origin": "chrome-extension://abcdefghijklmnop",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "*"
    assert "POST" in response.headers["access-control-allow-methods"]


def test_real_client_targets_deepseek_and_never_retries():
    # Reads the client main.py built at import, before any stub replaces it. Constructing it makes no request.
    assert str(main.client.base_url).rstrip("/") == "https://api.deepseek.com"
    assert main.client.max_retries == 0


def test_infer_labels_is_the_only_route(http):
    assert [route.path for route in main.app.routes] == ["/infer-labels"]
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert http.get(path).status_code == 404


def test_import_fails_at_startup_without_api_key():
    env = {k: v for k, v in os.environ.items() if k != "DEEPSEEK_API_KEY"}
    result = subprocess.run(
        [sys.executable, "-c", "import main"],
        cwd=Path(__file__).parent,
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
    assert "DEEPSEEK_API_KEY is not set" in result.stderr
