import logging
import asyncio
from dotenv import load_dotenv
from livekit.agents import JobContext, JobProcess, AgentServer, cli, stt
from livekit.plugins import openai, silero, cartesia, google
from faster_whisper import WhisperModel

load_dotenv()

logger = logging.getLogger("eburon-advanced-translator")
logger.setLevel(logging.INFO)

# Custom Faster-Whisper STT implementation
class FasterWhisperSTT(stt.STT):
    def __init__(self):
        super().__init__(capabilities=stt.STTCapabilities(streaming=False))
        self._model = WhisperModel("base", device="cpu", compute_type="int8")
        self._language = None

    def set_language(self, language: str):
        self._language = language

    async def _recognize(self, buffer, *, language=None):
        import numpy as np
        # Use provided language or the one set on the engine
        target_lang = language or self._language
        
        audio = np.concatenate([np.frombuffer(p.data, dtype=np.int16) for p in buffer])
        audio = audio.astype(np.float32) / 32768.0
        
        logger.info(f"STT: Processing {len(audio)/16000:.2f}s of audio (lang={target_lang})")
        segments, _ = self._model.transcribe(audio, language=target_lang)
        text = " ".join([s.text for s in segments])
        
        if text.strip():
            logger.info(f"STT Result: {text}")
        
        return stt.SpeechEvent(
            type=stt.SpeechEventType.FINAL_TRANSCRIPT,
            alternatives=[stt.SpeechData(text=text, language=target_lang or "en")]
        )

server = AgentServer()

def prewarm(proc: JobProcess):
    proc.userdata["vad"] = silero.VAD.load()

server.setup_fnc = prewarm

@server.rtc_session()
async def entrypoint(ctx: JobContext):
    logger.info(f"Connecting to room: {ctx.room.name}")
    
    # Set agent identity for UI detection if not already set by LiveKit
    # (LiveKit handles identity via AgentJob, but we can log it)
    logger.info(f"Agent Identity: {ctx.room.local_participant.identity}")

    # Defaults
    src_lang_code = "en"
    tgt_lang_code = "fr"
    
    # Language name mapping for LLM
    LANG_NAMES = {
        "en": "English", "fr": "French", "es": "Spanish", "de": "German",
        "nl": "Dutch", "vls-BE": "West Flemish", "en-US": "English (US)",
        "en-GB": "English (UK)", "nl-BE": "Flemish (Belgium)"
    }

    def get_system_prompt(sl_code, tl_code):
        sl = LANG_NAMES.get(sl_code, sl_code)
        tl = LANG_NAMES.get(tl_code, tl_code)
        return f"""
            You are a professional real-time translator for Eburon. 
            You are translating a live conversation.
            
            TASK: Translate speech from {sl} to {tl}.
            
            RULES:
            1. Respond ONLY with the translated text.
            2. Do NOT add any notes, explanations, or meta-talk.
            3. If the input is unclear, translate your best guess.
            
            EMOTION & STYLE:
            Use SSML tags sparingly for natural expression:
            - <emotion value="excited" /> if the user sounds happy
            - <emotion value="serious" /> if the user is formal
        """

    # Using Cartesia Sonic-3 for advanced controls
    tts = cartesia.TTS(model="sonic-3-latest", voice="9c7e6604-52c6-424a-9f9f-2c4ad89f3bb9")
    
    # Using Gemini for high-quality translation
    llm = google.LLM(model="gemini-1.5-flash")

    chat_ctx = openai.ChatContext().append(role="system", text=get_system_prompt(src_lang_code, tgt_lang_code))
    
    stt_engine = FasterWhisperSTT()
    
    assistant = VoiceAssistant(
        vad=ctx.proc.userdata["vad"],
        stt=stt_engine,
        llm=llm,
        tts=tts,
        chat_ctx=chat_ctx,
        allow_interruptions=True, # VOX: Allow user to interrupt translation
    )

    def update_config(config):
        nonlocal src_lang_code, tgt_lang_code
        sl = config.get("source_language", "en")
        tl = config.get("target_language", "fr")
        if sl != src_lang_code or tl != tgt_lang_code:
            logger.info(f"🔄 Language change: {sl} -> {tl}")
            src_lang_code = sl
            tgt_lang_code = tl
            assistant.chat_ctx.messages[0].text = get_system_prompt(sl, tl)
            
            # Whisper mapping
            whisper_lang = sl.split("-")[0] if "-" in sl else sl
            if sl == "vls-BE": whisper_lang = "nl"
            stt_engine.set_language(whisper_lang)
            logger.info(f"STT: Language set to {whisper_lang}")

    @ctx.room.on("participant_metadata_changed")
    def on_participant_metadata(participant, metadata):
        import json
        try:
            data = json.loads(metadata)
            if "translation_config" in data:
                update_config(data["translation_config"])
            if "voice_settings" in data:
                settings = data["voice_settings"]
                if hasattr(tts, "_opts"):
                    if "speed" in settings: tts._opts.speed = float(settings["speed"])
                    if "volume" in settings: tts._opts.volume = float(settings["volume"])
                    if "emotion" in settings: tts._opts.emotion = settings["emotion"]
        except Exception as e:
            logger.error(f"Error parsing metadata: {e}")

    assistant.start(ctx.room)
    await ctx.connect()
    
    # In a translator pipeline, we usually want the agent to be 
    # passive until spoken to, which VoiceAssistant handles by default.

if __name__ == "__main__":
    from livekit.agents.voice_assistant import VoiceAssistant
    cli.run_app(server)
