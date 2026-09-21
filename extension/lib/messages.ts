// Side panel <-> content script protocol. The panel always addresses a specific tabId
// (spec §8): under test it runs as an ordinary page, so "the active tab" would be itself.

import { browser } from 'wxt/browser';
import type { FillResult, ReadBackResult, ScanResult } from './types';

export type Request =
  | { type: 'bridge/ping' }
  | { type: 'bridge/scan' }
  | { type: 'bridge/fill'; fieldId: string; value: string }
  | { type: 'bridge/read-back' };

export type Response<T extends Request['type']> =
  T extends 'bridge/ping' ? { ok: true } :
  T extends 'bridge/scan' ? ScanResult :
  T extends 'bridge/fill' ? FillResult :
  T extends 'bridge/read-back' ? ReadBackResult[] :
  never;

export async function send<R extends Request>(tabId: number, req: R): Promise<Response<R['type']>> {
  // frameId 0: v0 addresses the top frame only. Per-frame routing (spec §5) is day 2.
  return browser.tabs.sendMessage(tabId, req, { frameId: 0 }) as Promise<Response<R['type']>>;
}
