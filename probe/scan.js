/**
 * BRIDGE SCAN prototype.
 *
 * This is the same logic the content script will run, extracted so it can be
 * validated against real portals from Node before it ships in the extension.
 * Keep it dependency-free and side-effect-free: it must be `page.evaluate`-able
 * and equally injectable into a content script.
 */

function SCAN() {
  const out = { url: location.href, scannedAt: new Date().toISOString(), fields: [], pageBarriers: [], stepHint: null };

  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const txt = (el) => clean(el && el.textContent).slice(0, 160);

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };

  // Anything inside an aria-hidden subtree is invisible to a screen reader, so it
  // is neither a field we can offer nor a barrier worth reporting. Skipping these
  // removes the react-select "required input" false positives.
  const ariaHidden = (el) => !!el.closest('[aria-hidden="true"]');

  // --- accessible name (subset of accname, enough to decide "is this named?") ---
  function accName(el) {
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const t = lb.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map(txt).join(' ');
      if (t) return { name: t, src: 'aria-labelledby' };
    }
    const al = el.getAttribute('aria-label');
    if (al && al.trim()) return { name: al.trim(), src: 'aria-label' };
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l && txt(l)) return { name: txt(l), src: 'label-for' };
    }
    const wrap = el.closest('label');
    if (wrap && txt(wrap)) return { name: txt(wrap), src: 'label-wrap' };
    if (el.getAttribute('title')) return { name: el.getAttribute('title'), src: 'title' };
    // A placeholder is not an accessible name in practice: it disappears on input
    // and several screen readers skip it. Treated as a barrier, not a name.
    if (el.placeholder) return { name: el.placeholder, src: 'placeholder' };
    return { name: '', src: 'none' };
  }

  const NATIVE = 'input,select,textarea';
  const ARIA = '[role=combobox],[role=listbox],[role=slider],[role=checkbox],[role=radio],[role=textbox],[role=spinbutton],[role=switch]';

  const candidates = new Set([...document.querySelectorAll(NATIVE), ...document.querySelectorAll(ARIA)]);

  // Custom widgets: looks clickable, is named like a control, contains no real control.
  document.querySelectorAll('div,span,li').forEach((el) => {
    if (candidates.has(el) || !visible(el)) return;
    if (getComputedStyle(el).cursor !== 'pointer') return;
    const cls = typeof el.className === 'string' ? el.className : '';
    if (!/select|dropdown|combo|picker|slider|upload|dropzone|drag/i.test(cls)) return;
    if (el.querySelector(`${NATIVE},[role],button,a[href]`)) return;
    candidates.add(el);
  });

  for (const el of candidates) {
    if (!visible(el) || ariaHidden(el)) continue;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'input' && ['hidden', 'submit', 'button', 'reset'].includes(type)) continue;

    const { name, src } = accName(el);
    const role = el.getAttribute('role') || '';
    const nativelyFocusable = ['input', 'select', 'textarea', 'button', 'a'].includes(tag);
    const focusable = el.tabIndex >= 0 || (nativelyFocusable && el.tabIndex !== -1);
    const barriers = [];

    if (!name) barriers.push('missing-label');
    else if (src === 'placeholder') barriers.push('label-placeholder-only');
    if (!focusable) barriers.push('not-keyboard-operable');

    const cls = typeof el.className === 'string' ? el.className : '';
    if (tag !== 'select' && /select|dropdown|combo|picker/i.test(cls) && !/combobox|listbox/.test(role)) {
      barriers.push('custom-dropdown-no-role');
    }

    // Can we enumerate options without driving the widget? Usually not — see
    // findings: every react-select on Greenhouse returns 0 here.
    let options = null;
    if (tag === 'select') options = [...el.options].map((o) => clean(o.text));
    else if (role === 'combobox') {
      const owns = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
      const menu = owns ? document.getElementById(owns) : null;
      options = menu ? [...menu.querySelectorAll('[role=option]')].map(txt) : [];
    }

    out.fields.push({
      tag, type, role,
      name: name || '(none)',
      labelSource: src,
      required: el.required || el.getAttribute('aria-required') === 'true',
      focusable,
      optionsAvailable: options ? options.length : null,
      options: options && options.length ? options.slice(0, 12) : undefined,
      barriers,
    });
  }

  // --- checkbox / radio groups with no programmatic group name ---
  const groups = {};
  document.querySelectorAll('input[type=checkbox],input[type=radio]').forEach((i) => {
    if (i.name) (groups[i.name] ||= []).push(i);
  });
  for (const [name, els] of Object.entries(groups)) {
    if (els.length < 2) continue;
    const fs = els[0].closest('fieldset,[role=group],[role=radiogroup]');
    const named = fs && (fs.querySelector('legend') || fs.getAttribute('aria-label') || fs.getAttribute('aria-labelledby'));
    if (!named) out.pageBarriers.push({ rule: 'group-not-labelled', severity: 'blocking', name, count: els.length });
  }

  // --- uploaders: a drop zone whose file input is unreachable ---
  document.querySelectorAll('input[type=file]').forEach((inp) => {
    const { name } = accName(inp);
    const reachable = inp.tabIndex !== -1 && visible(inp);
    const hasTrigger = inp.id && document.querySelector(`label[for="${CSS.escape(inp.id)}"]`);
    if (!reachable && !hasTrigger) {
      out.pageBarriers.push({
        rule: 'drag-drop-only', severity: 'blocking',
        detail: `file input tabIndex=${inp.tabIndex}, accessible name=${name || 'none'}, no labelled trigger`,
      });
    }
  });

  // --- a popup that is not a dialog (the VietnamWorks barrier) ---
  document.querySelectorAll('[class*=popup],[class*=Popup],[class*=modal],[class*=Modal]').forEach((el) => {
    if (!visible(el) || ariaHidden(el)) return;
    if (el.closest('[role=dialog],[role=alertdialog],[aria-modal=true]')) return;
    if (!el.querySelector(NATIVE)) return; // only care if it asks for input
    out.pageBarriers.push({
      rule: 'modal-without-dialog-role', severity: 'blocking',
      detail: `${el.className}`.slice(0, 60) + ' — no role=dialog/aria-modal; nothing announces it',
    });
  });

  if (document.querySelector('iframe[src*=recaptcha],iframe[src*=hcaptcha],[class*=h-captcha],[class*=g-recaptcha]')) {
    out.pageBarriers.push({ rule: 'captcha', severity: 'blocking' });
  }
  document.querySelectorAll('iframe').forEach((f) => {
    try {
      if (!f.contentDocument) out.pageBarriers.push({ rule: 'cross-origin-frame', severity: 'blocking', src: (f.src || '').slice(0, 90) });
    } catch (_) { /* cross-origin by definition */ }
  });

  // --- step indicator: how we learn the shape of a multi-step journey ---
  const wdBar = document.querySelector('[data-automation-id=progressBar]');
  const current = document.querySelector('[aria-current=step]');
  const bar = document.querySelector('progress,[role=progressbar]');
  // Portals phrase this differently: Workday "step 1 of 6", LinkedIn Easy Apply "1/4 pages".
  const body = document.body.innerText;
  const m = body.match(/step\s+(\d+)\s+of\s+(\d+)/i)
    || body.match(/(\d+)\s*(?:of|\/)\s*(\d+)\s*(?:pages?|steps?)/i)
    || body.match(/page\s+(\d+)\s*(?:of|\/)\s*(\d+)/i);

  if (wdBar) {
    out.stepHint = {
      via: 'workday-progressBar',
      steps: [...wdBar.querySelectorAll('li')].map((li) => clean(li.innerText)),
      activeIndex: [...wdBar.querySelectorAll('li')].findIndex((li) => li.getAttribute('data-automation-id') === 'progressBarActiveStep'),
    };
  } else if (current) {
    out.stepHint = { via: 'aria-current=step', text: txt(current) };
  } else if (m) {
    out.stepHint = { via: 'text', text: m[0], index: +m[1], total: +m[2] };
  } else if (bar) {
    out.stepHint = {
      via: 'progressbar',
      now: bar.getAttribute('aria-valuenow') ?? bar.value,
      max: bar.getAttribute('aria-valuemax') ?? bar.max,
      // A progress bar with no accessible name or value tells a screen reader nothing.
      named: !!(bar.getAttribute('aria-label') || bar.getAttribute('aria-labelledby')),
    };
  }

  return out;
}

if (typeof module !== 'undefined') module.exports = { SCAN };
