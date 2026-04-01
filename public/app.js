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
  return Number.isInteger(value) ? `${value}` : `${Number(value).toFixed(1)}`;
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
    <p>
      每一轮，每位同学先拿到 <strong>${formatNumber(settings.endowment)}</strong> 点初始资金。
      你可以把其中一部分投入公共账户，也可以自己保留。投入必须是
      <strong>0 到 ${formatNumber(settings.endowment)}</strong> 的整数。
    </p>
    <p>
      你本轮资金 = <strong>自己保留的资金</strong> + <strong>公共账户给每个人分到的回报</strong>。
      如果本轮全班总投入是 <strong>G</strong>，那么每位同学从公共账户得到
      <strong>${formatNumber(settings.multiplier)} × G</strong>。
    </p>
    <p>
      所以，你本轮资金 = <strong>${formatNumber(settings.endowment)} - 你的投入 + ${formatNumber(settings.multiplier)} × 全班总投入</strong>。
      累计资金越高越好。
    </p>
    <p><strong>English</strong></p>
    <p>
      In each round, every student receives <strong>${formatNumber(settings.endowment)}</strong> points as initial wealth.
      You may contribute some of it to the public account and keep the rest for yourself.
      Your contribution must be an integer between <strong>0</strong> and <strong>${formatNumber(settings.endowment)}</strong>.
    </p>
    <p>
      Your wealth this round = <strong>the amount you keep</strong> +
      <strong>the public return shared with each person</strong>.
      If the class total contribution is <strong>G</strong>, each student receives
      <strong>${formatNumber(settings.multiplier)} × G</strong> from the public account.
    </p>
    <p>
      So, your round wealth = <strong>${formatNumber(settings.endowment)} - your contribution + ${formatNumber(settings.multiplier)} × total class contribution</strong>.
      Higher cumulative wealth is better.
    </p>
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
  const configForm = document.getElementById("configForm");
  const seatCountInput = document.getElementById("seatCountInput");
  const maxRoundsInput = document.getElementById("maxRoundsInput");
  const endowmentInput = document.getElementById("endowmentInput");
  const multiplierInput = document.getElementById("multiplierInput");
  const startRoundButton = document.getElementById("startRoundButton");
  const closeRoundButton = document.getElementById("closeRoundButton");
  const resetButton = document.getElementById("resetButton");

  async function refreshTeacher() {
    try {
      const data = await request("/api/teacher/state");
      const { settings } = data;

      seatCountInput.value = settings.seatCount;
      maxRoundsInput.value = settings.maxRounds;
      endowmentInput.value = settings.endowment;
      multiplierInput.value = settings.multiplier;

      teacherRules.innerHTML = buildRules(settings);
      setText("teacherStatus", {
        setup: "待设置 Setup",
        lobby: "等待开始 Lobby",
        collecting: "正在收集 Collecting",
        results: "已结算 Results",
        finished: "已结束 Finished",
      }[data.status] || data.status);
      setText("teacherSessionCode", `Session ${data.sessionCode}`);
      setText("currentRoundValue", `${data.currentRound}`);
      setText("plannedRoundsValue", `${data.settings.maxRounds}`);
      setText("joinedCountValue", `${data.joinedCount}`);
      setText("submittedCountValue", `${data.currentRoundSummary?.submittedCount || 0}`);
      setText("roundTotalValue", formatNumber(data.currentRoundSummary?.totalContribution));
      setText("roundShareValue", formatNumber(data.currentRoundSummary?.publicShare));

      if (data.currentRoundSummary?.status === "closed") {
        roundResultText.innerHTML = `
          第 ${data.currentRoundSummary.number} 轮已结束。<br />
          Round ${data.currentRoundSummary.number} is closed.<br /><br />
          全班总投入 Total Contribution:
          <strong>${formatNumber(data.currentRoundSummary.totalContribution)}</strong><br />
          每人公共回报 Public Return per Person:
          <strong>${formatNumber(data.currentRoundSummary.publicShare)}</strong><br />
          当前累计资金排名已更新。<br />
          The wealth ranking has been updated.
        `;
      } else if (data.status === "collecting") {
        roundResultText.innerHTML = `
          第 ${data.currentRound} 轮进行中。<br />
          Round ${data.currentRound} is open.<br /><br />
          你可以随时点击“结束本轮”。<br />
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
        .map((player) => {
          const active = data.currentRoundSummary?.submissions?.find((item) => item.seat === player.seat);
          return `
            <div class="seat-tile">
              <div class="kpi-label">Seat ${player.seat}</div>
              <strong>${player.joined ? "Joined" : "Open"}</strong>
              <div>${escapeHtml(player.name || "-")}</div>
              <div class="tiny">Wealth ${formatNumber(player.cumulative)}</div>
              <div class="tiny">${
                active ? `Submitted ${formatNumber(active.contribution)}` : "No submission yet"
              }</div>
            </div>
          `;
        })
        .join("");

      rankingTable.innerHTML = data.ranking.length
        ? data.ranking
            .map(
              (item, index) => `
                <tr>
                  <td>${index + 1}</td>
                  <td>${item.seat}</td>
                  <td>${escapeHtml(item.name || `P${item.seat}`)}</td>
                  <td>${formatNumber(item.cumulative)}</td>
                </tr>
              `
            )
            .join("")
        : `<tr><td colspan="4">No players yet.</td></tr>`;

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
        : `<tr><td colspan="4">No closed rounds yet.</td></tr>`;

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
      await request("/api/teacher/configure", {
        method: "POST",
        body: {
          seatCount: Number(seatCountInput.value),
          maxRounds: Number(maxRoundsInput.value),
          endowment: Number(endowmentInput.value),
          multiplier: Number(multiplierInput.value),
        },
      });
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
    if (!window.confirm("确定要重置整场实验吗？ Are you sure to reset the whole session?")) {
      return;
    }
    try {
      await request("/api/teacher/reset", { method: "POST" });
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
  const seatInput = document.getElementById("seatInput");
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
      const { settings } = meta;
      studentRules.innerHTML = buildRules(settings);
      contributionInput.max = settings.endowment;

      const currentSeats = Array.from(seatInput.options).map((option) => Number(option.value));
      if (
        currentSeats.length !== settings.seatCount ||
        currentSeats.some((value, index) => value !== index + 1)
      ) {
        seatInput.innerHTML = Array.from({ length: settings.seatCount }, (_, index) => {
          const seat = index + 1;
          return `<option value="${seat}">${seat}</option>`;
        }).join("");
      }

      if (!token) {
        setText("studentStatus", "等待进入 Waiting");
        setText("studentSeatBadge", `Seat --`);
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
      setText("studentSeatBadge", `Seat ${data.player.seat}`);
      setText("studentCumulative", formatNumber(data.player.cumulative));
      setText("studentRoundTotal", formatNumber(data.currentRoundSummary?.totalContribution));
      setText("studentRoundShare", formatNumber(data.currentRoundSummary?.publicShare));

      const instruction = document.getElementById("studentInstruction");
      if (data.status === "setup" || data.status === "lobby") {
        instruction.textContent = "教师还没有开始本轮。The teacher has not started the round yet.";
      } else if (data.status === "collecting") {
        instruction.textContent = data.currentRoundSummary?.submitted
          ? `第 ${data.currentRound} 轮已提交：你投了 ${data.currentRoundSummary.ownContribution}。 Round ${data.currentRound} submitted.`
          : `第 ${data.currentRound} 轮进行中。请输入 0 到 ${data.settings.endowment} 的整数。 Round ${data.currentRound} is open.`;
      } else if (data.status === "results") {
        instruction.textContent =
          "教师已结束本轮，请查看本轮资金与累计资金。Round closed. Check your wealth.";
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
                  <td>${formatNumber(item.endowment)}</td>
                  <td>${formatNumber(item.contribution)}</td>
                  <td>${formatNumber(item.privateKeep)}</td>
                  <td>${formatNumber(item.totalContribution)}</td>
                  <td>${formatNumber(item.score)}</td>
                  <td>${formatNumber(item.cumulative)}</td>
                </tr>
              `
            )
            .join("")
        : `<tr><td colspan="7">No settled rounds yet.</td></tr>`;
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
          seat: Number(seatInput.value),
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
  homeHero.classList.add("hidden");
  teacherPanel.classList.remove("hidden");
  homeActions?.classList.add("hidden");
  initTeacher();
} else if (role === "student") {
  homeHero.classList.add("hidden");
  studentPanel.classList.remove("hidden");
  homeActions?.classList.add("hidden");
  initStudent();
}
