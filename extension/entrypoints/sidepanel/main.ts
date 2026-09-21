// Side panel: UI state and the user's pending answers until ACT confirms them (§5.1).
// The page DOM is the source of truth; nothing here is trusted over a read-back.

import { send } from '../../lib/messages';
import type { FieldDescriptor, FillResult, ScanResult, Severity } from '../../lib/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

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

// --- the one live region (§6.6) -------------------------------------------------------
let announceTimer: number | undefined;
function announce(text: string) {
  const live = $('live');
  // Clear first so repeating the same sentence is still spoken.
  live.textContent = '';
  clearTimeout(announceTimer);
  announceTimer = window.setTimeout(() => { live.textContent = text; }, 60);
}

// --- state ----------------------------------------------------------------------------
let scan: ScanResult | null = null;

const SEVERITY_WORD: Record<Severity, string> = { blocking: 'Blocking', usability: 'Usability', ok: 'OK' };

function controlId(f: FieldDescriptor) { return `ctl-${f.id}`; }

function firstControl(f: FieldDescriptor): HTMLElement | null {
  return document.querySelector<HTMLElement>(`#q-${f.id} input, #q-${f.id} select, #q-${f.id} textarea`);
}

// --- rendering ------------------------------------------------------------------------

function renderSummary(r: ScanResult) {
  const all = [...r.pageBarriers, ...r.fields.flatMap((f) => f.barriers)];
  const blocking = all.filter((b) => b.severity === 'blocking').length;
  const step = r.stepHint?.index && r.stepHint.total ? ` Step ${r.stepHint.index} of ${r.stepHint.total}.` : '';
  const text = `${r.fields.length} question${r.fields.length === 1 ? '' : 's'} found. ` +
    `${all.length} accessibility barrier${all.length === 1 ? '' : 's'}, ${blocking} blocking.${step}`;
  $('summary').textContent = text;
  return text;
}

function renderBarriers(r: ScanResult) {
  const ul = $('barriers');
  ul.replaceChildren();
  const items: { sev: Severity; message: string; field?: FieldDescriptor }[] = [
    ...r.pageBarriers.map((b) => ({ sev: b.severity, message: b.message })),
    ...r.fields.flatMap((f) => f.barriers.map((b) => ({ sev: b.severity, message: b.message, field: f }))),
  ].sort((a, b) => (a.sev === b.sev ? 0 : a.sev === 'blocking' ? -1 : 1));

  for (const item of items) {
    const li = document.createElement('li');
    const sev = document.createElement('span');
    sev.className = `sev sev-${item.sev}`;
    sev.textContent = `${SEVERITY_WORD[item.sev]}: `;
    if (item.field) {
      // Each barrier tied to a field jumps to that question (§4.1).
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.append(sev, document.createTextNode(item.message));
      const f = item.field;
      btn.addEventListener('click', () => firstControl(f)?.focus());
      li.append(btn);
    } else {
      li.append(sev, document.createTextNode(item.message));
    }
    ul.append(li);
  }
}

function labelText(f: FieldDescriptor) {
  return f.label + (f.labelSource === 'nearby-text' || f.labelSource === 'none' ? ' (label inferred)' : '');
}

function renderQuestion(f: FieldDescriptor, index: number, total: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'q';
  wrap.id = `q-${f.id}`;

  const hasOptions = (f.kind === 'select' || f.kind === 'combobox') && (f.options?.length ?? 0) > 0;

  if ((f.kind === 'radio-group' || f.kind === 'checkbox-group') && f.options?.length) {
    // A real group: the question as the legend, each option named by its own text.
    const fs = document.createElement('fieldset');
    const lg = document.createElement('legend');
    lg.textContent = labelText(f);
    fs.append(lg);
    if (f.required) fs.setAttribute('aria-required', 'true');
    f.options.forEach((opt, i) => {
      const lab = document.createElement('label');
      lab.className = 'choice';
      const r = document.createElement('input');
      r.type = f.kind === 'radio-group' ? 'radio' : 'checkbox';
      r.name = controlId(f);
      r.value = opt;
      if (i === 0) r.id = controlId(f);
      lab.append(r, document.createTextNode(` ${opt}`));
      fs.append(lab);
    });
    wrap.append(fs);
  } else {
    const lab = document.createElement('label');
    lab.htmlFor = controlId(f);
    lab.textContent = labelText(f);
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
    ctl.id = controlId(f);
    if (f.required) ctl.setAttribute('aria-required', 'true');
    if (f.kind === 'checkbox') wrap.append(ctl, lab); else wrap.append(lab, ctl);

    if (f.kind === 'combobox' && !hasOptions) {
      const note = document.createElement('p');
      note.className = 'note';
      note.id = `note-${f.id}`;
      note.textContent = 'BRIDGE could not read this dropdown\'s options. Type the answer as it appears on the page.';
      ctl.setAttribute('aria-describedby', note.id);
      wrap.append(note);
    }
  }

  const btn = document.createElement('button');
  btn.type = 'button';
  // Distinct accessible name per question: identical "Write to page" buttons would be
  // the very barrier BRIDGE reports on other people's forms.
  btn.innerHTML = '';
  btn.append(document.createTextNode('Write'));
  const vh = document.createElement('span');
  vh.className = 'vh';
  vh.textContent = ` ${f.label}`;
  btn.append(vh, document.createTextNode(' to page'));
  btn.addEventListener('click', () => void write(f, index, total));
  wrap.append(btn);

  const status = document.createElement('p');
  status.className = 'status';
  status.id = `status-${f.id}`;
  wrap.append(status);
  return wrap;
}

function renderQuestions(r: ScanResult) {
  const box = $('questions');
  box.replaceChildren(...r.fields.map((f, i) => renderQuestion(f, i, r.fields.length)));
}

// --- answers ----------------------------------------------------------------------------

async function readAnswer(f: FieldDescriptor): Promise<string | null> {
  const q = $(`q-${f.id}`);
  if (f.kind === 'radio-group') {
    const checked = q.querySelector<HTMLInputElement>('input[type=radio]:checked');
    return checked ? checked.value : null;
  }
  if (f.kind === 'checkbox-group') {
    // None ticked is an answer too: it clears the group on the page.
    return JSON.stringify([...q.querySelectorAll<HTMLInputElement>('input[type=checkbox]:checked')].map((c) => c.value));
  }
  const ctl = $(controlId(f)) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  if (f.kind === 'checkbox') return (ctl as HTMLInputElement).checked ? 'checked' : 'not checked';
  if (f.kind === 'file') {
    const file = (ctl as HTMLInputElement).files?.[0];
    if (!file) return null;
    // Runtime messages are JSON; File objects do not cross (§6.3).
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return JSON.stringify({ name: file.name, type: file.type, data: btoa(bin) });
  }
  return ctl.value.trim() ? ctl.value : null;
}

async function write(f: FieldDescriptor, index: number, total: number) {
  const status = $(`status-${f.id}`);
  const answer = await readAnswer(f);
  if (answer == null) {
    announce(`Choose an answer for ${f.label} first.`);
    firstControl(f)?.focus();
    return;
  }

  let res: FillResult;
  try {
    res = await send(await targetTab(), { type: 'bridge/fill', fieldId: f.id, value: answer });
  } catch (e) {
    res = { fieldId: f.id, ok: false, strategy: '', readBack: '', error: `Lost contact with the page. ${String(e)}` };
  }

  if (res.ok) {
    status.className = 'status ok';
    status.textContent = `On the page: ${res.readBack}`;
    const next = scan && index + 1 < total ? scan.fields[index + 1] : null;
    announce(`${f.label}: ${res.readBack}. Confirmed on the page.${next ? ` Next: ${next.label}.` : ' That was the last question.'}`);
    // Focus moves to the next question after each answer (§6.6).
    if (next) firstControl(next)?.focus();
    else $('verify').focus();
  } else {
    // Never fail silently (§4.3).
    status.className = 'status fail';
    const detail = res.error || `The page shows "${res.readBack || 'nothing'}".`;
    status.textContent = `Could not fill: may need sighted help. ${detail}`;
    announce(`Could not fill ${f.label}. ${detail}`);
  }
}

async function verifyAll() {
  let results;
  try {
    results = await send(await targetTab(), { type: 'bridge/read-back' });
  } catch (e) {
    announce(`Could not read the page. ${String(e)}`);
    return;
  }
  const ul = $('verify-results');
  ul.replaceChildren();
  const filled: string[] = [];
  const empty: string[] = [];
  for (const r of results) {
    const li = document.createElement('li');
    const value = r.found ? (r.value || 'empty') : 'no longer on the page';
    li.textContent = `${r.label}: ${value}`;
    ul.append(li);
    if (r.found && r.value && r.value !== 'not checked') filled.push(`${r.label}, ${r.value}`);
    else empty.push(r.label);
  }
  announce(
    (filled.length ? `Your application contains: ${filled.join('. ')}.` : 'Nothing has been filled yet.') +
    (empty.length ? ` ${empty.length} ${empty.length === 1 ? 'question is' : 'questions are'} empty: ${empty.join(', ')}.` : '') +
    ' BRIDGE never submits. Press the page\'s own submit button when you are ready.',
  );
}

// --- scan -------------------------------------------------------------------------------

async function runScan() {
  $('summary').textContent = 'Scanning the page…';
  try {
    const id = await targetTab();
    await browser.runtime.sendMessage({ type: 'bridge/ensure-content-script', tabId: id });
    scan = await send(id, { type: 'bridge/scan' });
  } catch (e) {
    const msg = `BRIDGE cannot read this page. ${String(e)}`;
    $('summary').textContent = msg;
    announce(msg);
    return;
  }
  const text = renderSummary(scan);
  renderBarriers(scan);
  renderQuestions(scan);
  announce(text);
}

// --- day-1 spike: can the panel take keyboard focus when it opens? (§8) -----------------

function recordFocus(label: string) {
  const a = document.activeElement;
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = `panel has keyboard focus: ${document.hasFocus() ? 'yes' : 'no'}; ` +
    `active element: ${a ? a.tagName.toLowerCase() + (a.id ? `#${a.id}` : '') : 'none'}`;
  $('diag').append(dt, dd);
  console.log('[BRIDGE focus]', label, dd.textContent);
}

function focusSpike() {
  recordFocus('On load');
  window.focus();
  $('title').focus();
  recordFocus('After focusing the heading');
  window.addEventListener('focus', () => recordFocus('Panel received focus'), { once: true });
}

// --- boot -----------------------------------------------------------------------------

$('rescan').addEventListener('click', () => void runScan());
$('verify').addEventListener('click', () => void verifyAll());

if (!fixedTab) {
  browser.tabs.onActivated.addListener(({ tabId: id }) => {
    tabId = id;
    void runScan();
  });
}

focusSpike();
void runScan();
