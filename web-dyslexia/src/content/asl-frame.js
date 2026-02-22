/**
 * ASL Frame — runs inside the extension iframe.
 * Gets webcam access, runs MediaPipe Hands detection,
 * performs local MLP inference,
 * and posts predictions to the parent page (content script).
 *
 * All MediaPipe files are bundled locally in lib/mediapipe/
 * to avoid CSP restrictions on external scripts.
 */
"use strict";

const RECORDABLE_LABELS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
  'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T',
  'U', 'V', 'W', 'X', 'Y', 'Z', 'SPACE', 'BKSP'
];

const MODEL_URL = getRuntimeUrl('models/asl_mlp_weights.json');

let currentLabel = "A";
let recordMode = true;
let samples = [];
let lastLandmarks = null;
let lastHandedness = 'Unknown';
let mirrorLeftToRight = true;

let modelReady = false;
let modelLabels = [];
let modelLayers = [];

// HUD refs
const hud = {
  recordToggle: null,
  mirrorToggle: null,
  label: null,
  count: null,
  status: null,
  model: null,
};

function setupHud() {
  hud.recordToggle = document.getElementById('record-toggle');
  hud.mirrorToggle = document.getElementById('mirror-toggle');
  hud.label = document.getElementById('hud-label');
  hud.count = document.getElementById('hud-count');
  hud.status = document.getElementById('hud-status');
  hud.model = document.getElementById('hud-model');

  hud.recordToggle?.addEventListener('click', () => {
    recordMode = !recordMode;
    updateHudRecordState();
    focusFrame();
  });

  hud.mirrorToggle?.addEventListener('click', () => {
    mirrorLeftToRight = !mirrorLeftToRight;
    updateHudMirrorState();
    setHudStatus(mirrorLeftToRight ? 'Mirror LEFT enabled' : 'Mirror LEFT disabled');
    focusFrame();
  });

  updateHudLabel();
  updateHudCount();
  updateHudRecordState();
  updateHudMirrorState();
  setHudStatus('No hand');
}

function focusFrame() {
  try {
    window.focus();
    document.body?.focus({ preventScroll: true });
  } catch {
    // best-effort
  }
}

function updateHudRecordState() {
  if (!hud.recordToggle) return;
  hud.recordToggle.textContent = recordMode ? 'Record: ON' : 'Record: OFF';
  hud.recordToggle.classList.toggle('active', recordMode);
}

function updateHudLabel() {
  if (!hud.label) return;
  if (currentLabel === 'J' || currentLabel === 'Z') {
    hud.label.textContent = `Label: ${currentLabel} (motion)`;
  } else {
    hud.label.textContent = `Label: ${currentLabel}`;
  }
}

function updateHudMirrorState() {
  if (!hud.mirrorToggle) return;
  hud.mirrorToggle.textContent = mirrorLeftToRight ? 'Mirror L: ON' : 'Mirror L: OFF';
  hud.mirrorToggle.classList.toggle('active', mirrorLeftToRight);
}

function updateHudCount() {
  if (hud.count) hud.count.textContent = `Samples: ${samples.length}`;
}

function setHudStatus(text) {
  if (hud.status) hud.status.textContent = text;
}

function setHudModelStatus(text) {
  if (hud.model) hud.model.textContent = text;
}

function getRuntimeUrl(path) {
  try {
    if (typeof browser !== 'undefined' && browser.runtime?.getURL) {
      return browser.runtime.getURL(path);
    }
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      return chrome.runtime.getURL(path);
    }
  } catch {
    // best-effort fallback below
  }
  return new URL(`../${path.replace(/^\/+/, '')}`, location.href).href;
}

function validateModelPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (!Array.isArray(payload.labels) || !Array.isArray(payload.layers)) return false;
  if (payload.labels.length === 0) return false;
  if (!Number.isInteger(payload.input_size) || payload.input_size !== 63) return false;
  if (payload.layers.length === 0) return false;

  let expectedIn = 63;
  for (const layer of payload.layers) {
    if (!layer || typeof layer !== 'object') return false;
    if (!Array.isArray(layer.weights) || !Array.isArray(layer.biases)) return false;
    if (!Number.isInteger(layer.input_size) || !Number.isInteger(layer.output_size)) return false;
    if (layer.input_size !== expectedIn) return false;
    if (layer.weights.length !== layer.input_size) return false;
    if (layer.biases.length !== layer.output_size) return false;
    for (const row of layer.weights) {
      if (!Array.isArray(row) || row.length !== layer.output_size) return false;
      if (!row.every(Number.isFinite)) return false;
    }
    if (!layer.biases.every(Number.isFinite)) return false;
    expectedIn = layer.output_size;
  }

  return expectedIn === payload.labels.length;
}

async function loadMLPModel() {
  try {
    const res = await fetch(MODEL_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    if (!validateModelPayload(payload)) {
      throw new Error('Invalid model schema');
    }

    modelLabels = payload.labels.map(v => String(v).toUpperCase());
    modelLayers = payload.layers.map((layer) => ({
      inputSize: Number(layer.input_size),
      outputSize: Number(layer.output_size),
      activation: String(layer.activation || 'linear').toLowerCase(),
      weights: layer.weights.map(row => row.map(Number)),
      biases: layer.biases.map(Number),
    }));
    modelReady = true;
    setHudModelStatus(`Model: ready (${modelLabels.length})`);
  } catch (err) {
    modelReady = false;
    modelLabels = [];
    modelLayers = [];
    setHudModelStatus('Model: missing (landmark fallback)');
    console.warn('[ASL Frame] Could not load local model:', err);
  }
}

function softmax(logits) {
  const max = Math.max(...logits);
  const exps = logits.map(v => Math.exp(v - max));
  const sum = exps.reduce((acc, v) => acc + v, 0) || 1;
  return exps.map(v => v / sum);
}

function denseForward(input, weights, biases) {
  const out = new Array(biases.length);
  for (let j = 0; j < biases.length; j++) {
    let sum = biases[j];
    for (let i = 0; i < input.length; i++) {
      sum += input[i] * weights[i][j];
    }
    out[j] = sum;
  }
  return out;
}

function applyActivation(values, activation) {
  if (activation === 'relu') {
    return values.map(v => (v > 0 ? v : 0));
  }
  return values;
}

function predictFromModel(x63) {
  if (!modelReady || modelLabels.length === 0) {
    return { letter: null, confidence: 0 };
  }

  let activations = x63;
  for (const layer of modelLayers) {
    const z = denseForward(activations, layer.weights, layer.biases);
    activations = applyActivation(z, layer.activation);
  }

  const probs = softmax(activations);

  let bestIdx = 0;
  for (let i = 1; i < probs.length; i++) {
    if (probs[i] > probs[bestIdx]) bestIdx = i;
  }

  return {
    letter: modelLabels[bestIdx] || null,
    confidence: probs[bestIdx] || 0,
  };
}

(async function () {
  const video = document.getElementById('cam');
  setupHud();
  await loadMLPModel();

  // Improve hotkey reliability inside iframe
  focusFrame();
  setTimeout(focusFrame, 150);
  document.addEventListener('pointerdown', focusFrame);

  // Resolve the extension base URL for locateFile
  // asl-frame.html is at content/asl-frame.html, inside chrome-extension:// context
  // MediaPipe files are at lib/mediapipe/
  const frameUrl = location.href; // chrome-extension://<id>/content/asl-frame.html
  const contentDir = frameUrl.substring(0, frameUrl.lastIndexOf('/'));
  const mpBase = contentDir.replace('/content', '/lib/mediapipe/');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 240, facingMode: 'user' }
    });
    video.srcObject = stream;
    await video.play();
    setHudStatus('Camera ready');

    /* global Hands, Camera */
    if (typeof Hands === 'undefined') {
      console.error('[ASL Frame] Hands class not found! MediaPipe scripts may not have loaded.');
      setHudStatus('MediaPipe missing');
      return;
    }

    const hands = new Hands({
      locateFile: function (f) {
        return mpBase + f;
      }
    });
    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 0,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.4
    });

    hands.onResults(function (results) {
      const lms = results.multiHandLandmarks || [];
      if (lms.length > 0) {
        lastLandmarks = lms[0];
        lastHandedness = results.multiHandedness?.[0]?.label || 'Unknown';
      } else {
        lastLandmarks = null;
        lastHandedness = 'Unknown';
      }

      window.parent.postMessage({
        type: 'screenshield-asl-landmarks',
        landmarks: lms,
        handedness: lastHandedness,
        ts: Date.now(),
      }, '*');

      if (!lastLandmarks) {
        setHudStatus('No hand');
        window.parent.postMessage({
          type: 'screenshield-asl-prediction',
          letter: null,
          confidence: 0,
          modelReady,
          handedness: lastHandedness,
          ts: Date.now(),
        }, '*');
        return;
      }

      const x63 = normalizeAndFlatten(lastLandmarks, {
        mirrorX: mirrorLeftToRight && lastHandedness === 'Left'
      });

      const raw = predictFromModel(x63);

      if (raw.letter) {
        setHudStatus(`Pred ${raw.letter} ${Math.round(raw.confidence * 100)}%`);
      } else {
        setHudStatus(modelReady ? 'Hand detected' : 'Hand detected (fallback)');
      }

      window.parent.postMessage({
        type: 'screenshield-asl-prediction',
        letter: raw.letter,
        confidence: Number(raw.confidence.toFixed(4)),
        modelReady,
        handedness: lastHandedness,
        ts: Date.now(),
      }, '*');
    });

    var cam = new Camera(video, {
      onFrame: async function () {
        await hands.send({ image: video });
      },
      width: 320,
      height: 240
    });
    cam.start();
    setHudStatus('Tracking started');
  } catch (err) {
    setHudStatus('Camera error');
    console.error('[ASL Frame] Failed:', err);
  }
})();

function normalizeAndFlatten(lm, options = {}) {
  const mirrorX = !!options.mirrorX;
  // lm: array of 21 landmarks {x,y,z}
  // 1) translate so wrist (0) is origin
  const wx = lm[0].x, wy = lm[0].y, wz = lm[0].z;

  // 2) scale by palm size: distance wrist(0) -> middle MCP(9)
  const dx = lm[9].x - wx;
  const dy = lm[9].y - wy;
  const dz = lm[9].z - wz;
  const scale = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1.0;

  // 3) flatten into 63 floats
  const out = [];
  for (let i = 0; i < 21; i++) {
    let x = (lm[i].x - wx) / scale;
    if (mirrorX) x = -x;
    out.push(x);
    out.push((lm[i].y - wy) / scale);
    out.push((lm[i].z - wz) / scale);
  }
  return out;
}

window.addEventListener("keydown", (e) => {
  // Download dataset: Ctrl+S
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    downloadDataset();
    return;
  }

  // Clear dataset: Ctrl+C
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'c') {
    e.preventDefault();
    samples = [];
    updateHudCount();
    setHudStatus('Samples cleared');
    return;
  }

  // Toggle record mode: 1
  if (!e.ctrlKey && !e.shiftKey && !e.altKey && e.key === '1') {
    recordMode = !recordMode;
    updateHudRecordState();
    setHudStatus(recordMode ? 'Record ON' : 'Record OFF');
    return;
  }

  // Toggle mirroring for left hand normalization: 2
  if (!e.ctrlKey && !e.shiftKey && !e.altKey && e.key === '2') {
    mirrorLeftToRight = !mirrorLeftToRight;
    updateHudMirrorState();
    setHudStatus(mirrorLeftToRight ? 'Mirror LEFT enabled' : 'Mirror LEFT disabled');
    return;
  }

  // change label: press A-Z
  const k = e.key.toUpperCase();
  if (k.length === 1 && RECORDABLE_LABELS.includes(k)) {
    currentLabel = k;
    updateHudLabel();
    setHudStatus(`Label set: ${currentLabel}`);
    return;
  }

  // Set label to SPACE or BKSP
  if (e.code === "Space") {
    e.preventDefault();
    currentLabel = "SPACE";
    updateHudLabel();
    setHudStatus(`Label set: SPACE`);
    return;
  }
  if (e.code === "Backspace") {
    e.preventDefault();
    currentLabel = "BKSP";
    updateHudLabel();
    setHudStatus(`Label set: BKSP`);
    return;
  }

  // capture sample: Enter
  if (e.code === "Enter") {
    e.preventDefault();
    if (!recordMode) {
      setHudStatus('Record mode OFF');
      return;
    }
    if (!lastLandmarks) {
      setHudStatus('No hand to capture');
      return;
    }
    const x = normalizeAndFlatten(lastLandmarks, {
      mirrorX: mirrorLeftToRight && lastHandedness === 'Left'
    });
    samples.push({
      label: currentLabel,
      x,
      t: Date.now(),
    });
    updateHudCount();
    setHudStatus(`Captured ${currentLabel} (${samples.length})`);
    return;
  }
});

function downloadDataset() {
  const blob = new Blob([JSON.stringify(samples, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "asl_dataset.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setHudStatus(`Downloaded ${samples.length} samples`);
}
