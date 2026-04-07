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

function getOrigin(req) {
  return req.headers["x-forwarded-proto"] && req.headers.host
    ? `${req.headers["x-forwarded-proto"]}://${req.headers.host}`
    : `http://${req.headers.host}`;
}

function randomCode() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function average(values) {
  if (!values.length) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
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

function createPublicGoodsPlayers(count) {
  return Array.from({ length: count }, (_, index) => ({
    seat: index + 1,
    name: "",
    token: "",
    joinedAt: "",
    cumulative: 0,
    history: [],
  }));
}

function freshPublicGoodsState() {
  const defaults = {
    seatCount: 6,
    maxRounds: 5,
    endowment: 10,
    multiplier: 0.5,
  };

  return {
    sessionId: crypto.randomUUID(),
    sessionCode: randomCode(),
    status: "setup",
    currentRound: 0,
    discussionAfterRound: 3,
    createdAt: new Date().toISOString(),
    settings: defaults,
    players: createPublicGoodsPlayers(defaults.seatCount),
    rounds: [],
  };
}

let publicGoodsState = freshPublicGoodsState();

function getPublicGoodsRound() {
  return publicGoodsState.rounds[publicGoodsState.currentRound - 1] || null;
}

function publicGoodsPlayerByToken(token) {
  return publicGoodsState.players.find((player) => player.token === token) || null;
}

function normalizeName(name) {
  return String(name || "").trim().toLowerCase();
}

function validatePublicGoodsSettings(settings) {
  const seatCount = Number(settings.seatCount);
  const maxRounds = Number(settings.maxRounds);
  const endowment = Number(settings.endowment);
  const multiplier = Number(settings.multiplier);

  if (!Number.isInteger(seatCount) || seatCount < 2) {
    throw new Error("Players must be an integer >= 2.");
  }
  if (!Number.isInteger(maxRounds) || maxRounds < 1) {
    throw new Error("Rounds must be an integer >= 1.");
  }
  if (!Number.isInteger(endowment) || endowment < 1 || endowment > 1000) {
    throw new Error("Initial wealth must be an integer between 1 and 1000.");
  }
  if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 10) {
    throw new Error("Return per public point must be > 0 and <= 10.");
  }

  return { seatCount, maxRounds, endowment, multiplier };
}

function publicGoodsRoundSummary(round) {
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

function publicGoodsRanking() {
  return publicGoodsState.players
    .filter((player) => player.token)
    .map((player) => ({
      seat: player.seat,
      cumulative: player.cumulative,
      roundsPlayed: player.history.length,
    }))
    .sort((a, b) => b.cumulative - a.cumulative || a.seat - b.seat);
}

function publicGoodsBaseState(origin) {
  return {
    sessionId: publicGoodsState.sessionId,
    sessionCode: publicGoodsState.sessionCode,
    status: publicGoodsState.status,
    currentRound: publicGoodsState.currentRound,
    discussionAfterRound: publicGoodsState.discussionAfterRound,
    settings: publicGoodsState.settings,
    joinedCount: publicGoodsState.players.filter((player) => player.token).length,
    joinUrl: `${origin}/public-goods.html?role=student`,
    teacherUrl: `${origin}/public-goods.html?role=teacher`,
    players: publicGoodsState.players.map((player) => ({
      seat: player.seat,
      name: player.name,
      joined: Boolean(player.token),
      cumulative: player.cumulative,
      availableWealth:
        player.history.length === 0
          ? publicGoodsState.settings.endowment
          : player.cumulative,
    })),
    currentRoundSummary: publicGoodsRoundSummary(getPublicGoodsRound()),
    roundHistory: publicGoodsState.rounds
      .filter((round) => round.status === "closed")
      .map((round) => ({
        number: round.number,
        totalContribution: round.totalContribution,
        publicShare: round.publicShare,
        submittedCount: round.submissions.length,
      })),
    ranking: publicGoodsRanking(),
  };
}

function publicGoodsTeacherState(origin) {
  const round = getPublicGoodsRound();
  return {
    ...publicGoodsBaseState(origin),
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
    players: publicGoodsState.players.map((player) => ({
      seat: player.seat,
      name: player.name,
      joined: Boolean(player.token),
      cumulative: player.cumulative,
      availableWealth:
        player.history.length === 0
          ? publicGoodsState.settings.endowment
          : player.cumulative,
      history: player.history,
    })),
  };
}

function resetPublicGoodsSession() {
  publicGoodsState = freshPublicGoodsState();
}

function applyPublicGoodsRoundResults(round) {
  const { endowment, multiplier } = publicGoodsState.settings;

  round.totalContribution = round.submissions.reduce(
    (sum, item) => sum + item.contribution,
    0
  );
  round.publicShare = round.totalContribution * multiplier;
  round.status = "closed";
  round.closedAt = new Date().toISOString();

  for (const player of publicGoodsState.players) {
    if (!player.token) {
      continue;
    }

    const submission = round.submissions.find((item) => item.seat === player.seat);
    const contribution = submission ? submission.contribution : 0;
    const startWealth =
      player.history.length === 0 ? endowment : player.cumulative;
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

  if (round.number >= publicGoodsState.settings.maxRounds) {
    publicGoodsState.status = "finished";
  } else {
    publicGoodsState.status = "results";
  }
}

function createUltimatumParticipants(count, teacherJoinsIfOdd) {
  const participants = [];
  for (let id = 1; id <= count; id += 1) {
    participants.push({
      id,
      name: "",
      token: "",
      joined: false,
      isTeacher: false,
      cumulative: 0,
      history: [],
    });
  }

  if (count % 2 === 1 && teacherJoinsIfOdd) {
    participants.push({
      id: count + 1,
      name: "Teacher",
      token: "teacher",
      joined: true,
      isTeacher: true,
      cumulative: 0,
      history: [],
    });
  }

  return participants;
}

function freshUltimatumState() {
  const defaults = {
    studentCount: 6,
    phaseRounds: 3,
    pieSize: 10,
    teacherJoinsIfOdd: true,
  };
  return {
    sessionId: crypto.randomUUID(),
    sessionCode: randomCode(),
    createdAt: new Date().toISOString(),
    status: "setup",
    currentRound: 0,
    currentStage: 1,
    settings: defaults,
    participants: createUltimatumParticipants(
      defaults.studentCount,
      defaults.teacherJoinsIfOdd
    ),
    stageRoles: {
      1: { proposers: [], responders: [] },
      2: { proposers: [], responders: [] },
    },
    rounds: [],
  };
}

let ultimatumState = freshUltimatumState();

function validateUltimatumSettings(settings) {
  const studentCount = Number(settings.studentCount);
  const phaseRounds = Number(settings.phaseRounds);
  const pieSize = Number(settings.pieSize);
  const teacherJoinsIfOdd = Boolean(settings.teacherJoinsIfOdd);

  if (!Number.isInteger(studentCount) || studentCount < 2 || studentCount > 40) {
    throw new Error("Student count must be an integer between 2 and 40.");
  }
  if (!Number.isInteger(phaseRounds) || phaseRounds < 2 || phaseRounds > 4) {
    throw new Error("Rounds per phase must be an integer between 2 and 4.");
  }
  if (!Number.isInteger(pieSize) || pieSize < 1 || pieSize > 100) {
    throw new Error("Pie size must be an integer between 1 and 100.");
  }
  if (studentCount % 2 === 1 && !teacherJoinsIfOdd) {
    throw new Error("If student count is odd, enable teacher participation to make the total even.");
  }

  return { studentCount, phaseRounds, pieSize, teacherJoinsIfOdd };
}

function resetUltimatumSession() {
  ultimatumState = freshUltimatumState();
}

function getUltimatumParticipantByToken(token) {
  return ultimatumState.participants.find((item) => item.token === token) || null;
}

function getUltimatumRound() {
  return ultimatumState.rounds[ultimatumState.currentRound - 1] || null;
}

function getUltimatumOpenIds() {
  return ultimatumState.participants
    .filter((item) => !item.joined && !item.isTeacher)
    .map((item) => item.id);
}

function getUltimatumActiveParticipants() {
  return ultimatumState.participants.filter((item) => item.joined);
}

function totalUltimatumRounds() {
  return ultimatumState.settings.phaseRounds * 2;
}

function assignUltimatumStageRoles() {
  const ids = getUltimatumActiveParticipants().map((item) => item.id);
  const shuffled = shuffle(ids);
  const half = shuffled.length / 2;
  const proposers = shuffled.slice(0, half).sort((a, b) => a - b);
  const responders = shuffled.slice(half).sort((a, b) => a - b);
  ultimatumState.stageRoles[1] = { proposers, responders };
  ultimatumState.stageRoles[2] = {
    proposers: [...responders],
    responders: [...proposers],
  };
}

function getUltimatumStageForRound(roundNumber) {
  return roundNumber <= ultimatumState.settings.phaseRounds ? 1 : 2;
}

function getUltimatumRolesForRound(roundNumber) {
  return ultimatumState.stageRoles[getUltimatumStageForRound(roundNumber)];
}

function getUltimatumRoleForParticipant(participantId, roundNumber) {
  const roles = getUltimatumRolesForRound(roundNumber);
  if (roles.proposers.includes(participantId)) {
    return "proposer";
  }
  if (roles.responders.includes(participantId)) {
    return "responder";
  }
  return null;
}

function computeUltimatumAnalysis() {
  const closedRounds = ultimatumState.rounds.filter((round) => round.status === "closed");
  const allPairs = closedRounds.flatMap((round) => round.pairs);
  const offers = allPairs.map((pair) => pair.offer);
  const acceptedPairs = allPairs.filter((pair) => pair.accepted);
  const lowPairs = allPairs.filter((pair) => pair.offer <= 2);
  const mediumPairs = allPairs.filter((pair) => pair.offer >= 3 && pair.offer <= 4);
  const highPairs = allPairs.filter((pair) => pair.offer >= 5);
  const stage1Pairs = allPairs.filter((pair) => pair.stage === 1);
  const stage2Pairs = allPairs.filter((pair) => pair.stage === 2);

  return {
    overall: {
      pairCount: allPairs.length,
      averageOffer: average(offers),
      medianOffer: median(offers),
      acceptanceRate: allPairs.length ? acceptedPairs.length / allPairs.length : null,
      rejectionRate: allPairs.length
        ? allPairs.filter((pair) => !pair.accepted).length / allPairs.length
        : null,
    },
    byBand: [
      {
        label: "0-2",
        count: lowPairs.length,
        rejected: lowPairs.filter((pair) => !pair.accepted).length,
      },
      {
        label: "3-4",
        count: mediumPairs.length,
        rejected: mediumPairs.filter((pair) => !pair.accepted).length,
      },
      {
        label: "5+",
        count: highPairs.length,
        rejected: highPairs.filter((pair) => !pair.accepted).length,
      },
    ],
    stages: {
      1: {
        averageOffer: average(stage1Pairs.map((pair) => pair.offer)),
        acceptanceRate: stage1Pairs.length
          ? stage1Pairs.filter((pair) => pair.accepted).length / stage1Pairs.length
          : null,
      },
      2: {
        averageOffer: average(stage2Pairs.map((pair) => pair.offer)),
        acceptanceRate: stage2Pairs.length
          ? stage2Pairs.filter((pair) => pair.accepted).length / stage2Pairs.length
          : null,
      },
    },
    rounds: closedRounds.map((round) => ({
      round: round.number,
      stage: round.stage,
      averageOffer: average(round.pairs.map((pair) => pair.offer)),
      acceptanceRate: round.pairs.length
        ? round.pairs.filter((pair) => pair.accepted).length / round.pairs.length
        : null,
      rejectionCount: round.pairs.filter((pair) => !pair.accepted).length,
    })),
  };
}

function ultimatumRanking() {
  return ultimatumState.participants
    .filter((item) => item.joined && !item.isTeacher)
    .map((item) => ({
      id: item.id,
      name: item.name,
      cumulative: item.cumulative,
    }))
    .sort((a, b) => b.cumulative - a.cumulative || a.id - b.id);
}

function ultimatumBaseState(origin) {
  const totalPlayers = ultimatumState.participants.filter((item) => item.joined).length;
  return {
    sessionId: ultimatumState.sessionId,
    sessionCode: ultimatumState.sessionCode,
    status: ultimatumState.status,
    currentRound: ultimatumState.currentRound,
    currentStage: ultimatumState.currentStage,
    totalRounds: totalUltimatumRounds(),
    settings: ultimatumState.settings,
    teacherJoinId:
      ultimatumState.participants.find((item) => item.isTeacher)?.id || null,
    joinedStudentCount: ultimatumState.participants.filter(
      (item) => item.joined && !item.isTeacher
    ).length,
    joinOpen:
      ultimatumState.status === "lobby" &&
      ultimatumState.currentRound === 0,
    totalActivePlayers: totalPlayers,
    openIds: getUltimatumOpenIds(),
    teacherUrl: `${origin}/ultimatum.html?role=teacher`,
    joinUrl: `${origin}/ultimatum.html?role=student`,
    stageRoles: ultimatumState.stageRoles,
    ranking: ultimatumRanking(),
    analysis: computeUltimatumAnalysis(),
    roundHistory: ultimatumState.rounds
      .filter((round) => round.status === "closed")
      .map((round) => ({
        number: round.number,
        stage: round.stage,
        averageOffer: average(round.pairs.map((pair) => pair.offer)),
        acceptanceRate: round.pairs.length
          ? round.pairs.filter((pair) => pair.accepted).length / round.pairs.length
          : null,
      })),
  };
}

function ultimatumTeacherState(origin) {
  const round = getUltimatumRound();
  const teacherParticipant = ultimatumState.participants.find((item) => item.isTeacher) || null;
  const teacherRole =
    teacherParticipant && ultimatumState.currentRound > 0
      ? getUltimatumRoleForParticipant(teacherParticipant.id, ultimatumState.currentRound)
      : null;

  return {
    ...ultimatumBaseState(origin),
    participants: ultimatumState.participants.map((item) => ({
      id: item.id,
      name: item.name,
      joined: item.joined,
      isTeacher: item.isTeacher,
      cumulative: item.cumulative,
      history: item.history,
    })),
    currentRoundDetail: round
      ? {
          number: round.number,
          stage: round.stage,
          status: round.status,
          proposerIds: round.proposerIds,
          responderIds: round.responderIds,
          submittedOffers: Object.keys(round.offers).map(Number),
          submittedResponses: Object.keys(round.responses).map(Number),
          pendingOffers: round.proposerIds.filter((id) => !(id in round.offers)),
          pendingResponses: round.responderIds.filter((id) => !(id in round.responses)),
          revealedPairs:
            round.status === "closed"
              ? round.pairs.map((pair) => ({
                  pairNumber: round.pairs.indexOf(pair) + 1,
                  proposerId: pair.proposerId,
                  offer: pair.offer,
                  accepted: pair.accepted,
                  proposerPayoff: pair.proposerPayoff,
                  responderPayoff: pair.responderPayoff,
                }))
              : [],
        }
      : null,
    teacherAction:
      teacherParticipant && teacherParticipant.joined
        ? {
            participantId: teacherParticipant.id,
            role: teacherRole,
            roundStatus: round?.status || null,
            responseOffer:
              teacherRole === "responder"
                ? round?.pendingResponseOffers?.[teacherParticipant.id] ?? null
                : null,
            hasSubmitted:
              teacherRole === "proposer"
                ? Boolean(round && round.offers[teacherParticipant.id] != null)
                : teacherRole === "responder"
                  ? Boolean(round && round.responses[teacherParticipant.id])
                  : false,
          }
        : null,
  };
}

function startUltimatumRound() {
  if (!ultimatumState.stageRoles[1].proposers.length) {
    assignUltimatumStageRoles();
  }

  const nextRound = ultimatumState.currentRound + 1;
  const stage = getUltimatumStageForRound(nextRound);
  const roles = getUltimatumRolesForRound(nextRound);

  ultimatumState.currentRound = nextRound;
  ultimatumState.currentStage = stage;
  ultimatumState.status = "proposer_collecting";
  ultimatumState.rounds.push({
    number: nextRound,
    stage,
    status: "proposer_collecting",
    proposerIds: [...roles.proposers],
    responderIds: [...roles.responders],
    offers: {},
    responses: {},
    pendingResponseOffers: {},
    pairs: [],
    openedAt: new Date().toISOString(),
    proposerClosedAt: null,
    closedAt: null,
  });
}

function closeUltimatumProposers() {
  const round = getUltimatumRound();
  const offersPool = shuffle(
    round.proposerIds.map((proposerId) => ({
      proposerId,
      offer: round.offers[proposerId],
    }))
  );
  const responders = shuffle(round.responderIds);

  round.pairs = responders.map((responderId, index) => ({
    round: round.number,
    stage: round.stage,
    proposerId: offersPool[index].proposerId,
    responderId,
    offer: offersPool[index].offer,
    accepted: null,
    proposerPayoff: 0,
    responderPayoff: 0,
  }));

  round.pendingResponseOffers = {};
  for (const pair of round.pairs) {
    round.pendingResponseOffers[pair.responderId] = pair.offer;
  }

  round.status = "responder_collecting";
  round.proposerClosedAt = new Date().toISOString();
  ultimatumState.status = "responder_collecting";
}

function closeUltimatumResponders() {
  const round = getUltimatumRound();
  const pieSize = ultimatumState.settings.pieSize;

  for (const pair of round.pairs) {
    const accepted = round.responses[pair.responderId] === "accept";
    pair.accepted = accepted;
    pair.proposerPayoff = accepted ? pieSize - pair.offer : 0;
    pair.responderPayoff = accepted ? pair.offer : 0;

    const proposer = ultimatumState.participants.find(
      (item) => item.id === pair.proposerId
    );
    const responder = ultimatumState.participants.find(
      (item) => item.id === pair.responderId
    );

    proposer.cumulative += pair.proposerPayoff;
    responder.cumulative += pair.responderPayoff;

    proposer.history.push({
      round: round.number,
      stage: round.stage,
      role: "proposer",
      offer: pair.offer,
      accepted,
      payoff: pair.proposerPayoff,
      cumulative: proposer.cumulative,
    });
    responder.history.push({
      round: round.number,
      stage: round.stage,
      role: "responder",
      offer: pair.offer,
      accepted,
      payoff: pair.responderPayoff,
      cumulative: responder.cumulative,
    });
  }

  round.status = "closed";
  round.closedAt = new Date().toISOString();
  ultimatumState.status =
    ultimatumState.currentRound >= totalUltimatumRounds() ? "finished" : "between_rounds";
}

async function handlePublicGoodsApi(req, res, url) {
  const origin = getOrigin(req);

  if (req.method === "GET" && url.pathname === "/api/meta") {
    sendJson(res, 200, publicGoodsBaseState(origin));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/teacher/state") {
    sendJson(res, 200, publicGoodsTeacherState(origin));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/teacher/reset") {
    resetPublicGoodsSession();
    sendJson(res, 200, publicGoodsTeacherState(origin));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/teacher/configure") {
    const body = await getRequestBody(req);
    if (
      publicGoodsState.currentRound > 0 ||
      publicGoodsState.players.some((player) => player.token)
    ) {
      sendJson(res, 409, {
        error:
          "Students have already joined or rounds have already started. Reset first before changing settings.",
      });
      return;
    }

    try {
      const settings = validatePublicGoodsSettings(body);
      publicGoodsState.settings = settings;
      publicGoodsState.players = createPublicGoodsPlayers(settings.seatCount);
      publicGoodsState.discussionAfterRound = Math.min(3, settings.maxRounds);
      publicGoodsState.status = "lobby";
      sendJson(res, 200, publicGoodsTeacherState(origin));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/teacher/start-round") {
    if (publicGoodsState.status === "collecting") {
      sendJson(res, 409, { error: "A round is already open." });
      return;
    }
    if (publicGoodsState.currentRound >= publicGoodsState.settings.maxRounds) {
      sendJson(res, 409, { error: "All rounds are already finished." });
      return;
    }
    if (publicGoodsState.status === "setup") {
      sendJson(res, 409, { error: "Configure the session first." });
      return;
    }

    publicGoodsState.currentRound += 1;
    publicGoodsState.status = "collecting";
    publicGoodsState.rounds.push({
      number: publicGoodsState.currentRound,
      status: "collecting",
      totalContribution: 0,
      publicShare: 0,
      submissions: [],
      openedAt: new Date().toISOString(),
      closedAt: null,
    });

    sendJson(res, 200, publicGoodsTeacherState(origin));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/teacher/close-round") {
    const round = getPublicGoodsRound();
    if (!round || round.status !== "collecting") {
      sendJson(res, 409, { error: "There is no open round to close." });
      return;
    }

    applyPublicGoodsRoundResults(round);
    sendJson(res, 200, publicGoodsTeacherState(origin));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/student/join") {
    const body = await getRequestBody(req);
    const token = typeof body.token === "string" ? body.token : "";
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 30) : "";
    const normalized = normalizeName(name);

    if (publicGoodsState.status === "setup") {
      sendJson(res, 409, {
        error: "The teacher has not saved the public goods settings yet.",
      });
      return;
    }

    if (!(publicGoodsState.status === "lobby" && publicGoodsState.currentRound === 0)) {
      sendJson(res, 409, {
        error: "New players can only join before Round 1 starts.",
      });
      return;
    }

    if (!name) {
      sendJson(res, 400, { error: "Name or alias cannot be empty." });
      return;
    }

    const sameNamePlayer = publicGoodsState.players.find(
      (player) => player.token && normalizeName(player.name) === normalized
    );
    if (sameNamePlayer && sameNamePlayer.token !== token) {
      sendJson(res, 200, {
        token: sameNamePlayer.token,
        seat: sameNamePlayer.seat,
        name: sameNamePlayer.name,
        sessionCode: publicGoodsState.sessionCode,
        rejoined: true,
      });
      return;
    }

    let player = token ? publicGoodsPlayerByToken(token) : null;
    if (!player) {
      player = publicGoodsState.players.find((item) => !item.token) || null;
    }
    if (!player) {
      sendJson(res, 409, { error: "The session is already full." });
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
      sessionCode: publicGoodsState.sessionCode,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/student/state") {
    const token = url.searchParams.get("token") || "";
    const player = publicGoodsPlayerByToken(token);
    if (!player) {
      sendJson(res, 404, { error: "Student identity not found. Please rejoin." });
      return;
    }

    const round = getPublicGoodsRound();
    const ownSubmission =
      round?.submissions.find((item) => item.seat === player.seat) || null;

    sendJson(res, 200, {
      ...publicGoodsBaseState(origin),
      player: {
        seat: player.seat,
        name: player.name,
        cumulative: player.cumulative,
        availableWealth:
          player.history.length === 0
            ? publicGoodsState.settings.endowment
            : player.cumulative,
        history: player.history,
      },
      currentRoundSummary: round
        ? {
            number: round.number,
            status: round.status,
            submitted: Boolean(ownSubmission),
            ownContribution: ownSubmission ? ownSubmission.contribution : null,
            availableWealth:
              player.history.length === 0
                ? publicGoodsState.settings.endowment
                : player.cumulative,
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
    const player = publicGoodsPlayerByToken(token);
    const round = getPublicGoodsRound();

    if (!player) {
      sendJson(res, 404, { error: "Student identity not found. Please rejoin." });
      return;
    }
    if (!round || round.status !== "collecting") {
      sendJson(res, 409, { error: "The round is not open for submissions." });
      return;
    }

    const maxContribution =
      player.history.length === 0
        ? publicGoodsState.settings.endowment
        : player.cumulative;
    if (
      !Number.isInteger(contribution) ||
      contribution < 0 ||
      contribution > maxContribution
    ) {
      sendJson(res, 400, {
        error: `Contribution must be an integer between 0 and ${maxContribution}.`,
      });
      return;
    }

    const existing = round.submissions.find((item) => item.seat === player.seat);
    if (existing) {
      sendJson(res, 409, { error: "You have already submitted this round." });
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

  sendJson(res, 404, { error: "Endpoint not found." });
}

async function handleUltimatumApi(req, res, url) {
  const origin = getOrigin(req);

  if (req.method === "GET" && url.pathname === "/api/ultimatum/meta") {
    sendJson(res, 200, ultimatumBaseState(origin));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/ultimatum/teacher/state") {
    sendJson(res, 200, ultimatumTeacherState(origin));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/ultimatum/teacher/reset") {
    resetUltimatumSession();
    sendJson(res, 200, ultimatumTeacherState(origin));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/ultimatum/teacher/configure") {
    const body = await getRequestBody(req);
    if (ultimatumState.currentRound > 0 || ultimatumState.status !== "setup") {
      sendJson(res, 409, {
        error: "Reset first before changing settings after the session starts.",
      });
      return;
    }
    try {
      const settings = validateUltimatumSettings(body);
      ultimatumState.settings = settings;
      ultimatumState.participants = createUltimatumParticipants(
        settings.studentCount,
        settings.teacherJoinsIfOdd
      );
      ultimatumState.status = "lobby";
      sendJson(res, 200, ultimatumTeacherState(origin));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/ultimatum/teacher/start-round") {
    const joinedStudents = ultimatumState.participants.filter(
      (item) => item.joined && !item.isTeacher
    ).length;
    if (joinedStudents !== ultimatumState.settings.studentCount) {
      sendJson(res, 409, {
        error: "Wait until all student IDs have joined before starting.",
      });
      return;
    }
    if (ultimatumState.status === "proposer_collecting") {
      sendJson(res, 409, { error: "Proposer collection is already open." });
      return;
    }
    if (ultimatumState.status === "responder_collecting") {
      sendJson(res, 409, { error: "Close responder decisions first." });
      return;
    }
    if (ultimatumState.currentRound >= totalUltimatumRounds()) {
      sendJson(res, 409, { error: "All ultimatum rounds are already finished." });
      return;
    }

    startUltimatumRound();
    sendJson(res, 200, ultimatumTeacherState(origin));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/ultimatum/teacher/close-proposers") {
    const round = getUltimatumRound();
    if (!round || round.status !== "proposer_collecting") {
      sendJson(res, 409, { error: "There is no proposer stage to close." });
      return;
    }
    const missing = round.proposerIds.filter((id) => round.offers[id] == null);
    if (missing.length) {
      sendJson(res, 409, {
        error: `These proposer IDs have not submitted yet: ${missing.join(", ")}.`,
      });
      return;
    }

    closeUltimatumProposers();
    sendJson(res, 200, ultimatumTeacherState(origin));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/ultimatum/teacher/close-responders") {
    const round = getUltimatumRound();
    if (!round || round.status !== "responder_collecting") {
      sendJson(res, 409, { error: "There is no responder stage to close." });
      return;
    }
    const missing = round.responderIds.filter((id) => !round.responses[id]);
    if (missing.length) {
      sendJson(res, 409, {
        error: `These responder IDs have not decided yet: ${missing.join(", ")}.`,
      });
      return;
    }

    closeUltimatumResponders();
    sendJson(res, 200, ultimatumTeacherState(origin));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/ultimatum/teacher/submit-self") {
    const body = await getRequestBody(req);
    const round = getUltimatumRound();
    const teacher = ultimatumState.participants.find((item) => item.isTeacher);
    if (!teacher || !teacher.joined) {
      sendJson(res, 409, { error: "Teacher is not participating in this session." });
      return;
    }
    if (!round) {
      sendJson(res, 409, { error: "There is no active round." });
      return;
    }

    const role = getUltimatumRoleForParticipant(teacher.id, round.number);
    if (role === "proposer") {
      const offer = Number(body.offer);
      if (
        !Number.isInteger(offer) ||
        offer < 0 ||
        offer > ultimatumState.settings.pieSize
      ) {
        sendJson(res, 400, {
          error: `Offer must be an integer between 0 and ${ultimatumState.settings.pieSize}.`,
        });
        return;
      }
      if (round.status !== "proposer_collecting") {
        sendJson(res, 409, { error: "The proposer stage is not open." });
        return;
      }
      if (round.offers[teacher.id] != null) {
        sendJson(res, 409, { error: "Teacher offer has already been submitted." });
        return;
      }
      round.offers[teacher.id] = offer;
      sendJson(res, 200, ultimatumTeacherState(origin));
      return;
    }

    if (role === "responder") {
      const decision = body.decision;
      if (!["accept", "reject"].includes(decision)) {
        sendJson(res, 400, { error: "Decision must be accept or reject." });
        return;
      }
      if (round.status !== "responder_collecting") {
        sendJson(res, 409, { error: "The responder stage is not open." });
        return;
      }
      if (round.responses[teacher.id]) {
        sendJson(res, 409, { error: "Teacher decision has already been submitted." });
        return;
      }
      round.responses[teacher.id] = decision;
      sendJson(res, 200, ultimatumTeacherState(origin));
      return;
    }

    sendJson(res, 409, { error: "Teacher has no active role this round." });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/ultimatum/student/join") {
    const body = await getRequestBody(req);
    const token = typeof body.token === "string" ? body.token : "";
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 30) : "";
    const normalized = normalizeName(name);

    if (ultimatumState.status === "setup") {
      sendJson(res, 409, {
        error: "The teacher has not saved the ultimatum settings yet.",
      });
      return;
    }

    if (!name) {
      sendJson(res, 400, { error: "Please enter your name or alias." });
      return;
    }

    let participant = token ? getUltimatumParticipantByToken(token) : null;
    if (participant) {
      sendJson(res, 200, {
        token: participant.token,
        id: participant.id,
        name: participant.name,
        sessionCode: ultimatumState.sessionCode,
      });
      return;
    }

    const sameNameParticipant = ultimatumState.participants.find(
      (item) => item.joined && !item.isTeacher && normalizeName(item.name) === normalized
    );
    if (sameNameParticipant) {
      sendJson(res, 200, {
        token: sameNameParticipant.token,
        id: sameNameParticipant.id,
        name: sameNameParticipant.name,
        sessionCode: ultimatumState.sessionCode,
        rejoined: true,
      });
      return;
    }

    if (!(ultimatumState.status === "lobby" && ultimatumState.currentRound === 0)) {
      sendJson(res, 409, {
        error: "New players can only join before Round 1 starts.",
      });
      return;
    }

    const available = shuffle(
      ultimatumState.participants.filter((item) => !item.joined && !item.isTeacher)
    );
    participant = available[0] || null;
    if (!participant) {
      sendJson(res, 409, { error: "All participant slots are already full." });
      return;
    }

    participant.token = crypto.randomUUID();
    participant.joined = true;
    participant.name = name;
    sendJson(res, 200, {
      token: participant.token,
      id: participant.id,
      name: participant.name,
      sessionCode: ultimatumState.sessionCode,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/ultimatum/student/state") {
    const token = url.searchParams.get("token") || "";
    const participant = getUltimatumParticipantByToken(token);
    if (!participant) {
      sendJson(res, 404, { error: "ID not found. Please rejoin." });
      return;
    }

    const round = getUltimatumRound();
    const role =
      round && participant.joined
        ? getUltimatumRoleForParticipant(participant.id, round.number)
        : null;
    const pair =
      round?.pairs.find(
        (item) =>
          item.proposerId === participant.id || item.responderId === participant.id
      ) || null;

    sendJson(res, 200, {
      ...ultimatumBaseState(origin),
      participant: {
        id: participant.id,
        name: participant.name,
        cumulative: participant.cumulative,
        history: participant.history,
      },
      currentRoundDetail: round
        ? {
            number: round.number,
            stage: round.stage,
            status: round.status,
            role,
            canSubmitOffer:
              role === "proposer" &&
              round.status === "proposer_collecting" &&
              round.offers[participant.id] == null,
            canSubmitResponse:
              role === "responder" &&
              round.status === "responder_collecting" &&
              !round.responses[participant.id],
            submittedOffer: round.offers[participant.id] ?? null,
            receivedOffer:
              role === "responder"
                ? round.pendingResponseOffers[participant.id] ?? pair?.offer ?? null
                : null,
            submittedResponse: round.responses[participant.id] || null,
            settledPair:
              round.status === "closed" && pair
                ? {
                    offer: pair.offer,
                    accepted: pair.accepted,
                    payoff:
                      role === "proposer"
                        ? pair.proposerPayoff
                        : pair.responderPayoff,
                  }
                : null,
          }
        : null,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/ultimatum/student/submit-offer") {
    const body = await getRequestBody(req);
    const token = typeof body.token === "string" ? body.token : "";
    const offer = Number(body.offer);
    const participant = getUltimatumParticipantByToken(token);
    const round = getUltimatumRound();

    if (!participant) {
      sendJson(res, 404, { error: "ID not found. Please rejoin." });
      return;
    }
    if (!round || round.status !== "proposer_collecting") {
      sendJson(res, 409, { error: "The proposer stage is not open." });
      return;
    }
    if (getUltimatumRoleForParticipant(participant.id, round.number) !== "proposer") {
      sendJson(res, 409, { error: "You are not a proposer this round." });
      return;
    }
    if (!Number.isInteger(offer) || offer < 0 || offer > ultimatumState.settings.pieSize) {
      sendJson(res, 400, {
        error: `Offer must be an integer between 0 and ${ultimatumState.settings.pieSize}.`,
      });
      return;
    }
    if (round.offers[participant.id] != null) {
      sendJson(res, 409, { error: "You have already submitted this round." });
      return;
    }

    round.offers[participant.id] = offer;
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/ultimatum/student/submit-response") {
    const body = await getRequestBody(req);
    const token = typeof body.token === "string" ? body.token : "";
    const decision = body.decision;
    const participant = getUltimatumParticipantByToken(token);
    const round = getUltimatumRound();

    if (!participant) {
      sendJson(res, 404, { error: "ID not found. Please rejoin." });
      return;
    }
    if (!round || round.status !== "responder_collecting") {
      sendJson(res, 409, { error: "The responder stage is not open." });
      return;
    }
    if (getUltimatumRoleForParticipant(participant.id, round.number) !== "responder") {
      sendJson(res, 409, { error: "You are not a responder this round." });
      return;
    }
    if (!["accept", "reject"].includes(decision)) {
      sendJson(res, 400, { error: "Decision must be accept or reject." });
      return;
    }
    if (round.responses[participant.id]) {
      sendJson(res, 409, { error: "You have already submitted this round." });
      return;
    }

    round.responses[participant.id] = decision;
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { error: "Endpoint not found." });
}

async function handleApi(req, res, url) {
  if (url.pathname.startsWith("/api/ultimatum/")) {
    await handleUltimatumApi(req, res, url);
    return;
  }
  await handlePublicGoodsApi(req, res, url);
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
    sendJson(res, 500, { error: error.message || "Server error." });
  }
});

server.listen(PORT, () => {
  console.log(`Classroom games app running on http://localhost:${PORT}`);
});
