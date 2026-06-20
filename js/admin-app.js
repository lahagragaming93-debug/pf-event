// =====================================================================
// PROTOCOLE OMERTA - Application COCKPIT GM (admin)
// =====================================================================

import {
  db, storage, ensureAuth,
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  collection, query, where, orderBy, onSnapshot, getDocs,
  serverTimestamp, runTransaction, increment,
  storageRef, uploadBytes, getDownloadURL, deleteObject
} from "./firebase-init.js";

import { checkAdminAuthorized, adminPasswordOk, getMyUid } from "./auth.js";
import { seedObjectives, seedChasses } from "./objectives.js";
import { seedQuestions } from "./questions.js";

import {
  EVENT_NAME, STATUS, STATUS_LABEL, EVENT_STATUS, SUB_STATUS, SUB_STATUS_LABEL, OBJ_TYPE,
  DEFAULT_EVENT, escapeHtml, formatHud, remainingMs, fmtDateTime, tsToMs,
  generatePassword, toast, modalConfirm, modalPrompt, wirePasteZone,
  saveAdminSession, getAdminSession, clearAdminSession
} from "./common.js";

// --- Etat ----------------------------------------------------------------
let eventCfg = null;
let allGroups = [];
let groupsMap = {};
let allObjectives = [];
let allChasses = [];

let selectedGroupId = null;
let renderedGroupId = null;
let currentMode = "group";

const groupCache = {};   // gid -> { submissions:[], messages:[], pending:n, unread:n }
const badgeUnsubs = {};  // gid -> [unsub...]

let chasseBlob = null;   // image en attente pour creation de chasse
let cgIdBlob = null;     // image carte d'identite en attente (creation groupe)

// Quiz (Epreuve 2)
let quizCfg = null;
let allQuestions = [];
let quizRoundAnswers = {};   // gid -> { text, answeredAt, credited }
let unsubQuizRound = null;
let lastRoundQid = null;

// Regles par defaut (editables depuis le cockpit, vues par les groupes)
const DEFAULT_RULES = `PROTOCOLE OMERTA // REGLES DU JEU

Bienvenue dans le reseau. 12 cellules entrent, une seule logique : survivre et marquer.

MANCHE 1 - LIVRAISONS (24h)
Ramenez en jeu la liste d'objets demandee. Le Game Master enregistre vos livraisons.
Les 8 premieres cellules a tout livrer sont QUALIFIEES.
Des que 8 cellules ont tout livre, les autres sont eliminees (ecran OUT, acces verrouille).

MANCHE 2 - INFILTRATION (48h)
Marquez un maximum de points via les objectifs photo et les chasses.
- Objectifs UNIQUES : valables une seule fois (ex : braquage Fleeca, tag du poste, vehicule de police).
- Objectifs CUMULABLES : repetables, chaque preuve differente rapporte (leader / membre rival).
- CHASSES : fenetres chronometrees. Rendez-vous sur le lieu indique, faites une photo avec la personne sur place, et transmettez la AVANT la fin de la fenetre. Apres fermeture, plus aucun point.
A la cloture, le TOP 4 accede a la finale, le reste est OUT.

MANCHE 3 - FINALE
Les 4 cellules restantes s'affrontent. Les 3 premieres remportent les lots, la 4e est eliminee.

PREUVES
Capture d'ecran a coller (Ctrl+V) ou fichier. Le GM valide ou refuse. Les points sont attribues par le GM uniquement.

FAIR-PLAY
Pas de triche. En cas de litige, la decision du Game Master est finale. Tout contact passe par le chat GM.`;

// =====================================================================
// BOOT + barriere admin
// =====================================================================
(async function boot() {
  await ensureAuth();
  const res = await checkAdminAuthorized();
  const body = document.getElementById("admin-login-body");

  if (!res.authorized) {
    const uid = res.uid || (await getMyUid());
    body.innerHTML = `
      <div class="auth-error">Habilitation refusee.</div>
      <p class="dim tiny" style="text-align:center;margin:0.8rem 0">
        Votre identifiant d'acces (uid) doit etre ajoute dans <b class="term">config/admins</b>.
      </p>
      <div class="dim tiny up">Votre uid</div>
      <div class="uid-box" id="uid-box">${escapeHtml(uid)}</div>
      <button class="btn ghost block" id="copy-uid">Copier l'uid</button>
      <button class="btn ghost block" id="recheck" style="margin-top:0.5rem">Reverifier</button>
      <p class="dim tiny" style="margin-top:0.9rem">
        Console Firebase > Firestore > doc <b>config/admins</b> :<br>
        <span class="term">{ uids: { "${escapeHtml(uid)}": true }, password: "votre-mdp" }</span>
      </p>`;
    document.getElementById("copy-uid").addEventListener("click", () => {
      navigator.clipboard.writeText(uid).then(() => toast("uid copie.", "success"));
    });
    document.getElementById("recheck").addEventListener("click", () => location.reload());
    return;
  }

  // Autorise. Si deja deverrouille sur ce navigateur -> entree directe (session permanente).
  if (getAdminSession() && getAdminSession().unlocked) {
    startCockpit();
    return;
  }

  // Sinon, demande le mot de passe admin une fois (2e barriere).
  body.innerHTML = `
    <form id="admin-pass-form" autocomplete="off">
      <label class="field"><span>Mot de passe Game Master</span>
        <input type="password" id="admin-pass" autocomplete="off" /></label>
      <button class="btn primary block" type="submit">Acceder au cockpit</button>
      <div class="auth-error" id="admin-pass-error"></div>
    </form>`;
  document.getElementById("admin-pass-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pass = document.getElementById("admin-pass").value;
    const r = await adminPasswordOk(pass);
    if (r.ok) { saveAdminSession({ unlocked: true }); startCockpit(); }
    else document.getElementById("admin-pass-error").textContent = "Mot de passe incorrect.";
  });
})();

// =====================================================================
// Demarrage cockpit
// =====================================================================
async function startCockpit() {
  document.getElementById("admin-login").style.display = "none";
  document.getElementById("cockpit").style.display = "flex";

  // Cree config/event si absent
  const evRef = doc(db, "config", "event");
  const evSnap = await getDoc(evRef);
  if (!evSnap.exists()) {
    await setDoc(evRef, DEFAULT_EVENT);
  }
  // Cree config/rules si absent
  const rulesRef = doc(db, "config", "rules");
  const rulesSnap = await getDoc(rulesRef);
  if (!rulesSnap.exists()) {
    await setDoc(rulesRef, { text: DEFAULT_RULES, updatedAt: serverTimestamp() });
  }
  // Cree config/quiz si absent (etat du quiz live)
  const quizRef = doc(db, "config", "quiz");
  const quizSnap = await getDoc(quizRef);
  if (!quizSnap.exists()) {
    await setDoc(quizRef, { status: "idle", qid: null, text: "", openedAt: null, durationSec: 5, number: 0 });
  }

  wireGlobalHandlers();
  wireEventBar();
  wireModes();
  wireBroadcast();

  // Listeners
  onSnapshot(evRef, (s) => { eventCfg = s.exists() ? s.data() : null; onEventChange(); });
  onSnapshot(collection(db, "groups"), (s) => {
    allGroups = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    groupsMap = {}; allGroups.forEach((g) => groupsMap[g.id] = g);
    syncBadgeListeners();
    onGroupsChange();
  });
  onSnapshot(collection(db, "objectives"), (s) => {
    allObjectives = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 0) - (b.order || 0));
    onObjectivesChange();
  });
  onSnapshot(collection(db, "chasses"), (s) => {
    allChasses = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 0) - (b.order || 0));
    onChassesChange();
  });
  // Quiz: etat live + banque de questions
  onSnapshot(doc(db, "config", "quiz"), (s) => {
    quizCfg = s.exists() ? s.data() : null;
    syncQuizRoundListener();
    if (currentMode === "quiz") renderQuizAdmin();
  });
  onSnapshot(collection(db, "questions"), (s) => {
    allQuestions = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 0) - (b.order || 0));
    if (currentMode === "quiz") renderQuizAdmin();
  });

  startCountdown();
  document.getElementById("gm-logout").addEventListener("click", () => { clearAdminSession(); location.reload(); });
}

// =====================================================================
// Listeners de badges par groupe (preuves en attente + messages non lus)
// =====================================================================
function syncBadgeListeners() {
  const ids = new Set(allGroups.map((g) => g.id));
  // Retire ceux qui n'existent plus
  Object.keys(badgeUnsubs).forEach((gid) => {
    if (!ids.has(gid)) {
      (badgeUnsubs[gid] || []).forEach((u) => u());
      delete badgeUnsubs[gid]; delete groupCache[gid];
    }
  });
  // Ajoute les nouveaux
  allGroups.forEach((g) => {
    if (badgeUnsubs[g.id]) return;
    groupCache[g.id] = { submissions: [], messages: [], pending: 0, unread: 0 };
    const u1 = onSnapshot(
      query(collection(db, "groups", g.id, "submissions"), orderBy("submittedAt", "desc")),
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        groupCache[g.id].submissions = arr;
        groupCache[g.id].pending = arr.filter((x) => x.status === SUB_STATUS.PENDING).length;
        renderSidebar();
        if (selectedGroupId === g.id) updateGroupSubs(g.id);
      }
    );
    const u2 = onSnapshot(
      query(collection(db, "groups", g.id, "messages"), orderBy("createdAt", "asc")),
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        groupCache[g.id].messages = arr;
        recomputeUnread(g.id);
        renderSidebar();
        if (selectedGroupId === g.id) updateGroupChat(g.id);
      }
    );
    badgeUnsubs[g.id] = [u1, u2];
  });
}

function recomputeUnread(gid) {
  const g = groupsMap[gid];
  const lastRead = (g && g.lastReadByGm) ? tsToMs(g.lastReadByGm) || 0 : 0;
  const msgs = groupCache[gid] ? groupCache[gid].messages : [];
  groupCache[gid].unread = msgs.filter((m) => m.sender === "group" && (tsToMs(m.createdAt) || 0) > lastRead).length;
}

// =====================================================================
// Barre de controle event
// =====================================================================
function wireEventBar() {
  document.querySelectorAll("#manche-pick button").forEach((b) => {
    b.addEventListener("click", () => setManche(parseInt(b.dataset.m, 10)));
  });
  document.getElementById("btn-start").addEventListener("click", startManche);
  document.getElementById("btn-pause").addEventListener("click", pauseResume);
  document.getElementById("btn-end").addEventListener("click", endManche);
  document.getElementById("btn-close").addEventListener("click", closeManche);
}

async function setManche(m) {
  if (eventCfg && eventCfg.status === EVENT_STATUS.RUNNING) {
    const ok = await modalConfirm("Changer de manche",
      "Une manche est en cours. Changer de manche va remettre le chrono a zero (statut: en attente). Continuer ?", { danger: true });
    if (!ok) return;
  }
  const dur = (DEFAULT_EVENT.durationHoursByManche[m]) || 24;
  await updateDoc(doc(db, "config", "event"), {
    currentManche: m, status: EVENT_STATUS.IDLE, endsAt: null, startedAt: null, remainingMsAtPause: null, durationHours: null
  });
  document.getElementById("duration-input").value = dur;
}

async function startManche() {
  const m = eventCfg ? eventCfg.currentManche : 1;
  const hours = parseFloat(document.getElementById("duration-input").value) || DEFAULT_EVENT.durationHoursByManche[m] || 24;
  const now = Date.now();
  await updateDoc(doc(db, "config", "event"), {
    status: EVENT_STATUS.RUNNING, startedAt: now, endsAt: now + hours * 3600000,
    durationHours: hours, remainingMsAtPause: null
  });
  toast(`Manche ${m} lancee (${hours}h).`, "success");
}

async function pauseResume() {
  if (!eventCfg) return;
  const now = Date.now();
  if (eventCfg.status === EVENT_STATUS.RUNNING) {
    const rem = Math.max(0, (eventCfg.endsAt || now) - now);
    await updateDoc(doc(db, "config", "event"), { status: EVENT_STATUS.PAUSED, remainingMsAtPause: rem });
    toast("Manche en pause.");
  } else if (eventCfg.status === EVENT_STATUS.PAUSED) {
    const rem = eventCfg.remainingMsAtPause || 0;
    await updateDoc(doc(db, "config", "event"), { status: EVENT_STATUS.RUNNING, endsAt: now + rem, remainingMsAtPause: null });
    toast("Manche reprise.", "success");
  }
}

async function endManche() {
  const ok = await modalConfirm("Terminer la manche", "Le chrono est arrete (statut: terminee). Tu peux ensuite cloturer pour qualifier/eliminer.", {});
  if (!ok) return;
  await updateDoc(doc(db, "config", "event"), { status: EVENT_STATUS.FINISHED });
}

async function closeManche() {
  const m = eventCfg ? eventCfg.currentManche : 1;
  const cut = (eventCfg.qualifyCount && eventCfg.qualifyCount[m]) || (m === 1 ? 8 : m === 2 ? 4 : 3);

  if (m === 1) {
    const ok = await modalConfirm("Cloturer la Manche 1",
      "Les groupes ayant COMPLETE sont qualifies, tous les autres encore en course passent OUT. Continuer ?", { danger: true, okLabel: "Cloturer M1" });
    if (!ok) return;
    for (const g of allGroups) {
      if (g.status === STATUS.COMPLETED) await updateDoc(doc(db, "groups", g.id), { status: STATUS.QUALIFIED });
      else if (g.status === STATUS.ACTIVE) await updateDoc(doc(db, "groups", g.id), { status: STATUS.OUT, eliminatedAt: serverTimestamp() });
    }
  } else {
    const label = m === 2 ? `Top ${cut} qualifie, le reste OUT.` : `Top 3 qualifie (les gagnants), le 4e OUT.`;
    const ok = await modalConfirm(`Cloturer la Manche ${m}`,
      `Classement par points. ${label} Continuer ?`, { danger: true, okLabel: "Cloturer" });
    if (!ok) return;
    const active = allGroups.filter((g) => g.status !== STATUS.OUT)
      .sort((a, b) => ((b.points?.[m] || 0) - (a.points?.[m] || 0)));
    const keep = m === 2 ? cut : 3;
    for (let i = 0; i < active.length; i++) {
      const g = active[i];
      if (i < keep) await updateDoc(doc(db, "groups", g.id), { status: STATUS.QUALIFIED });
      else await updateDoc(doc(db, "groups", g.id), { status: STATUS.OUT, eliminatedAt: serverTimestamp() });
    }
  }
  await updateDoc(doc(db, "config", "event"), { status: EVENT_STATUS.FINISHED });
  toast(`Manche ${m} cloturee.`, "success");
}

// =====================================================================
// Reactions aux changements de donnees
// =====================================================================
function onEventChange() {
  updateEventBarUI();
  if (currentMode === "group") renderModeGroup();
  if (currentMode === "objectives") renderObjectivesAdmin();
  if (currentMode === "chasses") renderChassesAdmin();
  if (currentMode === "classement") renderClassementAdmin();
  reconcileManche1();
}
function onGroupsChange() {
  renderSidebar();
  document.getElementById("groups-count").textContent = allGroups.length;
  if (currentMode === "group") renderModeGroup();
  if (currentMode === "classement") renderClassementAdmin();
  if (currentMode === "out") renderOutAdmin();
  reconcileManche1();
}
function onObjectivesChange() {
  if (currentMode === "objectives") renderObjectivesAdmin();
  if (currentMode === "group" && selectedGroupId) { updateGroupQty(selectedGroupId); updateGroupSubs(selectedGroupId); }
  // Pas de reconcile ici: editer un objectif ne doit jamais auto-eliminer des groupes.
}
function onChassesChange() {
  if (currentMode === "chasses") renderChassesAdmin();
  if (currentMode === "group" && selectedGroupId) updateGroupSubs(selectedGroupId);
}

function updateEventBarUI() {
  if (!eventCfg) return;
  document.querySelectorAll("#manche-pick button").forEach((b) => {
    b.classList.toggle("active", parseInt(b.dataset.m, 10) === eventCfg.currentManche);
  });
  const di = document.getElementById("duration-input");
  if (document.activeElement !== di) {
    di.value = eventCfg.durationHours || (DEFAULT_EVENT.durationHoursByManche[eventCfg.currentManche]) || 24;
  }
  const map = { idle: ["EN ATTENTE", ""], running: ["EN COURS", "active"], paused: ["PAUSE", "pending"], finished: ["TERMINEE", "out"] };
  const st = map[eventCfg.status] || ["-", ""];
  const badge = document.getElementById("event-state-badge");
  badge.textContent = `Manche ${eventCfg.currentManche} - ${st[0]}`;
  badge.className = "badge " + st[1];
  document.getElementById("btn-pause").textContent = eventCfg.status === EVENT_STATUS.PAUSED ? "Reprendre" : "Pause";
}

// =====================================================================
// Reconciliation Manche 1 : auto-complete + auto-OUT au 8e
// =====================================================================
let reconciling = false;
async function reconcileManche1() {
  if (!eventCfg || eventCfg.currentManche !== 1 || reconciling) return;
  // N'auto-complete / n'elimine QUE pendant que la manche tourne.
  // (evite qu'une edition d'objectif en idle/pause cloture la manche par effet de bord)
  if (eventCfg.status !== EVENT_STATUS.RUNNING) return;
  const countObjs = allObjectives.filter((o) => o.manche === 1 && o.type === OBJ_TYPE.COUNT);
  if (!countObjs.length) return;

  reconciling = true;
  try {
    let completedCount = allGroups.filter((g) => g.status === STATUS.COMPLETED || g.status === STATUS.QUALIFIED).length;

    // Auto-complete les groupes actifs ayant atteint toutes les cibles
    for (const g of allGroups) {
      if (g.status !== STATUS.ACTIVE) continue;
      const prog = g.manche1Progress || {};
      const done = countObjs.every((o) => (prog[o.id] || 0) >= o.targetQty);
      if (done) {
        completedCount++;
        await updateDoc(doc(db, "groups", g.id), {
          status: STATUS.COMPLETED, completedAt: serverTimestamp(), completionRank: completedCount
        });
      }
    }

    // Au seuil (8), tous les actifs restants passent OUT
    const cut = (eventCfg.qualifyCount && eventCfg.qualifyCount[1]) || 8;
    if (completedCount >= cut) {
      const remaining = allGroups.filter((g) => g.status === STATUS.ACTIVE);
      for (const g of remaining) {
        await updateDoc(doc(db, "groups", g.id), { status: STATUS.OUT, eliminatedAt: serverTimestamp() });
      }
      // Arret automatique du chrono: la Manche 1 est jouee.
      if (eventCfg.status !== EVENT_STATUS.FINISHED) {
        await updateDoc(doc(db, "config", "event"), { status: EVENT_STATUS.FINISHED });
      }
      toast(`${cut} groupes completes. Chrono arrete, les autres passent OUT.`, "success");
    }
  } finally {
    reconciling = false;
  }
}

// =====================================================================
// SIDEBAR
// =====================================================================
function renderSidebar() {
  const list = document.getElementById("group-list");
  if (!allGroups.length) { list.innerHTML = `<div class="list-empty">Aucune cellule. Cree un groupe.</div>`; return; }

  const m = eventCfg ? eventCfg.currentManche : 1;
  const sorted = allGroups.slice().sort((a, b) => {
    const rank = { active: 0, completed: 1, qualified: 1, out: 3 };
    if ((rank[a.status] || 0) !== (rank[b.status] || 0)) return (rank[a.status] || 0) - (rank[b.status] || 0);
    return (b.points?.[m] || 0) - (a.points?.[m] || 0);
  });

  list.innerHTML = "";
  sorted.forEach((g) => {
    const c = groupCache[g.id] || { pending: 0, unread: 0 };
    const el = document.createElement("div");
    el.className = "group-item" + (g.id === selectedGroupId ? " selected" : "");
    el.dataset.action = "select-group";
    el.dataset.gid = g.id;
    el.innerHTML = `
      <div class="gi-main">
        <div class="gi-name">${escapeHtml(g.name)}</div>
        <div class="gi-meta">
          <span class="badge ${g.status}">${STATUS_LABEL[g.status] || g.status}</span>
          <span class="neon">${g.points?.[m] || 0} pts</span>
        </div>
      </div>
      <div class="gi-alerts">
        ${c.pending ? `<span class="badge count" title="preuves en attente">${c.pending}</span>` : ""}
        ${c.unread ? `<span class="badge count" title="messages non lus">@${c.unread}</span>` : ""}
      </div>`;
    list.appendChild(el);
  });
}

// =====================================================================
// MODES
// =====================================================================
function wireModes() {
  document.querySelectorAll("#gm-modes .tab").forEach((t) => {
    t.addEventListener("click", () => switchMode(t.dataset.mode));
  });
}

// Diffusion d'un message a toutes les cellules actives
function wireBroadcast() {
  const btn = document.getElementById("broadcast-btn");
  const input = document.getElementById("broadcast-input");
  if (!btn || !input) return;
  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    const targets = allGroups.filter((g) => g.status !== STATUS.OUT);
    if (!targets.length) { toast("Aucune cellule active.", "error"); return; }
    btn.disabled = true;
    try {
      for (const g of targets) {
        await addDoc(collection(db, "groups", g.id, "messages"), { sender: "gm", text, createdAt: serverTimestamp() });
      }
      input.value = "";
      toast(`Message diffuse a ${targets.length} cellule(s).`, "success");
    } catch (e) { console.error(e); toast("Echec de la diffusion.", "error"); }
    finally { btn.disabled = false; }
  };
  btn.addEventListener("click", send);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
}
function switchMode(mode) {
  currentMode = mode;
  document.querySelectorAll("#gm-modes .tab").forEach((t) => t.classList.toggle("active", t.dataset.mode === mode));
  ["group", "objectives", "chasses", "classement", "out", "create", "quiz", "rules"].forEach((md) => {
    document.getElementById("mode-" + md).style.display = (md === mode) ? "block" : "none";
  });
  if (mode === "group") renderModeGroup();
  if (mode === "objectives") renderObjectivesAdmin();
  if (mode === "chasses") renderChassesAdmin();
  if (mode === "classement") renderClassementAdmin();
  if (mode === "out") renderOutAdmin();
  if (mode === "create") renderCreateAdmin();
  if (mode === "quiz") renderQuizAdmin();
  if (mode === "rules") renderRulesAdmin();
}

// =====================================================================
// PANNEAU GROUPE SELECTIONNE
// =====================================================================
function selectGroup(gid) {
  selectedGroupId = gid;
  // Le marquage "lu" est gere par updateGroupChat (evite la double ecriture).
  switchMode("group");
  renderSidebar();
}

function renderModeGroup() {
  const wrap = document.getElementById("mode-group");
  if (!selectedGroupId || !groupsMap[selectedGroupId]) {
    wrap.innerHTML = `<div class="list-empty" style="margin-top:3rem">Selectionne une cellule dans la liste de gauche.</div>`;
    renderedGroupId = null;
    return;
  }
  if (renderedGroupId !== selectedGroupId) {
    buildGroupSkeleton(selectedGroupId);
    renderedGroupId = selectedGroupId;
    loadIdentity(selectedGroupId);
  }
  updateGroupMeta(selectedGroupId);
  updateGroupQty(selectedGroupId);
  updateGroupSubs(selectedGroupId);
  updateGroupChat(selectedGroupId);
}

function buildGroupSkeleton(gid) {
  const wrap = document.getElementById("mode-group");
  wrap.innerHTML = `
    <div class="gm-grid cols-2">
      <div>
        <div id="gp-meta" class="card" style="margin-bottom:1rem"></div>
        <div id="gp-identity" class="card" style="margin-bottom:1rem"></div>
        <div id="gp-qty" class="card" style="margin-bottom:1rem"></div>
        <div id="gp-points" class="card"></div>
      </div>
      <div>
        <div id="gp-subs" class="card" style="margin-bottom:1rem"></div>
        <div class="card">
          <div class="card-head"><h3>Canal cellule</h3></div>
          <div class="chat">
            <div class="chat-log" id="gp-chat-log"></div>
            <form class="chat-input" id="gp-chat-form">
              <input type="text" id="gp-chat-input" placeholder="Reponse au groupe..." autocomplete="off" />
              <button class="btn primary" type="submit">Envoyer</button>
            </form>
          </div>
        </div>
      </div>
    </div>`;
  document.getElementById("gp-chat-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("gp-chat-input");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    await addDoc(collection(db, "groups", gid, "messages"), { sender: "gm", text, createdAt: serverTimestamp() });
  });
}

function updateGroupMeta(gid) {
  const g = groupsMap[gid]; if (!g) return;
  const m = eventCfg ? eventCfg.currentManche : 1;
  const meta = document.getElementById("gp-meta");
  if (!meta) return;
  meta.innerHTML = `
    <div class="card-head">
      <h3>${escapeHtml(g.name)}</h3>
      <span class="badge ${g.status}">${STATUS_LABEL[g.status] || g.status}</span>
    </div>
    <div class="kvp"><span>Points M1 / M2 / M3</span><b>${g.points?.[1] || 0} / ${g.points?.[2] || 0} / ${g.points?.[3] || 0}</b></div>
    <div class="kvp"><span>Cree le</span><b>${fmtDateTime(tsToMs(g.createdAt))}</b></div>
    ${g.completionRank ? `<div class="kvp"><span>Ordre de completion M1</span><b>#${g.completionRank}</b></div>` : ""}
    <div class="kvp"><span>Code d'acces</span>
      <span><span class="password-reveal" id="pass-${gid}" data-shown="0">********</span>
      <button class="btn sm ghost" data-action="reveal-pass" data-gid="${gid}">Voir</button>
      <button class="btn sm ghost" data-action="regen-pass" data-gid="${gid}">Regen</button></span>
    </div>
    <div class="row" style="margin-top:0.8rem">
      ${g.status === STATUS.OUT
        ? `<button class="btn term sm" data-action="reactivate" data-gid="${gid}">Reactiver (en course)</button>`
        : `<button class="btn term sm" data-action="mark-complete" data-gid="${gid}">Marquer complete / qualifier</button>
           <button class="btn danger sm" data-action="disqualify" data-gid="${gid}">Disqualifier (OUT)</button>`}
      <button class="btn danger sm" data-action="del-group" data-gid="${gid}" style="flex:0 0 auto">Supprimer</button>
    </div>`;

  // Bloc points manuel - masque en Manche 1 (qui se joue a l'ordre de completion, pas aux points)
  const pts = document.getElementById("gp-points");
  if (m === 1) {
    pts.style.display = "none";
    pts.innerHTML = "";
  } else {
    pts.style.display = "block";
    pts.innerHTML = `
    <div class="card-head"><h3>Points Manche ${m}</h3><span class="neon" style="font-family:var(--display);font-size:1.3rem">${g.points?.[m] || 0}</span></div>
    <div class="row">
      <button class="btn sm" data-action="points-adj" data-gid="${gid}" data-delta="-50">-50</button>
      <button class="btn sm" data-action="points-adj" data-gid="${gid}" data-delta="-10">-10</button>
      <button class="btn sm" data-action="points-adj" data-gid="${gid}" data-delta="10">+10</button>
      <button class="btn sm" data-action="points-adj" data-gid="${gid}" data-delta="50">+50</button>
      <button class="btn sm primary" data-action="points-set" data-gid="${gid}" style="flex:0 0 auto">Definir</button>
    </div>
    <div class="tiny mute" style="margin-top:0.5rem">Ajustement manuel. La validation des preuves credite automatiquement.</div>`;
  }
}

function updateGroupQty(gid) {
  const g = groupsMap[gid]; if (!g) return;
  const qty = document.getElementById("gp-qty"); if (!qty) return;
  // Ne pas re-render pendant que le GM tape une quantite (sinon le champ se vide)
  if (qty.contains(document.activeElement) && document.activeElement.classList.contains("qty-edit")) return;
  const m = eventCfg ? eventCfg.currentManche : 1;
  const countObjs = allObjectives.filter((o) => o.manche === m && o.type === OBJ_TYPE.COUNT);

  if (!countObjs.length) {
    qty.style.display = "none";
    return;
  }
  qty.style.display = "block";
  const prog = g.manche1Progress || {};
  let rows = "";
  countObjs.forEach((o) => {
    const d = prog[o.id] || 0;
    const done = d >= o.targetQty;
    const pct = Math.min(100, Math.round((d / o.targetQty) * 100));
    rows += `
      <div class="obj${done ? " done" : ""}">
        <div class="obj-main">
          <div class="obj-label">${escapeHtml(o.label)}</div>
          <div class="progress"><i style="width:${pct}%"></i></div>
        </div>
        <div class="obj-controls">
          <button class="btn icon" data-action="qty-dec" data-gid="${gid}" data-obj="${o.id}">-</button>
          <input type="number" class="qty-edit" data-action="qty-set" data-gid="${gid}" data-obj="${o.id}" value="${d}" min="0" />
          <span class="qty-target">/ ${o.targetQty}</span>
          <button class="btn icon" data-action="qty-inc" data-gid="${gid}" data-obj="${o.id}">+</button>
        </div>
      </div>`;
  });
  qty.innerHTML = `<div class="card-head"><h3>Objectifs objets - Manche ${m}</h3></div><div class="obj-list">${rows}</div>`;
}

function updateGroupSubs(gid) {
  const wrap = document.getElementById("gp-subs"); if (!wrap) return;
  const subs = (groupCache[gid] ? groupCache[gid].submissions : []).slice();
  // pending d'abord
  subs.sort((a, b) => {
    const order = { pending: 0, late: 1, validated: 2, rejected: 3 };
    if ((order[a.status] || 0) !== (order[b.status] || 0)) return (order[a.status] || 0) - (order[b.status] || 0);
    return (tsToMs(b.submittedAt) || 0) - (tsToMs(a.submittedAt) || 0);
  });
  let rows = "";
  if (!subs.length) rows = `<div class="list-empty">Aucune preuve soumise.</div>`;
  subs.forEach((s) => {
    rows += `
      <div class="sub-row">
        <img class="mini-thumb" src="${escapeHtml(s.photoUrl)}" data-action="view-img" data-url="${escapeHtml(s.photoUrl)}" alt="preuve" loading="lazy" />
        <div class="sub-main">
          <div style="font-size:0.85rem">${escapeHtml(s.label || "")} <span class="badge ${s.status}">${SUB_STATUS_LABEL[s.status] || s.status}</span></div>
          <div class="tiny mute">M${s.manche} - ${fmtDateTime(tsToMs(s.submittedAt))} ${s.status === SUB_STATUS.VALIDATED ? `- <span class="term">+${s.points || 0} pts</span>` : ""}</div>
        </div>
        <div class="sub-actions">
          ${s.status === SUB_STATUS.VALIDATED ? "" : `<button class="btn term sm" data-action="validate-sub" data-gid="${gid}" data-sid="${s.id}">Valider</button>`}
          ${s.status === SUB_STATUS.REJECTED ? "" : `<button class="btn danger sm" data-action="reject-sub" data-gid="${gid}" data-sid="${s.id}">Refuser</button>`}
          <button class="btn ghost sm" data-action="del-sub" data-gid="${gid}" data-sid="${s.id}">X</button>
        </div>
      </div>`;
  });
  const pending = subs.filter((s) => s.status === SUB_STATUS.PENDING).length;
  wrap.innerHTML = `<div class="card-head"><h3>Preuves soumises</h3>${pending ? `<span class="badge pending">${pending} en attente</span>` : ""}</div>${rows}`;
}

function updateGroupChat(gid) {
  const log = document.getElementById("gp-chat-log"); if (!log) return;
  const msgs = groupCache[gid] ? groupCache[gid].messages : [];
  log.innerHTML = "";
  if (!msgs.length) { log.innerHTML = `<div class="list-empty">Aucun message.</div>`; }
  msgs.forEach((m) => {
    const el = document.createElement("div");
    el.className = "msg " + (m.sender === "gm" ? "gm" : "group");
    el.innerHTML = `<span class="who-tag">${m.sender === "gm" ? "GM" : escapeHtml(groupsMap[gid]?.name || "GROUPE")}</span>${escapeHtml(m.text)}<div class="meta">${fmtDateTime(tsToMs(m.createdAt))}</div>`;
    log.appendChild(el);
  });
  log.scrollTop = log.scrollHeight;
  // marque comme lus puisque le panneau est ouvert (uniquement s'il y a du non-lu).
  // IMPORTANT: on met unread a 0 AVANT l'ecriture pour casser toute boucle
  // (sinon chaque snapshot groups re-declenche une ecriture -> gel de l'ecran).
  if (selectedGroupId === gid && groupCache[gid] && groupCache[gid].unread > 0) {
    groupCache[gid].unread = 0;
    renderSidebar();
    updateDoc(doc(db, "groups", gid), { lastReadByGm: serverTimestamp() }).catch(() => {});
  }
}

// Fiche identite privee EDITABLE (nom/prenom/tel/armes/notes/CNI) - GM only
async function loadIdentity(gid) {
  const el = document.getElementById("gp-identity");
  if (!el) return;
  el.innerHTML = `<div class="id-head">Fiche cellule (prive)</div><div class="dim tiny">Chargement...</div>`;
  let d = {};
  try {
    const snap = await getDoc(doc(db, "groups", gid, "private", "identity"));
    if (snap.exists()) d = snap.data();
  } catch (e) { /* ignore */ }
  el.innerHTML = `
    <div class="card-head"><h3>Fiche cellule (prive - GM only)</h3>
      <button class="btn primary sm" data-action="save-identity" data-gid="${gid}">Enregistrer</button></div>
    <div class="row">
      <label class="field"><span>Nom</span><input type="text" id="id-nom" value="${escapeHtml(d.nom || "")}" /></label>
      <label class="field"><span>Prenom</span><input type="text" id="id-prenom" value="${escapeHtml(d.prenom || "")}" /></label>
    </div>
    <div class="row">
      <label class="field"><span>Telephone (IG)</span><input type="text" id="id-tel" value="${escapeHtml(d.telephone || "")}" /></label>
      <label class="field" style="flex:0 0 130px"><span>Nb d'armes</span><input type="number" id="id-armes" min="0" value="${d.armes != null ? d.armes : ""}" /></label>
    </div>
    <label class="field"><span>Infos perso / notes</span><textarea id="id-notes" rows="3" placeholder="Notes libres: contacts, planques, etat des armes...">${escapeHtml(d.notes || "")}</textarea></label>
    ${d.idCardUrl
      ? `<img class="id-thumb" src="${escapeHtml(d.idCardUrl)}" data-action="view-img" data-url="${escapeHtml(d.idCardUrl)}" alt="carte d'identite" />`
      : `<div class="dim tiny" style="margin-top:0.4rem">Pas de carte d'identite (ajoutable a la creation de la cellule).</div>`}`;
}

async function saveIdentity(gid) {
  const armesRaw = document.getElementById("id-armes").value;
  const patch = {
    nom: (document.getElementById("id-nom").value || "").trim(),
    prenom: (document.getElementById("id-prenom").value || "").trim(),
    telephone: (document.getElementById("id-tel").value || "").trim(),
    armes: armesRaw === "" ? 0 : (parseInt(armesRaw, 10) || 0),
    notes: (document.getElementById("id-notes").value || "").trim(),
    updatedAt: serverTimestamp()
  };
  try {
    await setDoc(doc(db, "groups", gid, "private", "identity"), patch, { merge: true });
    toast("Fiche cellule enregistree.", "success");
  } catch (e) { console.error(e); toast("Echec de l'enregistrement.", "error"); }
}

// =====================================================================
// ACTIONS GROUPE
// =====================================================================
async function adjustQty(gid, objId, delta) {
  const g = groupsMap[gid]; if (!g) return;
  const cur = (g.manche1Progress || {})[objId] || 0;
  const next = Math.max(0, cur + delta);
  await updateDoc(doc(db, "groups", gid), { [`manche1Progress.${objId}`]: next });
  // reconcileManche1 sera declenche par le snapshot groups
}

// Saisie libre d'une quantite (champ texte)
async function setQty(gid, objId, val) {
  const n = Math.max(0, isNaN(val) ? 0 : val);
  await updateDoc(doc(db, "groups", gid), { [`manche1Progress.${objId}`]: n });
}

async function markComplete(gid) {
  const g = groupsMap[gid]; if (!g) return;
  const completedCount = allGroups.filter((x) => x.status === STATUS.COMPLETED || x.status === STATUS.QUALIFIED).length;
  await updateDoc(doc(db, "groups", gid), {
    status: STATUS.COMPLETED, completedAt: serverTimestamp(), completionRank: completedCount + 1
  });
  toast(`${g.name} marque complete (#${completedCount + 1}).`, "success");
}

// Disqualification / reactivation manuelle (pilotage Manche 3: course, paintball...)
async function disqualify(gid) {
  const g = groupsMap[gid]; if (!g) return;
  await updateDoc(doc(db, "groups", gid), { status: STATUS.OUT, eliminatedAt: serverTimestamp() });
  toast(`${g.name} disqualifie (OUT).`);
}
async function reactivate(gid) {
  const g = groupsMap[gid]; if (!g) return;
  await updateDoc(doc(db, "groups", gid), { status: STATUS.ACTIVE, eliminatedAt: null });
  toast(`${g.name} reactive (en course).`, "success");
}

async function validateSub(gid, sid) {
  const cache = groupCache[gid];
  const sub = cache ? cache.submissions.find((s) => s.id === sid) : null;
  if (!sub) return;

  // Source de verite des points = objectif / chasse (jamais la valeur soumise)
  let pts = 0;
  if (sub.type === OBJ_TYPE.PHOTO) {
    const o = allObjectives.find((x) => x.id === sub.objectiveId);
    pts = o ? (o.points || 0) : 0;
  } else if (sub.type === OBJ_TYPE.CHASSE) {
    const c = allChasses.find((x) => x.id === sub.chasseId);
    pts = c ? (c.points || 0) : 0;
    // Hors delai si: soumise apres closesAt, OU chasse sans limite fermee, OU deja marquee LATE cote groupe
    const overWindow = c && c.closesAt && (tsToMs(sub.submittedAt) || 0) > tsToMs(c.closesAt);
    const closedNoLimit = c && !c.closesAt && c.status === "closed";
    if (overWindow || closedNoLimit || sub.status === SUB_STATUS.LATE) {
      await updateDoc(doc(db, "groups", gid, "submissions", sid), { status: SUB_STATUS.LATE });
      toast("Soumission hors delai. Non creditee.", "error");
      return;
    }
  }

  // Cle d'unicite (null = cumulable). Verifiee + posee DANS la transaction (anti-race).
  const uniqueKey = uniqueKeyFor(sub);

  let creditedPts = 0, capped = false;
  await runTransaction(db, async (tx) => {
    const subRef = doc(db, "groups", gid, "submissions", sid);
    const grpRef = doc(db, "groups", gid);
    const subSnap = await tx.get(subRef);
    if (!subSnap.exists()) return;
    const data = subSnap.data();
    if (data.credited) return;
    const manche = data.manche || (eventCfg ? eventCfg.currentManche : 1);
    if (uniqueKey) {
      const grpSnap = await tx.get(grpRef);
      const ck = (grpSnap.exists() && grpSnap.data().creditedKeys) || {};
      if (ck[uniqueKey]) {
        // deja credite pour cet objectif unique -> validee mais SANS cumul
        tx.update(subRef, { status: SUB_STATUS.VALIDATED, points: 0, credited: false, validatedAt: serverTimestamp() });
        capped = true;
        return;
      }
      tx.update(grpRef, { [`creditedKeys.${uniqueKey}`]: true, [`points.${manche}`]: increment(pts) });
    } else {
      tx.update(grpRef, { [`points.${manche}`]: increment(pts) });
    }
    tx.update(subRef, { status: SUB_STATUS.VALIDATED, credited: true, points: pts, validatedAt: serverTimestamp() });
    creditedPts = pts;
  });
  if (capped) toast("Objectif unique deja credite pour ce groupe. Photo validee, sans cumul de points.", "info");
  else toast(`Preuve validee (+${creditedPts} pts).`, "success");
}

// Cle d'unicite d'une soumission: objectif photo non-repetable ou chasse -> credit unique par groupe
function uniqueKeyFor(sub) {
  if (!sub) return null;
  if (sub.type === OBJ_TYPE.PHOTO && sub.objectiveId) {
    const o = allObjectives.find((x) => x.id === sub.objectiveId);
    return (o && !o.repeatable) ? "o_" + sub.objectiveId : null;
  }
  if (sub.type === OBJ_TYPE.CHASSE && sub.chasseId) return "c_" + sub.chasseId;
  return null;
}

async function rejectSub(gid, sid) {
  const note = await modalPrompt("Refuser la preuve", { label: "Motif (optionnel)", placeholder: "ex: photo illisible", okLabel: "Refuser" });
  await runTransaction(db, async (tx) => {
    const subRef = doc(db, "groups", gid, "submissions", sid);
    const grpRef = doc(db, "groups", gid);
    const snap = await tx.get(subRef);
    if (!snap.exists()) return;
    const data = snap.data();
    const manche = data.manche || (eventCfg ? eventCfg.currentManche : 1);
    if (data.credited) {
      const patch = { [`points.${manche}`]: increment(-(data.points || 0)) };
      const uk = uniqueKeyFor(data);
      if (uk) patch[`creditedKeys.${uk}`] = false;   // libere pour re-credit
      tx.update(grpRef, patch);
    }
    tx.update(subRef, { status: SUB_STATUS.REJECTED, credited: false, note: note || null });
  });
  toast("Preuve refusee.");
}

async function delSub(gid, sid) {
  const cache = groupCache[gid];
  const sub = cache ? cache.submissions.find((s) => s.id === sid) : null;
  const ok = await modalConfirm("Supprimer la preuve", "Supprime la soumission et sa photo. Si elle etait validee, les points sont retires.", { danger: true });
  if (!ok) return;
  if (sub && sub.credited) {
    const patch = { [`points.${sub.manche}`]: increment(-(sub.points || 0)) };
    const uk = uniqueKeyFor(sub);
    if (uk) patch[`creditedKeys.${uk}`] = false;   // libere pour re-credit
    await updateDoc(doc(db, "groups", gid), patch);
  }
  if (sub && sub.storagePath) { try { await deleteObject(storageRef(storage, sub.storagePath)); } catch {} }
  await deleteDoc(doc(db, "groups", gid, "submissions", sid));
  toast("Preuve supprimee.");
}

async function pointsAdj(gid, delta) {
  const m = eventCfg ? eventCfg.currentManche : 1;
  await updateDoc(doc(db, "groups", gid), { [`points.${m}`]: increment(delta) });
}
async function pointsSet(gid) {
  const m = eventCfg ? eventCfg.currentManche : 1;
  const g = groupsMap[gid];
  const v = await modalPrompt(`Definir les points (Manche ${m})`, { label: "Points", value: String(g.points?.[m] || 0) });
  if (v === null) return;
  const n = parseInt(v, 10);
  if (isNaN(n)) { toast("Valeur invalide.", "error"); return; }
  await updateDoc(doc(db, "groups", gid), { [`points.${m}`]: n });
}

function revealPass(gid) {
  const el = document.getElementById("pass-" + gid);
  const g = groupsMap[gid];
  if (!el || !g) return;
  if (el.dataset.shown === "1") { el.textContent = "********"; el.dataset.shown = "0"; }
  else { el.textContent = g.password || "(aucun)"; el.dataset.shown = "1"; }
}
async function regenPass(gid) {
  const np = generatePassword();
  await updateDoc(doc(db, "groups", gid), { password: np });
  toast(`Nouveau code: ${np}`, "success");
  const el = document.getElementById("pass-" + gid);
  if (el) { el.textContent = np; el.dataset.shown = "1"; }
}

async function delGroup(gid) {
  const g = groupsMap[gid];
  const ok = await modalConfirm("Supprimer la cellule",
    `Supprimer definitivement "${escapeHtml(g.name)}" + ses preuves, messages et fichiers ? Irreversible.`, { danger: true, okLabel: "Supprimer" });
  if (!ok) return;
  await deleteGroupDeep(gid);
  if (selectedGroupId === gid) { selectedGroupId = null; renderedGroupId = null; renderModeGroup(); }
  toast("Cellule supprimee.");
}

async function deleteGroupDeep(gid) {
  // Supprime fichiers Storage + sous-collections + doc
  try {
    const subSnap = await getDocs(collection(db, "groups", gid, "submissions"));
    for (const d of subSnap.docs) {
      const sp = d.data().storagePath;
      if (sp) { try { await deleteObject(storageRef(storage, sp)); } catch {} }
      await deleteDoc(d.ref);
    }
    const msgSnap = await getDocs(collection(db, "groups", gid, "messages"));
    for (const d of msgSnap.docs) await deleteDoc(d.ref);
    // Fiche identite privee + carte d'identite Storage
    try {
      const idSnap = await getDoc(doc(db, "groups", gid, "private", "identity"));
      if (idSnap.exists() && idSnap.data().idCardStoragePath) {
        try { await deleteObject(storageRef(storage, idSnap.data().idCardStoragePath)); } catch {}
      }
      await deleteDoc(doc(db, "groups", gid, "private", "identity"));
    } catch {}
  } catch (e) { console.warn("nettoyage sous-collections", e); }
  await deleteDoc(doc(db, "groups", gid));
}

// =====================================================================
// MODE OBJECTIFS
// =====================================================================
function renderObjectivesAdmin() {
  const wrap = document.getElementById("mode-objectives");
  const byManche = { 1: [], 2: [], 3: [] };
  allObjectives.forEach((o) => { (byManche[o.manche] || (byManche[o.manche] = [])).push(o); });

  const listHtml = (m) => {
    const arr = byManche[m] || [];
    if (!arr.length) return `<div class="list-empty">Aucun objectif.</div>`;
    return arr.map((o) => `
      <div class="sub-row">
        <div class="sub-main">
          <div style="font-size:0.88rem">${escapeHtml(o.label)} <span class="badge">${o.type}</span> ${o.type === OBJ_TYPE.PHOTO ? (o.repeatable ? '<span class="badge active">cumulable</span>' : '<span class="badge">unique</span>') : ""}</div>
          <div class="tiny mute">${o.type === OBJ_TYPE.COUNT ? `cible: ${o.targetQty}` : `${o.points} pts`}</div>
        </div>
        <div class="sub-actions">
          <button class="btn ghost sm" data-action="obj-edit" data-id="${o.id}">Editer</button>
          <button class="btn danger sm" data-action="obj-del" data-id="${o.id}">X</button>
        </div>
      </div>`).join("");
  };

  wrap.innerHTML = `
    <div class="card" style="margin-bottom:1rem">
      <div class="card-head"><h3>Gestion des objectifs</h3>
        <button class="btn term sm" data-action="seed-obj">Initialiser les objectifs par defaut</button>
      </div>
      <form id="obj-create-form" class="row" style="align-items:flex-end">
        <label class="field" style="flex:0 0 90px"><span>Manche</span>
          <select id="obj-m"><option>1</option><option>2</option><option>3</option></select></label>
        <label class="field" style="flex:0 0 120px"><span>Type</span>
          <select id="obj-t"><option value="count">count</option><option value="photo">photo</option></select></label>
        <label class="field" style="flex:2"><span>Libelle</span><input type="text" id="obj-label" placeholder="ex: Disqueuses" /></label>
        <label class="field" style="flex:0 0 110px"><span id="obj-val-label">Cible / Points</span><input type="number" id="obj-val" min="0" /></label>
        <label class="field" style="flex:0 0 110px"><span>Repetable</span>
          <select id="obj-rep"><option value="no">non</option><option value="yes">oui</option></select></label>
        <button class="btn primary" type="submit" style="flex:0 0 auto">Ajouter</button>
      </form>
      <div class="tiny mute">Les chasses (type chasse) se gerent dans l'onglet Chasses.</div>
    </div>
    <div class="gm-grid cols-2">
      <div class="card"><div class="card-head"><h3>Manche 1 (objets)</h3></div>${listHtml(1)}</div>
      <div>
        <div class="card" style="margin-bottom:1rem"><div class="card-head"><h3>Manche 2 (photo)</h3></div>${listHtml(2)}</div>
        <div class="card"><div class="card-head"><h3>Manche 3</h3></div>${listHtml(3)}</div>
      </div>
    </div>`;

  // type -> ajuste le label du champ valeur
  const t = document.getElementById("obj-t");
  const updLbl = () => { document.getElementById("obj-val-label").textContent = t.value === "count" ? "Cible (qte)" : "Points"; };
  t.addEventListener("change", updLbl); updLbl();
}

async function createObjective() {
  const manche = parseInt(document.getElementById("obj-m").value, 10);
  const type = document.getElementById("obj-t").value;
  const label = document.getElementById("obj-label").value.trim();
  const val = parseInt(document.getElementById("obj-val").value, 10);
  const rep = document.getElementById("obj-rep").value === "yes";
  if (!label) { toast("Libelle requis.", "error"); return; }
  if (isNaN(val)) { toast("Valeur numerique requise.", "error"); return; }
  await addDoc(collection(db, "objectives"), {
    manche, type, label,
    targetQty: type === OBJ_TYPE.COUNT ? val : null,
    points: type === OBJ_TYPE.PHOTO ? val : null,
    repeatable: rep, order: Date.now(), createdAt: serverTimestamp()
  });
  toast("Objectif ajoute.", "success");
  document.getElementById("obj-label").value = "";
  document.getElementById("obj-val").value = "";
}

async function editObjective(id) {
  const o = allObjectives.find((x) => x.id === id); if (!o) return;
  const label = await modalPrompt("Editer le libelle", { label: "Libelle", value: o.label });
  if (label === null) return;
  const valStr = await modalPrompt(o.type === OBJ_TYPE.COUNT ? "Cible (qte)" : "Points", { label: "Valeur", value: String(o.type === OBJ_TYPE.COUNT ? o.targetQty : o.points) });
  if (valStr === null) return;
  const val = parseInt(valStr, 10);
  const patch = { label };
  if (o.type === OBJ_TYPE.COUNT) patch.targetQty = isNaN(val) ? o.targetQty : val;
  else patch.points = isNaN(val) ? o.points : val;
  await updateDoc(doc(db, "objectives", id), patch);
  toast("Objectif mis a jour.", "success");
}

async function delObjective(id) {
  const ok = await modalConfirm("Supprimer l'objectif", "Confirmer la suppression de cet objectif ?", { danger: true });
  if (!ok) return;
  await deleteDoc(doc(db, "objectives", id));
  toast("Objectif supprime.");
}

// =====================================================================
// MODE CHASSES
// =====================================================================
function renderChassesAdmin() {
  const wrap = document.getElementById("mode-chasses");
  const rows = allChasses.length ? allChasses.map((c) => {
    const open = c.status === "open";
    const remaining = c.closesAt ? Math.max(0, tsToMs(c.closesAt) - Date.now()) : 0;
    return `
      <div class="sub-row">
        ${c.photoUrl ? `<img class="mini-thumb" src="${escapeHtml(c.photoUrl)}" data-action="view-img" data-url="${escapeHtml(c.photoUrl)}" alt="lieu" />` : `<div class="mini-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--txt-mute)">?</div>`}
        <div class="sub-main">
          <div style="font-size:0.88rem">${escapeHtml(c.label)} <span class="badge ${open ? "active" : c.status === "closed" ? "out" : ""}">${c.status}</span></div>
          <div class="tiny mute">M${c.manche} - ${c.points} pts - ${c.windowMinutes > 0 ? `fenetre ${c.windowMinutes} min` : "sans limite"} ${open ? (c.closesAt ? `- reste <span class="ch-rem" data-id="${c.id}">${formatHud(remaining)}</span>` : "- EN COURS") : ""}</div>
        </div>
        <div class="sub-actions">
          ${open
            ? `<button class="btn danger sm" data-action="chasse-close" data-id="${c.id}">Fermer</button>`
            : `<button class="btn term sm" data-action="chasse-open" data-id="${c.id}">Ouvrir</button>`}
          <button class="btn ghost sm" data-action="chasse-del" data-id="${c.id}">X</button>
        </div>
      </div>`;
  }).join("") : `<div class="list-empty">Aucune chasse.</div>`;

  wrap.innerHTML = `
    <div class="card" style="margin-bottom:1rem">
      <div class="card-head"><h3>Creer une chasse</h3>
        <button class="btn term sm" data-action="seed-chasse">Initialiser chasses d'exemple</button>
      </div>
      <div class="row">
        <label class="field" style="flex:2"><span>Titre</span><input type="text" id="ch-label" placeholder="ex: Chasse Jour 2 - 21h" /></label>
        <label class="field" style="flex:0 0 90px"><span>Manche</span><select id="ch-m"><option>2</option><option>3</option></select></label>
        <label class="field" style="flex:0 0 100px"><span>Points</span><input type="number" id="ch-pts" value="100" /></label>
        <label class="field" style="flex:0 0 150px"><span>Fenetre (min, 0=sans limite)</span><input type="number" id="ch-win" value="60" min="0" /></label>
      </div>
      <div class="paste-zone" id="ch-paste" tabindex="0">
        <div class="pz-icon">[ + ]</div>
        <div class="pz-hint">Colle (<span class="pz-kbd">Ctrl+V</span>) ou choisis la photo du lieu</div>
        <input type="file" id="ch-file" accept="image/*" style="display:none" />
        <button type="button" class="btn ghost sm" id="ch-file-btn" style="margin-top:0.6rem">Choisir un fichier</button>
      </div>
      <img id="ch-preview" class="preview-img" style="display:none" alt="apercu" />
      <button class="btn primary block" id="ch-create" style="margin-top:0.8rem">Creer la chasse</button>
    </div>
    <div class="card"><div class="card-head"><h3>Chasses</h3></div>${rows}</div>`;

  // Wire creation chasse (zone de collage + boutons)
  chasseBlob = null;
  const zone = document.getElementById("ch-paste");
  const fileInput = document.getElementById("ch-file");
  document.getElementById("ch-file-btn").addEventListener("click", (e) => { e.stopPropagation(); fileInput.click(); });
  wirePasteZone(zone, fileInput, (blob, dataUrl) => {
    chasseBlob = blob;
    const p = document.getElementById("ch-preview"); p.src = dataUrl; p.style.display = "block";
    toast("Photo prete.", "success");
  });
  document.getElementById("ch-create").addEventListener("click", createChasse);
}

async function createChasse() {
  const label = document.getElementById("ch-label").value.trim();
  const manche = parseInt(document.getElementById("ch-m").value, 10);
  const ptsRaw = parseInt(document.getElementById("ch-pts").value, 10);
  const points = isNaN(ptsRaw) ? 0 : Math.max(0, ptsRaw);
  const winRaw = parseInt(document.getElementById("ch-win").value, 10);
  const win = isNaN(winRaw) ? 0 : Math.max(0, winRaw);   // 0 = sans limite
  if (!label) { toast("Titre requis.", "error"); return; }

  const btn = document.getElementById("ch-create");
  btn.disabled = true; btn.textContent = "Creation...";
  try {
    let photoUrl = "", storagePath = "";
    if (chasseBlob) {
      const ext = (chasseBlob.type.split("/")[1] || "png").replace("jpeg", "jpg");
      storagePath = `chasses/${Date.now()}_${Math.floor(performance.now())}.${ext}`;
      const sref = storageRef(storage, storagePath);
      await uploadBytes(sref, chasseBlob, { contentType: chasseBlob.type });
      photoUrl = await getDownloadURL(sref);
    }
    await addDoc(collection(db, "chasses"), {
      label, manche, points, windowMinutes: win, photoUrl, storagePath,
      status: "idle", openedAt: null, closesAt: null, order: Date.now(), createdAt: serverTimestamp()
    });
    toast("Chasse creee.", "success");
  } catch (e) { console.error(e); toast("Echec creation chasse.", "error"); }
  finally { btn.disabled = false; btn.textContent = "Creer la chasse"; }
}

async function openChasse(id) {
  const c = allChasses.find((x) => x.id === id); if (!c) return;
  const now = Date.now();
  const win = c.windowMinutes || 0;   // 0 = sans limite (ouverte jusqu'a fermeture)
  await updateDoc(doc(db, "chasses", id), {
    status: "open", openedAt: now, closesAt: win > 0 ? now + win * 60000 : null
  });
  toast(win > 0 ? `Chasse "${c.label}" ouverte (${win} min).` : `Epreuve "${c.label}" ouverte (sans limite, ferme-la a la main).`, "success");
}
async function closeChasse(id) {
  // Fige closesAt a maintenant: meme une chasse "sans limite" a une borne apres fermeture
  await updateDoc(doc(db, "chasses", id), { status: "closed", closesAt: Date.now() });
  toast("Chasse fermee.");
}
async function delChasse(id) {
  const c = allChasses.find((x) => x.id === id);
  const ok = await modalConfirm("Supprimer la chasse", "Confirmer la suppression ?", { danger: true });
  if (!ok) return;
  if (c && c.storagePath) { try { await deleteObject(storageRef(storage, c.storagePath)); } catch {} }
  await deleteDoc(doc(db, "chasses", id));
  toast("Chasse supprimee.");
}

// =====================================================================
// MODE CLASSEMENT
// =====================================================================
function renderClassementAdmin() {
  const wrap = document.getElementById("mode-classement");
  const m = eventCfg ? eventCfg.currentManche : 1;
  const active = allGroups.filter((g) => g.status !== STATUS.OUT);
  const out = allGroups.filter((g) => g.status === STATUS.OUT);

  let ranked;
  if (m === 1) {
    ranked = active.slice().sort((a, b) => {
      const pa = progressPct(a), pb = progressPct(b);
      if (pb !== pa) return pb - pa;
      return (tsToMs(a.completedAt) || Infinity) - (tsToMs(b.completedAt) || Infinity);
    });
  } else {
    ranked = active.slice().sort((a, b) => (b.points?.[m] || 0) - (a.points?.[m] || 0));
  }
  const cut = (eventCfg && eventCfg.qualifyCount) ? eventCfg.qualifyCount[m] : null;

  let rows = "";
  ranked.forEach((g, i) => {
    if (cut && i === cut) rows += `<div class="cut-line">Ligne de qualification (${cut})</div>`;
    const score = m === 1 ? `${Math.round(progressPct(g) * 100)}%` : `${g.points?.[m] || 0} pts`;
    rows += `<div class="rank ${cut && i < cut ? "top" : ""}">
      <div class="pos">${i + 1}</div>
      <div class="rank-name">${escapeHtml(g.name)} <span class="badge ${g.status}">${STATUS_LABEL[g.status]}</span></div>
      <div class="rank-score">${score}</div></div>`;
  });
  if (!ranked.length) rows = `<div class="list-empty">Aucun groupe en course.</div>`;

  wrap.innerHTML = `
    <div class="section-title">Classement Manche ${m}</div>
    <div class="section-sub">${m === 1 ? "Tri par progression + ordre de completion." : "Tri par points."}</div>
    <div class="rank-list">${rows}</div>
    ${out.length ? `<div class="cut-line" style="color:var(--danger);margin-top:1.5rem">Elimines (${out.length})</div>
      <div class="rank-list">${out.map((g) => `<div class="rank"><div class="pos danger-txt">-</div><div class="rank-name">${escapeHtml(g.name)}</div><div class="rank-score danger-txt">OUT</div></div>`).join("")}</div>` : ""}`;
}
function progressPct(g) {
  const countObjs = allObjectives.filter((o) => o.manche === 1 && o.type === OBJ_TYPE.COUNT);
  if (!countObjs.length) return 0;
  let d = 0, t = 0; const prog = g.manche1Progress || {};
  countObjs.forEach((o) => { d += Math.min(prog[o.id] || 0, o.targetQty); t += o.targetQty; });
  return t ? d / t : 0;
}

// =====================================================================
// MODE OUT (elimines)
// =====================================================================
function renderOutAdmin() {
  const wrap = document.getElementById("mode-out");
  const out = allGroups.filter((g) => g.status === STATUS.OUT);
  const rows = out.length ? out.map((g) => `
    <div class="sub-row">
      <div class="sub-main"><div style="font-size:0.9rem">${escapeHtml(g.name)}</div>
        <div class="tiny mute">Elimine le ${fmtDateTime(tsToMs(g.eliminatedAt))} - ${g.points?.[1] || 0}/${g.points?.[2] || 0}/${g.points?.[3] || 0} pts</div></div>
      <div class="sub-actions"><button class="btn danger sm" data-action="out-del" data-gid="${g.id}">Supprimer definitivement</button></div>
    </div>`).join("") : `<div class="list-empty">Aucun groupe elimine.</div>`;

  wrap.innerHTML = `
    <div class="card">
      <div class="card-head"><h3>Section OUT - cellules eliminees</h3>
        ${out.length ? `<button class="btn danger sm" data-action="out-purge">Purger tous les OUT (${out.length})</button>` : ""}
      </div>
      <div class="tiny mute" style="margin-bottom:0.8rem">La suppression efface le groupe + preuves + messages + fichiers. Irreversible.</div>
      ${rows}
    </div>`;
}

async function purgeOut() {
  const out = allGroups.filter((g) => g.status === STATUS.OUT);
  if (!out.length) return;
  const ok = await modalConfirm("Purger tous les OUT", `Supprimer definitivement ${out.length} cellule(s) eliminee(s) et toutes leurs donnees ?`, { danger: true, okLabel: "Tout purger" });
  if (!ok) return;
  for (const g of out) await deleteGroupDeep(g.id);
  toast(`${out.length} cellule(s) purgee(s).`, "success");
}

// =====================================================================
// MODE CREER GROUPE
// =====================================================================
function renderCreateAdmin() {
  const wrap = document.getElementById("mode-create");
  cgIdBlob = null;
  wrap.innerHTML = `
    <div class="card" style="max-width:580px">
      <div class="card-head"><h3>Creer une cellule</h3></div>
      <form id="create-group-form" autocomplete="off">
        <label class="field"><span>Nom du groupe (sert au login)</span><input type="text" id="cg-name" placeholder="ex: Les Corbeaux" required /></label>
        <label class="field"><span>Code d'acces</span>
          <div class="row"><input type="text" id="cg-pass" placeholder="auto-genere" />
          <button type="button" class="btn ghost" id="cg-gen" style="flex:0 0 auto">Generer</button></div>
        </label>

        <div class="id-head" style="margin-top:0.6rem">Fiche joueur (privee - GM only)</div>
        <div class="row">
          <label class="field"><span>Nom</span><input type="text" id="cg-nom" /></label>
          <label class="field"><span>Prenom</span><input type="text" id="cg-prenom" /></label>
        </div>
        <label class="field"><span>Telephone (IG)</span><input type="text" id="cg-tel" placeholder="ex: 555-1234" /></label>

        <div class="field"><span>Carte d'identite (copier-coller / fichier)</span>
          <div class="paste-zone" id="cg-id-paste" tabindex="0">
            <div class="pz-icon">[ + ]</div>
            <div class="pz-hint">Colle (<span class="pz-kbd">Ctrl+V</span>) ou choisis l'image de la CNI</div>
            <input type="file" id="cg-id-file" accept="image/*" style="display:none" />
            <button type="button" class="btn ghost sm" id="cg-id-btn" style="margin-top:0.6rem">Choisir un fichier</button>
          </div>
          <img id="cg-id-preview" class="preview-img" style="display:none" alt="apercu CNI" />
        </div>

        <button class="btn primary block" type="submit" style="margin-top:0.6rem">Creer la cellule</button>
      </form>
      <div class="tiny mute" style="margin-top:0.8rem">Code vide = genere automatiquement. La fiche joueur n'est visible que par toi.</div>
    </div>`;
  document.getElementById("cg-gen").addEventListener("click", () => { document.getElementById("cg-pass").value = generatePassword(); });
  const fileInput = document.getElementById("cg-id-file");
  document.getElementById("cg-id-btn").addEventListener("click", (e) => { e.stopPropagation(); fileInput.click(); });
  wirePasteZone(document.getElementById("cg-id-paste"), fileInput, (blob, dataUrl) => {
    cgIdBlob = blob;
    const p = document.getElementById("cg-id-preview"); p.src = dataUrl; p.style.display = "block";
    toast("Carte d'identite prete.", "success");
  });
  document.getElementById("create-group-form").addEventListener("submit", createGroup);
}

async function createGroup(e) {
  e.preventDefault();
  const name = document.getElementById("cg-name").value.trim();
  let pass = document.getElementById("cg-pass").value.trim();
  if (!name) { toast("Nom requis.", "error"); return; }
  if (!pass) pass = generatePassword();

  // Verifie l'unicite du nom (insensible a la casse)
  if (allGroups.some((g) => (g.nameLower || g.name?.toLowerCase()) === name.toLowerCase())) {
    toast("Un groupe porte deja ce nom.", "error"); return;
  }

  const btn = document.querySelector("#create-group-form button[type=submit]");
  if (btn) { btn.disabled = true; btn.textContent = "Creation..."; }
  try {
    const ref = await addDoc(collection(db, "groups"), {
      name, nameLower: name.toLowerCase(), password: pass,
      status: STATUS.ACTIVE, memberUids: [],
      manche1Progress: {}, points: { 1: 0, 2: 0, 3: 0 }, creditedKeys: {},
      completedAt: null, completionRank: null, eliminatedAt: null,
      lastReadByGm: serverTimestamp(), createdAt: serverTimestamp()
    });

    // Fiche identite privee (GM only) + upload carte d'identite
    const nom = (document.getElementById("cg-nom").value || "").trim();
    const prenom = (document.getElementById("cg-prenom").value || "").trim();
    const tel = (document.getElementById("cg-tel").value || "").trim();
    let idCardUrl = "", idCardStoragePath = "";
    if (cgIdBlob) {
      const ext = (cgIdBlob.type.split("/")[1] || "png").replace("jpeg", "jpg");
      idCardStoragePath = `identity/${ref.id}/cni_${Date.now()}.${ext}`;
      const sref = storageRef(storage, idCardStoragePath);
      await uploadBytes(sref, cgIdBlob, { contentType: cgIdBlob.type });
      idCardUrl = await getDownloadURL(sref);
    }
    await setDoc(doc(db, "groups", ref.id, "private", "identity"), {
      nom, prenom, telephone: tel, idCardUrl, idCardStoragePath, updatedAt: serverTimestamp()
    });

    toast(`Cellule "${name}" creee. Code: ${pass}`, "success");
    document.getElementById("cg-name").value = "";
    document.getElementById("cg-pass").value = "";
    document.getElementById("cg-nom").value = "";
    document.getElementById("cg-prenom").value = "";
    document.getElementById("cg-tel").value = "";
    const prev = document.getElementById("cg-id-preview"); if (prev) { prev.src = ""; prev.style.display = "none"; }
    cgIdBlob = null;
  } catch (ex) {
    console.error(ex); toast("Echec de la creation.", "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Creer la cellule"; }
  }
}

// =====================================================================
// MODE QUIZ (Epreuve 2) - questions live, reponse libre, credit manuel
// =====================================================================
function syncQuizRoundListener() {
  const rid = quizCfg && quizCfg.roundId ? quizCfg.roundId : null;
  if (rid === lastRoundQid) return;
  if (unsubQuizRound) { unsubQuizRound(); unsubQuizRound = null; }
  quizRoundAnswers = {};
  lastRoundQid = rid;
  if (!rid) { if (currentMode === "quiz") updateQuizAnswers(); return; }
  unsubQuizRound = onSnapshot(collection(db, "quizRounds", rid, "answers"), (s) => {
    quizRoundAnswers = {};
    s.docs.forEach((d) => { quizRoundAnswers[d.id] = d.data(); });
    if (currentMode === "quiz") updateQuizAnswers();
  });
}

function updateQuizAnswers() {
  const wrap = document.getElementById("quiz-answers");
  if (!wrap) return;
  if (!quizCfg || quizCfg.status !== "open" || !quizCfg.roundId) { wrap.innerHTML = ""; return; }
  const q = allQuestions.find((x) => x.id === quizCfg.qid);
  const expected = q ? q.answer : "";
  const closesAt = quizCfg.closesAt || 0;
  const players = allGroups.filter((g) => g.status !== STATUS.OUT);
  let rows = `<div class="kvp" style="margin-top:0.6rem"><span>Reponse attendue</span><b class="neon">${escapeHtml(expected)}</b></div>`;
  if (!players.length) rows += `<div class="list-empty">Aucun groupe actif.</div>`;
  players.forEach((g) => {
    const a = quizRoundAnswers[g.id];
    const late = a && a.answeredAt && closesAt && ((tsToMs(a.answeredAt) || 0) > closesAt);
    let right;
    if (!a || !a.text) right = `<span class="qa-none">pas de reponse</span>`;
    else if (a.credited) right = `<span class="badge validated">credite +1</span>`;
    else if (late) right = `<span class="badge late">HORS DELAI</span>`;
    else right = `<button class="btn term sm" data-action="credit-quiz" data-gid="${g.id}">+1 pt</button>`;
    rows += `<div class="quiz-ans-row">
      <div class="qa-name">${escapeHtml(g.name)}</div>
      ${a && a.text ? `<div class="qa-text">${escapeHtml(a.text)}</div>` : `<div class="qa-none">-</div>`}
      ${right}
    </div>`;
  });
  wrap.innerHTML = rows;
}

function renderQuizAdmin() {
  const wrap = document.getElementById("mode-quiz");
  const isOpen = quizCfg && quizCfg.status === "open" && quizCfg.qid;
  const activeQ = isOpen ? allQuestions.find((x) => x.id === quizCfg.qid) : null;

  const players = allGroups.filter((g) => g.status !== STATUS.OUT)
    .slice().sort((a, b) => ((b.points?.[3] || 0) - (a.points?.[3] || 0)));
  const scoreRows = players.length ? players.map((g) => `
    <div class="quiz-ans-row">
      <div class="qa-name">${escapeHtml(g.name)}</div>
      <div class="qa-text" style="color:var(--neon)">${g.points?.[3] || 0} pts</div>
      <button class="btn danger sm" data-action="disqualify" data-gid="${g.id}">Disqualifier</button>
    </div>`).join("") : `<div class="list-empty">Aucun groupe en course.</div>`;

  const bankRows = allQuestions.length ? allQuestions.map((q) => `
    <div class="q-bank-row">
      <div class="qb-main"><div class="qb-text">${escapeHtml(q.text)}</div><div class="qb-ans">Rep: ${escapeHtml(q.answer)}</div></div>
      <button class="btn term sm" data-action="open-question" data-qid="${q.id}">Ouvrir</button>
      <button class="btn ghost sm" data-action="del-question" data-id="${q.id}">X</button>
    </div>`).join("") : `<div class="list-empty">Banque vide. Clique "Initialiser la banque".</div>`;

  wrap.innerHTML = `
    <div class="card" style="margin-bottom:1rem">
      <div class="card-head"><h3>Question en direct (Epreuve 2)</h3>
        <label class="dim tiny" style="display:flex;align-items:center;gap:0.4rem">Duree (s)
          <input type="number" id="quiz-dur" value="${(quizCfg && quizCfg.durationSec) || 5}" min="2" max="120" style="width:64px"></label></div>
      ${isOpen
        ? `<div class="kvp"><span>Question diffusee</span><b>${escapeHtml(activeQ ? activeQ.text : quizCfg.text)}</b></div>
           <button class="btn danger sm" data-action="close-question" style="margin:0.6rem 0">Fermer la question</button>`
        : `<div class="dim tiny">Aucune question ouverte. Clique "Ouvrir" sur une question ci-dessous.</div>`}
      <div id="quiz-answers"></div>
    </div>

    <div class="card" style="margin-bottom:1rem">
      <div class="card-head"><h3>Scores Manche 3 (le plus bas est elimine)</h3></div>
      ${scoreRows}
    </div>

    <div class="card" style="margin-bottom:1rem">
      <div class="card-head"><h3>Ajouter une question</h3>
        <button class="btn term sm" data-action="seed-questions">Initialiser la banque</button></div>
      <form id="q-add-form" class="row" style="align-items:flex-end">
        <label class="field" style="flex:2"><span>Question</span><input type="text" id="q-add-text" placeholder="ex: Code du silence de la mafia ?" /></label>
        <label class="field" style="flex:1"><span>Reponse attendue</span><input type="text" id="q-add-ans" placeholder="ex: Omerta" /></label>
        <button class="btn primary" type="submit" style="flex:0 0 auto">Ajouter</button>
      </form>
    </div>

    <div class="card">
      <div class="card-head"><h3>Banque de questions (${allQuestions.length})</h3></div>
      ${bankRows}
    </div>`;

  updateQuizAnswers();
}

async function openQuestion(qid) {
  const q = allQuestions.find((x) => x.id === qid); if (!q) return;
  const durEl = document.getElementById("quiz-dur");
  const dur = (durEl && parseInt(durEl.value, 10)) || 5;
  const number = ((quizCfg && quizCfg.number) || 0) + 1;
  const openedAt = Date.now();
  const roundId = `${qid}_${number}`;   // round unique -> pas de reponses/credits residuels
  await setDoc(doc(db, "config", "quiz"),
    { status: "open", qid, roundId, text: q.text, openedAt, durationSec: dur, closesAt: openedAt + dur * 1000, number }, { merge: true });
  toast(`Question diffusee (${dur}s).`, "success");
}

async function closeQuestion() {
  await setDoc(doc(db, "config", "quiz"), { status: "closed" }, { merge: true });
  toast("Question fermee.");
}

async function creditQuiz(gid) {
  if (!quizCfg || !quizCfg.roundId) return;
  const a = quizRoundAnswers[gid];
  if (!a || !a.text) { toast("Ce groupe n'a pas repondu.", "error"); return; }
  if (a.credited) { toast("Deja credite."); return; }
  const rid = quizCfg.roundId;
  try {
    await runTransaction(db, async (tx) => {
      const ansRef = doc(db, "quizRounds", rid, "answers", gid);
      const snap = await tx.get(ansRef);
      if (!snap.exists() || !snap.data().text) throw new Error("no-answer");
      if (snap.data().credited) return;   // deja credite (idempotent)
      tx.update(ansRef, { credited: true });
      tx.update(doc(db, "groups", gid), { ["points.3"]: increment(1) });
    });
    toast("+1 pt credite.", "success");
  } catch (e) { toast("Credit impossible.", "error"); }
}

async function addQuestion() {
  const text = document.getElementById("q-add-text").value.trim();
  const answer = document.getElementById("q-add-ans").value.trim();
  if (!text || !answer) { toast("Question et reponse requises.", "error"); return; }
  await addDoc(collection(db, "questions"), { text, answer, order: Date.now(), createdAt: serverTimestamp() });
  toast("Question ajoutee.", "success");
}

async function delQuestion(id) {
  const ok = await modalConfirm("Supprimer la question", "Confirmer la suppression ?", { danger: true });
  if (!ok) return;
  await deleteDoc(doc(db, "questions", id));
  toast("Question supprimee.");
}

async function doSeedQuestions() {
  const ok = await modalConfirm("Initialiser la banque", "Charge la banque de questions (theme mafia/gang). Re-cliquer met a jour sans doublon.", {});
  if (!ok) return;
  const n = await seedQuestions();
  toast(`${n} questions chargees.`, "success");
}

// =====================================================================
// MODE REGLES DU JEU (editeur GM)
// =====================================================================
async function renderRulesAdmin() {
  const wrap = document.getElementById("mode-rules");
  wrap.innerHTML = `
    <div class="card">
      <div class="card-head"><h3>Regles du jeu (visibles par les cellules)</h3>
        <button class="btn primary sm" id="rules-save">Enregistrer</button></div>
      <div class="dim tiny" style="margin-bottom:0.6rem">Ce texte s'affiche en temps reel dans l'onglet "Regles du jeu" de chaque cellule.</div>
      <textarea class="rules-edit" id="rules-text" placeholder="Ecris les regles ici..."></textarea>
    </div>`;
  const ta = document.getElementById("rules-text");
  try {
    const snap = await getDoc(doc(db, "config", "rules"));
    ta.value = snap.exists() ? (snap.data().text || "") : "";
  } catch (e) { /* ignore */ }
  document.getElementById("rules-save").addEventListener("click", async () => {
    try {
      await setDoc(doc(db, "config", "rules"), { text: ta.value, updatedAt: serverTimestamp() }, { merge: true });
      toast("Regles enregistrees et diffusees.", "success");
    } catch (e) { console.error(e); toast("Echec de l'enregistrement.", "error"); }
  });
}

// =====================================================================
// Handlers globaux (delegation clic) + chrono + lightbox
// =====================================================================
function wireGlobalHandlers() {
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const a = el.dataset.action;
    const gid = el.dataset.gid, sid = el.dataset.sid, id = el.dataset.id;
    switch (a) {
      case "select-group": selectGroup(gid); break;
      case "qty-inc": adjustQty(gid, el.dataset.obj, 1); break;
      case "qty-dec": adjustQty(gid, el.dataset.obj, -1); break;
      case "mark-complete": markComplete(gid); break;
      case "validate-sub": validateSub(gid, sid); break;
      case "reject-sub": rejectSub(gid, sid); break;
      case "del-sub": delSub(gid, sid); break;
      case "points-adj": pointsAdj(gid, parseInt(el.dataset.delta, 10)); break;
      case "points-set": pointsSet(gid); break;
      case "reveal-pass": revealPass(gid); break;
      case "regen-pass": regenPass(gid); break;
      case "del-group": delGroup(gid); break;
      case "save-identity": saveIdentity(gid); break;
      case "disqualify": disqualify(gid); break;
      case "reactivate": reactivate(gid); break;
      case "open-question": openQuestion(el.dataset.qid); break;
      case "close-question": closeQuestion(); break;
      case "credit-quiz": creditQuiz(gid); break;
      case "seed-questions": doSeedQuestions(); break;
      case "del-question": delQuestion(id); break;
      case "obj-edit": editObjective(id); break;
      case "obj-del": delObjective(id); break;
      case "seed-obj": doSeedObjectives(); break;
      case "chasse-open": openChasse(id); break;
      case "chasse-close": closeChasse(id); break;
      case "chasse-del": delChasse(id); break;
      case "seed-chasse": doSeedChasses(); break;
      case "out-del": delGroup(gid); break;
      case "out-purge": purgeOut(); break;
      case "view-img": lightbox(el.dataset.url); break;
    }
  });
  // Soumissions de formulaires gerees par delegation
  document.addEventListener("submit", (e) => {
    if (e.target.id === "obj-create-form") { e.preventDefault(); createObjective(); }
    if (e.target.id === "q-add-form") { e.preventDefault(); addQuestion(); }
  });
  // Saisie libre des quantites Manche 1 (commit sur change / Entree)
  document.addEventListener("change", (e) => {
    const el = e.target.closest("[data-action='qty-set']");
    if (el) setQty(el.dataset.gid, el.dataset.obj, parseInt(el.value, 10));
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.classList && e.target.classList.contains("qty-edit")) e.target.blur();
  });
}

async function doSeedObjectives() {
  const ok = await modalConfirm("Initialiser les objectifs", "Charge les objectifs par defaut (M1 objets + M2 photo). Les objectifs existants de meme id sont mis a jour.", {});
  if (!ok) return;
  const n = await seedObjectives();
  toast(`${n} objectifs charges.`, "success");
}
async function doSeedChasses() {
  const ok = await modalConfirm("Initialiser les chasses", "Cree 3 chasses d'exemple (Jour 2). Tu y ajouteras les photos et tu les ouvriras au bon moment.", {});
  if (!ok) return;
  const n = await seedChasses();
  toast(`${n} chasses creees.`, "success");
}

function startCountdown() {
  const tick = () => {
    const ms = remainingMs(eventCfg, Date.now());
    const el = document.getElementById("gm-chrono");
    el.textContent = formatHud(ms);
    const crit = eventCfg && eventCfg.status === EVENT_STATUS.RUNNING && ms <= 3600000 && ms > 0;
    el.classList.toggle("crit", crit);
    // rafraichit uniquement les compteurs des chasses ouvertes (sans re-render)
    document.querySelectorAll(".ch-rem").forEach((span) => {
      const c = allChasses.find((x) => x.id === span.dataset.id);
      if (c && c.closesAt) span.textContent = formatHud(Math.max(0, tsToMs(c.closesAt) - Date.now()));
    });
  };
  tick();
  setInterval(tick, 1000);
}

function lightbox(url) {
  const lb = document.createElement("div");
  lb.className = "lightbox";
  lb.innerHTML = `<img src="${escapeHtml(url)}" alt="preuve" />`;
  lb.addEventListener("click", () => lb.remove());
  document.body.appendChild(lb);
}
