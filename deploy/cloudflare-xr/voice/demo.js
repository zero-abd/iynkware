import {
  CONSENT_VERSION as POLICY_VERSION,
  GEMINI_MODEL as MODEL,
  LOCKED_LIVE_CONFIG,
  TOOLS_VERSION,
} from './policy.mjs';
import { controllerTalkPressed, rawSetup, runtimeBridge, untrustedContext } from './client-core.mjs';

const SOCKET = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
const DEVICE_KEY = 'iynkware:voice-device:v1';
const COPY = {
  en: ['Gemini voice guide','Adult hackathon prototype. While you hold Talk, microphone audio goes directly to Google Gemini. iynkware does not intentionally store audio, transcripts, or conversation history.','I am 18 or older and agree to send microphone audio to Google for this demo.','Enable voice','Disable voice','Hold to talk','Voice is off.','Voice ready. Hold B in MR or hold the button below.','Connecting…','Listening… release when finished.','Gemini is answering…','Voice failed. Release and try again.','Daily demo limit reached.'],
  de: ['Gemini-Sprachhilfe','Hackathon-Prototyp nur für Erwachsene. Beim Halten von Sprechen wird Mikrofon-Audio direkt an Google Gemini gesendet. iynkware speichert es nicht absichtlich.','Ich bin mindestens 18 Jahre alt und stimme dem Senden meines Mikrofon-Audios an Google zu.','Sprache aktivieren','Sprache deaktivieren','Zum Sprechen halten','Sprache ist aus.','Sprache bereit. In MR B oder die Taste unten halten.','Verbindung…','Hört zu… danach loslassen.','Gemini antwortet…','Sprachfehler. Erneut versuchen.','Tageslimit erreicht.'],
  es: ['Guía de voz Gemini','Prototipo solo para adultos. Al mantener Hablar, el audio va directamente a Google Gemini. iynkware no lo almacena intencionalmente.','Tengo al menos 18 años y acepto enviar mi audio a Google.','Activar voz','Desactivar voz','Mantén para hablar','La voz está apagada.','Voz lista. Mantén B en MR o el botón inferior.','Conectando…','Escuchando… suelta al terminar.','Gemini está respondiendo…','Error de voz. Inténtalo de nuevo.','Límite diario alcanzado.'],
  fr: ['Guide vocal Gemini','Prototype réservé aux adultes. En maintenant Parler, le son va directement à Google Gemini. iynkware ne le stocke pas volontairement.','J’ai au moins 18 ans et j’accepte d’envoyer mon son à Google.','Activer la voix','Désactiver la voix','Maintenir pour parler','La voix est désactivée.','Voix prête. Maintenez B en MR ou le bouton ci-dessous.','Connexion…','Écoute… relâchez après la question.','Gemini répond…','Échec vocal. Réessayez.','Limite quotidienne atteinte.'],
  hi: ['Gemini वॉइस गाइड','केवल वयस्कों के लिए प्रोटोटाइप। दबाने पर ऑडियो सीधे Google Gemini को जाता है। iynkware इसे जानबूझकर संग्रहीत नहीं करता।','मेरी आयु 18 वर्ष या अधिक है और मैं ऑडियो भेजने की सहमति देता/देती हूँ।','वॉइस चालू करें','वॉइस बंद करें','बोलने के लिए दबाएँ','वॉइस बंद है।','वॉइस तैयार। MR में B या नीचे का बटन दबाएँ।','जुड़ रहा है…','सुन रहा है… पूरा होने पर छोड़ें।','Gemini उत्तर दे रहा है…','वॉइस विफल। फिर प्रयास करें।','दैनिक सीमा पूरी हुई।'],
  zh: ['Gemini 语音向导','仅限成人的原型。按住说话时，音频会直接发送给 Google Gemini。iynkware 不会有意存储。','我已年满 18 岁，并同意将麦克风音频发送给 Google。','启用语音','停用语音','按住说话','语音已关闭。','语音就绪。在 MR 中按住 B 或下方按钮。','正在连接…','正在聆听…说完后松开。','Gemini 正在回答…','语音失败。请重试。','已达到每日上限。'],
};
const c = COPY[(document.documentElement.lang || navigator.language || 'en').slice(0,2).toLowerCase()] || COPY.en;
const [title, disclosure, consentText, enableText, disableText, talkText, idle, ready, connecting, listening, speaking, failed, quota] = c;
const root = window.iynkware || (window.iynkware = {});
const bridge = runtimeBridge(root);
let media, audio, socket, node, source;
let active = false, released = false, controllerDown = false, playbackAt = 0;
let playback = [];

const panel = document.createElement('aside');
panel.id = 'voice-demo';
panel.innerHTML = `<style>#voice-demo{position:fixed;z-index:30;right:16px;top:16px;box-sizing:border-box;width:min(390px,calc(100vw - 32px));padding:16px;border:3px solid #231e16;border-radius:16px;background:#f2efe7;color:#231e16;box-shadow:6px 6px 0 #41538f;font:16px/1.35 system-ui,sans-serif}#voice-demo h2{margin:0 0 8px;font-size:22px}#voice-demo p{margin:8px 0}#voice-demo label{display:flex;gap:10px;align-items:flex-start;font-weight:600}#voice-demo input{width:22px;height:22px;flex:none}#voice-demo button{min-height:48px;margin:10px 8px 0 0;padding:8px 18px;border:3px solid #231e16;border-radius:12px;background:#e4694e;color:#231e16;font:600 18px system-ui,sans-serif;touch-action:none}#voice-demo button.secondary{background:#f2efe7}#voice-demo button:disabled{opacity:.45}#voice-status{font-weight:650}</style><h2>${title}</h2><p>${disclosure}</p><label><input id="voice-consent" type="checkbox"><span>${consentText}</span></label><button id="voice-enable" disabled>${enableText}</button><button id="voice-disable" class="secondary" disabled>${disableText}</button><button id="voice-talk" disabled>${talkText}</button><p id="voice-status" role="status" aria-live="polite">${idle}</p>`;
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
  node?.disconnect(); source?.disconnect(); node = source = null;
  const current = socket; socket = null;
  if (current && current.readyState < WebSocket.CLOSING) current.close(1000, 'turn complete');
}
function failTurn(message = failed) {
  active = false; closeTurn(); ui.talk.disabled = !media; ui.status.textContent = message; bridge.state('idle');
}
async function streamInput() {
  source = audio.createMediaStreamSource(media);
  node = new AudioWorkletNode(audio, 'iynkware-voice-input', {numberOfInputs:1, numberOfOutputs:0});
  node.port.onmessage = event => { if (socket?.readyState === WebSocket.OPEN && !released) socket.send(JSON.stringify({realtimeInput:{audio:{data:base64(event.data),mimeType:'audio/pcm;rate=16000'}}})); };
  source.connect(node); ui.status.textContent = listening; bridge.state('listening');
  if (released) sendEnd();
}
function sendEnd() {
  node?.disconnect(); source?.disconnect(); node = source = null;
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({realtimeInput:{audioStreamEnd:true}}));
  ui.status.textContent = speaking; bridge.state('thinking');
}
function endQuestion() { if (!active || released) return; released = true; sendEnd(); }
function onMessage(event) {
  let message; try { message = JSON.parse(event.data); } catch { return; }
  if (message.setupComplete) {
    socket.send(JSON.stringify({clientContent:{turns:[{role:'user',parts:[{text:untrustedContext(bridge.context())}]}],turnComplete:true}}));
    void streamInput();
  }
  const content = message.serverContent;
  if (content?.interrupted) clearPlayback();
  if (content?.inputTranscription?.text) bridge.user(content.inputTranscription.text, Boolean(content.turnComplete));
  if (content?.outputTranscription?.text) bridge.say(content.outputTranscription.text, Boolean(content.turnComplete));
  for (const part of content?.modelTurn?.parts || []) if (part.inlineData?.data) play(part.inlineData.data);
  if (content?.turnComplete) {
    active = false; bridge.state('idle'); ui.talk.disabled = false; ui.status.textContent = ready;
    setTimeout(closeTurn, Math.max(0, (playbackAt - (audio?.currentTime || 0))*1000 + 100));
  }
}
async function beginQuestion() {
  if (!media || active) return;
  active = true; released = false; ui.talk.disabled = true; ui.status.textContent = connecting; bridge.state('connecting');
  try {
    const response = await fetch('/api/voice/token', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deviceId:deviceId(),adultConsent:true,consentVersion:POLICY_VERSION,toolsVersion:TOOLS_VERSION})});
    if (!response.ok) throw new Error(response.status === 429 ? 'quota' : 'token');
    const grant = await response.json();
    if (grant.model !== MODEL || typeof grant.token !== 'string') throw new Error('token');
    socket = new WebSocket(`${SOCKET}?access_token=${encodeURIComponent(grant.token)}`);
    socket.addEventListener('open', () => socket.send(JSON.stringify({setup:rawSetup(MODEL, LOCKED_LIVE_CONFIG)})));
    socket.addEventListener('message', onMessage); socket.addEventListener('error', () => failTurn());
    socket.addEventListener('close', () => { if (active) failTurn(); });
  } catch (error) { failTurn(error.message === 'quota' ? quota : failed); }
}
async function enable() {
  ui.enable.disabled = true; ui.status.textContent = connecting;
  try {
    media = await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
    audio = new AudioContext({latencyHint:'interactive'}); await audio.audioWorklet.addModule('/voice/input-worklet.js'); await audio.resume();
    ui.disable.disabled = false; ui.talk.disabled = false; ui.status.textContent = ready;
  } catch { await disable(); ui.status.textContent = failed; }
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
  const pressed = controllerTalkPressed(root);
  if (pressed && !controllerDown) void beginQuestion();
  if (!pressed && controllerDown) endQuestion();
  controllerDown = pressed; requestAnimationFrame(pollController);
}
requestAnimationFrame(pollController);
window.addEventListener('pagehide', disable, {once:true});
