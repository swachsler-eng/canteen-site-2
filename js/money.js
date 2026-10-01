/* The money rules, on their own.

   This file holds the arithmetic that decides what a balance change does.
   It deliberately knows nothing about Firebase, the browser, or where data
   is stored — give it numbers, it gives you numbers back.

   That separation is the point: these rules are the part where a quiet bug
   costs someone real money, so they live somewhere they can be tested
   directly by `node test-money.mjs` without a database or a browser.

   store.js calls these, then saves whatever they return. */

export const TX_PURCHASE = 'purchase';
export const TX_PARENT_DEPOSIT = 'parent_deposit';
export const TX_STAFF_ADJUSTMENT = 'staff_adjustment';

/* ======================================================================
   THE MOST A PARENT CAN ADD IN ONE GO

   This number also appears in firestore.rules, which is what actually
   enforces it — the check here is only so a parent gets a clear message
   instead of a refused request. IF YOU CHANGE IT, CHANGE IT IN BOTH PLACES.

   The cap exists because a parent's browser is trusted to say "this balance
   went up", and the database can only check that it rose, not that real
   money changed hands. The cap limits what a tampered browser could do.
   It goes away entirely once deposits are handled by a payment provider.
   ====================================================================== */
export const MAX_PARENT_DEPOSIT = 200;

/* Rounds to the nearest cent.

   Needed because computers can't store amounts like 0.1 exactly: adding ten
   of them gives 0.9999999999999999 rather than 1. Rounding after every
   operation stops that error building up across a season of small deposits. */
export function round2(amount) {
  return Math.round(amount * 100) / 100;
}

/* The total for a cart. cartLines: [{ name, price, qty }] */
export function cartTotal(cartLines) {
  return round2(cartLines.reduce((sum, line) => sum + line.price * line.qty, 0));
}

/* ======================================================================
   THE FOUR BALANCE RULES

   Each one takes the camper's current balance and returns a description of
   the change, or null to refuse it. None of them ever returns a balance
   below zero.
   ====================================================================== */

/* A purchase. Refused outright if it costs more than the camper has —
   never partially charged, never allowed to go negative. */
export function planPurchase(currentBalance, cartLines) {
  const total = cartTotal(cartLines);
  if (total > currentBalance) return null;

  return {
    balanceAfter: round2(currentBalance - total),
    type: TX_PURCHASE,
    items: cartLines,
  };
}

/* Is this more than a parent is allowed to add at once? Staff have no cap. */
export function exceedsDepositLimit(amount) {
  return amount > MAX_PARENT_DEPOSIT;
}

/* A deposit. Parents may only ever do this — there is no parent-facing
   withdrawal anywhere in the app. */
export function planDeposit(currentBalance, amount, { byStaff = false, note = '' } = {}) {
  return {
    balanceAfter: round2(currentBalance + amount),
    type: byStaff ? TX_STAFF_ADJUSTMENT : TX_PARENT_DEPOSIT,
    note,
  };
}

/* A staff adjustment, up or down. Taking away more than the camper has
   lands on $0.00 rather than going negative, and the transaction records
   what actually moved, not what was asked for. */
export function planStaffAdjustment(currentBalance, delta, note = '') {
  return {
    balanceAfter: round2(Math.max(0, currentBalance + delta)),
    type: TX_STAFF_ADJUSTMENT,
    note,
  };
}

/* Undoing an earlier change by applying its opposite.

   The zero floor still applies, so voiding a deposit the camper has already
   spent only reclaims what is actually left. */
export function planVoid(currentBalance, originalAmount, note) {
  return {
    balanceAfter: round2(Math.max(0, currentBalance - originalAmount)),
    type: TX_STAFF_ADJUSTMENT,
    note,
  };
}

/* Can this transaction be voided? Pass the transaction and whether its
   camper still exists. */
export function canVoidTransaction(tx, camperStillExists) {
  if (!tx) return { ok: false, reason: 'Transaction not found.' };
  if (tx.voidOf) return { ok: false, reason: 'This entry is itself a void.' };
  if (tx.voidedBy) return { ok: false, reason: 'Already voided.' };
  if (!camperStillExists) return { ok: false, reason: 'That camper has been removed.' };
  return { ok: true };
}

/* ---- descriptions ---- */

export function describeTransaction(tx) {
  if (tx.type === TX_PURCHASE) {
    return tx.items.map((l) => `${l.qty}× ${l.name}`).join(', ') || 'Canteen purchase';
  }
  if (tx.type === TX_PARENT_DEPOSIT) return 'Deposit from parent';
  if (tx.type === TX_STAFF_ADJUSTMENT) {
    const direction = tx.amount >= 0 ? 'Funds added by camp office' : 'Funds removed by camp office';
    return tx.note ? `${direction} — ${tx.note}` : direction;
  }
  return 'Balance change';
}

/* ---- sorting ---- */

/* Newest first. Two changes can land in the same millisecond, so the
   timestamp alone can't order them — seq counts up and breaks the tie. */
export function sortNewestFirst(transactions) {
  return [...transactions].sort((a, b) => b.timestamp - a.timestamp || b.seq - a.seq);
}

/* ---- end-of-day totals ---- */

/* A voided sale shouldn't still count as a sale, so voided purchases are
   left out of takings and reported on their own line instead. */
export function summariseDay(transactions, date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const dayTx = transactions.filter(
    (t) => t.timestamp >= start.getTime() && t.timestamp < end.getTime()
  );

  const totals = {
    date: start,
    purchases: 0,
    purchaseCount: 0,
    parentDeposits: 0,
    parentDepositCount: 0,
    staffAdded: 0,
    staffRemoved: 0,
    staffAdjustmentCount: 0,
    voided: 0,
    voidCount: 0,
    transactionCount: dayTx.length,
  };

  for (const tx of dayTx) {
    if (tx.type === TX_PURCHASE) {
      if (tx.voidedBy) {
        totals.voided = round2(totals.voided + Math.abs(tx.amount));
        totals.voidCount += 1;
      } else {
        totals.purchases = round2(totals.purchases + Math.abs(tx.amount));
        totals.purchaseCount += 1;
      }
    } else if (tx.type === TX_PARENT_DEPOSIT) {
      totals.parentDeposits = round2(totals.parentDeposits + tx.amount);
      totals.parentDepositCount += 1;
    } else if (tx.type === TX_STAFF_ADJUSTMENT && !tx.voidOf) {
      if (tx.amount >= 0) totals.staffAdded = round2(totals.staffAdded + tx.amount);
      else totals.staffRemoved = round2(totals.staffRemoved + Math.abs(tx.amount));
      totals.staffAdjustmentCount += 1;
    }
  }

  return totals;
}

/* ---- family codes ---- */

// Parents type this in, so keep it short and unambiguous.
export function generateFamilyCode(lastName) {
  const letters = (lastName || 'FAM').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3) || 'FAM';
  const digits = String(Math.floor(100 + Math.random() * 900));
  return letters + digits;
}
