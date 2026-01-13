import { dbClient as supabase } from './dbClient';
import { RoomState } from '../types';

export async function getRoomState(meetingId: string): Promise<RoomState> {
  const { data, error } = await supabase
    .from('meetings')
    .select('*')
    .eq('meeting_id', meetingId)
    .maybeSingle();

  if (error) {
    console.error('Error fetching meeting state:', error);
    return { hostId: null, activeSpeaker: null, isFloorLocked: false, conversationMode: 'manual', raiseHandQueue: [], lockVersion: 0 };
  }

  if (!data) return { hostId: null, activeSpeaker: null, isFloorLocked: false, conversationMode: 'manual', raiseHandQueue: [], lockVersion: 0 };

  return {
    hostId: data.host_id || null,
    isFloorLocked: data.is_floor_locked || false,
    conversationMode: data.conversation_mode || 'manual',
    activeSpeaker: data.active_speaker_id ? {
      userId: data.active_speaker_id,
      userName: 'Speaker', // TODO: fetch name or store it
      sessionId: 'session',
      since: Date.now()
    } : null,
    raiseHandQueue: [],
    lockVersion: 0
  };
}

export function subscribeToRoom(meetingId: string, callback: (state: RoomState) => void) {
  // Fetch initial state immediately
  getRoomState(meetingId).then(state => callback(state));

  const channel = supabase.channel(`room:${meetingId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'meetings', filter: `meeting_id=eq.${meetingId}` },
      async (payload: any) => {
        const newRow = payload.new;
        if (newRow) {
          // If we have a speaker ID, we ideally want their name. for now callback with generic
          callback({
            hostId: newRow.host_id || null,
            isFloorLocked: newRow.is_floor_locked || false,
            conversationMode: newRow.conversation_mode || 'manual',
            activeSpeaker: newRow.active_speaker_id ? {
              userId: newRow.active_speaker_id,
              userName: 'Speaker',
              sessionId: 'live',
              since: Date.now()
            } : null,
            raiseHandQueue: [],
            lockVersion: Date.now()
          });
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export async function ensureMeetingRow(meetingId: string) {
  const { data: existing } = await supabase
    .from('meetings')
    .select('meeting_id')
    .eq('meeting_id', meetingId)
    .maybeSingle();

  if (!existing) {
    await supabase.from('meetings').insert({ meeting_id: meetingId });
  }
}

export async function tryAcquireSpeaker(meetingId: string, userId: string, force: boolean = false): Promise<boolean> {
  await ensureMeetingRow(meetingId);

  // Optimistic locking: Update if NULL OR if I am already the speaker
  let query = supabase
    .from('meetings')
    .update({ active_speaker_id: userId })
    .eq('meeting_id', meetingId);

  if (!force) {
    query = query.or(`active_speaker_id.is.null,active_speaker_id.eq.${userId}`);
  }

  const { error, data } = await query.select();

  return !error && data && data.length > 0;
}

export async function releaseSpeaker(meetingId: string, userId: string) {
  // Silent release for both possible columns
  try {
    await supabase
      .from('meetings')
      .update({ active_speaker_id: null, is_speaking: false } as any)
      .eq('meeting_id', meetingId)
      .eq('active_speaker_id', userId);
  } catch (e) { }
}

export async function claimHost(meetingId: string, userId: string) {
  await ensureMeetingRow(meetingId);
  await supabase
    .from('meetings')
    .update({ host_id: userId })
    .eq('meeting_id', meetingId)
    .is('host_id', null);
}

export async function toggleFloorLock(meetingId: string, locked: boolean) {
  await supabase
    .from('meetings')
    .update({ is_floor_locked: locked })
    .eq('meeting_id', meetingId);
}

export async function setConversationMode(meetingId: string, mode: 'manual' | 'round-robin') {
  await supabase
    .from('meetings')
    .update({ conversation_mode: mode })
    .eq('meeting_id', meetingId);
}

export async function raiseHand(userId: string, userName: string) {
  // Not implemented in DB yet
}

export function lowerHand(userId: string) {
  // Not implemented in DB yet
}
