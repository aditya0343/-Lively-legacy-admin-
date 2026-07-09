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
  where
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const COLLECTIONS = {
  users: "users",
  staff: "staff",
  staffLoginAccounts: "staff_login_accounts",
  properties: "properties",
  staffAttendance: "staff_attendance",
  notifications: "notifications",
  activityLogs: "activity_logs"
};

const session = {
  uid: "",
  role: "Staff",
  name: "Staff",
  email: "",
  staffId: "",
  propertyId: ""
};

const state = {
  userData: null,
  staffRecord: null,
  loginRecord: null,
  propertyRecord: null,
  todayAttendance: null,
  attendanceRecords: [],
  notifications: [],
  currentLocation: null,
  locationVerified: false,
  locationChecked: false,
  distanceMeters: null,
  selfieDataUrl: "",
  cameraStream: null,
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

function firstNumber(values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      const number = Number(value);
      if (!Number.isNaN(number)) return number;
    }
  }

  return null;
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

function getTodayKey() {
  const now = new Date();
  return `${now.getFullYear()}_${now.getMonth() + 1}_${now.getDate()}`;
}

function getDateKeyDash() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function attendanceDocId() {
  return `${session.uid}_${getTodayKey()}`;
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

    await loadUserData();
    await loadLoginRecord();
    await loadStaffRecord();
    await loadPropertyRecord();

    renderFetchedDetails();
    subscribeAttendance();
    subscribeNotifications();

    await startCamera();
    refreshLocation();
  } catch (error) {
    console.error("Attendance init failed:", error);
    showToast(`Attendance page failed: ${error.message}`, "error");
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
  const searches = [
    [COLLECTIONS.staffLoginAccounts, "uid", session.uid],
    [COLLECTIONS.staffLoginAccounts, "email", session.email],
    [COLLECTIONS.staffLoginAccounts, "username", session.email],
    [COLLECTIONS.staffLoginAccounts, "staffId", session.staffId]
  ];

  state.loginRecord = await safeGetDoc(COLLECTIONS.staffLoginAccounts, session.uid);

  if (!state.loginRecord) {
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

/* PROFILE HELPERS */

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

function getPropertyAddress() {
  if (!state.propertyRecord) {
    return firstText([
      state.loginRecord?.propertyAddress,
      state.staffRecord?.propertyAddress,
      state.userData?.propertyAddress
    ], "Property address not found.");
  }

  return firstText([
    state.propertyRecord.fullAddress,
    state.propertyRecord.propertyAddress,
    state.propertyRecord.address,
    state.propertyRecord.address1,
    state.propertyRecord.location,
    [
      state.propertyRecord.area,
      state.propertyRecord.city,
      state.propertyRecord.state,
      state.propertyRecord.pincode,
      state.propertyRecord.pinCode
    ].filter(Boolean).join(", ")
  ], "Property address not found.");
}

function getShiftName() {
  return firstText([
    state.staffRecord?.shiftName,
    state.staffRecord?.shift,
    state.loginRecord?.shiftName,
    state.loginRecord?.shift,
    state.userData?.shiftName,
    state.userData?.shift
  ], "Morning Shift");
}

function getShiftStart() {
  return firstText([
    state.staffRecord?.shiftStart,
    state.staffRecord?.startTime,
    state.staffRecord?.shiftStartTime,
    state.loginRecord?.shiftStart,
    state.loginRecord?.startTime,
    state.loginRecord?.shiftStartTime,
    state.userData?.shiftStart,
    state.userData?.startTime,
    shiftStartFromTiming(getRawShiftTiming())
  ], "08:00 AM");
}

function getShiftEnd() {
  return firstText([
    state.staffRecord?.shiftEnd,
    state.staffRecord?.endTime,
    state.staffRecord?.shiftEndTime,
    state.loginRecord?.shiftEnd,
    state.loginRecord?.endTime,
    state.loginRecord?.shiftEndTime,
    state.userData?.shiftEnd,
    state.userData?.endTime,
    shiftEndFromTiming(getRawShiftTiming())
  ], "04:00 PM");
}

function getBreakTime() {
  return firstText([
    state.staffRecord?.breakTime,
    state.staffRecord?.totalBreak,
    state.loginRecord?.breakTime,
    state.loginRecord?.totalBreak,
    state.userData?.breakTime,
    state.userData?.totalBreak
  ], "30 mins");
}

function getRawShiftTiming() {
  return firstText([
    state.staffRecord?.shiftTiming,
    state.staffRecord?.timing,
    state.loginRecord?.shiftTiming,
    state.loginRecord?.timing,
    state.userData?.shiftTiming,
    state.userData?.timing
  ], "");
}

function shiftStartFromTiming(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const parts = text.split(/\s*(-|to|–|—)\s*/i);
  return parts.length >= 2 ? parts[0].trim() : "";
}

function shiftEndFromTiming(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const parts = text.split(/\s*(-|to|–|—)\s*/i);
  return parts.length >= 2 ? parts[parts.length - 1].trim() : "";
}

function getPropertyCoordinates() {
  if (!state.propertyRecord) {
    return { lat: null, lng: null };
  }

  const lat = firstNumber([
    state.propertyRecord.latitude,
    state.propertyRecord.lat,
    state.propertyRecord.geoLat,
    state.propertyRecord.locationLat,
    state.propertyRecord.coordinates?.lat,
    state.propertyRecord.coordinates?.latitude,
    state.propertyRecord.geoPoint?.latitude
  ]);

  const lng = firstNumber([
    state.propertyRecord.longitude,
    state.propertyRecord.lng,
    state.propertyRecord.long,
    state.propertyRecord.geoLng,
    state.propertyRecord.locationLng,
    state.propertyRecord.coordinates?.lng,
    state.propertyRecord.coordinates?.longitude,
    state.propertyRecord.geoPoint?.longitude
  ]);

  return { lat, lng };
}

function getAllowedRadiusMeters() {
  return firstNumber([
    state.propertyRecord?.attendanceRadiusMeters,
    state.propertyRecord?.allowedRadiusMeters,
    state.propertyRecord?.locationRadiusMeters
  ]) || 250;
}

function calculateDistanceMeters(lat1, lng1, lat2, lng2) {
  const earthRadius = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) *
    Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(earthRadius * c);
}

/* RENDER */

function renderProfileShell() {
  const name = session.name || "Staff";
  const email = session.email || "staff@email.com";
  const initials = getInitials(name || email);

  setText("staffNameTop", name);
  setText("staffEmailTop", email);
  setText("staffAvatarText", initials);
  setText("staffName", name);
  setText("staffId", session.staffId || session.uid || "--");
}

function renderFetchedDetails() {
  const staffName = getStaffName();
  const email = session.email || firstText([
    state.userData?.email,
    state.loginRecord?.email,
    state.staffRecord?.email
  ], "staff@email.com");

  const initials = getInitials(staffName || email);

  setText("staffNameTop", staffName);
  setText("staffEmailTop", email);
  setText("staffAvatarText", initials);
  setText("staffName", staffName);
  setText("staffId", getStaffId());

  setText("topPropertyText", getPropertyName());
  setText("shiftName", getShiftName());
  setText("shiftStart", getShiftStart());
  setText("shiftEnd", getShiftEnd());
  setText("breakTime", getBreakTime());

  setText("locationAddress", getPropertyAddress());

  const locationResult = $("locationResult");
  if (locationResult && !state.locationChecked) {
    locationResult.className = "location-result";
  }
}

/* ATTENDANCE SUBSCRIPTION */

function subscribeAttendance() {
  onSnapshot(
    collection(db, COLLECTIONS.staffAttendance),
    (snapshot) => {
      const staffId = getStaffId();
      const staffEmail = normalize(session.email);

      state.todayAttendance = null;

      state.attendanceRecords = snapshot.docs
        .map((docItem) => ({
          id: docItem.id,
          ...docItem.data()
        }))
        .filter((item) => {
          return (
            String(item.staffId || "") === staffId ||
            String(item.staffAccountId || "") === session.uid ||
            String(item.userId || "") === session.uid ||
            normalize(item.staffEmail || item.email || "") === staffEmail
          );
        })
        .sort((a, b) => {
          const dateA = toDate(a.checkInAt || a.createdAt || a.date)?.getTime() || 0;
          const dateB = toDate(b.checkInAt || b.createdAt || b.date)?.getTime() || 0;
          return dateB - dateA;
        });

      state.attendanceRecords.forEach((item) => {
        const dateMatch =
          item.dateKey === getDateKeyDash() ||
          item.attendanceDateKey === getTodayKey() ||
          item.id === attendanceDocId() ||
          isToday(item.date) ||
          isToday(item.createdAt) ||
          isToday(item.checkInAt);

        if (dateMatch && !state.todayAttendance) {
          state.todayAttendance = item;
        }
      });

      renderAttendanceStatus();
      renderAttendanceHistory();
    },
    (error) => {
      console.error("Attendance fetch failed:", error);
      showToast("Attendance fetch failed. Check Firestore rules.", "error");
      renderAttendanceStatus();
    }
  );
}

function renderAttendanceStatus() {
  const badge = $("attendanceStatusBadge");
  const text = $("attendanceStatusText");
  const icon = $("statusIcon");

  if (state.todayAttendance) {
    if (badge) {
      badge.textContent = "Marked";
      badge.className = "status-badge marked";
    }

    if (text) {
      text.textContent = "Your attendance has already been marked for today.";
    }

    icon?.classList.add("marked");

    setAttendanceMessage(
      "marked",
      "Attendance already marked",
      "Your attendance for today has already been recorded.",
      true
    );

    const btn = $("markAttendanceBtn");
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i class="fa-solid fa-check"></i> Attendance Marked`;
    }

    return;
  }

  if (badge) {
    badge.textContent = "Not Marked";
    badge.className = "status-badge not-marked";
  }

  if (text) {
    text.textContent = "You have not marked your attendance for today.";
  }

  icon?.classList.remove("marked");

  updateMarkButtonState();
}

function renderAttendanceHistory() {
  const container = $("attendanceHistoryList");
  if (!container) return;

  const records = state.attendanceRecords.slice(0, 6);

  if (!records.length) {
    container.innerHTML = `<div class="empty-state">No attendance records found yet.</div>`;
    return;
  }

  container.innerHTML = records.map((item) => {
    const status = firstText([item.attendanceStatus, item.status], "Marked");
    const time = item.checkInAt || item.createdAt || item.date;

    return `
      <div class="history-row">
        <div>
          <strong>${escapeHtml(formatDateTime(time))}</strong>
          <span>${escapeHtml(item.propertyName || getPropertyName())}</span>
        </div>

        <span>${escapeHtml(item.shiftName || "-")}</span>

        <span class="history-pill">${escapeHtml(status)}</span>
      </div>
    `;
  }).join("");
}

/* NOTIFICATIONS */

function subscribeNotifications() {
  onSnapshot(
    collection(db, COLLECTIONS.notifications),
    (snapshot) => {
      state.notifications = snapshot.docs
        .map((docItem) => ({
          id: docItem.id,
          ...docItem.data()
        }))
        .filter((item) => {
          const audience = normalize(firstText([item.audience, item.target], ""));
          const propertyId = firstText([item.propertyId, item.propertyDocId], "");
          const propertyName = firstText([item.propertyName, item.property], "");

          return (
            !audience ||
            audience === "all" ||
            audience === "staff" ||
            propertyId === getPropertyId() ||
            propertyName === getPropertyName()
          );
        })
        .sort((a, b) => {
          const dateA = toDate(a.createdAt || a.date)?.getTime() || 0;
          const dateB = toDate(b.createdAt || b.date)?.getTime() || 0;
          return dateB - dateA;
        })
        .slice(0, 20);

      renderNotifications();
    },
    () => {
      state.notifications = [];
      renderNotifications();
    }
  );
}

function renderNotifications() {
  setText("notificationCount", state.notifications.length > 99 ? "99+" : state.notifications.length);

  const list = $("notificationList");
  if (!list) return;

  if (!state.notifications.length) {
    list.innerHTML = `<div class="empty-state">No notifications yet.</div>`;
    return;
  }

  list.innerHTML = state.notifications.map((item) => {
    return `
      <div class="notification-item">
        <strong>${escapeHtml(firstText([item.title, item.subject], "Notification"))}</strong>
        <p>${escapeHtml(firstText([item.message, item.description, item.body], "No message available."))}</p>
      </div>
    `;
  }).join("");
}

/* LOCATION */

function setLocationStatus(type, title, message) {
  const box = $("locationResult");
  const mapCircle = $("mapCircle");

  if (box) {
    box.className = `location-result ${type || ""}`.trim();
  }

  if (mapCircle) {
    mapCircle.className = `map-circle ${type || ""}`.trim();
  }

  setText("locationStatusTitle", title);
  setText("locationAddress", message);
}

function setSmallLocationStatus(type, message) {
  const element = $("locationAccessText");

  if (element) {
    element.className = `small-status ${type || ""}`.trim();
    element.innerHTML = `<i class="fa-solid fa-circle-info"></i> ${escapeHtml(message)}`;
  }
}

function refreshLocation() {
  if (!navigator.geolocation) {
    state.locationChecked = true;
    state.locationVerified = false;

    setLocationStatus("error", "Location not supported", "Your browser does not support location access.");
    setSmallLocationStatus("error", "Location access is not available.");
    updateMarkButtonState();

    return;
  }

  setLocationStatus("", "Checking location", "Please allow location access.");
  setSmallLocationStatus("", "Checking current location...");

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const currentLat = position.coords.latitude;
      const currentLng = position.coords.longitude;

      state.currentLocation = {
        latitude: currentLat,
        longitude: currentLng,
        accuracy: position.coords.accuracy || null,
        capturedAt: new Date().toISOString()
      };

      state.locationChecked = true;

      const propertyCoordinates = getPropertyCoordinates();

      if (propertyCoordinates.lat === null || propertyCoordinates.lng === null) {
        state.locationVerified = true;
        state.distanceMeters = null;

        setLocationStatus(
          "success",
          "Location access allowed",
          getPropertyAddress()
        );

        setSmallLocationStatus(
          "success",
          "Location allowed. Property coordinates are not set, so distance check was skipped."
        );

        updateMarkButtonState();
        return;
      }

      const distance = calculateDistanceMeters(
        currentLat,
        currentLng,
        propertyCoordinates.lat,
        propertyCoordinates.lng
      );

      const allowedRadius = getAllowedRadiusMeters();

      state.distanceMeters = distance;
      state.locationVerified = distance <= allowedRadius;

      if (state.locationVerified) {
        setLocationStatus(
          "success",
          "You are within the allowed location",
          getPropertyAddress()
        );

        setSmallLocationStatus(
          "success",
          `Location verified. Distance: ${distance} meters.`
        );
      } else {
        setLocationStatus(
          "error",
          "You are outside the allowed location",
          `You are ${distance} meters away. Allowed radius is ${allowedRadius} meters.`
        );

        setSmallLocationStatus(
          "error",
          "Move closer to the assigned property and refresh location."
        );
      }

      updateMarkButtonState();
    },
    (error) => {
      state.locationChecked = true;
      state.locationVerified = false;

      console.error("Location error:", error);

      setLocationStatus(
        "error",
        "Location access failed",
        "Please allow location permission and try again."
      );

      setSmallLocationStatus("error", "Location access is denied or unavailable.");
      updateMarkButtonState();
    },
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0
    }
  );
}

/* SELFIE */

function setSelfieStatus(type, message) {
  const element = $("selfieStatusText");

  if (element) {
    element.className = `small-status ${type || ""}`.trim();
    element.textContent = message;
  }
}

async function startCamera() {
  const video = $("selfieVideo");

  if (!video || !navigator.mediaDevices?.getUserMedia) {
    setSelfieStatus("error", "Camera is not available on this browser.");
    return;
  }

  try {
    stopCamera();

    state.cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user"
      },
      audio: false
    });

    video.srcObject = state.cameraStream;
    setSelfieStatus("", "Camera ready. Capture a clear selfie.");
  } catch (error) {
    console.error("Camera error:", error);
    setSelfieStatus("error", "Camera permission denied or unavailable.");
  }
}

function stopCamera() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((track) => track.stop());
    state.cameraStream = null;
  }

  const video = $("selfieVideo");
  if (video) {
    video.srcObject = null;
  }
}

function captureSelfie() {
  const video = $("selfieVideo");
  const canvas = $("selfieCanvas");
  const preview = $("selfiePreview");
  const selfieBox = document.querySelector(".selfie-box");

  if (!video || !canvas || !preview) return;

  if (!video.videoWidth || !video.videoHeight) {
    setSelfieStatus("error", "Camera is not ready yet.");
    return;
  }

  const width = 360;
  const height = 270;

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  context.drawImage(video, 0, 0, width, height);

  state.selfieDataUrl = canvas.toDataURL("image/jpeg", 0.55);

  preview.src = state.selfieDataUrl;
  selfieBox?.classList.add("has-preview");

  setSelfieStatus("success", "Selfie captured successfully.");
  updateMarkButtonState();
}

async function retakeSelfie() {
  state.selfieDataUrl = "";

  const preview = $("selfiePreview");
  const selfieBox = document.querySelector(".selfie-box");

  if (preview) preview.removeAttribute("src");
  selfieBox?.classList.remove("has-preview");

  setSelfieStatus("", "Camera ready. Capture a clear selfie.");
  updateMarkButtonState();

  await startCamera();
}

/* ATTENDANCE ACTION */

function setAttendanceMessage(type, title, message, disabled) {
  const box = $("attendanceMessage");
  const btn = $("markAttendanceBtn");

  if (box) {
    box.className = `attendance-alert ${type}`;
  }

  setText("attendanceMessageTitle", title);
  setText("attendanceMessageText", message);

  if (btn) {
    btn.disabled = disabled;
  }
}

function updateMarkButtonState() {
  const btn = $("markAttendanceBtn");

  if (state.todayAttendance) {
    setAttendanceMessage(
      "marked",
      "Attendance already marked",
      "Your attendance for today has already been recorded.",
      true
    );

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i class="fa-solid fa-check"></i> Attendance Marked`;
    }

    return;
  }

  if (!state.locationVerified && !state.selfieDataUrl) {
    setAttendanceMessage(
      "danger",
      "Verification required",
      "Click Refresh Location and Capture Selfie before marking attendance.",
      false
    );

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-check"></i> Mark Attendance`;
    }

    return;
  }

  if (!state.locationVerified) {
    setAttendanceMessage(
      "danger",
      "Location required",
      "Please refresh and allow your current location before marking attendance.",
      false
    );

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-check"></i> Mark Attendance`;
    }

    return;
  }

  if (!state.selfieDataUrl) {
    setAttendanceMessage(
      "danger",
      "Selfie required",
      "Please capture your selfie before marking attendance.",
      false
    );

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-check"></i> Mark Attendance`;
    }

    return;
  }

  setAttendanceMessage(
    "ready",
    "Ready to mark attendance",
    "Location and selfie verification completed successfully.",
    false
  );

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-check"></i> Mark Attendance`;
  }
}

async function markAttendance() {
  if (state.loading) return;

  if (state.todayAttendance) {
    showToast("Attendance is already marked for today.", "error");
    return;
  }

  if (!state.locationVerified) {
    showToast("Please refresh and verify location first.", "error");
    refreshLocation();
    return;
  }

  if (!state.selfieDataUrl) {
    showToast("Please capture selfie first.", "error");
    return;
  }

  state.loading = true;

  const btn = $("markAttendanceBtn");

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
  }

  try {
    const staffName = getStaffName();
    const staffId = getStaffId();
    const propertyId = getPropertyId();
    const propertyName = getPropertyName();

    const payload = {
      attendanceId: attendanceDocId(),
      userId: session.uid,
      staffAccountId: session.uid,
      staffId,
      staffEmail: session.email,
      staffName,

      propertyId,
      propertyName,
      propertyAddress: getPropertyAddress(),

      shiftName: getShiftName(),
      shiftStart: getShiftStart(),
      shiftEnd: getShiftEnd(),
      breakTime: getBreakTime(),

      status: "Marked",
      attendanceStatus: "Marked",
      dateKey: getDateKeyDash(),
      attendanceDateKey: getTodayKey(),
      date: new Date(),
      checkInAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),

      locationVerified: state.locationVerified,
      location: state.currentLocation,
      distanceMeters: state.distanceMeters,

      selfieDataUrl: state.selfieDataUrl,
      source: "staff_website"
    };

    await setDoc(
      doc(db, COLLECTIONS.staffAttendance, attendanceDocId()),
      payload,
      { merge: true }
    );

    await setDoc(
      doc(collection(db, COLLECTIONS.activityLogs)),
      {
        type: "attendance_marked",
        staffId: session.uid,
        staffName,
        staffEmail: session.email,
        propertyId,
        propertyName,
        message: `${staffName} marked attendance.`,
        createdAt: serverTimestamp()
      }
    );

    state.todayAttendance = {
      id: attendanceDocId(),
      ...payload
    };

    setAttendanceMessage(
      "marked",
      "Attendance marked successfully",
      "Your attendance has been saved for today.",
      true
    );

    renderAttendanceStatus();

    showToast("Attendance marked successfully.");
  } catch (error) {
    console.error("Mark attendance failed:", error);
    showToast(`Attendance failed: ${error.message}`, "error");

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-check"></i> Mark Attendance`;
    }
  } finally {
    state.loading = false;
  }
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

/* MODAL */

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

function setupEvents() {
  $("refreshLocationBtn")?.addEventListener("click", refreshLocation);
  $("captureSelfieBtn")?.addEventListener("click", captureSelfie);
  $("retakeSelfieBtn")?.addEventListener("click", retakeSelfie);
  $("markAttendanceBtn")?.addEventListener("click", markAttendance);

  $("refreshDataBtn")?.addEventListener("click", async () => {
    await initData();
    showToast("Attendance data refreshed.");
  });

  $("notificationBtn")?.addEventListener("click", () => {
    openModal("notificationModal");
  });

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

  window.addEventListener("beforeunload", () => {
    stopCamera();
  });
}

/* INIT */

document.addEventListener("DOMContentLoaded", () => {
  setupClock();
  setupLayout();
  setupEvents();
  setupAuth();
});