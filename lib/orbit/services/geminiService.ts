
import { GoogleGenAI, Modality, Type, LiveServerMessage } from "@google/genai";
import { TranslationResult, EmotionType } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY || '' });

const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds

/**
 * Decodes base64 string to Uint8Array.
 */
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Decodes raw PCM audio data into an AudioBuffer.
 */
async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

async function playCartesiaTTS(text: string, ctx: AudioContext) {
  try {
     const res = await fetch('/api/tts', {
       method: 'POST',
       body: JSON.stringify({ text, provider: 'cartesia' }),
       headers: { 'Content-Type': 'application/json' }
     });
     if (!res.ok) throw new Error(await res.text());
     const buf = await res.arrayBuffer();
     const audioBuf = await ctx.decodeAudioData(buf);
     const source = ctx.createBufferSource();
     source.buffer = audioBuf;
     source.connect(ctx.destination);
     source.start();
  } catch (e) {
     console.error("Cartesia Playback Error", e);
  }
}

/**
 * Live Translation Stream with Retry Logic and Auto-Detection.
 */
export async function streamTranslation(
  sourceText: string,
  targetLangName: string,
  audioCtx: AudioContext,
  onAudioData: (data: Uint8Array) => void,
  onTranscript: (text: string) => void,
  onEnd: (finalText: string) => void,

  sourceLangCode: string = 'auto',
  retryCount: number = 0,
  ttsProvider: 'gemini' | 'cartesia' = 'gemini'
) {
  let nextStartTime = 0;
  let fullTranslation = "";
  const isAutoDetect = sourceLangCode === 'auto';

  try {
    const sessionPromise = ai.live.connect({
      model: 'models/gemini-2.0-flash-exp',
      config: {
        responseModalities: [ttsProvider === 'cartesia' ? Modality.TEXT : Modality.AUDIO],
        outputAudioTranscription: {}, 
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Orus' } }
        },
        systemInstruction: `You are a high-fidelity, transparent translation and vocal synthesis engine. 
        Your goal is to translate the source text into ${targetLangName} with extreme precision, aiming for native human speaker quality.
        
        ${isAutoDetect ? "AUTO-DETECTION MODE: The source language is unknown. Your first task is to identify the language of the input text/audio before translating." : `The source language is likely ${sourceLangCode}.`}
        
        CRITICAL PERFORMANCE SPECS:
        1. ACCURATE SYNTAX & SPELLING: Use perfect grammar and localized vocabulary. Strictly follow target-language spelling rules (including all diacritics and regional orthography) as if referencing a native dictionary for ${targetLangName}.
        2. NATIVE VOCABULARY REFERENCES: Use industry-standard and culturally relevant vocabulary references. Avoid generic translations; use the specific terms a native speaker would use in ${targetLangName}.
        3. EMOTION SYNTHESIS: Deeply analyze the emotional context of the source text. Synthesize your voice to mimic the original speaker's nuances (e.g., excitement, urgency, hesitation, anger, or calm).
        4. VOCAL MIMICRY: Deliver the translation as if you are the original speaker transformed. Maintain the spirit and "vibe" of the input.
        5. PRONUNCIATION REFERENCES: Use precise phonetic articulation based on native-speaker oral references for the ${targetLangName} dialect. Ensure natural prosody, word stress, and intonation patterns specific to that region.
        6. NO CENSORSHIP: Translate all content literally and transparently. Do not alter slang or profanity.
        7. NO MORALIZING: You are a machine pipe. Do not add summaries or ethical warnings. 
        8. INSTANT DELIVERY: Start the translated audio immediately without any preamble.
        
        You are not an assistant; you are a seamless, high-performance bridge between languages.`
      },
      callbacks: {
        onopen: () => {
          sessionPromise.then(s => s.sendClientContent({ 
            turns: [{ parts: [{ text: sourceText }] }] 
          }));
        },
        onmessage: async (message: LiveServerMessage) => {
          const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
          if (base64Audio) {
            const rawData = decode(base64Audio);
            onAudioData(rawData);
            
            nextStartTime = Math.max(nextStartTime, audioCtx.currentTime);
            const buffer = await decodeAudioData(rawData, audioCtx);
            const source = audioCtx.createBufferSource();
            source.buffer = buffer;
            source.connect(audioCtx.destination);
            
            source.start(nextStartTime);
            nextStartTime += buffer.duration;
          }

          if (message.serverContent?.outputTranscription) {
            fullTranslation += message.serverContent.outputTranscription.text;
            onTranscript(fullTranslation);
          }

          if (message.serverContent?.turnComplete) {
            
            if (ttsProvider === 'cartesia' && fullTranslation.trim()) {
                await playCartesiaTTS(fullTranslation, audioCtx);
            }

            const waitTime = Math.max(0, (nextStartTime - audioCtx.currentTime) * 1000);
            setTimeout(() => onEnd(fullTranslation), waitTime + 100);
          }
        },
        onclose: () => onEnd(fullTranslation),
        onerror: async (e: any) => {
          console.warn(`Gemini Live Error (Attempt ${retryCount + 1}/${MAX_RETRIES + 1}):`, e);
          
          const isServiceUnavailable = e?.message?.includes('unavailable') || e?.status === 503;
          
          if (isServiceUnavailable && retryCount < MAX_RETRIES) {
            const delay = RETRY_DELAY * Math.pow(2, retryCount);
            console.log(`Retrying in ${delay}ms...`);
            setTimeout(() => {
            setTimeout(() => {
              streamTranslation(sourceText, targetLangName, audioCtx, onAudioData, onTranscript, onEnd, sourceLangCode, retryCount + 1, ttsProvider);
            }, delay);
          } else {
            onEnd(fullTranslation);
          }
        }
      }
    });
  } catch (err) {
    console.error("Connection initiation failed:", err);
    onEnd("");
  }
}

export async function translateAndAnalyze(text: string, targetLangName: string): Promise<TranslationResult> {
  return { 
    translatedText: text, 
    detectedLanguage: "unknown", 
    emotion: "neutral",
    pronunciationGuide: ""
  };
}
