/* "Menu" — the list of things the canteen sells, and their prices.

   Removing an item only takes it off the menu from now on. Past purchases
   that included it are untouched, so old receipts stay accurate. */

import { getMenuItems, addMenuItem, updateMenuItem, deleteMenuItem } from '../store.js';
import { money, escapeHtml, toast, openModal, confirmAction, emptyState, parseAmount } from '../ui.js';

export function render(root, session) {
  const campId = session.campId;

  function draw() {
    const items = getMenuItems(campId);

    root.innerHTML = `
      <div class="page">
        <div class="page-head">
          <h1>Menu</h1>
          <p>What the canteen sells, and what it costs.</p>
        </div>

        <div class="card">
          <div class="filters">
            <button class="btn btn-primary" id="add-item">Add item</button>
          </div>

          ${
            items.length === 0
              ? emptyState('No menu items yet', 'Add the first thing your canteen sells.')
              : `
            <table class="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th class="align-right">Price</th>
                  <th class="align-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${items
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${escapeHtml(item.name)}</strong></td>
                        <td class="align-right"><span class="money">${money(item.price)}</span></td>
                        <td class="align-right" style="white-space:nowrap">
                          <button class="btn btn-ghost btn-sm" data-edit="${item.id}">Edit</button>
                          <button class="btn btn-danger btn-sm" data-delete="${item.id}">Remove</button>
                        </td>
                      </tr>
                    `
                  )
                  .join('')}
              </tbody>
            </table>
          `
          }
        </div>
      </div>
    `;

    root.querySelector('#add-item').addEventListener('click', () => openItemDialog(null));

    root.querySelectorAll('[data-edit]').forEach((button) => {
      const item = items.find((i) => i.id === button.dataset.edit);
      button.addEventListener('click', () => openItemDialog(item));
    });

    root.querySelectorAll('[data-delete]').forEach((button) => {
      const item = items.find((i) => i.id === button.dataset.delete);
      button.addEventListener('click', () => removeItem(item));
    });
  }

  /* One dialog does both jobs: pass an item to edit it, or null to add a
     new one. */
  function openItemDialog(item) {
    const isEdit = Boolean(item);

    const { box, close } = openModal(`
      <h2 class="modal-title">${isEdit ? 'Edit item' : 'Add item'}</h2>
      <form id="item-form" novalidate>
        <label class="field">
          <span class="field-label">Name</span>
          <input class="input" name="name" autocomplete="off"
                 value="${isEdit ? escapeHtml(item.name) : ''}" />
        </label>

        <label class="field">
          <span class="field-label">Price</span>
          <input class="input" name="price" type="number" step="0.01" min="0.01"
                 placeholder="0.00" autocomplete="off"
                 value="${isEdit ? item.price.toFixed(2) : ''}" />
        </label>

        <p class="form-error hidden" id="item-error"></p>

        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="cancel-item">Cancel</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Save changes' : 'Add item'}</button>
        </div>
      </form>
    `);

    const errorLine = box.querySelector('#item-error');
    box.querySelector('#cancel-item').addEventListener('click', close);

    box.querySelector('#item-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(event.target);
      const name = String(data.get('name')).trim();
      const price = parseAmount(data.get('price'));

      if (!name) {
        errorLine.textContent = 'Give the item a name.';
        errorLine.classList.remove('hidden');
        return;
      }
      if (price === null) {
        errorLine.textContent = 'Enter a price greater than zero.';
        errorLine.classList.remove('hidden');
        return;
      }

      if (isEdit) {
        await updateMenuItem(item.id, { name, price });
        toast(`${name} updated.`);
      } else {
        await addMenuItem({ name, price });
        toast(`${name} added to the menu.`);
      }

      close();
      draw();
    });
  }

  async function removeItem(item) {
    const confirmed = await confirmAction({
      title: `Remove ${item.name} from the menu?`,
      body: `<p class="muted">It stops appearing on the Ring up screen. Past purchases
             that included it are not changed.</p>`,
      confirmLabel: 'Remove item',
      danger: true,
    });
    if (!confirmed) return;

    await deleteMenuItem(item.id);
    toast(`${item.name} removed from the menu.`);
    draw();
  }

  draw();
}
