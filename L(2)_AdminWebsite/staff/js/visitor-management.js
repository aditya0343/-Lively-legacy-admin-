import { auth, db } from "./firebase-config.js";

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
  residents: "residents",
  visitors: "visitors",
  visitorRequests: "visitor_requests",
  notifications: "notifications",
  activityLogs: "activity_logs",
  announcements: "announcements"
};

const COLORS = [
  "#2563eb",
  "#22a55a",
  "#f97316",
  "#7c3aed",
  "#ef4444",
  "#d09112"
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
  activeTab: "pending",
  userData: null,
  staffRecord: null,
  loginRecord: null,
  propertyRecord: null,
  visitorRequests: [],
  visitors: [],
  residents: [],
  notifications: [],
  activityLogs: [],
  announcements: [],
  readNotificationKeys: new Set(),
  scannerStream: null,
  scannerTimer: null,
  loading: false
};

const normalize = (value) => String(value || "").trim().toLowerCase();

const setText = (id, value) => {
  const element = $(id);
  if (element) element.textContent = value;
};

const escapeHtml = (text) => String(text ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

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

function isSameDay(a, b) {
  if (!a || !b) return false;

  return (
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear()
  );
}

function isToday(value) {
  const date = toDate(value);
  if (!date) return false;
  return isSameDay(date, new Date());
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

  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
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
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;

  return formatDateTime(date);
}

function compactDayLabel(date, today) {
  if (isSameDay(date, today)) return "Today";

  return date.toLocaleDateString("en-IN", {
    weekday: "short"
  });
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
  return `visitor_read_notification_keys_${session.uid || "guest"}`;
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
    if (auth.currentUser) {
      await signOut(auth);
    }
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

/* DATA LOAD */

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
    console.error("Visitor page init failed:", error);
    showToast(`Visitor page failed: ${error.message}`, "error");
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

    session.email = firstText([
      state.userData.email,
      session.email
    ], "");

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

/* PROFILE */

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

function getPropertyName() {
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
  ], "Assigned Property");
}

function renderProfileShell() {
  const staffName = getStaffName();
  const email = session.email || "staff@email.com";
  const initials = getInitials(staffName || email);

  setText("staffNameTop", staffName);
  setText("staffEmailTop", email);
  setText("staffAvatarText", initials);
  setText("topPropertyText", getPropertyName() || "Staff panel");
}

/* VISITOR HELPERS */

function allVisitorRecords() {
  return [
    ...state.visitorRequests.map((item) => ({ ...item, collection: COLLECTIONS.visitorRequests })),
    ...state.visitors.map((item) => ({ ...item, collection: COLLECTIONS.visitors }))
  ]
    .filter(belongsToStaffProperty)
    .sort((a, b) => {
      const dateA = toDate(a.createdAt || a.requestedAt || a.visitDate || a.checkInAt)?.getTime() || 0;
      const dateB = toDate(b.createdAt || b.requestedAt || b.visitDate || b.checkInAt)?.getTime() || 0;
      return dateB - dateA;
    });
}

function getResidentById(id) {
  const key = String(id || "");

  return state.residents.find((resident) => {
    return (
      String(resident.id || "") === key ||
      String(resident.residentId || "") === key ||
      String(resident.userId || "") === key ||
      String(resident.uid || "") === key
    );
  });
}

function getResidentName(visitor) {
  const resident = getResidentById(
    visitor.residentId ||
    visitor.residentDocId ||
    visitor.visitingResidentId ||
    visitor.hostId
  );

  return firstText([
    visitor.residentName,
    visitor.requestedBy,
    visitor.visiting,
    visitor.visitingName,
    visitor.hostName,
    visitor.visitingResidentName,
    resident?.name,
    resident?.fullName,
    resident?.residentName
  ], "-");
}

function getResidentRoom(visitor) {
  const resident = getResidentById(
    visitor.residentId ||
    visitor.residentDocId ||
    visitor.visitingResidentId ||
    visitor.hostId
  );

  const room = firstText([
    visitor.roomNo,
    visitor.roomNumber,
    visitor.room,
    visitor.unit,
    visitor.bedNo,
    visitor.bedNumber,
    resident?.roomNo,
    resident?.roomNumber,
    resident?.room,
    resident?.bedNo,
    resident?.bedNumber
  ], "");

  return room ? `(${room})` : "";
}

function getVisitorName(visitor) {
  return firstText([
    visitor.visitorName,
    visitor.guestName,
    visitor.name,
    visitor.fullName
  ], "Visitor");
}

function getVisitorPhone(visitor) {
  return firstText([
    visitor.phone,
    visitor.phoneNumber,
    visitor.mobile,
    visitor.contactNumber,
    visitor.visitorPhone
  ], "-");
}

function getVisitorPurpose(visitor) {
  return firstText([
    visitor.purpose,
    visitor.visitPurpose,
    visitor.reason
  ], "Visit");
}

function getVisitorCode(visitor) {
  return firstText([
    visitor.visitorCode,
    visitor.checkInCode,
    visitor.qrCode,
    visitor.code,
    visitor.visitorId,
    visitor.requestNo,
    visitor.requestId,
    visitor.id
  ], "");
}

function getVisitDateValue(visitor) {
  return (
    visitor.visitDate ||
    visitor.visitTime ||
    visitor.requestedAt ||
    visitor.createdAt ||
    visitor.checkInAt
  );
}

function getVisitDate(visitor) {
  return formatDate(getVisitDateValue(visitor));
}

function getVisitTime(visitor) {
  const start = firstText([
    visitor.startTime,
    visitor.fromTime,
    visitor.visitStartTime,
    visitor.timeFrom,
    visitor.visitTimeLabel,
    visitor.time,
    formatTime(visitor.checkInAt),
    formatTime(visitor.createdAt)
  ], "");

  const end = firstText([
    visitor.endTime,
    visitor.toTime,
    visitor.visitEndTime,
    visitor.timeTo,
    visitor.checkoutTime,
    formatTime(visitor.checkOutAt),
    formatTime(visitor.checkedOutAt)
  ], "");

  if (start && end && start !== "-") return `${start} - ${end}`;
  return start || "-";
}

function getStatusRaw(visitor) {
  return firstText([
    visitor.status,
    visitor.visitorStatus,
    visitor.approvalStatus
  ], "Pending Approval");
}

function getStatus(visitor) {
  return normalize(getStatusRaw(visitor));
}

function isPending(visitor) {
  const status = getStatus(visitor);

  return (
    !status ||
    status.includes("pending") ||
    status.includes("requested") ||
    status.includes("approval")
  );
}

function isApproved(visitor) {
  const status = getStatus(visitor);
  return status.includes("approved");
}

function isCheckedIn(visitor) {
  const status = getStatus(visitor);

  return (
    status.includes("checked in") ||
    status.includes("checked-in") ||
    status.includes("check in") ||
    status.includes("check-in")
  );
}

function isCheckedOut(visitor) {
  const status = getStatus(visitor);

  return (
    status.includes("checked out") ||
    status.includes("checked-out") ||
    status.includes("check out") ||
    status.includes("check-out")
  );
}

function isDeclined(visitor) {
  const status = getStatus(visitor);

  return (
    status.includes("declined") ||
    status.includes("rejected") ||
    status.includes("cancelled")
  );
}

function statusClass(visitor) {
  if (isDeclined(visitor)) return "declined";
  if (isCheckedOut(visitor)) return "checked-out";
  if (isCheckedIn(visitor)) return "checked-in";
  if (isApproved(visitor)) return "approved";
  return "pending";
}

function statusLabel(visitor) {
  if (isDeclined(visitor)) return "Declined";
  if (isCheckedOut(visitor)) return "Checked Out";
  if (isCheckedIn(visitor)) return "Checked In";
  if (isApproved(visitor)) return "Approved";
  return "Pending";
}

function belongsToStaffProperty(visitor) {
  const propertyId = getPropertyId();
  const propertyName = getPropertyName();

  if (!propertyId && !propertyName) return true;

  const itemPropertyId = firstText([
    visitor.propertyId,
    visitor.property_id,
    visitor.propertyDocId,
    visitor.assignedPropertyId
  ], "");

  const itemPropertyName = firstText([
    visitor.propertyName,
    visitor.property
  ], "");

  return (
    !itemPropertyId && !itemPropertyName ||
    (propertyId && itemPropertyId === propertyId) ||
    (propertyName && itemPropertyName === propertyName)
  );
}

function getTodayVisitors() {
  return allVisitorRecords().filter((visitor) => {
    return (
      isToday(visitor.visitDate) ||
      isToday(visitor.visitTime) ||
      isToday(visitor.requestedAt) ||
      isToday(visitor.createdAt) ||
      isToday(visitor.checkInAt) ||
      isToday(visitor.checkedInAt)
    );
  });
}

function getFilteredVisitors() {
  const visitors = allVisitorRecords();

  if (state.activeTab === "pending") {
    return visitors.filter(isPending);
  }

  if (state.activeTab === "checkedIn") {
    return visitors.filter(isCheckedIn);
  }

  if (state.activeTab === "checkedOut") {
    return visitors.filter(isCheckedOut);
  }

  return visitors;
}

function cleanLabel(value, fallback = "Other") {
  const text = String(value || "").trim();

  if (!text) return fallback;

  return text
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function countLabels(values) {
  const counts = {};

  values.forEach((value) => {
    const label = cleanLabel(value);
    counts[label] = (counts[label] || 0) + 1;
  });

  return counts;
}

function visitorTrendIndex(date, now) {
  if (!date) return -1;

  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - 6);

  const clean = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.round((clean - start) / 86400000);

  return diff >= 0 && diff <= 6 ? diff : -1;
}

/* RENDER */

function renderPage() {
  renderProfileShell();
  renderStats();
  renderCharts();
  renderVisitors();
  renderRecentCheckedIn();
  renderNotifications();
}

function renderStats() {
  const visitors = allVisitorRecords();
  const todayVisitors = getTodayVisitors();
  const pending = visitors.filter(isPending);
  const checkedIn = visitors.filter(isCheckedIn);
  const checkedOut = visitors.filter(isCheckedOut);

  setText("todayVisitorsCount", String(todayVisitors.length).padStart(2, "0"));
  setText("checkedInCount", String(checkedIn.length).padStart(2, "0"));
  setText("checkedOutCount", String(checkedOut.length).padStart(2, "0"));
  setText("pendingCount", String(pending.length).padStart(2, "0"));

  setText("pendingTabCount", `(${pending.length})`);
  setText("checkedInTabCount", `(${checkedIn.length})`);
  setText("checkedOutTabCount", `(${checkedOut.length})`);
  setText("allTabCount", `(${visitors.length})`);
}

function renderCharts() {
  const visitors = allVisitorRecords();

  renderBarChart(
    "statusChart",
    countLabels(visitors.map((visitor) => getStatusRaw(visitor)))
  );

  renderBarChart(
    "purposeChart",
    countLabels(visitors.map((visitor) => getVisitorPurpose(visitor)))
  );

  renderDailyTrend(visitors);
}

function renderBarChart(id, values) {
  const container = $(id);
  if (!container) return;

  const entries = Object.entries(values || {})
    .filter(([, value]) => Number(value) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]));

  if (!entries.length) {
    container.innerHTML = `<div class="empty-box">No chart data yet.</div>`;
    return;
  }

  const max = Math.max(...entries.map(([, value]) => Number(value)), 1);

  container.innerHTML = entries.slice(0, 6).map(([label, value], index) => {
    const width = Math.max(6, Math.round((Number(value) / max) * 100));
    const color = COLORS[index % COLORS.length];

    return `
      <div class="chart-row">
        <div class="chart-row-head">
          <span>${escapeHtml(label)}</span>
          <strong>${value}</strong>
        </div>
        <div class="chart-track">
          <div class="chart-fill" style="width:${width}%;background:${color};"></div>
        </div>
      </div>
    `;
  }).join("");
}

function renderDailyTrend(visitors) {
  const container = $("dailyTrendChart");
  if (!container) return;

  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  start.setDate(start.getDate() - 6);

  const counts = Array(7).fill(0);

  visitors.forEach((visitor) => {
    const date = toDate(visitor.checkedInAt || visitor.checkInAt || getVisitDateValue(visitor));
    const index = visitorTrendIndex(date, today);

    if (index !== -1) {
      counts[index] += 1;
    }
  });

  const max = Math.max(...counts, 1);
  const hasData = counts.some((count) => count > 0);

  if (!hasData) {
    container.innerHTML = `<div class="empty-box">No recent visitor activity.</div>`;
    return;
  }

  container.innerHTML = counts.map((count, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);

    const height = Math.max(8, Math.round((count / max) * 120));

    return `
      <div class="day-bar">
        <div class="day-value">${count}</div>
        <div class="day-column" style="height:${height}px;"></div>
        <div class="day-label">${escapeHtml(compactDayLabel(date, today))}</div>
      </div>
    `;
  }).join("");
}

function renderListHead() {
  const titleMap = {
    pending: "Pending Approval",
    checkedIn: "Checked In Visitors",
    checkedOut: "Checked Out Visitors",
    all: "All Visitors"
  };

  const subtitleMap = {
    pending: "Review visitor requests and approve or decline.",
    checkedIn: "Visitors currently checked in at the property.",
    checkedOut: "Visitors who have already checked out.",
    all: "Complete visitor history and request status."
  };

  setText("listTitle", titleMap[state.activeTab] || "Visitors");
  setText("listSubtitle", subtitleMap[state.activeTab] || "");
}

function visitorActions(visitor) {
  if (isPending(visitor)) {
    return `
      <button type="button" class="approve-btn" data-action="approve" data-id="${escapeHtml(visitor.id)}" data-collection="${escapeHtml(visitor.collection)}">
        <i class="fa-regular fa-circle-check"></i>
        Approve
      </button>

      <button type="button" class="decline-btn" data-action="decline" data-id="${escapeHtml(visitor.id)}" data-collection="${escapeHtml(visitor.collection)}">
        <i class="fa-regular fa-circle-xmark"></i>
        Decline
      </button>
    `;
  }

  if (isCheckedIn(visitor)) {
    return `
      <button type="button" class="checkout-btn" data-action="checkout" data-id="${escapeHtml(visitor.id)}" data-collection="${escapeHtml(visitor.collection)}">
        Check-Out
      </button>
    `;
  }

  return `
    <span class="status-pill ${statusClass(visitor)}">
      ${escapeHtml(statusLabel(visitor))}
    </span>
  `;
}

function visitorCard(visitor) {
  const residentName = getResidentName(visitor);
  const room = getResidentRoom(visitor);
  const initials = getInitials(getVisitorName(visitor));

  return `
    <article class="visitor-item">
      <div class="visitor-avatar">
        ${escapeHtml(initials)}
      </div>

      <div class="visitor-info">
        <strong>${escapeHtml(getVisitorName(visitor))}</strong>

        <div class="visitor-meta">
          <span><i class="fa-solid fa-phone"></i>${escapeHtml(getVisitorPhone(visitor))}</span>
          <span><i class="fa-solid fa-house-user"></i>Visiting: ${escapeHtml(residentName)} ${escapeHtml(room)}</span>
          <span><i class="fa-regular fa-calendar"></i>${escapeHtml(getVisitDate(visitor))}</span>
          <span><i class="fa-regular fa-clock"></i>${escapeHtml(getVisitTime(visitor))}</span>
        </div>

        <div class="visitor-purpose">
          Purpose: ${escapeHtml(getVisitorPurpose(visitor))}
        </div>
      </div>

      <div class="visitor-actions">
        ${visitorActions(visitor)}
      </div>
    </article>
  `;
}

function renderVisitors() {
  renderListHead();

  const container = $("visitorList");
  if (!container) return;

  const visitors = getFilteredVisitors();

  if (!visitors.length) {
    container.innerHTML = `<div class="empty-box">No visitors found for this section.</div>`;
    return;
  }

  container.innerHTML = visitors.map(visitorCard).join("");
}

function renderRecentCheckedIn() {
  const tbody = $("recentCheckedInTable");
  if (!tbody) return;

  const recent = allVisitorRecords()
    .filter(isCheckedIn)
    .sort((a, b) => {
      const dateA = toDate(a.checkedInAt || a.checkInAt || a.updatedAt || a.createdAt)?.getTime() || 0;
      const dateB = toDate(b.checkedInAt || b.checkInAt || b.updatedAt || b.createdAt)?.getTime() || 0;

      return dateB - dateA;
    })
    .slice(0, 6);

  if (!recent.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6">No recently checked-in visitors found.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = recent.map((visitor) => {
    const resident = `${getResidentName(visitor)} ${getResidentRoom(visitor)}`;

    return `
      <tr>
        <td>${escapeHtml(getVisitorName(visitor))}</td>
        <td>${escapeHtml(resident)}</td>
        <td>${escapeHtml(formatDateTime(visitor.checkedInAt || visitor.checkInAt || visitor.updatedAt || visitor.createdAt))}</td>
        <td>${escapeHtml(getVisitorPurpose(visitor))}</td>
        <td><span class="table-status">Checked In</span></td>
        <td>
          <button type="button" class="table-action" data-action="checkout" data-id="${escapeHtml(visitor.id)}" data-collection="${escapeHtml(visitor.collection)}">
            Check-Out
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

/* NOTIFICATIONS */

function visitorActionKey(status) {
  const clean = normalize(status);

  if (clean.includes("approved")) return "visitor_approved";
  if (clean.includes("declined") || clean.includes("rejected")) return "visitor_declined";
  if (clean.includes("checked out") || clean.includes("check out")) return "visitor_checked_out";
  if (clean.includes("checked in") || clean.includes("check in")) return "visitor_checked_in";

  return "visitor_updated";
}

function visitorNotificationTitle(status) {
  const clean = normalize(status);

  if (clean.includes("approved")) return "Visitor approved";
  if (clean.includes("declined") || clean.includes("rejected")) return "Visitor declined";
  if (clean.includes("checked out") || clean.includes("check out")) return "Visitor checked out";
  if (clean.includes("checked in") || clean.includes("check in")) return "Visitor checked in";

  return "Visitor updated";
}

function rawNotifications() {
  const propertyId = getPropertyId();
  const propertyName = getPropertyName();

  const records = [
    ...state.notifications.map((item) => ({ ...item, collection: COLLECTIONS.notifications })),
    ...state.activityLogs.map((item) => ({ ...item, collection: COLLECTIONS.activityLogs })),
    ...state.announcements.map((item) => ({ ...item, collection: COLLECTIONS.announcements }))
  ];

  const fetched = records.filter((item) => {
    const itemPropertyId = firstText([item.propertyId, item.property_id], "");
    const itemPropertyName = firstText([item.propertyName, item.property], "");
    const staffId = firstText([item.staffId, item.createdByStaffId, item.updatedByStaffId, item.targetStaffId], "");
    const action = normalize(firstText([item.action, item.type, item.title, item.screen, item.source], ""));

    const visitorRelated =
      action.includes("visitor") ||
      normalize(firstText([item.message, item.description, item.body], "")).includes("visitor");

    return (
      staffId === session.uid ||
      (propertyId && itemPropertyId === propertyId) ||
      (propertyName && itemPropertyName === propertyName) ||
      visitorRelated
    );
  }).map((item) => ({
    readKey: `${item.collection}_${item.id}`,
    title: firstText([item.title, item.subject, item.name], "Visitor Update"),
    message: firstText([item.message, item.description, item.body, item.details], "A visitor activity was updated."),
    action: firstText([item.action, item.type], "visitor_activity"),
    createdAt: toDate(firstText([item.createdAt, item.updatedAt, item.date, item.timestamp]))
  }));

  const generated = allVisitorRecords().slice(0, 25).map((visitor) => ({
    readKey: `${visitor.collection}_${visitor.id}`,
    title: visitorNotificationTitle(getStatusRaw(visitor)),
    message: `${getVisitorName(visitor)} - ${statusLabel(visitor)}`,
    action: visitorActionKey(getStatusRaw(visitor)),
    createdAt: toDate(visitor.createdAt || visitor.updatedAt || visitor.checkedInAt || visitor.checkInAt || getVisitDateValue(visitor))
  }));

  const combined = [...fetched, ...generated].sort((a, b) => {
    return (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0);
  });

  const seen = new Set();
  const unique = [];

  combined.forEach((item) => {
    const key = `${item.title}|${item.message}|${item.action}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  });

  return unique.slice(0, 60);
}

function visibleNotifications() {
  return rawNotifications().filter((item) => !state.readNotificationKeys.has(item.readKey));
}

function renderNotifications() {
  const notifications = visibleNotifications();

  setText("notificationCount", notifications.length > 99 ? "99+" : notifications.length);

  const list = $("notificationList");
  if (!list) return;

  if (!notifications.length) {
    list.innerHTML = `<div class="empty-box">No notifications yet.</div>`;
    return;
  }

  list.innerHTML = notifications.map((item) => {
    return `
      <div class="notification-item">
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(item.message)}</p>
        <small>${escapeHtml(timeAgo(item.createdAt))}</small>
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

/* FIRESTORE ACTIONS */

function findVisitor(visitorId, collectionName) {
  return allVisitorRecords().find((visitor) => {
    return visitor.id === visitorId && visitor.collection === collectionName;
  });
}

async function writeVisitorActionNotification({
  action,
  title,
  message,
  visitor,
  newStatus,
  previousStatus
}) {
  const batch = writeBatch(db);

  const payload = {
    type: "visitor_activity",
    action,
    title,
    message,
    screen: "staff_visitor_management",
    source: "staff_visitor_management_screen",
    visitorId: visitor.id,
    visitorName: getVisitorName(visitor),
    visitorCollection: visitor.collection,
    propertyId: firstText([visitor.propertyId, visitor.property_id, getPropertyId()], ""),
    propertyName: firstText([visitor.propertyName, visitor.property, getPropertyName()], ""),
    staffId: session.uid,
    staffEmail: session.email,
    createdByStaffId: session.uid,
    createdByStaffEmail: session.email,
    visibleToStaff: true,
    visibleToAdmin: true,
    read: false,
    isRead: false,
    newStatus,
    previousStatus,
    residentName: getResidentName(visitor),
    roomNo: getResidentRoom(visitor).replace(/[()]/g, ""),
    purpose: getVisitorPurpose(visitor),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  batch.set(doc(collection(db, COLLECTIONS.notifications)), payload);
  batch.set(doc(collection(db, COLLECTIONS.activityLogs)), {
    ...payload,
    logType: "visitor_activity"
  });

  await batch.commit();
}

async function updateVisitorStatus(visitor, status, extra = {}) {
  if (!visitor || state.loading) return;

  state.loading = true;

  try {
    await setDoc(
      doc(db, visitor.collection, visitor.id),
      {
        status,
        visitorStatus: status,
        updatedAt: serverTimestamp(),
        updatedByStaffId: session.uid,
        updatedByStaffEmail: session.email,
        ...extra
      },
      { merge: true }
    );

    await writeVisitorActionNotification({
      action: visitorActionKey(status),
      title: visitorNotificationTitle(status),
      message: `${getVisitorName(visitor)} - Visitor ${status.toLowerCase()}.`,
      visitor,
      newStatus: status,
      previousStatus: getStatusRaw(visitor)
    });

    showToast(`Visitor ${status.toLowerCase()} successfully.`);
  } catch (error) {
    console.error("Visitor update failed:", error);
    showToast(`Update failed: ${error.message}`, "error");
  } finally {
    state.loading = false;
  }
}

async function approveVisitor(visitor) {
  await updateVisitorStatus(visitor, "Approved", {
    approvalStatus: "Approved",
    approvedAt: serverTimestamp(),
    approvedByStaffId: session.uid,
    approvedByStaffEmail: session.email
  });
}

async function declineVisitor(visitor) {
  await updateVisitorStatus(visitor, "Declined", {
    approvalStatus: "Declined",
    declinedAt: serverTimestamp(),
    declinedByStaffId: session.uid,
    declinedByStaffEmail: session.email
  });
}

async function checkoutVisitor(visitor) {
  await updateVisitorStatus(visitor, "Checked Out", {
    checkedOutAt: serverTimestamp(),
    checkOutAt: serverTimestamp(),
    checkedOutByStaffId: session.uid,
    checkedOutByStaffEmail: session.email
  });
}

function extractVisitorCode(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";

  try {
    const decoded = JSON.parse(value);

    if (decoded && typeof decoded === "object") {
      return firstText([
        decoded.visitorCode,
        decoded.checkInCode,
        decoded.qrCode,
        decoded.code,
        decoded.id
      ], "");
    }
  } catch (_) {}

  try {
    const uri = new URL(value);

    return firstText([
      uri.searchParams.get("visitorCode"),
      uri.searchParams.get("checkInCode"),
      uri.searchParams.get("qrCode"),
      uri.searchParams.get("code"),
      uri.searchParams.get("id")
    ], value);
  } catch (_) {}

  return value;
}

async function findVisitorByCode(code) {
  const clean = String(code || "").trim();
  if (!clean) return null;

  const collections = [COLLECTIONS.visitorRequests, COLLECTIONS.visitors];
  const fields = [
    "visitorCode",
    "checkInCode",
    "qrCode",
    "code",
    "visitorId",
    "requestNo",
    "requestId"
  ];

  for (const collectionName of collections) {
    try {
      const direct = await getDoc(doc(db, collectionName, clean));

      if (direct.exists()) {
        return {
          id: direct.id,
          collection: collectionName,
          ...direct.data()
        };
      }
    } catch (_) {}

    for (const field of fields) {
      try {
        const snap = await getDocs(
          query(
            collection(db, collectionName),
            where(field, "==", clean),
            limit(1)
          )
        );

        if (!snap.empty) {
          const item = snap.docs[0];

          return {
            id: item.id,
            collection: collectionName,
            ...item.data()
          };
        }
      } catch (_) {}
    }
  }

  return null;
}

async function checkInVisitorByCode(rawCode) {
  const code = extractVisitorCode(rawCode);

  if (!code) {
    showToast("Please enter visitor code.", "error");
    return;
  }

  const btn = $("checkInVisitorBtn");

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `Checking... <i class="fa-solid fa-spinner fa-spin"></i>`;
    }

    const visitor = await findVisitorByCode(code);

    if (!visitor) {
      showToast("No visitor found for this code.", "error");
      return;
    }

    if (isDeclined(visitor)) {
      showToast("This visitor request is not approved.", "error");
      return;
    }

    if (isCheckedOut(visitor)) {
      showToast("This visitor has already checked out.", "error");
      return;
    }

    await setDoc(
      doc(db, visitor.collection, visitor.id),
      {
        status: "Checked In",
        visitorStatus: "Checked In",
        checkedInAt: serverTimestamp(),
        checkInAt: serverTimestamp(),
        checkedInByStaffId: session.uid,
        checkedInByStaffEmail: session.email,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    await writeVisitorActionNotification({
      action: "visitor_checked_in",
      title: "Visitor checked in",
      message: `${getVisitorName(visitor)} checked in successfully.`,
      visitor,
      newStatus: "Checked In",
      previousStatus: getStatusRaw(visitor)
    });

    const input = $("visitorCodeInput");
    if (input) input.value = "";

    showToast("Visitor checked in successfully.");
  } catch (error) {
    console.error("Visitor check-in failed:", error);
    showToast(`Check-in failed: ${error.message}`, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `Check-In Visitor <i class="fa-solid fa-arrow-right"></i>`;
    }
  }
}

/* QR SCANNER */

async function openQrScanner() {
  if (!("BarcodeDetector" in window)) {
    showToast("QR scanning is not supported in this browser. Enter the code manually.", "error");
    return;
  }

  const video = $("qrVideo");
  if (!video) return;

  try {
    openModal("qrScannerModal");

    state.scannerStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment"
      },
      audio: false
    });

    video.srcObject = state.scannerStream;
    await video.play();

    const detector = new BarcodeDetector({
      formats: ["qr_code"]
    });

    state.scannerTimer = setInterval(async () => {
      try {
        const codes = await detector.detect(video);

        if (codes.length && codes[0].rawValue) {
          const value = codes[0].rawValue.trim();

          stopQrScanner();
          closeModal("qrScannerModal");

          if ($("visitorCodeInput")) {
            $("visitorCodeInput").value = extractVisitorCode(value);
          }

          await checkInVisitorByCode(value);
        }
      } catch (_) {}
    }, 700);
  } catch (error) {
    console.error("QR scanner failed:", error);
    stopQrScanner();
    closeModal("qrScannerModal");
    showToast("Camera permission failed. Enter the code manually.", "error");
  }
}

function stopQrScanner() {
  if (state.scannerTimer) {
    clearInterval(state.scannerTimer);
    state.scannerTimer = null;
  }

  if (state.scannerStream) {
    state.scannerStream.getTracks().forEach((track) => track.stop());
    state.scannerStream = null;
  }

  const video = $("qrVideo");
  if (video) {
    video.srcObject = null;
  }
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

  subscribeCollection("visitorRequests", COLLECTIONS.visitorRequests);
  subscribeCollection("visitors", COLLECTIONS.visitors);
  subscribeCollection("residents", COLLECTIONS.residents);
  subscribeCollection("notifications", COLLECTIONS.notifications);
  subscribeCollection("activityLogs", COLLECTIONS.activityLogs);
  subscribeCollection("announcements", COLLECTIONS.announcements);
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

  if (id === "qrScannerModal") {
    stopQrScanner();
  }

  if (!document.querySelector(".modal-overlay:not([hidden])")) {
    document.body.style.overflow = "";
  }
}

function closeAllModals() {
  document.querySelectorAll(".modal-overlay").forEach((modal) => {
    modal.hidden = true;
  });

  stopQrScanner();
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
      state.activeTab = button.dataset.tab || "pending";
      renderVisitors();
      renderListHead();
    });
  });
}

function setupEvents() {
  setupTabs();

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    const action = button.dataset.action;
    const visitorId = button.dataset.id;
    const collectionName = button.dataset.collection;

    if (!action || !visitorId || !collectionName) return;

    const visitor = findVisitor(visitorId, collectionName);
    if (!visitor) {
      showToast("Visitor record not found.", "error");
      return;
    }

    button.disabled = true;

    try {
      if (action === "approve") {
        await approveVisitor(visitor);
      }

      if (action === "decline") {
        await declineVisitor(visitor);
      }

      if (action === "checkout") {
        await checkoutVisitor(visitor);
      }
    } finally {
      button.disabled = false;
    }
  });

  $("checkInVisitorBtn")?.addEventListener("click", () => {
    checkInVisitorByCode($("visitorCodeInput")?.value || "");
  });

  $("visitorCodeInput")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      checkInVisitorByCode(event.target.value);
    }
  });

  $("scanQrBox")?.addEventListener("click", openQrScanner);

  $("viewAllRecentBtn")?.addEventListener("click", () => {
    state.activeTab = "all";

    document.querySelectorAll(".tab-btn").forEach((item) => {
      item.classList.toggle("active", item.dataset.tab === "all");
    });

    renderVisitors();
    renderListHead();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  $("refreshVisitorsBtn")?.addEventListener("click", () => {
    renderPage();
    showToast("Visitor data refreshed.");
  });

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
}

/* INIT */

document.addEventListener("DOMContentLoaded", () => {
  setupClock();
  setupLayout();
  setupEvents();
  setupAuth();
});