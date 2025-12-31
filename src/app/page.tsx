'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

// Backend URL - will be configured for production
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'ws://localhost:8000';

export default function Home() {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [sourceLang, setSourceLang] = useState('en-US');
  const [targetLang, setTargetLang] = useState('es-US');
  const [audioError, setAudioError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [transcript, setTranscript] = useState<{ source: string; translated: string }>({ source: '', translated: '' });

  // Audio refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const websocketRef = useRef<WebSocket | null>(null);

  // Check browser compatibility
  useEffect(() => {
    const checkCompatibility = () => {
      const hasGetUserMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
      const hasAudioContext = !!(window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);

      if (!hasGetUserMedia) {
        setAudioError('This browser does not support microphone access');
      } else if (!hasAudioContext) {
        setAudioError('This browser does not support Web Audio API');
      } else if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
        setAudioError('Microphone access requires HTTPS (or localhost for development)');
      }
    };

    checkCompatibility();
  }, []);

  // Stop audio and cleanup
  const stopAudio = useCallback(() => {
    // Stop media stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    // Disconnect processor node
    if (processorNodeRef.current) {
      processorNodeRef.current.disconnect();
      processorNodeRef.current = null;
    }

    // Disconnect audio nodes
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }

    if (gainNodeRef.current) {
      gainNodeRef.current.disconnect();
      gainNodeRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Close WebSocket
    if (websocketRef.current) {
      websocketRef.current.close();
      websocketRef.current = null;
    }

    setIsRecording(false);
    setIsTranslating(false);
    setConnectionStatus('disconnected');
    setAudioError(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAudio();
    };
  }, [stopAudio]);

  // Audio loopback test (local echo)
  const startAudioLoopback = async () => {
    try {
      console.log('🎙️ Starting audio loopback...');
      setAudioError(null);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('getUserMedia is not supported in this browser');
      }

      console.log('🎤 Requesting microphone access...');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
      });

      console.log('✅ Microphone access granted');
      mediaStreamRef.current = stream;

      // Create audio context
      const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) throw new Error('AudioContext not available');
      audioContextRef.current = new AudioContextClass();

      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      // Create audio nodes
      sourceNodeRef.current = audioContextRef.current.createMediaStreamSource(stream);
      gainNodeRef.current = audioContextRef.current.createGain();
      gainNodeRef.current.gain.value = 0.8;

      // Connect: microphone -> gain -> speakers
      sourceNodeRef.current.connect(gainNodeRef.current);
      gainNodeRef.current.connect(audioContextRef.current.destination);

      console.log('🎉 Audio loopback started successfully!');
      setIsRecording(true);

    } catch (error) {
      console.error('❌ Error starting audio loopback:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to access microphone';
      setAudioError(errorMessage);
    }
  };

  // Translation with WebSocket backend
  const startTranslation = async () => {
    try {
      console.log('🌐 Starting translation...');
      setAudioError(null);
      setConnectionStatus('connecting');

      // Connect to WebSocket
      const wsUrl = `${BACKEND_URL}/ws/translate?source=${sourceLang}&target=${targetLang}`;
      console.log('🔌 Connecting to:', wsUrl);
      
      websocketRef.current = new WebSocket(wsUrl);

      websocketRef.current.onopen = async () => {
        console.log('✅ WebSocket connected');
        setConnectionStatus('connected');

        // Request microphone access
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('getUserMedia is not supported in this browser');
        }

        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              sampleRate: 16000,
            }
          });

          mediaStreamRef.current = stream;

          // Create audio context for processing
          const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (!AudioContextClass) throw new Error('AudioContext not available');
          audioContextRef.current = new AudioContextClass({ sampleRate: 16000 });

          if (audioContextRef.current.state === 'suspended') {
            await audioContextRef.current.resume();
          }

          // Create source node
          sourceNodeRef.current = audioContextRef.current.createMediaStreamSource(stream);

          // Create script processor for capturing audio data
          // Note: ScriptProcessorNode is deprecated but works for now
          // TODO: Migrate to AudioWorklet for better performance
          processorNodeRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);

          processorNodeRef.current.onaudioprocess = (e) => {
            if (websocketRef.current?.readyState === WebSocket.OPEN) {
              const inputData = e.inputBuffer.getChannelData(0);
              // Convert Float32 to Int16 PCM
              const pcmData = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                const s = Math.max(-1, Math.min(1, inputData[i]));
                pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
              }
              websocketRef.current.send(pcmData.buffer);
            }
          };

          // Connect: microphone -> processor
          sourceNodeRef.current.connect(processorNodeRef.current);
          processorNodeRef.current.connect(audioContextRef.current.destination);

          // Send start message
          websocketRef.current.send(JSON.stringify({ type: 'start' }));
          setIsTranslating(true);
          setIsRecording(true);

        } catch (micError) {
          console.error('❌ Microphone error:', micError);
          setAudioError(micError instanceof Error ? micError.message : 'Failed to access microphone');
          websocketRef.current?.close();
        }
      };

      websocketRef.current.onmessage = (event) => {
        try {
          if (typeof event.data === 'string') {
            const data = JSON.parse(event.data);
            console.log('📨 Received:', data);

            if (data.type === 'transcript') {
              if (data.role === 'user') {
                setTranscript(prev => ({ ...prev, source: data.text }));
              } else if (data.role === 'assistant') {
                setTranscript(prev => ({ ...prev, translated: data.text }));
              }
            } else if (data.type === 'status') {
              console.log('📊 Status:', data.message);
            } else if (data.type === 'error') {
              console.error('⚠️ Backend error:', data.message);
              setAudioError(data.message);
            }
          } else if (event.data instanceof Blob) {
            // Audio data from backend - play it
            event.data.arrayBuffer().then(buffer => {
              playAudioBuffer(buffer);
            });
          }
        } catch (e) {
          console.error('Error processing message:', e);
        }
      };

      websocketRef.current.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        setAudioError('Connection error. Is the backend running?');
        setConnectionStatus('disconnected');
      };

      websocketRef.current.onclose = () => {
        console.log('🔌 WebSocket closed');
        setConnectionStatus('disconnected');
        setIsTranslating(false);
      };

    } catch (error) {
      console.error('❌ Error starting translation:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to start translation';
      setAudioError(errorMessage);
      setConnectionStatus('disconnected');
    }
  };

  // Play received audio buffer
  const playAudioBuffer = async (buffer: ArrayBuffer) => {
    try {
      if (!audioContextRef.current) return;

      // Create a new AudioContext for playback if needed
      const playbackContext = new (window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!)();

      // Decode the audio data (assuming 24kHz 16-bit PCM from Nova Sonic)
      const int16Array = new Int16Array(buffer);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768;
      }

      const audioBuffer = playbackContext.createBuffer(1, float32Array.length, 24000);
      audioBuffer.getChannelData(0).set(float32Array);

      const source = playbackContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(playbackContext.destination);
      source.start();

    } catch (e) {
      console.error('Error playing audio:', e);
    }
  };

  const toggleAudioLoopback = () => {
    if (isRecording) {
      stopAudio();
    } else {
      startAudioLoopback();
    }
  };

  const toggleTranslation = () => {
    if (isTranslating) {
      stopAudio();
    } else {
      startTranslation();
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white font-sans">
      {/* Header */}
      <header className="border-b border-slate-700 bg-slate-800/50 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <h1 className="text-2xl font-bold text-center">UN TRANSLATOR</h1>
          <p className="text-sm text-slate-400 text-center mt-1">Real-time Speech Translation</p>
        </div>
      </header>

      {/* Main Interface */}
      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Language Selection */}
        <div className="bg-slate-800 rounded-lg p-6 mb-8 border border-slate-700">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
            {/* Source Language */}
            <div className="text-center">
              <label className="block text-sm font-medium text-slate-300 mb-2">Source Language</label>
              <select
                value={sourceLang}
                onChange={(e) => setSourceLang(e.target.value)}
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isRecording}
              >
                <option value="en-US">English (US)</option>
                <option value="es-US">Spanish (US)</option>
                <option value="fr-FR">French</option>
                <option value="de-DE">German</option>
                <option value="it-IT">Italian</option>
                <option value="pt-BR">Portuguese (Brazil)</option>
              </select>
            </div>

            {/* Translation Arrow */}
            <div className="flex justify-center">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Target Language */}
            <div className="text-center">
              <label className="block text-sm font-medium text-slate-300 mb-2">Target Language</label>
              <select
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isRecording}
              >
                <option value="es-US">Spanish (US)</option>
                <option value="en-US">English (US)</option>
                <option value="fr-FR">French</option>
                <option value="de-DE">German</option>
                <option value="it-IT">Italian</option>
                <option value="pt-BR">Portuguese (Brazil)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Translation Display */}
        <div className="bg-slate-800 rounded-lg p-6 mb-8 border border-slate-700">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Source Text */}
            <div>
              <h3 className="text-sm font-medium text-slate-300 mb-2">Source Speech</h3>
              <div className="bg-slate-900 rounded-md p-4 min-h-[120px] border border-slate-600">
                <div className="flex items-center space-x-2 mb-2">
                  <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-green-400 animate-pulse' : 'bg-slate-600'}`}></div>
                  <span className="text-xs text-slate-400">
                    {isRecording ? 'Listening...' : 'Waiting to start'}
                  </span>
                </div>
                <p className="text-slate-300 leading-relaxed">
                  {transcript.source || (isRecording ? '🎤 Listening for speech...' : 'Speech will appear here')}
                </p>
              </div>
            </div>

            {/* Translated Text */}
            <div>
              <h3 className="text-sm font-medium text-slate-300 mb-2">Live Translation</h3>
              <div className="bg-slate-900 rounded-md p-4 min-h-[120px] border border-slate-600">
                <div className="flex items-center space-x-2 mb-2">
                  <div className={`w-2 h-2 rounded-full ${isTranslating ? 'bg-blue-400 animate-pulse' : 'bg-slate-600'}`}></div>
                  <span className="text-xs text-slate-400">
                    {isTranslating ? 'Translating...' : 'Translation ready'}
                  </span>
                </div>
                <p className="text-blue-300 leading-relaxed italic">
                  {transcript.translated || (isTranslating ? '🔊 Translation will appear here...' : 'Translation will appear here')}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Control Panel */}
        <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
          <div className="flex flex-col gap-6 items-center justify-center">
            {/* Main Translation Button */}
            <button
              onClick={toggleTranslation}
              className={`px-12 py-6 rounded-full font-bold text-xl transition-all duration-300 ${
                isTranslating
                  ? 'bg-red-600 hover:bg-red-700 shadow-red-500/25 animate-pulse'
                  : 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/25'
              } text-white shadow-2xl hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed`}
              disabled={!!audioError || (isRecording && !isTranslating)}
            >
              {isTranslating ? '🔴 Stop Translation' : '🌐 Start Translation'}
            </button>

            {/* Connection Status */}
            <div className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-medium ${
              connectionStatus === 'connected'
                ? 'bg-green-900/50 text-green-300 border border-green-700'
                : connectionStatus === 'connecting'
                ? 'bg-yellow-900/50 text-yellow-300 border border-yellow-700'
                : 'bg-slate-700 text-slate-300 border border-slate-600'
            }`}>
              <div className={`w-2 h-2 rounded-full mr-2 ${
                connectionStatus === 'connected'
                  ? 'bg-green-400'
                  : connectionStatus === 'connecting'
                  ? 'bg-yellow-400 animate-pulse'
                  : 'bg-slate-500'
              }`}></div>
              {connectionStatus === 'connected'
                ? 'Connected to Backend'
                : connectionStatus === 'connecting'
                ? 'Connecting...'
                : 'Disconnected'}
            </div>

            {/* Divider */}
            <div className="w-full border-t border-slate-700 my-2"></div>

            {/* Audio Test Button */}
            <button
              onClick={toggleAudioLoopback}
              className={`px-8 py-3 rounded-full font-medium text-sm transition-all duration-300 ${
                isRecording && !isTranslating
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-slate-600 hover:bg-slate-500'
              } text-white disabled:opacity-50 disabled:cursor-not-allowed`}
              disabled={!!audioError || isTranslating}
            >
              {isRecording && !isTranslating ? '🛑 Stop Audio Test' : '🎧 Test Audio (Echo)'}
            </button>

            {/* Status and Instructions */}
            <div className="text-center space-y-2 max-w-md">
              {audioError ? (
                <p className="text-sm text-red-400">{audioError}</p>
              ) : isTranslating ? (
                <p className="text-sm text-slate-400">
                  🎤 Speaking now... Translation will play through headphones
                </p>
              ) : isRecording ? (
                <p className="text-sm text-slate-400">
                  🎧 Audio loopback active - you should hear yourself
                </p>
              ) : (
                <p className="text-sm text-slate-400">
                  Click &quot;Start Translation&quot; for real-time UN-style translation
                </p>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
