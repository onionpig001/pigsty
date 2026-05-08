export const MEETING_PROTOCOL = "RAB-MEETING/2";

const MEETING_MAX_CHARS = 7000;

export function meetingProtocolMarkers(id) {
  return {
    promptBegin: `RAB_MEETING_PROMPT_BEGIN:${id}`,
    promptEnd: `RAB_MEETING_PROMPT_END:${id}`,
    replyBegin: `<<<RAB-MEETING-REPLY-BEGIN:${id}>>>`,
    replyEnd: `<<<RAB-MEETING-REPLY-END:${id}>>>`
  };
}

export function buildMeetingPacket({
  id,
  speakerName,
  purpose,
  meetingTitle,
  participantNames,
  transcript,
  body
}) {
  const markers = meetingProtocolMarkers(id);
  return [
    markers.promptBegin,
    `${MEETING_PROTOCOL} turn_id=${id} speaker=@${speakerName} mode=${purpose}`,
    `meeting=${meetingTitle}`,
    `participants=${participantNames.map((name) => `@${name}`).join(", ")}`,
    "Rules: meeting chat only; same language as Host; do not inspect files, run commands, edit files, or describe terminal UI unless implementation work is explicitly assigned.",
    "规则：这是会议发言；除非主持人明确要求实现，否则不要读文件、不要运行命令、不要修改项目。",
    "Reply only between these exact marker lines:",
    markers.replyBegin,
    "your meeting reply",
    markers.replyEnd,
    purpose === "discuss" ? "Answer directly and briefly as a meeting participant. Add useful reasoning, decisions, questions, or objections." : "",
    purpose === "task" ? "This is only an assignment confirmation turn. Accept with TASK_ACCEPTED: or decline with TASK_BLOCKED:. Do not execute, inspect files, run commands, or edit files until a separate execution prompt arrives." : "",
    purpose === "memo" ? "You are the meeting secretary. Produce a concise meeting memo with topics, decisions, tasks, risks, and open questions." : "",
    "Transcript:",
    transcript,
    "Message:",
    body,
    markers.promptEnd
  ].filter(Boolean).join("\n");
}

export function hasCompleteMeetingReply(raw, id) {
  if (hasIncompletePromptEcho(raw, id)) return false;
  const escaped = escapeRegExp(id);
  const text = markerSearchRegion(trimMeetingText(cleanTerminalText(raw)), id);
  return new RegExp(`<<<RAB-MEETING-REPLY-BEGIN:${escaped}>>>[\\s\\S]*?<<<RAB-MEETING-REPLY-END:${escaped}>>>`, "i").test(text)
    || new RegExp(`<MEETING-REPLY:${escaped}>[\\s\\S]*?<\\/MEETING-REPLY:${escaped}>`, "i").test(text);
}

export function shouldKeepWaitingForMeetingReply(raw, id, options = {}) {
  if (hasIncompletePromptEcho(raw, id) && !hasCompleteMeetingReply(raw, id)) return true;
  const text = meetingResponseRegion(raw, id);
  if (!text) return true;
  const fallback = fallbackMeetingReply(text, options);
  if (!fallback) return true;
  if (fallback.length < 12 && !/[。！？.!?]/.test(fallback)) return true;
  if (containsActiveTuiMarker(text) && fallback.length < 40) return true;
  return false;
}

export function extractMeetingReply(raw, id, options = {}) {
  const fullText = trimMeetingText(cleanTerminalText(raw));
  if (hasIncompletePromptEcho(raw, id)) return "";
  const markerText = markerSearchRegion(fullText, id);
  const escaped = escapeRegExp(id);
  const frame = new RegExp(`<<<RAB-MEETING-REPLY-BEGIN:${escaped}>>>([\\s\\S]*?)<<<RAB-MEETING-REPLY-END:${escaped}>>>`, "i");
  const frameMatch = markerText.match(frame);
  const looseFrame = new RegExp(`<<<RAB-MEETING-REPLY-BEGIN:${escaped}>>>([\\s\\S]*)`, "i");
  const looseFrameMatch = frameMatch ? null : markerText.match(looseFrame);
  if (!frameMatch && !looseFrameMatch && hasForeignReplyMarker(markerText, id)) return "";

  const text = meetingResponseRegionFromText(fullText, id);
  const legacyMarker = new RegExp(`<MEETING-REPLY:${escaped}>([\\s\\S]*?)<\\/MEETING-REPLY:${escaped}>`, "i");
  const legacyMatch = frameMatch || looseFrameMatch ? null : text.match(legacyMarker);
  const looseLegacy = new RegExp(`<MEETING-REPLY:${escaped}>([\\s\\S]*)`, "i");
  const looseLegacyMatch = frameMatch || looseFrameMatch || legacyMatch ? null : text.match(looseLegacy);

  const extracted = frameMatch
    ? frameMatch[1]
    : looseFrameMatch
      ? looseFrameMatch[1]
      : legacyMatch
        ? legacyMatch[1]
        : looseLegacyMatch
          ? looseLegacyMatch[1]
          : fallbackMeetingReply(text, options);

  return cleanMeetingReply(extracted, {
    id,
    recentMessages: options.recentMessages,
    speakerName: options.speakerName
  });
}

export function meetingResponseRegion(raw, id) {
  const text = trimMeetingText(cleanTerminalText(raw));
  return meetingResponseRegionFromText(text, id);
}

function meetingResponseRegionFromText(text, id) {
  const { promptEnd } = meetingProtocolMarkers(id);
  const marker = findLastFlexibleMarker(text, promptEnd);
  if (marker) return text.slice(marker.end);
  return stripMeetingPromptEcho(text, id);
}

function markerSearchRegion(text, id) {
  const { promptEnd } = meetingProtocolMarkers(id);
  const marker = findLastFlexibleMarker(text, promptEnd);
  if (marker) return text.slice(marker.end);
  return text;
}

function hasIncompletePromptEcho(raw, id) {
  const text = trimMeetingText(cleanTerminalText(raw));
  const { promptBegin, promptEnd } = meetingProtocolMarkers(id);
  return hasFlexibleMarker(text, promptBegin) && !hasFlexibleMarker(text, promptEnd);
}

function hasForeignReplyMarker(text, id) {
  const escaped = escapeRegExp(id);
  const current = new RegExp(`^${escaped}$`, "i");
  let match;

  const marker = /<<<RAB-MEETING-REPLY-(?:BEGIN|END):([^>]+)>>>/gi;
  while ((match = marker.exec(text))) {
    if (!current.test(match[1])) return true;
  }

  const legacyMarker = /<\/?MEETING-REPLY:([^>]+)>/gi;
  while ((match = legacyMarker.exec(text))) {
    if (!current.test(match[1])) return true;
  }

  return false;
}

export function cleanTerminalText(value) {
  return String(value || "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[()][A-Za-z0-9]/g, "")
    .replace(/\r/g, "\n")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export function trimMeetingText(value) {
  const compacted = String(value || "").replace(/\n{4,}/g, "\n\n\n").trim();
  return compacted.length > MEETING_MAX_CHARS ? compacted.slice(-MEETING_MAX_CHARS) : compacted;
}

function fallbackMeetingReply(text, options = {}) {
  const withoutPrompt = stripMeetingPromptEcho(text);
  const lines = String(withoutPrompt || "").split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isTerminalChromeLine(line))
    .filter((line) => !isEchoedMeetingInput(line, options.recentMessages || []));
  return cleanMeetingReply(lines.join("\n"), options);
}

function cleanMeetingReply(value, options = {}) {
  const escapedId = options.id ? escapeRegExp(options.id) : "";
  let text = cleanTerminalText(value);
  if (escapedId) {
    text = text.replace(new RegExp(`</?MEETING-REPLY:${escapedId}>`, "gi"), "");
    text = text
      .replace(new RegExp(`<<<RAB-MEETING-REPLY-BEGIN:${escapedId}>>>`, "gi"), "")
      .replace(new RegExp(`<<<RAB-MEETING-REPLY-END:${escapedId}>>>`, "gi"), "");
    text = text.replace(new RegExp(`^<{1,3}RAB-MEETING-REPLY-(?:BEGIN|END):${escapedId}[^\\n]*>{1,3}$`, "gim"), "");
  }

  const lines = stripCurrentSpeakerPrefix(trimMeetingText(text), options.speakerName)
    .replace(/^RAB_MEETING_PROMPT_(?:BEGIN|END):\S+$/gim, "")
    .replace(/^RAB-MEETING\/\d+$/gim, "")
    .replace(/^turn_id:\s+.*$/gim, "")
    .replace(/^speaker:\s+.*$/gim, "")
    .replace(/^mode:\s+.*$/gim, "")
    .replace(/^MEETING_PACKET\s+\S+/gim, "")
    .replace(/^Meeting:\s+.*$/gim, "")
    .replace(/^meeting:\s+.*$/gim, "")
    .replace(/^Participants:\s+.*$/gim, "")
    .replace(/^participants:\s+.*$/gim, "")
    .replace(/^Recent transcript:\s*$/gim, "")
    .replace(/^Current (?:host\/participant )?message:\s*$/gim, "")
    .replace(/^Host addressed\s+.*$/gim, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isTerminalChromeLine(line))
    .filter((line) => !isEchoedMeetingInput(line, options.recentMessages || []));

  return trimMeetingText(lines.join("\n"));
}

function stripCurrentSpeakerPrefix(text, speakerName = "") {
  const cleanName = String(speakerName || "").replace(/^@/, "").trim();
  if (!cleanName) return text;

  const prefix = new RegExp(`^@?${escapeRegExp(cleanName)}\\s*[:：]\\s*`, "i");
  let stripped = false;
  return String(text || "").split("\n").map((line) => {
    if (stripped || !line.trim()) return line;
    let next = line.trimStart();
    while (prefix.test(next)) next = next.replace(prefix, "");
    stripped = true;
    return next;
  }).join("\n");
}

function stripMeetingPromptEcho(text, id = "") {
  let next = String(text || "");
  if (id) {
    const markers = meetingProtocolMarkers(id);
    next = next.replace(new RegExp(`${escapeRegExp(markers.promptBegin)}[\\s\\S]*?${escapeRegExp(markers.promptEnd)}`, "gi"), "");
  }
  next = next.replace(/MEETING_PACKET\s+\S+[\s\S]*?Current message:\s*/i, "");
  next = next.replace(/Return only this exact wrapper[\s\S]*?Do not put any text before or after the wrapper\./gi, "");
  return next;
}

function containsActiveTuiMarker(text) {
  const tail = String(text || "").slice(-1800);
  return [
    /esc to inter?rupt/i,
    /ctrl\+c/i,
    /\btokens?\b/i,
    /\bthinking\b/i,
    /\bworking\b/i,
    /\brunning\b/i,
    /\bpress enter\b/i,
    /\buse arrow\b/i,
    /✻|✽|✶|✢|⏺|●|◐|◑|◒|◓|⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/
  ].some((pattern) => pattern.test(tail));
}

function isTerminalChromeLine(line) {
  const compact = line.trim();
  const squeezed = compact.replace(/\s+/g, "").toLowerCase();
  if (looksLikeCompressedStatusLine(compact, squeezed)) return true;
  if (looksLikeSpinnerFragmentLine(compact, squeezed)) return true;

  return [
    /^>/,
    /^❯/,
    /^ROLE$/i,
    /^Host:\s*/i,
    /^╭|^╰|^│|^─|^┌|^└|^┐|^┘|^┃|^┏|^┗|^━/,
    /^⎿/,
    /^[*·•◦✻✽✶✢⏺●◐◑◒◓⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*/,
    /\besc to inter?rupt\b/i,
    /\bctrl\+c\b/i,
    /\bshift\+tab\b/i,
    /\bpress enter\b/i,
    /\buse arrow\b/i,
    /\btrust this folder\b/i,
    /ClaudeCodev?\d/i,
    /Native installation exists/i,
    /\.local\/bin.*PATH/i,
    /^echo\s*['"]?export\s*PATH/i,
    /source\s+~\/\.bashrc/i,
    /\bxhigh\b.*\/effort/i,
    /\bthinking\b/i,
    /\bworking\b/i,
    /\brunning\b/i,
    /\bprocessing\b/i,
    /^starti(?:ng)?\s+mcp\b/i,
    /^rting\s+m\s+server\b/i,
    /\btoken(?:s)?\b/i,
    /\bcontext\b.*\b(left|remaining|window)\b/i,
    /\b(balance|credit|cost|usage|rate limit)\b/i,
    /\b(model|opus|sonnet|haiku|claude-|gpt-|codex)\b.*\b(tokens?|context|cost|balance|usage)\b/i,
    /\b(pasted\s*text|pastedtext|paste placeholder)\b/i,
    /^\[?Pasted text\b/i,
    /^<pasted[_ -]?text/i,
    /^RAB-MEETING\/\d+/i,
    /^RAB_MEETING_PROMPT_(?:BEGIN|END):\S+$/i,
    /^<<<RAB-MEETING-REPLY-(?:BEGIN|END):[^>]+>>>$/i,
    /^s text\.?$/i,
    /^ROLE$/i,
    /OUTPUT CONTRACT/i,
    /Your entire visible meeting reply/i,
    /write only your meeting chat message here/i,
    /BEHAVIOR/i,
    /You are a participant in a human-hosted meeting chat/i,
    /This input is not a normal coding prompt/i,
    /If your TUI cannot preserve/i,
    /direct meeting answer with no menus/i,
    /no prompt echo/i,
    /no status text/i,
    /MEETING_PACKET/i,
    /Return exactly this wrapper/i,
    /Return only this exact wrapper/i,
    /Do not put any text before or after the wrapper/i,
    /Treat this as a relay into a meeting chat/i,
    /Do not inspect files/i,
    /中文规则：这是会议发言/,
    /Use the same language as the Host/i,
    /Answer directly and briefly as a meeting participant/i,
    /Recent transcript:/i,
    /Current message:/i,
    /Current host\/participant message:/i,
    /^Meeting:/i,
    /^You are @/i,
    /^Participants:/i,
    /^Host addressed/i,
    /^Reply in the meeting chat/i,
    /^This is a work assignment/i,
    /^Full transcript:/i,
    /^Memo format:/i
  ].some((pattern) => pattern.test(compact));
}

function looksLikeCompressedStatusLine(compact, squeezed) {
  if (!compact) return true;
  if (/^[\d,.\s()%~·-]+$/.test(compact)) return true;
  return [
    /[🤖💰🔥🧠]/,
    /\$\d/,
    /opus\d|opus4|sonnet|haiku/,
    /session.*today.*block/,
    /block.*left/,
    /pasteagaintoexpand/,
    /\d+%left/,
    /context.*used/,
    /weekly|wekly/,
    /\d+kused/
  ].some((pattern) => pattern.test(squeezed));
}

function looksLikeSpinnerFragmentLine(compact, squeezed) {
  if (!squeezed) return true;
  const hasCjk = /[\u4e00-\u9fff]/.test(compact);
  if (/^[*·•◦❯~]+$/.test(compact)) return true;
  if (/^[a-z]*…$/i.test(compact) && compact.length <= 8) return true;
  if (/^(w|wo|wor|work|wog|wng|rk|ki|in|ng|or|g|m|mm|hin|ls|lh|sn|ee|ei|b)$/i.test(squeezed)) return true;
  if (!hasCjk && compact.length <= 16 && /[0-9_\/():;]/.test(compact)) return true;
  if (/^[a-z0-9]+$/i.test(squeezed) && squeezed.length <= 4 && !/^(ok|yes|no)$/i.test(squeezed)) return true;
  if (/^[a-z0-9*·•◦…]+$/i.test(squeezed) && squeezed.length <= 6 && !/[.!?。！？]$/.test(compact)) return true;
  return false;
}

function isEchoedMeetingInput(line, recentMessages) {
  const compact = line.trim();
  if (!compact) return true;
  if (/^@[\w\-\u4e00-\u9fff]+,\s*(respond|continue)/i.test(compact)) return true;
  if (/^Host (addressed|assigned|ended)\b/i.test(compact)) return true;
  if (/^@[\w\-\u4e00-\u9fff]+ said in the meeting:/i.test(compact)) return true;
  return recentMessages.slice(-10).some((message) => {
    const content = String(message.content || "").trim();
    return content === compact || content.split("\n").map((item) => item.trim()).includes(compact);
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasFlexibleMarker(text, marker) {
  return !!findLastFlexibleMarker(text, marker);
}

function findLastFlexibleMarker(text, marker) {
  const value = String(text || "");
  const exactIndex = value.lastIndexOf(marker);
  if (exactIndex !== -1) return { index: exactIndex, end: exactIndex + marker.length };

  const pattern = marker.split("").map((char) => escapeRegExp(char)).join("\\s*");
  const regex = new RegExp(pattern, "gi");
  let found = null;
  let match;
  while ((match = regex.exec(value))) {
    found = { index: match.index, end: match.index + match[0].length };
    if (match[0].length === 0) regex.lastIndex += 1;
  }
  return found;
}
