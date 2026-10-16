/**
 * DUNGEON - Web Audio API Procedural Sound Manager
 * Generates all sound effects and ambient atmospheres procedurally without external assets.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AudioManager = factory();
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  let audioCtx = null;
  let masterGain = null;
  let droneOsc = null;
  let droneOscSub = null;
  let droneGain = null;
  let isDronePlaying = false;

  // Sound enabled state synced with localStorage
  let soundEnabled = true;
  try {
    const saved = localStorage.getItem('dungeon-sound-enabled');
    if (saved !== null) {
      soundEnabled = saved === 'true';
    }
  } catch (e) {
    soundEnabled = true;
  }

  /**
   * Lazily initialize AudioContext to adhere to browser autoplay policies.
   */
  function getAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
        masterGain = audioCtx.createGain();
        masterGain.gain.setValueAtTime(soundEnabled ? 1 : 0, audioCtx.currentTime);
        masterGain.connect(audioCtx.destination);
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  /**
   * Wax Seal Click:
   * Short percussive click produced by a 50ms white noise burst through a bandpass filter.
   */
  function playWaxSealClick() {
    const ctx = getAudioContext();
    if (!ctx || !soundEnabled) return;

    const bufferSize = Math.floor(ctx.sampleRate * 0.05); // 50ms
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, ctx.currentTime);
    filter.Q.setValueAtTime(3.5, ctx.currentTime);

    const gainNode = ctx.createGain();
    const now = ctx.currentTime;
    gainNode.gain.setValueAtTime(0.8, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    whiteNoise.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(masterGain);

    whiteNoise.start(now);
    whiteNoise.stop(now + 0.05);
  }

  /**
   * Dawn Bell:
   * Resonant bell tone (sine wave at 800Hz, exponential decay over 2s,
   * with a detuned 804Hz oscillator creating harmonic shimmer).
   */
  function playDawnBell() {
    const ctx = getAudioContext();
    if (!ctx || !soundEnabled) return;

    const now = ctx.currentTime;
    const duration = 2.2;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const bellGain = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(800, now);

    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(804, now); // 4Hz shimmer detune

    bellGain.gain.setValueAtTime(0.7, now);
    bellGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc1.connect(bellGain);
    osc2.connect(bellGain);
    bellGain.connect(masterGain);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + duration);
    osc2.stop(now + duration);
  }

  /**
   * Heartbeat:
   * Two low thuds (sine at 40Hz, 100ms each, 200ms apart).
   */
  function playHeartbeat() {
    const ctx = getAudioContext();
    if (!ctx || !soundEnabled) return;

    const now = ctx.currentTime;

    function triggerThud(startTime) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(58, startTime);
      osc.frequency.exponentialRampToValueAtTime(38, startTime + 0.1);

      gain.gain.setValueAtTime(0.9, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.1);

      osc.connect(gain);
      gain.connect(masterGain);

      osc.start(startTime);
      osc.stop(startTime + 0.1);
    }

    triggerThud(now);
    triggerThud(now + 0.2);
  }

  /**
   * Vote Chime:
   * Short rising chime (sine sweep 400Hz -> 800Hz over 300ms).
   */
  function playVoteChime() {
    const ctx = getAudioContext();
    if (!ctx || !soundEnabled) return;

    const now = ctx.currentTime;
    const duration = 0.35;

    const osc = ctx.createOscillator();
    const chimeGain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.28);

    chimeGain.gain.setValueAtTime(0.6, now);
    chimeGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(chimeGain);
    chimeGain.connect(masterGain);

    osc.start(now);
    osc.stop(now + duration);
  }

  /**
   * Death Knell:
   * Low ominous tone (sine at 100Hz + sawtooth at 50Hz, slow decay 3s).
   */
  function playDeathKnell() {
    const ctx = getAudioContext();
    if (!ctx || !soundEnabled) return;

    const now = ctx.currentTime;
    const duration = 3.0;

    const oscSine = ctx.createOscillator();
    const oscSaw = ctx.createOscillator();
    const knellFilter = ctx.createBiquadFilter();
    const knellGain = ctx.createGain();

    oscSine.type = 'sine';
    oscSine.frequency.setValueAtTime(100, now);
    oscSine.frequency.exponentialRampToValueAtTime(85, now + duration);

    oscSaw.type = 'sawtooth';
    oscSaw.frequency.setValueAtTime(50, now);
    oscSaw.frequency.exponentialRampToValueAtTime(42, now + duration);

    knellFilter.type = 'lowpass';
    knellFilter.frequency.setValueAtTime(260, now);

    knellGain.gain.setValueAtTime(0.7, now);
    knellGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscSine.connect(knellFilter);
    oscSaw.connect(knellFilter);
    knellFilter.connect(knellGain);
    knellGain.connect(masterGain);

    oscSine.start(now);
    oscSaw.start(now);
    oscSine.stop(now + duration);
    oscSaw.stop(now + duration);
  }

  /**
   * Ambient Drone:
   * Low continuous drone (~60Hz oscillator with lowpass filter), loops.
   */
  function startDrone() {
    if (isDronePlaying || !soundEnabled) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    droneGain = ctx.createGain();
    droneGain.gain.setValueAtTime(0.0001, now);
    droneGain.gain.linearRampToValueAtTime(0.25, now + 2.0); // smooth fade in

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(140, now);

    droneOsc = ctx.createOscillator();
    droneOsc.type = 'triangle';
    droneOsc.frequency.setValueAtTime(58.27, now); // ~A#1

    droneOscSub = ctx.createOscillator();
    droneOscSub.type = 'sine';
    droneOscSub.frequency.setValueAtTime(29.14, now); // sub-octave

    droneOsc.connect(filter);
    droneOscSub.connect(filter);
    filter.connect(droneGain);
    droneGain.connect(masterGain);

    droneOsc.start(now);
    droneOscSub.start(now);
    isDronePlaying = true;
  }

  function stopDrone() {
    if (!isDronePlaying || !droneGain || !audioCtx) return;
    const now = audioCtx.currentTime;
    try {
      droneGain.gain.cancelScheduledValues(now);
      droneGain.gain.setValueAtTime(droneGain.gain.value, now);
      droneGain.gain.linearRampToValueAtTime(0.0001, now + 1.0); // smooth fade out
      setTimeout(() => {
        if (droneOsc) {
          try { droneOsc.stop(); } catch (e) {}
          droneOsc.disconnect();
          droneOsc = null;
        }
        if (droneOscSub) {
          try { droneOscSub.stop(); } catch (e) {}
          droneOscSub.disconnect();
          droneOscSub = null;
        }
        isDronePlaying = false;
      }, 1050);
    } catch (e) {
      isDronePlaying = false;
    }
  }

  /**
   * Play named sound effect.
   */
  function play(soundName) {
    if (!soundEnabled) return;
    getAudioContext();

    switch (soundName) {
      case 'waxSealClick':
        playWaxSealClick();
        break;
      case 'dawnBell':
        playDawnBell();
        break;
      case 'heartbeat':
        playHeartbeat();
        break;
      case 'voteChime':
        playVoteChime();
        break;
      case 'deathKnell':
        playDeathKnell();
        break;
      case 'ambientDrone':
        startDrone();
        break;
      default:
        console.warn('[AudioManager] Unknown sound:', soundName);
    }
  }

  /**
   * Toggle global sound enabled state.
   */
  function toggleSound() {
    soundEnabled = !soundEnabled;
    try {
      localStorage.setItem('dungeon-sound-enabled', String(soundEnabled));
    } catch (e) {}

    const ctx = getAudioContext();
    if (ctx && masterGain) {
      const now = ctx.currentTime;
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setValueAtTime(soundEnabled ? 1 : 0, now);
    }

    if (!soundEnabled) {
      stopDrone();
    } else {
      startDrone();
    }

    return soundEnabled;
  }

  function isEnabled() {
    return soundEnabled;
  }

  function setEnabled(enabled) {
    if (soundEnabled !== enabled) {
      toggleSound();
    }
  }

  // Pre-bind user interaction listener to wake up AudioContext
  if (typeof window !== 'undefined') {
    const unlockAudio = function () {
      getAudioContext();
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
    window.addEventListener('click', unlockAudio, { passive: true });
    window.addEventListener('touchstart', unlockAudio, { passive: true });
    window.addEventListener('keydown', unlockAudio, { passive: true });
  }

  return {
    play: play,
    toggleSound: toggleSound,
    isEnabled: isEnabled,
    setEnabled: setEnabled,
    startDrone: startDrone,
    stopDrone: stopDrone
  };
});
