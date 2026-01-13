'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';

interface UseInkLiveOptions {
  deviceId?: string;
  model?: string;
  language?: string;
}

interface UseInkLiveReturn {
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
 * Hook for real-time Cartesia Ink (ink-whisper) WebSocket STT
 */
export function useInkLive(options: UseInkLiveOptions = {}): UseInkLiveReturn {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isFinal, setIsFinal] = useState(false);
  const [words, setWords] = useState<Array<{ word: string; start: number; end: number; confidence: number }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);
  const [currentLanguage, setCurrentLanguage] = useState(options.language || 'en');

  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const startingRef = useRef(false);

  const stop = useCallback(() => {
    console.log("🔌 Ink: Stopping transcription engine...");
    setIsListening(false);
    startingRef.current = false;

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (socketRef.current) {
      if (socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send("done");
      }
      socketRef.current.close();
      socketRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => { });
      audioContextRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  const start = useCallback(async (deviceId?: string) => {
    if (startingRef.current) {
      console.log("⏳ Ink: Transcription engine is already starting...");
      return;
    }
    startingRef.current = true;
    console.log("🔌 Ink: Starting transcription engine...");

    const apiKey = process.env.NEXT_PUBLIC_CARTESIA_API_KEY;
    if (!apiKey) {
      console.warn("[Ink] API Key is missing. Voice transcription disabled.");
      startingRef.current = false;
      return;
    }

    setError(null);
    setTranscript('');
    setWords([]);
    setIsFinal(false);

    try {
      const constraints: MediaStreamConstraints = {
        audio: deviceId
          ? { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true }
          : { echoCancellation: true, noiseSuppression: true }
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      // Cartesia Ink recommends 16kHz PCM
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // ScriptProcessor for raw PCM access
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      source.connect(processor);
      processor.connect(audioContext.destination);

      const model = options.model || 'ink-whisper';
      const language = currentLanguage || 'en';

      const params = new URLSearchParams({
        model,
        language,
        encoding: 'pcm_s16le',
        sample_rate: '16000',
        api_key: apiKey.trim(),
      });

      const wsUrl = `wss://api.cartesia.ai/stt/websocket?${params.toString()}`;
      console.log(`🔌 Ink: Connecting to Cartesia...`);

      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        console.log("✅ Ink: WebSocket opened");
        setIsListening(true);
        setError(null);
        startingRef.current = false;

        processor.onaudioprocess = (e) => {
          if (socket.readyState !== WebSocket.OPEN) return;

          const inputData = e.inputBuffer.getChannelData(0);
          // Convert float32 to int16
          const pcmData = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          socket.send(pcmData.buffer);
        };
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'transcript') {
            const text = data.transcript;
            if (text) {
              setTranscript(text);
              setIsFinal(data.is_final ?? false);
              if (data.words) {
                setWords(data.words);
              }
            }
          } else if (data.type === 'error') {
            console.error('❌ Ink: Error from server:', data.message);
            setError(data.message);
          }
        } catch (e) {
          console.error('❌ Ink: Error parsing response:', e);
        }
      };

      socket.onerror = (error) => {
        console.error("❌ Ink: WebSocket error event:", error);
        setError('Ink connection error');
        startingRef.current = false;
      };

      socket.onclose = (event) => {
        console.log(`🔌 Ink: WebSocket closed. Code: ${event.code}`);
        setIsListening(false);
        startingRef.current = false;
        if (event.code !== 1000 && event.code !== 1001) {
          setError(`Ink connection closed: ${event.code}`);
        }
      };

    } catch (e: any) {
      console.error("❌ Ink: Start failed with exception:", e);
      setError(e.message || 'Microphone access denied');
      startingRef.current = false;
      stop();
    }
  }, [options.model, stop, currentLanguage]);

  const setLanguage = useCallback((lang: string) => {
    if (lang !== currentLanguage) {
      setCurrentLanguage(lang);
    }
  }, [currentLanguage]);

  useEffect(() => {
    if (options.language && options.language !== currentLanguage) {
      setCurrentLanguage(options.language);
    }
  }, [options.language, currentLanguage]);

  useEffect(() => {
    if (isListening && currentLanguage !== options.language && options.language) {
      console.log(`🔄 Ink: Language changed to ${options.language}, restarting...`);
      const currentDeviceId = streamRef.current?.getAudioTracks()[0]?.getSettings().deviceId;
      stop();
      const timer = setTimeout(() => {
        start(currentDeviceId);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [isListening, options.language, currentLanguage, stop, start]);

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
