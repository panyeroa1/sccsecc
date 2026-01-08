'use client';

import React from 'react';
import styles from '@/styles/PreJoin.module.css';

export type TranscriptionProvider = 'deepgram' | 'gemini' | 'assemblyai' | 'webspeech';

interface TranscriptionSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  
  // Transcription Data
  transcript: string;
  interimTranscript: string;
  isListening: boolean;
  
  // Provider Selection
  provider: TranscriptionProvider;
  onProviderChange: (provider: TranscriptionProvider) => void;
  
  // Controls
  onToggleListening: () => void;
  
  // Tab/Stream Data
  tabStream: MediaStream | null;
  onToggleTabAudio: () => void;
  
  isRadioStreaming: boolean;
  onToggleRadio: () => void;
  
  // Badges/Status
  isGeminiActive: boolean;
}

export function TranscriptionSidebar({
  isOpen,
  onClose,
  transcript,
  interimTranscript,
  isListening,
  provider,
  onProviderChange,
  onToggleListening,
  tabStream,
  onToggleTabAudio,
  isRadioStreaming,
  onToggleRadio,
  isGeminiActive
}: TranscriptionSidebarProps) {
  if (!isOpen) return null;

  return (
    <div className={styles.transcriptionSidebar} style={{zIndex: 50, right: 80, top: 20, height: 'calc(100% - 100px)', position: 'absolute'}}>
      <div className={styles.sidebarHeader}>
        <h3>Live Transcription</h3>
        <button className={styles.closeSidebarBtn} onClick={onClose}>×</button>
      </div>
      
      {/* Provider Selector */}
      <div style={{padding: '0 1rem 1rem'}}>
          <label style={{display:'block', marginBottom: 5, fontSize: '0.85rem', color: '#888'}}>Model Provider</label>
          <select 
            value={provider} 
            onChange={(e) => onProviderChange(e.target.value as TranscriptionProvider)}
            className={styles.deviceSelect}
            style={{width: '100%', marginBottom: '1rem'}}
            aria-label="Select Transcription Model"
          >
              <option value="deepgram">Deepgram (Nova-2)</option>
              <option value="gemini">Gemini Live (Multimodal)</option>
              <option value="webspeech">Web Speech API (Free)</option>
              <option value="assemblyai">AssemblyAI (Realtime)</option>
          </select>
      </div>

      <div className={styles.transcriptionContent}>
        {transcript ? (
           <p className={styles.finalText}>{transcript}</p>
        ) : (
           <p className={styles.placeholderText}>
             {isListening ? "Listening..." : "Start transcription to see text here."}
           </p>
        )}
        {interimTranscript && <p className={styles.interimText}>{interimTranscript}</p>}
      </div>

       <div className={styles.captionSection}>
         <button
            type="button"
            className={`${styles.captionToggleBtn} ${isListening ? styles.captionToggleActive : ''}`}
            onClick={onToggleListening}
         >
           <span>{isListening ? 'Stop Listening' : 'Start Listening'}</span>
         </button>
         
         <button
            type="button"
            className={`${styles.captionToggleBtn} ${tabStream ? styles.captionToggleActive : ''}`}
            onClick={onToggleTabAudio}
            disabled={provider === 'webspeech'} // WebSpeech usually only takes Mic
            title={provider === 'webspeech' ? "Not supported with Web Speech" : "Share Tab Audio"}
         >
           <span>{tabStream ? 'Stop Tab Audio' : 'Share Tab Audio'}</span>
         </button>

         <button
            type="button"
            className={`${styles.captionToggleBtn} ${isRadioStreaming ? styles.captionToggleActive : ''}`}
            onClick={onToggleRadio}
            disabled={provider === 'webspeech'}
            title={provider === 'webspeech' ? "Not supported with Web Speech" : "Test Radio"}
         >
           <span>{isRadioStreaming ? 'Stop Radio' : 'Test Radio'}</span>
         </button>
         
         {isGeminiActive && <span className={styles.geminiBadge}>Gemini Active</span>}
         {tabStream && <span className={styles.geminiBadge} style={{background: '#10b981'}}>Tab Audio</span>}
      </div>
    </div>
  );
}
