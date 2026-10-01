/* Small helpers shared by every screen: formatting money and dates,
   escaping text safely, and the toast / modal popups.

   Nothing in here knows anything about campers or balances — it's all
   generic. */

/* ---- formatting ---- */

// 12.5 -> "$12.50"
export function money(amount) {
  return `$${Math.abs(amount).toFixed(2)}`;
}

// 5 -> "+$5.00"   |   -3 -> "−$3.00"
// Uses a real minus sign (−) rather than a hyphen so it lines up in columns.
export function signedMoney(amount) {
  const sign = amount < 0 ? '−' : '+';
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

export function formatDateTime(timestamp) {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/* Turns text into something safe to drop into HTML.

   This matters: camper names, menu item names and staff notes are all typed
   in by a person. If someone typed a name containing <script>, building HTML
   with it directly would run that script. Passing it through here first turns
   the brackets into harmless characters. Use it on EVERY piece of typed-in
   text that goes into a template below. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* Reads a typed-in dollar amount and returns a number, or null if it isn't a
   usable amount. Rejects blanks, words, zero and negatives in one place so
   every form doesn't have to re-check them. */
export function parseAmount(text) {
  const amount = Number(String(text).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100) / 100;
}

/* ---- toasts (the small confirmation that slides up in the corner) ---- */

export function toast(message, { error = false } = {}) {
  const stack = document.getElementById('toast-stack');
  const node = document.createElement('div');
  node.className = error ? 'toast is-error' : 'toast';
  node.textContent = message;
  stack.appendChild(node);

  setTimeout(() => {
    node.classList.add('is-leaving');
    node.addEventListener('animationend', () => node.remove());
  }, 3200);
}

/* ---- modal dialogs ---- */

/* Opens a popup containing whatever HTML you pass in.

   Returns { box, close } — `box` is the dialog element so you can find
   things inside it with box.querySelector(...), and `close()` shuts it. */
export function openModal(innerHtml) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${innerHtml}</div>`;

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKeydown);
  };

  function onKeydown(event) {
    if (event.key === 'Escape') close();
  }

  // Clicking the dimmed area outside the dialog closes it.
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener('keydown', onKeydown);

  document.body.appendChild(backdrop);

  const box = backdrop.querySelector('.modal');
  box.querySelector('input, select, button')?.focus();

  return { box, close };
}

/* A yes/no dialog. Use it with `await`:

     if (await confirmAction({ title: 'Remove camper?' })) { ... }

   It resolves to true if the confirm button was pressed, false otherwise. */
export function confirmAction({ title, body = '', confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const { box, close } = openModal(`
      <h2 class="modal-title">${escapeHtml(title)}</h2>
      <div class="modal-body">${body}</div>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-action="cancel">Cancel</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-action="confirm">
          ${escapeHtml(confirmLabel)}
        </button>
      </div>
    `);

    const finish = (result) => {
      close();
      resolve(result);
    };

    box.querySelector('[data-action="cancel"]').addEventListener('click', () => finish(false));
    box.querySelector('[data-action="confirm"]').addEventListener('click', () => finish(true));
  });
}

/* ---- empty states ---- */

export function emptyState(title, hint = '') {
  return `
    <div class="empty">
      <div class="empty-title">${escapeHtml(title)}</div>
      ${hint ? `<p class="muted">${escapeHtml(hint)}</p>` : ''}
    </div>
  `;
}
