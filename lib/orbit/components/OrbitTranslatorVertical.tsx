'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as orbitService from '@/lib/orbit/services/orbitService';
import { toast } from 'react-hot-toast';
import styles from '@/styles/Eburon.module.css';
import { OrbitSubtitleOverlay } from './OrbitSubtitleOverlay';
import { supabase } from '@/lib/orbit/services/supabaseClient';
import { LANGUAGES } from '@/lib/orbit/types';

// Orbit Planet Icon SVG
const OrbitIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="planetGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#60666e" />
        <stop offset="50%" stopColor="#3d4147" />
        <stop offset="100%" stopColor="#1a1c1f" />
      </linearGradient>
      <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#888" stopOpacity="0.3" />
        <stop offset="50%" stopColor="#ccc" stopOpacity="0.8" />
        <stop offset="100%" stopColor="#888" stopOpacity="0.3" />
      </linearGradient>
    </defs>
    <ellipse cx="16" cy="16" rx="14" ry="5" stroke="url(#ringGradient)" strokeWidth="1.5" fill="none" transform="rotate(-20 16 16)" />
    <circle cx="16" cy="16" r="9" fill="url(#planetGradient)" />
    <path d="M 2 16 Q 16 21, 30 16" stroke="url(#ringGradient)" strokeWidth="1.5" fill="none" transform="rotate(-20 16 16)" />
  </svg>
);

interface OrbitTranslatorVerticalProps {
  roomCode: string; // This is actually the roomName/meetingId
  userId: string;
  onLiveTextChange?: (text: string) => void;
}

export function OrbitTranslatorVertical({ roomCode, userId, onLiveTextChange }: OrbitTranslatorVerticalProps) {
  // --- State ---
  const [mode, setMode] = useState<'idle' | 'speaking'>('idle');
  const [transcript, setTranscript] = useState('');
  const [liveText, setLiveText] = useState('');
  const [isLockedByOther, setIsLockedByOther] = useState(false);
  
  // We use roomCode as our unique identifier for now, assuming it is the meeting ID
  const roomUuid = roomCode; 

  const recognitionRef = useRef<any>(null);

  // -- Translation & TTS State --
  const [selectedLanguage, setSelectedLanguage] = useState(LANGUAGES[0]);
  const [isListening, setIsListening] = useState(false);
  const [isLangOpen, setIsLangOpen] = useState(false);
  
  // Audio Playback State
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const processingQueueRef = useRef<any[]>([]);
  const isProcessingRef = useRef(false);

  // Constants
  const MY_USER_ID = userId;

  const ensureAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  const playNextAudio = async () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;
    isPlayingRef.current = true;

    const ctx = ensureAudioContext();
    if (!ctx) {
      isPlayingRef.current = false;
      return;
    }

    const nextBuffer = audioQueueRef.current.shift();
    if (!nextBuffer) {
      isPlayingRef.current = false;
      return;
    }

    try {
      const audioBuffer = await ctx.decodeAudioData(nextBuffer);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      source.onended = () => {
        isPlayingRef.current = false;
        playNextAudio();
      };
      source.start();
    } catch (e) {
      console.error("Audio playback error", e);
      isPlayingRef.current = false;
      playNextAudio();
    }
  };

  const processNextInQueue = useCallback(async () => {
    if (isProcessingRef.current || processingQueueRef.current.length === 0) return;
    isProcessingRef.current = true;

    const item = processingQueueRef.current.shift();
    if (!item) {
        isProcessingRef.current = false;
        return;
    }

    try {
        // 1. Translate
        const tRes = await fetch('/api/orbit/translate', {
            method: 'POST',
            body: JSON.stringify({
                text: item.text,
                targetLang: selectedLanguage.code
            })
        });
        const tData = await tRes.json();
        let translated = tData.translation || item.text;
        
        // Show translated text temporarily as live text if listening
        if (isListening) {
             setLiveText(translated); 
        }

        // 2. TTS
        if (isListening) {
             const ttsRes = await fetch('/api/orbit/tts', {
                method: 'POST',
                body: JSON.stringify({ text: translated })
             });
             const arrayBuffer = await ttsRes.arrayBuffer();
             if (arrayBuffer.byteLength > 0) {
                 audioQueueRef.current.push(arrayBuffer);
                 playNextAudio();
             }
        }
    } catch (e) {
        console.error("Pipeline error", e);
    } finally {
        isProcessingRef.current = false;
        // Recursive call with delay to allow stack clear
        setTimeout(processNextInQueue, 10);
    }
  }, [isListening, selectedLanguage.code]);

  // Use refs for useEffect dependencies to avoid staleness
  const selectedLanguageRef = useRef(selectedLanguage);
  useEffect(() => { selectedLanguageRef.current = selectedLanguage; }, [selectedLanguage]);
  
  const isListeningRef = useRef(isListening);
  useEffect(() => { isListeningRef.current = isListening; }, [isListening]);
  
  const processNextInQueueRef = useRef(processNextInQueue);
  useEffect(() => { processNextInQueueRef.current = processNextInQueue; }, [processNextInQueue]);

  // Subscribe to Room State & Transcripts
  useEffect(() => {
    if (!roomUuid) return;
    
    // Subscribe to DB Transcripts for Translation
    const channel = supabase.channel(`room:${roomUuid}:transcripts_sidebar`)
    .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'transcript_segments',
        filter: `meeting_id=eq.${roomUuid}`
    }, (payload: any) => {
        if (payload.new.speaker_id !== MY_USER_ID) {
            // Someone else spoke
            setTranscript(payload.new.source_text);

            if (isListeningRef.current) {
                processingQueueRef.current.push({ text: payload.new.source_text });
                processNextInQueueRef.current();
            }
        }
    })
    .subscribe();

    const sub = orbitService.subscribeToRoomState(roomUuid, (state) => {
      const activeSpeaker = state.active_speaker_user_id;
      // Lock logic: locked if someone else is speaker
      setIsLockedByOther(!!activeSpeaker && activeSpeaker !== userId);
    });

    return () => {
      sub.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [roomUuid, userId, MY_USER_ID]); 


  // Start WebSpeech for real-time subtitles
  const startWebSpeech = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = selectedLanguage.code === 'auto' ? 'en-US' : selectedLanguage.code;

    recognition.onresult = async (event: any) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += t;
        } else {
          interim += t;
        }
      }

      setLiveText(interim || final);

      if (final.trim() && roomUuid) {
        setTranscript(final);
        setLiveText('');
        
        // Save to DB
        const sentences = final.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 0);
        for (const sentence of sentences) {
            orbitService.saveUtterance(roomUuid, userId, sentence, selectedLanguageRef.current.code).catch(e => console.warn(e));
        }
      }
    };

    recognition.onerror = (e: any) => {
      console.error('Speech recognition error:', e.error);
    };

    recognition.onend = () => {
      if (mode === 'speaking' && recognitionRef.current) {
        try { recognition.start(); } catch (e) {}
      }
    };

    recognition.start();
    recognitionRef.current = recognition;
  }, [roomUuid, userId, mode, selectedLanguage]);

  // Stop WebSpeech
  const stopWebSpeech = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setLiveText('');
  }, []);

  // Start Speaking Mode
  const startSpeaking = useCallback(async () => {
    if (!roomUuid) {
      toast.error('Connecting to room...');
      return;
    }
    const acquired = await orbitService.acquireSpeakerLock(roomCode, userId);
    if (!acquired) {
      toast.error('Someone else is speaking');
      return;
    }
    startWebSpeech();
    setMode('speaking');
  }, [roomCode, roomUuid, userId, startWebSpeech]);

  // Stop Speaking Mode
  const stopSpeaking = useCallback(async () => {
    stopWebSpeech();
    await orbitService.releaseSpeakerLock(roomCode, userId);
    setMode('idle');
  }, [roomCode, userId, stopWebSpeech]);

  // Language Dropdown reference
  const langMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
      function handleClickOutside(event: any) {
          if (langMenuRef.current && !langMenuRef.current.contains(event.target)) {
              setIsLangOpen(false);
          }
      }
      document.addEventListener("mousedown", handleClickOutside);
      return () => { document.removeEventListener("mousedown", handleClickOutside); };
  }, [langMenuRef]);

  // Helper format time
  const formatTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const speakDisabled = isLockedByOther;

  return (
    <div className={styles.sidebarPanel}>
      {/* Header */}
      <div className={styles.sidebarHeader}>
        <div className={styles.sidebarHeaderText}>
           <h3>AI Translator</h3>
           <span className={styles.sidebarHeaderMeta}>
              {roomCode ? `Connected to ${roomCode}` : 'Connecting...'} • {formatTime()}
           </span>
        </div>
        <div className={styles.sidebarHeaderActions}>
             {/* Simple Status Dot */}
             <div className="flex items-center gap-2">
                 <div className={`w-2 h-2 rounded-full ${
                    mode === 'speaking' ? 'bg-red-500 animate-pulse' :
                    isLockedByOther ? 'bg-amber-500' :
                    'bg-emerald-500'
                 }`} />
                 <span className="text-[10px] font-bold uppercase text-slate-400">
                    {mode === 'speaking' ? 'LIVE' :
                     isLockedByOther ? 'LOCKED' :
                     'READY'}
                 </span>
             </div>
        </div>
      </div>

      <div className={styles.sidebarBody}>
          
          {/* Controls Card - using sidebarCard style */}
          <div className={styles.sidebarCard}>
             <div className="w-full flex flex-col gap-3">
                 {/* Speak Button - using sidebarCardButton style but tweaked */}
                 <button
                    onClick={mode === 'speaking' ? stopSpeaking : startSpeaking}
                    disabled={speakDisabled}
                    className={`${styles.sidebarCardButton} ${mode === 'speaking' ? styles.sidebarCardButtonActive : ''}`}
                    style={{ justifyContent: 'center', height: '44px' }}
                 >
                    {mode === 'speaking' ? (
                        <>
                            <div className="w-2 h-2 bg-white rounded-full animate-pulse mr-2" />
                            Stop Speaking
                        </>
                    ) : (
                        <>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2">
                                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                                <line x1="12" y1="19" x2="12" y2="23"/>
                                <line x1="8" y1="23" x2="16" y2="23"/>
                            </svg>
                            {speakDisabled ? 'Room Locked' : 'Speak Now'}
                        </>
                    )}
                 </button>

                 <div className="flex gap-2">
                     <button
                        onClick={() => setIsListening(!isListening)}
                        className={`${styles.sidebarCardButton} ${isListening ? styles.sidebarCardButtonActive : ''}`}
                        style={{ flex: 1, justifyContent: 'center' }}
                     >
                        Auto-Translate
                     </button>
                     
                     <div className="relative">
                        <button
                            onClick={() => setIsLangOpen(!isLangOpen)}
                            className={styles.sidebarCardButton}
                            style={{ minWidth: '80px', justifyContent: 'space-between' }}
                        >
                            <span>{selectedLanguage.flag}</span>
                            <span>{selectedLanguage.code.toUpperCase()}</span>
                        </button>

                         {isLangOpen && (
                            <div ref={langMenuRef} className="absolute right-0 top-full mt-2 w-48 z-50 bg-[#1f2125] border border-white/10 rounded-xl shadow-2xl overflow-hidden max-h-[240px] overflow-y-auto">
                                {LANGUAGES.map((lang) => (
                                    <button
                                        key={lang.code}
                                        onClick={() => {
                                            setSelectedLanguage(lang);
                                            setIsLangOpen(false);
                                            if (mode === 'speaking' && recognitionRef.current) {
                                                stopWebSpeech();
                                                setTimeout(startWebSpeech, 100);
                                            }
                                        }}
                                        className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-white/5 transition-colors ${
                                            selectedLanguage.code === lang.code ? 'bg-white/5 text-emerald-400' : 'text-slate-300'
                                        }`}
                                    >
                                        <span className="text-lg">{lang.flag}</span>
                                        <span className="text-xs font-medium">{lang.name}</span>
                                        {selectedLanguage.code === lang.code && <div className="ml-auto w-1.5 h-1.5 bg-emerald-400 rounded-full" />}
                                    </button>
                                ))}
                            </div>
                         )}
                     </div>
                 </div>
             </div>
          </div>

          {/* Transcript History */}
          <div className="flex-1 flex flex-col gap-2 min-h-0">
             <div className="flex items-center justify-between px-1">
                 <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Live Transcript</h3>
             </div>
             
             <div className="flex-1 rounded-xl border border-white/5 bg-black/20 p-3 overflow-y-auto">
                {transcript ? (
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                             <div className="flex items-center gap-2">
                                 <span className={`text-xs font-bold ${mode === 'speaking' ? 'text-rose-400' : 'text-indigo-400'}`}>
                                    {mode === 'speaking' ? 'YOU' : 'SPEAKER'}
                                 </span>
                             </div>
                             <span className="text-[10px] text-slate-600">{formatTime()}</span>
                        </div>
                        <p className="text-sm text-slate-200 leading-relaxed">{transcript}</p>
                        
                        {isListening && (
                             <div className="mt-2 pt-2 border-t border-white/5">
                                 <div className="flex items-center gap-1.5 mb-1">
                                     <span className="text-[10px] font-bold text-emerald-500 uppercase">Translated</span>
                                 </div>
                                 <p className="text-sm text-emerald-100/90">{transcript}</p>
                             </div>
                        )}
                    </div>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-600 gap-2 opacity-60">
                        <span className="text-xs italic">No transcriptions yet</span>
                    </div>
                )}
             </div>
          </div>
      </div>

      {/* Global Subtitle Overlay */}
      {typeof document !== 'undefined' && (
        <OrbitSubtitleOverlay 
          text={liveText || (mode === 'speaking' ? transcript : '')} 
          isVisible={mode === 'speaking' && !!(liveText || transcript)} 
        />
      )}
    </div>
  );
}

// Export the icon for use in control bar
export { OrbitIcon };
