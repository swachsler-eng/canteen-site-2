/* "Ring up" — the screen used at the canteen window.

   It works in two steps:
     1. Pick a camper — narrow by grade and bunk, or search by name
     2. Tap menu items to build a cart, then complete the sale

   A sale is refused outright if it costs more than the camper has. Balances
   are never allowed to go negative, so there is no "allow just this once".

   Rang up the wrong camper? Void the sale from the History screen. */

import { getCampersByCamp, getCamperById, getMenuItems, checkout } from '../store.js';
import { money, escapeHtml, toast, emptyState } from '../ui.js';
import { emptyFilter, matchesFilter, filterHtml, wireFilter } from '../grade-bunk-filter.js';

/* Screen state. These reset when you navigate away and come back.

   The grade/bunk filter deliberately survives a completed sale: the canteen
   usually serves one bunk at a time, so staff pick "Grade 5 → Aspen" once and
   ring up the whole line without re-selecting it after every kid. */
let selectedCamperId = null;
let cart = {}; // itemId -> quantity
let search = '';
let filter = emptyFilter();

export function render(root, session) {
  const campId = session.campId;

  function draw() {
    if (!selectedCamperId) {
      drawCamperPicker();
      return;
    }
    drawRegister();
  }

  /* ---------- step 1: choose a camper ---------- */

  function drawCamperPicker() {
    const query = search.trim().toLowerCase();

    const campers = getCampersByCamp(campId)
      .filter((camper) => matchesFilter(camper, filter))
      .filter((camper) => `${camper.firstName} ${camper.lastName}`.toLowerCase().includes(query));

    let listHtml;
    if (campers.length === 0) {
      listHtml = emptyState(
        query || filter.grade ? 'No campers match' : 'No campers yet',
        query || filter.grade ? 'Try a different grade, bunk, or spelling.' : 'Add campers on the Campers screen first.'
      );
    } else {
      listHtml = `<div class="menu-grid">${campers.map(camperTile).join('')}</div>`;
    }

    root.innerHTML = `
      <div class="page">
        <div class="page-head">
          <h1>Ring up a sale</h1>
          <p>Choose the camper you're serving.</p>
        </div>

        <div class="card">
          ${filterHtml(campId, filter)}

          <label class="field" style="margin-bottom:var(--space-4)">
            <span class="field-label">Or search by name</span>
            <input class="input" id="camper-search" type="search"
                   placeholder="Start typing a camper's name"
                   value="${escapeHtml(search)}" autocomplete="off" />
          </label>
          ${listHtml}
        </div>
      </div>
    `;

    wireFilter(root, filter, (next) => {
      filter = next;
      draw();
    });

    const searchBox = root.querySelector('#camper-search');
    searchBox.addEventListener('input', () => {
      search = searchBox.value;
      draw();
      // Re-drawing replaces the input, so put the cursor back where it was.
      const fresh = root.querySelector('#camper-search');
      fresh.focus();
      fresh.setSelectionRange(fresh.value.length, fresh.value.length);
    });

    root.querySelectorAll('[data-camper]').forEach((tile) => {
      tile.addEventListener('click', () => {
        selectedCamperId = tile.dataset.camper;
        cart = {};
        search = '';
        draw();
      });
    });
  }

  function camperTile(camper) {
    return `
      <button class="menu-tile" data-camper="${camper.id}">
        <span class="menu-tile-name">${escapeHtml(camper.firstName)} ${escapeHtml(camper.lastName)}</span>
        <span class="muted">Grade ${escapeHtml(camper.grade)} · ${escapeHtml(camper.bunk)}</span>
        <span class="menu-tile-price">${money(camper.balance)}</span>
      </button>
    `;
  }

  /* ---------- step 2: build the cart ---------- */

  function drawRegister() {
    const camper = getCamperById(selectedCamperId);

    // The camper could have been deleted on another screen.
    if (!camper) {
      selectedCamperId = null;
      draw();
      return;
    }

    const items = getMenuItems(campId);

    const lines = Object.entries(cart)
      .map(([itemId, qty]) => {
        const item = items.find((i) => i.id === itemId);
        return item ? { itemId, name: item.name, price: item.price, qty } : null;
      })
      .filter(Boolean);

    const total = Math.round(lines.reduce((sum, l) => sum + l.price * l.qty, 0) * 100) / 100;
    const remaining = Math.round((camper.balance - total) * 100) / 100;
    const tooExpensive = total > camper.balance;

    root.innerHTML = `
      <div class="page">
        <div class="page-head">
          <h1>Ring up a sale</h1>
          <p>Tap an item to add it to the cart.</p>
        </div>

        <div class="checkout-grid">
          <div class="card">
            <h2 class="card-title">Menu</h2>
            ${
              items.length
                ? `<div class="menu-grid">
                     ${items
                       .map(
                         (item) => `
                           <button class="menu-tile" data-item="${item.id}">
                             <span class="menu-tile-name">${escapeHtml(item.name)}</span>
                             <span class="menu-tile-price">${money(item.price)}</span>
                           </button>
                         `
                       )
                       .join('')}
                   </div>`
                : emptyState('No menu items yet', 'Add some on the Menu screen.')
            }
          </div>

          <div class="cart">
            <div class="cart-camper">
              <div class="cart-camper-name">
                ${escapeHtml(camper.firstName)} ${escapeHtml(camper.lastName)}
              </div>
              <div class="muted">
                Grade ${escapeHtml(camper.grade)} · Bunk ${escapeHtml(camper.bunk)}
              </div>
              <div class="cart-balance">
                <span>Balance</span>
                <span class="money">${money(camper.balance)}</span>
              </div>
              <button class="btn btn-ghost btn-sm" id="change-camper"
                      style="margin-top:var(--space-3)">Change camper</button>
            </div>

            ${
              lines.length
                ? `<ul class="cart-lines">
                     ${lines
                       .map(
                         (line) => `
                           <li class="cart-line">
                             <span>${escapeHtml(line.name)}</span>
                             <span class="qty-controls">
                               <button class="qty-btn" data-dec="${line.itemId}"
                                       aria-label="One fewer">−</button>
                               <span>${line.qty}</span>
                               <button class="qty-btn" data-inc="${line.itemId}"
                                       aria-label="One more">+</button>
                             </span>
                             <span class="money">${money(line.price * line.qty)}</span>
                           </li>
                         `
                       )
                       .join('')}
                   </ul>`
                : '<p class="muted" style="padding:var(--space-4) 0">Cart is empty.</p>'
            }

            <div class="cart-total">
              <span>Total</span>
              <span>${money(total)}</span>
            </div>

            <div class="cart-remaining ${tooExpensive ? 'is-short' : ''}">
              <span>${tooExpensive ? 'Short by' : 'Balance after'}</span>
              <span>${money(remaining)}</span>
            </div>

            ${
              tooExpensive
                ? `<p class="form-error">Not enough balance — remove an item or add funds first.</p>`
                : ''
            }

            <button class="btn btn-accent btn-block" id="complete-sale"
                    ${lines.length === 0 || tooExpensive ? 'disabled' : ''}>
              Complete sale
            </button>
          </div>
        </div>
      </div>
    `;

    root.querySelector('#change-camper').addEventListener('click', () => {
      selectedCamperId = null;
      cart = {};
      draw();
    });

    root.querySelectorAll('[data-item]').forEach((tile) => {
      tile.addEventListener('click', () => {
        const id = tile.dataset.item;
        cart[id] = (cart[id] || 0) + 1;
        draw();
      });
    });

    root.querySelectorAll('[data-inc]').forEach((button) => {
      button.addEventListener('click', () => {
        cart[button.dataset.inc] += 1;
        draw();
      });
    });

    root.querySelectorAll('[data-dec]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.dec;
        cart[id] -= 1;
        if (cart[id] <= 0) delete cart[id];
        draw();
      });
    });

    const saleButton = root.querySelector('#complete-sale');
    saleButton.addEventListener('click', async () => {
      // Writing to the database takes a moment. Disable the button so an
      // impatient double-click can't ring the sale up twice.
      saleButton.disabled = true;
      saleButton.textContent = 'Working…';

      const result = await checkout(selectedCamperId, lines);

      // The store checks the balance against the database too, so a screen
      // showing stale numbers still can't overdraw an account.
      if (!result.ok) {
        toast('Sale declined — not enough balance.', { error: true });
        draw();
        return;
      }

      toast(`${money(total)} charged to ${camper.firstName}.`);
      // Back to the camper list — the grade/bunk filter is kept on purpose.
      selectedCamperId = null;
      cart = {};
      draw();
    });
  }

  draw();
}
