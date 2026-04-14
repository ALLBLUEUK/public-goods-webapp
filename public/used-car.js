const role = new URLSearchParams(window.location.search).get("role") || "home";
const tokenKey = "used-car-student-token";

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) {
    node.textContent = value;
  }
}

function formatNumber(value) {
  if (value == null) {
    return "--";
  }
  return Number.isInteger(value) ? `${value}` : Number(value).toFixed(2);
}

function pct(value) {
  return value == null ? "--" : `${Math.round(value * 100)}%`;
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }
  return data;
}

function getTokenFromUrl() {
  return new URLSearchParams(window.location.search).get("token") || "";
}

function persistStudentToken(token) {
  const url = new URL(window.location.href);
  if (token) {
    window.localStorage.setItem(tokenKey, token);
    url.searchParams.set("token", token);
  } else {
    window.localStorage.removeItem(tokenKey);
    url.searchParams.delete("token");
  }
  window.history.replaceState({}, "", url.toString());
}

function makeBarRows(items, options = {}) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return items
    .map((item) => {
      const width = `${(item.value / max) * 100}%`;
      return `
        <div class="bar-row">
          <div class="bar-label">${item.label}</div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${width}"></div>
          </div>
          <div class="bar-value">${options.format ? options.format(item.value) : item.value}</div>
        </div>
      `;
    })
    .join("");
}

function renderDistributionChart(node, distribution) {
  if (!distribution?.length) {
    node.innerHTML = `<p class="muted">No bids yet.</p>`;
    return;
  }
  node.innerHTML = `<div class="bar-chart">${makeBarRows(
    distribution.map((item) => ({ label: `${item.bid}`, value: item.count }))
  )}</div>`;
}

function renderTradeMixChart(node, rounds) {
  if (!rounds?.length) {
    node.innerHTML = `<p class="muted">No settled rounds yet.</p>`;
    return;
  }
  const max = Math.max(
    1,
    ...rounds.map((round) => round.soldGoodCount + round.soldLemonCount + round.unsoldCount)
  );
  node.innerHTML = rounds
    .map((round) => {
      const goodWidth = ((round.soldGoodCount / max) * 100).toFixed(2);
      const lemonWidth = ((round.soldLemonCount / max) * 100).toFixed(2);
      const unsoldWidth = ((round.unsoldCount / max) * 100).toFixed(2);
      return `
        <div class="stack-row">
          <div class="stack-label">R${round.round}</div>
          <div class="stack-track">
            <div class="stack-good" style="width:${goodWidth}%"></div>
            <div class="stack-lemon" style="width:${lemonWidth}%"></div>
            <div class="stack-unsold" style="width:${unsoldWidth}%"></div>
          </div>
          <div class="stack-value">G ${round.soldGoodCount} / L ${round.soldLemonCount} / U ${round.unsoldCount}</div>
        </div>
      `;
    })
    .join("");
}

function renderTrendChart(node, rounds) {
  if (!rounds?.length) {
    node.innerHTML = `<p class="muted">No settled rounds yet.</p>`;
    return;
  }
  node.innerHTML = `<div class="bar-chart">${makeBarRows(
    rounds.map((round) => ({
      label: `R${round.round}`,
      value: round.averageBid ?? 0,
    })),
    { format: (value) => formatNumber(value) }
  )}</div>`;
}

function initTeacher() {
  document.getElementById("hero").classList.add("hidden");
  document.getElementById("heroActions").classList.add("hidden");
  document.getElementById("teacherPanel").classList.remove("hidden");

  const configForm = document.getElementById("usedCarConfigForm");
  const studentCountInput = document.getElementById("studentCountInput");
  const phaseRoundsInput = document.getElementById("phaseRoundsInput");
  const pieSizeInput = document.getElementById("pieSizeInput");
  const teacherJoinInput = document.getElementById("teacherJoinInput");
  const goodCarCountInput = document.getElementById("goodCarCountInput");
  const buyerValueGoodInput = document.getElementById("buyerValueGoodInput");
  const buyerValueLemonInput = document.getElementById("buyerValueLemonInput");
  const sellerKeepGoodInput = document.getElementById("sellerKeepGoodInput");
  const sellerKeepLemonInput = document.getElementById("sellerKeepLemonInput");
  const startRoundButton = document.getElementById("startRoundButton");
  const closeBuyersButton = document.getElementById("closeBuyersButton");
  const closeSellersButton = document.getElementById("closeSellersButton");
  const resetButton = document.getElementById("resetButton");
  const teacherSelfActionNode = document.getElementById("teacherSelfAction");

  let configSynced = false;
  let configDirty = false;
  let teacherActionDirty = false;
  let lastTeacherActionKey = "";

  function syncConfig(settings, force = false) {
    if (!force && (configSynced || configDirty)) {
      return;
    }
    studentCountInput.value = settings.studentCount;
    phaseRoundsInput.value = settings.phaseRounds;
    pieSizeInput.value = settings.pieSize;
    teacherJoinInput.value = String(settings.teacherJoinsIfOdd);
    goodCarCountInput.value = settings.goodCarCount;
    buyerValueGoodInput.value = settings.buyerValueGood;
    buyerValueLemonInput.value = settings.buyerValueLemon;
    sellerKeepGoodInput.value = settings.sellerKeepGood;
    sellerKeepLemonInput.value = settings.sellerKeepLemon;
    configSynced = true;
  }

  function renderTeacherSelfAction(data) {
    const action = data.teacherAction;
    const actionKey = JSON.stringify({
      participantId: action?.participantId ?? null,
      role: action?.role ?? null,
      roundStatus: action?.roundStatus ?? null,
      ownQuality: action?.ownQuality ?? null,
      receivedBid: action?.receivedBid ?? null,
      hasSubmitted: action?.hasSubmitted ?? null,
    });
    if (teacherActionDirty && actionKey === lastTeacherActionKey) {
      return;
    }
    lastTeacherActionKey = actionKey;
    teacherActionDirty = false;

    if (!action) {
      teacherSelfActionNode.innerHTML = `
        <p>教师未参与本场实验。</p>
        <p>Teacher is not participating in this session.</p>
      `;
      return;
    }

    if (action.role === "buyer" && action.roundStatus === "buyer_collecting") {
      teacherSelfActionNode.innerHTML = `
        <p>教师当前是买家，匿名编号 ID ${action.participantId}。</p>
        <p>Teacher is currently a buyer with anonymous ID ${action.participantId}.</p>
        <form id="teacherBidForm" class="decision-grid">
          <label>
            <span>报价 Bid</span>
            <input id="teacherBidInput" type="number" min="0" max="${data.settings.pieSize}" step="1" value="0" />
          </label>
          <button class="button" type="submit" ${action.hasSubmitted ? "disabled" : ""}>提交教师报价 Submit Teacher Bid</button>
        </form>
      `;
      document.getElementById("teacherBidInput").addEventListener("input", () => {
        teacherActionDirty = true;
      });
      document.getElementById("teacherBidForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
          await request("/api/used-car/teacher/submit-self", {
            method: "POST",
            body: { bid: Number(document.getElementById("teacherBidInput").value) },
          });
          await refreshTeacher();
        } catch (error) {
          alert(error.message);
        }
      });
      return;
    }

    if (action.role === "seller" && action.roundStatus === "seller_collecting") {
      const keepValue =
        action.ownQuality === "good"
          ? data.settings.sellerKeepGood
          : data.settings.sellerKeepLemon;
      teacherSelfActionNode.innerHTML = `
        <p>教师当前是卖家，匿名编号 ID ${action.participantId}。</p>
        <p>Teacher is currently a seller with anonymous ID ${action.participantId}.</p>
        <p>你的车辆质量 / Your car quality: <strong>${action.ownQuality === "good" ? "好车 Good" : "柠檬 Lemon"}</strong></p>
        <p>收到报价 / Bid received: <strong>${formatNumber(action.receivedBid)}</strong></p>
        <p>不卖时保留价值 / Keep value: <strong>${formatNumber(keepValue)}</strong></p>
        <div class="button-stack">
          <button class="button" id="teacherSellButton" ${action.hasSubmitted ? "disabled" : ""}>卖出 Sell</button>
          <button class="button button-secondary" id="teacherKeepButton" ${action.hasSubmitted ? "disabled" : ""}>不卖 Keep</button>
        </div>
      `;
      document.getElementById("teacherSellButton").addEventListener("click", async () => {
        try {
          await request("/api/used-car/teacher/submit-self", {
            method: "POST",
            body: { decision: "sell" },
          });
          await refreshTeacher();
        } catch (error) {
          alert(error.message);
        }
      });
      document.getElementById("teacherKeepButton").addEventListener("click", async () => {
        try {
          await request("/api/used-car/teacher/submit-self", {
            method: "POST",
            body: { decision: "keep" },
          });
          await refreshTeacher();
        } catch (error) {
          alert(error.message);
        }
      });
      return;
    }

    teacherSelfActionNode.innerHTML = `
      <p>教师匿名编号 ID ${action.participantId} 已加入，但当前轮次无需教师操作。</p>
      <p>Teacher anonymous ID ${action.participantId} has joined, but no action is needed right now.</p>
    `;
  }

  async function refreshTeacher() {
    try {
      const data = await request("/api/used-car/teacher/state");
      syncConfig(data.settings);
      setText(
        "teacherStatus",
        {
          setup: "待设置 Setup",
          lobby: "等待加入 Lobby",
          buyer_collecting: "买家报价 Buyer Stage",
          seller_collecting: "卖家决策 Seller Stage",
          between_rounds: "等待下一轮 Between Rounds",
          finished: "已结束 Finished",
        }[data.status] || data.status
      );
      setText("teacherSessionCode", `Session ${data.sessionCode}`);
      setText("roundValue", data.currentRound);
      setText("stageValue", data.currentStage);
      setText("totalRoundsValue", data.totalRounds);
      setText("joinedStudentsValue", `${data.joinedStudentCount}/${data.settings.studentCount}`);

      document.getElementById("joinUrl").textContent = data.joinUrl;
      document.getElementById("qrImage").src =
        "https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=" +
        encodeURIComponent(data.joinUrl);

      const currentRound = data.currentRoundDetail;
      document.getElementById("marketCompositionText").innerHTML = currentRound
        ? `
            <p>本轮市场里有 <strong>${currentRound.marketComposition.goodCars}</strong> 辆好车，<strong>${currentRound.marketComposition.lemons}</strong> 辆柠檬车。</p>
            <p>This round has <strong>${currentRound.marketComposition.goodCars}</strong> good cars and <strong>${currentRound.marketComposition.lemons}</strong> lemons.</p>
            <p>最高报价上限 / Bid ceiling: <strong>${data.settings.pieSize}</strong></p>
          `
        : `
            <p>保存设置后，系统会按照每阶段 <strong>${data.settings.goodCarCount}</strong> 辆好车、<strong>${data.settings.lemonCount}</strong> 辆柠檬车来配置市场。</p>
            <p>After setup, each phase will use <strong>${data.settings.goodCarCount}</strong> good cars and <strong>${data.settings.lemonCount}</strong> lemons.</p>
          `;

      document.getElementById("stageRolesText").innerHTML =
        data.status === "setup"
          ? `
              <p>教师还没有保存设置，学生暂时不能进入。</p>
              <p>The teacher has not saved the setup yet, so students cannot join.</p>
            `
          : `
              <p>阶段 1：${data.stageRoles[1].buyerCount} 个买家，${data.stageRoles[1].sellerCount} 个卖家。</p>
              <p>Stage 1: ${data.stageRoles[1].buyerCount} buyers and ${data.stageRoles[1].sellerCount} sellers.</p>
              <p>阶段 2：整体交换角色，再做同样的轮数。</p>
              <p>Stage 2: all roles swap and the same number of rounds run again.</p>
              <p>当前剩余空位 / Remaining slots: <strong>${data.openIds.length}</strong></p>
            `;

      document.getElementById("roundResults").innerHTML =
        currentRound && currentRound.revealedPairs.length
          ? currentRound.revealedPairs
              .map((pair) => {
                if (pair.sold) {
                  return `
                    <p>Pair ${pair.pairNumber}: bid ${pair.bid}, sold, ${pair.quality}, buyer payoff ${formatNumber(pair.buyerPayoff)}, seller payoff ${formatNumber(pair.sellerPayoff)}</p>
                  `;
                }
                return `
                  <p>Pair ${pair.pairNumber}: bid ${pair.bid}, not sold, buyer payoff 0, seller payoff ${formatNumber(pair.sellerPayoff)}</p>
                `;
              })
              .join("")
          : currentRound
            ? `
                <p>已收到买家报价 / Bids received: ${currentRound.submittedBids.length}</p>
                <p>已收到卖家决策 / Seller decisions received: ${currentRound.submittedDecisions.length}</p>
                <p>待报价买家 / Pending buyers: ${currentRound.pendingBids.length}</p>
                <p>待决策卖家 / Pending sellers: ${currentRound.pendingDecisions.length}</p>
              `
            : "No settled round yet.";

      const analysis = data.analysis;
      document.getElementById("analysisSummary").innerHTML = `
        <p>平均报价 Average bid: <strong>${formatNumber(analysis.overall.averageBid)}</strong></p>
        <p>中位报价 Median bid: <strong>${formatNumber(analysis.overall.medianBid)}</strong></p>
        <p>成交率 Trade rate: <strong>${pct(analysis.overall.tradeRate)}</strong></p>
        <p>成交好车 Good cars sold: <strong>${analysis.overall.soldGoodCount}</strong></p>
        <p>成交柠檬 Lemon cars sold: <strong>${analysis.overall.soldLemonCount}</strong></p>
        <p>阶段 1 平均报价 Stage 1 average bid: <strong>${formatNumber(analysis.stages[1].averageBid)}</strong></p>
        <p>阶段 2 平均报价 Stage 2 average bid: <strong>${formatNumber(analysis.stages[2].averageBid)}</strong></p>
      `;
      document.getElementById("analysisRounds").innerHTML = analysis.rounds.length
        ? analysis.rounds
            .map(
              (round) => `
                <tr>
                  <td>${round.round}</td>
                  <td>${round.stage}</td>
                  <td>${formatNumber(round.averageBid)}</td>
                  <td>${round.saleCount}</td>
                  <td>${round.soldGoodCount}</td>
                  <td>${round.soldLemonCount}</td>
                </tr>
              `
            )
            .join("")
        : `<tr><td colspan="6">No analysis yet.</td></tr>`;

      renderDistributionChart(document.getElementById("bidDistributionChart"), analysis.distribution);
      renderTradeMixChart(document.getElementById("tradeQualityChart"), analysis.rounds);
      renderTrendChart(document.getElementById("trendChart"), analysis.rounds);

      const finalRevealCard = document.getElementById("finalRevealCard");
      finalRevealCard.classList.toggle("hidden", data.status !== "finished");
      document.getElementById("finalRevealTable").innerHTML =
        data.status === "finished" && data.ranking.length
          ? data.ranking
              .map(
                (item, index) => `
                  <tr>
                    <td>${index + 1}</td>
                    <td>${item.id}</td>
                    <td>${item.name}</td>
                    <td>${formatNumber(item.cumulative)}</td>
                  </tr>
                `
              )
              .join("")
          : `<tr><td colspan="4">Waiting for all rounds to finish.</td></tr>`;

      renderTeacherSelfAction(data);

      const locked = data.currentRound > 0 || data.joinedStudentCount > 0;
      [
        studentCountInput,
        phaseRoundsInput,
        pieSizeInput,
        teacherJoinInput,
        goodCarCountInput,
        buyerValueGoodInput,
        buyerValueLemonInput,
        sellerKeepGoodInput,
        sellerKeepLemonInput,
        configForm.querySelector("button"),
      ].forEach((node) => {
        node.disabled = locked;
      });

      startRoundButton.disabled =
        data.status === "buyer_collecting" ||
        data.status === "seller_collecting" ||
        data.currentRound >= data.totalRounds;
      closeBuyersButton.disabled = data.status !== "buyer_collecting";
      closeSellersButton.disabled = data.status !== "seller_collecting";
    } catch (error) {
      setText("teacherStatus", error.message);
    }
  }

  configForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const response = await request("/api/used-car/teacher/configure", {
        method: "POST",
        body: {
          studentCount: Number(studentCountInput.value),
          phaseRounds: Number(phaseRoundsInput.value),
          pieSize: Number(pieSizeInput.value),
          teacherJoinsIfOdd: teacherJoinInput.value === "true",
          goodCarCount: Number(goodCarCountInput.value),
          buyerValueGood: Number(buyerValueGoodInput.value),
          buyerValueLemon: Number(buyerValueLemonInput.value),
          sellerKeepGood: Number(sellerKeepGoodInput.value),
          sellerKeepLemon: Number(sellerKeepLemonInput.value),
        },
      });
      configDirty = false;
      syncConfig(response.settings, true);
      await refreshTeacher();
    } catch (error) {
      alert(error.message);
    }
  });

  startRoundButton.addEventListener("click", async () => {
    try {
      await request("/api/used-car/teacher/start-round", { method: "POST" });
      teacherActionDirty = false;
      lastTeacherActionKey = "";
      await refreshTeacher();
    } catch (error) {
      alert(error.message);
    }
  });

  closeBuyersButton.addEventListener("click", async () => {
    try {
      await request("/api/used-car/teacher/close-buyers", { method: "POST" });
      teacherActionDirty = false;
      lastTeacherActionKey = "";
      await refreshTeacher();
    } catch (error) {
      alert(error.message);
    }
  });

  closeSellersButton.addEventListener("click", async () => {
    try {
      await request("/api/used-car/teacher/close-sellers", { method: "POST" });
      teacherActionDirty = false;
      lastTeacherActionKey = "";
      await refreshTeacher();
    } catch (error) {
      alert(error.message);
    }
  });

  resetButton.addEventListener("click", async () => {
    if (!window.confirm("确定要重置整场实验吗？\nReset the whole session?")) {
      return;
    }
    try {
      await request("/api/used-car/teacher/reset", { method: "POST" });
      configSynced = false;
      configDirty = false;
      teacherActionDirty = false;
      lastTeacherActionKey = "";
      await refreshTeacher();
    } catch (error) {
      alert(error.message);
    }
  });

  [
    studentCountInput,
    phaseRoundsInput,
    pieSizeInput,
    teacherJoinInput,
    goodCarCountInput,
    buyerValueGoodInput,
    buyerValueLemonInput,
    sellerKeepGoodInput,
    sellerKeepLemonInput,
  ].forEach((input) => {
    input.addEventListener("input", () => {
      configDirty = true;
    });
    input.addEventListener("change", () => {
      configDirty = true;
    });
  });

  refreshTeacher();
  window.setInterval(refreshTeacher, 1500);
}

function initStudent() {
  document.getElementById("hero").classList.add("hidden");
  document.getElementById("heroActions").classList.add("hidden");
  document.getElementById("studentPanel").classList.remove("hidden");

  const joinCard = document.getElementById("joinCard");
  const joinForm = document.getElementById("joinForm");
  const joinTip = document.getElementById("joinTip");
  const joinButton = joinForm.querySelector("button");
  const playerNameInput = document.getElementById("playerNameInput");
  const studentWorkspace = document.getElementById("studentWorkspace");
  const buyerCard = document.getElementById("buyerCard");
  const sellerCard = document.getElementById("sellerCard");
  const bidForm = document.getElementById("bidForm");
  const bidInput = document.getElementById("bidInput");
  const sellButton = document.getElementById("sellButton");
  const keepButton = document.getElementById("keepButton");
  const studentHistory = document.getElementById("studentHistory");

  let token = getTokenFromUrl() || window.localStorage.getItem(tokenKey) || "";
  if (token) {
    persistStudentToken(token);
  }

  async function refreshStudent() {
    try {
      const meta = await request("/api/used-car/meta");
      if (!token) {
        setText("studentStatus", "等待进入 Waiting");
        setText("studentIdBadge", "ID --");
        joinButton.disabled = !meta.joinOpen;
        playerNameInput.disabled = !meta.joinOpen;
        joinTip.textContent = meta.joinOpen
          ? `当前还有 ${meta.openIds.length} 个空位。系统会随机分配匿名编号。There are ${meta.openIds.length} open slots and the system will assign an anonymous ID.`
          : "教师还没有完成设置，学生暂时不能进入。Students cannot join until the teacher saves the setup.";
        return;
      }

      const data = await request(`/api/used-car/student/state?token=${encodeURIComponent(token)}`);
      joinCard.classList.add("hidden");
      studentWorkspace.classList.remove("hidden");

      setText(
        "studentStatus",
        {
          setup: "待设置 Setup",
          lobby: "等待开始 Waiting",
          buyer_collecting: "买家报价 Buyer Stage",
          seller_collecting: "卖家决策 Seller Stage",
          between_rounds: "等待下一轮 Between Rounds",
          finished: "已结束 Finished",
        }[data.status] || data.status
      );
      setText("studentIdBadge", `ID ${data.participant.id}`);
      setText("studentCumulative", formatNumber(data.participant.cumulative));

      const round = data.currentRoundDetail;
      const currentRole = round?.role || "--";
      setText(
        "studentRoleValue",
        currentRole === "buyer" ? "买家 Buyer" : currentRole === "seller" ? "卖家 Seller" : "--"
      );
      setText(
        "studentBidValue",
        currentRole === "buyer"
          ? formatNumber(round?.submittedBid)
          : formatNumber(round?.receivedBid)
      );
      setText("studentPayoffValue", formatNumber(round?.settledPair?.payoff));

      document.getElementById("studentInstruction").innerHTML = !round
        ? `
            <p>等待教师开始本轮。</p>
            <p>Waiting for the teacher to start the round.</p>
          `
        : currentRole === "buyer"
          ? round.canSubmitBid
            ? `
                <p>你本轮是买家。市场里有 ${data.settings.goodCarCount} 辆好车和 ${data.settings.lemonCount} 辆柠檬车。</p>
                <p>You are a buyer this round. The market has ${data.settings.goodCarCount} good cars and ${data.settings.lemonCount} lemons.</p>
                <p>请输入 0 到 ${data.settings.pieSize} 的整数报价。</p>
              `
            : `
                <p>你本轮是买家，已经提交或正在等待卖家决策。</p>
                <p>You are a buyer this round and have already submitted or are waiting for seller decisions.</p>
              `
          : currentRole === "seller"
            ? round.canSubmitDecision
              ? `
                  <p>你本轮是卖家，车辆质量是 <strong>${round.ownQuality === "good" ? "好车 Good" : "柠檬 Lemon"}</strong>。</p>
                  <p>你收到的报价是 <strong>${round.receivedBid}</strong>。</p>
                  <p>You are a seller this round. Your quality is <strong>${round.ownQuality}</strong> and the bid you received is <strong>${round.receivedBid}</strong>.</p>
                `
              : `
                  <p>你本轮是卖家，已经提交或正在等待结算。</p>
                  <p>You are a seller this round and have already submitted or are waiting for settlement.</p>
                `
            : `
                <p>等待教师开始本轮。</p>
                <p>Waiting for the teacher to start the round.</p>
              `;

      buyerCard.classList.toggle("hidden", currentRole !== "buyer");
      sellerCard.classList.toggle("hidden", currentRole !== "seller");
      bidInput.max = String(data.settings.pieSize);
      bidInput.disabled = !round?.canSubmitBid;
      bidForm.querySelector("button").disabled = !round?.canSubmitBid;
      sellButton.disabled = !round?.canSubmitDecision;
      keepButton.disabled = !round?.canSubmitDecision;
      document.getElementById("buyerMarketText").innerHTML = `
        <p>市场构成：好车 ${data.settings.goodCarCount}，柠檬车 ${data.settings.lemonCount}。</p>
        <p>Market composition: ${data.settings.goodCarCount} good cars and ${data.settings.lemonCount} lemons.</p>
        <p>买到好车价值 ${formatNumber(data.settings.buyerValueGood)}，买到柠檬价值 ${formatNumber(data.settings.buyerValueLemon)}。</p>
      `;
      document.getElementById("sellerInfoText").innerHTML = round?.role === "seller"
        ? `
            <p>你的车辆质量 / Your quality: <strong>${round.ownQuality === "good" ? "好车 Good" : "柠檬 Lemon"}</strong></p>
            <p>收到报价 / Bid received: <strong>${formatNumber(round.receivedBid)}</strong></p>
            <p>保留价值 / Keep value: <strong>${
              round.ownQuality === "good"
                ? formatNumber(data.settings.sellerKeepGood)
                : formatNumber(data.settings.sellerKeepLemon)
            }</strong></p>
          `
        : "Waiting.";

      studentHistory.innerHTML = data.participant.history.length
        ? data.participant.history
            .map((item) => {
              if (item.role === "buyer") {
                const qualityLabel =
                  item.quality === "good"
                    ? "Good"
                    : item.quality === "lemon"
                      ? "Lemon"
                      : "--";
                const outcomeLabel =
                  item.outcome === "bought"
                    ? item.quality === "good"
                      ? "Bought good"
                      : "Bought lemon"
                    : "No trade";
                return `
                  <tr>
                    <td>${item.round}</td>
                    <td>${item.stage}</td>
                    <td>Buyer</td>
                    <td>${formatNumber(item.bid)}</td>
                    <td>${qualityLabel}</td>
                    <td>${outcomeLabel}</td>
                    <td>${formatNumber(item.payoff)}</td>
                    <td>${formatNumber(item.cumulative)}</td>
                  </tr>
                `;
              }
              return `
                <tr>
                  <td>${item.round}</td>
                  <td>${item.stage}</td>
                  <td>Seller</td>
                  <td>${formatNumber(item.bid)}</td>
                  <td>${item.quality === "good" ? "Good" : "Lemon"}</td>
                  <td>${item.decision === "sell" ? "Sold" : "Kept"}</td>
                  <td>${formatNumber(item.payoff)}</td>
                  <td>${formatNumber(item.cumulative)}</td>
                </tr>
              `;
            })
            .join("")
        : `<tr><td colspan="8">No record yet.</td></tr>`;
    } catch (error) {
      if (token) {
        persistStudentToken("");
        token = "";
      }
      joinCard.classList.remove("hidden");
      studentWorkspace.classList.add("hidden");
      joinTip.textContent = error.message;
      setText("studentStatus", "需要重新进入 Rejoin");
    }
  }

  joinForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = await request("/api/used-car/student/join", {
        method: "POST",
        body: {
          name: playerNameInput.value.trim(),
          token,
        },
      });
      token = data.token;
      persistStudentToken(token);
      await refreshStudent();
    } catch (error) {
      joinTip.textContent = error.message;
    }
  });

  bidForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await request("/api/used-car/student/submit-bid", {
        method: "POST",
        body: {
          token,
          bid: Number(bidInput.value),
        },
      });
      await refreshStudent();
    } catch (error) {
      alert(error.message);
    }
  });

  sellButton.addEventListener("click", async () => {
    try {
      await request("/api/used-car/student/submit-decision", {
        method: "POST",
        body: { token, decision: "sell" },
      });
      await refreshStudent();
    } catch (error) {
      alert(error.message);
    }
  });

  keepButton.addEventListener("click", async () => {
    try {
      await request("/api/used-car/student/submit-decision", {
        method: "POST",
        body: { token, decision: "keep" },
      });
      await refreshStudent();
    } catch (error) {
      alert(error.message);
    }
  });

  refreshStudent();
  window.setInterval(refreshStudent, 1500);
}

if (role === "teacher") {
  initTeacher();
} else if (role === "student") {
  initStudent();
}
