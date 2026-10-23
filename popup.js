'use strict';
const DEFAULTS = { enabled: true, wheel: true, touch: true, threshold: 220, disabledHosts: [] };
const ids = ['enabled', 'wheel', 'touch', 'threshold', 'siteEnabled'];
const fields = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
const status = document.getElementById('status');
let hostname = null;

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
      const current = await chrome.storage.local.get({ disabledHosts: [] });
      const hosts = new Set(Array.isArray(current.disabledHosts) ? current.disabledHosts : []);
      if (fields[id].checked) hosts.delete(hostname); else hosts.add(hostname);
      patch = { disabledHosts: [...hosts] };
    } else {
      patch = { [id]: id === 'threshold' ? Number(fields[id].value) : fields[id].checked };
    }
    await chrome.storage.local.set(patch);
    status.className = '';
    status.textContent = 'Сохранено';
  } catch {
    status.className = 'error';
    status.textContent = 'Не удалось сохранить. Откройте настройки заново.';
  } finally {
    fields[id].disabled = false;
  }
}

async function init() {
  try {
    const [settings, tabs] = await Promise.all([
      chrome.storage.local.get(DEFAULTS),
      chrome.tabs.query({ active: true, currentWindow: true })
    ]);
    for (const id of ['enabled', 'wheel', 'touch']) fields[id].checked = Boolean(settings[id]);
    fields.threshold.value = Math.min(400, Math.max(120, Number(settings.threshold) || 220));
    updateLength();
    const url = new URL(tabs[0]?.url || 'about:blank');
    const restricted = !['http:', 'https:'].includes(url.protocol) ||
      url.hostname === 'chromewebstore.google.com' ||
      (url.hostname === 'chrome.google.com' && url.pathname.startsWith('/webstore')) ||
      url.hostname === 'microsoftedge.microsoft.com';
    if (!restricted) {
      hostname = url.hostname;
      document.getElementById('hostname').textContent = hostname;
      fields.siteEnabled.checked = !(Array.isArray(settings.disabledHosts) ? settings.disabledHosts : []).includes(hostname);
      fields.siteEnabled.disabled = false;
    } else {
      document.getElementById('hostname').textContent = 'Здесь браузер запрещает расширения';
    }
    for (const id of ['enabled', 'wheel', 'touch', 'threshold']) fields[id].disabled = false;
    for (const id of ids) fields[id].addEventListener('change', () => save(id));
    fields.threshold.addEventListener('input', updateLength);
  } catch {
    status.className = 'error';
    status.textContent = 'Не удалось открыть настройки. Переоткройте окно.';
  }
}
init();
