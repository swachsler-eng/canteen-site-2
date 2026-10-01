/* Tests for the money rules in js/store.js.

   Run with:   node test-store.mjs

   These cover the rules that would quietly corrupt balances if they broke:
   the zero floor, declining a sale that costs more than the camper has,
   rounding, and history staying in the right order. Add a case here whenever
   you add behaviour that touches a balance. */

// store.js expects a browser's localStorage. This stands in for it so the
// same file can run under Node without being changed.
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};

const store = await import('./js/store.js');

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}`);
    console.log(`          expected ${JSON.stringify(expected)}`);
    console.log(`          got      ${JSON.stringify(actual)}`);
  }
}

// Wipe back to the seed data so each test starts from a known state.
function reset() {
  storage.clear();
}

/* ---- a balance can never go negative ---- */

reset();
console.log('\nBalances never go negative');
{
  // Ava starts with $12.50.
  const camper = store.adjustBalanceByStaff('c_ava', -100, 'take it all');
  check('removing more than the camper has lands on $0.00', camper.balance, 0);

  const tx = store.getTransactionsByCamper('c_ava')[0];
  check('the recorded amount is what actually moved, not the -100 asked for', tx.amount, -12.5);
  check('balance after is zero', tx.balanceAfter, 0);
}

/* ---- purchases are declined, never partially charged ---- */

reset();
console.log('\nPurchases over the balance are declined');
{
  // Noah has $4.00.
  const result = store.checkout('c_noah', [
    { itemId: 'i_gatorade', name: 'Gatorade', price: 2.25, qty: 3 },
  ]);
  check('the sale is refused', result.ok, false);
  check('with a reason', result.reason, 'insufficient_balance');
  check('and the balance is untouched', store.getCamperById('c_noah').balance, 4);
  check('with nothing written to history', store.getTransactionsByCamper('c_noah').length, 0);
}

reset();
console.log('\nA sale for exactly the balance is allowed');
{
  const result = store.checkout('c_noah', [
    { itemId: 'i_chips', name: 'Chips', price: 2, qty: 2 },
  ]);
  check('the sale goes through', result.ok, true);
  check('leaving exactly zero', store.getCamperById('c_noah').balance, 0);
}

/* ---- rounding ---- */

reset();
console.log('\nMoney stays rounded to the cent');
{
  // 0.1 + 0.2 is famously 0.30000000000000004 in floating point. Repeating a
  // small deposit is where that drift would show up.
  store.resetBalanceToZero('c_maya');
  for (let i = 0; i < 10; i += 1) store.depositToCamper('c_maya', 0.1);
  check('ten 10c deposits make exactly $1.00', store.getCamperById('c_maya').balance, 1);

  store.depositToCamper('c_maya', 0.2);
  check('adding 20c makes exactly $1.20', store.getCamperById('c_maya').balance, 1.2);
}

/* ---- history ordering ---- */

reset();
console.log('\nHistory orders correctly inside one millisecond');
{
  // Several changes in a tight loop share a timestamp, so sorting by time
  // alone would scramble them. The sequence counter breaks the tie.
  for (let i = 0; i < 6; i += 1) store.depositToCamper('c_eli', 1);

  const history = store.getTransactionsByCamper('c_eli');
  const balances = history.map((tx) => tx.balanceAfter);
  const descending = [...balances].sort((a, b) => b - a);

  check('newest first, even with identical timestamps', balances, descending);
  check('sequence numbers strictly decrease down the list',
    history.map((tx) => tx.seq),
    [...history.map((tx) => tx.seq)].sort((a, b) => b - a));
}

/* ---- voiding ---- */

reset();
console.log('\nVoiding undoes a sale without deleting it');
{
  const sale = store.checkout('c_ava', [{ itemId: 'i_chips', name: 'Chips', price: 1.5, qty: 2 }]);
  check('sale went through', store.getCamperById('c_ava').balance, 9.5);

  const result = store.voidTransaction(sale.transaction.id);
  check('void succeeded', result.ok, true);
  check('the money came back', store.getCamperById('c_ava').balance, 12.5);

  const original = store.getTransactionById(sale.transaction.id);
  check('the original is still in history', Boolean(original), true);
  check('and is marked as voided', Boolean(original.voidedBy), true);
  check('history now has two entries, not zero', store.getTransactionsByCamper('c_ava').length, 2);

  const second = store.voidTransaction(sale.transaction.id);
  check('voiding the same sale twice is refused', second.ok, false);
}

reset();
console.log('\nVoiding a spent deposit cannot push the balance negative');
{
  store.resetBalanceToZero('c_maya');
  const deposit = store.depositToCamper('c_maya', 20);
  check('deposited', deposit.balance, 20);

  // Spend most of it, then try to take the whole deposit back.
  store.checkout('c_maya', [{ itemId: 'i_chips', name: 'Chips', price: 1.5, qty: 12 }]);
  check('balance after spending', store.getCamperById('c_maya').balance, 2);

  const depositTx = store
    .getTransactionsByCamper('c_maya')
    .find((tx) => tx.type === store.TX_PARENT_DEPOSIT);

  store.voidTransaction(depositTx.id);
  check('only what was left could be reclaimed', store.getCamperById('c_maya').balance, 0);
}

/* ---- families ---- */

reset();
console.log('\nSiblings share one family code');
{
  const rivera = store.getCampersByFamilyCode('pinecrest', 'RIV201');
  check('both Rivera campers are in the family', rivera.length, 2);

  const added = store.addCamper({
    campId: 'pinecrest',
    firstName: 'Zoe',
    lastName: 'Rivera',
    grade: '4',
    bunk: 'Maple',
    familyCode: 'RIV201',
  });
  check('a linked sibling keeps the same code', added.familyCode, 'RIV201');
  check('and starts at zero', added.balance, 0);
  check('family now has three', store.getCampersByFamilyCode('pinecrest', 'RIV201').length, 3);

  const fresh = store.addCamper({
    campId: 'pinecrest',
    firstName: 'Sam',
    lastName: 'Rivera',
    grade: '4',
    bunk: 'Maple',
    familyCode: null,
  });
  check('an unrelated Rivera gets a different code', fresh.familyCode !== 'RIV201', true);
}

/* ---- deleted campers keep their history ---- */

reset();
console.log('\nRemoving a camper keeps their transactions');
{
  store.checkout('c_ava', [{ itemId: 'i_chips', name: 'Chips', price: 1.5, qty: 1 }]);
  store.deleteCamper('c_ava');

  check('the camper is gone', store.getCamperById('c_ava'), null);
  check('but the transaction remains', store.getTransactionsByCamper('c_ava').length, 1);
}

/* ---- daily totals ---- */

reset();
console.log("\nToday's totals exclude voided sales");
{
  store.checkout('c_maya', [{ itemId: 'i_chips', name: 'Chips', price: 1.5, qty: 2 }]);
  const mistake = store.checkout('c_maya', [
    { itemId: 'i_ice', name: 'Ice pop', price: 1, qty: 5 },
  ]);
  store.depositToCamper('c_maya', 10);

  let totals = store.getDailyTotals('pinecrest');
  check('both sales counted before the void', totals.purchases, 8);
  check('purchase count', totals.purchaseCount, 2);

  store.voidTransaction(mistake.transaction.id);
  totals = store.getDailyTotals('pinecrest');

  check('the voided sale drops out of takings', totals.purchases, 3);
  check('and is reported on its own', totals.voided, 5);
  check('void count', totals.voidCount, 1);
  check('parent deposits are separate', totals.parentDeposits, 10);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
