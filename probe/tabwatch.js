/**
 * Tab-order diagnostic. Real keypresses only.
 *
 * Synthetic Tab events do not move focus, so tab order can only be observed while a
 * person presses the key. This watches real Tab presses and reports where focus went,
 * whether the page intercepted the key, and which controls were jumped over.
 *
 * It separates three causes that look identical to a tester:
 *   - the page removed the control from the tab order (tabindex=-1, disabled);
 *   - the page intercepts Tab and moves focus itself — a hand-rolled focus trap whose
 *     list of "tabbable" elements is incomplete. A real barrier, on every OS;
 *   - the browser's native tab order skipped a focusable control — on macOS that is
 *     the Keyboard navigation setting, not the page.
 *
 * Radios are excluded from skip detection: a radio group is one tab stop by design.
 */
function createTabWatcher() {
  const STOPS = [
    'input:not([type=hidden]):not([type=radio])', 'select', 'textarea', 'button',
    '[role=combobox]', '[role=checkbox]', '[role=switch]',
  ].join(',');

  let handler = null;

  const describe = (el) => {
    if (!el || el === document.body || el === document.documentElement) return 'BODY (no focus)';
    const label = (el.getAttribute('aria-label') ||
      (el.labels && el.labels[0] && el.labels[0].textContent) ||
      el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return `${el.tagName.toLowerCase()} "${label}"`;
  };

  // Tab stops inside the form, in document order, with `extra` merged in at their
  // own positions so that `from` and `to` always have an index.
  const ordered = (extra) => {
    const set = new Set([...formScope().querySelectorAll(STOPS)].filter((el) => el.offsetParent !== null));
    for (const el of extra) if (el) set.add(el);
    return [...set].sort((x, y) => (x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  };

  // What a Tab press jumped over, following the direction of travel. A modal that
  // loops focus from its last control back to its first (or the reverse on Shift+Tab)
  // is doing its job. Measured on LinkedIn Easy Apply: Next -> Dismiss. The skipped
  // set for a wrap is only what lies AFTER `from` plus what lies BEFORE `to` — not
  // everything in between in the document, which an earlier version reported.
  const travel = (from, to, backward) => {
    const list = ordered([from, to]);
    const i = list.indexOf(from), j = list.indexOf(to);
    let skipped, wrapped;
    if (!backward) {
      wrapped = j < i;
      skipped = wrapped ? list.slice(i + 1).concat(list.slice(0, j)) : list.slice(i + 1, j);
    } else {
      wrapped = j > i;
      skipped = wrapped ? list.slice(0, i).concat(list.slice(j + 1)) : list.slice(j + 1, i);
    }
    skipped = skipped.filter((el) => !el.contains(from) && !el.contains(to) && !from.contains(el) && !to.contains(el));
    return { skipped, wrapped };
  };

  const removedByPage = (el) => el.tabIndex < 0 || el.disabled;

  function start() {
    if (handler) { console.log('already watching Tab'); return; }
    handler = (e) => {
      if (e.key !== 'Tab') return;
      const from = document.activeElement;
      setTimeout(() => {
        const to = document.activeElement;
        const intercepted = e.defaultPrevented;
        const scope = formScope();
        const lostFocus = !to || to === document.body || to === document.documentElement;
        const leftForm = !lostFocus && scope !== document.body && !scope.contains(to);

        const lines = [
          `${describe(from)}  ->  ${describe(to)}`,
          `   page intercepted Tab: ${intercepted}`,
        ];

        if (lostFocus || leftForm) {
          lines.push(lostFocus
            ? '   VERDICT: focus was dropped to the page body. Real barrier: the user is no longer anywhere.'
            : '   VERDICT: focus escaped the dialog into the page behind it. Real barrier for a modal.');
          console.log(`%c[Tab${e.shiftKey ? ' back' : ''}]%c ${lines.join('\n')}`, 'font-weight:bold', 'color:#c00');
          return;
        }

        const { skipped, wrapped } = travel(from, to, e.shiftKey);
        if (wrapped) lines.push(`   wrapped to the ${e.shiftKey ? 'end' : 'start'} of the dialog`);
        for (const el of skipped) {
          lines.push(`   SKIPPED ${describe(el)}  tabIndex=${el.tabIndex}${el.disabled ? ' disabled' : ''}`);
        }

        let verdict;
        if (!skipped.length) {
          verdict = wrapped
            ? 'VERDICT: focus looped around the dialog. Expected modal behaviour, not a barrier.'
            : 'no controls skipped';
        }
        else if (skipped.every(removedByPage)) verdict = 'VERDICT: the page removed these from the tab order (tabindex=-1 / disabled). Real barrier.';
        else if (intercepted) verdict = 'VERDICT: the page intercepted Tab and moved focus itself, jumping over focusable controls. Real barrier, on every OS.';
        else verdict = 'VERDICT: native tab order skipped focusable controls. On macOS turn on Keyboard navigation and retest; on Windows this is unexpected — report it.';
        lines.push(`   ${verdict}`);

        console.log(`%c[Tab${e.shiftKey ? ' back' : ''}]%c ${lines.join('\n')}`,
          'font-weight:bold', skipped.length ? 'color:#c00' : 'color:inherit');
      }, 60);
    };
    document.addEventListener('keydown', handler, true);
    console.log('Watching Tab. Click the field just before a dropdown, press Tab once, read the [Tab] line.');
  }

  function stop() {
    if (handler) document.removeEventListener('keydown', handler, true);
    handler = null;
  }

  return { start, stop };
}

if (typeof module !== 'undefined') module.exports = { createTabWatcher };
