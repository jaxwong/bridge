// Service worker: shortcut handling, opening the panel, getting a content script into
// every frame it may run in. Owns no page or UI state (spec §5.1).

import type { Frame, WorkerEvent, WorkerRequest } from '../lib/messages';

export default defineBackground(() => {
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((e) => console.error('[BRIDGE] sidePanel.setPanelBehavior', e));

  browser.commands.onCommand.addListener((command, tab) => {
    if (!tab?.id) return;
    // open() must run inside the user gesture, so it is called before anything is awaited.
    // The panel prepares the frames itself once it has loaded.
    browser.sidePanel.open({ tabId: tab.id }).catch((e) => console.error('[BRIDGE] sidePanel.open', e));
    // Alt+Shift+S: the panel owns the VERIFY gate (§6.5), so it decides what this press does.
    if (command === 'focus-submit') notifyPanel({ type: 'bridge/command-forward', tabId: tab.id });
  });

  browser.runtime.onMessage.addListener((msg: WorkerRequest, _sender, sendResponse) => {
    const work =
      msg?.type === 'bridge/prepare-frames' ? prepareFrames(msg.tabId).then((frames) => ({ frames })) :
      msg?.type === 'bridge/register-site' ? registerSite(msg.origin).then(() => ({})) :
      null;
    if (!work) return;
    work.then((r) => sendResponse({ ok: true, ...r }), (e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  });

  // A full page load discards an injected content script (§4). The panel re-prepares the
  // frames when it hears this; while activeTab or a host permission holds, that works.
  browser.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status !== 'complete') return;
    notifyPanel({ type: 'bridge/page-loaded', tabId });
  });
});

function notifyPanel(event: WorkerEvent) {
  browser.runtime.sendMessage(event).catch((e) => {
    // No panel open is the normal case, not a fault.
    if (!/Receiving end does not exist/.test(String(e))) console.error('[BRIDGE]', event.type, e);
  });
}

/**
 * Third tier (§4): the user granted this origin from the side panel, so from now on it
 * behaves like the built-in list — declared content script, every frame, every load.
 */
async function registerSite(origin: string): Promise<void> {
  const id = `site:${origin}`;
  const existing = await browser.scripting.getRegisteredContentScripts({ ids: [id] });
  if (existing.length) return;
  await browser.scripting.registerContentScripts([{
    id,
    matches: [`${origin}/*`],
    js: ['content-scripts/content.js'],
    allFrames: true,
    runAt: 'document_idle',
    persistAcrossSessions: true,
  }]);
}

/**
 * The frames BRIDGE may run in, each with a live content script. Chrome itself answers
 * "which frames": a script injected with allFrames runs only where the extension has
 * permission, so an ATS iframe on a listed host is included and any other cross-origin
 * frame is absent. No registry, nothing to go stale.
 */
async function prepareFrames(tabId: number): Promise<Frame[]> {
  const results = await browser.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => location.origin,
  });
  const frames = results
    .filter((r) => typeof r.result === 'string')
    .map((r) => ({ frameId: r.frameId, origin: r.result as string }))
    .sort((a, b) => a.frameId - b.frameId);

  // Pages in the built-in list already have the content script. Anywhere else, the
  // shortcut's activeTab grant lets us inject it now (§4, second tier).
  for (const { frameId } of frames) {
    const alive = await browser.tabs.sendMessage(tabId, { type: 'bridge/ping' }, { frameId }).then(() => true, (e) => {
      if (/Receiving end does not exist|Could not establish connection/.test(String(e))) return false;
      throw e;
    });
    if (!alive) {
      await browser.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: ['/content-scripts/content.js'] });
    }
  }
  return frames;
}
