const role = new URLSearchParams(window.location.search).get("role") || "home";
const studentTokenKey = "herding-student-token";

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
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function guessLabel(value) {
  return value === "viral" ? "会火 / Go Viral" : "不会火 / Not Viral";
}

function resultLabel(correct) {
  return correct ? "猜对 / Correct" : "猜错 / Wrong";
}

function actualStateLabel(value) {
  return value === "viral"
    ? "真实上会火 / Truly Viral"
    : "真实上不会火 / Truly Not Viral";
}

function signalCopy(value) {
  if (value === "negative") {
    return {
      title: "偏负面线索 / Negative clue",
      text:
        "你私下看到一条偏负面的内部反馈。它不是百分之百准确，但它更像是在提醒你：这款新品可能不会火。 / You privately saw one negative internal review. It is not perfectly accurate, but it points toward the product being less likely to go viral.",
      toneClass: "signal-warning",
    };
  }
  return {
    title: "偏正面线索 / Positive clue",
    text:
      "你私下看到一条偏正面的内部反馈。它不是百分之百准确，但它更像是在提醒你：这款新品可能会火。 / You privately saw one positive internal review. It is not perfectly accurate, but it points toward the product being more likely to go viral.",
    toneClass: "signal-calm",
  };
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

function readStoredToken() {
  return window.localStorage.getItem(studentTokenKey) || "";
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
    <p>每一轮系统都会偷偷决定：这款新品真实上是<strong>更可能会火</strong>，还是<strong>更可能不会火</strong>。</p>
    <p>同学们按顺序一个个判断。轮到你时，你会看到前面同学已经公开做出的判断，也会私下拿到自己的一条线索。</p>
    <p>你只需要选：<strong>会火</strong> 或 <strong>不会火</strong>。</p>
    <p>你的私有线索准确率大约是 <strong>${formatNumber(settings.signalAccuracy)}%</strong>，所以它有参考价值，但并不保证正确。</p>
    <p>每轮猜对可得 <strong>${formatNumber(settings.correctReward)}</strong> 分，猜错得 0 分。后面同学信息更多，所以建议玩 <strong>${formatNumber(settings.maxRounds)}</strong> 轮并随机顺序。</p>
    <p><strong>English</strong></p>
    <p>Each round, the system secretly decides whether the product is truly <strong>more likely to go viral</strong> or <strong>more likely to flop</strong>.</p>
    <p>Students move one by one. When it is your turn, you see the earlier public guesses and receive one private clue of your own.</p>
    <p>You choose only between <strong>Go Viral</strong> and <strong>Not Viral</strong>.</p>
    <p>Your private clue is about <strong>${formatNumber(settings.signalAccuracy)}%</strong> accurate, so it is useful but imperfect.</p>
    <p>A correct guess earns <strong>${formatNumber(settings.correctReward)}</strong> points. A wrong guess earns 0. Later players have more public information, so replaying <strong>${formatNumber(settings.maxRounds)}</strong> rounds with random order is recommended.</p>
  `;
}

function setChoiceButtons(choice, disabled) {
  const buttons = [...document.querySelectorAll("button[data-choice]")];
  buttons.forEach((button) => {
    button.classList.toggle("active", button.dataset.choice === choice);
    button.disabled = disabled;
  });
}

function renderGuessChips(guesses) {
  if (!guesses || !guesses.length) {
    return `<span class="guess-chip guess-neutral">No public guesses yet</span>`;
  }
  return guesses
    .map(
      (item, index) => `
        <span class="guess-chip ${item.guess === "viral" ? "guess-viral" : "guess-not-viral"}">
          ${index + 1}. Seat ${item.seat}: ${escapeHtml(guessLabel(item.guess))}
        </span>
      `
    )
    .join("");
}

function initTeacher() {
  const teacherRules = document.getElementById("teacherRules");
  const configForm = document.getElementById("configForm");
  const seatCountInput = document.getElementById("seatCountInput");
  const maxRoundsInput = document.getElementById("maxRoundsInput");
  const accuracyInput = document.getElementById("accuracyInput");
  const rewardInput = document.getElementById("rewardInput");
  const startRoundButton = document.getElementById("startRoundButton");
  const resetButton = document.getElementById("resetButton");
  const joinUrlNode = document.getElementById("joinUrl");
  const qrImage = document.getElementById("qrImage");
  const publicGuessStrip = document.getElementById("publicGuessStrip");
  const seatBoard = document.getElementById("seatBoard");
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
    accuracyInput.value = settings.signalAccuracy;
    rewardInput.value = settings.correctReward;
    configSynced = true;
  }

  async function refreshTeacher() {
    try {
      const data = await request("/api/herding/teacher/state");
      syncConfigInputs(data.settings);
      teacherRules.innerHTML = buildRules(data.settings);

      setText(
        "teacherStatus",
        {
          setup: "等待设置 / Setup",
          lobby: "等待开局 / Lobby",
          collecting: "本轮进行中 / Round Open",
          results: "本轮已揭晓 / Round Closed",
          finished: "全部结束 / Finished",
        }[data.status] || data.status
      );
      setText("teacherSessionCode", `Session ${data.sessionCode}`);
      setText("currentRoundValue", data.currentRound);
      setText("plannedRoundsValue", data.settings.maxRounds);
      setText("joinedCountValue", `${data.joinedCount}/${data.settings.seatCount}`);
      setText("submittedCountValue", data.currentRoundSummary?.submittedCount || 0);
      setText(
        "currentTurnValue",
        data.currentRoundSummary?.currentTurnSeat != null
          ? `Seat ${data.currentRoundSummary.currentTurnSeat} (#${data.currentRoundSummary.currentTurnPosition})`
          : "--"
      );
      setText("publicCountValue", data.currentRoundSummary?.publicGuesses?.length || 0);

      publicGuessStrip.innerHTML = renderGuessChips(data.currentRoundSummary?.publicGuesses || []);

      if (data.currentRoundSummary?.status === "closed") {
        roundResultText.innerHTML = `
          <strong>第 ${data.currentRoundSummary.number} 轮已揭晓 / Round ${data.currentRoundSummary.number} closed</strong><br />
          真实结果：<strong>${actualStateLabel(data.currentRoundSummary.actualStateReveal)}</strong><br />
          猜对人数：<strong>${data.currentRoundSummary.correctCount}</strong><br />
          忽略自己线索的人数：<strong>${data.currentRoundSummary.ignoredSignalCount}</strong>
        `;
      } else if (data.status === "collecting") {
        roundResultText.innerHTML = `
          <strong>第 ${data.currentRound} 轮进行中 / Round ${data.currentRound} is open</strong><br />
          现在轮到 <strong>Seat ${data.currentRoundSummary.currentTurnSeat}</strong>。后面的同学只能看到前面已经公开的判断。<br />
          It is now <strong>Seat ${data.currentRoundSummary.currentTurnSeat}</strong>'s turn. Later students see only the public history so far.
        `;
      } else if (data.status === "finished") {
        roundResultText.innerHTML = `
          <strong>全部轮次已结束 / All rounds finished</strong><br />
          现在可以回看每轮真实结果，以及哪些同学开始跟着 herd 走。<br />
          You can now debrief which rounds created clear herding behavior.
        `;
      } else {
        roundResultText.innerHTML = `
          还没有开始任何一轮。<br />
          No round has started yet.
        `;
      }

      joinUrlNode.textContent = data.joinUrl;
      qrImage.src =
        "https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=" +
        encodeURIComponent(data.joinUrl);

      seatBoard.innerHTML = data.players
        .map((player) => {
          const waitingTurn =
            data.currentRoundSummary?.status === "collecting" &&
            data.currentRoundSummary.currentTurnSeat === player.seat;
          return `
            <div class="seat-tile ${waitingTurn ? "seat-active" : ""}">
              <div class="kpi-label">Seat ${player.seat}</div>
              <strong>${player.joined ? escapeHtml(player.name || "Joined") : "Open"}</strong>
              <div class="tiny">${waitingTurn ? "当前轮到 / Current turn" : player.joined ? "已加入 / Joined" : "空位 / Open"}</div>
              <div class="tiny">Total: ${formatNumber(player.cumulative)}</div>
            </div>
          `;
        })
        .join("");

      rankingTable.innerHTML = data.ranking.length
        ? data.ranking
            .map((item, index) => {
              const player = data.players.find((candidate) => candidate.seat === item.seat);
              return `
                <tr>
                  <td>${index + 1}</td>
                  <td>${item.seat}</td>
                  <td>${escapeHtml(player?.name || "-")}</td>
                  <td>${formatNumber(item.cumulative)}</td>
                </tr>
              `;
            })
            .join("")
        : `<tr><td colspan="4">No players yet.</td></tr>`;

      if (data.currentRoundSummary?.status === "closed") {
        roundDetailTable.innerHTML = data.currentRoundSummary.resolvedChoices
          .map(
            (item) => `
              <tr>
                <td>${item.orderPosition}</td>
                <td>${item.seat}</td>
                <td>${escapeHtml(signalCopy(item.signal).title)}</td>
                <td>${escapeHtml(guessLabel(item.guess))}</td>
                <td>${item.ignoredSignal ? "Yes" : "No"}</td>
                <td>${formatNumber(item.payoff)}</td>
              </tr>
            `
          )
          .join("");
      } else if (data.currentRoundSummary?.status === "collecting") {
        const submittedSeats = new Set(
          data.currentRoundSummary.publicGuesses.map((item) => item.seat)
        );
        roundDetailTable.innerHTML = data.currentRoundSummary.order
          .map(
            (seat, index) => `
              <tr>
                <td>${index + 1}</td>
                <td>${seat}</td>
                <td>Hidden</td>
                <td>${submittedSeats.has(seat) ? "Submitted" : "Waiting"}</td>
                <td>--</td>
                <td>--</td>
              </tr>
            `
          )
          .join("");
      } else {
        roundDetailTable.innerHTML = `<tr><td colspan="6">No round detail yet.</td></tr>`;
      }

      historyTable.innerHTML = data.roundHistory.length
        ? data.roundHistory
            .map(
              (round) => `
                <tr>
                  <td>${round.number}</td>
                  <td>${actualStateLabel(round.actualStateReveal)}</td>
                  <td>${round.correctCount}</td>
                  <td>${round.ignoredSignalCount}</td>
                </tr>
              `
            )
            .join("")
        : `<tr><td colspan="4">No closed rounds yet.</td></tr>`;

      const locked = data.currentRound > 0 || data.joinedCount > 0;
      [seatCountInput, maxRoundsInput, accuracyInput, rewardInput].forEach((input) => {
        input.disabled = locked;
      });
      configForm.querySelector("button").disabled = locked;

      startRoundButton.disabled =
        data.status === "collecting" ||
        data.status === "setup" ||
        data.status === "finished" ||
        data.currentRound >= data.settings.maxRounds ||
        data.joinedCount !== data.settings.seatCount;
    } catch (error) {
      setText("teacherStatus", error.message);
    }
  }

  configForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await request("/api/herding/teacher/configure", {
        method: "POST",
        body: {
          seatCount: Number(seatCountInput.value),
          maxRounds: Number(maxRoundsInput.value),
          signalAccuracy: Number(accuracyInput.value),
          correctReward: Number(rewardInput.value),
        },
      });
      configDirty = false;
      await refreshTeacher();
    } catch (error) {
      alert(error.message);
    }
  });

  startRoundButton.addEventListener("click", async () => {
    try {
      await request("/api/herding/teacher/start-round", { method: "POST" });
      await refreshTeacher();
    } catch (error) {
      alert(error.message);
    }
  });

  resetButton.addEventListener("click", async () => {
    try {
      await request("/api/herding/teacher/reset", { method: "POST" });
      configSynced = false;
      configDirty = false;
      await refreshTeacher();
    } catch (error) {
      alert(error.message);
    }
  });

  [seatCountInput, maxRoundsInput, accuracyInput, rewardInput].forEach((input) => {
    input.addEventListener("input", () => {
      configDirty = true;
    });
    input.addEventListener("change", () => {
      configDirty = true;
    });
  });

  refreshTeacher();
  window.setInterval(refreshTeacher, 1200);
}

function initStudent() {
  const joinCard = document.getElementById("joinCard");
  const joinForm = document.getElementById("joinForm");
  const nameInput = document.getElementById("nameInput");
  const joinTip = document.getElementById("joinTip");
  const studentRules = document.getElementById("studentRules");
  const studentWorkspace = document.getElementById("studentWorkspace");
  const signalCard = document.getElementById("signalCard");
  const publicGuessView = document.getElementById("publicGuessView");
  const publicGuessSummary = document.getElementById("publicGuessSummary");
  const submitForm = document.getElementById("submitForm");
  const submitButton = submitForm.querySelector("button[type='submit']");
  const choiceInput = document.getElementById("choiceInput");
  const studentHistory = document.getElementById("studentHistory");
  const joinButton = joinForm.querySelector("button");

  let selectedChoice = "viral";

  function setChoice(choice) {
    selectedChoice = choice;
    choiceInput.value = choice;
    setChoiceButtons(choice, submitButton.disabled);
  }

  function applySignal(signal) {
    if (!signal) {
      signalCard.classList.add("hidden");
      setText("studentSignalTitle", "你的私有线索 / Your private signal");
      setText("studentSignalText", "--");
      signalCard.classList.remove("signal-calm", "signal-warning");
      return;
    }
    const copy = signalCopy(signal);
    signalCard.classList.remove("hidden", "signal-calm", "signal-warning");
    signalCard.classList.add(copy.toneClass);
    setText("studentSignalTitle", copy.title);
    setText("studentSignalText", copy.text);
  }

  async function renderLobby() {
    try {
      const meta = await request("/api/herding/meta");
      const joinOpen = meta.status === "lobby" && meta.currentRound === 0;
      studentRules.innerHTML = buildRules(meta.settings);
      joinCard.classList.remove("hidden");
      studentWorkspace.classList.add("hidden");
      setText(
        "studentStatus",
        meta.status === "setup"
          ? "等待设置 / Waiting for setup"
          : "等待加入 / Ready to join"
      );
      setText("studentSeatBadge", "Seat --");
      nameInput.disabled = !joinOpen;
      joinButton.disabled = !joinOpen;
      setText(
        "joinTip",
        meta.status === "setup"
          ? "教师还没保存设置。Teacher has not saved the settings yet."
          : joinOpen
            ? "请输入名字后加入。Enter your name and join."
            : "这场游戏暂时不开放新加入。New joins are currently closed."
      );
    } catch (error) {
      setText("studentStatus", error.message);
    }
  }

  async function refreshStudent() {
    const token = getTokenFromUrl() || readStoredToken();
    if (!token) {
      await renderLobby();
      return;
    }

    try {
      persistStudentToken(token);
      const data = await request(
        `/api/herding/student/state?token=${encodeURIComponent(token)}`
      );
      studentRules.innerHTML = buildRules(data.settings);
      joinCard.classList.add("hidden");
      studentWorkspace.classList.remove("hidden");
      setText("studentSeatBadge", `Seat ${data.player.seat}`);

      const round = data.currentRoundSummary;
      publicGuessView.innerHTML = renderGuessChips(round?.publicGuesses || []);
      publicGuessSummary.textContent =
        round?.publicGuesses?.length > 0
          ? `你现在能看到 ${round.publicGuesses.length} 个公开判断。 / You can currently see ${round.publicGuesses.length} public guesses.`
          : "前面还没有公开判断。 / No public guesses yet.";

      applySignal(round?.signal || null);

      const canAct = Boolean(round?.canAct);
      submitButton.disabled = !canAct;
      setChoice(round?.ownGuess || selectedChoice);
      setChoiceButtons(choiceInput.value, !canAct);

      if (data.status === "finished" && round?.status === "closed") {
        setText("studentStatus", "已结束 / Finished");
        setText(
          "studentInstruction",
          `真实结果已经揭晓：${actualStateLabel(round.actualStateReveal)}。`
        );
      } else if (round?.submitted && round?.status === "collecting") {
        setText("studentStatus", "已提交 / Submitted");
        setText(
          "studentInstruction",
          `你已经提交了“${guessLabel(round.ownGuess)}”，等待后面同学完成。`
        );
      } else if (canAct) {
        setText("studentStatus", `轮到你 / Turn ${round.currentTurnPosition}`);
        setText(
          "studentInstruction",
          `现在轮到你（第 ${round.orderPosition} 位）。请结合前面的公开判断和你自己的私有线索，判断这款新品会不会爆。`
        );
      } else if (round?.status === "collecting") {
        setText("studentStatus", "等待中 / Waiting");
        const remaining = Math.max(0, (round.orderPosition || 0) - (round.submittedCount || 0) - 1);
        setText(
          "studentInstruction",
          `还没轮到你。你在第 ${round.orderPosition} 位，前面大约还有 ${remaining} 人。`
        );
      } else if (round?.status === "closed") {
        setText("studentStatus", "本轮已揭晓 / Round Closed");
        setText(
          "studentInstruction",
          `这轮真实结果是：${actualStateLabel(round.actualStateReveal)}。你自己的最终判断是：${guessLabel(round.ownGuess)}。`
        );
      } else {
        setText("studentStatus", "等待开局 / Waiting");
        setText("studentInstruction", "等待教师开始第一轮。");
      }

      const latest = data.player.history[data.player.history.length - 1];
      if (!latest) {
        setText(
          "studentSummaryText",
          `当前累计得分 ${formatNumber(data.player.cumulative)}。 / Current total score: ${formatNumber(data.player.cumulative)}.`
        );
      } else {
        setText(
          "studentSummaryText",
          `最近一轮：${guessLabel(latest.guess)}，${resultLabel(latest.correct)}，累计 ${formatNumber(latest.cumulative)}。 / Latest round: ${guessLabel(latest.guess)}, ${resultLabel(latest.correct)}, total ${formatNumber(latest.cumulative)}.`
        );
      }

      studentHistory.innerHTML = data.player.history.length
        ? data.player.history
            .map(
              (item) => `
                <tr>
                  <td>${item.round}</td>
                  <td>${item.orderPosition}</td>
                  <td>${escapeHtml(signalCopy(item.signal).title)}</td>
                  <td>${escapeHtml(guessLabel(item.guess))}</td>
                  <td>${resultLabel(item.correct)}</td>
                  <td>${formatNumber(item.cumulative)}</td>
                </tr>
              `
            )
            .join("")
        : `<tr><td colspan="6">No history yet.</td></tr>`;
    } catch (error) {
      persistStudentToken("");
      await renderLobby();
      setText("studentStatus", error.message);
    }
  }

  joinForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const response = await request("/api/herding/student/join", {
        method: "POST",
        body: {
          token: getTokenFromUrl() || readStoredToken(),
          name: nameInput.value.trim(),
        },
      });
      persistStudentToken(response.token);
      await refreshStudent();
    } catch (error) {
      alert(error.message);
    }
  });

  [...document.querySelectorAll("button[data-choice]")].forEach((button) => {
    button.addEventListener("click", () => {
      setChoice(button.dataset.choice);
    });
  });

  submitForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await request("/api/herding/student/submit-guess", {
        method: "POST",
        body: {
          token: getTokenFromUrl() || readStoredToken(),
          guess: choiceInput.value,
        },
      });
      await refreshStudent();
    } catch (error) {
      alert(error.message);
    }
  });

  setChoice(selectedChoice);
  refreshStudent();
  window.setInterval(refreshStudent, 800);
}

if (role === "teacher") {
  hero.classList.add("hidden");
  teacherPanel.classList.remove("hidden");
  initTeacher();
} else if (role === "student") {
  hero.classList.add("hidden");
  studentPanel.classList.remove("hidden");
  initStudent();
} else {
  heroActions.classList.remove("hidden");
}
