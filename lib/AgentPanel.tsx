'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import styles from '@/styles/Eburon.module.css';
import { supabase } from '@/lib/orbit/services/supabaseClient';
import { streamTranslation } from '@/lib/orbit/services/geminiService';
import { LANGUAGES, Language } from '@/lib/orbit/types';
import { Volume2, Loader2, Mic, MicOff, Sparkles, StopCircle, ChevronDown } from 'lucide-react';

interface AgentPanelProps {
  meetingId?: string;
  onSpeakingStateChange?: (isSpeaking: boolean) => void;
  isTranscriptionEnabled: boolean;
  onToggleTranscription: () => void;
}

interface TranslationLog {
  id: string;
  original: string;
  translation: string;
  lang: string;
}

export function AgentPanel({ meetingId, onSpeakingStateChange, isTranscriptionEnabled, onToggleTranscription }: AgentPanelProps) {
  const [targetLang, setTargetLang] = useState<Language>(LANGUAGES.find(l => l.code === 'es-ES') || LANGUAGES[1]);
  const [isAgentActive, setIsAgentActive] = useState(false);
  const [logs, setLogs] = useState<TranslationLog[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  
  // TTS Provider State
  const [ttsProvider, setTtsProvider] = useState<'gemini' | 'cartesia'>('gemini');

  // Notify parent of speaking state
  useEffect(() => {
    onSpeakingStateChange?.(isSpeaking);
  }, [isSpeaking, onSpeakingStateChange]);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const queueRef = useRef<any[]>([]);
  const processingRef = useRef(false);
  const processedIdsRef = useRef<Set<string>>(new Set());

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const ensureAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  const processQueue = useCallback(async () => {
    if (processingRef.current || queueRef.current.length === 0 || !isAgentActive) return;

    processingRef.current = true;
    const segment = queueRef.current.shift();

    try {
      setIsSpeaking(true);
      const ctx = ensureAudioContext();
      
      // Add 'Processing' log
      const logId = Math.random().toString(36).substring(7);
      setLogs(prev => [...prev, { 
        id: logId, 
        original: segment.source_text, 
        translation: 'Translating...', 
        lang: targetLang.name 
      }]);

      let finalTranslation = '';

      await streamTranslation(
        segment.source_text,
        targetLang.name,
        ctx,
        () => {}, // Audio handled by service
        (text) => {
          // Live update (optional)
        },
        async (finalText) => {
          finalTranslation = finalText;
          processingRef.current = false;
          setIsSpeaking(false);
          
          // Update log with final
          setLogs(prev => prev.map(l => l.id === logId ? { ...l, translation: finalText } : l));

          // Persist translation to DB
          if (segment.id) {
             await supabase.from('transcript_segments')
               .update({ 
                 translated_text: finalText, 
                 target_lang: targetLang.name
               })
               .eq('id', segment.id);
          }
          
          // Next
          processQueue();
        },
        segment.source_lang || 'auto',
        0, // retryCount
        ttsProvider // Pass selected provider
      );
    } catch (e) {
      console.error("Agent translation error:", e);
      processingRef.current = false;
      setIsSpeaking(false);
      processQueue();
    }
  }, [isAgentActive, targetLang, ensureAudioContext, ttsProvider]);

  // Trigger queue processing when active or new items added
  useEffect(() => {
    if (isAgentActive && !processingRef.current && queueRef.current.length > 0) {
      processQueue();
    }
  }, [isAgentActive, processQueue]);

  // Stop audio when agent is disabled
  useEffect(() => {
    if (!isAgentActive && audioCtxRef.current) {
        audioCtxRef.current.suspend();
        setIsSpeaking(false);
        processingRef.current = false; 
    }
  }, [isAgentActive]);

  // Subscribe to transcription
  useEffect(() => {
    if (!meetingId) return;

    const handleRow = (newRow: any) => {
       if (newRow.last_segment_id && processedIdsRef.current.has(newRow.last_segment_id)) return;
       if (newRow.last_segment_id) processedIdsRef.current.add(newRow.last_segment_id);
       
       if (newRow.source_text) {
         queueRef.current.push(newRow);
         processQueue();
       }
    };

    const channel = supabase.channel(`agent:${meetingId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transcript_segments', filter: `meeting_id=eq.${meetingId}` }, 
        (payload) => handleRow(payload.new)
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'transcript_segments', filter: `meeting_id=eq.${meetingId}` },
        (payload) => handleRow(payload.new)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [meetingId, processQueue]);

  return (
    <div className={styles.sidebarPanel}>
      <div className={styles.sidebarHeader}>
        <div className={styles.sidebarHeaderText}>
          <h3>ORBIT TRANSLATOR</h3>
          <div className={styles.sidebarHeaderMeta}>
             <div className="flex items-center gap-1.5 mt-1">
                <div className={`w-1.5 h-1.5 rounded-full shadow-[0_0_8px_currentColor] transition-colors duration-500 ${isSpeaking ? 'text-emerald-400 bg-emerald-400 animate-pulse' : 'text-slate-600 bg-slate-600'}`} />
                <span className="text-[10px] uppercase tracking-wide font-medium">
                  {isSpeaking ? 'Voice Active' : 'Ready'}
                </span>
             </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col flex-1 min-h-0">
        {/* Main Controls */}
        <div className="flex flex-col gap-3 p-4 border-b border-white/5">
          <button
            onClick={onToggleTranscription}
            className={`group flex items-center justify-center p-3 rounded-xl border transition-all duration-300 w-full hover:scale-[1.02] ${
               isTranscriptionEnabled 
               ? 'bg-blue-500/10 border-blue-500/30 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.15)]' 
               : 'bg-white/5 border-white/5 text-slate-400 hover:bg-white/10'
            }`}
          >
            {isTranscriptionEnabled ? <Mic size={20} className="mr-3" /> : <MicOff size={20} className="mr-3" />}
            <span className="text-[10px] uppercase font-bold tracking-wider">Speak</span>
          </button>

          <button
            onClick={() => {
               const newState = !isAgentActive;
               setIsAgentActive(newState);
               if (newState) ensureAudioContext();
            }}
            className={`group flex items-center justify-center p-3 rounded-xl border transition-all duration-300 w-full hover:scale-[1.02] ${
               isAgentActive 
               ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.15)]' 
               : 'bg-white/5 border-white/5 text-slate-400 hover:bg-white/10'
            }`}
          >
            {isAgentActive ? <Sparkles size={20} className="mr-3" /> : <StopCircle size={20} className="mr-3" />}
            <span className="text-[10px] uppercase font-bold tracking-wider">Translate</span>
          </button>
          
          {/* TTS Provider Dropdown */}
          <div className="relative group mt-1">
             <select 
               aria-label="TTS Provider"
               className="w-full appearance-none bg-[#131b2c] border border-slate-700/50 group-hover:border-slate-600 text-slate-200 text-xs font-medium rounded-lg pl-3 pr-8 py-2.5 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all cursor-pointer shadow-sm"
               value={ttsProvider}
               onChange={(e) => setTtsProvider(e.target.value as any)}
             >
               <option value="gemini" className="bg-[#131b2c]">Agent</option>
               <option value="cartesia" className="bg-[#131b2c]">Orbit</option>
             </select>
             {/* Custom Chevron */}
             <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500 group-hover:text-slate-400 transition-colors">
                <ChevronDown size={14} />
             </div>
          </div>
        </div>

        {/* Target Language */}
        <div className="px-5 py-3 border-b border-white/5 bg-white/[0.01]">
          <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2.5 block flex items-center gap-2">
             <span>Target Language</span>
             <div className="h-px bg-slate-800 flex-1"/>
          </label>
          <div className="relative group">
             <select 
               aria-label="Target language"
               className="w-full appearance-none bg-[#131b2c] border border-slate-700/50 group-hover:border-slate-600 text-slate-200 text-sm rounded-xl pl-4 pr-10 py-3 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all cursor-pointer shadow-sm"
               value={targetLang.code}
               onChange={(e) => setTargetLang(LANGUAGES.find(l => l.code === e.target.value) || LANGUAGES[0])}
             >
               {LANGUAGES.map(lang => (
                 <option key={lang.code} value={lang.code} className="bg-[#131b2c]">
                   {lang.flag} {lang.name}
                 </option>
               ))}
             </select>
             {/* Custom Chevron */}
             <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500 group-hover:text-slate-400 transition-colors">
                <ChevronDown size={14} />
             </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
            {logs.length === 0 && (
               <div className="h-full flex flex-col items-center justify-center text-slate-600 space-y-4 opacity-50">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-white/5 flex items-center justify-center">
                     <Volume2 size={24} className="text-slate-500" strokeWidth={1} />
                  </div>
                  <p className="text-xs font-medium tracking-wide">Waiting for speech...</p>
               </div>
            )}
            
            {logs.map((log) => (
              <div key={log.id} className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                 {/* Original */}
                 <div className="group relative pl-3.5 mb-3 opacity-80 hover:opacity-100 transition-opacity">
                    <div className="absolute left-0 top-1.5 bottom-1.5 w-[2px] bg-slate-800 rounded-full group-hover:bg-slate-600 transition-colors" />
                    <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1 font-semibold">Original</p>
                    <p className="text-xs text-slate-300 leading-relaxed font-light">{log.original}</p>
                 </div>

                 {/* Translation */}
                 <div className="bg-gradient-to-br from-[#151d2b] to-[#0f141f] border border-emerald-500/10 rounded-2xl p-4 shadow-lg relative overflow-hidden group hover:border-emerald-500/20 transition-all">
                    <div className="absolute top-0 right-0 p-3 opacity-0 group-hover:opacity-100 transition-opacity">
                       <span className="text-[9px] text-emerald-500/40 font-mono tracking-tighter uppercase">{log.lang}</span>
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                       <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
                       <span className="text-[10px] uppercase tracking-wider font-bold text-emerald-500">Agent</span>
                    </div>
                    <p className="text-sm text-slate-100 leading-relaxed font-medium">{log.translation}</p>
                 </div>
              </div>
            ))}
            
            {isSpeaking && (
                <div className="flex items-center justify-center gap-2 py-4">
                  <div className="flex gap-1">
                     <div className="w-1 h-3 bg-emerald-500/50 rounded-full animate-[pulse_0.6s_ease-in-out_infinite]" />
                     <div className="w-1 h-5 bg-emerald-500/50 rounded-full animate-[pulse_0.6s_ease-in-out_0.2s_infinite]" />
                     <div className="w-1 h-3 bg-emerald-500/50 rounded-full animate-[pulse_0.6s_ease-in-out_0.4s_infinite]" />
                  </div>
                  <span className="text-xs font-medium text-emerald-500/70 tracking-wide uppercase">Speaking</span>
                </div>
            )}
            <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
}
