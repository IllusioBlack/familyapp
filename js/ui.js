// Small UI helpers shared by every module.
// h() builds DOM elements and always inserts text safely (no innerHTML).

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, val] of Object.entries(attrs || {})) {
    if (val == null || val === false) continue;
    if (key === 'class') el.className = val;
    else if (key.startsWith('on') && typeof val === 'function') el.addEventListener(key.slice(2).toLowerCase(), val);
    else if (key === 'value') el.value = val;
    else if (key === 'checked') el.checked = Boolean(val);
    else el.setAttribute(key, val === true ? '' : val);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

let toastTimer;
export function toast(message, kind = 'info') {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.textContent = message;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), 3200);
}

export function friendlyError(error) {
  const msg = error?.message || String(error);
  if (/row-level security|permission denied/i.test(msg)) return "You don't have permission to do that.";
  if (/Invalid login credentials/i.test(msg)) return 'Wrong email or password.';
  if (/Failed to fetch|NetworkError/i.test(msg)) return "Can't reach the server. Check your connection.";
  return msg;
}

export function showError(error) {
  console.error(error);
  toast(friendlyError(error), 'error');
}

/**
 * Show a form in a modal. Resolves to an object of field values, or null if cancelled.
 * fields: [{ name, label, type: 'text'|'select'|'textarea', value, options, placeholder, required, maxlength }]
 */
export function formDialog({ title, message, fields = [], submitLabel = 'Save', danger = false }) {
  return new Promise((resolve) => {
    const inputs = {};
    const form = h('form', { method: 'dialog', class: 'dialog-form' },
      h('h2', {}, title),
      message ? h('p', { class: 'muted' }, message) : null,
      fields.map((f) => {
        let input;
        if (f.type === 'select') {
          input = h('select', { name: f.name },
            f.options.map((o) => h('option', { value: o, selected: o === f.value ? true : null }, o)));
        } else if (f.type === 'textarea') {
          input = h('textarea', { name: f.name, rows: 3, placeholder: f.placeholder, maxlength: f.maxlength });
          input.value = f.value ?? '';
        } else {
          input = h('input', {
            name: f.name, type: f.type || 'text', value: f.value ?? '',
            placeholder: f.placeholder, required: f.required, maxlength: f.maxlength, autocomplete: 'off',
          });
        }
        inputs[f.name] = input;
        return h('label', { class: 'field' }, h('span', {}, f.label), input);
      }),
      h('div', { class: 'dialog-actions' },
        h('button', { type: 'button', class: 'btn ghost', onclick: () => close(null) }, 'Cancel'),
        h('button', { type: 'submit', class: danger ? 'btn danger' : 'btn primary' }, submitLabel)),
    );
    const dialog = h('dialog', { class: 'dialog' }, form);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const values = {};
      for (const [name, input] of Object.entries(inputs)) values[name] = input.value.trim();
      close(values);
    });
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    function close(result) {
      dialog.close();
      dialog.remove();
      resolve(result);
    }
    document.body.append(dialog);
    dialog.showModal();
    const first = Object.values(inputs)[0];
    if (first) setTimeout(() => first.focus(), 30);
  });
}

export async function confirmDialog(message, { title = 'Are you sure?', okLabel = 'OK', danger = false } = {}) {
  const result = await formDialog({ title, message, submitLabel: okLabel, danger });
  return result !== null;
}

export function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function nextSaturday(from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  return d;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

// Stable color per person, for the little name chips
export function personColor(id = '') {
  const palette = ['#d9480f', '#2f9e44', '#1971c2', '#9c36b5', '#e67700', '#0c8599', '#c2255c'];
  let n = 0;
  for (const ch of id) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[n % palette.length];
}
