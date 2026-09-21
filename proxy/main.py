"""BRIDGE proxy (spec §5, §6.4): one endpoint that asks DeepSeek to label unlabeled form controls.

Owns: the API key and request shaping. Owns no persistence of any kind.
Privacy (§6.4): log field ids and counts only. Never log nearbyText, options or images.
"""

import base64
import binascii
import json
import logging
import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from pydantic import BaseModel, Field, ValidationError, field_validator

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("bridge.proxy")

# DeepSeek V4.1 Flash: the DeepSeek model that accepts images (api-docs.deepseek.com/guides/vision).
MODEL = "deepseek-flash"
# DeepSeek JSON mode requires an explicit max_tokens so the JSON is not truncated midway.
MAX_TOKENS = 16000

api_key = os.environ.get("DEEPSEEK_API_KEY")
if not api_key:
    raise SystemExit(
        "DEEPSEEK_API_KEY is not set. The proxy holds the LLM key and cannot start without it. "
        "Run: DEEPSEEK_API_KEY=<key> uv run uvicorn main:app --port 8000"
    )

# Module-level so tests can replace it with a stub; the handler reads it at call time.
# max_retries=0: a failed upstream call is not retried (the SDK default is 2 transport retries).
client = OpenAI(api_key=api_key, base_url="https://api.deepseek.com", max_retries=0)


class FieldIn(BaseModel):
    id: str
    kind: str
    nearbyText: list[str]
    options: list[str] | None = None
    cropPng: str | None = None

    @field_validator("cropPng")
    @classmethod
    def crop_is_base64(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            base64.b64decode(value, validate=True)
        except binascii.Error as exc:
            raise ValueError(f"cropPng must be standard base64: {exc}") from exc
        return value


class InferRequest(BaseModel):
    fields: list[FieldIn]


class Label(BaseModel):
    id: str
    label: str
    confidence: float = Field(ge=0, le=1)


class InferResponse(BaseModel):
    labels: list[Label]


SYSTEM_PROMPT = (
    "You label form controls on job-application pages for a screen-reader user. "
    "Each control has no accessible name. For every control you are given its id, its kind, "
    "text found near it on the page, its options when it has any, and sometimes a cropped "
    "screenshot of it. Infer the short label a sighted user would read for that control "
    "(for example 'Highest level of education'). Return exactly one entry per id you were given, "
    "using the id verbatim. confidence is a number from 0 to 1: how sure you are that the label "
    "is what the page intends. If the evidence is weak, still give your best label and a low confidence.\n\n"
    "Respond with json only, in exactly this shape:\n"
    '{"labels": [{"id": "<id exactly as given>", "label": "Highest level of education", "confidence": 0.8}]}'
)

def build_content(fields: list[FieldIn]) -> list[dict]:
    """One user message for the whole request: a text block per field, followed by its crop if any."""
    content: list[dict] = []
    for field in fields:
        structure = {"id": field.id, "kind": field.kind, "nearbyText": field.nearbyText}
        if field.options is not None:
            structure["options"] = field.options
        content.append({"type": "text", "text": json.dumps(structure, ensure_ascii=False)})
        if field.cropPng is not None:
            content.append(
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{field.cropPng}"}}
            )
    content.append({"type": "text", "text": "Label every control above. One entry per id."})
    return content


def bad_gateway(reason: str, missing_ids: list[str]) -> HTTPException:
    return HTTPException(status_code=502, detail={"error": reason, "missingIds": missing_ids})


# Exactly one endpoint (spec §5.2): FastAPI's default /docs, /redoc and /openapi.json routes are off.
app = FastAPI(title="BRIDGE proxy", docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.post("/infer-labels")
def infer_labels(request: InferRequest) -> InferResponse:
    ids = [field.id for field in request.fields]
    crops = sum(1 for field in request.fields if field.cropPng is not None)
    log.info("infer-labels request: fields=%d crops=%d ids=%s", len(ids), crops, ids)

    if not ids:
        return InferResponse(labels=[])

    # Ceiling: exactly one upstream call per request, never retried (client has max_retries=0) and no
    # other strategy is tried. An SDK error (bad key, rate limit, network) propagates as a 500.
    response = client.chat.completions.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": build_content(request.fields)},
        ],
    )

    choice = response.choices[0]
    if choice.finish_reason != "stop":
        log.warning("model stopped early: finish_reason=%s ids=%s", choice.finish_reason, ids)
        raise bad_gateway(f"model stopped with finish_reason={choice.finish_reason}", ids)

    # DeepSeek documents that JSON mode "may occasionally return empty content". Not retried.
    text = choice.message.content
    if not text or not text.strip():
        log.warning("model returned empty content: ids=%s", ids)
        raise bad_gateway("model returned empty content", ids)

    try:
        inferred = InferResponse.model_validate_json(text)
    except ValidationError as exc:
        # exc is deliberately not logged or returned: it quotes the model output, which may echo nearbyText.
        log.warning("model output failed validation: errors=%d ids=%s", exc.error_count(), ids)
        raise bad_gateway("model output was not valid labels JSON", ids) from exc

    by_id = {label.id: label for label in inferred.labels}
    missing = [field_id for field_id in ids if field_id not in by_id]
    if missing:
        log.warning("model omitted ids: missing=%s", missing)
        raise bad_gateway("model output did not cover every field id", missing)

    log.info("infer-labels response: labels=%d", len(ids))
    return InferResponse(labels=[by_id[field_id] for field_id in ids])
