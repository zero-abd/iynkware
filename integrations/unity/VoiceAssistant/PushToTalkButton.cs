using UnityEngine;
using UnityEngine.EventSystems;

namespace Iynkware.VoiceAssistant
{
    public class PushToTalkButton : MonoBehaviour, IPointerDownHandler, IPointerUpHandler
    {
        [SerializeField] private VoiceAssistantClient assistant;

        public void OnPointerDown(PointerEventData eventData) => assistant.BeginRecording();
        public void OnPointerUp(PointerEventData eventData) => assistant.EndRecordingAndSend();
    }
}
