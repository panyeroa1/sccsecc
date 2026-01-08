'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useDeepgramTranscription } from './useDeepgramTranscription';
import styles from '@/styles/Eburon.module.css'; // Reusing some base styles or inline

// Styles specific to this overlay (could be moved to module)
const overlayStyles = {
  controlPill: {
    backgroundColor: '#2e7d32', // Forest Green
    borderRadius: '50px',
    display: 'flex',
    alignItems: 'center',
    padding: '5px 8px',
    boxShadow: '0 4px 15px rgba(0, 255, 0, 0.3)',
    position: 'absolute' as 'absolute',
    userSelect: 'none' as 'none',
    border: '1px solid #4caf50',
    cursor: 'grab',
    zIndex: 1000,
    transition: 'box-shadow 0.2s',
  },
  pillSection: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 15px',
    cursor: 'pointer',
    borderRadius: '30px',
    gap: '8px',
    color: '#ffffff',
    fontWeight: 700,
    fontSize: '13px',
  },
  divider: {
    width: '1px',
    height: '20px',
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    margin: '0 2px',
  },
  captionBar: {
    position: 'fixed' as 'fixed',
    bottom: 0,
    left: 0,
    width: '100%',
    height: '80px',
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    borderTop: '1px solid #333',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 40px',
    zIndex: 999,
  },
  transcriptText: {
    fontSize: '24px',
    color: '#ffffff',
    fontWeight: 500,
    textAlign: 'center' as 'center',
    whiteSpace: 'nowrap' as 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    width: '100%',
    textShadow: '0px 2px 4px rgba(0,0,0,0.8)',
  },
  interim: {
    color: '#aaa',
    fontStyle: 'italic' as 'italic',
  }
};

interface CinemaCaptionOverlayProps {
    onTranscriptSegment: (segment: { text: string; language: string; isFinal: boolean }) => void;
    defaultDeviceId?: string;
}

export function CinemaCaptionOverlay({ onTranscriptSegment, defaultDeviceId }: CinemaCaptionOverlayProps) {
    const [position, setPosition] = useState({ x: 50, y: 50 });
    const [isDragging, setIsDragging] = useState(false);
    const dragOffset = useRef({ x: 0, y: 0 });
    
    // Transcription Hook
    const {
        isListening,
        transcript,
        interimTranscript,
        startListening,
        stopListening,
        error
    } = useDeepgramTranscription({
        model: 'nova-2',
        language: 'en',
        onTranscript: (res) => {
            if (res.isFinal) {
                onTranscriptSegment({ text: res.transcript, language: 'en', isFinal: true });
            }
        }
    });

    const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [selectedDeviceId, setSelectedDeviceId] = useState<string>(defaultDeviceId || '');

    // Draggable Logic
    const handleMouseDown = (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('.dropdown-trigger') || (e.target as HTMLElement).closest('.dropdown-menu')) return;
        
        setIsDragging(true);
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        dragOffset.current = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    };

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (isDragging) {
            setPosition({
                x: e.clientX - dragOffset.current.x,
                y: e.clientY - dragOffset.current.y
            });
        }
    }, [isDragging]);

    const handleMouseUp = useCallback(() => {
        setIsDragging(false);
    }, []);

    useEffect(() => {
        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        } else {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        }
    }, [isDragging, handleMouseMove, handleMouseUp]);

    // Device Enumeration
    useEffect(() => {
        navigator.mediaDevices.enumerateDevices().then(devs => {
            setDevices(devs.filter(d => d.kind === 'audioinput'));
        });
    }, []);

    const toggleListening = () => {
        if (isListening) {
            stopListening();
        } else {
            startListening(selectedDeviceId);
        }
    };

    return (
        <>
            {/* Draggable Pill */}
            <div 
                style={{
                    ...overlayStyles.controlPill,
                    left: position.x,
                    top: position.y,
                    cursor: isDragging ? 'grabbing' : 'grab',
                }}
                onMouseDown={handleMouseDown}
            >
                {/* SPEAK Button */}
                <div 
                    style={{...overlayStyles.pillSection, backgroundColor: isListening ? '#d32f2f' : 'transparent'}}
                    onClick={toggleListening}
                >
                    <span>{isListening ? 'STOP' : 'SPEAK'}</span>
                </div>

                <div style={overlayStyles.divider} />

                {/* Dropdown Trigger */}
                <div 
                    className="dropdown-trigger"
                    style={overlayStyles.pillSection}
                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                >
                    <span>MIC</span>
                    <span>▼</span>
                </div>

                {isMenuOpen && (
                    <div className="dropdown-menu" style={{
                        position: 'absolute',
                        top: '115%',
                        left: 0,
                        backgroundColor: '#1e1e1e',
                        borderRadius: '12px',
                        border: '1px solid #444',
                        padding: '5px',
                        minWidth: '220px',
                        color: 'white'
                    }}>
                        {devices.map(d => (
                            <div 
                                key={d.deviceId}
                                style={{
                                    padding: '10px',
                                    cursor: 'pointer',
                                    fontSize: '13px',
                                    borderBottom: '1px solid #333'
                                }}
                                onClick={() => {
                                    setSelectedDeviceId(d.deviceId);
                                    setIsMenuOpen(false);
                                    if (isListening) {
                                        stopListening();
                                        setTimeout(() => startListening(d.deviceId), 200);
                                    }
                                }}
                            >
                                {d.label || `Mic ${d.deviceId.slice(0,5)}`}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Bottom Caption Bar */}
            <div style={overlayStyles.captionBar}>
                <div style={overlayStyles.transcriptText}>
                    {transcript} <span style={overlayStyles.interim}>{interimTranscript}</span>
                    {!transcript && !interimTranscript && isListening && (
                        <span style={{color: '#666', fontSize: '18px'}}>Listening...</span>
                    )}
                </div>
            </div>
        </>
    );
}
