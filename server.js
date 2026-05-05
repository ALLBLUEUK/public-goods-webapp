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

const MILK_TEA_STATIONS = [
  "Order",
  "Toppings",
  "Shake",
  "Seal",
  "Pack",
  "Pickup",
];

function createMilkTeaPlayers(count) {
  return Array.from({ length: count }, (_, index) => ({
    seat: index + 1,
    station: MILK_TEA_STATIONS[index] || `Station ${index + 1}`,
    name: "",
    token: "",
    joinedAt: "",
    cumulative: 0,
    history: [],
  }));
}

function freshMilkTeaState() {
  const defaults = {
    seatCount: 6,
    maxRounds: 5,
    maxSpeed: 7,
    bonusPerShopSpeed: 2,
    costPerOwnSpeed: 1,
  };

  return {
    sessionId: crypto.randomUUID(),
    sessionCode: randomCode(),
    status: "setup",
    currentRound: 0,
    createdAt: new Date().toISOString(),
    settings: defaults,
    players: createMilkTeaPlayers(defaults.seatCount),
    rounds: [],
  };
}

let milkTeaState = freshMilkTeaState();

function getMilkTeaRound() {
  return milkTeaState.rounds[milkTeaState.currentRound - 1] || null;
}

function milkTeaPlayerByToken(token) {
  return milkTeaState.players.find((player) => player.token === token) || null;
}

function validateMilkTeaSettings(settings) {
  const seatCount = Number(settings.seatCount);
  const maxRounds = Number(settings.maxRounds);
  const maxSpeed = Number(settings.maxSpeed);
  const bonusPerShopSpeed = Number(settings.bonusPerShopSpeed);
  const costPerOwnSpeed = Number(settings.costPerOwnSpeed);

  if (!Number.isInteger(seatCount) || seatCount < 2 || seatCount > 6) {
    throw new Error("Players must be an integer between 2 and 6.");
  }
  if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 10) {
    throw new Error("Rounds must be an integer between 1 and 10.");
  }
  if (!Number.isInteger(maxSpeed) || maxSpeed < 3 || maxSpeed > 9) {
    throw new Error("Top speed must be an integer between 3 and 9.");
  }
  if (
    !Number.isInteger(bonusPerShopSpeed) ||
    bonusPerShopSpeed < 1 ||
    bonusPerShopSpeed > 20
  ) {
    throw new Error("Team bonus per shop speed must be an integer between 1 and 20.");
  }
  if (
    !Number.isInteger(costPerOwnSpeed) ||
    costPerOwnSpeed < 0 ||
    costPerOwnSpeed > 10
  ) {
    throw new Error("Tiredness cost per own speed must be an integer between 0 and 10.");
  }

  return {
    seatCount,
    maxRounds,
    maxSpeed,
    bonusPerShopSpeed,
    costPerOwnSpeed,
  };
}

function milkTeaRoundSummary(round) {
  if (!round) {
    return null;
  }
  return {
    number: round.number,
    status: round.status,
    submittedCount: round.submissions.length,
    actualSpeed: round.status === "closed" ? round.actualSpeed : null,
    averageChoice: round.status === "closed" ? round.averageChoice : null,
    teamBonus: round.status === "closed" ? round.teamBonus : null,
  };
}

function milkTeaRanking() {
  return milkTeaState.players
    .filter((player) => player.token)
    .map((player) => ({
      seat: player.seat,
      station: player.station,
      cumulative: player.cumulative,
      roundsPlayed: player.history.length,
    }))
    .sort((a, b) => b.cumulative - a.cumulative || a.seat - b.seat);
}

function milkTeaBaseState(origin) {
  return {
    sessionId: milkTeaState.sessionId,
    sessionCode: milkTeaState.sessionCode,
    status: milkTeaState.status,
    currentRound: milkTeaState.currentRound,
    settings: milkTeaState.settings,
    joinedCount: milkTeaState.players.filter((player) => player.token).length,
    joinUrl: `${origin}/milk-tea.html?role=student`,
    teacherUrl: `${origin}/milk-tea.html?role=teacher`,
    players: milkTeaState.players.map((player) => ({
      seat: player.seat,
      station: player.station,
      name: player.name,
      joined: Boolean(player.token),
      cumulative: player.cumulative,
    })),
    currentRoundSummary: milkTeaRoundSummary(getMilkTeaRound()),
    roundHistory: milkTeaState.rounds
      .filter((round) => round.status === "closed")
      .map((round) => ({
        number: round.number,
        actualSpeed: round.actualSpeed,
        averageChoice: round.averageChoice,
        teamBonus: round.teamBonus,
        submittedCount: round.submissions.length,
      })),
    ranking: milkTeaRanking(),
  };
}

function milkTeaTeacherState(origin) {
  const round = getMilkTeaRound();
  return {
    ...milkTeaBaseState(origin),
    currentRoundSummary: round
      ? {
          number: round.number,
          status: round.status,
          submittedCount: round.submissions.length,
          actualSpeed: round.actualSpeed,
          averageChoice: round.averageChoice,
          teamBonus: round.teamBonus,
          submissions: round.submissions.map((item) => ({
            seat: item.seat,
            speed: item.speed,
          })),
          resolvedChoices: round.resolvedChoices || [],
        }
      : null,
    players: milkTeaState.players.map((player) => ({
      seat: player.seat,
      station: player.station,
      name: player.name,
      joined: Boolean(player.token),
      cumulative: player.cumulative,
      history: player.history,
    })),
  };
}

function resetMilkTeaSession() {
  milkTeaState = freshMilkTeaState();
}

function applyMilkTeaRoundResults(round) {
  const { bonusPerShopSpeed, costPerOwnSpeed } = milkTeaState.settings;
  const activePlayers = milkTeaState.players.filter((player) => player.token);
  const resolvedChoices = activePlayers.map((player) => {
    const submission = round.submissions.find((item) => item.seat === player.seat);
    return {
      seat: player.seat,
      station: player.station,
      speed: submission ? submission.speed : 1,
      defaulted: !submission,
    };
  });

  round.actualSpeed = resolvedChoices.length
    ? Math.min(...resolvedChoices.map((item) => item.speed))
    : 1;
  round.averageChoice = average(resolvedChoices.map((item) => item.speed));
  round.teamBonus = round.actualSpeed * bonusPerShopSpeed;
  round.resolvedChoices = resolvedChoices.map((item) => ({
    ...item,
    personalCost: item.speed * costPerOwnSpeed,
    takeHome: round.teamBonus - item.speed * costPerOwnSpeed,
  }));
  round.status = "closed";
  round.closedAt = new Date().toISOString();

  for (const player of activePlayers) {
    const choice = round.resolvedChoices.find((item) => item.seat === player.seat);
    player.cumulative += choice.takeHome;
    player.history.push({
      round: round.number,
      station: player.station,
      selectedSpeed: choice.speed,
      defaulted: choice.defaulted,
      actualSpeed: round.actualSpeed,
      averageChoice: round.averageChoice,
      teamBonus: round.teamBonus,
      personalCost: choice.personalCost,
      takeHome: choice.takeHome,
      cumulative: player.cumulative,
    });
  }

  if (round.number >= milkTeaState.settings.maxRounds) {
    milkTeaState.status = "finished";
  } else {
    milkTeaState.status = "results";
  }
}

const NIGHT_MARKET_STALLS = [
  "Lemon Tea",
  "Takoyaki",
  "Fried Chicken",
  "Grilled Sausage",
  "Roast Corn",
  "Cotton Candy",
];

function createNightMarketPlayers(count) {
  return Array.from({ length: count }, (_, index) => ({
    seat: index + 1,
    stall: NIGHT_MARKET_STALLS[index] || `Stall ${index + 1}`,
    name: "",
    token: "",
    joinedAt: "",
    cumulative: 0,
    history: [],
  }));
}

function freshNightMarketState() {
  const defaults = {
    seatCount: 6,
    maxRounds: 5,
    maxHours: 4,
    baseRevenuePerHour: 16,
    crowdPenalty: 3,
    hourlyCost: 5,
    stallFee: 2,
  };

  return {
    sessionId: crypto.randomUUID(),
    sessionCode: randomCode(),
    status: "setup",
    currentRound: 0,
    createdAt: new Date().toISOString(),
    settings: defaults,
    players: createNightMarketPlayers(defaults.seatCount),
    rounds: [],
  };
}

let nightMarketState = freshNightMarketState();

function getNightMarketRound() {
  return nightMarketState.rounds[nightMarketState.currentRound - 1] || null;
}

function nightMarketPlayerByToken(token) {
  return nightMarketState.players.find((player) => player.token === token) || null;
}

function validateNightMarketSettings(settings) {
  const seatCount = Number(settings.seatCount);
  const maxRounds = Number(settings.maxRounds);
  const maxHours = Number(settings.maxHours);
  const baseRevenuePerHour = Number(settings.baseRevenuePerHour);
  const crowdPenalty = Number(settings.crowdPenalty);
  const hourlyCost = Number(settings.hourlyCost);
  const stallFee = Number(settings.stallFee);

  if (!Number.isInteger(seatCount) || seatCount < 2 || seatCount > 6) {
    throw new Error("Players must be an integer between 2 and 6.");
  }
  if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 10) {
    throw new Error("Rounds must be an integer between 1 and 10.");
  }
  if (!Number.isInteger(maxHours) || maxHours < 1 || maxHours > 8) {
    throw new Error("Open hours must be an integer between 1 and 8.");
  }
  if (
    !Number.isInteger(baseRevenuePerHour) ||
    baseRevenuePerHour < 1 ||
    baseRevenuePerHour > 50
  ) {
    throw new Error("Base revenue per hour must be an integer between 1 and 50.");
  }
  if (!Number.isInteger(crowdPenalty) || crowdPenalty < 0 || crowdPenalty > 20) {
    throw new Error("Crowding penalty must be an integer between 0 and 20.");
  }
  if (!Number.isInteger(hourlyCost) || hourlyCost < 0 || hourlyCost > 20) {
    throw new Error("Hourly running cost must be an integer between 0 and 20.");
  }
  if (!Number.isInteger(stallFee) || stallFee < 0 || stallFee > 30) {
    throw new Error("Stall fee must be an integer between 0 and 30.");
  }

  return {
    seatCount,
    maxRounds,
    maxHours,
    baseRevenuePerHour,
    crowdPenalty,
    hourlyCost,
    stallFee,
  };
}

function nightMarketRevenuePerHour(
  entrantCount,
  settings = nightMarketState.settings
) {
  if (entrantCount <= 0) {
    return 0;
  }
  return Math.max(
    0,
    settings.baseRevenuePerHour - settings.crowdPenalty * (entrantCount - 1)
  );
}

function nightMarketReferenceTable(settings = nightMarketState.settings) {
  return Array.from({ length: settings.seatCount }, (_, index) => ({
    entrants: index + 1,
    revenuePerHour: nightMarketRevenuePerHour(index + 1, settings),
  }));
}

function nightMarketRoundSummary(round) {
  if (!round) {
    return null;
  }
  return {
    number: round.number,
    status: round.status,
    submittedCount: round.submissions.length,
    entrantsCount: round.status === "closed" ? round.entrantsCount : null,
    revenuePerHour: round.status === "closed" ? round.revenuePerHour : null,
    averageHours: round.status === "closed" ? round.averageHours : null,
    totalOpenHours: round.status === "closed" ? round.totalOpenHours : null,
  };
}

function nightMarketRanking() {
  return nightMarketState.players
    .filter((player) => player.token)
    .map((player) => ({
      seat: player.seat,
      stall: player.stall,
      cumulative: player.cumulative,
      roundsPlayed: player.history.length,
    }))
    .sort((a, b) => b.cumulative - a.cumulative || a.seat - b.seat);
}

function nightMarketBaseState(origin) {
  return {
    sessionId: nightMarketState.sessionId,
    sessionCode: nightMarketState.sessionCode,
    status: nightMarketState.status,
    currentRound: nightMarketState.currentRound,
    settings: nightMarketState.settings,
    joinedCount: nightMarketState.players.filter((player) => player.token).length,
    joinUrl: `${origin}/night-market.html?role=student`,
    teacherUrl: `${origin}/night-market.html?role=teacher`,
    referenceTable: nightMarketReferenceTable(),
    players: nightMarketState.players.map((player) => ({
      seat: player.seat,
      stall: player.stall,
      name: player.name,
      joined: Boolean(player.token),
      cumulative: player.cumulative,
    })),
    currentRoundSummary: nightMarketRoundSummary(getNightMarketRound()),
    roundHistory: nightMarketState.rounds
      .filter((round) => round.status === "closed")
      .map((round) => ({
        number: round.number,
        entrantsCount: round.entrantsCount,
        revenuePerHour: round.revenuePerHour,
        averageHours: round.averageHours,
        totalOpenHours: round.totalOpenHours,
        submittedCount: round.submissions.length,
      })),
    ranking: nightMarketRanking(),
  };
}

function nightMarketTeacherState(origin) {
  const round = getNightMarketRound();
  return {
    ...nightMarketBaseState(origin),
    currentRoundSummary: round
      ? {
          number: round.number,
          status: round.status,
          submittedCount: round.submissions.length,
          entrantsCount: round.entrantsCount,
          revenuePerHour: round.revenuePerHour,
          averageHours: round.averageHours,
          totalOpenHours: round.totalOpenHours,
          submissions: round.submissions.map((item) => ({
            seat: item.seat,
            enter: item.enter,
            hours: item.hours,
          })),
          resolvedChoices: round.resolvedChoices || [],
        }
      : null,
    players: nightMarketState.players.map((player) => ({
      seat: player.seat,
      stall: player.stall,
      name: player.name,
      joined: Boolean(player.token),
      cumulative: player.cumulative,
      history: player.history,
    })),
  };
}

function resetNightMarketSession() {
  nightMarketState = freshNightMarketState();
}

function applyNightMarketRoundResults(round) {
  const { hourlyCost, stallFee } = nightMarketState.settings;
  const activePlayers = nightMarketState.players.filter((player) => player.token);
  const resolvedChoices = activePlayers.map((player) => {
    const submission = round.submissions.find((item) => item.seat === player.seat);
    return {
      seat: player.seat,
      stall: player.stall,
      enter: submission ? submission.enter : false,
      hours: submission && submission.enter ? submission.hours : 0,
      defaulted: !submission,
    };
  });

  round.entrantsCount = resolvedChoices.filter((item) => item.enter).length;
  round.revenuePerHour = nightMarketRevenuePerHour(round.entrantsCount);
  round.averageHours = round.entrantsCount
    ? average(resolvedChoices.filter((item) => item.enter).map((item) => item.hours))
    : 0;
  round.totalOpenHours = resolvedChoices.reduce((sum, item) => sum + item.hours, 0);
  round.resolvedChoices = resolvedChoices.map((item) => {
    const grossRevenue = item.enter ? round.revenuePerHour * item.hours : 0;
    const runningCost = item.enter ? hourlyCost * item.hours : 0;
    const paidStallFee = item.enter ? stallFee : 0;
    const takeHome = grossRevenue - runningCost - paidStallFee;
    return {
      ...item,
      grossRevenue,
      runningCost,
      stallFee: paidStallFee,
      takeHome,
    };
  });
  round.status = "closed";
  round.closedAt = new Date().toISOString();

  for (const player of activePlayers) {
    const choice = round.resolvedChoices.find((item) => item.seat === player.seat);
    player.cumulative += choice.takeHome;
    player.history.push({
      round: round.number,
      stall: player.stall,
      entered: choice.enter,
      openHours: choice.hours,
      defaulted: choice.defaulted,
      entrantsCount: round.entrantsCount,
      revenuePerHour: round.revenuePerHour,
      grossRevenue: choice.grossRevenue,
      runningCost: choice.runningCost,
      stallFee: choice.stallFee,
      takeHome: choice.takeHome,
      cumulative: player.cumulative,
    });
  }

  if (round.number >= nightMarketState.settings.maxRounds) {
    nightMarketState.status = "finished";
  } else {
    nightMarketState.status = "results";
  }
}

function createBankRunPlayers(count) {
  return Array.from({ length: count }, (_, index) => ({
    seat: index + 1,
    name: "",
    token: "",
    joinedAt: "",
    signal: "",
    status: "waiting",
    resolvedDay: null,
    cumulative: 0,
    history: [],
  }));
}

function drawBankRunRumorState() {
  return Math.random() < 0.5 ? "calm" : "nervous";
}

function freshBankRunState() {
  const defaults = {
    seatCount: 6,
    daysUntilMaturity: 3,
    depositAmount: 100,
    maturityPayout: 150,
    liquiditySlots: 3,
    rumorAccuracy: 75,
  };

  return {
    sessionId: crypto.randomUUID(),
    sessionCode: randomCode(),
    status: "setup",
    currentDay: 0,
    createdAt: new Date().toISOString(),
    settings: defaults,
    rumorState: drawBankRunRumorState(),
    bankOutcome: "pending",
    successfulWithdrawals: 0,
    players: createBankRunPlayers(defaults.seatCount),
    days: [],
  };
}

let bankRunState = freshBankRunState();

function getBankRunDay() {
  return bankRunState.days[bankRunState.currentDay - 1] || null;
}

function bankRunPlayerByToken(token) {
  return bankRunState.players.find((player) => player.token === token) || null;
}

function bankRunActivePlayers() {
  return bankRunState.players.filter(
    (player) => player.token && player.status === "waiting"
  );
}

function bankRunRemainingLiquidity() {
  return Math.max(0, bankRunState.settings.liquiditySlots - bankRunState.successfulWithdrawals);
}

function drawBankRunSignal() {
  const accurate = Math.random() < bankRunState.settings.rumorAccuracy / 100;
  if (bankRunState.rumorState === "calm") {
    return accurate ? "calm" : "warning";
  }
  return accurate ? "warning" : "calm";
}

function validateBankRunSettings(settings) {
  const seatCount = Number(settings.seatCount);
  const daysUntilMaturity = Number(settings.daysUntilMaturity);
  const depositAmount = Number(settings.depositAmount);
  const maturityPayout = Number(settings.maturityPayout);
  const liquiditySlots = Number(settings.liquiditySlots);
  const rumorAccuracy = Number(settings.rumorAccuracy);

  if (!Number.isInteger(seatCount) || seatCount < 2 || seatCount > 6) {
    throw new Error("Players must be an integer between 2 and 6.");
  }
  if (!Number.isInteger(daysUntilMaturity) || daysUntilMaturity < 2 || daysUntilMaturity > 6) {
    throw new Error("Days until maturity must be an integer between 2 and 6.");
  }
  if (!Number.isInteger(depositAmount) || depositAmount < 10 || depositAmount > 1000) {
    throw new Error("Deposit amount must be an integer between 10 and 1000.");
  }
  if (
    !Number.isInteger(maturityPayout) ||
    maturityPayout <= depositAmount ||
    maturityPayout > 2000
  ) {
    throw new Error("Maturity payout must be an integer greater than the deposit and at most 2000.");
  }
  if (
    !Number.isInteger(liquiditySlots) ||
    liquiditySlots < 1 ||
    liquiditySlots >= seatCount
  ) {
    throw new Error("Early cash slots must be at least 1 and smaller than the number of players.");
  }
  if (!Number.isInteger(rumorAccuracy) || rumorAccuracy < 55 || rumorAccuracy > 95) {
    throw new Error("Rumor accuracy must be an integer between 55 and 95.");
  }

  return {
    seatCount,
    daysUntilMaturity,
    depositAmount,
    maturityPayout,
    liquiditySlots,
    rumorAccuracy,
  };
}

function bankRunDaySummary(day) {
  if (!day) {
    return null;
  }
  return {
    number: day.number,
    status: day.status,
    submittedCount: day.submissions.length,
    attemptedWithdrawals: day.status === "closed" ? day.attemptedWithdrawals : null,
    successfulToday: day.status === "closed" ? day.successfulToday : null,
    defaultWaitCount: day.status === "closed" ? day.defaultWaitCount : null,
    remainingLiquidityBefore: day.status === "closed" ? day.remainingLiquidityBefore : null,
    remainingLiquidityAfter: day.status === "closed" ? day.remainingLiquidityAfter : null,
    bankCollapsedToday: day.status === "closed" ? day.bankCollapsedToday : false,
  };
}

function bankRunRanking() {
  return bankRunState.players
    .filter((player) => player.token)
    .map((player) => ({
      seat: player.seat,
      cumulative: player.cumulative,
      status: player.status,
    }))
    .sort((a, b) => b.cumulative - a.cumulative || a.seat - b.seat);
}

function bankRunBaseState(origin) {
  return {
    sessionId: bankRunState.sessionId,
    sessionCode: bankRunState.sessionCode,
    status: bankRunState.status,
    currentDay: bankRunState.currentDay,
    settings: bankRunState.settings,
    bankOutcome: bankRunState.bankOutcome,
    successfulWithdrawals: bankRunState.successfulWithdrawals,
    remainingLiquidity: bankRunRemainingLiquidity(),
    joinedCount: bankRunState.players.filter((player) => player.token).length,
    activeCount: bankRunActivePlayers().length,
    joinUrl: `${origin}/bank-run.html?role=student`,
    teacherUrl: `${origin}/bank-run.html?role=teacher`,
    rumorStateReveal:
      bankRunState.status === "finished" || bankRunState.status === "failed"
        ? bankRunState.rumorState
        : null,
    players: bankRunState.players.map((player) => ({
      seat: player.seat,
      name: player.name,
      joined: Boolean(player.token),
      signal: player.signal,
      status: player.status,
      resolvedDay: player.resolvedDay,
      cumulative: player.cumulative,
    })),
    currentDaySummary: bankRunDaySummary(getBankRunDay()),
    dayHistory: bankRunState.days
      .filter((day) => day.status === "closed")
      .map((day) => ({
        number: day.number,
        attemptedWithdrawals: day.attemptedWithdrawals,
        successfulToday: day.successfulToday,
        defaultWaitCount: day.defaultWaitCount,
        remainingLiquidityAfter: day.remainingLiquidityAfter,
        bankCollapsedToday: day.bankCollapsedToday,
      })),
    ranking: bankRunRanking(),
  };
}

function bankRunTeacherState(origin) {
  const day = getBankRunDay();
  return {
    ...bankRunBaseState(origin),
    currentDaySummary: day
      ? {
          number: day.number,
          status: day.status,
          submittedCount: day.submissions.length,
          attemptedWithdrawals: day.attemptedWithdrawals,
          successfulToday: day.successfulToday,
          defaultWaitCount: day.defaultWaitCount,
          remainingLiquidityBefore: day.remainingLiquidityBefore,
          remainingLiquidityAfter: day.remainingLiquidityAfter,
          bankCollapsedToday: day.bankCollapsedToday,
          submissions: day.submissions.map((item) => ({
            seat: item.seat,
            action: item.action,
          })),
          resolvedChoices: day.resolvedChoices || [],
        }
      : null,
    players: bankRunState.players.map((player) => ({
      seat: player.seat,
      name: player.name,
      joined: Boolean(player.token),
      signal: player.signal,
      status: player.status,
      resolvedDay: player.resolvedDay,
      cumulative: player.cumulative,
      history: player.history,
    })),
  };
}

function resetBankRunSession() {
  bankRunState = freshBankRunState();
}

function applyBankRunDayResults(day) {
  const { depositAmount, maturityPayout } = bankRunState.settings;
  const activePlayers = bankRunActivePlayers();
  const resolvedChoices = activePlayers.map((player) => {
    const submission = day.submissions.find((item) => item.seat === player.seat);
    return {
      seat: player.seat,
      action: submission ? submission.action : "wait",
      defaulted: !submission,
      queueRank: null,
      payoff: 0,
      outcome: "wait",
    };
  });

  const withdrawers = shuffle(
    resolvedChoices
      .filter((item) => item.action === "withdraw")
      .map((item) => item.seat)
  );
  const remainingLiquidityBefore = bankRunRemainingLiquidity();
  const successfulToday = Math.min(remainingLiquidityBefore, withdrawers.length);
  const successfulSeats = new Set(withdrawers.slice(0, successfulToday));

  day.remainingLiquidityBefore = remainingLiquidityBefore;
  day.attemptedWithdrawals = withdrawers.length;
  day.successfulToday = successfulToday;
  day.defaultWaitCount = resolvedChoices.filter((item) => item.defaulted).length;
  day.bankCollapsedToday = withdrawers.length > remainingLiquidityBefore;

  for (const [index, seat] of withdrawers.entries()) {
    const choice = resolvedChoices.find((item) => item.seat === seat);
    choice.queueRank = index + 1;
  }

  for (const choice of resolvedChoices) {
    if (choice.action === "withdraw" && successfulSeats.has(choice.seat)) {
      choice.outcome = "withdrew";
      choice.payoff = depositAmount;
    } else if (choice.action === "withdraw" && day.bankCollapsedToday) {
      choice.outcome = "too_late";
      choice.payoff = 0;
    } else if (day.bankCollapsedToday) {
      choice.outcome = "lost";
      choice.payoff = 0;
    } else if (day.number >= bankRunState.settings.daysUntilMaturity) {
      choice.outcome = "maturity";
      choice.payoff = maturityPayout;
    } else {
      choice.outcome = "wait";
      choice.payoff = 0;
    }
  }

  day.resolvedChoices = resolvedChoices;
  day.status = "closed";
  day.closedAt = new Date().toISOString();

  bankRunState.successfulWithdrawals += successfulToday;
  day.remainingLiquidityAfter = bankRunRemainingLiquidity();

  for (const player of activePlayers) {
    const choice = resolvedChoices.find((item) => item.seat === player.seat);
    player.cumulative += choice.payoff;
    player.history.push({
      day: day.number,
      action: choice.action,
      defaulted: choice.defaulted,
      queueRank: choice.queueRank,
      outcome: choice.outcome,
      payoff: choice.payoff,
      cumulative: player.cumulative,
      signal: player.signal,
    });

    if (choice.outcome === "withdrew") {
      player.status = "withdrew";
      player.resolvedDay = day.number;
    } else if (choice.outcome === "maturity") {
      player.status = "matured";
      player.resolvedDay = day.number;
    } else if (choice.outcome === "too_late" || choice.outcome === "lost") {
      player.status = "lost";
      player.resolvedDay = day.number;
    }
  }

  if (day.bankCollapsedToday) {
    bankRunState.status = "failed";
    bankRunState.bankOutcome = "collapsed";
  } else if (day.number >= bankRunState.settings.daysUntilMaturity) {
    bankRunState.status = "finished";
    bankRunState.bankOutcome = "matured";
  } else {
    bankRunState.status = "results";
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

  if (!Number.isInteger(studentCount) || studentCount < 1 || studentCount > 40) {
    throw new Error("Student count must be an integer between 1 and 40.");
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

function createUsedCarParticipants(count, teacherJoinsIfOdd) {
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

function defaultUsedCarGoodCount(studentCount, teacherJoinsIfOdd) {
  const totalPlayers = studentCount + (studentCount % 2 === 1 && teacherJoinsIfOdd ? 1 : 0);
  const sellers = totalPlayers / 2;
  return Math.max(1, Math.floor(sellers / 2));
}

function freshUsedCarState() {
  const defaults = {
    studentCount: 6,
    phaseRounds: 2,
    pieSize: 10,
    teacherJoinsIfOdd: true,
    goodCarCount: defaultUsedCarGoodCount(6, true),
    buyerValueGood: 10,
    buyerValueLemon: 4,
    sellerKeepGood: 8,
    sellerKeepLemon: 2,
  };

  return {
    sessionId: crypto.randomUUID(),
    sessionCode: randomCode(),
    createdAt: new Date().toISOString(),
    status: "setup",
    currentRound: 0,
    currentStage: 1,
    settings: defaults,
    participants: createUsedCarParticipants(
      defaults.studentCount,
      defaults.teacherJoinsIfOdd
    ),
    stageRoles: {
      1: { buyers: [], sellers: [], qualities: {} },
      2: { buyers: [], sellers: [], qualities: {} },
    },
    rounds: [],
  };
}

let usedCarState = freshUsedCarState();

function totalUsedCarRounds() {
  return usedCarState.settings.phaseRounds * 2;
}

function usedCarSellerCount(settings = usedCarState.settings) {
  const totalPlayers =
    settings.studentCount +
    (settings.studentCount % 2 === 1 && settings.teacherJoinsIfOdd ? 1 : 0);
  return totalPlayers / 2;
}

function validateUsedCarSettings(settings) {
  const studentCount = Number(settings.studentCount);
  const phaseRounds = Number(settings.phaseRounds);
  const pieSize = Number(settings.pieSize);
  const teacherJoinsIfOdd = Boolean(settings.teacherJoinsIfOdd);
  const buyerValueGood = Number(settings.buyerValueGood);
  const buyerValueLemon = Number(settings.buyerValueLemon);
  const sellerKeepGood = Number(settings.sellerKeepGood);
  const sellerKeepLemon = Number(settings.sellerKeepLemon);

  if (!Number.isInteger(studentCount) || studentCount < 1 || studentCount > 40) {
    throw new Error("Student count must be an integer between 1 and 40.");
  }
  if (!Number.isInteger(phaseRounds) || phaseRounds < 1 || phaseRounds > 4) {
    throw new Error("Rounds per phase must be an integer between 1 and 4.");
  }
  if (!Number.isInteger(pieSize) || pieSize < 1 || pieSize > 100) {
    throw new Error("Bid ceiling must be an integer between 1 and 100.");
  }
  if (studentCount % 2 === 1 && !teacherJoinsIfOdd) {
    throw new Error("If student count is odd, enable teacher participation to make the total even.");
  }
  for (const [label, value] of [
    ["Buyer value of a good car", buyerValueGood],
    ["Buyer value of a lemon", buyerValueLemon],
    ["Seller keep value of a good car", sellerKeepGood],
    ["Seller keep value of a lemon", sellerKeepLemon],
  ]) {
    if (!Number.isFinite(value) || value < -100 || value > 100) {
      throw new Error(`${label} must be between -100 and 100.`);
    }
  }

  const sellers = usedCarSellerCount({ studentCount, teacherJoinsIfOdd });
  const rawGoodCarCount =
    settings.goodCarCount == null || settings.goodCarCount === ""
      ? defaultUsedCarGoodCount(studentCount, teacherJoinsIfOdd)
      : Number(settings.goodCarCount);
  if (!Number.isInteger(rawGoodCarCount) || rawGoodCarCount < 0 || rawGoodCarCount > sellers) {
    throw new Error(`Good car count must be an integer between 0 and ${sellers}.`);
  }

  return {
    studentCount,
    phaseRounds,
    pieSize,
    teacherJoinsIfOdd,
    goodCarCount: rawGoodCarCount,
    buyerValueGood,
    buyerValueLemon,
    sellerKeepGood,
    sellerKeepLemon,
  };
}

function resetUsedCarSession() {
  usedCarState = freshUsedCarState();
}

function getUsedCarParticipantByToken(token) {
  return usedCarState.participants.find((item) => item.token === token) || null;
}

function getUsedCarActiveParticipants() {
  return usedCarState.participants.filter((item) => item.joined);
}

function getUsedCarOpenIds() {
  return usedCarState.participants
    .filter((item) => !item.joined && !item.isTeacher)
    .map((item) => item.id);
}

function assignUsedCarQualities(sellerIds) {
  const qualityPool = [
    ...Array.from({ length: usedCarState.settings.goodCarCount }, () => "good"),
    ...Array.from(
      { length: sellerIds.length - usedCarState.settings.goodCarCount },
      () => "lemon"
    ),
  ];
  const shuffledQualities = shuffle(qualityPool);
  const qualities = {};
  sellerIds.forEach((sellerId, index) => {
    qualities[sellerId] = shuffledQualities[index];
  });
  return qualities;
}

function assignUsedCarStageRoles() {
  const ids = getUsedCarActiveParticipants().map((item) => item.id);
  const shuffled = shuffle(ids);
  const half = shuffled.length / 2;
  const buyers = shuffled.slice(0, half).sort((a, b) => a - b);
  const sellers = shuffled.slice(half).sort((a, b) => a - b);
  usedCarState.stageRoles[1] = {
    buyers,
    sellers,
    qualities: assignUsedCarQualities(sellers),
  };
  usedCarState.stageRoles[2] = {
    buyers: [...sellers],
    sellers: [...buyers],
    qualities: assignUsedCarQualities(buyers),
  };
}

function getUsedCarStageForRound(roundNumber) {
  return roundNumber <= usedCarState.settings.phaseRounds ? 1 : 2;
}

function getUsedCarRolesForRound(roundNumber) {
  return usedCarState.stageRoles[getUsedCarStageForRound(roundNumber)];
}

function getUsedCarRoleForParticipant(participantId, roundNumber) {
  const roles = getUsedCarRolesForRound(roundNumber);
  if (roles.buyers.includes(participantId)) {
    return "buyer";
  }
  if (roles.sellers.includes(participantId)) {
    return "seller";
  }
  return null;
}

function getUsedCarRound() {
  return usedCarState.rounds[usedCarState.currentRound - 1] || null;
}

function computeUsedCarAnalysis() {
  const closedRounds = usedCarState.rounds.filter((round) => round.status === "closed");
  const allPairs = closedRounds.flatMap((round) => round.pairs);
  const bids = allPairs.map((pair) => pair.bid);
  const soldPairs = allPairs.filter((pair) => pair.sold);
  const soldGood = soldPairs.filter((pair) => pair.quality === "good");
  const soldLemon = soldPairs.filter((pair) => pair.quality === "lemon");
  const stage1Pairs = allPairs.filter((pair) => pair.stage === 1);
  const stage2Pairs = allPairs.filter((pair) => pair.stage === 2);
  const distribution = Array.from(
    { length: usedCarState.settings.pieSize + 1 },
    (_, bid) => ({
      bid,
      count: bids.filter((value) => value === bid).length,
    })
  );

  return {
    overall: {
      pairCount: allPairs.length,
      averageBid: average(bids),
      medianBid: median(bids),
      tradeRate: allPairs.length ? soldPairs.length / allPairs.length : null,
      soldGoodCount: soldGood.length,
      soldLemonCount: soldLemon.length,
      averageBuyerPayoff: average(allPairs.map((pair) => pair.buyerPayoff)),
    },
    stages: {
      1: {
        averageBid: average(stage1Pairs.map((pair) => pair.bid)),
        tradeRate: stage1Pairs.length
          ? stage1Pairs.filter((pair) => pair.sold).length / stage1Pairs.length
          : null,
      },
      2: {
        averageBid: average(stage2Pairs.map((pair) => pair.bid)),
        tradeRate: stage2Pairs.length
          ? stage2Pairs.filter((pair) => pair.sold).length / stage2Pairs.length
          : null,
      },
    },
    distribution,
    rounds: closedRounds.map((round) => ({
      round: round.number,
      stage: round.stage,
      averageBid: average(round.pairs.map((pair) => pair.bid)),
      saleCount: round.pairs.filter((pair) => pair.sold).length,
      unsoldCount: round.pairs.filter((pair) => !pair.sold).length,
      soldGoodCount: round.pairs.filter(
        (pair) => pair.sold && pair.quality === "good"
      ).length,
      soldLemonCount: round.pairs.filter(
        (pair) => pair.sold && pair.quality === "lemon"
      ).length,
      distribution: Array.from(
        { length: usedCarState.settings.pieSize + 1 },
        (_, bid) => ({
          bid,
          count: round.pairs.filter((pair) => pair.bid === bid).length,
        })
      ),
    })),
  };
}

function usedCarRanking() {
  return usedCarState.participants
    .filter((item) => item.joined && !item.isTeacher)
    .map((item) => ({
      id: item.id,
      name: item.name,
      cumulative: item.cumulative,
    }))
    .sort((a, b) => b.cumulative - a.cumulative || a.id - b.id);
}

function usedCarBaseState(origin) {
  const totalPlayers = usedCarState.participants.filter((item) => item.joined).length;
  const sellerCount = usedCarSellerCount();
  return {
    sessionId: usedCarState.sessionId,
    sessionCode: usedCarState.sessionCode,
    status: usedCarState.status,
    currentRound: usedCarState.currentRound,
    currentStage: usedCarState.currentStage,
    totalRounds: totalUsedCarRounds(),
    settings: {
      ...usedCarState.settings,
      lemonCount: sellerCount - usedCarState.settings.goodCarCount,
    },
    joinedStudentCount: usedCarState.participants.filter(
      (item) => item.joined && !item.isTeacher
    ).length,
    totalActivePlayers: totalPlayers,
    joinOpen: usedCarState.status === "lobby" && usedCarState.currentRound === 0,
    openIds: getUsedCarOpenIds(),
    teacherUrl: `${origin}/used-car.html?role=teacher`,
    joinUrl: `${origin}/used-car.html?role=student`,
    stageRoles: {
      1: {
        buyerCount: usedCarState.stageRoles[1].buyers.length,
        sellerCount: usedCarState.stageRoles[1].sellers.length,
      },
      2: {
        buyerCount: usedCarState.stageRoles[2].buyers.length,
        sellerCount: usedCarState.stageRoles[2].sellers.length,
      },
    },
    analysis: computeUsedCarAnalysis(),
    ranking: usedCarRanking(),
  };
}

function usedCarTeacherState(origin) {
  const round = getUsedCarRound();
  const teacherParticipant = usedCarState.participants.find((item) => item.isTeacher) || null;
  const teacherRole =
    teacherParticipant && usedCarState.currentRound > 0
      ? getUsedCarRoleForParticipant(teacherParticipant.id, usedCarState.currentRound)
      : null;

  return {
    ...usedCarBaseState(origin),
    participants: usedCarState.participants.map((item) => ({
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
          buyerIds: round.buyerIds,
          sellerIds: round.sellerIds,
          marketComposition: {
            goodCars: Object.values(round.sellerQualities).filter((value) => value === "good").length,
            lemons: Object.values(round.sellerQualities).filter((value) => value === "lemon").length,
          },
          submittedBids: Object.keys(round.bids).map(Number),
          submittedDecisions: Object.keys(round.sellerDecisions).map(Number),
          pendingBids: round.buyerIds.filter((id) => round.bids[id] == null),
          pendingDecisions: round.sellerIds.filter((id) => !round.sellerDecisions[id]),
          revealedPairs:
            round.status === "closed"
              ? round.pairs.map((pair, index) => ({
                  pairNumber: index + 1,
                  bid: pair.bid,
                  sold: pair.sold,
                  quality: pair.sold ? pair.quality : null,
                  buyerPayoff: pair.buyerPayoff,
                  sellerPayoff: pair.sellerPayoff,
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
            ownQuality:
              teacherRole === "seller"
                ? round?.sellerQualities?.[teacherParticipant.id] ??
                  usedCarState.stageRoles[usedCarState.currentStage]?.qualities?.[
                    teacherParticipant.id
                  ] ??
                  null
                : null,
            receivedBid:
              teacherRole === "seller"
                ? round?.pendingSellerBids?.[teacherParticipant.id] ?? null
                : null,
            hasSubmitted:
              teacherRole === "buyer"
                ? Boolean(round && round.bids[teacherParticipant.id] != null)
                : teacherRole === "seller"
                  ? Boolean(round && round.sellerDecisions[teacherParticipant.id])
                  : false,
          }
        : null,
  };
}

function startUsedCarRound() {
  if (!usedCarState.stageRoles[1].buyers.length) {
    assignUsedCarStageRoles();
  }

  const nextRound = usedCarState.currentRound + 1;
  const stage = getUsedCarStageForRound(nextRound);
  const roles = getUsedCarRolesForRound(nextRound);

  usedCarState.currentRound = nextRound;
  usedCarState.currentStage = stage;
  usedCarState.status = "buyer_collecting";
  usedCarState.rounds.push({
    number: nextRound,
    stage,
    status: "buyer_collecting",
    buyerIds: [...roles.buyers],
    sellerIds: [...roles.sellers],
    sellerQualities: { ...roles.qualities },
    bids: {},
    sellerDecisions: {},
    pendingSellerBids: {},
    pairs: [],
    openedAt: new Date().toISOString(),
    buyerClosedAt: null,
    closedAt: null,
  });
}

function closeUsedCarBuyers() {
  const round = getUsedCarRound();
  const bidsPool = shuffle(
    round.buyerIds.map((buyerId) => ({
      buyerId,
      bid: round.bids[buyerId],
    }))
  );
  const sellers = shuffle(round.sellerIds);

  round.pairs = sellers.map((sellerId, index) => ({
    round: round.number,
    stage: round.stage,
    buyerId: bidsPool[index].buyerId,
    sellerId,
    bid: bidsPool[index].bid,
    quality: round.sellerQualities[sellerId],
    sold: null,
    buyerPayoff: 0,
    sellerPayoff: 0,
  }));

  round.pendingSellerBids = {};
  for (const pair of round.pairs) {
    round.pendingSellerBids[pair.sellerId] = pair.bid;
  }

  round.status = "seller_collecting";
  round.buyerClosedAt = new Date().toISOString();
  usedCarState.status = "seller_collecting";
}

function closeUsedCarSellers() {
  const round = getUsedCarRound();
  const {
    buyerValueGood,
    buyerValueLemon,
    sellerKeepGood,
    sellerKeepLemon,
  } = usedCarState.settings;

  for (const pair of round.pairs) {
    const sold = round.sellerDecisions[pair.sellerId] === "sell";
    pair.sold = sold;
    if (sold) {
      pair.buyerPayoff =
        (pair.quality === "good" ? buyerValueGood : buyerValueLemon) - pair.bid;
      pair.sellerPayoff = pair.bid;
    } else {
      pair.buyerPayoff = 0;
      pair.sellerPayoff = pair.quality === "good" ? sellerKeepGood : sellerKeepLemon;
    }

    const buyer = usedCarState.participants.find((item) => item.id === pair.buyerId);
    const seller = usedCarState.participants.find((item) => item.id === pair.sellerId);

    buyer.cumulative += pair.buyerPayoff;
    seller.cumulative += pair.sellerPayoff;

    buyer.history.push({
      round: round.number,
      stage: round.stage,
      role: "buyer",
      bid: pair.bid,
      outcome: sold ? "bought" : "no_trade",
      quality: sold ? pair.quality : null,
      payoff: pair.buyerPayoff,
      cumulative: buyer.cumulative,
    });
    seller.history.push({
      round: round.number,
      stage: round.stage,
      role: "seller",
      bid: pair.bid,
      quality: pair.quality,
      decision: sold ? "sell" : "keep",
      payoff: pair.sellerPayoff,
      cumulative: seller.cumulative,
    });
  }

  round.status = "closed";
  round.closedAt = new Date().toISOString();
  usedCarState.status =
    usedCarState.currentRound >= totalUsedCarRounds() ? "finished" : "between_rounds";
}

async function handleUsedCarApi(req, res, url) {
  const origin = getOrigin(req);

  if (req.method === "GET" && url.pathname === "/api/used-car/meta") {
    sendJson(res, 200, usedCarBaseState(origin));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/used-car/teacher/state") {
    sendJson(res, 200, usedCarTeacherState(origin));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/used-car/teacher/reset") {
    resetUsedCarSession();
    sendJson(res, 200, usedCarTeacherState(origin));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/used-car/teacher/configure") {
    const body = await getRequestBody(req);
    if (usedCarState.currentRound > 0 || usedCarState.status !== "setup") {
      sendJson(res, 409, {
        error: "Reset first before changing settings after the session starts.",
      });
      return;
    }
    try {
      const settings = validateUsedCarSettings(body);
      usedCarState.settings = settings;
      usedCarState.participants = createUsedCarParticipants(
        settings.studentCount,
        settings.teacherJoinsIfOdd
      );
      usedCarState.status = "lobby";
      sendJson(res, 200, usedCarTeacherState(origin));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/used-car/teacher/start-round") {
    const joinedStudents = usedCarState.participants.filter(
      (item) => item.joined && !item.isTeacher
    ).length;
    if (joinedStudents !== usedCarState.settings.studentCount) {
      sendJson(res, 409, {
        error: "Wait until all students have joined before starting.",
      });
      return;
    }
    if (usedCarState.status === "buyer_collecting") {
      sendJson(res, 409, { error: "Buyer bidding is already open." });
      return;
    }
    if (usedCarState.status === "seller_collecting") {
      sendJson(res, 409, { error: "Close seller decisions first." });
      return;
    }
    if (usedCarState.currentRound >= totalUsedCarRounds()) {
      sendJson(res, 409, { error: "All used-car rounds are already finished." });
      return;
    }

    startUsedCarRound();
    sendJson(res, 200, usedCarTeacherState(origin));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/used-car/teacher/close-buyers") {
    const round = getUsedCarRound();
    if (!round || round.status !== "buyer_collecting") {
      sendJson(res, 409, { error: "There is no buyer bidding stage to close." });
      return;
    }
    const missing = round.buyerIds.filter((id) => round.bids[id] == null);
    if (missing.length) {
      sendJson(res, 409, {
        error: `These buyer IDs have not bid yet: ${missing.join(", ")}.`,
      });
      return;
    }

    closeUsedCarBuyers();
    sendJson(res, 200, usedCarTeacherState(origin));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/used-car/teacher/close-sellers") {
    const round = getUsedCarRound();
    if (!round || round.status !== "seller_collecting") {
      sendJson(res, 409, { error: "There is no seller decision stage to close." });
      return;
    }
    const missing = round.sellerIds.filter((id) => !round.sellerDecisions[id]);
    if (missing.length) {
      sendJson(res, 409, {
        error: `These seller IDs have not decided yet: ${missing.join(", ")}.`,
      });
      return;
    }

    closeUsedCarSellers();
    sendJson(res, 200, usedCarTeacherState(origin));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/used-car/teacher/submit-self") {
    const body = await getRequestBody(req);
    const round = getUsedCarRound();
    const teacher = usedCarState.participants.find((item) => item.isTeacher);
    if (!teacher || !teacher.joined) {
      sendJson(res, 409, { error: "Teacher is not participating in this session." });
      return;
    }
    if (!round) {
      sendJson(res, 409, { error: "There is no active round." });
      return;
    }

    const role = getUsedCarRoleForParticipant(teacher.id, round.number);
    if (role === "buyer") {
      const bid = Number(body.bid);
      if (!Number.isInteger(bid) || bid < 0 || bid > usedCarState.settings.pieSize) {
        sendJson(res, 400, {
          error: `Bid must be an integer between 0 and ${usedCarState.settings.pieSize}.`,
        });
        return;
      }
      if (round.status !== "buyer_collecting") {
        sendJson(res, 409, { error: "The buyer stage is not open." });
        return;
      }
      if (round.bids[teacher.id] != null) {
        sendJson(res, 409, { error: "Teacher bid has already been submitted." });
        return;
      }
      round.bids[teacher.id] = bid;
      sendJson(res, 200, usedCarTeacherState(origin));
      return;
    }

    if (role === "seller") {
      const decision = body.decision;
      if (!["sell", "keep"].includes(decision)) {
        sendJson(res, 400, { error: "Decision must be sell or keep." });
        return;
      }
      if (round.status !== "seller_collecting") {
        sendJson(res, 409, { error: "The seller stage is not open." });
        return;
      }
      if (round.sellerDecisions[teacher.id]) {
        sendJson(res, 409, { error: "Teacher decision has already been submitted." });
        return;
      }
      round.sellerDecisions[teacher.id] = decision;
      sendJson(res, 200, usedCarTeacherState(origin));
      return;
    }

    sendJson(res, 409, { error: "Teacher has no active role this round." });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/used-car/student/join") {
    const body = await getRequestBody(req);
    const token = typeof body.token === "string" ? body.token : "";
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 30) : "";
    const normalized = normalizeName(name);

    if (usedCarState.status === "setup") {
      sendJson(res, 409, {
        error: "The teacher has not saved the used-car settings yet.",
      });
      return;
    }
    if (!name) {
      sendJson(res, 400, { error: "Please enter your name or alias." });
      return;
    }

    let participant = token ? getUsedCarParticipantByToken(token) : null;
    if (participant) {
      sendJson(res, 200, {
        token: participant.token,
        id: participant.id,
        name: participant.name,
        sessionCode: usedCarState.sessionCode,
      });
      return;
    }

    const sameNameParticipant = usedCarState.participants.find(
      (item) => item.joined && !item.isTeacher && normalizeName(item.name) === normalized
    );
    if (sameNameParticipant) {
      sendJson(res, 200, {
        token: sameNameParticipant.token,
        id: sameNameParticipant.id,
        name: sameNameParticipant.name,
        sessionCode: usedCarState.sessionCode,
        rejoined: true,
      });
      return;
    }

    if (!(usedCarState.status === "lobby" && usedCarState.currentRound === 0)) {
      sendJson(res, 409, {
        error: "New players can only join before Round 1 starts.",
      });
      return;
    }

    const available = shuffle(
      usedCarState.participants.filter((item) => !item.joined && !item.isTeacher)
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
      sessionCode: usedCarState.sessionCode,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/used-car/student/state") {
    const token = url.searchParams.get("token") || "";
    const participant = getUsedCarParticipantByToken(token);
    if (!participant) {
      sendJson(res, 404, { error: "ID not found. Please rejoin." });
      return;
    }

    const round = getUsedCarRound();
    const role =
      round && participant.joined
        ? getUsedCarRoleForParticipant(participant.id, round.number)
        : null;
    const pair =
      round?.pairs.find(
        (item) => item.buyerId === participant.id || item.sellerId === participant.id
      ) || null;

    sendJson(res, 200, {
      ...usedCarBaseState(origin),
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
            canSubmitBid:
              role === "buyer" &&
              round.status === "buyer_collecting" &&
              round.bids[participant.id] == null,
            canSubmitDecision:
              role === "seller" &&
              round.status === "seller_collecting" &&
              !round.sellerDecisions[participant.id],
            submittedBid: round.bids[participant.id] ?? null,
            ownQuality:
              role === "seller"
                ? round.sellerQualities[participant.id] ??
                  getUsedCarRolesForRound(round.number).qualities[participant.id] ??
                  null
                : null,
            receivedBid:
              role === "seller"
                ? round.pendingSellerBids[participant.id] ?? pair?.bid ?? null
                : null,
            submittedDecision: round.sellerDecisions[participant.id] || null,
            settledPair:
              round.status === "closed" && pair
                ? {
                    bid: pair.bid,
                    sold: pair.sold,
                    quality:
                      role === "seller" ? pair.quality : pair.sold ? pair.quality : null,
                    payoff:
                      role === "buyer" ? pair.buyerPayoff : pair.sellerPayoff,
                  }
                : null,
          }
        : null,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/used-car/student/submit-bid") {
    const body = await getRequestBody(req);
    const token = typeof body.token === "string" ? body.token : "";
    const bid = Number(body.bid);
    const participant = getUsedCarParticipantByToken(token);
    const round = getUsedCarRound();

    if (!participant) {
      sendJson(res, 404, { error: "ID not found. Please rejoin." });
      return;
    }
    if (!round || round.status !== "buyer_collecting") {
      sendJson(res, 409, { error: "The buyer stage is not open." });
      return;
    }
    if (getUsedCarRoleForParticipant(participant.id, round.number) !== "buyer") {
      sendJson(res, 409, { error: "You are not a buyer this round." });
      return;
    }
    if (!Number.isInteger(bid) || bid < 0 || bid > usedCarState.settings.pieSize) {
      sendJson(res, 400, {
        error: `Bid must be an integer between 0 and ${usedCarState.settings.pieSize}.`,
      });
      return;
    }
    if (round.bids[participant.id] != null) {
      sendJson(res, 409, { error: "You have already submitted this round." });
      return;
    }

    round.bids[participant.id] = bid;
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/used-car/student/submit-decision") {
    const body = await getRequestBody(req);
    const token = typeof body.token === "string" ? body.token : "";
    const decision = body.decision;
    const participant = getUsedCarParticipantByToken(token);
    const round = getUsedCarRound();

    if (!participant) {
      sendJson(res, 404, { error: "ID not found. Please rejoin." });
      return;
    }
    if (!round || round.status !== "seller_collecting") {
      sendJson(res, 409, { error: "The seller stage is not open." });
      return;
    }
    if (getUsedCarRoleForParticipant(participant.id, round.number) !== "seller") {
      sendJson(res, 409, { error: "You are not a seller this round." });
      return;
    }
    if (!["sell", "keep"].includes(decision)) {
      sendJson(res, 400, { error: "Decision must be sell or keep." });
      return;
    }
    if (round.sellerDecisions[participant.id]) {
      sendJson(res, 409, { error: "You have already submitted this round." });
      return;
    }

    round.sellerDecisions[participant.id] = decision;
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { error: "Endpoint not found." });
}

async function handleMilkTeaApi(req, res, url) {
  const origin = getOrigin(req);

  if (req.method === "GET" && url.pathname === "/api/milk-tea/meta") {
    sendJson(res, 200, milkTeaBaseState(origin));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/milk-tea/teacher/state") {
    sendJson(res, 200, milkTeaTeacherState(origin));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/milk-tea/teacher/reset") {
    resetMilkTeaSession();
    sendJson(res, 200, milkTeaTeacherState(origin));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/milk-tea/teacher/configure") {
    const body = await getRequestBody(req);
    if (
      milkTeaState.currentRound > 0 ||
      milkTeaState.players.some((player) => player.token)
    ) {
      sendJson(res, 409, {
        error:
          "Students have already joined or rounds have already started. Reset first before changing settings.",
      });
      return;
    }

    try {
      const settings = validateMilkTeaSettings(body);
      milkTeaState.settings = settings;
      milkTeaState.players = createMilkTeaPlayers(settings.seatCount);
      milkTeaState.status = "lobby";
      sendJson(res, 200, milkTeaTeacherState(origin));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/milk-tea/teacher/start-round") {
    if (milkTeaState.status === "collecting") {
      sendJson(res, 409, { error: "A round is already open." });
      return;
    }
    if (milkTeaState.status === "setup") {
      sendJson(res, 409, { error: "Configure the session first." });
      return;
    }
    if (milkTeaState.currentRound >= milkTeaState.settings.maxRounds) {
      sendJson(res, 409, { error: "All rounds are already finished." });
      return;
    }
    if (milkTeaState.players.filter((player) => player.token).length !== milkTeaState.settings.seatCount) {
      sendJson(res, 409, {
        error: "All stations must join before the teacher can start the round.",
      });
      return;
    }

    milkTeaState.currentRound += 1;
    milkTeaState.status = "collecting";
    milkTeaState.rounds.push({
      number: milkTeaState.currentRound,
      status: "collecting",
      actualSpeed: null,
      averageChoice: null,
      teamBonus: null,
      submissions: [],
      resolvedChoices: [],
      openedAt: new Date().toISOString(),
      closedAt: null,
    });

    sendJson(res, 200, milkTeaTeacherState(origin));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/milk-tea/teacher/close-round") {
    const round = getMilkTeaRound();
    if (!round || round.status !== "collecting") {
      sendJson(res, 409, { error: "There is no open round to close." });
      return;
    }

    applyMilkTeaRoundResults(round);
    sendJson(res, 200, milkTeaTeacherState(origin));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/milk-tea/student/join") {
    const body = await getRequestBody(req);
    const token = typeof body.token === "string" ? body.token : "";
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 30) : "";
    const normalized = normalizeName(name);

    if (milkTeaState.status === "setup") {
      sendJson(res, 409, {
        error: "The teacher has not saved the milk tea rush settings yet.",
      });
      return;
    }

    if (!(milkTeaState.status === "lobby" && milkTeaState.currentRound === 0)) {
      sendJson(res, 409, {
        error: "New players can only join before Round 1 starts.",
      });
      return;
    }

    if (!name) {
      sendJson(res, 400, { error: "Name or alias cannot be empty." });
      return;
    }

    const sameNamePlayer = milkTeaState.players.find(
      (player) => player.token && normalizeName(player.name) === normalized
    );
    if (sameNamePlayer && sameNamePlayer.token !== token) {
      sendJson(res, 200, {
        token: sameNamePlayer.token,
        seat: sameNamePlayer.seat,
        station: sameNamePlayer.station,
        name: sameNamePlayer.name,
        sessionCode: milkTeaState.sessionCode,
        rejoined: true,
      });
      return;
    }

    let player = token ? milkTeaPlayerByToken(token) : null;
    if (!player) {
      player = milkTeaState.players.find((item) => !item.token) || null;
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
      station: player.station,
      name: player.name,
      sessionCode: milkTeaState.sessionCode,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/milk-tea/student/state") {
    const token = url.searchParams.get("token") || "";
    const player = milkTeaPlayerByToken(token);
    if (!player) {
      sendJson(res, 404, { error: "Student identity not found. Please rejoin." });
      return;
    }

    const round = getMilkTeaRound();
    const ownSubmission =
      round?.submissions.find((item) => item.seat === player.seat) || null;
    const ownResolved =
      round?.resolvedChoices.find((item) => item.seat === player.seat) || null;

    sendJson(res, 200, {
      ...milkTeaBaseState(origin),
      player: {
        seat: player.seat,
        station: player.station,
        name: player.name,
        cumulative: player.cumulative,
        history: player.history,
      },
      currentRoundSummary: round
        ? {
            number: round.number,
            status: round.status,
            submitted: Boolean(ownSubmission),
            ownSpeed: ownSubmission ? ownSubmission.speed : null,
            actualSpeed: round.status === "closed" ? round.actualSpeed : null,
            averageChoice: round.status === "closed" ? round.averageChoice : null,
            teamBonus: round.status === "closed" ? round.teamBonus : null,
            personalCost: ownResolved ? ownResolved.personalCost : null,
            takeHome: ownResolved ? ownResolved.takeHome : null,
            defaulted: ownResolved ? ownResolved.defaulted : false,
          }
        : null,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/milk-tea/student/submit-speed") {
    const body = await getRequestBody(req);
    const token = typeof body.token === "string" ? body.token : "";
    const speed = Number(body.speed);
    const player = milkTeaPlayerByToken(token);
    const round = getMilkTeaRound();

    if (!player) {
      sendJson(res, 404, { error: "Student identity not found. Please rejoin." });
      return;
    }
    if (!round || round.status !== "collecting") {
      sendJson(res, 409, { error: "The round is not open for speed choices." });
      return;
    }
    if (
      !Number.isInteger(speed) ||
      speed < 1 ||
      speed > milkTeaState.settings.maxSpeed
    ) {
      sendJson(res, 400, {
        error: `Speed must be an integer between 1 and ${milkTeaState.settings.maxSpeed}.`,
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
      speed,
      submittedAt: new Date().toISOString(),
    });
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { error: "Endpoint not found." });
}

async function handleNightMarketApi(req, res, url) {
  const origin = getOrigin(req);

  if (req.method === "GET" && url.pathname === "/api/night-market/meta") {
    sendJson(res, 200, nightMarketBaseState(origin));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/night-market/teacher/state") {
    sendJson(res, 200, nightMarketTeacherState(origin));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/night-market/teacher/reset") {
    resetNightMarketSession();
    sendJson(res, 200, nightMarketTeacherState(origin));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/night-market/teacher/configure") {
    const body = await getRequestBody(req);
    if (
      nightMarketState.currentRound > 0 ||
      nightMarketState.players.some((player) => player.token)
    ) {
      sendJson(res, 409, {
        error:
          "Students have already joined or rounds have already started. Reset first before changing settings.",
      });
      return;
    }

    try {
      const settings = validateNightMarketSettings(body);
      nightMarketState.settings = settings;
      nightMarketState.players = createNightMarketPlayers(settings.seatCount);
      nightMarketState.status = "lobby";
      sendJson(res, 200, nightMarketTeacherState(origin));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/night-market/teacher/start-round") {
    if (nightMarketState.status === "collecting") {
      sendJson(res, 409, { error: "A round is already open." });
      return;
    }
    if (nightMarketState.status === "setup") {
      sendJson(res, 409, { error: "Configure the session first." });
      return;
    }
    if (nightMarketState.currentRound >= nightMarketState.settings.maxRounds) {
      sendJson(res, 409, { error: "All rounds are already finished." });
      return;
    }
    if (
      nightMarketState.players.filter((player) => player.token).length !==
      nightMarketState.settings.seatCount
    ) {
      sendJson(res, 409, {
        error: "All stalls must join before the teacher can start the round.",
      });
      return;
    }

    nightMarketState.currentRound += 1;
    nightMarketState.status = "collecting";
    nightMarketState.rounds.push({
      number: nightMarketState.currentRound,
      status: "collecting",
      entrantsCount: null,
      revenuePerHour: null,
      averageHours: null,
      totalOpenHours: null,
      submissions: [],
      resolvedChoices: [],
      openedAt: new Date().toISOString(),
      closedAt: null,
    });

    sendJson(res, 200, nightMarketTeacherState(origin));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/night-market/teacher/close-round") {
    const round = getNightMarketRound();
    if (!round || round.status !== "collecting") {
      sendJson(res, 409, { error: "There is no open round to close." });
      return;
    }

    applyNightMarketRoundResults(round);
    sendJson(res, 200, nightMarketTeacherState(origin));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/night-market/student/join") {
    const body = await getRequestBody(req);
    const token = typeof body.token === "string" ? body.token : "";
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 30) : "";
    const normalized = normalizeName(name);

    if (nightMarketState.status === "setup") {
      sendJson(res, 409, {
        error: "The teacher has not saved the night market settings yet.",
      });
      return;
    }

    if (!(nightMarketState.status === "lobby" && nightMarketState.currentRound === 0)) {
      sendJson(res, 409, {
        error: "New players can only join before Round 1 starts.",
      });
      return;
    }

    if (!name) {
      sendJson(res, 400, { error: "Name or alias cannot be empty." });
      return;
    }

    const sameNamePlayer = nightMarketState.players.find(
      (player) => player.token && normalizeName(player.name) === normalized
    );
    if (sameNamePlayer && sameNamePlayer.token !== token) {
      sendJson(res, 200, {
        token: sameNamePlayer.token,
        seat: sameNamePlayer.seat,
        stall: sameNamePlayer.stall,
        name: sameNamePlayer.name,
        sessionCode: nightMarketState.sessionCode,
        rejoined: true,
      });
      return;
    }

    let player = token ? nightMarketPlayerByToken(token) : null;
    if (!player) {
      player = nightMarketState.players.find((item) => !item.token) || null;
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
      stall: player.stall,
      name: player.name,
      sessionCode: nightMarketState.sessionCode,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/night-market/student/state") {
    const token = url.searchParams.get("token") || "";
    const player = nightMarketPlayerByToken(token);
    if (!player) {
      sendJson(res, 404, { error: "Student identity not found. Please rejoin." });
      return;
    }

    const round = getNightMarketRound();
    const ownSubmission =
      round?.submissions.find((item) => item.seat === player.seat) || null;
    const ownResolved =
      round?.resolvedChoices.find((item) => item.seat === player.seat) || null;

    sendJson(res, 200, {
      ...nightMarketBaseState(origin),
      player: {
        seat: player.seat,
        stall: player.stall,
        name: player.name,
        cumulative: player.cumulative,
        history: player.history,
      },
      currentRoundSummary: round
        ? {
            number: round.number,
            status: round.status,
            submitted: Boolean(ownSubmission),
            ownEnter: ownSubmission ? ownSubmission.enter : null,
            ownHours: ownSubmission ? ownSubmission.hours : null,
            entrantsCount: round.status === "closed" ? round.entrantsCount : null,
            revenuePerHour: round.status === "closed" ? round.revenuePerHour : null,
            averageHours: round.status === "closed" ? round.averageHours : null,
            grossRevenue: ownResolved ? ownResolved.grossRevenue : null,
            runningCost: ownResolved ? ownResolved.runningCost : null,
            stallFee: ownResolved ? ownResolved.stallFee : null,
            takeHome: ownResolved ? ownResolved.takeHome : null,
            defaulted: ownResolved ? ownResolved.defaulted : false,
          }
        : null,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/night-market/student/submit-choice") {
    const body = await getRequestBody(req);
    const token = typeof body.token === "string" ? body.token : "";
    const enter = body.enter === true || body.enter === "true";
    const hours = Number(body.hours);
    const player = nightMarketPlayerByToken(token);
    const round = getNightMarketRound();

    if (!player) {
      sendJson(res, 404, { error: "Student identity not found. Please rejoin." });
      return;
    }
    if (!round || round.status !== "collecting") {
      sendJson(res, 409, { error: "The round is not open for choices." });
      return;
    }

    const existing = round.submissions.find((item) => item.seat === player.seat);
    if (existing) {
      sendJson(res, 409, { error: "You have already submitted this round." });
      return;
    }

    let normalizedHours = 0;
    if (enter) {
      if (
        !Number.isInteger(hours) ||
        hours < 1 ||
        hours > nightMarketState.settings.maxHours
      ) {
        sendJson(res, 400, {
          error: `Open hours must be an integer between 1 and ${nightMarketState.settings.maxHours}.`,
        });
        return;
      }
      normalizedHours = hours;
    }

    round.submissions.push({
      seat: player.seat,
      enter,
      hours: normalizedHours,
      submittedAt: new Date().toISOString(),
    });
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { error: "Endpoint not found." });
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

async function handleBankRunApi(req, res, url) {
  const origin = getOrigin(req);

  if (req.method === "GET" && url.pathname === "/api/bank-run/meta") {
    sendJson(res, 200, bankRunBaseState(origin));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/bank-run/teacher/state") {
    sendJson(res, 200, bankRunTeacherState(origin));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/bank-run/teacher/reset") {
    resetBankRunSession();
    sendJson(res, 200, bankRunTeacherState(origin));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/bank-run/teacher/configure") {
    const body = await getRequestBody(req);
    if (bankRunState.currentDay > 0 || bankRunState.players.some((player) => player.token)) {
      sendJson(res, 409, {
        error:
          "Students have already joined or the game has already started. Reset first before changing settings.",
      });
      return;
    }

    try {
      const settings = validateBankRunSettings(body);
      bankRunState.settings = settings;
      bankRunState.players = createBankRunPlayers(settings.seatCount);
      bankRunState.currentDay = 0;
      bankRunState.days = [];
      bankRunState.successfulWithdrawals = 0;
      bankRunState.bankOutcome = "pending";
      bankRunState.rumorState = drawBankRunRumorState();
      bankRunState.status = "lobby";
      sendJson(res, 200, bankRunTeacherState(origin));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/bank-run/teacher/start-day") {
    if (bankRunState.status === "collecting") {
      sendJson(res, 409, { error: "A day is already open." });
      return;
    }
    if (bankRunState.status === "setup") {
      sendJson(res, 409, { error: "Configure the session first." });
      return;
    }
    if (bankRunState.status === "finished" || bankRunState.status === "failed") {
      sendJson(res, 409, { error: "This game is already over." });
      return;
    }
    if (bankRunState.currentDay >= bankRunState.settings.daysUntilMaturity) {
      sendJson(res, 409, { error: "All days are already finished." });
      return;
    }
    if (
      bankRunState.players.filter((player) => player.token).length !==
      bankRunState.settings.seatCount
    ) {
      sendJson(res, 409, {
        error: "All depositors must join before the teacher can start the day.",
      });
      return;
    }

    bankRunState.currentDay += 1;
    bankRunState.status = "collecting";
    bankRunState.days.push({
      number: bankRunState.currentDay,
      status: "collecting",
      submissions: [],
      resolvedChoices: [],
      attemptedWithdrawals: null,
      successfulToday: null,
      defaultWaitCount: null,
      remainingLiquidityBefore: null,
      remainingLiquidityAfter: null,
      bankCollapsedToday: false,
      openedAt: new Date().toISOString(),
      closedAt: null,
    });

    sendJson(res, 200, bankRunTeacherState(origin));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/bank-run/teacher/close-day") {
    const day = getBankRunDay();
    if (!day || day.status !== "collecting") {
      sendJson(res, 409, { error: "There is no open day to close." });
      return;
    }

    applyBankRunDayResults(day);
    sendJson(res, 200, bankRunTeacherState(origin));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/bank-run/student/join") {
    const body = await getRequestBody(req);
    const token = typeof body.token === "string" ? body.token : "";
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 30) : "";
    const normalized = normalizeName(name);

    if (bankRunState.status === "setup") {
      sendJson(res, 409, {
        error: "The teacher has not saved the bank run settings yet.",
      });
      return;
    }

    if (!(bankRunState.status === "lobby" && bankRunState.currentDay === 0)) {
      sendJson(res, 409, {
        error: "New players can only join before Day 1 starts.",
      });
      return;
    }

    if (!name) {
      sendJson(res, 400, { error: "Name or alias cannot be empty." });
      return;
    }

    const sameNamePlayer = bankRunState.players.find(
      (player) => player.token && normalizeName(player.name) === normalized
    );
    if (sameNamePlayer && sameNamePlayer.token !== token) {
      sendJson(res, 200, {
        token: sameNamePlayer.token,
        seat: sameNamePlayer.seat,
        signal: sameNamePlayer.signal,
        name: sameNamePlayer.name,
        sessionCode: bankRunState.sessionCode,
        rejoined: true,
      });
      return;
    }

    let player = token ? bankRunPlayerByToken(token) : null;
    if (!player) {
      player = bankRunState.players.find((item) => !item.token) || null;
    }
    if (!player) {
      sendJson(res, 409, { error: "The session is already full." });
      return;
    }

    if (!player.token) {
      player.token = crypto.randomUUID();
      player.joinedAt = new Date().toISOString();
    }
    if (!player.signal) {
      player.signal = drawBankRunSignal();
    }
    player.name = name;

    sendJson(res, 200, {
      token: player.token,
      seat: player.seat,
      signal: player.signal,
      name: player.name,
      sessionCode: bankRunState.sessionCode,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/bank-run/student/state") {
    const token = url.searchParams.get("token") || "";
    const player = bankRunPlayerByToken(token);
    if (!player) {
      sendJson(res, 404, { error: "Student identity not found. Please rejoin." });
      return;
    }

    const day = getBankRunDay();
    const ownSubmission = day?.submissions.find((item) => item.seat === player.seat) || null;
    const ownResolved = day?.resolvedChoices.find((item) => item.seat === player.seat) || null;

    sendJson(res, 200, {
      ...bankRunBaseState(origin),
      history: player.history,
      player: {
        seat: player.seat,
        name: player.name,
        signal: player.signal,
        status: player.status,
        resolvedDay: player.resolvedDay,
        cumulative: player.cumulative,
        history: player.history,
      },
      currentDaySummary: day
        ? {
            number: day.number,
            status: day.status,
            submitted: Boolean(ownSubmission),
            ownAction: ownSubmission
              ? ownSubmission.action
              : ownResolved
                ? ownResolved.action
                : null,
            ownOutcome: ownResolved ? ownResolved.outcome : null,
            ownPayoff: ownResolved ? ownResolved.payoff : null,
            queueRank: ownResolved ? ownResolved.queueRank : null,
            attemptedWithdrawals: day.status === "closed" ? day.attemptedWithdrawals : null,
            successfulToday: day.status === "closed" ? day.successfulToday : null,
            bankCollapsedToday: day.status === "closed" ? day.bankCollapsedToday : false,
          }
        : null,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/bank-run/student/submit-choice") {
    const body = await getRequestBody(req);
    const token = typeof body.token === "string" ? body.token : "";
    const action = typeof body.action === "string" ? body.action : "";
    const player = bankRunPlayerByToken(token);
    const day = getBankRunDay();

    if (!player) {
      sendJson(res, 404, { error: "Student identity not found. Please rejoin." });
      return;
    }
    if (player.status !== "waiting") {
      sendJson(res, 409, { error: "You are no longer active in this game." });
      return;
    }
    if (!day || day.status !== "collecting") {
      sendJson(res, 409, { error: "Today is not open for choices." });
      return;
    }
    if (!["wait", "withdraw"].includes(action)) {
      sendJson(res, 400, { error: "Choice must be either 'wait' or 'withdraw'." });
      return;
    }

    const existing = day.submissions.find((item) => item.seat === player.seat);
    if (existing) {
      sendJson(res, 409, { error: "You have already submitted today." });
      return;
    }

    day.submissions.push({
      seat: player.seat,
      action,
      submittedAt: new Date().toISOString(),
    });

    sendJson(res, 200, { ok: true, submittedCount: day.submissions.length });
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
  if (url.pathname.startsWith("/api/used-car/")) {
    await handleUsedCarApi(req, res, url);
    return;
  }
  if (url.pathname.startsWith("/api/ultimatum/")) {
    await handleUltimatumApi(req, res, url);
    return;
  }
  if (url.pathname.startsWith("/api/milk-tea/")) {
    await handleMilkTeaApi(req, res, url);
    return;
  }
  if (url.pathname.startsWith("/api/night-market/")) {
    await handleNightMarketApi(req, res, url);
    return;
  }
  if (url.pathname.startsWith("/api/bank-run/")) {
    await handleBankRunApi(req, res, url);
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
