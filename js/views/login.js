/* Sign-in screen — both staff and parents start here.

   Staff sign in with their camp's shared password.
   Parents sign in with their family code; there is no parent username. */

import { getAllCamps, verifyCampLogin, getCampersByFamilyCode } from '../store.js';
import { startStaffSession, startParentSession } from '../session.js';
import { go } from '../app.js';
import { escapeHtml } from '../ui.js';

// Which tab is showing. Remembered only while the screen is open.
let mode = 'staff';

export function render(root) {
  const camps = getAllCamps();

  const campOptions = camps
    .map((camp) => `<option value="${camp.id}">${escapeHtml(camp.name)}</option>`)
    .join('');

  root.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <h1>Camp canteen</h1>
        <p>Sign in to ring up snacks or top up a camper's balance.</p>

        <div class="role-switch">
          <button type="button" data-mode="staff"
                  class="${mode === 'staff' ? 'is-active' : ''}">Camp staff</button>
          <button type="button" data-mode="parent"
                  class="${mode === 'parent' ? 'is-active' : ''}">Parent</button>
        </div>

        <form id="login-form" novalidate>
          <label class="field">
            <span class="field-label">Camp</span>
            <select class="select" name="campId" required>${campOptions}</select>
          </label>

          ${
            mode === 'staff'
              ? `<label class="field">
                   <span class="field-label">Camp password</span>
                   <input class="input" type="password" name="password"
                          autocomplete="current-password" required />
                 </label>`
              : `<label class="field">
                   <span class="field-label">Family code</span>
                   <input class="input" type="text" name="familyCode"
                          placeholder="e.g. RIV201" autocomplete="off"
                          spellcheck="false" required />
                 </label>`
          }

          <p class="form-error hidden" id="login-error"></p>

          <button class="btn btn-primary btn-block" type="submit">
            ${mode === 'staff' ? 'Sign in' : 'View my campers'}
          </button>
        </form>

        <!-- Demo credentials. Delete this block once real camps are set up. -->
        <div class="login-hint">
          <strong>Demo logins —</strong>
          Camp Pinecrest staff password <code>pine2026</code>,
          Camp Lakeside staff password <code>lake2026</code>.
          Parent family code <code>RIV201</code> at Pinecrest.
        </div>
      </div>
    </div>
  `;

  // Switching between the staff and parent tabs just re-draws this screen.
  root.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      mode = button.dataset.mode;
      render(root);
    });
  });

  const form = root.querySelector('#login-form');
  const errorLine = root.querySelector('#login-error');

  const showError = (message) => {
    errorLine.textContent = message;
    errorLine.classList.remove('hidden');
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    errorLine.classList.add('hidden');

    const data = new FormData(form);
    const campId = data.get('campId');

    if (mode === 'staff') {
      const password = String(data.get('password') || '');
      if (!verifyCampLogin(campId, password)) {
        showError('That password does not match this camp.');
        return;
      }
      startStaffSession(campId);
      go('/staff/checkout');
      return;
    }

    const familyCode = String(data.get('familyCode') || '').trim();
    if (!familyCode) {
      showError('Enter your family code.');
      return;
    }
    // A family code is only valid if it actually has campers attached to it
    // at the chosen camp.
    if (getCampersByFamilyCode(campId, familyCode).length === 0) {
      showError('No campers found for that code at this camp.');
      return;
    }

    startParentSession(campId, familyCode);
    go('/parent');
  });
}
