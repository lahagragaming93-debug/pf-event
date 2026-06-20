// =====================================================================
// PROTOCOLE OMERTA - Application ESPACE GROUPE
// =====================================================================

import {
  db, storage, ensureAuth, currentUid,
  doc, collection, query, where, orderBy,
  onSnapshot, addDoc, serverTimestamp,
  storageRef, uploadBytes, getDownloadURL
} from "./firebase-init.js";

import { groupLogin, restoreGroupSession, groupLogout } from "./auth.js";

import {
  STATUS, STATUS_LABEL, EVENT_STATUS, SUB_STATUS, SUB_STATUS_LABEL, OBJ_TYPE,
  escapeHtml, formatHud, remainingMs, fmtDateTime, tsToMs, toast,
  wirePasteZone, enableGlobalPaste
} from "./common.js";

// --- Etat global ---------------------------------------------------------
let myGroup = null;          // { id, ...data }
let eventCfg = null;
let allObjectives = [];
let allChasses = [];
let allGroups = [];
let mySubmissions = [];
let pendingBlob = null;

let unsub = { group: null, event: null, obj: null, chasses: null, groups: null, subs: null, msgs: null };

// =====================================================================
// Boot
// =====================================================================
(async function boot() {
  await ensureAuth();
  const restored = await restoreGroupSession();
  if (restored) {
    startApp(restored.id);
  } else {
    document.getElementById("login-screen").style.display = "flex";
  }
  wireLogin();
})();

function wireLogin() {
  const form = document.getElementById("group-login-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("group-name").value;
    const pass = document.getElementById("group-pass").value;
    const btn = document.getElementById("group-login-btn");
    const err = document.getElementById("group-login-error");
    err.textContent = "";
    btn.disabled = true; btn.textContent = "Connexion...";
    try {
      const grp = await groupLogin(name, pass);
      startApp(grp.id);
    } catch (ex) {
      err.textContent = ex.message || "Echec de connexion.";
      btn.disabled = false; btn.textContent = "S'infiltrer";
    }
  });
}

// =====================================================================
// Demarrage app + listeners temps reel
// =====================================================================
function startApp(groupId) {
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("app").style.display = "flex";

  wireTabs();
  wireProof();
  wireChat();
  document.getElementById("logout-btn").addEventListener("click", groupLogout);

  // Listener doc groupe (statut OUT, points, progression)
  unsub.group = onSnapshot(doc(db, "groups", groupId), (snap) => {
    if (!snap.exists()) {
      toast("Votre cellule n'existe plus. Deconnexion.", "error");
      setTimeout(groupLogout, 1500);
      return;
    }
    myGroup = { id: snap.id, ...snap.data() };
    document.getElementById("top-group-name").textContent = myGroup.name || "";
    checkOut();
    renderObjectives();
    renderClassement();
  });

  // Config event (manche + chrono)
  unsub.event = onSnapshot(doc(db, "config", "event"), (snap) => {
    eventCfg = snap.exists() ? snap.data() : null;
    updateEventHeader();
    renderObjectives();
    renderProofSelect();
    renderChasses();
    renderClassement();
  });

  // Regles du jeu (temps reel)
  unsub.rules = onSnapshot(doc(db, "config", "rules"), (snap) => {
    const box = document.getElementById("rules-box");
    if (box) box.textContent = (snap.exists() && snap.data().text) ? snap.data().text : "Aucune regle publiee pour le moment.";
  });

  // Objectifs
  unsub.obj = onSnapshot(collection(db, "objectives"), (snap) => {
    allObjectives = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    renderObjectives();
    renderProofSelect();
  });

  // Chasses
  unsub.chasses = onSnapshot(collection(db, "chasses"), (snap) => {
    allChasses = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    renderChasses();
    renderProofSelect();
  });

  // Tous les groupes (classement)
  unsub.groups = onSnapshot(collection(db, "groups"), (snap) => {
    allGroups = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderClassement();
  });

  // Mes soumissions
  unsub.subs = onSnapshot(
    query(collection(db, "groups", groupId, "submissions"), orderBy("submittedAt", "desc")),
    (snap) => {
      mySubmissions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderGallery();
      renderObjectives();
    }
  );

  // Chat
  unsub.msgs = onSnapshot(
    query(collection(db, "groups", groupId, "messages"), orderBy("createdAt", "asc")),
    (snap) => {
      const msgs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderChat(msgs);
    }
  );

  startCountdown();
}

// =====================================================================
// Ecran OUT
// =====================================================================
function checkOut() {
  const out = myGroup && myGroup.status === STATUS.OUT;
  document.getElementById("out-screen").style.display = out ? "flex" : "none";
  document.getElementById("app").style.filter = out ? "blur(2px)" : "none";
}

// =====================================================================
// Onglets
// =====================================================================
function wireTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => activateTab(tab.dataset.view));
  });
}
function activateTab(view) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + view));
  if (view === "chat") {
    const badge = document.getElementById("badge-chat");
    if (badge) badge.style.display = "none";
  }
}

// =====================================================================
// En-tete event + chrono
// =====================================================================
function updateEventHeader() {
  const manche = eventCfg ? eventCfg.currentManche : "-";
  document.getElementById("top-manche").textContent = manche;
  const stateEl = document.getElementById("top-event-state");
  const stMap = {
    idle: ["EN ATTENTE", ""], running: ["EN COURS", "active"],
    paused: ["PAUSE", "pending"], finished: ["TERMINEE", "out"]
  };
  const st = eventCfg ? (stMap[eventCfg.status] || ["-", ""]) : ["-", ""];
  stateEl.textContent = st[0];
  stateEl.className = "badge " + st[1];
}

function startCountdown() {
  const tick = () => {
    const now = Date.now();
    const ms = remainingMs(eventCfg, now);
    const txt = formatHud(ms);
    const running = eventCfg && eventCfg.status === EVENT_STATUS.RUNNING;
    const crit = running && ms <= 3600000 && ms > 0;

    const mini = document.getElementById("mini-chrono");
    mini.textContent = txt;
    mini.classList.toggle("crit", crit);

    const hud = document.getElementById("big-hud");
    const hudTime = document.getElementById("hud-time");
    const hudLabel = document.getElementById("hud-label");
    const hudState = document.getElementById("hud-state");
    if (hudTime) hudTime.textContent = txt;
    if (hudLabel) hudLabel.textContent = "Manche " + (eventCfg ? eventCfg.currentManche : "-");
    hud.classList.toggle("crit", crit);
    if (hudState) {
      const map = { idle: "EN ATTENTE", running: "EN COURS", paused: "PAUSE", finished: "TERMINEE" };
      hudState.textContent = eventCfg ? (map[eventCfg.status] || "") : "";
      hudState.className = "state-pill badge " + (crit ? "out" : (running ? "active" : "pending"));
    }
  };
  tick();
  setInterval(tick, 1000);
}

// =====================================================================
// OBJECTIFS
// =====================================================================
function objSubsFor(objId) {
  return mySubmissions.filter((s) => s.objectiveId === objId);
}

function renderObjectives() {
  if (!eventCfg) return;
  const manche = eventCfg.currentManche;
  const list = document.getElementById("obj-list");
  const gpWrap = document.getElementById("global-progress-wrap");
  document.getElementById("obj-manche-label").textContent = "// Manche " + manche;

  const objs = allObjectives.filter((o) => o.manche === manche);
  list.innerHTML = "";
  gpWrap.innerHTML = "";

  if (objs.length === 0) {
    list.innerHTML = `<div class="list-empty">Aucun objectif publie pour cette manche.</div>`;
    return;
  }

  const countObjs = objs.filter((o) => o.type === OBJ_TYPE.COUNT);

  // Manche 1 : barre de progression globale
  if (countObjs.length > 0) {
    let totDelivered = 0, totTarget = 0, doneCount = 0;
    const prog = (myGroup && myGroup.manche1Progress) || {};
    countObjs.forEach((o) => {
      const d = Math.min(prog[o.id] || 0, o.targetQty);
      totDelivered += d; totTarget += o.targetQty;
      if ((prog[o.id] || 0) >= o.targetQty) doneCount++;
    });
    const pct = totTarget ? Math.round((totDelivered / totTarget) * 100) : 0;
    gpWrap.innerHTML = `
      <div class="global-progress">
        <div class="pct">${pct}%</div>
        <div style="flex:1">
          <div class="dim tiny up">Progression globale - ${doneCount}/${countObjs.length} objectifs valides</div>
          <div class="progress"><i style="width:${pct}%"></i></div>
        </div>
      </div>`;
    document.getElementById("obj-sub").textContent =
      "Ramenez les objets demandes. Le GM les recupere en jeu et incremente vos quantites. Tout complete = manche reussie.";
  } else {
    document.getElementById("obj-sub").textContent =
      "Realisez les objectifs photo pour marquer des points. Soumettez vos preuves dans l'onglet Soumettre.";
  }

  objs.forEach((o) => {
    if (o.type === OBJ_TYPE.COUNT) {
      const prog = (myGroup && myGroup.manche1Progress) || {};
      const delivered = prog[o.id] || 0;
      const pct = Math.min(100, Math.round((delivered / o.targetQty) * 100));
      const done = delivered >= o.targetQty;
      const el = document.createElement("div");
      el.className = "obj" + (done ? " done" : "");
      el.innerHTML = `
        <div class="obj-main">
          <div class="obj-label">${escapeHtml(o.label)} ${done ? '<span class="badge validated">OK</span>' : ""}</div>
          <div class="progress"><i style="width:${pct}%"></i></div>
        </div>
        <div class="qty">${delivered} / ${o.targetQty}</div>`;
      list.appendChild(el);
    } else if (o.type === OBJ_TYPE.PHOTO) {
      const subs = objSubsFor(o.id);
      const validated = subs.filter((s) => s.status === SUB_STATUS.VALIDATED);
      const pending = subs.filter((s) => s.status === SUB_STATUS.PENDING);
      const earned = validated.reduce((a, s) => a + (s.points || 0), 0);
      const el = document.createElement("div");
      el.className = "obj" + (validated.length ? " done" : "");
      el.innerHTML = `
        <div class="obj-main">
          <div class="obj-label">${escapeHtml(o.label)} ${o.repeatable ? '<span class="badge active">CUMULABLE</span>' : '<span class="badge">UNIQUE</span>'}</div>
          <div class="obj-meta">
            ${o.points} pts ${o.repeatable ? "par preuve validee (cumulable)" : "(une seule fois)"} -
            ${validated.length} validee(s) - ${pending.length} en attente
          </div>
        </div>
        <div class="qty">${earned} pts</div>`;
      list.appendChild(el);
    }
  });
}

// =====================================================================
// SOUMETTRE UNE PREUVE
// =====================================================================
function wireProof() {
  const zone = document.getElementById("paste-zone");
  const fileInput = document.getElementById("proof-file");
  document.getElementById("proof-file-btn").addEventListener("click", (e) => { e.stopPropagation(); fileInput.click(); });

  const onImage = (blob, dataUrl) => {
    pendingBlob = blob;
    const prev = document.getElementById("proof-preview");
    prev.src = dataUrl; prev.style.display = "block";
    document.getElementById("proof-submit").disabled = false;
    toast("Image prete a etre transmise.", "success");
  };
  wirePasteZone(zone, fileInput, onImage);
  // Collage global: si l'onglet Soumettre est actif, on capte le Ctrl+V partout
  enableGlobalPaste((blob) => {
    if (document.getElementById("view-preuve").classList.contains("active")) {
      const reader = new FileReader();
      reader.onload = () => onImage(blob, reader.result);
      reader.readAsDataURL(blob);
    }
  });

  document.getElementById("proof-clear").addEventListener("click", clearProof);
  document.getElementById("proof-submit").addEventListener("click", submitProof);
}

function clearProof() {
  pendingBlob = null;
  const prev = document.getElementById("proof-preview");
  prev.src = ""; prev.style.display = "none";
  document.getElementById("proof-submit").disabled = true;
  document.getElementById("proof-file").value = "";
}

function renderProofSelect() {
  if (!eventCfg) return;
  const sel = document.getElementById("proof-objective");
  const prev = sel.value;
  const manche = eventCfg.currentManche;
  const photoObjs = allObjectives.filter((o) => o.manche === manche && o.type === OBJ_TYPE.PHOTO);
  const openChasses = allChasses.filter((c) => c.status === "open");

  let html = "";
  if (photoObjs.length) {
    html += `<optgroup label="Objectifs photo">`;
    photoObjs.forEach((o) => { html += `<option value="obj:${o.id}">${escapeHtml(o.label)} (${o.points} pts)</option>`; });
    html += `</optgroup>`;
  }
  if (openChasses.length) {
    html += `<optgroup label="Chasses ouvertes">`;
    openChasses.forEach((c) => { html += `<option value="chasse:${c.id}">[CHASSE] ${escapeHtml(c.label)} (${c.points} pts)</option>`; });
    html += `</optgroup>`;
  }
  if (!html) html = `<option value="">Aucun objectif a soumettre pour cette manche</option>`;
  sel.innerHTML = html;
  if (prev) sel.value = prev;

  const noTarget = !photoObjs.length && !openChasses.length;
  document.getElementById("proof-submit").disabled = noTarget || !pendingBlob;
}

async function submitProof() {
  if (!pendingBlob || !myGroup) return;
  const sel = document.getElementById("proof-objective");
  const val = sel.value;
  if (!val) { toast("Selectionne un objectif.", "error"); return; }

  const btn = document.getElementById("proof-submit");
  btn.disabled = true; btn.textContent = "Transmission...";

  try {
    const [kind, id] = val.split(":");
    let payload;
    if (kind === "obj") {
      const o = allObjectives.find((x) => x.id === id);
      payload = { objectiveId: id, chasseId: null, type: OBJ_TYPE.PHOTO, label: o ? o.label : "", status: SUB_STATUS.PENDING };
    } else {
      const c = allChasses.find((x) => x.id === id);
      const now = Date.now();
      const late = c && c.closesAt ? now > tsToMs(c.closesAt) : (c && c.status !== "open");
      payload = { objectiveId: null, chasseId: id, type: OBJ_TYPE.CHASSE, label: c ? c.label : "", status: late ? SUB_STATUS.LATE : SUB_STATUS.PENDING };
    }

    // Upload Storage
    const ext = (pendingBlob.type.split("/")[1] || "png").replace("jpeg", "jpg");
    const path = `submissions/${myGroup.id}/${Date.now()}_${Math.floor(performance.now())}.${ext}`;
    const sref = storageRef(storage, path);
    await uploadBytes(sref, pendingBlob, { contentType: pendingBlob.type });
    const url = await getDownloadURL(sref);

    await addDoc(collection(db, "groups", myGroup.id, "submissions"), {
      ...payload,
      manche: eventCfg.currentManche,
      photoUrl: url,
      storagePath: path,
      points: 0,          // credite par le GM uniquement
      credited: false,
      submittedAt: serverTimestamp(),
      validatedAt: null,
      note: null
    });

    clearProof();
    toast(payload.status === SUB_STATUS.LATE ? "Transmis HORS DELAI (chasse fermee)." : "Preuve transmise. En attente de validation GM.",
      payload.status === SUB_STATUS.LATE ? "error" : "success");
  } catch (ex) {
    console.error(ex);
    toast("Echec de transmission. Reessaie.", "error");
  } finally {
    btn.textContent = "Transmettre la preuve";
    renderProofSelect();
  }
}

function renderGallery() {
  const wrap = document.getElementById("proof-gallery");
  wrap.innerHTML = "";
  if (!mySubmissions.length) {
    wrap.innerHTML = `<div class="list-empty">Aucune preuve transmise pour l'instant.</div>`;
    return;
  }
  mySubmissions.forEach((s) => {
    const el = document.createElement("div");
    el.className = "proof";
    el.innerHTML = `
      <img src="${escapeHtml(s.photoUrl)}" alt="preuve" loading="lazy" />
      <div class="proof-info">
        <div class="proof-label">${escapeHtml(s.label || "")}</div>
        <span class="badge ${s.status}">${SUB_STATUS_LABEL[s.status] || s.status}</span>
        ${s.status === SUB_STATUS.VALIDATED ? `<span class="badge validated">+${s.points || 0} pts</span>` : ""}
        <div class="tiny mute" style="margin-top:0.3rem">${fmtDateTime(tsToMs(s.submittedAt))}</div>
        ${s.note ? `<div class="tiny danger-txt">Note GM: ${escapeHtml(s.note)}</div>` : ""}
      </div>`;
    el.querySelector("img").addEventListener("click", () => lightbox(s.photoUrl));
    wrap.appendChild(el);
  });
}

// =====================================================================
// CHASSES actives
// =====================================================================
let chasseTimers = [];
function renderChasses() {
  const wrap = document.getElementById("chasse-active-wrap");
  const empty = document.getElementById("chasse-empty");
  chasseTimers.forEach(clearInterval); chasseTimers = [];
  wrap.innerHTML = "";

  const open = allChasses.filter((c) => c.status === "open");
  document.getElementById("badge-chasse").style.display = open.length ? "inline-block" : "none";
  document.getElementById("badge-chasse").textContent = open.length;

  if (!open.length) { empty.style.display = "block"; return; }
  empty.style.display = "none";

  open.forEach((c) => {
    const el = document.createElement("div");
    el.className = "chasse-banner";
    el.innerHTML = `
      ${c.photoUrl ? `<img class="ch-photo" src="${escapeHtml(c.photoUrl)}" alt="lieu" />` : ""}
      <div class="ch-body">
        <div class="ch-title"><span class="live-dot"></span>${escapeHtml(c.label)}</div>
        <div class="dim tiny up">Fenetre de chasse - ${c.points} pts</div>
        <div class="ch-timer" data-timer="${c.id}">--:--</div>
        <button class="btn danger" data-go="${c.id}" style="margin-top:0.6rem">Transmettre la photo de la rencontre</button>
      </div>`;
    wrap.appendChild(el);

    const timerEl = el.querySelector(`[data-timer="${c.id}"]`);
    const upd = () => {
      const ms = c.closesAt ? Math.max(0, tsToMs(c.closesAt) - Date.now()) : 0;
      timerEl.textContent = formatHud(ms);
      if (ms <= 0) timerEl.textContent = "FENETRE FERMEE";
    };
    upd();
    const t = setInterval(upd, 1000);
    chasseTimers.push(t);

    el.querySelector(`[data-go="${c.id}"]`).addEventListener("click", () => {
      activateTab("preuve");
      const sel = document.getElementById("proof-objective");
      sel.value = "chasse:" + c.id;
      document.getElementById("paste-zone").focus();
      toast("Colle ta photo de rencontre puis transmets.", "info");
    });
  });
}

// =====================================================================
// CHAT
// =====================================================================
function wireChat() {
  document.getElementById("chat-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("chat-input");
    const text = input.value.trim();
    if (!text || !myGroup) return;
    input.value = "";
    try {
      await addDoc(collection(db, "groups", myGroup.id, "messages"), {
        sender: "group", text, createdAt: serverTimestamp()
      });
    } catch (ex) {
      toast("Message non envoye.", "error");
      input.value = text;
    }
  });
}

let lastMsgCount = 0;
function renderChat(msgs) {
  const log = document.getElementById("chat-log");
  log.innerHTML = "";
  if (!msgs.length) {
    log.innerHTML = `<div class="list-empty">Aucun message. Ouvrez le canal avec le GM.</div>`;
  }
  msgs.forEach((m) => {
    const el = document.createElement("div");
    el.className = "msg " + (m.sender === "gm" ? "gm" : "group");
    el.innerHTML = `<span class="who-tag">${m.sender === "gm" ? "GAME MASTER" : "VOUS"}</span>
      ${escapeHtml(m.text)}
      <div class="meta">${fmtDateTime(tsToMs(m.createdAt))}</div>`;
    log.appendChild(el);
  });
  log.scrollTop = log.scrollHeight;

  // Badge non lu si on n'est pas sur l'onglet chat
  const chatActive = document.getElementById("view-chat").classList.contains("active");
  const badge = document.getElementById("badge-chat");
  if (!chatActive && msgs.length > lastMsgCount && msgs[msgs.length - 1]?.sender === "gm") {
    badge.style.display = "inline-block";
    badge.textContent = "!";
  }
  if (chatActive) badge.style.display = "none";
  lastMsgCount = msgs.length;
}

// =====================================================================
// CLASSEMENT
// =====================================================================
function groupProgressPct(g) {
  const countObjs = allObjectives.filter((o) => o.manche === 1 && o.type === OBJ_TYPE.COUNT);
  if (!countObjs.length) return 0;
  let d = 0, t = 0;
  const prog = g.manche1Progress || {};
  countObjs.forEach((o) => { d += Math.min(prog[o.id] || 0, o.targetQty); t += o.targetQty; });
  return t ? (d / t) : 0;
}

function renderClassement() {
  if (!eventCfg) return;
  const manche = eventCfg.currentManche;
  const list = document.getElementById("rank-list");
  const sub = document.getElementById("rank-sub");
  const active = allGroups.filter((g) => g.status !== STATUS.OUT);

  let ranked;
  if (manche === 1) {
    sub.textContent = "Manche 1 - tri par progression. Les 8 premiers a tout completer sont qualifies.";
    ranked = active.slice().sort((a, b) => {
      const pa = groupProgressPct(a), pb = groupProgressPct(b);
      if (pb !== pa) return pb - pa;
      const ca = tsToMs(a.completedAt) || Infinity, cb = tsToMs(b.completedAt) || Infinity;
      return ca - cb;
    });
  } else {
    sub.textContent = `Manche ${manche} - tri par points.`;
    ranked = active.slice().sort((a, b) => ((b.points?.[manche] || 0) - (a.points?.[manche] || 0)));
  }

  const cut = eventCfg.qualifyCount ? eventCfg.qualifyCount[manche] : null;
  list.innerHTML = "";
  if (!ranked.length) { list.innerHTML = `<div class="list-empty">Aucun groupe en course.</div>`; return; }

  ranked.forEach((g, i) => {
    if (cut && i === cut) {
      const cl = document.createElement("div");
      cl.className = "cut-line";
      cl.textContent = `Ligne de qualification (${cut})`;
      list.appendChild(cl);
    }
    const isMe = myGroup && g.id === myGroup.id;
    const el = document.createElement("div");
    el.className = "rank" + (cut && i < cut ? " top" : "") + (isMe ? " me" : "");
    let scoreHtml;
    if (manche === 1) {
      const pct = Math.round(groupProgressPct(g) * 100);
      scoreHtml = `<div class="micro-prog"><i style="width:${pct}%"></i></div><div class="rank-score">${pct}%</div>`;
    } else {
      scoreHtml = `<div class="rank-score">${g.points?.[manche] || 0} pts</div>`;
    }
    el.innerHTML = `
      <div class="pos">${i + 1}</div>
      <div class="rank-name">${escapeHtml(g.name)} ${(g.status === STATUS.COMPLETED || g.status === STATUS.QUALIFIED) ? '<span class="badge completed">COMPLETE</span>' : ""} ${isMe ? '<span class="badge active">VOUS</span>' : ""}</div>
      ${scoreHtml}`;
    list.appendChild(el);
  });
}

// =====================================================================
// Lightbox
// =====================================================================
function lightbox(url) {
  const lb = document.createElement("div");
  lb.className = "lightbox";
  lb.innerHTML = `<img src="${escapeHtml(url)}" alt="preuve" />`;
  lb.addEventListener("click", () => lb.remove());
  document.body.appendChild(lb);
}
