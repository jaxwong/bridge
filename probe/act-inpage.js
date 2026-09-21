/**
 * ACT strategies (spec §6.3), runnable in-page.
 *
 * Lets you answer "can BRIDGE actually write to this control?" on a portal you can
 * only reach by hand. Every write is followed by a read-back FROM THE DOM, which is
 * what VERIFY does and what catches a widget that silently ignored the write.
 *
 * Fills fields. Never clicks a submit or continue control.
 */
function createActor() {
  const SEL = 'input,select,textarea,[role=combobox],[role=checkbox],[role=radio],[role=slider],[role=spinbutton]';

  const scope = () => formScope(SEL);

  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => el.offsetParent !== null;

  const name = (el) => {
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const t = lb.split(/\s+/).map((i) => document.getElementById(i)).filter(Boolean).map((n) => clean(n.textContent)).join(' ');
      if (t) return t;
    }
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) return clean(l.textContent); }
    const w = el.closest('label'); if (w) return clean(w.textContent);
    return el.placeholder || '(unnamed)';
  };

  const els = () => {
    const all = [...scope().querySelectorAll(SEL)].filter(visible)
      .filter((e) => !(e.tagName === 'INPUT' && ['hidden', 'submit', 'button', 'reset'].includes(e.type)));
    // Drop a control nested inside another control: an ARIA wrapper and the native
    // input it contains are one choice to the user, not two.
    return all.filter((e) => !all.some((o) => o !== e && o.contains(e)));
  };

  function list() {
    const rows = els().map((e, i) => ({
      i, tag: e.tagName.toLowerCase(), type: e.type || e.getAttribute('role') || '',
      name: name(e).slice(0, 90), value: (e.value ?? '').toString().slice(0, 25),
    }));
    console.table(rows);
    return rows;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function fill(target, value) {
    const all = els();
    // `target` may be an index from bridge.fields(), or any part of the field's name.
    let el = null;
    if (typeof target === 'number') {
      el = all[target];
    } else if (typeof target === 'string') {
      const q = target.toLowerCase();
      const hits = all.filter((e) => name(e).toLowerCase().includes(q));
      if (hits.length > 1) {
        const sameName = new Set(hits.map((e) => name(e))).size === 1;
        console.warn(`"${target}" matches ${hits.length} controls; use an index instead:`);
        console.table(hits.map((e) => ({ i: all.indexOf(e), name: name(e).slice(0, 90) })));
        if (sameName) {
          console.warn(
            'These controls share an accessible name, so a screen reader announces them identically.',
            '\n   If they are the options of one question that is a blocking barrier — confirm the',
            '\n   computed name in DevTools > Elements > Accessibility before reporting it.',
          );
        }
        return null;
      }
      el = hits[0];
      if (el) console.log(`   matched "${name(el).slice(0, 45)}" (index ${all.indexOf(el)})`);
    }
    if (!el) {
      console.warn(
        `no control matching ${JSON.stringify(target)}. This form has ${all.length} control(s), indices 0-${all.length - 1}:`,
      );
      list();
      console.warn('Indices come from bridge.fields() and change on every step — re-run it after each Next.');
      return null;
    }
    const label = name(el);
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || '';
    const isToggle = ['checkbox', 'radio', 'switch'].includes(role) ||
                     (tag === 'input' && ['checkbox', 'radio'].includes(el.type));

    // Only a toggle may omit the value. Without this guard a missing argument is
    // stringified and written into the live page as the literal text "undefined".
    if (!isToggle && (value === undefined || value === null)) {
      console.warn(
        `"${label.slice(0, 45)}" needs a value: bridge.fill(${JSON.stringify(target)}, 'your value').`,
        '\n   Only radios, checkboxes and switches can be filled without one.',
      );
      return null;
    }

    let strategy, readBack, ok;

    if (tag === 'select') {
      strategy = 'native-select';
      const opt = [...el.options].find((o) => o.text.trim().toLowerCase().includes(String(value).toLowerCase()));
      if (opt) { el.value = opt.value; el.dispatchEvent(new Event('change', { bubbles: true })); }
      await sleep(400);
      readBack = el.options[el.selectedIndex] && el.options[el.selectedIndex].text.trim();
      ok = !!readBack && readBack.toLowerCase().includes(String(value).toLowerCase());

    } else if (['checkbox', 'radio', 'switch'].includes(role) ||
               (tag === 'input' && ['checkbox', 'radio'].includes(el.type))) {
      // A radio or checkbox takes no value — activating it IS the write.
      // Prefer the native input when an ARIA wrapper contains one: LinkedIn renders
      // div[role=radio] around a real input, and clicking the input is what the
      // page's own handler expects.
      const native = (tag === 'input') ? el : el.querySelector('input[type=radio],input[type=checkbox]');
      const hit = native || el;
      strategy = native && native !== el ? 'click (native input inside ARIA wrapper)' : 'click';
      hit.click();
      await sleep(400);
      const checked = native ? native.checked : el.getAttribute('aria-checked') === 'true';
      readBack = checked ? 'checked' : 'not checked';
      ok = checked;

    } else if (role === 'combobox' || (tag !== 'input' && tag !== 'textarea')) {
      strategy = 'synthetic-mouse (open, pick option)';
      let ctrl = el;
      for (let d = 0; d < 4 && ctrl.parentElement; d++) ctrl = ctrl.parentElement;
      for (const t of ['mousedown', 'mouseup']) el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, button: 0 }));
      await sleep(600);
      const owns = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
      const menu = owns ? document.getElementById(owns) : document;
      const opts = menu ? [...menu.querySelectorAll('[role=option]')] : [];
      const target = opts.find((o) => clean(o.textContent).toLowerCase().includes(String(value).toLowerCase())) || opts[0];
      const picked = target ? clean(target.textContent) : null;
      console.log(`   menu opened with ${opts.length} options` + (picked ? `, picking ${JSON.stringify(picked)}` : ''));
      if (target) for (const t of ['mousedown', 'mouseup', 'click']) target.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, button: 0 }));
      await sleep(700);

      // A custom combobox almost never keeps the selection on the element you wrote to:
      // react-select clears its search input and renders the choice in a sibling node.
      // So read back from the rendered widget, walking outward until we find it.
      readBack = clean(el.value);
      if (!readBack) {
        let n = el;
        for (let d = 0; d < 6 && n && !readBack; d++) {
          n = n.parentElement;
          if (!n) break;
          const shown = n.querySelector('[class*=single-value],[class*=singleValue],[class*=selected-value]');
          if (shown) { readBack = clean(shown.textContent); break; }
          // fall back to "did the widget's own text start containing what we picked?"
          if (picked && clean(n.textContent).includes(picked)) { readBack = picked; break; }
        }
      }
      readBack = (readBack || '').slice(0, 40);
      ok = !!readBack && (!picked || readBack.toLowerCase().includes(picked.toLowerCase().slice(0, 6)));

    } else {
      strategy = 'prototype value setter';
      const proto = tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(700);
      readBack = el.value;
      ok = String(readBack) === String(value);
    }

    console.log(
      `%c[${ok ? 'ACT PASS' : 'ACT FAIL'}]`, ok ? 'color:#0a0;font-weight:bold' : 'color:#c00;font-weight:bold',
      `"${label.slice(0, 35)}" via ${strategy}`,
      `\n   wrote: ${JSON.stringify(value)}\n   DOM read-back: ${JSON.stringify(readBack)}`,
    );
    return { index: all.indexOf(el), label, tag, role, strategy, wrote: value, readBack, ok };
  }

  return { list, fill };
}

if (typeof module !== 'undefined') module.exports = { createActor };
