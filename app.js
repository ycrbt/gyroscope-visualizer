/* ─────────────────────────────────────────────
   Gyroscope Visualizer — app.js
   Supports iOS (DeviceOrientationEvent permission)
   and Android (DeviceMotion / DeviceOrientation)
   ───────────────────────────────────────────── */

(function () {
  'use strict';

  // ── Constants ────────────────────────────────
  const MAX_3D_POINTS = 800;   // max points in 3D cloud
  const COLORS = {
    x: '#f87171',
    y: '#4ade80',
    z: '#60a5fa',
  };
  const VIEW_WINDOW_SEC = 10; // seconds visible in the time chart at once

  // ── State ─────────────────────────────────────
  let capturing   = false;
  let startTime   = null;
  let rafId       = null;

  // Time-series data: arrays of { t, v } — unbounded, full history kept
  const series = { x: [], y: [], z: [] };

  // 3-D cloud: array of [x, y, z]
  const points3d = [];

  // Current live values
  let liveX = 0, liveY = 0, liveZ = 0;
  let hasData = false;

  // ── Time-chart scroll state ───────────────────
  // viewOffset: left edge of the visible window in seconds.
  // null = "follow live" mode (auto-tracks the latest data).
  let viewOffset    = null; // null = live-follow
  let chartDragging = false;
  let chartDragStartX   = 0;
  let chartDragStartOff = 0;

  // 3-D scrubber: null = show all points, otherwise index cutoff
  let scrubIndex = null;

  // 3-D camera rotation (drag)
  let rotX = 0.4, rotY = -0.5;
  let dragActive = false;
  let dragLast   = { x: 0, y: 0 };

  // ── DOM refs ──────────────────────────────────
  const btnStart   = document.getElementById('btn-start');
  const btnStop    = document.getElementById('btn-stop');
  const btnClear    = document.getElementById('btn-clear');
  const selRate     = document.getElementById('sel-rate');
  const selSensor   = document.getElementById('sel-sensor');
  const scrubberRow = document.getElementById('scrubber-row');
  const scrubber    = document.getElementById('scrubber');
  const scrubberTime = document.getElementById('scrubber-time');
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

  // ── Sampling rate ─────────────────────────────
  // Device fires events at ~60 Hz. We throttle pushSample to the chosen interval.
  const SAMPLE_RATES = [
    { label: 'Fast (60 Hz)',     ms: 17   },
    { label: 'Normal (20 Hz)',   ms: 50   },
    { label: 'Slow (5 Hz)',      ms: 200  },
    { label: 'Very slow (1 Hz)', ms: 1000 },
  ];
  let sampleIntervalMs = 50; // default: Normal
  let lastSampleTime   = 0;

  // ── Sensor mode ───────────────────────────────
  // 'gyroscope'     — DeviceMotion.rotationRate          (rad/s)
  // 'accelerometer' — DeviceMotion.accelerationIncludingGravity (m/s²)
  // 'orientation'   — DeviceOrientation alpha/beta/gamma  (degrees)
  let sensorMode = 'gyroscope';

  const SENSOR_META = {
    gyroscope:     { label: 'Gyroscope',     unit: 'rad/s',  axes: ['α (yaw)', 'β (pitch)', 'γ (roll)'] },
    accelerometer: { label: 'Accelerometer', unit: 'm/s²',   axes: ['X', 'Y', 'Z'] },
    orientation:   { label: 'Orientation',   unit: 'deg',    axes: ['α (yaw)', 'β (pitch)', 'γ (roll)'] },
  };

  // ── Sensor event handlers ─────────────────────
  function onMotion(e) {
    if (!capturing) return;

    if (sensorMode === 'gyroscope') {
      const rr = e.rotationRate;
      if (!rr || (rr.alpha === null && rr.beta === null && rr.gamma === null)) return;
      const toRad = Math.PI / 180;
      liveX = (rr.alpha || 0) * toRad;
      liveY = (rr.beta  || 0) * toRad;
      liveZ = (rr.gamma || 0) * toRad;
      hasData = true;
      pushSample(liveX, liveY, liveZ);
    }

    if (sensorMode === 'accelerometer') {
      const acc = e.accelerationIncludingGravity;
      if (!acc || (acc.x === null && acc.y === null && acc.z === null)) return;
      liveX = acc.x || 0;
      liveY = acc.y || 0;
      liveZ = acc.z || 0;
      hasData = true;
      pushSample(liveX, liveY, liveZ);
    }
  }

  function onOrientation(e) {
    if (!capturing || sensorMode !== 'orientation') return;
    liveX = e.alpha || 0;
    liveY = e.beta  || 0;
    liveZ = e.gamma || 0;
    hasData = true;
    pushSample(liveX, liveY, liveZ);
  }

  function pushSample(x, y, z) {
    const now = performance.now();
    if (now - lastSampleTime < sampleIntervalMs) return;
    lastSampleTime = now;

    const t = (now - startTime) / 1000;

    series.x.push({ t, v: x });
    series.y.push({ t, v: y });
    series.z.push({ t, v: z });

    points3d.push([x, y, z, t]); // store t for time-based 3D coloring
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
  }

  // ── iOS 13+ permission flow ───────────────────
  // Both DeviceMotionEvent AND DeviceOrientationEvent need permission on iOS 13+.
  // We cache the result so subsequent Start presses skip the prompt entirely.
  let iosPermissionGranted = false;

  function needsIosPermission() {
    return (
      !iosPermissionGranted &&
      typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function'
    );
  }

  function requestIosPermissions(callback) {
    DeviceMotionEvent.requestPermission()
      .then(motionState => {
        if (motionState !== 'granted') {
          callback(false, 'Motion permission denied. Please allow access in Settings → Safari → Motion & Orientation Access.');
          return;
        }
        if (typeof DeviceOrientationEvent !== 'undefined' &&
            typeof DeviceOrientationEvent.requestPermission === 'function') {
          return DeviceOrientationEvent.requestPermission();
        }
        return Promise.resolve('granted');
      })
      .then(orientState => {
        if (orientState !== undefined && orientState !== 'granted') {
          console.warn('Orientation permission denied, using motion only.');
        }
        iosPermissionGranted = true;
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
    capturing      = true;
    startTime      = performance.now();
    hasData        = false;
    lastSampleTime = 0;
    scrubIndex     = null;
    scrubberRow.style.display = 'none';

    attachSensors();
    setStatus('active', 'Capturing');
    btnStart.disabled  = true;
    btnStop.disabled   = false;
    selSensor.disabled = true;

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
    btnStart.disabled  = false;
    btnStop.disabled   = true;
    selSensor.disabled = false;
    // Show 3D time scrubber now that we have a complete capture
    if (points3d.length > 1) {
      scrubIndex = points3d.length - 1;
      scrubber.max   = points3d.length - 1;
      scrubber.value = points3d.length - 1;
      updateScrubberLabel();
      scrubberRow.style.display = 'flex';
    }
  }

  function clearData() {
    series.x.length = 0;
    series.y.length = 0;
    series.z.length = 0;
    points3d.length = 0;
    liveX = liveY = liveZ = 0;
    hasData   = false;
    scrubIndex = null;
    scrubberRow.style.display = 'none';
    viewOffset = null;
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
  // Layout: plot area + scrollbar strip at the bottom inside the canvas.
  const SCROLLBAR_H = 18; // px (CSS pixels)

  function drawTimeSeries() {
    const dpr  = window.devicePixelRatio || 1;
    const W    = canvasTime.width  / dpr;
    const H    = canvasTime.height / dpr;
    const padL = 42, padR = 10, padT = 10;
    const padB = 26 + SCROLLBAR_H; // reserve room for x-labels + scrollbar

    ctx2d.clearRect(0, 0, W, H);
    ctx2d.fillStyle = '#1a1d27';
    ctx2d.fillRect(0, 0, W, H);

    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    // Total recorded duration
    const totalDur = series.x.length > 0
      ? series.x[series.x.length - 1].t
      : VIEW_WINDOW_SEC;

    // Resolve view window
    // viewOffset === null → live-follow
    const effTotal  = Math.max(totalDur, VIEW_WINDOW_SEC);
    const maxOffset = Math.max(0, effTotal - VIEW_WINDOW_SEC);

    let tMin;
    if (viewOffset === null || viewOffset >= maxOffset) {
      tMin = maxOffset;
    } else {
      tMin = Math.max(0, viewOffset);
    }
    const tMax   = tMin + VIEW_WINDOW_SEC;
    const tRange = VIEW_WINDOW_SEC;

    // Y auto-scale from ALL data (so scale is stable while scrolling)
    let minV = -1, maxV = 1;
    ['x', 'y', 'z'].forEach(axis => {
      series[axis].forEach(p => {
        if (p.v < minV) minV = p.v;
        if (p.v > maxV) maxV = p.v;
      });
    });
    const range   = maxV - minV || 2;
    const vPad    = range * 0.12;
    const yMin    = minV - vPad;
    const yMax    = maxV + vPad;
    const yRange  = yMax - yMin;

    // ── Grid ──
    ctx2d.strokeStyle = '#2a2d3a';
    ctx2d.lineWidth   = 0.8;
    const yTicks = 5, xTicks = 5;
    for (let i = 0; i <= yTicks; i++) {
      const y = padT + (i / yTicks) * plotH;
      ctx2d.beginPath(); ctx2d.moveTo(padL, y); ctx2d.lineTo(padL + plotW, y); ctx2d.stroke();
    }
    for (let i = 0; i <= xTicks; i++) {
      const x = padL + (i / xTicks) * plotW;
      ctx2d.beginPath(); ctx2d.moveTo(x, padT); ctx2d.lineTo(x, padT + plotH); ctx2d.stroke();
    }

    // Zero line
    if (yMin < 0 && yMax > 0) {
      const zy = padT + (1 - (0 - yMin) / yRange) * plotH;
      ctx2d.strokeStyle = '#3f4255';
      ctx2d.lineWidth   = 1;
      ctx2d.setLineDash([4, 3]);
      ctx2d.beginPath(); ctx2d.moveTo(padL, zy); ctx2d.lineTo(padL + plotW, zy); ctx2d.stroke();
      ctx2d.setLineDash([]);
    }

    // ── Y labels ──
    ctx2d.fillStyle    = '#64748b';
    ctx2d.font         = '10px -apple-system, sans-serif';
    ctx2d.textAlign    = 'right';
    ctx2d.textBaseline = 'middle';
    for (let i = 0; i <= yTicks; i++) {
      const v = yMax - (i / yTicks) * yRange;
      const y = padT + (i / yTicks) * plotH;
      ctx2d.fillText(v.toFixed(1), padL - 4, y);
    }

    // ── X labels ──
    ctx2d.textAlign    = 'center';
    ctx2d.textBaseline = 'top';
    for (let i = 0; i <= xTicks; i++) {
      const t = tMin + (i / xTicks) * tRange;
      const x = padL + (i / xTicks) * plotW;
      ctx2d.fillText(t.toFixed(1) + 's', x, padT + plotH + 4);
    }

    // ── Series lines (clip to plot area) ──
    ctx2d.save();
    ctx2d.beginPath();
    ctx2d.rect(padL, padT, plotW, plotH);
    ctx2d.clip();

    const axes = [
      { key: 'x', color: COLORS.x },
      { key: 'y', color: COLORS.y },
      { key: 'z', color: COLORS.z },
    ];
    axes.forEach(({ key, color }) => {
      const pts = series[key].filter(p => p.t >= tMin - 0.1 && p.t <= tMax + 0.1);
      if (pts.length < 2) return;
      ctx2d.strokeStyle = color;
      ctx2d.lineWidth   = 1.8;
      ctx2d.lineJoin    = 'round';
      ctx2d.lineCap     = 'round';
      ctx2d.beginPath();
      pts.forEach((p, i) => {
        const px = padL + ((p.t - tMin) / tRange) * plotW;
        const py = padT + (1 - (p.v - yMin) / yRange) * plotH;
        if (i === 0) ctx2d.moveTo(px, py); else ctx2d.lineTo(px, py);
      });
      ctx2d.stroke();
    });
    ctx2d.restore();

    // ── Plot border ──
    ctx2d.strokeStyle = '#2a2d3a';
    ctx2d.lineWidth   = 1;
    ctx2d.strokeRect(padL, padT, plotW, plotH);

    // ── Scrollbar ──
    const sbY = H - SCROLLBAR_H + 2;
    const sbH = SCROLLBAR_H - 4;
    const sbX = padL;
    const sbW = plotW;

    // Track
    ctx2d.fillStyle   = '#12141c';
    ctx2d.beginPath();
    roundRect(ctx2d, sbX, sbY, sbW, sbH, 4);
    ctx2d.fill();

    // Only draw thumb if there's something to scroll
    if (effTotal > VIEW_WINDOW_SEC) {
      const thumbW   = Math.max(28, sbW * (VIEW_WINDOW_SEC / effTotal));
      const thumbMax = sbW - thumbW;
      const thumbX   = sbX + thumbMax * (tMin / maxOffset);

      // Thumb
      const isLive = viewOffset === null || viewOffset >= maxOffset;
      ctx2d.fillStyle = isLive ? '#6366f1' : '#475569';
      ctx2d.beginPath();
      roundRect(ctx2d, thumbX, sbY, thumbW, sbH, 4);
      ctx2d.fill();

      // "LIVE" badge on thumb when auto-following
      if (isLive) {
        ctx2d.fillStyle    = '#fff';
        ctx2d.font         = `bold 8px -apple-system, sans-serif`;
        ctx2d.textAlign    = 'center';
        ctx2d.textBaseline = 'middle';
        ctx2d.fillText('LIVE', thumbX + thumbW / 2, sbY + sbH / 2);
      }
    } else {
      // Not enough data yet — grey bar
      ctx2d.fillStyle = '#2a2d3a';
      ctx2d.beginPath();
      roundRect(ctx2d, sbX, sbY, sbW, sbH, 4);
      ctx2d.fill();
    }
  }

  // Helper: rounded rect path (no native roundRect on older WebKit)
  function roundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // ── Chart scroll interaction ──────────────────
  // Returns { tMin, tMax, maxOffset, effTotal, plotW, padL, sbY, sbH, sbX, sbW }
  // for hit-testing and dragging.
  function chartLayout() {
    const dpr   = window.devicePixelRatio || 1;
    const W     = canvasTime.width  / dpr;
    const H     = canvasTime.height / dpr;
    const padL  = 42, padR = 10, padT = 10;
    const padB  = 26 + SCROLLBAR_H;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const totalDur  = series.x.length > 0 ? series.x[series.x.length - 1].t : VIEW_WINDOW_SEC;
    const effTotal  = Math.max(totalDur, VIEW_WINDOW_SEC);
    const maxOffset = Math.max(0, effTotal - VIEW_WINDOW_SEC);
    const tMin = viewOffset === null || viewOffset >= maxOffset ? maxOffset : Math.max(0, viewOffset);
    const sbY  = H - SCROLLBAR_H + 2;
    const sbH  = SCROLLBAR_H - 4;
    return { W, H, padL, padR, padT, padB, plotW, plotH, effTotal, maxOffset, tMin, sbY, sbH, sbX: padL, sbW: plotW };
  }

  function offsetFromClientX(clientX, layout) {
    const rect = canvasTime.getBoundingClientRect();
    const x    = clientX - rect.left;
    const { sbX, sbW, effTotal, maxOffset } = layout;
    const thumbW = Math.max(28, sbW * (VIEW_WINDOW_SEC / effTotal));
    const thumbMax = sbW - thumbW;
    // Map click/drag position to offset, centering thumb on cursor
    const frac = Math.max(0, Math.min(1, (x - sbX - thumbW / 2) / thumbMax));
    return frac * maxOffset;
  }

  function isInScrollbar(clientX, clientY, layout) {
    const rect = canvasTime.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const { sbX, sbW, sbY, sbH } = layout;
    return x >= sbX && x <= sbX + sbW && y >= sbY && y <= sbY + sbH;
  }

  function isInPlot(clientX, clientY, layout) {
    const rect = canvasTime.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const { padL, padT, plotW, plotH } = layout;
    return x >= padL && x <= padL + plotW && y >= padT && y <= padT + plotH;
  }

  function applyScroll(delta) {
    const layout = chartLayout();
    const { maxOffset } = layout;
    if (maxOffset <= 0) return;
    const current = viewOffset === null ? maxOffset : viewOffset;
    const next    = Math.max(0, Math.min(maxOffset, current + delta));
    viewOffset    = next >= maxOffset ? null : next;
    if (!capturing) drawTimeSeries();
  }

  // Mouse drag on scrollbar or plot area
  canvasTime.addEventListener('mousedown', e => {
    const layout = chartLayout();
    if (isInScrollbar(e.clientX, e.clientY, layout) || isInPlot(e.clientX, e.clientY, layout)) {
      chartDragging     = true;
      chartDragStartX   = e.clientX;
      chartDragStartOff = viewOffset === null ? layout.maxOffset : viewOffset;
      if (isInScrollbar(e.clientX, e.clientY, layout)) {
        // Jump thumb to click position
        viewOffset = offsetFromClientX(e.clientX, layout);
        if (!capturing) drawTimeSeries();
      }
      e.preventDefault();
    }
  });

  window.addEventListener('mousemove', e => {
    if (!chartDragging) return;
    const layout  = chartLayout();
    const { sbW, effTotal, maxOffset } = layout;
    const dxPx    = e.clientX - chartDragStartX;
    // How many seconds does 1 px correspond to?
    const secPerPx = effTotal / sbW;
    const next     = Math.max(0, Math.min(maxOffset, chartDragStartOff + dxPx * secPerPx));
    viewOffset     = next >= maxOffset ? null : next;
    if (!capturing) drawTimeSeries();
  });

  window.addEventListener('mouseup', () => { chartDragging = false; });

  // Touch drag on the time chart
  let chartTouchId    = null;
  let chartTouchStartX   = 0;
  let chartTouchStartOff = 0;

  canvasTime.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    const t      = e.touches[0];
    const layout = chartLayout();
    if (isInScrollbar(t.clientX, t.clientY, layout) || isInPlot(t.clientX, t.clientY, layout)) {
      chartTouchId      = e.touches[0].identifier;
      chartTouchStartX  = t.clientX;
      chartTouchStartOff = viewOffset === null ? layout.maxOffset : viewOffset;
      e.preventDefault();
    }
  }, { passive: false });

  canvasTime.addEventListener('touchmove', e => {
    if (chartTouchId === null) return;
    let touch = null;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === chartTouchId) { touch = e.changedTouches[i]; break; }
    }
    if (!touch) return;
    e.preventDefault();
    const layout  = chartLayout();
    const { sbW, effTotal, maxOffset } = layout;
    // Invert drag direction for plot area (drag left = scroll right = later time)
    const dxPx    = touch.clientX - chartTouchStartX;
    const secPerPx = effTotal / sbW;
    const next     = Math.max(0, Math.min(maxOffset, chartTouchStartOff - dxPx * secPerPx));
    viewOffset     = next >= maxOffset ? null : next;
    if (!capturing) drawTimeSeries();
  }, { passive: false });

  canvasTime.addEventListener('touchend',   () => { chartTouchId = null; });
  canvasTime.addEventListener('touchcancel',() => { chartTouchId = null; });

  // Mouse wheel scroll
  canvasTime.addEventListener('wheel', e => {
    e.preventDefault();
    const layout = chartLayout();
    const { effTotal, sbW } = layout;
    const secPerPx  = effTotal / sbW;
    applyScroll(e.deltaY * secPerPx * 0.5);
  }, { passive: false });

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

    // Slice to scrubIndex when scrubbing historical data
    const cutoff = (scrubIndex !== null) ? scrubIndex + 1 : points3d.length;
    const pts    = points3d.slice(0, cutoff);

    // Project all points in order
    const projected = pts.map(([x, y, z]) => project3d(x, y, z, cx, cy, scale));
    const n         = projected.length;

    // Draw trajectory as connected segments, each colored by time position.
    // Color ramp: old → #3b82f6 (blue) → #a855f7 (purple) → #f97316 (orange) → new #ef4444 (red)
    function timeColor(frac) {
      // 4-stop gradient: blue → purple → orange → red
      const stops = [
        [59,  130, 246],   // blue    (oldest)
        [168,  85, 247],   // purple
        [249, 115,  22],   // orange
        [239,  68,  68],   // red     (newest)
      ];
      const t    = frac * (stops.length - 1);
      const lo   = Math.floor(t);
      const hi   = Math.min(lo + 1, stops.length - 1);
      const mix  = t - lo;
      const r    = Math.round(stops[lo][0] + (stops[hi][0] - stops[lo][0]) * mix);
      const g    = Math.round(stops[lo][1] + (stops[hi][1] - stops[lo][1]) * mix);
      const b    = Math.round(stops[lo][2] + (stops[hi][2] - stops[lo][2]) * mix);
      return [r, g, b];
    }

    // Draw segments
    for (let i = 0; i < n - 1; i++) {
      const frac  = i / Math.max(n - 1, 1);
      const [r, g, b] = timeColor(frac);
      const alpha = 0.3 + 0.7 * frac; // older segments more transparent

      ctx3d.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
      ctx3d.lineWidth   = 1.5;
      ctx3d.lineJoin    = 'round';
      ctx3d.lineCap     = 'round';
      ctx3d.beginPath();
      ctx3d.moveTo(projected[i].sx,     projected[i].sy);
      ctx3d.lineTo(projected[i + 1].sx, projected[i + 1].sy);
      ctx3d.stroke();
    }

    // Start dot (oldest)
    if (n >= 1) {
      const [r, g, b] = timeColor(0);
      ctx3d.fillStyle = `rgba(${r},${g},${b},0.9)`;
      ctx3d.beginPath();
      ctx3d.arc(projected[0].sx, projected[0].sy, 4, 0, Math.PI * 2);
      ctx3d.fill();
    }

    // End dot — white when live, accent color when scrubbing
    if (n >= 1) {
      const last = projected[n - 1];
      const isLive = scrubIndex === null && hasData;
      ctx3d.fillStyle   = isLive ? '#ffffffdd' : '#6366f1cc';
      ctx3d.strokeStyle = isLive ? '#ffffff'   : '#6366f1';
      ctx3d.lineWidth   = 1.5;
      ctx3d.beginPath();
      ctx3d.arc(last.sx, last.sy, isLive ? 5 : 4, 0, Math.PI * 2);
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

  // ── Button & selector wiring ──────────────────
  btnStart.addEventListener('click', startCapture);
  btnStop.addEventListener('click',  stopCapture);
  btnClear.addEventListener('click', clearData);

  // Sensor source selector
  selSensor.value = sensorMode;
  selSensor.addEventListener('change', () => {
    sensorMode = selSensor.value;
    updateChartTitle();
    // Clear data when switching — old values are on a different scale/unit
    clearData();
  });

  function updateChartTitle() {
    const meta = SENSOR_META[sensorMode];
    const el   = document.getElementById('chart-time-title');
    if (el) el.textContent = `Time Series — ${meta.label} (${meta.unit})`;
  }

  // Populate and wire sample-rate selector
  SAMPLE_RATES.forEach((rate) => {
    const opt = document.createElement('option');
    opt.value       = rate.ms;
    opt.textContent = rate.label;
    if (rate.ms === sampleIntervalMs) opt.selected = true;
    selRate.appendChild(opt);
  });
  selRate.addEventListener('change', () => {
    sampleIntervalMs = parseInt(selRate.value, 10);
  });

  function updateScrubberLabel() {
    if (scrubIndex !== null && points3d[scrubIndex]) {
      const t = points3d[scrubIndex][3]; // stored timestamp
      scrubberTime.textContent = t !== undefined ? t.toFixed(1) + 's' : scrubIndex;
    }
  }

  scrubber.addEventListener('input', () => {
    scrubIndex = parseInt(scrubber.value, 10);
    updateScrubberLabel();
    draw3D();
  });
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
