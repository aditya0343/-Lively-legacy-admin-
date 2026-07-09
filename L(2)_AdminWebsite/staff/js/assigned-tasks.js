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

import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-storage.js";

const $ = (id) => document.getElementById(id);
const storage = getStorage();

const COLLECTIONS = {
  users: "users",
  staff: "staff",
  staffLoginAccounts: "staff_login_accounts",
  properties: "properties",
  tasks: "tasks",
  staffTasks: "staffTasks",
  complaints: "complaints",
  notifications: "notifications",
  activityLogs: "activity_logs"
};

const COLORS = {
  blue: "#2563eb",
  orange: "#f97316",
  green: "#22a55a",
  purple: "#7c3aed",
  red: "#ef4444",
  navy: "#08233f",
  gold: "#d09112"
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
  activeTab: "all",
  filter: "All Tasks",
  search: "",
  selectedTaskKey: "",

  userData: null,
  staffRecord: null,
  loginRecord: null,
  propertyRecord: null,

  tasks: [],
  staffTasks: [],
  complaints: [],
  notifications: [],
  activityLogs: [],

  selectedFiles: [],
  readNotificationKeys: new Set(),
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

function arrayText(data, keys) {
  for (const key of keys) {
    const value = data?.[key];

    if (Array.isArray(value)) {
      return value
        .map((item) => String(item || "").trim())
        .filter(Boolean);
    }

    if (typeof value === "string" && value.trim()) {
      return [value.trim()];
    }
  }

  return [];
}

function imageUrlList(data) {
  const urls = [];

  const pushValue = (value) => {
    if (!value) return;

    if (typeof value === "string" && value.trim()) {
      urls.push(value.trim());
      return;
    }

    if (typeof value === "object") {
      const url = firstText([value.url, value.downloadURL, value.src, value.dataUrl], "");
      if (url) urls.push(url);
    }
  };

  ["completionImages", "completionImageUrls", "images", "imageUrls"].forEach((key) => {
    const value = data?.[key];

    if (Array.isArray(value)) {
      value.forEach(pushValue);
    } else {
      pushValue(value);
    }
  });

  return [...new Set(urls)];
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
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;

  return formatDateTime(date);
}

function twoDigits(value) {
  return String(value).padStart(2, "0");
}

function getInitials(nameOrEmail) {
  const text = String(nameOrEmail || "ST").trim();

  if (text.includes("@")) return text.slice(0, 2).toUpperCase();

  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function cleanLabel(value, fallback = "Pending") {
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
  return `staff_task_read_notification_keys_${session.uid || "guest"}`;
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

/* PROFILE DATA */

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
    console.error("Assigned tasks init failed:", error);
    showToast(`Assigned tasks failed: ${error.message}`, "error");
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
  ], "");
}

function renderProfileShell() {
  const staffName = getStaffName();
  const email = session.email || "staff@email.com";
  const initials = getInitials(staffName || email);
  const propertyName = getPropertyName();

  setText("staffNameTop", staffName);
  setText("staffEmailTop", email);
  setText("staffAvatarText", initials);
  setText("topPropertyText", propertyName || "View admin assigned tasks and update their status.");
}

/* TASK HELPERS */

function taskFromDoc(item, collectionName) {
  const title = firstText([
    item.title,
    item.taskTitle,
    item.issueTitle,
    item.complaintTitle,
    item.name
  ], collectionName === COLLECTIONS.complaints ? "Complaint Task" : "Assigned Task");

  const status = firstText([
    item.status,
    item.taskStatus,
    item.complaintStatus,
    item.completionStatus
  ], "Pending");

  return {
    ...item,
    collection: collectionName,
    sourceCollection: collectionName,
    sourceType: collectionName === COLLECTIONS.complaints ? "complaint" : "task",
    taskNo: firstText([
      item.taskNo,
      item.taskId,
      item.taskCode,
      item.ticketId,
      item.complaintNo,
      item.complaintId,
      item.id
    ], item.id),
    title,
    description: firstText([
      item.description,
      item.details,
      item.note,
      item.message,
      item.taskDescription,
      item.issueDescription,
      item.notes
    ], "Task details not available."),
    status,
    priority: firstText([
      item.priority,
      item.taskPriority,
      item.severity
    ], "Medium"),
    location: firstText([
      item.location,
      item.roomNo,
      item.roomNumber,
      item.unit,
      item.area,
      item.propertyName,
      item.property
    ], "-"),
    assignedBy: firstText([
      item.assignedByName,
      item.assignedBy,
      item.createdByName,
      item.createdBy,
      "Admin"
    ], "Admin"),
    assignedOn: item.assignedAt || item.assignedOn || item.createdAt || item.requestedAt,
    dueAt: item.dueAt || item.dueDate || item.dueDateTime || item.deadline || item.expectedResolutionAt,
    createdAt: item.createdAt || item.requestedAt,
    completionImageUrls: imageUrlList(item)
  };
}

function taskKey(task) {
  return `${task.collection}_${task.id}`;
}

function allTaskRecords() {
  const list = [
    ...state.tasks.map((task) => taskFromDoc(task, COLLECTIONS.tasks)),
    ...state.staffTasks.map((task) => taskFromDoc(task, COLLECTIONS.staffTasks)),
    ...state.complaints.map((task) => taskFromDoc(task, COLLECTIONS.complaints))
  ];

  const seen = new Set();
  const filtered = [];

  list.forEach((task) => {
    const key = `${task.collection}_${task.id}`;
    if (seen.has(key)) return;

    seen.add(key);
    filtered.push(task);
  });

  return filtered.filter(taskBelongsToStaff).sort((a, b) => {
    const dateA = toDate(a.assignedOn || a.createdAt)?.getTime() || 0;
    const dateB = toDate(b.assignedOn || b.createdAt)?.getTime() || 0;

    return dateB - dateA;
  });
}

function taskBelongsToStaff(task) {
  const uid = session.uid;
  const staffId = getStaffId();
  const email = normalize(session.email);
  const propertyId = getPropertyId();
  const propertyName = getPropertyName();

  const assignedIds = [
    task.assignedStaffId,
    task.assignedStaffUID,
    task.assignedStaffUid,
    task.assignedToId,
    task.assignedTo,
    task.assignedUserId,
    task.staffId,
    task.userId,
    ...arrayText(task, ["assignedStaffIds", "assignedStaffIdList", "staffIds"]),
    ...arrayText(task, ["assignedToIds", "assignedUsers", "assignedUserIds"])
  ].map((item) => String(item || "").trim()).filter(Boolean);

  const assignedEmails = [
    task.assignedStaffEmail,
    task.staffEmail,
    task.assignedToEmail,
    task.assignedEmail,
    task.userEmail,
    task.email,
    ...arrayText(task, ["assignedStaffEmails", "staffEmails"]),
    ...arrayText(task, ["assignedToEmails", "assignedEmails"])
  ].map((item) => normalize(item)).filter(Boolean);

  const taskPropertyId = firstText([
    task.propertyId,
    task.property_id,
    task.propertyDocId,
    task.assignedPropertyId
  ], "");

  const taskPropertyName = firstText([
    task.propertyName,
    task.property
  ], "");

  const idMatch = assignedIds.includes(uid) || assignedIds.includes(staffId);
  const emailMatch = email && assignedEmails.includes(email);
  const propertyMatch = propertyId && taskPropertyId && taskPropertyId === propertyId;
  const propertyNameMatch = propertyName && taskPropertyName && taskPropertyName === propertyName;

  return idMatch || emailMatch || propertyMatch || propertyNameMatch;
}

function statusClass(task) {
  const status = normalize(task.status);

  if (status.includes("completed") || status.includes("resolved") || status.includes("closed")) {
    return "completed";
  }

  if (status.includes("progress")) {
    return "in-progress";
  }

  return "pending";
}

function statusLabel(task) {
  const cls = statusClass(task);

  if (cls === "completed") return "Completed";
  if (cls === "in-progress") return "In Progress";

  return "Pending";
}

function priorityClass(task) {
  const priority = normalize(task.priority);

  if (priority.includes("high") || priority.includes("urgent")) return "high";
  if (priority.includes("low")) return "low";

  return "medium";
}

function priorityLabel(task) {
  const priority = priorityClass(task);

  if (priority === "high") return "High";
  if (priority === "low") return "Low";

  return "Medium";
}

function taskSourceLabel(task) {
  return task.collection === COLLECTIONS.complaints ? "Complaint" : "Admin Task";
}

function taskIcon(task) {
  const text = normalize(`${task.title} ${task.description}`);

  if (text.includes("water") || text.includes("leak")) return "fa-solid fa-faucet-drip";
  if (text.includes("garbage") || text.includes("dustbin") || text.includes("waste")) return "fa-solid fa-trash-can";
  if (text.includes("paint")) return "fa-regular fa-clipboard";
  if (text.includes("bulb") || text.includes("light")) return "fa-regular fa-lightbulb";
  if (text.includes("garden") || text.includes("plant")) return "fa-solid fa-seedling";

  return "fa-solid fa-clipboard-check";
}

function taskIconColor(task) {
  const text = normalize(`${task.title} ${task.description}`);

  if (text.includes("water") || text.includes("leak")) return COLORS.blue;
  if (text.includes("garbage") || text.includes("dustbin") || text.includes("waste")) return COLORS.green;
  if (text.includes("paint")) return COLORS.purple;
  if (text.includes("bulb") || text.includes("light")) return COLORS.orange;
  if (text.includes("garden") || text.includes("plant")) return COLORS.green;

  return COLORS.blue;
}

function getVisibleTasks() {
  let records = allTaskRecords();

  if (state.activeTab !== "all") {
    records = records.filter((task) => statusClass(task) === state.activeTab);
  }

  if (state.filter !== "All Tasks") {
    const cleanFilter = normalize(state.filter);

    records = records.filter((task) => {
      if (cleanFilter.includes("priority")) {
        return priorityClass(task) === cleanFilter.replace(" priority", "");
      }

      if (cleanFilter.includes("progress")) return statusClass(task) === "in-progress";
      if (cleanFilter.includes("completed")) return statusClass(task) === "completed";
      if (cleanFilter.includes("pending")) return statusClass(task) === "pending";

      return true;
    });
  }

  if (state.search) {
    records = records.filter((task) => {
      const haystack = [
        task.title,
        task.taskNo,
        task.location,
        task.description,
        task.assignedBy,
        task.priority,
        task.status,
        taskSourceLabel(task)
      ].join(" ");

      return normalize(haystack).includes(state.search);
    });
  }

  return records;
}

function getSelectedTask() {
  return allTaskRecords().find((task) => taskKey(task) === state.selectedTaskKey) || null;
}

/* RENDER */

function renderPage() {
  renderProfileShell();
  renderStats();
  renderCharts();
  renderTaskList();
  renderNotifications();
}

function renderStats() {
  const tasks = allTaskRecords();

  const inProgress = tasks.filter((task) => statusClass(task) === "in-progress");
  const completed = tasks.filter((task) => statusClass(task) === "completed");
  const pending = tasks.filter((task) => statusClass(task) === "pending");

  setText("totalAssignedCount", twoDigits(tasks.length));
  setText("inProgressCount", twoDigits(inProgress.length));
  setText("completedCount", twoDigits(completed.length));
  setText("pendingCount", twoDigits(pending.length));

  setText("allTabCount", `(${tasks.length})`);
  setText("progressTabCount", `(${inProgress.length})`);
  setText("completedTabCount", `(${completed.length})`);
  setText("pendingTabCount", `(${pending.length})`);
}

function renderCharts() {
  const tasks = allTaskRecords();

  renderBarChart("statusChart", countBy(tasks, (task) => cleanLabel(task.status, "Pending")), labelColor);
  renderBarChart("priorityChart", countBy(tasks, (task) => cleanLabel(task.priority, "Medium")), labelColor);
  renderBarChart("sourceChart", countBy(tasks, taskSourceLabel), labelColor);
  renderDailyTrend(tasks);
}

function countBy(list, getter) {
  const result = {};

  list.forEach((item) => {
    const label = getter(item);
    result[label] = (result[label] || 0) + 1;
  });

  return result;
}

function labelColor(label) {
  const clean = normalize(label);

  if (clean.includes("complete") || clean.includes("resolved") || clean.includes("low")) return COLORS.green;
  if (clean.includes("progress") || clean.includes("admin")) return COLORS.blue;
  if (clean.includes("pending") || clean.includes("medium")) return COLORS.orange;
  if (clean.includes("high") || clean.includes("urgent") || clean.includes("complaint")) return COLORS.red;

  return COLORS.purple;
}

function renderBarChart(id, data, colorForLabel) {
  const container = $(id);
  if (!container) return;

  const entries = Object.entries(data || {})
    .filter(([, value]) => Number(value) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]));

  if (!entries.length) {
    container.innerHTML = `<div class="empty-box">No data yet.</div>`;
    return;
  }

  const max = Math.max(...entries.map(([, value]) => Number(value)), 1);

  container.innerHTML = entries.slice(0, 6).map(([label, value]) => {
    const width = Math.max(7, Math.round((Number(value) / max) * 100));
    const color = colorForLabel(label);

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

function renderDailyTrend(tasks) {
  const container = $("dailyTrendChart");
  if (!container) return;

  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  start.setDate(start.getDate() - 6);

  const counts = Array(7).fill(0);

  tasks.forEach((task) => {
    const date = toDate(task.assignedOn || task.createdAt);
    if (!date) return;

    const clean = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diff = Math.round((clean - start) / 86400000);

    if (diff >= 0 && diff < 7) {
      counts[diff] += 1;
    }
  });

  const max = Math.max(...counts, 1);
  const hasData = counts.some((count) => count > 0);

  if (!hasData) {
    container.innerHTML = `<div class="empty-box">No recent task data yet.</div>`;
    return;
  }

  container.innerHTML = counts.map((count, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);

    const height = Math.max(12, Math.round((count / max) * 112));
    const label = isSameDay(date, today)
      ? "Today"
      : date.toLocaleDateString("en-IN", { weekday: "short" });

    return `
      <div class="day-bar">
        <div class="day-value">${count}</div>
        <div class="day-column" style="height:${height}px;"></div>
        <div class="day-label">${escapeHtml(label)}</div>
      </div>
    `;
  }).join("");
}

function taskCard(task) {
  const selected = taskKey(task) === state.selectedTaskKey ? "active" : "";
  const iconColor = taskIconColor(task);

  return `
    <article class="task-item ${selected}" data-task-key="${escapeHtml(taskKey(task))}">
      <span class="task-select-dot"></span>

      <div class="task-icon" style="color:${iconColor};background:${iconColor}20;">
        <i class="${escapeHtml(taskIcon(task))}"></i>
      </div>

      <div class="task-info">
        <strong>${escapeHtml(task.title)}</strong>

        <span>
          <i class="fa-solid fa-location-dot"></i>
          ${escapeHtml(task.location || "-")}
        </span>

        <span>
          <i class="fa-regular fa-calendar"></i>
          ${escapeHtml(formatDateTime(task.assignedOn || task.createdAt))}
        </span>

        <div class="task-meta">
          <span class="status-pill ${statusClass(task)}">
            ${escapeHtml(statusLabel(task))}
          </span>

          <span class="source-pill">
            ${escapeHtml(taskSourceLabel(task))}
          </span>
        </div>
      </div>

      <span class="priority-pill ${priorityClass(task)}">
        ${escapeHtml(priorityLabel(task))}
      </span>
    </article>
  `;
}

function renderTaskList() {
  const container = $("taskList");
  if (!container) return;

  const tasks = getVisibleTasks();

  setText("taskShowingText", tasks.length
    ? `Showing ${tasks.length} of ${allTaskRecords().length} tasks`
    : "No tasks to show"
  );

  if (!tasks.length) {
    container.innerHTML = `<div class="empty-box">No assigned tasks found.</div>`;
    state.selectedTaskKey = "";
    renderTaskDetails(null);
    return;
  }

  if (!state.selectedTaskKey || !tasks.some((task) => taskKey(task) === state.selectedTaskKey)) {
    state.selectedTaskKey = taskKey(tasks[0]);
  }

  container.innerHTML = tasks.map(taskCard).join("");
  renderTaskDetails(getSelectedTask());
}

function existingImageBoxes(task) {
  const existing = task?.completionImageUrls || [];

  return existing.slice(0, 5).map((url) => `
    <div class="preview-box">
      <img src="${escapeHtml(url)}" alt="Completion image" />
    </div>
  `).join("");
}

function selectedImageBoxes() {
  return state.selectedFiles.map((item, index) => `
    <div class="preview-box">
      <img src="${escapeHtml(item.previewUrl)}" alt="${escapeHtml(item.file.name)}" />
      <button type="button" class="preview-remove" data-remove-image="${index}">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
  `).join("");
}

function renderTaskDetails(task) {
  const container = $("taskDetailsContent");
  if (!container) return;

  state.selectedFiles.forEach((item) => {
    try {
      URL.revokeObjectURL(item.previewUrl);
    } catch (_) {}
  });
  state.selectedFiles = [];

  if (!task) {
    container.innerHTML = `<div class="empty-box details-empty">Select a task to view details.</div>`;
    return;
  }

  const completed = statusClass(task) === "completed";

  container.innerHTML = `
    <div class="task-id-badge">
      Task ID: ${escapeHtml(task.taskNo)}
    </div>

    <div class="detail-title-row">
      <h3>${escapeHtml(task.title)}</h3>

      <span class="status-pill ${statusClass(task)}">
        ${escapeHtml(statusLabel(task))}
      </span>
    </div>

    <div class="detail-grid">
      <div class="detail-row">
        <span><i class="fa-solid fa-location-dot"></i> Location</span>
        <strong>${escapeHtml(task.location || "-")}</strong>
      </div>

      <div class="detail-row">
        <span><i class="fa-solid fa-fire"></i> Priority</span>
        <strong>
          <span class="priority-pill ${priorityClass(task)}">
            ${escapeHtml(priorityLabel(task))}
          </span>
        </strong>
      </div>

      <div class="detail-row">
        <span><i class="fa-regular fa-calendar"></i> Assigned On</span>
        <strong>${escapeHtml(formatDateTime(task.assignedOn || task.createdAt))}</strong>
      </div>

      <div class="detail-row">
        <span><i class="fa-regular fa-calendar-check"></i> Due Date & Time</span>
        <strong>${escapeHtml(formatDateTime(task.dueAt))}</strong>
      </div>

      <div class="detail-row">
        <span><i class="fa-solid fa-user"></i> Assigned By</span>
        <strong>${escapeHtml(task.assignedBy || "Admin")}</strong>
      </div>

      <div class="detail-row">
        <span><i class="fa-solid fa-layer-group"></i> Source</span>
        <strong>${escapeHtml(taskSourceLabel(task))}</strong>
      </div>
    </div>

    <div class="description-box">
      ${escapeHtml(task.description || "No description available.")}
    </div>

    <div class="upload-section">
      <h4>Upload Images (Optional)</h4>

      <div class="upload-drop">
        <i class="fa-solid fa-cloud-arrow-up"></i>
        <span>Upload completion proof images</span>

        <label for="taskImagesInput">Choose Files</label>
        <input type="file" id="taskImagesInput" accept="image/*" multiple ${completed ? "disabled" : ""} />

        <small>JPG, PNG up to 5MB each. You can upload up to 5 images.</small>
      </div>

      <div class="selected-images-grid" id="selectedImagesGrid">
        ${existingImageBoxes(task)}
        <div class="preview-box empty">
          <i class="fa-solid fa-plus"></i>
        </div>
      </div>
    </div>

    <div class="remarks-section">
      <h4>Remarks (Optional)</h4>

      <textarea
        id="completionRemarks"
        maxlength="250"
        placeholder="Add any remarks about the work done..."
        ${completed ? "disabled" : ""}
      >${escapeHtml(task.completionRemarks || task.remarks || "")}</textarea>

      <div class="remarks-count">
        <span id="remarksCount">0</span>/250
      </div>
    </div>

    <button type="button" class="complete-btn" id="completeTaskBtn" ${completed ? "disabled" : ""}>
      <i class="fa-regular fa-circle-check"></i>
      ${completed ? "Already Completed" : "Mark as Complete"}
    </button>
  `;

  setupDetailsEvents(task);
}

function renderSelectedImages(task) {
  const grid = $("selectedImagesGrid");
  if (!grid) return;

  const existing = existingImageBoxes(task);
  const selected = selectedImageBoxes();
  const total = (task?.completionImageUrls?.length || 0) + state.selectedFiles.length;

  grid.innerHTML = `
    ${existing}
    ${selected}
    ${total < 5 ? `
      <div class="preview-box empty">
        <i class="fa-solid fa-plus"></i>
      </div>
    ` : ""}
  `;
}

function setupDetailsEvents(task) {
  const input = $("taskImagesInput");
  const remarks = $("completionRemarks");
  const completeBtn = $("completeTaskBtn");

  if (remarks) {
    setText("remarksCount", String(remarks.value.length));

    remarks.addEventListener("input", () => {
      setText("remarksCount", String(remarks.value.length));
    });
  }

  input?.addEventListener("change", (event) => {
    const existingCount = task.completionImageUrls?.length || 0;
    const remainingSlots = Math.max(0, 5 - existingCount - state.selectedFiles.length);

    if (remainingSlots <= 0) {
      showToast("You can upload up to 5 images.", "error");
      input.value = "";
      return;
    }

    const files = Array.from(event.target.files || []).slice(0, remainingSlots);

    files.forEach((file) => {
      if (!file.type.startsWith("image/")) {
        showToast(`${file.name} is not an image.`, "error");
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        showToast(`${file.name} is above 5 MB.`, "error");
        return;
      }

      state.selectedFiles.push({
        file,
        previewUrl: URL.createObjectURL(file)
      });
    });

    input.value = "";
    renderSelectedImages(task);
  });

  completeBtn?.addEventListener("click", async () => {
    await markTaskComplete(task);
  });
}

/* NOTIFICATIONS */

function notificationIcon(action) {
  const clean = normalize(action);

  if (clean.includes("complete") || clean.includes("resolved")) return "fa-regular fa-circle-check";
  if (clean.includes("image") || clean.includes("upload")) return "fa-regular fa-image";
  if (clean.includes("assign")) return "fa-solid fa-clipboard-list";
  if (clean.includes("progress")) return "fa-regular fa-clock";

  return "fa-regular fa-bell";
}

function notificationColor(action) {
  const clean = normalize(action);

  if (clean.includes("complete") || clean.includes("resolved")) return COLORS.green;
  if (clean.includes("image") || clean.includes("upload")) return COLORS.purple;
  if (clean.includes("assign")) return COLORS.blue;
  if (clean.includes("progress")) return COLORS.orange;

  return COLORS.navy;
}

function notificationBelongsToStaff(item) {
  const module = normalize(firstText([item.module], ""));
  const target = normalize(firstText([item.target, item.targetRole], ""));
  const uid = session.uid;
  const email = normalize(session.email);
  const propertyId = getPropertyId();
  const propertyName = getPropertyName();

  const moduleMatch =
    !module ||
    module === "tasks" ||
    module === "complaints" ||
    module === "assigned_tasks";

  const targetMatch =
    !target ||
    target === "staff" ||
    target === "all" ||
    target === "user";

  const targetStaffId = firstText([
    item.targetStaffId,
    item.staffId,
    item.assignedStaffId
  ], "");

  const targetEmail = normalize(firstText([
    item.targetStaffEmail,
    item.staffEmail,
    item.email
  ], ""));

  const itemPropertyId = firstText([item.propertyId, item.property_id], "");
  const itemPropertyName = firstText([item.propertyName, item.property], "");

  const staffMatch =
    targetStaffId === uid ||
    (email && targetEmail === email) ||
    (propertyId && itemPropertyId === propertyId) ||
    (propertyName && itemPropertyName === propertyName);

  return moduleMatch && (staffMatch || targetMatch);
}

function generatedTaskNotifications() {
  return allTaskRecords().slice(0, 30).map((task) => {
    const completed = statusClass(task) === "completed";
    const createdAt = toDate(task.assignedOn || task.createdAt) || new Date();

    return {
      readKey: `tasks|${completed ? "task_completed" : "task_assigned"}|${task.collection}_${task.id}|${createdAt.getTime()}`,
      title: completed ? "Task Completed" : "Task Assigned",
      message: `${task.title} • ${statusLabel(task)}`,
      action: completed ? "task_completed" : "task_assigned",
      createdAt,
      read: completed
    };
  });
}

function fetchedTaskNotifications() {
  const records = [
    ...state.notifications.map((item) => ({ ...item, collection: COLLECTIONS.notifications })),
    ...state.activityLogs.map((item) => ({ ...item, collection: COLLECTIONS.activityLogs }))
  ];

  return records
    .filter(notificationBelongsToStaff)
    .map((item) => {
      const action = firstText([item.action, item.type, item.event], "task_update");
      const createdAt = toDate(item.createdAt || item.updatedAt || item.timestamp) || new Date();

      return {
        readKey: `${item.collection}|${action}|${item.id}|${createdAt.getTime()}`,
        title: firstText([item.title], item.collection === COLLECTIONS.activityLogs ? "Task Activity" : "Task Notification"),
        message: firstText([item.message, item.description, item.details, item.taskTitle], "Task update available."),
        action,
        createdAt,
        read: item.read === true || item.isRead === true
      };
    });
}

function rawNotifications() {
  const combined = [
    ...generatedTaskNotifications(),
    ...fetchedTaskNotifications()
  ].sort((a, b) => {
    return (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0);
  });

  const seen = new Set();
  const unique = [];

  combined.forEach((item) => {
    const key = `${item.title}|${item.message}|${item.action}`;
    if (seen.has(key)) return;

    seen.add(key);
    unique.push(item);
  });

  return unique.slice(0, 40);
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
    list.innerHTML = `<div class="empty-box">No unread task notifications.</div>`;
    return;
  }

  list.innerHTML = notifications.map((item) => {
    const color = notificationColor(item.action);

    return `
      <div class="notification-item">
        <div class="notification-item-icon" style="color:${color};background:${color}18;">
          <i class="${escapeHtml(notificationIcon(item.action))}"></i>
        </div>

        <div>
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.message)}</p>
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

/* FIREBASE ACTIONS */

async function uploadCompletionImages(task) {
  const uploadedUrls = [];

  for (const item of state.selectedFiles) {
    const file = item.file;
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `task_completion_images/${task.id}/${Date.now()}_${safeName}`;
    const ref = storageRef(storage, path);

    await uploadBytes(ref, file, {
      contentType: file.type || "image/jpeg"
    });

    uploadedUrls.push(await getDownloadURL(ref));
  }

  return uploadedUrls;
}

async function createTaskEvent(task, action, title, message, extra = {}) {
  const now = serverTimestamp();

  const targetStaffId = firstText([
    task.assignedStaffId,
    task.assignedToId,
    task.staffId,
    session.uid
  ], session.uid);

  const targetStaffEmail = firstText([
    task.assignedStaffEmail,
    task.assignedToEmail,
    task.staffEmail,
    session.email
  ], session.email);

  const payload = {
    module: "tasks",
    type: "task_action",
    action,
    title,
    message,
    taskId: task.id,
    taskNo: task.taskNo,
    taskTitle: task.title,
    taskCollection: task.collection,
    status: task.status,
    priority: task.priority,
    target: "staff",
    visibleToStaff: true,
    visibleToAdmin: true,
    targetStaffId,
    targetStaffEmail,
    propertyId: firstText([task.propertyId, task.property_id], getPropertyId()),
    propertyName: firstText([task.propertyName, task.property], getPropertyName()),
    staffId: session.uid,
    staffEmail: session.email,
    read: false,
    isRead: false,
    createdAt: now,
    updatedAt: now,
    ...extra
  };

  const batch = writeBatch(db);

  batch.set(doc(collection(db, COLLECTIONS.notifications)), payload);
  batch.set(doc(collection(db, COLLECTIONS.activityLogs)), {
    ...payload,
    event: action,
    source: "staff_assigned_tasks_screen",
    logType: "task_activity"
  });

  await batch.commit();
}

async function markTaskComplete(task) {
  if (!task || state.loading) return;

  const btn = $("completeTaskBtn");
  const remarks = $("completionRemarks")?.value.trim() || "";

  state.loading = true;

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
  }

  try {
    const uploadedUrls = await uploadCompletionImages(task);
    const mergedImages = [...(task.completionImageUrls || []), ...uploadedUrls];

    const updateData = {
      status: "Completed",
      taskStatus: "Completed",
      completionStatus: "Completed",
      remarks,
      completionRemarks: remarks,
      completionImages: mergedImages,
      completionImageUrls: mergedImages,
      completedAt: serverTimestamp(),
      completedByStaffId: session.uid,
      completedByStaffEmail: session.email,
      updatedAt: serverTimestamp()
    };

    if (task.collection === COLLECTIONS.complaints) {
      updateData.complaintStatus = "Resolved";
      updateData.resolvedAt = serverTimestamp();
      updateData.resolvedByStaffId = session.uid;
      updateData.resolvedByStaffEmail = session.email;
    }

    await setDoc(
      doc(db, task.collection, task.id),
      updateData,
      { merge: true }
    );

    await createTaskEvent(
      task,
      "task_completed",
      "Task Completed",
      `${task.title} marked as completed.`,
      {
        completionImageCount: mergedImages.length,
        remarks
      }
    );

    showToast("Task marked as complete.");
    state.selectedFiles.forEach((item) => {
      try {
        URL.revokeObjectURL(item.previewUrl);
      } catch (_) {}
    });
    state.selectedFiles = [];
  } catch (error) {
    console.error("Task completion failed:", error);
    showToast(`Task completion failed: ${error.message}`, "error");

    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-regular fa-circle-check"></i> Mark as Complete`;
    }
  } finally {
    state.loading = false;
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

  subscribeCollection("tasks", COLLECTIONS.tasks);
  subscribeCollection("staffTasks", COLLECTIONS.staffTasks);
  subscribeCollection("complaints", COLLECTIONS.complaints);
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
      state.activeTab = button.dataset.tab || "all";
      state.selectedTaskKey = "";
      renderTaskList();
    });
  });
}

function setupEvents() {
  setupTabs();

  $("taskSearchInput")?.addEventListener("input", (event) => {
    state.search = normalize(event.target.value);
    state.selectedTaskKey = "";
    renderTaskList();
  });

  $("taskFilterSelect")?.addEventListener("change", (event) => {
    state.filter = event.target.value || "All Tasks";
    state.selectedTaskKey = "";
    renderTaskList();
  });

  $("refreshTasksBtn")?.addEventListener("click", () => {
    renderPage();
    showToast("Task data refreshed.");
  });

  $("closeDetailsBtn")?.addEventListener("click", () => {
    state.selectedTaskKey = "";
    renderTaskDetails(null);

    document.querySelectorAll(".task-item").forEach((card) => {
      card.classList.remove("active");
    });
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

  document.addEventListener("click", (event) => {
    const removeBtn = event.target.closest("[data-remove-image]");
    if (removeBtn) {
      const index = Number(removeBtn.dataset.removeImage);
      const removed = state.selectedFiles.splice(index, 1)[0];

      if (removed) {
        try {
          URL.revokeObjectURL(removed.previewUrl);
        } catch (_) {}
      }

      renderSelectedImages(getSelectedTask());
      return;
    }

    const card = event.target.closest(".task-item");
    if (!card) return;

    state.selectedTaskKey = card.dataset.taskKey || "";
    renderTaskList();
  });
}

/* INIT */

document.addEventListener("DOMContentLoaded", () => {
  setupClock();
  setupLayout();
  setupEvents();
  setupAuth();
});