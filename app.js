// ---------- Ограничение времени запросов ----------
// Если источник завис (бывает у Мосбиржи и ЦБ), вкладка не должна ждать вечно:
// любой запрос без своего signal обрывается через 10 секунд, и сайт показывает то, что есть
if (window.AbortSignal && AbortSignal.timeout) {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) =>
    init.signal ? nativeFetch(input, init) : nativeFetch(input, { ...init, signal: AbortSignal.timeout(10000) });
}

// ---------- Источник данных: живой server.py или папка data/ ----------
// В интернете (GitHub Pages) server.py нет: данные лежат в data/*.json, облако
// обновляет их каждые 5 минут, а открытые вкладки подхватывают их без перезагрузки.
const IS_HOSTED = location.protocol.startsWith("http") && !["localhost", "127.0.0.1"].includes(location.hostname);
const STATIC_GLOBALS = {
  study: "STUDY_NEWS", stocks: "STOCKS_DATA", commodities: "COMMODITIES_DATA", indices: "INDICES_DATA",
  rates: "RATES_DATA", events: "EVENTS_DATA", news: "NEWS_DATA", quotes: "QUOTES_DATA",
};

// Номер минуты в адресе обходит кэш браузера и CDN: не чаще одного запроса в минуту на файл
function freshUrl(path) {
  return `${path}?t=${Math.floor(Date.now() / 60000)}`;
}

async function loadStaticData(name) {
  if (location.protocol.startsWith("http")) {
    try {
      const res = await fetch(freshUrl(`data/${name}.json`));
      if (res.ok) {
        const data = await res.json();
        if (STATIC_GLOBALS[name]) window[STATIC_GLOBALS[name]] = data;
        return data;
      }
    } catch { /* файла нет — берём то, что загрузилось вместе со страницей */ }
  }
  return window[STATIC_GLOBALS[name]] || null;
}

// Подпись для данных, пришедших не напрямую с server.py
function staticDataNote(data, what) {
  const time = data && data.updatedAt ? formatQuoteTime(new Date(data.updatedAt)) : "неизвестно";
  return IS_HOSTED
    ? `${what} на ${time} · автообновление каждые 5 минут`
    : `${what} из сохранённого файла (${time}) — запустите server.py для свежих`;
}

const SERVER_HINT = IS_HOSTED ? "" : " Запустите server.py.";

// В интернете server.py нет — не ждём заведомо пустой ответ, а сразу берём данные из data/
function apiFetch(url) {
  return IS_HOSTED ? Promise.reject(new Error("no server")) : fetch(url);
}

// ---------- Settings (дата/часовой пояс) ----------
const SETTINGS_KEY = "app_settings";

const FALLBACK_TIMEZONES = [
  "Europe/Moscow", "Europe/Kaliningrad", "Europe/Samara", "Europe/London", "Europe/Paris",
  "Europe/Berlin", "Europe/Madrid", "Europe/Rome", "Europe/Kyiv", "Europe/Minsk",
  "Europe/Istanbul", "Europe/Warsaw", "Europe/Amsterdam", "Europe/Lisbon",
  "Asia/Almaty", "Asia/Astana", "Asia/Aqtobe", "Asia/Tashkent", "Asia/Bishkek",
  "Asia/Dushanbe", "Asia/Ashgabat", "Asia/Baku", "Asia/Yerevan", "Asia/Tbilisi",
  "Asia/Dubai", "Asia/Tehran", "Asia/Jerusalem", "Asia/Riyadh",
  "Asia/Yekaterinburg", "Asia/Omsk", "Asia/Novosibirsk", "Asia/Krasnoyarsk",
  "Asia/Irkutsk", "Asia/Yakutsk", "Asia/Vladivostok", "Asia/Magadan",
  "Asia/Kamchatka", "Asia/Shanghai", "Asia/Hong_Kong", "Asia/Tokyo", "Asia/Seoul",
  "Asia/Singapore", "Asia/Bangkok", "Asia/Jakarta", "Asia/Kolkata", "Asia/Karachi",
  "Asia/Dhaka", "Asia/Manila",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Sao_Paulo", "America/Mexico_City", "America/Toronto", "America/Argentina/Buenos_Aires",
  "Africa/Cairo", "Africa/Johannesburg", "Africa/Lagos", "Africa/Nairobi",
  "Australia/Sydney", "Australia/Perth", "Pacific/Auckland",
];

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

let appSettings = loadSettings();
if (!appSettings.timezoneMode) appSettings.timezoneMode = "auto";
if (!appSettings.theme) appSettings.theme = "dark";

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

applyTheme(appSettings.theme);

const THEME_ICONS = {
  sun: `<svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="3.5" stroke="currentColor" stroke-width="1.5"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.8 4.8l1.4 1.4M13.8 13.8l1.4 1.4M4.8 15.2l1.4-1.4M13.8 6.2l1.4-1.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  moon: `<svg viewBox="0 0 20 20" fill="none"><path d="M15.5 12.5A6.5 6.5 0 1 1 7.5 4.2a5.2 5.2 0 1 0 8 8.3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
};

function setAppTheme(theme) {
  appSettings.theme = theme;
  saveSettings(appSettings);
  applyTheme(theme);

  const darkRadio = document.getElementById("themeModeDark");
  const lightRadio = document.getElementById("themeModeLight");
  if (darkRadio && lightRadio) {
    darkRadio.checked = theme === "dark";
    lightRadio.checked = theme === "light";
  }

  const themeBtn = document.getElementById("cornerThemeBtn");
  if (themeBtn) themeBtn.innerHTML = theme === "dark" ? THEME_ICONS.moon : THEME_ICONS.sun;
}

function getTimezoneList() {
  try {
    if (typeof Intl.supportedValuesOf === "function") {
      return Intl.supportedValuesOf("timeZone");
    }
  } catch {
    // ignore, use fallback below
  }
  return FALLBACK_TIMEZONES;
}

function initSettingsPage() {
  const autoRadio = document.getElementById("tzModeAuto");
  const manualRadio = document.getElementById("tzModeManual");
  const tzSelect = document.getElementById("timezoneSelect");
  const systemTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  getTimezoneList().forEach(zone => {
    const opt = document.createElement("option");
    opt.value = zone;
    opt.textContent = zone.replace(/_/g, " ");
    tzSelect.appendChild(opt);
  });

  tzSelect.value = appSettings.timezone || systemTz;
  if (appSettings.timezoneMode === "manual") {
    manualRadio.checked = true;
    tzSelect.disabled = false;
  } else {
    autoRadio.checked = true;
    tzSelect.disabled = true;
  }

  function applyMode(mode) {
    appSettings.timezoneMode = mode;
    tzSelect.disabled = mode !== "manual";
    saveSettings(appSettings);
    updateSidebarClock();
  }

  autoRadio.addEventListener("change", () => applyMode("auto"));
  manualRadio.addEventListener("change", () => applyMode("manual"));

  tzSelect.addEventListener("change", () => {
    appSettings.timezone = tzSelect.value;
    saveSettings(appSettings);
    updateSidebarClock();
  });

  // ---- Тема оформления ----
  const darkRadio = document.getElementById("themeModeDark");
  const lightRadio = document.getElementById("themeModeLight");

  if (appSettings.theme === "light") {
    lightRadio.checked = true;
  } else {
    darkRadio.checked = true;
  }

  darkRadio.addEventListener("change", () => setAppTheme("dark"));
  lightRadio.addEventListener("change", () => setAppTheme("light"));
}

// ---------- Sidebar clock ----------
function updateSidebarClock() {
  const now = new Date();
  const timeEl = document.getElementById("sidebarClockTime");
  const dateEl = document.getElementById("sidebarClockDate");
  const previewEl = document.getElementById("settingsClockPreview");
  const homeTimeEl = document.getElementById("homeClockTime");
  const homeDateEl = document.getElementById("homeClockDate");

  const timeOpts = { hour: "2-digit", minute: "2-digit", second: "2-digit" };
  const dateOpts = { weekday: "long", day: "numeric", month: "long" };

  if (appSettings.timezoneMode === "manual" && appSettings.timezone) {
    timeOpts.timeZone = appSettings.timezone;
    dateOpts.timeZone = appSettings.timezone;
  }

  const timeStr = now.toLocaleTimeString("ru-RU", timeOpts);
  const dateStr = now.toLocaleDateString("ru-RU", dateOpts);

  if (timeEl) timeEl.textContent = timeStr;
  if (dateEl) dateEl.textContent = dateStr;
  if (previewEl) previewEl.textContent = `Сейчас: ${timeStr}, ${dateStr}`;
  if (homeTimeEl) homeTimeEl.textContent = timeStr;
  if (homeDateEl) homeDateEl.textContent = dateStr;
}

updateSidebarClock();
setInterval(updateSidebarClock, 1000);
initSettingsPage();
initWeatherSettings();
initNotificationsSettings();
initBackupSettings();

document.getElementById("cornerThemeBtn").innerHTML =
  appSettings.theme === "dark" ? THEME_ICONS.moon : THEME_ICONS.sun;
document.getElementById("cornerThemeBtn").addEventListener("click", () => {
  setAppTheme(appSettings.theme === "dark" ? "light" : "dark");
});

document.getElementById("cornerSettingsBtn").addEventListener("click", () => {
  document.querySelector('[data-tab="settings"]').click();
});

// ---------- Home dashboard ----------
function getGreeting() {
  const h = new Date().getHours();
  if (h < 6) return "Доброй ночи";
  if (h < 12) return "Доброе утро";
  if (h < 18) return "Добрый день";
  return "Добрый вечер";
}

function renderHomeGreeting() {
  const el = document.getElementById("homeGreetingText");
  if (el) el.textContent = `${getGreeting()}! 👋`;
}

function renderHomeCalendar() {
  const container = document.getElementById("homeCalendar");
  if (!container) return;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = toDateKey(now);
  const taskDates = new Set(loadTasks().filter(t => t.date).map(t => t.date));

  let html = `<div class="home-calendar-header">${RU_MONTHS[month]} ${year}</div><div class="home-calendar-grid">`;
  RU_WEEKDAYS_SHORT.forEach(w => { html += `<div class="home-calendar-dow">${w}</div>`; });
  for (let i = 0; i < startOffset; i++) html += `<div></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const key = toDateKey(new Date(year, month, d));
    const classes = ["home-calendar-day"];
    if (key === todayKey) classes.push("today");
    if (taskDates.has(key)) classes.push("has-task");
    html += `<div class="${classes.join(" ")}" data-date="${key}">${d}</div>`;
  }
  html += `</div>`;
  container.innerHTML = html;
}

// ---------- Модалка дня (клик по дате в календаре на Главной) ----------
let dayModalDate = null;

function formatDayModalTitle(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const str = date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", weekday: "long" });
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function renderDayModalList() {
  const listEl = document.getElementById("dayModalList");
  const tasks = loadTasks().filter(t => t.date === dayModalDate);

  if (tasks.length === 0) {
    listEl.innerHTML = `<div class="empty-hint">На этот день пока ничего не запланировано</div>`;
    return;
  }

  listEl.innerHTML = "";
  tasks.forEach(task => {
    const row = document.createElement("div");
    row.className = "home-list-item";
    row.title = "Нажмите, чтобы отметить выполненной";
    row.innerHTML = `<span>${escapeHtml(task.text)}</span>`;
    row.addEventListener("click", () => {
      saveTasks(loadTasks().filter(t => t.id !== task.id));
      renderDayModalList();
      renderHome();
      renderPlanner();
    });
    listEl.appendChild(row);
  });
}

function openDayModal(dateKey) {
  dayModalDate = dateKey;
  document.getElementById("dayModalTitle").textContent = formatDayModalTitle(dateKey);
  renderDayModalList();
  document.getElementById("dayModalOverlay").classList.add("open");
  document.getElementById("dayModalInput").value = "";
}

function closeDayModal() {
  document.getElementById("dayModalOverlay").classList.remove("open");
  dayModalDate = null;
}

document.getElementById("homeCalendar").addEventListener("click", e => {
  const dayEl = e.target.closest(".home-calendar-day");
  if (!dayEl || !dayEl.dataset.date) return;
  openDayModal(dayEl.dataset.date);
});

document.getElementById("dayModalCloseBtn").addEventListener("click", closeDayModal);
document.getElementById("dayModalOverlay").addEventListener("click", e => {
  if (e.target.id === "dayModalOverlay") closeDayModal();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeDayModal();
});
document.getElementById("dayModalForm").addEventListener("submit", e => {
  e.preventDefault();
  const input = document.getElementById("dayModalInput");
  const text = input.value.trim();
  if (!text || !dayModalDate) return;
  addTask(text, dayModalDate);
  input.value = "";
  renderDayModalList();
  renderHome();
  renderPlanner();
});

function renderHomeToday() {
  const el = document.getElementById("homeTodayTasks");
  if (!el) return;

  const todayKey = toDateKey(new Date());
  const tasks = loadTasks().filter(t => t.date === todayKey);
  el.innerHTML = "";

  if (tasks.length === 0) {
    el.innerHTML = `<div class="empty-hint">На сегодня дел нет</div>`;
    return;
  }

  tasks.forEach(task => {
    const row = document.createElement("div");
    row.className = "home-list-item";
    row.title = "Нажмите, чтобы отметить выполненной";
    row.innerHTML = `<span>${escapeHtml(task.text)}</span>`;
    row.addEventListener("click", () => {
      const updated = loadTasks().filter(t => t.id !== task.id);
      saveTasks(updated);
      renderHome();
      renderPlanner();
    });
    el.appendChild(row);
  });
}

function renderHomeDeadlines() {
  const el = document.getElementById("homeDeadlines");
  if (!el) return;

  const todayKey = toDateKey(new Date());
  const tasks = loadTasks()
    .filter(t => t.date && t.date >= todayKey)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);

  el.innerHTML = "";

  if (tasks.length === 0) {
    el.innerHTML = `<div class="empty-hint">Дедлайнов нет</div>`;
    return;
  }

  tasks.forEach(task => {
    const row = document.createElement("div");
    row.className = "home-list-item";
    row.innerHTML = `<span>${escapeHtml(task.text)}</span><span class="home-list-date">${formatDeadline(task.date)}</span>`;
    el.appendChild(row);
  });
}

function renderHomeSavings() {
  const el = document.getElementById("homeSavings");
  if (!el) return;

  const items = loadSavings();
  if (items.length === 0) {
    el.innerHTML = `<div class="empty-hint">Пока нет накоплений</div>`;
    return;
  }

  let totalUsd = 0;
  items.forEach(item => {
    const usd = toUSD(item.current, item.currency);
    if (usd !== null) totalUsd += usd;
  });

  const top = [...items].sort((a, b) => {
    const pa = a.target > 0 ? a.current / a.target : 0;
    const pb = b.target > 0 ? b.current / b.target : 0;
    return pb - pa;
  })[0];
  const percent = top.target > 0 ? Math.min(100, Math.round((top.current / top.target) * 100)) : 0;

  el.innerHTML = `
    <div class="home-savings-total">≈ $${totalUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
    <div class="home-savings-sub">Всего накоплено по всем целям</div>
    <div class="home-savings-top">
      <div class="savings-progress-bar"><div class="savings-progress-fill${percent >= 100 ? " complete" : ""}" style="width:${percent}%"></div></div>
      <div class="savings-progress-label">${escapeHtml(top.name)} — ${percent}%</div>
    </div>
  `;
}

function renderHomeMarket() {
  const el = document.getElementById("homeMarket");
  if (!el) return;

  // Если есть избранное — на главной показываем его, а не стандартные монеты
  const watched = loadWatchlist().slice(0, 5);
  if (watched.length) {
    el.innerHTML = watched.map(asset => {
      const q = assetQuotes[asset.id];
      return `
        <div class="home-list-item home-watch-row" data-id="${escapeAttr(asset.id)}">
          <span>${escapeHtml(asset.name)}</span>
          <span>${q ? `<span class="home-watch-price">${formatMoney(q.price, q.currency)}</span>${formatChange(q.change)}` : "…"}</span>
        </div>
      `;
    }).join("");
    el.querySelectorAll(".home-watch-row").forEach(row => {
      row.addEventListener("click", () => openChartsFor(watched.find(a => a.id === row.dataset.id)));
    });
    return;
  }

  if (!marketData.length) {
    el.innerHTML = `<div class="empty-hint">Загрузка...</div>`;
    return;
  }

  el.innerHTML = "";
  ["BTC", "ETH", "SOL"].forEach(sym => {
    const coin = marketData.find(c => c.base === sym);
    if (!coin) return;

    const changeClass = coin.change >= 0 ? "up" : "down";
    const sign = coin.change >= 0 ? "+" : "";
    const priceStr = coin.price >= 1
      ? coin.price.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : coin.price.toLocaleString(undefined, { maximumFractionDigits: 8 });

    const row = document.createElement("div");
    row.className = "home-list-item";
    row.style.cursor = "default";
    row.innerHTML = `
      <span>${sym}</span>
      <span>
        <span class="market-item-price" style="font-size:13px">$${priceStr}</span>
        <span class="market-item-change ${changeClass}" style="margin-left:6px">${sign}${coin.change.toFixed(2)}%</span>
      </span>
    `;
    el.appendChild(row);
  });
}

function formatCityLabel(c) {
  const parts = [c.name];
  if (c.admin1 && c.admin1 !== c.name) parts.push(c.admin1);
  if (c.country) parts.push(c.country);
  return parts.join(", ");
}

function fetchWeatherInto(lat, lon, label, el) {
  return fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&wind_speed_unit=ms`)
    .then(res => res.json())
    .then(data => {
      const w = data.current_weather;
      if (!w) throw new Error("no data");
      const html = `
        <div class="home-weather-temp">${Math.round(w.temperature)}°C</div>
        <div class="home-weather-sub">${label} · ветер ${Math.round(w.windspeed)} м/с</div>
      `;
      if (el) el.innerHTML = html;
      return html;
    })
    .catch(() => {
      const html = `<div class="empty-hint">Не удалось получить погоду</div>`;
      if (el) el.innerHTML = html;
    });
}

function resolveWeatherLocation() {
  return new Promise(resolve => {
    if (appSettings.weatherMode === "manual" && appSettings.weatherCity) {
      resolve({
        lat: appSettings.weatherCity.lat,
        lon: appSettings.weatherCity.lon,
        label: formatCityLabel(appSettings.weatherCity),
      });
      return;
    }

    const fallback = () => resolve({ lat: 55.75, lon: 37.62, label: "Москва (по умолчанию)" });

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: "Ваше местоположение" }),
        fallback,
        { timeout: 5000 }
      );
    } else {
      fallback();
    }
  });
}

function loadHomeWeather() {
  const el = document.getElementById("homeWeather");
  const previewEl = document.getElementById("settingsWeatherPreview");
  if (!el && !previewEl) return;

  if (el) el.innerHTML = `<div class="empty-hint">Загрузка погоды...</div>`;

  resolveWeatherLocation().then(({ lat, lon, label }) => {
    fetchWeatherInto(lat, lon, label, el).then(html => {
      if (previewEl && html) previewEl.innerHTML = html;
    });
  });
}

// ---------- Настройка города для погоды ----------
let weatherSearchTimeout = null;

async function searchCities(query) {
  if (!query || query.trim().length < 2) return [];
  try {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query.trim())}&count=8&language=ru&format=json`
    );
    const data = await res.json();
    return data.results || [];
  } catch {
    return [];
  }
}

function initWeatherSettings() {
  const autoRadio = document.getElementById("weatherModeAuto");
  const manualRadio = document.getElementById("weatherModeManual");
  const cityInput = document.getElementById("weatherCityInput");
  const resultsEl = document.getElementById("weatherCityResults");
  if (!autoRadio || !manualRadio || !cityInput || !resultsEl) return;

  if (appSettings.weatherMode === "manual") {
    manualRadio.checked = true;
    cityInput.disabled = false;
  } else {
    autoRadio.checked = true;
    cityInput.disabled = true;
  }
  if (appSettings.weatherCity) {
    cityInput.value = formatCityLabel(appSettings.weatherCity);
  }

  function applyMode(mode) {
    appSettings.weatherMode = mode;
    cityInput.disabled = mode !== "manual";
    saveSettings(appSettings);
    loadHomeWeather();
    loadWeatherForecast();
  }

  autoRadio.addEventListener("change", () => applyMode("auto"));
  manualRadio.addEventListener("change", () => applyMode("manual"));

  function renderCityResults(results) {
    resultsEl.innerHTML = "";
    if (results.length === 0) {
      resultsEl.classList.remove("open");
      return;
    }
    results.forEach(r => {
      const item = document.createElement("div");
      item.className = "currency-picker-item";
      item.textContent = formatCityLabel(r);
      item.addEventListener("mousedown", e => {
        e.preventDefault();
        appSettings.weatherCity = {
          name: r.name, lat: r.latitude, lon: r.longitude, country: r.country, admin1: r.admin1,
        };
        saveSettings(appSettings);
        cityInput.value = formatCityLabel(appSettings.weatherCity);
        resultsEl.classList.remove("open");
        loadHomeWeather();
        loadWeatherForecast();
      });
      resultsEl.appendChild(item);
    });
    resultsEl.classList.add("open");
  }

  cityInput.addEventListener("input", () => {
    clearTimeout(weatherSearchTimeout);
    const query = cityInput.value;
    weatherSearchTimeout = setTimeout(async () => {
      const results = await searchCities(query);
      renderCityResults(results);
    }, 350);
  });

  document.addEventListener("click", e => {
    if (!cityInput.contains(e.target) && !resultsEl.contains(e.target)) {
      resultsEl.classList.remove("open");
    }
  });
}

// ---------- Уведомления о задачах ----------
function checkDeadlineNotifications() {
  if (!appSettings.notificationsEnabled) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const todayKey = toDateKey(new Date());
  if (localStorage.getItem("notifications_last_date") === todayKey) return;

  const tasks = loadTasks().filter(t => !t.completed);
  const todayTasks = tasks.filter(t => t.date === todayKey);
  const overdueTasks = tasks.filter(t => t.date && t.date < todayKey);

  if (todayTasks.length === 0 && overdueTasks.length === 0) return;

  const parts = [];
  if (todayTasks.length > 0) parts.push(`на сегодня: ${todayTasks.length}`);
  if (overdueTasks.length > 0) parts.push(`просрочено: ${overdueTasks.length}`);

  new Notification("Wayfinder — напоминание", { body: `Задачи ${parts.join(", ")}.` });
  localStorage.setItem("notifications_last_date", todayKey);
}

function initNotificationsSettings() {
  const toggle = document.getElementById("notificationsToggle");
  const status = document.getElementById("notificationsStatus");
  if (!toggle) return;

  function updateStatus() {
    if (!("Notification" in window)) {
      status.textContent = "Этот браузер не поддерживает уведомления.";
    } else if (appSettings.notificationsEnabled && Notification.permission === "denied") {
      status.textContent = "Уведомления заблокированы в браузере — разрешите их в настройках сайта, чтобы включить.";
    } else {
      status.textContent = "";
    }
  }

  toggle.checked = !!appSettings.notificationsEnabled;
  updateStatus();

  toggle.addEventListener("change", async () => {
    if (!toggle.checked) {
      appSettings.notificationsEnabled = false;
      saveSettings(appSettings);
      updateStatus();
      return;
    }

    if (!("Notification" in window)) {
      toggle.checked = false;
      updateStatus();
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      toggle.checked = false;
      appSettings.notificationsEnabled = false;
      saveSettings(appSettings);
      status.textContent = permission === "denied"
        ? "Браузер заблокировал уведомления для этого сайта. Разрешите их в настройках сайта (значок замка рядом с адресом) и попробуйте снова."
        : "Разрешение на уведомления не было предоставлено.";
      return;
    }

    appSettings.notificationsEnabled = true;
    saveSettings(appSettings);
    updateStatus();
    new Notification("Wayfinder", { body: "Уведомления включены ✅" });
    localStorage.removeItem("notifications_last_date");
    checkDeadlineNotifications();
  });
}

// ---------- Резервная копия данных ----------
const BACKUP_KEYS = ["app_settings", "savings_items", "planner_tasks", "study_channels", "notes_data",
  "custom_events", "watchlist", "paper_portfolio"];

function exportAppData() {
  const data = { exportedAt: new Date().toISOString() };
  BACKUP_KEYS.forEach(key => {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      try { data[key] = JSON.parse(raw); } catch { /* skip corrupted entry */ }
    }
  });

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `wayfinder-backup-${toDateKey(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importAppData(file) {
  const statusEl = document.getElementById("backupStatus");
  const reader = new FileReader();

  reader.onload = e => {
    let data;
    try {
      data = JSON.parse(e.target.result);
    } catch {
      statusEl.textContent = "Не удалось прочитать файл — убедитесь, что это резервная копия Wayfinder.";
      return;
    }

    if (!confirm("Импорт заменит текущие данные сайта на данные из файла. Продолжить?")) return;

    BACKUP_KEYS.forEach(key => {
      if (data[key] !== undefined) localStorage.setItem(key, JSON.stringify(data[key]));
    });

    statusEl.textContent = "Данные восстановлены. Обновляю страницу...";
    setTimeout(() => location.reload(), 1000);
  };

  reader.readAsText(file);
}

function initBackupSettings() {
  const exportBtn = document.getElementById("exportDataBtn");
  const importBtn = document.getElementById("importDataBtn");
  const importInput = document.getElementById("importDataInput");
  if (!exportBtn || !importBtn || !importInput) return;

  exportBtn.addEventListener("click", exportAppData);
  importBtn.addEventListener("click", () => importInput.click());
  importInput.addEventListener("change", e => {
    const file = e.target.files[0];
    if (file) importAppData(file);
  });
}

// ---------- Прогноз погоды ----------
const WEATHER_ICONS = {
  sun: `<svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="4" stroke="currentColor" stroke-width="1.5"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.8 4.8l1.4 1.4M13.8 13.8l1.4 1.4M4.8 15.2l1.4-1.4M13.8 6.2l1.4-1.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  suncloud: `<svg viewBox="0 0 20 20" fill="none"><circle cx="6.5" cy="6" r="2.3" stroke="currentColor" stroke-width="1.3"/><path d="M6.5 2.3v1M2.8 6h1M3.6 3.1l.8.8" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><path d="M6 16h8a3 3 0 000-6 4.6 4.6 0 00-8.8-1.3A3.4 3.4 0 006 16Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
  cloud: `<svg viewBox="0 0 20 20" fill="none"><path d="M5 15h9a3.2 3.2 0 000-6.4 5 5 0 00-9.6-1.6A3.6 3.6 0 005 15Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
  rain: `<svg viewBox="0 0 20 20" fill="none"><path d="M5 12h9a3.2 3.2 0 000-6.4 5 5 0 00-9.6-1.6A3.6 3.6 0 005 12Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M6 15.5l-1 2M10 15.5l-1 2M14 15.5l-1 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
  snow: `<svg viewBox="0 0 20 20" fill="none"><path d="M5 12h9a3.2 3.2 0 000-6.4 5 5 0 00-9.6-1.6A3.6 3.6 0 005 12Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M6 15.3v3M6 15.6l-1.3 1.3M6 15.6l1.3 1.3M13 15.3v3M13 15.6l-1.3 1.3M13 15.6l1.3 1.3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>`,
  storm: `<svg viewBox="0 0 20 20" fill="none"><path d="M5 11h9a3.2 3.2 0 000-6.4 5 5 0 00-9.6-1.6A3.6 3.6 0 005 11Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M10.5 13l-2.5 4h2.5l-1.5 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  fog: `<svg viewBox="0 0 20 20" fill="none"><path d="M4 8h12M3 11h14M5 14h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
};

const WEATHER_CODE_MAP = {
  0: { label: "Ясно", icon: "sun" },
  1: { label: "Малооблачно", icon: "suncloud" },
  2: { label: "Переменная облачность", icon: "suncloud" },
  3: { label: "Облачно", icon: "cloud" },
  45: { label: "Туман", icon: "fog" },
  48: { label: "Туман", icon: "fog" },
  51: { label: "Морось", icon: "rain" },
  53: { label: "Морось", icon: "rain" },
  55: { label: "Морось", icon: "rain" },
  56: { label: "Морось", icon: "rain" },
  57: { label: "Морось", icon: "rain" },
  61: { label: "Дождь", icon: "rain" },
  63: { label: "Дождь", icon: "rain" },
  65: { label: "Сильный дождь", icon: "rain" },
  66: { label: "Ледяной дождь", icon: "rain" },
  67: { label: "Ледяной дождь", icon: "rain" },
  71: { label: "Снег", icon: "snow" },
  73: { label: "Снег", icon: "snow" },
  75: { label: "Сильный снег", icon: "snow" },
  77: { label: "Снежные зёрна", icon: "snow" },
  80: { label: "Ливень", icon: "rain" },
  81: { label: "Ливень", icon: "rain" },
  82: { label: "Сильный ливень", icon: "rain" },
  85: { label: "Снегопад", icon: "snow" },
  86: { label: "Снегопад", icon: "snow" },
  95: { label: "Гроза", icon: "storm" },
  96: { label: "Гроза с градом", icon: "storm" },
  99: { label: "Гроза с градом", icon: "storm" },
};

WEATHER_ICONS.moon = `<svg viewBox="0 0 20 20" fill="none"><path d="M15 12.6A6 6 0 1 1 8 4.6a4.8 4.8 0 1 0 7 8Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
WEATHER_ICONS.mooncloud = `<svg viewBox="0 0 20 20" fill="none"><path d="M9.3 6.4A3 3 0 0 1 6 2.6a3.4 3.4 0 1 0 3.3 3.8Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M6 16h8a3 3 0 000-6 4.6 4.6 0 00-8.8-1.3A3.4 3.4 0 006 16Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;

function weatherCodeInfo(code, isDay = 1) {
  const info = WEATHER_CODE_MAP[code] || { label: "—", icon: "cloud" };
  let icon = info.icon;
  if (!isDay && icon === "sun") icon = "moon";
  if (!isDay && icon === "suncloud") icon = "mooncloud";
  return { label: info.label, icon: WEATHER_ICONS[icon] };
}

let weatherForecastLoaded = false;
let weatherData = null;
let weatherWeekOffset = 0;
const WEATHER_DAYS_PER_PAGE = 7;
const WIND_DIRS = ["С", "СВ", "В", "ЮВ", "Ю", "ЮЗ", "З", "СЗ"];

function windDirLabel(deg) {
  return WIND_DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

// Метеонаправление — откуда дует ветер; стрелка показывает, куда он дует.
function windArrow(deg) {
  return `<svg class="wind-arrow" viewBox="0 0 12 12" style="transform: rotate(${deg + 180}deg)"><path d="M6 1.5v9M6 1.5L3.2 4.6M6 1.5l2.8 3.1" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function formatTemp(t) {
  const r = Math.round(t);
  return `${r > 0 ? "+" : ""}${r === 0 ? 0 : r}°`;
}

function hPaToMmHg(hpa) {
  return Math.round(hpa * 0.750062);
}

function uvLevel(uv) {
  if (uv < 3) return "низкий";
  if (uv < 6) return "умеренный";
  if (uv < 8) return "высокий";
  if (uv < 11) return "очень высокий";
  return "экстремальный";
}

function aqiLevel(aqi) {
  if (aqi <= 20) return { label: "хорошее", cls: "good" };
  if (aqi <= 40) return { label: "удовлетворительное", cls: "good" };
  if (aqi <= 60) return { label: "умеренное", cls: "mid" };
  if (aqi <= 80) return { label: "плохое", cls: "bad" };
  return { label: "очень плохое", cls: "bad" };
}

function moonPhase(date) {
  const synodic = 29.530588853;
  const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14);
  const age = ((((date - knownNewMoon) / 86400000) % synodic) + synodic) % synodic;
  const illumination = Math.round(((1 - Math.cos((2 * Math.PI * age) / synodic)) / 2) * 100);
  const names = ["Новолуние", "Растущий серп", "Первая четверть", "Растущая луна",
    "Полнолуние", "Убывающая луна", "Последняя четверть", "Убывающий серп"];
  return { name: names[Math.round((age / synodic) * 8) % 8], illumination };
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h} ч ${m} мин`;
}

function hourLabel(iso) {
  return iso.slice(11, 16);
}

function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function weatherStat(label, value, sub) {
  return `
    <div class="wc-stat">
      <div class="wc-stat-label">${label}</div>
      <div class="wc-stat-value">${value}</div>
      ${sub ? `<div class="wc-stat-sub">${sub}</div>` : ""}
    </div>
  `;
}

function renderWeatherCurrent() {
  const el = document.getElementById("weatherForecastCurrent");
  const c = weatherData.current;
  const d = weatherData.daily;
  const info = weatherCodeInfo(c.weather_code, c.is_day);
  const moon = moonPhase(new Date());
  const air = weatherData.air;
  const airInfo = air ? aqiLevel(air.european_aqi) : null;

  el.innerHTML = `
    <div class="wc-main">
      <div class="wc-label">Сейчас · ${hourLabel(c.time)}</div>
      <div class="wc-temp-row">
        <div class="wc-icon">${info.icon}</div>
        <div class="wc-temp">${formatTemp(c.temperature_2m)}</div>
      </div>
      <div class="wc-cond">${info.label}</div>
      <div class="wc-feels">Ощущается как ${formatTemp(c.apparent_temperature)}</div>
      <div class="wc-range">Днём ${formatTemp(d.temperature_2m_max[0])} · ночью ${formatTemp(d.temperature_2m_min[0])}</div>
    </div>
    <div class="wc-stats">
      ${weatherStat("Ветер",
        `${windArrow(c.wind_direction_10m)} ${Math.round(c.wind_speed_10m)} м/с, ${windDirLabel(c.wind_direction_10m)}`,
        `порывы до ${Math.round(c.wind_gusts_10m)} м/с`)}
      ${weatherStat("Давление", `${hPaToMmHg(c.surface_pressure)} мм рт. ст.`, "")}
      ${weatherStat("Влажность", `${c.relative_humidity_2m}%`, `облачность ${c.cloud_cover}%`)}
      ${weatherStat("УФ-индекс", `${Math.round(d.uv_index_max[0])} · ${uvLevel(d.uv_index_max[0])}`, "максимум за день")}
      ${weatherStat("Видимость", `${Math.round(c.visibility / 1000)} км`, "")}
      ${weatherStat("Солнце",
        `${hourLabel(d.sunrise[0])} — ${hourLabel(d.sunset[0])}`,
        `долгота дня ${formatDuration(d.daylight_duration[0])}`)}
      ${weatherStat("Качество воздуха",
        air ? `<span class="aqi-dot aqi-${airInfo.cls}"></span>${airInfo.label}` : "нет данных",
        air ? `индекс ${air.european_aqi} · PM2.5 ${air.pm2_5} мкг/м³` : "")}
      ${weatherStat("Луна", moon.name, `освещённость ${moon.illumination}%`)}
    </div>
  `;
}

function renderWeatherHourly() {
  const el = document.getElementById("weatherHourly");
  const h = weatherData.hourly;
  const nowHour = weatherData.current.time.slice(0, 13) + ":00";
  const start = Math.max(0, h.time.indexOf(nowHour));
  const count = Math.min(24, h.time.length - start);

  const COL = 64;
  const H = 60;
  const width = count * COL;
  const temps = [];
  for (let i = 0; i < count; i++) temps.push(h.temperature_2m[start + i]);
  const max = Math.max(...temps);
  const min = Math.min(...temps);
  const xs = temps.map((_, i) => i * COL + COL / 2);
  const ys = temps.map(t => 22 + (max === min ? 0.5 : (max - t) / (max - min)) * (H - 30));
  const line = xs.map((x, i) => `${x},${ys[i].toFixed(1)}`).join(" ");
  const area = `M${xs[0]},${H} L${xs.map((x, i) => `${x},${ys[i].toFixed(1)}`).join(" L")} L${xs[count - 1]},${H} Z`;

  let times = "", icons = "", precip = "", wind = "", labels = "";
  for (let i = 0; i < count; i++) {
    const k = start + i;
    const info = weatherCodeInfo(h.weather_code[k], h.is_day[k]);
    const prob = h.precipitation_probability[k] ?? 0;
    times += `<div class="wh-cell wh-time">${i === 0 ? "Сейчас" : hourLabel(h.time[k])}</div>`;
    icons += `<div class="wh-cell wh-icon" title="${info.label}">${info.icon}</div>`;
    precip += `<div class="wh-cell wh-precip${prob >= 50 ? " wh-precip--high" : ""}">${prob}%</div>`;
    wind += `<div class="wh-cell wh-wind">${windArrow(h.wind_direction_10m[k])}${Math.round(h.wind_speed_10m[k])}</div>`;
    labels += `<text x="${xs[i]}" y="${(ys[i] - 8).toFixed(1)}" text-anchor="middle" class="wh-temp-label">${formatTemp(temps[i])}</text>`;
  }

  const cols = `grid-template-columns: repeat(${count}, ${COL}px)`;
  el.innerHTML = `
    <div class="wh-scroll">
      <div class="wh-inner" style="width:${width}px">
        <div class="wh-row" style="${cols}">${times}</div>
        <div class="wh-row" style="${cols}">${icons}</div>
        <svg class="wh-curve" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}">
          <path d="${area}" class="wh-curve-area"></path>
          <polyline points="${line}" class="wh-curve-line"></polyline>
          ${labels}
        </svg>
        <div class="wh-row" style="${cols}">${precip}</div>
        <div class="wh-row" style="${cols}">${wind}</div>
      </div>
    </div>
    <div class="wh-legend">Ряды снизу: вероятность осадков, % · ветер, м/с (стрелка — куда дует)</div>
  `;
}

function renderWeatherWeek() {
  const listEl = document.getElementById("weatherForecastList");
  const prevBtn = document.getElementById("weatherPrevBtn");
  const nextBtn = document.getElementById("weatherNextBtn");
  const pageEl = document.getElementById("weatherWeekLabel");
  if (!weatherData) return;
  const daily = weatherData.daily;

  const start = weatherWeekOffset * WEATHER_DAYS_PER_PAGE;
  const end = Math.min(start + WEATHER_DAYS_PER_PAGE, daily.time.length);

  listEl.innerHTML = "";
  for (let i = start; i < end; i++) {
    const date = parseLocalDate(daily.time[i]);
    const weekday = (date.getDay() + 6) % 7;
    const info = weatherCodeInfo(daily.weather_code[i]);
    const dayName = i === 0 ? "Сегодня" : i === 1 ? "Завтра" : RU_WEEKDAYS_SHORT[weekday];
    const precipMm = daily.precipitation_sum[i];

    const card = document.createElement("div");
    card.className = "weather-day-card" + (weekday >= 5 ? " weather-day-card--weekend" : "");
    card.innerHTML = `
      <div class="weather-day-name">${dayName}</div>
      <div class="weather-day-date">${date.getDate()} ${RU_MONTHS_SHORT[date.getMonth()]}</div>
      <div class="weather-day-icon" title="${info.label}">${info.icon}</div>
      <div class="weather-day-temps">
        <span class="weather-day-max">${formatTemp(daily.temperature_2m_max[i])}</span>
        <span class="weather-day-min">${formatTemp(daily.temperature_2m_min[i])}</span>
      </div>
      <div class="weather-day-extra">${windArrow(daily.wind_direction_10m_dominant[i])} ${Math.round(daily.wind_speed_10m_max[i])} м/с</div>
      <div class="weather-day-precip">${daily.precipitation_probability_max[i]}%${precipMm > 0 ? ` · ${precipMm} мм` : ""}</div>
    `;
    card.addEventListener("click", () => openWeatherDayModal(i));
    listEl.appendChild(card);
  }

  const first = parseLocalDate(daily.time[start]);
  const last = parseLocalDate(daily.time[end - 1]);
  pageEl.textContent = `${first.getDate()} ${RU_MONTHS_SHORT[first.getMonth()]} — ${last.getDate()} ${RU_MONTHS_SHORT[last.getMonth()]}`;
  prevBtn.disabled = weatherWeekOffset === 0;
  nextBtn.disabled = end >= daily.time.length;
}

document.getElementById("weatherPrevBtn").addEventListener("click", () => {
  if (weatherWeekOffset === 0) return;
  weatherWeekOffset--;
  renderWeatherWeek();
});

document.getElementById("weatherNextBtn").addEventListener("click", () => {
  if (!weatherData) return;
  if ((weatherWeekOffset + 1) * WEATHER_DAYS_PER_PAGE >= weatherData.daily.time.length) return;
  weatherWeekOffset++;
  renderWeatherWeek();
});

async function loadWeatherForecast() {
  const listEl = document.getElementById("weatherForecastList");
  const metaEl = document.getElementById("weatherForecastMeta");
  const errorEl = document.getElementById("weatherForecastError");
  const currentEl = document.getElementById("weatherForecastCurrent");
  const hourlyEl = document.getElementById("weatherHourly");
  if (!listEl) return;

  errorEl.textContent = "";
  currentEl.innerHTML = `<div class="empty-hint">Загрузка прогноза...</div>`;
  hourlyEl.innerHTML = "";
  listEl.innerHTML = "";
  weatherForecastLoaded = true;
  weatherWeekOffset = 0;

  try {
    const loc = await resolveWeatherLocation();
    metaEl.textContent = loc.label;

    const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}`
      + "&timezone=auto&forecast_days=16&wind_speed_unit=ms"
      + "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,surface_pressure,cloud_cover,visibility,is_day"
      + "&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m,relative_humidity_2m,surface_pressure,is_day"
      + "&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,uv_index_max,sunrise,sunset,daylight_duration";
    const airUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${loc.lat}&longitude=${loc.lon}&current=european_aqi,pm2_5`;

    const [res, air] = await Promise.all([
      fetch(forecastUrl),
      fetch(airUrl).then(r => r.json()).then(d => d.current || null).catch(() => null),
    ]);
    if (!res.ok) throw new Error("network");
    const data = await res.json();
    if (!data.daily || !data.current || !data.hourly) throw new Error("no data");

    weatherData = { current: data.current, hourly: data.hourly, daily: data.daily, air };
    renderWeatherCurrent();
    renderWeatherHourly();
    renderWeatherWeek();
  } catch (e) {
    currentEl.innerHTML = "";
    weatherData = null;
    errorEl.textContent = "Не удалось получить прогноз погоды. Проверьте интернет-соединение.";
  }
}

function formatWeatherModalTitle(dateStr, index) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const prefix = index === 0 ? "Сегодня, " : "";
  const str = date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "long" });
  return prefix + str.charAt(0).toUpperCase() + str.slice(1);
}

function openWeatherDayModal(index) {
  if (!weatherData) return;
  const daily = weatherData.daily;
  const hourly = weatherData.hourly;
  const dateStr = daily.time[index];
  const info = weatherCodeInfo(daily.weather_code[index]);

  const dayHours = [];
  hourly.time.forEach((t, k) => {
    if (t.startsWith(dateStr)) dayHours.push(k);
  });
  const avg = arr => arr.reduce((s, v) => s + v, 0) / (arr.length || 1);
  const humidity = Math.round(avg(dayHours.map(k => hourly.relative_humidity_2m[k])));
  const pressure = hPaToMmHg(avg(dayHours.map(k => hourly.surface_pressure[k])));

  const slots = dayHours.filter(k => Number(hourly.time[k].slice(11, 13)) % 3 === 0);
  const slotsHtml = slots.map(k => {
    const slotInfo = weatherCodeInfo(hourly.weather_code[k], hourly.is_day[k]);
    return `
      <div class="wdm-slot">
        <div class="wdm-slot-time">${hourLabel(hourly.time[k])}</div>
        <div class="wdm-slot-icon" title="${slotInfo.label}">${slotInfo.icon}</div>
        <div class="wdm-slot-temp">${formatTemp(hourly.temperature_2m[k])}</div>
        <div class="wdm-slot-sub">${hourly.precipitation_probability[k] ?? 0}%</div>
        <div class="wdm-slot-sub">${windArrow(hourly.wind_direction_10m[k])}${Math.round(hourly.wind_speed_10m[k])}</div>
      </div>
    `;
  }).join("");

  const stat = (label, value) => `
    <div class="weather-day-modal-stat">
      <div class="weather-day-modal-stat-label">${label}</div>
      <div class="weather-day-modal-stat-value">${value}</div>
    </div>
  `;

  document.getElementById("weatherDayModalTitle").textContent = formatWeatherModalTitle(dateStr, index);
  document.getElementById("weatherDayModalBody").innerHTML = `
    <div class="weather-day-modal-main">
      <div class="weather-day-modal-icon">${info.icon}</div>
      <div>
        <div class="weather-day-modal-temp">${formatTemp(daily.temperature_2m_max[index])} <span class="weather-day-modal-temp-min">/ ${formatTemp(daily.temperature_2m_min[index])}</span></div>
        <div class="weather-day-modal-label">${info.label}</div>
      </div>
    </div>
    ${slots.length ? `<div class="wdm-slots">${slotsHtml}</div>` : ""}
    <div class="weather-day-modal-grid">
      ${stat("Ощущается", `${formatTemp(daily.apparent_temperature_max[index])} / ${formatTemp(daily.apparent_temperature_min[index])}`)}
      ${stat("Осадки", `${daily.precipitation_probability_max[index]}% · ${daily.precipitation_sum[index]} мм`)}
      ${stat("Ветер", `${windArrow(daily.wind_direction_10m_dominant[index])} до ${Math.round(daily.wind_speed_10m_max[index])} м/с, ${windDirLabel(daily.wind_direction_10m_dominant[index])}`)}
      ${stat("Порывы", `до ${Math.round(daily.wind_gusts_10m_max[index])} м/с`)}
      ${stat("Влажность", `${humidity}%`)}
      ${stat("Давление", `${pressure} мм рт. ст.`)}
      ${stat("УФ-индекс", `${Math.round(daily.uv_index_max[index])} · ${uvLevel(daily.uv_index_max[index])}`)}
      ${stat("Солнце", `${hourLabel(daily.sunrise[index])} — ${hourLabel(daily.sunset[index])}`)}
      ${stat("Долгота дня", formatDuration(daily.daylight_duration[index]))}
      ${stat("Луна", moonPhase(parseLocalDate(dateStr)).name)}
    </div>
  `;
  document.getElementById("weatherDayModalOverlay").classList.add("open");
}

function closeWeatherDayModal() {
  document.getElementById("weatherDayModalOverlay").classList.remove("open");
}

document.getElementById("weatherDayModalCloseBtn").addEventListener("click", closeWeatherDayModal);
document.getElementById("weatherDayModalOverlay").addEventListener("click", e => {
  if (e.target.id === "weatherDayModalOverlay") closeWeatherDayModal();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeWeatherDayModal();
});

// ---------- Выбор города во вкладке "Погода" ----------
(() => {
  const cityInput = document.getElementById("weatherTabCityInput");
  const resultsEl = document.getElementById("weatherTabCityResults");
  if (!cityInput || !resultsEl) return;
  let searchTimeout = null;

  function renderResults(results) {
    resultsEl.innerHTML = "";
    if (results.length === 0) {
      resultsEl.classList.remove("open");
      return;
    }
    results.forEach(r => {
      const item = document.createElement("div");
      item.className = "currency-picker-item";
      item.textContent = formatCityLabel(r);
      item.addEventListener("mousedown", e => {
        e.preventDefault();
        appSettings.weatherCity = {
          name: r.name, lat: r.latitude, lon: r.longitude, country: r.country, admin1: r.admin1,
        };
        appSettings.weatherMode = "manual";
        saveSettings(appSettings);

        cityInput.value = "";
        resultsEl.classList.remove("open");

        const settingsCityInput = document.getElementById("weatherCityInput");
        const settingsManualRadio = document.getElementById("weatherModeManual");
        if (settingsCityInput) settingsCityInput.value = formatCityLabel(appSettings.weatherCity);
        if (settingsCityInput) settingsCityInput.disabled = false;
        if (settingsManualRadio) settingsManualRadio.checked = true;

        loadHomeWeather();
        loadWeatherForecast();
      });
      resultsEl.appendChild(item);
    });
    resultsEl.classList.add("open");
  }

  cityInput.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    const query = cityInput.value;
    searchTimeout = setTimeout(async () => {
      const results = await searchCities(query);
      renderResults(results);
    }, 350);
  });

  document.addEventListener("click", e => {
    if (!cityInput.contains(e.target) && !resultsEl.contains(e.target)) {
      resultsEl.classList.remove("open");
    }
  });
})();

function renderHome() {
  renderHomeGreeting();
  renderHomeCalendar();
  renderHomeToday();
  renderHomeDeadlines();
  renderHomeSavings();
  renderHomeMarket();
}

// ---------- Tabs ----------
const tabBtns = document.querySelectorAll(".tab-btn");
const tabContents = document.querySelectorAll(".tab-content");
const FINANCE_SUBTABS = ["watchlist", "portfolio", "charts", "market", "currency", "stocks", "indices", "commodities", "rates", "events", "marketNews"];

tabBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    if (!btn.dataset.tab) return; // родительская кнопка "Финансовый сектор" — только открывает подменю

    tabBtns.forEach(b => b.classList.remove("active"));
    tabContents.forEach(c => c.classList.remove("active"));
    tabBtns.forEach(b => {
      if (b.dataset.tab === btn.dataset.tab) b.classList.add("active");
    });
    document.getElementById(btn.dataset.tab).classList.add("active");

    if (FINANCE_SUBTABS.includes(btn.dataset.tab)) {
      document.getElementById("financeNavBtn").classList.add("active");
    }

    document.getElementById("financeFlyout").classList.remove("open");
  });
});

// ---------- Финансовый сектор: флайаут-подменю ----------
(() => {
  const parentBtn = document.getElementById("financeNavBtn");
  const flyout = document.getElementById("financeFlyout");
  let hideTimer = null;

  function positionFlyout() {
    const rect = parentBtn.getBoundingClientRect();
    flyout.style.top = `${rect.top}px`;
    flyout.style.left = `${rect.right + 6}px`;
  }

  function show() {
    clearTimeout(hideTimer);
    positionFlyout();
    flyout.classList.add("open");
  }

  function hideDelayed() {
    hideTimer = setTimeout(() => flyout.classList.remove("open"), 200);
  }

  parentBtn.addEventListener("mouseenter", show);
  parentBtn.addEventListener("mouseleave", hideDelayed);
  flyout.addEventListener("mouseenter", () => clearTimeout(hideTimer));
  flyout.addEventListener("mouseleave", hideDelayed);

  parentBtn.addEventListener("click", () => {
    if (flyout.classList.contains("open")) {
      flyout.classList.remove("open");
    } else {
      show();
    }
  });

  document.addEventListener("click", e => {
    if (!parentBtn.contains(e.target) && !flyout.contains(e.target)) {
      flyout.classList.remove("open");
    }
  });
})();

// ---------- Currency data ----------
// Free, no-key API. Swap this URL later if you have your own source.
const RATES_API = "https://open.er-api.com/v6/latest/USD";
const FALLBACK_CURRENCIES = ["USD", "EUR", "RUB", "KZT", "GBP", "CNY", "JPY", "TRY", "UAH"];

let currencyList = [];
let usdRates = null; // { EUR: 0.87, RUB: 83.2, ... } — сколько единиц валюты за 1 USD
let usdRatesUpdated = null;

async function loadCurrencyList() {
  try {
    const res = await fetch(RATES_API);
    if (!res.ok) throw new Error("network");
    const data = await res.json();
    if (data.result !== "success" || !data.rates) throw new Error("bad response");
    currencyList = Object.keys(data.rates).sort();
    usdRates = data.rates;
    usdRatesUpdated = data.time_last_update_unix ? new Date(data.time_last_update_unix * 1000) : null;
  } catch (e) {
    currencyList = FALLBACK_CURRENCIES;
    usdRates = null;
  }
  populateCurrencySelects();
  renderSavings();
  renderConverter();
}

function toUSD(amount, currency) {
  if (currency === "USD") return amount;
  if (!usdRates || !usdRates[currency]) return null;
  return amount / usdRates[currency];
}

function populateCurrencySelects() {
  const savingsInput = document.getElementById("savingsCurrency");
  if (!savingsInput.value) savingsInput.value = currencyList.includes("USD") ? "USD" : currencyList[0];
  setupCurrencyArrowCycle(savingsInput);
  setupCurrencyPicker(savingsInput);
}

// Стрелки ↑/↓ на поле валюты листают список валют (алфавитный порядок)
function setupCurrencyArrowCycle(inputEl) {
  if (inputEl.dataset.arrowCycleReady) return;
  inputEl.dataset.arrowCycleReady = "1";

  inputEl.addEventListener("keydown", e => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    if (!currencyList.length) return;
    e.preventDefault();

    const current = inputEl.value.trim().toUpperCase();
    const direction = e.key === "ArrowUp" ? 1 : -1;
    let idx = currencyList.indexOf(current);

    if (idx === -1) {
      idx = direction === 1 ? -1 : 0;
    }

    const nextIdx = (idx + direction + currencyList.length) % currencyList.length;
    inputEl.value = currencyList[nextIdx];
    inputEl.dispatchEvent(new Event("input"));
  });
}

// Кнопка ▾ и клик по варианту в кастомном выпадающем списке валют
function setupCurrencyPicker(inputEl) {
  const wrapper = inputEl.closest(".currency-picker");
  if (!wrapper || wrapper.dataset.pickerReady) return;
  wrapper.dataset.pickerReady = "1";

  const toggleBtn = wrapper.querySelector(".currency-picker-toggle");
  const listEl = wrapper.querySelector(".currency-picker-list");

  function renderOptions(filter) {
    const query = (filter || "").trim().toUpperCase();
    const currentValue = inputEl.value.trim().toUpperCase();
    const matches = query ? currencyList.filter(c => c.startsWith(query)) : currencyList;

    listEl.innerHTML = "";
    if (matches.length === 0) {
      listEl.innerHTML = `<div class="currency-picker-empty">Не найдено</div>`;
      return;
    }

    matches.forEach(code => {
      const item = document.createElement("div");
      item.className = "currency-picker-item" + (code === currentValue ? " active" : "");
      item.textContent = code;
      item.addEventListener("mousedown", e => {
        e.preventDefault();
        inputEl.value = code;
        closeList();
      });
      listEl.appendChild(item);
    });
  }

  function openList(filter) {
    renderOptions(filter);
    listEl.classList.add("open");
  }

  function closeList() {
    listEl.classList.remove("open");
  }

  // Клик по стрелке — всегда показывает полный список валют
  toggleBtn.addEventListener("click", e => {
    e.stopPropagation();
    if (listEl.classList.contains("open")) {
      closeList();
    } else {
      openList("");
    }
  });

  // Ввод текста — список подстраивается под набранные буквы
  inputEl.addEventListener("input", () => openList(inputEl.value));
  inputEl.addEventListener("focus", () => openList(inputEl.value));
  inputEl.addEventListener("keydown", e => {
    if (e.key === "Escape") closeList();
  });

  document.addEventListener("click", e => {
    if (!wrapper.contains(e.target)) closeList();
  });
}

// ---------- Market (все пары с Bybit) ----------
const MARKET_API = "https://api.bybit.com/v5/market/tickers?category=spot";
const MARKET_DEFAULT_COUNT = 60;

let marketData = [];

async function loadMarket() {
  const listEl = document.getElementById("marketList");
  const errorEl = document.getElementById("marketError");
  const metaEl = document.getElementById("marketMeta");
  errorEl.textContent = "";
  listEl.innerHTML = `<div class="empty-hint">Загрузка...</div>`;

  try {
    const res = await fetch(MARKET_API);
    if (!res.ok) throw new Error("network");
    const data = await res.json();
    if (data.retCode !== 0 || !data.result?.list) throw new Error("bad response");

    marketData = data.result.list
      .filter(t => t.symbol.endsWith("USDT") && parseFloat(t.lastPrice) > 0)
      .map(t => ({
        symbol: t.symbol,
        base: t.symbol.replace(/USDT$/, ""),
        price: parseFloat(t.lastPrice),
        change: parseFloat(t.price24hPcnt) * 100,
        volume: parseFloat(t.turnover24h || "0"),
      }))
      .sort((a, b) => b.volume - a.volume);
    marketLoadedAt = Date.now();

    metaEl.textContent = `Всего пар: ${marketData.length} (источник: Bybit)`;
    renderMarketList();
    renderHomeMarket();
    renderConverter();
  } catch (e) {
    listEl.innerHTML = "";
    metaEl.textContent = "";
    errorEl.textContent = "Не удалось получить курс рынка. Попробуйте позже.";
  }
}

function renderMarketList() {
  const listEl = document.getElementById("marketList");
  const query = document.getElementById("marketSearch").value.trim().toUpperCase();

  let items;
  if (query) {
    items = marketData.filter(c => c.base.includes(query) || c.symbol.includes(query));
  } else {
    items = marketData.slice(0, MARKET_DEFAULT_COUNT);
  }

  listEl.innerHTML = "";

  if (items.length === 0) {
    listEl.innerHTML = `<div class="empty-hint">Ничего не найдено</div>`;
    return;
  }

  items.forEach(coin => {
    const changeClass = coin.change >= 0 ? "up" : "down";
    const changeSign = coin.change >= 0 ? "+" : "";
    const priceStr = coin.price >= 1
      ? coin.price.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : coin.price.toLocaleString(undefined, { maximumFractionDigits: 8 });

    const item = document.createElement("div");
    item.className = "market-item";
    item.innerHTML = `
      <span class="market-item-name">${watchStarHtml(cryptoAsset(coin.base))}${coin.base} <span class="market-item-symbol">/USDT</span></span>
      <span>
        <span class="market-item-price">$${priceStr}</span>
        <span class="market-item-change ${changeClass}">${changeSign}${coin.change.toFixed(2)}%</span>
      </span>
    `;
    item.addEventListener("click", () => openMarketChart(coin));
    listEl.appendChild(item);
  });
}

function openMarketChart(coin) {
  document.getElementById("marketListView").style.display = "none";
  document.getElementById("marketChartView").style.display = "block";
  document.getElementById("marketChartTitle").textContent = `${coin.base}/USDT`;

  const container = document.getElementById("marketChartContainer");
  container.innerHTML = "";

  if (typeof TradingView === "undefined") {
    container.innerHTML = `<div class="empty-hint">Не удалось загрузить график (нет соединения с TradingView).</div>`;
    return;
  }

  new TradingView.widget({
    symbol: `BYBIT:${coin.symbol}`,
    container_id: "marketChartContainer",
    autosize: true,
    interval: "60",
    timezone: "Etc/UTC",
    theme: "dark",
    style: "1",
    locale: "ru",
    toolbar_bg: "#1a1d24",
    hide_top_toolbar: false,
    hide_legend: false,
    allow_symbol_change: false,
  });
}

document.getElementById("marketBackBtn").addEventListener("click", () => {
  document.getElementById("marketChartView").style.display = "none";
  document.getElementById("marketListView").style.display = "block";
  document.getElementById("marketChartContainer").innerHTML = "";
});

document.getElementById("marketRefreshBtn").addEventListener("click", loadMarket);
document.getElementById("marketSearch").addEventListener("input", renderMarketList);

// ---------- Акции (Yahoo Finance) ----------
// investing.com закрыт от автоматических запросов (Cloudflare), поэтому данные берём
// из Yahoo Finance через server.py/update_stocks.py — список тикеров задан в stocks_data.py.
// Поиск по любой акции (не только стартовому списку) работает только в режиме сервера
// (server.py), так как требует живого запроса к Yahoo Finance.
let stocksData = [];
let defaultStocksData = [];
let stocksSearchTimeout = null;

// Yahoo Finance блокирует прямые запросы из браузера (CORS), поэтому данные
// берутся либо из офлайн-файла stocks-data.js (режим file://, см. update_stocks.bat),
// либо через локальный сервер server.py (эндпоинт /api/stocks).
function applyStocksResult(data) {
  const errorEl = document.getElementById("stocksError");
  const metaEl = document.getElementById("stocksMeta");

  stocksData = data.stocks || [];
  defaultStocksData = stocksData;
  errorEl.textContent = "";

  if (data.errors && data.errors.length > 0) {
    const failed = data.errors.map(e => e.symbol || "?").join(", ");
    errorEl.textContent = `Не удалось загрузить: ${failed}`;
  }

  const updated = data.updatedAt ? new Date(data.updatedAt).toLocaleString("ru-RU") : new Date().toLocaleTimeString("ru-RU");
  metaEl.textContent = `Показано акций: ${stocksData.length} (источник: Yahoo Finance). Обновлено: ${updated}`;

  if (stocksData.length === 0) {
    document.getElementById("stocksList").innerHTML = "";
    errorEl.textContent = "Не удалось получить данные по акциям.";
    return;
  }

  renderStocksList();
}

async function loadStocks(silent = false) {
  const listEl = document.getElementById("stocksList");
  const errorEl = document.getElementById("stocksError");
  const metaEl = document.getElementById("stocksMeta");

  if (!silent) {
    errorEl.textContent = "";
    metaEl.textContent = "";
    listEl.innerHTML = `<div class="empty-hint">Загрузка...</div>`;
  }

  // Сначала живой запрос к server.py; без него — данные автообновления (data/ или stocks-data.js)
  try {
    const res = await apiFetch("/api/stocks");
    if (!res.ok) throw new Error("network");
    const data = await res.json();
    applyStocksResult(data);
  } catch (e) {
    const data = await loadStaticData("stocks");
    if (data) {
      applyStocksResult(data);
      metaEl.textContent = `Показано акций: ${stocksData.length} (источник: Yahoo Finance) · ${staticDataNote(data, "цены")}`;
    } else {
      listEl.innerHTML = "";
      metaEl.textContent = "";
      errorEl.textContent = "Нет данных об акциях." + SERVER_HINT;
    }
  }
}

setInterval(() => {
  const searching = document.getElementById("stocksSearch").value.trim();
  if (document.getElementById("stocks").classList.contains("active") && !searching) loadStocks(true);
}, 60000);

function renderStocksItems(items) {
  const listEl = document.getElementById("stocksList");
  listEl.innerHTML = "";

  if (items.length === 0) {
    listEl.innerHTML = `<div class="empty-hint">Ничего не найдено</div>`;
    return;
  }

  items.forEach(stock => {
    const changeClass = stock.change >= 0 ? "up" : "down";
    const sign = stock.change >= 0 ? "+" : "";
    const currencySign = stock.currency === "USD" ? "$" : (stock.currency === "RUB" ? "₽" : stock.currency + " ");

    const item = document.createElement("div");
    item.className = "market-item";
    item.innerHTML = `
      <span class="market-item-name">${watchStarHtml(stockAsset(stock.symbol, stock.name))}${escapeHtml(stock.name)} <span class="market-item-symbol">${escapeHtml(stock.symbol)}</span></span>
      <span>
        <span class="market-item-price">${currencySign}${stock.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
        <span class="market-item-change ${changeClass}">${sign}${stock.change.toFixed(2)}%</span>
      </span>
    `;
    listEl.appendChild(item);
  });
}

function renderStocksList() {
  const query = document.getElementById("stocksSearch").value.trim().toLowerCase();
  const items = query
    ? stocksData.filter(s => s.name.toLowerCase().includes(query) || s.symbol.toLowerCase().includes(query))
    : stocksData;
  renderStocksItems(items);
}

async function searchStocksLive(query) {
  const listEl = document.getElementById("stocksList");
  const errorEl = document.getElementById("stocksError");
  const metaEl = document.getElementById("stocksMeta");
  errorEl.textContent = "";
  listEl.innerHTML = `<div class="empty-hint">Ищем «${escapeHtml(query)}»...</div>`;

  try {
    const res = await apiFetch(`/api/stocks/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error("network");
    const data = await res.json();
    stocksData = data.stocks || [];

    metaEl.textContent = `Найдено акций: ${stocksData.length}`;
    if (data.errors && data.errors.length > 0) {
      const failed = data.errors.map(e => e.symbol || "?").join(", ");
      errorEl.textContent = `Не удалось загрузить: ${failed}`;
    }
    renderStocksItems(stocksData);
  } catch (e) {
    // Сервер недоступен (напр. сайт открыт напрямую) — ищем среди уже загруженного списка
    const local = defaultStocksData.filter(
      s => s.name.toLowerCase().includes(query.toLowerCase()) || s.symbol.toLowerCase().includes(query.toLowerCase())
    );
    stocksData = local;
    metaEl.textContent = local.length > 0
      ? `Найдено в загруженном списке: ${local.length}`
      : "";
    if (local.length === 0) {
      errorEl.textContent = IS_HOSTED
        ? "Среди доступных акций ничего не найдено."
        : "Живой поиск недоступен (запустите server.py). Среди уже загруженных акций ничего не найдено.";
    }
    renderStocksItems(local);
  }
}

document.getElementById("stocksRefreshBtn").addEventListener("click", loadStocks);

document.getElementById("stocksSearch").addEventListener("input", () => {
  const query = document.getElementById("stocksSearch").value.trim();

  clearTimeout(stocksSearchTimeout);
  stocksSearchTimeout = setTimeout(() => {
    if (!query) {
      stocksData = defaultStocksData;
      document.getElementById("stocksMeta").textContent = `Показано акций: ${stocksData.length} (источник: Yahoo Finance)`;
      renderStocksItems(stocksData);
      return;
    }
    // Всегда пробуем живой поиск по всему рынку через сервер; если сервер недоступен
    // (например, сайт открыт напрямую двойным кликом) — ищем в уже загруженном списке
    searchStocksLive(query);
  }, 400);
});

// ---------- Savings (накопления) ----------
const SAVINGS_KEY = "savings_items";

function loadSavings() {
  let items;
  try {
    items = JSON.parse(localStorage.getItem(SAVINGS_KEY)) || [];
  } catch {
    items = [];
  }

  // Миграция старого формата { amount } -> { target, current }
  let migrated = false;
  items = items.map(item => {
    if (item.target === undefined) {
      migrated = true;
      return {
        id: item.id,
        name: item.name,
        target: item.amount,
        current: item.amount,
        currency: item.currency,
        deadline: item.deadline || null,
      };
    }
    return item;
  });
  if (migrated) saveSavings(items);

  return items;
}

function saveSavings(items) {
  localStorage.setItem(SAVINGS_KEY, JSON.stringify(items));
}

function daysUntil(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

function formatDeadline(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
}

function renderSavingsSummary(items) {
  const summaryEl = document.getElementById("savingsSummary");

  if (items.length === 0) {
    summaryEl.innerHTML = "";
    return;
  }

  let totalUsd = 0;
  let missing = false;

  items.forEach(item => {
    const usd = toUSD(item.current, item.currency);
    if (usd === null) {
      missing = true;
    } else {
      totalUsd += usd;
    }
  });

  summaryEl.innerHTML = `
    <span class="savings-summary-label">Всего накоплено (в пересчёте):</span>
    <span class="savings-summary-value">≈ $${totalUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
    ${missing ? '<span class="savings-summary-note">Курс для некоторых валют пока не загружен — сумма может быть неточной.</span>' : ""}
  `;
}

function renderSavingsChart(items) {
  const el = document.getElementById("savingsChart");
  if (!el) return;

  const points = [];
  items.forEach(item => {
    (item.history || []).forEach(h => {
      const usd = toUSD(h.amount, item.currency);
      if (usd !== null) points.push({ date: h.date, usd });
    });
  });

  if (points.length < 2) {
    el.innerHTML = "";
    return;
  }

  const byDate = new Map();
  points.forEach(p => byDate.set(p.date, (byDate.get(p.date) || 0) + p.usd));
  const dates = [...byDate.keys()].sort();

  let running = 0;
  const series = dates.map(d => {
    running += byDate.get(d);
    return { date: d, total: running };
  });

  const width = 600, height = 120, pad = 6;
  const maxVal = Math.max(...series.map(p => p.total));
  const stepX = series.length > 1 ? (width - pad * 2) / (series.length - 1) : 0;

  const coords = series.map((p, i) => {
    const x = pad + i * stepX;
    const y = height - pad - (p.total / (maxVal || 1)) * (height - pad * 2);
    return [x, y];
  });

  const pointsAttr = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaPath = `M${pad},${height - pad} L${coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L")} L${width - pad},${height - pad} Z`;

  el.innerHTML = `
    <div class="savings-chart-title">История накоплений (сумма в USD)</div>
    <svg viewBox="0 0 ${width} ${height}" class="savings-chart-svg" preserveAspectRatio="none">
      <path d="${areaPath}" class="savings-chart-area"></path>
      <polyline points="${pointsAttr}" class="savings-chart-line"></polyline>
    </svg>
    <div class="savings-chart-range">
      <span>${formatDeadline(series[0].date)}</span>
      <span>≈ $${maxVal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
    </div>
  `;
}

function renderSavings() {
  const list = document.getElementById("savingsList");
  const items = loadSavings();

  renderSavingsSummary(items);
  renderSavingsChart(items);
  if (typeof renderHomeSavings === "function") renderHomeSavings();
  list.innerHTML = "";

  if (items.length === 0) {
    list.innerHTML = `
      <div class="savings-empty">
        <div class="savings-empty-icon">
          <svg viewBox="0 0 44 44" fill="none">
            <rect x="4" y="10" width="36" height="30" rx="4" stroke="currentColor" stroke-width="1.6"/>
            <path d="M10 10V6.5c0-1.4 1.1-2.5 2.5-2.5h19c1.4 0 2.5 1.1 2.5 2.5V10" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
            <rect x="13" y="4.5" width="18" height="3.5" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
            <circle cx="16" cy="26" r="7.5" stroke="currentColor" stroke-width="1.6"/>
            <path d="M16 26l4-2.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            <circle cx="16" cy="26" r="1.2" fill="currentColor"/>
            <rect x="28" y="17" width="8" height="4" rx="1" stroke="currentColor" stroke-width="1.2"/>
            <rect x="28" y="23" width="8" height="4" rx="1" stroke="currentColor" stroke-width="1.2"/>
            <rect x="28" y="29" width="8" height="4" rx="1" stroke="currentColor" stroke-width="1.2"/>
            <path d="M9 40v2M35 40v2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </div>
        <div>Пока нет накоплений — добавьте первую цель</div>
      </div>
    `;
    return;
  }

  items.forEach(item => {
    const target = item.target || 0;
    const current = item.current || 0;
    const percent = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;

    let deadlineBadge = "";
    let cardClass = "savings-card";
    if (item.deadline) {
      const diff = daysUntil(item.deadline);
      if (diff < 0) {
        cardClass += " savings-card--overdue";
        deadlineBadge = `<span class="savings-deadline-badge overdue">Просрочено: ${formatDeadline(item.deadline)}</span>`;
      } else if (diff <= 7) {
        cardClass += " savings-card--soon";
        deadlineBadge = `<span class="savings-deadline-badge soon">Осталось ${diff} дн. (${formatDeadline(item.deadline)})</span>`;
      } else {
        deadlineBadge = `<span class="savings-deadline-badge">Срок: ${formatDeadline(item.deadline)}</span>`;
      }
    }

    const card = document.createElement("div");
    card.className = cardClass;
    card.innerHTML = `
      <div class="savings-card-header">
        <span class="savings-card-name">${escapeHtml(item.name)}</span>
        <button class="remove-btn" title="Удалить">✕</button>
      </div>
      <div class="savings-progress-bar">
        <div class="savings-progress-fill${percent >= 100 ? " complete" : ""}" style="width:${percent}%"></div>
      </div>
      <div class="savings-progress-label">${current.toLocaleString()} / ${target.toLocaleString()} ${item.currency} (${percent}%)</div>
      <div class="savings-card-footer">
        ${deadlineBadge || "<span></span>"}
        <div class="savings-card-actions">
          <button class="savings-topup-btn">+ Пополнить</button>
        </div>
      </div>
      <div class="savings-topup-form" style="display:none">
        <input type="number" min="0" step="any" placeholder="Сумма пополнения" class="savings-topup-input">
        <button class="savings-topup-confirm">Добавить</button>
      </div>
    `;

    card.querySelector(".remove-btn").addEventListener("click", () => {
      const updated = loadSavings().filter(i => i.id !== item.id);
      saveSavings(updated);
      renderSavings();
    });

    const topupForm = card.querySelector(".savings-topup-form");
    const topupInput = card.querySelector(".savings-topup-input");

    card.querySelector(".savings-topup-btn").addEventListener("click", () => {
      const isOpen = topupForm.style.display !== "none";
      topupForm.style.display = isOpen ? "none" : "flex";
      if (!isOpen) topupInput.focus();
    });

    function confirmTopup() {
      const amount = parseFloat(topupInput.value);
      if (isNaN(amount) || amount <= 0) return;

      const updated = loadSavings();
      const target = updated.find(i => i.id === item.id);
      if (target) {
        target.current = (target.current || 0) + amount;
        if (!target.history) target.history = [];
        target.history.push({ date: toDateKey(new Date()), amount });
        saveSavings(updated);
        renderSavings();
      }
    }

    card.querySelector(".savings-topup-confirm").addEventListener("click", confirmTopup);
    topupInput.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        confirmTopup();
      }
    });

    list.appendChild(card);
  });
}

document.getElementById("savingsForm").addEventListener("submit", e => {
  e.preventDefault();
  const savingsCurrencyEl = document.getElementById("savingsCurrency");
  const savingsErrorEl = document.getElementById("savingsFormError");

  const name = document.getElementById("savingsName").value.trim();
  const target = parseFloat(document.getElementById("savingsTarget").value);
  const current = parseFloat(document.getElementById("savingsCurrent").value) || 0;
  const currency = savingsCurrencyEl.value.trim().toUpperCase();
  const deadline = document.getElementById("savingsDeadline").value || null;

  if (savingsErrorEl) savingsErrorEl.textContent = "";

  if (!name || isNaN(target) || target <= 0 || current < 0) return;

  if (currencyList.length && !currencyList.includes(currency)) {
    if (savingsErrorEl) {
      savingsErrorEl.textContent = "Неизвестный код валюты. Проверьте написание (напр. USD, EUR, RUB).";
    }
    return;
  }

  const items = loadSavings();
  const newItem = { id: Date.now().toString(), name, target, current, currency, deadline };
  if (current > 0) newItem.history = [{ date: toDateKey(new Date()), amount: current }];
  items.push(newItem);
  saveSavings(items);
  renderSavings();

  e.target.reset();
  savingsCurrencyEl.value = currency;
});

// ---------- Planner (ежедневник) ----------
const TASKS_KEY = "planner_tasks";

const RU_MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const RU_MONTHS_SHORT = ["янв.", "февр.", "мар.", "апр.", "мая", "июн.",
  "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."];
const RU_WEEKDAYS_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

let plannerRefDate = new Date();

function loadTasks() {
  try {
    return JSON.parse(localStorage.getItem(TASKS_KEY)) || [];
  } catch {
    return [];
  }
}

function saveTasks(tasks) {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
}

function addTask(text, dateKey) {
  const tasks = loadTasks();
  tasks.push({ id: Date.now().toString() + Math.random().toString(36).slice(2, 6), text, date: dateKey });
  saveTasks(tasks);
}

function toDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function createTaskEl(task, options = {}) {
  const todayKey = toDateKey(new Date());
  const isOverdue = task.date && task.date < todayKey;

  const el = document.createElement("div");
  el.className = "planner-task"
    + (isOverdue ? " planner-task--overdue" : "")
    + (task.completed ? " planner-task--completed" : "");
  el.draggable = true;
  el.dataset.id = task.id;

  const deadlineLabel = options.showDate && task.date
    ? `<span class="planner-task-deadline">Срок: ${formatDeadline(task.date)}</span>`
    : "";

  el.innerHTML = `
    <button type="button" class="planner-task-check" title="Отметить выполненной"></button>
    <div class="planner-task-body">
      <span class="planner-task-text">${escapeHtml(task.text)}</span>
      ${deadlineLabel}
    </div>
    <button type="button" class="planner-task-delete" title="Удалить">✕</button>
  `;

  el.querySelector(".planner-task-check").addEventListener("click", e => {
    e.stopPropagation();
    const tasks = loadTasks();
    const t = tasks.find(x => x.id === task.id);
    if (t) {
      t.completed = !t.completed;
      saveTasks(tasks);
      renderPlanner();
      renderHome();
    }
  });

  el.querySelector(".planner-task-delete").addEventListener("click", e => {
    e.stopPropagation();
    saveTasks(loadTasks().filter(t => t.id !== task.id));
    renderPlanner();
    renderHome();
  });

  el.addEventListener("dragstart", e => {
    e.dataTransfer.setData("text/plain", task.id);
  });

  return el;
}

function attachDropZone(el, dateKey) {
  el.addEventListener("dragover", e => {
    e.preventDefault();
    el.classList.add("drag-over");
  });
  el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
  el.addEventListener("drop", e => {
    e.preventDefault();
    el.classList.remove("drag-over");
    const id = e.dataTransfer.getData("text/plain");
    const tasks = loadTasks();
    const task = tasks.find(t => t.id === id);
    if (task) {
      task.date = dateKey;
      saveTasks(tasks);
      renderPlanner();
    }
  });
}

function renderPlanner() {
  const weekStart = startOfWeek(plannerRefDate);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    days.push(d);
  }

  const midDate = days[3];
  document.getElementById("plannerMonthYear").textContent =
    `${RU_MONTHS[midDate.getMonth()]} ${midDate.getFullYear()}`;

  const tasks = loadTasks();
  const grid = document.getElementById("plannerGrid");
  grid.innerHTML = "";
  const todayKey = toDateKey(new Date());

  days.forEach(d => {
    const key = toDateKey(d);
    const isToday = key === todayKey;
    const dayTasks = tasks.filter(t => t.date === key);

    const col = document.createElement("div");
    col.className = "planner-day" + (isToday ? " today" : "");

    const header = document.createElement("div");
    header.className = "planner-day-header";
    header.innerHTML = `
      <span class="planner-day-date">${d.getDate()} ${RU_MONTHS_SHORT[d.getMonth()]}</span>
      <span class="planner-day-weekday">${RU_WEEKDAYS_SHORT[(d.getDay() + 6) % 7]}</span>
    `;
    col.appendChild(header);

    const list = document.createElement("div");
    list.className = "planner-day-tasks";
    list.dataset.date = key;

    dayTasks.forEach(task => list.appendChild(createTaskEl(task)));

    const addInput = document.createElement("input");
    addInput.type = "text";
    addInput.className = "planner-day-add";
    addInput.placeholder = "+ Добавить";
    addInput.addEventListener("keydown", e => {
      if (e.key === "Enter" && addInput.value.trim()) {
        addTask(addInput.value.trim(), key);
        renderPlanner();
      }
    });
    list.appendChild(addInput);

    attachDropZone(list, key);
    col.appendChild(list);
    grid.appendChild(col);
  });

  const somedayList = document.getElementById("somedayList");
  somedayList.innerHTML = "";
  tasks.filter(t => !t.date).forEach(task => somedayList.appendChild(createTaskEl(task)));
  attachDropZone(somedayList, null);

  const overdueBlock = document.getElementById("plannerOverdueBlock");
  const overdueList = document.getElementById("plannerOverdueList");
  const overdueTasks = tasks.filter(t => t.date && t.date < todayKey);

  overdueList.innerHTML = "";
  if (overdueTasks.length > 0) {
    overdueBlock.style.display = "block";
    overdueTasks
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach(task => overdueList.appendChild(createTaskEl(task, { showDate: true })));
  } else {
    overdueBlock.style.display = "none";
  }

  if (typeof renderHomeCalendar === "function") {
    renderHomeCalendar();
    renderHomeToday();
    renderHomeDeadlines();
  }
}

document.getElementById("plannerPrevBtn").addEventListener("click", () => {
  plannerRefDate.setDate(plannerRefDate.getDate() - 7);
  renderPlanner();
});
document.getElementById("plannerNextBtn").addEventListener("click", () => {
  plannerRefDate.setDate(plannerRefDate.getDate() + 7);
  renderPlanner();
});
document.getElementById("somedayInput").addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target.value.trim()) {
    addTask(e.target.value.trim(), null);
    e.target.value = "";
    renderPlanner();
  }
});

document.getElementById("deadlineForm").addEventListener("submit", e => {
  e.preventDefault();
  const textInput = document.getElementById("deadlineTaskText");
  const dateInput = document.getElementById("deadlineTaskDate");

  const text = textInput.value.trim();
  const date = dateInput.value;
  if (!text || !date) return;

  addTask(text, date);

  // Переходим на неделю с этой датой, чтобы сразу увидеть добавленное дело
  const [y, m, d] = date.split("-").map(Number);
  plannerRefDate = new Date(y, m - 1, d);
  renderPlanner();

  e.target.reset();
});

// ---------- Study (новости из Telegram-каналов) ----------
let studyLoaded = false;
const STUDY_CHANNELS_KEY = "study_channels";

function loadStudyChannels() {
  try {
    const raw = localStorage.getItem(STUDY_CHANNELS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveStudyChannels(list) {
  localStorage.setItem(STUDY_CHANNELS_KEY, JSON.stringify(list));
}

// Принимает ссылку (https://t.me/name, t.me/name), @name или просто name
// и возвращает "чистое" имя канала.
function extractChannelUsername(input) {
  let value = input.trim();
  value = value.replace(/^https?:\/\//i, "");
  value = value.replace(/^t\.me\//i, "");
  value = value.replace(/^@/, "");
  value = value.split(/[/?#]/)[0];
  return value.trim();
}

function renderStudyChannels() {
  const listEl = document.getElementById("studyChannelsList");
  const channels = loadStudyChannels();

  if (channels.length === 0) {
    listEl.innerHTML = `<div class="empty-hint">Пока используются каналы по умолчанию. Добавьте свой, чтобы видеть только нужные.</div>`;
    return;
  }

  listEl.innerHTML = "";
  channels.forEach(name => {
    const chip = document.createElement("div");
    chip.className = "study-channel-chip";
    chip.innerHTML = `<span>@${escapeHtml(name)}</span><button type="button" title="Удалить">✕</button>`;
    chip.querySelector("button").addEventListener("click", () => removeStudyChannel(name));
    listEl.appendChild(chip);
  });
}

function removeStudyChannel(name) {
  const channels = loadStudyChannels().filter(c => c !== name);
  saveStudyChannels(channels);
  renderStudyChannels();
  loadStudyNews();
}

document.getElementById("studyChannelForm").addEventListener("submit", e => {
  e.preventDefault();
  const input = document.getElementById("studyChannelInput");
  const errorEl = document.getElementById("studyChannelError");
  errorEl.textContent = "";

  const name = extractChannelUsername(input.value);
  if (!name) {
    errorEl.textContent = "Вставьте ссылку на канал или его @имя.";
    return;
  }

  const channels = loadStudyChannels();
  if (channels.includes(name)) {
    errorEl.textContent = "Этот канал уже добавлен.";
    return;
  }

  channels.push(name);
  saveStudyChannels(channels);
  input.value = "";
  renderStudyChannels();
  loadStudyNews();
});

function formatStudyDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleString("ru-RU", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function renderStudyData(data) {
  const listEl = document.getElementById("studyList");
  const errorEl = document.getElementById("studyError");
  const metaEl = document.getElementById("studyMeta");
  errorEl.textContent = "";
  listEl.innerHTML = "";

  if (!data.posts || data.posts.length === 0) {
    listEl.innerHTML = `<div class="empty-hint">Постов пока нет.</div>`;
  } else {
    data.posts.forEach(post => {
      const card = document.createElement("div");
      card.className = "study-post";
      card.innerHTML = `
        <div class="study-post-header">
          <span class="study-post-channel">@${escapeHtml(post.channel)}</span>
          <span>${formatStudyDate(post.date)}</span>
        </div>
        <div class="study-post-text">${escapeHtml(post.text) || "(пост без текста — фото/видео)"}</div>
        <a class="study-post-link" href="${post.link}" target="_blank" rel="noopener">Открыть в Telegram →</a>
      `;
      listEl.appendChild(card);
    });
  }

  if (data.errors && data.errors.length > 0) {
    const failedChannels = data.errors.map(e => e.channel || "?").join(", ");
    errorEl.textContent = `Не удалось загрузить каналы: ${failedChannels}`;
  }

  const updatedTime = data.updatedAt
    ? new Date(data.updatedAt).toLocaleString("ru-RU")
    : new Date().toLocaleTimeString("ru-RU");
  metaEl.textContent = `Постов: ${data.posts ? data.posts.length : 0}. Обновлено: ${updatedTime}`;
  studyLoaded = true;
}

async function loadStudyNews() {
  const listEl = document.getElementById("studyList");
  const errorEl = document.getElementById("studyError");
  const metaEl = document.getElementById("studyMeta");

  errorEl.textContent = "";
  metaEl.textContent = "";
  listEl.innerHTML = `<div class="empty-hint">Загрузка новостей из Telegram...</div>`;

  const myChannels = loadStudyChannels();

  // Всегда пробуем живой запрос к server.py — там свежие новости.
  // Если сервер недоступен (напр. сайт открыт напрямую двойным кликом),
  // используем офлайн-файл study-news.js, обновляемый через update_news.bat.
  try {
    const url = myChannels.length > 0
      ? `/api/study-news?channels=${encodeURIComponent(myChannels.join(","))}`
      : "/api/study-news";
    const res = await apiFetch(url);
    if (!res.ok) throw new Error("network");
    const data = await res.json();
    renderStudyData(data);
  } catch (e) {
    let data = await loadStaticData("study");
    if (data) {
      if (myChannels.length > 0) {
        data = {
          ...data,
          posts: (data.posts || []).filter(p => myChannels.includes(p.channel)),
        };
      }
      renderStudyData(data);
    } else {
      listEl.innerHTML = "";
      metaEl.textContent = "";
      errorEl.textContent = "Нет данных о новостях." + SERVER_HINT;
    }
  }
}

document.getElementById("studyRefreshBtn").addEventListener("click", loadStudyNews);

renderStudyChannels();

tabBtns.forEach(btn => {
  if (btn.dataset.tab === "study") {
    btn.addEventListener("click", () => {
      if (!studyLoaded) loadStudyNews();
    });
  }
});

document.getElementById("weatherRefreshBtn").addEventListener("click", loadWeatherForecast);

tabBtns.forEach(btn => {
  if (btn.dataset.tab === "weather") {
    btn.addEventListener("click", () => {
      if (!weatherForecastLoaded) loadWeatherForecast();
    });
  }
});

// ---------- Заметки ----------
const NOTES_KEY = "notes_data";
let notesEditingId = null;
let notesPendingImage = null;

function loadNotes() {
  try {
    return JSON.parse(localStorage.getItem(NOTES_KEY)) || [];
  } catch {
    return [];
  }
}

function saveNotes(notes) {
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}

function resizeImageFile(file, maxWidth) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatNoteDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function renderNoteImageArea() {
  const area = document.getElementById("noteImageArea");
  if (notesPendingImage) {
    area.innerHTML = `
      <div class="note-image-preview-wrap">
        <img src="${notesPendingImage}" class="note-image-preview">
        <button type="button" id="noteImageRemoveBtn" class="note-image-remove" title="Убрать фото">✕</button>
      </div>
    `;
    document.getElementById("noteImageRemoveBtn").addEventListener("click", () => {
      notesPendingImage = null;
      renderNoteImageArea();
    });
  } else {
    area.innerHTML = `
      <button type="button" id="noteImageBtn" class="note-image-btn">+ Добавить фото</button>
      <input type="file" id="noteImageInput" accept="image/*" hidden>
    `;
    document.getElementById("noteImageBtn").addEventListener("click", () => {
      document.getElementById("noteImageInput").click();
    });
    document.getElementById("noteImageInput").addEventListener("change", async e => {
      const file = e.target.files[0];
      if (!file) return;
      notesPendingImage = await resizeImageFile(file, 900);
      renderNoteImageArea();
    });
  }
}

function openNoteModal(note) {
  notesEditingId = note ? note.id : null;
  notesPendingImage = note ? note.image : null;
  document.getElementById("noteModalTitleLabel").textContent = note ? "Заметка" : "Новая заметка";
  document.getElementById("noteTitleInput").value = note ? note.title : "";
  document.getElementById("noteTextInput").value = note ? note.text : "";
  document.getElementById("noteDeleteBtn").classList.toggle("hidden", !note);
  renderNoteImageArea();
  document.getElementById("noteModalOverlay").classList.add("open");
  document.getElementById("noteTitleInput").focus();
}

function closeNoteModal() {
  document.getElementById("noteModalOverlay").classList.remove("open");
  notesEditingId = null;
  notesPendingImage = null;
}

function renderNotes() {
  const grid = document.getElementById("notesGrid");
  const notes = loadNotes().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  if (notes.length === 0) {
    grid.innerHTML = `<div class="notes-empty">Пока нет заметок — создайте первую</div>`;
    return;
  }

  grid.innerHTML = "";
  notes.forEach(note => {
    const card = document.createElement("div");
    card.className = "note-card";
    card.innerHTML = `
      ${note.image ? `<img src="${note.image}" class="note-card-image">` : ""}
      ${note.title ? `<div class="note-card-title">${escapeHtml(note.title)}</div>` : ""}
      <div class="note-card-text">${escapeHtml(note.text || "")}</div>
      <div class="note-card-date">${formatNoteDate(note.updatedAt)}</div>
      <button type="button" class="note-card-delete" title="Удалить">✕</button>
    `;
    card.addEventListener("click", () => openNoteModal(note));
    card.querySelector(".note-card-delete").addEventListener("click", e => {
      e.stopPropagation();
      saveNotes(loadNotes().filter(n => n.id !== note.id));
      renderNotes();
    });
    grid.appendChild(card);
  });
}

document.getElementById("noteNewBtn").addEventListener("click", () => openNoteModal(null));
document.getElementById("noteModalCloseBtn").addEventListener("click", closeNoteModal);
document.getElementById("noteModalOverlay").addEventListener("click", e => {
  if (e.target.id === "noteModalOverlay") closeNoteModal();
});

document.getElementById("noteSaveBtn").addEventListener("click", () => {
  const title = document.getElementById("noteTitleInput").value.trim();
  const text = document.getElementById("noteTextInput").value.trim();
  if (!title && !text && !notesPendingImage) {
    closeNoteModal();
    return;
  }

  const notes = loadNotes();
  const now = new Date().toISOString();
  if (notesEditingId) {
    const note = notes.find(n => n.id === notesEditingId);
    if (note) {
      note.title = title;
      note.text = text;
      note.image = notesPendingImage;
      note.updatedAt = now;
    }
  } else {
    notes.push({
      id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
      title, text, image: notesPendingImage,
      updatedAt: now,
    });
  }
  saveNotes(notes);
  renderNotes();
  closeNoteModal();
});

document.getElementById("noteDeleteBtn").addEventListener("click", () => {
  if (!notesEditingId) return;
  saveNotes(loadNotes().filter(n => n.id !== notesEditingId));
  renderNotes();
  closeNoteModal();
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeNoteModal();
});

// ---------- Сырьё и металлы ----------
const TROY_OUNCE_GRAMS = 31.1035;
const COMMODITY_GROUPS = [
  { title: "Драгоценные металлы", items: [
    { symbol: "GC=F", name: "Золото", unit: "унц.", spot: "XAU", tv: "TVC:GOLD", perGram: true },
    { symbol: "SI=F", name: "Серебро", unit: "унц.", spot: "XAG", tv: "TVC:SILVER", perGram: true },
    { symbol: "PL=F", name: "Платина", unit: "унц.", spot: "XPT", tv: "TVC:PLATINUM", perGram: true },
    { symbol: "PA=F", name: "Палладий", unit: "унц.", spot: "XPD", tv: "TVC:PALLADIUM", perGram: true },
  ] },
  { title: "Промышленные металлы", items: [
    { symbol: "HG=F", name: "Медь", unit: "фунт", spot: "HG", tv: "COMEX:HG1!" },
    { symbol: "ALI=F", name: "Алюминий", unit: "тонна", tv: "COMEX:ALI1!" },
  ] },
  { title: "Энергоносители", items: [
    { symbol: "BZ=F", name: "Нефть Brent", unit: "баррель", tv: "TVC:UKOIL" },
    { symbol: "CL=F", name: "Нефть WTI", unit: "баррель", tv: "TVC:USOIL" },
    { symbol: "NG=F", name: "Газ Henry Hub (США)", unit: "MMBtu", tv: "NYMEX:NG1!" },
    { symbol: "TTF=F", name: "Газ TTF (Европа)", unit: "МВт·ч", tv: "ICEEUR:TFM1!" },
    { symbol: "HO=F", name: "Дизельное топливо", unit: "галлон", tv: "NYMEX:HO1!" },
    { symbol: "RB=F", name: "Бензин", unit: "галлон", tv: "NYMEX:RB1!" },
  ] },
  { title: "Сельхозсырьё", items: [
    { symbol: "ZW=F", name: "Пшеница", unit: "бушель", tv: "CBOT:ZW1!" },
    { symbol: "ZC=F", name: "Кукуруза", unit: "бушель", tv: "CBOT:ZC1!" },
    { symbol: "ZS=F", name: "Соя", unit: "бушель", tv: "CBOT:ZS1!" },
    { symbol: "KC=F", name: "Кофе", unit: "фунт", tv: "ICEUS:KC1!" },
    { symbol: "SB=F", name: "Сахар", unit: "фунт", tv: "ICEUS:SB1!" },
    { symbol: "CC=F", name: "Какао", unit: "тонна", tv: "ICEUS:CC1!" },
  ] },
];
const CURRENCY_SIGNS = { USD: "$", EUR: "€" };

let commoditiesLoaded = false;
let commoditiesLoading = false;

async function fetchCommodityFutures() {
  try {
    const res = await apiFetch("/api/commodities");
    if (!res.ok) throw new Error("network");
    return { data: await res.json(), live: true };
  } catch {
    const data = await loadStaticData("commodities");
    return data ? { data, live: false } : null;
  }
}

async function fetchSpotPrices() {
  const symbols = ["XAU", "XAG", "XPT", "XPD", "HG"];
  const results = await Promise.all(symbols.map(s =>
    fetch(`https://api.gold-api.com/price/${s}`)
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
  ));
  const map = {};
  results.forEach((r, i) => {
    if (r && typeof r.price === "number") map[symbols[i]] = r;
  });
  return map;
}

function formatCommodityPrice(value) {
  return value.toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 10 ? 3 : 2,
  });
}

function buildCommodityRow(item, quote, spot) {
  let price = null;
  let currency = "USD";
  let sourceHtml = "";

  if (spot) {
    price = spot.price;
    sourceHtml = `<span class="live-dot"></span>спот · реальное время`;
  } else if (quote) {
    price = quote.price;
    currency = quote.currency;
    if (currency === "USX") {
      price = price / 100;
      currency = "USD";
    }
    sourceHtml = quote.contract
      ? `биржа · контракт ${quote.contract} · задержка ~10 мин`
      : "биржа · задержка ~10 мин";
  }

  const row = document.createElement("div");
  row.className = "commodity-row";

  if (price === null) {
    row.innerHTML = `
      <div class="commodity-name"><div class="commodity-title">${item.name}</div></div>
      <div class="commodity-price"><div class="commodity-value">—</div></div>
      <div></div>
    `;
    return row;
  }

  let rubLine = "";
  const usd = currency === "USD" ? price : toUSD(price, currency);
  if (usd !== null && usdRates && usdRates.RUB) {
    const rub = item.perGram ? (usd / TROY_OUNCE_GRAMS) * usdRates.RUB : usd * usdRates.RUB;
    rubLine = `≈ ${rub.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} ₽${item.perGram ? "/г" : ""}`;
  }

  let changeHtml = `<div class="commodity-change"></div>`;
  if (quote && typeof quote.change === "number") {
    const cls = quote.change >= 0 ? "up" : "down";
    const sign = quote.change >= 0 ? "+" : "";
    changeHtml = `<div class="commodity-change market-item-change ${cls}">${sign}${quote.change.toFixed(2)}%</div>`;
  }

  row.innerHTML = `
    <div class="commodity-name">
      <div class="commodity-title">${watchStarHtml(commodityAsset(item))}${item.name}</div>
      <div class="commodity-source">${sourceHtml}</div>
    </div>
    <div class="commodity-price">
      <div class="commodity-value">${CURRENCY_SIGNS[currency] || ""}${formatCommodityPrice(price)}${CURRENCY_SIGNS[currency] ? "" : " " + currency}<span class="commodity-unit"> / ${item.unit}</span></div>
      ${rubLine ? `<div class="commodity-rub">${rubLine}</div>` : ""}
    </div>
    ${changeHtml}
  `;
  row.title = "Открыть график";
  row.addEventListener("click", () => openCommodityChart(item));
  return row;
}

async function loadCommodities(silent = false) {
  if (commoditiesLoading) return;
  commoditiesLoading = true;

  const listEl = document.getElementById("commoditiesList");
  const metaEl = document.getElementById("commoditiesMeta");
  const errorEl = document.getElementById("commoditiesError");
  if (!silent) {
    listEl.innerHTML = `<div class="empty-hint">Загрузка котировок...</div>`;
    metaEl.textContent = "";
  }

  const [futures, spot] = await Promise.all([fetchCommodityFutures(), fetchSpotPrices()]);
  commoditiesLoading = false;
  commoditiesLoaded = true;

  if (!futures && Object.keys(spot).length === 0) {
    listEl.innerHTML = "";
    errorEl.textContent = "Не удалось получить котировки. Проверьте интернет-соединение.";
    return;
  }
  errorEl.textContent = "";

  const quotes = {};
  (futures ? futures.data.items || [] : []).forEach(q => { quotes[q.symbol] = q; });

  listEl.innerHTML = "";
  COMMODITY_GROUPS.forEach(group => {
    const groupEl = document.createElement("div");
    groupEl.className = "commodity-group";
    groupEl.innerHTML = `<div class="commodity-group-title">${group.title}</div>`;
    group.items.forEach(item => {
      groupEl.appendChild(buildCommodityRow(item, quotes[item.symbol], item.spot ? spot[item.spot] : null));
    });
    listEl.appendChild(groupEl);
  });

  const time = new Date().toLocaleTimeString("ru-RU");
  let meta = `Обновлено в ${time} · автообновление каждые 30 секунд`;
  if (futures && !futures.live) {
    meta += ` · ${staticDataNote(futures.data, "биржевые данные")}`;
  } else if (!futures) {
    meta += ` · биржевые котировки недоступны${IS_HOSTED ? "" : " — запустите server.py"}`;
  }
  metaEl.textContent = meta;
}

function openCommodityChart(item) {
  document.getElementById("commoditiesListView").style.display = "none";
  document.getElementById("commoditiesChartView").style.display = "block";
  document.getElementById("commoditiesChartTitle").textContent = item.name;

  const container = document.getElementById("commoditiesChartContainer");
  container.innerHTML = "";

  if (typeof TradingView === "undefined") {
    container.innerHTML = `<div class="empty-hint">Не удалось загрузить график (нет соединения с TradingView — возможно, его блокирует блокировщик рекламы).</div>`;
    return;
  }

  new TradingView.widget({
    symbol: item.tv,
    container_id: "commoditiesChartContainer",
    autosize: true,
    interval: "60",
    timezone: "Etc/UTC",
    theme: appSettings.theme === "light" ? "light" : "dark",
    style: "1",
    locale: "ru",
    hide_top_toolbar: false,
    hide_legend: false,
    allow_symbol_change: false,
  });
}

document.getElementById("commoditiesBackBtn").addEventListener("click", () => {
  document.getElementById("commoditiesChartView").style.display = "none";
  document.getElementById("commoditiesListView").style.display = "block";
  document.getElementById("commoditiesChartContainer").innerHTML = "";
});

document.getElementById("commoditiesRefreshBtn").addEventListener("click", () => loadCommodities());

tabBtns.forEach(btn => {
  if (btn.dataset.tab === "commodities") {
    btn.addEventListener("click", () => {
      if (!commoditiesLoaded) loadCommodities();
    });
  }
});

setInterval(() => {
  const section = document.getElementById("commodities");
  const listVisible = document.getElementById("commoditiesListView").style.display !== "none";
  if (section.classList.contains("active") && listVisible) loadCommodities(true);
}, 30000);

// ---------- Фондовые индексы ----------
const INDEX_GROUPS = [
  { title: "Россия", items: [
    { source: "moex", symbol: "IMOEX", name: "Индекс Мосбиржи", sub: "IMOEX · в рублях", tv: "MOEX:IMOEX" },
    { source: "moex", symbol: "RTSI", name: "Индекс РТС", sub: "RTSI · в долларах", tv: "MOEX:RTSI" },
  ] },
  { title: "США", items: [
    { symbol: "^GSPC", name: "S&P 500", sub: "500 крупнейших компаний США", tv: "SP:SPX" },
    { symbol: "^IXIC", name: "NASDAQ Composite", sub: "технологический сектор", tv: "NASDAQ:IXIC" },
    { symbol: "^DJI", name: "Dow Jones", sub: "30 крупнейших корпораций", tv: "DJ:DJI" },
    { symbol: "^VIX", name: "VIX", sub: "«индекс страха»: чем выше, тем тревожнее рынок", tv: "TVC:VIX" },
  ] },
  { title: "Европа", items: [
    { symbol: "^GDAXI", name: "DAX", sub: "Германия", tv: "XETR:DAX" },
    { symbol: "^FTSE", name: "FTSE 100", sub: "Великобритания", tv: "TVC:UKX" },
    { symbol: "^FCHI", name: "CAC 40", sub: "Франция", tv: "EURONEXT:PX1" },
    { symbol: "^STOXX50E", name: "Euro Stoxx 50", sub: "крупнейшие компании еврозоны", tv: "TVC:SX5E" },
  ] },
  { title: "Азия", items: [
    { symbol: "^N225", name: "Nikkei 225", sub: "Япония", tv: "TVC:NI225" },
    { symbol: "^HSI", name: "Hang Seng", sub: "Гонконг", tv: "TVC:HSI" },
    { symbol: "000001.SS", name: "Shanghai Composite", sub: "Китай", tv: "SSE:000001" },
  ] },
];

let indicesLoaded = false;
let indicesLoading = false;

async function fetchWorldIndices() {
  try {
    const res = await apiFetch("/api/indices");
    if (!res.ok) throw new Error("network");
    return { data: await res.json(), live: true };
  } catch {
    const data = await loadStaticData("indices");
    return data ? { data, live: false } : null;
  }
}

async function fetchMoexIndices() {
  const cols = "SECID,CURRENTVALUE,LASTVALUE,LASTCHANGE,LASTCHANGEPRC,HIGH,LOW,VALTODAY,SYSTIME";
  const marketUrl = "https://iss.moex.com/iss/engines/stock/markets/index/securities.json"
    + `?securities=IMOEX,RTSI&iss.meta=off&iss.only=marketdata&marketdata.columns=${cols}`;
  const from = new Date();
  from.setDate(from.getDate() - 7);
  const candlesUrl = secid => `https://iss.moex.com/iss/engines/stock/markets/index/securities/${secid}/candles.json`
    + `?interval=60&from=${toDateKey(from)}&iss.meta=off&candles.columns=close`;

  try {
    const [market, imoexCandles, rtsiCandles] = await Promise.all(
      [marketUrl, candlesUrl("IMOEX"), candlesUrl("RTSI")].map(u => fetch(u).then(r => r.json()))
    );
    const sparks = {
      IMOEX: imoexCandles.candles.data.map(row => row[0]),
      RTSI: rtsiCandles.candles.data.map(row => row[0]),
    };

    const result = {};
    const colIndex = Object.fromEntries(market.marketdata.columns.map((c, i) => [c, i]));
    market.marketdata.data.forEach(row => {
      const get = name => row[colIndex[name]];
      // SYSTIME — московское время (UTC+3 без перехода на летнее)
      const updated = get("SYSTIME") ? new Date(get("SYSTIME").replace(" ", "T") + "+03:00") : null;
      result[get("SECID")] = {
        price: get("CURRENTVALUE") ?? get("LASTVALUE"),
        change: get("LASTCHANGEPRC"),
        changeAbs: get("LASTCHANGE"),
        dayHigh: get("HIGH"),
        dayLow: get("LOW"),
        // VALTODAY — общий оборот рынка акций, одинаковый для обоих индексов
        turnover: get("SECID") === "IMOEX" ? get("VALTODAY") : null,
        updated,
        isOpen: updated ? Date.now() - updated.getTime() < 20 * 60 * 1000 : false,
        spark: sparks[get("SECID")] || [],
      };
    });
    return result;
  } catch {
    return null;
  }
}

function formatIndexValue(value) {
  return value.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatQuoteTime(date) {
  if (!date) return "";
  const time = date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === new Date().toDateString()) return time;
  return `${date.getDate()} ${RU_MONTHS_SHORT[date.getMonth()]}, ${time}`;
}

function buildSparkline(values) {
  if (!values || values.length < 2) return "";
  const W = 200, H = 40;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = H - 3 - ((v - min) / (max - min || 1)) * (H - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const cls = values[values.length - 1] >= values[0] ? "up" : "down";
  return `
    <svg class="index-spark index-spark--${cls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <path d="M0,${H} L${pts.join(" L")} L${W},${H} Z" class="index-spark-area"></path>
      <polyline points="${pts.join(" ")}" class="index-spark-line"></polyline>
    </svg>
  `;
}

function buildIndexCard(item, q) {
  const card = document.createElement("div");
  card.className = "index-card";

  if (!q || q.price == null) {
    card.innerHTML = `
      <div class="index-name">${item.name}</div>
      <div class="index-sub">${item.sub}</div>
      <div class="empty-hint">Нет данных</div>
    `;
    return card;
  }

  const up = q.change >= 0;
  const sign = up ? "+" : "";
  const fmt = v => v.toLocaleString("ru-RU", { maximumFractionDigits: v < 100 ? 2 : 0 });
  const range = (lo, hi) => (lo != null && hi != null) ? `${fmt(lo)} – ${fmt(hi)}` : null;

  const foot = [];
  if (q.spark && q.spark.length >= 2) {
    const weekChange = ((q.spark[q.spark.length - 1] - q.spark[0]) / q.spark[0]) * 100;
    const weekCls = weekChange >= 0 ? "up" : "down";
    foot.push(`За 5 дней: <span class="market-item-change ${weekCls}">${weekChange >= 0 ? "+" : ""}${weekChange.toFixed(2)}%</span>`);
  }
  const day = range(q.dayLow, q.dayHigh);
  if (day) foot.push(`День: ${day}`);
  const year = range(q.yearLow, q.yearHigh);
  if (year) foot.push(`52 нед.: ${year}`);
  if (q.turnover) foot.push(`Оборот: ${(q.turnover / 1e9).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} млрд ₽`);

  card.innerHTML = `
    <div class="index-card-head">
      <div>
        <div class="index-name">${item.name}</div>
        <div class="index-sub">${item.sub}</div>
      </div>
      <div class="index-card-side">
        <div class="index-status ${q.isOpen ? "open" : ""}">
          <span class="index-status-dot"></span>${q.isOpen ? "торги идут" : "закрыто"}
        </div>
        ${watchStarHtml(indexAsset(item))}
      </div>
    </div>
    <div class="index-value-row">
      <div class="index-value">${formatIndexValue(q.price)}</div>
      <div class="index-change market-item-change ${up ? "up" : "down"}">
        ${sign}${q.change.toFixed(2)}%
        <span class="index-change-abs">${sign}${formatIndexValue(q.changeAbs)}</span>
      </div>
    </div>
    ${buildSparkline(q.spark)}
    <div class="index-foot">${foot.join(" · ")}${q.updated ? ` · данные на ${formatQuoteTime(q.updated)}` : ""}</div>
  `;
  card.title = "Открыть график";
  card.addEventListener("click", () => openIndexChart(item));
  return card;
}

async function loadIndices(silent = false) {
  if (indicesLoading) return;
  indicesLoading = true;

  const listEl = document.getElementById("indicesList");
  const metaEl = document.getElementById("indicesMeta");
  const errorEl = document.getElementById("indicesError");
  const summaryEl = document.getElementById("indicesSummary");
  if (!silent) {
    listEl.innerHTML = `<div class="empty-hint">Загрузка индексов...</div>`;
    metaEl.textContent = "";
    summaryEl.innerHTML = "";
  }

  const [world, moex] = await Promise.all([fetchWorldIndices(), fetchMoexIndices()]);
  indicesLoading = false;
  indicesLoaded = true;

  if (!world && !moex) {
    listEl.innerHTML = "";
    errorEl.textContent = "Не удалось получить данные по индексам. Проверьте интернет-соединение.";
    return;
  }
  errorEl.textContent = "";

  const quotes = {};
  (world ? world.data.items || [] : []).forEach(q => {
    quotes[q.symbol] = { ...q, updated: q.marketTime ? new Date(q.marketTime * 1000) : null };
  });

  let upCount = 0;
  let downCount = 0;
  listEl.innerHTML = "";
  INDEX_GROUPS.forEach(group => {
    const groupEl = document.createElement("div");
    groupEl.className = "indices-group";
    groupEl.innerHTML = `<div class="indices-group-title">${group.title}</div>`;
    const grid = document.createElement("div");
    grid.className = "indices-grid";

    group.items.forEach(item => {
      const q = item.source === "moex" ? moex && moex[item.symbol] : quotes[item.symbol];
      if (q && q.price != null && item.symbol !== "^VIX") {
        if (q.change >= 0) upCount++; else downCount++;
      }
      grid.appendChild(buildIndexCard(item, q));
    });

    groupEl.appendChild(grid);
    listEl.appendChild(groupEl);
  });

  summaryEl.innerHTML = `
    <span>Общая картина:</span>
    <span class="indices-chip up">растут ${upCount}</span>
    <span class="indices-chip down">падают ${downCount}</span>
  `;

  let meta = `Обновлено в ${new Date().toLocaleTimeString("ru-RU")} · автообновление каждые 30 секунд`;
  if (world && !world.live) {
    meta += ` · ${staticDataNote(world.data, "мировые индексы")}`;
  } else if (!world) {
    meta += ` · мировые индексы недоступны${IS_HOSTED ? "" : " — запустите server.py"}`;
  }
  metaEl.textContent = meta;
}

function openIndexChart(item) {
  document.getElementById("indicesListView").style.display = "none";
  document.getElementById("indicesChartView").style.display = "block";
  document.getElementById("indicesChartTitle").textContent = item.name;

  const container = document.getElementById("indicesChartContainer");
  container.innerHTML = "";

  if (typeof TradingView === "undefined") {
    container.innerHTML = `<div class="empty-hint">Не удалось загрузить график (нет соединения с TradingView — возможно, его блокирует блокировщик рекламы).</div>`;
    return;
  }

  new TradingView.widget({
    symbol: item.tv,
    container_id: "indicesChartContainer",
    autosize: true,
    interval: "D",
    timezone: "Etc/UTC",
    theme: appSettings.theme === "light" ? "light" : "dark",
    style: "1",
    locale: "ru",
    hide_top_toolbar: false,
    hide_legend: false,
    allow_symbol_change: false,
  });
}

document.getElementById("indicesBackBtn").addEventListener("click", () => {
  document.getElementById("indicesChartView").style.display = "none";
  document.getElementById("indicesListView").style.display = "block";
  document.getElementById("indicesChartContainer").innerHTML = "";
});

document.getElementById("indicesRefreshBtn").addEventListener("click", () => loadIndices());

tabBtns.forEach(btn => {
  if (btn.dataset.tab === "indices") {
    btn.addEventListener("click", () => {
      if (!indicesLoaded) loadIndices();
    });
  }
});

setInterval(() => {
  const section = document.getElementById("indices");
  const listVisible = document.getElementById("indicesListView").style.display !== "none";
  if (section.classList.contains("active") && listVisible) loadIndices(true);
}, 30000);

// ---------- Облигации и ставки ----------
const RU_MONTHS_GENITIVE = ["января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const OFZ_TERM_SHORT = { 0.25: "3м", 0.5: "6м", 0.75: "9м", 1: "1г", 2: "2г", 3: "3г", 5: "5л", 7: "7л", 10: "10л", 15: "15л", 20: "20л", 30: "30л" };
const OFZ_TERM_LONG = { 0.25: "3 месяца", 0.5: "6 месяцев", 0.75: "9 месяцев", 1: "1 год", 2: "2 года", 3: "3 года", 5: "5 лет", 7: "7 лет", 10: "10 лет", 15: "15 лет", 20: "20 лет", 30: "30 лет" };

let ratesLoaded = false;
let ratesState = null;

async function fetchCbrRates() {
  try {
    const res = await apiFetch("/api/rates");
    if (!res.ok) throw new Error("network");
    return { data: await res.json(), live: true };
  } catch {
    const data = await loadStaticData("rates");
    return data ? { data, live: false } : null;
  }
}

async function fetchOfzData() {
  try {
    const res = await fetch("https://iss.moex.com/iss/engines/stock/zcyc.json?iss.meta=off&iss.only=yearyields,securities");
    const d = await res.json();
    const yc = name => d.yearyields.columns.indexOf(name);
    const sc = name => d.securities.columns.indexOf(name);

    const curve = d.yearyields.data
      .map(r => ({ years: r[yc("period")], value: r[yc("value")] }))
      .sort((a, b) => a.years - b.years);
    const bonds = d.securities.data
      .map(r => ({
        name: r[sc("shortname")],
        maturity: r[sc("expdate")],
        price: r[sc("trdprice")] ?? r[sc("crtprice")],
        yield: r[sc("trdyield")] ?? r[sc("crtyield")],
        duration: r[sc("crtduration")],
      }))
      .sort((a, b) => a.maturity.localeCompare(b.maturity));
    const first = d.yearyields.data[0];
    const asOf = first ? `${first[yc("tradedate")]}T${first[yc("tradetime")]}` : null;

    return { curve, bonds, asOf };
  } catch {
    return null;
  }
}

function formatPct(value, digits = 2) {
  return `${value.toLocaleString("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

function formatRuDate(isoDate) {
  const d = parseLocalDate(isoDate);
  return `${d.getDate()} ${RU_MONTHS_GENITIVE[d.getMonth()]} ${d.getFullYear()}`;
}

function formatDecade(label) {
  const [roman, month] = label.split(".");
  return `${roman} декада ${RU_MONTHS_GENITIVE[Number(month) - 1]}`;
}

function formatRub(value) {
  return `${Math.round(value).toLocaleString("ru-RU")} ₽`;
}

function curveYieldAt(curve, years) {
  if (!curve || curve.length === 0) return null;
  if (years <= curve[0].years) return curve[0].value;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1];
    const b = curve[i];
    if (years <= b.years) return a.value + ((years - a.years) / (b.years - a.years)) * (b.value - a.value);
  }
  return curve[curve.length - 1].value;
}

function rateTile(label, value, sub, color) {
  return `
    <div class="rate-tile">
      ${color ? `<span class="rate-tile-mark" style="background:${color}"></span>` : ""}
      <div class="rate-tile-label">${label}</div>
      <div class="rate-tile-value">${value}</div>
      <div class="rate-tile-sub">${sub}</div>
    </div>
  `;
}

function renderRatesCards() {
  const el = document.getElementById("ratesCards");
  const { cbr, curve } = ratesState;
  const tiles = [];

  const key = cbr && cbr.keyRate;
  if (key) {
    let sub = `с ${formatRuDate(key.since)}`;
    if (key.previous != null) {
      const dir = key.current < key.previous ? "снижена" : "повышена";
      sub += ` · ${dir} с ${formatPct(key.previous)}`;
    }
    tiles.push(rateTile("Ключевая ставка ЦБ", formatPct(key.current), sub, "var(--series-1)"));
  }

  const infl = cbr && cbr.inflation;
  if (infl) {
    const [year, month] = infl.month.split("-");
    const monthName = RU_MONTHS[Number(month) - 1].toLowerCase();
    tiles.push(rateTile("Инфляция, годовая", formatPct(infl.current),
      `${monthName} ${year} · цель ЦБ — ${formatPct(infl.target, 0)}`, "var(--series-2)"));
  }

  const dep = cbr && cbr.deposits;
  if (dep) {
    let sub = `макс. ставка топ-10 банков, ${formatDecade(dep.decade)}`;
    if (infl) {
      const diff = dep.current - infl.current;
      sub += ` · ${diff >= 0 ? "выше" : "ниже"} инфляции на ${Math.abs(diff).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} п.п.`;
    }
    tiles.push(rateTile("Вклады", formatPct(dep.current), sub, "var(--series-3)"));
  }

  if (curve && curve.length) {
    const y1 = curveYieldAt(curve, 1);
    const y3 = curveYieldAt(curve, 3);
    const y10 = curveYieldAt(curve, 10);
    tiles.push(rateTile("Доходность ОФЗ на 1 год", formatPct(y1),
      `на 3 года — ${formatPct(y3)} · на 10 лет — ${formatPct(y10)}`, null));
  }

  el.innerHTML = tiles.join("");
}

function niceTop(value, step) {
  return Math.ceil(value / step) * step;
}

function positionTooltip(tooltip, wrap, px, py) {
  const w = tooltip.offsetWidth;
  const left = px + 14 + w > wrap.clientWidth ? px - 14 - w : px + 14;
  tooltip.style.left = `${Math.max(0, left)}px`;
  tooltip.style.top = `${Math.max(0, py - 10)}px`;
}

function renderRatesChart() {
  const el = document.getElementById("ratesChart");
  const cbr = ratesState.cbr;
  if (!cbr) {
    el.innerHTML = `<div class="empty-hint">Данные Банка России недоступны.${SERVER_HINT}</div>`;
    return;
  }

  const DAY = 86400000;
  const series = [
    { name: "Ключевая ставка", color: "var(--series-1)", step: true, raw: cbr.keyRate ? cbr.keyRate.history : [] },
    { name: "Инфляция", color: "var(--series-2)", raw: cbr.inflation ? cbr.inflation.history : [] },
    { name: "Вклады", color: "var(--series-3)", raw: cbr.deposits ? cbr.deposits.history : [] },
  ]
    .map(s => ({ ...s, points: s.raw.map(p => ({ t: parseLocalDate(p.date).getTime(), v: p.value })).sort((a, b) => a.t - b.t) }))
    .filter(s => s.points.length);

  const end = Math.max(...series.map(s => s.points[s.points.length - 1].t));
  const start = end - 730 * DAY;
  const valueAt = (s, t) => {
    let v = null;
    for (const p of s.points) {
      if (p.t <= t) v = p.v;
      else break;
    }
    return v;
  };

  series.forEach(s => {
    const inside = s.points.filter(p => p.t >= start && p.t <= end);
    const before = valueAt(s, start);
    s.visible = s.step && before != null ? [{ t: start, v: before }, ...inside] : inside;
  });

  const W = Math.max(320, el.clientWidth || 800);
  const H = 260;
  const m = { l: 40, r: 60, t: 12, b: 28 };
  const allValues = series.flatMap(s => s.visible.map(p => p.v));
  const maxV = niceTop(Math.max(...allValues), 5);
  const x = t => m.l + ((t - start) / (end - start)) * (W - m.l - m.r);
  const y = v => m.t + (1 - v / maxV) * (H - m.t - m.b);

  let grid = "";
  for (let v = 0; v <= maxV; v += 5) {
    grid += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" class="chart-grid"></line>`;
    grid += `<text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end" class="chart-axis-label">${v}%</text>`;
  }

  let ticks = "";
  const tick = new Date(start);
  tick.setDate(1);
  tick.setMonth(tick.getMonth() + 1);
  while (tick.getTime() <= end) {
    if (tick.getMonth() % 3 === 0) {
      const tx = x(tick.getTime());
      ticks += `<text x="${tx}" y="${H - 8}" text-anchor="middle" class="chart-axis-label">${RU_MONTHS_SHORT[tick.getMonth()].replace(".", "")} ${String(tick.getFullYear()).slice(2)}</text>`;
    }
    tick.setMonth(tick.getMonth() + 1);
  }

  let lines = "";
  const ends = [];
  series.forEach(s => {
    const pts = s.visible;
    let d = `M${x(pts[0].t).toFixed(1)},${y(pts[0].v).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      d += s.step
        ? ` H${x(pts[i].t).toFixed(1)} V${y(pts[i].v).toFixed(1)}`
        : ` L${x(pts[i].t).toFixed(1)},${y(pts[i].v).toFixed(1)}`;
    }
    const last = pts[pts.length - 1];
    const lastX = s.step ? x(end) : x(last.t);
    if (s.step) d += ` H${lastX.toFixed(1)}`;
    lines += `<path d="${d}" class="chart-line" style="stroke:${s.color}"></path>`;
    ends.push({ x: lastX, y: y(last.v), labelY: y(last.v), value: last.v, color: s.color });
  });

  // Раздвигаем подписи на концах линий, чтобы они не наезжали друг на друга
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) {
    if (ends[i].labelY - ends[i - 1].labelY < 14) ends[i].labelY = ends[i - 1].labelY + 14;
  }
  const endMarks = ends.map(e => `
    <circle cx="${e.x}" cy="${e.y}" r="4" class="chart-dot" style="fill:${e.color}"></circle>
    <text x="${W - m.r + 8}" y="${e.labelY + 4}" class="chart-end-label">${formatPct(e.value)}</text>
  `).join("");

  el.innerHTML = `
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="chart-svg">
      ${grid}${ticks}${lines}
      <line class="chart-crosshair" y1="${m.t}" y2="${H - m.b}" x1="0" x2="0" style="display:none"></line>
      ${endMarks}
      <rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" class="chart-hit"></rect>
    </svg>
    <div class="chart-tooltip" style="display:none"></div>
  `;

  const svg = el.querySelector("svg");
  const cross = el.querySelector(".chart-crosshair");
  const tooltip = el.querySelector(".chart-tooltip");
  const hit = el.querySelector(".chart-hit");

  hit.addEventListener("pointermove", e => {
    const rect = svg.getBoundingClientRect();
    const px = Math.min(Math.max(e.clientX - rect.left, m.l), W - m.r);
    const t = start + ((px - m.l) / (W - m.l - m.r)) * (end - start);
    cross.setAttribute("x1", px);
    cross.setAttribute("x2", px);
    cross.style.display = "";

    const date = new Date(t);
    const rows = series.map(s => {
      const v = valueAt(s, t);
      return `<div class="chart-tooltip-row"><i class="legend-swatch" style="background:${s.color}"></i>${s.name}<b>${v != null ? formatPct(v) : "—"}</b></div>`;
    }).join("");
    tooltip.innerHTML = `<div class="chart-tooltip-title">${date.getDate()} ${RU_MONTHS_GENITIVE[date.getMonth()]} ${date.getFullYear()}</div>${rows}`;
    tooltip.style.display = "block";
    positionTooltip(tooltip, el, px, e.clientY - rect.top);
  });
  hit.addEventListener("pointerleave", () => {
    cross.style.display = "none";
    tooltip.style.display = "none";
  });
}

function renderOfzCurve() {
  const el = document.getElementById("ofzCurve");
  const curve = ratesState.curve;
  if (!curve || curve.length < 2) {
    el.innerHTML = `<div class="empty-hint">Данные Мосбиржи недоступны.</div>`;
    return;
  }

  const keyRate = ratesState.cbr && ratesState.cbr.keyRate ? ratesState.cbr.keyRate.current : null;
  const W = Math.max(280, el.clientWidth || 400);
  const H = 220;
  const m = { l: 40, r: 16, t: 20, b: 28 };
  const values = curve.map(p => p.value).concat(keyRate != null ? [keyRate] : []);
  const lo = Math.floor(Math.min(...values) - 0.5);
  const hi = Math.ceil(Math.max(...values) + 0.5);
  const step = hi - lo > 6 ? 2 : 1;
  const x = i => m.l + (i / (curve.length - 1)) * (W - m.l - m.r);
  const y = v => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);

  let grid = "";
  for (let v = lo; v <= hi; v += step) {
    grid += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" class="chart-grid"></line>`;
    grid += `<text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end" class="chart-axis-label">${v}%</text>`;
  }

  const labels = curve.map((p, i) => `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="chart-axis-label">${OFZ_TERM_SHORT[p.years] || p.years}</text>`).join("");
  const line = curve.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const dots = curve.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.value)}" r="4" class="chart-dot" style="fill:var(--series-1)"></circle>`).join("");
  const keyLine = keyRate != null ? `
    <line x1="${m.l}" x2="${W - m.r}" y1="${y(keyRate)}" y2="${y(keyRate)}" class="chart-ref-line"></line>
    <text x="${W - m.r}" y="${y(keyRate) - 6}" text-anchor="end" class="chart-axis-label">ключевая ${formatPct(keyRate)}</text>
  ` : "";
  const firstLast = [0, curve.length - 1].map(i => `
    <text x="${x(i) + (i === 0 ? 6 : -6)}" y="${y(curve[i].value) - 10}" text-anchor="${i === 0 ? "start" : "end"}" class="chart-end-label">${formatPct(curve[i].value)}</text>
  `).join("");

  el.innerHTML = `
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="chart-svg">
      ${grid}${keyLine}${labels}
      <polyline points="${line}" class="chart-line" style="stroke:var(--series-1)"></polyline>
      ${dots}${firstLast}
      <rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" class="chart-hit"></rect>
    </svg>
    <div class="chart-tooltip" style="display:none"></div>
  `;

  const svg = el.querySelector("svg");
  const tooltip = el.querySelector(".chart-tooltip");
  const hit = el.querySelector(".chart-hit");
  hit.addEventListener("pointermove", e => {
    const rect = svg.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round(((px - m.l) / (W - m.l - m.r)) * (curve.length - 1));
    const p = curve[Math.min(Math.max(i, 0), curve.length - 1)];
    tooltip.innerHTML = `<div class="chart-tooltip-title">ОФЗ на ${OFZ_TERM_LONG[p.years] || p.years + " лет"}</div><div class="chart-tooltip-row">Доходность<b>${formatPct(p.value)}</b></div>`;
    tooltip.style.display = "block";
    positionTooltip(tooltip, el, x(curve.indexOf(p)), y(p.value));
  });
  hit.addEventListener("pointerleave", () => { tooltip.style.display = "none"; });
}

function renderCalculator() {
  const el = document.getElementById("calcResults");
  const amount = Math.max(0, parseFloat(document.getElementById("calcAmount").value) || 0);
  const months = Number(document.getElementById("calcTerm").value);
  const years = months / 12;
  const { cbr, curve } = ratesState;
  const rows = [];

  const dep = cbr && cbr.deposits ? cbr.deposits.current : null;
  const infl = cbr && cbr.inflation ? cbr.inflation.current : null;
  let depositIncome = null;
  if (dep != null) {
    depositIncome = amount * (dep / 100) * years;
    rows.push({ label: `Вклад под ${formatPct(dep)}`, value: depositIncome });
  }

  const ofzYield = curveYieldAt(curve, years);
  if (ofzYield != null) {
    rows.push({ label: `ОФЗ под ${formatPct(ofzYield)}`, value: amount * (Math.pow(1 + ofzYield / 100, years) - 1) });
  }

  let inflationLoss = null;
  if (infl != null) {
    inflationLoss = amount * (1 - 1 / Math.pow(1 + infl / 100, years));
    rows.push({ label: `Инфляция ${formatPct(infl)} «съест»`, value: -inflationLoss });
  }

  if (depositIncome != null && inflationLoss != null) {
    rows.push({ label: "Реальный доход по вкладу", value: depositIncome - inflationLoss, total: true });
  }

  el.innerHTML = rows.map(r => `
    <div class="calc-row${r.total ? " calc-row--total" : ""}">
      <span>${r.label}</span>
      <b class="${r.value >= 0 ? "calc-plus" : "calc-minus"}">${r.value >= 0 ? "+" : "−"}${formatRub(Math.abs(r.value))}</b>
    </div>
  `).join("") || `<div class="empty-hint">Нет данных для расчёта</div>`;
}

function renderOfzTable() {
  const body = document.getElementById("ofzTableBody");
  const bonds = ratesState.bonds || [];
  if (bonds.length === 0) {
    body.innerHTML = `<tr><td colspan="5" class="empty-hint">Данные Мосбиржи недоступны.</td></tr>`;
    return;
  }
  body.innerHTML = bonds.map(b => {
    const [y, mo, d] = b.maturity.split("-");
    return `
      <tr>
        <td>${escapeHtml(b.name)}</td>
        <td>${d}.${mo}.${y}</td>
        <td class="num">${b.price != null ? b.price.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</td>
        <td class="num"><b>${b.yield != null ? formatPct(b.yield) : "—"}</b></td>
        <td class="num">${b.duration != null ? `${(b.duration / 365).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} г.` : "—"}</td>
      </tr>
    `;
  }).join("");
}

async function loadRates() {
  const metaEl = document.getElementById("ratesMeta");
  const errorEl = document.getElementById("ratesError");
  if (!ratesState) metaEl.textContent = "Загрузка данных...";

  const [cbr, ofz] = await Promise.all([fetchCbrRates(), fetchOfzData()]);
  ratesLoaded = true;

  if (!cbr && !ofz) {
    metaEl.textContent = "";
    errorEl.textContent = "Не удалось получить данные. Проверьте интернет-соединение.";
    return;
  }
  errorEl.textContent = "";

  ratesState = {
    cbr: cbr ? cbr.data : null,
    curve: ofz ? ofz.curve : null,
    bonds: ofz ? ofz.bonds : [],
  };

  renderRatesCards();
  renderRatesChart();
  renderOfzCurve();
  renderCalculator();
  renderOfzTable();

  const parts = [];
  if (ofz && ofz.asOf) {
    const t = new Date(ofz.asOf + "+03:00");
    parts.push(`ОФЗ — на ${formatQuoteTime(t)}`);
  }
  if (cbr) {
    const cbrTime = cbr.data.updatedAt ? new Date(cbr.data.updatedAt).toLocaleString("ru-RU") : null;
    if (cbr.live) parts.push("данные ЦБ — актуальные");
    else if (IS_HOSTED) parts.push(`данные ЦБ на ${cbrTime || "неизвестно"} · проверяются каждый час`);
    else parts.push(`данные ЦБ из сохранённого файла${cbrTime ? ` (${cbrTime})` : ""}`);
  } else {
    parts.push(`данные ЦБ недоступны${IS_HOSTED ? "" : " — запустите server.py"}`);
  }
  metaEl.textContent = `Обновлено в ${new Date().toLocaleTimeString("ru-RU")} · ${parts.join(" · ")}`;
}

document.getElementById("ratesRefreshBtn").addEventListener("click", loadRates);
document.getElementById("calcAmount").addEventListener("input", () => { if (ratesState) renderCalculator(); });
document.getElementById("calcTerm").addEventListener("change", () => { if (ratesState) renderCalculator(); });

tabBtns.forEach(btn => {
  if (btn.dataset.tab === "rates") {
    btn.addEventListener("click", () => {
      if (!ratesLoaded) loadRates();
      else if (ratesState) requestAnimationFrame(() => { renderRatesChart(); renderOfzCurve(); });
    });
  }
});

let ratesResizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(ratesResizeTimer);
  ratesResizeTimer = setTimeout(() => {
    if (ratesState && document.getElementById("rates").classList.contains("active")) {
      renderRatesChart();
      renderOfzCurve();
    }
  }, 150);
});

setInterval(() => {
  if (document.getElementById("rates").classList.contains("active")) loadRates();
}, 120000);

// ---------- Календарь событий ----------
const EVENT_TYPES = {
  cbr: { label: "ЦБ", color: "var(--series-1)" },
  inflation: { label: "Инфляция", color: "var(--series-2)" },
  earnings: { label: "Отчётности", color: "var(--series-3)" },
  dividend: { label: "Дивиденды", color: "var(--series-4)" },
  custom: { label: "Моё", color: "var(--series-5)" },
};
const CUSTOM_EVENTS_KEY = "custom_events";
const DAY_MS = 86400000;

let eventsLoaded = false;
let eventsServer = [];
let eventsFilter = "all";
let eventsSelectedDate = null;
let eventsMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

function loadCustomEvents() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_EVENTS_KEY)) || [];
  } catch {
    return [];
  }
}

function saveCustomEvents(list) {
  localStorage.setItem(CUSTOM_EVENTS_KEY, JSON.stringify(list));
}

function pluralRu(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

function daysFromToday(dateKey) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((parseLocalDate(dateKey) - today) / DAY_MS);
}

function relativeDayLabel(dateKey) {
  const n = daysFromToday(dateKey);
  if (n === 0) return "сегодня";
  if (n === 1) return "завтра";
  if (n > 1) return `через ${n} ${pluralRu(n, "день", "дня", "дней")}`;
  return "прошло";
}

function inflationEvents(from, to) {
  const events = [];
  const d = new Date(from);
  while (d.getDay() !== 3) d.setDate(d.getDate() + 1);
  for (; d <= to; d.setDate(d.getDate() + 7)) {
    events.push({
      date: toDateKey(d),
      type: "inflation",
      title: "Росстат: недельная инфляция",
      time: "19:00 МСК",
      details: "Оценка роста цен за неделю · по регулярному графику, при праздниках дата может сдвигаться",
    });
  }
  return events;
}

function allEvents() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monthEnd = new Date(eventsMonth.getFullYear(), eventsMonth.getMonth() + 1, 0);
  const from = new Date(Math.min(eventsMonth.getTime(), today.getTime()) - 7 * DAY_MS);
  const to = new Date(Math.max(monthEnd.getTime(), today.getTime() + 60 * DAY_MS));
  const custom = loadCustomEvents().map(e => ({ ...e, type: "custom", time: "", details: "" }));

  return [...eventsServer, ...inflationEvents(from, to), ...custom].sort((a, b) =>
    a.date.localeCompare(b.date) || (b.important ? 1 : 0) - (a.important ? 1 : 0));
}

function filteredEvents() {
  const list = allEvents();
  return eventsFilter === "all" ? list : list.filter(e => e.type === eventsFilter);
}

function renderEventsHighlights() {
  const el = document.getElementById("eventsHighlights");
  const todayKey = toDateKey(new Date());
  const list = allEvents().filter(e => e.date >= todayKey);
  const tiles = [];

  const cbr = list.find(e => e.type === "cbr" && e.important);
  if (cbr) {
    const keyRate = (ratesState && ratesState.cbr && ratesState.cbr.keyRate)
      || (window.RATES_DATA && window.RATES_DATA.keyRate);
    const d = parseLocalDate(cbr.date);
    tiles.push(rateTile("Следующее решение по ключевой ставке",
      `${d.getDate()} ${RU_MONTHS_GENITIVE[d.getMonth()]}`,
      `${relativeDayLabel(cbr.date)} · ${cbr.time}${keyRate ? ` · сейчас ставка ${formatPct(keyRate.current)}` : ""}`,
      EVENT_TYPES.cbr.color));
  }

  const infl = list.find(e => e.type === "inflation");
  if (infl) {
    const d = parseLocalDate(infl.date);
    tiles.push(rateTile("Ближайшие данные по инфляции",
      `${d.getDate()} ${RU_MONTHS_GENITIVE[d.getMonth()]}`,
      `${relativeDayLabel(infl.date)} · ${infl.time} · недельная оценка Росстата`,
      EVENT_TYPES.inflation.color));
  }

  const weekEnd = toDateKey(new Date(Date.now() + 7 * DAY_MS));
  const weekEarnings = list.filter(e => e.type === "earnings" && e.date <= weekEnd);
  const weekDividends = list.filter(e => e.type === "dividend" && e.date <= weekEnd);
  tiles.push(rateTile("На этой неделе",
    `${weekEarnings.length} ${pluralRu(weekEarnings.length, "отчёт", "отчёта", "отчётов")}`,
    weekDividends.length
      ? `и ${weekDividends.length} ${pluralRu(weekDividends.length, "дивидендная отсечка", "дивидендные отсечки", "дивидендных отсечек")}`
      : "крупнейших компаний США",
    EVENT_TYPES.earnings.color));

  el.innerHTML = tiles.join("");
}

function renderEventsFilters() {
  const el = document.getElementById("eventsFilters");
  const todayKey = toDateKey(new Date());
  const upcoming = allEvents().filter(e => e.date >= todayKey);
  const chip = (key, label, color, count) => `
    <button type="button" class="events-chip${eventsFilter === key ? " active" : ""}" data-filter="${key}">
      ${color ? `<i class="events-chip-dot" style="background:${color}"></i>` : ""}${label}<span class="events-chip-count">${count}</span>
    </button>
  `;

  el.innerHTML = chip("all", "Все", null, upcoming.length)
    + Object.entries(EVENT_TYPES).map(([key, t]) =>
      chip(key, t.label, t.color, upcoming.filter(e => e.type === key).length)).join("");

  el.querySelectorAll(".events-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      eventsFilter = btn.dataset.filter;
      renderEventsFilters();
      renderEventsMonth();
      renderEventsAgenda();
    });
  });
}

function renderEventsMonth() {
  const grid = document.getElementById("eventsMonthGrid");
  const year = eventsMonth.getFullYear();
  const month = eventsMonth.getMonth();
  document.getElementById("eventsMonthTitle").textContent = `${RU_MONTHS[month]} ${year}`;

  const typesByDate = {};
  filteredEvents().forEach(e => {
    (typesByDate[e.date] = typesByDate[e.date] || new Set()).add(e.type);
  });

  const todayKey = toDateKey(new Date());
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  let html = RU_WEEKDAYS_SHORT.map(w => `<div class="events-dow">${w}</div>`).join("");
  for (let i = 0; i < offset; i++) html += `<div></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const key = toDateKey(new Date(year, month, d));
    const types = typesByDate[key] ? Object.keys(EVENT_TYPES).filter(t => typesByDate[key].has(t)) : [];
    const cls = ["events-day"];
    if (key === todayKey) cls.push("today");
    if (key === eventsSelectedDate) cls.push("selected");
    if (key < todayKey) cls.push("past");
    html += `
      <button type="button" class="${cls.join(" ")}" data-date="${key}">
        <span>${d}</span>
        <span class="events-day-dots">${types.map(t => `<i style="background:${EVENT_TYPES[t].color}"></i>`).join("")}</span>
      </button>
    `;
  }
  grid.innerHTML = html;

  grid.querySelectorAll(".events-day").forEach(btn => {
    btn.addEventListener("click", () => {
      eventsSelectedDate = eventsSelectedDate === btn.dataset.date ? null : btn.dataset.date;
      renderEventsMonth();
      renderEventsAgenda();
    });
  });
}

function eventTaskText(e) {
  return `${e.title}${e.time ? ` (${e.time})` : ""}`;
}

function renderEventsAgenda() {
  const el = document.getElementById("eventsAgenda");
  const titleEl = document.getElementById("eventsAgendaTitle");
  const showAllBtn = document.getElementById("eventsShowAll");
  const todayKey = toDateKey(new Date());
  let list = filteredEvents();

  if (eventsSelectedDate) {
    list = list.filter(e => e.date === eventsSelectedDate);
    titleEl.textContent = `События на ${formatRuDate(eventsSelectedDate)}`;
    showAllBtn.style.display = "";
  } else {
    const until = toDateKey(new Date(Date.now() + 60 * DAY_MS));
    list = list.filter(e => e.date >= todayKey && e.date <= until);
    titleEl.textContent = "Ближайшие события";
    showAllBtn.style.display = "none";
  }

  if (list.length === 0) {
    el.innerHTML = `<div class="empty-hint">Событий нет</div>`;
    return;
  }

  const tasks = loadTasks();
  const groups = {};
  list.forEach(e => { (groups[e.date] = groups[e.date] || []).push(e); });

  el.innerHTML = "";
  Object.keys(groups).sort().forEach(date => {
    const d = parseLocalDate(date);
    const rel = daysFromToday(date);
    const prefix = rel === 0 ? "Сегодня · " : rel === 1 ? "Завтра · " : "";
    const head = document.createElement("div");
    head.className = "events-date-head";
    head.textContent = `${prefix}${RU_WEEKDAYS_SHORT[(d.getDay() + 6) % 7]}, ${d.getDate()} ${RU_MONTHS_GENITIVE[d.getMonth()]}`;
    el.appendChild(head);

    groups[date].forEach(e => {
      const type = EVENT_TYPES[e.type];
      const inPlanner = tasks.some(t => t.date === e.date && t.text === eventTaskText(e));
      const row = document.createElement("div");
      row.className = "events-item" + (e.important ? " events-item--important" : "");
      row.innerHTML = `
        <span class="events-badge"><i style="background:${type.color}"></i>${type.label}</span>
        <div class="events-item-body">
          <div class="events-item-title">${escapeHtml(e.title)}</div>
          ${e.time || e.details ? `<div class="events-item-sub">${[e.time, e.details].filter(Boolean).map(escapeHtml).join(" · ")}</div>` : ""}
        </div>
        <div class="events-item-actions">
          ${e.date >= todayKey ? `<button type="button" class="events-plan-btn" ${inPlanner ? "disabled" : ""}>${inPlanner ? "✓ В ежедневнике" : "+ В ежедневник"}</button>` : ""}
          ${e.type === "custom" ? `<button type="button" class="events-del-btn" title="Удалить">✕</button>` : ""}
        </div>
      `;

      const planBtn = row.querySelector(".events-plan-btn");
      if (planBtn && !inPlanner) {
        planBtn.addEventListener("click", () => {
          addTask(eventTaskText(e), e.date);
          renderPlanner();
          renderHome();
          planBtn.textContent = "✓ В ежедневнике";
          planBtn.disabled = true;
        });
      }
      const delBtn = row.querySelector(".events-del-btn");
      if (delBtn) {
        delBtn.addEventListener("click", () => {
          saveCustomEvents(loadCustomEvents().filter(c => c.id !== e.id));
          renderEvents();
        });
      }
      el.appendChild(row);
    });
  });
}

function renderEvents() {
  renderEventsHighlights();
  renderEventsFilters();
  renderEventsMonth();
  renderEventsAgenda();
}

async function loadEvents() {
  const metaEl = document.getElementById("eventsMeta");
  const errorEl = document.getElementById("eventsError");
  metaEl.textContent = "Загрузка календаря...";

  if (!eventsLoaded && window.EVENTS_DATA) {
    eventsServer = window.EVENTS_DATA.events || [];
    renderEvents();
  }

  let source = null;
  try {
    const res = await apiFetch("/api/events");
    if (!res.ok) throw new Error("network");
    source = { data: await res.json(), live: true };
  } catch {
    const data = await loadStaticData("events");
    if (data) source = { data, live: false };
  }

  eventsLoaded = true;
  eventsServer = source ? source.data.events || [] : [];
  errorEl.textContent = source ? "" : `Календарь ЦБ и биржи недоступен.${SERVER_HINT} Показаны инфляция и ваши события.`;
  renderEvents();

  if (!source) {
    metaEl.textContent = "";
  } else if (source.live) {
    metaEl.textContent = `Обновлено в ${new Date().toLocaleTimeString("ru-RU")}`;
  } else if (IS_HOSTED) {
    const t = source.data.updatedAt ? new Date(source.data.updatedAt).toLocaleString("ru-RU") : "неизвестно";
    metaEl.textContent = `Календарь на ${t} · проверяется каждые несколько часов`;
  } else {
    const t = source.data.updatedAt ? new Date(source.data.updatedAt).toLocaleString("ru-RU") : "неизвестно";
    metaEl.textContent = `Календарь из сохранённого файла (${t}) — запустите server.py для свежих данных`;
  }
}

document.getElementById("eventsPrevMonth").addEventListener("click", () => {
  eventsMonth = new Date(eventsMonth.getFullYear(), eventsMonth.getMonth() - 1, 1);
  renderEvents();
});
document.getElementById("eventsNextMonth").addEventListener("click", () => {
  eventsMonth = new Date(eventsMonth.getFullYear(), eventsMonth.getMonth() + 1, 1);
  renderEvents();
});
document.getElementById("eventsShowAll").addEventListener("click", () => {
  eventsSelectedDate = null;
  renderEventsMonth();
  renderEventsAgenda();
});
document.getElementById("eventsRefreshBtn").addEventListener("click", loadEvents);

document.getElementById("customEventForm").addEventListener("submit", e => {
  e.preventDefault();
  const date = document.getElementById("customEventDate").value;
  const title = document.getElementById("customEventTitle").value.trim();
  if (!date || !title) return;
  const list = loadCustomEvents();
  list.push({ id: Date.now().toString(36), date, title });
  saveCustomEvents(list);
  document.getElementById("customEventTitle").value = "";
  renderEvents();
});

document.getElementById("customEventDate").value = toDateKey(new Date());

tabBtns.forEach(btn => {
  if (btn.dataset.tab === "events") {
    btn.addEventListener("click", () => {
      if (!eventsLoaded) loadEvents();
    });
  }
});

// ---------- Новости рынка ----------
const NEWS_GROUPS = { ru: "Акции РФ", us: "Акции США", crypto: "Криптовалюта", macro: "Сырьё и валюта" };

// Ключевые слова — фрагменты регулярных выражений; совпадение ищется с начала слова,
// окончание «$» требует и конца слова (чтобы «сбер» не ловил «сбережения»).
const NEWS_ASSETS = [
  { id: "imoex", name: "Индекс Мосбиржи", ticker: "IMOEX", group: "ru", price: { moexIndex: "IMOEX" }, unit: "",
    keywords: ["индекс(а|ом|е)? мосбирж", "индекс(а)? московской биржи", "imoex", "рын(ок|ка|ке) акций"] },
  { id: "sber", name: "Сбербанк", ticker: "SBER", group: "ru", price: { moex: "SBER" }, unit: "₽",
    keywords: ["сбербанк", "сбер(а|у|ом|е)?$", "sber$"] },
  { id: "gazp", name: "Газпром", ticker: "GAZP", group: "ru", price: { moex: "GAZP" }, unit: "₽",
    keywords: ["газпром(а|у|ом|е)?$"] },
  { id: "lkoh", name: "Лукойл", ticker: "LKOH", group: "ru", price: { moex: "LKOH" }, unit: "₽", keywords: ["лукойл"] },
  { id: "rosn", name: "Роснефть", ticker: "ROSN", group: "ru", price: { moex: "ROSN" }, unit: "₽", keywords: ["роснефт"] },
  { id: "ydex", name: "Яндекс", ticker: "YDEX", group: "ru", price: { moex: "YDEX" }, unit: "₽", keywords: ["яндекс"] },
  { id: "gmkn", name: "Норникель", ticker: "GMKN", group: "ru", price: { moex: "GMKN" }, unit: "₽",
    keywords: ["норникел", "норильск(ий|ого) никел"] },
  { id: "vtbr", name: "ВТБ", ticker: "VTBR", group: "ru", price: { moex: "VTBR" }, unit: "₽", keywords: ["втб$"] },
  { id: "t", name: "Т-Технологии", ticker: "T", group: "ru", price: { moex: "T" }, unit: "₽",
    keywords: ["т-технолог", "т-банк", "тинькофф"] },
  { id: "aapl", name: "Apple", ticker: "AAPL", group: "us", price: { yahoo: "AAPL" }, unit: "$",
    keywords: ["apple$", "aapl$", "эппл", "iphone", "айфон"] },
  { id: "nvda", name: "NVIDIA", ticker: "NVDA", group: "us", price: { yahoo: "NVDA" }, unit: "$",
    keywords: ["nvidia", "nvda$", "нвидиа"] },
  { id: "tsla", name: "Tesla", ticker: "TSLA", group: "us", price: { yahoo: "TSLA" }, unit: "$",
    keywords: ["tesla", "tsla$", "тесла$", "теслы$"] },
  { id: "msft", name: "Microsoft", ticker: "MSFT", group: "us", price: { yahoo: "MSFT" }, unit: "$",
    keywords: ["microsoft", "msft$", "майкрософт"] },
  { id: "btc", name: "Bitcoin", ticker: "BTC", group: "crypto", price: { bybit: "BTCUSDT" }, unit: "$",
    keywords: ["биткоин", "биткойн", "bitcoin", "btc$"] },
  { id: "eth", name: "Ethereum", ticker: "ETH", group: "crypto", price: { bybit: "ETHUSDT" }, unit: "$",
    keywords: ["ethereum", "эфириум", "eth$"] },
  { id: "sol", name: "Solana", ticker: "SOL", group: "crypto", price: { bybit: "SOLUSDT" }, unit: "$",
    keywords: ["solana", "солан(а|ы|е|у)$"] },
  { id: "brent", name: "Нефть Brent", ticker: "BRENT", group: "macro", price: { yahoo: "BZ=F" }, unit: "$",
    keywords: ["нефт", "brent", "опек", "opec"] },
  { id: "gold", name: "Золото", ticker: "XAU", group: "macro", price: { yahoo: "GC=F" }, unit: "$",
    keywords: ["золот(о|а|у|ом|е)$", "драгметалл", "gold$"] },
  { id: "usdrub", name: "Доллар / рубль", ticker: "USD/RUB", group: "macro", price: { yahoo: "RUB=X" }, unit: "₽",
    keywords: ["курс(а|ом)? (доллар|рубл|юан|евро)", "рубл[ьяеи]\\S* (укреп|ослаб|подешев|подорож|вырос|упал|снизил)",
      "(укреплени|ослаблени)[еяю] рубл"] },
];

const MOVE_REGEX = /(вырос|выросл|подскоч|взлет|взлёт|подорож|растут|укрепил|обновил(и)? (максимум|минимум)|упал|упали|снизил|подешев|обвал|рухнул|дешевеет|дорожает|surge|soar|jump|rall(y|ies)|gain|\brise|\brose|climb|\bfall|\bfell|drop|plunge|slump|sink|tumbl|slide|slid)/i;
const MARKET_REGEX = /(^|[^а-яёa-z])(рын(ок|ка|ке) (акций|облигаций)|фондов(ый|ого|ом) рын|мосбирж|бирж[аеиу]|торг(и|ах|ов)$|котировк|нефт|brent|курс(а|ом)? (доллар|рубл|юан|евро)|рубл[ьяе] (укреп|ослаб|подешев|подорож)|ключев(ая|ой|ую) ставк|центробанк|банк(а)? росси|инфляц|дивиденд|облигац|офз|биткоин|крипт|золот(о|а)|ipo|капитализац|акци[ийя] (?!протест))/i;

let newsLoaded = false;
let newsData = null;
let newsPrices = {};
let newsFilter = "all";
const newsExpanded = new Set();

function buildAssetRegex(asset) {
  const parts = asset.keywords.map(k => (k.endsWith("$") ? `(?:${k.slice(0, -1)})(?=[^а-яёa-z0-9]|$)` : `(?:${k})`));
  return new RegExp(`(^|[^а-яёa-z0-9])(?:${parts.join("|")})`, "i");
}
NEWS_ASSETS.forEach(a => { a.regex = buildAssetRegex(a); });

function timeAgo(unixSeconds) {
  const diff = Math.max(0, Date.now() / 1000 - unixSeconds);
  if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))} мин назад`;
  if (diff < 86400) return `${Math.round(diff / 3600)} ч назад`;
  const d = new Date(unixSeconds * 1000);
  return `${d.getDate()} ${RU_MONTHS_GENITIVE[d.getMonth()]}, ${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
}

function safeUrl(url) {
  return /^https?:\/\//i.test(url || "") ? url : "#";
}

function newsForAsset(asset, items) {
  // Поиск Yahoo по тикеру отдаёт и соседние новости, поэтому актив должен упоминаться в тексте
  const matched = items.filter(item => asset.regex.test(`${item.title} ${item.summary}`));
  const dayAgo = Date.now() / 1000 - 86400;
  // Выше всего — свежие новости о росте/падении с активом в заголовке: они и объясняют движение цены
  const score = item => (item.move && item.published > dayAgo ? 2 : 0) + (asset.regex.test(item.title) ? 1 : 0);
  return matched
    .map(item => ({ ...item, move: MOVE_REGEX.test(item.title) }))
    .sort((a, b) => (score(b) - score(a)) || (b.published - a.published));
}

function newsLinkHtml(item) {
  const meta = [
    item.move ? `<span class="news-move">рост/снижение</span>` : "",
    escapeHtml(item.source),
    timeAgo(item.published),
    item.lang === "en" ? `<span class="news-lang">EN</span>` : "",
  ].filter(Boolean).join(" · ");
  return `
    <a class="news-link" href="${escapeAttr(safeUrl(item.link))}" target="_blank" rel="noopener noreferrer">
      <span class="news-link-title">${escapeHtml(item.title)}</span>
      <span class="news-link-meta">${meta}</span>
    </a>
  `;
}

async function fetchNewsPrices() {
  const prices = {};
  const moexShares = NEWS_ASSETS.filter(a => a.price.moex).map(a => a.price.moex);

  const tasks = [
    fetch(`https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities.json?securities=${moexShares.join(",")}&iss.meta=off&iss.only=marketdata&marketdata.columns=SECID,LAST,LASTTOPREVPRICE`)
      .then(r => r.json())
      .then(d => d.marketdata.data.forEach(([secid, last, change]) => {
        if (last != null) prices[`moex:${secid}`] = { price: last, change };
      }))
      .catch(() => {}),
    fetch("https://iss.moex.com/iss/engines/stock/markets/index/securities.json?securities=IMOEX&iss.meta=off&iss.only=marketdata&marketdata.columns=SECID,CURRENTVALUE,LASTCHANGEPRC")
      .then(r => r.json())
      .then(d => d.marketdata.data.forEach(([secid, value, change]) => {
        if (value != null) prices[`moexIndex:${secid}`] = { price: value, change };
      }))
      .catch(() => {}),
  ];

  if (!marketData.length) {
    tasks.push(fetch(MARKET_API).then(r => r.json()).then(d => {
      (d.result?.list || []).forEach(t => {
        prices[`bybit:${t.symbol}`] = { price: parseFloat(t.lastPrice), change: parseFloat(t.price24hPcnt) * 100 };
      });
    }).catch(() => {}));
  } else {
    marketData.forEach(c => { prices[`bybit:${c.symbol}`] = { price: c.price, change: c.change }; });
  }

  await Promise.all(tasks);
  return prices;
}

function assetPrice(asset) {
  const [source, symbol] = Object.entries(asset.price)[0];
  if (source === "yahoo") {
    const q = newsData && newsData.quotes ? newsData.quotes[symbol] : null;
    return q ? { price: q.price, change: q.change } : null;
  }
  return newsPrices[`${source}:${symbol}`] || null;
}

function formatAssetPrice(value, unit) {
  const digits = value >= 1000 ? 0 : value >= 10 ? 2 : 3;
  const num = value.toLocaleString("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (unit === "$") return `$${num}`;
  return unit ? `${num} ${unit}` : num;
}

function renderNewsFilters() {
  const el = document.getElementById("newsFilters");
  const chip = (key, label) => `
    <button type="button" class="events-chip${newsFilter === key ? " active" : ""}" data-filter="${key}">${label}</button>
  `;
  el.innerHTML = chip("all", "Все") + Object.entries(NEWS_GROUPS).map(([k, label]) => chip(k, label)).join("");
  el.querySelectorAll(".events-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      newsFilter = btn.dataset.filter;
      renderMarketNews();
    });
  });
}

function renderNewsAssets() {
  const el = document.getElementById("newsAssets");
  const items = newsData ? newsData.items : [];
  const assets = NEWS_ASSETS
    .filter(a => newsFilter === "all" || a.group === newsFilter)
    .map(a => ({ asset: a, quote: assetPrice(a), news: newsForAsset(a, items) }))
    // Самые сильные движения — первыми
    .sort((x, y) => Math.abs(y.quote ? y.quote.change : 0) - Math.abs(x.quote ? x.quote.change : 0));

  el.innerHTML = "";
  assets.forEach(({ asset, quote, news }) => {
    const expanded = newsExpanded.has(asset.id);
    const shown = news.slice(0, expanded ? 8 : 3);
    let priceHtml = `<div class="news-card-value">—</div>`;
    if (quote) {
      const up = quote.change >= 0;
      priceHtml = `
        <div class="news-card-value">${formatAssetPrice(quote.price, asset.unit)}</div>
        <div class="market-item-change ${up ? "up" : "down"}">${up ? "▲ +" : "▼ "}${quote.change.toFixed(2)}%</div>
      `;
    }

    const card = document.createElement("div");
    card.className = "news-card";
    card.innerHTML = `
      <div class="news-card-head">
        <div>
          <div class="news-card-name">${asset.name}</div>
          <div class="news-card-ticker">${asset.ticker} · ${NEWS_GROUPS[asset.group]}</div>
        </div>
        <div class="news-card-price">${priceHtml}</div>
      </div>
      <div class="news-card-list">
        ${shown.length ? shown.map(newsLinkHtml).join("") : `<div class="news-empty">Свежих новостей пока нет</div>`}
      </div>
      ${news.length > 3 ? `<button type="button" class="events-link-btn news-more-btn">${expanded ? "Свернуть" : `Ещё ${Math.min(news.length, 8) - 3}`}</button>` : ""}
    `;
    const moreBtn = card.querySelector(".news-more-btn");
    if (moreBtn) {
      moreBtn.addEventListener("click", () => {
        if (expanded) newsExpanded.delete(asset.id); else newsExpanded.add(asset.id);
        renderNewsAssets();
      });
    }
    el.appendChild(card);
  });
}

function titleWords(title) {
  return new Set(title.toLowerCase().split(/[^а-яёa-z0-9]+/).filter(w => w.length > 3).map(w => w.slice(0, 5)));
}

function isSameStory(a, b) {
  let common = 0;
  a.forEach(w => { if (b.has(w)) common++; });
  return common / Math.min(a.size, b.size) >= 0.4;
}

function renderNewsMain() {
  const el = document.getElementById("newsMain");
  const picked = [];
  // Один сюжет часто пишут несколько СМИ — оставляем самую свежую публикацию
  for (const item of newsData ? newsData.items : []) {
    if (picked.length >= 15) break;
    if (item.lang !== "ru" || !MARKET_REGEX.test(item.title)) continue;
    const words = titleWords(item.title);
    if (words.size === 0 || picked.some(p => isSameStory(p.words, words))) continue;
    picked.push({ ...item, words, move: MOVE_REGEX.test(item.title) });
  }
  const items = picked;
  el.innerHTML = items.length ? items.map(newsLinkHtml).join("") : `<div class="news-empty">Новостей пока нет</div>`;
}

function renderMarketNews() {
  renderNewsFilters();
  renderNewsAssets();
  renderNewsMain();
}

async function loadMarketNews() {
  const metaEl = document.getElementById("newsMeta");
  const errorEl = document.getElementById("newsError");
  metaEl.textContent = "Загрузка новостей...";

  if (!newsLoaded && window.NEWS_DATA) {
    newsData = window.NEWS_DATA;
    renderMarketNews();
  }

  const [source, prices] = await Promise.all([
    apiFetch("/api/news")
      .then(r => { if (!r.ok) throw new Error("network"); return r.json(); })
      .then(data => ({ data, live: true }))
      .catch(() => loadStaticData("news").then(data => (data ? { data, live: false } : null))),
    fetchNewsPrices(),
  ]);

  newsLoaded = true;
  newsPrices = prices;
  newsData = source ? source.data : null;
  errorEl.textContent = source ? "" : "Лента новостей недоступна." + SERVER_HINT;
  renderMarketNews();

  if (!source) {
    metaEl.textContent = "";
  } else if (source.live) {
    metaEl.textContent = `Обновлено в ${new Date().toLocaleTimeString("ru-RU")} · новостей в ленте: ${newsData.items.length} · автообновление каждые 2 минуты`;
  } else if (IS_HOSTED) {
    metaEl.textContent = `Новостей в ленте: ${newsData.items.length} · ${staticDataNote(newsData, "лента")}`;
  } else {
    const t = newsData.updatedAt ? new Date(newsData.updatedAt).toLocaleString("ru-RU") : "неизвестно";
    metaEl.textContent = `Новости из сохранённого файла (${t}) — запустите server.py для свежей ленты`;
  }
}

document.getElementById("newsRefreshBtn").addEventListener("click", loadMarketNews);

tabBtns.forEach(btn => {
  if (btn.dataset.tab === "marketNews") {
    btn.addEventListener("click", () => {
      if (!newsLoaded) loadMarketNews();
    });
  }
});

setInterval(() => {
  if (document.getElementById("marketNews").classList.contains("active")) loadMarketNews();
}, 2 * 60 * 1000);

// ---------- Активы: общий справочник для избранного, портфеля и графиков ----------
const ASSET_KINDS = {
  crypto: "Криптовалюта",
  moex: "Акции РФ",
  stock: "Акции мира",
  index: "Индексы",
  commodity: "Сырьё",
  fiat: "Валюты",
};
const TRADABLE_KINDS = ["crypto", "moex", "stock", "commodity", "fiat"];

// Название и русские варианты для поиска (Bybit отдаёт только тикеры)
const CRYPTO_NAMES = {
  BTC: ["Bitcoin", "биткоин биткойн"], ETH: ["Ethereum", "эфириум эфир"], SOL: ["Solana", "солана"],
  XRP: ["XRP", "рипл"], TON: ["Toncoin", "тон тонкоин"], DOGE: ["Dogecoin", "доги догикоин"],
  BNB: ["BNB", "бинанс"], ADA: ["Cardano", "кардано"], TRX: ["TRON", "трон"], AVAX: ["Avalanche", "аваланч"],
  DOT: ["Polkadot", "полкадот"], LINK: ["Chainlink", "чейнлинк"], LTC: ["Litecoin", "лайткоин"],
  SHIB: ["Shiba Inu", "шиба"], NOT: ["Notcoin", "ноткоин"], HMSTR: ["Hamster Kombat", "хамстер хомяк"],
  USDC: ["USD Coin", ""], PEPE: ["Pepe", "пепе"], SUI: ["Sui", ""], NEAR: ["NEAR Protocol", ""],
  APT: ["Aptos", ""], ARB: ["Arbitrum", ""], OP: ["Optimism", ""], ATOM: ["Cosmos", ""], DOGS: ["DOGS", "догс"],
  MNT: ["Mantle", ""], WLD: ["Worldcoin", ""], XLM: ["Stellar", ""], BCH: ["Bitcoin Cash", ""],
};

const MOEX_NAMES = {
  SBER: "Сбербанк", SBERP: "Сбербанк (преф.)", GAZP: "Газпром", LKOH: "Лукойл", ROSN: "Роснефть", YDEX: "Яндекс",
  GMKN: "Норникель", VTBR: "ВТБ", T: "Т-Технологии", NVTK: "Новатэк", TATN: "Татнефть", MGNT: "Магнит",
  MTSS: "МТС", PLZL: "Полюс", CHMF: "Северсталь", NLMK: "НЛМК", MAGN: "ММК", ALRS: "Алроса", AFLT: "Аэрофлот",
  MOEX: "Московская биржа", OZON: "Ozon", SNGS: "Сургутнефтегаз", SNGSP: "Сургутнефтегаз (преф.)", PHOR: "ФосАгро",
  TRNFP: "Транснефть (преф.)", PIKK: "ПИК", RUAL: "Русал", IRAO: "Интер РАО", HEAD: "HeadHunter",
  AFKS: "АФК Система", HYDR: "РусГидро", FLOT: "Совкомфлот", SMLT: "Самолёт", POSI: "Positive Technologies",
  ASTR: "Астра", BSPB: "Банк Санкт-Петербург", SVCB: "Совкомбанк", RTKM: "Ростелеком", VKCO: "VK",
};

const WORLD_STOCKS = [
  ["AAPL", "Apple", "эппл"], ["MSFT", "Microsoft", "майкрософт"], ["NVDA", "NVIDIA", "нвидиа"],
  ["GOOGL", "Alphabet (Google)", "гугл"], ["AMZN", "Amazon", "амазон"], ["META", "Meta", "фейсбук"],
  ["TSLA", "Tesla", "тесла"], ["NFLX", "Netflix", "нетфликс"], ["AMD", "AMD", ""], ["INTC", "Intel", "интел"],
  ["TSM", "TSMC", ""], ["ORCL", "Oracle", ""], ["PLTR", "Palantir", ""], ["COIN", "Coinbase", ""],
  ["JPM", "JPMorgan Chase", ""], ["V", "Visa", "виза"], ["MA", "Mastercard", "мастеркард"],
  ["KO", "Coca-Cola", "кока-кола"], ["MCD", "McDonald's", "макдоналдс"], ["DIS", "Disney", "дисней"],
  ["NKE", "Nike", "найк"], ["BABA", "Alibaba", "алибаба"], ["UBER", "Uber", "убер"],
  ["BRK-B", "Berkshire Hathaway", "баффет"], ["SPY", "Фонд на S&P 500 (SPY)", ""], ["QQQ", "Фонд на NASDAQ 100 (QQQ)", ""],
];

const FIAT_POPULAR = ["USD", "EUR", "CNY", "GBP", "JPY", "CHF", "KZT", "TRY", "AED", "BYN", "UZS", "AMD", "GEL", "KGS", "THB", "INR"];

const POPULAR_ASSETS = ["bybit:BTCUSDT", "bybit:ETHUSDT", "moex:SBER", "moex:GAZP", "yahoo:AAPL", "yahoo:NVDA",
  "moexIndex:IMOEX", "yahoo:^GSPC", "yahoo:GC=F", "yahoo:BZ=F", "fiat:USD", "fiat:CNY"];

const currencyNames = (() => {
  try { return new Intl.DisplayNames(["ru"], { type: "currency" }); } catch { return null; }
})();
const fiatNameCache = {};

function fiatName(code) {
  if (!fiatNameCache[code]) {
    let name = code;
    try { name = (currencyNames && currencyNames.of(code)) || code; } catch { /* неизвестный код */ }
    fiatNameCache[code] = name.charAt(0).toUpperCase() + name.slice(1);
  }
  return fiatNameCache[code];
}

function makeAsset(source, symbol, name, extra) {
  return { id: `${source}:${symbol}`, source, symbol, name, ticker: symbol, ...extra };
}

function cryptoAsset(base) {
  const [name, alt] = CRYPTO_NAMES[base] || [base, ""];
  return makeAsset("bybit", `${base}USDT`, name, { kind: "crypto", ticker: base, currency: "USD", alt });
}

function moexAsset(secid, name) {
  return makeAsset("moex", secid, MOEX_NAMES[secid] || name || secid, { kind: "moex", currency: "RUB", alt: name || "" });
}

function stockAsset(symbol, name) {
  if (/\.ME$/.test(symbol)) return moexAsset(symbol.replace(/\.ME$/, ""), name);
  return makeAsset("yahoo", symbol, name || symbol, { kind: "stock", currency: "USD" });
}

function indexAsset(item) {
  const ticker = item.tv ? item.tv.split(":")[1] : item.symbol;
  return item.source === "moex"
    ? makeAsset("moexIndex", item.symbol, item.name, { kind: "index", currency: "", ticker })
    : makeAsset("yahoo", item.symbol, item.name, { kind: "index", currency: "", ticker });
}

function commodityAsset(item) {
  return makeAsset("yahoo", item.symbol, item.name, {
    kind: "commodity", currency: "USD", unit: item.unit, ticker: item.symbol.replace(/=F$/, ""),
  });
}

function fiatAsset(code) {
  return makeAsset("fiat", code, fiatName(code), { kind: "fiat", currency: "RUB" });
}

// Только то, что нужно сохранить (в избранном и портфеле)
function assetMeta(a) {
  return { id: a.id, source: a.source, symbol: a.symbol, name: a.name, ticker: a.ticker, kind: a.kind, currency: a.currency, unit: a.unit };
}

let moexSharesList = [];
let moexListPromise = null;

function ensureMoexList() {
  if (!moexListPromise) {
    moexListPromise = fetch("https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities.json?iss.meta=off&iss.only=securities&securities.columns=SECID,SHORTNAME")
      .then(r => r.json())
      .then(d => {
        const seen = new Set();
        moexSharesList = d.securities.data
          .filter(([secid]) => !seen.has(secid) && seen.add(secid))
          .map(([secid, name]) => ({ secid, name }));
      })
      .catch(() => { moexListPromise = null; });
  }
  return moexListPromise;
}

function assetCatalog() {
  const crypto = marketData.map((c, i) => ({ ...cryptoAsset(c.base), rank: Math.max(0, 12 - i / 5) }));
  const moexList = moexSharesList.length
    ? moexSharesList
    : Object.entries(MOEX_NAMES).map(([secid, name]) => ({ secid, name }));
  const moex = moexList.map(s => ({ ...moexAsset(s.secid, s.name), rank: MOEX_NAMES[s.secid] ? 8 : 0 }));
  const world = WORLD_STOCKS.map(([symbol, name, alt]) => ({ ...stockAsset(symbol, name), alt, rank: 6 }));
  const indices = INDEX_GROUPS.flatMap(g => g.items).map(item => ({ ...indexAsset(item), rank: 6 }));
  const commodities = COMMODITY_GROUPS.flatMap(g => g.items).map(item => ({ ...commodityAsset(item), rank: 6 }));
  const fiat = (currencyList.length ? currencyList : FALLBACK_CURRENCIES)
    .filter(code => code !== "RUB")
    .map(code => ({ ...fiatAsset(code), rank: FIAT_POPULAR.includes(code) ? 10 - FIAT_POPULAR.indexOf(code) / 2 : 0 }));
  return [...crypto, ...moex, ...world, ...indices, ...commodities, ...fiat];
}

function normSearch(str) {
  return (str || "").toLowerCase().replace(/ё/g, "е");
}

// Совпадение с тикером важнее совпадения с названием; популярные активы — выше
function rankItems(pool, query, popularIds) {
  const q = normSearch(query.trim());
  if (!q) {
    const byId = new Map(pool.map(a => [a.id, a]));
    return popularIds.map(id => byId.get(id)).filter(Boolean);
  }
  return pool
    .map(a => {
      const ticker = normSearch(a.ticker);
      const name = normSearch(a.name);
      const alt = normSearch(a.alt);
      let score = 0;
      if (ticker === q) score = 100;
      else if (name === q) score = 95;
      else if (ticker.startsWith(q)) score = 70;
      else if (name.startsWith(q) || alt.split(" ").some(w => w && w.startsWith(q))) score = 60;
      else if (name.includes(q) || alt.includes(q)) score = 40;
      return { a, score: score ? score + (a.rank || 0) : 0 };
    })
    .filter(x => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, 40)
    .map(x => x.a);
}

function searchAssets(query, kinds) {
  const pool = assetCatalog().filter(a => !kinds || kinds.includes(a.kind));
  return rankItems(pool, query, POPULAR_ASSETS);
}

// Любая акция мира — через поиск Yahoo Finance на сервере
async function searchAssetsRemote(query) {
  if (/[а-яё]/i.test(query)) return [];
  try {
    const res = await apiFetch(`/api/symbols?q=${encodeURIComponent(query)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.symbols || []).map(s => stockAsset(s.symbol, s.name));
  } catch {
    return [];
  }
}

function assetFromId(id) {
  const found = assetCatalog().find(a => a.id === id);
  if (found) return found;
  const sep = id.indexOf(":");
  const source = id.slice(0, sep);
  const symbol = id.slice(sep + 1);
  if (source === "bybit") return cryptoAsset(symbol.replace(/USDT$/, ""));
  if (source === "moex") return moexAsset(symbol);
  if (source === "fiat") return fiatAsset(symbol);
  return null;
}

// ---------- Котировки активов ----------
const assetQuotes = {}; // id → { price, change, currency, time }
let serverQuotesAvailable = null;

function normalizeQuote(q) {
  // Часть бирж котирует в центах/пенсах
  if (q.currency === "USX") return { ...q, price: q.price / 100, currency: "USD" };
  if (q.currency === "GBp") return { ...q, price: q.price / 100, currency: "GBP" };
  return q;
}

// Без server.py: котировки, которые подготовило автообновление (data/quotes.json),
// а при открытии двойным кликом — из файлов вкладок «Акции», «Индексы», «Сырьё»
async function offlineYahooQuotes() {
  const map = {};
  const add = list => (list || []).forEach(q => { if (q && q.symbol && q.price != null) map[q.symbol] = q; });
  if (window.STOCKS_DATA) add(window.STOCKS_DATA.stocks);
  if (window.INDICES_DATA) add(window.INDICES_DATA.items);
  if (window.COMMODITIES_DATA) add(window.COMMODITIES_DATA.items);
  const prepared = await loadStaticData("quotes");
  if (prepared && prepared.quotes) add(Object.values(prepared.quotes));
  return map;
}

async function fetchAssetQuotes(assets) {
  const now = Date.now();
  const bySource = source => [...new Set(assets.filter(a => a && a.source === source).map(a => a.symbol))];
  const put = (id, price, change, currency) => {
    if (price == null || !isFinite(price)) return;
    assetQuotes[id] = { price, change: change == null || !isFinite(change) ? null : change, currency, time: now };
  };
  const indexSymbols = new Set(assets.filter(a => a && a.kind === "index").map(a => a.symbol));
  const tasks = [];

  const bybit = bySource("bybit");
  if (bybit.length) {
    const url = bybit.length <= 3 ? null : MARKET_API;
    const requests = url ? [url] : bybit.map(s => `${MARKET_API}&symbol=${s}`);
    requests.forEach(u => tasks.push(fetch(u).then(r => r.json()).then(d => {
      const wanted = new Set(bybit);
      (d.result?.list || []).forEach(t => {
        if (wanted.has(t.symbol)) put(`bybit:${t.symbol}`, parseFloat(t.lastPrice), parseFloat(t.price24hPcnt) * 100, "USD");
      });
    }).catch(() => {})));
  }

  const moex = bySource("moex");
  if (moex.length) {
    tasks.push(fetch(`https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities.json?securities=${moex.join(",")}&iss.meta=off&iss.only=marketdata,securities&marketdata.columns=SECID,LAST,LASTTOPREVPRICE&securities.columns=SECID,PREVPRICE`)
      .then(r => r.json())
      .then(d => {
        const prev = Object.fromEntries(d.securities.data);
        d.marketdata.data.forEach(([secid, last, change]) => {
          if (last != null) put(`moex:${secid}`, last, change, "RUB");
          else put(`moex:${secid}`, prev[secid], 0, "RUB"); // торги ещё не начались
        });
      })
      .catch(() => {}));
  }

  const moexIndex = bySource("moexIndex");
  if (moexIndex.length) {
    tasks.push(fetch(`https://iss.moex.com/iss/engines/stock/markets/index/securities.json?securities=${moexIndex.join(",")}&iss.meta=off&iss.only=marketdata&marketdata.columns=SECID,CURRENTVALUE,LASTVALUE,LASTCHANGEPRC`)
      .then(r => r.json())
      .then(d => d.marketdata.data.forEach(([secid, value, last, change]) => put(`moexIndex:${secid}`, value ?? last, change, "")))
      .catch(() => {}));
  }

  const yahoo = bySource("yahoo");
  const fiat = bySource("fiat");
  const serverSymbols = [...yahoo, ...fiat.map(code => `${code}RUB=X`)];
  if (serverSymbols.length) {
    tasks.push(apiFetch(`/api/quotes?symbols=${encodeURIComponent(serverSymbols.join(","))}`)
      .then(r => { if (!r.ok) throw new Error("network"); return r.json(); })
      .then(d => {
        serverQuotesAvailable = true;
        Object.values(d.quotes || {}).forEach(raw => {
          const q = normalizeQuote(raw);
          const fx = q.symbol.match(/^([A-Z]{3})RUB=X$/);
          if (fx && fiat.includes(fx[1])) put(`fiat:${fx[1]}`, q.price, q.change, "RUB");
          else put(`yahoo:${q.symbol}`, q.price, q.change, indexSymbols.has(q.symbol) ? "" : q.currency);
        });
      })
      .catch(async () => {
        serverQuotesAvailable = false;
        const offline = await offlineYahooQuotes();
        yahoo.forEach(symbol => {
          const raw = offline[symbol];
          if (!raw) return;
          const q = normalizeQuote({ currency: "USD", ...raw });
          put(`yahoo:${symbol}`, q.price, q.change, indexSymbols.has(symbol) ? "" : q.currency);
        });
        fiat.forEach(code => {
          const raw = offline[`${code}RUB=X`];
          if (raw) put(`fiat:${code}`, raw.price, raw.change, "RUB");
        });
      }));
  }

  await Promise.all(tasks);

  // Без сервера курсы валют — по open.er-api (без изменения за день)
  fiat.forEach(code => {
    if (assetQuotes[`fiat:${code}`] || !usdRates || !usdRates.RUB || !usdRates[code]) return;
    put(`fiat:${code}`, usdRates.RUB / usdRates[code], null, "RUB");
  });
  return assetQuotes;
}

// Сколько рублей стоит 1 единица валюты
function rubPerUnit(currency) {
  if (currency === "RUB") return 1;
  const q = assetQuotes[`fiat:${currency}`];
  if (q) return q.price;
  if (usdRates && usdRates.RUB && usdRates[currency]) return usdRates.RUB / usdRates[currency];
  return null;
}

const MONEY_SIGNS = { USD: "$", EUR: "€", RUB: "₽", GBP: "£", CNY: "¥", JPY: "¥" };

function formatNum(value) {
  const abs = Math.abs(value);
  let opts;
  if (abs >= 10000) opts = { maximumFractionDigits: 0 };
  else if (abs >= 1) opts = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  else if (abs === 0) opts = { maximumFractionDigits: 0 };
  else opts = { maximumSignificantDigits: 4 };
  return value.toLocaleString("ru-RU", opts);
}

function formatMoney(value, currency) {
  if (value == null || !isFinite(value)) return "—";
  const minus = value < 0 ? "−" : "";
  const num = formatNum(Math.abs(value));
  if (!currency) return minus + num;
  if (currency === "USD") return `${minus}$${num}`;
  return `${minus}${num} ${MONEY_SIGNS[currency] || currency}`;
}

function formatSignedMoney(value, currency) {
  return (value > 0 ? "+" : "") + formatMoney(value, currency);
}

function formatChange(change) {
  if (change == null || !isFinite(change)) return `<span class="asset-change">—</span>`;
  const up = change >= 0;
  const num = Math.abs(change).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `<span class="asset-change ${up ? "up" : "down"}">${up ? "+" : "−"}${num}%</span>`;
}

function formatQty(qty) {
  return qty.toLocaleString("ru-RU", { maximumFractionDigits: qty >= 1 ? 4 : 8 });
}

function goToTab(tab) {
  const btn = document.querySelector(`.nav-flyout .tab-btn[data-tab="${tab}"]`);
  if (btn) btn.click();
}

// ---------- Выпадающий поиск актива ----------
function setupAssetPicker(opts) {
  const { input, list } = opts;
  let results = [];
  let active = 0;
  let remoteTimer = null;

  const label = () => {
    const selected = opts.selected ? opts.selected() : null;
    return selected ? opts.format(selected) : "";
  };

  function renderList() {
    list.innerHTML = results.length
      ? results.map((a, i) => `
          <div class="asset-option${i === active ? " active" : ""}" data-index="${i}">
            <span class="asset-option-ticker">${escapeHtml(a.ticker || a.symbol)}</span>
            <span class="asset-option-name">${escapeHtml(a.name)}</span>
            <span class="asset-option-kind">${ASSET_KINDS[a.kind] || ""}</span>
          </div>
        `).join("")
      : `<div class="currency-picker-empty">Ничего не найдено</div>`;
    list.classList.add("open");
  }

  function update() {
    const query = input.value.trim();
    const q = query === label() ? "" : query;
    results = opts.search(q);
    active = 0;
    renderList();

    clearTimeout(remoteTimer);
    if (opts.searchRemote && q.length >= 2) {
      remoteTimer = setTimeout(async () => {
        const extra = await opts.searchRemote(q);
        if (input.value.trim() !== query || !extra.length || document.activeElement !== input) return;
        const ids = new Set(results.map(a => a.id));
        results = results.concat(extra.filter(a => !ids.has(a.id)));
        renderList();
      }, 400);
    }
  }

  function choose(asset) {
    list.classList.remove("open");
    opts.onSelect(asset);
    input.value = label();
    input.blur();
  }

  input.addEventListener("focus", () => {
    setTimeout(() => input.select(), 0);
    if (opts.onOpen) opts.onOpen().then(() => { if (document.activeElement === input) update(); });
    update();
  });
  input.addEventListener("input", update);
  input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!results.length) return;
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
      renderList();
      const activeEl = list.querySelector(".asset-option.active");
      if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[active]) choose(results[active]);
    } else if (e.key === "Escape") {
      input.blur();
    }
  });
  list.addEventListener("mousedown", e => {
    const option = e.target.closest(".asset-option");
    if (!option) return;
    e.preventDefault();
    choose(results[Number(option.dataset.index)]);
  });
  input.addEventListener("blur", () => {
    list.classList.remove("open");
    input.value = label();
  });
  document.addEventListener("mousedown", e => {
    if (e.target !== input && !list.contains(e.target)) list.classList.remove("open");
  });

  input.value = label();
  return { refresh: () => { if (document.activeElement !== input) input.value = label(); } };
}

const assetPickerLabel = a => `${a.name} · ${a.ticker || a.symbol}`;

// ---------- История цен ----------
const historyCache = {};
const HISTORY_TTL = { "1d": 60e3, "1w": 300e3, "1m": 900e3, "1y": 3600e3, "5y": 3600e3 };
const BYBIT_PERIODS = { "1d": ["15", 96], "1w": ["60", 168], "1m": ["240", 186], "1y": ["D", 366], "5y": ["W", 261] };
const MOEX_PERIODS = { "1d": [10, 7], "1w": [60, 7], "1m": [60, 31], "1y": [24, 366], "5y": [7, 1827] };

async function bybitHistory(asset, period) {
  const [interval, limit] = BYBIT_PERIODS[period];
  const res = await fetch(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${asset.symbol}&interval=${interval}&limit=${limit}`);
  const d = await res.json();
  if (d.retCode !== 0 || !d.result?.list) throw new Error("bybit");
  return { points: d.result.list.map(k => [Number(k[0]), parseFloat(k[4])]).reverse(), currency: "USD" };
}

async function moexHistory(asset, period) {
  const [interval, days] = MOEX_PERIODS[period];
  const isIndex = asset.source === "moexIndex";
  const path = isIndex ? "markets/index" : "markets/shares/boards/TQBR";
  const from = toDateKey(new Date(Date.now() - days * DAY_MS));
  let points = [];
  // Мосбиржа отдаёт свечи страницами по 500 штук
  for (let start = 0; start < 5000; start += 500) {
    const res = await fetch(`https://iss.moex.com/iss/engines/stock/${path}/securities/${asset.symbol}/candles.json?interval=${interval}&from=${from}&start=${start}&iss.meta=off&candles.columns=close,begin`);
    const rows = (await res.json()).candles.data;
    points = points.concat(rows.map(([close, begin]) => [new Date(`${begin.replace(" ", "T")}+03:00`).getTime(), close]));
    if (rows.length < 500) break;
  }
  if (period === "1d" && points.length) {
    // «День» — последняя торговая сессия (в выходные — пятничная)
    const moscowDay = t => new Date(t + 3 * 3600e3).toISOString().slice(0, 10);
    const lastDay = moscowDay(points[points.length - 1][0]);
    points = points.filter(p => moscowDay(p[0]) === lastDay);
  }
  return { points, currency: isIndex ? "" : "RUB" };
}

// Имя файла должно совпадать с history_file() в update_all.py
function historyFileName(kind, symbol, period) {
  return `data/history/${kind}_${symbol.replace(/[^A-Za-z0-9]/g, "_")}_${period}.json`;
}

async function serverHistory(asset, period) {
  const kind = asset.source === "fiat" ? "fiat" : "yahoo";
  let res = await apiFetch(`/api/history?kind=${kind}&symbol=${encodeURIComponent(asset.symbol)}&period=${period}`)
    .catch(() => null);
  // Без server.py — история, которую заранее подготовило автообновление
  if ((!res || !res.ok) && location.protocol.startsWith("http")) {
    res = await fetch(freshUrl(historyFileName(kind, asset.symbol, period))).catch(() => null);
  }
  if (!res || !res.ok) throw new Error("server");
  const d = await res.json();
  let points = d.points || [];
  let currency = asset.kind === "index" ? "" : d.currency;
  if (currency === "USX" || currency === "GBp") {
    points = points.map(([t, v]) => [t, v / 100]);
    currency = currency === "USX" ? "USD" : "GBP";
  }
  return { points, currency, source: d.source };
}

async function loadHistory(asset, period) {
  const key = `${asset.id}|${period}`;
  const cached = historyCache[key];
  if (cached && Date.now() - cached.time < HISTORY_TTL[period]) return cached.data;

  let data;
  if (asset.source === "bybit") data = await bybitHistory(asset, period);
  else if (asset.source === "moex" || asset.source === "moexIndex") data = await moexHistory(asset, period);
  else data = await serverHistory(asset, period);

  if (!data.points.length) throw new Error("empty");
  historyCache[key] = { time: Date.now(), data };
  return data;
}

// ---------- Избранное ----------
const WATCHLIST_KEY = "watchlist";
const STAR_SVG = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.8l2.2 4.5 4.9.7-3.55 3.45.84 4.9L10 14.05l-4.39 2.3.84-4.9L2.9 8l4.9-.7Z" stroke-linejoin="round"/></svg>`;

let watchLoaded = false;
let watchFilter = "all";
const watchSparks = {};

function loadWatchlist() {
  try {
    const list = JSON.parse(localStorage.getItem(WATCHLIST_KEY));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveWatchlist(list) {
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
}

function isWatched(id) {
  return loadWatchlist().some(a => a.id === id);
}

function watchStarHtml(asset) {
  const on = isWatched(asset.id);
  return `<button type="button" class="watch-star${on ? " on" : ""}" data-asset="${escapeAttr(JSON.stringify(assetMeta(asset)))}" title="${on ? "Убрать из избранного" : "Добавить в избранное"}" aria-pressed="${on}">${STAR_SVG}</button>`;
}

function syncWatchStars() {
  const ids = new Set(loadWatchlist().map(a => a.id));
  document.querySelectorAll(".watch-star").forEach(btn => {
    const on = ids.has(JSON.parse(btn.dataset.asset).id);
    btn.classList.toggle("on", on);
    btn.title = on ? "Убрать из избранного" : "Добавить в избранное";
    btn.setAttribute("aria-pressed", String(on));
  });
}

function toggleWatch(asset) {
  const list = loadWatchlist();
  const index = list.findIndex(a => a.id === asset.id);
  if (index >= 0) list.splice(index, 1);
  else list.push(assetMeta(asset));
  saveWatchlist(list);
  syncWatchStars();
  renderWatchlist();
  renderHomeMarket();
  if (index < 0) {
    fetchAssetQuotes([asset]).then(() => { renderWatchlist(); renderHomeMarket(); });
    loadWatchSparks([asset]);
  }
}

// Перехват на этапе погружения: клик по звёздочке не должен открывать график строки
document.addEventListener("click", e => {
  const star = e.target.closest(".watch-star");
  if (!star) return;
  e.stopPropagation();
  e.preventDefault();
  toggleWatch(JSON.parse(star.dataset.asset));
}, true);

async function loadWatchSparks(list) {
  await Promise.all(list.map(async asset => {
    try {
      watchSparks[asset.id] = (await loadHistory(asset, "1w")).points.map(p => p[1]);
    } catch {
      watchSparks[asset.id] = null;
    }
  }));
  renderWatchlist();
}

function renderWatchFilters(list) {
  const el = document.getElementById("watchFilters");
  const kinds = Object.keys(ASSET_KINDS).filter(k => list.some(a => a.kind === k));
  if (watchFilter !== "all" && !kinds.includes(watchFilter)) watchFilter = "all";
  if (kinds.length < 2) {
    el.innerHTML = "";
    return;
  }
  const chip = (key, label, count) => `
    <button type="button" class="events-chip${watchFilter === key ? " active" : ""}" data-filter="${key}">${label} <span class="events-chip-count">${count}</span></button>
  `;
  el.innerHTML = chip("all", "Все", list.length) + kinds.map(k => chip(k, ASSET_KINDS[k], list.filter(a => a.kind === k).length)).join("");
  el.querySelectorAll(".events-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      watchFilter = btn.dataset.filter;
      renderWatchlist();
    });
  });
}

function watchRowHtml(asset) {
  const q = assetQuotes[asset.id];
  const spark = watchSparks[asset.id];
  let weekHtml = "";
  if (spark && spark.length >= 2) {
    weekHtml = `<div class="watch-week">за неделю ${formatChange((spark[spark.length - 1] / spark[0] - 1) * 100)}</div>`;
  }
  return `
    <div class="watch-row" data-id="${escapeAttr(asset.id)}" title="Открыть график">
      ${watchStarHtml(asset)}
      <div class="watch-name">
        <div class="watch-title">${escapeHtml(asset.name)}</div>
        <div class="watch-sub">${escapeHtml(asset.ticker || asset.symbol)} · ${ASSET_KINDS[asset.kind] || ""}</div>
      </div>
      <div class="watch-spark">${spark ? buildSparkline(spark) : ""}${weekHtml}</div>
      <div class="watch-price">
        <div class="watch-value">${q ? formatMoney(q.price, q.currency) : "…"}</div>
        ${q ? formatChange(q.change) : ""}
      </div>
      <div class="watch-actions">
        <button type="button" class="watch-action" data-action="chart">График</button>
        ${TRADABLE_KINDS.includes(asset.kind) ? `<button type="button" class="watch-action" data-action="buy">Купить</button>` : ""}
      </div>
    </div>
  `;
}

function renderWatchlist() {
  const el = document.getElementById("watchList");
  if (!el) return;
  const list = loadWatchlist();
  renderWatchFilters(list);

  if (!list.length) {
    const suggestions = ["bybit:BTCUSDT", "moex:SBER", "yahoo:AAPL", "moexIndex:IMOEX", "yahoo:GC=F", "fiat:USD"]
      .map(assetFromId).filter(Boolean);
    el.innerHTML = `
      <div class="watch-empty">
        <div class="watch-empty-icon">${STAR_SVG}</div>
        <div class="watch-empty-title">Соберите свои активы на одной странице</div>
        <div class="watch-empty-text">Найдите актив в поиске выше или нажмите на звёздочку рядом с монетой, акцией, индексом или сырьём в других вкладках.</div>
        <div class="watch-empty-chips">
          ${suggestions.map(a => `<button type="button" class="events-chip" data-add="${escapeAttr(a.id)}">+ ${escapeHtml(a.name)}</button>`).join("")}
        </div>
      </div>
    `;
    el.querySelectorAll("[data-add]").forEach(btn => {
      btn.addEventListener("click", () => toggleWatch(assetFromId(btn.dataset.add)));
    });
    return;
  }

  const shown = list.filter(a => watchFilter === "all" || a.kind === watchFilter);
  el.innerHTML = shown.map(watchRowHtml).join("");
  el.querySelectorAll(".watch-row").forEach(row => {
    const asset = list.find(a => a.id === row.dataset.id);
    row.addEventListener("click", e => {
      const action = e.target.closest(".watch-action");
      if (action && action.dataset.action === "buy") openPortfolioTrade(asset, "buy");
      else openChartsFor(asset);
    });
  });
}

async function refreshWatchlist(silent = false) {
  const metaEl = document.getElementById("watchMeta");
  const list = loadWatchlist();
  if (!silent) {
    metaEl.textContent = list.length ? "Обновление цен..." : "";
    renderWatchlist();
  }
  await fetchAssetQuotes(list);
  watchLoaded = true;
  renderWatchlist();
  renderHomeMarket();
  if (!list.length) {
    metaEl.textContent = "";
    return;
  }
  let meta = `Обновлено в ${new Date().toLocaleTimeString("ru-RU")} · автообновление каждые 30 секунд`;
  if (serverQuotesAvailable === false && list.some(a => a.source === "yahoo" || a.source === "fiat")) {
    meta += IS_HOSTED
      ? " · зарубежные активы и валюты обновляются каждые 5 минут"
      : " · зарубежные активы и валюты — из сохранённых данных, запустите server.py для свежих цен";
  }
  metaEl.textContent = meta;
  if (!silent) loadWatchSparks(list);
}

setupAssetPicker({
  input: document.getElementById("watchAddInput"),
  list: document.getElementById("watchAddList"),
  search: q => searchAssets(q),
  searchRemote: searchAssetsRemote,
  onOpen: ensureMoexList,
  onSelect: asset => { if (!isWatched(asset.id)) toggleWatch(asset); },
});

document.getElementById("watchRefreshBtn").addEventListener("click", () => refreshWatchlist());

setInterval(() => {
  if (document.getElementById("watchlist").classList.contains("active")) refreshWatchlist(true);
}, 30000);

// ---------- Графики ----------
const CHART_PERIODS = [
  { id: "1d", label: "День", words: "за день" },
  { id: "1w", label: "Неделя", words: "за неделю" },
  { id: "1m", label: "Месяц", words: "за месяц" },
  { id: "1y", label: "Год", words: "за год" },
  { id: "5y", label: "5 лет", words: "за 5 лет" },
];
const CHART_PRESETS = [
  { label: "Биткоин и золото", a: "bybit:BTCUSDT", b: "yahoo:GC=F", period: "1y" },
  { label: "Сбербанк и индекс Мосбиржи", a: "moex:SBER", b: "moexIndex:IMOEX", period: "1y" },
  { label: "S&P 500 и индекс Мосбиржи", a: "yahoo:^GSPC", b: "moexIndex:IMOEX", period: "5y" },
  { label: "Нефть Brent и доллар", a: "yahoo:BZ=F", b: "fiat:USD", period: "1y" },
  { label: "NVIDIA и Apple", a: "yahoo:NVDA", b: "yahoo:AAPL", period: "1y" },
  { label: "Bitcoin и Ethereum", a: "bybit:BTCUSDT", b: "bybit:ETHUSDT", period: "1m" },
];
const CHART_STATE_KEY = "charts_state";
const TICK_MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const WEEKDAYS_MIN = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

let chartState = { a: null, b: null, period: "1m" };
let chartsInited = false;
let chartRequestId = 0;
let chartSeries = [];
let chartPickerA = null;
let chartPickerB = null;

try {
  const saved = JSON.parse(localStorage.getItem(CHART_STATE_KEY));
  if (saved && saved.a) chartState = { ...chartState, ...saved };
} catch { /* нет сохранённого выбора */ }

function saveChartState() {
  try { localStorage.setItem(CHART_STATE_KEY, JSON.stringify(chartState)); } catch { /* приватный режим */ }
}

function periodInfo(id) {
  return CHART_PERIODS.find(p => p.id === id) || CHART_PERIODS[2];
}

function formatChartTick(t, period) {
  const d = new Date(t);
  if (period === "1d") return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (period === "1w") return `${WEEKDAYS_MIN[d.getDay()]}, ${d.getDate()}`;
  if (period === "1m") return `${d.getDate()} ${TICK_MONTHS[d.getMonth()]}`;
  return `${TICK_MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
}

function formatChartTime(t, period, daily) {
  const d = new Date(t);
  const date = `${d.getDate()} ${RU_MONTHS_GENITIVE[d.getMonth()]}`;
  if (period === "1y" || period === "5y" || daily) return `${date} ${d.getFullYear()}`;
  return `${date}, ${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
}

function niceStep(range, count) {
  const raw = range / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  return (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
}

// Индекс последней точки не позже момента t (−1, если ряд начинается позже)
function pointIndexAt(points, t) {
  let lo = 0;
  let hi = points.length - 1;
  if (t < points[0][0]) return -1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (points[mid][0] <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
}

function drawAssetChart(el, series, period) {
  const compare = series.length > 1;
  const W = Math.max(300, el.clientWidth || 800);
  const H = W < 560 ? 240 : 320;

  series.forEach(s => {
    s.base = s.points[0][1];
    s.vals = s.points.map(([t, v]) => [t, compare ? (v / s.base - 1) * 100 : v]);
  });

  const all = series.flatMap(s => s.vals.map(p => p[1]));
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (compare) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (hi === lo) {
    const pad = Math.abs(hi) * 0.01 || 1;
    hi += pad;
    lo -= pad;
  }
  const step = niceStep(hi - lo, 4);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const digits = Math.max(0, Math.ceil(-Math.log10(step)));
  const fmtAxis = v => {
    const num = Math.abs(v).toLocaleString("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    if (!compare) return (v < 0 ? "−" : "") + num;
    return `${v > 0 ? "+" : v < 0 ? "−" : ""}${num}%`;
  };

  const yLabels = [];
  for (let v = lo; v <= hi + step / 2; v += step) yLabels.push(v);
  const labelWidth = Math.max(...yLabels.map(v => fmtAxis(v).length)) * 6.6 + 14;
  const m = { l: labelWidth, r: compare ? 62 : 16, t: 12, b: 28 };
  const plotW = W - m.l - m.r;
  const plotH = H - m.t - m.b;
  const y = v => m.t + (1 - (v - lo) / (hi - lo)) * plotH;

  // Один актив — точки подряд, без пустых ночей и выходных; при сравнении — общая шкала времени
  const tMin = Math.min(...series.map(s => s.vals[0][0]));
  const tMax = Math.max(...series.map(s => s.vals[s.vals.length - 1][0]));
  const xOf = (s, i) => compare
    ? m.l + ((s.vals[i][0] - tMin) / (tMax - tMin || 1)) * plotW
    : m.l + (i / Math.max(1, s.vals.length - 1)) * plotW;

  let grid = "";
  yLabels.forEach(v => {
    grid += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="chart-grid"></line>`;
    grid += `<text x="${m.l - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" class="chart-axis-label">${fmtAxis(v)}</text>`;
  });

  let ticks = "";
  const tickCount = W < 560 ? 3 : 5;
  for (let k = 0; k < tickCount; k++) {
    const frac = (k + 0.5) / tickCount;
    let tx;
    let tt;
    if (compare) {
      tx = m.l + frac * plotW;
      tt = tMin + frac * (tMax - tMin);
    } else {
      const s = series[0];
      const i = Math.round(frac * (s.vals.length - 1));
      tx = xOf(s, i);
      tt = s.vals[i][0];
    }
    ticks += `<text x="${tx.toFixed(1)}" y="${H - 8}" text-anchor="middle" class="chart-axis-label">${formatChartTick(tt, period)}</text>`;
  }

  let body = "";
  if (compare) {
    body += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" class="chart-ref-line"></line>`;
  }
  series.forEach(s => {
    const pts = s.vals.map((p, i) => `${xOf(s, i).toFixed(1)},${y(p[1]).toFixed(1)}`);
    if (!compare) {
      const bottom = (H - m.b).toFixed(1);
      body += `<path d="M${xOf(s, 0).toFixed(1)},${bottom} L${pts.join(" L")} L${xOf(s, s.vals.length - 1).toFixed(1)},${bottom} Z" class="chart-area"></path>`;
    }
    body += `<path d="M${pts.join(" L")}" class="chart-line" style="stroke:${s.color}"></path>`;
  });

  const ends = series.map(s => {
    const i = s.vals.length - 1;
    return { x: xOf(s, i), y: y(s.vals[i][1]), labelY: y(s.vals[i][1]), value: s.vals[i][1], color: s.color };
  });
  if (compare) {
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) {
      if (ends[i].labelY - ends[i - 1].labelY < 16) ends[i].labelY = ends[i - 1].labelY + 16;
    }
  }
  const endMarks = ends.map(e => `
    <circle cx="${e.x.toFixed(1)}" cy="${e.y.toFixed(1)}" r="4" class="chart-dot" style="fill:${e.color}"></circle>
    ${compare ? `<text x="${W - m.r + 8}" y="${(e.labelY + 4).toFixed(1)}" class="chart-end-label">${fmtAxis(e.value)}</text>` : ""}
  `).join("");

  el.innerHTML = `
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="График цены">
      <defs>
        <linearGradient id="chartAreaGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style="stop-color: var(--series-1); stop-opacity: 0.22"></stop>
          <stop offset="100%" style="stop-color: var(--series-1); stop-opacity: 0"></stop>
        </linearGradient>
      </defs>
      ${grid}${ticks}${body}
      <line class="chart-crosshair" y1="${m.t}" y2="${H - m.b}" x1="0" x2="0" style="display:none"></line>
      ${endMarks}
      ${series.map(s => `<circle r="5" class="chart-dot chart-hover-dot" style="fill:${s.color};display:none"></circle>`).join("")}
      <rect x="${m.l}" y="${m.t}" width="${plotW}" height="${plotH}" class="chart-hit"></rect>
    </svg>
    <div class="chart-tooltip" style="display:none"></div>
  `;

  const svg = el.querySelector("svg");
  const cross = el.querySelector(".chart-crosshair");
  const tooltip = el.querySelector(".chart-tooltip");
  const hoverDots = el.querySelectorAll(".chart-hover-dot");
  const hit = el.querySelector(".chart-hit");

  hit.addEventListener("pointermove", e => {
    const rect = svg.getBoundingClientRect();
    let px = Math.min(Math.max(e.clientX - rect.left, m.l), W - m.r);
    const frac = (px - m.l) / plotW;
    const t = tMin + frac * (tMax - tMin);
    const rows = [];
    let title = formatChartTime(t, period, series.some(s => s.source === "cbr"));

    series.forEach((s, si) => {
      const i = compare ? pointIndexAt(s.vals, t) : Math.round(frac * (s.vals.length - 1));
      const dot = hoverDots[si];
      if (i < 0) {
        dot.style.display = "none";
        rows.push(`<div class="chart-tooltip-row"><i class="legend-swatch" style="background:${s.color}"></i>${escapeHtml(s.asset.name)}<b>—</b></div>`);
        return;
      }
      const x = xOf(s, i);
      if (!compare) {
        px = x;
        title = formatChartTime(s.vals[i][0], period, s.source === "cbr");
      }
      dot.setAttribute("cx", x.toFixed(1));
      dot.setAttribute("cy", y(s.vals[i][1]).toFixed(1));
      dot.style.display = "";
      const price = formatMoney(s.points[i][1], s.currency);
      if (compare) {
        rows.push(`<div class="chart-tooltip-row"><i class="legend-swatch" style="background:${s.color}"></i>${escapeHtml(s.asset.name)}<b>${fmtAxis(s.vals[i][1])}</b></div>`);
        rows.push(`<div class="chart-tooltip-sub">${price}</div>`);
      } else {
        rows.push(`<div class="chart-tooltip-row">Цена<b>${price}</b></div>`);
        rows.push(`<div class="chart-tooltip-row">С начала периода<b>${formatChange((s.points[i][1] / s.base - 1) * 100)}</b></div>`);
      }
    });

    cross.setAttribute("x1", px);
    cross.setAttribute("x2", px);
    cross.style.display = "";
    tooltip.innerHTML = `<div class="chart-tooltip-title">${title}</div>${rows.join("")}`;
    tooltip.style.display = "block";
    positionTooltip(tooltip, el, px, e.clientY - rect.top);
  });
  hit.addEventListener("pointerleave", () => {
    cross.style.display = "none";
    tooltip.style.display = "none";
    hoverDots.forEach(d => { d.style.display = "none"; });
  });
}

function chartStatHtml(s, period) {
  const first = s.points[0][1];
  const last = s.points[s.points.length - 1][1];
  const values = s.points.map(p => p[1]);
  const tradable = TRADABLE_KINDS.includes(s.asset.kind);
  return `
    <div class="chart-stat">
      <div class="chart-stat-head">
        <i class="legend-swatch" style="background:${s.color}"></i>
        <span class="chart-stat-name">${escapeHtml(s.asset.name)}</span>
        <span class="chart-stat-ticker">${escapeHtml(s.asset.ticker || s.asset.symbol)}</span>
        ${watchStarHtml(s.asset)}
      </div>
      <div class="chart-stat-value">${formatMoney(last, s.currency)}</div>
      <div class="chart-stat-change">${formatChange((last / first - 1) * 100)} <span>${formatSignedMoney(last - first, s.currency)} ${periodInfo(period).words}</span></div>
      <div class="chart-stat-range">мин. ${formatMoney(Math.min(...values), s.currency)} · макс. ${formatMoney(Math.max(...values), s.currency)}</div>
      ${tradable ? `<button type="button" class="events-link-btn chart-stat-buy" data-id="${escapeAttr(s.asset.id)}">Купить в виртуальный портфель →</button>` : ""}
    </div>
  `;
}

function renderChartControls() {
  const periodsEl = document.getElementById("chartPeriods");
  periodsEl.innerHTML = CHART_PERIODS.map(p => `
    <button type="button" class="events-chip${chartState.period === p.id ? " active" : ""}" data-period="${p.id}">${p.label}</button>
  `).join("");
  periodsEl.querySelectorAll("[data-period]").forEach(btn => {
    btn.addEventListener("click", () => {
      chartState.period = btn.dataset.period;
      saveChartState();
      renderCharts();
    });
  });

  document.getElementById("chartBClear").style.display = chartState.b ? "" : "none";
  if (chartPickerA) chartPickerA.refresh();
  if (chartPickerB) chartPickerB.refresh();

  const presetsEl = document.getElementById("chartPresets");
  presetsEl.innerHTML = CHART_PRESETS.map((p, i) => `<button type="button" class="events-chip" data-preset="${i}">${p.label}</button>`).join("");
  presetsEl.querySelectorAll("[data-preset]").forEach(btn => {
    btn.addEventListener("click", () => {
      const preset = CHART_PRESETS[Number(btn.dataset.preset)];
      const a = assetFromId(preset.a);
      const b = assetFromId(preset.b);
      if (!a || !b) return;
      chartState = { a: assetMeta(a), b: assetMeta(b), period: preset.period };
      saveChartState();
      renderCharts();
    });
  });
}

async function renderCharts() {
  if (!chartState.a) chartState.a = assetMeta(cryptoAsset("BTC"));
  renderChartControls();

  const mainEl = document.getElementById("chartMain");
  const statsEl = document.getElementById("chartStats");
  const legendEl = document.getElementById("chartLegend");
  const hintEl = document.getElementById("chartHint");
  const errorEl = document.getElementById("chartError");
  const period = chartState.period;
  const requestId = ++chartRequestId;

  if (!mainEl.querySelector("svg")) mainEl.innerHTML = `<div class="empty-hint">Загрузка графика...</div>`;
  mainEl.classList.add("loading");

  const assets = [chartState.a, chartState.b].filter(Boolean);
  const results = await Promise.all(assets.map((asset, i) =>
    loadHistory(asset, period)
      .then(d => ({ asset, color: `var(--series-${i + 1})`, ...d }))
      .catch(err => ({ asset, error: err }))
  ));
  if (requestId !== chartRequestId) return;
  mainEl.classList.remove("loading");

  const ok = results.filter(r => !r.error);
  const failed = results.filter(r => r.error);
  errorEl.textContent = failed.length
    ? `Не удалось загрузить историю: ${failed.map(r => r.asset.name).join(", ")}.` +
      (failed.some(r => r.asset.source === "yahoo" || r.asset.source === "fiat")
        ? (IS_HOSTED ? " Для этого актива история пока недоступна — выберите актив из списка." : " Для зарубежных активов и валют запустите server.py.")
        : "")
    : "";

  chartSeries = ok;
  if (!ok.length) {
    mainEl.innerHTML = `<div class="empty-hint">Нет данных для графика</div>`;
    statsEl.innerHTML = "";
    legendEl.innerHTML = "";
    hintEl.textContent = "";
    return;
  }

  statsEl.innerHTML = ok.map(s => chartStatHtml(s, period)).join("");
  statsEl.querySelectorAll(".chart-stat-buy").forEach(btn => {
    btn.addEventListener("click", () => openPortfolioTrade(ok.find(s => s.asset.id === btn.dataset.id).asset, "buy"));
  });

  legendEl.innerHTML = ok.length > 1
    ? ok.map(s => `<span><i class="legend-swatch" style="background:${s.color}"></i>${escapeHtml(s.asset.name)}</span>`).join("")
    : "";

  if (ok.length > 1) {
    const [a, b] = ok.map(s => (s.points[s.points.length - 1][1] / s.points[0][1] - 1) * 100);
    const leader = a >= b ? ok[0] : ok[1];
    hintEl.textContent = `Обе линии начинаются с 0% — так видно, что выросло сильнее ${periodInfo(period).words}. ` +
      `Впереди — ${leader.asset.name}: разница ${Math.abs(a - b).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} п.п.`;
  } else {
    hintEl.textContent = "Наведите курсор на график, чтобы увидеть цену в любой момент. Добавьте второй актив, чтобы сравнить их.";
  }
  if (ok.some(s => s.source === "cbr")) {
    hintEl.textContent += " Курс валюты за этот период — официальный курс Банка России на каждый день.";
  }

  drawAssetChart(mainEl, ok, period);
}

function openChartsFor(asset, compareWith) {
  if (!asset) return;
  chartState.a = assetMeta(asset);
  chartState.b = compareWith ? assetMeta(compareWith) : null;
  saveChartState();
  goToTab("charts"); // обработчик вкладки сам перерисует график
}

function initCharts() {
  if (chartsInited) return;
  chartsInited = true;
  chartPickerA = setupAssetPicker({
    input: document.getElementById("chartAInput"),
    list: document.getElementById("chartAList"),
    search: q => searchAssets(q),
    searchRemote: searchAssetsRemote,
    onOpen: ensureMoexList,
    selected: () => chartState.a,
    format: assetPickerLabel,
    onSelect: asset => {
      chartState.a = assetMeta(asset);
      saveChartState();
      renderCharts();
    },
  });
  chartPickerB = setupAssetPicker({
    input: document.getElementById("chartBInput"),
    list: document.getElementById("chartBList"),
    search: q => searchAssets(q).filter(a => !chartState.a || a.id !== chartState.a.id),
    searchRemote: searchAssetsRemote,
    onOpen: ensureMoexList,
    selected: () => chartState.b,
    format: assetPickerLabel,
    onSelect: asset => {
      chartState.b = assetMeta(asset);
      saveChartState();
      renderCharts();
    },
  });
  document.getElementById("chartBClear").addEventListener("click", () => {
    chartState.b = null;
    saveChartState();
    renderCharts();
  });
  document.getElementById("chartsRefreshBtn").addEventListener("click", () => {
    Object.keys(historyCache).forEach(k => delete historyCache[k]);
    renderCharts();
  });

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (document.getElementById("charts").classList.contains("active") && chartSeries.length) {
        drawAssetChart(document.getElementById("chartMain"), chartSeries, chartState.period);
      }
    }, 200);
  });
}

// ---------- Виртуальный портфель ----------
const PORTFOLIO_KEY = "paper_portfolio";
const DEFAULT_CAPITAL = 1000000;

let portfolioLoaded = false;
let tradeSide = "buy";
let tradeAsset = null;
let tradeEdited = "qty";
let tradePicker = null;
let resetCapital = DEFAULT_CAPITAL;

function newPortfolio(capital) {
  return { startCash: capital, cash: capital, positions: [], trades: [], realized: 0, createdAt: new Date().toISOString() };
}

function loadPortfolio() {
  try {
    const p = JSON.parse(localStorage.getItem(PORTFOLIO_KEY));
    if (p && typeof p.cash === "number" && Array.isArray(p.positions)) return p;
  } catch { /* повреждённые данные — начинаем заново */ }
  return newPortfolio(DEFAULT_CAPITAL);
}

function savePortfolio(p) {
  localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(p));
}

function isWholeUnits(asset) {
  return asset.kind === "moex" || asset.kind === "stock";
}

function roundTradeQty(qty, asset) {
  if (isWholeUnits(asset)) return Math.floor(qty + 1e-9);
  const decimals = asset.kind === "fiat" ? 2 : asset.kind === "commodity" ? 4 : 8;
  const factor = 10 ** decimals;
  return Math.floor(qty * factor + 1e-6) / factor;
}

// Что нужно обновлять: активы портфеля, выбранный актив и курсы их валют к рублю
function portfolioQuoteAssets(p) {
  const assets = p.positions.map(pos => pos.asset);
  if (tradeAsset) assets.push(tradeAsset);
  const currencies = new Set(["USD"]);
  assets.forEach(a => {
    const q = assetQuotes[a.id];
    const currency = (q && q.currency) || a.currency;
    if (currency && currency !== "RUB") currencies.add(currency);
  });
  currencies.forEach(c => assets.push(fiatAsset(c)));
  return assets;
}

function tradePriceRub() {
  const q = tradeAsset ? assetQuotes[tradeAsset.id] : null;
  const rate = q ? rubPerUnit(q.currency) : null;
  return q && rate ? q.price * rate : null;
}

function renderPortfolioSummary(p, invested, dayChange, hasPositions) {
  const total = p.cash + invested;
  const result = total - p.startCash;
  const resultPct = (result / p.startCash) * 100;
  const cls = v => (v >= 0 ? "up" : "down");
  const dayPct = invested - dayChange ? (dayChange / (invested - dayChange)) * 100 : 0;

  document.getElementById("portfolioSummary").innerHTML = [
    rateTile("Стоимость портфеля", formatMoney(total, "RUB"), `стартовый капитал — ${formatMoney(p.startCash, "RUB")}`, null),
    rateTile("Результат за всё время", `<span class="pnl ${cls(result)}">${formatSignedMoney(result, "RUB")}</span>`,
      `${formatChange(resultPct)} к стартовому капиталу${p.realized ? ` · зафиксировано ${formatSignedMoney(p.realized, "RUB")}` : ""}`, null),
    rateTile("За сегодня", hasPositions ? `<span class="pnl ${cls(dayChange)}">${formatSignedMoney(dayChange, "RUB")}</span>` : "—",
      hasPositions ? `${formatChange(dayPct)} · как изменились цены ваших активов за день` : "купите активы, чтобы видеть изменения", null),
    rateTile("Свободные деньги", formatMoney(p.cash, "RUB"),
      `${Math.round((p.cash / total) * 100)}% портфеля · в активах ${formatMoney(invested, "RUB")}`, null),
  ].join("");
}

function renderPortfolioPositions(rows) {
  const body = document.getElementById("portfolioPositions");
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="7" class="pf-empty">Пока пусто. Выберите актив в блоке «Новая сделка» — например, 0,01 BTC или 10 акций Сбербанка — и нажмите «Купить».</td></tr>`;
    return;
  }
  body.innerHTML = rows.map(({ pos, q, value, pnl }) => `
    <tr>
      <td>
        <div class="pf-name">${escapeHtml(pos.asset.name)}</div>
        <div class="pf-sub">${escapeHtml(pos.asset.ticker || pos.asset.symbol)} · ${ASSET_KINDS[pos.asset.kind] || ""}</div>
      </td>
      <td class="num">${formatQty(pos.qty)}</td>
      <td class="num">${formatMoney(pos.avgPrice, pos.currency)}</td>
      <td class="num">${q ? formatMoney(q.price, q.currency) : "—"}<div class="pf-sub">${q ? formatChange(q.change) : ""}</div></td>
      <td class="num">${formatMoney(value, "RUB")}</td>
      <td class="num">${pnl != null
        ? `<span class="pnl ${pnl >= 0 ? "up" : "down"}">${formatSignedMoney(pnl, "RUB")}</span><div class="pf-sub">${formatChange((pnl / pos.costRub) * 100)}</div>`
        : "—"}</td>
      <td class="pf-actions">
        <button type="button" class="pf-btn" data-action="sell" data-id="${escapeAttr(pos.asset.id)}">Продать</button>
        <button type="button" class="pf-btn" data-action="chart" data-id="${escapeAttr(pos.asset.id)}">График</button>
      </td>
    </tr>
  `).join("");

  body.querySelectorAll(".pf-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const pos = rows.find(r => r.pos.asset.id === btn.dataset.id).pos;
      if (btn.dataset.action === "chart") {
        openChartsFor(pos.asset);
        return;
      }
      selectTradeAsset(pos.asset, "sell");
      document.getElementById("tradeQty").value = pos.qty;
      tradeEdited = "qty";
      syncTradeInputs();
      document.querySelector(".portfolio-trade").scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
}

function formatTradeTime(ms) {
  const d = new Date(ms);
  return `${d.getDate()} ${RU_MONTHS_GENITIVE[d.getMonth()]}, ${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
}

function renderPortfolioTrades(p) {
  const el = document.getElementById("portfolioTrades");
  if (!p.trades.length) {
    el.innerHTML = `<div class="news-empty">Сделок пока не было</div>`;
    return;
  }
  el.innerHTML = p.trades.slice(0, 30).map(t => `
    <div class="trade-row">
      <span class="trade-badge ${t.side}">${t.side === "buy" ? "Покупка" : "Продажа"}</span>
      <span class="trade-row-main"><b>${escapeHtml(t.asset.name)}</b> · ${formatQty(t.qty)} × ${formatMoney(t.price, t.currency)}</span>
      <span class="trade-row-total">${formatMoney(t.totalRub, "RUB")}${t.pnl != null
        ? ` <span class="pnl ${t.pnl >= 0 ? "up" : "down"}">(${formatSignedMoney(t.pnl, "RUB")})</span>` : ""}</span>
      <span class="trade-row-time">${formatTradeTime(t.time)}</span>
    </div>
  `).join("");
}

function renderTradePanel() {
  const p = loadPortfolio();
  const info = document.getElementById("tradeAssetInfo");
  const available = document.getElementById("tradeAvailable");
  const submit = document.getElementById("tradeSubmitBtn");
  const q = tradeAsset ? assetQuotes[tradeAsset.id] : null;
  const priceRub = tradePriceRub();

  document.querySelectorAll(".trade-side-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.side === tradeSide));
  submit.classList.toggle("sell", tradeSide === "sell");

  if (!tradeAsset) {
    info.innerHTML = "";
  } else if (!q) {
    info.innerHTML = `<div class="trade-asset-price">Загрузка цены...</div>`;
  } else {
    info.innerHTML = `
      <div class="trade-asset-price">
        <b>${formatMoney(q.price, q.currency)}</b> ${formatChange(q.change)}
        ${q.currency && q.currency !== "RUB" && priceRub ? `<span class="trade-asset-rub">≈ ${formatMoney(priceRub, "RUB")}</span>` : ""}
      </div>
      <div class="trade-asset-note">${isWholeUnits(tradeAsset) ? "Акции покупаются целыми штуками" : "Можно купить и часть единицы"}</div>
    `;
  }

  if (tradeSide === "buy") {
    available.textContent = `Свободно: ${formatMoney(p.cash, "RUB")}`;
  } else {
    const pos = tradeAsset ? p.positions.find(x => x.asset.id === tradeAsset.id) : null;
    available.textContent = pos
      ? `У вас: ${formatQty(pos.qty)} ${tradeAsset.ticker || tradeAsset.symbol}`
      : (tradeAsset ? "Этого актива нет в портфеле" : "");
  }

  const qty = parseFloat(document.getElementById("tradeQty").value);
  const verb = tradeSide === "buy" ? "Купить" : "Продать";
  submit.textContent = qty > 0 && priceRub ? `${verb} за ${formatMoney(qty * priceRub, "RUB")}` : verb;
}

function syncTradeInputs() {
  const qtyInput = document.getElementById("tradeQty");
  const sumInput = document.getElementById("tradeSum");
  const priceRub = tradePriceRub();
  if (priceRub) {
    if (tradeEdited === "qty") {
      const qty = parseFloat(qtyInput.value);
      sumInput.value = qty > 0 ? Math.round(qty * priceRub * 100) / 100 : "";
    } else {
      const sum = parseFloat(sumInput.value);
      const qty = sum > 0 ? roundTradeQty(sum / priceRub, tradeAsset) : 0;
      qtyInput.value = qty > 0 ? qty : "";
    }
  }
  renderTradePanel();
}

function selectTradeAsset(asset, side) {
  tradeAsset = assetMeta(asset);
  if (side) tradeSide = side;
  document.getElementById("tradeQty").value = "";
  document.getElementById("tradeSum").value = "";
  document.getElementById("tradeMessage").textContent = "";
  if (tradePicker) tradePicker.refresh();
  renderTradePanel();
  fetchAssetQuotes(portfolioQuoteAssets(loadPortfolio())).then(() => {
    syncTradeInputs();
    renderPortfolio();
  });
}

function openPortfolioTrade(asset, side) {
  goToTab("portfolio");
  selectTradeAsset(asset, side);
}

async function executeTrade() {
  const msg = document.getElementById("tradeMessage");
  const show = (text, ok) => {
    msg.textContent = text;
    msg.className = `trade-message ${ok ? "ok" : "err"}`;
  };
  if (!tradeAsset) return show("Сначала выберите актив.", false);

  let q = assetQuotes[tradeAsset.id];
  if (!q || Date.now() - q.time > 120000) {
    await fetchAssetQuotes(portfolioQuoteAssets(loadPortfolio()));
    q = assetQuotes[tradeAsset.id];
  }
  if (!q) return show(`Нет цены этого актива.${IS_HOSTED ? " Попробуйте позже." : " Для зарубежных активов запустите server.py."}`, false);
  const rate = rubPerUnit(q.currency);
  if (!rate) return show("Нет курса валюты для пересчёта в рубли — попробуйте позже.", false);

  const qty = parseFloat(document.getElementById("tradeQty").value);
  if (!(qty > 0)) return show("Укажите количество.", false);
  if (isWholeUnits(tradeAsset) && !Number.isInteger(qty)) return show("Акции покупаются целыми штуками.", false);

  const p = loadPortfolio();
  const total = qty * q.price * rate;
  const ticker = tradeAsset.ticker || tradeAsset.symbol;
  let pos = p.positions.find(x => x.asset.id === tradeAsset.id);
  let pnl = null;

  if (tradeSide === "buy") {
    if (total > p.cash + 0.005) return show(`Не хватает денег: нужно ${formatMoney(total, "RUB")}, свободно ${formatMoney(p.cash, "RUB")}.`, false);
    p.cash -= total;
    if (!pos) {
      pos = { asset: assetMeta(tradeAsset), qty: 0, costRub: 0, avgPrice: 0, currency: q.currency };
      p.positions.push(pos);
    }
    pos.avgPrice = (pos.avgPrice * pos.qty + q.price * qty) / (pos.qty + qty);
    pos.qty += qty;
    pos.costRub += total;
  } else {
    if (!pos) return show("Этого актива нет в портфеле.", false);
    if (qty > pos.qty + 1e-9) return show(`У вас только ${formatQty(pos.qty)} ${ticker}.`, false);
    const cost = pos.costRub * Math.min(1, qty / pos.qty);
    pnl = total - cost;
    p.realized += pnl;
    p.cash += total;
    pos.qty -= qty;
    pos.costRub -= cost;
    if (pos.qty <= 1e-9) p.positions = p.positions.filter(x => x !== pos);
  }

  p.trades.unshift({
    time: Date.now(), side: tradeSide, asset: assetMeta(tradeAsset), qty,
    price: q.price, currency: q.currency, totalRub: total, pnl,
  });
  p.trades = p.trades.slice(0, 200);
  savePortfolio(p);

  document.getElementById("tradeQty").value = "";
  document.getElementById("tradeSum").value = "";
  renderPortfolio();
  show(tradeSide === "buy"
    ? `Куплено ${formatQty(qty)} ${ticker} за ${formatMoney(total, "RUB")}`
    : `Продано ${formatQty(qty)} ${ticker} за ${formatMoney(total, "RUB")} · результат сделки ${formatSignedMoney(pnl, "RUB")}`, true);
}

function renderPortfolio() {
  if (!document.getElementById("portfolioSummary")) return;
  const p = loadPortfolio();
  let invested = 0;
  let dayChange = 0;
  const rows = p.positions.map(pos => {
    const q = assetQuotes[pos.asset.id];
    const rate = q ? rubPerUnit(q.currency) : null;
    const value = q && rate ? pos.qty * q.price * rate : null;
    invested += value ?? pos.costRub;
    if (value != null && q.change != null) dayChange += value - value / (1 + q.change / 100);
    return { pos, q, value, pnl: value != null ? value - pos.costRub : null };
  }).sort((a, b) => (b.value ?? b.pos.costRub) - (a.value ?? a.pos.costRub));

  renderPortfolioSummary(p, invested, dayChange, rows.length > 0);
  renderPortfolioPositions(rows);
  renderPortfolioTrades(p);
  renderTradePanel();
}

async function refreshPortfolio(silent = false) {
  const metaEl = document.getElementById("portfolioMeta");
  if (!silent) metaEl.textContent = "Обновление цен...";
  await fetchAssetQuotes(portfolioQuoteAssets(loadPortfolio()));
  portfolioLoaded = true;
  renderPortfolio();
  syncTradeInputs();
  const p = loadPortfolio();
  let meta = `Цены на ${new Date().toLocaleTimeString("ru-RU")} · автообновление каждые 30 секунд · портфель открыт ${formatTradeTime(new Date(p.createdAt).getTime())}`;
  if (serverQuotesAvailable === false && p.positions.some(pos => pos.asset.source === "yahoo" || pos.asset.source === "fiat")) {
    meta += IS_HOSTED
      ? " · цены зарубежных активов обновляются каждые 5 минут"
      : " · зарубежные активы оценены по сохранённым данным — запустите server.py";
  }
  metaEl.textContent = meta;
}

tradePicker = setupAssetPicker({
  input: document.getElementById("tradeAssetInput"),
  list: document.getElementById("tradeAssetList"),
  search: q => {
    if (tradeSide === "sell" && !q) return loadPortfolio().positions.map(pos => pos.asset);
    return searchAssets(q, TRADABLE_KINDS);
  },
  searchRemote: searchAssetsRemote,
  onOpen: ensureMoexList,
  selected: () => tradeAsset,
  format: assetPickerLabel,
  onSelect: asset => selectTradeAsset(asset),
});

document.querySelectorAll(".trade-side-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    tradeSide = btn.dataset.side;
    document.getElementById("tradeMessage").textContent = "";
    syncTradeInputs();
  });
});

document.getElementById("tradeQty").addEventListener("input", () => {
  tradeEdited = "qty";
  syncTradeInputs();
});
document.getElementById("tradeSum").addEventListener("input", () => {
  tradeEdited = "sum";
  syncTradeInputs();
});

document.querySelectorAll("#tradeQuick button").forEach(btn => {
  btn.addEventListener("click", () => {
    const priceRub = tradePriceRub();
    if (!tradeAsset || !priceRub) return;
    const part = Number(btn.dataset.part);
    const p = loadPortfolio();
    let qty;
    if (tradeSide === "buy") {
      qty = roundTradeQty((p.cash * part) / priceRub, tradeAsset);
    } else {
      const pos = p.positions.find(x => x.asset.id === tradeAsset.id);
      if (!pos) return;
      qty = part === 1 ? pos.qty : roundTradeQty(pos.qty * part, tradeAsset);
    }
    document.getElementById("tradeQty").value = qty > 0 ? qty : "";
    tradeEdited = "qty";
    syncTradeInputs();
  });
});

document.getElementById("tradeSubmitBtn").addEventListener("click", executeTrade);
document.getElementById("portfolioRefreshBtn").addEventListener("click", () => refreshPortfolio());

// «Начать заново»
(() => {
  const overlay = document.getElementById("portfolioResetOverlay");
  const close = () => overlay.classList.remove("open");
  const chips = overlay.querySelectorAll("[data-capital]");

  document.getElementById("portfolioResetBtn").addEventListener("click", () => {
    resetCapital = loadPortfolio().startCash || DEFAULT_CAPITAL;
    chips.forEach(c => c.classList.toggle("active", Number(c.dataset.capital) === resetCapital));
    overlay.classList.add("open");
  });
  chips.forEach(chip => {
    chip.addEventListener("click", () => {
      resetCapital = Number(chip.dataset.capital);
      chips.forEach(c => c.classList.toggle("active", c === chip));
    });
  });
  document.getElementById("portfolioResetConfirmBtn").addEventListener("click", () => {
    savePortfolio(newPortfolio(resetCapital));
    close();
    document.getElementById("tradeMessage").textContent = "";
    refreshPortfolio();
  });
  document.getElementById("portfolioResetCloseBtn").addEventListener("click", close);
  document.getElementById("portfolioResetCancelBtn").addEventListener("click", close);
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
})();

setInterval(() => {
  if (document.getElementById("portfolio").classList.contains("active")) refreshPortfolio(true);
}, 30000);

// ---------- Конвертер валют ----------
const CONV_STATE_KEY = "converter_state";
const CONV_POPULAR = ["fiat:RUB", "fiat:USD", "fiat:EUR", "fiat:CNY", "crypto:BTC", "crypto:ETH", "crypto:USDT", "crypto:TON",
  "fiat:KZT", "fiat:GBP", "fiat:TRY", "fiat:AED"];
const CONV_PAIRS = [
  ["fiat:USD", "fiat:RUB"], ["fiat:EUR", "fiat:RUB"], ["fiat:CNY", "fiat:RUB"], ["crypto:BTC", "fiat:RUB"],
  ["crypto:ETH", "fiat:RUB"], ["crypto:USDT", "fiat:RUB"], ["crypto:TON", "fiat:RUB"], ["crypto:BTC", "fiat:USD"],
];

let convState = { from: "fiat:USD", to: "fiat:RUB", amount: 1, edited: "from" };
let convFromPicker = null;
let convToPicker = null;
let marketLoadedAt = 0;

try {
  const saved = JSON.parse(localStorage.getItem(CONV_STATE_KEY));
  if (saved && saved.from && saved.to) convState = { ...convState, ...saved };
} catch { /* нет сохранённого выбора */ }

function saveConvState() {
  try { localStorage.setItem(CONV_STATE_KEY, JSON.stringify(convState)); } catch { /* приватный режим */ }
}

let convUnitsCache = { key: "", list: [], byId: new Map() };

function convUnits() {
  const key = `${currencyList.length}|${marketLoadedAt}`;
  if (convUnitsCache.key === key) return convUnitsCache.list;

  const fiat = (currencyList.length ? currencyList : FALLBACK_CURRENCIES).map(code => ({
    id: `fiat:${code}`, ticker: code, name: fiatName(code), kind: "fiat",
    rank: code === "RUB" ? 12 : FIAT_POPULAR.includes(code) ? 10 - FIAT_POPULAR.indexOf(code) / 2 : 0,
  }));
  const crypto = [{ id: "crypto:USDT", ticker: "USDT", name: "Tether", alt: "тезер", kind: "crypto", rank: 8 }]
    .concat(marketData.map((c, i) => {
      const [name, alt] = CRYPTO_NAMES[c.base] || [c.base, ""];
      return { id: `crypto:${c.base}`, ticker: c.base, name, alt, kind: "crypto", rank: Math.max(0, 12 - i / 5) };
    }));
  const list = [...fiat, ...crypto];
  convUnitsCache = { key, list, byId: new Map(list.map(u => [u.id, u])) };
  return list;
}

function convUnitById(id) {
  convUnits();
  const found = convUnitsCache.byId.get(id);
  if (found) return found;
  const [kind, code] = id.split(":");
  return { id, ticker: code, name: kind === "fiat" ? fiatName(code) : code, kind };
}

// Сколько долларов стоит 1 единица
function unitUsd(id) {
  const [kind, code] = id.split(":");
  if (kind === "crypto") {
    if (code === "USDT") return 1;
    const coin = marketData.find(c => c.base === code);
    return coin ? coin.price : null;
  }
  if (code === "USD") return 1;
  return usdRates && usdRates[code] ? 1 / usdRates[code] : null;
}

function roundAmount(value) {
  if (!isFinite(value) || value <= 0) return "";
  if (value >= 1) return Math.round(value * 100) / 100;
  return Number(value.toPrecision(6));
}

function convAmounts(usd) {
  if (usd >= 1000) return [0.001, 0.01, 0.05, 0.1, 0.5, 1, 5, 10];
  if (usd >= 10) return [0.1, 0.5, 1, 5, 10, 50, 100, 500];
  if (usd >= 0.1) return [1, 5, 10, 50, 100, 500, 1000, 5000];
  if (usd >= 0.001) return [100, 500, 1000, 5000, 10000, 50000, 100000, 1000000];
  return [10000, 100000, 1000000, 10000000, 100000000, 1000000000, 10000000000, 100000000000];
}

function renderConverter() {
  const fromAmountEl = document.getElementById("convFromAmount");
  if (!fromAmountEl) return;
  const toAmountEl = document.getElementById("convToAmount");
  const rateEl = document.getElementById("convRate");
  const from = convUnitById(convState.from);
  const to = convUnitById(convState.to);
  if (convFromPicker) convFromPicker.refresh();
  if (convToPicker) convToPicker.refresh();

  const quick = document.getElementById("convQuick");
  quick.innerHTML = CONV_PAIRS.map(([a, b], i) => {
    const active = a === convState.from && b === convState.to;
    return `<button type="button" class="events-chip${active ? " active" : ""}" data-pair="${i}">${convUnitById(a).ticker} → ${convUnitById(b).ticker}</button>`;
  }).join("");
  quick.querySelectorAll("[data-pair]").forEach(btn => {
    btn.addEventListener("click", () => {
      const [a, b] = CONV_PAIRS[Number(btn.dataset.pair)];
      convState = { ...convState, from: a, to: b, amount: 1, edited: "from" };
      document.getElementById("convFromAmount").value = 1;
      saveConvState();
      renderConverter();
    });
  });

  const updated = usdRatesUpdated
    ? `${usdRatesUpdated.getDate()} ${RU_MONTHS_GENITIVE[usdRatesUpdated.getMonth()]}, ${usdRatesUpdated.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`
    : "нет данных";
  document.getElementById("convSources").textContent =
    "Криптовалюты — биржа Bybit в реальном времени (цена к стейблкоину USDT ≈ 1 доллару). " +
    `Обычные валюты — open.er-api.com, курсы обновляются раз в сутки (последнее обновление: ${updated}). ` +
    "Криптовалюта в рубли и другие валюты пересчитывается через доллар; в банках и обменниках курс отличается на их комиссию.";

  const fromUsd = unitUsd(convState.from);
  const toUsd = unitUsd(convState.to);
  const errorEl = document.getElementById("convError");
  if (fromUsd == null || toUsd == null) {
    rateEl.textContent = "Загрузка курсов...";
    errorEl.textContent = (!usdRates && (from.kind === "fiat" || to.kind === "fiat") && currencyList.length)
      ? "Не удалось получить курсы валют. Проверьте интернет-соединение." : "";
    return;
  }
  errorEl.textContent = "";

  const rate = fromUsd / toUsd;
  if (convState.edited === "from") {
    if (document.activeElement !== fromAmountEl) fromAmountEl.value = convState.amount;
    toAmountEl.value = roundAmount(convState.amount * rate);
  } else {
    if (document.activeElement !== toAmountEl) toAmountEl.value = convState.amount;
    fromAmountEl.value = roundAmount(convState.amount / rate);
  }

  rateEl.innerHTML = `
    <b>1 ${escapeHtml(from.ticker)} = ${formatNum(rate)} ${escapeHtml(to.ticker)}</b>
    <span>1 ${escapeHtml(to.ticker)} = ${formatNum(1 / rate)} ${escapeHtml(from.ticker)}</span>
  `;

  document.getElementById("convTableTitle").textContent = `Быстрый пересчёт: ${from.ticker} → ${to.ticker}`;
  document.getElementById("convTable").innerHTML = convAmounts(fromUsd).map(amount => `
    <div class="conv-row">
      <span>${formatQty(amount)} ${escapeHtml(from.ticker)}</span>
      <b>${formatNum(amount * rate)} ${escapeHtml(to.ticker)}</b>
    </div>
  `).join("");
}

function setupConverter() {
  const makePicker = (inputId, listId, key) => setupAssetPicker({
    input: document.getElementById(inputId),
    list: document.getElementById(listId),
    search: q => rankItems(convUnits(), q, CONV_POPULAR),
    selected: () => convUnitById(convState[key]),
    format: u => `${u.ticker} — ${u.name}`,
    onSelect: unit => {
      convState[key] = unit.id;
      saveConvState();
      renderConverter();
    },
  });
  convFromPicker = makePicker("convFromUnit", "convFromList", "from");
  convToPicker = makePicker("convToUnit", "convToList", "to");

  document.getElementById("convFromAmount").addEventListener("input", e => {
    convState.amount = parseFloat(e.target.value) || 0;
    convState.edited = "from";
    saveConvState();
    renderConverter();
  });
  document.getElementById("convToAmount").addEventListener("input", e => {
    convState.amount = parseFloat(e.target.value) || 0;
    convState.edited = "to";
    saveConvState();
    renderConverter();
  });
  document.getElementById("convSwapBtn").addEventListener("click", () => {
    const fromValue = parseFloat(document.getElementById("convFromAmount").value) || 0;
    convState = { ...convState, from: convState.to, to: convState.from, amount: fromValue, edited: "from" };
    document.getElementById("convFromAmount").value = fromValue;
    saveConvState();
    renderConverter();
  });
}

setupConverter();

// Цены криптовалют для конвертера держим свежими, пока вкладка открыта
setInterval(() => {
  if (document.getElementById("currency").classList.contains("active")) loadMarket();
}, 60000);

tabBtns.forEach(btn => {
  const tab = btn.dataset.tab;
  if (tab === "watchlist") {
    btn.addEventListener("click", () => {
      ensureMoexList();
      if (!watchLoaded) refreshWatchlist();
    });
  } else if (tab === "charts") {
    btn.addEventListener("click", () => {
      initCharts();
      ensureMoexList();
      renderCharts();
    });
  } else if (tab === "portfolio") {
    btn.addEventListener("click", () => {
      ensureMoexList();
      if (!portfolioLoaded) refreshPortfolio();
    });
  } else if (tab === "currency") {
    btn.addEventListener("click", () => {
      if (Date.now() - marketLoadedAt > 60000) loadMarket();
      renderConverter();
    });
  }
});

// ---------- Utils ----------
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------- Init ----------
loadCurrencyList();
loadMarket();
loadStocks();
renderSavings();
renderPlanner();
renderHome();
loadHomeWeather();
renderNotes();
checkDeadlineNotifications();
setInterval(checkDeadlineNotifications, 30 * 60 * 1000);

// Цены избранного для карточки «Рынок» на главной
function refreshHomeWatchlist() {
  const watched = loadWatchlist().slice(0, 5);
  if (watched.length) fetchAssetQuotes(watched).then(renderHomeMarket);
}
refreshHomeWatchlist();
setInterval(() => {
  if (document.getElementById("home").classList.contains("active")) refreshHomeWatchlist();
}, 60000);
