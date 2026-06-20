// =====================================================================
// PROTOCOLE OMERTA - Banque de questions (Epreuve 2, Manche 3)
// ---------------------------------------------------------------------
// Reponse LIBRE (les groupes repondent de tete). Le GM juge la justesse
// en comparant a la reponse de reference, puis credite +1 aux corrects.
// Stockee dans la collection `questions` (GM ONLY: jamais lisible par les
// groupes -> ils ne voient que la question diffusee, pas la reponse).
// =====================================================================

import { db, doc, setDoc, collection, getDocs, serverTimestamp } from "./firebase-init.js";

export const SEED_QUESTIONS = [
  { t: "Quel est le code du silence de la mafia ?", a: "Omerta" },
  { t: "Cosa Nostra est originaire de quelle region italienne ?", a: "La Sicile" },
  { t: "Quel parrain americain est tombe pour fraude fiscale en 1931 ?", a: "Al Capone" },
  { t: "Dans la mafia, le 'consigliere' est le quoi du parrain ?", a: "Le conseiller" },
  { t: "La Yakuza est la mafia de quel pays ?", a: "Le Japon" },
  { t: "Quel cartel mexicain etait dirige par 'El Chapo' ?", a: "Sinaloa" },
  { t: "Blanchir de l'argent, c'est lui donner une origine quoi ?", a: "Legale" },
  { t: "Albert Spaggiari est connu pour le casse de la Societe Generale de quelle ville ?", a: "Nice" },
  { t: "Comment appelle-t-on un informateur de la police dans le milieu ?", a: "Un indic / une balance" },
  { t: "Pablo Escobar dirigeait le cartel de quelle ville ?", a: "Medellin" },
  { t: "Comment s'appelle la mafia napolitaine ?", a: "La Camorra" },
  { t: "Comment s'appelle la mafia calabraise ?", a: "La Ndrangheta" },
  { t: "Quel film de 1972 de Coppola raconte une famille mafieuse ?", a: "Le Parrain" },
  { t: "Quelle ville americaine est le fief d'Al Capone ?", a: "Chicago" },
  { t: "Dans quelle ville se deroule le film 'Scarface' (1983) ?", a: "Miami" },
  { t: "Le racket consiste a extorquer de l'argent contre une fausse quoi ?", a: "Protection" },
  { t: "Quel mafioso americain est surnomme 'Lucky' ?", a: "Luciano" },
  { t: "La celebre prison sur une ile, dans la baie de San Francisco ?", a: "Alcatraz" },
  { t: "Combien de grandes familles mafieuses regnent sur New York ?", a: "Cinq (5)" },
  { t: "Quelle serie italienne raconte la Camorra napolitaine ?", a: "Gomorra" },
  { t: "Le 'pizzo' en Sicile designe l'argent de quoi ?", a: "Du racket" },
  { t: "Quelle drogue a fait la fortune des cartels colombiens ?", a: "La cocaine" },
  { t: "Le trafic 'French Connection' exportait quelle drogue depuis Marseille ?", a: "L'heroine" },
  { t: "Jacques Mesrine etait surnomme l'ennemi public numero combien ?", a: "Numero 1" },
  { t: "Quel realisateur a fait 'Les Affranchis' (Goodfellas) ?", a: "Martin Scorsese" },
  { t: "Comment s'appelle la mafia chinoise ?", a: "Les Triades" },
  { t: "Quelle famille donne son nom a la serie 'Les Soprano' ?", a: "Soprano" },
  { t: "El Chapo s'est evade de prison en 2015 par quel moyen ?", a: "Un tunnel" },
  { t: "John Gotti etait surnomme le 'Teflon' quoi ?", a: "Don" },
  { t: "Quel surnom porte un membre arme charge des executions ?", a: "Un homme de main / tueur" },
  { t: "La 'vendetta' designe quoi entre clans ?", a: "La vengeance" },
  { t: "Quel pays est la plaque tournante historique de la mafia russe ?", a: "La Russie" },
  { t: "Comment appelle-t-on un repenti qui collabore avec la justice en Italie ?", a: "Un pentito" },
  { t: "Quelle ville colombienne donne son nom au cartel rival de Medellin ?", a: "Cali" },
  { t: "Le sigle 'CJNG' designe un cartel base dans quel etat mexicain ?", a: "Jalisco" }
];

export async function seedQuestions() {
  let i = 0;
  for (const q of SEED_QUESTIONS) {
    i++;
    await setDoc(doc(db, "questions", "q" + String(i).padStart(2, "0")), {
      text: q.t, answer: q.a, order: i, createdAt: serverTimestamp()
    }, { merge: true });
  }
  return i;
}

export async function questionsExist() {
  const snap = await getDocs(collection(db, "questions"));
  return !snap.empty;
}
