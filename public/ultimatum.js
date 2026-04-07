const role = new URLSearchParams(window.location.search).get("role") || "home";
const tokenKey = "ultimatum-student-token";

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

function pct(value) {
  return value == null ? "--" : `${Math.round(value * 100)}%`;
}

function initTeacher() {
  const teacherPanel = document.getElementById("teacherPanel");
  const hero = document.getElementById("hero");
  const heroActions = document.getElementById("heroActions");
  hero.classList.add("hidden");
  heroActions.classList.add("hidden");
  teacherPanel.classList.remove("hidden");

  const configForm = document.getElementById("ultimatumConfigForm");
  const studentCountInput = document.getElementById("studentCountInput");
  const phaseRoundsInput = document.getElementById("phaseRoundsInput");
  const pieSizeInput = document.getElementById("pieSizeInput");
  const teacherJoinInput = document.getElementById("teacherJoinInput");
  const startRoundButton = document.getElementById("startUltimatumRoundButton");
  const closeProposersButton = document.getElementById("closeProposersButton");
  const closeRespondersButton = document.getElementById("closeRespondersButton");
  const resetButton = document.getElementById("resetUltimatumButton");

  let configSynced = false;

  function syncConfig(settings, force = false) {
    if (!force && configSynced) {
      return;
    }
    studentCountInput.value = settings.studentCount;
    phaseRoundsInput.value = settings.phaseRounds;
    pieSizeInput.value = settings.pieSize;
    teacherJoinInput.value = String(settings.teacherJoinsIfOdd);
    configSynced = true;
  }

  function renderTeacherSelfAction(data) {
    const node = document.getElementById("teacherSelfAction");
    const action = data.teacherAction;
    if (!action) {
      node.innerHTML = "教师未参与本场实验。<br />Teacher is not participating in this session.";
      return;
    }

    if (action.role === "proposer" && action.roundStatus === "proposer_collecting") {
      node.innerHTML = `
        <p>教师当前是提出者，编号 ID ${action.participantId}。</p>
        <p>Teacher is currently a proposer with ID ${action.participantId}.</p>
        <form id="teacherOfferForm" class="decision-grid">
          <label>
            <span>报价 Offer</span>
            <input id="teacherOfferInput" type="number" min="0" max="${data.settings.pieSize}" step="1" value="0" />
          </label>
          <button class="button" type="submit" ${action.hasSubmitted ? "disabled" : ""}>提交教师报价 Submit Teacher Offer</button>
        </form>
      `;
      document.getElementById("teacherOfferForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
          await request("/api/ultimatum/teacher/submit-self", {
            method: "POST",
            body: { offer: Number(document.getElementById("teacherOfferInput").value) },
          });
          await refreshTeacher();
        } catch (error) {
          alert(error.message);
        }
      });
      return;
    }

    if (action.role === "responder" && action.roundStatus === "responder_collecting") {
      node.innerHTML = `
        <p>教师当前是回应者，编号 ID ${action.participantId}。</p>
        <p>Teacher is currently a responder with ID ${action.participantId}.</p>
        <p>你收到的报价 / Offer received: <strong>${formatNumber(action.responseOffer)}</strong></p>
        <div class="button-stack">
          <button class="button" id="teacherAcceptButton" ${action.hasSubmitted ? "disabled" : ""}>接受 Accept</button>
          <button class="button button-secondary" id="teacherRejectButton" ${action.hasSubmitted ? "disabled" : ""}>拒绝 Reject</button>
        </div>
      `;
      document.getElementById("teacherAcceptButton").addEventListener("click", async () => {
        try {
          await request("/api/ultimatum/teacher/submit-self", {
            method: "POST",
            body: { decision: "accept" },
          });
          await refreshTeacher();
        } catch (error) {
          alert(error.message);
        }
      });
      document.getElementById("teacherRejectButton").addEventListener("click", async () => {
        try {
          await request("/api/ultimatum/teacher/submit-self", {
            method: "POST",
            body: { decision: "reject" },
          });
          await refreshTeacher();
        } catch (error) {
          alert(error.message);
        }
      });
      return;
    }

    node.innerHTML = `
      <p>教师编号 ID ${action.participantId} 已加入，但当前轮次无需教师操作。</p>
      <p>Teacher ID ${action.participantId} has joined, but no action is needed right now.</p>
    `;
  }

  async function refreshTeacher() {
    try {
      const data = await request("/api/ultimatum/teacher/state");
      syncConfig(data.settings);
      setText("teacherStatus", {
        setup: "待设置 Setup",
        lobby: "等待加入 Lobby",
        proposer_collecting: "报价阶段 Proposer Stage",
        responder_collecting: "回应阶段 Responder Stage",
        between_rounds: "等待下一轮 Between Rounds",
        finished: "已结束 Finished",
      }[data.status] || data.status);
      setText("teacherSessionCode", `Session ${data.sessionCode}`);
      setText("roundValue", data.currentRound);
      setText("stageValue", data.currentStage);
      setText("totalRoundsValue", data.totalRounds);
      setText("joinedStudentsValue", `${data.joinedStudentCount}/${data.settings.studentCount}`);
      document.getElementById("joinUrl").textContent = data.joinUrl;
      document.getElementById("ultimatumQr").src =
        "https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=" +
        encodeURIComponent(data.joinUrl);

      document.getElementById("stageRolesText").innerHTML = `
        阶段 1 提出者 Stage 1 proposers: <strong>${data.stageRoles[1].proposers.join(", ") || "--"}</strong><br />
        阶段 1 回应者 Stage 1 responders: <strong>${data.stageRoles[1].responders.join(", ") || "--"}</strong><br />
        阶段 2 提出者 Stage 2 proposers: <strong>${data.stageRoles[2].proposers.join(", ") || "--"}</strong><br />
        阶段 2 回应者 Stage 2 responders: <strong>${data.stageRoles[2].responders.join(", ") || "--"}</strong><br />
        可用学生编号 Open student IDs: <strong>${data.openIds.join(", ") || "none"}</strong>
      `;

      const round = data.currentRoundDetail;
      document.getElementById("roundResults").innerHTML =
        round && round.revealedPairs.length
          ? round.revealedPairs
              .map(
                (pair) => `
                  <p>
                    提出者 ${pair.proposerId} 报价 ${pair.offer} / Proposer ${pair.proposerId} offered ${pair.offer},
                    ${pair.accepted ? "成交 accepted" : "拒绝 rejected"},
                    ${pair.proposerPayoff} / ${pair.responderPayoff}
                  </p>
                `
              )
              .join("")
          : round
            ? `
                <p>报价已提交: ${round.submittedOffers.join(", ") || "--"} / Offers received</p>
                <p>回应已提交: ${round.submittedResponses.join(", ") || "--"} / Responses received</p>
                <p>待报价 ID: ${round.pendingOffers.join(", ") || "--"}</p>
                <p>待回应 ID: ${round.pendingResponses.join(", ") || "--"}</p>
              `
            : "暂无已结算结果 / No settled round yet.";

      const analysis = data.analysis;
      document.getElementById("analysisSummary").innerHTML = `
        <p>平均报价 Average offer: <strong>${formatNumber(analysis.overall.averageOffer)}</strong></p>
        <p>中位报价 Median offer: <strong>${formatNumber(analysis.overall.medianOffer)}</strong></p>
        <p>接受率 Acceptance rate: <strong>${pct(analysis.overall.acceptanceRate)}</strong></p>
        <p>拒绝率 Rejection rate: <strong>${pct(analysis.overall.rejectionRate)}</strong></p>
        <p>阶段 1 平均报价 Stage 1 average offer: <strong>${formatNumber(analysis.stages[1].averageOffer)}</strong></p>
        <p>阶段 2 平均报价 Stage 2 average offer: <strong>${formatNumber(analysis.stages[2].averageOffer)}</strong></p>
        <p>低报价 0-2 的拒绝次数 Rejections on offers 0-2: <strong>${analysis.byBand[0].rejected}</strong> / ${analysis.byBand[0].count}</p>
      `;
      document.getElementById("analysisRounds").innerHTML = analysis.rounds.length
        ? analysis.rounds
            .map(
              (item) => `
                <tr>
                  <td>${item.round}</td>
                  <td>${item.stage}</td>
                  <td>${formatNumber(item.averageOffer)}</td>
                  <td>${pct(item.acceptanceRate)}</td>
                  <td>${item.rejectionCount}</td>
                </tr>
              `
            )
            .join("")
        : `<tr><td colspan="5">暂无分析数据 / No analysis yet.</td></tr>`;

      renderTeacherSelfAction(data);

      const locked = data.currentRound > 0 || data.joinedStudentCount > 0;
      studentCountInput.disabled = locked;
      phaseRoundsInput.disabled = locked;
      pieSizeInput.disabled = locked;
      teacherJoinInput.disabled = locked;
      configForm.querySelector("button").disabled = locked;

      startRoundButton.disabled =
        data.status === "proposer_collecting" ||
        data.status === "responder_collecting" ||
        data.currentRound >= data.totalRounds;
      closeProposersButton.disabled = data.status !== "proposer_collecting";
      closeRespondersButton.disabled = data.status !== "responder_collecting";
    } catch (error) {
      setText("teacherStatus", error.message);
    }
  }

  configForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const response = await request("/api/ultimatum/teacher/configure", {
        method: "POST",
        body: {
          studentCount: Number(studentCountInput.value),
          phaseRounds: Number(phaseRoundsInput.value),
          pieSize: Number(pieSizeInput.value),
          teacherJoinsIfOdd: teacherJoinInput.value === "true",
        },
      });
      syncConfig(response.settings, true);
      await refreshTeacher();
    } catch (error) {
      alert(error.message);
    }
  });

  startRoundButton.addEventListener("click", async () => {
    try {
      await request("/api/ultimatum/teacher/start-round", { method: "POST" });
      await refreshTeacher();
    } catch (error) {
      alert(error.message);
    }
  });

  closeProposersButton.addEventListener("click", async () => {
    try {
      await request("/api/ultimatum/teacher/close-proposers", { method: "POST" });
      await refreshTeacher();
    } catch (error) {
      alert(error.message);
    }
  });

  closeRespondersButton.addEventListener("click", async () => {
    try {
      await request("/api/ultimatum/teacher/close-responders", { method: "POST" });
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
      await request("/api/ultimatum/teacher/reset", { method: "POST" });
      configSynced = false;
      await refreshTeacher();
    } catch (error) {
      alert(error.message);
    }
  });

  refreshTeacher();
  window.setInterval(refreshTeacher, 1500);
}

function initStudent() {
  const studentPanel = document.getElementById("studentPanel");
  const hero = document.getElementById("hero");
  const heroActions = document.getElementById("heroActions");
  hero.classList.add("hidden");
  heroActions.classList.add("hidden");
  studentPanel.classList.remove("hidden");

  const joinCard = document.getElementById("joinCard");
  const joinForm = document.getElementById("joinForm");
  const joinTip = document.getElementById("joinTip");
  const studentWorkspace = document.getElementById("studentWorkspace");
  const proposerCard = document.getElementById("proposerCard");
  const responderCard = document.getElementById("responderCard");
  const offerForm = document.getElementById("offerForm");
  const offerInput = document.getElementById("offerInput");
  const acceptButton = document.getElementById("acceptButton");
  const rejectButton = document.getElementById("rejectButton");
  const studentHistory = document.getElementById("studentHistory");

  let token = window.localStorage.getItem(tokenKey) || "";

  async function refreshStudent() {
    try {
      const meta = await request("/api/ultimatum/meta");

      if (!token) {
        setText("studentStatus", "等待进入 Waiting");
        setText("studentIdBadge", "ID --");
        joinTip.textContent = `可用编号 Open IDs: ${meta.openIds.join(", ") || "none"}`;
        return;
      }

      const data = await request(`/api/ultimatum/student/state?token=${encodeURIComponent(token)}`);
      joinCard.classList.add("hidden");
      studentWorkspace.classList.remove("hidden");

      setText("studentStatus", {
        setup: "待设置 Setup",
        lobby: "等待开始 Waiting",
        proposer_collecting: "报价阶段 Proposer Stage",
        responder_collecting: "回应阶段 Responder Stage",
        between_rounds: "等待下一轮 Between Rounds",
        finished: "已结束 Finished",
      }[data.status] || data.status);
      setText("studentIdBadge", `ID ${data.participant.id}`);
      setText("studentCumulative", formatNumber(data.participant.cumulative));

      const round = data.currentRoundDetail;
      const role = round?.role || "--";
      setText(
        "studentRoleValue",
        role === "proposer" ? "提出者 / Proposer" : role === "responder" ? "回应者 / Responder" : "--"
      );
      setText(
        "studentOfferValue",
        role === "proposer"
          ? formatNumber(round?.submittedOffer)
          : formatNumber(round?.receivedOffer)
      );
      setText("studentPayoffValue", formatNumber(round?.settledPair?.payoff));

      document.getElementById("studentInstruction").innerHTML = !round
        ? "等待教师开始本轮。<br />Waiting for the teacher to start the round."
        : role === "proposer"
          ? round.canSubmitOffer
            ? `你本轮是提出者。请输入 0 到 ${data.settings.pieSize} 的整数报价。<br />You are the proposer this round.`
            : "你本轮是提出者，已经提交或等待下一阶段。<br />You are the proposer and have already submitted or are waiting."
          : role === "responder"
            ? round.canSubmitResponse
              ? `你本轮是回应者。你收到的报价是 <strong>${round.receivedOffer}</strong>。<br />You are the responder this round.`
              : "你本轮是回应者，已经提交或等待结算。<br />You are the responder and have already submitted or are waiting."
            : "等待教师开始本轮。<br />Waiting for the teacher to start the round.";

      proposerCard.classList.toggle("hidden", role !== "proposer");
      responderCard.classList.toggle("hidden", role !== "responder");
      offerInput.max = String(data.settings.pieSize);
      offerInput.disabled = !round?.canSubmitOffer;
      offerForm.querySelector("button").disabled = !round?.canSubmitOffer;
      acceptButton.disabled = !round?.canSubmitResponse;
      rejectButton.disabled = !round?.canSubmitResponse;
      document.getElementById("receivedOfferText").textContent =
        round?.receivedOffer != null
          ? `你收到的报价是 ${round.receivedOffer} / The offer you received is ${round.receivedOffer}`
          : "--";

      studentHistory.innerHTML = data.participant.history.length
        ? data.participant.history
            .map(
              (item) => `
                <tr>
                  <td>${item.round}</td>
                  <td>${item.stage}</td>
                  <td>${item.role}</td>
                  <td>${item.offer}</td>
                  <td>${item.accepted ? "Yes" : "No"}</td>
                  <td>${item.payoff}</td>
                  <td>${formatNumber(item.cumulative)}</td>
                </tr>
              `
            )
            .join("")
        : `<tr><td colspan="7">暂无记录 / No record yet.</td></tr>`;
    } catch (error) {
      if (token) {
        window.localStorage.removeItem(tokenKey);
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
      const data = await request("/api/ultimatum/student/join", {
        method: "POST",
        body: {
          id: Number(document.getElementById("playerIdInput").value),
          token,
        },
      });
      token = data.token;
      window.localStorage.setItem(tokenKey, token);
      await refreshStudent();
    } catch (error) {
      joinTip.textContent = error.message;
    }
  });

  offerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await request("/api/ultimatum/student/submit-offer", {
        method: "POST",
        body: {
          token,
          offer: Number(offerInput.value),
        },
      });
      await refreshStudent();
    } catch (error) {
      alert(error.message);
    }
  });

  acceptButton.addEventListener("click", async () => {
    try {
      await request("/api/ultimatum/student/submit-response", {
        method: "POST",
        body: { token, decision: "accept" },
      });
      await refreshStudent();
    } catch (error) {
      alert(error.message);
    }
  });

  rejectButton.addEventListener("click", async () => {
    try {
      await request("/api/ultimatum/student/submit-response", {
        method: "POST",
        body: { token, decision: "reject" },
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
