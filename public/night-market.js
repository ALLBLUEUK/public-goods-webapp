const role = new URLSearchParams(window.location.search).get("role") || "home";
const studentTokenKey = "night-market-student-token";

const teacherPanel = document.getElementById("teacherPanel");
const studentPanel = document.getElementById("studentPanel");
const hero = document.getElementById("hero");
const heroActions = document.getElementById("heroActions");

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

function choiceLabel(entered) {
  return entered ? "进场 / Enter" : "休息 / Stay Home";
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
    window.localStorage.setItem(studentTokenKey, token);
    url.searchParams.set("token", token);
  } else {
    window.localStorage.removeItem(studentTokenKey);
    url.searchParams.delete("token");
  }
  window.history.replaceState({}, "", url.toString());
}

function buildReferenceTable(settings) {
  const rows = Array.from({ length: settings.seatCount }, (_, index) => {
    const entrants = index + 1;
    const revenuePerHour = Math.max(
      0,
      settings.baseRevenuePerHour - settings.crowdPenalty * index
    );
    return `
      <tr>
        <td>${entrants}</td>
        <td>${revenuePerHour}</td>
      </tr>
    `;
  }).join("");

  return `
    <table class="rules-table">
      <thead>
        <tr>
          <th>进场摊位 Entrants</th>
          <th>每小时收入 Revenue per Hour</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function buildRules(settings) {
  return `
    <p><strong>中文</strong></p>
    <p>每一轮，你先决定今晚要不要进夜市摆摊。如果进场，再决定摆几个小时。</p>
    <p>如果你不进场，这一轮收入就是 0。</p>
    <p>如果你进场，你要先付固定摊位费 <strong>${formatNumber(settings.stallFee)}</strong>，每摆 1 小时还要付运营成本 <strong>${formatNumber(settings.hourlyCost)}</strong>。</p>
    <p>如果只有 1 个摊位进场，每小时收入是 <strong>${formatNumber(settings.baseRevenuePerHour)}</strong>。每多 1 个摊位进场，每小时收入就下降 <strong>${formatNumber(settings.crowdPenalty)}</strong>。</p>
    <p>所以，进场人数少时，多摆几个小时可能更赚钱；进场人数太多时，多摆反而可能亏钱。</p>
    ${buildReferenceTable(settings)}
    <p><strong>English</strong></p>
    <p>Each round, you first decide whether to enter the night market. If you enter, you then choose how many hours to stay open.</p>
    <p>If you stay home, your payoff for the round is 0.</p>
    <p>If you enter, you first pay a fixed stall fee of <strong>${formatNumber(settings.stallFee)}</strong>, and every hour you stay open costs <strong>${formatNumber(settings.hourlyCost)}</strong> to run.</p>
    <p>If only 1 stall enters, the revenue per hour is <strong>${formatNumber(settings.baseRevenuePerHour)}</strong>. Every additional stall reduces revenue per hour by <strong>${formatNumber(settings.crowdPenalty)}</strong>.</p>
    <p>So when few stalls enter, staying open longer can be profitable. When too many stalls enter, longer hours can backfire.</p>
  `;
}

function initTeacher() {
  const teacherRules = document.getElementById("teacherRules");
  const configForm = document.getElementById("configForm");
  const seatCountInput = document.getElementById("seatCountInput");
  const maxRoundsInput = document.getElementById("maxRoundsInput");
  const maxHoursInput = document.getElementById("maxHoursInput");
  const baseRevenuePerHourInput = document.getElementById("baseRevenuePerHourInput");
  const crowdPenaltyInput = document.getElementById("crowdPenaltyInput");
  const hourlyCostInput = document.getElementById("hourlyCostInput");
  const stallFeeInput = document.getElementById("stallFeeInput");
  const startRoundButton = document.getElementById("startRoundButton");
  const closeRoundButton = document.getElementById("closeRoundButton");
  const resetButton = document.getElementById("resetButton");
  const joinUrlNode = document.getElementById("joinUrl");
  const qrImage = document.getElementById("qrImage");
  const stallBoard = document.getElementById("stallBoard");
  const rankingNameHeader = document.getElementById("rankingNameHeader");
  const rankingTable = document.getElementById("rankingTable");
  const roundDetailTable = document.getElementById("roundDetailTable");
  const historyTable = document.getElementById("historyTable");
  const roundResultText = document.getElementById("roundResultText");

  let configSynced = false;
  let configDirty = false;

  function syncConfigInputs(settings, force = false) {
    if (!force && (configSynced || configDirty)) {
      return;
    }
    seatCountInput.value = settings.seatCount;
    maxRoundsInput.value = settings.maxRounds;
    maxHoursInput.value = settings.maxHours;
    baseRevenuePerHourInput.value = settings.baseRevenuePerHour;
    crowdPenaltyInput.value = settings.crowdPenalty;
    hourlyCostInput.value = settings.hourlyCost;
    stallFeeInput.value = settings.stallFee;
    configSynced = true;
  }

  async function refreshTeacher() {
    try {
      const data = await request("/api/night-market/teacher/state");
      const { settings } = data;
      syncConfigInputs(settings);
      teacherRules.innerHTML = buildRules(settings);

      setText(
        "teacherStatus",
        {
          setup: "等待设置 / Setup",
          lobby: "等待开局 / Lobby",
          collecting: "本轮进行中 / Round Open",
          results: "本轮已结算 / Round Closed",
          finished: "全部结束 / Finished",
        }[data.status] || data.status
      );
      setText("teacherSessionCode", `Session ${data.sessionCode}`);
      setText("currentRoundValue", data.currentRound);
      setText("plannedRoundsValue", data.settings.maxRounds);
      setText("joinedCountValue", `${data.joinedCount}/${data.settings.seatCount}`);
      setText("submittedCountValue", data.currentRoundSummary?.submittedCount || 0);
      setText("entrantsCountValue", formatNumber(data.currentRoundSummary?.entrantsCount));
      setText("revenuePerHourValue", formatNumber(data.currentRoundSummary?.revenuePerHour));
      setText("averageHoursValue", formatNumber(data.currentRoundSummary?.averageHours));

      if (data.currentRoundSummary?.status === "closed") {
        const round = data.currentRoundSummary;
        if (!round.entrantsCount) {
          roundResultText.innerHTML = `
            <strong>第 ${round.number} 轮已结算 / Round ${round.number} closed</strong><br />
            这一轮没有人进场，所以所有人收入都是 0。<br />
            No one entered the market this round, so everyone earned 0.
          `;
        } else {
          roundResultText.innerHTML = `
            <strong>第 ${round.number} 轮已结算 / Round ${round.number} closed</strong><br />
            本轮共有 <strong>${round.entrantsCount}</strong> 个摊位进场，因此每个进场摊位每小时收入是 <strong>${formatNumber(round.revenuePerHour)}</strong>。<br />
            <strong>${round.entrantsCount}</strong> stalls entered, so revenue per open hour was <strong>${formatNumber(round.revenuePerHour)}</strong>.<br />
            进场摊位平均营业 <strong>${formatNumber(round.averageHours)}</strong> 小时，总营业小时是 <strong>${formatNumber(round.totalOpenHours)}</strong>。<br />
            Entering stalls stayed open for an average of <strong>${formatNumber(round.averageHours)}</strong> hours, with <strong>${formatNumber(round.totalOpenHours)}</strong> total open hours.
          `;
        }
      } else if (data.status === "collecting") {
        roundResultText.innerHTML = `
          <strong>第 ${data.currentRound} 轮进行中 / Round ${data.currentRound} is open</strong><br />
          学生正在决定进不进夜市以及摆几个小时。你可以等大家都提交后再结束本轮。<br />
          Students are deciding whether to enter the market and how many hours to stay open. You can wait until everyone has submitted before closing the round.
        `;
      } else {
        roundResultText.innerHTML = `
          还没有结算轮次。<br />
          No round has been settled yet.
        `;
      }

      joinUrlNode.textContent = data.joinUrl;
      qrImage.src =
        "https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=" +
        encodeURIComponent(data.joinUrl);

      stallBoard.innerHTML = data.players
        .map(
          (player) => `
            <div class="seat-tile">
              <div class="kpi-label">Seat ${player.seat}</div>
              <strong>${escapeHtml(player.stall)}</strong>
              <div class="tiny">${
                data.status === "finished" && player.joined
                  ? `Name: ${escapeHtml(player.name || "-")}`
                  : player.joined
                    ? "已加入 / Joined"
                    : "空位 / Open"
              }</div>
              <div class="tiny">累计到手 / Total: ${formatNumber(player.cumulative)}</div>
            </div>
          `
        )
        .join("");

      const revealNames = data.status === "finished";
      rankingNameHeader.classList.toggle("hidden", !revealNames);
      rankingTable.innerHTML = data.ranking.length
        ? data.ranking
            .map((item, index) => {
              const player = data.players.find((candidate) => candidate.seat === item.seat);
              return `
                <tr>
                  <td>${index + 1}</td>
                  ${revealNames ? `<td>${escapeHtml(player?.name || "-")}</td>` : ""}
                  <td>${escapeHtml(item.stall)}</td>
                  <td>${formatNumber(item.cumulative)}</td>
                </tr>
              `;
            })
            .join("")
        : `<tr><td colspan="${revealNames ? 4 : 3}">暂无参与者 / No players yet.</td></tr>`;

      historyTable.innerHTML = data.roundHistory.length
        ? data.roundHistory
            .map(
              (round) => `
                <tr>
                  <td>${round.number}</td>
                  <td>${formatNumber(round.entrantsCount)}</td>
                  <td>${formatNumber(round.revenuePerHour)}</td>
                  <td>${formatNumber(round.averageHours)}</td>
                  <td>${formatNumber(round.totalOpenHours)}</td>
                  <td>${round.submittedCount}</td>
                </tr>
              `
            )
            .join("")
        : `<tr><td colspan="6">暂无已结算轮次 / No closed rounds yet.</td></tr>`;

      const round = data.currentRoundSummary;
      if (!round) {
        roundDetailTable.innerHTML =
          `<tr><td colspan="6">还没有进行中的轮次或结果。 / There is no active or settled round yet.</td></tr>`;
      } else if (round.status === "closed") {
        roundDetailTable.innerHTML = round.resolvedChoices
          .map(
            (item) => `
              <tr>
                <td>${item.seat}</td>
                <td>${escapeHtml(item.stall)}</td>
                <td>${choiceLabel(item.enter)}${item.defaulted ? " (default)" : ""}</td>
                <td>${formatNumber(item.hours)}</td>
                <td>${item.enter ? formatNumber(round.revenuePerHour) : "--"}</td>
                <td>${formatNumber(item.takeHome)}</td>
              </tr>
            `
          )
          .join("");
      } else {
        const submittedSeats = new Set(round.submissions.map((item) => item.seat));
        roundDetailTable.innerHTML = data.players
          .filter((player) => player.joined)
          .map(
            (player) => `
              <tr>
                <td>${player.seat}</td>
                <td>${escapeHtml(player.stall)}</td>
                <td>${submittedSeats.has(player.seat) ? "已提交 / Submitted" : "等待中 / Waiting"}</td>
                <td>--</td>
                <td>--</td>
                <td>--</td>
              </tr>
            `
          )
          .join("");
      }

      const locked = data.currentRound > 0 || data.joinedCount > 0;
      [
        seatCountInput,
        maxRoundsInput,
        maxHoursInput,
        baseRevenuePerHourInput,
        crowdPenaltyInput,
        hourlyCostInput,
        stallFeeInput,
      ].forEach((input) => {
        input.disabled = locked;
      });
      configForm.querySelector("button").disabled = locked;

      startRoundButton.disabled =
        data.status === "collecting" ||
        data.currentRound >= data.settings.maxRounds ||
        data.joinedCount !== data.settings.seatCount ||
        data.status === "setup";
      closeRoundButton.disabled = data.status !== "collecting";
    } catch (error) {
      setText("teacherStatus", error.message);
    }
  }

  configForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const response = await request("/api/night-market/teacher/configure", {
        method: "POST",
        body: {
          seatCount: Number(seatCountInput.value),
          maxRounds: Number(maxRoundsInput.value),
          maxHours: Number(maxHoursInput.value),
          baseRevenuePerHour: Number(baseRevenuePerHourInput.value),
          crowdPenalty: Number(crowdPenaltyInput.value),
          hourlyCost: Number(hourlyCostInput.value),
          stallFee: Number(stallFeeInput.value),
        },
      });
      configDirty = false;
      syncConfigInputs(response.settings, true);
      await refreshTeacher();
    } catch (error) {
      alert(error.message);
    }
  });

  startRoundButton.addEventListener("click", async () => {
    try {
      await request("/api/night-market/teacher/start-round", { method: "POST" });
      await refreshTeacher();
    } catch (error) {
      alert(error.message);
    }
  });

  closeRoundButton.addEventListener("click", async () => {
    try {
      await request("/api/night-market/teacher/close-round", { method: "POST" });
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
      await request("/api/night-market/teacher/reset", { method: "POST" });
      configSynced = false;
      configDirty = false;
      await refreshTeacher();
    } catch (error) {
      alert(error.message);
    }
  });

  [
    seatCountInput,
    maxRoundsInput,
    maxHoursInput,
    baseRevenuePerHourInput,
    crowdPenaltyInput,
    hourlyCostInput,
    stallFeeInput,
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
  const joinCard = document.getElementById("joinCard");
  const joinForm = document.getElementById("joinForm");
  const joinButton = joinForm.querySelector("button");
  const nameInput = document.getElementById("nameInput");
  const joinTip = document.getElementById("joinTip");
  const studentRules = document.getElementById("studentRules");
  const studentWorkspace = document.getElementById("studentWorkspace");
  const submitForm = document.getElementById("submitForm");
  const entryChoices = document.getElementById("entryChoices");
  const hourChoices = document.getElementById("hourChoices");
  const enterInput = document.getElementById("enterInput");
  const hoursInput = document.getElementById("hoursInput");
  const studentHistory = document.getElementById("studentHistory");

  let token = getTokenFromUrl() || window.localStorage.getItem(studentTokenKey) || "";
  let renderedMaxHours = 0;
  let canSubmitNow = false;

  if (token) {
    persistStudentToken(token);
  }

  function syncChoiceAvailability() {
    const entered = enterInput.value === "true";
    entryChoices.querySelectorAll("button").forEach((button) => {
      button.disabled = !canSubmitNow;
    });
    hourChoices.querySelectorAll("button").forEach((button) => {
      button.disabled = !canSubmitNow || !entered;
    });
    submitForm.querySelector('button[type="submit"]').disabled = !canSubmitNow;
  }

  function updateEntrySelection(value) {
    enterInput.value = value === "true" ? "true" : "false";
    entryChoices.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("active", button.dataset.enter === enterInput.value);
    });
    syncChoiceAvailability();
  }

  function updateHourSelection(value) {
    hoursInput.value = String(value);
    hourChoices.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("active", Number(button.dataset.hours) === Number(value));
    });
  }

  function renderEntryChoices() {
    entryChoices.innerHTML = `
      <button class="choice-button" type="button" data-enter="true">
        <strong>进场 / Enter</strong>
        <span>付摊位费，赌今晚客流不错 / Pay the stall fee and bet on good traffic</span>
      </button>
      <button class="choice-button" type="button" data-enter="false">
        <strong>休息 / Stay Home</strong>
        <span>这一轮不摆摊，收入 0 / Skip the market and earn 0 this round</span>
      </button>
    `;
    entryChoices.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        updateEntrySelection(button.dataset.enter);
      });
    });
    updateEntrySelection(enterInput.value);
  }

  function renderHourChoices(maxHours) {
    if (renderedMaxHours === maxHours) {
      updateHourSelection(hoursInput.value || 1);
      syncChoiceAvailability();
      return;
    }

    renderedMaxHours = maxHours;
    hourChoices.innerHTML = Array.from({ length: maxHours }, (_, index) => {
      const hours = index + 1;
      return `
        <button class="choice-button" type="button" data-hours="${hours}">
          <strong>${hours} 小时 / ${hours}h</strong>
          <span>${hours === 1 ? "短试一晚 / Short shift" : hours === maxHours ? "拼满全场 / Full night" : "中间时长 / Mid shift"}</span>
        </button>
      `;
    }).join("");

    hourChoices.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        updateHourSelection(Number(button.dataset.hours));
      });
    });
    updateHourSelection(hoursInput.value || 1);
    syncChoiceAvailability();
  }

  renderEntryChoices();

  async function refreshStudent() {
    try {
      const meta = await request("/api/night-market/meta");
      studentRules.innerHTML = buildRules(meta.settings);
      renderHourChoices(meta.settings.maxHours);

      if (!token) {
        setText("studentStatus", "等待进入 / Waiting");
        setText("studentSeatBadge", "Seat --");
        setText("studentStallTitle", "你的摊位 / Your stall: --");
        setText("studentOwnEntry", "--");
        setText("studentOwnHours", "--");
        setText("studentEntrantsCount", "--");
        setText("studentRevenuePerHour", "--");
        setText("studentTakeHome", "--");
        setText("studentCumulative", "0");
        canSubmitNow = false;
        syncChoiceAvailability();
        const joinOpen = meta.status === "lobby" && meta.currentRound === 0;
        nameInput.disabled = !joinOpen;
        joinButton.disabled = !joinOpen;
        joinTip.textContent = joinOpen
          ? "请输入名字或代号后进入。 / Enter your name or alias to join."
          : "老师还没完成设置，或者第一轮已经开始。学生只能在开局前加入。 / The teacher has not finished setup, or Round 1 has already started. Students can only join before the session begins.";
        return;
      }

      const data = await request(
        `/api/night-market/student/state?token=${encodeURIComponent(token)}`
      );
      joinCard.classList.add("hidden");
      studentWorkspace.classList.remove("hidden");

      setText(
        "studentStatus",
        {
          setup: "等待设置 / Setup",
          lobby: "等待老师开局 / Waiting",
          collecting: data.currentRoundSummary?.submitted
            ? "已提交 / Submitted"
            : "正在选择 / Choosing",
          results: "本轮已结算 / Round Closed",
          finished: "全部结束 / Finished",
        }[data.status] || data.status
      );
      setText("studentSeatBadge", `Seat ${data.player.seat} · ${data.player.stall}`);
      setText("studentStallTitle", `你的摊位 / Your stall: ${data.player.stall}`);
      setText(
        "studentOwnEntry",
        data.currentRoundSummary?.ownEnter == null
          ? "--"
          : choiceLabel(data.currentRoundSummary.ownEnter)
      );
      setText(
        "studentOwnHours",
        data.currentRoundSummary?.ownHours == null
          ? "--"
          : formatNumber(data.currentRoundSummary.ownHours)
      );
      setText("studentEntrantsCount", formatNumber(data.currentRoundSummary?.entrantsCount));
      setText(
        "studentRevenuePerHour",
        formatNumber(data.currentRoundSummary?.revenuePerHour)
      );
      setText("studentTakeHome", formatNumber(data.currentRoundSummary?.takeHome));
      setText("studentCumulative", formatNumber(data.player.cumulative));

      const instruction = document.getElementById("studentInstruction");
      if (data.status === "setup" || data.status === "lobby") {
        instruction.textContent =
          "老师还没有开始本轮。 / The teacher has not started the round yet.";
      } else if (data.status === "collecting") {
        instruction.textContent = data.currentRoundSummary?.submitted
          ? `第 ${data.currentRound} 轮你已经提交，请等待老师结算。 / You have already submitted your Round ${data.currentRound} choice. Please wait for settlement.`
          : `第 ${data.currentRound} 轮正在进行。先决定进不进夜市，再决定摆几个小时。 / Round ${data.currentRound} is open. First decide whether to enter the market, then choose how many hours to stay open.`;
      } else if (data.status === "results") {
        instruction.textContent = data.currentRoundSummary?.defaulted
          ? "你本轮没有提交，系统按休息处理。请查看这轮结算结果。 / You did not submit this round, so the system treated you as staying home. Please review the round result."
          : "本轮已经结算。请查看进场人数、每小时收入和你最后到手多少。 / This round has been settled. Check the number of entrants, revenue per hour, and how much you took home.";
      } else if (data.status === "finished") {
        instruction.textContent =
          "全部轮次已结束。你可以回看自己的全部记录。 / All rounds are finished. You can review your full history.";
      }

      if (data.currentRoundSummary?.submitted) {
        updateEntrySelection(String(Boolean(data.currentRoundSummary.ownEnter)));
        updateHourSelection(data.currentRoundSummary.ownHours || 1);
      }

      canSubmitNow = data.status === "collecting" && !data.currentRoundSummary?.submitted;
      syncChoiceAvailability();

      studentHistory.innerHTML = data.player.history.length
        ? data.player.history
            .map(
              (item) => `
                <tr>
                  <td>${item.round}</td>
                  <td>${choiceLabel(item.entered)}${item.defaulted ? " (default)" : ""}</td>
                  <td>${formatNumber(item.openHours)}</td>
                  <td>${formatNumber(item.entrantsCount)}</td>
                  <td>${formatNumber(item.revenuePerHour)}</td>
                  <td>${formatNumber(item.takeHome)}</td>
                  <td>${formatNumber(item.cumulative)}</td>
                </tr>
              `
            )
            .join("")
        : `<tr><td colspan="7">暂无已结算轮次 / No settled rounds yet.</td></tr>`;
    } catch (error) {
      if (token) {
        persistStudentToken("");
        token = "";
      }
      joinCard.classList.remove("hidden");
      studentWorkspace.classList.add("hidden");
      joinTip.textContent = error.message;
      setText("studentStatus", "需要重新进入 / Rejoin");
    }
  }

  joinForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = await request("/api/night-market/student/join", {
        method: "POST",
        body: {
          name: nameInput.value.trim(),
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

  submitForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await request("/api/night-market/student/submit-choice", {
        method: "POST",
        body: {
          token,
          enter: enterInput.value === "true",
          hours: Number(hoursInput.value),
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
  hero?.classList.add("hidden");
  heroActions?.classList.add("hidden");
  teacherPanel?.classList.remove("hidden");
  initTeacher();
} else if (role === "student") {
  hero?.classList.add("hidden");
  heroActions?.classList.add("hidden");
  studentPanel?.classList.remove("hidden");
  initStudent();
}
