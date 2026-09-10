/* ─────────────────────────────────────────────
   Gyroscope Visualizer — app.js
   Supports iOS (DeviceOrientationEvent permission)
   and Android (DeviceMotion / DeviceOrientation)
   ───────────────────────────────────────────── */

(function () {
  'use strict';

  // ── Constants ────────────────────────────────
  const MAX_POINTS    = 300;   // max samples in time-series window
  const MAX_3D_POINTS = 800;   // max points in 3D cloud
  const COLORS = {
    x: '#f87171',
    y: '#4ade80',
    z: '#60a5fa',
  };

  // ── State ─────────────────────────────────────
  let capturing   = false;
  let startTime   = null;
  let rafId       = null;

  // Time-series data: arrays of { t, v } objects
  const series = { x: [], y: [], z: [] };

  // 3-D cloud: array of [x, y, z]
  const points3d = [];

  // Current live values
  let liveX = 0, liveY = 0, liveZ = 0;
  let hasData = false;

  // 3-D camera rotation (drag)
  let rotX = 0.4, rotY = -0.5;
  let dragActive = false;
  let dragLast   = { x: 0, y: 0 };

  // ── DOM refs ──────────────────────────────────
  const btnStart   = document.getElementById('btn-start');
  const btnStop    = document.getElementById('btn-stop');
  const btnClear   = document.getElementById('btn-clear');
  const statusBadge = document.getElementById('status-badge');
  const valX       = document.getElementById('val-x');
  const valY       = document.getElementById('val-y');
  const valZ       = document.getElementById('val-z');
  const overlay    = document.getElementById('message-overlay');
  const msgIcon    = document.getElementById('msg-icon');
  const msgTitle   = document.getElementById('msg-title');
  const msgBody    = document.getElementById('msg-body');
  const msgBtn     = document.getElementById('msg-btn');

  const canvasTime = document.getElementById('canvas-time');
  const ctx2d      = canvasTime.getContext('2d');

  const canvas3d   = document.getElementById('canvas-3d');
  const ctx3d      = canvas3d.getContext('2d');

  // ── Utility: DPR-aware canvas resize ─────────
  function resizeCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width  = Math.round(rect.width  * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
  }

  function resizeAll() {
    resizeCanvas(canvasTime);
    resizeCanvas(canvas3d);
  }

  window.addEventListener('resize', resizeAll);
  resizeAll();

  // ── Status helpers ────────────────────────────
  function setStatus(state, label) {
    statusBadge.textContent = label;
    statusBadge.className   = state; // '', 'active', 'error'
  }

  // ── Sensor event handler ──────────────────────
  /**
   * DeviceMotion gives rotationRate (alpha/beta/gamma in deg/s)
   * DeviceOrientation gives absolute angles — less useful for velocity viz
   * We prefer DeviceMotion.rotationRate; fall back to DeviceOrientation deltas.
   */
  function onMotion(e) {
    if (!capturing) return;

    const rr = e.rotationRate;
    if (rr && (rr.alpha !== null || rr.beta !== null || rr.gamma !== null)) {
      // Convert deg/s → rad/s for display consistency
      const toRad = Math.PI / 180;
      liveX = (rr.alpha || 0) * toRad;
      liveY = (rr.beta  || 0) * toRad;
      liveZ = (rr.gamma || 0) * toRad;
      hasData = true;
      pushSample(liveX, liveY, liveZ);
    }
  }

  // Fallback: orientation-based (angular position, not velocity)
  let prevOrientation = null;
  let prevOrientationTime = null;

  function onOrientation(e) {
    if (!capturing) return;

    const now = performance.now();
    if (prevOrientation && prevOrientationTime) {
      const dt = (now - prevOrientationTime) / 1000; // seconds
      if (dt > 0) {
        // Finite-difference velocity estimate
        const toRad = Math.PI / 180;
        liveX = ((e.alpha || 0) - prevOrientation.alpha) * toRad / dt;
        liveY = ((e.beta  || 0) - prevOrientation.beta)  * toRad / dt;
        liveZ = ((e.gamma || 0) - prevOrientation.gamma) * toRad / dt;
        hasData = true;
        pushSample(liveX, liveY, liveZ);
      }
    }
    prevOrientation = { alpha: e.alpha || 0, beta: e.beta || 0, gamma: e.gamma || 0 };
    prevOrientationTime = now;
  }

  function pushSample(x, y, z) {
    const t = (performance.now() - startTime) / 1000;

    series.x.push({ t, v: x });
    series.y.push({ t, v: y });
    series.z.push({ t, v: z });

    if (series.x.length > MAX_POINTS) { series.x.shift(); series.y.shift(); series.z.shift(); }

    points3d.push([x, y, z]);
    if (points3d.length > MAX_3D_POINTS) points3d.shift();
  }

  // ── Sensor attachment ─────────────────────────
  let motionAttached      = false;
  let orientationAttached = false;

  function attachSensors() {
    // Prefer DeviceMotion (gives rate directly)
    if ('DeviceMotionEvent' in window) {
      window.addEventListener('devicemotion', onMotion, { passive: true });
      motionAttached = true;
    }
    // Always attach orientation as fallback / supplement
    if ('DeviceOrientationEvent' in window) {
      window.addEventListener('deviceorientation', onOrientation, { passive: true });
      orientationAttached = true;
    }
  }

  function detachSensors() {
    if (motionAttached) {
      window.removeEventListener('devicemotion', onMotion);
      motionAttached = false;
    }
    if (orientationAttached) {
      window.removeEventListener('deviceorientation', onOrientation);
      orientationAttached = false;
    }
    prevOrientation = null;
    prevOrientationTime = null;
  }

  // ── iOS 13+ permission flow ───────────────────
  // Both DeviceMotionEvent AND DeviceOrientationEvent need permission on iOS 13+.
  // We request DeviceMotionEvent first (it covers the gyroscope / rotationRate),
  // then DeviceOrientationEvent for the orientation fallback.
  function needsIosPermission() {
    return (
      typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function'
    );
  }

  function requestIosPermissions(callback) {
    // Request DeviceMotionEvent permission first
    DeviceMotionEvent.requestPermission()
      .then(motionState => {
        if (motionState !== 'granted') {
          callback(false, 'Motion permission denied. Please allow access in Settings → Safari → Motion & Orientation Access.');
          return;
        }
        // Also request DeviceOrientationEvent if it has requestPermission
        if (typeof DeviceOrientationEvent !== 'undefined' &&
            typeof DeviceOrientationEvent.requestPermission === 'function') {
          return DeviceOrientationEvent.requestPermission();
        }
        return Promise.resolve('granted');
      })
      .then(orientState => {
        // orientState may be undefined if we returned early above
        if (orientState !== undefined && orientState !== 'granted') {
          // Orientation denied but motion was granted — still usable
          console.warn('Orientation permission denied, using motion only.');
        }
        callback(true);
      })
      .catch(err => {
        callback(false, err.message || 'Permission request failed.');
      });
  }

  // Detect if we're on a non-secure origin (HTTP, not HTTPS or localhost)
  function isInsecureOrigin() {
    const loc = window.location;
    return loc.protocol === 'http:' &&
           loc.hostname !== 'localhost' &&
           loc.hostname !== '127.0.0.1' &&
           !loc.hostname.startsWith('192.168.') &&  // local network — still http but common dev case
           loc.hostname !== '[::1]';
  }

  // ── Start / Stop ──────────────────────────────
  function startCapture() {
    if (capturing) return;

    // Hard block: iOS Safari and Chrome on iOS refuse sensor events on HTTP
    if (isInsecureOrigin()) {
      showError(
        'HTTPS Required',
        'Mobile browsers block sensor access on HTTP pages. Please serve this page over HTTPS. ' +
        'For local testing, use "npx serve" with ngrok, or open via your local IP (e.g. http://192.168.x.x is usually fine on Android).'
      );
      return;
    }

    // No sensor APIs at all (old desktop browsers, some privacy-hardened browsers)
    if (!('DeviceMotionEvent' in window) && !('DeviceOrientationEvent' in window)) {
      showError(
        'Sensors Not Available',
        'No motion or orientation sensor APIs were found. Open this page on a physical iOS or Android device using Safari, Chrome, or Firefox.'
      );
      return;
    }

    // iOS 13+ requires an explicit user-gesture permission prompt
    if (needsIosPermission()) {
      showOverlay(
        '📱',
        'Permission Required',
        'Tap "Grant Permission" to allow access to the gyroscope. You will see an iOS system prompt — tap Allow.',
        'Grant Permission',
        () => {
          requestIosPermissions((ok, errMsg) => {
            hideOverlay();
            if (ok) {
              doStart();
            } else {
              showError('Permission Denied', errMsg || 'Could not access gyroscope. Check Settings → Privacy → Motion & Fitness.');
            }
          });
        }
      );
      return;
    }

    doStart();
  }

  function doStart() {
    capturing  = true;
    startTime  = performance.now();
    hasData    = false;

    attachSensors();
    setStatus('active', 'Capturing');
    btnStart.disabled = true;
    btnStop.disabled  = false;

    // Start render loop
    if (rafId) cancelAnimationFrame(rafId);
    loop();

    // Warn if no data after 3 s
    setTimeout(() => {
      if (capturing && !hasData) {
        setStatus('error', 'No data');
        const isIos = /iP(hone|ad|od)/.test(navigator.userAgent);
        const msg = isIos
          ? 'No data received. On iOS, make sure:\n• The page is served over HTTPS\n• You tapped Allow on the system prompt\n• Settings → Safari → Motion & Orientation Access is ON'
          : 'No gyroscope data received. Make sure you are on a physical device (not a simulator/emulator) and the page is served over HTTPS.';
        showError('No Sensor Data', msg);
      }
    }, 3000);
  }

  function stopCapture() {
    if (!capturing) return;
    capturing = false;
    detachSensors();
    setStatus('', 'Stopped');
    btnStart.disabled = false;
    btnStop.disabled  = true;
  }

  function clearData() {
    series.x.length = 0;
    series.y.length = 0;
    series.z.length = 0;
    points3d.length = 0;
    liveX = liveY = liveZ = 0;
    hasData = false;
    valX.textContent = '—';
    valY.textContent = '—';
    valZ.textContent = '—';
    if (!capturing) {
      setStatus('', 'Idle');
      drawTimeSeries();
      draw3D();
    }
  }

  // ── Render loop ───────────────────────────────
  function loop() {
    if (!capturing) return;
    updateLiveValues();
    drawTimeSeries();
    draw3D();
    rafId = requestAnimationFrame(loop);
  }

  function updateLiveValues() {
    valX.textContent = liveX.toFixed(3);
    valY.textContent = liveY.toFixed(3);
    valZ.textContent = liveZ.toFixed(3);
  }

  // ── TIME-SERIES CHART ─────────────────────────
  function drawTimeSeries() {
    const dpr  = window.devicePixelRatio || 1;
    const W    = canvasTime.width  / dpr;
    const H    = canvasTime.height / dpr;
    const padL = 42, padR = 10, padT = 10, padB = 26;

    ctx2d.clearRect(0, 0, W, H);

    // Background
    ctx2d.fillStyle = '#1a1d27';
    ctx2d.fillRect(0, 0, W, H);

    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    // Collect all values to auto-scale
    let minV = -1, maxV = 1;
    ['x', 'y', 'z'].forEach(axis => {
      series[axis].forEach(p => {
        if (p.v < minV) minV = p.v;
        if (p.v > maxV) maxV = p.v;
      });
    });
    const range   = maxV - minV || 2;
    const padding = range * 0.12;
    const yMin    = minV - padding;
    const yMax    = maxV + padding;
    const yRange  = yMax - yMin;

    // X-axis time window
    let tMin = 0, tMax = 10;
    if (series.x.length > 1) {
      tMax = series.x[series.x.length - 1].t;
      tMin = Math.max(0, tMax - 10);
    }
    const tRange = tMax - tMin || 10;

    // Grid lines
    ctx2d.strokeStyle = '#2a2d3a';
    ctx2d.lineWidth   = 0.8;
    const yTicks = 5;
    for (let i = 0; i <= yTicks; i++) {
      const y = padT + (i / yTicks) * plotH;
      ctx2d.beginPath();
      ctx2d.moveTo(padL, y);
      ctx2d.lineTo(padL + plotW, y);
      ctx2d.stroke();
    }
    const xTicks = 5;
    for (let i = 0; i <= xTicks; i++) {
      const x = padL + (i / xTicks) * plotW;
      ctx2d.beginPath();
      ctx2d.moveTo(x, padT);
      ctx2d.lineTo(x, padT + plotH);
      ctx2d.stroke();
    }

    // Zero line
    if (yMin < 0 && yMax > 0) {
      const zy = padT + (1 - (-yMin / yRange)) * plotH;
      ctx2d.strokeStyle = '#3f4255';
      ctx2d.lineWidth   = 1;
      ctx2d.setLineDash([4, 3]);
      ctx2d.beginPath();
      ctx2d.moveTo(padL, zy);
      ctx2d.lineTo(padL + plotW, zy);
      ctx2d.stroke();
      ctx2d.setLineDash([]);
    }

    // Axis labels (Y)
    ctx2d.fillStyle   = '#64748b';
    ctx2d.font        = '10px -apple-system, sans-serif';
    ctx2d.textAlign   = 'right';
    ctx2d.textBaseline = 'middle';
    for (let i = 0; i <= yTicks; i++) {
      const v = yMax - (i / yTicks) * yRange;
      const y = padT + (i / yTicks) * plotH;
      ctx2d.fillText(v.toFixed(1), padL - 4, y);
    }

    // Axis labels (X)
    ctx2d.textAlign   = 'center';
    ctx2d.textBaseline = 'top';
    for (let i = 0; i <= xTicks; i++) {
      const t = tMin + (i / xTicks) * tRange;
      const x = padL + (i / xTicks) * plotW;
      ctx2d.fillText(t.toFixed(1) + 's', x, padT + plotH + 4);
    }

    // Series lines
    const axes = [
      { key: 'x', color: COLORS.x },
      { key: 'y', color: COLORS.y },
      { key: 'z', color: COLORS.z },
    ];

    axes.forEach(({ key, color }) => {
      const pts = series[key].filter(p => p.t >= tMin && p.t <= tMax + 0.1);
      if (pts.length < 2) return;

      ctx2d.strokeStyle = color;
      ctx2d.lineWidth   = 1.8;
      ctx2d.lineJoin    = 'round';
      ctx2d.lineCap     = 'round';
      ctx2d.beginPath();

      pts.forEach((p, i) => {
        const px = padL + ((p.t - tMin) / tRange) * plotW;
        const py = padT + (1 - (p.v - yMin) / yRange) * plotH;
        if (i === 0) ctx2d.moveTo(px, py);
        else         ctx2d.lineTo(px, py);
      });
      ctx2d.stroke();
    });

    // Clip to plot area (border)
    ctx2d.strokeStyle = '#2a2d3a';
    ctx2d.lineWidth   = 1;
    ctx2d.strokeRect(padL, padT, plotW, plotH);
  }

  // ── 3-D POINT CLOUD ───────────────────────────
  // Simple isometric-style projection with drag rotation
  // Uses a 3-D rotation matrix (rotX, rotY) and projects onto 2-D canvas

  function project3d(x, y, z, cx, cy, scale) {
    // Rotate around Y axis (rotY)
    const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
    let rx  = x * cosY + z * sinY;
    let ry  = y;
    let rz  = -x * sinY + z * cosY;

    // Rotate around X axis (rotX)
    const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
    const ry2 = ry * cosX - rz * sinX;
    const rz2 = ry * sinX + rz * cosX;

    // Simple orthographic projection
    const sx = cx + rx * scale;
    const sy = cy - ry2 * scale;
    return { sx, sy, depth: rz2 };
  }

  function draw3D() {
    const dpr = window.devicePixelRatio || 1;
    const W   = canvas3d.width  / dpr;
    const H   = canvas3d.height / dpr;
    const cx  = W / 2;
    const cy  = H / 2;

    ctx3d.clearRect(0, 0, W, H);

    // Background
    ctx3d.fillStyle = '#1a1d27';
    ctx3d.fillRect(0, 0, W, H);

    // Auto-scale from data
    let maxAbs = 1;
    points3d.forEach(([x, y, z]) => {
      maxAbs = Math.max(maxAbs, Math.abs(x), Math.abs(y), Math.abs(z));
    });
    const scale = (Math.min(W, H) * 0.38) / maxAbs;

    // Reference axes
    const axisLen = Math.min(W, H) * 0.38;
    const axes3 = [
      { dir: [1,0,0], color: COLORS.x, label: 'X' },
      { dir: [0,1,0], color: COLORS.y, label: 'Y' },
      { dir: [0,0,1], color: COLORS.z, label: 'Z' },
    ];

    axes3.forEach(({ dir, color, label }) => {
      const end = project3d(dir[0]*axisLen/scale, dir[1]*axisLen/scale, dir[2]*axisLen/scale, cx, cy, scale);
      const neg = project3d(-dir[0]*axisLen/scale*0.3, -dir[1]*axisLen/scale*0.3, -dir[2]*axisLen/scale*0.3, cx, cy, scale);

      ctx3d.strokeStyle = color + '55';
      ctx3d.lineWidth   = 1;
      ctx3d.setLineDash([4, 4]);
      ctx3d.beginPath();
      ctx3d.moveTo(neg.sx, neg.sy);
      ctx3d.lineTo(cx, cy);
      ctx3d.stroke();
      ctx3d.setLineDash([]);

      ctx3d.strokeStyle = color;
      ctx3d.lineWidth   = 1.5;
      ctx3d.beginPath();
      ctx3d.moveTo(cx, cy);
      ctx3d.lineTo(end.sx, end.sy);
      ctx3d.stroke();

      ctx3d.fillStyle    = color;
      ctx3d.font         = '11px -apple-system, sans-serif';
      ctx3d.textAlign    = 'center';
      ctx3d.textBaseline = 'middle';
      ctx3d.fillText(label, end.sx, end.sy - 10);
    });

    // Origin dot
    ctx3d.fillStyle = '#475569';
    ctx3d.beginPath();
    ctx3d.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx3d.fill();

    if (points3d.length === 0) {
      ctx3d.fillStyle    = '#475569';
      ctx3d.font         = '12px -apple-system, sans-serif';
      ctx3d.textAlign    = 'center';
      ctx3d.textBaseline = 'middle';
      ctx3d.fillText('No data yet — press Start', cx, cy + 30);
      return;
    }

    // Draw points, sorted by depth (painter's algorithm)
    const projected = points3d.map(([x, y, z], i) => {
      const p = project3d(x, y, z, cx, cy, scale);
      return { ...p, x, y, z, i };
    });
    projected.sort((a, b) => a.depth - b.depth);

    projected.forEach(({ sx, sy, x, y, z, i }) => {
      // Color each axis independently using HSL blend trick:
      // We map each point to a color mixing x→red, y→green, z→blue
      const total = Math.max(Math.abs(x) + Math.abs(y) + Math.abs(z), 0.0001);
      const rx = Math.abs(x) / total;
      const ry = Math.abs(y) / total;
      const rz = Math.abs(z) / total;

      // Blend: weighted mix of the 3 axis colors
      const r = Math.round(0xf8 * rx + 0x4a * ry + 0x60 * rz);
      const g = Math.round(0x71 * rx + 0xde * ry + 0xa5 * rz);
      const b = Math.round(0x71 * rx + 0x80 * ry + 0xfa * rz);

      const alpha = 0.35 + 0.65 * (i / points3d.length); // fade old points

      ctx3d.fillStyle = `rgba(${r},${g},${b},${alpha})`;
      ctx3d.beginPath();
      ctx3d.arc(sx, sy, 2.5, 0, Math.PI * 2);
      ctx3d.fill();
    });

    // Live point highlight
    if (hasData) {
      const lp = project3d(liveX, liveY, liveZ, cx, cy, scale);
      ctx3d.strokeStyle = '#fff';
      ctx3d.lineWidth   = 1.5;
      ctx3d.fillStyle   = '#ffffffcc';
      ctx3d.beginPath();
      ctx3d.arc(lp.sx, lp.sy, 5, 0, Math.PI * 2);
      ctx3d.fill();
      ctx3d.stroke();
    }
  }

  // ── 3D drag (mouse + touch) ───────────────────
  function startDrag(ex, ey) {
    dragActive = true;
    dragLast   = { x: ex, y: ey };
  }

  function moveDrag(ex, ey) {
    if (!dragActive) return;
    const dx = ex - dragLast.x;
    const dy = ey - dragLast.y;
    rotY += dx * 0.008;
    rotX += dy * 0.008;
    rotX  = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, rotX));
    dragLast = { x: ex, y: ey };
    if (!capturing) draw3D();
  }

  function endDrag() { dragActive = false; }

  canvas3d.addEventListener('mousedown',  e => startDrag(e.clientX, e.clientY));
  canvas3d.addEventListener('mousemove',  e => moveDrag(e.clientX, e.clientY));
  canvas3d.addEventListener('mouseup',    endDrag);
  canvas3d.addEventListener('mouseleave', endDrag);

  canvas3d.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      e.preventDefault();
      startDrag(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: false });

  canvas3d.addEventListener('touchmove', e => {
    if (e.touches.length === 1) {
      e.preventDefault();
      moveDrag(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: false });

  canvas3d.addEventListener('touchend',   endDrag);
  canvas3d.addEventListener('touchcancel', endDrag);

  // ── Overlay helpers ───────────────────────────
  function showOverlay(icon, title, body, btnLabel, onConfirm) {
    msgIcon.textContent  = icon;
    msgTitle.textContent = title;
    msgBody.textContent  = body;
    msgBtn.textContent   = btnLabel;
    msgBtn.onclick       = onConfirm;
    overlay.classList.add('visible');
  }

  function hideOverlay() {
    overlay.classList.remove('visible');
  }

  function showError(title, body) {
    showOverlay('⚠️', title, body, 'Close', hideOverlay);
    setStatus('error', 'Error');
  }

  overlay.addEventListener('click', e => {
    if (e.target === overlay) hideOverlay();
  });

  // ── Button wiring ─────────────────────────────
  btnStart.addEventListener('click', startCapture);
  btnStop.addEventListener('click',  stopCapture);
  btnClear.addEventListener('click', clearData);

  // ── Initial render ────────────────────────────
  drawTimeSeries();
  draw3D();

  // Show HTTPS warning if needed
  if (window.location.protocol === 'http:' &&
      window.location.hostname !== 'localhost' &&
      window.location.hostname !== '127.0.0.1') {
    const warn = document.getElementById('https-warning');
    if (warn) warn.style.display = 'block';
  }

})();
