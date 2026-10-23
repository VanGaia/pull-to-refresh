(() => {
  'use strict';
  const DEFAULTS = { enabled: true, wheel: true, touch: true, threshold: 220, disabledHosts: [] };
  const GAP = 260;
  const WHEEL_CONFIRM_DELAY = 80;
  let settings = { ...DEFAULTS };
  let loaded = false;
  // Ignore an already-running inertial scroll when the new document loads.
  let lastWheel = performance.now();
  let wheelEligible = false;
  let distance = 0;
  let endTimer;
  let wheelArmed = false;
  let touching = null;
  let refreshing = false;
  let ui;

  function normalize(value) {
    const result = { ...DEFAULTS, ...value };
    result.threshold = Math.min(400, Math.max(120, Number(result.threshold) || 220));
    result.disabledHosts = Array.isArray(result.disabledHosts) ? result.disabledHosts : [];
    return result;
  }

  function enabled() {
    return loaded && settings.enabled && !settings.disabledHosts.includes(location.hostname);
  }

  function atTop() {
    return window.scrollY <= 2 && (document.scrollingElement?.scrollTop || 0) <= 2;
  }

  // A gesture inside a menu, editor or scrollable panel belongs to that panel.
  function blocked(event) {
    return event.composedPath().some(node => {
      if (!(node instanceof Element)) return false;
      if (node.matches('input, textarea, select, video, audio, [role="slider"], [role="textbox"]') || node.isContentEditable) return true;
      if (node === document.body || node === document.documentElement || node === document.scrollingElement) return false;
      const style = getComputedStyle(node);
      return /(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 2;
    });
  }

  function ensureUI() {
    if (ui) return;
    const host = document.createElement('div');
    host.style.cssText = 'all:initial!important;position:fixed!important;inset:0 0 auto!important;height:0!important;z-index:2147483647!important;pointer-events:none!important;';
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host{color-scheme:light dark;--ptr-surface:#fffffff2;--ptr-text:#1d1d1f;--ptr-border:#00000014;
      --ptr-accent:#007aff;--ptr-ready:#eef5fff5;--ptr-ready-border:#007aff30;--ptr-shadow:#0000001f}
      .pill{box-sizing:border-box;position:absolute;top:18px;left:50%;display:flex;align-items:center;gap:10px;
      padding:10px 15px;border:1px solid var(--ptr-border);border-radius:14px;background:var(--ptr-surface);color:var(--ptr-text);
      backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
      box-shadow:0 4px 20px var(--ptr-shadow);font:500 13px/20px -apple-system,BlinkMacSystemFont,sans-serif;white-space:nowrap;
      opacity:0;transform:translate(-50%,-70px);transition:opacity .16s,transform .16s;}
      .pill.visible{opacity:1;transform:translate(-50%,0)}
      .pill.ready{background:var(--ptr-ready);border-color:var(--ptr-ready-border)}
      svg{width:20px;height:20px;flex:none;color:var(--ptr-accent)}
      .loading svg{animation:spin .8s linear infinite}
      @keyframes spin{to{transform:rotate(360deg)}}
      @media(prefers-color-scheme:dark){:host{--ptr-surface:#2c2c2ef5;--ptr-text:#f5f5f7;--ptr-border:#ffffff20;
      --ptr-accent:#0a84ff;--ptr-ready:#263449f5;--ptr-ready-border:#0a84ff55;--ptr-shadow:#00000055}}
      @media(forced-colors:active){.pill{background:Canvas;color:CanvasText;border-color:CanvasText}svg{color:LinkText}}
      @media(prefers-reduced-motion:reduce){.pill{transition:none}.loading svg{animation:none}}
    `;
    const pill = document.createElement('div');
    pill.className = 'pill';
    pill.setAttribute('role', 'status');
    pill.setAttribute('aria-live', 'polite');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M20 11a8 8 0 1 0-2.3 6.7M20 4v7h-7');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
    const label = document.createElement('span');
    pill.append(svg, label);
    root.append(style, pill);
    document.documentElement.append(host);
    ui = { host, pill, svg, label };
  }

  function show() {
    if (distance < 10) { hide(); return; }
    ensureUI();
    const ready = distance >= settings.threshold;
    ui.pill.className = `pill visible${ready ? ' ready' : ''}`;
    ui.svg.style.transform = `rotate(${Math.min(1, distance / settings.threshold) * 280}deg)`;
    const label = ready ? (touching ? 'Отпустите для обновления' : 'Обновляем…') : 'Потяните ещё';
    if (ui.label.textContent !== label) ui.label.textContent = label;
  }

  function hide() {
    if (ui) ui.pill.className = 'pill';
  }

  function reset() {
    clearTimeout(endTimer);
    wheelArmed = false;
    refreshing = false;
    distance = 0;
    touching = null;
    wheelEligible = false;
    hide();
  }

  function finish() {
    clearTimeout(endTimer);
    if (!enabled() || !atTop() || distance < settings.threshold) { reset(); return; }
    refreshing = true;
    ensureUI();
    ui.pill.className = 'pill visible ready loading';
    ui.svg.style.transform = '';
    ui.label.textContent = 'Обновляем…';
    if (document.visibilityState === 'visible') location.reload();
    // Also recover when the user cancels a site's beforeunload confirmation.
    reset();
  }

  function onWheel(event) {
    if (!event.isTrusted || refreshing || touching) return;
    const now = performance.now();
    const fresh = now - lastWheel > GAP;
    lastWheel = now;
    if (fresh) {
      reset();
      wheelEligible = enabled() && settings.wheel && atTop() && !blocked(event);
    }
    if (!wheelEligible) return;
    if (!enabled() || !settings.wheel || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
        !atTop() || blocked(event) || event.deltaY >= 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      reset();
      return;
    }
    if (event.cancelable) event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
    distance = Math.min(settings.threshold * 1.3, distance + Math.min(120, -event.deltaY * unit));
    show();
    // Once armed, keep a fixed deadline: trackpad inertia must not postpone it.
    // Reverse direction, Escape and settings changes can still cancel the timer.
    if (wheelArmed) return;
    clearTimeout(endTimer);
    wheelArmed = distance >= settings.threshold;
    endTimer = setTimeout(finish, wheelArmed ? WHEEL_CONFIRM_DELAY : GAP);
  }

  function onTouchStart(event) {
    if (!event.isTrusted || refreshing) return;
    reset();
    if (enabled() && settings.touch && atTop() && event.touches.length === 1 && !blocked(event)) {
      const point = event.touches[0];
      touching = { x: point.clientX, y: point.clientY, id: point.identifier };
    }
  }

  function onTouchMove(event) {
    if (!event.isTrusted || !touching || refreshing) return;
    const point = event.touches[0];
    if (!enabled() || !settings.touch || event.defaultPrevented || !atTop() || event.touches.length !== 1 ||
        point.identifier !== touching.id || blocked(event)) { reset(); return; }
    const dy = point.clientY - touching.y;
    const dx = point.clientX - touching.x;
    if (dy < -8 || Math.abs(dx) > Math.max(12, Math.abs(dy))) { reset(); return; }
    if (dy <= 8) { distance = 0; hide(); return; }
    if (!event.cancelable) { reset(); return; }
    event.preventDefault();
    distance = Math.max(0, dy - 8) * 1.8;
    show();
  }

  function onTouchEnd(event) {
    if (!event.isTrusted || !touching || refreshing) return;
    if (event.touches.length > 0) { reset(); return; }
    touching = null;
    finish();
  }

  chrome.storage.local.get(DEFAULTS).then(value => {
    settings = normalize(value);
    loaded = true;
  }).catch(() => { loaded = false; });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const key of Object.keys(DEFAULTS)) {
      if (changes[key]) settings[key] = changes[key].newValue ?? DEFAULTS[key];
    }
    settings = normalize(settings);
    reset();
  });
  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('touchend', onTouchEnd, { passive: true });
  window.addEventListener('touchcancel', reset, { passive: true });
  window.addEventListener('scroll', () => { if (!atTop()) reset(); }, { passive: true });
  window.addEventListener('blur', reset);
  window.addEventListener('pagehide', reset);
  window.addEventListener('keydown', event => { if (event.key === 'Escape') reset(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
})();
