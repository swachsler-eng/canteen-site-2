/* Signing in and out.

   ======================================================================
   WHY STAFF HAVE A HIDDEN EMAIL ADDRESS

   Firebase checks passwords on Google's servers and never hands them back,
   which is exactly what we want — no password should sit in this code where
   anyone can read it in their browser.

   But Firebase logins are built around email addresses, and we don't want
   staff typing an email. So each camp gets one invisible account:

       Camp Pinecrest  ->  pinecrest@camp.invalid

   Staff still just pick their camp from the dropdown and type the camp
   password. This file turns that into the email Firebase expects. Nobody
   ever sees or types the address, and no mail is ever sent to it — the
   ".invalid" ending is reserved precisely for addresses that aren't real.

   To add a camp you create its account in the Firebase console
   (Authentication -> Users -> Add user) using this same pattern.
   ======================================================================

   Parents sign in anonymously. Firebase hands the browser a temporary
   identity with no email or password, which is enough to let the security
   rules tell "someone using the site" apart from "a stranger poking at the
   database directly". Which campers they then see is decided by the family
   code they typed. */

import { auth } from './firebase.js';
import {
  signInWithEmailAndPassword,
  signInAnonymously,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserSessionPersistence,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';

/* Forget the login when the browser tab closes.

   The default is to stay signed in for weeks, which is wrong for a shared
   laptop at the canteen window — the next person to open the browser would
   already be signed in as staff. */
const persistenceReady = setPersistence(auth, browserSessionPersistence);

export function staffEmailFor(campId) {
  return `${campId}@camp.invalid`;
}

/* Signs staff in with their camp's password.

   Returns { ok: true } or { ok: false, reason } with a message that is safe
   to show on screen. */
export async function signInStaff(campId, password) {
  await persistenceReady;
  try {
    await signInWithEmailAndPassword(auth, staffEmailFor(campId), password);
    return { ok: true };
  } catch (error) {
    // Firebase deliberately returns the same error for a wrong password and
    // an unknown account, so an attacker can't discover which camps exist.
    if (
      error.code === 'auth/invalid-credential' ||
      error.code === 'auth/wrong-password' ||
      error.code === 'auth/user-not-found' ||
      error.code === 'auth/invalid-email'
    ) {
      return { ok: false, reason: 'That password does not match this camp.' };
    }
    if (error.code === 'auth/too-many-requests') {
      return { ok: false, reason: 'Too many attempts. Wait a minute and try again.' };
    }
    if (error.code === 'auth/network-request-failed') {
      return { ok: false, reason: "Couldn't reach the server. Check your connection." };
    }

    console.error(error);
    return { ok: false, reason: 'Could not sign in. Please try again.' };
  }
}

export async function signInParent() {
  await persistenceReady;
  try {
    await signInAnonymously(auth);
    return { ok: true };
  } catch (error) {
    if (error.code === 'auth/admin-restricted-operation') {
      // Anonymous sign-in hasn't been switched on in the Firebase console.
      return { ok: false, reason: 'Parent sign-in is not set up yet. Ask the camp office.' };
    }
    console.error(error);
    return { ok: false, reason: "Couldn't sign in. Check your connection and try again." };
  }
}

export function signOutUser() {
  return signOut(auth);
}

/* Resolves once Firebase has worked out whether someone is already signed
   in — on a page refresh that takes a moment, and asking Firestore for data
   before it finishes would be refused. */
export function waitForAuthReady() {
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, (user) => {
      stop();
      resolve(user);
    });
  });
}

export function currentUser() {
  return auth.currentUser;
}
