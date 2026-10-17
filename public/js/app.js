/**
 * DUNGEON - Main Client Application Controller
 * Manages Socket.IO connection, state, screen transitions, minigames, chat, and UI events.
 */

(function () {
  'use strict';

  // Clear any legacy localStorage session from previous single-session builds
  try {
    localStorage.removeItem('dungeon-session');
    localStorage.removeItem('dungeon-room');
  } catch (e) {}

  // Check URL parameters for room code
  let urlRoomCode = null;
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const codeFromUrl = urlParams.get('code');
    if (codeFromUrl) {
      urlRoomCode = codeFromUrl.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    }
  } catch (e) {}

  // If visiting an invite link for a different room, clear old tab session
  const storedRoom = sessionStorage.getItem('dungeon-room');
  if (urlRoomCode && storedRoom && storedRoom !== urlRoomCode) {
    sessionStorage.removeItem('dungeon-session');
    sessionStorage.removeItem('dungeon-room');
  }

  // =========================================================================
  // 1. GAME STATE
  // =========================================================================
  const state = {
    sessionToken: sessionStorage.getItem('dungeon-session') || null,
    roomCode: sessionStorage.getItem('dungeon-room') || urlRoomCode || null,
    playerName: null,
    playerId: null,
    role: null,
    phase: null,
    round: 1,
    isModerator: false,
    isAlive: true,
    isButterfly: false,
    hasShield: false,
    players: [],
    currentRuleIndex: 0,
    maxRuleViewed: 0,
    votes: {},
    chatOpen: false,
    currentChatChannel: 'day',
    soundEnabled: true,
    currentTrial: null,
    selectedCandidateId: null,
    selectedNightTarget: null,
    selectedNightAction: null,
    chatMessages: {
      day: [],
      ghost: [],
      mafia: []
    },
    actionLedger: [],
    tasks: [],
    moderatorDashboard: null,
    createRoomPending: false
  };

  const CHANNEL_TO_SERVER = { day: 'dayChat', mafia: 'mafiaChat', ghost: 'ghostChat' };
  const CHANNEL_FROM_SERVER = {
    dayChat: 'day',
    mafiaChat: 'mafia',
    ghostChat: 'ghost',
    day: 'day',
    mafia: 'mafia',
    ghost: 'ghost'
  };

  // 12 sacred rules of DUNGEON (Exact laws)
  const RULES = [
    'Rule 1: The Doctor must win a task to save a person.',
    'Rule 2: If the Doctor saves themself, it is publicly revealed that the Doctor saved himself.',
    'Rule 3: The Detective is provided with clues.',
    'Rule 4: If the Detective shares clues with anyone, that player becomes a "butterfly": silenced (cannot talk or chat) for that voting round.',
    'Rule 5: The Mafia must win a task/mission to kill a person.',
    'Rule 6: If the Mafia fails the mission within the time limit, one of them must die by suicide (chosen at random).',
    'Rule 7: After a citizen is killed by the Mafia, a voting round opens.',
    'Rule 8: Every action by the Doctor, Detective and Mafia is reported to the Moderator in real time.',
    'Rule 9: Citizens can save themselves from being killed by winning a task and earning a shield.',
    'Rule 10: Who holds a shield is never revealed to anyone, including on the attack that consumes it.',
    'Rule 11: If a Mafia member dies, the surviving Mafia choose to either continue killing or recruit a new member.',
    'Rule 12: A recruit request is sent to one citizen, who must accept or decline. Win conditions: Citizens win when no Mafia remain; Mafia wins when living Mafia equal or exceed living non-moderator players.'
  ];

  const ROLE_ICONS = {
    MAFIA: '🗡️',
    DOCTOR: '⚕️',
    DETECTIVE: '🔍',
    CITIZEN: '🛡️'
  };

  const ROLE_DESCRIPTIONS = {
    MAFIA: 'Eliminate the innocent souls of the dungeon under cover of darkness. Coordinate with your cabal and deceive the living.',
    DOCTOR: 'Guard the living against nocturnal slaughter. Choose one soul each night to shield from the clutches of the Mafia.',
    DETECTIVE: 'Seek the truth hidden in the shadows. Uncover clues about player loyalties, but beware the butterfly silence when sharing secrets.',
    CITIZEN: 'Survive the shadows and uncover the deceivers. You have no innate powers, but you may forge a shield through trial and cast your vote in the Tribunal.'
  };

  // =========================================================================
  // 2. SOCKET.IO CONNECTION
  // =========================================================================
  const socket = typeof io === 'function'
    ? io({
        auth: (cb) => {
          cb({ sessionToken: state.sessionToken });
        },
        transports: ['websocket', 'polling']
      })
    : {
        on: () => {},
        emit: () => {},
        connected: false
      };

  // =========================================================================
  // 3. UI UTILITIES & TOASTS
  // =========================================================================
  function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(screenId);
    if (target) {
      target.classList.add('active');
    }

    // Portal animation lifecycle
    if (screenId === 'screen-lobby') {
      if (window.initPortal) {
        window.initPortal('portal-canvas');
      }
    } else {
      if (window.destroyPortal) {
        window.destroyPortal();
      }
    }
  }

  function emitAck(event, payload, onSuccess) {
    const body = Object.assign({ sessionToken: state.sessionToken }, payload || {});
    socket.emit(event, body, (res) => {
      if (!res || res.success === false) {
        const msg = (res && (res.error || res.message)) || 'The dungeon rejected that request.';
        showToast(msg, 3500);
        return;
      }
      if (typeof onSuccess === 'function') onSuccess(res);
    });
  }

  function normalizeRole(role) {
    return role ? String(role).toUpperCase() : null;
  }

  function mapPlayers(list) {
    return (list || []).map(p => ({
      ...p,
      role: p.role ? String(p.role).toUpperCase() : p.role,
      isAlive: p.isAlive !== undefined ? p.isAlive : p.alive !== false
    }));
  }

  function applyCreatedRoom(data) {
    const code = data.roomCode || data.code || (data.state && data.state.roomCode);
    if (!code) {
      setCreateStatus(false, 'The portal opened, but no room code was returned.');
      showToast('Room creation failed: missing room code.');
      return false;
    }
    state.roomCode = code;
    try {
      window.history.replaceState(null, '', `?code=${code}`);
    } catch (e) {}
    state.sessionToken = data.sessionToken || state.sessionToken;
    state.isModerator = true;
    state.playerId = data.playerId || (data.state && data.state.me && data.state.me.id) || state.sessionToken;
    if (state.sessionToken) {
      sessionStorage.setItem('dungeon-session', state.sessionToken);
      sessionStorage.setItem('dungeon-room', code);
      if (socket) {
        socket.auth = { sessionToken: state.sessionToken };
      }
    }
    if (data.state) {
      applyServerState(data.state);
    } else {
      state.players = mapPlayers(data.players) || [{ name: state.playerName, id: state.playerId, isModerator: true, isAlive: true }];
      updateLobbyUI();
    }
    const chatPanel = document.getElementById('chat-panel');
    if (chatPanel) chatPanel.style.display = 'block';
    showScreen('screen-lobby');
    showToast(`Dungeon room created: ${code}`);
    return true;
  }

  function setCreateStatus(isLoading, errorMsg) {
    const btn = document.getElementById('btn-create-confirm');
    const status = document.getElementById('create-status');
    if (btn) {
      btn.disabled = !!isLoading;
      btn.textContent = isLoading ? 'Opening the portal...' : 'Summon the Portal';
    }
    if (status) {
      status.textContent = errorMsg || (isLoading ? 'Inscribing a unique room sigil...' : '');
      status.classList.toggle('error', !!errorMsg);
    }
  }

  function applyServerState(serverState, extra) {
    extra = extra || {};
    if (!serverState) return;

    if (serverState.roomCode) {
      state.roomCode = serverState.roomCode;
      try {
        window.history.replaceState(null, '', `?code=${serverState.roomCode}`);
      } catch (e) {}
    }
    if (serverState.phase) state.phase = serverState.phase;
    if (typeof serverState.round === 'number') state.round = serverState.round;

    if (serverState.me) {
      state.playerId = serverState.me.id;
      state.playerName = serverState.me.name;
      state.role = normalizeRole(serverState.me.role) || state.role;
      state.isModerator = !!serverState.me.isModerator;
      state.isAlive = serverState.me.alive !== false;
      state.isButterfly = !!serverState.me.isButterfly;
      state.hasShield = !!serverState.me.hasShield;
      if (serverState.me.myClue) state.myClue = serverState.me.myClue;
      if (state.role) {
        renderRoleDetails({ role: state.role });
      }
    }

    if (Array.isArray(serverState.players)) {
      state.players = mapPlayers(serverState.players);
    }
    if (serverState.actionLog) state.actionLedger = serverState.actionLog;
    if (serverState.moderatorLedger) state.actionLedger = serverState.moderatorLedger;
    if (serverState.moderatorDashboard) {
      state.moderatorDashboard = serverState.moderatorDashboard;
      updateModeratorDashboard(serverState.moderatorDashboard);
    }
    if (Array.isArray(serverState.tasks)) {
      state.tasks = serverState.tasks;
      renderPlayerTasks(serverState.tasks);
    }
    if (serverState.chats) {
      state.chatMessages.day = serverState.chats.day || [];
      state.chatMessages.mafia = serverState.chats.mafia || [];
      state.chatMessages.ghost = serverState.chats.ghost || [];
      renderChatMessages();
    }

    const chatPanel = document.getElementById('chat-panel');
    if (chatPanel && state.roomCode) chatPanel.style.display = 'block';

    updateChatTabVisibility();
    updateLobbyUI();

    if (extra.announcements && extra.announcements.length) {
      renderDawnPhase({ message: extra.announcements.join(' ') });
    }
    if (extra.eliminatedPlayer || extra.announcement) {
      renderVoteResult({
        banished: extra.eliminatedPlayer,
        announcement: extra.announcement,
        tie: !extra.eliminatedPlayer
      });
    }

    routeByPhase(serverState.phase);
  }

  function routeByPhase(phase) {
    if (!phase) return;
    const lower = String(phase).toLowerCase().replace(/_/g, '-');
    if (state.isModerator && lower !== 'lobby') {
      showScreen('screen-moderator');
      if (state.moderatorDashboard) {
        updateModeratorDashboard(state.moderatorDashboard);
      }
      return;
    }
    const map = {
      lobby: 'screen-lobby',
      'rules-display': 'screen-rules',
      'role-reveal': 'screen-role-reveal',
      night: 'screen-night',
      'night-resolution': 'screen-night',
      dawn: 'screen-dawn',
      voting: 'screen-voting',
      'vote-result': 'screen-vote-result',
      'game-over': 'screen-game-over'
    };
    if (map[lower]) showScreen(map[lower]);
    if (lower === 'rules-display') {
      updateRulesCarousel();
    }
    if (lower === 'role-reveal') {
      renderRoleDetails({ role: state.role });
    }
    if (lower === 'night' && !state.isModerator && !state.currentTrial) {
      renderNightPanel({ round: state.round });
    }
    if (lower === 'voting' && !state.isModerator) {
      const votingScreen = document.getElementById('screen-voting');
      if (votingScreen && !votingScreen.classList.contains('active')) {
        renderVotingScreen({ candidates: state.players });
      }
    }
  }

  function renderPlayerTasks(tasks) {
    const panel = document.getElementById('task-panel');
    const list = document.getElementById('player-task-list');
    if (!panel || !list) return;
    const mine = (tasks || []).filter(t =>
      t.isPublic || (t.assigneeIds && t.assigneeIds.indexOf(state.playerId) !== -1)
    );
    if (!mine.length || state.isModerator) {
      panel.style.display = 'none';
      list.innerHTML = '';
      return;
    }
    panel.style.display = 'block';
    list.innerHTML = mine.map(t => `
      <div class="task-card task-${escapeHtml(t.status)}">
        <div class="task-status">${escapeHtml(t.status)}</div>
        <strong>${escapeHtml(t.title)}</strong>
        <p>${escapeHtml(t.description)}</p>
        ${t.objective ? `<p>${escapeHtml(t.objective)}</p>` : ''}
      </div>
    `).join('');
  }

  function showToast(message, duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-fade-out');
      setTimeout(() => {
        if (toast.parentNode) {
          toast.remove();
        }
      }, 400);
    }, duration);
  }

  /**
   * Reusable modal dialog for interactive prompts (recruitment, death choices, confirmations).
   */
  function showModal({ title, message, buttons }) {
    let overlay = document.getElementById('dungeon-active-modal');
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.id = 'dungeon-active-modal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-card">
        <h3 class="modal-title">${title}</h3>
        <p class="modal-message">${message}</p>
        <div class="modal-buttons" id="modal-buttons-container"></div>
      </div>
    `;
    document.body.appendChild(overlay);

    const btnContainer = overlay.querySelector('#modal-buttons-container');
    buttons.forEach(btnConfig => {
      const btn = document.createElement('button');
      btn.className = `btn ${btnConfig.primary ? 'btn-primary' : 'btn-secondary'}`;
      btn.textContent = btnConfig.text;
      btn.addEventListener('click', () => {
        overlay.remove();
        if (typeof btnConfig.onClick === 'function') {
          btnConfig.onClick();
        }
      });
      btnContainer.appendChild(btn);
    });
  }

  // =========================================================================
  // 4. SCREEN HANDLERS & NAVIGATION
  // =========================================================================

  // --- ENTRY SCREEN ---
  function initEntryScreen() {
    const btnCreate = document.getElementById('btn-create');
    const btnJoin = document.getElementById('btn-join');
    const inputCode = document.getElementById('input-code');
    const inputNameJoin = document.getElementById('input-name-join');

    if (btnCreate) {
      btnCreate.addEventListener('click', () => {
        showScreen('screen-create');
        const inputNameCreate = document.getElementById('input-name-create');
        if (inputNameCreate) inputNameCreate.focus();
      });
    }

    if (inputCode) {
      inputCode.addEventListener('input', () => {
        inputCode.value = inputCode.value.toUpperCase().replace(/[^A-Z]/g, '');
        if (inputCode.value.length === 4 && inputNameJoin) {
          inputNameJoin.focus();
        }
      });

      inputCode.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && inputNameJoin) {
          inputNameJoin.focus();
        }
      });
    }

    if (inputNameJoin) {
      inputNameJoin.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && btnJoin) {
          btnJoin.click();
        }
      });
    }

    if (btnJoin) {
      btnJoin.addEventListener('click', () => {
        const code = inputCode ? inputCode.value.trim().toUpperCase() : '';
        const name = inputNameJoin ? inputNameJoin.value.trim() : '';

        if (!/^[A-Z]{4}$/.test(code)) {
          showToast('Room code must be exactly 4 letters.');
          if (inputCode) inputCode.focus();
          return;
        }

        if (!name) {
          showToast('Please enter your name.');
          if (inputNameJoin) inputNameJoin.focus();
          return;
        }

        state.playerName = name;
        state.roomCode = code;

        emitAck('join-room', { roomCode: code, playerName: name }, (res) => {
          if (!res) return;
          if (res.sessionToken) {
            state.sessionToken = res.sessionToken;
            sessionStorage.setItem('dungeon-session', res.sessionToken);
            sessionStorage.setItem('dungeon-room', code);
            if (socket) {
              socket.auth = { sessionToken: res.sessionToken };
            }
          }
          if (res.playerId) {
            state.playerId = res.playerId;
          }
          applyServerState(res.state || res);
          try {
            window.history.replaceState(null, '', `?code=${code}`);
          } catch (e) {}
          showScreen('screen-lobby');
        });
      });
    }

    // Auto-fill room code from URL parameters (?code=XXXX)
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const codeFromUrl = urlParams.get('code');
      if (codeFromUrl && inputCode) {
        const cleanCode = codeFromUrl.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
        if (cleanCode.length > 0) {
          inputCode.value = cleanCode;
          if (inputNameJoin) inputNameJoin.focus();
        }
      }
    } catch (e) {}
  }

  // --- CREATE SCREEN ---
  function initCreateScreen() {
    const btnConfirm = document.getElementById('btn-create-confirm');
    const inputNameCreate = document.getElementById('input-name-create');

    if (inputNameCreate) {
      inputNameCreate.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && btnConfirm) {
          btnConfirm.click();
        }
      });
    }

    if (btnConfirm) {
      btnConfirm.addEventListener('click', () => {
        if (state.createRoomPending) return;

        const name = inputNameCreate ? inputNameCreate.value.trim() : '';
        if (!name) {
          setCreateStatus(false, 'Please enter your name.');
          showToast('Please enter your name.');
          if (inputNameCreate) inputNameCreate.focus();
          return;
        }

        if (!socket.connected) {
          setCreateStatus(false, 'Not connected to the dungeon server.');
          showToast('Not connected to the dungeon server.');
          return;
        }

        state.playerName = name;
        state.isModerator = true;
        state.createRoomPending = true;
        setCreateStatus(true);

        const payload = { playerName: name };
        const timeoutId = setTimeout(() => {
          if (!state.createRoomPending) return;
          state.createRoomPending = false;
          setCreateStatus(false, 'The portal did not respond. Try again.');
          showToast('Room creation timed out.');
        }, 10000);

        socket.emit('create-room', payload, (res) => {
          clearTimeout(timeoutId);
          state.createRoomPending = false;
          if (!res || res.success === false) {
            setCreateStatus(false, (res && (res.error || res.message)) || 'Room creation failed.');
            showToast((res && (res.error || res.message)) || 'Room creation failed.');
            return;
          }
          setCreateStatus(false);
          applyCreatedRoom(res);
        });
      });
    }

    const btnBack = document.getElementById('btn-back-entry');
    if (btnBack) {
      btnBack.addEventListener('click', () => {
        showScreen('screen-entry');
      });
    }
  }

  // --- LOBBY SCREEN ---
  function updateLobbyUI() {
    const codeDisplay = document.getElementById('room-code-display');
    const playerCount = document.getElementById('player-count');
    const playerList = document.getElementById('player-list');
    const btnStart = document.getElementById('btn-start');
    const statusText = document.getElementById('lobby-status');

    if (codeDisplay) {
      codeDisplay.textContent = state.roomCode || '----';
    }

    if (playerCount) {
      playerCount.textContent = state.players.length;
    }

    if (playerList) {
      playerList.innerHTML = '';
      state.players.forEach(p => {
        const li = document.createElement('li');
        li.className = 'player-item';
        const isSelf = p.id === state.playerId || p.name === state.playerName;
        const modBadge = p.isModerator ? ' <span class="badge badge-mod">Moderator</span>' : '';
        const selfBadge = isSelf ? ' <span class="badge badge-self">You</span>' : '';
        li.innerHTML = `<span class="player-name">${escapeHtml(p.name)}</span>${modBadge}${selfBadge}`;
        playerList.appendChild(li);
      });
    }

    const nonModCount = state.players.filter(p => !p.isModerator).length;
    const canStart = nonModCount >= 3;

    const btnTome = document.getElementById('btn-open-tome');
    if (btnStart) {
      if (state.isModerator) {
        btnStart.style.display = 'inline-block';
        btnStart.disabled = !canStart;
      } else {
        btnStart.style.display = 'none';
      }
    }
    if (btnTome) {
      btnTome.style.display = state.isModerator ? 'inline-block' : 'none';
    }

    if (statusText) {
      if (!canStart) {
        statusText.textContent = `Need at least 3 mortal souls to begin the ritual (${nonModCount}/3 mortals gathered).`;
      } else if (state.isModerator) {
        statusText.textContent = `Ritual circle is complete (${state.players.length} souls gathered). You may begin the ritual!`;
      } else {
        statusText.textContent = 'Awaiting the Moderator to begin the ritual...';
      }
    }
  }

  function initLobbyScreen() {
    const btnStart = document.getElementById('btn-start');
    const inviteLink = document.getElementById('invite-link');

    if (btnStart) {
      btnStart.addEventListener('click', () => {
        if (!state.isModerator) return;
        const nonModCount = state.players.filter(p => !p.isModerator).length;
        if (nonModCount < 3) {
          showToast('At least 3 mortal souls are required.');
          return;
        }
        btnStart.disabled = true;
        btnStart.textContent = 'Summoning the darkness...';
        emitAck('start-game', {}, () => {
          btnStart.disabled = false;
          btnStart.textContent = 'Begin the Ritual';
          showToast('The ritual has begun!');
        });
      });
    }

    const btnTome = document.getElementById('btn-open-tome');
    if (btnTome) {
      btnTome.addEventListener('click', () => {
        if (!state.isModerator) return;
        showScreen('screen-moderator');
        emitAck('request-moderator-dashboard', {}, (res) => {
          if (res && res.dashboard) updateModeratorDashboard(res.dashboard);
        });
      });
    }

    if (inviteLink) {
      inviteLink.addEventListener('click', (e) => {
        e.preventDefault();
        const code = state.roomCode || (document.getElementById('room-code-display') ? document.getElementById('room-code-display').textContent.trim() : '');
        if (!code || code === '----') {
          showToast('Room code is not available yet.');
          return;
        }
        const url = `${window.location.origin}${window.location.pathname}?code=${encodeURIComponent(code)}`;
        copyTextToClipboard(url, 'Invite link copied to clipboard!');
      });
    }
  }

  function copyTextToClipboard(text, successMsg) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        showToast(successMsg || 'Invite link copied to clipboard!');
      }).catch(() => {
        fallbackCopyText(text, successMsg);
      });
    } else {
      fallbackCopyText(text, successMsg);
    }
  }

  function fallbackCopyText(text, successMsg) {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      if (successful) {
        showToast(successMsg || 'Invite link copied to clipboard!');
      } else {
        prompt('Copy this invite link:', text);
      }
    } catch (e) {
      prompt('Copy this invite link:', text);
    }
  }

  // --- ROLE REVEAL SCREEN ---
  function initRoleRevealScreen() {
    const envelope = document.getElementById('envelope');
    const btnAcknowledge = document.getElementById('btn-acknowledge-role');

    if (envelope) {
      const handleFlip = () => {
        if (envelope.classList.contains('flipped')) return;
        envelope.classList.add('flipped');

        if (window.AudioManager) {
          window.AudioManager.play('waxSealClick');
        }

        setTimeout(() => {
          if (btnAcknowledge) {
            btnAcknowledge.style.display = 'inline-block';
            btnAcknowledge.disabled = false;
            btnAcknowledge.textContent = 'I Accept My Fate';
          }
        }, 800);
      };

      // Break seal on single click, double-click, tap, or enter
      envelope.addEventListener('click', () => {
        handleFlip();
      });

      envelope.addEventListener('dblclick', (e) => {
        e.preventDefault();
        handleFlip();
      });

      // Mobile double-tap detection (< 350ms)
      let lastTapTime = 0;
      envelope.addEventListener('touchend', (e) => {
        const currentTime = Date.now();
        const tapLength = currentTime - lastTapTime;
        if (tapLength > 0 && tapLength < 350) {
          e.preventDefault();
          handleFlip();
        }
        lastTapTime = currentTime;
      });

      // Keyboard accessibility (Enter or Space)
      envelope.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleFlip();
        }
      });
    }

    if (btnAcknowledge) {
      btnAcknowledge.addEventListener('click', () => {
        socket.emit('envelope-opened');
        btnAcknowledge.disabled = true;
        btnAcknowledge.textContent = 'Awaiting other souls to enter the darkness...';
      });
    }
  }

  function renderRoleDetails(roleData) {
    roleData = roleData || {};
    const role = (roleData.role || state.role || 'CITIZEN').toUpperCase();
    state.role = role;

    const iconEl = document.getElementById('role-icon');
    const nameEl = document.getElementById('role-name');
    const descEl = document.getElementById('role-description');
    const teammatesEl = document.getElementById('role-teammates');

    if (iconEl) iconEl.textContent = ROLE_ICONS[role] || '🛡️';
    if (nameEl) nameEl.textContent = role;
    if (descEl) descEl.textContent = roleData.description || ROLE_DESCRIPTIONS[role] || '';

    if (teammatesEl) {
      if (role === 'MAFIA') {
        const teammates = (Array.isArray(roleData.teammates) && roleData.teammates.length)
          ? roleData.teammates
          : state.players.filter(p => p.role === 'MAFIA' && p.id !== state.playerId);
        const mateNames = teammates
          .filter(t => (t.id || t) !== (state.playerId || state.playerName))
          .map(t => typeof t === 'string' ? t : t.name);

        if (mateNames.length > 0) {
          teammatesEl.innerHTML = `<strong>Cabal Comrades:</strong> ${escapeHtml(mateNames.join(', '))}`;
          teammatesEl.style.display = 'block';
        } else {
          teammatesEl.innerHTML = `<em>You are currently the lone predator in the dark.</em>`;
          teammatesEl.style.display = 'block';
        }
      } else {
        teammatesEl.innerHTML = '';
        teammatesEl.style.display = 'none';
      }
    }

    updateChatTabVisibility();
  }

  // --- RULES CAROUSEL ---
  function updateRulesCarousel() {
    const ruleNumEl = document.getElementById('rule-number');
    const ruleTextEl = document.getElementById('rule-text');
    const progressEl = document.getElementById('rules-progress');
    const btnPrev = document.getElementById('btn-rule-prev');
    const btnNext = document.getElementById('btn-rule-next');
    const btnDone = document.getElementById('btn-rules-done');

    const idx = state.currentRuleIndex;
    if (idx > state.maxRuleViewed) {
      state.maxRuleViewed = idx;
    }

    if (ruleNumEl) ruleNumEl.textContent = `Law ${idx + 1} of ${RULES.length}`;
    if (ruleTextEl) ruleTextEl.textContent = RULES[idx];
    if (progressEl) progressEl.textContent = `${idx + 1} / ${RULES.length}`;

    if (btnPrev) btnPrev.disabled = idx === 0;
    if (btnNext) btnNext.disabled = idx === RULES.length - 1;

    // Show 'Enter the Dungeon' button only after viewing all 12
    if (btnDone) {
      if (state.maxRuleViewed >= RULES.length - 1 || idx === RULES.length - 1) {
        btnDone.style.display = 'inline-block';
      }
    }
  }

  function initRulesScreen() {
    const btnPrev = document.getElementById('btn-rule-prev');
    const btnNext = document.getElementById('btn-rule-next');
    const btnDone = document.getElementById('btn-rules-done');

    if (btnPrev) {
      btnPrev.addEventListener('click', () => {
        if (state.currentRuleIndex > 0) {
          state.currentRuleIndex--;
          updateRulesCarousel();
        }
      });
    }

    if (btnNext) {
      btnNext.addEventListener('click', () => {
        if (state.currentRuleIndex < RULES.length - 1) {
          state.currentRuleIndex++;
          updateRulesCarousel();
        }
      });
    }

    if (btnDone) {
      btnDone.addEventListener('click', () => {
        socket.emit('rules-acknowledged');
        btnDone.disabled = true;
        btnDone.textContent = 'Awaiting other souls...';
      });
    }
  }

  // --- NIGHT PHASE INTERVAL COUNTDOWN (5-MINUTE INTERVAL) ---
  let nightTimerInterval = null;
  function startNightCountdown(deadlineMs) {
    if (nightTimerInterval) {
      clearInterval(nightTimerInterval);
      nightTimerInterval = null;
    }

    const timerContainer = document.getElementById('night-timer-container');
    const timerDisplay = document.getElementById('night-timer-display');
    if (!timerDisplay) return;

    const updateTimer = () => {
      const now = Date.now();
      const targetDeadline = deadlineMs || (now + 300 * 1000);
      const remainingMs = Math.max(0, targetDeadline - now);
      const totalSeconds = Math.floor(remainingMs / 1000);
      const mins = Math.floor(totalSeconds / 60);
      const secs = totalSeconds % 60;
      timerDisplay.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

      if (timerContainer) {
        if (totalSeconds <= 60 && totalSeconds > 0) {
          timerContainer.classList.add('timer-urgent');
        } else {
          timerContainer.classList.remove('timer-urgent');
        }
      }

      if (remainingMs <= 0) {
        clearInterval(nightTimerInterval);
        nightTimerInterval = null;
      }
    };

    updateTimer();
    nightTimerInterval = setInterval(updateTimer, 1000);
  }

  // --- NIGHT PHASE ---
  function renderNightPanel(promptData) {
    const panel = document.getElementById('night-action-panel');
    const trialContainer = document.getElementById('trial-container');
    const waitingMsg = document.getElementById('night-waiting');
    const roundSpan = document.getElementById('night-round');

    if (roundSpan) {
      roundSpan.textContent = promptData.round || state.round || 1;
    }

    if (waitingMsg) waitingMsg.style.display = 'none';
    if (trialContainer) {
      trialContainer.innerHTML = '';
      trialContainer.style.display = 'none';
    }

    if (!panel) return;
    panel.innerHTML = '';
    panel.style.display = 'block';

    const role = (state.role || 'CITIZEN').toUpperCase();
    const living = state.players.filter(p => p.isAlive !== false);

    // If player is already dead, show observer message
    if (!state.isAlive) {
      panel.innerHTML = `
        <div class="night-ghost-notice">
          <h3>The Veil of Death</h3>
          <p>You wander the ethereal planes. The living scheme in silence below.</p>
        </div>
      `;
      return;
    }

    switch (role) {
      case 'MAFIA': {
        const victims = living.filter(p => (p.role !== 'MAFIA') && (p.id !== state.playerId));
        panel.innerHTML = `
          <h3>Choose a Victim to Strike</h3>
          <p class="panel-subtitle">Select a soul and overcome the ancient trial to strike.</p>
          <div class="target-grid" id="night-target-grid">
            ${victims.map(p => `
              <button type="button" class="btn-target" data-id="${p.id}">
                ${escapeHtml(p.name)}
              </button>
            `).join('')}
          </div>
          <button id="btn-night-confirm" class="btn btn-primary" disabled>Execute Strike</button>
        `;
        setupNightSelection(panel, 'kill', promptData.trial);
        break;
      }

      case 'DOCTOR': {
        // Doctor can save any living player including self
        panel.innerHTML = `
          <h3>Choose a Soul to Protect</h3>
          <p class="panel-subtitle">Select who shall receive your life-preserving ward.</p>
          <div class="target-grid" id="night-target-grid">
            ${living.map(p => `
              <button type="button" class="btn-target" data-id="${p.id}">
                ${escapeHtml(p.name)}${p.id === state.playerId ? ' (Self)' : ''}
              </button>
            `).join('')}
          </div>
          <button id="btn-night-confirm" class="btn btn-primary" disabled>Cast Protection</button>
        `;
        setupNightSelection(panel, 'save', promptData.trial);
        break;
      }

      case 'DETECTIVE': {
        const otherLiving = living.filter(p => p.id !== state.playerId);
        const clueText = promptData.clue || state.myClue;
        if (!clueText) {
          panel.innerHTML = `
            <h3>Detective's Investigation</h3>
            <p class="panel-subtitle">Conquer the rune trial to unearth a nocturnal clue.</p>
            <button id="btn-investigate" class="btn btn-primary">Begin Investigation</button>
          `;
          const btnInvestigate = panel.querySelector('#btn-investigate');
          if (btnInvestigate) {
            btnInvestigate.addEventListener('click', () => {
              panel.style.display = 'none';
              emitAck('night-action', { action: 'investigate' }, (res) => {
                const trial = res.trial;
                if (!trial) return;
                executeTrial(trial, (trialResult) => {
                  emitAck('trial-result', {
                    trialId: trial.trialId || trial.id,
                    trialType: trial.type,
                    success: trialResult.success,
                    answer: trialResult.answer
                  }, (trialRes) => {
                    if (trialRes && trialRes.clue) {
                      state.myClue = trialRes.clue;
                      renderNightPanel({ round: state.round, clue: trialRes.clue });
                    }
                  });
                });
              });
            });
          }
          break;
        }
        panel.innerHTML = `
          <h3>Detective's Investigation</h3>
          <div class="clue-display-box">
            <strong>Revealed Clue:</strong>
            <p class="clue-text">${escapeHtml(clueText)}</p>
          </div>
          <p class="panel-subtitle">You may share this clue with a soul (which will butterfly-silence them):</p>
          <div class="target-grid" id="night-target-grid">
            ${otherLiving.map(p => `
              <button type="button" class="btn-target" data-id="${p.id}">
                ${escapeHtml(p.name)}
              </button>
            `).join('')}
          </div>
          <div class="detective-actions">
            <button id="btn-night-confirm" class="btn btn-primary" disabled>Share Clue (Butterfly)</button>
            <button id="btn-night-skip" class="btn btn-secondary">Keep Clue Secret</button>
          </div>
        `;

        setupNightSelection(panel, 'share-clue', null);

        const btnSkip = panel.querySelector('#btn-night-skip');
        if (btnSkip) {
          btnSkip.addEventListener('click', () => {
            panel.style.display = 'none';
            if (waitingMsg) waitingMsg.style.display = 'block';
            emitAck('night-action', { action: 'skip' });
          });
        }
        break;
      }

      case 'CITIZEN':
      default: {
        panel.innerHTML = `
          <h3>Mortal Vigil</h3>
          <p class="panel-subtitle">The night is cold and full of terror. You may attempt to forge a protective shield:</p>
          <div class="citizen-actions">
            <button id="btn-forge-shield" class="btn btn-primary">Attempt to Forge Shield (Trial)</button>
            <button id="btn-citizen-rest" class="btn btn-secondary">Rest in Darkness</button>
          </div>
        `;

        const btnForge = panel.querySelector('#btn-forge-shield');
        const btnRest = panel.querySelector('#btn-citizen-rest');

        if (btnForge) {
          btnForge.addEventListener('click', () => {
            panel.style.display = 'none';
            emitAck('night-action', { action: 'shield' }, (res) => {
              const trial = res.trial || promptData.trial;
              if (!trial) {
                showToast('No trial was issued.');
                return;
              }
              executeTrial(trial, (trialResult) => {
                emitAck('trial-result', {
                  trialId: trial.trialId || trial.id,
                  trialType: trial.type,
                  success: trialResult.success,
                  answer: trialResult.answer
                });
                if (trialResult.success) {
                  state.hasShield = true;
                  showToast('Mystic shield forged successfully!');
                } else {
                  showToast('The shield shattered during forging.');
                }
              });
            });
          });
        }

        if (btnRest) {
          btnRest.addEventListener('click', () => {
            panel.style.display = 'none';
            if (waitingMsg) waitingMsg.style.display = 'block';
            emitAck('night-action', { action: 'rest' });
          });
        }
        break;
      }
    }
  }

  function setupNightSelection(panel, actionType, trialConfig) {
    const targets = panel.querySelectorAll('.btn-target');
    const confirmBtn = panel.querySelector('#btn-night-confirm');
    let selectedId = null;

    targets.forEach(btn => {
      btn.addEventListener('click', () => {
        targets.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedId = btn.dataset.id;
        if (confirmBtn) confirmBtn.disabled = false;
      });
    });

    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        if (!selectedId) return;

        panel.style.display = 'none';

        if (actionType === 'kill' || actionType === 'save' || actionType === 'investigate') {
          emitAck('night-action', { action: actionType, targetId: selectedId }, (res) => {
            const trial = res.trial || trialConfig;
            if (!trial) {
              showToast('No trial was issued by the dungeon.');
              return;
            }
            executeTrial(trial, (trialResult) => {
              emitAck('trial-result', {
                trialId: trial.trialId || trial.id,
                trialType: trial.type,
                success: trialResult.success,
                answer: trialResult.answer
              }, (trialRes) => {
                if (trialRes && trialRes.clue) {
                  showToast(`Clue unsealed: ${trialRes.clue}`, 5000);
                }
              });
            });
          });
        } else if (actionType === 'share-clue') {
          emitAck('share-clue', { targetPlayerId: selectedId });
          const waitingMsg = document.getElementById('night-waiting');
          if (waitingMsg) waitingMsg.style.display = 'block';
        } else {
          emitAck('night-action', { action: actionType, targetId: selectedId });
          const waitingMsg = document.getElementById('night-waiting');
          if (waitingMsg) waitingMsg.style.display = 'block';
        }
      });
    }
  }

  function executeTrial(trialData, onFinished) {
    const trialContainer = document.getElementById('trial-container');
    const waitingMsg = document.getElementById('night-waiting');
    if (!trialContainer) return;

    state.currentTrial = trialData;
    trialContainer.style.display = 'block';

    if (window.renderTrial) {
      window.renderTrial(trialContainer, trialData, (result) => {
        trialContainer.style.display = 'none';
        trialContainer.innerHTML = '';
        state.currentTrial = null;
        if (waitingMsg) waitingMsg.style.display = 'block';
        if (typeof onFinished === 'function') {
          onFinished(result);
        }
      });
    } else {
      // Fallback if renderTrial is somehow missing
      trialContainer.style.display = 'none';
      if (waitingMsg) waitingMsg.style.display = 'block';
      if (typeof onFinished === 'function') {
        onFinished({ success: true, answer: null });
      }
    }
  }

  // --- DAWN PHASE ---
  function renderDawnPhase(announcementData) {
    const msgEl = document.getElementById('dawn-message');
    const message = announcementData.message || 'Dawn breaks over the cold dungeon walls.';

    if (msgEl) {
      msgEl.innerHTML = `<p class="dawn-text">${escapeHtml(message)}</p>`;
    }

    if (window.AudioManager) {
      window.AudioManager.play('dawnBell');
    }

    // Check if player died
    if (announcementData.deadPlayer && (announcementData.deadPlayer.id === state.playerId || announcementData.deadPlayer === state.playerId)) {
      state.isAlive = false;
      if (window.AudioManager) {
        window.AudioManager.play('deathKnell');
      }
      showToast('You were struck down in the shadows! You are now a ghost.', 5000);
      updateChatTabVisibility();
    }

    showScreen('screen-dawn');

    // Auto-advance after 5 seconds if server hasn't already sent phase change
    setTimeout(() => {
      if (state.phase === 'dawn' || state.phase === 'screen-dawn') {
        // Will transition when server emits 'phase-change' or 'vote-opened'
      }
    }, 5000);
  }

  // --- VOTING PHASE (THE TRIBUNAL) ---
  function renderVotingScreen(voteData) {
    const candidatesContainer = document.getElementById('voting-candidates');
    const butterflyNotice = document.getElementById('butterfly-notice');
    const timerEl = document.getElementById('vote-timer');

    state.selectedCandidateId = null;

    if (window.AudioManager) {
      window.AudioManager.play('heartbeat');
    }

    // Check butterfly state
    if (state.isButterfly) {
      if (butterflyNotice) butterflyNotice.style.display = 'block';
    } else {
      if (butterflyNotice) butterflyNotice.style.display = 'none';
    }

    if (timerEl && voteData.timer) {
      startVoteTimer(timerEl, voteData.timer);
    }

    if (!candidatesContainer) return;
    candidatesContainer.innerHTML = '';

    const living = (voteData.candidates || state.players).filter(p => p.isAlive !== false);

    living.forEach(player => {
      const isSelf = player.id === state.playerId;
      const card = document.createElement('div');
      card.className = `candidate-card ${isSelf ? 'candidate-self' : ''}`;
      card.dataset.id = player.id;
      card.innerHTML = `
        <div class="candidate-avatar">👤</div>
        <div class="candidate-name">${escapeHtml(player.name)}${isSelf ? ' (You)' : ''}</div>
        <div class="candidate-status">${player.isButterfly ? '🦋 Silenced' : 'Living'}</div>
      `;

      if (!state.isButterfly && state.isAlive) {
        card.addEventListener('click', () => {
          if (card.classList.contains('selected')) {
            // Second click confirms vote!
            confirmVote(player.id, player.name);
          } else {
            // First click selects
            candidatesContainer.querySelectorAll('.candidate-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            state.selectedCandidateId = player.id;
            showToast(`Click ${player.name} again to confirm banishment vote.`);
          }
        });
      }

      candidatesContainer.appendChild(card);
    });

    // Option to skip / abstain vote
    const abstainCard = document.createElement('div');
    abstainCard.className = 'candidate-card candidate-abstain';
    abstainCard.dataset.id = 'abstain';
    abstainCard.innerHTML = `
      <div class="candidate-avatar">⚖️</div>
      <div class="candidate-name">Abstain</div>
      <div class="candidate-status">Cast no banishment</div>
    `;

    if (!state.isButterfly && state.isAlive) {
      abstainCard.addEventListener('click', () => {
        if (abstainCard.classList.contains('selected')) {
          confirmVote('abstain', 'Abstain');
        } else {
          candidatesContainer.querySelectorAll('.candidate-card').forEach(c => c.classList.remove('selected'));
          abstainCard.classList.add('selected');
          showToast('Click Abstain again to confirm.');
        }
      });
    }

    candidatesContainer.appendChild(abstainCard);
  }

  function confirmVote(targetId, targetName) {
    socket.emit('cast-vote', { targetId: targetId });
    if (window.AudioManager) {
      window.AudioManager.play('voteChime');
    }
    showToast(`Banishment vote cast for ${targetName}.`);

    const candidatesContainer = document.getElementById('voting-candidates');
    if (candidatesContainer) {
      candidatesContainer.querySelectorAll('.candidate-card').forEach(c => {
        c.classList.add('disabled');
        c.style.pointerEvents = 'none';
      });
    }
  }

  function startVoteTimer(timerEl, durationSec) {
    let remaining = durationSec;
    timerEl.textContent = `Time remaining: ${remaining}s`;

    const interval = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(interval);
        timerEl.textContent = 'Voting concluded.';
      } else {
        timerEl.textContent = `Time remaining: ${remaining}s`;
      }
    }, 1000);
  }

  // --- VOTE RESULT SCREEN ---
  function renderVoteResult(resultData) {
    const titleEl = document.getElementById('vote-result-title');
    const detailEl = document.getElementById('vote-result-detail');

    if (resultData.tie || !resultData.banished) {
      if (titleEl) titleEl.textContent = 'The Tribunal is Divided';
      if (detailEl) detailEl.textContent = 'No consensus was reached. No soul was banished this day.';
    } else {
      const banishedName = resultData.banished.name || resultData.banished;
      const banishedRole = resultData.role || resultData.banished.role || 'CITIZEN';

      if (titleEl) titleEl.textContent = 'The Sentence is Executed';
      if (detailEl) {
        detailEl.innerHTML = `
          <strong class="banished-name">${escapeHtml(banishedName)}</strong> has been banished into the void!<br>
          Their true role was: <span class="revealed-role">${escapeHtml(banishedRole)}</span>
        `;
      }

      if (window.AudioManager) {
        window.AudioManager.play('deathKnell');
      }

      // If self was banished
      if (resultData.banished.id === state.playerId || banishedName === state.playerName) {
        state.isAlive = false;
        updateChatTabVisibility();
      }
    }

    showScreen('screen-vote-result');
  }

  // --- GAME OVER SCREEN ---
  function renderGameOver(data) {
    const titleEl = document.getElementById('game-over-title');
    const rolesContainer = document.getElementById('game-over-roles');
    const timelineContainer = document.getElementById('game-over-timeline');
    const btnNewGame = document.getElementById('btn-new-game');

    const winner = data.winner || 'CITIZENS';
    const isCitizenWin = winner.toUpperCase() === 'CITIZENS' || winner.toUpperCase() === 'CITIZEN';

    if (titleEl) {
      titleEl.textContent = isCitizenWin
        ? 'The Citizens Prevail! The Dungeon is Purged.'
        : 'The Dungeon Falls! The Mafia Claims Dominion.';
      titleEl.className = isCitizenWin ? 'winner-citizens' : 'winner-mafia';
    }

    if (rolesContainer) {
      rolesContainer.innerHTML = '';
      const allPlayers = data.players || state.players;
      allPlayers.forEach(p => {
        const card = document.createElement('div');
        card.className = `role-card-mini role-${(p.role || 'CITIZEN').toLowerCase()}`;
        card.innerHTML = `
          <div class="mini-icon">${ROLE_ICONS[p.role] || '🛡️'}</div>
          <div class="mini-name">${escapeHtml(p.name)}</div>
          <div class="mini-role">${escapeHtml(p.role || 'Unknown')}</div>
          <div class="mini-status">${p.isAlive ? 'Survived' : 'Fallen'}</div>
        `;
        rolesContainer.appendChild(card);
      });
    }

    if (timelineContainer) {
      timelineContainer.innerHTML = '<h3>Chronicle of Events</h3>';
      const timeline = data.timeline || state.actionLedger;
      if (Array.isArray(timeline) && timeline.length > 0) {
        const ul = document.createElement('ul');
        ul.className = 'timeline-list';
        timeline.forEach(event => {
          const li = document.createElement('li');
          li.className = 'timeline-item';
          const text = typeof event === 'string' ? event : event.text || event.message;
          li.textContent = text;
          ul.appendChild(li);
        });
        timelineContainer.appendChild(ul);
      } else {
        timelineContainer.innerHTML += '<p class="empty-timeline">No history recorded.</p>';
      }
    }

    if (btnNewGame) {
      btnNewGame.addEventListener('click', () => {
        state.role = null;
        state.phase = null;
        state.isAlive = true;
        state.isButterfly = false;
        state.hasShield = false;
        state.votes = {};
        showScreen('screen-entry');
      });
    }

    showScreen('screen-game-over');
  }

  // --- MODERATOR DASHBOARD ---
  function initModeratorDashboard() {
    const btnAdvance = document.getElementById('btn-mod-advance');
    const btnCloseVotes = document.getElementById('btn-mod-close-votes');
    const btnPause = document.getElementById('btn-mod-pause');
    const btnKick = document.getElementById('btn-mod-kick');
    const kickSelect = document.getElementById('mod-kick-select');
    const btnBackLobby = document.getElementById('btn-mod-back-lobby');

    if (btnAdvance) {
      btnAdvance.addEventListener('click', () => {
        socket.emit('moderator-advance-phase');
      });
    }

    if (btnCloseVotes) {
      btnCloseVotes.addEventListener('click', () => {
        socket.emit('moderator-close-votes');
      });
    }

    if (btnPause) {
      btnPause.addEventListener('click', () => {
        socket.emit('moderator-pause');
      });
    }

    if (btnBackLobby) {
      btnBackLobby.addEventListener('click', () => {
        showScreen('screen-lobby');
      });
    }

    if (btnKick) {
      btnKick.addEventListener('click', () => {
        if (!kickSelect) return;
        const targetId = kickSelect.value;
        if (!targetId) {
          showToast('Select a player to kick.');
          return;
        }
        if (confirm('Are you sure you want to banish this player from the dungeon?')) {
          socket.emit('moderator-kick', { playerId: targetId });
        }
      });
    }

    // Task Assignment Form and Controls
    const taskForm = document.getElementById('mod-task-form');
    const playerSelect = document.getElementById('mod-task-player');
    const roleSelect = document.getElementById('mod-task-role');

    if (playerSelect && roleSelect) {
      playerSelect.addEventListener('change', () => {
        if (playerSelect.value) roleSelect.value = '';
      });
      roleSelect.addEventListener('change', () => {
        if (roleSelect.value) playerSelect.value = '';
      });
    }

    if (taskForm) {
      taskForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const targetId = playerSelect ? playerSelect.value : '';
        const role = roleSelect ? roleSelect.value : '';
        const titleInput = document.getElementById('mod-task-title');
        const descInput = document.getElementById('mod-task-description');
        const condSelect = document.getElementById('mod-task-condition');
        const limitInput = document.getElementById('mod-task-limit');
        const publicCheck = document.getElementById('mod-task-public');

        const title = titleInput ? titleInput.value.trim() : '';
        const description = descInput ? descInput.value.trim() : '';

        if (!targetId && !role) {
          showToast('Please select a specific player or an eligible role.');
          return;
        }
        if (!title) {
          showToast('Please enter a task title.');
          if (titleInput) titleInput.focus();
          return;
        }
        if (!description) {
          showToast('Please enter a task description.');
          if (descInput) descInput.focus();
          return;
        }

        const payload = {
          title,
          description,
          objective: description,
          completionCondition: condSelect ? condSelect.value : 'moderator_verify',
          isPublic: publicCheck ? publicCheck.checked : false
        };

        if (targetId) payload.targetId = targetId;
        if (role) payload.role = role;

        if (limitInput && limitInput.value) {
          const sec = parseInt(limitInput.value, 10);
          if (Number.isFinite(sec) && sec > 0) {
            payload.timeLimitSeconds = sec;
          }
        }

        emitAck('assign-task', payload, () => {
          showToast(`Charge inscribed: "${title}"`);
          if (titleInput) titleInput.value = '';
          if (descInput) descInput.value = '';
          if (playerSelect) playerSelect.value = '';
          if (roleSelect) roleSelect.value = '';
          if (limitInput) limitInput.value = '';
          if (publicCheck) publicCheck.checked = false;
        });
      });
    }

    // Task List Action Delegation (Verify, Mark Failed, Cancel)
    const modTaskList = document.getElementById('mod-task-list');
    if (modTaskList) {
      modTaskList.addEventListener('click', (e) => {
        const completeBtn = e.target.closest('.btn-task-verify-complete');
        const failBtn = e.target.closest('.btn-task-verify-fail');
        const cancelBtn = e.target.closest('.btn-task-cancel');

        if (completeBtn) {
          const taskId = completeBtn.dataset.taskId;
          emitAck('verify-task', { taskId, outcome: 'completed' }, () => {
            showToast('Charge verified as completed.');
          });
        } else if (failBtn) {
          const taskId = failBtn.dataset.taskId;
          emitAck('verify-task', { taskId, outcome: 'failed' }, () => {
            showToast('Charge marked as failed.');
          });
        } else if (cancelBtn) {
          const taskId = cancelBtn.dataset.taskId;
          emitAck('cancel-task', { taskId }, () => {
            showToast('Charge cancelled.');
          });
        }
      });
    }
  }

  function updateModeratorDashboard(data) {
    if (!state.isModerator || !data) return;

    const modRoomCode = document.getElementById('mod-room-code');
    const modPhaseBadge = document.getElementById('mod-phase-badge');
    const playersContainer = document.getElementById('mod-players');
    const actionLogContainer = document.getElementById('mod-action-log');
    const kickSelect = document.getElementById('mod-kick-select');
    const taskPlayerSelect = document.getElementById('mod-task-player');
    const modTaskList = document.getElementById('mod-task-list');
    const btnCloseVotes = document.getElementById('btn-mod-close-votes');

    // Update Room Code & Phase Badge in Tome Header
    if (modRoomCode) {
      modRoomCode.textContent = data.roomCode || state.roomCode || '';
    }
    if (modPhaseBadge) {
      const curPhase = data.phase || state.phase || 'LOBBY';
      const curRound = data.round || state.round || 1;
      modPhaseBadge.textContent = `${curPhase.replace(/_/g, ' ')} — Round ${curRound}`;
    }

    // Show/hide close votes button based on phase
    if (btnCloseVotes) {
      btnCloseVotes.style.display = (data.phase || state.phase) === 'VOTING' ? 'inline-block' : 'none';
    }

    // Update players list / table
    if (playersContainer && data.players) {
      playersContainer.innerHTML = `
        <table class="mod-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Role</th>
              <th>Status</th>
              <th>Butterfly</th>
              <th>Shield</th>
            </tr>
          </thead>
          <tbody>
            ${data.players.map(p => `
              <tr>
                <td>${escapeHtml(p.name)}</td>
                <td><span class="role-badge role-${(p.role || '').toLowerCase()}">${escapeHtml(p.role || 'None')}</span></td>
                <td>${p.isAlive !== false && p.alive !== false ? '🟢 Alive' : '💀 Dead'}</td>
                <td>${p.isButterfly ? '🦋 Silenced' : '—'}</td>
                <td>${p.hasShield ? '🛡️ Shielded' : '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }

    // Update kick dropdown
    if (kickSelect && data.players) {
      const currentSelected = kickSelect.value;
      kickSelect.innerHTML = '<option value="">-- Select Soul to Kick --</option>';
      data.players.forEach(p => {
        if (!p.isModerator && p.id !== state.playerId) {
          const opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = `${p.name} (${p.role || 'Unknown'})`;
          if (p.id === currentSelected) opt.selected = true;
          kickSelect.appendChild(opt);
        }
      });
    }

    // Update task assignment Soul dropdown
    if (taskPlayerSelect && data.players) {
      const currentSelected = taskPlayerSelect.value;
      taskPlayerSelect.innerHTML = '<option value="">— Specific player —</option>';
      data.players.forEach(p => {
        if (!p.isModerator) {
          const opt = document.createElement('option');
          opt.value = p.id;
          const roleText = p.role ? ` (${p.role})` : '';
          opt.textContent = `${p.name}${roleText}`;
          if (p.id === currentSelected) opt.selected = true;
          taskPlayerSelect.appendChild(opt);
        }
      });
    }

    // Update Action Log
    if (actionLogContainer && data.actionLog) {
      actionLogContainer.innerHTML = '';
      data.actionLog.forEach(logItem => {
        const item = document.createElement('div');
        item.className = 'action-log-item';
        item.textContent = typeof logItem === 'string' ? logItem : `[${logItem.time || (logItem.timestamp ? new Date(logItem.timestamp).toLocaleTimeString() : '')}] ${logItem.text}`;
        actionLogContainer.appendChild(item);
      });
      actionLogContainer.scrollTop = actionLogContainer.scrollHeight;
    }

    // Update Assigned Charges List
    if (modTaskList) {
      const tasks = data.tasks || state.tasks || [];
      if (!tasks.length) {
        modTaskList.innerHTML = '<p class="status-hint" style="color:var(--parchment-dim); font-style:italic; padding:0.5rem 0;">No charges inscribed yet.</p>';
      } else {
        modTaskList.innerHTML = tasks.map(t => {
          const assigneesText = (t.assignees && t.assignees.length)
            ? t.assignees.map(a => `${escapeHtml(a.name)}${a.role ? ` (${escapeHtml(a.role)})` : ''}`).join(', ')
            : (t.assigneeRole ? `Role: ${escapeHtml(t.assigneeRole)}` : 'All Souls');
          const isOpen = t.status === 'pending' || t.status === 'in_progress';
          const conditionLabel = {
            moderator_verify: 'Moderator verifies',
            night_action: 'Complete night action',
            trial_success: 'Succeed at trial',
            survive_night: 'Survive the night',
            cast_vote: 'Cast tribunal vote'
          }[t.completionCondition] || t.completionCondition;

          let actionsHtml = '';
          if (isOpen) {
            actionsHtml = `
              <div class="task-actions">
                ${t.completionCondition === 'moderator_verify' ? `
                  <button type="button" class="btn btn-sm btn-primary btn-task-verify-complete" data-task-id="${escapeHtml(t.id)}">Verify Complete</button>
                  <button type="button" class="btn btn-sm btn-danger btn-task-verify-fail" data-task-id="${escapeHtml(t.id)}">Mark Failed</button>
                ` : ''}
                <button type="button" class="btn btn-sm btn-secondary btn-task-cancel" data-task-id="${escapeHtml(t.id)}">Cancel</button>
              </div>
            `;
          }

          return `
            <div class="task-card task-${escapeHtml(t.status)}">
              <div class="task-card-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.25rem;">
                <span class="task-status">${escapeHtml(t.status)}</span>
                ${t.isPublic ? '<span class="badge" style="font-size:0.7rem; background:rgba(212,175,55,0.2); color:var(--gold);">Public</span>' : ''}
              </div>
              <strong>${escapeHtml(t.title)}</strong>
              <p style="margin:0.25rem 0;">${escapeHtml(t.description)}</p>
              <div style="font-size:0.8rem; color:var(--parchment-dim); margin-top:0.35rem; line-height:1.4;">
                <div><strong>Assigned:</strong> ${assigneesText}</div>
                <div><strong>Condition:</strong> ${escapeHtml(conditionLabel)}</div>
                ${t.resultNote ? `<div><strong>Result:</strong> ${escapeHtml(t.resultNote)}</div>` : ''}
              </div>
              ${actionsHtml}
            </div>
          `;
        }).join('');
      }
    }
  }

  // =========================================================================
  // 5. CHAT SYSTEM
  // =========================================================================
  function initChatSystem() {
    const chatPanel = document.getElementById('chat-panel');
    const chatToggle = document.getElementById('chat-toggle');
    const chatBody = document.getElementById('chat-body');
    const chatInput = document.getElementById('chat-input');
    const btnSend = document.getElementById('btn-chat-send');
    const tabs = document.querySelectorAll('.chat-tab');

    if (chatToggle) {
      chatToggle.addEventListener('click', () => {
        state.chatOpen = !state.chatOpen;
        if (chatBody) {
          chatBody.style.display = state.chatOpen ? 'flex' : 'none';
        }
        chatToggle.classList.toggle('chat-open', state.chatOpen);
        if (state.chatOpen && chatInput) {
          chatInput.focus();
        }
      });
    }

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        state.currentChatChannel = tab.dataset.channel || 'day';
        renderChatMessages();
      });
    });

    let rateLimited = false;

    function sendMessage() {
      if (!chatInput) return;
      const text = chatInput.value.trim();
      if (!text || rateLimited) return;

      socket.emit('chat-message', {
        channel: state.currentChatChannel,
        message: text
      });

      chatInput.value = '';

      // 1-second rate limit
      rateLimited = true;
      if (btnSend) btnSend.disabled = true;
      setTimeout(() => {
        rateLimited = false;
        if (btnSend) btnSend.disabled = false;
      }, 1000);
    }

    if (btnSend) {
      btnSend.addEventListener('click', sendMessage);
    }

    if (chatInput) {
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          sendMessage();
        }
      });
    }
  }

  function updateChatTabVisibility() {
    const ghostTab = document.querySelector('.chat-tab[data-channel="ghost"]');
    const mafiaTab = document.querySelector('.chat-tab[data-channel="mafia"]');

    if (ghostTab) {
      ghostTab.style.display = (!state.isAlive || state.isModerator) ? 'inline-block' : 'none';
    }

    if (mafiaTab) {
      mafiaTab.style.display = (state.role === 'MAFIA' || state.isModerator) ? 'inline-block' : 'none';
    }
  }

  function appendChatMessage(msg) {
    const channel = msg.channel || 'day';
    if (!state.chatMessages[channel]) {
      state.chatMessages[channel] = [];
    }
    state.chatMessages[channel].push(msg);

    if (channel === state.currentChatChannel) {
      renderChatMessages();
    } else if (!state.chatOpen) {
      const toggle = document.getElementById('chat-toggle');
      if (toggle) {
        toggle.classList.add('has-unread');
      }
    }
  }

  function renderChatMessages() {
    const messagesContainer = document.getElementById('chat-messages');
    if (!messagesContainer) return;

    messagesContainer.innerHTML = '';
    const messages = state.chatMessages[state.currentChatChannel] || [];

    messages.forEach(msg => {
      const item = document.createElement('div');
      const isSelf = msg.senderId === state.playerId || msg.sender === state.playerName;
      item.className = `chat-message ${isSelf ? 'msg-self' : ''} channel-${msg.channel}`;
      item.innerHTML = `
        <span class="msg-sender">${escapeHtml(msg.sender || 'Unknown')}:</span>
        <span class="msg-text">${escapeHtml(msg.text || msg.message || '')}</span>
      `;
      messagesContainer.appendChild(item);
    });

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // =========================================================================
  // 6. SOUND TOGGLE
  // =========================================================================
  function initSoundToggle() {
    const toggleBtn = document.getElementById('sound-toggle');
    if (!toggleBtn) return;

    if (window.AudioManager) {
      toggleBtn.textContent = window.AudioManager.isEnabled() ? '🔊' : '🔇';
    }

    toggleBtn.addEventListener('click', () => {
      if (window.AudioManager) {
        const enabled = window.AudioManager.toggleSound();
        toggleBtn.textContent = enabled ? '🔊' : '🔇';
        state.soundEnabled = enabled;
      }
    });
  }

  // =========================================================================
  // 7. SOCKET EVENT LISTENERS
  // =========================================================================
  function registerSocketEvents() {
    socket.on('connect', () => {
      console.log('[DUNGEON] Connected to gateway socket.');
      if (state.sessionToken) {
        socket.emit('reconnect', { sessionToken: state.sessionToken });
      }
    });

    socket.on('disconnect', () => {
      console.warn('[DUNGEON] Disconnected from server.');
      showToast('Connection lost. Reconnecting to dungeon...', 4000);
    });

    socket.on('error', (err) => {
      const msg = typeof err === 'string' ? err : err.message || 'An arcane error occurred.';
      showToast(msg, 3500);
    });

    // Room creation
    socket.on('room-created', (data) => {
      state.roomCode = data.roomCode;
      state.sessionToken = data.sessionToken;
      state.isModerator = true;
      state.playerId = data.playerId;
      if (data.sessionToken) {
        sessionStorage.setItem('dungeon-session', data.sessionToken);
        if (data.roomCode) sessionStorage.setItem('dungeon-room', data.roomCode);
        if (socket) socket.auth = { sessionToken: data.sessionToken };
      }
      state.players = data.players || [{ name: state.playerName, id: data.playerId, isModerator: true }];
      updateLobbyUI();
      showScreen('screen-lobby');
      showToast(`Dungeon room created: ${data.roomCode}`);
    });

    // Room joined by current player
    socket.on('room-joined', (data) => {
      if (!data) return;
      if (data.roomCode) {
        state.roomCode = data.roomCode;
        sessionStorage.setItem('dungeon-room', data.roomCode);
        try {
          window.history.replaceState(null, '', `?code=${data.roomCode}`);
        } catch (e) {}
      }
      if (data.sessionToken) {
        state.sessionToken = data.sessionToken;
        sessionStorage.setItem('dungeon-session', data.sessionToken);
        if (socket) socket.auth = { sessionToken: data.sessionToken };
      }
      if (data.playerId && !state.playerId) {
        state.playerId = data.playerId;
      }
      if (data.state) {
        applyServerState(data.state);
      }
      showScreen('screen-lobby');
    });

    // Room joined
    socket.on('player-joined', (data) => {
      if (data.players) {
        state.players = data.players;
      } else if (data.player) {
        const existing = state.players.find(p => p.id === data.player.id);
        if (!existing) state.players.push(data.player);
      }
      if (data.roomCode) {
        state.roomCode = data.roomCode;
        sessionStorage.setItem('dungeon-room', data.roomCode);
        try {
          window.history.replaceState(null, '', `?code=${data.roomCode}`);
        } catch (e) {}
      }
      if (data.playerId && !state.playerId) state.playerId = data.playerId;
      if (data.sessionToken) {
        state.sessionToken = data.sessionToken;
        sessionStorage.setItem('dungeon-session', data.sessionToken);
        if (socket) socket.auth = { sessionToken: data.sessionToken };
      }

      updateLobbyUI();
      if (document.getElementById('screen-entry').classList.contains('active') ||
          document.getElementById('screen-create').classList.contains('active')) {
        showScreen('screen-lobby');
      }
    });

    // Authoritative game state broadcast
    socket.on('game-state', (data) => {
      if (data) {
        applyServerState(data, data);
      }
    });

    // Reconnection response
    socket.on('reconnected', (data) => {
      if (data) {
        if (data.roomCode) {
          state.roomCode = data.roomCode;
          sessionStorage.setItem('dungeon-room', data.roomCode);
          try {
            window.history.replaceState(null, '', `?code=${data.roomCode}`);
          } catch (e) {}
        }
        if (data.sessionToken) {
          state.sessionToken = data.sessionToken;
          sessionStorage.setItem('dungeon-session', data.sessionToken);
          if (socket) socket.auth = { sessionToken: data.sessionToken };
        }
        if (data.state) {
          applyServerState(data.state);
        }
      }
    });

    // Real-time task assigned to this player
    socket.on('task-assigned', (task) => {
      if (!task) return;
      showToast(`A new charge has been inscribed: "${task.title}"`, 4000);
      if (!state.tasks) state.tasks = [];
      const existingIdx = state.tasks.findIndex(t => t.id === task.id);
      if (existingIdx !== -1) {
        state.tasks[existingIdx] = task;
      } else {
        state.tasks.push(task);
      }
      renderPlayerTasks(state.tasks);
    });

    // Game ritual started
    socket.on('game-started', () => {
      state.phase = 'rules-display';
      showScreen('screen-rules');
      updateRulesCarousel();
      showToast('The ritual begins. Sacred laws are displayed!');
    });

    // Role reveal payload
    socket.on('role-reveal', (data) => {
      state.role = data.role;
      state.isAlive = true;
      state.isButterfly = false;
      renderRoleDetails(data);
    });

    // Phase transition
    socket.on('phase-change', (data) => {
      const newPhase = data.phase || data;
      state.phase = newPhase;
      if (data.round) state.round = data.round;

      // Reset round-specific flags
      state.isButterfly = false;

      switch (newPhase) {
        case 'night':
          showScreen('screen-night');
          if (data.prompt) {
            renderNightPanel(data.prompt);
          }
          break;
        case 'dawn':
          showScreen('screen-dawn');
          break;
        case 'voting':
          showScreen('screen-voting');
          break;
        case 'vote-result':
          showScreen('screen-vote-result');
          break;
        case 'game-over':
          showScreen('screen-game-over');
          break;
        default:
          break;
      }
    });

    // Night action prompt
    socket.on('night-prompt', (promptData) => {
      renderNightPanel(promptData);
    });

    // Minigame trial started
    socket.on('trial-start', (trialData) => {
      executeTrial(trialData, (result) => {
        socket.emit('trial-result', result);
      });
    });

    // Dawn news
    socket.on('dawn-announcement', (announcement) => {
      renderDawnPhase(announcement);
    });

    // Voting opens
    socket.on('vote-opened', (voteData) => {
      showScreen('screen-voting');
      renderVotingScreen(voteData);
    });

    // Vote result announcement
    socket.on('vote-result', (result) => {
      renderVoteResult(result);
    });

    // Detective clue delivery
    socket.on('detective-clue', (data) => {
      showToast(`Clue unsealed: ${data.clue || data.text}`, 5000);
      const panel = document.getElementById('night-action-panel');
      if (panel) {
        const box = panel.querySelector('.clue-display-box');
        if (box) {
          box.innerHTML = `<strong>New Clue:</strong><p class="clue-text">${escapeHtml(data.clue || data.text)}</p>`;
        }
      }
    });

    // Butterfly silencing effect
    socket.on('butterfly-applied', (data) => {
      if (data.targetId === state.playerId || data.isSelf) {
        state.isButterfly = true;
        showToast('You have been butterflied! Your voice is silenced for this Tribunal.', 4500);
        const notice = document.getElementById('butterfly-notice');
        if (notice) notice.style.display = 'block';
      }
    });

    // Mafia recruitment invitation
    socket.on('recruit-request', (data) => {
      showModal({
        title: 'Dark Conclave Invitation',
        message: 'The Mafia has fallen and seeks new blood. Will you take the blood oath and join the shadows?',
        buttons: [
          {
            text: 'Accept Blood Oath (Join Mafia)',
            primary: true,
            onClick: () => {
              socket.emit('recruit-response', { accept: true });
              state.role = 'MAFIA';
              showToast('You have joined the Mafia cabal!');
              updateChatTabVisibility();
            }
          },
          {
            text: 'Refuse (Stay Loyal)',
            primary: false,
            onClick: () => {
              socket.emit('recruit-response', { accept: false });
              showToast('You refused the blood oath.');
            }
          }
        ]
      });
    });

    // Surviving Mafia death choice (recruit vs continue)
    socket.on('mafia-death-choice', () => {
      showModal({
        title: 'A Brother Has Fallen',
        message: 'A member of your cabal was slain. Will you attempt to recruit a new soul or continue the slaughter alone?',
        buttons: [
          {
            text: 'Recruit a Citizen',
            primary: true,
            onClick: () => {
              socket.emit('mafia-death-choice-response', { choice: 'recruit' });
            }
          },
          {
            text: 'Continue Alone',
            primary: false,
            onClick: () => {
              socket.emit('mafia-death-choice-response', { choice: 'continue' });
            }
          }
        ]
      });
    });

    // Moderator live telemetry
    socket.on('moderator-update', (data) => {
      updateModeratorDashboard(data);
    });

    // Game over conclusion
    socket.on('game-over', (data) => {
      renderGameOver(data);
    });

    // Chat broadcast
    socket.on('chat', (msg) => {
      appendChatMessage(msg);
    });

    // Full state synchronization on reconnect
    socket.on('state-sync', (syncedState) => {
      Object.assign(state, syncedState);
      updateLobbyUI();
      updateChatTabVisibility();

      if (syncedState.phase) {
        showScreen(`screen-${syncedState.phase}`);
      }
      showToast('State restored from dungeon gateway.');
    });
  }

  // =========================================================================
  // 8. ESCAPE HTML HELPER
  // =========================================================================
  function escapeHtml(str) {
    if (typeof str !== 'string') return String(str || '');
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // =========================================================================
  // 9. INITIALIZATION
  // =========================================================================
  document.addEventListener('DOMContentLoaded', () => {
    initEntryScreen();
    initCreateScreen();
    initLobbyScreen();
    initRoleRevealScreen();
    initRulesScreen();
    initModeratorDashboard();
    initChatSystem();
    initSoundToggle();
    registerSocketEvents();

    // Default to entry screen
    showScreen('screen-entry');
  });

})();
