/**
 * DUNGEON - Main Client Application Controller
 * Manages Socket.IO connection, state, screen transitions, minigames, chat, and UI events.
 */

(function () {
  'use strict';

  // =========================================================================
  // 1. GAME STATE
  // =========================================================================
  const state = {
    sessionToken: localStorage.getItem('dungeon-session') || null,
    roomCode: null,
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
    actionLedger: []
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
        auth: { sessionToken: state.sessionToken },
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

        socket.emit('join-room', {
          roomCode: code,
          playerName: name
        });
      });
    }

    // Auto-fill room code from URL parameters (?code=XXXX)
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const codeFromUrl = urlParams.get('code');
      if (codeFromUrl && inputCode) {
        inputCode.value = codeFromUrl.toUpperCase().slice(0, 4);
        if (inputNameJoin) inputNameJoin.focus();
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
        const name = inputNameCreate ? inputNameCreate.value.trim() : '';
        if (!name) {
          showToast('Please enter your name.');
          if (inputNameCreate) inputNameCreate.focus();
          return;
        }

        state.playerName = name;
        state.isModerator = true;

        socket.emit('create-room', {
          playerName: name
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

    const canStart = state.isModerator && state.players.length >= 5;
    if (btnStart) {
      if (state.isModerator) {
        btnStart.style.display = 'inline-block';
        btnStart.disabled = state.players.length < 5;
      } else {
        btnStart.style.display = 'none';
      }
    }

    if (statusText) {
      if (state.players.length < 5) {
        statusText.textContent = `Need at least 5 souls to begin the ritual (${state.players.length}/5).`;
      } else if (state.isModerator) {
        statusText.textContent = 'Ritual circle is complete. You may begin the ritual!';
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
        if (state.players.length < 5) {
          showToast('At least 5 players are required.');
          return;
        }
        socket.emit('start-game');
      });
    }

    if (inviteLink) {
      inviteLink.addEventListener('click', (e) => {
        e.preventDefault();
        const url = `${window.location.origin}${window.location.pathname}?code=${state.roomCode || ''}`;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(() => {
            showToast('Invite link copied to clipboard!');
          }).catch(() => {
            prompt('Copy this invite link:', url);
          });
        } else {
          prompt('Copy this invite link:', url);
        }
      });
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

      // Double-click to break the seal (as explicitly requested)
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
        const teammates = Array.isArray(roleData.teammates) ? roleData.teammates : [];
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
        const clueText = promptData.clue || 'A scent of brimstone lingers near the western crypts.';
        panel.innerHTML = `
          <h3>Detective\'s Investigation</h3>
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
            socket.emit('night-action', { action: 'skip' });
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
            const defaultTrial = promptData.trial || {
              type: 'rune-memory',
              sequence: ['ᚠ', 'ᚢ', 'ᚦ', 'ᚨ'],
              showTime: 3000,
              timeLimit: 14000
            };
            executeTrial(defaultTrial, (trialResult) => {
              socket.emit('trial-result', trialResult);
              socket.emit('night-action', {
                action: 'forge-shield',
                success: trialResult.success
              });
              if (trialResult.success) {
                state.hasShield = true;
                showToast('Mystic shield forged successfully!');
              } else {
                showToast('The shield shattered during forging.');
              }
            });
          });
        }

        if (btnRest) {
          btnRest.addEventListener('click', () => {
            panel.style.display = 'none';
            if (waitingMsg) waitingMsg.style.display = 'block';
            socket.emit('night-action', { action: 'rest' });
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

        // If trial required (Mafia kill or Doctor save)
        if (actionType === 'kill' || actionType === 'save') {
          const trial = trialConfig || {
            type: actionType === 'kill' ? 'lockpick-rhythm' : 'rune-memory',
            pattern: [500, 350, 650, 400],
            sequence: ['ᚠ', 'ᚢ', 'ᛃ', 'ᚱ'],
            tolerance: 180,
            showTime: 3000,
            timeLimit: 15000
          };

          executeTrial(trial, (trialResult) => {
            socket.emit('trial-result', trialResult);
            socket.emit('night-action', {
              action: actionType,
              targetId: selectedId,
              success: trialResult.success
            });
          });
        } else {
          // Detective share clue
          socket.emit('night-action', {
            action: actionType,
            targetId: selectedId
          });
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
  }

  function updateModeratorDashboard(data) {
    if (!state.isModerator) return;

    const playersContainer = document.getElementById('mod-players');
    const actionLogContainer = document.getElementById('mod-action-log');
    const kickSelect = document.getElementById('mod-kick-select');
    const btnCloseVotes = document.getElementById('btn-mod-close-votes');

    // Show/hide close votes button based on phase
    if (btnCloseVotes) {
      btnCloseVotes.style.display = state.phase === 'voting' ? 'inline-block' : 'none';
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
                <td>${p.isAlive !== false ? '🟢 Alive' : '💀 Dead'}</td>
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
        if (p.id !== state.playerId) {
          const opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = `${p.name} (${p.role || 'Unknown'})`;
          if (p.id === currentSelected) opt.selected = true;
          kickSelect.appendChild(opt);
        }
      });
    }

    // Update Action Log
    if (actionLogContainer && data.actionLog) {
      actionLogContainer.innerHTML = '';
      data.actionLog.forEach(logItem => {
        const item = document.createElement('div');
        item.className = 'action-log-item';
        item.textContent = typeof logItem === 'string' ? logItem : `[${logItem.time || ''}] ${logItem.text}`;
        actionLogContainer.appendChild(item);
      });
      actionLogContainer.scrollTop = actionLogContainer.scrollHeight;
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
        localStorage.setItem('dungeon-session', data.sessionToken);
      }
      state.players = data.players || [{ name: state.playerName, id: data.playerId, isModerator: true }];
      updateLobbyUI();
      showScreen('screen-lobby');
      showToast(`Dungeon room created: ${data.roomCode}`);
    });

    // Room joined
    socket.on('player-joined', (data) => {
      if (data.players) {
        state.players = data.players;
      } else if (data.player) {
        const existing = state.players.find(p => p.id === data.player.id);
        if (!existing) state.players.push(data.player);
      }
      if (data.roomCode) state.roomCode = data.roomCode;
      if (data.playerId && !state.playerId) state.playerId = data.playerId;
      if (data.sessionToken) {
        state.sessionToken = data.sessionToken;
        localStorage.setItem('dungeon-session', data.sessionToken);
      }

      updateLobbyUI();
      if (document.getElementById('screen-entry').classList.contains('active') ||
          document.getElementById('screen-create').classList.contains('active')) {
        showScreen('screen-lobby');
      }
    });

    // Game ritual started
    socket.on('game-started', () => {
      state.phase = 'role-reveal';
      showScreen('screen-role-reveal');
      showToast('The ritual begins. Sealed envelopes are distributed!');
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
