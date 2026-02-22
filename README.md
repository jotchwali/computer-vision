# Jutsu

Real-time hand gesture recognition that triggers sounds and visual effects, powered by MediaPipe and running entirely in the browser.

Built with Next.js (App Router), MediaPipe Hands, and the Web Audio API. Runs entirely client-side — no backend processing required.

## Gestures

| Gesture          | Action                        |
| ---------------- | ----------------------------- |
| **Open palm**    | Play ambient sound (loops)    |
| **Closed fist**  | Stop all sounds               |
| **Index finger up** | Trigger particle burst + sparkle sound |
| **Thumbs up**    | Play chime sound effect       |

## How Detection Works

1. **MediaPipe HandLandmarker** (via `@mediapipe/tasks-vision`) runs on each video frame using `requestAnimationFrame`, producing 21 3D landmarks per detected hand.
2. **GestureDetector** uses simple geometric heuristics — comparing fingertip-to-wrist distances against MCP-to-wrist distances to determine which fingers are extended.
3. **GestureCooldown** suppresses duplicate triggers with a 600ms cooldown window, so holding a gesture doesn't spam actions.
4. The **Camera** component ties it all together: draws landmarks on a canvas overlay, dispatches gestures to the AudioManager, and spawns particle effects.

No custom ML models or training are used — just landmark distance comparisons.

## Project Structure

```
app/
  layout.tsx          # Root layout (dark theme, metadata)
  page.tsx            # Entry point — renders Camera
  globals.css         # Global styles + animations
components/
  Camera.tsx          # Main UI: webcam, canvas overlays, controls
  HandTracker.ts      # MediaPipe HandLandmarker wrapper + rAF loop
  GestureDetector.ts  # Pure gesture detection from landmarks
  AudioManager.ts     # Web Audio API manager (preload, play, stop)
public/
  sounds/
    ambient.wav       # Looping ambient pad
    thumbsup.wav      # Chime one-shot
    sparkle.wav       # Sparkle one-shot
```

## Running Locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and click **Start Camera**. Grant webcam permission when prompted.

### Requirements

- A modern browser with WebGL/WebGPU support (Chrome, Edge, Firefox)
- A working webcam
- Node.js 18+

## Deployment

The app deploys to Vercel with zero configuration:

```bash
npx vercel
```

All features are client-side only. No environment variables or server-side APIs are needed.

## Tech Stack

- **Next.js 16** (App Router)
- **MediaPipe Tasks Vision** — hand landmark detection (WASM + GPU)
- **Web Audio API** — sound playback with preloading and volume control
- **Tailwind CSS 4** — styling
- **TypeScript** — throughout
