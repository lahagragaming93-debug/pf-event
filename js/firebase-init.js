// =====================================================================
// PROTOCOLE OMERTA - Initialisation du SDK Firebase (v10 modulaire ESM)
// ---------------------------------------------------------------------
// Centralise l'init de l'app + exporte les instances et les fonctions
// Firestore / Storage / Auth utilisees par le reste du code.
// =====================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getFirestore,
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  collection, collectionGroup, query, where, orderBy, limit,
  onSnapshot, getDocs, serverTimestamp, runTransaction,
  increment, arrayUnion, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

import {
  getAuth, signInAnonymously, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { firebaseConfig } from "./firebase-config.js";

// --- Init unique de l'app ------------------------------------------------
export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);

// --- Re-export des fonctions Firestore -----------------------------------
export {
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  collection, collectionGroup, query, where, orderBy, limit,
  onSnapshot, getDocs, serverTimestamp, runTransaction,
  increment, arrayUnion, writeBatch
};

// --- Re-export des fonctions Storage -------------------------------------
export { storageRef, uploadBytes, getDownloadURL, deleteObject };

// --- Re-export des fonctions Auth ----------------------------------------
export { signInAnonymously, onAuthStateChanged, signOut };

// =====================================================================
// Auth anonyme: garantit qu'on possede un uid avant toute lecture.
// Les regles exigent request.auth != null pour lire quoi que ce soit.
// ensureAuth() resout des qu'un utilisateur (anonyme) est dispo.
// =====================================================================
let _authReady = null;
export function ensureAuth() {
  if (_authReady) return _authReady;
  _authReady = new Promise((resolve, reject) => {
    onAuthStateChanged(auth, (user) => {
      if (user) {
        resolve(user);
      } else {
        signInAnonymously(auth).catch(reject);
      }
    }, reject);
  });
  return _authReady;
}

// Raccourci pratique
export function currentUid() {
  return auth.currentUser ? auth.currentUser.uid : null;
}
