// Вход по логину и паролю (Firebase) и синхронизация данных между устройствами.
//
// Как это устроено, коротко:
//  * Почта и телефон не нужны. Логин превращается в служебный адрес «логин@wayfinder.login» —
//    так Firebase устроен, пользователь этого адреса не видит.
//  * Настоящий пароль Firebase — длинный случайный секрет. Он хранится в «сейфе» (vaults/<логин>)
//    только в зашифрованном виде: один раз зашифрован паролем пользователя, другой раз — кодом
//    восстановления. Так работает и «Забыли пароль?», хотя почты нет.
//  * Данные (накопления, дела, заметки и т. д.) лежат в users/<uid>/… и доступны только владельцу.

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, deleteUser,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, deleteDoc, writeBatch, collection, getDocs, onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB9IpXy0V6m0neHn34mtgZFGMR_kEBZxNE",
  authDomain: "wayfinder-2771b.firebaseapp.com",
  projectId: "wayfinder-2771b",
  storageBucket: "wayfinder-2771b.firebasestorage.app",
  messagingSenderId: "660851395884",
  appId: "1:660851395884:web:be0e23563a87e07c7c7089",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const LOGIN_DOMAIN = "wayfinder.login";
const STATE_KEY = "wf_sync_state";
const PBKDF2_ITER = 250000;
const CHUNK = 250000;
const SYNC = window.WF_SYNC;
const SYNC_KEYS = SYNC.keys;

const NOTICE = "Мы не просим вас указывать почту или номер телефона — только логин, который вы придумаете, и пароль.";

let currentUser = null;
let applyingRemote = false;
let flowBusy = false;
let unsubscribe = null;
let pushTimer = null;
let pushing = false;
let syncStatus = { kind: "idle" };

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- Шифрование ----------
const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));
const randomBytes = n => crypto.getRandomValues(new Uint8Array(n));

async function deriveKey(secret, salt, iter) {
  const material = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" },
    material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
  );
}

async function sealSecret(plain, secret, iter) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(secret, salt, iter);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plain));
  return { salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}

async function openSecret(slot, secret, iter) {
  const key = await deriveKey(secret, unb64(slot.salt), iter);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(slot.iv) }, key, unb64(slot.ct));
  return dec.decode(plain);
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateRecoveryCode() {
  const chars = [...randomBytes(12)].map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
  return `WF-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}
const normalizeCode = code => code.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^WF/, "");
const generateSecret = () => b64(randomBytes(24)).replace(/[+/=]/g, "x");

async function buildVault(secret, password, code) {
  return {
    v: 1,
    iter: PBKDF2_ITER,
    pw: await sealSecret(secret, password, PBKDF2_ITER),
    rec: await sealSecret(secret, normalizeCode(code), PBKDF2_ITER),
  };
}

// ---------- Логин ----------
function normalizeLogin(raw) {
  return raw.trim().toLowerCase();
}
function validateLogin(login) {
  if (login.length < 3 || login.length > 24) return "Логин — от 3 до 24 символов.";
  if (!/^[a-z0-9_-]+$/.test(login)) return "В логине можно использовать только латинские буквы, цифры, «_» и «-».";
  return null;
}
const emailFor = login => `${login}@${LOGIN_DOMAIN}`;

function friendlyError(err) {
  const code = err && (err.code || err.message) || "";
  if (code.includes("email-already-in-use")) return "Этот логин уже занят — придумайте другой.";
  if (code.includes("network-request-failed")) return "Нет соединения с интернетом. Попробуйте ещё раз.";
  if (code.includes("too-many-requests")) return "Слишком много попыток. Подождите несколько минут и попробуйте снова.";
  if (code.includes("operation-not-allowed") || code.includes("configuration-not-found")) {
    return "Вход по паролю ещё не включён в Firebase (Authentication → Sign-in method → Email/Password).";
  }
  if (code.includes("permission-denied")) return "База данных не пускает запись — в Firestore нужно вставить правила безопасности.";
  if (code.includes("unavailable") || code.includes("offline")) return "Нет связи с сервером. Попробуйте ещё раз.";
  return `Не получилось: ${code || "неизвестная ошибка"}`;
}

// ---------- Локальное состояние синхронизации ----------
function loadState() {
  try { return JSON.parse(localStorage.getItem(STATE_KEY)) || {}; } catch { return {}; }
}
function saveState(state) {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

function localHasData() {
  return SYNC_KEYS.some(key => {
    if (key === "app_settings") return false;
    const raw = localStorage.getItem(key);
    return raw !== null && raw !== "[]" && raw !== "{}" && raw !== "null";
  });
}

// ---------- Запись и чтение данных в облаке ----------
const metaCol = uid => collection(db, "users", uid, "meta");

async function writeKey(key, value, ts) {
  const uid = currentUser.uid;
  const metaRef = doc(db, "users", uid, "meta", key);
  const old = (await getDoc(metaRef)).data();
  const oldCount = old && old.chunks ? old.chunks : 0;
  let count = 0;

  if (value === null) {
    await setDoc(metaRef, { updatedAt: ts, chunks: 0, deleted: true });
  } else {
    const parts = [];
    for (let i = 0; i < value.length; i += CHUNK) parts.push(value.slice(i, i + CHUNK));
    if (!parts.length) parts.push("");
    count = parts.length;
    for (let i = 0; i < parts.length; i += 8) {
      const batch = writeBatch(db);
      parts.slice(i, i + 8).forEach((text, j) => batch.set(doc(db, "users", uid, "chunks", `${key}~${i + j}`), { text }));
      await batch.commit();
    }
    await setDoc(metaRef, { updatedAt: ts, chunks: count, deleted: false });
  }
  for (let i = count; i < oldCount; i++) await deleteDoc(doc(db, "users", uid, "chunks", `${key}~${i}`));
}

async function applyRemoteKey(key, meta) {
  let text = "";
  if (!meta.deleted) {
    const reads = [];
    for (let i = 0; i < meta.chunks; i++) reads.push(getDoc(doc(db, "users", currentUser.uid, "chunks", `${key}~${i}`)));
    (await Promise.all(reads)).forEach(snap => { text += snap.exists() ? snap.data().text : ""; });
  }
  applyingRemote = true;
  try {
    if (meta.deleted) SYNC.rawRemove(key);
    else SYNC.rawSet(key, text);
  } finally {
    applyingRemote = false;
  }
  const state = loadState();
  state.synced = state.synced || {};
  state.synced[key] = meta.updatedAt;
  if (state.dirty) delete state.dirty[key];
  saveState(state);
}

function schedulePush(delay = 1500) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushDirty, delay);
}

async function pushDirty() {
  if (pushing || !currentUser) return;
  pushing = true;
  let failed = false;
  try {
    const keys = Object.keys(loadState().dirty || {});
    if (!keys.length) return;
    setStatus({ kind: "saving" });
    for (const key of keys) {
      const ts = loadState().dirty[key];
      await writeKey(key, localStorage.getItem(key), ts);
      const state = loadState();
      state.synced = state.synced || {};
      state.synced[key] = ts;
      if (state.dirty && state.dirty[key] === ts) delete state.dirty[key];
      saveState(state);
    }
    setStatus({ kind: "ok", at: Date.now() });
  } catch (err) {
    failed = true;
    setStatus({ kind: "error", message: friendlyError(err) });
  } finally {
    pushing = false;
    if (Object.keys(loadState().dirty || {}).length) schedulePush(failed ? 30000 : 1500);
  }
}

SYNC.onChange = (key, value) => {
  if (!currentUser || applyingRemote || flowBusy) return;
  const state = loadState();
  if (state.uid !== currentUser.uid) return;
  state.dirty = state.dirty || {};
  state.dirty[key] = Date.now();
  saveState(state);
  setStatus({ kind: "saving" });
  schedulePush();
};

function startListening() {
  if (unsubscribe) unsubscribe();
  unsubscribe = onSnapshot(metaCol(currentUser.uid), async snap => {
    let changed = false;
    for (const change of snap.docChanges()) {
      if (change.type === "removed" || change.doc.metadata.hasPendingWrites) continue;
      const key = change.doc.id;
      if (!SYNC_KEYS.includes(key)) continue;
      const meta = change.doc.data();
      const state = loadState();
      const synced = (state.synced && state.synced[key]) || 0;
      const dirtyTs = (state.dirty && state.dirty[key]) || 0;
      if (meta.updatedAt <= synced) continue;           // это мы уже получили
      if (dirtyTs && dirtyTs >= meta.updatedAt) continue; // у нас свежее
      try {
        await applyRemoteKey(key, meta);
        changed = true;
      } catch (err) {
        setStatus({ kind: "error", message: friendlyError(err) });
      }
    }
    if (changed) {
      if (typeof window.wfApplyRemoteData === "function") window.wfApplyRemoteData();
      setStatus({ kind: "ok", at: Date.now() });
    }
  }, err => setStatus({ kind: "error", message: friendlyError(err) }));
  // Если что-то осталось несохранённым с прошлого раза
  schedulePush(500);
}

function stopListening() {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  clearTimeout(pushTimer);
}

// ---------- Первый вход: что делать с данными этого браузера ----------
async function firstSync(user) {
  const snap = await getDocs(metaCol(user.uid));
  const remote = {};
  snap.forEach(d => { if (SYNC_KEYS.includes(d.id) && !d.data().deleted) remote[d.id] = d.data(); });
  const hasRemote = Object.keys(remote).some(key => key !== "app_settings");
  const hasLocal = localHasData();
  saveState({ uid: user.uid, synced: {}, dirty: {} });

  let choice = "cloud";
  if (hasLocal && !hasRemote) choice = await askChoice("upload");
  else if (hasLocal && hasRemote) choice = await askChoice("both");
  if (choice === "cancel") return false;

  if (choice === "local") {
    const state = loadState();
    const now = Date.now();
    SYNC_KEYS.forEach(key => { if (localStorage.getItem(key) !== null) state.dirty[key] = now; });
    // «Заменить данные аккаунта»: того, чего нет у нас, не должно остаться и в облаке
    Object.keys(remote).forEach(key => { if (localStorage.getItem(key) === null) state.dirty[key] = now; });
    saveState(state);
    await pushDirty();
  } else {
    if (choice === "fresh" || hasRemote || Object.keys(remote).length) {
      applyingRemote = true;
      try { SYNC_KEYS.forEach(key => SYNC.rawRemove(key)); } finally { applyingRemote = false; }
    }
    for (const [key, meta] of Object.entries(remote)) await applyRemoteKey(key, meta);
    if (typeof window.wfApplyRemoteData === "function") window.wfApplyRemoteData();
  }
  return true;
}

// ---------- Окно ----------
let overlay;
let body;
let currentView = "login";
let pendingChoice = null;

function openModal(view) {
  overlay.classList.add("open");
  // Пока человек должен сделать выбор или сохранить код — не подменяем окно
  if (!view && (pendingChoice || (currentView === "code" && pendingAfterCode))) return;
  render(view || (currentUser ? "account" : "login"));
}
function closeModal() {
  overlay.classList.remove("open");
}

function askChoice(kind) {
  return new Promise(resolve => {
    pendingChoice = resolve;
    openModal(kind === "upload" ? "choiceUpload" : "choiceBoth");
  });
}
function answerChoice(value) {
  if (pendingChoice) {
    const resolve = pendingChoice;
    pendingChoice = null;
    resolve(value);
  }
}

function passwordField(id, label, autocomplete) {
  return `
    <div class="auth-field">
      <label for="${id}">${label}</label>
      <div class="auth-pass">
        <input type="password" id="${id}" autocomplete="${autocomplete}" required>
        <button type="button" class="auth-eye" data-act="eye" data-for="${id}" title="Показать или скрыть пароль" tabindex="-1">👁</button>
      </div>
    </div>`;
}

const VIEWS = {
  login: () => ({
    title: "Вход",
    html: `
      <p class="auth-notice">${NOTICE}</p>
      <form class="auth-form" data-form="login" novalidate>
        <div class="auth-field"><label for="authLogin">Логин</label>
          <input type="text" id="authLogin" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="24"></div>
        ${passwordField("authPass", "Пароль", "current-password")}
        <div class="auth-error" id="authError"></div>
        <button type="submit" class="auth-submit">Войти</button>
      </form>
      <div class="auth-links">
        <button type="button" data-act="view" data-view="recover">Забыли пароль?</button>
        <button type="button" data-act="view" data-view="register">Нет аккаунта? Зарегистрироваться</button>
      </div>
      <p class="auth-foot">Без входа сайтом можно пользоваться как обычно — данные хранятся только в этом браузере.</p>`,
  }),

  register: () => ({
    title: "Регистрация",
    html: `
      <p class="auth-notice">${NOTICE}</p>
      <form class="auth-form" data-form="register" novalidate>
        <div class="auth-field"><label for="authLogin">Придумайте логин</label>
          <input type="text" id="authLogin" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="24" placeholder="Напр. aytugan_2026">
          <span class="auth-hint">3–24 символа: латинские буквы, цифры, «_» и «-»</span></div>
        ${passwordField("authPass", "Пароль (не короче 8 символов)", "new-password")}
        ${passwordField("authPass2", "Повторите пароль", "new-password")}
        <div class="auth-error" id="authError"></div>
        <button type="submit" class="auth-submit">Создать аккаунт</button>
      </form>
      <p class="auth-foot">После регистрации вы получите <b>код восстановления</b>. Почты у нас нет, поэтому он — единственный способ вернуть доступ, если забудете пароль.</p>
      <div class="auth-links"><button type="button" data-act="view" data-view="login">Уже есть аккаунт? Войти</button></div>`,
  }),

  recover: () => ({
    title: "Восстановление пароля",
    html: `
      <p class="auth-notice">${NOTICE}</p>
      <p class="auth-foot">Введите логин и код восстановления, который вы получили при регистрации (вида WF-XXXX-XXXX-XXXX).</p>
      <form class="auth-form" data-form="recover" novalidate>
        <div class="auth-field"><label for="authLogin">Логин</label>
          <input type="text" id="authLogin" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="24"></div>
        <div class="auth-field"><label for="authCode">Код восстановления</label>
          <input type="text" id="authCode" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="WF-XXXX-XXXX-XXXX"></div>
        ${passwordField("authPass", "Новый пароль (не короче 8 символов)", "new-password")}
        ${passwordField("authPass2", "Повторите новый пароль", "new-password")}
        <div class="auth-error" id="authError"></div>
        <button type="submit" class="auth-submit">Сменить пароль и войти</button>
      </form>
      <div class="auth-links"><button type="button" data-act="view" data-view="login">← Назад ко входу</button></div>`,
  }),

  code: data => ({
    title: "Код восстановления",
    html: `
      <p class="auth-foot">Сохраните этот код. Он покажется <b>только один раз</b>. Если забудете пароль и потеряете код, вернуть аккаунт будет невозможно.</p>
      <div class="auth-code" id="authCodeBox">${esc(data.code)}</div>
      <div class="auth-code-actions">
        <button type="button" class="secondary-btn" data-act="copy-code">Скопировать</button>
        <button type="button" class="secondary-btn" data-act="save-code">Скачать файлом</button>
      </div>
      <label class="auth-check"><input type="checkbox" id="authCodeSaved"> Я сохранил код в надёжном месте</label>
      <div class="auth-error" id="authError"></div>
      <button type="button" class="auth-submit" data-act="code-continue" disabled id="authCodeContinue">Продолжить</button>`,
  }),

  choiceUpload: () => ({
    title: "Данные этого браузера",
    html: `
      <p class="auth-foot">Вы уже пользовались сайтом, и на этом устройстве есть накопления, дела или заметки. Перенести их в аккаунт?</p>
      <div class="auth-choices">
        <button type="button" class="auth-submit" data-act="choice" data-value="local">Да, перенести в аккаунт</button>
        <button type="button" class="secondary-btn" data-act="choice" data-value="fresh">Нет, начать с пустого аккаунта</button>
        <button type="button" class="auth-link-btn" data-act="choice" data-value="cancel">Отмена (выйти)</button>
      </div>
      <p class="auth-hint">Если выбрать «начать с пустого», данные этого браузера будут удалены с этого устройства. Сначала можно сделать резервную копию в Настройках.</p>`,
  }),

  choiceBoth: () => ({
    title: "Данные в аккаунте",
    html: `
      <p class="auth-foot">В аккаунте уже есть данные, и на этом устройстве тоже. Что оставить?</p>
      <div class="auth-choices">
        <button type="button" class="auth-submit" data-act="choice" data-value="cloud">Взять данные из аккаунта</button>
        <button type="button" class="secondary-btn" data-act="choice" data-value="local">Заменить данные аккаунта данными этого браузера</button>
        <button type="button" class="auth-link-btn" data-act="choice" data-value="cancel">Отмена (выйти)</button>
      </div>
      <p class="auth-hint">Второй вариант полностью заменит данные в аккаунте, а первый — данные на этом устройстве. Вернуть удалённое можно только из резервной копии.</p>`,
  }),

  account: () => ({
    title: "Аккаунт",
    html: `
      <div class="auth-account">
        <div class="auth-avatar">${esc(accountLogin().slice(0, 1).toUpperCase())}</div>
        <div><div class="auth-account-login">${esc(accountLogin())}</div>
          <div class="auth-hint" id="authSyncLine">${esc(statusText())}</div></div>
      </div>
      <p class="auth-foot">Ваши накопления, дела, заметки, избранное и портфель сохраняются в аккаунте и появляются на всех устройствах, где вы войдёте.</p>
      <div class="auth-choices">
        <button type="button" class="secondary-btn" data-act="view" data-view="changepass">Сменить пароль</button>
        <button type="button" class="secondary-btn" data-act="view" data-view="newcode">Получить новый код восстановления</button>
        <button type="button" class="secondary-btn" data-act="view" data-view="logout">Выйти</button>
      </div>`,
  }),

  changepass: () => ({
    title: "Смена пароля",
    html: `
      <form class="auth-form" data-form="changepass" novalidate>
        ${passwordField("authPassOld", "Текущий пароль", "current-password")}
        ${passwordField("authPass", "Новый пароль (не короче 8 символов)", "new-password")}
        ${passwordField("authPass2", "Повторите новый пароль", "new-password")}
        <div class="auth-error" id="authError"></div>
        <button type="submit" class="auth-submit">Сменить пароль</button>
      </form>
      <div class="auth-links"><button type="button" data-act="view" data-view="account">← Назад</button></div>`,
  }),

  newcode: () => ({
    title: "Новый код восстановления",
    html: `
      <p class="auth-foot">Старый код перестанет работать. Для подтверждения введите текущий пароль.</p>
      <form class="auth-form" data-form="newcode" novalidate>
        ${passwordField("authPassOld", "Текущий пароль", "current-password")}
        <div class="auth-error" id="authError"></div>
        <button type="submit" class="auth-submit">Получить новый код</button>
      </form>
      <div class="auth-links"><button type="button" data-act="view" data-view="account">← Назад</button></div>`,
  }),

  logout: () => ({
    title: "Выход",
    html: `
      <p class="auth-foot">Ваши данные останутся в аккаунте — после входа на любом устройстве они вернутся.</p>
      <label class="auth-check"><input type="checkbox" id="authWipe" checked> Удалить данные с этого устройства (рекомендуется на чужом компьютере)</label>
      <div class="auth-error" id="authError"></div>
      <div class="auth-choices">
        <button type="button" class="auth-submit" data-act="do-logout">Выйти</button>
        <button type="button" class="auth-link-btn" data-act="view" data-view="account">Отмена</button>
      </div>`,
  }),
};

function render(view, data) {
  currentView = view;
  const { title, html } = VIEWS[view](data || {});
  $("authTitle").textContent = title;
  body.innerHTML = html;
  const first = body.querySelector("input:not([type=checkbox])");
  if (first) setTimeout(() => first.focus(), 50);
}

const accountLogin = () => (currentUser && currentUser.email ? currentUser.email.split("@")[0] : "");

function setBusy(form, busy) {
  const btn = form.querySelector(".auth-submit");
  if (btn) {
    btn.disabled = busy;
    btn.dataset.label = btn.dataset.label || btn.textContent;
    btn.textContent = busy ? "Подождите…" : btn.dataset.label;
  }
}
function showError(message) {
  const el = $("authError");
  if (el) el.textContent = message || "";
}

// ---------- Действия ----------
async function fetchVault(login) {
  const snap = await getDoc(doc(db, "vaults", login));
  return snap.exists() ? snap.data() : null;
}

async function finishSignIn(user, isNew) {
  currentUser = user;
  const proceed = await firstSync(user);
  if (!proceed) {
    await signOut(auth);
    currentUser = null;
    updateUi();
    closeModal();
    return;
  }
  startListening();
  updateUi();
  setStatus({ kind: "ok", at: Date.now() });
  if (isNew) render("account");
  else closeModal();
}

async function doLogin(login, password) {
  const vault = await fetchVault(login);
  let secret = null;
  if (vault) {
    try { secret = await openSecret(vault.pw, password, vault.iter || PBKDF2_ITER); } catch { secret = null; }
  }
  if (!secret) throw Object.assign(new Error("bad"), { code: "wf/bad-credentials" });
  const cred = await signInWithEmailAndPassword(auth, emailFor(login), secret);
  return cred.user;
}

async function doRegister(login, password) {
  const secret = generateSecret();
  const code = generateRecoveryCode();
  const vault = await buildVault(secret, password, code);
  const cred = await createUserWithEmailAndPassword(auth, emailFor(login), secret);
  try {
    await setDoc(doc(db, "vaults", login), vault);
  } catch (err) {
    try { await deleteUser(cred.user); } catch { /* ничего */ }
    throw err;
  }
  return { user: cred.user, code };
}

async function handleSubmit(form) {
  const kind = form.dataset.form;
  const val = id => (form.querySelector(`#${id}`) ? form.querySelector(`#${id}`).value : "");
  showError("");
  setBusy(form, true);
  flowBusy = true;
  try {
    if (kind === "login") {
      const login = normalizeLogin(val("authLogin"));
      const password = val("authPass");
      if (!login || !password) return showError("Введите логин и пароль.");
      let user;
      try {
        user = await doLogin(login, password);
      } catch (err) {
        if (err.code === "wf/bad-credentials" || (err.code || "").includes("invalid-credential") || (err.code || "").includes("user-not-found")) {
          return showError("Неверный логин или пароль.");
        }
        throw err;
      }
      flowBusy = false;
      await finishSignIn(user, false);
    } else if (kind === "register") {
      const login = normalizeLogin(val("authLogin"));
      const password = val("authPass");
      const problem = validateLogin(login);
      if (problem) return showError(problem);
      if (password.length < 8) return showError("Пароль — не короче 8 символов.");
      if (password !== val("authPass2")) return showError("Пароли не совпадают.");
      const { user, code } = await doRegister(login, password);
      pendingAfterCode = { user, isNew: true };
      render("code", { code });
    } else if (kind === "recover") {
      const login = normalizeLogin(val("authLogin"));
      const code = val("authCode");
      const password = val("authPass");
      if (!login || !normalizeCode(code)) return showError("Введите логин и код восстановления.");
      if (password.length < 8) return showError("Новый пароль — не короче 8 символов.");
      if (password !== val("authPass2")) return showError("Пароли не совпадают.");
      const vault = await fetchVault(login);
      let secret = null;
      if (vault) {
        try { secret = await openSecret(vault.rec, normalizeCode(code), vault.iter || PBKDF2_ITER); } catch { secret = null; }
      }
      if (!secret) return showError("Логин или код восстановления не подошли. Проверьте, что код введён без ошибок.");
      const cred = await signInWithEmailAndPassword(auth, emailFor(login), secret);
      const newCode = generateRecoveryCode();
      await setDoc(doc(db, "vaults", login), await buildVault(secret, password, newCode));
      pendingAfterCode = { user: cred.user, isNew: false };
      render("code", { code: newCode });
    } else if (kind === "changepass") {
      const password = val("authPass");
      if (password.length < 8) return showError("Новый пароль — не короче 8 символов.");
      if (password !== val("authPass2")) return showError("Пароли не совпадают.");
      const login = accountLogin();
      const vault = await fetchVault(login);
      let secret = null;
      try { secret = await openSecret(vault.pw, val("authPassOld"), vault.iter || PBKDF2_ITER); } catch { secret = null; }
      if (!secret) return showError("Текущий пароль неверный.");
      await setDoc(doc(db, "vaults", login), { ...vault, iter: PBKDF2_ITER, pw: await sealSecret(secret, password, PBKDF2_ITER) });
      render("account");
      const line = $("authSyncLine");
      if (line) line.textContent = "Пароль изменён.";
    } else if (kind === "newcode") {
      const login = accountLogin();
      const vault = await fetchVault(login);
      let secret = null;
      try { secret = await openSecret(vault.pw, val("authPassOld"), vault.iter || PBKDF2_ITER); } catch { secret = null; }
      if (!secret) return showError("Текущий пароль неверный.");
      const newCode = generateRecoveryCode();
      await setDoc(doc(db, "vaults", login), { ...vault, iter: PBKDF2_ITER, rec: await sealSecret(secret, normalizeCode(newCode), PBKDF2_ITER) });
      pendingAfterCode = { user: currentUser, isNew: false, back: "account" };
      render("code", { code: newCode });
    }
  } catch (err) {
    showError(friendlyError(err));
  } finally {
    flowBusy = false;
    setBusy(form, false);
  }
}

let pendingAfterCode = null;

async function doLogout() {
  const wipe = $("authWipe") && $("authWipe").checked;
  showError("");
  try {
    if (Object.keys(loadState().dirty || {}).length) {
      pushing = false;
      await pushDirty();
      if (Object.keys(loadState().dirty || {}).length) {
        return showError("Не удалось сохранить последние изменения в аккаунт. Проверьте интернет и попробуйте снова.");
      }
    }
    stopListening();
    if (wipe) {
      applyingRemote = true;
      try { SYNC_KEYS.forEach(key => SYNC.rawRemove(key)); } finally { applyingRemote = false; }
    }
    localStorage.removeItem(STATE_KEY);
    await signOut(auth);
    location.reload();
  } catch (err) {
    showError(friendlyError(err));
  }
}

// ---------- Статус и кнопки ----------
function statusText() {
  const s = syncStatus;
  if (s.kind === "saving") return "Сохраняю изменения…";
  if (s.kind === "error") return s.message || "Не удалось синхронизировать.";
  if (s.kind === "ok") return `Синхронизировано в ${new Date(s.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
  return "Данные синхронизируются между устройствами.";
}

function setStatus(status) {
  syncStatus = status;
  const el = $("accountSyncStatus");
  if (el) {
    el.textContent = currentUser ? statusText() : "";
    el.classList.toggle("settings-warning-text", status.kind === "error");
  }
  const line = $("authSyncLine");
  if (line) line.textContent = statusText();
}

function updateUi() {
  const login = accountLogin();
  const btn = $("cornerAccountBtn");
  btn.classList.toggle("signed-in", !!currentUser);
  btn.title = currentUser ? `Аккаунт: ${login}` : "Войти в аккаунт";
  $("cornerAccountInitial").textContent = currentUser ? login.slice(0, 1).toUpperCase() : "";
  $("accountSettingsText").textContent = currentUser
    ? `Вы вошли как «${login}». Данные сохраняются в аккаунте и доступны на всех ваших устройствах.`
    : "Войдите, чтобы ваши накопления, дела и заметки были на всех устройствах. Нужны только логин и пароль — без почты и телефона.";
  $("accountSettingsBtn").textContent = currentUser ? "Открыть аккаунт" : "Войти или зарегистрироваться";
  setStatus(syncStatus);
}

function init() {
  overlay = $("authOverlay");
  body = $("authBody");

  $("cornerAccountBtn").addEventListener("click", () => openModal());
  $("accountSettingsBtn").addEventListener("click", () => openModal());
  $("authCloseBtn").addEventListener("click", () => {
    if (pendingChoice) answerChoice("cancel");
    else if (currentView === "code" && pendingAfterCode) return; // код нужно сохранить
    closeModal();
  });
  overlay.addEventListener("click", e => {
    if (e.target === overlay && !["code", "choiceUpload", "choiceBoth"].includes(currentView)) closeModal();
  });

  body.addEventListener("submit", e => {
    e.preventDefault();
    handleSubmit(e.target);
  });

  body.addEventListener("input", e => {
    if (e.target.id === "authCodeSaved") $("authCodeContinue").disabled = !e.target.checked;
  });

  body.addEventListener("click", async e => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "view") render(btn.dataset.view);
    else if (act === "eye") {
      const input = $(btn.dataset.for);
      input.type = input.type === "password" ? "text" : "password";
    } else if (act === "copy-code") {
      const text = $("authCodeBox").textContent;
      try { await navigator.clipboard.writeText(text); btn.textContent = "Скопировано ✓"; } catch { btn.textContent = "Выделите и скопируйте вручную"; }
    } else if (act === "save-code") {
      const blob = new Blob([`Wayfinder — код восстановления\nЛогин: ${accountLogin() || ""}\nКод: ${$("authCodeBox").textContent}\n`], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "wayfinder-recovery-code.txt";
      a.click();
      URL.revokeObjectURL(url);
    } else if (act === "code-continue") {
      const next = pendingAfterCode;
      pendingAfterCode = null;
      if (next && next.back) render(next.back);
      else if (next) {
        flowBusy = false;
        try { await finishSignIn(next.user, next.isNew); } catch (err) { showError(friendlyError(err)); }
      }
    } else if (act === "choice") answerChoice(btn.dataset.value);
    else if (act === "do-logout") doLogout();
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && overlay.classList.contains("open") && !["code", "choiceUpload", "choiceBoth"].includes(currentView)) closeModal();
  });

  // Уже вошедший человек (сессия сохраняется в браузере)
  onAuthStateChanged(auth, user => {
    if (flowBusy || (user && currentUser && user.uid === currentUser.uid)) return;
    if (!user) {
      currentUser = null;
      updateUi();
      return;
    }
    currentUser = user;
    const state = loadState();
    if (state.uid === user.uid) {
      startListening();
    } else {
      firstSync(user).then(ok => {
        if (ok) startListening();
        else signOut(auth);
      }).catch(err => setStatus({ kind: "error", message: friendlyError(err) }));
    }
    updateUi();
  });

  // Закрыли вкладку — стараемся отправить последние изменения
  window.addEventListener("pagehide", () => { if (currentUser && Object.keys(loadState().dirty || {}).length) pushDirty(); });
  window.addEventListener("online", () => { if (currentUser) schedulePush(500); });
}

window.WFAuth = { open: openModal, _crypto: { buildVault, openSecret, generateRecoveryCode, normalizeCode, generateSecret, PBKDF2_ITER } };
init();
