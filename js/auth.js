// =====================================================================
// PROTOCOLE OMERTA - Authentification
// ---------------------------------------------------------------------
// - Auth Firebase ANONYME pour tout le monde (sert aux regles).
// - Login GROUPE: nom + mot de passe verifies contre Firestore.
// - Login GM: l'uid doit etre dans config/admins, puis mot de passe admin.
// =====================================================================

import {
  db, ensureAuth, currentUid,
  doc, getDoc, collection, query, where, getDocs, updateDoc, arrayUnion
} from "./firebase-init.js";
import { saveGroupSession, getGroupSession, clearGroupSession } from "./common.js";

// ---------------------------------------------------------------------
// GROUPE
// ---------------------------------------------------------------------

// Cherche un groupe par nom (insensible a la casse) et verifie le mot de passe.
export async function groupLogin(name, password) {
  await ensureAuth();
  const nameLower = (name || "").trim().toLowerCase();
  if (!nameLower) throw new Error("Nom de groupe vide.");

  const q = query(collection(db, "groups"), where("nameLower", "==", nameLower));
  const snap = await getDocs(q);
  if (snap.empty) throw new Error("Groupe introuvable.");

  let match = null;
  snap.forEach((d) => {
    const data = d.data();
    if (data.password === password) match = { id: d.id, ...data };
  });
  if (!match) throw new Error("Mot de passe incorrect.");

  // Enregistre l'uid anonyme dans le groupe (sert aux regles isMember()).
  const uid = currentUid();
  try {
    await updateDoc(doc(db, "groups", match.id), { memberUids: arrayUnion(uid) });
  } catch (e) {
    // Non bloquant: si l'ecriture echoue, la lecture marche quand meme.
    console.warn("memberUids update echoue", e);
  }

  saveGroupSession({ groupId: match.id, name: match.name });
  return match;
}

// Restaure une session existante. Renvoie {id, ...data} ou null.
export async function restoreGroupSession() {
  const sess = getGroupSession();
  if (!sess || !sess.groupId) return null;
  await ensureAuth();
  const ref = doc(db, "groups", sess.groupId);
  const snap = await getDoc(ref);
  if (!snap.exists()) { clearGroupSession(); return null; }

  // Re-affirme l'appartenance (l'uid anonyme peut avoir change de session)
  const uid = currentUid();
  const data = snap.data();
  if (!(data.memberUids || []).includes(uid)) {
    try { await updateDoc(ref, { memberUids: arrayUnion(uid) }); } catch (e) { /* non bloquant */ }
  }
  return { id: snap.id, ...data };
}

export function groupLogout() {
  clearGroupSession();
  location.reload();
}

// ---------------------------------------------------------------------
// GM / ADMIN
// ---------------------------------------------------------------------

// Renvoie l'uid anonyme courant (utile pour l'afficher a copier dans config/admins)
export async function getMyUid() {
  await ensureAuth();
  return currentUid();
}

// Verifie si l'uid courant est admin (lecture de config/admins autorisee
// seulement si deja allowliste -> on attrape l'erreur permission-denied).
export async function checkAdminAuthorized() {
  await ensureAuth();
  try {
    const snap = await getDoc(doc(db, "config", "admins"));
    if (!snap.exists()) return { authorized: false, reason: "no-doc", uid: currentUid() };
    const data = snap.data();
    const uids = data.uids || {};
    const authorized = uids[currentUid()] === true;
    return { authorized, reason: authorized ? "ok" : "not-listed", uid: currentUid(), adminData: data };
  } catch (e) {
    // permission-denied = uid pas dans la liste
    return { authorized: false, reason: "denied", uid: currentUid() };
  }
}

// Verifie le mot de passe admin (deuxieme barriere apres l'allowlist uid).
export async function adminPasswordOk(password) {
  const res = await checkAdminAuthorized();
  if (!res.authorized) return { ok: false, ...res };
  const expected = res.adminData ? res.adminData.password : null;
  // Si aucun mot de passe n'est defini cote serveur, l'allowlist uid suffit.
  if (!expected) return { ok: true, ...res };
  return { ok: password === expected, ...res };
}
