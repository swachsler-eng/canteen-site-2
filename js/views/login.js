/* Sign-in screen — both staff and parents start here.

   Staff sign in with their camp's shared password, which Firebase checks on
   Google's servers. Parents sign in with their family code; there is no
   parent username and no parent password. */

import { getAllCamps, connectToCamp, getCampersByFamilyCode } from '../store.js';
import { signInStaff, signInParent, signOutUser } from '../auth.js';
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

          <button class="btn btn-primary btn-block" type="submit" id="login-submit">
            ${mode === 'staff' ? 'Sign in' : 'View my campers'}
          </button>
        </form>
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
  const submitButton = root.querySelector('#login-submit');
  const originalLabel = submitButton.textContent.trim();

  const showError = (message) => {
    errorLine.textContent = message;
    errorLine.classList.remove('hidden');
    submitButton.disabled = false;
    submitButton.textContent = originalLabel;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorLine.classList.add('hidden');

    // Signing in goes over the network, so disable the button to stop
    // impatient double-clicks firing two attempts.
    submitButton.disabled = true;
    submitButton.textContent = 'Signing in…';

    const data = new FormData(form);
    const campId = String(data.get('campId'));

    if (mode === 'staff') {
      const result = await signInStaff(campId, String(data.get('password') || ''));
      if (!result.ok) {
        showError(result.reason);
        return;
      }
      startStaffSession(campId);
      go('/staff/checkout');
      return;
    }

    /* Parents: sign in anonymously first, because we can't read the camp's
       campers to check the family code until Firebase trusts us at all. */
    const familyCode = String(data.get('familyCode') || '').trim();
    if (!familyCode) {
      showError('Enter your family code.');
      return;
    }

    const result = await signInParent();
    if (!result.ok) {
      showError(result.reason);
      return;
    }

    try {
      await connectToCamp(campId);
    } catch (error) {
      console.error(error);
      showError("Couldn't reach the camp's records. Check your connection.");
      return;
    }

    // A code is only valid if campers are actually attached to it.
    if (getCampersByFamilyCode(campId, familyCode).length === 0) {
      // Don't leave them signed in anonymously after a failed attempt.
      await signOutUser();
      showError('No campers found for that code at this camp.');
      return;
    }

    startParentSession(campId, familyCode);
    go('/parent');
  });
}
