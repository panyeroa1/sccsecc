'use client';

import React from 'react';
import sharedStyles from '@/styles/Eburon.module.css';

export const OrbitIcon = ({ size = 20 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 48 48"
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    <circle cx="20" cy="24" r="10" stroke="currentColor" strokeWidth="2" />
    <path d="M6 28c7-6 21-9 36-5" stroke="currentColor" strokeWidth="2" opacity="0.7" />
    <circle cx="36" cy="14" r="3" fill="currentColor" opacity="0.7" />
  </svg>
);

interface OrbitTranslatorVerticalProps {
    roomCode?: string;
    userId?: string;
    onLiveTextChange?: any;
    audioDevices?: any;
    selectedDeviceId?: any;
    onDeviceIdChange?: any;
    onListeningChange?: any;
    deepgram?: any;
    meetingId?: any;
}

export function OrbitTranslatorVertical(props: OrbitTranslatorVerticalProps) {
  return (
    <div
      className={sharedStyles.sidebarPanel}
      style={{ padding: 0, overflow: 'hidden', height: '100%', flex: 1, minHeight: 0 }}
    >
      <iframe 
        src="/transcribe.html"
        className="w-full h-full border-0"
        style={{ display: 'block', width: '100%', height: '100%' }}
        allow="microphone; autoplay; clipboard-read; clipboard-write; fullscreen; display-capture"
        title="Orbit Translator"
      />
    </div>
  );
}
