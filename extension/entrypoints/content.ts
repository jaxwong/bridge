// Content script: owns everything about the page (spec §5.1). Disposable — it keeps no
// state that must outlive the page, and re-derives everything from the DOM (§6.5).

import { fill, harvestOptions, readValue, resolve } from '../lib/act';
import type { Request } from '../lib/messages';
import { scanPage, type FieldHandle } from '../lib/scan';
import type { ReadBackResult, ScanResult } from '../lib/types';

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

    async function handle(msg: Request): Promise<unknown> {
      switch (msg.type) {
        case 'bridge/ping':
          return { ok: true };

        case 'bridge/scan': {
          const { result, handles: h } = scanPage();
          // Custom dropdown options only exist once opened (§6.3): open, read, close.
          for (const f of result.fields) {
            if (f.kind !== 'combobox' || f.options) continue;
            try { f.options = await harvestOptions(h.get(f.id)!.el); } catch { f.options = []; }
          }
          handles = h;
          last = result;
          return result;
        }

        case 'bridge/fill': {
          const h = handles.get(msg.fieldId);
          if (!h) {
            return { fieldId: msg.fieldId, ok: false, strategy: '', readBack: '', error: 'BRIDGE does not know this field any more. Scan the page again.' };
          }
          return fill(msg.fieldId, h, msg.value);
        }

        case 'bridge/read-back': {
          // VERIFY reads from the page, never from BRIDGE's own state (§4.4).
          if (!last) return [];
          return last.fields.map((f): ReadBackResult => {
            const h = handles.get(f.id)!;
            const found = !!resolve(h.el, h.selector);
            return { fieldId: f.id, label: f.label, value: found ? readValue(h) : '', found };
          });
        }
      }
    }

    browser.runtime.onMessage.addListener((msg: Request, _sender, sendResponse) => {
      if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('bridge/')) return;
      handle(msg).then(sendResponse, (e) => sendResponse({ error: String(e) }));
      return true;
    });
  },
});
