// Service worker: shortcut handling, opening the panel, getting a content script into
// the page. Owns no page or UI state (spec §5.1).

export default defineBackground(() => {
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  browser.commands.onCommand.addListener((command, tab) => {
    if (command !== 'open-bridge' || !tab?.id) return;
    // open() must run inside the user gesture, so it is called before anything is awaited.
    browser.sidePanel.open({ tabId: tab.id }).catch((e) => console.error('sidePanel.open', e));
    void ensureContentScript(tab.id);
  });

  browser.runtime.onMessage.addListener((msg: { type?: string; tabId?: number }, _sender, sendResponse) => {
    if (msg?.type !== 'bridge/ensure-content-script' || typeof msg.tabId !== 'number') return;
    ensureContentScript(msg.tabId).then(
      () => sendResponse({ ok: true }),
      (e) => sendResponse({ ok: false, error: String(e) }),
    );
    return true;
  });
});

/**
 * Pages in the built-in list already have the content script. Anywhere else, the
 * shortcut's activeTab grant lets us inject it now (§4, second tier).
 */
async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await browser.tabs.sendMessage(tabId, { type: 'bridge/ping' }, { frameId: 0 });
    return;
  } catch { /* not injected yet */ }
  await browser.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ['/content-scripts/content.js'],
  });
}
