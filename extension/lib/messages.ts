// Side panel <-> content script protocol. The panel always addresses a specific tabId
// (spec §8): under test it runs as an ordinary page, so "the active tab" would be itself.
// Every request also names the frame: an ATS is often an iframe in a careers page (§4).

import { browser } from 'wxt/browser';
import type { FillResult, ReadBackResult, ScanResult } from './types';

export type Request =
  | { type: 'bridge/ping' }
  | { type: 'bridge/scan' }
  | { type: 'bridge/fill'; fieldId: string; value: string }
  | { type: 'bridge/read-back' }
  | { type: 'bridge/forward-action'; act: boolean }
  | { type: 'bridge/submit' }
  | { type: 'bridge/back-action' }
  | { type: 'bridge/rect'; fieldId: string };

export type Response<T extends Request['type']> =
  T extends 'bridge/ping' ? { ok: true; pageId: number } :
  T extends 'bridge/scan' ? ScanResult :
  T extends 'bridge/fill' ? FillResult :
  T extends 'bridge/read-back' ? ReadBack :
  T extends 'bridge/forward-action' ? ForwardAction | null :
  T extends 'bridge/submit' ? ForwardAction | null :
  T extends 'bridge/back-action' ? ForwardAction | null :
  T extends 'bridge/rect' ? CropRect | null :
  never;

/** What the content script answers when a handler threw. Distinct from every Response. */
export interface HandlerThrew { handlerThrew: string }

export async function send<R extends Request>(tabId: number, frameId: number, req: R): Promise<Response<R['type']>> {
  const res = await browser.tabs.sendMessage(tabId, req, { frameId }) as Response<R['type']> | HandlerThrew | undefined;
  // The one place that turns a thrown handler back into an exception; without it a failed
  // scan read as "no questions". A result that merely reports a refusal passes through.
  if (res && typeof res === 'object' && 'handlerThrew' in res) {
    throw new Error(`${req.type} failed in the page: ${res.handlerThrew}`);
  }
  return res as Response<R['type']>;
}

/** VERIFY's answer. `changed` means fields have appeared or gone since the last scan, so
 *  `fields` describes a form the page no longer shows: the panel rescans once, then reads
 *  again. (A conditional question revealed by a write is on the page well before the
 *  watcher's debounced rescan lands, and a read-back in between must not miss it.) */
export interface ReadBack { changed: boolean; fields: ReadBackResult[] }

/** The step's primary forward control: Continue on steps 1..n-1, Submit on the last (§6.5). */
/** `pressed` is true only when the page side clicked the button. `bridge/forward-action` never
 *  clicks one that submits; `bridge/submit` never clicks one that does not. */
export interface ForwardAction { name: string; submits: boolean; pressed: boolean }

/** Where an unlabelled, still-empty control sits in the viewport, in CSS pixels. */
/**
 * A crop rectangle in CSS pixels, plus the width of the viewport they were measured in.
 *
 * The viewport width is what turns the rectangle into image pixels. It is deliberately
 * not devicePixelRatio: captureVisibleTab photographs at the window's backing scale,
 * which is not always the ratio the page reports, and when the two disagree every crop
 * lands on the wrong part of the screenshot. Dividing the captured width by this gives
 * the scale that was actually used, whatever it was.
 */
export interface CropRect { x: number; y: number; width: number; height: number; viewportWidth: number }

/** A frame BRIDGE has permission to run in. Frames it cannot reach are simply absent. */
export interface Frame { frameId: number; origin: string }

/** Service worker requests. It owns injection and frame discovery (§5.1). */
export type WorkerRequest =
  | { type: 'bridge/prepare-frames'; tabId: number }
  | { type: 'bridge/register-site'; origin: string };

/** Service worker -> panel. */
export type WorkerEvent =
  | { type: 'bridge/page-loaded'; tabId: number }
  | { type: 'bridge/command-forward'; tabId: number };

/** Content script -> panel: the form's fields or its step index changed. The panel
 *  rescans and decides whether that is a new step (§6.5); this is only the trigger. */
export interface FormChanged { type: 'bridge/form-changed' }
