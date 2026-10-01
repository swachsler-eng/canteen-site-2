/* Tests for the money rules in js/money.js.

   Run with:   node test-money.mjs

   These cover the rules that would quietly corrupt balances if they broke:
   the zero floor, declining a sale that costs more than the camper has,
   rounding, and history ordering. Add a case here whenever you change
   anything that touches a balance.

   There is no database or browser involved — money.js is deliberately kept
   free of Firebase so these can run instantly on their own. */

import {
  round2,
  cartTotal,
  planPurchase,
  planDeposit,
  planStaffAdjustment,
  planVoid,
  canVoidTransaction,
  describeTransaction,
  exceedsDepositLimit,
  MAX_PARENT_DEPOSIT,
  generateFamilyCode,
  sortNewestFirst,
  summariseDay,
  TX_PURCHASE,
  TX_PARENT_DEPOSIT,
  TX_STAFF_ADJUSTMENT,
} from './js/money.js';

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}`);
    console.log(`          expected ${JSON.stringify(expected)}`);
    console.log(`          got      ${JSON.stringify(actual)}`);
  }
}

/* ---- rounding ---- */

console.log('\nMoney stays rounded to the cent');
{
  // 0.1 + 0.2 is famously 0.30000000000000004 in floating point.
  let balance = 0;
  for (let i = 0; i < 10; i += 1) balance = planDeposit(balance, 0.1).balanceAfter;
  check('ten 10c deposits make exactly $1.00', balance, 1);

  check('adding 20c makes exactly $1.20', planDeposit(balance, 0.2).balanceAfter, 1.2);
  check('round2 trims floating point dust', round2(0.1 + 0.2), 0.3);

  check(
    'a cart total is rounded too',
    cartTotal([
      { name: 'Chips', price: 1.15, qty: 3 },
      { name: 'Ice pop', price: 0.95, qty: 1 },
    ]),
    4.4
  );
}

/* ---- the zero floor ---- */

console.log('\nBalances never go negative');
{
  const plan = planStaffAdjustment(12.5, -100, 'take it all');
  check('removing more than the camper has lands on $0.00', plan.balanceAfter, 0);
  check('it is recorded as a staff adjustment', plan.type, TX_STAFF_ADJUSTMENT);

  check('removing exactly the balance also lands on zero', planStaffAdjustment(12.5, -12.5).balanceAfter, 0);
  check('adding still works normally', planStaffAdjustment(5, 2.5).balanceAfter, 7.5);
}

/* ---- purchases ---- */

console.log('\nPurchases over the balance are declined');
{
  const tooMuch = planPurchase(4, [{ name: 'Gatorade', price: 2.25, qty: 3 }]);
  check('the sale is refused outright', tooMuch, null);

  const exact = planPurchase(4, [{ name: 'Chips', price: 2, qty: 2 }]);
  check('a sale for exactly the balance is allowed', exact.balanceAfter, 0);
  check('tagged as a purchase', exact.type, TX_PURCHASE);

  const normal = planPurchase(10, [{ name: 'Chips', price: 1.5, qty: 2 }]);
  check('a normal sale subtracts correctly', normal.balanceAfter, 7);
  check('and keeps the cart lines for the receipt', normal.items.length, 1);

  // One cent over should still be refused — no "close enough".
  check('one cent over is still declined', planPurchase(1.5, [{ name: 'x', price: 1.51, qty: 1 }]), null);
}

/* ---- deposits ---- */

console.log('\nDeposits');
{
  const parent = planDeposit(10, 20);
  check('a parent deposit is tagged as one', parent.type, TX_PARENT_DEPOSIT);
  check('and adds up', parent.balanceAfter, 30);

  const office = planDeposit(10, 20, { byStaff: true, note: 'cash at office' });
  check('a staff deposit is tagged as an adjustment', office.type, TX_STAFF_ADJUSTMENT);
  check('and keeps the reason', office.note, 'cash at office');
}

console.log('\nParent deposits are capped');
{
  // This limit is mirrored in firestore.rules, which is what truly enforces
  // it. If these ever disagree, the database wins and a parent gets a
  // confusing refusal — so this test exists to make the number deliberate.
  check('the cap is $200', MAX_PARENT_DEPOSIT, 200);
  check('a normal amount is fine', exceedsDepositLimit(20), false);
  check('exactly the cap is allowed', exceedsDepositLimit(200), false);
  check('a cent over is not', exceedsDepositLimit(200.01), true);
  check('a large amount is not', exceedsDepositLimit(5000), true);
}

/* ---- voiding ---- */

console.log('\nVoiding applies the opposite');
{
  // Undoing a $3 purchase (recorded as -3) gives the money back.
  check('voiding a purchase refunds it', planVoid(7, -3, 'oops').balanceAfter, 10);

  // Undoing a $20 deposit takes it back...
  check('voiding a deposit reclaims it', planVoid(20, 20, '').balanceAfter, 0);
  // ...but only as far as zero if it has been spent.
  check('and only reclaims what is left', planVoid(2, 20, '').balanceAfter, 0);
}

console.log('\nWhat can be voided');
{
  check('a normal purchase can be', canVoidTransaction({ type: TX_PURCHASE }, true).ok, true);
  check('an already-voided one cannot', canVoidTransaction({ voidedBy: 'tx_9' }, true).ok, false);
  check('a void entry itself cannot', canVoidTransaction({ voidOf: 'tx_1' }, true).ok, false);
  check('not if the camper is gone', canVoidTransaction({ type: TX_PURCHASE }, false).ok, false);
  check('and a missing transaction cannot', canVoidTransaction(null, true).ok, false);
}

/* ---- history ordering ---- */

console.log('\nHistory orders correctly inside one millisecond');
{
  // Identical timestamps — only seq can separate these.
  const sameMs = [
    { seq: 1, timestamp: 1000, balanceAfter: 9 },
    { seq: 3, timestamp: 1000, balanceAfter: 7 },
    { seq: 2, timestamp: 1000, balanceAfter: 8 },
  ];
  check(
    'newest first despite identical timestamps',
    sortNewestFirst(sameMs).map((t) => t.seq),
    [3, 2, 1]
  );

  check(
    'a later timestamp still wins over a higher seq',
    sortNewestFirst([
      { seq: 99, timestamp: 1000 },
      { seq: 1, timestamp: 2000 },
    ]).map((t) => t.seq),
    [1, 99]
  );

  const original = [{ seq: 1, timestamp: 1 }, { seq: 2, timestamp: 2 }];
  sortNewestFirst(original);
  check('sorting does not disturb the original list', original.map((t) => t.seq), [1, 2]);
}

/* ---- descriptions ---- */

console.log('\nTransactions describe themselves in plain English');
{
  check(
    'a purchase lists its items',
    describeTransaction({
      type: TX_PURCHASE,
      items: [{ qty: 2, name: 'Chips' }, { qty: 1, name: 'Ice pop' }],
    }),
    '2× Chips, 1× Ice pop'
  );
  check(
    'a deposit says so',
    describeTransaction({ type: TX_PARENT_DEPOSIT }),
    'Deposit from parent'
  );
  check(
    'an adjustment shows its direction and reason',
    describeTransaction({ type: TX_STAFF_ADJUSTMENT, amount: -5, note: 'refund' }),
    'Funds removed by camp office — refund'
  );
}

/* ---- daily totals ---- */

console.log("\nToday's totals exclude voided sales");
{
  const now = Date.now();
  const yesterday = now - 24 * 60 * 60 * 1000;

  const totals = summariseDay([
    { type: TX_PURCHASE, amount: -3, timestamp: now, voidedBy: null },
    { type: TX_PURCHASE, amount: -5, timestamp: now, voidedBy: 'tx_void' },
    { type: TX_PARENT_DEPOSIT, amount: 10, timestamp: now },
    { type: TX_STAFF_ADJUSTMENT, amount: 4, timestamp: now, voidOf: null },
    { type: TX_STAFF_ADJUSTMENT, amount: -2, timestamp: now, voidOf: null },
    { type: TX_STAFF_ADJUSTMENT, amount: 5, timestamp: now, voidOf: 'tx_2' },
    { type: TX_PURCHASE, amount: -99, timestamp: yesterday, voidedBy: null },
  ]);

  check('only the un-voided sale counts as takings', totals.purchases, 3);
  check('sale count', totals.purchaseCount, 1);
  check('the voided sale is reported separately', totals.voided, 5);
  check('void count', totals.voidCount, 1);
  check('parent deposits are their own line', totals.parentDeposits, 10);
  check('office additions', totals.staffAdded, 4);
  check('office removals', totals.staffRemoved, 2);
  check('the void entry is not counted as an adjustment', totals.staffAdjustmentCount, 2);
  check("yesterday's sale is excluded", totals.transactionCount, 6);
}

/* ---- family codes ---- */

console.log('\nFamily codes');
{
  const code = generateFamilyCode('Rivera');
  check('starts with three letters of the surname', code.slice(0, 3), 'RIV');
  check('and is six characters long', code.length, 6);
  check('digits on the end', /^[A-Z]{3}\d{3}$/.test(code), true);

  check('a short surname still works', generateFamilyCode('Ng').length >= 5, true);
  check('punctuation is stripped', generateFamilyCode("O'Brien").slice(0, 3), 'OBR');
  check('an empty surname falls back', generateFamilyCode('').slice(0, 3), 'FAM');

  // Two unrelated families sharing a surname must not collide every time.
  const codes = new Set();
  for (let i = 0; i < 50; i += 1) codes.add(generateFamilyCode('Cone'));
  check('the same surname produces varied codes', codes.size > 1, true);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
