/**
 * Picks the region of the page that holds the application form.
 *
 * Everything downstream depends on this: fingerprinting the whole document counts the
 * page behind a modal and suppresses step detection (§6.5), while trusting the first
 * [role=dialog] picks up cookie banners and consent popups that hold no controls at all
 * — measured on Greenhouse, which has exactly such a dialog.
 *
 * So: prefer the narrowest container that actually contains form controls.
 */
function formScope(selector) {
  const SEL = selector || 'input,select,textarea,[role=combobox],[role=checkbox],[role=radio],[role=slider],[role=spinbutton]';

  const controlCount = (el) =>
    [...el.querySelectorAll(SEL)]
      .filter((e) => e.offsetParent !== null)
      .filter((e) => !(e.tagName === 'INPUT' && ['hidden', 'submit', 'button', 'reset'].includes(e.type)))
      .length;

  // Narrowest first. A modal dialog wins when it holds controls, because the form
  // behind it does not go away between steps.
  //
  // `<dialog>` must be matched by tag as well as by role: the native element has an
  // implicit dialog role but no role ATTRIBUTE, so '[role=dialog]' does not match it.
  // LinkedIn Easy Apply uses a native <dialog>, and missing it scoped every measurement
  // to <body> — which silently counted the job-search page behind the modal.
  const candidates = [
    ...document.querySelectorAll('dialog[open]'),
    ...document.querySelectorAll('[role=dialog][aria-modal="true"]'),
    ...document.querySelectorAll('dialog'),
    ...document.querySelectorAll('[role=dialog]'),
    ...document.querySelectorAll('[aria-modal="true"]'),
    ...document.querySelectorAll('form'),
  ].filter((el) => el.offsetParent !== null || (el.tagName === 'DIALOG' && el.open));

  for (const el of candidates) {
    if (controlCount(el) > 0) return el;
  }
  return document.body;
}

if (typeof module !== 'undefined') module.exports = { formScope };
