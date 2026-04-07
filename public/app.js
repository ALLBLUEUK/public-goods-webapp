const role = new URLSearchParams(window.location.search).get("role") || "home";
const studentTokenKey = "public-goods-student-token";

const teacherPanel = document.getElementById("teacherPanel");
const studentPanel = document.getElementById("studentPanel");
const homeActions = document.getElementById("homeActions");
const homeHero = document.getElementById("homeHero");

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
  return Number.isInteger(value) ? `${value}` : Number(value).toFixed(1);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

function buildRules(settings) {
  return `
    <p><strong>中文</strong></p>
    <p>第 1 轮开始前，每位同学先有 <strong>${formatNumber(settings.endowment)}</strong> 点初始资金。之后不会每轮再自动加钱。</p>
    <p>你每轮可以把 <strong>0 到当前资金</strong> 的整数投入公共账户，其余部分自己保留。</p>
    <p>如果本轮全班总投入是 <strong>G</strong>，那么每个人从公共账户得到 <strong>${formatNumber(settings.multiplier)} × G</strong>。</p>
    <p>所以，本轮结束后的资金 = <strong>当前资金 - 你的投入 + ${formatNumber(settings.multiplier)} × 全班总投入</strong>。</p>
    <p><strong>English</strong></p>
    <p>Before Round 1, each student starts with <strong>${formatNumber(settings.endowment)}</strong> as initial wealth. No new money is added automatically in later rounds.</p>
    <p>Each round, you may contribute any integer from <strong>0 to your current wealth</strong> to the public account and keep the rest.</p>
    <p>If the total class contribution is <strong>G</strong>, each student receives <strong>${formatNumber(settings.multiplier)} × G</strong> from the public account.</p>
    <p>So your end-of-round wealth is <strong>current wealth - your contribution + ${formatNumber(settings.multiplier)} × total class contribution</strong>.</p>
  `;
}

function initTeacher() {
  const joinUrlNode = document.getElementById("joinUrl");
  const qrImage = document.getElementById("qrImage");
  const rankingTable = document.getElementById("rankingTable");
  const historyTable = document.getElementById("historyTable");
  const seatBoard = document.getElementById("seatBoard");
  const teacherRules = document.getElementById("teacherRules");
  const roundResultText = document.getElementById("roundResultText");
  const rankingNameHeader = document.getElementById("rankingNameHeader");
  const configForm = document.getElementById("configForm");
  const seatCountInput = document.getElementById("seatCountInput");
  const maxRoundsInput = document.getElementById("maxRoundsInput");
  const endowmentInput = document.getElementById("endowmentInput");
  const multiplierInput = document.getElementById("multiplierInput");
  const startRoundButton = document.getElementById("startRoundButton");
  const closeRoundButton = document.getElementById("closeRoundButton");
  const resetButton = document.getElementById("resetButton");

  let configSynced = false;

  function syncConfigInputs(settings, force = false) {
    if (!force && configSynced) {
      return;
    }
    seatCountInput.value = settings.seatCount;
    maxRoundsInput.value = settings.maxRounds;
    endowmentInput.value = settings.endowment;
    multiplierInput.value = settings.multiplier;
    configSynced = true;
  }

  async function refreshTeacher() {
    try {
      const data = await request("/api/teacher/state");
      const { settings } = data;

      syncConfigInputs(settings);
      teacherRules.innerHTML = buildRules(settings);

      setText("teacherStatus", {
        setup: "待设置 Setup",
        lobby: "等待开始 Lobby",
        collecting: "本轮进行中 Round Open",
        results: "本轮已结算 Round Closed",
        finished: "全部结束 Finished",
      }[data.status] || data.status);
      setText("teacherSessionCode", `Session ${data.sessionCode}`);
      setText("currentRoundValue", data.currentRound);
      setText("plannedRoundsValue", data.settings.maxRounds);
      setText("joinedCountValue", data.joinedCount);
      setText("submittedCountValue", data.currentRoundSummary?.submittedCount || 0);
      setText("roundTotalValue", formatNumber(data.currentRoundSummary?.totalContribution));
      setText("roundShareValue", formatNumber(data.currentRoundSummary?.publicShare));

      if (data.currentRoundSummary?.status === "closed") {
        roundResultText.innerHTML = `
          <strong>第 ${data.currentRoundSummary.number} 轮已结束 / Round ${data.currentRoundSummary.number} closed</strong><br />
          全班总投入 Total Contribution: <strong>${formatNumber(data.currentRoundSummary.totalContribution)}</strong><br />
          每人公共回报 Public Return per Person: <strong>${formatNumber(data.currentRoundSummary.publicShare)}</strong><br />
          当前累计资金排名已更新。<br />
          The cumulative wealth ranking has been updated.
        `;
      } else if (data.status === "collecting") {
        roundResultText.innerHTML = `
          <strong>第 ${data.currentRound} 轮正在进行 / Round ${data.currentRound} is open</strong><br />
          你可以随时结束本轮。<br />
          You may end the round at any time.
        `;
      } else {
        roundResultText.innerHTML = `
          尚未结束任何轮次。<br />
          No round has been closed yet.
        `;
      }

      joinUrlNode.textContent = data.joinUrl;
      qrImage.src =
        "https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=" +
        encodeURIComponent(data.joinUrl);

      seatBoard.innerHTML = data.players
        .map(
          (player) => `
            <div class="seat-tile">
              <div class="kpi-label">Participant ${player.seat}</div>
              <strong>${player.joined ? "Joined" : "Open"}</strong>
              <div class="tiny">${
                data.status === "finished" && player.joined
                  ? `Name: ${escapeHtml(player.name || "-")}`
                  : player.joined
                    ? "姓名仅在最后揭晓 / Name hidden until the end"
                    : "-"
              }</div>
              <div class="tiny">Wealth: ${formatNumber(player.cumulative)}</div>
            </div>
          `
        )
        .join("");

      const revealNames = data.status === "finished";
      rankingNameHeader.classList.toggle("hidden", !revealNames);
      rankingTable.innerHTML = data.ranking.length
        ? data.ranking
            .map((item, index) => {
              const player = data.players.find((p) => p.seat === item.seat);
              return `
                <tr>
                  <td>${index + 1}</td>
                  ${revealNames ? `<td>${escapeHtml(player?.name || "-")}</td>` : ""}
                  <td>${formatNumber(item.cumulative)}</td>
                </tr>
              `;
            })
            .join("")
        : `<tr><td colspan="${revealNames ? 3 : 2}">暂无参与者 / No players yet.</td></tr>`;

      historyTable.innerHTML = data.roundHistory.length
        ? data.roundHistory
            .map(
              (round) => `
                <tr>
                  <td>${round.number}</td>
                  <td>${formatNumber(round.totalContribution)}</td>
                  <td>${formatNumber(round.publicShare)}</td>
                  <td>${round.submittedCount}</td>
                </tr>
              `
            )
            .join("")
        : `<tr><td colspan="4">暂无已结算轮次 / No closed rounds yet.</td></tr>`;

      const locked = data.currentRound > 0 || data.joinedCount > 0;
      seatCountInput.disabled = locked;
      maxRoundsInput.disabled = locked;
      endowmentInput.disabled = locked;
      multiplierInput.disabled = locked;
      configForm.querySelector("button").disabled = locked;

      startRoundButton.disabled =
        data.status === "collecting" || data.currentRound >= data.settings.maxRounds;
      closeRoundButton.disabled = data.status !== "collecting";
    } catch (error) {
      setText("teacherStatus", error.message);
    }
  }

  configForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const response = await request("/api/teacher/configure", {
        method: "POST",
        body: {
          seatCount: Number(seatCountInput.value),
          maxRounds: Number(maxRoundsInput.value),
          endowment: Number(endowmentInput.value),
          multiplier: Number(multiplierInput.value),
        },
      });
      syncConfigInputs(response.settings, true);
      await refreshTeacher();
    } catch (error) {
      alert(error.message);
    }
  });

  startRoundButton.addEventListener("click", async () => {
    try {
      await request("/api/teacher/start-round", { method: "POST" });
      await refreshTeacher();
    } catch (error) {
      alert(error.message);
    }
  });

  closeRoundButton.addEventListener("click", async () => {
    try {
      await request("/api/teacher/close-round", { method: "POST" });
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
      await request("/api/teacher/reset", { method: "POST" });
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
  const joinCard = document.getElementById("joinCard");
  const joinForm = document.getElementById("joinForm");
  const joinTip = document.getElementById("joinTip");
  const nameInput = document.getElementById("nameInput");
  const studentWorkspace = document.getElementById("studentWorkspace");
  const studentRules = document.getElementById("studentRules");
  const submitForm = document.getElementById("submitForm");
  const contributionInput = document.getElementById("contributionInput");
  const studentHistory = document.getElementById("studentHistory");

  let token = window.localStorage.getItem(studentTokenKey) || "";

  async function refreshStudent() {
    try {
      const meta = await request("/api/meta");
      studentRules.innerHTML = buildRules(meta.settings);

      if (!token) {
        setText("studentStatus", "等待进入 Waiting");
        setText("studentSeatBadge", "Participant --");
        setText("studentAvailableWealth", "0");
        return;
      }

      const data = await request(`/api/student/state?token=${encodeURIComponent(token)}`);

      joinCard.classList.add("hidden");
      studentWorkspace.classList.remove("hidden");
      setText(
        "studentStatus",
        {
          setup: "等待教师设置 Waiting for setup",
          lobby: "等待教师开始 Waiting",
          collecting: data.currentRoundSummary?.submitted ? "已提交 Submitted" : "正在提交 Collecting",
          results: "本轮已结算 Round Closed",
          finished: "实验已结束 Finished",
        }[data.status] || data.status
      );
      setText("studentSeatBadge", `Participant ${data.player.seat}`);
      setText("studentAvailableWealth", formatNumber(data.player.availableWealth));
      setText("studentCumulative", formatNumber(data.player.cumulative));
      setText("studentRoundTotal", formatNumber(data.currentRoundSummary?.totalContribution));
      setText("studentRoundShare", formatNumber(data.currentRoundSummary?.publicShare));
      contributionInput.max = String(data.player.availableWealth);

      const instruction = document.getElementById("studentInstruction");
      if (data.status === "setup" || data.status === "lobby") {
        instruction.textContent = "教师还没有开始本轮。The teacher has not started the round yet.";
      } else if (data.status === "collecting") {
        instruction.textContent = data.currentRoundSummary?.submitted
          ? `第 ${data.currentRound} 轮已提交：你投了 ${data.currentRoundSummary.ownContribution}。Round ${data.currentRound} submitted.`
          : `第 ${data.currentRound} 轮进行中。你当前资金是 ${formatNumber(data.player.availableWealth)}。请输入 0 到 ${formatNumber(data.player.availableWealth)} 的整数。`;
      } else if (data.status === "results") {
        instruction.textContent = "本轮已结束，请查看你的当前资金和公共回报。Round closed. Check your current wealth and the public return.";
      } else if (data.status === "finished") {
        instruction.textContent = "全部轮次结束。All rounds are finished.";
      }

      const canSubmit = data.status === "collecting" && !data.currentRoundSummary?.submitted;
      contributionInput.disabled = !canSubmit;
      submitForm.querySelector("button").disabled = !canSubmit;

      studentHistory.innerHTML = data.player.history.length
        ? data.player.history
            .map(
              (item) => `
                <tr>
                  <td>${item.round}</td>
                  <td>${formatNumber(item.startWealth)}</td>
                  <td>${formatNumber(item.contribution)}</td>
                  <td>${formatNumber(item.privateKeep)}</td>
                  <td>${formatNumber(item.totalContribution)}</td>
                  <td>${formatNumber(item.score)}</td>
                  <td>${formatNumber(item.cumulative)}</td>
                </tr>
              `
            )
            .join("")
        : `<tr><td colspan="7">暂无已结算轮次 / No settled rounds yet.</td></tr>`;
    } catch (error) {
      if (token) {
        window.localStorage.removeItem(studentTokenKey);
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
      const data = await request("/api/student/join", {
        method: "POST",
        body: {
          name: nameInput.value.trim(),
          token,
        },
      });
      token = data.token;
      window.localStorage.setItem(studentTokenKey, token);
      await refreshStudent();
    } catch (error) {
      joinTip.textContent = error.message;
    }
  });

  submitForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await request("/api/student/submit", {
        method: "POST",
        body: {
          token,
          contribution: Number(contributionInput.value),
        },
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
  homeHero?.classList.add("hidden");
  teacherPanel?.classList.remove("hidden");
  homeActions?.classList.add("hidden");
  initTeacher();
} else if (role === "student") {
  homeHero?.classList.add("hidden");
  studentPanel?.classList.remove("hidden");
  homeActions?.classList.add("hidden");
  initStudent();
}
