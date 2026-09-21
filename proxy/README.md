# BRIDGE proxy

One FastAPI endpoint, `POST /infer-labels`, described in `../bridge-user.md` §5 and §6.4.
It holds the DeepSeek API key so the extension never does, sends the structure of unlabeled
form controls to DeepSeek V4.1 Flash (model id `deepseek-flash`, text and image input) in a
single call per request, and returns an inferred label per control. It has no database and
writes nothing to disk.

The model is called through the `openai` Python SDK pointed at `https://api.deepseek.com`,
which is the form DeepSeek's own docs use.

## Install

```sh
cd proxy
uv sync
```

## Run

```sh
DEEPSEEK_API_KEY=<your key> uv run uvicorn main:app --port 8000
```

uvicorn binds `127.0.0.1` by default, so this serves `http://127.0.0.1:8000` and is not reachable
from other machines. If `DEEPSEEK_API_KEY` is unset the process exits at startup with a message
saying so; it does not wait for the first request.

## Call

```sh
curl -s http://127.0.0.1:8000/infer-labels \
  -H 'Content-Type: application/json' \
  -d '{"fields":[{"id":"0:form>div[3]>div[2]","kind":"select","nearbyText":["Education","Highest level completed"],"options":["Secondary","Diploma","Bachelor'"'"'s"]}]}'
```

Request: `{ "fields": [{ "id", "kind", "nearbyText": [..], "options"?: [..], "cropPng"?: "<base64 PNG>" }] }`

Response `200`: `{ "labels": [{ "id", "label", "confidence" }] }`, one entry per input field, in request
order, `confidence` in 0..1. `{"fields":[]}` returns `{"labels":[]}` without calling the model.

Failures:

- `422`: the request body does not match the shape above, or `cropPng` is not valid base64.
- `502`: the model's answer cannot be used. Body:
  `{ "detail": { "error": "<reason>", "missingIds": ["<id>", ...] } }`. Reasons: `finish_reason` was
  not `stop` (for example `length`); the model returned empty content (DeepSeek documents that JSON
  mode "may occasionally return empty content"); the output was not valid labels JSON; or an id was
  not covered. The proxy never invents a label to fill a gap and never retries, so the caller must
  treat the fields in `missingIds` as still unlabeled.
- `500`: the upstream call itself failed and the SDK raised (bad key, rate limit, network, DeepSeek
  5xx). The client is built with `max_retries=0`, so there is no retry at any layer and no other
  model is tried.

CORS allows any origin (the caller is a `chrome-extension://<id>` page and this is a localhost dev
proxy), methods `POST` and `OPTIONS` only. FastAPI's `/docs`, `/redoc` and `/openapi.json` are off.

## How the model is asked

One user message per request. Each field is a text part holding `{id, kind, nearbyText, options}`,
immediately followed by an `image_url` part (`data:image/png;base64,<cropPng>`) when the field has a
crop, so the model can tie a crop to its id. JSON output mode follows DeepSeek's three documented
requirements: `response_format={"type":"json_object"}`, the word "json" plus an example of the exact
output shape in the system prompt, and an explicit `max_tokens`.

## Privacy rule

Per §6.4, only structure reaches this proxy: nearby text, options, control kind, and a crop of the
control taken before the user has typed anything. **Field values never leave the device.**

The proxy keeps that promise on its side:

- Logs contain field ids and counts only. `nearbyText`, `options`, images and model output are never
  logged. `test_main.py::test_logs_carry_ids_and_counts_but_never_structure_text` enforces this.
- Nothing is persisted: no database, no files, no cache.

Keep it that way when changing `main.py`.

## Test

```sh
uv run pytest -q
```

Tests replace the DeepSeek client with a stub (`StubDeepSeek` in `test_main.py`) and set
`DEEPSEEK_API_KEY=test-only`, so they need no key and make no network calls.

## Unverified

- **No live call to DeepSeek has been made.** Everything above the network is tested against a stub.
  Whether `deepseek-flash` accepts this exact request, and how good its labels are, is unknown until
  one request is sent with a real `DEEPSEEK_API_KEY`.
- **Image input together with JSON output mode.** DeepSeek's vision guide and JSON-mode guide each
  document their own feature; neither says whether the two can be combined in one request. This proxy
  combines them whenever a field has `cropPng`. If DeepSeek rejects the combination the SDK will raise
  and the caller sees `500`; if it accepts but returns empty content the caller sees `502`.
- How often JSON mode returns empty content in practice, and whether `max_tokens=16000` is a sensible
  ceiling for `deepseek-flash`.
