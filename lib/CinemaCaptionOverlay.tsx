'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useDeepgramTranscription } from './useDeepgramTranscription';

const overlayStyles = {
  captionBar: {
    position: 'fixed' as 'fixed',
    bottom: 80, // Position above the control bar
    left: 0,
    width: '100%',
    height: '50px',
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    borderTop: '1px solid rgba(255, 255, 255, 0.1)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 40px',
    zIndex: 999,
  },
  transcriptText: {
    fontSize: '14px',
    color: '#ffffff',
    fontWeight: 500,
    textAlign: 'center' as 'center',
    whiteSpace: 'nowrap' as 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    width: '100%',
    textShadow: '0px 1px 2px rgba(0,0,0,0.8)',
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
    
    const {
        isListening,
        transcript,
        interimTranscript,
    } = useDeepgramTranscription({
        model: 'nova-2',
        language: 'en',
        onTranscript: (res) => {
            if (res.isFinal) {
                onTranscriptSegment({ text: res.transcript, language: 'en', isFinal: true });
            }
        }
    });

    // Auto-clear logic when text overflows
    useEffect(() => {
        const fullText = `${transcript} ${interimTranscript}`.trim();
        
        if (captionRef.current && fullText) {
            const element = captionRef.current;
            const isOverflowing = element.scrollWidth > element.clientWidth;
            
            if (isOverflowing && transcript) {
                setIsFading(true);
                setTimeout(() => {
                    setDisplayText('');
                    setIsFading(false);
                }, 300);
            } else if (!isFading) {
                setDisplayText(fullText);
            }
        } else if (!fullText && !isFading) {
            setDisplayText('');
        }
    }, [transcript, interimTranscript, isFading]);

    return (
        <div style={overlayStyles.captionBar}>
            <div 
                ref={captionRef}
                style={{
                    ...overlayStyles.transcriptText,
                    opacity: isFading ? 0 : 1,
                    transition: 'opacity 0.3s ease-out'
                }}
            >
                {displayText || (isListening && <span style={{color: '#666', fontSize: '14px'}}>Listening...</span>)}
            </div>
        </div>
    );
}
