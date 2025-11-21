import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  setDoc,
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

let db = null;
const COLLECTION_NAME = "guildMembers";

async function initFirebase() {
  try {
    if (!firebaseConfig || !firebaseConfig.projectId) {
      console.warn("firebaseConfig가 설정되지 않아 로컬 모드로 실행합니다.");
      return;
    }
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    console.log("Firebase 초기화 완료");
  } catch (e) {
    console.error("Firebase 초기화 실패:", e);
    db = null;
  }
}

async function syncMembersFromRemote() {
  if (!db) {
    console.warn("Firestore 미초기화 상태 → 원격 동기화 생략");
    return;
  }
  try {
    const colRef = collection(db, COLLECTION_NAME);
    const snap = await getDocs(colRef);
    const members = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      // 문서 ID와 데이터 안의 id 중 하나라도 사용
      const member = normalizeMember({
        ...data,
        id: data.id || docSnap.id,
      });
      members.push(member);
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(members));
    console.log(`원격 멤버 ${members.length}명 로드 및 로컬 저장 완료`);
  } catch (e) {
    console.error("원격 멤버 로드 실패:", e);
  }
}

// 공성 관리 도구 - 길드 멤버 점수 관리 (LocalStorage + Firestore 사용)

// ====== 로그인/권한 관련 상수 ======
const STORAGE_KEY = "guildMembers";
const THRESHOLD_KEY = "guildScoreThreshold";
const MODE_KEY = "guildViewMode"; // 'admin' | 'member'

// 비밀번호 (영문자)
const MEMBER_PASSWORD = "xhxmsja";  // 토트넘
const ADMIN_PASSWORD = "fbwldwld";  // 류징징

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

// ====== 날짜/주차 유틸 ======

function getWeekStartFromDate(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=일, 1=월, ...
  const diff = (day === 0 ? -6 : 1 - day); // 월요일 기준
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getThisWeekStartDate() {
  return getWeekStartFromDate(new Date());
}

function formatDateYYYYMMDD(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getWeekIdFromDate(date) {
  return formatDateYYYYMMDD(date);
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
  const weekdayNames = ["일", "월", "화", "수", "목", "금", "토"];
  const weekday = weekdayNames[date.getDay()];

  const dayOfMonth = date.getDate();
  const weekNo = Math.floor((dayOfMonth - 1) / 7) + 1;

  return `${year}년 ${month}월 ${dayOfMonth}일 (${weekday}) ${weekNo}주차`;
}

let selectedWeekDate = getThisWeekStartDate();

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

function moveWeek(offset) {
  const d = new Date(selectedWeekDate);
  d.setDate(d.getDate() + offset * 7);
  selectedWeekDate = getWeekStartFromDate(d);
}

// 오늘 날짜 문자열
function getTodayStr() {
  return formatDateYYYYMMDD(new Date());
}

// ===== 숫자 유틸 =====

function formatNumber(num) {
  if (typeof num !== "number" || Number.isNaN(num)) return "";
  return num.toLocaleString("ko-KR");
}

// ===== 기본 점수 구조 =====

function defaultWeekScores() {
  return {
    mon: null,
    tue: null,
    wed: null,
    thu: null,
    fri: null,
    sat: null,
    sun: null,
  };
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

  // 예전 구조(scores: {mon, ...})에서 넘어온 경우 마이그레이션
  if (Object.keys(scoresByWeek).length === 0 && member.scores && typeof member.scores === "object") {
    const migrated = {};
    DAYS.forEach(({ key }) => {
      const v = member.scores[key];
      migrated[key] = typeof v === "number" && !Number.isNaN(v) && v > 0 ? v : null;
    });
    scoresByWeek[thisWeekId] = migrated;
  }

  base.scoresByWeek = scoresByWeek;
  return base;
}

function getScoresForWeek(member, weekId) {
  const scoresByWeek = member.scoresByWeek || {};
  const weekScores = scoresByWeek[weekId] || {};
  const result = { ...defaultWeekScores() };

  DAYS.forEach(({ key }) => {
    const v = weekScores[key];
    result[key] =
      typeof v === "number" && !Number.isNaN(v) && v > 0 ? v : null;
  });

  return result;
}

function getDefenseDeckForWeek(member, weekId) {
  const map = member.defenseDeckByWeek || {};
  return Boolean(map[weekId] || false);
}

/* ===== 점수 합계/평균 계산 ===== */

function calcWeekSummary(scores) {
  const arr = DAYS.map(({ key }) => scores[key] ?? null);
  const valid = arr.filter(
    (v) => typeof v === "number" && !Number.isNaN(v) && v > 0
  );
  const total = valid.reduce((sum, v) => sum + v, 0);
  const avg = valid.length > 0 ? Math.floor(total / valid.length) : 0;
  return { total, avg };
}

/* ===== 로컬 + Firestore 저장소 연동 ===== */

function loadMembers() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((m) => normalizeMember(m));
  } catch (e) {
    console.error("멤버 데이터 로드 오류:", e);
    return [];
  }
}

function saveMembers(members) {
  const normalized = members.map((m) => normalizeMember(m));
  // 1차: 로컬스토리지에 저장 (기존 로직 유지)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));

  // 2차: Firestore에 동기화 (비동기, 호출 측에서는 await 필요 없음)
  if (!db) return;
  (async () => {
    try {
      const colRef = collection(db, COLLECTION_NAME);
      for (const member of normalized) {
        const docId = String(member.id);
        await setDoc(doc(colRef, docId), member, { merge: true });
      }
      console.log("원격 저장 완료 (멤버 수:", normalized.length, ")");
    } catch (e) {
      console.error("원격 저장 중 오류:", e);
    }
  })();
}

/* ===== 주차 포함 여부 ===== */

function isMemberInWeekForScore(member, weekId) {
  const joinWeekId = getWeekIdFromDateStr(member.joinDate);
  const leaveWeekId = member.leaveWeekId || null;
  if (joinWeekId && weekId < joinWeekId) return false;
  if (leaveWeekId && weekId > leaveWeekId) return false;
  return true;
}

function isMemberInThisWeek(member) {
  const weekId = getSelectedWeekId();
  return isMemberInWeekForScore(member, weekId);
}

/* ===== 컷 기준 ===== */

function loadThreshold() {
  const raw = localStorage.getItem(THRESHOLD_KEY);
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isNaN(n) ? 0 : n;
}

function saveThreshold(value) {
  const n = Number(value);
  if (Number.isNaN(n) || n < 0) {
    localStorage.removeItem(THRESHOLD_KEY);
  } else {
    localStorage.setItem(THRESHOLD_KEY, String(n));
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

  const label = document.getElementById("mode-label");
  if (label) {
    label.textContent = `권한: ${isAdmin ? "관리자(류징징)" : "길드원(토트넘)"}`;
  }
}

/* ===== 정렬 관련 ===== */

let currentSortKey = "name"; // 'name' | 'total' | 'defense'
let currentSortDir = "asc";  // 'asc' | 'desc'

function sortMembers(members, weekId) {
  const arr = [...members];
  arr.sort((a, b) => {
    const scoresA = getScoresForWeek(a, weekId);
    const scoresB = getScoresForWeek(b, weekId);
    const summaryA = calcWeekSummary(scoresA);
    const summaryB = calcWeekSummary(scoresB);

    let cmp = 0;
    switch (currentSortKey) {
      case "total":
        cmp = summaryB.total - summaryA.total;
        break;
      case "defense": {
        const defA = getDefenseDeckForWeek(a, weekId) ? 1 : 0;
        const defB = getDefenseDeckForWeek(b, weekId) ? 1 : 0;
        cmp = defB - defA;
        if (cmp === 0) {
          cmp = summaryB.total - summaryA.total;
        }
        break;
      }
      case "name":
      default:
        cmp = a.name.localeCompare(b.name, "ko");
        break;
    }

    if (currentSortDir === "desc") {
      cmp = -cmp;
    }
    return cmp;
  });
  return arr;
}

function setSort(key) {
  if (currentSortKey === key) {
    currentSortDir = currentSortDir === "asc" ? "desc" : "asc";
  } else {
    currentSortKey = key;
    currentSortDir = "asc";
  }
}

function updateSortIndicators() {
  const buttons = document.querySelectorAll(".sort-btn");
  buttons.forEach((btn) => {
    const key = btn.dataset.sortKey;
    if (key === currentSortKey) {
      btn.classList.add("active");
      btn.textContent =
        key === "name"
          ? `닉네임 정렬 (${currentSortDir === "asc" ? "↑" : "↓"})`
          : key === "total"
          ? `총점 정렬 (${currentSortDir === "asc" ? "↑" : "↓"})`
          : `방덱 우선 (${currentSortDir === "asc" ? "↑" : "↓"})`;
    } else {
      btn.classList.remove("active");
      btn.textContent =
        key === "name"
          ? "닉네임 정렬"
          : key === "total"
          ? "총점 정렬"
          : "방덱 참여 우선";
    }
  });
}

/* ===== 렌더링 ===== */

function renderWeekLabel() {
  const labelEl = document.getElementById("week-label");
  if (!labelEl) return;
  labelEl.textContent = getWeekLabelFromDate(selectedWeekDate);
}

function renderSummary(members) {
  const weekId = getSelectedWeekId();
  const activeMembers = members.filter((m) =>
    isMemberInWeekForScore(m, weekId)
  );

  const activeCount = activeMembers.length;

  let totalScore = 0;
  let totalDaysCount = 0;
  let defenseCount = 0;

  activeMembers.forEach((member) => {
    const scores = getScoresForWeek(member, weekId);
    const summary = calcWeekSummary(scores);
    totalScore += summary.total;
    if (summary.total > 0) totalDaysCount++;
    if (getDefenseDeckForWeek(member, weekId)) defenseCount++;
  });

  const avgScore =
    activeCount > 0 ? Math.floor(totalScore / activeCount) : 0;

  const activeCountEl = document.getElementById("active-count");
  const totalScoreEl = document.getElementById("total-score");
  const avgScoreEl = document.getElementById("avg-score");
  const defenseCountEl = document.getElementById("defense-count");

  if (activeCountEl) activeCountEl.textContent = String(activeCount);
  if (totalScoreEl) totalScoreEl.textContent = formatNumber(totalScore);
  if (avgScoreEl) avgScoreEl.textContent = formatNumber(avgScore);
  if (defenseCountEl) defenseCountEl.textContent = String(defenseCount);
}

function renderActiveMembers(members) {
  const tbody = document.getElementById("active-members-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  const weekId = getSelectedWeekId();
  const threshold = loadThreshold();

  const activeMembers = members.filter((m) =>
    isMemberInWeekForScore(m, weekId)
  );

  const sorted = sortMembers(activeMembers, weekId);

  sorted.forEach((member, index) => {
    const scores = getScoresForWeek(member, weekId);
    const summary = calcWeekSummary(scores);
    const defense = getDefenseDeckForWeek(member, weekId);

    const tr = document.createElement("tr");
    tr.dataset.memberId = member.id;

    if (summary.total > 0 && summary.total < threshold) {
      tr.classList.add("below-threshold");
    }

    const idxTd = document.createElement("td");
    idxTd.textContent = String(index + 1);
    tr.appendChild(idxTd);

    const nameTd = document.createElement("td");
    nameTd.textContent = member.name;
    tr.appendChild(nameTd);

    const roleTd = document.createElement("td");
    roleTd.textContent = member.role;
    tr.appendChild(roleTd);

    const joinTd = document.createElement("td");
    joinTd.textContent = member.joinDate || "";
    tr.appendChild(joinTd);

    const leaveTd = document.createElement("td");
    leaveTd.textContent = member.leaveWeekId || "";
    tr.appendChild(leaveTd);

    const statusTd = document.createElement("td");
    statusTd.textContent =
      member.status === "left" ? "탈퇴" : "활동중";
    tr.appendChild(statusTd);

    DAYS.forEach(({ key }) => {
      const td = document.createElement("td");
      const v = scores[key];
      const input = document.createElement("input");
      input.type = "text";
      input.inputMode = "numeric";
      input.pattern = "[0-9,]*";
      input.value =
        typeof v === "number" && !Number.isNaN(v) && v > 0
          ? formatNumber(v)
          : "";
      input.dataset.dayKey = key;
      input.dataset.memberId = member.id;

      input.addEventListener("change", handleScoreInputChange);

      td.appendChild(input);
      tr.appendChild(td);
    });

    const totalTd = document.createElement("td");
    totalTd.textContent =
      summary.total > 0 ? formatNumber(summary.total) : "";
    tr.appendChild(totalTd);

    const avgTd = document.createElement("td");
    avgTd.textContent =
      summary.avg > 0 ? formatNumber(summary.avg) : "";
    tr.appendChild(avgTd);

    const cutTd = document.createElement("td");
    if (threshold > 0 && summary.total > 0) {
      cutTd.textContent =
        summary.total >= threshold ? "O" : "X";
    } else {
      cutTd.textContent = "";
    }
    tr.appendChild(cutTd);

    const defenseTd = document.createElement("td");
    const defCheckbox = document.createElement("input");
    defCheckbox.type = "checkbox";
    defCheckbox.checked = defense;
    defCheckbox.dataset.memberId = member.id;
    defCheckbox.addEventListener("change", handleDefenseToggle);
    defenseTd.appendChild(defCheckbox);
    tr.appendChild(defenseTd);

    const actionTd = document.createElement("td");
    actionTd.classList.add("admin-only");

    const editBtn = document.createElement("button");
    editBtn.textContent = "정보";
    editBtn.addEventListener("click", () =>
      fillMemberFormForEdit(member)
    );
    actionTd.appendChild(editBtn);

    const leftBtn = document.createElement("button");
    leftBtn.textContent = "탈퇴";
    leftBtn.addEventListener("click", () =>
      markMemberLeft(member)
    );
    actionTd.appendChild(leftBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "삭제";
    deleteBtn.addEventListener("click", () =>
      deleteMember(member)
    );
    actionTd.appendChild(deleteBtn);

    tr.appendChild(actionTd);

    tbody.appendChild(tr);
  });
}

function renderWeekSummary(members) {
  const tbody = document.getElementById("week-summary-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  const weekId = getSelectedWeekId();

  const activeMembers = members.filter((m) =>
    isMemberInWeekForScore(m, weekId)
  );

  DAYS.forEach(({ key, label }) => {
    let total = 0;
    let count = 0;

    activeMembers.forEach((member) => {
      const scores = getScoresForWeek(member, weekId);
      const v = scores[key];
      if (typeof v === "number" && !Number.isNaN(v) && v > 0) {
        total += v;
        count++;
      }
    });

    const tr = document.createElement("tr");

    const dayTd = document.createElement("td");
    dayTd.textContent = label;
    tr.appendChild(dayTd);

    const totalTd = document.createElement("td");
    totalTd.textContent = total > 0 ? formatNumber(total) : "";
    tr.appendChild(totalTd);

    const avg = count > 0 ? Math.floor(total / count) : 0;
    const avgTd = document.createElement("td");
    avgTd.textContent = avg > 0 ? formatNumber(avg) : "";
    tr.appendChild(avgTd);

    tbody.appendChild(tr);
  });
}

function renderLeftMembers(members) {
  const tbody = document.getElementById("left-members-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  const selectedWeekId = getSelectedWeekId();

  const leftThisWeek = members
    .map((m) => normalizeMember(m))
    .filter(
      (m) => m.status === "left" && m.leaveWeekId === selectedWeekId
    );

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

    tbody.appendChild(tr);
  });
}

function renderMemberArchive(members) {
  const tbody = document.getElementById("member-archive-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  const sorted = [...members].sort((a, b) =>
    a.name.localeCompare(b.name, "ko")
  );

  sorted.forEach((member, idx) => {
    const tr = document.createElement("tr");
    tr.dataset.memberId = member.id;

    const idxTd = document.createElement("td");
    idxTd.textContent = String(idx + 1);
    tr.appendChild(idxTd);

    const nameTd = document.createElement("td");
    nameTd.textContent = member.name;
    tr.appendChild(nameTd);

    const roleTd = document.createElement("td");
    roleTd.textContent = member.role;
    tr.appendChild(roleTd);

    const joinTd = document.createElement("td");
    joinTd.textContent = member.joinDate || "";
    tr.appendChild(joinTd);

    const leaveTd = document.createElement("td");
    leaveTd.textContent = member.leaveWeekId || "";
    tr.appendChild(leaveTd);

    const statusTd = document.createElement("td");
    statusTd.textContent =
      member.status === "left" ? "탈퇴" : "활동중";
    tr.appendChild(statusTd);

    const actionTd = document.createElement("td");
    const editBtn = document.createElement("button");
    editBtn.textContent = "정보";
    editBtn.addEventListener("click", () =>
      fillMemberFormForEdit(member)
    );
    actionTd.appendChild(editBtn);

    const leftBtn = document.createElement("button");
    leftBtn.textContent = "탈퇴";
    leftBtn.addEventListener("click", () =>
      markMemberLeft(member)
    );
    actionTd.appendChild(leftBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "삭제";
    deleteBtn.addEventListener("click", () =>
      deleteMember(member)
    );
    actionTd.appendChild(deleteBtn);

    tr.appendChild(actionTd);

    tbody.appendChild(tr);
  });
}

/* ===== 이벤트 핸들러 ===== */

function handleScoreInputChange(event) {
  const mode = getCurrentMode();
  if (mode === "member") return; // 길드원 모드에서는 수정 불가

  const input = event.currentTarget;
  const dayKey = input.dataset.dayKey;
  const memberId = input.dataset.memberId;
  if (!dayKey || !memberId) return;

  const members = loadMembers();
  const idx = members.findIndex((m) => String(m.id) === String(memberId));
  if (idx === -1) return;

  const member = members[idx];
  const selectedWeekId = getSelectedWeekId();

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
  const member = members[idx];

  if (!member.defenseDeckByWeek) {
    member.defenseDeckByWeek = {};
  }
  member.defenseDeckByWeek[selectedWeekId] = checkbox.checked;

  members[idx] = member;
  saveMembers(members);
  renderAll();
}

function fillMemberFormForEdit(member) {
  const nameInput = document.getElementById("member-name-input");
  const roleInput = document.getElementById("member-role-input");
  const joinInput = document.getElementById("member-join-input");
  const statusInput = document.getElementById("member-status-input");
  const leaveWeekInput = document.getElementById("member-leave-week-input");
  const leaveTypeInput = document.getElementById("member-leave-type-input");

  if (!nameInput) return;

  nameInput.value = member.name || "";
  if (roleInput) roleInput.value = member.role || "길드원";
  if (joinInput) joinInput.value = member.joinDate || "";
  if (statusInput) statusInput.value = member.status || "active";
  if (leaveWeekInput) leaveWeekInput.value = member.leaveWeekId || "";
  if (leaveTypeInput) leaveTypeInput.value = member.leaveType || "";
}

function markMemberLeft(member) {
  const weekId = getSelectedWeekId();
  const leaveDate = selectedWeekDate;

  const leaveWeekStr = formatDateYYYYMMDD(leaveDate);

  const leaveType = prompt(
    `탈퇴 유형을 입력하세요. (예: 자진탈퇴, 강퇴)\n(빈칸으로 두면 공란으로 저장됩니다.)`,
    member.leaveType || ""
  );

  const members = loadMembers();
  const idx = members.findIndex((m) => String(m.id) === String(member.id));
  if (idx === -1) return;

  const updated = {
    ...members[idx],
    status: "left",
    leaveWeekId: leaveWeekStr,
    leaveType: leaveType || null,
  };

  members[idx] = normalizeMember(updated);
  saveMembers(members);
  renderAll();
}

function deleteMember(member) {
  const mode = getCurrentMode();
  if (mode === "member") return;

  if (!confirm("해당 멤버를 완전히 삭제하시겠습니까? (되돌릴 수 없습니다)")) return;

  const members = loadMembers();
  const filtered = members.filter((m) => String(m.id) !== String(member.id));
  saveMembers(filtered);
  renderAll();
}

/* ===== 모드/로그인 ===== */

function setupLogin() {
  const overlay = document.getElementById("login-overlay");
  const form = document.getElementById("login-form");
  const input = document.getElementById("login-password");
  const errorEl = document.getElementById("login-error");

  if (!overlay || !form || !input) return;

  const existingMode = getCurrentMode();
  if (existingMode) {
    overlay.style.display = "none";
    applyMode(existingMode);
    return;
  }

  overlay.style.display = "flex";

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = input.value.trim();

    let mode = null;
    if (value === MEMBER_PASSWORD) {
      mode = "member";
    } else if (value === ADMIN_PASSWORD) {
      mode = "admin";
    } else {
      errorEl.textContent = "비밀번호가 올바르지 않습니다.";
      return;
    }

    sessionStorage.setItem(MODE_KEY, mode);
    overlay.style.display = "none";
    errorEl.textContent = "";
    input.value = "";
    renderAll(); // 모드 적용까지 다시 렌더링
  });
}

/* ===== 주차 컨트롤 ===== */

function setupWeekControls() {
  const prevBtn = document.getElementById("prev-week-btn");
  const nextBtn = document.getElementById("next-week-btn");
  const thisBtn = document.getElementById("this-week-btn");

  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      moveWeek(-1);
      renderAll();
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      moveWeek(1);
      renderAll();
    });
  }
  if (thisBtn) {
    thisBtn.addEventListener("click", () => {
      selectedWeekDate = getThisWeekStartDate();
      renderAll();
    });
  }
}

/* ===== 컷 기준 컨트롤 ===== */

function setupThresholdControls() {
  const input = document.getElementById("threshold-input");
  const applyBtn = document.getElementById("threshold-apply-btn");
  const label = document.getElementById("threshold-label");

  const threshold = loadThreshold();
  if (input) input.value = threshold > 0 ? String(threshold) : "";
  if (label) {
    label.textContent =
      threshold > 0 ? `현재 컷: ${formatNumber(threshold)}` : "컷 기준 없음";
  }

  if (applyBtn && input && label) {
    applyBtn.addEventListener("click", () => {
      const raw = input.value.replace(/,/g, "").trim();
      const n = raw === "" ? 0 : Number(raw);
      if (Number.isNaN(n) || n < 0) {
        alert("0 이상 숫자를 입력하세요.");
        return;
      }
      saveThreshold(n);
      label.textContent =
        n > 0 ? `현재 컷: ${formatNumber(n)}` : "컷 기준 없음";
      renderAll();
    });
  }
}

/* ===== 정렬 컨트롤 ===== */

function setupSortControls() {
  const buttons = document.querySelectorAll(".sort-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.sortKey;
      if (!key) return;
      setSort(key);
      renderAll();
    });
  });
  updateSortIndicators();
}

/* ===== 멤버 추가/수정 폼 ===== */

function setupMemberForm() {
  const addBtn = document.getElementById("member-add-btn");
  if (!addBtn) return;

  addBtn.addEventListener("click", () => {
    const nameInput = document.getElementById("member-name-input");
    const roleInput = document.getElementById("member-role-input");
    const joinInput = document.getElementById("member-join-input");
    const statusInput = document.getElementById("member-status-input");
    const leaveWeekInput = document.getElementById("member-leave-week-input");
    const leaveTypeInput = document.getElementById("member-leave-type-input");

    if (!nameInput || !roleInput || !joinInput || !statusInput) return;

    const name = nameInput.value.trim();
    if (!name) {
      alert("닉네임을 입력해주세요.");
      return;
    }

    const role = roleInput.value || "길드원";
    const joinDate = joinInput.value || getTodayStr();
    const status = statusInput.value || "active";
    const leaveWeekId = leaveWeekInput.value || null;
    const leaveType = leaveTypeInput.value || null;

    const members = loadMembers();
    const existingIdx = members.findIndex((m) => m.name === name);

    if (existingIdx >= 0) {
      const prev = members[existingIdx];
      members[existingIdx] = normalizeMember({
        ...prev,
        role,
        joinDate,
        status,
        leaveWeekId,
        leaveType,
      });
    } else {
      members.push(
        normalizeMember({
          id: Date.now(),
          name,
          role,
          joinDate,
          status,
          leaveWeekId,
          leaveType,
          scoresByWeek: {},
          defenseDeckByWeek: {},
        })
      );
    }

    saveMembers(members);
    renderAll();

    nameInput.value = "";
    joinInput.value = "";
    statusInput.value = "active";
    if (leaveWeekInput) leaveWeekInput.value = "";
    if (leaveTypeInput) leaveTypeInput.value = "";
  });
}

/* ===== 공통 렌더링 & 셋업 ===== */

function renderAll() {
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

/* ===== 초기화 ===== */

document.addEventListener("DOMContentLoaded", () => {
  (async () => {
    await initFirebase();
    await syncMembersFromRemote();
    setupLogin();
    setupMemberForm();
    setupWeekControls();
    setupThresholdControls();
    setupSortControls();
    renderAll();
  })();
});
