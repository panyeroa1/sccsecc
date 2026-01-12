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

    async def _recognize(self, buffer, *, language=None):
        # buffer is a list of PcmData
        # For simplicity in this v1, we concatenate and process
        # Real-time streaming would require a more complex chunked approach
        import numpy as np
        audio = np.concatenate([np.frombuffer(p.data, dtype=np.int16) for p in buffer])
        audio = audio.astype(np.float32) / 32768.0
        
        segments, _ = self._model.transcribe(audio, language=language)
        text = " ".join([s.text for s in segments])
        
        return stt.SpeechEvent(
            type=stt.SpeechEventType.FINAL_TRANSCRIPT,
            alternatives=[stt.SpeechData(text=text, language=language or "en")]
        )

server = AgentServer()

def prewarm(proc: JobProcess):
    proc.userdata["vad"] = silero.VAD.load()

server.setup_fnc = prewarm

@server.rtc_session()
async def entrypoint(ctx: JobContext):
    logger.info(f"Connecting to room: {ctx.room.name}")
    
    # Using Cartesia for ultra-low latency TTS
    tts = cartesia.TTS()
    
    # Using Gemini for high-quality translation
    llm = google.LLM(model="gemini-1.5-flash")

    # The VoiceAssistant manages the orchestration of STT, LLM, and TTS
    assistant = VoiceAssistant(
        vad=ctx.proc.userdata["vad"],
        stt=FasterWhisperSTT(),
        llm=llm,
        tts=tts,
        chat_ctx=openai.ChatContext().append(
            role="system",
            text="""
                You are a professional translator for Eburon. 
                You translate the user's speech from English to French.
                Respond only with the translation.
            """
        ),
    )

    assistant.start(ctx.room)
    await ctx.connect()
    
    # In a translator pipeline, we usually want the agent to be 
    # passive until spoken to, which VoiceAssistant handles by default.

if __name__ == "__main__":
    from livekit.agents.voice_assistant import VoiceAssistant
    cli.run_app(server)
