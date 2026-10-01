/* Canteen data layer.

   Every read and write in the app goes through this module.

   ======================================================================
   HOW THE DATA FLOWS

   The real data lives in Firestore (Google's database), so every device
   sees the same balances. But talking to a database over the internet
   takes time, and we don't want every screen to have to wait.

   So when someone signs in, we download their camp's data once and keep a
   copy in memory, in the `cache` object below. From then on:

     READING  is instant — it just looks in `cache`, no waiting.
     WRITING  goes to Firestore and has to be waited for (`await`).

   Firestore also pushes any change back to every connected device within
   a second or two, which is how a parent's deposit at home appears on the
   canteen laptop without anyone refreshing.
   ======================================================================

   WHERE THINGS LIVE IN THE DATABASE

     camps/{campId}/campers/{camperId}
     camps/{campId}/menuItems/{itemId}
     camps/{campId}/transactions/{txId}

   Keeping each camp's data inside its own camp document means one camp can
   never see another camp's records.
   ====================================================================== */

import { db } from './firebase.js';
import {
  collection,
  doc,
  deleteDoc,
  onSnapshot,
  runTransaction,
  setDoc,
  updateDoc,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

/* The money rules live in money.js, deliberately apart from all the
   database code, so they can be tested on their own by test-money.mjs. */
import {
  round2,
  cartTotal,
  planPurchase,
  planDeposit,
  planStaffAdjustment,
  planVoid,
  canVoidTransaction,
  describeTransaction,
  generateFamilyCode,
  sortNewestFirst,
  summariseDay,
} from './money.js';

// Re-exported so screens can keep importing these from one place.
export {
  TX_PURCHASE,
  TX_PARENT_DEPOSIT,
  TX_STAFF_ADJUSTMENT,
  describeTransaction,
} from './money.js';

/* ======================================================================
   ADD OR EDIT A CAMP HERE

   Each camp needs a unique id, a display name, and its grades with the
   bunks inside each grade. Staff pick grade and bunk from these lists when
   adding a camper, so a mistyped bunk can't create a phantom bunk.

   Nothing here is secret, which is why it's safe to keep in code.

   PASSWORDS ARE NOT HERE ON PURPOSE. They live in Firebase Auth, which
   checks them on Google's servers. To add a camp you need two steps:

     1. Add it to this list
     2. In the Firebase console, go to Authentication -> Users -> Add user
        and create  <id>@camp.invalid  with the camp's password
        (for example  pinecrest@camp.invalid)

   See js/auth.js for why that address looks the way it does.
   ====================================================================== */
const CAMP_SEED = [
  {
    id: 'pinecrest',
    name: 'Camp Pinecrest',
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
    structure: {
      '4': ['Otter', 'Heron'],
      '5': ['Loon', 'Osprey'],
      '6': ['Kingfisher', 'Sandpiper'],
    },
  },
];

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/* ---- the in-memory copy ---- */

let connectedCampId = null;
let cache = { campers: {}, menuItems: {}, transactions: {} };
let unsubscribes = [];

// Screens register here so they can redraw when another device changes data.
let onDataChanged = () => {};

export function whenDataChanges(callback) {
  onDataChanged = callback;
}

/* Downloads a camp's data and starts listening for changes.

   Returns a promise that finishes once the first copy of all three
   collections has arrived, so the app can wait before drawing a screen. */
export function connectToCamp(campId) {
  if (connectedCampId === campId) return Promise.resolve();
  disconnect();
  connectedCampId = campId;

  const collections = ['campers', 'menuItems', 'transactions'];

  return Promise.all(
    collections.map(
      (name) =>
        new Promise((resolve, reject) => {
          const ref = collection(db, 'camps', campId, name);

          // onSnapshot fires once with the current data, then again every
          // time anything in that collection changes — on any device.
          const stop = onSnapshot(
            ref,
            (snapshot) => {
              const next = {};
              snapshot.forEach((document) => {
                next[document.id] = { id: document.id, ...document.data() };
              });
              cache[name] = next;
              resolve();
              onDataChanged();
            },
            reject
          );

          unsubscribes.push(stop);
        })
    )
  ).then(() => seedIfEmpty(campId));
}

export function disconnect() {
  unsubscribes.forEach((stop) => stop());
  unsubscribes = [];
  connectedCampId = null;
  cache = { campers: {}, menuItems: {}, transactions: {} };
}

/* ======================================================================
   DEMO DATA — DELETE THIS BEFORE REAL USE

   The first time a camp is opened and has no campers or menu items, this
   fills in a few samples so the site isn't empty while you're building.
   Once you've added real campers, this never runs again. To stop it
   entirely, delete this function and the `.then(...)` that calls it above.
   ====================================================================== */
async function seedIfEmpty(campId) {
  if (Object.keys(cache.campers).length > 0 || Object.keys(cache.menuItems).length > 0) return;

  /* Only staff are allowed to write campers and menu items, so if a parent
     is the first to open an empty camp this write is refused. That's fine —
     swallow it rather than letting their sign-in fail. */
  if (!(await canWriteCampData())) return;

  const samples = {
    pinecrest: {
      campers: [
        ['Ava', 'Rivera', '5', 'Aspen', 12.5, 'RIV201'],
        ['Noah', 'Rivera', '3', 'Birch', 4, 'RIV201'],
        ['Maya', 'Goldberg', '4', 'Maple', 20, 'GOL447'],
      ],
      items: [
        ['Ice pop', 1],
        ['Chips', 1.5],
        ['Gatorade', 2.25],
        ['Soft pretzel', 2],
      ],
    },
    lakeside: {
      campers: [['Eli', 'Tanaka', '6', 'Kingfisher', 8.75, 'TAN318']],
      items: [
        ['Water bottle', 1],
        ['Candy bar', 1.75],
      ],
    },
  };

  const sample = samples[campId];
  if (!sample) return;

  const batch = writeBatch(db);

  sample.campers.forEach(([firstName, lastName, grade, bunk, balance, familyCode]) => {
    batch.set(doc(collection(db, 'camps', campId, 'campers')), {
      firstName,
      lastName,
      grade,
      bunk,
      balance,
      familyCode,
    });
  });

  sample.items.forEach(([name, price]) => {
    batch.set(doc(collection(db, 'camps', campId, 'menuItems')), { name, price });
  });

  // A refused write here is harmless, so don't let it break signing in.
  await batch.commit().catch(() => {});
}

/* Staff are signed in as <campId>@camp.invalid; parents are anonymous. */
async function canWriteCampData() {
  const { currentUser } = await import('./auth.js');
  return Boolean(currentUser()?.email);
}

/* ---- small helpers ---- */

/* Two balance changes can land in the same millisecond, so a timestamp
   alone can't order history. This counts up to break those ties.

   It's worked out from the transactions already loaded. Two devices writing
   in the very same millisecond could pick the same number, but their
   timestamps would then order them anyway — and "which came first" between
   two simultaneous writes is genuinely ambiguous regardless. */
function nextSeq() {
  const seqs = Object.values(cache.transactions).map((tx) => tx.seq || 0);
  return (seqs.length ? Math.max(...seqs) : 0) + 1;
}

function campPath(name) {
  return collection(db, 'camps', connectedCampId, name);
}

/* ---- camps (still from the list at the top of this file) ---- */

/* Camps appear in the login dropdown in the order they're listed in
   CAMP_SEED above, so the FIRST one in that list is what the dropdown
   starts on. To change which camp is selected by default, move it to the
   top of CAMP_SEED. */
export function getAllCamps() {
  return [...CAMP_SEED];
}

export function getCampById(campId) {
  return CAMP_SEED.find((c) => c.id === campId) || null;
}

export function getGrades(campId) {
  const camp = getCampById(campId);
  return Object.keys(camp?.structure ?? {}).sort(collator.compare);
}

export function getBunksForGrade(campId, grade) {
  const camp = getCampById(campId);
  return [...(camp?.structure?.[grade] ?? [])].sort(collator.compare);
}

/* ---- campers (reading: instant, from the cache) ---- */

export function getCampersByCamp() {
  return Object.values(cache.campers).sort((a, b) =>
    collator.compare(`${a.lastName} ${a.firstName}`, `${b.lastName} ${b.firstName}`)
  );
}

export function getCamperById(camperId) {
  return cache.campers[camperId] || null;
}

export function getCampersByFamilyCode(campId, familyCode) {
  const code = familyCode.trim().toUpperCase();
  return getCampersByCamp().filter((c) => c.familyCode === code);
}

// grade -> bunk -> campers, for browsing without knowing a name.
export function getCampersGrouped() {
  const byGrade = {};
  for (const camper of getCampersByCamp()) {
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

// Existing families, each with its campers, so staff can confirm they're
// attaching a sibling to the right family when two share a surname.
export function getFamilies() {
  const byCode = {};
  for (const camper of getCampersByCamp()) {
    byCode[camper.familyCode] ??= { familyCode: camper.familyCode, campers: [] };
    byCode[camper.familyCode].campers.push(camper);
  }
  return Object.values(byCode).sort((a, b) =>
    collator.compare(a.campers[0].lastName, b.campers[0].lastName)
  );
}

/* ---- campers (writing: has to wait for the database) ---- */

export async function addCamper({ firstName, lastName, grade, bunk, familyCode }) {
  const camper = {
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    grade,
    bunk,
    balance: 0,
    familyCode: familyCode ? familyCode.trim().toUpperCase() : generateFamilyCode(lastName),
  };

  const ref = doc(campPath('campers'));
  await setDoc(ref, camper);
  return { id: ref.id, ...camper };
}

// Their transactions stay behind, so the camp's history stays complete.
export async function deleteCamper(camperId) {
  await deleteDoc(doc(db, 'camps', connectedCampId, 'campers', camperId));
}

/* ======================================================================
   BALANCE CHANGES

   Every one of these runs inside a Firestore "transaction". That word
   means something different here than a canteen transaction: it tells the
   database to re-read the balance and write the new one as a single
   indivisible step.

   This matters now that more than one device can be used at once. Without
   it, a sale and a parent deposit landing at the same moment could each
   read a balance of $10, each do their own sum, and the second write would
   silently wipe out the first. Firestore detects that and retries instead.
   ====================================================================== */

/* Shared by every balance change.

   `compute` is handed the camper's real current balance and returns either
   a description of the change, or null to refuse it. */
async function changeBalance(camperId, compute) {
  const camperRef = doc(db, 'camps', connectedCampId, 'campers', camperId);
  const txRef = doc(campPath('transactions'));
  const seq = nextSeq();

  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(camperRef);
    if (!snapshot.exists()) throw new Error('Camper not found');

    const camper = { id: camperId, ...snapshot.data() };
    const change = compute(camper);
    if (!change) return { ok: false, camper };

    const balanceBefore = camper.balance;
    const balanceAfter = round2(change.balanceAfter);

    transaction.update(camperRef, { balance: balanceAfter });
    transaction.set(txRef, {
      camperId,
      type: change.type,
      amount: round2(balanceAfter - balanceBefore),
      items: change.items || [],
      note: change.note || '',
      voidOf: change.voidOf || null,
      voidedBy: null,
      balanceBefore,
      balanceAfter,
      seq,
      timestamp: Date.now(),
    });

    if (change.voidOf) {
      transaction.update(doc(db, 'camps', connectedCampId, 'transactions', change.voidOf), {
        voidedBy: txRef.id,
      });
    }

    return {
      ok: true,
      transactionId: txRef.id,
      camper: { ...camper, balance: balanceAfter },
    };
  });
}

export async function depositToCamper(camperId, amount, options = {}) {
  const result = await changeBalance(camperId, (camper) =>
    planDeposit(camper.balance, amount, options)
  );
  return result.camper;
}

export async function adjustBalanceByStaff(camperId, delta, note = '') {
  const result = await changeBalance(camperId, (camper) =>
    planStaffAdjustment(camper.balance, delta, note)
  );
  return result.camper;
}

export async function resetBalanceToZero(camperId, note = 'Balance reset to zero') {
  const result = await changeBalance(camperId, (camper) =>
    planStaffAdjustment(camper.balance, -camper.balance, note)
  );
  return result.camper;
}

/* ---- menu items ---- */

export function getMenuItems() {
  return Object.values(cache.menuItems).sort((a, b) => collator.compare(a.name, b.name));
}

export async function addMenuItem({ name, price }) {
  const item = { name: name.trim(), price: round2(price) };
  const ref = doc(campPath('menuItems'));
  await setDoc(ref, item);
  return { id: ref.id, ...item };
}

export async function updateMenuItem(itemId, { name, price }) {
  await updateDoc(doc(db, 'camps', connectedCampId, 'menuItems', itemId), {
    name: name.trim(),
    price: round2(price),
  });
}

// Only takes the item off the menu going forward; past purchases that
// included it are untouched.
export async function deleteMenuItem(itemId) {
  await deleteDoc(doc(db, 'camps', connectedCampId, 'menuItems', itemId));
}

/* ---- checkout ---- */

// cartLines: [{ itemId, name, price, qty }]
export async function checkout(camperId, cartLines) {
  // planPurchase is checked against the balance the database really holds,
  // not the copy this screen was showing, so a stale page can't overdraw.
  const result = await changeBalance(camperId, (camper) =>
    planPurchase(camper.balance, cartLines)
  );

  if (!result.ok) {
    return {
      ok: false,
      reason: 'insufficient_balance',
      total: cartTotal(cartLines),
      balance: result.camper.balance,
    };
  }
  return { ok: true, transactionId: result.transactionId, camper: result.camper };
}

/* ---- voiding ---- */

/* A void never deletes the original. It writes a compensating staff
   adjustment and links the two, so history shows both what happened and
   that it was undone. The zero floor still applies, so voiding a deposit
   the camper has already spent only reclaims what's actually there. */
export function canVoid(tx) {
  return canVoidTransaction(tx, tx ? Boolean(getCamperById(tx.camperId)) : false);
}

export async function voidTransaction(txId, note = '') {
  const original = getTransactionById(txId);

  const check = canVoid(original);
  if (!check.ok) return { ok: false, reason: check.reason };

  const result = await changeBalance(original.camperId, (camper) => ({
    ...planVoid(
      camper.balance,
      original.amount,
      note || `Voided: ${describeTransaction(original)}`
    ),
    voidOf: original.id,
  }));

  return { ok: true, camper: result.camper };
}

/* ---- transaction history (reading: instant) ---- */

export function getTransactions() {
  return sortNewestFirst(Object.values(cache.transactions));
}

export function getTransactionsByCamper(camperId) {
  return sortNewestFirst(Object.values(cache.transactions).filter((t) => t.camperId === camperId));
}

export function getTransactionsByFamilyCode(campId, familyCode) {
  const camperIds = new Set(getCampersByFamilyCode(campId, familyCode).map((c) => c.id));
  return sortNewestFirst(Object.values(cache.transactions).filter((t) => camperIds.has(t.camperId)));
}

export function getTransactionById(txId) {
  return cache.transactions[txId] || null;
}

/* ---- daily totals ---- */

export function getDailyTotals(campId, date = new Date()) {
  return summariseDay(getTransactions(), date);
}
