/* The parent screen — the only one parents ever see.

   Parents see their own campers' balances, can add money, and can read their
   family's history. They CANNOT take money back out. That is a hard rule, not
   a setting: there is no remove-funds control anywhere on this screen, and
   the store has no parent-facing withdrawal function to call. If money needs
   to come back out, the camp office does it. */

import {
  getCampersByFamilyCode,
  getTransactionsByFamilyCode,
  getCamperById,
  depositToCamper,
  describeTransaction,
  TX_PURCHASE,
  TX_PARENT_DEPOSIT,
  TX_STAFF_ADJUSTMENT,
} from '../store.js';
import {
  money,
  signedMoney,
  formatDateTime,
  escapeHtml,
  toast,
  openModal,
  emptyState,
  parseAmount,
} from '../ui.js';
import { MAX_PARENT_DEPOSIT, exceedsDepositLimit } from '../money.js';

// Whose history is showing: 'all' for the whole family, or a camper's id.
let historyFilter = 'all';

const TYPE_LABELS = {
  [TX_PURCHASE]: 'Purchase',
  [TX_PARENT_DEPOSIT]: 'Deposit',
  [TX_STAFF_ADJUSTMENT]: 'Camp office',
};

export function render(root, session) {
  const { campId, familyCode } = session;

  function draw() {
    const campers = getCampersByFamilyCode(campId, familyCode);

    const transactions = getTransactionsByFamilyCode(campId, familyCode).filter(
      (tx) => historyFilter === 'all' || tx.camperId === historyFilter
    );

    root.innerHTML = `
      <div class="page">
        <div class="page-head">
          <h1>Your campers</h1>
          <p>Family code <span class="code-badge">${escapeHtml(familyCode)}</span></p>
        </div>

        <div class="camper-cards">
          ${campers
            .map(
              (camper) => `
                <div class="camper-card">
                  <div class="camper-card-name">
                    ${escapeHtml(camper.firstName)} ${escapeHtml(camper.lastName)}
                  </div>
                  <div class="camper-card-meta">
                    Grade ${escapeHtml(camper.grade)} · Bunk ${escapeHtml(camper.bunk)}
                  </div>
                  <div class="camper-card-balance">${money(camper.balance)}</div>
                  <button class="btn btn-accent btn-block" data-deposit="${camper.id}">
                    Add money
                  </button>
                </div>
              `
            )
            .join('')}
        </div>

        <div class="card">
          <h2 class="card-title">Activity</h2>

          <div class="filters">
            <select class="select" id="history-filter">
              <option value="all">Whole family</option>
              ${campers
                .map(
                  (camper) =>
                    `<option value="${camper.id}">${escapeHtml(camper.firstName)} ${escapeHtml(
                      camper.lastName
                    )}</option>`
                )
                .join('')}
            </select>
          </div>

          ${
            transactions.length === 0
              ? emptyState('Nothing yet', 'Purchases and deposits will show up here.')
              : `
            <table class="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Camper</th>
                  <th>What happened</th>
                  <th class="align-right">Amount</th>
                  <th class="align-right">Balance after</th>
                </tr>
              </thead>
              <tbody>
                ${transactions
                  .map((tx) => {
                    const camper = getCamperById(tx.camperId);
                    return `
                      <tr class="${tx.voidedBy ? 'tx-voided' : ''}">
                        <td class="muted" style="white-space:nowrap">
                          ${formatDateTime(tx.timestamp)}
                        </td>
                        <td>${escapeHtml(camper ? camper.firstName : '—')}</td>
                        <td class="tx-desc">
                          ${escapeHtml(describeTransaction(tx))}
                          <span class="tag tag-${tx.type}">${TYPE_LABELS[tx.type]}</span>
                          ${tx.voidedBy ? '<span class="tag tag-void">Voided</span>' : ''}
                        </td>
                        <td class="align-right">
                          <span class="money ${tx.amount < 0 ? 'debit' : 'credit'}">
                            ${signedMoney(tx.amount)}
                          </span>
                        </td>
                        <td class="align-right">
                          <span class="money">${money(tx.balanceAfter)}</span>
                        </td>
                      </tr>
                    `;
                  })
                  .join('')}
              </tbody>
            </table>
          `
          }
        </div>
      </div>
    `;

    root.querySelector('#history-filter').value = historyFilter;
    root.querySelector('#history-filter').addEventListener('change', (event) => {
      historyFilter = event.target.value;
      draw();
    });

    root.querySelectorAll('[data-deposit]').forEach((button) => {
      button.addEventListener('click', () => openDepositDialog(button.dataset.deposit));
    });
  }

  /* ---------- adding money ---------- */

  /* Two steps on purpose. The parent types an amount, and then has to pass a
     second screen that states plainly the money cannot be taken back out.
     The confirm button stays disabled until they tick the box, so the warning
     can't be clicked past without being read. */
  function openDepositDialog(camperId) {
    const camper = getCamperById(camperId);

    const { box, close } = openModal(`
      <h2 class="modal-title">Add money for ${escapeHtml(camper.firstName)}</h2>
      <p class="muted">Current balance <span class="money">${money(camper.balance)}</span></p>

      <form id="deposit-form" novalidate style="margin-top:var(--space-4)">
        <span class="field-label">Quick amounts</span>
        <div class="amount-presets">
          ${[10, 20, 25, 50]
            .map(
              (value) =>
                `<button type="button" class="amount-preset" data-preset="${value}">$${value}</button>`
            )
            .join('')}
        </div>

        <label class="field">
          <span class="field-label">Amount</span>
          <input class="input" name="amount" type="number" step="0.01" min="0.01"
                 max="${MAX_PARENT_DEPOSIT}" placeholder="0.00" autocomplete="off" />
          <span class="muted">Up to ${money(MAX_PARENT_DEPOSIT)} at a time. Need to add
            more? Contact the camp office.</span>
        </label>

        <p class="form-error hidden" id="deposit-error"></p>

        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="cancel-deposit">Cancel</button>
          <button type="submit" class="btn btn-primary">Continue</button>
        </div>
      </form>
    `);

    const errorLine = box.querySelector('#deposit-error');
    const amountInput = box.querySelector('[name="amount"]');

    box.querySelectorAll('[data-preset]').forEach((button) => {
      button.addEventListener('click', () => {
        amountInput.value = button.dataset.preset;
        amountInput.focus();
      });
    });

    box.querySelector('#cancel-deposit').addEventListener('click', close);

    box.querySelector('#deposit-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const amount = parseAmount(amountInput.value);

      if (amount === null) {
        errorLine.textContent = 'Enter an amount greater than zero.';
        errorLine.classList.remove('hidden');
        return;
      }

      // The database enforces this too; checking here just gives a clearer
      // message than a refused request would.
      if (exceedsDepositLimit(amount)) {
        errorLine.textContent =
          `${money(MAX_PARENT_DEPOSIT)} is the most you can add at once. ` +
          'Contact the camp office for a larger amount.';
        errorLine.classList.remove('hidden');
        return;
      }

      close();
      showDepositWarning(camper, amount);
    });
  }

  function showDepositWarning(camper, amount) {
    const { box, close } = openModal(`
      <h2 class="modal-title">Confirm ${money(amount)} for ${escapeHtml(camper.firstName)}</h2>

      <div class="warning-box">
        <strong>This cannot be undone.</strong>
        Money added to a camper's canteen balance can only be spent at the
        canteen. It cannot be withdrawn, refunded, or transferred back to you,
        and you will not be able to remove it yourself. Only add what you are
        comfortable spending at camp.
      </div>

      <label style="display:flex;gap:var(--space-3);align-items:flex-start;
                    font-size:0.9rem;cursor:pointer">
        <input type="checkbox" id="understood" style="margin-top:5px" />
        <span>I understand this ${money(amount)} cannot be taken back out.</span>
      </label>

      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="cancel-confirm">Cancel</button>
        <button type="button" class="btn btn-accent" id="do-deposit" disabled>
          Add ${money(amount)}
        </button>
      </div>
    `);

    const checkbox = box.querySelector('#understood');
    const confirmButton = box.querySelector('#do-deposit');

    checkbox.addEventListener('change', () => {
      confirmButton.disabled = !checkbox.checked;
    });

    box.querySelector('#cancel-confirm').addEventListener('click', close);

    confirmButton.addEventListener('click', async () => {
      confirmButton.disabled = true;
      confirmButton.textContent = 'Adding…';

      await depositToCamper(camper.id, amount);

      close();
      toast(`${money(amount)} added to ${camper.firstName}'s balance.`);
      draw();
    });
  }

  draw();
}
