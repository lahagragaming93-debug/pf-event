// =====================================================================
// PROTOCOLE OMERTA - Catalogue d'objectifs + seed initial
// ---------------------------------------------------------------------
// Donnees par defaut chargees via le bouton "Initialiser les objectifs"
// du cockpit GM. Les ids sont deterministes -> re-seed = idempotent
// (ecrase la valeur cible/points mais ne cree pas de doublons).
// =====================================================================

import {
  db, doc, setDoc, collection, getDocs, serverTimestamp
} from "./firebase-init.js";
import { OBJ_TYPE } from "./common.js";

// --- MANCHE 1 : objets a ramener (type count) ----------------------------
export const SEED_M1 = [
  { id: "m1_disqueuses",       label: "Disqueuses",                 targetQty: 10 },
  { id: "m1_kits_cambriolage", label: "Kits de cambriolage",        targetQty: 10 },
  { id: "m1_tableaux",         label: "Tableaux",                   targetQty: 10 },
  { id: "m1_saphirs",          label: "Saphirs",                    targetQty: 10 },
  { id: "m1_emeraudes",        label: "Emeraudes",                  targetQty: 5  },
  { id: "m1_diamants",         label: "Diamants",                   targetQty: 3  },
  { id: "m1_cigarettes",       label: "Paquets de cigarettes",      targetQty: 200 },
  { id: "m1_acier",            label: "Aciers",                     targetQty: 50 },
  { id: "m1_acier_renforce",   label: "Aciers renforces",           targetQty: 20 },
  { id: "m1_charbon",          label: "Charbons",                   targetQty: 50 },
  { id: "m1_cuivre",           label: "Cuivres",                    targetQty: 50 }
];

// --- MANCHE 2 : objectifs photo (type photo, a points) -------------------
export const SEED_M2 = [
  { id: "m2_leader_rival",  label: "Leader d'un groupe rival pris en photo", points: 100, repeatable: true },
  { id: "m2_membre_rival",  label: "Autre membre d'un groupe rival pris en photo", points: 20, repeatable: true },
  { id: "m2_membre_police", label: "Un de vos membres dans un vehicule de police", points: 150, repeatable: false },
  { id: "m2_tag_poste",     label: "Tag du poste de police pris en photo", points: 150, repeatable: false },
  { id: "m2_braquage_fleeca", label: "En train de braquer une banque Fleeca", points: 250, repeatable: false }
];

// --- CHASSES d'exemple (collection chasses, statut idle au depart) -------
// Le GM les ouvre manuellement au bon moment.
export const SEED_CHASSES = [
  { id: "chasse_j2_2122", label: "Chasse Jour 2 - 21h a 22h", points: 100, windowMinutes: 60, manche: 2 },
  { id: "chasse_j2_2223", label: "Chasse Jour 2 - 22h a 23h", points: 100, windowMinutes: 60, manche: 2 },
  { id: "chasse_j2_2300", label: "Chasse Jour 2 - 23h a 00h", points: 100, windowMinutes: 60, manche: 2 }
];

// =====================================================================
// Ecriture du seed
// =====================================================================
export async function seedObjectives() {
  let count = 0;
  let order = 0;
  for (const o of SEED_M1) {
    await setDoc(doc(db, "objectives", o.id), {
      manche: 1,
      type: OBJ_TYPE.COUNT,
      label: o.label,
      targetQty: o.targetQty,
      points: null,
      repeatable: false,
      order: order++,
      createdAt: serverTimestamp()
    }, { merge: true });
    count++;
  }
  order = 0;
  for (const o of SEED_M2) {
    await setDoc(doc(db, "objectives", o.id), {
      manche: 2,
      type: OBJ_TYPE.PHOTO,
      label: o.label,
      targetQty: null,
      points: o.points,
      repeatable: !!o.repeatable,
      order: order++,
      createdAt: serverTimestamp()
    }, { merge: true });
    count++;
  }
  return count;
}

export async function seedChasses() {
  let count = 0;
  let order = 0;
  for (const c of SEED_CHASSES) {
    await setDoc(doc(db, "chasses", c.id), {
      label: c.label,
      photoUrl: "",
      storagePath: "",
      points: c.points,
      windowMinutes: c.windowMinutes,
      manche: c.manche,
      status: "idle",
      openedAt: null,
      closesAt: null,
      order: order++,
      createdAt: serverTimestamp()
    }, { merge: true });
    count++;
  }
  return count;
}

// Indique si des objectifs existent deja (pour l'UI du bouton seed)
export async function objectivesExist() {
  const snap = await getDocs(collection(db, "objectives"));
  return !snap.empty;
}
