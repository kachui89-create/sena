// app.js (Firestore 전용 버전)
// -------------------------------------------------------
// - Firebase 모듈 CDN import
// - Firestore guildMembers 컬렉션 + guildConfigs/default 사용
// - localStorage 완전 제거

// ===== Firebase import & 초기화 =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
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
console.log("✅ Firebase 초기화 완료(모듈+app.js)", fbApp);

// 컬렉션/문서 레퍼런스
const membersColRef = collection(db, "guildMembers");
const configDocRef = doc(db, "guildConfigs", "default");

// ===== 로그인/권한 관련 상수 =====
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

// Firestore 기준 전역 상태
let membersCache = [];     // guildMembers 컬렉션 스냅샷
let thresholdCache = 300000; // 기준점수 기본값

/* ===== Firestore에서 초기 데이터 로드 ===== */

async function loadConfigFromFirestore() {
  try {
    const snap = await getDoc(configDocRef);
    if (snap.exists()) {
      const data = snap.data() || {};
      if (typeof data.threshold === "number") {
        thresholdCache = data.threshold;
      }
    } else {
      // 문서가 없으면 기본값으로 생성
      await setDoc(
        configDocRef,
        { threshold: thresholdCache, createdAt: serverTimestamp() },
        { merge: true },
      );
    }
    console.log("✅ 설정 로드/초기화 완료, threshold =", thresholdCache);
  } catch (e) {
    console.error("설정 로드 실패:", e);
  }
}

async function loadMembersFromFirestore() {
  try {
    const snap = await getDocs(membersColRef);
    const list = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      // CSV 업로더가 넣어준 구조 그대로 사용 + firestoreId 보존
      list.push(
        normalizeMember({
          ...data,
          firestoreId: docSnap.id,
        }),
      );
    });
    membersCache = list;
    console.log("✅ 멤버 로드 완료:", membersCache.length, "명");
  } catch (e) {
    console.error("멤버 로드 실패:", e);
    membersCache = [];
  }
}

async function saveMembersToFirestore(members) {
  const normalized = members.map((m) => normalizeMember(m));
  membersCache = normalized;

  try {
    await Promise.all(
      normalized.map((member) => {
        const { firestoreId, ...data } = member;
        const docId = firestoreId || String(member.id);
        return setDoc(doc(membersColRef, docId), data, { merge: true });
      }),
    );
    console.log("✅ 멤버 Firestore 저장 완료");
  } catch (e) {
    console.error("멤버 Firestore 저장 실패:", e);
  }
}

/* ===== 유틸 ===== */

function getMembers() {
  // 항상 정규화된 객체 반환
  return membersCache.map((m) => normalizeMember(m));
}

function findMemberIndex(memberId) {
  return membersCache.findIndex((m) => String(m.id) === String(memberId));
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

/* ===== 기준점수 (Firestore 저장) ===== */

function getScoreThreshold() {
  return thresholdCache;
}

async function setScoreThreshold(value) {
  const n = Number(value);
  const safe = Number.isNaN(n) || n < 0 ? 300000 : Math.round(n);
  thresholdCache = safe;
  try {
    await setDoc(
      configDocRef,
      { threshold: safe, updatedAt: serverTimestamp() },
      { merge: true },
    );
    console.log("✅ 기준점수 저장:", safe);
  } catch (e) {
    console.error("기준점수 저장 실패:", e);
  }
  return safe;
}

/* ===== 멤버 정규화 + 방어덱 ===== */

function normalizeMember(member) {
  const base = {
    id: member.id ?? Date.now(),
    firestoreId: member.firestoreId ?? null, // Firestore 문서 id 보존
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

  // 구버전 데이터(scoress) → thisWeek로 마이그레이션
  if (
    Object.keys(scoresByWeek).length === 0 &&
    member.scores &&
    typeof member.scores === "object"
  ) {
    const migrated = {};
    DAYS.forEach(({ key }) => {
      const v = member.scores[key];
      migrated[key] =
        typeof v === "number" && !Number.isNaN(v) && v > 0 ? v : null;
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
      dst[key] =
        typeof v === "number" && !Number.isNaN(v) && v > 0 ? v : null;
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
