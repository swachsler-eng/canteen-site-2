/* The router — this is the file that decides which screen you see.

   HOW NAVIGATION WORKS
   There is only one HTML page. The part of the address after the # decides
   what gets drawn, for example:

       index.html#/staff/checkout

   When the # part changes, the browser fires a "hashchange" event, we look
   the path up in the ROUTES table below, and that screen's render() function
   fills in the <main> element. Nothing reloads, and the back button still
   works because the address really did change.

   TO ADD A NEW SCREEN
     1. Make a file in js/views/ that exports a render(root, session) function
     2. Import it at the top of this file
     3. Add one line to the ROUTES table below */

import { getSession, endSession } from './session.js';
import { getCampById } from './store.js';
import { escapeHtml } from './ui.js';

import * as loginView from './views/login.js';
import * as checkoutView from './views/staff-checkout.js';
import * as campersView from './views/staff-campers.js';
import * as menuView from './views/staff-menu.js';
import * as historyView from './views/staff-history.js';
import * as reportView from './views/staff-report.js';
import * as parentView from './views/parent.js';

/* Every screen in the site. `role` says who is allowed in:
   'staff', 'parent', or null for anyone. `nav` is the label shown in the
   staff nav bar — leave it out to keep a screen off the nav. */
const ROUTES = {
  '/login': { view: loginView, role: null },
  '/staff/checkout': { view: checkoutView, role: 'staff', nav: 'Ring up' },
  '/staff/campers': { view: campersView, role: 'staff', nav: 'Campers' },
  '/staff/menu': { view: menuView, role: 'staff', nav: 'Menu' },
  '/staff/history': { view: historyView, role: 'staff', nav: 'History' },
  '/staff/report': { view: reportView, role: 'staff', nav: "Today's totals" },
  '/parent': { view: parentView, role: 'parent' },
};

// Where each role lands after signing in.
const HOME_FOR_ROLE = { staff: '/staff/checkout', parent: '/parent' };

/* Change the screen. Call this instead of setting location.hash by hand. */
export function go(path) {
  window.location.hash = `#${path}`;
}

/* Re-draw the current screen. Use it after changing data so the page
   shows the new numbers. */
export function refresh() {
  render();
}

function currentPath() {
  return window.location.hash.slice(1) || '/login';
}

function render() {
  const session = getSession();
  const path = currentPath();
  const route = ROUTES[path];

  // Unknown address — send them somewhere real.
  if (!route) {
    go(session ? HOME_FOR_ROLE[session.role] : '/login');
    return;
  }

  // Signed-out people can only see the login screen, and signed-in people
  // can only see screens meant for their role.
  if (route.role && (!session || session.role !== route.role)) {
    go(session ? HOME_FOR_ROLE[session.role] : '/login');
    return;
  }

  // Already signed in but sitting on the login screen? Go to their home.
  if (path === '/login' && session) {
    go(HOME_FOR_ROLE[session.role]);
    return;
  }

  drawHeader(session, path);

  const root = document.getElementById('view');
  root.innerHTML = '';
  route.view.render(root, session);
  window.scrollTo(0, 0);
}

function drawHeader(session, path) {
  const bar = document.getElementById('header-bar');
  const nav = document.getElementById('main-nav');
  const navInner = document.getElementById('nav-inner');

  const camp = session ? getCampById(session.campId) : null;

  bar.innerHTML = `
    <div class="brand">
      Canteen
      ${camp ? `<span class="brand-camp">${escapeHtml(camp.name)}</span>` : ''}
    </div>
    <div class="header-actions">
      ${session ? `<span class="role-chip">${session.role}</span>` : ''}
      ${session ? '<button class="btn btn-on-dark btn-sm" id="sign-out">Sign out</button>' : ''}
    </div>
  `;

  document.getElementById('sign-out')?.addEventListener('click', () => {
    endSession();
    go('/login');
  });

  // The nav bar is for staff only — parents have a single screen.
  if (session?.role === 'staff') {
    nav.classList.remove('hidden');
    navInner.innerHTML = Object.entries(ROUTES)
      .filter(([, route]) => route.role === 'staff' && route.nav)
      .map(
        ([routePath, route]) => `
          <button class="nav-link ${routePath === path ? 'is-active' : ''}"
                  data-path="${routePath}">${escapeHtml(route.nav)}</button>
        `
      )
      .join('');

    navInner.querySelectorAll('.nav-link').forEach((button) => {
      button.addEventListener('click', () => go(button.dataset.path));
    });
  } else {
    nav.classList.add('hidden');
    navInner.innerHTML = '';
  }
}

window.addEventListener('hashchange', render);
render();
