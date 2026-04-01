const role = new URLSearchParams(window.location.search).get("role") || "home";
const studentTokenKey = "public-goods-student-token";

const teacherPanel = document.getElementById("teacherPanel");
const studentPanel = document.getElementById("studentPanel");
const homeActions = document.getElementById("homeActions");

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function formatNumber(value) {
  return Number.isInteger(value) ? `${value}` : `${Number(value).toFixed(1)}`;
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
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function initTeacher() {
  const joinUrlNode = document.getElementById("joinUrl");
  const qrImage = document.getElementById("qrImage");
  const historyTable = document.getElementById("historyTable");
  const seatBoard = document.getElementById("seatBoard");
  const startRoundButton = document.getElementById("startRoundButton");
  const closeRoundButton = document.getElementById("closeRoundButton");
  const resetButton = document.getElementById("resetButton");

  async function refreshTeacher() {
    try {
      const data = await request("/api/teacher/state");
      setText("teacherStatus", {
        lobby: "等待开始",
        collecting: "正在收集",
        results: "已结算",
        finished: "已结束",
      }[data.status] || data.status);
      setText("teacherSessionCode", `房间码 ${data.sessionCode}`);
      setText("currentRoundValue", `${data.currentRound} / ${data.maxRounds}`);
      setText("joinedCountValue", `${data.joinedCount} / ${data.seatCount}`);
      setText(
        "submittedCountValue",
        `${data.currentRoundSummary?.submittedCount || 0} / ${data.seatCount}`
      );
      setText("discussionHint", `第 ${data.discussionAfterRound + 1} 轮前讨论`);
      setText(
        "roundTotalValue",
        data.currentRoundSummary?.totalContribution == null
          ? "--"
          : formatNumber(data.currentRoundSummary.totalContribution)
      );
      setText(
        "roundShareValue",
        data.currentRoundSummary?.publicShare == null
          ? "--"
          : formatNumber(data.currentRoundSummary.publicShare)
      );

      joinUrlNode.textContent = data.joinUrl;
      qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(data.joinUrl)}`;

      seatBoard.innerHTML = data.players
        .map((player) => {
          const activeRound =
            data.currentRoundSummary?.submissions?.find((item) => item.seat === player.seat) ||
            null;

          return `
            <div class="seat-tile">
              <div class="stat-label">座位 ${player.seat}</div>
              <strong>${player.joined ? "已加入" : "空位"}</strong>
              <div class="tiny">${player.name || "未命名"}</div>
              <div class="tiny">累计 ${formatNumber(player.cumulative)}</div>
              <div class="tiny">${activeRound ? `本轮已投 ${activeRound.contribution}` : "本轮未提交"}</div>
            </div>
          `;
        })
        .join("");

      historyTable.innerHTML = data.roundHistory.length
        ? data.roundHistory
            .map(
              (round) => `
                <tr>
                  <td>第 ${round.number} 轮</td>
                  <td>${formatNumber(round.totalContribution)}</td>
                  <td>${formatNumber(round.publicShare)}</td>
                </tr>
              `
            )
            .join("")
        : `<tr><td colspan="3" class="muted">还没有已结算的轮次</td></tr>`;

      startRoundButton.disabled = data.status === "collecting" || data.status === "finished";
      closeRoundButton.disabled = data.status !== "collecting";
    } catch (error) {
      setText("teacherStatus", error.message);
    }
  }

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
    if (!window.confirm("确定要重置整场实验吗？所有轮次记录会清空。")) return;

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
  const studentWorkspace = document.getElementById("studentWorkspace");
  const joinForm = document.getElementById("joinForm");
  const submitForm = document.getElementById("submitForm");
  const joinTip = document.getElementById("joinTip");
  const contributionInput = document.getElementById("contributionInput");
  const nameInput = document.getElementById("nameInput");
  const seatInput = document.getElementById("seatInput");
  const studentHistory = document.getElementById("studentHistory");

  let token = window.localStorage.getItem(studentTokenKey) || "";

  async function refreshStudent() {
    if (!token) {
      setText("studentStatus", "等待进入");
      return;
    }

    try {
      const data = await request(`/api/student/state?token=${encodeURIComponent(token)}`);

      joinCard.classList.add("hidden");
      studentWorkspace.classList.remove("hidden");
      setText(
        "studentStatus",
        {
          lobby: "等待教师开始",
          collecting: data.currentRoundSummary?.submitted ? "已提交，等待结算" : "正在提交",
          results: "本轮已结算",
          finished: "实验已结束",
        }[data.status] || data.status
      );
      setText("studentSeatBadge", `座位 ${data.player.seat}`);
      setText("studentCumulative", formatNumber(data.player.cumulative));
      setText(
        "studentRoundTotal",
        data.currentRoundSummary?.totalContribution == null
          ? "--"
          : formatNumber(data.currentRoundSummary.totalContribution)
      );
      setText(
        "studentRoundShare",
        data.currentRoundSummary?.publicShare == null
          ? "--"
          : formatNumber(data.currentRoundSummary.publicShare)
      );

      const canSubmit = data.status === "collecting" && !data.currentRoundSummary?.submitted;
      document.querySelector("#submitForm button").disabled = !canSubmit;
      contributionInput.disabled = !canSubmit;

      const instruction = document.getElementById("studentInstruction");
      if (data.status === "lobby") {
        instruction.textContent = "教师还没有开始本轮，请等待。";
      } else if (data.status === "collecting") {
        instruction.textContent = data.currentRoundSummary?.submitted
          ? `第 ${data.currentRound} 轮已提交：你投了 ${data.currentRoundSummary.ownContribution}。`
          : `第 ${data.currentRound} 轮进行中。请输入 0 到 10 的整数后提交。`;
      } else if (data.status === "results") {
        instruction.textContent = `第 ${data.currentRound} 轮已结算。请查看本轮总投入和你的累计得分。`;
      } else if (data.status === "finished") {
        instruction.textContent = "5 轮全部结束。请保留页面查看你的完整记录。";
      }

      studentHistory.innerHTML = data.player.history.length
        ? data.player.history
            .map(
              (item) => `
                <tr>
                  <td>第 ${item.round} 轮</td>
                  <td>${formatNumber(item.contribution)}</td>
                  <td>${formatNumber(item.totalContribution)}</td>
                  <td>${formatNumber(item.score)}</td>
                  <td>${formatNumber(item.cumulative)}</td>
                </tr>
              `
            )
            .join("")
        : `<tr><td colspan="5" class="muted">还没有已结算记录</td></tr>`;
    } catch (error) {
      window.localStorage.removeItem(studentTokenKey);
      token = "";
      joinCard.classList.remove("hidden");
      studentWorkspace.classList.add("hidden");
      joinTip.textContent = error.message;
      setText("studentStatus", "需要重新进入");
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
    const contribution = Number(contributionInput.value);

    try {
      await request("/api/student/submit", {
        method: "POST",
        body: { token, contribution },
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
  teacherPanel.classList.remove("hidden");
  homeActions?.classList.add("hidden");
  initTeacher();
} else if (role === "student") {
  studentPanel.classList.remove("hidden");
  homeActions?.classList.add("hidden");
  initStudent();
}
