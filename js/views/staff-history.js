/* "History" — every balance change at this camp, filterable, with the
   ability to void a mistake.

   Voiding never deletes. It adds a matching opposite entry and marks the
   original as voided, so the record shows what happened AND that it was
   undone. */

import {
  getTransactions,
  getCamperById,
  describeTransaction,
  voidTransaction,
  canVoid,
  getTransactionById,
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
  confirmAction,
  emptyState,
} from '../ui.js';

let nameFilter = '';
let typeFilter = 'all';

const TYPE_LABELS = {
  [TX_PURCHASE]: 'Purchase',
  [TX_PARENT_DEPOSIT]: 'Parent deposit',
  [TX_STAFF_ADJUSTMENT]: 'Staff adjustment',
};

export function render(root, session) {
  const campId = session.campId;

  function draw() {
    const query = nameFilter.trim().toLowerCase();

    const rows = getTransactions(campId)
      .map((tx) => {
        // The camper may since have been deleted — their history stays, so
        // fall back to a placeholder name rather than dropping the row.
        const camper = getCamperById(tx.camperId);
        return {
          tx,
          camperName: camper ? `${camper.firstName} ${camper.lastName}` : 'Removed camper',
        };
      })
      .filter((row) => {
        if (typeFilter !== 'all' && row.tx.type !== typeFilter) return false;
        if (query && !row.camperName.toLowerCase().includes(query)) return false;
        return true;
      });

    root.innerHTML = `
      <div class="page">
        <div class="page-head">
          <h1>History</h1>
          <p>Every balance change at this camp, newest first.</p>
        </div>

        <div class="card">
          <div class="filters">
            <input class="input" id="name-filter" type="search"
                   placeholder="Filter by camper name"
                   value="${escapeHtml(nameFilter)}" autocomplete="off" />
            <select class="select" id="type-filter">
              <option value="all">All types</option>
              <option value="${TX_PURCHASE}">Purchases</option>
              <option value="${TX_PARENT_DEPOSIT}">Parent deposits</option>
              <option value="${TX_STAFF_ADJUSTMENT}">Staff adjustments</option>
            </select>
          </div>

          ${
            rows.length === 0
              ? emptyState('Nothing to show', 'No transactions match these filters.')
              : `
            <table class="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Camper</th>
                  <th>What happened</th>
                  <th>Type</th>
                  <th class="align-right">Amount</th>
                  <th class="align-right">Balance after</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(historyRow).join('')}
              </tbody>
            </table>
          `
          }
        </div>
      </div>
    `;

    root.querySelector('#type-filter').value = typeFilter;

    const nameBox = root.querySelector('#name-filter');
    nameBox.addEventListener('input', () => {
      nameFilter = nameBox.value;
      draw();
      const fresh = root.querySelector('#name-filter');
      fresh.focus();
      fresh.setSelectionRange(fresh.value.length, fresh.value.length);
    });

    root.querySelector('#type-filter').addEventListener('change', (event) => {
      typeFilter = event.target.value;
      draw();
    });

    root.querySelectorAll('[data-void]').forEach((button) => {
      button.addEventListener('click', () => doVoid(button.dataset.void));
    });
  }

  function historyRow({ tx, camperName }) {
    const voidable = canVoid(tx).ok;

    return `
      <tr class="${tx.voidedBy ? 'tx-voided' : ''}">
        <td class="muted" style="white-space:nowrap">${formatDateTime(tx.timestamp)}</td>
        <td>${escapeHtml(camperName)}</td>
        <td class="tx-desc">${escapeHtml(describeTransaction(tx))}</td>
        <td>
          <span class="tag tag-${tx.type}">${TYPE_LABELS[tx.type]}</span>
          ${tx.voidedBy ? '<span class="tag tag-void">Voided</span>' : ''}
          ${tx.voidOf ? '<span class="tag tag-void">Void entry</span>' : ''}
        </td>
        <td class="align-right">
          <span class="money ${tx.amount < 0 ? 'debit' : 'credit'}">${signedMoney(tx.amount)}</span>
        </td>
        <td class="align-right"><span class="money">${money(tx.balanceAfter)}</span></td>
        <td class="align-right">
          ${voidable ? `<button class="btn btn-danger btn-sm" data-void="${tx.id}">Void</button>` : ''}
        </td>
      </tr>
    `;
  }

  async function doVoid(txId) {
    const tx = getTransactionById(txId);
    const camper = getCamperById(tx.camperId);
    const camperName = camper ? `${camper.firstName} ${camper.lastName}` : 'this camper';

    // Voiding a deposit the camper has already spent can only reclaim what is
    // actually left, because a balance never goes below zero. Say so up front
    // rather than surprising staff afterwards.
    const reclaimable = camper ? Math.min(Math.abs(tx.amount), camper.balance) : 0;
    const willBeShort = tx.amount > 0 && camper && reclaimable < tx.amount;

    const confirmed = await confirmAction({
      title: 'Void this transaction?',
      body: `
        <p class="muted">${escapeHtml(describeTransaction(tx))} — ${signedMoney(tx.amount)}
        for ${escapeHtml(camperName)}.</p>
        <p class="muted" style="margin-top:var(--space-3)">
          The original stays in history and a matching correction is added
          alongside it. Nothing is deleted.
        </p>
        ${
          willBeShort
            ? `<div class="warning-box">Only ${money(reclaimable)} can be taken back —
               ${escapeHtml(camperName)} has already spent the rest, and a balance
               can never go below $0.00.</div>`
            : ''
        }
      `,
      confirmLabel: 'Void it',
      danger: true,
    });
    if (!confirmed) return;

    const result = voidTransaction(txId);
    if (!result.ok) {
      toast(result.reason, { error: true });
    } else {
      toast('Transaction voided.');
    }
    draw();
  }

  draw();
}
