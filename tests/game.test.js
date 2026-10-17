/**
 * tests/game.test.js
 * Comprehensive unit and integration test suite for the DUNGEON multiplayer social deduction game.
 */

const { GameManager, ROLES, PHASES, CHAT_CHANNELS } = require('../server/gameManager');
const {
  generateTrial,
  validateTrial,
  TRIAL_TYPES,
  DUNGEON_WORDS,
  RUNE_GLYPHS,
  activeTrials
} = require('../server/trials');

// Mock socket.io helper
function createMockIo() {
  return {
    to: jest.fn().mockReturnThis(),
    emit: jest.fn(),
    in: jest.fn().mockReturnThis()
  };
}

// Test environment factory
function setupGame(playerCount = 5) {
  const gm = new GameManager();
  const mockIo = createMockIo();
  gm.setIo(mockIo);

  // Moderator creates room
  const modData = gm.createRoom('KeeperMod', 'sock-mod');
  const roomCode = modData.code;

  // Add players
  const players = [];
  for (let i = 1; i <= playerCount; i++) {
    const p = gm.joinRoom(roomCode, `Player_${i}`, `sock-${i}`);
    players.push(p);
  }

  // Start game
  gm.startGame(modData.sessionToken);
  const room = gm.rooms.get(roomCode);

  return { gm, mockIo, modData, players, room };
}

// Helper to transition room into NIGHT phase cleanly (Rules -> Envelope -> Night)
function advanceToNight(gm, room, players) {
  if (room.phase === PHASES.RULES_DISPLAY) {
    for (const p of players) {
      gm.handleRulesAcknowledged(p.sessionToken);
    }
  }
  if (room.phase === PHASES.ROLE_REVEAL) {
    for (const p of players) {
      gm.handleEnvelopeOpened(p.sessionToken);
    }
  }
  if (room.phase !== PHASES.NIGHT) {
    room.phase = PHASES.NIGHT;
  }
}

// Helper to find players by role
function getPlayersByRole(room) {
  const all = Array.from(room.players.values());
  return {
    moderator: all.find(p => p.isModerator),
    doctor: all.find(p => p.role === ROLES.DOCTOR),
    detective: all.find(p => p.role === ROLES.DETECTIVE),
    mafia: all.filter(p => p.role === ROLES.MAFIA),
    citizens: all.filter(p => p.role === ROLES.CITIZEN)
  };
}

describe('DUNGEON Game Logic Test Suite', () => {
  let mockIo;

  beforeEach(() => {
    mockIo = createMockIo();
    jest.clearAllMocks();
  });

  // =========================================================================
  // 1. ROLE ASSIGNMENT SUITE
  // =========================================================================
  describe('Role Assignment', () => {
    test('5 non-moderator players: 1 Doctor, 1 Detective, 1 Mafia, 2 Citizens', () => {
      const { room } = setupGame(5);
      const roles = getPlayersByRole(room);

      expect(roles.doctor).toBeDefined();
      expect(roles.detective).toBeDefined();
      expect(roles.mafia.length).toBe(1);
      expect(roles.citizens.length).toBe(2);
      expect(roles.moderator.role).toBe(ROLES.MODERATOR);
    });

    test('6 non-moderator players: 1 Doctor, 1 Detective, 1 Mafia, 3 Citizens', () => {
      const { room } = setupGame(6);
      const roles = getPlayersByRole(room);

      expect(roles.doctor).toBeDefined();
      expect(roles.detective).toBeDefined();
      expect(roles.mafia.length).toBe(1);
      expect(roles.citizens.length).toBe(3);
    });

    test('12 non-moderator players: 1 Doctor, 1 Detective, 2 Mafia, 8 Citizens', () => {
      const { room } = setupGame(12);
      const roles = getPlayersByRole(room);

      expect(roles.doctor).toBeDefined();
      expect(roles.detective).toBeDefined();
      expect(roles.mafia.length).toBe(2);
      expect(roles.citizens.length).toBe(8);
    });

    test('18 non-moderator players: 1 Doctor, 1 Detective, 3 Mafia, 13 Citizens', () => {
      const { room } = setupGame(18);
      const roles = getPlayersByRole(room);

      expect(roles.doctor).toBeDefined();
      expect(roles.detective).toBeDefined();
      expect(roles.mafia.length).toBe(3);
      expect(roles.citizens.length).toBe(13);
    });

    test('Verifies no player has null role after assignment and moderator is not in pool', () => {
      const { room } = setupGame(7);
      const nonMod = Array.from(room.players.values()).filter(p => !p.isModerator);

      for (const p of nonMod) {
        expect(p.role).not.toBeNull();
        expect([ROLES.DOCTOR, ROLES.DETECTIVE, ROLES.MAFIA, ROLES.CITIZEN]).toContain(p.role);
      }

      const mod = Array.from(room.players.values()).find(p => p.isModerator);
      expect(mod.role).toBe(ROLES.MODERATOR);
    });
  });

  // =========================================================================
  // 2. NIGHT RESOLUTION SUITE
  // =========================================================================
  describe('Night Resolution', () => {
    test('Mafia kills unprotected citizen -> citizen dies', () => {
      const { gm, room, players } = setupGame(5);
      advanceToNight(gm, room, players);
      const { doctor, mafia, citizens } = getPlayersByRole(room);

      const victim = citizens[0];
      const otherCitizen = citizens[1];

      // Mafia targets victim and succeeds trial
      gm.handleNightAction(mafia[0].id, 'kill', victim.id);
      gm.handleTrialResult(mafia[0].id, 'any', true);

      // Doctor saves someone else
      gm.handleNightAction(doctor.id, 'save', otherCitizen.id);
      gm.handleTrialResult(doctor.id, 'any', true);

      // Detective investigates
      const { detective } = getPlayersByRole(room);
      gm.handleNightAction(detective.id, 'investigate');
      gm.handleTrialResult(detective.id, 'any', true);

      expect(victim.alive).toBe(false);
      expect(otherCitizen.alive).toBe(true);
    });

    test('Doctor saves the kill target -> target survives', () => {
      const { gm, room, players } = setupGame(5);
      advanceToNight(gm, room, players);
      const { doctor, mafia, citizens, detective } = getPlayersByRole(room);

      const victim = citizens[0];

      // Mafia attacks victim
      gm.handleNightAction(mafia[0].id, 'kill', victim.id);
      gm.handleTrialResult(mafia[0].id, 'any', true);

      // Doctor saves the SAME victim
      gm.handleNightAction(doctor.id, 'save', victim.id);
      gm.handleTrialResult(doctor.id, 'any', true);

      // Detective finishes
      gm.handleNightAction(detective.id, 'investigate');
      gm.handleTrialResult(detective.id, 'any', true);

      expect(victim.alive).toBe(true);
    });

    test('Citizen has shield + is attacked -> survives, shield consumed', () => {
      const { gm, room, players } = setupGame(5);
      advanceToNight(gm, room, players);
      const { doctor, mafia, citizens, detective } = getPlayersByRole(room);

      const shieldedCitizen = citizens[0];
      const otherCitizen = citizens[1];

      // Citizen earns shield
      gm.handleNightAction(shieldedCitizen.id, 'shield');
      gm.handleTrialResult(shieldedCitizen.id, 'any', true);
      expect(shieldedCitizen.hasShield).toBe(true);

      // Mafia targets shielded citizen
      gm.handleNightAction(mafia[0].id, 'kill', shieldedCitizen.id);
      gm.handleTrialResult(mafia[0].id, 'any', true);

      // Doctor saves the OTHER citizen
      gm.handleNightAction(doctor.id, 'save', otherCitizen.id);
      gm.handleTrialResult(doctor.id, 'any', true);

      // Detective finishes
      gm.handleNightAction(detective.id, 'investigate');
      gm.handleTrialResult(detective.id, 'any', true);

      expect(shieldedCitizen.alive).toBe(true);
      expect(shieldedCitizen.hasShield).toBe(false); // Shield was consumed!
    });

    test('Doctor saves themselves -> target survives + public announcement', () => {
      const { gm, room, players } = setupGame(5);
      advanceToNight(gm, room, players);
      const { doctor, mafia, detective } = getPlayersByRole(room);

      // Mafia targets Doctor
      gm.handleNightAction(mafia[0].id, 'kill', doctor.id);
      gm.handleTrialResult(mafia[0].id, 'any', true);

      // Doctor saves themselves
      gm.handleNightAction(doctor.id, 'save', doctor.id);
      gm.handleTrialResult(doctor.id, 'any', true);

      // Detective finishes
      gm.handleNightAction(detective.id, 'investigate');
      gm.handleTrialResult(detective.id, 'any', true);

      expect(doctor.alive).toBe(true);
      const selfSaveLog = room.actionLog.find(log => log.type === 'DOCTOR_SELF_SAVE');
      expect(selfSaveLog).toBeDefined();
      expect(selfSaveLog.text).toContain('The Doctor has saved himself');
    });

    test('Mafia fails trial -> random mafia member dies (suicide rule)', () => {
      const { gm, room, players } = setupGame(5);
      advanceToNight(gm, room, players);
      const { doctor, mafia, citizens, detective } = getPlayersByRole(room);

      const victim = citizens[0];

      // Mafia selects victim but FAILS trial
      gm.handleNightAction(mafia[0].id, 'kill', victim.id);
      gm.handleTrialResult(mafia[0].id, 'any', false);

      // Doctor saves other citizen
      gm.handleNightAction(doctor.id, 'save', citizens[1].id);
      gm.handleTrialResult(doctor.id, 'any', true);

      // Detective finishes
      gm.handleNightAction(detective.id, 'investigate');
      gm.handleTrialResult(detective.id, 'any', true);

      // Victim is untouched, Mafia died by suicide
      expect(victim.alive).toBe(true);
      expect(mafia[0].alive).toBe(false);
      const suicideLog = room.actionLog.find(log => log.type === 'MAFIA_SUICIDE');
      expect(suicideLog).toBeDefined();
    });

    test('Doctor saves target who also has shield -> target survives, shield NOT consumed', () => {
      const { gm, room, players } = setupGame(5);
      advanceToNight(gm, room, players);
      const { doctor, mafia, citizens, detective } = getPlayersByRole(room);

      const blessedCitizen = citizens[0];

      // Citizen gets shield
      gm.handleNightAction(blessedCitizen.id, 'shield');
      gm.handleTrialResult(blessedCitizen.id, 'any', true);
      expect(blessedCitizen.hasShield).toBe(true);

      // Mafia attacks blessedCitizen
      gm.handleNightAction(mafia[0].id, 'kill', blessedCitizen.id);
      gm.handleTrialResult(mafia[0].id, 'any', true);

      // Doctor also saves blessedCitizen
      gm.handleNightAction(doctor.id, 'save', blessedCitizen.id);
      gm.handleTrialResult(doctor.id, 'any', true);

      // Detective finishes
      gm.handleNightAction(detective.id, 'investigate');
      gm.handleTrialResult(detective.id, 'any', true);

      expect(blessedCitizen.alive).toBe(true);
      // Because Doctor save intercepted the attack, shield was NOT consumed!
      expect(blessedCitizen.hasShield).toBe(true);
    });

    test('Doctor saves different player, target has shield -> shield consumed, target survives', () => {
      const { gm, room, players } = setupGame(5);
      advanceToNight(gm, room, players);
      const { doctor, mafia, citizens, detective } = getPlayersByRole(room);

      const target = citizens[0];
      const other = citizens[1];

      // Target acquires shield
      gm.handleNightAction(target.id, 'shield');
      gm.handleTrialResult(target.id, 'any', true);

      // Mafia attacks target
      gm.handleNightAction(mafia[0].id, 'kill', target.id);
      gm.handleTrialResult(mafia[0].id, 'any', true);

      // Doctor protects 'other'
      gm.handleNightAction(doctor.id, 'save', other.id);
      gm.handleTrialResult(doctor.id, 'any', true);

      // Detective finishes
      gm.handleNightAction(detective.id, 'investigate');
      gm.handleTrialResult(detective.id, 'any', true);

      expect(target.alive).toBe(true);
      expect(target.hasShield).toBe(false);
    });

    test('Doctor saves different player, target has no shield -> target dies', () => {
      const { gm, room, players } = setupGame(5);
      advanceToNight(gm, room, players);
      const { doctor, mafia, citizens, detective } = getPlayersByRole(room);

      const target = citizens[0];
      const other = citizens[1];

      // Mafia attacks unshielded target
      gm.handleNightAction(mafia[0].id, 'kill', target.id);
      gm.handleTrialResult(mafia[0].id, 'any', true);

      // Doctor protects 'other'
      gm.handleNightAction(doctor.id, 'save', other.id);
      gm.handleTrialResult(doctor.id, 'any', true);

      // Detective finishes
      gm.handleNightAction(detective.id, 'investigate');
      gm.handleTrialResult(detective.id, 'any', true);

      expect(target.alive).toBe(false);
    });
  });

  // =========================================================================
  // 3. WIN CONDITIONS SUITE
  // =========================================================================
  describe('Win Conditions', () => {
    test('All mafia dead -> Citizens win', () => {
      const { gm, room, players } = setupGame(5);
      advanceToNight(gm, room, players);
      const { mafia } = getPlayersByRole(room);

      // Kill the only mafia member
      mafia[0].alive = false;
      const isOver = gm.checkWinConditions(room);

      expect(isOver).toBe(true);
      expect(room.winner).toBe('citizens');
      expect(room.phase).toBe(PHASES.GAME_OVER);
    });

    test('Mafia count >= non-mafia living count -> Mafia wins', () => {
      const { gm, room, players } = setupGame(5);
      advanceToNight(gm, room, players);
      const { doctor, citizens } = getPlayersByRole(room);

      // Kill doctor and both citizens -> only 1 mafia and 1 detective left (1 vs 1)
      doctor.alive = false;
      citizens[0].alive = false;
      citizens[1].alive = false;

      const isOver = gm.checkWinConditions(room);
      expect(isOver).toBe(true);
      expect(room.winner).toBe('mafia');
      expect(room.phase).toBe(PHASES.GAME_OVER);
    });

    test('Edge case: last mafia killed during night (suicide) -> Citizens win', () => {
      const { gm, room, players } = setupGame(5);
      advanceToNight(gm, room, players);
      const { doctor, mafia, citizens, detective } = getPlayersByRole(room);

      gm.handleNightAction(mafia[0].id, 'kill', citizens[0].id);
      gm.handleTrialResult(mafia[0].id, 'any', false); // Mafia fails trial

      gm.handleNightAction(doctor.id, 'save', doctor.id);
      gm.handleTrialResult(doctor.id, 'any', true);

      gm.handleNightAction(detective.id, 'investigate');
      gm.handleTrialResult(detective.id, 'any', true);

      // Mafia died by suicide, resulting in Citizens win
      expect(mafia[0].alive).toBe(false);
      expect(room.winner).toBe('citizens');
      expect(room.phase).toBe(PHASES.GAME_OVER);
    });

    test('Edge case: vote eliminates last mafia -> Citizens win', () => {
      const { gm, room, players } = setupGame(5);
      advanceToNight(gm, room, players);
      room.phase = PHASES.VOTING;

      const { mafia, doctor, detective, citizens } = getPlayersByRole(room);

      // Everyone votes for the mafia
      gm.handleCastVote(doctor.id, mafia[0].id);
      gm.handleCastVote(detective.id, mafia[0].id);
      gm.handleCastVote(citizens[0].id, mafia[0].id);
      gm.handleCastVote(citizens[1].id, mafia[0].id);
      gm.handleCastVote(mafia[0].id, citizens[0].id);

      expect(mafia[0].alive).toBe(false);
      expect(room.winner).toBe('citizens');
      expect(room.phase).toBe(PHASES.GAME_OVER);
    });

    test('Edge case: 2 mafia, 2 citizens -> Mafia wins (equal parity)', () => {
      const { gm, room, players } = setupGame(12); // Has 2 mafia
      advanceToNight(gm, room, players);
      const { mafia, citizens, doctor, detective } = getPlayersByRole(room);

      // Kill doctor, detective, and 6 citizens -> leaves 2 mafia and 2 citizens
      doctor.alive = false;
      detective.alive = false;
      for (let i = 2; i < citizens.length; i++) {
        citizens[i].alive = false;
      }

      const isOver = gm.checkWinConditions(room);
      expect(isOver).toBe(true);
      expect(room.winner).toBe('mafia');
      expect(room.phase).toBe(PHASES.GAME_OVER);
    });
  });

  // =========================================================================
  // 4. VOTING SUITE
  // =========================================================================
  describe('Voting', () => {
    test('Most votes eliminates player', () => {
      const { gm, room, players } = setupGame(5);
      room.phase = PHASES.VOTING;
      const { citizens, doctor, detective, mafia } = getPlayersByRole(room);

      const target = citizens[0];
      gm.handleCastVote(doctor.id, target.id);
      gm.handleCastVote(detective.id, target.id);
      gm.handleCastVote(mafia[0].id, target.id);
      gm.handleCastVote(citizens[1].id, target.id);
      gm.handleCastVote(target.id, citizens[1].id);

      expect(target.alive).toBe(false);
      expect(room.phase).toBe(PHASES.VOTE_RESULT);
    });

    test('Tie -> no elimination', () => {
      const { gm, room, players } = setupGame(5);
      room.phase = PHASES.VOTING;
      const { citizens, doctor, detective, mafia } = getPlayersByRole(room);

      const c0 = citizens[0];
      const c1 = citizens[1];

      // 2 votes for c0, 2 votes for c1, 1 vote skip
      gm.handleCastVote(doctor.id, c0.id);
      gm.handleCastVote(detective.id, c0.id);
      gm.handleCastVote(mafia[0].id, c1.id);
      gm.handleCastVote(c0.id, c1.id);
      gm.handleCastVote(c1.id, 'skip');

      expect(c0.alive).toBe(true);
      expect(c1.alive).toBe(true);
      const tieLog = room.actionLog.find(l => l.type === 'VOTE_TIE');
      expect(tieLog).toBeDefined();
    });

    test('Dead players cannot vote', () => {
      const { gm, room } = setupGame(5);
      room.phase = PHASES.VOTING;
      const { citizens } = getPlayersByRole(room);

      citizens[0].alive = false;

      expect(() => {
        gm.handleCastVote(citizens[0].id, citizens[1].id);
      }).toThrow('Dead players cannot vote.');
    });

    test('Butterfly players cannot vote', () => {
      const { gm, room } = setupGame(5);
      room.phase = PHASES.VOTING;
      const { citizens } = getPlayersByRole(room);

      // Mark citizen as butterfly
      room.butterflies.add(citizens[0].id);

      expect(() => {
        gm.handleCastVote(citizens[0].id, citizens[1].id);
      }).toThrow('Butterflies are silenced and cannot vote.');
    });

    test('Eliminated player role is revealed in result announcement', () => {
      const { gm, room } = setupGame(5);
      room.phase = PHASES.VOTING;
      const { doctor, mafia, citizens, detective } = getPlayersByRole(room);

      gm.handleCastVote(doctor.id, citizens[0].id);
      gm.handleCastVote(detective.id, citizens[0].id);
      gm.handleCastVote(mafia[0].id, citizens[0].id);
      gm.handleCastVote(citizens[1].id, citizens[0].id);
      gm.handleCastVote(citizens[0].id, 'skip');

      const elimLog = room.actionLog.find(l => l.type === 'PLAYER_ELIMINATED');
      expect(elimLog).toBeDefined();
      expect(elimLog.text).toContain('CITIZEN');
    });
  });

  // =========================================================================
  // 5. RULE EDGE CASES SUITE
  // =========================================================================
  describe('Rule Edge Cases', () => {
    test('Rule 2: Doctor self-save generates public announcement at dawn', () => {
      const { gm, room, players } = setupGame(5);
      advanceToNight(gm, room, players);
      const { doctor, mafia, detective } = getPlayersByRole(room);

      gm.handleNightAction(doctor.id, 'save', doctor.id);
      gm.handleTrialResult(doctor.id, 'any', true);

      gm.handleNightAction(mafia[0].id, 'kill', doctor.id);
      gm.handleTrialResult(mafia[0].id, 'any', true);

      gm.handleNightAction(detective.id, 'investigate');
      gm.handleTrialResult(detective.id, 'any', true);

      const publicEntry = room.actionLog.find(
        entry => entry.type === 'DOCTOR_SELF_SAVE' && entry.isPublic === true
      );
      expect(publicEntry).toBeDefined();
      expect(publicEntry.text).toBe('The Doctor has saved himself.');
    });

    test('Rule 4: Detective shares clue -> target becomes butterfly -> cannot vote', () => {
      const { gm, room, players } = setupGame(5);
      advanceToNight(gm, room, players);
      const { detective, citizens } = getPlayersByRole(room);

      // Detective gets clue
      gm.handleNightAction(detective.id, 'investigate');
      gm.handleTrialResult(detective.id, 'any', true);

      const targetCitizen = citizens[0];
      const result = gm.handleShareClue(detective.id, targetCitizen.id);
      expect(result.success).toBe(true);
      expect(room.butterflies.has(targetCitizen.id)).toBe(true);

      // Transition to voting
      room.phase = PHASES.VOTING;
      expect(() => {
        gm.handleCastVote(targetCitizen.id, citizens[1].id);
      }).toThrow(/Butterflies/);
    });

    test('Rule 6: Mafia fail trial -> random mafia dies', () => {
      const { gm, room, players } = setupGame(5);
      advanceToNight(gm, room, players);
      const { mafia, doctor, detective, citizens } = getPlayersByRole(room);

      gm.handleNightAction(mafia[0].id, 'kill', citizens[0].id);
      gm.handleTrialResult(mafia[0].id, 'any', false); // FAIL

      gm.handleNightAction(doctor.id, 'save', citizens[1].id);
      gm.handleTrialResult(doctor.id, 'any', true);

      gm.handleNightAction(detective.id, 'investigate');
      gm.handleTrialResult(detective.id, 'any', true);

      expect(mafia[0].alive).toBe(false);
    });

    test('Rule 9: Citizen wins shield trial -> gets shield', () => {
      const { gm, room, players } = setupGame(5);
      advanceToNight(gm, room, players);
      const { citizens } = getPlayersByRole(room);

      const res = gm.handleNightAction(citizens[0].id, 'shield');
      expect(res.success).toBe(true);

      gm.handleTrialResult(citizens[0].id, 'any', true);
      expect(citizens[0].hasShield).toBe(true);
    });

    test('Rule 10: Shield existence never revealed to other players', () => {
      const { gm, room, players } = setupGame(5);
      advanceToNight(gm, room, players);
      const { citizens } = getPlayersByRole(room);

      citizens[0].hasShield = true;

      // Viewing as other citizen
      const sanitizedForOther = gm.sanitizePlayerInfo(citizens[0], citizens[1].id, room);
      expect(sanitizedForOther.hasShield).toBeUndefined();

      // Viewing as self
      const sanitizedForSelf = gm.sanitizePlayerInfo(citizens[0], citizens[0].id, room);
      expect(sanitizedForSelf.hasShield).toBe(true);

      // Viewing as moderator
      const mod = Array.from(room.players.values()).find(p => p.isModerator);
      const sanitizedForMod = gm.sanitizePlayerInfo(citizens[0], mod.id, room);
      expect(sanitizedForMod.hasShield).toBe(true);
    });

    test('Rule 11: Mafia member dies -> surviving mafia get choice', () => {
      const { gm, room, players } = setupGame(12); // Has 2 mafia
      advanceToNight(gm, room, players);
      const { mafia } = getPlayersByRole(room);

      expect(mafia.length).toBe(2);

      // Kill mafia 0
      mafia[0].alive = false;
      gm.handleMafiaDeath(room, mafia[0]);

      expect(room.pendingMafiaDeathChoice).toBe(true);
    });

    test('Rule 12: Recruit request -> citizen accepts -> becomes mafia; declines -> stays citizen', () => {
      const { gm, room, players } = setupGame(12);
      advanceToNight(gm, room, players);
      const { mafia, citizens } = getPlayersByRole(room);

      // Mafia member dies, trigger choice
      mafia[0].alive = false;
      gm.handleMafiaDeath(room, mafia[0]);

      // Surviving mafia chooses to recruit citizen 0
      const survivingMafia = mafia[1];
      const recruitTarget = citizens[0];

      const choiceRes = gm.handleMafiaChooseAction(survivingMafia.id, 'recruit', recruitTarget.id);
      expect(choiceRes.success).toBe(true);
      expect(room.pendingRecruit).toEqual({
        targetId: recruitTarget.id,
        offeredBy: survivingMafia.id
      });

      // Citizen accepts
      const resp = gm.handleMafiaRecruitResponse(recruitTarget.id, true);
      expect(resp.accepted).toBe(true);
      expect(recruitTarget.role).toBe(ROLES.MAFIA);

      // Now test decline on another citizen
      mafia[1].alive = false;
      gm.handleMafiaDeath(room, mafia[1]);
      const citizenDeclining = citizens[1];

      gm.handleMafiaChooseAction(recruitTarget.id, 'recruit', citizenDeclining.id);
      const declineResp = gm.handleMafiaRecruitResponse(citizenDeclining.id, false);
      expect(declineResp.accepted).toBe(false);
      expect(citizenDeclining.role).toBe(ROLES.CITIZEN);
    });
  });

  // =========================================================================
  // 6. TRIAL SYSTEM SUITE
  // =========================================================================
  describe('Trial System', () => {
    test('generateTrial returns valid trial data for each type', () => {
      const runeTrial = generateTrial(TRIAL_TYPES.RUNE_MEMORY, 1);
      expect(runeTrial.trialId).toBeDefined();
      expect(runeTrial.type).toBe('rune-memory');
      expect(runeTrial.data.sequence.length).toBe(4);

      const rhythmTrial = generateTrial(TRIAL_TYPES.LOCKPICK_RHYTHM, 2);
      expect(rhythmTrial.trialId).toBeDefined();
      expect(rhythmTrial.type).toBe('lockpick-rhythm');
      expect(rhythmTrial.data.intervals.length).toBe(5);

      const wordTrial = generateTrial(TRIAL_TYPES.WORD_SCRAMBLE, 1);
      expect(wordTrial.trialId).toBeDefined();
      expect(wordTrial.type).toBe('word-scramble');
      expect(wordTrial.data.scrambledWord).toBeDefined();
    });

    test('validateTrial correctly validates rune-memory sequence', () => {
      const trial = generateTrial(TRIAL_TYPES.RUNE_MEMORY, 1);
      const correctAnswer = trial.answer; // array of rune IDs

      const isSuccess = validateTrial(trial.trialId, correctAnswer);
      expect(isSuccess).toBe(true);
    });

    test('validateTrial correctly validates word-scramble answer', () => {
      const trial = generateTrial(TRIAL_TYPES.WORD_SCRAMBLE, 1);
      const correctAnswer = trial.answer;

      const isSuccess = validateTrial(trial.trialId, correctAnswer.toUpperCase());
      expect(isSuccess).toBe(true);
    });

    test('validateTrial rejects wrong answers', () => {
      const wordTrial = generateTrial(TRIAL_TYPES.WORD_SCRAMBLE, 1);
      const isWordSuccess = validateTrial(wordTrial.trialId, 'definitely_wrong_answer_xyz');
      expect(isWordSuccess).toBe(false);

      const runeTrial = generateTrial(TRIAL_TYPES.RUNE_MEMORY, 1);
      const isRuneSuccess = validateTrial(runeTrial.trialId, ['wrong-id-1', 'wrong-id-2']);
      expect(isRuneSuccess).toBe(false);
    });

    test('validateTrial supports lockpick rhythm timing tolerances', () => {
      const rhythmTrial = generateTrial(TRIAL_TYPES.LOCKPICK_RHYTHM, 1);
      const intervals = rhythmTrial.answer.intervals;

      // Submit identical intervals
      const isSuccess = validateTrial(rhythmTrial.trialId, intervals);
      expect(isSuccess).toBe(true);
    });
  });

  // =========================================================================
  // 7. VALIDATION SUITE
  // =========================================================================
  describe('Validation', () => {
    test('Cannot act during wrong phase', () => {
      const { gm, room } = setupGame(5);
      // In RULES_DISPLAY phase right after starting
      expect(room.phase).toBe(PHASES.RULES_DISPLAY);
      const { mafia, citizens } = getPlayersByRole(room);

      expect(() => {
        gm.handleNightAction(mafia[0].id, 'kill', citizens[0].id);
      }).toThrow('Night actions can only be performed during the NIGHT phase.');
    });

    test('Cannot act with wrong role', () => {
      const { gm, room, players } = setupGame(5);
      advanceToNight(gm, room, players);
      const { doctor, citizens } = getPlayersByRole(room);

      expect(() => {
        gm.handleNightAction(doctor.id, 'kill', citizens[0].id);
      }).toThrow('Doctor can only perform "save" action.');

      expect(() => {
        gm.handleNightAction(citizens[0].id, 'save', citizens[1].id);
      }).toThrow('Citizens can only perform "shield" action.');
    });

    test('Cannot target dead players', () => {
      const { gm, room, players } = setupGame(5);
      advanceToNight(gm, room, players);
      const { mafia, citizens } = getPlayersByRole(room);

      citizens[0].alive = false;

      expect(() => {
        gm.handleNightAction(mafia[0].id, 'kill', citizens[0].id);
      }).toThrow('Target player is not alive.');
    });

    test('Cannot target self for mafia kill', () => {
      const { gm, room, players } = setupGame(5);
      advanceToNight(gm, room, players);
      const { mafia } = getPlayersByRole(room);

      expect(() => {
        gm.handleNightAction(mafia[0].id, 'kill', mafia[0].id);
      }).toThrow('Mafia cannot target themselves.');
    });

    test('Moderator cannot be targeted', () => {
      const { gm, room, players } = setupGame(5);
      advanceToNight(gm, room, players);
      const { mafia, moderator } = getPlayersByRole(room);

      expect(() => {
        gm.handleNightAction(mafia[0].id, 'kill', moderator.id);
      }).toThrow('Cannot target the moderator.');
    });

    test('Cannot start game with fewer than 3 non-moderator players', () => {
      const gm = new GameManager();
      const mod = gm.createRoom('Mod');
      gm.joinRoom(mod.code, 'P1');
      gm.joinRoom(mod.code, 'P2');

      expect(() => {
        gm.startGame(mod.sessionToken);
      }).toThrow('Need at least 3 players');
    });

    test('Non-moderator cannot start game', () => {
      const gm = new GameManager();
      const mod = gm.createRoom('Mod');
      const p1 = gm.joinRoom(mod.code, 'P1');
      gm.joinRoom(mod.code, 'P2');
      gm.joinRoom(mod.code, 'P3');

      expect(() => {
        gm.startGame(p1.sessionToken);
      }).toThrow('Only the moderator can start the game.');
    });
  });

  // =========================================================================
  // 8. CHAT SUITE
  // =========================================================================
  describe('Chat System', () => {
    test('Messages are sanitized and HTML tags stripped', () => {
      const { gm, room } = setupGame(5);
      room.phase = PHASES.DAWN; // Day phase
      const { citizens } = getPlayersByRole(room);

      const maliciousText = '<script>alert("hacked")</script><b>Hello</b> world!';
      const res = gm.handleChatMessage(citizens[0].id, CHAT_CHANNELS.DAY, maliciousText);

      expect(res.success).toBe(true);
      expect(res.message.text).not.toContain('<script>');
      expect(res.message.text).not.toContain('<b>');
      expect(res.message.text).toContain('Hello');
    });

    test('Dead players can only use ghost chat', () => {
      const { gm, room } = setupGame(5);
      room.phase = PHASES.DAWN;
      const { citizens } = getPlayersByRole(room);

      citizens[0].alive = false;

      // Attempt dayChat while dead
      expect(() => {
        gm.handleChatMessage(citizens[0].id, CHAT_CHANNELS.DAY, 'I am speaking from the grave!');
      }).toThrow('Dead players must speak in the Ghost chat.');

      // Ghost chat succeeds
      const ghostRes = gm.handleChatMessage(citizens[0].id, CHAT_CHANNELS.GHOST, 'Ghost whispers...');
      expect(ghostRes.success).toBe(true);
    });

    test('Mafia chat only available during night', () => {
      const { gm, room, players } = setupGame(5);
      const { mafia } = getPlayersByRole(room);

      // In DAWN (Day), mafia chat throws
      room.phase = PHASES.DAWN;
      expect(() => {
        gm.handleChatMessage(mafia[0].id, CHAT_CHANNELS.MAFIA, 'Are we ready?');
      }).toThrow('Mafia chat is only available during the night.');

      // In NIGHT, mafia chat succeeds
      room.phase = PHASES.NIGHT;
      mafia[0].lastChatMessageAt = 0; // reset cooldown
      const res = gm.handleChatMessage(mafia[0].id, CHAT_CHANNELS.MAFIA, 'We strike at midnight.');
      expect(res.success).toBe(true);
    });

    test('Rate limit prevents spamming messages within 1 second', () => {
      const { gm, room } = setupGame(5);
      room.phase = PHASES.DAWN;
      const { citizens } = getPlayersByRole(room);

      gm.handleChatMessage(citizens[0].id, CHAT_CHANNELS.DAY, 'First message');

      expect(() => {
        gm.handleChatMessage(citizens[0].id, CHAT_CHANNELS.DAY, 'Second message immediately');
      }).toThrow(/too quickly/);
    });
  });

  // =========================================================================
  // 9. TASK ASSIGNMENT & MODERATOR TOME SUITE
  // =========================================================================
  describe('Task Assignment System', () => {
    test('Moderator can assign a charge to a specific player', () => {
      const { gm, modData, players, room } = setupGame(5);
      const targetPlayer = players[0];

      const res = gm.handleAssignTask(modData.sessionToken, {
        targetId: targetPlayer.sessionToken,
        title: 'Gather herbs in the dungeon garden',
        description: 'Collect 3 moonflowers before the nocturnal bell tolls.',
        completionCondition: 'moderator_verify'
      });

      expect(res.success).toBe(true);
      expect(res.task.title).toBe('Gather herbs in the dungeon garden');
      expect(res.task.assigneeIds).toContain(targetPlayer.sessionToken);
      expect(res.task.status).toBe('pending');
      expect(room.tasks.has(res.task.id)).toBe(true);
    });

    test('Moderator can assign a charge to an eligible role', () => {
      const { gm, modData, room } = setupGame(5);
      const res = gm.handleAssignTask(modData.sessionToken, {
        role: 'mafia',
        title: 'Cabal ritual',
        description: 'Coordinate in the shadows.',
        completionCondition: 'moderator_verify'
      });

      expect(res.success).toBe(true);
      expect(res.task.assigneeRole).toBe('mafia');
      const mafiaPlayer = Array.from(room.players.values()).find(p => p.role === ROLES.MAFIA);
      expect(res.task.assigneeIds).toContain(mafiaPlayer.id);
    });

    test('Non-moderator cannot assign a charge', () => {
      const { gm, players } = setupGame(5);
      expect(() => {
        gm.handleAssignTask(players[0].sessionToken, {
          targetId: players[1].sessionToken,
          title: 'Illegal task',
          description: 'Citizens cannot command souls.'
        });
      }).toThrow('Only the moderator');
    });

    test('Moderator can verify task as completed or failed', () => {
      const { gm, modData, players } = setupGame(5);
      const created = gm.handleAssignTask(modData.sessionToken, {
        targetId: players[0].sessionToken,
        title: 'Trial of Valor',
        description: 'Survive the crypt test.',
        completionCondition: 'moderator_verify'
      });

      const verifyRes = gm.handleVerifyTask(modData.sessionToken, {
        taskId: created.task.id,
        outcome: 'completed',
        note: 'Bravely completed.'
      });

      expect(verifyRes.success).toBe(true);
      expect(verifyRes.task.status).toBe('completed');
      expect(verifyRes.task.resultNote).toBe('Bravely completed.');
    });

    test('Moderator can cancel an open task', () => {
      const { gm, modData, players } = setupGame(5);
      const created = gm.handleAssignTask(modData.sessionToken, {
        targetId: players[0].sessionToken,
        title: 'Scout the ramparts',
        description: 'Search for shadows.',
        completionCondition: 'moderator_verify'
      });

      const cancelRes = gm.handleCancelTask(modData.sessionToken, {
        taskId: created.task.id,
        note: 'Order rescinded.'
      });

      expect(cancelRes.success).toBe(true);
      expect(cancelRes.task.status).toBe('cancelled');
    });

    test('Assigned player sees task in their player state', () => {
      const { gm, modData, players } = setupGame(5);
      const target = players[0];
      const other = players[1];

      gm.handleAssignTask(modData.sessionToken, {
        targetId: target.sessionToken,
        title: 'Private Mission',
        description: 'Secret mission for you alone.',
        isPublic: false
      });

      const targetState = gm.getPlayerState(target.sessionToken);
      const otherState = gm.getPlayerState(other.sessionToken);

      expect(targetState.tasks.length).toBe(1);
      expect(targetState.tasks[0].title).toBe('Private Mission');
      expect(otherState.tasks.length).toBe(0);
    });

    test('Public task is visible to all players', () => {
      const { gm, modData, players } = setupGame(5);
      const target = players[0];
      const other = players[1];

      gm.handleAssignTask(modData.sessionToken, {
        targetId: target.sessionToken,
        title: 'Grand Decree',
        description: 'Everyone may observe this deed.',
        isPublic: true
      });

      const targetState = gm.getPlayerState(target.sessionToken);
      const otherState = gm.getPlayerState(other.sessionToken);

      expect(targetState.tasks.length).toBe(1);
      expect(otherState.tasks.length).toBe(1);
      expect(otherState.tasks[0].title).toBe('Grand Decree');
    });
  });
});
