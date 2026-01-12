'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';

interface UseDeepgramLiveOptions {
  deviceId?: string;
  /** Model: 'nova-3' (best), 'nova-2', 'whisper-large' */
  model?: 'nova-3' | 'nova-2' | 'whisper-large';
  /** 
   * Language code: 
   * - 'multi' for code-switching (Dutch+French mix)
   * - 'nl-BE' for Flemish/Belgium Dutch
   * - 'nl' for Dutch
   * - 'fr' for French
   * - 'en' for English
   */
  language?: string;
  /** Keywords for vocabulary boosting: ['word:intensity', ...] */
  keywords?: string[];
  /** Enable speaker diarization */
  diarize?: boolean;
}

interface UseDeepgramLiveReturn {
  isListening: boolean;
  transcript: string;
  isFinal: boolean;
  start: (deviceId?: string) => Promise<void>;
  stop: () => void;
  setLanguage: (lang: string) => void;
  language: string;
  error: string | null;
  analyser: AnalyserNode | null;
  words: Array<{ word: string; start: number; end: number; confidence: number }>;
  detectedLanguage: string | null;
}

/**
 * Hook for real-time Orbit WebSocket STT with accuracy optimizations
 * 
 * Best practices applied:
 * - Nova-3 model (highest accuracy)
 * - smart_format=true (human-readable formatting)
 * - punctuate=true (sentence punctuation)
 * - utterances=true (phrase-level segmentation)
 * - endpointing=100 (optimal for code-switching)
 * - interim_results=true (real-time feedback)
 */
export function useDeepgramLive(options: UseDeepgramLiveOptions = {}): UseDeepgramLiveReturn {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isFinal, setIsFinal] = useState(false);
  const [words, setWords] = useState<Array<{ word: string; start: number; end: number; confidence: number }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);
  const [currentLanguage, setCurrentLanguage] = useState(options.language || 'multi');

  useEffect(() => {
    if (options.language && options.language !== currentLanguage) {
      setCurrentLanguage(options.language);
    }
  }, [options.language, currentLanguage]);

  const socketRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const stop = useCallback(() => {
    console.log("🔌 Orbit: Stopping transcription engine...");
    setIsListening(false);
    startingRef.current = false;
    
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    recorderRef.current = null;

    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  const startingRef = useRef(false);

  const start = useCallback(async (deviceId?: string) => {
    if (startingRef.current) {
      console.log("⏳ Orbit: Transcription engine is already starting...");
      return;
    }
    startingRef.current = true;
    console.log("🔌 Orbit: Starting transcription engine...");

    const apiKey = process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY;
    if (!apiKey || apiKey === 'YOUR_DEEPGRAM_API_KEY') {
      console.warn("[Orbit] Deepgram Key is missing. Voice transcription disabled.");
      startingRef.current = false;
      return; 
    }

    setError(null);
    setTranscript('');
    setWords([]);
    setIsFinal(false);

    try {
      // ... existing getUserMedia and AudioContext setup ...
      const constraints: MediaStreamConstraints = {
        audio: deviceId 
          ? { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true }
          : { echoCancellation: true, noiseSuppression: true }
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
      const audioContext = new AudioContextClass();
      audioContextRef.current = audioContext;
      
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const model = options.model || 'nova-3';
      const language = currentLanguage || 'en';
      
      const params = new URLSearchParams({
        model,
        smart_format: 'true',
        punctuate: 'true',
        utterances: 'true',
        interim_results: 'true',
        endpointing: '100',
        words: 'true',
      });

      const DEEPGRAM_LANGUAGE_MAPPINGS: Record<string, string> = {
        'vls-BE': 'nl-BE',
        'zea-BE': 'nl-BE',
        'lim-BE': 'nl-BE',
        'wa-BE': 'fr-BE',
        'pcd-BE': 'fr-BE',
        'fr-CI': 'fr',
        'fr-CM': 'fr',
        'en-CM': 'en',
        'byv-CM': 'fr',
        'fil-PH': 'fil',
        'tl-PH': 'fil',
        'ceb-PH': 'fil',
      };

      const mappedLanguage = DEEPGRAM_LANGUAGE_MAPPINGS[language] || language;

      if (mappedLanguage === 'auto' || mappedLanguage === 'multi') {
        params.set('detect_language', 'true');
      } else {
        params.set('language', mappedLanguage);
      }

      if (options.diarize) {
        params.set('diarize', 'true');
      }

      if (options.keywords?.length) {
        options.keywords.forEach(kw => {
          params.append('keywords', kw);
        });
      }

      const wsUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
      
      const socket = new WebSocket(wsUrl, ['token', apiKey.trim()]);
      socketRef.current = socket;

      socket.onopen = () => {
        console.log("🔌 Orbit: Connected to engine");
        setIsListening(true);
        setError(null);
        startingRef.current = false;
        
        try {
          // Select compatible mimeType
          const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
            ? 'audio/webm;codecs=opus' 
            : MediaRecorder.isTypeSupported('audio/webm') 
              ? 'audio/webm' 
              : 'audio/mp4';

          console.log(`🔌 Orbit: Using mimeType ${mimeType}`);
          const recorder = new MediaRecorder(stream, { 
            mimeType,
            audioBitsPerSecond: 128000
          });
          recorderRef.current = recorder;

          recorder.ondataavailable = (event) => {
            if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) {
              socket.send(event.data);
            }
          };

          recorder.start(100);
        } catch (recErr: any) {
          console.error("❌ Orbit: MediaRecorder error:", recErr);
          setError(`MediaRecorder error: ${recErr.message}`);
          stop();
        }
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const alt = data.channel?.alternatives?.[0];
          const text = alt?.transcript;
          const newWords = alt?.words || [];
          
          if (text) {
            setTranscript(text);
            if (newWords.length > 0) {
              setWords(prev => data.is_final ? newWords : [...newWords]);
            }
            setIsFinal(data.is_final ?? false);
          }

          if (data.metadata?.language) {
             setDetectedLanguage(data.metadata.language);
          } else if (data.results?.channels?.[0]?.detected_language) {
             setDetectedLanguage(data.results.channels[0].detected_language);
          }
        } catch (e) {
          console.error('Error parsing Orbit response:', e);
        }
      };

      socket.onerror = (error) => {
        console.error("❌ Orbit: WebSocket error:", error);
        setError('Orbit connection error');
        startingRef.current = false;
        stop();
      };

      socket.onclose = (event) => {
        console.log(`🔌 Orbit: Connection closed (${event.code})`);
        setIsListening(false);
        startingRef.current = false;
      };

    } catch (e: any) {
      console.error("❌ Orbit: Start failed:", e);
      setError(e.message || 'Microphone access denied');
      startingRef.current = false;
      stop();
    }
  }, [options.model, options.diarize, options.keywords, stop, currentLanguage]);

  const setLanguage = useCallback((lang: string) => {
    if (lang !== currentLanguage) {
      setCurrentLanguage(lang);
    }
  }, [currentLanguage]);

  // Restart when language changes while listening
  useEffect(() => {
    if (isListening && currentLanguage !== options.language && options.language) {
       console.log(`🔄 Orbit: Language changed to ${options.language}, restarting...`);
       const currentDeviceId = streamRef.current?.getAudioTracks()[0]?.getSettings().deviceId;
       stop();
       const timer = setTimeout(() => {
         start(currentDeviceId);
       }, 200);
       return () => clearTimeout(timer);
    }
  }, [isListening, options.language, currentLanguage, stop, start]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return useMemo(() => ({
    isListening,
    transcript,
    isFinal,
    start,
    stop,
    setLanguage,
    language: currentLanguage,
    error,
    analyser: analyserRef.current,
    words,
    detectedLanguage
  }), [
    isListening,
    transcript,
    isFinal,
    start,
    stop,
    setLanguage,
    currentLanguage,
    error,
    words,
    detectedLanguage
  ]);
}
