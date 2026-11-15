import {
  CONSENT_VERSION as POLICY_VERSION,
  GEMINI_MODEL as MODEL,
  TOOLS_VERSION,
} from './policy.mjs';
import { controllerTalkPressed, runtimeBridge } from './client-core.mjs';

const SOCKET = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/voice/live`;
const DEVICE_KEY = 'iynkware:voice-device:v2';
const VOICE_BUILD = 'voice-ptt-en-v11';
const COPY = {
  en: ['Gemini voice guide','Adult hackathon prototype. While you hold Talk, microphone audio goes directly to Google Gemini. iynkware does not intentionally store audio, transcripts, or conversation history.','I am 18 or older and agree to send microphone audio to Google for this demo.','Enable voice','Disable voice','Hold to talk','Voice is off.','Voice ready. Hold the right thumbstick click in MR or hold the button below.','Connecting…','Listening… release when finished.','Gemini is answering…','Voice failed. Release and try again.','Daily demo limit reached.'],
  de: ['Gemini-Sprachhilfe','Hackathon-Prototyp nur für Erwachsene. Beim Halten von Sprechen wird Mikrofon-Audio direkt an Google Gemini gesendet. iynkware speichert es nicht absichtlich.','Ich bin mindestens 18 Jahre alt und stimme dem Senden meines Mikrofon-Audios an Google zu.','Sprache aktivieren','Sprache deaktivieren','Zum Sprechen halten','Sprache ist aus.','Sprache bereit. In MR B oder die Taste unten halten.','Verbindung…','Hört zu… danach loslassen.','Gemini antwortet…','Sprachfehler. Erneut versuchen.','Tageslimit erreicht.'],
  es: ['Guía de voz Gemini','Prototipo solo para adultos. Al mantener Hablar, el audio va directamente a Google Gemini. iynkware no lo almacena intencionalmente.','Tengo al menos 18 años y acepto enviar mi audio a Google.','Activar voz','Desactivar voz','Mantén para hablar','La voz está apagada.','Voz lista. Mantén B en MR o el botón inferior.','Conectando…','Escuchando… suelta al terminar.','Gemini está respondiendo…','Error de voz. Inténtalo de nuevo.','Límite diario alcanzado.'],
  fr: ['Guide vocal Gemini','Prototype réservé aux adultes. En maintenant Parler, le son va directement à Google Gemini. iynkware ne le stocke pas volontairement.','J’ai au moins 18 ans et j’accepte d’envoyer mon son à Google.','Activer la voix','Désactiver la voix','Maintenir pour parler','La voix est désactivée.','Voix prête. Maintenez B en MR ou le bouton ci-dessous.','Connexion…','Écoute… relâchez après la question.','Gemini répond…','Échec vocal. Réessayez.','Limite quotidienne atteinte.'],
  hi: ['Gemini वॉइस गाइड','केवल वयस्कों के लिए प्रोटोटाइप। दबाने पर ऑडियो सीधे Google Gemini को जाता है। iynkware इसे जानबूझकर संग्रहीत नहीं करता।','मेरी आयु 18 वर्ष या अधिक है और मैं ऑडियो भेजने की सहमति देता/देती हूँ।','वॉइस चालू करें','वॉइस बंद करें','बोलने के लिए दबाएँ','वॉइस बंद है।','वॉइस तैयार। MR में B या नीचे का बटन दबाएँ।','जुड़ रहा है…','सुन रहा है… पूरा होने पर छोड़ें।','Gemini उत्तर दे रहा है…','वॉइस विफल। फिर प्रयास करें।','दैनिक सीमा पूरी हुई।'],
  zh: ['Gemini 语音向导','仅限成人的原型。按住说话时，音频会直接发送给 Google Gemini。iynkware 不会有意存储。','我已年满 18 岁，并同意将麦克风音频发送给 Google。','启用语音','停用语音','按住说话','语音已关闭。','语音就绪。在 MR 中按住 B 或下方按钮。','正在连接…','正在聆听…说完后松开。','Gemini 正在回答…','语音失败。请重试。','已达到每日上限。'],
};
const language = (document.documentElement.lang || navigator.language || 'en').slice(0,2).toLowerCase();
const c = COPY[language] || COPY.en;
const [title, disclosure, consentText, enableText, disableText, talkText, idle, ready, connecting, listening, speaking, failed, quota] = c;
const micBlocked = ({
  en: 'Microphone access is blocked. Allow Microphone in this site’s Quest Browser permissions, reload, then enable voice again.',
  de: 'Der Mikrofonzugriff ist blockiert. Erlaube das Mikrofon in den Website-Berechtigungen des Quest Browsers und lade neu.',
  es: 'El acceso al micrófono está bloqueado. Permite el micrófono en los permisos del sitio de Quest Browser y recarga.',
  fr: 'L’accès au microphone est bloqué. Autorisez-le dans les permissions du site de Quest Browser, puis rechargez.',
  hi: 'माइक्रोफ़ोन अनुमति अवरुद्ध है। Quest Browser की साइट अनुमतियों में माइक्रोफ़ोन चालू करके पेज फिर लोड करें।',
  zh: '麦克风权限被阻止。请在 Quest Browser 的网站权限中允许麦克风，然后重新加载。',
})[language] || 'Microphone access is blocked. Allow it in Quest Browser site permissions and reload.';
const stages = ({
  en: ['Waiting for microphone permission…', 'Starting voice audio…'],
  de: ['Warte auf Mikrofonberechtigung…', 'Sprachaudio wird gestartet…'],
  es: ['Esperando permiso del micrófono…', 'Iniciando audio de voz…'],
  fr: ['En attente de l’autorisation du microphone…', 'Démarrage de l’audio vocal…'],
  hi: ['माइक्रोफ़ोन अनुमति की प्रतीक्षा…', 'वॉइस ऑडियो शुरू हो रहा है…'],
  zh: ['正在等待麦克风权限…', '正在启动语音音频…'],
})[language] || ['Waiting for microphone permission…', 'Starting voice audio…'];
const root = window.iynkware || (window.iynkware = {});
const bridge = runtimeBridge(root);
let media, audio, socket, node, source, sink, connectTimer, responseTimer, completionTimer, zeroTimer;
let active = false, released = false, setupReady = false, activityStarted = false, endSent = false, controllerDown = false, playbackAt = 0;
let capRetried = false, trackNote = '';
let playback = [];
let pendingAudio = [];
let preRoll = [];
let audioChunks = 0, speechPeak = 0;

const panel = document.createElement('aside');
panel.id = 'voice-demo';
panel.innerHTML = `<style>#voice-demo{position:fixed;z-index:30;right:16px;top:16px;box-sizing:border-box;width:min(390px,calc(100vw - 32px));padding:16px;border:3px solid #231e16;border-radius:16px;background:#f2efe7;color:#231e16;box-shadow:6px 6px 0 #41538f;font:16px/1.35 system-ui,sans-serif}#voice-demo h2{margin:0 0 8px;font-size:22px}#voice-demo p{margin:8px 0}#voice-demo small{opacity:.65}#voice-demo label{display:flex;gap:10px;align-items:flex-start;font-weight:600}#voice-demo input{width:22px;height:22px;flex:none}#voice-demo button{min-height:48px;margin:10px 8px 0 0;padding:8px 18px;border:3px solid #231e16;border-radius:12px;background:#e4694e;color:#231e16;font:600 18px system-ui,sans-serif;touch-action:none}#voice-demo button.secondary{background:#f2efe7}#voice-demo button:disabled{opacity:.45}#voice-status{font-weight:650}</style><h2>${title}</h2><p><small>${VOICE_BUILD}</small></p><p>${disclosure}</p><label><input id="voice-consent" type="checkbox"><span>${consentText}</span></label><button id="voice-enable" disabled>${enableText}</button><button id="voice-disable" class="secondary" disabled>${disableText}</button><button id="voice-talk" disabled>${talkText}</button><p id="voice-status" role="status" aria-live="polite">${idle}</p>`;
document.body.append(panel);
const ui = Object.fromEntries(['consent','enable','disable','talk','status'].map(k => [k, panel.querySelector(`#voice-${k}`)]));

function deviceId() {
  let value = localStorage.getItem(DEVICE_KEY);
  if (!value) { value = crypto.randomUUID(); localStorage.setItem(DEVICE_KEY, value); }
  return value;
}
function base64(buffer) {
  const bytes = new Uint8Array(buffer); let value = '';
  for (let i = 0; i < bytes.length; i += 0x4000) value += String.fromCharCode(...bytes.subarray(i, i + 0x4000));
  return btoa(value);
}
function clearPlayback() {
  playback.forEach(item => { try { item.stop(); } catch {} });
  playback = []; playbackAt = audio?.currentTime || 0;
}
function play(encoded) {
  if (!audio) return;
  const raw = atob(encoded), samples = new Float32Array(Math.floor(raw.length / 2));
  for (let i = 0; i < samples.length; i++) { const n = raw.charCodeAt(i*2) | (raw.charCodeAt(i*2+1)<<8); samples[i] = (n >= 0x8000 ? n - 0x10000 : n) / 0x8000; }
  const buffer = audio.createBuffer(1, samples.length, 24000); buffer.copyToChannel(samples, 0);
  const item = audio.createBufferSource(); item.buffer = buffer; item.connect(audio.destination);
  const at = Math.max(audio.currentTime + .02, playbackAt); playbackAt = at + buffer.duration; playback.push(item);
  item.addEventListener('ended', () => { playback = playback.filter(x => x !== item); }, {once:true}); item.start(at);
}
function closeTurn() {
  clearTimeout(zeroTimer); zeroTimer = undefined;
  clearTimeout(connectTimer); connectTimer = undefined;
  clearTimeout(responseTimer); responseTimer = undefined;
  clearTimeout(completionTimer); completionTimer = undefined;
  node?.disconnect(); source?.disconnect(); sink?.disconnect(); node = source = sink = null;
  pendingAudio = []; setupReady = false; endSent = false;
  const current = socket; socket = null;
  if (current && current.readyState < WebSocket.CLOSING) current.close(1000, 'turn complete');
}
function failTurn(message = failed) {
  active = false; clearPlayback(); closeTurn(); ui.talk.disabled = !media; ui.status.textContent = message; bridge.state('idle');
}
function sendAudio(buffer) {
  if (socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({realtimeInput:{audio:{data:base64(buffer),mimeType:'audio/pcm;rate=16000'}}}));
}
function peakOf(buffer) {
  const samples = new Int16Array(buffer); let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  return peak;
}
function routeAudio(buffer) {
  const peak = peakOf(buffer); speechPeak = Math.max(speechPeak, peak);
  if (!activityStarted) {
    preRoll.push(buffer); if (preRoll.length > 10) preRoll.shift();
    if (peak < 500) return;
    activityStarted = true;
    socket.send(JSON.stringify({realtimeInput:{activityStart:{}}}));
    for (const chunk of preRoll) sendAudio(chunk);
    preRoll = [];
    return;
  }
  sendAudio(buffer);
}
function startCapture() {
  source = audio.createMediaStreamSource(media);
  node = new AudioWorkletNode(audio, 'iynkware-voice-input', {numberOfInputs:1, numberOfOutputs:1, outputChannelCount:[1]});
  sink = audio.createGain(); sink.gain.value = 0;
  node.port.onmessage = event => {
    audioChunks += 1;
    const peak = peakOf(event.data); if (peak > speechPeak) speechPeak = peak;
    if (setupReady && socket?.readyState === WebSocket.OPEN) routeAudio(event.data);
    else if (pendingAudio.length < 150) pendingAudio.push(event.data);
  };
  source.connect(node); node.connect(sink); sink.connect(audio.destination);
}
function sendEnd() {
  if (!setupReady || endSent || socket?.readyState !== WebSocket.OPEN) return;
  if (!activityStarted) {
    failTurn(`No speech was detected (level ${speechPeak}, chunks ${audioChunks}, mic ${trackNote || 'unknown'}). Open /voice/probe.html on this headset to test the microphone alone.`);
    return;
  }
  endSent = true;
  node?.disconnect(); source?.disconnect(); sink?.disconnect(); node = source = sink = null;
  socket.send(JSON.stringify({realtimeInput:{activityEnd:{}}}));
  ui.status.textContent = speaking; bridge.state('thinking');
  responseTimer = setTimeout(() => failTurn('Gemini transcribed no question. Check the Quest microphone and speak closer to the headset.'), 15000);
}
function endQuestion() {
  if (!active || released) return;
  released = true; node?.disconnect(); source?.disconnect(); sink?.disconnect(); node = source = sink = null;
  sendEnd();
}
function finishTurn() {
  if (!active || completionTimer) return;
  clearTimeout(responseTimer); responseTimer = undefined;
  const wait = Math.max(0, (playbackAt - (audio?.currentTime || 0))*1000 + 100);
  completionTimer = setTimeout(() => {
    completionTimer = undefined; active = false; bridge.state('idle'); ui.talk.disabled = false; ui.status.textContent = ready; closeTurn();
  }, wait);
}
function onMessage(event) {
  let message; try { message = JSON.parse(event.data); } catch { return; }
  if (message.proxyReady) {
    socket.send(JSON.stringify({setup:{model:MODEL}}));
    return;
  }
  if (message.setupComplete) {
    clearTimeout(connectTimer); connectTimer = undefined;
    setupReady = true;
    for (const chunk of pendingAudio) routeAudio(chunk);
    pendingAudio = [];
    if (released) sendEnd();
    else { ui.status.textContent = listening; bridge.state('listening'); }
  }
  const content = message.serverContent;
  if (content?.interrupted) clearPlayback();
  if (content?.inputTranscription?.text) bridge.user(content.inputTranscription.text, Boolean(content.turnComplete));
  if (content?.outputTranscription?.text) bridge.say(content.outputTranscription.text, Boolean(content.turnComplete));
  for (const part of content?.modelTurn?.parts || []) if (part.inlineData?.data) play(part.inlineData.data);
  if (content?.generationComplete || content?.turnComplete) finishTurn();
}
async function beginQuestion() {
  if (!media || active) return;
  clearPlayback();
  active = true; released = false; setupReady = false; activityStarted = false; endSent = false; pendingAudio = []; preRoll = []; audioChunks = 0; speechPeak = 0; capRetried = false;
  ui.talk.disabled = true; ui.status.textContent = connecting; bridge.state('connecting');
  try {
    // Keep ONE persistent stream, exactly like the probe page that measures real audio on this hardware. Quest
    // Browser hands back an all-zero stream when tracks are stopped and immediately reacquired per turn (the v9
    // behaviour), so only reacquire when the track has actually died or been muted by the system.
    const track = media.getAudioTracks?.()[0];
    if (!track || track.readyState !== 'live' || track.muted) {
      media.getTracks().forEach(item => item.stop());
      media = watchTracks(await microphone());
    }
    await audio.resume();
    startCapture();
    zeroWatch();
    const response = await deadline(fetch('/api/voice/token', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId:deviceId(),adultConsent:true,consentVersion:POLICY_VERSION,toolsVersion:TOOLS_VERSION})}), 5000, 'network');
    if (!response.ok) throw new Error(response.status === 429 ? 'quota' : 'token');
    const grant = await response.json();
    if (grant.model !== MODEL || typeof grant.token !== 'string') throw new Error('token');
    ui.status.textContent = 'Opening Gemini Live…';
    socket = new WebSocket(SOCKET);
    connectTimer = setTimeout(() => failTurn('Gemini connection timed out. Check Quest Wi-Fi and try again.'), 8000);
    socket.addEventListener('open', () => socket.send(JSON.stringify({authToken:grant.token})));
    socket.addEventListener('message', onMessage); socket.addEventListener('error', () => failTurn());
    socket.addEventListener('close', () => { if (active) failTurn(); });
  } catch (error) { failTurn(error.message === 'quota' ? quota : failed); }
}
function watchTracks(stream) {
  const track = stream?.getAudioTracks?.()[0];
  if (track) {
    const settings = track.getSettings?.() || {};
    trackNote = `"${track.label || 'no label'}" muted=${track.muted} state=${track.readyState} rate=${settings.sampleRate ?? '?'} aec=${settings.echoCancellation ?? '?'}`;
    for (const type of ['mute', 'unmute', 'ended']) track.addEventListener(type, () => { trackNote += ` [${type}]`; });
  }
  return stream;
}
// The known Quest failure is a stream that starts silently (all-zero samples). If nothing above the noise floor
// arrives in the first moments of a press, reacquire the microphone once with audio processing disabled and keep
// the turn going; the second check only reports, so a quiet person just sees the diagnostics.
function zeroWatch() {
  clearTimeout(zeroTimer);
  zeroTimer = setTimeout(async () => {
    zeroTimer = undefined;
    if (!active || released || activityStarted || speechPeak > 0) return;
    if (capRetried) {
      ui.status.textContent = `${listening} (mic still silent: ${trackNote}; chunks ${audioChunks})`;
      return;
    }
    capRetried = true;
    ui.status.textContent = 'Microphone is silent. Retrying with audio processing off…';
    try {
      node?.disconnect(); source?.disconnect(); sink?.disconnect(); node = source = sink = null;
      media?.getTracks().forEach(track => track.stop());
      const fresh = watchTracks(await microphone(true));
      if (!active || released) { fresh.getTracks().forEach(track => track.stop()); return; }
      media = fresh;
      startCapture();
      zeroWatch();
    } catch { failTurn(micBlocked); }
  }, 1600);
}
function microphone(rawCapture) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => {
      finished = true;
      reject(new Error('microphone_blocked'));
    }, 8000);
    const audioConstraints = rawCapture
      ? {echoCancellation:false, noiseSuppression:false, autoGainControl:false, channelCount:{ideal:1}}
      : true;
    navigator.mediaDevices.getUserMedia({audio:audioConstraints,video:false}).then(stream => {
      if (finished) { stream.getTracks().forEach(track => track.stop()); return; }
      finished = true; clearTimeout(timer); resolve(stream);
    }, () => {
      if (finished) return;
      finished = true; clearTimeout(timer); reject(new Error('microphone_blocked'));
    });
  });
}
function deadline(promise, ms, code) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(code)), ms)),
  ]);
}
async function enable() {
  ui.enable.disabled = true; ui.status.textContent = stages[0];
  try {
    audio = new AudioContext({latencyHint:'interactive'});
    const audioReady = Promise.all([audio.resume(), audio.audioWorklet.addModule('/voice/input-worklet.js')]);
    media = watchTracks(await microphone());
    ui.status.textContent = stages[1];
    await deadline(audioReady, 5000, 'audio_blocked');
    ui.disable.disabled = false; ui.talk.disabled = false; ui.status.textContent = ready;
  } catch (error) { await disable(); ui.status.textContent = error?.message === 'microphone_blocked' ? micBlocked : failed; }
}
async function disable() {
  released = true; active = false; closeTurn(); clearPlayback(); media?.getTracks().forEach(track => track.stop()); media = null;
  await audio?.close().catch(() => {}); audio = null; ui.disable.disabled = ui.talk.disabled = true; ui.enable.disabled = !ui.consent.checked; ui.status.textContent = idle; bridge.state('idle');
}

ui.consent.addEventListener('change', () => { ui.enable.disabled = !ui.consent.checked || Boolean(media); });
ui.enable.addEventListener('click', enable); ui.disable.addEventListener('click', disable);
ui.talk.addEventListener('pointerdown', event => { event.preventDefault(); ui.talk.setPointerCapture(event.pointerId); void beginQuestion(); });
for (const type of ['pointerup','pointercancel']) ui.talk.addEventListener(type, event => { event.preventDefault(); endQuestion(); });
ui.talk.addEventListener('keydown', event => { if ([' ','Enter'].includes(event.key) && !event.repeat) { event.preventDefault(); void beginQuestion(); } });
ui.talk.addEventListener('keyup', event => { if ([' ','Enter'].includes(event.key)) { event.preventDefault(); endQuestion(); } });
function pollController() {
  const current = window.iynkware || root;
  const pressed = controllerTalkPressed(current);
  if (pressed && !controllerDown) {
    current?.app?.input?.pulse?.('right', .35, 35);
    void beginQuestion();
  }
  if (!pressed && controllerDown) {
    current?.app?.input?.pulse?.('right', .18, 20);
    endQuestion();
  }
  controllerDown = pressed; requestAnimationFrame(pollController);
}
requestAnimationFrame(pollController);
window.addEventListener('pagehide', disable, {once:true});
