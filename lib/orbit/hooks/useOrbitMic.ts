import { useState, useRef, useEffect, useCallback } from 'react';
import { ref, update, serverTimestamp } from 'firebase/database';
import { rtdb } from '@/lib/orbit/services/firebase';

const ORBIT_API_KEY = process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY || '';

export type OrbitAudioSource = 'microphone' | 'screen';

export interface UseOrbitMicOptions {
  source?: OrbitAudioSource;
  language?: string;
  autoStart?: boolean;
}

export function useOrbitMic(options: UseOrbitMicOptions = {}) {
  const { source: initialSource = 'microphone', language = 'multi' } = options;
  const [source, setSource] = useState<OrbitAudioSource>(initialSource);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isFinal, setIsFinal] = useState(false);
  
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  const updateOrbitRTDB = async (text: string, final: boolean) => {
    try {
      const orbitRef = ref(rtdb, 'orbit/live_state');
      await update(orbitRef, {
        transcript: text,
        is_final: final,
        updatedAt: serverTimestamp(),
        brand: "Orbit"
      });
    } catch (e) {
      console.error("Orbit Update Failed", e);
    }
  };

  const stop = useCallback(() => {
     // Internal stop logic
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
    }
    if (socketRef.current) {
        socketRef.current.close();
    }
    if (audioContextRef.current) {
        audioContextRef.current.close();
    }

    setIsRecording(false);
    setTranscript('');
    setIsFinal(false);
    streamRef.current = null;
    socketRef.current = null;
    mediaRecorderRef.current = null;
    audioContextRef.current = null;
    analyserRef.current = null;
  }, []);

  const start = useCallback(async () => {
    // Hard stop before start
    stop();

    try {
      let stream: MediaStream;
      
      if (source === 'screen') {
        // Request display media with audio
        stream = await (navigator.mediaDevices as any).getDisplayMedia({
          video: true,
          audio: true
        });
      } else {
        // Request microphone
        stream = await navigator.mediaDevices.getUserMedia({ 
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
        });
      }
      
      streamRef.current = stream;

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;
      
      const sourceNode = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 128;
      sourceNode.connect(analyser);
      analyserRef.current = analyser;

      const url = `wss://api.deepgram.com/v1/listen?model=nova-3&language=${language}&smart_format=true&interim_results=true&punctuate=true&utterances=true&endpointing=100`;
      const socket = new WebSocket(url, ['token', ORBIT_API_KEY]);
      socketRef.current = socket;

      socket.onopen = () => {
        const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
        const mediaRecorder = new MediaRecorder(stream, { mimeType });
        mediaRecorderRef.current = mediaRecorder;
        
        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0 && socket.readyState === 1) {
            socket.send(e.data);
          }
        };
        mediaRecorder.start(250);
        
        setIsRecording(true);
      };

      socket.onmessage = (msg) => {
        try {
            const data = JSON.parse(msg.data);
            const alt = data.channel?.alternatives?.[0];
            const text = alt?.transcript;
            
            if (text) {
              if (data.is_final) {
                // Determine buffer
                const currentBuffer = (socket as any)._sentenceBuffer || [];
                currentBuffer.push(text);
                (socket as any)._sentenceBuffer = currentBuffer;

                if (currentBuffer.length >= 1) { // Changed to 1 for more immediate feedback
                   const fullText = (socket as any)._sentenceBuffer.join(' ');
                   setTranscript(fullText);
                   setIsFinal(true);
                   updateOrbitRTDB(fullText, true);
                   (socket as any)._sentenceBuffer = [];
                }
              } else {
                setTranscript(text);
                setIsFinal(false);
              }
            }
        } catch (err) {
            console.error("Orbit parse error", err);
        }
      };

      socket.onclose = stop;
      socket.onerror = stop;

      // Handle stream end (e.g. screen share stop)
      stream.getTracks().forEach(track => {
        track.onended = stop;
      });

    } catch (e) {
      console.error("Orbit Mic Start Failed", e);
      stop();
    }
  }, [source, language, stop]);

  const toggle = useCallback(() => {
    if (isRecording) {
        stop();
    } else {
        start();
    }
  }, [isRecording, start, stop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
        stop();
    };
  }, [stop]);

  return {
    source,
    setSource,
    isRecording,
    transcript,
    isFinal,
    start,
    stop,
    toggle,
    analyser: analyserRef.current
  };
}

