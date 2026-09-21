/**
 * BRIDGE step detector (spec §6.5).
 *
 * Collapses three transition mechanisms — full navigation, SPA routing, and
 * in-place DOM swap — into one `new-step` / `fields-changed` decision.
 *
 * Measured against LinkedIn Easy Apply, which exposed two failures in the naive
 * version and drove the design here:
 *
 *   1. Fingerprinting `document` counts the page BEHIND a modal. LinkedIn's search
 *      boxes and nav persist across every step, so a genuine step change measured
 *      0.63 similar and was classified "same step". Scope to the dialog or form.
 *   2. Counting duplicate keys with Array.filter inflates the ratio past what the
 *      previous field set could possibly match. Compare sets, via Jaccard.
 *
 * And the lesson that outranks both: when the page publishes a step index, that is
 * ground truth. The similarity heuristic is the fallback for pages that do not.
 */
function createDetector({ scan, onEvent, threshold = 0.4, debounceMs = 350 }) {
  // Only the region that actually swaps. A modal dialog wins over the form,
  // because on LinkedIn the form behind it never goes away.
  const scope = () =>
    document.querySelector('[role=dialog][aria-modal="true"]') ||
    document.querySelector('[role=dialog]') ||
    document.querySelector('form') ||
    document.body;

  const SEL = 'input,select,textarea,[role=combobox],[role=checkbox],[role=radio],[role=slider],[role=spinbutton]';

  const key = (e) => {
    const name = e.getAttribute('aria-label') || e.name || e.id || e.dataset.automationId || '';
    return `${e.tagName}:${e.type || e.getAttribute('role') || ''}:${name}`;
  };

  // A Set: two identically-keyed radios are one signal, not two.
  const fingerprint = () =>
    new Set([...scope().querySelectorAll(SEL)].filter((e) => e.offsetParent !== null).map(key));

  const jaccard = (a, b) => {
    const union = new Set([...a, ...b]).size;
    if (!union) return 1;
    return [...a].filter((k) => b.has(k)).length / union;
  };

  const stepIndexOf = (r) => (r && r.stepHint && typeof r.stepHint.index === 'number' ? r.stepHint.index : null);

  let prev = fingerprint();
  let prevStepIndex = stepIndexOf(scan());
  let lastUrl = location.href;
  const events = [];

  function evaluate(reason) {
    const now = fingerprint();
    const scanned = scan();
    const nowStepIndex = stepIndexOf(scanned);

    const sameSet = now.size === prev.size && [...now].every((k) => prev.has(k));
    const indexMoved = nowStepIndex !== null && prevStepIndex !== null && nowStepIndex !== prevStepIndex;

    // Nothing changed, and the page did not claim a new step: not an event.
    if (sameSet && !indexMoved) return null;

    const similarity = jaccard(prev, now);
    const verdict = indexMoved ? 'new-step'
      : similarity < threshold ? 'new-step'
      : 'fields-changed';

    const ev = {
      at: new Date().toISOString().slice(11, 19),
      reason,
      verdict,
      // why we decided: the page told us, or we inferred it
      basis: indexMoved ? 'step-index' : 'field-similarity',
      similarity: +similarity.toFixed(2),
      prevFields: prev.size,
      nowFields: now.size,
      scopedTo: scope() === document.body ? 'body' : (scope().getAttribute('role') || scope().tagName.toLowerCase()),
      stepIndex: nowStepIndex,
      stepHint: scanned.stepHint,
      urlChanged: location.href !== lastUrl,
      focus: document.activeElement
        ? `${document.activeElement.tagName} "${(document.activeElement.getAttribute('aria-label') || document.activeElement.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40)}"`
        : 'none',
      pageBarriers: scanned.pageBarriers.map((b) => b.rule),
      fieldBarriers: scanned.fields.filter((f) => f.barriers.length).length,
    };

    prev = now;
    prevStepIndex = nowStepIndex;
    lastUrl = location.href;
    events.push(ev);
    if (onEvent) onEvent(ev);
    return ev;
  }

  for (const m of ['pushState', 'replaceState']) {
    const orig = history[m];
    history[m] = function () { const r = orig.apply(this, arguments); setTimeout(() => evaluate('history.' + m), 400); return r; };
  }
  const onPop = () => setTimeout(() => evaluate('popstate'), 400);
  addEventListener('popstate', onPop);

  let t;
  const mo = new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => evaluate('mutation'), debounceMs); });
  mo.observe(document.body, { childList: true, subtree: true });

  return {
    events,
    evaluate,
    stop() { mo.disconnect(); removeEventListener('popstate', onPop); },
  };
}

if (typeof module !== 'undefined') module.exports = { createDetector };
