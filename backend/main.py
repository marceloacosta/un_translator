"""
UN Translator Backend - Nova Sonic Speech-to-Speech Translation API
"""

import asyncio
import base64
import json
import os
import uuid

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware

from aws_sdk_bedrock_runtime.client import BedrockRuntimeClient, InvokeModelWithBidirectionalStreamOperationInput
from aws_sdk_bedrock_runtime.models import InvokeModelWithBidirectionalStreamInputChunk, BidirectionalInputPayloadPart
from aws_sdk_bedrock_runtime.config import Config
from smithy_aws_core.identity.environment import EnvironmentCredentialsResolver

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
NOVA_SONIC_MODEL_ID = "amazon.nova-2-sonic-v1:0"
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")

# Language configuration
SUPPORTED_LANGUAGES = {
    "en-US": "English",
    "es-US": "Spanish",
    "fr-FR": "French",
    "de-DE": "German",
    "it-IT": "Italian",
    "pt-BR": "Portuguese",
}


class NovaSonicTranslator:
    """Nova Sonic client for real-time speech-to-speech translation."""
    
    def __init__(self, source_lang: str = "en-US", target_lang: str = "es-US"):
        self.source_lang = source_lang
        self.target_lang = target_lang
        self.model_id = NOVA_SONIC_MODEL_ID
        self.region = AWS_REGION
        self.client = None
        self.stream = None
        self.is_active = False
        self.prompt_name = str(uuid.uuid4())
        self.content_name = str(uuid.uuid4())
        self.audio_content_name = str(uuid.uuid4())
        self.audio_queue = asyncio.Queue()
        self.text_queue = asyncio.Queue()
        self.role = None
        self.display_assistant_text = False
        
    def _initialize_client(self):
        """Initialize the Bedrock client."""
        config = Config(
            endpoint_uri=f"https://bedrock-runtime.{self.region}.amazonaws.com",
            region=self.region,
            aws_credentials_identity_resolver=EnvironmentCredentialsResolver(),
        )
        self.client = BedrockRuntimeClient(config=config)
    
    async def send_event(self, event_json: str):
        """Send an event to the Nova Sonic stream."""
        event = InvokeModelWithBidirectionalStreamInputChunk(
            value=BidirectionalInputPayloadPart(bytes_=event_json.encode('utf-8'))
        )
        await self.stream.input_stream.send(event)
    
    async def start_session(self):
        """Start a new translation session with Nova Sonic."""
        if not self.client:
            self._initialize_client()
            
        # Initialize the bidirectional stream
        self.stream = await self.client.invoke_model_with_bidirectional_stream(
            InvokeModelWithBidirectionalStreamOperationInput(model_id=self.model_id)
        )
        self.is_active = True
        
        # Send session start event
        session_start = json.dumps({
            "event": {
                "sessionStart": {
                    "inferenceConfiguration": {
                        "maxTokens": 1024,
                        "topP": 0.9,
                        "temperature": 0.7
                    }
                }
            }
        })
        await self.send_event(session_start)
        
        # Send prompt start event with audio output configuration
        prompt_start = json.dumps({
            "event": {
                "promptStart": {
                    "promptName": self.prompt_name,
                    "textOutputConfiguration": {
                        "mediaType": "text/plain"
                    },
                    "audioOutputConfiguration": {
                        "mediaType": "audio/lpcm",
                        "sampleRateHertz": 24000,
                        "sampleSizeBits": 16,
                        "channelCount": 1,
                        "voiceId": "matthew",
                        "encoding": "base64",
                        "audioType": "SPEECH"
                    }
                }
            }
        })
        await self.send_event(prompt_start)
        
        # Send system prompt for translation
        text_content_start = json.dumps({
            "event": {
                "contentStart": {
                    "promptName": self.prompt_name,
                    "contentName": self.content_name,
                    "type": "TEXT",
                    "interactive": False,
                    "role": "SYSTEM",
                    "textInputConfiguration": {
                        "mediaType": "text/plain"
                    }
                }
            }
        })
        await self.send_event(text_content_start)
        
        # Translation system prompt
        source_name = SUPPORTED_LANGUAGES.get(self.source_lang, self.source_lang)
        target_name = SUPPORTED_LANGUAGES.get(self.target_lang, self.target_lang)
        system_prompt = f"""You are a professional UN-style interpreter. Your task is to translate speech from {source_name} to {target_name} in real-time.

Rules:
1. Translate the meaning accurately, not word-for-word
2. Maintain the speaker's tone and intent
3. Speak naturally in {target_name}
4. Do not add commentary or explanations
5. If you hear silence or unclear audio, remain silent
6. Translate continuously as the speaker talks, like a live interpreter"""

        text_input = json.dumps({
            "event": {
                "textInput": {
                    "promptName": self.prompt_name,
                    "contentName": self.content_name,
                    "content": system_prompt
                }
            }
        })
        await self.send_event(text_input)
        
        text_content_end = json.dumps({
            "event": {
                "contentEnd": {
                    "promptName": self.prompt_name,
                    "contentName": self.content_name
                }
            }
        })
        await self.send_event(text_content_end)
        
        print(f"Nova Sonic session started: {source_name} -> {target_name}")
    
    async def start_audio_input(self):
        """Start audio input stream."""
        audio_content_start = json.dumps({
            "event": {
                "contentStart": {
                    "promptName": self.prompt_name,
                    "contentName": self.audio_content_name,
                    "type": "AUDIO",
                    "interactive": True,
                    "role": "USER",
                    "audioInputConfiguration": {
                        "mediaType": "audio/lpcm",
                        "sampleRateHertz": 16000,
                        "sampleSizeBits": 16,
                        "channelCount": 1,
                        "audioType": "SPEECH",
                        "encoding": "base64"
                    }
                }
            }
        })
        await self.send_event(audio_content_start)
    
    async def send_audio_chunk(self, audio_bytes: bytes):
        """Send an audio chunk to Nova Sonic."""
        if not self.is_active:
            return
            
        blob = base64.b64encode(audio_bytes).decode('utf-8')
        audio_event = json.dumps({
            "event": {
                "audioInput": {
                    "promptName": self.prompt_name,
                    "contentName": self.audio_content_name,
                    "content": blob
                }
            }
        })
        await self.send_event(audio_event)
    
    async def end_audio_input(self):
        """End audio input stream."""
        audio_content_end = json.dumps({
            "event": {
                "contentEnd": {
                    "promptName": self.prompt_name,
                    "contentName": self.audio_content_name
                }
            }
        })
        await self.send_event(audio_content_end)
    
    async def end_session(self):
        """End the Nova Sonic session."""
        if not self.is_active:
            return
            
        self.is_active = False
        
        prompt_end = json.dumps({
            "event": {
                "promptEnd": {
                    "promptName": self.prompt_name
                }
            }
        })
        await self.send_event(prompt_end)
        
        session_end = json.dumps({
            "event": {
                "sessionEnd": {}
            }
        })
        await self.send_event(session_end)
        
        await self.stream.input_stream.close()
        print("Nova Sonic session ended")
    
    async def process_responses(self):
        """Process responses from Nova Sonic and queue audio/text."""
        try:
            while self.is_active:
                output = await self.stream.await_output()
                result = await output[1].receive()
                
                if result.value and result.value.bytes_:
                    response_data = result.value.bytes_.decode('utf-8')
                    json_data = json.loads(response_data)
                    
                    if 'event' in json_data:
                        # Handle content start event
                        if 'contentStart' in json_data['event']:
                            content_start = json_data['event']['contentStart']
                            self.role = content_start.get('role')
                            if 'additionalModelFields' in content_start:
                                additional_fields = json.loads(content_start['additionalModelFields'])
                                self.display_assistant_text = additional_fields.get('generationStage') == 'SPECULATIVE'
                        
                        # Handle text output event
                        elif 'textOutput' in json_data['event']:
                            text = json_data['event']['textOutput']['content']
                            role = self.role
                            await self.text_queue.put({
                                "role": role,
                                "text": text,
                                "display": self.display_assistant_text if role == "ASSISTANT" else True
                            })
                        
                        # Handle audio output
                        elif 'audioOutput' in json_data['event']:
                            audio_content = json_data['event']['audioOutput']['content']
                            audio_bytes = base64.b64decode(audio_content)
                            await self.audio_queue.put(audio_bytes)
                            
        except Exception as e:
            print(f"Error processing Nova Sonic responses: {e}")
            self.is_active = False


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
    source: str = Query("en-US"),
    target: str = Query("es-US")
):
    """WebSocket endpoint for real-time translation."""
    await websocket.accept()
    
    translator = NovaSonicTranslator(source_lang=source, target_lang=target)
    session_id = str(uuid.uuid4())
    
    print(f"WebSocket connection: {session_id} ({source} -> {target})")
    
    try:
        # Start Nova Sonic session
        await translator.start_session()
        await translator.start_audio_input()
        
        # Start response processing task
        response_task = asyncio.create_task(translator.process_responses())
        
        # Task to forward audio from Nova Sonic to WebSocket
        async def forward_audio():
            while translator.is_active:
                try:
                    audio_bytes = await asyncio.wait_for(
                        translator.audio_queue.get(), 
                        timeout=0.1
                    )
                    await websocket.send_bytes(audio_bytes)
                except asyncio.TimeoutError:
                    continue
                except Exception as e:
                    print(f"Error forwarding audio: {e}")
                    break
        
        # Task to forward text from Nova Sonic to WebSocket
        async def forward_text():
            while translator.is_active:
                try:
                    text_data = await asyncio.wait_for(
                        translator.text_queue.get(),
                        timeout=0.1
                    )
                    if text_data.get("display", True):
                        await websocket.send_json({
                            "type": "transcript",
                            "role": "user" if text_data["role"] == "USER" else "assistant",
                            "text": text_data["text"]
                        })
                except asyncio.TimeoutError:
                    continue
                except Exception as e:
                    print(f"Error forwarding text: {e}")
                    break
        
        audio_forward_task = asyncio.create_task(forward_audio())
        text_forward_task = asyncio.create_task(forward_text())
        
        # Send ready status
        await websocket.send_json({
            "type": "status",
            "message": "ready",
            "session_id": session_id
        })
        
        # Receive audio from WebSocket and forward to Nova Sonic
        while True:
            try:
                message = await websocket.receive()
                
                if message["type"] == "websocket.disconnect":
                    break
                
                if "bytes" in message:
                    # Audio data from frontend
                    await translator.send_audio_chunk(message["bytes"])
                    
                elif "text" in message:
                    data = json.loads(message["text"])
                    if data.get("type") == "stop":
                        break
                    elif data.get("type") == "ping":
                        await websocket.send_json({"type": "pong"})
                        
            except WebSocketDisconnect:
                break
            except Exception as e:
                print(f"Error receiving from WebSocket: {e}")
                break
        
    except Exception as e:
        print(f"Session error: {e}")
        await websocket.send_json({
            "type": "error",
            "message": str(e)
        })
    finally:
        # Cleanup
        translator.is_active = False
        await translator.end_audio_input()
        await translator.end_session()
        
        # Cancel tasks
        for task in [response_task, audio_forward_task, text_forward_task]:
            if not task.done():
                task.cancel()
        
        print(f"Session ended: {session_id}")


@app.websocket("/ws/echo")
async def websocket_echo(websocket: WebSocket):
    """Echo endpoint for testing audio pipeline."""
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
                # Echo audio back
                await websocket.send_bytes(message["bytes"])
            elif "text" in message:
                await websocket.send_text(message["text"])
                
    except WebSocketDisconnect:
        pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
