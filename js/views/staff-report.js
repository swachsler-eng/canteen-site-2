/* "Today's totals" — what staff need at the end of the day to square the
   cash box against what the system recorded.

   A voided sale is not counted as a sale. It's reported on its own line
   instead, so the purchase total reflects what was actually kept. */

import { getDailyTotals } from '../store.js';
import { money } from '../ui.js';

export function render(root, session) {
  const campId = session.campId;

  // Which day is being shown. Starts on today; the date box can go back.
  let selectedDate = new Date();

  function draw() {
    const totals = getDailyTotals(campId, selectedDate);

    // An <input type="date"> wants YYYY-MM-DD. Build it from the local date
    // parts rather than toISOString(), which would shift by the timezone and
    // could show the wrong day.
    const year = selectedDate.getFullYear();
    const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
    const day = String(selectedDate.getDate()).padStart(2, '0');

    root.innerHTML = `
      <div class="page">
        <div class="page-head">
          <h1>Today's totals</h1>
          <p>${selectedDate.toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          })}</p>
        </div>

        <div class="card" style="margin-bottom:var(--space-5)">
          <div class="filters" style="margin-bottom:0">
            <label class="field" style="margin-bottom:0">
              <span class="field-label">Show a different day</span>
              <input class="input" type="date" id="date-picker" value="${year}-${month}-${day}" />
            </label>
          </div>
        </div>

        <div class="stat-grid">
          <div class="stat">
            <div class="stat-label">Canteen sales</div>
            <div class="stat-value">${money(totals.purchases)}</div>
            <div class="stat-sub">${totals.purchaseCount} ${
              totals.purchaseCount === 1 ? 'sale' : 'sales'
            }</div>
          </div>

          <div class="stat">
            <div class="stat-label">Parent deposits</div>
            <div class="stat-value">${money(totals.parentDeposits)}</div>
            <div class="stat-sub">${totals.parentDepositCount} online ${
              totals.parentDepositCount === 1 ? 'deposit' : 'deposits'
            }</div>
          </div>

          <div class="stat">
            <div class="stat-label">Added by office</div>
            <div class="stat-value">${money(totals.staffAdded)}</div>
            <div class="stat-sub">Cash and corrections taken in</div>
          </div>

          <div class="stat">
            <div class="stat-label">Removed by office</div>
            <div class="stat-value">${money(totals.staffRemoved)}</div>
            <div class="stat-sub">Refunds and corrections paid out</div>
          </div>

          <div class="stat">
            <div class="stat-label">Voided sales</div>
            <div class="stat-value">${money(totals.voided)}</div>
            <div class="stat-sub">${totals.voidCount} ${
              totals.voidCount === 1 ? 'sale' : 'sales'
            } undone — not counted above</div>
          </div>

          <div class="stat">
            <div class="stat-label">All activity</div>
            <div class="stat-value">${totals.transactionCount}</div>
            <div class="stat-sub">Balance changes recorded</div>
          </div>
        </div>
      </div>
    `;

    root.querySelector('#date-picker').addEventListener('change', (event) => {
      if (!event.target.value) return;
      // Splitting the value by hand keeps it in local time. Passing the
      // string straight to new Date() would read it as UTC.
      const [y, m, d] = event.target.value.split('-').map(Number);
      selectedDate = new Date(y, m - 1, d);
      draw();
    });
  }

  draw();
}
