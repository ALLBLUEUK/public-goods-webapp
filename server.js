const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function freshState() {
  return {
    sessionId: crypto.randomUUID(),
    sessionCode: crypto.randomBytes(3).toString("hex").toUpperCase(),
    status: "lobby",
    currentRound: 0,
    maxRounds: 5,
    seatCount: 6,
    endowment: 10,
    multiplier: 0.5,
    discussionAfterRound: 3,
    createdAt: new Date().toISOString(),
    players: Array.from({ length: 6 }, (_, index) => ({
      seat: index + 1,
      name: "",
      token: "",
      connected: false,
      cumulative: 0,
      history: [],
    })),
    rounds: [],
  };
}

let state = freshState();

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(text);
}

function getRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString("utf8");
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function getRound() {
  return state.rounds[state.currentRound - 1] || null;
}

function getRoundSummary(round) {
  if (!round) return null;

  return {
    number: round.number,
    status: round.status,
    totalContribution: round.totalContribution,
    publicShare: round.publicShare,
    submissions: round.submissions.map((item) => ({
      seat: item.seat,
      contribution: item.contribution,
      submittedAt: item.submittedAt,
    })),
    submittedCount: round.submissions.length,
    openedAt: round.openedAt,
    closedAt: round.closedAt,
  };
}

function publicState() {
  const round = getRound();
  return {
    sessionId: state.sessionId,
    sessionCode: state.sessionCode,
    status: state.status,
    currentRound: state.currentRound,
    maxRounds: state.maxRounds,
    seatCount: state.seatCount,
    endowment: state.endowment,
    multiplier: state.multiplier,
    discussionAfterRound: state.discussionAfterRound,
    joinedCount: state.players.filter((player) => player.token).length,
    players: state.players.map((player) => ({
      seat: player.seat,
      name: player.name,
      joined: Boolean(player.token),
    })),
    currentRoundSummary: round
      ? {
          number: round.number,
          status: round.status,
          totalContribution: round.status === "closed" ? round.totalContribution : null,
          publicShare: round.status === "closed" ? round.publicShare : null,
          submittedCount: round.submissions.length,
        }
      : null,
    roundHistory: state.rounds
      .filter((item) => item.status === "closed")
      .map((item) => ({
        number: item.number,
        totalContribution: item.totalContribution,
        publicShare: item.publicShare,
      })),
  };
}

function teacherState(origin) {
  const round = getRound();
  return {
    ...publicState(),
    origin,
    joinUrl: `${origin}/?role=student`,
    teacherUrl: `${origin}/?role=teacher`,
    currentRoundSummary: getRoundSummary(round),
    players: state.players.map((player) => ({
      seat: player.seat,
      name: player.name,
      joined: Boolean(player.token),
      cumulative: player.cumulative,
      history: player.history,
    })),
  };
}

function playerByToken(token) {
  return state.players.find((player) => player.token && player.token === token) || null;
}

function applyRoundResults(round) {
  round.totalContribution = round.submissions.reduce((sum, item) => sum + item.contribution, 0);
  round.publicShare = round.totalContribution * state.multiplier;
  round.status = "closed";
  round.closedAt = new Date().toISOString();

  for (const player of state.players) {
    if (!player.token) continue;

    const submission = round.submissions.find((item) => item.seat === player.seat);
    const contribution = submission ? submission.contribution : 0;
    const score = state.endowment - contribution + round.publicShare;

    player.cumulative += score;
    player.history.push({
      round: round.number,
      contribution,
      totalContribution: round.totalContribution,
      publicShare: round.publicShare,
      score,
      cumulative: player.cumulative,
    });
  }

  state.status = round.number >= state.maxRounds ? "finished" : "results";
}

function resetSession() {
  state = freshState();
}

function collectOrigins(port) {
  const interfaces = os.networkInterfaces();
  const urls = [];

  for (const values of Object.values(interfaces)) {
    for (const item of values || []) {
      if (item.family === "IPv4" && !item.internal) {
        urls.push(`http://${item.address}:${port}`);
      }
    }
  }

  return urls;
}

async function handleApi(req, res, url) {
  const origin =
    req.headers["x-forwarded-proto"] && req.headers.host
      ? `${req.headers["x-forwarded-proto"]}://${req.headers.host}`
      : `http://${req.headers.host}`;

  if (req.method === "GET" && url.pathname === "/api/meta") {
    sendJson(res, 200, {
      ...publicState(),
      origin,
      joinUrl: `${origin}/?role=student`,
      teacherUrl: `${origin}/?role=teacher`,
      localOrigins: collectOrigins(PORT),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/teacher/state") {
    sendJson(res, 200, teacherState(origin));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/teacher/reset") {
    resetSession();
    sendJson(res, 200, teacherState(origin));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/teacher/start-round") {
    if (state.status === "collecting") {
      sendJson(res, 409, { error: "当前轮次还在收集提交。" });
      return;
    }

    if (state.currentRound >= state.maxRounds) {
      sendJson(res, 409, { error: "已经完成全部轮次。" });
      return;
    }

    state.currentRound += 1;
    state.status = "collecting";
    state.rounds.push({
      number: state.currentRound,
      status: "collecting",
      totalContribution: 0,
      publicShare: 0,
      submissions: [],
      openedAt: new Date().toISOString(),
      closedAt: null,
    });

    sendJson(res, 200, teacherState(origin));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/teacher/close-round") {
    const round = getRound();
    if (!round || round.status !== "collecting") {
      sendJson(res, 409, { error: "当前没有正在进行的轮次。" });
      return;
    }

    applyRoundResults(round);
    sendJson(res, 200, teacherState(origin));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/student/join") {
    const body = await getRequestBody(req);
    const seat = Number(body.seat);
    const token = typeof body.token === "string" ? body.token : "";
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 20) : "";

    if (!Number.isInteger(seat) || seat < 1 || seat > state.seatCount) {
      sendJson(res, 400, { error: "座位号必须是 1 到 6 的整数。" });
      return;
    }

    const player = state.players[seat - 1];
    if (player.token && player.token !== token) {
      sendJson(res, 409, { error: "这个座位已经被占用。" });
      return;
    }

    if (!player.token) {
      player.token = crypto.randomUUID();
    }

    player.connected = true;
    player.name = name || `学生 ${seat}`;

    sendJson(res, 200, {
      token: player.token,
      seat: player.seat,
      name: player.name,
      sessionCode: state.sessionCode,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/student/state") {
    const token = url.searchParams.get("token") || "";
    const player = playerByToken(token);
    if (!player) {
      sendJson(res, 404, { error: "未找到该学生身份，请重新进入。" });
      return;
    }

    const round = getRound();
    const ownSubmission = round?.submissions.find((item) => item.seat === player.seat) || null;

    sendJson(res, 200, {
      ...publicState(),
      player: {
        seat: player.seat,
        name: player.name,
        cumulative: player.cumulative,
        history: player.history,
      },
      currentRoundSummary: round
        ? {
            number: round.number,
            status: round.status,
            submitted: Boolean(ownSubmission),
            ownContribution: ownSubmission ? ownSubmission.contribution : null,
            totalContribution: round.status === "closed" ? round.totalContribution : null,
            publicShare: round.status === "closed" ? round.publicShare : null,
          }
        : null,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/student/submit") {
    const body = await getRequestBody(req);
    const token = typeof body.token === "string" ? body.token : "";
    const contribution = Number(body.contribution);
    const player = playerByToken(token);
    const round = getRound();

    if (!player) {
      sendJson(res, 404, { error: "未找到该学生身份，请重新进入。" });
      return;
    }

    if (!round || round.status !== "collecting") {
      sendJson(res, 409, { error: "当前不在提交阶段。" });
      return;
    }

    if (!Number.isInteger(contribution) || contribution < 0 || contribution > state.endowment) {
      sendJson(res, 400, { error: "投入必须是 0 到 10 的整数。" });
      return;
    }

    const existing = round.submissions.find((item) => item.seat === player.seat);
    if (existing) {
      sendJson(res, 409, { error: "本轮已经提交，不能重复修改。" });
      return;
    }

    round.submissions.push({
      seat: player.seat,
      contribution,
      submittedAt: new Date().toISOString(),
    });

    sendJson(res, 200, { ok: true, submittedCount: round.submissions.length });
    return;
  }

  sendJson(res, 404, { error: "接口不存在。" });
}

function serveStatic(res, targetPath) {
  const ext = path.extname(targetPath).toLowerCase();
  const type = MIME_TYPES[ext] || "application/octet-stream";

  fs.readFile(targetPath, (error, buffer) => {
    if (error) {
      sendText(res, 404, "Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-store",
    });
    res.end(buffer);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    let targetPath = path.join(PUBLIC_DIR, url.pathname === "/" ? "index.html" : url.pathname);
    if (!targetPath.startsWith(PUBLIC_DIR)) {
      sendText(res, 403, "Forbidden");
      return;
    }

    if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
      targetPath = path.join(PUBLIC_DIR, "index.html");
    }

    serveStatic(res, targetPath);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "服务器错误。" });
  }
});

server.listen(PORT, () => {
  console.log(`Public goods app running on http://localhost:${PORT}`);
});
