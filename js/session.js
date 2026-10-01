/* Who is currently signed in.

   Kept in sessionStorage, which means it survives a page refresh but is
   cleared when the browser tab closes — that's what you want for a shared
   staff computer at the canteen window.

   A session looks like one of these:
     { role: 'staff',  campId: 'pinecrest' }
     { role: 'parent', campId: 'pinecrest', familyCode: 'RIV201' } */

const SESSION_KEY = 'canteen_session';

export function getSession() {
  const raw = sessionStorage.getItem(SESSION_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function startStaffSession(campId) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ role: 'staff', campId }));
}

export function startParentSession(campId, familyCode) {
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ role: 'parent', campId, familyCode: familyCode.trim().toUpperCase() })
  );
}

export function endSession() {
  sessionStorage.removeItem(SESSION_KEY);
}
