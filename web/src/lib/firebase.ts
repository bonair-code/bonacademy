import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";

/** Firebase proje kimliği ve fonksiyon bölgesi — sabit adresler buradan türetilir. */
export const PROJECT_ID = "capella-academy-v2";
export const REGION = "europe-west3";
/** Cloud Functions'ın HTTP taban adresi (onRequest uçları için). */
export const FUNCTIONS_BASE = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net`;

// capella-academy-v2 — web app config (apiKey public'tir; güvenliği Security Rules sağlar)
const firebaseConfig = {
  apiKey: "AIzaSyBOclFxMkKSChGIriZR2VX9W2ppPCp40vA",
  authDomain: `${PROJECT_ID}.firebaseapp.com`,
  projectId: PROJECT_ID,
  storageBucket: `${PROJECT_ID}.firebasestorage.app`,
  messagingSenderId: "495818254874",
  appId: "1:495818254874:web:6d5ee3bd1990d1e85cbfa3",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, REGION);
