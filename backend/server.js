/**
 * UN Translator Backend - Nova Sonic Speech-to-Speech Translation
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { 
  BedrockRuntimeClient, 
  InvokeModelWithBidirectionalStreamCommand 
} = require('@aws-sdk/client-bedrock-runtime');
const { NodeHttp2Handler } = require('@smithy/node-http-handler');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 8080;
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const MODEL_ID = 'amazon.nova-sonic-v1:0';

// Supported languages
const SUPPORTED_LANGUAGES = {
  'en-US': 'English',
  'es-US': 'Spanish',
  'fr-FR': 'French',
  'de-DE': 'German',
  'it-IT': 'Italian',
  'pt-BR': 'Portuguese'
};

// Create Bedrock client with HTTP/2 handler for bidirectional streaming
const bedrockClient = new BedrockRuntimeClient({
  region: AWS_REGION,
  credentials: defaultProvider(),
  requestHandler: new NodeHttp2Handler({
    requestTimeout: 300000,
    sessionTimeout: 300000,
    disableConcurrentStreams: false,
    maxConcurrentStreams: 20
  })
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

app.get('/', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'UN Translator API',
    model: MODEL_ID 
  });
});

app.get('/languages', (req, res) => {
  res.json({ languages: SUPPORTED_LANGUAGES });
});

// Track active sessions
const activeSessions = new Map();

// Socket.IO connection handler
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  let session = null;
  let sourceLang = 'en-US';
  let targetLang = 'es-US';
  let promptName = uuidv4();
  let audioContentName = uuidv4();
  let systemContentName = uuidv4();
  
  // Handle session start
  socket.on('startSession', async (config) => {
    try {
      sourceLang = config?.sourceLang || 'en-US';
      targetLang = config?.targetLang || 'es-US';
      
      const sourceName = SUPPORTED_LANGUAGES[sourceLang] || sourceLang;
      const targetName = SUPPORTED_LANGUAGES[targetLang] || targetLang;
      
      console.log(`Starting session: ${sourceName} -> ${targetName}`);
      
      // Create bidirectional stream command
      const command = new InvokeModelWithBidirectionalStreamCommand({
        modelId: MODEL_ID
      });
      
      // Start the bidirectional stream
      const response = await bedrockClient.send(command);
      session = response;
      
      activeSessions.set(socket.id, session);
      
      // Send session start event
      await sendEvent(session, {
        event: {
          sessionStart: {
            inferenceConfiguration: {
              maxTokens: 1024,
              topP: 0.9,
              temperature: 0.7
            }
          }
        }
      });
      
      // Send prompt start event
      await sendEvent(session, {
        event: {
          promptStart: {
            promptName: promptName,
            textOutputConfiguration: {
              mediaType: 'text/plain'
            },
            audioOutputConfiguration: {
              mediaType: 'audio/lpcm',
              sampleRateHertz: 24000,
              sampleSizeBits: 16,
              channelCount: 1,
              voiceId: 'matthew',
              encoding: 'base64',
              audioType: 'SPEECH'
            }
          }
        }
      });
      
      // Send system prompt for translation
      await sendEvent(session, {
        event: {
          contentStart: {
            promptName: promptName,
            contentName: systemContentName,
            type: 'TEXT',
            interactive: false,
            role: 'SYSTEM',
            textInputConfiguration: {
              mediaType: 'text/plain'
            }
          }
        }
      });
      
      const systemPrompt = `You are a professional UN-style interpreter. Translate speech from ${sourceName} to ${targetName} in real-time.
Rules:
1. Translate meaning accurately, not word-for-word
2. Maintain the speaker's tone and intent
3. Speak naturally in ${targetName}
4. Do not add commentary
5. If you hear silence, remain silent
6. Translate continuously like a live interpreter`;
      
      await sendEvent(session, {
        event: {
          textInput: {
            promptName: promptName,
            contentName: systemContentName,
            content: systemPrompt
          }
        }
      });
      
      await sendEvent(session, {
        event: {
          contentEnd: {
            promptName: promptName,
            contentName: systemContentName
          }
        }
      });
      
      // Start audio input
      await sendEvent(session, {
        event: {
          contentStart: {
            promptName: promptName,
            contentName: audioContentName,
            type: 'AUDIO',
            interactive: true,
            role: 'USER',
            audioInputConfiguration: {
              mediaType: 'audio/lpcm',
              sampleRateHertz: 16000,
              sampleSizeBits: 16,
              channelCount: 1,
              audioType: 'SPEECH',
              encoding: 'base64'
            }
          }
        }
      });
      
      // Start processing responses
      processResponses(session, socket);
      
      socket.emit('sessionReady', { sessionId: socket.id });
      console.log(`Session ready: ${socket.id}`);
      
    } catch (error) {
      console.error('Error starting session:', error);
      socket.emit('error', { message: error.message });
    }
  });
  
  // Handle audio data from client
  socket.on('audioData', async (data) => {
    if (!session) {
      return;
    }
    
    try {
      // data should be base64 encoded audio
      await sendEvent(session, {
        event: {
          audioInput: {
            promptName: promptName,
            contentName: audioContentName,
            content: data
          }
        }
      });
    } catch (error) {
      console.error('Error sending audio:', error);
    }
  });
  
  // Handle session end
  socket.on('endSession', async () => {
    await closeSession(socket.id, session, promptName, audioContentName);
  });
  
  // Handle disconnect
  socket.on('disconnect', async () => {
    console.log(`Client disconnected: ${socket.id}`);
    await closeSession(socket.id, session, promptName, audioContentName);
  });
});

// Send event to Nova Sonic stream
async function sendEvent(session, eventData) {
  if (!session || !session.body) return;
  
  const eventJson = JSON.stringify(eventData);
  const chunk = {
    chunk: {
      bytes: Buffer.from(eventJson, 'utf-8')
    }
  };
  
  await session.body.sendInput(chunk);
}

// Process responses from Nova Sonic
async function processResponses(session, socket) {
  try {
    for await (const event of session.body) {
      if (!event.chunk?.bytes) continue;
      
      const responseData = JSON.parse(Buffer.from(event.chunk.bytes).toString('utf-8'));
      
      if (responseData.event) {
        // Handle audio output
        if (responseData.event.audioOutput) {
          const audioContent = responseData.event.audioOutput.content;
          socket.emit('audioOutput', audioContent);
        }
        
        // Handle text output
        if (responseData.event.textOutput) {
          const text = responseData.event.textOutput.content;
          socket.emit('textOutput', { text });
        }
        
        // Handle content start (for role info)
        if (responseData.event.contentStart) {
          const role = responseData.event.contentStart.role;
          socket.emit('contentStart', { role });
        }
      }
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('Error processing responses:', error);
      socket.emit('error', { message: error.message });
    }
  }
}

// Close session cleanly
async function closeSession(socketId, session, promptName, audioContentName) {
  if (!session) return;
  
  try {
    // End audio content
    await sendEvent(session, {
      event: {
        contentEnd: {
          promptName: promptName,
          contentName: audioContentName
        }
      }
    });
    
    // End prompt
    await sendEvent(session, {
      event: {
        promptEnd: {
          promptName: promptName
        }
      }
    });
    
    // End session
    await sendEvent(session, {
      event: {
        sessionEnd: {}
      }
    });
    
    activeSessions.delete(socketId);
    console.log(`Session closed: ${socketId}`);
  } catch (error) {
    console.error('Error closing session:', error);
  }
}

// Start server
server.listen(PORT, () => {
  console.log(`UN Translator backend running on port ${PORT}`);
  console.log(`Model: ${MODEL_ID}`);
  console.log(`Region: ${AWS_REGION}`);
});

