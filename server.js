const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function createPlayers(count) {
  return Array.from({ length: count }, (_, index) => ({
    seat: index + 1,
    name: "",
    token: "",
    joinedAt: "",
    cumulative: 0,
    history: [],
  }));
}

function freshState() {
  const defaults = {
    seatCount: 6,
    maxRounds: 5,
    endowment: 10,
    multiplier: 0.5,
  };

  return {
    sessionId: crypto.randomUUID(),
    sessionCode: crypto.randomBytes(3).toString("hex").toUpperCase(),
    status: "setup",
    currentRound: 0,
    discussionAfterRound: 3,
    createdAt: new Date().toISOString(),
    settings: defaults,
    players: createPlayers(defaults.seatCount),
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

function publicRound(round) {
  if (!round) {
    return null;
  }

  return {
    number: round.number,
    status: round.status,
    submittedCount: round.submissions.length,
    totalContribution: round.status === "closed" ? round.totalContribution : null,
    publicShare: round.status === "closed" ? round.publicShare : null,
  };
}

function ranking() {
  return state.players
    .filter((player) => player.token)
    .map((player) => ({
      seat: player.seat,
      cumulative: player.cumulative,
      roundsPlayed: player.history.length,
    }))
    .sort((a, b) => b.cumulative - a.cumulative || a.seat - b.seat);
}

function publicState(origin) {
  return {
    sessionId: state.sessionId,
    sessionCode: state.sessionCode,
    status: state.status,
    currentRound: state.currentRound,
    discussionAfterRound: state.discussionAfterRound,
    settings: state.settings,
    joinedCount: state.players.filter((player) => player.token).length,
    joinUrl: `${origin}/?role=student`,
    teacherUrl: `${origin}/?role=teacher`,
    players: state.players.map((player) => ({
      seat: player.seat,
      name: player.name,
      joined: Boolean(player.token),
      cumulative: player.cumulative,
      availableWealth: player.history.length === 0 ? state.settings.endowment : player.cumulative,
    })),
    currentRoundSummary: publicRound(getRound()),
    roundHistory: state.rounds
      .filter((round) => round.status === "closed")
      .map((round) => ({
        number: round.number,
        totalContribution: round.totalContribution,
        publicShare: round.publicShare,
        submittedCount: round.submissions.length,
      })),
    ranking: ranking(),
  };
}

function teacherState(origin) {
  const round = getRound();
  return {
    ...publicState(origin),
    currentRoundSummary: round
      ? {
          number: round.number,
          status: round.status,
          submittedCount: round.submissions.length,
          totalContribution: round.totalContribution,
          publicShare: round.publicShare,
          submissions: round.submissions.map((item) => ({
            seat: item.seat,
            contribution: item.contribution,
          })),
        }
      : null,
    players: state.players.map((player) => ({
      seat: player.seat,
      name: player.name,
      joined: Boolean(player.token),
      cumulative: player.cumulative,
      availableWealth: player.history.length === 0 ? state.settings.endowment : player.cumulative,
      history: player.history,
    })),
  };
}

function playerByToken(token) {
  return state.players.find((player) => player.token === token) || null;
}

function normalizeName(name) {
  return String(name || "").trim().toLowerCase();
}

function validateSettings(settings) {
  const seatCount = Number(settings.seatCount);
  const maxRounds = Number(settings.maxRounds);
  const endowment = Number(settings.endowment);
  const multiplier = Number(settings.multiplier);

  if (!Number.isInteger(seatCount) || seatCount < 2) {
    throw new Error("人数必须是不小于 2 的整数。");
  }

  if (!Number.isInteger(maxRounds) || maxRounds < 1) {
    throw new Error("轮次必须是不小于 1 的整数。");
  }

  if (!Number.isInteger(endowment) || endowment < 1 || endowment > 1000) {
    throw new Error("每轮初始资金必须是 1 到 1000 的整数。");
  }

  if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 10) {
    throw new Error("公共品回报系数必须大于 0 且不超过 10。");
  }

  return {
    seatCount,
    maxRounds,
    endowment,
    multiplier,
  };
}

function resetSession() {
  state = freshState();
}

function applyRoundResults(round) {
  const { endowment, multiplier } = state.settings;

  round.totalContribution = round.submissions.reduce((sum, item) => sum + item.contribution, 0);
  round.publicShare = round.totalContribution * multiplier;
  round.status = "closed";
  round.closedAt = new Date().toISOString();

  for (const player of state.players) {
    if (!player.token) {
      continue;
    }

    const submission = round.submissions.find((item) => item.seat === player.seat);
    const contribution = submission ? submission.contribution : 0;
    const startWealth = player.history.length === 0 ? endowment : player.cumulative;
    const privateKeep = startWealth - contribution;
    const score = privateKeep + round.publicShare;

    player.cumulative = score;
    player.history.push({
      round: round.number,
      endowment,
      startWealth,
      contribution,
      privateKeep,
      totalContribution: round.totalContribution,
      publicShare: round.publicShare,
      score,
      cumulative: player.cumulative,
    });
  }

  if (round.number >= state.settings.maxRounds) {
    state.status = "finished";
  } else {
    state.status = "results";
  }
}

async function handleApi(req, res, url) {
  const origin =
    req.headers["x-forwarded-proto"] && req.headers.host
      ? `${req.headers["x-forwarded-proto"]}://${req.headers.host}`
      : `http://${req.headers.host}`;

  if (req.method === "GET" && url.pathname === "/api/meta") {
    sendJson(res, 200, publicState(origin));
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

  if (req.method === "POST" && url.pathname === "/api/teacher/configure") {
    const body = await getRequestBody(req);

    if (state.currentRound > 0 || state.players.some((player) => player.token)) {
      sendJson(res, 409, { error: "已有学生加入或轮次已开始，请先重置后再修改设置。" });
      return;
    }

    try {
      const settings = validateSettings(body);
      state.settings = settings;
      state.players = createPlayers(settings.seatCount);
      state.discussionAfterRound = Math.min(3, settings.maxRounds);
      state.status = "lobby";
      sendJson(res, 200, teacherState(origin));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/teacher/start-round") {
    if (state.status === "collecting") {
      sendJson(res, 409, { error: "当前轮次还在进行中。" });
      return;
    }

    if (state.currentRound >= state.settings.maxRounds) {
      sendJson(res, 409, { error: "已经完成全部轮次。" });
      return;
    }

    if (state.status === "setup") {
      sendJson(res, 409, { error: "请先完成教师端设置。" });
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
      sendJson(res, 409, { error: "当前没有可结束的轮次。" });
      return;
    }

    applyRoundResults(round);
    sendJson(res, 200, teacherState(origin));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/student/join") {
    const body = await getRequestBody(req);
    const token = typeof body.token === "string" ? body.token : "";
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 30) : "";
    const normalized = normalizeName(name);

    if (!name) {
      sendJson(res, 400, { error: "姓名或代号不能为空。" });
      return;
    }

    const sameNamePlayer = state.players.find(
      (player) => player.token && normalizeName(player.name) === normalized
    );
    if (sameNamePlayer && sameNamePlayer.token !== token) {
      sendJson(res, 409, { error: "这个名字已经被使用，请换一个名字。" });
      return;
    }

    let player = token ? playerByToken(token) : null;

    if (!player) {
      player = state.players.find((item) => !item.token) || null;
    }

    if (!player) {
      sendJson(res, 409, { error: "当前参与人数已满。" });
      return;
    }

    if (!player.token) {
      player.token = crypto.randomUUID();
      player.joinedAt = new Date().toISOString();
    }

    player.name = name;

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
      ...publicState(origin),
      player: {
        seat: player.seat,
        name: player.name,
        cumulative: player.cumulative,
        availableWealth: player.history.length === 0 ? state.settings.endowment : player.cumulative,
        history: player.history,
      },
      currentRoundSummary: round
        ? {
            number: round.number,
            status: round.status,
            submitted: Boolean(ownSubmission),
            ownContribution: ownSubmission ? ownSubmission.contribution : null,
            availableWealth: player.history.length === 0 ? state.settings.endowment : player.cumulative,
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

    if (
      !Number.isInteger(contribution) ||
      contribution < 0 ||
      contribution >
        (player.history.length === 0 ? state.settings.endowment : player.cumulative)
    ) {
      const maxContribution =
        player.history.length === 0 ? state.settings.endowment : player.cumulative;
      sendJson(res, 400, {
        error: `投入必须是 0 到 ${maxContribution} 的整数。`,
      });
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
