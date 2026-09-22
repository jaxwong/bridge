// Content script: owns everything about the page (spec §5.1). Disposable — it keeps no
// state that must outlive the page, and re-derives everything from the DOM (§6.5).

import { fill, harvestOptions, readValue } from '../lib/act';
import { accName, clean, deepQueryAll, formScope, visible } from '../lib/dom';
import type { CropRect, FormChanged, ForwardAction, HandlerThrew, ReadBack, Request } from '../lib/messages';
import { refind, scanPage, type FieldHandle } from '../lib/scan';
import type { ReadBackResult, ScanResult } from '../lib/types';

const FORWARD = /\b(submit|continue|next|review|apply|send)\b/i;
const NOT_FORWARD = /\b(back|previous|cancel|close|dismiss|save draft)\b/i;
const SUBMITS = /\b(submit|apply|send)\b/i;
const BACKWARD = /\b(back|previous)\b/i;

export default defineContentScript({
  matches: [
    'https://*.myworkdayjobs.com/*',
    'https://boards.greenhouse.io/*',
    'https://job-boards.greenhouse.io/*',
    'https://jobs.lever.co/*',
    'https://jobs.ashbyhq.com/*',
    'https://*.vietnamworks.com/*',
    'https://www.linkedin.com/*',
    'http://localhost/*',
  ],
  allFrames: true,
  matchAboutBlank: true,
  main() {
    // Declared injection and on-demand injection (activeTab, §4) can both reach a page.
    const w = window as unknown as { __bridgeContent?: boolean };
    if (w.__bridgeContent) return;
    w.__bridgeContent = true;

    let handles = new Map<string, FieldHandle>();
    let last: ScanResult | null = null;
    // While BRIDGE itself is changing the page (opening a dropdown to read it, writing
    // an answer), the watcher below must not mistake that for the page moving on.
    let busy = 0;

    const fingerprintOf = (r: ScanResult) =>
      `${r.stepHint?.index ?? ''}|${r.fields.map((f) => `${f.kind}:${f.label}`).sort().join('|')}`;
    let notified = '';

    async function whileBusy<T>(work: () => Promise<T>): Promise<T> {
      busy++;
      try { return await work(); } finally { setTimeout(() => { busy--; }, 600); }
    }

    /** The step's forward button: the last one in page order, where forms put it. */
    function findForward(): { b: HTMLElement; name: string; submits: boolean } | null {
      const buttons = deepQueryAll<HTMLElement>(formScope(), 'button,input[type=submit],input[type=button],[role=button],a[href]')
        .filter((b) => visible(b) && !(b as HTMLButtonElement).disabled)
        .map((b) => ({ b, name: accName(b).name || clean(b.textContent) || (b as HTMLInputElement).value || '' }))
        .filter(({ name }) => FORWARD.test(name) && !NOT_FORWARD.test(name));
      const hit = buttons[buttons.length - 1];
      return hit ? { ...hit, submits: SUBMITS.test(hit.name) } : null;
    }

    /**
     * Chrome does not let a page take keyboard focus from the side panel (measured by hand,
     * manual-checks.md check 2), so "move the user to the button" cannot be done. With `act`,
     * a button that only moves on is pressed for the user. One that submits is never pressed
     * here, whatever the caller asks: submitting has its own message.
     */
    function forwardAction(act: boolean): ForwardAction | null {
      const hit = findForward();
      if (!hit) return null;
      if (act && !hit.submits) hit.b.click();
      return { name: hit.name, submits: hit.submits, pressed: act && !hit.submits };
    }

    /**
     * Submits the application. The panel sends this only from the user's own confirmation
     * (§6.5). It presses a button only if its name says it submits; anything else is refused,
     * so this message cannot be used to press Next.
     */
    function submitApplication(): ForwardAction | null {
      const hit = findForward();
      if (!hit?.submits) return null;
      hit.b.click();
      return { name: hit.name, submits: true, pressed: true };
    }

    /** The step's back button, first in page order (forms put Back before Next). Its name
     *  must say it goes back and must not match FORWARD, so this can never press anything
     *  that submits or moves on. input[type=submit] is excluded outright. */
    function backAction(): ForwardAction | null {
      const hit = deepQueryAll<HTMLElement>(formScope(), 'button,input[type=button],[role=button],a[href]')
        .filter((b) => visible(b) && !(b as HTMLButtonElement).disabled)
        .map((b) => ({ b, name: accName(b).name || clean(b.textContent) || (b as HTMLInputElement).value || '' }))
        .find(({ name }) => BACKWARD.test(name) && !FORWARD.test(name));
      if (!hit) return null;
      hit.b.click();
      return { name: hit.name, submits: false, pressed: true };
    }

    async function handle(msg: Request): Promise<unknown> {
      switch (msg.type) {
        case 'bridge/ping':
          // timeOrigin is fixed for the life of a document: the panel uses it to tell a
          // new page from a repeated "load complete" on the same one.
          return { ok: true, pageId: performance.timeOrigin };

        case 'bridge/scan':
          return whileBusy(async () => {
            const { result, handles: h } = scanPage();
            // Custom dropdown options only exist once opened (§6.3): open, read, close.
            // Read fresh on every scan: what a dropdown offers can depend on another answer
            // (country -> city), and the page is the only source of truth for it.
            // The handle keeps them too, so read-back can tell "Select…" from a selection.
            for (const f of result.fields) {
              if (f.kind !== 'combobox') continue;
              const handle = h.get(f.id)!;
              handle.options = f.options = await harvestOptions(handle.el);
            }
            handles = h;
            last = result;
            notified = fingerprintOf(result);
            return result;
          });

        case 'bridge/fill': {
          const h = handles.get(msg.fieldId);
          if (!h) {
            return { fieldId: msg.fieldId, ok: false, strategy: '', readBack: '', error: 'BRIDGE does not know this field any more. Scan the page again.' };
          }
          return whileBusy(() => fill(msg.fieldId, h, msg.value));
        }

        case 'bridge/read-back': {
          // VERIFY reads from the page, never from BRIDGE's own state (§4.4). Fields the
          // page has grown or lost since the last scan are reported as `changed`, not
          // silently left out: the panel rescans and asks again.
          if (!last) return { changed: false, fields: [] } satisfies ReadBack;
          const fields = last.fields.map((f): ReadBackResult => {
            const h = handles.get(f.id)!;
            const found = !!refind(h);
            return { fieldId: f.id, label: f.label, value: found ? readValue(h) : '', found };
          });
          return { changed: fingerprintOf(scanPage().result) !== fingerprintOf(last), fields } satisfies ReadBack;
        }

        case 'bridge/forward-action':
          return forwardAction(msg.act);

        case 'bridge/submit':
          return submitApplication();

        case 'bridge/back-action':
          return backAction();

        case 'bridge/rect': {
          // For a label-inference crop (§6.4). Field values never leave the device, so a
          // control that already holds something is not photographed at all.
          const h = handles.get(msg.fieldId);
          const el = h && refind(h);
          if (!h || !el || readValue(h)) return null;
          el.scrollIntoView({ block: 'center' });
          const r = (el.parentElement || el).getBoundingClientRect();
          const rect: CropRect = { x: r.x, y: r.y, width: r.width, height: r.height, dpr: devicePixelRatio };
          return rect;
        }
      }
    }

    browser.runtime.onMessage.addListener((msg: Request, _sender, sendResponse) => {
      if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('bridge/')) return;
      // A handler that threw. The key is deliberately not `error`: FillResult has an `error`
      // of its own, and a refusal ("No option matching") is an answer, not a crash.
      handle(msg).then(sendResponse, (e) => sendResponse({ handlerThrew: String(e) } satisfies HandlerThrew));
      return true;
    });

    // --- step detector, page side (§6.5) ----------------------------------------------
    // Full navigations restart this script; SPA routes and in-place swaps both mutate the
    // DOM. So one debounced observer covers every transition a live document can make.
    // It only reports THAT the form changed; the panel decides what the change means.
    let timer: number | undefined;
    const check = () => {
      // BRIDGE's own work (opening a dropdown to read it, writing an answer) leaves the
      // set of fields as it was, so waiting it out and comparing afterwards loses nothing.
      // Dropping the change instead would lose a step that happened to land mid-scan.
      if (busy) { timer = window.setTimeout(check, 300); return; }
      const now = fingerprintOf(scanPage().result);
      if (now === notified) return;
      notified = now;
      const event: FormChanged = { type: 'bridge/form-changed' };
      browser.runtime.sendMessage(event).catch((e) => {
        // The panel being closed is the normal case, not a fault.
        if (!/Receiving end does not exist/.test(String(e))) console.error('[BRIDGE] form-changed', e);
      });
    };
    new MutationObserver(() => {
      if (!last) return;
      clearTimeout(timer);
      timer = window.setTimeout(check, 400);
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'open', 'aria-hidden', 'style', 'class'] });

    // --- on-load announcement, built-in tier (§4) --------------------------------------
    // Only in the top frame, and only where there is an application form: a dialog or
    // form with at least two controls. A search page must stay silent.
    if (window.top === window) {
      const region = document.createElement('div');
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', 'polite');
      region.id = 'bridge-announcement';
      region.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap';
      document.body.append(region);
      // A live region is only spoken if it exists before its text arrives.
      window.setTimeout(() => {
        if (formScope() === document.body) return;
        const { result } = scanPage();
        if (result.fields.length < 2) return;
        const n = result.pageBarriers.length + result.fields.reduce((sum, f) => sum + f.barriers.length, 0);
        region.textContent = `BRIDGE found ${n} accessibility barrier${n === 1 ? '' : 's'} on this form. Press Alt+Shift+B to open BRIDGE.`;
      }, 1000);
    }
  },
});
