# 🌀 Gyroscope Visualizer

A real-time mobile sensor visualizer that runs entirely in the browser — no app install required. Point your phone at it and see your gyroscope, accelerometer, and orientation data come alive.

**[→ Open the app](https://gyroscope-visualizer.pages.dev)**

---

## Features

- **Three sensor modes** — Gyroscope (rad/s), Accelerometer (m/s²), Orientation (degrees)
- **Time-series chart** — All 3 axes plotted with individual colors, scrollable through the full session history
- **3D trajectory chart** — Live path through 3D space, color-coded by time (blue → red), drag to rotate, pinch to zoom
- **Adjustable sampling rate** — From 60 Hz down to 1 Hz
- **CSV export** — Download your full session as a spreadsheet-ready file
- **Works on iOS and Android** — Safari, Chrome, Firefox
- **No install, no backend, no dependencies** — Pure HTML + JS, ~1000 lines

---

## How it works

```
Phone sensors
     │
     ▼  DeviceMotionEvent / DeviceOrientationEvent (Web API)
Browser
     │
     ▼  Canvas 2D rendering
Time-series chart + 3D trajectory
```

The browser exposes raw sensor data via the [Device Motion API](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent) and [Device Orientation API](https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent). This app reads those events, throttles them to the selected sample rate, and renders both charts using the Canvas 2D API — no WebGL, no libraries.

### Sensor modes explained

| Mode | API | Unit | Still phone reads |
|---|---|---|---|
| **Gyroscope** | `DeviceMotion.rotationRate` | rad/s | ≈ 0 on all axes |
| **Accelerometer** | `DeviceMotion.acceleration` | m/s² | ≈ 0 (gravity removed) |
| **Orientation** | `DeviceOrientationEvent` | degrees | Stable non-zero angles |

---

## Usage

### On your phone
1. Open the URL in Safari (iOS) or Chrome (Android)
2. Select sensor mode and sampling rate
3. Press **Start** — grant permission if prompted (iOS only)
4. Move your phone and watch the charts update live
5. Press **Stop**, then scrub through the 3D trajectory with the time slider
6. Press **⬇ CSV** to export your session data

### Self-hosting

No build step — it's just two files.

```bash
git clone https://github.com/ycrbt/gyroscope-visualizer
cd gyroscope-visualizer
npx serve .
```

Then open the HTTPS URL on your phone. For local network testing:

```bash
# Install ngrok once
brew install ngrok/ngrok/ngrok
ngrok http 3000
# Open the https://xxxx.ngrok.io URL on your phone
```

> **Note:** Mobile browsers require HTTPS for sensor access. `localhost` works on desktop but not for remote devices.

---

## iOS Permission

iOS 13+ requires an explicit user gesture to grant motion sensor access. The app handles this automatically — a permission prompt appears the first time you press Start. After granting, it's remembered for the session.

If you previously denied permission: **Settings → Safari → Motion & Orientation Access → ON**

---

## CSV Format

```csv
# Gyroscope Visualizer — Gyroscope export
# Captured: 2026-09-10T20:00:00.000Z
# Unit: rad/s
time_s,α_(yaw)_rad/s,β_(pitch)_rad/s,γ_(roll)_rad/s
0.0500,0.012345,-0.003210,0.001100
0.1000,0.015230,-0.002980,0.000890
```

---

## Browser compatibility

| Browser | iOS | Android |
|---|---|---|
| Safari | ✅ | — |
| Chrome | ✅ (WebKit) | ✅ |
| Firefox | ✅ | ✅ |

---

## Tech stack

- Vanilla JS (ES6, IIFE, no framework)
- Canvas 2D API
- DeviceMotion / DeviceOrientation Web APIs
- Deployed on Cloudflare Pages

---

## License

MIT
