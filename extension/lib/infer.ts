// Label inference: spec §6.4. Only structure leaves the device: kind, nearby text, options
// and a picture of the control while it is still empty. Field values never do — the content
// script refuses to give a crop rectangle for a control that already holds something.

import { browser } from 'wxt/browser';
import { send } from './messages';
import type { FieldDescriptor } from './types';

const PROXY = 'http://localhost:8000/infer-labels';

type Target = FieldDescriptor & { frameId: number; localId: string };
export type Inference = { ok: true; labels: { id: string; label: string; confidence: number }[] } | { ok: false; error: string };

async function cropPng(tabId: number, f: Target, note: (m: string) => void): Promise<string | undefined> {
  // A rectangle from an iframe is relative to that iframe, and captureVisibleTab
  // photographs whichever tab is in front. Outside those limits the crop, which the
  // contract makes optional, is left out and the request goes with text only.
  const tab = await browser.tabs.get(tabId);
  if (f.frameId !== 0 || !tab.active) { note(`${f.id}: no crop (not the top frame of the visible tab)`); return undefined; }
  const rect = await send(tabId, 0, { type: 'bridge/rect', fieldId: f.localId });
  if (!rect || rect.width < 2 || rect.height < 2) { note(`${f.id}: no crop (control is filled or not visible)`); return undefined; }
  await new Promise((r) => setTimeout(r, 300)); // let the scroll settle before the picture
  const shot = await browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const img = await createImageBitmap(await (await fetch(shot)).blob());
  const pad = 12;
  const canvas = new OffscreenCanvas(Math.round((rect.width + pad * 2) * rect.dpr), Math.round((rect.height + pad * 2) * rect.dpr));
  canvas.getContext('2d')!.drawImage(img, (rect.x - pad) * rect.dpr, (rect.y - pad) * rect.dpr, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** One request per scan, for the fields no heuristic could name. Never retried. */
export async function inferLabels(tabId: number, targets: Target[], note: (m: string) => void): Promise<Inference> {
  const payload = [];
  for (const f of targets) {
    let crop: string | undefined;
    try { crop = await cropPng(tabId, f, note); } catch (e) { note(`${f.id}: no crop (${String(e)})`); }
    payload.push({ id: f.id, kind: f.kind, nearbyText: [] as string[], ...(f.options ? { options: f.options } : {}), ...(crop ? { cropPng: crop } : {}) });
  }
  let res: Response;
  try {
    res = await fetch(PROXY, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields: payload }) });
  } catch (e) {
    return { ok: false, error: `The BRIDGE proxy at localhost:8000 is not reachable. ${String(e)}` };
  }
  if (!res.ok) return { ok: false, error: `The BRIDGE proxy answered ${res.status}.` };
  const { labels } = await res.json() as { labels: { id: string; label: string; confidence: number }[] };
  note(`${labels.length} label${labels.length === 1 ? '' : 's'} inferred`);
  return { ok: true, labels };
}
