'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as orbitService from '@/lib/orbit/services/orbitService';
import { toast } from 'react-hot-toast';
import styles from './OrbitTranslator.module.css';
import sharedStyles from '@/styles/Eburon.module.css';
import { OrbitSubtitleOverlay } from './OrbitSubtitleOverlay';
import { supabase } from '@/lib/orbit/services/supabaseClient';
import { LANGUAGES } from '@/lib/orbit/types';
import { Volume2, Mic, MicOff, StopCircle, ChevronDown, Lock, Trash2 } from 'lucide-react';

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
    <ellipse
      cx="16"
      cy="16"
      rx="14"
      ry="5"
      stroke="url(#ringGradient)"
      strokeWidth="1.5"
      fill="none"
      transform="rotate(-20 16 16)"
    />
    <circle cx="16" cy="16" r="9" fill="url(#planetGradient)" />
    <path
      d="M 2 16 Q 16 21, 30 16"
      stroke="url(#ringGradient)"
      strokeWidth="1.5"
      fill="none"
      transform="rotate(-20 16 16)"
    />
  </svg>
);

interface OrbitTranslatorVerticalProps {
  roomCode: string;
  userId: string;
  onLiveTextChange?: (text: string) => void;
}

export function OrbitTranslatorVertical({ roomCode, userId, onLiveTextChange }: OrbitTranslatorVerticalProps) {
  // --- Core state (kept) ---
  const [mode, setMode] = useState<'idle' | 'speaking'>('idle');
  const [messages, setMessages] = useState<Array<{
    id: string;
    text: string;
    translation?: string;
    speakerId: string;
    isMe: boolean;
    timestamp: Date;
  }>>([]);
  const [liveText, setLiveText] = useState('');
  const [isLockedByOther, setIsLockedByOther] = useState(false);
  // We use roomCode as our unique identifier for now, assuming it is the meeting ID
  const roomUuid = roomCode;

  const recognitionRef = useRef<any>(null);

  // --- Translation & TTS ---
  const [selectedLanguage, setSelectedLanguage] = useState(LANGUAGES[0]);
  const [isListening, setIsListening] = useState(false);
  const [isLangOpen, setIsLangOpen] = useState(false);
  const [langQuery, setLangQuery] = useState('');

  // UI: show last translated text (visual only)
  const [translatedPreview, setTranslatedPreview] = useState('');

  // Audio Playback
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const isPlayingRef = useRef(false);

  // Pipeline queue
  const processingQueueRef = useRef<any[]>([]);
  const isProcessingRef = useRef(false);

  // Refs to avoid stale closures
  const selectedLanguageRef = useRef(selectedLanguage);
  useEffect(() => {
    selectedLanguageRef.current = selectedLanguage;
  }, [selectedLanguage]);

  const isListeningRef = useRef(isListening);
  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  const ensureAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
    return audioCtxRef.current;
  }, []);

  const playNextAudio = useCallback(async () => {
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
      console.error('Audio playback error', e);
      isPlayingRef.current = false;
      playNextAudio();
    }
  }, [ensureAudioContext]);

  const processNextInQueue = useCallback(async () => {
    if (isProcessingRef.current || processingQueueRef.current.length === 0) return;
    isProcessingRef.current = true;

    const item = processingQueueRef.current.shift();
    if (!item) {
      isProcessingRef.current = false;
      return;
    }

    try {
      // 1) Translate
      const targetLang = selectedLanguageRef.current.code;
      let translated = item.text;
      
      try {
          const tRes = await fetch('/api/orbit/translate', {
            method: 'POST',
            body: JSON.stringify({ text: item.text, targetLang }),
          });
          if (tRes.ok) {
             const tData = await tRes.json();
             translated = tData.translation || item.text;
          }
      } catch (translateError) {
          console.warn('Translation API failed, using original text', translateError);
      }

      setMessages(prev => [...prev, {
        id: item.id || Math.random().toString(),
        text: item.text,
        translation: translated !== item.text ? translated : undefined,
        speakerId: item.speakerId || 'remote',
        isMe: false,
        timestamp: new Date()
      }]);

      // 2) TTS
      if (isListeningRef.current) {
        try {
            const ttsRes = await fetch('/api/orbit/tts', {
              method: 'POST',
              body: JSON.stringify({ text: translated }),
            });
            const arrayBuffer = await ttsRes.arrayBuffer();
            if (arrayBuffer.byteLength > 0) {
              audioQueueRef.current.push(arrayBuffer);
              playNextAudio();
            }
        } catch (ttsError) {
            console.warn('TTS API failed', ttsError);
        }
      }
    } catch (e) {
      console.error('Pipeline error', e);
    } finally {
      isProcessingRef.current = false;
      processNextInQueue();
    }
  }, [playNextAudio]);

  // Subscribe: lock state + transcript inserts
  useEffect(() => {
    if (!roomUuid) return;

    const channel = supabase
      .channel(`room:${roomUuid}:transcripts_modern`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'transcript_segments',
          filter: `meeting_id=eq.${roomUuid}`,
        },
        (payload: any) => {
          const isMe = payload.new.speaker_id === userId;
          
          if (!isMe) {
            if (isListeningRef.current) {
              processingQueueRef.current.push({ 
                text: payload.new.source_text || '',
                id: payload.new.id,
                speakerId: payload.new.speaker_id
              });
              processNextInQueue();
            } else {
              setMessages(prev => [...prev, {
                id: payload.new.id || Math.random().toString(),
                text: payload.new.source_text || '',
                speakerId: payload.new.speaker_id,
                isMe: false,
                timestamp: new Date()
              }]);
            }
          }
        }
      )
      .subscribe();

    const sub = orbitService.subscribeToRoomState(roomUuid, (state) => {
      const activeSpeaker = state.active_speaker_user_id;
      setIsLockedByOther(!!activeSpeaker && activeSpeaker !== userId);
    });

    return () => {
      sub.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [roomUuid, userId, processNextInQueue]);

  // Start WebSpeech
  const startWebSpeech = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error('WebSpeech not supported in this browser.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;

    const lang = selectedLanguageRef.current.code === 'auto' ? 'en-US' : selectedLanguageRef.current.code;
    recognition.lang = lang;

    recognition.onresult = async (event: any) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) final += t;
        else interim += t;
      }

      const display = interim || final;
      setLiveText(display);
      onLiveTextChange?.(display);

      if (final.trim() && roomUuid) {
        const msgId = Math.random().toString();
        setMessages(prev => [...prev, {
          id: msgId,
          text: final,
          speakerId: userId,
          isMe: true,
          timestamp: new Date()
        }]);
        setLiveText('');

        const sentences = final
          .split(/(?<=[.!?])\s+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        for (const sentence of sentences) {
          orbitService
            .saveUtterance(roomUuid, userId, sentence, selectedLanguageRef.current.code)
            .catch((e) => console.warn(e));
        }
      }
    };

    recognition.onerror = (e: any) => {
      console.error('Speech recognition error:', e.error);
    };

    recognition.onend = () => {
      if (mode === 'speaking' && recognitionRef.current) {
        try {
          recognition.start();
        } catch {}
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
    } catch (e) {
      console.error(e);
      toast.error('Unable to start microphone.');
    }
  }, [roomUuid, userId, mode, onLiveTextChange]);

  const stopWebSpeech = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    setLiveText('');
    onLiveTextChange?.('');
  }, [onLiveTextChange]);

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

    setMode('speaking');
    startWebSpeech();
  }, [roomUuid, roomCode, userId, startWebSpeech]);

  const stopSpeaking = useCallback(async () => {
    stopWebSpeech();
    await orbitService.releaseSpeakerLock(roomCode, userId);
    setMode('idle');
  }, [roomCode, userId, stopWebSpeech]);

  const speakDisabled = isLockedByOther || !roomUuid;

  // Language dropdown click-outside
  const langMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handleClickOutside(event: any) {
      if (langMenuRef.current && !langMenuRef.current.contains(event.target)) {
        setIsLangOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const formatTime = () =>
    new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

  const status = useMemo(() => {
    if (!roomUuid) return { label: 'Connecting', tone: 'amber' as const };
    if (mode === 'speaking') return { label: 'Live', tone: 'rose' as const };
    if (isLockedByOther) return { label: 'Locked', tone: 'orange' as const };
    return { label: 'Ready', tone: 'emerald' as const };
  }, [roomUuid, mode, isLockedByOther]);

  const statusChip = useMemo(() => {
    const base =
      'flex items-center gap-2 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 shadow-sm backdrop-blur';
    const dotBase = 'w-1.5 h-1.5 rounded-full';
    if (status.tone === 'amber')
      return (
        <div className={`${base} text-amber-300`}>
          <div className={`${dotBase} bg-amber-400 ${styles.pulseSoft}`} />
          <span className="text-[11px] font-semibold uppercase tracking-wider">Connecting</span>
        </div>
      );
    if (status.tone === 'rose')
      return (
        <div className={`${base} text-rose-200`}>
          <div className={`${dotBase} bg-rose-400 ${styles.pingSoft}`} />
          <span className="text-[11px] font-semibold uppercase tracking-wider">Live</span>
        </div>
      );
    if (status.tone === 'orange')
      return (
        <div className={`${base} text-orange-200`}>
          <div className={`${dotBase} bg-orange-400`} />
          <span className="text-[11px] font-semibold uppercase tracking-wider">Locked</span>
        </div>
      );
    return (
      <div className={`${base} text-emerald-200`}>
        <div className={`${dotBase} bg-emerald-400`} />
        <span className="text-[11px] font-semibold uppercase tracking-wider">Ready</span>
      </div>
    );
  }, [status.tone]);

  const filteredLanguages = useMemo(() => {
    const q = langQuery.trim().toLowerCase();
    if (!q) return LANGUAGES;
    return LANGUAGES.filter((l) => `${l.name} ${l.code}`.toLowerCase().includes(q));
  }, [langQuery]);

  return (
    <div className={sharedStyles.sidebarPanel}>
      {/* Header */}
      <div className={sharedStyles.sidebarHeader}>
        <div className={sharedStyles.sidebarHeaderText}>
          <div className="flex items-center gap-2">
            <OrbitIcon size={18} />
            <h3 className="uppercase tracking-widest text-[11px] font-bold">Orbit Translator</h3>
          </div>
          <div className={sharedStyles.sidebarHeaderMeta}>
            <div className="flex items-center gap-1.5 mt-1">
              <div
                className={`w-1.5 h-1.5 rounded-full shadow-[0_0_8px_currentColor] transition-colors duration-500 ${
                  mode === 'speaking'
                    ? 'text-rose-400 bg-rose-400 animate-pulse'
                    : isLockedByOther
                    ? 'text-orange-400 bg-orange-400'
                    : 'text-emerald-400 bg-emerald-400'
                }`}
              />
              <span className="text-[10px] uppercase tracking-wide font-medium">
                {mode === 'speaking' ? 'Live' : isLockedByOther ? 'Locked' : 'Ready'}
              </span>
            </div>
          </div>
        </div>
        <div className={sharedStyles.sidebarHeaderActions}>
          <button
            onClick={() => setMessages([])}
            className={sharedStyles.sidebarHeaderButton}
            title="Clear Feed"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      <div className={sharedStyles.agentPanelBody}>
        {/* Main Controls */}
        <div className={sharedStyles.agentControls}>
          <button
            onClick={mode === 'speaking' ? stopSpeaking : startSpeaking}
            disabled={speakDisabled}
            className={`${sharedStyles.agentControlButton} ${
              mode === 'speaking' ? sharedStyles.agentControlButtonActiveSpeak : ''
            } ${speakDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {isLockedByOther ? (
              <Lock size={18} />
            ) : mode === 'speaking' ? (
              <Mic size={18} />
            ) : (
              <MicOff size={18} />
            )}
            <span>{isLockedByOther ? 'Locked' : mode === 'speaking' ? 'Stop' : 'Speak'}</span>
          </button>

          <button
            onClick={() => setIsListening((v) => !v)}
            className={`${sharedStyles.agentControlButton} ${
              isListening ? sharedStyles.agentControlButtonActiveListen : ''
            }`}
          >
            {isListening ? <StopCircle size={18} /> : <Volume2 size={18} />}
            <span>Listen</span>
          </button>
        </div>

        {/* Target Language */}
        <div className={sharedStyles.agentSection}>
          <label className={sharedStyles.agentSectionLabel}>
            <span>Target Language</span>
            <span className={sharedStyles.agentSectionDivider} />
          </label>
          <div className={sharedStyles.agentSelectWrap}>
            <select
              aria-label="Target language"
              className={`${sharedStyles.sidebarSelect} ${sharedStyles.agentSelect}`}
              value={selectedLanguage.code}
              onChange={(e) => {
                const lang = LANGUAGES.find((l) => l.code === e.target.value) || LANGUAGES[0];
                setSelectedLanguage(lang);
                if (mode === 'speaking' && recognitionRef.current) {
                  stopWebSpeech();
                  setTimeout(startWebSpeech, 120);
                }
              }}
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.flag} {lang.name}
                </option>
              ))}
            </select>
            <div className={sharedStyles.agentSelectIcon}>
              <ChevronDown size={14} />
            </div>
          </div>
        </div>

        {/* Activity Feed */}
        <div className={sharedStyles.agentLogs}>
          {messages.length === 0 && !liveText && (
            <div className="h-full flex flex-col items-center justify-center text-slate-600 space-y-4 opacity-50">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-white/5 flex items-center justify-center">
                <Volume2 size={24} className="text-slate-500" strokeWidth={1} />
              </div>
              <p className="text-xs font-medium tracking-wide">Waiting for speech...</p>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className="animate-in fade-in slide-in-from-bottom-2 duration-500 mb-6">
              {/* Original */}
              <div className={`group relative pl-3.5 mb-3 opacity-80 hover:opacity-100 transition-opacity ${msg.isMe ? 'text-right pr-3.5 pl-0' : ''}`}>
                <div className={`absolute ${msg.isMe ? 'right-0' : 'left-0'} top-1.5 bottom-1.5 w-[2px] bg-slate-800 rounded-full group-hover:bg-indigo-500/50 transition-colors`} />
                <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1 font-semibold">
                  {msg.isMe ? 'You' : 'Original'}
                </p>
                <p className="text-xs text-slate-300 leading-relaxed font-light">{msg.text}</p>
              </div>

              {/* Translation (if exists) */}
              {msg.translation && (
                <div className="bg-gradient-to-br from-[#151d2b] to-[#0f141f] border border-emerald-500/10 rounded-2xl p-4 shadow-lg relative overflow-hidden group hover:border-emerald-500/20 transition-all">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
                    <span className="text-[10px] uppercase tracking-wider font-bold text-emerald-500">Translated</span>
                  </div>
                  <p className="text-sm text-slate-100 leading-relaxed font-medium italic">{msg.translation}</p>
                </div>
              )}
            </div>
          ))}

          {liveText && (
            <div className="animate-pulse">
              <div className="group relative pl-3.5 mb-3 text-right pr-3.5 pl-0">
                <div className="absolute right-0 top-1.5 bottom-1.5 w-[2px] bg-rose-500/50 rounded-full" />
                <p className="text-[10px] uppercase tracking-wide text-rose-500 mb-1 font-semibold">Speaking...</p>
                <p className="text-xs text-rose-200/80 leading-relaxed font-light italic">{liveText}</p>
              </div>
            </div>
          )}
          <div className="h-4" />
        </div>
      </div>
    </div>
  );
}

export { OrbitIcon };