# Applicant-side targets only: extension/ and proxy/ (bridge-user.md).
# The employer side (monitor/, dashboard/) is bridge-business.md's and is not covered here.
#
# `make test` runs everything automated. What it cannot cover stays manual by nature
# (focus, shortcuts from a real keyboard, VoiceOver): see manual-checks.md, which
# `make serve` + `make proxy` set up.

.PHONY: help test typecheck test-proxy test-extension build install serve proxy manual

test: typecheck test-proxy test-extension  ## Every automated user-side check: types, proxy 16, extension e2e 149

help:  ## List targets
	@grep -E '^[a-z-]+:.*##' Makefile | awk -F':.*## ' '{printf "  make %-16s %s\n", $$1, $$2}'

typecheck:  ## Extension typecheck (tsc --noEmit)
	cd extension && npm run typecheck

test-proxy:  ## Proxy unit tests (stubbed model, no key, no network)
	cd proxy && uv run pytest -q

test-extension:  ## Build the extension and drive it end to end in headless Chromium
	@if lsof -nP -iTCP:8765 -sTCP:LISTEN >/dev/null; then \
	  echo "Port 8765 is in use (probably 'make serve' for the manual checks)."; \
	  echo "Stop that first: the e2e suite starts its own server on 8765."; \
	  exit 1; \
	fi
	cd extension && npm run test:e2e

build:  ## Build the extension into extension/.output/chrome-mv3
	cd extension && npm run build

install:  ## One-time setup: npm install + uv sync
	cd extension && npm install
	cd proxy && uv sync

serve:  ## Manual checks: fixture pages on http://localhost:8765 (leave running, Ctrl+C to stop)
	cd extension && python3 -m http.server 8765 -d test/fixtures/acme

proxy:  ## Manual check 3 only: label-inference proxy on http://127.0.0.1:8000 (keep OFF for check 7)
	cd proxy && uv run --env-file ../.env uvicorn main:app --port 8000

manual: build  ## Build, then print how to start a manual pass
	@echo "1. chrome://extensions -> Developer mode -> Load unpacked -> extension/.output/chrome-mv3"
	@echo "   (already loaded? press its reload arrow instead)."
	@echo "2. chrome://extensions/shortcuts -> check Alt+Shift+B and Alt+Shift+S are bound."
	@echo "3. 'make serve' in another terminal, then follow manual-checks.md."
	@echo "   Check 3 also needs 'make proxy'; every other check runs with the proxy stopped."
