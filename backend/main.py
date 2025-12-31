"""
UN Translator Backend - Nova Sonic Speech-to-Speech Translation API
"""

import base64
import json
import os
import uuid

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="UN Translator API",
    description="Real-time speech-to-speech translation using Amazon Nova Sonic",
    version="0.1.0"
)

# CORS configuration for frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Nova Sonic configuration
NOVA_SONIC_MODEL_ID = "amazon.nova-sonic-v1:0"
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")

# Language configuration
SUPPORTED_LANGUAGES = {
    "en-US": "English (US)",
    "es-US": "Spanish (US)",
    "fr-FR": "French",
    "de-DE": "German",
    "it-IT": "Italian",
    "pt-BR": "Portuguese (Brazil)",
}


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
    """Get supported languages."""
    return {"languages": SUPPORTED_LANGUAGES}


@app.websocket("/ws/translate")
async def websocket_translate(
    websocket: WebSocket,
    source: str = "en-US",
    target: str = "es-US"
):
    """WebSocket endpoint for real-time translation."""
    await websocket.accept()
    
    session_id = str(uuid.uuid4())
    
    # Send ready status
    await websocket.send_json({
        "type": "status",
        "message": "ready",
        "session_id": session_id,
        "source": source,
        "target": target
    })
    
    try:
        while True:
            message = await websocket.receive()
            
            if message["type"] == "websocket.disconnect":
                break
                
            if "text" in message:
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
                    await websocket.send_json({"type": "pong"})
                    
            elif "bytes" in message:
                # Audio data received - acknowledge it
                await websocket.send_json({
                    "type": "status",
                    "message": "processing",
                    "bytes_received": len(message["bytes"])
                })
                
    except WebSocketDisconnect:
        pass
    except Exception as e:
        await websocket.send_json({
            "type": "error",
            "message": str(e)
        })


@app.websocket("/ws/echo")
async def websocket_echo(websocket: WebSocket):
    """Echo endpoint for testing."""
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
                await websocket.send_bytes(message["bytes"])
            elif "text" in message:
                await websocket.send_text(message["text"])
                
    except WebSocketDisconnect:
        pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
