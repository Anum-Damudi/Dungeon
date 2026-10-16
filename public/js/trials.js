/**
 * DUNGEON - Client-side Trial Rendering & Input Capture
 * Renders interactive minigames: Rune Memory, Lockpick Rhythm, and Word Scramble.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const trialModule = factory();
    root.renderTrial = trialModule.renderTrial;
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  const ALL_RUNES = ['ᚠ', 'ᚢ', 'ᚦ', 'ᚨ', 'ᚱ', 'ᚲ', 'ᚷ', 'ᚹ', 'ᚺ', 'ᚾ', 'ᛁ', 'ᛃ'];

  let activeCleanup = null;

  /**
   * Main trial dispatcher.
   * @param {HTMLElement} container - DOM container element where the trial UI is injected.
   * @param {Object} trialData - Trial specification from server.
   * @param {Function} onComplete - Callback receiving { success, answer, ... }.
   */
  function renderTrial(container, trialData, onComplete) {
    if (!container) return;

    // Clean up any previously running trial
    if (typeof activeCleanup === 'function') {
      activeCleanup();
      activeCleanup = null;
    }

    container.innerHTML = '';
    container.style.display = 'block';

    let completed = false;
    let timerCleanup = null;

    function completeWrapper(result) {
      if (completed) return;
      completed = true;
      if (timerCleanup) {
        timerCleanup();
        timerCleanup = null;
      }
      if (activeCleanup) {
        activeCleanup();
        activeCleanup = null;
      }
      if (typeof onComplete === 'function') {
        onComplete(result);
      }
    }

    // Check if timed
    const timeLimit = trialData.timeLimit || (trialData.timed ? 15000 : 0);
    if (timeLimit > 0) {
      timerCleanup = setupTimerBar(container, timeLimit, () => {
        completeWrapper({
          type: trialData.type || trialData.trialType,
          success: false,
          timeout: true,
          answer: null
        });
      });
    }

    const type = trialData.type || trialData.trialType || 'rune-memory';

    switch (type) {
      case 'rune-memory':
      case 'rune_memory':
        activeCleanup = renderRuneMemory(container, trialData, completeWrapper);
        break;

      case 'lockpick-rhythm':
      case 'lockpick_rhythm':
        activeCleanup = renderLockpickRhythm(container, trialData, completeWrapper);
        break;

      case 'word-scramble':
      case 'word_scramble':
        activeCleanup = renderWordScramble(container, trialData, completeWrapper);
        break;

      default:
        console.warn('[Trials] Unknown trial type:', type);
        completeWrapper({ success: true, answer: null, fallback: true });
        break;
    }
  }

  /**
   * Timer Bar Component
   */
  function setupTimerBar(container, durationMs, onTimeout) {
    const timerWrapper = document.createElement('div');
    timerWrapper.className = 'trial-timer-container';
    timerWrapper.innerHTML = `
      <div class="trial-timer-track">
        <div class="trial-timer-fill" style="width: 100%;"></div>
      </div>
    `;
    container.appendChild(timerWrapper);

    const fill = timerWrapper.querySelector('.trial-timer-fill');
    const startTime = performance.now();
    let animId = null;
    let timeoutId = null;

    function step(now) {
      const elapsed = now - startTime;
      const remainingPercent = Math.max(0, 100 - (elapsed / durationMs) * 100);
      if (fill) {
        fill.style.width = remainingPercent + '%';
        if (remainingPercent < 25) {
          fill.style.backgroundColor = '#e74c3c';
        } else if (remainingPercent < 55) {
          fill.style.backgroundColor = '#f39c12';
        }
      }
      if (elapsed < durationMs) {
        animId = requestAnimationFrame(step);
      }
    }

    animId = requestAnimationFrame(step);
    timeoutId = setTimeout(() => {
      onTimeout();
    }, durationMs);

    return function cleanupTimer() {
      if (animId) cancelAnimationFrame(animId);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }

  /**
   * 1. Rune Memory Trial
   */
  function renderRuneMemory(container, data, onComplete) {
    const sequence = Array.isArray(data.sequence) && data.sequence.length > 0
      ? data.sequence
      : ['ᚠ', 'ᚢ', 'ᚦ', 'ᚨ'];
    const showTime = data.showTime || 3000;

    const trialBox = document.createElement('div');
    trialBox.className = 'trial-box rune-memory-trial';
    trialBox.innerHTML = `
      <h3 class="trial-title">The Rite of Memory</h3>
      <p id="rune-instruction" class="trial-instruction">Memorize the arcane glyphs...</p>
      
      <div id="rune-sequence-display" class="rune-display-sequence">
        ${sequence.map(r => `<span class="rune-glyph-card revealed">${r}</span>`).join('')}
      </div>

      <div id="rune-input-slots" class="rune-input-slots" style="display: none;">
        ${sequence.map((_, i) => `<span class="rune-slot" data-index="${i}">?</span>`).join('')}
      </div>

      <div id="rune-keypad" class="rune-keypad" style="display: none;"></div>

      <div id="rune-controls" class="rune-controls" style="display: none;">
        <button id="btn-rune-clear" class="btn btn-secondary btn-sm">Clear</button>
      </div>
    `;
    container.appendChild(trialBox);

    const instruction = trialBox.querySelector('#rune-instruction');
    const seqDisplay = trialBox.querySelector('#rune-sequence-display');
    const inputSlotsContainer = trialBox.querySelector('#rune-input-slots');
    const keypad = trialBox.querySelector('#rune-keypad');
    const controls = trialBox.querySelector('#rune-controls');
    const clearBtn = trialBox.querySelector('#btn-rune-clear');

    let enteredRunes = [];
    let revealTimer = null;

    // Rune pool: all 12 runes shuffled or displayed in order
    ALL_RUNES.forEach(rune => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rune-btn';
      btn.textContent = rune;
      btn.setAttribute('aria-label', `Rune ${rune}`);
      btn.addEventListener('click', () => {
        if (enteredRunes.length < sequence.length) {
          enteredRunes.push(rune);
          updateSlots();
          if (window.AudioManager) {
            window.AudioManager.play('waxSealClick');
          }
          if (enteredRunes.length === sequence.length) {
            evaluateRuneMemory();
          }
        }
      });
      keypad.appendChild(btn);
    });

    clearBtn.addEventListener('click', () => {
      enteredRunes = [];
      updateSlots();
    });

    function updateSlots() {
      const slots = inputSlotsContainer.querySelectorAll('.rune-slot');
      slots.forEach((slot, idx) => {
        if (enteredRunes[idx]) {
          slot.textContent = enteredRunes[idx];
          slot.classList.add('filled');
        } else {
          slot.textContent = '?';
          slot.classList.remove('filled');
        }
      });
    }

    function evaluateRuneMemory() {
      const isMatch = sequence.every((val, i) => val === enteredRunes[i]);
      const slots = inputSlotsContainer.querySelectorAll('.rune-slot');
      slots.forEach(s => s.classList.add(isMatch ? 'success' : 'failure'));

      setTimeout(() => {
        onComplete({
          type: 'rune-memory',
          success: isMatch,
          answer: enteredRunes
        });
      }, 500);
    }

    // Hide sequence after showTime and switch to recall mode
    revealTimer = setTimeout(() => {
      if (!seqDisplay) return;
      seqDisplay.style.display = 'none';
      inputSlotsContainer.style.display = 'flex';
      keypad.style.display = 'grid';
      controls.style.display = 'flex';
      instruction.textContent = 'Recreate the sacred sequence in order:';
    }, showTime);

    return function cleanup() {
      if (revealTimer) clearTimeout(revealTimer);
    };
  }

  /**
   * 2. Lockpick Rhythm Trial
   */
  function renderLockpickRhythm(container, data, onComplete) {
    const pattern = Array.isArray(data.pattern) && data.pattern.length > 0
      ? data.pattern
      : [500, 300, 700, 400];
    const tolerance = data.tolerance || 180;
    const totalBeats = pattern.length + 1;

    const trialBox = document.createElement('div');
    trialBox.className = 'trial-box lockpick-trial';
    trialBox.innerHTML = `
      <h3 class="trial-title">The Locksmith's Cadence</h3>
      <p id="lockpick-status" class="trial-instruction">Listen closely to the tumblers...</p>
      
      <div id="beat-indicators" class="beat-indicators">
        ${Array.from({ length: totalBeats }).map((_, i) => `<span class="beat-circle" data-beat="${i}"></span>`).join('')}
      </div>

      <div class="lockpick-action">
        <button id="btn-pick-lock" class="btn btn-primary btn-lockpick" disabled>
          <span class="lock-icon">🔒</span> Pick Lock (Tap Space or Click)
        </button>
      </div>

      <p id="lockpick-feedback" class="lockpick-feedback">Memorizing cadence...</p>
    `;
    container.appendChild(trialBox);

    const statusText = trialBox.querySelector('#lockpick-status');
    const feedbackText = trialBox.querySelector('#lockpick-feedback');
    const pickBtn = trialBox.querySelector('#btn-pick-lock');
    const circles = trialBox.querySelectorAll('.beat-circle');

    const scheduledTimeouts = [];
    let isUserTurn = false;
    let tapTimestamps = [];

    // Visual pulse for demo beat
    function pulseBeat(index) {
      if (circles[index]) {
        circles[index].classList.add('pulse');
        setTimeout(() => {
          if (circles[index]) circles[index].classList.remove('pulse');
        }, 220);
      }
      if (window.AudioManager) {
        window.AudioManager.play('waxSealClick');
      }
    }

    // Play demo rhythm pattern
    let cumulativeTime = 400;
    scheduledTimeouts.push(setTimeout(() => pulseBeat(0), cumulativeTime));

    for (let i = 0; i < pattern.length; i++) {
      cumulativeTime += pattern[i];
      const beatIdx = i + 1;
      scheduledTimeouts.push(setTimeout(() => pulseBeat(beatIdx), cumulativeTime));
    }

    // Start user turn after demo finishes
    const demoEndTime = cumulativeTime + 600;
    scheduledTimeouts.push(setTimeout(() => {
      isUserTurn = true;
      statusText.textContent = 'Now replicate the rhythm!';
      feedbackText.textContent = `Tap ${totalBeats} times to the cadence.`;
      pickBtn.disabled = false;
      pickBtn.classList.add('pulse-ready');
    }, demoEndTime));

    function handleTap() {
      if (!isUserTurn) return;

      const now = performance.now();
      tapTimestamps.push(now);

      const tapIndex = tapTimestamps.length - 1;
      if (circles[tapIndex]) {
        circles[tapIndex].classList.add('user-tap');
      }

      if (window.AudioManager) {
        window.AudioManager.play('waxSealClick');
      }

      feedbackText.textContent = `Tumbler ${tapIndex + 1} of ${totalBeats}`;

      if (tapTimestamps.length >= totalBeats) {
        // Evaluate rhythm
        isUserTurn = false;
        pickBtn.disabled = true;

        const userIntervals = [];
        for (let i = 0; i < tapTimestamps.length - 1; i++) {
          userIntervals.push(Math.round(tapTimestamps[i + 1] - tapTimestamps[i]));
        }

        let passed = true;
        for (let i = 0; i < pattern.length; i++) {
          const diff = Math.abs(userIntervals[i] - pattern[i]);
          if (diff > tolerance) {
            passed = false;
            break;
          }
        }

        if (passed) {
          statusText.textContent = 'Lock picked successfully!';
          circles.forEach(c => c.classList.add('success'));
        } else {
          statusText.textContent = 'The tumbler jammed!';
          circles.forEach(c => c.classList.add('failure'));
        }

        setTimeout(() => {
          onComplete({
            type: 'lockpick-rhythm',
            success: passed,
            answer: tapTimestamps,
            intervals: userIntervals
          });
        }, 600);
      }
    }

    pickBtn.addEventListener('click', handleTap);

    const onKeydown = (e) => {
      if (e.code === 'Space' && isUserTurn) {
        e.preventDefault();
        handleTap();
      }
    };
    window.addEventListener('keydown', onKeydown);

    return function cleanup() {
      scheduledTimeouts.forEach(t => clearTimeout(t));
      window.removeEventListener('keydown', onKeydown);
    };
  }

  /**
   * 3. Word Scramble Trial
   */
  function renderWordScramble(container, data, onComplete) {
    const scrambled = (data.scrambled || 'GORADN').toUpperCase();
    const wordLength = data.wordLength || scrambled.length;
    const targetWord = (data.originalWord || data.solution || '').toUpperCase();

    const trialBox = document.createElement('div');
    trialBox.className = 'trial-box word-scramble-trial';
    trialBox.innerHTML = `
      <h3 class="trial-title">The Cryptic Cipher</h3>
      <p class="trial-instruction">Unscramble the ancient runes (${wordLength} letters):</p>
      
      <div class="scramble-tiles">
        ${scrambled.split('').map(letter => `<span class="scramble-tile">${letter}</span>`).join('')}
      </div>

      <form id="scramble-form" class="scramble-form">
        <input 
          type="text" 
          id="scramble-input" 
          class="scramble-input" 
          maxlength="${wordLength}" 
          placeholder="ENTER WORD" 
          autocomplete="off" 
          autocapitalize="characters"
          spellcheck="false" 
          required
        />
        <button type="submit" id="btn-scramble-submit" class="btn btn-primary">Break Cipher</button>
      </form>
    `;
    container.appendChild(trialBox);

    const form = trialBox.querySelector('#scramble-form');
    const input = trialBox.querySelector('#scramble-input');

    // Auto-focus input
    setTimeout(() => {
      if (input) input.focus();
    }, 100);

    input.addEventListener('input', () => {
      input.value = input.value.toUpperCase().replace(/[^A-Z]/g, '');
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const answer = input.value.trim().toUpperCase();
      if (!answer) return;

      const isCorrect = targetWord ? answer === targetWord : answer.length === wordLength;

      if (isCorrect) {
        input.classList.add('input-success');
      } else {
        input.classList.add('input-error');
      }

      setTimeout(() => {
        onComplete({
          type: 'word-scramble',
          answer: answer,
          success: isCorrect
        });
      }, 400);
    });

    return function cleanup() {
      // no background timers
    };
  }

  return {
    renderTrial: renderTrial
  };
});
