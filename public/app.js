import { Terminal } from "/vendor/xterm.mjs";
import { FitAddon } from "/vendor/addon-fit.mjs";
import {
  buildMeetingPacket as buildMeetingProtocolPacket,
  cleanTerminalText,
  extractMeetingReply,
  hasCompleteMeetingReply,
  shouldKeepWaitingForMeetingReply,
  trimMeetingText
} from "/meetingProtocol.js";

const PROFILE_STORE = "pigsty.profiles";
const ACTIVE_PROFILE_STORE = "pigsty.activeProfileId";
const MOBILE_QUERY = "(max-width: 760px)";
const MEETING_WRAPPED_SETTLE_MS = 500;
const MEETING_FALLBACK_QUIET_MS = 8000;
const MEETING_RESPONSE_TIMEOUT_MS = 90000;
const MEETING_END_TIMEOUT_MS = 12000;
const MEETING_QUEUE_LIMIT = 6;
const MEETING_READY_WAIT_MS = 15000;
const MEETING_READY_RETRY_MS = 500;
const MEETING_EXECUTION_DISPATCH_DELAY_MS = 700;
const TERMINAL_WRAP_GUTTER_COLS = 32;
const TERMINAL_WRAP_GUTTER_ROWS = 2;

const els = {
  login: document.querySelector("#login"),
  loginForm: document.querySelector("#login-form"),
  loginSubmit: document.querySelector("#login-submit"),
  loginMessage: document.querySelector("#login-message"),
  profileNameInput: document.querySelector("#profile-name-input"),
  serverInput: document.querySelector("#server-input"),
  tokenInput: document.querySelector("#token-input"),
  loginProfileList: document.querySelector("#login-profile-list"),
  loginProfileCount: document.querySelector("#login-profile-count"),
  app: document.querySelector("#app"),
  appMessage: document.querySelector("#app-message"),
  sidebar: document.querySelector("#sidebar"),
  sidebarBackdrop: document.querySelector("#sidebar-backdrop"),
  sidebarToggle: document.querySelector("#sidebar-toggle"),
  refreshButton: document.querySelector("#refresh-button"),
  meetingButton: document.querySelector("#meeting-button"),
  newSessionButton: document.querySelector("#new-session-button"),
  addProfileButton: document.querySelector("#add-profile-button"),
  editProfileButton: document.querySelector("#edit-profile-button"),
  profileForm: document.querySelector("#profile-form"),
  profileSaveButton: document.querySelector("#profile-save-button"),
  profileDialog: document.querySelector("#profile-dialog"),
  profileDialogTitle: document.querySelector("#profile-dialog-title"),
  profileDialogClose: document.querySelector("#profile-dialog-close"),
  profileDialogMessage: document.querySelector("#profile-dialog-message"),
  profileCancelButton: document.querySelector("#profile-cancel-button"),
  dialogProfileName: document.querySelector("#dialog-profile-name"),
  dialogServerUrl: document.querySelector("#dialog-server-url"),
  dialogToken: document.querySelector("#dialog-token"),
  removeProfileButton: document.querySelector("#remove-profile-button"),
  profileList: document.querySelector("#profile-list"),
  profileCount: document.querySelector("#profile-count"),
  sessionForm: document.querySelector("#session-form"),
  sessionStartButton: document.querySelector("#session-start-button"),
  sessionName: document.querySelector("#session-name"),
  sessionCwd: document.querySelector("#session-cwd"),
  toolTabs: document.querySelector("#tool-tabs"),
  sessionList: document.querySelector("#session-list"),
  sessionCount: document.querySelector("#session-count"),
  activeTitle: document.querySelector("#active-title"),
  activeMeta: document.querySelector("#active-meta"),
  terminalArea: document.querySelector("#terminal-area"),
  terminal: document.querySelector("#terminal"),
  terminalEmpty: document.querySelector("#terminal-empty"),
  killButton: document.querySelector("#kill-button"),
  deleteButton: document.querySelector("#delete-session-button"),
  meetingRoom: document.querySelector("#meeting-room"),
  meetingRoomTitle: document.querySelector("#meeting-room-title"),
  meetingRoomMeta: document.querySelector("#meeting-room-meta"),
  meetingChatLog: document.querySelector("#meeting-chat-log"),
  meetingParticipantList: document.querySelector("#meeting-participant-list"),
  meetingComposerForm: document.querySelector("#meeting-composer-form"),
  meetingComposerMode: document.querySelector("#meeting-composer-mode"),
  meetingComposerInput: document.querySelector("#meeting-composer-input"),
  meetingMentionMenu: document.querySelector("#meeting-mention-menu"),
  meetingSendButton: document.querySelector("#meeting-send-button"),
  meetingTerminalButton: document.querySelector("#meeting-terminal-button"),
  meetingAddButton: document.querySelector("#meeting-add-button"),
  meetingAutoButton: document.querySelector("#meeting-auto-button"),
  meetingEndButton: document.querySelector("#meeting-end-button"),
  meetingDialog: document.querySelector("#meeting-dialog"),
  meetingForm: document.querySelector("#meeting-form"),
  meetingDialogTitle: document.querySelector("#meeting-dialog-title"),
  meetingDialogClose: document.querySelector("#meeting-dialog-close"),
  meetingMessage: document.querySelector("#meeting-message"),
  meetingTitleInput: document.querySelector("#meeting-title-input"),
  meetingCandidateList: document.querySelector("#meeting-candidate-list"),
  meetingSecretary: document.querySelector("#meeting-secretary"),
  meetingRefreshButton: document.querySelector("#meeting-refresh-button"),
  meetingCancelButton: document.querySelector("#meeting-cancel-button"),
  meetingStartButton: document.querySelector("#meeting-start-button"),
  sendForm: document.querySelector("#send-form"),
  sendInput: document.querySelector("#send-input")
};

const state = {
  profiles: loadProfiles(),
  activeProfileId: localStorage.getItem(ACTIVE_PROFILE_STORE) || "",
  tools: [],
  sessions: [],
  selectedKind: "",
  activeId: "",
  editingProfileId: "",
  socket: null,
  term: null,
  fit: null,
  resizeTimer: null,
  meeting: {
    active: false,
    ended: false,
    ending: false,
    visible: false,
    dialogMode: "create",
    title: "",
    autoDiscussion: false,
    candidates: [],
    participants: [],
    secretaryId: "",
    messages: [],
    debugLog: [],
    endTimer: null,
    mention: {
      open: false,
      start: -1,
      query: "",
      index: 0,
      matches: []
    }
  }
};

const keySequences = {
  up: "\x1b[A",
  down: "\x1b[B",
  enter: "\r",
  tab: "\t",
  esc: "\x1b",
  ctrlc: "\x03"
};

if (!state.activeProfileId && state.profiles[0]) {
  state.activeProfileId = state.profiles[0].id;
}

bindEvents();
renderProfiles();
updateMeetingControls();
showTerminalView();

if (activeProfile()) {
  connectProfile(state.activeProfileId).catch((error) => {
    showLogin();
    showMessage(els.loginMessage, formatError(error), "error");
  });
} else {
  showLogin();
}

function bindEvents() {
  els.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runAction(els.loginSubmit, "Connecting", async () => {
      const profile = saveProfileFromFields({
        name: els.profileNameInput.value,
        serverUrl: els.serverInput.value,
        token: els.tokenInput.value
      });
      await connectProfile(profile.id);
    }, els.loginMessage);
  });

  els.profileForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runAction(els.profileSaveButton, "Connecting", async () => {
      const profile = saveProfileFromFields({
        id: state.editingProfileId,
        name: els.dialogProfileName.value,
        serverUrl: els.dialogServerUrl.value,
        token: els.dialogToken.value
      });
      await connectProfile(profile.id);
      closeProfileDialog();
    }, els.profileDialogMessage);
  });

  els.addProfileButton.addEventListener("click", () => openProfileDialog());
  els.editProfileButton.addEventListener("click", () => openProfileDialog(activeProfile()));
  els.profileDialogClose.addEventListener("click", () => closeProfileDialog());
  els.profileCancelButton.addEventListener("click", () => closeProfileDialog());
  els.profileDialog.addEventListener("click", (event) => {
    if (event.target === els.profileDialog) closeProfileDialog();
  });

  els.removeProfileButton.addEventListener("click", async () => {
    const profile = activeProfile();
    if (!profile) return;
    closeConnection();
    state.profiles = state.profiles.filter((item) => item.id !== profile.id);
    state.activeProfileId = state.profiles[0]?.id || "";
    state.tools = [];
    state.sessions = [];
    saveProfiles();
    localStorage.setItem(ACTIVE_PROFILE_STORE, state.activeProfileId);
    renderAll();
    if (state.activeProfileId) {
      await connectProfile(state.activeProfileId).catch((error) => showMessage(els.appMessage, formatError(error), "error"));
    } else {
      showLogin();
    }
  });

  els.sidebarToggle.addEventListener("click", () => toggleSidebar());
  els.sidebarBackdrop.addEventListener("click", () => closeSidebar());

  els.refreshButton.addEventListener("click", async () => {
    await runAction(els.refreshButton, "Refreshing", () => refreshSessions(), els.appMessage);
  });

  els.meetingButton.addEventListener("click", () => {
    if (state.meeting.active) {
      showMeetingView();
      return;
    }
    if (state.meeting.ended) resetMeeting();
    openMeetingDialog("create");
  });
  els.meetingDialogClose.addEventListener("click", () => closeMeetingDialog());
  els.meetingCancelButton.addEventListener("click", () => closeMeetingDialog());
  els.meetingDialog.addEventListener("click", (event) => {
    if (event.target === els.meetingDialog) closeMeetingDialog();
  });
  els.meetingRefreshButton.addEventListener("click", async () => {
    await runAction(els.meetingRefreshButton, "Loading", () => refreshMeetingCandidates(), els.meetingMessage);
  });
  els.meetingForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runAction(els.meetingStartButton, state.meeting.dialogMode === "add" ? "Inviting" : "Starting", () => submitMeetingForm(), els.meetingMessage);
  });
  els.meetingCandidateList.addEventListener("input", () => updateSecretaryOptions());
  els.meetingCandidateList.addEventListener("change", () => updateSecretaryOptions());
  els.meetingTerminalButton.addEventListener("click", () => showTerminalView());
  els.meetingAddButton.addEventListener("click", () => openMeetingDialog("add"));
  els.meetingAutoButton.addEventListener("click", () => toggleAutoDiscussion());
  els.meetingEndButton.addEventListener("click", () => endMeeting());
  els.meetingComposerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runAction(els.meetingSendButton, "Sending", () => sendHostMeetingMessage(), els.appMessage);
  });
  els.meetingComposerInput.addEventListener("input", () => updateMentionMenu());
  els.meetingComposerInput.addEventListener("keyup", (event) => {
    if (["Escape", "ArrowDown", "ArrowUp", "Enter", "Tab"].includes(event.key)) return;
    updateMentionMenu();
  });
  els.meetingComposerInput.addEventListener("click", () => updateMentionMenu());
  els.meetingComposerInput.addEventListener("keydown", (event) => handleMentionKeydown(event));

  els.newSessionButton.addEventListener("click", () => {
    openSidebar();
    els.sessionName.focus();
  });

  els.sessionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runAction(els.sessionStartButton, "Starting", () => createSession(), els.appMessage);
  });

  els.killButton.addEventListener("click", async () => {
    if (!state.activeId) return;
    await stopSession(state.activeId);
  });

  els.deleteButton.addEventListener("click", async () => {
    if (!state.activeId) return;
    await deleteSession(state.activeId);
  });

  els.sendForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = els.sendInput.value;
    if (!value) return;
    sendInput(`${value}\r`);
    els.sendInput.value = "";
    state.term?.focus();
  });

  document.querySelectorAll("[data-send-key]").forEach((button) => {
    button.addEventListener("click", () => {
      const sequence = keySequences[button.dataset.sendKey];
      if (sequence) sendInput(sequence);
      state.term?.focus();
    });
  });

  window.addEventListener("resize", () => {
    queueResize();
    if (!isMobile()) closeSidebar();
  });

  document.addEventListener("click", (event) => {
    if (event.target === els.meetingComposerInput || els.meetingMentionMenu.contains(event.target)) return;
    hideMentionMenu();
  });
}

async function connectProfile(id) {
  const profile = state.profiles.find((item) => item.id === id);
  if (!profile) throw new Error("Server profile not found");

  hideMessage(els.loginMessage);
  hideMessage(els.appMessage);
  closeConnection();
  state.activeProfileId = profile.id;
  localStorage.setItem(ACTIVE_PROFILE_STORE, profile.id);
  state.tools = [];
  state.sessions = [];
  renderAll();

  const data = await api("/api/bootstrap");
  state.tools = data.tools || [];
  state.sessions = data.sessions || [];
  state.selectedKind = state.tools[0]?.id || "";
  els.sessionCwd.value = data.defaultCwd || "";
  profile.lastConnectedAt = new Date().toISOString();
  saveProfiles();

  initTerminal();
  renderAll();
  showApp();
  closeSidebar();

  if (state.sessions[0]) attachSession(state.sessions[0].id);
}

function initTerminal() {
  if (state.term) return;

  state.term = new Terminal({
    cursorBlink: true,
    fontFamily: "Menlo, Monaco, Consolas, 'SF Mono', 'Hiragino Sans GB', 'Microsoft YaHei Mono', 'Sarasa Mono SC', 'Noto Sans Mono CJK SC', 'PingFang SC', monospace",
    fontSize: 13,
    lineHeight: 1.15,
    reflowCursorLine: true,
    scrollback: 5000,
    theme: {
      background: "#050607",
      foreground: "#eff2f3",
      cursor: "#28c76f",
      selectionBackground: "#315343"
    }
  });
  state.fit = new FitAddon();
  state.term.loadAddon(state.fit);
  state.term.open(els.terminal);
  state.term.onData((data) => sendInput(data));
  queueResize();
}

async function createSession() {
  if (!state.selectedKind) throw new Error("No AI TUI is available on this server");
  const dims = terminalDims();
  const session = await api("/api/sessions", {
    method: "POST",
    body: JSON.stringify({
      kind: state.selectedKind,
      name: els.sessionName.value,
      cwd: els.sessionCwd.value,
      cols: dims.cols,
      rows: dims.rows
    })
  });
  upsertSession(session);
  els.sessionName.value = "";
  renderSessions();
  closeSidebar();
  attachSession(session.id);
}

async function refreshSessions() {
  if (!activeProfile()) return;
  state.sessions = await api("/api/sessions");
  if (state.activeId && !state.sessions.some((session) => session.id === state.activeId)) {
    clearActiveSession();
    if (state.sessions[0]) attachSession(state.sessions[0].id);
    return;
  }
  renderSessions();
  updateActiveMeta();
}

async function stopSession(id) {
  await api(`/api/sessions/${id}/kill`, { method: "POST" });
  await refreshSessions();
}

async function deleteSession(id) {
  try {
    await api(`/api/sessions/${id}`, { method: "DELETE" });
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }

  const wasActive = id === state.activeId;
  state.sessions = state.sessions.filter((session) => session.id !== id);
  if (wasActive) {
    clearActiveSession();
    if (state.sessions[0]) attachSession(state.sessions[0].id);
  } else {
    renderSessions();
  }
}

function clearActiveSession() {
  const socket = state.socket;
  state.socket = null;
  socket?.close();
  state.activeId = "";
  state.term?.reset();
  renderSessions();
  updateActiveMeta();
}

function closeConnection() {
  const socket = state.socket;
  state.socket = null;
  socket?.close();
  state.activeId = "";
  state.term?.reset();
}

function attachSession(id) {
  const session = state.sessions.find((item) => item.id === id);
  if (!session) return;

  state.activeId = id;
  state.socket?.close();
  state.term.reset();
  renderSessions();
  updateActiveMeta();
  els.terminalEmpty.classList.add("is-hidden");

  const socket = new WebSocket(socketUrl(`/ws/sessions/${id}`));
  state.socket = socket;

  socket.addEventListener("open", () => {
    queueResize();
    state.term.focus();
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "snapshot") {
      upsertSession(message.session);
      state.term.reset();
      if (message.data) state.term.write(message.data);
    }
    if (message.type === "output") state.term.write(message.data);
    if (message.type === "status") upsertSession(message.session);
    if (message.type === "error") state.term.writeln(`\r\n[${message.error}]`);
    renderSessions();
    updateActiveMeta();
  });

  socket.addEventListener("close", () => {
    if (state.socket === socket) {
      state.socket = null;
      refreshSessions().catch(() => updateActiveMeta("Disconnected"));
    }
  });
}

async function openMeetingDialog(mode = "create") {
  state.meeting.dialogMode = mode;
  hideMessage(els.meetingMessage);
  els.meetingDialogTitle.textContent = mode === "add" ? "Invite AI" : "Create Meeting";
  els.meetingStartButton.textContent = mode === "add" ? "Invite" : "Start Meeting";
  els.meetingTitleInput.disabled = mode === "add";
  if (mode === "create" && !els.meetingTitleInput.value) {
    els.meetingTitleInput.value = state.meeting.title || "";
  }
  if (mode === "add") {
    els.meetingTitleInput.value = state.meeting.title;
  }
  if (!els.meetingDialog.open) els.meetingDialog.showModal();

  try {
    await refreshMeetingCandidates();
  } catch (error) {
    showMessage(els.meetingMessage, formatError(error), "error");
  }
}

function closeMeetingDialog() {
  if (els.meetingDialog.open) els.meetingDialog.close();
  hideMessage(els.meetingMessage);
}

async function refreshMeetingCandidates() {
  hideMessage(els.meetingMessage);
  els.meetingCandidateList.textContent = "";
  renderEmpty(els.meetingCandidateList, "Loading sessions...");

  const candidates = [];
  const errors = [];

  for (const profile of state.profiles) {
    try {
      const sessions = await apiFor(profile, "/api/sessions");
      for (const session of sessions) {
        if (session.status !== "running") continue;
        candidates.push({
          key: `${profile.id}:${session.id}`,
          profile,
          session,
          name: defaultParticipantName(profile, session)
        });
      }
    } catch (error) {
      errors.push(`${profile.name}: ${formatError(error)}`);
    }
  }

  state.meeting.candidates = candidates;
  renderMeetingCandidates();

  if (candidates.length === 0) {
    throw new Error(errors[0] || "No running sessions found");
  }
  if (errors.length > 0) showMessage(els.meetingMessage, errors.join(" | "), "error");
}

function renderMeetingCandidates() {
  els.meetingCandidateList.textContent = "";

  if (state.meeting.candidates.length === 0) {
    renderEmpty(els.meetingCandidateList, "No running sessions");
    updateSecretaryOptions();
    return;
  }

  const existing = new Set(state.meeting.participants.map((participant) => participant.id));
  for (const candidate of state.meeting.candidates) {
    const disabled = existing.has(candidate.key);
    const row = document.createElement("article");
    row.className = `candidate-row${disabled ? " is-disabled" : ""}`;

    const check = document.createElement("input");
    check.type = "checkbox";
    check.dataset.candidateKey = candidate.key;
    check.disabled = disabled;
    check.checked = state.meeting.dialogMode === "create" && !disabled;

    const details = document.createElement("div");
    details.className = "candidate-details";
    const title = document.createElement("strong");
    title.textContent = `${candidate.profile.name} / ${candidate.session.name}`;
    const meta = document.createElement("span");
    meta.textContent = `${candidate.session.label} · ${candidate.session.cwd}`;
    details.append(title, meta);

    const name = document.createElement("input");
    name.dataset.candidateName = candidate.key;
    name.disabled = disabled;
    name.value = uniqueCandidateName(candidate.name, candidate.key);
    name.placeholder = "Name";

    row.append(check, details, name);
    els.meetingCandidateList.append(row);
  }

  updateSecretaryOptions();
}

function updateSecretaryOptions() {
  const previous = els.meetingSecretary.value || state.meeting.secretaryId;
  const selected = selectedMeetingCandidates({ requireChecked: true });

  els.meetingSecretary.textContent = "";
  if (state.meeting.dialogMode === "add" && state.meeting.secretaryId) {
    const current = participantById(state.meeting.secretaryId);
    if (current) {
      const option = document.createElement("option");
      option.value = current.id;
      option.textContent = `${current.name} (current)`;
      els.meetingSecretary.append(option);
    }
  }

  for (const item of selected) {
    const option = document.createElement("option");
    option.value = item.key;
    option.textContent = item.name;
    els.meetingSecretary.append(option);
  }

  if ([...els.meetingSecretary.options].some((option) => option.value === previous)) {
    els.meetingSecretary.value = previous;
  }
}

async function submitMeetingForm() {
  const selected = selectedMeetingCandidates({ requireChecked: true });
  if (selected.length === 0) throw new Error("Select at least one running AI session");

  if (state.meeting.dialogMode === "add") {
    await addMeetingParticipants(selected);
    closeMeetingDialog();
    return;
  }

  const title = els.meetingTitleInput.value.trim();
  if (!title) throw new Error("Meeting topic is required");

  resetMeeting();
  state.meeting.active = true;
  state.meeting.ended = false;
  state.meeting.ending = false;
  state.meeting.visible = true;
  state.meeting.title = title;
  state.meeting.autoDiscussion = false;
  showMeetingView();
  addMeetingMessage({
    role: "host",
    name: "Host",
    content: title,
    targets: selected.map((item) => item.name)
  });

  await addMeetingParticipants(selected);
  state.meeting.secretaryId = els.meetingSecretary.value || state.meeting.participants[0]?.id || "";
  renderMeeting();
  closeMeetingDialog();
  const invited = state.meeting.participants.filter((participant) => selected.some((item) => item.key === participant.id));
  dispatchHostPrompt(title, "discuss", invited);
}

async function addMeetingParticipants(selected) {
  const existing = new Set(state.meeting.participants.map((participant) => participant.id));
  const created = [];
  for (const item of selected) {
    if (existing.has(item.key)) continue;
    const participant = {
      id: item.key,
      name: uniqueParticipantName(item.name),
      profile: item.candidate.profile,
      session: item.candidate.session,
      socket: null,
      status: "connecting",
      buffer: "",
      timer: null,
      deadlineTimer: null,
      readyTimer: null,
      readyForInput: false,
      readyStartedAt: 0,
      warmupItem: null,
      approvalPromptNotified: false,
      busy: false,
      current: null,
      queue: [],
      lastOutput: "",
      debugLog: []
    };
    state.meeting.participants.push(participant);
    created.push(participant);
  }

  renderMeeting();
  await Promise.allSettled(created.map((participant) => connectMeetingParticipant(participant)));
  if (!state.meeting.secretaryId && state.meeting.participants[0]) {
    state.meeting.secretaryId = state.meeting.participants[0].id;
  }
  if (created.length > 0 && state.meeting.active) {
    recordMeetingDebug("participants-invited", {
      participants: created.map((participant) => participant.name)
    });
  }
  renderMeeting();
}

function selectedMeetingCandidates({ requireChecked }) {
  const rows = [...els.meetingCandidateList.querySelectorAll(".candidate-row")];
  const names = new Set(state.meeting.participants.map((participant) => participant.name.toLowerCase()));
  const selected = [];

  for (const row of rows) {
    const check = row.querySelector("[data-candidate-key]");
    if (!check || check.disabled) continue;
    if (requireChecked && !check.checked) continue;

    const candidate = state.meeting.candidates.find((item) => item.key === check.dataset.candidateKey);
    if (!candidate) continue;

    const input = row.querySelector("[data-candidate-name]");
    let name = sanitizeHandle(input?.value || candidate.name, candidate.name);
    let suffix = 2;
    while (names.has(name.toLowerCase())) {
      name = sanitizeHandle(`${name}${suffix}`, candidate.name);
      suffix += 1;
    }
    names.add(name.toLowerCase());
    selected.push({ key: candidate.key, name, candidate });
  }

  return selected;
}

function connectMeetingParticipant(participant) {
  return new Promise((resolve) => {
    participant.status = "connecting";
    const socket = new WebSocket(socketUrlFor(participant.profile, `/ws/sessions/${participant.session.id}`));
    participant.socket = socket;

    socket.addEventListener("open", () => {
      participant.status = participant.readyForInput ? "ready" : "warming";
      renderMeetingParticipants();
      resolve();
    });

    socket.addEventListener("message", (event) => handleMeetingSocketMessage(participant, event));

    socket.addEventListener("error", () => {
      participant.status = "error";
      renderMeetingParticipants();
      resolve();
    });

    socket.addEventListener("close", () => {
      if (participant.socket === socket && state.meeting.active && !state.meeting.ended) {
        participant.status = "offline";
        renderMeetingParticipants();
      }
    });
  });
}

function handleMeetingSocketMessage(participant, event) {
  let message;
  try {
    message = JSON.parse(event.data);
  } catch {
    return;
  }

  if (message.type === "snapshot") {
    markMeetingParticipantReady(participant, message.data);
    return;
  }
  if (message.type === "output") {
    recordMeetingDebug("raw-output", { participant: participant.name, data: String(message.data || "") }, participant);
    markMeetingParticipantReady(participant, message.data);
    maybeNotifyExecutionApproval(participant, message.data);
    appendMeetingOutput(participant, message.data);
  }
  if (message.type === "error") {
    recordMeetingDebug("socket-error", { participant: participant.name, error: message.error }, participant);
  }
  if (message.type === "status" && message.session?.status !== "running") {
    participant.status = message.session?.status || "offline";
    renderMeetingParticipants();
  }
}

function appendMeetingOutput(participant, data) {
  if (!participant.current) return;
  const cleaned = cleanTerminalText(data);
  if (!cleaned) return;

  participant.buffer = trimMeetingText(`${participant.buffer}\n${cleaned}`);
  clearTimeout(participant.timer);
  const wait = hasCompleteMeetingReply(participant.buffer, participant.current.id)
    ? MEETING_WRAPPED_SETTLE_MS
    : MEETING_FALLBACK_QUIET_MS;
  participant.timer = setTimeout(() => flushMeetingOutput(participant), wait);
}

function flushMeetingOutput(participant, { timeout = false } = {}) {
  const current = participant.current;
  if (!current) return;

  const protocolOptions = {
    recentMessages: state.meeting.messages,
    speakerName: participant.name
  };
  if (!timeout && !hasCompleteMeetingReply(participant.buffer, current.id) && shouldKeepWaitingForMeetingReply(participant.buffer, current.id, protocolOptions)) {
    clearTimeout(participant.timer);
    participant.timer = setTimeout(() => flushMeetingOutput(participant), MEETING_FALLBACK_QUIET_MS);
    return;
  }

  clearTimeout(participant.deadlineTimer);
  participant.deadlineTimer = null;
  const content = extractMeetingReply(participant.buffer, current.id, protocolOptions);
  participant.buffer = "";
  participant.current = null;
  participant.busy = false;
  participant.status = participant.status === "offline" ? "offline" : "ready";

  if (content) {
    const taskDecision = current.purpose === "task" ? parseTaskDecision(content) : null;
    const displayContent = taskDecision?.content || content;
    participant.lastOutput = displayContent;
    addMeetingMessage({
      role: current.purpose === "memo" ? "memo" : "ai",
      name: participant.name,
      participantId: participant.id,
      content: displayContent
    });

    if (current.purpose === "memo") {
      finishMeeting("Meeting ended");
    } else if (current.purpose === "task") {
      if (taskDecision?.accepted) {
        scheduleAcceptedTaskExecution(participant, current, displayContent);
      } else {
        recordMeetingDebug("task-not-accepted", { participant: participant.name, turnId: current.id, reply: displayContent }, participant);
      }
    } else if (state.meeting.active && state.meeting.autoDiscussion && current.autoForward && !state.meeting.ending) {
      forwardParticipantMessage(participant, displayContent, current.audienceIds);
    }
  } else if (timeout) {
    recordMeetingDebug("reply-timeout", { participant: participant.name, turnId: current.id }, participant);
  }

  renderMeetingParticipants();
  processParticipantQueue(participant);
}

function sendHostMeetingMessage() {
  const content = els.meetingComposerInput.value.trim();
  if (!content) return;
  const mode = els.meetingComposerMode.value;
  const targets = targetParticipantsForText(content);
  if (targets.length === 0) throw new Error("No matching AI participants");
  for (const target of targets) {
    addMeetingMessage({
      role: mode === "task" ? "task" : "host",
      name: `Host -> ${target.name}`,
      content,
      targets: [target.name]
    });
  }
  els.meetingComposerInput.value = "";
  hideMentionMenu();
  dispatchHostPrompt(content, mode, targets);
}

function dispatchHostPrompt(content, mode, forcedTargets = null) {
  const targets = forcedTargets || targetParticipantsForText(content);
  if (targets.length === 0) throw new Error("No matching AI participants");

  const audienceIds = targets.map((participant) => participant.id);
  const autoForward = mode === "discuss" && state.meeting.autoDiscussion && targets.length > 1;

  for (const participant of targets) {
    enqueueMeetingPrompt(participant, {
      purpose: mode,
      body: mode === "task" ? buildTaskPrompt(content, participant) : buildHostPrompt(content, participant, targets),
      taskText: mode === "task" ? content : "",
      audienceIds,
      autoForward
    });
  }
}

function forwardParticipantMessage(source, content, audienceIds) {
  const targetIds = audienceIds?.length ? audienceIds : state.meeting.participants.map((participant) => participant.id);
  const targets = state.meeting.participants.filter((participant) => participant.id !== source.id && targetIds.includes(participant.id));
  for (const participant of targets) {
    enqueueMeetingPrompt(participant, {
      purpose: "discuss",
      body: buildPeerPrompt(source, content, participant),
      audienceIds: targetIds,
      autoForward: true
    });
  }
}

function enqueueMeetingPrompt(participant, item) {
  if (!state.meeting.active || state.meeting.ended) return;
  if (participant.status === "offline" || participant.status === "error") {
    recordMeetingDebug("participant-not-connected", { participant: participant.name }, participant);
    return;
  }

  if (participant.busy || participant.current || participant.warmupItem) {
    participant.queue.push(item);
    if (participant.queue.length > MEETING_QUEUE_LIMIT) participant.queue.shift();
    participant.status = "queued";
    renderMeetingParticipants();
    return;
  }

  sendMeetingPrompt(participant, item);
}

function sendMeetingPrompt(participant, item) {
  if (!participant.socket || participant.socket.readyState !== WebSocket.OPEN) {
    participant.status = "offline";
    renderMeetingParticipants();
    return;
  }
  if (!participant.readyForInput && waitForMeetingParticipantReady(participant, item)) return;

  const id = randomId();
  participant.current = { ...item, id };
  participant.buffer = "";
  participant.busy = true;
  participant.status = "thinking";
  clearTimeout(participant.timer);
  clearTimeout(participant.deadlineTimer);
  participant.deadlineTimer = setTimeout(() => {
    flushMeetingOutput(participant, { timeout: true });
  }, MEETING_RESPONSE_TIMEOUT_MS);
  renderMeetingParticipants();

  const payload = buildMeetingPacket(participant, item.body, id, item.purpose);
  recordMeetingDebug("prompt-sent", { participant: participant.name, turnId: id, purpose: item.purpose }, participant);
  sendMeetingTerminalInput(participant, payload);
}

function sendMeetingTerminalInput(participant, payload) {
  const socket = participant.socket;
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const submitDelay = participant.session?.kind === "claude" ? 300 : 50;
  socket.send(JSON.stringify({ type: "input", data: `\x1b[200~${payload}\x1b[201~` }));
  setTimeout(() => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "input", data: "\r" }));
    }
  }, submitDelay);
}

function scheduleAcceptedTaskExecution(participant, current, acknowledgement) {
  const taskText = current.taskText || current.body || "";
  if (!taskText.trim()) return;

  recordMeetingDebug("task-accepted", { participant: participant.name, turnId: current.id }, participant);
  addMeetingMessage({
    role: "system",
    name: "System",
    participantId: participant.id,
    content: `Task accepted by @${participant.name}. Dispatching real execution to its TUI.`
  });

  setTimeout(() => {
    if (!state.meeting.active || state.meeting.ended) return;
    dispatchTaskExecution(participant, taskText, acknowledgement);
  }, MEETING_EXECUTION_DISPATCH_DELAY_MS);
}

function dispatchTaskExecution(participant, taskText, acknowledgement) {
  if (!participant.socket || participant.socket.readyState !== WebSocket.OPEN) {
    recordMeetingDebug("task-execution-socket-missing", { participant: participant.name }, participant);
    return;
  }

  participant.status = "executing";
  participant.approvalPromptNotified = false;
  renderMeetingParticipants();
  recordMeetingDebug("task-execution-dispatched", { participant: participant.name }, participant);
  sendMeetingTerminalInput(participant, buildTaskExecutionPrompt(taskText, participant, acknowledgement));
}

function buildTaskExecutionPrompt(taskText, participant, acknowledgement) {
  return [
    "You accepted the following work item from a Pigsty meeting host.",
    "This is now a normal coding task in your current TUI workspace, not a meeting chat turn.",
    "Do not use RAB meeting reply markers. Do not only acknowledge.",
    "Execute the task end to end: inspect relevant files, edit files directly, run reasonable checks, and report completion in this TUI when done.",
    "If your TUI asks for permission or approval, wait for the human to choose. Do not try to bypass authorization.",
    "",
    `Participant: @${participant.name}`,
    "",
    "Task:",
    taskText,
    "",
    "Meeting acknowledgement:",
    acknowledgement
  ].join("\n");
}

function waitForMeetingParticipantReady(participant, item) {
  const now = Date.now();
  if (!participant.readyStartedAt) participant.readyStartedAt = now;
  if (now - participant.readyStartedAt >= MEETING_READY_WAIT_MS) {
    participant.readyForInput = true;
    participant.readyStartedAt = 0;
    participant.warmupItem = null;
    clearTimeout(participant.readyTimer);
    return false;
  }

  participant.warmupItem = item;
  participant.status = "warming";
  clearTimeout(participant.readyTimer);
  participant.readyTimer = setTimeout(() => {
    const next = participant.warmupItem;
    participant.warmupItem = null;
    if (next && !participant.busy && !participant.current && state.meeting.active && !state.meeting.ended) {
      sendMeetingPrompt(participant, next);
    }
  }, MEETING_READY_RETRY_MS);
  renderMeetingParticipants();
  return true;
}

function markMeetingParticipantReady(participant, data) {
  if (participant.readyForInput) return;
  const text = cleanTerminalText(data);
  if (!looksLikeReadyTui(text)) return;

  participant.readyForInput = true;
  participant.readyStartedAt = 0;
  clearTimeout(participant.readyTimer);
  const pending = participant.warmupItem;
  participant.warmupItem = null;
  if (!participant.current && !participant.busy) participant.status = "ready";
  renderMeetingParticipants();

  if (pending && state.meeting.active && !state.meeting.ended) {
    setTimeout(() => sendMeetingPrompt(participant, pending), 100);
  } else {
    processParticipantQueue(participant);
  }
}

function looksLikeReadyTui(text) {
  const compact = String(text || "").replace(/\s+/g, " ");
  return [
    /❯/,
    /\bTry\s+"/i,
    /\/model\s+to\s+change/i,
    /\bContext\b.*\bused\b/i,
  ].some((pattern) => pattern.test(compact));
}

function parseTaskDecision(content) {
  const text = trimMeetingText(content);
  const accepted = text.match(/^TASK_ACCEPTED\s*[:：-]?\s*/i);
  if (accepted) {
    return {
      accepted: true,
      content: trimMeetingText(text.slice(accepted[0].length)) || "Accepted."
    };
  }

  const blocked = text.match(/^TASK_BLOCKED\s*[:：-]?\s*/i);
  if (blocked) {
    return {
      accepted: false,
      content: trimMeetingText(text.slice(blocked[0].length)) || "Task blocked."
    };
  }

  return {
    accepted: isAffirmativeTaskReply(text),
    content: text
  };
}

function isAffirmativeTaskReply(text) {
  const value = String(text || "").trim();
  if (!value || looksLikeBlockedTaskReply(value)) return false;
  return [
    /^(收到|好的|好|可以|明白|确认|同意|没问题|行|可以的)\b/i,
    /(我会|我将|我来|马上|现在|开始).*(执行|处理|修改|实现|检查|调整|完成)/i,
    /\b(accepted|acknowledged|confirmed|ok|okay|yes|will do|i will|i'll|i can)\b/i
  ].some((pattern) => pattern.test(value));
}

function looksLikeBlockedTaskReply(text) {
  return [
    /^(不能|无法|不行|拒绝|抱歉|暂时不能|需要先|请先|无法执行|不能执行)/i,
    /\b(can't|cannot|unable|blocked|need confirmation|need approval|not able|won't)\b/i,
    /[?？]\s*$/
  ].some((pattern) => pattern.test(text));
}

function maybeNotifyExecutionApproval(participant, data) {
  if (!["executing", "approval"].includes(participant.status)) return;
  if (participant.approvalPromptNotified) return;

  const text = cleanTerminalText(data);
  if (!looksLikeApprovalPrompt(text)) return;

  participant.approvalPromptNotified = true;
  participant.status = "approval";
  addMeetingMessage({
    role: "system",
    name: "System",
    participantId: participant.id,
    content: `@${participant.name} needs authorization in its TUI. Switched to Terminal so you can choose allow or deny.`
  });
  recordMeetingDebug("approval-required", { participant: participant.name, sample: trimMeetingText(text).slice(-500) }, participant);
  renderMeetingParticipants();
  focusParticipantTerminal(participant).catch((error) => {
    recordMeetingDebug("approval-focus-failed", { participant: participant.name, error: formatError(error) }, participant);
  });
}

function looksLikeApprovalPrompt(text) {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  if (!compact) return false;
  const asksForChoice = [
    /\b(allow|approve|approval|authorize|permission|permit|proceed|continue|run command|execute command)\b/i,
    /(允许|授权|批准|确认|继续|执行命令|运行命令|是否|要允许|请选择)/i
  ].some((pattern) => pattern.test(compact));
  const hasChoiceUi = [
    /\b(yes|no|y\/n|allow once|always allow|deny|reject)\b/i,
    /(是|否|允许|拒绝|一次|始终|同意|不同意)/i,
    /[❯›]\s*(Allow|Yes|No|Deny|允许|是|否|拒绝)/i
  ].some((pattern) => pattern.test(compact));
  return asksForChoice && hasChoiceUi;
}

async function focusParticipantTerminal(participant) {
  showTerminalView();
  if (state.activeProfileId !== participant.profile.id) {
    await connectProfile(participant.profile.id);
  }
  if (!state.sessions.some((session) => session.id === participant.session.id)) {
    await refreshSessions();
  }
  attachSession(participant.session.id);
}

function processParticipantQueue(participant) {
  if (participant.busy || participant.current || participant.queue.length === 0 || state.meeting.ended) return;
  if (!state.meeting.autoDiscussion) {
    participant.queue = participant.queue.filter((item) => item.purpose !== "discuss" || !item.autoForward);
  }
  const next = participant.queue.shift();
  if (next) setTimeout(() => sendMeetingPrompt(participant, next), 250);
}

function toggleAutoDiscussion() {
  state.meeting.autoDiscussion = !state.meeting.autoDiscussion;
  if (!state.meeting.autoDiscussion) {
    for (const participant of state.meeting.participants) {
      participant.queue = participant.queue.filter((item) => item.purpose !== "discuss" || !item.autoForward);
    }
    recordMeetingDebug("auto-discussion-paused");
  } else {
    recordMeetingDebug("auto-discussion-resumed");
  }
  updateMeetingControls();
  renderMeetingParticipants();
}

function endMeeting() {
  if (state.meeting.ending) {
    finishMeeting("Meeting dismissed");
    return;
  }
  if (!state.meeting.active || state.meeting.ended) return;
  const secretary = participantById(state.meeting.secretaryId) || state.meeting.participants[0];
  if (!secretary) return;

  state.meeting.ending = true;
  state.meeting.autoDiscussion = false;
  for (const participant of state.meeting.participants) {
    participant.queue = [];
  }
  recordMeetingDebug("secretary-memo-requested", { participant: secretary.name });
  enqueueMeetingPrompt(secretary, {
    purpose: "memo",
    body: buildMemoPrompt(secretary),
    audienceIds: [secretary.id],
    autoForward: false
  });
  clearTimeout(state.meeting.endTimer);
  state.meeting.endTimer = setTimeout(() => {
    finishMeeting("Meeting ended before the secretary memo completed");
  }, MEETING_END_TIMEOUT_MS);
  updateMeetingControls();
}

function finishMeeting(reason = "") {
  clearTimeout(state.meeting.endTimer);
  state.meeting.endTimer = null;
  if (reason) {
    recordMeetingDebug("meeting-finished", { reason });
  }
  state.meeting.active = false;
  state.meeting.ended = true;
  state.meeting.ending = false;
  closeMeetingSockets();
  hideMentionMenu();
  updateMeetingControls();
  renderMeetingParticipants();
  showTerminalView();
}

function closeMeetingSockets() {
  clearTimeout(state.meeting.endTimer);
  state.meeting.endTimer = null;
  for (const participant of state.meeting.participants) {
    clearTimeout(participant.timer);
    clearTimeout(participant.deadlineTimer);
    clearTimeout(participant.readyTimer);
    participant.current = null;
    participant.queue = [];
    participant.warmupItem = null;
    const socket = participant.socket;
    participant.socket = null;
    participant.busy = false;
    participant.status = "ended";
    if (socket && socket.readyState <= WebSocket.OPEN) socket.close();
  }
}

function resetMeeting() {
  clearTimeout(state.meeting.endTimer);
  state.meeting.endTimer = null;
  closeMeetingSockets();
  state.meeting.active = false;
  state.meeting.ended = false;
  state.meeting.ending = false;
  state.meeting.title = "";
  state.meeting.autoDiscussion = false;
  state.meeting.participants = [];
  state.meeting.secretaryId = "";
  state.meeting.messages = [];
  state.meeting.debugLog = [];
  hideMentionMenu();
}

function buildMeetingPacket(participant, body, id, purpose) {
  return buildMeetingProtocolPacket({
    id,
    speakerName: participant.name,
    purpose,
    meetingTitle: state.meeting.title,
    participantNames: state.meeting.participants.map((item) => item.name),
    transcript: recentMeetingTranscript(),
    body
  });
}

function buildHostPrompt(content, participant, targets) {
  const targetNames = targets.map((item) => `@${item.name}`).join(", ");
  return [
    `Host addressed ${targetNames}:`,
    content,
    "",
    `@${participant.name}, respond as a meeting participant. If several AIs are addressed, continue the discussion with them.`
  ].join("\n");
}

function buildTaskPrompt(content, participant) {
  return [
    `Host assigned work to @${participant.name}:`,
    content,
    "",
    "This is the meeting confirmation step only.",
    "If you can execute this task, start your meeting reply with:",
    "TASK_ACCEPTED: short acknowledgement",
    "If you cannot execute it, start your meeting reply with:",
    "TASK_BLOCKED: short reason",
    "Do not inspect files, run commands, or edit files in this confirmation step. If accepted, the bridge will send a separate normal TUI prompt for real execution."
  ].join("\n");
}

function buildPeerPrompt(source, content, participant) {
  return [
    `@${source.name} said in the meeting:`,
    content,
    "",
    `@${participant.name}, continue the discussion only if you have a useful response, correction, question, or decision to add.`
  ].join("\n");
}

function buildMemoPrompt(secretary) {
  return [
    `Host ended the meeting. @${secretary.name}, prepare the meeting memo.`,
    "",
    "Full transcript:",
    meetingTranscriptText(),
    "",
    "Memo format:",
    "- Topic",
    "- Participants",
    "- Core discussion",
    "- Decisions",
    "- Task assignments",
    "- Risks",
    "- Open questions"
  ].join("\n");
}

function targetParticipantsForText(text) {
  const mentions = parseMentions(text);
  if (mentions.length === 0) return state.meeting.participants.filter((participant) => participant.status !== "ended");
  const lowerMentions = mentions.map((name) => name.toLowerCase());
  return state.meeting.participants.filter((participant) => lowerMentions.includes(participant.name.toLowerCase()));
}

function parseMentions(text) {
  const names = new Set();
  const pattern = /@([A-Za-z0-9_\-\u4e00-\u9fff]+)/g;
  let match;
  while ((match = pattern.exec(text))) names.add(match[1]);
  return [...names];
}

function currentMentionContext() {
  const input = els.meetingComposerInput;
  const cursor = input.selectionStart ?? 0;
  const beforeCursor = input.value.slice(0, cursor);
  const match = beforeCursor.match(/(^|\s)@([A-Za-z0-9_\-\u4e00-\u9fff]*)$/);
  if (!match) return null;
  return {
    start: beforeCursor.length - match[0].length + match[1].length,
    end: cursor,
    query: match[2] || ""
  };
}

function updateMentionMenu() {
  const context = currentMentionContext();
  if (!context || !state.meeting.active || state.meeting.ending || state.meeting.participants.length === 0) {
    hideMentionMenu();
    return;
  }

  const query = context.query.toLowerCase();
  const matches = state.meeting.participants
    .filter((participant) => participant.status !== "ended")
    .filter((participant) => {
      const name = participant.name.toLowerCase();
      return !query || name.startsWith(query) || name.includes(query);
    })
    .slice(0, 8);

  if (matches.length === 0) {
    hideMentionMenu();
    return;
  }

  const previous = state.meeting.mention;
  const index = previous.open && previous.query === context.query ? Math.min(previous.index, matches.length - 1) : 0;
  state.meeting.mention = {
    open: true,
    start: context.start,
    query: context.query,
    index,
    matches
  };
  renderMentionMenu();
}

function renderMentionMenu() {
  els.meetingMentionMenu.textContent = "";
  const mention = state.meeting.mention;
  if (!mention.open || mention.matches.length === 0) {
    els.meetingMentionMenu.classList.add("is-hidden");
    return;
  }

  mention.matches.forEach((participant, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = index === mention.index ? "is-active" : "";
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => insertMention(participant));

    const name = document.createElement("strong");
    name.textContent = `@${participant.name}`;
    const meta = document.createElement("span");
    meta.textContent = `${participant.session.label} · ${participant.status}${participant.id === state.meeting.secretaryId ? " · secretary" : ""}`;
    button.append(name, meta);
    els.meetingMentionMenu.append(button);
  });

  els.meetingMentionMenu.classList.remove("is-hidden");
}

function handleMentionKeydown(event) {
  if (!state.meeting.mention.open) return;
  const mention = state.meeting.mention;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    mention.index = (mention.index + 1) % mention.matches.length;
    renderMentionMenu();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    mention.index = (mention.index - 1 + mention.matches.length) % mention.matches.length;
    renderMentionMenu();
  } else if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault();
    insertMention(mention.matches[mention.index]);
  } else if (event.key === "Escape") {
    event.preventDefault();
    hideMentionMenu();
  }
}

function insertMention(participant) {
  if (!participant) return;
  const input = els.meetingComposerInput;
  const cursor = input.selectionStart ?? input.value.length;
  const start = Math.max(0, state.meeting.mention.start);
  const replacement = `@${participant.name} `;
  input.value = `${input.value.slice(0, start)}${replacement}${input.value.slice(cursor)}`;
  const nextCursor = start + replacement.length;
  input.focus();
  input.setSelectionRange(nextCursor, nextCursor);
  hideMentionMenu();
}

function hideMentionMenu() {
  state.meeting.mention = {
    open: false,
    start: -1,
    query: "",
    index: 0,
    matches: []
  };
  els.meetingMentionMenu.classList.add("is-hidden");
  els.meetingMentionMenu.textContent = "";
}

function addMeetingMessage({ role, name, content, participantId = "", targets = [] }) {
  const text = trimMeetingText(content);
  if (!text) return;
  state.meeting.messages.push({
    id: randomId(),
    role,
    name,
    participantId,
    targets,
    content: text,
    createdAt: new Date().toISOString()
  });
  renderMeetingMessages();
}

function recordMeetingDebug(type, payload = {}, participant = null) {
  const entry = {
    type,
    payload,
    createdAt: new Date().toISOString()
  };
  state.meeting.debugLog.push(entry);
  if (state.meeting.debugLog.length > 300) state.meeting.debugLog.shift();

  if (participant) {
    participant.debugLog ||= [];
    participant.debugLog.push(entry);
    if (participant.debugLog.length > 120) participant.debugLog.shift();
  }

  if (localStorage.getItem("pigsty.meetingDebug") === "1") {
    console.debug("[meeting]", type, payload);
  }
}

function renderMeeting() {
  els.meetingRoomTitle.textContent = state.meeting.title || "Meeting";
  renderMeetingParticipants();
  renderMeetingMessages();
  updateMeetingControls();
}

function renderMeetingParticipants() {
  els.meetingParticipantList.textContent = "";
  if (state.meeting.participants.length === 0) {
    renderEmpty(els.meetingParticipantList, "No participants");
    return;
  }

  for (const participant of state.meeting.participants) {
    const item = document.createElement("div");
    item.className = "participant-item";

    const dot = document.createElement("i");
    dot.className = `participant-dot ${participant.status}`;

    const detail = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = `@${participant.name}`;
    const meta = document.createElement("span");
    meta.textContent = `${participant.session.label} · ${participant.status}${participant.id === state.meeting.secretaryId ? " · secretary" : ""}`;
    detail.append(name, meta);

    item.append(dot, detail);
    els.meetingParticipantList.append(item);
  }
}

function renderMeetingMessages() {
  els.meetingChatLog.textContent = "";
  if (state.meeting.messages.length === 0) {
    renderEmpty(els.meetingChatLog, "No messages");
    return;
  }

  for (const message of state.meeting.messages) {
    const bubble = document.createElement("article");
    bubble.className = `chat-message ${message.role}`;

    const header = document.createElement("div");
    header.className = "chat-message-header";
    const name = document.createElement("strong");
    name.textContent = message.name;
    const time = document.createElement("span");
    time.textContent = formatTime(message.createdAt);
    header.append(name, time);

    const body = document.createElement("div");
    body.className = "chat-message-body";
    body.textContent = message.content;

    bubble.append(header, body);
    els.meetingChatLog.append(bubble);
  }

  els.meetingChatLog.scrollTop = els.meetingChatLog.scrollHeight;
}

function updateMeetingControls() {
  const count = state.meeting.participants.length;
  const status = state.meeting.ended ? "ended" : state.meeting.ending ? "ending" : state.meeting.active ? "live" : "not started";
  els.meetingButton.textContent = state.meeting.active ? "Meeting On" : state.meeting.ended ? "Meeting" : "Meeting";
  els.meetingRoomMeta.textContent = `${count} participants · ${status} · auto discussion ${state.meeting.autoDiscussion ? "on" : "off"}`;
  els.meetingAutoButton.textContent = state.meeting.autoDiscussion ? "Auto Discussion On" : "Auto Discussion Off";
  els.meetingAutoButton.disabled = !state.meeting.active || state.meeting.ending;
  els.meetingAddButton.disabled = !state.meeting.active || state.meeting.ending;
  els.meetingEndButton.textContent = state.meeting.ending ? "Dismiss Meeting" : state.meeting.ended ? "Ended" : "End Meeting";
  els.meetingEndButton.disabled = state.meeting.ended || (!state.meeting.active && !state.meeting.ending);
  els.meetingComposerInput.disabled = !state.meeting.active || state.meeting.ending;
  els.meetingSendButton.disabled = !state.meeting.active || state.meeting.ending;
  if (els.meetingComposerInput.disabled) hideMentionMenu();
}

function showMeetingView() {
  state.meeting.visible = true;
  els.terminalArea.classList.add("is-hidden");
  els.meetingRoom.classList.remove("is-hidden");
  renderMeeting();
  closeSidebar();
}

function showTerminalView() {
  state.meeting.visible = false;
  els.meetingRoom.classList.add("is-hidden");
  els.terminalArea.classList.remove("is-hidden");
  queueResize();
}

function participantById(id) {
  return state.meeting.participants.find((participant) => participant.id === id);
}

function recentMeetingTranscript() {
  return state.meeting.messages.slice(-12).map((message) => `${message.name}: ${message.content}`).join("\n");
}

function meetingTranscriptText() {
  return state.meeting.messages.map((message) => `${message.name}: ${message.content}`).join("\n\n");
}

function defaultParticipantName(profile, session) {
  return sanitizeHandle(`${profile.name}-${session.name}`, session.name);
}

function uniqueCandidateName(name, key) {
  const existing = new Set(state.meeting.participants.map((participant) => participant.name.toLowerCase()));
  let next = sanitizeHandle(name, key.slice(0, 8));
  let suffix = 2;
  while (existing.has(next.toLowerCase())) {
    next = sanitizeHandle(`${name}${suffix}`, key.slice(0, 8));
    suffix += 1;
  }
  return next;
}

function uniqueParticipantName(name) {
  const existing = new Set(state.meeting.participants.map((participant) => participant.name.toLowerCase()));
  let next = sanitizeHandle(name, "AI");
  let suffix = 2;
  while (existing.has(next.toLowerCase())) {
    next = sanitizeHandle(`${name}${suffix}`, "AI");
    suffix += 1;
  }
  return next;
}

function sanitizeHandle(value, fallback) {
  const cleaned = String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w\-\u4e00-\u9fff]/g, "")
    .slice(0, 32);
  return cleaned || sanitizeHandle(fallback || "AI", "AI");
}

function renderAll() {
  renderProfiles();
  renderTools();
  renderSessions();
  updateProfileFields();
  updateActiveMeta();
  renderMeeting();
}

function renderProfiles() {
  renderProfileList(els.profileList, true, els.appMessage);
  renderProfileList(els.loginProfileList, true, els.loginMessage);
  els.profileCount.textContent = String(state.profiles.length);
  els.loginProfileCount.textContent = String(state.profiles.length);
  els.removeProfileButton.disabled = !activeProfile();
  els.editProfileButton.disabled = !activeProfile();
}

function renderProfileList(container, connectOnClick, messageTarget) {
  container.textContent = "";
  if (state.profiles.length === 0) {
    renderEmpty(container, "No saved servers");
    return;
  }

  for (const profile of state.profiles) {
    const row = document.createElement("article");
    row.className = `list-row${profile.id === state.activeProfileId ? " is-active" : ""}`;

    const select = document.createElement("button");
    select.type = "button";
    select.className = "row-main";
    select.addEventListener("click", async () => {
      fillConnectionFields(profile);
      if (connectOnClick) {
        await connectProfile(profile.id).catch((error) => showMessage(messageTarget, formatError(error), "error"));
      }
    });

    const name = document.createElement("strong");
    name.textContent = profile.name;
    const detail = document.createElement("span");
    detail.textContent = profile.serverUrl;
    select.append(name, detail);

    const status = document.createElement("i");
    status.className = `status-dot${profile.id === state.activeProfileId ? " running" : ""}`;

    row.append(select, status);
    container.append(row);
  }
}

function renderTools() {
  els.toolTabs.textContent = "";
  els.sessionStartButton.disabled = state.tools.length === 0;

  if (state.tools.length === 0) {
    const button = document.createElement("button");
    button.type = "button";
    button.disabled = true;
    button.textContent = "No TUI";
    els.toolTabs.append(button);
    return;
  }

  for (const tool of state.tools) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = tool.label;
    button.className = tool.id === state.selectedKind ? "is-active" : "";
    button.addEventListener("click", () => {
      state.selectedKind = tool.id;
      renderTools();
    });
    els.toolTabs.append(button);
  }
}

function renderSessions() {
  els.sessionList.textContent = "";
  els.sessionCount.textContent = String(state.sessions.length);
  els.killButton.disabled = !state.activeId || currentSession()?.status !== "running";
  els.deleteButton.disabled = !state.activeId;

  if (state.sessions.length === 0) {
    renderEmpty(els.sessionList, "No sessions");
    return;
  }

  for (const session of state.sessions) {
    const row = document.createElement("article");
    row.className = `list-row session-row${session.id === state.activeId ? " is-active" : ""}`;

    const select = document.createElement("button");
    select.type = "button";
    select.className = "row-main";
    select.addEventListener("click", () => {
      closeSidebar();
      attachSession(session.id);
    });

    const name = document.createElement("strong");
    name.textContent = session.name;
    const detail = document.createElement("span");
    detail.textContent = `${session.label} · ${session.status} · ${session.cwd}`;
    select.append(name, detail);

    const actions = document.createElement("div");
    actions.className = "row-actions";

    if (session.status === "running") {
      const stop = document.createElement("button");
      stop.type = "button";
      stop.className = "mini-button";
      stop.textContent = "Stop";
      stop.addEventListener("click", async () => {
        await stopSession(session.id).catch((error) => showMessage(els.appMessage, formatError(error), "error"));
      });
      actions.append(stop);
    }

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "mini-button danger";
    remove.textContent = "Delete";
    remove.addEventListener("click", async () => {
      await deleteSession(session.id).catch((error) => showMessage(els.appMessage, formatError(error), "error"));
    });
    actions.append(remove);

    row.append(select, actions);
    els.sessionList.append(row);
  }
}

function updateProfileFields() {
  const profile = activeProfile();
  if (!profile && state.profiles[0]) fillConnectionFields(state.profiles[0]);
}

function updateActiveMeta(fallback = "") {
  const profile = activeProfile();
  const session = currentSession();
  els.activeTitle.textContent = "Pigsty TUI";

  if (!profile) {
    els.activeMeta.textContent = fallback || "No server connected";
    els.terminalEmpty.classList.remove("is-hidden");
    return;
  }
  if (!session) {
    els.activeMeta.textContent = fallback || `${profile.serverUrl} · ${state.tools.length} tools`;
    els.terminalEmpty.classList.remove("is-hidden");
    return;
  }
  els.activeMeta.textContent = `${profile.serverUrl} · ${session.label} · ${session.status} · ${session.cwd}`;
  els.terminalEmpty.classList.add("is-hidden");
}

function fillConnectionFields(profile) {
  els.profileNameInput.value = profile.name;
  els.serverInput.value = profile.serverUrl;
  els.tokenInput.value = profile.token;
}

function sendInput(data) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
  state.socket.send(JSON.stringify({ type: "input", data }));
}

function queueResize() {
  clearTimeout(state.resizeTimer);
  state.resizeTimer = setTimeout(() => {
    if (!state.fit || !state.term || state.meeting.visible) return;
    fitTerminal();
    const dims = terminalDims();
    if (state.socket?.readyState === WebSocket.OPEN) {
      state.socket.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
    }
  }, 80);
}

function fitTerminal() {
  state.fit?.fit?.();
  const dims = state.fit?.proposeDimensions?.();
  if (dims) {
    state.term.resize(
      Math.max(20, dims.cols - TERMINAL_WRAP_GUTTER_COLS),
      Math.max(8, dims.rows - TERMINAL_WRAP_GUTTER_ROWS)
    );
  }
  state.term.refresh(0, Math.max(0, state.term.rows - 1));
}

function terminalDims() {
  return {
    cols: state.term?.cols || 100,
    rows: state.term?.rows || 30
  };
}

async function api(path, options = {}) {
  const profile = activeProfile();
  if (!profile) throw new Error("No server profile selected");

  return apiFor(profile, path, options);
}

async function apiFor(profile, path, options = {}) {
  const response = await fetch(new URL(path, profile.serverUrl), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${profile.token}`,
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(data?.error || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function upsertSession(session) {
  const index = state.sessions.findIndex((item) => item.id === session.id);
  if (index === -1) {
    state.sessions.unshift(session);
  } else {
    state.sessions[index] = session;
  }
}

function saveProfileFromFields({ id = "", name = "", serverUrl = "", token = "" }) {
  const normalizedUrl = normalizeServerUrl(serverUrl);
  const trimmedToken = token.trim();
  if (!trimmedToken) throw new Error("Token is required");

  const existing = id
    ? state.profiles.find((profile) => profile.id === id)
    : state.profiles.find((profile) => profile.serverUrl === normalizedUrl);
  const profile = existing || { id: randomId(), createdAt: new Date().toISOString() };
  profile.name = name.trim() || hostLabel(normalizedUrl);
  profile.serverUrl = normalizedUrl;
  profile.token = trimmedToken;
  profile.updatedAt = new Date().toISOString();

  if (!existing) state.profiles.unshift(profile);
  saveProfiles();
  renderProfiles();
  return profile;
}

function loadProfiles() {
  const raw = localStorage.getItem(PROFILE_STORE);
  const parsed = raw ? JSON.parse(raw) : [];
  if (Array.isArray(parsed) && parsed.length > 0) return parsed;

  const oldUrl = localStorage.getItem("pigsty.serverUrl");
  const oldToken = localStorage.getItem("pigsty.webToken");
  if (!oldUrl || !oldToken) return [];

  const serverUrl = normalizeServerUrl(oldUrl);
  return [{
    id: randomId(),
    name: hostLabel(serverUrl),
    serverUrl,
    token: oldToken,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }];
}

function saveProfiles() {
  localStorage.setItem(PROFILE_STORE, JSON.stringify(state.profiles));
}

function activeProfile() {
  return state.profiles.find((item) => item.id === state.activeProfileId);
}

function currentSession() {
  return state.sessions.find((item) => item.id === state.activeId);
}

function showLogin() {
  els.app.classList.add("is-hidden");
  els.login.classList.remove("is-hidden");
  const profile = activeProfile() || state.profiles[0];
  if (profile) fillConnectionFields(profile);
  renderProfiles();
  (profile ? els.tokenInput : els.serverInput).focus();
}

function showApp() {
  els.login.classList.add("is-hidden");
  els.app.classList.remove("is-hidden");
  queueResize();
}

function openProfileDialog(profile = null) {
  const current = profile || null;
  state.editingProfileId = current?.id || "";
  els.profileDialogTitle.textContent = current ? "Edit Server" : "Add Server";
  els.dialogProfileName.value = current?.name || "";
  els.dialogServerUrl.value = current?.serverUrl || "";
  els.dialogToken.value = current?.token || "";
  hideMessage(els.profileDialogMessage);
  els.profileDialog.showModal();
  setTimeout(() => (current ? els.dialogToken : els.dialogServerUrl).focus(), 0);
}

function closeProfileDialog() {
  if (els.profileDialog.open) els.profileDialog.close();
  state.editingProfileId = "";
  hideMessage(els.profileDialogMessage);
}

function toggleSidebar() {
  if (isMobile()) {
    els.sidebar.classList.toggle("is-open");
    els.sidebarBackdrop.classList.toggle("is-visible", els.sidebar.classList.contains("is-open"));
    return;
  }

  els.app.classList.toggle("sidebar-collapsed");
  queueResize();
}

function openSidebar() {
  if (isMobile()) {
    els.sidebar.classList.add("is-open");
    els.sidebarBackdrop.classList.add("is-visible");
    return;
  }
  els.app.classList.remove("sidebar-collapsed");
  queueResize();
}

function closeSidebar() {
  if (isMobile()) {
    els.sidebar.classList.remove("is-open");
    els.sidebarBackdrop.classList.remove("is-visible");
  }
}

function isMobile() {
  return window.matchMedia(MOBILE_QUERY).matches;
}

async function runAction(button, busyText, action, messageTarget) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  hideMessage(messageTarget);
  try {
    await action();
  } catch (error) {
    showMessage(messageTarget, formatError(error), "error");
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function showMessage(target, text, type = "error") {
  if (!target) return;
  target.textContent = text;
  target.className = `message ${type}`;
}

function hideMessage(target) {
  if (!target) return;
  target.textContent = "";
  target.className = "message is-hidden";
}

function renderEmpty(container, text) {
  const empty = document.createElement("div");
  empty.className = "empty-list-item";
  empty.textContent = text;
  container.append(empty);
}

function normalizeServerUrl(value) {
  const raw = value.trim();
  if (!raw) throw new Error("Server URL is required");
  const url = new URL(raw.includes("://") ? raw : `http://${raw}`);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function socketUrl(path) {
  const profile = activeProfile();
  return socketUrlFor(profile, path);
}

function socketUrlFor(profile, path) {
  const url = new URL(path, profile.serverUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", profile.token);
  return url.toString();
}

function hostLabel(serverUrl) {
  return new URL(serverUrl).host;
}

function randomId() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatError(error) {
  if (error?.status === 401) return "Unauthorized: token is invalid for this server.";
  if (error?.status === 403) return "Origin is not allowed by this server.";
  return error?.message || "Operation failed.";
}

function isNotFound(error) {
  return error?.status === 404 || /not found/i.test(error?.message || "");
}
