const role = new URLSearchParams(window.location.search).get("role") || "home";
const studentTokenKey = "milk-tea-student-token";

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

function buildRules(settings) {
  return `
    <p><strong>中文</strong></p>
    <p>每一轮，你都在奶茶店里负责一个固定工位，并且悄悄选择自己这一轮开几档速度。</p>
    <p>速度档位从 <strong>1</strong> 到 <strong>${formatNumber(settings.maxSpeed)}</strong>。数字越高，你这个工位越快，但也越累。</p>
    <p>整家店最后能跑多快，不看平均，只看最慢的那个工位。</p>
    <p>如果本轮全店最后按 <strong>4 档</strong>运转，每个人都先拿到 <strong>4 × ${formatNumber(settings.bonusPerShopSpeed)} = ${formatNumber(4 * settings.bonusPerShopSpeed)}</strong> 的团队奖金。</p>
    <p>然后每个人再扣掉自己这一轮的辛苦值。你选几档，就扣 <strong>${formatNumber(settings.costPerOwnSpeed)}</strong> 倍的几档。</p>
    <p>所以关键不是“你一个人有多快”，而是“全店能不能一起稳住更高速度”。</p>
    <p><strong>English</strong></p>
    <p>Each round, you work at one fixed station and secretly choose how fast to work.</p>
    <p>Your speed can be any integer from <strong>1</strong> to <strong>${formatNumber(settings.maxSpeed)}</strong>. Higher speed means faster work, but also more fatigue.</p>
    <p>The final shop speed is determined by the slowest station, not by the average speed.</p>
    <p>If the whole shop ends up running at <strong>speed 4</strong>, then everyone first receives a shared team bonus of <strong>4 × ${formatNumber(settings.bonusPerShopSpeed)} = ${formatNumber(4 * settings.bonusPerShopSpeed)}</strong>.</p>
    <p>Then each player pays a personal fatigue cost. If you choose speed <strong>x</strong>, your cost is <strong>${formatNumber(settings.costPerOwnSpeed)} × x</strong>.</p>
    <p>So the key question is not “How fast can I go alone?” but “Can the whole shop coordinate on a higher speed?”</p>
  `;
}

function initTeacher() {
  const teacherRules = document.getElementById("teacherRules");
  const configForm = document.getElementById("configForm");
  const seatCountInput = document.getElementById("seatCountInput");
  const maxRoundsInput = document.getElementById("maxRoundsInput");
  const maxSpeedInput = document.getElementById("maxSpeedInput");
  const bonusPerShopSpeedInput = document.getElementById("bonusPerShopSpeedInput");
  const costPerOwnSpeedInput = document.getElementById("costPerOwnSpeedInput");
  const startRoundButton = document.getElementById("startRoundButton");
  const closeRoundButton = document.getElementById("closeRoundButton");
  const resetButton = document.getElementById("resetButton");
  const joinUrlNode = document.getElementById("joinUrl");
  const qrImage = document.getElementById("qrImage");
  const rankingNameHeader = document.getElementById("rankingNameHeader");
  const rankingTable = document.getElementById("rankingTable");
  const stationBoard = document.getElementById("stationBoard");
  const historyTable = document.getElementById("historyTable");
  const roundDetailTable = document.getElementById("roundDetailTable");
  const roundResultText = document.getElementById("roundResultText");

  let configSynced = false;
  let configDirty = false;

  function syncConfigInputs(settings, force = false) {
    if (!force && (configSynced || configDirty)) {
      return;
    }
    seatCountInput.value = settings.seatCount;
    maxRoundsInput.value = settings.maxRounds;
    maxSpeedInput.value = settings.maxSpeed;
    bonusPerShopSpeedInput.value = settings.bonusPerShopSpeed;
    costPerOwnSpeedInput.value = settings.costPerOwnSpeed;
    configSynced = true;
  }

  async function refreshTeacher() {
    try {
      const data = await request("/api/milk-tea/teacher/state");
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
      setText("actualSpeedValue", formatNumber(data.currentRoundSummary?.actualSpeed));
      setText("teamBonusValue", formatNumber(data.currentRoundSummary?.teamBonus));

      if (data.currentRoundSummary?.status === "closed") {
        const defaultCount = data.currentRoundSummary.resolvedChoices.filter(
          (item) => item.defaulted
        ).length;
        roundResultText.innerHTML = `
          <strong>第 ${data.currentRoundSummary.number} 轮已结算 / Round ${data.currentRoundSummary.number} closed</strong><br />
          本轮全店实际按 <strong>${formatNumber(data.currentRoundSummary.actualSpeed)} 档</strong>运转。<br />
          The shop actually ran at <strong>speed ${formatNumber(data.currentRoundSummary.actualSpeed)}</strong> this round.<br />
          每个人先拿到 <strong>${formatNumber(data.currentRoundSummary.teamBonus)}</strong> 的团队奖金。<br />
          Everyone first receives a team bonus of <strong>${formatNumber(data.currentRoundSummary.teamBonus)}</strong>.<br />
          平均选择速度是 <strong>${formatNumber(data.currentRoundSummary.averageChoice)}</strong> 档。<br />
          The average chosen speed was <strong>${formatNumber(data.currentRoundSummary.averageChoice)}</strong>.${defaultCount ? `<br />有 ${defaultCount} 个工位未提交，系统按 1 档处理。 / ${defaultCount} stations did not submit, so the system treated them as speed 1.` : ""}
        `;
      } else if (data.status === "collecting") {
        roundResultText.innerHTML = `
          <strong>第 ${data.currentRound} 轮进行中 / Round ${data.currentRound} is open</strong><br />
          学生正在悄悄选择本轮速度。你可以等大家都提交后再结束本轮。<br />
          Students are secretly choosing their speeds. You can wait until everyone has submitted before closing the round.
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

      stationBoard.innerHTML = data.players
        .map(
          (player) => `
            <div class="seat-tile">
              <div class="kpi-label">Seat ${player.seat}</div>
              <strong>${escapeHtml(player.station)}</strong>
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
                  <td>${escapeHtml(item.station)}</td>
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
                  <td>${formatNumber(round.actualSpeed)}</td>
                  <td>${formatNumber(round.averageChoice)}</td>
                  <td>${formatNumber(round.teamBonus)}</td>
                  <td>${round.submittedCount}</td>
                </tr>
              `
            )
            .join("")
        : `<tr><td colspan="5">暂无已结算轮次 / No closed rounds yet.</td></tr>`;

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
                <td>${escapeHtml(item.station)}</td>
                <td>${formatNumber(item.speed)}${item.defaulted ? " (default)" : ""}</td>
                <td>${formatNumber(round.teamBonus)}</td>
                <td>${formatNumber(item.personalCost)}</td>
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
                <td>${escapeHtml(player.station)}</td>
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
      seatCountInput.disabled = locked;
      maxRoundsInput.disabled = locked;
      maxSpeedInput.disabled = locked;
      bonusPerShopSpeedInput.disabled = locked;
      costPerOwnSpeedInput.disabled = locked;
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
      const response = await request("/api/milk-tea/teacher/configure", {
        method: "POST",
        body: {
          seatCount: Number(seatCountInput.value),
          maxRounds: Number(maxRoundsInput.value),
          maxSpeed: Number(maxSpeedInput.value),
          bonusPerShopSpeed: Number(bonusPerShopSpeedInput.value),
          costPerOwnSpeed: Number(costPerOwnSpeedInput.value),
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
      await request("/api/milk-tea/teacher/start-round", { method: "POST" });
      await refreshTeacher();
    } catch (error) {
      alert(error.message);
    }
  });

  closeRoundButton.addEventListener("click", async () => {
    try {
      await request("/api/milk-tea/teacher/close-round", { method: "POST" });
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
      await request("/api/milk-tea/teacher/reset", { method: "POST" });
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
    maxSpeedInput,
    bonusPerShopSpeedInput,
    costPerOwnSpeedInput,
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
  const speedChoices = document.getElementById("speedChoices");
  const speedInput = document.getElementById("speedInput");
  const studentHistory = document.getElementById("studentHistory");

  let token = getTokenFromUrl() || window.localStorage.getItem(studentTokenKey) || "";
  let renderedMaxSpeed = 0;

  if (token) {
    persistStudentToken(token);
  }

  function updateSpeedSelection(value) {
    speedInput.value = String(value);
    speedChoices.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("active", Number(button.dataset.speed) === Number(value));
    });
  }

  function renderSpeedChoices(maxSpeed) {
    if (renderedMaxSpeed === maxSpeed) {
      updateSpeedSelection(speedInput.value || 1);
      return;
    }
    renderedMaxSpeed = maxSpeed;
    speedChoices.innerHTML = Array.from({ length: maxSpeed }, (_, index) => {
      const speed = index + 1;
      const subtitle =
        speed === 1
          ? "最稳最慢 / Safest and slowest"
          : speed === maxSpeed
            ? "最快最累 / Fastest and most tiring"
            : "中间速度 / Middle speed";
      return `
        <button class="speed-choice" type="button" data-speed="${speed}">
          <strong>${speed} 档 / ${speed}</strong>
          <span>${subtitle}</span>
        </button>
      `;
    }).join("");

    speedChoices.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        updateSpeedSelection(Number(button.dataset.speed));
      });
    });
    updateSpeedSelection(speedInput.value || 1);
  }

  async function refreshStudent() {
    try {
      const meta = await request("/api/milk-tea/meta");
      studentRules.innerHTML = buildRules(meta.settings);
      renderSpeedChoices(meta.settings.maxSpeed);

      if (!token) {
        setText("studentStatus", "等待进入 / Waiting");
        setText("studentSeatBadge", "Seat --");
        setText("studentStationTitle", "你的工位 / Your station: --");
        setText("studentActualSpeed", "--");
        setText("studentOwnSpeed", "--");
        setText("studentTeamBonus", "--");
        setText("studentPersonalCost", "--");
        setText("studentTakeHome", "--");
        setText("studentCumulative", "0");
        const joinOpen = meta.status === "lobby" && meta.currentRound === 0;
        nameInput.disabled = !joinOpen;
        joinButton.disabled = !joinOpen;
        joinTip.textContent = joinOpen
          ? "请输入名字或代号后进入。 / Enter your name or alias to join."
          : "老师还没完成设置，或者第一轮已经开始。学生只能在开局前加入。 / The teacher has not finished setup, or Round 1 has already started. Students can only join before the session begins.";
        return;
      }

      const data = await request(
        `/api/milk-tea/student/state?token=${encodeURIComponent(token)}`
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
      setText("studentSeatBadge", `Seat ${data.player.seat} · ${data.player.station}`);
      setText("studentStationTitle", `你的工位 / Your station: ${data.player.station}`);
      setText("studentCumulative", formatNumber(data.player.cumulative));
      setText("studentActualSpeed", formatNumber(data.currentRoundSummary?.actualSpeed));
      setText("studentOwnSpeed", formatNumber(data.currentRoundSummary?.ownSpeed));
      setText("studentTeamBonus", formatNumber(data.currentRoundSummary?.teamBonus));
      setText("studentPersonalCost", formatNumber(data.currentRoundSummary?.personalCost));
      setText("studentTakeHome", formatNumber(data.currentRoundSummary?.takeHome));

      const instruction = document.getElementById("studentInstruction");
      if (data.status === "setup" || data.status === "lobby") {
        instruction.textContent =
          "老师还没有开始本轮。 / The teacher has not started the round yet.";
      } else if (data.status === "collecting") {
        instruction.textContent = data.currentRoundSummary?.submitted
          ? `第 ${data.currentRound} 轮你已经提交了 ${data.currentRoundSummary.ownSpeed} 档，请等待老师结算。 / You already submitted speed ${data.currentRoundSummary.ownSpeed} in Round ${data.currentRound}. Please wait for the teacher to settle the round.`
          : `第 ${data.currentRound} 轮正在进行。请为你的工位选择 1 到 ${data.settings.maxSpeed} 档速度。 / Round ${data.currentRound} is open. Please choose a speed from 1 to ${data.settings.maxSpeed} for your station.`;
      } else if (data.status === "results") {
        instruction.textContent = data.currentRoundSummary?.defaulted
          ? "你本轮未提交，系统按 1 档处理。请查看这轮结算结果。 / You did not submit this round, so the system treated your speed as 1. Please review the round result."
          : "本轮已经结算。请查看团队奖金、辛苦值和你最后到手多少。 / This round has been settled. Check the team bonus, your fatigue cost, and how much you took home.";
      } else if (data.status === "finished") {
        instruction.textContent =
          "全部轮次已结束。你可以回看自己的全部记录。 / All rounds are finished. You can review your full history.";
      }

      if (data.currentRoundSummary?.submitted) {
        updateSpeedSelection(data.currentRoundSummary.ownSpeed);
      }

      const canSubmit = data.status === "collecting" && !data.currentRoundSummary?.submitted;
      speedChoices.querySelectorAll("button").forEach((button) => {
        button.disabled = !canSubmit;
      });
      submitForm.querySelector('button[type="submit"]').disabled = !canSubmit;

      studentHistory.innerHTML = data.player.history.length
        ? data.player.history
            .map(
              (item) => `
                <tr>
                  <td>${item.round}</td>
                  <td>${formatNumber(item.selectedSpeed)}${item.defaulted ? " (default)" : ""}</td>
                  <td>${formatNumber(item.actualSpeed)}</td>
                  <td>${formatNumber(item.teamBonus)}</td>
                  <td>${formatNumber(item.personalCost)}</td>
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
      const data = await request("/api/milk-tea/student/join", {
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
      await request("/api/milk-tea/student/submit-speed", {
        method: "POST",
        body: {
          token,
          speed: Number(speedInput.value),
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
