// Side panel: UI state and the user's pending answers until ACT confirms them (§5.1).
// The page DOM is the source of truth; nothing here is trusted over a read-back.
// The panel is also the one place that decides whether the page moved to a new step
// (§6.5): every trigger — open, page load, in-place change — ends in the same rescan.

import { inferLabels } from '../../lib/infer';
import { send, type Frame, type FormChanged, type WorkerEvent, type WorkerRequest } from '../../lib/messages';
import { buildReport, reportMarkdown } from '../../lib/report';
import type {
  ApplicationSession, Barrier, FieldDescriptor, FillResult, ScanResult, Severity, StepHint,
} from '../../lib/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** A field as the panel knows it: which frame it is in, and a key that survives a rescan
 *  (the content script's ids are positional and shift when fields appear). */
export type PanelField = FieldDescriptor & { frameId: number; localId: string; key: string };

type Reason = 'open' | 'manual' | 'tab' | 'page-loaded' | 'form-changed';

// --- target tab -----------------------------------------------------------------------
// Explicit ?tabId= wins, so the panel can be driven headlessly as an ordinary page (§8).
const fixedTab = new URLSearchParams(location.search).get('tabId');
let tabId: number | null = fixedTab ? Number(fixedTab) : null;

async function targetTab(): Promise<number> {
  if (tabId != null) return tabId;
  const [t] = await browser.tabs.query({ active: true, currentWindow: true });
  tabId = t?.id ?? null;
  if (tabId == null) throw new Error('No tab to work on.');
  return tabId;
}

async function worker<T>(req: WorkerRequest): Promise<T> {
  const res = await browser.runtime.sendMessage(req) as { ok: boolean; error?: string } & T;
  if (!res?.ok) throw new Error(res?.error || 'The BRIDGE service worker did not answer.');
  return res;
}

// --- the one live region (§6.6) -------------------------------------------------------
let announceTimer: number | undefined;
function announce(text: string) {
  const live = $('live');
  // Clear first so repeating the same sentence is still spoken.
  live.textContent = '';
  clearTimeout(announceTimer);
  announceTimer = window.setTimeout(() => { live.textContent = text; }, 60);
}

function diag(label: string, text: string) {
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = text;
  $('diag').append(dt, dd);
  console.log('[BRIDGE]', label, text);
}

// --- state ----------------------------------------------------------------------------
interface StepState {
  pageId: number;
  origin: string;
  url: string;
  index: number | null;
  total: number | null;
  heading: string;
  hint: StepHint | null;
  mainFrame: number;
  fingerprint: Set<string>;
}

let fields: PanelField[] = [];
let pageBarriers: Barrier[] = [];
let step: StepState | null = null;
let session: ApplicationSession | null = null;
/** True once VERIFY has run since the last write on this step: the gate on Alt+Shift+S. */
let verified = false;
let mode: 'one' | 'list' = 'one';
let current = 0;
/**
 * Names from label inference (§6.4), by field key, for the CURRENT step only. This map is
 * the single owner of an inferred name: a field's own `label` is never overwritten, so the
 * barrier report always carries what the page yielded, and a name inferred for one
 * question cannot follow its key onto a different question on the next step.
 */
const inferred = new Map<string, string>();
const nameOf = (f: PanelField) => inferred.get(f.key) ?? f.label;

const SEVERITY_WORD: Record<Severity, string> = { blocking: 'Blocking', usability: 'Usability', ok: 'OK' };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const fieldByKey = (key: string) => fields.find((f) => f.key === key);
const questionEl = (key: string) => [...$('questions').children].find((q) => (q as HTMLElement).dataset.key === key) as HTMLElement | undefined;
const firstControl = (key: string) => questionEl(key)?.querySelector<HTMLElement>('input, select, textarea') ?? null;

function labelText(f: PanelField) {
  return nameOf(f) + (inferred.has(f.key) || f.labelSource === 'nearby-text' || f.labelSource === 'none' ? ' (label inferred)' : '');
}

// --- rendering ------------------------------------------------------------------------

function summaryText() {
  const all = [...pageBarriers, ...fields.flatMap((f) => f.barriers)];
  const blocking = all.filter((b) => b.severity === 'blocking').length;
  return `${plural(fields.length, 'question')} found. ${plural(all.length, 'accessibility barrier')}, ${blocking} blocking.`;
}

function journeyText(s: StepState) {
  // "Step 1 of 1" is noise: a one-page form has no journey to describe.
  if (s.index && s.total && s.total > 1) {
    const next = s.hint?.steps?.[s.index];
    return `Step ${s.index} of ${s.total}: ${s.heading}.${next ? ` Next: ${next}.` : ''}`;
  }
  return '';
}

function renderBarriers() {
  const ul = $('barriers');
  ul.replaceChildren();
  const items: { sev: Severity; message: string; key?: string }[] = [
    ...pageBarriers.map((b) => ({ sev: b.severity, message: b.message })),
    ...fields.flatMap((f) => f.barriers.map((b) => ({ sev: b.severity, message: b.message, key: f.key }))),
  ].sort((a, b) => (a.sev === b.sev ? 0 : a.sev === 'blocking' ? -1 : 1));

  for (const item of items) {
    const li = document.createElement('li');
    const sev = document.createElement('span');
    sev.className = `sev sev-${item.sev}`;
    sev.textContent = `${SEVERITY_WORD[item.sev]}: `;
    if (item.key) {
      // Each barrier tied to a field jumps to that question (§4.1).
      const key = item.key;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.append(sev, document.createTextNode(item.message));
      btn.addEventListener('click', () => goTo(key));
      li.append(btn);
    } else {
      li.append(sev, document.createTextNode(item.message));
    }
    ul.append(li);
  }
}

/** What a question's controls were built from. A kept question whose options or range the
 *  page has since changed (country -> city) would offer answers that no longer exist. */
const builtFrom = (f: PanelField) => JSON.stringify([f.kind, f.options ?? null, f.range ?? null]);

function buildQuestion(f: PanelField): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'q';
  wrap.dataset.key = f.key;
  wrap.dataset.builtFrom = builtFrom(f);
  const ctlId = `ctl-${f.key.replace(/[^a-z0-9]+/gi, '-')}`;

  const position = document.createElement('h3');
  position.className = 'position';
  wrap.append(position);

  const hasOptions = (f.kind === 'select' || f.kind === 'combobox') && (f.options?.length ?? 0) > 0;

  if ((f.kind === 'radio-group' || f.kind === 'checkbox-group') && f.options?.length) {
    // A real group: the question as the legend, each option named by its own text.
    const fs = document.createElement('fieldset');
    const lg = document.createElement('legend');
    lg.className = 'name';
    fs.append(lg);
    if (f.required) fs.setAttribute('aria-required', 'true');
    f.options.forEach((opt, i) => {
      const lab = document.createElement('label');
      lab.className = 'choice';
      const r = document.createElement('input');
      r.type = f.kind === 'radio-group' ? 'radio' : 'checkbox';
      r.name = ctlId;
      r.value = opt;
      if (i === 0) r.id = ctlId;
      lab.append(r, document.createTextNode(` ${opt}`));
      fs.append(lab);
    });
    wrap.append(fs);
  } else {
    const lab = document.createElement('label');
    lab.className = 'name';
    lab.htmlFor = ctlId;
    let ctl: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (hasOptions) {
      const sel = document.createElement('select');
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = 'Choose an answer';
      sel.append(blank);
      for (const o of f.options!) {
        const opt = document.createElement('option');
        opt.value = o;
        opt.textContent = o;
        sel.append(opt);
      }
      ctl = sel;
    } else if (f.kind === 'textarea') {
      ctl = document.createElement('textarea');
      ctl.rows = 4;
    } else {
      const inp = document.createElement('input');
      inp.type = ({ checkbox: 'checkbox', file: 'file', slider: 'number', date: 'date' } as Record<string, string>)[f.kind] || 'text';
      if (f.kind === 'slider' && f.range) {
        inp.min = String(f.range.min);
        inp.max = String(f.range.max);
        inp.step = String(f.range.step);
      }
      ctl = inp;
    }
    ctl.id = ctlId;
    if (f.required) ctl.setAttribute('aria-required', 'true');
    if (f.kind === 'checkbox') wrap.append(ctl, lab); else wrap.append(lab, ctl);

    if (f.kind === 'combobox' && !hasOptions) {
      const note = document.createElement('p');
      note.className = 'note';
      note.id = `note-${ctlId}`;
      note.textContent = 'BRIDGE could not read this dropdown\'s options. Type the answer as it appears on the page.';
      ctl.setAttribute('aria-describedby', note.id);
      wrap.append(note);
    }
  }

  // Distinct accessible name per question: identical "Write to page" buttons would be
  // the very barrier BRIDGE reports on other people's forms.
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'write';
  const vh = document.createElement('span');
  vh.className = 'vh name-plain';
  btn.append(document.createTextNode('Write'), vh, document.createTextNode(' to page'));
  btn.addEventListener('click', () => void write(f.key, null));
  wrap.append(btn);

  if (f.kind === 'file' && storedCv) {
    // The CV picked on an earlier step, so a six-step application asks once (§6.3).
    const cv = storedCv;
    const reuse = document.createElement('button');
    reuse.type = 'button';
    reuse.className = 'reuse';
    reuse.textContent = `Write ${cv.name}, chosen earlier, to page`;
    reuse.addEventListener('click', () => void write(f.key, JSON.stringify(cv)));
    wrap.append(reuse);
  }

  const status = document.createElement('p');
  status.className = 'status';
  wrap.append(status);
  return wrap;
}

/** Names can change after the question is built: label inference arrives later (§6.4). */
function paintNames() {
  fields.forEach((f, i) => {
    const q = questionEl(f.key)!;
    q.querySelector('.position')!.textContent = `Question ${i + 1} of ${fields.length}`;
    q.querySelector('.name')!.textContent = labelText(f);
    q.querySelector('.name-plain')!.textContent = ` ${nameOf(f)}`;
  });
}

/** Keeps the questions that are still on the page — with whatever the user has typed —
 *  adds the new ones, drops the rest. `fresh` starts over: a new step. */
function renderQuestions(fresh: boolean) {
  const box = $('questions');
  const focusedKey = (document.activeElement?.closest('.q') as HTMLElement | null)?.dataset.key;
  const focusedId = document.activeElement?.id;
  if (fresh) box.replaceChildren();
  box.replaceChildren(...fields.map((f) => {
    const kept = questionEl(f.key);
    return kept && kept.dataset.builtFrom === builtFrom(f) ? kept : buildQuestion(f);
  }));
  paintNames();
  applyMode();
  // Moving a node blurs it; put focus back where the user was.
  if (focusedKey && focusedId && questionEl(focusedKey)) document.getElementById(focusedId)?.focus();
}

function applyMode() {
  current = Math.min(current, Math.max(0, fields.length - 1));
  [...$('questions').children].forEach((q, i) => { (q as HTMLElement).hidden = mode === 'one' && i !== current; });
  $('pager').hidden = mode === 'list' || fields.length < 2;
  $<HTMLButtonElement>('prev').disabled = current === 0;
  $<HTMLButtonElement>('next').disabled = current >= fields.length - 1;
}

function goTo(key: string) {
  const i = fields.findIndex((f) => f.key === key);
  if (i < 0) return;
  current = i;
  applyMode();
  firstControl(key)?.focus();
}

// --- answers ----------------------------------------------------------------------------

interface StoredCv { name: string; type: string; data: string }
let storedCv: StoredCv | null = null;
const cvKey = () => `cv:${tabId}`;

async function readAnswer(f: PanelField): Promise<string | null> {
  const q = questionEl(f.key)!;
  if (f.kind === 'radio-group') {
    const checked = q.querySelector<HTMLInputElement>('input[type=radio]:checked');
    return checked ? checked.value : null;
  }
  if (f.kind === 'checkbox-group') {
    // None ticked is an answer too: it clears the group on the page.
    return JSON.stringify([...q.querySelectorAll<HTMLInputElement>('input[type=checkbox]:checked')].map((c) => c.value));
  }
  const ctl = q.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')!;
  if (f.kind === 'checkbox') return (ctl as HTMLInputElement).checked ? 'checked' : 'not checked';
  if (f.kind === 'file') {
    const file = (ctl as HTMLInputElement).files?.[0];
    if (!file) return null;
    // Runtime messages are JSON; File objects do not cross (§6.3).
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return JSON.stringify({ name: file.name, type: file.type, data: btoa(bin) } satisfies StoredCv);
  }
  return ctl.value.trim() ? ctl.value : null;
}

async function write(key: string, given: string | null) {
  const f = fieldByKey(key);
  if (!f) return;
  const status = questionEl(key)!.querySelector('.status')!;
  const answer = given ?? await readAnswer(f);
  if (answer == null) {
    announce(`Choose an answer for ${nameOf(f)} first.`);
    firstControl(key)?.focus();
    return;
  }

  let res: FillResult;
  try {
    res = await send(await targetTab(), f.frameId, { type: 'bridge/fill', fieldId: f.localId, value: answer });
  } catch (e) {
    res = { fieldId: f.localId, ok: false, strategy: '', readBack: '', error: `Lost contact with the page. ${String(e)}` };
  }
  // The page changed, so the last read-back no longer describes it.
  verified = false;

  if (!res.ok) {
    // Never fail silently (§4.3).
    status.className = 'status fail';
    const detail = res.error || `The page shows "${res.readBack || 'nothing'}".`;
    status.textContent = `Could not fill: may need sighted help. ${detail}`;
    announce(`Could not fill ${nameOf(f)}. ${detail}`);
    return;
  }

  await recordFilled(key);
  const remembered = f.kind === 'file' ? await rememberCv(JSON.parse(answer) as StoredCv) : '';
  // Confirmation, announcement and focus move together, after the bookkeeping.
  status.className = 'status ok';
  status.textContent = `On the page: ${res.readBack}`;

  const i = fields.findIndex((x) => x.key === key);
  const next = fields[i + 1];
  announce(`${nameOf(f)}: ${res.readBack}. Confirmed on the page.${remembered}${next ? ` Next: ${nameOf(next)}.` : ' That was the last question.'}`);
  // Focus moves to the next question after each answer (§6.6).
  if (next) goTo(next.key); else $('verify').focus();
}

async function rememberCv(cv: StoredCv): Promise<string> {
  try {
    await browser.storage.session.set({ [cvKey()]: cv });
    storedCv = cv;
    return '';
  } catch (e) {
    // storage.session is capped (about 10 MB). A CV over it still uploaded; it just
    // cannot be offered again on a later step.
    diag('CV not remembered', String(e));
    return ' This file is too large for BRIDGE to remember, so a later step will ask for it again.';
  }
}

async function verifyAll(): Promise<boolean> {
  const id = await targetTab();
  const frameIds = [...new Set(fields.map((f) => f.frameId))];
  let byFrame;
  try {
    byFrame = await Promise.all(frameIds.map(async (frameId) => ({ frameId, results: await send(id, frameId, { type: 'bridge/read-back' }) })));
  } catch (e) {
    announce(`Could not read the page. ${String(e)}`);
    return false;
  }
  const ul = $('verify-results');
  ul.replaceChildren();
  const filled: string[] = [];
  const empty: string[] = [];
  for (const f of fields) {
    const r = byFrame.find((x) => x.frameId === f.frameId)?.results.find((x) => x.fieldId === f.localId);
    const li = document.createElement('li');
    const value = r?.found ? (r.value || 'empty') : 'no longer on the page';
    li.textContent = `${nameOf(f)}: ${value}`;
    ul.append(li);
    if (r?.found && r.value && r.value !== 'not checked') filled.push(`${nameOf(f)}, ${r.value}`);
    else empty.push(nameOf(f));
  }
  verified = true;

  let forward = null;
  try {
    forward = step ? await send(id, step.mainFrame, { type: 'bridge/forward-action', focus: false }) : null;
  } catch (e) {
    // The read-back above is still true and still worth hearing; only the button's name is missing.
    diag('Forward action', String(e));
  }
  announce(
    (filled.length ? `Your application contains: ${filled.join('. ')}.` : 'Nothing has been filled yet.') +
    (empty.length ? ` ${empty.length} ${empty.length === 1 ? 'question is' : 'questions are'} empty: ${empty.join(', ')}.` : '') +
    (forward
      ? ` BRIDGE never ${forward.submits ? 'submits' : 'moves on'} for you. Press Alt+Shift+S to move to the ${forward.name} button.`
      : ' BRIDGE never submits. Press the page\'s own submit button when you are ready.'),
  );
  return true;
}

/** Alt+Shift+S (§6.5): the first press on a step reads everything back; only the press
 *  after that moves focus to Continue or Submit. BRIDGE never presses it. */
async function forwardCommand() {
  if (!step) return;
  if (!verified) { await verifyAll(); return; }
  let forward;
  try {
    forward = await send(await targetTab(), step.mainFrame, { type: 'bridge/forward-action', focus: true });
  } catch (e) {
    announce(`BRIDGE could not reach the page. ${String(e)}`);
    return;
  }
  announce(forward
    ? `Focus is on the ${forward.name} button on the page. ${forward.submits ? 'Pressing it submits your application.' : 'Pressing it moves to the next step.'} BRIDGE never presses it.`
    : 'BRIDGE could not find a Continue or Submit button on this step.');
}

// --- session (§6.5) ---------------------------------------------------------------------

const sessionKey = (origin: string) => `session:${tabId}:${origin}`;

async function loadSession(origin: string) {
  const key = sessionKey(origin);
  const stored = (await browser.storage.session.get(key))[key] as ApplicationSession | undefined;
  // One session per tab and origin: an SSO detour to another origin leaves this one
  // untouched, and coming back resumes it.
  session = stored ?? { tabId: tabId!, origin, steps: [], currentStepIndex: 0, startedAt: new Date().toISOString() };
  storedCv = ((await browser.storage.session.get(cvKey()))[cvKey()] as StoredCv | undefined) ?? null;
}

async function recordStep(s: StepState, scannedAt: string, newStep: boolean) {
  if (!session || session.origin !== s.origin) await loadSession(s.origin);
  const sn = session!;
  const index = s.index ?? (newStep || !sn.steps.length ? sn.steps.length + 1 : sn.currentStepIndex);
  const scan = { url: s.url, scannedAt, fields: fields.map(({ frameId: _f, localId: _l, key: _k, ...d }) => d), pageBarriers, stepHint: s.hint };
  const existing = sn.steps.find((r) => r.index === index);
  if (existing) Object.assign(existing, { url: s.url, label: s.heading, scan });
  else sn.steps.push({ index, url: s.url, label: s.heading, scan, status: 'current', filledFieldIds: [] });
  for (const r of sn.steps) r.status = r.index === index ? 'current' : 'completed';
  sn.currentStepIndex = index;
  if (s.index && s.total) sn.journey = { index: s.index, total: s.total, labels: s.hint?.steps ?? [] };
  await browser.storage.session.set({ [sessionKey(sn.origin)]: sn });
}

async function recordFilled(key: string) {
  const record = session?.steps.find((r) => r.index === session!.currentStepIndex);
  if (!record || record.filledFieldIds.includes(key)) return;
  record.filledFieldIds.push(key);
  await browser.storage.session.set({ [sessionKey(session!.origin)]: session });
}

// --- scan -------------------------------------------------------------------------------

const jaccard = (a: Set<string>, b: Set<string>) =>
  [...a].filter((k) => b.has(k)).length / (new Set([...a, ...b]).size || 1);

let scanning = false;
let queued: Reason | null = null;

async function runScan(reason: Reason) {
  // A change that arrives mid-scan is not lost: one more scan runs after this one.
  if (scanning) { queued = reason; return; }
  scanning = true;
  try { await scanOnce(reason); } finally {
    scanning = false;
    if (queued) { const r = queued; queued = null; void runScan(r); }
  }
}

async function scanOnce(reason: Reason) {
  if (reason === 'open' || reason === 'tab') $('summary').textContent = 'Scanning the page…';
  let id: number;
  let frames: Frame[];
  let scans: { frame: Frame; scan: ScanResult }[];
  let pageId: number;
  const unresponsive: Frame[] = [];
  try {
    id = await targetTab();
    ({ frames } = await worker<{ frames: Frame[] }>({ type: 'bridge/prepare-frames', tabId: id }));
    ({ pageId } = await send(id, 0, { type: 'bridge/ping' }));
    const settled = await Promise.allSettled(frames.map((frame) => send(id, frame.frameId, { type: 'bridge/scan' })));
    const top = settled[0];
    if (top.status === 'rejected') throw top.reason;
    scans = [];
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled' && Array.isArray(r.value?.fields)) scans.push({ frame: frames[i], scan: r.value });
      else unresponsive.push(frames[i]);
    });
  } catch (e) {
    const msg = `BRIDGE cannot read this page. ${String(e)}`;
    $('summary').textContent = msg;
    announce(msg);
    fields = []; pageBarriers = []; step = null;
    renderBarriers();
    renderQuestions(true);
    return;
  }

  // --- merge frames. Top frame first, then each reachable frame (§4: an ATS is often an
  // iframe inside a careers page).
  const topScan = scans[0].scan;
  const merged: PanelField[] = [];
  for (const { frame, scan } of scans) {
    const seen = new Map<string, number>();
    for (const f of scan.fields) {
      const nameKey = `${f.kind}|${f.label}`;
      const n = seen.get(nameKey) || 0;
      seen.set(nameKey, n + 1);
      const key = `${frame.frameId}|${nameKey}|${n}`;
      merged.push({ ...f, frameId: frame.frameId, localId: f.id, id: `${frame.frameId}:${f.id}`, key });
    }
  }
  const reached = new Set(scans.map((s) => s.frame.origin));
  const barriers: Barrier[] = scans.flatMap((s) => s.scan.pageBarriers);
  for (const origin of topScan.iframeOrigins.filter((o) => !reached.has(o))) {
    barriers.push({ rule: 'cross-origin-frame-unreachable', severity: 'blocking',
      message: `Part of this page is a frame from ${new URL(origin).host} that BRIDGE cannot reach. Any questions inside it are not listed.` });
  }
  for (const frame of unresponsive) {
    barriers.push({ rule: 'cross-origin-frame-unreachable', severity: 'blocking',
      message: `A frame from ${new URL(frame.origin).host} did not answer BRIDGE. Any questions inside it are not listed.` });
  }

  // The frame holding the form speaks for the step: its stepper, its heading, its Continue.
  const main = scans.reduce((a, b) => (b.scan.fields.length > a.scan.fields.length ? b : a));
  const hint = main.scan.stepHint ?? topScan.stepHint;
  const now: StepState = {
    pageId, origin: new URL(topScan.url).origin, url: main.scan.url,
    index: hint?.index ?? null, total: hint?.total ?? null, heading: main.scan.heading, hint,
    mainFrame: main.frame.frameId,
    fingerprint: new Set(merged.map((f) => `${f.frameId}|${f.kind}|${f.label}`)),
  };

  // --- decide (§6.5). The page's own step index outranks the similarity heuristic.
  const prev = reason === 'tab' ? null : step;
  let verdict: 'first' | 'new-step' | 'fields-changed';
  let basis = '';
  if (!prev || prev.origin !== now.origin) { verdict = 'first'; basis = 'no previous scan'; }
  else if (prev.index !== null && now.index !== null && prev.index !== now.index) { verdict = 'new-step'; basis = 'step-index'; }
  else if (!prev.fingerprint.size && !now.fingerprint.size) { verdict = 'fields-changed'; basis = 'both empty'; }
  else {
    const sim = jaccard(prev.fingerprint, now.fingerprint);
    verdict = sim < 0.4 ? 'new-step' : 'fields-changed';
    basis = `field-similarity ${sim.toFixed(2)}${prev.url !== now.url ? ', url-change' : ''}`;
  }
  diag(`Scan (${reason})`, `verdict=${verdict} basis=${basis} step=${now.index ?? '?'}/${now.total ?? '?'} fields=${merged.length}`);

  // An answer typed but never written is lost when the step changes. Say so.
  const unwritten = verdict === 'new-step'
    ? fields.filter((f) => {
        const q = questionEl(f.key);
        const typed = q?.querySelector<HTMLInputElement>('input:not([type=radio]):not([type=checkbox]):not([type=file]), select, textarea')?.value.trim();
        return !!typed && !q!.querySelector('.status.ok');
      }).map(nameOf)
    : [];
  const before = new Set(fields.map((f) => f.key));

  fields = merged;
  pageBarriers = barriers;
  step = now;
  if (verdict !== 'fields-changed') { verified = false; current = 0; inferred.clear(); }

  await recordStep(now, topScan.scannedAt, verdict === 'new-step');
  const journey = journeyText(now);
  $('journey').textContent = journey;
  $('summary').textContent = summaryText();
  renderBarriers();
  renderQuestions(verdict !== 'fields-changed');
  // Same step, new document: the page reloaded. What the user typed here is kept, but
  // every "On the page" confirmation describes a document that no longer exists.
  const reloaded = verdict === 'fields-changed' && prev!.pageId !== now.pageId;
  if (reloaded) {
    verified = false;
    document.querySelectorAll('#questions .status').forEach((st) => { st.className = 'status'; st.textContent = ''; });
    $('verify-results').replaceChildren();
  }
  void offerAlwaysEnable(now.origin);

  if (verdict === 'first') {
    announce(`${journey ? `${journey} ` : ''}${summaryText()}`);
    if (mode === 'one' && fields.length && reason !== 'open') firstControl(fields[0].key)?.focus();
  } else if (verdict === 'new-step') {
    const where = journey || (now.total === 1 ? `New page: ${now.heading}.` : `New step: ${now.heading}. Total number of steps unknown.`);
    const lost = unwritten.length ? ` The page moved on before ${unwritten.join(', ')} was written; that answer was not saved.` : '';
    announce(`${where} ${summaryText()}${lost}`);
    if (fields.length) firstControl(fields[0].key)?.focus();
  } else {
    const added = fields.filter((f) => !before.has(f.key));
    if (reloaded) announce(`The page reloaded, so answers written before may be gone. ${summaryText()}`);
    else if (added.length) announce(`${plural(added.length, 'new question')} appeared: ${added.map(nameOf).join(', ')}.`);
    else if (reason === 'manual') announce(summaryText());
  }

  nameUnlabelled().catch((e) => { diag('Label inference', `failed: ${String(e)}`); announce(`Label inference failed. ${String(e)}`); });
}

// --- label inference (§6.4) ---------------------------------------------------------------

async function nameUnlabelled() {
  const unnamed = fields.filter((f) => f.labelSource === 'none' && !inferred.has(f.key));
  if (!unnamed.length) return;
  const asked = step;
  const result = await inferLabels(await targetTab(), unnamed, (m) => diag('Label inference', m));
  // The page may have moved on while the model was thinking. Names for a step that is no
  // longer showing are dropped, not applied to whatever took its place.
  if (step !== asked) { diag('Label inference', 'discarded: the step changed before the names arrived'); return; }
  if (!result.ok) {
    announce(`Label inference is unavailable, so ${plural(unnamed.length, 'question')} ${unnamed.length === 1 ? 'has' : 'have'} no name. ${result.error}`);
    return;
  }
  for (const { id, label } of result.labels) {
    const f = unnamed.find((x) => x.id === id);
    if (f && label.trim()) inferred.set(f.key, label.trim());
  }
  paintNames();
}

// --- always enable on this site (§4, third tier) --------------------------------------------

let enableOrigin = '';
async function offerAlwaysEnable(origin: string) {
  // optional_host_permissions covers https only, and a site already granted needs no button.
  const granted = origin.startsWith('https://') && await browser.permissions.contains({ origins: [`${origin}/*`] });
  enableOrigin = origin.startsWith('https://') && !granted ? origin : '';
  $('always-enable').hidden = !enableOrigin;
}

$('always-enable').addEventListener('click', () => {
  // permissions.request must be the first thing the click does: Chrome drops the user
  // gesture as soon as anything else is awaited.
  const origin = enableOrigin;
  browser.permissions.request({ origins: [`${origin}/*`] }).then(async (ok) => {
    if (!ok) { announce('BRIDGE was not enabled on this site. Nothing changed.'); return; }
    await worker({ type: 'bridge/register-site', origin });
    $('always-enable').hidden = true;
    announce(`BRIDGE is now always enabled on ${new URL(origin).host}. It will scan this site's application pages as they load.`);
  }).catch((e) => announce(`BRIDGE could not be enabled on this site. ${String(e)}`));
});

// --- barrier report (§6.7) --------------------------------------------------------------------

function download(name: string, type: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportReport(format: 'json' | 'md') {
  if (!session?.steps.length) { announce('There is nothing to export yet. Scan an application page first.'); return; }
  const report = buildReport(session);
  const name = `bridge-report-${report.portal}-${report.generatedAt.replace(/[:.]/g, '-')}.${format}`;
  if (format === 'json') download(name, 'application/json', JSON.stringify(report, null, 2));
  else download(name, 'text/markdown', reportMarkdown(report));
  announce(`Barrier report saved as ${name}. ${plural(report.barriers.length + report.pageBarriers.length, 'barrier')}. It contains none of your answers and nothing about you.`);
}

// --- day-1 spike: can the panel take keyboard focus when it opens? (§8) -----------------

function recordFocus(label: string) {
  const a = document.activeElement;
  diag(label, `panel has keyboard focus: ${document.hasFocus() ? 'yes' : 'no'}; ` +
    `active element: ${a ? a.tagName.toLowerCase() + (a.id ? `#${a.id}` : '') : 'none'}`);
}

function focusSpike() {
  recordFocus('On load');
  window.focus();
  $('title').focus();
  recordFocus('After focusing the heading');
  window.addEventListener('focus', () => recordFocus('Panel received focus'), { once: true });
}

// --- boot -----------------------------------------------------------------------------

$('rescan').addEventListener('click', () => void runScan('manual'));
$('verify').addEventListener('click', () => void verifyAll());
$('export-json').addEventListener('click', () => exportReport('json'));
$('export-md').addEventListener('click', () => exportReport('md'));
$('prev').addEventListener('click', () => { if (current > 0) goTo(fields[current - 1].key); });
$('next').addEventListener('click', () => { if (current < fields.length - 1) goTo(fields[current + 1].key); });

// A per-viewer convenience, so plain localStorage; nothing depends on it.
if (localStorage.getItem('bridge-mode') === 'list') mode = 'list';
document.querySelectorAll<HTMLInputElement>('input[name=mode]').forEach((r) => {
  r.checked = r.value === mode;
  r.addEventListener('change', () => {
    mode = r.value as 'one' | 'list';
    localStorage.setItem('bridge-mode', mode);
    applyMode();
    announce(mode === 'one' ? `One question at a time. Question ${current + 1} of ${fields.length}.` : `Full list. ${plural(fields.length, 'question')}.`);
  });
});

browser.runtime.onMessage.addListener((msg: WorkerEvent | FormChanged, sender) => {
  if (msg?.type === 'bridge/form-changed') {
    if (sender.tab?.id === tabId) void runScan('form-changed');
    return;
  }
  if (msg?.type === 'bridge/command-forward' && msg.tabId === tabId) { void forwardCommand(); return; }
  if (msg?.type === 'bridge/page-loaded' && msg.tabId === tabId) {
    // "complete" can fire again when an iframe finishes. Only a new document is a new page.
    send(msg.tabId, 0, { type: 'bridge/ping' }).then(
      (pong) => { if (pong.pageId !== step?.pageId) void runScan('page-loaded'); },
      () => void runScan('page-loaded'),
    );
  }
});

if (!fixedTab) {
  browser.tabs.onActivated.addListener(({ tabId: id }) => {
    tabId = id;
    session = null;
    void runScan('tab');
  });
}

focusSpike();
void runScan('open');
