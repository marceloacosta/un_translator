'use client';

import { useState, useRef, useEffect } from 'react';

export default function Home() {
  const [isRecording, setIsRecording] = useState(false);
  const [sourceLang, setSourceLang] = useState('en');
  const [targetLang, setTargetLang] = useState('es');
  const [audioError, setAudioError] = useState<string | null>(null);

  // Audio refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  // Audio functions
  const stopAudioLoopback = () => {
    // Stop media stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
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

    setIsRecording(false);
    setAudioError(null);
  };

  // Check browser compatibility
  useEffect(() => {
    const checkCompatibility = () => {
      const hasGetUserMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
      const hasAudioContext = !!(window.AudioContext || (window as any).webkitAudioContext);

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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAudioLoopback();
    };
  }, []);

  // Audio loopback functions
  const startAudioLoopback = async () => {
    try {
      console.log('🎙️ Starting audio loopback...');
      setAudioError(null);

      // Check if getUserMedia is supported
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('getUserMedia is not supported in this browser');
      }

      console.log('🎤 Requesting microphone access...');
      // Request microphone access
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
      console.log('🔊 Creating audio context...');
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioContextRef.current = new AudioContextClass();

      // Resume audio context if needed (required by some browsers)
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
        console.log('▶️ Audio context resumed');
      }

      // Create source node from microphone
      console.log('🎚️ Creating audio nodes...');
      sourceNodeRef.current = audioContextRef.current.createMediaStreamSource(stream);

      // Create gain node for volume control
      gainNodeRef.current = audioContextRef.current.createGain();
      gainNodeRef.current.gain.value = 0.8; // Slightly reduce volume to prevent feedback

      // Connect: microphone -> gain -> speakers (loopback)
      console.log('🔗 Connecting audio nodes...');
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

  const toggleAudioLoopback = () => {
    console.log('🔘 Toggle button clicked, current state:', isRecording);

    if (isRecording) {
      console.log('🛑 Stopping audio loopback...');
      stopAudioLoopback();
    } else {
      console.log('▶️ Starting audio loopback...');
      startAudioLoopback();
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
              >
                <option value="en">English</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
                <option value="de">German</option>
                <option value="it">Italian</option>
                <option value="pt">Portuguese</option>
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
              >
                <option value="es">Spanish</option>
                <option value="en">English</option>
                <option value="fr">French</option>
                <option value="de">German</option>
                <option value="it">Italian</option>
                <option value="pt">Portuguese</option>
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
                  {isRecording ? '🎤 Speak into microphone - testing audio input' : 'Audio input area (for future speech recognition)'}
                </p>
              </div>
            </div>

            {/* Translated Text */}
            <div>
              <h3 className="text-sm font-medium text-slate-300 mb-2">Live Translation</h3>
              <div className="bg-slate-900 rounded-md p-4 min-h-[120px] border border-slate-600">
                <div className="flex items-center space-x-2 mb-2">
                  <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-blue-400 animate-pulse' : 'bg-slate-600'}`}></div>
                  <span className="text-xs text-slate-400">
                    {isRecording ? 'Translating...' : 'Translation ready'}
                  </span>
                </div>
                <p className="text-blue-300 leading-relaxed italic">
                  {isRecording ? '🔊 Audio output through headphones (echo test)' : 'Audio output area (for future translated speech)'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Control Panel */}
        <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
          <div className="flex flex-col gap-4 items-center justify-center">
            {/* Audio Loopback Test Button */}
            <button
              onClick={toggleAudioLoopback}
              className={`px-12 py-6 rounded-full font-bold text-xl transition-all duration-300 ${
                isRecording
                  ? 'bg-red-600 hover:bg-red-700 shadow-red-500/25 animate-pulse'
                  : 'bg-green-600 hover:bg-green-700 shadow-green-500/25'
              } text-white shadow-2xl hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed`}
              disabled={!!audioError}
            >
              {isRecording ? '🔴 Stop Audio Test' : '🎧 Test Audio Loopback'}
            </button>

            {/* Audio Test Status */}
            <div className="text-center space-y-3">
              <div className={`inline-flex items-center px-6 py-3 rounded-full text-base font-medium transition-all duration-300 ${
                audioError
                  ? 'bg-red-900/50 text-red-300 border border-red-700'
                  : isRecording
                  ? 'bg-green-900/50 text-green-300 border border-green-700 shadow-green-500/20'
                  : 'bg-slate-700 text-slate-300 border border-slate-600'
              }`}>
                <div className={`w-3 h-3 rounded-full mr-3 ${
                  audioError
                    ? 'bg-red-500'
                    : isRecording
                    ? 'bg-green-400 animate-pulse'
                    : 'bg-slate-500'
                }`}></div>
                {audioError
                  ? 'Audio Error'
                  : isRecording
                  ? 'Audio Loopback Active'
                  : 'Ready for Audio Test'}
              </div>

              {/* Instructions */}
              <div className="max-w-md space-y-1">
                {audioError ? (
                  <p className="text-sm text-red-400">{audioError}</p>
                ) : isRecording ? (
                  <>
                    <p className="text-sm text-slate-400">
                      🎤 Speak into your microphone - you should hear yourself through headphones
                    </p>
                    <p className="text-xs text-slate-500">
                      This tests the basic audio pipeline before adding translation
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-slate-400">
                    Click &quot;Test Audio Loopback&quot; to verify microphone and headphone audio works
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
