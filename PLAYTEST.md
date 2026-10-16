# DUNGEON — Master Playtest & QA Checklist 📜🗡️

This document outlines the rigorous end-to-end verification procedures for the **DUNGEON** multiplayer social deduction game. Use this checklist during manual QA, staging deployments, or live playtests.

---

## 📋 Pre-Test Environment Preparation

- [ ] Node.js (v16+) and npm installed.
- [ ] Dependencies installed via `npm install`.
- [ ] Server running via `npm start` on `http://localhost:3000` (or local IP for LAN multi-device testing).
- [ ] Clean browser profiles / incognito windows ready for multi-client emulation.
- [ ] Audio enabled on at least one device to verify Web Audio synthesis.

---

## ⚔️ 6-Player Game Playtest Checklist

### Scenario Overview
- **Session Composition**: 1 Moderator (Host) + 5 Mortal Players (6 browser tabs / devices total).
- **Expected Role Distribution**:
  - `1 Moderator` (Non-player host)
  - `1 Doctor`
  - `1 Detective`
  - `1 Mafia`
  - `2 Citizens`

---

### Phase 1: Lobby & Gathering
- [ ] **1. Room Creation**: Moderator navigates to `http://localhost:3000`, enters a name, and clicks **"Create a Dungeon"**.
- [ ] **2. Room Code Generation**: A unique 4-character alphanumeric Room Code (e.g., `A7K2`) is generated and prominently displayed.
- [ ] **3. Portal Graphics**: Canvas-based runic portal animation renders and pulses smoothly behind the code.
- [ ] **4. Invite Link**: Clicking the invite link copies `http://<host>/?code=<code>` to clipboard.
- [ ] **5. Player Joining**: 5 players join using the 4-letter room code and unique player names.
- [ ] **6. Live Roster Updates**: Moderator and all player screens dynamically update as each player connects.
- [ ] **7. Minimum Player Threshold**:
  - With < 5 players, the Moderator sees a disabled or hidden button and status *"Gathering souls (X/5 required)..."*.
  - Upon 5th player joining, the **"Begin the Ritual"** button becomes active for the Moderator.
- [ ] **8. Non-Mod View**: Players in the lobby do NOT see the "Begin the Ritual" button (only status text).

---

### Phase 2: Role Reveal & Laws of the Dungeon
- [ ] **9. Ritual Start**: Moderator clicks **"Begin the Ritual"**.
- [ ] **10. Envelope Animation**: All 5 players transition to the Role Reveal screen displaying an ornate sealed parchment envelope.
- [ ] **11. Wax Seal Break**: Clicking or tapping the envelope plays an audio seal crack and reveals the inner role card with gothic badge, role title, and ability summary.
- [ ] **12. Role Count Verification**: Verify across all 5 players that exactly:
  - 1 player received `Doctor`
  - 1 player received `Detective`
  - 1 player received `Mafia`
  - 2 players received `Citizen`
  - Moderator remains in the Tome view and has no player role card.
- [ ] **13. Acknowledge & Rules Carousel**: Players click **"I Accept My Fate"** to view the **12 Laws of the Dungeon** carousel.
- [ ] **14. Rules Navigation**: Carousel allows stepping through all 12 rules (Rule 1 through Rule 12) with forward/back navigation buttons.
- [ ] **15. Ready Transition**: When ready, players transition into the Night phase.

---

### Phase 3: Night 1 — Secret Actions & Trials
- [ ] **16. Night Ambiance**: Dark vignetted screen with torch flicker and *"Night Falls — Round 1"*.
- [ ] **17. Moderator Real-Time Tome**:
  - Moderator dashboard lists all players, their true roles, living status, and an empty action ledger.
  - As actions occur, the action ledger updates in real time without refreshing.
- [ ] **18. Mafia Action & Trial**:
  - Mafia player sees the list of all other living players (cannot target themselves).
  - Mafia selects a Citizen as target.
  - Mafia is presented with a required mini-game trial (e.g. Word Scramble, Rune Memory, or Lockpick Rhythm) with a countdown timer.
  - Mafia submits correct trial solution → Action successfully logged.
- [ ] **19. Doctor Action & Trial**:
  - Doctor sees selection of all living players (including self).
  - Doctor selects a target (e.g. the other Citizen).
  - Doctor completes trial successfully → Target is marked protected for the night.
- [ ] **20. Detective Action**:
  - Detective receives their night investigation clue about a living soul.
  - Detective can choose whether to keep clue private or share with another player.
- [ ] **21. Citizen Optional Shield Trial**:
  - Citizens are offered an optional trial to forge a mystical Shield.
  - Citizen 1 completes trial successfully → receives hidden Shield.
  - Citizen 2 skips or fails trial → no shield.
  - Verify Shield existence is NOT displayed in public status or to other players (Moderator ledger only).
- [ ] **22. Phase Advancement**: When all actions are submitted (or Moderator clicks **"Advance Phase"**), Night resolves.

---

### Phase 4: Dawn & Night Resolution
- [ ] **23. Resolution Hierarchy**: Server resolves in order: Doctor Save → Shield Check → Mafia Kill.
- [ ] **24. Dawn Message**:
  - If Doctor saved the victim: Dawn announces the victim was spared / no bodies discovered.
  - If Citizen had a Shield: Citizen survives silently; Shield is consumed; no death announced.
  - If unprotected: Dawn announces the death of the targeted player, their name, and tolling bell chime.
- [ ] **25. Role Concealment**: Night deaths announce the victim's name (and transition victim to Ghost Chat).

---

### Phase 5: The Tribunal (Day Voting)
- [ ] **26. Voting Roster**: All living players appear as candidate cards.
- [ ] **27. Silenced State (Butterfly Effect)**:
  - If Detective shared a clue with Player X, Player X has the 🦋 Butterfly icon, voting buttons are disabled, and a notice reads *"You are silenced this round"*.
- [ ] **28. Dead Player Voting**: Dead players cannot cast votes and see the voting in spectator mode.
- [ ] **29. Casting Votes**: Living eligible players select a candidate and confirm vote.
- [ ] **30. Majority Elimination**:
  - Candidate with the most votes is eliminated.
  - Eliminated player's true role is dramatically revealed to all.
- [ ] **31. Tie Vote Resolution**:
  - If votes result in an exact tie, announcement states the Tribunal was deadlocked and no one is banished.

---

### Phase 6: Night 2 & Advanced Rule Verifications
- [ ] **32. Doctor Self-Save Public Revelation (Rule 2)**:
  - Doctor targets themselves and passes trial.
  - At Dawn, public announcement specifically proclaims: *"A divine miracle occurred — the Doctor tended to their own mortal wounds in the dark!"*
- [ ] **33. Detective Clue Sharing & Butterfly Silencing (Rule 4)**:
  - Detective chooses to share a clue with Citizen A.
  - Citizen A receives the clue modal.
  - At the following Tribunal, Citizen A is strictly forbidden from voting.
- [ ] **34. Mafia Trial Failure & Suicide Retribution (Rule 6)**:
  - Mafia deliberately submits an incorrect trial answer or lets timer expire.
  - The attack fails! Retribution strikes: a random Mafia member dies by their own blade.
  - Dawn announces the Mafia member's demise.
- [ ] **35. Citizen Shield Defense (Rules 9 & 10)**:
  - Citizen with active Shield is attacked by Mafia (unprotected by Doctor).
  - Citizen survives! Shield is consumed.
  - No public mention of the Shield is ever made.

---

### Phase 7: Chat System & Social Features
- [ ] **36. Day Chat**:
  - All living players and Moderator can exchange messages during Day/Voting phases.
  - HTML tags and scripts (`<script>`, `<b>`, `<img>`) are strictly sanitized/escaped.
- [ ] **37. Mafia Night Chat**:
  - Mafia tab appears only for Mafia members during Night.
  - Non-mafia players cannot see or access the Mafia channel.
  - Messages sent in Mafia chat are private to fellow cultists.
- [ ] **38. Ghost Chat**:
  - Eliminated players gain access to Ghost Chat.
  - Ghost chat messages are invisible to living players; ghosts can read public chat.

---

### Phase 8: Game Over & Endgame Screen
- [ ] **39. Citizen Win Condition**:
  - When the final Mafia member dies (by vote, suicide rule, or trial penalty) → *"Citizens Prevail! The Darkness Has Been Cleansed"*.
- [ ] **40. Mafia Win Condition**:
  - When Mafia count >= living Citizen count → *"The Shadows Claim the Dungeon! Mafia Victory"*.
- [ ] **41. Roles & Ledger Reveal**:
  - All players' true identities are unmasked on the endgame board.
  - Chronological timeline of night actions, trials, dawn events, and tribunal votes is shown.
- [ ] **42. Return / New Game**: Clicking **"New Game"** resets state smoothly to the gathering lobby.

---

### Phase 9: Client Resilience & Responsiveness
- [ ] **43. Page Refresh & Reconnection**: Player refreshes their browser tab mid-game → state restores seamlessly via cached session ID and socket handshake.
- [ ] **44. Sound Toggle**: Clicking the 🔊 / 🔇 toggle properly mutes/unmutes audio synth without crashes.
- [ ] **45. Responsive Layout**: Test on mobile screen emulation (375px width) — touch controls, voting cards, chat drawer, and trials scale properly without horizontal overflow.

---

## 🏰 12-Player Game Playtest Checklist

### Scenario Overview
- **Session Composition**: 1 Moderator + 12 Mortal Players (13 total connections).
- **Expected Role Distribution**:
  - `1 Moderator` (Host)
  - `1 Doctor`
  - `1 Detective`
  - `2 Mafia` (Floor(12 / 6) = 2)
  - `8 Citizens` (12 - 2 Mafia - 2 Specials = 8)

---

### Phase 1: Large Lobby Gathering & Scaling
- [ ] **46. 13-Client Connection**: Connect 1 Moderator and 12 distinct player sessions simultaneously.
- [ ] **47. Roster Scalability**: Player list scrolls cleanly without breaking layout; souls counter displays `12`.
- [ ] **48. Moderator Start**: Moderator initiates the ritual.

---

### Phase 2: Role Verification & Mafia Teammate Awareness
- [ ] **49. Role Quantities**:
  - Exactly 1 Doctor
  - Exactly 1 Detective
  - Exactly 2 Mafia
  - Exactly 8 Citizens
- [ ] **50. Mafia Teammate Card Recognition**:
  - Both Mafia players' role reveal cards explicitly list each other's player name under *"Your Fellow Conspirators"*.
  - Neither Citizens, Doctor, nor Detective see any mafia identities.

---

### Phase 3: Coordinated Mafia Night Phase & Chat
- [ ] **51. Real-Time Mafia Night Chat**:
  - Both Mafia 1 and Mafia 2 see the Mafia Chat tab unlocked at Night.
  - Messaging between Mafia 1 and Mafia 2 is instantaneous and hidden from all 10 other players and ghosts.
- [ ] **52. Target Consensus / Action Execution**:
  - Mafia 1 selects Victim X; Mafia 2 sees selected target update in real time.
  - Trial can be solved by active Mafia member.
  - Successful trial execution marks Victim X as night kill target.

---

### Phase 4: Mafia Succession & Citizen Recruitment (Rules 11 & 12)
- [ ] **53. First Mafia Demise**:
  - One Mafia member is voted out at the Tribunal or dies from a failed trial.
  - Exactly 1 living Mafia member remains.
- [ ] **54. The Surviving Mafia's Choice**:
  - At the start of the next Night, the surviving Mafia is presented with an ominous choice modal:
    - Option A: **"Strike Alone"** (perform standard assassination).
    - Option B: **"Attempt Recruitment"** (tempt a living Citizen into the fold).
- [ ] **55. Scenario A — Successful Recruitment**:
  - Surviving Mafia chooses **Recruit** and selects Citizen A.
  - Citizen A receives dark proposition modal: *"The Shadows summon you. Will you join the Mafia?"*
  - Citizen A clicks **"Accept"**.
  - Citizen A's role is updated to `Mafia`.
  - Citizen A gains access to Mafia night chat and sees their new partner.
  - Moderator action ledger records: *"Citizen A accepted recruitment into the Mafia"*.
  - Citizens team count decreases by 1; Mafia count increases to 2.
- [ ] **56. Scenario B — Rejected Recruitment**:
  - Surviving Mafia attempts to recruit Citizen B.
  - Citizen B clicks **"Decline"**.
  - Citizen B remains a `Citizen`.
  - Surviving Mafia receives notification that the proposition was spurned.
  - No kill occurs that night as the recruit action replaced the strike.
  - Moderator action ledger records: *"Citizen B spurned the Mafia's recruitment offer"*.

---

### Phase 5: Large Tribunal & Parity Win Condition
- [ ] **57. Large Scale Voting**:
  - 10+ votes cast simultaneously in the Tribunal.
  - Vote distribution tally calculates accurately.
  - Moderator **"Close Votes"** override works if timer needs early termination.
- [ ] **58. 2-Mafia Parity Win Condition**:
  - Test game progression to state: **2 living Mafia and 2 living Citizens** (or 2 Mafia and 1 Citizen).
  - System immediately triggers Mafia victory (*Mafia living count >= Non-Mafia living count*).
  - Game Over screen displays with victorious Mafia team.

---

### Phase 6: Stress & System Performance
- [ ] **59. High Socket Concurrency**:
  - All 13 connections send rapid chat messages and action updates simultaneously.
  - Zero dropped WebSocket frames or disconnection errors.
- [ ] **60. Clean Session Tear Down**:
  - Room closes cleanly when Moderator ends game or disconnects.
