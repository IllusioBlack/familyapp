import { supabase, configured } from './supabase.js';
import { h, clear, toast, showError } from './ui.js';
import groceries from './modules/groceries.js';
import family from './modules/family.js';

// ---------------------------------------------------------------------
// Modules: add new features (chores, calendar, meals...) to this list.
// Each module is { id, label, icon, mount(container, ctx) -> cleanup }.
// ---------------------------------------------------------------------
const MODULES = [groceries, family];

const app = document.getElementById('app');
const ctx = {
  supabase,
  user: null,
  profile: null,
  family: null,
  members: [],
  memberName: (id) => ctx.members.find((m) => m.id === id)?.display_name ?? 'Someone',
  isParent: () => ctx.profile?.role === 'parent',
  refresh: async () => { await loadFamily(); renderShell(); },
};
let cleanup = null;
let routing = false;

boot();

async function boot() {
  if (!configured) return renderNotConfigured();
  supabase.auth.onAuthStateChange((event) => {
    // Defer: calling Supabase inside this callback can deadlock the client
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') setTimeout(route, 0);
  });
  window.addEventListener('hashchange', () => ctx.profile?.family_id && renderShell());
  await route();
}

async function route() {
  if (routing) return;
  routing = true;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    ctx.user = session?.user ?? null;
    if (!ctx.user) return renderAuth();
    await loadFamily();
    if (!ctx.profile?.family_id) return renderOnboarding();
    renderShell();
  } catch (e) {
    showError(e);
  } finally {
    routing = false;
  }
}

async function loadFamily() {
  const { data: profile, error } = await supabase
    .from('profiles').select('*').eq('id', ctx.user.id).maybeSingle();
  if (error) throw error;
  ctx.profile = profile;
  ctx.family = null;
  ctx.members = [];
  if (!profile?.family_id) return;
  const [fam, mem] = await Promise.all([
    supabase.from('families').select('*').eq('id', profile.family_id).single(),
    supabase.from('profiles').select('*').eq('family_id', profile.family_id).order('created_at'),
  ]);
  if (fam.error) throw fam.error;
  if (mem.error) throw mem.error;
  ctx.family = fam.data;
  ctx.members = mem.data;
}

// ---------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------

function renderNotConfigured() {
  clear(app).append(
    h('main', { class: 'center-screen' },
      h('div', { class: 'card narrow' },
        h('h1', {}, 'Almost there'),
        h('p', {}, 'Open config.js and paste in your Supabase project URL and publishable key, then reload this page.'),
        h('p', { class: 'muted' }, 'See README.md for step-by-step setup.'))));
}

function renderAuth(mode = 'signin') {
  const isSignup = mode === 'signup';
  const email = h('input', { type: 'email', required: true, autocomplete: 'email', placeholder: 'you@example.com' });
  const password = h('input', {
    type: 'password', required: true, minlength: 6,
    autocomplete: isSignup ? 'new-password' : 'current-password', placeholder: 'At least 6 characters',
  });
  const submit = h('button', { type: 'submit', class: 'btn primary block' }, isSignup ? 'Create account' : 'Sign in');

  const form = h('form', { class: 'stack' },
    h('label', { class: 'field' }, h('span', {}, 'Email'), email),
    h('label', { class: 'field' }, h('span', {}, 'Password'), password),
    submit);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    try {
      if (isSignup) {
        const { data, error } = await supabase.auth.signUp({ email: email.value.trim(), password: password.value });
        if (error) throw error;
        if (!data.session) {
          toast('Check your email to confirm your account, then sign in.');
          return renderAuth('signin');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
        if (error) throw error;
      }
    } catch (err) {
      showError(err);
    } finally {
      submit.disabled = false;
    }
  });

  clear(app).append(
    h('main', { class: 'center-screen' },
      h('div', { class: 'card narrow' },
        h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, '🏡'), 'Family Organizer'),
        h('h1', {}, isSignup ? 'Create your account' : 'Welcome back'),
        form,
        h('p', { class: 'muted center' },
          isSignup ? 'Already have an account? ' : 'New here? ',
          h('a', { href: '#', onclick: (e) => { e.preventDefault(); renderAuth(isSignup ? 'signin' : 'signup'); } },
            isSignup ? 'Sign in' : 'Create an account')))));
  email.focus();
}

function renderOnboarding() {
  const name = h('input', { required: true, maxlength: 40, placeholder: 'e.g. Dad, Mom, Sam', autocomplete: 'given-name' });
  const code = h('input', { required: true, maxlength: 6, placeholder: 'ABC123', class: 'code-input', autocomplete: 'off' });
  const famName = h('input', { required: true, maxlength: 60, placeholder: 'e.g. The Smith Family' });

  const joinForm = h('form', { class: 'stack' },
    h('label', { class: 'field' }, h('span', {}, 'Family code'), code),
    h('button', { type: 'submit', class: 'btn primary block' }, 'Join family'));
  const createForm = h('form', { class: 'stack' },
    h('label', { class: 'field' }, h('span', {}, 'Family name'), famName),
    h('button', { type: 'submit', class: 'btn block' }, 'Start a new family'));

  async function run(fn, args) {
    if (!name.value.trim()) { name.focus(); return toast('Enter your name first.'); }
    const { error } = await supabase.rpc(fn, args);
    if (error) return showError(error);
    await route();
  }
  joinForm.addEventListener('submit', (e) => { e.preventDefault(); run('join_family', { code: code.value, my_name: name.value }); });
  createForm.addEventListener('submit', (e) => { e.preventDefault(); run('create_family', { family_name: famName.value, my_name: name.value }); });

  clear(app).append(
    h('main', { class: 'center-screen' },
      h('div', { class: 'card narrow stack' },
        h('h1', {}, "Let's get you set up"),
        h('label', { class: 'field' }, h('span', {}, 'What should your family call you?'), name),
        h('div', { class: 'divider' }),
        h('h3', {}, 'Joining your family?'),
        h('p', { class: 'muted' }, 'Ask a parent for the 6-letter family code (it is on their Family tab).'),
        joinForm,
        h('div', { class: 'divider' }, h('span', {}, 'or')),
        h('h3', {}, 'First one here?'),
        createForm,
        h('button', { class: 'btn ghost small', onclick: () => supabase.auth.signOut() }, 'Sign out'))));
  name.focus();
}

function renderShell() {
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  const id = location.hash.replace(/^#\/?/, '') || MODULES[0].id;
  const current = MODULES.find((m) => m.id === id) ?? MODULES[0];
  const container = h('main', { class: 'content' });

  clear(app).append(
    h('header', { class: 'topbar' },
      h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, '🏡'), ctx.family.name),
      h('span', { class: 'whoami' }, ctx.profile.display_name,
        h('span', { class: `role-badge ${ctx.profile.role}` }, ctx.profile.role))),
    container,
    h('nav', { class: 'tabbar' },
      MODULES.map((m) => h('a', { href: `#/${m.id}`, class: m === current ? 'active' : null },
        h('span', { class: 'tab-icon', 'aria-hidden': 'true' }, m.icon), h('span', {}, m.label)))));

  cleanup = current.mount(container, ctx) ?? null;
}
