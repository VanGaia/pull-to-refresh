const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');

async function setup(prefs = {}, settle = 300, namespace = process.env.TEST_BROWSER || 'chrome', deferStorage = false) {
  let now = 1000, reloads = 0, seq = 0, storageListener;
  let resolveStorage;
  const initialStorage = new Promise(resolve => { resolveStorage = resolve; });
  const timers = new Map(), listeners = {};
  class Element {
    constructor(tag = 'div') { this.tag = tag; this.style = {}; this.scrollHeight = this.clientHeight = 100; this.scrollTop = 0; this.overflowY = 'visible'; this.children = []; }
    matches() { return ['input', 'textarea', 'select', 'video', 'audio'].includes(this.tag); }
    append(...children) { this.children.push(...children); }
    attachShadow() { return new Element('shadow'); }
    setAttribute() {}
  }
  const document = {
    documentElement: new Element('html'), body: new Element('body'),
    scrollingElement: new Element('html'), visibilityState: 'visible', hidden: false,
    createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag),
    addEventListener: (name, fn) => { listeners[name] = fn; }
  };
  const window = { scrollY: 0, innerHeight: 800, addEventListener: (name, fn) => { listeners[name] = fn; } };
  vm.runInNewContext(source, {
    window, document, Element, location: { hostname: 'example.com', reload: () => { reloads++; } },
    performance: { now: () => now }, getComputedStyle: node => ({ overflowY: node.overflowY }),
    setTimeout: (fn, ms) => { timers.set(++seq, { at: now + ms, fn }); return seq; },
    clearTimeout: id => timers.delete(id),
    [namespace]: { storage: { local: { get: defaults => deferStorage ? initialStorage : Promise.resolve({ ...defaults, ...prefs }) }, onChanged: { addListener: fn => { storageListener = fn; } } } }
  });
  await Promise.resolve();
  const tick = ms => {
    const until = now + ms;
    while (true) {
      const next = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a,b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    now = until;
  };
  let lastTouches = [];
  const fire = (name, props = {}) => {
    const event = { isTrusted: true, cancelable: true, defaultPrevented: false, deltaX: 0, deltaY: -100, deltaMode: 0,
      composedPath: () => [document.body, document.documentElement], touches: [], changedTouches: lastTouches,
      preventDefault() { this.defaultPrevented = true; }, ...props };
    if (name === 'touchstart' || name === 'touchmove') lastTouches = event.touches;
    listeners[name]?.(event);
    return event;
  };
  const pull = () => { fire('wheel'); tick(40); fire('wheel'); tick(40); fire('wheel'); };
  tick(settle);
  return { window, document, Element, fire, tick, pull, resolveStorage, reloads: () => reloads,
    change: (patch, area = 'local') => storageListener(Object.fromEntries(Object.entries(patch).map(([k,v]) => [k, { newValue: v }])), area) };
}

test('wheel gesture reloads once within 40 ms of reaching the threshold', async () => {
  const x = await setup(); x.pull(); assert.equal(x.reloads(), 0); x.tick(39); assert.equal(x.reloads(), 0); x.tick(1); assert.equal(x.reloads(), 1); x.tick(2000); assert.equal(x.reloads(), 1);
});
test('continued trackpad inertia does not postpone or repeat refresh', async () => {
  const x = await setup(); x.pull();
  for (let i=0;i<2;i++) { x.tick(16); x.fire('wheel', {deltaY:-2}); }
  assert.equal(x.reloads(),0); x.tick(8); assert.equal(x.reloads(),1);
  for (let i=0;i<30;i++) { x.tick(16); x.fire('wheel', {deltaY:-1}); }
  x.tick(1000); assert.equal(x.reloads(),1);
});
test('new document ignores ongoing inertia until the next distinct gesture', async () => {
  const x = await setup({},0);
  for (let i=0;i<40;i++) { x.fire('wheel'); x.tick(16); }
  x.tick(300); assert.equal(x.reloads(),0);
  x.pull(); x.tick(80); assert.equal(x.reloads(),1);
});
test('slow wheel ticks can accumulate before reaching the threshold', async () => {
  const x = await setup(); x.fire('wheel'); x.tick(150); x.fire('wheel'); x.tick(150); x.fire('wheel');
  assert.equal(x.reloads(),0); x.tick(80); assert.equal(x.reloads(),1);
});
test('works with the Firefox browser namespace', async () => {
  const x = await setup({}, 300, 'browser'); x.pull(); x.tick(80); assert.equal(x.reloads(), 1);
  x.change({ enabled: false }); x.pull(); x.tick(1000); assert.equal(x.reloads(), 1);
});
test('short gesture does not reload', async () => { const x = await setup(); x.fire('wheel'); x.tick(1000); assert.equal(x.reloads(), 0); });
test('scrolling to the top within one gesture does not reload', async () => {
  const x = await setup(); x.window.scrollY = 80; x.fire('wheel'); x.window.scrollY = 0; x.tick(40); x.pull(); x.tick(1000); assert.equal(x.reloads(), 0);
  x.pull(); x.tick(1000); assert.equal(x.reloads(), 1);
});
test('reverse direction cancels an armed gesture', async () => { const x = await setup(); x.pull(); x.fire('wheel', { deltaY: 20 }); x.tick(1000); assert.equal(x.reloads(), 0); });
test('Escape cancels within the confirmation window', async () => { const x = await setup(); x.pull(); x.tick(20); x.fire('keydown', { key: 'Escape' }); x.tick(1000); assert.equal(x.reloads(), 0); });
test('horizontal scroll and zoom do not reload', async () => {
  for (const props of [{ deltaX: 200 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
    const x = await setup(); for (let i=0;i<4;i++) { x.fire('wheel', props); x.tick(40); } x.tick(1000); assert.equal(x.reloads(), 0);
  }
});
test('page-handled and synthetic wheel events are ignored', async () => {
  for (const props of [{ defaultPrevented: true }, { isTrusted: false }]) {
    const x = await setup(); for (let i=0;i<4;i++) { x.fire('wheel', props); x.tick(40); } x.tick(1000); assert.equal(x.reloads(), 0);
  }
});
test('nested scrollers and editors retain their wheel events', async () => {
  for (const tag of ['div','textarea']) {
    const x = await setup(); const node = new x.Element(tag); node.overflowY = 'auto'; node.scrollHeight = 400;
    for (let i=0;i<4;i++) { const e=x.fire('wheel', { composedPath: () => [node, x.document.body] }); assert.equal(e.defaultPrevented, false); x.tick(40); }
    x.tick(1000); assert.equal(x.reloads(), 0);
  }
});
test('disabled globally, per device and per site', async () => {
  for (const prefs of [{ enabled: false }, { wheel: false }, { disabledHosts: ['example.com'] }]) { const x = await setup(prefs); x.pull(); x.tick(1000); assert.equal(x.reloads(), 0); }
});
test('live settings cancel a pending refresh', async () => { const x=await setup(); x.pull(); x.tick(20); x.change({enabled:false}); x.tick(1000); assert.equal(x.reloads(),0); });
test('settings changed during initial load override the stale read', async () => {
  const x = await setup({}, 300, undefined, true);
  x.change({ enabled: false });
  x.resolveStorage({ enabled: true });
  await Promise.resolve();
  x.pull(); x.tick(1000);
  assert.equal(x.reloads(), 0);
  x.change({ enabled: true }); x.pull(); x.tick(80);
  assert.equal(x.reloads(), 1);
});
test('unchanged or unrelated storage notifications do not cancel a gesture', async () => {
  for (const patch of [{}, { unrelated: true }, { enabled: true }, { disabledHosts: [] }]) {
    const x = await setup(); x.pull(); x.change(patch); x.tick(80);
    assert.equal(x.reloads(), 1);
  }
});
test('scrolling away or losing visibility cancels refresh', async () => {
  for (const action of ['scroll','visibilitychange','blur','pagehide']) {
    const x=await setup(); x.pull(); if (action==='scroll') x.window.scrollY=30; if(action==='visibilitychange') x.document.hidden=true;
    x.fire(action); x.tick(1000); assert.equal(x.reloads(),0);
  }
});
test('line-mode wheel delta is normalized', async () => { const x=await setup(); for(let i=0;i<3;i++){x.fire('wheel',{deltaMode:1,deltaY:-5});x.tick(40);} x.tick(1000); assert.equal(x.reloads(),1); });
test('threshold setting controls required gesture length', async () => { const x=await setup({threshold:400}); x.pull(); x.tick(1000); assert.equal(x.reloads(),0); });
const touch = (x,y=100,extra={}) => x.fire('touchstart',{touches:[{identifier:1,clientX:100,clientY:y}],...extra});
const move = (x,y,extra={}) => x.fire('touchmove',{touches:[{identifier:1,clientX:100,clientY:y}],...extra});
test('page-cancelled touch start or end does not refresh', async () => {
  for (const phase of ['start', 'end']) {
    const x = await setup();
    touch(x, 100, { defaultPrevented: phase === 'start' });
    move(x, 260);
    x.fire('touchend', { defaultPrevented: phase === 'end' });
    assert.equal(x.reloads(), 0);
  }
});
test('touch pulls reload immediately on release only', async () => { const x=await setup(); touch(x); move(x,260); x.tick(1000); assert.equal(x.reloads(),0); x.fire('touchend'); assert.equal(x.reloads(),1); });
test('touch returning to origin cancels', async () => { const x=await setup(); touch(x); move(x,260); move(x,102); x.fire('touchend'); x.tick(500); assert.equal(x.reloads(),0); });
test('multi-touch, touch cancellation and horizontal gestures cancel', async () => {
  for(const mode of ['multi','cancel','horizontal']) {
    const x=await setup(); touch(x); move(x,260);
    if(mode==='cancel') x.fire('touchcancel');
    else if(mode==='multi') move(x,260,{touches:[{identifier:1,clientX:100,clientY:260},{identifier:2,clientX:120,clientY:270}]});
    else move(x,110,{touches:[{identifier:1,clientX:240,clientY:110}]});
    x.fire('touchend'); x.tick(500); assert.equal(x.reloads(),0);
  }
});
test('touch must start at top and can be disabled separately', async () => {
  for(const mode of ['below','disabled']) {const x=await setup(mode==='disabled'?{touch:false}:{});if(mode==='below')x.window.scrollY=200;touch(x);x.window.scrollY=0;move(x,300);x.fire('touchend');x.tick(500);assert.equal(x.reloads(),0);}
});
test('touch release uses final coordinates and validates the finger', async () => {
  for (const point of [
    { identifier: 1, clientX: 100, clientY: 100 },
    { identifier: 1, clientX: 400, clientY: 260 },
    { identifier: 2, clientX: 100, clientY: 260 }
  ]) {
    const x = await setup();
    touch(x); move(x, 260);
    x.fire('touchend', { changedTouches: [point] });
    assert.equal(x.reloads(), 0);
  }
});

test('touch release can reach the threshold with its final position', async () => {
  const x = await setup();
  touch(x); move(x, 180);
  x.fire('touchend', { changedTouches: [{ identifier: 1, clientX: 100, clientY: 260 }] });
  assert.equal(x.reloads(), 1);
});

test('a separate wheel gesture can refresh again after a 121 ms pause', async () => {
  const x = await setup();
  x.pull(); x.tick(40);
  assert.equal(x.reloads(), 1);
  x.tick(81);
  x.pull(); x.tick(40);
  assert.equal(x.reloads(), 2);
});

test('new document accepts a gesture after the shorter startup guard', async () => {
  const x = await setup({}, 121);
  x.pull(); x.tick(40);
  assert.equal(x.reloads(), 1);
});

test('120 ms gaps in continuing inertia do not start another refresh', async () => {
  const x = await setup();
  x.pull(); x.tick(40);
  assert.equal(x.reloads(), 1);
  x.tick(80);
  for (let i = 0; i < 5; i++) {
    x.fire('wheel'); x.tick(120);
  }
  assert.equal(x.reloads(), 1);
});
