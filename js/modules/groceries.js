import {
  h, clear, toast, showError, formDialog, confirmDialog, timeAgo, nextSaturday, copyText, personColor,
} from '../ui.js';

export const CATEGORIES = [
  'Produce', 'Meat & Seafood', 'Dairy & Eggs', 'Bakery', 'Pantry', 'Frozen',
  'Snacks', 'Drinks', 'Breakfast', 'Household', 'Personal Care', 'Other',
];

export default {
  id: 'groceries',
  label: 'Groceries',
  icon: '🛒',
  mount,
};

function mount(root, ctx) {
  const { supabase } = ctx;
  const famId = ctx.family.id;
  const state = {
    items: [],              // open + skipped
    view: 'list',           // 'list' | 'order' | 'history'
    who: 'all',             // filter by person
    suggestions: new Map(), // lowercased name -> { name, category }
    orders: null,
    loaded: false,
  };

  // --------------------------- data ---------------------------

  async function load() {
    const { data, error } = await supabase
      .from('grocery_items').select('*')
      .eq('family_id', famId).in('status', ['open', 'skipped'])
      .order('created_at', { ascending: true });
    if (error) return showError(error);
    state.items = data;
    state.loaded = true;
    render();
  }

  async function loadSuggestions() {
    const { data, error } = await supabase
      .from('grocery_items').select('name, category')
      .eq('family_id', famId).eq('status', 'ordered')
      .order('created_at', { ascending: false }).limit(400);
    if (error) return;
    for (const row of data) {
      const key = row.name.toLowerCase();
      if (!state.suggestions.has(key)) state.suggestions.set(key, row);
    }
    renderSuggestions();
  }

  async function loadOrders() {
    const { data, error } = await supabase
      .from('grocery_orders').select('*').eq('family_id', famId)
      .order('placed_at', { ascending: false }).limit(25);
    if (error) return showError(error);
    state.orders = data;
    render();
  }

  async function addItem({ name, quantity, category, notes }) {
    const { error } = await supabase.from('grocery_items').insert({
      family_id: famId,
      requested_by: ctx.user.id,
      name, category,
      quantity: quantity || null,
      notes: notes || null,
    });
    if (error) { showError(error); return false; }
    await load();
    return true;
  }

  async function update(id, patch) {
    const item = state.items.find((i) => i.id === id);
    if (item) { Object.assign(item, patch); render(); } // optimistic
    const { error } = await supabase.from('grocery_items').update(patch).eq('id', id);
    if (error) { showError(error); await load(); }
  }

  async function remove(id) {
    const { error } = await supabase.from('grocery_items').delete().eq('id', id);
    if (error) return showError(error);
    state.items = state.items.filter((i) => i.id !== id);
    render();
  }

  // Live updates from other phones
  let reloadTimer;
  const scheduleReload = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(load, 250); };
  const channel = supabase.channel(`groceries-${famId}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'grocery_items', filter: `family_id=eq.${famId}` }, scheduleReload)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'grocery_items', filter: `family_id=eq.${famId}` }, scheduleReload)
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'grocery_items' }, scheduleReload)
    .subscribe();
  const onVisible = () => { if (document.visibilityState === 'visible') load(); };
  document.addEventListener('visibilitychange', onVisible);

  // --------------------------- actions ---------------------------

  const canEdit = (item) => ctx.isParent() || (item.requested_by === ctx.user.id && item.status === 'open');

  async function editItem(item) {
    const v = await formDialog({
      title: 'Edit item',
      fields: [
        { name: 'name', label: 'Item', value: item.name, required: true, maxlength: 100 },
        { name: 'quantity', label: 'How many / how much', value: item.quantity ?? '', maxlength: 40 },
        { name: 'category', label: 'Aisle', type: 'select', options: CATEGORIES, value: item.category },
        { name: 'notes', label: 'Notes (brand, flavor, size...)', type: 'textarea', value: item.notes ?? '', maxlength: 200 },
      ],
    });
    if (!v || !v.name) return;
    await update(item.id, { name: v.name, quantity: v.quantity || null, category: v.category, notes: v.notes || null });
  }

  async function skipItem(item) {
    const who = ctx.memberName(item.requested_by);
    const v = await formDialog({
      title: `Skip "${item.name}" this week?`,
      message: `It moves to the Skipped section so ${who} can see why.`,
      fields: [{ name: 'note', label: `Note for ${who} (optional)`, placeholder: 'e.g. We still have some', maxlength: 200 }],
      submitLabel: 'Skip it',
    });
    if (!v) return;
    await update(item.id, { status: 'skipped', parent_note: v.note || null, in_cart: false });
  }

  async function deleteItem(item) {
    if (await confirmDialog(`Remove "${item.name}" from the list?`, { okLabel: 'Remove', danger: true })) await remove(item.id);
  }

  async function finishOrder() {
    const open = state.items.filter((i) => i.status === 'open');
    const inCart = open.filter((i) => i.in_cart).length;
    if (!inCart) return toast('Check off the items you ordered first.');
    const left = open.length - inCart;
    const ok = await confirmDialog(
      `${inCart} item${inCart === 1 ? '' : 's'} will be marked as ordered.` +
      (left ? ` ${left} unchecked item${left === 1 ? '' : 's'} will stay on the list for next week.` : ''),
      { title: 'Finish this order?', okLabel: 'Finish order' });
    if (!ok) return;
    const { error } = await supabase.rpc('finish_grocery_order');
    if (error) return showError(error);
    toast('Order saved. Nice work!', 'success');
    state.view = 'list';
    state.orders = null;
    await Promise.all([load(), loadSuggestions()]);
  }

  async function copyList() {
    const open = state.items.filter((i) => i.status === 'open');
    const lines = [`Groceries - ${new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`];
    for (const [cat, items] of groupByCategory(open)) {
      lines.push('', cat.toUpperCase());
      for (const i of items) {
        let line = `- ${i.name}`;
        if (i.quantity) line += ` (${i.quantity})`;
        if (i.notes) line += ` - ${i.notes}`;
        lines.push(line);
      }
    }
    await copyText(lines.join('\n'));
    toast('List copied. Paste it anywhere.', 'success');
  }

  // --------------------------- rendering ---------------------------

  const datalist = h('datalist', { id: 'grocery-suggestions' });
  function renderSuggestions() {
    clear(datalist).append(...[...state.suggestions.values()].map((s) => h('option', { value: s.name })));
  }

  function render() {
    const views = [['list', 'List']];
    if (ctx.isParent()) views.push(['order', 'Order mode']);
    views.push(['history', 'History']);
    if (!ctx.isParent() && state.view === 'order') state.view = 'list';

    clear(root).append(
      h('div', { class: 'page-head' },
        h('div', {},
          h('h1', {}, 'Groceries'),
          h('p', { class: 'muted' }, `Next order: ${nextSaturday().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}`)),
      ),
      h('div', { class: 'segmented', role: 'tablist' },
        views.map(([id, label]) => h('button', {
          role: 'tab', 'aria-selected': String(state.view === id), class: state.view === id ? 'active' : null,
          onclick: () => { state.view = id; if (id === 'history' && !state.orders) loadOrders(); render(); },
        }, label))),
      datalist,
      !state.loaded ? h('p', { class: 'muted center pad' }, 'Loading...')
        : state.view === 'order' ? renderOrderMode()
          : state.view === 'history' ? renderHistory()
            : renderList(),
    );
  }

  function renderAddForm() {
    const name = h('input', {
      name: 'name', required: true, maxlength: 100, list: 'grocery-suggestions',
      placeholder: 'What do you need?', autocomplete: 'off', 'aria-label': 'Item',
    });
    const qty = h('input', { name: 'quantity', maxlength: 40, placeholder: 'How many? (optional)', 'aria-label': 'Quantity' });
    const cat = h('select', { name: 'category', 'aria-label': 'Aisle' }, CATEGORIES.map((c) => h('option', { value: c }, c)));
    cat.value = 'Other';
    const notes = h('input', { name: 'notes', maxlength: 200, placeholder: 'Brand, flavor, size... (optional)', 'aria-label': 'Notes' });
    const btn = h('button', { type: 'submit', class: 'btn primary' }, 'Add');

    // Remember which aisle an item went in last time
    name.addEventListener('change', () => {
      const hit = state.suggestions.get(name.value.trim().toLowerCase());
      if (hit) cat.value = hit.category;
    });

    const form = h('form', { class: 'card add-form' },
      h('div', { class: 'row' }, name, btn),
      h('div', { class: 'row' }, qty, cat),
      notes);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = { name: name.value.trim(), quantity: qty.value.trim(), category: cat.value, notes: notes.value.trim() };
      if (!v.name) return;
      const dupe = state.items.find((i) => i.status === 'open' && i.name.toLowerCase() === v.name.toLowerCase());
      if (dupe) {
        const ok = await confirmDialog(
          `${ctx.memberName(dupe.requested_by)} already added "${dupe.name}"${dupe.quantity ? ` (${dupe.quantity})` : ''}. Add it again anyway?`,
          { title: 'Already on the list', okLabel: 'Add anyway' });
        if (!ok) return;
      }
      btn.disabled = true;
      const added = await addItem(v);
      btn.disabled = false;
      if (added) {
        toast(`Added ${v.name}`, 'success');
        form.reset(); cat.value = 'Other';
        name.focus();
      }
    });
    return form;
  }

  function renderList() {
    const open = state.items.filter((i) => i.status === 'open');
    const skipped = state.items.filter((i) => i.status === 'skipped');
    const shown = state.who === 'all' ? open : open.filter((i) => i.requested_by === state.who);

    const counts = new Map();
    for (const i of open) counts.set(i.requested_by, (counts.get(i.requested_by) ?? 0) + 1);

    return h('div', { class: 'stack' },
      addForm, // same element every render, so live updates never wipe what you're typing
      open.length ? h('div', { class: 'chips' },
        h('button', { class: state.who === 'all' ? 'chip active' : 'chip', onclick: () => { state.who = 'all'; render(); } },
          `Everyone (${open.length})`),
        ctx.members.filter((m) => counts.has(m.id)).map((m) => h('button', {
          class: state.who === m.id ? 'chip active' : 'chip',
          onclick: () => { state.who = m.id; render(); },
        }, h('span', { class: 'dot', style: `background:${personColor(m.id)}` }), `${m.display_name} (${counts.get(m.id)})`)),
      ) : null,
      shown.length
        ? [...groupByCategory(shown)].map(([cat, items]) => h('section', { class: 'group' },
          h('h3', { class: 'group-title' }, cat, h('span', { class: 'count' }, items.length)),
          h('ul', { class: 'items' }, items.map(renderItem))))
        : h('div', { class: 'empty' },
          h('div', { class: 'empty-icon' }, '🧺'),
          h('p', {}, open.length ? 'Nothing from this person yet.' : 'The list is empty. Add the first thing above!')),
      skipped.length ? h('details', { class: 'skipped' },
        h('summary', {}, `Skipped this week (${skipped.length})`),
        h('ul', { class: 'items' }, skipped.map(renderItem)),
        ctx.isParent() ? h('button', {
          class: 'btn ghost small',
          onclick: async () => {
            if (!(await confirmDialog('Delete all skipped items?', { okLabel: 'Clear', danger: true }))) return;
            const { error } = await supabase.from('grocery_items').delete().eq('family_id', famId).eq('status', 'skipped');
            if (error) return showError(error);
            load();
          },
        }, 'Clear skipped') : null,
      ) : null,
    );
  }

  function renderItem(item) {
    const isSkipped = item.status === 'skipped';
    const actions = [];
    if (canEdit(item) && !isSkipped) actions.push(h('button', { class: 'link', onclick: () => editItem(item) }, 'Edit'));
    if (ctx.isParent() && !isSkipped) actions.push(h('button', { class: 'link', onclick: () => skipItem(item) }, 'Skip'));
    if (ctx.isParent() && isSkipped) {
      actions.push(h('button', { class: 'link', onclick: () => update(item.id, { status: 'open', parent_note: null }) }, 'Put back'));
    }
    if (canEdit(item)) actions.push(h('button', { class: 'link danger', onclick: () => deleteItem(item) }, 'Remove'));

    return h('li', { class: `item${isSkipped ? ' is-skipped' : ''}` },
      h('div', { class: 'item-main' },
        h('div', { class: 'item-name' }, item.name, item.quantity ? h('span', { class: 'qty' }, item.quantity) : null),
        item.notes ? h('div', { class: 'item-notes' }, item.notes) : null,
        h('div', { class: 'item-meta' },
          h('span', { class: 'person', style: `--c:${personColor(item.requested_by ?? '')}` }, ctx.memberName(item.requested_by)),
          h('span', {}, timeAgo(item.created_at))),
        item.parent_note ? h('div', { class: 'parent-note' }, '💬 ', item.parent_note) : null),
      actions.length ? h('div', { class: 'item-actions' }, actions) : null);
  }

  function renderOrderMode() {
    const open = state.items.filter((i) => i.status === 'open');
    const done = open.filter((i) => i.in_cart).length;
    const pct = open.length ? Math.round((done / open.length) * 100) : 0;

    return h('div', { class: 'stack' },
      h('div', { class: 'card order-head' },
        h('div', { class: 'progress-label' }, h('strong', {}, `${done} of ${open.length}`), ' in the cart'),
        h('div', { class: 'progress' }, h('div', { class: 'bar', style: `width:${pct}%` })),
        h('p', { class: 'muted small' },
          'Tap items as you add them to your online cart. Both parents can do this at once. Anything left unchecked stays on the list for next week.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: copyList, disabled: !open.length }, 'Copy list'),
          h('button', { class: 'btn primary', onclick: finishOrder, disabled: !done }, 'Finish order'))),
      open.length
        ? [...groupByCategory(open)].map(([cat, items]) => h('section', { class: 'group' },
          h('h3', { class: 'group-title' }, cat),
          h('ul', { class: 'items checklist' }, items.map((item) => h('li', {
            class: `check-item${item.in_cart ? ' checked' : ''}`,
            onclick: () => update(item.id, { in_cart: !item.in_cart }),
          },
          h('span', { class: 'box', 'aria-hidden': 'true' }, item.in_cart ? '✓' : ''),
          h('div', { class: 'item-main' },
            h('div', { class: 'item-name' }, item.name, item.quantity ? h('span', { class: 'qty' }, item.quantity) : null),
            item.notes ? h('div', { class: 'item-notes' }, item.notes) : null,
            h('div', { class: 'item-meta' }, `for ${ctx.memberName(item.requested_by)}`)),
          )))))
        : h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, '🎉'), h('p', {}, 'Nothing on the list right now.')),
    );
  }

  function renderHistory() {
    if (!state.orders) return h('p', { class: 'muted center pad' }, 'Loading...');
    if (!state.orders.length) {
      return h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, '🧾'), h('p', {}, 'No orders yet. They show up here after a parent taps "Finish order".'));
    }
    return h('ul', { class: 'orders' }, state.orders.map((o) => {
      const body = h('div', { class: 'order-items' }, h('p', { class: 'muted small' }, 'Loading...'));
      const det = h('details', { class: 'card order' },
        h('summary', {},
          h('strong', {}, new Date(o.placed_at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })),
          h('span', { class: 'muted' }, ` ${o.item_count} item${o.item_count === 1 ? '' : 's'} - by ${ctx.memberName(o.placed_by)}`)),
        body);
      det.addEventListener('toggle', async () => {
        if (!det.open || det.dataset.loaded) return;
        const { data, error } = await supabase.from('grocery_items').select('*').eq('order_id', o.id).order('category');
        if (error) return showError(error);
        det.dataset.loaded = '1';
        clear(body).append(h('ul', { class: 'items compact' }, data.map((i) => h('li', { class: 'item' },
          h('div', { class: 'item-main' },
            h('div', { class: 'item-name' }, i.name, i.quantity ? h('span', { class: 'qty' }, i.quantity) : null),
            h('div', { class: 'item-meta' }, `${i.category} - for ${ctx.memberName(i.requested_by)}`)),
          h('div', { class: 'item-actions' }, h('button', {
            class: 'link',
            onclick: async () => {
              if (await addItem({ name: i.name, quantity: i.quantity, category: i.category, notes: i.notes })) toast(`${i.name} added to this week's list`, 'success');
            },
          }, 'Add again'))))));
      });
      return h('li', {}, det);
    }));
  }

  const addForm = renderAddForm();
  render();
  load();
  loadSuggestions();

  return () => {
    clearTimeout(reloadTimer);
    document.removeEventListener('visibilitychange', onVisible);
    supabase.removeChannel(channel);
  };
}

function groupByCategory(items) {
  const map = new Map();
  for (const c of CATEGORIES) map.set(c, []);
  for (const i of items) {
    if (!map.has(i.category)) map.set(i.category, []);
    map.get(i.category).push(i);
  }
  for (const [k, v] of map) if (!v.length) map.delete(k);
  return map;
}
