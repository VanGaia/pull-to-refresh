'use strict';
const api = globalThis.browser ?? globalThis.chrome;
const DEFAULTS = { enabled: true, wheel: true, touch: true, threshold: 220, disabledHosts: [] };
// Firefox default for extensions.webextensions.restrictedDomains.
const FIREFOX_RESTRICTED_HOSTS = [
  'accounts-static.cdn.mozilla.net', 'accounts.firefox.com', 'addons.cdn.mozilla.net', 'addons.mozilla.org',
  'api.accounts.firefox.com', 'content.cdn.mozilla.net', 'discovery.addons.mozilla.org', 'install.mozilla.org',
  'oauth.accounts.firefox.com', 'profile.accounts.firefox.com', 'support.mozilla.org', 'sync.services.mozilla.com'
];
const ids = ['enabled', 'wheel', 'touch', 'threshold', 'siteEnabled'];
const fields = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
const status = document.getElementById('status');
let hostname = null;
const savedValues = {};

function updateLength() {
  const value = Number(fields.threshold.value);
  const progress = (value - Number(fields.threshold.min)) / (Number(fields.threshold.max) - Number(fields.threshold.min)) * 100;
  fields.threshold.style.setProperty('--progress', `${progress}%`);
  document.getElementById('length').textContent = value < 200 ? 'Короткая' : value > 280 ? 'Длинная' : 'Обычная';
}

async function save(id) {
  fields[id].disabled = true;
  try {
    let patch;
    if (id === 'siteEnabled') {
      const current = await api.storage.local.get({ disabledHosts: [] });
      const hosts = new Set(Array.isArray(current.disabledHosts) ? current.disabledHosts : []);
      if (fields[id].checked) hosts.delete(hostname); else hosts.add(hostname);
      patch = { disabledHosts: [...hosts] };
    } else {
      patch = { [id]: id === 'threshold' ? Number(fields[id].value) : fields[id].checked };
    }
    await api.storage.local.set(patch);
    savedValues[id] = id === 'threshold' ? fields[id].value : fields[id].checked;
    status.className = '';
    status.textContent = 'Сохранено';
  } catch {
    if (id === 'threshold') {
      fields[id].value = savedValues[id];
      updateLength();
    } else {
      fields[id].checked = savedValues[id];
    }
    status.className = 'error';
    status.textContent = 'Не удалось сохранить. Откройте настройки заново.';
  } finally {
    fields[id].disabled = false;
  }
}

async function init() {
  try {
    const [settings, tabs] = await Promise.all([
      api.storage.local.get(DEFAULTS),
      api.tabs.query({ active: true, currentWindow: true }).catch(() => [])
    ]);
    for (const id of ['enabled', 'wheel', 'touch']) fields[id].checked = Boolean(settings[id]);
    fields.threshold.value = Math.min(400, Math.max(120, Number(settings.threshold) || 220));
    updateLength();
    let url;
    try { url = new URL(tabs[0]?.url || 'about:blank'); }
    catch { url = new URL('about:blank'); }
    const restricted = !['http:', 'https:'].includes(url.protocol) ||
      url.hostname === 'chromewebstore.google.com' ||
      (url.hostname === 'chrome.google.com' && url.pathname.startsWith('/webstore')) ||
      url.hostname === 'microsoftedge.microsoft.com' ||
      (typeof api.runtime?.getBrowserInfo === 'function' && FIREFOX_RESTRICTED_HOSTS.includes(url.hostname));
    if (!restricted) {
      hostname = url.hostname;
      document.getElementById('hostname').textContent = hostname;
      fields.siteEnabled.checked = !(Array.isArray(settings.disabledHosts) ? settings.disabledHosts : []).includes(hostname);
      fields.siteEnabled.disabled = false;
    } else {
      document.getElementById('hostname').textContent = url.protocol === 'about:' && url.pathname === 'blank'
        ? 'Не удалось определить сайт' : 'Здесь браузер запрещает расширения';
    }
    for (const id of ['enabled', 'wheel', 'touch', 'threshold']) fields[id].disabled = false;
    for (const id of ids) {
      savedValues[id] = id === 'threshold' ? fields[id].value : fields[id].checked;
      fields[id].addEventListener('change', () => save(id));
    }
    fields.threshold.addEventListener('input', updateLength);
  } catch {
    status.className = 'error';
    status.textContent = 'Не удалось открыть настройки. Переоткройте окно.';
  }
}
init();
