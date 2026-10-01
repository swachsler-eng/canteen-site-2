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
import { getCampById, connectToCamp, disconnect, whenDataChanges } from './store.js';
import { waitForAuthReady, signOutUser, currentUser } from './auth.js';
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

async function render() {
  const path = currentPath();
  const route = ROUTES[path];

  /* A session saved in this tab only counts if Firebase still has us signed
     in. They can disagree after the login expires, and Firestore would then
     refuse every request — so treat that as signed out. */
  let session = getSession();
  if (session && !currentUser()) {
    endSession();
    disconnect();
    session = null;
  }

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

  /* Signed-in screens need the camp's data before they can draw anything.
     The first visit downloads it; after that connectToCamp returns straight
     away, so this only shows the loading message once. */
  if (session) {
    root.innerHTML = '<div class="page"><div class="empty">Loading…</div></div>';
    try {
      await connectToCamp(session.campId);
    } catch (error) {
      root.innerHTML = `
        <div class="page">
          <div class="empty">
            <div class="empty-title">Couldn't reach the database</div>
            <p class="muted">Check your internet connection and reload the page.</p>
          </div>
        </div>
      `;
      console.error(error);
      return;
    }
  }

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

  document.getElementById('sign-out')?.addEventListener('click', async () => {
    endSession();
    disconnect();
    await signOutUser();
    go('/login');
    render();
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

/* When another device changes something — a parent deposits from home while
   the canteen laptop is open — Firestore tells us, and we redraw so the
   screen is never showing a stale balance. */
whenDataChanges(() => {
  if (getSession()) render();
});

window.addEventListener('hashchange', render);

/* On a page refresh, Firebase takes a moment to work out whether someone is
   still signed in. Drawing before that finishes would bounce a signed-in
   person back to the login screen, so wait for the answer first. */
document.getElementById('view').innerHTML =
  '<div class="page"><div class="empty">Loading…</div></div>';

waitForAuthReady().then(render);
