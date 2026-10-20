import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";

/** Firebase proje kimliği ve fonksiyon bölgesi — sabit adresler buradan türetilir. */
export const PROJECT_ID = "bonair-academy";
export const REGION = "europe-west3";
/** Cloud Functions'ın HTTP taban adresi (onRequest uçları için). */
export const FUNCTIONS_BASE = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net`;

// bonair-academy — web app config (apiKey public'tir; güvenliği Security Rules sağlar)
const firebaseConfig = {
  apiKey: "AIzaSyBiHMUHzANcrxRxIJ5nxC6rSZNAdBrRb9U",
  authDomain: `${PROJECT_ID}.firebaseapp.com`,
  projectId: PROJECT_ID,
  storageBucket: `${PROJECT_ID}.firebasestorage.app`,
  messagingSenderId: "920255064608",
  appId: "1:920255064608:web:c80013e9a9dc823eb9ea45",
  measurementId: "G-FBVMC7C3ED",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, REGION);
