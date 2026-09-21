# BRIDGE: User spec

An accessibility compatibility layer for inaccessible job applications.

This spec covers the applicant side: the extension. The employer side (business model, monitor,
dashboard) is in [`bridge-business.md`](bridge-business.md).

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
- Produce an exportable barrier report (accessibility failures only, no applicant data) for the employer side ([`bridge-business.md`](bridge-business.md)).

### Non-goals

- Applying on the user's behalf, auto-filling from a profile, or writing answers.
- Fixing the page for all users (that is the employer's job; BRIDGE reports it).
- Mobile support. Chrome on Android has no extensions; desktop-first is explicit.
- Anything employer-facing beyond the report export. That is [`bridge-business.md`](bridge-business.md).
- Scanning steps of a multi-page application that have not been reached yet (see §6.5). BRIDGE reads the page's own step indicator to describe the journey; it does not fetch ahead.

## 3. Users

| User | Needs |
|---|---|
| Blind / low-vision applicant using NVDA, JAWS, or Narrator | Know what's broken up front; fill every field without sighted help; confirm what will be submitted |
| Employer / recruitment platform (see [`bridge-business.md`](bridge-business.md)) | A concrete list of barriers in their application journey and why each blocks candidates |

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

BRIDGE works on **any** page. What differs by site is whether it runs by itself:

| Tier | Mechanism | Behaviour |
|---|---|---|
| Built-in ATS list | Static `host_permissions` + declared content scripts | Scans on load and announces the barrier count. Also reaches an ATS iframe embedded in a company careers page |
| Any page, on demand | `activeTab`, granted by the Alt+Shift+B shortcut | Scans when the user asks. Silent until then |
| User-added site | `optional_host_permissions` + `chrome.permissions.request` + `chrome.scripting.registerContentScripts` | "Always enable BRIDGE on this site" in the side panel. From then on behaves like the built-in list |

No `<all_urls>`: its install warning, *"Read and change all your data on all websites"*, is the
wrong first impression for a tool asking blind applicants to trust it, and scanning every
page would announce barriers on pages that are not applications.

Why the third tier matters. Per Chrome's documentation, `activeTab` access **survives
same-origin navigation but is revoked on cross-origin navigation**, and it covers the main
frame's origin only. So on a portal outside the list, a single-sign-on detour or a redirect
to the employer's own ATS silently disconnects BRIDGE mid-application, and the user would
have to press the shortcut again. Adding the site removes that. Even on the same origin, a
full page load discards an injected content script, so the service worker re-injects on
`tabs.onUpdated` while `activeTab` still holds.

Chrome's permission prompt appears when the user adds a site. Include it in the NVDA pass.

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

On a multi-step application this runs **before every forward move**, not only at the end,
and `Alt+Shift+S` targets Continue rather than Submit on every step but the last. Once
Continue is pressed the previous step's DOM is gone and read-back is no longer possible.
See §6.5.

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
    "https://jobs.ashbyhq.com/*",
    "https://*.vietnamworks.com/*",
    "https://www.linkedin.com/*",
    "http://localhost/*"
  ],
  "optional_host_permissions": ["https://*/*"],
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

No `<all_urls>`; see the tiers in §4. User-added sites are registered at runtime with
`chrome.scripting.registerContentScripts` after `chrome.permissions.request` succeeds, which
must be called from a user gesture (a button in the side panel). `debugger` permission is
**not** in the MVP (see §6.3 fallbacks).

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

interface StepHint {
  via: "workday-progressBar" | "aria-current=step" | "text" | "progressbar";
  index?: number;           // 1-based, when the page publishes it
  total?: number;
  text?: string;            // e.g. "2/4 pages"
  steps?: string[];         // full journey, when published (Workday)
}

interface ScanResult {
  url: string;
  scannedAt: string;
  fields: FieldDescriptor[];
  pageBarriers: Barrier[];  // not tied to a field, e.g. CAPTCHA, closed shadow root
  stepHint: StepHint | null;
}
```

### 6.2 SCAN: barrier rules

| Rule | Severity | Detection |
|---|---|---|
| `missing-label` | usability | axe-core `label`, `aria-input-field-name` |
| `not-keyboard-operable` | blocking | Element looks interactive (`cursor: pointer`, known widget class patterns, custom slider thumb) but has no focusable descendant and no ARIA role |
| `drag-drop-only` | blocking | File input is **out of the tab order** — `tabindex=-1`, `disabled`, `display:none`, `visibility:hidden` or `inert` — and has no labelled trigger. Visually hidden is *not* out of the tab order; that is the standard accessible pattern |
| `upload-unnamed` | usability | File input is keyboard-reachable but has no accessible name, so it is heard only as a generic file button |
| `focus-trap` | blocking | **Not detectable by SCAN.** Scripted Tab presses do not move focus, so tab order can only be observed from real keypresses. Checked manually with `bridge.watchTab()` in `probe/`. Note that focus looping from a dialog's last control back to its first is *correct* modal behaviour, not a trap |
| `custom-dropdown-no-role` | blocking | Div/ul-based option list with no `listbox` / `combobox` roles |
| `captcha` | blocking (page) | Known CAPTCHA iframes / widgets. BRIDGE cannot solve these; it tells the user in advance |
| `closed-shadow-root` | blocking (page) | Custom element with no accessible shadow root. BRIDGE can't reach inside |
| `cross-origin-frame-unreachable` | blocking (page) | Iframe BRIDGE has no permission for |
| `modal-without-dialog-role` | blocking (page) | A visible popup containing form controls, with no `role="dialog"` / `role="alertdialog"` / `aria-modal` on it or any ancestor. Nothing announces it opened |
| `group-not-labelled` | blocking | Two or more checkboxes or radios sharing a `name`, with no `fieldset`+`legend` and no `role="group"`/`radiogroup"` carrying a name. The question itself is unreachable |
| `label-placeholder-only` | usability | The only name comes from `placeholder`. It vanishes on input and several screen readers skip it |
| `options-identically-named` | blocking | Two or more options in one group compute to the **same** accessible name. `aria-label` overrides element contents, so a question stamped onto every option erases "Yes" and "No" |

Heuristics run first. The LLM is only used to **infer labels and options** for fields where heuristics produce nothing useful.

**Skip `aria-hidden` subtrees before evaluating anything.** They are invisible to a screen
reader, so they are neither fields to offer nor barriers to report. Omitting this check
produced 7 false `missing-label` barriers on the Greenhouse fixture — all of them
react-select's hidden `required` input, which exists only to trigger native form
validation. With the check in place that form reports zero field-level barriers, which is
correct. A tool that cries wolf about a well-built form is worse than no tool: it trains
the user to ignore it, and it makes the §6.7 employer report indefensible.

### 6.3 ACT: write strategies

| Control | Primary | Fallback | Status |
|---|---|---|---|
| Text / textarea (incl. React) | Native value setter from `HTMLInputElement.prototype`, then dispatch `input` and `change` | Focus + `document.execCommand("insertText")` | **verified** on Greenhouse and LinkedIn |
| Native `<select>` | Set `value`, dispatch `change` | None needed | — |
| Custom dropdown | Synthetic `mousedown` + `mouseup` on the control, wait for options, same on the option matching the text | None that works — see below | **verified** on Greenhouse (react-select) |
| Native range | Native value setter + `input` / `change` | None needed | — |
| Custom slider | `pointerdown` / `pointermove` / `pointerup` at the x-coordinate for the value on the track's bounding box | If `role="slider"` and focusable: Home, then ArrowRight × n | untested — no real portal in §11 had one |
| Uploader (incl. drag-and-drop) | Build a `File`, set `input.files` from a `DataTransfer`, dispatch `change` | Dispatch `dragenter` / `dragover` / `drop` carrying the `DataTransfer` on the drop zone | **verified** on Greenhouse and Ashby; fallback unverified |
| Date picker | Find the underlying input, native setter + events | Stretch: drive the calendar UI | untested |

**Synthetic events are good enough.** The `isTrusted: false` risk did not materialise on
any portal measured in §11, across three unrelated component layers: React, react-select,
and LinkedIn's own library. React's synthetic event system does not check `isTrusted`, and
react-select — the most common custom dropdown in the ATS world — opens, enumerates and
selects from untrusted `mousedown`. `chrome.debugger` stays out of the MVP.

**The keyboard fallback for dropdowns does not work.** Synthetic `ArrowDown` on a
react-select combobox leaves `aria-expanded="false"`; the library's handler does not fire.
Click is not the primary strategy with a keyboard safety net — it is the only strategy.
If a widget ignores synthetic mouse events, ACT fails and the field is reported as
**"Could not fill: may need sighted help"**.

**Options do not exist until the widget is opened.** Every one of the 13 react-select
dropdowns on the Greenhouse fixture returns zero options to a DOM query while closed.
`FieldDescriptor.options` therefore cannot be populated by reading; SCAN has to open each
custom dropdown, harvest the options, and close it again. That makes SCAN a phase with
timing and failure modes, not a parse — budget for it. It also means §6.4's LLM payload
can only carry `options` for widgets SCAN successfully opened.

**Uploaders: the primary and fallback are the other way round from what the drag-and-drop
framing suggests.** `input.value` cannot be set from script in any browser on any OS, and
no extension or OS API changes that. But a `File` constructed in the page and assigned via
`DataTransfer` is accepted — this is pure web platform and behaves identically on macOS,
Windows, Linux and ChromeOS. It worked on both portals with real uploaders, including
Ashby, whose visible affordance is a drop zone. Reach for the synthetic `drop` only when a
widget reads `e.dataTransfer` and never looks at `input.files`.

**Every write is followed by a read-back.** Mismatch → field marked as failed, user told.

**File transfer:** the user picks the CV in the side panel. The panel reads it as base64 and sends `{ name, type, data }` to the content script (runtime messages are JSON, `File` objects don't cross), which reconstructs the `File`.

Hold those bytes in `chrome.storage.session` for the life of the application so the user
picks the CV once rather than once per step — a six-step Workday application would
otherwise ask six times. `storage.session` is memory-only and cleared when the browser
closes. Never `storage.local`, and never near the proxy: under §6.4 this is applicant data.

**Why the side panel's own file input is the whole trick.** A native `<input type="file">`
is already accessible: a screen reader announces it as a button, Enter opens the **OS file
picker**, and Finder and the Windows common dialog are both fully navigable with
VoiceOver, NVDA, JAWS and Narrator. Uploading is a solved problem for blind users. The
barrier is only ever that the page destroyed the control — Ashby's file input is 1px wide,
`tabindex="-1"` and has no accessible name, leaving a drop zone as the sole affordance.
BRIDGE is not inventing an accessible upload; it is restoring the one the site removed, by
offering a correctly labelled native input and injecting the resulting bytes.

**Known limit:** synthetic events have `isTrusted: false` and some widget libraries ignore
them. This did not bite on any portal in §11, so `chrome.debugger` + CDP
`Input.dispatchMouseEvent` stays out of the MVP — it adds an install warning and a "being
debugged" banner. Revisit only if a target portal proves to need it.

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

### 6.5 Multi-step applications

Most applications are one page. Greenhouse, Lever and Ashby all render the whole form at
once. **Workday is the multi-step case**, so this is one adapter's worth of work, not a
general rewrite.

#### What the page will tell you

Workday publishes the entire journey on step 1, before the user has entered anything:

```
current step 1 of 6  Create Account/Sign In
        step 2 of 6  My Information
        step 3 of 6  My Experience
        step 4 of 6  Application Questions
        step 5 of 6  Voluntary Disclosures
        step 6 of 6  Review
```

So BRIDGE can honestly say *"this application has 6 steps, you are on 2, next is My
Experience"* without scanning anything it has not reached. Read the page's own stepper —
`[data-automation-id=progressBar]` on Workday, otherwise `aria-current="step"`, a
`role="progressbar"`, or a `Step N of M` text match. When none is found, say "step 2,
total number of steps unknown" and leave it at that.

Note that step 1 is **account creation**, so the session has to survive a sign-in detour
and, on some tenants, an SSO round trip to another origin.

#### The content script will be destroyed

Clicking "Apply Manually" on Workday triggers a **full document navigation**, not a
client-side route change. An instrumented page confirmed it: everything on `window` was
gone afterwards. So:

> The content script owns nothing that must outlive a step. It is disposable and
> re-derives everything from the DOM on load. Continuity lives in the service worker and
> the side panel, which survive page navigation.

This is already the §5.1 ownership split — it just has to be enforced rather than assumed.

#### One detector for three kinds of transition

Steps change by full navigation (Workday), by SPA route change, or by an in-place DOM swap
with no URL change at all (LinkedIn Easy Apply). Rather than three code paths, decide from
the form's contents — but **the page's own step index outranks any heuristic**:

```ts
// 1. Scope to the region that actually swaps. A modal wins over the form: on
//    LinkedIn the search page behind the dialog never goes away.
//    Two traps, both found by measurement:
//    - `<dialog>` has an implicit dialog role but NO role attribute, so
//      '[role=dialog]' misses it. LinkedIn Easy Apply uses a native <dialog>.
//    - A page can hold a dialog with no controls at all (Greenhouse has a banner
//      like this), so prefer the narrowest candidate that actually contains controls.
const scope = () => {
  const candidates = [
    ...document.querySelectorAll('dialog[open]'),
    ...document.querySelectorAll('[role=dialog][aria-modal="true"]'),
    ...document.querySelectorAll('dialog'),
    ...document.querySelectorAll('[role=dialog]'),
    ...document.querySelectorAll('form'),
  ];
  return candidates.find(el => countVisibleControls(el) > 0) || document.body;
};

// 2. A Set, keyed on accessible name where there is one. Ten identically-keyed
//    radios are one signal, not ten.
const fingerprint = () => new Set(
  [...scope().querySelectorAll(SEL)]
    .filter(e => e.offsetParent !== null)
    .map(e => `${e.tagName}:${e.type || e.getAttribute('role') || ''}:${e.getAttribute('aria-label') || e.name || e.id || ''}`)
);

const jaccard = (a, b) =>
  [...a].filter(k => b.has(k)).length / (new Set([...a, ...b]).size || 1);

// 3. Decide.
const indexMoved = nowStepIndex !== null && prevStepIndex !== null && nowStepIndex !== prevStepIndex;
const verdict = indexMoved          ? 'new-step'        // the page said so
              : jaccard(prev, now) < 0.4 ? 'new-step'   // inferred
              : 'fields-changed';
```

Fed by three sources collapsing into one evaluation: script load (full navigation), patched
`history.pushState`/`replaceState` plus `popstate` (SPA routing), and a debounced
`MutationObserver` (in-place swaps).

Record which basis produced each verdict (`step-index` vs `field-similarity`). When the
heuristic and the index disagree, the index is right and the threshold needs tuning.

**Both refinements came from a measured failure**, not from theory. Against LinkedIn Easy
Apply the naive version — fingerprinting `document`, counting duplicates with
`Array.filter` — measured a genuine Contact-info → Resume transition as **0.63 similar and
classified it "same step"**. Two compounding causes:

- Fingerprinting the whole document counted the page *behind* the modal. LinkedIn's search
  boxes and nav persist across every step, so they inflate similarity on every comparison.
- `now.filter(k => prev.includes(k)).length` counts duplicates, and the resume step renders
  ten radios that fingerprint identically. The ratio exceeded what the previous field set
  could possibly match.

Scoping to the dialog and comparing sets drops that transition to **0.0 similar**. The step
index caught it regardless, which is the argument for reading the stepper first.

**The similarity heuristic still earns its keep** for the conditional-field case — "you
answered Yes, three new fields appeared" — which happens within a step and has no index to
read. It is the fallback, not the primary signal.

#### Session state

Keyed by `tabId` in `chrome.storage.session` (memory-only, cleared on browser close):

```ts
interface ApplicationSession {
  tabId: number;
  origin: string;
  steps: StepRecord[];        // one per step reached
  currentStepIndex: number;
  journey?: { index: number; total: number; labels: string[] };  // from the page's stepper
  startedAt: string;
}

interface StepRecord {
  index: number;
  url: string;
  label: string;              // "My Experience", from the stepper or the page heading
  scan: ScanResult;
  status: "current" | "completed";
  filledFieldIds: string[];   // ids only — never values
}
```

The session goes dormant, not destroyed, when the tab leaves the origin: that is usually an
SSO detour, not an abandoned application. The side panel does not reload on page
navigation, so its UI state stays continuous on its own.

#### Announce every step change

On a `new-step` event the panel announces the new position through its live region:
"Step 2 of 4: Resume", using `stepHint.index` / `total` and the step's heading. If there's no
index, it says "New step: Resume". Measured on LinkedIn Easy Apply: the page itself says
nothing when the step changes (§11), so this is the one piece of orientation a screen reader
user gets. Announce once per transition, not per mutation: `fields-changed` events stay quiet
unless a conditional field actually appeared.

#### VERIFY runs per step

**This is a change to §4.4.** Once the user presses Continue, the previous step's DOM is
gone and read-back is impossible. So VERIFY fires before *each* forward move, not once at
the end. Generalise `Alt+Shift+S` from "focus Submit" to **"focus the primary forward
action"** — Continue on steps 1..n-1, Submit on step n — and gate it behind that step's
VERIFY. BRIDGE still never presses it.

The barrier report (§6.7) then accumulates across every step the user walked, grouped by
step. That is the honest and considerably stronger version of "analyses the entire
application journey".

#### Out of scope

Do not pre-fetch later steps. Fetching the next URL without session state returns nothing
useful, and POSTing to advance the wizard is submitting on the user's behalf — barred by
§2 and by the promise BRIDGE makes to the applicant.

### 6.6 Side panel accessibility requirements

BRIDGE is useless if BRIDGE itself is inaccessible.

- Native HTML elements only. Proper `<h1>`–`<h3>` structure so users can navigate by heading.
- One `aria-live="polite"` region for status ("Slider set to 2 years", "Could not fill Start date").
- Visible and programmatic focus management: focus moves into the panel on open, to the next question after each answer.
- Zero axe violations on the panel.
- Tested end to end with NVDA on Windows before demo.

Test it the way a user experiences it: **with the screen off.** VoiceOver's Screen Curtain
(Control + Option + Shift + F11) or NVDA on a blanked display. Testing while sighted lets you orient
visually and will pass a panel that is not usable. Method and checklist in
`probe/screen-reader-testing.md`.

VoiceOver on macOS is the fast loop during development, but it is **indicative, not
conclusive**: NVDA behaves differently and is what the requirement above names. A barrier
found in VoiceOver is real; passing VoiceOver does not discharge the NVDA pass.

### 6.7 Barrier report (employer side, MVP)

"Export barrier report" in the side panel produces Markdown + JSON. The monitor in
[`bridge-business.md`](bridge-business.md) §6.2 writes the same JSON, so one scanned page
produces one report whichever side produced it:

```json
{
  "portal": "boards.greenhouse.io",
  "pagePath": "/acme/jobs/12345",
  "generatedAt": "2026-09-24T10:00:00Z",
  "barriers": [
    { "rule": "drag-drop-only", "severity": "blocking",
      "label": "CV upload",
      "impact": "A screen reader user cannot attach a CV." }
  ],
  "pageBarriers": [
    { "rule": "captcha", "severity": "blocking",
      "impact": "A screen reader user cannot verify they are not a bot." }
  ]
}
```

It is a projection of one `ScanResult` (§6.1), flattened:

| Report | Comes from |
|---|---|
| `portal` | `location.host` of the scanned page, port included |
| `pagePath` | `location.pathname`. **The query string is excluded** — see below |
| `generatedAt` | `ScanResult.scannedAt` |
| `barriers[]` | Every `FieldDescriptor.barriers` entry, in page order, each carrying its field's `label` |
| `barriers[].impact` | `Barrier.message`. The same sentence, renamed at the boundary: it is spoken to the applicant and read by the employer |
| `pageBarriers[]` | `ScanResult.pageBarriers`, which belong to no field and so carry no `label` |

Fields with no barriers do not appear. The report carries no field values, no applicant
identity, and no `stepHint`.

**`label` is required on every `barriers[]` entry, and there is no `selector`.** The
dashboard compares two scans of the same form by `rule` + `label` for field-level barriers
and by `rule` alone for `pageBarriers` (`bridge-business.md` §6.1). A generated selector
changes whenever the vendor ships a release, which would report every barrier as
simultaneously resolved and new; `FieldDescriptor` has no `selector` to emit in any case.
An earlier draft of this example carried one. A producer may add `selector` for a human
reading the JSON, but nothing may key on it.

**Why `pagePath` drops the query string.** The comparison groups reports by
`portal` + `pagePath`, so that is the identity of a form across time. Postings on the
portals in §11 put the job in the path. It also lets the Acme fixture's `?v=2` / `?v=3`
(`bridge-business.md` §6.5) stand in for the same form changing between scans, which is
the employer demo.

Sending the report anywhere is a manual user action in the MVP. This format is the contract
with the employer dashboard and monitor in [`bridge-business.md`](bridge-business.md) §6;
change it here, not there.

## 7. Test fixtures

Demos against real portals are fragile. Build **"Acme Careers"**, a deliberately inaccessible React application form served from `localhost`, containing exactly the barriers in the pitch:

- Years-of-experience slider with no role and no keyboard support
- Drag-and-drop-only CV uploader
- Education dropdown built from divs, no label
- Date picker with a focus trap
- A normal accessible Submit button

Note that the fixture's barriers should now be chosen to *match what real portals
actually do* (§11), not what is easiest to build. Of the five barriers listed above, the
drag-and-drop uploader and the unlabelled dropdown are real and common; a keyboard-dead
custom slider was not found on any portal measured. Keep it — it demos well and slider
widgets do exist in the wild — but do not let it crowd out the two barriers that turned up
on real applications and are not in the list at all: a **popup that is not a dialog**, and
**checkbox groups whose question has no programmatic name**.

The fixture also needs a **multi-step mode**, or §6.5 has nothing to be tested against:

- an in-place step swap inside a native `<dialog>` with a "1/3 pages" indicator (LinkedIn's shape)
- a full-page-navigation variant with a "step 1 of 3" stepper (Workday's shape)
- on one step, a Yes/No radio group whose options both carry the question as `aria-label`
  (`options-identically-named`, the headline LinkedIn finding)
- a dropdown whose options are only rendered after it is opened (react-select's shape)

Plus at least **one real portal** posting for credibility. Never submit to a real employer
during testing; stop at VERIFY. `probe/` scans live portals without submitting and is the
tool for keeping §11 honest as postings expire.

## 8. Build plan

**Day 1: tracer bullet**
- **First: the side panel focus spike.** §4 assumes focus moves into the panel when it opens.
  Chrome's documentation does not say whether an extension can do that. If it cannot, the
  user has to reach the panel themselves (F6 cycles browser panes), and the opening flow
  changes. Settle it before building on it
- WXT skeleton, side panel opens on Alt+Shift+B, content script in all frames
- On Acme Careers: SCAN, then fill **one custom dropdown** from the side panel and read it
  back. A dropdown rather than the slider, because the dropdown strategy is proven on real
  portals (§11) and the slider was found on none
- Port SCAN from `probe/scan.js` and the write strategies from `probe/act-inpage.js`
  rather than rediscovering them
- The side panel takes its target `tabId` explicitly instead of querying the active tab, so
  the whole loop can be driven headlessly with the panel opened as an ordinary page

**Day 2: breadth**
- **Field identity across re-renders.** A `FieldDescriptor` must be re-resolved when the
  framework replaces the element, not held as a node reference. Re-find by selector, then by
  accessible name and position as a fallback, and report "Could not fill" if both fail
- **Harvest options from custom dropdowns during SCAN** (open, read, close), §6.3
- All §6.2 rules on the fixture, including `options-identically-named`, `group-not-labelled`
  and `modal-without-dialog-role`
- The fixture's multi-step mode, the step detector, and "Step N of M" announcements (§6.5)
- Per-step VERIFY and focus-to-forward-action
- "Always enable BRIDGE on this site" (§4, third tier)

**Day 3: reality and polish**
- Greenhouse end to end, stopping before submit. Re-run `probe/` first; postings expire
- LinkedIn Easy Apply by hand: the visa question answered through BRIDGE
- Proxy + LLM label inference, if time allows. It is not on the critical path: every
  demo field has a label or a derivable one
- Full NVDA pass on the side panel; fix everything it finds
- Barrier report export (§6.7). The dashboard and monitor are in `bridge-business.md` §8
- Record a fallback demo video

## 9. Demo script

1. Open Acme Careers with NVDA running. Try to use the slider with the keyboard. Nothing happens.
2. BRIDGE announces "4 barriers found". Press Alt+Shift+B.
3. SCAN list read aloud.
4. Answer "Years of experience: 2". Split screen: the real slider moves.
5. Pick a CV in the side panel. The drop zone on the page shows it attached.
6. VERIFY summary read aloud. Focus moves to Submit. User submits.
7. Export barrier report. Hand over to the employer demo, `bridge-business.md` §7.

## 10. Risks and open questions

| Risk | Status | Mitigation |
|---|---|---|
| Widgets ignore untrusted events | **retired** | Measured across §11: synthetic mouse events drive react-select and React inputs. `debugger` stays out of the MVP |
| Cross-origin iframes (common on Workday) | live | Confirmed on Workday, Lever, Ashby and LinkedIn. Host permissions for supported origins; otherwise report `cross-origin-frame-unreachable` |
| Multi-step applications | **resolved** | §6.5. Workday publishes its whole 6-step journey up front, so the "entire application journey" claim holds — sourced from the page's stepper, not from scanning ahead |
| Page re-renders wipe BRIDGE's writes | live | VERIFY reads from DOM, so this surfaces as a failed field instead of a silent error |
| LLM infers a wrong label | live | Always marked "label inferred"; user can hear the nearby text themselves |
| CAPTCHA at the end | live | Present on **every** real portal measured. Detected in SCAN and announced up front; out of scope to solve |
| Custom dropdown options unreadable until opened | new | SCAN must open each widget to enumerate. Adds timing and failure modes to SCAN (§6.3) |
| Barrier detection cries wolf | new | Skip `aria-hidden` subtrees (§6.2). A false blocking barrier on a well-built form discredits both the tool and the employer report |
| Login wall before the form | new | VietnamWorks blocks at step zero. BRIDGE reports and locates it; see the credential note below |

**Credentials are not in scope.** The VietnamWorks barrier is an unlabelled sign-in popup,
so "fixing" it means BRIDGE handling an email and password. That is a far heavier trust
proposition than writing `2` into a years-of-experience field, and it breaks the clean
privacy story in §6.4. BRIDGE **reports and locates** the login barrier — "a sign-in dialog
opened, it is not announced, the username field is here" — and leaves filling it to the
user's password manager. Say this out loud in the pitch; it reads as judgement, not as a gap.

**Open questions**
- ~~Which real portal do we target on day 3?~~ **Greenhouse for the live demo** — every ACT
  strategy already passes there, it is one page, and the DOM is stable. **VietnamWorks for
  the barrier story**, where the failure is starkest. Workday appears as a screenshot of
  its 6-step journey, not as a live demo: account creation is step 1 and cannot be
  demonstrated against a real employer.
- Do judges need to install it themselves? If yes, submit an unlisted Chrome Web Store build on day 1.
- Is conversational voice input (speech-to-text in the panel) worth it, or does the screen reader's own input suffice? Default: skip.
- ~~Is LinkedIn Easy Apply worth supporting?~~ **Yes, and it is measured** (§11). Its controls
  work and BRIDGE can fill every type it uses; its labelling and step transitions do not. The
  identically-named Yes/No on the visa question is the headline demo.
- Can an extension move keyboard focus into its side panel? Undocumented. Day-1 spike (§8).

## 11. Portal findings (measured)

Measured 2026-09-21 against live postings with `probe/`. Read-only page loads; no
accounts, no credentials, nothing submitted. Postings expire — re-run `probe/` rather than
trusting these numbers indefinitely.

| Portal | Rendering | Steps | Field barriers | Page barriers |
|---|---|---|---|---|
| Greenhouse (GitLab) | server-rendered + React | 1 | **0** | CAPTCHA, cross-origin frame |
| Lever (Palantir) | server-rendered | 1 | 6 | 4 × `group-not-labelled`, hCaptcha, cross-origin frames |
| Ashby (Cohere) | pure SPA | 1 | 2 | `drag-drop-only`, reCAPTCHA, cross-origin frame |
| Workday (NVIDIA) | SPA + hard navs | **6** | — (behind sign-in) | cross-origin frame |
| VietnamWorks | SPA | 1 + login wall | 3 | **`modal-without-dialog-role`** |
| LinkedIn Easy Apply | SPA, in-place modal | **4** | **0** on step 1 | cross-origin frames |

### What actually works

| Strategy | Result |
|---|---|
| React text input via prototype value setter | **PASS** — survived re-render on Greenhouse |
| Custom dropdown via synthetic `mousedown` | **PASS** — opened, enumerated 3 options, selected, read back on Greenhouse react-select |
| Custom dropdown via synthetic keyboard | **FAIL** — `aria-expanded` stayed `false` |
| File upload via `DataTransfer` → `input.files` | **PASS** on Greenhouse *and* Ashby; page rendered the filename both times |
| File upload via synthetic `drop` | unverified — the one attempt resolved the wrong element as the drop zone |

### Notes per portal

**Greenhouse — the best demo target.** Zero field-level barriers once `aria-hidden`
subtrees are skipped; the form is genuinely well built, and its uploader is a real labelled
`input[type=file]`. The drag-and-drop uploader in the pitch is an **Ashby** barrier, not a
Greenhouse one. All 13 dropdowns are react-select and expose no options while closed.

**Lever — the best barrier for the employer story.** The Palantir form contains **0
`<fieldset>`, 0 `role="group"`, 0 `aria-labelledby`**. A 33-checkbox group asking "Language
Skill(s)" has no programmatic name at all, so a screen reader announces "English, checkbox,
required" and the question itself is unreachable. Text fields are fine — they use implicit
label wrapping.

**Workday — the multi-step reference.** Publishes all six step names on step 1 (§6.5).
"Apply Manually" is a full document navigation, which destroys the content script. Every
element carries `data-automation-id`, giving stable selectors across all tenants — worth an
adapter keyed on those. Its own stepper is six `<label>` elements with no associated
control, each carrying `aria-live="polite"`: six live regions that can all fire on one
re-render. Put that in the barrier report.

**VietnamWorks — the starkest barrier found.** Clicking Apply opens a login wall that is
not a dialog:

```
elements with role=dialog or aria-modal on page:  0
focusable elements still reachable BEHIND popup:  150
username input:  aria-label=null placeholder="" label[for]=false wrapped=false
password input:  aria-label=null placeholder="" label[for]=false wrapped=false
```

Neither credential field has an accessible name by any mechanism. Focus does move into the
popup, but it lands on an unnamed input, so a screen reader announces roughly *"edit,
blank"* — no indication that a login wall appeared or what it wants. The applicant cannot
get through the front door. Failure at step zero, on a major regional board, reproducible
in two clicks.

**LinkedIn — mostly a router, and the best-built form measured.** Across 20 jobs over 5
queries and regions: **9 offsite, 7 onsite (Easy Apply), 4 indeterminate.** An initial
6/6-offsite sample was biased toward large-company engineering roles. So roughly half of
LinkedIn traffic lands on an ATS BRIDGE already handles.

**Easy Apply, measured by hand** in a logged-in browser with the console probe (it is
behind a login and must not be automated — see `probe/README.md`):

- **4 steps**, published as `1/4 pages` in the modal. Third portal with a readable journey
  indicator, which is what makes "read the stepper" the general strategy rather than a
  Workday special case. Note the phrasing: a `Step N of M` regex alone misses it.
- Step 1 (Contact info): **5 fields, 0 barriers.** Labels properly associated.
- Both dropdowns are **native `<select>`** with options enumerable while closed (1 and
  249 respectively). No synthetic-event work needed — this is the one control type that
  needs nothing from §6.3.
- The step transition fires with **no URL change**, via `MutationObserver` only. The
  in-place-swap branch of the detector is load-bearing here, and this is the run that
  found the two bugs described in §6.5.
- LinkedIn's modals carry `role="dialog"`, `aria-modal="true"` and `aria-labelledby`.

**Walked end to end, 2026-09-21**, on two employers' Easy Apply flows (Univers, 4 steps;
Binance, **10 steps**) with the console probe. Nothing submitted.

Confirmed:

- **`group-not-labelled` on steps 2 and 3**, two instances on step 3. The same failure as
  Lever (§11), on LinkedIn's own form. Step 2 is the resume radio list.
- **The resume uploader is `upload-unnamed`, not `drag-drop-only`.** An earlier draft of
  this section reported `drag-drop-only` from step 2 onward. That came from a rule bug which
  treated "visually hidden" as "unreachable". The Binance file input is `tabIndex=0`, so it
  is in the tab order and a keyboard user can reach it. What it lacks is an accessible name.
  That is a usability barrier, not a blocking one. Re-scan Univers with the fixed rule to
  confirm it matches.
- **Step count varies enormously by employer** — 4 vs 10 for the same flow. BRIDGE cannot
  assume a short journey, and ten unannounced transitions is a different problem from four.
- **Focus never moves into the new step.** Transitions left focus either on the `Next`
  button or on `BODY` (the no-focus state). Either way the user is not taken to the new
  content.
- The modal is a **native `<dialog>`**, not `[role=dialog]` — see §6.5.
- **Step 3 uses `div[role="radio"]` wrapping a native `input[type=radio]`.** The ARIA
  wrapper carries the accessible name; the native input inside it computes to no name at
  all. Two `group-not-labelled` barriers fire on this step, one per question
  (sponsorship, work authorisation).
- **Writes land on it.** `click` on the wrapper's native input sets `checked` and reads
  back. Confirmed after fixing a probe routing bug that had sent ARIA radios to the
  combobox strategy — the first `ACT FAIL` here was the probe's fault, not LinkedIn's.

**The strongest finding in the whole survey**, verified directly from the DOM rather than
inferred:

```
text: 'Yes', ariaLabel: 'Will you now or in the future require sponsorship for employment visa status?'
text: 'No',  ariaLabel: 'Will you now or in the future require sponsorship for employment visa status?'
fieldset: legend null, aria-label null, aria-labelledby null
```

`aria-label` overrides element contents, so **both options compute to the same accessible
name** and the words "Yes" and "No" are never spoken.

**Confirmed by ear**, VoiceOver on macOS, 2026-09-21: each option announces the question and
its position — "1 of 2", "2 of 2" — and never its label. Worth noting how that sounds to a
sighted tester: the question is there, the count is there, and it seems to mostly work.
You can see that option 1 is Yes. A blind applicant is guessing, on a visa question. A screen reader user hears the same
sentence twice and has no way to tell the options apart. The question is unanswerable
without sighted help — and it is the work-authorisation question.

Note how it happened: the fieldset has no legend, and someone compensated by stamping the
question onto every option's `aria-label`. The group gained a name; the options lost
theirs. This is not neglect, it is a well-intentioned fix that inverted itself — which is
exactly the class of defect that survives internal review, because the page looks correct
and the code looks conscientious.

**What BRIDGE does about it.** TRANSLATE offers a correctly built native group — a
`fieldset` with the question as its `legend` and options named "Yes" and "No" — and ACT
writes the choice back by clicking the real control, a strategy already verified on these
exact elements. An unanswerable question becomes answerable. That is the demo.

Re-run with correct dialog scoping gave `similarity: 0` on both step transitions, so with
the right scope the heuristic agrees with the step index rather than depending on it.

**This run validated reading the stepper as ground truth.** A scoping bug (below) inflated
every similarity score. Against the 0.4 threshold, similarity alone would have classified
three of five real step changes as "same step". All five were caught by `basis=step-index`.
The heuristic is genuinely the fallback; the page's own step indicator is the signal.

Caveats on the numbers: barriers were counted document-wide while the scope bug was live,
so some may belong to the search page behind the modal, and focus was sampled at a
debounced mutation rather than after settling. Both are resolved by re-running.

**Dropdowns, 2026-09-21 (Binance step 4, VoiceOver):**

- **Operable once focused.** The native `<select>`s change value with the arrow keys, and
  VoiceOver announces "Yes" / "No" as the value changes. The control itself is fine.
- **LinkedIn's focus trap only acts at the edges.** A logged run of real Tab presses showed
  the page did *not* intercept Tab in the middle of the form. It intercepted only on the last
  control, looping focus back to the close button. That is correct modal behaviour. It rules
  out the suspected cause, a trap that leaves dropdowns out of its list.
- **Tab reaches them. Not a barrier.** A logged run of real Tab presses went through the whole
  dialog in order, close button → both selects → both textareas → Back → Next, with nothing
  skipped and no interception except the loop at the end. The earlier reports of Tab skipping
  a dropdown (macOS and Windows) were not reproduced. The most likely explanation is the
  loop-around itself: pressing Tab on Next jumps focus to the top of the dialog, past every
  field, which looks and sounds like skipping. The tool made the same mistake before it was
  fixed. The Windows report stays open until it is re-run from the control *before* a dropdown.

**Step transitions are silent** (VoiceOver, Univers, 2026-09-21). After Next, no step name,
number or total is announced. The user discovers the new step only by reaching new fields.
"1/4 pages" is on screen throughout but isn't spoken when the step changes. That makes it
a usability barrier rather than a blocking one: the user can go on, but loses their place,
and on Binance's 10 steps that happens ten times. (VoiceOver not confirming the button press
itself is normal screen reader behaviour and is not a finding.)

**BRIDGE's fix is nearly free.** The §6.5 detector already fires on each step change and
reads `index` / `total` from the page's stepper, so the side panel announces
"Step 2 of 4: Resume" through its single live region. This is cheap and clearly audible,
and it belongs in the demo.

**Status of the modal-wizard questions** a label-and-role scan cannot answer on its own:

| Question | Answer |
|---|---|
| Is the step change announced? | **No** — by ear, VoiceOver |
| Where does focus go after Next? | Stays on Next, or drops to `BODY`. Never into the new step |
| Is "1/4 pages" spoken? | Not on step change. Whether it can be reached by reading is untested |
| Does the resume list name its question? | **No** — `group-not-labelled` |
| Do BRIDGE's writes land? | **Yes** — text, native select and ARIA radio all pass ACT with DOM read-back |
| Are validation errors spoken? | **Untested.** Needs an invalid step submitted and listened to |
| Tab skipping dropdowns (reported on Windows) | Not reproduced on macOS. Windows re-run pending, starting from the control *before* the dropdown |

Nothing was submitted.

**Positioning.** BRIDGE is assistive technology, not automation: the user drives every
action and BRIDGE never submits (§2). That distinction matters on LinkedIn specifically,
which restricts automated access and has a history of acting against extensions. Keep it
true — no auto-advance, no bulk apply, no background activity — and say it plainly in the
pitch.
