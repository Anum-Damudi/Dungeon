/**
 * server/index.js
 * Main server entry point for the DUNGEON multiplayer social deduction game.
 */

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { gameManager } = require('./gameManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Pass Socket.IO instance to GameManager for broadcasting
gameManager.setIo(io);

// Serve static assets from public/ directory
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

// Parse JSON request bodies
app.use(express.json());

// Basic health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

/**
 * Socket.IO Connection Handler
 */
io.on('connection', (socket) => {
  console.log(`[Socket] New connection established: ${socket.id}`);

  // Helper for callback/error response
  const handleResponse = (callback, error, data) => {
    if (typeof callback === 'function') {
      if (error) {
        callback({ success: false, error: error.message || error });
      } else {
        callback({ success: true, ...data });
      }
    } else if (error) {
      socket.emit('error', { message: error.message || error });
    }
  };

  // Helper to extract session token from payload or socket mapping
  const resolveToken = (payload) => {
    if (payload && payload.sessionToken) return payload.sessionToken;
    return gameManager.socketToSession.get(socket.id);
  };

  // Check for reconnection via handshake auth
  const authSessionToken = socket.handshake.auth && socket.handshake.auth.sessionToken;
  if (authSessionToken) {
    try {
      const reconnectResult = gameManager.handleReconnect(authSessionToken, socket.id);
      socket.join(reconnectResult.roomCode);
      socket.emit('reconnected', reconnectResult);
      socket.emit('game-state', reconnectResult.state);
      console.log(`[Socket] Handshake reconnected player with token: ${authSessionToken}`);
    } catch (err) {
      console.log(`[Socket] Handshake reconnect ignored: ${err.message}`);
    }
  }

  // --- 1. create-room ---
  socket.on('create-room', (payload, callback) => {
    try {
      const playerName = (payload && payload.playerName) || (typeof payload === 'string' ? payload : 'Moderator');
      const result = gameManager.createRoom(playerName, socket.id);
      socket.join(result.code);
      const state = gameManager.getPlayerState(result.sessionToken);
      const createdPayload = {
        code: result.code,
        roomCode: result.code,
        sessionToken: result.sessionToken,
        playerId: result.sessionToken,
        players: state.players,
        state,
        reused: !!result.reused
      };
      socket.emit('room-created', createdPayload);
      socket.emit('game-state', state);
      handleResponse(callback, null, createdPayload);
      console.log(`[Room] Created room ${result.code} by ${playerName}`);
    } catch (err) {
      handleResponse(callback, err);
    }
  });

  // --- 2. join-room ---
  socket.on('join-room', (payload, callback) => {
    try {
      const code = payload && (payload.code || payload.roomCode);
      const playerName = payload && payload.playerName;
      const result = gameManager.joinRoom(code, playerName, socket.id);
      socket.join(code.toUpperCase().trim());
      const state = gameManager.getPlayerState(result.sessionToken);
      const joinedPayload = { sessionToken: result.sessionToken, playerId: result.sessionToken, roomCode: code.toUpperCase().trim(), state };
      socket.emit('room-joined', joinedPayload);
      socket.emit('player-joined', { ...joinedPayload, players: state.players, player: state.me });
      socket.emit('game-state', state);
      handleResponse(callback, null, joinedPayload);
      console.log(`[Room] Player ${playerName} joined room ${code}`);
    } catch (err) {
      handleResponse(callback, err);
    }
  });

  // --- 3. start-game ---
  socket.on('start-game', (payload, callback) => {
    try {
      const sessionToken = resolveToken(payload);
      const result = gameManager.startGame(sessionToken);
      handleResponse(callback, null, result);
      console.log(`[Game] Game started`);
    } catch (err) {
      handleResponse(callback, err);
    }
  });

  // --- 4. envelope-opened ---
  socket.on('envelope-opened', (payload, callback) => {
    try {
      const sessionToken = resolveToken(payload);
      const result = gameManager.handleEnvelopeOpened(sessionToken);
      handleResponse(callback, null, result);
    } catch (err) {
      handleResponse(callback, err);
    }
  });

  // --- 5. rules-acknowledged ---
  socket.on('rules-acknowledged', (payload, callback) => {
    try {
      const sessionToken = resolveToken(payload);
      const result = gameManager.handleRulesAcknowledged(sessionToken);
      handleResponse(callback, null, result);
    } catch (err) {
      handleResponse(callback, err);
    }
  });

  // --- 6. night-action ---
  socket.on('night-action', (payload, callback) => {
    try {
      const sessionToken = resolveToken(payload);
      const action = payload && payload.action;
      const targetId = payload && payload.targetId;
      const result = gameManager.handleNightAction(sessionToken, action, targetId);
      handleResponse(callback, null, result);
    } catch (err) {
      handleResponse(callback, err);
    }
  });

  // --- 7. trial-result ---
  socket.on('trial-result', (payload, callback) => {
    try {
      const sessionToken = resolveToken(payload);
      const trialTypeOrId = payload && (payload.trialId || payload.trialType);
      const successOrAnswer = payload && (payload.answer !== undefined ? payload.answer : payload.success);
      const result = gameManager.handleTrialResult(sessionToken, trialTypeOrId, successOrAnswer);
      handleResponse(callback, null, result);
    } catch (err) {
      handleResponse(callback, err);
    }
  });

  // --- 8. cast-vote ---
  socket.on('cast-vote', (payload, callback) => {
    try {
      const sessionToken = resolveToken(payload);
      const targetId = payload && payload.targetId;
      const result = gameManager.handleCastVote(sessionToken, targetId);
      handleResponse(callback, null, result);
    } catch (err) {
      handleResponse(callback, err);
    }
  });

  // --- 9. chat-message ---
  socket.on('chat-message', (payload, callback) => {
    try {
      const sessionToken = resolveToken(payload);
      const channel = payload && payload.channel;
      const text = payload && (payload.text || payload.message);
      const result = gameManager.handleChatMessage(sessionToken, channel, text);
      handleResponse(callback, null, result);
    } catch (err) {
      handleResponse(callback, err);
    }
  });

  // --- 10. share-clue ---
  socket.on('share-clue', (payload, callback) => {
    try {
      const sessionToken = resolveToken(payload);
      const targetPlayerId = payload && payload.targetPlayerId;
      const result = gameManager.handleShareClue(sessionToken, targetPlayerId);
      handleResponse(callback, null, result);
    } catch (err) {
      handleResponse(callback, err);
    }
  });

  // --- 11. mafia-recruit-response ---
  socket.on('mafia-recruit-response', (payload, callback) => {
    try {
      const sessionToken = resolveToken(payload);
      const accept = payload && payload.accept;
      const result = gameManager.handleMafiaRecruitResponse(sessionToken, accept);
      handleResponse(callback, null, result);
    } catch (err) {
      handleResponse(callback, err);
    }
  });

  // --- 12. mafia-choose-action ---
  socket.on('mafia-choose-action', (payload, callback) => {
    try {
      const sessionToken = resolveToken(payload);
      const action = payload && payload.action;
      const targetId = payload && payload.targetId;
      const result = gameManager.handleMafiaChooseAction(sessionToken, action, targetId);
      handleResponse(callback, null, result);
    } catch (err) {
      handleResponse(callback, err);
    }
  });

  // --- 13. moderator-action ---
  socket.on('moderator-action', (payload, callback) => {
    try {
      const sessionToken = resolveToken(payload);
      const action = payload && payload.action;
      const targetId = payload && payload.targetId;
      const result = gameManager.handleModeratorAction(sessionToken, action, targetId);
      handleResponse(callback, null, result);
    } catch (err) {
      handleResponse(callback, err);
    }
  });

  // --- 13b. Task assignment (moderator-only; authorized in GameManager) ---
  socket.on('assign-task', (payload, callback) => {
    try {
      const sessionToken = resolveToken(payload);
      const result = gameManager.handleAssignTask(sessionToken, payload || {});
      handleResponse(callback, null, result);
    } catch (err) {
      handleResponse(callback, err);
    }
  });

  socket.on('update-task', (payload, callback) => {
    try {
      const sessionToken = resolveToken(payload);
      const result = gameManager.handleUpdateTask(sessionToken, payload || {});
      handleResponse(callback, null, result);
    } catch (err) {
      handleResponse(callback, err);
    }
  });

  socket.on('cancel-task', (payload, callback) => {
    try {
      const sessionToken = resolveToken(payload);
      const result = gameManager.handleCancelTask(sessionToken, payload || {});
      handleResponse(callback, null, result);
    } catch (err) {
      handleResponse(callback, err);
    }
  });

  socket.on('verify-task', (payload, callback) => {
    try {
      const sessionToken = resolveToken(payload);
      const result = gameManager.handleVerifyTask(sessionToken, payload || {});
      handleResponse(callback, null, result);
    } catch (err) {
      handleResponse(callback, err);
    }
  });

  socket.on('complete-task', (payload, callback) => {
    try {
      const sessionToken = resolveToken(payload);
      const result = gameManager.handlePlayerTaskComplete(sessionToken, payload || {});
      handleResponse(callback, null, result);
    } catch (err) {
      handleResponse(callback, err);
    }
  });

  socket.on('request-moderator-dashboard', (payload, callback) => {
    try {
      const sessionToken = resolveToken(payload);
      const dashboard = gameManager.getModeratorDashboard(sessionToken);
      socket.emit('moderator-update', dashboard);
      handleResponse(callback, null, { dashboard });
    } catch (err) {
      handleResponse(callback, err);
    }
  });

  // Client aliases — existing moderator-action / recruit events remain authoritative
  const aliasModerator = (eventName, action, targetKey) => {
    socket.on(eventName, (payload, callback) => {
      try {
        const sessionToken = resolveToken(payload);
        const targetId = payload && (payload[targetKey] || payload.targetId);
        const result = gameManager.handleModeratorAction(sessionToken, action, targetId);
        handleResponse(callback, null, result);
      } catch (err) {
        handleResponse(callback, err);
      }
    });
  };
  aliasModerator('moderator-advance-phase', 'advance-phase');
  aliasModerator('moderator-close-votes', 'close-votes');
  aliasModerator('moderator-pause', 'pause');
  aliasModerator('moderator-kick', 'kick-player', 'playerId');

  socket.on('recruit-response', (payload, callback) => {
    try {
      const sessionToken = resolveToken(payload);
      const result = gameManager.handleMafiaRecruitResponse(sessionToken, payload && payload.accept);
      handleResponse(callback, null, result);
    } catch (err) {
      handleResponse(callback, err);
    }
  });

  socket.on('mafia-death-choice-response', (payload, callback) => {
    try {
      const sessionToken = resolveToken(payload);
      const action = payload && (payload.action || payload.choice);
      const result = gameManager.handleMafiaChooseAction(sessionToken, action, payload && payload.targetId);
      handleResponse(callback, null, result);
    } catch (err) {
      handleResponse(callback, err);
    }
  });

  // --- 14. reconnect ---
  socket.on('reconnect', (payload, callback) => {
    try {
      const sessionToken = payload && payload.sessionToken;
      if (!sessionToken) {
        throw new Error('sessionToken required for reconnection.');
      }
      const result = gameManager.handleReconnect(sessionToken, socket.id);
      socket.join(result.roomCode);
      socket.emit('reconnected', result);
      socket.emit('game-state', result.state);
      handleResponse(callback, null, result);
    } catch (err) {
      handleResponse(callback, err);
    }
  });

  // --- 15. disconnect ---
  socket.on('disconnect', (reason) => {
    console.log(`[Socket] Disconnected: ${socket.id} (${reason})`);
    gameManager.handleDisconnect(socket.id);
  });
});

// Configure PORT from env or 3000
const PORT = process.env.PORT || 3000;

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(`   DUNGEON Social Deduction Game Server       `);
    console.log(`   Running on http://localhost:${PORT}        `);
    console.log(`===============================================`);
  });
}

module.exports = { app, server, io };
