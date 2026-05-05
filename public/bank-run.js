const role = new URLSearchParams(window.location.search).get("role") || "home";
const studentTokenKey = "bank-run-student-token";

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

function bankOutcomeLabel(value) {
  return (
    {
      pending: "等待中 / Pending",
      matured: "撑到最后 / Survived",
      collapsed: "中途倒闭 / Collapsed",
    }[value] || value
  );
}

function playerStatusLabel(value) {
  return (
    {
      waiting: "还在银行里 / Still Waiting",
      withdrew: "已提前取出 / Withdrew Early",
      matured: "坚持到最后 / Paid at Maturity",
      lost: "没来得及取出 / Lost in Collapse",
    }[value] || value
  );
}

function dayStatusLabel(value) {
  return (
    {
      collecting: "当天进行中 / Day Open",
      closed: "当天已结束 / Day Closed",
    }[value] || value
  );
}

function actionLabel(value) {
  return value === "withdraw"
    ? "现在取 / Withdraw Now"
    : "继续存 / Wait";
}

function outcomeLabel(value) {
  return (
    {
      withdrew: "提前取到 100 / Secured 100",
      maturity: "等到最后拿到高回报 / Paid at maturity",
      wait: "继续留在银行里 / Stayed in the bank",
      too_late: "冲去取但没赶上 / Too late in the queue",
      lost: "继续等，结果银行倒了 / Waited and lost",
    }[value] || value
  );
}

function signalCopy(signal) {
  if (signal === "warning") {
    return {
      title: "偏坏的传言 / Warning rumor",
      text:
        "你私下听说：校园里有人开始担心这家银行，可能会有人提前去取钱。这条传言不一定是真的，但如果很多人听到类似消息，挤兑风险会上升。 / You privately heard that some people on campus are getting nervous about the bank and may rush to withdraw early. The rumor may be wrong, but if many people hear something similar, the run risk rises.",
      toneClass: "signal-warning",
    };
  }

  return {
    title: "偏稳的传言 / Reassuring rumor",
    text:
      "你私下听说：校园里目前比较平静，这家银行大概率能撑到最后一天。这条传言不一定完全准确，但它意味着别人也许不会那么快去挤兑。 / You privately heard that campus mood is fairly calm and the bank will probably make it to the last day. The rumor may be imperfect, but it suggests other people may be less likely to panic immediately.",
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
    <p>每个人一开始都把 <strong>${formatNumber(settings.depositAmount)}</strong> 存进校园银行。</p>
    <p>如果银行撑到第 <strong>${formatNumber(settings.daysUntilMaturity)}</strong> 天都没倒，留到最后的人每人拿 <strong>${formatNumber(settings.maturityPayout)}</strong>。</p>
    <p>但银行在到期前只能提前兑付 <strong>${formatNumber(settings.liquiditySlots)}</strong> 个人的存款。</p>
    <p>每天，仍然把钱留在银行里的同学都要悄悄决定：继续存，还是现在就取。</p>
    <p>你会私下收到一条传言。传言准确率大约是 <strong>${formatNumber(settings.rumorAccuracy)}%</strong>，但它真正影响的是你对“别人会不会先跑”的判断。</p>
    <p>如果某一天想提前取钱的人超过剩余名额，当天取款的人会被随机排队，前面的人拿到 <strong>${formatNumber(settings.depositAmount)}</strong>，后面的人和还留在银行里的人都拿 <strong>0</strong>，银行立刻倒闭。</p>
    <p><strong>English</strong></p>
    <p>Everyone begins by depositing <strong>${formatNumber(settings.depositAmount)}</strong> in the campus bank.</p>
    <p>If the bank survives until Day <strong>${formatNumber(settings.daysUntilMaturity)}</strong>, anyone who keeps their money in the bank until then receives <strong>${formatNumber(settings.maturityPayout)}</strong>.</p>
    <p>Before maturity, the bank can honor only <strong>${formatNumber(settings.liquiditySlots)}</strong> early withdrawals in total.</p>
    <p>Each day, every student who still has money in the bank privately chooses whether to wait or withdraw now.</p>
    <p>You also receive one private rumor. Its accuracy is about <strong>${formatNumber(settings.rumorAccuracy)}%</strong>, but its real effect is on your belief about whether other people will run first.</p>
    <p>If, on any day, too many people try to withdraw relative to the remaining slots, that day's withdrawers are randomly queued. The front of the queue secures <strong>${formatNumber(settings.depositAmount)}</strong>, while the rest of that day's withdrawers and everyone still waiting receive <strong>0</strong>. The bank collapses immediately.</p>
  `;
}

function setSignalCard(signalKey) {
  const signalCard = document.getElementById("signalCard");
  const { title, text, toneClass } = signalCopy(signalKey);
  setText("studentSignalTitle", title);
  setText("studentSignalText", text);
  if (signalCard) {
    signalCard.classList.remove("signal-warning", "signal-calm");
    signalCard.classList.add(toneClass);
  }
}

function setChoiceButtons(choice, disabled) {
  const buttons = [...document.querySelectorAll("button[data-choice]")];
  buttons.forEach((button) => {
    button.classList.toggle("active", button.dataset.choice === choice);
    button.disabled = disabled;
  });
}

function initTeacher() {
  const teacherRules = document.getElementById("teacherRules");
  const configForm = document.getElementById("configForm");
  const seatCountInput = document.getElementById("seatCountInput");
  const daysInput = document.getElementById("daysInput");
  const depositInput = document.getElementById("depositInput");
  const maturityInput = document.getElementById("maturityInput");
  const liquidityInput = document.getElementById("liquidityInput");
  const accuracyInput = document.getElementById("accuracyInput");
  const startDayButton = document.getElementById("startDayButton");
  const closeDayButton = document.getElementById("closeDayButton");
  const resetButton = document.getElementById("resetButton");
  const joinUrlNode = document.getElementById("joinUrl");
  const qrImage = document.getElementById("qrImage");
  const seatBoard = document.getElementById("seatBoard");
  const rankingNameHeader = document.getElementById("rankingNameHeader");
  const rankingSignalHeader = document.getElementById("rankingSignalHeader");
  const rankingTable = document.getElementById("rankingTable");
  const dayDetailTable = document.getElementById("dayDetailTable");
  const historyTable = document.getElementById("historyTable");
  const dayResultText = document.getElementById("dayResultText");

  let configSynced = false;
  let configDirty = false;

  function syncConfigInputs(settings, force = false) {
    if (!force && (configSynced || configDirty)) {
      return;
    }
    seatCountInput.value = settings.seatCount;
    daysInput.value = settings.daysUntilMaturity;
    depositInput.value = settings.depositAmount;
    maturityInput.value = settings.maturityPayout;
    liquidityInput.value = settings.liquiditySlots;
    accuracyInput.value = settings.rumorAccuracy;
    configSynced = true;
  }

  async function refreshTeacher() {
    try {
      const data = await request("/api/bank-run/teacher/state");
      syncConfigInputs(data.settings);
      teacherRules.innerHTML = buildRules(data.settings);

      setText(
        "teacherStatus",
        {
          setup: "等待设置 / Setup",
          lobby: "等待开局 / Lobby",
          collecting: "当天进行中 / Day Open",
          results: "当天已结算 / Day Closed",
          finished: "撑到最后 / Finished",
          failed: "银行倒闭 / Collapsed",
        }[data.status] || data.status
      );
      setText("teacherSessionCode", `Session ${data.sessionCode}`);
      setText("currentDayValue", data.currentDay);
      setText("plannedDaysValue", data.settings.daysUntilMaturity);
      setText("joinedCountValue", `${data.joinedCount}/${data.settings.seatCount}`);
      setText("submittedCountValue", data.currentDaySummary?.submittedCount || 0);
      setText("successfulWithdrawalsValue", data.successfulWithdrawals);
      setText("remainingLiquidityValue", data.remainingLiquidity);
      setText("bankOutcomeValue", bankOutcomeLabel(data.bankOutcome));

      if (data.currentDaySummary?.status === "closed") {
        const day = data.currentDaySummary;
        if (day.bankCollapsedToday) {
          dayResultText.innerHTML = `
            <strong>第 ${day.number} 天银行倒闭 / The bank collapsed on Day ${day.number}</strong><br />
            今天有 <strong>${day.attemptedWithdrawals}</strong> 人想提前取钱，但只剩 <strong>${day.remainingLiquidityBefore}</strong> 个名额。队伍后面的人没赶上，银行立刻倒闭。<br />
            <strong>${day.attemptedWithdrawals}</strong> people tried to withdraw today, but only <strong>${day.remainingLiquidityBefore}</strong> slots remained. The people at the back of the queue were too late, and the bank collapsed immediately.
          `;
        } else if (data.status === "finished") {
          dayResultText.innerHTML = `
            <strong>第 ${day.number} 天平稳结束 / Day ${day.number} ended safely</strong><br />
            银行撑到了最后一天。还留在银行里的同学每人拿到 <strong>${formatNumber(data.settings.maturityPayout)}</strong>。<br />
            The bank survived to the final day. Everyone still in the bank received <strong>${formatNumber(data.settings.maturityPayout)}</strong>.
          `;
        } else {
          dayResultText.innerHTML = `
            <strong>第 ${day.number} 天已结束 / Day ${day.number} closed</strong><br />
            今天有 <strong>${day.attemptedWithdrawals}</strong> 人尝试提前取款，其中 <strong>${day.successfulToday}</strong> 人拿到本金。剩余提前兑付名额还有 <strong>${day.remainingLiquidityAfter}</strong>。<br />
            <strong>${day.attemptedWithdrawals}</strong> people tried to withdraw today, and <strong>${day.successfulToday}</strong> secured their deposits. <strong>${day.remainingLiquidityAfter}</strong> early slots remain.
          `;
        }
      } else if (data.status === "collecting") {
        dayResultText.innerHTML = `
          <strong>第 ${data.currentDay} 天进行中 / Day ${data.currentDay} is open</strong><br />
          学生正在决定今天是继续等，还是现在跑去取钱。<br />
          Students are deciding whether to wait one more day or rush to withdraw now.
        `;
      } else if (data.status === "lobby") {
        dayResultText.innerHTML = `
          还没有开始第 1 天。先让所有存款人加入。<br />
          Day 1 has not started yet. Let all depositors join first.
        `;
      } else {
        dayResultText.innerHTML = `
          暂时没有当天结果。<br />
          No closed day yet.
        `;
      }

      joinUrlNode.textContent = data.joinUrl;
      qrImage.src =
        "https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=" +
        encodeURIComponent(data.joinUrl);

      seatBoard.innerHTML = data.players
        .map((player) => {
          const displayName =
            data.status === "finished" || data.status === "failed"
              ? escapeHtml(player.name || "-")
              : player.joined
                ? "已加入 / Joined"
                : "空位 / Open";
          return `
            <div class="seat-tile">
              <div class="kpi-label">Seat ${player.seat}</div>
              <strong>${displayName}</strong>
              <div class="tiny">${playerStatusLabel(player.status)}</div>
              <div class="tiny">到账 / Total: ${formatNumber(player.cumulative)}</div>
            </div>
          `;
        })
        .join("");

      const revealNames = data.status === "finished" || data.status === "failed";
      rankingNameHeader.classList.toggle("hidden", !revealNames);
      rankingSignalHeader.classList.toggle("hidden", !revealNames);
      rankingTable.innerHTML = data.ranking.length
        ? data.ranking
            .map((item, index) => {
              const player = data.players.find((candidate) => candidate.seat === item.seat);
              return `
                <tr>
                  <td>${index + 1}</td>
                  ${revealNames ? `<td>${escapeHtml(player?.name || "-")}</td>` : ""}
                  <td>${item.seat}</td>
                  ${revealNames ? `<td>${escapeHtml(signalCopy(player?.signal || "calm").title)}</td>` : ""}
                  <td>${formatNumber(item.cumulative)}</td>
                </tr>
              `;
            })
            .join("")
        : `<tr><td colspan="${revealNames ? 5 : 3}">暂无参与者 / No players yet.</td></tr>`;

      historyTable.innerHTML = data.dayHistory.length
        ? data.dayHistory
            .map(
              (day) => `
                <tr>
                  <td>${day.number}</td>
                  <td>${day.attemptedWithdrawals}</td>
                  <td>${day.successfulToday}</td>
                  <td>${day.remainingLiquidityAfter}</td>
                  <td>${day.defaultWaitCount}</td>
                  <td>${day.bankCollapsedToday ? "Collapsed" : "Safe"}</td>
                </tr>
              `
            )
            .join("")
        : `<tr><td colspan="6">暂无已结算天数 / No closed days yet.</td></tr>`;

      const day = data.currentDaySummary;
      if (!day) {
        dayDetailTable.innerHTML =
          `<tr><td colspan="5">还没有进行中的天数或结果。/ There is no active or closed day yet.</td></tr>`;
      } else if (day.status === "closed") {
        dayDetailTable.innerHTML = day.resolvedChoices
          .map(
            (item) => `
              <tr>
                <td>${item.seat}</td>
                <td>${actionLabel(item.action)}${item.defaulted ? " (default)" : ""}</td>
                <td>${item.queueRank ?? "--"}</td>
                <td>${outcomeLabel(item.outcome)}</td>
                <td>${formatNumber(item.payoff)}</td>
              </tr>
            `
          )
          .join("");
      } else {
        const submittedSeats = new Set(day.submissions.map((item) => item.seat));
        dayDetailTable.innerHTML = data.players
          .filter((player) => player.joined && player.status === "waiting")
          .map(
            (player) => `
              <tr>
                <td>${player.seat}</td>
                <td>${submittedSeats.has(player.seat) ? "已提交 / Submitted" : "等待中 / Waiting"}</td>
                <td>--</td>
                <td>${submittedSeats.has(player.seat) ? "Waiting for close" : "Not submitted yet"}</td>
                <td>--</td>
              </tr>
            `
          )
          .join("");
      }

      const locked = data.currentDay > 0 || data.joinedCount > 0;
      [
        seatCountInput,
        daysInput,
        depositInput,
        maturityInput,
        liquidityInput,
        accuracyInput,
      ].forEach((input) => {
        input.disabled = locked;
      });
      configForm.querySelector("button").disabled = locked;

      startDayButton.disabled =
        data.status === "collecting" ||
        data.status === "finished" ||
        data.status === "failed" ||
        data.status === "setup" ||
        data.currentDay >= data.settings.daysUntilMaturity ||
        data.joinedCount !== data.settings.seatCount;
      closeDayButton.disabled = data.status !== "collecting";
    } catch (error) {
      setText("teacherStatus", error.message);
    }
  }

  configForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await request("/api/bank-run/teacher/configure", {
        method: "POST",
        body: {
          seatCount: Number(seatCountInput.value),
          daysUntilMaturity: Number(daysInput.value),
          depositAmount: Number(depositInput.value),
          maturityPayout: Number(maturityInput.value),
          liquiditySlots: Number(liquidityInput.value),
          rumorAccuracy: Number(accuracyInput.value),
        },
      });
      configDirty = false;
      await refreshTeacher();
    } catch (error) {
      alert(error.message);
    }
  });

  startDayButton.addEventListener("click", async () => {
    try {
      await request("/api/bank-run/teacher/start-day", { method: "POST" });
      await refreshTeacher();
    } catch (error) {
      alert(error.message);
    }
  });

  closeDayButton.addEventListener("click", async () => {
    try {
      await request("/api/bank-run/teacher/close-day", { method: "POST" });
      await refreshTeacher();
    } catch (error) {
      alert(error.message);
    }
  });

  resetButton.addEventListener("click", async () => {
    try {
      await request("/api/bank-run/teacher/reset", { method: "POST" });
      configSynced = false;
      configDirty = false;
      await refreshTeacher();
    } catch (error) {
      alert(error.message);
    }
  });

  [
    seatCountInput,
    daysInput,
    depositInput,
    maturityInput,
    liquidityInput,
    accuracyInput,
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
  const nameInput = document.getElementById("nameInput");
  const joinTip = document.getElementById("joinTip");
  const studentRules = document.getElementById("studentRules");
  const studentWorkspace = document.getElementById("studentWorkspace");
  const submitForm = document.getElementById("submitForm");
  const submitButton = submitForm.querySelector("button[type='submit']");
  const choiceInput = document.getElementById("choiceInput");
  const studentHistory = document.getElementById("studentHistory");
  let selectedChoice = "wait";

  function setChoice(choice) {
    selectedChoice = choice;
    choiceInput.value = choice;
    setChoiceButtons(choice, submitButton.disabled);
  }

  async function renderLobby() {
    try {
      const meta = await request("/api/bank-run/meta");
      studentRules.innerHTML = buildRules(meta.settings);
      joinCard.classList.remove("hidden");
      studentWorkspace.classList.add("hidden");
      setText(
        "studentStatus",
        meta.status === "setup"
          ? "等待老师设置 / Waiting for setup"
          : "等待加入 / Ready to join"
      );
      setText("studentSeatBadge", "Seat --");
      setText(
        "joinTip",
        meta.status === "setup"
          ? "老师还没有保存设置。Teacher has not saved the settings yet."
          : "输入名字后即可加入。Enter your name and join."
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
        `/api/bank-run/student/state?token=${encodeURIComponent(token)}`
      );
      studentRules.innerHTML = buildRules(data.settings);
      joinCard.classList.add("hidden");
      studentWorkspace.classList.remove("hidden");
      setText("studentSeatBadge", `Seat ${data.player.seat}`);
      setSignalCard(data.player.signal);

      const canSubmit =
        data.status === "collecting" &&
        data.player.status === "waiting" &&
        !data.currentDaySummary?.submitted;

      setText(
        "studentStatus",
        data.player.status === "waiting"
          ? canSubmit
            ? `Day ${data.currentDay} Open`
            : data.currentDaySummary?.submitted
              ? "已提交 / Submitted"
              : {
                  lobby: "等待第 1 天 / Waiting",
                  results: "等待下一天 / Waiting",
                  finished: "已拿到结果 / Finished",
                  failed: "银行已倒闭 / Collapsed",
                }[data.status] || data.status
          : playerStatusLabel(data.player.status)
      );

      if (data.player.status === "withdrew") {
        setText(
          "studentInstruction",
          `你已经在第 ${data.player.resolvedDay} 天提前取出了本金，接下来不用再提交。`
        );
        setText(
          "studentPositionText",
          "你已经离开银行，不再参与后面的天数。 / You already left the bank and do not act again."
        );
      } else if (data.player.status === "matured") {
        setText(
          "studentInstruction",
          "你已经坚持到最后一天，拿到了最终回报。"
        );
        setText(
          "studentPositionText",
          "你留在银行直到到期。 / You stayed in the bank until maturity."
        );
      } else if (data.player.status === "lost") {
        setText(
          "studentInstruction",
          "银行已经倒闭，你这笔钱没有及时取出来。"
        );
        setText(
          "studentPositionText",
          "这场挤兑已经结束。 / The run is over."
        );
      } else if (canSubmit) {
        setText(
          "studentInstruction",
          `第 ${data.currentDay} 天已经开始。今天你要决定继续存，还是现在取。`
        );
        setText(
          "studentPositionText",
          `如果银行撑到第 ${data.settings.daysUntilMaturity} 天，你会拿到 ${data.settings.maturityPayout}。如果太多人今天抢着取钱，银行可能立刻倒闭。`
        );
      } else if (data.currentDaySummary?.submitted) {
        setText(
          "studentInstruction",
          `你今天已经提交了“${actionLabel(data.currentDaySummary.ownAction)}”，等待老师结算。`
        );
        setText(
          "studentPositionText",
          "现在最重要的是别人会不会也一起跑。 / What matters now is whether other people run too."
        );
      } else {
        setText(
          "studentInstruction",
          "等待老师开始下一天。"
        );
        setText(
          "studentPositionText",
          "你的钱还留在银行里。 / Your money is still in the bank."
        );
      }

      submitButton.disabled = !canSubmit;
      setChoice(data.currentDaySummary?.submitted ? data.currentDaySummary.ownAction : selectedChoice);
      setChoiceButtons(choiceInput.value, !canSubmit);

      const latest = data.player.history[data.player.history.length - 1];
      if (!latest) {
        setText(
          "studentSummaryText",
          `当前累计到账 0。 / Current total received: 0.`
        );
      } else {
        setText(
          "studentSummaryText",
          `最近一天结果：${outcomeLabel(latest.outcome)}；本日到账 ${latest.payoff}；当前累计 ${latest.cumulative}。 / Latest result: ${outcomeLabel(latest.outcome)}; payoff today ${latest.payoff}; total so far ${latest.cumulative}.`
        );
      }

      studentHistory.innerHTML = data.player.history.length
        ? data.player.history
            .map(
              (item) => `
                <tr>
                  <td>${item.day}</td>
                  <td>${actionLabel(item.action)}${item.defaulted ? " (default)" : ""}</td>
                  <td>${outcomeLabel(item.outcome)}</td>
                  <td>${formatNumber(item.payoff)}</td>
                  <td>${formatNumber(item.cumulative)}</td>
                </tr>
              `
            )
            .join("")
        : `<tr><td colspan="5">还没有个人记录。/ No personal history yet.</td></tr>`;
    } catch (error) {
      persistStudentToken("");
      await renderLobby();
      setText("studentStatus", error.message);
    }
  }

  joinForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const response = await request("/api/bank-run/student/join", {
        method: "POST",
        body: {
          token: getTokenFromUrl() || readStoredToken(),
          name: nameInput.value.trim(),
        },
      });
      persistStudentToken(response.token);
      setChoice("wait");
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
      await request("/api/bank-run/student/submit-choice", {
        method: "POST",
        body: {
          token: getTokenFromUrl() || readStoredToken(),
          action: choiceInput.value,
        },
      });
      await refreshStudent();
    } catch (error) {
      alert(error.message);
    }
  });

  setChoice(selectedChoice);
  refreshStudent();
  window.setInterval(refreshStudent, 1500);
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
