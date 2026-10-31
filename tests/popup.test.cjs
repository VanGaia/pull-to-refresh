const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');

async function setup(namespace, url, { queryFails = false, saveFails = false } = {}) {
  const elements = new Map();
  const saved = [];
  const document = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, {
      disabled: true, checked: false, value: '', textContent: '',
      min: '120', max: '400', style: { setProperty() {} },
      listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; }
    });
    return elements.get(id);
  } };
  const api = {
    runtime: namespace === 'browser' ? { getBrowserInfo() {} } : {},
    storage: { local: {
      get: async defaults => ({ ...defaults }),
      set: async patch => { if (saveFails) throw new Error('Storage unavailable'); saved.push(patch); }
    } },
    tabs: { query: async () => { if (queryFails) throw new Error('Tab unavailable'); return [{ url }]; } }
  };
  vm.runInNewContext(source, { document, URL, [namespace]: api });
  await new Promise(resolve => setImmediate(resolve));
  return { elements, saved };
}

for (const namespace of ['chrome', 'browser']) {
  test(`${namespace}: unavailable or invalid tab does not block general settings`, async () => {
    for (const options of [{ queryFails: true }, {}]) {
      const { elements } = await setup(namespace, 'invalid url', options);
      assert.equal(elements.get('enabled').disabled, false);
      assert.equal(elements.get('siteEnabled').disabled, true);
      assert.equal(elements.get('hostname').textContent, 'Не удалось определить сайт');
    }
  });

  test(`${namespace}: failed save reports error and unlocks the field`, async () => {
    const { elements, saved } = await setup(namespace, 'https://example.com', { saveFails: true });
    elements.get('wheel').checked = false;
    await elements.get('wheel').listeners.change();
    assert.equal(elements.get('wheel').checked, true);
    assert.equal(elements.get('status').className, 'error');
    assert.equal(elements.get('wheel').disabled, false);
    assert.equal(saved.length, 0);
  });
  test(`${namespace}: failed saves restore the slider and site toggle`, async () => {
    const { elements } = await setup(namespace, 'https://example.com', { saveFails: true });
    const threshold = elements.get('threshold');
    threshold.value = 400;
    threshold.listeners.input();
    await threshold.listeners.change();
    assert.equal(Number(threshold.value), 220);
    assert.equal(elements.get('length').textContent, 'Обычная');
    assert.equal(threshold.disabled, false);
    const site = elements.get('siteEnabled');
    site.checked = false;
    await site.listeners.change();
    assert.equal(site.checked, true);
    assert.equal(site.disabled, false);
  });

  test(`${namespace}: settings load and wheel preference saves`, async () => {
    const { elements, saved } = await setup(namespace, 'https://example.com/');
    const wheel = elements.get('wheel');
    assert.equal(wheel.disabled, false);
    assert.equal(wheel.checked, true);
    assert.equal(elements.get('siteEnabled').disabled, false);
    wheel.checked = false;
    await wheel.listeners.change();
    assert.equal(saved[0].wheel, false);
    assert.equal(elements.get('status').textContent, 'Сохранено');
  });

  test(`${namespace}: Mozilla restrictions apply only in Firefox`, async () => {
    const { elements } = await setup(namespace, 'https://support.mozilla.org/');
    assert.equal(elements.get('siteEnabled').disabled, namespace === 'browser');
    if (namespace === 'chrome') {
      const field = elements.get('siteEnabled');
      field.checked = false;
      await field.listeners.change();
      assert.equal(elements.get('status').textContent, 'Сохранено');
    }
  });

  test(`${namespace}: internal pages have no site toggle`, async () => {
    const { elements } = await setup(namespace, namespace === 'browser' ? 'about:config' : 'chrome://extensions/');
    assert.equal(elements.get('siteEnabled').disabled, true);
    assert.equal(elements.get('enabled').disabled, false);
  });
}
