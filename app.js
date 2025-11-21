// app.js (Firestore 전용 버전)
// -------------------------------------------------------
// - localStorage 완전 제거
// - Firestore(guildConfigs/default)만 진짜 데이터 소스로 사용
// - CSV 업로더(import.html)가 저장한 구조를 그대로 사용

// ===== Firebase import & 초기화 =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

// 네 Firebase 설정값
const firebaseConfig = {
  apiKey: "AIzaSyBKvKAPMwG0FJQj7n3OmX7Ld3sUrPpqtQA",
  authDomain: "sena-guild-tool.firebaseapp.com",
  projectId: "sena-guild-tool",
  storageBucket: "sena-guild-tool.firebasestorage.app",
  messagingSenderId: "93989921944",
  appId: "1:93989921944:web:2b3aa298d6f97481411ced",
  measurementId: "G-5YSK93P66B",
};

// Firebase & Firestore 준비
const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);
const remoteDocRef = doc(db, "guildConfigs", "default");
console.log("✅ Firebase 초기화 완료(모듈+app.js)", fbApp);

// ===== 로그인/권한 관련 상수 =====
// (이제 localStorage 대신 Firestore만 사용, 로그인은 그대로 sessionStorage 사용)
const MODE_KEY = "guildViewMode"; // 'admin' | 'member'

// 비밀번호 (영문자)
const MEMBER_PASSWORD = "xhxmsja"; // 토트넘
const ADMIN_PASSWORD = "fbwldwld"; // 류징징

const MAX_ACTIVE = 30;

// 요일 정의
const DAYS = [
  { key: "mon", label: "월" },
  { key: "tue", label: "화" },
  { key: "wed", label: "수" },
  { key: "thu", label: "목" },
  { key: "fri", label: "금" },
  { key: "sat", label: "토" },
  { key: "sun", label: "일" },
];

// 선택된 주(월요일 기준 날짜 객체)
let selectedWeekDate = getThisWeekStartDate();

// 정렬 상태
let sortState = {
  key: "total", // 기본: 합계 기준
  dir: "desc", // 내림차순
};

// Firestore 저장 디바운스용 타이머
let remoteSaveTimer = null;

// 🔥 앱 상태 (Firestore만 사용)
let appState = {
  members: [],      // Firestore에서 불러온 멤버 배열
  threshold: 300000, // 기준 점수
  loaded: false,    // Firestore 로딩 완료 여부
};

/* ===== Firestore ←→ 앱 상태 ===== */

async function loadRemoteState() {
  try {
    const snap = await getDoc(remoteDocRef);
    if (!snap.exists()) {
      console.log("원격 문서 없음(최초 실행일 수 있음) - 빈 상태로 시작합니다.");
      appState.members = [];
      appState.threshold = 300000;
      appState.loaded = true;
      return;
    }

    const data = snap.data() || {};
    const rawMembers = Array.isArray(data.members) ? data.members : [];
    const normalized = rawMembers.map((m) => normalizeMember(m));

    let threshold = 300000;
    if (typeof data.threshold === "number" && !Number.isNaN(data.threshold)) {
      threshold = data.threshold;
    }

    appState.members = normalized;
    appState.threshold = threshold;
    appState.loaded = true;

    console.log(
      `원격 데이터 로드 완료: 멤버 ${normalized.length}명, 기준점수 ${threshold.toLocaleString("ko-KR")}`,
    );
  } catch (e) {
    console.error("원격 데이터 로드 실패:", e);
    appState.members = [];
    appState.threshold = 300000;
    appState.loaded = true;
  }
}

function scheduleRemoteSave() {
  if (!remoteDocRef) return;

  if (remoteSaveTimer) clearTimeout(remoteSaveTimer);
  remoteSaveTimer = setTimeout(async () => {
    try {
      const payload = {
        members: appState.members.map((m) => normalizeMember(m)),
        threshold: appState.threshold,
        updatedAt: serverTimestamp(),
      };
      await setDoc(remoteDocRef, payload);
      console.log("원격 데이터 저장 완료 (members/threshold)");
    } catch (e) {
      console.error("원격 데이터 저장 실패:", e);
    }
  }, 800);
}

/* ===== 날짜 / 주차 관련 유틸 ===== */

function getThisWeekStartDate() {
  const now = new Date();
  return getWeekStartFromDate(now);
}

function getWeekStartFromDate(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay() === 0 ? 7 : d.getDay(); // 월=1 ~ 일=7
  const diff = day - 1;
  d.setDate(d.getDate() - diff);
  return d;
}

function getWeekIdFromDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`; // 해당 주의 월요일 날짜
}

function getWeekIdFromDateStr(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split("-");
  if (parts.length !== 3) return null;
  const year = Number(parts[0]);
  const month = Number(parts[1]) - 1;
  const day = Number(parts[2]);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
    return null;
  }
  const d = new Date(year, month, day);
  const weekStart = getWeekStartFromDate(d);
  return getWeekIdFromDate(weekStart);
}

function getWeekLabelFromDate(date) {
  const year = date.getFullYear();
  const monthIdx = date.getMonth();
  const month = String(monthIdx + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const weekdayNames = ["일", "월", "화", "수", "목", "금", "토"];
  const weekday = weekdayNames[date.getDay()];

  const dayOfMonth = date.getDate();
  const weekNo = Math.floor((dayOfMonth - 1) / 7) + 1;

  return `${year}년 ${month}월 ${day}일 (${weekday}) ${weekNo}주차`;
}

function getSelectedWeekId() {
  return getWeekIdFromDate(selectedWeekDate);
}

function getThisWeekInfo() {
  const d = getThisWeekStartDate();
  return {
    weekId: getWeekIdFromDate(d),
    label: getWeekLabelFromDate(d),
  };
}

function renderWeekLabel() {
  const labelEl = document.getElementById("week-label");
  if (!labelEl) return;
  labelEl.textContent = getWeekLabelFromDate(selectedWeekDate);
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

/* ===== 숫자 / 점수 관련 유틸 ===== */

function getTodayStr() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatNumber(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  return n.toLocaleString("ko-KR");
}

function defaultWeekScores() {
  const scores = {};
  DAYS.forEach(({ key }) => {
    scores[key] = null;
  });
  return scores;
}

function calcScoreSummary(scores) {
  let total = 0;
  let count = 0;

  DAYS.forEach(({ key }) => {
    const v = scores ? scores[key] : null;
    if (typeof v === "number" && !Number.isNaN(v) && v > 0) {
      total += v;
      count += 1;
    }
  });

  const avg = count === 0 ? null : total / count;
  return { total, avg, count };
}

function gradeForScore(score) {
  if (typeof score !== "number" || !Number.isFinite(score) || score <= 0) {
    return "";
  }
  if (score >= 100000000) return "EX+";
  if (score >= 75000000) return "EX";
  if (score >= 50000000) return "SSS";
  if (score >= 30000000) return "SS";
  if (score >= 15000000) return "S";
  if (score >= 10000000) return "A";
  if (score >= 7500000) return "B";
  if (score >= 5000000) return "C";
  if (score >= 2500000) return "D";
  return "F";
}

/* ===== 기준점수 (Firestore 기반) ===== */

function getScoreThreshold() {
  const raw = appState.threshold;
  if (typeof raw !== "number" || Number.isNaN(raw) || raw < 0) return 300000;
  return raw;
}

function setScoreThreshold(value) {
  const n = Number(value);
  const safe = Number.isNaN(n) || n < 0 ? 300000 : Math.round(n);
  appState.threshold = safe;
  scheduleRemoteSave();
  return safe;
}

/* ===== 멤버 정규화 + 방어덱 ===== */

function normalizeMember(member) {
  const base = {
    id: member.id ?? Date.now(),
    name: member.name ?? "",
    role: member.role ?? "길드원",
    joinDate: member.joinDate ?? getTodayStr(),
    status: member.status ?? "active",
    leaveWeekId: member.leaveWeekId ?? null,
    leaveType: member.leaveType ?? null,
    scoresByWeek: member.scoresByWeek ?? {},
    defenseDeckByWeek: member.defenseDeckByWeek ?? {},
  };

  const thisWeekId = getThisWeekInfo().weekId;
  let scoresByWeek = base.scoresByWeek;
  if (!scoresByWeek || typeof scoresByWeek !== "object") scoresByWeek = {};

  // 구버전 데이터(scores) → thisWeek로 마이그레이션
  if (
    Object.keys(scoresByWeek).length === 0 &&
    member.scores &&
    typeof member.scores === "object"
  ) {
    const migrated = {};
    DAYS.forEach(({ key }) => {
      const v = member.scores[key];
      migrated[key] = typeof v === "number" && !Number.isNaN(v) && v > 0 ? v : null;
    });
    scoresByWeek[thisWeekId] = migrated;
  }

  const normalizedScoresByWeek = {};
  for (const weekId in scoresByWeek) {
    if (!Object.prototype.hasOwnProperty.call(scoresByWeek, weekId)) continue;
    const src = scoresByWeek[weekId] || {};
    const dst = {};
    DAYS.forEach(({ key }) => {
      const v = src[key];
      dst[key] = typeof v === "number" && !Number.isNaN(v) && v > 0 ? v : null;
    });
    normalizedScoresByWeek[weekId] = dst;
  }

  return { ...base, scoresByWeek: normalizedScoresByWeek };
}

function getDefenseDeckForWeek(member, weekId) {
  const map = member.defenseDeckByWeek || {};
  if (Object.prototype.hasOwnProperty.call(map, weekId)) return !!map[weekId];
  const keys = Object.keys(map).filter((k) => k <= weekId);
  if (keys.length === 0) return false;
  keys.sort();
  const lastKey = keys[keys.length - 1];
  return !!map[lastKey];
}

/* ===== Firestore 기반 멤버 로드/저장 ===== */

function loadMembers() {
  if (!appState.loaded) return [];
  return appState.members.map((m) => normalizeMember(m));
}

function saveMembers(members) {
  const normalized = members.map((m) => normalizeMember(m));
  appState.members = normalized;
  scheduleRemoteSave();
}

/* ===== 주차 포함 여부 ===== */

function isMemberInWeekForScore(member, weekId) {
  const joinWeekId = getWeekIdFromDateStr(member.joinDate);
  const leaveWeekId = member.leaveWeekId || null;
  if (joinWeekId && weekId < joinWeekId) return false;
  if (leaveWeekId && weekId > leaveWeekId) return false;
  return true;
}

function isMemberInWeekForActiveTable(member, weekId) {
  const joinWeekId = getWeekIdFromDateStr(member.joinDate);
  const leaveWeekId = member.leaveWeekId || null;
  if (joinWeekId && weekId < joinWeekId) return false;
  if (leaveWeekId && weekId >= leaveWeekId) return false;
  if (member.status !== "active") return false;
  return true;
}

/* ===== 상단 요약 ===== */

function renderSummary(members) {
  const active = members.filter((m) => m.status === "active");
  const activeCount = active.length;

  const activeCountEl = document.getElementById("active-count");
  const limitMessageEl = document.getElementById("limit-message");
  const addHelpEl = document.getElementById("add-help");
  const submitBtn = document.getElementById("member-submit-btn");

  if (activeCountEl) activeCountEl.textContent = String(activeCount);
  if (!submitBtn || !limitMessageEl || !addHelpEl) return;

  if (activeCount >= MAX_ACTIVE) {
    submitBtn.disabled = true;
    limitMessageEl.textContent =
      "활동 인원이 30명에 도달했습니다. 인원이 줄어야 신규 멤버를 추가할 수 있습니다.";
    addHelpEl.textContent = "탈퇴/재가입 또는 삭제로 인원을 조정해 주세요.";
  } else {
    submitBtn.disabled = false;
    limitMessageEl.textContent = "";
    addHelpEl.textContent =
      "활동 인원이 30명을 넘으면 멤버 추가가 자동으로 막힙니다.";
  }
}

/* ===== 정렬 ===== */

function getSortValue(entry, key) {
  const { scores, summary, member } = entry;
  switch (key) {
    case "name":
      return member.name || "";
    case "role":
      return member.role || "";
    case "total":
      return summary.total;
    case "avg":
      return summary.avg ?? -Infinity;
    case "mon":
    case "tue":
    case "wed":
    case "thu":
    case "fri":
    case "sat":
    case "sun":
      return scores[key] ?? 0;
    case "rank":
    default:
      return summary.total;
  }
}

/* ===== 모드 관련 ===== */

function getCurrentMode() {
  const saved = sessionStorage.getItem(MODE_KEY);
  if (saved === "admin" || saved === "member") return saved;
  return null;
}

function applyMode(mode) {
  if (!mode) return;
  const isAdmin = mode === "admin";

  document.body.dataset.mode = mode;

  document.querySelectorAll(".admin-only").forEach((el) => {
    el.style.display = isAdmin ? "" : "none";
  });

  document.querySelectorAll(".score-input").forEach((input) => {
    input.disabled = !isAdmin;
    if (!isAdmin) {
      input.classList.add("readonly");
    } else {
      input.classList.remove("readonly");
    }
  });

  document
    .querySelectorAll("input[type='checkbox'][data-member-id]")
    .forEach((cb) => {
      cb.disabled = !isAdmin;
    });

  document.querySelectorAll("button.admin-only").forEach((btn) => {
    btn.style.display = isAdmin ? "" : "none";
  });

  const thresholdInput = document.getElementById("threshold-input");
  if (thresholdInput) {
    thresholdInput.disabled = !isAdmin;
  }
}

/* ===== 활동 멤버 렌더링 ===== */

function renderActiveMembers(members) {
  const tbody = document.getElementById("active-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  const selectedWeekId = getSelectedWeekId();

  const activeEntries = members
    .map((m) => normalizeMember(m))
    .filter((m) => isMemberInWeekForActiveTable(m, selectedWeekId))
    .map((m) => {
      let scores = m.scoresByWeek[selectedWeekId];
      if (!scores) scores = defaultWeekScores();
      const summary = calcScoreSummary(scores);
      const defense = getDefenseDeckForWeek(m, selectedWeekId);
      return { member: m, scores, summary, defense };
    });

  activeEntries.sort((a, b) => {
    const va = getSortValue(a, sortState.key);
    const vb = getSortValue(b, sortState.key);
    if (typeof va === "string" || typeof vb === "string") {
      const sa = String(va);
      const sb = String(vb);
      const res = sa.localeCompare(sb, "ko-KR");
      return sortState.dir === "asc" ? res : -res;
    }
    const na = Number(va);
    const nb = Number(vb);
    if (na === nb) return 0;
    return sortState.dir === "asc" ? na - nb : nb - na;
  });

  activeEntries.forEach((entry, index) => {
    const { member, scores, summary, defense } = entry;
    const tr = document.createElement("tr");

    const rankTd = document.createElement("td");
    rankTd.textContent = String(index + 1);
    const nameTd = document.createElement("td");
    nameTd.textContent = member.name;
    const roleTd = document.createElement("td");
    roleTd.textContent = member.role;

    tr.appendChild(rankTd);
    tr.appendChild(nameTd);
    tr.appendChild(roleTd);

    DAYS.forEach(({ key }) => {
      const td = document.createElement("td");
      const input = document.createElement("input");
      input.type = "text";
      input.inputMode = "numeric";
      input.className = "score-input";
      input.dataset.memberId = String(member.id);
      input.dataset.dayKey = key;

      const v = scores[key];
      input.value =
        typeof v === "number" && !Number.isNaN(v) && v > 0
          ? formatNumber(v)
          : "";

      input.addEventListener("change", handleScoreChange);
      td.appendChild(input);
      tr.appendChild(td);
    });

    const totalTd = document.createElement("td");
    totalTd.textContent = formatNumber(summary.total);
    const avgTd = document.createElement("td");
    if (summary.count === 0 || summary.avg === null) {
      avgTd.textContent = "";
    } else {
      avgTd.textContent = formatNumber(Math.round(summary.avg));
    }

    const defenseTd = document.createElement("td");
    const defenseCheckbox = document.createElement("input");
    defenseCheckbox.type = "checkbox";
    defenseCheckbox.dataset.memberId = String(member.id);
    defenseCheckbox.checked = !!defense;
    defenseCheckbox.addEventListener("change", handleDefenseToggle);
    defenseTd.appendChild(defenseCheckbox);

    tr.appendChild(totalTd);
    tr.appendChild(avgTd);
    tr.appendChild(defenseTd);

    tbody.appendChild(tr);
  });
}

/* ===== 점수/방어덱 핸들러 ===== */

function handleScoreChange(event) {
  const mode = getCurrentMode();
  if (mode === "member") return;

  const input = event.currentTarget;
  const memberId = input.dataset.memberId;
  const dayKey = input.dataset.dayKey;
  if (!memberId || !dayKey) return;

  const members = loadMembers();
  const idx = members.findIndex((m) => String(m.id) === String(memberId));
  if (idx === -1) return;

  const selectedWeekId = getSelectedWeekId();
  const member = normalizeMember(members[idx]);
  if (!member.scoresByWeek[selectedWeekId]) {
    member.scoresByWeek[selectedWeekId] = defaultWeekScores();
  }

  const raw = input.value.replace(/,/g, "").trim();
  let newVal = null;
  if (raw !== "") {
    const n = Number(raw);
    newVal = !Number.isNaN(n) && n > 0 ? n : null;
  }

  member.scoresByWeek[selectedWeekId][dayKey] = newVal;
  members[idx] = member;
  saveMembers(members);
  renderAll();
}

function handleDefenseToggle(event) {
  const mode = getCurrentMode();
  if (mode === "member") return;

  const checkbox = event.currentTarget;
  const memberId = checkbox.dataset.memberId;
  if (!memberId) return;

  const members = loadMembers();
  const idx = members.findIndex((m) => String(m.id) === String(memberId));
  if (idx === -1) return;

  const selectedWeekId = getSelectedWeekId();
  const member = normalizeMember(members[idx]);
  if (!member.defenseDeckByWeek) member.defenseDeckByWeek = {};
  member.defenseDeckByWeek[selectedWeekId] = checkbox.checked;
  members[idx] = member;

  saveMembers(members);
  renderAll();
}

/* ===== 주간 합계표 ===== */

function renderWeekSummary(members) {
  const tbody = document.getElementById("week-summary-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  const selectedWeekId = getSelectedWeekId();
  const active = members
    .map((m) => normalizeMember(m))
    .filter((m) => isMemberInWeekForScore(m, selectedWeekId));

  const threshold = getScoreThreshold();

  const daySums = [];
  const dayParticipants = [];
  const dayBelowThreshold = [];

  DAYS.forEach(({ key }, idx) => {
    let sum = 0;
    let participants = 0;
    let below = 0;

    active.forEach((member) => {
      const scores = member.scoresByWeek[selectedWeekId];
      if (!scores) return;
      const v = scores[key];
      if (typeof v === "number" && !Number.isNaN(v) && v > 0) {
        sum += v;
        participants += 1;
        if (v < threshold) below += 1;
      }
    });

    daySums[idx] = sum;
    dayParticipants[idx] = participants;
    dayBelowThreshold[idx] = below;
  });

  const totalSum = daySums.reduce((acc, v) => acc + v, 0);
  const daysWithScore = daySums.filter((v) => v > 0).length;
  const avgSum = daysWithScore === 0 ? null : totalSum / daysWithScore;

  const totalParticipants = dayParticipants.reduce((acc, v) => acc + v, 0);
  const daysWithParticipants = dayParticipants.filter((v) => v > 0).length;
  const avgParticipants =
    daysWithParticipants === 0 ? null : totalParticipants / daysWithParticipants;

  const totalBelow = dayBelowThreshold.reduce((acc, v) => acc + v, 0);
  const avgBelow =
    daysWithParticipants === 0 ? null : totalBelow / daysWithParticipants;

  // 1) 합계 행
  const sumTr = document.createElement("tr");
  const sumLabelTd = document.createElement("td");
  sumLabelTd.textContent = "합계";
  sumTr.appendChild(sumLabelTd);
  daySums.forEach((v) => {
    const td = document.createElement("td");
    td.textContent = formatNumber(v);
    sumTr.appendChild(td);
  });
  const sumTotalTd = document.createElement("td");
  sumTotalTd.textContent = formatNumber(totalSum);
  sumTr.appendChild(sumTotalTd);
  const sumAvgTd = document.createElement("td");
  sumAvgTd.textContent =
    avgSum === null ? "" : formatNumber(Math.round(avgSum));
  sumTr.appendChild(sumAvgTd);
  tbody.appendChild(sumTr);

  // 2) 등급 행
  const gradeTr = document.createElement("tr");
  const gradeLabelTd = document.createElement("td");
  gradeLabelTd.textContent = "등급";
  gradeTr.appendChild(gradeLabelTd);
  daySums.forEach((v) => {
    const td = document.createElement("td");
    td.textContent = gradeForScore(v);
    gradeTr.appendChild(td);
  });
  const gradeTotalTd = document.createElement("td");
  gradeTotalTd.textContent = gradeForScore(totalSum);
  gradeTr.appendChild(gradeTotalTd);
  const gradeAvgTd = document.createElement("td");
  gradeAvgTd.textContent = gradeForScore(avgSum === null ? 0 : avgSum);
  gradeTr.appendChild(gradeAvgTd);
  tbody.appendChild(gradeTr);

  // 3) 참여인원 행
  const partTr = document.createElement("tr");
  const partLabelTd = document.createElement("td");
  partLabelTd.textContent = "참여인원";
  partTr.appendChild(partLabelTd);
  dayParticipants.forEach((v) => {
    const td = document.createElement("td");
    td.textContent = v > 0 ? formatNumber(v) : "";
    partTr.appendChild(td);
  });
  const partTotalTd = document.createElement("td");
  partTotalTd.textContent =
    totalParticipants > 0 ? formatNumber(totalParticipants) : "";
  partTr.appendChild(partTotalTd);
  const partAvgTd = document.createElement("td");
  partAvgTd.textContent =
    avgParticipants === null ? "" : formatNumber(Math.round(avgParticipants));
  partTr.appendChild(partAvgTd);
  tbody.appendChild(partTr);

  // 4) 기준점수미달 행
  const belowTr = document.createElement("tr");
  const belowLabelTd = document.createElement("td");
  belowLabelTd.textContent = "기준점수미달";
  belowTr.appendChild(belowLabelTd);
  dayBelowThreshold.forEach((v) => {
    const td = document.createElement("td");
    td.textContent = v > 0 ? formatNumber(v) : "";
    belowTr.appendChild(td);
  });
  const belowTotalTd = document.createElement("td");
  belowTotalTd.textContent =
    totalBelow > 0 ? formatNumber(totalBelow) : "";
  belowTr.appendChild(belowTotalTd);
  const belowAvgTd = document.createElement("td");
  belowAvgTd.textContent =
    avgBelow === null ? "" : formatNumber(Math.round(avgBelow));
  belowTr.appendChild(belowAvgTd);
  tbody.appendChild(belowTr);

  const thresholdInput = document.getElementById("threshold-input");
  if (thresholdInput) {
    thresholdInput.value = formatNumber(threshold);
    thresholdInput.disabled = getCurrentMode() === "member";
  }
}

/* ===== 선택 주 탈퇴자 ===== */

function renderLeftMembers(members) {
  const tbody = document.getElementById("left-combined-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  const selectedWeekId = getSelectedWeekId();

  const leftThisWeek = members
    .map((m) => normalizeMember(m))
    .filter((m) => m.status === "left" && m.leaveWeekId === selectedWeekId);

  leftThisWeek.forEach((member) => {
    const scores = member.scoresByWeek[selectedWeekId] || defaultWeekScores();
    const defense = getDefenseDeckForWeek(member, selectedWeekId);

    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.textContent = member.name;
    const leaveTypeTd = document.createElement("td");
    leaveTypeTd.textContent = member.leaveType || "";

    tr.appendChild(nameTd);
    tr.appendChild(leaveTypeTd);

    DAYS.forEach(({ key }) => {
      const td = document.createElement("td");
      const v = scores[key];
      td.textContent =
        typeof v === "number" && !Number.isNaN(v) && v > 0
          ? formatNumber(v)
          : "";
      tr.appendChild(td);
    });

    const leaveWeekTd = document.createElement("td");
    leaveWeekTd.textContent = member.leaveWeekId || "";
    tr.appendChild(leaveWeekTd);

    const defenseTd = document.createElement("td");
    defenseTd.textContent = defense ? "방어" : "";
    tr.appendChild(defenseTd);

    const actionTd = document.createElement("td");
    const restoreBtn = document.createElement("button");
    restoreBtn.textContent = "탈퇴 취소";
    restoreBtn.dataset.memberId = String(member.id);
    restoreBtn.classList.add("admin-only");
    restoreBtn.classList.add("action-btn-small");
    restoreBtn.addEventListener("click", handleRestoreMember);
    actionTd.appendChild(restoreBtn);
    tr.appendChild(actionTd);

    tbody.appendChild(tr);
  });
}

/* ===== 누적 관리 ===== */

function getRolePriority(role) {
  if (role === "길드장") return 0;
  if (role === "부길드장") return 1;
  return 2;
}

function renderMemberArchive(members) {
  const tbody = document.getElementById("member-archive-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  const all = members.map((m) => normalizeMember(m));

  all.sort((a, b) => {
    if (a.status === b.status) {
      if (a.status === "active") {
        const ra = getRolePriority(a.role);
        const rb = getRolePriority(b.role);
        if (ra !== rb) return ra - rb;
        if (a.joinDate === b.joinDate) {
          return a.name.localeCompare(b.name, "ko-KR");
        }
        return a.joinDate < b.joinDate ? -1 : 1;
      } else {
        const la = a.leaveWeekId;
        const lb = b.leaveWeekId;
        if (la === lb) {
          if (a.joinDate === b.joinDate) {
            return a.name.localeCompare(b.name, "ko-KR");
          }
          return a.joinDate < b.joinDate ? -1 : 1;
        }
        if (!la) return 1;
        if (!lb) return -1;
        return la > lb ? -1 : 1;
      }
    }
    return a.status === "active" ? -1 : 1;
  });

  all.forEach((member, index) => {
    const tr = document.createElement("tr");

    const noTd = document.createElement("td");
    noTd.textContent = String(index + 1);
    const nameTd = document.createElement("td");
    nameTd.textContent = member.name;

    const roleTd = document.createElement("td");
    if (member.status === "active") {
      roleTd.textContent = member.role;
    } else {
      roleTd.textContent = member.leaveType || "탈퇴";
    }

    const joinTd = document.createElement("td");
    joinTd.textContent = member.joinDate || "-";

    const leaveWeekTd = document.createElement("td");
    leaveWeekTd.textContent = member.leaveWeekId || "";

    const statusTd = document.createElement("td");
    statusTd.textContent = member.status === "active" ? "현멤버" : "탈퇴";

    const actionTd = document.createElement("td");
    if (member.status === "left") {
      const rejoinBtn = document.createElement("button");
      rejoinBtn.textContent = "재가입";
      rejoinBtn.dataset.memberId = String(member.id);
      rejoinBtn.classList.add("admin-only");
      rejoinBtn.classList.add("action-btn-small");
      rejoinBtn.addEventListener("click", handleRestoreMember);

      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "완전 삭제";
      deleteBtn.dataset.memberId = String(member.id);
      deleteBtn.classList.add("admin-only");
      deleteBtn.classList.add("action-btn-small", "delete");
      deleteBtn.style.marginLeft = "4px";
      deleteBtn.addEventListener("click", handleDeleteMember);

      actionTd.appendChild(rejoinBtn);
      actionTd.appendChild(deleteBtn);
    } else {
      const leaveBtn = document.createElement("button");
      leaveBtn.textContent = "탈퇴 처리";
      leaveBtn.dataset.memberId = String(member.id);
      leaveBtn.classList.add("admin-only");
      leaveBtn.classList.add("action-btn-small");
      leaveBtn.addEventListener("click", handleLeaveMember);
      actionTd.appendChild(leaveBtn);
    }

    tr.appendChild(noTd);
    tr.appendChild(nameTd);
    tr.appendChild(roleTd);
    tr.appendChild(joinTd);
    tr.appendChild(leaveWeekTd);
    tr.appendChild(statusTd);
    tr.appendChild(actionTd);

    tbody.appendChild(tr);
  });
}

/* ===== 탈퇴/재가입/삭제 ===== */

function chooseLeaveType() {
  const isKick = window.confirm(
    "강퇴로 처리하시겠습니까?\n[확인] 강퇴 / [취소] 자진탈퇴",
  );
  return isKick ? "강퇴" : "자진탈퇴";
}

function handleLeaveMember(event) {
  const mode = getCurrentMode();
  if (mode === "member") return;

  const button = event.currentTarget;
  const memberId = button.dataset.memberId;
  if (!memberId) return;

  const leaveWeekId = getSelectedWeekId();
  const members = loadMembers();
  const idx = members.findIndex((m) => String(m.id) === String(memberId));
  if (idx === -1) return;

  const leaveType = chooseLeaveType();
  members[idx].status = "left";
  members[idx].leaveWeekId = leaveWeekId;
  members[idx].leaveType = leaveType;

  saveMembers(members);
  renderAll();
}

function handleRestoreMember(event) {
  const mode = getCurrentMode();
  if (mode === "member") return;

  const button = event.currentTarget;
  const memberId = button.dataset.memberId;
  if (!memberId) return;

  const members = loadMembers();
  const idx = members.findIndex((m) => String(m.id) === String(memberId));
  if (idx === -1) return;

  const today = getTodayStr();
  members[idx].status = "active";
  members[idx].leaveWeekId = null;
  members[idx].leaveType = null;
  members[idx].joinDate = today;

  saveMembers(members);
  renderAll();
}

function handleDeleteMember(event) {
  const mode = getCurrentMode();
  if (mode === "member") return;

  const button = event.currentTarget;
  const memberId = button.dataset.memberId;
  if (!memberId) return;
  if (!confirm("해당 멤버를 완전히 삭제하시겠습니까? (되돌릴 수 없습니다)")) return;

  const members = loadMembers();
  const filtered = members.filter((m) => String(m.id) !== String(memberId));
  saveMembers(filtered);
  renderAll();
}

/* ===== 공통 렌더링 & 셋업 ===== */

function renderAll() {
  if (!appState.loaded) {
    console.log("아직 Firestore 로딩 전, 렌더링 건너뜀");
    return;
  }
  const members = loadMembers();
  renderWeekLabel();
  renderSummary(members);
  renderActiveMembers(members);
  renderWeekSummary(members);
  renderLeftMembers(members);
  renderMemberArchive(members);
  updateSortIndicators();

  const mode = getCurrentMode();
  if (mode) applyMode(mode);
}

function setupMemberForm() {
  const form = document.getElementById("member-form");
  if (!form) return;

  const joinDateInput = document.getElementById("member-join-date");
  if (joinDateInput) joinDateInput.value = getTodayStr();

  form.addEventListener("submit", (event) => {
    const mode = getCurrentMode();
    if (mode === "member") {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    const nameInput = document.getElementById("member-name");
    const roleSelect = document.getElementById("member-role");
    if (!nameInput || !roleSelect) return;

    const name = nameInput.value.trim();
    const role = roleSelect.value;
    const joinDateInputNow = document.getElementById("member-join-date");
    const joinDateValue =
      joinDateInputNow && joinDateInputNow.value
        ? joinDateInputNow.value
        : getTodayStr();

    if (!name) {
      alert("닉네임을 입력해주세요.");
      return;
    }

    const members = loadMembers();
    const activeCount = members.filter((m) => m.status === "active").length;
    if (activeCount >= MAX_ACTIVE) {
      alert("활동 인원이 30명을 초과하여 더 이상 추가할 수 없습니다.");
      return;
    }

    const selectedWeekId = getSelectedWeekId();
    const newMember = normalizeMember({
      id: Date.now(),
      name,
      role,
      joinDate: joinDateValue,
      status: "active",
      leaveWeekId: null,
      leaveType: null,
      scoresByWeek: { [selectedWeekId]: defaultWeekScores() },
      defenseDeckByWeek: {},
    });

    members.push(newMember);
    saveMembers(members);

    nameInput.value = "";
    roleSelect.value = "길드원";
    if (joinDateInputNow) joinDateInputNow.value = getTodayStr();

    renderAll();
  });
}

function setupWeekControls() {
  const prevBtn = document.getElementById("prev-week-btn");
  const nextBtn = document.getElementById("next-week-btn");
  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      selectedWeekDate = addDays(selectedWeekDate, -7);
      renderAll();
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      selectedWeekDate = addDays(selectedWeekDate, 7);
      renderAll();
    });
  }
}

function setupThresholdControls() {
  const input = document.getElementById("threshold-input");
  if (!input) return;
  const current = getScoreThreshold();
  input.value = formatNumber(current);
  input.addEventListener("change", () => {
    const mode = getCurrentMode();
    if (mode === "member") {
      const cur = getScoreThreshold();
      input.value = formatNumber(cur);
      return;
    }
    const raw = input.value.replace(/,/g, "").trim();
    const safe = setScoreThreshold(raw === "" ? 300000 : raw);
    input.value = formatNumber(safe);
    renderAll();
  });
}

function setupSortControls() {
  const headerRow = document.querySelector("#active-members thead tr");
  if (!headerRow) return;
  headerRow.querySelectorAll("th.sortable").forEach((th) => {
    const key = th.dataset.sortKey;
    if (!key) return;
    th.addEventListener("click", () => {
      if (sortState.key === key) {
        sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
      } else {
        sortState.key = key;
        sortState.dir = ["name", "role"].includes(key) ? "asc" : "desc";
      }
      renderAll();
    });
  });
}

function updateSortIndicators() {
  const headerRow = document.querySelector("#active-members thead tr");
  if (!headerRow) return;
  headerRow.querySelectorAll("th.sortable").forEach((th) => {
    th.classList.remove("sort-asc", "sort-desc");
    const key = th.dataset.sortKey;
    if (!key) return;
    if (key === sortState.key) {
      th.classList.add(sortState.dir === "asc" ? "sort-asc" : "sort-desc");
    }
  });
}

/* ===== 로그인 ===== */

function setupLogin() {
  const overlay = document.getElementById("login-overlay");
  const form = document.getElementById("login-form");
  const input = document.getElementById("login-password");
  const errorEl = document.getElementById("login-error");

  if (!overlay || !form || !input || !errorEl) return;

  const savedMode = getCurrentMode();
  if (savedMode) {
    overlay.style.display = "none";
    return;
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = input.value.trim();
    let mode = null;

    if (value === MEMBER_PASSWORD) mode = "member";
    if (value === ADMIN_PASSWORD) mode = "admin";

    if (!mode) {
      errorEl.textContent = "비밀번호가 올바르지 않습니다.";
      return;
    }

    sessionStorage.setItem(MODE_KEY, mode);
    overlay.style.display = "none";
    errorEl.textContent = "";
    input.value = "";
    renderAll();
  });
}

/* ===== 로그아웃 버튼 ===== */

function setupLogout() {
  const logoutBtn = document.getElementById("logout-btn");
  if (!logoutBtn) return;
  logoutBtn.addEventListener("click", () => {
    sessionStorage.removeItem(MODE_KEY);
    location.reload();
  });
}

/* ===== 초기화 ===== */

document.addEventListener("DOMContentLoaded", async () => {
  setupLogin();
  setupLogout();
  setupMemberForm();
  setupWeekControls();
  setupThresholdControls();
  setupSortControls();

  // 1) Firestore → appState 로 로드
  await loadRemoteState();

  // 2) UI 렌더링
  renderAll();
});
