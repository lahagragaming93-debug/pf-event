// =====================================================================
// PROTOCOLE OMERTA - Helpers communs (constantes, chrono, UI, images)
// Partage par l'espace groupe et le cockpit GM.
// =====================================================================

// --- Identite de l'event -------------------------------------------------
export const EVENT_NAME = "PROTOCOLE OMERTA";
export const EVENT_CODENAME = "PF";

// --- Statuts groupe ------------------------------------------------------
export const STATUS = {
  ACTIVE: "active",
  COMPLETED: "completed",
  QUALIFIED: "qualified",
  OUT: "out"
};

export const STATUS_LABEL = {
  active: "EN COURSE",
  completed: "COMPLETE",
  qualified: "QUALIFIE",
  out: "OUT"
};

// --- Statuts manche / event ---------------------------------------------
export const EVENT_STATUS = {
  IDLE: "idle",
  RUNNING: "running",
  PAUSED: "paused",
  FINISHED: "finished"
};

// --- Statuts soumission --------------------------------------------------
export const SUB_STATUS = {
  PENDING: "pending",
  VALIDATED: "validated",
  REJECTED: "rejected",
  LATE: "late"
};

export const SUB_STATUS_LABEL = {
  pending: "EN ATTENTE",
  validated: "VALIDEE",
  rejected: "REFUSEE",
  late: "HORS DELAI"
};

// --- Types d'objectifs ---------------------------------------------------
export const OBJ_TYPE = {
  COUNT: "count",
  PHOTO: "photo",
  CHASSE: "chasse"
};

// --- Reglages par defaut de l'event -------------------------------------
export const DEFAULT_EVENT = {
  currentManche: 1,
  status: EVENT_STATUS.IDLE,
  endsAt: null,
  remainingMsAtPause: null,
  startedAt: null,
  durationHours: null,
  durationHoursByManche: { 1: 24, 2: 48, 3: 12 },
  qualifyCount: { 1: 8, 2: 4, 3: 3 }
};

// =====================================================================
// Formatage chrono
// =====================================================================
export function pad2(n) { return String(n).padStart(2, "0"); }

// Retourne {d,h,m,s,total} a partir d'un nombre de ms.
export function breakdown(ms) {
  if (ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return { d, h, m, s, total };
}

// Chaine HUD type 23:59:12 ou 1j 04:12:09
export function formatHud(ms) {
  const { d, h, m, s } = breakdown(ms);
  if (d > 0) return `${d}j ${pad2(h)}:${pad2(m)}:${pad2(s)}`;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

// Calcule le temps restant (ms) de l'event a partir du doc config/event.
export function remainingMs(eventCfg, now) {
  if (!eventCfg) return 0;
  if (eventCfg.status === EVENT_STATUS.PAUSED) {
    return Math.max(0, eventCfg.remainingMsAtPause || 0);
  }
  if (eventCfg.status === EVENT_STATUS.RUNNING && eventCfg.endsAt) {
    return Math.max(0, eventCfg.endsAt - now);
  }
  return 0;
}

// =====================================================================
// Securite affichage (anti-injection HTML)
// =====================================================================
export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// =====================================================================
// Sessions (localStorage)
// =====================================================================
const GROUP_KEY = "pf_group_session";
const ADMIN_KEY = "pf_admin_session";

export function saveGroupSession(data) {
  localStorage.setItem(GROUP_KEY, JSON.stringify(data));
}
export function getGroupSession() {
  try { return JSON.parse(localStorage.getItem(GROUP_KEY)); } catch { return null; }
}
export function clearGroupSession() { localStorage.removeItem(GROUP_KEY); }

export function saveAdminSession(data) {
  sessionStorage.setItem(ADMIN_KEY, JSON.stringify(data));
}
export function getAdminSession() {
  try { return JSON.parse(sessionStorage.getItem(ADMIN_KEY)); } catch { return null; }
}
export function clearAdminSession() { sessionStorage.removeItem(ADMIN_KEY); }

// =====================================================================
// Generateur de mot de passe (codes lisibles, ton clandestin)
// =====================================================================
export function generatePassword(len = 8) {
  // Pas de caracteres ambigus (0/O, 1/l/I)
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  for (let i = 0; i < len; i++) out += chars[arr[i] % chars.length];
  return out;
}

// =====================================================================
// Toast
// =====================================================================
let toastTimer = null;
export function toast(message, type = "info") {
  let el = document.getElementById("pf-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "pf-toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = "pf-toast show " + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = "pf-toast " + type; }, 3200);
}

// =====================================================================
// Modale generique (confirm / prompt) -> Promise
// =====================================================================
export function modalConfirm(title, body, { okLabel = "Confirmer", danger = false } = {}) {
  return new Promise((resolve) => {
    const { overlay, close } = buildModal(title, `<p class="modal-body-text">${body}</p>`, [
      { label: "Annuler", cls: "btn ghost", value: false },
      { label: okLabel, cls: "btn " + (danger ? "danger" : "primary"), value: true }
    ], resolve);
    document.body.appendChild(overlay);
  });
}

export function modalPrompt(title, { label = "Valeur", value = "", placeholder = "", okLabel = "Valider" } = {}) {
  return new Promise((resolve) => {
    const html = `
      <label class="field">
        <span>${escapeHtml(label)}</span>
        <input type="text" id="pf-modal-input" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off">
      </label>`;
    const { overlay } = buildModal(title, html, [
      { label: "Annuler", cls: "btn ghost", value: null },
      { label: okLabel, cls: "btn primary", value: "__INPUT__" }
    ], (v) => {
      if (v === "__INPUT__") {
        const input = overlay.querySelector("#pf-modal-input");
        resolve(input ? input.value : null);
      } else {
        resolve(null);
      }
    });
    document.body.appendChild(overlay);
    const input = overlay.querySelector("#pf-modal-input");
    if (input) { input.focus(); input.select(); }
  });
}

function buildModal(title, innerHtml, buttons, resolve) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const card = document.createElement("div");
  card.className = "modal-card";
  card.innerHTML = `<h3 class="modal-title">${escapeHtml(title)}</h3>
    <div class="modal-content">${innerHtml}</div>
    <div class="modal-actions"></div>`;
  const actions = card.querySelector(".modal-actions");
  const close = (val) => { overlay.remove(); resolve(val); };
  buttons.forEach((b) => {
    const btn = document.createElement("button");
    btn.className = b.cls;
    btn.textContent = b.label;
    btn.addEventListener("click", () => close(b.value));
    actions.appendChild(btn);
  });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(buttons[0].value); });
  document.addEventListener("keydown", function esc(e) {
    if (e.key === "Escape") { document.removeEventListener("keydown", esc); close(buttons[0].value); }
  });
  overlay.appendChild(card);
  return { overlay, close };
}

// =====================================================================
// Capture d'image: colle (Ctrl+V) en priorite, upload fichier en secours.
// onImage(blob, dataUrl) appele quand une image est prete.
// =====================================================================
export function wirePasteZone(zoneEl, fileInputEl, onImage) {
  const handleBlob = (blob) => {
    if (!blob || !blob.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => onImage(blob, reader.result);
    reader.readAsDataURL(blob);
  };

  // Collage clavier (capture d'ecran dans le presse-papier)
  const onPaste = (e) => {
    const items = (e.clipboardData || window.clipboardData)?.items || [];
    for (const item of items) {
      if (item.type && item.type.startsWith("image/")) {
        handleBlob(item.getAsFile());
        e.preventDefault();
        return;
      }
    }
  };
  // On ecoute sur la zone ET sur le document (le focus peut varier)
  zoneEl.addEventListener("paste", onPaste);
  zoneEl.addEventListener("click", () => zoneEl.focus());
  zoneEl.setAttribute("tabindex", "0");

  // Upload de fichier en secours
  if (fileInputEl) {
    fileInputEl.addEventListener("change", () => {
      if (fileInputEl.files && fileInputEl.files[0]) handleBlob(fileInputEl.files[0]);
    });
  }

  // Glisser-deposer aussi, tant qu'a faire
  zoneEl.addEventListener("dragover", (e) => { e.preventDefault(); zoneEl.classList.add("dragover"); });
  zoneEl.addEventListener("dragleave", () => zoneEl.classList.remove("dragover"));
  zoneEl.addEventListener("drop", (e) => {
    e.preventDefault();
    zoneEl.classList.remove("dragover");
    if (e.dataTransfer.files && e.dataTransfer.files[0]) handleBlob(e.dataTransfer.files[0]);
  });

  return { onPaste };
}

// Active le collage global pour une page (utile quand le focus n'est pas sur la zone)
export function enableGlobalPaste(onBlob) {
  document.addEventListener("paste", (e) => {
    const items = (e.clipboardData || window.clipboardData)?.items || [];
    for (const item of items) {
      if (item.type && item.type.startsWith("image/")) {
        onBlob(item.getAsFile());
        return;
      }
    }
  });
}

// =====================================================================
// Divers
// =====================================================================
export function fmtDateTime(ms) {
  if (!ms) return "-";
  const d = new Date(ms);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function tsToMs(v) {
  // Accepte un Timestamp Firestore, un number, ou null
  if (!v) return null;
  if (typeof v === "number") return v;
  if (typeof v.toMillis === "function") return v.toMillis();
  return null;
}
