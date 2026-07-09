import { auth, db } from "../../js/firebase-config.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const COLLECTIONS = {
  users: "users",
  staff: "staff",
  staffLoginAccounts: "staff_login_accounts",
  properties: "properties",
  moveOutSettlements: "move_out_settlements",
  moveOuts: "move_outs",
  residents: "residents",
  bookings: "bookings",
  beds: "beds",
  notifications: "notifications",
  activityLogs: "activity_logs"
};

const COLORS = {
  navy: "#08233f",
  gold: "#d09112",
  green: "#22a55a",
  red: "#ef4444",
  blue: "#2563eb",
  purple: "#7c3aed",
  orange: "#f97316"
};

const defaultChecklistItems = [
  "Furniture (Bed, Table, Chair, Wardrobe)",
  "Appliances (AC, Fan, Fridge, etc.)",
  "Fixtures (Lights, Switches, Socket)",
  "Bathroom & Plumbing",
  "Keys & Access Cards",
  "Walls, Doors & Windows",
  "Cleanliness"
];

const session = {
  uid: "",
  role: "Staff",
  name: "Staff",
  email: "",
  staffId: "",
  propertyId: ""
};

const state = {
  activeTab: "today",
  selectedKey: "",
  userData: null,
  staffRecord: null,
  loginRecord: null,
  propertyRecord: null,

  moveOutSettlements: [],
  moveOuts: [],
  residents: [],
  bookings: [],
  properties: [],
  notifications: [],
  activityLogs: [],

  checklistState: [],
  generalRemarks: "",
  readNotificationKeys: new Set(),
  syncedNotificationIds: new Set(),
  loading: false
};

const normalize = (value) => String(value || "").trim().toLowerCase();

const escapeHtml = (text) => String(text ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const setText = (id, value) => {
  const element = $(id);
  if (element) element.textContent = value;
};

function firstText(values, fallback = "") {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }

  return fallback;
}

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sameDay(a, b) {
  const dateA = toDate(a);
  const dateB = toDate(b);

  if (!dateA || !dateB) return false;

  return (
    dateA.getDate() === dateB.getDate() &&
    dateA.getMonth() === dateB.getMonth() &&
    dateA.getFullYear() === dateB.getFullYear()
  );
}

function isToday(value) {
  return sameDay(value, new Date());
}

function isPast(value) {
  const date = toDate(value);
  if (!date) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const compare = new Date(date);
  compare.setHours(0, 0, 0, 0);

  return compare < today;
}

function formatDate(value) {
  const date = toDate(value);
  if (!date) return "-";

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function formatTime(value) {
  const date = toDate(value);
  if (!date) return "-";

  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });
}

function formatDateTime(value) {
  const date = toDate(value);
  if (!date) return "-";

  return `${formatDate(date)}, ${formatTime(date)}`;
}

function timeAgo(value) {
  const date = toDate(value);
  if (!date) return "Just now";

  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;

  return formatDate(date);
}

function twoDigits(value) {
  return String(value).padStart(2, "0");
}

function initials(name) {
  const clean = String(name || "Resident").trim();
  const parts = clean.split(/\s+/).filter(Boolean);

  if (!parts.length) return "R";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function getInitials(nameOrEmail) {
  const text = String(nameOrEmail || "ST").trim();

  if (text.includes("@")) return text.slice(0, 2).toUpperCase();

  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function showToast(message, type = "success") {
  const toast = $("toast");
  if (!toast) return;

  toast.textContent = message;
  toast.className = `toast ${type === "error" ? "error" : ""}`;
  toast.hidden = false;

  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.hidden = true;
  }, 3000);
}

function readKeysStorageKey() {
  return `staff_moveout_read_notification_keys_${session.uid || "guest"}`;
}

function loadReadNotificationKeys() {
  try {
    const raw = localStorage.getItem(readKeysStorageKey());
    const list = raw ? JSON.parse(raw) : [];
    state.readNotificationKeys = new Set(Array.isArray(list) ? list : []);
  } catch (_) {
    state.readNotificationKeys = new Set();
  }
}

function saveReadNotificationKeys() {
  localStorage.setItem(
    readKeysStorageKey(),
    JSON.stringify(Array.from(state.readNotificationKeys))
  );
}

/* AUTH */

function setupAuth() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      const legacyStaffLogin = localStorage.getItem("loginType") === "staff";

      if (!legacyStaffLogin) {
        window.location.href = "../index.html";
        return;
      }

      session.uid = localStorage.getItem("loggedInUserUID") || localStorage.getItem("staffAccountId") || "";
      session.role = localStorage.getItem("loggedInUserRole") || localStorage.getItem("staffRole") || "Staff";
      session.name = localStorage.getItem("loggedInUserName") || localStorage.getItem("staffName") || "Staff";
      session.email = localStorage.getItem("loggedInUserEmail") || localStorage.getItem("staffEmail") || "";
      session.staffId = localStorage.getItem("loggedInStaffId") || "";
      session.propertyId = localStorage.getItem("staffPropertyId") || "";

      if (!session.uid) {
        window.location.href = "../index.html";
        return;
      }

      await initData();
      return;
    }

    session.uid = user.uid;
    session.email = (user.email || "").trim().toLowerCase();
    session.name = user.displayName || localStorage.getItem("loggedInUserName") || "Staff";
    session.role = localStorage.getItem("loggedInUserRole") || "Staff";
    session.staffId = localStorage.getItem("loggedInStaffId") || "";
    session.propertyId = localStorage.getItem("staffPropertyId") || "";

    localStorage.setItem("loginType", "staff");
    localStorage.setItem("loggedInUserUID", session.uid);
    localStorage.setItem("loggedInUserEmail", session.email);
    localStorage.setItem("loggedInUserName", session.name);

    await initData();
  });
}

async function logout() {
  try {
    if (auth.currentUser) await signOut(auth);
  } catch (_) {}

  localStorage.clear();
  window.location.href = "../index.html";
}

/* LAYOUT */

function setupLayout() {
  const staffApp = $("staffApp");
  const sidebar = $("staffSidebar");
  const overlay = $("mobileOverlay");
  const menuBtn = $("menuBtn");

  if (localStorage.getItem("staffSidebarCollapsed") === "true") {
    staffApp?.classList.add("sidebar-collapsed");
  }

  menuBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (window.innerWidth <= 920) {
      sidebar?.classList.toggle("open");
      overlay?.classList.toggle("show");
    } else {
      staffApp?.classList.toggle("sidebar-collapsed");

      localStorage.setItem(
        "staffSidebarCollapsed",
        staffApp?.classList.contains("sidebar-collapsed") ? "true" : "false"
      );
    }
  });

  overlay?.addEventListener("click", () => {
    sidebar?.classList.remove("open");
    overlay?.classList.remove("show");
  });

  $("logoutBtn")?.addEventListener("click", logout);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAllModals();
      sidebar?.classList.remove("open");
      overlay?.classList.remove("show");
    }
  });
}

/* PROFILE LOAD */

async function initData() {
  try {
    renderProfileShell();
    loadReadNotificationKeys();

    await loadUserData();
    await loadLoginRecord();
    await loadStaffRecord();
    await loadPropertyRecord();

    renderProfileShell();
    subscribeCollections();
  } catch (error) {
    console.error("Move-out init failed:", error);
    showToast(`Move-out page failed: ${error.message}`, "error");
  }
}

async function safeGetDoc(collectionName, id) {
  if (!id) return null;

  try {
    const snap = await getDoc(doc(db, collectionName, id));

    if (!snap.exists()) return null;

    return {
      id: snap.id,
      ...snap.data()
    };
  } catch (error) {
    console.warn(`${collectionName}/${id} fetch failed:`, error);
    return null;
  }
}

async function getFirstQueryDoc(collectionName, field, value) {
  if (!value) return null;

  try {
    const q = query(collection(db, collectionName), where(field, "==", value), limit(1));
    const snapshot = await getDocs(q);

    if (snapshot.empty) return null;

    return {
      id: snapshot.docs[0].id,
      ...snapshot.docs[0].data()
    };
  } catch (error) {
    console.warn(`${collectionName} query failed:`, field, error);
    return null;
  }
}

async function loadUserData() {
  state.userData = await safeGetDoc(COLLECTIONS.users, session.uid);

  if (state.userData) {
    session.name = firstText([
      state.userData.staffName,
      state.userData.name,
      state.userData.fullName,
      state.userData.displayName,
      session.name
    ], "Staff");

    session.email = firstText([state.userData.email, session.email], "");

    session.staffId = firstText([
      state.userData.staffId,
      state.userData.employeeId,
      session.staffId
    ], "");

    session.propertyId = firstText([
      state.userData.propertyId,
      state.userData.assignedPropertyId,
      state.userData.property_id,
      session.propertyId
    ], "");
  }
}

async function loadLoginRecord() {
  state.loginRecord = await safeGetDoc(COLLECTIONS.staffLoginAccounts, session.uid);

  if (!state.loginRecord) {
    const searches = [
      [COLLECTIONS.staffLoginAccounts, "uid", session.uid],
      [COLLECTIONS.staffLoginAccounts, "userId", session.uid],
      [COLLECTIONS.staffLoginAccounts, "email", session.email],
      [COLLECTIONS.staffLoginAccounts, "username", session.email],
      [COLLECTIONS.staffLoginAccounts, "staffEmail", session.email],
      [COLLECTIONS.staffLoginAccounts, "staffId", session.staffId]
    ];

    for (const [collectionName, field, value] of searches) {
      const record = await getFirstQueryDoc(collectionName, field, value);
      if (record) {
        state.loginRecord = record;
        break;
      }
    }
  }

  if (state.loginRecord) {
    session.name = firstText([
      state.loginRecord.staffName,
      state.loginRecord.name,
      state.loginRecord.fullName,
      session.name
    ], "Staff");

    session.staffId = firstText([
      state.loginRecord.staffId,
      state.loginRecord.employeeId,
      session.staffId
    ], "");

    session.propertyId = firstText([
      state.loginRecord.propertyId,
      state.loginRecord.property_id,
      session.propertyId
    ], "");
  }
}

async function loadStaffRecord() {
  const linkedEmployeeId = firstText([
    state.loginRecord?.employeeId,
    state.loginRecord?.employeeUid,
    state.userData?.employeeId,
    state.userData?.employeeUid
  ], "");

  state.staffRecord =
    await safeGetDoc(COLLECTIONS.staff, linkedEmployeeId) ||
    await safeGetDoc(COLLECTIONS.staff, session.uid);

  if (!state.staffRecord) {
    const searches = [
      [COLLECTIONS.staff, "uid", session.uid],
      [COLLECTIONS.staff, "userId", session.uid],
      [COLLECTIONS.staff, "email", session.email],
      [COLLECTIONS.staff, "staffEmail", session.email],
      [COLLECTIONS.staff, "staffId", session.staffId]
    ];

    for (const [collectionName, field, value] of searches) {
      const record = await getFirstQueryDoc(collectionName, field, value);
      if (record) {
        state.staffRecord = record;
        break;
      }
    }
  }

  if (state.staffRecord) {
    session.name = getStaffName();
    session.staffId = getStaffId();
    session.propertyId = getPropertyId();
  }
}

async function loadPropertyRecord() {
  const propertyId = getPropertyId();
  const propertyName = firstText([
    state.loginRecord?.propertyName,
    state.loginRecord?.property,
    state.staffRecord?.propertyName,
    state.staffRecord?.property,
    state.userData?.propertyName,
    state.userData?.property
  ], "");

  state.propertyRecord =
    await safeGetDoc(COLLECTIONS.properties, propertyId) ||
    await getFirstQueryDoc(COLLECTIONS.properties, "propertyId", propertyId) ||
    await getFirstQueryDoc(COLLECTIONS.properties, "propertyCode", propertyId) ||
    await getFirstQueryDoc(COLLECTIONS.properties, "propertyName", propertyName) ||
    await getFirstQueryDoc(COLLECTIONS.properties, "name", propertyName);
}

function getStaffName() {
  return firstText([
    state.staffRecord?.staffName,
    state.staffRecord?.name,
    state.staffRecord?.fullName,
    state.staffRecord?.employeeName,
    state.loginRecord?.staffName,
    state.loginRecord?.name,
    state.loginRecord?.fullName,
    state.userData?.staffName,
    state.userData?.name,
    state.userData?.fullName,
    session.name
  ], "Staff");
}

function getStaffId() {
  return firstText([
    state.staffRecord?.staffId,
    state.staffRecord?.employeeId,
    state.staffRecord?.staffCode,
    state.loginRecord?.staffId,
    state.loginRecord?.employeeId,
    state.userData?.staffId,
    session.staffId,
    session.uid
  ], session.uid);
}

function getPropertyId() {
  return firstText([
    state.staffRecord?.propertyId,
    state.staffRecord?.assignedPropertyId,
    state.staffRecord?.propertyDocId,
    state.staffRecord?.property_id,
    state.loginRecord?.propertyId,
    state.loginRecord?.assignedPropertyId,
    state.loginRecord?.property_id,
    state.userData?.propertyId,
    state.userData?.assignedPropertyId,
    state.userData?.property_id,
    session.propertyId
  ], "");
}

function getPropertyNameFromSession() {
  return firstText([
    state.propertyRecord?.propertyName,
    state.propertyRecord?.name,
    state.propertyRecord?.title,
    state.loginRecord?.propertyName,
    state.loginRecord?.property,
    state.staffRecord?.propertyName,
    state.staffRecord?.property,
    state.userData?.propertyName,
    state.userData?.property
  ], "");
}

function renderProfileShell() {
  const staffName = getStaffName();
  const email = session.email || "staff@email.com";
  const propertyName = getPropertyNameFromSession();

  setText("staffNameTop", staffName);
  setText("staffEmailTop", email);
  setText("staffAvatarText", getInitials(staffName || email));
  setText("topPropertyText", propertyName || "Manage and complete the move-out process for residents.");
}

/* RECORD BUILDING */

function fieldDate(data, keys) {
  for (const key of keys) {
    const date = toDate(data?.[key]);
    if (date) return date;
  }

  return null;
}

function propertyNameById(propertyId) {
  const key = String(propertyId || "");
  if (!key) return "";

  const property = state.properties.find((item) => {
    return (
      String(item.id || "") === key ||
      String(item.propertyId || "") === key ||
      String(item.propertyCode || "") === key
    );
  });

  return firstText([property?.propertyName, property?.name, property?.title], "");
}

function makeRecord(raw, sourceCollection) {
  const moveOutDate = fieldDate(raw, [
    "moveOutDate",
    "moveoutDate",
    "scheduledMoveOutDate",
    "vacatingDate",
    "checkoutDate",
    "checkOutDate",
    "leaseEndDate",
    "endDate"
  ]);

  const leaseStartDate = fieldDate(raw, [
    "leaseStartDate",
    "agreementStartDate",
    "startDate",
    "checkInDate",
    "moveInDate"
  ]);

  const leaseEndDate = fieldDate(raw, [
    "leaseEndDate",
    "agreementEndDate",
    "endDate",
    "checkoutDate",
    "checkOutDate"
  ]);

  const propertyId = firstText([raw.propertyId, raw.property_id], "");
  const propertyName = firstText([
    raw.propertyName,
    raw.property,
    propertyNameById(propertyId)
  ], "");

  return {
    ...raw,
    id: raw.id,
    sourceCollection,
    settlementId: firstText([raw.settlementId, raw.moveOutSettlementId], ""),
    residentId: firstText([
      raw.residentId,
      raw.userId,
      sourceCollection === COLLECTIONS.residents ? raw.id : ""
    ], ""),
    bookingId: firstText([
      raw.bookingId,
      sourceCollection === COLLECTIONS.bookings ? raw.id : ""
    ], ""),
    bedId: firstText([raw.bedId, raw.bed_id], ""),
    assignedStaffId: firstText([
      raw.assignedStaffId,
      raw.staffId,
      raw.settlementStaffId
    ], ""),
    residentName: firstText([
      raw.residentName,
      raw.name,
      raw.fullName,
      raw.guestName,
      raw.customerName
    ], "Resident"),
    phone: firstText([raw.phone, raw.phoneNumber, raw.mobile], ""),
    roomNo: firstText([raw.roomNo, raw.roomNumber, raw.unit], ""),
    bedNo: firstText([raw.bedNo, raw.bedNumber], ""),
    propertyId,
    propertyName,
    status: firstText([
      raw.settlementStatus,
      raw.moveOutStatus,
      raw.checkoutStatus,
      raw.status,
      raw.bookingStatus,
      raw.stayStatus
    ], "Pending Review"),
    moveOutDate,
    leaseStartDate,
    leaseEndDate,
    createdAt: fieldDate(raw, ["createdAt", "requestedAt"]),
    generalRemarks: firstText([
      raw.generalRemarks,
      raw.remarks,
      raw.settlementRemarks
    ], ""),
    checklist: parseChecklist(raw)
  };
}

function parseChecklist(raw) {
  const value = raw?.checklist || raw?.moveOutChecklist;
  const result = {};

  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (!item || typeof item !== "object") return;

      const title = firstText([item.title, item.item, item.name], "");
      if (!title) return;

      result[title] = {
        title,
        status: firstText([item.status], "Good"),
        remarks: firstText([item.remarks, item.note], "")
      };
    });
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    Object.entries(value).forEach(([key, item]) => {
      const title = String(key || "").trim();
      if (!title) return;

      if (item && typeof item === "object") {
        result[title] = {
          title,
          status: firstText([item.status], "Good"),
          remarks: firstText([item.remarks, item.note], "")
        };
      } else {
        result[title] = {
          title,
          status: firstText([item], "Good"),
          remarks: ""
        };
      }
    });
  }

  return result;
}

function hasMoveOutSignal(record) {
  const text = [
    record.status,
    record.moveOutStatus,
    record.settlementStatus,
    record.checkoutStatus,
    record.stayStatus
  ].join(" ").toLowerCase();

  return (
    !!record.moveOutDate ||
    text.includes("move") ||
    text.includes("vacat") ||
    text.includes("checkout") ||
    text.includes("check-out") ||
    text.includes("settlement")
  );
}

function recordBelongsToStaff(record) {
  const propertyId = getPropertyId();
  const propertyName = getPropertyNameFromSession();

  if (!propertyId && !propertyName) return true;

  const propertyMatch =
    propertyId &&
    record.propertyId &&
    String(record.propertyId).trim() === String(propertyId).trim();

  const propertyNameMatch =
    propertyName &&
    record.propertyName &&
    String(record.propertyName).trim() === String(propertyName).trim();

  const assignedMatch =
    record.assignedStaffId &&
    String(record.assignedStaffId).trim() === String(session.uid).trim();

  return propertyMatch || propertyNameMatch || assignedMatch;
}

function recordKey(record) {
  return firstText([
    record.settlementId,
    record.residentId,
    record.bookingId,
    record.residentName && record.phone
      ? `${record.residentName}_${record.phone}_${record.moveOutDate ? record.moveOutDate.getTime() : 0}`
      : "",
    `${record.sourceCollection}_${record.id}`
  ], `${record.sourceCollection}_${record.id}`);
}

function allRecords() {
  const raw = [
    ...state.moveOutSettlements.map((item) => makeRecord(item, COLLECTIONS.moveOutSettlements)),
    ...state.moveOuts.map((item) => makeRecord(item, COLLECTIONS.moveOuts)),
    ...state.residents.map((item) => makeRecord(item, COLLECTIONS.residents)).filter(hasMoveOutSignal),
    ...state.bookings.map((item) => makeRecord(item, COLLECTIONS.bookings)).filter(hasMoveOutSignal)
  ].filter(recordBelongsToStaff);

  const unique = new Map();

  raw.forEach((record) => {
    const key = recordKey(record);

    if (!unique.has(key) || record.sourceCollection === COLLECTIONS.moveOutSettlements) {
      unique.set(key, record);
    }
  });

  return Array.from(unique.values()).sort((a, b) => {
    const dateA = toDate(a.moveOutDate || a.createdAt)?.getTime() || 0;
    const dateB = toDate(b.moveOutDate || b.createdAt)?.getTime() || 0;

    return dateA - dateB;
  });
}

function isCompleted(record) {
  const clean = normalize(record.status);

  return (
    clean.includes("completed") ||
    clean.includes("approved") ||
    clean.includes("settled") ||
    clean.includes("moved out")
  );
}

function isCancelled(record) {
  const clean = normalize(record.status);

  return (
    clean.includes("cancelled") ||
    clean.includes("canceled") ||
    clean.includes("rejected")
  );
}

function isPending(record) {
  return !isCompleted(record) && !isCancelled(record);
}

function isOverdue(record) {
  return isPending(record) && isPast(record.moveOutDate);
}

function statusClass(record) {
  if (isCompleted(record)) return "completed";
  if (isCancelled(record)) return "cancelled";
  if (isOverdue(record)) return "overdue";
  if (isToday(record.moveOutDate)) return "today";

  return "pending";
}

function statusLabel(record) {
  if (isCompleted(record)) return "Completed";
  if (isCancelled(record)) return "Cancelled";
  if (isOverdue(record)) return "Overdue";
  if (isToday(record.moveOutDate)) return "Move-out Today";

  const clean = String(record.status || "").trim();
  if (!clean || normalize(clean) === "active" || normalize(clean) === "current") {
    return "Pending Review";
  }

  return clean;
}

function moveOutLabel(record) {
  if (record.moveOutDate && isToday(record.moveOutDate)) return "Move-out Today";
  if (isCompleted(record)) return "Completed";
  if (isCancelled(record)) return "Cancelled";

  return "Move-out";
}

function locationLabel(record) {
  const unit = firstText([
    record.roomNo && record.bedNo ? `${record.roomNo} / ${record.bedNo}` : "",
    record.roomNo,
    record.bedNo
  ], "");

  if (!unit && !record.propertyName) return "-";
  if (!unit) return record.propertyName;
  if (!record.propertyName) return unit;

  return `${unit}, ${record.propertyName}`;
}

function visibleRecords() {
  let records = allRecords();

  if (state.activeTab === "today") {
    records = records.filter((record) => isToday(record.moveOutDate) && isPending(record));
  }

  if (state.activeTab === "pending") {
    records = records.filter(isPending);
  }

  if (state.activeTab === "completed") {
    records = records.filter(isCompleted);
  }

  if (state.activeTab === "cancelled") {
    records = records.filter(isCancelled);
  }

  return records;
}

function selectedRecord() {
  return allRecords().find((record) => recordKey(record) === state.selectedKey) || null;
}

/* RENDER */

function renderPage() {
  renderProfileShell();
  renderStats();
  renderSettlementList();
  renderNotifications();
  syncMoveOutRequestNotifications(allRecords());
}

function renderStats() {
  const records = allRecords();
  const today = records.filter((record) => isToday(record.moveOutDate) && isPending(record));
  const pending = records.filter(isPending);
  const completed = records.filter(isCompleted);
  const cancelled = records.filter(isCancelled);
  const overdue = records.filter(isOverdue);

  setText("moveoutsTodayCount", twoDigits(today.length));
  setText("pendingCount", twoDigits(pending.length));
  setText("completedCount", twoDigits(completed.length));
  setText("overdueCount", twoDigits(overdue.length));

  setText("todayTabCount", `(${today.length})`);
  setText("pendingTabCount", `(${pending.length})`);
  setText("completedTabCount", `(${completed.length})`);
  setText("cancelledTabCount", `(${cancelled.length})`);

  const disclaimer = $("disclaimerBox");
  if (disclaimer) {
    disclaimer.style.display = state.activeTab === "today" ? "flex" : "none";
  }
}

function settlementCard(record) {
  const active = recordKey(record) === state.selectedKey ? "active" : "";

  return `
    <article class="settlement-item ${active}" data-record-key="${escapeHtml(recordKey(record))}">
      <div class="avatar">${escapeHtml(initials(record.residentName))}</div>

      <div class="resident-info">
        <strong>${escapeHtml(record.residentName)}</strong>
        <span>${escapeHtml(locationLabel(record))}</span>
        <span><i class="fa-solid fa-phone"></i> ${escapeHtml(record.phone || "-")}</span>
        <span><i class="fa-regular fa-calendar"></i> ${escapeHtml(formatDateTime(record.moveOutDate))}</span>
      </div>

      <div class="item-meta">
        <div>
          <span>Lease End Date</span>
          <strong>${escapeHtml(formatDate(record.leaseEndDate))}</strong>
        </div>

        <div>
          <span>Status</span>
          <strong>
            <span class="status-badge ${statusClass(record)}">
              ${escapeHtml(statusLabel(record))}
            </span>
          </strong>
        </div>
      </div>

      <i class="fa-solid fa-chevron-right chevron"></i>
    </article>
  `;
}

function renderSettlementList() {
  const container = $("settlementList");
  if (!container) return;

  const records = visibleRecords();

  setText(
    "showingText",
    records.length
      ? `Showing 1 to ${records.length} of ${records.length} entries`
      : "Showing 0 entries"
  );

  if (!records.length) {
    container.innerHTML = `<div class="empty-box">No move-out records found.</div>`;
    state.selectedKey = "";
    renderDetails(null);
    return;
  }

  if (!state.selectedKey || !records.some((record) => recordKey(record) === state.selectedKey)) {
    state.selectedKey = recordKey(records[0]);
  }

  container.innerHTML = records.map(settlementCard).join("");
  renderDetails(selectedRecord());
}

function buildChecklist(record) {
  return defaultChecklistItems.map((title) => {
    const saved = record?.checklist?.[title] || record?.checklist?.[keyFromTitle(title)] || null;

    return {
      title,
      status: firstText([saved?.status], "Good"),
      remarks: firstText([saved?.remarks], "")
    };
  });
}

function keyFromTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function renderChecklistRows(disabled) {
  return state.checklistState.map((item, index) => {
    const status = String(item.status || "Good");

    return `
      <div class="check-row" data-check-index="${index}">
        <div class="check-label">${index + 1}. ${escapeHtml(item.title)}</div>

        <div class="check-buttons">
          <button type="button" class="good ${status === "Good" ? "active" : ""}" data-check-status="Good" ${disabled ? "disabled" : ""}>
            Good
          </button>

          <button type="button" class="damaged ${status === "Damaged" ? "active" : ""}" data-check-status="Damaged" ${disabled ? "disabled" : ""}>
            Damaged
          </button>

          <button type="button" class="missing ${status === "Missing" ? "active" : ""}" data-check-status="Missing" ${disabled ? "disabled" : ""}>
            Missing
          </button>
        </div>

        <div class="check-remarks">
          <input
            type="text"
            value="${escapeHtml(item.remarks)}"
            placeholder="Enter remarks"
            data-check-remarks="${index}"
            ${disabled ? "disabled" : ""}
          />
        </div>
      </div>
    `;
  }).join("");
}

function renderDetails(record) {
  const container = $("settlementDetailsContent");
  if (!container) return;

  if (!record) {
    container.innerHTML = `<div class="empty-box details-empty">Select a resident to view settlement details.</div>`;
    return;
  }

  const disabled = isCompleted(record) || isCancelled(record);

  state.checklistState = buildChecklist(record);
  state.generalRemarks = record.generalRemarks || "";

  container.innerHTML = `
    <div class="details-head-row">
      <div class="details-profile">
        <div class="avatar">${escapeHtml(initials(record.residentName))}</div>

        <div>
          <h2>${escapeHtml(record.residentName)}</h2>
          <span>${escapeHtml(locationLabel(record))}</span>
          <span><i class="fa-solid fa-phone"></i> ${escapeHtml(record.phone || "-")}</span>

          <div class="moveout-badge">
            <span class="status-badge ${statusClass(record)}">
              ${escapeHtml(moveOutLabel(record))}
            </span>
          </div>
        </div>
      </div>

      <div class="details-dates">
        <div class="date-mini">
          <span>Lease Start Date</span>
          <strong>${escapeHtml(formatDate(record.leaseStartDate))}</strong>
        </div>

        <div class="date-mini">
          <span>Lease End Date</span>
          <strong>${escapeHtml(formatDate(record.leaseEndDate))}</strong>
        </div>
      </div>
    </div>

    <h3 class="checklist-title">Move-out Checklist</h3>

    <div class="checklist-header">
      <span>Item to Check</span>
      <span>Status</span>
      <span>Remarks</span>
    </div>

    <div class="checklist">
      ${renderChecklistRows(disabled)}
    </div>

    <div class="general-remarks">
      <label for="generalRemarks">General Remarks (Optional)</label>

      <textarea
        id="generalRemarks"
        maxlength="250"
        placeholder="Add any general remarks about the move-out..."
        ${disabled ? "disabled" : ""}
      >${escapeHtml(state.generalRemarks)}</textarea>

      <div class="remarks-count">
        <span id="remarksCount">${String(state.generalRemarks).length}</span>/250
      </div>
    </div>

    <div class="important-notes">
      <strong>Important Notes</strong>
      <ul>
        <li>Please ensure all outstanding dues are cleared.</li>
        <li>Verify keys, access cards, and any other issued items are returned.</li>
        <li>Once approved, the resident will be moved out and the bed will be marked available.</li>
      </ul>
    </div>

    <div class="action-row">
      <button type="button" class="cancel-btn" id="cancelSettlementBtn" ${disabled ? "disabled" : ""}>
        Cancel
      </button>

      <button type="button" class="approve-btn" id="approveSettlementBtn" ${disabled ? "disabled" : ""}>
        <i class="fa-regular fa-circle-check"></i>
        ${disabled ? "Settlement Closed" : "Approve Move-out Settlement"}
      </button>
    </div>
  `;

  setupDetailsEvents(disabled);
}

function setupDetailsEvents(disabled) {
  if (disabled) return;

  document.querySelectorAll("[data-check-status]").forEach((button) => {
    button.addEventListener("click", () => {
      const row = button.closest("[data-check-index]");
      const index = Number(row?.dataset.checkIndex);

      if (!Number.isFinite(index) || !state.checklistState[index]) return;

      state.checklistState[index].status = button.dataset.checkStatus || "Good";

      row.querySelectorAll("[data-check-status]").forEach((item) => {
        item.classList.remove("active");
      });

      button.classList.add("active");
    });
  });

  document.querySelectorAll("[data-check-remarks]").forEach((input) => {
    input.addEventListener("input", () => {
      const index = Number(input.dataset.checkRemarks);

      if (Number.isFinite(index) && state.checklistState[index]) {
        state.checklistState[index].remarks = input.value.trim();
      }
    });
  });

  $("generalRemarks")?.addEventListener("input", (event) => {
    state.generalRemarks = event.target.value || "";
    setText("remarksCount", String(state.generalRemarks.length));
  });

  $("cancelSettlementBtn")?.addEventListener("click", () => {
    renderDetails(selectedRecord());
  });

  $("approveSettlementBtn")?.addEventListener("click", approveSettlement);
}

/* APPROVAL */

async function approveSettlement() {
  const record = selectedRecord();

  if (!record || state.loading) {
    showToast("Please select a settlement record.", "error");
    return;
  }

  const hasIssue = state.checklistState.some((item) => {
    return item.status === "Damaged" || item.status === "Missing";
  });

  if (hasIssue) {
    const allowed = confirm(
      "Some items are marked as Damaged or Missing. Do you still want to approve this move-out settlement?"
    );

    if (!allowed) return;
  }

  const button = $("approveSettlementBtn");
  state.loading = true;

  if (button) {
    button.disabled = true;
    button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Approving...`;
  }

  try {
    const settlementId = record.settlementId || record.id;
    const now = serverTimestamp();
    const checklistData = state.checklistState.map((item) => ({
      title: item.title,
      status: item.status || "Good",
      remarks: item.remarks || ""
    }));

    const batch = writeBatch(db);

    batch.set(
      doc(db, COLLECTIONS.moveOutSettlements, settlementId),
      {
        residentId: record.residentId,
        residentName: record.residentName,
        phone: record.phone,
        roomNo: record.roomNo,
        bedNo: record.bedNo,
        bedId: record.bedId,
        bookingId: record.bookingId,
        propertyId: record.propertyId,
        propertyName: record.propertyName,
        leaseStartDate: record.leaseStartDate || null,
        leaseEndDate: record.leaseEndDate || null,
        moveOutDate: record.moveOutDate || null,
        status: "Completed",
        settlementStatus: "Completed",
        moveOutStatus: "Completed",
        checklist: checklistData,
        generalRemarks: state.generalRemarks || "",
        approvedByStaffId: session.uid,
        approvedByStaffEmail: session.email,
        approvedAt: now,
        completedAt: now,
        updatedAt: now,
        createdAt: record.createdAt || now
      },
      { merge: true }
    );

    if (record.sourceCollection && record.sourceCollection !== COLLECTIONS.moveOutSettlements) {
      batch.set(
        doc(db, record.sourceCollection, record.id),
        {
          status: record.sourceCollection === COLLECTIONS.residents ? "Moved Out" : "Completed",
          moveOutStatus: "Completed",
          settlementStatus: "Completed",
          moveOutCompleted: true,
          checkedOutAt: now,
          updatedAt: now
        },
        { merge: true }
      );
    }

    if (record.residentId) {
      batch.set(
        doc(db, COLLECTIONS.residents, record.residentId),
        {
          status: "Moved Out",
          stayStatus: "Moved Out",
          isActive: false,
          moveOutCompleted: true,
          moveOutDate: record.moveOutDate || null,
          updatedAt: now
        },
        { merge: true }
      );
    }

    if (record.bookingId) {
      batch.set(
        doc(db, COLLECTIONS.bookings, record.bookingId),
        {
          status: "Completed",
          bookingStatus: "Completed",
          checkoutStatus: "Completed",
          moveOutCompleted: true,
          checkedOutAt: now,
          updatedAt: now
        },
        { merge: true }
      );
    }

    if (record.bedId) {
      batch.set(
        doc(db, COLLECTIONS.beds, record.bedId),
        {
          status: "Available",
          bedStatus: "Available",
          isOccupied: false,
          residentId: "",
          residentName: "",
          bookingId: "",
          updatedAt: now
        },
        { merge: true }
      );
    }

    const eventPayload = moveOutEventPayload({
      action: "move_out_settlement_approved",
      title: "Move-out Settlement Completed",
      message: `${record.residentName} move-out settlement approved by staff.`,
      settlementId,
      sourceCollection: record.sourceCollection,
      sourceId: record.id,
      residentId: record.residentId,
      residentName: record.residentName,
      bookingId: record.bookingId,
      bedId: record.bedId,
      propertyId: record.propertyId,
      propertyName: record.propertyName,
      status: "Completed"
    });

    batch.set(doc(collection(db, COLLECTIONS.notifications)), eventPayload);
    batch.set(doc(collection(db, COLLECTIONS.activityLogs)), {
      ...eventPayload,
      read: true,
      isRead: true,
      logType: "move_out_activity"
    });

    await batch.commit();

    showToast("Move-out settlement approved successfully.");
  } catch (error) {
    console.error("Approval failed:", error);
    showToast(`Approval failed: ${error.message}`, "error");

    if (button) {
      button.disabled = false;
      button.innerHTML = `<i class="fa-regular fa-circle-check"></i> Approve Move-out Settlement`;
    }
  } finally {
    state.loading = false;
  }
}

function moveOutEventPayload({
  action,
  title,
  message,
  settlementId = "",
  sourceCollection = "",
  sourceId = "",
  residentId = "",
  residentName = "",
  bookingId = "",
  bedId = "",
  propertyId = "",
  propertyName = "",
  status = ""
}) {
  const now = serverTimestamp();

  return {
    module: "move_out_settlement",
    type: "move_out_action",
    action,
    title,
    message,
    settlementId,
    sourceCollection,
    sourceId,
    residentId,
    residentName,
    bookingId,
    bedId,
    propertyId,
    propertyName,
    status,
    target: "staff_admin",
    targetRole: "staff",
    visibleToStaff: true,
    visibleToAdmin: true,
    read: false,
    isRead: false,
    createdById: session.uid,
    createdByEmail: session.email,
    createdAt: now,
    updatedAt: now
  };
}

/* NOTIFICATION SYNC */

function safeNotificationDocId(value) {
  const safe = String(value || "").replace(/[^A-Za-z0-9_-]/g, "_");
  return safe.length <= 140 ? safe : safe.slice(0, 140);
}

async function syncMoveOutRequestNotifications(records) {
  const pending = records.filter((record) => isPending(record)).slice(0, 40);

  for (const record of pending) {
    const notificationId = safeNotificationDocId(
      `moveout_request_${record.sourceCollection}_${record.id}`
    );

    if (state.syncedNotificationIds.has(notificationId)) continue;

    state.syncedNotificationIds.add(notificationId);

    try {
      const ref = doc(db, COLLECTIONS.notifications, notificationId);
      const existing = await getDoc(ref);

      if (existing.exists()) continue;

      await setDoc(ref, {
        module: "move_out_settlement",
        type: "move_out_action",
        action: "move_out_request_raised",
        title: "Move-out Request Raised",
        message: `${record.residentName} has a pending move-out settlement.`,
        settlementId: record.settlementId,
        sourceCollection: record.sourceCollection,
        sourceId: record.id,
        residentId: record.residentId,
        residentName: record.residentName,
        bookingId: record.bookingId,
        bedId: record.bedId,
        propertyId: record.propertyId,
        propertyName: record.propertyName,
        status: statusLabel(record),
        target: "staff_admin",
        targetRole: "staff",
        visibleToStaff: true,
        visibleToAdmin: true,
        read: false,
        isRead: false,
        createdById: session.uid,
        createdByName: getStaffName(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (_) {}
  }
}

/* NOTIFICATIONS */

function isMoveOutNotification(item) {
  const module = normalize(item.module);
  const type = normalize(item.type || item.notificationType);
  const text = [
    item.action,
    item.event,
    item.title,
    item.subject,
    item.message,
    item.description,
    item.body,
    item.details,
    item.status,
    item.settlementStatus,
    item.moveOutStatus
  ].join(" ").toLowerCase();

  return (
    module === "move_out_settlement" ||
    module === "move_out" ||
    module === "moveout" ||
    type === "move_out_action" ||
    text.includes("move-out") ||
    text.includes("move out") ||
    text.includes("checkout") ||
    text.includes("check-out") ||
    text.includes("settlement") ||
    text.includes("vacat")
  );
}

function moveOutTitleFromAction(action) {
  const clean = normalize(action);

  if (clean.includes("request")) return "Move-out Request Raised";
  if (clean.includes("approved") || clean.includes("completed")) return "Move-out Settlement Completed";
  if (clean.includes("cancel")) return "Move-out Cancelled";
  if (clean.includes("bed") || clean.includes("room")) return "Room Updated";

  return "Move-out Activity";
}

function notificationIcon(action) {
  const clean = normalize(action);

  if (clean.includes("request")) return "fa-regular fa-file-lines";
  if (clean.includes("approved") || clean.includes("completed")) return "fa-regular fa-circle-check";
  if (clean.includes("cancel")) return "fa-regular fa-circle-xmark";
  if (clean.includes("bed") || clean.includes("room")) return "fa-solid fa-bed";

  return "fa-regular fa-bell";
}

function notificationColor(action) {
  const clean = normalize(action);

  if (clean.includes("request")) return COLORS.purple;
  if (clean.includes("approved") || clean.includes("completed")) return COLORS.green;
  if (clean.includes("cancel")) return COLORS.red;
  if (clean.includes("bed") || clean.includes("room")) return COLORS.gold;

  return COLORS.navy;
}

function rawNotifications() {
  const records = [
    ...state.notifications.map((item) => ({ ...item, collection: COLLECTIONS.notifications })),
    ...state.activityLogs.map((item) => ({ ...item, collection: COLLECTIONS.activityLogs }))
  ];

  return records
    .filter(isMoveOutNotification)
    .map((item) => {
      const action = firstText([item.action, item.event, item.type], "move_out_activity");
      const createdAt = toDate(item.createdAt || item.updatedAt || item.time) || new Date();

      return {
        readKey: `move_out_notification_${item.collection}_${item.id}`,
        title: firstText([item.title, item.subject], moveOutTitleFromAction(action)),
        message: firstText([
          item.message,
          item.description,
          item.body,
          item.details,
          item.residentName,
          item.propertyName
        ], "Move-out settlement activity updated."),
        residentName: firstText([item.residentName, item.name], ""),
        status: firstText([item.status, item.settlementStatus, item.moveOutStatus], ""),
        action,
        createdAt,
        read: item.read === true || item.isRead === true
      };
    })
    .sort((a, b) => {
      return (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0);
    })
    .slice(0, 80);
}

function visibleNotifications() {
  return rawNotifications().filter((item) => {
    return !item.read && !state.readNotificationKeys.has(item.readKey);
  });
}

function renderNotifications() {
  const notifications = visibleNotifications();

  setText("notificationCount", notifications.length > 99 ? "99+" : notifications.length);

  const list = $("notificationList");
  if (!list) return;

  if (!notifications.length) {
    list.innerHTML = `<div class="empty-box">No unread move-out notifications.</div>`;
    return;
  }

  list.innerHTML = notifications.slice(0, 40).map((item) => {
    const color = notificationColor(item.action);

    return `
      <div class="notification-item">
        <div class="notification-item-icon" style="color:${color};background:${color}18;">
          <i class="${escapeHtml(notificationIcon(item.action))}"></i>
        </div>

        <div>
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.message)}</p>
          ${item.residentName ? `<p>Resident: ${escapeHtml(item.residentName)}</p>` : ""}
          ${item.status ? `<p>Status: ${escapeHtml(item.status)}</p>` : ""}
          <small>${escapeHtml(timeAgo(item.createdAt))}</small>
        </div>
      </div>
    `;
  }).join("");
}

function markNotificationsRead() {
  visibleNotifications().forEach((item) => {
    if (item.readKey) {
      state.readNotificationKeys.add(item.readKey);
    }
  });

  saveReadNotificationKeys();
  renderNotifications();
  showToast("Notifications marked as read.");
}

/* SUBSCRIPTIONS */

let subscriptionsStarted = false;

function subscribeCollection(stateKey, collectionName) {
  onSnapshot(
    collection(db, collectionName),
    (snapshot) => {
      state[stateKey] = snapshot.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data()
      }));

      renderPage();
    },
    (error) => {
      console.error(`${collectionName} fetch failed:`, error);
      state[stateKey] = [];
      renderPage();
      showToast(`${collectionName} fetch failed. Check Firestore rules.`, "error");
    }
  );
}

function subscribeCollections() {
  if (subscriptionsStarted) return;
  subscriptionsStarted = true;

  subscribeCollection("moveOutSettlements", COLLECTIONS.moveOutSettlements);
  subscribeCollection("moveOuts", COLLECTIONS.moveOuts);
  subscribeCollection("residents", COLLECTIONS.residents);
  subscribeCollection("bookings", COLLECTIONS.bookings);
  subscribeCollection("properties", COLLECTIONS.properties);
  subscribeCollection("notifications", COLLECTIONS.notifications);
  subscribeCollection("activityLogs", COLLECTIONS.activityLogs);
}

/* CLOCK */

function setupClock() {
  function updateDateTime() {
    const now = new Date();

    setText("todayDate", now.toLocaleDateString("en-IN", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric"
    }));

    setText("currentTime", now.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    }));
  }

  updateDateTime();
  setInterval(updateDateTime, 1000);
}

/* MODALS */

function openModal(id) {
  const modal = $(id);
  if (!modal) return;

  modal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeModal(id) {
  const modal = $(id);
  if (!modal) return;

  modal.hidden = true;

  if (!document.querySelector(".modal-overlay:not([hidden])")) {
    document.body.style.overflow = "";
  }
}

function closeAllModals() {
  document.querySelectorAll(".modal-overlay").forEach((modal) => {
    modal.hidden = true;
  });

  document.body.style.overflow = "";
}

/* EVENTS */

function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((item) => {
        item.classList.remove("active");
      });

      button.classList.add("active");
      state.activeTab = button.dataset.tab || "today";
      state.selectedKey = "";
      renderPage();
    });
  });
}

function setupEvents() {
  setupTabs();

  $("notificationBtn")?.addEventListener("click", () => {
    renderNotifications();
    openModal("notificationModal");
  });

  $("markNotificationsReadBtn")?.addEventListener("click", markNotificationsRead);

  document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", () => closeModal(button.dataset.closeModal));
  });

  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        closeModal(overlay.id);
      }
    });
  });

  document.addEventListener("click", (event) => {
    const card = event.target.closest(".settlement-item");
    if (!card) return;

    state.selectedKey = card.dataset.recordKey || "";
    renderSettlementList();
  });
}

/* INIT */

document.addEventListener("DOMContentLoaded", () => {
  setupClock();
  setupLayout();
  setupEvents();
  setupAuth();
});