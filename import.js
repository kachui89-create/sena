// import.js
// members.csv + scores.csv → Firestore(guildMembers 컬렉션) + localStorage 업로드 도구

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  setDoc,
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

// Firebase 설정값
const firebaseConfig = {
  apiKey: "AIzaSyBKvKAPMwG0FJQj7n3OmX7Ld3sUrPpqtQA",
  authDomain: "sena-guild-tool.firebaseapp.com",
  projectId: "sena-guild-tool",
  storageBucket: "sena-guild-tool.firebasestorage.app",
  messagingSenderId: "93989921944",
  appId: "1:93989921944:web:2b3aa298d6f97481411ced",
  measurementId: "G-5YSK93P66B",
};

// Firebase 초기화
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Firestore 컬렉션 / localStorage 키 (app.js와 동일하게 맞추기)
const COLLECTION_NAME = "guildMembers";
const STORAGE_KEY = "guildMembers";

/* ========= 공통 유틸 ========= */

function log(message) {
  const logEl = document.getElementById("log");
  if (!logEl) return;
  const time = new Date().toLocaleTimeString("ko-KR");
  logEl.textContent += `[${time}] ${message}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function parseCsv(text) {
  // 매우 단순한 CSV 파서 (큰따옴표 포함 복잡한 경우는 가정하지 않음)
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return { header: [], rows: [] };

  const header = lines[0].split(",").map((v) => v.trim());
  const rows = lines.slice(1).map((line, idx) => {
    const cols = line.split(",").map((v) => v.trim());
    return { lineNumber: idx + 2, cols }; // 2행부터 데이터
  });

  return { header, rows };
}

function getIndex(header, key) {
  return header.indexOf(key);
}

function isValidDateStr(str) {
  if (!str) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, d] = str.split("-").map((s) => Number(s));
  const dt = new Date(y, m - 1, d);
  return (
    dt.getFullYear() === y &&
    dt.getMonth() === m - 1 &&
    dt.getDate() === d
  );
}

/* ========= Firestore 관련 ========= */

// 이미 있는 멤버(닉네임)과 ID를 미리 캐싱해서 이름 → ID 매핑
async function buildMemberIndex() {
  const colRef = collection(db, COLLECTION_NAME);
  const snapshot = await getDocs(colRef);
  const mapByName = new Map();

  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    if (data && data.name) {
      mapByName.set(String(data.name), {
        id: data.id || docSnap.id,
        data
      });
    }
  });

  log(`기존 Firestore 멤버 ${mapByName.size}명 로드 완료.`);
  return mapByName;
}

// 새로운 멤버 생성
async function createMember(member, mapByName) {
  const colRef = collection(db, COLLECTION_NAME);
  const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const docRef = doc(colRef, id);

  const baseData = {
    id,
    name: member.name,
    role: member.role || "길드원",
    joinDate: member.joinDate,
    status: member.status || "active",
    leaveWeekId: member.leaveWeekId || null,
    leaveType: member.leaveType || null,
    scoresByWeek: {},       // 나중에 scores.csv에서 채움
    defenseDeckByWeek: {},  // 나중에 scores.csv에서 채움
  };

  await setDoc(docRef, baseData);
  mapByName.set(member.name, { id, data: baseData });
  return { id, data: baseData };
}

// 기존 멤버 데이터 업데이트 (기존 scoresByWeek 등 유지)
async function upsertMember(member, existing, mapByName) {
  const colRef = collection(db, COLLECTION_NAME);
  const id = existing?.id || `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const docRef = doc(colRef, id);
  const prev = existing?.data || {};

  const merged = {
    ...prev,
    id,
    name: member.name ?? prev.name,
    role: member.role || prev.role || "길드원",
    joinDate: member.joinDate || prev.joinDate,
    status: member.status || prev.status || "active",
    leaveWeekId: member.leaveWeekId || prev.leaveWeekId || null,
    leaveType: member.leaveType || prev.leaveType || null,
    scoresByWeek: prev.scoresByWeek || {},
    defenseDeckByWeek: prev.defenseDeckByWeek || {},
  };

  await setDoc(docRef, merged, { merge: true });
  mapByName.set(merged.name, { id, data: merged });
  return { id, data: merged };
}

/* ========= members.csv 처리 ========= */

async function importMembersCsv(file, mapByName) {
  if (!file) {
    log("members.csv 파일이 선택되지 않아 이 단계는 건너뜁니다.");
    return mapByName;
  }

  log(`members.csv 읽는 중: ${file.name} (${file.size} bytes)`);

  const text = await file.text();
  const { header, rows } = parseCsv(text);

  const nameIdx = getIndex(header, "name");
  const roleIdx = getIndex(header, "role");
  const joinIdx = getIndex(header, "joinDate");
  const statusIdx = getIndex(header, "status");
  const leaveWeekIdx = getIndex(header, "leaveWeekId");
  const leaveTypeIdx = getIndex(header, "leaveType");

  if (nameIdx === -1 || joinIdx === -1) {
    log("❌ members.csv 헤더에 name, joinDate 는 필수입니다.");
    throw new Error("members.csv 헤더(name, joinDate)가 필요합니다.");
  }

  let success = 0;
  let fail = 0;

  for (const row of rows) {
    const cols = row.cols;
    const name = cols[nameIdx] || "";
    const role = roleIdx >= 0 ? cols[roleIdx] || "길드원" : "길드원";
    const joinDate = cols[joinIdx] || "";
    const status = statusIdx >= 0 ? (cols[statusIdx] || "active") : "active";
    const leaveWeekId = leaveWeekIdx >= 0 ? (cols[leaveWeekIdx] || "") : "";
    const leaveType = leaveTypeIdx >= 0 ? (cols[leaveTypeIdx] || "") : "";

    if (!name) {
      log(`⚠ [행 ${row.lineNumber}] name 비어있음 → 건너뜀`);
      fail++;
      continue;
    }
    if (!isValidDateStr(joinDate)) {
      log(`⚠ [행 ${row.lineNumber}] joinDate 형식 오류: ${joinDate}`);
      fail++;
      continue;
    }
    if (leaveWeekId && !isValidDateStr(leaveWeekId)) {
      log(`⚠ [행 ${row.lineNumber}] leaveWeekId 형식 오류: ${leaveWeekId} → null 처리`);
    }

    try {
      const existing = mapByName.get(name);
      const member = {
        name,
        role,
        joinDate,
        status,
        leaveWeekId: leaveWeekId && isValidDateStr(leaveWeekId) ? leaveWeekId : null,
        leaveType: leaveType || null,
      };
      if (existing) {
        await upsertMember(member, existing, mapByName);
        log(`✅ [행 ${row.lineNumber}] 기존 멤버 갱신: ${name}`);
      } else {
        await createMember(member, mapByName);
        log(`✅ [행 ${row.lineNumber}] 신규 멤버 생성: ${name}`);
      }
      success++;
    } catch (err) {
      console.error(err);
      log(`❌ [행 ${row.lineNumber}] ${name} 처리 실패: ${err.message}`);
      fail++;
    }
  }

  log(`members.csv 처리 완료 → 성공 ${success}건 / 실패 ${fail}건`);
  return mapByName;
}

/* ========= scores.csv 처리 ========= */

async function importScoresCsv(file, mapByName) {
  if (!file) {
    log("scores.csv 파일이 선택되지 않아 이 단계는 건너뜁니다.");
    return mapByName;
  }

  log(`scores.csv 읽는 중: ${file.name} (${file.size} bytes)`);

  const text = await file.text();
  const { header, rows } = parseCsv(text);

  const nameIdx = getIndex(header, "name");
  const weekIdx = getIndex(header, "weekId");
  const monIdx = getIndex(header, "mon");
  const tueIdx = getIndex(header, "tue");
  const wedIdx = getIndex(header, "wed");
  const thuIdx = getIndex(header, "thu");
  const friIdx = getIndex(header, "fri");
  const satIdx = getIndex(header, "sat");
  const sunIdx = getIndex(header, "sun");
  const defIdx = getIndex(header, "defense");

  if (nameIdx === -1 || weekIdx === -1) {
    log("❌ scores.csv 헤더에 name, weekId 는 필수입니다.");
    throw new Error("scores.csv 헤더(name, weekId)가 필요합니다.");
  }

  let success = 0;
  let fail = 0;

  const colRef = collection(db, COLLECTION_NAME);

  for (const row of rows) {
    const cols = row.cols;
    const name = cols[nameIdx] || "";
    const weekId = cols[weekIdx] || "";

    if (!name) {
      log(`⚠ [행 ${row.lineNumber}] name 비어있음 → 건너뜀`);
      fail++;
      continue;
    }
    if (!isValidDateStr(weekId)) {
      log(`⚠ [행 ${row.lineNumber}] weekId 형식 오류: ${weekId} → 건너뜀`);
      fail++;
      continue;
    }

    const mon = monIdx >= 0 ? Number(cols[monIdx] || 0) : 0;
    const tue = tueIdx >= 0 ? Number(cols[tueIdx] || 0) : 0;
    const wed = wedIdx >= 0 ? Number(cols[wedIdx] || 0) : 0;
    const thu = thuIdx >= 0 ? Number(cols[thuIdx] || 0) : 0;
    const fri = friIdx >= 0 ? Number(cols[friIdx] || 0) : 0;
    const sat = satIdx >= 0 ? Number(cols[satIdx] || 0) : 0;
    const sun = sunIdx >= 0 ? Number(cols[sunIdx] || 0) : 0;
    const defRaw = defIdx >= 0 ? (cols[defIdx] || "") : "";
    const defense = defRaw.toUpperCase() === "Y";

    try {
      let existing = mapByName.get(name);
      if (!existing) {
        // members.csv에 없고 Firestore에도 없으면 최소정보로 새로 만든다.
        log(`ℹ [행 ${row.lineNumber}] members에 없는 닉네임 → 최소정보로 생성: ${name}`);
        existing = await createMember({
          name,
          role: "길드원",
          joinDate: weekId, // 임시로 이 주차를 가입일로
          status: "active",
          leaveWeekId: null,
          leaveType: null,
        }, mapByName);
      }

      const docRef = doc(colRef, existing.id);
      const prev = existing.data || {};
      const scoresByWeek = prev.scoresByWeek || {};
      const defenseDeckByWeek = prev.defenseDeckByWeek || {};

      // 0 이하거나 NaN이면 null 로 저장 → app.js의 normalizeMember 기준에 맞춤
      const safe = (n) =>
        typeof n === "number" && !Number.isNaN(n) && n > 0 ? n : null;

      const weekScores = {
        mon: safe(mon),
        tue: safe(tue),
        wed: safe(wed),
        thu: safe(thu),
        fri: safe(fri),
        sat: safe(sat),
        sun: safe(sun),
      };

      scoresByWeek[weekId] = weekScores;
      defenseDeckByWeek[weekId] = defense;

      const merged = {
        ...prev,
        scoresByWeek,
        defenseDeckByWeek,
      };

      await setDoc(docRef, merged, { merge: true });
      mapByName.set(name, { id: existing.id, data: merged });

      log(`✅ [행 ${row.lineNumber}] 점수 업로드 완료: ${name} / ${weekId}`);
      success++;
    } catch (err) {
      console.error(err);
      log(`❌ [행 ${row.lineNumber}] ${name} (${weekId}) 처리 실패: ${err.message}`);
      fail++;
    }
  }

  log(`scores.csv 처리 완료 → 성공 ${success}건 / 실패 ${fail}건`);
  return mapByName;
}

/* ========= 메인 업로드 흐름 ========= */

async function handleUpload() {
  const membersFile = document.getElementById("members-file")?.files[0] || null;
  const scoresFile = document.getElementById("scores-file")?.files[0] || null;

  if (!membersFile && !scoresFile) {
    alert("members.csv 또는 scores.csv 중 최소 1개는 선택해야 합니다.");
    return;
  }

  try {
    log("=== Firestore 기존 멤버 인덱스 로드 시작 ===");
    let memberIndex = await buildMemberIndex();

    // 1단계: members.csv (있으면 실행)
    memberIndex = await importMembersCsv(membersFile, memberIndex);

    // 2단계: scores.csv (있으면 실행)
    memberIndex = await importScoresCsv(scoresFile, memberIndex);

    // 🔹 3단계: Firestore에 반영된 최종 데이터를 localStorage에도 저장
    const membersArray = Array.from(memberIndex.values()).map((entry) => entry.data);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(membersArray));
      log(`로컬 저장소(${STORAGE_KEY})에 ${membersArray.length}명 저장 완료.`);
    } catch (e) {
      console.error(e);
      log(`⚠ localStorage 저장 중 오류: ${e.message}`);
    }

    log("=== 전체 업로드 작업 완료 ===");
    alert("업로드 작업이 완료되었습니다. (원격 + 로컬 반영)");
  } catch (err) {
    console.error(err);
    log(`❌ 전체 처리 중 오류 발생: ${err.message}`);
    alert("업로드 중 오류가 발생했습니다. 로그를 확인해주세요.");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("upload-btn");
  if (btn) {
    btn.addEventListener("click", () => {
      handleUpload();
    });
  }
  log("업로드 도구 준비 완료. members.csv / scores.csv 선택 후 [업로드 시작]을 눌러주세요.");
});
