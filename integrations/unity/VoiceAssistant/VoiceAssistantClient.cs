using System;
using System.Collections;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.Networking;
#if UNITY_ANDROID && !UNITY_EDITOR
using UnityEngine.Android;
#endif

namespace Iynkware.VoiceAssistant
{
    [Serializable] public class StringEvent : UnityEvent<string> { }
    [Serializable] public class VoiceTurnResponse
    {
        public string sessionId, transcript, responseText, audioBase64, audioMimeType;
        public bool fallback;
    }

    [RequireComponent(typeof(AudioSource))]
    public class VoiceAssistantClient : MonoBehaviour
    {
        [Header("Backend")]
        [SerializeField] private string backendBaseUrl = "https://your-service.onrender.com";
        [SerializeField] private string clientToken = "replace-with-render-client-token";
        [SerializeField] private int requestTimeoutSeconds = 60;
        [Header("Lesson Context")]
        [SerializeField] private string sessionId, lastAction;
        [SerializeField] private string scenario = "chemistry_lab";
        [SerializeField] private string objective = "Teach the current procedure safely.";
        [SerializeField] private string learnerLevel = "beginner";
        [SerializeField] private int currentStep;
        [SerializeField] private string locale = "en-US";
        [Header("Recording")]
        [SerializeField, Range(3, 30)] private int maxRecordingSeconds = 15;
        [SerializeField] private int sampleRate = 16000;
        [Header("Events")]
        public StringEvent onStatus, onTranscript, onAssistantText, onError;
        public bool IsRecording { get; private set; }
        public bool IsBusy { get; private set; }
        private AudioClip recording;
        private AudioSource output;
        private string microphoneDevice;

        private void Awake()
        {
            if (string.IsNullOrWhiteSpace(sessionId)) sessionId = Guid.NewGuid().ToString("N");
            output = GetComponent<AudioSource>();
        }

        public void SetLessonContext(string newScenario, string newObjective, string level, int step, string action)
        {
            scenario = newScenario; objective = newObjective; learnerLevel = level; currentStep = step; lastAction = action;
        }

        public void BeginRecording()
        {
            if (IsBusy || IsRecording) return;
#if UNITY_ANDROID && !UNITY_EDITOR
            if (!Permission.HasUserAuthorizedPermission(Permission.Microphone))
            {
                Permission.RequestUserPermission(Permission.Microphone);
                onStatus?.Invoke("voice.permission_required");
                return;
            }
#endif
            if (Microphone.devices.Length == 0) { onError?.Invoke("voice.microphone_unavailable"); return; }
            microphoneDevice = Microphone.devices[0];
            recording = Microphone.Start(microphoneDevice, false, maxRecordingSeconds, sampleRate);
            IsRecording = true;
            onStatus?.Invoke("voice.listening");
        }

        public void EndRecordingAndSend()
        {
            if (!IsRecording || recording == null) return;
            int frames = Microphone.GetPosition(microphoneDevice);
            Microphone.End(microphoneDevice);
            IsRecording = false;
            if (frames <= sampleRate / 4) { onError?.Invoke("voice.recording_too_short"); return; }
            float[] all = new float[recording.samples * recording.channels];
            recording.GetData(all, 0);
            float[] trimmed = new float[frames * recording.channels];
            Array.Copy(all, trimmed, trimmed.Length);
            float[] mono16Khz = WavCodec.ResampleMono(trimmed, recording.channels, recording.frequency, sampleRate);
            StartCoroutine(Send(WavCodec.EncodePcm16(mono16Khz, 1, sampleRate)));
        }

        private IEnumerator Send(byte[] wav)
        {
            IsBusy = true; onStatus?.Invoke("voice.thinking");
            WWWForm form = new WWWForm();
            form.AddBinaryData("audio", wav, "speech.wav", "audio/wav");
            form.AddField("sessionId", sessionId); form.AddField("scenario", scenario);
            form.AddField("objective", objective); form.AddField("learnerLevel", learnerLevel);
            form.AddField("currentStep", currentStep); form.AddField("lastAction", lastAction);
            form.AddField("locale", locale);
            using UnityWebRequest request = UnityWebRequest.Post(backendBaseUrl.TrimEnd('/') + "/v1/voice/turn", form);
            request.SetRequestHeader("Authorization", "Bearer " + clientToken);
            request.SetRequestHeader("Iynk-Client", "iynkware-unity/0.1.0");
            request.SetRequestHeader("X-Request-Id", "req_" + Guid.NewGuid().ToString("N"));
            request.timeout = requestTimeoutSeconds;
            yield return request.SendWebRequest();
            IsBusy = false;
            if (request.result != UnityWebRequest.Result.Success)
            {
                Debug.LogWarning($"Voice assistant request failed with HTTP {request.responseCode}.");
                onError?.Invoke("voice.unavailable");
                yield break;
            }
            try
            {
                VoiceTurnResponse result = JsonUtility.FromJson<VoiceTurnResponse>(request.downloadHandler.text);
                onTranscript?.Invoke(result.transcript); onAssistantText?.Invoke(result.responseText);
                output.clip = WavCodec.DecodePcm16(Convert.FromBase64String(result.audioBase64));
                output.Play(); onStatus?.Invoke("voice.playing_ai_response");
            }
            catch (Exception error) { Debug.LogException(error); onError?.Invoke("voice.playback_failed"); }
        }
    }
}
