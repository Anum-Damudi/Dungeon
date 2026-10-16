/**
 * server/trials.js
 * Pluggable trial system for the DUNGEON multiplayer social deduction game.
 */

const { v4: uuidv4 } = require('uuid');

const TRIAL_TYPES = {
  RUNE_MEMORY: 'rune-memory',
  LOCKPICK_RHYTHM: 'lockpick-rhythm',
  WORD_SCRAMBLE: 'word-scramble'
};

const DUNGEON_WORDS = [
  'dungeon', 'castle', 'throne', 'shadow', 'knight',
  'dragon', 'potion', 'sorcery', 'chalice', 'phantom',
  'crypt', 'torch', 'goblet', 'armor', 'raven',
  'skull', 'curse', 'blade', 'crown', 'spirit'
];

const RUNE_GLYPHS = [
  { id: 'fehu', symbol: 'ᚠ', name: 'Fehu' },
  { id: 'uruz', symbol: 'ᚢ', name: 'Uruz' },
  { id: 'thurisaz', symbol: 'ᚦ', name: 'Thurisaz' },
  { id: 'ansuz', symbol: 'ᚨ', name: 'Ansuz' },
  { id: 'raido', symbol: 'ᚱ', name: 'Raido' },
  { id: 'kenaz', symbol: 'ᚲ', name: 'Kenaz' },
  { id: 'gebo', symbol: 'ᚷ', name: 'Gebo' },
  { id: 'wunjo', symbol: 'ᚹ', name: 'Wunjo' },
  { id: 'hagalaz', symbol: 'ᚺ', name: 'Hagalaz' },
  { id: 'nauthiz', symbol: 'ᚾ', name: 'Nauthiz' },
  { id: 'isa', symbol: 'ᛁ', name: 'Isa' },
  { id: 'jera', symbol: 'ᛃ', name: 'Jera' },
  { id: 'eihwaz', symbol: 'ᛇ', name: 'Eihwaz' },
  { id: 'perthro', symbol: 'ᛈ', name: 'Perthro' },
  { id: 'algiz', symbol: 'ᛉ', name: 'Algiz' },
  { id: 'sowilo', symbol: 'ᛋ', name: 'Sowilo' }
];

// Active trials map: trialId -> trialData
const activeTrials = new Map();

/**
 * Utility: shuffle array (Fisher-Yates)
 */
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Helper to generate Rune Memory trial
 */
function generateRuneMemory(difficulty) {
  // Difficulty affects sequence length
  // 1: 4 runes, 2: 6 runes, 3: 8 runes
  let length = 4;
  if (difficulty === 2) length = 6;
  if (difficulty === 3) length = 8;

  const availableRunes = RUNE_GLYPHS;
  const sequence = [];

  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * availableRunes.length);
    sequence.push(availableRunes[randomIndex]);
  }

  const sequenceIds = sequence.map(r => r.id);

  return {
    data: {
      prompt: 'Memorize and reproduce the sequence of ancient runes.',
      sequenceLength: length,
      sequence: sequence, // shown to client during memorize phase
      pool: availableRunes
    },
    answer: sequenceIds
  };
}

/**
 * Helper to generate Lockpick Rhythm trial
 */
function generateLockpickRhythm(difficulty) {
  // Difficulty affects number of beats and tolerance
  let intervalCount = 4;
  let tolerance = 150; // ms

  if (difficulty === 2) {
    intervalCount = 5;
    tolerance = 140;
  } else if (difficulty === 3) {
    intervalCount = 6;
    tolerance = 125;
  }

  // Generate pattern of intervals between 300ms and 800ms
  const possibleIntervals = [300, 400, 500, 600, 700, 800];
  const intervals = [];
  for (let i = 0; i < intervalCount; i++) {
    const pick = possibleIntervals[Math.floor(Math.random() * possibleIntervals.length)];
    intervals.push(pick);
  }

  return {
    data: {
      prompt: 'Listen to the lockpick clicking rhythm and tap back the sequence with precise timing.',
      intervals: intervals,
      toleranceMs: tolerance,
      beatCount: intervals.length + 1
    },
    answer: {
      intervals: intervals,
      toleranceMs: tolerance
    }
  };
}

/**
 * Helper to generate Word Scramble trial
 */
function generateWordScramble(difficulty) {
  let wordPool = DUNGEON_WORDS;
  if (difficulty === 1) {
    wordPool = DUNGEON_WORDS.filter(w => w.length <= 5);
  } else if (difficulty === 2) {
    wordPool = DUNGEON_WORDS.filter(w => w.length === 6);
  } else if (difficulty === 3) {
    wordPool = DUNGEON_WORDS.filter(w => w.length >= 7);
  }

  if (wordPool.length === 0) wordPool = DUNGEON_WORDS;

  const targetWord = wordPool[Math.floor(Math.random() * wordPool.length)].toLowerCase();

  // Scramble word ensuring it's not identical to original
  let scrambled = targetWord;
  let attempts = 0;
  while ((scrambled === targetWord || attempts < 5) && targetWord.length > 1) {
    scrambled = shuffle(targetWord.split('')).join('');
    attempts++;
    if (scrambled !== targetWord) break;
  }

  return {
    data: {
      prompt: 'Decipher the anagram of this dark dungeon word.',
      scrambledWord: scrambled.toUpperCase(),
      wordLength: targetWord.length
    },
    answer: targetWord
  };
}

/**
 * Generates a trial of specified type and difficulty
 * @param {string} type - 'rune-memory' | 'lockpick-rhythm' | 'word-scramble'
 * @param {number} difficulty - 1 (easy), 2 (medium), 3 (hard)
 * @param {object} [options] - optional overrides e.g. { timeLimit: 45000 }
 * @returns {object} { trialId, type, difficulty, data, answer, timeLimit, createdAt }
 */
function generateTrial(type, difficulty = 1, options = {}) {
  const validDifficulty = Math.min(Math.max(parseInt(difficulty, 10) || 1, 1), 3);
  const trialId = uuidv4();

  let trialContent;
  switch (type) {
    case TRIAL_TYPES.RUNE_MEMORY:
      trialContent = generateRuneMemory(validDifficulty);
      break;
    case TRIAL_TYPES.LOCKPICK_RHYTHM:
      trialContent = generateLockpickRhythm(validDifficulty);
      break;
    case TRIAL_TYPES.WORD_SCRAMBLE:
    default:
      type = TRIAL_TYPES.WORD_SCRAMBLE;
      trialContent = generateWordScramble(validDifficulty);
      break;
  }

  // Time limit: null for untimed, or number in ms (e.g., 45000 for mafia)
  let timeLimit = null;
  if (options && options.timeLimit !== undefined) {
    timeLimit = options.timeLimit;
  }

  const trial = {
    trialId,
    type,
    difficulty: validDifficulty,
    data: trialContent.data,
    answer: trialContent.answer,
    timeLimit: timeLimit,
    createdAt: Date.now()
  };

  activeTrials.set(trialId, trial);

  // Auto clean up after 10 minutes to prevent memory leak
  setTimeout(() => {
    if (activeTrials.has(trialId)) {
      activeTrials.delete(trialId);
    }
  }, 10 * 60 * 1000).unref();

  return {
    trialId: trial.trialId,
    type: trial.type,
    difficulty: trial.difficulty,
    data: trial.data,
    answer: trial.answer,
    timeLimit: trial.timeLimit
  };
}

/**
 * Validates player answer against stored trial
 * @param {string} trialId - UUID of trial
 * @param {*} playerAnswer - Submitted answer from client
 * @returns {boolean} true if answer is correct, false otherwise
 */
function validateTrial(trialId, playerAnswer) {
  if (!trialId || !activeTrials.has(trialId)) {
    return false;
  }

  const trial = activeTrials.get(trialId);

  // Check time limit expiration if set
  if (trial.timeLimit && trial.timeLimit > 0) {
    const elapsed = Date.now() - trial.createdAt;
    // Allow small grace period of 3000ms for network latency
    if (elapsed > trial.timeLimit + 3000) {
      activeTrials.delete(trialId);
      return false;
    }
  }

  let isSuccess = false;

  switch (trial.type) {
    case TRIAL_TYPES.RUNE_MEMORY: {
      // playerAnswer can be an array of rune IDs or rune objects
      if (Array.isArray(playerAnswer) && Array.isArray(trial.answer)) {
        if (playerAnswer.length === trial.answer.length) {
          isSuccess = playerAnswer.every((item, idx) => {
            const val = (typeof item === 'object' && item !== null) ? (item.id || item.symbol || item.name) : item;
            return String(val).toLowerCase() === String(trial.answer[idx]).toLowerCase();
          });
        }
      }
      break;
    }

    case TRIAL_TYPES.LOCKPICK_RHYTHM: {
      // playerAnswer can be:
      // 1) Array of tap timestamps: [t0, t1, t2, ...]
      // 2) Array of tapped intervals: [i0, i1, ...]
      const expectedIntervals = trial.answer.intervals;
      const tolerance = trial.answer.toleranceMs || 150;

      if (Array.isArray(playerAnswer)) {
        let submittedIntervals = [];

        // Check if playerAnswer is timestamps or intervals
        if (playerAnswer.length === expectedIntervals.length + 1) {
          // Timestamps array
          for (let i = 0; i < playerAnswer.length - 1; i++) {
            submittedIntervals.push(Math.abs(playerAnswer[i + 1] - playerAnswer[i]));
          }
        } else if (playerAnswer.length === expectedIntervals.length) {
          // Direct intervals
          submittedIntervals = playerAnswer.map(n => Math.abs(Number(n)));
        }

        if (submittedIntervals.length === expectedIntervals.length) {
          isSuccess = submittedIntervals.every((interval, idx) => {
            const diff = Math.abs(interval - expectedIntervals[idx]);
            return diff <= tolerance;
          });
        }
      }
      break;
    }

    case TRIAL_TYPES.WORD_SCRAMBLE: {
      if (typeof playerAnswer === 'string') {
        const cleanAnswer = playerAnswer.trim().toLowerCase();
        isSuccess = cleanAnswer === String(trial.answer).toLowerCase();
      }
      break;
    }

    default:
      isSuccess = false;
  }

  // Once validated, delete trial so it cannot be re-used
  activeTrials.delete(trialId);

  return isSuccess;
}

module.exports = {
  generateTrial,
  validateTrial,
  TRIAL_TYPES,
  DUNGEON_WORDS,
  RUNE_GLYPHS,
  activeTrials
};
