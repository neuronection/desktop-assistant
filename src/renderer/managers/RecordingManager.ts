// src/renderer/managers/RecordingManager.ts

import { RecordingState } from '@shared/types.js';

export interface RecordingConfig {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  format: string;
  maxDuration: number; // seconds
  silenceThreshold: number;
  silenceTimeout: number; // ms
}

export interface RecordingManagerEvents {
  'recording:started': () => void;
  'recording:stopped': () => void;
  'recording:error': (error: Error) => void;
  'recording:data': (audioData: Blob) => void;
  'transcript:received': (transcript: string) => void;
  'transcript:error': (error: Error) => void;
  'volume:change': (volume: number) => void;
  'state:change': (state: RecordingState) => void;
  'interim:transcript': (fullInterimText: string) => void;
}

export class RecordingManager {
  private static instance: RecordingManager;
  
  // Recording state
  private state: RecordingState = RecordingState.IDLE;
  private mediaRecorder: MediaRecorder | null = null;
  private audioStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  
  // Recording data
  private audioChunks: Blob[] = [];
  private recordingStartTime: number = 0;
  private recordingTimer: NodeJS.Timeout | null = null;
  private silenceTimer: NodeJS.Timeout | null = null;
  
  // Configuration
  private config: RecordingConfig = {
    sampleRate: 44100,
    channels: 1,
    bitDepth: 16,
    format: 'audio/webm;codecs=opus',
    maxDuration: 300, // 5 minutes
    silenceThreshold: 0.01,
    silenceTimeout: 3000 // 3 seconds
  };

  // Live segmentation (path-2 interim transcription)
  private interimTranscript: string = '';
  private segmentHasSpeech: boolean = false;
  private segmentSpeechFrames: number = 0;
  private segmentStartedAt: number = 0;
  private rotating: boolean = false;
  private liveTranscript: boolean = true;
  private phraseGapMs: number = 700;
  private maxSegmentMs: number = 0;
  private gain: number = 1;

  /** Frames are ~16ms rAF ticks; ~320ms of audible audio before a POST is worth it. */
  private static MIN_SPEECH_FRAMES = 20;

  // Event callbacks
  private eventCallbacks: Map<keyof RecordingManagerEvents, ((...args: unknown[]) => void)[]> = new Map();
  
  // Volume monitoring
  private volumeMonitoringActive = false;
  private volumeAnimationFrame: number | null = null;

  private constructor() {
    this.checkBrowserSupport();
  }

  public static getInstance(): RecordingManager {
    if (!RecordingManager.instance) {
      RecordingManager.instance = new RecordingManager();
    }
    return RecordingManager.instance;
  }

  // =============================================================================
  // INITIALIZATION
  // =============================================================================

  public async initialize(): Promise<void> {
    try {
      console.log('🎤 Initializing RecordingManager...');
      
      await this.checkPermissions();
      await this.loadConfiguration();
      
      console.log('✅ RecordingManager initialized');
    } catch (error) {
      console.error('❌ Failed to initialize RecordingManager:', error);
      throw error;
    }
  }

  private checkBrowserSupport(): void {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Media recording not supported in this browser');
    }

    if (!window.MediaRecorder) {
      throw new Error('MediaRecorder API not supported');
    }

    if (!window.AudioContext && !window.webkitAudioContext) {
      throw new Error('Web Audio API not supported');
    }
  }

  private async checkPermissions(): Promise<void> {
    try {
      const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      
      if (permissionStatus.state === 'denied') {
        throw new Error('Microphone permission denied');
      }

      console.log('🎤 Microphone permission:', permissionStatus.state);
    } catch (error) {
      console.warn('Could not check microphone permissions:', error);
    }
  }

  private async loadConfiguration(): Promise<void> {
    try {
      if (window.electronAPI) {
        const config = await window.electronAPI.loadConfig();
        this.liveTranscript = config?.voice?.liveTranscript ?? true;
        this.phraseGapMs = config?.voice?.phraseGapMs ?? 700;
        this.maxSegmentMs = config?.voice?.maxSegmentMs ?? 0;
        this.gain = config?.voice?.gain && config.voice.gain > 0 ? config.voice.gain : 1;
      }
    } catch (error) {
      console.warn('Failed to load recording configuration:', error);
    }
  }

  // =============================================================================
  // RECORDING CONTROL
  // =============================================================================

  public async startRecording(): Promise<void> {
    if (this.state !== RecordingState.IDLE) {
      console.warn('Recording already in progress');
      return;
    }

    try {
      console.log('🎤 Starting recording...');
      await this.loadConfiguration();
      this.setState(RecordingState.RECORDING);
      
      // Get audio stream
      await this.initializeAudioStream();
      
      // Set up audio analysis
      this.setupAudioAnalysis();
      
      // Start recording
      this.recordingStartTime = Date.now();
      this.interimTranscript = '';
      this.segmentHasSpeech = false;
      this.startSegment();
      
      // Set up timers
      this.startRecordingTimer();
      this.startVolumeMonitoring();
      
      this.emit('recording:started');
      console.log('✅ Recording started');
    } catch (error) {
      console.error('❌ Failed to start recording:', error);
      this.setState(RecordingState.IDLE);
      this.emit('recording:error', error as Error);
      throw error;
    }
  }

  public async stopRecording(): Promise<string | null> {
    if (this.state !== RecordingState.RECORDING) {
      console.warn('No recording in progress');
      return null;
    }

    try {
      console.log('🛑 Stopping recording...');
      this.setState(RecordingState.PROCESSING);

      this.stopRecordingTimer();
      this.stopVolumeMonitoring();
      this.stopSilenceTimer();

      const flushed = await this.flushCurrentSegment();
      this.cleanup();

      const transcript = flushed ?? (this.interimTranscript || null);
      if (transcript) {
        this.emit('transcript:received', transcript);
      }

      this.setState(RecordingState.IDLE);
      this.emit('recording:stopped');

      return transcript;
    } catch (error) {
      console.error('❌ Failed to stop recording:', error);
      this.setState(RecordingState.IDLE);
      this.emit('recording:error', error as Error);
      this.cleanup();
      return null;
    }
  }

  private startSegment(): void {
    this.initializeMediaRecorder();
    this.segmentHasSpeech = false;
    this.segmentSpeechFrames = 0;
    this.segmentStartedAt = Date.now();
    this.mediaRecorder!.start(100);
  }

  /** Stops the active segment, restarts recording, then transcribes the captured audio. */
  private async flushCurrentSegment(): Promise<string | null> {
    const recorder = this.mediaRecorder;
    if (!recorder) {
      return null;
    }

    if (recorder.state === 'recording') {
      recorder.stop();
    }
    const blob = await this.finalizeRecorder(recorder);
    const enoughSpeech =
      this.segmentHasSpeech && this.segmentSpeechFrames >= RecordingManager.MIN_SPEECH_FRAMES;
    this.audioChunks = [];
    this.segmentHasSpeech = false;
    this.segmentSpeechFrames = 0;
    this.mediaRecorder = null;

    if (this.state === RecordingState.RECORDING && this.audioStream) {
      this.startSegment();
    }

    if (!blob || !enoughSpeech) {
      return null;
    }
    const segmentText = await this.processAudioWithSTT(blob);
    if (segmentText) {
      this.interimTranscript = this.interimTranscript ? `${this.interimTranscript} ${segmentText}` : segmentText;
      this.emit('interim:transcript', this.interimTranscript);
    }
    return segmentText;
  }

  /** Live-transcribes the phrase that just ended and keeps recording. */
  private async rotateSegment(): Promise<void> {
    if (this.rotating || this.state !== RecordingState.RECORDING || !this.mediaRecorder) {
      return;
    }
    this.rotating = true;
    try {
      await this.flushCurrentSegment();
    } catch (error) {
      console.error('❌ Segment rotation failed:', error);
      this.emit('transcript:error', error as Error);
    } finally {
      this.rotating = false;
    }
  }

  /** Discards the accumulated interim transcript; recording continues. */
  public clearInterim(): void {
    this.interimTranscript = '';
  }

  public cancelRecording(): void {
    if (this.state === RecordingState.IDLE) {
      return;
    }

    console.log('❌ Cancelling recording...');

    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop();
    }

    this.cleanup();
    this.setState(RecordingState.IDLE);

    console.log('✅ Recording cancelled');
  }

  // =============================================================================
  // AUDIO STREAM MANAGEMENT
  // =============================================================================

  private async initializeAudioStream(): Promise<void> {
    try {
      this.audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: this.config.sampleRate,
          channelCount: this.config.channels,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          throw new Error('Microphone permission denied. Please allow microphone access.');
        } else if (error.name === 'NotFoundError') {
          throw new Error('No microphone found. Please connect a microphone.');
        } else if (error.name === 'NotReadableError') {
          throw new Error('Microphone is already in use by another application.');
        }
      }
      throw new Error('Failed to access microphone: ' + error);
    }
  }

  private setupAudioAnalysis(): void {
    if (!this.audioStream) return;

    try {
      // Create audio context
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioContextClass();

      // Create analyser node
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.4;

      // Connect audio stream to analyser
      const source = this.audioContext.createMediaStreamSource(this.audioStream);
      source.connect(this.analyser);

      if (this.audioContext.state === 'suspended') {
        void this.audioContext.resume();
      }

      console.log('🔊 Audio analysis setup complete');
    } catch (error) {
      console.warn('Failed to setup audio analysis:', error);
    }
  }

  private initializeMediaRecorder(): void {
    if (!this.audioStream) {
      throw new Error('Audio stream not initialized');
    }

    try {
      // Determine the best format to use
      const mimeType = this.getBestMimeType();
      
      this.mediaRecorder = new MediaRecorder(this.audioStream, {
        mimeType: mimeType
      });

      // Set up event handlers
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.audioChunks.push(event.data);
          this.emit('recording:data', event.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        console.log('📼 MediaRecorder stopped');
      };

      this.mediaRecorder.onerror = (event) => {
        console.error('❌ MediaRecorder error:', event);
        this.emit('recording:error', new Error('Recording failed'));
      };

      console.log('📼 MediaRecorder initialized with format:', mimeType);
    } catch (error) {
      throw new Error('Failed to initialize MediaRecorder: ' + error);
    }
  }

  private getBestMimeType(): string {
    const preferredTypes = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
      'audio/wav'
    ];

    for (const type of preferredTypes) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    throw new Error('No supported audio format found');
  }

  // =============================================================================
  // VOLUME MONITORING & SILENCE DETECTION
  // =============================================================================

  private startVolumeMonitoring(): void {
    this.volumeMonitoringActive = true;
    this.monitorVolume();
  }

  private stopVolumeMonitoring(): void {
    this.volumeMonitoringActive = false;
    if (this.volumeAnimationFrame) {
      cancelAnimationFrame(this.volumeAnimationFrame);
      this.volumeAnimationFrame = null;
    }
  }

  private monitorVolume(): void {
    if (!this.volumeMonitoringActive || !this.analyser) {
      return;
    }

    if (this.audioContext && this.audioContext.state === 'suspended') {
      void this.audioContext.resume();
    }

    const bufferLength = this.analyser.fftSize;
    const dataArray = new Uint8Array(bufferLength);

    this.analyser.getByteTimeDomainData(dataArray);

    let sumSquares = 0;
    for (const value of dataArray) {
      const deviation = value - 128;
      sumSquares += deviation * deviation;
    }
    const rms = Math.sqrt(sumSquares / bufferLength) / 128;
    const volume = Math.min(1, rms * this.gain);

    this.emit('volume:change', volume);

    this.checkSilence(volume);
    this.checkSegmentLength();
    this.volumeAnimationFrame = requestAnimationFrame(() => this.monitorVolume());
  }

  /** Force-commits a segment once speech runs longer than the configured interval. */
  private checkSegmentLength(): void {
    if (this.maxSegmentMs <= 0 || !this.segmentHasSpeech) {
      return;
    }
    if (Date.now() - this.segmentStartedAt >= this.maxSegmentMs) {
      this.stopSilenceTimer();
      void this.rotateSegment();
    }
  }

  private checkSilence(volume: number): void {
    if (volume < this.config.silenceThreshold) {
      // Start silence timer if not already started
      if (!this.silenceTimer) {
        this.silenceTimer = setTimeout(() => {
          if (this.liveTranscript) {
            this.stopSilenceTimer();
            void this.rotateSegment();
          } else {
            console.log('🔇 Silence detected, auto-stopping recording');
            this.stopRecording();
          }
        }, this.liveTranscript ? this.phraseGapMs : this.config.silenceTimeout);
      }
    } else {
      this.segmentHasSpeech = true;
      this.segmentSpeechFrames += 1;
      // Cancel silence timer if volume detected
      this.stopSilenceTimer();
    }
  }

  private stopSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  // =============================================================================
  // RECORDING TIMERS
  // =============================================================================

  private startRecordingTimer(): void {
    this.recordingTimer = setTimeout(() => {
      console.log('⏰ Max recording duration reached, auto-stopping');
      this.stopRecording();
    }, this.config.maxDuration * 1000);
  }

  private stopRecordingTimer(): void {
    if (this.recordingTimer) {
      clearTimeout(this.recordingTimer);
      this.recordingTimer = null;
    }
  }

  // =============================================================================
  // AUDIO PROCESSING
  // =============================================================================

  private async finalizeRecorder(recorder: MediaRecorder): Promise<Blob> {
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(guard);
        resolve();
      };
      const guard = setTimeout(finish, 1000);
      recorder.onstop = (): void => {
        console.log('📼 MediaRecorder stopped');
        finish();
      };
    });

    const mimeType = recorder.mimeType || 'audio/webm';
    const audioBlob = new Blob(this.audioChunks, { type: mimeType });
    this.audioChunks = [];
    return audioBlob;
  }

  private async processAudioWithSTT(audioBlob: Blob): Promise<string | null> {
    try {
      console.log('🤖 Processing audio with Speech-to-Text...');
      
      // Load STT configuration
      const config = await window.electronAPI?.loadConfig();
      if (config?.voice && !config.voice.enabled) {
        console.log('Voice input is disabled, skipping transcription');
        return null;
      }
      if (!config?.taskAssignments?.stt) {
        console.log('No transcription model assigned, skipping transcription');
        return null;
      }

      // STT runs in the main process (privileged) — the renderer never
      // holds the API key and never talks to the STT endpoint directly.
      const wavBlob = await this.convertWebMToWav(audioBlob);
      const arrayBuffer = await wavBlob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      const transcript = await window.electronAPI.sttTranscribe(uint8Array);

      if (transcript) {
        this.emit('transcript:received', transcript);
        console.log('✅ Transcript received:', transcript);
      }
      return transcript;
    } catch (error) {
      console.error('❌ STT processing failed:', error);
      this.emit('transcript:error', error as Error);
      return null;
    }
  }

  private async convertWebMToWav(webmBlob: Blob): Promise<Blob> {
    return new Promise(async (resolve, reject) => {
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const fileReader = new FileReader();

        fileReader.onload = async (e) => {
          try {
            const arrayBuffer = e.target?.result as ArrayBuffer;
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            
            // Create WAV file
            const wavBuffer = this.audioBufferToWav(audioBuffer);
            const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });
            
            resolve(wavBlob);
          } catch (error) {
            reject(error);
          }
        };

        fileReader.onerror = (e) => reject(e);
        fileReader.readAsArrayBuffer(webmBlob);
      } catch (error) {
        reject(error);
      }
    });
  }

  private audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2 + 44;
    const out = new ArrayBuffer(length);
    const view = new DataView(out);
    const channels = [];
    let sample;
    let offset = 0;
    let pos = 0;

    // write WAVE header
    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8); // file length - 8
    setUint32(0x45564157); // "WAVE"

    setUint32(0x20746d66); // "fmt " chunk
    setUint32(16); // length = 16
    setUint16(1); // PCM (uncompressed)
    setUint16(numOfChan);
    setUint32(buffer.sampleRate);
    setUint32(buffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
    setUint16(numOfChan * 2); // block-align
    setUint16(16); // 16-bit (hardcoded in this example)

    setUint32(0x61746164); // "data" - chunk
    setUint32(length - pos - 4); // chunk length

    // write interleaved data
    for (let i = 0; i < buffer.numberOfChannels; i++)
      channels.push(buffer.getChannelData(i));

    while (pos < buffer.length) {
      for (let i = 0; i < numOfChan; i++) {
        // interleave channels
        sample = Math.max(-1, Math.min(1, channels[i][pos])); // clamp
        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0; // scale to 16-bit signed int
        view.setInt16(44 + offset, sample, true); // write 16-bit sample
        offset += 2;
      }
      pos++;
    }

    // helper functions
    function setUint16(data: number) {
      view.setUint16(pos, data, true);
      pos += 2;
    }

    function setUint32(data: number) {
      view.setUint32(pos, data, true);
      pos += 4;
    }

    return out;
  }

  // =============================================================================
  // STATE MANAGEMENT
  // =============================================================================

  private setState(newState: RecordingState): void {
    const oldState = this.state;
    this.state = newState;

    console.log(`🎤 Recording state: ${oldState} → ${newState}`);
    if (oldState !== newState) {
      this.emit('state:change', newState);
    }
  }

  public getState(): RecordingState {
    return this.state;
  }

  public isRecording(): boolean {
    return this.state === RecordingState.RECORDING;
  }

  public isProcessing(): boolean {
    return this.state === RecordingState.PROCESSING;
  }

  public getRecordingDuration(): number {
    if (this.state !== RecordingState.RECORDING) {
      return 0;
    }
    return (Date.now() - this.recordingStartTime) / 1000;
  }

  // =============================================================================
  // EVENT SYSTEM
  // =============================================================================

  public on<K extends keyof RecordingManagerEvents>(
    event: K,
    callback: RecordingManagerEvents[K]
  ): void {
    if (!this.eventCallbacks.has(event)) {
      this.eventCallbacks.set(event, []);
    }
    this.eventCallbacks.get(event)!.push(callback as (...args: unknown[]) => void);
  }

  public off<K extends keyof RecordingManagerEvents>(
    event: K,
    callback: RecordingManagerEvents[K]
  ): void {
    const callbacks = this.eventCallbacks.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback as (...args: unknown[]) => void);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  private emit<K extends keyof RecordingManagerEvents>(
    event: K,
    ...args: Parameters<RecordingManagerEvents[K]>
  ): void {
    const callbacks = this.eventCallbacks.get(event);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(...args);
        } catch (error) {
          console.error(`Error in recording event callback for ${event}:`, error);
        }
      });
    }
  }

  // =============================================================================
  // CONFIGURATION
  // =============================================================================

  public updateConfig(newConfig: Partial<RecordingConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('🔧 Recording configuration updated:', this.config);
  }

  public getConfig(): Readonly<RecordingConfig> {
    return { ...this.config };
  }

  // =============================================================================
  // CLEANUP
  // =============================================================================

  private cleanup(): void {
    // Stop timers
    this.stopRecordingTimer();
    this.stopSilenceTimer();
    this.stopVolumeMonitoring();
    
    // Clean up media
    if (this.audioStream) {
      this.audioStream.getTracks().forEach(track => track.stop());
      this.audioStream = null;
    }
    
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    this.analyser = null;
    this.mediaRecorder = null;
    
    // Clear audio data
    this.audioChunks = [];
  }

  public destroy(): void {
    console.log('🧹 Destroying RecordingManager...');
    
    // Cancel any ongoing recording
    if (this.state !== RecordingState.IDLE) {
      this.cancelRecording();
    }
    
    // Clean up resources
    this.cleanup();
    
    // Clear event callbacks
    this.eventCallbacks.clear();
    
    console.log('✅ RecordingManager destroyed');
  }

  // =============================================================================
  // UTILITY METHODS
  // =============================================================================

  public static async checkMicrophoneSupport(): Promise<boolean> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.some(device => device.kind === 'audioinput');
    } catch {
      return false;
    }
  }

  public static async getMicrophoneDevices(): Promise<MediaDeviceInfo[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(device => device.kind === 'audioinput');
    } catch {
      return [];
    }
  }

  public getRecordingStats(): {
    state: RecordingState;
    duration: number;
    dataSize: number;
    isSupported: boolean;
  } {
    return {
      state: this.state,
      duration: this.getRecordingDuration(),
      dataSize: this.audioChunks.reduce((size, chunk) => size + chunk.size, 0),
      isSupported: 'mediaDevices' in navigator && 'MediaRecorder' in window
    };
  }
}

// Global type declarations for WebKit browsers
declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}