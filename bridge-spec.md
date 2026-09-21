# BRIDGE: Spec

An accessibility compatibility layer for inaccessible job applications.

**Competition focus:** Stage 2, Job Search & Application
**Form factor:** Chrome / Edge extension (Manifest V3)
**Timeline:** 3-day hackathon

---

## 1. Problem

A visually impaired candidate can be fully qualified for a role and still be unable to apply independently because the application itself is inaccessible: unlabelled fields, mouse-only widgets, drag-and-drop uploaders, focus traps, visually dependent content.

Screen readers can read accessible pages. They cannot make a badly built control operable.

## 2. Goals and non-goals

### Goals (MVP)

- Tell the applicant, before they start, which parts of the current application page they will not be able to operate.
- Give them an accessible way to fill those parts through their existing screen reader.
- Write their input into the real page, then verify it landed by reading it back from the page.
- Keep the applicant in control: BRIDGE never submits.
- Produce an exportable barrier report (accessibility failures only, no applicant data) for the employer side of the pitch.

### Non-goals

- Applying on the user's behalf, auto-filling from a profile, or writing answers.
- Fixing the page for all users (that is the employer's job; BRIDGE reports it).
- Mobile support. Chrome on Android has no extensions; desktop-first is explicit.
- A hosted employer dashboard. The MVP exports a report; the dashboard is a mock for the pitch.
- Scanning steps of a multi-page application that have not been reached yet (see §10).

## 3. Users

| User | Needs |
|---|---|
| Blind / low-vision applicant using NVDA, JAWS, or Narrator | Know what's broken up front; fill every field without sighted help; confirm what will be submitted |
| Employer / recruitment platform (pitch only) | A concrete list of barriers in their application journey and why each blocks candidates |

## 4. User flow

```
Land on application page
  → BRIDGE detects known ATS domain, announces barrier count via live region
  → User presses Alt+Shift+B → side panel opens, focus moves to it
SCAN      side panel lists fields and barriers, grouped by severity
TRANSLATE user answers each field in the side panel with native controls
ACT       BRIDGE writes each answer into the real page control
VERIFY    BRIDGE re-reads every value from the page DOM and reads it back
  → User presses Submit on the real page themselves
```

On pages outside the supported ATS list, nothing is announced. The shortcut still works via `activeTab`.

### 4.1 SCAN

Output shown in the side panel:

```
Application pre-check
23 fields detected
4 accessibility barriers
  Blocking   Experience slider is not keyboard operable
  Blocking   CV uploader requires drag and drop
  Usability  Education dropdown has no accessible label
  OK         Submit button is accessible
```

Each item is a focusable list entry. Activating it jumps to that field's TRANSLATE control.

### 4.2 TRANSLATE

Each page control gets a native, correctly labelled equivalent in the side panel:

| Page control | Side panel control |
|---|---|
| Custom / visual slider | `<input type="number">` with min, max, step from the widget |
| Div-based dropdown | Native `<select>` with the extracted options |
| Drag-and-drop uploader | Native `<input type="file">` |
| Custom date picker | Native `<input type="date">` |
| Unlabelled text input | `<input>` with the inferred label, marked "label inferred" |

Two modes: **one question at a time** (default, conversational) and **full list** (for users who want to review everything).

### 4.3 ACT

Write the value into the real page control, then immediately read the control's value back from the DOM. If it doesn't match, mark the field **"Could not fill: may need sighted help"** and say so. Never fail silently.

See §6.3 for per-control strategies.

### 4.4 VERIFY

Triggered when the user reaches the end of the list or requests it.

- Re-read every mapped field **from the page DOM**, not from BRIDGE's own state. This is what catches ACT failures and anything the page reset (e.g. a framework re-render).
- Read back as a structured summary: "Your application contains: Name, Zheng Wei. Years of experience, 2. CV, resume.pdf. 1 field could not be filled: Start date."
- Then: "Ready. The Submit button is at the bottom of the page. Press Alt+Shift+S to move focus to it." BRIDGE moves focus; the user presses it.

## 5. Architecture

```
┌──────────────── Chrome ────────────────┐
│                                        │
│  Side panel (extension page)           │   Proxy (FastAPI, 1 endpoint)
│   UI, TRANSLATE controls, VERIFY       │──→  POST /infer-labels
│        │  chrome.tabs.sendMessage      │        │
│        ▼  (per frameId)                │        ▼
│  Content scripts (all frames)          │   Vision-capable LLM
│   SCAN, ACT, DOM read-back             │
│        ▲                               │
│  Service worker                        │
│   shortcuts, ATS detection, routing    │
└────────────────────────────────────────┘
```

### 5.1 Ownership

| Component | Owns | Does not own |
|---|---|---|
| Content script | Everything about the page: field discovery, barrier detection, writing values, reading values | UI, network calls |
| Side panel | UI state, user's pending answers until ACT confirms them | Truth about what's on the page |
| Service worker | Shortcut handling, ATS domain detection, opening the panel | Page or UI state |
| Proxy | API key, request shaping, stripping anything that isn't structure | Any persistence |

**Source of truth for field values is the page DOM.** The side panel holds a pending value only until ACT reads it back successfully.

### 5.2 Stack

- TypeScript, Manifest V3, built with WXT (handles side panel, content scripts, and reload during dev)
- Side panel UI: plain HTML + minimal Preact. Native elements only, no component library.
- `axe-core` bundled into the content script for standard rule checks
- Proxy: FastAPI, single endpoint, holds the LLM API key. No database.

### 5.3 Manifest essentials

```json
{
  "manifest_version": 3,
  "permissions": ["sidePanel", "activeTab", "scripting", "storage"],
  "host_permissions": [
    "https://*.myworkdayjobs.com/*",
    "https://boards.greenhouse.io/*",
    "https://job-boards.greenhouse.io/*",
    "https://jobs.lever.co/*",
    "http://localhost/*"
  ],
  "commands": {
    "open-bridge":   { "suggested_key": { "default": "Alt+Shift+B" } },
    "focus-submit":  { "suggested_key": { "default": "Alt+Shift+S" } }
  },
  "content_scripts": [{
    "matches": ["<same as host_permissions>"],
    "js": ["content.js"],
    "all_frames": true,
    "match_about_blank": true
  }]
}
```

No `<all_urls>`. Other sites work through `activeTab` when the user presses the shortcut. `debugger` permission is **not** in the MVP (see §6.3 fallbacks).

## 6. Components

### 6.1 Data model

```ts
type ControlKind =
  | "text" | "textarea" | "select" | "slider"
  | "file" | "date" | "checkbox" | "radio" | "unknown";

type Severity = "blocking" | "usability" | "ok";

interface Barrier {
  rule: BarrierRule;
  severity: Severity;
  message: string;          // spoken to the user as-is
}

interface FieldDescriptor {
  id: string;               // `${frameId}:${stablePath}`
  frameId: number;
  selector: string;         // resolvable inside that frame, pierces open shadow roots
  kind: ControlKind;
  label: string;
  labelSource: "aria" | "label-element" | "nearby-text" | "llm";
  required: boolean;
  options?: string[];       // select / radio / custom dropdown
  range?: { min: number; max: number; step: number };
  barriers: Barrier[];
}

interface ScanResult {
  url: string;
  scannedAt: string;
  fields: FieldDescriptor[];
  pageBarriers: Barrier[];  // not tied to a field, e.g. CAPTCHA, closed shadow root
}
```

### 6.2 SCAN: barrier rules

| Rule | Severity | Detection |
|---|---|---|
| `missing-label` | usability | axe-core `label`, `aria-input-field-name` |
| `not-keyboard-operable` | blocking | Element looks interactive (`cursor: pointer`, known widget class patterns, custom slider thumb) but has no focusable descendant and no ARIA role |
| `drag-drop-only` | blocking | Drop zone present and no reachable `input[type=file]` (missing, or `display:none` with no labelled trigger) |
| `focus-trap` | blocking | Programmatically step focus through the region; flag if focus cycles inside it with no path out |
| `custom-dropdown-no-role` | blocking | Div/ul-based option list with no `listbox` / `combobox` roles |
| `captcha` | blocking (page) | Known CAPTCHA iframes / widgets. BRIDGE cannot solve these; it tells the user in advance |
| `closed-shadow-root` | blocking (page) | Custom element with no accessible shadow root. BRIDGE can't reach inside |
| `cross-origin-frame-unreachable` | blocking (page) | Iframe BRIDGE has no permission for |

Heuristics run first. The LLM is only used to **infer labels and options** for fields where heuristics produce nothing useful.

### 6.3 ACT: write strategies

| Control | Primary | Fallback |
|---|---|---|
| Text / textarea (incl. React) | Native value setter from `HTMLInputElement.prototype`, then dispatch `input` and `change` | Focus + `document.execCommand("insertText")` |
| Native `<select>` | Set `value`, dispatch `change` | None needed |
| Custom dropdown | Click trigger, wait for options, click the option matching the text | Keyboard: focus trigger, arrow keys until option text matches |
| Native range | Native value setter + `input` / `change` | None needed |
| Custom slider | `pointerdown` / `pointermove` / `pointerup` at the x-coordinate for the value on the track's bounding box | If `role="slider"` and focusable: Home, then ArrowRight × n |
| Drag-and-drop uploader | Build `DataTransfer` with the `File`, dispatch `dragenter` / `dragover` / `drop` on the drop zone | Set `files` on the hidden `input[type=file]` via `DataTransfer`, dispatch `change` |
| Date picker | Find the underlying input, native setter + events | Stretch: drive the calendar UI |

**Every write is followed by a read-back.** Mismatch → field marked as failed, user told.

**File transfer:** the user picks the CV in the side panel. The panel reads it as base64 and sends `{ name, type, data }` to the content script (runtime messages are JSON, `File` objects don't cross), which reconstructs the `File`.

**Known limit:** synthetic events have `isTrusted: false`. Some widget libraries ignore them. The escape hatch is `chrome.debugger` + CDP `Input.dispatchMouseEvent`, which produces trusted events but adds an install warning and a "being debugged" banner. Only add it if a target portal requires it.

### 6.4 LLM label inference

Request to proxy:

```json
{
  "fields": [{
    "id": "0:form>div[3]>div[2]",
    "kind": "select",
    "nearbyText": ["Education", "Highest level completed"],
    "options": ["Secondary", "Diploma", "Bachelor's", "Master's", "PhD"],
    "cropPng": "<base64, optional>"
  }]
}
```

Response: `{ id, label, confidence }[]`. Labels from the LLM are always shown as **"label inferred"** so the user knows it's a guess.

**Privacy rule:** only structure goes to the proxy (nearby text, options, roles, a cropped screenshot of the control). Scan happens before the user types anything, so crops contain no answers. **Field values never leave the device.**

### 6.5 Side panel accessibility requirements

BRIDGE is useless if BRIDGE itself is inaccessible.

- Native HTML elements only. Proper `<h1>`–`<h3>` structure so users can navigate by heading.
- One `aria-live="polite"` region for status ("Slider set to 2 years", "Could not fill Start date").
- Visible and programmatic focus management: focus moves into the panel on open, to the next question after each answer.
- Zero axe violations on the panel.
- Tested end to end with NVDA on Windows before demo.

### 6.6 Barrier report (employer side, MVP)

"Export barrier report" in the side panel produces Markdown + JSON:

```json
{
  "portal": "boards.greenhouse.io",
  "pagePath": "/acme/jobs/12345",
  "generatedAt": "2026-09-24T10:00:00Z",
  "barriers": [
    { "rule": "drag-drop-only", "severity": "blocking",
      "selector": "#cv-dropzone",
      "impact": "A screen reader user cannot attach a CV." }
  ]
}
```

Contains no field values and no applicant identity. Sending it anywhere is a manual user action in the MVP. Continuous monitoring and ATS integration stay in the pitch as the roadmap.

## 7. Test fixtures

Demos against real portals are fragile. Build **"Acme Careers"**, a deliberately inaccessible React application form served from `localhost`, containing exactly the barriers in the pitch:

- Years-of-experience slider with no role and no keyboard support
- Drag-and-drop-only CV uploader
- Education dropdown built from divs, no label
- Date picker with a focus trap
- A normal accessible Submit button

Plus at least **one real portal** posting for credibility. Never submit to a real employer during testing; stop at VERIFY.

## 8. Build plan

**Day 1: tracer bullet**
- WXT skeleton, side panel opens on Alt+Shift+B, content script in all frames
- On Acme Careers: detect the slider and one text field, fill both from the side panel, read both back
- If the custom slider fill doesn't work by end of day, decide on the `debugger` fallback now, not on day 3

**Day 2: breadth**
- All §6.2 rules on the fixture
- Custom dropdown, file upload, date picker ACT strategies
- Proxy + LLM label inference for the unlabelled dropdown
- VERIFY read-back and focus-to-submit

**Day 3: reality and polish**
- One real portal end to end (stop before submit)
- Full NVDA pass on the side panel; fix everything it finds
- Barrier report export + employer dashboard mock for the pitch
- Record a fallback demo video in case live demo breaks

## 9. Demo script

1. Open Acme Careers with NVDA running. Try to use the slider with the keyboard. Nothing happens.
2. BRIDGE announces "4 barriers found". Press Alt+Shift+B.
3. SCAN list read aloud.
4. Answer "Years of experience: 2". Split screen: the real slider moves.
5. Pick a CV in the side panel. The drop zone on the page shows it attached.
6. VERIFY summary read aloud. Focus moves to Submit. User submits.
7. Export barrier report. Show the employer view.

## 10. Risks and open questions

| Risk | Mitigation |
|---|---|
| Widgets ignore untrusted events | Day 1 test; `debugger` fallback decided early |
| Cross-origin iframes (common on Workday) | Host permissions for the iframe origins of supported portals; otherwise report `cross-origin-frame-unreachable` |
| Multi-step applications | MVP scans each step as it renders. **Pitch says BRIDGE "analyses the entire application journey"; adjust to "each step as you reach it" unless later steps are already in the DOM** |
| Page re-renders wipe BRIDGE's writes | VERIFY reads from DOM, so this surfaces as a failed field instead of a silent error |
| LLM infers a wrong label | Always marked "label inferred"; user can hear the nearby text themselves |
| CAPTCHA at the end | Detected in SCAN and announced up front; out of scope to solve |

**Open questions**
- Which real portal do we target on day 3: Greenhouse (simpler DOM) or Workday (more common, harder)?
- Do judges need to install it themselves? If yes, submit an unlisted Chrome Web Store build on day 1.
- Is conversational voice input (speech-to-text in the panel) worth it, or does the screen reader's own input suffice? Default: skip.
