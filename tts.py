import asyncio
 
import edge_tts
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
 
router = APIRouter()
 
# A natural male Indian-English voice. Other options:
# "en-US-GuyNeural", "en-GB-RyanNeural", "en-IN-PrabhatNeural"
VOICE = "en-IN-PrabhatNeural"
 
 
class TTSRequest(BaseModel):
    text: str
    slow: bool = False
 
 
async def make_audio(text: str, rate: str) -> bytes:
    communicate = edge_tts.Communicate(text, VOICE, rate=rate)
    audio = bytearray()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio.extend(chunk["data"])
    return bytes(audio)
 
 
@router.post("/tts")
async def tts(req: TTSRequest):
    text = req.text.strip()[:600]
    if not text:
        raise HTTPException(status_code=400, detail="No text")
    rate = "-12%" if req.slow else "+0%"
    try:
        audio = await asyncio.wait_for(make_audio(text, rate), timeout=8)
    except Exception:
        raise HTTPException(status_code=503, detail="Voice unavailable")
    if not audio:
        raise HTTPException(status_code=503, detail="Voice unavailable")
    return Response(content=audio, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})
 