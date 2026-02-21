(function () {
  'use strict';

  const MIN_SIZE = 40;
  const Z_INDEX = 2147483646;
  const INSTANCE_KEY = '__EXTENSION_REGION_SELECTOR_INSTANCE__';

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function startRegionSelector() {
    if (window[INSTANCE_KEY]) return;
    window[INSTANCE_KEY] = true;

    const doc = document;
    const root = doc.createElement('div');
    root.id = 'ext-region-selector-root';
    root.style.cssText = 'position:fixed;inset:0;z-index:' + Z_INDEX + ';pointer-events:auto;';

    const shadow = root.attachShadow({ mode: 'closed' });
    const host = doc.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;cursor:crosshair;';
    shadow.appendChild(host);

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      .overlay { position:fixed;inset:0;background:rgba(0,0,0,0.5);pointer-events:none; }
      .rect { position:fixed;border:2px solid #4a90d9;background:rgba(74,144,217,0.15);pointer-events:none; }
      .label { position:fixed;background:#1a1a2e;color:#e8e8f0;padding:4px 8px;font:11px Arial;border-radius:4px;pointer-events:none;white-space:nowrap; }
      .toolbar { position:fixed;display:flex;gap:6px;padding:6px;background:#1a1a2e;border-radius:6px;box-shadow:0 2px 12px rgba(0,0,0,0.4); }
      .toolbar button { padding:6px 12px;font:12px Arial;border:none;border-radius:4px;cursor:pointer;background:#4a90d9;color:#fff; }
      .toolbar button:hover { background:#357abd; }
      .toolbar button.cancel { background:#555; }
      .toolbar button.cancel:hover { background:#666; }
    `);
    shadow.adoptedStyleSheets = [sheet];

    const overlay = doc.createElement('div');
    overlay.className = 'overlay';
    host.appendChild(overlay);

    const rectEl = doc.createElement('div');
    rectEl.className = 'rect';
    rectEl.style.display = 'none';
    host.appendChild(rectEl);

    const labelEl = doc.createElement('div');
    labelEl.className = 'label';
    labelEl.style.display = 'none';
    host.appendChild(labelEl);

    let toolbarEl = null;
    let x0 = 0, y0 = 0, x1 = 0, y1 = 0;
    let isDragging = false;
    let isLocked = false;

    function getViewportRect() {
      return { w: window.innerWidth, h: window.innerHeight };
    }

    function applyRect() {
      const left = Math.min(x0, x1);
      const top = Math.min(y0, y1);
      let w = Math.abs(x1 - x0);
      let h = Math.abs(y1 - y0);
      const vp = getViewportRect();
      const right = left + w;
      const bottom = top + h;
      const clampedLeft = clamp(left, 0, vp.w - MIN_SIZE);
      const clampedTop = clamp(top, 0, vp.h - MIN_SIZE);
      const clampedRight = clamp(right, MIN_SIZE, vp.w);
      const clampedBottom = clamp(bottom, MIN_SIZE, vp.h);
      w = clampedRight - clampedLeft;
      h = clampedBottom - clampedTop;
      const finalW = Math.max(MIN_SIZE, w);
      const finalH = Math.max(MIN_SIZE, h);
      rectEl.style.left = clampedLeft + 'px';
      rectEl.style.top = clampedTop + 'px';
      rectEl.style.width = finalW + 'px';
      rectEl.style.height = finalH + 'px';
      rectEl.style.display = 'block';
      labelEl.textContent = Math.round(finalW) + ' × ' + Math.round(finalH);
      labelEl.style.left = clampedLeft + 'px';
      labelEl.style.top = (clampedTop - 24) + 'px';
      if (parseInt(labelEl.style.top, 10) < 0) labelEl.style.top = (clampedTop + finalH + 4) + 'px';
      labelEl.style.display = 'block';
    }

    function showToolbar() {
      if (toolbarEl) return;
      const left = Math.min(x0, x1);
      const top = Math.min(y0, y1);
      const w = Math.max(MIN_SIZE, Math.abs(x1 - x0));
      const h = Math.max(MIN_SIZE, Math.abs(y1 - y0));
      toolbarEl = doc.createElement('div');
      toolbarEl.className = 'toolbar';
      toolbarEl.style.left = left + 'px';
      toolbarEl.style.top = (top + h + 8) + 'px';
      const vp = getViewportRect();
      if (top + h + 60 > vp.h) toolbarEl.style.top = (top - 40) + 'px';
      const startBtn = doc.createElement('button');
      startBtn.textContent = 'Start';
      const reselectBtn = doc.createElement('button');
      reselectBtn.textContent = 'Reselect';
      reselectBtn.className = 'cancel';
      const cancelBtn = doc.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.className = 'cancel';
      toolbarEl.append(startBtn, reselectBtn, cancelBtn);

      startBtn.addEventListener('click', function onStart() {
        const vp = getViewportRect();
        let l = Math.min(x0, x1);
        let t = Math.min(y0, y1);
        let rw = Math.max(MIN_SIZE, Math.abs(x1 - x0));
        let rh = Math.max(MIN_SIZE, Math.abs(y1 - y0));
        l = clamp(l, 0, vp.w - MIN_SIZE);
        t = clamp(t, 0, vp.h - MIN_SIZE);
        rw = Math.min(rw, vp.w - l);
        rh = Math.min(rh, vp.h - t);
        rw = Math.max(MIN_SIZE, rw);
        rh = Math.max(MIN_SIZE, rh);
        const region = { x: l, y: t, width: rw, height: rh };
        window.postMessage({ type: 'REGION_SELECTED', region: region }, '*');
        cleanup();
      });
      reselectBtn.addEventListener('click', function onReselect() {
        isLocked = false;
        toolbarEl.remove();
        toolbarEl = null;
        rectEl.style.display = 'none';
        labelEl.style.display = 'none';
      });
      cancelBtn.addEventListener('click', cleanup);

      host.appendChild(toolbarEl);
    }

    function cleanup() {
      doc.removeEventListener('mousedown', onMouseDown, true);
      doc.removeEventListener('mousemove', onMouseMove, true);
      doc.removeEventListener('mouseup', onMouseUp, true);
      window.removeEventListener('keydown', onKeyDown, true);
      root.remove();
      delete window[INSTANCE_KEY];
    }

    function onMouseDown(e) {
      if (e.button !== 0 || isLocked) return;
      e.preventDefault();
      e.stopPropagation();
      isDragging = true;
      x0 = x1 = e.clientX;
      y0 = y1 = e.clientY;
      applyRect();
    }

    function onMouseMove(e) {
      if (!isDragging || isLocked) return;
      e.preventDefault();
      const vp = getViewportRect();
      x1 = clamp(e.clientX, 0, vp.w);
      y1 = clamp(e.clientY, 0, vp.h);
      applyRect();
    }

    function onMouseUp(e) {
      if (e.button !== 0) return;
      if (isDragging && !isLocked) {
        e.preventDefault();
        e.stopPropagation();
        isDragging = false;
        const w = Math.abs(x1 - x0);
        const h = Math.abs(y1 - y0);
        if (w >= MIN_SIZE && h >= MIN_SIZE) {
          isLocked = true;
          showToolbar();
        } else {
          rectEl.style.display = 'none';
          labelEl.style.display = 'none';
        }
      }
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cleanup();
      }
    }

    doc.addEventListener('mousedown', onMouseDown, true);
    doc.addEventListener('mousemove', onMouseMove, true);
    doc.addEventListener('mouseup', onMouseUp, true);
    window.addEventListener('keydown', onKeyDown, true);

    doc.body.appendChild(root);
  }

  if (typeof window !== 'undefined') {
    window.__EXTENSION_REGION_SELECTOR__ = startRegionSelector;
  }
})();
