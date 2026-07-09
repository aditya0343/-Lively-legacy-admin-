import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged,
  signOut,
  updatePassword
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
  staffAttendance: "staff_attendance",
  visitors: "visitors",
  visitorRequests: "visitor_requests",
  parcels: "parcels",
  tasks: "tasks",
  complaints: "complaints",
  settlements: "moveout_settlements",
  announcements: "announcements",
  notifications: "notifications",
  activityLogs: "activity_logs",
  properties: "properties",
  residents: "residents",
  bookings: "bookings"
};

const COLORS = {
  navy: "#061b32",
  gold: "#b68b2d",
  green: "#109a43",
  red: "#e50922",
  blue: "#0d6eff",
  purple: "#6a42d8",
  orange: "#ff7a00"
};

const state = {
  currentUser: null,
  session: {
    uid: "",
    email: "",
    name: "Staff",
    role: "Staff",
    propertyId: ""
  },
  staffLoginAccounts: [],
  users: [],
  staff: [],
  staffAttendance: [],
  visitors: [],
  visitorRequests: [],
  parcels: [],
  tasks: [],
  complaints: [],
  settlements: [],
  announcements: [],
  notifications: [],
  activityLogs: [],
  properties: [],
  residents: [],
  bookings: [],
  readNotificationKeys: new Set(),
  scannerStream: null,
  scannerTimer: null,
  currentData: null
};

let firebaseStarted = false;

const setText = (id, value) => {
  const el = $(id);
  if (el) el.textContent = value;
};

const normalize = (value) => String(value || "").trim().toLowerCase();

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

function firstNonEmpty(values, fallback = "") {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }

  return fallback;
}

function toDate(value) {
  if (!value) return null;
  if (value.toDate && typeof value.toDate === "function") return value.toDate();
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

function timeAgo(value) {
  const date = toDate(value);
  if (!date) return "-";

  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);

  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  return formatDate(date);
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
  return `staff_read_notification_keys_${state.session.uid || "guest"}`;
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
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      const legacyStaffLogin = localStorage.getItem("loginType") === "staff";

      if (!legacyStaffLogin) {
        window.location.href = "../index.html";
        return;
      }

      state.currentUser = null;
      state.session = {
        uid: localStorage.getItem("loggedInUserUID") || localStorage.getItem("staffAccountId") || "",
        email: localStorage.getItem("loggedInUserEmail") || localStorage.getItem("staffEmail") || "",
        name: localStorage.getItem("loggedInUserName") || localStorage.getItem("staffName") || "Staff",
        role: localStorage.getItem("loggedInUserRole") || localStorage.getItem("staffRole") || "Staff",
        propertyId: localStorage.getItem("staffPropertyId") || ""
      };

      loadReadNotificationKeys();
      renderProfile();
      setupFirebase();
      return;
    }

    state.currentUser = user;
    state.session = {
      uid: user.uid,
      email: (user.email || "").trim().toLowerCase(),
      name: user.displayName || localStorage.getItem("loggedInUserName") || "Staff",
      role: localStorage.getItem("loggedInUserRole") || "Staff",
      propertyId: localStorage.getItem("staffPropertyId") || ""
    };

    localStorage.setItem("loginType", "staff");
    localStorage.setItem("loggedInUserUID", user.uid);
    localStorage.setItem("loggedInUserEmail", user.email || "");
    localStorage.setItem("loggedInUserName", state.session.name);

    loadReadNotificationKeys();
    renderProfile();
    setupFirebase();
  });
}

async function doLogout() {
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
  const profileBtn = $("profileBtn");
  const profileDropdown = $("profileDropdown");

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

  profileBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    profileDropdown?.classList.toggle("show");
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".staff-profile-box")) {
      profileDropdown?.classList.remove("show");
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAllModals();
      profileDropdown?.classList.remove("show");
      sidebar?.classList.remove("open");
      overlay?.classList.remove("show");
    }
  });
}

/* FIREBASE */

function listenCollection(stateKey, collectionName) {
  if (!db) {
    console.error("Firestore db is not loaded. Check js/firebase-config.js export.");
    showToast("Firestore database not loaded. Check firebase-config.js.", "error");
    return;
  }

  if (!collectionName) {
    console.error("Missing collection name for:", stateKey);
    return;
  }

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

function setupFirebase() {
  if (firebaseStarted) return;
  firebaseStarted = true;

  listenCollection("staffLoginAccounts", COLLECTIONS.staffLoginAccounts);
  listenCollection("users", COLLECTIONS.users);
  listenCollection("staff", COLLECTIONS.staff);
  listenCollection("staffAttendance", COLLECTIONS.staffAttendance);
  listenCollection("visitors", COLLECTIONS.visitors);
  listenCollection("visitorRequests", COLLECTIONS.visitorRequests);
  listenCollection("parcels", COLLECTIONS.parcels);
  listenCollection("tasks", COLLECTIONS.tasks);
  listenCollection("complaints", COLLECTIONS.complaints);
  listenCollection("settlements", COLLECTIONS.settlements);
  listenCollection("announcements", COLLECTIONS.announcements);
  listenCollection("notifications", COLLECTIONS.notifications);
  listenCollection("activityLogs", COLLECTIONS.activityLogs);
  listenCollection("properties", COLLECTIONS.properties);
  listenCollection("residents", COLLECTIONS.residents);
  listenCollection("bookings", COLLECTIONS.bookings);
}

/* STAFF DATA */

function findByEmail(list, email) {
  const clean = normalize(email);
  if (!clean) return null;

  return list.find((item) => normalize(item.email || item.username) === clean) || null;
}

function staffSources() {
  const uid = state.session.uid;
  const email = state.session.email;

  const userData =
    state.users.find((item) => item.id === uid || item.uid === uid) ||
    findByEmail(state.users, email) ||
    {};

  const staffData =
    state.staff.find((item) => item.id === uid || item.uid === uid) ||
    findByEmail(state.staff, email) ||
    {};

  const loginData =
    state.staffLoginAccounts.find((item) => item.id === uid || item.uid === uid) ||
    findByEmail(state.staffLoginAccounts, email) ||
    {};

  const linkedEmployeeId = firstNonEmpty([
    loginData.employeeId,
    loginData.employeeUid,
    userData.employeeId,
    userData.employeeUid,
    staffData.employeeId,
    staffData.employeeUid
  ]);

  const linkedEmployeeData =
    linkedEmployeeId && linkedEmployeeId !== uid
      ? state.staff.find((item) => item.id === linkedEmployeeId || item.uid === linkedEmployeeId) || {}
      : {};

  return {
    userData,
    staffData,
    loginData,
    linkedEmployeeData
  };
}

function getStaffProfile() {
  const { userData, staffData, loginData, linkedEmployeeData } = staffSources();

  const staffName = firstNonEmpty([
    loginData.staffName,
    loginData.name,
    loginData.fullName,
    loginData.displayName,
    staffData.name,
    staffData.staffName,
    staffData.fullName,
    staffData.displayName,
    linkedEmployeeData.name,
    linkedEmployeeData.staffName,
    linkedEmployeeData.fullName,
    linkedEmployeeData.displayName,
    userData.name,
    userData.staffName,
    userData.fullName,
    userData.displayName,
    state.currentUser?.displayName,
    state.session.name,
    state.session.email,
    "Staff"
  ]);

  const role = firstNonEmpty([
    loginData.staffRole,
    loginData.department,
    loginData.role,
    staffData.staffRole,
    staffData.department,
    staffData.role,
    linkedEmployeeData.staffRole,
    linkedEmployeeData.department,
    linkedEmployeeData.role,
    userData.staffRole,
    userData.department,
    userData.role,
    state.session.role,
    "Staff"
  ]);

  let propertyId = firstNonEmpty([
    loginData.propertyId,
    loginData.property_id,
    staffData.propertyId,
    staffData.property_id,
    linkedEmployeeData.propertyId,
    linkedEmployeeData.property_id,
    userData.propertyId,
    userData.property_id,
    state.session.propertyId
  ]);

  let propertyName = firstNonEmpty([
    loginData.propertyName,
    loginData.propertyLocation,
    loginData.property,
    staffData.propertyName,
    staffData.propertyLocation,
    staffData.property,
    linkedEmployeeData.propertyName,
    linkedEmployeeData.propertyLocation,
    linkedEmployeeData.property,
    userData.propertyName,
    userData.propertyLocation,
    userData.property
  ]);

  let property = getPropertyByIdOrName(propertyId || propertyName);

  if (!property && propertyName) {
    property = getPropertyByIdOrName(propertyName);
  }

  propertyId = firstNonEmpty([
    propertyId,
    property?.id,
    property?.propertyId
  ]);

  propertyName = firstNonEmpty([
    propertyName,
    property?.propertyName,
    property?.name,
    property?.title
  ]);

  const propertyAddress = firstNonEmpty([
    loginData.propertyAddress,
    loginData.address,
    loginData.fullAddress,
    staffData.propertyAddress,
    staffData.address,
    staffData.fullAddress,
    linkedEmployeeData.propertyAddress,
    linkedEmployeeData.address,
    linkedEmployeeData.fullAddress,
    userData.propertyAddress,
    userData.address,
    userData.fullAddress,
    propertyAddressFromData(property || {}),
    propertyName
  ]);

  const rawShiftTiming = firstNonEmpty([
    loginData.shiftTiming,
    loginData.timing,
    loginData.shiftTime,
    staffData.shiftTiming,
    staffData.timing,
    staffData.shiftTime,
    linkedEmployeeData.shiftTiming,
    linkedEmployeeData.timing,
    linkedEmployeeData.shiftTime,
    userData.shiftTiming,
    userData.timing,
    userData.shiftTime
  ]);

  return {
    uid: state.session.uid,
    email: state.session.email || firstNonEmpty([loginData.email, userData.email, staffData.email]),
    staffName,
    shortName: staffName.split(/\s+/)[0] || "Staff",
    role,
    propertyId,
    propertyName,
    propertyAddress,
    shiftName: firstNonEmpty([
      loginData.shiftName,
      loginData.shift,
      staffData.shiftName,
      staffData.shift,
      linkedEmployeeData.shiftName,
      linkedEmployeeData.shift,
      userData.shiftName,
      userData.shift,
      rawShiftTiming
    ]),
    shiftStart: firstNonEmpty([
      loginData.shiftStart,
      loginData.startTime,
      loginData.shiftStartTime,
      staffData.shiftStart,
      staffData.startTime,
      staffData.shiftStartTime,
      linkedEmployeeData.shiftStart,
      linkedEmployeeData.startTime,
      linkedEmployeeData.shiftStartTime,
      userData.shiftStart,
      userData.startTime,
      userData.shiftStartTime,
      shiftStartFromTiming(rawShiftTiming)
    ]),
    shiftEnd: firstNonEmpty([
      loginData.shiftEnd,
      loginData.endTime,
      loginData.shiftEndTime,
      staffData.shiftEnd,
      staffData.endTime,
      staffData.shiftEndTime,
      linkedEmployeeData.shiftEnd,
      linkedEmployeeData.endTime,
      linkedEmployeeData.shiftEndTime,
      userData.shiftEnd,
      userData.endTime,
      userData.shiftEndTime,
      shiftEndFromTiming(rawShiftTiming)
    ]),
    breakTime: firstNonEmpty([
      loginData.breakTime,
      loginData.totalBreak,
      staffData.breakTime,
      staffData.totalBreak,
      linkedEmployeeData.breakTime,
      linkedEmployeeData.totalBreak,
      userData.breakTime,
      userData.totalBreak
    ])
  };
}

function getPropertyByIdOrName(value) {
  const key = String(value || "").trim();
  if (!key) return null;

  return state.properties.find((property) => {
    return (
      String(property.id || "") === key ||
      String(property.propertyId || "") === key ||
      String(property.property_id || "") === key ||
      String(property.propertyCode || "") === key ||
      String(property.propertyName || "") === key ||
      String(property.name || "") === key ||
      String(property.title || "") === key ||
      String(property.propertyLocation || "") === key
    );
  }) || null;
}

function propertyAddressFromData(data) {
  if (!data || !Object.keys(data).length) return "";

  const direct = firstNonEmpty([
    data.fullAddress,
    data.propertyAddress,
    data.address,
    data.location
  ]);

  if (direct) return direct;

  return [
    data.buildingName,
    data.building,
    data.landmark,
    data.area,
    data.locality,
    data.city,
    data.state,
    data.pinCode,
    data.pincode,
    data.zipCode
  ].filter(Boolean).join(", ");
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

function statusText(item) {
  return firstNonEmpty([
    item.status,
    item.taskStatus,
    item.assignmentStatus,
    item.parcelStatus,
    item.settlementStatus,
    item.complaintStatus
  ]);
}

function cleanChartLabel(value, fallback = "Pending") {
  const clean = String(value || "").trim();
  if (!clean) return fallback;

  return clean
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function belongsToStaffOrProperty(item, profile) {
  const assignedStaffId = firstNonEmpty([
    item.assignedStaffId,
    item.staffId,
    item.assignedTo,
    item.assignedToId,
    item.staffAccountId
  ]);

  const itemPropertyId = firstNonEmpty([
    item.propertyId,
    item.property_id,
    item.propertyDocId,
    item.assignedPropertyId
  ]);

  const itemPropertyName = firstNonEmpty([
    item.propertyName,
    item.property
  ]);

  return (
    assignedStaffId === profile.uid ||
    (profile.propertyId && itemPropertyId === profile.propertyId) ||
    (profile.propertyName && itemPropertyName === profile.propertyName)
  );
}

function trendIndex(date, today) {
  if (!date) return -1;

  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  start.setDate(start.getDate() - 6);

  const clean = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.round((clean - start) / 86400000);

  return diff >= 0 && diff <= 6 ? diff : -1;
}

/* BUILD DASHBOARD DATA */

function buildDashboardData() {
  const profile = getStaffProfile();
  const today = new Date();

  const attendanceId = `${profile.uid}_${today.getFullYear()}_${today.getMonth() + 1}_${today.getDate()}`;

  const attendance =
    state.staffAttendance.find((item) => item.id === attendanceId) ||
    state.staffAttendance.find((item) => {
      const staffMatch = firstNonEmpty([
        item.staffId,
        item.staffAccountId,
        item.userId
      ]) === profile.uid;

      return staffMatch && isToday(item.date || item.createdAt || item.checkInAt);
    });

  const attendanceStatus = attendance
    ? firstNonEmpty([attendance.status, attendance.attendanceStatus], "Marked")
    : "Not Marked";

  const allVisitors = [...state.visitors, ...state.visitorRequests];

  const visitorTrendCounts = Array(7).fill(0);
  const parcelTrendCounts = Array(7).fill(0);
  const taskTrendCounts = Array(7).fill(0);

  const visitorsToday = allVisitors.filter((item) => {
    const status = normalize(firstNonEmpty([item.status, item.visitorStatus]));
    const active = !status.includes("rejected");

    const date = toDate(firstNonEmpty([
      item.visitTime,
      item.visitDate,
      item.requestedAt,
      item.createdAt,
      item.checkInAt
    ]));

    const belongs = belongsToStaffOrProperty(item, profile);

    if (belongs) {
      const idx = trendIndex(date, today);
      if (idx !== -1) visitorTrendCounts[idx] += 1;
    }

    return active && belongs && (!date || isSameDay(date, today));
  }).length;

  const parcels = state.parcels
    .map((item) => ({
      id: item.id,
      trackingId: firstNonEmpty([item.trackingId, item.trackingNo, item.parcelNo], item.id),
      resident: firstNonEmpty([item.residentName, item.name], "Resident"),
      courier: firstNonEmpty([item.courier, item.courierName], "Courier"),
      parcelType: firstNonEmpty([item.parcelType, item.type], "Parcel"),
      propertyId: firstNonEmpty([item.propertyId, item.property_id]),
      propertyName: firstNonEmpty([item.propertyName, item.property]),
      assignedStaffId: firstNonEmpty([item.assignedStaffId, item.staffId]),
      status: firstNonEmpty([item.status, item.parcelStatus], "Pending"),
      receivedAt: toDate(firstNonEmpty([item.receivedAt, item.createdAt])),
      raw: item
    }))
    .filter((parcel) => {
      const status = normalize(parcel.status);

      return (
        !status.includes("handed") &&
        (
          parcel.assignedStaffId === profile.uid ||
          (profile.propertyId && parcel.propertyId === profile.propertyId) ||
          (profile.propertyName && parcel.propertyName === profile.propertyName)
        )
      );
    })
    .sort((a, b) => (b.receivedAt?.getTime() || 0) - (a.receivedAt?.getTime() || 0));

  parcels.forEach((parcel) => {
    const idx = trendIndex(parcel.receivedAt, today);
    if (idx !== -1) parcelTrendCounts[idx] += 1;
  });

  const taskDocs = state.tasks.map((item) => taskFromDoc(item, "tasks"));
  const complaintTasks = state.complaints.map((item) => taskFromComplaint(item));

  const tasks = [...taskDocs, ...complaintTasks]
    .filter((task) => {
      const status = normalize(task.status);

      return (
        !status.includes("completed") &&
        !status.includes("resolved") &&
        !status.includes("closed") &&
        (
          task.assignedStaffId === profile.uid ||
          (profile.propertyId && task.propertyId === profile.propertyId) ||
          (profile.propertyName && task.propertyName === profile.propertyName)
        )
      );
    })
    .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));

  tasks.forEach((task) => {
    const idx = trendIndex(task.createdAt, today);
    if (idx !== -1) taskTrendCounts[idx] += 1;
  });

  const pendingSettlements = state.settlements.filter((item) => {
    const status = normalize(statusText(item));

    return (
      !status.includes("completed") &&
      !status.includes("paid") &&
      belongsToStaffOrProperty(item, profile)
    );
  }).length;

  const announcements = [...state.announcements, ...state.notifications]
    .map((item) => ({
      id: item.id,
      title: firstNonEmpty([item.title, item.subject, item.name], "Announcement"),
      message: firstNonEmpty([item.message, item.description, item.body], "No message available."),
      createdAt: toDate(firstNonEmpty([item.createdAt, item.date, item.publishedAt])),
      raw: item
    }))
    .filter((item) => announcementVisible(item.raw, profile))
    .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));

  const taskStatusCounts = countLabels(tasks.map((task) => cleanChartLabel(task.status)));
  const parcelStatusCounts = countLabels(parcels.map((parcel) => cleanChartLabel(parcel.status)));

  const trendStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  trendStart.setDate(trendStart.getDate() - 6);

  const activityTrend = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(trendStart);
    day.setDate(trendStart.getDate() + index);

    return {
      label: compactDayLabel(day, today),
      visitors: visitorTrendCounts[index],
      parcels: parcelTrendCounts[index],
      tasks: taskTrendCounts[index]
    };
  });

  const notifications = buildNotifications({
    profile,
    announcements,
    tasks,
    parcels,
    allVisitors,
    attendanceStatus,
    attendance,
    pendingSettlements
  })
    .filter((item) => !state.readNotificationKeys.has(item.readKey))
    .slice(0, 50);

  return {
    ...profile,
    attendanceStatus,
    visitorsToday,
    parcelsToHandle: parcels.length,
    tasksAssigned: tasks.length,
    pendingSettlements,
    tasks,
    parcels,
    announcements: announcements.slice(0, 5),
    notifications,
    notificationCount: notifications.length,
    taskStatusCounts,
    parcelStatusCounts,
    activityTrend
  };
}

function taskFromDoc(item, collectionName) {
  return {
    id: item.id,
    collection: collectionName,
    title: firstNonEmpty([item.title, item.taskTitle, item.name], "Assigned Task"),
    description: firstNonEmpty([item.description, item.details, item.note], "Task details not available"),
    status: firstNonEmpty([item.status, item.taskStatus], "Pending"),
    assignedStaffId: firstNonEmpty([item.assignedStaffId, item.staffId, item.assignedTo, item.assignedToId]),
    propertyId: firstNonEmpty([item.propertyId, item.property_id]),
    propertyName: firstNonEmpty([item.propertyName, item.property]),
    createdAt: toDate(firstNonEmpty([item.createdAt, item.assignedAt, item.updatedAt])),
    raw: item
  };
}

function taskFromComplaint(item) {
  return {
    id: item.id,
    collection: "complaints",
    title: firstNonEmpty([item.issueTitle, item.title, item.complaintTitle, item.category], "Complaint Task"),
    description: firstNonEmpty([item.description, item.details], "Complaint details not available"),
    status: firstNonEmpty([item.status, item.complaintStatus], "Pending"),
    assignedStaffId: firstNonEmpty([item.assignedStaffId, item.staffId, item.assignedTo, item.assignedToId]),
    propertyId: firstNonEmpty([item.propertyId, item.property_id]),
    propertyName: firstNonEmpty([item.propertyName, item.property]),
    createdAt: toDate(firstNonEmpty([item.createdAt, item.assignedAt, item.updatedAt])),
    raw: item
  };
}

function countLabels(labels) {
  const counts = {};

  labels.forEach((label) => {
    const clean = cleanChartLabel(label);
    counts[clean] = (counts[clean] || 0) + 1;
  });

  return counts;
}

function announcementVisible(item, profile) {
  const itemPropertyId = firstNonEmpty([item.propertyId, item.propertyDocId]);
  const itemPropertyName = firstNonEmpty([item.propertyName, item.property]);
  const audience = normalize(firstNonEmpty([item.audience, item.target]));

  return (
    audience === "all" ||
    audience === "staff" ||
    !audience ||
    !itemPropertyId ||
    itemPropertyId === profile.propertyId ||
    itemPropertyName === profile.propertyName
  );
}

/* NOTIFICATIONS */

function buildNotifications({
  profile,
  announcements,
  tasks,
  parcels,
  allVisitors,
  attendanceStatus,
  attendance,
  pendingSettlements
}) {
  const today = new Date();
  const trendStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  trendStart.setDate(trendStart.getDate() - 6);

  const isRecent = (date) => !date || date >= trendStart;

  const notifications = [];

  state.activityLogs.forEach((item) => {
    if (!belongsToStaffOrProperty(item, profile)) return;

    const createdAt = toDate(firstNonEmpty([item.createdAt, item.updatedAt]));
    if (!isRecent(createdAt)) return;

    const type = firstNonEmpty([item.type, item.activityType, item.category], "Activity");

    notifications.push({
      readKey: `activity_logs_${item.id}`,
      type,
      title: activityTitleFromType(type),
      message: firstNonEmpty([
        item.message,
        item.description,
        item.details,
        item.residentName,
        item.visitorName,
        item.staffName,
        item.propertyName
      ], "New activity recorded."),
      createdAt
    });
  });

  announcements.slice(0, 8).forEach((item) => {
    notifications.push({
      readKey: `announcement_${item.id}`,
      type: "announcement",
      title: item.title,
      message: item.message,
      createdAt: item.createdAt
    });
  });

  tasks.slice(0, 12).forEach((task) => {
    notifications.push({
      readKey: `${task.collection}_${task.id}`,
      type: task.collection === "complaints" ? "complaint" : "task",
      title: task.title,
      message: `${task.description} • ${task.status}`,
      createdAt: task.createdAt
    });
  });

  parcels.slice(0, 12).forEach((parcel) => {
    notifications.push({
      readKey: `parcel_${parcel.id}`,
      type: "parcel",
      title: "Parcel update",
      message: `${parcel.trackingId} • ${parcel.resident} • ${parcel.status}`,
      createdAt: parcel.receivedAt
    });
  });

  allVisitors.forEach((item) => {
    if (!belongsToStaffOrProperty(item, profile)) return;

    const createdAt = toDate(firstNonEmpty([
      item.visitTime,
      item.visitDate,
      item.requestedAt,
      item.createdAt,
      item.checkInAt
    ]));

    if (!isRecent(createdAt)) return;

    notifications.push({
      readKey: `visitor_${item.id}`,
      type: "visitor",
      title: "Visitor activity",
      message: firstNonEmpty([
        item.visitorName,
        item.guestName,
        item.name,
        item.purpose,
        item.reason
      ], "Visitor record updated."),
      createdAt
    });
  });

  if (normalize(attendanceStatus) !== "not marked") {
    notifications.push({
      readKey: `attendance_${profile.uid}_${today.getFullYear()}_${today.getMonth() + 1}_${today.getDate()}`,
      type: "attendance",
      title: "Attendance updated",
      message: `Today attendance status: ${attendanceStatus}`,
      createdAt: toDate(firstNonEmpty([attendance?.checkInAt, attendance?.updatedAt, attendance?.date])) || today
    });
  }

  if (pendingSettlements > 0) {
    notifications.push({
      readKey: `settlement_${profile.uid}_${today.getFullYear()}_${today.getMonth() + 1}_${today.getDate()}_${pendingSettlements}`,
      type: "settlement",
      title: "Pending settlements",
      message: `${pendingSettlements} move-out settlements need attention.`,
      createdAt: today
    });
  }

  return notifications.sort((a, b) => {
    return (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0);
  });
}

function activityTitleFromType(type) {
  const clean = String(type || "").trim().toLowerCase().replaceAll("_", " ");

  if (clean.includes("check") && clean.includes("in")) return "Resident check-in";
  if (clean.includes("visitor")) return "Visitor activity";
  if (clean.includes("parcel")) return "Parcel update";
  if (clean.includes("task")) return "Task update";
  if (clean.includes("complaint")) return "Complaint update";
  if (clean.includes("attendance")) return "Attendance update";
  if (clean.includes("settlement")) return "Settlement update";
  if (clean.includes("announcement")) return "Announcement";

  return clean ? cleanChartLabel(clean, "Activity update") : "Activity update";
}

function activityIcon(type) {
  const clean = normalize(type);

  if (clean.includes("visitor")) return "fa-regular fa-address-book";
  if (clean.includes("parcel")) return "fa-solid fa-box";
  if (clean.includes("task")) return "fa-regular fa-rectangle-list";
  if (clean.includes("complaint")) return "fa-solid fa-triangle-exclamation";
  if (clean.includes("attendance")) return "fa-regular fa-calendar-check";
  if (clean.includes("settlement")) return "fa-regular fa-file-lines";
  if (clean.includes("announcement")) return "fa-solid fa-bullhorn";
  if (clean.includes("check")) return "fa-solid fa-right-to-bracket";

  return "fa-regular fa-bell";
}

function activityColor(type) {
  const clean = normalize(type);

  if (clean.includes("visitor")) return COLORS.orange;
  if (clean.includes("parcel")) return COLORS.green;
  if (clean.includes("task")) return COLORS.blue;
  if (clean.includes("complaint")) return COLORS.red;
  if (clean.includes("attendance")) return COLORS.green;
  if (clean.includes("settlement")) return COLORS.red;
  if (clean.includes("announcement")) return COLORS.purple;
  if (clean.includes("check")) return COLORS.gold;

  return COLORS.navy;
}

/* RENDER */

function renderPage() {
  const data = buildDashboardData();
  state.currentData = data;

  renderProfile();
  renderStaffDetails(data);
  renderAttendance(data);
  renderStats(data);
  renderCharts(data);
  renderAnnouncements(data);
  renderTasks(data);
  renderOverview(data);
  renderParcelPreview(data);
  renderNotifications(data);
}

function renderProfile() {
  const profile = getStaffProfile();
  const initials = getInitials(profile.staffName || profile.email || "Staff");

  setText("profileNameText", profile.staffName || "Staff");
  setText("profileEmailText", profile.email || "staff@email.com");
  setText("staffAvatarText", initials);
  setText("profileAvatarText", initials);
}

function renderStaffDetails(data) {
  setText("staffNameText", data.shortName || "Staff");
  setText("topPropertyText", data.propertyName || "Staff panel");

  setText("propertyName", data.propertyName || "-");
  setText("propertyAddress", data.propertyAddress || "Address not available");

  setText("shiftName", data.shiftName || "-");
  setText("shiftStart", data.shiftStart || "-");
  setText("shiftEnd", data.shiftEnd || "-");
  setText("breakTime", data.breakTime || "30 mins");
}

function renderAttendance(data) {
  const badge = $("attendanceStatusBadge");
  const btn = $("quickMarkAttendanceBtn");

  const marked = isMarked(data.attendanceStatus);

  if (badge) {
    badge.textContent = marked ? "Marked" : "Not Marked";
    badge.className = `status-badge ${marked ? "marked" : "not-marked"}`;
  }

  if (btn) {
    btn.textContent = marked ? "Attendance Marked" : "Mark Attendance";
    btn.disabled = marked;
    btn.classList.toggle("marked", marked);
  }

  setText("overviewAttendance", marked ? "Marked" : "Not Marked");
}

function isMarked(status) {
  const clean = normalize(status);

  return (
    clean === "marked" ||
    clean === "present" ||
    clean === "checked in" ||
    clean === "checked-in"
  );
}

function renderStats(data) {
  setText("todayVisitorsValue", data.visitorsToday);
  setText("parcelsValue", data.parcelsToHandle);
  setText("assignedTasksValue", data.tasksAssigned);
  setText("settlementsValue", data.pendingSettlements);
  setText("notificationCount", data.notificationCount > 99 ? "99+" : data.notificationCount);
}

function renderOverview(data) {
  setText("overviewVisitors", data.visitorsToday);
  setText("overviewParcels", data.parcelsToHandle);
  setText("overviewTasks", data.tasksAssigned);
  setText("overviewSettlements", data.pendingSettlements);
}

function renderCharts(data) {
  renderActivityTrend(data.activityTrend);
  renderBarChart("taskStatusChart", data.taskStatusCounts);
  renderBarChart("parcelStatusChart", data.parcelStatusCounts);
  renderWorkloadDonut(data);
}

function renderActivityTrend(points) {
  const container = $("activityTrendChart");
  if (!container) return;

  const hasData = points.some((item) => item.visitors > 0 || item.parcels > 0 || item.tasks > 0);

  if (!hasData) {
    container.innerHTML = `<div class="empty-chart">No recent activity. Activity chart will appear after Firebase data is available.</div>`;
    return;
  }

  const width = 760;
  const height = 238;
  const pad = 36;

  const allValues = [
    ...points.map((p) => p.visitors),
    ...points.map((p) => p.parcels),
    ...points.map((p) => p.tasks),
    1
  ];

  const max = Math.max(...allValues);

  function lineFor(key, color) {
    const coords = points.map((point, index) => {
      const x = pad + (index / Math.max(points.length - 1, 1)) * (width - pad * 2);
      const y = height - pad - (Number(point[key] || 0) / max) * (height - pad * 2);
      return { x, y };
    });

    return `
      <polyline
        fill="none"
        stroke="${color}"
        stroke-width="3"
        stroke-linecap="round"
        stroke-linejoin="round"
        points="${coords.map((p) => `${p.x},${p.y}`).join(" ")}"
      ></polyline>
      ${coords.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="${color}"></circle>`).join("")}
    `;
  }

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      ${[0, 1, 2, 3, 4].map((line) => {
        const y = pad + line * ((height - pad * 2) / 4);
        return `<line x1="${pad}" y1="${y}" x2="${width - pad}" y2="${y}" stroke="rgba(6,27,50,.10)" stroke-width="1"></line>`;
      }).join("")}

      ${lineFor("visitors", COLORS.orange)}
      ${lineFor("parcels", COLORS.green)}
      ${lineFor("tasks", COLORS.blue)}

      ${points.map((point, index) => {
        const x = pad + (index / Math.max(points.length - 1, 1)) * (width - pad * 2);
        return `<text x="${x}" y="${height - 7}" text-anchor="middle" fill="rgba(6,27,50,.58)" font-size="10" font-weight="800">${escapeHtml(point.label)}</text>`;
      }).join("")}
    </svg>
  `;
}

function renderBarChart(id, values) {
  const container = $(id);
  if (!container) return;

  const entries = Object.entries(values || {})
    .filter(([, value]) => Number(value) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]));

  if (!entries.length) {
    container.innerHTML = `<div class="empty-chart">No chart data yet.</div>`;
    return;
  }

  const max = Math.max(...entries.map(([, value]) => Number(value)), 1);

  container.innerHTML = entries.slice(0, 6).map(([label, value], index) => {
    const colors = [COLORS.blue, COLORS.green, COLORS.orange, COLORS.red, COLORS.purple, COLORS.gold];
    const color = colors[index % colors.length];
    const width = Math.max(5, Math.round((Number(value) / max) * 100));

    return `
      <div class="bar-row">
        <div class="bar-head">
          <span>${escapeHtml(label)}</span>
          <strong>${value}</strong>
        </div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${width}%;background:${color};"></div>
        </div>
      </div>
    `;
  }).join("");
}

function renderWorkloadDonut(data) {
  const donut = $("workloadDonut");
  const legend = $("workloadLegend");

  if (!donut || !legend) return;

  const values = [
    { label: "Visitors", value: data.visitorsToday, color: COLORS.orange },
    { label: "Parcels", value: data.parcelsToHandle, color: COLORS.green },
    { label: "Tasks", value: data.tasksAssigned, color: COLORS.blue },
    { label: "Settlements", value: data.pendingSettlements, color: COLORS.red }
  ];

  const total = values.reduce((sum, item) => sum + Number(item.value || 0), 0);

  setText("workloadTotal", total);

  if (total <= 0) {
    donut.style.background = `conic-gradient(rgba(182,139,45,.12) 0deg 360deg)`;
    legend.innerHTML = `<div class="empty-chart">No workload yet.</div>`;
    return;
  }

  let start = 0;

  const stops = values.map((item) => {
    if (!item.value) return "";
    const end = start + (item.value / total) * 360;
    const stop = `${item.color} ${start}deg ${end}deg`;
    start = end;
    return stop;
  }).filter(Boolean);

  donut.style.background = `conic-gradient(${stops.join(", ")})`;

  legend.innerHTML = values.map((item) => {
    return `
      <div class="donut-legend-row">
        <span><i class="legend-dot" style="background:${item.color};"></i>${escapeHtml(item.label)}</span>
        <strong>${item.value}</strong>
      </div>
    `;
  }).join("");
}

function renderAnnouncements(data) {
  const container = $("announcementList");
  if (!container) return;

  if (!data.announcements.length) {
    container.innerHTML = `<div class="empty-box">No announcements yet. Announcements added by admin will appear here.</div>`;
    return;
  }

  container.innerHTML = data.announcements.map((item) => {
    return `
      <div class="announcement-item">
        <span class="announcement-dot"></span>

        <div>
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.message)}</p>
        </div>

        <small>${escapeHtml(formatDate(item.createdAt))}</small>
      </div>
    `;
  }).join("");
}

function renderTasks(data) {
  const container = $("taskList");
  if (!container) return;

  const total = data.tasks.length;
  const completed = data.tasks.filter((task) => normalize(task.status).includes("completed")).length;
  const pending = Math.max(total - completed, 0);

  setText("totalTasksBottom", total);
  setText("completedTasksBottom", completed);
  setText("pendingTasksBottom", pending);

  if (!data.tasks.length) {
    container.innerHTML = `<div class="empty-box">No tasks assigned. Tasks assigned by admin will appear here.</div>`;
    return;
  }

  container.innerHTML = data.tasks.slice(0, 6).map((task) => {
    const clean = normalize(task.status);
    let className = "pending";
    let label = task.status || "Pending";

    if (clean.includes("progress")) className = "progress";
    if (clean.includes("completed") || clean.includes("resolved")) className = "completed";

    return `
      <div class="task-item">
        <button class="task-check clickable" type="button" title="Mark completed" data-complete-task="${escapeHtml(task.collection)}:${escapeHtml(task.id)}"></button>

        <div>
          <strong>${escapeHtml(task.title)}</strong>
          <p>${escapeHtml(task.description)}</p>
        </div>

        <span class="task-status ${className}">
          ${escapeHtml(label)}
        </span>
      </div>
    `;
  }).join("");
}

function renderParcelPreview(data) {
  const section = $("parcelPreviewSection");
  const list = $("parcelPreviewList");

  if (!section || !list) return;

  if (!data.parcels.length) {
    section.hidden = true;
    list.innerHTML = "";
    return;
  }

  section.hidden = false;

  list.innerHTML = data.parcels.slice(0, 5).map((parcel) => {
    return `
      <div class="parcel-row">
        <div>
          <strong>${escapeHtml(parcel.trackingId)}</strong>
          <p>${escapeHtml(parcel.resident)} • ${escapeHtml(parcel.courier)} • ${escapeHtml(parcel.status)}</p>
        </div>

        <button type="button" data-parcel-status="${escapeHtml(parcel.id)}:Received By Staff">
          Received
        </button>

        <button type="button" data-parcel-status="${escapeHtml(parcel.id)}:Handed Over To Resident">
          Handed Over
        </button>
      </div>
    `;
  }).join("");
}

function renderNotifications(data) {
  const list = $("notificationList");
  if (!list) return;

  if (!data.notifications.length) {
    list.innerHTML = `<div class="empty-box">No activity updates. New activities from Firebase will appear here automatically.</div>`;
    return;
  }

  list.innerHTML = data.notifications.map((item) => {
    const color = activityColor(item.type);

    return `
      <div class="notification-item" style="background:${color}0f;border-color:${color}22;">
        <div class="notification-icon" style="background:${color}1f;color:${color};">
          <i class="${activityIcon(item.type)}"></i>
        </div>

        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
            <strong>${escapeHtml(item.title)}</strong>
            <small>${escapeHtml(timeAgo(item.createdAt))}</small>
          </div>
          <p>${escapeHtml(item.message)}</p>
        </div>
      </div>
    `;
  }).join("");
}

/* CLOCK */

function setupClock() {
  function updateDateTime() {
    const now = new Date();

    setText("greetingText", greetingForTime(now));

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

function greetingForTime(date) {
  const hour = date.getHours();

  if (hour >= 5 && hour < 12) return "Good Morning";
  if (hour >= 12 && hour < 17) return "Good Afternoon";
  if (hour >= 17 && hour < 21) return "Good Evening";

  return "Good Night";
}

/* ACTIONS */

async function markAttendanceQuick() {
  const data = state.currentData || buildDashboardData();

  if (!data.uid) {
    showToast("No logged-in staff found.", "error");
    return;
  }

  if (isMarked(data.attendanceStatus)) return;

  const today = new Date();
  const attendanceId = `${data.uid}_${today.getFullYear()}_${today.getMonth() + 1}_${today.getDate()}`;

  try {
    const btn = $("quickMarkAttendanceBtn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Saving...";
    }

    await setDoc(
      doc(db, COLLECTIONS.staffAttendance, attendanceId),
      {
        staffId: data.uid,
        staffName: data.staffName,
        propertyId: data.propertyId,
        propertyName: data.propertyName,
        propertyAddress: data.propertyAddress,
        shiftName: data.shiftName,
        shiftStart: data.shiftStart,
        shiftEnd: data.shiftEnd,
        breakTime: data.breakTime,
        status: "Marked",
        attendanceStatus: "Marked",
        date: new Date(today.getFullYear(), today.getMonth(), today.getDate()),
        checkInAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    showToast("Attendance marked successfully.");
  } catch (error) {
    console.error("Attendance failed:", error);
    showToast(`Attendance could not be marked: ${error.message}`, "error");
  } finally {
    const btn = $("quickMarkAttendanceBtn");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Mark Attendance";
    }
  }
}

async function updateTaskStatus(collectionName, taskId, status) {
  try {
    await setDoc(
      doc(db, collectionName, taskId),
      {
        status,
        taskStatus: status,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    showToast("Task updated successfully.");
  } catch (error) {
    console.error("Task update failed:", error);
    showToast(`Task update failed: ${error.message}`, "error");
  }
}

async function updateParcelStatus(parcelId, status) {
  try {
    await setDoc(
      doc(db, COLLECTIONS.parcels, parcelId),
      {
        status,
        parcelStatus: status,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    showToast("Parcel updated successfully.");
  } catch (error) {
    console.error("Parcel update failed:", error);
    showToast(`Parcel update failed: ${error.message}`, "error");
  }
}

function extractCheckInCode(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";

  try {
    const decoded = JSON.parse(value);

    if (decoded && typeof decoded === "object") {
      return firstNonEmpty([
        decoded.checkInCode,
        decoded.bookingCode,
        decoded.residentCode,
        decoded.code,
        decoded.id
      ]);
    }
  } catch (_) {}

  try {
    const uri = new URL(value);

    return firstNonEmpty([
      uri.searchParams.get("checkInCode"),
      uri.searchParams.get("bookingCode"),
      uri.searchParams.get("residentCode"),
      uri.searchParams.get("code"),
      uri.searchParams.get("id")
    ], value);
  } catch (_) {}

  return value;
}

async function findDocByCode(collectionName, code, fields) {
  try {
    const direct = await getDoc(doc(db, collectionName, code));

    if (direct.exists()) {
      return {
        id: direct.id,
        ref: direct.ref,
        data: direct.data()
      };
    }
  } catch (_) {}

  for (const field of fields) {
    try {
      const snap = await getDocs(
        query(
          collection(db, collectionName),
          where(field, "==", code),
          limit(1)
        )
      );

      if (!snap.empty) {
        const item = snap.docs[0];

        return {
          id: item.id,
          ref: item.ref,
          data: item.data()
        };
      }
    } catch (_) {}
  }

  return null;
}

async function checkInResidentByCode(rawCode) {
  const data = state.currentData || buildDashboardData();
  const code = extractCheckInCode(rawCode);

  if (!code) {
    showToast("Enter or scan a valid check-in code.", "error");
    return;
  }

  try {
    setCheckInLoading(true);

    const bookingDoc = await findDocByCode(
      COLLECTIONS.bookings,
      code,
      [
        "checkInCode",
        "qrCode",
        "bookingCode",
        "bookingNo",
        "bookingId",
        "reservationCode"
      ]
    );

    const residentDoc = await findDocByCode(
      COLLECTIONS.residents,
      code,
      [
        "checkInCode",
        "qrCode",
        "residentCode",
        "residentNo",
        "residentId",
        "bookingCode"
      ]
    );

    if (!bookingDoc && !residentDoc) {
      showToast("No booking or resident found for this code.", "error");
      return;
    }

    const batch = writeBatch(db);

    let residentId = "";
    let residentName = "";
    let propertyId = data.propertyId;
    let propertyName = data.propertyName;

    if (bookingDoc) {
      const booking = bookingDoc.data;

      residentId = firstNonEmpty([
        booking.residentId,
        booking.userId
      ]);

      residentName = firstNonEmpty([
        booking.residentName,
        booking.name,
        booking.guestName
      ]);

      propertyId = firstNonEmpty([
        booking.propertyId,
        booking.property_id,
        propertyId
      ]);

      propertyName = firstNonEmpty([
        booking.propertyName,
        booking.property,
        propertyName
      ]);

      batch.set(
        bookingDoc.ref,
        {
          status: "Checked In",
          bookingStatus: "Checked In",
          checkInStatus: "Checked In",
          checkedInAt: serverTimestamp(),
          checkedInByStaffId: data.uid,
          checkedInByStaffName: data.staffName,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    }

    if (residentDoc) {
      const resident = residentDoc.data;

      residentId = firstNonEmpty([
        residentDoc.id,
        residentId
      ]);

      residentName = firstNonEmpty([
        resident.residentName,
        resident.name,
        resident.fullName,
        residentName
      ]);

      propertyId = firstNonEmpty([
        resident.propertyId,
        resident.property_id,
        propertyId
      ]);

      propertyName = firstNonEmpty([
        resident.propertyName,
        resident.property,
        propertyName
      ]);

      batch.set(
        residentDoc.ref,
        {
          status: "Active",
          residentStatus: "Active",
          stayStatus: "Active",
          checkInStatus: "Checked In",
          checkedInAt: serverTimestamp(),
          checkedInByStaffId: data.uid,
          checkedInByStaffName: data.staffName,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    } else if (residentId) {
      batch.set(
        doc(db, COLLECTIONS.residents, residentId),
        {
          status: "Active",
          residentStatus: "Active",
          stayStatus: "Active",
          checkInStatus: "Checked In",
          checkedInAt: serverTimestamp(),
          checkedInByStaffId: data.uid,
          checkedInByStaffName: data.staffName,
          propertyId,
          propertyName,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    }

    batch.set(
      doc(collection(db, COLLECTIONS.activityLogs)),
      {
        type: "resident_check_in",
        code,
        residentId,
        residentName,
        propertyId,
        propertyName,
        staffId: data.uid,
        staffName: data.staffName,
        createdAt: serverTimestamp()
      }
    );

    await batch.commit();

    const input = $("residentCheckInCode");
    if (input) input.value = "";

    showToast(
      residentName
        ? `${residentName} checked in successfully.`
        : "Check-in completed successfully."
    );
  } catch (error) {
    console.error("Check-in failed:", error);
    showToast(`Check-in failed: ${error.message}`, "error");
  } finally {
    setCheckInLoading(false);
  }
}

function setCheckInLoading(loading) {
  const btn = $("checkInResidentBtn");
  if (!btn) return;

  btn.disabled = loading;
  btn.innerHTML = loading
    ? `<i class="fa-solid fa-spinner fa-spin"></i> Checking...`
    : `Check-In <i class="fa-solid fa-chevron-right"></i>`;
}

async function changePassword(event) {
  event.preventDefault();

  const newPassword = String($("newPasswordInput")?.value || "").trim();
  const confirmPassword = String($("confirmNewPasswordInput")?.value || "").trim();

  if (!auth.currentUser) {
    showToast("No Firebase Auth user found. Please login again.", "error");
    return;
  }

  if (!newPassword || newPassword.length < 6) {
    showToast("Password must be at least 6 characters.", "error");
    return;
  }

  if (newPassword !== confirmPassword) {
    showToast("Passwords do not match.", "error");
    return;
  }

  try {
    const btn = $("savePasswordBtn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Updating...";
    }

    await updatePassword(auth.currentUser, newPassword);

    $("changePasswordForm")?.reset();
    closeModal("changePasswordModal");
    showToast("Password changed successfully.");
  } catch (error) {
    console.error("Password change failed:", error);

    let message = error.message || "Password change failed.";

    if (error.code === "auth/requires-recent-login") {
      message = "For security, please logout and login again, then change password.";
    }

    showToast(message, "error");
  } finally {
    const btn = $("savePasswordBtn");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Update Password";
    }
  }
}

/* QR SCANNER */

async function openQrScanner() {
  if (!("BarcodeDetector" in window)) {
    showToast("QR scanning is not supported in this browser. Please enter the code manually.", "error");
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

          if ($("residentCheckInCode")) {
            $("residentCheckInCode").value = value;
          }

          await checkInResidentByCode(value);
        }
      } catch (_) {}
    }, 700);
  } catch (error) {
    console.error("QR scanner failed:", error);
    stopQrScanner();
    closeModal("qrScannerModal");
    showToast("Camera permission failed. Please enter the code manually.", "error");
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

function markNotificationsRead() {
  const data = state.currentData || buildDashboardData();

  data.notifications.forEach((item) => {
    if (item.readKey) {
      state.readNotificationKeys.add(item.readKey);
    }
  });

  saveReadNotificationKeys();
  renderPage();
  showToast("Notifications marked as read.");
}

/* EVENTS */

function setupEvents() {
  $("sidebarLogoutBtn")?.addEventListener("click", doLogout);
  $("logoutBtn")?.addEventListener("click", doLogout);

  $("quickMarkAttendanceBtn")?.addEventListener("click", markAttendanceQuick);

  $("checkInResidentBtn")?.addEventListener("click", () => {
    const code = $("residentCheckInCode")?.value || "";
    checkInResidentByCode(code);
  });

  $("residentCheckInCode")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      checkInResidentByCode(event.target.value);
    }
  });

  $("scanQrBtn")?.addEventListener("click", openQrScanner);

  $("notificationBtn")?.addEventListener("click", () => {
    openModal("notificationModal");
  });

  $("markNotificationsReadBtn")?.addEventListener("click", markNotificationsRead);

  $("changePasswordBtn")?.addEventListener("click", () => {
    $("profileDropdown")?.classList.remove("show");
    openModal("changePasswordModal");
  });

  $("changePasswordForm")?.addEventListener("submit", changePassword);

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

  document.querySelectorAll(".toggle-password").forEach((button) => {
    button.addEventListener("click", () => {
      const input = $(button.dataset.target);
      const icon = button.querySelector("i");

      if (!input) return;

      if (input.type === "password") {
        input.type = "text";
        icon?.classList.remove("fa-eye");
        icon?.classList.add("fa-eye-slash");
      } else {
        input.type = "password";
        icon?.classList.remove("fa-eye-slash");
        icon?.classList.add("fa-eye");
      }
    });
  });

  document.addEventListener("click", async (event) => {
    const completeTaskBtn = event.target.closest("[data-complete-task]");

    if (completeTaskBtn) {
      const [collectionName, taskId] = completeTaskBtn.dataset.completeTask.split(":");
      await updateTaskStatus(collectionName, taskId, "Completed");
      return;
    }

    const parcelBtn = event.target.closest("[data-parcel-status]");

    if (parcelBtn) {
      const [parcelId, status] = parcelBtn.dataset.parcelStatus.split(":");
      await updateParcelStatus(parcelId, status);
    }
  });
}

/* INIT */

document.addEventListener("DOMContentLoaded", () => {
  setupLayout();
  setupClock();
  setupEvents();
  setupAuth();
});