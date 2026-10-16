/**
 * server/gameManager.js
 * Core game state management and rules logic for DUNGEON.
 */

const { v4: uuidv4 } = require('uuid');
const { generateTrial, validateTrial, TRIAL_TYPES } = require('./trials');

// Role definitions
const ROLES = {
  MODERATOR: 'moderator',
  DOCTOR: 'doctor',
  DETECTIVE: 'detective',
  MAFIA: 'mafia',
  CITIZEN: 'citizen'
};

// Phase definitions
const PHASES = {
  LOBBY: 'LOBBY',
  ROLE_REVEAL: 'ROLE_REVEAL',
  RULES_DISPLAY: 'RULES_DISPLAY',
  NIGHT: 'NIGHT',
  NIGHT_RESOLUTION: 'NIGHT_RESOLUTION',
  DAWN: 'DAWN',
  VOTING: 'VOTING',
  VOTE_RESULT: 'VOTE_RESULT',
  GAME_OVER: 'GAME_OVER'
};

// Channels for chat
const CHAT_CHANNELS = {
  DAY: 'dayChat',
  MAFIA: 'mafiaChat',
  GHOST: 'ghostChat'
};

class GameManager {
  constructor() {
    // Map<roomCode, Room>
    this.rooms = new Map();
    // Map<sessionToken, { roomCode, playerId }>
    this.sessions = new Map();
    // Map<socketId, sessionToken>
    this.socketToSession = new Map();
    // Socket.io instance reference
    this.io = null;
  }

  /**
   * Set the Socket.IO server instance for broadcasting events
   */
  setIo(ioInstance) {
    this.io = ioInstance;
  }

  /**
   * Generate a unique 4-letter uppercase room code
   */
  generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = '';
    let attempts = 0;
    do {
      code = '';
      for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      attempts++;
      if (attempts > 10000) {
        throw new Error('Failed to generate unique room code');
      }
    } while (this.rooms.has(code));
    return code;
  }

  /**
   * HTML Sanitization to strip all tags
   */
  sanitizeText(text) {
    if (!text || typeof text !== 'string') return '';
    return text.replace(/<[^>]*>?/gm, '').trim();
  }

  /**
   * Create a new game room
   * Moderator creates the room, gets moderator role, does not play in player pool
   */
  createRoom(playerName, socketId = null) {
    const cleanName = this.sanitizeText(playerName) || 'Moderator';
    const code = this.generateRoomCode();
    const sessionToken = uuidv4();

    const moderator = {
      id: sessionToken,
      name: cleanName,
      socketId: socketId,
      role: ROLES.MODERATOR,
      isModerator: true,
      alive: true,
      hasShield: false,
      connected: true,
      envelopeOpened: true,
      rulesAcknowledged: true,
      joinedAt: Date.now(),
      lastChatMessageAt: 0
    };

    const room = {
      code,
      phase: PHASES.LOBBY,
      round: 0,
      moderatorId: sessionToken,
      players: new Map(), // Map<sessionToken, Player>
      nightActions: {
        doctorSave: null,       // { targetId, success, trialCompleted }
        shieldAttempts: new Map(), // Map<sessionToken, { success, trialCompleted }>
        mafiaKill: null,        // { targetId, success, trialCompleted, selectedBy }
        mafiaTrialFailed: false,
        detectiveClue: null     // { targetId, clue, success, trialCompleted }
      },
      votes: new Map(),         // Map<voterSessionId, targetPlayerId>
      butterflies: new Set(),   // Set<sessionToken>
      actionLog: [],            // Array<{ timestamp, round, phase, type, text, details, public }>
      mafiaChat: [],            // Array<{ id, senderId, senderName, text, timestamp }>
      ghostChat: [],            // Array<{ id, senderId, senderName, text, timestamp }>
      dayChat: [],              // Array<{ id, senderId, senderName, text, timestamp }>
      createdAt: Date.now(),
      paused: false,
      winner: null,
      clues: new Map(),         // Map<detectiveSessionId, string>
      sharedClues: [],          // Array<{ from, to, clue, timestamp }>
      pendingRecruit: null,     // { targetId, offeredBy, timeout }
      pendingMafiaDeathChoice: false
    };

    room.players.set(sessionToken, moderator);
    this.rooms.set(code, room);
    this.sessions.set(sessionToken, { roomCode: code, playerId: sessionToken });
    if (socketId) {
      this.socketToSession.set(socketId, sessionToken);
    }

    this.logAction(room, 'ROOM_CREATED', `Room ${code} created by moderator ${cleanName}.`, { moderator: cleanName }, true);

    return {
      code,
      sessionToken,
      player: moderator
    };
  }

  /**
   * Join an existing game room
   */
  joinRoom(code, playerName, socketId = null) {
    if (!code) {
      throw new Error('Room code is required.');
    }
    const cleanCode = code.toUpperCase().trim();
    if (!this.rooms.has(cleanCode)) {
      throw new Error(`Room ${cleanCode} does not exist.`);
    }

    const room = this.rooms.get(cleanCode);

    if (room.phase !== PHASES.LOBBY) {
      throw new Error(`Room ${cleanCode} has already started.`);
    }

    const cleanName = this.sanitizeText(playerName) || 'Citizen';

    // Verify name uniqueness within room
    for (const player of room.players.values()) {
      if (player.name.toLowerCase() === cleanName.toLowerCase()) {
        throw new Error(`Name "${cleanName}" is already taken in this room.`);
      }
    }

    const sessionToken = uuidv4();
    const player = {
      id: sessionToken,
      name: cleanName,
      socketId: socketId,
      role: null,
      isModerator: false,
      alive: true,
      hasShield: false,
      connected: true,
      envelopeOpened: false,
      rulesAcknowledged: false,
      joinedAt: Date.now(),
      lastChatMessageAt: 0
    };

    room.players.set(sessionToken, player);
    this.sessions.set(sessionToken, { roomCode: cleanCode, playerId: sessionToken });
    if (socketId) {
      this.socketToSession.set(socketId, sessionToken);
    }

    this.logAction(room, 'PLAYER_JOINED', `${cleanName} joined the dungeon.`, { name: cleanName }, true);

    this.broadcastRoomState(room);

    return {
      sessionToken,
      player,
      players: Array.from(room.players.values()).map(p => this.sanitizePlayerInfo(p, sessionToken, room)),
      room: {
        code: room.code,
        phase: room.phase
      }
    };
  }

  /**
   * Helper to retrieve room and player by sessionToken
   */
  getRoomAndPlayer(sessionToken) {
    if (!sessionToken || !this.sessions.has(sessionToken)) {
      return { room: null, player: null };
    }
    const { roomCode, playerId } = this.sessions.get(sessionToken);
    const room = this.rooms.get(roomCode);
    if (!room) return { room: null, player: null };
    const player = room.players.get(playerId);
    return { room, player };
  }

  /**
   * Start the game (moderator only)
   * Assigns roles according to exact rules:
   * - Moderator: room creator (does NOT play, not in pool)
   * - Doctor: exactly 1
   * - Detective: exactly 1
   * - Mafia: Math.floor(playerCount / 6) minimum 1
   * - Citizen: all remaining players
   */
  startGame(sessionToken) {
    const { room, player } = this.getRoomAndPlayer(sessionToken);
    if (!room) throw new Error('Invalid session token.');
    if (!player || !player.isModerator) {
      throw new Error('Only the moderator can start the game.');
    }
    if (room.phase !== PHASES.LOBBY) {
      throw new Error('Game has already started.');
    }

    // Get non-moderator players
    const candidates = Array.from(room.players.values()).filter(p => !p.isModerator);
    if (candidates.length < 3) {
      throw new Error('Need at least 3 players (excluding moderator) to start the game.');
    }

    const playerCount = candidates.length;
    // Calculate Mafia count: 1 per 6 players, minimum 1
    const mafiaCount = Math.max(1, Math.floor(playerCount / 6));
    const doctorCount = 1;
    const detectiveCount = 1;

    // Shuffle candidates
    const shuffled = [...candidates];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    let index = 0;
    // Assign Mafia
    for (let m = 0; m < mafiaCount && index < shuffled.length; m++) {
      shuffled[index].role = ROLES.MAFIA;
      index++;
    }
    // Assign Doctor
    if (index < shuffled.length) {
      shuffled[index].role = ROLES.DOCTOR;
      index++;
    }
    // Assign Detective
    if (index < shuffled.length) {
      shuffled[index].role = ROLES.DETECTIVE;
      index++;
    }
    // Assign Citizens
    while (index < shuffled.length) {
      shuffled[index].role = ROLES.CITIZEN;
      index++;
    }

    // Reset player state flags
    candidates.forEach(p => {
      p.alive = true;
      p.hasShield = false;
      p.envelopeOpened = false;
      p.rulesAcknowledged = false;
    });

    // Start with the 12 sacred rules displayed
    room.phase = PHASES.RULES_DISPLAY;
    room.round = 1;
    room.butterflies.clear();
    room.votes.clear();
    this.resetNightActions(room);

    this.logAction(
      room,
      'GAME_STARTED',
      `Game started by moderator. The 12 sacred laws of the dungeon are displayed.`,
      { playerCount, mafiaCount },
      true
    );

    this.broadcastRoomState(room);
    return { success: true, phase: room.phase, round: room.round };
  }

  /**
   * Handle player acknowledging rules
   * When all players acknowledge rules, transition to ROLE_REVEAL
   */
  handleRulesAcknowledged(sessionToken) {
    const { room, player } = this.getRoomAndPlayer(sessionToken);
    if (!room || !player) throw new Error('Invalid session token.');
    if (room.phase !== PHASES.RULES_DISPLAY) {
      throw new Error('Rules can only be acknowledged during RULES_DISPLAY phase.');
    }

    player.rulesAcknowledged = true;
    this.logAction(room, 'RULES_ACKNOWLEDGED', `${player.name} acknowledged dungeon rules.`, { playerId: player.id }, false);

    const nonModPlayers = Array.from(room.players.values()).filter(p => !p.isModerator);
    const allAcknowledged = nonModPlayers.every(p => p.rulesAcknowledged);
    if (allAcknowledged) {
      room.phase = PHASES.ROLE_REVEAL;
      this.logAction(room, 'PHASE_CHANGE', `All players acknowledged rules. Sealed role envelopes revealed.`, {}, true);
    }

    this.broadcastRoomState(room);
    return { success: true, allAcknowledged, phase: room.phase };
  }

  /**
   * Handle player opening their role envelope (double-click)
   * When all players open their envelopes, transition to NIGHT phase
   */
  handleEnvelopeOpened(sessionToken) {
    const { room, player } = this.getRoomAndPlayer(sessionToken);
    if (!room || !player) throw new Error('Invalid session token.');
    if (room.phase !== PHASES.ROLE_REVEAL) {
      throw new Error('Envelopes can only be opened during ROLE_REVEAL phase.');
    }

    player.envelopeOpened = true;
    this.logAction(room, 'ENVELOPE_OPENED', `${player.name} broke the wax seal and revealed their private role.`, { playerId: player.id }, false);

    // If all living non-moderator players have opened envelope, advance to NIGHT
    const nonModPlayers = Array.from(room.players.values()).filter(p => !p.isModerator);
    const allOpened = nonModPlayers.every(p => p.envelopeOpened);
    if (allOpened) {
      this.transitionToNight(room);
    }

    this.broadcastRoomState(room);
    return { success: true, allOpened, role: player.role, phase: room.phase };
  }

  /**
   * Transition to Night phase and reset night states
   * 5-minute interval countdown for night tasks
   */
  transitionToNight(room) {
    room.phase = PHASES.NIGHT;
    this.resetNightActions(room);
    // Reset individual shields at start of night
    room.players.forEach(p => {
      p.hasShield = false;
    });

    // 5-minute interval for Night Phase (300 seconds)
    room.phaseDuration = 300;
    room.phaseDeadline = Date.now() + 300 * 1000;

    // Clear any existing phase timer
    if (room.phaseTimer) {
      clearTimeout(room.phaseTimer);
      room.phaseTimer = null;
    }

    // Auto-resolve night if 5-minute timer expires
    room.phaseTimer = setTimeout(() => {
      if (room.phase === PHASES.NIGHT) {
        this.logAction(room, 'NIGHT_TIMEOUT', `The 5-minute night interval expired. Darkness settles.`, {}, true);
        // If mafia didn't complete trial in time, suicide penalty applies
        if (!room.nightActions.mafiaKill || !room.nightActions.mafiaKill.trialCompleted) {
          room.nightActions.mafiaTrialFailed = true;
        }
        this.resolveNight(room);
      }
    }, 300 * 1000);

    this.logAction(
      room,
      'NIGHT_FALLS',
      `Night ${room.round} falls over the dungeon. Darkness engulfs the halls.`,
      { round: room.round },
      true
    );

    // Prompt Mafia with trial if mafia count > 0
    const livingMafia = Array.from(room.players.values()).filter(p => p.alive && p.role === ROLES.MAFIA);
    if (livingMafia.length > 0 && this.io) {
      livingMafia.forEach(m => {
        if (m.socketId) {
          this.io.to(m.socketId).emit('night-instructions', {
            role: ROLES.MAFIA,
            message: 'Discuss in Mafia chat, choose a victim to execute, and conquer your 45-second trial.'
          });
        }
      });
    }

    this.broadcastRoomState(room);
  }

  /**
   * Reset night action data structure
   */
  resetNightActions(room) {
    room.nightActions = {
      doctorSave: null,
      shieldAttempts: new Map(),
      mafiaKill: null,
      mafiaTrialFailed: false,
      detectiveClue: null
    };
  }

  /**
   * Handle Night Action (Doctor save, Mafia kill, Detective investigate, Citizen shield)
   */
  handleNightAction(sessionToken, action, targetId = null) {
    const { room, player } = this.getRoomAndPlayer(sessionToken);
    if (!room || !player) throw new Error('Invalid session token.');
    if (room.phase !== PHASES.NIGHT) {
      throw new Error('Night actions can only be performed during the NIGHT phase.');
    }
    if (!player.alive) {
      throw new Error('Dead players cannot perform night actions.');
    }

    let targetPlayer = null;
    if (targetId) {
      targetPlayer = room.players.get(targetId);
      if (!targetPlayer) {
        throw new Error('Target player not found.');
      }
      if (!targetPlayer.alive) {
        throw new Error('Target player is not alive.');
      }
      if (targetPlayer.isModerator) {
        throw new Error('Cannot target the moderator.');
      }
    }

    switch (player.role) {
      case ROLES.DOCTOR: {
        if (action !== 'save') {
          throw new Error('Doctor can only perform "save" action.');
        }
        if (!targetPlayer) {
          throw new Error('Doctor must specify a target to save.');
        }
        // Generate trial for Doctor
        const trial = generateTrial(TRIAL_TYPES.WORD_SCRAMBLE, 1);
        room.nightActions.doctorSave = {
          targetId: targetPlayer.id,
          targetName: targetPlayer.name,
          trialId: trial.trialId,
          success: false,
          trialCompleted: false
        };
        this.logAction(
          room,
          'DOCTOR_ACTION_INIT',
          `Doctor ${player.name} selected ${targetPlayer.name} to save and was assigned a trial.`,
          { doctor: player.name, target: targetPlayer.name },
          false
        );
        return { success: true, action: 'save', trial };
      }

      case ROLES.MAFIA: {
        if (action !== 'kill') {
          throw new Error('Mafia can only perform "kill" action.');
        }
        if (!targetPlayer) {
          throw new Error('Mafia must select a victim to kill.');
        }
        if (targetPlayer.id === player.id) {
          throw new Error('Mafia cannot target themselves.');
        }
        // Generate trial for Mafia with 45s time limit
        const trial = generateTrial(TRIAL_TYPES.LOCKPICK_RHYTHM, 2, { timeLimit: 45000 });
        room.nightActions.mafiaKill = {
          targetId: targetPlayer.id,
          targetName: targetPlayer.name,
          trialId: trial.trialId,
          selectedBy: player.id,
          success: false,
          trialCompleted: false
        };
        this.logAction(
          room,
          'MAFIA_ACTION_INIT',
          `Mafia ${player.name} targeted ${targetPlayer.name} for execution and began trial.`,
          { mafia: player.name, target: targetPlayer.name },
          false
        );
        return { success: true, action: 'kill', trial };
      }

      case ROLES.DETECTIVE: {
        if (action !== 'investigate') {
          throw new Error('Detective can only perform "investigate" action.');
        }
        // Generate trial for Detective
        const trial = generateTrial(TRIAL_TYPES.RUNE_MEMORY, 2);
        room.nightActions.detectiveClue = {
          targetId: targetId || null,
          trialId: trial.trialId,
          clue: null,
          success: false,
          trialCompleted: false
        };
        this.logAction(
          room,
          'DETECTIVE_ACTION_INIT',
          `Detective ${player.name} started investigation trial.`,
          { detective: player.name },
          false
        );
        return { success: true, action: 'investigate', trial };
      }

      case ROLES.CITIZEN: {
        if (action !== 'shield') {
          throw new Error('Citizens can only perform "shield" action.');
        }
        // Generate trial for Citizen shield
        const trial = generateTrial(TRIAL_TYPES.WORD_SCRAMBLE, 1);
        room.nightActions.shieldAttempts.set(player.id, {
          trialId: trial.trialId,
          success: false,
          trialCompleted: false
        });
        this.logAction(
          room,
          'CITIZEN_SHIELD_INIT',
          `Citizen ${player.name} attempted to forge a shield.`,
          { citizen: player.name },
          false
        );
        return { success: true, action: 'shield', trial };
      }

      default:
        throw new Error('Invalid role for night action.');
    }
  }

  /**
   * Handle Trial Results
   * Can accept either:
   * 1) (sessionToken, trialType, successBoolean)
   * 2) (sessionToken, trialId, answerData)
   */
  handleTrialResult(sessionToken, trialTypeOrId, successOrAnswer) {
    const { room, player } = this.getRoomAndPlayer(sessionToken);
    if (!room || !player) throw new Error('Invalid session token.');
    if (!player.alive) throw new Error('Dead players cannot complete trials.');

    let success = false;

    // Check if the parameter is a boolean or answer to validate
    if (typeof successOrAnswer === 'boolean') {
      success = successOrAnswer;
    } else {
      // Validate trial answer against activeTrials in trials.js
      success = validateTrial(trialTypeOrId, successOrAnswer);
    }

    let resultData = { success };

    switch (player.role) {
      case ROLES.DOCTOR: {
        if (room.nightActions.doctorSave) {
          room.nightActions.doctorSave.success = success;
          room.nightActions.doctorSave.trialCompleted = true;
          this.logAction(
            room,
            'DOCTOR_TRIAL_RESULT',
            `Doctor ${player.name}'s trial ${success ? 'SUCCEEDED' : 'FAILED'}. Target: ${room.nightActions.doctorSave.targetName}`,
            { success, targetId: room.nightActions.doctorSave.targetId },
            false
          );
        }
        break;
      }

      case ROLES.MAFIA: {
        if (room.nightActions.mafiaKill) {
          room.nightActions.mafiaKill.success = success;
          room.nightActions.mafiaKill.trialCompleted = true;
          if (!success) {
            room.nightActions.mafiaTrialFailed = true;
          }
          this.logAction(
            room,
            'MAFIA_TRIAL_RESULT',
            `Mafia ${player.name}'s trial ${success ? 'SUCCEEDED' : 'FAILED'}.`,
            { success, targetId: room.nightActions.mafiaKill.targetId },
            false
          );
        } else if (!success) {
          room.nightActions.mafiaTrialFailed = true;
        }
        break;
      }

      case ROLES.DETECTIVE: {
        if (room.nightActions.detectiveClue) {
          room.nightActions.detectiveClue.success = success;
          room.nightActions.detectiveClue.trialCompleted = true;
          if (success) {
            const clue = this.generateDetectiveClue(room);
            room.nightActions.detectiveClue.clue = clue;
            room.clues.set(player.id, clue);
            resultData.clue = clue;
            this.logAction(
              room,
              'DETECTIVE_TRIAL_RESULT',
              `Detective ${player.name} succeeded in investigation and obtained clue: "${clue}"`,
              { clue },
              false
            );
          } else {
            this.logAction(
              room,
              'DETECTIVE_TRIAL_RESULT',
              `Detective ${player.name} failed investigation trial. No clue discovered.`,
              { success: false },
              false
            );
          }
        }
        break;
      }

      case ROLES.CITIZEN: {
        const attempt = room.nightActions.shieldAttempts.get(player.id);
        if (attempt) {
          attempt.success = success;
          attempt.trialCompleted = true;
          if (success) {
            player.hasShield = true;
          }
          this.logAction(
            room,
            'CITIZEN_SHIELD_RESULT',
            `Citizen ${player.name} shield trial ${success ? 'SUCCEEDED (Shield active)' : 'FAILED'}.`,
            { success },
            false
          );
        }
        break;
      }

      default:
        break;
    }

    this.checkNightCompletion(room);
    this.broadcastRoomState(room);
    return resultData;
  }

  /**
   * Check if all night actions have completed, auto advance if so
   */
  checkNightCompletion(room) {
    if (room.phase !== PHASES.NIGHT) return;

    // Check doctor
    const livingDoctor = Array.from(room.players.values()).find(p => p.alive && p.role === ROLES.DOCTOR);
    if (livingDoctor && (!room.nightActions.doctorSave || !room.nightActions.doctorSave.trialCompleted)) {
      return;
    }

    // Check mafia
    const livingMafia = Array.from(room.players.values()).filter(p => p.alive && p.role === ROLES.MAFIA);
    if (livingMafia.length > 0 && (!room.nightActions.mafiaKill || !room.nightActions.mafiaKill.trialCompleted)) {
      return;
    }

    // Check detective
    const livingDetective = Array.from(room.players.values()).find(p => p.alive && p.role === ROLES.DETECTIVE);
    if (livingDetective && (!room.nightActions.detectiveClue || !room.nightActions.detectiveClue.trialCompleted)) {
      return;
    }

    // All active roles have submitted actions! Resolve night
    this.resolveNight(room);
  }

  /**
   * Resolve Night according to exact rules:
   * 1. Doctor save registered (doctor picks target + wins trial)
   * 2. Shield check (citizens who won shield trials)
   * 3. Mafia kill attempted (mafia picks target + wins trial)
   * 4. Resolve:
   *    if victim is doctor-saved -> survives.
   *    if victim has shield -> shield consumed, survives (silently).
   *    Otherwise -> dies.
   * 5. If Mafia FAILED their trial -> random mafia member dies (suicide).
   * 6. Record all actions in actionLog.
   * Doctor self-save: If doctor saves themselves, publicly announce 'The Doctor has saved himself'.
   */
  resolveNight(room) {
    if (room.phaseTimer) {
      clearTimeout(room.phaseTimer);
      room.phaseTimer = null;
    }
    room.phase = PHASES.NIGHT_RESOLUTION;

    const announcements = [];
    const deathsThisNight = [];

    // 1. Doctor Save Check
    let doctorSavedPlayerId = null;
    let doctorSelfSaved = false;

    if (room.nightActions.doctorSave && room.nightActions.doctorSave.success) {
      doctorSavedPlayerId = room.nightActions.doctorSave.targetId;
      const doctorPlayer = Array.from(room.players.values()).find(p => p.role === ROLES.DOCTOR);
      if (doctorPlayer && doctorSavedPlayerId === doctorPlayer.id) {
        doctorSelfSaved = true;
        const msg = 'The Doctor has saved himself.';
        announcements.push(msg);
        this.logAction(room, 'DOCTOR_SELF_SAVE', msg, { doctorId: doctorPlayer.id }, true);
      }
    }

    // 2 & 3 & 4. Mafia Kill Resolution
    if (room.nightActions.mafiaKill && room.nightActions.mafiaKill.success) {
      const victimId = room.nightActions.mafiaKill.targetId;
      const victim = room.players.get(victimId);

      if (victim && victim.alive) {
        if (doctorSavedPlayerId === victimId) {
          // Doctor saved victim!
          this.logAction(
            room,
            'NIGHT_SAVE',
            `The Doctor successfully protected ${victim.name} from the Mafia's blade.`,
            { victimId: victim.id, doctorSaved: true },
            false
          );
        } else if (victim.hasShield) {
          // Shield consumed silently
          victim.hasShield = false;
          this.logAction(
            room,
            'SHIELD_CONSUMED',
            `${victim.name}'s arcane shield shattered silently, protecting their life.`,
            { victimId: victim.id, shieldConsumed: true },
            false
          );
        } else {
          // Victim dies
          victim.alive = false;
          deathsThisNight.push(victim);
          const deathMsg = `${victim.name} was found slaughtered in the dungeon at dawn.`;
          announcements.push(deathMsg);
          this.logAction(room, 'NIGHT_KILL', deathMsg, { victimId: victim.id, victimName: victim.name }, true);
        }
      }
    }

    // 5. If Mafia FAILED their trial -> random mafia member dies (suicide)
    if (room.nightActions.mafiaTrialFailed) {
      const livingMafia = Array.from(room.players.values()).filter(p => p.alive && p.role === ROLES.MAFIA);
      if (livingMafia.length > 0) {
        const unluckyMafia = livingMafia[Math.floor(Math.random() * livingMafia.length)];
        unluckyMafia.alive = false;
        deathsThisNight.push(unluckyMafia);
        const suicideMsg = `A member of the dark order perished in the shadows after failing their forbidden ritual.`;
        announcements.push(suicideMsg);
        this.logAction(
          room,
          'MAFIA_SUICIDE',
          suicideMsg,
          { mafiaId: unluckyMafia.id, mafiaName: unluckyMafia.name },
          true
        );
      }
    }

    // If no one died
    if (deathsThisNight.length === 0 && announcements.length === 0) {
      announcements.push('Dawn arrives peacefully. Miraculously, no blood was shed during the night.');
      this.logAction(room, 'PEACEFUL_NIGHT', announcements[0], {}, true);
    }

    // Check Mafia Death Handling (Rule 11-12) for any dead mafia
    const deadMafiaThisNight = deathsThisNight.filter(p => p.role === ROLES.MAFIA);
    for (const deadM of deadMafiaThisNight) {
      this.handleMafiaDeath(room, deadM);
    }

    // Check Win Condition
    const gameOver = this.checkWinConditions(room);

    // Transition to DAWN
    if (!gameOver) {
      room.phase = PHASES.DAWN;
      this.logAction(room, 'DAWN_ARRIVED', `Dawn of Day ${room.round} begins.`, { announcements }, true);
    }

    this.broadcastRoomState(room, { announcements });
  }

  /**
   * Mafia death handling (Rule 11-12):
   * When a Mafia member dies, if other Mafia survive, emit 'mafia-death-choice' to surviving Mafia.
   * They choose: 'continue' (keep killing) or 'recruit' (pick a citizen to recruit).
   * If recruit: send 'recruit-request' to the target citizen.
   * Citizen accepts -> becomes Mafia (role changed). Citizen declines -> nothing happens.
   */
  handleMafiaDeath(room, deadMafiaPlayer) {
    const survivingMafia = Array.from(room.players.values()).filter(p => p.alive && p.role === ROLES.MAFIA);
    if (survivingMafia.length === 0) {
      return; // No surviving mafia
    }

    room.pendingMafiaDeathChoice = true;
    this.logAction(
      room,
      'MAFIA_DEATH_CHOICE_OFFERED',
      `Mafia member ${deadMafiaPlayer.name} has fallen. Surviving Mafia must choose: continue or recruit.`,
      { survivingMafiaCount: survivingMafia.length },
      false
    );

    if (this.io) {
      survivingMafia.forEach(m => {
        if (m.socketId) {
          this.io.to(m.socketId).emit('mafia-death-choice', {
            message: 'A fellow Mafia has fallen! Choose to continue the slaughter or recruit a Citizen to replace them.',
            options: ['continue', 'recruit']
          });
        }
      });
    }
  }

  /**
   * Handle Mafia selection of continue or recruit
   */
  handleMafiaChooseAction(sessionToken, action, targetId = null) {
    const { room, player } = this.getRoomAndPlayer(sessionToken);
    if (!room || !player) throw new Error('Invalid session token.');
    if (player.role !== ROLES.MAFIA || !player.alive) {
      throw new Error('Only living Mafia members can make this choice.');
    }
    if (!room.pendingMafiaDeathChoice) {
      throw new Error('No pending Mafia death choice.');
    }

    if (action === 'continue') {
      room.pendingMafiaDeathChoice = false;
      this.logAction(room, 'MAFIA_CHOICE_CONTINUE', `The Mafia resolved to continue alone without recruitment.`, {}, false);
      this.broadcastRoomState(room);
      return { success: true, action: 'continue' };
    }

    if (action === 'recruit') {
      if (!targetId) {
        throw new Error('Must select a target citizen to recruit.');
      }
      const target = room.players.get(targetId);
      if (!target || !target.alive || target.role !== ROLES.CITIZEN) {
        throw new Error('Recruit target must be an alive Citizen.');
      }

      room.pendingMafiaDeathChoice = false;
      room.pendingRecruit = {
        targetId: target.id,
        offeredBy: player.id
      };

      this.logAction(
        room,
        'MAFIA_RECRUIT_SENT',
        `Mafia sent a secret dark invitation to recruit ${target.name}.`,
        { target: target.name },
        false
      );

      if (this.io && target.socketId) {
        this.io.to(target.socketId).emit('recruit-request', {
          message: 'A shadowy figure offers you a pact: join the Mafia or remain a Citizen.',
          targetId: target.id
        });
      }

      this.broadcastRoomState(room);
      return { success: true, action: 'recruit', targetName: target.name };
    }

    throw new Error('Invalid action for Mafia choice. Must be "continue" or "recruit".');
  }

  /**
   * Handle Citizen response to Mafia recruit request
   */
  handleMafiaRecruitResponse(sessionToken, accept) {
    const { room, player } = this.getRoomAndPlayer(sessionToken);
    if (!room || !player) throw new Error('Invalid session token.');
    if (!room.pendingRecruit || room.pendingRecruit.targetId !== player.id) {
      throw new Error('No pending recruit request for this player.');
    }

    const wasAccepted = Boolean(accept);
    if (wasAccepted) {
      player.role = ROLES.MAFIA;
      this.logAction(
        room,
        'RECRUIT_ACCEPTED',
        `${player.name} accepted the dark pact and turned to the Mafia.`,
        { recruitId: player.id, recruitName: player.name },
        false
      );

      if (this.io && player.socketId) {
        this.io.to(player.socketId).emit('role-changed', {
          newRole: ROLES.MAFIA,
          message: 'You have joined the Mafia! You now share their chat and sinister goals.'
        });
      }
    } else {
      this.logAction(
        room,
        'RECRUIT_DECLINED',
        `${player.name} rejected the dark pact and remained loyal to the citizens.`,
        { recruitId: player.id },
        false
      );
    }

    room.pendingRecruit = null;

    // Check win conditions in case game dynamics shifted
    this.checkWinConditions(room);
    this.broadcastRoomState(room);

    return { success: true, accepted: wasAccepted };
  }

  /**
   * Detective Clue Generation:
   * Pick a random living Mafia member.
   * Clue randomly chosen from:
   * - First letter of name
   * - Length of name
   * - Last letter of name
   * - 'Name contains letter X'
   * - 'Name does NOT start with Y'
   * Never names them outright.
   */
  generateDetectiveClue(room) {
    const livingMafia = Array.from(room.players.values()).filter(p => p.alive && p.role === ROLES.MAFIA);
    if (livingMafia.length === 0) {
      return 'No shadows remain in the dungeon.';
    }

    const targetMafia = livingMafia[Math.floor(Math.random() * livingMafia.length)];
    const name = targetMafia.name;
    const clueTypes = ['first_letter', 'length', 'last_letter', 'contains_letter', 'does_not_start'];
    const chosenType = clueTypes[Math.floor(Math.random() * clueTypes.length)];

    switch (chosenType) {
      case 'first_letter':
        return `A living Mafia member's name starts with the letter "${name.charAt(0).toUpperCase()}".`;
      case 'length':
        return `A living Mafia member's name is ${name.length} letters long.`;
      case 'last_letter':
        return `A living Mafia member's name ends with the letter "${name.charAt(name.length - 1).toUpperCase()}".`;
      case 'contains_letter': {
        const randomChar = name.charAt(Math.floor(Math.random() * name.length)).toUpperCase();
        return `A living Mafia member's name contains the letter "${randomChar}".`;
      }
      case 'does_not_start': {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const notStartLetters = alphabet.split('').filter(c => c !== name.charAt(0).toUpperCase());
        const letter = notStartLetters[Math.floor(Math.random() * notStartLetters.length)];
        return `A living Mafia member's name does NOT start with the letter "${letter}".`;
      }
      default:
        return `A living Mafia member's name is ${name.length} letters long.`;
    }
  }

  /**
   * Detective shares clue with a player (Rule 4)
   * That player becomes a butterfly: cannot chat or vote for current voting round.
   * Butterfly status visible to all.
   */
  handleShareClue(sessionToken, targetPlayerId) {
    const { room, player } = this.getRoomAndPlayer(sessionToken);
    if (!room || !player) throw new Error('Invalid session token.');
    if (player.role !== ROLES.DETECTIVE) {
      throw new Error('Only the Detective can share clues.');
    }
    if (!player.alive) {
      throw new Error('Dead Detective cannot share clues.');
    }
    if (!room.clues.has(player.id)) {
      throw new Error('You do not have any active clues to share.');
    }

    const targetPlayer = room.players.get(targetPlayerId);
    if (!targetPlayer || !targetPlayer.alive || targetPlayer.isModerator) {
      throw new Error('Invalid target player.');
    }
    if (targetPlayer.id === player.id) {
      throw new Error('Detective cannot share a clue with themselves.');
    }

    const clue = room.clues.get(player.id);
    room.butterflies.add(targetPlayer.id);

    room.sharedClues.push({
      from: player.name,
      to: targetPlayer.name,
      clue,
      timestamp: Date.now()
    });

    this.logAction(
      room,
      'CLUE_SHARED',
      `Detective shared a secret clue with ${targetPlayer.name}. ${targetPlayer.name} has transformed into a silent BUTTERFLY for this round!`,
      { targetId: targetPlayer.id, targetName: targetPlayer.name },
      true
    );

    if (this.io && targetPlayer.socketId) {
      this.io.to(targetPlayer.socketId).emit('clue-received', {
        clue,
        from: 'Detective',
        message: 'You received a secret clue! As a Butterfly, you cannot chat or vote until this round ends.'
      });
    }

    this.broadcastRoomState(room);
    return { success: true, targetName: targetPlayer.name };
  }

  /**
   * Cast a vote during VOTING phase
   * All living non-butterfly players may vote
   */
  handleCastVote(sessionToken, targetId) {
    const { room, player } = this.getRoomAndPlayer(sessionToken);
    if (!room || !player) throw new Error('Invalid session token.');
    if (room.phase !== PHASES.VOTING) {
      throw new Error('Votes can only be cast during the VOTING phase.');
    }
    if (!player.alive) {
      throw new Error('Dead players cannot vote.');
    }
    if (player.isModerator) {
      throw new Error('Moderator cannot vote.');
    }
    if (room.butterflies.has(player.id)) {
      throw new Error('Butterflies are silenced and cannot vote.');
    }

    // targetId can be null/'skip' for skip, or an alive player id
    let targetPlayer = null;
    if (targetId && targetId !== 'skip') {
      targetPlayer = room.players.get(targetId);
      if (!targetPlayer || !targetPlayer.alive || targetPlayer.isModerator) {
        throw new Error('Invalid vote target.');
      }
    }

    const finalTarget = targetPlayer ? targetPlayer.id : 'skip';
    room.votes.set(player.id, finalTarget);

    this.logAction(
      room,
      'VOTE_CAST',
      `${player.name} has cast their vote.`,
      { voterId: player.id, voterName: player.name, targetId: finalTarget },
      false
    );

    // Check if all eligible players have voted
    const eligibleVoters = Array.from(room.players.values()).filter(
      p => p.alive && !p.isModerator && !room.butterflies.has(p.id)
    );
    const allVoted = eligibleVoters.every(p => room.votes.has(p.id));

    this.broadcastRoomState(room);

    if (allVoted) {
      this.resolveVotes(room);
    }

    return { success: true, targetId: finalTarget, allVoted };
  }

  /**
   * Tally votes and resolve elimination:
   * - Most votes eliminates. Tie = no elimination.
   * - Eliminated player's role is revealed.
   * - Butterfly status clears after vote.
   */
  resolveVotes(room) {
    room.phase = PHASES.VOTE_RESULT;

    // Count votes per target
    const counts = new Map();
    for (const [voterId, targetId] of room.votes.entries()) {
      if (targetId && targetId !== 'skip') {
        counts.set(targetId, (counts.get(targetId) || 0) + 1);
      }
    }

    let maxVotes = 0;
    let candidatesWithMax = [];

    for (const [targetId, count] of counts.entries()) {
      if (count > maxVotes) {
        maxVotes = count;
        candidatesWithMax = [targetId];
      } else if (count === maxVotes) {
        candidatesWithMax.push(targetId);
      }
    }

    let eliminatedPlayer = null;
    let announcement = '';

    if (candidatesWithMax.length === 1 && maxVotes > 0) {
      eliminatedPlayer = room.players.get(candidatesWithMax[0]);
      if (eliminatedPlayer && eliminatedPlayer.alive) {
        eliminatedPlayer.alive = false;
        announcement = `${eliminatedPlayer.name} was sentenced to death with ${maxVotes} votes. Role revealed: ${eliminatedPlayer.role.toUpperCase()}!`;
        this.logAction(
          room,
          'PLAYER_ELIMINATED',
          announcement,
          { player: eliminatedPlayer.name, role: eliminatedPlayer.role, votes: maxVotes },
          true
        );

        // If eliminated player is Mafia, handle Mafia death
        if (eliminatedPlayer.role === ROLES.MAFIA) {
          this.handleMafiaDeath(room, eliminatedPlayer);
        }
      }
    } else {
      announcement = 'The vote resulted in a tie or consensus to skip. No one was executed today.';
      this.logAction(room, 'VOTE_TIE', announcement, { maxVotes }, true);
    }

    // Butterfly status clears after vote
    room.butterflies.clear();
    room.votes.clear();

    const gameOver = this.checkWinConditions(room);

    this.broadcastRoomState(room, {
      announcement,
      eliminatedPlayer: eliminatedPlayer
        ? { id: eliminatedPlayer.id, name: eliminatedPlayer.name, role: eliminatedPlayer.role }
        : null
    });

    return {
      success: true,
      eliminated: eliminatedPlayer ? eliminatedPlayer.name : null,
      gameOver
    };
  }

  /**
   * Check Win Conditions:
   * - Citizens win: no living Mafia remain
   * - Mafia wins: living Mafia count >= living non-mafia non-moderator players
   */
  checkWinConditions(room) {
    if (room.phase === PHASES.LOBBY || room.phase === PHASES.ROLE_REVEAL || room.phase === PHASES.RULES_DISPLAY) {
      return false;
    }

    const livingPlayers = Array.from(room.players.values()).filter(p => p.alive && !p.isModerator);
    const livingMafia = livingPlayers.filter(p => p.role === ROLES.MAFIA);
    const livingNonMafia = livingPlayers.filter(p => p.role !== ROLES.MAFIA);

    // Citizens Win: No living Mafia remain
    if (livingMafia.length === 0) {
      room.phase = PHASES.GAME_OVER;
      room.winner = 'citizens';
      const msg = 'CITIZENS VICTORY! All members of the Mafia have been slain.';
      this.logAction(room, 'GAME_OVER', msg, { winner: 'citizens' }, true);
      return true;
    }

    // Mafia Wins: Living Mafia count >= living non-mafia non-moderator players
    if (livingMafia.length >= livingNonMafia.length) {
      room.phase = PHASES.GAME_OVER;
      room.winner = 'mafia';
      const msg = 'MAFIA VICTORY! The Mafia now equal or outnumber the helpless citizens.';
      this.logAction(room, 'GAME_OVER', msg, { winner: 'mafia' }, true);
      return true;
    }

    return false;
  }

  /**
   * Handle Chat Messages
   * - dayChat: living non-butterfly players during day
   * - mafiaChat: living mafia members during night
   * - ghostChat: dead players at any time
   * - Rate limit: 1 msg/sec
   * - Strip HTML
   */
  handleChatMessage(sessionToken, channel, rawText) {
    const { room, player } = this.getRoomAndPlayer(sessionToken);
    if (!room || !player) throw new Error('Invalid session token.');

    const cleanText = this.sanitizeText(rawText);
    if (!cleanText) {
      throw new Error('Chat message cannot be empty.');
    }

    // Rate Limit: 1 message per second
    const now = Date.now();
    if (player.lastChatMessageAt && now - player.lastChatMessageAt < 1000) {
      throw new Error('You are sending messages too quickly (1 sec cooldown).');
    }

    const messageObj = {
      id: uuidv4(),
      senderId: player.id,
      senderName: player.name,
      senderRole: player.isModerator ? ROLES.MODERATOR : (player.alive ? null : player.role),
      text: cleanText,
      timestamp: now,
      channel
    };

    switch (channel) {
      case CHAT_CHANNELS.DAY: {
        // Living non-butterfly players during day phases
        if (!player.alive && !player.isModerator) {
          throw new Error('Dead players must speak in the Ghost chat.');
        }
        if (room.phase === PHASES.NIGHT) {
          throw new Error('Day chat is quiet during the Night.');
        }
        if (room.butterflies.has(player.id)) {
          throw new Error('Butterflies are silenced and cannot speak in chat.');
        }
        room.dayChat.push(messageObj);
        this.broadcastChat(room, channel, messageObj);
        break;
      }

      case CHAT_CHANNELS.MAFIA: {
        // Living Mafia members
        if (player.role !== ROLES.MAFIA && !player.isModerator) {
          throw new Error('Only the Mafia may access the Mafia chat.');
        }
        if (!player.alive && !player.isModerator) {
          throw new Error('Dead Mafia must speak in the Ghost chat.');
        }
        if (room.phase !== PHASES.NIGHT) {
          throw new Error('Mafia chat is only available during the night.');
        }
        room.mafiaChat.push(messageObj);
        this.broadcastChat(room, channel, messageObj);
        break;
      }

      case CHAT_CHANNELS.GHOST: {
        // Dead players at any time
        if (player.alive && !player.isModerator) {
          throw new Error('Only the spirits of the dead can speak in the Ghost chat.');
        }
        room.ghostChat.push(messageObj);
        this.broadcastChat(room, channel, messageObj);
        break;
      }

      default:
        throw new Error(`Unknown chat channel: ${channel}`);
    }

    player.lastChatMessageAt = now;
    return { success: true, message: messageObj };
  }

  /**
   * Broadcast a chat message to authorized sockets
   */
  broadcastChat(room, channel, messageObj) {
    if (!this.io) return;

    for (const p of room.players.values()) {
      if (!p.connected || !p.socketId) continue;

      let canReceive = false;
      if (p.isModerator) {
        canReceive = true; // Moderator sees all chats
      } else if (channel === CHAT_CHANNELS.DAY) {
        canReceive = true; // All players can see day chat
      } else if (channel === CHAT_CHANNELS.MAFIA) {
        canReceive = (p.role === ROLES.MAFIA);
      } else if (channel === CHAT_CHANNELS.GHOST) {
        canReceive = (!p.alive);
      }

      if (canReceive) {
        this.io.to(p.socketId).emit('chat-message', messageObj);
      }
    }
  }

  /**
   * Handle Moderator Controls:
   * start, advance-phase, close-votes, pause, kick-player, force-end
   */
  handleModeratorAction(sessionToken, action, targetId = null) {
    const { room, player } = this.getRoomAndPlayer(sessionToken);
    if (!room || !player) throw new Error('Invalid session token.');
    if (!player.isModerator) {
      throw new Error('Only the moderator can perform moderator actions.');
    }

    switch (action) {
      case 'start':
        return this.startGame(sessionToken);

      case 'advance-phase': {
        this.advancePhaseByModerator(room);
        this.broadcastRoomState(room);
        return { success: true, newPhase: room.phase };
      }

      case 'close-votes': {
        if (room.phase !== PHASES.VOTING) {
          throw new Error('Can only close votes during VOTING phase.');
        }
        const result = this.resolveVotes(room);
        return result;
      }

      case 'pause': {
        room.paused = !room.paused;
        this.logAction(
          room,
          'GAME_PAUSED',
          `Game has been ${room.paused ? 'PAUSED' : 'RESUMED'} by moderator.`,
          { paused: room.paused },
          true
        );
        this.broadcastRoomState(room);
        return { success: true, paused: room.paused };
      }

      case 'kick-player': {
        if (!targetId) throw new Error('Must specify targetId to kick.');
        const target = room.players.get(targetId);
        if (!target) throw new Error('Player not found.');
        if (target.isModerator) throw new Error('Cannot kick the moderator.');

        target.alive = false;
        target.connected = false;
        room.players.delete(targetId);
        this.sessions.delete(targetId);

        this.logAction(
          room,
          'PLAYER_KICKED',
          `${target.name} was banished from the dungeon by the moderator.`,
          { targetName: target.name },
          true
        );

        if (this.io && target.socketId) {
          this.io.to(target.socketId).emit('kicked', { message: 'You have been kicked by the moderator.' });
        }

        this.checkWinConditions(room);
        this.broadcastRoomState(room);
        return { success: true, kicked: target.name };
      }

      default:
        throw new Error(`Unknown moderator action: ${action}`);
    }
  }

  /**
   * Helper to manually advance game phase
   */
  advancePhaseByModerator(room) {
    switch (room.phase) {
      case PHASES.LOBBY:
        throw new Error('Use "start" action to leave LOBBY.');
      case PHASES.RULES_DISPLAY:
        room.phase = PHASES.ROLE_REVEAL;
        break;
      case PHASES.ROLE_REVEAL:
        this.transitionToNight(room);
        break;
      case PHASES.NIGHT:
        this.resolveNight(room);
        break;
      case PHASES.NIGHT_RESOLUTION:
      case PHASES.DAWN:
        room.phase = PHASES.VOTING;
        room.votes.clear();
        this.logAction(room, 'VOTING_BEGUN', `The sun reaches its zenith. Voting has commenced!`, {}, true);
        break;
      case PHASES.VOTING:
        this.resolveVotes(room);
        break;
      case PHASES.VOTE_RESULT:
        if (room.phase !== PHASES.GAME_OVER) {
          room.round += 1;
          this.transitionToNight(room);
        }
        break;
      default:
        break;
    }
  }

  /**
   * Record action in room's live actionLog
   */
  logAction(room, type, text, details = {}, isPublic = false) {
    const entry = {
      id: uuidv4(),
      timestamp: Date.now(),
      round: room.round,
      phase: room.phase,
      type,
      text,
      details,
      isPublic
    };

    room.actionLog.push(entry);

    // Send real-time ledger update to moderator
    if (this.io) {
      const moderator = Array.from(room.players.values()).find(p => p.isModerator);
      if (moderator && moderator.connected && moderator.socketId) {
        this.io.to(moderator.socketId).emit('ledger-update', entry);
      }
    }

    return entry;
  }

  /**
   * Handle socket disconnect
   */
  handleDisconnect(socketId) {
    const sessionToken = this.socketToSession.get(socketId);
    if (!sessionToken) return null;

    this.socketToSession.delete(socketId);
    const { room, player } = this.getRoomAndPlayer(sessionToken);
    if (player && room) {
      player.connected = false;
      this.logAction(
        room,
        'PLAYER_DISCONNECTED',
        `${player.name} lost connection to the dungeon.`,
        { playerId: player.id },
        true
      );
      this.broadcastRoomState(room);
    }
    return sessionToken;
  }

  /**
   * Handle player reconnection using sessionToken
   */
  handleReconnect(sessionToken, socketId) {
    const { room, player } = this.getRoomAndPlayer(sessionToken);
    if (!room || !player) {
      throw new Error('Session token not found or invalid.');
    }

    player.socketId = socketId;
    player.connected = true;
    this.socketToSession.set(socketId, sessionToken);

    this.logAction(
      room,
      'PLAYER_RECONNECTED',
      `${player.name} reconnected to the dungeon.`,
      { playerId: player.id },
      true
    );

    this.broadcastRoomState(room);

    return {
      success: true,
      roomCode: room.code,
      state: this.getPlayerState(sessionToken)
    };
  }

  /**
   * Sanitize player info for security:
   * Prevents leaking roles to regular players
   */
  sanitizePlayerInfo(targetPlayer, viewerSessionToken, room) {
    const viewer = room.players.get(viewerSessionToken);
    const isSelf = targetPlayer.id === viewerSessionToken;
    const isMod = viewer && viewer.isModerator;
    const isGameOver = room.phase === PHASES.GAME_OVER;
    const isBothMafia = viewer && viewer.role === ROLES.MAFIA && targetPlayer.role === ROLES.MAFIA;
    const isDeadRevealed = !targetPlayer.alive && (room.phase === PHASES.VOTE_RESULT || room.phase === PHASES.DAWN || room.phase === PHASES.GAME_OVER);

    // Can see role if: self, moderator, game over, teammate mafia, or revealed upon vote elimination
    const canSeeRole = isSelf || isMod || isGameOver || isBothMafia || (!targetPlayer.alive && targetPlayer.role === ROLES.MAFIA && isBothMafia);

    return {
      id: targetPlayer.id,
      name: targetPlayer.name,
      role: canSeeRole ? targetPlayer.role : null,
      alive: targetPlayer.alive,
      connected: targetPlayer.connected,
      isModerator: targetPlayer.isModerator,
      isButterfly: room.butterflies.has(targetPlayer.id),
      hasShield: isMod || isSelf ? targetPlayer.hasShield : undefined,
      envelopeOpened: targetPlayer.envelopeOpened,
      rulesAcknowledged: targetPlayer.rulesAcknowledged
    };
  }

  /**
   * Get player-specific state (Sanitized for client view)
   */
  getPlayerState(sessionToken) {
    const { room, player } = this.getRoomAndPlayer(sessionToken);
    if (!room || !player) return null;

    const isMod = player.isModerator;
    const isGameOver = room.phase === PHASES.GAME_OVER;

    // Filter chat history based on player role
    const filteredDayChat = room.dayChat;
    const filteredMafiaChat = (player.role === ROLES.MAFIA || isMod) ? room.mafiaChat : [];
    const filteredGhostChat = (!player.alive || isMod) ? room.ghostChat : [];

    // Filter action log
    const filteredActionLog = isMod
      ? room.actionLog
      : room.actionLog.filter(log => log.isPublic);

    // Sanitized player list
    const playerList = Array.from(room.players.values()).map(p =>
      this.sanitizePlayerInfo(p, sessionToken, room)
    );

    // Filtered night actions (only self or mod)
    let myNightAction = null;
    if (player.role === ROLES.DOCTOR && room.nightActions.doctorSave) {
      myNightAction = {
        type: 'save',
        targetId: room.nightActions.doctorSave.targetId,
        trialCompleted: room.nightActions.doctorSave.trialCompleted
      };
    } else if (player.role === ROLES.MAFIA && room.nightActions.mafiaKill) {
      myNightAction = {
        type: 'kill',
        targetId: room.nightActions.mafiaKill.targetId,
        trialCompleted: room.nightActions.mafiaKill.trialCompleted
      };
    } else if (player.role === ROLES.DETECTIVE && room.nightActions.detectiveClue) {
      myNightAction = {
        type: 'investigate',
        trialCompleted: room.nightActions.detectiveClue.trialCompleted,
        clue: room.nightActions.detectiveClue.clue
      };
    } else if (player.role === ROLES.CITIZEN) {
      const shieldAttempt = room.nightActions.shieldAttempts.get(player.id);
      if (shieldAttempt) {
        myNightAction = {
          type: 'shield',
          trialCompleted: shieldAttempt.trialCompleted,
          success: shieldAttempt.success
        };
      }
    }

    return {
      roomCode: room.code,
      phase: room.phase,
      round: room.round,
      paused: room.paused,
      winner: room.winner,
      phaseDeadline: room.phaseDeadline || null,
      phaseDuration: room.phaseDuration || 300,
      me: {
        id: player.id,
        name: player.name,
        role: player.role,
        alive: player.alive,
        isModerator: player.isModerator,
        isButterfly: room.butterflies.has(player.id),
        hasShield: player.hasShield,
        envelopeOpened: player.envelopeOpened,
        rulesAcknowledged: player.rulesAcknowledged,
        myClue: room.clues.get(player.id) || null
      },
      players: playerList,
      myNightAction,
      myVote: room.votes.get(player.id) || null,
      butterflies: Array.from(room.butterflies),
      actionLog: filteredActionLog,
      chats: {
        day: filteredDayChat,
        mafia: filteredMafiaChat,
        ghost: filteredGhostChat
      },
      moderatorLedger: isMod ? room.actionLog : undefined,
      pendingMafiaDeathChoice: (player.role === ROLES.MAFIA && room.pendingMafiaDeathChoice) || false,
      pendingRecruit: (room.pendingRecruit && room.pendingRecruit.targetId === player.id) || false
    };
  }

  /**
   * Broadcast current sanitized game state to all players in the room
   */
  broadcastRoomState(room, extraData = {}) {
    if (!this.io) return;

    for (const player of room.players.values()) {
      if (player.connected && player.socketId) {
        const state = this.getPlayerState(player.id);
        this.io.to(player.socketId).emit('game-state', {
          ...state,
          ...extraData
        });
      }
    }
  }
}

// Singleton gameManager instance
const gameManager = new GameManager();

// Bind all methods to gameManager instance so destructuring works
const methods = Object.getOwnPropertyNames(GameManager.prototype);
for (const method of methods) {
  if (method !== 'constructor' && typeof gameManager[method] === 'function') {
    gameManager[method] = gameManager[method].bind(gameManager);
  }
}

// Attach auxiliary constants & class to gameManager
gameManager.gameManager = gameManager;
gameManager.GameManager = GameManager;
gameManager.ROLES = ROLES;
gameManager.PHASES = PHASES;
gameManager.CHAT_CHANNELS = CHAT_CHANNELS;

module.exports = gameManager;
