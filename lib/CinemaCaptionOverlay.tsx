'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useDeepgramTranscription } from './useDeepgramTranscription';
import { useRoomContext, useLocalParticipant } from '@livekit/components-react';
import { Track } from 'livekit-client';

const overlayStyles = {
  captionBar: {
    position: 'fixed' as 'fixed',
    bottom: 80, // Position above the control bar
    left: '20px',
    right: '20px',
    width: 'auto',
    height: '50px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    padding: '0 20px',
    zIndex: 999,
  },
  transcriptText: {
    fontSize: '14px',
    color: '#66ff00',
    fontWeight: 600,
    textAlign: 'left' as 'left',
    whiteSpace: 'nowrap' as 'nowrap',
    overflow: 'visible',
    width: '100%',
    textShadow: '0px 2px 4px rgba(0,0,0,0.9)',
    animation: 'slideIn 0.3s ease-out',
  },
};

interface CinemaCaptionOverlayProps {
    onTranscriptSegment: (segment: { text: string; language: string; isFinal: boolean }) => void;
    defaultDeviceId?: string;
}

export function CinemaCaptionOverlay({ onTranscriptSegment, defaultDeviceId }: CinemaCaptionOverlayProps) {
    const [displayText, setDisplayText] = useState('');
    const [isFading, setIsFading] = useState(false);
    const captionRef = useRef<HTMLDivElement>(null);
    const { localParticipant } = useLocalParticipant();
    const [visibleWords, setVisibleWords] = useState<string[]>([]);
    const [currentText, setCurrentText] = useState('');
    
    const {
        isListening,
        transcript,
        interimTranscript,
        startListening,
        stopListening
    } = useDeepgramTranscription({
        model: 'nova-2',
        language: 'en',
        onTranscript: (res) => {
            if (res.isFinal) {
                onTranscriptSegment({ text: res.transcript, language: 'en', isFinal: true });
            }
        }
    });

    // Auto-start/stop transcription based on mic state
    useEffect(() => {
        if (!localParticipant) return;

        const micPub = localParticipant.getTrackPublication(Track.Source.Microphone);
        const isMicEnabled = !micPub?.isMuted && micPub?.track !== undefined;

        if (isMicEnabled && !isListening) {
            startListening(defaultDeviceId);
        } else if (!isMicEnabled && isListening) {
            stopListening();
        }
    }, [localParticipant, defaultDeviceId, isListening, startListening, stopListening]);

    // Word-by-word streaming effect
    useEffect(() => {
        const fullText = `${transcript} ${interimTranscript}`.trim();
        
        if (fullText !== currentText) {
            setCurrentText(fullText);
            const words = fullText.split(' ').filter(w => w.length > 0);
            
            // Reset and stream words
            setVisibleWords([]);
            words.forEach((word, index) => {
                setTimeout(() => {
                    setVisibleWords(prev => [...prev, word]);
                }, index * 150); // 150ms delay between words
            });
        }
    }, [transcript, interimTranscript, currentText]);

    // Auto-clear logic when text overflows
    useEffect(() => {
        if (captionRef.current && visibleWords.length > 0) {
            const element = captionRef.current;
            const isOverflowing = element.scrollWidth > element.clientWidth;
            
            if (isOverflowing && transcript) {
                setIsFading(true);
                setTimeout(() => {
                    setVisibleWords([]);
                    setCurrentText('');
                    setIsFading(false);
                }, 300);
            }
        }
    }, [visibleWords, transcript]);

    return (
        <>
            <style jsx>{`
                @keyframes wordFadeIn {
                    from {
                        opacity: 0;
                        transform: translateX(-10px);
                    }
                    to {
                        opacity: 1;
                        transform: translateX(0);
                    }
                }
                .word {
                    display: inline-block;
                    margin-right: 0.3em;
                    animation: wordFadeIn 0.2s ease-out;
                }
            `}</style>
            <div style={overlayStyles.captionBar}>
                <div 
                    ref={captionRef}
                    style={{
                        ...overlayStyles.transcriptText,
                        opacity: isFading ? 0 : 1,
                        transition: 'opacity 0.3s ease-out'
                    }}
                >
                    {visibleWords.length > 0 ? (
                        visibleWords.map((word, index) => (
                            <span key={`${word}-${index}`} className="word">{word}</span>
                        ))
                    ) : (
                        isListening && <span style={{color: '#66ff00', fontSize: '14px', fontWeight: 600}}>🎤 Listening...</span>
                    )}
                </div>
            </div>
        </>
    );
}
