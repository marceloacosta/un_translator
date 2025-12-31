"""
UN Translator Backend - Nova Sonic Speech-to-Speech Translation API

This FastAPI server provides WebSocket endpoints for real-time translation
using Amazon Nova Sonic's bidirectional streaming API.
"""

import asyncio
import base64
import json
import os
import uuid
from typing import Optional

import boto3
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

app = FastAPI(
    title="UN Translator API",
    description="Real-time speech-to-speech translation using Amazon Nova Sonic",
    version="0.1.0"
)

# CORS configuration for frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Update with your Amplify domain in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Nova Sonic configuration
NOVA_SONIC_MODEL_ID = "amazon.nova-sonic-v1:0"
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")

# Language configuration for translation
SUPPORTED_LANGUAGES = {
    "en-US": "English (US)",
    "es-US": "Spanish (US)", 
    "fr-FR": "French",
    "de-DE": "German",
    "it-IT": "Italian",
    "pt-BR": "Portuguese (Brazil)",
    "ja-JP": "Japanese",
    "ko-KR": "Korean",
    "zh-CN": "Chinese (Simplified)",
}


class NovaSonicTranslator:
    """
    Handles bidirectional streaming with Amazon Nova Sonic for real-time translation.
    """
    
    def __init__(self, source_lang: str = "en-US", target_lang: str = "es-US"):
        self.source_lang = source_lang
        self.target_lang = target_lang
        self.session_id = str(uuid.uuid4())
        self.is_active = False
        self.bedrock_client = None
        self.stream_response = None
        
    async def initialize(self):
        """Initialize the Bedrock client."""
        self.bedrock_client = boto3.client(
            'bedrock-runtime',
            region_name=AWS_REGION
        )
        self.is_active = True
        
    def create_session_start_event(self) -> dict:
        """Create the session start event for Nova Sonic."""
        return {
            "event": {
                "sessionStart": {
                    "inferenceConfiguration": {
                        "maxTokens": 1024,
                        "topP": 0.9,
                        "temperature": 0.7
                    }
                }
            }
        }
    
    def create_prompt_start_event(self) -> dict:
        """Create prompt start event with translation instructions."""
        prompt_id = str(uuid.uuid4())
        return {
            "event": {
                "promptStart": {
                    "promptName": prompt_id,
                    "textOutputConfiguration": {
                        "mediaType": "text/plain"
                    },
                    "audioOutputConfiguration": {
                        "mediaType": "audio/lpcm",
                        "sampleRateHertz": 24000,
                        "sampleSizeBits": 16,
                        "channelCount": 1
                    }
                }
            }
        }
    
    def create_system_prompt_event(self) -> dict:
        """Create system prompt for UN-style translation."""
        system_prompt = f"""You are a professional UN-style simultaneous interpreter. 
Your task is to translate speech from {SUPPORTED_LANGUAGES.get(self.source_lang, self.source_lang)} 
to {SUPPORTED_LANGUAGES.get(self.target_lang, self.target_lang)}.

Translation guidelines:
- Translate naturally and fluently, maintaining the speaker's intent and tone
- Use professional, diplomatic language appropriate for international settings
- Preserve meaning over literal word-for-word translation
- Speak clearly and at a natural pace
- Handle pauses and incomplete sentences gracefully
- If unsure about a term, use the most contextually appropriate translation

Begin translating the incoming speech immediately."""
        
        content_id = str(uuid.uuid4())
        return {
            "event": {
                "contentStart": {
                    "promptName": self.session_id,
                    "contentName": content_id,
                    "type": "TEXT",
                    "interactive": True,
                    "role": "SYSTEM",
                    "textInputConfiguration": {
                        "mediaType": "text/plain"
                    }
                }
            }
        }, {
            "event": {
                "textInput": {
                    "promptName": self.session_id,
                    "contentName": content_id,
                    "content": system_prompt
                }
            }
        }, {
            "event": {
                "contentEnd": {
                    "promptName": self.session_id,
                    "contentName": content_id
                }
            }
        }
    
    def create_audio_start_event(self) -> dict:
        """Create audio input start event."""
        content_id = str(uuid.uuid4())
        self.current_audio_content_id = content_id
        return {
            "event": {
                "contentStart": {
                    "promptName": self.session_id,
                    "contentName": content_id,
                    "type": "AUDIO",
                    "interactive": True,
                    "role": "USER",
                    "audioInputConfiguration": {
                        "mediaType": "audio/lpcm",
                        "sampleRateHertz": 16000,
                        "sampleSizeBits": 16,
                        "channelCount": 1
                    }
                }
            }
        }
    
    def create_audio_input_event(self, audio_bytes: bytes) -> dict:
        """Create audio input event with audio data."""
        return {
            "event": {
                "audioInput": {
                    "promptName": self.session_id,
                    "contentName": self.current_audio_content_id,
                    "content": base64.b64encode(audio_bytes).decode('utf-8')
                }
            }
        }
    
    def create_audio_end_event(self) -> dict:
        """Create audio input end event."""
        return {
            "event": {
                "contentEnd": {
                    "promptName": self.session_id,
                    "contentName": self.current_audio_content_id
                }
            }
        }
    
    async def close(self):
        """Clean up resources."""
        self.is_active = False
        if self.stream_response:
            try:
                await self.stream_response.close()
            except Exception:
                pass


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "status": "healthy",
        "service": "UN Translator API",
        "model": NOVA_SONIC_MODEL_ID
    }


@app.get("/health")
async def health():
    """Health check endpoint for App Runner."""
    return {"status": "healthy"}


@app.get("/languages")
async def get_languages():
    """Get supported languages for translation."""
    return {
        "languages": SUPPORTED_LANGUAGES
    }


@app.websocket("/ws/translate")
async def websocket_translate(
    websocket: WebSocket,
    source: str = "en-US",
    target: str = "es-US"
):
    """
    WebSocket endpoint for real-time translation.
    
    Client should send:
    - Audio chunks as binary data (16-bit PCM, 16kHz, mono)
    - JSON control messages: {"type": "start"}, {"type": "stop"}
    
    Server sends:
    - Translated audio as binary data (16-bit PCM, 24kHz, mono)
    - JSON status messages: {"type": "status", "message": "..."}
    - JSON transcript: {"type": "transcript", "text": "...", "role": "user|assistant"}
    """
    await websocket.accept()
    
    translator = NovaSonicTranslator(source_lang=source, target_lang=target)
    
    try:
        await translator.initialize()
        
        # Send ready status
        await websocket.send_json({
            "type": "status",
            "message": "ready",
            "session_id": translator.session_id,
            "source": source,
            "target": target
        })
        
        while True:
            try:
                # Receive message from client
                message = await websocket.receive()
                
                if message["type"] == "websocket.disconnect":
                    break
                    
                if "text" in message:
                    # Handle JSON control messages
                    data = json.loads(message["text"])
                    msg_type = data.get("type")
                    
                    if msg_type == "start":
                        await websocket.send_json({
                            "type": "status",
                            "message": "listening"
                        })
                    elif msg_type == "stop":
                        await websocket.send_json({
                            "type": "status",
                            "message": "stopped"
                        })
                    elif msg_type == "ping":
                        await websocket.send_json({
                            "type": "pong"
                        })
                        
                elif "bytes" in message:
                    # Handle audio data
                    audio_data = message["bytes"]
                    
                    # TODO: Stream audio to Nova Sonic and receive translation
                    # For now, echo back a status (implementation in next step)
                    await websocket.send_json({
                        "type": "status",
                        "message": "processing",
                        "bytes_received": len(audio_data)
                    })
                    
            except WebSocketDisconnect:
                break
            except json.JSONDecodeError:
                await websocket.send_json({
                    "type": "error",
                    "message": "Invalid JSON"
                })
                
    except Exception as e:
        await websocket.send_json({
            "type": "error",
            "message": str(e)
        })
    finally:
        await translator.close()


@app.websocket("/ws/echo")
async def websocket_echo(websocket: WebSocket):
    """
    Simple WebSocket echo endpoint for testing audio pipeline.
    Echoes back received audio data.
    """
    await websocket.accept()
    
    await websocket.send_json({
        "type": "status",
        "message": "echo_ready"
    })
    
    try:
        while True:
            message = await websocket.receive()
            
            if message["type"] == "websocket.disconnect":
                break
                
            if "bytes" in message:
                # Echo back the audio data
                await websocket.send_bytes(message["bytes"])
            elif "text" in message:
                await websocket.send_text(message["text"])
                
    except WebSocketDisconnect:
        pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

