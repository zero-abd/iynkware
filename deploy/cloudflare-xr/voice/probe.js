// Temporary microphone diagnostic for issue #196 (Quest Browser delivers silent mic samples). See probe.html.
// No XR app, no tokens, no AudioWorklet, no Gemini: getUserMedia -> AnalyserNode -> numbers on screen. Audio is
// never recorded, uploaded, persisted, or logged. Delete with probe.html before PR #197 leaves draft.
const el = id => document.getElementById(id);
const stamp = () => new Date().toISOString().slice(11, 19);
function log(line) {
  const row = document.createElement('div');
  row.textContent = `${stamp()} ${line}`;
  el('log').prepend(row);
}

let stream, audio, analyser, raf;
let maxPeak = 0;
let arStats = null;

function describeTrack() {
  const track = stream?.getAudioTracks()[0];
  if (!track) { el('track').textContent = 'track: none'; return; }
  const s = track.getSettings?.() || {};
  el('track').textContent =
    `track: ${track.label || '(no label)'}\n` +
    `enabled=${track.enabled} muted=${track.muted} readyState=${track.readyState}\n` +
    `sampleRate=${s.sampleRate ?? '?'} channelCount=${s.channelCount ?? '?'} ` +
    `echoCancellation=${s.echoCancellation ?? '?'} noiseSuppression=${s.noiseSuppression ?? '?'} autoGainControl=${s.autoGainControl ?? '?'}`;
}

async function listDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter(d => d.kind === 'audioinput');
    el('devices').textContent = `devices: ${inputs.length} audio input(s)\n` +
      inputs.map((d, i) => `${i + 1}. ${d.label || '(label hidden)'}`).join('\n');
  } catch (error) { el('devices').textContent = `devices: enumerate failed (${error.name})`; }
}

function meter() {
  const data = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(data);
  let peak = 0, sum = 0;
  for (let i = 0; i < data.length; i++) { const v = Math.abs(data[i]); if (v > peak) peak = v; sum += data[i] * data[i]; }
  const rms = Math.sqrt(sum / data.length);
  maxPeak = Math.max(maxPeak, peak);
  if (arStats) { arStats.peak = Math.max(arStats.peak, peak); arStats.rms = Math.max(arStats.rms, rms); }
  el('bar').style.width = `${Math.min(100, peak * 300)}%`;
  el('numbers').textContent = `peak ${peak.toFixed(3)} · rms ${rms.toFixed(3)} · max ${maxPeak.toFixed(3)}`;
  raf = requestAnimationFrame(meter);
}

async function start(raw) {
  await stop();
  maxPeak = 0;
  const constraints = raw
    ? { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 1 } }, video: false }
    : { audio: true, video: false };
  log(`getUserMedia(${raw ? 'processing off' : 'audio: true'})…`);
  try { stream = await navigator.mediaDevices.getUserMedia(constraints); }
  catch (error) { log(`getUserMedia FAILED: ${error.name}: ${error.message}`); return; }
  log('getUserMedia ok');
  const track = stream.getAudioTracks()[0];
  for (const type of ['mute', 'unmute', 'ended']) {
    track?.addEventListener(type, () => { log(`track event: ${type}`); describeTrack(); });
  }
  describeTrack();
  void listDevices();
  audio = new AudioContext();
  await audio.resume().catch(() => {});
  log(`AudioContext ${audio.state} at ${audio.sampleRate} Hz`);
  analyser = audio.createAnalyser();
  analyser.fftSize = 2048;
  audio.createMediaStreamSource(stream).connect(analyser);
  meter();
  el('stop').disabled = false;
  el('ar').disabled = !navigator.xr;
}

async function stop() {
  cancelAnimationFrame(raf); raf = undefined;
  stream?.getTracks().forEach(track => track.stop()); stream = null;
  await audio?.close().catch(() => {}); audio = null; analyser = null;
  el('stop').disabled = true; el('ar').disabled = true;
}

async function testAr() {
  if (!navigator.xr || !stream) return;
  el('ar').disabled = true;
  log('requesting immersive-ar session (10 s)…');
  try {
    const session = await navigator.xr.requestSession('immersive-ar');
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl', { xrCompatible: true });
    await session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
    const keepAlive = () => session.requestAnimationFrame(keepAlive);
    session.requestAnimationFrame(keepAlive);
    arStats = { peak: 0, rms: 0 };
    describeTrack();
    session.addEventListener('end', () => {
      const stats = arStats; arStats = null;
      log(`AR session ended. During AR: peak ${stats.peak.toFixed(3)}, rms ${stats.rms.toFixed(3)}`);
      describeTrack();
      el('ar').disabled = !stream;
    });
    setTimeout(() => session.end().catch(() => {}), 10000);
  } catch (error) {
    log(`AR session failed: ${error.name}: ${error.message}`);
    arStats = null; el('ar').disabled = !stream;
  }
}

el('start').addEventListener('click', () => void start(false));
el('start-raw').addEventListener('click', () => void start(true));
el('ar').addEventListener('click', () => void testAr());
el('stop').addEventListener('click', () => void stop());
window.addEventListener('pagehide', () => void stop(), { once: true });
