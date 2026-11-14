using System;
using System.IO;
using System.Text;
using UnityEngine;

namespace Iynkware.VoiceAssistant
{
    public static class WavCodec
    {
        public static float[] ResampleMono(float[] interleaved, int channels, int sourceRate, int targetRate)
        {
            if (interleaved == null) throw new ArgumentNullException(nameof(interleaved));
            if (channels < 1 || sourceRate < 1 || targetRate < 1) throw new ArgumentOutOfRangeException();
            int sourceFrames = interleaved.Length / channels;
            if (sourceFrames == 0) return Array.Empty<float>();
            int targetFrames = Math.Max(1, Mathf.RoundToInt(sourceFrames * (targetRate / (float)sourceRate)));
            float[] output = new float[targetFrames];

            float ReadMono(int frame)
            {
                float sum = 0f;
                int offset = frame * channels;
                for (int channel = 0; channel < channels; channel++) sum += interleaved[offset + channel];
                return sum / channels;
            }

            for (int frame = 0; frame < targetFrames; frame++)
            {
                float sourcePosition = frame * (sourceRate / (float)targetRate);
                int left = Math.Min(Mathf.FloorToInt(sourcePosition), sourceFrames - 1);
                int right = Math.Min(left + 1, sourceFrames - 1);
                output[frame] = Mathf.Lerp(ReadMono(left), ReadMono(right), sourcePosition - left);
            }
            return output;
        }

        public static byte[] EncodePcm16(float[] samples, int channels, int sampleRate)
        {
            const short bitsPerSample = 16;
            int dataLength = samples.Length * 2;
            using var stream = new MemoryStream(44 + dataLength);
            using var writer = new BinaryWriter(stream, Encoding.ASCII, true);
            writer.Write(Encoding.ASCII.GetBytes("RIFF"));
            writer.Write(36 + dataLength);
            writer.Write(Encoding.ASCII.GetBytes("WAVEfmt "));
            writer.Write(16);
            writer.Write((short)1);
            writer.Write((short)channels);
            writer.Write(sampleRate);
            writer.Write(sampleRate * channels * bitsPerSample / 8);
            writer.Write((short)(channels * bitsPerSample / 8));
            writer.Write(bitsPerSample);
            writer.Write(Encoding.ASCII.GetBytes("data"));
            writer.Write(dataLength);
            foreach (float sample in samples) writer.Write((short)(Mathf.Clamp(sample, -1f, 1f) * short.MaxValue));
            return stream.ToArray();
        }

        public static AudioClip DecodePcm16(byte[] wavBytes)
        {
            using var stream = new MemoryStream(wavBytes, false);
            using var reader = new BinaryReader(stream, Encoding.ASCII, true);
            if (FourCc(reader) != "RIFF") throw new InvalidDataException("Missing RIFF header.");
            reader.ReadInt32();
            if (FourCc(reader) != "WAVE") throw new InvalidDataException("Missing WAVE header.");
            short format = 0, channels = 0, bits = 0;
            int rate = 0;
            byte[] data = null;
            while (stream.Position + 8 <= stream.Length)
            {
                string id = FourCc(reader);
                int size = reader.ReadInt32();
                long next = stream.Position + size + size % 2;
                if (id == "fmt ")
                {
                    format = reader.ReadInt16(); channels = reader.ReadInt16(); rate = reader.ReadInt32();
                    reader.ReadInt32(); reader.ReadInt16(); bits = reader.ReadInt16();
                }
                else if (id == "data") data = reader.ReadBytes(size);
                stream.Position = Math.Min(next, stream.Length);
            }
            if (format != 1 || bits != 16 || channels < 1 || data == null)
                throw new InvalidDataException("Only PCM16 WAV responses are supported.");
            float[] samples = new float[data.Length / 2];
            for (int i = 0; i < samples.Length; i++) samples[i] = BitConverter.ToInt16(data, i * 2) / 32768f;
            AudioClip clip = AudioClip.Create("AssistantReply", samples.Length / channels, channels, rate, false);
            clip.SetData(samples, 0);
            return clip;
        }

        private static string FourCc(BinaryReader reader) => Encoding.ASCII.GetString(reader.ReadBytes(4));
    }
}
