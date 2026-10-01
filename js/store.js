/* Canteen data layer.

   Every read and write in the app goes through this module. The storage
   underneath is localStorage, which is per-browser and not shared between
   devices — swapping it for a real backend should mean editing only this
   file, so keep the exported function names and shapes stable. */

const DB_KEY = 'canteen_db';

/* Camps are defined here in code, not through a UI. To add or change a camp,
   edit this list: it is re-applied over saved data on every load, so edits
   show up on the next page refresh. Grades map to the bunks inside them, and
   staff pick from these lists when adding a camper so a typo can't invent a
   phantom bunk. */
const CAMP_SEED = [
  {
    id: 'pinecrest',
    name: 'Camp Pinecrest',
    password: 'pine2026',
    structure: {
      '3': ['Birch', 'Cedar'],
      '4': ['Maple', 'Spruce'],
      '5': ['Aspen', 'Hemlock'],
      '6': ['Juniper'],
    },
  },
  {
    id: 'lakeside',
    name: 'Camp Lakeside',
    password: 'lake2026',
    structure: {
      '4': ['Otter', 'Heron'],
      '5': ['Loon', 'Osprey'],
      '6': ['Kingfisher', 'Sandpiper'],
    },
  },
];

export const TX_PURCHASE = 'purchase';
export const TX_PARENT_DEPOSIT = 'parent_deposit';
export const TX_STAFF_ADJUSTMENT = 'staff_adjustment';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function loadDb() {
  const raw = localStorage.getItem(DB_KEY);
  const db = raw ? JSON.parse(raw) : seedDb();

  let changed = !raw;
  for (const camp of CAMP_SEED) {
    if (JSON.stringify(db.camps[camp.id]) !== JSON.stringify(camp)) {
      db.camps[camp.id] = camp;
      changed = true;
    }
  }

  if (changed) saveDb(db);
  return db;
}

function saveDb(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Parents type this in, so keep it short and unambiguous.
function generateFamilyCode(lastName) {
  const letters = (lastName || 'FAM').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3) || 'FAM';
  const digits = String(Math.floor(100 + Math.random() * 900));
  return letters + digits;
}

function seedDb() {
  const camps = {};
  for (const c of CAMP_SEED) camps[c.id] = c;

  const campers = {};
  const camper = (id, campId, firstName, lastName, grade, bunk, balance, familyCode) => {
    campers[id] = { id, campId, firstName, lastName, grade, bunk, balance, familyCode };
  };
  camper('c_ava', 'pinecrest', 'Ava', 'Rivera', '5', 'Aspen', 12.5, 'RIV201');
  camper('c_noah', 'pinecrest', 'Noah', 'Rivera', '3', 'Birch', 4, 'RIV201');
  camper('c_maya', 'pinecrest', 'Maya', 'Goldberg', '4', 'Maple', 20, 'GOL447');
  camper('c_eli', 'lakeside', 'Eli', 'Tanaka', '6', 'Kingfisher', 8.75, 'TAN318');

  const menuItems = {};
  const item = (id, campId, name, price) => {
    menuItems[id] = { id, campId, name, price };
  };
  item('i_ice', 'pinecrest', 'Ice pop', 1.0);
  item('i_chips', 'pinecrest', 'Chips', 1.5);
  item('i_gatorade', 'pinecrest', 'Gatorade', 2.25);
  item('i_pretzel', 'pinecrest', 'Soft pretzel', 2.0);
  item('i_water', 'lakeside', 'Water bottle', 1.0);
  item('i_candy', 'lakeside', 'Candy bar', 1.75);

  return { camps, campers, menuItems, transactions: {}, nextSeq: 0 };
}

/* ---- camps ---- */

export function getAllCamps() {
  const db = loadDb();
  return Object.values(db.camps).sort((a, b) => collator.compare(a.name, b.name));
}

export function getCampById(campId) {
  return loadDb().camps[campId] || null;
}

export function verifyCampLogin(campId, password) {
  const camp = getCampById(campId);
  if (!camp || camp.password !== password) return null;
  return camp;
}

export function getGrades(campId) {
  const camp = getCampById(campId);
  return Object.keys(camp?.structure ?? {}).sort(collator.compare);
}

export function getBunksForGrade(campId, grade) {
  const camp = getCampById(campId);
  return [...(camp?.structure?.[grade] ?? [])].sort(collator.compare);
}

/* ---- campers ---- */

export function getCampersByCamp(campId) {
  const db = loadDb();
  return Object.values(db.campers)
    .filter((c) => c.campId === campId)
    .sort((a, b) => collator.compare(`${a.lastName} ${a.firstName}`, `${b.lastName} ${b.firstName}`));
}

export function getCamperById(camperId) {
  return loadDb().campers[camperId] || null;
}

export function getCampersByFamilyCode(campId, familyCode) {
  const db = loadDb();
  const code = familyCode.trim().toUpperCase();
  return Object.values(db.campers).filter((c) => c.campId === campId && c.familyCode === code);
}

// grade -> bunk -> campers, for browsing without knowing a name.
export function getCampersGrouped(campId) {
  const byGrade = {};
  for (const camper of getCampersByCamp(campId)) {
    const grade = camper.grade || '—';
    const bunk = camper.bunk || '—';
    byGrade[grade] ??= {};
    byGrade[grade][bunk] ??= [];
    byGrade[grade][bunk].push(camper);
  }

  return Object.keys(byGrade)
    .sort(collator.compare)
    .map((grade) => ({
      grade,
      bunks: Object.keys(byGrade[grade])
        .sort(collator.compare)
        .map((bunk) => ({ bunk, campers: byGrade[grade][bunk] })),
    }));
}

// Existing families in a camp, each with its linked campers, so staff can
// confirm they're attaching a sibling to the right family when two share a
// surname.
export function getFamilies(campId) {
  const byCode = {};
  for (const camper of getCampersByCamp(campId)) {
    byCode[camper.familyCode] ??= { familyCode: camper.familyCode, campers: [] };
    byCode[camper.familyCode].campers.push(camper);
  }
  return Object.values(byCode).sort((a, b) =>
    collator.compare(a.campers[0].lastName, b.campers[0].lastName)
  );
}

export function addCamper({ campId, firstName, lastName, grade, bunk, familyCode }) {
  const db = loadDb();
  const id = uid('camper');
  db.campers[id] = {
    id,
    campId,
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    grade,
    bunk,
    balance: 0,
    familyCode: familyCode ? familyCode.trim().toUpperCase() : generateFamilyCode(lastName),
  };
  saveDb(db);
  return db.campers[id];
}

// Their transactions stay behind, so the camp's history stays complete.
export function deleteCamper(camperId) {
  const db = loadDb();
  delete db.campers[camperId];
  saveDb(db);
}

/* ---- balance changes ---- */

function recordTransaction(db, tx) {
  const id = uid('tx');
  // Two changes can land in the same millisecond, so a timestamp alone can't
  // order history. seq counts up and breaks those ties.
  const seq = (db.nextSeq || 0) + 1;
  db.nextSeq = seq;

  db.transactions[id] = {
    id,
    seq,
    timestamp: Date.now(),
    items: [],
    note: '',
    voidOf: null,
    voidedBy: null,
    ...tx,
  };
  return db.transactions[id];
}

export function depositToCamper(camperId, amount, { byStaff = false, note = '' } = {}) {
  const db = loadDb();
  const camper = db.campers[camperId];
  if (!camper) throw new Error('Camper not found');

  const balanceBefore = camper.balance;
  camper.balance = round2(camper.balance + amount);

  recordTransaction(db, {
    campId: camper.campId,
    camperId,
    type: byStaff ? TX_STAFF_ADJUSTMENT : TX_PARENT_DEPOSIT,
    amount: round2(amount),
    note,
    balanceBefore,
    balanceAfter: camper.balance,
  });

  saveDb(db);
  return camper;
}

// Staff only. A balance never goes below zero, so removing more than the
// camper has just lands on $0.00 rather than going negative.
export function adjustBalanceByStaff(camperId, delta, note = '') {
  const db = loadDb();
  const camper = db.campers[camperId];
  if (!camper) throw new Error('Camper not found');

  const balanceBefore = camper.balance;
  camper.balance = round2(Math.max(0, camper.balance + delta));

  recordTransaction(db, {
    campId: camper.campId,
    camperId,
    type: TX_STAFF_ADJUSTMENT,
    amount: round2(camper.balance - balanceBefore),
    note,
    balanceBefore,
    balanceAfter: camper.balance,
  });

  saveDb(db);
  return camper;
}

export function resetBalanceToZero(camperId, note = 'Balance reset to zero') {
  const camper = getCamperById(camperId);
  if (!camper) throw new Error('Camper not found');
  return adjustBalanceByStaff(camperId, -camper.balance, note);
}

/* ---- menu items ---- */

export function getMenuItems(campId) {
  const db = loadDb();
  return Object.values(db.menuItems)
    .filter((i) => i.campId === campId)
    .sort((a, b) => collator.compare(a.name, b.name));
}

export function addMenuItem({ campId, name, price }) {
  const db = loadDb();
  const id = uid('item');
  db.menuItems[id] = { id, campId, name: name.trim(), price: round2(price) };
  saveDb(db);
  return db.menuItems[id];
}

export function updateMenuItem(itemId, { name, price }) {
  const db = loadDb();
  const item = db.menuItems[itemId];
  if (!item) throw new Error('Menu item not found');
  item.name = name.trim();
  item.price = round2(price);
  saveDb(db);
  return item;
}

// Only takes the item off the menu going forward; past purchases that
// included it are untouched.
export function deleteMenuItem(itemId) {
  const db = loadDb();
  delete db.menuItems[itemId];
  saveDb(db);
}

/* ---- checkout ---- */

// cartLines: [{ itemId, name, price, qty }]
export function checkout(camperId, cartLines) {
  const db = loadDb();
  const camper = db.campers[camperId];
  if (!camper) throw new Error('Camper not found');

  const total = round2(cartLines.reduce((sum, line) => sum + line.price * line.qty, 0));

  if (total > camper.balance) {
    return { ok: false, reason: 'insufficient_balance', total, balance: camper.balance };
  }

  const balanceBefore = camper.balance;
  camper.balance = round2(camper.balance - total);

  const transaction = recordTransaction(db, {
    campId: camper.campId,
    camperId,
    type: TX_PURCHASE,
    amount: -total,
    items: cartLines,
    balanceBefore,
    balanceAfter: camper.balance,
  });

  saveDb(db);
  return { ok: true, transaction, camper };
}

/* ---- voiding ---- */

/* Ringing up the wrong camper is the common mistake at a busy window. A void
   never deletes the original record: it writes a compensating staff
   adjustment and links the two, so history still shows both what happened and
   that it was undone. The zero floor still applies, so voiding a deposit the
   camper has already spent down only reclaims what's actually there. */
export function canVoid(tx) {
  if (!tx) return { ok: false, reason: 'Transaction not found.' };
  if (tx.voidOf) return { ok: false, reason: 'This entry is itself a void.' };
  if (tx.voidedBy) return { ok: false, reason: 'Already voided.' };
  if (!getCamperById(tx.camperId)) return { ok: false, reason: 'That camper has been removed.' };
  return { ok: true };
}

export function voidTransaction(txId, note = '') {
  const db = loadDb();
  const original = db.transactions[txId];

  const check = canVoid(original);
  if (!check.ok) return { ok: false, reason: check.reason };

  const camper = db.campers[original.camperId];
  const balanceBefore = camper.balance;
  camper.balance = round2(Math.max(0, camper.balance - original.amount));

  const reversal = recordTransaction(db, {
    campId: original.campId,
    camperId: original.camperId,
    type: TX_STAFF_ADJUSTMENT,
    amount: round2(camper.balance - balanceBefore),
    note: note || `Voided: ${describeTransaction(original)}`,
    voidOf: original.id,
    balanceBefore,
    balanceAfter: camper.balance,
  });

  original.voidedBy = reversal.id;
  saveDb(db);
  return { ok: true, reversal, camper };
}

/* ---- transaction history ---- */

function sortNewestFirst(list) {
  return list.sort((a, b) => b.timestamp - a.timestamp || b.seq - a.seq);
}

export function getTransactions(campId) {
  const db = loadDb();
  return sortNewestFirst(Object.values(db.transactions).filter((t) => t.campId === campId));
}

export function getTransactionsByCamper(camperId) {
  const db = loadDb();
  return sortNewestFirst(Object.values(db.transactions).filter((t) => t.camperId === camperId));
}

export function getTransactionsByFamilyCode(campId, familyCode) {
  const camperIds = new Set(getCampersByFamilyCode(campId, familyCode).map((c) => c.id));
  const db = loadDb();
  return sortNewestFirst(
    Object.values(db.transactions).filter((t) => t.campId === campId && camperIds.has(t.camperId))
  );
}

export function getTransactionById(txId) {
  return loadDb().transactions[txId] || null;
}

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

/* ---- daily totals ---- */

/* End-of-day reconciliation. Voids are ordinary staff adjustments in the
   ledger, but a voided sale should not still be counted as a sale, so
   purchases that were voided are excluded from the day's takings and reported
   separately instead. */
export function getDailyTotals(campId, date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const dayTx = getTransactions(campId).filter(
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
