# Screen reader testing

The probe tells you what is **in the DOM**. A screen reader tells you what a user is
**told**. Those two diverge, and the divergence is the finding — `probe/` cannot detect a
silent step transition, and a DOM dump cannot tell you that a progress bar is visual-only.

## The trap

Testing with a screen reader while you can see the screen tells you almost nothing. You
unconsciously use visual position, colour and layout to orient, and you will conclude a
form is usable when it is not.

**Turn the screen off.** VoiceOver has Screen Curtain (Control + Option + Shift + F11): the display goes
black, VoiceOver keeps speaking. If you cannot complete the step with the curtain on, a
blind applicant cannot complete it either. That is the whole test.

## VoiceOver, minimum viable

Apple's docs write the VoiceOver modifier as **VO**. That is **Control + Option** held
together — it is the letters V and O, not a version number. So `VO + A` means
*Control + Option + A*, all three at once.

| Shortcut | Keys to press | Does |
|---|---|---|
| `Cmd + F5` | Command + F5 | Toggle VoiceOver on/off |
| `VO + Cmd + F8` | Control + Option + Command + F8 | Built-in tutorial — worth 15 minutes if this is your first time |
| `VO + Cmd + F10` | Control + Option + Command + F10 | **Caption panel**: shows every announcement as text on screen |
| `VO + Shift + F11` | Control + Option + Shift + F11 | Screen Curtain |
| `Tab` | Tab | Next focusable control (what a form user actually does) |
| `VO + →` / `VO + ←` | Control + Option + Arrow | Next/previous item, including non-focusable text |
| `VO + Space` | Control + Option + Space | Activate the item |
| `VO + A` | Control + Option + A | Read continuously from here |
| `VO + U` | Control + Option + U | Rotor — jump by heading, form control, landmark |
| `Control` | Control | Shut it up |

Two gotchas that waste everyone's first hour:

- **Function keys.** On most Macs `F5`/`F10`/`F11` need `Fn` held, unless *Keyboard →
  Use F1, F2, etc. as standard function keys* is on. If a shortcut does nothing, add `Fn`.
- **Shortcuts vary by macOS version.** If one does not fire, look it up in VoiceOver
  Utility rather than assuming the feature is missing.

Use the **caption panel**. It turns speech into text you can screenshot or copy into a
findings write-up, which is far more useful evidence than "it sounded wrong".

## Making it bearable

Default VoiceOver is tuned for someone fluent in it, and it is exhausting if you are not.
You are not obliged to work that way:

- **Mute speech, keep captions.** Caption panel on (Control + Option + Command + F10), speech muted
  (VoiceOver Utility → Speech, or Control + Option + S — confirm on your macOS version). You then read
  every announcement as text instead of hearing it. Best change a sighted developer can
  make, and captions are better evidence for a write-up anyway.
- **Drop the verbosity** in VoiceOver Utility → Verbosity.
- **Do not leave it running.** `Cmd + F5` for a focused session, then off.

Screen Curtain is the exception: for the pass that actually decides whether a flow works,
the screen goes off and the speech goes on. Everything else can be read.

## What you do not need a screen reader for

Most barrier detection is mechanical, and these are faster and silent:

- **DevTools → Elements → Accessibility pane** — computed name, role and state per element.
- **axe DevTools extension** — automated sweep.
- **`probe/`** — `bridge.scan()`.

Automated tooling catches roughly a third of real issues. What it structurally cannot
catch is what this document is for: whether a change is announced, where focus goes,
whether errors are spoken, whether the flow makes sense. Use the silent tools for the fast
loop and spend the listening time only on that residue — and on the side panel.

## Method

Run this per step, with the curtain on:

1. `Tab` through every control. For each, write down what was announced.
2. Compare against what `bridge.scan()` reported for the same step.
3. Note anything announced as just **"edit"**, **"button"**, **"blank"** or a bare value
   with no name — that is a `missing-label` a user actually hits.
4. Activate the forward action. **Listen.** Silence after a step change is a blocking
   barrier: the user does not know the form moved.
5. Note where focus lands after the transition. If it stays on a button that no longer
   exists, or resets to the top of the document, record it.

## What to listen for

| Question | Barrier if |
|---|---|
| Does anything announce the dialog opening? | Silence — the user does not know a form appeared |
| Is the step indicator spoken? | Visible progress with no announcement — length of the form is unknowable |
| Is each field named? | "edit, blank" with no label |
| Do radio/checkbox groups announce the question? | Options read without the question they answer |
| Is a step change announced? | Silence after Next |
| Where does focus go after Next? | Lost, or back to the top |
| Are errors announced? | Validation fails silently |

## VoiceOver is indicative, not conclusive

§6.6 targets **NVDA on Windows**, which is the most-used screen reader and behaves
differently from VoiceOver. A form can pass in VoiceOver and fail in NVDA. VoiceOver
findings are real findings — a barrier there is a barrier — but "works in VoiceOver" does
not discharge the NVDA requirement.

NVDA is free from nvaccess.org and needs Windows: a VM (UTM on Apple Silicon runs ARM
Windows), or a borrowed machine. Budget it as its own task, not as a quick check.

## Test the side panel too

BRIDGE is useless if BRIDGE is inaccessible (§6.6). The same method applies to the
extension's own side panel, and it is the one surface where a failure is entirely our
fault. Run the curtain test on it before demoing.
