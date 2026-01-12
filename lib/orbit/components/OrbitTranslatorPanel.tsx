'use client';

import React from 'react';
import { useOrbitTranslator } from '@/lib/orbit/hooks/useOrbitTranslator';
import { LANGUAGES } from '@/lib/orbit/types';
import sharedStyles from '@/styles/Eburon.module.css';

// Re-export OrbitIcon for backwards compatibility
export { OrbitIcon } from './OrbitTranslatorVertical';

interface OrbitTranslatorPanelProps {
  roomCode?: string;
  userId?: string;
  isSourceSpeaker?: boolean;
  currentSpeakerId?: string | null;
  currentSpeakerName?: string | null;
  onRequestFloor?: () => Promise<boolean>;
  onReleaseFloor?: () => Promise<void>;
  // Global translation state
  isListening: boolean;
  setIsListening: (enabled: boolean) => void;
  targetLanguage: string;
  setTargetLanguage: (lang: string) => void;
  // Inbound translations
  incomingTranslations: Array<{ participantId: string; text: string; timestamp: number }>;
  // State
  isProcessing: boolean;
  error: string | null;
  // Transcription data passed from parent (if source speaker)
  transcript?: string;
  isFinal?: boolean;
}

export function OrbitTranslatorPanel({ 
  roomCode, 
  userId,
  isSourceSpeaker = false,
  currentSpeakerId,
  currentSpeakerName,
  onRequestFloor,
  onReleaseFloor,
  isListening,
  setIsListening,
  targetLanguage,
  setTargetLanguage,
  incomingTranslations,
  isProcessing,
  error,
  transcript,
  isFinal
}: OrbitTranslatorPanelProps) {
  const [isRequestingFloor, setIsRequestingFloor] = React.useState(false);

  // Toggle listening mode
  const handleListenToggle = React.useCallback(() => {
    setIsListening(!isListening);
  }, [isListening, setIsListening]);

  // Start speaking (request floor)
  const handleStartSpeaking = React.useCallback(async () => {
    if (!onRequestFloor) return;
    setIsRequestingFloor(true);
    try {
      const success = await onRequestFloor();
      if (success) {
        setIsListening(true);
      }
    } finally {
      setIsRequestingFloor(false);
    }
  }, [onRequestFloor]);

  // Stop speaking (release floor)
  const handleStopSpeaking = React.useCallback(async () => {
    setIsListening(false);
    if (onReleaseFloor) {
      await onReleaseFloor();
    }
  }, [onReleaseFloor]);


  const floorHolderName = currentSpeakerName || currentSpeakerId?.split('__')[0] || 'Unknown';
  const isSomeoneElseSpeaking = !!currentSpeakerId && currentSpeakerId !== userId;

  return (
    <div className={sharedStyles.sidebarPanel}>
      <div className={sharedStyles.sidebarHeader}>
        <div className={sharedStyles.sidebarHeaderText}>
          <h3>Success Class Translator</h3>
          <span className={sharedStyles.sidebarHeaderMeta}>
            {isSourceSpeaker ? 'You have the floor' : 'Per-listener translation'}
          </span>
        </div>
      </div>
      
      <div className={sharedStyles.sidebarBody} style={{ padding: '12px' }}>
        {/* Floor Control Section */}
        <div style={{
          padding: '12px',
          background: isSourceSpeaker 
            ? 'rgba(50, 205, 50, 0.15)' 
            : isSomeoneElseSpeaking 
              ? 'rgba(255, 200, 50, 0.1)' 
              : 'rgba(255,255,255,0.03)',
          borderRadius: '8px',
          border: `1px solid ${isSourceSpeaker ? 'rgba(50, 205, 50, 0.3)' : 'rgba(255,255,255,0.1)'}`,
          marginBottom: '12px'
        }}>
          <div style={{ 
            fontSize: '10px', 
            opacity: 0.7, 
            marginBottom: '8px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          }}>
            Translation Floor
          </div>
          
          {isSourceSpeaker ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: '#22c55e',
                boxShadow: '0 0 8px rgba(34, 197, 94, 0.5)'
              }} />
              <span style={{ flex: 1, fontSize: '13px' }}>You are speaking</span>
              <button
                onClick={handleStopSpeaking}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  background: 'rgba(255, 100, 100, 0.2)',
                  border: '1px solid rgba(255, 100, 100, 0.3)',
                  color: '#ff6b6b',
                  fontSize: '11px',
                  cursor: 'pointer'
                }}
              >
                Release Floor
              </button>
            </div>
          ) : isSomeoneElseSpeaking ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: '#fbbf24'
              }} />
              <span style={{ fontSize: '13px' }}>{floorHolderName} is speaking</span>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.2)'
              }} />
              <span style={{ flex: 1, fontSize: '13px', opacity: 0.7 }}>No one speaking</span>
              {onRequestFloor && (
                <button
                  onClick={handleStartSpeaking}
                  disabled={isRequestingFloor}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    background: 'rgba(50, 205, 50, 0.2)',
                    border: '1px solid rgba(50, 205, 50, 0.3)',
                    color: '#32cd32',
                    fontSize: '11px',
                    cursor: isRequestingFloor ? 'wait' : 'pointer',
                    opacity: isRequestingFloor ? 0.6 : 1
                  }}
                >
                  {isRequestingFloor ? 'Requesting...' : 'Take Floor'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Listen Toggle (for receiving translations) */}
        <div className={sharedStyles.sidebarCard}>
          <div className={sharedStyles.sidebarCardText}>
            <span className={sharedStyles.sidebarCardLabel}>
              {isListening ? 'Receiving Translations' : 'Translation Receiver Off'}
            </span>
            <span className={sharedStyles.sidebarCardHint}>
              {isListening 
                ? 'Hearing translated audio from speakers' 
                : 'Enable to hear translations'}
            </span>
          </div>
          <label className={sharedStyles.sidebarSwitch}>
            <input
              type="checkbox"
              checked={isListening}
              onChange={handleListenToggle}
              aria-label="Enable Translation Receiver"
            />
            <span className={sharedStyles.sidebarSwitchTrack}>
              <span className={sharedStyles.sidebarSwitchThumb} />
            </span>
          </label>
        </div>


        {/* Current Transcript (only when source speaker) */}
        {isSourceSpeaker && isListening && transcript && (
          <div style={{
            marginTop: '16px',
            padding: '12px',
            background: 'rgba(50, 205, 50, 0.1)',
            borderRadius: '8px',
            border: '1px solid rgba(50, 205, 50, 0.2)'
          }}>
            <div style={{ 
              fontSize: '10px', 
              opacity: 0.6, 
              marginBottom: '4px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}>
              You said:
            </div>
            <div style={{ 
              fontSize: '14px',
              lineHeight: 1.4,
              color: isFinal ? '#fff' : 'rgba(255,255,255,0.6)',
              fontStyle: isFinal ? 'normal' : 'italic'
            }}>
              {transcript}
            </div>
          </div>
        )}

        {/* Incoming Translations */}
        {incomingTranslations.length > 0 && (
          <div style={{ marginTop: '16px' }}>
            <div style={{ 
              fontSize: '10px', 
              opacity: 0.6, 
              marginBottom: '8px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}>
              Translated Messages
            </div>
            <div style={{ 
              maxHeight: '200px', 
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}>
              {incomingTranslations.slice(-5).map((msg: { participantId: string; text: string; timestamp: number }, i: number) => (
                <div 
                  key={msg.timestamp + i}
                  style={{
                    padding: '10px 12px',
                    background: 'rgba(255,255,255,0.05)',
                    borderRadius: '8px',
                    fontSize: '13px'
                  }}
                >
                  <div style={{ 
                    fontSize: '10px', 
                    opacity: 0.5, 
                    marginBottom: '4px' 
                  }}>
                    {msg.participantId.split('__')[0]}
                  </div>
                  {msg.text}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Status */}
        <div style={{ 
          marginTop: '16px', 
          display: 'flex', 
          alignItems: 'center', 
          gap: '8px',
          fontSize: '11px',
          opacity: 0.6
        }}>
          <div style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: isListening 
              ? (isProcessing ? '#fbbf24' : '#22c55e')
              : 'rgba(255,255,255,0.2)'
          }} />
          <span>
            {error 
              ? `Error: ${error}`
              : isListening 
                ? (isProcessing ? 'Processing...' : 'Ready')
                : 'Idle'
            }
          </span>
        </div>
      </div>
    </div>
  );
}

