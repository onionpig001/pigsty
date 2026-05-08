import assert from "node:assert/strict";
import {
  buildMeetingPacket,
  extractMeetingReply,
  hasCompleteMeetingReply,
  meetingProtocolMarkers
} from "../public/meetingProtocol.js";

const turnId = "turn-001";
const markers = meetingProtocolMarkers(turnId);
const wrongMarkers = meetingProtocolMarkers("turn-wrong");

const cases = [
  {
    name: "normal marked reply",
    raw: [
      "Claude Code",
      markers.promptEnd,
      "some terminal noise",
      markers.replyBegin,
      "我建议先拆出协议解析层，再接入聊天室。",
      markers.replyEnd,
      "tokens: 1,234"
    ].join("\n"),
    expected: "我建议先拆出协议解析层，再接入聊天室。"
  },
  {
    name: "fallback removes status bar",
    raw: [
      markers.promptEnd,
      "✻ Thinking...",
      "Model: claude-sonnet | tokens: 12,345 | cost: $0.03",
      "esc to interrupt · ctrl+c",
      "可以。这里的问题是当前提取逻辑把 TUI 状态也当成回复了。"
    ].join("\n"),
    expected: "可以。这里的问题是当前提取逻辑把 TUI 状态也当成回复了。"
  },
  {
    name: "fallback removes pasted text placeholder",
    raw: [
      markers.promptEnd,
      "[Pasted text #1 +42 lines]",
      "<pasted_text>",
      "最终应该只保留这句自然语言回复。"
    ].join("\n"),
    expected: "最终应该只保留这句自然语言回复。"
  },
  {
    name: "interrupted loose marked reply",
    raw: [
      markers.promptEnd,
      markers.replyBegin,
      "我先给出结论：需要把原始输出隔离到 debug log。",
      "esc to interrupt",
      "ctrl+c"
    ].join("\n"),
    expected: "我先给出结论：需要把原始输出隔离到 debug log。"
  },
  {
    name: "ansi and spinner removed",
    raw: [
      markers.promptEnd,
      "\u001b[32m⠋ working\u001b[0m",
      "\u001b[31m余额 balance: 12.4\u001b[0m",
      "\u001b[36m最终回复应该干净显示。\u001b[0m"
    ].join("\n"),
    expected: "最终回复应该干净显示。"
  },
  {
    name: "real claude tui prompt echo and status removed",
    raw: [
      "ROLE",
      "You are a participant in a human-hosted meeting chat. This input is not a normal coding prompt.",
      "If your TUI cannot preserve the markers, send only the direct meeting answer with no menus, no prompt echo, and no statu",
      "s text.",
      "Host: 测试",
      "❯",
      "🤖Opus4.7|💰$0.00session/$0.00today/$1.00block(3h12mleft)|🔥$1.66/hr|🧠0(0%)",
      "pasteagaintoexpand",
      "hin",
      "*",
      "·E",
      "m",
      "b",
      "Ee",
      "ei",
      "*ls",
      "lh",
      "sn",
      "i…",
      "g…",
      "收到，@claude在线。测试通过，标记和会议模式都识别正常。@codex你那边信号如何？需要进入哪个议题？",
      "❯",
      "🤖 Opus 4.7| 💰 $0.00 session / $0.00 today / $1.00 block (3h 12m left) | 🔥 $1.66/hr | 🧠 0 (0%)",
      "pasteagaintoexpand",
      "1110731,972 (3%)"
    ].join("\n"),
    expected: "收到，@claude在线。测试通过，标记和会议模式都识别正常。@codex你那边信号如何？需要进入哪个议题？"
  },
  {
    name: "real codex fragmented working status removed",
    raw: [
      "rk",
      "ki",
      "in",
      "Wng",
      "Wog",
      "or",
      "rk",
      "◦ki",
      "in",
      "ng",
      "g",
      "1",
      "•",
      "◦",
      "W",
      "Wo",
      "or2",
      "rk",
      "ki",
      "in",
      "Wng",
      "Wog",
      "•",
      "or",
      "rk",
      "ki",
      "in",
      "ng",
      "g",
      "◦3",
      "•",
      "W",
      "Wo",
      "or4",
      "rk",
      "ki",
      "◦",
      "MM",
      "收到，@codex 在线。测试消息已看到。",
      "94% left · Context 6% used · 5h 91% · wekly 89% · 26K used · ~"
    ].join("\n"),
    expected: "收到，@codex 在线。测试消息已看到。"
  },
  {
    name: "real codex marker redraw fragments removed",
    raw: [
      markers.replyBegin,
      "rv(1",
      "ve1/",
      "er/2",
      "rs2)",
      "s ):",
      "(:",
      "(1 c",
      "1/co",
      "/2od",
      "2)de",
      "):ex",
      ": x_",
      "c_a",
      "_a",
      "er (5",
      "收到。",
      markers.replyEnd,
      "94% left · Context 6% used · 5h 89% · weekly 89% · 25.9K used · ~"
    ].join("\n"),
    expected: "收到。"
  },
  {
    name: "claude startup trust and install warning removed",
    raw: [
      "Yes, I trust this folder✔",
      "▐▛███▜▌ClaudeCodev2.1.132",
      "🤖 Opus 4.7 | 💰 $0.00 session / $0.00 today / $1.10 block (2h 48m left) | 🔥 $0.76/hr | 🧠 0 (…) ",
      "◉ xhigh · /effort",
      "Native installation exists but ~/.local/bin is not in your PATH. Run:",
      "echo 'export PATH=\"$HOME/.local/bin:$PATH\"' >> ~/.bashrc && source ~/.bashrc"
    ].join("\n"),
    expected: ""
  }
];

for (const item of cases) {
  assert.equal(extractMeetingReply(item.raw, turnId), item.expected, item.name);
}

assert.equal(
  extractMeetingReply([
    markers.promptBegin,
    "Reply only between these exact marker lines:",
    markers.replyBegin,
    "your meeting reply",
    markers.replyEnd,
    "Transcript:",
    "claude: 历史消息不应该入库",
    "Message:",
    "@codex said in the meeting:",
    "同意端到端验证。",
    "",
    "@claude, continue the discussion only if useful."
  ].join("\n"), turnId),
  "",
  "incomplete current prompt echo is rejected"
);

assert.equal(
  extractMeetingReply(buildMeetingPacket({
    id: turnId,
    speakerName: "claude",
    purpose: "discuss",
    meetingTitle: "协议测试",
    participantNames: ["claude", "codex"],
    transcript: "Host -> claude: 请讨论",
    body: "只发送了提示词，还没有模型回复"
  }), turnId),
  "",
  "template reply markers inside prompt are ignored"
);

assert.equal(
  hasCompleteMeetingReply(buildMeetingPacket({
    id: turnId,
    speakerName: "claude",
    purpose: "discuss",
    meetingTitle: "协议测试",
    participantNames: ["claude", "codex"],
    transcript: "Host -> claude: 请讨论",
    body: "只发送了提示词，还没有模型回复"
  }), turnId),
  false,
  "prompt template markers do not count as a complete reply"
);

assert.equal(
  extractMeetingReply(buildMeetingPacket({
    id: turnId,
    speakerName: "claude",
    purpose: "discuss",
    meetingTitle: "协议测试",
    participantNames: ["claude", "codex"],
    transcript: "Host -> claude: 请讨论",
    body: "只发送了提示词，还没有模型回复"
  }).replace(markers.promptEnd, `RAB_MEETING_PROMPT\n_END:${turnId}`), turnId),
  "",
  "wrapped prompt end still separates prompt template from output"
);

assert.equal(
  extractMeetingReply([
    markers.promptEnd,
    wrongMarkers.replyBegin,
    "这是 wrong turn 的回复，不能进入当前会议记录。",
    wrongMarkers.replyEnd
  ].join("\n"), turnId),
  "",
  "wrong turn marker is rejected"
);

assert.equal(
  extractMeetingReply([
    markers.replyBegin,
    "claude: claude: 结论: 保留正文里的示例。",
    "示例不要删：codex: foo: bar",
    "marker-like 文本也要保留：<<<RAB-MEETING-REPLY-BEGIN:not-this-turn>>>",
    markers.replyEnd
  ].join("\n"), turnId, { speakerName: "claude" }),
  [
    "结论: 保留正文里的示例。",
    "示例不要删：codex: foo: bar",
    "marker-like 文本也要保留：<<<RAB-MEETING-REPLY-BEGIN:not-this-turn>>>"
  ].join("\n"),
  "speaker prefix stripping happens after current turn marker extraction only"
);

assert.equal(
  extractMeetingReply([
    markers.promptEnd,
    markers.replyBegin,
    "收到。",
    `<<RAB-MEETING-REPLY-END:${turnId} (RAB-MEETING-REPLY-END:${turnId})>>`
  ].join("\n"), turnId),
  "收到。",
  "malformed current turn marker redraw is removed"
);

assert.equal(
  extractMeetingReply([
    markers.promptEnd,
    markers.replyBegin,
    "Starti MCP se",
    "10s • esc to interupt)",
    "收到。",
    `<<RAB-MEETING-REPLY-END:${turnId} (RAB-MEETING-REPLY-END:${turnId})>>`
  ].join("\n"), turnId),
  "收到。",
  "codex status fragments inside loose marker are removed"
);

assert.equal(
  extractMeetingReply([
    markers.promptEnd,
    markers.replyBegin,
    "rting M server",
    "收到。",
    `<<RAB-MEETING-REPLY-END:${turnId} (RAB-MEETING-REPLY-END:${turnId})>>`
  ].join("\n"), turnId),
  "收到。",
  "codex mcp startup tail fragment is removed"
);

assert.equal(hasCompleteMeetingReply(cases[0].raw, turnId), true);
assert.equal(hasCompleteMeetingReply(cases[1].raw, turnId), false);

const packet = buildMeetingPacket({
  id: turnId,
  speakerName: "claude",
  purpose: "discuss",
  meetingTitle: "协议测试",
  participantNames: ["claude", "codex"],
  transcript: "Host -> claude: 请讨论",
  body: "请给出方案"
});

assert.match(packet, /RAB-MEETING\/2/);
assert.match(packet, new RegExp(markers.replyBegin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.match(packet, new RegExp(markers.promptEnd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

console.log(`meeting protocol tests passed: ${cases.length} cases`);
