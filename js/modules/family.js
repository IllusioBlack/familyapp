import { h, clear, toast, showError, formDialog, confirmDialog, copyText, personColor } from '../ui.js';

export default {
  id: 'family',
  label: 'Family',
  icon: '👪',
  mount,
};

function mount(root, ctx) {
  const { supabase } = ctx;
  const parent = ctx.isParent();

  async function rpc(fn, args, success) {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) { showError(error); return null; }
    if (success) toast(success, 'success');
    await ctx.refresh();
    return data ?? true;
  }

  async function renameFamily() {
    const v = await formDialog({
      title: 'Rename family',
      fields: [{ name: 'name', label: 'Family name', value: ctx.family.name, required: true, maxlength: 60 }],
    });
    if (!v?.name) return;
    const { error } = await supabase.from('families').update({ name: v.name }).eq('id', ctx.family.id);
    if (error) return showError(error);
    await ctx.refresh();
  }

  async function renameMe() {
    const v = await formDialog({
      title: 'Change your name',
      fields: [{ name: 'name', label: 'Your name', value: ctx.profile.display_name, required: true, maxlength: 40 }],
    });
    if (!v?.name) return;
    const { error } = await supabase.from('profiles').update({ display_name: v.name }).eq('id', ctx.user.id);
    if (error) return showError(error);
    await ctx.refresh();
  }

  async function newCode() {
    const ok = await confirmDialog('The old code will stop working. People already in the family are not affected.',
      { title: 'Make a new family code?', okLabel: 'New code' });
    if (ok) await rpc('regenerate_join_code', {}, 'New code created');
  }

  clear(root).append(
    h('div', { class: 'page-head' }, h('h1', {}, 'Family')),

    h('section', { class: 'card stack' },
      h('div', { class: 'row spread' },
        h('div', {}, h('div', { class: 'muted small' }, 'Family name'), h('strong', { class: 'big' }, ctx.family.name)),
        parent ? h('button', { class: 'link', onclick: renameFamily }, 'Rename') : null),
      parent ? [
        h('div', { class: 'divider' }),
        h('div', { class: 'muted small' }, 'Invite code'),
        h('div', { class: 'row spread' },
          h('code', { class: 'join-code' }, ctx.family.join_code),
          h('div', { class: 'row' },
            h('button', { class: 'btn small', onclick: async () => { await copyText(ctx.family.join_code); toast('Code copied'); } }, 'Copy'),
            h('button', { class: 'btn ghost small', onclick: newCode }, 'New code'))),
        h('p', { class: 'muted small' },
          'Have each person open this site, create an account, and enter this code. Everyone joins as a kid - tap "Make parent" below for your spouse.'),
      ] : null),

    h('section', { class: 'card' },
      h('h3', {}, 'Members'),
      h('ul', { class: 'members' }, ctx.members.map((m) => {
        const me = m.id === ctx.user.id;
        return h('li', { class: 'member' },
          h('span', { class: 'avatar', style: `background:${personColor(m.id)}` }, m.display_name.slice(0, 1).toUpperCase()),
          h('div', { class: 'member-main' },
            h('strong', {}, m.display_name, me ? h('span', { class: 'muted' }, ' (you)') : null),
            h('span', { class: `role-badge ${m.role}` }, m.role)),
          h('div', { class: 'item-actions' },
            me ? h('button', { class: 'link', onclick: renameMe }, 'Change name') : null,
            parent ? h('button', {
              class: 'link',
              onclick: () => rpc('set_member_role', { member_id: m.id, new_role: m.role === 'parent' ? 'kid' : 'parent' },
                `${m.display_name} is now a ${m.role === 'parent' ? 'kid' : 'parent'}`),
            }, m.role === 'parent' ? 'Make kid' : 'Make parent') : null,
            parent && !me ? h('button', {
              class: 'link danger',
              onclick: async () => {
                if (await confirmDialog(`${m.display_name} will lose access to the family lists.`,
                  { title: `Remove ${m.display_name}?`, okLabel: 'Remove', danger: true })) {
                  await rpc('remove_member', { member_id: m.id }, `${m.display_name} removed`);
                }
              },
            }, 'Remove') : null));
      }))),

    h('section', { class: 'card stack' },
      h('h3', {}, 'What can each role do?'),
      h('ul', { class: 'plain small' },
        h('li', {}, h('strong', {}, 'Kids: '), 'add items, and edit or remove their own items until they are ordered.'),
        h('li', {}, h('strong', {}, 'Parents: '), 'everything kids can do, plus edit or skip anyone\'s items, use Order mode, and manage the family.'))),

    h('button', { class: 'btn ghost block', onclick: () => supabase.auth.signOut() }, `Sign out (${ctx.user.email})`),
  );
}
