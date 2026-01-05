'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as orbitService from '@/lib/orbit/services/orbitService';
import { toast } from 'react-hot-toast';
import styles from './OrbitTranslator.module.css';
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
  const [transcript, setTranscript] = useState('');
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

      const tRes = await fetch('/api/orbit/translate', {
        method: 'POST',
        body: JSON.stringify({ text: item.text, targetLang }),
      });
      const tData = await tRes.json();
      const translated = tData.translation || item.text;

      if (isListeningRef.current) {
        setTranslatedPreview(translated);
      }

      // 2) TTS
      if (isListeningRef.current) {
        const ttsRes = await fetch('/api/orbit/tts', {
          method: 'POST',
          body: JSON.stringify({ text: translated }),
        });
        const arrayBuffer = await ttsRes.arrayBuffer();
        if (arrayBuffer.byteLength > 0) {
          audioQueueRef.current.push(arrayBuffer);
          playNextAudio();
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
          if (payload.new.speaker_id !== userId) {
            setTranscript(payload.new.source_text || '');

            if (isListeningRef.current) {
              processingQueueRef.current.push({ text: payload.new.source_text || '' });
              processNextInQueue();
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
        setTranscript(final);
        setTranslatedPreview(''); // UI: clear prior translation when you speak new content
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
    <div
      className={[
        'flex flex-col h-full text-slate-100 border-l border-white/5',
        'bg-[radial-gradient(1200px_800px_at_15%_-10%,rgba(99,102,241,0.18),transparent_60%),radial-gradient(900px_700px_at_90%_10%,rgba(16,185,129,0.12),transparent_55%),linear-gradient(to_bottom,#0b0f16,#07090d)]',
      ].join(' ')}
    >
      {/* Header */}
      <div className="sticky top-0 z-20 px-5 py-4 border-b border-white/10 bg-black/20 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="absolute inset-0 bg-indigo-500/20 blur-md rounded-full" />
              <OrbitIcon size={22} />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="font-semibold text-[14px] tracking-wide text-slate-100">Orbit Translator</span>
              <span className="text-[11px] text-slate-400">
                Room <span className="text-slate-300 font-medium">{roomCode}</span>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">{statusChip}</div>
        </div>
      </div>

      {/* Global Subtitle Overlay */}
      {typeof document !== 'undefined' && (
        <OrbitSubtitleOverlay
          text={liveText || (mode === 'speaking' ? transcript : '')}
          isVisible={mode === 'speaking' && !!(liveText || transcript)}
        />
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col p-4 gap-4 overflow-y-auto">
        {/* Controls */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] shadow-[0_20px_60px_-30px_rgba(0,0,0,0.8)] backdrop-blur-xl overflow-hidden">
          {/* Speak */}
          <div className="p-3">
            <button
              onClick={mode === 'speaking' ? stopSpeaking : startSpeaking}
              disabled={speakDisabled}
              className={[
                'w-full group relative overflow-hidden rounded-2xl p-4 transition-all duration-300',
                'border border-white/10',
                mode === 'speaking'
                  ? 'bg-gradient-to-br from-rose-500/90 to-red-600/90 shadow-[0_18px_40px_-20px_rgba(244,63,94,0.55)]'
                  : speakDisabled
                  ? 'bg-white/5 opacity-50 cursor-not-allowed'
                  : 'bg-white/5 hover:bg-white/10 active:bg-white/5',
              ].join(' ')}
            >
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <div className={styles.sheen} />
              </div>

              <div className="relative z-10 flex items-center justify-center gap-3">
                {mode === 'speaking' ? (
                  <>
                    <div className="flex items-end gap-1 h-4">
                      <span className={styles.waveBar} />
                      <span className={styles.waveBar2} />
                      <span className={styles.waveBar3} />
                      <span className={styles.waveBar2} />
                      <span className={styles.waveBar} />
                    </div>
                    <span className="font-semibold text-white text-[15px] tracking-wide">Stop Speaking</span>
                  </>
                ) : (
                  <>
                    <div
                      className={[
                        'p-2 rounded-full transition-transform',
                        speakDisabled
                          ? 'bg-white/10'
                          : 'bg-gradient-to-br from-indigo-400 to-cyan-400 shadow-[0_10px_30px_-18px_rgba(99,102,241,0.8)] group-hover:scale-105',
                      ].join(' ')}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-white"
                      >
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" y1="19" x2="12" y2="23" />
                        <line x1="8" y1="23" x2="16" y2="23" />
                      </svg>
                    </div>
                    <div className="flex flex-col items-start leading-tight">
                      <span className={`font-semibold text-[15px] ${speakDisabled ? 'text-slate-500' : 'text-slate-100'}`}>
                        Speak Now
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {speakDisabled ? 'Waiting for lock / room' : 'Tap to start live transcription'}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </button>
          </div>

          {/* Settings row */}
          <div className="px-3 pb-3">
            <div className="grid grid-cols-[1fr,1fr] gap-2">
              <button
                onClick={() => setIsListening((v) => !v)}
                className={[
                  'rounded-xl px-3 py-3 text-left border border-white/10 bg-white/5 hover:bg-white/10 transition-colors',
                  isListening ? 'ring-1 ring-emerald-500/30' : '',
                ].join(' ')}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-slate-100">Auto-Translate</span>
                  <span
                    className={[
                      'inline-flex items-center justify-center w-9 h-5 rounded-full border transition-colors',
                      isListening ? 'bg-emerald-500/15 border-emerald-500/30' : 'bg-white/5 border-white/10',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'w-4 h-4 rounded-full transition-transform',
                        isListening ? 'bg-emerald-400 translate-x-[10px]' : 'bg-slate-400 translate-x-[-10px]',
                      ].join(' ')}
                    />
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-slate-400">
                  {isListening ? 'On: translate and read remote speech' : 'Off: show transcript only'}
                </div>
              </button>

              {/* Language selector */}
              <div className="relative" ref={langMenuRef}>
                <button
                  onClick={() => setIsLangOpen((v) => !v)}
                  className="w-full rounded-xl px-3 py-3 text-left border border-white/10 bg-white/5 hover:bg-white/10 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-semibold text-slate-100">Target Language</span>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={`text-slate-400 transition-transform duration-200 ${isLangOpen ? '-rotate-180' : ''}`}
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </div>

                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-[18px] leading-none">{selectedLanguage.flag}</span>
                    <span className="text-[12px] font-medium text-slate-200">{selectedLanguage.name}</span>
                    <span className="ml-auto text-[11px] text-slate-400">{selectedLanguage.code.toUpperCase()}</span>
                  </div>
                </button>

                {isLangOpen && (
                  <div className="absolute right-0 top-full mt-2 w-[320px] z-50 rounded-2xl border border-white/10 bg-[#0b0f16]/95 shadow-2xl overflow-hidden backdrop-blur-xl">
                    <div className="p-3 border-b border-white/10">
                      <input
                        value={langQuery}
                        onChange={(e) => setLangQuery(e.target.value)}
                        placeholder="Search language…"
                        className="w-full rounded-xl px-3 py-2 text-[13px] bg-white/5 border border-white/10 outline-none focus:ring-2 focus:ring-indigo-500/30 placeholder:text-slate-500"
                      />
                    </div>
                    <div className={`max-h-[280px] overflow-y-auto ${styles.scrollbar}`}>
                      {filteredLanguages.map((lang) => (
                        <button
                          key={lang.code}
                          onClick={() => {
                            setSelectedLanguage(lang);
                            setIsLangOpen(false);
                            setLangQuery('');

                            // Keep your behavior: restart recognition to apply new language
                            if (mode === 'speaking' && recognitionRef.current) {
                              stopWebSpeech();
                              setTimeout(startWebSpeech, 120);
                            }
                          }}
                          className={[
                            'w-full px-3 py-2.5 text-left hover:bg-white/5 transition-colors',
                            'flex items-center gap-3',
                            selectedLanguage.code === lang.code ? 'bg-indigo-500/10' : '',
                          ].join(' ')}
                        >
                          <span className="text-[18px]">{lang.flag}</span>
                          <div className="flex flex-col min-w-0">
                            <span
                              className={[
                                'text-[13px] font-medium truncate',
                                selectedLanguage.code === lang.code ? 'text-indigo-300' : 'text-slate-200',
                              ].join(' ')}
                            >
                              {lang.name}
                            </span>
                            <span className="text-[11px] text-slate-500">{lang.code.toUpperCase()}</span>
                          </div>
                          {selectedLanguage.code === lang.code && (
                            <div className="ml-auto w-2 h-2 rounded-full bg-indigo-400 shadow-[0_0_16px_rgba(99,102,241,0.65)]" />
                          )}
                        </button>
                      ))}
                      {filteredLanguages.length === 0 && (
                        <div className="px-3 py-6 text-center text-[12px] text-slate-500">No matches</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Mini info strip */}
            <div className="mt-2 flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-slate-400">
              <span>WebSpeech • Ollama • Gemini</span>
              <span className="text-slate-500">v2 UI</span>
            </div>
          </div>
        </div>

        {/* Transcript */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-2 px-1">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Live Transcript</h3>
            <span className="text-[10px] text-slate-500">{formatTime()}</span>
          </div>

          <div className="flex-1 rounded-2xl border border-white/10 bg-black/20 backdrop-blur-xl p-3 overflow-y-auto shadow-inner">
            {transcript ? (
              <div className="space-y-3">
                {/* Source bubble */}
                <div className="flex items-start gap-2">
                  <div
                    className={[
                      'w-8 h-8 rounded-full grid place-items-center text-[11px] font-bold text-white',
                      mode === 'speaking'
                        ? 'bg-gradient-to-br from-indigo-500 to-cyan-500'
                        : 'bg-gradient-to-br from-violet-500 to-indigo-600',
                    ].join(' ')}
                    title={mode === 'speaking' ? 'You' : 'Speaker'}
                  >
                    {mode === 'speaking' ? 'ME' : 'SP'}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[12px] font-semibold text-slate-200">
                        {mode === 'speaking' ? 'You' : 'Speaker'}
                      </span>
                      {mode === 'speaking' && liveText && (
                        <span className="text-[11px] text-rose-200 bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded-full">
                          Live…
                        </span>
                      )}
                    </div>

                    <div className="rounded-2xl rounded-tl-sm border border-white/10 bg-white/5 px-3 py-2.5 text-[14px] leading-relaxed text-slate-100">
                      {transcript}
                    </div>

                    {/* Translation bubble (UI) */}
                    {isListening && translatedPreview && (
                      <div className="mt-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                            Translated
                          </span>
                          <span className="text-[10px] text-emerald-200/70">
                            → {selectedLanguage.code.toUpperCase()}
                          </span>
                        </div>
                        <div className="text-[13px] leading-relaxed text-emerald-100">{translatedPreview}</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full grid place-items-center">
                <div className="text-center text-slate-500">
                  <div className="mx-auto mb-3 w-12 h-12 rounded-2xl bg-white/5 border border-white/10 grid place-items-center">
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </div>
                  <div className="text-[13px] font-semibold text-slate-300">No activity yet</div>
                  <div className="text-[11px] mt-1 text-slate-500">Press Speak Now to start capturing speech.</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-2 border-t border-white/10 bg-black/20 text-[10px] text-slate-500 flex justify-between items-center backdrop-blur-xl">
        <span>Orbit • Live Translation</span>
        <span className="text-slate-600">Build</span>
      </div>
    </div>
  );
}

export { OrbitIcon };
