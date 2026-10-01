/* Connects this site to its Firebase project.

   The SDK is loaded straight from Google's CDN as an ES module, which is why
   there is still no build step or npm install needed to run the site.

   ---------------------------------------------------------------------
   IS IT OK THAT THIS IS PUBLIC?

   Yes. These values are an address, not a password — they tell the browser
   which Firebase project to talk to. Google publishes them in their own
   examples, and every Firebase website on the internet has them visible in
   its page source. There is no way to hide them, because the browser has to
   know where to connect.

   What actually protects the data is the security rules stored in the
   Firebase console. Those run on Google's servers and decide what any
   request is allowed to do, so knowing the address gets an attacker nowhere.
   --------------------------------------------------------------------- */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';

const firebaseConfig = {
  apiKey: 'AIzaSyAz-et8hae3EjcBBGRZ5_Lh5MlpMLOzp2A',
  authDomain: 'canteen-site-2.firebaseapp.com',
  projectId: 'canteen-site-2',
  storageBucket: 'canteen-site-2.firebasestorage.app',
  messagingSenderId: '66848412256',
  appId: '1:66848412256:web:c5217c3b4c04404e392905',
};

const app = initializeApp(firebaseConfig);

// Every other file gets the database and the login service from here.
export const db = getFirestore(app);
export const auth = getAuth(app);
