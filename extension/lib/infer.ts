// Label inference: spec §6.4. Only structure leaves the device: kind, nearby text, options
// and a picture of the control while it is still empty. Field values never do — the content
// script refuses to give a crop rectangle for a control that already holds something.

import { browser } from 'wxt/browser';
import { send } from './messages';
import type { FieldDescriptor } from './types';

/**
 * Where the proxy lives. Overridable at build time with VITE_BRIDGE_PROXY_ORIGIN so the e2e
 * suite can stand its stub on a free port while a real proxy is running on the default —
 * otherwise the two collide and the suite cannot be run without stopping the proxy first.
 * A shipping build sets nothing and gets localhost:8000.
 */
const PROXY_ORIGIN = import.meta.env?.VITE_BRIDGE_PROXY_ORIGIN || 'http://localhost:8000';
const PROXY = `${PROXY_ORIGIN}/infer-labels`;

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
    // These fields are here because no text names them. Without a picture or a list of
    // options the model has nothing to read and answers "Text field", which is worse than
    // BRIDGE's honest "Unlabelled text". So such a field is not sent at all.
    if (!crop && !f.options?.length) { note(`${f.id}: not sent (nothing to infer from)`); continue; }
    payload.push({ id: f.id, kind: f.kind, nearbyText: [] as string[], ...(f.options?.length ? { options: f.options } : {}), ...(crop ? { cropPng: crop } : {}) });
  }
  if (!payload.length) return { ok: true, labels: [] };
  let res: Response;
  try {
    res = await fetch(PROXY, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields: payload }) });
  } catch (e) {
    // The exception is for whoever debugs this; the applicant hears only the plain reason.
    note(`request to ${PROXY} failed: ${String(e)}`);
    return { ok: false, error: `The BRIDGE proxy at ${new URL(PROXY_ORIGIN).host} is not reachable.` };
  }
  if (!res.ok) return { ok: false, error: `The BRIDGE proxy answered ${res.status}.` };
  let reply: unknown;
  try { reply = await res.json(); } catch (e) {
    note(`reply from ${PROXY} did not parse: ${String(e)}`);
    return { ok: false, error: 'The BRIDGE proxy sent a reply that is not valid JSON.' };
  }
  const labels = (reply as { labels?: unknown })?.labels;
  if (!Array.isArray(labels) || !labels.every((l) => typeof l?.id === 'string' && typeof l?.label === 'string')) {
    return { ok: false, error: 'The BRIDGE proxy sent a reply that is not in the expected shape.' };
  }
  note(`${labels.length} label${labels.length === 1 ? '' : 's'} inferred`);
  return { ok: true, labels };
}
